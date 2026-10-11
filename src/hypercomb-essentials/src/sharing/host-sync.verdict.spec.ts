// host-sync.verdict.spec.ts — THE GATE SAYS WHY, AND STOPS WAITING ON A HOST
// THAT CAN NEVER TAKE THE BYTES (the 2026-10-10 long-tail hunt, lane L1).
//
//   BCL-1 / D2  a branch whose publish domain refuses (405) or never answers
//               (a typo: NXDOMAIN) no longer holds its subtree as names: the
//               domain is passed over after its uploads' own answer — one
//               PUT for a refusal, three for silence — and the pages go to
//               the pool's host; the domain is named, with why.
//   BCL-2       closureVerdict names what a closure waits on: the host, the
//               page, the atom, the state, the host's own words, the tile.
//   BCL-3 / D1  the TILE-only verdict (deep = false) is ok once the tile's
//               own atoms are served, whatever its subtree still waits on.
//   BCL-8       an atom a host refuses for good (413) is the sharer's own to
//               serve: ownerHeld, the file named — the tile stays takeable.
//   BCL-7/TS-5  not-live from a host this tab does not meet at is a standing
//               refusal after its retries (one PUT a wave, at most six), and
//               the upload to it carries this key's signed {alive} beacon.
//   BCL-4       each entry is asked about and sent in the same breath; a small
//               atom to a host that answers for itself goes without a HEAD;
//               the queue goes shallowest first across every root.
//   BCL-5       a verified deep closure is a receipt: a reload answers it in
//               one lookup, with no walk and no request; markers on disk are
//               not written again.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus, SignatureService } from '@hypercomb/core'

vi.setConfig({ testTimeout: 30_000 })

// ── in-memory OPFS ─────────────────────────────────────────────────────────

const notFound = (name: string): DOMException => new DOMException(`${name} not found`, 'NotFoundError')
let clock = 1_700_000_000_000
/** Writes to a file whose name ends with `.public` (a marker) — BCL-5. */
let markerWrites = 0

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
    if (this.name.endsWith('.public')) markerWrites++
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

// ── IoC ────────────────────────────────────────────────────────────────────

const registry = new Map<string, unknown>()
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registry.set(key, value) },
  get: (key: string) => registry.get(key),
  whenReady: () => undefined,
}

const MESH_KEY = '@diamondcoreprocessor.com/NostrMeshDrone'
const PUBKEY = 'ab'.repeat(32)

type Block = { host: string; page: readonly string[]; sig: string; kind: string; state: string; reason: string; why?: string; name?: string; bytes?: number }
type Verdict = { ok: boolean; ownerHeld: boolean; unknown?: true; blocking?: Block }
type Choice = { hosts: readonly string[]; source: string; pending: boolean; passedOver?: readonly string[] }
type Service = {
  drain: () => Promise<void>
  markPublic: (sig: string, kind?: string, closure?: boolean, page?: readonly string[]) => Promise<void>
  closureVerdict: (sig: string, kind: string, deep: boolean, page: readonly string[], extra?: readonly string[]) => Promise<Verdict>
  isClosureAvailableAt: (sig: string, kind: string, closure: boolean, page: readonly string[]) => Promise<boolean | null>
  swarmHostsFor: (segments: readonly string[] | null) => Choice
  hostTrouble: (host: string) => { host: string; status: string; why: string; reason: string } | null
}
let HostSync: new (resolver?: unknown) => Service
let Resolver: new (deps: unknown) => { warm: (s: readonly string[] | null) => void; downReason: (h: string) => string }

const sign = async (bytes: Uint8Array): Promise<string> => await SignatureService.sign(bytes.slice().buffer as ArrayBuffer)
const poolName = async (meaning: string): Promise<string> => await sign(new TextEncoder().encode(meaning))

let root: MemoryDir
const resources = new Map<string, Uint8Array>()
const layers = new Map<string, Uint8Array>()
/** Local layer reads (the gate's walk) — BCL-5. */
let layerReads = 0

let pool: string[] | null = ['hypercomb.com']
let marks = new Map<string, string[]>()
let participants: unknown = 'all'
let meetingHost = ''
let session = new Map<string, string>()
const deps = {
  readPool: async () => pool,
  readMarks: async (segments: readonly string[]) => marks.get(segments.join('/')) ?? [],
  relay: () => ({ host: 'jwize.com', participants }),
  originLoopback: () => false,
  meetingHost: () => meetingHost,
  session: () => ({
    getItem: (k: string) => session.get(k) ?? null,
    setItem: (k: string, v: string) => { session.set(k, String(v)) },
    removeItem: (k: string) => { session.delete(k) },
  }),
}

