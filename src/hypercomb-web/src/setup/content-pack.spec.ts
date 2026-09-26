// content-pack.spec.ts — the landing pack is a head start, never an authority:
// only members whose bytes hash to their names are offered, and a host with no
// pack (or an SPA page in its place) costs nothing but the loose fetches.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeTransferPack, gzipBytes } from '@hypercomb/runtime/transfer-pack'
import { fetchContentPack } from './content-pack'

const sha = async (bytes: Uint8Array): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>))]
    .map(b => b.toString(16).padStart(2, '0')).join('')

const enc = (text: string): Uint8Array => new TextEncoder().encode(text)

afterEach(() => { vi.unstubAllGlobals() })

describe('fetchContentPack', () => {
  it('offers only members whose bytes hash to their names', async () => {
    const head = enc('{"name":"home"}')
    const child = enc('{"name":"child"}')
    const headSig = await sha(head)
    const childSig = await sha(child)
    const liar = 'f'.repeat(64)
    const pack = await gzipBytes(encodeTransferPack([[headSig, head], [childSig, child], [liar, enc('not what it says')]]))
    const asked: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      asked.push(url)
      return new Response(pack, { headers: { 'content-type': 'application/octet-stream' } })
    })
    const carried = await fetchContentPack(headSig)
    expect([...carried.keys()].sort()).toEqual([headSig, childSig].sort())
    expect(asked).toEqual([`/${await sha(enc('content:packs'))}/${headSig}`])
  })

  it('takes nothing from a host that answers with a page', async () => {
    vi.stubGlobal('fetch', async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }))
    expect((await fetchContentPack('a'.repeat(64))).size).toBe(0)
  })

  it('asks for nothing without a head', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    expect((await fetchContentPack('not-a-sig')).size).toBe(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
