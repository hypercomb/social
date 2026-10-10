// host-sync.stuck-uploads.spec.ts — A HOST THAT CANNOT TAKE UPLOADS NEVER
// STALLS THE ROOM (the 2026-10-10 meeting).
//
// The owner's ~6,000-node hive announced 27 root tiles and none became
// takeable for 40+ minutes while the status read a green "uploading": the
// pool's primary (the hypercomb.com apex, then an Azure shell) answered every
// HEAD with its page and let no PUT through its CORS preflight; that read as
// `unreachable`, which passes a pool host over only on a SECOND failure wave;
// each wave waited behind a full reconcile of thousands of queued entries;
// a reload forgot the pass-over; and a branch whose publish domain could never
// take a write (`hyperccomb.com`, NXDOMAIN) read as uploading for ever.
//
//   (A) the HEAD the drain already makes is the probe: a pool host that
//       answers a page is passed over right there, before any PUT — unless
//       it already took this tab's uploads (a hiccup, never a page host);
//   (B) an upload the CORS preflight blocks, from a host that answered, is a
//       refusal — one wave, not two — but only on evidence a dropped path
//       cannot give (two uploads that never left, the host answering a HEAD
//       right after, the tab online), and never remembered past the socket;
//   (C) this tab remembers the pass-over across a reload (sessionStorage,
//       bounded, an hour) — only on positive evidence (a page, the host's own
//       4xx) — and a receipt or the participant's retry forgets it;
//   (D) the drain reconciles and sends in batches, so the first PUT — and the
//       progress line — never wait on the whole queue, nor a new host's first
//       answer on another host's backlog;
//   (E) a host that can never take a write is named, with why.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus, SignatureService } from '@hypercomb/core'

// Real timers and real WebCrypto: a busy machine (the whole suite at once)
// must not turn a slow test into a red one.
vi.setConfig({ testTimeout: 20_000 })

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

/** A dir that counts its lookups — how much of the queue the drain asked
 *  about before it did something. */
class CountingDir extends MemoryDir {
  lookups = 0
  override async getFileHandle(name: string, options?: { create?: boolean }): Promise<MemoryFile> {
    this.lookups++
    return super.getFileHandle(name, options)
  }
}

// ── IoC: the local store, the signer, the mesh ─────────────────────────────

const registry = new Map<string, unknown>()
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registry.set(key, value) },
  get: (key: string) => registry.get(key),
  whenReady: () => undefined,
}

const MESH_KEY = '@diamondcoreprocessor.com/NostrMeshDrone'

type Trouble = { host: string; status: string; why: string; reason: string } | null
type Service = {
  drain: () => Promise<void>
  reDrain: () => Promise<unknown>
  markPublic: (sig: string, kind?: string, closure?: boolean, page?: readonly string[]) => Promise<void>
  swarmHostsFor: (segments: readonly string[] | null) => { hosts: readonly string[]; source: string; pending: boolean; passedOver?: readonly string[] }
  hostTrouble: (host: string) => Trouble
}
type ResolverLike = {
  warm: (s: readonly string[] | null) => void
  hostsFor: (s: readonly string[] | null) => { hosts: readonly string[]; source: string; pending: boolean; passedOver?: readonly string[] }
  markDown: (host: string, reason: string, remember?: boolean) => void
  markUp: (host: string) => void
  clearDown: () => void
  downReason: (host: string) => string
}
let HostSync: new (resolver?: unknown) => Service
let Resolver: new (deps: unknown) => ResolverLike
let liveSession: (() => unknown) | undefined

const sign = async (bytes: Uint8Array): Promise<string> => await SignatureService.sign(bytes.slice().buffer as ArrayBuffer)
const poolName = async (meaning: string): Promise<string> => await sign(new TextEncoder().encode(meaning))
const hostHash = async (domain: string): Promise<string> => (await sign(new TextEncoder().encode(domain))).slice(0, 16)

let root: MemoryDir
const resources = new Map<string, Uint8Array>()

// ── where the bytes go ─────────────────────────────────────────────────────
// Defaults: the pool's hypercomb.com, and a relay (jwize.com) whose card
// allows participants — the next door when a pool host is passed over.
let pool: string[] | null = ['hypercomb.com']
let marks = new Map<string, string[]>()
let participants: unknown = 'all'
/** THIS TAB's session storage, as the resolver sees it: what a reload keeps. */
let session = new Map<string, string>()
const sessionLike = {
  getItem: (k: string) => session.get(k) ?? null,
  setItem: (k: string, v: string) => { session.set(k, String(v)) },
  removeItem: (k: string) => { session.delete(k) },
}
const deps = {
  readPool: async () => pool,
  readMarks: async (segments: readonly string[]) => marks.get(segments.join('/')) ?? [],
  relay: () => ({ host: 'jwize.com', participants }),
  originLoopback: () => false,
  meetingHost: () => '',
  session: () => sessionLike,
}
const DOWN_KEY = 'hc:swarm-hosts:down'

const settle = async (turns = 40): Promise<void> => {
  for (let i = 0; i < turns; i++) await new Promise<void>(resolve => setImmediate(resolve))
}

/** A tab a moment after boot — or after a RELOAD: a fresh resolver over the
 *  same session, and a fresh service over it. */
const make = async (...pages: string[][]): Promise<Service> => {
  const resolver = new Resolver(deps)
  resolver.warm(null)
  for (const page of pages) resolver.warm(page)
  await settle(10)
  return new HostSync(resolver)
}

const join = (joined: boolean): void => { EffectBus.emit('mesh:public-changed', { public: joined }) }
const meshState = (state: string): void => { EffectBus.emit('mesh:connection', { state }) }

