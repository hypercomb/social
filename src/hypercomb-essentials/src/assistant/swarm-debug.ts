// assistant/swarm-debug.ts
//
// THE SWARM, READ IN ONE CALL — the bridge op `swarm-debug`
// (claude-bridge.worker.ts; documentation/claude-bridge-setup.md).
//
// A live swarm failure on the owner's tab could only be read by stitching
// `effect-last` cells and relay REQs together, because opening a second tab on
// his hive is forbidden. This is the one snapshot instead: what the swarm
// drone, the mesh, the share line and the tab's membership say, right now.
//
// READ-ONLY, ALL THE WAY DOWN: nothing here emits, writes or dials. That rules
// out two public reads that look harmless. NostrMeshDrone.getDebug() STARTS
// the mesh when it has not started (a dial), and connectionState() ANNOUNCES
// `mesh:connection` when the state moved since the last announcement (an
// emit). So the connection is the last one announced (the bus's replay), and
// the relays, sockets and counters are read off the mesh's own fields — null,
// not empty, when a field is not there to read. Host sync's swarmHosts() and
// isGateActive() are skipped for the same reason (a cache miss kicks a local
// read); hostTrouble(host) and the configured-target getters are pure, and
// hostTrouble is asked of every host the share line, the tab's zone and host
// sync's own `sync:state` words name.
//
// NEVER A SECRET. Fields are PICKED, never spread, so the room secret, the
// access code, a private key, an nsec, a NIP-98 token, a bridge code or a
// storage dump has no field to arrive in; the zone says hasSecret / hasCode.
// And the whole snapshot passes one scrub on the way out: FREE TEXT (a
// reason, a refusal, an error — words this tab did not write) that holds the
// tab's own secret or code is withheld WHOLE, never spliced (a cut-out's
// position and the text around it give the secret back); the room, equal to
// the secret, is withheld whole; nsec / bridge-code / Nostr-auth / Bearer
// shapes and long base64 are redacted everywhere, and a 64-hex run (a
// signature — or a private key in its shape) is cut to its first 12
// characters. Hosts, relay addresses and fixed words are never searched for
// the secret: they cannot carry it, and searching them only defaces them.
//
// NEVER A PRIVATE NAME. The swarm's own children are COUNTS. A page path (the
// walk pages, the first announce, the pages in flight, the page the tab
// stands on, the share line's location) is shown up to its first segment that
// is not public on this tab (tile-public.ts, the same mark the walk obeys),
// and that segment and everything under it read `[private]`. The only other
// names are the tiles peers PUBLISHED to the room.
//
// BOUNDED: lists and maps stop at 64 (the rest said as a count), strings at
// 200 characters, nesting at 6 levels.

import { EffectBus } from '@hypercomb/core'
import { isCellPublic } from '../presentation/tiles/tile-public.js'
import { isJoinedHere, readTabZone, type TabZone } from '../sharing/membership.js'

const CAP = 64
const STRING_CAP = 200
const DEPTH_CAP = 6
const SIG_SHOWN = 12

const SWARM_KEY = '@diamondcoreprocessor.com/SwarmDrone'
const MESH_KEY = '@diamondcoreprocessor.com/NostrMeshDrone'
const HOST_SYNC_KEY = '@diamondcoreprocessor.com/HostSyncService'
const SECRET_STORE_KEY = '@hypercomb.social/SecretStore'

type Json = Record<string, unknown>

type SwarmLike = {
  debug?: () => unknown
  participantsAtCurrentSig?: () => readonly unknown[]
  participantsInZone?: () => readonly unknown[]
  peerTilesAtCurrentSig?: () => readonly unknown[]
}

/** The mesh as this read sees it: its public pure reads, and the plain fields
 *  getDebug() would have copied — read here so nothing starts or announces. */
type MeshLike = {
  relays?: unknown
  sockets?: unknown
  stats?: unknown
  started?: unknown
  stopped?: unknown
  isNetworkEnabled?: () => boolean
  relaysAddressed?: () => boolean
  swarmHost?: () => string
}

/** Host sync's PURE reads only: each answers from memory or one storage read,
 *  and none kicks a resolve, a drain or a dial. */
type HostSyncLike = {
  hostTrouble?: (host: string) => unknown
  isEnabled?: () => unknown
  isPublicHostEnabled?: () => unknown
  publicHostDomain?: () => unknown
  publishNodes?: () => unknown
}

