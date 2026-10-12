// host-sync.swarm-target.spec.ts — THE SWARM'S HOSTS ARE RESOLVED PER PAGE.
//
// A joined tab uploads the tiles it offers on a page to that page's publish
// domains, else the host field — the meeting point the participant entered
// (the mesh's swarmHost) — else nowhere (swarm-hosts.ts; jwize 2026-10-11:
// there is no default host, the hosts pool picks nothing, the meeting point's
// card decides nothing). Nothing is stored or picked, so a reload finds the
// same targets and the receipts on disk count again. A host's `201 stored
// <sig>` is the receipt (no read-back), uploads go four at a time, and every
// failure backs off per host with the host's own reason.
//
// Most of this file exercises the drain through the host field — the meeting
// point's own heap — because its mechanics are the same for every swarm
// host; "which host" has its own block at the end.
//
// The drain reads OPFS through the Store's `opfsRoot`, so the fake root and
// the fake local store are handed over through IoC, as is the mesh stub (for
// its relay clock). Where the bytes go is handed to each service directly, as
// a resolver over a fake world.

import { createHash } from 'node:crypto'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus, SignatureService } from '@hypercomb/core'

// ── in-memory OPFS ─────────────────────────────────────────────────────────

const notFound = (name: string): DOMException => new DOMException(`${name} not found`, 'NotFoundError')
let clock = 1_700_000_000_000

const toBytes = (data: unknown): Uint8Array => {
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
  if (Object.prototype.toString.call(data) === '[object ArrayBuffer]') return new Uint8Array((data as ArrayBuffer).slice(0))
  throw new TypeError('fake OPFS writes bytes only')
}

class MemoryFile {
  readonly kind = 'file' as const
  #bytes = new Uint8Array(0)
  #mtime = ++clock
  constructor(readonly name: string) {}
  async getFile(): Promise<{ name: string; size: number; lastModified: number; arrayBuffer: () => Promise<ArrayBuffer> }> {
    const bytes = this.#bytes
    return { name: this.name, size: bytes.byteLength, lastModified: this.#mtime, arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer }
  }
  async createWritable(): Promise<{ write: (data: unknown) => Promise<void>; close: () => Promise<void> }> {
    const chunks: Uint8Array[] = []
    return {
      write: async (data: unknown) => { chunks.push(toBytes(data)) },
      close: async () => {
        const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0))
        let at = 0
        for (const c of chunks) { out.set(c, at); at += c.byteLength }
        this.#bytes = out
        this.#mtime = ++clock
      },
    }
  }
}

class MemoryDir {
  readonly kind = 'directory' as const
  readonly children = new Map<string, MemoryDir | MemoryFile>()
  constructor(readonly name: string) {}
  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MemoryDir> {
    const found = this.children.get(name)
    if (found) {
      if (found.kind !== 'directory') throw new DOMException(`${name} is a file`, 'TypeMismatchError')
      return found
    }
    if (!options?.create) throw notFound(name)
    const made = new MemoryDir(name)
    this.children.set(name, made)
    return made
  }
  async getFileHandle(name: string, options?: { create?: boolean }): Promise<MemoryFile> {
    const found = this.children.get(name)
    if (found) {
      if (found.kind !== 'file') throw new DOMException(`${name} is a directory`, 'TypeMismatchError')
      return found
    }
    if (!options?.create) throw notFound(name)
    const made = new MemoryFile(name)
    this.children.set(name, made)
    return made
  }
  async removeEntry(name: string): Promise<void> {
    if (!this.children.has(name)) throw notFound(name)
    this.children.delete(name)
  }
  async *entries(): AsyncGenerator<[string, MemoryDir | MemoryFile]> { yield* [...this.children.entries()] }
  names(): string[] { return [...this.children.keys()].sort() }
}

// ── SHA-256 in the same turn ───────────────────────────────────────────────
// WebCrypto hashes on a worker thread and answers on a later turn of the
// event loop: the one piece of this world that neither the microtask queue
// nor a fake clock holds. On a loaded machine that turn comes late. A
// fake-time step moved the clock while a retry's PUT still waited on its
// digest (a wait of at most 5 s measured 6.3 s), and a real-time test ended
// with its drain still running, PUTting into the next test's host. The same
// SHA-256, answered on the microtask queue, leaves nothing that waits on the
// wall clock: `settle()` runs every chain out, and a fake timer's work is
// done at the instant it fires.
const digestNow = async (algorithm: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer> => {
  const name = typeof algorithm === 'string' ? algorithm : algorithm.name
  const hash = createHash(name.replace('-', '').toLowerCase()).update(toBytes(data)).digest()
  return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength) as ArrayBuffer
}

// ── IoC: the local store, the signer, the mesh ─────────────────────────────

const registry = new Map<string, unknown>()
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registry.set(key, value) },
  get: (key: string) => registry.get(key),
  whenReady: () => undefined,
}

const MESH_KEY = '@diamondcoreprocessor.com/NostrMeshDrone'

type Service = {
  drain: () => Promise<void>
  markPublic: (sig: string, kind?: string, closure?: boolean, page?: readonly string[]) => Promise<void>
  isClosureAvailable: (sig: string, kind?: string, closure?: boolean) => Promise<boolean>
  closureGaps: (sig: string, kind?: string, closure?: boolean, limit?: number) => Promise<string[]>
  ensureSwarmTarget: () => string
  isGateActive: () => boolean
  swarmHosts: () => string[]
  swarmHostsFor: (segments: readonly string[] | null) => { hosts: readonly string[]; source: string; pending: boolean }
}
let HostSync: new (resolver?: unknown) => Service
let Resolver: new (deps: unknown) => { warm: (s: readonly string[] | null) => void }

const sign = async (bytes: Uint8Array): Promise<string> => await SignatureService.sign(bytes.slice().buffer as ArrayBuffer)
const poolName = async (meaning: string): Promise<string> => await sign(new TextEncoder().encode(meaning))
const hostHash = async (domain: string): Promise<string> => (await sign(new TextEncoder().encode(domain))).slice(0, 16)

let root: MemoryDir
const resources = new Map<string, Uint8Array>()
const layers = new Map<string, Uint8Array>()
let swarmHost = 'jwize.com'
let signedAt: number[] = []

// ── where the bytes go: the world the resolver reads ───────────────────────
// Defaults: no publish marks, and the host field (`swarmHost`, the meeting
// point the participant entered) is the swarm's host. The card's policy is
// handed over only to show that nothing reads it.
let marks = new Map<string, string[]>()
let participants: unknown = 'all'
let originLoopback = false
const deps = {
  readMarks: async (segments: readonly string[]) => marks.get(segments.join('/')) ?? [],
  relay: () => ({ host: swarmHost, participants }),
  originLoopback: () => originLoopback,
}

/** A service whose resolver has read the world (the root's answer, and any
 *  pages named) — what a tab has a moment after boot. */
const make = async (...pages: string[][]): Promise<Service> => {
  const resolver = new Resolver(deps)
  resolver.warm(null)
  for (const page of pages) resolver.warm(page)
  await settle(10)
  return new HostSync(resolver)
}

beforeAll(async () => {
  registry.set('@diamondcoreprocessor.com/NostrSigner', {
    signEvent: async (event: Record<string, unknown>) => {
      signedAt.push(Number(event['created_at']))
      return { ...event, id: 'e', pubkey: 'p'.repeat(64), sig: 's' }
    },
    getPublicKeyHex: async () => 'p'.repeat(64),
  })
  const mod = await import('./host-sync.service.js')
  HostSync = mod.HostSyncService as unknown as new (resolver?: unknown) => Service
  Resolver = (await import('./swarm-hosts.js')).SwarmHostResolver as unknown as typeof Resolver
})

