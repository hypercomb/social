// commands/remove-confirm.spec.ts
//
// THE ONE DIALOG /remove RAISES, AND WHEN IT DOES NOT.
//
// `confirmRemoval` skips its dialog whenever nothing is nested beneath the
// target — a leaf removal is meant to stay frictionless, and that is a
// deliberate choice, not an oversight. It becomes a bug in two ways, and this
// file guards both:
//
//   1. Anything that PROMISES a confirmation is lying for the common case. The
//      machine catalogue did exactly that until 2026-09-03.
//   2. The count that decides it must look where children actually live.
//      `countSubtree` read `layer.children` alone while the canonical order is
//      `CHILD_SLOTS = ['cells', 'layers', 'children']` — built modules emit
//      `cells`, some trees use `layers`. A tile whose subtree hung off either
//      counted ZERO nested, so the dialog was skipped precisely when a whole
//      branch was about to leave the page.

import { describe, expect, it } from 'vitest'
import { countTilesBeneath } from './remove-confirm.js'

/** A tiny content-addressed store: sig → layer. */
const historyOf = (layers: Record<string, unknown>) => ({
  getLayerBySig: async (sig: string) => (layers[sig] ?? null) as never,
})

describe('counting what a removal would take with it', () => {
  it('counts a subtree hanging off children', async () => {
    const history = historyOf({
      'sig-drafts': { name: 'drafts', children: ['sig-a', 'sig-b'] },
      'sig-a': { name: 'a' },
      'sig-b': { name: 'b', children: ['sig-c'] },
      'sig-c': { name: 'c' },
    })
    const parent = { children: ['sig-drafts'] }
    expect(await countTilesBeneath(history, parent, ['drafts'])).toBe(3)
  })

  it('counts a subtree hanging off cells or layers — the slots it used to miss', async () => {
    // This is the regression. Installed and built content emits `cells`; some
    // trees carry `layers`. Both returned 0 before, so the branch left the page
    // with no dialog at all.
    for (const slot of ['cells', 'layers']) {
      const history = historyOf({
        'sig-pack': { name: 'pack', [slot]: ['sig-x', 'sig-y'] },
        'sig-x': { name: 'x' },
        'sig-y': { name: 'y', [slot]: ['sig-z'] },
        'sig-z': { name: 'z' },
      })
      const parent = { children: ['sig-pack'] }
      expect(await countTilesBeneath(history, parent, ['pack']), `slot ${slot}`).toBe(3)
    }
  })

  it('finds the targets through a parent addressed by any child slot', async () => {
    const history = historyOf({
      'sig-pack': { name: 'pack', children: ['sig-x'] },
      'sig-x': { name: 'x' },
    })
    expect(await countTilesBeneath(history, { cells: ['sig-pack'] } as never, ['pack'])).toBe(1)
  })

  it('counts a leaf as zero — which is what lets the dialog be skipped', async () => {
    // The behaviour every caller must respect: a leaf removal raises nothing.
    // Anything that tells a participant or a model otherwise is wrong.
    const history = historyOf({ 'sig-leaf': { name: 'leaf' } })
    expect(await countTilesBeneath(history, { children: ['sig-leaf'] }, ['leaf'])).toBe(0)
  })

  it('counts nothing for a name the parent does not hold, and nothing with no parent', async () => {
    const history = historyOf({ 'sig-leaf': { name: 'leaf', children: ['sig-x'] }, 'sig-x': { name: 'x' } })
    expect(await countTilesBeneath(history, { children: ['sig-leaf'] }, ['absent'])).toBe(0)
    expect(await countTilesBeneath(history, null, ['leaf'])).toBe(0)
  })
})
