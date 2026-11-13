// sharing/need-feeds.ts
//
// THE SERVERS FEEDING A NEED (jwize, 2026-11-12: "it is to show you the
// servers feeding a need"; "a row of tiles horizontal feeding the list below").
//
// The tile you stand on is the NEED. Every host this participant can ask is a
// FEEDER. Each one is asked, on its own clock, what it holds for the need's
// name, and its answer is a list of text values with the publisher who said
// each one. The view (need-feeds.queen.ts) draws the hosts as a row and lets
// the answers flow down into one list — a diagnostic of who feeds what, and a
// place to pick a value and promote it onto the need.
//
// WHAT A HOST HOLDS FOR A NAME — two pools, asked of each host at once:
//
//   · `list:<m>` (need-lists.ts) — the participants who OFFERED a list for the
//     name (`contribute`): their index names a list record, and its values are
//     the values (`via: 'offer'`);
//   · `pictures:<m>` (picture-pools.ts) — the publishers whose Publish named a
//     tile of that name in their index. The Publish act writes that entry only
//     for a tile that WEARS A PICTURE (pictureRootsOf, at most 64 per publish,
//     nearest the root first), so an unpictured published tile is not here:
//     its children reach the list only when someone contributes them (`contribute`).
//     The values are the names of the children of THEIR tile (`via: 'tile'`).
//
// Either way a publisher's word is read from their OWN signed index, never
// from the listing, and every byte behind it is signature-addressed.
//
// Pure apart from `liveFeedDeps`: the reads are handed in, so the walk is
// tested without a network.

import { SignatureService } from '@hypercomb/core'
import { fetchWithDeadline } from './bounded-fetch.js'
import { fetchHiveIndex } from './hive-pointer.js'
import { needListKey, needListOf, needListPoolAddress } from './need-lists.js'
import { picturesKey, picturesPoolAddress } from './picture-pools.js'
import { askPoolListing, type PoolListing } from './pool-listing.js'

/** What one feeder said so far. `asking` until it answers; `answered` with
 *  values (possibly none read); `empty` = the host holds nothing for the
 *  name; `silent` = it did not answer in time. */
export type FeedState = 'asking' | 'answered' | 'empty' | 'silent'

export interface FeedValue {
  readonly text: string
  /** The publisher's key — the person whose list or tile carried the value. */
  readonly by: string
  /** Where it came from: a list they offered, or a tile they published. */
  readonly via: FeedVia
}

export type FeedVia = 'offer' | 'tile'

/** How a run asks: `fresh` asks past a remembered miss (a write just landed);
 *  `deadlineMs` bounds one host's whole answer (default HOST_DEADLINE_MS). */
export interface FeedOptions {
  readonly fresh?: boolean
  readonly deadlineMs?: number
}

export interface Feed {
  readonly host: string
  readonly state: FeedState
  readonly values: readonly FeedValue[]
  /** Publishers the host listed for the name, across both pools. */
  readonly publishers: number
  /** Milliseconds from the ask to this report. */
  readonly ms: number
  /** The published tiles of that name this host led to: each publisher's own
   *  layer, by signature — the way in to their tile, not only its child names. */
  readonly tiles?: readonly FeedTile[]
}

export interface FeedTile {
  readonly sig: string
  /** The publisher whose index named it. */
  readonly by: string
}

export interface FeedDeps {
  hosts(): readonly string[]
  listing(host: string, address: string, options?: FeedOptions): Promise<PoolListing>
  /** The roots of a publisher's own signed index on a host, or null. */
  roots(host: string, pubkey: string, options?: FeedOptions): Promise<Readonly<Record<string, unknown>> | null>
  /** A JSON resource by signature. `host` is the host that listed the word
   *  it hangs from — where its bytes are sure to be when nothing else has them. */
  readJson(sig: string, host?: string): Promise<Record<string, unknown> | null>
  now(): number
}

const SIG_RE = /^[0-9a-f]{64}$/
/** Keys read from one listing — the same window the picture chooser reads
 *  (peer-images.ts MAX_POOL_MEMBERS). Both hosts list sorted by key, so a
 *  narrow window is a window anyone can fill with low keys; a wide one costs
 *  a flood of them. */
export const MAX_PUBLISHERS = 256
const MAX_VALUES_PER_PUBLISHER = 64
/** Reads in flight at once, per host — publishers, and a tile's children. */
const READS_AT_ONCE = 8
/** One host's whole answer: past this it reports what it has read. A
 *  publisher whose tile names children nobody serves must not hold the row
 *  at `asking…` for minutes. */
export const HOST_DEADLINE_MS = 15_000

