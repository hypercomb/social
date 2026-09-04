// molecule/vocabulary-search.hostile-host.spec.ts
//
// ADVERSARIAL, AND NO NETWORK. Every host here is a Map; every signature is a
// real ed25519 signature over the real preimage. The claim under test is the
// one the whole capability rests on:
//
//   "UNKNOWN NEVER COLLAPSES INTO NO."
//
// So the fixtures are the five ways a host can lie or fail, and every one of
// them must land on `unknown` with a NAMED reason — never on `absent`, and
// never on a hang. The one fixture that IS allowed to produce `absent` is the
// genuine empty: a claim whose signed `complete` is true and whose verified
// body does not name the word.

import { describe, expect, it, vi } from 'vitest'
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
  unknownCount,
  type VocabularyAtomRead,
  type VocabularyFinding,
  type VocabularySearchDeps,
} from './vocabulary-search.js'

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')
const hex = (n: number): string => n.toString(16).padStart(64, '0')

const SURFACE = sha('vocabulary:hive')
const COFFEE = sha('coffee')
const TEA = sha('tea')

// ── identities ─────────────────────────────────────────────────────────────

interface Identity {
  pubkey: string
  publicKey: KeyObject
  sign: (msg: string) => string
}

const identity = (): Identity => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32)
  return {
    pubkey: raw.toString('hex'),
    publicKey,
    sign: (msg) => nodeSign(null, Buffer.from(msg, 'utf8'), privateKey).toString('hex'),
  }
}

/** Every key the WORLD knows. The verifier is deliberately willing to check
 *  against any of them — so a refusal is never "the reader lacked a key", it
 *  is the address binding doing its job. */
const world = new Map<string, KeyObject>()
const enrol = (id: Identity): Identity => { world.set(id.pubkey, id.publicKey); return id }

/** The essentials binding, restated in the spec's own transport so this file
 *  does not need nostr-tools: kind is implicit, then the event's DECLARED
 *  pubkey must be the key the reader ASKED FOR, then the sig, then the signed
 *  content must be the preimage the reader REBUILT — and only then the curve. */
const verifierFor = (evt: Record<string, unknown>): VocabularyClaimVerifier =>
  (pubkey, preimage, sig) => {
    if (String(evt?.['pubkey'] ?? '') !== pubkey) return false
    if (String(evt?.['sig'] ?? '') !== sig) return false
    if (String(evt?.['content'] ?? '') !== preimage) return false
    const key = world.get(pubkey)
    if (!key) return false
    try {
      return nodeVerify(null, Buffer.from(preimage, 'utf8'), key, Buffer.from(sig, 'hex'))
    } catch { return false }
  }

const readClaim = (
  text: string,
): { offered: OfferedVocabularyClaim; event: Record<string, unknown> } | null => {
  let evt: Record<string, unknown>
  try { evt = JSON.parse(text) as Record<string, unknown> } catch { return null }
  const parsed = parseVocabularyClaimPreimage(String(evt?.['content'] ?? ''))
  if (!parsed) return null
  return {
    offered: {
      body: parsed.body, prev: parsed.prev, seq: parsed.seq,
      count: parsed.count, complete: parsed.complete,
      sig: String(evt['sig'] ?? '').toLowerCase(),
    },
    event: evt,
  }
}

// ── a host that is entirely a Map ──────────────────────────────────────────

class FakeHost {
  readonly atoms = new Map<string, string>()
  index: HiveIndexResult = { ok: false, reason: 'http', status: 404 }
  /** Never resolves — the blackholed host. */
  stall = false

  put(text: string): string {
    const sig = sha(text)
    this.atoms.set(sig, text)
    return sig
  }

  /** Serve bytes at a sig they do NOT hash to. */
  substitute(sig: string, text: string): void { this.atoms.set(sig, text) }

  names(pubkey: string, claimSig: string, createdAt = 1): void {
    this.index = {
      ok: true,
      manifest: { roots: { [VOCABULARY_ROOT_KEY]: claimSig }, createdAt, pubkey },
    }
  }
}

