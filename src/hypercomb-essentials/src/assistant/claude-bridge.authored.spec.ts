// @vitest-environment-options {"url": "http://localhost:4298/?claudeBridge=1&claudeBridgePort=2411"}
//
// assistant/claude-bridge.authored.spec.ts
//
// THE BRIDGE MARKS ONLY THE BYTES IT PUT (2026-11-28, inline-code-in-input-
// audit.md M1). A request may name any signature the hive holds, a peer's page
// among them. Before this, every page writer on the bridge (decoration-add,
// bag-set, bag-add, update) marked whatever it named as this hive's own, and an
// authored page runs as the hive, with its key and storage in reach. Now a page
// is marked only when this bridge put its bytes (`put-resource`); a page the
// request only names stays what it was.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { isAuthored } from '../sharing/authored-sigs.js'

localStorage.setItem('hc:bridge:open', 'all')

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

const held = new Map<string, Uint8Array>()
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
/** jsdom's Blob has no arrayBuffer(); its FileReader reads one. */
const blobBytes = (blob: Blob): Promise<Uint8Array> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
  reader.onerror = () => reject(reader.error)
  reader.readAsArrayBuffer(blob)
})
/** A peer's page, already held (adopted or brought by the content broker), never put by the bridge. */
const PEER_PAGE = new TextEncoder().encode('<!doctype html><script>steal()</script>')
const PEER = sha(PEER_PAGE)
held.set(PEER, PEER_PAGE)

const services = new Map<string, unknown>([
  ['@hypercomb.social/Store', {
    putResource: async (blob: Blob) => { const bytes = await blobBytes(blob); const sig = sha(bytes); held.set(sig, bytes); return sig },
    getResource: async (sig: string) => held.has(sig) ? new Blob([held.get(sig)! as BlobPart]) : null,
  }],
  ['@diamondcoreprocessor.com/HistoryService', {
    sign: async () => 'f'.repeat(64),
    currentLayerAt: async () => ({ name: 'page' }),
  }],
  ['@diamondcoreprocessor.com/LayerCommitter', {
    update: async () => 'e'.repeat(64),
    commitSlotSet: async () => { /* committed */ },
    commitSlotAppend: async () => { /* committed */ },
    commitSlotRemove: async () => { /* committed */ },
  }],
])
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
const ask = async (request: Record<string, unknown>): Promise<{ ok: boolean; error?: string; data?: Record<string, any> }> => {
  const id = `authored-${++asked}`
  socket.onmessage?.({ data: JSON.stringify({ id, ...request }) })
  await vi.waitFor(() => expect(socket.sent.some(m => m['id'] === id)).toBe(true), { timeout: 5_000 })
  return socket.sent.find(m => m['id'] === id) as never
}
const put = async (text: string): Promise<string> => {
  const res = await ask({ op: 'put-resource', text })
  expect(res.ok, res.error).toBe(true)
  return res.data!['sig'] as string
}

beforeAll(async () => {
  await import('./claude-bridge.worker.js')
  const worker = services.get('@diamondcoreprocessor.com/ClaudeBridgeWorker') as { pulse(grammar: string): Promise<void> }
  await worker.pulse('')
  await vi.waitFor(() => expect(FakeSocket.made).toHaveLength(1))
  socket = FakeSocket.made[0]!
  socket.open()
})

beforeEach(() => localStorage.removeItem('hc:authored-sigs'))

describe('what the bridge marks as this hive\'s own', () => {
  it('decoration-add marks a page it put, and leaves a page it only names as it was', async () => {
    const own = await put('<!doctype html><p>a page this bridge wrote</p>')
    const mine = await ask({ op: 'decoration-add', segments: ['site'], kind: 'visual:website:page', payload: { htmlSig: own }, mark: 'persistent' })
    expect(mine.ok, mine.error).toBe(true)
    expect(isAuthored(own)).toBe(true)

    const theirs = await ask({ op: 'decoration-add', segments: ['site', 'other'], kind: 'visual:website:page', payload: { htmlSig: PEER }, mark: 'persistent' })
    expect(theirs.ok, theirs.error).toBe(true)
    expect(isAuthored(PEER)).toBe(false)
  })

  it('a room\'s bundle is the same: marked only when the bridge put it', async () => {
    const bundle = await put('export default function room() {}')
    expect((await ask({ op: 'decoration-add', segments: ['lounge'], kind: 'visual:lounge:room', payload: { version: 1, bundleSig: bundle } })).ok).toBe(true)
    expect(isAuthored(bundle)).toBe(true)
    expect((await ask({ op: 'decoration-add', segments: ['lounge', 'b'], kind: 'visual:lounge:room', payload: { version: 1, bundleSig: PEER } })).ok).toBe(true)
    expect(isAuthored(PEER)).toBe(false)
  })

  it('bag-set, bag-add and update mark only the page sigs the bridge put', async () => {
    const own = await put('<!doctype html><p>another of mine</p>')
    const set = await ask({ op: 'bag-set', segments: ['site'], slot: 'website', cells: [PEER, own] })
    expect(set.ok, set.error).toBe(true)
    expect(isAuthored(own)).toBe(true)
    expect(isAuthored(PEER)).toBe(false)

    localStorage.removeItem('hc:authored-sigs')
    const added = await ask({ op: 'bag-add', segments: ['site'], slot: 'context', sig: PEER })
    expect(added.ok, added.error).toBe(true)
    expect(isAuthored(PEER)).toBe(false)

    const updated = await ask({ op: 'update', segments: [], layer: { name: 'site', website: [PEER], context: [own] } })
    expect(updated.ok, updated.error).toBe(true)
    expect(isAuthored(PEER)).toBe(false)
    expect(isAuthored(own)).toBe(true)
  })
})
