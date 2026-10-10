// sharing/swarm-hosts.ts
//
// WHERE A SHARED PAGE'S BYTES GO — the swarm's upload host, per page.
//
// jwize, 2026-10-07: "I thought we only use pools but maybe if publish domains
// take precedence over pools that would be fine too … but sure on your relay."
// The upload host is no longer derived from the relay URL by default (that made
// one person's relay everyone's host). For the page being offered, in order:
//
//   1. PUBLISH DOMAINS — the `host:<zone>` marks worn by the nearest branch at
//      or above the page (community-hosts.ts), every one of them, primary
//      first: the same write doors a publish of that branch uses.
//   2. THE MEETING HOST — the host the meeting this tab is in named: its
//      meeting link's `host`, or the facilitator's own meeting point
//      (sessionStorage `hc:mesh-zone`, membership.ts — this tab's, so a
//      reload keeps it and another tab's meeting never moves it). Like a
//      publish domain it is an explicit choice, never passed over.
//   3. THE HOSTS POOL — the participant's `community:hosts` pool (HostsDrone
//      seeds hypercomb.com into an empty one): its PRIMARY, the host added
//      first. A pool host that failed this session (it refused, is full,
//      answered a page where a heap answers bytes, or did not answer while
//      the relay did) is passed over for the next one — a host that cannot
//      take uploads must never strand every tile as a name. THIS TAB
//      remembers the pass-over across a reload (sessionStorage, an hour at
//      most, a handful of hosts): a reload must not make the failed host
//      primary again and strand the room for another round of failures. A
//      receipt from it, or the participant's retry, forgets it.
//   4. THE RELAY YOU MEET AT — only when 1-3 have nothing usable, and only
//      when that relay's `hc:host` card said participants 'all' or 'zones'.
//
// HOT PATH: `hostsFor` is SYNCHRONOUS and reads caches only. Connect, join,
// resubscribe and announce never wait on a pool or a layer read: a miss kicks
// a local read and answers PENDING (no host yet); the read landing dispatches
// 'change', and the owner (host-sync) re-drains and the swarm walks again. The
// caches refresh on the inputs' own change signals — `hosts:render` (the pool),
// `hosts:marks-changed` / `decorations:changed` (a branch's marks),
// `mesh:host-card` (the relay's policy) and the tab becoming visible again (a
// change made in another tab). No network, ever.
//
// A loopback host is a write door only for a page that is itself loopback:
// nobody else can fetch from it, so on a real origin it is skipped and the next
// source answers (the rule the mesh applies to a loopback relay).

import { EffectBus } from '@hypercomb/core'
import { HOSTS_SEEDED_KEY, hostZone, hostsOfBranchKnown, listCommunityHostsInAddedOrder } from './community-hosts.js'
import { foldContentLabel, isLoopbackHost } from './zone-door.js'
import { tabMeetingHost } from './membership.js'

export type SwarmHostSource = 'publish' | 'meeting' | 'pool' | 'relay' | 'none'

/** Where one page's bytes go. `hosts` are write doors, primary first. */
export interface SwarmHostChoice {
  readonly hosts: readonly string[]
  readonly source: SwarmHostSource
  /** An input it depends on has not been read yet (a branch's marks, the
   *  pool, the relay's card): no host until it has. */
  readonly pending: boolean
  /** Pool hosts passed over because they failed this session, in pool order
   *  — the status line can say why the bytes went elsewhere. */
  readonly passedOver?: readonly string[]
}

/** What the resolver reads. Every read is local; none is on the hot path. */
export interface SwarmHostDeps {
  /** The hosts pool, PRIMARY FIRST, or null while it cannot be read yet. */
  readPool(): Promise<readonly string[] | null>
  /** The host marks ONE cell wears, primary first; null while unknown (a
   *  cold history read, a decoration record not here yet). `lenient`: take a
   *  missing record as absent. */
  readMarks(segments: readonly string[], lenient?: boolean): Promise<readonly string[] | null>
  /** The relay this tab meets at, and its card's participant policy
   *  (undefined: no card heard yet). */
  relay(): { host: string; participants: unknown }
  /** Is this page itself loopback? */
  originLoopback(): boolean
  /** The meeting host this tab's meeting named ('' when none). A local,
   *  synchronous read. */
  meetingHost?(): string
  /** THIS TAB's session storage — where a passed-over pool host is
   *  remembered across a reload. Absent or null: this page only. */
  session?(): SessionLike | null
}

