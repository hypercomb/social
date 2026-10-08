// sharing/zone-door.ts
//
// THE ROOT IS THE DOOR (jwize 2026-10-03: "when you publish you always publish
// to the root domain … make sure it is retired across the board").
//
// A host is a ZONE, and the hive talks to the zone itself: byte PUTs, the
// signed index PUT, forget, grant, claim and AI asks all go to
// `https://<zone>/…`. The `content.<zone>` face is RETIRED as a write target —
// the worker still answers there for old installs, and nothing new may aim at
// it.
//
// Two rules live here, once, so no module keeps its own spelling of them:
//
//   WRITES — `zoneDoor(host)` folds a leading `content.` label away. A stored
//   setting written before the retirement (`hc:public-host:domain`, a kept
//   claim, a follow record) is READ as its zone, so an updated hive keeps
//   publishing to the same place with no action. Nothing stored is rewritten
//   here; the folded value is what gets saved next time.
//
//   READS — `readDoorsOf(hosts)` asks every zone root first and only then the
//   old `content.<zone>` faces, because a reader may still meet an index or an
//   atom only the content face held. Reads may fall back; writes never.
//
// And the address a creation lives at: by default the zone's ROOT PATH
// (`https://<zone>/<lineage path>`), or — when the participant gave it one —
// its OWN ADDRESS `https://<label>.<zone>`, declared in the signed hive index
// as `addresses: { "<label>.<zone>": "<lineage key>" }`.

const LOOPBACK_RE = /^((?:[a-z0-9-]+\.)*localhost|127(?:\.\d+){3}|\[?::1\]?)(?::\d{1,5})?$/i
const CONTENT_LABEL = 'content.'

