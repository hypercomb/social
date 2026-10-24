// navigation/walk.spec.ts — the stops of a walk, and the word.

import { describe, expect, it } from 'vitest'
import { WALK_MAX_SECONDS, WALK_MIN_SECONDS, WALK_SECONDS, parseWalk, walkRoute, type ReadChildren } from './walk.js'

/** A hive as nested names: a tile with an object holds tiles. */
type Tree = { [name: string]: Tree | null }
const reader = (tree: Tree, cold: string[] = []): ReadChildren => async (segments) => {
  if (cold.includes(segments.join('/'))) return null
  let node: Tree | null = tree
  for (const s of segments) node = node?.[s] ?? null
  if (!node) return []
  return Object.keys(node).map(name => ({ name }))
}

const hive: Tree = {
  welcome: {
    following: { 'you-go': null, tap: null },
    basics: { tile: null, inside: { deeper: null } },
    idea: { people: null },
    loose: null,
  },
  elsewhere: { x: null },
}

describe('walkRoute', () => {
  it('stops at the root, then every tile holding tiles, depth first in the order they stand', async () => {
    expect(await walkRoute(reader(hive), ['welcome'])).toEqual([
      ['welcome'],
      ['welcome', 'following'],
      ['welcome', 'basics'],
      ['welcome', 'basics', 'inside'],
      ['welcome', 'idea'],
    ])
  })

  it('never stops inside a tile with nothing in it, and never leaves the page it began on', async () => {
    const stops = await walkRoute(reader(hive), ['welcome'])
    expect(stops).not.toContainEqual(['welcome', 'loose'])
    expect(stops.every(s => s[0] === 'welcome')).toBe(true)
  })

  it('walks the whole hive from home', async () => {
    expect((await walkRoute(reader(hive), [])).length).toBe(7)
  })

  it('leaves a page that will not read, and what is beneath it, for the next round', async () => {
    expect(await walkRoute(reader(hive, ['welcome/basics']), ['welcome'])).toEqual([
      ['welcome'],
      ['welcome', 'following'],
      ['welcome', 'idea'],
    ])
  })

  it("reads each page where it stands, never through its parent's memory of it", async () => {
    // The parent's layer remembers `later` empty; the page itself holds a tile.
    const read: ReadChildren = async (segments) =>
      segments.length === 0 ? [{ name: 'later' }] : segments.join('/') === 'later' ? [{ name: 'added' }] : []
    expect(await walkRoute(read, [])).toEqual([[], ['later']])
  })

  it('goes no deeper than it is told, and holds no more stops than its cap', async () => {
    expect(await walkRoute(reader(hive), ['welcome'], 1)).toEqual([
      ['welcome'], ['welcome', 'following'], ['welcome', 'basics'], ['welcome', 'idea'],
    ])
    expect((await walkRoute(reader(hive), [], 6, 3)).length).toBe(3)
  })
})

describe('parseWalk', () => {
  it('walks at 45 seconds a stop when nothing more is said', () => {
    expect(parseWalk('')).toEqual({ verb: 'start', seconds: WALK_SECONDS })
  })

  it('takes every <seconds>, with or without an s, inside 10–600', () => {
    expect(parseWalk('every 30')).toEqual({ verb: 'start', seconds: 30 })
    expect(parseWalk('Every 20s')).toEqual({ verb: 'start', seconds: 20 })
    expect(parseWalk('every 2')).toEqual({ verb: 'start', seconds: WALK_MIN_SECONDS })
    expect(parseWalk('every 9000')).toEqual({ verb: 'start', seconds: WALK_MAX_SECONDS })
  })

  it('stops, and refuses anything else', () => {
    expect(parseWalk(' stop ')).toEqual({ verb: 'stop' })
    expect(parseWalk('fast')).toEqual({ verb: 'refuse' })
    expect(parseWalk('every')).toEqual({ verb: 'refuse' })
  })
})
