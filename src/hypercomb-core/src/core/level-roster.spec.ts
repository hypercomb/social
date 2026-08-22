// level-roster.spec.ts — one level, one answer.
//
// THE BUG THIS PINS DOWN. The notes panel's tile list and the chat window's
// tiles rail are the same list said twice, and they disagreed: the notes list
// showed `pheromone-workflow` three times where the rail (and the canvas)
// showed it once, because the rail walked the tree while the notes list read
// the command line's cell suggestions, which walked `children` straight — one
// row per sig. The name IS the path segment; those sigs address ONE location.
//
// The second disagreement was staleness: the old suggestions read resolved the
// level through its OWN lineage bag, which is EMPTY for a level nobody has
// navigated into, so the list went blank or lagged the canvas. The roster
// resolves down the parent chain instead, the way the renderer does.

import { describe, expect, it } from 'vitest'
import { childLayersOf, levelRoster, resolveLevelLayer, type RosterHistory, type RosterLayer, type RosterStore } from './level-roster.js'

const sig = (n: number): string => String(n).padStart(64, '0')

const ROOT_LOCATION = sig(90)
const ROOT = sig(1)
const OLD_REVISION = sig(2)
const HEAD_REVISION = sig(3)
const SIBLING = sig(4)
const GRANDCHILD = sig(5)

const layers = new Map<string, RosterLayer>([
  [ROOT, { name: 'hive', children: [OLD_REVISION, HEAD_REVISION, SIBLING] }],
  [OLD_REVISION, { name: 'pheromone-workflow', children: [GRANDCHILD] }],
  [HEAD_REVISION, { name: 'pheromone-workflow', children: [] }],
  [SIBLING, { name: 'diagrams', children: [], properties: [sig(7)] }],
  [GRANDCHILD, { name: 'inside', children: [] }],
])

/** A hive where ONLY the root has a resolvable bag — every deeper level has
 *  to be found by walking down from it, which is the case that used to blank
 *  the list. */
const history: RosterHistory = {
  sign: async (lineage) => (lineage.explorerSegments().length === 0 ? ROOT_LOCATION : sig(99)),
  currentLayerAt: async (locationSig) => (locationSig === ROOT_LOCATION ? layers.get(ROOT)! : null),
  getLayerBySig: async (s) => layers.get(s) ?? null,
}

const store: RosterStore = { getResource: async () => null }

describe('levelRoster', () => {
  it('gives one row per NAME, first sig winning, in the parent order', async () => {
    const rows = await levelRoster([], history, store)

    expect(rows.map(r => r.name)).toEqual(['pheromone-workflow', 'diagrams'])
    expect(rows[0].sig).toBe(OLD_REVISION)
  })

  it('carries what a row needs to be drawn: path, child count, picture sig', async () => {
    const rows = await levelRoster([], history, store)

    expect(rows[0].segments).toEqual(['pheromone-workflow'])
    expect(rows[0].childCount).toBe(1)
    expect(rows[1].propsSig).toBe(sig(7))
  })

  it('resolves a level whose own bag is empty by walking the parent chain', async () => {
    const { layer } = await resolveLevelLayer(['pheromone-workflow'], history)
    expect(layer?.name).toBe('pheromone-workflow')

    const rows = await levelRoster(['pheromone-workflow'], history, store)
    expect(rows.map(r => r.name)).toEqual(['inside'])
  })

  it('is empty — never throws — at an address that resolves to nothing', async () => {
    expect(await levelRoster(['nowhere'], history, store)).toEqual([])
  })

  it('trusts the children manifest only when it covers every child', async () => {
    const seen: string[] = []
    const counted: RosterHistory = {
      ...history,
      getLayerBySig: async (s) => { seen.push(s); return layers.get(s) ?? null },
      childrenManifestFor: async () => [
        { sig: OLD_REVISION, layer: layers.get(OLD_REVISION)! },
      ],
    }
    // A short manifest (1 of 3) is not truth — every child is read by byte.
    const rows = await childLayersOf(layers.get(ROOT)!, counted, store)
    expect(rows.map(r => r.name)).toEqual(['pheromone-workflow', 'diagrams'])
    expect(seen).toContain(HEAD_REVISION)
  })

  it('reads a complete manifest instead of the child bytes', async () => {
    const seen: string[] = []
    const inlined: RosterHistory = {
      ...history,
      getLayerBySig: async (s) => { seen.push(s); return layers.get(s) ?? null },
      childrenManifestFor: async () => [OLD_REVISION, HEAD_REVISION, SIBLING]
        .map(s => ({ sig: s, layer: layers.get(s)! })),
    }

    const rows = await childLayersOf(layers.get(ROOT)!, inlined, store)
    expect(rows.map(r => r.name)).toEqual(['pheromone-workflow', 'diagrams'])
    expect(seen).toEqual([])
  })
})