const join = (joined: boolean): void => { EffectBus.emit('mesh:public-changed', { public: joined }) }

beforeEach(() => {
  vi.spyOn(crypto.subtle, 'digest').mockImplementation(digestNow)
  root = new MemoryDir('')
  resources.clear()
  layers.clear()
  signedAt = []
  swarmHost = 'jwize.com'
  marks = new Map()
  participants = 'all'
  originLoopback = false
  registry.set('@hypercomb.social/Store', {
    opfsRoot: root,
    getResourceLocal: async (s: string) => { const b = resources.get(s); return b ? { arrayBuffer: async () => b.slice().buffer } : null },
    getLayerPoolBytes: async (s: string) => layers.get(s)?.slice() ?? null,
  })
  registry.set(MESH_KEY, { swarmHost: () => swarmHost })
  // A participant on hypercomb.io: the runtime seeds the self-domain to the
  // page origin and nothing else — no public host, no backup opt-in.
  localStorage.clear()
  localStorage.setItem('hc:nostrmesh:self-domain', 'hypercomb.io')
  join(true)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const resource = async (text: string): Promise<string> => {
  const bytes = new TextEncoder().encode(text)
  const s = await sign(bytes)
  resources.set(s, bytes)
  return s
}

const layer = async (record: Record<string, unknown>): Promise<string> => {
  const bytes = new TextEncoder().encode(JSON.stringify(record))
  const s = await sign(bytes)
  layers.set(s, bytes)
  return s
}

const queued = async (): Promise<string[]> => {
  const dir = root.children.get(await poolName('host-push'))
  return dir?.kind === 'directory' ? dir.names().filter(n => !n.endsWith('.public')) : []
}

const receipts = async (): Promise<string[]> => {
  const dir = root.children.get(await poolName('host-receipts'))
  return dir?.kind === 'directory' ? dir.names() : []
}

const writeReceipt = async (name: string): Promise<void> => {
  const dir = await root.getDirectoryHandle(await poolName('host-receipts'), { create: true })
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable()
  await w.write(new Uint8Array(0))
  await w.close()
}

/** Run every chain of awaits out. Nothing here waits on the wall clock (the
 *  digest answers in the same turn, above), so when this returns, only what
 *  a timer holds is still to come. */
const settle = async (turns = 40): Promise<void> => {
  for (let i = 0; i < turns; i++) await new Promise<void>(resolve => setImmediate(resolve))
}

/** Drain until nothing moves: markPublic stages without awaiting, and its
 *  own kick may still be running when a test's drain() returns early.
 *  Real timers only. */
const quiesce = async (service: Service, host?: { fetch: { mock: { calls: unknown[] } } }): Promise<void> => {
  let last = -1
  for (let i = 0; i < 60; i++) {
    await new Promise(resolve => setTimeout(resolve, 5))
    await settle(10)
    await service.drain()
    await settle(10)
    const n = host?.fetch.mock.calls.length ?? 0
    if ((await queued()).length === 0 && n === last) return
    last = n
  }
}

const listen = <T>(effect: string): { seen: T[]; off: () => void } => {
  const seen: T[] = []
  const off = EffectBus.on<T>(effect, payload => { seen.push(payload) })
  seen.length = 0
  return { seen, off }
}

// ── the relay's content heap ───────────────────────────────────────────────

type HostOptions = {
  held?: Map<string, Uint8Array>
  /** Status (and body) for every PUT, or a function of the attempt number. */
  put?: (attempt: number, sig: string) => { status: number; body?: string; headers?: Record<string, string> } | null
  /** Milliseconds each PUT takes, on the test's clock (fake where it fakes one). */
  putDelayMs?: number
}

const makeHost = (options: HostOptions = {}) => {
  const held = options.held ?? new Map<string, Uint8Array>()
  let attempts = 0
  let inFlight = 0
  const stats = { maxInFlight: 0, putAt: [] as number[] }
  const fetch = vi.fn(async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    const sig = url.pathname.slice(1)
    const method = init?.method ?? 'GET'
    if (method === 'PUT') {
      stats.putAt.push(Date.now())
      inFlight++
      stats.maxInFlight = Math.max(stats.maxInFlight, inFlight)
      try {
        if (options.putDelayMs) await new Promise(r => setTimeout(r, options.putDelayMs))
        const forced = options.put?.(++attempts, sig)
        if (forced) return new Response(forced.body ?? null, { status: forced.status, headers: forced.headers })
        if (!String((init?.headers as Record<string, string>)?.['Authorization']).startsWith('Nostr ')) return new Response('missing auth', { status: 401 })
        const body = new Uint8Array(init?.body as ArrayBuffer)
        if (await sign(body) !== sig) return new Response(null, { status: 422 })
        held.set(sig, body)
        // The relay's own answer after it hashed and wrote the body.
        return new Response(`stored ${sig}`, { status: 201 })
      } finally { inFlight-- }
    }
    const bytes = held.get(sig)
    if (method === 'HEAD') return new Response(null, bytes ? { status: 200, headers: { 'content-type': 'application/octet-stream' } } : { status: 404 })
    return bytes ? new Response(bytes.slice(), { status: 200, headers: { 'content-type': 'application/octet-stream' } }) : new Response(null, { status: 404 })
  })
  return { fetch, held, stats }
}

type Host = ReturnType<typeof makeHost>
const calls = (host: Host, method: string): string[] =>
  host.fetch.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === method).map(([url]) => String(url))

// ── the target ─────────────────────────────────────────────────────────────

