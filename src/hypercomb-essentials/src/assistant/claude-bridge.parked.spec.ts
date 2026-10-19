// @vitest-environment-options {"url": "http://localhost:4298/?claudeBridge=1&claudeBridgePort=2411"}
//
// claude-bridge.parked.spec.ts — THE BROKER BEING UP IS NOT A SESSION BEING THERE.
//
// The renderer's socket to the broker is `connected`; the managers keep that
// socket busy all day with no session answering anything. A session is
// `listening` only while it keeps visiting the ask pool and promising to
// return (watch-asks.cjs sends `parked: <ms>`), and the claim goes with the
// socket. The chat window queues a declined question for a session only when
// this says one is there.
//
// Everything planted here is a fake: the socket and every service.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

class FakeSocket {
  static readonly OPEN = 1
  static made: FakeSocket[] = []
  readyState = 0
  readonly sent: Record<string, unknown>[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(readonly url: string) { FakeSocket.made.push(this) }
  send(raw: string): void { this.sent.push(JSON.parse(raw) as Record<string, unknown>) }
  open(): void { this.readyState = FakeSocket.OPEN; this.onopen?.() }
  close(): void { this.readyState = 3; this.onclose?.() }
}
vi.stubGlobal('WebSocket', FakeSocket)
vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ ok: true }) }))

const services = new Map<string, unknown>()
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { if (!services.has(key)) services.set(key, value) },
  get: (key: string) => services.get(key),
  whenReady: () => { /* noop */ },
  onRegister: () => () => { /* noop */ },
  list: () => [...services.keys()],
}

type Worker = { pulse(grammar: string): Promise<void>; connected: boolean; listening: boolean; connectedAt: number }
let worker: Worker
let socket: FakeSocket
let asked = 0
const statuses: { connected?: boolean; listening?: boolean }[] = []

const visit = async (request: Record<string, unknown>): Promise<void> => {
  const id = `parked-${++asked}`
  socket.onmessage?.({ data: JSON.stringify({ id, op: 'optimization-list', ...request }) })
  await vi.waitFor(() => expect(socket.sent.some(m => m['id'] === id)).toBe(true))
}

beforeAll(async () => {
  await import('./claude-bridge.worker.js')
  worker = services.get('@diamondcoreprocessor.com/ClaudeBridgeWorker') as Worker
  EffectBus.on<{ connected?: boolean; listening?: boolean }>('bridge:status', payload => { statuses.push({ ...payload }) })
  await worker.pulse('')
  await vi.waitFor(() => expect(FakeSocket.made).toHaveLength(1))
  socket = FakeSocket.made[0]!
  socket.open()
})

afterAll(() => { vi.restoreAllMocks() })

describe('a session is listening only while it visits and promises to return', () => {
  it('a connected renderer with nobody visiting is up, not listening', () => {
    expect(worker.connected).toBe(true)
    expect(worker.listening).toBe(false)
    expect(statuses.at(-1)).toEqual({ connected: true, listening: false })
  })

  it('a visit that promises nothing — a peek, a drain tick, a smoke test — claims nothing', async () => {
    await visit({ kind: 'ask' })
    expect(worker.listening).toBe(false)
  })

  it('a visit to some other pool claims nothing, whatever it promises', async () => {
    await visit({ kind: 'qa', parked: 6_000 })
    expect(worker.listening).toBe(false)
  })

  it('a parked visit makes the session listening, and says so', async () => {
    await visit({ kind: 'ask', parked: 6_000 })
    expect(worker.listening).toBe(true)
    expect(statuses.at(-1)).toEqual({ connected: true, listening: true })
  })

  it('the claim lapses when the visits stop, with no one having to say so', () => {
    const now = performance.now()
    const spy = vi.spyOn(performance, 'now').mockReturnValue(now + 18_001)
    expect(worker.listening).toBe(false)
    spy.mockRestore()
  })

  it('does not move when the wall clock is set back', async () => {
    await visit({ kind: 'ask', parked: 6_000 })
    const spy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() - 60 * 60 * 1000)
    expect(worker.listening).toBe(true)
    spy.mockRestore()
  })

  it('reads false while the socket is down, and the session is still there when it comes back', async () => {
    await visit({ kind: 'ask', parked: 6_000 })
    expect(worker.listening).toBe(true)
    socket.close()
    expect(worker.connected).toBe(false)
    expect(worker.listening).toBe(false)
    expect(statuses.at(-1)).toEqual({ connected: false, listening: false })

    EffectBus.emit('claude-bridge:connect', {})
    await vi.waitFor(() => expect(FakeSocket.made).toHaveLength(2))
    socket = FakeSocket.made[1]!
    socket.open()
    expect(worker.connected).toBe(true)
    expect(worker.listening).toBe(true)
    expect(statuses.at(-1)).toEqual({ connected: true, listening: true })
  })

  it('says when the socket opened, so a surface can tell "no session" from "none has visited yet"', () => {
    expect(Math.abs(Date.now() - worker.connectedAt)).toBeLessThan(5_000)
  })
})