beforeAll(async () => {
  registry.set('@diamondcoreprocessor.com/NostrSigner', {
    signEvent: async (event: Record<string, unknown>) => ({ ...event, id: 'e', pubkey: 'p'.repeat(64), sig: 's' }),
    getPublicKeyHex: async () => 'p'.repeat(64),
  })
  const mod = await import('./host-sync.service.js')
  HostSync = mod.HostSyncService as unknown as typeof HostSync
  const hosts = await import('./swarm-hosts.js')
  Resolver = hosts.SwarmHostResolver as unknown as typeof Resolver
  liveSession = hosts.liveSwarmHostDeps.session as (() => unknown) | undefined
})

beforeEach(() => {
  root = new MemoryDir('')
  resources.clear()
  pool = ['hypercomb.com']
  marks = new Map()
  participants = 'all'
  session = new Map()
  EffectBus.emit('hosts:render', { open: false, zones: [], loaded: false })
  registry.set('@hypercomb.social/Store', {
    opfsRoot: root,
    getResourceLocal: async (s: string) => { const b = resources.get(s); return b ? { arrayBuffer: async () => b.slice().buffer } : null },
    getLayerPoolBytes: async () => null,
  })
  registry.set(MESH_KEY, { swarmHost: () => 'jwize.com' })
  localStorage.clear()
  localStorage.setItem('hc:nostrmesh:self-domain', 'hypercomb.io')
  // The meeting socket is open: a host silent now is the host, not the path.
  meshState('open')
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

const queued = async (): Promise<string[]> => {
  const dir = root.children.get(await poolName('host-push'))
  return dir?.kind === 'directory' ? dir.names().filter(n => !n.endsWith('.public')) : []
}

const receipts = async (): Promise<string[]> => {
  const dir = root.children.get(await poolName('host-receipts'))
  return dir?.kind === 'directory' ? dir.names() : []
}

const listen = <T>(effect: string): { seen: T[]; off: () => void } => {
  const seen: T[] = []
  const off = EffectBus.on<T>(effect, payload => { seen.push(payload) })
  seen.length = 0
  return { seen, off }
}

/** Fake timers: step the clock until `pred` holds (or the steps run out). */
const advanceUntil = async (pred: () => boolean | Promise<boolean>, stepMs = 100, steps = 60): Promise<void> => {
  for (let i = 0; i < steps && !(await pred()); i++) { await vi.advanceTimersByTimeAsync(stepMs); await settle() }
}

/** Real timers: poll until `pred` holds. */
const waitFor = async (pred: () => boolean | Promise<boolean>, ms = 10_000): Promise<void> => {
  const start = Date.now()
  while (!(await pred())) {
    if (Date.now() - start > ms) throw new Error('timed out waiting')
    await new Promise(r => setTimeout(r, 5))
    await settle(5)
  }
}

// ── hosts ──────────────────────────────────────────────────────────────────

type FetchMock = ReturnType<typeof vi.fn<(input: string, init?: RequestInit) => Promise<Response>>>
type Host = { fetch: FetchMock; held: Map<string, Uint8Array> }

/** A heap: bytes or 404 on a HEAD; a signed PUT is hashed, kept, and answered
 *  `stored <sig>` (the relay's word). */
const heap = (held: Map<string, Uint8Array> = new Map()): Host => {
  const fetch: FetchMock = vi.fn(async (input: string, init?: RequestInit): Promise<Response> => {
    const sig = new URL(String(input)).pathname.slice(1)
    const method = init?.method ?? 'GET'
    if (method === 'PUT') {
      const body = new Uint8Array(init?.body as ArrayBuffer)
      if (await sign(body) !== sig) return new Response(null, { status: 422 })
      held.set(sig, body)
      return new Response(`stored ${sig}`, { status: 201 })
    }
    const bytes = held.get(sig)
    if (!bytes) return new Response(null, { status: 404 })
    return new Response(method === 'HEAD' ? null : bytes.slice(), { status: 200, headers: { 'content-type': 'application/octet-stream' } })
  })
  return { fetch, held }
}

/** The apex on 2026-10-10: every address answers the site's page, and a PUT
 *  never leaves the browser (its CORS preflight allows no PUT). */
const pageSite = (): Host => {
  const fetch: FetchMock = vi.fn(async (_input: string, init?: RequestInit): Promise<Response> => {
    if ((init?.method ?? 'GET') === 'PUT') throw new TypeError('Failed to fetch')
    return new Response('<!doctype html><title>the site</title>', { status: 200, headers: { 'content-type': 'text/html' } })
  })
  return { fetch, held: new Map() }
}

/** A name that reaches nothing (NXDOMAIN): every request fails in the browser. */
const nowhere = (): Host => {
  const fetch: FetchMock = vi.fn(async (): Promise<Response> => { throw new TypeError('Failed to fetch') })
  return { fetch, held: new Map() }
}

const router = (byHost: Record<string, Host>): FetchMock => vi.fn(async (input: string, init?: RequestInit): Promise<Response> => {
  const host = byHost[new URL(String(input)).host]
  return host ? host.fetch(input, init) : new Response('no such host', { status: 404 })
})

const calls = (host: Host, method: string): string[] =>
  host.fetch.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === method).map(([url]) => String(url))

/** Stage `count` entries while the pool is still being read (so nothing
 *  drains), then let the pool land: the first pass meets a FULL queue —
 *  more entries than the four concurrent probe slots. */
const stageThenLand = async (count: number, label: string): Promise<{ service: Service; sigs: string[] }> => {
  const readPool = deps.readPool
  let land!: () => void
  const landed = new Promise<void>(resolve => { land = resolve })
  deps.readPool = async () => { await landed; return pool }
  try {
    const service = await make()
    const sigs: string[] = []
    for (let i = 0; i < count; i++) sigs.push(await resource(`{"name":"${label} ${i}"}`))
    for (const s of sigs) await service.markPublic(s, 'resource')
    await settle()
    expect((await queued()).length).toBe(count)
    land()
    await settle()
    return { service, sigs }
  } finally {
    deps.readPool = readPool
  }
}

// ── (A) the HEAD is the probe ──────────────────────────────────────────────

describe('(A) a pool host that answers a page is passed over at its first HEAD', () => {
  it('passed over after that one HEAD — before a single PUT — and the relay takes the page', async () => {
    const apex = pageSite()
    const relay = heap()
    vi.stubGlobal('fetch', router({ 'hypercomb.com': apex, 'jwize.com': relay }))
    const service = await make()
    const sigs = [await resource('{"name":"one"}'), await resource('{"name":"two"}'), await resource('{"name":"three"}')]
    for (const s of sigs) await service.markPublic(s, 'resource')
    await waitFor(async () => calls(relay, 'PUT').length === sigs.length && (await queued()).length === 0)
    expect(calls(apex, 'PUT')).toEqual([])
    expect(calls(apex, 'HEAD').length).toBeGreaterThan(0)
    expect(calls(apex, 'HEAD').length).toBeLessThanOrEqual(sigs.length)
    expect(calls(relay, 'PUT').sort()).toEqual(sigs.map(s => `https://jwize.com/${s}`).sort())
    expect(service.swarmHostsFor(null)).toEqual({ hosts: ['jwize.com'], source: 'relay', pending: false, passedOver: ['hypercomb.com'] })
    // The status lines can say why, though no upload was ever tried there.
    expect(service.hostTrouble('hypercomb.com')).toMatchObject({ host: 'hypercomb.com', why: 'page' })
  })

  it('ONE HEAD asks it, however full the first batch is — the rest of the batch waits on that answer', async () => {
    const apex = pageSite()
    const relay = heap()
    vi.stubGlobal('fetch', router({ 'hypercomb.com': apex, 'jwize.com': relay }))
    const { service, sigs } = await stageThenLand(9, 'entry')
    await service.drain()
    await waitFor(async () => calls(relay, 'PUT').length === sigs.length && (await queued()).length === 0)
    expect(calls(apex, 'HEAD')).toHaveLength(1)
    expect(calls(apex, 'PUT')).toEqual([])
    expect(service.swarmHostsFor(null)).toMatchObject({ hosts: ['jwize.com'], passedOver: ['hypercomb.com'] })
  })

  it('a heap that answers 404 or the bytes is never passed over', async () => {
    const lacking = await resource('{"name":"the heap lacks me"}')
    const held = await resource('{"name":"the heap holds me"}')
    const apex = heap(new Map([[held, resources.get(held)!]]))
    const relay = heap()
    vi.stubGlobal('fetch', router({ 'hypercomb.com': apex, 'jwize.com': relay }))
    const service = await make()
    await service.markPublic(lacking, 'resource')
    await service.markPublic(held, 'resource')
    await waitFor(async () => (await queued()).length === 0)
    expect(calls(apex, 'PUT')).toEqual([`https://hypercomb.com/${lacking}`])
    expect(relay.fetch).not.toHaveBeenCalled()
    expect(service.swarmHostsFor(null)).toEqual({ hosts: ['hypercomb.com'], source: 'pool', pending: false })
    expect(service.hostTrouble('hypercomb.com')).toBeNull()
    expect(session.has(DOWN_KEY)).toBe(false)
  })

  it('a publish domain that answers a page is never passed over — it is pushed to, and named `page`', async () => {
    marks = new Map([['shop', ['shop.example']]])
    const shop = pageSite()
    const apex = heap()
    vi.stubGlobal('fetch', router({ 'shop.example': shop, 'hypercomb.com': apex }))
    const state = listen<{ host: string; status: string; why?: string; swarm: boolean }>('sync:state')
    const service = await make(['shop'])
    const jar = await resource('{"name":"a jar on the shop shelf"}')
    await service.markPublic(jar, 'resource', true, ['shop'])
    await waitFor(() => state.seen.some(p => p.host === 'shop.example' && p.why === 'page'))
    // Tried: it was chosen — and only ever with the shop's jar.
    expect(calls(shop, 'PUT').length).toBeGreaterThan(0)
    expect(new Set(calls(shop, 'PUT'))).toEqual(new Set([`https://shop.example/${jar}`]))
    expect(service.swarmHostsFor(['shop'])).toEqual({ hosts: ['shop.example'], source: 'publish', pending: false })
    expect(state.seen.filter(p => p.host === 'shop.example').pop()).toMatchObject({ why: 'page', swarm: true })
    expect(service.hostTrouble('shop.example')).toMatchObject({ host: 'shop.example', why: 'page' })
    expect(calls(apex, 'PUT')).toEqual([]) // the shop's bytes never move to the pool
    state.off()
  })

  it('a pool host that already took this tab\'s uploads and answers a page once is not passed over — a hiccup, not a page host', async () => {
    let hiccup = false
    const apexHeap = heap()
    const site = pageSite()
    const apex: Host = {
      fetch: vi.fn(async (input: string, init?: RequestInit) => {
        // One page, at one HEAD, while its route is being redeployed.
        if (hiccup && (init?.method ?? 'GET') === 'HEAD') { hiccup = false; return site.fetch(input, init) }
        return apexHeap.fetch(input, init)
      }),
      held: apexHeap.held,
    }
    const relay = heap()
    vi.stubGlobal('fetch', router({ 'hypercomb.com': apex, 'jwize.com': relay }))
    const service = await make()
    await service.markPublic(await resource('{"name":"the first upload"}'), 'resource')
    await waitFor(async () => calls(apex, 'PUT').length === 1 && (await queued()).length === 0)
    hiccup = true
    const second = await resource('{"name":"asked during the hiccup"}')
    await service.markPublic(second, 'resource')
    await waitFor(async () => (await queued()).length === 0)
    expect(hiccup).toBe(false) // the page was answered
    expect(calls(apex, 'PUT')).toContain(`https://hypercomb.com/${second}`)
    expect(relay.fetch).not.toHaveBeenCalled()
    expect(service.swarmHostsFor(null)).toEqual({ hosts: ['hypercomb.com'], source: 'pool', pending: false })
    expect(service.hostTrouble('hypercomb.com')).toBeNull()
    expect(session.has(DOWN_KEY)).toBe(false)
  })

  it('a page answered while no socket is open is passed over for this page only, and the socket coming back gives it back', async () => {
    meshState('offline')
    const apex = pageSite()
    vi.stubGlobal('fetch', router({ 'hypercomb.com': apex, 'jwize.com': heap() }))
    const service = await make()
    await service.markPublic(await resource('{"name":"a page, while offline"}'), 'resource')
    await waitFor(() => (service.swarmHostsFor(null).passedOver ?? []).includes('hypercomb.com'))
    expect(session.has(DOWN_KEY)).toBe(false)
    EffectBus.emit('mesh:connection', { state: 'open', reopened: true })
    expect(service.swarmHostsFor(null).hosts).toEqual(['hypercomb.com'])
  })
})

// ── (B) a blocked upload from a host that answered is a refusal ───────────

describe('(B) an upload the CORS preflight blocks is a refusal — on evidence, at its second blocked upload', () => {
  const corsHeap = (): Host => {
    // Answers every HEAD as a heap does (404), lets no PUT out of the browser.
    const fetch: FetchMock = vi.fn(async (_input: string, init?: RequestInit): Promise<Response> => {
      if ((init?.method ?? 'GET') === 'PUT') throw new TypeError('Failed to fetch')
      return new Response(null, { status: 404 })
    })
    return { fetch, held: new Map() }
  }

  /** Three tiles: more than one upload, as any real page has. */
  const three = async (service: Service, label: string): Promise<string[]> => {
    const sigs = [await resource(`{"name":"${label} one"}`), await resource(`{"name":"${label} two"}`), await resource(`{"name":"${label} three"}`)]
    for (const s of sigs) await service.markPublic(s, 'resource')
    return sigs
  }

  it('a pool host whose HEAD answered and whose uploads never left — and that still answers a HEAD — is refused and passed over at its second blocked upload, for this page only', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    const apex = corsHeap()
    const relay = heap()
    vi.stubGlobal('fetch', router({ 'hypercomb.com': apex, 'jwize.com': relay }))
    const state = listen<{ host: string; status: string; reason: string; why?: string }>('sync:state')
    const service = await make()
    const sigs = await three(service, 'blocked at the preflight')
    // The first blocked upload alone could be one error page: it waits one
    // ladder step (2 s). The second, with the host still answering a HEAD,
    // decides — a refusal, never the silent host's two whole failure waves.
    for (let step = 0; step < 40 && calls(relay, 'PUT').length < sigs.length; step++) { await vi.advanceTimersByTimeAsync(100); await settle() }
    expect(calls(apex, 'PUT').length).toBeGreaterThanOrEqual(2)
    expect(calls(relay, 'PUT').sort()).toEqual(sigs.map(s => `https://jwize.com/${s}`).sort())
    expect(state.seen.find(p => p.host === 'hypercomb.com' && p.status === 'refused')).toMatchObject({ why: 'refused' })
    expect(service.hostTrouble('hypercomb.com')).toMatchObject({ status: 'refused', why: 'refused' })
    expect(service.swarmHostsFor(null)).toMatchObject({ hosts: ['jwize.com'], source: 'relay', passedOver: ['hypercomb.com'] })
    // Read from the browser's side, so a network that changed under the
    // uploads would read the same: never remembered past this page…
    expect(session.has(DOWN_KEY)).toBe(false)
    // …and given back when the socket comes back.
    EffectBus.emit('mesh:connection', { state: 'open', reopened: true })
    expect(service.swarmHostsFor(null).hosts).toEqual(['hypercomb.com'])
    state.off()
  })

  it('one upload that never left while the others reached the host is no block: not refused, not passed over', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    const apexHeap = heap()
    let errorPageOnce = true
    const apex: Host = {
      fetch: vi.fn(async (input: string, init?: RequestInit) => {
        // The edge's one CORS-less error page (a worker exception) — once.
        if ((init?.method ?? 'GET') === 'PUT' && errorPageOnce) { errorPageOnce = false; throw new TypeError('Failed to fetch') }
        return apexHeap.fetch(input, init)
      }),
      held: apexHeap.held,
    }
    const relay = heap()
    vi.stubGlobal('fetch', router({ 'hypercomb.com': apex, 'jwize.com': relay }))
    const state = listen<{ host: string; status: string }>('sync:state')
    const service = await make()
    const sigs = await three(service, 'one error page')
    for (let step = 0; step < 40 && (await queued()).length > 0; step++) { await vi.advanceTimersByTimeAsync(250); await settle() }
    expect((await queued()).length).toBe(0)
    expect([...apexHeap.held.keys()]).toEqual(expect.arrayContaining(sigs))
    expect(state.seen.some(p => p.host === 'hypercomb.com' && p.status === 'refused')).toBe(false)
    expect(relay.fetch).not.toHaveBeenCalled()
    expect(service.swarmHostsFor(null)).toEqual({ hosts: ['hypercomb.com'], source: 'pool', pending: false })
    state.off()
  })

  it('the network dropped under the uploads (the HEAD after them gets no answer either): unreachable, never refused, never remembered', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    let down = false
    const apex: Host = {
      fetch: vi.fn(async (_input: string, init?: RequestInit): Promise<Response> => {
        if (down) throw new TypeError('Failed to fetch')
        if ((init?.method ?? 'GET') === 'PUT') { down = true; throw new TypeError('Failed to fetch') }
        return new Response(null, { status: 404 })
      }),
      held: new Map(),
    }
    const relay = heap()
    vi.stubGlobal('fetch', router({ 'hypercomb.com': apex, 'jwize.com': relay }))
    const state = listen<{ host: string; status: string }>('sync:state')
    const service = await make()
    await three(service, 'the wifi dropped')
    await advanceUntil(() => state.seen.some(p => p.host === 'hypercomb.com' && p.status === 'unreachable'), 50)
    expect(state.seen.some(p => p.host === 'hypercomb.com' && p.status === 'unreachable')).toBe(true)
    for (let step = 0; step < 4; step++) { await vi.advanceTimersByTimeAsync(100); await settle() }
    // The first wave: on the ladder, still the room's host.
    expect(state.seen.some(p => p.host === 'hypercomb.com' && p.status === 'refused')).toBe(false)
    expect(service.swarmHostsFor(null).hosts).toEqual(['hypercomb.com'])
    // Silent on the next wave too (the ladder's rule passes it over) — still
    // weak evidence: this page's only, a reload asks it again.
    for (let step = 0; step < 40 && !(service.swarmHostsFor(null).passedOver ?? []).length; step++) { await vi.advanceTimersByTimeAsync(250); await settle() }
    expect(service.swarmHostsFor(null).passedOver).toEqual(['hypercomb.com'])
    expect(state.seen.some(p => p.host === 'hypercomb.com' && p.status === 'refused')).toBe(false)
    expect(session.has(DOWN_KEY)).toBe(false)
    state.off()
  })

  it('a tab the browser says is offline is never refused', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const apex = corsHeap()
    vi.stubGlobal('fetch', router({ 'hypercomb.com': apex, 'jwize.com': heap() }))
    const state = listen<{ host: string; status: string; why?: string }>('sync:state')
    const service = await make()
    await three(service, 'offline by the browser')
    await advanceUntil(() => state.seen.some(p => p.host === 'hypercomb.com' && p.status === 'unreachable'), 50)
    expect(state.seen.some(p => p.host === 'hypercomb.com' && p.status === 'unreachable')).toBe(true)
    for (let step = 0; step < 4; step++) { await vi.advanceTimersByTimeAsync(100); await settle() }
    expect(state.seen.some(p => p.host === 'hypercomb.com' && p.status === 'refused')).toBe(false)
    expect(state.seen.filter(p => p.host === 'hypercomb.com').pop()).toMatchObject({ why: 'unreachable' })
    state.off()
  })

  it('with no socket open it is the path, not the host: unreachable, on the ladder, not passed over', async () => {
    meshState('offline')
    const apex = corsHeap()
    const relay = heap()
    vi.stubGlobal('fetch', router({ 'hypercomb.com': apex, 'jwize.com': relay }))
    const state = listen<{ host: string; status: string }>('sync:state')
    const service = await make()
    const s = await resource('{"name":"offline, maybe"}')
    await service.markPublic(s, 'resource')
    await waitFor(() => state.seen.some(p => p.host === 'hypercomb.com' && p.status === 'unreachable'))
    expect(state.seen.some(p => p.host === 'hypercomb.com' && p.status === 'refused')).toBe(false)
    expect(service.swarmHostsFor(null)).toEqual({ hosts: ['hypercomb.com'], source: 'pool', pending: false })
    expect(relay.fetch).not.toHaveBeenCalled()
    state.off()
  })
})