/** Run `job` over `items`, `limit` at a time, in no particular finish order. */
const eachLimited = async <T,>(items: readonly T[], limit: number, job: (item: T, i: number) => Promise<void>): Promise<void> => {
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      await job(items[i]!, i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

const sigOf = (value: unknown): string => {
  const raw = typeof value === 'string' ? value : String((value as { sig?: unknown } | null)?.sig ?? '')
  const bare = raw.trim().toLowerCase()
  return SIG_RE.test(bare) ? bare : ''
}

const listedKeys = (text: string): string[] =>
  text.split(/\r?\n/).map(line => line.trim().toLowerCase()).filter(line => SIG_RE.test(line)).slice(0, MAX_PUBLISHERS)

/** The child names of one published layer, in its own order. */
export const childNamesOf = async (
  layerSig: string,
  readJson: FeedDeps['readJson'],
): Promise<string[]> => {
  const layer = await readJson(layerSig)
  const children = Array.isArray(layer?.['children']) ? (layer!['children'] as unknown[]) : []
  const sigs = children.slice(0, MAX_VALUES_PER_PUBLISHER).map(sigOf).filter(Boolean)
  // Read side by side, kept in the tile's own order.
  const names: string[] = new Array(sigs.length).fill('')
  await eachLimited(sigs, READS_AT_ONCE, async (sig, i) => {
    try { names[i] = String((await readJson(sig))?.['name'] ?? '').trim() } catch { /* one unreadable child is one missing value */ }
  })
  return names.filter(Boolean)
}

/** The values of one offered list record, re-validated: null unless it is a
 *  list for the molecule `m` its key named. */
export const offeredValuesOf = async (
  recordSig: string,
  m: string,
  readJson: FeedDeps['readJson'],
): Promise<string[]> => {
  const record = await needListOf(await readJson(recordSig), m)
  return record ? [...record.values] : []
}

/** One pool of a host, as one ask sees it. */
type PoolAsk = { readonly key: string; readonly address: string; readonly via: FeedVia }

/**
 * Ask every feeder what it holds for `name`. `onFeed` hears each host twice —
 * once `asking`, once with its answer — in whatever order the hosts answer.
 * Each host is asked both pools at once; it has `answered` when either pool
 * answered a listing, is `silent` when neither did and either went unanswered,
 * and is `empty` otherwise. Resolves with the final report of every host.
 */
export async function feedNeed(
  name: string,
  onFeed: (feed: Feed) => void,
  deps: FeedDeps,
  options: FeedOptions = {},
): Promise<Feed[]> {
  const hosts = [...new Set(deps.hosts())]
  const pools: PoolAsk[] = []
  const listKey = await needListKey(name)
  const listAddress = listKey ? await needListPoolAddress(name) : null
  if (listKey && listAddress) pools.push({ key: listKey, address: listAddress, via: 'offer' })
  const tileKey = await picturesKey(name)
  const tileAddress = tileKey ? await picturesPoolAddress(name) : null
  if (tileKey && tileAddress) pools.push({ key: tileKey, address: tileAddress, via: 'tile' })
  const molecule = listKey ? listKey.slice(listKey.indexOf(':') + 1) : ''
  const fresh: FeedOptions = options.fresh ? { fresh: true } : {}

  const ask = async (host: string): Promise<Feed> => {
    const started = deps.now()
    const report = (state: FeedState, values: FeedValue[] = [], publishers = 0, tiles: FeedTile[] = []): Feed => {
      const feed: Feed = { host, state, values, publishers, ms: Math.max(0, deps.now() - started), ...(tiles.length ? { tiles } : {}) }
      onFeed(feed)
      return feed
    }
    report('asking')
    if (!pools.length) return report('empty')
    const said = await Promise.all(pools.map(async (pool): Promise<PoolListing> => {
      try { return await deps.listing(host, pool.address, fresh) } catch { return { state: 'silent' } }
    }))
    if (!said.some(s => s.state === 'listed')) return report(said.some(s => s.state === 'silent') ? 'silent' : 'empty')
    // One index read per publisher, however many pools list them.
    const indexes = new Map<string, Promise<Readonly<Record<string, unknown>> | null>>()
    const readHere = (sig: string) => deps.readJson(sig, host)
    const rootsOf = (pubkey: string) => {
      let read = indexes.get(pubkey)
      if (!read) { read = deps.roots(host, pubkey, fresh).catch(() => null); indexes.set(pubkey, read) }
      return read
    }
    // One slot per (pool, publisher), filled as each answers, read in listing
    // order — so the values come out the same however the reads finish, and a
    // deadline reports exactly the slots that were filled.
    const jobs = pools.flatMap((pool, i) => said[i]!.state === 'listed'
      ? listedKeys((said[i] as { text: string }).text).map(pubkey => ({ pool, pubkey }))
      : [])
    const slots: FeedValue[][] = jobs.map(() => [])
    const tileSlots: (FeedTile | null)[] = jobs.map(() => null)
    const work = eachLimited(jobs, READS_AT_ONCE, async ({ pool, pubkey }, j) => {
      try {
        // Their own word, from their own signed index — never the listing's.
        const sig = sigOf((await rootsOf(pubkey))?.[pool.key])
        if (!sig) return
        if (pool.via === 'tile') tileSlots[j] = { sig, by: pubkey }
        const texts = pool.via === 'offer'
          ? await offeredValuesOf(sig, molecule, readHere)
          : await childNamesOf(sig, readHere)
        slots[j] = texts.map(text => ({ text, by: pubkey, via: pool.via }))
      } catch { /* one unreadable publisher — skip only them */ }
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      work,
      new Promise<void>(resolve => { timer = setTimeout(resolve, options.deadlineMs ?? HOST_DEADLINE_MS) }),
    ])
    if (timer !== undefined) clearTimeout(timer)
    return report('answered', slots.flat(), indexes.size, tileSlots.filter((tile): tile is FeedTile => tile !== null))
  }
  return Promise.all(hosts.map(ask))
}

/** One value as the list shows it: the text once, with every host and
 *  publisher that fed it. Folded by case and spacing, first spelling kept. */
export interface NeedValue {
  readonly text: string
  readonly hosts: readonly string[]
  readonly by: readonly string[]
  /** How it was fed: offered as a list, carried by a tile, or both. */
  readonly vias: readonly FeedVia[]
}

/** Case, spacing, and the hyphens and underscores a tile name folds its spaces
 *  into (`lemon tart` is the tile `lemon-tart`) are not part of a value. */
export const foldValue = (text: string): string => text.trim().replace(/[\s_-]+/g, ' ').trim().toLowerCase()

/** The list below the row: every answered value, most-fed first, then A–Z. */
export const mergeFeeds = (feeds: readonly Feed[]): NeedValue[] => {
  const merged = new Map<string, { text: string; hosts: Set<string>; by: Set<string>; vias: Set<FeedVia> }>()
  for (const feed of feeds) {
    for (const value of feed.values) {
      const fold = foldValue(value.text)
      if (!fold) continue
      const row = merged.get(fold) ?? { text: value.text.trim(), hosts: new Set<string>(), by: new Set<string>(), vias: new Set<FeedVia>() }
      row.hosts.add(feed.host)
      row.by.add(value.by)
      if (value.via) row.vias.add(value.via)
      merged.set(fold, row)
    }
  }
  return [...merged.values()]
    .map(row => ({ text: row.text, hosts: [...row.hosts], by: [...row.by], vias: [...row.vias] }))
    .sort((a, b) => b.by.length - a.by.length || b.hosts.length - a.hosts.length || a.text.localeCompare(b.text))
}

// ── the live reads ─────────────────────────────────────────────────────────

const ioc = (key: string): unknown =>
  (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key)

const hostUrl = (host: string): string =>
  `${/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host) ? 'http' : 'https'}://${host}`

/** The reads a hive makes: the broker's known hosts, the one quiet pool ask,
 *  the publisher's index, and the store's SHA-gated resource read. */
export const liveFeedDeps = (): FeedDeps => ({
  hosts: () =>
    (ioc('@diamondcoreprocessor.com/ContentBrokerDrone') as { knownContentHosts?: () => readonly string[] } | undefined)
      ?.knownContentHosts?.() ?? [],
  listing: (host, address, options) => askPoolListing(hostUrl(host), address, { timeoutMs: 6_000, fresh: !!options?.fresh }),
  roots: async (host, pubkey, options) => {
    const index = await fetchHiveIndex(host, pubkey, undefined, { fresh: !!options?.fresh })
    return index.ok ? (index.manifest.roots ?? null) as Readonly<Record<string, unknown>> | null : null
  },
  readJson: async (sig, host) => {
    const store = ioc('@hypercomb.social/Store') as { getResource?: (s: string) => Promise<Blob | null> } | undefined
    let text: string | null = null
    const blob = await store?.getResource?.(sig).catch(() => null)
    if (blob) text = await blob.text()
    // The store asks the hosts IT knows. The host that listed the word holds
    // its bytes (an offer publishes them there before it stamps the index),
    // so ask that host too — believed only when the bytes hash to the name.
    if (text === null && host) {
      try {
        const response = await fetchWithDeadline(`${hostUrl(host)}/${sig}`, { cache: 'force-cache' }, { timeoutMs: 6_000 })
        if (response.ok) {
          const bytes = await response.arrayBuffer()
          if ((await SignatureService.sign(bytes)) === sig) text = new TextDecoder().decode(bytes)
        }
      } catch { /* unreachable: the word stays unread */ }
    }
    if (text === null) return null
    try { return JSON.parse(text) as Record<string, unknown> } catch { return null }
  },
  now: () => performance.now(),
})