// ── each host's last word ────────────────────────────────────────────
// The bus keeps ONE last value per effect and `sync:state` is said per host,
// so each host's last word is kept here from the moment this module loads (the
// subscription is handed the latest at once — its moment is not known, so its
// `heardAtMs` is null). A host that speaks again moves to the end; the oldest
// falls off past the cap.
const syncByHost = new Map<string, { word: unknown; heardAtMs: number | null }>()
let replaying = true
EffectBus.on<{ host?: unknown }>('sync:state', payload => {
  const host = typeof payload?.host === 'string' ? payload.host.trim().toLowerCase() : ''
  if (!host) return
  syncByHost.delete(host)
  syncByHost.set(host, { word: payload, heardAtMs: replaying ? null : Date.now() })
  while (syncByHost.size > CAP) {
    const oldest = syncByHost.keys().next().value
    if (oldest === undefined) break
    syncByHost.delete(oldest)
  }
})
replaying = false

/** The last value the bus holds for `effect`, or null. The bus replays it to a
 *  new subscriber synchronously; the momentary subscription goes at once. */
const lastOf = (effect: string): unknown => {
  let captured: unknown = null
  const off = EffectBus.on(effect, (payload: unknown) => { captured = payload })
  try { off() } catch { /* unsubscribe best-effort */ }
  return captured ?? null
}

