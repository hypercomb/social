// recents-census.service.spec.ts — the bag census: a cut tile is found from its
// bag; a live tile is not reported, by sig or by location; pools and husks are
// skipped; the budget stops cleanly and the next pass finishes; and the reader
// reads the session's hides from the list every hide gesture writes.

import { beforeEach, describe, expect, it } from 'vitest'
import { RECENTS_DERIVATION, type CensusRecord } from './recents-census'
import { RecentsCensusService } from './recents-census.service'
import { sessionHideStore } from '../presentation/tiles/session-hide.store'

const sig = (c: string): string => c.repeat(64)
const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))

const ROOT = sig('a')
const LIVE = sig('b')

const record: CensusRecord = {
  v: RECENTS_DERIVATION,
  entries: [
    { sig: ROOT, label: '/', path: [], at: 1 },
    { sig: LIVE, label: 'live', path: ['live'], at: 2 },
  ],
}

let heads: Map<string, string>
let layers: Map<string, unknown>
let markers: Map<string, { at?: number }[]>
let listed: string[]

beforeEach(() => {
  heads = new Map()
  layers = new Map()
  markers = new Map()
  listed = []
  sessionHideStore.removeItem('hc:hidden-lineages')
  const history = {
    sign: async (l: { explorerSegments: () => readonly string[] }) => `loc:${l.explorerSegments().join('/')}`,
    headLayer: async () => ({ layerSig: ROOT }),
    listLayers: async (location: string) => { listed.push(location); return markers.get(location) ?? [] },
    knownHeads: () => heads,
  }
  const store = {
    getPool: async () => null,
    getLayerBytes: async (s: string) => (layers.has(s) ? encode(layers.get(s)) : null),
  }
  ;(window as unknown as { ioc: unknown }).ioc = {
    get: (key: string) => (key.endsWith('HistoryService') ? history : key.endsWith('/Store') ? store : undefined),
  }
})

const addCut = (lineage: string, head: string, name: string, at: number): void => {
  heads.set(lineage, head)
  layers.set(head, { name, children: [] })
  markers.set(lineage, [{ at: at + 5 }, { at }])
}

describe('the bag census', () => {
  it('finds a tile no page lists, at its earliest marker', async () => {
    const service = new RecentsCensusService()
    addCut('lost-bag', sig('c'), 'lost', 10)
    expect(await service.unlistedPass(ROOT, record, { nodes: 10 })).toBe(true)
    const unlisted = (await gatherUnlisted(service))
    expect(unlisted).toEqual([expect.objectContaining({ sig: sig('c'), label: 'lost', path: [], at: 10, placed: false })])
  })

  it('does not report a live tile whose head differs from the sig its parent lists', async () => {
    const service = new RecentsCensusService()
    addCut('loc:live', sig('d'), 'live', 10)
    await service.unlistedPass(ROOT, record, { nodes: 10 })
    expect(await gatherUnlisted(service)).toEqual([])
  })

  it('does not report a moved tile: its old bag holds a sig the root reaches', async () => {
    const service = new RecentsCensusService()
    addCut('old-bag', LIVE, 'live', 10)
    await service.unlistedPass(ROOT, record, { nodes: 10 })
    expect(await gatherUnlisted(service)).toEqual([])
  })

  it('skips a husk and a head with no name', async () => {
    const service = new RecentsCensusService()
    heads.set('husk-bag', sig('e'))
    layers.set(sig('e'), { name: 'husk' })
    markers.set('husk-bag', [{ at: 3 }])
    heads.set('nameless-bag', sig('f'))
    layers.set(sig('f'), { turns: [] })
    markers.set('nameless-bag', [{ at: 3 }])
    await service.unlistedPass(ROOT, record, { nodes: 10 })
    expect(await gatherUnlisted(service)).toEqual([])
  })

  it('stops at the budget and finishes on the next pass without re-reading a bag', async () => {
    const service = new RecentsCensusService()
    addCut('one', sig('c'), 'one', 10)
    addCut('two', sig('d'), 'two', 20)
    expect(await service.unlistedPass(ROOT, record, { nodes: 1 })).toBe(false)
    expect(await service.unlistedPass(ROOT, record, { nodes: 1 })).toBe(true)
    expect(listed.filter(l => l === 'one')).toHaveLength(1)
    expect((await gatherUnlisted(service)).map(a => a.label)).toEqual(['two', 'one'])
  })

  it('counts one atom once when two bags hold the same head', async () => {
    const service = new RecentsCensusService()
    addCut('path-bag', sig('c'), 'same', 30)
    addCut('molecule-bag', sig('c'), 'same', 10)
    await service.unlistedPass(ROOT, record, { nodes: 10 })
    const unlisted = await gatherUnlisted(service)
    expect(unlisted).toHaveLength(1)
    expect(unlisted[0]!.at).toBe(10)
  })
})

/** The reader's answer, with the census record served from the memo path. */
const gatherUnlisted = async (service: RecentsCensusService) => {
  const census = service.census
  ;(service as unknown as { census: () => Promise<CensusRecord> }).census = async () => record
  const atoms = await service.atoms()
  ;(service as unknown as { census: typeof census }).census = census
  return atoms.filter(a => !a.placed)
}

describe('hides', () => {
  it('reads the session list every hide gesture writes', async () => {
    const service = new RecentsCensusService()
    sessionHideStore.setItem('hc:hidden-lineages', JSON.stringify(['live']))
    ;(service as unknown as { census: () => Promise<CensusRecord> }).census = async () => record
    expect((await service.atoms())[0]).toMatchObject({ label: 'live', hidden: true })
  })
})
