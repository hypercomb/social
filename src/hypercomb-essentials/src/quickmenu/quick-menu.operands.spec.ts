import { afterEach, describe, expect, it, vi } from 'vitest'
import { argsWithOperands, bindOperands, operandNote, operandsOf } from './quick-menu.operands.js'
import { fireQuickMenuSlot } from './quick-menu.fire.js'
import type { QuickMenuSlot } from './quick-menu.types.js'

describe('operandsOf', () => {
  it('acts on the whole selection when the tile is part of it', () => {
    expect(operandsOf('a', ['b', 'a', 'c'])).toEqual(['b', 'a', 'c'])
  })

  it('acts on the tile alone when it is not in the selection', () => {
    expect(operandsOf('z', ['a', 'b'])).toEqual(['z'])
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

  it('makes the tile the selection when it was not part of it', () => {
    const { replace, execute } = install(['a', 'b'])
    fireQuickMenuSlot(remove, 'z')
    expect(replace).toHaveBeenCalledWith(['z'], 'z')
    expect(execute).toHaveBeenCalledWith('remove', '')
  })

  it('keeps the selection when the tile is in it', () => {
    const { replace } = install(['a', 'b'])
    expect(bindOperands('b')).toEqual(['a', 'b'])
    expect(replace).toHaveBeenCalledWith(['a', 'b'], 'b')
  })

  it('names the tiles for hide', () => {
    const { execute } = install(['a', 'b'])
    fireQuickMenuSlot(hide, 'a')
    expect(execute).toHaveBeenCalledWith('hide', '[a, b]')
  })

  it('does not touch the selection for a surface verb', () => {
    const { replace, execute } = install(['a'])
    fireQuickMenuSlot(fit, 'z')
    expect(replace).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledWith('fit', '')
  })
})
