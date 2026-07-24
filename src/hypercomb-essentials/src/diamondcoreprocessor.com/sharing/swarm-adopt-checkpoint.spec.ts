// swarm-adopt-checkpoint.spec.ts — a restore point is taken BEFORE an
// incoming content fold changes the hive.
//
// The installer's Done fold (`actions:available`) folds enabled content
// branches into the hive at potentially many locations. Undo is per-location,
// so the way back is a named restore point taken FIRST — the same safety
// /restore takes before it rewinds. This pins: (1) a real diff checkpoints
// before it mutates, (2) an empty diff checkpoints nothing, (3) a snapshot
// failure never blocks the accepted fold.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const BRANCH = 'a'.repeat(64)

type Layer = { name?: string; children?: string[] }

let timeline: string[]
let layers: Map<string, Layer>
let headByLoc: Map<string, Layer>
let broker: { adopt: ReturnType<typeof vi.fn>; noteDomainsForSig: ReturnType<typeof vi.fn>; getKnownDomains: () => string[] }
let committer: { update: ReturnType<typeof vi.fn>; importTree: ReturnType<typeof vi.fn> }
let snapshotInvoke: ReturnType<typeof vi.fn>
let registrySnapshot: { branches: Record<string, unknown>[] } | null

const history = {
  sign: vi.fn(async (l: { explorerSegments: () => readonly string[] }) => 'loc:' + l.explorerSegments().join('/')),
  currentLayerAt: vi.fn(async (loc: string) => headByLoc.get(loc) ?? null),
  latestMarkerSigFor: vi.fn(async () => ''),
  getLayerBySig: vi.fn(async (sig: string) => layers.get(String(sig).toLowerCase()) ?? null),
  commitLayer: vi.fn(async () => 'e'.repeat(64)),
}

const iocRegistry = (): Record<string, unknown> => ({
  '@diamondcoreprocessor.com/SwarmDrone': { peerTilesAtCurrentSig: () => [], subscribedTiles: () => [] },
  '@hypercomb.social/Lineage': { explorerSegments: () => [], domain: () => 'hypercomb.io' },
  '@diamondcoreprocessor.com/ContentBrokerDrone': broker,
  '@diamondcoreprocessor.com/HistoryService': history,
  '@diamondcoreprocessor.com/LayerCommitter': committer,
  '@diamondcoreprocessor.com/HistoryCursorService': { state: { rewound: false } },
  '@hypercomb.social/RegistrySnapshot': { snapshot: registrySnapshot },
  '@diamondcoreprocessor.com/SnapshotQueenBee': { invoke: snapshotInvoke },
})

;(window as unknown as { ioc: unknown }).ioc = {
  register: () => void 0,
  get: (key: string) => iocRegistry()[key],
}

await import('./swarm-adopt.drone.js')

const settle = async () => {
  for (let i = 0; i < 6; i++) { await Promise.resolve(); await new Promise(r => setTimeout(r, 0)) }
}

/** One enabled content branch, nothing folded yet — a real +1 diff. */
const oneIncomingBranch = (opts: { snapshotThrows?: boolean } = {}) => {
  timeline = []
  layers = new Map<string, Layer>([[BRANCH, { name: 'thing', children: [] }]])
  headByLoc = new Map<string, Layer>([['loc:', { name: 'root', children: [] }]])
  broker = {
    adopt: vi.fn(async () => ({ layers: 1, leaves: 0, failed: 0 })),
    noteDomainsForSig: vi.fn(),
    getKnownDomains: () => [],
  }
  committer = {
    update: vi.fn(async () => 'f'.repeat(64)),
    importTree: vi.fn(async (updates: { segments: string[]; layer: Layer }[]) => {
      timeline.push('fold')
      for (const u of updates) headByLoc.set('loc:' + u.segments.join('/'), { name: u.layer.name ?? 'x', children: [] })
    }),
  }
  snapshotInvoke = vi.fn(async () => {
    timeline.push('checkpoint')
    if (opts.snapshotThrows) throw new Error('seal failed — a tile is cold')
  })
  registrySnapshot = { branches: [{ branchSig: BRANCH, name: 'thing', at: [], enabled: true, kind: 'content' }] }
}

const done = () => window.dispatchEvent(new Event('actions:available'))

beforeEach(() => { localStorage.clear() })

describe('restore point before an incoming fold', () => {

  it('checkpoints BEFORE the fold mutates, once', async () => {
    oneIncomingBranch()
    done()
    await settle()

    expect(snapshotInvoke).toHaveBeenCalledTimes(1)
    expect(String(snapshotInvoke.mock.calls[0][0])).toMatch(/before installing 1 change/)
    // Order is the whole point: the restore point captures the PRE-fold hive.
    expect(timeline[0]).toBe('checkpoint')
    expect(timeline).toContain('fold')
    expect(timeline.indexOf('checkpoint')).toBeLessThan(timeline.indexOf('fold'))
  })

  it('an empty diff checkpoints nothing', async () => {
    oneIncomingBranch()
    registrySnapshot = { branches: [] }   // nothing enabled → no adds/removes
    done()
    await settle()

    expect(snapshotInvoke).not.toHaveBeenCalled()
    expect(committer.importTree).not.toHaveBeenCalled()
  })

  it('a snapshot failure never blocks the accepted fold', async () => {
    oneIncomingBranch({ snapshotThrows: true })
    done()
    await settle()

    // The checkpoint threw, but the fold the participant accepted still ran.
    expect(snapshotInvoke).toHaveBeenCalledTimes(1)
    expect(timeline).toContain('fold')
    expect(timeline.indexOf('checkpoint')).toBeLessThan(timeline.indexOf('fold'))
  })

})