/** The part of `Storage` the resolver uses (sessionStorage in a tab). */
export type SessionLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const STORE_KEY = '@hypercomb.social/Store'

/** A real host: labels joined by dots. */
const HOST_DOMAIN_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/
/** A zone the participant named (a pool host, a publish domain) may carry a
 *  port: a self-hosted machine on :8443 is a zone like any other, exactly as
 *  community-hosts.ts hostZone keeps it. The relay's host may not — a port on
 *  a real relay name is no upload door (only a loopback relay has one). */
const PORT_RE = /:(\d{1,5})$/
const LOOPBACK_HOST_RE = /^(?:(?:[a-z0-9-]+\.)*localhost|127(?:\.\d+){3}|\[::1\])(?::\d{1,5})?$/

/** A read that came back unknown is asked again on its own at this cadence —
 *  and no sooner by a lookup (lookups happen on every walk). */
const RETRY_UNKNOWN_MS = 1_000
/** How many times an unknown pool, or one branch's unknown marks, is asked
 *  again on its own before it waits for the next lookup or change signal. */
const RETRY_UNKNOWN_MAX = 60
/** After this many unknown answers for one branch, a decoration record that
 *  is still not here is taken as absent (a cold history read stays unknown). */
const MARKS_LENIENT_AFTER = 3
/** A decoration change commits a moment after its synchronous notice. */
const MARKS_SETTLE_MS = 300
/** Pages whose marks are remembered, least recently used evicted first. Well
 *  above the pages one join offers on, so a lookup never evicts what the next
 *  lookup needs. */
const MARKS_CACHE_MAX = 4_096
/** Branches re-read when the tab becomes visible (another tab may have moved
 *  their marks): the most recently used. */
const MARKS_REVISIT = 64
/** A pool host passed over is remembered in THIS TAB's session — never
 *  localStorage: another tab, or tomorrow, asks the host afresh — so a reload
 *  does not make it primary again. For at most an hour, and only the most
 *  recent few. */
const DOWN_SESSION_KEY = 'hc:swarm-hosts:down'
const DOWN_REMEMBER_MS = 60 * 60_000
const DOWN_REMEMBER_MAX = 8

const PENDING: SwarmHostChoice = Object.freeze({ hosts: Object.freeze([]) as readonly string[], source: 'none', pending: true })
const NONE: SwarmHostChoice = Object.freeze({ hosts: Object.freeze([]) as readonly string[], source: 'none', pending: false })

const ioc = <T>(key: string): T | undefined =>
  (globalThis as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

/** The resolver's own reads, against the live runtime. */
export const liveSwarmHostDeps: SwarmHostDeps = {
  // EMPTY IS AN ANSWER ONLY WHEN IT IS ONE. A pool the store cannot open yet
  // lists as nothing — that is unknown. So is an empty pool the seed has not
  // reached: a fresh install's pool is hypercomb.com, and reading it a moment
  // early must not make the relay everyone's host. Only a seeded, empty pool
  // means "no hosts" (the participant removed them all, or storage cannot
  // remember a seed).
  readPool: async () => {
    // Null while there is no store or its OPFS root cannot open; the read
    // waits for the open itself (community-hosts.ts), so a boot read settles
    // the moment the store does instead of on the next retry tick.
    if (!ioc<{ getPool?: unknown }>(STORE_KEY)?.getPool) return null
    const zones = await listCommunityHostsInAddedOrder()
    if (zones === null) return null
    if (zones.length > 0) return zones
    let seeded = true
    try { seeded = localStorage.getItem(HOSTS_SEEDED_KEY) === '1' } catch { seeded = true }
    return seeded ? zones : null
  },
  readMarks: async (segments, lenient = false) => {
    try { return await hostsOfBranchKnown(segments, lenient) } catch { return null }
  },
  relay: () => {
    const mesh = ioc<{ swarmHost?: () => string; relayParticipants?: () => unknown }>('@diamondcoreprocessor.com/NostrMeshDrone')
    let host = ''
    let participants: unknown = undefined
    try { host = String(mesh?.swarmHost?.() ?? '') } catch { host = '' }
    try { participants = mesh?.relayParticipants?.() } catch { participants = undefined }
    return { host, participants }
  },
  originLoopback: () => {
    try { return isLoopbackHost(globalThis.location?.host ?? '') } catch { return false }
  },
  meetingHost: () => tabMeetingHost(),
  session: () => {
    try { return globalThis.sessionStorage ?? null } catch { return null }
  },
}

const keyOf = (segments: readonly string[], length: number): string => segments.slice(0, length).join('\u0000')

const sameList = (a: readonly string[] | undefined, b: readonly string[] | undefined): boolean =>
  !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i])

