// sharing/derive.spec.ts — the `derive` word's lines, and what counts as an
// attestation: a key the host lists counts only when its own signed index
// still names an attestation of exactly this record, and that record hashes to
// the signature its index names.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SignatureService } from '@hypercomb/core'

const RECORD = 'a'.repeat(64)
const ALICE = '1'.repeat(64), BOB = '2'.repeat(64), CAROL = '3'.repeat(64)
let indexes: Record<string, Record<string, string>>
let heap: Map<string, Uint8Array>
let listed: string[]

vi.mock('./hive-pointer.js', () => ({
  fetchHiveIndex: async (_host: string, pubkey: string) => indexes[pubkey]
    ? { ok: true, manifest: { roots: indexes[pubkey], createdAt: 1, pubkey } }
    : { ok: false, reason: 'http', status: 404 },
  setHiveRoot: async () => ({ ok: true }),
}))

;(window as unknown as { ioc: unknown }).ioc = { register: () => void 0, get: () => undefined }

const { parseDeriveArgs } = await import('./derive.queen.js')
const { attestationText, hostBase, parseAttestation, readAttestations } = await import('./derivation-attestation.js')

const put = async (text: string): Promise<string> => {
  const bytes = new TextEncoder().encode(text)
  const sig = await SignatureService.sign(bytes.buffer as ArrayBuffer)
  heap.set(sig, bytes)
  return sig
}

beforeEach(() => {
  indexes = {}
  heap = new Map()
  listed = []
  globalThis.fetch = vi.fn(async (url: string | URL) => {
    const path = new URL(String(url)).pathname
    const sig = path.replace(/^\/(content\/)?/, '')
    if (path.endsWith('/')) return new Response(listed.map(k => `${k}\n`).join(''), { status: 200 })
    const bytes = heap.get(sig)
    return bytes ? new Response(bytes, { status: 200 }) : new Response('', { status: 404 })
  }) as unknown as typeof fetch
})

describe('derive lines', () => {
  it('reads the verb, the record, the outcome and the host', () => {
    expect(parseDeriveArgs('@example.com')).toEqual({ verb: 'read', record: '', outcome: '', host: 'example.com' })
    expect(parseDeriveArgs(`verify ${RECORD} @example.com`)).toMatchObject({ verb: 'verify', record: RECORD, host: 'example.com' })
    expect(parseDeriveArgs(`attest ${RECORD} reproduced @example.com`)).toMatchObject({ verb: 'attest', record: RECORD, outcome: 'reproduced' })
    expect(parseDeriveArgs(`attest ${RECORD} differs`)).toMatchObject({ verb: 'attest', outcome: 'differs', host: '' })
    expect(parseDeriveArgs('on colony.hypercomb.com')).toEqual({ verb: 'read', record: '', outcome: '', host: 'colony.hypercomb.com' })
    expect(parseDeriveArgs(`verify ${RECORD} on example.com`)).toMatchObject({ verb: 'verify', record: RECORD, host: 'example.com' })
    expect(parseDeriveArgs(`attest ${RECORD} reproduced on example.com`)).toMatchObject({ verb: 'attest', outcome: 'reproduced', host: 'example.com' })
  })

  it('reaches a loopback host over http and every other host over https', () => {
    expect(hostBase('localhost:4778')).toBe('http://localhost:4778')
    expect(hostBase('https://colony.hypercomb.com/')).toBe('https://colony.hypercomb.com')
  })
})

describe('an attestation', () => {
  it('is believed only for exactly the record it names, with an outcome it may have', () => {
    const text = attestationText(RECORD, 'reproduced', { got: RECORD, ran: 'esbuild-wasm@0.27.3' })
    expect(parseAttestation(text, RECORD)).toMatchObject({ kind: 'derivation-attestation', record: RECORD, outcome: 'reproduced', ran: 'esbuild-wasm@0.27.3' })
    expect(parseAttestation(text, 'b'.repeat(64))).toBeNull()
    expect(parseAttestation(text.replace('reproduced', 'maybe'), RECORD)).toBeNull()
    expect(parseAttestation('not json', RECORD)).toBeNull()
  })

  it('counts a listed key only when its own index still names a record that hashes right', async () => {
    const good = await put(attestationText(RECORD, 'reproduced'))
    const other = await put(attestationText('b'.repeat(64), 'reproduced'))
    indexes[ALICE] = { [`attest:${RECORD}`]: good }                // counts
    indexes[BOB] = { [`attest:${RECORD}`]: other }                 // names an attestation of another record
    indexes[CAROL] = {}                                            // dropped the entry
    listed = [ALICE, BOB, CAROL, 'not-a-key']
    const found = await readAttestations('example.com', RECORD)
    expect(found.map(a => a.pubkey)).toEqual([ALICE])
    expect(found[0]!.attestation.outcome).toBe('reproduced')
  })

  it('a record whose bytes do not hash to the signature the index names is not counted', async () => {
    const good = await put(attestationText(RECORD, 'reproduced'))
    heap.set(good, new TextEncoder().encode(attestationText(RECORD, 'differs')))   // the host serves other bytes under that name
    indexes[ALICE] = { [`attest:${RECORD}`]: good }
    listed = [ALICE]
    expect(await readAttestations('example.com', RECORD)).toEqual([])
  })
})
