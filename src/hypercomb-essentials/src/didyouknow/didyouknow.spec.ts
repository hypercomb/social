// didyouknow/didyouknow.spec.ts — the pure half of Did You Know.

import { describe, expect, it } from 'vitest'
import {
  ENABLED_KIND, GAME_NAME, IDEA_MAX, REVEAL_LINE_MAX, REVEAL_MARK,
  bringers, cleanIdea, concealsAuthors, isGame, isRevealNote, isRevealed, parseToggle, revealText, routeOf,
  type Idea,
} from './didyouknow.js'

describe('the game is a tile read by name', () => {
  it('folds the way every tile name folds', () => {
    expect(isGame(GAME_NAME)).toBe(true)
    expect(isGame('Did You Know')).toBe(true)
    expect(isGame('did-you-know')).toBe(true)
    expect(isGame('did you know more')).toBe(false)
    expect(isGame('')).toBe(false)
  })
})

describe('the toggle — the word alone, or on / off / everywhere, else an idea', () => {
  it('the word alone flips the game for this layer and beneath', () => {
    expect(parseToggle('')).toBe('flip')
    expect(parseToggle('   ')).toBe('flip')
    expect(parseToggle(undefined)).toBe('flip')
  })

  it('reads the three toggle words, however they are cased or spaced', () => {
    expect(parseToggle('on')).toBe('on')
    expect(parseToggle(' OFF ')).toBe('off')
    expect(parseToggle('Everywhere')).toBe('everywhere')
  })

  it('anything longer than a toggle word is an idea, even one that starts with one', () => {
    expect(parseToggle('on Mars a day is longer than its year')).toBeNull()
    expect(parseToggle('off the coast of Peru the sea glows')).toBeNull()
    expect(parseToggle('everywhere you look there is a Fibonacci spiral')).toBeNull()
    expect(parseToggle('octopuses have three hearts')).toBeNull()
  })

  it('names a layer as a route, the root as /', () => {
    expect(routeOf([])).toBe('/')
    expect(routeOf(['lecture', 'biology'])).toBe('/lecture/biology')
    expect(routeOf([' lecture ', ''])).toBe('/lecture')
  })

  it('the mark is a visual kind a layer wears, like the other container behaviours', () => {
    expect(ENABLED_KIND).toBe('visual:didyouknow:enabled')
  })
})

describe('the concealment rule — words, not who, until the reveal', () => {
  it('conceals on the game tile while no reveal note is among its notes', () => {
    expect(concealsAuthors('did you know', [])).toBe(true)
    expect(concealsAuthors('did-you-know', ['octopuses have three hearts', 'honey keeps'])).toBe(true)
  })

  it('stops concealing the moment a reveal note is among them, from anyone', () => {
    const reveal = revealText([{ id: 'a', text: 'honey keeps', by: 'k1' }], () => 'Ana')
    expect(isRevealed(['x', reveal])).toBe(true)
    expect(concealsAuthors('did you know', ['x', reveal])).toBe(false)
  })

  it('never conceals anywhere else — a note on another tile keeps its author', () => {
    expect(concealsAuthors('lecture', ['anything'])).toBe(false)
    expect(concealsAuthors('', [])).toBe(false)
  })

  it('a note that merely mentions the mark is not a reveal', () => {
    expect(isRevealNote(`  ${REVEAL_MARK} 2 ideas`)).toBe(true)
    expect(isRevealNote(`they said ${REVEAL_MARK} 2 ideas`)).toBe(false)
    expect(isRevealNote(undefined)).toBe(false)
  })
})

describe('an idea as typed', () => {
  it('gathers whitespace into single spaces and trims', () => {
    expect(cleanIdea('  octopuses \n have\t three   hearts ')).toBe('octopuses have three hearts')
    expect(cleanIdea(null)).toBe('')
  })

  it('has a length the room can read aloud', () => {
    expect(IDEA_MAX).toBeGreaterThan(200)
  })
})

describe('the reveal note', () => {
  const ideas: Idea[] = [
    { id: 'a', text: 'octopuses have three hearts', by: 'k1' },
    { id: 'b', text: 'honey never spoils', by: 'k2' },
    { id: 'c', text: 'a day on Venus is longer than its year', by: 'k1' },
  ]
  const labelOf = (pk: string): string => ({ k1: 'Ana', k2: 'Ben' } as Record<string, string>)[pk] ?? pk

  it('lists every idea in the order given, each with its name', () => {
    expect(revealText(ideas, labelOf)).toBe([
      `${REVEAL_MARK} 3 ideas`,
      '1. octopuses have three hearts — Ana',
      '2. honey never spoils — Ben',
      '3. a day on Venus is longer than its year — Ana',
    ].join('\n'))
  })

  it('says idea, not ideas, for one', () => {
    expect(revealText([ideas[0]], labelOf).split('\n')[0]).toBe(`${REVEAL_MARK} 1 idea`)
  })

  it('keeps a long idea to one line of readable length', () => {
    const long = 'word '.repeat(200)
    const line = revealText([{ id: 'x', text: long, by: 'k1' }], labelOf).split('\n')[1]
    expect(line.startsWith('1. ')).toBe(true)
    expect(line).toContain('… — Ana')
    expect(line.length).toBeLessThan(REVEAL_LINE_MAX + 20)
  })

  it('counts the people who brought them', () => {
    expect(bringers(ideas)).toBe(2)
    expect(bringers([])).toBe(0)
  })

  it('is itself recognised as the reveal, so it never counts as an idea', () => {
    expect(isRevealNote(revealText(ideas, labelOf))).toBe(true)
  })
})
