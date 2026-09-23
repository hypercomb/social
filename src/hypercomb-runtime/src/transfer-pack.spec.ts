// @vitest-environment node
//
// transfer-pack.spec.ts — one file carrying many, and nothing a reader must
// trust: the format only moves bytes; the reader hashes every member against
// its own name (acquire.ts packedFetch). Node, not jsdom: jsdom's Blob has
// no .stream(), which browsers and Node both have.

import { describe, expect, it } from 'vitest'
import { decodeTransferPack, encodeTransferPack, gunzipBytes, gzipBytes } from './transfer-pack'

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)
const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)

describe('transfer pack', () => {
  it('round-trips members through gzip, byte for byte', async () => {
    const members: Array<[string, Uint8Array]> = [[B, bytes('export const b = 1;')], [A, bytes('{"cells":[]}')], [C, new Uint8Array([0, 255, 10, 13])]]
    const packed = await gzipBytes(encodeTransferPack(members))
    const back = decodeTransferPack(await gunzipBytes(packed))
    expect(back?.map(([sig, member]) => [sig, [...member]])).toEqual(
      [...members].sort(([x], [y]) => x.localeCompare(y)).map(([sig, member]) => [sig, [...member]]),
    )
  })

  it('packs the same set to the same bytes, whatever order it was handed in', () => {
    const one = encodeTransferPack([[A, bytes('a')], [B, bytes('b')]])
    const two = encodeTransferPack([[B, bytes('b')], [A, bytes('a')]])
    expect([...one]).toEqual([...two])
  })

  it('stops unpacking at its limit — a small file that inflates without end cannot take a tab', async () => {
    const bomb = await gzipBytes(new Uint8Array(4 * 1024 * 1024))
    expect(bomb.byteLength).toBeLessThan(64 * 1024)
    await expect(gunzipBytes(bomb, 1024 * 1024)).rejects.toThrow(/unpacks past/)
    expect((await gunzipBytes(bomb)).byteLength).toBe(4 * 1024 * 1024)
  })

  it('refuses bytes that are not a pack, or a pack cut short', () => {
    expect(decodeTransferPack(bytes('hello'))).toBeNull()
    expect(decodeTransferPack(bytes('not-a-pack 1\n[]\n'))).toBeNull()
    const whole = encodeTransferPack([[A, bytes('abcdef')]])
    expect(decodeTransferPack(whole.slice(0, whole.byteLength - 2))).toBeNull()
  })
})