describe('the swarm host is a derived target', () => {
  it('not joined: no target, no gate, nothing marked or sent — and a joined tab has one at once', async () => {
    join(false)
    const host = makeHost()
    vi.stubGlobal('fetch', host.fetch)
    const service = await make()
    const s = await resource('{"name":"private until joined"}')
    expect(service.ensureSwarmTarget()).toBe('needs-host')
    expect(service.isGateActive()).toBe(false)
    await service.markPublic(s, 'resource')
    await quiesce(service, host)
    expect(host.fetch).not.toHaveBeenCalled()
    expect(await queued()).toEqual([])

    join(true)
    expect(service.ensureSwarmTarget()).toBe('ready')
    expect(service.isGateActive()).toBe(true)
  })

  it('wss://jwize.com is https://jwize.com — the 201 "stored <sig>" is the receipt, with no read-back', async () => {
    swarmHost = 'wss://jwize.com' // tolerated as the mesh's own spelling
    const host = makeHost()
    vi.stubGlobal('fetch', host.fetch)
    const service = await make()
    const s = await resource('{"name":"shared at the meeting"}')
    await service.markPublic(s, 'resource')
    await quiesce(service, host)
    expect(calls(host, 'PUT')).toEqual([`https://jwize.com/${s}`])
    expect(calls(host, 'GET')).toEqual([])
    expect(await receipts()).toEqual([`${s}.${await hostHash('jwize.com')}`])
    expect(await queued()).toEqual([])
    expect(await service.isClosureAvailable(s, 'resource')).toBe(true)
  })

  it('ws://localhost:7793 is http://localhost:7793; a port on a real host the participant entered is kept; none is no target', async () => {
    swarmHost = 'localhost:7793'
    originLoopback = true // the harness page is itself local
    const host = makeHost()
    vi.stubGlobal('fetch', host.fetch)
    const service = await make()
    const s = await resource('{"name":"harness tile"}')
    await service.markPublic(s, 'resource')
    await quiesce(service, host)
    expect(calls(host, 'PUT')).toEqual([`http://localhost:7793/${s}`])

    // A self-hosted machine on :8443 is the host the participant entered.
    originLoopback = false
    swarmHost = 'home.example.net:8443'
    expect(service.ensureSwarmTarget()).toBe('ready')
    expect(service.swarmHosts()).toEqual(['home.example.net:8443'])
    swarmHost = ''
    expect(service.ensureSwarmTarget()).toBe('needs-host')
    registry.delete(MESH_KEY) // no mesh at all — tolerated, no target
    expect(service.ensureSwarmTarget()).toBe('needs-host')
  })

  it('the meeting point\'s "already held <sig>" is a receipt too — no read-back GET', async () => {
    // The worker found the sig in its heap: the same statement about the same
    // sig as `stored <sig>`, made without a second write.
    const host = makeHost({ put: (_n, sig) => { host.held.set(sig, resources.get(sig)!); return { status: 200, body: `already held ${sig}` } } })
    vi.stubGlobal('fetch', host.fetch)
    const service = await make()
    const s = await resource('{"name":"held already"}')
    await service.markPublic(s, 'resource')
    await quiesce(service, host)
    expect(calls(host, 'PUT')).toEqual([`https://jwize.com/${s}`])
    expect(calls(host, 'GET')).toEqual([])
    expect(await receipts()).toEqual([`${s}.${await hostHash('jwize.com')}`])
    expect(await service.isClosureAvailable(s, 'resource')).toBe(true)
  })

  it('"already held" naming ANOTHER sig is no receipt — it is read back', async () => {
    const host = makeHost({ put: (_n, sig) => { host.held.set(sig, resources.get(sig)!); return { status: 200, body: `already held ${'0'.repeat(64)}` } } })
    vi.stubGlobal('fetch', host.fetch)
    const service = await make()
    const s = await resource('{"name":"another sig"}')
    await service.markPublic(s, 'resource')
    await quiesce(service, host)
    expect(calls(host, 'GET')).toEqual([`https://jwize.com/${s}`])
  })

  it('a 2xx without the relay\'s words is read back, like every other host', async () => {
    const host = makeHost({ put: (_n, sig) => { host.held.set(sig, resources.get(sig)!); return { status: 200, body: 'ok' } } })
    vi.stubGlobal('fetch', host.fetch)
    const service = await make()
    const s = await resource('{"name":"older relay"}')
    await service.markPublic(s, 'resource')
    await quiesce(service, host)
    expect(calls(host, 'GET')).toEqual([`https://jwize.com/${s}`])
    expect(await service.isClosureAvailable(s, 'resource')).toBe(true)
  })

  it('no receipt from the zone\'s retired content face counts for the swarm host', async () => {
    const host = makeHost()
    vi.stubGlobal('fetch', host.fetch)
    const s = await resource('{"name":"on the worker heap only"}')
    await writeReceipt(`${s}.${await hostHash('content.jwize.com')}`)
    const service = await make()
    expect(await service.isClosureAvailable(s, 'resource')).toBe(false)
    await writeReceipt(`${s}.${await hostHash('jwize.com')}`)
    expect(await (await make()).isClosureAvailable(s, 'resource')).toBe(true)
  })

  it('a reload — a fresh service over the same OPFS — still finds the closure available', async () => {
    const host = makeHost()
    vi.stubGlobal('fetch', host.fetch)
    const s = await resource('{"name":"survives a reload"}')
    const before = await make()
    await before.markPublic(s, 'resource')
    await quiesce(before, host)
    expect(await before.isClosureAvailable(s, 'resource')).toBe(true)
    expect(await (await make()).isClosureAvailable(s, 'resource')).toBe(true)
  })

  it('a sealed nested node is staged by the walk alone (no content:wrote) and the branch becomes available', async () => {
    const host = makeHost()
    vi.stubGlobal('fetch', host.fetch)
    const service = await make()
    const leaf = await layer({ name: 'deep' })
    const sealed = await layer({ name: 'branch-b1', children: [leaf] })
    const branch = await layer({ name: 'branch', children: [sealed] })
    expect(await service.isClosureAvailable(branch, 'layer', true)).toBe(false)
    await service.markPublic(branch, 'layer', true)
    await quiesce(service, host)
    expect(calls(host, 'PUT').sort()).toEqual([leaf, sealed, branch].map(s => `https://jwize.com/${s}`).sort())
    expect(await service.isClosureAvailable(branch, 'layer', true)).toBe(true)
  })
})

describe('only public sigs are staged in a joined tab', () => {
  it('a private write is not walked or queued; a marked one goes to the swarm host', async () => {
    const host = makeHost()
    vi.stubGlobal('fetch', host.fetch)
    const service = await make()
    const missing = listen<{ sig: string }>('share:missing-local')
    const privateSig = await resource('{"name":"my private note"}')
    EffectBus.emit('content:wrote', { sig: privateSig, kind: 'resource', bytes: resources.get(privateSig)!.slice().buffer })
    // A private LAYER whose ref is held nowhere: walking it would record a hole.
    const privateLayer = await layer({ name: 'private branch', children: ['c'.repeat(64)] })
    EffectBus.emit('content:wrote', { sig: privateLayer, kind: 'layer', bytes: layers.get(privateLayer)!.slice().buffer })
    await settle()
    expect(missing.seen).toEqual([])
    missing.off()
    expect(await queued()).toEqual([])
    expect(calls(host, 'PUT')).toEqual([])

    const publicSig = await resource('{"name":"made public"}')
    await service.markPublic(publicSig, 'resource')
    await quiesce(service, host)
    EffectBus.emit('content:wrote', { sig: publicSig, kind: 'resource', bytes: resources.get(publicSig)!.slice().buffer })
    await settle()
    expect(calls(host, 'PUT')).toContain(`https://jwize.com/${publicSig}`)
    expect(calls(host, 'PUT')).not.toContain(`https://jwize.com/${privateSig}`)
  })
})

