// sharing/bounded-fetch.spec.ts — a hung host costs at most its deadline, never the act.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetBackoff, fetchWithDeadline, firstBounded, isSlowHost, mapBounded } from './bounded-fetch.js'

/** A fetch whose host never answers — it settles only when its signal aborts. */
const hang = (init?: RequestInit): Promise<Response> => new Promise((_, reject) => {
  init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
})

const ok = (body = 'ok'): Response => new Response(body, { status: 200 })

describe('fetchWithDeadline', () => {
  beforeEach(() => { _resetBackoff() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('gives up on a host that never answers, within the deadline', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => hang(init)))
    const started = Date.now()
    await expect(fetchWithDeadline('https://hung.example/x', {}, { timeoutMs: 40 })).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('sends exactly one request — a timeout is not retried', async () => {
    const stub = vi.fn((_url: string, init?: RequestInit) => hang(init))
    vi.stubGlobal('fetch', stub)
    await fetchWithDeadline('https://hung.example/x', {}, { timeoutMs: 20 }).catch(() => null)
    expect(stub).toHaveBeenCalledTimes(1)
  })

  it('also stops when the caller aborts, and that is not a slow host', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => hang(init)))
    const caller = new AbortController()
    const pending = fetchWithDeadline('https://quiet.example/x', {}, { timeoutMs: 5_000, signal: caller.signal })
    caller.abort()
    await expect(pending).rejects.toBeDefined()
    expect(isSlowHost('quiet.example')).toBe(false)
  })

  it('remembers a host that timed out, and forgets it once it answers', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => hang(init)))
    await fetchWithDeadline('https://slow.example/x', {}, { timeoutMs: 20 }).catch(() => null)
    expect(isSlowHost('slow.example')).toBe(true)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    await fetchWithDeadline('https://slow.example/x')
    expect(isSlowHost('slow.example')).toBe(false)
  })
})

describe('mapBounded', () => {
  beforeEach(() => { _resetBackoff() })

  it('never runs more than the limit at once, and returns results in input order', async () => {
    let live = 0
    let peak = 0
    const out = await mapBounded([1, 2, 3, 4, 5, 6, 7, 8], 3, async n => {
      live++; peak = Math.max(peak, live)
      await new Promise(r => setTimeout(r, 5))
      live--
      return n * 2
    })
    expect(peak).toBe(3)
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16])
  })

  it('a throwing item yields undefined and spares the others', async () => {
    const out = await mapBounded(['a', 'b', 'c'], 2, async s => { if (s === 'b') throw new Error('no'); return s })
    expect(out).toEqual(['a', undefined, 'c'])
  })

  it('asks a host that timed out last, but still asks it', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => url.includes('slow') ? hang(init) : Promise.resolve(ok())))
    await fetchWithDeadline('https://slow.example/x', {}, { timeoutMs: 20 }).catch(() => null)
    const asked: string[] = []
    await mapBounded(['slow.example', 'a.example', 'b.example'], 1, async host => { asked.push(host) }, { hostOf: host => host })
    expect(asked).toEqual(['a.example', 'b.example', 'slow.example'])
    vi.unstubAllGlobals()
  })
})

describe('firstBounded', () => {
  beforeEach(() => { _resetBackoff() })

  it('returns the first accepted answer and aborts the rest', async () => {
    const aborted: string[] = []
    const { winner } = await firstBounded(['hung', 'fast'], 4, (host, signal) => new Promise<string>((resolve, reject) => {
      if (host === 'fast') { resolve('good'); return }
      signal.addEventListener('abort', () => { aborted.push(host); reject(signal.reason) }, { once: true })
    }), result => result === 'good')
    expect(winner).toMatchObject({ item: 'fast', result: 'good' })
    expect(aborted).toEqual(['hung'])
  })

  it('reports every result, in input order, when nobody wins', async () => {
    const { winner, results } = await firstBounded(['a', 'b', 'c'], 2, async host => host.toUpperCase(), () => false)
    expect(winner).toBeNull()
    expect(results).toEqual(['A', 'B', 'C'])
  })
})