export class SwarmHostResolver extends EventTarget {

  readonly #deps: SwarmHostDeps

  /** The hosts pool as zones, primary first; null = not read yet. */
  #pool: readonly string[] | null = null
  #poolLoading = false
  /** A read asked for while one was in flight: read again when it lands
   *  (the pool changed under the read — an add or a remove). */
  #poolAgain = false
  #poolRetryAt = 0
  #poolTimer: ReturnType<typeof setTimeout> | undefined
  #poolTimerRuns = 0

  /** One cell's marks (raw zones, primary first), by its path — insertion
   *  order is recency (a hit moves the entry to the end). */
  readonly #marks = new Map<string, readonly string[]>()
  readonly #marksLoading = new Set<string>()
  readonly #marksRetryAt = new Map<string, number>()
  /** Branches whose marks came back unknown: asked again on their own. */
  readonly #marksUnknown = new Map<string, { segments: readonly string[]; runs: number }>()
  #marksTimer: ReturnType<typeof setTimeout> | undefined
  /** Paths whose marks a decoration change may have moved — re-read soon. */
  readonly #marksStale = new Map<string, readonly string[]>()
  #staleTimer: ReturnType<typeof setTimeout> | undefined

  /** Hosts that failed this session (host-sync says so), with the reason.
   *  A pool host here is passed over; publish domains are the participant's
   *  explicit choice for a branch and are never passed over. */
  readonly #down = new Map<string, string>()
  /** When each REMEMBERED failure was marked — the ones this tab's session
   *  keeps across a reload (#rememberDown). A failure marked while the path
   *  itself was down is not among them. */
  readonly #downAt = new Map<string, number>()

  /** The relay card's policy as last seen, so a repeat is no change. */
  #relaySeen = ''
  /** Some answer reached the relay step since the card was last seen: only
   *  then does the card change anyone's answer. */
  #relayAsked = false

  /** Inputs a LOOKUP found unread — someone acted on "pending" (a walk sent
   *  names only, a drain had nowhere to go), so their first read is news.
   *  A first read nobody waited on (a warm) changes no one's answer. */
  readonly #askedMarks = new Set<string>()
  #askedPool = false

  #changeQueued = false