describe('the drain is fast and honest', () => {
  // Fake time for the whole block: the 30 s sweep, every retry timer, each
  // PUT's delay and the clock the backoff reads. Nothing moves unless a test
  // moves it, so every wait is measured exactly as the service scheduled it,
  // never against a wall clock that a loaded machine stretches.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  })

  it('uploads four at a time', async () => {
    const host = makeHost({ putDelayMs: 15 })
    vi.stubGlobal('fetch', host.fetch)
    const service = await make()
    const sigs: string[] = []
    for (let i = 0; i < 10; i++) sigs.push(await resource(`{"name":"tile ${i}"}`))
    for (const s of sigs) await service.markPublic(s, 'resource')
    await service.drain()
    await settle()
    await vi.advanceTimersByTimeAsync(1_000) // each PUT holds its slot for 15 ms
    expect(host.stats.maxInFlight).toBe(4)
    expect(calls(host, 'PUT')).toHaveLength(10)
    expect(await queued()).toEqual([])
  })

  it('a 500 is retried at about 2 s, then about 4 s, and says why', async () => {
    const host = makeHost({ put: () => ({ status: 500, body: 'boom\nstack' }) })
    vi.stubGlobal('fetch', host.fetch)
    const state = listen<{ host: string; status: string; state: string; reason: string }>('sync:state')
    const service = await make()
    const s = await resource('{"name":"host is sick"}')
    await service.markPublic(s, 'resource')
    await service.drain()
    await settle()
    expect(host.stats.putAt).toHaveLength(1)
    // The ladder's first two rungs, each plus up to a quarter of jitter:
    // nothing else is asked of the host in between.
    await vi.advanceTimersByTimeAsync(2_500 + 5_000)
    expect(host.stats.putAt).toHaveLength(3)
    const [first, second, third] = host.stats.putAt
    expect(second - first).toBeGreaterThanOrEqual(2_000)
    expect(second - first).toBeLessThanOrEqual(2_500)
    expect(third - second).toBeGreaterThanOrEqual(4_000)
    expect(third - second).toBeLessThanOrEqual(5_000)
    expect(state.seen.find(p => p.host === 'jwize.com' && p.status === 'unreachable')).toMatchObject({ state: 'unreachable', reason: '500 boom' })
    state.off()
  })

  it('not-live is retried every second until the relay has seen the key, then shares', async () => {
    const host = makeHost({ put: n => n <= 2 ? { status: 401, body: 'not-live: send an event first' } : null })
    vi.stubGlobal('fetch', host.fetch)
    const state = listen<{ host: string; status: string }>('sync:state')
    const service = await make()
    const s = await resource('{"name":"put before the beacon"}')
    await service.markPublic(s, 'resource')
    await service.drain()
    await settle()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(host.stats.putAt).toHaveLength(3)
    const [first, second, third] = host.stats.putAt
    expect(second - first).toBe(1_000)
    expect(third - second).toBe(1_000)
    expect(await queued()).toEqual([])
    expect(await service.isClosureAvailable(s, 'resource')).toBe(true)
    const words = state.seen.filter(p => p.host === 'jwize.com').map(p => p.status)
    expect(words).toContain('not-live')
    expect(words[words.length - 1]).toBe('backed-up')
    state.off()
  })

  it('429 waits out the host (at most one PUT per entry in 5 min); 413 drops the entry for that host', async () => {
    const full = makeHost({ put: () => ({ status: 429, body: 'quota: 256 MB per key per day', headers: { 'retry-after': '60' } }) })
    vi.stubGlobal('fetch', full.fetch)
    const state = listen<{ host: string; status: string; reason: string }>('sync:state')
    const service = await make()
    const sigs: string[] = []
    for (let i = 0; i < 5; i++) sigs.push(await resource(`{"name":"over quota ${i}"}`))
    for (const s of sigs) await service.markPublic(s, 'resource')
    await service.drain()
    await settle()
    await vi.advanceTimersByTimeAsync(5 * 60_000) // ten 30 s sweeps, all inside a full host's wait
    const perEntry = new Map<string, number>()
    for (const url of calls(full, 'PUT')) perEntry.set(url, (perEntry.get(url) ?? 0) + 1)
    expect(Math.max(...perEntry.values())).toBeLessThanOrEqual(1)
    expect(state.seen.find(p => p.status === 'full')).toMatchObject({ reason: '429 quota: 256 MB per key per day' })
    expect(await queued()).toHaveLength(5) // still owed — the host named its wait

    root = new MemoryDir('')
    registry.set('@hypercomb.social/Store', { opfsRoot: root, getResourceLocal: async (s: string) => { const b = resources.get(s); return b ? { arrayBuffer: async () => b.slice().buffer } : null } })
    const large = makeHost({ put: () => ({ status: 413, body: 'too large: 8 MB per file' }) })
    vi.stubGlobal('fetch', large.fetch)
    const fresh = await make()
    const big = await resource('{"name":"a very large picture"}')
    await fresh.markPublic(big, 'resource')
    await fresh.drain()
    await settle()
    expect(calls(large, 'PUT')).toEqual([`https://jwize.com/${big}`])
    expect(await queued()).toEqual([])
    expect(await fresh.isClosureAvailable(big, 'resource')).toBe(false)
    expect(state.seen.filter(p => p.host === 'jwize.com').pop()).toMatchObject({ status: 'too-large', reason: '413 too large: 8 MB per file' })
    state.off()
  })

  it('NIP-98 created_at is the relay-corrected time when the mesh has it', async () => {
    const host = makeHost()
    vi.stubGlobal('fetch', host.fetch)
    const relayNow = Date.now() + 120_000 // this device runs two minutes slow
    registry.set(MESH_KEY, { swarmHost: () => swarmHost, now: () => relayNow })
    const service = await make()
    const s = await resource('{"name":"slow clock"}')
    await service.markPublic(s, 'resource')
    await service.drain()
    await settle()
    expect(signedAt).toEqual([Math.floor(relayNow / 1000)])
  })
})

describe('refs this tab does not hold', () => {
  it('one HEAD to the swarm host vouches for an unheld ref, and the receipt keeps vouching after a reload', async () => {
    const adopted = 'a'.repeat(64) // lazily-loaded content: never held here
    const host = makeHost({ held: new Map([[adopted, new Uint8Array([1])]]) })
    vi.stubGlobal('fetch', host.fetch)
    const branch = await layer({ name: 'adopted-branch', children: [adopted] })
    await writeReceipt(`${branch}.${await hostHash('jwize.com')}`)
    const service = await make()
    expect(await service.isClosureAvailable(branch, 'layer', true)).toBe(true)
    expect(calls(host, 'HEAD')).toEqual([`https://jwize.com/${adopted}`])
    expect(await receipts()).toContain(`${adopted}.${await hostHash('jwize.com')}`)
    expect(await service.closureGaps(branch, 'layer', true)).toEqual([])

    host.fetch.mockClear()
    expect(await (await make()).isClosureAvailable(branch, 'layer', true)).toBe(true)
    expect(host.fetch).not.toHaveBeenCalled()
  })

  it('an unheld ref the host lacks is a hole: unavailable, share:missing-local, and asked once', async () => {
    const lost = 'b'.repeat(64)
    const host = makeHost()
    vi.stubGlobal('fetch', host.fetch)
    const missing = listen<{ sig: string }>('share:missing-local')
    const state = listen<{ host: string; missing: number }>('sync:state')
    const branch = await layer({ name: 'holey-branch', children: [lost] })
    await writeReceipt(`${branch}.${await hostHash('jwize.com')}`)
    const service = await make()
    expect(await service.isClosureAvailable(branch, 'layer', true)).toBe(false)
    expect(missing.seen).toEqual([{ sig: lost }])
    expect(state.seen.pop()).toMatchObject({ host: 'jwize.com', missing: 1 })
    await service.closureGaps(branch, 'layer', true)
    expect(calls(host, 'HEAD')).toEqual([`https://jwize.com/${lost}`])
    missing.off()
    state.off()
  })
})

