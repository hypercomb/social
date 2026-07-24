// diamondcoreprocessor.com/presentation/tiles/wave-layout.spec.ts
//
// Coverage of the dive's decisions:
//   - the props key the tile image ACTUALLY lives at (the labelled-hex bug)
//   - how far the wheel may take you, and that it never lands on empty ground

import { describe, it, expect } from 'vitest'
import { waveImageSigFromProps, waveHideTextFromProps, depthAvailableFrom, clampDepth } from './wave-layout.js'

const SIG_A = 'a'.repeat(64)
const SIG_B = 'b'.repeat(64)
const SIG_C = 'c'.repeat(64)

describe('waveImageSigFromProps', () => {
  it('reads small.image — the key the renderer actually writes', () => {
    expect(waveImageSigFromProps({ small: { image: SIG_A } })).toBe(SIG_A)
  })

  it('falls back to flat.small.image for flat-top orientation', () => {
    expect(waveImageSigFromProps({ flat: { small: { image: SIG_B } } })).toBe(SIG_B)
  })

  it('prefers small.image over the flat and legacy spellings', () => {
    const props = { small: { image: SIG_A }, flat: { small: { image: SIG_B } }, imageSig: SIG_C }
    expect(waveImageSigFromProps(props)).toBe(SIG_A)
  })

  it('accepts a top-level imageSig only as a last resort', () => {
    expect(waveImageSigFromProps({ imageSig: SIG_C })).toBe(SIG_C)
  })

  it('returns undefined for props with no image, and for junk', () => {
    for (const junk of [null, undefined, {}, { small: {} }, 'nope', 42, { small: { image: 'not-a-sig' } }]) {
      expect(waveImageSigFromProps(junk)).toBeUndefined()
    }
  })
})

describe('waveHideTextFromProps', () => {
  it('suppresses the name only when the tile explicitly asks', () => {
    expect(waveHideTextFromProps({ hideText: true })).toBe(true)
  })

  it('keeps the name for an ordinary tile — including one WITH an image', () => {
    // The regression: a picture alone is not a reason to drop the name.
    expect(waveHideTextFromProps({ small: { image: SIG_A } })).toBe(false)
    expect(waveHideTextFromProps({})).toBe(false)
  })

  it('treats anything non-true as "show the name"', () => {
    for (const junk of [null, undefined, 'true', 1, { hideText: 'yes' }, { hideText: 0 }]) {
      expect(waveHideTextFromProps(junk)).toBe(false)
    }
  })
})

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

  it('composes with clampDepth so a wheel-down actually advances', () => {
    // depth 1 + leftover frontier → asking for 2 yields 2, not 1.
    const available = depthAvailableFrom(1, true)
    expect(clampDepth(2, available, 5)).toBe(2)
    // …and with nothing left over it holds at 1 instead of blanking.
    expect(clampDepth(2, depthAvailableFrom(1, false), 5)).toBe(1)
  })
})

describe('clampDepth', () => {
  it('honours the wheel while there is ground under it', () => {
    expect(clampDepth(1, 4, 5)).toBe(1)
    expect(clampDepth(3, 4, 5)).toBe(3)
    expect(clampDepth(4, 4, 5)).toBe(4)
  })

  it('settles on the deepest real generation rather than showing an empty dive', () => {
    expect(clampDepth(5, 2, 5)).toBe(2)
    expect(clampDepth(99, 1, 5)).toBe(1)
  })

  it('never rises above the first generation', () => {
    expect(clampDepth(0, 3, 5)).toBe(1)
    expect(clampDepth(-7, 3, 5)).toBe(1)
  })

  it('respects the feature ceiling even when the tree goes deeper', () => {
    expect(clampDepth(9, 40, 5)).toBe(5)
  })

  it('always returns at least 1, even for a subject with no ground recorded', () => {
    for (const requested of [-1, 0, 1, 9]) {
      expect(clampDepth(requested, 0, 5)).toBe(1)
    }
  })

  it('wheeling down then up returns to the same generation', () => {
    const available = 3, hard = 5
    let d = clampDepth(2, available, hard)
    d = clampDepth(d + 1, available, hard)
    d = clampDepth(d - 1, available, hard)
    expect(d).toBe(2)
  })
})
