// A model explores a tile name across every host this hive can ask: what
// other hives contributed or published under it. It names a name, never a
// host, and nothing of this hive goes out but the name's address.

import { describe, expect, it, vi } from 'vitest'
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
      { sig: sig(1), by: ALICE, hosts: ['one.test', 'two.test'] },
      { sig: sig(2), by: BOB, hosts: ['one.test'] },
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
