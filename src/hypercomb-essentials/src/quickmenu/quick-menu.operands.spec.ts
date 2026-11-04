import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MANY_TILES_MENU,
  SELECTION_MENU,
  argsWithOperands,
  bindOperands,
  currentOperands,
  manyCount,
  manyTilesWord,
  menuForOperands,
  operandNote,
  operandsOf,
} from './quick-menu.operands.js'
import { fireQuickMenuSlot } from './quick-menu.fire.js'
import type { QuickMenuSlot } from './quick-menu.types.js'

describe('operandsOf', () => {
  it('acts on the whole selection when the tile is part of it', () => {
    expect(operandsOf('a', ['b', 'a', 'c'])).toEqual(['b', 'a', 'c'])
  })

  it('lets a tile held outside the selection join it, last', () => {
    expect(operandsOf('z', ['a', 'b'])).toEqual(['a', 'b', 'z'])
  })

  it('acts on the tile alone when nothing is selected', () => {
    expect(operandsOf('z', [])).toEqual(['z'])
  })

  it('acts on the selection when the menu has no tile', () => {
    expect(operandsOf(undefined, ['a', 'b'])).toEqual(['a', 'b'])
    expect(operandsOf(null, [])).toEqual([])
  })
})

describe('operandNote', () => {
  it('says nothing for a tile that stands alone', () => {
    expect(operandNote('a', ['a'])).toBe('')
    expect(operandNote('a', [])).toBe('')
  })

  it('counts the other tiles the verbs will reach', () => {
    expect(operandNote('a', ['a', 'b', 'c'])).toBe('+2')
  })

  it('counts the set a tile outside it joins', () => {
    expect(operandNote('z', operandsOf('z', ['a', 'b']))).toBe('+2')
  })
})

describe('which ring an alt hold raises', () => {
  it('the selection ring for one tile, the many-tiles ring for two or more', () => {
    expect(menuForOperands([])).toBe(SELECTION_MENU)
    expect(menuForOperands(['a'])).toBe(SELECTION_MENU)
    expect(menuForOperands(['a', 'b'])).toBe(MANY_TILES_MENU)
    expect(MANY_TILES_MENU).toBe('selection:many')
  })

  it('a tile outside a one-tile selection makes two, so the many ring', () => {
    expect(menuForOperands(operandsOf('z', ['a']))).toBe(MANY_TILES_MENU)
    expect(menuForOperands(operandsOf('a', ['a']))).toBe(SELECTION_MENU)
    expect(menuForOperands(operandsOf('a', []))).toBe(SELECTION_MENU)
  })

  it('the middle stands for the count only from two', () => {
    expect(manyCount(['a'])).toBe(0)
    expect(manyCount(['a', 'b', 'c'])).toBe(3)
  })
})

describe('argsWithOperands', () => {
  it('names the operands for a verb that will not read the selection', () => {
    expect(argsWithOperands('hide', undefined, ['a', 'b'])).toBe('[a, b]')
  })

  it('leaves a verb that reads the selection, and a verb with its own args, alone', () => {
    expect(argsWithOperands('remove', undefined, ['a'])).toBe('')
    expect(argsWithOperands('hide', '~a', ['a'])).toBe('~a')
  })
})

describe('firing a tile verb', () => {
  type Ioc = { get: (key: string) => unknown }
  const original = (globalThis as { ioc?: Ioc }).ioc

  afterEach(() => {
    ;(globalThis as { ioc?: Ioc }).ioc = original
  })

  const install = (selected: string[]) => {
    const replace = vi.fn()
    const execute = vi.fn()
    ;(globalThis as { ioc?: Ioc }).ioc = {
      get: (key: string) => key.endsWith('SelectionService') ? { selected: new Set(selected), replace }
        : key.endsWith('SlashBehaviourDrone') ? { execute }
        : undefined,
    }
    return { replace, execute }
  }

  const remove: QuickMenuSlot = { direction: 'east', label: 'remove', action: { kind: 'command', command: 'remove' }, onTile: true }
  const hide: QuickMenuSlot = { direction: 'east', label: 'hide', action: { kind: 'command', command: 'hide' }, onTile: true }
  const fit: QuickMenuSlot = { direction: 'east', label: 'fit', action: { kind: 'command', command: 'fit' } }
  const comfyEach: QuickMenuSlot = { direction: 'east', label: 'generate', action: { kind: 'command', command: 'comfy', args: 'each' }, onTile: true }

  it('adds the tile to the selection when it was not part of it', () => {
    const { replace, execute } = install(['a', 'b'])
    fireQuickMenuSlot(remove, 'z')
    expect(replace).toHaveBeenCalledWith(['a', 'b', 'z'], 'z')
    expect(execute).toHaveBeenCalledWith('remove', '')
  })

  it('makes the tile the selection when nothing was selected', () => {
    const { replace } = install([])
    fireQuickMenuSlot(remove, 'z')
    expect(replace).toHaveBeenCalledWith(['z'], 'z')
  })

  it('keeps the selection when the tile is in it', () => {
    const { replace } = install(['a', 'b'])
    expect(bindOperands('b')).toEqual(['a', 'b'])
    expect(replace).toHaveBeenCalledWith(['a', 'b'], 'b')
  })

  it('names the tiles for hide, the joining tile among them', () => {
    const { execute } = install(['a', 'b'])
    fireQuickMenuSlot(hide, 'a')
    expect(execute).toHaveBeenCalledWith('hide', '[a, b]')
    fireQuickMenuSlot(hide, 'z')
    expect(execute).toHaveBeenLastCalledWith('hide', '[a, b, z]')
  })

  it('runs a verb with its own args on the bound selection', () => {
    const { replace, execute } = install(['a'])
    fireQuickMenuSlot(comfyEach, 'z')
    expect(replace).toHaveBeenCalledWith(['a', 'z'], 'z')
    expect(execute).toHaveBeenCalledWith('comfy', 'each')
  })

  it('does not touch the selection for a surface verb', () => {
    const { replace, execute } = install(['a'])
    fireQuickMenuSlot(fit, 'z')
    expect(replace).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledWith('fit', '')
  })

  it('reads the live selection for the operands now', () => {
    install(['a'])
    expect(currentOperands('z')).toEqual(['a', 'z'])
    expect(currentOperands()).toEqual(['a'])
  })

  it("names the stack in the catalog's words, or in English without one", () => {
    install([])
    expect(manyTilesWord(3)).toBe('3 tiles')
    ;(globalThis as { ioc?: Ioc }).ioc = {
      get: (key: string) => key.endsWith('/I18n')
        ? { t: (k: string, p?: { count?: number }) => (k === 'quickmenu.many-tiles' ? `タイル ${p?.count} 枚` : k) }
        : undefined,
    }
    expect(manyTilesWord(4)).toBe('タイル 4 枚')
    ;(globalThis as { ioc?: Ioc }).ioc = { get: (key: string) => key.endsWith('/I18n') ? { t: (k: string) => k } : undefined }
    expect(manyTilesWord(2)).toBe('2 tiles')
  })
})
