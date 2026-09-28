// tile-narrowing.spec.ts — WHAT NARROWS THE PAGE, on its own. The lens (OR
// within itself), a reference's requirement (ANDed with it), a gathered set,
// and the walk that turns them into the tiles to paint — tested against a
// small hive, with the renderer as a stub host.
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../commands/decoration-kind-index.js', () => ({ tagsForLabel: (label: string) => label === 'kitchen' ? ['warm'] : [] }))

import { TileNarrowing, type NarrowingHost } from './tile-narrowing.js'

/** A hive: path → { children, tags }. */
const HIVE: Record<string, { children: string[]; tags: string[] }> = {
  '': { children: ['garden', 'kitchen', 'library'], tags: [] },
  'garden': { children: ['rose', 'shed'], tags: ['green'] },
  'garden/rose': { children: [], tags: ['green', 'red'] },
  'garden/shed': { children: [], tags: [] },
  'kitchen': { children: ['oven'], tags: ['warm'] },
  'kitchen/oven': { children: [], tags: ['warm', 'red'] },
  'library': { children: ['atlas'], tags: ['quiet'] },
  'library/atlas': { children: [], tags: [] },
}

const blob = (value: unknown) => ({ text: async () => JSON.stringify(value) }) as unknown as Blob
/** Each layer's properties resource, by a signature-shaped name. */
const pathBySig = new Map<string, string>()
const propsSig = (path: string) => {
  const sig = [...(path || '/')].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').padEnd(64, '0').slice(0, 64)
  pathBySig.set(sig, path)
  return sig
}

const hostAt = (where: string[]) => {
  const here = { segments: [...where] }
  const emitted: [string, unknown][] = []
  const host: NarrowingHost & { here: typeof here; emitted: typeof emitted; repaints: number; went: string[][] } = {
    here, emitted, repaints: 0, went: [],
    segments: () => [...here.segments],
    cachedTags: label => label === 'library' ? ['legacy'] : undefined,
    emit: (effect, payload) => { emitted.push([effect, payload]) },
    repaint() { this.repaints++ },
    requestRender: () => {},
    goRaw(segments) { this.went.push(segments) },
    history: () => ({
      sign: async l => (l.explorerSegments?.() ?? []).join('/'),
      currentLayerAt: async sig => {
        const node = HIVE[sig]
        return node ? { children: node.children, properties: [propsSig(sig)] } : null
      },
      getLayerBySig: async () => null,
    }),
    store: () => ({
      // A layer's properties resource carries its tags (the legacy form the walk reads).
      getResource: async sig => pathBySig.has(sig) ? blob({ tags: HIVE[pathBySig.get(sig)!]?.tags ?? [] }) : null,
    }),
  }
  return host
}

describe('the narrowing', () => {
  it('is inactive until a lens, a requirement or a gather narrows the page', () => {
    const n = new TileNarrowing(hostAt([]))
    expect(n.active).toBe(false)
    expect(n.entry()).toEqual({ flatPaths: {}, filterBlocked: [] })
  })

  it('reads a tile\'s tags from the decoration index and the legacy cache, once each', () => {
    const n = new TileNarrowing(hostAt([]))
    expect(n.tagsFor('kitchen')).toEqual(['warm'])
    expect(n.tagsFor('library')).toEqual(['legacy'])
    const host = hostAt([])
    new TileNarrowing(host).emitRenderTags([{ label: 'kitchen' }, { label: 'library' }, { label: 'garden' }])
    expect(host.emitted).toEqual([['render:tags', { tags: [{ name: 'warm', count: 1 }, { name: 'legacy', count: 1 }], byLabel: { kitchen: ['warm'], library: ['legacy'] } }]])
  })

  it('keys a lens and a requirement apart: a|b is not b|a', () => {
    const a = new TileNarrowing(hostAt([])), b = new TileNarrowing(hostAt([]))
    a.lens = new Set(['red']); b.required = new Set(['red'])
    expect(a.key()).not.toBe(b.key())
  })
})