const settle = async (turns = 40): Promise<void> => {
  for (let i = 0; i < turns; i++) await new Promise<void>(resolve => setImmediate(resolve))
}

const make = async (...pages: string[][]): Promise<Service> => {
  const resolver = new Resolver(deps)
  resolver.warm(null)
  for (const page of pages) resolver.warm(page)
  await settle(10)
  return new HostSync(resolver)
}

const join = (joined: boolean): void => { EffectBus.emit('mesh:public-changed', { public: joined }) }
const meshState = (state: string): void => { EffectBus.emit('mesh:connection', { state }) }

/** Every Authorization this test's signer signed, decoded (D7). */
let signed: Record<string, unknown>[] = []

beforeAll(async () => {
  registry.set('@diamondcoreprocessor.com/NostrSigner', {
    signEvent: async (event: Record<string, unknown>) => {
      const out = { ...event, id: 'e', pubkey: PUBKEY, sig: 's' }
      signed.push(out)
      return out
    },
    getPublicKeyHex: async () => PUBKEY,
  })
  HostSync = (await import('./host-sync.service.js')).HostSyncService as unknown as typeof HostSync
  Resolver = (await import('./swarm-hosts.js')).SwarmHostResolver as unknown as typeof Resolver
})

beforeEach(() => {
  root = new MemoryDir('')
  resources.clear()
  layers.clear()
  layerReads = 0
  markerWrites = 0
  signed = []
  pool = ['hypercomb.com']
  marks = new Map()
  participants = 'all'
  meetingHost = ''
  session = new Map()
  EffectBus.emit('hosts:render', { open: false, zones: [], loaded: false })
  registry.set('@hypercomb.social/Store', {
    opfsRoot: root,
    getResourceLocal: async (s: string) => {
      const b = resources.get(s)
      return b ? { size: b.byteLength, arrayBuffer: async () => b.slice().buffer } : null
    },
    getLayerPoolBytes: async (s: string) => { const b = layers.get(s); if (b) layerReads++; return b?.slice() ?? null },
  })
  registry.set(MESH_KEY, { swarmHost: () => 'jwize.com' })
  registry.delete('@hypercomb.social/RoomStore')
  registry.delete('@hypercomb.social/SecretStore')
  localStorage.clear()
  localStorage.setItem('hc:nostrmesh:self-domain', 'hypercomb.io')
  meshState('open')
  join(true)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ── content ────────────────────────────────────────────────────────────────

const resource = async (bytes: Uint8Array | string): Promise<string> => {
  const b = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes
  const s = await sign(b)
  resources.set(s, b)
  return s
}

const layer = async (record: Record<string, unknown>): Promise<string> => {
  const bytes = new TextEncoder().encode(JSON.stringify(record))
  const s = await sign(bytes)
  layers.set(s, bytes)
  return s
}

/** A tile: its layer, a properties record and the picture the record names. */
const tile = async (name: string, children: string[] = [], picture?: Uint8Array): Promise<{ sig: string; props: string; pic: string }> => {
  const pic = await resource(picture ?? `picture of ${name}`)
  const props = await resource(JSON.stringify({ small: { image: pic } }))
  const sig = await layer({ name, properties: [props], children })
  return { sig, props, pic }
}

const queued = async (): Promise<string[]> => {
  const dir = root.children.get(await poolName('host-push'))
  return dir?.kind === 'directory' ? dir.names().filter(n => !n.endsWith('.public')) : []
}

const receipts = async (): Promise<string[]> => {
  const dir = root.children.get(await poolName('host-receipts'))
  return dir?.kind === 'directory' ? dir.names() : []
}

const waitFor = async (pred: () => boolean | Promise<boolean>, ms = 15_000): Promise<void> => {
  const start = Date.now()
  while (!(await pred())) {
    if (Date.now() - start > ms) throw new Error('timed out waiting')
    await new Promise(r => setTimeout(r, 5))
    await settle(5)
  }
}

/** Fake timers: step the clock until `pred` holds (or the steps run out). */
const advanceUntil = async (pred: () => boolean | Promise<boolean>, stepMs = 250, steps = 240): Promise<void> => {
  for (let i = 0; i < steps && !(await pred()); i++) { await vi.advanceTimersByTimeAsync(stepMs); await settle() }
}

// ── hosts ──────────────────────────────────────────────────────────────────

type FetchMock = ReturnType<typeof vi.fn<(input: string, init?: RequestInit) => Promise<Response>>>
type Host = { fetch: FetchMock; held: Map<string, Uint8Array> }

/** A heap: bytes or 404 on a HEAD; a signed PUT is hashed, kept, and answered
 *  `stored <sig>` — over `maxBody` it is the relay's 413. */
const heap = (options: { maxBody?: number; delayMs?: number; putStatus?: (sig: string, init?: RequestInit) => Response | null } = {}): Host => {
  const held = new Map<string, Uint8Array>()
  const fetch: FetchMock = vi.fn(async (input: string, init?: RequestInit): Promise<Response> => {
    if (options.delayMs) await new Promise(r => setTimeout(r, options.delayMs))
    const sig = new URL(String(input)).pathname.slice(1)
    const method = init?.method ?? 'GET'
    if (method === 'PUT') {
      const forced = options.putStatus?.(sig, init)
      if (forced) return forced
      const body = new Uint8Array(init?.body as ArrayBuffer)
      if (options.maxBody !== undefined && body.byteLength > options.maxBody) {
        return new Response(`blob over ${Math.round(options.maxBody / 1_048_576)} MB participant limit`, { status: 413 })
      }
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

/** A static door that takes no uploads: HEAD 404, PUT 405 (refuse.localhost). */
const staticDoor = (): Host => {
  const fetch: FetchMock = vi.fn(async (_input: string, init?: RequestInit): Promise<Response> =>
    (init?.method ?? 'GET') === 'PUT' ? new Response('Method Not Allowed', { status: 405 }) : new Response(null, { status: 404 }))
  return { fetch, held: new Map() }
}

/** A name that reaches nothing (NXDOMAIN): every request fails in the browser. */
const nowhere = (): Host => {
  const fetch: FetchMock = vi.fn(async (): Promise<Response> => { throw new TypeError('Failed to fetch') })
  return { fetch, held: new Map() }
}

const router = (byHost: Record<string, Host>): FetchMock => vi.fn(async (input: string, init?: RequestInit): Promise<Response> => {
  const host = byHost[new URL(String(input)).host]
  if (!host) throw new TypeError('Failed to fetch')
  return host.fetch(input, init)
})

const calls = (host: Host, method: string): string[] =>
  host.fetch.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === method).map(([url]) => String(url))

/** The NIP-98 event an Authorization header carries. */
const authEvent = (init?: RequestInit): { tags: string[][] } => {
  const header = String((init?.headers as Record<string, string> | undefined)?.['Authorization'] ?? '')
  return JSON.parse(decodeURIComponent(escape(atob(header.replace(/^Nostr /, ''))))) as { tags: string[][] }
}

// ── (1) the tile first, the subtree after (D1, BCL-3) ──────────────────────

describe('the tile-only verdict is ok once the tile\'s own atoms are served', () => {
  it('deep = false: ok; deep = true: waiting on the child page, named — host, page, atom, tile', async () => {
    const child = await tile('a')
    const big = await tile('big', [child.sig])
    // The tile's own atoms are on the pool host already (receipts on file);
    // its child is not — and nothing at all may be asked of the network.
    const fetch = vi.fn(async (): Promise<Response> => { throw new TypeError('no network in this test') })
    vi.stubGlobal('fetch', fetch)
    const service = await make(['big'])
    const hash = (await sign(new TextEncoder().encode('hypercomb.com'))).slice(0, 16)
    const dir = await root.getDirectoryHandle(await poolName('host-receipts'), { create: true })
    for (const s of [big.sig, big.props, big.pic]) {
      const w = await (await dir.getFileHandle(`${s}.${hash}`, { create: true })).createWritable()
      await w.write(new Uint8Array(0)); await w.close()
    }
    expect(await service.closureVerdict(big.sig, 'layer', false, [])).toEqual({ ok: true, ownerHeld: false })
    const deep = await service.closureVerdict(big.sig, 'layer', true, [])
    expect(deep).toMatchObject({ ok: false, ownerHeld: false })
    expect(deep.blocking).toMatchObject({ host: 'hypercomb.com', page: ['big'], sig: child.sig, kind: 'layer', state: 'syncing', name: 'a' })
    expect(deep.blocking!.bytes).toBeGreaterThan(0)
    expect(await service.isClosureAvailableAt(big.sig, 'layer', true, [])).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('a page whose hosts are still being read is unknown — never "no"', async () => {
    const t = await tile('waiting')
    let land!: () => void
    const landed = new Promise<void>(resolve => { land = resolve })
    const readPool = deps.readPool
    deps.readPool = async () => { await landed; return pool }
    try {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('no network') }))
      const service = await make()
      const v = await service.closureVerdict(t.sig, 'layer', false, [])
      expect(v).toMatchObject({ ok: false, ownerHeld: false, unknown: true })
      expect(v.blocking).toMatchObject({ state: 'pending' })
      expect(await service.isClosureAvailableAt(t.sig, 'layer', false, [])).toBeNull()
    } finally { land(); deps.readPool = readPool }
  })
})

// ── (2) a file a host will never take is the sharer's to serve (BCL-8) ─────

describe('an atom refused for good is ownerHeld, the file named — the tile stays takeable', () => {
  it('DRILL: a 9 MB picture under a public branch on a participant key (8 MB atom limit)', async () => {
    const nine = new Uint8Array(9 * 1_048_576)
    for (let i = 0; i < nine.length; i += 4096) nine[i] = i % 251
    const beach = await tile('beach', [], nine)
    const gallery = await tile('gallery', [beach.sig])
    const relay = heap({ maxBody: 8 * 1_048_576 })
    vi.stubGlobal('fetch', router({ 'hypercomb.com': relay }))
    const service = await make()
    await service.markPublic(gallery.sig, 'layer', true, [])
    // Everything else lands; the picture is answered 413 once and never sent again.
    await waitFor(async () => (await queued()).length === 0 && relay.held.size === 5)
    expect(calls(relay, 'PUT').filter(u => u.endsWith(beach.pic))).toHaveLength(1)
    // The tile — its layer, properties and picture — is takeable now.
    expect(await service.closureVerdict(gallery.sig, 'layer', false, [])).toEqual({ ok: true, ownerHeld: false })
    // Its subtree is held by the owner alone, and the line can say exactly what.
    const deep = await service.closureVerdict(gallery.sig, 'layer', true, [])
    expect(deep.ok).toBe(false)
    expect(deep.ownerHeld).toBe(true)
    expect(deep.blocking).toMatchObject({
      host: 'hypercomb.com', page: ['gallery'], sig: beach.pic, kind: 'resource',
      state: 'too-large', name: 'beach', bytes: 9 * 1_048_576,
    })
    expect(deep.blocking!.reason).toMatch(/^413 blob over 8 MB/)
  })

  it('one atom held by the owner and another still on its way: not ownerHeld — the one on its way is named', async () => {
    const huge = new Uint8Array(3_000)
    huge[0] = 7
    const pic = await resource(huge)
    const notes = await resource('{"note":"on its way"}')
    const t = await layer({ name: 'mixed', properties: [pic, notes] })
    const host = heap({
      maxBody: 2_000,
      putStatus: (sig) => (sig === notes ? new Response('deploying', { status: 503 }) : null),
    })
    vi.stubGlobal('fetch', router({ 'hypercomb.com': host }))
    const service = await make()
    await service.markPublic(t, 'layer', false, [])
    await waitFor(async () => calls(host, 'PUT').some(u => u.endsWith(notes)) && calls(host, 'PUT').some(u => u.endsWith(pic)))
    await waitFor(async () => (await service.closureVerdict(t, 'layer', false, [])).blocking?.sig === notes)
    const v = await service.closureVerdict(t, 'layer', false, [])
    expect(v).toMatchObject({ ok: false, ownerHeld: false })
    expect(v.blocking).toMatchObject({ sig: notes, state: 'unreachable', host: 'hypercomb.com' })
  })

  it('a host that refuses every upload, or is full, with no door after it: ownerHeld, its own words', async () => {
    participants = false // the relay takes nobody: nothing to fall through to
    for (const [status, body, state] of [[403, 'participants-closed', 'refused'], [429, 'over the day\'s quota', 'full']] as const) {
      const t = await tile(`to a ${state} host`)
      const door: Host = heap({ putStatus: () => new Response(body, { status, headers: status === 429 ? { 'retry-after': '3600' } : {} }) })
      vi.stubGlobal('fetch', router({ 'hypercomb.com': door }))
      const service = await make()
      await service.markPublic(t.sig, 'layer', false, [])
      await waitFor(async () => (await service.closureVerdict(t.sig, 'layer', false, [])).ownerHeld)
      const v = await service.closureVerdict(t.sig, 'layer', false, [])
      expect(v).toMatchObject({ ok: false, ownerHeld: true })
      expect(v.blocking).toMatchObject({ host: 'hypercomb.com', state, reason: `${status} ${body}` })
      // One wave, one upload: the first goes alone and its answer pauses the host.
      expect(calls(door, 'PUT')).toHaveLength(1)
    }
  })
})

// ── (3) a publish domain that can never take the bytes stops gating (D2) ───

describe('BCL-1 / D2: the swarm stops waiting on a publish domain that refuses or never answers', () => {
  /** smoke1's long-tail roots: <root>/c01 publishes at `door`. */
  const longTail = async (rootName: string, door: string): Promise<{ root: string; grand: string[] }> => {
    marks = new Map([[`${rootName}/c01`, [door]]])
    const grand = [(await tile('g1')).sig, (await tile('g2')).sig]
    const c01 = await tile('c01', grand)
    const r = await tile(rootName, [c01.sig])
    return { root: r.sig, grand }
  }

  it('refuse.localhost (HEAD 404, PUT 405): one PUT, passed over, the subtree hosted on the pool — ok, the domain named', async () => {
    const { root: r } = await longTail('lt-refused', 'refuse.example')
    const door = staticDoor()
    const apex = heap()
    vi.stubGlobal('fetch', router({ 'refuse.example': door, 'hypercomb.com': apex }))
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const service = await make(['lt-refused'], ['lt-refused', 'c01'])
    const started = Date.now()
    await service.markPublic(r, 'layer', true, [])
    // The swarm's gate as the swarm asks it today: the whole branch, served.
    await waitFor(async () => (await service.isClosureAvailableAt(r, 'layer', true, [])) === true, 10_000)
    expect(Date.now() - started).toBeLessThan(10_000)
    expect(calls(door, 'PUT')).toHaveLength(1)
    expect(service.swarmHostsFor(['lt-refused', 'c01'])).toEqual({ hosts: ['hypercomb.com'], source: 'pool', pending: false, passedOver: ['refuse.example'] })
    expect(service.hostTrouble('refuse.example')).toMatchObject({ why: 'refused', reason: '405 Method Not Allowed' })
    // Remembered across a reload of this tab: the host's own 4xx.
    expect(session.get('hc:swarm-hosts:down')).toContain('refuse.example')
  })

  it('typo.localhost (NXDOMAIN): at most three uploads, then never-answered — passed over, ok on the pool', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    const { root: r } = await longTail('lt-typo', 'typo.example')
    const typo = nowhere()
    const apex = heap()
    vi.stubGlobal('fetch', router({ 'typo.example': typo, 'hypercomb.com': apex }))
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const service = await make(['lt-typo'], ['lt-typo', 'c01'])
    void service.markPublic(r, 'layer', true, [])
    await advanceUntil(async () => (service.swarmHostsFor(['lt-typo', 'c01']).passedOver ?? []).includes('typo.example'))
    expect(service.swarmHostsFor(['lt-typo', 'c01'])).toEqual({ hosts: ['hypercomb.com'], source: 'pool', pending: false, passedOver: ['typo.example'] })
    expect(service.hostTrouble('typo.example')).toMatchObject({ why: 'unresolved' })
    await advanceUntil(async () => (await queued()).length === 0)
    expect(calls(typo, 'PUT').length).toBeLessThanOrEqual(3)
    vi.useRealTimers()
    expect((await service.closureVerdict(r, 'layer', true, [])).ok).toBe(true)
    // Silence is weak evidence: never remembered past this page.
    expect(session.get('hc:swarm-hosts:down') ?? '').not.toContain('typo.example')
  })

  it('a typo with no door after it: ownerHeld, `never-answered`, the domain named', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    pool = []
    participants = false
    const { root: r } = await longTail('favorites', 'hyperccomb.example')
    const typo = nowhere()
    // The tile itself goes to its page's host: the meeting host.
    meetingHost = 'meet.example'
    const meet = heap()
    vi.stubGlobal('fetch', router({ 'hyperccomb.example': typo, 'meet.example': meet }))
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const service = await make(['favorites'], ['favorites', 'c01'])
    void service.markPublic(r, 'layer', true, [])
    await advanceUntil(async () => (await service.closureVerdict(r, 'layer', true, [])).ownerHeld, 250, 400)
    vi.useRealTimers()
    // Passed over to the meeting host — the subtree is hosted there, after all.
    // (The meeting host is a door below the publish domain.)
    const v = await service.closureVerdict(r, 'layer', true, [])
    expect(v.ok || v.ownerHeld).toBe(true)
    expect(calls(typo, 'PUT').length).toBeLessThanOrEqual(3)
    expect(service.hostTrouble('hyperccomb.example')).toMatchObject({ why: 'unresolved' })
  })
})

// ── (4) not-live from a host this tab does not meet at (BCL-7, TS-5, D7) ───

describe('BCL-7 / TS-5: a host that takes only the people meeting on it', () => {
  const notLive = (accept?: (init?: RequestInit) => boolean): Host => heap({
    putStatus: (_sig, init) => (accept?.(init) ? null : new Response('not-live: join a swarm on this relay first', { status: 401 })),
  })

  it('a pool host answering not-live: at most six uploads (one a wave), then refused — "meeting on it" — and passed over', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    pool = ['hostb.example']
    const b = notLive()
    const relay = heap()
    vi.stubGlobal('fetch', router({ 'hostb.example': b, 'jwize.com': relay }))
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const service = await make()
    const tiles = [await tile('one'), await tile('two'), await tile('three')]
    for (const t of tiles) void service.markPublic(t.sig, 'layer', false, [])
    await advanceUntil(() => (service.swarmHostsFor(null).passedOver ?? []).includes('hostb.example'), 250, 120)
    expect(service.swarmHostsFor(null)).toMatchObject({ hosts: ['jwize.com'], source: 'relay', passedOver: ['hostb.example'] })
    expect(calls(b, 'PUT').length).toBeLessThanOrEqual(6)
    expect(service.hostTrouble('hostb.example')).toMatchObject({ why: 'refused' })
    expect(service.hostTrouble('hostb.example')!.reason).toMatch(/meeting on it/)
    await advanceUntil(async () => (await queued()).length === 0)
    vi.useRealTimers()
    for (const t of tiles) expect((await service.closureVerdict(t.sig, 'layer', false, [])).ok).toBe(true)
  })

  it('a meeting host answering not-live (meeting elsewhere): passed over to the pool, never "waiting to see you live" for ever', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    meetingHost = 'relayjs.example'
    const b = notLive()
    const apex = heap()
    vi.stubGlobal('fetch', router({ 'relayjs.example': b, 'hypercomb.com': apex }))
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const service = await make()
    const t = await tile('at the meeting')
    void service.markPublic(t.sig, 'layer', false, [])
    await advanceUntil(() => (service.swarmHostsFor(null).passedOver ?? []).includes('relayjs.example'), 250, 120)
    service.swarmHostsFor(null)
    await vi.advanceTimersByTimeAsync(50)
    await settle()
    expect(service.swarmHostsFor(null)).toMatchObject({ hosts: ['hypercomb.com'], source: 'pool', passedOver: ['relayjs.example'] })
    expect(calls(b, 'PUT').length).toBeLessThanOrEqual(6)
    await advanceUntil(async () => (await queued()).length === 0)
    vi.useRealTimers()
    expect((await service.closureVerdict(t.sig, 'layer', false, [])).ok).toBe(true)
  })

  it('D7: after a not-live, its uploads carry this key\'s signed {alive} beacon for the room — a host that reads it takes them', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    registry.set('@hypercomb.social/RoomStore', { value: 'the-room' })
    registry.set('@hypercomb.social/SecretStore', { value: 'the-secret' })
    // The beacon names THIS tab's own zone — recorded at its join — never the
    // stores' pre-fill: join with the pair so the tab records it.
    join(true)
    // (A host no other test names: an earlier test's service keeps its timers.)
    pool = ['hostd7.example']
    // relay.js with D7: a fresh signed 30206 {alive} in the NIP-98 event is the key live.
    const b = notLive(init => authEvent(init).tags.some(tag => tag[0] === 'alive'))
    vi.stubGlobal('fetch', router({ 'hostd7.example': b, 'jwize.com': heap() }))
    const service = await make()
    const t = await tile('beaconed')
    void service.markPublic(t.sig, 'layer', false, [])
    await advanceUntil(async () => b.held.size === 3 && (await queued()).length === 0, 250, 40)
    vi.useRealTimers()
    const puts = b.fetch.mock.calls.filter(([, init]) => init?.method === 'PUT')
    // The first upload carries no beacon (nothing said not-live yet); every
    // one after the 401 does — and the host took them.
    expect(authEvent(puts[0]![1]).tags.some(tag => tag[0] === 'alive')).toBe(false)
    expect(puts.length).toBeLessThanOrEqual(5) // one refused, then the tile's own atoms
    expect(b.held.size).toBe(3)
    expect(service.swarmHostsFor(null)).toEqual({ hosts: ['hostd7.example'], source: 'pool', pending: false })
    const alive = authEvent(puts.at(-1)![1]).tags.find(tag => tag[0] === 'alive')!
    const beacon = JSON.parse(alive[1]!) as { kind: number; pubkey: string; created_at: number; content: string; tags: string[][] }
    const lifecycle = await sign(new TextEncoder().encode('lifecycle\u0000the-room\u0000the-secret'))
    expect(beacon).toMatchObject({ kind: 30206, pubkey: PUBKEY })
    expect(JSON.parse(beacon.content)).toMatchObject({ alive: true })
    expect(beacon.tags).toEqual(expect.arrayContaining([['x', lifecycle], ['d', PUBKEY]]))
    // Signed once for the burst, not once per upload.
    expect(signed.filter(e => e['kind'] === 30206)).toHaveLength(1)
    expect((await service.closureVerdict(t.sig, 'layer', false, [])).ok).toBe(true)
  })

  it('D7: a tab with no zone of its own carries no beacon — the stores\' pre-fill never names a room to a host', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    sessionStorage.removeItem('hc:mesh-zone')
    registry.set('@hypercomb.social/RoomStore', { value: 'last-week' })
    registry.set('@hypercomb.social/SecretStore', { value: 'old-secret' })
    pool = ['hostd7b.example']
    const b = notLive(init => authEvent(init).tags.some(tag => tag[0] === 'alive'))
    vi.stubGlobal('fetch', router({ 'hostd7b.example': b, 'jwize.com': heap() }))
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const service = await make()
    const t = await tile('no zone')
    void service.markPublic(t.sig, 'layer', false, [])
    await advanceUntil(() => calls(b, 'PUT').length >= 3, 250, 40)
    vi.useRealTimers()
    const puts = b.fetch.mock.calls.filter(([, init]) => init?.method === 'PUT')
    expect(puts.length).toBeGreaterThan(1)
    for (const [, init] of puts) expect(authEvent(init).tags.some(tag => tag[0] === 'alive')).toBe(false)
  })
})