/** Mint a signed claim + its body onto a host, and return the claim's sig. */
const publishOnto = (
  host: FakeHost,
  id: Identity,
  words: readonly string[],
  seq: number,
  prev: string | null,
  complete: boolean,
  surface = SURFACE,
): { claimSig: string; bodySig: string } => {
  const body = encodeVocabularyBody(canonicalVocabularyBody(id.pubkey, words)!)
  const bodySig = host.put(body)
  const count = canonicalVocabularyBody(id.pubkey, words)!.words.length
  const content = vocabularyClaimPreimage(id.pubkey, surface, bodySig, prev, seq, count, complete)
  const claimSig = host.put(JSON.stringify({ pubkey: id.pubkey, content, sig: id.sign(content) }))
  host.names(id.pubkey, claimSig)
  return { claimSig, bodySig }
}

const depsFor = (
  hosts: Record<string, FakeHost>,
  extra: Partial<VocabularySearchDeps> = {},
): VocabularySearchDeps => ({
  surface: SURFACE,
  readIndex: async (host) => {
    const h = hosts[host]
    if (!h) return { ok: false, reason: 'unreachable' }
    if (h.stall) return await new Promise<HiveIndexResult>(() => { /* forever */ })
    return h.index
  },
  readAtom: async (host, sig): Promise<VocabularyAtomRead> => {
    const h = hosts[host]
    if (!h) return { ok: false, reason: 'absent' }
    if (h.stall) return await new Promise<VocabularyAtomRead>(() => { /* forever */ })
    const text = h.atoms.get(sig)
    if (text === undefined) return { ok: false, reason: 'absent' }
    // The reader ALWAYS checks the bytes against their own address.
    if (sha(text) !== sig) return { ok: false, reason: 'mismatch' }
    return { ok: true, text }
  },
  readClaim,
  verifierFor,
  ...extra,
})

const one = (findings: readonly VocabularyFinding[]): VocabularyFinding => {
  expect(findings).toHaveLength(1)
  return findings[0] as VocabularyFinding
}

// ═══════════════════════════════════════════════════════════════════════════

