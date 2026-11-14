// sharing/community-candidates.ts
//
// WHAT CAN BE PROMOTED (jwize 2026-11-13: "there should be a three stage publish").
//
//   1. replicate — you have a host and you follow somebody;
//   2. the domain — in that domain's list a creation is on or off (the offers
//      document, static-peers.drone.ts);
//   3. the community — what is on in a domain stands here grayed, and a click
//      promotes it; a click on one that is on takes it back out, and it is then
//      "in the domain but not in the community".
//
// This is the pure half of step 3: the tiles the community window draws. One
// tile per INSTANCE — a publisher's lineage — so the same name on two domains
// under two keys is two tiles, each saying its domain, and you click the one you
// mean. The same instance served by several domains is one tile naming them all:
// a showcase item is `{ pubkey, lineage }` and carries no host.

import type { ShowcaseItem } from './showcase-record.js'

/** One creation that is on in a domain: whose it is, which lineage, and where it is served. */
export interface OfferedInstance {
  readonly name: string
  readonly pubkey: string
  readonly lineage: string
  readonly hosts: readonly string[]
}

/** One tile of the community window. */
export interface CommunityCandidate extends ShowcaseItem {
  /** The word on the tile: the last segment of the lineage. */
  readonly name: string
  /** The domains it is served from; empty for a lineage of your own on this zone. */
  readonly hosts: readonly string[]
  /** True when another tile wears the same name: the domain then tells them apart. */
  readonly shared: boolean
}

const id = (item: ShowcaseItem): string => `${item.pubkey}\n${item.lineage}`
const nameOf = (lineage: string): string => lineage.split('/').map(part => part.trim()).filter(Boolean).at(-1) ?? lineage

/**
 * Your own lineages on the zone, then what is on in the domains you follow, then
 * anything the record already names that neither list knows — so a tile that is
 * on can always be found and turned off. Sorted by name, then domain.
 */
export const communityCandidates = (
  own: readonly ShowcaseItem[],
  offered: readonly OfferedInstance[],
  named: readonly ShowcaseItem[],
): CommunityCandidate[] => {
  const found = new Map<string, { pubkey: string; lineage: string; name: string; hosts: Set<string> }>()
  const take = (item: ShowcaseItem, name: string, hosts: readonly string[]): void => {
    if (!item.pubkey || !item.lineage) return
    const held = found.get(id(item)) ?? { pubkey: item.pubkey, lineage: item.lineage, name, hosts: new Set<string>() }
    for (const host of hosts) if (host) held.hosts.add(host.toLowerCase())
    found.set(id(item), held)
  }
  for (const item of own) take(item, nameOf(item.lineage), [])
  for (const instance of offered) take(instance, instance.name || nameOf(instance.lineage), instance.hosts)
  for (const item of named) take(item, nameOf(item.lineage), [])

  const wearers = new Map<string, number>()
  for (const row of found.values()) wearers.set(row.name.toLowerCase(), (wearers.get(row.name.toLowerCase()) ?? 0) + 1)
  return [...found.values()]
    .map(row => ({
      pubkey: row.pubkey, lineage: row.lineage, name: row.name, hosts: [...row.hosts].sort(),
      shared: (wearers.get(row.name.toLowerCase()) ?? 0) > 1,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || (a.hosts[0] ?? '').localeCompare(b.hosts[0] ?? '') || (id(a) < id(b) ? -1 : 1))
}
