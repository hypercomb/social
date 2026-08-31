import { describe, expect, it } from 'vitest'
import {
  DIVISION_KIND,
  HEX_H,
  HEX_W,
  axialCentre,
  derivedVisualSpec,
  divisionPlan,
  payloadOfPlan,
  planOfPayload,
  slotAt,
  slotsOf,
  spiralAxial,
} from './visual-division.js'

/** The AxialService walk, transcribed from `createMatrix` rather than derived,
 *  so the pure function is checked against the layout the participant sees and
 *  not against itself. */
const matrixWalk = (count: number): Array<{ q: number; r: number }> => {
  const out = [{ q: 0, r: 0 }]
  const steps: ReadonlyArray<readonly [number, number]> = [
    [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1],
  ]
  for (let ring = 1; out.length < count; ring++) {
    let q = -ring
    let r = 0
    for (let side = 0; side < 6; side++) {
      for (let step = 0; step < ring; step++) {
        q += steps[side][0]
        r += steps[side][1]
        out.push({ q, r })
      }
    }
  }
  return out.slice(0, count)
}

describe('the spiral is the division', () => {
  it('walks the hive layout exactly, centre out', () => {
    const expected = matrixWalk(20)
    for (let i = 0; i < expected.length; i++) {
      expect(spiralAxial(i)).toEqual(expected[i])
    }
  })

  it('places the first ring around the centre', () => {
    expect(spiralAxial(0)).toEqual({ q: 0, r: 0 })
    expect(spiralAxial(1)).toEqual({ q: 0, r: -1 })
    expect(spiralAxial(6)).toEqual({ q: -1, r: 0 })
  })

  it('puts the centre hex at the origin', () => {
    expect(axialCentre(0, 0)).toEqual({ x: 0, y: 0 })
  })

  it('refuses a position that is not one', () => {
    expect(() => spiralAxial(-1)).toThrow()
    expect(() => spiralAxial(1.5)).toThrow()
  })
})

describe('the frame', () => {
  it('declares one hole per part', () => {
    expect(slotsOf(divisionPlan(7))).toHaveLength(7)
    expect(slotsOf(divisionPlan(1))).toHaveLength(1)
  })

  it('is ONE number — every rectangle is derived, none is stored', () => {
    expect(payloadOfPlan(divisionPlan(7))).toEqual({ arity: 7 })
    expect(JSON.stringify(payloadOfPlan(divisionPlan(7)))).toHaveLength('{"arity":7}'.length)
  })

  it('is empty rather than wrong when there are no parts', () => {
    expect(slotsOf(divisionPlan(0))).toEqual([])
    expect(slotsOf(divisionPlan(-3))).toEqual([])
  })

  it('gives a single part the whole picture', () => {
    const [slot] = slotsOf(divisionPlan(1))
    expect(slot).toEqual({ index: 0, x: 0, y: 0, w: 1, h: 1 })
  })

  it('divides — every hole is a different region, and none is the whole', () => {
    const slots = slotsOf(divisionPlan(7))
    const regions = new Set(slots.map(s => `${s.x},${s.y}`))
    expect(regions.size).toBe(7)
    for (const slot of slots) {
      expect(slot.w).toBeLessThan(1)
      expect(slot.h).toBeLessThan(1)
    }
  })

  it('covers the picture, so the whole stays recoverable from its parts', () => {
    const slots = slotsOf(divisionPlan(7))
    expect(Math.min(...slots.map(s => s.x))).toBeCloseTo(0, 10)
    expect(Math.min(...slots.map(s => s.y))).toBeCloseTo(0, 10)
    expect(Math.max(...slots.map(s => s.x + s.w))).toBeCloseTo(1, 10)
    expect(Math.max(...slots.map(s => s.y + s.h))).toBeCloseTo(1, 10)
  })

  it('keeps every hole inside the picture', () => {
    for (const count of [1, 2, 3, 7, 19, 37]) {
      for (const slot of slotsOf(divisionPlan(count))) {
        expect(slot.x).toBeGreaterThanOrEqual(-1e-9)
        expect(slot.y).toBeGreaterThanOrEqual(-1e-9)
        expect(slot.x + slot.w).toBeLessThanOrEqual(1 + 1e-9)
        expect(slot.y + slot.h).toBeLessThanOrEqual(1 + 1e-9)
      }
    }
  })

  it('cuts every hole the same size — the hexes are one grid, not seven crops', () => {
    const slots = slotsOf(divisionPlan(7))
    for (const slot of slots) {
      expect(slot.w).toBeCloseTo(slots[0].w, 12)
      expect(slot.h).toBeCloseTo(slots[0].h, 12)
    }
    // Each hole is one hex's bounding box in a picture fitted to the whole
    // spiral, so the hole's share of the picture is the hex's share of the box.
    const spanX = HEX_W * 3          // three hexes across, for a ring-1 spiral
    const spanY = 1.5 * 2 + HEX_H    // two rows out at 1.5 each, plus one hex
    expect(slots[0].w).toBeCloseTo(HEX_W / spanX, 10)
    expect(slots[0].h).toBeCloseTo(HEX_H / spanY, 10)
  })
})

