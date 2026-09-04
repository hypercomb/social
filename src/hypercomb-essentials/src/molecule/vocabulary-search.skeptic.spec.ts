// molecule/vocabulary-search.skeptic.spec.ts
//
// ADVERSARIAL REVIEW — THE LYING HOST.
//
// The contract under test: an ABSENCE may only ever be minted from the
// publisher's CURRENT claim. If the reader holds an authentic claim at a
// HIGHER seq than the claim it is about to mint "no" from, it does not know —
// it merely failed to read the newer one.

import { describe, expect, it } from 'vitest'
import { createHash, generateKeyPairSync, sign as nodeSign, verify as nodeVerify } from 'node:crypto'
import type { KeyObject } from 'node:crypto'

import {
  canonicalVocabularyBody,
  encodeVocabularyBody,
  parseVocabularyClaimPreimage,
  vocabularyClaimPreimage,
  type OfferedVocabularyClaim,
  type VocabularyClaimVerifier,
} from '@hypercomb/core'
import type { HiveIndexResult } from '../sharing/hive-pointer.js'
import { VOCABULARY_ROOT_KEY } from '../sharing/hive-link.js'
import {
  foldHorizon,
  searchVocabulary,
  type VocabularyAtomRead,
  type VocabularySearchDeps,
} from './vocabulary-search.js'

const sha = (t: string): string => createHash('sha256').update(t, 'utf8').digest('hex')
const SURFACE = sha('vocabulary:hive')
const COFFEE = sha('coffee')
const TEA = sha('tea')

interface Identity { pubkey: string; publicKey: KeyObject; sign: (m: string) => string }
const world = new Map<string, KeyObject>()
const identity = (): Identity => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32)
  const id = { pubkey: raw.toString('hex'), publicKey, sign: (m: string) => nodeSign(null, Buffer.from(m, 'utf8'), privateKey).toString('hex') }
  world.set(id.pubkey, publicKey)
  return id
}
const verifierFor = (evt: Record<string, unknown>): VocabularyClaimVerifier => (pubkey, preimage, sig) => {
  if (String(evt?.['pubkey'] ?? '') !== pubkey) return false
  if (String(evt?.['sig'] ?? '') !== sig) return false
  if (String(evt?.['content'] ?? '') !== preimage) return false
  const key = world.get(pubkey)
  if (!key) return false
  try { return nodeVerify(null, Buffer.from(preimage, 'utf8'), key, Buffer.from(sig, 'hex')) } catch { return false }
}
const readClaim = (text: string): { offered: OfferedVocabularyClaim; event: Record<string, unknown> } | null => {
  let evt: Record<string, unknown>
  try { evt = JSON.parse(text) as Record<string, unknown> } catch { return null }
  const p = parseVocabularyClaimPreimage(String(evt?.['content'] ?? ''))
  if (!p) return null
  return { offered: { body: p.body, prev: p.prev, seq: p.seq, count: p.count, complete: p.complete, sig: String(evt['sig'] ?? '').toLowerCase() }, event: evt }
}

class FakeHost {
  readonly atoms = new Map<string, string>()
  index: HiveIndexResult = { ok: false, reason: 'http', status: 404 }
  put(text: string): string { const s = sha(text); this.atoms.set(s, text); return s }
  names(pubkey: string, claimSig: string): void {
    this.index = { ok: true, manifest: { roots: { [VOCABULARY_ROOT_KEY]: claimSig }, createdAt: 1, pubkey } }
  }
}

const mint = (id: Identity, words: readonly string[], seq: number, prev: string | null, complete: boolean) => {
  const rec = canonicalVocabularyBody(id.pubkey, words)!
  const body = encodeVocabularyBody(rec)
  const bodySig = sha(body)
  const content = vocabularyClaimPreimage(id.pubkey, SURFACE, bodySig, prev, seq, rec.words.length, complete)
  const claim = JSON.stringify({ pubkey: id.pubkey, content, sig: id.sign(content) })
  return { body, bodySig, claim, claimSig: sha(claim) }
}

