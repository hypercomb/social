// hypercomb-shared/ui/presence-banner/presence-status.ts
//
// THE ONE STATUS LINE — what the presence banner says, as data.
//
// A meeting failed because every state where nothing reached anyone looked
// the same: a joined participant with a dead socket, one whose host refused
// the upload, one whose tiles were all private, and one who was simply alone
// all saw a quiet strip and a toast that said "the upload is running". This
// module turns the four honest signals the modules now publish into one line
// that names the real state:
//
//   - 'mesh:connection'     (NostrMeshDrone)  — is the socket actually live?
//   - 'swarm:share-status'  (SwarmDrone)      — what is offered here, what is
//                                               only a name, what is private
//   - 'sync:state'          (HostSyncService) — does the page's upload host
//                                               take the bytes, and if not why
//   - the room roster                         — who is in the room, who is
//                                               on this page, who is away
//
// Pure: no Angular, no IoC, no clock of its own — the component feeds it and
// the spec drives it, so every state's exact words are pinned in one place.
// The parts are catalog KEYS (plus the two raw words, room and pair, which
// are the participant's own); the template pipes them through `t`.

import { lifecyclePreimage, meetingPointKey as corePointKey, secretTag } from '@hypercomb/core'

/** How long without an OPEN socket before "Reconnecting…" becomes
 *  "Can't reach <host>" — and the header glyph goes from amber to off. */
export const UNREACHABLE_AFTER_MS = 30_000

/** How long a STALLED socket — still OPEN, its liveness probe unanswered for
 *  1.5 s — reads as "Live · slow connection" rather than "Reconnecting": the
 *  rest of the mesh's 4 s probe deadline (nostr-mesh PROBE_DEADLINE_MS −
 *  STALL_AFTER_MS). Busy venue wifi answers in 2 s and never drops; past the
 *  deadline the mesh dials a replacement, and that is a reconnect. */
export const SLOW_FOR_MS = 2_500

/** How long the current page's word may go untaken by the relay (no NIP-01
 *  OK yet) before the line says "Sending…". */
export const SENDING_AFTER_MS = 3_000

/** NostrMeshDrone's `mesh:connection` payload. */
export interface MeshConnection {
  state?: string
  reopened?: boolean
  since?: number
  attempt?: number
  clockOffsetMs?: number
  /** Why the relay last refused us — a reason string, or `{ reason, at }`. */
  refused?: unknown
}

/** SwarmDrone's `swarm:share-status` payload — one per walked location.
 *  `host` is where THIS page's tiles go (its publish domains, else the hosts
 *  pool, else a relay that hosts participants — `hostSource` says which), and
 *  `hostState` what it last said; 'no-host' when nothing hosts them. An older
 *  swarm names no host: the relay was its host. */
export interface ShareStatus {
  location?: string
  offered?: number
  uploading?: number
  nameOnly?: number
  private?: number
  host?: string
  hosts?: readonly string[]
  hostSource?: string
  hostState?: string
  reason?: string
  /** Why `host` is not taking the bytes, as a person acts on it (host-sync's
   *  HostWhy: page, unresolved, refused, full, unreachable). */
  why?: string
  /** Branches a host takes none of the bytes of — named with the host and
   *  why, never counted as uploading (a publish domain that does not
   *  resolve, answers a page, refuses or is full). */
  blocked?: readonly BlockedBranch[]
  /** The hosts that keep this page's name-only tiles names, from the gate's
   *  own verdict (the blocking host of each child's closure), with how many
   *  tiles each holds back. Absent on an older swarm. */
  held?: readonly HeldHost[]
  /** Hosts passed over this session (refused, full, silent) — this page's,
   *  and its offered branches' at any depth (a publish domain that refuses,
   *  D2, worn by the branch itself or by a page below it — BCL-1). */
  passedOver?: readonly string[]
  /** Tiles the room can take whose deeper pages are still only on this
   *  device, a host still taking them (D1) — the sharer is asked to stay. */
  deepOnDevice?: number
  /** Whether the relay has taken this page's newest word (its NIP-01 OK). */
  taken?: boolean
  /** How long the oldest of this tab's own frames — this page's word, the
   *  beacon — has gone untaken, as of this status (0: all taken). The age
   *  the line counts "Sending…" from: a status said again never restarts it. */
  unackedMs?: number
}

