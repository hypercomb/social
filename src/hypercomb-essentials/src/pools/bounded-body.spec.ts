// pools/bounded-body.spec.ts : a body read no further than its cap, against
// responses whose bodies count what was pulled from them. No network.

import { describe, expect, it } from 'vitest'
import { readBodyCapped } from './bounded-body.js'

/** A body of `chunks` pieces of `size` bytes, with no length said up front, that counts what a reader takes. */
const streamed = (chunks: number, size: number) => {
  const seen = { pulled: 0, cancelled: false }
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (seen.pulled >= chunks) { controller.close(); return }
      seen.pulled++
      controller.enqueue(new Uint8Array(size).fill(seen.pulled))
    },
    cancel() { seen.cancelled = true },
  }, { highWaterMark: 0 })
  return { response: new Response(body), seen }
}

describe('readBodyCapped', () => {
  it('answers a body that fits, whole and in order', async () => {
    const { response, seen } = streamed(3, 4)
    const bytes = await readBodyCapped(response, 12)
    expect(Array.from(bytes as Uint8Array)).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3])
    expect(seen.cancelled).toBe(false)
  })

  it('stops at the cap: a body that runs past it is never read to its end', async () => {
    const { response, seen } = streamed(1000, 1024)
    expect(await readBodyCapped(response, 2048)).toBeNull()
    // Two pieces fit; the third is the one that runs past. Nothing after it is asked for.
    expect(seen.pulled).toBeLessThanOrEqual(4)
    expect(seen.cancelled).toBe(true)
  })

  it('reads nothing of a body whose stated length is already past the cap', async () => {
    const { response, seen } = streamed(1000, 1024)
    const stated = new Response(response.body, { headers: { 'content-length': '1024000' } })
    expect(await readBodyCapped(stated, 2048)).toBeNull()
    expect(seen.pulled).toBeLessThanOrEqual(1)
    expect(seen.cancelled).toBe(true)
  })

  it('answers an empty body as no bytes, and a body of exactly the cap whole', async () => {
    expect((await readBodyCapped(new Response(''), 8))?.byteLength).toBe(0)
    expect((await readBodyCapped(new Response(new Uint8Array(8)), 8))?.byteLength).toBe(8)
    expect(await readBodyCapped(new Response(new Uint8Array(9)), 8)).toBeNull()
  })

  it('where a response has no body stream, reads it whole and still refuses one past the cap', async () => {
    const plain = (size: number): Response =>
      ({ headers: new Headers(), body: null, arrayBuffer: async () => new ArrayBuffer(size) }) as unknown as Response
    expect((await readBodyCapped(plain(8), 8))?.byteLength).toBe(8)
    expect(await readBodyCapped(plain(9), 8)).toBeNull()
  })
})
