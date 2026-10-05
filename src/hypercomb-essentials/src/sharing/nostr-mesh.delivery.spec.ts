// nostr-mesh.delivery.spec.ts — what the mesh sends arrives, or says why not.
//
// A refused EVENT used to be a console.warn: publish() had already said true
// and the event was gone until the next refresh 45-75 s later. Two updates to
// one replaceable slot in the same second tied and half the newer ones were
// never delivered; a device minutes off the relay's clock was invisible; a
// consumer joining a shared bucket never saw the relay's replay, and the
// global id dedup ate it a second time. These specs pin the acks, the
// rate-limit retries, the requeue on retire, the per-slot clock, the relay
// clock card, the per-bucket dedup with replay, and the CLOSED backoff.
//
// window.ioc and the WebSocket global are stubbed BEFORE the module import
// (the drone self-registers at load); membership is mocked.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const membership = vi.hoisted(() => ({ joined: false }))
vi.mock('./membership.js', () => ({ isJoinedHere: () => membership.joined }))

type Frame = unknown[]
type Evt = { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string }

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
  // A live relay answers the liveness probe; a half-open path answers nothing.
  alive = true
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(public url: string) { FakeWebSocket.all.push(this) }

  send(data: string): void {
    if (this.readyState !== FakeWebSocket.OPEN) throw new Error('InvalidStateError')
    const frame = JSON.parse(data) as Frame
    this.sent.push(frame)
    if (this.alive && frame[0] === 'REQ' && frame[1] === 'hc-live') queueMicrotask(() => this.receive(['EOSE', 'hc-live']))
  }
  close(): void {
    if (this.closedAt < 0) this.closedAt = Date.now()
    this.readyState = FakeWebSocket.CLOSED
  }

  open(): void { this.readyState = FakeWebSocket.OPEN; this.onopen?.() }
  receive(msg: Frame): void { this.onmessage?.({ data: JSON.stringify(msg) }) }
  drop(): void { this.readyState = FakeWebSocket.CLOSED; if (this.closedAt < 0) this.closedAt = Date.now(); this.onclose?.() }
}

let seq = 0
const PK = 'a'.repeat(64)
const PEER = 'b'.repeat(64)
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
const S = 'c'.repeat(64)

let meshes: Mesh[] = []
let warn: ReturnType<typeof vi.spyOn>

const last = (): FakeWebSocket => FakeWebSocket.all[FakeWebSocket.all.length - 1]
const events = (ws: FakeWebSocket): Evt[] => ws.sent.filter(f => f[0] === 'EVENT').map(f => f[1] as Evt)
const sendsOf = (ws: FakeWebSocket, id: string): number => events(ws).filter(e => e.id === id).length
const reqs = (ws: FakeWebSocket, sig: string): Frame[] =>
  ws.sent.filter(f => f[0] === 'REQ' && ((f[2] as { '#x'?: string[] })['#x'] ?? [])[0] === sig)
const subIdOf = (ws: FakeWebSocket, sig: string): string => String(reqs(ws, sig)[0]?.[1] ?? '')
const nowSec = (): number => Math.floor(Date.now() / 1000)

const peerEvent = (id: string, extra: Partial<Evt> = {}): Evt => ({
  id: id.padStart(64, '0'), pubkey: PEER, created_at: nowSec(), kind: 30200, tags: [['x', S], ['d', 'p']], content: '{"peer":1}', sig: 'e'.repeat(128), ...extra,
})

const boot = async (): Promise<{ mesh: Mesh; ws: FakeWebSocket }> => {
  localStorage.setItem('hc:nostrmesh:relays', JSON.stringify([RELAY]))
  const mesh = new NostrMeshDrone()
  meshes.push(mesh)
  await Promise.resolve()   // the constructor's microtask arms it
  const ws = last()
  ws.open()
  return { mesh, ws }
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0 })
  EffectBus.clear()
  FakeWebSocket.all = []
  membership.joined = true
  warn = vi.spyOn(console, 'warn').mockImplementation(() => void 0)
})

afterEach(() => {
  for (const m of meshes) m.stop()
  meshes = []
  vi.useRealTimers()
  warn.mockRestore()
  localStorage.clear()
})

