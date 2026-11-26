// A model explores a tile name across every host this hive can ask: what
// other hives contributed or published under it. It names a name, never a
// host, and nothing of this hive goes out but the name's address.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { forgetFoundHosts, foundHostsOf } from './found-hosts.js'
import { readExplore, type ExploreReadDeps } from './hive-explore-read.js'
import type { FeedDeps } from '../sharing/need-feeds.js'
import { needListKey, needListPoolAddress } from '../sharing/need-lists.js'
import { picturesKey, picturesPoolAddress } from '../sharing/picture-pools.js'
import type { PoolListing } from '../sharing/pool-listing.js'

const sig = (n: number): string => n.toString(16).padStart(64, '0')
const ALICE = 'a'.repeat(64)
const BOB = 'b'.repeat(64)

type Pools = { list?: PoolListing; tile?: PoolListing }

/** one.test lists Alice (a contributed list and a published tile) and Bob (a
 *  published tile); two.test lists Alice's tile too; three.test holds nothing;
 *  four.test never answers. */
const world = async (asked: string[] = []): Promise<ExploreReadDeps> => {
  const tileKey = (await picturesKey('recipes'))!
  const tileAddress = (await picturesPoolAddress('recipes'))!
  const listKey = (await needListKey('recipes'))!
  const listAddress = (await needListPoolAddress('recipes'))!
  const docs: Record<string, Record<string, unknown>> = {
    [sig(1)]: { name: 'recipes', children: [sig(11), sig(12)] },
    [sig(11)]: { name: 'Soup' },
    [sig(12)]: { name: 'bread' },
    [sig(2)]: { name: 'recipes', children: [sig(21), sig(22)] },
    [sig(21)]: { name: 'soup' },
    [sig(22)]: { name: 'bad\u0007name' },
    [sig(3)]: { kind: 'need-list', name: 'recipes', values: ['Stew', 'soup'], at: 1 },
  }
  const indexes: Record<string, Record<string, unknown>> = {
    [`one.test|${ALICE}`]: { [tileKey]: sig(1), [listKey]: sig(3) },
    [`one.test|${BOB}`]: { [tileKey]: sig(2) },
    [`two.test|${ALICE}`]: { [tileKey]: sig(1) },
  }
  const pools: Record<string, Pools> = {
    'one.test': { list: { state: 'listed', text: ALICE }, tile: { state: 'listed', text: [ALICE, BOB].join('\n') } },
    'two.test': { tile: { state: 'listed', text: ALICE } },
    'three.test': {},
    'four.test': { list: { state: 'silent' }, tile: { state: 'silent' } },
  }
  const feed = (hosts: readonly string[]): FeedDeps => ({
    hosts: () => hosts,
    listing: async (host, address) => {
      asked.push(`${host} ${address}`)
      const held = pools[host] ?? {}
      if (address === listAddress) return held.list ?? { state: 'absent' }
      if (address === tileAddress) return held.tile ?? { state: 'absent' }
      return { state: 'absent' }
    },
    roots: async (host, pubkey) => indexes[`${host}|${pubkey}`] ?? null,
    readJson: async s => docs[s] ?? null,
    now: () => 0,
  })
  return { hosts: async () => ['two.test', 'one.test', 'four.test', 'three.test'], feed }
}

describe('a name, explored across the hosts', () => {
  it('merges what every host holds for the name and says what each host said', async () => {
    const read = await readExplore('recipes', {}, await world())
    if (!read.ok) throw new Error('unreachable')
    expect(read).toMatchObject({ root: 'explore recipes', name: 'recipes', truncated: false })
    expect(read.hosts).toEqual([
      { host: 'four.test', state: 'silent', values: 0, publishers: 0 },
      { host: 'one.test', state: 'answered', values: 6, publishers: 2 },
      { host: 'three.test', state: 'empty', values: 0, publishers: 0 },
      { host: 'two.test', state: 'answered', values: 2, publishers: 1 },
    ])
    // Folded by case, most-fed first; a value holding a control character is dropped.
    expect(read.values[0]).toEqual({ text: 'soup', hosts: ['one.test', 'two.test'], publishers: 2, via: ['offer', 'tile'] })
    expect(read.values.map(value => value.text).sort()).toEqual(['Stew', 'bread', 'soup'])
    expect(read.total).toBe(3)
  })

  it('names the published tiles by signature, each with the hosts that led to it', async () => {
    const read = await readExplore('recipes', {}, await world())
    if (!read.ok) throw new Error('unreachable')
    // Alice's tile is on two hosts, so it comes first; a contributed list is not a tile.
    expect(read.tiles).toEqual([
      { sig: sig(1), by: ALICE, hosts: ['one.test', 'two.test'], via: 'tile' },
      { sig: sig(2), by: BOB, hosts: ['one.test'], via: 'tile' },
    ])
  })

  it('sends a host nothing but the two pool addresses derived from the name', async () => {
    const asked: string[] = []
    await readExplore('  Recipes ', {}, await world(asked))
    const addresses = new Set(asked.map(line => line.split(' ')[1]))
    expect([...addresses].sort()).toEqual([(await needListPoolAddress('recipes'))!, (await picturesPoolAddress('recipes'))!].sort())
  })

  it('asks nobody for a route, an address, or anything that is not one tile name', async () => {
    const hosts = vi.fn(async () => ['one.test'])
    const deps = { ...(await world()), hosts }
    for (const raw of ['', '/recipes', 'a/b', 'https://evil.example', 'back\\slash', 'x'.repeat(65)]) {
      expect(await readExplore(raw, {}, deps)).toMatchObject({ ok: false, code: 'not-a-name' })
    }
    expect(hosts).not.toHaveBeenCalled()
  })

  it('says so when the hive can ask no hosts', async () => {
    expect(await readExplore('recipes', {}, { ...(await world()), hosts: async () => [] }))
      .toEqual({ ok: false, root: 'explore recipes', code: 'no-hosts' })
  })
})

