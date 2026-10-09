// host-sync.swarm-target.spec.ts — THE SWARM'S HOST IS A DERIVED TARGET.
//
// A joined tab uploads its public tiles to the relay it meets at: wss://h is
// https://h/<sig>, the relay's own heap. Nothing is stored or picked — the
// target is this tab's membership plus the mesh's relay list — so a reload
// finds the same target and the receipts on disk count again. The relay's
// `201 stored <sig>` is the receipt (no read-back), uploads go four at a time,
// and every failure backs off per host with the host's own reason.
//
// The drain reads OPFS through the Store's `opfsRoot`, so the fake root and
// the fake local store are handed over through IoC, as is the mesh stub.

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
  markPublic: (sig: string, kind?: string, closure?: boolean) => Promise<void>
  isClosureAvailable: (sig: string, kind?: string, closure?: boolean) => Promise<boolean>
  closureGaps: (sig: string, kind?: string, closure?: boolean, limit?: number) => Promise<string[]>
  ensureSwarmTarget: () => string
  isGateActive: () => boolean
}
let HostSync: new () => Service

const sign = async (bytes: Uint8Array): Promise<string> => await SignatureService.sign(bytes.slice().buffer as ArrayBuffer)
const poolName = async (meaning: string): Promise<string> => await sign(new TextEncoder().encode(meaning))
const hostHash = async (domain: string): Promise<string> => (await sign(new TextEncoder().encode(domain))).slice(0, 16)

let root: MemoryDir
const resources = new Map<string, Uint8Array>()
const layers = new Map<string, Uint8Array>()
let swarmHost = 'jwize.com'
let signedAt: number[] = []

beforeAll(async () => {
  registry.set('@diamondcoreprocessor.com/NostrSigner', {
    signEvent: async (event: Record<string, unknown>) => {
      signedAt.push(Number(event['created_at']))
      return { ...event, id: 'e', pubkey: 'p'.repeat(64), sig: 's' }
    },
    getPublicKeyHex: async () => 'p'.repeat(64),
  })
  const mod = await import('./host-sync.service.js')
  HostSync = mod.HostSyncService as unknown as new () => Service
})

const join = (joined: boolean): void => { EffectBus.emit('mesh:public-changed', { public: joined }) }

beforeEach(() => {
  root = new MemoryDir('')
  resources.clear()
  layers.clear()
  signedAt = []
  swarmHost = 'jwize.com'
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
    const service = new HostSync()
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
    const service = new HostSync()
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
    const host = makeHost()
    vi.stubGlobal('fetch', host.fetch)
    const service = new HostSync()
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

  it('a 2xx without the relay\'s words is read back, like every other host', async () => {
    const host = makeHost({ put: (_n, sig) => { host.held.set(sig, resources.get(sig)!); return { status: 200, body: 'ok' } } })
    vi.stubGlobal('fetch', host.fetch)
    const service = new HostSync()
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
    const service = new HostSync()
    expect(await service.isClosureAvailable(s, 'resource')).toBe(false)
    await writeReceipt(`${s}.${await hostHash('jwize.com')}`)
    expect(await new HostSync().isClosureAvailable(s, 'resource')).toBe(true)
  })

  it('a reload — a fresh service over the same OPFS — still finds the closure available', async () => {
    const host = makeHost()
    vi.stubGlobal('fetch', host.fetch)
    const s = await resource('{"name":"survives a reload"}')
    const before = new HostSync()
    await before.markPublic(s, 'resource')
    await quiesce(before, host)
    expect(await before.isClosureAvailable(s, 'resource')).toBe(true)
    expect(await new HostSync().isClosureAvailable(s, 'resource')).toBe(true)
  })

  it('a sealed nested node is staged by the walk alone (no content:wrote) and the branch becomes available', async () => {
    const host = makeHost()
    vi.stubGlobal('fetch', host.fetch)
    const service = new HostSync()
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
    const service = new HostSync()
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
    const service = new HostSync()
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
    const service = new HostSync()
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
    const service = new HostSync()
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
    const service = new HostSync()
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
    const fresh = new HostSync()
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
    const service = new HostSync()
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
    const service = new HostSync()
    expect(await service.isClosureAvailable(branch, 'layer', true)).toBe(true)
    expect(calls(host, 'HEAD')).toEqual([`https://jwize.com/${adopted}`])
    expect(await receipts()).toContain(`${adopted}.${await hostHash('jwize.com')}`)
    expect(await service.closureGaps(branch, 'layer', true)).toEqual([])

    host.fetch.mockClear()
    expect(await new HostSync().isClosureAvailable(branch, 'layer', true)).toBe(true)
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
    const service = new HostSync()
    expect(await service.isClosureAvailable(branch, 'layer', true)).toBe(false)
    expect(missing.seen).toEqual([{ sig: lost }])
    expect(state.seen.pop()).toMatchObject({ host: 'jwize.com', missing: 1 })
    await service.closureGaps(branch, 'layer', true)
    expect(calls(host, 'HEAD')).toEqual([`https://jwize.com/${lost}`])
    missing.off()
    state.off()
  })
})

describe('reads try the swarm host first', () => {
  it('joined on the page origin: the swarm host is asked first and the origin is not probed', async () => {
    registry.set('@hypercomb.social/Store', { getResourceLocal: async () => null, putResource: async () => '' })
    const { ContentBrokerDrone } = await import('./content-broker.boot.drone.js')
    const bytes = new TextEncoder().encode('export const peer = 1')
    const s = await sign(bytes)
    // The origin seeds itself as the self-domain (hypercomb.io does); it is
    // the shell, and answers every /<sig> with the app page.
    localStorage.setItem('hc:nostrmesh:self-domain', location.host)
    const fetch = vi.fn(async (url: string) => url.startsWith('https://jwize.com/')
      ? new Response(bytes.slice(), { status: 200, headers: { 'content-type': 'application/octet-stream' } })
      : new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } }))
    vi.stubGlobal('fetch', fetch)
    const broker = new ContentBrokerDrone()
    expect(Array.from((await broker.fetchBySig(s, 'resource'))!)).toEqual(Array.from(bytes))
    expect(String(fetch.mock.calls[0]?.[0])).toBe(`https://jwize.com/${s}`)
    expect(fetch.mock.calls.some(([url]) => String(url).includes(location.host))).toBe(false)
  })
})

describe('the room is owed only what it is offered now', () => {
  it('a tile made private while its upload waits never reaches the swarm host; offered again, it goes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    const host = makeHost({ put: n => n <= 2 ? { status: 500, body: 'busy' } : null })
    vi.stubGlobal('fetch', host.fetch)
    const service = new HostSync() as Service & { withdrawPublic: (sig: string) => void }
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
    const service = new HostSync()
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
    const service = new HostSync()
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
    const service = new HostSync()
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
    const service = new HostSync()
    expect(await service.isClosureAvailable(tile, 'layer', false)).toBe(false)
    expect(read).not.toHaveBeenCalled()
    expect(calls(host, 'HEAD')).toEqual([])      // held here: the drain owes it, the host is not asked
  })
})

describe('the publish gate asks the nodes it publishes to', () => {
  it('the meeting host\'s receipt makes a closure available — but not ON the publish node', async () => {
    const host = makeHost()
    vi.stubGlobal('fetch', host.fetch)
    const service = new HostSync() as Service & {
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
