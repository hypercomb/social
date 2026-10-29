import { describe, expect, it } from 'vitest'
import { layoutFor, type LayoutInput } from './layout.js'
import type { ModelGeometry, TileModel } from '../models/tile-model.js'

// a stand-in model: two variants, an outline that reaches both stage edges
const MODEL = {
  id: 'stub', labelKey: 'k', label: 'stub', defaultVariant: 'a',
  variants: [{ id: 'a', labelKey: 'k', label: 'a' }, { id: 'b', labelKey: 'k', label: 'b' }],
  geometry: (size: number) => ({ size, extent: { min: 0, max: size } } as unknown as ModelGeometry),
  parts: [],
} as unknown as TileModel

const at = (w: number, h: number, scale = 1, extra: Partial<LayoutInput> = {}) =>
  layoutFor({ rootWidth: w, rootRem: 16, em: 16 * scale, desk: { w: w - 56, h }, model: MODEL, variant: 'a', ...extra })

describe('layoutFor: the stage size at 100% text', () => {
  it.each([
    [1920, 1080, 440],
    [1680, 1000, 440],
    [1440, 900, 440],
    [1100, 760, 440],
    [1024, 768, 421],
    [960, 700, 357],
  ])('%i x %i -> %i', (w, h, s) => {
    const l = at(w, h)
    expect(l.layout).toBe('wide')
    expect(l.size).toBe(s)
  })

  it('1100 wide gives the faces-only list and compact tabs', () => {
    const l = at(1100, 760)
    expect(l.list).toBe('faces')
    expect(l.compact).toBe(true)
    expect(l.card).toBe(208)
    expect(l.tab).toBe(150)
  })

  // the mid-width list is 11.5em on paper; the mock rendered it ~211px (its content
  // would not shrink). These desks are under the 440 cap, so the extra list
  // width still shrinks the stage. Hand the measured width in.
  it.each([
    [1156, 900, 401, 428],
    [1180, 900, 425, 440],
  ])('%i x %i: %i with the measured list, %i from the nominal one', (w, h, measured, nominal) => {
    expect(at(w, h).list).toBe('mid')
    expect(at(w, h).size).toBe(nominal)
    expect(at(w, h, 1, { listWidth: 211 }).size).toBe(measured)
  })

  it('narrow at 900x700 and 390x844', () => {
    expect(at(900, 700).layout).toBe('narrow')
    const phone = at(390, 844)
    expect(phone.layout).toBe('narrow')
    expect(phone.size).toBeGreaterThanOrEqual(200)
    expect(phone.size).toBeLessThanOrEqual(280)
    expect(phone.figure).toEqual({ left: 0, top: 0 })
  })
})

describe('layoutFor: text size', () => {
  it('140% text flips earlier and changes the numbers', () => {
    expect(at(1920, 1080, 1.4).size).toBe(616)
    expect(at(1440, 900, 1.4).size).toBe(544)
    expect(at(1280, 800, 1.4).layout).toBe('narrow')
  })
})

describe('layoutFor: the decision', () => {
  it('is narrow below 56.25em of the root width less the 3.5rem strip', () => {
    // 56.25em * 16 = 900, plus the 56px strip
    expect(at(955, 900).layout).toBe('narrow')
    expect(at(956, 900).layout).toBe('wide')
  })

  it('is narrow when the stage would be under 320 units', () => {
    expect(at(1100, 760).layout).toBe('wide')
    expect(at(1100, 440).layout).toBe('narrow')    // wide enough for the desk, not tall enough for a stage
  })

  it('does not depend on the desk width it is handed (no flip-flop at the threshold)', () => {
    const a = layoutFor({ rootWidth: 956, rootRem: 16, em: 16, desk: { w: 900, h: 900 }, model: MODEL, variant: 'a' })
    const b = layoutFor({ rootWidth: 956, rootRem: 16, em: 16, desk: { w: 956, h: 900 }, model: MODEL, variant: 'a' })
    expect(a.layout).toBe(b.layout)
    expect(a.size).toBe(b.size)
  })

  it('centres the stage in the viewport', () => {
    const l = at(1440, 900)
    expect(l.figure.left).toBe(Math.round((l.viewport.width - l.size) / 2))
    expect(l.figure.top).toBeGreaterThanOrEqual(40)
  })
})
