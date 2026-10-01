import { describe, expect, it, vi } from 'vitest'
import { HypercombHiveTreeReader } from './hive-tree-reader.js'
import type { CurrentLayerRef, LayerContent } from '../history/history.service.js'

// THE SNAPSHOT TABLE HOLDS A WHOLE LEG. A leg revalidates the reads it made,
// and one leg is twelve rounds of eight reads plus a front-door listing. At
// a table of 32 the reader dropped the leg's own earlier reads and the leg
// was told the tree had changed when nothing had.

const sig = (n: number): string => n.toString(16).padStart(64, '0')

const fixture = () => {
  const root: LayerContent = { name: 'hive', children: [sig(2)] }
  const projects: LayerContent = { name: 'projects', children: [] }
  const layers = new Map<string, LayerContent>([[sig(1), root], [sig(2), projects]])
  const locations = new Map<string, string>([['', sig(101)], ['projects', sig(102)]])
  const refs = new Map<string, CurrentLayerRef>([
    [sig(101), { locationSig: sig(101), layerSig: sig(1), layer: root }],
    [sig(102), { locationSig: sig(102), layerSig: sig(2), layer: projects }],
  ])
  const history = {
    sign: vi.fn(async (lineage: { explorerSegments(): readonly string[] }) =>
      locations.get(lineage.explorerSegments().join('/')) ?? sig(999)),
    currentLayerRefAt: vi.fn(async (location: string) => refs.get(location) ?? null),
    getLayerBySig: vi.fn(async (signature: string) => layers.get(signature) ?? null),
    treeEpoch: () => 7,
  }
  const services = new Map<string, unknown>([
    ['@diamondcoreprocessor.com/HistoryService', history],
    ['@hypercomb.social/Store', { getResource: vi.fn(async () => null) }],
    ['@diamondcoreprocessor.com/LayerCommitter', { settled: vi.fn(async () => {}) }],
  ])
  const reader = new HypercombHiveTreeReader((<T>(key: string): T | undefined => services.get(key) as T | undefined))
  const read = async (): Promise<string> => {
    const result = await reader.readNode(['projects'], { maxBytes: 8_000, withContent: true })
    if (!result.ok || !result.snapshot) throw new Error('the fixture read failed')
    return result.snapshot
  }
  return { reader, refs, read }
}

describe('the snapshot table', () => {
  it('keeps every read of a full leg, so an unchanged tree still validates', async () => {
    const fx = fixture()
    const ids: string[] = []
    // Twelve rounds of eight reads, and the front door's listing.
    for (let at = 0; at < 12 * 8 + 1; at++) ids.push(await fx.read())
    expect(new Set(ids).size).toBe(ids.length)
    expect(await fx.reader.validateSnapshots(ids)).toBe(true)
  })

  it('still sees a head that moved, however many reads the leg made', async () => {
    const fx = fixture()
    const ids: string[] = []
    for (let at = 0; at < 12 * 8 + 1; at++) ids.push(await fx.read())
    const projects = fx.refs.get(sig(102))!
    fx.refs.set(sig(102), { ...projects, layerSig: sig(77) })
    expect(await fx.reader.validateSnapshots(ids)).toBe(false)
    expect(await fx.reader.validateSnapshots(ids.slice(-8))).toBe(false)
  })

  it('is still bounded: the oldest falls out, the newest stay', async () => {
    const fx = fixture()
    const ids: string[] = []
    for (let at = 0; at < 300; at++) ids.push(await fx.read())
    expect(await fx.reader.validateSnapshots([ids[0]])).toBe(false)
    // What the window keeps for a leg — its newest sixty-four, with a block
    // of eight more on top — sits well inside the table.
    expect(await fx.reader.validateSnapshots(ids.slice(-72))).toBe(true)
  })
})
