// tree-walk.one-row-per-name.spec.ts — a parent's children are ONE PER NAME.
//
// THE BUG THIS PINS DOWN. The chat window's hive list showed the same cell
// three times ("pheromone-workflow", three identical rows, one picture)
// while the canvas behind it showed a single hexagon. Nothing was wrong
// with the render: the parent's `children` array genuinely carried three
// sigs whose layers all name that cell — a superseded revision left beside
// its replacement. The name IS the path segment, so those sigs address ONE
// location; layer-placement's `firstByName` has always collapsed them for
// every list built off a parent, but tree-walk resolves children itself and
// never got the rule, so every surface fed by the walk (the tiles rail, the
// sideways tree view, the agent's tile context) counted revisions as tiles.
//
// First sig wins, order preserved — the parent's own ordering is the layout
// order, so the collapsed list still reads in canvas order.

import { describe, expect, it } from 'vitest'
import { expandNodes, walkTree, type WalkHistory, type WalkStore } from './tree-walk.js'
import type { PlacementLayer } from '../../history/layer-placement.js'

const sig = (n: number): string => String(n).padStart(64, '0')

const ROOT = sig(1)
const OLD_REVISION = sig(2)
const HEAD_REVISION = sig(3)
const SIBLING = sig(4)

/** A hive whose root lists the same cell twice — the older revision first,
 *  its replacement second — plus one ordinary sibling. */
const layers = new Map<string, PlacementLayer>([
  [ROOT, { name: 'hive', children: [OLD_REVISION, HEAD_REVISION, SIBLING] }],
  [OLD_REVISION, { name: 'pheromone-workflow', children: [] }],
  [HEAD_REVISION, { name: 'pheromone-workflow', children: [] }],
  [SIBLING, { name: 'diagrams', children: [] }],
])

const history: WalkHistory = {
  sign: async () => ROOT,
  currentLayerAt: async (locationSig: string) => layers.get(locationSig) ?? null,
  getLayerBySig: async (s: string) => layers.get(s) ?? null,
}

const store: WalkStore = { getResource: async () => null }

describe('tree-walk collapses same-name siblings', () => {
  it('walkTree gives one node per name, first sig winning', async () => {
    const result = await walkTree({ segments: [] }, history, store, { maxDepth: 1, maxNodes: 100 })
    const ring = result.nodes.filter(n => n.depth === 1)

    expect(ring.map(n => n.name)).toEqual(['pheromone-workflow', 'diagrams'])
    expect(ring[0].sig).toBe(OLD_REVISION)
  })

  it('expandNodes collapses the same way when a node deepens later', async () => {
    const shallow = await walkTree({ segments: [] }, history, store, { maxDepth: 0, maxNodes: 100 })
    const { nodes, added } = await expandNodes(shallow.nodes, [0], history, store, { maxNodes: 100 })

    expect(added).toBe(2)
    expect(nodes.filter(n => n.depth === 1).map(n => n.name)).toEqual(['pheromone-workflow', 'diagrams'])
  })

  it('two cells that merely share a prefix are still two rows', async () => {
    const distinct = new Map(layers)
    distinct.set(ROOT, { name: 'hive', children: [OLD_REVISION, SIBLING] })
    distinct.set(OLD_REVISION, { name: 'pheromone-workflow-2', children: [] })
    const forked: WalkHistory = {
      ...history,
      currentLayerAt: async (s: string) => distinct.get(s) ?? null,
      getLayerBySig: async (s: string) => distinct.get(s) ?? null,
    }

    const result = await walkTree({ segments: [] }, forked, store, { maxDepth: 1, maxNodes: 100 })
    expect(result.nodes.filter(n => n.depth === 1).map(n => n.name))
      .toEqual(['pheromone-workflow-2', 'diagrams'])
  })
})
