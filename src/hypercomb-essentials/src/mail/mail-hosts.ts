// mail/mail-hosts.ts — MAIL COMES FROM THE HOSTS YOU CARRY.
//
// No host is named in code. A host makes mail available by running the Worker
// on its own zone (documentation/mail.md §2a) and listing a key for an address;
// a hive asks the hosts IT carries — the Home Domain first, then Your Network
// (the `community:hosts` pool) — and each that answers `/mail/me` says which of
// its addresses this key owns. Nothing else is contacted
// (no-third-party-requests.md). A hive that carries no host has no mail to ask
// for, and the window says so and opens Your Network.
//
// A pure module: it reads, registers nothing, and is loaded with the window.

import { hostZone, listCommunityHosts } from '../sharing/community-hosts.js'

/** The Home Domain, as the hosts drone keeps it (hosts.drone.ts writes this key; it is only read here). */
const OWN_HOST_KEY = 'hc:nostrmesh:self-domain'

/** The Home Domain's zone, or '' when none is set (or storage cannot be read). */
export const ownHostZone = (): string => {
  try { return hostZone(globalThis.localStorage?.getItem(OWN_HOST_KEY)) } catch { return '' }
}

/**
 * The zones to ask for mail, each once: the Home Domain first, then every host in Your Network,
 * alphabetically as the pool lists them. Empty when the participant carries no host at all.
 */
export async function mailHostZones(): Promise<string[]> {
  const zones: string[] = []
  const own = ownHostZone()
  if (own) zones.push(own)
  let carried: string[] = []
  try { carried = await listCommunityHosts() } catch { carried = [] }
  for (const raw of carried) {
    const zone = hostZone(raw)
    if (zone && !zones.includes(zone)) zones.push(zone)
  }
  return zones
}
