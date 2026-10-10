// nostr/nostr-mesh.drone.ts
//
// Live bootstrap relay (wss://jwize.com) shipped 2026-05-29; default-ON
// for real hosts since 2026-06-10 (see LIVE_RELAY notes below). Local
// origins seed the loopback dev relay instead; hc:nostrmesh:use-live-relay
// ('1'/'0') and hc:nostrmesh:relays override.
import { Drone } from '@hypercomb/core'
import { isJoinedHere } from './membership.js'

const LOCAL_RELAY = 'ws://localhost:7777'
// Live bootstrap relay.
//
// ⚠️ This constant is referenced in EXACTLY ONE runtime branch — the
// seed expression in `loadRelays()` below. Keep it that way so the
// relay policy stays auditable in one place.
//
// Policy (since 2026-06-10): real hosts seed LIVE_RELAY by DEFAULT.
// A deployed origin must never dial loopback — nothing listens on a
// visitor's machine, and a public origin touching localhost trips
// Chrome's Local Network Access permission prompt at page open.
// Local origins seed LOCAL_RELAY for the self-contained dev loop.
//
//   localStorage['hc:nostrmesh:use-live-relay'] = '1'   force LIVE_RELAY
//   localStorage['hc:nostrmesh:use-live-relay'] = '0'   opt out (real host
//                                                       idles, no loopback)
//   localStorage['hc:nostrmesh:relays']        = '[…]'  manual override, wins
const LIVE_RELAY = 'wss://jwize.com'

// Force the literal into the bundle via a globalThis assignment.
// esbuild treats global property writes as side effects and will not
// DCE them. Multiple gentler anchors (exported const, frozen object,
// IIFE) were insufficient — the constant kept getting tree-shaken out
// when the loadRelays ternary's LIVE_RELAY branch was optimized away.
// A globalThis write is the bluntest object esbuild won't touch.
//
// Bracket access: strict TS (`noPropertyAccessFromIndexSignature`)
// forbids dot-access on `Record<string, unknown>` types.
;(globalThis as Record<string, unknown>)['__HYPERCOMB_RELAYS__'] = Object.freeze({
  local: LOCAL_RELAY,
  live: LIVE_RELAY,
})

type NostrEvent = { id?: string; pubkey?: string; created_at: number; kind: number; tags: string[][]; content: string; sig?: string }
type MeshEvt = { relay: string; sig: string; event: NostrEvent; payload: any }
type MeshCb = (e: MeshEvt) => void
type MeshSub = { close: () => void }

// sinceSec — the REQ replay window for this bucket. undefined = the 15-min
// default (live-ish kinds: presence, shares — a short catch-up is all they
// need). A store-and-forward consumer (the feedback channel) passes a wider
// window so a relay REPLAYS stored events published while it was offline;
// null = no `since` filter at all (relay retention decides).
//
// seen — the ids THIS bucket has delivered. Dedup used to be one set for the
// whole mesh, never cleared: a visuals probe that opened a bucket at a page
// first ate the relay's replay of every peer layer there, and the swarm's own
// subscription at that page later had the same ids dropped as duplicates —
// an empty page until each publisher's next refresh. Per bucket, and cleared
// on every reopen, so a replay always reaches the consumer that asked for it.
//
// closedN — consecutive CLOSED refusals; the retry waits 1 s · 2^n (cap 30 s)
// and an EOSE resets it.
type Bucket = {
  sig: string
  subId: string
  cbs: Set<MeshCb>
  sinceSec?: number | null
  seen: Set<string>
  closedN: number
  retryTimer?: ReturnType<typeof setTimeout>
}

// An EVENT frame on its way to the relays. slot is kind\0d for the
// parameterized-replaceable range (30000-39999): one slot holds one current
// event per key, so a newer publish to it supersedes any older frame still
// queued or awaiting its OK. exp is the frame's NIP-40 expiration in relay
// seconds; queuedAtMs is when the frame first entered the mesh (its TTL).
// `slot` is the relay's replaceable slot (kind\0d). `lane` is that slot AT
// its address (slot\0x): what a newer frame may supersede while it waits. A
// {left} in one room and the {alive} in the next share a slot but not a
// lane — the {left} is for the old room's listeners and must still go out.
type Outbound = { frame: string; id: string; kind: number; slot?: string; lane?: string; exp?: number; createdAt: number; queuedAtMs: number }
// An EVENT sent on one relay's socket and not yet answered with an OK.
type Inflight = Outbound & { relay: string; sentAtMs: number; attempts: number; timer?: ReturnType<typeof setTimeout> }
// What the watchdog knows about one socket. openedAtMs/healthy: the socket
// has proved itself (answered a probe, or stayed open 30 s) and the ladder
// starts again from 0. buffered/bufferedMovedMs: the last bufferedAmount seen
// and when it last went down. suspectAtMs: the probe deadline passed and a
// replacement is being dialled while this socket keeps its place.
// admitted: the socket may be announced as open — at once for a plain dial;
// for one that offered an access code, only once the relay has said anything
// on it (a meeting point that refuses the code closes before its first frame).
// code: the access code this socket offered ('' = none).
type Liveness = {
  createdAtMs: number; connectTimeoutMs: number; lastInboundMs: number; probeSentAtMs: number; probeDeadlineMs: number
  openedAtMs: number; healthy: boolean; buffered: number; bufferedMovedMs: number; suspectAtMs: number
  admitted: boolean; code: string
}

/** The mesh's connection, announced as `mesh:connection` on every
 *  transition (last-value replay). open — a socket is OPEN and answering;
 *  stalled — every OPEN socket has left a liveness probe unanswered for
 *  1.5 s; retrying — no OPEN socket after having had one (or after a failed
 *  first attempt); connecting — the first attempt is in flight; offline —
 *  not joined, stopped, or no relay this tab may dial. reopened is true on
 *  exactly ONE payload: the one a socket's open sends when an earlier socket
 *  had been open — the relay may have marked this key away or restarted
 *  empty, so the swarm reasserts. Every later payload (a stall answered on
 *  the same socket, a refusal set or cleared, a clock card) carries false: it
 *  is an edge, never a level, or a slow probe would replay the whole room.
 *  refused names a standing
 *  relay refusal: 'clock' (created_at too far in the future),
 *  'subscriptions' (too many subscriptions), 'access' (the meeting point
 *  closed 4401: this tab's access code is not its current one) or
 *  'unreachable' (this tab is joined at a meeting point this page may not
 *  dial — a loopback one from a real host — so it meets nowhere). */
export type MeshConnectionState = 'connecting' | 'open' | 'stalled' | 'retrying' | 'offline'
export type MeshConnection = { state: MeshConnectionState; reopened: boolean; since: number; attempt: number; clockOffsetMs: number; refused?: string }

// ── liveness and reconnect (2026-10-04) ──────────────────────────────────────
// The client used to have no idea whether it was connected: a half-open
// socket (phone lock, wifi roam, a tunnel edge lost) stayed OPEN while every
// publish "succeeded" into the void, and peers evicted us. Now:
//   - every inbound frame stamps the socket; after 10 s of silence (30 s
//     hidden) one probe goes out — a REQ on a fixed subId routed by #x, so it
//     replaces itself and never joins a fan-out — and a socket that answers
//     nothing within 4 s is retired;
//   - an EVENT left without its OK for 5 s, with nothing heard since it went
//     out, triggers the same probe (never a kill outright);
//   - nothing is judged while bytes queued on the device are still draining
//     (bufferedAmount going down) or on a tick that ran more than 1 s late —
//     silence then proves nothing. A buffer that has not gone down for 15 s
//     is a path that stopped taking bytes, and is judged like any other;
//   - MAKE BEFORE BREAK: a socket that misses its probe deadline keeps its
//     place while a replacement dials (at the ladder's next step). Whichever
//     speaks first wins: the replacement's open retires the old socket, any
//     frame on the old one drops the replacement. A live socket behind our
//     own uploads (a slow uplink queues the probe behind megabytes of PUTs)
//     is therefore never torn down for being slow, and a dead one is replaced
//     as fast as before; one that stays silent 12 s past its deadline is
//     retired even if no replacement has opened;
//   - a socket stuck CONNECTING is cut after 8 s, then 12 s, then 20 s:
//     a slow phone handshake gets more time, never less;
//   - online, a tab coming back to view, and pageshow probe an OPEN socket
//     with a 3 s deadline, and dial any other relay at once;
//   - the reconnect ladder is 0, 250 ms, 500 ms, 1 s, 2 s, 4 s with 0-30%
//     jitter taken off the step (so the cap holds), capped at 4 s while
//     visible and 15 s while hidden. It starts again from 0 only once a
//     socket has PROVED itself — answered a probe, or stayed open 30 s — so
//     a path that opens and then goes silent (a middlebox, a relay drowning
//     in a reconnect burst) climbs the ladder instead of redialling at once
//     forever.
// Detection: ≤ 15 s idle, ≤ 9 s after a publish, ≤ 3 s after a wake. Cost:
// at most 6 probe frames a minute on an idle socket, none while traffic flows.
const LADDER_MS = [0, 250, 500, 1_000, 2_000, 4_000]
const LADDER_CAP_HIDDEN_MS = 15_000
const CONNECT_TIMEOUTS_MS = [8_000, 12_000, 20_000]
const TICK_VISIBLE_MS = 1_000
const TICK_HIDDEN_MS = 5_000
const LATE_TICK_MS = 1_000
const IDLE_PROBE_VISIBLE_MS = 10_000
const IDLE_PROBE_HIDDEN_MS = 30_000
const PROBE_DEADLINE_MS = 4_000
const WAKE_PROBE_DEADLINE_MS = 3_000
const UNACKED_PROBE_MS = 5_000
const STALL_AFTER_MS = 1_500
const BUFFER_STUCK_MS = 15_000
const REPLACE_CAP_MS = 12_000
const HEALTHY_AFTER_MS = 30_000
// A card read while the main thread is backed up carries the backlog as
// skew: a tick overdue by more than this at the card, or one that ran this
// late just before it, makes a device-looks-fast sample untrustworthy.
const CARD_LAG_MS = 500
const PROBE_FRAME = JSON.stringify(['REQ', 'hc-live', { '#x': ['hc:live'], limit: 0 }])

// ── delivery ─────────────────────────────────────────────────────────────────
// A refused EVENT used to be a console.warn: publish() had already said true,
// the swarm kept its memo, and the event was gone until the next refresh
// 45-75 s later. Every frame now waits for its OK: 'rate-limited:' re-sends
// after 1, 2, 4, 8, 15 s (at most 5 times, unless superseded or expired), any
// other refusal is announced as mesh:rejected, and frames a dead socket
// swallowed are queued again for the next open.
const INFLIGHT_MAX = 256
const INFLIGHT_TTL_MS = 60_000
const RATE_RETRY_MS = [1_000, 2_000, 4_000, 8_000, 15_000]
const CLOSED_RETRY_CAP_MS = 30_000
const SEEN_CAP = 1024
const SLOT_FLOOR_CAP = 4096
const CLOCK_APPLY_MS = 2_000
// publish(…, onTaken): callers waiting on a relay's OK, by event id. Bounded —
// an event no relay ever answers is forgotten with the oldest waiter.
const TAKEN_WAITERS_MAX = 64

// ── addresses (the relay's address gate) ─────────────────────────────────────
// THE SIGNATURES ARE THE ONLY THING THAT CAN BE QUERIED (jwize 2026-09-25,
// 2026-10-07). A relay with the address gate refuses any read or write whose
// address is not a 64-hex signature, so the mesh never forms one: subscribe,
// query, ensureStartedForSig and publish refuse anything else here, once and
// out loud, instead of sending a REQ that comes back CLOSED and a bucket that
// is silently deaf. One word survives, for the drain only: 'broker:fetch',
// where builds before the room-scoped ask channel still ask and listen (the
// relay routes it only inside the asker's own room). Retire it with them.
// The liveness probe is a raw frame (PROBE_FRAME), not an address.
const ADDRESS_RE = /^[0-9a-f]{64}$/
const DRAIN_WORDS = new Set(['broker:fetch'])

// ── this tab's meeting point (sessionStorage `hc:mesh-zone`) ─────────────────
// The shell keeps THIS tab's zone beside its membership — hypercomb-shared/
// core/mesh-session.ts, keep the key literal in step with it — as
// { room, secret, relay?, host?, code? }. Two fields are the mesh's:
//   relay — the meeting point this tab dials while it is joined, set by the
//           meeting link: per tab, so a refresh comes back to the SAME place,
//           and another tab joining elsewhere never moves it. Absent: the
//           page's own relay list, as before.
//   code  — that meeting point's access code. It rides the dial itself as the
//           WebSocket subprotocol `hc-access.<code>` — no extra round trip —
//           and goes to that one relay and nowhere else. A relay that needs
//           no code echoes the subprotocol and ignores it.
// A meeting point that refuses the code closes 4401 straight after the
// upgrade, before any frame: the mesh says so (`refused: 'access'`) and backs
// off on its own ladder (5 s, 15 s, 30 s, then every 60 s) — a wrong code is
// never a tight loop, and a wake or a return to view does not shorten it. A
// socket that offered a code is not announced as open until the relay has
// said something on it (its card is its first frame), so a refused one never
// sends the swarm into a reassert.
const MESH_ZONE_KEY = 'hc:mesh-zone'
const ACCESS_PROTOCOL_PREFIX = 'hc-access.'
const ACCESS_REFUSED_CLOSE = 4401
const ACCESS_LADDER_MS = [5_000, 15_000, 30_000, 60_000]
// How long a socket whose relay left the list stays open for what was already
// on its way there (#drain): a signature, not a meeting.
const DRAIN_MS = 2_000
// RFC 7230 token characters: a subprotocol must be one, or the WebSocket
// constructor throws before anything is dialled.
const ACCESS_CODE_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,256}$/

type MeshZone = { relay?: string; code?: string }

