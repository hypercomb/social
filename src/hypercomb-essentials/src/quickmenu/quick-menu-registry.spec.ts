// quick-menu-registry.spec.ts — the many-tiles ring (`selection:many`).
//
// Two or more tiles at once get their own ring: five verbs that make sense for
// every tile, each one flick, remove on a seat of its own with an empty seat
// beside it, every verb onTile so the operands are the selection when it runs.

import { describe, expect, it } from 'vitest'
import { QuickMenuRegistry } from './quick-menu-registry.service.js'
import { MANY_TILES_MENU } from './quick-menu.operands.js'
import { manyIcon, slotGlyph } from './quick-menu.honey.js'
import { QUICK_MENU_RING, slotsByDirection, type QuickMenuDirection } from './quick-menu.types.js'

const registry = new QuickMenuRegistry()
const many = registry.byName(MANY_TILES_MENU)!

describe('the many-tiles ring', () => {
  it('is registered beside the selection ring, by name only', () => {
    expect(many).toBeTruthy()
    expect(registry.byName('selection')).toBeTruthy()
    expect(many.contexts).toEqual([])
    expect(registry.forContext('hexagons').name).not.toBe(MANY_TILES_MENU)
  })

  it('holds images, generate, shelf, hide and remove, and no centre', () => {
    expect(many.slots.map(s => s.label).sort()).toEqual(['generate', 'hide', 'images', 'remove', 'shelf'])
    expect(many.slots.some(s => s.direction === 'centre')).toBe(false)
    for (const slot of many.slots) expect(QUICK_MENU_RING).toContain(slot.direction)
  })

  it('every verb is onTile, a leaf, and has a drawing', () => {
    for (const slot of many.slots) {
      expect(slot.onTile, slot.label).toBe(true)
      expect(slot.action.kind).not.toBe('menu')
      expect(slotGlyph(slot.icon), slot.label).toBeTruthy()
    }
    // the middle's stack has its drawing too, and no option wears it
    expect(slotGlyph(manyIcon)).toBeTruthy()
    expect(many.slots.some(s => s.icon === manyIcon)).toBe(false)
  })

  it('runs the agreed words and effects', () => {
    const by = new Map(many.slots.map(s => [s.label, s.action]))
    expect(by.get('images')).toEqual({ kind: 'command', command: 'images' })
    expect(by.get('generate')).toEqual({ kind: 'command', command: 'comfy', args: 'each' })
    expect(by.get('shelf')).toEqual({ kind: 'effect', effect: 'shelf:take-selection', payload: {} })
    // hide and remove are the selection ring's own
    const edit = new Map(registry.byName('selection:edit')!.slots.map(s => [s.label, s.action]))
    expect(by.get('hide')).toEqual(edit.get('hide'))
    expect(by.get('remove')).toEqual(edit.get('remove'))
  })

  it('sits remove alone: one of its neighbours is an empty seat', () => {
    const seats = slotsByDirection(many)
    const remove = many.slots.find(s => s.label === 'remove')!.direction
    const at = QUICK_MENU_RING.indexOf(remove)
    const neighbours: QuickMenuDirection[] = [QUICK_MENU_RING[(at + 5) % 6], QUICK_MENU_RING[(at + 1) % 6]]
    expect(neighbours.some(d => !seats.has(d))).toBe(true)
    // and the easiest flick is images
    expect(seats.get('east')?.label).toBe('images')
  })
})
