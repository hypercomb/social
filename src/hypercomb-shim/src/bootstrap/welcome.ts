// hypercomb-shim/src/bootstrap/welcome.ts
//
// THE FRONT DOOR, AS CONTENT.
//
// The host card is the first thing a person sees on a cold origin, and on a
// flagship origin it is also the whole website: hypercomb.com opens here.
// A card that can only say "add a domain" is a dead end for the visitor who
// arrived to find out what this is — the links that page carried (the tour,
// the hives already live on the zone) have to survive the move.
//
// They are NOT compiled in. The shim is one generic host that anybody deploys,
// so nothing about hypercomb.com may live in its bytes. The deployment stages
// `welcome.json` next to the shell and this reads it — absent is the normal
// case, and a host without one renders exactly the card it rendered before.
//
// EVERY FIELD IS UNTRUSTED. The file is static content the operator staged,
// but it is still data: text is clamped, and an href must be a plain http(s)
// address or a path on this origin, so nothing in the file can become script.

export type WelcomeLink = { label: string; href: string; note: string }
export type WelcomeDoor = { title: string; host: string }

export type Welcome = {
  title: string
  tagline: string
  links: WelcomeLink[]
  doorsLabel: string
  doors: WelcomeDoor[]
}

const HOSTNAME_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : ''

/** A place a link may point: this origin, or a plain web address. Anything
 *  else — `javascript:`, `data:`, a protocol-relative `//host` — is dropped. */
const href = (value: unknown): string => {
  const raw = text(value, 2048)
  if (!raw) return ''
  if (raw.startsWith('//')) return ''
  if (raw.startsWith('/')) return raw
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : ''
  } catch { return '' }
}

const linksFrom = (value: unknown): WelcomeLink[] => {
  if (!Array.isArray(value)) return []
  const links: WelcomeLink[] = []
  for (const entry of value.slice(0, 6)) {
    const record = entry as Record<string, unknown>
    const label = text(record?.label, 60)
    const target = href(record?.href)
    if (label && target) links.push({ label, href: target, note: text(record?.note, 80) })
  }
  return links
}

const doorsFrom = (value: unknown): WelcomeDoor[] => {
  if (!Array.isArray(value)) return []
  const doors: WelcomeDoor[] = []
  for (const entry of value.slice(0, 60)) {
    const record = entry as Record<string, unknown>
    const host = text(record?.host, 253).toLowerCase()
    if (!HOSTNAME_RE.test(host)) continue
    doors.push({ host, title: text(record?.title, 60) || host.split('.')[0] })
  }
  return doors
}

/**
 * Read the staged front door, or null when this host has none.
 *
 * A missing file is the expected answer, not an error — and on a host with an
 * SPA navigation fallback a missing file answers 200 with the shell's HTML, so
 * the content type is checked before the body is believed.
 */
export const readWelcome = async (): Promise<Welcome | null> => {
  let raw: unknown
  try {
    const response = await fetch('/welcome.json', { cache: 'no-store' })
    if (!response.ok) return null
    if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('json')) return null
    raw = await response.json()
  } catch { return null }

  const record = raw as Record<string, unknown>
  if (!record || typeof record !== 'object') return null

  const welcome: Welcome = {
    title: text(record.title, 60),
    tagline: text(record.tagline, 400),
    links: linksFrom(record.links),
    doorsLabel: text(record.doorsLabel, 80),
    doors: doorsFrom(record.doors),
  }
  const empty = !welcome.title && !welcome.tagline && welcome.links.length === 0 && welcome.doors.length === 0
  return empty ? null : welcome
}
