// layer-placement.spec.ts — the strict/non-strict children reads that
// membership SETs (paste, cut, move, promote, copy, /layout apply) depend
// on. The contract under test: childNamesOf drops unresolvable sigs
// SILENTLY (read-only render paths only); childNamesOfStrict reports the
// cold miss so writers can refuse instead of wiping the sibling.

import { describe, expect, it } from 'vitest'
import { childNamesOf, childNamesOfStrict, type PlacementHistory, type PlacementLayer } from './layer-placement.js'

const SIG_A = 'a'.repeat(64)
const SIG_B = 'b'.repeat(64)
const SIG_C = 'c'.repeat(64)

const historyWith = (layers: Record<string, PlacementLayer | null>): PlacementHistory => ({
  sign: async () => 'x'.repeat(64),
  currentLayerAt: async () => null,
  commitLayer: async () => 'x'.repeat(64),
  getLayerBySig: async (sig: string) => layers[sig] ?? null,
} as unknown as PlacementHistory)

describe('childNamesOfStrict', () => {
  it('resolves every warm child with no cold miss', async () => {
    const history = historyWith({
      [SIG_A]: { name: 'alpha' },
      [SIG_B]: { name: 'beta' },
    })
    const { names, coldMiss } = await childNamesOfStrict(history, { name: 'parent', children: [SIG_A, SIG_B] })
    expect(names).toEqual(['alpha', 'beta'])
    expect(coldMiss).toBe(false)
  })

  it('reports coldMiss when a child sig fails to resolve — the wipe guard', async () => {
    const history = historyWith({
      [SIG_A]: { name: 'alpha' },
      [SIG_B]: null,               // cold: bytes not warm, tile still real
      [SIG_C]: { name: 'gamma' },
    })
    const { names, coldMiss } = await childNamesOfStrict(history, { name: 'parent', children: [SIG_A, SIG_B, SIG_C] })
    expect(names).toEqual(['alpha', 'gamma'])
    expect(coldMiss).toBe(true)     // caller MUST refuse to SET children
  })

  it('empty and null parents are complete, not cold', async () => {
    const history = historyWith({})
    expect(await childNamesOfStrict(history, { name: 'leaf' })).toEqual({ names: [], coldMiss: false })
    expect(await childNamesOfStrict(history, null)).toEqual({ names: [], coldMiss: false })
  })
})

describe('childNamesOf (non-strict, read-only paths)', () => {
  it('silently drops cold children — why writers must never use it', async () => {
    const history = historyWith({ [SIG_A]: { name: 'alpha' }, [SIG_B]: null })
    const names = await childNamesOf(history, { name: 'parent', children: [SIG_A, SIG_B] })
    expect(names).toEqual(['alpha'])  // no signal that beta existed
  })
})
