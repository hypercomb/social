import { describe, expect, it, vi } from 'vitest'
import { HypercombHiveTreeReader } from './hive-tree-reader.js'
import type { CurrentLayerRef, LayerContent } from '../history/history.service.js'

const sig = (n: number): string => n.toString(16).padStart(64, '0')

const HISTORY = '@diamondcoreprocessor.com/HistoryService'
const STORE = '@hypercomb.social/Store'
const COMMITTER = '@diamondcoreprocessor.com/LayerCommitter'

type Fixture = {
  readonly reader: HypercombHiveTreeReader
  readonly epoch: { value: number }
  readonly refs: Map<string, CurrentLayerRef>
  readonly paths: Map<string, string>
  readonly getLayerBySig: ReturnType<typeof vi.fn>
  readonly settled: ReturnType<typeof vi.fn>
}

const fixture = (): Fixture => {
  const rootLayer: LayerContent = { name: 'hive', children: [sig(2), sig(3)] }
  // The parent carries an OLD projects layer. Its legacy child must not leak
  // into the observation once /projects has its own newer per-page head.
  const oldProjects: LayerContent = { name: 'projects', children: [sig(4)] }
  const notes: LayerContent = { name: 'notes', children: [] }
  const legacy: LayerContent = { name: 'legacy', children: [] }
  const liveProjects: LayerContent = { name: 'projects', children: [sig(6)] }
  const roadmap: LayerContent = { name: 'roadmap', children: [] }
  const layers = new Map<string, LayerContent>([
    [sig(1), rootLayer],
    [sig(2), oldProjects],
    [sig(3), notes],
    [sig(4), legacy],
    [sig(5), liveProjects],
    [sig(6), roadmap],
  ])
  const locations = new Map<string, string>([
    ['', sig(101)],
    ['projects', sig(102)],
    ['notes', sig(103)],
    ['projects/roadmap', sig(104)],
  ])
  const paths = new Map<string, string>()
  const refs = new Map<string, CurrentLayerRef>([
    [sig(101), { locationSig: sig(101), layerSig: sig(1), layer: rootLayer }],
    [sig(102), { locationSig: sig(102), layerSig: sig(5), layer: liveProjects }],
    [sig(103), { locationSig: sig(103), layerSig: sig(3), layer: notes }],
    [sig(104), { locationSig: sig(104), layerSig: sig(6), layer: roadmap }],
  ])
  const epoch = { value: 7 }
  const getLayerBySig = vi.fn(async (signature: string) => layers.get(signature) ?? null)
  const history = {
    sign: vi.fn(async (lineage: { explorerSegments(): readonly string[] }) => {
      const path = lineage.explorerSegments().join('/')
      const location = locations.get(path) ?? sig(999)
      paths.set(location, path)
      return location
    }),
    currentLayerRefAt: vi.fn(async (location: string, stats?: { cold?: boolean }) => {
      const ref = refs.get(location) ?? null
      if (!ref && paths.get(location) !== 'missing') {
        if (stats) stats.cold = true
      }
      return ref
    }),
    getLayerBySig,
    treeEpoch: () => epoch.value,
  }
  const settled = vi.fn(async () => {})
  const services = new Map<string, unknown>([
    [HISTORY, history],
    [STORE, { getResource: vi.fn(async () => null) }],
    [COMMITTER, { settled }],
  ])
  const lookup = (<T>(key: string): T | undefined => services.get(key) as T | undefined)
  return { reader: new HypercombHiveTreeReader(lookup), epoch, refs, paths, getLayerBySig, settled }
}

describe('the bounded live hive tree reader', () => {
  it('discovers names from the parent but reads each descendant from its live page head', async () => {
    const fx = fixture()
    const result = await fx.reader.readTree([], { maxDepth: 2, maxNodes: 48, maxBytes: 8_000 })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.nodes.map(node => node.path)).toEqual([
      '/', '/projects', '/notes', '/projects/roadmap',
    ])
    expect(result.nodes.map(node => node.path)).not.toContain('/projects/legacy')
    expect(result.nodes.find(node => node.path === '/projects')?.childCount).toBe(1)
    expect(JSON.stringify(result)).not.toContain(sig(1))
    expect(fx.settled).toHaveBeenCalledTimes(1)
  })

  it('marks a node-budget cut as truncated', async () => {
    const fx = fixture()
    const result = await fx.reader.readTree([], { maxDepth: 3, maxNodes: 2, maxBytes: 8_000 })

    expect(result).toMatchObject({ ok: true, truncated: true })
    if (result.ok) expect(result.nodes).toHaveLength(2)
  })

  it('never turns an unresolved declared child into authoritative partial success', async () => {
    const fx = fixture()
    fx.getLayerBySig.mockImplementation(async (signature: string) => signature === sig(2)
      ? null
      : ({ name: 'notes', children: [] } as LayerContent))

    await expect(fx.reader.readTree([], { maxDepth: 1 }))
      .resolves.toEqual({ ok: false, root: '/', code: 'incomplete-read' })
  })

  it('distinguishes an absent path from a cold/incomplete path', async () => {
    const fx = fixture()
    const missingLocation = sig(999)
    fx.paths.set(missingLocation, 'missing')

    await expect(fx.reader.readTree(['missing']))
      .resolves.toEqual({ ok: false, root: '/missing', code: 'not-found' })
  })

  it('discards a read when the tree epoch moves during traversal', async () => {
    const fx = fixture()
    const original = fx.getLayerBySig.getMockImplementation()!
    fx.getLayerBySig.mockImplementation(async (signature: string) => {
      const value = await original(signature)
      fx.epoch.value++
      return value
    })

    await expect(fx.reader.readTree([]))
      .resolves.toEqual({ ok: false, root: '/', code: 'stale-read' })
  })

  it('revalidates the private visited-head vector, even without an epoch bump', async () => {
    const fx = fixture()
    const result = await fx.reader.readTree([])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(await fx.reader.validateSnapshots([result.snapshot])).toBe(true)

    const projects = fx.refs.get(sig(102))!
    fx.refs.set(sig(102), { ...projects, layerSig: sig(77) })
    expect(await fx.reader.validateSnapshots([result.snapshot])).toBe(false)
  })

  it('honors participant cancellation before touching history', async () => {
    const fx = fixture()
    const controller = new AbortController()
    controller.abort()

    await expect(fx.reader.readTree([], { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(fx.settled).not.toHaveBeenCalled()
  })
})

