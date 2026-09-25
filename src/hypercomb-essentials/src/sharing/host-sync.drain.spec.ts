// host-sync.drain.spec.ts — THE HOST IS THE TRUTH; the receipt is only a memo
// of it. Before the backup drain sends a byte it asks the host (a HEAD on the
// flat address) whether it already serves each queued sig. A served answer
// mints the receipt and retires the entry unsent; only what the host lacks is
// uploaded, and only that is counted in the "uploading N of M" progress.
//
// The drain reads OPFS through the Store's `opfsRoot` (never
// navigator.storage directly), so the fake root is handed over through IoC.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus, SignatureService } from '@hypercomb/core'

// ── in-memory OPFS ─────────────────────────────────────────────────────────

const notFound = (name: string): DOMException => new DOMException(`${name} not found`, 'NotFoundError')

/** Monotonic mtime so the queue's FIFO-by-mtime order is deterministic. */
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

  async removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
    const found = this.children.get(name)
    if (!found) throw notFound(name)
    if (found.kind === 'directory' && found.children.size > 0 && !options?.recursive) {
      throw new DOMException(`${name} is not empty`, 'InvalidModificationError')
    }
    this.children.delete(name)
  }

  // Snapshot before yielding: the drain removes entries while it walks.
  async *entries(): AsyncGenerator<[string, MemoryDir | MemoryFile]> { yield* [...this.children.entries()] }
  async *keys(): AsyncGenerator<string> { yield* [...this.children.keys()] }
  async *values(): AsyncGenerator<MemoryDir | MemoryFile> { yield* [...this.children.values()] }
  [Symbol.asyncIterator](): AsyncGenerator<[string, MemoryDir | MemoryFile]> { return this.entries() }

  names(): string[] { return [...this.children.keys()].sort() }
}

// ── IoC, signer, service ───────────────────────────────────────────────────

const registry = new Map<string, unknown>()
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registry.set(key, value) },
  get: (key: string) => registry.get(key),
  whenReady: () => undefined,
}

const SELF_DOMAIN = 'backup.example.com'

type Drainable = { drain: () => Promise<void>; hasReceipt: (sig: string) => Promise<boolean> }
let HostSync: new () => Drainable

beforeAll(async () => {
  registry.set('@diamondcoreprocessor.com/NostrSigner', {
    signEvent: async (event: Record<string, unknown>) => ({ ...event, id: 'e', pubkey: 'p'.repeat(64), sig: 's' }),
  })
  // Imported BEFORE the gates open, so the module's own boot drain stays inert;
  // each case drives a fresh instance of its own.
  const mod = await import('./host-sync.service.js')
  HostSync = mod.HostSyncService as unknown as new () => Drainable
})

const sign = async (bytes: Uint8Array): Promise<string> => await SignatureService.sign(bytes.slice().buffer as ArrayBuffer)
const poolName = async (meaning: string): Promise<string> => await sign(new TextEncoder().encode(meaning))

let root: MemoryDir
let service: Drainable

beforeEach(() => {
  root = new MemoryDir('')
  registry.set('@hypercomb.social/Store', { opfsRoot: root })
  // The self-domain target: a host to push to AND the explicit opt-in.
  localStorage.setItem('hc:nostrmesh:self-domain', SELF_DOMAIN)
  localStorage.setItem('hc:host-sync:enabled', 'true')
  localStorage.removeItem('hc:public-host')
  service = new HostSync()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.removeItem('hc:nostrmesh:self-domain')
  localStorage.removeItem('hc:host-sync:enabled')
})

/** Stage bytes in the sign('host-push') pool exactly as enqueue leaves them —
 *  a queue carried over from an earlier session. */
const stage = async (text: string): Promise<{ sig: string; bytes: Uint8Array }> => {
  const bytes = new TextEncoder().encode(text)
  const sig = await sign(bytes)
  const queue = await root.getDirectoryHandle(await poolName('host-push'), { create: true })
  const writable = await (await queue.getFileHandle(`${sig}.resource`, { create: true })).createWritable()
  await writable.write(bytes)
  await writable.close()
  return { sig, bytes }
}