/** A host as a bare authority: no scheme, no path, no trailing dot, lower case. */
export const bareHost = (raw: unknown): string => {
  const text = String(raw ?? '').trim().toLowerCase()
    .replace(/^@/, '')
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  return (text.split(/[/?#]/)[0] ?? '').replace(/\.+$/, '')
}

export const isLoopbackHost = (raw: unknown): boolean => LOOPBACK_RE.test(bareHost(raw))

/**
 * The ZONE a host names: a leading `content.` label folded away. Only a label
 * in front of a real zone is plumbing — `content.com` is a domain of its own
 * and stays as it is. `content.localhost:4291` is the loopback content face
 * and folds to its machine, `localhost:4291`.
 */
export const foldContentLabel = (raw: unknown): string => {
  const bare = bareHost(raw)
  if (!bare.startsWith(CONTENT_LABEL)) return bare
  const rest = bare.slice(CONTENT_LABEL.length)
  return rest.includes('.') || LOOPBACK_RE.test(rest) ? rest : bare
}

/** Where a WRITE to this host goes: the zone root. Never `content.<zone>`. */
export const zoneDoor = (raw: unknown): string => foldContentLabel(raw)

/** The retired `content.<zone>` face of a zone — a READ fallback only. Empty
 *  for loopback (a machine has no DNS label in front of it). */
export const legacyContentFace = (raw: unknown): string => {
  const zone = foldContentLabel(raw)
  if (!zone || !zone.includes('.') || LOOPBACK_RE.test(zone)) return ''
  return `${CONTENT_LABEL}${zone}`
}

/**
 * Every door worth READING from for these hosts, in order: each zone root
 * first, then the retired content faces as a fallback for old published data.
 * A host given as `content.<zone>` contributes its zone AND that face.
 */
export const readDoorsOf = (hosts: readonly unknown[]): string[] => {
  const roots: string[] = []
  const faces: string[] = []
  for (const host of hosts ?? []) {
    const zone = foldContentLabel(host)
    if (!zone) continue
    if (!roots.includes(zone)) roots.push(zone)
    const face = legacyContentFace(zone)
    if (face && !faces.includes(face)) faces.push(face)
  }
  return [...roots, ...faces.filter(face => !roots.includes(face))]
}

/** `https://` for a real zone, `http://` for loopback. */
export const originOf = (raw: unknown): string => {
  const bare = bareHost(raw)
  return bare ? `${LOOPBACK_RE.test(bare) ? 'http' : 'https'}://${bare}` : ''
}

// ── where a creation lives ─────────────────────────────────────────────

/** The DEFAULT address of a creation published to `zone`: the zone's root
 *  path, `https://<zone>/<segment>/<segment>`. The hive root is the zone. */
export const rootPathUrl = (zone: unknown, segments: readonly string[]): string => {
  const origin = originOf(foldContentLabel(zone))
  if (!origin) return ''
  const path = (segments ?? []).map(s => String(s ?? '').trim()).filter(Boolean).map(encodeURIComponent).join('/')
  return path ? `${origin}/${path}` : origin
}

const DNS_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/** THE DOMAIN ITSELF as an own address — `@`, the zone apex's own name in
 *  DNS. A creation given `@` on a front-door domain is what the bare domain
 *  opens on; the host card then answers at `host.<zone>` (jwize 2026-10-05:
 *  pointblanksolutions.ca opens on its creation, and shows off its hosting). */
export const APEX_LABEL = '@'

/** The first-level name a front door keeps its card at — never a creation's. */
export const HOST_DOOR_LABEL = 'host'

/** Why a label cannot be an own address, or '' when it can. `content` is the
 *  retired write face, `host` is a front door's card and `try-*` names a module
 *  sandbox — all belong to the host, never to a creation. `@` is the domain
 *  itself. */
export const ownAddressRefusal = (label: unknown): '' | 'not-a-label' | 'reserved' => {
  const text = String(label ?? '')
  if (text === APEX_LABEL) return ''
  if (!DNS_LABEL_RE.test(text)) return 'not-a-label'
  if (text === 'content' || text === HOST_DOOR_LABEL || text.startsWith('try-')) return 'reserved'
  return ''
}

export const isOwnAddressLabel = (label: unknown): boolean => ownAddressRefusal(label) === ''

/** A name folded to a DNS label — the default own address for a tile is its
 *  last segment through this. '' when nothing usable is left. */
export const foldDnsLabel = (raw: unknown): string =>
  String(raw ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '')

/** The own-address host for a label on a zone, or '' when either is unusable.
 *  `@` is the zone itself. */
export const ownAddressHost = (label: unknown, zone: unknown): string => {
  const z = foldContentLabel(zone)
  if (!z || LOOPBACK_RE.test(z) || !isOwnAddressLabel(label)) return ''
  return label === APEX_LABEL ? z : `${String(label)}.${z}`
}

/** The signed `addresses` map, leniently: a host that is not `<label>.<zone>`
 *  with a usable label, or a lineage key the roots do not name, drops that
 *  entry — never the whole index. */
export const readAddresses = (raw: unknown, roots: Record<string, string>): Record<string, string> => {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [host, key] of Object.entries(raw as Record<string, unknown>)) {
    const k = String(key ?? '')
    const h = bareHost(host)
    const dot = h.indexOf('.')
    if (dot <= 0 || !(k in roots)) continue
    if (ownAddressHost(h.slice(0, dot), h.slice(dot + 1)) !== h) continue
    out[h] = k
  }
  return out
}

// ── the entrance a zone runs ───────────────────────────────────────────
//
// POWERS ARE OFF BY DEFAULT, AND THE PARTICIPANT TURNS THEM ON
// (documentation/using-a-creation.md). The signed index may carry
// `entrances: { "<zone>": { page, powers, other, from } }`, keyed by the zone
// and never by a lineage:
//
//   page    the one card page (htmlSig) the participant previewed — the bytes
//           the domain serves at its root, by signature;
//   powers  what that page may do there; version 1 is all or nothing, so only
//           all three together turn anything on;
//   other   where any device that is not a phone goes (`host.<zone>` or one of
//           the zone's own `<label>.<zone>` addresses); absent = every device
//           gets the phone entrance;
//   from    whose page this is followed from, `at`: the followed index's stamp
//           (whole seconds) when the participant turned it on, and `head`: the
//           followed lineage's head layer then. Only a later stamp AND a moved
//           head can offer an update. Read by the hive only; the host ignores
//           it.
//
// The entry counts only where the same publisher's `addresses[zone]` opens the
// zone apex; that is the host's check, so no entry is pruned here. `other` IS
// pruned: it must still be `host.<zone>` or an address the same index names.

/** The powers a card door may be given — keep the visitor's cards, use the
 *  camera, read other hosts. Version 1 grants all three or none. */
export const ENTRANCE_POWERS = ['keep', 'camera', 'read'] as const
export type EntrancePower = (typeof ENTRANCE_POWERS)[number]

export interface ZoneEntranceFrom {
  pubkey: string
  lineage: string
  /** The followed index's `created_at` when this page was turned on. */
  at?: number
  /** The followed lineage's head layer signature when it was turned on. */
  head?: string
}

export interface ZoneEntrance {
  page?: string
  powers?: EntrancePower[]
  other?: string
  from?: ZoneEntranceFrom
}

const ENTRANCE_SIG_RE = /^[a-f0-9]{64}$/
const MAX_FOLLOWED_LINEAGE = 512
/** The host refuses an index naming more (worker ENTRANCES_MAX). */
export const ENTRANCES_MAX = 16

/** Where a non-phone device may be sent from `zone`: `host.<zone>` or a
 *  `<label>.<zone>` own address. '' when `raw` is neither. With `addresses`,
 *  a `<label>.<zone>` must also be an address that map names — an address
 *  given up takes its entrance choice with it. */
export const entranceOther = (raw: unknown, zone: unknown, addresses?: Record<string, string>): string => {
  const z = foldContentLabel(zone)
  const h = bareHost(raw)
  if (!z || !h.endsWith(`.${z}`)) return ''
  const label = h.slice(0, h.length - z.length - 1)
  if (label === HOST_DOOR_LABEL) return h
  if (label === APEX_LABEL || !isOwnAddressLabel(label)) return ''
  return !addresses || h in addresses ? h : ''
}

/** One entry, leniently: an invalid field is dropped, never the entry; an
 *  entry with nothing valid left is null. Powers without a page mean nothing
 *  and are dropped with it. */
const readEntrance = (raw: unknown, zone: string, addresses?: Record<string, string>): ZoneEntrance | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const entry = raw as Record<string, unknown>
  const out: ZoneEntrance = {}
  const page = String(entry['page'] ?? '').trim().toLowerCase()
  if (ENTRANCE_SIG_RE.test(page)) out.page = page
  if (out.page && Array.isArray(entry['powers'])) {
    const named = new Set(entry['powers'].map(p => String(p ?? '').trim().toLowerCase()))
    out.powers = ENTRANCE_POWERS.filter(p => named.has(p))
  }
  const other = entranceOther(entry['other'], zone, addresses)
  if (other) out.other = other
  const from = entry['from']
  if (from && typeof from === 'object' && !Array.isArray(from)) {
    const f = from as Record<string, unknown>
    const pubkey = String(f['pubkey'] ?? '').trim().toLowerCase()
    const lineage = String(f['lineage'] ?? '').trim()
    const at = f['at']
    const head = String(f['head'] ?? '').trim().toLowerCase()
    if (ENTRANCE_SIG_RE.test(pubkey) && lineage && lineage.length <= MAX_FOLLOWED_LINEAGE) {
      out.from = {
        pubkey, lineage,
        ...(Number.isSafeInteger(at) && (at as number) >= 0 ? { at: at as number } : {}),
        ...(ENTRANCE_SIG_RE.test(head) ? { head } : {}),
      }
    }
  }
  return Object.keys(out).length > 0 ? out : null
}

/** The signed `entrances` map, leniently: a key that is not a real zone, or an
 *  entry with nothing valid in it, drops that entry — never the whole index.
 *  The same rules normalize every write (putHiveManifest), with the index's
 *  own `addresses`. */
export const readEntrances = (raw: unknown, addresses?: Record<string, string>): Record<string, ZoneEntrance> => {
  const out: Record<string, ZoneEntrance> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const zone = foldContentLabel(key)
    if (!zone.includes('.') || ownAddressHost(APEX_LABEL, zone) !== zone) continue
    const entry = readEntrance(value, zone, addresses)
    if (entry && (zone in out || Object.keys(out).length < ENTRANCES_MAX)) out[zone] = entry
  }
  return out
}

