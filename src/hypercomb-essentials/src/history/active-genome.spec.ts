import { describe, expect, it } from 'vitest'
import {
  collectActiveGenome,
  type ActiveGenomeSource,
} from './active-genome.js'

const s = (letter: string): string => letter.repeat(64)

describe('active genome', () => {
  it('counts current 00000000 markers and the expanded, deduped closure', async () => {
    const root = s('a')
    const child = s('b')
    const props = s('c')
    const image = s('d')
    const bee = s('e')
    const dep = s('f')
    const layers = new Map([
      [root, {
        bytes: 100,
        value: {
          name: '/',
          children: [child],
          bees: [bee],
          dependencies: [dep],
          // The same image is also reached through properties below; the
          // flat content root must count it once.
          attachments: [image],
        },
      }],
      [child, { bytes: 80, value: { name: 'tile', properties: [props] } }],
    ])
    const resources = new Map([
      [props, { bytes: 40, value: { small: { image } } }],
      [image, { bytes: 1_000 }],
    ])
    const heads = new Map([
      ['', { marker: '00000003', layer: root, bytes: 76 }],
      ['tile', { marker: '00000000', layer: child, bytes: 76 }],
    ])
    const source: ActiveGenomeSource = {
      epoch: () => 7,
      root: async () => root,
      lineage: async path => `lineage:${path.join('/')}`,
      layer: async signature => layers.get(signature) ?? null,
      head: async lineage => heads.get(lineage.replace('lineage:', '')) ?? null,
      resource: async signature => resources.get(signature) ?? null,
      beeBytes: async signature => signature === bee ? 200 : null,
      dependencyBytes: async signature => signature === dep ? 300 : null,
    }

    const { record, stable } = await collectActiveGenome(source)
    expect(stable).toBe(true)
    expect(record?.complete).toBe(true)
    expect(record?.heads.map(head => head.marker)).toContain('00000000')
    expect(record?.totals).toMatchObject({
      lineages: 2,
      objects: 6,
      markerBytes: 152,
      contentBytes: 1_720,
      knownBytes: 1_872,
      activeBytes: 1_872,
    })
  })

  it('refuses to call a partial census exact', async () => {
    const root = s('a')
    const missing = s('b')
    const source: ActiveGenomeSource = {
      epoch: () => 1,
      root: async () => root,
      lineage: async () => 'lineage',
      layer: async signature => signature === root
        ? { bytes: 10, value: { name: '/', properties: [missing] } }
        : null,
      head: async () => ({ marker: '00000000', layer: root, bytes: 5 }),
      resource: async () => null,
      beeBytes: async () => null,
      dependencyBytes: async () => null,
    }

    const { record } = await collectActiveGenome(source)
    expect(record?.complete).toBe(false)
    expect(record?.totals.knownBytes).toBe(15)
    expect(record?.totals.activeBytes).toBeNull()
    expect(record?.missing).toEqual([{ kind: 'resource', sig: missing }])
  })

  it('uses each lineage latest marker instead of the parent-carried generation', async () => {
    const root = s('a')
    const carriedChild = s('b')
    const latestChild = s('c')
    const layers = new Map([
      [root, { bytes: 10, value: { name: '/', children: [carriedChild] } }],
      [carriedChild, { bytes: 20, value: { name: 'tile', note: 'old' } }],
      [latestChild, { bytes: 30, value: { name: 'tile', note: 'current' } }],
    ])
    const source: ActiveGenomeSource = {
      epoch: () => 1,
      root: async () => root,
      lineage: async path => path.join('/') || 'root-lineage',
      layer: async signature => layers.get(signature) ?? null,
      head: async lineage => lineage === 'tile'
        ? { marker: '00000007', layer: latestChild, bytes: 76 }
        : { marker: '00000003', layer: root, bytes: 76 },
      resource: async () => null,
      beeBytes: async () => null,
      dependencyBytes: async () => null,
    }

    const { record } = await collectActiveGenome(source)
    expect(record?.objects.map(object => object.sig)).toContain(latestChild)
    expect(record?.objects.map(object => object.sig)).not.toContain(carriedChild)
    expect(record?.heads.find(head => head.path.join('/') === 'tile')).toMatchObject({
      marker: '00000007',
      layer: latestChild,
    })
  })

  it('marks a collection unstable when a head changes during the walk', async () => {
    const root = s('a')
    let epoch = 1
    const source: ActiveGenomeSource = {
      epoch: () => epoch,
      root: async () => root,
      lineage: async () => 'lineage',
      layer: async () => {
        epoch = 2
        return { bytes: 10, value: { name: '/' } }
      },
      head: async () => null,
      resource: async () => null,
      beeBytes: async () => null,
      dependencyBytes: async () => null,
    }
    expect((await collectActiveGenome(source)).stable).toBe(false)
  })

  // ONLY THE GENOME LEAVES (layer-pattern-audit.md rule 6; jwize 2026-10-18:
  // "only the head identifier is exposed"). A restore point names a whole
  // earlier hive through its `seal`, and a succession names its earlier
  // generation through `prev`. Both are referents: the record itself is
  // current, what it points back at is history.
  it('counts a restore point and a succession, never the past they point at', async () => {
    const root = s('a')
    const snapshot = s('b')
    const oldRoot = s('c')
    const oldChild = s('d')
    const list = s('e')
    const oldList = s('f')
    const layers = new Map([
      [root, { bytes: 100, value: { name: '/', snapshots: [snapshot], properties: [list] } }],
      [oldRoot, { bytes: 90, value: { name: '/', children: [oldChild] } }],
      [oldChild, { bytes: 70, value: { name: 'gone' } }],
    ])
    const resources = new Map<string, { bytes: number; value?: unknown }>([
      [snapshot, { bytes: 60, value: { seal: oldRoot, label: 'before', at: 1 } }],
      [list, { bytes: 50, value: { succession: 1, prev: oldList, members: [] } }],
      [oldList, { bytes: 40, value: { succession: 1, prev: null, members: [] } }],
      [oldRoot, { bytes: 90, value: { name: '/', children: [oldChild] } }],
      [oldChild, { bytes: 70, value: { name: 'gone' } }],
    ])
    const source: ActiveGenomeSource = {
      epoch: () => 1,
      root: async () => root,
      lineage: async path => `lineage:${path.join('/')}`,
      layer: async signature => layers.get(signature) ?? null,
      head: async lineage => lineage === 'lineage:' ? { marker: '00000002', layer: root, bytes: 76 } : null,
      resource: async signature => resources.get(signature) ?? null,
      beeBytes: async () => null,
      dependencyBytes: async () => null,
    }

    const { record } = await collectActiveGenome(source)
    const held = new Set(record?.objects.map(object => object.sig))
    expect(held.has(snapshot)).toBe(true)
    expect(held.has(list)).toBe(true)
    expect(held.has(oldRoot)).toBe(false)
    expect(held.has(oldChild)).toBe(false)
    expect(held.has(oldList)).toBe(false)
    expect(record?.complete).toBe(true)
  })
})
