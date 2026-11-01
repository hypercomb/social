// @vitest-environment-options {"url": "http://localhost:4298/?claudeBridge=1&claudeBridgePort=2411"}
//
// assistant/claude-bridge.lines-only.spec.ts
//
// THE BRIDGE CARRIES COMMAND-LINE LINES ONLY, unless the participant opened
// it by hand (jwize, 2026-11-01: "shut off so we can prove our concept").
//
//   1. Every op but `submit` is refused, and says how to say it instead.
//   2. A `submit` never reaches the command line directly: it is one call from
//      outside (EXTERNAL_CALL), named by `from`, one line per line of text,
//      and it is answered only when the participant has answered.
//   3. `effect-emit`, which could answer the gate itself, is refused.
//   4. Files, which would be written before anyone answered, are refused.

import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  EffectBus, EXTERNAL_CALL, REMOTE_SUBMIT,
  type ExternalCallOutcome, type ExternalCallRequest, type RemoteSubmitRequest,
} from '@hypercomb/core'

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
vi.stubGlobal('get', (key: string) => services.get(key))

let socket: FakeSocket
let asked = 0
const calls: ExternalCallRequest[] = []
const direct: string[] = []

const send = (request: Record<string, unknown>): string => {
  const id = `lines-${++asked}`
  socket.onmessage?.({ data: JSON.stringify({ id, ...request }) })
  return id
}
const reply = async (id: string): Promise<{ ok: boolean; error?: string; data?: Record<string, any> }> => {
  await vi.waitFor(() => expect(socket.sent.some(m => m['id'] === id)).toBe(true), { timeout: 5_000 })
  return socket.sent.find(m => m['id'] === id) as never
}
const answered = (id: string): boolean => socket.sent.some(m => m['id'] === id)

beforeAll(async () => {
  localStorage.removeItem('hc:bridge:open')
  await import('./claude-bridge.worker.js')
  const worker = services.get('@diamondcoreprocessor.com/ClaudeBridgeWorker') as { pulse(grammar: string): Promise<void> }
  // The queue the external-call drone keeps, faked: take the call, hold it.
  EffectBus.on<ExternalCallRequest>(EXTERNAL_CALL, call => { call.accept?.(); calls.push(call) })
  EffectBus.on<RemoteSubmitRequest>(REMOTE_SUBMIT, request => { request.accept?.(); direct.push(request.text) })
  await worker.pulse('')
  await vi.waitFor(() => expect(FakeSocket.made).toHaveLength(1))
  socket = FakeSocket.made[0]!
  socket.open()
})

describe('the bridge carries lines only', () => {
  it('refuses every other op and says how to say it', async () => {
    for (const op of ['list', 'put-resource', 'bag-set', 'stamp', 'chat-reply', 'swarm-debug']) {
      const res = await reply(send({ op, text: 'x' }))
      expect(res.ok).toBe(false)
      expect(res.error).toContain(`"${op}" is shut off`)
    }
  })

  it('refuses effect-emit, which could answer the gate itself', async () => {
    const res = await reply(send({ op: 'effect-emit', effect: 'command-line:external-answer', payload: { decision: 'run' } }))
    expect(res.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('makes a submit one call from outside, answered only when the participant answers', async () => {
    const id = send({ op: 'submit', from: 'claude-code', text: 'create word\n\n  go word  ' })
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    const call = calls[0]!
    expect(call.from).toBe('claude-code')
    expect(call.lines).toEqual(['create word', 'go word'])
    expect(direct).toEqual([])

    await new Promise(resolve => setTimeout(resolve, 50))
    expect(answered(id)).toBe(false)

    const outcome: ExternalCallOutcome = {
      kind: 'ran', convoId: 'chat:tile:/::external-claude-code-1',
      results: [{ text: 'create word', verdict: 'ran /create' }, { text: 'go word', verdict: 'ran /go' }],
    }
    call.complete?.(outcome)
    const res = await reply(id)
    expect(res.ok).toBe(true)
    expect(res.data?.['outcome']).toEqual(outcome)
    expect(res.data?.['summary']).toBe('create word → ran /create\ngo word → ran /go')
  })

  it('answers a decline as a decline', async () => {
    const id = send({ op: 'submit', text: 'create other' })
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1]!.from).toBe('the bridge')
    calls[1]!.complete?.({ kind: 'declined', convoId: 'chat:tile:/::external-the-bridge-2' })
    const res = await reply(id)
    expect(res.ok).toBe(true)
    expect(res.data?.['summary']).toBe('declined by the participant; nothing ran')
  })

  it('refuses files, which would be written before anyone answered', async () => {
    const res = await reply(send({ op: 'submit', text: 'website page x', files: [{ name: 'a.txt', text: 'hello' }] }))
    expect(res.ok).toBe(false)
    expect(res.error).toContain('files are shut off')
    expect(calls).toHaveLength(2)
  })
})
