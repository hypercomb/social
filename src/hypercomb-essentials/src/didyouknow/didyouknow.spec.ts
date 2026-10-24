// didyouknow/didyouknow.spec.ts — the pure half of Did You Know.

import { describe, expect, it } from 'vitest'
import { normalizeCell } from '@hypercomb/core'
import {
  ENABLED_KIND, GAME_NAME, IDEA_MAX, REVEAL_LINE_MAX, REVEAL_MARK, TILE_NAME_MAX,
  bringers, cleanIdea, concealsAuthors, gameTileName, isGameTile, isRevealNote, isRevealed, parseToggle, revealText, routeOf,
  type Idea,
} from './didyouknow.js'

describe('the game is a tile named for its layer', () => {
  it('the root layer\'s tile is the hive\'s spelling of the game', () => {
    expect(gameTileName([])).toBe('did-you-know')
    expect(gameTileName([' ', ''])).toBe('did-you-know')
    expect(GAME_NAME).toBe('did you know')
  })

  it('a deeper layer\'s tile is the game and the layer\'s path, each segment spelled the hive\'s way', () => {
    expect(gameTileName(['lecture'])).toBe('did-you-know-lecture')
    expect(gameTileName(['lecture', 'biology'])).toBe('did-you-know-lecture-biology')
    expect(gameTileName(['Big Ideas', 'Cell Biology'])).toBe('did-you-know-big-ideas-cell-biology')
  })

  it('every layer is its own word: two layers never share a name', () => {
    const layers = [[], ['lecture'], ['other'], ['lecture', 'biology'], ['other', 'biology'], ['biology']]
    const names = layers.map(gameTileName)
    expect(new Set(names).size).toBe(layers.length)
  })

  it('everyone on one page works out the same name, however the path was spelled', () => {
    expect(gameTileName(['Lecture', 'Biology'])).toBe(gameTileName(['lecture', 'biology']))
    expect(gameTileName(['big ideas'])).toBe(gameTileName(['Big-Ideas']))
  })

  it('a path too long for a tile\'s name is cut and closed with a short hash of the whole path', () => {
    const deep = ['a-very-long-layer-name-for-a-lecture', 'with-another-long-segment-below-it', 'and-a-third-one']
    const name = gameTileName(deep)
    expect(name.length).toBeLessThanOrEqual(TILE_NAME_MAX)
    expect(name.startsWith('did-you-know-a-very-long-layer-name')).toBe(true)
    expect(name).toMatch(/-[0-9a-f]{8}$/)
    // stable, and a different deep path is a different word even when the cut text is the same
    expect(gameTileName(deep)).toBe(name)
    const sibling = ['a-very-long-layer-name-for-a-lecture', 'with-another-long-segment-below-it', 'and-a-fourth-one']
    expect(gameTileName(sibling)).not.toBe(name)
    expect(gameTileName(sibling).length).toBeLessThanOrEqual(TILE_NAME_MAX)
  })

  it('a segment made only of symbols still tells its layer apart', () => {
    expect(gameTileName(['\u2728'])).not.toBe(gameTileName(['\u2603']))
    expect(gameTileName(['\u2728'])).not.toBe('did-you-know')
    expect(gameTileName(['\u2728'])).toMatch(/^did-you-know-x[0-9a-f]{8}$/)
  })

  it('spells a segment the way the lineage names a layer: punctuation folds to a hyphen, never vanishes', () => {
    // R&D and RD are two layers; so are Q&A and QA
    expect(gameTileName(['R&D'])).toBe('did-you-know-r-d')
    expect(gameTileName(['RD'])).toBe('did-you-know-rd')
    expect(gameTileName(['Q&A'])).not.toBe(gameTileName(['QA']))
    // one layer reached under two spellings is one name
    expect(gameTileName(['it\'s'])).toBe(gameTileName(['it-s']))
    expect(gameTileName(['Q A'])).toBe(gameTileName(['Q&A']))
  })

  it('spells a letter the same on every device: composed or decomposed, whatever the locale', () => {
    expect(gameTileName(['cafe\u0301'])).toBe(gameTileName(['caf\u00e9']))
    expect(gameTileName(['caf\u00e9'])).toBe('did-you-know-caf\u00e9')
    // a Turkish-locale lower-case would spell a capital I as a dotless one
    expect(gameTileName(['Iowa'])).toBe('did-you-know-iowa')
    expect(gameTileName(['Istanbul'])).toBe('did-you-know-istanbul')
  })

  it('keeps a name of exactly 64 characters whole and hashes one character more', () => {
    const base = 'did-you-know-'
    const sixtyFour = 'a'.repeat(TILE_NAME_MAX - base.length)
    expect(gameTileName([sixtyFour])).toBe(`${base}${sixtyFour}`)
    expect(gameTileName([sixtyFour])).toHaveLength(TILE_NAME_MAX)
    const sixtyFive = gameTileName([`${sixtyFour}a`])
    expect(sixtyFive).toHaveLength(TILE_NAME_MAX)
    expect(sixtyFive).toMatch(/^did-you-know-a+-[0-9a-f]{8}$/)
    expect(sixtyFive).not.toBe(gameTileName([sixtyFour]))
  })

  it('never cuts a letter in half: a name with astral letters at the cut stays a valid name', () => {
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
    for (let before = 1; before <= 6; before++) {
      const name = gameTileName(['a'.repeat(before) + '\u{1D4D0}'.repeat(40)])
      expect(name.length).toBeLessThanOrEqual(TILE_NAME_MAX)
      expect(name).not.toMatch(lone)
      expect(normalizeCell(name)).toBe(name)
    }
  })

  it('is always a name the tile-making word would keep as it is', () => {
    const paths = [[], ['lecture'], ['Big Ideas', 'Cell Biology'], ['R&D', 'Q&A'], ['\u2728'], ['caf\u00e9'], ['x'.repeat(80)], ['a', 'b'.repeat(70)]]
    for (const path of paths) {
      const name = gameTileName(path)
      expect(normalizeCell(name)).toBe(name)
      expect(isGameTile(name, path)).toBe(true)
    }
  })
})

