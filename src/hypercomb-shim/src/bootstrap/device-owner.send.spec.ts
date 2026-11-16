// device-owner.send.spec.ts — a write that got no readable answer says which
// step it was and what the browser said, and is sent again before it is given
// up. jwize, 2026-11-15: a publish from business-card.jwize.com failed with
// "pluginthematrix.com could not be reached" while that host answered every
// other request, and nothing said which piece or why.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { putIndex, uploadAtom } from './device-owner'
import type { DeviceSigner } from './device-key'

const ANCHOR = 'a'.repeat(64)
const ZONE = 'write.example'
const bytes = new TextEncoder().encode('{"meta":1,"resource":"' + 'b'.repeat(64) + '"}')
const sigOf = async (data: Uint8Array): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', data.slice().buffer as ArrayBuffer))].map(b => b.toString(16).padStart(2, '0')).join('')

const signer = (fail = false): DeviceSigner => ({
  pubkey: 'c'.repeat(64),
  sign: template => {
    if (fail) throw new Error('the key could not be read')
    return { ...template, pubkey: 'c'.repeat(64), id: 'd'.repeat(64), sig: 'e'.repeat(128) }
  },
})

/** A zone that holds nothing until a PUT lands, whose PUT answers come from `puts` in order. */
const zone = (puts: Array<() => Response>) => {
  let held = false
  const seen: string[] = []
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    seen.push(method)
    if (method === 'HEAD') return new Response(null, { status: held ? 200 : 204 })
    const answer = (puts.shift() ?? (() => new Response('stored', { status: 201 })))()
    if (answer.ok) held = true
    return answer
  })
  return { fetcher, seen, puts: () => seen.filter(m => m === 'PUT').length }
}
const dropped = (): Response => { throw new TypeError('Failed to fetch') }

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

/** Run a write to its end, letting every pause between sends pass. */
const settled = async <T>(work: Promise<T>): Promise<T> => {
  let done = false
  const out = work.finally(() => { done = true })
  // Hashing is real async work between the pauses, so the clock is walked.
  while (!done) await vi.advanceTimersByTimeAsync(500)
  return out
}

describe('an upload that got no answer', () => {
  it('is sent again, and goes up when the host answers', async () => {
    const sig = await sigOf(bytes)
    const host = zone([dropped, dropped])
    vi.stubGlobal('fetch', host.fetcher)
    expect(await settled(uploadAtom(ZONE, bytes, sig, ANCHOR, signer(), 'part 1a2b…', 'held'))).toBeNull()
    expect(host.puts()).toBe(3)
  })

  it('names the piece and what the browser said when it never answers', async () => {
    const sig = await sigOf(bytes)
    const host = zone([dropped, dropped, dropped])
    vi.stubGlobal('fetch', host.fetcher)
    expect(await settled(uploadAtom(ZONE, bytes, sig, ANCHOR, signer(), 'part 1a2b…', 'held')))
      .toBe('write.example could not be reached to upload part 1a2b… (Failed to fetch)')
    expect(host.puts()).toBe(3)
  })

  it('is not sent again once the host has answered, and says why the host refused', async () => {
    const sig = await sigOf(bytes)
    const host = zone([() => new Response('no', { status: 403, headers: { 'X-Reason': 'this host keeps bytes for its own people only' } })])
    vi.stubGlobal('fetch', host.fetcher)
    expect(await settled(uploadAtom(ZONE, bytes, sig, ANCHOR, signer(), 'part 1a2b…', 'held')))
      .toBe('write.example does not take uploads from this browser\'s key (this host keeps bytes for its own people only)')
    expect(host.puts()).toBe(1)
  })

  it('says so when the browser could not sign, and sends nothing', async () => {
    const sig = await sigOf(bytes)
    const host = zone([])
    vi.stubGlobal('fetch', host.fetcher)
    expect(await settled(uploadAtom(ZONE, bytes, sig, ANCHOR, signer(true), 'part 1a2b…', 'held')))
      .toBe('this browser could not sign the upload of part 1a2b… (the key could not be read)')
    expect(host.puts()).toBe(0)
  })
})

describe('an index write that got no answer', () => {
  it('is sent again, then says it was the index and what the browser said', async () => {
    const host = zone([dropped, dropped, dropped])
    vi.stubGlobal('fetch', host.fetcher)
    expect(await settled(putIndex(ZONE, ANCHOR, { id: 'f'.repeat(64) }, signer())))
      .toBe('write.example could not be reached to write the index (Failed to fetch)')
    expect(host.puts()).toBe(3)
  })
})
