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
const hive = (workHolds: string[] = []) => {
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
  const held = workHolds.map(name => put({ name }))
  const work = put({ name: 'work', ...(held.length ? { children: held } : {}) })
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

describe('commitMoveMany — the preflight: blocked landings are asked about, never half-moved in silence', () => {
  const setup = async (workHolds: string[]) => {
    const h = hive(workHolds)
    registry.set('@diamondcoreprocessor.com/HistoryService', h.history)
    registry.set('@diamondcoreprocessor.com/LayerCommitter', h.committer)
    registry.set('@hypercomb.social/Lineage', { explorerSegments: () => [], domain: undefined })
    await import('./move.drone.js')
    return { h, move: registry.get('@diamondcoreprocessor.com/MoveDrone') }
  }
  const toasts = async () => {
    const { EffectBus } = await import('@hypercomb/core')
    const seen: any[] = []
    const off = EffectBus.on<any>('toast:show', t => { seen.push(t) })
    // The bus replays its last value to a new subscriber — that is the
    // previous test's toast, not this act's.
    seen.length = 0
    return { seen, off }
  }

  it('some blocked: writes nothing, asks, and Move lands only the tiles that have a spot', async () => {
    const { h, move } = await setup(['desk'])
    const { seen, off } = await toasts()
    const landed = await move.commitMoveMany([], [{ labels: ['desk', 'inbox'], targetSegments: ['work'] }])
    expect(landed).toEqual([[]])
    expect(h.commits).toHaveLength(0)
    const ask = seen.find(t => t.key === 'move-partial')
    expect(ask.actions.map((a: any) => a.effect)).toEqual(['move:partial-resume', 'move:partial-cancel'])

    const answered = await move.resumePartial(ask.actions[0].payload.token)
    expect(answered).toEqual([['inbox']])
    expect(h.commits[0].changes).toMatchObject({ appends: [h.inbox] })
    off()
  })

  it('some blocked: Cancel drops the held move and nothing is ever written', async () => {
    const { h, move } = await setup(['desk'])
    const { seen, off } = await toasts()
    await move.commitMoveMany([], [{ labels: ['desk', 'inbox'], targetSegments: ['work'] }])
    const token = seen.find(t => t.key === 'move-partial').actions[1].payload.token
    move.dropPartial(token)
    expect(await move.resumePartial(token)).toEqual([])
    expect(h.commits).toHaveLength(0)
    off()
  })

  it('all blocked: refuses with no question and writes nothing', async () => {
    const { h, move } = await setup(['desk', 'inbox'])
    const { seen, off } = await toasts()
    const landed = await move.commitMoveMany([], [{ labels: ['desk', 'inbox'], targetSegments: ['work'] }])
    expect(landed).toEqual([[]])
    expect(h.commits).toHaveLength(0)
    expect(seen.some(t => t.key === 'move-partial')).toBe(false)
    expect(seen.length).toBeGreaterThan(0)
    off()
  })
})
