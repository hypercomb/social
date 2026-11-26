// sharing/network-hosts.ts
//
// EVERY HOST THIS HIVE CAN ASK (jwize 2026-11-13: "you should be able to do
// this natively with all of your hosts that are network").
//
// A hive is always on its network as a reader, whatever it has or has not
// published. The hosts it can ask are the ones the participant carries
// (`community:hosts`) and the ones its content broker already fetches from
// (its own domain, the community's, the ones a session learned), and the
// public content host ALWAYS (reach A3, 2026-11-25: a door's list was never
// empty after PR 183, so the public host was asked only when the broker had
// happened to learn it, and `host:offerings` read 1 member instead of 15).
// A managed door also reads its own site's PUBLIC `community:hosts`, one hop.
//
// One list for every read that leaves the hive by a derived address, so a
// model's `pool` and `explore` ask the same hosts. What goes out to any of
// them is a signature and nothing else.

import { SignatureService } from '@hypercomb/core'
import { fetchWithDeadline } from './bounded-fetch.js'
import { COMMUNITY_HOSTS_POOL, listCommunityHosts, zoneOfHostMeaning } from './community-hosts.js'
import { lensOrigin, listingMembers } from './community-lens.js'
import { PUBLIC_CONTENT_HOSTS } from './hive-link.js'
import { isManagedSiteDoor } from './managed-record.js'
import { askPoolListing } from './pool-listing.js'
import { readDoorsOf, siteZoneOf } from './zone-door.js'

type BrokerLike = { knownContentHosts?: () => readonly string[] }

const broker = (): BrokerLike | undefined =>
  (globalThis as { ioc?: { get?: (key: string) => unknown } }).ioc
    ?.get?.('@diamondcoreprocessor.com/ContentBrokerDrone') as BrokerLike | undefined

const HOST = /^[a-z0-9.:[\]-]+$/

/** A MANAGED SITE DOOR ASKS ITS OWN SITE (2026-11-16): the page was served by
 *  that site, so it is a host this page already reads from. A fresh profile's
 *  broker has learned no host yet, and the door asked only the public content
 *  host, so its own zone's community could not be read. Only on a door the
 *  worker's record marks (managed-record.ts); everywhere else the page's
 *  address never enters the list. */
const doorHost = (): string[] => {
  try {
    if (!isManagedSiteDoor()) return []
    const host = String((globalThis as { location?: { host?: string } }).location?.host ?? '')
    return host ? [host] : []
  } catch { return [] }
}

// ── A DOOR'S PUBLIC COMMUNITY, ONE HOP (reach A7) ───────────────────────────
//
// `listCommunityHosts` reads this device's own pool. A site door also SERVES
// one: the worker lists `sign('community:hosts')` at every door it answers,
// filled from its own people's signed `follow:<zone>` keys. It is asked here,
// quietly, at the door and at the zone root the door sits under (when that
// root is already a host this page asks): one listing GET per host, 64-hex
// members only, each member believed only when its bytes hash to its name and
// it reads as a host artifact (`{meaning:'host:<zone>'}`). At most
// PUBLIC_COMMUNITY_MAX zones, every host and member at once under one
// deadline, read once per page for the hosts it asks (again when those change,
// or after an empty answer), never waited on past a moment by a list read,
// and a zone found here is never asked for ITS community: one hop, no walk.

/** Zones one page takes from the public community reads. */
export const PUBLIC_COMMUNITY_MAX = 16
/** A host artifact record is a line of JSON; past this it is not one. */
const MEMBER_MAX_BYTES = 4_096
const PUBLIC_TIMEOUT_MS = 4_000

export interface PublicCommunityDeps {
  /** sign(meaning). */
  address(meaning: string): Promise<string>
  /** A pool's listing at a host, or null for no listing. */
  listing(host: string, address: string): Promise<string | null>
  /** One member's bytes from a host's pool, unverified, or null. */
  member(host: string, address: string, sig: string): Promise<Uint8Array | null>
  /** sha256 hex of bytes. */
  sign(bytes: Uint8Array): Promise<string>
}

export const livePublicCommunityDeps: PublicCommunityDeps = {
  address: meaning => SignatureService.sign(new TextEncoder().encode(meaning).buffer as ArrayBuffer),
  listing: async (host, address) => {
    const said = await askPoolListing(lensOrigin(host), address, { timeoutMs: PUBLIC_TIMEOUT_MS })
    return said.state === 'listed' ? said.text : null
  },
  member: async (host, address, sig) => {
    try {
      const response = await fetchWithDeadline(`${lensOrigin(host)}/${address}/${sig}`, { cache: 'no-store' }, { timeoutMs: PUBLIC_TIMEOUT_MS })
      if (!response.ok || response.status === 204) return null
      const bytes = new Uint8Array(await response.arrayBuffer())
      return bytes.byteLength && bytes.byteLength <= MEMBER_MAX_BYTES ? bytes : null
    } catch { return null }
  },
  sign: bytes => SignatureService.sign(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer),
}

