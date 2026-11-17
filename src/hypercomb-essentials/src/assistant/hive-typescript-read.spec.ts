// hive-typescript-read.spec.ts — one source atom, asked of the package's own
// hosts in order, used only when it hashes to its name, and written nowhere.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { TYPESCRIPT_ATOM_MAX, TYPESCRIPT_READ_MS, liveTypescriptReadDeps, readTypescriptAtom, type TypescriptReadDeps } from './hive-typescript-read.js'

const SIG = 'a'.repeat(64)
const good = new TextEncoder().encode('// @hypercomb/typescript/assistant\n')
const bad = new TextEncoder().encode('another host’s own words')

/** Hosts as a table of URL → bytes. `sign` says every answer hashes to SIG
 *  but `bad`: so an empty answer and one over the cap are turned away by
 *  their own checks, never by a hash that happens not to match. */
const depsOf = (answers: Record<string, Uint8Array | null>, zones: string[] = ['one.example', 'two.example']): TypescriptReadDeps & { asked: string[] } => {
  const asked: string[] = []
  return {
    asked,
    zones: async () => zones,
    bases: zone => [`https://${zone}/content`, `https://${zone}`],
    get: async url => { asked.push(url); return answers[url] ?? null },
    sign: async bytes => bytes === bad ? 'f'.repeat(64) : SIG,
  }
}

describe('a source atom read from the package’s hosts', () => {
  it('asks each host’s bases in order, every one as <base>/<sig>?held, and the first verified answer wins', async () => {
    const deps = depsOf({ [`https://two.example/content/${SIG}?held`]: good })
    const read = await readTypescriptAtom(SIG, undefined, deps)
    expect(read).toEqual({ bytes: good, host: 'two.example' })
    expect(deps.asked).toEqual([
      `https://one.example/content/${SIG}?held`,
      `https://one.example/${SIG}?held`,
      `https://two.example/content/${SIG}?held`,
    ])
  })

  it('skips no answer, an empty body, a body over the cap and bytes that do not hash to the name', async () => {
    const huge = { byteLength: TYPESCRIPT_ATOM_MAX + 1 } as Uint8Array
    const deps = depsOf({
      [`https://one.example/content/${SIG}?held`]: null,
      [`https://one.example/${SIG}?held`]: new Uint8Array(0),
      [`https://two.example/content/${SIG}?held`]: huge,
      [`https://two.example/${SIG}?held`]: bad,
      [`https://three.example/content/${SIG}?held`]: good,
    }, ['one.example', 'two.example', 'three.example'])
    expect(await readTypescriptAtom(SIG, undefined, deps)).toEqual({ bytes: good, host: 'three.example' })
    expect(deps.asked).toHaveLength(5)
  })

  it('never hands on an empty answer or one over the cap, although each hashes to the name', async () => {
    const empty = depsOf({ [`https://one.example/content/${SIG}?held`]: new Uint8Array(0) }, ['one.example'])
    expect(await readTypescriptAtom(SIG, undefined, empty)).toBeNull()
    const huge = { byteLength: TYPESCRIPT_ATOM_MAX + 1 } as Uint8Array
    const over = depsOf({ [`https://one.example/content/${SIG}?held`]: huge }, ['one.example'])
    expect(await readTypescriptAtom(SIG, undefined, over)).toBeNull()
    // Exactly the cap is an atom.
    const most = { byteLength: TYPESCRIPT_ATOM_MAX } as Uint8Array
    const at = depsOf({ [`https://one.example/content/${SIG}?held`]: most }, ['one.example'])
    expect(await readTypescriptAtom(SIG, undefined, at)).toEqual({ bytes: most, host: 'one.example' })
  })

  it('is null when no host holds it, and when a host throws', async () => {
    const deps = depsOf({})
    expect(await readTypescriptAtom(SIG, undefined, deps)).toBeNull()
    expect(deps.asked).toHaveLength(4)
    const throwing: TypescriptReadDeps = { ...depsOf({}), get: async () => { throw new Error('down') } }
    expect(await readTypescriptAtom(SIG, undefined, throwing)).toBeNull()
  })

  it('stops before the next request once the caller’s signal is aborted', async () => {
    const controller = new AbortController()
    const deps = depsOf({ [`https://two.example/content/${SIG}?held`]: good })
    const get = deps.get
    deps.get = async (url, signal) => { controller.abort(); return get(url, signal) }
    expect(await readTypescriptAtom(SIG, controller.signal, deps)).toBeNull()
    expect(deps.asked).toHaveLength(1)
  })

  it('makes no request with no host to ask, and none for a name that is not a signature', async () => {
    const none = depsOf({}, [])
    expect(await readTypescriptAtom(SIG, undefined, none)).toBeNull()
    expect(none.asked).toEqual([])
    const deps = depsOf({})
    expect(await readTypescriptAtom('../' + SIG, undefined, deps)).toBeNull()
    expect(await readTypescriptAtom('abc', undefined, deps)).toBeNull()
    expect(deps.asked).toEqual([])
  })
})

