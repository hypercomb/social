// nostr-mesh.long-tail.spec.ts — the swarm long-tail hunt, mesh half (lane L3).
//
// Each block reproduces one finding with the fake WebSocket and fake timers,
// and pins the fix:
//   LS-1   a lease (a bucket nobody holds) closes when it settles; at the
//          relay's subscription cap a held subscription takes a lease's
//          place at once; a reopen asks for the page first.
//   MS1    a tab hidden long enough for Chrome to run its timers on the
//          minute still probes a silent socket and replaces a dead one.
//   MS2    a wake dials beside a handshake stuck on the path that died.
//   VO-4   a tab without the code at a coded meeting point climbs the access
//          ladder and never announces a refused dial as a reopen.
//   RM-4   a card that corrects the clock after EVENTs went out says so
//          (mesh:clock-corrected), and a reload starts on the clock it knew.
//   RM-2 / SCALE-3 / SCALE-5 / LS-2 (client half)   bulk never starves the
//          tab's own beacon, layers, presence and drills of the relay budget.
//
// window.ioc and the WebSocket global are stubbed BEFORE the module import
// (the drone self-registers at load); membership is mocked.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const membership = vi.hoisted(() => ({ joined: false }))
vi.mock('./membership.js', () => ({ isJoinedHere: () => membership.joined }))

type Frame = unknown[]
type Evt = { id: string; kind: number; created_at: number; tags: string[][] }

// The relay's per-connection budget (relay.js / meeting.js): burst 400,
// refilled at 10/s; EVENT and REQ cost one token, CLOSE and AUTH nothing.
type RelayBudget = { tokens: number; at: number }

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static all: FakeWebSocket[] = []
  static onCreate: ((ws: FakeWebSocket) => void) | null = null

  readyState = 0
  bufferedAmount = 0
  sent: Frame[] = []
  createdAt = Date.now()
  closedAt = -1
  protocols: string[]
  // a live relay answers the liveness probe; a dead path answers nothing
  alive = true
  // set: the relay's token bucket is emulated, and every EVENT is answered
  budget: RelayBudget | null = null
  refused: Evt[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e?: { code?: number }) => void) | null = null
  onerror: (() => void) | null = null

  constructor(public url: string, protocols?: string | string[]) {
    this.protocols = protocols === undefined ? [] : Array.isArray(protocols) ? protocols : [protocols]
    FakeWebSocket.all.push(this)
    const hook = FakeWebSocket.onCreate
    if (hook) queueMicrotask(() => hook(this))
  }

  send(data: string): void {
    if (this.readyState !== FakeWebSocket.OPEN) throw new Error('InvalidStateError')
    const frame = JSON.parse(data) as Frame
    this.sent.push(frame)
    if (this.budget && (frame[0] === 'EVENT' || frame[0] === 'REQ')) {
      const now = Date.now()
      this.budget.tokens = Math.min(400, this.budget.tokens + (now - this.budget.at) * 10 / 1000)
      this.budget.at = now
      const ok = this.budget.tokens >= 1
      if (ok) this.budget.tokens--
      if (frame[0] === 'EVENT') {
        const e = frame[1] as Evt
        if (!ok) this.refused.push(e)
        queueMicrotask(() => this.receive(['OK', e.id, ok, ok ? '' : 'rate-limited: slow down']))
        return
      }
      if (!ok) { queueMicrotask(() => this.receive(['CLOSED', String(frame[1]), 'rate-limited: slow down'])); return }
    }
    if (this.alive && frame[0] === 'REQ' && frame[1] === 'hc-live') queueMicrotask(() => this.receive(['EOSE', 'hc-live']))
  }
  close(): void {
    if (this.closedAt < 0) this.closedAt = Date.now()
    this.readyState = FakeWebSocket.CLOSED
  }

  // drivers
  open(): void { this.readyState = FakeWebSocket.OPEN; this.onopen?.() }
  receive(msg: Frame): void { this.onmessage?.({ data: JSON.stringify(msg) }) }
  card(extra: Record<string, unknown> = {}): void { this.receive(['NOTICE', 'hc:host ' + JSON.stringify({ v: 1, time: Math.floor(Date.now() / 1000), participants: false, ...extra })]) }
  drop(code = 1006): void { this.readyState = FakeWebSocket.CLOSED; if (this.closedAt < 0) this.closedAt = Date.now(); this.onclose?.({ code }) }
}