// ── (C) this tab remembers ─────────────────────────────────────────────────

describe('(C) a pass-over survives a reload of this tab — bounded, within the hour', () => {
  const warmed = async (): Promise<ResolverLike> => {
    const r = new Resolver(deps)
    r.warm(null)
    await settle(10)
    return r
  }

  it('a reload keeps it; a receipt (markUp) or a retry (clearDown) forgets it — in this page and the next', async () => {
    const first = await warmed()
    first.markDown('hypercomb.com', 'hypercomb.com answers a page — takes no uploads')
    expect(session.has(DOWN_KEY)).toBe(true)
    const reloaded = await warmed()
    expect(reloaded.hostsFor(null)).toEqual({ hosts: ['jwize.com'], source: 'relay', pending: false, passedOver: ['hypercomb.com'] })
    expect(reloaded.downReason('hypercomb.com')).toContain('answers a page')

    reloaded.markUp('hypercomb.com')
    expect(session.has(DOWN_KEY)).toBe(false)
    expect((await warmed()).hostsFor(null).hosts).toEqual(['hypercomb.com'])

    const again = await warmed()
    again.markDown('hypercomb.com', 'refused')
    again.clearDown()
    expect(session.has(DOWN_KEY)).toBe(false)
    expect((await warmed()).hostsFor(null).hosts).toEqual(['hypercomb.com'])
  })

  it('an hour later it is asked again; only the newest few are kept; a path-time failure is this page\'s only', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const r = await warmed()
    r.markDown('hypercomb.com', 'refused')
    vi.setSystemTime(Date.now() + 59 * 60_000)
    expect((await warmed()).hostsFor(null).passedOver).toEqual(['hypercomb.com'])
    vi.setSystemTime(Date.now() + 2 * 60_000)
    expect((await warmed()).hostsFor(null)).toEqual({ hosts: ['hypercomb.com'], source: 'pool', pending: false })

    session.clear()
    const many = await warmed()
    for (let i = 0; i < 12; i++) { vi.setSystemTime(Date.now() + 1_000); many.markDown(`host${i}.example`, 'refused') }
    const rows = JSON.parse(session.get(DOWN_KEY)!) as [string, string, number][]
    expect(rows.map(row => row[0])).toEqual([11, 10, 9, 8, 7, 6, 5, 4].map(i => `host${i}.example`))

    session.clear()
    const offline = await warmed()
    offline.markDown('hypercomb.com', 'unreachable', false)
    expect(offline.hostsFor(null).passedOver).toEqual(['hypercomb.com'])
    expect(session.has(DOWN_KEY)).toBe(false)
  })

  it('it lives in THIS TAB\'s sessionStorage — never localStorage, never another tab', () => {
    expect(liveSession?.()).toBe(globalThis.sessionStorage)
    const r = new Resolver({ ...deps, session: () => globalThis.sessionStorage })
    r.markDown('hypercomb.com', 'refused')
    expect(globalThis.sessionStorage.getItem(DOWN_KEY)).toContain('hypercomb.com')
    expect(localStorage.getItem(DOWN_KEY)).toBeNull()
    r.clearDown()
    expect(globalThis.sessionStorage.getItem(DOWN_KEY)).toBeNull()
  })

  it('a reload keeps the relay as the room\'s host: the page-answering apex is not asked again', async () => {
    const apex = pageSite()
    const relay = heap()
    vi.stubGlobal('fetch', router({ 'hypercomb.com': apex, 'jwize.com': relay }))
    const before = await make()
    await before.markPublic(await resource('{"name":"before the reload"}'), 'resource')
    await waitFor(async () => calls(relay, 'PUT').length === 1 && (await queued()).length === 0)
    apex.fetch.mockClear()

    const after = await make() // the reload: a new resolver over the same tab session
    expect(after.swarmHostsFor(null)).toEqual({ hosts: ['jwize.com'], source: 'relay', pending: false, passedOver: ['hypercomb.com'] })
    // …and still knows why: a page, not a name that reaches nothing.
    expect(after.hostTrouble('hypercomb.com')).toMatchObject({ host: 'hypercomb.com', why: 'page' })
    const s = await resource('{"name":"after the reload"}')
    await after.markPublic(s, 'resource')
    await waitFor(async () => calls(relay, 'PUT').length === 2 && (await queued()).length === 0)
    expect(apex.fetch).not.toHaveBeenCalled()
  })

  it('a receipt from it gives it back — the pool\'s primary again, and nothing left to remember', async () => {
    marks = new Map([['shop', ['hypercomb.com']]]) // the apex is also the shop's chosen domain
    let fixed = false
    const site = pageSite()
    const apexHeap = heap()
    const apex: Host = { fetch: vi.fn(async (input: string, init?: RequestInit) => (fixed ? apexHeap : site).fetch(input, init)), held: apexHeap.held }
    const relay = heap()
    vi.stubGlobal('fetch', router({ 'hypercomb.com': apex, 'jwize.com': relay }))
    const service = await make(['shop'])
    await service.markPublic(await resource('{"name":"a root tile"}'), 'resource')
    await waitFor(async () => calls(relay, 'PUT').length === 1 && (await queued()).length === 0)
    expect(service.swarmHostsFor(null).source).toBe('relay')
    expect(session.has(DOWN_KEY)).toBe(true) // a reload now would keep it

    fixed = true // the apex is routed through a worker that takes signed writes
    const jar = await resource('{"name":"on the shop, at its chosen domain"}')
    await service.markPublic(jar, 'resource', true, ['shop'])
    await waitFor(async () => (await receipts()).includes(`${jar}.${await hostHash('hypercomb.com')}`))
    expect(service.swarmHostsFor(null)).toEqual({ hosts: ['hypercomb.com'], source: 'pool', pending: false })
    expect(session.has(DOWN_KEY)).toBe(false)
    // The page it once answered no longer describes it: a later, passing
    // failure is that failure — never "answers with a web page" — and its
    // HEAD-before-PUT check is back (no re-upload of what it holds).
    expect(service.hostTrouble('hypercomb.com')).toBeNull()
    const state = listen<{ host: string; status: string; why?: string }>('sync:state')
    apexHeap.fetch.mockImplementation(async (_input: string, init?: RequestInit) =>
      (init?.method === 'PUT' ? new Response('deploying', { status: 503 }) : new Response(null, { status: 404 })))
    const heads = calls(apex, 'HEAD').length
    const lid = await resource('{"name":"a lid, during a deploy"}')
    await service.markPublic(lid, 'resource', true, ['shop'])
    await waitFor(() => state.seen.some(p => p.host === 'hypercomb.com' && p.status === 'unreachable'))
    expect(state.seen.filter(p => p.host === 'hypercomb.com' && p.status === 'unreachable').pop()).toMatchObject({ why: 'unreachable' })
    expect(service.hostTrouble('hypercomb.com')).toMatchObject({ why: 'unreachable' })
    expect(calls(apex, 'HEAD').slice(heads)).toContain(`https://hypercomb.com/${lid}`)
    state.off()
    expect((await make(['shop'])).swarmHostsFor(null).hosts).toEqual(['hypercomb.com']) // and after a reload
  })

  it('only positive evidence is remembered: the host\'s own 4xx is, a full host (it named its own wait) is not', async () => {
    const answering = (put: () => Response): Host => ({
      fetch: vi.fn(async (_input: string, init?: RequestInit) => (init?.method === 'PUT' ? put() : new Response(null, { status: 404 }))),
      held: new Map(),
    })
    vi.stubGlobal('fetch', router({
      'hypercomb.com': answering(() => new Response('slow down', { status: 429, headers: { 'retry-after': '30' } })),
      'jwize.com': heap(),
    }))
    const full = await make()
    await full.markPublic(await resource('{"name":"to a full host"}'), 'resource')
    await waitFor(() => (full.swarmHostsFor(null).passedOver ?? []).includes('hypercomb.com'))
    expect(full.hostTrouble('hypercomb.com')).toMatchObject({ why: 'full' })
    expect(session.has(DOWN_KEY)).toBe(false)

    vi.stubGlobal('fetch', router({
      'hypercomb.com': answering(() => new Response('not on the writers list', { status: 403 })),
      'jwize.com': heap(),
    }))
    const closed = await make()
    await closed.markPublic(await resource('{"name":"to a closed door"}'), 'resource')
    await waitFor(() => session.has(DOWN_KEY))
    expect((await make()).swarmHostsFor(null)).toMatchObject({ hosts: ['jwize.com'], passedOver: ['hypercomb.com'] })
  })

  it('the participant\'s retry forgets it, after a reload too', async () => {
    const apex = pageSite()
    vi.stubGlobal('fetch', router({ 'hypercomb.com': apex, 'jwize.com': heap() }))
    const service = await make()
    await service.markPublic(await resource('{"name":"passed over"}'), 'resource')
    await waitFor(() => service.swarmHostsFor(null).source === 'relay')
    expect(session.has(DOWN_KEY)).toBe(true)
    await service.reDrain()
    expect(session.has(DOWN_KEY)).toBe(false)
    expect((await make()).swarmHostsFor(null).hosts).toEqual(['hypercomb.com'])
  })
})