const queued = async (): Promise<string[]> => {
  const dir = root.children.get(await poolName('host-push'))
  return dir?.kind === 'directory' ? dir.names() : []
}

const receipts = async (): Promise<string[]> => {
  const dir = root.children.get(await poolName('host-receipts'))
  return dir?.kind === 'directory' ? dir.names() : []
}

// ── the host ───────────────────────────────────────────────────────────────

type HostOptions = {
  /** What the host serves. A signed PUT whose body hashes to its URL joins it. */
  held?: Map<string, Uint8Array>
  /** How a miss answers: a plain 404, or an SPA fallback page (200 text/html). */
  miss?: '404' | 'html'
  /** HEAD fails at the network (offline / CORS) while this returns true. */
  headThrows?: () => boolean
  /** This hostname refuses the writer key: every PUT to it answers 401. */
  refuseWriterOn?: string
  /** Held files are HTML pages served as `text/html` (a website page body),
   *  with no ETag — only the bytes themselves say what they are. */
  htmlHeld?: boolean
}

const makeHost = (options: HostOptions = {}) => {
  const held = options.held ?? new Map<string, Uint8Array>()
  const heldType = options.htmlHeld ? 'text/html' : 'application/octet-stream'
  const missing = (body: string | null): Response => options.miss === 'html'
    ? new Response(body === null ? null : '<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } })
    : new Response(null, { status: 404 })
  return vi.fn(async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    const sig = url.pathname.slice(1)
    const method = init?.method ?? 'GET'
    if (method === 'PUT') {
      if (url.hostname === options.refuseWriterOn) return new Response(null, { status: 401 })
      if (!String((init?.headers as Record<string, string>)?.['Authorization']).startsWith('Nostr ')) return new Response(null, { status: 401 })
      const body = new Uint8Array(init?.body as ArrayBuffer)
      if (await sign(body) !== sig) return new Response(null, { status: 422 })
      held.set(sig, body)
      return new Response(null, { status: 201 })
    }
    if (method === 'HEAD') {
      if (options.headThrows?.()) throw new TypeError('Failed to fetch')
      return held.has(sig)
        ? new Response(null, { status: 200, headers: { 'content-type': heldType } })
        : missing(null)
    }
    const bytes = held.get(sig)
    return bytes
      ? new Response(bytes.slice(), { status: 200, headers: { 'content-type': heldType } })
      : missing('page')
  })
}

type Host = ReturnType<typeof makeHost>
const urlOf = (sig: string): string => `https://${SELF_DOMAIN}/${sig}`
const calls = (host: Host, method: string): string[] =>
  host.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === method).map(([url]) => String(url))
const methods = (host: Host): string[] => host.mock.calls.map(([, init]) => init?.method ?? 'GET')

/** Listen to an effect from now on — EffectBus replays the last value to a new
 *  subscriber, and an earlier case's emission is not this case's evidence. */
const listen = <T>(effect: string): { seen: T[]; off: () => void } => {
  const seen: T[] = []
  const off = EffectBus.on<T>(effect, payload => { seen.push(payload) })
  seen.length = 0
  return { seen, off }
}

// ── the drain ──────────────────────────────────────────────────────────────