/** One host that holds tiles back as names (SwarmDrone share-status held). */
export interface HeldHost {
  host?: string
  /** refused · never-answered · too-large · full · unreachable · … */
  state?: string
  reason?: string
  /** How many of this page's tiles it holds back. */
  count?: number
  names?: readonly string[]
  /** The tiles CAN be taken; only their deeper pages are held (they open
   *  from this device while it is in the room — D1). Never "stay names". */
  deep?: boolean
}

/** One branch a host holds (SwarmDrone #blockedBranches). */
export interface BlockedBranch {
  branch?: string
  host?: string
  state?: string
  why?: string
}

/** HostSyncService's `sync:state` payload — swarm hosts' only (the component
 *  drops other targets' reports: a backup is not what the room fetches from),
 *  and the page's own host's when the share status names one. `missing`
 *  counts closure refs no store here holds. */
export interface SyncState {
  state?: string
  status?: string
  reason?: string
  host?: string
  swarm?: boolean
  source?: string
  missing?: number
  /** Why it is not taking the bytes (host-sync's HostWhy). */
  why?: string
}

export type LinkPhase = 'connecting' | 'open' | 'reconnecting' | 'down'

/** The socket as a person reads it. `downSince` is when the tab last stopped
 *  having an OPEN socket (the component keeps it — the mesh's own `since`
 *  restarts on every state change); `wasOpen` tells a first connect from a
 *  reconnect. Every non-open state — connecting, stalled, retrying, and the
 *  mesh's 'offline' (which it also reports for the instant between a join
 *  and its first dial) — reads as coming back until 30 s have passed with no
 *  live socket, then as "can't reach". Null when no `mesh:connection` was
 *  ever heard: an older essentials package, and the banner keeps its old
 *  rendering. */
export function linkPhase(
  conn: MeshConnection | null,
  downSince: number | null,
  now: number,
  wasOpen: boolean,
): LinkPhase | null {
  if (!conn) return null
  if (conn.state === 'open') return 'open'
  if (downSince !== null && now - downSince >= UNREACHABLE_AFTER_MS) return 'down'
  return wasOpen || conn.reopened ? 'reconnecting' : 'connecting'
}

/** The relay's standing refusal, as a reason word ('' when none). */
export function refusalOf(conn: MeshConnection | null): string {
  const r = conn?.refused
  const reason = typeof r === 'string' ? r : (r as { reason?: unknown } | null | undefined)?.reason
  return typeof reason === 'string' ? reason : ''
}

/** The relay refused our events because this device's clock is far off. */
export function clockRefused(conn: MeshConnection | null): boolean {
  return /clock/i.test(refusalOf(conn))
}

/** A socket that is still OPEN but slow to answer its probe: 'stalled' for
 *  less than SLOW_FOR_MS. It is live — the line says "slow connection", never
 *  "Reconnecting" (which a working socket on busy wifi flickered every 10-20
 *  s). `now` is the caller's clock; a clock older than the stall reads young. */
export function slowLink(conn: MeshConnection | null, now: number): boolean {
  if (conn?.state !== 'stalled') return false
  const since = typeof conn.since === 'number' && conn.since > 0 ? conn.since : now
  return now - since < SLOW_FOR_MS
}

/** The header glyph's three states, by the line's own rules: an OPEN socket
 *  slow to answer is live (never the amber reconnect — TS-6), and a standing
 *  refusal no wait cures (the meeting point wants the current code, or names
 *  a computer's own relay this page cannot reach) is down at once, not after
 *  UNREACHABLE_AFTER_MS of amber. null until the mesh has said anything. */
