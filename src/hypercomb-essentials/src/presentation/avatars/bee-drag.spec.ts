// presentation/avatars/bee-drag.spec.ts
//
// A BEE CAN BE PUT SOMEWHERE ELSE. What this pins:
//
//   1. a press only becomes a drag once it has travelled — a click that
//      wobbles still opens the request
//   2. the threshold is in CSS px, so it is the same gesture at any zoom
//   3. the bee does not jump under the cursor: the grab offset is kept
//   4. what is remembered is a displacement from the bee's OWN anchor, so a
//      pan carries the nudge along instead of stranding the bee
//   5. dropped back where the work put it, the bee goes home — that is the
//      whole of "undo a nudge"
//   6. the snap-home test is measured on SCREEN, not in the world
//   7. THE BROOM: a scribble — back and forth, or in circles — is told apart
//      from ordinary mousing by how much it TURNS, and a swept bee lands
//      inside the wall it was pushed toward

import { describe, it, expect } from 'vitest'
import {
  DRAG_PX, SCRUB_PAUSE_MS, SCRUB_WINDOW_MS, SNAP_HOME_PX, ScrubDetector,
  isDrag, nudgeFrom, snapsHome, sweptAsideTo,
} from './bee-drag.js'

describe('bee drag — a press that travels carries the bee', () => {

  it('does not call a still press a drag', () => {
    expect(isDrag(0, 0)).toBe(false)
    expect(isDrag(1, 1)).toBe(false)
    expect(isDrag(DRAG_PX - 1, 0)).toBe(false)
  })

  it("leaves a click's worth of slop, because the bee is dancing", () => {
    // You press a bee in motion, so the hand is usually still moving when the
    // button goes down. Ten pixels of that is a click, not a drag.
    expect(isDrag(10, 0)).toBe(false)
    expect(isDrag(7, 7)).toBe(false)
  })

  it('takes up the drag the moment the press has travelled', () => {
    expect(isDrag(DRAG_PX, 0)).toBe(true)
    expect(isDrag(0, -DRAG_PX)).toBe(true)
    expect(isDrag(40, 30)).toBe(true)
  })

  it('keeps the grab offset, so the bee does not jump under the cursor', () => {
    // Grabbed 10 to the right and 4 below the dance centre; the pointer has
    // moved to (200, 100). The centre must land at (190, 96), which — against
    // a home at (150, 60) — is a nudge of (40, 36).
    const nudge = nudgeFrom({ x: 200, y: 100 }, { x: 10, y: 4 }, { x: 150, y: 60 })
    expect(nudge).toEqual({ x: 40, y: 36 })
  })

  it('holds a displacement from the anchor, not a place on the map', () => {
    // The same pull, with the hive panned 500 to the right underneath it,
    // yields the SAME nudge: the bee travels with the tile it belongs to.
    const still = nudgeFrom({ x: 200, y: 100 }, { x: 0, y: 0 }, { x: 150, y: 60 })
    const panned = nudgeFrom({ x: 700, y: 100 }, { x: 0, y: 0 }, { x: 650, y: 60 })
    expect(panned).toEqual(still)
  })

  it('sends a bee home when it is dropped back where its work put it', () => {
    expect(snapsHome({ x: 0, y: 0 }, 1)).toBe(true)
    expect(snapsHome({ x: SNAP_HOME_PX - 1, y: 0 }, 1)).toBe(true)
    expect(snapsHome({ x: SNAP_HOME_PX + 1, y: 0 }, 1)).toBe(false)
  })

  it('measures the drop on screen, so zoom does not change the gesture', () => {
    // Zoomed out to a quarter, a world displacement of 40 is 10 on screen —
    // and 10px from home is home.
    expect(snapsHome({ x: 40, y: 0 }, 0.25)).toBe(true)
    // Zoomed in ×4, the same world displacement is 160px away — nowhere near.
    expect(snapsHome({ x: 40, y: 0 }, 4)).toBe(false)
  })

  it('survives a world with no scale rather than dividing the hive by zero', () => {
    expect(snapsHome({ x: 4, y: 0 }, 0)).toBe(true)
  })
})