describe('a placeholder is an interface, never a pointer', () => {
  it('names no part — nothing in a frame identifies who fills it', () => {
    for (const slot of slotsOf(divisionPlan(7))) {
      expect(Object.keys(slot).sort()).toEqual(['h', 'index', 'w', 'x', 'y'])
    }
  })

  it('carries no bytes — a frame can never drag content into a closure', () => {
    expect(JSON.stringify(payloadOfPlan(divisionPlan(7)))).not.toMatch(/[0-9a-f]{64}/)
  })

  it('is shape only, so it is valid before anything exists to fill it', () => {
    // The same frame, minted with no picture anywhere, is the frame a picture
    // arriving later divides into. Filling is never required.
    expect(divisionPlan(7)).toEqual(divisionPlan(7))
  })

  it('answers by position, which is what the part’s membership carries', () => {
    const plan = divisionPlan(3)
    expect(slotAt(plan, 2)).toEqual(slotsOf(plan)[2])
    expect(slotAt(plan, 3)).toBeNull()
    expect(slotAt(plan, -1)).toBeNull()
  })

  it('is named by a colon-scoped kind, per the paradigm', () => {
    expect(DIVISION_KIND).toBe('visual:division:plan')
  })
})

describe('reading a frame back', () => {
  it('round-trips through a decoration payload', () => {
    const plan = divisionPlan(4)
    expect(planOfPayload(JSON.parse(JSON.stringify(payloadOfPlan(plan))))).toEqual(plan)
  })

  it('reads absent or malformed as “never broken apart”, not as broken', () => {
    expect(planOfPayload(undefined).arity).toBe(0)
    expect(planOfPayload({}).arity).toBe(0)
    expect(planOfPayload({ arity: 'nope' }).arity).toBe(0)
    expect(planOfPayload({ arity: -2 }).arity).toBe(0)
  })

  it('keeps the arity of a frame written in the retired rectangle form', () => {
    // Records already in the hive hold the derivation. Reading them as their
    // own length keeps those wholes at seven holes instead of silently zero.
    const retired = { slots: Array.from({ length: 7 }, (_u, index) => ({ index, x: 0, y: 0, w: 1, h: 1 })) }
    expect(planOfPayload(retired)).toEqual(divisionPlan(7))
  })

  it('derives exactly what the retired form stored — the same rectangles', () => {
    // The live proof run recorded these off the hive before the reduction.
    expect(slotsOf(divisionPlan(7)).map(s => [s.x, s.y, s.w, s.h].map(v => +v.toFixed(4))))
      .toEqual([
        [0.3333, 0.3, 0.3333, 0.4],
        [0.1667, 0, 0.3333, 0.4],
        [0.5, 0, 0.3333, 0.4],
        [0.6667, 0.3, 0.3333, 0.4],
        [0.5, 0.6, 0.3333, 0.4],
        [0.1667, 0.6, 0.3333, 0.4],
        [0, 0.3, 0.3333, 0.4],
      ])
  })
})

describe('where there is nothing to divide', () => {
  it('gives the same part the same visual, on every host, forever', () => {
    expect(derivedVisualSpec('cooling loop')).toEqual(derivedVisualSpec('Cooling Loop'))
  })

  it('never lets two parts converge on one picture', () => {
    const names = ['intake', 'compressor', 'combustor', 'turbine', 'nozzle', 'gearbox', 'casing']
    const seen = new Set(names.map(n => JSON.stringify(derivedVisualSpec(n))))
    expect(seen.size).toBe(names.length)
  })

  it('always marks the tile, and never fills it flat', () => {
    for (const name of ['a', 'part', 'intake', 'x y z', '構造']) {
      const spec = derivedVisualSpec(name)
      expect(spec.sectors.length).toBeGreaterThan(0)
      expect(spec.sectors.length).toBeLessThan(6)
      expect(spec.reach).toBeGreaterThan(0)
      expect(spec.reach).toBeLessThanOrEqual(1)
    }
  })

  it('answers for a nameless part rather than throwing', () => {
    expect(derivedVisualSpec('')).toEqual(derivedVisualSpec('part'))
  })
})