export function headerLink(conn: MeshConnection | null, downSince: number | null, now: number): 'open' | 'pending' | 'down' | null {
  const phase = linkPhase(conn, downSince, now, true)
  if (!phase) return null
  if (phase === 'open' || slowLink(conn, now)) return 'open'
  const refused = refusalOf(conn)
  if (refused === 'access' || refused === 'unreachable' || refused === 'no-host') return 'down'
  return phase === 'down' ? 'down' : 'pending'
}

/** hypercomb.com, the open always-online meeting point (nostr-mesh
 *  LIVE_RELAY, core SHIPPED_MEETING_POINT) — offered, never a default
 *  (2026-10-11). It is named here only for a package from before 2026-10-12,
 *  whose words left it out (D4); jwize.com, that package's default before
 *  2026-10-11, is a host like any other. Keep in step with LIVE_RELAY
 *  (doctrine.spec and status.truth.spec hold them together). */
export const SHIPPED_POINT = 'hypercomb.com'

/** A host as the room's identity folds it — core meetingPointKey: its
 *  host[:port], lowercase, from a relay URL or a bare name
 *  ('wss://Point.example/' → 'point.example', 'ws://localhost:7896' →
 *  'localhost:7896'). '' for an empty field: there is no default host, and
 *  no host is no room (2026-10-11). Never the page's own domain. */
export function meetingPointKey(point: string): string {
  return corePointKey(point)
}

/** THE WORDS WITH THEIR HOST BESIDE THEM — 'marble cove · hypercomb.com'
 *  (jwize, 2026-10-11): wherever the room's two words show, the host they
 *  were drawn at shows with them, so two tabs reading different words can
 *  see at once that they named two hosts. The host is the one in the
 *  preimage (meetingPointKey) — never the page's own domain. The words
 *  alone when no host is named; '' when there are no words. */
export function wordsAtHost(words: string, point: string): string {
  const host = corePointKey(point)
  return words && host ? `${words} · ${host}` : words
}

/** THE ROOM IDENTITY THE LOADED SWARM DERIVES ITS ADDRESSES WITH — read
 *  synchronously from the swarm in this page (`SwarmDrone.roomIdentity`),
 *  never asked of anyone and never carried anywhere. 2 since 2026-10-12: the
 *  meeting point + room + secret (core lifecyclePreimage). A package from
 *  before has no marker and hashes `lifecycle \0 room \0 secret` — the
 *  point folded into the WORDS only, and only when it is not the default
 *  (D4). The shell and the package update apart, so the words follow the
 *  package that actually addresses the room: a pair is the readable form of
 *  the address this tab meets at, or it is no check at all. With no swarm
 *  loaded yet, the current identity. */
export const ROOM_IDENTITY = 2
const SWARM_KEY = '@diamondcoreprocessor.com/SwarmDrone'
export function loadedRoomIdentity(): number {
  try {
    const swarm = (globalThis as { ioc?: { get?: (key: string) => unknown } }).ioc?.get?.(SWARM_KEY) as
      | { roomIdentity?: unknown } | null | undefined
    if (!swarm || typeof swarm !== 'object') return ROOM_IDENTITY
    return typeof swarm.roomIdentity === 'number' ? swarm.roomIdentity : 1
  } catch { return ROOM_IDENTITY }
}

/** The text a room's words are drawn from, as `identity` derives it — ''
 *  when that identity has no room without a host. */
function wordsPreimage(room: string, secret: string, point: string, identity: number): string {
  if (identity >= 2) return lifecyclePreimage(room, secret, point)
  // Before 2026-10-12 (D4): the address had no point, and the words folded
  // one only when it was not the shipped default. That package meets at its
  // own default with no host named, so its words need none.
  const p = corePointKey(point)
  return p && p !== SHIPPED_POINT ? `lifecycle\0${room}\0${secret}\0${p}` : `lifecycle\0${room}\0${secret}`
}