describe('the game\'s tile is read by name, on its own layer only', () => {
  it('folds the way every tile name folds', () => {
    expect(isGameTile('did-you-know', [])).toBe(true)
    expect(isGameTile('Did You Know', [])).toBe(true)
    expect(isGameTile('Did-You-Know-Lecture', ['lecture'])).toBe(true)
    expect(isGameTile('did you know lecture', ['lecture'])).toBe(true)
  })

  it('is the game on the layer it is named for and on no other', () => {
    expect(isGameTile('did-you-know', ['lecture'])).toBe(false)
    expect(isGameTile('did-you-know-lecture', [])).toBe(false)
    expect(isGameTile('did-you-know-lecture', ['other'])).toBe(false)
    expect(isGameTile('did-you-know-lecture', ['lecture', 'biology'])).toBe(false)
    expect(isGameTile('did-you-know-lecture-biology', ['lecture', 'biology'])).toBe(true)
  })

  it('a tile of yours that merely starts like the game is not the game', () => {
    expect(isGameTile('did you know more', [])).toBe(false)
    expect(isGameTile('did-you-know-about-cats', [])).toBe(false)
    expect(isGameTile('', [])).toBe(false)
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
  it('conceals on the layer\'s game tile while no reveal note is among its notes', () => {
    expect(concealsAuthors('did you know', [], [])).toBe(true)
    expect(concealsAuthors('did-you-know', ['octopuses have three hearts', 'honey keeps'], [])).toBe(true)
    expect(concealsAuthors('did-you-know-lecture', ['honey keeps'], ['lecture'])).toBe(true)
  })

  it('stops concealing the moment a reveal note is among them, from anyone', () => {
    const reveal = revealText([{ id: 'a', text: 'honey keeps', by: 'k1' }], () => 'Ana')
    expect(isRevealed(['x', reveal])).toBe(true)
    expect(concealsAuthors('did you know', ['x', reveal], [])).toBe(false)
  })

  it('never conceals anywhere else — a note on another tile keeps its author', () => {
    expect(concealsAuthors('lecture', ['anything'], [])).toBe(false)
    expect(concealsAuthors('', [], [])).toBe(false)
  })

  it('a reveal on one layer reveals nothing on another: each layer is its own word', () => {
    const reveal = revealText([{ id: 'a', text: 'honey keeps', by: 'k1' }], () => 'Ana')
    // the root's game is revealed; the lecture's game, with its own notes, still conceals
    expect(concealsAuthors('did-you-know', ['x', reveal], [])).toBe(false)
    expect(concealsAuthors('did-you-know-lecture', ['x'], ['lecture'])).toBe(true)
  })

  it('the root\'s tile is not the game on another layer, and another layer\'s tile is not the game here', () => {
    expect(concealsAuthors('did-you-know', ['x'], ['lecture'])).toBe(false)
    expect(concealsAuthors('did-you-know-lecture', ['x'], [])).toBe(false)
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
