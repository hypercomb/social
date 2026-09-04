// core/vocabulary-claim.spec.ts
//
// The claim is the whole of the trust boundary, so these pin the BYTES and the
// two properties everything above rests on:
//
//   PLACEMENT  a genuine claim by A, offered at B's address, never verifies —
//              and the check is not a comparison anyone can delete, because the
//              reader RENDERS the address it asked for into the preimage.
//   ABSENCE    `membershipOf` is the ONE place "no" is minted, and it mints it
//              only from a claim whose signed `complete` is true.
//
// The verifier is a real ed25519 signature over the preimage string. That is
// not the transport (essentials rides a nostr event), but it is the same
// contract: sign EXACTLY the preimage, verify against the key the reader asked
// for.

import { describe, expect, it } from 'vitest'
import { createHash, generateKeyPairSync, sign as nodeSign, verify as nodeVerify } from 'node:crypto'

import {
  MAX_CLAIM_WORDS,
  VOCABULARY_CLAIM_V1,
  acceptVocabularyClaim,
  canonicalVocabularyBody,
  encodeVocabularyBody,
  membershipOf,
  parseVocabularyBody,
  parseVocabularyClaimPreimage,
  planVocabularyClaim,
  resolveVocabularyClaim,
  vocabularyBodyHolds,
  vocabularyClaimPreimage,
  vocabularyRegressions,
  type OfferedVocabularyClaim,
  type VocabularyClaimVerifier,
} from './vocabulary-claim.js'

const hex = (n: number): string => n.toString(16).padStart(64, '0')
const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

// ── a real key, used as a 64-hex "pubkey" the way the rest of the system does
interface Identity { pubkey: string; sign: (msg: string) => string; verify: VocabularyClaimVerifier }

const identity = (): Identity => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32)
  const pubkey = raw.toString('hex')
  const keys = new Map<string, typeof publicKey>()
  keys.set(pubkey, publicKey)
  return {
    pubkey,
    sign: (msg) => nodeSign(null, Buffer.from(msg, 'utf8'), privateKey).toString('hex'),
    verify: (pubkeyHex, preimage, sigHex) => {
      const key = keys.get(pubkeyHex)
      if (!key) return false
      try {
        return nodeVerify(null, Buffer.from(preimage, 'utf8'), key, Buffer.from(sigHex, 'hex'))
      } catch { return false }
    },
  }
}

/** A verifier that will try EVERY key it knows — the hostile case, where the
 *  host serves a genuinely signed claim and hopes the address is not checked. */
const anyOf = (...ids: Identity[]): VocabularyClaimVerifier =>
  async (pubkeyHex, preimage, sigHex) => {
    for (const id of ids) if (await id.verify(pubkeyHex, preimage, sigHex)) return true
    return false
  }

const SURFACE = hex(0xfeed)

const mint = (
  id: Identity,
  surface: string,
  body: string,
  prev: string | null,
  seq: number,
  count: number,
  complete: boolean,
): OfferedVocabularyClaim => ({
  body,
  prev,
  seq,
  count,
  complete,
  sig: id.sign(vocabularyClaimPreimage(id.pubkey, surface, body, prev, seq, count, complete)),
})

