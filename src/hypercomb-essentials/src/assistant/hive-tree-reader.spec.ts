import { describe, expect, it, vi } from 'vitest'
import { HypercombHiveTreeReader } from './hive-tree-reader.js'
import type { CurrentLayerRef, LayerContent } from '../history/history.service.js'
import { MAX_RECORD_DEPTH } from '../search/hive-search.js'

const sig = (n: number): string => n.toString(16).padStart(64, '0')

const HISTORY = '@diamondcoreprocessor.com/HistoryService'
const STORE = '@hypercomb.social/Store'
const COMMITTER = '@diamondcoreprocessor.com/LayerCommitter'
const PRELOADER = '@hypercomb.social/ScriptPreloader'

type Fixture = {
  readonly reader: HypercombHiveTreeReader
  readonly epoch: { value: number }
  readonly refs: Map<string, CurrentLayerRef>
  readonly paths: Map<string, string>
  readonly layers: Map<string, LayerContent>
  readonly locations: Map<string, string>
  readonly getLayerBySig: ReturnType<typeof vi.fn>
  readonly settled: ReturnType<typeof vi.fn>
  readonly history: Record<string, unknown>
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
  return { reader: new HypercombHiveTreeReader(lookup), epoch, refs, paths, layers, locations, getLayerBySig, settled, history }
}

/** How deep a find walks: as deep as a search record reaches (2026-10-12). */
const FIND_REACH = MAX_RECORD_DEPTH

/** /projects/roadmap/far-0/…/far-{far - 1}/Deep Betz — by default one level
 *  past a find's walk, so the walk is cut above it and only a record can name
 *  it. The roadmap page has its own newer head while /projects still carries
 *  its old copy (sig 6), as a leaf-only commit leaves it. Page far-{i} is
 *  layer `sig(200 + i)` at location `sig(300 + i)`; Deep Betz is layer
 *  `sig(22)` at `sig(106)`. Returns its route. */
const deepBetz = (fx: Fixture, far = FIND_REACH - 2): readonly string[] => {
  const route = ['projects', 'roadmap', ...Array.from({ length: far }, (_, i) => `far-${i}`), 'Deep Betz']
  const deep: LayerContent = { name: 'Deep Betz', children: [] }
  fx.layers.set(sig(22), deep)
  fx.locations.set(route.join('/'), sig(106))
  fx.refs.set(sig(106), { locationSig: sig(106), layerSig: sig(22), layer: deep })
  let child = sig(22)
  for (let i = far - 1; i >= 0; i--) {
    const layer: LayerContent = { name: `far-${i}`, children: [child] }
    fx.layers.set(sig(200 + i), layer)
    fx.locations.set(route.slice(0, 3 + i).join('/'), sig(300 + i))
    fx.refs.set(sig(300 + i), { locationSig: sig(300 + i), layerSig: sig(200 + i), layer })
    child = sig(200 + i)
  }
  const roadmap: LayerContent = { name: 'roadmap', children: [child] }
  fx.layers.set(sig(20), roadmap)
  fx.refs.set(sig(104), { locationSig: sig(104), layerSig: sig(20), layer: roadmap })
  return route
}

const pathOf = (route: readonly string[]): string => `/${route.join('/')}`

/** The fixture's hive with the search index's record reader beside it. */
const withIndex = (fx: Fixture, readRecord: (layerSig: string) => Promise<unknown>): HypercombHiveTreeReader => {
  const services = new Map<string, unknown>([
    [HISTORY, fx.history],
    [STORE, { getResource: vi.fn(async () => null) }],
    [COMMITTER, { settled: fx.settled }],
    ['@diamondcoreprocessor.com/HiveSearchService', { readRecord }],
  ])
  return new HypercombHiveTreeReader(<T>(key: string) => services.get(key) as T | undefined)
}

/** `count` branches in place of the fixture's root, each a chain
 *  `/a{i}/b{i}/…/betz-{i}` that is `depth` pages long — past a find's
 *  FIND_REACH levels, so only a record names a betz. With `husk`, no page below the root
 *  has a pinned head and each opens by the copy its parent carries. Page
 *  `level` of branch `i` lives at location `sig(60_000 + i * 32 + level)`. */
const deepHive = (fx: Fixture, count: number, depth: number, husk = false): readonly (readonly string[])[] => {
  const routes: string[][] = []
  const top: string[] = []
  for (let i = 0; i < count; i++) {
    const route = Array.from({ length: depth }, (_, level) => level === depth - 1 ? `betz-${i}` : `${String.fromCharCode(97 + level)}${i}`)
    routes.push(route)
    let child: string | undefined
    for (let level = depth - 1; level >= 0; level--) {
      const layerSig = sig(10_000 + i * 32 + level)
      const locationSig = sig(60_000 + i * 32 + level)
      const layer: LayerContent = { name: route[level], children: child ? [child] : [] }
      fx.layers.set(layerSig, layer)
      fx.locations.set(route.slice(0, level + 1).join('/'), locationSig)
      if (!husk) fx.refs.set(locationSig, { locationSig, layerSig, layer })
      child = layerSig
    }
    top.push(child!)
  }
  const rootLayer: LayerContent = { name: 'hive', children: top }
  fx.layers.set(sig(1), rootLayer)
  fx.refs.set(sig(101), { locationSig: sig(101), layerSig: sig(1), layer: rootLayer })
  return routes
}