/** THE ROOM'S TWO WORDS — the readable form of the room's address (jwize,
 *  2026-10-12: "host+location+secret, gen keywords from those"): drawn from
 *  the room's lifecycle preimage, `lifecycle \0 room \0 secret \0 host`
 *  (core lifecyclePreimage), the one roster every member of the room beacons
 *  on. Same host + room + secret ⇔ the same pair ⇔ they meet; the same room
 *  text at two hosts is two rooms with two pairs. NO HOST, NO WORDS: with no
 *  host named there is no room (there is no default host, 2026-10-11).
 *  Never the page — its own domain, its path: everyone in one room reads the
 *  same pair wherever they stand and can check it out loud. Always from the
 *  ENGLISH list, whatever the reader's language: a bilingual room compares
 *  one pair out loud (the localized pair may be shown beside it —
 *  `wordsBeside`). Empty when there is no room at all. `identity` is the
 *  loaded swarm's (loadedRoomIdentity): an older package's room reads the
 *  pair of the address that package meets at. */
export function roomWords(room: string, secret: string, point = '', identity = loadedRoomIdentity()): string {
  const r = String(room ?? '').trim()
  const s = String(secret ?? '').trim()
  if (!r && !s) return ''
  const text = wordsPreimage(r, s, point, identity)
  return text ? secretTag(text, 'en') : ''
}

/** The comparison words with the reader's own pair beside them when their
 *  language has its own list: 'light moss (うるわしい しま)'. */
export function wordsBeside(room: string, secret: string, point = '', locale = 'en', identity = loadedRoomIdentity()): string {
  const words = roomWords(room, secret, point, identity)
  if (!words || !locale || locale === 'en') return words
  const local = secretTag(wordsPreimage(String(room ?? '').trim(), String(secret ?? '').trim(), point, identity), locale)
  return local && local !== words ? `${words} (${local})` : words
}

/** Damerau-Levenshtein (optimal string alignment) distance, capped: returns
 *  max + 1 as soon as the rows prove it is larger. */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  const rows: number[][] = [Array.from({ length: b.length + 1 }, (_, j) => j)]
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let d = Math.min(rows[i - 1]![j]! + 1, row[j - 1]! + 1, rows[i - 1]![j - 1]! + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, rows[i - 2]![j - 2]! + 1)
      row.push(d)
      if (d < best) best = d
    }
    if (best > max) return max + 1
    rows.push(row)
  }
  return rows[a.length]![b.length]!
}

/** "did you mean hypercomb.com?" — the nearest known host within two edits
 *  (a swap counts as one) of a host that never answered. Local only: the
 *  candidates are hosts this device already knows. '' when none is close. */
export function didYouMean(host: string, known: readonly string[]): string {
  const h = String(host ?? '').trim().toLowerCase()
  if (!h) return ''
  let best = ''
  let bestD = 3
  for (const raw of known) {
    const k = String(raw ?? '').trim().toLowerCase()
    if (!k || k === h) continue
    const d = editDistance(h, k, 2)
    if (d < bestD) { best = k; bestD = d }
  }
  return best
}

/** One piece of the line: a catalog key (with params), or the
 *  participant's own text (room, word pair). `action` makes it a button:
 *  invite hands out the meeting link, share offers the private tiles here,
 *  code opens the selector on the access code (a recycled meeting link). */
export interface StatusPart {
  key?: string
  params?: Record<string, string | number>
  text?: string
  action?: 'invite' | 'share' | 'code' | 'host'
}

export interface StatusLine {
  /** live = all is well; warn = something is held or coming back; down =
   *  the meeting point cannot be reached. */
  tone: 'live' | 'warn' | 'down'
  parts: StatusPart[]
  /** The phone's collapsed form — the counts beside the dot. */
  compact: string
  /** True when nothing on the line asks for attention, so a phone may fold
   *  it to the dot and the counts. */
  quiet: boolean
}

