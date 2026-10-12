// sharing/swarm-hosts.ts
//
// WHERE A SHARED PAGE'S BYTES GO — the swarm's upload host, per page.
//
// jwize, 2026-10-11: "Let's just make sure that there isn't a default host";
// "all the user should have to do is put the host name in when entering a
// swarm, end of story"; "the source of truth is the host field". For the page
// being offered, in order:
//
//   1. PUBLISH DOMAINS — the `host:<zone>` marks worn by the nearest branch at
//      or above the page (community-hosts.ts), every one of them, primary
//      first: the same write doors a publish of that branch uses.
//   2. THE HOST FIELD — the meeting point the participant entered: the host of
//      the relay this tab meets at (the mesh's swarmHost — a link joined, the
//      selector, the page's own list). '' is no host.
//   3. NONE — nothing hosts the page.
//
//   NOTHING ELSE NAMES A HOST. The hosts pool (`community:hosts`) is the hosts
//   you READ from: it never picks where your bytes go, and nothing is seeded
//   into it (a pool seeded by an older package keeps its member — inert for
//   writes). A meeting link's own `host=` is legacy and decides nothing; the
//   host field is the one truth. The meeting point's `hc:host` card decides
//   nothing either: the host you entered is asked, and its answer decides.
//
//   Both are explicit choices, and the swarm tries them first — but one that
//   CANNOT take this tab's uploads (it refused them, is full, takes uploads
//   only from people meeting on it, or has never answered at all — the
//   `hyperccomb.com` typo) must not hold the room's tiles as names for the
//   whole meeting (jwize 2026-10-10, D2). host-sync says so (markDown) and the
//   page falls through to the next door, the domain named in `passedOver` so
//   the status line can say why. A `publish here` is not the swarm: it still
//   needs the domain itself.
//
// HOT PATH: `hostsFor` is SYNCHRONOUS and reads caches only. Connect, join,
// resubscribe and announce never wait on a layer read: a miss kicks a local
// read and answers PENDING (no host yet); the read landing dispatches
// 'change', and the owner (host-sync) re-drains and the swarm walks again. The
// host field is a synchronous read of the mesh, checked again on `mesh:zone`
// and `mesh:connection` (a link joined, the selector moved the point). A
// branch's marks refresh on `hosts:marks-changed` / `decorations:changed` and
// the tab becoming visible again (a change made in another tab). No network,
// ever.
//
// A loopback host is a write door only for a page that is itself loopback:
// nobody else can fetch from it, so on a real origin it is skipped and the next
// source answers (the rule the mesh applies to a loopback relay).

import { EffectBus } from '@hypercomb/core'
import { hostZone, hostsOfBranchKnown } from './community-hosts.js'
import { foldContentLabel, isLoopbackHost } from './zone-door.js'

/** Where a page's hosts came from. 'pool' and 'relay' are retired tiers
 *  (2026-10-11 — nothing answers them now), kept so an older status payload
 *  still reads. */
export type SwarmHostSource = 'publish' | 'meeting' | 'pool' | 'relay' | 'none'

/** Where one page's bytes go. `hosts` are write doors, primary first. */
export interface SwarmHostChoice {
  readonly hosts: readonly string[]
  readonly source: SwarmHostSource
  /** An input it depends on has not been read yet (a branch's marks): no
   *  host until it has. */
  readonly pending: boolean
  /** Doors passed over because their uploads cannot land this session, in
   *  the order they were named — the status line can say why the bytes went
   *  elsewhere, or nowhere. */
  readonly passedOver?: readonly string[]
}

