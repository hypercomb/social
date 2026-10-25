// A move changes which page lists a tile, and nothing about the tile. The
// signature appended at the destination IS the one the source listed — never
// re-minted to carry a landing seat — and the seat rides in the destination's
// own marker, while the source drops the name from its order in the marker
// that removes the tile (history/tile-order.ts).

import { beforeAll, describe, expect, it } from 'vitest'

const registry = new Map<string, any>()

beforeAll(() => {
  Object.defineProperty(window, 'ioc', {
    configurable: true,
    value: {
      get: (key: string) => registry.get(key),
      register: (key: string, value: unknown) => registry.set(key, value),
      whenReady: () => {},
    },
  })
})

type Layer = { name: string; children?: string[]; properties?: string[] }

/** One page holding `desk`, `inbox` and an empty `work`; desk carries the
 *  `index` an older build wrote inside it. */
const hive = () => {
  const layers = new Map<string, Layer>()
  const heads = new Map<string, string>()
  let n = 0
  const put = (layer: Layer): string => {
    const sig = `${layer.name}:${n++}`.padEnd(8, '_')
    layers.set(sig, layer)
    return sig
  }
  const desk = put({ name: 'desk', properties: ['props-with-index-3'] })
  const inbox = put({ name: 'inbox' })
  const work = put({ name: 'work' })
  heads.set('loc:', put({ name: 'root', children: [desk, inbox, work] }))
  const remints: unknown[] = []
  const history = {
    sign: async (l: { explorerSegments: () => readonly string[] }) => `loc:${l.explorerSegments().join('/')}`,
    currentLayerAt: async (loc: string) => { const head = heads.get(loc); return head ? layers.get(head) ?? null : null },
    getLayerBySig: async (sig: string) => layers.get(sig) ?? null,
    commitLayer: async (loc: string, layer: Layer) => { const sig = put(layer); heads.set(loc, sig); return sig },
    materializeLayer: async (layer: Layer) => { remints.push(layer); return put(layer) },
  }
  const commits: { segments: readonly string[]; changes: Record<string, unknown> }[] = []
  const committer = {
    commitChildrenDeltas: async (segments: readonly string[], changes: Record<string, unknown>) => {
      commits.push({ segments: [...segments], changes })
      return `new:${segments.join('/')}`
    },
    importTree: async () => {},
  }
  return { desk, inbox, work, history, committer, commits, remints }
}

describe('commitMoveMany — a move is a membership edit and nothing else', () => {
  it('appends the tile’s own sig, seats it in the destination’s marker, and unseats it at the source', async () => {
    const h = hive()
    registry.set('@diamondcoreprocessor.com/HistoryService', h.history)
    registry.set('@diamondcoreprocessor.com/LayerCommitter', h.committer)
    registry.set('@hypercomb.social/Lineage', { explorerSegments: () => [], domain: undefined })
    await import('./move.drone.js')
    const move = registry.get('@diamondcoreprocessor.com/MoveDrone')

    const landed = await move.commitMoveMany([], [{ labels: ['desk', 'inbox'], targetSegments: ['work'] }])

    expect(landed).toEqual([['desk', 'inbox']])
    expect(h.remints).toEqual([])
    const [gain, lose] = h.commits
    expect(gain).toEqual({
      segments: ['work'],
      changes: { appends: [h.desk, h.inbox], order: { set: { desk: 0, inbox: 1 } } },
    })
    expect(lose.segments).toEqual([])
    expect(lose.changes).toMatchObject({
      removes: [{ sig: h.desk, label: 'desk' }, { sig: h.inbox, label: 'inbox' }],
      swaps: [{ from: h.work, to: 'new:work' }],
      order: { remove: ['desk', 'inbox'] },
    })
    expect(h.commits).toHaveLength(2)
  })
})