let seq = 0
const PK = 'a'.repeat(64)
const services: Record<string, unknown> = {
  '@diamondcoreprocessor.com/NostrSigner': {
    signEvent: async (e: Record<string, unknown>) => ({ ...e, id: (++seq).toString(16).padStart(64, '0'), pubkey: PK, sig: 'f'.repeat(128) }),
  },
}
;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket
;(window as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket
;(window as unknown as { ioc: unknown }).ioc = { register: () => void 0, get: (k: string) => services[k] }

const { NostrMeshDrone } = await import('./nostr-mesh.drone.js')
type Mesh = InstanceType<typeof NostrMeshDrone>
type Conn = { state: string; reopened: boolean; refused?: string }
type Debug = { buckets: { sig: string; subId: string; consumers: number }[]; bulkHeld?: number }

const RELAY = 'wss://relay.test'
const T0 = new Date('2026-10-10T18:00:00.000Z').getTime()
const PAGE = 'c'.repeat(64)
const LIFE = 'd'.repeat(64)
const sigN = (n: number): string => n.toString(16).padStart(64, '0')

let meshes: Mesh[] = []
let visibility: DocumentVisibilityState = 'visible'
let warn: ReturnType<typeof vi.spyOn>
let connections: Conn[] = []

const last = (): FakeWebSocket => FakeWebSocket.all[FakeWebSocket.all.length - 1]
const probes = (ws: FakeWebSocket): number => ws.sent.filter(f => f[0] === 'REQ' && f[1] === 'hc-live').length
const reqsFor = (ws: FakeWebSocket, sig: string): Frame[] =>
  ws.sent.filter(f => f[0] === 'REQ' && ((f[2] as { '#x'?: string[] })['#x'] ?? [])[0] === sig)
const subIdOf = (ws: FakeWebSocket, sig: string): string => String(reqsFor(ws, sig)[0]?.[1] ?? '')
const closes = (ws: FakeWebSocket): string[] => ws.sent.filter(f => f[0] === 'CLOSE').map(f => String(f[1]))
const events = (ws: FakeWebSocket): Evt[] => ws.sent.filter(f => f[0] === 'EVENT').map(f => f[1] as Evt)
const buckets = (mesh: Mesh): Debug['buckets'] => (mesh.getDebug() as Debug).buckets
const mapped = (mesh: Mesh): unknown => (mesh as unknown as { sockets: Map<string, unknown> }).sockets.get(RELAY)
const nowSec = (): number => Math.floor(Date.now() / 1000)

const boot = async (relays: string[] = [RELAY]): Promise<Mesh> => {
  localStorage.setItem('hc:nostrmesh:relays', JSON.stringify(relays))
  const mesh = new NostrMeshDrone()
  meshes.push(mesh)
  await Promise.resolve()   // the constructor's microtask arms it
  return mesh
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0 })
  EffectBus.clear()
  FakeWebSocket.all = []
  FakeWebSocket.onCreate = null
  membership.joined = true
  visibility = 'visible'
  connections = []
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  EffectBus.on<Conn>('mesh:connection', c => { connections.push({ ...c }) })
  warn = vi.spyOn(console, 'warn').mockImplementation(() => void 0)
})

afterEach(() => {
  for (const m of meshes) m.stop()
  meshes = []
  FakeWebSocket.onCreate = null
  vi.useRealTimers()
  warn.mockRestore()
  localStorage.clear()
  sessionStorage.clear()
})

// ── LS-1 ──────────────────────────────────────────────────────────────────────

