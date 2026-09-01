// hypercomb-shared/ui/text-scale/text-scale.spec.ts
//
// The text size a non-docked surface reads from, and how it steps.

import { describe, it, expect, beforeEach } from 'vitest'
import { writeTextScale } from '../docked-panel/panel-groups'
import {
  SURFACE_TEXT_SIZES, DEFAULT_SURFACE_SCALE, surfaceScale, stepSurfaceScale,
} from './text-scale.component'

const WINDOW = 'spec-surface'

describe('surface text size', () => {
  beforeEach(() => { localStorage.clear() })

  it('offers the tool windows ladder without auto', () => {
    // `auto` means "derive it from the window's width" — a promise a dropdown
    // and a fixed dialog cannot keep, so it is not on offer here.
    expect(SURFACE_TEXT_SIZES.map(s => s.key)).toEqual(['small', 'normal', 'large', 'larger'])
    expect(SURFACE_TEXT_SIZES.every(s => typeof s.scale === 'number')).toBe(true)
  })

  it('renders at the default when nothing was ever chosen', () => {
    expect(surfaceScale(WINDOW)).toBe(DEFAULT_SURFACE_SCALE)
  })

  it('reads back exactly what was written', () => {
    writeTextScale(WINDOW, 1.15)
    expect(surfaceScale(WINDOW)).toBe(1.15)
  })

  it('resolves a docked panel AUTO record to the nearest offered step', () => {
    // The two settings are the same setting: a window listed in both places
    // must not read as "no opinion" just because the other side wrote `auto`.
    writeTextScale(WINDOW, null)
    expect(surfaceScale(WINDOW)).toBe(DEFAULT_SURFACE_SCALE)
  })

  it('snaps a scale this ladder does not list onto the nearest one', () => {
    writeTextScale(WINDOW, 1.2)
    expect(surfaceScale(WINDOW)).toBe(1.15)
  })

  it('steps up and down the ladder, persisting each step', () => {
    writeTextScale(WINDOW, 1)
    expect(stepSurfaceScale(WINDOW, 1)).toBe(1.15)
    expect(surfaceScale(WINDOW)).toBe(1.15)
    expect(stepSurfaceScale(WINDOW, -1)).toBe(1)
  })

  it('stops at the ends rather than wrapping around', () => {
    writeTextScale(WINDOW, 0.85)
    expect(stepSurfaceScale(WINDOW, -1)).toBe(0.85)
    writeTextScale(WINDOW, 1.32)
    expect(stepSurfaceScale(WINDOW, 1)).toBe(1.32)
  })
})
