import { describe, expect, it } from 'vitest'
import {
  ActiveGenomeMemo,
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

describe('active genome: a census remembers what it read by signature', () => {
  // 2026-11-12: every run re-read the whole hive (~35,000 store calls on an
  // 11,600-bag hive) and it ran again on every armed optimize pass.
  const build = () => {
    const root = s('a')
    const left = s('b')
    const right = s('c')
    const props = s('d')
    const image = s('e')
    const bee = s('f')
    const layers = new Map<string, { bytes: number; value: Record<string, unknown> }>([
      [root, { bytes: 100, value: { name: '/', children: [left, right], bees: [bee] } }],
      [left, { bytes: 50, value: { name: 'left', properties: [props] } }],
      [right, { bytes: 60, value: { name: 'right' } }],
    ])
    const resources = new Map([
      [props, { bytes: 40, value: { small: { image } } }],
      [image, { bytes: 900 }],
    ])
    const heads = new Map<string, { marker: string; layer: string; bytes: number }>([
      ['', { marker: '00000001', layer: root, bytes: 70 }],
      ['left', { marker: '00000000', layer: left, bytes: 70 }],
      ['right', { marker: '00000000', layer: right, bytes: 70 }],
    ])
    const reads = { layer: 0, resource: 0, bee: 0, head: 0 }
    let beePresent = true
    const source: ActiveGenomeSource = {
      epoch: () => 1,
      root: async () => heads.get('')!.layer,
      lineage: async path => `lineage:${path.join('/')}`,
      layer: async signature => { reads.layer++; return layers.get(signature) ?? null },
      head: async lineage => { reads.head++; return heads.get(lineage.replace('lineage:', '')) ?? null },
      resource: async signature => { reads.resource++; return resources.get(signature) ?? null },
      beeBytes: async signature => { reads.bee++; return beePresent && signature === bee ? 200 : null },
      dependencyBytes: async () => null,
    }
    const reset = () => { reads.layer = 0; reads.resource = 0; reads.bee = 0; reads.head = 0 }
    return { source, reads, reset, layers, heads, setBee: (present: boolean) => { beePresent = present }, s: { root, left, right } }
  }

  it('reads no content at all when nothing changed, and answers the same', async () => {
    const hive = build()
    const memo = new ActiveGenomeMemo()
    const first = await collectActiveGenome(hive.source, memo)
    hive.reset()
    const second = await collectActiveGenome(hive.source, memo)
    expect(second.record).toEqual(first.record)
    expect(hive.reads).toMatchObject({ layer: 0, resource: 0, bee: 0 })
    // Heads are the caller's to vouch for: still asked, one per location.
    expect(hive.reads.head).toBe(3)
  })

  it('after a head moves, reads only the moved location\'s new layer', async () => {
    const hive = build()
    const memo = new ActiveGenomeMemo()
    await collectActiveGenome(hive.source, memo)
    const moved = s('9')
    hive.layers.set(moved, { bytes: 65, value: { name: 'right', notes: [] } })
    hive.heads.set('right', { marker: '00000001', layer: moved, bytes: 70 })
    hive.reset()
    const fresh = await collectActiveGenome(hive.source, new ActiveGenomeMemo())
    hive.reset()
    const { record } = await collectActiveGenome(hive.source, memo)
    expect(hive.reads.layer).toBe(1)
    expect(hive.reads.resource).toBe(0)
    expect(record).toEqual(fresh.record)
    expect(record?.objects.some(object => object.sig === moved)).toBe(true)
  })

  it('never remembers something missing — it is found the moment it arrives', async () => {
    const hive = build()
    const memo = new ActiveGenomeMemo()
    hive.setBee(false)
    const before = await collectActiveGenome(hive.source, memo)
    expect(before.record?.complete).toBe(false)
    hive.setBee(true)
    const after = await collectActiveGenome(hive.source, memo)
    expect(after.record?.complete).toBe(true)
    expect(after.record?.objects.some(object => object.kind === 'bee')).toBe(true)
  })
})

describe('active genome: identities are never missing content', () => {
  // 2026-11-12: all 12 "missing" objects on a real hive were identities —
  // group signatures, creation ids, and a source fingerprint.
  it('counts what a decoration declares, not every hex string inside it', async () => {
    const root = s('a')
    const groupMeta = s('b')
    const groupDecoration = s('c')
    const creationDecoration = s('d')
    const pageDecoration = s('e')
    const html = s('f')
    const groupIdentity = s('1')
    const creationId = s('2')
    const bubbleSource = s('3')
    const layers = new Map([[root, {
      bytes: 100,
      value: {
        name: '/',
        decorations: [groupMeta, creationDecoration, pageDecoration],
        bubbleCampaign: { version: 1, sourceSha256: bubbleSource },
      },
    }]])
    const resources = new Map<string, { bytes: number; value?: unknown }>([
      [groupMeta, { bytes: 30, value: { meta: 1, resource: groupDecoration, relation: 'decorations' } }],
      [groupDecoration, { bytes: 40, value: { kind: 'group', payload: { sig: groupIdentity }, refs: [groupIdentity] } }],
      [creationDecoration, { bytes: 40, value: { kind: 'creation', payload: { id: creationId } } }],
      [pageDecoration, { bytes: 40, value: { kind: 'visual:website:page', payload: { htmlSig: html } } }],
      [html, { bytes: 500 }],
    ])
    const source: ActiveGenomeSource = {
      epoch: () => 1,
      root: async () => root,
      lineage: async path => `lineage:${path.join('/')}`,
      layer: async signature => layers.get(signature) ?? null,
      head: async () => ({ marker: '00000000', layer: root, bytes: 10 }),
      resource: async signature => resources.get(signature) ?? null,
      beeBytes: async () => null,
      dependencyBytes: async () => null,
    }

    const { record } = await collectActiveGenome(source)

    expect(record?.missing).toEqual([])
    expect(record?.complete).toBe(true)
    const sigs = new Set(record?.objects.map(object => object.sig))
    // The records themselves and what they declare travel...
    for (const held of [root, groupMeta, groupDecoration, creationDecoration, pageDecoration, html]) expect(sigs.has(held)).toBe(true)
    // ...identities never do.
    for (const identity of [groupIdentity, creationId, bubbleSource]) expect(sigs.has(identity)).toBe(false)
  })
})
