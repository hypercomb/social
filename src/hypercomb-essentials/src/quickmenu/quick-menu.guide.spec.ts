import { describe, expect, it } from 'vitest'
import { guideFor } from './quick-menu.guide.js'
import type { QuickMenuSlot } from './quick-menu.types.js'

const slot = (extra: Partial<QuickMenuSlot> = {}): QuickMenuSlot =>
  ({ direction: 'east', label: 'remove', action: { kind: 'command', command: 'remove' }, ...extra })

describe('guideFor', () => {
  it('leads with the tile and says how to aim before anything is lit', () => {
    const guide = guideFor({ subject: 'notes', operands: ['notes'], path: [], lit: null, asleep: false })
    expect(guide.crumbs).toEqual(['notes'])
    expect(guide.litLast).toBe(false)
    expect(guide.instruction).toBe('Aim at an option · Release Alt to close')
  })

  it('walks the rings taken as crumbs and offers the way back', () => {
    const guide = guideFor({ subject: 'notes', operands: ['notes'], path: ['Edit'], lit: null, asleep: false })
    expect(guide.crumbs).toEqual(['notes', 'Edit'])
    expect(guide.instruction).toContain('Right-click goes back')
  })

  it('says what a lit tile verb does to which tiles, and how to confirm it', () => {
    const guide = guideFor({
      subject: 'notes',
      operands: ['notes', 'a', 'b'],
      path: ['Edit'],
      lit: { label: 'remove', slot: slot({ onTile: true }) },
      asleep: false,
    })
    expect(guide.crumbs).toEqual(['notes +2', 'Edit', 'remove 3 tiles'])
    expect(guide.litLast).toBe(true)
    expect(guide.instruction).toBe('Release Alt, click or press Enter to run it · Right-click goes back')
  })

  it('names the single tile for a lone operand, and nothing for a surface verb', () => {
    const tile = guideFor({ subject: 'notes', operands: ['notes'], path: [], lit: { label: 'hide', slot: slot({ onTile: true }) }, asleep: false })
    expect(tile.crumbs).toEqual(['notes', 'hide notes'])
    const surface = guideFor({ subject: 'notes', operands: ['notes'], path: [], lit: { label: 'fit', slot: slot() }, asleep: false })
    expect(surface.crumbs).toEqual(['notes', 'fit'])
  })

  it('words each way of confirming', () => {
    const lit = (activation: QuickMenuSlot['activation']) =>
      guideFor({ subject: 'a', operands: ['a'], path: [], lit: { label: 'x', slot: slot({ activation }) }, asleep: false }).instruction
    expect(lit('click')).toContain('Click or press Enter')
    expect(lit('hold')).toContain('Rest here')
    expect(lit('arrive')).toContain('as you arrive')
  })

  it('asks for the middle while the options sleep', () => {
    const guide = guideFor({ subject: 'a', operands: ['a'], path: [], lit: null, asleep: true })
    expect(guide.instruction).toBe('Move to the middle to wake the options')
  })
})
