// assistant/hive-pool-read.ts
//
// A MODEL ASKS THE HOSTS FOR A POOL OF MEANING (jwize 2026-11-13: "if we use
// the pools it should be easy to do. We just have to query the root pool").
//
// Every other read walks this hive's own tiles. On a page whose own hive is
// empty — a card's site door — that answered "not-found" to everything, and a
// model asked for the community's published hives had nowhere to look. What
// the community publishes was never in the tile tree: it is in pools, each at
// `sign(meaning)` at the root of every host that carries it
// (documentation/pools-across-hosts.md). So the read is the pool rule itself:
//
//   pool <meaning>      derive sign(meaning), ask each host this hive follows
//
// and a host answers one of two ways, both at that one address:
//
//   · `/<address>/`  a SET — entry names, each a signature a later
//                    `read <signature>` opens;
//   · `/<address>`   a one-file index — `host:publications`, the creations a
//                    host has published, is one.
//
// ANCHOR-FIRST, NEVER ENUMERATED. The model names a meaning it already holds;
// there is no "list your pools". Only the hosts the participant carries are
// asked (`community:hosts`; carrying none, the public content host, as
// `discover` does) — a model never names a host, so a read can never be aimed
// at a stranger. What goes out is a signature and nothing else.
//
// READ ONLY, NOTHING KEPT. No pool is minted, nothing is written to the
// store, and the meaning is NOT registered as a pool address: a word a model
// tried is not a pool this hive holds. A host that is down or answers a page
// is a gap, said as one.

import { SignatureService } from '@hypercomb/core'
import { fetchWithDeadline, mapBounded, HOST_CONCURRENCY } from '../sharing/bounded-fetch.js'
import { listCommunityHosts } from '../sharing/community-hosts.js'
import { lensOrigin, listingMembers } from '../sharing/community-lens.js'
import { PUBLIC_CONTENT_HOSTS } from '../sharing/hive-link.js'
import { askPoolListing } from '../sharing/pool-listing.js'

/** A pool a model may ask for: a colon meaning, lower case, no spaces. A bare
 *  word is a tile's name pool, which no host lists. */
export const POOL_MEANING = /^[a-z][a-z0-9-]*(?::[a-z0-9][a-z0-9._-]*)+$/
export const POOL_MEANING_MAX = 200
/** Members one read names; `total` says how many there are. */
const MAX_MEMBERS = 200
/** A one-file index larger than this is not read. */
const MAX_DOCUMENT_BYTES = 1_000_000
/** One host's silence is waited on this long, then it is a gap. */
const HOST_TIMEOUT_MS = 6_000

/** What one host said: a set's listing, a one-file index, no pool at this
 *  address, or nothing that can be read as an answer. */
export type PoolHostState = 'listed' | 'document' | 'absent' | 'silent'

export type HypercombPoolRead =
  | {
    readonly ok: true
    readonly root: string
    readonly meaning: string
    /** sign(meaning): where every host carries this pool. */
    readonly address: string
    readonly hosts: readonly { readonly host: string; readonly state: PoolHostState }[]
    /** A set's members, each with the hosts that listed it. */
    readonly members: readonly { readonly sig: string; readonly hosts: readonly string[] }[]
    readonly total: number
    /** A one-file index, once per distinct content, a page at a time. */
    readonly documents: readonly {
      readonly hosts: readonly string[]
      readonly size: number
      readonly from: number
      readonly text: string
      readonly truncated: boolean
      readonly next?: number
    }[]
    readonly truncated: boolean
  }
  | { readonly ok: false; readonly root: string; readonly code: 'not-a-pool' | 'no-hosts' | 'unavailable' }

export interface PoolReadDeps {
  /** The hosts asked, as host names. */
  hosts(): Promise<readonly string[]>
  /** sign(meaning). */
  address(meaning: string): Promise<string>
  /** A set's listing body; 'absent' for no pool; null for no answer. */
  listing(origin: string, address: string, signal?: AbortSignal): Promise<string | 'absent' | null>
  /** A one-file index's text; null for anything that is not one. */
  document(origin: string, address: string, signal?: AbortSignal): Promise<string | null>
}

