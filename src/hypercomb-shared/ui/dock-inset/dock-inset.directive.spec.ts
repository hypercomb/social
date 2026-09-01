// dock-inset.directive.spec.ts
//
// The geometry a docked panel reserves. Only the pure rule is exercised here —
// the scheduling around it is a race between a frame and a timer, and a mocked
// clock would prove nothing a browser has not already shown.

import { describe, expect, it } from 'vitest'
import { reservationFor, type InsetRect } from './dock-inset.directive'

/** A rect, written the way a panel is actually described. */
const at = (left: number, top: number, width: number, height: number): InsetRect => ({
  left, top, width, height, right: left + width, bottom: top + height,
})

const SCREEN = { width: 1153, height: 794 }

describe('reservationFor', () => {
  it('reserves up to the inner edge of a left-docked panel', () => {
    // The real measurement from the layout designer's palette.
    expect(reservationFor('left', at(54, 37, 321, 757), SCREEN)).toBe(375)
  })

  it('reserves the gap from a right-docked panel back to the screen edge', () => {
    // The real measurement from the flex editor, the panel that was covering
    // 153px of the design canvas while reserving nothing.
    expect(reservationFor('right', at(853, 37, 300, 757), SCREEN)).toBe(300)
  })

  it('measures top and bottom from their own edges', () => {
    expect(reservationFor('top', at(0, 0, 1153, 40), SCREEN)).toBe(40)
    expect(reservationFor('bottom', at(0, 694, 1153, 100), SCREEN)).toBe(100)
  })

  it('reserves to the screen edge even when the panel is not flush to it', () => {
    // A panel inset from the edge still owns everything outboard of it, or the
    // gap beside it becomes a strip nothing may use.
    expect(reservationFor('right', at(900, 37, 200, 757), SCREEN)).toBe(253)
  })

  it('reserves nothing for a panel with no area', () => {
    // What a panel measures as before it has been laid out. Reserving zero is
    // right; reserving a guess would move the world for one frame.
    expect(reservationFor('right', at(0, 0, 0, 0), SCREEN)).toBe(0)
    expect(reservationFor('left', at(54, 37, 321, 0), SCREEN)).toBe(0)
  })

  it('reserves nothing for a full-bleed sheet on a horizontal side', () => {
    // The phone case: several panels flip to a full-width sheet in their own
    // SCSS while still declaring `hcDockInset="right"`. Left as a right-edge
    // reservation that is the WHOLE viewport, which squeezes the canvas to
    // nothing and pushes the control bar off screen.
    expect(reservationFor('right', at(0, 400, 1153, 394), SCREEN)).toBe(0)
    expect(reservationFor('left', at(0, 400, 1153, 394), SCREEN)).toBe(0)
  })

  it('still reserves for a full-WIDTH panel docked to a vertical side', () => {
    // Spanning the axis you are NOT docked against is ordinary — a bottom
    // sheet is supposed to be as wide as the screen. Only spanning your own
    // axis means "this is not really docked to that edge".
    expect(reservationFor('bottom', at(0, 400, 1153, 394), SCREEN)).toBe(394)
    expect(reservationFor('top', at(0, 0, 1153, 40), SCREEN)).toBe(40)
  })

  it('reserves nothing for a sheet that spans its own axis vertically', () => {
    expect(reservationFor('bottom', at(300, 0, 400, 794), SCREEN)).toBe(0)
  })

  it('allows a pixel of slack at each edge, for fractional layout', () => {
    // Rects are fractional at a non-integer device pixel ratio, so a sheet
    // that spans the screen can measure 0.5 short at each end.
    expect(reservationFor('right', at(0.5, 0, 1152, 794), SCREEN)).toBe(0)
    // Two pixels in from the edge is a real panel, not a sheet.
    expect(reservationFor('right', at(2, 0, 1151, 794), SCREEN)).toBe(1151)
  })

  it('never returns a negative reservation', () => {
    // A panel dragged or animated off the right of the screen.
    expect(reservationFor('right', at(1400, 37, 300, 757), SCREEN)).toBe(0)
    expect(reservationFor('left', at(-400, 37, 300, 757), SCREEN)).toBe(0)
  })
})