describe('vocabulary search — the honest-absence contract', () => {

  it('DECLARED: a claim verified at the address the reader asked for', async () => {
    const alice = enrol(identity())
    const host = new FakeHost()
    publishOnto(host, alice, [COFFEE, TEA], 0, null, true)

    const search = await searchVocabulary(
      COFFEE,
      foldHorizon([{ pubkey: alice.pubkey, hosts: ['a.example'] }]),
      depsFor({ 'a.example': host }),
    )
    const found = one(search.findings)
    expect(found.verdict).toBe('declared')
    expect(found.why).toBeNull()
    expect(found.host).toBe('a.example')
    expect(found.seq).toBe(0)
    expect(found.complete).toBe(true)
    expect(found.evidence?.pubkey).toBe(alice.pubkey)
    expect(unknownCount(search)).toBe(0)
  })

  it('ABSENT: a genuine empty — a COMPLETE claim whose verified body omits the word', async () => {
    const alice = enrol(identity())
    const host = new FakeHost()
    publishOnto(host, alice, [TEA], 0, null, true)

    const search = await searchVocabulary(
      COFFEE,
      foldHorizon([{ pubkey: alice.pubkey, hosts: ['a.example'] }]),
      depsFor({ 'a.example': host }),
    )
    const found = one(search.findings)
    expect(found.verdict).toBe('absent')
    expect(found.why).toBeNull()
    // THE PROOF RIDES WITH THE ANSWER. An absence cannot be constructed
    // without the verified claim it was derived from.
    expect(found.evidence).not.toBeNull()
    expect(found.evidence?.complete).toBe(true)
  })

  it('ABSENT survives a withdrawal: an empty complete claim at a higher seq', async () => {
    const alice = enrol(identity())
    const host = new FakeHost()
    const first = publishOnto(host, alice, [COFFEE], 0, null, true)
    publishOnto(host, alice, [], 1, first.bodySig, true)

    const search = await searchVocabulary(
      COFFEE,
      foldHorizon([{ pubkey: alice.pubkey, hosts: ['a.example'] }]),
      depsFor({ 'a.example': host }),
    )
    expect(one(search.findings).verdict).toBe('absent')
  })

  it('UNSIGNED: the SAME genuine claim served when the reader asked for someone else', async () => {
    const alice = enrol(identity())
    const mallory = enrol(identity())
    const host = new FakeHost()
    // Alice's real bytes, real signature — but the index the reader reads is
    // Mallory's, and the host hands over Alice's claim.
    const body = encodeVocabularyBody(canonicalVocabularyBody(alice.pubkey, [COFFEE])!)
    const bodySig = host.put(body)
    const content = vocabularyClaimPreimage(alice.pubkey, SURFACE, bodySig, null, 0, 1, true)
    const claimSig = host.put(JSON.stringify({ pubkey: alice.pubkey, content, sig: alice.sign(content) }))
    host.names(mallory.pubkey, claimSig)

    const search = await searchVocabulary(
      COFFEE,
      foldHorizon([{ pubkey: mallory.pubkey, hosts: ['a.example'] }]),
      depsFor({ 'a.example': host }),
    )
    const found = one(search.findings)
    expect(found.verdict).toBe('unknown')
    expect(found.why).toBe('unsigned')
    expect(found.evidence).toBeNull()
  })

  it('UNSIGNED: a genuine claim minted for a DIFFERENT surface', async () => {
    const alice = enrol(identity())
    const host = new FakeHost()
    publishOnto(host, alice, [COFFEE], 0, null, true, hex(0xbeef))

    const found = one((await searchVocabulary(
      COFFEE,
      foldHorizon([{ pubkey: alice.pubkey, hosts: ['a.example'] }]),
      depsFor({ 'a.example': host }),
    )).findings)
    expect(found.verdict).toBe('unknown')
    expect(found.why).toBe('unsigned')
  })

  it('REGRESSED: a replayed older claim, against a seq this reader already proved', async () => {
    const alice = enrol(identity())
    const host = new FakeHost()
    const first = publishOnto(host, alice, [TEA], 0, null, true)
    // generation 1 exists and holds coffee — but the host serves generation 0.
    publishOnto(host, alice, [COFFEE, TEA], 1, first.bodySig, true)
    host.names(alice.pubkey, first.claimSig)

    const found = one((await searchVocabulary(
      COFFEE,
      foldHorizon([{ pubkey: alice.pubkey, hosts: ['a.example'] }]),
      depsFor({ 'a.example': host }, { provenSeq: () => 1 }),
    )).findings)
    // Behind is UNKNOWN — and above all NOT the `absent` that the replayed
    // complete generation-0 claim would otherwise have licensed.
    expect(found.verdict).toBe('unknown')
    expect(found.why).toBe('regressed')
    expect(found.seq).toBe(0)
  })

  it('a replay LOSES when another door serves the newer claim — rank across doors, never first-wins', async () => {
    const alice = enrol(identity())
    const stale = new FakeHost()
    const fresh = new FakeHost()
    const first = publishOnto(stale, alice, [TEA], 0, null, true)
    // the same generation-0 bytes plus the real generation 1, on a second door
    fresh.atoms.set(first.bodySig, stale.atoms.get(first.bodySig)!)
    publishOnto(fresh, alice, [COFFEE, TEA], 1, first.bodySig, true)

    const found = one((await searchVocabulary(
      COFFEE,
      foldHorizon([{ pubkey: alice.pubkey, hosts: ['stale.example', 'fresh.example'] }]),
      depsFor({ 'stale.example': stale, 'fresh.example': fresh }),
    )).findings)
    expect(found.verdict).toBe('declared')
    expect(found.seq).toBe(1)
    expect(found.host).toBe('fresh.example')
    // The losing door is REPORTED, not erased.
    expect(found.doors.map((d) => d.seq).sort()).toEqual([0, 1])
  })

  it('BODY-MISMATCH: one address appended to the body under a valid signature', async () => {
    const alice = enrol(identity())
    const host = new FakeHost()
    const minted = publishOnto(host, alice, [TEA], 0, null, true)
    // The host swaps the body for a padded one, at the SIGNED address.
    host.substitute(
      minted.bodySig,
      encodeVocabularyBody(canonicalVocabularyBody(alice.pubkey, [TEA, COFFEE])!),
    )

    const found = one((await searchVocabulary(
      COFFEE,
      foldHorizon([{ pubkey: alice.pubkey, hosts: ['a.example'] }]),
      depsFor({ 'a.example': host }),
    )).findings)
    expect(found.verdict).toBe('unknown')
    expect(found.why).toBe('body-mismatch')
  })

  it('BODY-MISMATCH: one address REMOVED from the body under a valid signature', async () => {
    const alice = enrol(identity())
    const host = new FakeHost()
    const minted = publishOnto(host, alice, [TEA, COFFEE], 0, null, true)
    host.substitute(
      minted.bodySig,
      encodeVocabularyBody(canonicalVocabularyBody(alice.pubkey, [TEA])!),
    )

    const found = one((await searchVocabulary(
      COFFEE,
      foldHorizon([{ pubkey: alice.pubkey, hosts: ['a.example'] }]),
      depsFor({ 'a.example': host }),
    )).findings)
    // Removing a word cannot buy the attacker an ABSENCE — it buys them a
    // reader who knows the host is wrong.
    expect(found.verdict).toBe('unknown')
    expect(found.why).toBe('body-mismatch')
  })

  it('BODY-ABSENT: the claim verifies and the host withholds the body', async () => {
    const alice = enrol(identity())
    const host = new FakeHost()
    const minted = publishOnto(host, alice, [TEA], 0, null, true)
    host.atoms.delete(minted.bodySig)

    const found = one((await searchVocabulary(
      COFFEE,
      foldHorizon([{ pubkey: alice.pubkey, hosts: ['a.example'] }]),
      depsFor({ 'a.example': host }),
    )).findings)
    expect(found.verdict).toBe('unknown')
    expect(found.why).toBe('body-absent')
  })

  it('UNREACHABLE: a host that is not there is UNKNOWN, never ABSENT', async () => {
    const alice = enrol(identity())
    const found = one((await searchVocabulary(
      COFFEE,
      foldHorizon([{ pubkey: alice.pubkey, hosts: ['gone.example'] }]),
      depsFor({}),
    )).findings)
    expect(found.verdict).toBe('unknown')
    expect(found.why).toBe('unreachable')
    expect(found.evidence).toBeNull()
  })

  it('NO-CLAIM: a verified index that names no vocabulary is UNKNOWN, not ABSENT', async () => {
    const alice = enrol(identity())
    const host = new FakeHost()
    host.index = {
      ok: true,
      manifest: { roots: { 'install:essentials': hex(7) }, createdAt: 1, pubkey: alice.pubkey },
    }

    const found = one((await searchVocabulary(
      COFFEE,
      foldHorizon([{ pubkey: alice.pubkey, hosts: ['a.example'] }]),
      depsFor({ 'a.example': host }),
    )).findings)
    expect(found.verdict).toBe('unknown')
    expect(found.why).toBe('no-claim')
  })

  it('NO-INDEX and INDEX-UNSAFE are their own facts, and neither is an absence', async () => {
    const alice = enrol(identity())
    const silent = new FakeHost()                                     // 404
    const forged = new FakeHost()
    forged.index = { ok: false, reason: 'forged' }

    const a = one((await searchVocabulary(
      COFFEE, foldHorizon([{ pubkey: alice.pubkey, hosts: ['s.example'] }]),
      depsFor({ 's.example': silent }),
    )).findings)
    expect(a.verdict).toBe('unknown')
    expect(a.why).toBe('no-index')

    const b = one((await searchVocabulary(
      COFFEE, foldHorizon([{ pubkey: alice.pubkey, hosts: ['f.example'] }]),
      depsFor({ 'f.example': forged }),
    )).findings)
    expect(b.verdict).toBe('unknown')
    expect(b.why).toBe('index-unsafe')
  })

  it('PARTIAL: an authentic claim that admits it is incomplete and does not name the word', async () => {
    const alice = enrol(identity())
    const host = new FakeHost()
    publishOnto(host, alice, [TEA], 0, null, false)

    const found = one((await searchVocabulary(
      COFFEE,
      foldHorizon([{ pubkey: alice.pubkey, hosts: ['a.example'] }]),
      depsFor({ 'a.example': host }),
    )).findings)
    expect(found.verdict).toBe('unknown')
    expect(found.why).toBe('partial')
    expect(found.complete).toBe(false)
  })

  it('a PARTIAL claim that DOES name the word is still a positive', async () => {
    const alice = enrol(identity())
    const host = new FakeHost()
    publishOnto(host, alice, [COFFEE], 0, null, false)

    const found = one((await searchVocabulary(
      COFFEE,
      foldHorizon([{ pubkey: alice.pubkey, hosts: ['a.example'] }]),
      depsFor({ 'a.example': host }),
    )).findings)
    expect(found.verdict).toBe('declared')
    expect(found.complete).toBe(false)
  })

  it('NO-KEY: a horizon entry with no publisher key is still a row', async () => {
    const found = one((await searchVocabulary(
      COFFEE,
      foldHorizon([{ pubkey: 'not-a-key', hosts: ['a.example'] }]),
      depsFor({}),
    )).findings)
    expect(found.verdict).toBe('unknown')
    expect(found.why).toBe('no-key')
  })

  it('a malformed ADDRESS fails toward UNKNOWN, never toward an empty list', async () => {
    const alice = enrol(identity())
    const search = await searchVocabulary(
      'coffee',                                  // a word, not an address
      foldHorizon([{ pubkey: alice.pubkey, hosts: ['a.example'] }]),
      depsFor({ 'a.example': new FakeHost() }),
    )
    const found = one(search.findings)
    expect(found.verdict).toBe('unknown')
    expect(found.why).toBe('malformed')
  })
})