describe('LS-1: a lease closes when it settles', () => {
  it('a drill answer (awaitReadyForSig on a page nobody here subscribes) leaves no bucket once the relay says EOSE', async () => {
    const mesh = await boot()
    const ws = last()
    ws.open()
    // LS-drill3: 20 drilled pages answered by a resumed sharer's tab
    for (let i = 1; i <= 20; i++) {
      const sig = sigN(i)
      const ready = mesh.awaitReadyForSig(sig, 600)
      ws.receive(['EOSE', subIdOf(ws, sig)])
      await ready
    }
    expect(buckets(mesh)).toEqual([])
    // each lease told the relay it was done with it
    expect(closes(ws)).toHaveLength(20)
  })

  it('a lease the relay never answers closes at its deadline', async () => {
    const mesh = await boot()
    const ws = last()
    ws.open()
    const sig = sigN(7)
    const ready = mesh.awaitReadyForSig(sig, 600)
    await vi.advanceTimersByTimeAsync(599)
    expect(buckets(mesh).map(b => b.sig)).toEqual([sig])
    await vi.advanceTimersByTimeAsync(1)
    await ready
    expect(buckets(mesh)).toEqual([])
    expect(closes(ws)).toEqual([subIdOf(ws, sig)])
  })

  it('a bare ensureStartedForSig is a lease too — and the cache it filled stays readable', async () => {
    const mesh = await boot()
    const ws = last()
    ws.open()
    const sig = sigN(9)
    mesh.ensureStartedForSig(sig)
    ws.receive(['EVENT', subIdOf(ws, sig), { id: 'e'.repeat(64), pubkey: 'b'.repeat(64), created_at: nowSec(), kind: 30200, tags: [['x', sig], ['d', 'p']], content: '{"peer":1}', sig: '0'.repeat(128) }])
    ws.receive(['EOSE', subIdOf(ws, sig)])
    expect(buckets(mesh)).toEqual([])
    expect(mesh.getNonExpired(sig).map(e => e.payload)).toEqual([{ peer: 1 }])

    // unanswered, it goes at LEASE_MS (10 s)
    mesh.ensureStartedForSig(sigN(10))
    await vi.advanceTimersByTimeAsync(9_999)
    expect(buckets(mesh)).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(buckets(mesh)).toEqual([])
  })

  it('a consumer joining a lease keeps the subscription until it leaves', async () => {
    const mesh = await boot()
    const ws = last()
    ws.open()
    mesh.ensureStartedForSig(PAGE)
    const sub = mesh.subscribe(PAGE, () => void 0)
    ws.receive(['EOSE', subIdOf(ws, PAGE)])
    await vi.advanceTimersByTimeAsync(30_000)
    expect(buckets(mesh)).toEqual([expect.objectContaining({ sig: PAGE, consumers: 1 })])
    expect(reqsFor(ws, PAGE)).toHaveLength(1)
    sub.close()
    expect(buckets(mesh)).toEqual([])
  })
})

describe('LS-1: at the subscription cap, the page outranks a lease', () => {
  it('a refused page subscription takes the oldest lease\'s place and asks again at once — and hears the tile', async () => {
    const mesh = await boot()
    const ws = last()
    ws.open()
    // three leases the relay has not finished with (no EOSE yet)
    const leases = [sigN(1), sigN(2), sigN(3)]
    for (const s of leases) mesh.ensureStartedForSig(s)
    const got: unknown[] = []
    mesh.subscribe(PAGE, e => got.push(e.payload))
    const first = subIdOf(ws, PAGE)
    ws.receive(['CLOSED', first, 'error: too many subscriptions (max 200)'])

    // at once: the oldest lease is closed and the page asks again
    expect(closes(ws)).toEqual([subIdOf(ws, leases[0])])
    expect(reqsFor(ws, PAGE)).toHaveLength(2)
    expect(buckets(mesh).map(b => b.sig)).toEqual([leases[1], leases[2], PAGE])

    // probe-c: the explorer's new tile on that page arrives
    ws.receive(['EVENT', first, { id: '9'.repeat(64), pubkey: 'b'.repeat(64), created_at: nowSec(), kind: 30200, tags: [['x', PAGE], ['d', 'p']], content: '{"probe":"c"}', sig: '0'.repeat(128) }])
    ws.receive(['EOSE', first])
    expect(got).toEqual([{ probe: 'c' }])
    expect(mesh.connectionState().refused).toBeUndefined()
  })

  it('a lease the relay refuses is settled at once — never retried, never a refusal on the status line', async () => {
    const mesh = await boot()
    const ws = last()
    ws.open()
    const sig = sigN(4)
    let answered = false
    void mesh.awaitReadyForSig(sig, 600).then(() => { answered = true })
    ws.receive(['CLOSED', subIdOf(ws, sig), 'error: too many subscriptions (max 200)'])
    await vi.advanceTimersByTimeAsync(0)
    expect(answered).toBe(true)                  // nothing is coming: the waiter is answered now
    expect(buckets(mesh)).toEqual([])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(reqsFor(ws, sig)).toHaveLength(1)
    expect(mesh.connectionState().refused).toBeUndefined()
  })

  it('a reopen asks for the page first and the leases last', async () => {
    const mesh = await boot()
    const ws = last()
    ws.open()
    const OLD = sigN(11)
    const L1 = sigN(12)
    const L2 = sigN(13)
    mesh.ensureStartedForSig(L1)
    mesh.subscribe(OLD, () => void 0)
    mesh.subscribe(PAGE, () => void 0)
    mesh.ensureStartedForSig(L2)
    ws.drop()
    const ws1 = last()
    expect(ws1).not.toBe(ws)
    ws1.open()
    const order = ws1.sent.filter(f => f[0] === 'REQ').map(f => ((f[2] as { '#x': string[] })['#x'])[0])
    expect(order).toEqual([PAGE, OLD, L1, L2])
  })
})