export interface StatusInput {
  phase: LinkPhase
  /** The relay this tab meets at as a person reads it (`jwize.com`),
   *  already resolved to a readable stand-in by the caller when there is
   *  none — what the connection lines name. */
  host: string
  /** The host THIS page's tiles go to (the share status's `host`) — what the
   *  upload lines name. Empty: the relay, as an older swarm had it. */
  uploadHost?: string
  room: string
  /** The room's words as shown — with their host beside them
   *  (`wordsAtHost`: 'marble cove · hypercomb.com'). */
  words: string
  /** Everyone live in the room, you included. */
  roomCount: number
  /** Everyone standing on this page — you included once the relay has taken
   *  your word for it (until then you are on your way, not here). */
  hereCount: number
  /** This page's share status, when the swarm has walked it. */
  share: ShareStatus | null
  sync: SyncState | null
  /** Peers whose essentials cannot share with this one until they update. */
  older: number
  clockOff: boolean
  /** The last refusal the relay gave an event (other than rate limits,
   *  which the mesh retries itself); '' when none is current. */
  rejected: string
  /** The relay's standing refusal of the connection (refusalOf): 'access',
   *  'unreachable', 'no-host', 'subscriptions', 'clock' — '' or absent when
   *  none. */
  refused?: string
  /** The meeting point this tab is joined at, as named ('' = none named in
   *  its zone) — what the 'unreachable' line names when the page cannot dial
   *  it. */
  point?: string
  /** The socket is open but slow to answer (slowLink). */
  slow?: boolean
  /** This page's newest word has gone untaken for SENDING_AFTER_MS. */
  sending?: boolean
  /** Hosts this device knows (the pool, the page's hosts, every host it has
   *  heard from) — what a never-answering name is checked against. A
   *  function is read only when a host on the line never answered. */
  knownHosts?: readonly string[] | (() => readonly string[])
  /** The names of members whose tiles here can be taken while their deeper
   *  pages are still only on their device (deep: 'owner', D1). */
  deepOwners?: readonly string[]
}

/** Host answers that keep a participant's tiles name-only, by catalog key. */
const HOST_HELD: Readonly<Record<string, string>> = {
  'no-host': 'swarm.share.no-host',
  'refused': 'swarm.share.refused',
  'full': 'swarm.share.full',
  'too-large': 'swarm.share.too-large',
  'unreachable': 'swarm.share.unreachable',
  // A host no HTTP status ever came from (a name that does not resolve):
  // as unreachable, with the near-miss spelling offered beside it.
  'never-answered': 'swarm.share.unreachable',
  'not-live': 'swarm.share.not-live',
}

/** A branch a host holds, by why, by catalog key: "<branch>: <host> …". */
const BRANCH_HELD: Readonly<Record<string, string>> = {
  'unresolved': 'swarm.share.branch.unresolved',
  'page': 'swarm.share.branch.page',
  'refused': 'swarm.share.branch.refused',
  'full': 'swarm.share.branch.full',
  'unreachable': 'swarm.share.branch.unreachable',
}

/** A host that has never answered (a name that does not resolve, the
 *  `hyperccomb.com` typo) is the one a near-miss spelling is offered for. */
const NEVER_ANSWERED = new Set(['never-answered', 'unresolved'])

const branchPart = (b: BlockedBranch): StatusPart => ({
  key: BRANCH_HELD[String(b.why ?? '')] ?? BRANCH_HELD[String(b.state ?? '')]
    ?? (NEVER_ANSWERED.has(String(b.why ?? b.state ?? '')) ? BRANCH_HELD['unresolved'] : BRANCH_HELD['unreachable']),
  params: { branch: String(b.branch ?? ''), host: String(b.host ?? '') },
})

