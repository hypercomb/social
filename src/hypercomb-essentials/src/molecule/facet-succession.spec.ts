// molecule/facet-succession.spec.ts — the first facet writer, against a store fake.

import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  ;(globalThis as unknown as { window: unknown }).window = globalThis
  ;(globalThis as unknown as { ioc: unknown }).ioc = { register: () => {}, get: () => undefined, whenReady: () => {} }
  // jsdom's Blob has no `text()`; every real browser does (the same gap
  // interest-registry.spec.ts fills). The writer reads its own atoms back.
  const proto = Blob.prototype as unknown as { text?: () => Promise<string> }
  if (typeof proto.text !== 'function') {
    proto.text = function (this: Blob): Promise<string> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result ?? ''))
        reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
        reader.readAsText(this)
      })
    }
  }
})

import {
  SignatureService, facetAddress, headClaimPreimage, mintMetaEnvelope, poolKindOfMeaning, facetPreimage,
} from '@hypercomb/core'
import { _resetMintedFacetClaims, readFacetMembers, writeFacetHead, type FacetStore } from './facet-succession.js'
import type { HeadClaimSignResult } from '../sharing/head-claim-signer.js'

const PUBKEY = 'a'.repeat(64)
const SUBJECT = 'b'.repeat(64)
const N1 = 'c'.repeat(64)
const N2 = 'd'.repeat(64)

const sha = async (text: string): Promise<string> =>
  SignatureService.sign(new TextEncoder().encode(text).buffer as ArrayBuffer)

/** A store fake: content-addressed resources, one pool with author buckets. */
const fake = () => {
  const resources = new Map<string, string>()
  const buckets = new Map<string, Map<string, string>>()   // pubkey → claimSig → json
  const bucketDir = (pubkey: string): FileSystemDirectoryHandle => {
    if (!buckets.has(pubkey)) buckets.set(pubkey, new Map())
    const files = buckets.get(pubkey)!
    return {
      name: pubkey,
      kind: 'directory',
      async *entries() { for (const name of files.keys()) yield [name, { kind: 'file', getFile: async () => ({ text: async () => files.get(name) }) }] },
      getFileHandle: async (name: string) => ({
        createWritable: async () => ({ write: async (b: Uint8Array) => { files.set(name, new TextDecoder().decode(b)) }, close: async () => {} }),
      }),
    } as unknown as FileSystemDirectoryHandle
  }
  const pool = {
    name: 'facet', kind: 'directory',
    getDirectoryHandle: async (name: string) => bucketDir(name),
    async *entries() { for (const pubkey of buckets.keys()) yield [pubkey, bucketDir(pubkey)] },
  } as unknown as FileSystemDirectoryHandle
  const store: FacetStore & { openPool: (m: string) => Promise<FileSystemDirectoryHandle | null>; resources: Map<string, string>; buckets: Map<string, Map<string, string>>; pools: string[]; docs: Map<string, ArrayBuffer> } = {
    resources, buckets, pools: [],
    getPool: async (meaning) => { store.pools.push(meaning); return pool },
    // the read-only open: null until a WRITE has created the pool
    openPool: async () => (buckets.size > 0 ? pool : null),
    // the document-pool contract, for the per-device minted record
    docs: new Map<string, ArrayBuffer>(),
    putPoolDoc: async (_p, bytes, subKey) => { store.docs.set(String(subKey), bytes); return 'f'.repeat(64) },
    getPoolDoc: async (_p, subKey) => store.docs.get(String(subKey)) ?? null,
    putResource: async (blob) => { const text = await blob.text(); const sig = await sha(text); resources.set(sig, text); return sig },
    getResource: async (sig) => { const t = resources.get(sig); return t === undefined ? null : ({ text: async () => t } as unknown as Blob) },
    putArtifactMeta: async (kind, sig, incidence) => {
      const record = mintMetaEnvelope({ [kind]: sig, ...incidence })
      return store.putResource(new Blob([JSON.stringify(record)]))
    },
  }
  return store
}

/** A signer fake that produces exactly the entry shape readHeadEntry reads. */
const fakeSign = async (molecule: string, head: string, prev: string | null, seq: number): Promise<HeadClaimSignResult> => {
  const content = headClaimPreimage(molecule, PUBKEY, head, prev, seq)
  const event = { kind: 30565, pubkey: PUBKEY, content, sig: 'ee'.repeat(32), tags: [] }
  return { ok: true, pubkey: PUBKEY, claim: { head, prev, seq, sig: 'ee'.repeat(32) }, event, json: JSON.stringify(event) }
}

const write = (store: FacetStore, members: string[], pubkey: string | null = PUBKEY) =>
  writeFacetHead({ plural: 'notes', subjectSig: SUBJECT, members, store, pubkey, sign: fakeSign, now: () => 1 })

