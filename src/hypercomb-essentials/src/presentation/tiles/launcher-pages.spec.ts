import { describe, expect, it } from 'vitest'
import {
  gridFor, launcherGroupScreens, pageAfter, pagesOf, perScreen, plateHue, plateLetter, swipeStep,
} from './launcher-pages.js'

describe('launcher screens', () => {
  it('turns between launcher pages only when this place is one of them', () => {
    const groups = [
      { id: 'games' },
      { id: 'websites' },
      { id: 'direct', openDirectly: true },
      { id: 'help' },
    ]
    expect(launcherGroupScreens(groups, ['games'])).toEqual({ ids: ['games', 'websites', 'help'], index: 0 })
    expect(launcherGroupScreens(groups, ['help'])?.index).toBe(2)
    expect(launcherGroupScreens(groups, ['direct'])).toBeNull()
    expect(launcherGroupScreens(groups, ['games', 'arkanoid'])).toBeNull()
    expect(launcherGroupScreens(groups, ['notes'])).toBeNull()
    expect(launcherGroupScreens([{ id: 'games' }], ['games'])).toBeNull()
  })

  it('fills a phone with four icon columns and fewer, larger square plates', () => {
    expect(gridFor('icons', 390, 844)).toEqual({ cols: 4, rows: 6 })
    expect(perScreen('icons', 390, 844)).toBe(24)
    expect(gridFor('square', 390, 844)).toEqual({ cols: 2, rows: 3 })
    expect(perScreen('square', 390, 844)).toBe(6)
    expect(gridFor('icons', 1280, 800).cols).toBe(6)
  })

  it('pages the tiles and holds at the ends', () => {
    expect(pagesOf([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(pagesOf([], 4)).toEqual([])
    expect(pageAfter(0, 3, -1)).toBe(0)
    expect(pageAfter(2, 3, 1)).toBe(2)
    expect(pageAfter(1, 3, 1)).toBe(2)
    expect(pageAfter(5, 3, 0)).toBe(2)
  })

  it('reads a sideways swipe, and a vertical drag as a scroll', () => {
    expect(swipeStep(-80, 10)).toBe(1)
    expect(swipeStep(80, 10)).toBe(-1)
    expect(swipeStep(-20, 0)).toBe(0)
    expect(swipeStep(-40, 80)).toBe(0)
  })

  it('names an empty plate with one letter and a stable hue', () => {
    expect(plateLetter('  games')).toBe('G')
    expect(plateLetter('')).toBe('')
    expect(plateLetter('橋')).toBe('橋')
    expect(plateHue('games')).toBe(plateHue('games'))
    expect(plateHue('games')).not.toBe(plateHue('help'))
  })
})
