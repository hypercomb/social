// history/layer-machine.spec.ts
//
// A slot is a SET of entries. `append` refuses a sig already present and
// `removeSig` drops one instance, so the delta vocabulary cannot mint a
// duplicate — the one hole was `set`, which wrote the caller's array
// verbatim. A blind read-push-set pass exploited it and doubled the
// visual:game:play record on /games/arkanoid. These tests pin the closed
// hole: every path into a slot preserves set semantics.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

describe('LayerMachine scalar slots — check 5 on the canonical write surface', () => {
  const SIG = 'c'.repeat(64)

  it('round-trips a scalar child pointer and inline metadata — nothing an edit did not touch is lost', () => {
    // the installed form: `cells` is ONE sig naming a JSON array resource
    const prev = { name: 'installed', cells: SIG, icon: 'gear', weight: 3, notes: ['a'.repeat(64)] }
    const m = LayerMachine.fromLayer(prev as never, 'installed')
    expect(m.getScalar('cells')).toBe(SIG)
    expect(m.getScalar('icon')).toBe('gear')
    expect(m.getScalar('weight')).toBe(3)
    // an ordinary list edit elsewhere on the layer
    m.apply({ slot: 'notes', op: 'append', sig: 'b'.repeat(64) })
    const out = m.output() as Record<string, unknown>
    expect(out['cells']).toBe(SIG)
    expect(out['icon']).toBe('gear')
    expect(out['weight']).toBe(3)
    expect(out['notes']).toEqual(['a'.repeat(64), 'b'.repeat(64)])
  })

  it('a list op on a scalar slot REPLACES it — explicit, never accidental', () => {
    const m = LayerMachine.fromLayer({ name: 'x', cells: SIG } as never, 'x')
    m.apply({ slot: 'cells', op: 'set', sigs: ['d'.repeat(64)] })
    expect(m.getScalar('cells')).toBeUndefined()
    expect((m.output() as Record<string, unknown>)['cells']).toEqual(['d'.repeat(64)])
  })

  it('setScalar drops a list under the same name, null drops the scalar, and a list is refused', () => {
    const m = LayerMachine.fromLayer({ name: 'x', tags: ['t'] } as never, 'x')
    expect(m.setScalar('tags', 'one')).toEqual({ changed: true })
    expect(m.getSlot('tags')).toEqual([])
    expect((m.output() as Record<string, unknown>)['tags']).toBe('one')
    expect(m.setScalar('tags', null)).toEqual({ changed: true })
    expect('tags' in m.output()).toBe(false)
    expect(() => m.setScalar('tags', ['no'])).toThrow()
    expect(m.setScalar('name', 'nope')).toEqual({ changed: false })
  })

  it('the committer\'s update carries scalars into the delta instead of dropping them', () => {
    // Mechanical: the surface's coercion loop must have a scalar branch and
    // the delta must carry it. The machine test above proves the rest.
    const src = readFileSync(join(process.cwd(), 'hypercomb-essentials', 'src', 'history', 'layer-committer.drone.ts'), 'utf8')
    expect(src.includes("delta: { kind: 'layer', layer: slots, scalars, nameSlots }")).toBe(true)
    expect(src.includes('machine.setScalar(slot, value)')).toBe(true)
    expect(src.includes('drop non-array values')).toBe(false)
    // and the IMPORT path — paste / adopt — carries them too
    expect(src.includes('if (!Array.isArray(raw)) { if (raw !== undefined) machine.setScalar(slot, raw); continue }')).toBe(true)
    expect(src.includes('if (!Array.isArray(raw)) continue')).toBe(false)
  })
})