describe('the broom — scribbling sweeps the bees aside', () => {
  /** Feed a path of points, one every 30ms, and report every sweep it fired. */
  const scrub = (points: Array<{ x: number; y: number }>, step = 30) => {
    const detector = new ScrubDetector()
    const fired: Array<{ x: number; y: number }> = []
    let t = 1000
    for (const point of points) {
      const hit = detector.feed(point.x, point.y, t)
      if (hit) fired.push(hit)
      t += step
    }
    return fired
  }

  const backAndForth = (legs: number, span = 60, y = 400) => {
    const points: Array<{ x: number; y: number }> = []
    for (let leg = 0; leg < legs; leg++) {
      const from = leg % 2 ? span : -span
      const to = leg % 2 ? -span : span
      for (let i = 1; i <= 4; i++) points.push({ x: 700 + from + ((to - from) * i) / 4, y })
    }
    return points
  }

  const circle = (turns: number, radius = 40, samples = 16) => {
    const points: Array<{ x: number; y: number }> = []
    for (let i = 0; i <= samples * turns; i++) {
      const a = (i / samples) * Math.PI * 2
      points.push({ x: 700 + Math.cos(a) * radius, y: 400 + Math.sin(a) * radius })
    }
    return points
  }

  it('reads a back-and-forth scribble as a sweep', () => {
    expect(scrub(backAndForth(4)).length).toBe(1)
  })

  it('reads a circular scribble as the same sweep', () => {
    expect(scrub(circle(1.5)).length).toBeGreaterThanOrEqual(1)
  })

  it('never reads a straight travel as a sweep', () => {
    const straight = Array.from({ length: 30 }, (_, i) => ({ x: 200 + i * 20, y: 400 }))
    expect(scrub(straight)).toEqual([])
  })

  it('never reads an ordinary curved approach as a sweep', () => {
    // A quarter turn on the way to a tile — the commonest mouse path there is.
    const curve = Array.from({ length: 14 }, (_, i) => {
      const a = (i / 13) * (Math.PI / 2)
      return { x: 600 + Math.sin(a) * 180, y: 500 - (1 - Math.cos(a)) * 180 }
    })
    expect(scrub(curve)).toEqual([])
  })

  it('never lets a slow hour of mousing add up to one', () => {
    // The same scribble, but each stroke a second and a half apart.
    expect(scrub(backAndForth(6), SCRUB_WINDOW_MS + 400)).toEqual([])
  })

  it('never lets ORDINARY MOUSING add up to one', () => {
    // Go somewhere, stop, come back, stop, go on: two reversals, which is as
    // much turning as a scribble has — and it swept the hive by accident until
    // the turning had to be continuous (measured 2026-09-09).
    const detector = new ScrubDetector()
    let t = 1000
    const trip = (from: { x: number; y: number }, to: { x: number; y: number }) => {
      for (let i = 1; i <= 8; i++) {
        const point = { x: from.x + ((to.x - from.x) * i) / 8, y: from.y + ((to.y - from.y) * i) / 8 }
        expect(detector.feed(point.x, point.y, t)).toBeNull()
        t += 16
      }
      t += SCRUB_PAUSE_MS + 300   // the hand stops to read something
    }
    trip({ x: 700, y: 400 }, { x: 480, y: 540 })
    trip({ x: 480, y: 540 }, { x: 700, y: 438 })
    trip({ x: 700, y: 438 }, { x: 520, y: 500 })
  })

  it('sweeps once per scribble, not once per stroke', () => {
    // Ten legs is one long continuous scribble, and it is one act — otherwise
    // the bees would go out, come back and go out again under one gesture.
    expect(scrub(backAndForth(10)).length).toBe(1)
  })

  it('comes down again after a SHORT pause too', () => {
    const detector = new ScrubDetector()
    let fired = 0
    let t = 1000
    const run = () => {
      for (const point of backAndForth(6)) {
        if (detector.feed(point.x, point.y, t)) fired++
        t += 30
      }
    }
    run()
    t += SCRUB_PAUSE_MS + 40
    run()
    expect(fired).toBe(2)
  })

  it('comes down again once the hand holds still', () => {
    const detector = new ScrubDetector()
    const fired: unknown[] = []
    let t = 1000
    for (const point of backAndForth(6)) {
      const hit = detector.feed(point.x, point.y, t)
      if (hit) fired.push(hit)
      t += 30
    }
    expect(fired.length).toBe(1)
    // A pause — then a fresh scribble is a fresh act, and sweeps again. The
    // pause here is longer than the whole window on purpose: that is the
    // ordinary case (sweep, do something else, scribble again) and it is the
    // one that used to leave the broom up for the rest of the session.
    t += SCRUB_WINDOW_MS * 3
    for (const point of backAndForth(6)) {
      const hit = detector.feed(point.x, point.y, t)
      if (hit) fired.push(hit)
      t += 30
    }
    expect(fired.length).toBe(2)
  })

  it('answers with the middle of the scribble, so the sweep starts where you scrubbed', () => {
    const [at] = scrub(backAndForth(4, 60, 400))
    expect(at).toBeDefined()
    expect(Math.abs(at.x - 700)).toBeLessThan(60)
    expect(Math.abs(at.y - 400)).toBeLessThan(20)
  })

  it('forgets the stroke in progress when the gesture is taken over', () => {
    const detector = new ScrubDetector()
    let t = 1000
    for (const point of backAndForth(3)) { detector.feed(point.x, point.y, t); t += 30 }
    detector.clear()
    // One more leg would have finished it; after a clear it is starting over.
    for (const point of backAndForth(1)) {
      expect(detector.feed(point.x, point.y, t)).toBeNull()
      t += 30
    }
  })
})

describe('swept aside — where the broom puts a bee', () => {
  const room = { left: 0, top: 100, right: 1000, bottom: 700 }

  it('sends the bee out along the line from the broom', () => {
    // Broom to the left of the bee: the bee goes right, to the right wall.
    const to = sweptAsideTo({ x: 500, y: 400 }, { x: 300, y: 400 }, room, 36)
    expect(to.x).toBeCloseTo(964, 0)
    expect(to.y).toBeCloseTo(400, 0)
  })

  it('parks it inside the wall, never on it', () => {
    const to = sweptAsideTo({ x: 500, y: 400 }, { x: 500, y: 690 }, room, 36)
    // Swept upward — and the room's top is the header's bottom, not zero.
    expect(to.y).toBeGreaterThanOrEqual(room.top + 36 - 0.5)
  })

  it('sends a bee under the broom straight up', () => {
    const to = sweptAsideTo({ x: 500, y: 400 }, { x: 500, y: 400 }, room, 36)
    expect(to.x).toBeCloseTo(500, 0)
    expect(to.y).toBeCloseTo(136, 0)
  })

  it('parks it in the middle when the room is too small to hold it', () => {
    const to = sweptAsideTo({ x: 40, y: 40 }, { x: 10, y: 10 }, { left: 0, top: 0, right: 50, bottom: 50 }, 40)
    expect(to).toEqual({ x: 25, y: 25 })
  })
})