/** What the resolver reads. Every read is local; none is on the hot path. */
export interface SwarmHostDeps {
  /** The host marks ONE cell wears, primary first; null while unknown (a
   *  cold history read, a decoration record not here yet). `lenient`: take a
   *  missing record as absent. */
  readMarks(segments: readonly string[], lenient?: boolean): Promise<readonly string[] | null>
  /** THE HOST FIELD — the relay this tab meets at (`host` is the mesh's
   *  swarmHost: host[:port], '' when none). A local, synchronous read.
   *  `participants` (its card's policy) is no longer read. */
  relay(): { host: string; participants?: unknown }
  /** Is this page itself loopback? */
  originLoopback(): boolean
  /** THIS TAB's session storage — where a door passed over is remembered
   *  across a reload. Absent or null: this page only. */
  session?(): SessionLike | null
}

/** The part of `Storage` the resolver uses (sessionStorage in a tab). */
export type SessionLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const MESH_KEY = '@diamondcoreprocessor.com/NostrMeshDrone'

/** A real host: labels joined by dots. */
const HOST_DOMAIN_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/
/** Every door here is one the participant named (a publish domain, the host
 *  field), so it may carry a port: a self-hosted machine on :8443 is a zone
 *  like any other, exactly as community-hosts.ts hostZone keeps it. */
const PORT_RE = /:(\d{1,5})$/
const LOOPBACK_HOST_RE = /^(?:(?:[a-z0-9-]+\.)*localhost|127(?:\.\d+){3}|\[::1\])(?::\d{1,5})?$/

/** A read that came back unknown is asked again on its own at this cadence —
 *  and no sooner by a lookup (lookups happen on every walk). */
const RETRY_UNKNOWN_MS = 1_000
/** How many times one branch's unknown marks are asked again on their own
 *  before they wait for the next lookup or change signal. */
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
/** A door passed over is remembered in THIS TAB's session — never
 *  localStorage: another tab, or tomorrow, asks the host afresh — so a reload
 *  does not hand the room back to it. For at most an hour, and only the most
 *  recent few. */
const DOWN_SESSION_KEY = 'hc:swarm-hosts:down'
const DOWN_REMEMBER_MS = 60 * 60_000
const DOWN_REMEMBER_MAX = 8

const PENDING: SwarmHostChoice = Object.freeze({ hosts: Object.freeze([]) as readonly string[], source: 'none', pending: true })
const NONE: SwarmHostChoice = Object.freeze({ hosts: Object.freeze([]) as readonly string[], source: 'none', pending: false })

/** A pass-over on an UPLOAD's own standing answer — host-sync's reason leads
 *  with the status word: the host refused (its own 4xx, a CORS-blocked
 *  upload, not-live while this tab meets elsewhere), is full, or nothing at
 *  that name ever answered. Only that passes over a door the participant
 *  chose: a web page at its door, or a moment's silence, is not enough — a
 *  static door may serve some sigs as files, so its uploads decide. */
const CHOSEN_DOWN_RE = /^(?:refused|full|unresolved):/

const ioc = <T>(key: string): T | undefined =>
  (globalThis as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

/** The resolver's own reads, against the live runtime. */
export const liveSwarmHostDeps: SwarmHostDeps = {
  readMarks: async (segments, lenient = false) => {
    try { return await hostsOfBranchKnown(segments, lenient) } catch { return null }
  },
  relay: () => {
    const mesh = ioc<{ swarmHost?: () => string }>(MESH_KEY)
    let host = ''
    try { host = String(mesh?.swarmHost?.() ?? '') } catch { host = '' }
    return { host }
  },
  originLoopback: () => {
    try { return isLoopbackHost(globalThis.location?.host ?? '') } catch { return false }
  },
  session: () => {
    try { return globalThis.sessionStorage ?? null } catch { return null }
  },
}

const keyOf = (segments: readonly string[], length: number): string => segments.slice(0, length).join('\u0000')

const sameList = (a: readonly string[] | undefined, b: readonly string[] | undefined): boolean =>
  !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i])

export class SwarmHostResolver extends EventTarget {

  readonly #deps: SwarmHostDeps

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