/** A host holding tiles back as names, by its state, by catalog key:
 *  "<host> … — N tiles stay names". */
const HELD_HOST: Readonly<Record<string, string>> = {
  'refused': 'share.held.refused',
  'not-live': 'share.held.refused',
  'page': 'share.held.refused',
  'never-answered': 'share.held.never-answered',
  'unresolved': 'share.held.never-answered',
  'too-large': 'share.held.too-large',
  'full': 'share.held.full',
}
/** Which held host the line names when several do: the one holding the
 *  most tiles, then the one least likely to come back by itself. */
const HELD_RANK: Readonly<Record<string, number>> = { 'never-answered': 5, 'unresolved': 5, 'refused': 4, 'page': 4, 'not-live': 3, 'full': 2, 'too-large': 1 }

const count = (n: unknown): number => {
  const v = Number(n)
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0
}

/** "did you mean …?" after a host that never answered, when a host this
 *  device knows is within two edits of it. */
const nearMiss = (host: string, state: string, known: StatusInput['knownHosts']): StatusPart[] => {
  if (!NEVER_ANSWERED.has(state)) return []
  const near = didYouMean(host, (typeof known === 'function' ? known() : known) ?? [])
  return near ? [{ key: 'share.held.did-you-mean', params: { host: near } }] : []
}

/** A meeting point as a person reads it: the default scheme dropped, a
 *  computer's own ws:// kept (it is the whole point of the line). */
