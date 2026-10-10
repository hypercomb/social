// nostr-mesh.liveness.spec.ts — the mesh knows whether it is connected.
//
// The client used to have no liveness of its own: a half-open socket (phone
// lock, wifi roam, a tunnel edge lost) stayed OPEN while every publish
// "succeeded" into the void, an orphaned socket's late onclose deleted the
// live one, and the reconnect ladder climbed to 15 s. These specs pin the
// watchdog, the retire path, the ladder, the escalating handshake timeout,
// the wake probes, the connection state and the early arming — with a fake
// WebSocket and fake timers, so every deadline is checked to the millisecond.
//
// window.ioc and the WebSocket global are stubbed BEFORE the module import
// (the drone self-registers at load). Membership is mocked: the module's own
// instance boots private and stays offline; each test builds a joined one.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const membership = vi.hoisted(() => ({ joined: false }))
vi.mock('./membership.js', () => ({ isJoinedHere: () => membership.joined }))

type Frame = unknown[]

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static all: FakeWebSocket[] = []

  readyState = 0
  bufferedAmount = 0
  sent: Frame[] = []
  createdAt = Date.now()
  closedAt = -1
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(public url: string) { FakeWebSocket.all.push(this) }

  send(data: string): void {
    if (this.readyState !== FakeWebSocket.OPEN) throw new Error('InvalidStateError')
    this.sent.push(JSON.parse(data) as Frame)
  }
  close(): void {
    if (this.closedAt < 0) this.closedAt = Date.now()
    this.readyState = FakeWebSocket.CLOSED
  }

  // drivers
  open(): void { this.readyState = FakeWebSocket.OPEN; this.onopen?.() }
  receive(msg: Frame): void { this.onmessage?.({ data: JSON.stringify(msg) }) }
  drop(): void { this.readyState = FakeWebSocket.CLOSED; if (this.closedAt < 0) this.closedAt = Date.now(); this.onclose?.() }
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

const RELAY = 'wss://relay.test'
const T0 = new Date('2026-10-04T18:00:00.000Z').getTime()

let meshes: Mesh[] = []
let visibility: DocumentVisibilityState = 'visible'

const last = (): FakeWebSocket => FakeWebSocket.all[FakeWebSocket.all.length - 1]
const probes = (ws: FakeWebSocket): number => ws.sent.filter(f => f[0] === 'REQ' && f[1] === 'hc-live').length
const mapped = (mesh: Mesh): unknown => (mesh as unknown as { sockets: Map<string, unknown> }).sockets.get(RELAY)

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
  membership.joined = true
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
})

afterEach(() => {
  for (const m of meshes) m.stop()
  meshes = []
  vi.useRealTimers()
  localStorage.clear()
})