describe('writeFacetHead', () => {
  it('writes NOTHING without a cached identity — a note never mints a key', async () => {
    _resetMintedFacetClaims()
    const store = fake()
    const r = await write(store, [N1], null)
    expect(r).toEqual({ ok: false, reason: 'no identity' })
    expect(store.resources.size).toBe(0)
    expect(store.buckets.size).toBe(0)
  })

  it('mints an envelope per member with the order in its slot, one succession atom, and a genesis claim in MY bucket', async () => {
    _resetMintedFacetClaims()
    const store = fake()
    const r = await write(store, [N1, N2])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.seq).toBe(0)
    expect(r.changed).toBe(true)
    expect(r.facet).toBe(await facetAddress('notes', SUBJECT))
    // the pool was addressed by its derived meaning, declared a succession
    // (the minted record's own pool is addressed beside it)
    expect([...new Set(store.pools)]).toEqual([facetPreimage('notes', SUBJECT), 'facet:minted'])
    expect(poolKindOfMeaning(facetPreimage('notes', SUBJECT))?.kind).toBe('succession')
    // the atom
    const atom = JSON.parse(store.resources.get(r.head)!)
    expect(atom).toMatchObject({ succession: 1, signer: PUBKEY, prev: null, at: 1 })
    expect(atom.members).toHaveLength(2)
    const env0 = JSON.parse(store.resources.get(atom.members[0])!)
    const env1 = JSON.parse(store.resources.get(atom.members[1])!)
    expect(env0).toMatchObject({ meta: 1, resource: N1, relation: 'notes', root: 'notes', slot: 0 })
    expect(env1).toMatchObject({ meta: 1, resource: N2, relation: 'notes', root: 'notes', slot: 1 })
    // the claim, in my bucket, signed for the FACET address
    const bucket = store.buckets.get(PUBKEY)!
    expect(bucket.size).toBe(1)
    const entry = JSON.parse([...bucket.values()][0]!)
    expect(entry.content.split('\n')[1]).toBe(r.facet)
    expect(entry.content.split('\n')[3]).toBe(r.head)
    expect(entry.content.split('\n')[5]).toBe('0')
  })

  it('a changed list chains: seq 1, prev = the first head, and the old claim STAYS', async () => {
    _resetMintedFacetClaims()
    const store = fake()
    const first = await write(store, [N1])
    const second = await write(store, [N2, N1])
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(second.seq).toBe(1)
    const atom = JSON.parse(store.resources.get(second.head)!)
    expect(atom.prev).toBe(first.head)
    expect(store.buckets.get(PUBKEY)!.size).toBe(2)
  })

  it('an unchanged list is a no-op — same envelopes, no new atom, no new claim', async () => {
    _resetMintedFacetClaims()
    const store = fake()
    const first = await write(store, [N1, N2])
    const claimsBefore = store.buckets.get(PUBKEY)!.size
    const again = await write(store, [N1, N2])
    expect(first.ok && again.ok).toBe(true)
    if (!first.ok || !again.ok) return
    expect(again.changed).toBe(false)
    expect(again.head).toBe(first.head)
    expect(store.buckets.get(PUBKEY)!.size).toBe(claimsBefore)
  })

  it('refuses a member that is not a signature, and a subject that is not one', async () => {
    _resetMintedFacetClaims()
    const store = fake()
    expect((await write(store, ['not-a-sig'])).ok).toBe(false)
    expect((await writeFacetHead({ plural: 'notes', subjectSig: 'nope', members: [N1], store, pubkey: PUBKEY, sign: fakeSign })).ok).toBe(false)
    expect(store.resources.size).toBe(0)
  })
})

describe('readFacetMembers', () => {
  const permissive = () => () => true

  it('is null for a facet nobody has written — and OPENS, never creates', async () => {
    _resetMintedFacetClaims()
    const store = fake()
    expect(await readFacetMembers({ plural: 'notes', subjectSig: SUBJECT, store, verify: permissive })).toBeNull()
    expect(store.pools).toEqual([])
  })

  it('reads back exactly what was written, in slot order, from the verified head', async () => {
    _resetMintedFacetClaims()
    const store = fake()
    await write(store, [N2, N1])
    const read = await readFacetMembers({ plural: 'notes', subjectSig: SUBJECT, store, ownPubkey: PUBKEY, verify: permissive })
    expect(read?.members).toEqual([N2, N1])
    expect(read?.authors).toBe(1)
  })

  it('after a change, reads the NEW head — the old claim stays but does not rank', async () => {
    _resetMintedFacetClaims()
    const store = fake()
    await write(store, [N1])
    await write(store, [N2])
    const read = await readFacetMembers({ plural: 'notes', subjectSig: SUBJECT, store, verify: permissive })
    expect(read?.members).toEqual([N2])
    expect(store.buckets.get(PUBKEY)!.size).toBe(2)
  })

  it('refuses a claim whose signature does not verify — an unverified bucket contributes nothing', async () => {
    _resetMintedFacetClaims()
    const store = fake()
    await write(store, [N1])
    const read = await readFacetMembers({ plural: 'notes', subjectSig: SUBJECT, store, verify: () => () => false })
    expect(read?.members).toEqual([])
    expect(read?.authors).toBe(0)
  })
})

describe('the minted record', () => {
  it('survives a reload AND a host that is behind — the next claim chains from what THIS device signed', async () => {
    _resetMintedFacetClaims()
    const store = fake()
    const first = await write(store, [N1])
    const second = await write(store, [N2])
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(second.seq).toBe(1)
    // a reload: the cache is gone. A host that is behind: the bucket has lost
    // every claim. Only the document beside the key remembers seq 1.
    _resetMintedFacetClaims()
    store.buckets.get(PUBKEY)!.clear()
    const third = await write(store, [N1, N2])
    expect(third.ok).toBe(true)
    if (!third.ok) return
    expect(third.seq).toBe(2)
    const atom = JSON.parse(store.resources.get(third.head)!)
    expect(atom.prev).toBe(second.head)
    // the record itself is a document keyed by facet and key, never replicated
    const doc = JSON.parse(new TextDecoder().decode(store.docs.get(`${third.facet}:${PUBKEY}`)!))
    expect(doc).toMatchObject({ facet: third.facet, pubkey: PUBKEY, head: third.head, seq: 2 })
  })
})