const pointText = (point: string): string => String(point ?? '').trim().replace(/^wss:\/\//i, '').replace(/\/+$/, '')

export function statusLine(i: StatusInput): StatusLine {
  const host = i.host
  // The upload lines name where the bytes go, never the meeting point.
  const upload = i.uploadHost || host
  const parts: StatusPart[] = []
  let tone: StatusLine['tone'] = 'live'
  const refused = String(i.refused ?? '')

  if (refused === 'access' && i.phase !== 'open') {
    // The meeting point closed 4401: this tab's access code is not its
    // current one (the operator recycled it, or the link is old). No wifi
    // fixes that, and waiting 30 s first only hides it — say so at once,
    // with the one remedy: the newest meeting link (or its code).
    parts.push({ key: 'mesh.state.access', params: { host } }, { key: 'mesh.state.access-action', action: 'code' })
    tone = 'down'
  } else if (refused === 'no-host' && i.phase !== 'open') {
    // Joined with no host named (there is no default, 2026-10-11): no room,
    // no words, nothing to dial. Said at once, with the one remedy — the
    // host field — never "connecting" for ever.
    parts.push({ key: 'mesh.state.no-host' }, { key: 'mesh.state.no-host-action', action: 'host' })
    tone = 'down'
  } else if (refused === 'unreachable' && i.phase !== 'open') {
    // Joined at a meeting point this page may not dial (a computer's own
    // ws://localhost relay, opened from a real host): it meets nowhere.
    parts.push({ key: 'mesh.state.unreachable-local', params: { relay: pointText(i.point || host) } })
    tone = 'down'
  } else if (i.phase === 'connecting') {
    parts.push({ key: 'mesh.state.connecting', params: { host } })
    tone = 'warn'
  } else if (i.phase === 'reconnecting') {
    parts.push({ key: 'mesh.state.reconnecting' })
    tone = 'warn'
  } else if (i.phase === 'down') {
    parts.push({ key: 'mesh.state.unreachable', params: { host } })
    tone = 'down'
  } else {
    parts.push({ key: 'mesh.state.live' })
    // Slow, not gone: the socket is open and answers late. Said, never as
    // "Reconnecting", and the tone stays live.
    if (i.slow) parts.push({ key: 'mesh.state.slow' })
    if (i.room) parts.push({ text: i.room })
    if (i.words) parts.push({ text: i.words })
    if (i.roomCount <= 1) {
      parts.push({ key: 'presence.room-alone' }, { key: 'presence.room-invite', action: 'invite' })
    } else {
      parts.push({ key: 'presence.room-count', params: { count: i.roomCount, here: Math.max(0, Math.floor(i.hereCount)) } })
    }
    // The relay has not taken this page's word yet: peers do not see you
    // here, whatever the socket says.
    if (i.sending) {
      parts.push({ key: 'mesh.state.sending' })
      tone = 'warn'
    }
    // The meeting point takes no more listeners on this socket: the room is
    // partly deaf here until the tab reloads.
    if (refused === 'subscriptions') {
      parts.push({ key: 'mesh.state.subscriptions' })
      tone = 'warn'
    }

    // What THIS participant is offering here — only meaningful while the
    // socket is live; a dead socket offers nothing, and says so above.
    // The host's LIVE word wins over the walk's snapshot of it: the snapshot
    // is as old as the last walk, and a recovered host must clear the line
    // at once. A picture too large for the host is one file's fate, never
    // the page's: it is said beside the counts, not instead of them.
    const share = i.share
    const hostWord = i.sync ? (i.sync.state ?? i.sync.status ?? '') : (share?.hostState ?? '')
    const tooLarge = hostWord === 'too-large'
    const held = tooLarge ? undefined : HOST_HELD[hostWord]
    // A BRANCH A HOST HOLDS is named — the branch, the host, and why (a name
    // that does not resolve, a page where a heap belongs, a refusal) —
    // instead of reading as "uploading" for ever. This page's own host is
    // named so only while its live word still holds it.
    const blocked = (share?.blocked ?? []).filter(b => !!b?.branch && !!b.host && (b.host !== upload || !!held))
    const own = held ? blocked.find(b => b.host === upload) : undefined
    // Hosts already named on the line — a later part never names one twice.
    const named = new Set<string>()
    if (held) {
      // Names only — the count would promise more than the room receives.
      // The host's live why beats the walk's snapshot of it.
      const why = String(i.sync?.why || own?.why || hostWord)
      parts.push(own ? branchPart({ ...own, why: i.sync?.why || own.why }) : { key: held, params: { host: upload } }, ...nearMiss(upload, why, i.knownHosts))
      named.add(upload)
      tone = 'warn'
    } else {
      if (share && count(share.offered) > 0) {
        parts.push(count(share.uploading) > 0
          ? { key: 'swarm.share.uploading', params: { count: count(share.offered), uploading: count(share.uploading) } }
          : { key: 'swarm.share.sharing', params: { count: count(share.offered) } })
      }
      // WHO HOLDS THE NAMES (TS-1/BCL-2): the gate's own verdict names the
      // host each name-only child waits on — a publish domain below a branch
      // that refuses, never answered or is full, while this page's own host
      // is fine. The worst of them is named, with how many tiles it holds
      // back, instead of the page reading "uploading" in the all-is-well
      // tone for ever.
      const heldHosts = (share?.held ?? []).filter(h => !!h?.host && count(h.count) > 0)
      const worstOf = (groups: readonly HeldHost[]): HeldHost | undefined => [...groups].sort((a, b) =>
        count(b.count) - count(a.count) || (HELD_RANK[String(b.state ?? '')] ?? 0) - (HELD_RANK[String(a.state ?? '')] ?? 0))[0]
      const worst = worstOf(heldHosts.filter(h => h.deep !== true))
      if (worst) {
        const state = String(worst.state ?? '')
        parts.push({ key: HELD_HOST[state] ?? 'share.held.not-here', params: { host: String(worst.host), count: count(worst.count) } }, ...nearMiss(String(worst.host), state, i.knownHosts))
        named.add(String(worst.host))
        tone = 'warn'
      }
      // Tiles the room CAN take whose deeper pages a host is not taking:
      // never "stay names" — they open from this device while it is here.
      const deepWorst = worstOf(heldHosts.filter(h => h.deep === true && !named.has(String(h.host))))
      if (deepWorst) {
        parts.push({ key: 'share.held.deep', params: { host: String(deepWorst.host), count: count(deepWorst.count) } }, ...nearMiss(String(deepWorst.host), String(deepWorst.state ?? ''), i.knownHosts))
        named.add(String(deepWorst.host))
        tone = 'warn'
      }
      // THE SHARER IS TOLD TOO (BCL-3, D1): tiles the room can take whose
      // deeper pages a host is still taking — only this device has them yet,
      // so leaving now leaves the takers blank pages. Said while no host
      // refuses them (that is the line above), never in the all-is-well tone.
      const onDevice = count(share?.deepOnDevice)
      if (onDevice > 0 && !heldHosts.some(h => h.deep === true)) {
        parts.push({ key: 'share.held.on-device', params: { count: onDevice } })
        tone = 'warn'
      }
      // Name-only tiles whose closure reaches content no store here holds
      // and no host serves: they stay names until someone who holds it shares.
      const notHeld = /missing|not-held/.test(share?.reason ?? '') || count(i.sync?.missing) > 0
      if (share && notHeld && count(share.nameOnly) > 0) {
        parts.push({ key: 'swarm.share.not-held', params: { count: count(share.nameOnly) } })
        tone = 'warn'
      } else if (share && !worst && blocked.length === 0 && count(share.nameOnly) > 0 && count(share.uploading) === 0) {
        // Names, and nothing on its way for them: never "uploading".
        parts.push({ key: 'share.names-only', params: { count: count(share.nameOnly) } })
        tone = 'warn'
      }
      if (tooLarge) {
        parts.push({ key: HOST_HELD['too-large'], params: { host: upload } })
        tone = 'warn'
      }
    }
    for (const b of blocked) {
      if (b === own || named.has(String(b.host))) continue
      parts.push(branchPart(b), ...nearMiss(String(b.host), String(b.why || b.state || ''), i.knownHosts))
      named.add(String(b.host))
      tone = 'warn'
    }
    // Hosts passed over — this page's, and its branches' at any depth (a
    // publish domain that refuses or never answered, D2/BCL-1): said
    // whenever there is one, also once the tiles went by the pool and can be
    // taken, so a mistyped domain never reads as the one hosting the branch.
    const passed = [...new Set((share?.passedOver ?? []).map(String))].filter(h => !!h && !named.has(h))
    if (share && passed.length > 0) {
      parts.push({ key: 'share.passed-over', params: { host: passed.join(', '), count: passed.length } })
    }
    if (share && count(share.private) > 0) {
      parts.push(
        { key: 'swarm.share.private', params: { count: count(share.private) } },
        { key: 'swarm.share.offer', action: 'share' },
      )
    }
    // A RECEIVER is told when a branch here opens its deeper pages from
    // its sharer's device alone (D1): they go blank if that sharer leaves
    // before the upload lands, and nothing else would say why.
    const owners = (i.deepOwners ?? []).map(String).filter(Boolean)
    if (owners.length > 0) parts.push({ key: 'share.deep-owner', params: { name: owners.join(', ') } })
    if (i.older > 0) {
      parts.push({ key: 'presence.room-older', params: { count: i.older } })
      tone = 'warn'
    }
    if (i.rejected) {
      parts.push({ key: 'mesh.state.rejected', params: { host, reason: i.rejected } })
      tone = 'warn'
    }
  }

  // A far-off clock is the cause of everything else on the line — always say it.
  if (i.clockOff) {
    parts.push({ key: 'mesh.state.clock' })
    if (tone === 'live') tone = 'warn'
  }

  const compact = i.phase === 'open' ? `${i.roomCount} (${Math.max(0, Math.floor(i.hereCount))})` : ''
  const quiet = tone === 'live' && !parts.some(p => p.action)
  return { tone, parts, compact, quiet }
}
