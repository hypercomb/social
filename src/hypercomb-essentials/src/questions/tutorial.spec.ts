// questions/tutorial.spec.ts — what `start tutorial` lays out and plays.

import { describe, expect, it } from 'vitest'
import { isReservedPoolWord } from '@hypercomb/core'
import { TUTORIAL, TUTORIAL_NAME, tutorialStops, tutorialTiles } from './tutorial.js'

describe('the tutorial', () => {
  it('plays its own page, then each chapter, from where it was started', () => {
    expect(tutorialStops(['meeting'])).toEqual([
      ['meeting', TUTORIAL_NAME],
      ['meeting', TUTORIAL_NAME, 'following'],
      ['meeting', TUTORIAL_NAME, 'basics'],
      ['meeting', TUTORIAL_NAME, 'idea'],
      ['meeting', TUTORIAL_NAME, 'playing'],
    ])
  })

  it('lays out parents before children, every tile with a title', () => {
    const tiles = tutorialTiles([])
    expect(tiles[0]).toEqual({ page: [], name: TUTORIAL_NAME, title: TUTORIAL[1] })
    const seen = new Set<string>()
    for (const t of tiles) {
      expect(t.title.trim()).not.toBe('')
      if (t.page.length) expect(seen.has(t.page.join('/'))).toBe(true)
      seen.add([...t.page, t.name].join('/'))
    }
  })

  it('names every tile once, plainly, and never with a reserved word', () => {
    const names = tutorialTiles([]).map(t => t.name)
    expect(new Set(names).size).toBe(names.length)
    for (const n of names) {
      expect(n).toMatch(/^[a-z]+(-[a-z]+)*$/)
      expect(isReservedPoolWord(n)).toBe(false)
    }
  })

  it('never reads as a question inside the game (a title ending in ? would be marked one)', () => {
    for (const t of tutorialTiles([])) expect(t.title.trim().endsWith('?')).toBe(false)
  })
})
