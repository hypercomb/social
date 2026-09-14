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

  it('reads one tile with its content, signature and children, and lists without content', async () => {
    const fx = fixture()
    const read = await fx.reader.readNode(['projects'], { maxBytes: 8_000, withContent: true })
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.name).toBe('projects')
    expect(read.layerSig).toBe(sig(5))
    expect(read.children).toEqual([{ name: 'roadmap', sig: sig(6) }])
    expect(read.content).toEqual({ name: 'projects' })
    expect(read.snapshot).toBeTruthy()

    const listed = await fx.reader.readNode(['projects'], { maxBytes: 8_000, withContent: false })
    expect(listed.ok && listed.content).toBeUndefined()
    expect(await fx.reader.readNode(['missing'], { maxBytes: 8_000 })).toMatchObject({ ok: false, code: 'not-found' })
    // no bag listing on this history → history is honestly unavailable
    expect(await fx.reader.readHistory(['projects'])).toMatchObject({ ok: false, code: 'unavailable' })
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
    const original = fx.getLayerBySig.getMockImplementation()! as (signature: string) => Promise<unknown>
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


describe('the read cache', () => {
  it('reuses a repeated read without walking the store again, and its snapshot still validates', async () => {
    const fx = fixture()
    const first = await fx.reader.readNode(['projects'], { maxBytes: 8_000, withContent: true })
    const walked = fx.getLayerBySig.mock.calls.length
    const again = await fx.reader.readNode(['projects'], { maxBytes: 8_000, withContent: true })
    expect(fx.getLayerBySig.mock.calls.length).toBe(walked)
    expect(again.ok && first.ok && again.layerSig).toBe(first.ok ? first.layerSig : undefined)
    expect(again.ok && again.snapshot).toBeTruthy()
    expect(again.ok && first.ok && again.snapshot !== first.snapshot).toBe(true)
    if (again.ok && again.snapshot) expect(await fx.reader.validateSnapshots([again.snapshot])).toBe(true)
  })

  it('reads fresh the moment the tree changes', async () => {
    const fx = fixture()
    await fx.reader.readTree([], { maxDepth: 2, maxNodes: 48, maxBytes: 8_000 })
    const walked = fx.getLayerBySig.mock.calls.length
    await fx.reader.readTree([], { maxDepth: 2, maxNodes: 48, maxBytes: 8_000 })
    expect(fx.getLayerBySig.mock.calls.length).toBe(walked)
    fx.epoch.value++
    await fx.reader.readTree([], { maxDepth: 2, maxNodes: 48, maxBytes: 8_000 })
    expect(fx.getLayerBySig.mock.calls.length).toBeGreaterThan(walked)
  })

  it('keeps a read by signature across tree changes — that content never changes', async () => {
    const fx = fixture()
    const first = await fx.reader.readNodeBySig(sig(5), { maxBytes: 8_000 })
    expect(first.ok).toBe(true)
    const walked = fx.getLayerBySig.mock.calls.length
    fx.epoch.value++
    await fx.reader.readNodeBySig(sig(5), { maxBytes: 8_000 })
    expect(fx.getLayerBySig.mock.calls.length).toBe(walked)
  })

  it('never keeps a failed read', async () => {
    const fx = fixture()
    expect(await fx.reader.readNode(['missing'], { maxBytes: 8_000 })).toMatchObject({ ok: false })
    const walked = fx.settled.mock.calls.length
    await fx.reader.readNode(['missing'], { maxBytes: 8_000 })
    expect(fx.settled.mock.calls.length).toBeGreaterThan(walked)
  })
})

describe('opening what a signature names', () => {
  const readerWith = (store: unknown, extra: readonly [string, unknown][] = []): HypercombHiveTreeReader => {
    const services = new Map<string, unknown>([[STORE, store], ...extra])
    return new HypercombHiveTreeReader(<T>(key: string): T | undefined => services.get(key) as T | undefined)
  }

  it('opens a module from the bees pool a page at a time, without reading a page twice', async () => {
    const source = 'x'.repeat(1_500)
    const getBeeBytes = vi.fn(async () => new TextEncoder().encode(source))
    const reader = readerWith({ getResource: vi.fn(async () => null), getBeeBytes, getDependencyBytes: vi.fn(async () => null) })
    expect(await reader.readBytesBySig(sig(5), { maxBytes: 1_000 }))
      .toMatchObject({ ok: true, of: 'bee', type: 'text/javascript', from: 0, size: 1_500, truncated: true, next: 1_000 })
    const rest = await reader.readBytesBySig(sig(5), { from: 1_000, maxBytes: 1_000 })
    expect(rest).toMatchObject({ ok: true, from: 1_000, truncated: false })
    expect(rest.ok && rest.text?.length).toBe(500)
    await reader.readBytesBySig(sig(5), { maxBytes: 1_000 })
    expect(getBeeBytes).toHaveBeenCalledTimes(2)
  })

  it('opens a resource as text, reports bytes that are not text by type and size, and says when nothing is there', async () => {
    const blobs = new Map<string, Blob>([
      [sig(6), new Blob(['{"note":"hello"}'], { type: 'application/json' })],
      [sig(7), new Blob([new Uint8Array([0xff, 0x00, 0xfe])], { type: 'image/png' })],
    ])
    const reader = readerWith({ getResource: vi.fn(async (s: string) => blobs.get(s) ?? null) })
    expect(await reader.readBytesBySig(sig(6))).toMatchObject({ ok: true, of: 'resource', type: 'application/json', text: '{"note":"hello"}' })
    const image = await reader.readBytesBySig(sig(7))
    expect(image).toMatchObject({ ok: true, of: 'resource', type: 'image/png', size: 3 })
    expect(image.ok && image.text).toBeUndefined()
    expect(await reader.readBytesBySig(sig(8))).toMatchObject({ ok: false, code: 'not-found' })
  })

  it('lists the running code by name, filtered by a word', async () => {
    const reader = readerWith({ getResource: vi.fn(async () => null) }, [
      ['@hypercomb.social/ScriptPreloader', { actions: [{ signature: sig(9), name: 'history-service' }, { signature: sig(10), name: 'layer-committer' }] }],
      ['@hypercomb.social/DependencyLoader', { loadedSignatures: [sig(11)] }],
    ])
    expect(await reader.listCode('')).toMatchObject({ ok: true, total: 3, truncated: false })
    const some = await reader.listCode('history')
    expect(some.ok && some.entries).toEqual([{ name: 'history-service', sig: sig(9), of: 'bee' }])
  })
})

describe('signatures are the lookup keys', () => {
  it('keeps a route only as the signature it resolved to, so reading that signature afterwards walks nothing', async () => {
    const fx = fixture()
    const byRoute = await fx.reader.readNode(['projects'], { maxBytes: 8_000, withContent: true })
    if (!byRoute.ok) throw new Error('route read failed')
    const walked = fx.getLayerBySig.mock.calls.length

    const bySig = await fx.reader.readNodeBySig(byRoute.layerSig, { maxBytes: 8_000, withContent: true })
    expect(fx.getLayerBySig.mock.calls.length).toBe(walked)
    expect(bySig).toMatchObject({ ok: true, root: byRoute.layerSig, layerSig: byRoute.layerSig, children: byRoute.children })

    // and the route again: looked up through the same signature, with a fresh snapshot that validates
    const again = await fx.reader.readNode(['projects'], { maxBytes: 8_000, withContent: true })
    expect(fx.getLayerBySig.mock.calls.length).toBe(walked)
    expect(again).toMatchObject({ ok: true, root: byRoute.root, name: byRoute.name, layerSig: byRoute.layerSig })
    if (again.ok && again.snapshot) expect(await fx.reader.validateSnapshots([again.snapshot])).toBe(true)
  })
})

describe('a tile read on a live hive', () => {
  it('names a nameless child by its signature and lists a child it cannot see, instead of failing the read', async () => {
    const fx = fixture()
    const original = fx.getLayerBySig.getMockImplementation()! as (signature: string) => Promise<unknown>
    fx.getLayerBySig.mockImplementation(async (signature: string) =>
      signature === sig(6) ? ({ children: [] } as unknown as LayerContent) : original(signature))
    const nameless = await fx.reader.readNode(['projects'], { maxBytes: 8_000, withContent: true })
    expect(nameless).toMatchObject({ ok: true, children: [{ name: sig(6).slice(0, 8), sig: sig(6) }] })
    expect(nameless.ok && nameless.unresolved).toBeUndefined()

    const cold = fixture()
    const coldOriginal = cold.getLayerBySig.getMockImplementation()! as (signature: string) => Promise<unknown>
    cold.getLayerBySig.mockImplementation(async (signature: string) => signature === sig(6) ? null : coldOriginal(signature))
    expect(await cold.reader.readNode(['projects'], { maxBytes: 8_000, withContent: true }))
      .toMatchObject({ ok: true, children: [], unresolved: [sig(6)] })
  })
})
