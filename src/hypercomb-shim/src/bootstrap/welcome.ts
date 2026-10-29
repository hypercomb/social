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
// links that belong on ITS front page (the first one leads). Active hives
// arrive through the public offering pool. No particular domain is compiled in — the
// platform's own doors are the shim's provenance, not a host's identity, and
// the footer never repeats a door the operator already put on the page.
// Absent is the normal case.
//
// EVERY FIELD IS UNTRUSTED. The file is static content the operator staged,
// but it is still data: text is clamped, and an href must be a plain http(s)
// address or a path on this origin, so nothing in the file can become script.
//
// THE ROOM AT THE TOP (jwize 2026-10-24: "the way to host a swarm should be a
// link on the home page at the top of a domain"). A card may carry `swarm`, a
// sealed swarm link (#swarm=<sig>@<host>~<key>) its owner put there with `room
// host <domain>`; the showcase draws it first, as "Join the swarm". It hides
// the room and its secret; whoever opens the page can join — by design.

/** The pictures a link may wear: a closed set the shim draws itself, named by
 *  the staged card, so a door's look is data and never a guess from its words. */
export const LINK_ICONS = ['tour', 'app', 'host', 'download', 'extension', 'docs', 'source'] as const
export type LinkIcon = typeof LINK_ICONS[number]
export type WelcomeLink = { label: string; href: string; note: string; icon?: LinkIcon }
export type Welcome = {
  title: string
  tagline: string
  links: WelcomeLink[]
  /** The zone's room: a sealed swarm link, or '' (absent on a card without one). */
  swarm?: string
}

/** The card, resolved: what it shows whether or not anything was staged. */
export type FrontDoor = {
  readonly title: string
  readonly tagline: string
  readonly links: readonly WelcomeLink[]
  /** The zone's room, drawn first as "Join the swarm" — or ''. */
  readonly swarm: string
  /** Where the platform explains itself, minus any door the staged links
   *  already open — `/tour/` on hypercomb.com IS the tour. */
  readonly footer: readonly WelcomeLink[]
}

/** What every host is, until its operator says otherwise. */
export const DEFAULT_TAGLINE =
  'Discover creations, inspect their source, and choose what to carry into your hive.'

/** Where a hive of your own starts, on every host. */
export const APP_HREF = 'https://hypercomb.io/'

/** The platform's own doors. A host is a directory of files that somebody
 *  chose to serve; these say what the files are for, and they are the same
 *  on every host because they are about the platform, not the host.
 *  Licensing lives under `src/documentation`. The repository root has no
 *  `documentation` folder, and a link there is a 404. */
export const PLATFORM_LINKS: readonly WelcomeLink[] = [
  { label: 'the tour', href: 'https://hypercomb.com/tour/', note: 'what this is, in nineteen minutes', icon: 'tour' },
  { label: 'hypercomb.io', href: APP_HREF, note: 'the app — start a hive of your own', icon: 'app' },
  { label: 'source', href: 'https://github.com/hypercomb/social', note: 'AGPL-3.0', icon: 'source' },
  { label: 'licensing', href: 'https://github.com/hypercomb/social/blob/main/src/documentation/licensing.md', note: '', icon: 'docs' },
]

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

/** The one shape a card's room may take (host-welcome.ts WELCOME_SWARM_RE,
 *  worker.js): an https page and a sealed #swarm= fragment. */
export const SWARM_LINK_RE = /^https:\/\/[a-z0-9.-]+(?::\d{1,5})?\/#swarm=[0-9a-f]{64}@[a-z0-9.:[\]-]+~[A-Za-z0-9_-]{43}$/

const swarmFrom = (value: unknown): string => {
  const link = typeof value === 'string' ? value.trim() : ''
  return SWARM_LINK_RE.test(link) ? link : ''
}

const linksFrom = (value: unknown): WelcomeLink[] => {
  if (!Array.isArray(value)) return []
  const links: WelcomeLink[] = []
  for (const entry of value.slice(0, 6)) {
    const record = entry as Record<string, unknown>
    const label = text(record?.label, 60)
    const target = href(record?.href)
    const icon = LINK_ICONS.find(name => name === record?.icon)
    if (label && target) links.push({ label, href: target, note: text(record?.note, 80), ...(icon ? { icon } : {}) })
  }
  return links
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
    swarm: swarmFrom(record.swarm),
  }
  const empty = !welcome.title && !welcome.tagline && welcome.links.length === 0 && !welcome.swarm
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
  // A ZONE'S SIGNED CARD FIRST. Where a worker fronts this origin it reads the
  // card from the pool sign('welcome:<zone>') — the head the zone's publisher
  // signs — and writes it into the page as `#hc-welcome`. A file staged next to
  // the shell names every zone that shares the origin at once; a pool names one.
  let card: Welcome | null = null
  try {
    const carried = document.getElementById('hc-welcome')?.textContent
    card = carried ? parseWelcome(JSON.parse(carried)) : null
  } catch { /* a malformed card is no card; the staged file still answers */ }
  if (card && (card.title || card.tagline || card.links.length)) return card
  // A card that carries only its zone's room keeps the staged file's name
  // around it — as the worker does when it could read the file itself.
  const staged = await readStaged()
  if (!card) return staged
  return staged ? { ...staged, swarm: card.swarm } : card
}

/** The file staged next to the shell, or null. It never carries a room: a
 *  room rides only the zone's signed card, never the file every zone shares. */
const readStaged = async (): Promise<Welcome | null> => {
  try {
    const response = await fetch('/welcome.json', { cache: 'no-store' })
    if (!response.ok) return null
    if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('json')) return null
    const raw: unknown = await response.json()
    return parseWelcome(raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw, swarm: '' } : raw)
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

/** The name a card goes by. A front door whose domain opens on a creation
 *  keeps its card at `host.<zone>` (the worker's HOST_DOOR_LABEL), and that
 *  card is the zone's host — so it is named as the zone. */
const hostNameOf = (hostname: string): string => {
  const rest = hostname.startsWith('host.') ? hostname.slice('host.'.length) : ''
  return rest.includes('.') ? rest : hostname
}

/** The card a host shows: the staged front door where there is one, and the
 *  host's own name, the platform's sentence and the platform's doors where
 *  there is not. Pure, so the default is a fact the suite can pin. */
export const frontDoorOf = (welcome: Welcome | null, hostname: string, origin: string): FrontDoor => {
  const links = welcome?.links ?? []
  return {
    title: welcome?.title || hostNameOf(hostname),
    tagline: welcome?.tagline || DEFAULT_TAGLINE,
    links,
    swarm: welcome?.swarm ?? '',
    footer: PLATFORM_LINKS.filter(door => !links.some(link => sameDoor(link.href, door.href, origin))),
  }
}