describe('reads try the advertised hosts first, then this tab\'s swarm hosts', () => {
  const HOST_SYNC_KEY = '@diamondcoreprocessor.com/HostSyncService'
  const octets = (bytes: Uint8Array): Response => new Response(bytes.slice(), { status: 200, headers: { 'content-type': 'application/octet-stream' } })
  const page = (): Response => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } })

  it('a sig\'s advertised host is asked first; the relay is never a read candidate of its own', async () => {
    registry.set('@hypercomb.social/Store', { getResourceLocal: async () => null, putResource: async () => '' })
    registry.set(HOST_SYNC_KEY, { swarmHosts: () => ['hypercomb.com'] })
    const { ContentBrokerDrone } = await import('./content-broker.boot.drone.js')
    const bytes = new TextEncoder().encode('export const peer = 1')
    const s = await sign(bytes)
    // The origin seeds itself as the self-domain (hypercomb.io does); it is
    // the shell, and answers every /<sig> with the app page.
    localStorage.setItem('hc:nostrmesh:self-domain', location.host)
    const fetch = vi.fn(async (url: string) =>
      url.startsWith('https://peer-host.example/') || url.startsWith('https://hypercomb.com/') ? octets(bytes) : page())
    vi.stubGlobal('fetch', fetch)
    const broker = new ContentBrokerDrone()
    // The peer's layer event said where its bytes went.
    broker.noteDomainsForSig(s, ['peer-host.example'])
    expect(Array.from((await broker.fetchBySig(s, 'resource'))!)).toEqual(Array.from(bytes))
    expect(String(fetch.mock.calls[0]?.[0])).toBe(`https://peer-host.example/${s}`)
    expect(fetch.mock.calls.some(([url]) => String(url).includes('jwize.com'))).toBe(false)
    expect(fetch.mock.calls.some(([url]) => String(url).includes(location.host))).toBe(false)
    registry.delete(HOST_SYNC_KEY)
  })

  it('a sig advertised on its page\'s host is asked THERE alone — never also of this reader\'s own pool host', async () => {
    registry.set('@hypercomb.social/Store', { getResourceLocal: async () => null, putResource: async () => '' })
    registry.set(HOST_SYNC_KEY, { swarmHosts: () => ['hypercomb.com'] })
    const { ContentBrokerDrone } = await import('./content-broker.boot.drone.js')
    const bytes = new TextEncoder().encode('export const onlyOnTheShopHost = 1')
    const s = await sign(bytes)
    localStorage.setItem('hc:nostrmesh:self-domain', location.host)
    const fetch = vi.fn(async (url: string) => url.startsWith('https://pointblank.example/') ? octets(bytes) : page())
    vi.stubGlobal('fetch', fetch)
    const broker = new ContentBrokerDrone()
    broker.noteDomainsForSig(s, ['pointblank.example'])
    expect(Array.from((await broker.fetchBySig(s, 'resource'))!)).toEqual(Array.from(bytes))
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([`https://pointblank.example/${s}`])
    registry.delete(HOST_SYNC_KEY)
  })

  it('an advertised host that misses hands over to the rest — the reader still finds the bytes', async () => {
    registry.set('@hypercomb.social/Store', { getResourceLocal: async () => null, putResource: async () => '' })
    registry.set(HOST_SYNC_KEY, { swarmHosts: () => ['hypercomb.com'] })
    const { ContentBrokerDrone } = await import('./content-broker.boot.drone.js')
    const bytes = new TextEncoder().encode('export const movedHosts = 1')
    const s = await sign(bytes)
    localStorage.setItem('hc:nostrmesh:self-domain', location.host)
    const fetch = vi.fn(async (url: string) =>
      url.startsWith('https://hypercomb.com/') ? octets(bytes) : new Response(null, { status: 404 }))
    vi.stubGlobal('fetch', fetch)
    const broker = new ContentBrokerDrone()
    broker.noteDomainsForSig(s, ['gone.example'])
    expect(Array.from((await broker.fetchBySig(s, 'resource'))!)).toEqual(Array.from(bytes))
    const urls = fetch.mock.calls.map(([url]) => String(url))
    expect(urls[0]).toBe(`https://gone.example/${s}`)
    expect(urls.indexOf(`https://hypercomb.com/${s}`)).toBeGreaterThan(0)
    registry.delete(HOST_SYNC_KEY)
  })

  it('an unattributed sig: this tab\'s swarm host first, and still never the relay', async () => {
    registry.set('@hypercomb.social/Store', { getResourceLocal: async () => null, putResource: async () => '' })
    registry.set(HOST_SYNC_KEY, { swarmHosts: () => ['hypercomb.com'] })
    const { ContentBrokerDrone } = await import('./content-broker.boot.drone.js')
    const bytes = new TextEncoder().encode('export const unattributed = 1')
    const s = await sign(bytes)
    localStorage.setItem('hc:nostrmesh:self-domain', location.host)
    const fetch = vi.fn(async (url: string) => url.startsWith('https://hypercomb.com/') ? octets(bytes) : page())
    vi.stubGlobal('fetch', fetch)
    const broker = new ContentBrokerDrone()
    expect(Array.from((await broker.fetchBySig(s, 'resource'))!)).toEqual(Array.from(bytes))
    expect(String(fetch.mock.calls[0]?.[0])).toBe(`https://hypercomb.com/${s}`)
    expect(fetch.mock.calls.some(([url]) => String(url).includes('jwize.com'))).toBe(false)
    registry.delete(HOST_SYNC_KEY)
  })
})

describe('the room is owed only what it is offered now', () => {
  it('a tile made private while its upload waits never reaches the swarm host; offered again, it goes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    const host = makeHost({ put: n => n <= 1 ? { status: 500, body: 'busy' } : null })
    vi.stubGlobal('fetch', host.fetch)
    const service = (await make()) as Service & { withdrawPublic: (sig: string) => void }
    const pic = await resource('{"name":"a photo, then private"}')
    const tile = await layer({ name: 'photo', images: [pic] })
    await service.markPublic(tile, 'layer', false)
    await service.drain()
    await settle()
    // The first upload to a host goes alone; its refusal pauses the host, so
    // the other is not sent into it — both wait out the backoff.
    expect(calls(host, 'PUT')).toHaveLength(1)

    service.withdrawPublic(tile)                  // the walk pruned it as private
    for (let step = 0; step < 100; step++) { await vi.advanceTimersByTimeAsync(100); await settle() }
    expect(calls(host, 'PUT')).toHaveLength(1)    // nothing more went to the room's host
    expect((await queued()).sort()).toEqual([`${pic}.resource`, `${tile}.layer`].sort())

    await service.markPublic(tile, 'layer', false) // public again: the next walk names it
    await service.drain()
    await settle()
    expect(calls(host, 'PUT').slice(1).sort()).toEqual([pic, tile].map(s => `https://jwize.com/${s}`).sort())
  })

  it('a leave ends the offer: rejoined, nothing goes until the walk names it again', async () => {
    const host = makeHost({ putDelayMs: 1 })
    vi.stubGlobal('fetch', host.fetch)
    const service = await make()
    const s = await resource('{"name":"offered in the last room"}')
    join(false)
    // marked during the last join and still queued (simulated: marked while
    // joined, the drain never ran)
    join(true)
    await service.markPublic(s, 'resource')
    join(false)
    join(true)
    await service.drain()
    await settle()
    expect(calls(host, 'PUT')).toEqual([])
    await service.markPublic(s, 'resource')
    await quiesce(service, host)
    expect(calls(host, 'PUT')).toEqual([`https://jwize.com/${s}`])
  })

  it('the swarm host\'s receipt is announced at once, while another host still owes the entry', async () => {
    // A public host the participant NAMED — there is no default (2026-10-11).
    localStorage.setItem('hc:public-host', '1')
    localStorage.setItem('hc:public-host:domain', 'cdn.example')
    const host = makeHost()
    const fetch = vi.fn(async (input: string, init?: RequestInit) =>
      new URL(String(input)).host === 'cdn.example' && init?.method === 'PUT'
        ? new Response('not on the writers list', { status: 401 })
        : host.fetch(input, init))
    vi.stubGlobal('fetch', fetch)
    const receipted = listen<{ sig: string; host?: string; swarm?: boolean }>('host:receipt')
    const service = await make()
    const s = await resource('{"name":"shared while the CDN refuses"}')
    await service.markPublic(s, 'resource')
    await service.drain()
    await settle()
    expect(receipted.seen).toContainEqual({ sig: s, host: 'jwize.com', swarm: true })
    expect(receipted.seen.some(r => r.swarm !== true)).toBe(false)   // the entry has not settled
    expect(await queued()).toEqual([`${s}.resource`])
    receipted.off()
  })

  it('a public host turned on with NO host named takes nothing — no default host stands in (2026-10-11)', async () => {
    localStorage.setItem('hc:public-host', '1')
    const host = makeHost()
    vi.stubGlobal('fetch', host.fetch)
    const service = await make()
    const s = await resource('{"name":"shared with the gate on and no host named"}')
    await service.markPublic(s, 'resource')
    await service.drain()
    await settle()
    // The room's host took it; nothing was sent anywhere else.
    expect(calls(host, 'PUT')).toHaveLength(1)
    expect(host.fetch.mock.calls.every(([url]) => new URL(String(url)).host === 'jwize.com')).toBe(true)
    expect(await queued()).toEqual([])
  })

  it('only a socket that came back ends a path failure\'s pause — a late probe answer does not', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    // The host is deploying (503): the PATH may be the trouble, not the host.
    const host = makeHost({ put: (n) => (n === 1 ? { status: 503, body: 'deploying' } : null) })
    vi.stubGlobal('fetch', host.fetch)
    const service = await make()
    EffectBus.emit('mesh:connection', { state: 'open', reopened: false })
    const s = await resource('{"name":"a host on its way back"}')
    await service.markPublic(s, 'resource')
    await service.drain()
    await settle()
    expect(calls(host, 'PUT')).toHaveLength(1)   // paused on the ladder

    EffectBus.emit('mesh:connection', { state: 'stalled', reopened: false })
    EffectBus.emit('mesh:connection', { state: 'open', reopened: false })
    await vi.advanceTimersByTimeAsync(1_000)
    await settle()
    expect(calls(host, 'PUT')).toHaveLength(1)

    EffectBus.emit('mesh:connection', { state: 'open', reopened: true })
    await vi.advanceTimersByTimeAsync(100)
    await settle()
    expect(calls(host, 'PUT')).toHaveLength(2)
  })

  it('a host field that REFUSES this key keeps its 10 min pause through a socket that came back, and nothing new is copied for it (decision c: its tiles are live meanwhile)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    const host = makeHost({ put: () => ({ status: 403, body: 'this host keeps bytes for its own people only' }) })
    vi.stubGlobal('fetch', host.fetch)
    const service = await make()
    EffectBus.emit('mesh:connection', { state: 'open', reopened: false })
    const s = await resource('{"name":"shared with a host that says no"}')
    await service.markPublic(s, 'resource')
    await service.drain()
    await settle()
    expect(calls(host, 'PUT')).toHaveLength(1)   // refused: paused 10 min
    // No door after it: the host field keeps the page, with its why — and
    // the room's tiles go live meanwhile.
    expect(service.swarmHostsFor(null)).toEqual({ hosts: ['jwize.com'], source: 'meeting', pending: false })

    // A phone's socket drops and comes back, again and again: no refused
    // upload rides any of those returns.
    for (let i = 0; i < 3; i++) {
      EffectBus.emit('mesh:connection', { state: 'closed', reopened: false })
      EffectBus.emit('mesh:connection', { state: 'open', reopened: true })
      await vi.advanceTimersByTimeAsync(100)
      await settle()
    }
    expect(calls(host, 'PUT')).toHaveLength(1)

    // A tile shared now is not copied into the push pool for a host that
    // will not take it — its marker is kept, so a yes later stages it.
    const later = await resource('{"name":"shared after the refusal"}')
    await service.markPublic(later, 'resource')
    await settle()
    expect(await queued()).toEqual([`${s}.resource`])

    // The pause ends on its own clock: what is queued asks again, once.
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 1_000)
    await settle()
    expect(calls(host, 'PUT')).toHaveLength(2)
  })

  it('the gate asks whether an unreceipted picture is held without reading it', async () => {
    const host = makeHost()
    vi.stubGlobal('fetch', host.fetch)
    const bytes = new TextEncoder().encode('{"name":"a large picture"}')
    const pic = await sign(bytes)
    const read = vi.fn(async () => bytes.slice().buffer)
    registry.set('@hypercomb.social/Store', {
      opfsRoot: root,
      getResourceLocal: async (s: string) => (s === pic ? { arrayBuffer: read } : null),
      getLayerPoolBytes: async (s: string) => layers.get(s)?.slice() ?? null,
    })
    const tile = await layer({ name: 'picture tile', images: [pic] })
    await writeReceipt(`${tile}.${await hostHash('jwize.com')}`)
    const service = await make()
    expect(await service.isClosureAvailable(tile, 'layer', false)).toBe(false)
    expect(read).not.toHaveBeenCalled()
    expect(calls(host, 'HEAD')).toEqual([])      // held here: the drain owes it, the host is not asked
  })
})