describe('acks and retries', () => {
  it("re-sends a 'rate-limited:' refusal after about 1 s, then about 2 s", async () => {
    const { mesh, ws } = await boot()
    await mesh.publish(30200, S, { a: 1 }, [['d', 'L']])
    const id = events(ws)[0].id

    ws.receive(['OK', id, false, 'rate-limited: slow down'])
    await vi.advanceTimersByTimeAsync(999)
    expect(sendsOf(ws, id)).toBe(1)
    await vi.advanceTimersByTimeAsync(301)
    expect(sendsOf(ws, id)).toBe(2)

    ws.receive(['OK', id, false, 'rate-limited: slow down'])
    await vi.advanceTimersByTimeAsync(1_999)
    expect(sendsOf(ws, id)).toBe(2)
    await vi.advanceTimersByTimeAsync(601)
    expect(sendsOf(ws, id)).toBe(3)

    ws.receive(['OK', id, true, ''])
    await vi.advanceTimersByTimeAsync(30_000)
    expect(sendsOf(ws, id)).toBe(3)
  })

  it('gives up after five re-sends and says so', async () => {
    const rejected: unknown[] = []
    EffectBus.on('mesh:rejected', p => rejected.push(p))
    const { mesh, ws } = await boot()
    await mesh.publish(30200, S, { a: 1 }, [['d', 'L'], ['expiration', String(nowSec() + 600)]])
    const id = events(ws)[0].id
    for (const base of [1_000, 2_000, 4_000, 8_000, 15_000]) {
      const before = sendsOf(ws, id)
      ws.receive(['OK', id, false, 'rate-limited: slow down'])
      await vi.advanceTimersByTimeAsync(Math.ceil(base * 1.3))
      expect(sendsOf(ws, id)).toBe(before + 1)
    }
    ws.receive(['OK', id, false, 'rate-limited: slow down'])
    await vi.advanceTimersByTimeAsync(30_000)
    expect(sendsOf(ws, id)).toBe(6)
    expect(rejected).toEqual([{ id, kind: 30200, reason: 'rate-limited: slow down', d: 'L' }])
  })

  it('does not re-send a slot a newer publish superseded', async () => {
    const { mesh, ws } = await boot()
    await mesh.publish(30200, S, { v: 1 }, [['d', 'L']])
    const older = events(ws)[0].id
    ws.receive(['OK', older, false, 'rate-limited: slow down'])

    await mesh.publish(30200, S, { v: 2 }, [['d', 'L']])
    const newer = events(ws)[1].id
    await vi.advanceTimersByTimeAsync(5_000)

    expect(sendsOf(ws, older)).toBe(1)
    expect(sendsOf(ws, newer)).toBe(1)
  })

  it("announces any other refusal as mesh:rejected and never re-sends it", async () => {
    const rejected: unknown[] = []
    EffectBus.on('mesh:rejected', p => rejected.push(p))
    const { mesh, ws } = await boot()
    await mesh.publish(30201, S, { a: 1 }, [['d', 'R']])
    const id = events(ws)[0].id

    ws.receive(['OK', id, false, 'invalid: bad signature'])
    await vi.advanceTimersByTimeAsync(60_000)

    expect(sendsOf(ws, id)).toBe(1)
    expect(rejected).toEqual([{ id, kind: 30201, reason: 'invalid: bad signature', d: 'R' }])
  })

  it("a clock refusal marks the connection refused: 'clock' until an event is accepted", async () => {
    const { mesh, ws } = await boot()
    await mesh.publish(30200, S, { a: 1 }, [['d', 'L']])
    ws.receive(['OK', events(ws)[0].id, false, 'invalid: created_at is too far in the future'])
    expect(mesh.connectionState().refused).toBe('clock')

    await mesh.publish(30200, S, { a: 2 }, [['d', 'L']])
    ws.receive(['OK', events(ws)[1].id, true, ''])
    expect(mesh.connectionState().refused).toBeUndefined()
  })

  it('re-sends frames a dead socket swallowed once the relay is back', async () => {
    const { mesh, ws } = await boot()
    ws.alive = false
    await vi.advanceTimersByTimeAsync(1_000)
    await mesh.publish(30200, S, { a: 1 }, [['d', 'L']])
    const id = events(ws)[0].id

    // half-open: nothing comes back. 5 s without the OK → probe; 4 s → a
    // replacement dials (9 s after the publish) while the old socket keeps
    // its place; the replacement's open retires it.
    await vi.advanceTimersByTimeAsync(4_999)
    expect(ws.sent.filter(f => f[1] === 'hc-live')).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(ws.sent.filter(f => f[1] === 'hc-live')).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(4_000)
    const ws1 = last()
    expect(ws1).not.toBe(ws)
    expect(ws1.createdAt - T0).toBe(10_000)   // 9 s after the publish
    expect(ws.closedAt).toBe(-1)

    ws1.open()
    expect(ws.closedAt - T0).toBe(10_000)
    expect(sendsOf(ws1, id)).toBe(1)
  })
})