// ── MS1 ───────────────────────────────────────────────────────────────────────

describe('MS1: a tab hidden for a long time still notices a dead socket', () => {
  it('under intensive throttling (timers on the minute) a silent socket is probed and replaced within two ticks', async () => {
    visibility = 'hidden'
    await boot()
    const ws0 = last()
    ws0.alive = false                     // the path dies silently: no FIN, nothing answers
    ws0.open()
    ws0.card()
    // Chrome's intensive wake-up throttling: a chained timer waits for the
    // next whole minute (wake.lens.spec.ts L2 from the hunt).
    const realSet = globalThis.setTimeout
    const aligned = ((fn: (...a: unknown[]) => void, ms?: number, ...a: unknown[]) => {
      const due = Date.now() + Math.max(0, Number(ms) || 0)
      return realSet(fn, Math.ceil(due / 60_000) * 60_000 - Date.now(), ...a)
    }) as unknown as typeof setTimeout
    let probedAt = -1
    let replacedAt = -1
    globalThis.setTimeout = aligned
    ;(window as unknown as { setTimeout: unknown }).setTimeout = aligned
    try {
      for (let s = 0; s < 600 && replacedAt < 0; s++) {
        await vi.advanceTimersByTimeAsync(1_000)
        if (probedAt < 0 && probes(ws0) > 0) probedAt = Date.now() - T0
        if (replacedAt < 0 && FakeWebSocket.all.length > 1) replacedAt = Date.now() - T0
      }
    } finally {
      globalThis.setTimeout = realSet
      ;(window as unknown as { setTimeout: unknown }).setTimeout = realSet
    }
    // today: 0 probes and no new socket in 10 minutes
    expect(probedAt).toBeGreaterThan(0)
    expect(probedAt).toBeLessThanOrEqual(60_000)
    expect(replacedAt).toBeGreaterThan(probedAt)
    expect(replacedAt - probedAt).toBeLessThanOrEqual(60_000)   // the next tick
    expect(ws0.closedAt).toBe(-1)                                // make-before-break
  })

  it('throttled, a beacon left a whole timer cycle without its OK replaces the socket on that tick — not a minute later', async () => {
    visibility = 'hidden'
    const realSet = globalThis.setTimeout
    const aligned = ((fn: (...a: unknown[]) => void, ms?: number, ...a: unknown[]) => {
      const due = Date.now() + Math.max(0, Number(ms) || 0)
      return realSet(fn, Math.ceil(due / 60_000) * 60_000 - Date.now(), ...a)
    }) as unknown as typeof setTimeout
    globalThis.setTimeout = aligned
    ;(window as unknown as { setTimeout: unknown }).setTimeout = aligned
    try {
      const mesh = await boot()
      const ws0 = last()
      ws0.alive = false
      ws0.open()
      // the room is talking until just before the first throttled tick…
      await vi.advanceTimersByTimeAsync(59_500)
      ws0.receive(['NOTICE', 'room traffic'])
      await vi.advanceTimersByTimeAsync(1_000)   // tick at 60 s: late, not yet trusted; nothing idle
      expect(probes(ws0)).toBe(0)
      // …then the path dies silently, and the next heartbeat's beacon goes into it
      await mesh.publish(30206, LIFE, { alive: true }, [['d', PK], ['expiration', String(nowSec() + 90)]])
      await vi.advanceTimersByTimeAsync(60_000)  // tick at 120 s: throttled, trusted
      expect(probes(ws0)).toBe(1)
      expect(FakeWebSocket.all).toHaveLength(2)
      expect(last().createdAt - T0).toBe(120_000)
      expect(ws0.closedAt).toBe(-1)              // make-before-break
    } finally {
      globalThis.setTimeout = realSet
      ;(window as unknown as { setTimeout: unknown }).setTimeout = realSet
    }
  })

  it('an ordinary hidden tick runs ~1 s late (Chrome aligns hidden timers to the second) and still judges', async () => {
    visibility = 'hidden'
    await boot()
    const ws0 = last()
    ws0.alive = false
    ws0.open()
    const realSet = globalThis.setTimeout
    const late = ((fn: (...a: unknown[]) => void, ms?: number, ...a: unknown[]) => realSet(fn, Math.max(0, Number(ms) || 0) + 1_009, ...a)) as unknown as typeof setTimeout
    globalThis.setTimeout = late
    ;(window as unknown as { setTimeout: unknown }).setTimeout = late
    try {
      await vi.advanceTimersByTimeAsync(60_000)
    } finally {
      globalThis.setTimeout = realSet
      ;(window as unknown as { setTimeout: unknown }).setTimeout = realSet
    }
    expect(probes(ws0)).toBeGreaterThan(0)
    expect(FakeWebSocket.all.length).toBeGreaterThan(1)
  })

  it('visible, a busy thread (late tick after late tick) never cuts a handshake whose open may be queued', async () => {
    await boot()
    const ws0 = last()                          // CONNECTING, 8 s allowance
    for (let i = 0; i < 2; i++) {
      vi.setSystemTime(Date.now() + 5_000)      // boot work blocks the thread
      await vi.advanceTimersByTimeAsync(1_000)  // the tick fires, late
    }
    expect(Date.now() - ws0.createdAt).toBeGreaterThan(8_000)
    expect(ws0.closedAt).toBe(-1)
    await vi.advanceTimersByTimeAsync(1_000)    // a punctual tick judges
    expect(ws0.closedAt).toBeGreaterThan(0)
  })

  it('the first tick after a return to view never judges, even after throttled ones', async () => {
    visibility = 'hidden'
    await boot()
    const ws0 = last()
    ws0.alive = false
    ws0.open()
    await vi.advanceTimersByTimeAsync(31_000)   // hidden idle probe at ~30 s
    expect(probes(ws0)).toBe(1)
    // the main thread blocks past the deadline, then the tab is shown
    vi.setSystemTime(Date.now() + 10_000)
    visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    const before = FakeWebSocket.all.length
    await vi.advanceTimersByTimeAsync(10)       // the overdue tick fires: distrusted
    expect(FakeWebSocket.all.length).toBe(before)
  })
})