describe('liveness watchdog', () => {
  it('probes a silent OPEN socket at 10 s, dials its replacement at the 14 s deadline and switches on open', async () => {
    const mesh = await boot()
    const ws0 = last()
    ws0.open()

    await vi.advanceTimersByTimeAsync(9_999)
    expect(probes(ws0)).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(probes(ws0)).toBe(1)
    expect(ws0.sent.find(f => f[1] === 'hc-live')).toEqual(['REQ', 'hc-live', { '#x': ['hc:live'], limit: 0 }])

    await vi.advanceTimersByTimeAsync(3_999)
    expect(FakeWebSocket.all).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)

    // make-before-break: the replacement dials at the deadline (the ladder's
    // first step is 0 ms) and the old socket keeps its place meanwhile
    expect(FakeWebSocket.all).toHaveLength(2)
    const ws1 = last()
    expect(ws1.createdAt - T0).toBe(14_000)
    expect(mapped(mesh)).toBe(ws0)
    expect(ws0.closedAt).toBe(-1)

    ws1.open()
    expect(ws0.closedAt - T0).toBe(14_000)
    expect(mapped(mesh)).toBe(ws1)
    expect(ws0.onclose).toBeNull()               // retired: its handlers are gone
  })

  it('a slow probe answered while the replacement dials keeps the socket — our own uploads are no reason to drop it', async () => {
    const mesh = await boot()
    const ws0 = last()
    ws0.open()
    await vi.advanceTimersByTimeAsync(14_000)   // probe at 10 s, deadline at 14 s
    const ws1 = last()
    expect(ws1).not.toBe(ws0)

    await vi.advanceTimersByTimeAsync(2_000)
    ws0.receive(['EOSE', 'hc-live'])            // the answer, queued behind megabytes of PUTs
    expect(ws1.closedAt).toBeGreaterThan(0)     // the replacement is dropped
    expect(ws1.onopen).toBeNull()
    expect(mapped(mesh)).toBe(ws0)
    expect(ws0.closedAt).toBe(-1)
    expect(mesh.connectionState().state).toBe('open')
    await vi.advanceTimersByTimeAsync(9_000)    // short of the next idle probe's deadline
    expect(FakeWebSocket.all).toHaveLength(2)
  })

  it('a suspect that stays silent goes 12 s after its deadline, even with no replacement open', async () => {
    const mesh = await boot()
    const ws0 = last()
    ws0.open()
    await vi.advanceTimersByTimeAsync(14_000)
    const ws1 = last()
    expect(ws1).not.toBe(ws0)

    // the replacement's handshake times out at 8 s; another dials on the ladder
    await vi.advanceTimersByTimeAsync(8_000)
    expect(ws1.closedAt - T0).toBe(22_000)
    await vi.advanceTimersByTimeAsync(3_999)
    expect(ws0.closedAt).toBe(-1)
    const ws2 = last()
    expect(ws2).not.toBe(ws1)
    await vi.advanceTimersByTimeAsync(1)
    expect(ws0.closedAt - T0).toBe(26_000)
    expect(mapped(mesh)).toBe(ws2)              // the dialling replacement takes the slot
    expect(ws2.readyState).toBe(FakeWebSocket.CONNECTING)
  })

  it('an answered probe keeps the socket', async () => {
    await boot()
    const ws0 = last()
    ws0.open()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(probes(ws0)).toBe(1)
    ws0.receive(['EOSE', 'hc-live'])
    await vi.advanceTimersByTimeAsync(8_000)
    expect(FakeWebSocket.all).toHaveLength(1)
    expect(ws0.closedAt).toBe(-1)
  })

  it('a return to view probes an OPEN socket with a 3 s deadline', async () => {
    await boot()
    const ws0 = last()
    ws0.open()
    await vi.advanceTimersByTimeAsync(2_000)

    document.dispatchEvent(new Event('visibilitychange'))
    expect(probes(ws0)).toBe(1)

    await vi.advanceTimersByTimeAsync(2_999)
    expect(FakeWebSocket.all).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(FakeWebSocket.all).toHaveLength(2)    // the replacement dials at the 3 s deadline
    expect(last().createdAt - T0).toBe(5_000)
    last().open()
    expect(ws0.closedAt - T0).toBe(5_000)
  })

  it('judges nothing while queued bytes drain, and judges a buffer that stopped draining', async () => {
    await boot()
    const ws0 = last()
    ws0.open()
    ws0.bufferedAmount = 4096

    // draining: a little leaves the device every second
    for (let i = 0; i < 30; i++) { ws0.bufferedAmount -= 100; await vi.advanceTimersByTimeAsync(1_000) }
    expect(probes(ws0)).toBe(0)
    expect(ws0.closedAt).toBe(-1)

    // a probe in flight is not judged at its deadline while bytes drain either
    ws0.bufferedAmount = 0
    await vi.advanceTimersByTimeAsync(1_000)
    expect(probes(ws0)).toBe(1)                  // deadline at 35 s
    ws0.bufferedAmount = 1_000
    for (let i = 0; i < 10; i++) { ws0.bufferedAmount -= 50; await vi.advanceTimersByTimeAsync(1_000) }
    expect(FakeWebSocket.all).toHaveLength(1)

    // nothing has left the device for 15 s: the path stopped taking bytes
    await vi.advanceTimersByTimeAsync(14_000)
    expect(FakeWebSocket.all).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(FakeWebSocket.all).toHaveLength(2)    // judged: the replacement dials
  })

  it('a tick that runs more than a second late does not judge', async () => {
    await boot()
    const ws0 = last()
    ws0.open()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(probes(ws0)).toBe(1)               // deadline at 14 s

    // the main thread blocks for 6 s: the clock moves, the timers do not
    vi.setSystemTime(Date.now() + 6_000)
    await vi.advanceTimersByTimeAsync(1_500)  // the pending tick fires — late
    expect(FakeWebSocket.all).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1_000)  // the next, punctual tick judges
    expect(FakeWebSocket.all).toHaveLength(2)
  })

  it('a socket stuck CONNECTING is cut after 8 s, then 12 s, then 20 s', async () => {
    await boot()
    const ws0 = last()
    await vi.advanceTimersByTimeAsync(7_999)
    expect(ws0.closedAt).toBe(-1)
    await vi.advanceTimersByTimeAsync(1)
    expect(ws0.closedAt - ws0.createdAt).toBe(8_000)

    const ws1 = last()
    expect(ws1).not.toBe(ws0)
    await vi.advanceTimersByTimeAsync(11_999)
    expect(ws1.closedAt).toBe(-1)
    await vi.advanceTimersByTimeAsync(1)
    expect(ws1.closedAt - ws1.createdAt).toBe(12_000)

    await vi.advanceTimersByTimeAsync(250)    // the ladder's second step
    const ws2 = last()
    expect(ws2).not.toBe(ws1)
    await vi.advanceTimersByTimeAsync(ws2.createdAt + 19_999 - Date.now())
    expect(ws2.closedAt).toBe(-1)
    await vi.advanceTimersByTimeAsync(1)
    expect(ws2.closedAt - ws2.createdAt).toBe(20_000)

    // and an open resets the handshake escalation (not the ladder: an open
    // alone proves nothing, so the next dial waits the ladder's next step)
    await vi.advanceTimersByTimeAsync(500)
    const ws3 = last()
    ws3.open()
    ws3.drop()
    await vi.advanceTimersByTimeAsync(1_000)
    const ws4 = last()
    expect(ws4).not.toBe(ws3)
    await vi.advanceTimersByTimeAsync(ws4.createdAt + 8_000 - Date.now())
    expect(ws4.closedAt - ws4.createdAt).toBe(8_000)
  })

  it('the ladder starts again only when a socket proves itself — an answered probe, not a bare open', async () => {
    await boot()
    for (let i = 0; i < 4; i++) { last().drop(); await vi.advanceTimersByTimeAsync(1_000) }

    // opens, then goes at once (a middlebox, a drowning relay): the ladder climbs
    let ws = last()
    ws.open()
    ws.drop()
    await vi.advanceTimersByTimeAsync(2_000)
    const gap = last().createdAt - ws.closedAt
    expect(gap).toBeGreaterThanOrEqual(1_400)
    expect(gap).toBeLessThanOrEqual(2_000)

    // answers its probe: healthy, and the next loss redials at once
    ws = last()
    ws.open()
    await vi.advanceTimersByTimeAsync(11_000)   // the tick after 10 s idle
    expect(probes(ws)).toBe(1)
    ws.receive(['EOSE', 'hc-live'])
    ws.drop()
    expect(last()).not.toBe(ws)
    expect(last().createdAt).toBe(ws.closedAt)
  })
})

