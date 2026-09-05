// core/pool-kinds.authority-skeptic.spec.ts
//
// ADVERSARIAL PASS over the kind decoration. The question is only ever: can a
// record somebody else wrote change what this client DESTROYS, or what it
// BELIEVES about a directory it did not mint?
//
// ORDER IS LOAD-BEARING IN THIS FILE. The first test must be the first thing
// that touches `pool-kinds.js` in this module graph, because the defect it
// demonstrates IS an ordering defect: `declarePoolKind` never seeds, so whoever
// speaks first wins. Do not add a test above it, and do not call
// `poolKindOfMeaning` / `poolKinds` / `poolKindOfAddress` before it runs.

import { describe, expect, it } from 'vitest'
import {
  declarePoolKind, poolKindOfAddress, poolKindOfMeaning, poolKinds,
} from './pool-kinds.js'
import { documentSweepVeto, hardDeleteVeto, planNamedRemoval, type DirectoryEntry } from './directory-safety.js'
import { registerPoolMeaning } from './pool-registry.js'
import { canonicalizeLineageSegment } from './lineage-key.js'
import { SignatureService } from './signature.service.js'

const SIG_A = 'a'.repeat(64)

describe('FIRST SPEAKER WINS — the seeded census is not actually protected', () => {

  // `declarePoolKind` guards with `if (!kindByMeaning.has(key))`, but it never
  // calls `ensureSeeded()`. Only the three READ functions seed. So a
  // declaration that lands before the first read of this module sees an EMPTY
  // map, takes the slot, and the seed then declines to overwrite IT.
  //
  // `pool-kinds.spec.ts`'s own "first declaration wins" case passes only
  // because an earlier `it()` in that file happened to call
  // `poolKindOfMeaning`, which seeded. The invariant is a test-ordering
  // accident, not a property.
  it("a declaration made before the first READ overwrites the seed for 'roots'", () => {
    // 'roots' is seeded as SUCCESSION: per-author buckets, "never touch
    // another author's bucket". Re-declare it as a DOCUMENT, whose sanctioned
    // behaviour is a sibling sweep.
    declarePoolKind('roots', 'document')

    expect(
      poolKindOfMeaning('roots')?.kind,
      "a seeded meaning must not be re-shapeable by whoever imports first",
    ).toBe('succession')
    expect(poolKindOfMeaning('roots')?.deletion).toBe('own-bucket')
    expect(poolKinds().get('roots')).toBe('succession')
  })
})

describe('the kind decoration still cannot widen a deletion', () => {

  // The good news half. Even with the hostile `document` declaration ABOVE
  // having been attempted, no destruction verdict moves — because
  // directory-safety does not know kinds exist. This is the property that
  // matters, and it held even while the shadowing defect was live.
  //
  // FIXED 2026-09-03: `declarePoolKind` now seeds before it checks, so the
  // attempted re-declaration is refused and the seeded belief survives. The
  // assertion below is therefore the SEEDED value, not the shadowed one.
  it('every guard refuses identically, and the hostile declaration never took', () => {
    expect(poolKindOfMeaning('roots')?.deletion).toBe('own-bucket') // the seeded belief, unshadowed
    const bag: DirectoryEntry[] = [{ name: '00000000' }, { name: '00000001' }, { name: SIG_A }]
    expect(documentSweepVeto(bag)).toContain('lineage marker')
    expect(hardDeleteVeto(bag)).toContain('shared')
    expect(planNamedRemoval(bag, [SIG_A]).remove).toEqual([])
    expect(planNamedRemoval(bag, [SIG_A]).refused).toContain('lineage marker')
  })
})

describe('a bare-word address answers for a directory it cannot see', () => {

  // `poolKindOfAddress` resolves an ADDRESS through the registry. For a
  // bare-word meaning the pool address and a same-named root tile's LINEAGE BAG
  // address are byte-identical — that collision is the design. So the kind
  // lookup confidently describes a participant's own history bag as a pool
  // whose sanctioned behaviour is replacing its siblings, with no caveat
  // anywhere in the module and no way for a caller to tell the two apart.
  it("reports 'overrides' as a replaces-siblings document even when the directory is a tile's bag", async () => {
    // The two preimages really are the same string.
    expect(canonicalizeLineageSegment('overrides')).toBe('overrides')
    const poolAddress = await registerPoolMeaning('overrides')
    const bagAddress = await SignatureService.sign(
      new TextEncoder().encode('overrides').buffer as ArrayBuffer,
    )
    expect(bagAddress).toBe(poolAddress)

    const facts = await poolKindOfAddress(bagAddress)
    // CHARACTERISATION: this is what it says today about a user's lineage bag.
    expect(facts?.kind).toBe('document')
    expect(facts?.deletion).toBe('replaces-siblings')
    expect(facts?.wipeSafe).toBe(false)

    // And the property that saves it: the ENTRY still decides.
    const usersOwnBag: DirectoryEntry[] = [{ name: '00000000' }, { name: '00000001' }]
    expect(documentSweepVeto(usersOwnBag)).toContain('lineage marker')
  })
})