describe('created_at', () => {
  it('two same-second publishes to one slot get t and t+1', async () => {
    const { mesh, ws } = await boot()
    await mesh.publish(30200, S, { v: 1 }, [['d', 'L']])
    await mesh.publish(30200, S, { v: 2 }, [['d', 'L']])
    await mesh.publish(30200, S, { v: 3 }, [['d', 'other']])
    const [a, b, c] = events(ws)
    expect(a.created_at).toBe(nowSec())
    expect(b.created_at).toBe(nowSec() + 1)
    expect(c.created_at).toBe(nowSec())        // another slot keeps its own floor
  })

  it('a tombstone heard under our own key makes the next beacon newer than it', async () => {
    const { mesh, ws } = await boot()
    const X = 'd'.repeat(64)
    mesh.subscribe(X, () => void 0)
    await mesh.publish(30206, X, { alive: true }, [['d', 'me']])   // learns our key

    const T = nowSec() + 40   // the relay's clock is ahead; it made the will
    ws.receive(['EVENT', subIdOf(ws, X), { id: 'f'.repeat(64), pubkey: PK, created_at: T, kind: 30206, tags: [['x', X], ['d', 'me']], content: '{"left":true}', sig: '' }])

    await mesh.publish(30206, X, { alive: true }, [['d', 'me']])
    const beacon = events(ws)[1]
    expect(beacon.created_at).toBeGreaterThanOrEqual(T + 1)
  })

  it("an hc:host card 120 s ahead moves created_at and expiration onto the relay's clock", async () => {
    const { mesh, ws } = await boot()
    ws.receive(['NOTICE', 'hc:host ' + JSON.stringify({ v: 1, time: nowSec() + 120, participants: 'all' })])

    expect(mesh.connectionState().clockOffsetMs).toBe(120_500)
    expect(mesh.nowSec()).toBe(nowSec() + 120)

    const localExp = nowSec() + 90
    await mesh.publish(30200, S, { a: 1 }, [['d', 'L'], ['expiration', String(localExp)]])
    const e = events(ws)[0]
    expect(e.created_at).toBe(nowSec() + 120)
    const exp = Number(e.tags.find(t => t[0] === 'expiration')?.[1])
    expect(Math.abs(exp - (localExp + 120))).toBeLessThanOrEqual(1)
    expect(exp).toBeGreaterThan(e.created_at)
  })

  it('a skew under 2 s changes nothing', async () => {
    const { mesh, ws } = await boot()
    ws.receive(['NOTICE', 'hc:host ' + JSON.stringify({ v: 1, time: nowSec() + 1, participants: false })])
    expect(mesh.connectionState().clockOffsetMs).toBe(0)
    expect(mesh.now()).toBe(Date.now())
  })

  it('a device found FAST asks again for the window its first REQ cut short', async () => {
    const { mesh, ws } = await boot()
    mesh.subscribe(S, () => void 0)
    expect(reqs(ws, S)).toHaveLength(1)

    ws.receive(['NOTICE', 'hc:host ' + JSON.stringify({ v: 1, time: nowSec() - 300, participants: 'all' })])
    const again = reqs(ws, S)
    expect(again).toHaveLength(2)
    expect((again[1][2] as { since: number }).since).toBe(mesh.nowSec() - 900)
  })
})

