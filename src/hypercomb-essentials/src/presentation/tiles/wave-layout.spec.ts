// presentation/tiles/wave-layout.spec.ts
//
// Coverage of the dive's decisions:
//   - how far the wheel may take you, and that it never lands on empty ground
//   - what a click on a dived tile does, and where its view comes back out
//   - the rim colour parse, which must match the renderer's own

import { describe, it, expect } from 'vitest'
import { depthAvailableFrom, clampDepth, diveClickPlan, borderColorFromProps } from './wave-layout.js'

describe('depthAvailableFrom — the wheel must be able to leave generation 1', () => {
  it('reports another level when the walk held children it never spent', () => {
    // THE REGRESSION: at depth 1 the walk only ever reaches level 1, so
    // availability read from the walked depth alone was always 1, clampDepth
    // pinned every wheel-down back to 1, and the dive never went deeper.
    expect(depthAvailableFrom(1, true)).toBe(2)
  })

  it('reports no further level when the walk spent everything', () => {
    expect(depthAvailableFrom(1, false)).toBe(1)
    expect(depthAvailableFrom(3, false)).toBe(3)
  })

  it('opens exactly one step at a time, so each wheel-down re-asks', () => {
    // Deeper ground is discovered one level per walk — never a leap.
    for (const walked of [1, 2, 3, 4]) {
      expect(depthAvailableFrom(walked, true) - walked).toBe(1)
    }
  })

  it('never reports less than the first generation', () => {
    expect(depthAvailableFrom(0, false)).toBe(1)
    expect(depthAvailableFrom(-3, false)).toBe(1)
  })
})

describe('clampDepth — the wheel settles on real ground', () => {
  it('steps down and back up within what exists', () => {
    expect(clampDepth(2, 3, 5)).toBe(2)
    expect(clampDepth(3, 3, 5)).toBe(3)
    expect(clampDepth(1, 3, 5)).toBe(1)
  })

  it('never asks for ground the subject does not have', () => {
    expect(clampDepth(4, 2, 5)).toBe(2)
  })

  it('never rises above the first generation, and honours the hard ceiling', () => {
    expect(clampDepth(0, 3, 5)).toBe(1)
    expect(clampDepth(-2, 3, 5)).toBe(1)
    expect(clampDepth(9, 9, 5)).toBe(5)
  })

  it('settles on generation 1 when nothing is available', () => {
    expect(clampDepth(3, 0, 5)).toBe(1)
  })
})

describe('diveClickPlan — a dived tile executes as if it stood in front of you', () => {
  const from = ['work']
  const tile = ['work', 'ledger', 'q3']

  it('enters an ordinary tile and records no spawn — plain hexagons have nothing to come back out of', () => {
    const plan = diveClickPlan({ segments: tile, referenceTarget: null, arrivalView: '', from, mode: '' })
    expect(plan).toEqual({ kind: 'enter', travel: tile, spawn: null })
  })

  it('treats an explicit "hexagons" arrival face as no view', () => {
    const plan = diveClickPlan({ segments: tile, referenceTarget: null, arrivalView: 'hexagons', from, mode: '' })
    expect(plan.spawn).toBeNull()
  })

  it('a destination that opens as a view is told it was spawned from the dive page, in the surface that was up', () => {
    // THE POINT OF THE FEATURE: activate something deep down and, when it
    // closes, be back on the page you never left — not on the tile's page.
    const plan = diveClickPlan({ segments: tile, referenceTarget: null, arrivalView: 'tree', from, mode: 'square-tile-view' })
    expect(plan.kind).toBe('enter')
    expect(plan.travel).toEqual(tile)
    expect(plan.spawn).toEqual({ view: 'tree', mode: 'square-tile-view', segments: from })
  })

  it('a website root spawns too — the same rule, the same page to come back to', () => {
    const plan = diveClickPlan({ segments: tile, referenceTarget: null, arrivalView: 'website', from: [], mode: '' })
    expect(plan.spawn).toEqual({ view: 'website', mode: '', segments: [] })
  })

  it('a portal travels THROUGH to its target and spawns nothing — the target is a real place the participant chose', () => {
    const plan = diveClickPlan({ segments: tile, referenceTarget: ['people', 'ana'], arrivalView: 'tree', from, mode: '' })
    expect(plan).toEqual({ kind: 'reference', travel: ['people', 'ana'], spawn: null })
  })

  it('a portal to the hive root is a real destination, never a missing one', () => {
    const plan = diveClickPlan({ segments: tile, referenceTarget: [], arrivalView: '', from, mode: '' })
    expect(plan.kind).toBe('reference')
    expect(plan.travel).toEqual([])
  })

  it('copies its inputs rather than aliasing them', () => {
    const target = ['a', 'b']
    const plan = diveClickPlan({ segments: tile, referenceTarget: target, arrivalView: '', from, mode: '' })
    target.push('c')
    expect(plan.travel).toEqual(['a', 'b'])
  })
})

describe('borderColorFromProps — the renderer\'s own rim parse', () => {
  it('reads a six-digit hex, with or without the hash', () => {
    expect(borderColorFromProps({ border: { color: '#ff0000' } })).toEqual([1, 0, 0])
    expect(borderColorFromProps({ border: { color: '00ff00' } })).toEqual([0, 1, 0])
  })

  it('leaves the default rim alone for anything else', () => {
    for (const junk of [null, undefined, {}, { border: {} }, { border: { color: 'red' } }, { border: { color: '#fff' } }, { border: { color: 12 } }]) {
      expect(borderColorFromProps(junk)).toBeUndefined()
    }
  })
})