/** The root's search record, listing every route's last tile. */
const recordOf = (routes: readonly (readonly string[])[]) => vi.fn(async (layerSig: string) => layerSig === sig(1)
  ? { v: 1, rows: routes.map(route => ({ name: route[route.length - 1], path: [...route] })) }
  : null)

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

  it('leaves an unresolved declared child out and says the tree is not whole', async () => {
    // One child that cannot be named used to fail the whole walk, so /find
    // and /tree refused an entire page that /read could open. The rest is
    // still true; `truncated` keeps the answer from claiming to be all of it.
    const fx = fixture()
    fx.getLayerBySig.mockImplementation(async (signature: string) => signature === sig(2)
      ? null
      : ({ name: 'notes', children: [] } as LayerContent))

    const read = await fx.reader.readTree([], { maxDepth: 1 })
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.truncated).toBe(true)
    expect(read.nodes.every(node => node.depth === 0 || node.name === 'notes')).toBe(true)
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

  it('does not call a read changed when the hive changed somewhere it did not read', async () => {
    // Another manager filing a note moves the epoch; the pages read are as
    // they were, and saying otherwise sends the participant to ask again.
    const fx = fixture()
    const read = await fx.reader.readTree(['projects'], { maxDepth: 1 })
    if (!read.ok) throw new Error('read failed')
    fx.epoch.value++
    expect(await fx.reader.validateSnapshots([read.snapshot])).toBe(true)
    fx.refs.set(sig(102), { locationSig: sig(102), layerSig: sig(2), layer: { name: 'projects', children: [] } })
    expect(await fx.reader.validateSnapshots([read.snapshot])).toBe(false)
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
      [PRELOADER, { actions: [{ signature: sig(9), name: 'history-service' }, { signature: sig(10), name: 'layer-committer' }] }],
      ['@hypercomb.social/DependencyLoader', { loadedSignatures: [sig(11)] }],
    ])
    expect(await reader.listCode('')).toMatchObject({ ok: true, total: 3, truncated: false })
    const some = await reader.listCode('history')
    expect(some.ok && some.entries).toEqual([{ name: 'history-service', sig: sig(9), of: 'bee' }])
  })

  it('lists directly imported dev modules from signed package layers and caches that inventory', async () => {
    const layerSig = sig(12)
    const beeSig = sig(13)
    const getLayerBytes = vi.fn(async (requested: string) => requested === layerSig
      ? new TextEncoder().encode(JSON.stringify({
          name: 'assistant',
          bees: [`${beeSig}.js`],
          docs: { bees: { [beeSig]: { className: 'CoreReaderDrone' } } },
        }))
      : null)
    const previous = localStorage.getItem('core-adapter.installed-manifest')
    localStorage.setItem('core-adapter.installed-manifest', JSON.stringify({
      layers: [layerSig], bees: [beeSig], dependencies: [],
    }))
    try {
      const reader = readerWith({ getResource: vi.fn(async () => null), getLayerBytes })
      const first = await reader.listCode('core')
      expect(first.ok && first.entries).toEqual([{ name: 'CoreReaderDrone', sig: beeSig, of: 'bee' }])
      await reader.listCode('core')
      expect(getLayerBytes).toHaveBeenCalledTimes(1)
    } finally {
      if (previous === null) localStorage.removeItem('core-adapter.installed-manifest')
      else localStorage.setItem('core-adapter.installed-manifest', previous)
    }
  })

  it('lists and opens the development shell TypeScript by its content signature', async () => {
    const sourceSig = sig(14)
    const source = 'export class HypercombHiveTreeReader {}'
    const readArtifact = vi.fn(async (requested: string) => requested === sourceSig
      ? {
          name: 'hypercomb-essentials/src/assistant/hive-tree-reader.ts',
          sig: sourceSig,
          of: 'bee' as const,
          type: 'text/typescript',
          bytes: new TextEncoder().encode(source),
        }
      : null)
    const reader = readerWith({
      getResource: vi.fn(async () => null),
      getBeeBytes: vi.fn(async () => null),
      getDependencyBytes: vi.fn(async () => null),
    }, [[PRELOADER, {
      readableArtifacts: async () => [{ name: 'hypercomb-essentials/src/assistant/hive-tree-reader.ts', sig: sourceSig }],
      readArtifact,
    }]])

    const listed = await reader.listCode('hive-tree-reader')
    expect(listed.ok && listed.entries).toEqual([{
      name: 'hypercomb-essentials/src/assistant/hive-tree-reader.ts', sig: sourceSig, of: 'bee',
    }])
    // the search looks inside the text too, once: it is kept by signature
    expect(listed.ok && listed.hits).toBeUndefined()
    const inside = await reader.listCode('HiveTreeReader')
    expect(inside.ok && inside.hits).toEqual([{
      sig: sourceSig, name: 'hypercomb-essentials/src/assistant/hive-tree-reader.ts', at: 0, text: source,
    }])
    expect(await reader.readBytesBySig(sourceSig)).toMatchObject({
      ok: true, sig: sourceSig, of: 'bee', type: 'text/typescript', text: source,
    })
    await reader.readBytesBySig(sourceSig)
    expect(readArtifact).toHaveBeenCalledTimes(2) // once to search, once to open; each kept after
  })

  it('finds the lines of code that hold a word, by section, and the code that names a tile', async () => {
    const bundle = [
      '// src/games/solomon/tile-surface.ts',
      "export const SOLOMON_MAZE_BRANCH = 'solomon-maze-v1'",
      '// src/games/solomon/labyrinth.ts',
      'const rooms = []',
      'export const useDoor = (id) => enter(id)',
    ].join('\n')
    const beeSig = sig(15)
    const reader = readerWith({
      getResource: vi.fn(async () => null),
      getBeeBytes: vi.fn(async (requested: string) => requested === beeSig ? new TextEncoder().encode(bundle) : null),
      getDependencyBytes: vi.fn(async () => null),
    }, [[PRELOADER, { actions: [{ signature: beeSig, name: 'SolomonDrone' }] }]])

    const found = await reader.listCode('usedoor')
    expect(found.ok && found.entries).toEqual([])
    expect(found.ok && found.hits).toEqual([{
      sig: beeSig, name: 'SolomonDrone', section: 'src/games/solomon/labyrinth.ts',
      at: '// src/games/solomon/labyrinth.ts\nconst rooms = []\n'.length, text: 'export const useDoor = (id) => enter(id)',
    }])
    // a section path is a line too: the file finds the module that bundles it
    const byPath = await reader.listCode('labyrinth.ts')
    expect(byPath.ok && byPath.hits?.[0]).toMatchObject({ section: 'src/games/solomon/labyrinth.ts', at: 0 })
    // the tile's name, quoted in code, points at its behaviour
    expect(await reader.codeNaming('solomon-maze-v1')).toMatchObject([{ sig: beeSig, section: 'src/games/solomon/tile-surface.ts' }])
    // an unquoted mention, or a name too short to point anywhere, says nothing
    expect(await reader.codeNaming('rooms')).toEqual([])
    expect(await reader.codeNaming('id')).toEqual([])
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

describe('a page history cannot pin to one signature', () => {
  it('reads it from the bag\u2019s latest marker, without a snapshot', async () => {
    const fx = fixture()
    fx.refs.delete(sig(102)) // /projects: the head cannot be pinned, so history says cold
    fx.history['listLayers'] = vi.fn(async () => [{ index: 0, layerSig: sig(5) }])
    const read = await fx.reader.readNode(['projects'], { maxBytes: 8_000, withContent: true })
    expect(read).toMatchObject({ ok: true, name: 'projects', layerSig: sig(5), children: [{ name: 'roadmap', sig: sig(6) }] })
    expect(read.ok && read.snapshot).toBeUndefined()
  })

  it('reads it from the copy its parent carries when the bag has nothing, and still says not-found for a name nobody carries', async () => {
    const fx = fixture()
    fx.refs.delete(sig(102))
    expect(await fx.reader.readNode(['projects'], { maxBytes: 8_000, withContent: true }))
      .toMatchObject({ ok: true, name: 'projects', layerSig: sig(2), children: [{ name: 'legacy', sig: sig(4) }] })
    expect(await fx.reader.readNode(['missing'], { maxBytes: 8_000 })).toMatchObject({ ok: false, code: 'not-found' })
  })

  it('reads a manifest-carried tile whose standalone layer is not in the pool', async () => {
    const fx = fixture()
    fx.refs.delete(sig(102))
    const original = fx.getLayerBySig.getMockImplementation()! as (signature: string) => Promise<LayerContent | null>
    fx.getLayerBySig.mockImplementation(async signature => signature === sig(2) ? null : original(signature))
    fx.history['childrenManifestFor'] = vi.fn(async (layer: LayerContent) => layer.name === 'hive'
      ? [{ sig: sig(2), layer: { name: 'projects', children: [sig(4)] } }]
      : null)

    expect(await fx.reader.readNode(['projects'], { maxBytes: 8_000, withContent: true }))
      .toMatchObject({ ok: true, name: 'projects', layerSig: sig(2), children: [{ name: 'legacy', sig: sig(4) }] })
  })

  it('falls back when the live head lookup itself throws', async () => {
    const fx = fixture()
    const current = fx.history['currentLayerRefAt'] as ReturnType<typeof vi.fn>
    current.mockImplementation(async (location: string) => {
      if (location === sig(102)) throw new Error('cold head')
      return fx.refs.get(location) ?? null
    })

    expect(await fx.reader.readNode(['projects'], { maxBytes: 8_000, withContent: true }))
      .toMatchObject({ ok: true, name: 'projects', layerSig: sig(2) })
  })

  it('walks a tree whose heads cannot be pinned, the way /read reads each page', async () => {
    // /tree /games and /find answered incomplete-read for a whole hive whose
    // pages /read opened: the walk asked the pinned head alone, and one that
    // threw or came back cold failed everything.
    const fx = fixture()
    const current = fx.history['currentLayerRefAt'] as ReturnType<typeof vi.fn>
    current.mockImplementation(async (location: string, stats?: { cold?: boolean }) => {
      if (location === sig(102)) throw new Error('cold head')
      if (location === sig(101)) { if (stats) stats.cold = true; return null }
      return fx.refs.get(location) ?? null
    })
    fx.history['listLayers'] = vi.fn(async (location: string) => location === sig(101) ? [{ index: 3, layerSig: sig(1) }] : [])

    const tree = await fx.reader.readTree([], { maxDepth: 2 })
    expect(tree.ok).toBe(true)
    if (!tree.ok) return
    // /projects is the copy the root carries (sig 2), so its child is legacy.
    expect(tree.nodes.map(node => node.path)).toEqual(['/', '/projects', '/notes', '/projects/legacy'])
    expect(await fx.reader.find('legacy', [])).toMatchObject({ ok: true, matches: [{ name: 'legacy', path: '/projects/legacy' }] })
  })

  it('finds a name past what a tree would show, in a hive wider than one tree read', async () => {
    // /find walked on /tree's output budget — 64 names — and on a real hive
    // never reached /games/Arkanoid. It returns only matches, so it walks wider.
    const fx = fixture()
    const wide = Array.from({ length: 90 }, (_, i) => sig(1_000 + i))
    const layers = new Map<string, LayerContent>(wide.map((s, i) => [s, { name: `tile-${i}`, children: [] }]))
    layers.set(sig(2_000), { name: 'games', children: [sig(2_001)] })
    layers.set(sig(2_001), { name: 'Arkanoid', children: [] })
    const rootLayer: LayerContent = { name: 'hive', children: [...wide, sig(2_000)] }
    fx.refs.set(sig(101), { locationSig: sig(101), layerSig: sig(1), layer: rootLayer })
    fx.getLayerBySig.mockImplementation(async (signature: string) => layers.get(signature) ?? null)

    const tree = await fx.reader.readTree([], { maxDepth: 2 })
    expect(tree.ok && tree.nodes.some(node => node.name === 'Arkanoid')).toBe(false)
    expect(await fx.reader.find('arkanoid', [])).toMatchObject({ ok: true, matches: [{ name: 'Arkanoid', path: '/games/Arkanoid' }] })
  })

  it('finds a name from the search index past the walk’s reach once it reads live, and a whole-looking record never makes the answer whole', async () => {
    // A whole-hive find over ~5,900 tiles ran out its time walking; the
    // participant's own search keeps every name under a layer in one record.
    // But a record is built from carried copies: one that looked whole used
    // to make a walk cut at depth three answer truncated:false (2026-10-11/12).
    const fx = fixture()
    const route = deepBetz(fx)
    const readRecord = vi.fn(async (layerSig: string) => layerSig === sig(1)
      ? { v: 1, rows: [
        { sig: sig(2), name: 'projects', path: ['projects'] },
        { sig: sig(22), name: 'Deep Betz', path: [...route] },
      ] }
      : null)
    const reader = withIndex(fx, readRecord)
    expect(await reader.find('betz', [])).toMatchObject({
      ok: true, truncated: true, matches: [{ name: 'Deep Betz', path: pathOf(route) }],
    })
    // The live walk's hit comes once, not twice.
    const projects = await reader.find('projects', [])
    expect(projects.ok && projects.matches.map(match => match.path)).toEqual(['/projects'])
  })

  it('drops an index hint that no longer reads as a tile, including one whose own bag outlived its unlinking', async () => {
    // The record names tiles from the copies parents carried. A tile removed
    // since has no place in the live tree — and a remove only unlinks, so
    // its own bag still resolves: the parent must still list it.
    const fx = fixture()
    const route = deepBetz(fx)
    const unlinked: LayerContent = { name: 'Unlinked Betz', children: [] }
    fx.layers.set(sig(23), unlinked)
    fx.locations.set('notes/Unlinked Betz', sig(107))
    fx.refs.set(sig(107), { locationSig: sig(107), layerSig: sig(23), layer: unlinked })
    const readRecord = vi.fn(async (layerSig: string) => layerSig === sig(1)
      ? { v: 1, rows: [
        { sig: sig(24), name: 'Gone Betz', path: ['projects', 'Gone Betz'] },
        { sig: sig(23), name: 'Unlinked Betz', path: ['notes', 'Unlinked Betz'] },
        { sig: sig(22), name: 'Deep Betz', path: [...route] },
      ] }
      : null)
    const reader = withIndex(fx, readRecord)
    expect(await reader.readNode(['notes', 'Unlinked Betz'], { withContent: false })).toMatchObject({ ok: true })

    const found = await reader.find('betz', [])
    expect(found).toMatchObject({ ok: true, truncated: true })
    expect(found.ok && found.matches).toEqual([{ name: 'Deep Betz', path: pathOf(route) }])
  })

  it('drops a hint whose page now holds a tile of another name, anywhere along its route', async () => {
    // A carried signature can name a page whose live head is now another
    // tile — renamed or replaced under the same route. Each page a hint
    // passes through must be a tile of the name its route gives, and the
    // last one the record's own name (2026-10-12).
    const dropped = async (change: (fx: Fixture, route: readonly string[]) => void): Promise<unknown> => {
      const fx = fixture()
      const route = deepBetz(fx)
      change(fx, route)
      const reader = withIndex(fx, vi.fn(async (layerSig: string) => layerSig === sig(1)
        ? { v: 1, rows: [{ name: 'Deep Betz', path: [...route] }] }
        : null))
      return reader.find('betz', [])
    }
    // A page partway down: same children, so only its name gives it away.
    expect(await dropped(fx => {
      const renamed: LayerContent = { name: 'renamed', children: [sig(206)] }
      fx.layers.set(sig(26), renamed)
      fx.refs.set(sig(305), { locationSig: sig(305), layerSig: sig(26), layer: renamed })
    })).toMatchObject({ ok: true, truncated: true, matches: [] })
    // The last page.
    expect(await dropped(fx => {
      const moved: LayerContent = { name: 'Moved', children: [] }
      fx.layers.set(sig(27), moved)
      fx.refs.set(sig(106), { locationSig: sig(106), layerSig: sig(27), layer: moved })
    })).toMatchObject({ ok: true, truncated: true, matches: [] })

    // A row whose name is not the tile its route ends at.
    const fx = fixture()
    const route = deepBetz(fx)
    const found = await withIndex(fx, vi.fn(async (layerSig: string) => layerSig === sig(1)
      ? { v: 1, rows: [{ name: 'Far Betz', path: route.slice(0, 6) }, { name: 'Deep Betz', path: [...route] }] }
      : null)).find('betz', [])
    expect(found.ok && found.matches).toEqual([{ name: 'Deep Betz', path: pathOf(route) }])
  })

  it('still says the tree changed when the walk went stale, unless a hint was read live', async () => {
    // Any record, even one with no matching row, turned a stale walk into an
    // ok "nothing found" whose snapshot held no heads (2026-10-12).
    const staleWalk = (fx: Fixture): void => {
      const current = fx.history['currentLayerRefAt'] as ReturnType<typeof vi.fn>
      const original = current.getMockImplementation()! as (location: string, stats?: { cold?: boolean }) => Promise<unknown>
      current.mockImplementation(async (location: string, stats?: { cold?: boolean }) => {
        if (location === sig(102)) fx.epoch.value++
        return original(location, stats)
      })
    }
    const fx = fixture()
    const route = deepBetz(fx)
    staleWalk(fx)
    expect(await fx.reader.find('gone', [])).toMatchObject({ ok: false, code: 'stale-read' })
    const reader = withIndex(fx, vi.fn(async (layerSig: string) => layerSig === sig(1)
      ? { v: 1, rows: [{ name: 'Gone', path: ['gone'] }, { name: 'Deep Betz', path: [...route] }] }
      : null))
    // A row that matches but is no tile, and no matching row at all.
    expect(await reader.find('gone', [])).toMatchObject({ ok: false, code: 'stale-read' })
    expect(await reader.find('nothing', [])).toMatchObject({ ok: false, code: 'stale-read' })

    // A hint read live is shown, partial, and its pages are what the change
    // guard holds the answer to.
    const found = await reader.find('betz', [])
    if (!found.ok) throw new Error('find failed')
    expect(found).toMatchObject({ truncated: true, matches: [{ name: 'Deep Betz', path: pathOf(route) }] })
    expect(await reader.validateSnapshots([found.snapshot])).toBe(true)
    fx.refs.set(sig(106), { locationSig: sig(106), layerSig: sig(77), layer: { name: 'Deep Betz', children: [] } })
    expect(await reader.validateSnapshots([found.snapshot])).toBe(false)
  })

  it('confirms many deep hints without evicting the find’s own snapshot or an earlier read’s', async () => {
    // Checked through readNode, every page a hint passed through minted a
    // snapshot, and 65 hints six pages deep pushed the find's own out of the
    // 256 kept: the chat said the tree had changed when nothing had
    // (2026-10-11/12).
    const fx = fixture()
    const routes = deepHive(fx, 70, FIND_REACH + 2)
    const reader = withIndex(fx, recordOf(routes))
    const earlier = await reader.readNode(['a0'], { withContent: false })
    if (!earlier.ok || !earlier.snapshot) throw new Error('read failed')

    const found = await reader.find('betz', [], { maxNodes: 64 })
    if (!found.ok) throw new Error('find failed')
    expect(found.truncated).toBe(true)
    expect(found.matches).toHaveLength(64)
    expect(await reader.validateSnapshots([found.snapshot])).toBe(true)
    expect(await reader.validateSnapshots([earlier.snapshot])).toBe(true)
    // The pages a shown hint was confirmed through are in the find's snapshot.
    const betz0 = fx.refs.get(sig(60_000 + FIND_REACH + 1))!
    fx.refs.set(betz0.locationSig, { ...betz0, layerSig: sig(77) })
    expect(await reader.validateSnapshots([found.snapshot])).toBe(false)
  })

  it('tries past stale hints for a live one behind them', async () => {
    // Only the first limit-plus-one rows were checked, so a record still
    // listing a removed branch's tiles first crowded a live deep hit out of
    // the answer (2026-10-11/12).
    const fx = fixture()
    const route = deepBetz(fx)
    const stale = Array.from({ length: 60 }, (_, i) => ({ name: `Betz ${i}`, path: ['gone', `Betz ${i}`] }))
    const reader = withIndex(fx, vi.fn(async (layerSig: string) => layerSig === sig(1)
      ? { v: 1, rows: [...stale, { name: 'Deep Betz', path: [...route] }] }
      : null))
    const found = await reader.find('betz', [])
    expect(found).toMatchObject({ ok: true, truncated: true })
    expect(found.ok && found.matches).toEqual([{ name: 'Deep Betz', path: pathOf(route) }])
  })

  it('stops checking hints when their time is up and leaves the rest out', async () => {
    // The walk before the check has often spent all its own time; the hints
    // get a slice of their own, and past it the answer, already partial,
    // goes without them (2026-10-11/12).
    const fx = fixture()
    const routes = deepHive(fx, 40, FIND_REACH + 2)
    const pastTheWalk = new Set(routes.map((_, i) => sig(60_000 + i * 32 + FIND_REACH)))
    let now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    const current = fx.history['currentLayerRefAt'] as ReturnType<typeof vi.fn>
    const original = current.getMockImplementation()! as (location: string, stats?: { cold?: boolean }) => Promise<unknown>
    let opened = 0
    current.mockImplementation(async (location: string, stats?: { cold?: boolean }) => {
      if (pastTheWalk.has(location)) { opened++; now += 200 }
      return original(location, stats)
    })
    try {
      const found = await withIndex(fx, recordOf(routes)).find('betz', [])
      if (!found.ok) throw new Error('find failed')
      expect(found.truncated).toBe(true)
      expect(found.matches.length).toBeGreaterThanOrEqual(16)
      expect(found.matches.length).toBeLessThan(40)
      expect(opened).toBeLessThanOrEqual(32)
    } finally {
      clock.mockRestore()
    }
  })

  it('confirms deep hints under pages with no pinned head by their parents’ copies, opening each page once', async () => {
    // Through readNode, a page with no pinned head resolved its parents again
    // from the top for every prefix asked of it (2026-10-11/12).
    const fx = fixture()
    const routes = deepHive(fx, 5, FIND_REACH + 3, true)
    const sign = fx.history['sign'] as ReturnType<typeof vi.fn>
    const original = sign.getMockImplementation()! as (lineage: { explorerSegments(): readonly string[] }) => Promise<string>
    const signed = new Map<string, number>()
    sign.mockImplementation(async (lineage: { explorerSegments(): readonly string[] }) => {
      const path = lineage.explorerSegments().join('/')
      signed.set(path, (signed.get(path) ?? 0) + 1)
      return original(lineage)
    })

    const found = await withIndex(fx, recordOf(routes)).find('betz', [])
    expect(found.ok && found.matches.map(match => match.path)).toEqual(routes.map(route => `/${route.join('/')}`))
    const pastTheWalk = [...signed].filter(([path]) => path.split('/').length > FIND_REACH)
    expect(pastTheWalk.length).toBe(5 * 3)
    expect(pastTheWalk.every(([, times]) => times === 1)).toBe(true)
  })

  it('never shrinks the walk for a record that looks whole but was built from older copies', async () => {
    // "find betz /" answered a confident "not found": a whole-looking record
    // cut the walk to a tree's reach, and the record predated the tile.
    const fx = fixture()
    const wide = Array.from({ length: 90 }, (_, i) => sig(1_000 + i))
    const layers = new Map<string, LayerContent>(wide.map((s, i) => [s, { name: `tile-${i}`, children: [] }]))
    layers.set(sig(2_000), { name: 'games', children: [sig(2_001)] })
    layers.set(sig(2_001), { name: 'Arkanoid', children: [] })
    const rootLayer: LayerContent = { name: 'hive', children: [...wide, sig(2_000)] }
    fx.refs.set(sig(101), { locationSig: sig(101), layerSig: sig(1), layer: rootLayer })
    fx.getLayerBySig.mockImplementation(async (signature: string) => layers.get(signature) ?? null)
    const readRecord = vi.fn(async (layerSig: string) => layerSig === sig(1)
      ? { v: 1, rows: wide.map((s, i) => ({ sig: s, name: `tile-${i}`, path: [`tile-${i}`] })) }
      : null)
    const reader = withIndex(fx, readRecord)

    expect(await reader.find('arkanoid', [])).toMatchObject({
      ok: true, truncated: false, matches: [{ name: 'Arkanoid', path: '/games/Arkanoid' }],
    })
    // A whole walk saw every live tile: the record had nothing to add.
    expect(readRecord).not.toHaveBeenCalled()
  })

  it('walks past a tree’s three levels, so a find on a deeper hive can still be whole', async () => {
    // Cut at a tree's depth, every find on a hive four levels deep said it
    // was partial and sent the model searching route by route (2026-10-12).
    const fx = fixture()
    const route = deepBetz(fx, 1)
    const readRecord = vi.fn(async () => null)
    expect(await withIndex(fx, readRecord).find('betz', [])).toMatchObject({
      ok: true, truncated: false, matches: [{ name: 'Deep Betz', path: pathOf(route) }],
    })
    expect(readRecord).not.toHaveBeenCalled()
    // /tree keeps its own reach.
    const tree = await fx.reader.readTree([], { maxDepth: 8 })
    expect(tree).toMatchObject({ ok: true, truncated: true })
    expect(tree.ok && tree.nodes.some(node => node.name === 'Deep Betz')).toBe(false)
  })

  it('reads a large hive branch by branch when its root has no record', async () => {
    // The search index never keeps a truncated record, so a hive past its
    // row cap has none at the root; its branches have theirs, keyed by the
    // copy the root carries (/projects at sig 2, older than its live head).
    const fx = fixture()
    const route = deepBetz(fx)
    const readRecord = vi.fn(async (layerSig: string) => layerSig === sig(2)
      ? { v: 1, rows: [{ sig: sig(22), name: 'Deep Betz', path: route.slice(1) }] }
      : layerSig === sig(3) ? { v: 1, rows: [] } : null)
    const reader = withIndex(fx, readRecord)
    expect(await reader.find('betz', [])).toMatchObject({
      ok: true, truncated: true, matches: [{ name: 'Deep Betz', path: pathOf(route) }],
    })
  })

  it('walks into a page by its bag’s latest marker before the older copy its parent carries', async () => {
    // /dolphin/associates read as empty — its parent's copy predates its four
    // tiles — while its own bag's latest marker held them.
    const fx = fixture()
    fx.refs.delete(sig(102)) // /projects: the head cannot be pinned
    fx.history['listLayers'] = vi.fn(async (location: string) => location === sig(102) ? [{ index: 2, layerSig: sig(5) }] : [])
    const tree = await fx.reader.readTree([], { maxDepth: 2 })
    expect(tree.ok && tree.nodes.map(node => node.path)).toEqual(['/', '/projects', '/notes', '/projects/roadmap'])
  })

  it('opens a tile’s children side by side and still lists them in order', async () => {
    // One at a time, a whole-hive /find ran out its time before depth three.
    const fx = fixture()
    const current = fx.history['currentLayerRefAt'] as ReturnType<typeof vi.fn>
    const original = current.getMockImplementation()! as (location: string, stats?: { cold?: boolean }) => Promise<unknown>
    let inFlight = 0
    let most = 0
    current.mockImplementation(async (location: string, stats?: { cold?: boolean }) => {
      inFlight++
      most = Math.max(most, inFlight)
      await new Promise(resolve => setTimeout(resolve, 5))
      inFlight--
      return original(location, stats)
    })
    const tree = await fx.reader.readTree([], { maxDepth: 1 })
    expect(tree.ok && tree.nodes.map(node => node.path)).toEqual(['/', '/projects', '/notes'])
    expect(most).toBeGreaterThan(1)
  })

  it('reads a tile’s notes live from the notes service, every time, and never on a /list', async () => {
    // The notes of a tile are its word's facet, not the layer's slot: a read
    // that showed the slot answered "1 note" for a tile holding 13.
    const notesOf = new Map<string, unknown[]>([['projects', [
      { text: 'first', tags: ['plan'], children: [{ text: 'under it', children: [] }] },
      { text: 'second', children: [] },
    ]]])
    const getNotesAtSegments = vi.fn(async (segments: readonly string[]) => notesOf.get(segments.join('/')) ?? [])
    const fx = fixture()
    const services = new Map<string, unknown>([
      ['@diamondcoreprocessor.com/HistoryService', fx.history],
      ['@hypercomb.social/Store', { getResource: vi.fn(async () => null) }],
      ['@diamondcoreprocessor.com/LayerCommitter', { settled: fx.settled }],
      ['@diamondcoreprocessor.com/NotesService', { getNotesAtSegments }],
    ])
    const reader = new HypercombHiveTreeReader(<T>(key: string) => services.get(key) as T | undefined)

    const read = await reader.readNode(['projects'], { maxBytes: 8_000, withContent: true })
    expect(read).toMatchObject({ ok: true, notes: ['first [plan]', '  under it', 'second'], noteCount: 2 })
    // A note added without the layer changing is on the next read.
    notesOf.get('projects')!.push({ text: 'third', children: [] })
    expect(await reader.readNode(['projects'], { maxBytes: 8_000, withContent: true })).toMatchObject({ noteCount: 3 })
    const listed = await reader.readNode(['projects'], { maxBytes: 8_000, withContent: false })
    expect(listed.ok && listed.notes).toBeUndefined()
  })

  it('keeps a fallback route and its signature content in memory for the next read', async () => {
    const fx = fixture()
    fx.refs.delete(sig(102))

    const first = await fx.reader.readNode(['projects'], { maxBytes: 8_000, withContent: true })
    expect(first).toMatchObject({ ok: true, name: 'projects', layerSig: sig(2) })
    const headReads = (fx.history['currentLayerRefAt'] as ReturnType<typeof vi.fn>).mock.calls.length
    const layerReads = fx.getLayerBySig.mock.calls.length

    const again = await fx.reader.readNode(['projects'], { maxBytes: 8_000, withContent: true })
    expect(again).toMatchObject({ ok: true, name: 'projects', layerSig: sig(2) })
    expect(again.ok && again.snapshot).toBeUndefined()
    expect((fx.history['currentLayerRefAt'] as ReturnType<typeof vi.fn>).mock.calls.length).toBe(headReads)
    expect(fx.getLayerBySig.mock.calls.length).toBe(layerReads)
  })
})

/** A hive whose root holds `branches` in order, each `{ name, leaves }` a
 *  page with that many leaf tiles under it (layers `sig(50_000 + …)`, no
 *  pinned heads: each opens by the copy its parent carries), or `{ name,
 *  chain }` a line of pages, one under the next, each with a pinned head.
 *  Returns the route of each chain's last page. */
const branchedHive = (
  fx: Fixture,
  branches: readonly ({ readonly name: string; readonly leaves: number } | { readonly name: string; readonly chain: readonly string[] })[],
): Record<string, readonly string[]> => {
  const top: string[] = []
  const ends: Record<string, readonly string[]> = {}
  let next = 50_000
  branches.forEach((branch, b) => {
    const branchSig = sig(40_000 + b)
    let children: string[] = []
    if ('leaves' in branch) {
      children = Array.from({ length: branch.leaves }, (_, i) => {
        const leaf = sig(next++)
        fx.layers.set(leaf, { name: `${branch.name}-${i}`, children: [] })
        return leaf
      })
    } else {
      const route = [branch.name, ...branch.chain]
      ends[branch.name] = route
      let child: string | undefined
      for (let level = route.length - 1; level >= 1; level--) {
        const layerSig = sig(next++)
        const locationSig = sig(next++)
        const layer: LayerContent = { name: route[level], children: child ? [child] : [] }
        fx.layers.set(layerSig, layer)
        fx.locations.set(route.slice(0, level + 1).join('/'), locationSig)
        fx.refs.set(locationSig, { locationSig, layerSig, layer })
        child = layerSig
      }
      children = child ? [child] : []
    }
    const layer: LayerContent = { name: branch.name, children }
    fx.layers.set(branchSig, layer)
    const locationSig = sig(45_000 + b)
    fx.locations.set(branch.name, locationSig)
    fx.refs.set(locationSig, { locationSig, layerSig: branchSig, layer })
    top.push(branchSig)
  })
  const rootLayer: LayerContent = { name: 'hive', children: top }
  fx.layers.set(sig(1), rootLayer)
  fx.refs.set(sig(101), { locationSig: sig(101), layerSig: sig(1), layer: rootLayer })
  return ends
}

describe('a find shares its walk among the route’s branches', () => {
  // The live probe, 2026-10-12 (revision 19d44b5b, a ~5,900-tile hive):
  // level by level across the whole route, the find's 2,000 nodes went on
  // /solomon-maze-v1's and /bubble-bobble-dos-v1's second level, and "find
  // betz /" missed /dolphin/associates/betz, three levels down a small branch.
  it('finds a small branch’s depth-three tile behind a huge branch, on the same budget, and names the huge branch as unfinished', async () => {
    const fx = fixture()
    const ends = branchedHive(fx, [
      { name: 'huge', leaves: 2_100 },
      { name: 'dolphin', chain: ['associates', 'betz'] },
      { name: 'notes', leaves: 3 },
    ])
    const found = await fx.reader.find('betz', [])
    expect(found).toMatchObject({
      ok: true, truncated: true,
      matches: [{ name: 'betz', path: pathOf(ends['dolphin']) }],
      unfinished: ['/huge'], unfinishedCount: 1,
    })
    // The same budget: no more pages opened than a find's 2,000 nodes, and
    // the huge branch cut short, not walked whole.
    const signed = (fx.history['sign'] as ReturnType<typeof vi.fn>).mock.calls
      .map(([lineage]) => (lineage as { explorerSegments(): readonly string[] }).explorerSegments())
    const hugeOpened = signed.filter(path => path.length === 2 && path[0] === 'huge').length
    expect(hugeOpened).toBeGreaterThan(1_900)
    expect(hugeOpened).toBeLessThan(2_000)
    expect(signed.length).toBeLessThanOrEqual(2_000)
    // /tree keeps its level-by-level picture of the hive.
    const tree = await fx.reader.readTree([], { maxDepth: 3 })
    expect(tree.ok && tree.nodes.map(node => node.path).slice(0, 5)).toEqual(['/', '/huge', '/dolphin', '/notes', '/huge/huge-0'])
    expect(tree).not.toHaveProperty('unfinished')
  })

  it('names the first twenty unfinished branches in the route’s order and counts them all', async () => {
    const fx = fixture()
    branchedHive(fx, Array.from({ length: 25 }, (_, b) => ({ name: `b${b}`, leaves: 100 })))
    const found = await fx.reader.find('nothing', [])
    expect(found).toMatchObject({ ok: true, truncated: true, matches: [], unfinishedCount: 25 })
    expect(found.ok && found.unfinished).toEqual(Array.from({ length: 20 }, (_, b) => `/b${b}`))
  })

  it('names under a narrower route its own children, and nothing when the walk finished', async () => {
    const fx = fixture()
    branchedHive(fx, [{ name: 'dolphin', chain: ['associates', 'betz'] }])
    const whole = await fx.reader.find('betz', [])
    expect(whole).toMatchObject({ ok: true, truncated: false })
    expect(whole).not.toHaveProperty('unfinished')

    const games = fixture()
    const page: LayerContent = { name: 'games', children: [sig(40_000), sig(40_001)] }
    branchedHive(games, [{ name: 'solomon', leaves: 2_100 }, { name: 'small', leaves: 2 }])
    games.layers.set(sig(9), page)
    games.locations.set('games', sig(109))
    games.refs.set(sig(109), { locationSig: sig(109), layerSig: sig(9), layer: page })
    // /games/solomon and /games/small open by the copies /games carries.
    const under = await games.reader.find('small-1', ['games'])
    expect(under).toMatchObject({
      ok: true, truncated: true, matches: [{ name: 'small-1', path: '/games/small/small-1' }],
      unfinished: ['/games/solomon'], unfinishedCount: 1,
    })
  })

  it('lists a shared walk’s matches level by level in the route’s order, as a walk that was not shared lists them', async () => {
    // Shared out, the small branch's third level is opened before the big
    // branch's last second-level tiles; the answer still lists the shallower
    // match first.
    const fx = fixture()
    const ends = branchedHive(fx, [
      { name: 'big', leaves: 30 },
      { name: 'small', chain: ['s1', 'big-deep'] },
    ])
    const found = await fx.reader.find('big-', [])
    if (!found.ok) throw new Error('find failed')
    expect(found.truncated).toBe(false)
    expect(found.matches.map(match => match.path)).toEqual([
      ...Array.from({ length: 30 }, (_, i) => `/big/big-${i}`), pathOf(ends['small']),
    ])
  })

  it('names a branch whose page could not be opened, and never a branch it finished', async () => {
    const fx = fixture()
    branchedHive(fx, [{ name: 'gone', leaves: 2 }, { name: 'kept', leaves: 2 }])
    // The root still carries /gone; its own page now holds another tile.
    fx.refs.set(sig(45_000), { locationSig: sig(45_000), layerSig: sig(77), layer: { name: 'elsewhere', children: [] } })
    const found = await fx.reader.find('kept', [])
    expect(found).toMatchObject({
      ok: true, truncated: true,
      matches: [{ name: 'kept', path: '/kept' }, { name: 'kept-0', path: '/kept/kept-0' }, { name: 'kept-1', path: '/kept/kept-1' }],
      unfinished: ['/gone'], unfinishedCount: 1,
    })
  })
})

describe('a walk whose budget is spent stops there', () => {
  // Review of the 2026-10-12 fair walk: the byte cut left only the batch,
  // and the walk carried on — it opened every page still queued (904 for a
  // /tree that once opened 20) and appended later, shorter nodes behind the
  // gap.
  const signedPaths = (fx: Fixture): (readonly string[])[] =>
    (fx.history['sign'] as ReturnType<typeof vi.fn>).mock.calls
      .map(([lineage]) => (lineage as { explorerSegments(): readonly string[] }).explorerSegments())

  it('a /tree cut on bytes in the middle of a batch ends at the first node that does not fit', async () => {
    const fx = fixture()
    const long = (at: number): string => `${'l'.repeat(249)}${at}`
    branchedHive(fx, [
      ...[0, 1, 2].map(at => ({ name: long(at), leaves: 0 })),
      ...Array.from({ length: 20 }, (_, at) => ({ name: `s${at}`, leaves: 0 })),
    ])
    const tree = await fx.reader.readTree([], { maxDepth: 2, maxNodes: 64, maxBytes: 1_024 })
    expect(tree).toMatchObject({ ok: true, truncated: true })
    expect(tree.ok && tree.nodes.map(node => node.path)).toEqual(['/', `/${long(0)}`])
    // The root, then one batch: nothing opened past the cut.
    expect(signedPaths(fx).length).toBeLessThanOrEqual(1 + 16)
  })

  it('a find cut on bytes opens no page past the batch it was cut in, and names the cut branch', async () => {
    const fx = fixture()
    const long = 'w'.repeat(240)
    branchedHive(fx, [{ name: long, leaves: 1_500 }])
    const found = await fx.reader.find('nothing', [])
    expect(found).toMatchObject({ ok: true, truncated: true, matches: [], unfinished: [`/${long}`], unfinishedCount: 1 })
    // About 510 of these nodes fill 400,000 bytes: the root, the branch,
    // the pages kept, and the rest of the one batch the cut fell in.
    expect(signedPaths(fx).length).toBeLessThan(560)
  })
})

describe('a find whose matches outrun its limit says so', () => {
  // Review of the 2026-10-12 fair walk: all 61 hits under a finished /small,
  // 48 shown, and the note named only /huge as unfinished — the 13 unshown
  // matches were in /small.
  it('marks more matches than the limit shows, beside the unfinished branches', async () => {
    const fx = fixture()
    branchedHive(fx, [{ name: 'huge', leaves: 2_100 }, { name: 'small', leaves: 60 }])
    const found = await fx.reader.find('small', [], { maxNodes: 48 })
    expect(found).toMatchObject({ ok: true, truncated: true, unfinished: ['/huge'], unfinishedCount: 1, moreMatches: true })
    expect(found.ok && found.matches.length).toBe(48)
    expect(found.ok && found.matches.every(match => match.path.startsWith('/small'))).toBe(true)

    const within = await fx.reader.find('small-5', [], { maxNodes: 48 })
    expect(within).toMatchObject({ ok: true, truncated: true, unfinished: ['/huge'] })
    expect(within).not.toHaveProperty('moreMatches')
  })
})