describe('retire and reconnect', () => {
  it("an orphan's late onclose leaves the live socket mapped", async () => {
    const mesh = await boot()
    const ws0 = last()
    ws0.open()
    const staleOnclose = ws0.onclose
    const staleOnmessage = ws0.onmessage

    ;(mesh as unknown as { reconnectAll: () => void }).reconnectAll()
    const ws1 = last()
    expect(ws1).not.toBe(ws0)
    expect(ws0.onclose).toBeNull()
    expect(mapped(mesh)).toBe(ws1)

    // a handler captured before the retire still changes nothing
    staleOnclose?.()
    staleOnmessage?.({ data: JSON.stringify(['EOSE', 'x']) })
    expect(mapped(mesh)).toBe(ws1)
    expect(FakeWebSocket.all).toHaveLength(2)

    ws1.open()
    const open = FakeWebSocket.all.filter(s => s.readyState === FakeWebSocket.OPEN)
    expect(open).toEqual([ws1])
    expect(mesh.getDebug().sockets).toHaveLength(1)
  })

  it('configureRelays with the same list does not reopen', async () => {
    const mesh = await boot()
    const ws0 = last()
    ws0.open()

    mesh.configureRelays([RELAY], false)
    expect(FakeWebSocket.all).toHaveLength(1)
    expect(ws0.closedAt).toBe(-1)

    mesh.configureRelays(['wss://other.test'], false)
    expect(last().url).toBe('wss://other.test')
    // the old socket drains what was already on its way (2 s), then closes
    await vi.advanceTimersByTimeAsync(2_000)
    expect(ws0.closedAt).toBeGreaterThan(0)
    // the old relay is off the list: nothing dials it again
    await vi.advanceTimersByTimeAsync(20_000)
    expect(FakeWebSocket.all.filter(s => s.url === RELAY)).toHaveLength(1)
  })

  it('the ladder runs 0, 250, 500, 1000, 2000, 4000 ms and caps at 4 s while visible', async () => {
    await boot()
    const caps = [0, 250, 500, 1_000, 2_000, 4_000, 4_000, 4_000]
    for (const cap of caps) {
      const ws = last()
      const before = FakeWebSocket.all.length
      ws.drop()
      if (cap > 0) await vi.advanceTimersByTimeAsync(cap)
      expect(FakeWebSocket.all.length).toBe(before + 1)
      const gap = last().createdAt - ws.closedAt
      expect(gap).toBeLessThanOrEqual(cap)
      expect(gap).toBeGreaterThanOrEqual(Math.floor(cap * 0.7))
    }
  })

  it('hidden, the ladder keeps climbing to a 15 s cap', async () => {
    await boot()
    visibility = 'hidden'
    const caps = [0, 250, 500, 1_000, 2_000, 4_000, 8_000, 15_000, 15_000]
    for (const cap of caps) {
      const ws = last()
      ws.drop()
      if (cap > 0) await vi.advanceTimersByTimeAsync(cap)
      const gap = last().createdAt - ws.closedAt
      expect(last()).not.toBe(ws)
      expect(gap).toBeLessThanOrEqual(cap)
      expect(gap).toBeGreaterThanOrEqual(Math.floor(cap * 0.7))
    }
  })

  it('online drops the backoff and dials at once', async () => {
    await boot()
    for (let i = 0; i < 5; i++) {
      last().drop()
      await vi.advanceTimersByTimeAsync(2_000)
    }
    const ws = last()
    ws.drop()                                  // now waiting up to 4 s
    const count = FakeWebSocket.all.length
    window.dispatchEvent(new Event('online'))
    expect(FakeWebSocket.all.length).toBe(count + 1)
    expect(last().createdAt).toBe(ws.closedAt)
  })

  it('a stopped mesh dials nothing on wake', async () => {
    const mesh = await boot()
    mesh.stop()
    const count = FakeWebSocket.all.length
    window.dispatchEvent(new Event('online'))
    window.dispatchEvent(new Event('pageshow'))
    expect(FakeWebSocket.all.length).toBe(count)
  })
})