describe('the row set is fixed before any I/O', () => {

  it('a dead host FILLS a row and can never delete one', async () => {
    const alice = enrol(identity())
    const bob = enrol(identity())
    const carol = enrol(identity())
    const host = new FakeHost()
    publishOnto(host, alice, [COFFEE], 0, null, true)

    const search = await searchVocabulary(
      COFFEE,
      foldHorizon([
        { pubkey: alice.pubkey, hosts: ['a.example'] },
        { pubkey: bob.pubkey, hosts: ['gone.example'] },
        { pubkey: carol.pubkey, hosts: [] },
      ]),
      depsFor({ 'a.example': host }),
    )
    expect(search.findings).toHaveLength(3)
    expect(search.findings.map((f) => f.verdict)).toEqual(['declared', 'unknown', 'unknown'])
    expect(unknownCount(search)).toBe(2)
  })

  it('a thrown reader is a row, not an exception and not an absence', async () => {
    const alice = enrol(identity())
    const search = await searchVocabulary(
      COFFEE,
      foldHorizon([{ pubkey: alice.pubkey, hosts: ['a.example'] }]),
      depsFor({}, { readIndex: async () => { throw new Error('DNS exploded') } }),
    )
    const found = one(search.findings)
    expect(found.verdict).toBe('unknown')
    expect(found.why).toBe('unreachable')
  })

  it('the result carries no field whose emptiness could read as "nobody has it"', async () => {
    const alice = enrol(identity())
    const search = await searchVocabulary(
      COFFEE, foldHorizon([{ pubkey: alice.pubkey, hosts: ['gone.example'] }]), depsFor({}),
    )
    expect(Object.keys(search).sort()).toEqual(['address', 'findings'])
    // and the invariant that makes `why` unforgeable
    for (const f of search.findings) {
      expect(f.verdict === 'unknown').toBe(f.why !== null)
    }
  })
})

