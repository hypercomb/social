// assistant/hive-explore-read.ts
//
// A MODEL EXPLORES A NAME ACROSS THE HOSTS (jwize 2026-11-13: "exploring other
// hives you should be able to do this natively with all of your hosts that are
// network ... agents have full access to these explore shares").
//
// `explore <name>` is the question the explore view asks (sharing/need-feeds.ts),
// asked for a model: every host this hive can ask is asked what it holds for
// the name, and the answer is what other hives have made public under it —
//
//   · the lists participants CONTRIBUTED for the name (`list:<sign(name)>`);
//   · the tiles of that name publishers PUBLISHED (`pictures:<sign(name)>`):
//     their child names as values, and each tile's own layer by signature,
//     which `read <signature>` opens to walk into that hive.
//
// `pool` cannot answer this: those two pools list publisher KEYS, and each
// key's word is read from that publisher's own signed index. This read does
// that walk, with the same checks the view makes.
//
// THE HIVE IS A READER HERE, NEVER A SOURCE. Nothing of this hive goes out:
// what a host is sent is sign(name) folded into a pool address, a publisher's
// key, and signatures it already listed. Only what a participant published or
// contributed themselves is ever found. Nothing is written and nothing kept.
//
// Pure apart from `liveExploreDeps`.

import { feedNeed, liveFeedDeps, mergeFeeds, type Feed, type FeedDeps, type FeedOptions, type FeedVia } from '../sharing/need-feeds.js'
import { needListKey } from '../sharing/need-lists.js'
import { networkHosts } from '../sharing/network-hosts.js'

/** A name a model may explore: one tile name, never a route or an address. */
export const EXPLORE_NAME_MAX = 64
/** Values and tiles one read names; `total` says how many values there are. */
export const EXPLORE_VALUES = 200
export const EXPLORE_TILES = 32
/** Hosts one read reports. */
export const EXPLORE_HOSTS = 64

const CONTROL = /[\u0000-\u001f\u007f]/

/** What one host said: it listed something, holds nothing, or did not answer. */
export type ExploreHostState = 'answered' | 'empty' | 'silent'

export type HypercombExploreRead =
  | {
    readonly ok: true
    readonly root: string
    readonly name: string
    readonly hosts: readonly { readonly host: string; readonly state: ExploreHostState; readonly values: number; readonly publishers: number }[]
    /** Every value any host brought, most-fed first: the hosts that fed it,
     *  how many publishers said it, and whether it came from a contributed
     *  list (`offer`), a published tile (`tile`), or both. */
    readonly values: readonly { readonly text: string; readonly hosts: readonly string[]; readonly publishers: number; readonly via: readonly FeedVia[] }[]
    readonly total: number
    /** Published tiles of that name: each publisher's layer, by signature. */
    readonly tiles: readonly { readonly sig: string; readonly by: string; readonly hosts: readonly string[] }[]
    readonly truncated: boolean
  }
  | { readonly ok: false; readonly root: string; readonly code: 'not-a-name' | 'no-hosts' | 'unavailable' }

export interface ExploreReadDeps {
  /** Every host this hive can ask. */
  hosts(): Promise<readonly string[]>
  /** The feed reads, asked of those hosts. */
  feed(hosts: readonly string[]): FeedDeps
}

export const liveExploreDeps: ExploreReadDeps = {
  hosts: networkHosts,
  feed: hosts => ({ ...liveFeedDeps(), hosts: () => hosts }),
}

/** One tile name as a model may say it: spacing collapsed, or '' when it is
 *  a route, an address, or too long to be a name. */
export const exploreName = (raw: unknown): string => {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ')
  return !name || name.length > EXPLORE_NAME_MAX || CONTROL.test(name) || /[/\\]/.test(name) ? '' : name
}

const rootOf = (name: string): string => `explore ${name}`

const stateOf = (feed: Feed): ExploreHostState =>
  feed.state === 'answered' ? 'answered' : feed.state === 'empty' ? 'empty' : 'silent'

/** Ask every host what it holds for `raw` and merge what they say. Never
 *  throws for a host. */
export const readExplore = async (
  raw: string,
  options: FeedOptions & { readonly signal?: AbortSignal } = {},
  deps: ExploreReadDeps = liveExploreDeps,
): Promise<HypercombExploreRead> => {
  const name = exploreName(raw)
  const root = rootOf(String(raw ?? '').trim().replace(/\s+/g, ' '))
  // A name with no molecule address has no pools to ask for.
  if (!name || !(await needListKey(name).catch(() => null))) return { ok: false, root, code: 'not-a-name' }

  let hosts: string[]
  try {
    hosts = [...new Set((await deps.hosts()).map(host => String(host ?? '').trim().toLowerCase()).filter(Boolean))].sort().slice(0, EXPLORE_HOSTS)
  } catch { return { ok: false, root, code: 'unavailable' } }
  if (!hosts.length) return { ok: false, root, code: 'no-hosts' }

  let feeds: Feed[]
  try {
    feeds = await feedNeed(name, () => {}, deps.feed(hosts), options.deadlineMs ? { deadlineMs: options.deadlineMs } : {})
  } catch { return { ok: false, root, code: 'unavailable' } }
  if (options.signal?.aborted) throw new DOMException('The Hypercomb explore read was stopped', 'AbortError')

  // Someone else's words: data. A value holding a control character is no
  // name; it is dropped, never cut, so nothing reads as a break in a prompt.
  const values = mergeFeeds(feeds).filter(value => !CONTROL.test(value.text)).map(value => ({
    text: value.text, hosts: [...value.hosts].sort(), publishers: value.by.length, via: [...value.vias].sort(),
  }))
  const bySig = new Map<string, { by: string; hosts: string[] }>()
  for (const feed of feeds) {
    for (const tile of feed.tiles ?? []) {
      const seen = bySig.get(tile.sig)
      if (seen) { if (!seen.hosts.includes(feed.host)) seen.hosts.push(feed.host) } else bySig.set(tile.sig, { by: tile.by, hosts: [feed.host] })
    }
  }
  // Most carried first, then by signature: stable, so two reads agree.
  const tiles = [...bySig].map(([sig, tile]) => ({ sig, by: tile.by, hosts: tile.hosts.sort() }))
    .sort((a, b) => b.hosts.length - a.hosts.length || (a.sig < b.sig ? -1 : 1))
  return {
    ok: true, root: rootOf(name), name,
    hosts: feeds.map(feed => ({ host: feed.host, state: stateOf(feed), values: feed.values.length, publishers: feed.publishers }))
      .sort((a, b) => (a.host < b.host ? -1 : 1)),
    values: values.slice(0, EXPLORE_VALUES), total: values.length,
    tiles: tiles.slice(0, EXPLORE_TILES),
    truncated: values.length > EXPLORE_VALUES || tiles.length > EXPLORE_TILES,
  }
}