export const livePoolReadDeps: PoolReadDeps = {
  hosts: async () => {
    const carried = await listCommunityHosts().catch(() => [] as string[])
    return carried.length ? carried : [...PUBLIC_CONTENT_HOSTS]
  },
  address: meaning => SignatureService.sign(new TextEncoder().encode(meaning).buffer as ArrayBuffer),
  // The one quiet way (sharing/pool-listing.ts): a host with no pool here says
  // so without a console error, and is not asked again for a while.
  listing: async (origin, address, signal) => {
    const said = await askPoolListing(origin, address, { timeoutMs: HOST_TIMEOUT_MS, ...(signal ? { signal } : {}) })
    return said.state === 'listed' ? said.text : said.state === 'absent' ? 'absent' : null
  },
  document: async (origin, address, signal) => {
    try {
      const response = await fetchWithDeadline(`${origin}/${address}?held`, { cache: 'no-store' }, { timeoutMs: HOST_TIMEOUT_MS, ...(signal ? { signal } : {}) })
      if (!response.ok || response.status === 204) return null
      if ((response.headers?.get?.('content-type') ?? '').toLowerCase().includes('text/html')) return null
      const text = await response.text()
      return !text || text.length > MAX_DOCUMENT_BYTES || text.trimStart().startsWith('<') ? null : text
    } catch { return null }
  },
}

const rootOf = (meaning: string): string => `pool ${meaning}`

/** Ask every followed host for one pool and merge what they say. Never throws
 *  for a host. `from` continues a long one-file index. */
export const readPool = async (
  raw: string,
  options: { readonly from?: number; readonly maxBytes?: number; readonly signal?: AbortSignal } = {},
  deps: PoolReadDeps = livePoolReadDeps,
): Promise<HypercombPoolRead> => {
  const meaning = String(raw ?? '').trim()
  const root = rootOf(meaning)
  if (!meaning || meaning.length > POOL_MEANING_MAX || !POOL_MEANING.test(meaning)) return { ok: false, root, code: 'not-a-pool' }
  const from = Math.max(0, Math.floor(Number(options.from) || 0))
  const maxBytes = Math.max(1_024, Math.floor(Number(options.maxBytes) || 8_000))

  let address: string
  let hosts: string[]
  try {
    address = await deps.address(meaning)
    hosts = [...new Set((await deps.hosts()).map(host => String(host ?? '').trim().toLowerCase()).filter(Boolean))].sort()
  } catch { return { ok: false, root, code: 'unavailable' } }
  if (!hosts.length) return { ok: false, root, code: 'no-hosts' }

  type Said = { readonly host: string; readonly state: PoolHostState; readonly members?: readonly string[]; readonly text?: string }
  const said = await mapBounded(hosts, HOST_CONCURRENCY, async (host): Promise<Said> => {
    const origin = lensOrigin(host)
    // The set first: it is the quiet question. A host that lists nothing there
    // may still hold a one-file index at the same address.
    const listing = await deps.listing(origin, address, options.signal).catch(() => null)
    const members = listing === null || listing === 'absent' ? null : listingMembers(listing)
    if (members?.length) return { host, state: 'listed', members }
    const text = await deps.document(origin, address, options.signal).catch(() => null)
    if (text !== null) return { host, state: 'document', text }
    if (members) return { host, state: 'listed', members }
    return { host, state: listing === 'absent' ? 'absent' : 'silent' }
  })
  if (options.signal?.aborted) throw new DOMException('The Hypercomb pool read was stopped', 'AbortError')

  const answers = said.map((answer, at): Said => answer ?? { host: hosts[at]!, state: 'silent' })
  const bySig = new Map<string, string[]>()
  const byText = new Map<string, string[]>()
  for (const answer of answers) {
    for (const sig of answer.members ?? []) bySig.set(sig, [...(bySig.get(sig) ?? []), answer.host])
    if (answer.text !== undefined) byText.set(answer.text, [...(byText.get(answer.text) ?? []), answer.host])
  }
  // Most carried first, then by signature: stable, so two reads agree.
  const members = [...bySig].map(([sig, carriers]) => ({ sig, hosts: carriers }))
    .sort((a, b) => b.hosts.length - a.hosts.length || (a.sig < b.sig ? -1 : 1))
  // The read's size is shared among the distinct indexes; almost always one.
  const share = Math.max(512, Math.floor(maxBytes / Math.max(1, byText.size)))
  const documents = [...byText].map(([text, carriers]) => {
    const page = text.slice(from, from + share)
    const end = from + page.length
    const more = end < text.length
    return { hosts: carriers, size: text.length, from, text: page, truncated: more, ...(more ? { next: end } : {}) }
  })
  return {
    ok: true, root, meaning, address,
    hosts: answers.map(answer => ({ host: answer.host, state: answer.state })),
    members: members.slice(0, MAX_MEMBERS), total: members.length, documents,
    truncated: members.length > MAX_MEMBERS || documents.some(document => document.truncated),
  }
}