// ── MS2 ───────────────────────────────────────────────────────────────────────

describe('MS2: a wake replaces a handshake stuck on the dead path', () => {
  const strandOnDeadPath = async (): Promise<FakeWebSocket> => {
    await boot()
    const ws0 = last()
    ws0.open()
    // the path dies silently; every dial on it hangs CONNECTING (dead venue wifi)
    ws0.alive = false
    await vi.advanceTimersByTimeAsync(75_000)
    const n = FakeWebSocket.all.length
    while (FakeWebSocket.all.length === n) await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(1_000)
    const fresh = last()
    expect(fresh.readyState).toBe(FakeWebSocket.CONNECTING)
    return fresh
  }

  // A browser holds ONE handshake per host:port in flight (RFC 6455 §4.1):
  // a dial beside the stuck one would wait for it to fail (sleep.cjs T5
  // measured +13.5 s), so the stuck one is cancelled and dialled again.
  it('online + visible: the stuck handshake is cancelled and dialled again at once (hunt L1: 21.9 s)', async () => {
    const stuck = await strandOnDeadPath()
    const before = FakeWebSocket.all.length
    const wakeAt = Date.now()
    window.dispatchEvent(new Event('online'))
    document.dispatchEvent(new Event('visibilitychange'))
    expect(FakeWebSocket.all.length).toBe(before + 1)
    expect(stuck.closedAt).toBe(wakeAt)           // nothing left in flight on the dead path
    const fresh = last()
    expect(fresh.createdAt - wakeAt).toBe(0)
    expect(mapped(meshes[0])).toBe(fresh)
    fresh.open()                                  // the new path answers
    fresh.card()
    expect(meshes[0].connectionState().state).toBe('open')
  })

  it("'online' gives the new handshake a fresh 8 s, not the 20 s the dead path earned", async () => {
    await strandOnDeadPath()
    window.dispatchEvent(new Event('online'))
    const fresh = last()
    await vi.advanceTimersByTimeAsync(7_999)
    expect(fresh.closedAt).toBe(-1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fresh.closedAt - fresh.createdAt).toBe(8_000)
  })

  it('a replacement stuck dialling beside a suspect is dialled again at the wake — the suspect keeps its place', async () => {
    const mesh = await boot()
    const ws0 = last()
    ws0.alive = false
    ws0.open()
    await vi.advanceTimersByTimeAsync(14_000)    // probe at 10 s, deadline 14 s: the replacement dials
    const stuck = last()
    expect(stuck).not.toBe(ws0)
    await vi.advanceTimersByTimeAsync(2_000)
    const wakeAt = Date.now()
    window.dispatchEvent(new Event('online'))
    expect(stuck.closedAt).toBe(wakeAt)
    const fresh = last()
    expect(fresh).not.toBe(stuck)
    expect(fresh.createdAt).toBe(wakeAt)
    expect(ws0.closedAt).toBe(-1)                // make-before-break for the OPEN suspect
    fresh.open()
    expect(mapped(mesh)).toBe(fresh)
    expect(ws0.closedAt).toBe(wakeAt)
  })

  it('a fresh handshake (under 500 ms) is left to finish', async () => {
    await boot()
    await vi.advanceTimersByTimeAsync(200)
    window.dispatchEvent(new Event('online'))
    expect(FakeWebSocket.all).toHaveLength(1)
  })

  it('a tab shown again, or a plain pageshow, never cancels a handshake in flight — it says nothing about the path', async () => {
    const stuck = await strandOnDeadPath()
    const before = FakeWebSocket.all.length
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('pageshow'))
    expect(stuck.closedAt).toBe(-1)
    expect(FakeWebSocket.all.length).toBe(before)
    // a page restored from the back-forward cache is a new path
    const restored = Object.assign(new Event('pageshow'), { persisted: true })
    window.dispatchEvent(restored)
    expect(stuck.closedAt).toBeGreaterThan(0)
    expect(FakeWebSocket.all.length).toBe(before + 1)
  })

  it("'online' then the type change of the same switch: the handshake 'online' dialled is left to finish", async () => {
    const conn = Object.assign(new EventTarget(), { type: 'wifi', effectiveType: '4g' })
    Object.defineProperty(navigator, 'connection', { configurable: true, value: conn })
    try {
      const stuck = await strandOnDeadPath()
      window.dispatchEvent(new Event('online'))
      expect(stuck.closedAt).toBeGreaterThan(0)
      const fresh = last()
      await vi.advanceTimersByTimeAsync(1_500)    // past 500 ms, a slow cellular handshake
      conn.type = 'cellular'
      conn.dispatchEvent(new Event('change'))
      expect(fresh.closedAt).toBe(-1)
      expect(last()).toBe(fresh)
    } finally {
      delete (navigator as unknown as { connection?: unknown }).connection
    }
  })

  it('a change of network TYPE (navigator.connection) is a wake; an effectiveType re-estimate is not', async () => {
    const conn = Object.assign(new EventTarget(), { type: 'wifi', effectiveType: '4g' })
    Object.defineProperty(navigator, 'connection', { configurable: true, value: conn })
    try {
      await boot()
      const ws0 = last()
      ws0.open()
      await vi.advanceTimersByTimeAsync(2_000)
      conn.dispatchEvent(new Event('change'))     // a refreshed estimate: same kind, nothing
      expect(probes(ws0)).toBe(0)
      conn.effectiveType = '3g'                   // RTT samples moved the estimate: nothing
      conn.dispatchEvent(new Event('change'))
      expect(probes(ws0)).toBe(0)
      conn.type = 'cellular'
      conn.dispatchEvent(new Event('change'))
      expect(probes(ws0)).toBe(1)
    } finally {
      delete (navigator as unknown as { connection?: unknown }).connection
    }
  })
})

