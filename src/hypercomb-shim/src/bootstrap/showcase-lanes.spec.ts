// hypercomb-shim/src/bootstrap/showcase-lanes.spec.ts — the phone's showcase in lanes: a landing grid sized to the
// space, on the hive's axial matrix, a window that steps, and a lock when the touch gets confusing.

import { describe, expect, it } from 'vitest'
import {
  LANE_MIN_TILE, LANE_SLOP, LaneTouch, hostOf, laneAxial, laneDrift, laneLayout, laneMaxShift, lanePosition, laneSnap,
  laneTileAt, onePerHost, parseOrientation,
} from './showcase-lanes'

const SQRT3 = Math.sqrt(3)

describe('the landing grid', () => {
  for (const flat of [false, true]) {
    const name = flat ? 'flat-top' : 'pointy-top'
    it(`${name}: a 375px phone holds three or more readable lanes and fills the height it is given`, () => {
      const layout = laneLayout(343, 520, flat)
      expect(layout.lanes).toBeGreaterThanOrEqual(3)
      expect(layout.tileWidth).toBeGreaterThanOrEqual(LANE_MIN_TILE)
      expect(layout.rows).toBeGreaterThanOrEqual(3)
      expect(layout.capacity).toBe(layout.lanes * layout.rows)
      // every slot is inside the space, and the block is centred in it
      for (let row = 0; row < layout.rows; row++) for (let lane = 0; lane < layout.lanes; lane++) {
        const at = lanePosition(layout, lane, row)
        expect(at.x).toBeGreaterThanOrEqual(-0.01)
        expect(at.y).toBeGreaterThanOrEqual(-0.01)
        expect(at.x + layout.tileWidth).toBeLessThanOrEqual(343.01)
        expect(at.y + layout.tileHeight).toBeLessThanOrEqual(520.01)
      }
    })

    it(`${name}: the slots are the axial matrix — every slot is the axial formula's point, up to one translation`, () => {
      const layout = laneLayout(343, 520, flat)
      const radius = layout.spacing / SQRT3
      const pixel = (q: number, r: number) => flat
        ? { x: 1.5 * radius * q, y: SQRT3 * radius * (r + q / 2) }
        : { x: SQRT3 * radius * (q + r / 2), y: 1.5 * radius * r }
      const zero = lanePosition(layout, 0, 0)
      for (let row = -2; row < layout.rows + 2; row++) for (let lane = 0; lane < layout.lanes; lane++) {
        const { q, r } = laneAxial(flat, lane, row)
        const want = pixel(q, r)
        const got = lanePosition(layout, lane, row)
        expect(got.x - zero.x).toBeCloseTo(want.x, 6)
        expect(got.y - zero.y).toBeCloseTo(want.y, 6)
      }
    })

    it(`${name}: one step is an exact translation, so a snap never jumps the tiles sideways`, () => {
      const layout = laneLayout(343, 520, flat)
      for (let lane = 0; lane < layout.lanes; lane++) {
        const a = lanePosition(layout, lane, 0)
        const b = lanePosition(layout, lane, layout.stepRows)
        expect(b.x).toBeCloseTo(a.x, 6)
        expect(b.y - a.y).toBeCloseTo(layout.stepPx, 6)
      }
    })
  }

  it('a narrow strip gives up lanes before it draws tiles too small to read', () => {
    expect(laneLayout(200, 600, false).lanes).toBeLessThan(laneLayout(343, 600, false).lanes)
    expect(laneLayout(120, 600, false).lanes).toBe(1)
  })
})

