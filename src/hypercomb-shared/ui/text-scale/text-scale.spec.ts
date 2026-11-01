// hypercomb-shared/ui/text-scale/text-scale.spec.ts
//
// The text size a non-docked surface reads from, and how it steps.

import { describe, it, expect, beforeEach } from 'vitest'
import { writeTextScale } from '../docked-panel/panel-groups'
import { DEFAULT_SURFACE_SCALE, surfaceScale, stepSurfaceScale } from './text-scale.component'

const WINDOW = 'spec-surface'

describe('surface text size', () => {
  beforeEach(() => { localStorage.clear() })

  it('renders at the default when nothing was ever chosen', () => {
    expect(surfaceScale(WINDOW)).toBe(DEFAULT_SURFACE_SCALE)
  })

  it('reads back exactly what was written', () => {
    writeTextScale(WINDOW, 1.15)
    expect(surfaceScale(WINDOW)).toBe(1.15)
  })

  it('reads a docked panel AUTO record as the default', () => {
    // The two settings are the same setting: a window listed in both places
    // must not read as "no opinion" just because the other side wrote `auto`.
    writeTextScale(WINDOW, null)
    expect(surfaceScale(WINDOW)).toBe(DEFAULT_SURFACE_SCALE)
  })

  it('holds any size on the range, and keeps a record from outside it inside', () => {
    writeTextScale(WINDOW, 1.07)
    expect(surfaceScale(WINDOW)).toBe(1.07)
    writeTextScale(WINDOW, 9)
    expect(surfaceScale(WINDOW)).toBe(1.7)
  })

  it('steps up and down, persisting each step', () => {
    writeTextScale(WINDOW, 1)
    expect(stepSurfaceScale(WINDOW, 1)).toBe(1.05)
    expect(surfaceScale(WINDOW)).toBe(1.05)
    expect(stepSurfaceScale(WINDOW, -1)).toBe(1)
  })

  it('stops at the ends rather than wrapping around', () => {
    writeTextScale(WINDOW, 0.7)
    expect(stepSurfaceScale(WINDOW, -1)).toBe(0.7)
    writeTextScale(WINDOW, 1.7)
    expect(stepSurfaceScale(WINDOW, 1)).toBe(1.7)
  })
})
