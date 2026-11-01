// quick-menu.tile-menu.spec.ts — the selection menu replaces the hover icons,
// and its options sit just outside the tile.

import { describe, expect, it } from 'vitest'
import {
  hoverActionsSuppressed,
  menuMetrics,
  selectionMenuWanted,
  slotUnder,
} from './quick-menu.tile-menu.js'

const metrics = menuMetrics(32, 38)
const wanted = {
  alt: true,
  overTile: true,
  buttonDown: false,
  wand: false,
  clipboard: false,
  gesture: false,
  onCtrlIcon: false,
  latchedOff: false,
}

describe('the selection menu around a tile', () => {
  it('puts each option on a neighbouring cell at the size of a tile', () => {
    // The shader draws the tile radius as the apothem.
    expect(metrics.radius * (Math.sqrt(3) / 2)).toBeCloseTo(metrics.tileRadius)
    expect(metrics.reach).toBeCloseTo(Math.sqrt(3) * 38)
  })

  it('turns the six cells 30° on a flat-top hive', () => {
    const flat = menuMetrics(32, 38, true)
    // Axial (1, 0) on flat-top: 1.5 × spacing across, √3/2 × spacing down.
    expect(slotUnder(1.5 * 38, (Math.sqrt(3) / 2) * 38, flat, 'pick')).toBe('east')
  })

  it('the tile body is not an option', () => {
    expect(slotUnder(0, 0, metrics, 'gesture')).toBeNull()
    expect(slotUnder(0, 0, metrics, 'pick')).toBeNull()
    expect(slotUnder(20, 0, metrics, 'gesture')).toBeNull()
    expect(slotUnder(20, 0, metrics, 'pick')).toBeNull()
  })

  it('the east option is the hex east of the tile', () => {
    expect(slotUnder(metrics.reach, 0, metrics, 'pick')).toBe('east')
    expect(slotUnder(metrics.reach, 0, metrics, 'gesture')).toBe('east')
  })

  it('empty ground around the ring is not a slot', () => {
    expect(slotUnder(metrics.reach * 2, metrics.reach * 2, metrics, 'pick')).toBeNull()
  })

  it('alt over a tile wants the selection menu', () => {
    expect(selectionMenuWanted(wanted)).toBe(true)
  })

  it('a drag, the wand, the clipboard, a gesture, or Escape keeps it down', () => {
    expect(selectionMenuWanted({ ...wanted, alt: false })).toBe(false)
    expect(selectionMenuWanted({ ...wanted, overTile: false })).toBe(false)
    expect(selectionMenuWanted({ ...wanted, buttonDown: true })).toBe(false)
    expect(selectionMenuWanted({ ...wanted, wand: true })).toBe(false)
    expect(selectionMenuWanted({ ...wanted, clipboard: true })).toBe(false)
    expect(selectionMenuWanted({ ...wanted, gesture: true })).toBe(false)
    expect(selectionMenuWanted({ ...wanted, onCtrlIcon: true })).toBe(false)
    expect(selectionMenuWanted({ ...wanted, latchedOff: true })).toBe(false)
  })

  it('a picked set, and a menu on a tile, suppress the hover icons', () => {
    expect(hoverActionsSuppressed(false, false)).toBe(false)
    expect(hoverActionsSuppressed(true, false)).toBe(true)
    expect(hoverActionsSuppressed(false, true)).toBe(true)
  })
})