describe('the window', () => {
  const layout = laneLayout(343, 520, false)

  it('slot s shows tile s + offset, and the window travels only as far as there are tiles', () => {
    const count = layout.capacity + 1
    expect(laneMaxShift(layout, layout.capacity)).toBe(0)
    expect(laneMaxShift(layout, count)).toBe(1)
    expect(laneTileAt(layout, 0, 0, 0, count)).toBe(0)
    expect(laneTileAt(layout, 1, 0, 0, count)).toBe(layout.lanes * layout.stepRows)
    expect(laneTileAt(layout, 0, 0, -1, count)).toBe(-1)
    expect(laneTileAt(layout, 1, layout.lanes - 1, layout.rows - 1, count)).toBe(-1)
  })

  it('a drag settles on whole steps — a quarter step takes one, never past either end', () => {
    expect(laneSnap(-layout.stepPx * 0.1, layout.stepPx, 0, 3)).toBe(0)
    expect(laneSnap(-layout.stepPx * 0.3, layout.stepPx, 0, 3)).toBe(1)
    expect(laneSnap(-layout.stepPx * 2.2, layout.stepPx, 0, 3)).toBe(2)
    expect(laneSnap(-layout.stepPx * 9, layout.stepPx, 0, 3)).toBe(3)
    expect(laneSnap(layout.stepPx, layout.stepPx, 0, 3)).toBe(0)
    expect(laneSnap(layout.stepPx, layout.stepPx, 2, 3)).toBe(1)
  })

  it('the tiles follow the finger freely, and only stretch a little past the ends', () => {
    expect(laneDrift(-40, 100, 0, 2)).toBe(-40)
    expect(Math.abs(laneDrift(80, 100, 0, 2))).toBeLessThanOrEqual(30)
    expect(Math.abs(laneDrift(-80, 100, 2, 2))).toBeLessThanOrEqual(30)
  })
})

describe('the lock', () => {
  it('a press that stays inside the slop is a tap: nothing moved', () => {
    const touch = new LaneTouch()
    touch.down(1, 100, 100)
    expect(touch.move(1, 100 + LANE_SLOP - 2, 101)).toBe('press')
    expect(touch.dy).toBe(0)
    expect(touch.up(1)).toEqual({ mode: 'press', dy: 0 })
  })

  it('clearly up or down drifts with the finger', () => {
    const touch = new LaneTouch()
    touch.down(1, 100, 300)
    expect(touch.move(1, 104, 240)).toBe('drift')
    expect(touch.dy).toBe(-60)
    expect(touch.up(1)).toEqual({ mode: 'drift', dy: -60 })
  })

  it('across or diagonal is confusing: locked in place for the rest of the gesture', () => {
    for (const [x, y] of [[160, 300], [140, 330]] as const) {
      const touch = new LaneTouch()
      touch.down(1, 100, 300)
      expect(touch.move(1, x, y)).toBe('locked')
      expect(touch.move(1, 100, 100)).toBe('locked')
      expect(touch.dy).toBe(0)
      expect(touch.up(1)).toEqual({ mode: 'locked', dy: 0 })
    }
  })

  it('a second finger locks a drift back into the slots until every finger is up', () => {
    const touch = new LaneTouch()
    touch.down(1, 100, 300)
    touch.move(1, 100, 200)
    expect(touch.down(2, 200, 300)).toBe('locked')
    expect(touch.dy).toBe(0)
    expect(touch.up(1)).toBeNull()
    expect(touch.move(2, 200, 100)).toBe('locked')
    expect(touch.up(2)).toEqual({ mode: 'locked', dy: 0 })
    // the next gesture starts clean
    expect(touch.down(3, 0, 0)).toBe('press')
  })
})

describe('one per subdomain, on any domain', () => {
  type Pick = { zone: string; key: string; host: string }
  const pick = (key: string, host: string): Pick => ({ zone: 'x', key, host })

  it('a second tile from the same host takes the first one\'s place; other hosts, the apex included, keep theirs', () => {
    const picks = [pick('a', 'protocol.hypercomb.com'), pick('b', 'hypercomb.com'), pick('c', 'arkanoid.pluginthematrix.com')]
    const next = onePerHost(picks, pick('d', 'Protocol.Hypercomb.com'), entry => entry.host)
    expect(next.map(entry => entry.key)).toEqual(['b', 'c', 'd'])
  })

  it('the host is read from the link, else the row', () => {
    expect(hostOf('https://revolucion.pluginthematrix.com/x', 'z')).toBe('revolucion.pluginthematrix.com')
    expect(hostOf('not a url', 'hypercomb.com')).toBe('hypercomb.com')
  })
})

it('the kept orientation is believed only when it says what it is', () => {
  expect(parseOrientation({ kind: 'showcase:orientation', flat: true })).toBe(true)
  expect(parseOrientation({ kind: 'showcase:orientation', flat: 'yes' })).toBeNull()
  expect(parseOrientation({ flat: true })).toBeNull()
})
