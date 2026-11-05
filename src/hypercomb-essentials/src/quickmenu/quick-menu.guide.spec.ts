import { describe, expect, it } from 'vitest'
import { QuickMenuGuide, guideFor } from './quick-menu.guide.js'
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
    expect(guide.crumbs).toEqual(['notes +2', 'Edit', 'remove'])
    expect(guide.does).toBe('Remove 3 tiles from this layer')
    expect(guide.litLast).toBe(true)
    expect(guide.instruction).toBe('Release Alt, click or press Enter to run it · Right-click goes back')
  })

  it('names the single tile for a lone operand, and nothing for a surface verb', () => {
    const hide = { direction: 'east', label: 'hide', action: { kind: 'command', command: 'hide' }, onTile: true } as const
    const tile = guideFor({ subject: 'notes', operands: ['notes'], path: [], lit: { label: 'hide', slot: hide }, asleep: false })
    expect(tile.crumbs).toEqual(['notes', 'hide'])
    expect(tile.does).toBe('Hide “notes” from view here; nothing is deleted')
    const fit = { direction: 'east', label: 'fit', action: { kind: 'command', command: 'fit' } } as const
    const surface = guideFor({ subject: 'notes', operands: ['notes'], path: [], lit: { label: 'fit', slot: fit }, asleep: false })
    expect(surface.crumbs).toEqual(['notes', 'fit'])
    expect(surface.does).toBe('Zoom to fit everything on screen')
  })

  it('says nothing of what it does until an option is lit, or while the options sleep', () => {
    expect(guideFor({ subject: 'a', operands: ['a'], path: [], lit: null, asleep: false }).does).toBe('')
    expect(guideFor({ subject: 'a', operands: ['a'], path: [], lit: null, asleep: true }).does).toBe('')
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

describe('QuickMenuGuide', () => {
  const area = { left: 0, top: 0, right: 800 }

  it('shows the sentence between the crumbs and the instruction, and hides it when nothing is lit', () => {
    const strip = new QuickMenuGuide()
    const hide = { direction: 'east', label: 'hide', action: { kind: 'command', command: 'hide' }, onTile: true } as const

    strip.show(guideFor({ subject: 'notes', operands: ['notes'], path: [], lit: { label: 'hide', slot: hide }, asleep: false }), area)
    const root = document.body.lastElementChild as HTMLElement
    const [crumbs, does, instruction] = [...root.children] as HTMLElement[]
    expect(crumbs.textContent).toBe('notes › hide')
    expect(does.textContent).toBe('Hide “notes” from view here; nothing is deleted')
    expect(does.style.display).toBe('block')
    expect(instruction.textContent).toContain('Release Alt')

    strip.show(guideFor({ subject: 'notes', operands: ['notes'], path: [], lit: null, asleep: false }), area)
    expect(does.textContent).toBe('')
    expect(does.style.display).toBe('none')

    strip.hide()
  })
})
