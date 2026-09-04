// molecule/vocabulary-publish.skeptic.spec.ts
//
// ADVERSARIAL REVIEW of the PUBLISH half. A wrong "no" does not have to be
// minted by a reader: a publisher that signs `complete: true` over a picture
// it knows is narrower mints the same lie, and readers are obliged to believe
// it because it is signed.

import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'

import {
  MAX_CLAIM_SEQ,
  moleculeAddress,
  planVocabularyClaim,
  parseVocabularyClaimPreimage,
  vocabularyClaimPreimage,
} from '@hypercomb/core'
import { buildVocabularyBody, publishVocabulary, type VocabularyPublishDeps } from './vocabulary-publish.js'

const sha = (t: string): string => createHash('sha256').update(t, 'utf8').digest('hex')
const hex = (n: number): string => n.toString(16).padStart(64, '0')
const PUBKEY = sha('alice')
const COFFEE = sha('coffee')
const TEA = sha('tea')
const WORK = await moleculeAddress('work')

const rig = (over: Partial<VocabularyPublishDeps> & {
  branches?: string[]
  published?: string[]
  heads?: Record<string, string>
  records?: Record<string, { words: { a: string }[]; truncated?: boolean } | null>
  held?: { body: string; seq: number } | null
  minted?: { body: string; seq: number } | null
} = {}) => {
  const stored = new Map<string, string>()
  const signedSeqs: number[] = []
  const branches = over.branches ?? ['/work']
  const published = new Set(over.published ?? ['work'])
  const heads = over.heads ?? { work: hex(0xaa) }
  const records = over.records ?? { [hex(0xaa)]: { words: [{ a: COFFEE }, { a: TEA }] } }
  const deps: VocabularyPublishDeps = {
    surface: async () => sha('vocabulary:hive'),
    publicKey: async () => PUBKEY,
    host: async () => 'content.example',
    publicBranches: () => branches,
    publishedKeys: async () => published,
    lineageKeyOf: (s) => s.join('-'),
    headOf: async (s) => heads[s.join('-')] ?? null,
    readRecord: async (sig) => records[sig] ?? null,
    hash: async (t) => sha(t),
    readHeld: async () => over.held ?? null,
    readMinted: async () => over.minted ?? null,
    confirm: async () => true,
    sign: async (surface, body, prev, seq, count, complete) => {
      signedSeqs.push(seq)
      // THE REAL SHAPE GATE, restated: signVocabularyClaim refuses to sign
      // bytes the reader's parser will not accept.
      const content = vocabularyClaimPreimage(PUBKEY, surface, body, prev, seq, count, complete)
      if (!parseVocabularyClaimPreimage(content)) return { ok: false, reason: 'malformed' as const }
      return { ok: true, pubkey: PUBKEY, claim: { body, prev, seq, count, complete, sig: 'ab' }, event: {}, json: JSON.stringify({ content }) }
    },
    putResource: async (t) => { const s = sha(t); stored.set(s, t); return s },
    markPublic: async () => {},
    available: async () => true,
    setRoot: async () => ({ ok: true }),
    writeRecord: async () => true,
    now: () => 1_700_000_000_000,
    wait: async () => {},
    ...over,
  }
  return { deps, stored, signedSeqs }
}

describe('SKEPTIC — the publisher must not sign a lie', () => {

  it('the LEDGER intersection narrows the picture while the claim still says COMPLETE', async () => {
    // The ledger is documented in publish-heads.ts as "a floor, never a
    // ceiling: it cannot know about branches published from another device."
    // Here /notes really IS published (from the other device) and its bytes
    // really are served — this device just has no record of it.
    const built = await buildVocabularyBody(rig({
      branches: ['/work', '/notes'],
      published: ['work'],                       // /notes published elsewhere
      heads: { work: hex(0xaa), notes: hex(0xbb) },
      records: {
        [hex(0xaa)]: { words: [{ a: COFFEE }] },
        [hex(0xbb)]: { words: [{ a: TEA }] },
      },
    }).deps)

    // `/work`'s own name rides along; `/notes` contributes nothing at all.
    expect(built.addresses).toEqual([COFFEE, WORK].sort())
    // A reader that gets `complete: true` here will mint ABSENT for TEA, a
    // word this hive genuinely serves. The file's own prose says
    // "under-reporting is exactly what `complete: false` exists to say out
    // loud" — so it must say so.
    expect(built.complete).toBe(false)
  })

  it('an UNVERIFIED held seq from a host is REFUSED, not signed and not remembered', async () => {
    // THE DEFECT, AND WHAT CLOSED IT.
    //
    // `defaultVocabularyPublishDeps.readHeld` fetched the claim atom, checked
    // its hash, and DELIBERATELY did not verify the signature — so any host
    // could hand back an arbitrary `seq` AND an arbitrary `prev`, both of
    // which the participant then SIGNED. `seq` was bounded only by
    // `Number.isSafeInteger`, so one lie near the ceiling was accepted, signed,
    // and written to the permanent local ledger; every later plan was then
    // `MAX_SAFE_INTEGER + 1`, which the reader's own shape gate refuses, and
    // that device could never publish a vocabulary again.
    //
    // TWO FIXES, EACH SUFFICIENT ON ITS OWN:
    //   1. `readHeld` now runs `acceptVocabularyClaim` — my key, my surface —
    //      so an unsigned value never reaches the plan at all. (Covered by the
    //      live wiring; this rig injects `held` directly, past that gate, which
    //      is why the second fix matters.)
    //   2. core caps the counter at MAX_CLAIM_SEQ. A base past the cap is not a
    //      base: it is a value no reader would ever have accepted, so
    //      succeeding it would sign bytes nobody can parse AND make that state
    //      permanent. Refusing costs one genesis re-mint.
    const near = Number.MAX_SAFE_INTEGER - 1
    const first = rig({ held: { body: hex(0xcc), seq: near } })
    const one = await publishVocabulary({ confirmed: true }, first.deps)
    expect(one.ok).toBe(true)
    // NOT MAX_SAFE_INTEGER. The absurd counter is refused, never succeeded.
    expect(first.signedSeqs).toEqual([0])
    expect(first.signedSeqs.every((n) => n <= MAX_CLAIM_SEQ)).toBe(true)

    // And a ledger already poisoned by the old behaviour is recoverable: the
    // plan never returns an unsignable counter, so the device can publish.
    const plan = planVocabularyClaim(null, { body: hex(0xcc), seq: Number.MAX_SAFE_INTEGER })
    expect(Number.isSafeInteger(plan.seq)).toBe(true)

    const second = rig({ minted: { body: hex(0xcc), seq: Number.MAX_SAFE_INTEGER } })
    const two = await publishVocabulary({ confirmed: true }, second.deps)
    expect(two.ok).toBe(true)
  })

  it('a counter WITHIN the cap is still succeeded normally', async () => {
    const r = rig({ minted: { body: hex(0xdd), seq: 41 } })
    const result = await publishVocabulary({ confirmed: true }, r.deps)
    expect(result.ok && result.seq).toBe(42)
    expect(r.signedSeqs).toEqual([42])
  })

})
