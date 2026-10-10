// nostr-mesh.meeting-point.spec.ts — where this tab meets, and with what.
//
// Pinned here:
//   1. ADDRESSES. Only signatures can be queried: the mesh refuses to read or
//      write at anything but a 64-hex signature (bar the one drained word,
//      'broker:fetch'), instead of sending a REQ the relay's address gate
//      closes and leaving a bucket silently deaf.
//   2. THE TAB'S MEETING POINT. A joined tab dials the relay its zone names
//      (sessionStorage hc:mesh-zone.relay — per tab, so a refresh comes back to
//      the same place and another tab's list never moves it); not joined, or
//      no relay named, it dials the page's own list. A join into the place the
//      warm socket already meets at tears nothing down.
//   3. THE ACCESS CODE rides the dial as the subprotocol `hc-access.<code>`,
//      to the meeting point only — no extra frame, no extra round trip. A
//      refusal (close 4401) says refused: 'access', never announces an open,
//      and backs off 5 s, 15 s, 30 s, then every 60 s — a wake does not
//      shorten it; a new code dials at once.
//   4. relaysAddressed() — the drained word is room-scoped only where every
//      relay's card says its reads are addressed.

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
  protocols: string[]
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e?: { code?: number }) => void) | null = null
  onerror: (() => void) | null = null

  constructor(public url: string, protocols?: string | string[]) {
    this.protocols = protocols === undefined ? [] : Array.isArray(protocols) ? protocols : [protocols]
    FakeWebSocket.all.push(this)
  }

  send(data: string): void {
    if (this.readyState !== FakeWebSocket.OPEN) throw new Error('InvalidStateError')
    this.sent.push(JSON.parse(data) as Frame)
  }
  close(): void {
    if (this.closedAt < 0) this.closedAt = Date.now()
    this.readyState = FakeWebSocket.CLOSED
  }

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

const OWN = 'wss://own.test'        // the page's own relay list
const MEET = 'wss://meet.test'      // the meeting point a link named
const T0 = new Date('2026-10-09T18:00:00.000Z').getTime()
const SIG = 'c'.repeat(64)

let meshes: Mesh[] = []
let warn: ReturnType<typeof vi.spyOn>
let connections: Conn[] = []

const last = (): FakeWebSocket => FakeWebSocket.all[FakeWebSocket.all.length - 1]
const dialsTo = (url: string): FakeWebSocket[] => FakeWebSocket.all.filter(ws => ws.url === url)
const reqs = (ws: FakeWebSocket, sig?: string): Frame[] =>
  ws.sent.filter(f => f[0] === 'REQ' && f[1] !== 'hc-live' && (sig === undefined || ((f[2] as { '#x'?: string[] })['#x'] ?? [])[0] === sig))

const setZone = (zone: Record<string, string>): void => { sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'r', secret: 's', ...zone })) }

const boot = async (relays: string[] = [OWN]): Promise<Mesh> => {
  localStorage.setItem('hc:nostrmesh:relays', JSON.stringify(relays))
  const mesh = new NostrMeshDrone()
  meshes.push(mesh)
  await Promise.resolve()   // the constructor's microtask arms it
  return mesh
}

/** A join, as the shell announces it — the mesh reads the zone a microtask later. */
const join = async (): Promise<void> => {
  membership.joined = true
  EffectBus.emit('mesh:public-changed', { public: true })
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0 })
  EffectBus.clear()
  FakeWebSocket.all = []
  membership.joined = true
  connections = []
  EffectBus.on<Conn>('mesh:connection', c => { connections.push({ ...c }) })
  warn = vi.spyOn(console, 'warn').mockImplementation(() => void 0)
})

afterEach(() => {
  for (const m of meshes) m.stop()
  meshes = []
  vi.useRealTimers()
  warn.mockRestore()
  localStorage.clear()
  sessionStorage.clear()
})