describe('connection state', () => {
  it('runs open → stalled → open (reopened) when a replacement takes over', async () => {
    const seen: string[] = []
    EffectBus.on<{ state: string; reopened: boolean }>('mesh:connection', p => seen.push(p.reopened ? `${p.state}*` : p.state))
    const mesh = await boot()
    const ws0 = last()
    ws0.open()
    await vi.advanceTimersByTimeAsync(10_000)   // probe
    await vi.advanceTimersByTimeAsync(1_500)    // unanswered for 1.5 s
    expect(mesh.connectionState().state).toBe('stalled')
    await vi.advanceTimersByTimeAsync(2_500)    // deadline: a replacement dials, the old socket stays
    expect(mesh.connectionState().state).toBe('stalled')
    last().open()

    // the second 'stalled' carries attempt 1: the ladder counted the miss
    expect(seen).toEqual(['connecting', 'open', 'stalled', 'stalled', 'open*'])
    // reopened is an EDGE: the payload after it already says false
    const c = mesh.connectionState()
    expect(c).toMatchObject({ state: 'open', reopened: false, clockOffsetMs: 0 })
    expect(typeof c.since).toBe('number')
  })

  it('a reopen is announced once — a later stall answered on the same socket is a plain open', async () => {
    const seen: string[] = []
    EffectBus.on<{ state: string; reopened: boolean }>('mesh:connection', p => seen.push(p.reopened ? `${p.state}*` : p.state))
    await boot()
    last().open()
    last().drop()                               // retrying, redialled at once
    const ws1 = last()
    ws1.open()
    await vi.advanceTimersByTimeAsync(10_000)   // an idle probe on the new socket
    await vi.advanceTimersByTimeAsync(2_000)    // answered late: stalled first
    ws1.receive(['EOSE', 'hc-live'])
    // the payload right after open* is the edge falling back to false — what a
    // late subscriber replays — and nothing after it says reopened again
    expect(seen).toEqual(['connecting', 'open', 'retrying', 'open*', 'open', 'stalled', 'open'])
  })

  it('a routine probe answered at once never reads as stalled', async () => {
    const seen: string[] = []
    EffectBus.on<{ state: string }>('mesh:connection', p => seen.push(p.state))
    await boot()
    const ws0 = last()
    ws0.open()
    await vi.advanceTimersByTimeAsync(10_000)
    ws0.receive(['EOSE', 'hc-live'])
    await vi.advanceTimersByTimeAsync(5_000)
    expect(seen).toEqual(['connecting', 'open'])
  })

  it('is offline while this tab is not joined', async () => {
    membership.joined = false
    const mesh = await boot()
    expect(FakeWebSocket.all).toHaveLength(0)
    expect(mesh.connectionState().state).toBe('offline')
    expect(mesh.isNetworkEnabled()).toBe(false)
  })
})

