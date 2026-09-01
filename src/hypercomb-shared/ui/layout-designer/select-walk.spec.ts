// hypercomb-shared/ui/layout-designer/select-walk.spec.ts
//
// The keyboard's arithmetic, argued here rather than in a browser.
//
// Every case is drawn as a real arrangement — a row, a column, a grid, a
// nesting — because the whole claim of this module is that ONE rule answers
// all of them without knowing which it is looking at.

import { describe, expect, it } from 'vitest'
import {
  drillByWheel, drillSelection, stepForKey, walkSelection, wheelNotch,
  type Selectable,
} from './select-walk'

/** A box, given as left/top/width/height because that is how a layout reads. */
const at = (path: string, left: number, top: number, width: number, height: number): Selectable => ({
  path: path ? path.split('/') : [],
  rect: { left, top, right: left + width, bottom: top + height },
})

/** A row of three panes, side by side, inside a root container. */
const ROW: Selectable[] = [
  at('', 0, 0, 300, 100),
  at('a', 0, 0, 100, 100),
  at('b', 100, 0, 100, 100),
  at('c', 200, 0, 100, 100),
]

/** The same three, stacked. */
const COLUMN: Selectable[] = [
  at('', 0, 0, 100, 300),
  at('a', 0, 0, 100, 100),
  at('b', 0, 100, 100, 100),
  at('c', 0, 200, 100, 100),
]

describe('stepForKey', () => {
  it('claims exactly six keys and no others', () => {
    expect(stepForKey('Tab', false)).toBe('next')
    expect(stepForKey('Tab', true)).toBe('previous')
    expect(stepForKey('ArrowUp', false)).toBe('up')
    expect(stepForKey('ArrowDown', false)).toBe('down')
    expect(stepForKey('ArrowLeft', false)).toBe('left')
    expect(stepForKey('ArrowRight', false)).toBe('right')
  })

  it('leaves every other key alone, including what someone might type', () => {
    for (const key of ['a', 'Enter', 'Escape', ' ', 'Delete', 'Home', 'PageDown', 'Shift']) {
      expect(stepForKey(key, false)).toBeNull()
      expect(stepForKey(key, true)).toBeNull()
    }
  })
})

describe('walkSelection — tab', () => {
  it('goes down the document order and wraps, so it reaches everything', () => {
    expect(walkSelection(ROW, [], 'next')).toEqual(['a'])
    expect(walkSelection(ROW, ['a'], 'next')).toEqual(['b'])
    expect(walkSelection(ROW, ['c'], 'next')).toEqual([])
  })

  it('runs backwards with shift, wrapping the other way', () => {
    expect(walkSelection(ROW, ['b'], 'previous')).toEqual(['a'])
    expect(walkSelection(ROW, [], 'previous')).toEqual(['c'])
  })

  it('does not move when there is only one container to be on', () => {
    expect(walkSelection([at('', 0, 0, 100, 100)], [], 'next')).toBeNull()
  })
})

describe('walkSelection — the arrows follow the picture', () => {
  it('walks a row sideways', () => {
    expect(walkSelection(ROW, ['a'], 'right')).toEqual(['b'])
    expect(walkSelection(ROW, ['b'], 'left')).toEqual(['a'])
  })

  it('walks a column up and down, with the SAME keys that walked the row', () => {
    expect(walkSelection(COLUMN, ['a'], 'down')).toEqual(['b'])
    expect(walkSelection(COLUMN, ['b'], 'up')).toEqual(['a'])
  })

  it('does not walk a column sideways — the arrangement decides, not the tree', () => {
    // Deriving the move from the tree would make Right mean "next sibling"
    // and march down the screen. Geometry refuses.
    expect(walkSelection(COLUMN, ['a'], 'right')).toBeNull()
    expect(walkSelection(ROW, ['a'], 'down')).toBeNull()
  })

  it('stops at the edge instead of wrapping, because a wrap reads as a teleport', () => {
    expect(walkSelection(ROW, ['c'], 'right')).toBeNull()
    expect(walkSelection(ROW, ['a'], 'left')).toBeNull()
  })

  it('prefers the box you are level with over one merely nearer', () => {
    // Two candidates to the right: one a little closer but half a screen up,
    // one further out and dead level. The level one is the one you meant.
    const items: Selectable[] = [
      at('here', 0, 100, 50, 50),
      at('adrift', 60, 0, 50, 50),
      at('level', 90, 100, 50, 50),
    ]
    expect(walkSelection(items, ['here'], 'right')).toEqual(['level'])
  })

  it('crosses a row of a wrapping grid when asked to go down', () => {
    const grid: Selectable[] = [
      at('a', 0, 0, 100, 100), at('b', 100, 0, 100, 100),
      at('c', 0, 100, 100, 100), at('d', 100, 100, 100, 100),
    ]
    expect(walkSelection(grid, ['a'], 'down')).toEqual(['c'])
    expect(walkSelection(grid, ['d'], 'up')).toEqual(['b'])
    expect(walkSelection(grid, ['b'], 'left')).toEqual(['a'])
  })

  it('reaches a container nested inside another, by its full hole path', () => {
    const nested: Selectable[] = [
      at('', 0, 0, 200, 100),
      at('left', 0, 0, 100, 100),
      at('right', 100, 0, 100, 100),
      at('right/top', 100, 0, 100, 50),
      at('right/bottom', 100, 50, 100, 50),
    ]
    // Down inside the nest goes to the nest's own lower half, not out.
    expect(walkSelection(nested, ['right/top'], 'down')).toEqual(['right', 'bottom'])
    // Toward the nest lands on the REGION first — the whole box is what is
    // level with you — and a second press steps into it.
    expect(walkSelection(nested, ['left'], 'right')).toEqual(['right'])
    expect(walkSelection(nested, ['right'], 'up')).toEqual(['right', 'top'])
    expect(walkSelection(nested, ['right'], 'down')).toEqual(['right', 'bottom'])
  })

  it('never climbs out to the container you are already in', () => {
    // The root encloses everything and its centre is past yours on some axis
    // almost always. Left as a candidate it wins nearly every press.
    expect(walkSelection(ROW, ['b'], 'right')).toEqual(['c'])
    expect(walkSelection(ROW, ['c'], 'left')).toEqual(['b'])
  })
})