describe('the vocabulary claim preimage', () => {

  it('is exactly eight lines in a fixed order with no trailing newline', () => {
    const text = vocabularyClaimPreimage(hex(1), hex(2), hex(3), hex(4), 7, 12, true)
    expect(text.split('\n')).toEqual([
      VOCABULARY_CLAIM_V1, hex(1), hex(2), hex(3), hex(4), '7', '12', '1',
    ])
    expect(text.endsWith('\n')).toBe(false)
  })

  it('spells genesis as "-" and complete as 1/0, never as null or true', () => {
    const genesis = vocabularyClaimPreimage(hex(1), hex(2), hex(3), null, 0, 0, false)
    expect(genesis.split('\n')[4]).toBe('-')
    expect(genesis.split('\n')[7]).toBe('0')
  })

  it('round trips, and refuses every near-miss rather than mis-parsing', () => {
    const text = vocabularyClaimPreimage(hex(1), hex(2), hex(3), hex(4), 7, 12, true)
    expect(parseVocabularyClaimPreimage(text)).toEqual({
      pubkey: hex(1), surface: hex(2), body: hex(3), prev: hex(4), seq: 7, count: 12, complete: true,
    })

    expect(parseVocabularyClaimPreimage(text + '\n')).toBeNull()          // trailing newline
    expect(parseVocabularyClaimPreimage(text.replace(':v1', ':v2'))).toBeNull()
    expect(parseVocabularyClaimPreimage(text.replace('\n7\n', '\n07\n'))).toBeNull()
    // `complete` spelled the JSON way rather than 1/0
    const asTrue = text.split('\n'); asTrue[7] = 'true'
    expect(parseVocabularyClaimPreimage(asTrue.join('\n'))).toBeNull()
    expect(parseVocabularyClaimPreimage(text.split('\n').slice(0, 7).join('\n'))).toBeNull()
    // a claim whose counter and chain link disagree
    expect(parseVocabularyClaimPreimage(
      vocabularyClaimPreimage(hex(1), hex(2), hex(3), null, 4, 0, true),
    )).toBeNull()
    expect(parseVocabularyClaimPreimage(
      vocabularyClaimPreimage(hex(1), hex(2), hex(3), hex(4), 0, 0, true),
    )).toBeNull()
  })

  it('refuses a count past the cap, so a fetch is bounded before it starts', () => {
    expect(parseVocabularyClaimPreimage(
      vocabularyClaimPreimage(hex(1), hex(2), hex(3), hex(4), 1, MAX_CLAIM_WORDS + 1, true),
    )).toBeNull()
  })
})

describe('the vocabulary body atom', () => {

  it('is a canonical representative of a SET — deduped, sorted, hex only', () => {
    const record = canonicalVocabularyBody(hex(1), [hex(9), hex(3), hex(9), hex(5)])
    expect(record?.words).toEqual([hex(3), hex(5), hex(9)])
  })

  it('encodes from arrays only, in a fixed literal order', () => {
    const record = canonicalVocabularyBody(hex(1), [hex(3), hex(2)])!
    expect(encodeVocabularyBody(record)).toBe(
      `{"kind":"hypercomb.vocabulary","v":1,"pubkey":"${hex(1)}","words":["${hex(2)}","${hex(3)}"]}`,
    )
  })

  it('THROWS on a non-canonical record — the writer is never a weaker gate than the reader', () => {
    expect(() => encodeVocabularyBody({
      kind: 'hypercomb.vocabulary', v: 1, pubkey: hex(1), words: [hex(3), hex(2)],
    })).toThrow()
    expect(() => encodeVocabularyBody({
      kind: 'hypercomb.vocabulary', v: 1, pubkey: hex(1), words: [hex(2), hex(2)],
    })).toThrow()
    expect(() => encodeVocabularyBody({
      kind: 'hypercomb.vocabulary', v: 2, pubkey: hex(1), words: [],
    } as never)).toThrow()
  })

  it('REFUSES OR PARSES — a second spelling of one set cannot exist', () => {
    const text = encodeVocabularyBody(canonicalVocabularyBody(hex(1), [hex(2), hex(3)])!)
    expect(parseVocabularyBody(text)?.words).toEqual([hex(2), hex(3)])

    expect(parseVocabularyBody(text.replace('{"kind"', '{ "kind"'))).toBeNull()   // whitespace
    expect(parseVocabularyBody(JSON.stringify({                                    // reordered
      kind: 'hypercomb.vocabulary', v: 1, pubkey: hex(1), words: [hex(3), hex(2)],
    }))).toBeNull()
    expect(parseVocabularyBody(JSON.stringify({                                    // extra field
      kind: 'hypercomb.vocabulary', v: 1, pubkey: hex(1), words: [hex(2)], extra: 1,
    }))).toBeNull()
    expect(parseVocabularyBody(text.replace('"v":1', '"v":2'))).toBeNull()
    expect(parseVocabularyBody('{"kind":"hypercomb.vocabulary","v":1,"pubkey":"nope","words":[]}')).toBeNull()
  })

  it('an empty vocabulary is a legal, encodable claim — that is what withdrawal is', () => {
    const text = encodeVocabularyBody(canonicalVocabularyBody(hex(1), [])!)
    expect(parseVocabularyBody(text)?.words).toEqual([])
  })

  it('holds() only ever answers about a 64-hex address', () => {
    const record = canonicalVocabularyBody(hex(1), [hex(2)])!
    expect(vocabularyBodyHolds(record, hex(2))).toBe(true)
    expect(vocabularyBodyHolds(record, hex(3))).toBe(false)
    expect(vocabularyBodyHolds(record, 'coffee')).toBe(false)
  })
})

