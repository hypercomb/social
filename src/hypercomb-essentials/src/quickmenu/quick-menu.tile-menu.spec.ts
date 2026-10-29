// quick-menu.tile-menu.spec.ts — the selection menu replaces the hover icons,
// and its options sit just outside the tile.

import { describe, expect, it } from 'vitest'
import {
  hoverActionsSuppressed,
  isTypingTarget,
  menuMetrics,
  selectionMenuWanted,
  slotUnder,
} from './quick-menu.tile-menu.js'

const metrics = menuMetrics(32)
const wanted = {
  ctrl: true,
  overTile: true,
  buttonDown: false,
  typing: false,
  wand: false,
  clipboard: false,
  gesture: false,
  onCtrlIcon: false,
  latchedOff: false,
}

describe('the selection menu around a tile', () => {
  it('puts each option just outside the tile', () => {
    expect(metrics.reach - metrics.radius).toBeGreaterThan(metrics.tileRadius)
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

  it('ctrl over a tile wants the selection menu', () => {
    expect(selectionMenuWanted(wanted)).toBe(true)
  })

  it('a drag, a field, the wand, the clipboard, a gesture, or Escape keeps it down', () => {
    expect(selectionMenuWanted({ ...wanted, ctrl: false })).toBe(false)
    expect(selectionMenuWanted({ ...wanted, overTile: false })).toBe(false)
    expect(selectionMenuWanted({ ...wanted, buttonDown: true })).toBe(false)
    expect(selectionMenuWanted({ ...wanted, typing: true })).toBe(false)
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

  it('a text field is typing; the canvas is not', () => {
    expect(isTypingTarget(null)).toBe(false)
    const input = document.createElement('input')
    expect(isTypingTarget(input)).toBe(true)
    const div = document.createElement('div')
    div.contentEditable = 'true'
    expect(isTypingTarget(div)).toBe(true)
    expect(isTypingTarget(document.createElement('canvas'))).toBe(false)
  })
})