describe('addresses: only signatures', () => {
  it('refuses to listen, query or publish at a word — no REQ, no EVENT, one warning per word', async () => {
    const mesh = await boot()
    const ws = last()
    ws.open()
    for (const word of ['visuals', 'hc:feedback-channel', 'C'.repeat(64), 'abc']) {
      mesh.subscribe(word, () => void 0)
      mesh.ensureStartedForSig(word)
      void mesh.query(word, 200)
      void mesh.awaitReadyForSig(word, 10)
      expect(await mesh.publish(30200, word, { a: 1 })).toBe(false)
    }
    expect(reqs(ws)).toEqual([])
    expect(ws.sent.filter(f => f[0] === 'EVENT')).toEqual([])
    expect(mesh.getNonExpired('visuals')).toEqual([])   // not even local fanout
    expect(warn.mock.calls.filter((c: unknown[]) => String(c[0]).includes('64-hex signature'))).toHaveLength(4)
  })

  it("a signature, and the one drained word, still go out", async () => {
    const mesh = await boot()
    const ws = last()
    ws.open()
    mesh.subscribe(SIG, () => void 0)
    mesh.subscribe('broker:fetch', () => void 0)
    expect(reqs(ws, SIG)).toHaveLength(1)
    expect(reqs(ws, 'broker:fetch')).toHaveLength(1)
    expect(await mesh.publish(20400, 'broker:fetch', '', [['d', SIG], ['t', 'layer']])).toBe(true)
    expect(await mesh.publish(30200, SIG, { a: 1 })).toBe(true)
    expect(ws.sent.filter(f => f[0] === 'EVENT')).toHaveLength(2)
  })
})

describe("the tab's meeting point", () => {
  it('a joined tab dials the relay its zone names — and only it — and a refresh comes straight back there', async () => {
    setZone({ relay: MEET })
    const mesh = await boot([OWN])
    expect(FakeWebSocket.all.map(ws => ws.url)).toEqual([MEET])
    expect(mesh.swarmHost()).toBe('meet.test')

    // Another tab moves the origin-wide list meanwhile; this tab reloads.
    mesh.stop()
    localStorage.setItem('hc:nostrmesh:relays', JSON.stringify(['wss://elsewhere.test']))
    const reloaded = new NostrMeshDrone()
    meshes.push(reloaded)
    await Promise.resolve()
    expect(FakeWebSocket.all.map(ws => ws.url)).toEqual([MEET, MEET])
  })

  it("not joined, the warm socket goes to the page's own list, whatever the zone names", async () => {
    membership.joined = false
    setZone({ relay: MEET, code: 'secret-code' })
    const mesh = await boot([OWN])
    mesh.setNetworkEnabled(true, false)   // the feedback channel's warm socket
    expect(FakeWebSocket.all.map(ws => ws.url)).toEqual([OWN])
    expect(last().protocols).toEqual([])   // the code never goes anywhere but its meeting point
  })

  it('a join that names a meeting point moves the socket there; a join that names none keeps the warm one', async () => {
    membership.joined = false
    const mesh = await boot([OWN])
    mesh.setNetworkEnabled(true, false)
    const warm = last()
    warm.open()

    // A join with no meeting point: the warm socket IS the meeting — kept.
    setZone({})
    await join()
    expect(FakeWebSocket.all).toEqual([warm])
    expect(warm.closedAt).toBe(-1)

    // A meeting link that names another meeting point: one dial, there.
    setZone({ relay: MEET })
    EffectBus.emit('mesh:zone', {})
    await Promise.resolve()
    await Promise.resolve()
    expect(FakeWebSocket.all.map(ws => ws.url)).toEqual([OWN, MEET])
    // The warm socket drains (what was on its way there goes out), then closes.
    expect(warm.closedAt).toBe(-1)
    vi.advanceTimersByTime(2_000)
    expect(warm.closedAt).toBe(T0 + 2_000)
  })

  it('the {left} for the room being left goes out on the socket it came in on, even when the meeting point moves while it is signed', async () => {
    const LEAVING = 'e'.repeat(64)
    const mesh = await boot([OWN])
    const old = last()
    old.open()
    old.card({ addressed: true })
    // The room changes (the swarm asks for its {left}) and, in the same
    // gesture, the mesh is pointed at the new meeting point — before the
    // signature lands.
    const left = mesh.publish(30206, LEAVING, { left: true }, [['d', PK]])
    setZone({ relay: MEET })
    mesh.configureRelays([MEET], false)
    await left
    const events = (ws: FakeWebSocket): Frame[] => ws.sent.filter(f => f[0] === 'EVENT')
    expect(events(old).map(f => ((f[1] as { tags: string[][] }).tags.find(t => t[0] === 'x') ?? [])[1])).toEqual([LEAVING])
    // Nothing else ever goes out on the draining socket, and it closes.
    const fresh = last()
    expect(fresh.url).toBe(MEET)
    fresh.open()
    await mesh.publish(30206, SIG, { alive: true }, [['d', PK]])
    expect(events(old)).toHaveLength(1)
    vi.advanceTimersByTime(2_000)
    expect(old.readyState).toBe(FakeWebSocket.CLOSED)
  })

  it('a zone recorded after the join announcement is picked up on the next pulse', async () => {
    membership.joined = false
    const mesh = await boot([OWN])
    mesh.setNetworkEnabled(true, false)
    last().open()
    await join()
    expect(FakeWebSocket.all.map(ws => ws.url)).toEqual([OWN])
    setZone({ relay: MEET })
    await (mesh as unknown as { heartbeat: () => Promise<void> }).heartbeat()
    expect(FakeWebSocket.all.map(ws => ws.url)).toEqual([OWN, MEET])
  })

  it("the page's own list (the /domain word) never takes this tab's meeting point — and never moves it", async () => {
    setZone({ relay: MEET, code: 'the-point-code' })
    const mesh = await boot([OWN])
    expect(last().url).toBe(MEET)
    expect(mesh.ownRelays()).toEqual([OWN])
    mesh.configureOwnRelays([...mesh.ownRelays(), 'wss://other.test'])
    // Saved for every tab of the origin, without the meeting point…
    expect(JSON.parse(localStorage.getItem('hc:nostrmesh:relays')!)).toEqual([OWN, 'wss://other.test'])
    // …while this tab stays where its meeting is.
    expect(FakeWebSocket.all.map(ws => ws.url)).toEqual([MEET])
    expect(mesh.ownRelays()).toEqual([OWN, 'wss://other.test'])
  })

  it('a zone relay that is not a ws(s) URL is ignored', async () => {
    setZone({ relay: 'https://meet.test' })
    await boot([OWN])
    expect(FakeWebSocket.all.map(ws => ws.url)).toEqual([OWN])
  })
})