describe('the drain asks the host before it sends', () => {
  it('(a) never PUTs a sig the host already serves: the HEAD mints the receipt, retires the entry, and paints nothing', async () => {
    const served = await stage('{"name":"already on the host"}')
    const host = makeHost({ held: new Map([[served.sig, served.bytes]]) })
    vi.stubGlobal('fetch', host)
    const progress = listen<{ done: number; total: number }>('host-sync:progress')
    const receipt = listen<{ sig: string }>('host:receipt')

    await service.drain()

    expect(calls(host, 'HEAD')).toEqual([urlOf(served.sig)])
    expect(calls(host, 'PUT')).toEqual([])
    expect(calls(host, 'GET')).toEqual([])
    expect(await receipts()).toEqual([served.sig])
    expect(await service.hasReceipt(served.sig)).toBe(true)
    expect(await queued()).toEqual([])
    expect(receipt.seen).toEqual([{ sig: served.sig }])
    // Nothing was uploaded, so nothing was counted — not even as a denominator.
    expect(progress.seen).toEqual([])
    progress.off()
    receipt.off()
  })

  it('(b) sends a sig the host lacks exactly once, reads it back, receipts and retires it, counting 0 of 1 then 1 of 1', async () => {
    const lacking = await stage('{"name":"new here"}')
    const held = new Map<string, Uint8Array>()
    const host = makeHost({ held })
    vi.stubGlobal('fetch', host)
    const progress = listen<{ done: number; total: number }>('host-sync:progress')
    const receipt = listen<{ sig: string }>('host:receipt')

    await service.drain()

    expect(methods(host)).toEqual(['HEAD', 'PUT', 'GET'])
    expect(calls(host, 'PUT')).toEqual([urlOf(lacking.sig)])
    expect(new TextDecoder().decode(held.get(lacking.sig))).toBe('{"name":"new here"}')
    expect(await receipts()).toEqual([lacking.sig])
    expect(await queued()).toEqual([])
    expect(receipt.seen).toEqual([{ sig: lacking.sig }])
    expect(progress.seen).toEqual([{ done: 0, total: 1 }, { done: 1, total: 1 }])
    progress.off()
    receipt.off()
  })

  it('(c) reconciles every entry before sending any: one served + one lacking is a total of 1 and exactly one PUT', async () => {
    // The lacking entry is queued FIRST, so a drain that sent as it went would
    // PUT before it ever asked about the second.
    const lacking = await stage('{"name":"the host lacks me"}')
    const served = await stage('{"name":"the host serves me"}')
    const host = makeHost({ held: new Map([[served.sig, served.bytes]]) })
    vi.stubGlobal('fetch', host)
    const progress = listen<{ done: number; total: number }>('host-sync:progress')
    const receipt = listen<{ sig: string }>('host:receipt')

    await service.drain()

    expect(methods(host)).toEqual(['HEAD', 'HEAD', 'PUT', 'GET'])
    expect(calls(host, 'HEAD')).toEqual([urlOf(lacking.sig), urlOf(served.sig)])
    expect(calls(host, 'PUT')).toEqual([urlOf(lacking.sig)])
    expect(progress.seen).toEqual([{ done: 0, total: 1 }, { done: 1, total: 1 }])
    expect(await receipts()).toEqual([lacking.sig, served.sig].sort())
    expect(await queued()).toEqual([])
    expect(receipt.seen.map(r => r.sig).sort()).toEqual([lacking.sig, served.sig].sort())
    progress.off()
    receipt.off()
  })

  it('(d) an SPA fallback (HEAD 200 text/html) is not a held file: the entry is PUT', async () => {
    const lacking = await stage('{"name":"behind a single-page app"}')
    const held = new Map<string, Uint8Array>()
    const host = makeHost({ held, miss: 'html' })
    vi.stubGlobal('fetch', host)
    const progress = listen<{ done: number; total: number }>('host-sync:progress')

    await service.drain()

    expect(calls(host, 'HEAD')).toEqual([urlOf(lacking.sig)])
    expect(calls(host, 'PUT')).toEqual([urlOf(lacking.sig)])
    expect(held.has(lacking.sig)).toBe(true)
    expect(await receipts()).toEqual([lacking.sig])
    expect(await queued()).toEqual([])
    expect(progress.seen).toEqual([{ done: 0, total: 1 }, { done: 1, total: 1 }])
    progress.off()
  })

  it('(e) with the probe breaker open the drain still pushes, and asks nothing first', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    // Ten HEADs fail at the network: the breaker opens. The PUTs still land.
    const first: { sig: string; bytes: Uint8Array }[] = []
    for (let i = 0; i < 10; i++) first.push(await stage(`{"name":"unreachable probe ${i}"}`))
    const held = new Map<string, Uint8Array>()
    const sick = makeHost({ held, headThrows: () => true })
    vi.stubGlobal('fetch', sick)

    await service.drain()

    expect(calls(sick, 'HEAD')).toHaveLength(10)
    expect(calls(sick, 'PUT')).toEqual(first.map(f => urlOf(f.sig)))
    expect(await queued()).toEqual([])
    expect(warn.mock.calls.some(([line]) => String(line).includes('pausing held-probes'))).toBe(true)

    // The host recovers and already serves the fresh sig — but the breaker is
    // open, so the drain does not ask; it pushes, and the push is honest.
    const fresh = await stage('{"name":"after the breaker opened"}')
    held.set(fresh.sig, fresh.bytes)
    const healthy = makeHost({ held })
    vi.stubGlobal('fetch', healthy)
    const progress = listen<{ done: number; total: number }>('host-sync:progress')

    await service.drain()

    expect(calls(healthy, 'HEAD')).toEqual([])
    expect(calls(healthy, 'PUT')).toEqual([urlOf(fresh.sig)])
    expect(await queued()).toEqual([])
    expect(await receipts()).toContain(fresh.sig)
    expect(progress.seen).toEqual([{ done: 0, total: 1 }, { done: 1, total: 1 }])
    progress.off()
  })

  it('(f) a host paused after a 401 is neither asked nor counted; entries owed only to it wait, uncounted', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    // Two targets: the self-domain and the public host. Public-only targets
    // apply to `.public`-marked sigs alone, so both entries wear the marker.
    localStorage.setItem('hc:public-host', '1')
    const publicDomain = String((service as unknown as { publicHostDomain: () => string }).publicHostDomain())
    const mark = async (sig: string): Promise<void> => {
      const queue = await root.getDirectoryHandle(await poolName('host-push'), { create: true })
      const w = await (await queue.getFileHandle(`${sig}.public`, { create: true })).createWritable()
      await w.write(new Uint8Array(0))
      await w.close()
    }
    const first = await stage('{"name":"owed to both"}')
    await mark(first.sig)
    const held = new Map<string, Uint8Array>()
    const refusing = makeHost({ held, refuseWriterOn: publicDomain })
    vi.stubGlobal('fetch', refusing)

    // Pass one: the self-domain takes it; the public host answers 401 and pauses.
    await service.drain()
    expect(calls(refusing, 'PUT')).toEqual([urlOf(first.sig), `https://${publicDomain}/${first.sig}`])
    expect(await receipts()).toContain(first.sig)
    expect(await queued()).toContain(`${first.sig}.resource`) // still owes the public host

    // Pass two: a new entry. The paused host gets no HEAD and no PUT, the
    // first entry (owed only to the paused host) is not counted, and the
    // denominator is exactly the one send that can happen.
    const second = await stage('{"name":"while the public host is paused"}')
    await mark(second.sig)
    const host = makeHost({ held, refuseWriterOn: publicDomain })
    vi.stubGlobal('fetch', host)
    const progress = listen<{ done: number; total: number }>('host-sync:progress')

    await service.drain()

    expect(calls(host, 'HEAD')).toEqual([urlOf(second.sig)])
    expect(calls(host, 'PUT')).toEqual([urlOf(second.sig)])
    expect(host.mock.calls.some(([url]) => String(url).includes(publicDomain))).toBe(false)
    expect(progress.seen).toEqual([{ done: 0, total: 1 }, { done: 1, total: 1 }])
    expect(await receipts()).toContain(second.sig)
    progress.off()
    localStorage.removeItem('hc:public-host')
  })

  it('(g) a held HTML page served as text/html is not an SPA fallback: its bytes hash to the sig, so it is not re-sent', async () => {
    const page = await stage('<!doctype html><title>a website page body</title>')
    const host = makeHost({ held: new Map([[page.sig, page.bytes]]), htmlHeld: true })
    vi.stubGlobal('fetch', host)

    await service.drain()

    // HEAD said text/html with no ETag, so the drain read the bytes and
    // checked them against their name — one GET, never a PUT.
    expect(methods(host)).toEqual(['HEAD', 'GET'])
    expect(await receipts()).toEqual([page.sig])
    expect(await queued()).toEqual([])
  })
})