  /** Hosts whose uploads cannot land this session (host-sync says so), with
   *  the reason. A door here is passed over on a standing answer only (see
   *  CHOSEN_DOWN_RE and the header). */
  readonly #down = new Map<string, string>()
  /** When each REMEMBERED failure was marked — the ones this tab's session
   *  keeps across a reload (#rememberDown). A failure marked while the path
   *  itself was down is not among them. */
  readonly #downAt = new Map<string, number>()

  /** Inputs a LOOKUP found unread — someone acted on "pending" (a walk sent
   *  names only, a drain had nowhere to go), so their first read is news.
   *  A first read nobody waited on (a warm) changes no one's answer. */
  readonly #askedMarks = new Set<string>()

  #changeQueued = false

  /** Bumped whenever any cached answer may differ — a cheap key for whoever
   *  memoizes over many lookups (host-sync's target set). */
  #version = 0
  get version(): number { this.#meetingDoor(); return this.#version }

  /** The host field as last seen, so a change bumps the version (a read of
   *  the mesh, with no signal of its own besides the mesh's effects). */
  #meetingSeen: string | undefined = undefined

  constructor(deps: SwarmHostDeps = liveSwarmHostDeps) {
    super()
    this.#deps = deps
    // A reload of this tab keeps the doors it passed over (within the hour):
    // the first answer after a reload must not hand the room back to a host
    // that just proved it takes no uploads.
    this.#restoreDown()
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
    // THE HOST FIELD moved (a link joined, the selector, /use-live-relay —
    // the mesh reconnects to the new point): look again. A synchronous read;
    // an unchanged field is no news.
    EffectBus.on('mesh:zone', () => { this.#meetingDoor() })
    EffectBus.on('mesh:connection', () => { this.#meetingDoor() })
    // ANOTHER TAB may have changed a branch's marks (the caches are this
    // tab's). Coming back to this tab re-reads them; an unchanged answer is
    // no news.
    try {
      globalThis.document?.addEventListener?.('visibilitychange', () => {
        if (globalThis.document?.visibilityState !== 'visible') return
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
    // Doors passed over on the way down the tiers (a standing failure), in
    // order; and the first tier that named any — it keeps the page when no
    // door below it takes bytes, so its status names the host and why.
    const passedOver: string[] = []
    let first: SwarmHostChoice | null = null
    const choose = (hosts: readonly string[], source: SwarmHostSource): SwarmHostChoice =>
      passedOver.length > 0 ? { hosts, source, pending: false, passedOver: [...passedOver] } : { hosts, source, pending: false }
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
      const doors = this.#usable(zones)
      if (doors.length === 0) continue
      // The nearest branch that wears any is the page's choice — only its
      // doors, never a farther branch's. Those whose uploads cannot land are
      // passed over; the rest serve the page.
      const up = doors.filter(h => !this.#chosenDown(h))
      if (up.length > 0) return choose(up, 'publish')
      passedOver.push(...doors)
      first = { hosts: doors, source: 'publish', pending: false }
      break
    }
    // Unread marks could still name a nearer publish domain: nothing below
    // them can answer yet.
    if (unknown) return PENDING
    // 2. The host field — the meeting point the participant entered.
    const field = this.#meetingDoor()
    if (field) {
      if (!this.#chosenDown(field)) return choose([field], 'meeting')
      if (!passedOver.includes(field)) passedOver.push(field)
      first ??= { hosts: [field], source: 'meeting', pending: false }
    }
    // 3. No door takes bytes: the first one the page named keeps it, so its
    //    status names the host and why it is not taking bytes — else none.
    return first ?? NONE
  }

  /** The host field as a write door ('' when none, or not one this page may
   *  use) — the relay this tab meets at, whether or not it takes uploads.
   *  host-sync treats this door as the relay's own heap. */
  readonly relayHost = (): string => this.#fieldDoor()

  /** A host's uploads cannot land this session (host-sync: it refused, is
   *  full, takes uploads only from people meeting on it, or never answered
   *  while another host did). It is passed over from now on, whichever tier
   *  named it — and, `remember`ed (the default), across a reload of this tab
   *  too (#rememberDown). A failure that may have been the PATH (no socket
   *  open) is this page's only. */
  readonly markDown = (host: string, reason: string, remember = true): void => {
    if (!host) return
    const before = this.#down.get(host)
    if (before !== undefined) {
      // Already passed over; a later failure the path cannot explain makes a
      // path-time pass-over one to remember. An upload's own standing answer
      // replaces a weaker reason (a page at the door): the door is passed
      // over from now on (CHOSEN_DOWN_RE).
      const stronger = CHOSEN_DOWN_RE.test(reason) && !CHOSEN_DOWN_RE.test(before)
      const newlyRemembered = remember && !this.#downAt.has(host)
      if (stronger) this.#down.set(host, reason)
      if (newlyRemembered) this.#downAt.set(host, Date.now())
      if (stronger || newlyRemembered) this.#rememberDown()
      if (stronger) { this.#version++; this.#changed() }
      return
    }
    this.#down.set(host, reason)
    if (remember) { this.#downAt.set(host, Date.now()); this.#rememberDown() }
    this.#version++
    this.#changed()
  }

  /** A host answered again (a receipt, or the participant asked to retry). */
  readonly markUp = (host: string): void => {
    if (!this.#down.delete(host)) return
    if (this.#downAt.delete(host)) this.#rememberDown()
    this.#version++
    this.#changed()
  }

  /** Forget every failure — the participant asked to try again. */
  readonly clearDown = (): void => {
    if (this.#down.size === 0) return
    this.#down.clear()
    this.#downAt.clear()
    this.#rememberDown()
    this.#version++
    this.#changed()
  }

  /** Why a host is passed over ('' when it is not). */
  readonly downReason = (host: string): string => this.#down.get(host) ?? ''

  /** The STANDING answer a door was passed over on — `refused`, `full` or
   *  `unresolved` (never answered) — or '' (not passed over, or only for
   *  what may have been the path). Remembered across a reload of this tab
   *  (#restoreDown), so host-sync can say "this host will not take it" before
   *  its first upload of the new page has been refused again. */
  readonly standingDown = (host: string): 'refused' | 'full' | 'unresolved' | '' => {
    const m = /^(refused|full|unresolved):/.exec(this.#down.get(host) ?? '')
    return m ? m[1] as 'refused' | 'full' | 'unresolved' : ''
  }

  /** Is a door the participant chose (a publish domain, the host field)
   *  passed over — on its uploads' own standing answer (CHOSEN_DOWN_RE)? */
  readonly #chosenDown = (host: string): boolean => CHOSEN_DOWN_RE.test(this.#down.get(host) ?? '')

  /** The host field as a write door — no side effects. */
  readonly #fieldDoor = (): string => {
    let raw = ''
    try { raw = String(this.#deps.relay().host ?? '') } catch { raw = '' }
    return raw ? (this.#usable([raw])[0] ?? '') : ''
  }

  /** The host field as a write door; a change since the last look bumps the
   *  version and is news. */
  readonly #meetingDoor = (): string => {
    const door = this.#fieldDoor()
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
   *  `content.` face), loopback only from loopback, a port kept (every door
   *  is one the participant named). */
  readonly #usable = (zones: readonly string[]): string[] => {
    const local = this.#deps.originLoopback()
    const out: string[] = []
    for (const raw of zones) {
      const door = foldContentLabel(String(raw ?? '').trim().toLowerCase().replace(/^(?:wss?|https?):\/\//, ''))
      const loopback = LOOPBACK_HOST_RE.test(door)
      const port = PORT_RE.exec(door)
      const name = port && Number(port[1]) > 0 && Number(port[1]) < 65536 ? door.slice(0, port.index) : door
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

  /** Take back what this tab's session remembers: doors passed over within
   *  the last hour, newest first, a handful at most. Anything else in the
   *  record (older, malformed) is simply not taken back. */
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
