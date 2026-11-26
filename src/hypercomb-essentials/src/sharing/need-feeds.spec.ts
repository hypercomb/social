import { describe, expect, it } from 'vitest'
import { SignatureService } from '@hypercomb/core'
import { feedNeed, mergeFeeds, OFFERINGS_MEANING, PUBLICATIONS_MEANING, publishedUnder, type Feed, type FeedDeps } from './need-feeds.js'
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

  it('names each published tile it read by signature; a contributed list is not a tile', async () => {
    const feeds = byHost(await feedNeed('recipes', () => {}, await world()))
    expect(feeds['one.test']!.tiles).toEqual([{ sig: sig(1), by: ALICE }, { sig: sig(2), by: BOB }])
    expect(feeds['four.test']!.tiles).toBeUndefined()
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

  // ONE PER HOST, A SITE ONLY FOR WHAT IT ADDS (jwize, 2026-11-14). Run live
  // that day: one contribution came back from 16 doors of the same worker
  // store (protocol.hypercomb.com, susan.pluginthematrix.com, …).
  const zoned = async (siteHolds: Record<string, string[]>) => {
    const listKey = (await needListKey('recipes'))!
    const listAddress = (await needListPoolAddress('recipes'))!
    const record = (values: string[], n: number) => ({ sig: sig(0x500 + n), doc: { kind: 'need-list', name: 'recipes', values, at: 1 } })
    const root = record(['soup', 'bread'], 0)
    const own = Object.fromEntries(Object.entries(siteHolds).map(([host, values], n) => [host, record(values, n + 1)]))
    const docs: Record<string, Record<string, unknown>> = { [root.sig]: root.doc, ...Object.fromEntries(Object.values(own).map(r => [r.sig, r.doc])) }
    const heard: Feed[] = []
    const asked: string[] = []
    const deps: FeedDeps = {
      hosts: () => ['protocol.hypercomb.com', 'hypercomb.com', 'content.hypercomb.com', 'susan.hypercomb.com', 'jwize.com', 'localhost:7777', 'solo.example.org'],
      listing: async (host, address) => {
        asked.push(host)
        return address === listAddress && host.endsWith('hypercomb.com') ? { state: 'listed', text: ALICE } : { state: 'absent' }
      },
      // Every door of hypercomb.com answers its root's record unless it holds one of its own.
      roots: async host => ({ [listKey]: (own[host] ?? root).sig }),
      readJson: async s => docs[s] ?? null,
      now: () => 0,
    }
    const final = await feedNeed('recipes', feed => heard.push(feed), deps)
    return { final, heard, asked }
  }

  it('asks each zone at its root; a site that holds what its root holds is not a host of its own', async () => {
    const { final, heard, asked } = await zoned({})
    expect(final.map(f => f.host)).toEqual(['hypercomb.com', 'jwize.com', 'localhost:7777', 'solo.example.org'])
    // A site is asked quietly: it never shows, not even while asking.
    expect(heard.some(f => f.host.endsWith('.hypercomb.com'))).toBe(false)
    // The content face is the zone itself, never asked as a door of its own.
    expect(asked).not.toContain('content.hypercomb.com')
    expect(asked).toContain('protocol.hypercomb.com')
  })

  it('a site that adds something shows, with only what it adds', async () => {
    const { final, heard } = await zoned({ 'protocol.hypercomb.com': ['soup', 'pasta'] })
    const site = final.find(f => f.host === 'protocol.hypercomb.com')!
    expect(site.state).toBe('answered')
    expect(site.values.map(v => v.text)).toEqual(['pasta'])
    expect(heard.filter(f => f.host === 'protocol.hypercomb.com').map(f => f.state)).toEqual(['answered'])
    expect(final.some(f => f.host === 'susan.hypercomb.com')).toBe(false)
    expect(mergeFeeds(final).find(v => v.text === 'soup')!.hosts).toEqual(['hypercomb.com'])
  })

  it('a name with no molecule asks nothing and holds nothing', async () => {
    const asked: { fresh?: boolean }[] = []
    const final = await feedNeed('', () => {}, await world(asked))
    expect(final.every(f => f.state === 'empty')).toBe(true)
    expect(asked.length).toBe(0)
  })
})