describe('acceptance', () => {

  it('accepts a claim at the address the reader asked for', async () => {
    const alice = identity()
    const body = sha('alice-v1')
    const offered = mint(alice, SURFACE, body, null, 0, 3, true)

    const verdict = await acceptVocabularyClaim(
      { pubkey: alice.pubkey, surface: SURFACE }, offered, alice.verify,
    )
    expect(verdict.authentic).toBe(true)
    expect(verdict.authentic && verdict.claim).toEqual({
      pubkey: alice.pubkey, surface: SURFACE, body, prev: null, seq: 0, count: 3, complete: true,
    })
  })

  it('REJECTS the SAME genuine claim offered at a different address', async () => {
    const alice = identity()
    const mallory = identity()
    const body = sha('alice-v1')
    const offered = mint(alice, SURFACE, body, null, 0, 3, true)

    // The host serves Alice's real, real-signed bytes when the reader asked
    // for Mallory. The verifier is willing to try BOTH keys — the refusal is
    // structural, not a missing key.
    const verdict = await acceptVocabularyClaim(
      { pubkey: mallory.pubkey, surface: SURFACE }, offered, anyOf(alice, mallory),
    )
    expect(verdict.authentic).toBe(false)
    expect(verdict.authentic === false && verdict.reason).toBe('unsigned')
  })

  it('REJECTS a claim minted for a different surface', async () => {
    const alice = identity()
    const body = sha('alice-v1')
    const offered = mint(alice, hex(0xbeef), body, null, 0, 3, true)
    const verdict = await acceptVocabularyClaim(
      { pubkey: alice.pubkey, surface: SURFACE }, offered, alice.verify,
    )
    expect(verdict.authentic).toBe(false)
  })

  it('REJECTS an edited count or completeness under an otherwise valid signature', async () => {
    const alice = identity()
    const body = sha('alice-v1')
    const offered = mint(alice, SURFACE, body, null, 0, 3, true)
    const address = { pubkey: alice.pubkey, surface: SURFACE }

    expect((await acceptVocabularyClaim(address, { ...offered, count: 4 }, alice.verify)).authentic).toBe(false)
    expect((await acceptVocabularyClaim(address, { ...offered, complete: false }, alice.verify)).authentic).toBe(false)
    expect((await acceptVocabularyClaim(address, { ...offered, body: sha('other') }, alice.verify)).authentic).toBe(false)
  })

  it('refuses shape before the verifier is ever called', async () => {
    const alice = identity()
    let called = 0
    const counting: VocabularyClaimVerifier = () => { called++; return true }
    const bad = { body: 'nope', prev: null, seq: 0, count: 0, complete: true, sig: 'ab' }
    const verdict = await acceptVocabularyClaim({ pubkey: alice.pubkey, surface: SURFACE }, bad, counting)
    expect(verdict.authentic).toBe(false)
    expect(verdict.authentic === false && verdict.reason).toBe('malformed')
    expect(called).toBe(0)
  })

  it('a throwing verifier is a refusal, never an exception', async () => {
    const alice = identity()
    const offered = mint(alice, SURFACE, sha('x'), null, 0, 1, true)
    const verdict = await acceptVocabularyClaim(
      { pubkey: alice.pubkey, surface: SURFACE },
      offered,
      () => { throw new Error('curve exploded') },
    )
    expect(verdict.authentic).toBe(false)
  })
})

