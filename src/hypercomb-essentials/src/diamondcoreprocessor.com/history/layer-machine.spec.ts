// diamondcoreprocessor.com/history/layer-machine.spec.ts
//
// A slot is a SET of entries. `append` refuses a sig already present and
// `removeSig` drops one instance, so the delta vocabulary cannot mint a
// duplicate — the one hole was `set`, which wrote the caller's array
// verbatim. A blind read-push-set pass exploited it and doubled the
// visual:game:play record on /games/arkanoid. These tests pin the closed
// hole: every path into a slot preserves set semantics.

import { describe, it, expect } from 'vitest'
import { LayerMachine } from './layer-machine.js'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)

describe('LayerMachine slot set semantics', () => {
  it('append refuses a sig already present', () => {
    const m = LayerMachine.empty('cell')
    expect(m.apply({ slot: 'decorations', op: 'append', sig: A }).changed).toBe(true)
    expect(m.apply({ slot: 'decorations', op: 'append', sig: A }).changed).toBe(false)
    expect(m.getSlot('decorations')).toEqual([A])
  })

  it('set collapses duplicate entries to the first occurrence, order preserved', () => {
    const m = LayerMachine.empty('cell')
    expect(m.apply({ slot: 'decorations', op: 'set', sigs: [A, B, A, C, B] }).changed).toBe(true)
    expect(m.getSlot('decorations')).toEqual([A, B, C])
  })

  it('a blind read-push-set of an already-present sig is a no-op', () => {
    // The /games/arkanoid double: read the slot, push the sig without a
    // presence check, set the whole array back. Re-running the pass must
    // change nothing.
    const m = LayerMachine.fromLayer({ name: 'arkanoid', decorations: [A, B] } as never, 'arkanoid')
    const blind = [...(m.getSlot('decorations') as string[]), B]
    expect(m.apply({ slot: 'decorations', op: 'set', sigs: blind }).changed).toBe(false)
    expect(m.getSlot('decorations')).toEqual([A, B])
  })

  it('set does not merge distinct inline-payload objects', () => {
    // Slots may hold inline payloads alongside sig pointers. Two deep-equal
    // but distinct objects are two entries — only identical primitives (and
    // identical references) collapse.
    const m = LayerMachine.empty('cell')
    const one = { note: 'x' }
    const two = { note: 'x' }
    expect(m.apply({ slot: 'inline', op: 'set', sigs: [one, two] }).changed).toBe(true)
    expect(m.getSlot('inline')).toEqual([one, two])
  })
})
