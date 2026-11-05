import { afterEach, describe, expect, it } from 'vitest'
import { doesFor, runsAs, tilesWord } from './quick-menu.does.js'
import { MANY_TILES_MENU, SELECTION_MENU } from './quick-menu.operands.js'
import { applyTileSeats } from './quick-menu.traits.js'
import { slotsByDirection, type QuickMenuSlot } from './quick-menu.types.js'
import { QuickMenuRegistry } from './quick-menu-registry.service.js'

const command = (word: string, extra: Partial<QuickMenuSlot> = {}, args?: string): QuickMenuSlot =>
  ({ direction: 'east', label: word, action: { kind: 'command', command: word, ...(args ? { args } : {}) }, ...extra })

describe('runsAs', () => {
  it('files a slot under what it runs, and a pathway under nothing', () => {
    expect(runsAs({ kind: 'command', command: 'fit' })).toBe('fit')
    expect(runsAs({ kind: 'command', command: 'comfy', args: 'each' })).toBe('comfy.each')
    expect(runsAs({ kind: 'effect', effect: 'shelf:take-selection' })).toBe('shelf.take-selection')
    expect(runsAs({ kind: 'key', key: 'ArrowRight' })).toBe('key.ArrowRight')
    expect(runsAs({ kind: 'menu', menu: 'root:view' })).toBeUndefined()
  })
})

describe('tilesWord', () => {
  it('quotes one tile and counts several', () => {
    expect(tilesWord('notes', ['notes'])).toBe('“notes”')
    expect(tilesWord('notes', ['notes', 'a', 'b'])).toBe('3 tiles')
  })

  it('keeps to the tile alone when the verb is the badge\'s own', () => {
    expect(tilesWord('notes', ['notes', 'a', 'b'], true)).toBe('“notes”')
  })
})

describe('doesFor', () => {
  it('names the tile a tile verb will reach', () => {
    const slot = command('hide', { onTile: true })
    expect(doesFor({ slot, label: 'hide', subject: 'notes', operands: ['notes'] })).toBe('Hide “notes” from view here; nothing is deleted')
  })

  it('counts the tiles when the verb reaches a set, with the wording made for a set', () => {
    const remove = command('remove', { onTile: true })
    expect(doesFor({ slot: remove, label: 'remove', subject: 'notes', operands: ['notes', 'a', 'b'] })).toBe('Remove 3 tiles from this layer')
    const images = command('images', { onTile: true })
    expect(doesFor({ slot: images, label: 'images', subject: 'notes', operands: ['notes'] })).toBe('Choose a picture for “notes”')
    expect(doesFor({ slot: images, label: 'images', subject: 'notes', operands: ['notes', 'a'] })).toBe('Choose a picture for each of 2 tiles, one tile at a time')
  })

  it('reads a verb by its arguments, not only its word', () => {
    const generate = command('comfy', { onTile: true }, 'each')
    expect(doesFor({ slot: generate, label: 'generate', subject: 'notes', operands: ['notes'] })).toBe('Generate a picture for “notes” from its name')
  })

  it('describes the verb, not the label: a renamed option is still understood', () => {
    const slot = command('remove', { onTile: true, label: 'bin' })
    expect(doesFor({ slot, label: 'bin', subject: 'notes', operands: ['notes'] })).toBe('Remove “notes” from this layer')
  })

  it('leaves the tile out of a verb about the surface', () => {
    expect(doesFor({ slot: command('fit'), label: 'fit', subject: 'notes', operands: ['notes'] })).toBe('Zoom to fit everything on screen')
  })

  it('says whether picking adds the tile or lifts it', () => {
    const select: QuickMenuSlot = { direction: 'northeast', label: 'select', action: { kind: 'effect', effect: 'select:toggle', payload: {} } }
    expect(doesFor({ slot: select, label: 'select', subject: 'notes', operands: ['notes'] })).toBe('Pick “notes” so the verbs reach it too')
    expect(doesFor({ slot: select, label: 'select', subject: 'notes', operands: ['notes', 'a'], picked: true })).toBe('Take “notes” out of the picked tiles')
  })

  it('keeps the badge\'s verbs to its own tile, whatever else is picked', () => {
    const slot = command('hide', { onTile: true, alone: true })
    expect(doesFor({ slot, label: 'hide', subject: 'notes', operands: ['notes', 'a', 'b'] })).toBe('Hide “notes” from view here; nothing is deleted')
  })

  it('says a word it does not know plainly, on the tile when it acts on one', () => {
    expect(doesFor({ slot: command('copy', { onTile: true }), label: 'copy', subject: 'notes', operands: ['notes'] })).toBe('Run copy on “notes”')
    expect(doesFor({ slot: command('copy'), label: 'copy', subject: 'notes', operands: ['notes'] })).toBe('Run copy')
  })

  it('says nothing of a pathway, which only moves the flower', () => {
    const pathway: QuickMenuSlot = { direction: 'east', label: 'view', action: { kind: 'menu', menu: 'root:view' } }
    expect(doesFor({ slot: pathway, label: 'view', subject: 'notes', operands: ['notes'] })).toBe('')
  })

  it('describes a tile\'s own automaton by the word it swaps in', () => {
    const remove = command('remove', { onTile: true })
    const mine = applyTileSeats(
      { name: 'x', title: 'x', contexts: [], slots: [remove] },
      { fills: [{ word: 'remove', runs: 'clone', children: [] }], triggers: [] },
    ).slots[0]
    expect(doesFor({ slot: mine, label: 'remove', subject: 'notes', operands: ['notes'] })).toBe('Run clone on “notes”')
  })
})

describe('every shipped option', () => {
  afterEach(() => { delete (globalThis as { ioc?: unknown }).ioc })

  it('is described, so none falls back to a bare Run', () => {
    const registry = new QuickMenuRegistry()
    const bare: string[] = []
    for (const definition of registry.all()) {
      for (const slot of slotsByDirection(definition).values()) {
        if (slot.action.kind === 'menu') continue
        const said = doesFor({ slot, label: slot.label, subject: 'notes', operands: ['notes'] })
        const word = slot.action.kind === 'command' ? slot.action.command : slot.label
        if (!said || said === `Run ${word}` || said === `Run ${word} on “notes”`) bare.push(`${definition.name}/${slot.label}`)
      }
    }
    expect(bare).toEqual([])
  })

  it('names the set in the ring made for a set', () => {
    const registry = new QuickMenuRegistry()
    const many = registry.byName(MANY_TILES_MENU)!
    for (const slot of many.slots) {
      expect(doesFor({ slot, label: slot.label, subject: 'notes', operands: ['notes', 'a', 'b'] })).toContain('3 tiles')
    }
    expect(registry.byName(SELECTION_MENU)).toBeDefined()
  })
})
