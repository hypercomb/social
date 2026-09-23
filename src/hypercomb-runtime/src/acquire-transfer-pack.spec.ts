// @vitest-environment node
//
// acquire-transfer-pack.spec.ts — the pack is a HINT, so nothing it does may
// cost an install (acquire.ts packedFetch). Every case that is not a good pack
// for this install ends in loose fetching; a good one serves the walker.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { SignatureService } from '@hypercomb/core'
import { packedFetch } from './acquire'
import { encodeTransferPack, gzipBytes } from './transfer-pack'

const text = (value: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(value) as Uint8Array<ArrayBuffer>
const sigOf = (bytes: Uint8Array<ArrayBuffer>): Promise<string> => SignatureService.sign(bytes.buffer)
const ROOT = 'f'.repeat(64)
const BASE = 'https://host.test/content'

/** 40 modules, a pack of them, and its pointer — the shape a build publishes. */
const world = async (count = 40) => {
  const modules: Array<[string, Uint8Array<ArrayBuffer>]> = []
  for (let i = 0; i < count; i++) {
    const bytes = text(`export const m${i} = ${i};`)
    modules.push([await sigOf(bytes), bytes])
  }
  const pack = await gzipBytes(encodeTransferPack(modules))
  return { modules, pack, packSig: await sigOf(pack), wanted: modules.map(([sig]) => sig) }
}

/** A fetch that answers from a map of URL → bytes, and 404 for the rest. */
const serve = (answers: Record<string, Uint8Array | 'throw' | 'html'>) =>
  vi.fn(async (url: string) => {
    const answer = Object.entries(answers).find(([suffix]) => url.endsWith(suffix))?.[1]
    if (answer === 'throw') throw new TypeError('network')
    if (answer === 'html') return new Response('<html></html>', { headers: { 'content-type': 'text/html' } })
    return answer ? new Response(answer as Uint8Array<ArrayBuffer>) : new Response('', { status: 404 })
  })

const loose = vi.fn(async () => null)

afterEach(() => { vi.unstubAllGlobals(); loose.mockClear() })

describe('packedFetch', () => {
  it('serves the walker from a good pack, and counts what it served', async () => {
    const w = await world()
    vi.stubGlobal('fetch', serve({ [`/${ROOT}`]: text(w.packSig), [`/${w.packSig}`]: w.pack }))
    const packed = await packedFetch(ROOT, w.wanted, new Set(), [BASE], loose)
    const [sig, bytes] = w.modules[0]!
    expect([...(await packed.fetch(sig))!]).toEqual([...bytes])
    expect(packed.served()).toBe(1)
    expect(loose).not.toHaveBeenCalled()
  })

  it('never asks for a pack when a handful of files is missing — an update goes loose', async () => {
    const w = await world()
    const fetch = serve({})
    vi.stubGlobal('fetch', fetch)
    const packed = await packedFetch(ROOT, w.wanted, new Set(w.wanted.slice(0, 30)), [BASE], loose)
    expect(fetch).not.toHaveBeenCalled()
    await packed.fetch(w.wanted[35]!)
    expect(loose).toHaveBeenCalled()
  })

  it('goes loose when the host throws, answers a page, or names no pack', async () => {
    const w = await world()
    for (const pointer of ['throw', 'html', text('not a signature')] as const) {
      vi.stubGlobal('fetch', serve({ [`/${ROOT}`]: pointer }))
      const packed = await packedFetch(ROOT, w.wanted, new Set(), [BASE], loose)
      await packed.fetch(w.wanted[0]!)
      expect(packed.served()).toBe(0)
    }
    expect(loose).toHaveBeenCalledTimes(3)
  })

  it('goes loose when the pack does not hash to its pointer, or does not unpack', async () => {
    const w = await world()
    const garbage = text('not gzip at all')
    for (const served of [text('something else'), garbage]) {
      const sig = served === garbage ? await sigOf(garbage) : w.packSig
      vi.stubGlobal('fetch', serve({ [`/${ROOT}`]: text(sig), [`/${sig}`]: served }))
      const packed = await packedFetch(ROOT, w.wanted, new Set(), [BASE], loose)
      await packed.fetch(w.wanted[0]!)
      expect(packed.served()).toBe(0)
    }
  })

  it('passes over a pack for some other tree and takes the next origin\'s', async () => {
    const other = await world(40)
    const mine = await world(41)
    const second = 'https://second.test/content'
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === `${BASE}/${'c233baed976c575d7bd211b211ceb391f199b27c1c0e82bccbefffeadd9f0053'}/${ROOT}`) return new Response(text(other.packSig))
      if (url === `${BASE}/${other.packSig}`) return new Response(other.pack)
      if (url.startsWith(second) && url.endsWith(`/${ROOT}`)) return new Response(text(mine.packSig))
      if (url === `${second}/${mine.packSig}`) return new Response(mine.pack)
      return new Response('', { status: 404 })
    }))
    const packed = await packedFetch(ROOT, mine.wanted, new Set(), [BASE, second], loose)
    await packed.fetch(mine.wanted[0]!)
    expect(packed.served()).toBe(1)
  })
})