describe('the publish gate asks the nodes it publishes to', () => {
  it('the meeting host\'s receipt makes a closure available — but not ON the publish node', async () => {
    const host = makeHost()
    vi.stubGlobal('fetch', host.fetch)
    const service = (await make()) as Service & {
      addPublishNodes: (d: readonly string[]) => void
      isClosureAvailableOn: (sig: string, kind: string, closure: boolean, domains: readonly string[]) => Promise<boolean>
    }
    service.addPublishNodes(['pluginthematrix.com'])
    const s = await resource('{"name":"published branch body"}')
    await writeReceipt(`${s}.${await hostHash('jwize.com')}`)
    expect(await service.isClosureAvailable(s, 'resource')).toBe(true)
    expect(await service.isClosureAvailableOn(s, 'resource', true, ['pluginthematrix.com'])).toBe(false)
    expect(await service.isClosureAvailableOn(s, 'resource', true, ['jwize.com'])).toBe(true)
    expect(await service.isClosureAvailableOn(s, 'resource', true, ['not-a-target.example'])).toBe(false)
  })
})

// ── which host (jwize 2026-10-07) ──────────────────────────────────────────

/** Several hosts behind one fetch, each with its own heap and calls. */
const router = (byHost: Record<string, Host>) => vi.fn(async (input: string, init?: RequestInit): Promise<Response> => {
  const host = byHost[new URL(String(input)).host]
  return host ? host.fetch(input, init) : new Response('no such host', { status: 404 })
})

/** A Blossom worker's answer to a PUT: 200 and a descriptor, never the
 *  relay's `stored <sig>` — so the drain reads it back. */
const blossom = (held: Map<string, Uint8Array> = new Map()) => {
  const host = makeHost({
    held,
    put: (_n, sig) => { held.set(sig, resources.get(sig) ?? layers.get(sig)!); return { status: 200, body: JSON.stringify({ sha256: sig }) } },
  })
  return host
}