describe('walkSelection — starting from nothing', () => {
  it('lands on the first container whatever key was pressed', () => {
    for (const step of ['next', 'previous', 'up', 'down', 'left', 'right'] as const) {
      expect(walkSelection(ROW, null, step)).toEqual([])
    }
  })

  it('treats a selection that is no longer in the arrangement as nothing', () => {
    // A layout can be replaced under the selection. Landing somewhere real
    // beats refusing to move.
    expect(walkSelection(ROW, ['gone'], 'right')).toEqual([])
  })

  it('has nothing to say about an empty pane', () => {
    expect(walkSelection([], [], 'next')).toBeNull()
  })
})

describe('drillSelection — clicking again goes one layer in', () => {
  // The stack under one point of a design nested two deep.
  const STACK = [[], ['right'], ['right', 'top']]

  it('lands on the outermost container first', () => {
    expect(drillSelection(STACK, null)).toEqual([])
  })

  it('steps one layer deeper per click', () => {
    expect(drillSelection(STACK, [])).toEqual(['right'])
    expect(drillSelection(STACK, ['right'])).toEqual(['right', 'top'])
  })

  it('returns to the top rather than stranding you at the bottom', () => {
    expect(drillSelection(STACK, ['right', 'top'])).toEqual([])
  })

  it('starts over when the selection is not in this stack', () => {
    expect(drillSelection(STACK, ['left'])).toEqual([])
  })

  it('holds still on a flat design, where there is only one layer to be in', () => {
    expect(drillSelection([[]], [])).toEqual([])
  })

  it('has nothing to say about a point with no container under it', () => {
    expect(drillSelection([], [])).toBeNull()
  })
})

describe('drillByWheel — in and out, stopping at both ends', () => {
  const STACK = [[], ['right'], ['right', 'top']]

  it('enters at the whole when scrolling in from nothing', () => {
    expect(drillByWheel(STACK, null, 'in')).toEqual([])
  })

  it('enters at the innermost when scrolling out from nothing', () => {
    expect(drillByWheel(STACK, null, 'out')).toEqual(['right', 'top'])
  })

  it('walks the stack one layer per step', () => {
    expect(drillByWheel(STACK, [], 'in')).toEqual(['right'])
    expect(drillByWheel(STACK, ['right'], 'in')).toEqual(['right', 'top'])
    expect(drillByWheel(STACK, ['right', 'top'], 'out')).toEqual(['right'])
    expect(drillByWheel(STACK, ['right'], 'out')).toEqual([])
  })

  it('never goes past either end, where a click would have wrapped', () => {
    expect(drillByWheel(STACK, ['right', 'top'], 'in')).toBeNull()
    expect(drillByWheel(STACK, [], 'out')).toBeNull()
    // The same two positions under a click DO come round.
    expect(drillSelection(STACK, ['right', 'top'])).toEqual([])
  })

  it('starts over from the far end when the selection is elsewhere', () => {
    expect(drillByWheel(STACK, ['left'], 'in')).toEqual([])
    expect(drillByWheel(STACK, ['left'], 'out')).toEqual(['right', 'top'])
  })

  it('has nothing to say about a point with no container under it', () => {
    expect(drillByWheel([], null, 'in')).toBeNull()
  })
})

describe('wheelNotch — one layer per turn of the wheel', () => {
  it('steps once on a mouse wheel notch', () => {
    expect(wheelNotch(0, 100)).toEqual({ carried: 0, step: 1 })
    expect(wheelNotch(0, -100)).toEqual({ carried: 0, step: -1 })
  })

  it('does not fall through the layers on a trackpad flick', () => {
    let carried = 0
    let steps = 0
    for (let i = 0; i < 5; i++) {
      const out = wheelNotch(carried, 8)
      carried = out.carried
      steps += Math.abs(out.step)
    }
    expect(steps).toBe(0)
  })

  it('gathers small deltas until they add up to a turn', () => {
    let carried = 0
    let steps = 0
    for (let i = 0; i < 20; i++) {
      const out = wheelNotch(carried, 8)
      carried = out.carried
      steps += Math.abs(out.step)
    }
    expect(steps).toBe(3)
  })

  it('discards what was carried when the direction changes', () => {
    const { carried } = wheelNotch(0, 40)
    expect(carried).toBe(40)
    expect(wheelNotch(carried, -40)).toEqual({ carried: -40, step: 0 })
  })

  it('never falls through more than one layer on a single flick', () => {
    expect(wheelNotch(0, 240)).toEqual({ carried: 40, step: 1 })
  })

  it('holds the carry under a notch however long you keep scrolling', () => {
    let carried = 0
    for (let i = 0; i < 30; i++) carried = wheelNotch(carried, 100).carried
    expect(Math.abs(carried)).toBeLessThan(50)
  })

  it('ignores an event that carries no movement', () => {
    expect(wheelNotch(30, 0)).toEqual({ carried: 30, step: 0 })
  })
})
