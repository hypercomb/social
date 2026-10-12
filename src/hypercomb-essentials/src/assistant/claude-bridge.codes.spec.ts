// @vitest-environment-options {"url": "http://localhost:4250/?claudeBridge=1"}
//
// claude-bridge.codes.spec.ts — the renderer tells the broker who besides
// this machine may send ops: the bridge codes' HASHES, never the codes, as
// the whole set — when it registers, and again whenever the list changes
// (documentation/claude-bridge-setup.md, "Who may use the bridge — codes").

import { createHash } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { BRIDGE_CODE_STORE_IOC_KEY, BridgeCodeStore } from '@hypercomb/core'

const nodeHash = (code: string): string => createHash('sha256').update(code, 'utf8').digest('hex')

class FakeSocket {
  static readonly OPEN = 1
  static made: FakeSocket[] = []
  readyState = 0
  readonly sent: unknown[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(readonly url: string) { FakeSocket.made.push(this) }
  send(raw: string): void { this.sent.push(JSON.parse(raw)) }
  open(): void { this.readyState = FakeSocket.OPEN; this.onopen?.() }
  drop(): void { this.readyState = 3; this.onclose?.() }
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

localStorage.clear()
const store = new BridgeCodeStore()
services.set(BRIDGE_CODE_STORE_IOC_KEY, store)
await store.add('susan', 'hcb-susan')

const logs: string[] = []
vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(' ')) })

await import('./claude-bridge.worker.js')
const worker = services.get('@diamondcoreprocessor.com/ClaudeBridgeWorker') as { pulse(grammar: string): Promise<void> }

afterAll(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('the renderer and the bridge codes', () => {
  it('registers with the hashes of the codes held', async () => {
    await worker.pulse('')
    await vi.waitFor(() => expect(FakeSocket.made).toHaveLength(1))
    FakeSocket.made[0]!.open()
    expect(FakeSocket.made[0]!.sent).toEqual([{ type: 'renderer', codes: [nodeHash('hcb-susan')] }])
  })

  it('sends the whole set again whenever the list changes', async () => {
    const socket = FakeSocket.made[0]!
    socket.sent.length = 0
    const given = await store.generate('raj')
    if (!given.ok) throw new Error('not given')
    expect(socket.sent).toEqual([{ type: 'codes', codes: [nodeHash('hcb-susan'), nodeHash(given.code)] }])
    store.withdraw('susan')
    expect(socket.sent.at(-1)).toEqual({ type: 'codes', codes: [nodeHash(given.code)] })
    store.withdraw('raj')
    expect(socket.sent.at(-1)).toEqual({ type: 'codes', codes: [] })
    // No message carries a code.
    expect(JSON.stringify(socket.sent)).not.toContain(given.code)
  })

  it('sends nothing while the socket is not open', async () => {
    const socket = FakeSocket.made[0]!
    socket.drop()
    const before = socket.sent.length
    await store.add('mira', 'hcb-mira')
    expect(socket.sent).toHaveLength(before)
  })

  it('logs counts, never a hash', () => {
    expect(logs.some(line => line.includes('bridge codes'))).toBe(true)
    expect(logs.join('\n')).not.toMatch(/[0-9a-f]{64}/)
  })
})
