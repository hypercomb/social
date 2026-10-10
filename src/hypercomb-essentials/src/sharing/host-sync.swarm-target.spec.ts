// host-sync.swarm-target.spec.ts — THE SWARM'S HOSTS ARE RESOLVED PER PAGE.
//
// A joined tab uploads the tiles it offers on a page to that page's publish
// domains, else its hosts pool's primary, else — only then, and only when its
// card allows participants — the relay it meets at (swarm-hosts.ts). Nothing
// is stored or picked, so a reload finds the same targets and the receipts on
// disk count again. A host's `201 stored <sig>` is the receipt (no read-back),
// uploads go four at a time, and every failure backs off per host with the
// host's own reason.
//
// Most of this file exercises the drain through the LAST resort — an empty
// pool and a relay that allows participants — because its mechanics are the
// same for every swarm host; "which host" has its own block at the end.
//
// The drain reads OPFS through the Store's `opfsRoot`, so the fake root and
// the fake local store are handed over through IoC, as is the mesh stub (for
// its relay clock). Where the bytes go is handed to each service directly, as
// a resolver over a fake world.

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
// Defaults: an EMPTY pool and a relay whose card allows participants — the
// last resort, so the relay is the swarm's host as it used to be by default.
let pool: string[] | null = []
let marks = new Map<string, string[]>()
let participants: unknown = 'all'
let originLoopback = false
/** The host this tab's meeting named (its `hc:mesh-zone`), '' = none. */
let meetingHost = ''
const deps = {
  readPool: async () => pool,
  readMarks: async (segments: readonly string[]) => marks.get(segments.join('/')) ?? [],
  relay: () => ({ host: swarmHost, participants }),
  originLoopback: () => originLoopback,
  meetingHost: () => meetingHost,
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
  root = new MemoryDir('')
  resources.clear()
  layers.clear()
  signedAt = []
  swarmHost = 'jwize.com'
  pool = []
  marks = new Map()
  participants = 'all'
  originLoopback = false
  meetingHost = ''
  // The bus replays its last value to every new resolver: a pool an earlier
  // test announced must not become this test's pool.
  EffectBus.emit('hosts:render', { open: false, zones: [], loaded: false })
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

/** Let real async work (WebCrypto digests) finish between fake-timer steps. */
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
  /** Milliseconds each PUT takes (real time). */
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

  it('ws://localhost:7793 is http://localhost:7793; a port on a real host is no target at all', async () => {
    swarmHost = 'localhost:7793'
    originLoopback = true // the harness page is itself local
    const host = makeHost()
    vi.stubGlobal('fetch', host.fetch)
    const service = await make()
    const s = await resource('{"name":"harness tile"}')
    await service.markPublic(s, 'resource')
    await quiesce(service, host)
    expect(calls(host, 'PUT')).toEqual([`http://localhost:7793/${s}`])

    swarmHost = 'evil.example:8443'
    expect(service.ensureSwarmTarget()).toBe('needs-host')
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
  it('uploads four at a time', async () => {
    const host = makeHost({ putDelayMs: 15 })
    vi.stubGlobal('fetch', host.fetch)
    const service = await make()
    const sigs: string[] = []
    for (let i = 0; i < 10; i++) sigs.push(await resource(`{"name":"tile ${i}"}`))
    for (const s of sigs) await service.markPublic(s, 'resource')
    await quiesce(service, host)
    expect(host.stats.maxInFlight).toBe(4)
    expect(calls(host, 'PUT')).toHaveLength(10)
    expect(await queued()).toEqual([])
  })

  it('a 500 is retried at about 2 s, then about 4 s, and says why', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    const host = makeHost({ put: () => ({ status: 500, body: 'boom\nstack' }) })
    vi.stubGlobal('fetch', host.fetch)
    const state = listen<{ host: string; status: string; state: string; reason: string }>('sync:state')
    const service = await make()
    const s = await resource('{"name":"host is sick"}')
    await service.markPublic(s, 'resource')
    await service.drain()
    await settle()
    expect(host.stats.putAt).toHaveLength(1)
    for (let step = 0; step < 100 && host.stats.putAt.length < 3; step++) {
      await vi.advanceTimersByTimeAsync(100)
      await settle()
    }
    const [first, second, third] = host.stats.putAt
    expect(second - first).toBeGreaterThanOrEqual(1_900)
    expect(second - first).toBeLessThanOrEqual(2_700)
    expect(third - second).toBeGreaterThanOrEqual(3_900)
    expect(third - second).toBeLessThanOrEqual(5_200)
    expect(state.seen.find(p => p.host === 'jwize.com' && p.status === 'unreachable')).toMatchObject({ state: 'unreachable', reason: '500 boom' })
    state.off()
  })

  it('not-live is retried every second until the relay has seen the key, then shares', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    const host = makeHost({ put: n => n <= 2 ? { status: 401, body: 'not-live: send an event first' } : null })
    vi.stubGlobal('fetch', host.fetch)
    const state = listen<{ host: string; status: string }>('sync:state')
    const service = await make()
    const s = await resource('{"name":"put before the beacon"}')
    await service.markPublic(s, 'resource')
    await service.drain()
    await settle()
    for (let step = 0; step < 50 && (await queued()).length > 0; step++) {
      await vi.advanceTimersByTimeAsync(100)
      await settle()
    }
    const [first, second, third] = host.stats.putAt
    expect(host.stats.putAt).toHaveLength(3)
    expect(second - first).toBeGreaterThanOrEqual(900)
    expect(second - first).toBeLessThanOrEqual(1_300)
    expect(third - second).toBeLessThanOrEqual(1_300)
    expect(await service.isClosureAvailable(s, 'resource')).toBe(true)
    const words = state.seen.filter(p => p.host === 'jwize.com').map(p => p.status)
    expect(words).toContain('not-live')
    expect(words[words.length - 1]).toBe('backed-up')
    state.off()
  })

  it('429 waits out the host (at most one PUT per entry in 5 min); 413 drops the entry for that host', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    const full = makeHost({ put: () => ({ status: 429, body: 'quota: 256 MB per key per day', headers: { 'retry-after': '60' } }) })
    vi.stubGlobal('fetch', full.fetch)
    const state = listen<{ host: string; status: string; reason: string }>('sync:state')
    const service = await make()
    const sigs: string[] = []
    for (let i = 0; i < 5; i++) sigs.push(await resource(`{"name":"over quota ${i}"}`))
    for (const s of sigs) await service.markPublic(s, 'resource')
    await service.drain()
    await settle()
    for (let minute = 0; minute < 5; minute++) { await vi.advanceTimersByTimeAsync(60_000); await settle() }
    const perEntry = new Map<string, number>()
    for (const url of calls(full, 'PUT')) perEntry.set(url, (perEntry.get(url) ?? 0) + 1)
    expect(Math.max(...perEntry.values())).toBeLessThanOrEqual(1)
    expect(state.seen.find(p => p.status === 'full')).toMatchObject({ reason: '429 quota: 256 MB per key per day' })
    expect(await queued()).toHaveLength(5) // still owed — the host named its wait
    vi.useRealTimers()

    root = new MemoryDir('')
    registry.set('@hypercomb.social/Store', { opfsRoot: root, getResourceLocal: async (s: string) => { const b = resources.get(s); return b ? { arrayBuffer: async () => b.slice().buffer } : null } })
    const large = makeHost({ put: () => ({ status: 413, body: 'too large: 8 MB per file' }) })
    vi.stubGlobal('fetch', large.fetch)
    const fresh = await make()
    const big = await resource('{"name":"a very large picture"}')
    await fresh.markPublic(big, 'resource')
    await quiesce(fresh, large)
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
    await quiesce(service, host)
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
    const host = makeHost({ put: n => n <= 2 ? { status: 500, body: 'busy' } : null })
    vi.stubGlobal('fetch', host.fetch)
    const service = (await make()) as Service & { withdrawPublic: (sig: string) => void }
    const pic = await resource('{"name":"a photo, then private"}')
    const tile = await layer({ name: 'photo', images: [pic] })
    await service.markPublic(tile, 'layer', false)
    await service.drain()
    await settle()
    expect(calls(host, 'PUT')).toHaveLength(2)   // both refused — waiting out the backoff

    service.withdrawPublic(tile)                  // the walk pruned it as private
    for (let step = 0; step < 100; step++) { await vi.advanceTimersByTimeAsync(100); await settle() }
    expect(calls(host, 'PUT')).toHaveLength(2)    // nothing more went to the room's host
    expect((await queued()).sort()).toEqual([`${pic}.resource`, `${tile}.layer`].sort())

    await service.markPublic(tile, 'layer', false) // public again: the next walk names it
    await service.drain()
    await settle()
    expect(calls(host, 'PUT').slice(2).sort()).toEqual([pic, tile].map(s => `https://jwize.com/${s}`).sort())
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
    localStorage.setItem('hc:public-host', '1')
    const host = makeHost()
    const fetch = vi.fn(async (input: string, init?: RequestInit) =>
      new URL(String(input)).host === 'pluginthematrix.com' && init?.method === 'PUT'
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

  it('only a socket that came back ends the swarm host\'s pause — a late probe answer does not', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    const host = makeHost({ put: () => ({ status: 403, body: 'participants-closed' }) })
    vi.stubGlobal('fetch', host.fetch)
    const service = await make()
    EffectBus.emit('mesh:connection', { state: 'open', reopened: false })
    const s = await resource('{"name":"a closed host"}')
    await service.markPublic(s, 'resource')
    await service.drain()
    await settle()
    expect(calls(host, 'PUT')).toHaveLength(1)   // refused: paused 10 min

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

describe('which host: publish domains, then the hosts pool, then the relay', () => {
  it('a fresh install uploads to its pool\'s hypercomb.com — its zone root, read back — never to the relay it meets at', async () => {
    pool = ['hypercomb.com']
    const apex = blossom()
    const relay = makeHost()
    const fetch = router({ 'hypercomb.com': apex, 'jwize.com': relay })
    vi.stubGlobal('fetch', fetch)
    const service = await make()
    expect(service.swarmHosts()).toEqual(['hypercomb.com'])
    expect(service.swarmHostsFor(null)).toEqual({ hosts: ['hypercomb.com'], source: 'pool', pending: false })
    const s = await resource('{"name":"a newcomer\'s first tile"}')
    await service.markPublic(s, 'resource')
    await quiesce(service, apex)
    expect(calls(apex, 'PUT')).toEqual([`https://hypercomb.com/${s}`])
    expect(calls(apex, 'GET')).toEqual([`https://hypercomb.com/${s}`]) // no `stored <sig>` — read back
    expect(relay.fetch).not.toHaveBeenCalled()
    expect(await receipts()).toEqual([`${s}.${await hostHash('hypercomb.com')}`])
    expect(await service.isClosureAvailable(s, 'resource')).toBe(true)
  })

  it('a meeting that names its host uploads there — ahead of the pool\'s hypercomb.com, with the host\'s own receipt', async () => {
    pool = ['hypercomb.com']
    meetingHost = 'meet.example'
    const meet = makeHost()
    const apex = blossom()
    vi.stubGlobal('fetch', router({ 'meet.example': meet, 'hypercomb.com': apex }))
    const service = await make()
    expect(service.swarmHostsFor(null)).toEqual({ hosts: ['meet.example'], source: 'meeting', pending: false })
    expect(service.swarmHosts()).toEqual(['meet.example'])
    const s = await resource('{"name":"shared at the meeting point"}')
    await service.markPublic(s, 'resource')
    await quiesce(service, meet)
    expect(calls(meet, 'PUT')).toEqual([`https://meet.example/${s}`])
    expect(calls(meet, 'GET')).toEqual([]) // `stored <sig>` is the receipt
    expect(apex.fetch).not.toHaveBeenCalled()
  })

  it('a pool host honours receipts earned on its zone\'s retired content face', async () => {
    pool = ['hypercomb.com']
    vi.stubGlobal('fetch', router({}))
    const s = await resource('{"name":"pushed to the content face long ago"}')
    await writeReceipt(`${s}.${await hostHash('content.hypercomb.com')}`)
    expect(await (await make()).isClosureAvailable(s, 'resource')).toBe(true)
  })

  it('publish domains override the pool for a page that wears them — each page\'s tiles go to its own host', async () => {
    pool = ['hypercomb.com']
    marks = new Map([['shop', ['pointblank.example']]])
    const apex = blossom()
    const shopHost = makeHost()
    const relay = makeHost()
    vi.stubGlobal('fetch', router({ 'hypercomb.com': apex, 'pointblank.example': shopHost, 'jwize.com': relay }))
    const service = await make(['shop'], ['shop', 'shelf'], ['meetup'])
    expect(service.swarmHostsFor(['shop', 'shelf'])).toEqual({ hosts: ['pointblank.example'], source: 'publish', pending: false })
    const jar = await resource('{"name":"a jar on the shop shelf"}')
    const flyer = await resource('{"name":"a flyer at the meetup"}')
    await service.markPublic(jar, 'resource', true, ['shop', 'shelf'])
    await service.markPublic(flyer, 'resource', true, ['meetup'])
    await quiesce(service, shopHost)
    await quiesce(service, apex)
    expect(calls(shopHost, 'PUT')).toEqual([`https://pointblank.example/${jar}`])
    expect(calls(apex, 'PUT')).toEqual([`https://hypercomb.com/${flyer}`])
    expect(relay.fetch).not.toHaveBeenCalled()
    expect(service.swarmHosts().sort()).toEqual(['hypercomb.com', 'pointblank.example'])
    // The share gate asks the page's own host.
    const on = service as Service & { isClosureAvailableOn: (sig: string, kind: string, closure: boolean, d: readonly string[]) => Promise<boolean> }
    expect(await on.isClosureAvailableOn(jar, 'resource', true, ['pointblank.example'])).toBe(true)
    expect(await on.isClosureAvailableOn(jar, 'resource', true, ['hypercomb.com'])).toBe(false)
  })

  it('the relay only when publish domains and the pool are both empty AND its card allows participants', async () => {
    pool = []
    participants = false
    const relay = makeHost()
    vi.stubGlobal('fetch', router({ 'jwize.com': relay }))
    const service = await make()
    expect(service.ensureSwarmTarget()).toBe('needs-host')
    const s = await resource('{"name":"nobody hosts me yet"}')
    await service.markPublic(s, 'resource')
    await quiesce(service, relay)
    expect(relay.fetch).not.toHaveBeenCalled()

    // The relay's card changes its word: it hosts participants now.
    participants = 'all'
    EffectBus.emit('mesh:host-card', { relay: 'wss://jwize.com', participants: 'all' })
    await settle()
    expect(service.ensureSwarmTarget()).toBe('ready')
    await quiesce(service, relay)
    expect(calls(relay, 'PUT')).toEqual([`https://jwize.com/${s}`])
  })

  it('a pool that changes moves the uploads with it — no reload — and what was already shared follows', async () => {
    pool = ['hypercomb.com']
    const apex = blossom()
    const alpha = makeHost()
    vi.stubGlobal('fetch', router({ 'hypercomb.com': apex, 'alpha.example': alpha }))
    const service = await make()
    const first = await resource('{"name":"before the pool changed"}')
    await service.markPublic(first, 'resource')
    await quiesce(service, apex)
    expect(calls(apex, 'PUT')).toEqual([`https://hypercomb.com/${first}`])
    expect(await queued()).toEqual([]) // its entry is retired

    // Following another host never moves the uploads: the first added stays.
    pool = ['hypercomb.com', 'alpha.example']
    EffectBus.emit('hosts:render', { open: false, zones: ['alpha.example', 'hypercomb.com'], loaded: true })
    await settle()
    expect(service.swarmHosts()).toEqual(['hypercomb.com'])

    // The participant drops hypercomb.com: alpha is the host now.
    pool = ['alpha.example']
    EffectBus.emit('hosts:render', { open: false, zones: ['alpha.example'], loaded: true })
    await settle()
    expect(service.swarmHosts()).toEqual(['alpha.example'])
    const second = await resource('{"name":"after the pool changed"}')
    await service.markPublic(second, 'resource')
    await quiesce(service, alpha)
    expect(calls(alpha, 'PUT')).toContain(`https://alpha.example/${second}`)
    expect(calls(apex, 'PUT')).not.toContain(`https://hypercomb.com/${second}`)
    // What the room was already offered reaches the new host too, though
    // its entry left the queue long ago — no tile is stranded by the move.
    expect(calls(alpha, 'PUT')).toContain(`https://alpha.example/${first}`)
    expect(await service.isClosureAvailable(first, 'resource')).toBe(true)
  })

  it('a picture shown on two pages with different hosts reaches both', async () => {
    pool = ['hypercomb.com']
    marks = new Map([['shop', ['pointblank.example']]])
    const apex = blossom()
    const shopHost = makeHost()
    vi.stubGlobal('fetch', router({ 'hypercomb.com': apex, 'pointblank.example': shopHost }))
    const service = await make(['shop'], ['meetup'])
    const pic = await resource('{"name":"one photo, two pages"}')
    const flyer = await layer({ name: 'flyer', images: [pic] })
    const jar = await layer({ name: 'jar', images: [pic] })
    await service.markPublic(flyer, 'layer', false, ['meetup'])
    await quiesce(service, apex)
    expect(calls(apex, 'PUT').sort()).toEqual([`https://hypercomb.com/${flyer}`, `https://hypercomb.com/${pic}`].sort())
    expect(await queued()).toEqual([])

    await service.markPublic(jar, 'layer', false, ['shop'])
    await quiesce(service, shopHost)
    expect(calls(shopHost, 'PUT').sort()).toEqual([`https://pointblank.example/${jar}`, `https://pointblank.example/${pic}`].sort())
    const at = service as Service & { isClosureAvailableAt: (sig: string, kind: string, closure: boolean, page: readonly string[]) => Promise<boolean | null> }
    expect(await at.isClosureAvailableAt(jar, 'layer', false, ['shop'])).toBe(true)
  })

  it('a branch shared at a page keeps its subtree on its OWN publish domains; only its tile goes where the page goes', async () => {
    pool = ['hypercomb.com']
    marks = new Map([['shop', ['pointblank.example']]])
    const apex = blossom()
    const shopHost = makeHost()
    vi.stubGlobal('fetch', router({ 'hypercomb.com': apex, 'pointblank.example': shopHost }))
    const service = await make(['shop'], ['shop', 'jar'])
    const label = await resource('{"name":"the jar\'s label"}')
    const inner = await layer({ name: 'jar', notes: [label] })
    const branch = await layer({ name: 'shop', children: [inner] })
    // The walk at the hive root offers the shop tile with its closure.
    await service.markPublic(branch, 'layer', true, [])
    await quiesce(service, shopHost)
    await quiesce(service, apex)
    expect(calls(apex, 'PUT')).toEqual([`https://hypercomb.com/${branch}`])
    expect(calls(shopHost, 'PUT').sort()).toEqual([`https://pointblank.example/${inner}`, `https://pointblank.example/${label}`].sort())
    expect(service.swarmHosts().sort()).toEqual(['hypercomb.com', 'pointblank.example'])
    const at = service as Service & {
      isClosureAvailableAt: (sig: string, kind: string, closure: boolean, page: readonly string[]) => Promise<boolean | null>
      isClosureAvailableOn: (sig: string, kind: string, closure: boolean, d: readonly string[]) => Promise<boolean>
      closureHostsOf: (sig: string) => string[]
    }
    // The gate judges each part where it is shown, and the root page's
    // event can name where the subtree went.
    expect(await at.isClosureAvailableAt(branch, 'layer', true, [])).toBe(true)
    expect(await at.isClosureAvailableOn(branch, 'layer', true, ['hypercomb.com'])).toBe(false)
    expect(at.closureHostsOf(branch).sort()).toEqual(['hypercomb.com', 'pointblank.example'])
  })

  it('a page still being read deep in a closure is unknown to the gate, never "no"', async () => {
    pool = ['hypercomb.com']
    const hang = new Promise<never>(() => undefined)
    const slow = new Resolver({ ...deps, readMarks: (segments: readonly string[]) => segments.length > 1 ? hang : Promise.resolve([]) })
    slow.warm(null)
    slow.warm(['shop'])
    await settle(10)
    vi.stubGlobal('fetch', router({ 'hypercomb.com': blossom() }))
    const service = new HostSync(slow) as Service & { isClosureAvailableAt: (sig: string, kind: string, closure: boolean, page: readonly string[]) => Promise<boolean | null> }
    const inner = await layer({ name: 'deep' })
    const mid = await layer({ name: 'jar', children: [inner] })
    const branch = await layer({ name: 'shop', children: [mid] })
    await writeReceipt(`${branch}.${await hostHash('hypercomb.com')}`)
    await writeReceipt(`${mid}.${await hostHash('hypercomb.com')}`)
    expect(await service.isClosureAvailableAt(branch, 'layer', true, [])).toBeNull()
  })

  it('a publish while joined is not a room offer: it goes to the nodes the publish names, never the pool host', async () => {
    pool = ['hypercomb.com']
    const apex = blossom()
    const node = makeHost()
    vi.stubGlobal('fetch', router({ 'hypercomb.com': apex, 'node.example': node }))
    const service = (await make()) as Service & { addPublishNodes: (d: readonly string[]) => void; markPublic: (sig: string, kind?: string, closure?: boolean, page?: readonly string[] | false) => Promise<void> }
    const sealed = await layer({ name: 'shop' })
    service.addPublishNodes(['node.example'])
    await service.markPublic(sealed, 'layer', true, false)
    await quiesce(service, node)
    expect(calls(node, 'PUT')).toEqual([`https://node.example/${sealed}`])
    expect(calls(apex, 'PUT')).toEqual([])
  })

  it('a pool host that refuses is passed over for the next — then a relay that hosts participants: never a strand', async () => {
    pool = ['hypercomb.com']
    const apex = makeHost({ put: () => ({ status: 403, body: 'no grant for this key' }) })
    const relay = makeHost()
    vi.stubGlobal('fetch', router({ 'hypercomb.com': apex, 'jwize.com': relay }))
    const service = await make()
    const s = await resource('{"name":"refused by the apex"}')
    await service.markPublic(s, 'resource')
    await quiesce(service, relay)
    await quiesce(service, relay)
    expect(calls(apex, 'PUT')).toEqual([`https://hypercomb.com/${s}`])
    expect(calls(relay, 'PUT')).toEqual([`https://jwize.com/${s}`])
    expect(service.swarmHostsFor(null)).toMatchObject({ hosts: ['jwize.com'], source: 'relay', passedOver: ['hypercomb.com'] })
    expect(await service.isClosureAvailable(s, 'resource')).toBe(true)
  })

  it('a pool host that never answers an upload while the relay does is passed over after a second wave', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    pool = ['hypercomb.com']
    const relay = makeHost()
    // An apex the browser cannot talk to at all: every request blocked by
    // CORS before an answer is readable — no answer, ever.
    const apexFetch = vi.fn(async (_input: string, _init?: RequestInit): Promise<Response> => { throw new TypeError('Failed to fetch') })
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) =>
      new URL(String(input)).host === 'hypercomb.com' ? apexFetch(input, init) : relay.fetch(input, init)))
    const service = await make()
    EffectBus.emit('mesh:connection', { state: 'open' })
    const s = await resource('{"name":"the apex cannot take me"}')
    await service.markPublic(s, 'resource')
    for (let step = 0; step < 80 && calls(relay, 'PUT').length === 0; step++) { await vi.advanceTimersByTimeAsync(250); await settle() }
    expect(calls(relay, 'PUT')).toEqual([`https://jwize.com/${s}`])
    expect(service.swarmHostsFor(null)).toMatchObject({ source: 'relay', passedOver: ['hypercomb.com'] })
  })

  it('a pool host that answers a PAGE where bytes should be is probed once, and passed over when its upload fails', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    pool = ['hypercomb.com']
    const relay = makeHost()
    // The apex today: the Azure shell answers every address with its page,
    // and a PUT never leaves the browser (its CORS preflight allows no PUT).
    const apexFetch = vi.fn(async (_input: string, init?: RequestInit): Promise<Response> => {
      if ((init?.method ?? 'GET') === 'PUT') throw new TypeError('Failed to fetch')
      return new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } })
    })
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) =>
      new URL(String(input)).host === 'hypercomb.com' ? apexFetch(input, init) : relay.fetch(input, init)))
    const service = await make()
    EffectBus.emit('mesh:connection', { state: 'open' })
    const sigs = [await resource('{"name":"one"}'), await resource('{"name":"two"}'), await resource('{"name":"three"}')]
    for (const s of sigs) await service.markPublic(s, 'resource')
    for (let step = 0; step < 80 && calls(relay, 'PUT').length < sigs.length; step++) { await vi.advanceTimersByTimeAsync(250); await settle() }
    expect(calls(relay, 'PUT').sort()).toEqual(sigs.map(s => `https://jwize.com/${s}`).sort())
    // One wave of probes at most — never a HEAD per queued sig per pass.
    const heads = apexFetch.mock.calls.filter(([, init]) => init?.method === 'HEAD')
    expect(heads.length).toBeLessThanOrEqual(sigs.length)
    expect(service.swarmHostsFor(null)).toMatchObject({ source: 'relay', passedOver: ['hypercomb.com'] })
  })

  it('the meeting relay named as a pool host never honours its zone\'s content-face receipts', async () => {
    pool = ['jwize.com']
    vi.stubGlobal('fetch', router({ 'jwize.com': makeHost() }))
    const s = await resource('{"name":"on the R2 face, not the relay heap"}')
    await writeReceipt(`${s}.${await hostHash('content.jwize.com')}`)
    expect(await (await make()).isClosureAvailable(s, 'resource')).toBe(false)
  })

  it('nothing on the join, mark or announce path waits for a pool or a branch read', async () => {
    const hang = new Promise<never>(() => undefined)
    const stuck = new Resolver({
      readPool: () => hang,
      readMarks: () => hang,
      relay: () => ({ host: 'jwize.com', participants: 'all' }),
      originLoopback: () => false,
    })
    vi.stubGlobal('fetch', router({}))
    const service = new HostSync(stuck)
    const s = await resource('{"name":"offered while the pool is unread"}')
    const within = <T>(p: Promise<T>): Promise<T | 'late'> =>
      Promise.race([p, new Promise<'late'>(r => setTimeout(() => r('late'), 1_000))])
    expect(service.swarmHostsFor(['meetup'])).toEqual({ hosts: [], source: 'none', pending: true })
    expect(service.ensureSwarmTarget()).toBe('needs-host')
    expect(await within(service.markPublic(s, 'resource', true, ['meetup']))).toBeUndefined()
    expect(await within(service.isClosureAvailable(s, 'resource'))).toBe(false)
    // Unread is not empty: the relay is never taken as a stand-in meanwhile.
    expect(service.swarmHosts()).toEqual([])
  })
})
