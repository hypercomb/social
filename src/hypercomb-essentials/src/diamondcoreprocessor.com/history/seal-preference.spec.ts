// diamondcoreprocessor.com/history/seal-preference.spec.ts
//
// Regression coverage for the 2026-07-18 stale-seal bug: sealSubtree
// reconstructed a SUPERSEDED generation because it recursed into child
// location bags that pool re-mints had left behind, and the publish walk
// broadcast that stale seal — so consumers' receipts always matched and
// updates were invisible swarm-wide. chooseSealChildHandle is the pure
// arbitration sealSubtree now applies whenever a parent hint and the
// child-location seal disagree.

import { describe, expect, it } from 'vitest'
import { chooseSealChildHandle } from './seal-preference.js'

describe('chooseSealChildHandle', () => {

  it('coherent: seal equals hint — carry it, no arbitration needed', () => {
    const d = chooseSealChildHandle({ hintSig: 'gen-B', sealSig: 'gen-B', bagSigs: ['gen-A', 'gen-B'] })
    expect(d).toEqual({ handle: 'gen-B', reason: 'coherent' })
  })

  it('normal staleness: hint is an older marker in the child bag — the fresh location seal wins', () => {
    // Leaf-only commit froze the parent at gen-A; the child then advanced
    // to gen-B. This is the case sealSubtree exists to freshen — the fix
    // must not regress it.
    const d = chooseSealChildHandle({ hintSig: 'gen-A', sealSig: 'gen-B', bagSigs: ['gen-A', 'gen-B'] })
    expect(d).toEqual({ handle: 'gen-B', reason: 'freshened' })
  })

  it('off-lineage divergence: hint never headed the child bag — the parent-committed hint wins', () => {
    // The observed damage shape (revolucion/journal/cigar-wheel forensics):
    // a deliberate parent commit named gen-NEW, minted as a pool re-mint
    // with no marker at the child location; the child bag still heads at
    // gen-OLD. Recursing into the bag resurrects gen-OLD byte-for-byte —
    // the hint must be carried wholesale instead.
    const d = chooseSealChildHandle({ hintSig: 'gen-NEW', sealSig: 'gen-OLD', bagSigs: ['gen-0', 'gen-OLD'] })
    expect(d).toEqual({ handle: 'gen-NEW', reason: 'hint-off-lineage' })
  })

  it('empty bag: divergent hint wins (nothing committed at the location contradicts the parent)', () => {
    const d = chooseSealChildHandle({ hintSig: 'gen-NEW', sealSig: 'derived-elsewhere', bagSigs: [] })
    expect(d).toEqual({ handle: 'gen-NEW', reason: 'hint-off-lineage' })
  })

  it('fork policy: bag advanced independently AND hint is off-lineage — the deliberate parent naming wins', () => {
    // Undecidable without ordering stamps (markers carry none); the
    // documented, logged policy is to honor the parent's committed truth.
    const d = chooseSealChildHandle({ hintSig: 'gen-paste', sealSig: 'gen-edit', bagSigs: ['gen-0', 'gen-edit'] })
    expect(d).toEqual({ handle: 'gen-paste', reason: 'hint-off-lineage' })
  })

  it('cascade regression: the arbitrated walk names the current generation, not yesterday\'s tree', () => {
    // Symbolic reconstruction of the real damage. Layers are {children}
    // nodes; "sealing" a location = re-deriving through its bag head with
    // arbitration per child, exactly as sealSubtree composes decisions.
    //
    //   journal (bag: [jrn-old, jrn-new], head jrn-new)
    //     └─ cigar-wheel  hint cw-remint (OFF-LINEAGE — pool re-mint)
    //          bag: [cw-0, cw-old], head cw-old
    //
    // Pre-fix behavior recursed into cigar-wheel's bag head (cw-old) and
    // re-signed journal around it — reproducing yesterday's journal.
    const cigarWheel = chooseSealChildHandle({
      hintSig: 'cw-remint',
      sealSig: 'cw-old',
      bagSigs: ['cw-0', 'cw-old'],
    })
    expect(cigarWheel.handle).toBe('cw-remint')

    // journal's own arbitration at its parent: hint jrn-old sits in the
    // bag (normal staleness), so the freshened derivation — which now
    // carries cw-remint — wins over the frozen hint.
    const journal = chooseSealChildHandle({
      hintSig: 'jrn-old',
      sealSig: `journal(${cigarWheel.handle})`,
      bagSigs: ['jrn-old', 'jrn-new'],
    })
    expect(journal).toEqual({ handle: 'journal(cw-remint)', reason: 'freshened' })
  })
})