describe('never block', () => {

  it('a host that never answers degrades to UNKNOWN when the deadline passes', async () => {
    vi.useFakeTimers()
    try {
      const alice = enrol(identity())
      const dead = new FakeHost()
      dead.stall = true

      const running = searchVocabulary(
        COFFEE,
        foldHorizon([{ pubkey: alice.pubkey, hosts: ['stall.example'] }]),
        depsFor({ 'stall.example': dead }),
      )
      await vi.advanceTimersByTimeAsync(30_000)
      const found = one((await running).findings)
      expect(found.verdict).toBe('unknown')
      expect(found.why).toBe('unreachable')
    } finally {
      vi.useRealTimers()
    }
  })

  it('one stalled publisher does not stop a live one from answering', async () => {
    vi.useFakeTimers()
    try {
      const alice = enrol(identity())
      const bob = enrol(identity())
      const live = new FakeHost()
      const dead = new FakeHost()
      dead.stall = true
      publishOnto(live, alice, [COFFEE], 0, null, true)

      const running = searchVocabulary(
        COFFEE,
        foldHorizon([
          { pubkey: bob.pubkey, hosts: ['stall.example'] },
          { pubkey: alice.pubkey, hosts: ['a.example'] },
        ]),
        depsFor({ 'a.example': live, 'stall.example': dead }),
      )
      await vi.advanceTimersByTimeAsync(30_000)
      const search = await running
      expect(search.findings.map((f) => f.verdict)).toEqual(['unknown', 'declared'])
    } finally {
      vi.useRealTimers()
    }
  })
})