const depsFor = (hosts: Record<string, FakeHost>, extra: Partial<VocabularySearchDeps> = {}): VocabularySearchDeps => ({
  surface: SURFACE,
  readIndex: async (host) => hosts[host]?.index ?? { ok: false, reason: 'unreachable' },
  readAtom: async (host, sig): Promise<VocabularyAtomRead> => {
    const t = hosts[host]?.atoms.get(sig)
    if (t === undefined) return { ok: false, reason: 'absent' }
    if (sha(t) !== sig) return { ok: false, reason: 'mismatch' }
    return { ok: true, text: t }
  },
  readClaim, verifierFor, ...extra,
})

describe('SKEPTIC — an absence must come from the CURRENT claim', () => {

  it('a stale door mints ABSENT while a NEWER authentic claim was seen but unreadable', async () => {
    const alice = identity()
    const gen0 = mint(alice, [TEA], 0, null, true)              // complete, no coffee
    const gen1 = mint(alice, [COFFEE, TEA], 1, gen0.bodySig, true) // complete, HAS coffee

    // Door A: an old (or replayed) generation 0, fully readable.
    const stale = new FakeHost()
    stale.put(gen0.body); stale.put(gen0.claim); stale.names(alice.pubkey, gen0.claimSig)

    // Door B: the CURRENT generation 1 claim — but its body atom has not
    // replicated yet (or the host withholds it). Entirely realistic.
    const fresh = new FakeHost()
    fresh.put(gen1.claim); fresh.names(alice.pubkey, gen1.claimSig)

    const found = (await searchVocabulary(
      COFFEE,
      foldHorizon([{ pubkey: alice.pubkey, hosts: ['stale.example', 'fresh.example'] }]),
      depsFor({ 'stale.example': stale, 'fresh.example': fresh }),
    )).findings[0]!

    // The reader HOLDS an authentic seq-1 claim. It cannot possibly know that
    // coffee is absent; it only failed to read generation 1's body.
    expect(found.verdict).not.toBe('absent')
    expect(found.verdict).toBe('unknown')
  })

  it('a stale door mints DECLARED after the publisher WITHDREW the word', async () => {
    const alice = identity()
    const gen0 = mint(alice, [COFFEE, TEA], 0, null, true)   // had coffee
    const gen1 = mint(alice, [TEA], 1, gen0.bodySig, true)   // withdrew it

    const stale = new FakeHost()
    stale.put(gen0.body); stale.put(gen0.claim); stale.names(alice.pubkey, gen0.claimSig)

    const fresh = new FakeHost()
    fresh.put(gen1.claim); fresh.names(alice.pubkey, gen1.claimSig) // body withheld

    const found = (await searchVocabulary(
      COFFEE,
      foldHorizon([{ pubkey: alice.pubkey, hosts: ['stale.example', 'fresh.example'] }]),
      depsFor({ 'stale.example': stale, 'fresh.example': fresh }),
    )).findings[0]!

    // A superseded generation must not be reported as the publisher's word.
    expect(found.verdict).toBe('unknown')
  })

  it('provenSeq does NOT save it: proven == the winner seq, absence still minted from generation 0', async () => {
    const alice = identity()
    const gen0 = mint(alice, [TEA], 0, null, true)
    const gen1 = mint(alice, [COFFEE, TEA], 1, gen0.bodySig, true)

    const stale = new FakeHost()
    stale.put(gen0.body); stale.put(gen0.claim); stale.names(alice.pubkey, gen0.claimSig)
    const fresh = new FakeHost()
    fresh.put(gen1.claim); fresh.names(alice.pubkey, gen1.claimSig)

    const found = (await searchVocabulary(
      COFFEE,
      foldHorizon([{ pubkey: alice.pubkey, hosts: ['stale.example', 'fresh.example'] }]),
      depsFor({ 'stale.example': stale, 'fresh.example': fresh }, { provenSeq: () => 1 }),
    )).findings[0]!
    expect(found.verdict).not.toBe('absent')
  })
})