describe('early arming', () => {
  it('arms in a microtask — no heartbeat needed — and sends the REQs first on open', async () => {
    const mesh = new NostrMeshDrone()
    meshes.push(mesh)
    localStorage.setItem('hc:nostrmesh:relays', JSON.stringify([RELAY]))
    // an effect emitted before the mesh armed still reaches it (last-value replay)
    EffectBus.emit('mesh:subscribe', { signature: 'b'.repeat(64), onItems: () => void 0 })
    expect(FakeWebSocket.all).toHaveLength(0)
    await Promise.resolve()
    expect(FakeWebSocket.all).toHaveLength(1)

    mesh.subscribe('c'.repeat(64), () => void 0)
    await mesh.publish(30200, 'c'.repeat(64), { hello: 1 }, [['d', 'L']])   // queued: still CONNECTING

    const ws0 = last()
    ws0.open()
    const types = ws0.sent.map(f => `${String(f[0])}:${f[0] === 'REQ' ? String(f[1]).slice(0, 3) : ''}`)
    expect(types).toEqual(['REQ:hc-', 'REQ:hc-', 'EVENT:'])
    expect(ws0.sent.slice(0, 2).map(f => (f[2] as { '#x': string[] })['#x'][0])).toEqual(['b'.repeat(64), 'c'.repeat(64)])
    expect(probes(ws0)).toBe(0)
  })
})
