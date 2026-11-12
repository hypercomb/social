import { describe, expect, it } from 'vitest'
import { feedNeed, mergeFeeds, type Feed, type FeedDeps } from './need-feeds.js'
import { needListKey, needListPoolAddress } from './need-lists.js'
import { picturesKey, picturesPoolAddress } from './picture-pools.js'
import type { PoolListing } from './pool-listing.js'

const sig = (n: number): string => n.toString(16).padStart(64, '0')

const ALICE = sig(0xa1)
const BOB = sig(0xb0)
const CAROL = sig(0xc0)
const DAVE = sig(0xd0)

type Pools = { list?: PoolListing; tile?: PoolListing }

/**
 * Five hosts:
 *   one.test   — both pools: Alice offered a list and published a tile, Bob a
 *                tile, Carol is listed with nothing in her index, Dave offered
 *                a record for another name under this name's key;
 *   two.test   — holds nothing in either pool;
 *   three.test — never answers either;
 *   four.test  — answers only the list pool (no picture pool there);
 *   five.test  — the list pool is silent, the picture pool absent.
 */
const world = async (asked: { fresh?: boolean }[] = []): Promise<FeedDeps> => {
  const tileKey = (await picturesKey('recipes'))!
  const tileAddress = (await picturesPoolAddress('recipes'))!
  const listKey = (await needListKey('recipes'))!
  const listAddress = (await needListPoolAddress('recipes'))!
  const docs: Record<string, Record<string, unknown>> = {
    [sig(1)]: { name: 'recipes', children: [sig(11), sig(12)] },
    [sig(11)]: { name: 'Soup' },
    [sig(12)]: { name: 'bread' },
    [sig(2)]: { name: 'recipes', children: [sig(21), { sig: sig(22) }, 'not-a-sig'] },
    [sig(21)]: { name: 'soup ' },
    [sig(22)]: { name: 'Salad' },
    [sig(3)]: { kind: 'need-list', name: 'Recipes', values: ['Stew', ' soup ', 'Stew'], at: 1 },
    [sig(4)]: { kind: 'need-list', name: 'cakes', values: ['Sponge'], at: 1 },
    [sig(5)]: { kind: 'need-list', name: 'recipes', values: ['Pie'], at: 1 },
  }
  const indexes: Record<string, Record<string, unknown>> = {
    [`one.test|${ALICE}`]: { [tileKey]: sig(1), [listKey]: sig(3) },
    [`one.test|${BOB}`]: { [tileKey]: sig(2) },
    [`one.test|${CAROL}`]: {},
    [`one.test|${DAVE}`]: { [listKey]: sig(4) },
    [`four.test|${CAROL}`]: { [listKey]: sig(5) },
  }
  const hosts: Record<string, Pools> = {
    'one.test': {
      list: { state: 'listed', text: [ALICE, DAVE].join('\n') },
      tile: { state: 'listed', text: [ALICE, BOB, CAROL, 'junk'].join('\n') },
    },
    'two.test': { list: { state: 'absent' }, tile: { state: 'absent' } },
    'three.test': { list: { state: 'silent' }, tile: { state: 'silent' } },
    'four.test': { list: { state: 'listed', text: CAROL }, tile: { state: 'absent' } },
    'five.test': { list: { state: 'silent' }, tile: { state: 'absent' } },
  }
  return {
    hosts: () => Object.keys(hosts),
    listing: async (host, address, options) => {
      asked.push({ fresh: options?.fresh })
      const pools = hosts[host] ?? {}
      if (address === listAddress) return pools.list ?? { state: 'absent' }
      if (address === tileAddress) return pools.tile ?? { state: 'absent' }
      return { state: 'absent' }
    },
    roots: async (host, pubkey) => indexes[`${host}|${pubkey}`] ?? null,
    readJson: async s => docs[s] ?? null,
    now: () => 0,
  }
}

const byHost = (feeds: readonly Feed[]): Record<string, Feed> => Object.fromEntries(feeds.map(f => [f.host, f]))