  /** Bumped whenever any cached answer may differ — a cheap key for whoever
   *  memoizes over many lookups (host-sync's target set). */
  #version = 0
  get version(): number { this.#meetingDoor(); return this.#version }

  /** The meeting host as last seen, so a change bumps the version (it is a
   *  session read, with no signal of its own besides `mesh:zone`). */
  #meetingSeen: string | undefined = undefined

  constructor(deps: SwarmHostDeps = liveSwarmHostDeps) {
    super()
    this.#deps = deps
    // A reload of this tab keeps the pool hosts it passed over (within the
    // hour): the first answer after a reload must not hand the room back to
    // a host that just proved it takes no uploads.
    this.#restoreDown()
    // THE POOL — HostsDrone emits the list after every read, add and remove,
    // with last-value replay. Its list is alphabetical and its first read can
    // run before the store is open, so it is a SIGNAL, never the answer: the
    // resolver reads the pool itself, in the order the hosts were added.
    EffectBus.on<{ zones?: unknown; loaded?: boolean }>('hosts:render', (p) => {
      if (p?.loaded !== true || !Array.isArray(p.zones)) return
      const zones = (p.zones as unknown[]).map(z => hostZone(z)).filter(Boolean)
      // The same set we hold: nothing moved (the panel opened, a re-read).
      if (this.#pool !== null && zones.length === this.#pool.length && zones.every(z => this.#pool!.includes(z))) return
      this.#refreshPool(true)
    })
    // A BRANCH'S MARKS — the writer says so once its marks have committed.
    EffectBus.on<{ segments?: unknown }>('hosts:marks-changed', (p) => {
      if (!Array.isArray(p?.segments)) return
      const segments = (p.segments as unknown[]).map(String)
      const key = keyOf(segments, segments.length)
      this.#marksRetryAt.delete(key)
      this.#loadMarks(segments, key, true)
    })
    // Any other decoration change (undo, an adopted mark) on a cell we
    // remember: re-read it once the commit has landed.
    EffectBus.on<{ segments?: unknown }>('decorations:changed', (p) => {
      if (!Array.isArray(p?.segments)) return
      const segments = (p.segments as unknown[]).map(String)
      const key = keyOf(segments, segments.length)
      if (!this.#marks.has(key)) return
      this.#marksStale.set(key, segments)
      if (this.#staleTimer !== undefined) return
      this.#staleTimer = setTimeout(() => {
        this.#staleTimer = undefined
        const due = [...this.#marksStale]
        this.#marksStale.clear()
        for (const [k, segs] of due) { this.#marksRetryAt.delete(k); this.#loadMarks(segs, k, true) }
      }, MARKS_SETTLE_MS)
    })
    // THE RELAY'S POLICY — its card arrives in the first frame of a socket.
    // News only to an answer that reached the relay step (an empty or failed
    // pool): a pooled tab's first card must not walk the whole swarm again
    // in the very window a connect is busiest.
    EffectBus.on('mesh:host-card', () => {
      const { host, participants } = this.#deps.relay()
      const seen = `${host} ${String(participants)}`
      if (seen === this.#relaySeen) return
      this.#relaySeen = seen
      this.#version++
      if (!this.#relayAsked) return
      this.#relayAsked = false
      this.#changed()
    })
    // THE MEETING POINT moved (a link joined, the selector, /use-live-relay):
    // its host may have too.
    EffectBus.on('mesh:zone', () => { this.#meetingDoor() })
    // ANOTHER TAB may have changed the pool or a branch's marks (membership is
    // per tab; the caches are this tab's). Coming back to this tab re-reads
    // them; an unchanged answer is no news.
    try {
      globalThis.document?.addEventListener?.('visibilitychange', () => {
        if (globalThis.document?.visibilityState !== 'visible') return
        this.#refreshPool(true)
        const recent = [...this.#marks.keys()].slice(-MARKS_REVISIT)
        for (const key of recent) {
          this.#marksRetryAt.delete(key)
          this.#loadMarks(key ? key.split('\u0000') : [], key, true)
        }
      })
    } catch { /* no document (a worker, a test) — signals only */ }
  }

  /**
   * WHERE THIS PAGE'S BYTES GO — synchronous, from caches. `segments` is the
   * page being offered (its children are the tiles); null or [] is the hive
   * root, which wears no marks. A cache miss kicks a local read and answers
   * pending; the read landing dispatches 'change'.
   */
  readonly hostsFor = (segments: readonly string[] | null | undefined): SwarmHostChoice =>
    this.#resolve(segments, true)

  /** Start reading what `hostsFor(segments)` will need — a page about to be
   *  walked. Never waits, and its reads landing announce nothing on their
   *  own (no answer was given while they were unread). */
  readonly warm = (segments: readonly string[] | null | undefined): void => { void this.#resolve(segments, false) }

  readonly #resolve = (segments: readonly string[] | null | undefined, ask: boolean): SwarmHostChoice => {
    const segs = (segments ?? []).map(s => String(s ?? ''))
    // 1. Publish domains: the nearest branch at or above the page that wears
    //    any. A level not read yet could be the nearest one, so nothing below
    //    it can be trusted until it has been.
    let unknown = false
    for (let n = segs.length; n >= 1; n--) {
      const key = keyOf(segs, n)
      const zones = this.#marks.get(key)
      if (zones === undefined) {
        unknown = true
        if (ask) this.#askedMarks.add(key)
        this.#loadMarks(segs.slice(0, n), key)
        continue
      }
      // Recently used: keep it ahead of eviction.
      this.#marks.delete(key)
      this.#marks.set(key, zones)
      if (unknown) continue
      const doors = this.#usable(zones, true)
      if (doors.length > 0) return { hosts: doors, source: 'publish', pending: false }
    }
    // Unread marks could still name a nearer publish domain: nothing below
    // them can answer yet. The pool is read alongside, so the answer needs
    // one wait, not two.
    if (unknown) {
      if (this.#pool === null) {
        if (ask) this.#askedPool = true
        this.#refreshPool()
      }
      return PENDING
    }
    // 2. The meeting host — the host this tab's meeting named.
    const meeting = this.#meetingDoor()
    if (meeting) return { hosts: [meeting], source: 'meeting', pending: false }
    // 3. The hosts pool: its primary, unless it failed this session.
    if (this.#pool === null) {
      if (ask) this.#askedPool = true
      this.#refreshPool()
      return PENDING
    }
    const pool = this.#usable(this.#pool, true)
    const passedOver = pool.filter(h => this.#down.has(h))
    const primary = pool.find(h => !this.#down.has(h))
    if (primary) return passedOver.length > 0 ? { hosts: [primary], source: 'pool', pending: false, passedOver } : { hosts: [primary], source: 'pool', pending: false }
    // 4. The relay you meet at — last resort, and only when it said so.
    this.#relayAsked = true
    const { host, participants } = this.#deps.relay()
    const door = this.#usable([host])[0]
    const allowed = participants === 'all' || participants === 'zones'
    if (door && allowed) return passedOver.length > 0 ? { hosts: [door], source: 'relay', pending: false, passedOver } : { hosts: [door], source: 'relay', pending: false }
    // Every pool host failed and the relay takes nobody: the primary keeps
    // the page, so its status names the host and why it is not taking bytes.
    if (pool.length > 0) return { hosts: [pool[0]!], source: 'pool', pending: false }
    if (!door) return NONE
    return participants === undefined || participants === null ? PENDING : NONE
  }

  /** The relay this tab meets at, as a write door ('' when none) — whether or
   *  not it hosts anyone. */
  readonly relayHost = (): string => this.#usable([this.#deps.relay().host])[0] ?? ''

  /** Is this door one of the pool's hosts (as this page may use them)? */
  readonly isPoolHost = (host: string): boolean => this.#pool !== null && this.#usable(this.#pool, true).includes(host)

  /** A host failed this session (host-sync: it refused, is full, answered a
   *  page where a heap answers bytes, or did not answer while the relay did).
   *  A pool host is passed over from now on — and, `remember`ed (the
   *  default), across a reload of this tab too (#rememberDown). A failure
   *  that may have been the PATH (no socket open) is this page's only. */
  readonly markDown = (host: string, reason: string, remember = true): void => {
    if (!host) return
    if (this.#down.has(host)) {
      // Already passed over; a later failure the path cannot explain makes a
      // path-time pass-over one to remember.
      if (remember && !this.#downAt.has(host)) { this.#downAt.set(host, Date.now()); this.#rememberDown() }
      return
    }
    this.#down.set(host, reason)
    if (remember) { this.#downAt.set(host, Date.now()); this.#rememberDown() }
    this.#version++
    if (this.isPoolHost(host)) this.#changed()
  }

  /** A host answered again (a receipt, or the participant asked to retry). */
  readonly markUp = (host: string): void => {
    if (!this.#down.delete(host)) return
    if (this.#downAt.delete(host)) this.#rememberDown()
    this.#version++
    if (this.isPoolHost(host)) this.#changed()
  }

  /** Forget every failure — the participant asked to try again. */
  readonly clearDown = (): void => {
    if (this.#down.size === 0) return
    const pooled = [...this.#down.keys()].some(h => this.isPoolHost(h))
    this.#down.clear()
    this.#downAt.clear()
    this.#rememberDown()
    this.#version++
    if (pooled) this.#changed()
  }

  /** Why a host is passed over ('' when it is not). */
  readonly downReason = (host: string): string => this.#down.get(host) ?? ''

  /** The meeting host as a write door ('' when none, or not one this page
   *  may use). A change since the last look bumps the version and is news. */
  readonly #meetingDoor = (): string => {
    let raw = ''
    try { raw = String(this.#deps.meetingHost?.() ?? '') } catch { raw = '' }
    const door = raw ? (this.#usable([raw], true)[0] ?? '') : ''
    const seen = this.#meetingSeen
    this.#meetingSeen = door
    if (seen !== undefined && seen !== door) {
      this.#version++
      this.#changed()
    }
    return door
  }

  // ── caches ──────────────────────────────────────────────────────────────

  /** Raw zones → write doors this page may use: the zone root (never a
   *  `content.` face), loopback only from loopback, a port on a real host
   *  only for a zone the participant named (`named`). */
  readonly #usable = (zones: readonly string[], named = false): string[] => {
    const local = this.#deps.originLoopback()
    const out: string[] = []
    for (const raw of zones) {
      const door = foldContentLabel(String(raw ?? '').trim().toLowerCase().replace(/^(?:wss?|https?):\/\//, ''))
      const loopback = LOOPBACK_HOST_RE.test(door)
      const port = PORT_RE.exec(door)
      const name = named && port && Number(port[1]) > 0 && Number(port[1]) < 65536 ? door.slice(0, port.index) : door
      if (!loopback && !HOST_DOMAIN_RE.test(name)) continue
      if (loopback && !local) continue
      if (!out.includes(door)) out.push(door)
    }
    return out
  }

  // ── the pass-overs this tab remembers ───────────────────────────────────

  /** The session's own handle, or null (no storage, a worker, a test world
   *  without one): then a pass-over lasts this page only. */
  readonly #session = (): SessionLike | null => {
    try { return this.#deps.session?.() ?? null } catch { return null }
  }

  /** Take back what this tab's session remembers: pool hosts passed over
   *  within the last hour, newest first, a handful at most. Anything else in
   *  the record (older, malformed) is simply not taken back. */
  readonly #restoreDown = (): void => {
    let raw: string | null = null
    try { raw = this.#session()?.getItem(DOWN_SESSION_KEY) ?? null } catch { raw = null }
    if (!raw) return
    let rows: unknown
    try { rows = JSON.parse(raw) } catch { return }
    if (!Array.isArray(rows)) return
    const now = Date.now()
    for (const row of rows.slice(0, DOWN_REMEMBER_MAX)) {
      if (!Array.isArray(row)) continue
      const [host, reason, at] = row as unknown[]
      if (typeof host !== 'string' || !host || typeof at !== 'number' || !Number.isFinite(at)) continue
      if (at > now || now - at >= DOWN_REMEMBER_MS) continue
      this.#down.set(host, typeof reason === 'string' ? reason : '')
      this.#downAt.set(host, at)
    }
  }

  /** Write what this tab remembers: the newest few remembered pass-overs
   *  still inside the hour — or nothing at all once none is left. */
  readonly #rememberDown = (): void => {
    const session = this.#session()
    if (!session) return
    const now = Date.now()
    const rows = [...this.#downAt]
      .filter(([host, at]) => this.#down.has(host) && now - at < DOWN_REMEMBER_MS)
      .sort((a, b) => b[1] - a[1])
      .slice(0, DOWN_REMEMBER_MAX)
      .map(([host, at]) => [host, this.#down.get(host) ?? '', at])
    try {
      if (rows.length === 0) session.removeItem(DOWN_SESSION_KEY)
      else session.setItem(DOWN_SESSION_KEY, JSON.stringify(rows))
    } catch { /* storage refused — this page still passes it over */ }
  }

  readonly #setPool = (zones: readonly string[]): void => {
    const first = this.#pool === null
    if (!first && sameList(this.#pool!, zones)) return
    // A changed pool is the participant acting: every host gets its chance
    // again — in this page and after a reload.
    if (!first) {
      this.#down.clear()
      if (this.#downAt.size > 0) { this.#downAt.clear(); this.#rememberDown() }
    }
    this.#pool = [...zones]
    this.#version++
    const asked = this.#askedPool
    this.#askedPool = false
    if (!first || asked) this.#changed()
  }

  /** `force`: the pool may have changed (an add, a remove, another tab) —
   *  read now, or again as soon as the read in flight lands. A lookup never
   *  forces: it asks at most once per RETRY_UNKNOWN_MS. */
  readonly #refreshPool = (force = false): void => {
    if (force) this.#poolRetryAt = 0
    if (this.#poolLoading) { if (force) this.#poolAgain = true; return }
    if (Date.now() < this.#poolRetryAt) return
    this.#poolLoading = true
    this.#poolAgain = false
    void this.#deps.readPool().then(
      zones => {
        if (zones === null) { this.#poolUnknown(); return }
        this.#poolTimerRuns = 0
        this.#setPool(zones.map(z => hostZone(z)).filter(Boolean))
      },
      () => { this.#poolUnknown() },
    ).finally(() => {
      this.#poolLoading = false
      if (this.#poolAgain) { this.#poolAgain = false; this.#refreshPool(true) }
    })
  }

  /** The pool could not be read yet: ask again in a moment, on our own. */
  readonly #poolUnknown = (): void => {
    this.#poolRetryAt = Date.now() + RETRY_UNKNOWN_MS
    if (this.#poolTimer !== undefined || this.#poolTimerRuns >= RETRY_UNKNOWN_MAX) return
    this.#poolTimerRuns++
    this.#poolTimer = setTimeout(() => {
      this.#poolTimer = undefined
      if (this.#pool === null) this.#refreshPool(true)
    }, RETRY_UNKNOWN_MS)
  }

  readonly #loadMarks = (segments: readonly string[], key: string, force = false): void => {
    if (this.#marksLoading.has(key)) return
    if (!force && Date.now() < (this.#marksRetryAt.get(key) ?? 0)) return
    this.#marksLoading.add(key)
    const unknownRuns = this.#marksUnknown.get(key)?.runs ?? 0
    void this.#deps.readMarks(segments, unknownRuns >= MARKS_LENIENT_AFTER).then(
      zones => {
        if (zones === null) { this.#marksUnknownFor(segments, key); return }
        this.#marksUnknown.delete(key)
        const next = zones.map(z => hostZone(z)).filter(Boolean)
        const prev = this.#marks.get(key)
        const asked = this.#askedMarks.delete(key)
        this.#marks.delete(key)
        this.#marks.set(key, next)
        if (prev === undefined || !sameList(prev, next)) this.#version++
        while (this.#marks.size > MARKS_CACHE_MAX) {
          const oldest = this.#marks.keys().next().value
          if (oldest === undefined) break
          this.#marks.delete(oldest)
        }
        if (prev === undefined ? asked : !sameList(prev, next)) this.#changed()
      },
      () => { this.#marksUnknownFor(segments, key) },
    ).finally(() => { this.#marksLoading.delete(key) })
  }

  /** One branch's marks are not known yet: ask again in a moment, on our own
   *  — a cold read on a reload settles shortly after the store root opens,
   *  and the page must not wait for whichever lookup comes next. */
  readonly #marksUnknownFor = (segments: readonly string[], key: string): void => {
    this.#marksRetryAt.set(key, Date.now() + RETRY_UNKNOWN_MS)
    const entry = this.#marksUnknown.get(key) ?? { segments, runs: 0 }
    entry.runs++
    this.#marksUnknown.set(key, entry)
    if (this.#marksTimer !== undefined) return
    this.#marksTimer = setTimeout(() => {
      this.#marksTimer = undefined
      for (const [k, e] of [...this.#marksUnknown]) {
        if (this.#marks.has(k)) { this.#marksUnknown.delete(k); continue }
        if (e.runs > RETRY_UNKNOWN_MAX) continue
        this.#marksRetryAt.delete(k)
        this.#loadMarks(e.segments, k)
      }
    }, RETRY_UNKNOWN_MS)
  }

  /** One 'change' per burst of updates. */
  readonly #changed = (): void => {
    if (this.#changeQueued) return
    this.#changeQueued = true
    queueMicrotask(() => {
      this.#changeQueued = false
      this.dispatchEvent(new CustomEvent('change'))
    })
  }
}

/** The one resolver host-sync owns. */
export const swarmHosts = new SwarmHostResolver()
