// hypercomb-shim/src/bootstrap/welcome.ts
//
// THE FRONT DOOR EVERY HOST HAS — AND THE ONE AN OPERATOR STAGES ON TOP.
//
// The host card is the first thing a person sees on a cold origin, and on a
// flagship origin it is also the whole website: hypercomb.com opens here. A
// card that can only say "add a domain" is a dead end for the visitor who
// arrived to find out what this is. So every host presents itself, with
// nothing staged at all: the mark, its own name, one sentence about what a
// host is, what it publishes, and — in the footer — where the platform
// explains itself. That is the default experience, the same on a Pages
// deployment, an Azure app, and a machine running `hypercomb-serve`.
//
// An origin that is also a website stages `welcome.json` next to the shell
// and the card reads it: a title and a tagline in place of the defaults, the
// links that belong on ITS front page (the first one leads), and the hives
// live on its zone. Nothing about any particular domain is compiled in — the
// platform's own doors are the shim's provenance, not a host's identity, and
// the footer never repeats a door the operator already put on the page.
// Absent is the normal case.
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

/** The card, resolved: what it shows whether or not anything was staged. */
export type FrontDoor = {
  readonly title: string
  readonly tagline: string
  readonly links: readonly WelcomeLink[]
  readonly doorsLabel: string
  readonly doors: readonly WelcomeDoor[]
  /** Where the platform explains itself, minus any door the staged links
   *  already open — `/tour/` on hypercomb.com IS the tour. */
  readonly footer: readonly WelcomeLink[]
}

/** What every host is, until its operator says otherwise. */
export const DEFAULT_TAGLINE =
  'A hypercomb host. What it publishes is named by its own content, ' +
  'taken by replication, and verified by whoever takes it.'

/** The platform's own doors. A host is a directory of files that somebody
 *  chose to serve; these say what the files are for, and they are the same
 *  on every host because they are about the platform, not the host. */
export const PLATFORM_LINKS: readonly WelcomeLink[] = [
  { label: 'the tour', href: 'https://hypercomb.com/tour/', note: 'what this is, in nineteen minutes' },
  { label: 'hypercomb.io', href: 'https://hypercomb.io/', note: 'the app — start a hive of your own' },
  { label: 'documentation', href: 'https://github.com/hypercomb/social/tree/main/documentation', note: '' },
  { label: 'source', href: 'https://github.com/hypercomb/social', note: 'AGPL-3.0' },
  { label: 'licensing', href: 'https://github.com/hypercomb/social/blob/main/documentation/licensing.md', note: '' },
]

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

/** The staged file, believed only as far as each field survives its clamp.
 *  Null when nothing usable is in it. */
export const parseWelcome = (raw: unknown): Welcome | null => {
  const record = raw as Record<string, unknown>
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null

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

/**
 * Read the staged front door, or null when this host has none.
 *
 * A missing file is the expected answer, not an error — and on a host with an
 * SPA navigation fallback a missing file answers 200 with the shell's HTML, so
 * the content type is checked before the body is believed.
 */
export const readWelcome = async (): Promise<Welcome | null> => {
  try {
    const response = await fetch('/welcome.json', { cache: 'no-store' })
    if (!response.ok) return null
    if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('json')) return null
    return parseWelcome(await response.json())
  } catch { return null }
}

/** One address for a door, so a staged `/tour/` on hypercomb.com and the
 *  platform's `https://hypercomb.com/tour/` are seen as the same place. */
const sameDoor = (a: string, b: string, origin: string): boolean => {
  try {
    const key = (raw: string): string => {
      const url = new URL(raw, origin)
      return `${url.origin}${url.pathname.replace(/\/+$/, '')}${url.search}${url.hash}`
    }
    return key(a) === key(b)
  } catch { return false }
}

/** THE DEPLOYED NODES ARE AN OPERATOR'S VIEW. The hives live on a zone are
 *  staged with the rest of the front door, but a visitor is shown the details
 *  — the name, the sentence, the links, what this host publishes — and not
 *  the directory of nodes, unless this browser asks for it:
 *  `localStorage.setItem('hc:show-deployed-nodes', '1')`. */
export const SHOW_DEPLOYED_NODES_KEY = 'hc:show-deployed-nodes'

export const showsDeployedNodes = (): boolean => {
  try {
    const value = localStorage.getItem(SHOW_DEPLOYED_NODES_KEY)
    return value === '1' || value === 'true'
  } catch { return false }
}

/** The card a host shows: the staged front door where there is one, and the
 *  host's own name, the platform's sentence and the platform's doors where
 *  there is not. Pure, so the default is a fact the suite can pin. */
export const frontDoorOf = (welcome: Welcome | null, hostname: string, origin: string, showNodes = false): FrontDoor => {
  const links = welcome?.links ?? []
  return {
    title: welcome?.title || hostname,
    tagline: welcome?.tagline || DEFAULT_TAGLINE,
    links,
    doorsLabel: welcome?.doorsLabel ?? '',
    doors: showNodes ? welcome?.doors ?? [] : [],
    footer: PLATFORM_LINKS.filter(door => !links.some(link => sameDoor(link.href, door.href, origin))),
  }
}