// ── (5) the drain (BCL-4, BCL-3 queue order) ───────────────────────────────

describe('BCL-4: each entry asked and sent in the same breath; small atoms without a HEAD', () => {
  /** Stage while the pool is still being read (nothing drains), then land:
   *  the first pass meets a full queue. */
  const stageThenLand = async (stage: (service: Service) => Promise<void>): Promise<Service> => {
    const readPool = deps.readPool
    let land!: () => void
    const landed = new Promise<void>(resolve => { land = resolve })
    deps.readPool = async () => { await landed; return pool }
    try {
      const service = await make()
      await stage(service)
      await settle()
      land()
      await settle()
      return service
    } finally {
      deps.readPool = readPool
    }
  }

  it('the first PUT follows ONE question, not a batch of them — and a host that answers for itself is not asked about small atoms', async () => {
    const apex = heap({ delayMs: 2 })
    vi.stubGlobal('fetch', router({ 'hypercomb.com': apex }))
    let headsBeforeFirstPut = -1
    const watched: FetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (init?.method === 'PUT' && headsBeforeFirstPut < 0) headsBeforeFirstPut = calls(apex, 'HEAD').length
      return apex.fetch(input, init)
    })
    vi.stubGlobal('fetch', router({ 'hypercomb.com': { fetch: watched, held: apex.held } }))
    const sigs: string[] = []
    const service = await stageThenLand(async (s) => {
      for (let i = 0; i < 60; i++) { const r = await resource(`{"name":"small ${i}"}`); sigs.push(r); await s.markPublic(r, 'resource') }
    })
    await service.drain()
    await waitFor(async () => (await queued()).length === 0)
    expect(headsBeforeFirstPut).toBeGreaterThanOrEqual(1)
    expect(headsBeforeFirstPut).toBeLessThanOrEqual(4)
    expect(calls(apex, 'PUT')).toHaveLength(60)
    // Once it answered `stored <sig>`, a 110-byte atom costs one PUT, not a HEAD and a PUT.
    expect(calls(apex, 'HEAD').length).toBeLessThanOrEqual(8)
    expect(calls(apex, 'HEAD').length + calls(apex, 'PUT').length).toBeLessThanOrEqual(68)
  })

  it('a large atom is still asked about first: what the host holds is never sent again', async () => {
    const apex = heap()
    vi.stubGlobal('fetch', router({ 'hypercomb.com': apex }))
    const service = await make()
    const small = await resource('{"name":"first, small"}')
    await service.markPublic(small, 'resource')
    await waitFor(async () => (await queued()).length === 0)
    const big = new Uint8Array(40_000); big[1] = 1
    const held = await resource(big)
    apex.held.set(held, big)
    await service.markPublic(held, 'resource')
    await waitFor(async () => (await queued()).length === 0)
    expect(calls(apex, 'HEAD')).toContain(`https://hypercomb.com/${held}`)
    expect(calls(apex, 'PUT')).not.toContain(`https://hypercomb.com/${held}`)
  })

  it('BCL-3: the queue goes shallowest first ACROSS roots — every tile\'s own atoms before any tile\'s children', async () => {
    const apex = heap()
    vi.stubGlobal('fetch', router({ 'hypercomb.com': apex }))
    const depthOf = new Map<string, number>()
    const note = (t: { sig: string; props: string; pic: string }, d: number): void => { for (const s of [t.sig, t.props, t.pic]) depthOf.set(s, d) }
    const grand = await tile('grand'); note(grand, 2)
    const kid = await tile('kid', [grand.sig]); note(kid, 1)
    const big = await tile('big-root', [kid.sig]); note(big, 0)
    const small = await tile('small-root'); note(small, 0)
    const service = await stageThenLand(async (s) => {
      // The big root is marked FIRST: by the order staged, its whole subtree
      // went before the small root's own picture.
      await s.markPublic(big.sig, 'layer', true, [])
      await s.markPublic(small.sig, 'layer', true, [])
    })
    await service.drain()
    await waitFor(async () => (await queued()).length === 0)
    const order = calls(apex, 'PUT').map(u => depthOf.get(new URL(u).pathname.slice(1)) ?? -1)
    expect(order).toHaveLength(12)
    // Four workers overlap one another's sends, but never across depths by
    // more than the four in flight: sorted by depth within one window.
    expect(order.slice(0, 6).every(d => d === 0)).toBe(true)
    expect(order.slice(-3).every(d => d === 2)).toBe(true)
  })
})