describe('need feeds — the servers feeding a need', () => {
  it('reports every host asking, then its answer', async () => {
    const heard: Feed[] = []
    const final = await feedNeed('recipes', feed => heard.push(feed), await world())
    expect(heard.filter(f => f.state === 'asking').map(f => f.host).sort())
      .toEqual(['five.test', 'four.test', 'one.test', 'three.test', 'two.test'])
    const feeds = byHost(final)
    expect(feeds['one.test']!.state).toBe('answered')
    // Distinct keys across both pools: Alice, Dave, Bob, Carol.
    expect(feeds['one.test']!.publishers).toBe(4)
  })

  it('answered when either pool listed; silent when neither did and one went unanswered; else empty', async () => {
    const feeds = byHost(await feedNeed('recipes', () => {}, await world()))
    expect(feeds['four.test']!.state).toBe('answered')
    expect(feeds['two.test']!.state).toBe('empty')
    expect(feeds['three.test']!.state).toBe('silent')
    expect(feeds['five.test']!.state).toBe('silent')
  })

  it('a host answering only the list pool still feeds its offered values', async () => {
    const feeds = byHost(await feedNeed('recipes', () => {}, await world()))
    expect(feeds['four.test']!.values).toEqual([{ text: 'Pie', by: CAROL, via: 'offer' }])
  })

  it('reads each publisher\'s values from their own index, never the listing', async () => {
    const one = byHost(await feedNeed('recipes', () => {}, await world()))['one.test']!
    expect(one.values).toEqual([
      // The list pool: Alice's record, re-validated (deduped, spacing collapsed).
      { text: 'Stew', by: ALICE, via: 'offer' },
      { text: 'soup', by: ALICE, via: 'offer' },
      // The picture pool: the child names of each publisher's tile.
      { text: 'Soup', by: ALICE, via: 'tile' },
      { text: 'bread', by: ALICE, via: 'tile' },
      { text: 'soup', by: BOB, via: 'tile' },
      { text: 'Salad', by: BOB, via: 'tile' },
    ])
  })

  it('ignores a list record whose name is not the name its key was found under', async () => {
    const one = byHost(await feedNeed('recipes', () => {}, await world()))['one.test']!
    expect(one.values.some(v => v.by === DAVE)).toBe(false)
    expect(one.values.some(v => v.text === 'Sponge')).toBe(false)
  })

  it('merges into one list, folded, most-fed first, with how each was fed', async () => {
    const merged = mergeFeeds(await feedNeed('recipes', () => {}, await world()))
    expect(merged.map(v => v.text)).toEqual(['soup', 'bread', 'Pie', 'Salad', 'Stew'])
    expect([...merged[0]!.by].sort()).toEqual([ALICE, BOB].sort())
    expect([...merged[0]!.vias].sort()).toEqual(['offer', 'tile'])
    expect(merged.find(v => v.text === 'Pie')!.hosts).toEqual(['four.test'])
  })

  it('a fresh run asks every pool past a remembered miss', async () => {
    const asked: { fresh?: boolean }[] = []
    await feedNeed('recipes', () => {}, await world(asked), { fresh: true })
    expect(asked.length).toBe(10)
    expect(asked.every(a => a.fresh === true)).toBe(true)
  })

  it('a publisher whose reads never finish cannot hold the host past its deadline', async () => {
    const live = await world()
    // Bob's tile names a child nobody serves: that read never resolves.
    const stuck: FeedDeps = { ...live, readJson: async s => s === sig(21) ? new Promise(() => {}) : live.readJson(s) }
    const one = byHost(await feedNeed('recipes', () => {}, stuck, { deadlineMs: 50 }))['one.test']!
    expect(one.state).toBe('answered')
    // Everyone else's word arrived; Bob's slot was never filled.
    expect(one.values.some(v => v.by === ALICE && v.via === 'tile')).toBe(true)
    expect(one.values.some(v => v.by === BOB)).toBe(false)
  })

  it('reads every key a wide listing names, up to the window', async () => {
    const live = await world()
    const many = Array.from({ length: 300 }, (_, i) => sig(0x1000 + i))
    let indexReads = 0
    const wide: FeedDeps = {
      ...live,
      hosts: () => ['one.test'],
      listing: async () => ({ state: 'listed', text: many.join('\n') }),
      roots: async () => { indexReads++; return {} },
    }
    await feedNeed('recipes', () => {}, wide)
    expect(indexReads).toBe(256)
  })

  it('a name with no molecule asks nothing and holds nothing', async () => {
    const asked: { fresh?: boolean }[] = []
    const final = await feedNeed('', () => {}, await world(asked))
    expect(final.every(f => f.state === 'empty')).toBe(true)
    expect(asked.length).toBe(0)
  })
})
