// publish-branch.refused.spec.ts — A NODE THAT REFUSED IS NOT "STILL
// UPLOADING" (TS-4, the 2026-10-10 long-tail hunt).
//
// `publish here` on a branch whose publish domain answers 403 (participants
// closed, not a writer): host-sync pauses that host for ten minutes after one
// refused PUT, so nothing is uploading — yet the publish polled for 120 s and
// then toasted "still uploading … retry on their own; publish again in a
// moment", a promise nobody keeps (T5: one PUT, a 403, a toast at 124 s).
// Now the publish reads the gate's verdict on its nodes: every node refused
// what it lacks → it stops at once, names the node and its own words, and the
// index is not advanced. Run against the REAL host-sync: the drain's answer is
// what decides — no request of the publish's own.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus, SignatureService } from '@hypercomb/core'
import type { HiveIndexResult, PutHiveResult } from './hive-pointer.js'

vi.setConfig({ testTimeout: 30_000 })

const PUBKEY = 'ab'.repeat(32)
const NODE = 'dead-b.example'

let putCalls: Record<string, string>[] = []

vi.mock('./hive-pointer.js', () => ({
  nip98Header: async () => 'Nostr test',
  // The node answers its index door: nothing published under this key yet.
  fetchHiveIndex: async (): Promise<HiveIndexResult> => ({ ok: false, reason: 'http', status: 404 } as HiveIndexResult),
  fetchHiveManifest: async () => null,
  fetchHiveManifestFromAny: async () => null,
  putHiveManifest: async (_host: string, roots: Record<string, string>): Promise<PutHiveResult> => {
    putCalls.push(roots)
    return { ok: true, pubkey: PUBKEY, createdAt: 1_700_000_000 } as PutHiveResult
  },
}))

// ── an in-memory OPFS, enough for host-sync's queue and receipts ──────────

const notFound = (name: string): DOMException => new DOMException(`${name} not found`, 'NotFoundError')
class MemoryFile {
  readonly kind = 'file' as const
  #bytes = new Uint8Array(0)
  #mtime = Date.now()
  constructor(readonly name: string) {}
  async getFile(): Promise<{ size: number; lastModified: number; arrayBuffer: () => Promise<ArrayBuffer> }> {
    const bytes = this.#bytes
    return { size: bytes.byteLength, lastModified: this.#mtime, arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer }
  }
  async createWritable(): Promise<{ write: (d: unknown) => Promise<void>; close: () => Promise<void> }> {
    let next = new Uint8Array(0)
    return {
      write: async (d: unknown) => { next = d instanceof Uint8Array ? d.slice() : new Uint8Array(d as ArrayBuffer).slice() },
      close: async () => { this.#bytes = next; this.#mtime = Date.now() },
    }
  }
}
class MemoryDir {
  readonly kind = 'directory' as const
  readonly children = new Map<string, MemoryDir | MemoryFile>()
  async getDirectoryHandle(name: string, o?: { create?: boolean }): Promise<MemoryDir> {
    const f = this.children.get(name)
    if (f && f.kind === 'directory') return f
    if (f || !o?.create) throw notFound(name)
    const d = new MemoryDir(); this.children.set(name, d); return d
  }
  async getFileHandle(name: string, o?: { create?: boolean }): Promise<MemoryFile> {
    const f = this.children.get(name)
    if (f && f.kind === 'file') return f
    if (f || !o?.create) throw notFound(name)
    const m = new MemoryFile(name); this.children.set(name, m); return m
  }
  async removeEntry(name: string): Promise<void> { if (!this.children.delete(name)) throw notFound(name) }
  async *entries(): AsyncGenerator<[string, MemoryDir | MemoryFile]> { yield* [...this.children.entries()] }
}

const registry = new Map<string, unknown>()
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registry.set(key, value) },
  get: (key: string) => registry.get(key),
  whenReady: () => undefined,
}

const sign = async (bytes: Uint8Array): Promise<string> => await SignatureService.sign(bytes.slice().buffer as ArrayBuffer)
const layers = new Map<string, Uint8Array>()
const resources = new Map<string, Uint8Array>()
let sealed = ''
/** Each test publishes new content: host-sync's walk is session memory, and
 *  each test's disk is new. */
let edition = 0

type Result = { ok: boolean; failure?: string; reason?: string; refused?: { host: string; state: string; reason: string } }
let publishBranch: (segments: readonly string[]) => Promise<Result>
let hostCurrentBranch: () => Promise<void>

const node = (put: () => Response) => {
  const fetch = vi.fn(async (_input: string, init?: RequestInit): Promise<Response> =>
    (init?.method ?? 'GET') === 'PUT' ? put() : new Response(null, { status: 404 }))
  return fetch
}
const puts = (fetch: ReturnType<typeof node>): number => fetch.mock.calls.filter(([, init]) => init?.method === 'PUT').length

