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

describe('layoutFor: the participant\'s size', () => {
  const sized = (w: number, h: number, scale: number) => at(w, h, 1, { scale })

  it('1 (and no scale at all) is the size the desk has always drawn', () => {
    for (const [w, h] of [[1920, 1080], [1440, 900], [1024, 768], [900, 700], [390, 844]] as const) {
      expect(sized(w, h, 1).size).toBe(at(w, h).size)
      expect(sized(w, h, 1).layout).toBe(at(w, h).layout)
    }
  })

  it('smaller draws a smaller stage and never tips a desk with room into narrow', () => {
    const usual = at(1920, 1080)
    const small = sized(1920, 1080, 0.5)
    expect(small.layout).toBe('wide')
    expect(small.size).toBe(220)
    expect(small.size).toBeLessThan(usual.size)
    // still centred
    expect(small.figure.left).toBe(Math.round((small.viewport.width - small.size) / 2))
  })

  it('larger draws a larger stage where the desk has room, up to the room it has', () => {
    const usual = at(1920, 1080)
    const big = sized(1920, 1080, 1.5)
    expect(big.size).toBeGreaterThan(usual.size)
    expect(big.size).toBe(660)
    // a desk with no room to spare keeps the labels on screen: it cannot grow
    expect(sized(1024, 768, 1.5).size).toBe(at(1024, 768).size)
  })

  it('does not change which layout the desk takes', () => {
    for (const scale of [0.5, 1, 1.5]) {
      expect(sized(900, 700, scale).layout).toBe('narrow')
      expect(sized(1440, 900, scale).layout).toBe('wide')
    }
  })

  it('moves the narrow stage inside the phone\'s width', () => {
    const usual = at(390, 844)
    expect(sized(390, 844, 0.5).size).toBeLessThan(usual.size)
    expect(sized(390, 844, 0.5).size).toBeGreaterThanOrEqual(140)
    expect(sized(390, 844, 1.5).size).toBeLessThanOrEqual(390 - 48)
  })

  it('ignores a scale that is not a number above zero', () => {
    for (const scale of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(sized(1440, 900, scale).size).toBe(at(1440, 900).size)
    }
  })
})
