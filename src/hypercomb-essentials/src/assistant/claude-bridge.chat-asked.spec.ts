// @vitest-environment-options {"url": "http://localhost:4298/?claudeBridge=1&claudeBridgePort=2411"}
//
// claude-bridge.chat-asked.spec.ts — AN ASK ALWAYS ENDS.
//
// Ask results live in the page that ran the ask. A reload mid-turn took that
// page with it, and the asker read `done: false` for fifteen minutes (the
// harness manager, 2026-10-11). An ask minted before this page loaded is
// answered as failed, saying why; one this page is still running stays open.
//
// Everything planted here is a fake: the socket and every service.

import { beforeAll, describe, expect, it, vi } from 'vitest'
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

let socket: FakeSocket
let asked = 0
const op = async (request: Record<string, unknown>): Promise<{ ok: boolean; data?: Record<string, any> }> => {
  const id = `chat-asked-${++asked}`
  socket.onmessage?.({ data: JSON.stringify({ id, ...request }) })
  await vi.waitFor(() => expect(socket.sent.some(m => m['id'] === id)).toBe(true))
  return socket.sent.find(m => m['id'] === id) as never
}
const mintedAt = (ms: number): string => `ask-${ms.toString(36)}-abc123`

beforeAll(async () => {
  await import('./claude-bridge.worker.js')
  const worker = services.get('@diamondcoreprocessor.com/ClaudeBridgeWorker') as { pulse(grammar: string): Promise<void> }
  await worker.pulse('')
  await vi.waitFor(() => expect(FakeSocket.made).toHaveLength(1))
  socket = FakeSocket.made[0]!
  socket.open()
})

describe('an ask always ends', () => {
  it('an ask minted before this page loaded is over, and says the tab reloaded', async () => {
    const reply = await op({ op: 'chat-asked', cell: mintedAt(Date.now() - 60 * 60 * 1000) })
    expect(reply.ok).toBe(true)
    expect(reply.data).toMatchObject({ done: true, ok: false, outcome: 'failed' })
    expect(String(reply.data?.['error'])).toMatch(/reloaded/)
  })

  it('an ask this page is running stays open until its result arrives', async () => {
    const started = await op({ op: 'chat-ask', cell: 'chat:tile:/::spec-convo', text: 'find betz' })
    const askId = String(started.data?.['askId'])
    expect((await op({ op: 'chat-asked', cell: askId })).data).toEqual({ done: false, askId })
    EffectBus.emit('chat:asked', { askId, convoId: 'chat:tile:/::spec-convo', ok: true, outcome: 'answered', answer: 'two' })
    expect((await op({ op: 'chat-asked', cell: askId })).data).toMatchObject({ done: true, ok: true, outcome: 'answered' })
  })

  it('an id that names no time is not judged', async () => {
    expect((await op({ op: 'chat-asked', cell: 'not-an-ask' })).data).toEqual({ done: false, askId: 'not-an-ask' })
  })
})