/** This tab's meeting point and access code; empty when it has none. */
const readMeshZone = (): MeshZone => {
  try {
    const raw = sessionStorage.getItem(MESH_ZONE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const o = parsed as Record<string, unknown>
    const zone: MeshZone = {}
    if (typeof o['relay'] === 'string' && o['relay'].trim()) zone.relay = o['relay'].trim()
    if (typeof o['code'] === 'string' && o['code'].trim()) zone.code = o['code'].trim()
    return zone
  } catch { return {} }
}

/** kind\0d for a parameterized-replaceable kind, else undefined. */
const slotOf = (kind: number, tags: string[][] | undefined): string | undefined => {
  if (!(kind >= 30000 && kind < 40000)) return undefined
  const d = Array.isArray(tags) ? tags.find(t => Array.isArray(t) && t[0] === 'd') : undefined
  return `${kind}\0${String(d?.[1] ?? '')}`
}

type MeshStats = {
  startedAtMs: number
  socketsOpened: number
  socketsClosed: number
  socketsErrors: number
  reqSent: number
  closeSent: number
  eventSent: number
  localFanout: number
  msgIn: number
  msgEventIn: number
  msgNoticeIn: number
  msgOtherIn: number
  parseFail: number
  noBucket: number
  sendSkippedNoSigner: number
  dupDrop: number
  probeSent: number
  retired: number
  retrySent: number
  rejected: number
}

type MeshLog = { atMs: number; type: string; relay?: string; sig?: string; subId?: string; kind?: number; note?: string; data?: any }

// accessN / accessUntilMs: consecutive access refusals and the moment the next
// dial may go — kept apart from the ladder, so a wake never shortens them.
type RelayBackoff = { attempts: number; nextAtMs: number; timer?: number; accessN?: number; accessUntilMs?: number }
type SigReadyWaiter = { resolve: () => void; timer?: number }

type CachedItem = { relay: string; sig: string; event: NostrEvent; payload: any; receivedAtMs: number; createdAtMs: number }
type MeshExpiryRule = {
  id: string
  ttlMs: number
  sigPrefix?: string
  kind?: number
}

export class NostrMeshDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'

  public override description =
    'Maintains WebSocket connections to Nostr relays and routes mesh subscribe/publish events.'
  public override effects = ['network'] as const

  protected override deps = { signer: '@diamondcoreprocessor.com/NostrSigner' }
  protected override listens = ['mesh:ensure-started', 'mesh:subscribe', 'mesh:publish', 'mesh:public-changed', 'mesh:zone']
  protected override emits = ['mesh:ready', 'mesh:items-updated', 'mesh:connection', 'mesh:rejected', 'mesh:host-card']

  // -----------------------------
  // config
  // -----------------------------

  // note: no default relay — user must configure their own (or use local dev relay)
  private relays: string[] = []

  // note: set to null to accept any kind matching x
  // Default to null (no kind filter) so the relay returns every event
  // matching the #x tag — caller drones (SwarmDrone, PairedChannelDrone)
  // narrow via configureKinds() once they finish loading. The previous
  // default [29010] hard-coded the paired-channel kind and silently
  // dropped swarm layer/resource/hide events (30200/30201/30202) on
  // any fresh localStorage profile (every incognito session, every
  // browser-data clear). The resubscribeAll() that fires when swarm
  // later calls configureKinds is racy on incognito; defaulting null
  // makes the filter universally permissive until something explicitly
  // narrows it.
  private kinds: number[] | null = null

  // note: expiry rules live here
  private ttlMs = 600_000
  private perSigCap = 128
  private expiryRules: MeshExpiryRule[] = [
    { id: 'default', ttlMs: 600_000 }
  ]

  // -----------------------------
  // state
  // -----------------------------

  private started = false
  private stopped = false

  private networkEnabled = this.loadNetworkEnabled()

  private sockets = new Map<string, WebSocket>()
  private backoff = new Map<string, RelayBackoff>()

  private bucketsBySig = new Map<string, Bucket>()
  private bucketsBySubId = new Map<string, Bucket>()

  // note: ttl-backed cache per sig
  private itemsBySig = new Map<string, CachedItem[]>()
  private readyWaitersBySig = new Map<string, SigReadyWaiter[]>()

  // liveness (see the block at the top of the file)
  #live = new WeakMap<WebSocket, Liveness>()
  #connectTimeouts = new Map<string, number>()
  #standby = new Map<string, WebSocket>()
  // Sockets of relays that just left the list, open for DRAIN_MS (#drain).
  #draining = new Map<string, WebSocket>()
  #tickTimer: ReturnType<typeof setTimeout> | undefined = undefined
  #tickDueMs = 0
  #lastTickAtMs = 0
  #lastTickLagMs = 0

  // connection state
  #everOpen = false
  #refusal: { reason: string; subId?: string } | null = null
  #conn: MeshConnection = { state: 'offline', reopened: false, since: Date.now(), attempt: 0, clockOffsetMs: 0 }

  // delivery
  #inflight = new Map<string, Inflight>()
  /** publish(…, onTaken) waiters: event id → called once, on the first
   *  relay's OK (accepted or duplicate). Sent or queued is not taken. */
  #takenWaiters = new Map<string, () => void>()
  #slotFloor = new Map<string, number>()
  #selfPubkey = ''

  // relay clock — from the 'hc:host' card the relay sends as its first frame
  #clockOffsetMs = 0
  #hostCard: { relay: string; time: number; participants: unknown; atMs: number } | null = null
  /** Each relay's last card policy (relayParticipants). */
  #participantsByRelay = new Map<string, unknown>()
  /** Each relay's card said its reads are addressed (relaysAddressed). */
  #addressedByRelay = new Map<string, boolean>()

  // this tab's meeting point (hc:mesh-zone): the relay + code last applied,
  // whether the relay list is the zone's (not the page's own), the code each
  // relay was dialled with, and the addresses already refused out loud
  #zoneKey = ''
  #zoneOwnsList = false
  #dialledCode = new Map<string, string>()
  #refusedAddresses = new Set<string>()

  // -----------------------------
  // debug (off by default)
  // -----------------------------

  private debug = false
  private stats: MeshStats = this.newStats()
  private logs: MeshLog[] = []
  private readonly logCap = 200

  // Armed from the constructor, one microtask after the module registers this
  // instance — not on the first heartbeat. The first pulse can come 10-60 s
  // after load, and every mesh:subscribe or mesh:publish emitted before it
  // reached nobody while the socket that should carry it sat unopened. The
  // heartbeat still calls #arm (idempotent), so a host that pulses before the
  // microtask runs is armed all the same.
  constructor() {
    super()
    queueMicrotask(() => this.#arm())
  }

  #armed = false

  #arm = (): void => {
    if (this.#armed) return
    this.#armed = true

    this.ensureStartedNow()

    // effect bus listeners — allow other drones to coordinate via effects
    this.onEffect<{ signature: string }>('mesh:ensure-started', async ({ signature }) => {
      this.ensureStartedForSig(signature)
      this.emitEffect('mesh:ready', { signature })
    })

    this.onEffect<{ signature: string, onItems: (e: any) => void }>('mesh:subscribe', ({ signature, onItems }) => {
      this.subscribe(signature, onItems)
    })

    this.onEffect<{ kind: number, sig: string, payload: any, extraTags?: string[][] }>('mesh:publish', async ({ kind, sig, payload, extraTags }) => {
      await this.publish(kind, sig, payload, extraTags)
    })

    // A join may name a meeting point (hc:mesh-zone). Read a microtask later,
    // after every listener of the same announcement — the shell records the
    // zone on it. A leave changes nothing here: the swarm's {left} must go
    // out on the socket it came in on, and the network goes quiet after it;
    // the next time it opens, the page's own list is back (setNetworkEnabled).
    this.onEffect<{ public?: boolean }>('mesh:public-changed', (p) => {
      if (p?.public === true) queueMicrotask(() => this.#syncZone())
    })
    // The zone moved without a join: a link's new meeting point or code, or
    // the way back to the default relay (meeting-invite.join.ts pointMeshAt).
    this.onEffect('mesh:zone', () => { queueMicrotask(() => this.#syncZone()) })

    try {
      window.addEventListener('online', this.#onWake)
      window.addEventListener('pageshow', this.#onWake)
      document.addEventListener('visibilitychange', this.#onVisibility)
    } catch { /* no window or document — nothing wakes us but our own timers */ }

    this.#emitConnection(true)
  }

  protected override sense = () => true

  protected override heartbeat = async (): Promise<void> => {
    this.#arm()
    this.pruneAllExpired()
    // A zone recorded after the join's announcement (a link answered late)
    // is picked up here; an unchanged one costs a storage read.
    if (isJoinedHere()) this.#syncZone()
    this.ensureSocketHealth()
  }

  // -----------------------------
  // public api
  // -----------------------------

  public configureRelays = (urls: string[], persist = true): void => {
    const next = Array.from(new Set((Array.isArray(urls) ? urls : [])
      .map(u => String(u ?? '').trim())
      .filter(u => u.startsWith('ws://') || u.startsWith('wss://'))))

    // The same list again — /use-live-relay re-run on a joined tab, /domain
    // naming the relay it already has — is no reason to tear the swarm down:
    // closing a live socket fires the relay's will for this key, and every
    // peer drops our tiles until the reassert lands.
    const unchanged = this.started && next.length === this.relays.length && next.every((u, i) => u === this.relays[i])

    this.relays = next
    if (persist) this.saveRelays(this.relays)
    if (unchanged) return
    this.reconnectAll()
  }

  /** The page's OWN relay list: what this origin's tabs dial when they are
   *  not at a meeting point (hc:nostrmesh:relays, else the defaults). A
   *  joined tab's meeting point (hc:mesh-zone) is never part of it. */
  public ownRelays = (): string[] => this.#zoneOwnsList ? this.loadRelays([]) : this.relays.slice()

  /** Replace the page's own list and save it for every tab of this origin
   *  (the /domain word). A tab at its meeting point stays there — the list
   *  is not its to change — and takes the saved list when it leaves. Writing
   *  the live list instead would save one tab's meeting point as every other
   *  tab's default, and they would dial it without its code. */
  public configureOwnRelays = (urls: string[]): void => {
    if (!this.#zoneOwnsList) { this.configureRelays(urls, true); return }
    this.saveRelays(Array.from(new Set((Array.isArray(urls) ? urls : [])
      .map(u => String(u ?? '').trim())
      .filter(u => u.startsWith('ws://') || u.startsWith('wss://')))))
  }

  /** The relay this tab meets at: host[:port] of the first relay it may
   *  dial — wss://jwize.com gives jwize.com, ws://localhost:7801 gives
   *  localhost:7801. A pure function of the relay list: no fetch, no NIP-11,
   *  nothing stored. '' when no relay can be dialled. A loopback relay
   *  counts only for a page that is itself local: a developer's
   *  ws://localhost override beside the live relay on https://hypercomb.io
   *  may be dialled, but a peer on another machine can never reach it.
   *
   *  It is NOT the swarm's upload host by default any more (2026-10-07,
   *  documentation/swarm-host.md): uploads go to the page's publish domains,
   *  else the hosts pool, and to this relay only when both are empty AND its
   *  card allows participants (`relayParticipants`). */
  public swarmHost = (): string => {
    const relay = this.#meetingRelay()
    if (!relay) return ''
    try { return new URL(relay).host } catch { return '' }
  }

  /** What the meeting relay's `hc:host` card said about participant
   *  uploads: 'all', 'zones' or false — undefined until its card has been
   *  heard on this page. Synchronous; nothing is asked for it. */
  public relayParticipants = (): unknown => {
    const relay = this.#meetingRelay()
    return relay ? this.#participantsByRelay.get(relay) : undefined
  }

  /** True when every relay this tab dials has said, in its `hc:host` card,
   *  that its reads are addressed — so the drained word ('broker:fetch')
   *  reaches only the asker's own room there, and an ask on it tells no other
   *  room anything. False while any card is unheard, or says otherwise (a
   *  relay before the address gate serves the word to everyone). */
  public relaysAddressed = (): boolean => {
    const relays = this.relays.filter(r => this.#relayAllowed(r))
    return relays.length > 0 && relays.every(r => this.#addressedByRelay.get(r) === true)
  }

  /** The first relay this tab may dial (see swarmHost), as configured. */
  #meetingRelay = (): string => {
    const zoneRelay = !this.started && isJoinedHere() ? this.#zoneRelayOf(readMeshZone()) : ''
    const relays = this.started ? this.relays : zoneRelay ? [zoneRelay] : this.loadRelays(this.relays)
    const local = this.isLocalContext()
    for (const relay of relays) {
      if (!this.#relayAllowed(relay)) continue
      if (!local && this.isLoopbackRelay(relay)) continue
      try { if (new URL(relay).host) return relay } catch { /* not a URL — try the next relay */ }
    }
    return ''
  }

  /** Milliseconds on the RELAY's clock: this device's clock corrected by the
   *  'hc:host' card the relay sends on connect (only when they differ by more
   *  than 2 s). Freshness, expiry and NIP-98 stamps that peers or the relay
   *  judge use this, so a device whose clock is off still agrees with the
   *  room. */
  public now = (): number => Date.now() + this.#clockOffsetMs

  /** Unix seconds on the relay's clock. */
  public nowSec = (): number => Math.floor(this.now() / 1000)

  /** The current connection (the last `mesh:connection` payload, brought up
   *  to date). */
  public connectionState = (): MeshConnection => {
    this.#emitConnection()
    return { ...this.#conn }
  }

  private loadRelayConfig = (): void => {
    this.relays = this.loadRelays(this.relays)
  }

  public configureKinds = (kinds: number[] | null, persist = true): void => {
    this.ensureStartedNow()

    if (kinds === null) {
      this.kinds = null
      if (persist) this.saveKinds(null)

      this.note('kinds:set', undefined, undefined, undefined, undefined, null)
      this.resubscribeAll()
      return
    }

    if (!Array.isArray(kinds) || kinds.length === 0) return

    const next = kinds
      .map(k => Number(k))
      .filter(k => Number.isFinite(k) && k > 0)
      .sort((a, b) => a - b)

    const uniq = Array.from(new Set(next))
    if (uniq.length === 0) return

    this.kinds = uniq
    if (persist) this.saveKinds(uniq)

    this.note('kinds:set', undefined, undefined, undefined, undefined, this.kinds)
    this.resubscribeAll()
  }

  // note: expiry tuning is mesh-owned
  public configureExpiry = (ttlMs: number, perSigCap = 128): void => {
    const ttl = Number(ttlMs ?? 0)
    if (Number.isFinite(ttl) && ttl > 0) this.ttlMs = ttl

    const cap = Number(perSigCap ?? 0)
    if (Number.isFinite(cap) && cap >= 16) this.perSigCap = Math.floor(cap)

    this.ensureDefaultExpiryRule()

    this.pruneAllExpired()
    this.note('expiry:set', undefined, undefined, undefined, undefined, { ttlMs: this.ttlMs, perSigCap: this.perSigCap })
  }

  // note: array-based expiry rules (first match wins, fallback is default ttl)
  public configureExpiryRules = (rules: MeshExpiryRule[]): void => {
    if (!Array.isArray(rules)) return

    const next = this.sanitizeExpiryRules(rules)
    this.expiryRules = next
    this.ensureDefaultExpiryRule()

    this.pruneAllExpired()
    this.note('expiry-rules:set', undefined, undefined, undefined, undefined, this.expiryRules)
  }

  public getExpiryRules = (): MeshExpiryRule[] => {
    this.ensureDefaultExpiryRule()
    return this.expiryRules.map(r => ({ ...r }))
  }

  // note: count distinct publisher IDs in non-expired cache for a signature
  public getSwarmSize = (sig: string): number => {
    const s = String(sig ?? '').trim()
    if (!s) return 0

    this.pruneSigExpired(s)
    const items = this.itemsBySig.get(s)
    if (!items || items.length === 0) return 0

    const publishers = new Set<string>()
    for (const item of items) {
      const tags = item.event?.tags
      if (!Array.isArray(tags)) continue
      for (const t of tags) {
        if (Array.isArray(t) && t.length >= 2 && String(t[0]) === 'publisher') {
          const v = String(t[1] ?? '').trim()
          if (v) publishers.add(v)
        }
      }
    }
    return publishers.size
  }

  /** May the mesh read or write at `s`? A 64-hex signature, or the one
   *  drained word. Anything else is refused once, out loud (see ADDRESS_RE). */
  #addressable = (s: string, op: string): boolean => {
    if (ADDRESS_RE.test(s) || DRAIN_WORDS.has(s)) return true
    if (!this.#refusedAddresses.has(s)) {
      this.#refusedAddresses.add(s)
      console.warn(`[nostr-mesh] refused to ${op} at "${s.slice(0, 80)}" — a mesh address is a 64-hex signature (only signatures can be queried)`)
    }
    this.note('address:refused', undefined, s, undefined, undefined, op)
    return false
  }

  // note: creates a bucket (zero consumers) so relays are queried and cache fills
  public ensureStartedForSig = (sig: string): void => {
    this.ensureStartedNow()

    const s = String(sig ?? '').trim()
    if (!s || !this.#addressable(s, 'listen')) return

    const existing = this.bucketsBySig.get(s)
    if (existing) return

    const bucket = this.#bucket(s)
    this.bucketsBySig.set(s, bucket)
    this.bucketsBySubId.set(bucket.subId, bucket)

    this.note('sub:hidden', undefined, s, bucket.subId, undefined, { consumers: 0 })
    this.sendReqToAll(bucket)
  }

  // note: returns newest-first cached items that are not expired (mesh ttl rules)
  public getNonExpired = (sig: string): MeshEvt[] => {
    this.ensureStartedNow()

    const s = String(sig ?? '').trim()
    if (!s) return []

    this.pruneSigExpired(s)

    const items = this.itemsBySig.get(s)
    if (!items || items.length === 0) return []

    const sorted = items
      .slice()
      .sort((a, b) => (b.createdAtMs || b.receivedAtMs) - (a.createdAtMs || a.receivedAtMs))

    return sorted.map(i => ({ relay: i.relay, sig: i.sig, event: i.event, payload: i.payload }))
  }

  // note: one-shot READ-BACK query.
  // Forces a fresh REQ for `sig` on a TRANSIENT subId so relays replay their
  // STORED matching events — including our OWN, which a relay does not echo
  // back live to the sender (relay.js broadcast excludes the sending socket),
  // so a long-lived subscription never re-sees what it published. Waits briefly
  // for the replay, closes the transient sub, and returns the cached items —
  // each tagged with the `relay` it arrived from ('local' = our own unconfirmed
  // fanout). A caller treats any item from a NON-'local' relay as a confirmed
  // read-back: the same "never trust a bare send-ok" discipline HostSyncService
  // uses for HTTP backup. Leaves the keyed subscription untouched (separate
  // subId, no cbs) so it never perturbs live delivery to subscribers.
  public query = async (sig: string, timeoutMs = 1800, sinceSec?: number | null): Promise<MeshEvt[]> => {
    this.ensureStartedNow()
    const s = String(sig ?? '').trim()
    if (!s || !this.#addressable(s, 'query')) return []
    if (!this.networkEnabled) return this.getNonExpired(s)
    const bucket = this.#bucket(s, sinceSec)
    this.bucketsBySubId.set(bucket.subId, bucket)
    this.sendReqToAll(bucket)
    const t = Math.max(200, Math.min(Number(timeoutMs) || 1800, 8000))
    await new Promise<void>(r => setTimeout(r, t))
    this.sendCloseToAll(bucket.subId)
    this.bucketsBySubId.delete(bucket.subId)
    return this.getNonExpired(s)
  }

  // note: await initial cache readiness for a signature
  // resolves when first matching event arrives, relay sends EOSE, or timeout elapses
  public awaitReadyForSig = async (sig: string, timeoutMs = 900): Promise<void> => {
    this.ensureStartedNow()

    const s = String(sig ?? '').trim()
    if (!s || !this.#addressable(s, 'listen')) return

    this.ensureStartedForSig(s)
    this.pruneSigExpired(s)

    const existing = this.itemsBySig.get(s)
    if (existing && existing.length > 0) return

    await new Promise<void>((resolve) => {
      const list = this.readyWaitersBySig.get(s) ?? []
      const waiter: SigReadyWaiter = { resolve }

      const t = Number(timeoutMs ?? 0)
      if (Number.isFinite(t) && t > 0) {
        waiter.timer = window.setTimeout(() => {
          this.removeReadyWaiter(s, waiter)
          resolve()
        }, Math.floor(t))
      }

      list.push(waiter)
      this.readyWaitersBySig.set(s, list)
    })
  }

  public stop = (): void => {
    this.stopped = true
    this.#stopTick()

    for (const [url, st] of this.backoff.entries()) {
      if (st.timer) clearTimeout(st.timer)
      this.backoff.delete(url)
    }

    this.#dropAllStandby('stop')
    this.#closeDraining()
    for (const [url, ws] of this.sockets.entries()) {
      try { ws.onopen = null; ws.onmessage = null; ws.onerror = null; ws.onclose = null } catch { /* ignore */ }
      try { ws.close() } catch { /* ignore */ }
      this.sockets.delete(url)
      this.note('socket:stop', url)
    }

    for (const key of Array.from(this.#inflight.keys())) this.#dropInflight(key)
    this.pendingOutbound = []
    this.#emitConnection()
  }

  public setDebug = (enabled: boolean): void => {
    this.debug = !!enabled
    try { localStorage.setItem('hc:nostrmesh:debug', this.debug ? '1' : '0') } catch { /* ignore */ }
    this.note('debug:set', undefined, undefined, undefined, undefined, this.debug)
  }

  public clearDebug = (): void => {
    this.stats = this.newStats()
    this.stats.startedAtMs = Date.now()
    this.logs = []
    this.note('debug:clear')
  }

  public getDebug = (): any => {
    // note: self-start on first introspection so debug doesn't lie
    this.ensureStartedNow()

    return {
      debug: this.debug,
      relays: this.relays.slice(),
      kinds: this.kinds ? this.kinds.slice() : null,
      ttlMs: this.ttlMs,
      perSigCap: this.perSigCap,
      expiryRules: this.getExpiryRules(),
      sockets: Array.from(this.sockets.entries()).map(([url, ws]) => ({ url, readyState: ws.readyState })),
      standby: Array.from(this.#standby.keys()),
      buckets: Array.from(this.bucketsBySig.values()).map(b => ({ sig: b.sig, subId: b.subId, consumers: b.cbs.size })),
      cached: Array.from(this.itemsBySig.entries()).map(([sig, items]) => ({ sig, count: items.length })),
      connection: this.connectionState(),
      inflight: this.#inflight.size,
      pending: this.pendingOutbound.length,
      hostCard: this.#hostCard ? { ...this.#hostCard } : null,
      stats: { ...this.stats },
      logs: this.logs.slice()
    }
  }


  public isNetworkEnabled = (): boolean => this.networkEnabled

  public setNetworkEnabled = (enabled: boolean, persist = true): void => {
  const next = !!enabled
  if (next === this.networkEnabled) return

  this.networkEnabled = next
  if (persist) {
    try { localStorage.setItem('hc:nostrmesh:network', next ? '1' : '0') } catch {}
  }

  this.note('network:set', undefined, undefined, undefined, undefined, this.networkEnabled)

  if (!this.networkEnabled) {
    this.pauseNetwork()
    return
  }

  // coming back online — at this tab's meeting point when it is joined to
  // one, else on the page's own list (a leave left the network off, so the
  // list moves back here, never under the {left} on its way out)
  this.ensureStartedNow()
  this.#syncZone(false)
  this.reconnectAll()
  this.#emitConnection()
}

  /** The meeting point this tab's zone names, when it is a ws(s) URL at all
   *  ('' for none, or for a value that is no relay). */
  #zoneRelayNamed = (zone: MeshZone): string => {
    const relay = zone.relay ?? ''
    if (!relay.startsWith('ws://') && !relay.startsWith('wss://')) return ''
    try { return new URL(relay).host ? relay : '' } catch { return '' }
  }

  /** This tab's meeting point from its zone, when it is one this tab may dial. */
  #zoneRelayOf = (zone: MeshZone): string => {
    const relay = this.#zoneRelayNamed(zone)
    // A loopback meeting point from a real host needs the same explicit
    // signal any loopback relay does: a link must never make a visitor's
    // browser dial their own machine.
    return relay && this.#relayAllowed(relay) ? relay : ''
  }

  /** The access code `relay` is dialled with: this tab's code, for its
   *  meeting point ONLY — the zone's own relay, when this page may dial it.
   *  Never any other relay: a zone whose meeting point cannot be dialled
   *  from here offers its code to nobody (it is for one meeting point). */
  #accessCodeFor = (relay: string): string => {
    const zone = readMeshZone()
    if (!zone.code) return ''
    const target = this.#zoneRelayOf(zone)
    return target && relay === target ? zone.code : ''
  }

  /** Point the mesh at this tab's meeting point (hc:mesh-zone) while it is
   *  joined: that one relay, dialled with its access code. Not joined, or no
   *  meeting point named: the page's own list. Acts only when the zone moved.
   *  reconnect=false moves only the list (at start, or when the network is
   *  about to reconnect anyway). A socket already at the right relay with the
   *  right code is never torn down: a join into the room the warm socket
   *  already meets at costs nothing. */
  #syncZone = (reconnect = true): void => {
    if (!this.started || this.stopped) return
    const zone = readMeshZone()
    const joined = isJoinedHere()
    const relay = joined ? this.#zoneRelayOf(zone) : ''
    // A meeting point this page may not dial (a loopback one opened from a
    // real host): meet NOWHERE and say so (refused: 'unreachable'). Meeting
    // on the page's own list instead would split the meeting without a word
    // — everyone else is at the point.
    const unreachable = joined && !relay && !!this.#zoneRelayNamed(zone)
    const key = `${relay} ${zone.code ?? ''} ${unreachable ? zone.relay : ''}`
    if (key === this.#zoneKey) return
    this.#zoneKey = key
    let listMoved = false
    if (unreachable) this.#setRefusal('unreachable')
    else if (this.#refusal?.reason === 'unreachable') this.#clearRefusal()
    if (relay) {
      listMoved = !(this.relays.length === 1 && this.relays[0] === relay)
      this.relays = [relay]
      this.#zoneOwnsList = true
      this.note('zone:relay', relay)
    } else if (unreachable) {
      listMoved = this.relays.length > 0
      this.relays = []
      this.#zoneOwnsList = true
      this.note('zone:unreachable', zone.relay)
    } else if (this.#zoneOwnsList) {
      this.#zoneOwnsList = false
      const own = this.loadRelays([])
      listMoved = !(own.length === this.relays.length && own.every((u, i) => u === this.relays[i]))
      this.relays = own
      this.note('zone:own-list')
    }
    if (!reconnect) return
    // A new code for a meeting point that refused the old one: stop waiting
    // out the access ladder and dial now. A socket that is in stays in — the
    // meeting point closes it (4401) if the code it came in on was recycled,
    // and that close dials the new code at once (onclose).
    const target = relay || this.#meetingRelay()
    const had = target ? this.#dialledCode.get(target) : undefined
    const refusedWait = !!target && (this.backoff.get(target)?.accessUntilMs ?? 0) > Date.now()
    const codeMoved = refusedWait && had !== undefined && had !== this.#accessCodeFor(target)
    if (listMoved || codeMoved) this.reconnectAll()
  }

  // note: signature-only subscription
  // - sig is used as the x tag value
  // - multiple consumers share one network subscription per sig
  public subscribe = (sig: string, cb: MeshCb, opts?: { sinceSec?: number | null }): MeshSub => {
    this.ensureStartedNow()

    const s = String(sig ?? '').trim()
    if (!s || !this.#addressable(s, 'subscribe')) return { close: () => void 0 }

    const existing = this.bucketsBySig.get(s)
    if (existing) {
      existing.cbs.add(cb)
      // A joiner may need a DEEPER replay than the bucket first asked for —
      // widen the shared window and re-REQ so the stored events flow in
      // (null = widest; consumers share one subscription per sig).
      const want = opts?.sinceSec
      const have = existing.sinceSec === undefined ? 900 : existing.sinceSec
      if (want !== undefined && (want === null ? have !== null : (have !== null && want > have))) {
        existing.sinceSec = want
        this.sendReqToAll(existing)
      }
      // The relay replayed this sig to whoever opened the bucket — a visuals
      // probe, a hidden ensureStartedForSig — and a joiner sends no REQ of its
      // own, so it would never see what is already here. Hand it the cache,
      // oldest first, once the caller holds its handle.
      queueMicrotask(() => {
        if (!existing.cbs.has(cb) || this.bucketsBySig.get(s) !== existing) return
        const held = this.getNonExpired(s)
        for (let i = held.length - 1; i >= 0; i--) {
          try { cb(held[i]) } catch { /* ignore */ }
        }
      })
      this.note('sub:join', undefined, s, existing.subId, undefined, { consumers: existing.cbs.size })
      return { close: () => this.unsubscribe(s, cb) }
    }

    const bucket = this.#bucket(s, opts?.sinceSec)
    bucket.cbs.add(cb)

    this.bucketsBySig.set(s, bucket)
    this.bucketsBySubId.set(bucket.subId, bucket)

    this.note('sub:new', undefined, s, bucket.subId, undefined, { consumers: 1 })

    // note: asks relays for matching events
    this.sendReqToAll(bucket)

    return { close: () => this.unsubscribe(s, cb) }
  }

  // note: publish a payload
  // - always local fanout immediately (even if signer is missing)
  // - best-effort to sign + send to relays
  // - `onTaken` runs once a relay has TAKEN the event (its OK, accepted or
  //   duplicate) — `true` from publish only says sent or queued
  public publish = async (kind: number, sig: string, payload: any, extraTags?: string[][], onTaken?: () => void): Promise<boolean> => {
    this.ensureStartedNow()

    const k = Number(kind ?? 0)
    if (!k || !Number.isFinite(k)) return false

    const s = String(sig ?? '').trim()
    if (!s || !this.#addressable(s, 'publish')) return false

    // Sig tag is always present. Expiration is opt-in: if the caller
    // didn't supply one in extraTags, the event lives until the relay
    // purges it (or never, on in-memory / friendly relays). Share
    // events are state-driven — host's inbox or source-node
    // toggle revokes them — so a time-based default would lie.
    const tags: string[][] = [['x', s]]

    // Stamped on the RELAY's clock. A caller computes its expiration from
    // this device's clock, so the tag moves by the same offset as created_at:
    // a device two minutes slow no longer publishes events that peers and the
    // relay already consider expired.
    const offsetSec = Math.round(this.#clockOffsetMs / 1000)

    if (Array.isArray(extraTags)) {
      for (const t of extraTags) {
        if (!Array.isArray(t) || t.length < 2) continue
        const tag = t.map(x => String(x))
        if (offsetSec !== 0 && tag[0] === 'expiration') {
          const v = Number(tag[1])
          if (Number.isFinite(v)) tag[1] = String(v + offsetSec)
        }
        tags.push(tag)
      }
    }

    const content = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {})

    // created_at only ever increases per slot. Two updates to one replaceable
    // slot within the same second used to tie, and the relay kept whichever
    // id sorted lower — half the newer ones were acknowledged and never
    // delivered. The floor also holds anything heard under our own key (a
    // relay-made tombstone on our lifecycle slot), so the next beacon is
    // strictly newer than it.
    const slot = slotOf(k, tags)
    let createdAt = this.nowSec()
    if (slot) {
      const floor = this.#slotFloor.get(slot)
      if (floor !== undefined && createdAt <= floor) createdAt = floor + 1
      this.#raiseFloor(slot, createdAt)
    }

    const evt: NostrEvent = {
      created_at: createdAt,
      kind: k,
      tags,
      content
    }

    // critical: always deliver locally
    this.fanoutToSig('local', s, evt)
    this.note('publish:local', undefined, s, undefined, k)

    // best-effort: sign and send. HONESTY: a failed signature means the
    // event exists ONLY in local fanout — returning true here let callers
    // stamp "published" memos while every peer saw nothing, silently, on
    // every heartbeat. Local fanout already happened above, so the caller
    // keeps its own view either way; `false` says "no relay will see this".
    // The relays this was meant for, as it was asked: a list that moves while
    // it is being signed still owes it to the relay it was asked on (#drain).
    const askedOn = this.relays.slice()
    const signed = await this.trySign(evt)
    if (!signed) {
      this.stats.sendSkippedNoSigner++
      this.note('publish:send-skipped-nosigner', undefined, s, undefined, k)
      return false
    }
    if (signed.pubkey && signed.pubkey !== this.#selfPubkey) this.#learnSelf(String(signed.pubkey))
    if (onTaken && signed.id) {
      if (this.#takenWaiters.size >= TAKEN_WAITERS_MAX) {
        const oldest = this.#takenWaiters.keys().next().value
        if (oldest !== undefined) this.#takenWaiters.delete(oldest)
      }
      this.#takenWaiters.set(String(signed.id), onTaken)
    }
    if (this.#draining.size) {
      for (const relay of askedOn) {
        const ws = this.#draining.get(relay)
        if (!ws || this.sockets.has(relay) || ws.readyState !== WebSocket.OPEN) continue
        try { ws.send(JSON.stringify(['EVENT', signed])); this.note('publish:drained', relay, s, undefined, k) } catch { /* closing */ }
      }
    }

    const delivered = this.sendEventToAll(signed)
    this.note('publish:sent', undefined, s, undefined, k)

    return delivered
  }

  // -----------------------------
  // startup
  // -----------------------------

  private ensureStartedNow = (): void => {
    if (this.started) return
    this.started = true

    this.debug = this.loadDebugFlag()
    this.stats.startedAtMs = Date.now()

    // note: allow config from localstorage without rebuilding
    this.relays = this.loadRelays(this.relays)
    // A joined tab resumes at ITS meeting point — the first dial goes there,
    // with its code, so a refresh is back in the same place with no detour.
    this.#syncZone(false)
    this.kinds = this.loadKinds(this.kinds)

    this.note('mesh:started', undefined, undefined, undefined, undefined, { relays: this.relays, kinds: this.kinds })

    this.connectAll()
    this.#armTick(this.#nextTickDelay(Date.now()))
  }

  // -----------------------------
  // connections
  // -----------------------------

  private connectAll = (): void => {
  if (!this.networkEnabled) return
  for (const url of this.relays) this.ensureSocket(url)
}

  private ensureSocketHealth = (): void => {
    if (!this.networkEnabled || this.stopped) return

    // reconnect any configured relays that are missing
    for (const url of this.relays) {
      if (!this.sockets.has(url)) this.ensureSocket(url)
    }
  }

  private reconnectAll = (): void => {
    if (this.stopped) return

    for (const [url, st] of this.backoff.entries()) {
      if (st.timer) clearTimeout(st.timer)
      this.backoff.delete(url)
    }

    // A replacement dialled for the old list is not the one to keep.
    this.#dropAllStandby('reconnect')
    // A copy: #retire re-opens the relay under the same key, and a live Map
    // iterator would visit the replacement and retire it too.
    for (const [url, ws] of Array.from(this.sockets.entries())) {
      this.note('socket:close-requested', url)
      if (!this.relays.includes(url) && ws.readyState === WebSocket.OPEN) this.#drain(url, ws)
      else this.#retire(url, ws, 'reconnect')
    }

    this.connectAll()
  }

  // LEAVE ON THE SOCKET IT CAME IN ON. A socket whose relay just left the list
  // (a join into another room at another meeting point) is not cut at once:
  // the {left} for the room this tab is leaving was asked for a moment before
  // and is still being signed, and it belongs to that relay — the room it
  // leaves is there, not at the new point. So the socket stays open, deaf
  // (no handlers, no subscriptions owed), for DRAIN_MS, and a publish that
  // began while it was on the list goes out on it too (publish). Nothing new
  // is ever sent on it.
  #drain = (relay: string, ws: WebSocket): void => {
    try { ws.onopen = null; ws.onmessage = null; ws.onerror = null; ws.onclose = null } catch { /* ignore */ }
    this.#live.delete(ws)
    this.sockets.delete(relay)
    this.stats.socketsClosed++
    this.stats.retired++
    this.note('socket:draining', relay)
    this.#requeueInflight(relay)
    this.#dropStandby(relay, 'reconnect')
    const prior = this.#draining.get(relay)
    if (prior && prior !== ws) { try { prior.close() } catch { /* ignore */ } }
    this.#draining.set(relay, ws)
    setTimeout(() => {
      if (this.#draining.get(relay) === ws) this.#draining.delete(relay)
      try { ws.close() } catch { /* ignore */ }
    }, DRAIN_MS)
    this.#emitConnection()
  }

  #closeDraining = (): void => {
    for (const ws of this.#draining.values()) { try { ws.close() } catch { /* ignore */ } }
    this.#draining.clear()
  }

  // Retire one socket for good. Its handlers go first, so nothing it does
  // later — a close event that arrives after its replacement opened — can
  // touch the map: an orphan's late onclose used to delete the LIVE socket,
  // leaving it open, subscribed and untracked. Frames it swallowed without an
  // OK are queued again for the next open, and the relay is dialled again at
  // once (the ladder's first step is 0 ms).
  // A replacement already dialling (make-before-break) takes the slot instead
  // of a fresh dial: it is the one the ladder already paid for.
  #retire = (relay: string, ws: WebSocket, why: string, bump = true): void => {
    try { ws.onopen = null; ws.onmessage = null; ws.onerror = null; ws.onclose = null } catch { /* ignore */ }
    try { ws.close() } catch { /* ignore */ }
    this.#live.delete(ws)
    if (this.sockets.get(relay) !== ws) return

    this.sockets.delete(relay)
    this.stats.socketsClosed++
    if (why !== 'closed') this.stats.retired++
    this.note('socket:retired', relay, undefined, undefined, undefined, why)

    this.#requeueInflight(relay)

    if (this.networkEnabled && !this.stopped && this.relays.includes(relay)) {
      const next = this.#standby.get(relay)
      if (next) {
        this.#standby.delete(relay)
        this.sockets.set(relay, next)
      } else {
        if (bump) this.bumpBackoff(relay)
        this.ensureSocket(relay)
      }
    } else {
      this.#dropStandby(relay, why)
    }
    this.#emitConnection()
  }

  // The replacement opened while the suspect socket still held the slot: the
  // suspect goes, its unanswered frames are queued again, and the open that
  // follows re-sends the REQs and flushes them on the new socket.
  #promote = (relay: string, ws: WebSocket): void => {
    this.#standby.delete(relay)
    const old = this.sockets.get(relay)
    this.sockets.set(relay, ws)
    if (!old || old === ws) return
    try { old.onopen = null; old.onmessage = null; old.onerror = null; old.onclose = null } catch { /* ignore */ }
    try { old.close() } catch { /* ignore */ }
    this.#live.delete(old)
    this.stats.socketsClosed++
    this.stats.retired++
    this.note('socket:retired', relay, undefined, undefined, undefined, 'replaced')
    this.#requeueInflight(relay)
  }

  #dropStandby = (relay: string, why: string): void => {
    const ws = this.#standby.get(relay)
    if (!ws) return
    this.#standby.delete(relay)
    try { ws.onopen = null; ws.onmessage = null; ws.onerror = null; ws.onclose = null } catch { /* ignore */ }
    try { ws.close() } catch { /* ignore */ }
    this.#live.delete(ws)
    this.note('socket:standby-dropped', relay, undefined, undefined, undefined, why)
  }

  #dropAllStandby = (why: string): void => {
    for (const relay of Array.from(this.#standby.keys())) this.#dropStandby(relay, why)
  }

  // The probe deadline passed. The first time: a failure on the ladder, and
  // a replacement dialled at its next step. Then: a replacement that timed out
  // is dialled again, and 12 s on the socket goes even with none open.
  #suspect = (relay: string, ws: WebSocket, lv: Liveness, now: number): void => {
    if (lv.suspectAtMs <= 0) {
      lv.suspectAtMs = now
      this.note('socket:suspect', relay)
      this.bumpBackoff(relay)
    } else if (now - lv.suspectAtMs >= REPLACE_CAP_MS) {
      this.#retire(relay, ws, 'probe-timeout', false)
      return
    }
    this.ensureSocket(relay)
  }

  // A socket that proved itself: the ladder starts again from 0.
  #markHealthy = (relay: string, lv: Liveness): void => {
    if (lv.healthy) return
    lv.healthy = true
    const b = this.backoff.get(relay)
    if (b && (b.attempts > 0 || b.nextAtMs > 0)) {
      b.attempts = 0
      b.nextAtMs = 0
      this.#emitConnection()
    }
  }

  private resubscribeAll = (): void => {
    for (const b of this.bucketsBySig.values()) {
      this.sendCloseToAll(b.subId)
      this.sendReqToAll(b)
    }
  }

  private ensureSocket = (relay: string): void => {
    if (!this.networkEnabled) return
    if (this.stopped) return
    // A socket that missed its probe keeps its place until a replacement
    // opens (make-before-break): that replacement is the one dial allowed
    // while the relay has a socket.
    const cur = this.sockets.get(relay)
    const standby = !!cur && (this.#live.get(cur)?.suspectAtMs ?? 0) > 0
    if (cur && !standby) return
    if (standby && this.#standby.has(relay)) return
    // A relay taken off the list stays off: a pending backoff timer or a
    // late close must not dial it back.
    if (!this.relays.includes(relay)) return
    if (!this.canAttemptRelay(relay)) return

    const now = Date.now()
    const st = this.backoff.get(relay)
    // A refused access code waits out its own ladder (#accessRefused).
    const dueAt = Math.max(st?.nextAtMs ?? 0, st?.accessUntilMs ?? 0)
    if (st && dueAt > now) {
      this.scheduleEnsure(relay, dueAt - now)
      return
    }
    this.#dial(relay, standby)
  }

  #dial = (relay: string, standby: boolean): void => {
    // The meeting point's access code rides the upgrade as a subprotocol: no
    // round trip of its own. Not a token, it cannot be offered at all (the
    // constructor would throw) — the dial goes without it and the meeting
    // point's refusal says why.
    let code = this.#accessCodeFor(relay)
    if (code && !ACCESS_CODE_RE.test(code)) {
      if (!this.#refusedAddresses.has(`access:${relay}`)) {
        this.#refusedAddresses.add(`access:${relay}`)
        console.warn(`[nostr-mesh] the access code for ${relay} is not a valid subprotocol token — dialling without it`)
      }
      code = ''
    }
    let ws: WebSocket
    try { ws = code ? new WebSocket(relay, [ACCESS_PROTOCOL_PREFIX + code]) : new WebSocket(relay) } catch {
      // A synchronous constructor throw (malformed URL, mixed-content
      // SecurityError) used to drop the relay from the loop for the whole
      // session with no backoff entry and no retry. Record the failure and
      // retry on the normal ladder instead — a transient throw self-heals,
      // a permanent one backs off to the ladder's cap and stays visible in
      // getDebug()'s backoff map instead of vanishing.
      this.stats.socketsErrors++
      this.note('socket:create-threw', relay)
      this.bumpBackoff(relay)
      const st = this.backoff.get(relay)
      if (st) this.scheduleEnsure(relay, Math.max(0, st.nextAtMs - Date.now()))
      return
    }

    const createdAtMs = Date.now()
    const timeouts = this.#connectTimeouts.get(relay) ?? 0
    if (standby) this.#standby.set(relay, ws)
    else this.sockets.set(relay, ws)
    this.#dialledCode.set(relay, code)
    this.#live.set(ws, {
      createdAtMs,
      connectTimeoutMs: CONNECT_TIMEOUTS_MS[Math.min(timeouts, CONNECT_TIMEOUTS_MS.length - 1)],
      lastInboundMs: 0,
      probeSentAtMs: 0,
      probeDeadlineMs: 0,
      openedAtMs: 0,
      healthy: false,
      buffered: 0,
      bufferedMovedMs: 0,
      suspectAtMs: 0,
      admitted: !code,
      code,
    })
    this.note(standby ? 'socket:standby' : 'socket:create', relay)
    this.#armTick(this.#nextTickDelay(createdAtMs))

    // Every handler first asks whether its socket is still THE socket for
    // this relay (or its replacement in waiting). A retired one has its
    // handlers removed, but a reference captured earlier must still change
    // nothing.
    ws.onopen = () => {
      if (this.#standby.get(relay) === ws) this.#promote(relay, ws)
      if (this.sockets.get(relay) !== ws) return
      this.stats.socketsOpened++
      this.note('socket:open', relay)

      // The ladder is NOT reset here: an open proves only the handshake.
      // #markHealthy resets it once this socket answers a probe or has been
      // open 30 s.

      // note: resubscribe everything on connect — FIRST, before anything
      // else goes out on this socket (each bucket with its own window).
      for (const bucket of this.bucketsBySig.values()) this.sendReq(relay, bucket)

      // Deliver anything queued while no socket was open — the join's
      // first publish burst rides here instead of dying in CONNECTING —
      // and the frames a dead socket swallowed without an OK.
      this.flushPendingOutbound()

      // Bookkeeping after the frames: no relay frame can arrive before this
      // handler returns. Each bucket forgets what it delivered, so the
      // replay of a peer swept while we were dead reaches the swarm again;
      // a CLOSED retry is moot, its REQ just went out.
      for (const bucket of this.bucketsBySig.values()) {
        bucket.seen.clear()
        if (bucket.retryTimer) { clearTimeout(bucket.retryTimer); bucket.retryTimer = undefined }
      }
      const lv = this.#live.get(ws)
      if (lv) { lv.lastInboundMs = Date.now(); lv.openedAtMs = lv.lastInboundMs }
      this.#connectTimeouts.delete(relay)

      // A socket that offered an access code is announced on the relay's
      // first frame instead (its card, on the same flight): a meeting point
      // that refuses the code closes before saying anything, and announcing
      // that as a reopen would send the swarm into a reassert for nothing.
      if (lv && !lv.admitted) return
      this.#announceOpen(relay)
    }

    ws.onmessage = (msg) => {
      if (this.sockets.get(relay) !== ws) return
      const lv = this.#live.get(ws)
      if (lv) {
        lv.lastInboundMs = Date.now()
        if (!lv.admitted) { lv.admitted = true; this.#announceOpen(relay) }
        if (lv.probeDeadlineMs > 0) {
          // The probe is answered (anything heard counts): the socket is
          // alive, and a replacement dialled for it is not needed.
          lv.probeSentAtMs = 0
          lv.probeDeadlineMs = 0
          lv.suspectAtMs = 0
          this.#dropStandby(relay, 'answered')
          this.#markHealthy(relay, lv)
          this.#emitConnection()
        }
      }
      this.onMessage(relay, msg?.data)
    }

    ws.onclose = (ev?: { code?: number }) => {
      const refusedAccess = Number(ev?.code) === ACCESS_REFUSED_CLOSE
      if (this.#standby.get(relay) === ws) {
        // The replacement failed before it opened: the next judge dials
        // another at the ladder's next step, or the cap retires the suspect.
        if (refusedAccess) this.#accessRefused(relay)
        else this.bumpBackoff(relay)
        this.#dropStandby(relay, 'closed')
        return
      }
      if (this.sockets.get(relay) !== ws) return
      this.note('socket:closed', relay)
      if (refusedAccess) {
        // Refused on a code this tab has since replaced (a new link while it
        // was in): the new one is dialled at once, on the ordinary ladder.
        if ((this.#live.get(ws)?.code ?? '') !== this.#accessCodeFor(relay)) {
          this.#retire(relay, ws, 'access-recycled', false)
          return
        }
        this.#accessRefused(relay)
        this.#retire(relay, ws, 'access', false)
        return
      }
      this.#retire(relay, ws, 'closed')
    }

    ws.onerror = () => {
      if (this.sockets.get(relay) !== ws && this.#standby.get(relay) !== ws) return
      this.stats.socketsErrors++
      this.note('socket:error', relay)

      try { ws.close() } catch { /* ignore */ }
    }
  }

  // A socket is open AND admitted: the connection is announced, standing
  // refusals are cleared (the relay took us), and an access ladder starts over.
  #announceOpen = (relay: string): void => {
    this.#refusal = null
    const st = this.backoff.get(relay)
    if (st) { st.accessN = 0; st.accessUntilMs = 0 }
    const reopened = this.#everOpen
    this.#everOpen = true
    // A reopen is always announced, even when another relay kept the
    // aggregate open: this one may have restarted empty. It is announced
    // ONCE — this payload alone carries reopened: true.
    this.#emitConnection(reopened, reopened)
  }

  // The meeting point closed 4401: this tab's access code is not its current
  // one. A standing answer until the code changes — the next dial waits 5 s,
  // then 15 s, 30 s and every 60 s after, and nothing (a wake, a return to
  // view) shortens that; a new code moves the zone and dials at once.
  #accessRefused = (relay: string): void => {
    const st = this.backoff.get(relay) ?? { attempts: 0, nextAtMs: 0 }
    st.accessN = Math.min(32, (st.accessN ?? 0) + 1)
    st.attempts = Math.min(32, st.attempts + 1)
    const base = ACCESS_LADDER_MS[Math.min(st.accessN - 1, ACCESS_LADDER_MS.length - 1)]
    st.accessUntilMs = Date.now() + base - Math.floor(base * 0.2 * Math.random())
    this.backoff.set(relay, st)
    this.note('socket:access-refused', relay, undefined, undefined, undefined, { refusals: st.accessN })
    if (st.accessN === 1) console.warn(`[nostr-mesh] ${relay} refused this tab's access code — the meeting link's code is not its current one`)
    this.#setRefusal('access')
  }

  // -----------------------------
  // liveness watchdog
  // -----------------------------

  #hidden = (): boolean => {
    try { return typeof document !== 'undefined' && document.visibilityState === 'hidden' } catch { return false }
  }

  // One timer, always at the earliest moment something is due: the next
  // tick, a probe's stall point or deadline, a handshake's timeout.
  #armTick = (delayMs: number): void => {
    if (!this.networkEnabled || this.stopped || this.sockets.size === 0) return
    const wait = Math.max(0, delayMs)
    const due = Date.now() + wait
    if (this.#tickTimer !== undefined) {
      if (this.#tickDueMs <= due) return
      clearTimeout(this.#tickTimer)
    }
    this.#tickDueMs = due
    this.#tickTimer = setTimeout(this.#tick, wait)
  }

  #stopTick = (): void => {
    if (this.#tickTimer !== undefined) clearTimeout(this.#tickTimer)
    this.#tickTimer = undefined
  }

  #nextTickDelay = (now: number): number => {
    let next = this.#hidden() ? TICK_HIDDEN_MS : TICK_VISIBLE_MS
    const consider = (due: number): void => {
      // A moment already past was judged (or deferred) by the tick that is
      // running — only future ones move the timer, or a deferral would spin.
      if (due > now) next = Math.min(next, due - now)
    }
    for (const ws of this.sockets.values()) {
      const lv = this.#live.get(ws)
      if (!lv) continue
      consider(ws.readyState === WebSocket.CONNECTING ? lv.createdAtMs + lv.connectTimeoutMs
        : lv.suspectAtMs > 0 ? lv.suspectAtMs + REPLACE_CAP_MS
        : lv.probeDeadlineMs <= 0 ? 0
        : now < lv.probeSentAtMs + STALL_AFTER_MS ? lv.probeSentAtMs + STALL_AFTER_MS
        : lv.probeDeadlineMs)
    }
    for (const ws of this.#standby.values()) {
      const lv = this.#live.get(ws)
      if (lv) consider(lv.createdAtMs + lv.connectTimeoutMs)
    }
    return next
  }

  #tick = (): void => {
    this.#tickTimer = undefined
    if (!this.networkEnabled || this.stopped) return
    const now = Date.now()
    this.#lastTickAtMs = now
    this.#lastTickLagMs = now - this.#tickDueMs
    this.#purgeInflight(now)
    // A tick more than a second late means the main thread was blocked or
    // the tab frozen: frames may be waiting unread in the task queue, so
    // silence proves nothing yet. The next, punctual tick judges.
    if (now - this.#tickDueMs <= LATE_TICK_MS) this.#judge(now)
    this.#emitConnection()
    this.#armTick(this.#nextTickDelay(Date.now()))
  }

  #judge = (now: number): void => {
    const idleMs = this.#hidden() ? IDLE_PROBE_HIDDEN_MS : IDLE_PROBE_VISIBLE_MS
    // A replacement that never finished its handshake is dropped; the
    // suspect it was dialled for gets another at the ladder's next step.
    for (const [relay, ws] of Array.from(this.#standby.entries())) {
      const lv = this.#live.get(ws)
      if (ws.readyState === WebSocket.CONNECTING && lv && now - lv.createdAtMs < lv.connectTimeoutMs) continue
      if (ws.readyState === WebSocket.OPEN) continue
      if (ws.readyState === WebSocket.CONNECTING) this.#connectTimeouts.set(relay, (this.#connectTimeouts.get(relay) ?? 0) + 1)
      this.bumpBackoff(relay)
      this.#dropStandby(relay, 'connect-timeout')
    }
    for (const [relay, ws] of Array.from(this.sockets.entries())) {
      const lv = this.#live.get(ws)
      if (!lv) continue
      if (ws.readyState === WebSocket.CONNECTING) {
        if (now - lv.createdAtMs >= lv.connectTimeoutMs) {
          this.#connectTimeouts.set(relay, (this.#connectTimeouts.get(relay) ?? 0) + 1)
          this.#retire(relay, ws, 'connect-timeout')
        }
        continue
      }
      if (ws.readyState === WebSocket.CLOSED) { this.#retire(relay, ws, 'closed'); continue }
      if (ws.readyState !== WebSocket.OPEN) continue
      if (!lv.healthy && lv.openedAtMs > 0 && now - lv.openedAtMs >= HEALTHY_AFTER_MS) this.#markHealthy(relay, lv)
      // Bytes still queued on this device and going down: the silence may be
      // ours. A buffer that has not gone down for 15 s is a path that stopped
      // taking bytes (the gateway forgot us, nothing ACKs) — judged as usual.
      const buffered = ws.bufferedAmount
      if (buffered > 0) {
        if (lv.buffered === 0 || buffered < lv.buffered) lv.bufferedMovedMs = now
        lv.buffered = buffered
        if (now - lv.bufferedMovedMs < BUFFER_STUCK_MS) continue
      } else {
        lv.buffered = 0
      }
      if (lv.probeDeadlineMs > 0) {
        if (now >= lv.probeDeadlineMs) this.#suspect(relay, ws, lv, now)
        continue
      }
      if (now - lv.lastInboundMs >= idleMs || this.#unackedSince(relay, lv.lastInboundMs, now)) {
        this.#probe(relay, ws, PROBE_DEADLINE_MS)
      }
    }
  }

  // An EVENT out for 5 s with no OK and nothing at all heard since it left.
  #unackedSince = (relay: string, lastInboundMs: number, now: number): boolean => {
    for (const e of this.#inflight.values()) {
      if (e.relay !== relay || e.timer) continue
      if (now - e.sentAtMs >= UNACKED_PROBE_MS && lastInboundMs < e.sentAtMs) return true
    }
    return false
  }

  #probe = (relay: string, ws: WebSocket, deadlineMs: number): void => {
    const lv = this.#live.get(ws)
    if (!lv) return
    const now = Date.now()
    try { ws.send(PROBE_FRAME) } catch { this.#retire(relay, ws, 'probe-send'); return }
    this.stats.probeSent++
    this.note('out:probe', relay, undefined, 'hc-live', undefined, { deadlineMs })
    lv.probeDeadlineMs = lv.probeDeadlineMs > now ? Math.min(lv.probeDeadlineMs, now + deadlineMs) : now + deadlineMs
    lv.probeSentAtMs = now
    this.#armTick(this.#nextTickDelay(now))
  }

  #onVisibility = (): void => {
    if (this.#hidden()) return
    this.#onWake()
  }

  // A phone that wakes, a network that returns, a page restored from the
  // back-forward cache: the moments a socket is most likely dead without
  // knowing it. An OPEN one must answer within 3 s (one already suspect gets
  // its replacement now); any other relay drops its backoff and is dialled
  // now. A handshake already in flight is left to finish — it is usually the
  // fastest way back.
  #onWake = (): void => {
    if (!this.networkEnabled || this.stopped) return
    for (const relay of this.relays.slice()) {
      const ws = this.sockets.get(relay)
      const suspect = !!ws && (this.#live.get(ws)?.suspectAtMs ?? 0) > 0
      if (ws && ws.readyState === WebSocket.OPEN && !suspect) { this.#probe(relay, ws, WAKE_PROBE_DEADLINE_MS); continue }
      if (ws && ws.readyState === WebSocket.CONNECTING) continue
      const st = this.backoff.get(relay)
      if (st) {
        if (st.timer) clearTimeout(st.timer)
        st.timer = undefined
        st.attempts = 0
        st.nextAtMs = 0
      }
      if (suspect) this.ensureSocket(relay)
      else if (ws) this.#retire(relay, ws, 'wake')
      else this.ensureSocket(relay)
    }
    this.#emitConnection()
  }

  // -----------------------------
  // connection state
  // -----------------------------

  #computeState = (now: number): MeshConnectionState => {
    if (this.stopped || !this.networkEnabled) return 'offline'
    if (!this.relays.some(r => this.#relayAllowed(r))) return 'offline'
    let anyOpen = false
    for (const relay of this.relays) {
      const ws = this.sockets.get(relay)
      if (!ws || ws.readyState !== WebSocket.OPEN) continue
      const lv = this.#live.get(ws)
      if (lv && !lv.admitted) continue  // offered a code; not yet taken
      if (!lv || lv.probeDeadlineMs <= 0 || now - lv.probeSentAtMs < STALL_AFTER_MS) return 'open'
      anyOpen = true
    }
    if (anyOpen) return 'stalled'
    if (this.#everOpen) return 'retrying'
    return this.relays.some(r => (this.backoff.get(r)?.attempts ?? 0) > 0) ? 'retrying' : 'connecting'
  }

  // Announce the connection when anything in it changed (force: a reopen,
  // which the swarm answers with a reassert even when the aggregate state
  // did not move). `reopened` is passed by a socket's open and by nothing
  // else, so it rides exactly one payload.
  #emitConnection = (force = false, reopened = false): void => {
    const state = this.#computeState(Date.now())
    const prev = this.#conn
    const next: MeshConnection = {
      state,
      reopened: state === 'open' && reopened,
      since: state === prev.state ? prev.since : Date.now(),
      attempt: this.relays.reduce((m, r) => Math.max(m, this.backoff.get(r)?.attempts ?? 0), 0),
      clockOffsetMs: this.#clockOffsetMs,
    }
    if (this.#refusal) next.refused = this.#refusal.reason
    const changed = force || next.state !== prev.state || next.reopened !== prev.reopened
      || next.attempt !== prev.attempt || next.clockOffsetMs !== prev.clockOffsetMs || next.refused !== prev.refused
    if (!changed) return
    this.#conn = next
    this.emitEffect('mesh:connection', { ...next })
  }

  #setRefusal = (reason: string, subId?: string): void => {
    this.#refusal = { reason, subId }
    this.#emitConnection()
  }

  #clearRefusal = (): void => {
    if (!this.#refusal) return
    this.#refusal = null
    this.#emitConnection()
  }

  private scheduleEnsure = (relay: string, delayMs: number): void => {
    if (this.stopped) return
    const st = this.backoff.get(relay)
    if (!st) return
    if (st.timer) return

    st.timer = window.setTimeout(() => {
      st.timer = undefined
      this.ensureSocket(relay)
    }, Math.max(0, delayMs))
  }

  // The ladder: 0, 250 ms, 500 ms, 1 s, 2 s, 4 s, then 4 s while visible —
  // a relay restart has every client back within 4 s of it listening. Hidden,
  // it keeps doubling to 15 s. The jitter (up to 30%) comes OFF the step, so
  // the cap is a cap and a room that lost the relay together does not return
  // in lockstep. Resets once a socket proves healthy (#markHealthy), and on
  // online and a return to view — never on a bare open.
  private bumpBackoff = (relay: string): void => {
    const now = Date.now()
    const st = this.backoff.get(relay) ?? { attempts: 0, nextAtMs: 0 }

    st.attempts = Math.min(32, st.attempts + 1)

    const step = st.attempts - 1
    const base = step < LADDER_MS.length ? LADDER_MS[step]
      : !this.#hidden() ? LADDER_MS[LADDER_MS.length - 1]
      : Math.min(LADDER_CAP_HIDDEN_MS, LADDER_MS[LADDER_MS.length - 1] * (2 ** (step - LADDER_MS.length + 1)))
    const waitMs = base - Math.floor(base * 0.3 * Math.random())
    st.nextAtMs = now + waitMs

    this.backoff.set(relay, st)
    this.note('socket:backoff', relay, undefined, undefined, undefined, { attempts: st.attempts, waitMs })
  }

  private canAttemptRelay = (relay: string): boolean => {
    if (this.#relayAllowed(relay)) return true
    this.note('socket:skip-loopback-relay', relay)
    return false
  }

  #relayAllowed = (relay: string): boolean => {
    if (!this.isLoopbackRelay(relay)) return true
    // Loopback is fine when the app itself runs on a local origin. From a
    // real host it needs an EXPLICIT signal: the user-configured
    // hc:nostrmesh:relays list or the allow-loopback flag. Membership in
    // this.relays is not a signal — every relay we are asked about came
    // from this.relays, so that check passed unconditionally and let the
    // seeded loopback default through on production.
    if (this.isLocalContext()) return true
    if (this.userConfiguredRelays().includes(relay)) return true
    if (this.allowLoopbackRelay()) return true
    return false
  }

  private userConfiguredRelays = (): string[] => {
    // Only the explicit hc:nostrmesh:relays override counts — never seeds.
    try {
      const raw = localStorage.getItem('hc:nostrmesh:relays')
      const parsed = raw ? JSON.parse(raw) : null
      if (!Array.isArray(parsed)) return []
      return parsed.filter((u: any) => typeof u === 'string').map((u: string) => u.trim())
    } catch { return [] }
  }

  private isLocalContext = (): boolean => {
    // True when the app itself is being served from a local-development
    // origin. Used by loadRelays to prefer LOCAL_RELAY over LIVE_RELAY
    // when the operator is testing on the same machine that hosts the
    // relay — avoids round-tripping their own events through Cloudflare.
    try {
      const host = String(window?.location?.hostname ?? '').toLowerCase()
      if (!host) return false
      if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true
      if (host.endsWith('.local')) return true
      return false
    } catch {
      return false
    }
  }

  private isLoopbackRelay = (relay: string): boolean => {
    try {
      const u = new URL(relay)
      const h = String(u.hostname ?? '').trim().toLowerCase()
      return h === 'localhost' || h === '127.0.0.1' || h === '::1'
    } catch {
      return false
    }
  }

  private allowLoopbackRelay = (): boolean => {
    try { return localStorage.getItem('hc:nostrmesh:allow-loopback') === '1' } catch { return false }
  }

  // -----------------------------
  // inbound routing
  // -----------------------------

  private onMessage = (relay: string, data: any): void => {
    if (typeof data !== 'string' || !data) return

    this.stats.msgIn++

    const msg = this.tryJson(data)
    if (!Array.isArray(msg) || msg.length < 1) {
      this.stats.parseFail++
      this.note('in:parse-fail', relay, undefined, undefined, undefined, data)
      return
    }

    const type = String(msg[0] ?? '')

    // A relay whose FIRST frame is not its card never sends one (an older
    // build, a third-party relay): it hosts nobody's bytes. Said once, so the
    // swarm's last-resort host is "none" — the status line says why — rather
    // than "not heard yet" for ever.
    if (!this.#participantsByRelay.has(relay) && !(type === 'NOTICE' && String(msg[1] ?? '').startsWith('hc:host '))) {
      this.#participantsByRelay.set(relay, false)
      this.emitEffect('mesh:host-card', { relay, participants: false })
    }

    if (type === 'NOTICE') {
      this.stats.msgNoticeIn++
      this.note('in:notice', relay, undefined, undefined, undefined, msg[1])
      const noticeText = String(msg[1] ?? '')
      // The relay's card, its first frame on every connection: its clock and
      // whether it hosts participants' bytes. It rides the first flight — no
      // round trip, and nothing ever waits for it; an older relay simply
      // never sends one.
      if (noticeText.startsWith('hc:host ')) {
        this.#onHostCard(relay, noticeText.slice('hc:host '.length))
        return
      }
      // Drop NOTICEs are the relay telling us our events are being thrown
      // away ('rate-limited', 'message too large'). Swallowing them is how
      // the swarm union silently went one-sided — a publisher's layer
      // events vanished and nothing anywhere said so. Loud in the console;
      // the note() ring above keeps the full history for diagnostics.
      if (/rate-limited|too large/i.test(noticeText)) {
        console.warn(`[nostr-mesh] relay ${relay} is DROPPING our messages: "${noticeText}" — published events are not reaching peers`)
      }
      // A refused REQ is a subscription that never existed: no replay, no
      // live events, and the caller believes it is listening. This was the
      // "swarm goes deaf after a while" — the relay capped subscriptions at
      // 20 and a session crossed it in ordinary use. Loud, with the count,
      // so the next report names the cause.
      if (/too many subscriptions/i.test(noticeText)) {
        console.warn(`[nostr-mesh] relay ${relay} REFUSED a subscription: "${noticeText}" — ${this.bucketsBySig.size} open here; events for the newest subscription will never arrive`)
      }
      return
    }

    // NIP-01: a refused or ended subscription arrives as CLOSED with a
    // prefixed reason. It is not a NOTICE — it names the subscription, so
    // we know exactly which bucket is deaf. auth-required: is answered by
    // the AUTH branch below; anything else (a rate limit, a cap that may
    // free up) is retried per bucket after 1 s · 2^n plus jitter, capped at
    // 30 s, until an EOSE says the subscription stands. It used to be a
    // fixed 5 s for every refused bucket on every client behind one venue
    // address — all of them spending the shared budget again in lockstep.
    if (type === 'CLOSED') {
      const subId = String(msg[1] ?? '')
      const reason = String(msg[2] ?? '')
      const bucket = this.bucketsBySubId.get(subId)
      this.stats.msgOtherIn++
      this.note('in:closed', relay, bucket?.sig, subId, undefined, reason)
      if (!bucket) return
      console.warn(`[nostr-mesh] relay ${relay} CLOSED subscription ${subId}: "${reason}" — ${this.bucketsBySig.size} open here`)
      if (/too many subscriptions/i.test(reason)) this.#setRefusal('subscriptions', subId)
      if (reason.startsWith('auth-required:')) return
      // A standing answer: the read names no signature, or is malformed (the
      // relay's address gate — only signatures can be queried). Asking again
      // changes nothing, so the bucket is not retried; a resubscribe asks anew.
      if (reason.startsWith('restricted:') || reason.startsWith('invalid:')) return
      const base = Math.min(CLOSED_RETRY_CAP_MS, 1000 * (2 ** Math.min(bucket.closedN, 15)))
      const waitMs = Math.min(CLOSED_RETRY_CAP_MS, base + Math.floor(base * 0.3 * Math.random()))
      bucket.closedN++
      if (bucket.retryTimer) clearTimeout(bucket.retryTimer)
      bucket.retryTimer = setTimeout(() => {
        bucket.retryTimer = undefined
        if (this.stopped || this.bucketsBySubId.get(subId) !== bucket) return
        this.sendReq(relay, bucket)
      }, waitMs)
      return
    }

    // NIP-01: every published event gets an OK. A false one means the
    // relay threw it away, and the reason's prefix says why.
    if (type === 'OK') {
      const id = String(msg[1] ?? '')
      const accepted = msg[2] === true
      const reason = String(msg[3] ?? '')
      this.stats.msgOtherIn++
      if (this.debug || !accepted) this.note('in:ok', relay, undefined, undefined, undefined, { id, accepted, reason })
      this.#onOk(relay, id, accepted, reason)
      return
    }

    // NIP-42: the relay wants proof of our key. Sign the challenge with the
    // same signer publishes use, then re-ask for every bucket — the REQs
    // sent before the handshake were CLOSED auth-required.
    if (type === 'AUTH') {
      const challenge = String(msg[1] ?? '')
      this.stats.msgOtherIn++
      this.note('in:auth', relay, undefined, undefined, undefined, challenge)
      if (!challenge) return
      void this.answerAuth(relay, challenge)
      return
    }

    if (type === 'EOSE') {
      const subId = String(msg[1] ?? '')
      const bucket = this.bucketsBySubId.get(subId)
      if (bucket) {
        bucket.closedN = 0
        if (this.#refusal?.subId === subId) this.#clearRefusal()
        this.resolveReadyWaiters(bucket.sig)
      }

      this.stats.msgOtherIn++
      if (this.debug) this.note('in:eose', relay, bucket?.sig, subId)
      return
    }

    if (type !== 'EVENT') {
      this.stats.msgOtherIn++
      if (this.debug) this.note('in:other', relay, undefined, undefined, undefined, msg)
      return
    }

    this.stats.msgEventIn++

    const subId = String(msg[1] ?? '')
    const evt = msg[2] as NostrEvent | undefined
    if (!subId || !evt) return

    this.#absorbOwn(evt)

    const bucket = this.bucketsBySubId.get(subId)
    if (!bucket) {
      this.stats.noBucket++
      if (this.debug) this.note('in:no-bucket', relay, undefined, subId, undefined, evt)
      return
    }

    // note: optional kind filter
    if (Array.isArray(this.kinds) && this.kinds.length > 0) {
      if (!this.kinds.includes(Number(evt.kind ?? 0))) return
    }

    // note: dedupe by event id within this bucket (across relays)
    if (evt.id) {
      const id = String(evt.id)
      if (bucket.seen.has(id)) {
        this.stats.dupDrop++
        return
      }
      bucket.seen.add(id)
      if (bucket.seen.size > SEEN_CAP) {
        const oldest = bucket.seen.values().next().value
        if (oldest !== undefined) bucket.seen.delete(oldest)
      }
    }

    const payload = this.parsePayload(evt)

    // note: cache first so heartbeat queries see it immediately
    this.cacheItem(relay, bucket.sig, evt, payload)
    this.resolveReadyWaiters(bucket.sig)

    const out: MeshEvt = { relay, sig: bucket.sig, event: evt, payload }

    for (const cb of bucket.cbs) {
      try { cb(out) } catch { /* ignore */ }
    }
  }

  private cacheItem = (relay: string, sig: string, evt: NostrEvent, payload: any): void => {
    const now = Date.now()
    const list = this.itemsBySig.get(sig) ?? []

    // One copy per event id. A reopen replays the relay's window into buckets
    // that forgot what they delivered, and a second bucket at the same sig
    // (a read-back query) sees the same events: the cache keeps the copy it
    // has, re-confirmed. Our own fanout, signed in place, becomes the relay's
    // copy when the relay replays it — that IS the read-back query() wants.
    const id = evt?.id ? String(evt.id) : ''
    const held = id ? list.find(i => i.event?.id === id) : undefined
    if (held) {
      if (relay !== 'local') { held.relay = relay; held.receivedAtMs = now }
      return
    }

    const createdAtMs = Number(evt?.created_at ?? 0) > 0 ? Number(evt.created_at) * 1000 : now
    const item: CachedItem = { relay, sig, event: evt, payload, receivedAtMs: now, createdAtMs }

    list.push(item)

    // note: cap newest by created time
    if (list.length > this.perSigCap) {
      list.sort((a, b) => (b.createdAtMs || b.receivedAtMs) - (a.createdAtMs || a.receivedAtMs))
      list.splice(this.perSigCap)
    }

    this.itemsBySig.set(sig, list)
    this.pruneSigExpired(sig)
  }

  private parsePayload = (evt: NostrEvent): any => {
    const c = String(evt?.content ?? '')
    if (!c) return null

    const j = this.tryJson(c)
    if (j != null) return j

    return c
  }

  private readX = (tags: string[][]): string => {
    for (const t of tags) {
      if (!Array.isArray(t) || t.length < 2) continue
      if (String(t[0]) !== 'x') continue
      return String(t[1] ?? '')
    }
    return ''
  }

  // -----------------------------
  // outbound
  // -----------------------------

  private sendReqToAll = (b: Bucket): void => {
    if (!this.networkEnabled) return
    for (const url of this.sockets.keys()) this.sendReq(url, b)
  }

  private sendReq = (url: string, b: Bucket): void => {
    const ws = this.sockets.get(url)
    if (!ws || ws.readyState !== WebSocket.OPEN) return

    const filter: any = { '#x': [b.sig] }
    // Replay window (see Bucket.sinceSec). The old hardcoded 15-min window
    // silently ate every store-and-forward event published while the reader
    // was offline — the relay HELD the feedback item, but no late REQ ever
    // asked for it, so hosts/routines that weren't online within 15 minutes
    // of the publish read an empty channel forever.
    // The window is measured on the relay's clock: a device minutes fast used
    // to ask for a window that started in the relay's future and got no
    // replay at all.
    const sinceSec = b.sinceSec === undefined ? 900 : b.sinceSec
    if (sinceSec !== null) filter.since = this.nowSec() - Math.max(0, Number(sinceSec) || 0)
    if (Array.isArray(this.kinds) && this.kinds.length > 0) filter.kinds = this.kinds

    this.stats.reqSent++
    this.note('out:req', url, b.sig, b.subId, undefined, filter)

    try { ws.send(JSON.stringify(['REQ', b.subId, filter])) } catch { /* ignore */ }
  }

  // NIP-42 handshake: kind 22242, tags relay + challenge, fresh created_at.
  private answerAuth = async (relay: string, challenge: string): Promise<void> => {
    const evt: NostrEvent = {
      created_at: this.nowSec(),
      kind: 22242,
      tags: [['relay', relay], ['challenge', challenge]],
      content: ''
    }
    const signed = await this.trySign(evt)
    const ws = this.sockets.get(relay)
    if (!signed || !ws || ws.readyState !== WebSocket.OPEN) {
      this.note('auth:skipped', relay, undefined, undefined, undefined, signed ? 'socket not open' : 'no signer')
      return
    }
    try { ws.send(JSON.stringify(['AUTH', signed])) } catch { return }
    this.note('auth:sent', relay)
    for (const bucket of this.bucketsBySig.values()) this.sendReq(relay, bucket)
    this.flushPendingOutbound()
  }

  private sendCloseToAll = (subId: string): void => {
    for (const url of this.sockets.keys()) this.sendClose(url, subId)
  }

  private sendClose = (url: string, subId: string): void => {
    const ws = this.sockets.get(url)
    if (!ws || ws.readyState !== WebSocket.OPEN) return

    this.stats.closeSent++
    this.note('out:close', url, undefined, subId)

    try { ws.send(JSON.stringify(['CLOSE', subId])) } catch { /* ignore */ }
  }

  // Outbound events raced by a connecting socket. Every join used to lose
  // its first publish burst here: mesh:public-changed → connectAll puts the
  // socket in CONNECTING, the swarm's publish walk finishes before onopen,
  // and sendEventToAll skipped every socket — peers saw NOTHING for up to
  // ~75s (the next heartbeat republish). Reads exactly like a dead swarm.
  // Queue the frames instead and flush them the moment a socket opens.
  // Relays dedupe by event id, so a flush to multiple relays is safe.
  // One frame per replaceable slot: a newer publish to a slot replaces the
  // older frame still waiting here.
  private pendingOutbound: Outbound[] = []
  private static readonly PENDING_OUTBOUND_MAX = 64
  private static readonly PENDING_OUTBOUND_TTL_MS = 60_000

  private flushPendingOutbound = (): void => {
    if (this.pendingOutbound.length === 0) return
    const now = Date.now()
    const live = this.pendingOutbound.filter(p => now - p.queuedAtMs <= NostrMeshDrone.PENDING_OUTBOUND_TTL_MS && !this.#expired(p))
    this.pendingOutbound = []
    for (const p of live) {
      let sent = false
      for (const [relay, ws] of this.sockets.entries()) {
        if (ws.readyState !== WebSocket.OPEN) continue
        try { ws.send(p.frame); sent = true; this.#track(relay, p, now) } catch { /* ignore */ }
      }
      if (sent) this.note('out:flush-pending')
      else this.pendingOutbound.push(p)  // still nothing open — keep it
    }
  }

  /** Send to every OPEN relay socket. Returns true when the frame reached
   *  (or was queued for) at least one relay, or when zero relays are
   *  configured (deliberate local-only mode). False = dropped. A frame that
   *  reached a socket is held until that relay's OK (see #onOk). */
  private sendEventToAll = (evt: NostrEvent): boolean => {
    const out = this.#outbound(evt)

    this.stats.eventSent++

    let sent = false
    const now = Date.now()
    for (const [relay, ws] of this.sockets.entries()) {
      if (!this.networkEnabled) return false
      if (ws.readyState !== WebSocket.OPEN) continue
      try { ws.send(out.frame); sent = true; this.#track(relay, out, now) } catch { /* ignore */ }
    }
    if (sent) return true
    if (this.relays.length === 0) return true  // local-only by configuration
    // Relays configured but nothing OPEN (connecting / backing off) —
    // queue for the next socket open instead of dropping silently.
    this.#queueOutbound(out)
    this.note('out:queued-pending')
    return true
  }

  // -----------------------------
  // delivery (acks, retries, requeue)
  // -----------------------------

  #outbound = (evt: NostrEvent): Outbound => {
    const kind = Number(evt?.kind ?? 0)
    const exp = Number((evt?.tags ?? []).find(t => Array.isArray(t) && t[0] === 'expiration')?.[1])
    const slot = slotOf(kind, evt?.tags)
    const xs = (evt?.tags ?? []).filter(t => Array.isArray(t) && t[0] === 'x').map(t => String(t[1] ?? '')).join(',')
    return {
      frame: JSON.stringify(['EVENT', evt]),
      id: String(evt?.id ?? ''),
      kind,
      slot,
      lane: slot === undefined ? undefined : `${slot}\0${xs}`,
      exp: Number.isFinite(exp) && exp > 0 ? exp : undefined,
      createdAt: Number(evt?.created_at) || 0,
      queuedAtMs: Date.now(),
    }
  }

  #expired = (o: Outbound): boolean => o.exp !== undefined && o.exp <= this.nowSec()

  // Hold a frame sent on `relay` until its OK. A newer frame for the same
  // slot drops the older one: a retry of a superseded event would only
  // spend budget on something the relay must refuse as stale.
  #track = (relay: string, o: Outbound, now: number): void => {
    if (!o.id) return
    const key = `${relay}\0${o.id}`
    const prior = this.#inflight.get(key)
    if (prior) { prior.sentAtMs = now; return }
    if (o.lane) {
      for (const [k, e] of this.#inflight) {
        if (e.relay === relay && e.lane === o.lane && e.createdAt < o.createdAt) this.#dropInflight(k)
      }
    }
    if (this.#inflight.size >= INFLIGHT_MAX) {
      const oldest = this.#inflight.keys().next().value
      if (oldest !== undefined) this.#dropInflight(oldest)
    }
    const { frame, id, kind, slot, lane, exp, createdAt, queuedAtMs } = o
    this.#inflight.set(key, { frame, id, kind, slot, lane, exp, createdAt, queuedAtMs, relay, sentAtMs: now, attempts: 0 })
  }

  #dropInflight = (key: string): void => {
    const e = this.#inflight.get(key)
    if (!e) return
    if (e.timer) clearTimeout(e.timer)
    this.#inflight.delete(key)
  }

  #purgeInflight = (now: number): void => {
    for (const [k, e] of this.#inflight) {
      if (now - e.queuedAtMs > INFLIGHT_TTL_MS) this.#dropInflight(k)
    }
  }

  // A retired socket's unanswered frames go back in the queue for the next
  // open — the half-open socket swallowed them while publish() said true.
  #requeueInflight = (relay: string): void => {
    const now = Date.now()
    for (const [k, e] of this.#inflight) {
      if (e.relay !== relay) continue
      this.#dropInflight(k)
      if (now - e.queuedAtMs < INFLIGHT_TTL_MS) this.#queueOutbound(e)
    }
  }

  #queueOutbound = (o: Outbound): void => {
    if (o.id && this.pendingOutbound.some(p => p.id === o.id)) return
    if (o.lane) {
      if (this.pendingOutbound.some(p => p.lane === o.lane && p.createdAt > o.createdAt)) return
      this.pendingOutbound = this.pendingOutbound.filter(p => p.lane !== o.lane)
    }
    if (this.pendingOutbound.length >= NostrMeshDrone.PENDING_OUTBOUND_MAX) this.pendingOutbound.shift()
    const { frame, id, kind, slot, lane, exp, createdAt, queuedAtMs } = o
    this.pendingOutbound.push({ frame, id, kind, slot, lane, exp, createdAt, queuedAtMs })
  }

  // NIP-01 OK. true or 'duplicate:' — delivered. 'rate-limited:' — sent
  // again after 1, 2, 4, 8, 15 s (plus jitter), at most five times, unless a
  // newer publish superseded the slot or the event expired. Anything else is
  // final: announced as mesh:rejected so the publisher can un-stamp its memo
  // and the status line can say why ('too far in the future' also marks the
  // connection refused: 'clock').
  #onOk = (relay: string, id: string, accepted: boolean, reason: string): void => {
    const key = `${relay}\0${id}`
    const entry = this.#inflight.get(key)

    if (accepted || reason.startsWith('duplicate:')) {
      this.#dropInflight(key)
      if (this.#refusal?.reason === 'clock') this.#clearRefusal()
      const taken = this.#takenWaiters.get(id)
      if (taken) {
        this.#takenWaiters.delete(id)
        try { taken() } catch { /* the caller's own trouble */ }
      }
      return
    }

    if (reason.startsWith('rate-limited:') && entry && entry.attempts < RATE_RETRY_MS.length && !this.#expired(entry)) {
      const base = RATE_RETRY_MS[entry.attempts]
      if (entry.timer) clearTimeout(entry.timer)
      entry.timer = setTimeout(() => this.#resend(key, entry), base + Math.floor(base * 0.3 * Math.random()))
      this.note('out:retry-scheduled', relay, undefined, undefined, entry.kind, { id, attempt: entry.attempts + 1 })
      return
    }

    this.#dropInflight(key)
    this.#takenWaiters.delete(id)
    if (/too far in the future/i.test(reason)) this.#setRefusal('clock')
    this.stats.rejected++
    console.warn(`[nostr-mesh] relay ${relay} REJECTED event ${id.slice(0, 12)}: "${reason}"`)
    // `d` names the replaceable slot (kind\0d) so the publisher can un-stamp
    // the memo that says it was sent.
    const d = entry?.slot ? entry.slot.slice(entry.slot.indexOf('\0') + 1) : undefined
    this.emitEffect('mesh:rejected', d !== undefined ? { id, kind: entry?.kind ?? 0, reason, d } : { id, kind: entry?.kind ?? 0, reason })
  }

  #resend = (key: string, entry: Inflight): void => {
    entry.timer = undefined
    if (this.#inflight.get(key) !== entry) return   // answered, superseded or requeued meanwhile
    if (this.#expired(entry)) { this.#dropInflight(key); return }
    entry.attempts++
    const ws = this.sockets.get(entry.relay)
    if (!this.networkEnabled || !ws || ws.readyState !== WebSocket.OPEN) {
      this.#dropInflight(key)
      this.#queueOutbound(entry)
      return
    }
    try { ws.send(entry.frame) } catch { /* the watchdog judges the socket */ }
    entry.sentAtMs = Date.now()
    this.stats.retrySent++
    this.note('out:retry', entry.relay, undefined, undefined, entry.kind, { id: entry.id, attempt: entry.attempts })
  }

  // -----------------------------
  // relay clock and slot floors
  // -----------------------------

  // The 'hc:host' card: {v, time, participants}. The offset is applied only
  // past 2 s — ordinary skew changes nothing. A device found to be FAST asks
  // again for the window it cut short: its first REQs went out before the
  // card arrived, measured on its own clock.
  //
  // A card read late — the main thread busy with boot work while it sat in
  // the task queue — carries that backlog as skew, always in the
  // device-looks-fast direction. When the watchdog's own timer shows the
  // thread was backed up (a tick overdue now, or one that just ran late), a
  // sample that would move the offset that way is not trusted; one that
  // moves it the other way cannot be explained by the backlog and still is.
  #onHostCard = (relay: string, json: string): void => {
    const card = this.tryJson(json)
    const time = Number(card?.time)
    if (!card || !Number.isFinite(time) || time <= 0) return
    const now = Date.now()
    this.#hostCard = { relay, time, participants: card.participants ?? false, atMs: now }
    // Whether this relay hosts participants' bytes — the swarm's LAST-resort
    // upload host (swarm-hosts.ts). Said on the bus so the resolver re-reads
    // it; a repeat of the same policy is no news.
    const participants = card.participants ?? false
    if (this.#participantsByRelay.get(relay) !== participants) {
      this.#participantsByRelay.set(relay, participants)
      this.emitEffect('mesh:host-card', { relay, participants })
    }
    this.#addressedByRelay.set(relay, card.addressed === true)
    const offset = Math.round(time * 1000 + 500 - now)
    const next = Math.abs(offset) > CLOCK_APPLY_MS ? offset : 0
    const prev = this.#clockOffsetMs
    if (next === prev) return
    const backedUp = (this.#tickTimer !== undefined && now - this.#tickDueMs > CARD_LAG_MS)
      || (now - this.#lastTickAtMs < 2_000 && this.#lastTickLagMs > CARD_LAG_MS)
    if (backedUp && next < prev) {
      this.note('clock:card-late', relay, undefined, undefined, undefined, { offsetMs: offset })
      return
    }
    this.#clockOffsetMs = next
    this.note('clock:offset', relay, undefined, undefined, undefined, { offsetMs: next })
    if (prev - next > CLOCK_APPLY_MS) {
      for (const bucket of this.bucketsBySig.values()) this.sendReq(relay, bucket)
    }
    this.#emitConnection()
  }

  #raiseFloor = (slot: string, sec: number): void => {
    const cur = this.#slotFloor.get(slot)
    if (cur !== undefined && cur >= sec) return
    this.#slotFloor.delete(slot)
    this.#slotFloor.set(slot, sec)
    if (this.#slotFloor.size > SLOT_FLOOR_CAP) {
      const oldest = this.#slotFloor.keys().next().value
      if (oldest !== undefined) this.#slotFloor.delete(oldest)
    }
  }

  // An event under our own key — our replay, or a tombstone the relay made
  // for us — sets the floor for its slot.
  #absorbOwn = (evt: NostrEvent): void => {
    if (!this.#selfPubkey || evt?.pubkey !== this.#selfPubkey) return
    const kind = Number(evt.kind ?? 0)
    const slot = slotOf(kind, evt.tags)
    const t = Number(evt.created_at)
    if (slot && Number.isFinite(t)) this.#raiseFloor(slot, t)
  }

  // Our key is known once we have signed; anything already cached under it
  // counts toward the floors from then on.
  #learnSelf = (pubkey: string): void => {
    this.#selfPubkey = pubkey
    for (const items of this.itemsBySig.values()) {
      for (const item of items) this.#absorbOwn(item.event)
    }
  }

  /**
   * Host-driven nuke. Sends `["HC_CLEAR"]` to every connected relay and
   * wipes our own in-memory item cache so the local view immediately
   * reflects the empty store. The HC_CLEAR message is a dev-only
   * extension recognised by `scripts/local-relay.ts`; compliant public
   * relays will treat it as an unknown frame and ignore it. The local
   * cache wipe is unconditional and helps when the user was looking at
   * cached peer state that had drifted from the relay.
   *
   * Public so MeshClearQueenBee (the `/clear-mesh` slash command) can
   * invoke it directly without going through the effect bus.
   */
  /**
   * Host-driven block. Sends `["HC_BLOCK", pubkey]` to every relay so
   * the relay drops every cached event from that pubkey and refuses
   * future EVENT messages from it. Pubkey may be a full 64-hex or a
   * short prefix (8–16 hex) — the relay handles both. Wipes any
   * matching events from our local cache too. Idempotent.
   */
  public sendHcBlock = (pubkey: string): { sent: number; cachedWiped: number } => {
    const pk = String(pubkey ?? '').trim().toLowerCase()
    if (!/^[0-9a-f]{8,64}$/.test(pk)) {
      console.warn('[nostr-mesh] sendHcBlock: invalid pubkey', pk)
      return { sent: 0, cachedWiped: 0 }
    }
    const frame = JSON.stringify(['HC_BLOCK', pk])
    let sent = 0
    for (const ws of this.sockets.values()) {
      if (ws.readyState !== WebSocket.OPEN) continue
      try { ws.send(frame); sent++ } catch { /* ignore */ }
    }
    // Wipe matching events from our own cache so the swarm view drops
    // immediately. Mirror the relay's prefix-matching behaviour.
    let cachedWiped = 0
    for (const [sig, arr] of this.itemsBySig) {
      const filtered = arr.filter(it => {
        const evtPk = String(it?.event?.pubkey ?? '').toLowerCase()
        const match = pk.length === 64 ? evtPk === pk : evtPk.startsWith(pk)
        if (match) cachedWiped++
        return !match
      })
      if (filtered.length !== arr.length) this.itemsBySig.set(sig, filtered)
    }
    this.note('hc-block:sent', undefined, undefined, undefined, undefined)
    return { sent, cachedWiped }
  }

  public sendHcClear = (): { sent: number; cachedBefore: number } => {
    const cachedBefore = this.itemsBySig.size
    const frame = JSON.stringify(['HC_CLEAR'])
    let sent = 0
    for (const ws of this.sockets.values()) {
      if (ws.readyState !== WebSocket.OPEN) continue
      try { ws.send(frame); sent++ } catch { /* ignore */ }
    }
    // Wipe local cache so peer views drop immediately (don't wait for
    // the relay's broadcast NOTICE — that's an opportunistic UI hint).
    this.itemsBySig.clear()
    this.note('hc-clear:sent', undefined, undefined, undefined, undefined)
    return { sent, cachedBefore }
  }

  private fanoutToSig = (relay: string, sig: string, evt: NostrEvent): void => {
    // note: always cache local fanout too so heartbeat queries see local publishes
    const payload = this.parsePayload(evt)
    this.cacheItem(relay, sig, evt, payload)

    const bucket = this.bucketsBySig.get(sig)
    if (!bucket || bucket.cbs.size === 0) return

    this.stats.localFanout++

    const out: MeshEvt = { relay, sig, event: evt, payload }

    for (const cb of bucket.cbs) {
      try { cb(out) } catch { /* ignore */ }
    }
  }

  #bucket = (sig: string, sinceSec?: number | null): Bucket => ({
    sig,
    subId: this.makeSubId(),
    cbs: new Set<MeshCb>(),
    sinceSec,
    seen: new Set<string>(),
    closedN: 0,
  })

  private closeBucket = (b: Bucket): void => {
    if (b.retryTimer) { clearTimeout(b.retryTimer); b.retryTimer = undefined }
    this.sendCloseToAll(b.subId)
    this.bucketsBySig.delete(b.sig)
    this.bucketsBySubId.delete(b.subId)
    this.note('sub:closed', undefined, b.sig, b.subId)
  }

  private unsubscribe = (sig: string, cb: MeshCb): void => {
    const b = this.bucketsBySig.get(sig)
    if (!b) return

    b.cbs.delete(cb)
    this.note('sub:leave', undefined, sig, b.subId, undefined, { consumers: b.cbs.size })

    if (b.cbs.size > 0) return
    this.closeBucket(b)
  }

  // -----------------------------
  // expiry (mesh-owned)
  // -----------------------------

  private pruneAllExpired = (): void => {
    for (const sig of this.itemsBySig.keys()) this.pruneSigExpired(sig)
  }

  private pruneSigExpired = (sig: string): void => {
    const list = this.itemsBySig.get(sig)
    if (!list || list.length === 0) return

    const now = Date.now()
    const keep = list.filter(i => {
      const t = i.receivedAtMs || i.createdAtMs || 0
      const ttlMs = this.resolveTtlMs(sig, i.event)
      return t > 0 && (now - t) <= ttlMs
    })

    if (keep.length === 0) {
      this.itemsBySig.delete(sig)
      return
    }

    this.itemsBySig.set(sig, keep)
  }

  // -----------------------------
  // signing (delegated)
  // -----------------------------

  private trySign = async (evt: NostrEvent): Promise<NostrEvent | null> => {
    // note: if already signed, pass through
    if (evt?.id && evt?.pubkey && evt?.sig) return evt

    // note: nip-07 if available
    const anyWin = window as any
    if (anyWin?.nostr?.signEvent) {
      try {
        const signed = await anyWin.nostr.signEvent(evt)
        return signed ?? null
      } catch { /* ignore */ }
    }

    const signer = this.resolve<any>('signer')
    if (signer?.signEvent) {
      try {
        const signed = await signer.signEvent(evt)
        return signed ?? null
      } catch { /* ignore */ }
    }

    return null
  }

  // -----------------------------
  // helpers
  // -----------------------------


  private loadNetworkEnabled(): boolean {
  try {
    // Master privacy switch: THIS TAB's swarm membership (membership.ts —
    // per tab, so a second tab booting private can no longer silence a
    // joined one). Not joined means zero mesh network — no relay
    // subscriptions, no publishes, no boot-time WebSocket bootstrap. The
    // local `hc:nostrmesh:network` key is a finer-grained opt-OUT, never
    // an opt-IN: a joined tab has already consented to mesh networking,
    // so the network defaults ON unless explicitly disabled via `'0'`.
    //
    // Why the asymmetry: the OLD behaviour was "public on AND
    // hc:nostrmesh:network='1' AND `hc:nostrmesh:relays` set". A fresh
    // incognito tab that joined via the UI would have
    // `hc:nostrmesh:network` UNSET → fall through → networkEnabled
    // stayed false, mesh never opened sockets, no peer events ever
    // arrived. The user saw their tiles never sync and concluded "the
    // mesh is broken". Treating absence as opt-in (default ON when
    // joined) makes the join self-sufficient. Users who want
    // fine-grained off without leaving still have the explicit `'0'`.
    if (!isJoinedHere()) return false
    const v = localStorage.getItem('hc:nostrmesh:network')
    if (v === '0') return false
    return true
  } catch {}
  // Storage unavailable: default to OFF so we never surprise-connect.
  return false
}


  private pauseNetwork = (): void => {
  this.#stopTick()

  for (const [url, st] of this.backoff.entries()) {
    if (st.timer) clearTimeout(st.timer)
    this.backoff.delete(url)
  }

  this.#dropAllStandby('pause')
  this.#closeDraining()
  for (const [url, ws] of this.sockets.entries()) {
    try { ws.onopen = null; ws.onmessage = null; ws.onerror = null; ws.onclose = null } catch {}
    try { ws.close() } catch {}
    this.#live.delete(ws)
    this.sockets.delete(url)
    this.note('socket:pause', url)
  }

  // Leaving is not a blip: frames still awaiting an OK — or still queued
  // for a socket that never opened — are not owed to anyone any more. A
  // later join (perhaps into another room) must never carry them out. The
  // next join is a first open, not a reopen.
  for (const key of Array.from(this.#inflight.keys())) this.#dropInflight(key)
  this.pendingOutbound = []
  this.#everOpen = false

  // Reset every bucket's event-id dedupe set on pause. The
  // replaceable-event slot at the relay survives our disconnect;
  // when we come back online (re-toggle to public) the relay
  // replays its latest stored event for our resubscribe — but the
  // publisher's heartbeat may not have re-fired yet, so the event
  // ID is identical to the one we already saw in the previous
  // session. Without this clear, `onMessage` would treat it as a
  // duplicate and silently drop it, leaving SwarmDrone's peer
  // cache empty until the publisher's next heartbeat (up to 30s).
  // Clearing here means the replay always reaches consumers; the
  // worst case is a single duplicate emission if the user toggles
  // rapidly, which is benign — replaceable caches converge.
  for (const bucket of this.bucketsBySubId.values()) bucket.seen.clear()

  this.#emitConnection()
}

  private loadDebugFlag = (): boolean => {
    try { return localStorage.getItem('hc:nostrmesh:debug') === '1' } catch { return false }
  }

  private loadRelays = (fallback: string[]): string[] => {
    // Seed policy is origin-aware:
    //
    //   local origin → LOCAL_RELAY. The dev relay (scripts/local-relay.ts)
    //   serves the WS mesh AND HTTP content on one port and persists content
    //   across restarts, so two loopback tabs share a fully self-contained
    //   swarm with no per-tab setup.
    //
    //   real host → LIVE_RELAY. Seeding LOCAL_RELAY here was a bug twice
    //   over: every visitor dialed a dead loopback socket on infinite
    //   backoff, AND a public origin touching localhost trips Chrome's
    //   Local Network Access permission prompt at page open.
    //
    //   'hc:nostrmesh:use-live-relay' — '1' forces LIVE_RELAY anywhere,
    //   '0' opts out of it: a real host then idles with ZERO relays
    //   (publishes hit local fanout only) rather than falling back to
    //   loopback. 'hc:nostrmesh:relays' (explicit list) wins over both.
    //
    // IIFE on purpose: an inlined `let` here lets esbuild constant-propagate
    // the flag into the seed expression, dead-code-eliminating a LIVE_RELAY
    // or LOCAL_RELAY branch and removing the literal from the bundle.
    // Wrapping the read in an IIFE makes the value opaque to constant
    // propagation — esbuild cannot statically evaluate the return.
    const flag = ((): string | null => {
      try { return localStorage.getItem('hc:nostrmesh:use-live-relay') } catch { return null }
    })()
    const seed =
      flag === '1' ? [LIVE_RELAY]
      : this.isLocalContext() ? [LOCAL_RELAY]
      : flag === '0' ? []
      : [LIVE_RELAY]
    const defaults = fallback.length > 0 ? fallback : seed
    try {
      const raw = localStorage.getItem('hc:nostrmesh:relays')
      if (!raw) return defaults.slice()

      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return defaults.slice()

      const next = parsed
        .filter((u: any) => typeof u === 'string')
        .map((u: string) => u.trim())
        .filter((u: string) => u.startsWith('ws://') || u.startsWith('wss://'))

      if (next.length === 0) return defaults.slice()

      // Stale-dev-list guard. A loopback-only override left over from a
      // dev session (hc:nostrmesh:relays=["ws://localhost:7777"]) WINS on
      // a real host forever: the loopback passes canAttemptRelay (it is
      // user-configured), the live seed is never dialed, and the client
      // is silently deaf while every publish still "succeeds". When the
      // whole override is loopback on a real host, dial the live seed
      // ALONGSIDE it — unless the operator explicitly claimed loopback
      // intent with hc:nostrmesh:allow-loopback='1' or opted out of the
      // live relay with use-live-relay='0'.
      const allLoopback = next.every(u => this.isLoopbackRelay(u))
      if (allLoopback && !this.isLocalContext() && flag !== '0' && !this.allowLoopbackRelay()) {
        this.note('relay:loopback-override-augmented', LIVE_RELAY)
        return Array.from(new Set([...next, LIVE_RELAY]))
      }
      return Array.from(new Set(next))
    } catch {
      return defaults.slice()
    }
  }

  private saveRelays = (urls: string[]): void => {
    try { localStorage.setItem('hc:nostrmesh:relays', JSON.stringify(urls)) } catch { /* ignore */ }
  }

  private loadKinds = (fallback: number[] | null): number[] | null => {
    try {
      const raw = localStorage.getItem('hc:nostrmesh:kinds')
      if (!raw) return fallback

      const parsed = JSON.parse(raw)
      if (parsed === null) return null
      if (!Array.isArray(parsed)) return fallback

      const next = parsed
        .map((k: any) => Number(k))
        .filter((k: number) => Number.isFinite(k) && k > 0)
        .sort((a: number, b: number) => a - b)

      const uniq = Array.from(new Set(next))
      return uniq.length ? uniq : fallback
    } catch {
      return fallback
    }
  }

  private saveKinds = (kinds: number[] | null): void => {
    try { localStorage.setItem('hc:nostrmesh:kinds', JSON.stringify(kinds)) } catch { /* ignore */ }
  }

  // fix: must be a real method (not an arrow-field) so it can be used during field initialization
  private newStats(): MeshStats {
    return {
      startedAtMs: 0,
      socketsOpened: 0,
      socketsClosed: 0,
      socketsErrors: 0,
      reqSent: 0,
      closeSent: 0,
      eventSent: 0,
      localFanout: 0,
      msgIn: 0,
      msgEventIn: 0,
      msgNoticeIn: 0,
      msgOtherIn: 0,
      parseFail: 0,
      noBucket: 0,
      sendSkippedNoSigner: 0,
      dupDrop: 0,
      probeSent: 0,
      retired: 0,
      retrySent: 0,
      rejected: 0
    }
  }

  private note = (type: string, relay?: string, sig?: string, subId?: string, kind?: number, data?: any): void => {
    if (!this.debug) return

    const entry: MeshLog = { atMs: Date.now(), type, relay, sig, subId, kind, data }

    this.logs.push(entry)
    if (this.logs.length > this.logCap) this.logs.splice(0, this.logs.length - this.logCap)
  }

  private makeSubId = (): string => {
    const r = Math.random().toString(16).slice(2)
    const t = Date.now().toString(16)
    return `hc-${t}-${r}`
  }

  private tryJson = (s: string): any => {
    try { return JSON.parse(s) } catch { return null }
  }

  private sanitizeExpiryRules = (rules: MeshExpiryRule[]): MeshExpiryRule[] => {
    const out: MeshExpiryRule[] = []

    for (let i = 0; i < rules.length; i++) {
      const src = rules[i]
      if (!src || typeof src !== 'object') continue

      const ttl = Number((src as any).ttlMs ?? 0)
      if (!Number.isFinite(ttl) || ttl <= 0) continue

      const idRaw = String((src as any).id ?? '').trim()
      const id = idRaw || `rule-${i + 1}`

      const sigPrefixRaw = String((src as any).sigPrefix ?? '').trim()
      const sigPrefix = sigPrefixRaw ? sigPrefixRaw : undefined

      const kindNum = Number((src as any).kind)
      const kind = Number.isFinite(kindNum) && kindNum > 0 ? Math.floor(kindNum) : undefined

      out.push({
        id,
        ttlMs: Math.floor(ttl),
        sigPrefix,
        kind
      })
    }

    return out
  }

  private ensureDefaultExpiryRule = (): void => {
    const idx = this.expiryRules.findIndex(r => r.id === 'default')
    if (idx >= 0) {
      this.expiryRules[idx] = { id: 'default', ttlMs: this.ttlMs }
      return
    }

    this.expiryRules.push({ id: 'default', ttlMs: this.ttlMs })
  }

  private resolveTtlMs = (sig: string, evt: NostrEvent): number => {
    this.ensureDefaultExpiryRule()

    const kind = Number(evt?.kind ?? 0)
    const s = String(sig ?? '')

    for (const rule of this.expiryRules) {
      if (!rule || !Number.isFinite(rule.ttlMs) || rule.ttlMs <= 0) continue
      if (rule.sigPrefix && !s.startsWith(rule.sigPrefix)) continue
      if (typeof rule.kind === 'number' && Number.isFinite(rule.kind) && rule.kind > 0 && rule.kind !== kind) continue
      return Math.floor(rule.ttlMs)
    }

    return this.ttlMs
  }

  private resolveReadyWaiters = (sig: string): void => {
    const list = this.readyWaitersBySig.get(sig)
    if (!list || list.length === 0) return

    this.readyWaitersBySig.delete(sig)

    for (const waiter of list) {
      if (waiter.timer) {
        try { clearTimeout(waiter.timer) } catch { /* ignore */ }
      }
      try { waiter.resolve() } catch { /* ignore */ }
    }
  }

  private removeReadyWaiter = (sig: string, waiter: SigReadyWaiter): void => {
    const list = this.readyWaitersBySig.get(sig)
    if (!list || list.length === 0) return

    const idx = list.indexOf(waiter)
    if (idx < 0) return

    list.splice(idx, 1)
    if (list.length === 0) this.readyWaitersBySig.delete(sig)
  }
}

const meshDrone = new NostrMeshDrone()
window.ioc.register('@diamondcoreprocessor.com/NostrMeshDrone', meshDrone)