describe('dedup and replay', () => {
  it('a consumer joining a bucket gets what the bucket already holds', async () => {
    const { mesh, ws } = await boot()
    const first: unknown[] = []
    mesh.subscribe(S, e => first.push(e.payload))
    ws.receive(['EVENT', subIdOf(ws, S), peerEvent('1')])
    expect(first).toEqual([{ peer: 1 }])

    const joiner: unknown[] = []
    mesh.subscribe(S, e => joiner.push(e.payload))
    expect(joiner).toEqual([])
    await Promise.resolve()
    expect(joiner).toEqual([{ peer: 1 }])
    expect(first).toEqual([{ peer: 1 }])       // the first consumer is not fed twice
    expect(reqs(ws, S)).toHaveLength(1)         // and no second REQ went out
  })

  it("drops a repeat within a connection, and delivers the relay's replay after a reopen", async () => {
    const { mesh, ws } = await boot()
    const got: unknown[] = []
    mesh.subscribe(S, e => got.push(e.payload))
    const sub = subIdOf(ws, S)
    ws.receive(['EVENT', sub, peerEvent('1')])
    ws.receive(['EVENT', sub, peerEvent('1')])
    expect(got).toHaveLength(1)

    ws.drop()
    const ws1 = last()
    ws1.open()
    ws1.receive(['EVENT', subIdOf(ws1, S), peerEvent('1')])
    expect(got).toHaveLength(2)
    expect(mesh.getNonExpired(S).filter(e => e.relay !== 'local')).toHaveLength(1)   // the cache holds one copy
  })

  it("a probe's bucket no longer eats the replay a later subscriber needs", async () => {
    const { mesh, ws } = await boot()
    // a visuals probe opens and closes a bucket at S, the relay replays into it
    const probe = mesh.subscribe(S, () => void 0)
    ws.receive(['EVENT', subIdOf(ws, S), peerEvent('7')])
    probe.close()

    const got: unknown[] = []
    mesh.subscribe(S, e => got.push(e.payload))
    const fresh = reqs(ws, S)[1]
    ws.receive(['EVENT', String(fresh[1]), peerEvent('7')])
    expect(got).toEqual([{ peer: 1 }])
  })
})

describe('CLOSED backoff', () => {
  it('retries a refused bucket after 1 s · 2^n with jitter, and an EOSE resets it', async () => {
    const { mesh, ws } = await boot()
    mesh.subscribe(S, () => void 0)
    const sub = subIdOf(ws, S)

    ws.receive(['CLOSED', sub, 'rate-limited: slow down'])
    await vi.advanceTimersByTimeAsync(999)
    expect(reqs(ws, S)).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(301)
    expect(reqs(ws, S)).toHaveLength(2)

    ws.receive(['CLOSED', sub, 'rate-limited: slow down'])
    await vi.advanceTimersByTimeAsync(1_999)
    expect(reqs(ws, S)).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(601)
    expect(reqs(ws, S)).toHaveLength(3)

    ws.receive(['EOSE', sub])
    ws.receive(['CLOSED', sub, 'rate-limited: slow down'])
    await vi.advanceTimersByTimeAsync(1_300)
    expect(reqs(ws, S)).toHaveLength(4)
  })

  it('caps the wait at 30 s', async () => {
    const { mesh, ws } = await boot()
    mesh.subscribe(S, () => void 0)
    const sub = subIdOf(ws, S)
    for (let i = 0; i < 8; i++) {
      ws.receive(['CLOSED', sub, 'rate-limited: slow down'])
      await vi.advanceTimersByTimeAsync(30_000)
      ws.receive(['EOSE', 'not-this-one'])
    }
    expect(reqs(ws, S)).toHaveLength(9)
  })

  it("'too many subscriptions' marks the connection refused until that bucket stands", async () => {
    const { mesh, ws } = await boot()
    mesh.subscribe(S, () => void 0)
    const sub = subIdOf(ws, S)
    ws.receive(['CLOSED', sub, 'error: too many subscriptions (max 200)'])
    expect(mesh.connectionState().refused).toBe('subscriptions')
    await vi.advanceTimersByTimeAsync(1_300)
    ws.receive(['EOSE', sub])
    expect(mesh.connectionState().refused).toBeUndefined()
  })
})

describe('swarmHost', () => {
  it('is the host of the first relay this tab may dial', async () => {
    localStorage.setItem('hc:nostrmesh:relays', JSON.stringify(['wss://jwize.com']))
    const live = new NostrMeshDrone()
    meshes.push(live)
    expect(live.swarmHost()).toBe('jwize.com')

    localStorage.setItem('hc:nostrmesh:relays', JSON.stringify(['ws://localhost:7801', 'wss://jwize.com']))
    const local = new NostrMeshDrone()
    meshes.push(local)
    await Promise.resolve()
    expect(local.swarmHost()).toBe('localhost:7801')

    local.configureRelays([], false)
    expect(local.swarmHost()).toBe('')
  })
})