describe('what the hosts published under a name (reach A5)', () => {
  const addressOf = (meaning: string): Promise<string> =>
    SignatureService.sign(new TextEncoder().encode(meaning).buffer as ArrayBuffer)
  const H = sig(0x100)
  const G = sig(0x200)
  const OFFERED = sig(0x300)

  /** one.test keeps a ledger naming knowledge/hyperdex (head H), honey-garden
   *  and hyperdex-two, and an offerings set holding one honey-garden record
   *  whose head Carol's own index names (G), and one forged record. */
  const world = async (asked: string[] = []): Promise<FeedDeps> => {
    const ledgerAddress = await addressOf(PUBLICATIONS_MEANING)
    const offeringsAddress = await addressOf(OFFERINGS_MEANING)
    const ledger = JSON.stringify({ sites: [
      { host: 'hyperdex.one.test', lineage: 'knowledge/hyperdex', publishers: [{ pubkey: ALICE, head: H }, { pubkey: BOB, head: null }] },
      { host: 'hyperdex-two.one.test', lineage: 'hyperdex-two', publishers: [{ pubkey: BOB, head: sig(0x101) }] },
      { host: 'stranger.example', lineage: 'Hyperdex', publishers: [{ pubkey: DAVE, head: sig(0x102) }] },
      // A hostile ledger row: Carol's own index names no such head, and Alice's names H.
      { host: 'one.test', lineage: 'knowledge/hyperdex', publishers: [{ pubkey: CAROL, head: sig(0x103) }, { pubkey: ALICE, head: sig(0x104) }] },
    ] })
    const records: Record<string, Record<string, unknown>> = {
      [OFFERED]: { kind: 'host:offering', title: 'honey', route: 'https://honey-garden.one.test/', lineage: 'honey-garden', pubkey: CAROL },
    }
    return {
      hosts: () => ['one.test'],
      listing: async (host, address) => {
        asked.push(`listing ${host} ${address}`)
        return address === offeringsAddress ? { state: 'listed', text: `${OFFERED}
${sig(0x301)}
` } : { state: 'absent' }
      },
      // Each publisher's own signed index on one.test: the word a ledger row is checked against.
      roots: async (host, pubkey) => host !== 'one.test' ? null
        : pubkey === CAROL ? { 'honey-garden': G }
        : pubkey === ALICE ? { 'knowledge/hyperdex': H }
        : pubkey === DAVE ? { Hyperdex: sig(0x102) }
        : pubkey === BOB ? { 'hyperdex-two': sig(0x101) } : null,
      readJson: async () => null,
      now: () => 0,
      document: async (host, address) => { asked.push(`document ${host} ${address}`); return address === ledgerAddress ? ledger : null },
      // The live read checks the hash; a record that fails it comes back null.
      member: async (_host, _address, s) => records[s] ?? null,
    }
  }

  it('finds a ledger head by the molecule address of its last lineage segment, never by prefix', async () => {
    expect(await publishedUnder('hyperdex', await world())).toEqual([
      // Case folds the way a molecule address folds; a site of the host is named beside it, any other host is not.
      { sig: sig(0x102), by: DAVE, hosts: ['one.test'], via: 'publication' },
      { sig: H, by: ALICE, hosts: ['hyperdex.one.test', 'one.test'], via: 'publication' },
    ].sort((a, b) => b.hosts.length - a.hosts.length || (a.sig < b.sig ? -1 : 1)))
    // `hyperdex-two` is another name.
    expect((await publishedUnder('hyperdex', await world())).map(tile => tile.sig)).not.toContain(sig(0x101))
    expect(await publishedUnder('hyper', await world())).toEqual([])
  })

  it("keeps a ledger row only when the publisher's own signed index names that head", async () => {
    const sigs = (await publishedUnder('hyperdex', await world())).map(tile => tile.sig)
    // The ledger is the host's unsigned word: a head it pins on a real key is not that key's.
    expect(sigs).not.toContain(sig(0x103))
    expect(sigs).not.toContain(sig(0x104))
    expect(sigs).toContain(H)
  })

  it("finds an offering by its lineage, its head read from the publisher's own index", async () => {
    expect(await publishedUnder('honey-garden', await world())).toEqual([
      { sig: G, by: CAROL, hosts: ['honey-garden.one.test', 'one.test'], via: 'publication' },
    ])
    expect(await publishedUnder('honey', await world())).toEqual([])
  })

  it('asks only the hosts it is given, at the two derived addresses', async () => {
    const asked: string[] = []
    await publishedUnder('hyperdex', await world(asked))
    expect([...new Set(asked.map(line => line.split(' ')[1]))]).toEqual(['one.test'])
    expect(new Set(asked.map(line => line.split(' ')[2])))
      .toEqual(new Set([await addressOf(PUBLICATIONS_MEANING), await addressOf(OFFERINGS_MEANING)]))
  })

  it('reads nothing when the feed deps cannot read a ledger or a member', async () => {
    const { document: _d, member: _m, ...plain } = await world()
    expect(await publishedUnder('hyperdex', plain)).toEqual([])
  })
})
