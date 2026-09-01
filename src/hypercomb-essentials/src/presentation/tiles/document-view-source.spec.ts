import { beforeEach, describe, expect, it } from 'vitest'
import {
  filterDocumentViewItems,
  readDocumentViewItems,
  type DocumentViewHistory,
} from './document-view-source.js'

const A = 'a'.repeat(64)
const A1 = 'b'.repeat(64)
const B = 'c'.repeat(64)
const CONTAINER = 'd'.repeat(64)

describe('readDocumentViewItems', () => {
  beforeEach(() => {
    ;(window as unknown as {
      ioc: { get(): { explorerSegments(): readonly string[] } }
    }).ioc = { get: () => ({ explorerSegments: () => [] }) }
  })

  const history = (): DocumentViewHistory => {
    const bySig = new Map<string, Record<string, unknown>>([
      [A, { name: 'alpha', children: [A1] }],
      [A1, { name: 'detail' }],
      [B, { name: 'beta' }],
    ])
    const heads = new Map<string, Record<string, unknown>>([
      ['loc:root', { children: [A, B] }],
      ['loc:root/alpha', bySig.get(A)!],
      ['loc:root/alpha/detail', bySig.get(A1)!],
      ['loc:root/beta', bySig.get(B)!],
    ])
    return {
      sign: async lineage => `loc:${lineage.explorerSegments?.().join('/') ?? ''}`,
      currentLayerAt: async sig => heads.get(sig) ?? null,
      getLayerBySig: async sig => bySig.get(sig) ?? null,
    }
  }

  const notes = {
    getNotesAtSegments: async (segments: readonly string[]) => [{
      id: segments.join('/'),
      text: segments.at(-1) ?? '',
      shape: null,
      mark: null,
      tags: [],
      children: [],
    }],
  }

  it('reads only direct children in current-layer scope', async () => {
    const items = await readDocumentViewItems({
      history: history(),
      notes,
      segments: ['root'],
      scope: 'layer',
    })

    expect(items.map(item => item.name)).toEqual(['alpha', 'beta'])
    expect(items.map(item => item.depth)).toEqual([0, 0])
  })

  it('walks descendants depth-first and preserves their source paths', async () => {
    const items = await readDocumentViewItems({
      history: history(),
      notes,
      segments: ['root'],
      scope: 'hierarchy',
    })

    expect(items.map(item => item.name)).toEqual(['alpha', 'detail', 'beta'])
    expect(items.map(item => item.depth)).toEqual([0, 1, 0])
    expect(items[1]?.source).toBe('alpha › detail')
    expect(items[1]?.segments).toEqual(['root', 'alpha', 'detail'])
  })

  it('resolves an in-place target through its parent when its own bag is cold', async () => {
    const layers = new Map<string, Record<string, unknown>>([
      [CONTAINER, { name: 'container', children: [B] }],
      [B, { name: 'beta' }],
    ])
    const coldHistory: DocumentViewHistory = {
      sign: async lineage => `loc:${lineage.explorerSegments?.().join('/') ?? ''}`,
      currentLayerAt: async sig => sig === 'loc:' ? { children: [CONTAINER] } : null,
      getLayerBySig: async sig => layers.get(sig) ?? null,
    }

    const items = await readDocumentViewItems({
      history: coldHistory,
      notes,
      segments: ['container'],
      scope: 'layer',
    })

    expect(items.map(item => item.name)).toEqual(['beta'])
  })

  it('filters a curated hierarchy by relative path and distinguishes empty from all', async () => {
    const items = await readDocumentViewItems({
      history: history(),
      notes,
      segments: ['root'],
      scope: 'hierarchy',
    })

    expect(filterDocumentViewItems(items, ['root'], undefined)).toHaveLength(3)
    expect(filterDocumentViewItems(items, ['root'], [])).toEqual([])
    expect(filterDocumentViewItems(items, ['root'], [['alpha', 'detail']])
      .map(item => item.name)).toEqual(['detail'])
  })
})
