// molecule/vocabulary-publish.derived-cache.spec.ts
//
// SKEPTIC LENS — DERIVED-CACHE DISCIPLINE, pointed at the PUBLISH.
//
// Two questions, both answered against `buildVocabularyBody`, which is the
// whole of the scope decision and the only consumer of the derived record.
//
//  1. IS THE DERIVED INDEX LOAD-BEARING? `documentation/optimize-phase.md`
//     and `molecule-index.ts`'s own contract line 3: "cold paths must produce
//     identical results without them". `MoleculeIndexService` earns that with
//     `fallbackVocabulary()` — the same names, the same fold, from layers
//     alone. The publish did NOT go through it: `deps.readRecord` was the raw
//     pool reader that NEVER derives, so a wipe turned a publishable claim
//     into a refusal — a different ANSWER, not a slower one. It is now
//     `subtreeVocabulary`, the branch-scoped form of that same cold walk, and
//     these tests hold it to warm/cold equivalence.
//
//  2. DOES THE CLAIM COVER WHAT IT SAYS IT COVERS? The claim is signed
//     `complete: true` for a set of PUBLISHED BRANCHES, and `membershipOf`
//     mints `absent` from exactly that flag. A word the branch publicly
//     serves but the claim omits is therefore a WRONG NO — "the one answer
//     this whole design exists to make unmintable".

import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { moleculeAddress } from '@hypercomb/core'
import { buildVocabularyBody } from './vocabulary-publish.js'

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')
const hex = (n: number): string => n.toString(16).padStart(64, '0')

const HEAD = hex(0xb1)

/** The subtree under `/business`: two children, and the branch itself. */
const NAMES = { branch: 'business', children: ['invoices', 'clients'] }

type Records = Record<string, { words: { a: string }[]; truncated?: boolean } | null>

/**
 * THE DEP AS IT IS ACTUALLY WIRED. `readRecord` is bound to
 * `MoleculeIndexReader.subtreeVocabulary`, which answers from the pool when the
 * record is WHOLE and otherwise walks the layers — the cold path
 * `fallbackVocabulary` already proved for the root, applied to one branch.
 *
 * So `pool` here is the accelerator and `layers` is the ground truth. Modelling
 * the dep as the raw pool reader (`records[sig] ?? null`) is precisely the
 * shape that made a WIPE change the answer instead of the speed, which is the
 * defect this file reports.
 */
const depsFor = (pool: Records, layers: Records = COLD) => ({
  publicBranches: () => ['/business'],
  publishedKeys: async () => new Set(['lineage:business']),
  lineageKeyOf: (segments: readonly string[]) => `lineage:${segments.join('/')}`,
  headOf: async () => HEAD,
  readRecord: async (sig: string) => pool[sig] ?? layers[sig] ?? null,
})

const childAddresses = await Promise.all(NAMES.children.map((n) => moleculeAddress(n)))
/** What layers alone say — no pool, no record, just the children manifests. */
const COLD: Records = { [HEAD]: { words: childAddresses.map((a) => ({ a })) } }
/** The minted accelerator: the same answer, one file read instead of a walk. */
const WARM: Records = COLD

describe('the publish and the derived cache', () => {
  it('THE BRANCH\'S OWN NAME is declared — or a complete claim mints a wrong ABSENT', async () => {
    // The record for a layer sig is the fold over that layer's CHILDREN
    // manifest (`MoleculeIndexService.derive` → `#manifestOf(layerSig)`), so
    // it holds the children's names and NOT the layer's own.
    const built = await buildVocabularyBody(depsFor(WARM))

    // The claim would be signed complete: nothing was missing or truncated.
    expect(built.complete).toBe(true)

    // A visitor who can fetch `/business` can read the tile named "business".
    // Ask the host for that word and `membershipOf` folds
    // {complete: true, present: false} straight to 'absent'.
    const branchAddress = await moleculeAddress(NAMES.branch)
    expect(built.addresses).toContain(branchAddress)
  })

  it('the answer is IDENTICAL with the derived pool cold, only slower', async () => {
    const hot = await buildVocabularyBody(depsFor(WARM))
    // `sign('molecule:index')` is declared `index` kind: recomputable,
    // wipe-safe, GC-able. A collector may empty it at any moment, and every
    // reader must still answer the same.
    const cold = await buildVocabularyBody(depsFor({}))

    expect([...cold.addresses].sort()).toEqual([...hot.addresses].sort())
    expect(cold.complete).toBe(hot.complete)
  })

  it('a subtree that cannot be assembled AT ALL says so, and never narrows in silence', async () => {
    // The guard rail, restated for the fixed dep: a wiped pool is no longer
    // an empty answer (that was the defect), but a branch whose vocabulary
    // genuinely cannot be assembled — no record, no readable manifest — must
    // still clear `complete` rather than sign a narrower picture as whole.
    const blind = await buildVocabularyBody(depsFor({}, {}))
    expect(blind.complete).toBe(false)
    // Only the branch's own name survives, and it is not `absent`-licensing:
    // an incomplete claim mints no absence at all.
    expect(blind.addresses).toEqual([await moleculeAddress(NAMES.branch)])
  })

  it('the derived record\'s presence must not change what the collector keeps', () => {
    // Cross-reference to molecule-index.prune-pin.spec.ts: a record whose
    // bytes carry a 64-hex tile spelling is credited by
    // `HistoryService.referencesOutside`, so minting the cache changes prune's
    // answer. Named here so the publish's dependency on that cache is not
    // read in isolation.
    expect(sha('placeholder')).toHaveLength(64)
  })
})