describe('the walk', () => {
  const walked = async (where: string[], setup: (n: TileNarrowing) => void) => {
    const n = new TileNarrowing(hostAt(where))
    setup(n)
    await n.scan()
    return { n }
  }

  it('a local lens records the page\'s own matches, and counts what lies inside each', async () => {
    const { n } = await walked([], x => { x.lens = new Set(['green', 'warm']); x.scope = 'local' })
    expect(n.results?.map(r => [r.label, r.path.join('/'), r.hasChildren, r.matchesInside])).toEqual([
      ['garden', 'garden', true, 1],
      ['kitchen', 'kitchen', true, 1],
    ])
    expect(n.scanKey).toBe('')
  })

  it('ANDs a requirement with the lens: a tile must meet both', async () => {
    const { n } = await walked([], x => { x.lens = new Set(['green', 'warm']); x.required = new Set(['red']); x.scope = 'children' })
    expect(n.results?.map(r => r.path.join('/'))).toEqual(['garden/rose', 'kitchen/oven'])
  })

  it('a requirement alone still narrows', async () => {
    const { n } = await walked([], x => { x.required = new Set(['quiet']); x.scope = 'children' })
    expect(n.active).toBe(true)
    expect(n.results?.map(r => r.label)).toEqual(['library'])
  })

  it('adopts a flatten: each match\'s home, and which ones hold nothing to enter', () => {
    const n = new TileNarrowing(hostAt([]))
    n.lens = new Set(['x'])
    n.adopt([
      { label: 'garden', dir: null, path: ['garden'], hasChildren: true, matchesInside: 0 },
      { label: 'rose', dir: null, path: ['garden', 'rose'], hasChildren: false, matchesInside: 0 },
    ])
    expect(n.entry()).toEqual({ flatPaths: { garden: ['garden'], rose: ['garden', 'rose'] }, filterBlocked: ['garden'] })
    expect(n.parentOf('rose')).toEqual(['garden'])
    expect(n.parentOf('elsewhere')).toBeNull()
  })
})

describe('what changes it', () => {
  it('a gathered set paints until the participant walks away, then clears', async () => {
    const host = hostAt(['garden'])
    const n = new TileNarrowing(host)
    n.gather('audit', [{ label: 'rose', path: ['garden', 'rose'] }, { label: '' }])
    expect(n.active).toBe(true)
    expect(n.results?.map(r => [r.label, r.hasChildren])).toEqual([['rose', true]])
    expect(host.emitted.at(-1)).toEqual(['render:gathered', { active: true, count: 1, key: 'audit' }])
    await n.settle()
    expect(n.active).toBe(true)
    host.here.segments = ['kitchen']
    await n.settle()
    expect(n.active).toBe(false)
    expect(n.results).toBeNull()
    expect(host.emitted.at(-1)).toEqual(['render:gathered', { active: false, count: 0 }])
  })

  it('settling drops the last flatten\'s paths, so an ordinary page never inherits them', async () => {
    const n = new TileNarrowing(hostAt([]))
    n.adopt([{ label: 'rose', dir: null, path: ['garden', 'rose'], hasChildren: false, matchesInside: 0 }])
    await n.settle()
    expect(n.parentOf('rose')).toBeNull()
  })

  it('clearing the lens returns you to where you opened it, only if it never moved you', () => {
    const host = hostAt(['garden'])
    const n = new TileNarrowing(host)
    n.filter(['green'], 'global')
    n.filter([], undefined)
    expect(host.went).toEqual([['garden']])

    const moved = hostAt(['garden'])
    const m = new TileNarrowing(moved)
    m.filter(['green'], 'global')
    moved.here.segments = ['garden', 'rose']
    m.filter([], undefined)
    expect(moved.went).toEqual([])
  })

  it('an unchanged requirement changes nothing', () => {
    const host = hostAt([])
    const n = new TileNarrowing(host)
    n.require(['red'])
    const before = host.repaints
    n.require([' red '])
    expect(host.repaints).toBe(before)
  })
})
