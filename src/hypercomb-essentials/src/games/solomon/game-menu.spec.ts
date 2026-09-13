// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MENU, GameMenu, menuRows, type MenuOption } from './game-menu.js'

const focusedName = (): string | undefined => (document.activeElement as HTMLElement | null)?.dataset['name']

describe('the locked hive the menu is laid out on', () => {
  it('stacks honeycomb rows that differ by one, so each row sits half a tile over', () => {
    expect(menuRows(8)).toEqual([3, 2, 3])
    expect(menuRows(7)).toEqual([2, 3, 2])
    expect(menuRows(5)).toEqual([3, 2])
    expect(menuRows(4)).toEqual([1, 2, 1])
    expect(menuRows(1)).toEqual([1])
    expect(menuRows(0)).toEqual([])
    for (const count of [1, 2, 3, 4, 5, 6, 7, 8, 9, 12]) expect(menuRows(count).reduce((sum, row) => sum + row, 0)).toBe(count)
  })
})

describe('the game menu', () => {
  afterEach(() => { document.body.replaceChildren() })

  it('draws one hexagon tile per option, in order, and reports the one chosen', () => {
    const choose = vi.fn()
    const menu = new GameMenu(document.body, { choose })
    expect(menu.isOpen).toBe(false)
    menu.open()
    const tiles = [...document.querySelectorAll<HTMLButtonElement>('.sol-menu-tile')]
    expect(tiles.map(tile => tile.dataset['name'])).toEqual(DEFAULT_MENU.map(option => option.name))
    expect(document.querySelectorAll('.sol-menu-row')).toHaveLength(3)
    tiles[1]!.click()
    expect(choose).toHaveBeenCalledWith(DEFAULT_MENU[1])
  })

  it('shows a tile that names no action, locked and inert', () => {
    const choose = vi.fn()
    const options: MenuOption[] = [{ name: 'Continue', action: 'continue' }, { name: 'Postcard', action: null }]
    const menu = new GameMenu(document.body, { choose })
    menu.setOptions(options)
    menu.open()
    const postcard = document.querySelector<HTMLButtonElement>('.sol-menu-tile[data-name="Postcard"]')!
    expect(postcard.disabled).toBe(true)
    postcard.click()
    expect(choose).not.toHaveBeenCalled()
  })

  it('moves between tiles with the arrow keys, chooses with Enter, and Escape puts it away', () => {
    const choose = vi.fn()
    const menu = new GameMenu(document.body, { choose })
    menu.open()
    expect(focusedName()).toBe('Continue')
    menu.key('arrowright')
    expect(focusedName()).toBe('Items')
    menu.key('arrowdown')
    expect(['Island', 'Saves']).toContain(focusedName())
    menu.key('enter')
    expect(choose).toHaveBeenCalledTimes(1)
    menu.key('escape')
    expect(menu.isOpen).toBe(false)
  })

  it('comes back out on a left click in the space around the tiles, never on a tile', () => {
    const choose = vi.fn(), back = vi.fn()
    const menu = new GameMenu(document.body, { choose })
    menu.open()
    document.querySelector<HTMLButtonElement>('.sol-menu-tile')!.click()
    expect(choose).toHaveBeenCalledTimes(1)
    expect(menu.isOpen).toBe(true)
    document.querySelector<HTMLElement>('.sol-menu-hive')!.click()
    expect(menu.isOpen).toBe(false)
    const routed = new GameMenu(document.body, { choose, back })
    routed.open()
    routed.element.click()
    expect(back).toHaveBeenCalledTimes(1)
    expect(routed.isOpen).toBe(true)
  })

  it('writes each option’s detail under its name', () => {
    const menu = new GameMenu(document.body, { choose: () => {}, detail: option => option.action === 'sound' ? 'on' : '' })
    menu.open()
    expect(document.querySelector('.sol-menu-tile[data-name="Sound"] .sol-menu-tile-detail')?.textContent).toBe('on')
  })
})