// ── VO-4 ──────────────────────────────────────────────────────────────────────

describe('VO-4: a tab without the code at a coded meeting point', () => {
  it('climbs the access ladder — at most 5 dials a minute — and never announces a refused dial as a reopen', async () => {
    const mesh = await boot()
    const ws0 = last()
    ws0.open()
    ws0.card()                                      // meeting there, until…
    expect(mesh.connectionState().state).toBe('open')
    // …the operator puts an access code on it: every dial is refused 4401
    // straight after the upgrade, before any frame.
    FakeWebSocket.onCreate = (ws) => { ws.open(); ws.drop(4401) }
    const dialsBefore = FakeWebSocket.all.length
    connections = []
    ws0.drop(4401)
    await vi.advanceTimersByTimeAsync(60_000)
    const dials = FakeWebSocket.all.length - dialsBefore
    console.info(`[VO-4] dials to a code-refusing relay in 60 s: ${dials}; reopen announcements: ${connections.filter(c => c.reopened).length}`)
    // hunt (compat-access, HEAD): 13 dials and 13 reopen announcements a minute
    expect(dials).toBeGreaterThan(0)
    expect(dials).toBeLessThanOrEqual(5)
    expect(connections.filter(c => c.reopened)).toEqual([])
    expect(connections.filter(c => c.state === 'open')).toEqual([])
    expect(mesh.connectionState()).toMatchObject({ state: 'retrying', refused: 'access' })
  })

  it('a relay that takes the tab back says so in its card: then it is open, and the ladder starts over', async () => {
    const mesh = await boot()
    last().open()
    last().drop(4401)
    expect(mesh.connectionState().refused).toBe('access')
    await vi.advanceTimersByTimeAsync(5_000)
    const back = last()
    back.open()
    expect(mesh.connectionState().state).not.toBe('open')   // not on the upgrade alone
    back.card()
    expect(mesh.connectionState()).toMatchObject({ state: 'open' })
    expect(mesh.connectionState().refused).toBeUndefined()
    // refused again later: the first step again (5 s), not the ladder's next
    vi.spyOn(Math, 'random').mockReturnValue(0)
    back.drop(4401)
    const from = Date.now()
    const n = FakeWebSocket.all.length
    while (FakeWebSocket.all.length === n) await vi.advanceTimersByTimeAsync(250)
    expect(Math.round((Date.now() - from) / 1000)).toBe(5)
  })
})