/** The whole public community read, every host and member: one deadline. */
export const PUBLIC_COMMUNITY_DEADLINE_MS = 5_000
/** How long a `networkHosts()` call waits on a community read still running.
 *  Past it the call answers without the community and the read keeps going,
 *  so the next call has it: the read is never the critical path. */
export const PUBLIC_COMMUNITY_WAIT_MS = 1_200
/** An empty community answer is asked again after this, never kept for the page. */
const PUBLIC_COMMUNITY_RETRY_MS = 30_000

/** The zones the public `community:hosts` of `hosts` names, verified, at most
 *  PUBLIC_COMMUNITY_MAX. Only `hosts` are asked; a zone found is not. Every
 *  host and every member is asked at once, and the whole read ends at
 *  `deadlineMs` with what was verified by then. Never throws. */
export const readPublicCommunityHosts = async (
  hosts: readonly string[],
  deps: PublicCommunityDeps = livePublicCommunityDeps,
  deadlineMs: number = PUBLIC_COMMUNITY_DEADLINE_MS,
): Promise<string[]> => {
  let address: string
  try { address = await deps.address(COMMUNITY_HOSTS_POOL) } catch { return [] }
  const asked = [...new Set(hosts)]
  // One slot per host, one per member in listing order: the answer keeps the
  // order a sequential read gave, whatever answers first.
  const slots: (string | null)[][] = asked.map(() => [])
  const zoneOf = async (host: string, sig: string): Promise<string | null> => {
    const bytes = await deps.member(host, address, sig).catch(() => null)
    if (!bytes || bytes.byteLength > MEMBER_MAX_BYTES || (await deps.sign(bytes).catch(() => '')) !== sig) return null
    try {
      return zoneOfHostMeaning((JSON.parse(new TextDecoder().decode(bytes)) as { meaning?: unknown })?.meaning) || null
    } catch { return null /* a member that will not parse is not a host */ }
  }
  const all = Promise.all(asked.map(async (host, index) => {
    const members = (listingMembers(await deps.listing(host, address).catch(() => null)) ?? []).slice(0, PUBLIC_COMMUNITY_MAX)
    slots[index] = members.map(() => null)
    await Promise.all(members.map(async (sig, at) => { slots[index]![at] = await zoneOf(host, sig) }))
  })).catch(() => undefined)
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([all, new Promise<void>(resolve => { timer = setTimeout(resolve, deadlineMs) })])
  clearTimeout(timer)
  const zones = new Set<string>()
  for (const zone of slots.flat()) {
    if (zones.size >= PUBLIC_COMMUNITY_MAX) break
    if (zone) zones.add(zone)
  }
  return [...zones]
}

let publicCommunity: { asked: string; read: Promise<string[]>; retryAt: number } | null = null

/** Forget the page's public community read (a test starts clean). */
export const forgetPublicCommunityHosts = (): void => { publicCommunity = null }

/** The door and the root it sits under among `known`. Read once per page for
 *  the hosts it asks, and asked again when those change (the broker learned
 *  the zone root after the first read) or when the read found nothing. */
const doorCommunity = (door: readonly string[], known: readonly string[]): Promise<string[]> => {
  if (!door.length) return Promise.resolve([])
  const asked = readDoorsOf([...door, ...door.map(host => siteZoneOf(host, known))])
  const key = [...new Set(asked)].sort().join(' ')
  if (!publicCommunity || publicCommunity.asked !== key || Date.now() >= publicCommunity.retryAt) {
    const entry = { asked: key, read: Promise.resolve([] as string[]), retryAt: Number.POSITIVE_INFINITY }
    entry.read = readPublicCommunityHosts(asked).catch(() => [] as string[]).then(zones => {
      if (!zones.length) entry.retryAt = Date.now() + PUBLIC_COMMUNITY_RETRY_MS
      return zones
    })
    publicCommunity = entry
  }
  const read = publicCommunity.read
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([read, new Promise<string[]>(resolve => { timer = setTimeout(() => resolve([]), PUBLIC_COMMUNITY_WAIT_MS) })])
    .finally(() => clearTimeout(timer))
}

const clean = (hosts: readonly unknown[]): string[] => hosts
  .map(host => String(host ?? '').trim().toLowerCase())
  .filter(host => host && host.length <= 260 && HOST.test(host))

/** The hosts, folded and sorted: carried ones, the broker's, the door's, its
 *  public community, and the public content host, as one set. */
export const networkHosts = async (): Promise<string[]> => {
  const carried = await listCommunityHosts().catch(() => [] as string[])
  let known: readonly string[] = []
  try { known = broker()?.knownContentHosts?.() ?? [] } catch { /* no broker in this shell */ }
  const door = clean(doorHost())
  const gathered = readDoorsOf(clean([...carried, ...known, ...door, ...PUBLIC_CONTENT_HOSTS]))
  const community = await doorCommunity(door, gathered)
  // The retired `content.` face is its zone. Sites stay in the list: whether
  // one shows is decided by what it adds (zone-door.ts zonesOf).
  return readDoorsOf(clean([...gathered, ...community])).sort()
}