describe('the access code', () => {
  it('rides the dial to the meeting point as hc-access.<code>, and the REQs go out on open — no extra round trip', async () => {
    setZone({ relay: MEET, code: 'Zx9_-abc.DEF' })
    const mesh = await boot([OWN])
    const ws = last()
    expect(ws.url).toBe(MEET)
    expect(ws.protocols).toEqual(['hc-access.Zx9_-abc.DEF'])
    mesh.subscribe(SIG, () => void 0)
    ws.open()
    expect(reqs(ws, SIG)).toHaveLength(1)   // sent with the open, before anything is heard
    // Not announced as open until the meeting point says something: its card.
    expect(mesh.connectionState().state).not.toBe('open')
    ws.card()
    expect(mesh.connectionState().state).toBe('open')
    expect(mesh.connectionState().refused).toBeUndefined()
  })

  it('a code with no meeting point named goes to no relay at all — it is for one meeting point', async () => {
    setZone({ code: 'only-for-its-point' })
    await boot([OWN, 'wss://second.test'])
    expect(dialsTo(OWN)[0].protocols).toEqual([])
    expect(dialsTo('wss://second.test')[0].protocols).toEqual([])
  })

  it("a meeting point this page may not dial (loopback, from a real host) gets no code, and the tab meets nowhere — refused: 'unreachable'", async () => {
    setZone({ relay: 'ws://localhost:7801', code: 'K3y-for-the-point' })
    localStorage.setItem('hc:nostrmesh:relays', JSON.stringify([OWN]))
    const mesh = new NostrMeshDrone()
    meshes.push(mesh)
    // A page on a real host (jsdom serves localhost, which may dial loopback).
    ;(mesh as unknown as { isLocalContext: () => boolean }).isLocalContext = () => false
    await Promise.resolve()
    mesh.subscribe(SIG, () => void 0)
    // Never the default relay with the meeting point's code — and never the
    // default relay at all: the room is at the point, not here.
    expect(FakeWebSocket.all.filter(ws => ws.protocols.some(p => p.includes('K3y')))).toEqual([])
    expect(dialsTo(OWN)).toEqual([])
    expect(mesh.connectionState().refused).toBe('unreachable')
    expect(mesh.connectionState().state).toBe('offline')
    // A meeting point it can dial moves it there and clears the refusal.
    setZone({ relay: MEET, code: 'K3y-for-the-point' })
    EffectBus.emit('mesh:zone', { relay: MEET })
    await Promise.resolve()
    expect(last().url).toBe(MEET)
    expect(last().protocols).toEqual(['hc-access.K3y-for-the-point'])
    expect(mesh.connectionState().refused).toBeUndefined()
  })

  it('a code that is not a subprotocol token dials without it, and says so', async () => {
    setZone({ relay: MEET, code: 'has a space' })
    await boot([OWN])
    expect(last().url).toBe(MEET)
    expect(last().protocols).toEqual([])
    expect(warn.mock.calls.some((c: unknown[]) => String(c[0]).includes('not a valid subprotocol token'))).toBe(true)
  })

  it("a refused code (close 4401) is refused: 'access' — never an open, never a reassert — and backs off 5 s, 15 s, 30 s, 60 s", async () => {
    setZone({ relay: MEET, code: 'stale-code' })
    const mesh = await boot([OWN])
    vi.spyOn(Math, 'random').mockReturnValue(0)   // no jitter: the ladder to the millisecond
    const refuse = (): void => { const ws = last(); ws.open(); ws.drop(4401) }

    refuse()
    expect(mesh.connectionState()).toMatchObject({ state: 'retrying', refused: 'access' })
    expect(connections.some(c => c.state === 'open' || c.reopened)).toBe(false)

    const waits: number[] = []
    for (let i = 0; i < 5; i++) {
      const before = FakeWebSocket.all.length
      const from = Date.now()
      while (FakeWebSocket.all.length === before) await vi.advanceTimersByTimeAsync(250)
      waits.push(Date.now() - from)
      refuse()
    }
    // the ladder (to the tick): 5 s, 15 s, 30 s, 60 s, 60 s
    expect(waits.map(w => Math.round(w / 1000))).toEqual([5, 15, 30, 60, 60])
    expect(connections.some(c => c.state === 'open' || c.reopened)).toBe(false)
    expect(connections.at(-1)).toMatchObject({ state: 'retrying', refused: 'access' })

    // A wake does not shorten it.
    const before = FakeWebSocket.all.length
    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(FakeWebSocket.all.length).toBe(before)
  })

  it('a new code (a new link) dials at once, past the refusal — and an admitted one clears it', async () => {
    setZone({ relay: MEET, code: 'stale-code' })
    const mesh = await boot([OWN])
    const first = last()
    first.open()
    first.drop(4401)
    expect(mesh.connectionState().refused).toBe('access')

    setZone({ relay: MEET, code: 'fresh-code' })
    EffectBus.emit('mesh:zone', {})
    await Promise.resolve()
    await Promise.resolve()
    const next = last()
    expect(next).not.toBe(first)
    expect(next.protocols).toEqual(['hc-access.fresh-code'])
    next.open()
    next.card()
    expect(mesh.connectionState()).toMatchObject({ state: 'open' })
    expect(mesh.connectionState().refused).toBeUndefined()
  })

  it('a socket that is in stays in when the link brings a new code; recycled out (4401), it dials the new code at once', async () => {
    setZone({ relay: MEET, code: 'old-code' })
    const mesh = await boot([OWN])
    const live = last()
    live.open()
    live.card()
    expect(mesh.connectionState().state).toBe('open')

    setZone({ relay: MEET, code: 'new-code' })
    EffectBus.emit('mesh:zone', {})
    await Promise.resolve()
    await Promise.resolve()
    await (mesh as unknown as { heartbeat: () => Promise<void> }).heartbeat()
    expect(FakeWebSocket.all).toEqual([live])     // no teardown, no extra dial
    expect(live.closedAt).toBe(-1)

    // The operator recycled the old code: the meeting point closes it.
    live.drop(4401)
    await vi.advanceTimersByTimeAsync(0)
    expect(FakeWebSocket.all).toHaveLength(2)
    expect(last().protocols).toEqual(['hc-access.new-code'])
    expect(mesh.connectionState().refused).toBeUndefined()
  })

  it('an ordinary drop still climbs the ordinary ladder', async () => {
    setZone({ relay: MEET, code: 'good-code' })
    const mesh = await boot([OWN])
    const ws = last()
    ws.open()
    ws.card()
    ws.drop(1006)
    expect(mesh.connectionState().refused).toBeUndefined()
    await vi.advanceTimersByTimeAsync(0)
    expect(FakeWebSocket.all).toHaveLength(2)   // the ladder's first step is 0 ms
  })
})

describe('relaysAddressed', () => {
  it("is true only when every relay's card says its reads are addressed", async () => {
    const mesh = await boot([OWN, 'wss://second.test'])
    const [a, b] = FakeWebSocket.all
    a.open(); b.open()
    expect(mesh.relaysAddressed()).toBe(false)
    a.card({ addressed: true })
    expect(mesh.relaysAddressed()).toBe(false)   // one card unheard
    b.card()
    expect(mesh.relaysAddressed()).toBe(false)   // one relay before the gate
    b.card({ addressed: true })
    expect(mesh.relaysAddressed()).toBe(true)
  })
})