describe('the live read of one base', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  /** A body as a stream of chunks, with what was done to it. It has no
   *  `arrayBuffer`: the read must count what arrives, never buffer the lot. */
  const streamOf = (chunks: readonly Uint8Array[]) => {
    const seen = { reads: 0, cancelled: 0 }
    let at = 0
    const end = async (): Promise<void> => { seen.cancelled++ }
    const body = {
      cancel: end,
      getReader: () => ({
        read: async () => { seen.reads++; return at < chunks.length ? { done: false, value: chunks[at++] } : { done: true, value: undefined } },
        cancel: end,
      }),
    }
    return { body, seen }
  }
  const answer = (status: number, type: string, text = 'text', length?: number) => {
    const encoded = new TextEncoder().encode(text)
    // Two chunks, so a read that kept only one would be short.
    const { body, seen } = streamOf([encoded.slice(0, 3), encoded.slice(3)])
    const headers: Record<string, string> = { 'content-type': type, ...(length === undefined ? {} : { 'content-length': String(length) }) }
    return { response: { status, ok: status >= 200 && status < 300, headers: { get: (name: string) => headers[name.toLowerCase()] ?? null }, body }, seen }
  }

  it('reads a 200 as its bytes, and a 204, a 404 and a page as nothing', async () => {
    const calls: Array<[string, RequestInit | undefined]> = []
    let next: unknown
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => { calls.push([url, init]); return next })
    const whole = answer(200, 'text/plain', 'export const x = 1\n')
    next = whole.response
    expect(new TextDecoder().decode((await liveTypescriptReadDeps.get(`https://one.example/${SIG}?held`))!)).toBe('export const x = 1\n')
    // Read to its end, so nothing is left to end.
    expect(whole.seen.cancelled).toBe(0)
    for (const turned of [answer(204, ''), answer(404, 'text/plain'), answer(200, 'text/html; charset=utf-8', '<!doctype html>')]) {
      next = turned.response
      expect(await liveTypescriptReadDeps.get(`https://one.example/${SIG}?held`)).toBeNull()
      // Turned away on its head: no byte of the body is read, and it is ended.
      expect(turned.seen).toEqual({ reads: 0, cancelled: 1 })
    }
    // Every request carries a signal, stays out of the browser's cache, and
    // follows no redirect: a listed host cannot send the ask to another host.
    expect(calls).toHaveLength(4)
    for (const [, init] of calls) {
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      expect(init?.cache).toBe('no-store')
      expect(init?.redirect).toBe('error')
    }
  })

  it('is nothing for a 200 with no body to read', async () => {
    vi.stubGlobal('fetch', async () => ({ status: 200, ok: true, headers: { get: () => null }, body: null, arrayBuffer: async () => new Uint8Array(8).buffer }))
    expect(await liveTypescriptReadDeps.get(`https://one.example/${SIG}?held`)).toBeNull()
  })

  it('refuses a declared length over the cap before reading a byte', async () => {
    const declared = answer(200, 'text/plain', 'small', TYPESCRIPT_ATOM_MAX + 1)
    vi.stubGlobal('fetch', async () => declared.response)
    expect(await liveTypescriptReadDeps.get(`https://one.example/${SIG}?held`)).toBeNull()
    expect(declared.seen).toEqual({ reads: 0, cancelled: 1 })
    // A declared length at the cap is read.
    const allowed = answer(200, 'text/plain', 'small', TYPESCRIPT_ATOM_MAX)
    vi.stubGlobal('fetch', async () => allowed.response)
    expect(new TextDecoder().decode((await liveTypescriptReadDeps.get(`https://one.example/${SIG}?held`))!)).toBe('small')
  })

  it('stops reading a body that grows past the cap, whatever length it declared, and ends it', async () => {
    // One mebibyte, handed over forty times: 40 MB against a cap of 32. The
    // host declares nothing, then a small lie.
    const chunk = new Uint8Array(1_048_576)
    const count = 40
    expect(count * chunk.byteLength).toBeGreaterThan(TYPESCRIPT_ATOM_MAX)
    for (const length of [undefined, 10]) {
      const { body, seen } = streamOf(Array.from({ length: count }, () => chunk))
      const headers: Record<string, string> = { 'content-type': 'text/plain', ...(length === undefined ? {} : { 'content-length': String(length) }) }
      vi.stubGlobal('fetch', async () => ({ status: 200, ok: true, headers: { get: (name: string) => headers[name.toLowerCase()] ?? null }, body }))
      expect(await liveTypescriptReadDeps.get(`https://one.example/${SIG}?held`)).toBeNull()
      // It stopped at the chunk that crossed the cap, and told the host to stop.
      expect(seen.reads).toBe(Math.floor(TYPESCRIPT_ATOM_MAX / chunk.byteLength) + 1)
      expect(seen.cancelled).toBe(1)
    }
  })

  it('is nothing when the request fails', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('network') })
    expect(await liveTypescriptReadDeps.get(`https://one.example/${SIG}?held`)).toBeNull()
  })

  it('ends at once for a signal already aborted: the host is handed an ended request', async () => {
    // This host would answer. Only the request already being ended keeps its
    // answer from being read.
    const ready = answer(200, 'text/plain', 'export const x = 1\n')
    const handed: boolean[] = []
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      handed.push(init?.signal?.aborted === true)
      if (init?.signal?.aborted) throw new DOMException('stopped', 'AbortError')
      return ready.response
    })
    const controller = new AbortController()
    controller.abort()
    expect(await liveTypescriptReadDeps.get(`https://one.example/${SIG}?held`, controller.signal)).toBeNull()
    expect(handed).toEqual([true])
    expect(ready.seen.reads).toBe(0)
    // The same host, asked with a live signal, is read.
    expect(await liveTypescriptReadDeps.get(`https://one.example/${SIG}?held`, new AbortController().signal)).not.toBeNull()
    expect(handed).toEqual([true, false])
  })

  it('ends a read the caller stops part way through its body', async () => {
    const controller = new AbortController()
    let cancelled = 0
    const body = { getReader: () => ({
      read: async () => { controller.abort(); return new Promise<never>(() => {}) },
      cancel: async () => { cancelled++ },
    }) }
    vi.stubGlobal('fetch', async () => ({ status: 200, ok: true, headers: { get: () => null }, body }))
    expect(await liveTypescriptReadDeps.get(`https://one.example/${SIG}?held`, controller.signal)).toBeNull()
    expect(cancelled).toBe(1)
  })

  it('gives one base sixty seconds, headers and body together, and not a millisecond less', async () => {
    expect(TYPESCRIPT_READ_MS).toBe(60_000)
    vi.useFakeTimers()
    // A host that takes the request and never answers, and one that answers
    // and then stalls in its body. Neither settles by itself.
    let cancelled = 0
    const stalled = { getReader: () => ({ read: () => new Promise<never>(() => {}), cancel: async () => { cancelled++ } }) }
    const hosts: Array<() => Promise<unknown>> = [
      () => new Promise<never>(() => {}),
      async () => ({ status: 200, ok: true, headers: { get: () => null }, body: stalled }),
    ]
    for (const host of hosts) {
      let signal: AbortSignal | undefined
      vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => { signal = init?.signal ?? undefined; return host() })
      let settled: Uint8Array | null | undefined
      void liveTypescriptReadDeps.get(`https://one.example/${SIG}?held`).then(bytes => { settled = bytes })
      await vi.advanceTimersByTimeAsync(TYPESCRIPT_READ_MS - 1)
      expect(settled).toBeUndefined()
      expect(signal?.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(settled).toBeNull()
      // The request itself is ended, not only abandoned.
      expect(signal?.aborted).toBe(true)
    }
    expect(cancelled).toBe(1)
  })

  it('asks a host at the base its pool answered on, then bare, and nowhere without the host port', () => {
    const page = window as unknown as { ioc?: unknown }
    const before = page.ioc
    try {
      page.ioc = { get: (key: string) => key === '@hypercomb.social/HostPackages' ? { bases: (zone: string) => [`https://${zone}/content`] } : undefined }
      expect(liveTypescriptReadDeps.bases('hypercomb.com')).toEqual(['https://hypercomb.com/content', 'https://hypercomb.com'])
      page.ioc = { get: (key: string) => key === '@hypercomb.social/HostPackages' ? { bases: (zone: string) => [`https://${zone}`] } : undefined }
      expect(liveTypescriptReadDeps.bases('jwize.com')).toEqual(['https://jwize.com'])
      page.ioc = { get: () => undefined }
      expect(liveTypescriptReadDeps.bases('hypercomb.com')).toEqual([])
    } finally {
      page.ioc = before
    }
  })
})