// ── (D) the first byte never waits on the whole queue ─────────────────────

describe('(D) the drain sends in batches', () => {
  it('3,000 queued entries and a host that never answers: the first PUT and the progress line come within the first batch', async () => {
    join(false) // the operator's own backup host alone
    const receiptsDir = new CountingDir(await poolName('host-receipts'))
    root.children.set(receiptsDir.name, receiptsDir)
    const queue = await root.getDirectoryHandle(await poolName('host-push'), { create: true })
    for (let i = 0; i < 3_000; i++) {
      const bytes = new TextEncoder().encode(`{"name":"tile ${i}"}`)
      const w = await (await queue.getFileHandle(`${await sign(bytes)}.resource`, { create: true })).createWritable()
      await w.write(bytes)
      await w.close()
    }
    // How much of the queue the drain had asked about (one receipt lookup per
    // entry) when it first did something a person can see — the measure that
    // does not depend on how busy the machine is: a full reconcile asks about
    // all 3,000 first; a batch, about 32.
    let firstPut: { lookups: number } | null = null
    const firstProgress: { lookups: number; done: number; total: number }[] = []
    const never = vi.fn(async (_input: string, init?: RequestInit): Promise<Response> => {
      if ((init?.method ?? 'GET') === 'PUT' && !firstPut) firstPut = { lookups: receiptsDir.lookups }
      throw new TypeError('Failed to fetch')
    })
    vi.stubGlobal('fetch', never)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const progress = listen<{ done: number; total: number }>('host-sync:progress')
    const off = EffectBus.on<{ done: number; total: number }>('host-sync:progress', p => {
      if (firstProgress.length === 0) firstProgress.push({ lookups: receiptsDir.lookups, ...p })
    })
    firstProgress.length = 0
    const service = await make()
    localStorage.setItem('hc:nostrmesh:self-domain', 'backup.example.com')
    localStorage.setItem('hc:host-sync:enabled', 'true')

    await service.drain()

    // The first PUT went out after one batch was reconciled — never after
    // the whole queue (a full reconcile looks up all 3,000 receipts first).
    expect(firstPut).not.toBeNull()
    expect(firstPut!.lookups).toBeLessThan(100)
    // The upload is on the line before the queue is reconciled, and its
    // denominator is honest: what the first batch found, plus what is unread.
    expect(firstProgress[0]).toMatchObject({ done: 0, total: 3_000 })
    expect(firstProgress[0]!.lookups).toBeLessThan(100)
    // The host is paused: the pass stops, and the line does not go on
    // promising the entries it left for the next.
    const last = progress.seen.at(-1)!
    expect(last.done).toBe(last.total)
    // Never a HEAD per queued entry: the held-probe breaker, a batch at a time.
    expect(never.mock.calls.filter(([, init]) => init?.method === 'HEAD').length).toBeLessThanOrEqual(32)
    expect((await queued()).length).toBe(3_000)
    progress.off()
    off()
    warn.mockRestore()
  }, 60_000) // staging 3,000 signed entries is the slow part, never the drain

  it('a host whose first entry sits behind another host\'s backlog is asked in the first batch, not after the backlog', async () => {
    // The pool's apex is taking a big backlog (held at a gate so the whole
    // queue is staged first); then `favorites` is given its publish domain —
    // a typo that reaches nothing. Its first request must not wait for 200
    // uploads to the apex: until it fails, nothing true can be said of it.
    // (Its own typo: this test's service keeps retrying it after the test.)
    marks = new Map([['favorites', ['hypercmob.com']]])
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const apexHeap = heap()
    const apex: Host = { fetch: vi.fn(async (input: string, init?: RequestInit) => { await gate; return apexHeap.fetch(input, init) }), held: apexHeap.held }
    const typo = nowhere()
    let apexPutsBeforeTypo = -1
    const asked: Host = {
      fetch: vi.fn(async (input: string, init?: RequestInit) => {
        if (apexPutsBeforeTypo < 0) apexPutsBeforeTypo = calls(apex, 'PUT').length
        return typo.fetch(input, init)
      }),
      held: typo.held,
    }
    vi.stubGlobal('fetch', router({ 'hypercomb.com': apex, 'hypercmob.com': asked }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const service = await make(['favorites'])
    for (let i = 0; i < 200; i++) await service.markPublic(await resource(`{"name":"backlog ${i}"}`), 'resource')
    await service.markPublic(await resource('{"name":"a favourite"}'), 'resource', true, ['favorites'])
    release()
    await waitFor(() => apexPutsBeforeTypo >= 0, 20_000)
    // A batch is 32: without its canary the typo is asked after ~192 uploads.
    expect(apexPutsBeforeTypo).toBeLessThan(40)
    warn.mockRestore()
  }, 60_000)
})

// ── (E) a host that can never take a write is named, with why ─────────────

describe('(E) a publish domain that cannot take writes says so, never passed over', () => {
  it('a name that reaches nothing (`hyperccomb.com`): unresolved — "check the host name, and that it is running"', async () => {
    marks = new Map([['favorites', ['hyperccomb.com']]])
    const typo = nowhere()
    const apex = heap()
    vi.stubGlobal('fetch', router({ 'hyperccomb.com': typo, 'hypercomb.com': apex }))
    const state = listen<{ host: string; status: string; why?: string; swarm: boolean }>('sync:state')
    const service = await make(['favorites'])
    const pic = await resource('{"name":"a favourite picture"}')
    await service.markPublic(pic, 'resource', true, ['favorites'])
    await waitFor(() => service.hostTrouble('hyperccomb.com') !== null)
    expect(state.seen.filter(p => p.host === 'hyperccomb.com').pop()).toMatchObject({ status: 'unreachable', why: 'unresolved', swarm: true })
    expect(service.hostTrouble('hyperccomb.com')).toMatchObject({ host: 'hyperccomb.com', why: 'unresolved' })
    expect(service.hostTrouble('https://hyperccomb.com/')).toMatchObject({ why: 'unresolved' })
    // Still the branch's host: a publish domain is never passed over.
    expect(service.swarmHostsFor(['favorites'])).toEqual({ hosts: ['hyperccomb.com'], source: 'publish', pending: false })
    expect(service.hostTrouble('hypercomb.com')).toBeNull()
    state.off()
  })

  it('a refusal is `refused`; silence with no socket open is plain `unreachable`, never "check the host name"', async () => {
    marks = new Map([['club', ['closed.example']], ['far', ['far.example']]])
    const closed: Host = { fetch: vi.fn(async (_i: string, init?: RequestInit) => (init?.method === 'PUT' ? new Response('not on the writers list', { status: 403 }) : new Response(null, { status: 404 }))), held: new Map() }
    vi.stubGlobal('fetch', router({ 'closed.example': closed, 'far.example': nowhere(), 'hypercomb.com': heap() }))
    const state = listen<{ host: string; status: string; why?: string }>('sync:state')
    const service = await make(['club'], ['far'])
    await service.markPublic(await resource('{"name":"a member card"}'), 'resource', true, ['club'])
    await waitFor(() => state.seen.some(p => p.host === 'closed.example' && p.status === 'refused'))
    expect(service.hostTrouble('closed.example')).toMatchObject({ why: 'refused', reason: '403 not on the writers list' })
    expect(service.swarmHostsFor(['club']).hosts).toEqual(['closed.example'])

    meshState('offline')
    const offline = await make(['far'])
    await offline.markPublic(await resource('{"name":"far away"}'), 'resource', true, ['far'])
    await waitFor(() => state.seen.some(p => p.host === 'far.example' && p.status === 'unreachable'))
    expect(offline.hostTrouble('far.example')).toMatchObject({ why: 'unreachable' })
    state.off()
  })

  it('a host that timed out, or a tab the browser says is offline, is plain `unreachable` — never "check the host name"', async () => {
    // Hosts no other test names: a service from an earlier test keeps
    // retrying ITS hosts after it, and speaks on the same bus.
    marks = new Map([['slow', ['slow.example']], ['away', ['away.example']]])
    // Something took the connection and never answered: our own deadline.
    const slow: Host = { fetch: vi.fn(async () => { throw new DOMException('The operation was aborted.', 'AbortError') }), held: new Map() }
    vi.stubGlobal('fetch', router({ 'slow.example': slow, 'away.example': nowhere(), 'hypercomb.com': heap() }))
    const state = listen<{ host: string; status: string; why?: string }>('sync:state')
    const service = await make(['slow'])
    await service.markPublic(await resource('{"name":"a slow shelf"}'), 'resource', true, ['slow'])
    await waitFor(() => service.hostTrouble('slow.example') !== null)
    expect(state.seen.filter(p => p.host === 'slow.example').pop()).toMatchObject({ status: 'unreachable', why: 'unreachable' })
    expect(service.hostTrouble('slow.example')).toMatchObject({ why: 'unreachable', reason: 'timed out' })

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const offline = await make(['away'])
    await offline.markPublic(await resource('{"name":"away, offline"}'), 'resource', true, ['away'])
    await waitFor(() => offline.hostTrouble('away.example') !== null)
    expect(state.seen.filter(p => p.host === 'away.example').pop()).toMatchObject({ status: 'unreachable', why: 'unreachable' })
    expect(offline.hostTrouble('away.example')).toMatchObject({ why: 'unreachable' })
    state.off()
  })
})

// ── the first probe goes alone, but only the first ─────────────────────────

describe('(A) the first probe of a host goes alone — and only the first', () => {
  it('a host that never answers its first probe is not asked one entry at a time after it', async () => {
    // NXDOMAIN: the first probe fails; the rest of the batch then goes at
    // once (the four slots), never queued one behind the other.
    let inFlight = 0
    let most = 0
    const gone: Host = {
      held: new Map(),
      fetch: vi.fn(async (_input: string, init?: RequestInit): Promise<Response> => {
        if ((init?.method ?? 'GET') === 'HEAD') {
          inFlight++; most = Math.max(most, inFlight)
          await new Promise(r => setTimeout(r, 20))
          inFlight--
        }
        throw new TypeError('Failed to fetch')
      }),
    }
    vi.stubGlobal('fetch', router({ 'hypercomb.com': gone, 'jwize.com': heap() }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { service } = await stageThenLand(6, 'unanswered')
    await service.drain()
    // The pass is over once it has tried the push (and failed it).
    await waitFor(() => calls(gone, 'PUT').length > 0)
    expect(calls(gone, 'HEAD').length).toBeGreaterThan(1)
    expect(most).toBeGreaterThan(1)
    warn.mockRestore()
    // (This service keeps retrying the name on its ladder after the test —
    // last in the file, so nothing after it shares its fetch.)
  })
})