// ── RM-4 ──────────────────────────────────────────────────────────────────────

describe('RM-4: the clock card', () => {
  it('a card that moves the clock after EVENTs went out says mesh:clock-corrected — once', async () => {
    const corrected: unknown[] = []
    EffectBus.on('mesh:clock-corrected', p => corrected.push(p))
    const mesh = await boot()
    const ws = last()
    // the join's first beacon is signed while the socket still connects
    await mesh.publish(30206, LIFE, { alive: true }, [['d', PK], ['expiration', String(nowSec() + 90)]])
    ws.open()                                      // flushed before any frame is read
    expect(events(ws)).toHaveLength(1)
    // the device is 180 s slow
    ws.receive(['NOTICE', 'hc:host ' + JSON.stringify({ v: 1, time: nowSec() + 180, participants: false })])
    expect(corrected).toEqual([{ relay: RELAY, offsetMs: 180_500, prevOffsetMs: 0 }])
    // the next card on a reconnect says the same: nothing more
    ws.drop()
    const ws1 = last()
    ws1.open()
    ws1.receive(['NOTICE', 'hc:host ' + JSON.stringify({ v: 1, time: nowSec() + 180, participants: false })])
    expect(corrected).toHaveLength(1)
  })

  it('a correction before any EVENT went out is silent', async () => {
    const corrected: unknown[] = []
    EffectBus.on('mesh:clock-corrected', p => corrected.push(p))
    const mesh = await boot()
    const ws = last()
    ws.open()
    ws.receive(['NOTICE', 'hc:host ' + JSON.stringify({ v: 1, time: nowSec() + 180, participants: false })])
    expect(mesh.connectionState().clockOffsetMs).toBe(180_500)
    expect(corrected).toEqual([])
  })

  it('a reload starts on the clock this tab last learned — its first beacon is not born expired', async () => {
    const first = await boot()
    const ws = last()
    ws.open()
    ws.receive(['NOTICE', 'hc:host ' + JSON.stringify({ v: 1, time: nowSec() + 180, participants: false })])
    expect(first.connectionState().clockOffsetMs).toBe(180_500)
    first.stop()

    // the reload, before any card
    const reloaded = await boot()
    expect(reloaded.connectionState().clockOffsetMs).toBe(180_500)
    const localExp = nowSec() + 90
    await reloaded.publish(30206, LIFE, { alive: true }, [['d', PK], ['expiration', String(localExp)]])
    const ws1 = last()
    ws1.open()
    const beacon = events(ws1)[0]
    expect(beacon.created_at).toBe(nowSec() + 180)
    expect(Number(beacon.tags.find(t => t[0] === 'expiration')?.[1])).toBeGreaterThanOrEqual(localExp + 180)
  })
})

