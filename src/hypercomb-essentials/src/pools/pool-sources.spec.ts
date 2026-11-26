// pools/pool-sources.spec.ts : which hosts a hive draws from, against a store
// that behaves like the real one where it matters: `openPool` never creates,
// and a document kept as 'current' replaces the one before it. Then the nodes
// the shelf carries beside the hosts: the room's participants, and what is
// announced once both are on one strip.

import { describe, expect, it } from 'vitest'
import {
  SOURCES_MEANING,
  followedZones,
  readSourcesOff,
  sourceDomainNodes,
  sourceParticipantNodes,
  sourcesState,
  sourcesStateOf,
  toggleSource,
  toggleSourceNode,
  writeSourcesOff,
  type SourcesStore,
} from './pool-sources.js'
import { poolNodeKey, type PoolNode } from './pool-node.js'

const enc = new TextEncoder()
const buffer = (text: string): ArrayBuffer => enc.encode(text).slice().buffer as ArrayBuffer

/** A store of pools, each holding one current document, and a log of what was asked of it. */
const fakeStore = () => {
  const pools = new Map<string, { doc: ArrayBuffer | null }>()
  const log: string[] = []
  const store: SourcesStore = {
    openPool: async meaning => { log.push(`open ${meaning}`); return pools.get(meaning) ?? null },
    getPool: async meaning => {
      log.push(`get ${meaning}`)
      if (!pools.has(meaning)) pools.set(meaning, { doc: null })
      return pools.get(meaning)!
    },
    getPoolDoc: async pool => (pool as { doc: ArrayBuffer | null }).doc,
    putPoolDoc: async (pool, bytes, subKey, options) => {
      log.push(`put ${subKey ?? '-'} ${options?.keep ?? 'versions'}`)
      ;(pool as { doc: ArrayBuffer | null }).doc = bytes
      return 'written'
    },
  }
  return { store, pools, log }
}

describe('followedZones', () => {
  it('names the own host first, then the followed hosts, each as its zone and once', async () => {
    const zones = await followedZones({
      ownHost: () => 'Mine.Example',
      followed: async () => ['content.b.example', 'a.example', 'https://MINE.example/', 'b.example', 'localhost:4270'],
    })
    expect(zones).toEqual(['mine.example', 'b.example', 'a.example', 'localhost:4270'])
  })

  it('draws from the followed hosts alone when no host is named, and drops what is not a host', async () => {
    expect(await followedZones({ ownHost: () => '', followed: async () => ['a.example', 'not a host', ''] })).toEqual(['a.example'])
  })

  it('names at most sixteen hosts', async () => {
    const followed = Array.from({ length: 20 }, (_, at) => `h${at}.example`)
    const zones = await followedZones({ ownHost: () => 'mine.example', followed: async () => followed })
    expect(zones).toHaveLength(16)
    expect(zones[0]).toBe('mine.example')
  })

  it('answers the own host alone when the followed hosts cannot be read', async () => {
    expect(await followedZones({ ownHost: () => 'mine.example', followed: async () => { throw new Error('closed') } })).toEqual(['mine.example'])
    expect(await followedZones({ ownHost: () => { throw new Error('no service') }, followed: async () => [] })).toEqual([])
  })
})