describe('where a tile was found is attributed (reach A4)', () => {
  afterEach(() => { forgetFoundHosts(); delete (globalThis as { ioc?: unknown }).ioc })

  it('tells the broker each tile with the hosts whose feed led to it, and remembers it for take', async () => {
    const noted: [string, string[]][] = []
    ;(globalThis as { ioc?: unknown }).ioc = {
      get: (key: string) => key === '@diamondcoreprocessor.com/ContentBrokerDrone'
        ? { hintDomainsForSig: (s: string, hosts: string[]) => { noted.push([s, hosts]) } }
        : undefined,
    }
    await readExplore('recipes', {}, await world())
    expect(noted).toContainEqual([sig(1), ['one.test', 'two.test']])
    expect(noted).toContainEqual([sig(2), ['one.test']])
    expect(foundHostsOf(sig(1))).toEqual(['one.test', 'two.test'])
  })
})

describe('a published creation that wears no picture (reach A5)', () => {
  afterEach(() => { forgetFoundHosts() })

  it('is found among what the hosts published when both pools are empty', async () => {
    const HEAD = 'd'.repeat(64)
    const ledger = JSON.stringify({ sites: [
      { host: 'hyperdex.one.test', lineage: 'knowledge/hyperdex', publishers: [{ pubkey: ALICE, head: HEAD }] },
      { host: 'other.one.test', lineage: 'knowledge/hyperdex-two', publishers: [{ pubkey: BOB, head: sig(9) }] },
    ] })
    const note = vi.fn()
    const read = await readExplore('hyperdex', {}, {
      hosts: async () => ['one.test'],
      note,
      feed: hosts => ({
        hosts: () => hosts,
        listing: async () => ({ state: 'absent' }),
        // The ledger says where to look; Alice's own signed index says it is her head.
        roots: async (host, pubkey) => (host === 'one.test' && pubkey === ALICE ? { 'knowledge/hyperdex': HEAD } : null),
        readJson: async () => null,
        now: () => 0,
        document: async () => ledger,
      }),
    })
    if (!read.ok) throw new Error('unreachable')
    expect(read.tiles).toEqual([{ sig: HEAD, by: ALICE, hosts: ['hyperdex.one.test', 'one.test'], via: 'publication' }])
    expect(note).toHaveBeenCalledWith(HEAD, ['hyperdex.one.test', 'one.test'])
  })

  it('the fallback gets what the feeds left of the deadline, never a second window', async () => {
    const started = Date.now()
    const read = await readExplore('hyperdex', { deadlineMs: 400 }, {
      hosts: async () => ['slow.test'],
      note: () => {},
      feed: hosts => ({
        hosts: () => hosts,
        // The pools take most of the window to say they are empty.
        listing: async () => { await new Promise(resolve => setTimeout(resolve, 300)); return { state: 'absent' } },
        roots: async () => null,
        readJson: async () => null,
        now: () => Date.now(),
        // The ledger never answers.
        document: () => new Promise<string | null>(() => {}),
      }),
    })
    expect(read.ok).toBe(true)
    // One 400 ms window for the whole read, not 300 + 400.
    expect(Date.now() - started).toBeLessThan(600)
  })

  it('a stop during the fallback ends the read at once, and begins no further read', async () => {
    const stop = new AbortController()
    const asked: string[] = []
    const reading = readExplore('hyperdex', { signal: stop.signal }, {
      hosts: async () => ['one.test', 'two.test'],
      note: () => {},
      feed: hosts => ({
        hosts: () => hosts,
        listing: async (host, address) => { asked.push(`listing ${host} ${address.slice(0, 8)}`); return { state: 'absent' } },
        roots: async () => null,
        readJson: async () => null,
        now: () => 0,
        // one.test's ledger hangs; the stop lands while it does.
        document: (host) => {
          asked.push(`document ${host}`)
          if (host === 'one.test') queueMicrotask(() => stop.abort())
          return new Promise<string | null>(() => {})
        },
        member: async () => null,
      }),
    })
    const started = Date.now()
    await expect(reading).rejects.toMatchObject({ name: 'AbortError' })
    // Held for no host's deadline (15 s by default).
    expect(Date.now() - started).toBeLessThan(1_000)
    const after = asked.length
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(asked.length).toBe(after)
  })
})
