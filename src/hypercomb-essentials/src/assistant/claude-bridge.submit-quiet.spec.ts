// @vitest-environment-options {"url": "http://localhost:4298/?claudeBridge=1&claudeBridgePort=2411"}
//
// claude-bridge.submit-quiet.spec.ts — A SENTENCE IS ANSWERED WHEN IT IS DONE.
//
// `submit` listened for the whole window it was given: a find that walked in
// 0.3 s still cost the caller 45 s (harness pass, 2026-10-18), and a word that
// ran past eight seconds was answered "did not answer in time" with its lines
// leaking into the next sentence's window. With `quiet`, `listen` is only the
// ceiling: the reply goes once the line is done (or the hive has spoken) and
// has then been quiet that long.
//
// Everything planted here is a fake: the socket and the command line.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus, REMOTE_SUBMIT, type RemoteSubmitRequest, type RemoteSubmitOutcome } from '@hypercomb/core'

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

// The runtime's own service lookup, which the worker reads as a global.
vi.stubGlobal('get', (key: string) => services.get(key))

let socket: FakeSocket
let asked = 0

/** What the fake command line does with the next line it is handed. */
let line: (request: RemoteSubmitRequest) => void = () => { /* set per test */ }

const submit = async (extra: Record<string, unknown>): Promise<{ ms: number; reply: { ok: boolean; error?: string; data?: Record<string, any> } }> => {
  const id = `quiet-${++asked}`
  const started = Date.now()
  socket.onmessage?.({ data: JSON.stringify({ id, op: 'submit', text: 'find betz /', ...extra }) })
  await vi.waitFor(() => expect(socket.sent.some(m => m['id'] === id)).toBe(true), { timeout: 5_000 })
  return { ms: Date.now() - started, reply: socket.sent.find(m => m['id'] === id) as never }
}

const ran: RemoteSubmitOutcome = { kind: 'ran', actions: [{ command: 'find', args: 'betz /', ok: true }] }
const unknown: RemoteSubmitOutcome = { kind: 'unknown', reason: 'the legacy pipeline cannot say' }

beforeAll(async () => {
  await import('./claude-bridge.worker.js')
  const worker = services.get('@diamondcoreprocessor.com/ClaudeBridgeWorker') as { pulse(grammar: string): Promise<void> }
  EffectBus.on<RemoteSubmitRequest>(REMOTE_SUBMIT, request => { request.accept?.(); line(request) })
  await worker.pulse('')
  await vi.waitFor(() => expect(FakeSocket.made).toHaveLength(1))
  socket = FakeSocket.made[0]!
  socket.open()
})

beforeEach(() => { line = () => { /* nothing */ } })

describe('listening stops when the sentence is done', () => {
  it('a finished line that spoke is answered after the quiet, not after the whole window', async () => {
    line = request => setTimeout(() => {
      EffectBus.emit('activity:log', { message: 'Find "betz" under /: 2 tiles' })
      request.complete?.(ran)
    }, 100)
    const { ms, reply } = await submit({ listen: 5_000, quiet: 200 })
    expect(reply.error ?? reply.ok).toBe(true)
    expect(reply.data?.['heard']).toEqual([{ kind: 'activity', text: 'Find "betz" under /: 2 tiles' }])
    expect(ms).toBeLessThan(2_000)
  })

  it('a line that cannot report its end is answered once the hive has spoken and gone quiet', async () => {
    line = request => {
      request.complete?.(unknown)
      setTimeout(() => EffectBus.emit('activity:log', { message: 'Walked every tile under /: 6,372 in 0.3 s.' }), 150)
    }
    const { ms, reply } = await submit({ listen: 5_000, quiet: 200 })
    expect(reply.data?.['heard']).toHaveLength(1)
    expect(ms).toBeLessThan(2_000)
  })

  it('a line that cannot report its end and has said nothing is held to the ceiling', async () => {
    line = request => request.complete?.(unknown)
    const { ms, reply } = await submit({ listen: 700, quiet: 100 })
    expect(reply.data?.['heard']).toEqual([])
    expect(ms).toBeGreaterThanOrEqual(650)
  })

  it('without quiet the window is held in full, as it always was', async () => {
    line = request => request.complete?.(ran)
    const { ms } = await submit({ listen: 500 })
    expect(ms).toBeGreaterThanOrEqual(450)
  })

  // The activity log is one shared stream. Three managers reading at once each
  // heard the others' answers (2026-10-22), so a sentence takes its turn.
  it('gives each sentence only its own answer when several are said at once', async () => {
    line = request => setTimeout(() => {
      EffectBus.emit('activity:log', { message: `answer to ${request.text}` })
      request.complete?.(ran)
    }, 80)
    const [a, b, c] = await Promise.all(['read /a', 'read /b', 'read /c'].map(text => submit({ text, listen: 5_000, quiet: 150 })))
    expect(a.reply.data?.['heard']).toEqual([{ kind: 'activity', text: 'answer to read /a' }])
    expect(b.reply.data?.['heard']).toEqual([{ kind: 'activity', text: 'answer to read /b' }])
    expect(c.reply.data?.['heard']).toEqual([{ kind: 'activity', text: 'answer to read /c' }])
  })

  it('keeps listening while the hive keeps speaking', async () => {
    line = request => {
      request.complete?.(ran)
      for (const at of [100, 300, 500]) setTimeout(() => EffectBus.emit('activity:log', { message: `line at ${at}` }), at)
    }
    const { reply } = await submit({ listen: 5_000, quiet: 250 })
    expect((reply.data?.['heard'] as unknown[]).length).toBe(3)
  })
})