describe('the off list, kept', () => {
  it('reads nothing off before anything was written, and never creates the pool', async () => {
    const { store, pools, log } = fakeStore()
    expect(await readSourcesOff(store)).toEqual([])
    expect(pools.size).toBe(0)
    expect(log).toEqual([`open ${SOURCES_MEANING}`])
  })

  it('writes one current document and reads it back', async () => {
    const { store, pools, log } = fakeStore()
    expect(await writeSourcesOff(store, ['B.example', 'content.a.example', 'b.example'])).toBe(true)
    expect(new TextDecoder().decode(pools.get(SOURCES_MEANING)!.doc!)).toBe('{"off":["b.example","a.example"]}')
    expect(log).toContain('put - current')
    expect(await readSourcesOff(store)).toEqual(['b.example', 'a.example'])

    expect(await writeSourcesOff(store, [])).toBe(true)
    expect(await readSourcesOff(store)).toEqual([])
  })

  it('reads a document that is not an off list as nothing off', async () => {
    const { store, pools } = fakeStore()
    for (const text of ['not json', '[]', '{"off":"all"}', 'null', '{"off":[1,"not a host","a.example"]}']) {
      pools.set(SOURCES_MEANING, { doc: buffer(text) })
      expect(await readSourcesOff(store)).toEqual(text.includes('a.example') ? ['a.example'] : [])
    }
  })

  it('answers with nothing, and false, where the store is missing or refuses', async () => {
    expect(await readSourcesOff({})).toEqual([])
    expect(await writeSourcesOff({}, ['a.example'])).toBe(false)
    expect(await readSourcesOff({ openPool: async () => { throw new Error('closed') }, getPoolDoc: async () => null })).toEqual([])
    expect(await writeSourcesOff({ getPool: async () => null, putPoolDoc: async () => 'written' }, ['a.example'])).toBe(false)
    expect(await writeSourcesOff({ getPool: async () => ({}), putPoolDoc: async () => null }, ['a.example'])).toBe(false)
  })

  it('waits for the store to open before it reads or writes', async () => {
    const { store, log } = fakeStore()
    store.initialize = async () => { log.push('initialize') }
    await readSourcesOff(store)
    await writeSourcesOff(store, ['a.example'])
    expect(log).toEqual(['initialize', `open ${SOURCES_MEANING}`, 'initialize', `get ${SOURCES_MEANING}`, 'put - current'])
  })
})

describe('sourcesState', () => {
  it('is every host, the ones that are on in the order followed, and the words searched for', () => {
    expect(sourcesState(['mine.example', 'a.example', 'b.example'], ['A.example', 'gone.example'], '  Sourdough  ')).toEqual({
      zones: ['mine.example', 'b.example'],
      all: ['mine.example', 'a.example', 'b.example'],
      query: 'sourdough',
    })
  })

  it('has every host on by default, and keeps the search to eighty characters', () => {
    const state = sourcesState(['a.example'], [], 'x'.repeat(200))
    expect(state.zones).toEqual(['a.example'])
    expect(state.query).toHaveLength(80)
  })
})

describe('toggleSource', () => {
  it('switches a host off, and on again', () => {
    const off = toggleSource([], 'A.example')
    expect(off).toEqual(['a.example'])
    expect(toggleSource(off, 'content.a.example')).toEqual([])
    expect(toggleSource(['a.example'], 'b.example')).toEqual(['a.example', 'b.example'])
  })

  it('leaves the list as it is for words that name no host', () => {
    expect(toggleSource(['a.example'], 'not a host')).toEqual(['a.example'])
  })
})

const ANA: PoolNode = { kind: 'participant', id: 'e3'.repeat(32), name: 'Ana Maria Lopez' }
const BEN: PoolNode = { kind: 'participant', id: 'f4'.repeat(32), name: 'Ben Okri' }
const ME: PoolNode = { kind: 'participant', id: '9a'.repeat(32), name: 'Jaime', you: true }

describe('sourceDomainNodes', () => {
  it('is the followed hosts as nodes, once each in the order followed, the own host marked', () => {
    expect(sourceDomainNodes(['mine.example', 'a.example', 'mine.example', 'b.example'], 'mine.example')).toEqual([
      { kind: 'domain', id: 'mine.example', you: true },
      { kind: 'domain', id: 'a.example' },
      { kind: 'domain', id: 'b.example' },
    ])
  })

  it('marks nobody when no host is named', () => {
    expect(sourceDomainNodes(['a.example'])).toEqual([{ kind: 'domain', id: 'a.example' }])
    expect(sourceDomainNodes([], 'mine.example')).toEqual([])
  })
})

