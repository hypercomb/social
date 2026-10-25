// sharing/publish-turn-off.ts
//
// TURN A PUBLISH OFF FROM A FRONT DOOR — the hand-off's one validator
// (jwize 2026-10-24: "if it is my domain I should be able to unpublish
// directly from hypercomb.com because I have the ownership key").
//
// A front door holds no key: the secret lives in the participant's own hive
// and never leaves it. So the door's Off button hands the hive the PUBLIC
// coordinates of the row — `#turn-off=<request>`, in the fragment so no
// server ever sees it — and the hive checks it holds that key, asks, signs
// and returns. The shell stashes the fragment verbatim (hypercomb-shared
// invite-capture.ts); everything it means is decided here.
//
// Turning off is REVERSIBLE: it moves `doors[key]` and keeps `roots[key]`,
// so turning a domain back on needs no new seal. Unpublishing stays its own
// act (publish-branch.ts unpublishBranch).
//
// MIRRORED: hypercomb-shim/src/bootstrap/turn-off-link.ts encodes the request;
// hypercomb-shared/core/invite-capture.ts holds the three literals below.

/** Where the shell stashes a hand-off it captured: `{ hash, relayed }`. */
export const PENDING_TURN_OFF_KEY = 'hc:pending-turn-off'
/** The fragment a front door hands over. */
export const TURN_OFF_PREFIX = '#turn-off='
/** The same-origin channel a hand-off is passed on to an open hive tab. */
export const TURN_OFF_CHANNEL = 'hc:turn-off'

export type TurnOffScope = 'here' | 'everywhere'

export type TurnOffRequest = {
  readonly v: 1
  /** The row's title, for the question asked — never trusted for anything else. */
  readonly title: string
  /** The index key the publish is under. */
  readonly lineage: string
  /** The key that signed it; the hive acts only when it holds this key. */
  readonly publisher: string
  /** The domain the row was read on — the door turned off with `here`. */
  readonly zone: string
  readonly scope: TurnOffScope
  /** The head the row showed: a newer one means the row was stale. */
  readonly head: string
  /** Where to go back to afterwards: the front door, on that domain only. */
  readonly back: string
}

const SIG = /^[a-f0-9]{64}$/
const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{1,5})?$/
const LOOPBACK = /^(?:[a-z0-9-]+\.)*localhost(?::\d{1,5})?$/

const words = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/\p{Cc}|\p{Cf}/gu, '').trim().replace(/\s+/g, ' ').slice(0, max) : ''

/** The front door to go back to: a plain address on the row's own domain (or
 *  one of its subdomains, such as host.<zone>) — never somewhere else, so a
 *  crafted hand-off cannot send the participant on to a stranger. */
export const backUrl = (back: unknown, zone: string): string | null => {
  if (typeof back !== 'string' || !HOST.test(zone)) return null
  let url: URL
  try { url = new URL(back) } catch { return null }
  const local = LOOPBACK.test(url.host)
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null
  if (url.username || url.password) return null
  if (url.host !== zone && !url.host.endsWith(`.${zone}`)) return null
  return `${url.origin}/`
}

/** A request, believed only as far as each field survives its check. */
export const parseTurnOff = (raw: unknown): TurnOffRequest | null => {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r['v'] !== 1) return null
  const lineage = words(r['lineage'], 200)
  const publisher = String(r['publisher'] ?? '').toLowerCase()
  const head = String(r['head'] ?? '').toLowerCase()
  const zone = String(r['zone'] ?? '').trim().toLowerCase()
  const scope = r['scope'] === 'here' || r['scope'] === 'everywhere' ? r['scope'] : null
  if (!lineage || lineage.includes(':') || !SIG.test(publisher) || !SIG.test(head) || !HOST.test(zone) || !scope) return null
  const back = backUrl(r['back'], zone)
  if (!back) return null
  return { v: 1, title: words(r['title'], 80) || lineage, lineage, publisher, zone, scope, head, back }
}

const fromBase64Url = (text: string): string => {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4)
  const bytes = Uint8Array.from(atob(padded), char => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** The request a `#turn-off=…` fragment carries, or null. */
export const decodeTurnOff = (hash: unknown): TurnOffRequest | null => {
  if (typeof hash !== 'string' || !hash.startsWith(TURN_OFF_PREFIX) || hash.length > 4096) return null
  try { return parseTurnOff(JSON.parse(fromBase64Url(hash.slice(TURN_OFF_PREFIX.length)))) } catch { return null }
}

/** A door entry that serves `zone`: the worker opens a host on an entry that
 *  is the host's domain or a parent of it (worker.js opensOn), so taking the
 *  zone off removes the zone itself and anything under it. */
export const serves = (entry: string, zone: string): boolean =>
  entry === zone || zone.endsWith(`.${entry}`) || entry.endsWith(`.${zone}`)

/**
 * The doors a key opens on after the turn-off. `everywhere` is none. `here`
 * is every domain it opens on now, less this one — and when the index names
 * none for the key (it opens on every domain), the list the caller read from
 * the ledger, since any list written becomes the whole of it. Null when that
 * list is unknown: guessing would close domains nobody asked to close.
 */
export const nextDoors = (listed: readonly string[] | undefined, openNow: readonly string[] | undefined,
  zone: string, scope: TurnOffScope): string[] | null => {
  if (scope === 'everywhere') return []
  const base = listed ?? openNow
  if (!base) return null
  const door = zone.trim().toLowerCase()
  return [...new Set(base.map(entry => String(entry ?? '').trim().toLowerCase()).filter(Boolean))]
    .filter(entry => !serves(entry, door))
}

/** A host is a root zone when no other known host contains it. */
const rootZones = (hosts: readonly string[]): string[] => {
  const known = new Set(hosts)
  return [...known].filter(host => {
    for (let dot = host.indexOf('.'); dot >= 0; dot = host.indexOf('.', dot + 1)) if (known.has(host.slice(dot + 1))) return false
    return true
  })
}

/** The domains a ledger (`/publications.json`) shows `lineage` open on for
 *  `publisher` — what `here` keeps open when the index names no doors. */
export const openZonesOf = (ledger: unknown, lineage: string, publisher: string): string[] => {
  const sites = (ledger as { sites?: unknown } | null)?.sites
  if (!Array.isArray(sites)) return []
  const hostsOf = (site: Record<string, unknown>): string[] =>
    [site['host'], ...(Array.isArray(site['hosts']) ? site['hosts'] as unknown[] : []).map(row => (row as { host?: unknown } | null)?.host)]
      .map(host => (typeof host === 'string' ? host.trim().toLowerCase() : '')).filter(host => HOST.test(host))
  const all = sites.filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
  const zones = rootZones(all.flatMap(hostsOf))
  const out = new Set<string>()
  for (const site of all) {
    if (site['lineage'] !== lineage) continue
    const published = (Array.isArray(site['publishers']) ? site['publishers'] as unknown[] : [])
      .some(row => !!row && typeof row === 'object' && (row as Record<string, unknown>)['pubkey'] === publisher
        && SIG.test(String((row as Record<string, unknown>)['head'] ?? '')))
    if (!published) continue
    for (const host of hostsOf(site)) {
      const zone = zones.find(root => host === root || host.endsWith(`.${root}`))
      if (zone) out.add(zone)
    }
  }
  return [...out].sort()
}