describe('recency, kept apart from authenticity', () => {

  it('ranks by seq, then by the lexicographically smallest body — total and convergent', () => {
    const rows = [
      { body: hex(9), seq: 2 },
      { body: hex(3), seq: 2 },
      { body: hex(1), seq: 1 },
    ]
    expect(resolveVocabularyClaim(rows)?.body).toBe(hex(3))
    expect(resolveVocabularyClaim([...rows].reverse())?.body).toBe(hex(3))
  })

  it('catches a replayed older claim on the publisher own signed counter', () => {
    const held = [{ pubkey: hex(1), seq: 5 }]
    expect(vocabularyRegressions(held, [{ pubkey: hex(1), seq: 3 }]))
      .toEqual([{ pubkey: hex(1), heldSeq: 5, offeredSeq: 3 }])
    expect(vocabularyRegressions(held, [{ pubkey: hex(1), seq: 5 }])).toEqual([])
    expect(vocabularyRegressions(held, [{ pubkey: hex(1), seq: 6 }])).toEqual([])
    expect(vocabularyRegressions(held, [{ pubkey: hex(2), seq: 0 }])).toEqual([])
  })

  it('plans the STRONGER of held and locally minted, so a behind host cannot roll me back', () => {
    expect(planVocabularyClaim(null, null)).toEqual({ prev: null, seq: 0 })
    // a host that missed my last two publishes
    expect(planVocabularyClaim({ body: hex(1), seq: 0 }, { body: hex(2), seq: 2 }))
      .toEqual({ prev: hex(2), seq: 3 })
    // a second device of mine that really did publish
    expect(planVocabularyClaim({ body: hex(1), seq: 9 }, { body: hex(2), seq: 2 }))
      .toEqual({ prev: hex(1), seq: 10 })
    // my own record wins a tie
    expect(planVocabularyClaim({ body: hex(1), seq: 4 }, { body: hex(2), seq: 4 }))
      .toEqual({ prev: hex(2), seq: 5 })
  })
})

describe('membershipOf — the one place an absence is minted', () => {

  it('declares a word a complete claim names', () => {
    expect(membershipOf([{ seq: 3, complete: true, present: true }])).toBe('declared')
  })

  it('declares a word a PARTIAL claim names — a positive from a short list is still a positive', () => {
    expect(membershipOf([{ seq: 3, complete: false, present: true }])).toBe('declared')
  })

  it('mints ABSENT only from a COMPLETE claim that omits the word', () => {
    expect(membershipOf([{ seq: 3, complete: true, present: false }])).toBe('absent')
  })

  it('NEVER mints absent from a partial claim that omits the word', () => {
    expect(membershipOf([{ seq: 3, complete: false, present: false }])).toBe('unknown')
    expect(membershipOf([
      { seq: 1, complete: false, present: false },
      { seq: 9, complete: false, present: false },
    ])).toBe('unknown')
  })

  it('an empty observation set is UNKNOWN, never absent', () => {
    expect(membershipOf([])).toBe('unknown')
  })

  it('a complete claim at a STRICTLY HIGHER seq withdraws a word', () => {
    expect(membershipOf([
      { seq: 4, complete: true, present: true },
      { seq: 5, complete: true, present: false },
    ])).toBe('absent')
  })

  it('an OLDER complete claim never withdraws a word the newest one names', () => {
    expect(membershipOf([
      { seq: 5, complete: true, present: true },
      { seq: 4, complete: true, present: false },
    ])).toBe('declared')
    // equal seq is not "strictly higher" — a rival cannot withdraw
    expect(membershipOf([
      { seq: 5, complete: true, present: true },
      { seq: 5, complete: true, present: false },
    ])).toBe('declared')
  })

  it('a partial claim may only ADD — it can never take a word away', () => {
    expect(membershipOf([
      { seq: 4, complete: true, present: true },
      { seq: 9, complete: false, present: false },
    ])).toBe('declared')
  })
})