// ── (6) a reload of an already-hosted branch (BCL-5) ───────────────────────

describe('BCL-5: coming back to a branch that is already hosted', () => {
  it('a verified deep closure is a receipt: the reload answers in one lookup — no walk, no request — and writes no marker again', async () => {
    const kids: string[] = []
    for (let i = 0; i < 6; i++) kids.push((await tile(`kid ${i}`, [(await tile(`grandkid ${i}`)).sig])).sig)
    const r = await tile('hosted', kids)
    const apex = heap()
    vi.stubGlobal('fetch', router({ 'hypercomb.com': apex }))
    const before = await make()
    await before.markPublic(r.sig, 'layer', true, [])
    await waitFor(async () => (await queued()).length === 0)
    expect(await before.isClosureAvailableAt(r.sig, 'layer', true, [])).toBe(true)

    // THE RELOAD: a new service and resolver over the same disk and session.
    const requests = vi.fn(async (): Promise<Response> => { throw new TypeError('no network after the reload') })
    vi.stubGlobal('fetch', requests)
    layerReads = 0
    markerWrites = 0
    const after = await make()
    expect(await after.isClosureAvailableAt(r.sig, 'layer', true, [])).toBe(true)
    expect(layerReads).toBe(0)
    expect(requests).not.toHaveBeenCalled()
    const hash = (await sign(new TextEncoder().encode('hypercomb.com'))).slice(0, 16)
    expect(await receipts()).toContain(`${r.sig}.${hash}.closure`)
    expect(await after.closureVerdict(r.sig, 'layer', true, [])).toEqual({ ok: true, ownerHeld: false })
    expect(requests).not.toHaveBeenCalled()
    // The marking walk runs again (it learns the edges), but every marker it
    // finds on disk is kept, not written again.
    await after.markPublic(r.sig, 'layer', true, [])
    await settle()
    expect(markerWrites).toBe(0)
    expect(requests).not.toHaveBeenCalled()
  })
})
