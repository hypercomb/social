// quick-menu.traits.spec.ts — a tile's own version of the flower.

import { describe, expect, it, vi } from 'vitest'

vi.mock('../commands/decoration-manifest.js', () => ({ listDecorations: async () => [] }))
vi.mock('../commands/trait-read.js', () => ({ childNamesAt: async () => [], resolveTraitsAt: async () => [] }))

import { NO_SEATS, applyTileSeats, parseTriggerArgs, seatMenu } from './quick-menu.traits.js'
import type { QuickMenuDefinition } from './quick-menu.types.js'

const menu: QuickMenuDefinition = {
  name: 'selection:edit',
  title: 'Edit',
  contexts: [],
  slots: [
    { direction: 'east', label: 'copy', action: { kind: 'effect', effect: 'keymap:invoke' } },
    { direction: 'west', label: 'hide', action: { kind: 'command', command: 'hide' } },
    { direction: 'northeast', label: 'share', action: { kind: 'menu', menu: 'selection:share' } },
  ],
}

describe('a tile with nothing of its own', () => {
  it('gets the shipped flower, the same object', () => {
    expect(applyTileSeats(menu, NO_SEATS)).toBe(menu)
  })
})

describe('a seat filled on the tile', () => {
  it('a child named the word keeps the seat working as it was', () => {
    const out = applyTileSeats(menu, { fills: [{ word: 'copy', runs: 'copy', children: [] }], triggers: [] })
    expect(out.slots[0].action).toEqual(menu.slots[0].action)
  })

  it('a swap runs the word of the tile that fills it', () => {
    const out = applyTileSeats(menu, { fills: [{ word: 'copy', runs: 'clone', children: [] }], triggers: [] })
    expect(out.slots[0].action).toEqual({ kind: 'command', command: 'clone' })
  })

  it('a child with children opens a flower of them', () => {
    const seats = { fills: [{ word: 'hide', runs: 'hide', children: ['fade', 'blur'] }], triggers: [] }
    const out = applyTileSeats(menu, seats)
    expect(out.slots[1].action.kind).toBe('menu')
    const action = out.slots[1].action
    const opened = action.kind === 'menu' ? seatMenu(action.menu, seats, 'east') : undefined
    expect(opened?.slots.map(s => s.label)).toEqual(['fade', 'blur'])
    expect(opened?.slots.some(s => s.direction === 'east')).toBe(false)
    expect(opened?.slots[0].action).toEqual({ kind: 'command', command: 'fade' })
  })

  it('never hands the way back to a child, and shows what fits', () => {
    const children = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    const opened = seatMenu('tile-seat:hide', { fills: [{ word: 'hide', runs: 'hide', children }], triggers: [] }, 'west')
    expect(opened?.slots).toHaveLength(5)
    expect(opened?.slots.some(s => s.direction === 'west')).toBe(false)
  })

  it('a menu that is not a seat is not answered here', () => {
    expect(seatMenu('selection:share', NO_SEATS, 'east')).toBeUndefined()
  })
})

describe('a trigger on a seat', () => {
  it('maps rollover, hold and click onto the leaf', () => {
    for (const [trigger, activation] of [['rollover', 'arrive'], ['hold', 'hold'], ['click', 'click']] as const) {
      const out = applyTileSeats(menu, { fills: [], triggers: [{ word: 'hide', trigger }] })
      expect(out.slots[1].activation).toBe(activation)
    }
  })

  it('stays on the seat when its automaton is swapped', () => {
    const out = applyTileSeats(menu, {
      fills: [{ word: 'hide', runs: 'fade', children: [] }],
      triggers: [{ word: 'hide', trigger: 'hold' }],
    })
    expect(out.slots[1]).toMatchObject({ action: { kind: 'command', command: 'fade' }, activation: 'hold' })
  })

  it('does nothing to a pathway', () => {
    const out = applyTileSeats(menu, { fills: [], triggers: [{ word: 'share', trigger: 'rollover' }] })
    expect(out.slots[2].activation).toBeUndefined()
  })
})

describe('menu trigger', () => {
  it('lists, sets and clears', () => {
    expect(parseTriggerArgs('')).toEqual({ verb: 'list' })
    expect(parseTriggerArgs('copy hold')).toEqual({ verb: 'set', word: 'copy', trigger: 'hold' })
    expect(parseTriggerArgs('copy release')).toEqual({ verb: 'set', word: 'copy', trigger: 'release' })
  })

  it('refuses what it cannot read', () => {
    expect(parseTriggerArgs('copy')).toEqual({ error: 'unknown' })
    expect(parseTriggerArgs('copy soon')).toEqual({ error: 'unknown' })
  })
})
