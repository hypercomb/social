import { describe, expect, it } from 'vitest'
import {
  EGG_HATCH, EGG_NONE, EGG_THUMB, EGG_WHITE, HATCH_MS, INCUBATE_MAX_MS,
  eggAttribute, eggLabelsAt, hatchProgress, readyToHatch,
} from './egg-stage.js'

describe('egg stage', () => {
  it('reads only the eggs laid at this location', () => {
    const entries = [
      { label: 'a', at: ['x'], egg: true },
      { label: 'b', at: ['x'] },
      { label: 'c', at: ['y'], egg: true },
    ]
    expect([...eggLabelsAt(entries, ['x'])]).toEqual(['a'])
    expect(eggLabelsAt(entries, []).size).toBe(0)
  })

  it('is white until a thumbnail is known, then frosted', () => {
    expect(eggAttribute({ kind: 'egg' }, 0, false)).toBe(EGG_WHITE)
    expect(eggAttribute({ kind: 'egg' }, 0, true)).toBe(EGG_THUMB)
    expect(eggAttribute({ kind: 'incubating', since: 0 }, 5, true)).toBe(EGG_THUMB)
    expect(eggAttribute(undefined, 0, true)).toBe(EGG_NONE)
  })

  it('hatches across HATCH_MS and clamps', () => {
    expect(eggAttribute({ kind: 'hatching', since: 100 }, 100, true)).toBe(EGG_HATCH)
    expect(eggAttribute({ kind: 'hatching', since: 100 }, 100 + HATCH_MS / 2, true)).toBeCloseTo(EGG_HATCH + 0.5)
    expect(hatchProgress(0, HATCH_MS * 9)).toBe(1)
    expect(hatchProgress(500, 0)).toBe(0)
  })

  it('hatches on the sharp image, with no image, or after the longest wait', () => {
    const base = { hasImageSig: true, imageSharp: false, since: 0, now: 1000 }
    expect(readyToHatch(base)).toBe(false)
    expect(readyToHatch({ ...base, imageSharp: true })).toBe(true)
    expect(readyToHatch({ ...base, hasImageSig: false })).toBe(true)
    expect(readyToHatch({ ...base, now: INCUBATE_MAX_MS })).toBe(true)
  })
})