describe('sourceParticipantNodes', () => {
  it('keeps participants only, each once, the reader\'s own first', () => {
    expect(sourceParticipantNodes([ANA, { kind: 'domain', id: 'a.example' }, BEN, ME, ANA])).toEqual([ME, ANA, BEN])
  })

  it('gives a node mentioned twice the name it gained, and keeps its place', () => {
    expect(sourceParticipantNodes([{ kind: 'participant', id: ANA.id }, BEN, ANA])).toEqual([ANA, BEN])
  })

  it('leaves out what is not a node, and a key that could not be a key', () => {
    expect(sourceParticipantNodes([
      null, 'ana', 7, {}, { kind: 'participant' }, { kind: 'participant', id: 7 }, { kind: 'participant', id: '' },
      { kind: 'participant', id: 'two words' }, { kind: 'participant', id: 'line\nbreak' }, { kind: 'participant', id: 'x'.repeat(129) },
    ])).toEqual([])
    for (const raw of [undefined, null, 'everybody', { nodes: [ANA] }, 12]) expect(sourceParticipantNodes(raw)).toEqual([])
  })

  it('takes a name as one plain line of at most eighty characters, and never anything but true for you', () => {
    const [named, long, blank, flagged] = sourceParticipantNodes([
      { kind: 'participant', id: 'a1', name: '  Ana\n\tMaria \u0000 Lopez  ' },
      { kind: 'participant', id: 'b2', name: 'x'.repeat(200) },
      { kind: 'participant', id: 'c3', name: '   ', you: 'yes' },
      { kind: 'participant', id: 'd4', name: 12, extra: 'dropped' },
    ])
    expect(named).toEqual({ kind: 'participant', id: 'a1', name: 'Ana Maria Lopez' })
    expect(long?.name).toHaveLength(80)
    expect(blank).toEqual({ kind: 'participant', id: 'c3' })
    expect(flagged).toEqual({ kind: 'participant', id: 'd4' })
  })

  it('reads a room without end by its first five hundred and twelve', () => {
    const crowd = Array.from({ length: 600 }, (_, at) => ({ kind: 'participant', id: `key${at}` }))
    expect(sourceParticipantNodes(crowd)).toHaveLength(512)
  })
})

describe('sourcesStateOf', () => {
  const domains = sourceDomainNodes(['mine.example', 'a.example', 'b.example'], 'mine.example')

  it('says zones, all and query exactly as sourcesState does for the domains alone', () => {
    const state = sourcesStateOf(domains, [ANA, BEN], ['domain:A.example', 'domain:gone.example', poolNodeKey(BEN)], '  Sourdough  ')
    const before = sourcesState(['mine.example', 'a.example', 'b.example'], ['A.example', 'gone.example'], '  Sourdough  ')
    expect({ zones: state.zones, all: state.all, query: state.query }).toEqual(before)
  })

  it('adds every node that is on, the domains then the participants, and every node', () => {
    const state = sourcesStateOf(domains, [ME, ANA, BEN], ['domain:a.example', poolNodeKey(ANA)], '')
    expect(state.nodes).toEqual([{ kind: 'domain', id: 'mine.example', you: true }, { kind: 'domain', id: 'b.example' }, ME, BEN])
    expect(state.allNodes).toEqual([...domains, ME, ANA, BEN])
  })

  it('has everything on by default, and nothing at all with nobody to draw from', () => {
    expect(sourcesStateOf(domains, [ANA], [], '').nodes).toEqual([...domains, ANA])
    expect(sourcesStateOf([], [], [], '')).toEqual({ zones: [], all: [], query: '', nodes: [], allNodes: [] })
  })

  it('never takes a node of one kind for the other', () => {
    const state = sourcesStateOf([...domains, ANA], [BEN, { kind: 'domain', id: 'c.example' }], [], '')
    expect(state.all).toEqual(['mine.example', 'a.example', 'b.example'])
    expect(state.allNodes).toEqual([...domains, BEN])
    // A participant is switched by its own key: a domain key that spells the same id leaves it on.
    expect(sourcesStateOf([], [ANA], [`domain:${ANA.id}`], '').nodes).toEqual([ANA])
  })
})

describe('toggleSourceNode', () => {
  it('switches a node off by its key, and on again', () => {
    const off = toggleSourceNode([], ANA)
    expect(off).toEqual([`participant:${ANA.id}`])
    expect(toggleSourceNode(off, BEN)).toEqual([`participant:${ANA.id}`, `participant:${BEN.id}`])
    expect(toggleSourceNode(off, ANA)).toEqual([])
  })

  it('tells a participant and a domain with the same id apart, and never changes the list it was given', () => {
    const given = Object.freeze(['domain:same'])
    expect(toggleSourceNode(given, { kind: 'participant', id: 'same' })).toEqual(['domain:same', 'participant:same'])
    expect(given).toEqual(['domain:same'])
  })
})