const service = <T>(key: string): T | undefined => {
  try { return (globalThis as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined }
  catch { return undefined }
}

/** A read that throws answers with its error — never the op's failure. */
const read = <T>(fn: () => T): T | { error: string } => {
  try { return fn() } catch (e) { return { error: e instanceof Error ? e.message : String(e) } }
}

const isRecord = (value: unknown): value is Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const isReadError = (value: unknown): value is { error: string } =>
  isRecord(value) && typeof value['error'] === 'string' && Object.keys(value).length === 1

/** Numbers and flags only, plus the named string fields — never a spread. A
 *  field added upstream that carries names or keys has no way through. */
const countersOf = (value: unknown, strings: readonly string[] = []): Json | null => {
  if (!isRecord(value)) return null
  const out: Json = {}
  for (const [key, v] of Object.entries(value)) {
    if (typeof v === 'number' || typeof v === 'boolean') out[key] = v
    else if (strings.includes(key) && (typeof v === 'string' || v === null)) out[key] = v
  }
  return out
}

const stringsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []

const countOf = (value: unknown): number | null => Array.isArray(value) ? value.length : null

// ── page paths: public names only ────────────────────────────────────

const PRIVATE_MARK = '[private]'

/** The segments up to the first one that is not public on this tab; that one
 *  and everything under it become one `[private]`. Each is asked at its own
 *  parent, as the walk asks it (a public branch covers what is under it). */
const publicSegments = (segments: readonly unknown[]): string[] => {
  const out: string[] = []
  for (const raw of segments) {
    const name = String(raw ?? '').trim()
    if (!name) continue
    let shown = false
    try { shown = isCellPublic('/' + out.join('/'), name) } catch { shown = false }
    if (!shown) { out.push(PRIVATE_MARK); break }
    out.push(name)
  }
  return out
}

/** A '/'-joined page key ('/' = the root) with its private part masked. */
const publicPage = (page: unknown): string | null =>
  typeof page === 'string' ? '/' + publicSegments(page.split('/')).join('/') : null

/** A relay or host address as scheme + host + path: never a login, a query or
 *  a fragment, where an access code could ride. */
const safeUrl = (raw: unknown): string => {
  const text = String(raw ?? '').trim()
  try {
    const url = new URL(text)
    const path = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '')
    return `${url.protocol}//${url.host}${path}`
  } catch {
    return (text.split(/[?#]/)[0] ?? '').replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, '$1')
  }
}

// ── the parts ────────────────────────────────────────────────────────

const WALK_STRINGS = ['outcome'] as const

/** The debug() fields this read takes. One that is not there (an older
 *  package, a rename upstream) is NAMED in `debugMissing` and reads null —
 *  never an empty list, which would say "this tab never walked a page". */
const DEBUG_FIELDS = [
  'currentSig', 'subsCount', 'peerLayersCount', 'peerLayersBySig', 'walks', 'joinedAtMs',
  'firstAnnounce', 'inFlight', 'ownReplay', 'publishStats', 'stickyMode', 'lastSyncInput',
] as const

const swarmPart = (): Json => {
  const swarm = service<SwarmLike>(SWARM_KEY)
  if (!swarm) return { available: false }
  const debugAvailable = typeof swarm.debug === 'function'
  const debug = debugAvailable ? read(() => swarm.debug!()) : null
  const d: Json = isRecord(debug) && !isReadError(debug) ? debug : {}
  const lastSyncInput = isRecord(d['lastSyncInput']) ? d['lastSyncInput'] : null
  const peerLayers = isRecord(d['peerLayersBySig']) ? d['peerLayersBySig'] : null
  const walks = isRecord(d['walks']) ? d['walks'] : null
  const inFlight = isRecord(d['inFlight']) ? d['inFlight'] : null
  const firstAnnounce = isRecord(d['firstAnnounce']) ? d['firstAnnounce'] : null
  const tiles = read(() => swarm.peerTilesAtCurrentSig?.() ?? [])
  const names = (Array.isArray(tiles) ? tiles : [])
    .map(tile => isRecord(tile) ? String(tile['name'] ?? '').trim() : '')
    .filter(name => name.length > 0)
  return {
    available: true,
    debugAvailable,
    ...(isReadError(debug) ? { debugError: debug.error } : {}),
    debugMissing: debugAvailable && !isReadError(debug) ? DEBUG_FIELDS.filter(field => !(field in d)) : null,
    currentSig: typeof d['currentSig'] === 'string' ? d['currentSig'] : null,
    subsCount: typeof d['subsCount'] === 'number' ? d['subsCount'] : null,
    peerLayersCount: typeof d['peerLayersCount'] === 'number' ? d['peerLayersCount'] : null,
    peersBySig: peerLayers
      ? Object.fromEntries(Object.entries(peerLayers).map(([sig, bag]) =>
        [sig, isRecord(bag) && typeof bag['peerCount'] === 'number' ? bag['peerCount'] : null]))
      : null,
    // A list, not a map: two private pages mask to the same path. The drone
    // re-inserts a page on each walk, so the newest are LAST: keep those.
    walks: walks
      ? Object.entries(walks).slice(-CAP)
        .map(([page, stat]) => ({ page: publicPage(page), ...countersOf(stat, WALK_STRINGS) }))
      : null,
    walksCount: walks ? Object.keys(walks).length : null,
    firstAnnounce: firstAnnounce ? { ...countersOf(firstAnnounce), page: publicPage(firstAnnounce['page']) } : null,
    joinedAtMs: typeof d['joinedAtMs'] === 'number' ? d['joinedAtMs'] : null,
    inFlight: inFlight
      ? {
        pages: stringsOf(inFlight['pages']).map(publicPage),
        ...countersOf(inFlight),
        channel: publicPage(inFlight['channel']),
      }
      : null,
    ownReplay: countersOf(d['ownReplay']),
    publishStats: countersOf(d['publishStats']),
    stickyMode: typeof d['stickyMode'] === 'boolean' ? d['stickyMode'] : null,
    lastSyncInput: lastSyncInput ? { segments: publicSegments(stringsOf(lastSyncInput['segments'])) } : null,
    participantsAtCurrentSig: countOf(read(() => swarm.participantsAtCurrentSig?.())),
    participantsInZone: countOf(read(() => swarm.participantsInZone?.())),
    peerTilesAtCurrentSig: names,
    peerTilesAtCurrentSigCount: names.length,
  }
}

const meshPart = (): Json => {
  const connection = countersOf(lastOf('mesh:connection'), ['state', 'refused'])
  const mesh = service<MeshLike>(MESH_KEY)
  if (!mesh) return { available: false, connection }
  return {
    available: true,
    started: typeof mesh.started === 'boolean' ? mesh.started : null,
    stopped: typeof mesh.stopped === 'boolean' ? mesh.stopped : null,
    networkEnabled: read(() => mesh.isNetworkEnabled?.() ?? null),
    connection,
    // null = the field was not there to read (renamed upstream), never "none".
    relays: Array.isArray(mesh.relays) ? stringsOf(mesh.relays).map(safeUrl) : null,
    sockets: mesh.sockets instanceof Map
      ? [...mesh.sockets.entries()].map(([url, ws]) => ({
        url: safeUrl(url),
        readyState: isRecord(ws) && typeof ws['readyState'] === 'number' ? ws['readyState'] : null,
      }))
      : null,
    stats: countersOf(mesh.stats),
    relaysAddressed: read(() => mesh.relaysAddressed?.() ?? null),
    swarmHost: read(() => mesh.swarmHost?.() ?? null),
  }
}

const SYNC_STRINGS = ['host', 'status', 'state', 'reason', 'why', 'source'] as const
const syncWord = (value: unknown): Json | null => countersOf(value, SYNC_STRINGS)

/** A held branch, by name only when it is public: a segment of the page's
 *  shown path, or a public tile on the page. */
const blockedOf = (value: unknown, location: string, shown: readonly string[]): Json | null => {
  const b = countersOf(value, ['host', 'state', 'why'])
  if (!b || !isRecord(value)) return b
  const name = String(value['branch'] ?? '').trim()
  let isPublic = shown.includes(name)
  if (!isPublic && name) { try { isPublic = isCellPublic(location, name) } catch { isPublic = false } }
  return { branch: isPublic ? name : PRIVATE_MARK, ...b }
}

const sharePart = (zone: TabZone | null): Json => {
  const status = lastOf('swarm:share-status')
  let shareStatus: Json | null = null
  if (isRecord(status)) {
    const location = typeof status['location'] === 'string' ? status['location'] : ''
    const shown = publicSegments(location.split('/'))
    shareStatus = {
      ...countersOf(status, ['host', 'hostSource', 'hostState', 'reason', 'why']),
      location: '/' + shown.join('/'),
      hosts: stringsOf(status['hosts']),
      passedOver: stringsOf(status['passedOver']),
      ...(Array.isArray(status['blocked'])
        ? { blocked: status['blocked'].map(b => blockedOf(b, location, shown.filter(s => s !== PRIVATE_MARK))) }
        : {}),
    }
  }
  const byHost = Object.fromEntries([...syncByHost].map(([host, { word, heardAtMs }]) =>
    [host, { ...syncWord(word), heardAtMs }]))

  // The hosts this tab's bytes go to, as everything already said names them.
  const hosts = new Set<string>()
  const note = (host: unknown): void => {
    const clean = String(host ?? '').trim().toLowerCase()
    if (clean && hosts.size < CAP) hosts.add(clean)
  }
  if (isRecord(status)) { note(status['host']); stringsOf(status['hosts']).forEach(note) }
  note(zone?.host)
  for (const host of syncByHost.keys()) note(host)
  const hostSync = service<HostSyncLike>(HOST_SYNC_KEY)
  const troubleOf = hostSync?.hostTrouble
  const hostTrouble: Json = {}
  if (troubleOf) {
    for (const host of hosts) {
      const trouble = read(() => troubleOf.call(hostSync, host))
      hostTrouble[host] = isReadError(trouble) ? trouble
        : trouble === null || trouble === undefined ? null
        : countersOf(trouble, ['host', 'status', 'why', 'reason'])
    }
  }

  // Where this tab's bytes are configured to go, beside where they went.
  const targets = hostSync
    ? {
      backupEnabled: read(() => hostSync.isEnabled?.() ?? null),
      publicHostEnabled: read(() => hostSync.isPublicHostEnabled?.() ?? null),
      publicHostDomain: read(() => hostSync.publicHostDomain?.() ?? null),
      publishNodes: read(() => hostSync.publishNodes?.() ?? null),
    }
    : null

  return {
    shareStatus,
    syncState: syncWord(lastOf('sync:state')),
    syncByHost: byHost,
    hostTrouble,
    targets,
  }
}

const membershipPart = (zone: TabZone | null): Json => ({
  joined: isJoinedHere(),
  zone: zone
    ? {
      room: zone.room ?? null,
      relay: zone.relay ? safeUrl(zone.relay) : null,
      host: zone.host ?? null,
      hasSecret: !!zone.secret?.trim(),
      hasCode: !!zone.code?.trim(),
    }
    : null,
})

// ── the scrub ────────────────────────────────────────────────────────

/** A key that names a secret never carries a value out (a flag may). */
const SECRET_KEY_RE = /secret|passw|token|nsec|priv(?:ate)?_?key|privkey|bearer|authori[sz]ation|^code$|access_?code|api_?key|mnemonic|seed/i

const REDACTED = '[redacted]'

/** Fields built here from public names alone (publicSegments, a peer's
 *  published tile name): a long page path is not a long token, so the
 *  long-token rule leaves them whole. Every other rule still applies. */
const NAME_KEYS: ReadonlySet<string> = new Set(['page', 'pages', 'channel', 'location', 'segments', 'branch', 'peerTilesAtCurrentSig'])

/** FREE TEXT: words this tab did not write — a relay's refusal, a host's
 *  answer, a thrown error — which can echo anything, the secret included.
 *  Only these are searched for the tab's own secret and code. Every other
 *  string is a PICKED field that never carries them (a host, a relay
 *  address, a page path, a published name, a word from a fixed vocabulary),
 *  and searching it would only cut the secret out of a value the reader
 *  already knows — "[redacted].com" beside a banner saying jwize.com gives
 *  the secret back, and hides the very host being debugged. */
const FREE_TEXT_KEYS: ReadonlySet<string> = new Set(['reason', 'refused', 'error', 'debugError'])

/** Maps keyed by DATA (a host, a 12-hex sig), not by field names: the
 *  secret-name rule never applies to their keys — 'seedbank.social' is a
 *  host, and dropping it would say the host was fine. Their values are
 *  picked field by field, so the rule adds nothing there. */
const DATA_KEYED: ReadonlySet<string> = new Set(['syncByHost', 'hostTrouble', 'peersBySig', 'ownReplay'])

/** Whether `text` holds one of the (lower-cased) secrets. A short one counts
 *  only as a word of its own, so a 3-letter code does not withhold every
 *  reason that happens to spell it. */
const holdsSecret = (text: string, secrets: readonly string[]): boolean => {
  const lower = text.toLowerCase()
  return secrets.some(secret => secret.length >= 4
    ? lower.includes(secret)
    : new RegExp(`(^|[^a-z0-9])${secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(lower))
}

/** The shape rules: an nsec, a bridge code, a NIP-98 or Bearer token, long
 *  base64 — redacted wherever they appear; a 64-hex run cut to 12. */
const scrubShapes = (text: string, names: boolean): string => {
  let out = text
    .replace(/nsec1[0-9a-z]{20,}/gi, REDACTED)
    .replace(/hcb-[a-z2-7]{16,}/gi, REDACTED)
    .replace(/\bNostr\s+[A-Za-z0-9+/=_-]{8,}/g, `Nostr ${REDACTED}`)
    .replace(/\bBearer\s+[^\s"']+/gi, `Bearer ${REDACTED}`)
    .replace(/[0-9a-f]{64,}/gi, run => `${run.slice(0, SIG_SHOWN)}…`)
  if (!names) out = out.replace(/[A-Za-z0-9+/_-]{64,}={0,2}/g, REDACTED)
  return out.length > STRING_CAP ? `${out.slice(0, STRING_CAP)}…` : out
}

const scrubString = (text: string, secrets: readonly string[], key: string): string => {
  // Free text that holds the secret or the code is withheld WHOLE: a cut-out
  // would leave its position, and the text around it, to give it back.
  if (FREE_TEXT_KEYS.has(key) && holdsSecret(text, secrets)) return REDACTED
  // The room is the one picked name seeded from the same place as the secret
  // (the page's subdomain seeds both stores): equal to it, it is withheld
  // whole — a whole value, so nothing around it is left to read.
  if (key === 'room' && secrets.includes(text.trim().toLowerCase())) return REDACTED
  return scrubShapes(text, NAME_KEYS.has(key))
}

const scrub = (value: unknown, secrets: readonly string[], depth: number, key = '', dataKeyed = false): unknown => {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return scrubString(value, secrets, key)
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean') return value
  if (typeof value !== 'object') return null // a function, a symbol: never
  if (depth >= DEPTH_CAP) return '[deep]'
  if (Array.isArray(value)) {
    const out = value.slice(0, CAP).map(v => scrub(v, secrets, depth + 1, key))
    if (value.length > CAP) out.push(`… ${value.length - CAP} more`)
    return out
  }
  const out: Json = {}
  const entries = Object.entries(value)
  for (const [entryKey, v] of entries.slice(0, CAP)) {
    if (v === undefined || typeof v === 'function') continue
    if (!dataKeyed && SECRET_KEY_RE.test(entryKey) && typeof v !== 'boolean') continue
    out[scrubShapes(entryKey, false)] = scrub(v, secrets, depth + 1, dataKeyed ? '' : entryKey, !dataKeyed && DATA_KEYED.has(entryKey))
  }
  if (entries.length > CAP) out['…'] = `${entries.length - CAP} more`
  return out
}

/** The snapshot `swarm-debug` answers with — JSON, bounded, read-only, and
 *  with nothing in it a participant would not hand a stranger. */
export const swarmDebugSnapshot = (): Json => {
  const zone = readTabZone()
  const storeSecret = service<{ value?: unknown }>(SECRET_STORE_KEY)?.value
  const secrets = [zone?.secret, zone?.code, typeof storeSecret === 'string' ? storeSecret : '']
    .map(s => String(s ?? '').trim().toLowerCase())
    .filter(s => s.length > 0)
  const snapshot = {
    at: Date.now(),
    swarm: swarmPart(),
    mesh: meshPart(),
    share: sharePart(zone),
    membership: membershipPart(zone),
  }
  return scrub(snapshot, secrets, 0) as Json
}