describe('which host: publish domains, then the host field, then none (jwize 2026-10-11)', () => {
  it('no host field: no target — nothing is sent, whatever the pool holds', async () => {
    swarmHost = ''
    const apex = blossom()
    vi.stubGlobal('fetch', router({ 'hypercomb.com': apex }))
    const service = await make(['meetup'])
    expect(service.swarmHosts()).toEqual([])
    expect(service.swarmHostsFor(null)).toEqual({ hosts: [], source: 'none', pending: false })
    expect(service.swarmHostsFor(['meetup'])).toEqual({ hosts: [], source: 'none', pending: false })
    expect(service.ensureSwarmTarget()).toBe('needs-host')
    const s = await resource('{"name":"a newcomer\'s first tile"}')
    await service.markPublic(s, 'resource', true, ['meetup'])
    await quiesce(service, apex)
    // No default host: hypercomb.com is never asked to keep anyone's bytes.
    expect(apex.fetch).not.toHaveBeenCalled()
  })

  // THE LIVE SWARM (jwize 2026-10-11): with no host the tiles go out from
  // this device; nothing is copied into the push pool to sit there for good.
  it('no host: nothing is queued — and a host field entered later is staged from the local bytes', async () => {
    swarmHost = ''
    const friend = makeHost()
    vi.stubGlobal('fetch', router({ 'friend.example': friend }))
    const service = await make(['meetup'])
    const pic = await resource('{"name":"a picture shared live"}')
    const tile = await layer({ name: 'tile', images: [pic] })
    await service.markPublic(tile, 'layer', false, ['meetup'])
    await quiesce(service, friend)
    expect(await queued()).toEqual([])
    expect(friend.fetch).not.toHaveBeenCalled()

    // The participant enters a host: the room's tiles are owed to it now —
    // read again from this device, no queue copy needed.
    swarmHost = 'friend.example'
    EffectBus.emit('mesh:zone', { relay: 'wss://friend.example' })
    await settle()
    expect(service.swarmHosts()).toEqual(['friend.example'])
    await quiesce(service, friend)
    expect(calls(friend, 'PUT').sort()).toEqual([`https://friend.example/${tile}`, `https://friend.example/${pic}`].sort())
    expect(await queued()).toEqual([])
  })

  it('the host field is the upload host — whatever the meeting point\'s card says — with the host\'s own receipt', async () => {
    swarmHost = 'friend.example'
    participants = false // the card says the point hosts nobody: it decides nothing
    const friend = makeHost()
    const apex = blossom()
    vi.stubGlobal('fetch', router({ 'friend.example': friend, 'hypercomb.com': apex }))
    const service = await make()
    expect(service.swarmHostsFor(null)).toEqual({ hosts: ['friend.example'], source: 'meeting', pending: false })
    expect(service.swarmHosts()).toEqual(['friend.example'])
    expect(service.ensureSwarmTarget()).toBe('ready')
    const s = await resource('{"name":"shared at the friend\'s host"}')
    await service.markPublic(s, 'resource')
    await quiesce(service, friend)
    expect(calls(friend, 'PUT')).toEqual([`https://friend.example/${s}`])
    expect(calls(friend, 'GET')).toEqual([]) // `stored <sig>` is the receipt
    expect(apex.fetch).not.toHaveBeenCalled()
    expect(await service.isClosureAvailable(s, 'resource')).toBe(true)
  })

  it('a hosts pool change (hosts:render) moves nothing', async () => {
    const friend = makeHost()
    vi.stubGlobal('fetch', router({ 'jwize.com': friend }))
    const service = await make()
    EffectBus.emit('hosts:render', { open: false, zones: ['alpha.example', 'hypercomb.com'], loaded: true })
    await settle()
    expect(service.swarmHosts()).toEqual(['jwize.com'])
    expect(service.swarmHostsFor(null)).toEqual({ hosts: ['jwize.com'], source: 'meeting', pending: false })
  })

  it('publish domains override the host field for a page that wears them — each page\'s tiles go to its own host', async () => {
    marks = new Map([['shop', ['pointblank.example']]])
    const field = makeHost()
    const shopHost = makeHost()
    const apex = blossom()
    vi.stubGlobal('fetch', router({ 'jwize.com': field, 'pointblank.example': shopHost, 'hypercomb.com': apex }))
    const service = await make(['shop'], ['shop', 'shelf'], ['meetup'])
    expect(service.swarmHostsFor(['shop', 'shelf'])).toEqual({ hosts: ['pointblank.example'], source: 'publish', pending: false })
    expect(service.swarmHostsFor(['meetup'])).toEqual({ hosts: ['jwize.com'], source: 'meeting', pending: false })
    const jar = await resource('{"name":"a jar on the shop shelf"}')
    const flyer = await resource('{"name":"a flyer at the meetup"}')
    await service.markPublic(jar, 'resource', true, ['shop', 'shelf'])
    await service.markPublic(flyer, 'resource', true, ['meetup'])
    await quiesce(service, shopHost)
    await quiesce(service, field)
    expect(calls(shopHost, 'PUT')).toEqual([`https://pointblank.example/${jar}`])
    expect(calls(field, 'PUT')).toEqual([`https://jwize.com/${flyer}`])
    expect(apex.fetch).not.toHaveBeenCalled()
    expect(service.swarmHosts().sort()).toEqual(['jwize.com', 'pointblank.example'])
    // The share gate asks the page's own host.
    const on = service as Service & { isClosureAvailableOn: (sig: string, kind: string, closure: boolean, d: readonly string[]) => Promise<boolean> }
    expect(await on.isClosureAvailableOn(jar, 'resource', true, ['pointblank.example'])).toBe(true)
    expect(await on.isClosureAvailableOn(jar, 'resource', true, ['jwize.com'])).toBe(false)
  })

  it('a publish domain honours receipts earned on its zone\'s retired content face', async () => {
    marks = new Map([['shop', ['pointblank.example']]])
    const shopHost = blossom()
    vi.stubGlobal('fetch', router({ 'pointblank.example': shopHost, 'jwize.com': makeHost() }))
    const s = await resource('{"name":"pushed to the content face long ago"}')
    await writeReceipt(`${s}.${await hostHash('content.pointblank.example')}`)
    const service = (await make(['shop'])) as Service & { isClosureAvailableOn: (sig: string, kind: string, closure: boolean, d: readonly string[]) => Promise<boolean> }
    await service.markPublic(s, 'resource', true, ['shop'])
    await quiesce(service, shopHost)
    expect(calls(shopHost, 'PUT')).toEqual([])
    expect(await service.isClosureAvailableOn(s, 'resource', true, ['pointblank.example'])).toBe(true)
  })

  it('a host field that changes moves the uploads with it — no reload — and what was already shared follows', async () => {
    swarmHost = 'friend.example'
    const friend = makeHost()
    const alpha = makeHost()
    vi.stubGlobal('fetch', router({ 'friend.example': friend, 'alpha.example': alpha }))
    const service = await make()
    const first = await resource('{"name":"before the point moved"}')
    await service.markPublic(first, 'resource')
    await quiesce(service, friend)
    expect(calls(friend, 'PUT')).toEqual([`https://friend.example/${first}`])
    expect(await queued()).toEqual([]) // its entry is retired

    // The participant enters another meeting point (a link, the selector).
    swarmHost = 'alpha.example'
    EffectBus.emit('mesh:zone', { relay: 'wss://alpha.example' })
    await settle()
    expect(service.swarmHosts()).toEqual(['alpha.example'])
    const second = await resource('{"name":"after the point moved"}')
    await service.markPublic(second, 'resource')
    await quiesce(service, alpha)
    expect(calls(alpha, 'PUT')).toContain(`https://alpha.example/${second}`)
    expect(calls(friend, 'PUT')).not.toContain(`https://friend.example/${second}`)
    // What the room was already offered reaches the new host too, though
    // its entry left the queue long ago — no tile is stranded by the move.
    expect(calls(alpha, 'PUT')).toContain(`https://alpha.example/${first}`)
    expect(await service.isClosureAvailable(first, 'resource')).toBe(true)
  })

  it('a picture shown on two pages with different hosts reaches both', async () => {
    marks = new Map([['shop', ['pointblank.example']]])
    const field = makeHost()
    const shopHost = makeHost()
    vi.stubGlobal('fetch', router({ 'jwize.com': field, 'pointblank.example': shopHost }))
    const service = await make(['shop'], ['meetup'])
    const pic = await resource('{"name":"one photo, two pages"}')
    const flyer = await layer({ name: 'flyer', images: [pic] })
    const jar = await layer({ name: 'jar', images: [pic] })
    await service.markPublic(flyer, 'layer', false, ['meetup'])
    await quiesce(service, field)
    expect(calls(field, 'PUT').sort()).toEqual([`https://jwize.com/${flyer}`, `https://jwize.com/${pic}`].sort())
    expect(await queued()).toEqual([])

    await service.markPublic(jar, 'layer', false, ['shop'])
    await quiesce(service, shopHost)
    expect(calls(shopHost, 'PUT').sort()).toEqual([`https://pointblank.example/${jar}`, `https://pointblank.example/${pic}`].sort())
    const at = service as Service & { isClosureAvailableAt: (sig: string, kind: string, closure: boolean, page: readonly string[]) => Promise<boolean | null> }
    expect(await at.isClosureAvailableAt(jar, 'layer', false, ['shop'])).toBe(true)
  })

  it('a branch shared at a page keeps its subtree on its OWN publish domains; only its tile goes where the page goes', async () => {
    marks = new Map([['shop', ['pointblank.example']]])
    const field = makeHost()
    const shopHost = makeHost()
    vi.stubGlobal('fetch', router({ 'jwize.com': field, 'pointblank.example': shopHost }))
    const service = await make(['shop'], ['shop', 'jar'])
    const label = await resource('{"name":"the jar\'s label"}')
    const inner = await layer({ name: 'jar', notes: [label] })
    const branch = await layer({ name: 'shop', children: [inner] })
    // The walk at the hive root offers the shop tile with its closure.
    await service.markPublic(branch, 'layer', true, [])
    await quiesce(service, shopHost)
    await quiesce(service, field)
    expect(calls(field, 'PUT')).toEqual([`https://jwize.com/${branch}`])
    expect(calls(shopHost, 'PUT').sort()).toEqual([`https://pointblank.example/${inner}`, `https://pointblank.example/${label}`].sort())
    expect(service.swarmHosts().sort()).toEqual(['jwize.com', 'pointblank.example'])
    const at = service as Service & {
      isClosureAvailableAt: (sig: string, kind: string, closure: boolean, page: readonly string[]) => Promise<boolean | null>
      isClosureAvailableOn: (sig: string, kind: string, closure: boolean, d: readonly string[]) => Promise<boolean>
      closureHostsOf: (sig: string) => string[]
    }
    // The gate judges each part where it is shown, and the root page's
    // event can name where the subtree went.
    expect(await at.isClosureAvailableAt(branch, 'layer', true, [])).toBe(true)
    expect(await at.isClosureAvailableOn(branch, 'layer', true, ['jwize.com'])).toBe(false)
    expect(at.closureHostsOf(branch).sort()).toEqual(['jwize.com', 'pointblank.example'])
  })

  it('a page still being read deep in a closure is unknown to the gate, never "no"', async () => {
    const hang = new Promise<never>(() => undefined)
    const slow = new Resolver({ ...deps, readMarks: (segments: readonly string[]) => segments.length > 1 ? hang : Promise.resolve([]) })
    slow.warm(null)
    slow.warm(['shop'])
    await settle(10)
    vi.stubGlobal('fetch', router({ 'jwize.com': makeHost() }))
    const service = new HostSync(slow) as Service & { isClosureAvailableAt: (sig: string, kind: string, closure: boolean, page: readonly string[]) => Promise<boolean | null> }
    const inner = await layer({ name: 'deep' })
    const mid = await layer({ name: 'jar', children: [inner] })
    const branch = await layer({ name: 'shop', children: [mid] })
    await writeReceipt(`${branch}.${await hostHash('jwize.com')}`)
    await writeReceipt(`${mid}.${await hostHash('jwize.com')}`)
    expect(await service.isClosureAvailableAt(branch, 'layer', true, [])).toBeNull()
  })

  it('a publish while joined is not a room offer: it goes to the nodes the publish names, never the host field', async () => {
    const field = makeHost()
    const node = makeHost()
    vi.stubGlobal('fetch', router({ 'jwize.com': field, 'node.example': node }))
    const service = (await make()) as Service & { addPublishNodes: (d: readonly string[]) => void; markPublic: (sig: string, kind?: string, closure?: boolean, page?: readonly string[] | false) => Promise<void> }
    const sealed = await layer({ name: 'shop' })
    service.addPublishNodes(['node.example'])
    await service.markPublic(sealed, 'layer', true, false)
    await quiesce(service, node)
    expect(calls(node, 'PUT')).toEqual([`https://node.example/${sealed}`])
    expect(calls(field, 'PUT')).toEqual([])
  })

  it('a publish domain that refuses is passed over for the host field: never a strand', async () => {
    marks = new Map([['shop', ['pointblank.example']]])
    const shopHost = makeHost({ put: () => ({ status: 403, body: 'no grant for this key' }) })
    const field = makeHost()
    vi.stubGlobal('fetch', router({ 'pointblank.example': shopHost, 'jwize.com': field }))
    const service = await make(['shop'])
    const s = await resource('{"name":"refused by the shop host"}')
    await service.markPublic(s, 'resource', true, ['shop'])
    await quiesce(service, field)
    await quiesce(service, field)
    expect(calls(shopHost, 'PUT')).toEqual([`https://pointblank.example/${s}`])
    expect(calls(field, 'PUT')).toEqual([`https://jwize.com/${s}`])
    expect(service.swarmHostsFor(['shop'])).toMatchObject({ hosts: ['jwize.com'], source: 'meeting', passedOver: ['pointblank.example'] })
  })

  it('a host field that refuses keeps the page, named with its why — never a pool host or the relay card', async () => {
    const field = makeHost({ put: () => ({ status: 403, body: 'no grant for this key' }) })
    const apex = blossom()
    vi.stubGlobal('fetch', router({ 'jwize.com': field, 'hypercomb.com': apex }))
    const service = (await make()) as Service & { hostTrouble: (host: string) => { why: string } | null }
    const s = await resource('{"name":"the friend\'s host does not list me"}')
    await service.markPublic(s, 'resource')
    await quiesce(service, field)
    expect(calls(field, 'PUT')).toEqual([`https://jwize.com/${s}`])
    expect(service.swarmHostsFor(null)).toEqual({ hosts: ['jwize.com'], source: 'meeting', pending: false })
    expect(service.hostTrouble('jwize.com')).toMatchObject({ why: 'refused' })
    expect(apex.fetch).not.toHaveBeenCalled()
  })

  it('a host field that answers a PAGE where bytes should be is pushed to — its own answer decides', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    // A static apex answers every address with its page; a PUT to it is
    // refused (405). The HEAD alone passes nothing over — the participant
    // entered this host — its PUT's refusal does.
    const pageFetch = vi.fn(async (_input: string, init?: RequestInit): Promise<Response> => {
      if ((init?.method ?? 'GET') === 'PUT') return new Response('Method Not Allowed', { status: 405 })
      return new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } })
    })
    vi.stubGlobal('fetch', pageFetch)
    const service = (await make()) as Service & { hostTrouble: (host: string) => { why: string } | null }
    EffectBus.emit('mesh:connection', { state: 'open' })
    const s = await resource('{"name":"one"}')
    await service.markPublic(s, 'resource')
    for (let step = 0; step < 40 && !pageFetch.mock.calls.some(([, init]) => init?.method === 'PUT'); step++) { await vi.advanceTimersByTimeAsync(250); await settle() }
    expect(pageFetch.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1)
    expect(service.swarmHostsFor(null)).toEqual({ hosts: ['jwize.com'], source: 'meeting', pending: false })
    expect(service.hostTrouble('jwize.com')).toMatchObject({ why: 'page' })
  })

  it('nothing on the join, mark or announce path waits for a branch read — and the root answers at once', async () => {
    const hang = new Promise<never>(() => undefined)
    const stuck = new Resolver({
      readMarks: () => hang,
      relay: () => ({ host: 'jwize.com' }),
      originLoopback: () => false,
    })
    vi.stubGlobal('fetch', router({}))
    const service = new HostSync(stuck)
    const s = await resource('{"name":"offered while a page is unread"}')
    const within = <T>(p: Promise<T>): Promise<T | 'late'> =>
      Promise.race([p, new Promise<'late'>(r => setTimeout(() => r('late'), 1_000))])
    expect(service.swarmHostsFor(['meetup'])).toEqual({ hosts: [], source: 'none', pending: true })
    // The root wears no marks: the host field answers it with no read at all.
    expect(service.swarmHostsFor(null)).toEqual({ hosts: ['jwize.com'], source: 'meeting', pending: false })
    expect(service.ensureSwarmTarget()).toBe('ready')
    expect(await within(service.markPublic(s, 'resource', true, ['meetup']))).toBeUndefined()
    expect(await within(service.isClosureAvailable(s, 'resource'))).toBe(false)
    // Unread is not empty: the host field never stands in for the page meanwhile.
    expect(service.swarmHostsFor(['meetup']).hosts).toEqual([])
  })
})