/** Are this entrance's powers on? Version 1: a page AND all three powers. */
export const isPoweredEntrance = (entrance: ZoneEntrance | null | undefined): boolean =>
  !!entrance?.page && ENTRANCE_POWERS.every(p => entrance.powers?.includes(p))

/** The own address a lineage key holds on `zone`, as its label, or ''. */
export const ownLabelOn = (addresses: Record<string, string> | undefined, zone: unknown, key: string): string => {
  const z = foldContentLabel(zone)
  for (const [host, k] of Object.entries(addresses ?? {})) {
    if (k === key && host === z) return APEX_LABEL
    if (k === key && host.endsWith(`.${z}`)) {
      const label = host.slice(0, host.length - z.length - 1)
      if (isOwnAddressLabel(label)) return label
    }
  }
  return ''
}

/** Where a creation is shown on `zone`: its own address when it has one, its
 *  root path otherwise. */
export const creationUrl = (
  zone: unknown,
  segments: readonly string[],
  key: string,
  addresses?: Record<string, string>,
): string => {
  const label = ownLabelOn(addresses, zone, key)
  const own = label ? ownAddressHost(label, zone) : ''
  return own ? originOf(own) : rootPathUrl(zone, segments)
}

/** The next `addresses` map after giving `key` the own address `label` on
 *  `zone` (or, with no label, taking its address on that zone away). Any other
 *  key holding that host loses it — one host names one creation. */
export const withOwnAddress = (
  addresses: Record<string, string> | undefined,
  zone: unknown,
  key: string,
  label: string | null,
): Record<string, string> => {
  const z = foldContentLabel(zone)
  const next: Record<string, string> = {}
  for (const [host, k] of Object.entries(addresses ?? {})) {
    if (k === key && (host === z || host.endsWith(`.${z}`))) continue
    next[host] = k
  }
  if (label) {
    const host = ownAddressHost(label, z)
    if (host) next[host] = key
  }
  return next
}