// ── RM-2 / SCALE-3 / SCALE-5 / LS-2 (client half) ─────────────────────────────

describe('send priority: bulk never starves the tab\'s own frames', () => {
  const BULK = (n: number): [number, string, unknown, string[][]] => {
    const sig = sigN(1_000_000 + n)
    return [30401, sig, 'QUJD'.repeat(32), [['d', `${sig}#0`], ['t', 'resource'], ['expiration', String(nowSec() + 86_400)]]]
  }

  it('a sharer answering 15 picture chunks a second for 4 minutes keeps its beacon and page layer (exp5: refused 5x, 90 s gap)', async () => {
    const mesh = await boot()
    const ws = last()
    ws.budget = { tokens: 400, at: Date.now() }
    ws.open()
    ws.card()
    let n = 0
    for (let ms = 0; ms < 240_000; ms += 100) {
      if (ms % 60_000 === 0) void mesh.publish(30206, LIFE, { alive: true }, [['d', PK], ['expiration', String(nowSec() + 90)]])
      if (ms % 30_000 === 0) void mesh.publish(30200, PAGE, { children: [] }, [['d', PAGE], ['expiration', String(nowSec() + 90)]])
      if (ms % 1_000 === 0 && ms % 3_000 === 0) void mesh.publish(30203, PAGE, { drill: true }, [['d', `drill-${ms}`]])
      const due = Math.floor(((ms + 100) / 1000) * 15) - Math.floor((ms / 1000) * 15)
      for (let i = 0; i < due; i++) { const [k, s, p, t] = BULK(n++); void mesh.publish(k, s, p, t) }
      await vi.advanceTimersByTimeAsync(100)
    }
    const control = ws.refused.filter(e => e.kind !== 30401)
    expect(control).toEqual([])
    // the bulk that did go went within the relay's budget
    expect(ws.refused.filter(e => e.kind === 30401)).toEqual([])
    const sentBulk = events(ws).filter(e => e.kind === 30401).length
    expect(sentBulk).toBeGreaterThan(2_000)       // ~10/s of the 15/s asked
  })

  it('a control frame goes at once while bulk waits for the refill', async () => {
    const mesh = await boot()
    const ws = last()
    ws.open()
    for (let i = 0; i < 500; i++) { const [k, s, p, t] = BULK(i); await mesh.publish(k, s, p, t) }
    const bulkNow = events(ws).filter(e => e.kind === 30401).length
    expect(bulkNow).toBeLessThanOrEqual(400 - 40)
    expect((mesh.getDebug() as Debug).bulkHeld).toBe(500 - bulkNow)
    await mesh.publish(30206, LIFE, { alive: true }, [['d', PK]])
    expect(events(ws).at(-1)?.kind).toBe(30206)
    // the held bulk follows in order as the budget refills (10 a second)
    await vi.advanceTimersByTimeAsync(10_000)
    const later = events(ws).filter(e => e.kind === 30401).length
    expect(later - bulkNow).toBeGreaterThanOrEqual(90)
    expect(later - bulkNow).toBeLessThanOrEqual(101)
  })

  it('a lease waits for the budget, but a consumer that joins it asks at once', async () => {
    const mesh = await boot()
    const ws = last()
    ws.open()
    for (let i = 1; i <= 370; i++) mesh.subscribe(sigN(i), () => void 0)   // the budget is nearly spent
    const L = sigN(999)
    mesh.ensureStartedForSig(L)
    expect(reqsFor(ws, L)).toHaveLength(0)       // a warm-up nobody holds waits
    mesh.subscribe(L, () => void 0)
    expect(reqsFor(ws, L)).toHaveLength(1)       // held now: it asks
  })

  it('the join\'s beacon is never pushed out of the queue by bulk waiting for the same open', async () => {
    const mesh = await boot()
    const ws = last()
    // still connecting: the beacon first, then a broker's answers
    await mesh.publish(30206, LIFE, { alive: true }, [['d', PK]])
    for (let i = 0; i < 100; i++) { const [k, s, p, t] = BULK(i); await mesh.publish(k, s, p, t) }
    ws.open()
    const kinds = events(ws).map(e => e.kind)
    expect(kinds[0]).toBe(30206)
    expect(kinds.filter(k => k === 30206)).toHaveLength(1)
  })
})