beforeAll(async () => {
  const HostSync = (await import('./host-sync.service.js')).HostSyncService
  const { SwarmHostResolver } = await import('./swarm-hosts.js')
  registry.set('@diamondcoreprocessor.com/HostSyncService', new HostSync(new SwarmHostResolver({
    readMarks: async () => [], relay: () => ({ host: '' }),
    originLoopback: () => false, session: () => null,
  })))
  ;({ publishBranch } = await import('./publish-branch.js') as unknown as { publishBranch: typeof publishBranch })
  ;({ hostCurrentBranch } = await import('./host-gesture.js'))
})

beforeEach(async () => {
  putCalls = []
  layers.clear()
  resources.clear()
  localStorage.clear()
  // Not joined: a publish is not a swarm offer — its bytes go to its nodes.
  EffectBus.emit('mesh:public-changed', { public: false })
  // The participant's standing public host is the branch's node.
  localStorage.setItem('hc:public-host', '1')
  localStorage.setItem('hc:public-host:domain', NODE)
  const pic = new TextEncoder().encode(`a picture on the branch, edition ${++edition}`)
  const picSig = await sign(pic)
  resources.set(picSig, pic)
  const layer = new TextEncoder().encode(JSON.stringify({ name: 'pb', images: [picSig] }))
  sealed = await sign(layer)
  layers.set(sealed, layer)
  registry.set('@hypercomb.social/Store', {
    opfsRoot: new MemoryDir(),
    putResource: async () => 'd'.repeat(64),
    getResourceLocal: async (s: string) => { const b = resources.get(s); return b ? { size: b.byteLength, arrayBuffer: async () => b.slice().buffer } : null },
    getLayerPoolBytes: async (s: string) => layers.get(s)?.slice() ?? null,
  })
  registry.set('@diamondcoreprocessor.com/HistoryService', { sealSubtree: async () => sealed })
  registry.set('@diamondcoreprocessor.com/NostrSigner', {
    getPublicKeyHex: async () => PUBKEY,
    signEvent: async (e: Record<string, unknown>) => ({ ...e, id: 'e', pubkey: PUBKEY, sig: 's' }),
  })
  registry.set('@hypercomb.social/Lineage', { explorerSegments: () => ['pb'] })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('TS-4: a node that refused the upload ends the publish at once, by name', () => {
  it('403 participants-closed: refused within seconds after ONE upload, the node and its words — the index untouched', async () => {
    const fetch = node(() => new Response('participants-closed', { status: 403 }))
    vi.stubGlobal('fetch', fetch)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const started = Date.now()
    const result = await publishBranch(['pb'])
    const took = Date.now() - started
    // Still `not-available` to the panel (the index was not advanced), but
    // REFUSED — never "still uploading": the node and its own words.
    expect(result).toMatchObject({ ok: false, failure: 'not-available', refused: { host: NODE, reason: '403 participants-closed', state: 'refused' } })
    expect(took).toBeLessThan(5_000)
    expect(puts(fetch)).toBe(1)
    expect(putCalls).toEqual([]) // no index write: no link points at bytes the node never took
  })

  it('a node that is merely slow is still waited for — never "refused" while an upload is on its way', async () => {
    let answered = 0
    const fetch = node(() => { answered++; return new Response('deploying', { status: 503 }) })
    vi.stubGlobal('fetch', fetch)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const pending = publishBranch(['pb'])
    const raced = await Promise.race([pending, new Promise(r => setTimeout(() => r('still waiting'), 4_000))])
    expect(raced).toBe('still waiting')
    expect(answered).toBeGreaterThan(0)
    // Let it end: publishes run one at a time (publish-lane.ts), so one left
    // waiting would hold every publish after it. The node now refuses, and the
    // waiting publish stops on its next upload.
    vi.stubGlobal('fetch', node(() => new Response('participants-closed', { status: 403 })))
    await expect(pending).resolves.toMatchObject({ ok: false })
  }, 30_000)

  it('the share-sheet gesture toasts "<node> refused the upload (<reason>) — nothing was published"', async () => {
    vi.stubGlobal('fetch', node(() => new Response('participants-closed', { status: 403 })))
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const offConfirm = EffectBus.on<{ id: string }>('confirm:request', (req) => { EffectBus.emit('confirm:response', { id: req.id, confirmed: true }) })
    const toasts: { type: string; message: string }[] = []
    const offToast = EffectBus.on<{ type: string; message: string }>('toast:show', t => { toasts.push(t) })
    toasts.length = 0
    try {
      await hostCurrentBranch()
      expect(toasts.at(-1)).toMatchObject({ type: 'error', message: `${NODE} refused the upload (403 participants-closed) — nothing was published` })
    } finally { offConfirm(); offToast() }
  })
})
