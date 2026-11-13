// sharing/network-hosts.ts
//
// EVERY HOST THIS HIVE CAN ASK (jwize 2026-11-13: "you should be able to do
// this natively with all of your hosts that are network").
//
// A hive is always on its network as a reader, whatever it has or has not
// published. The hosts it can ask are the ones the participant carries
// (`community:hosts`) and the ones its content broker already fetches from
// (its own domain, the community's, the ones a session learned). Carrying
// none, the public content host is asked, as `discover` does.
//
// One list for every read that leaves the hive by a derived address, so a
// model's `pool` and `explore` ask the same hosts. What goes out to any of
// them is a signature and nothing else.

import { listCommunityHosts } from './community-hosts.js'
import { PUBLIC_CONTENT_HOSTS } from './hive-link.js'

type BrokerLike = { knownContentHosts?: () => readonly string[] }

const broker = (): BrokerLike | undefined =>
  (globalThis as { ioc?: { get?: (key: string) => unknown } }).ioc
    ?.get?.('@diamondcoreprocessor.com/ContentBrokerDrone') as BrokerLike | undefined

const HOST = /^[a-z0-9.:[\]-]+$/

/** The hosts, folded and sorted, carried ones and the broker's as one set. */
export const networkHosts = async (): Promise<string[]> => {
  const carried = await listCommunityHosts().catch(() => [] as string[])
  let known: readonly string[] = []
  try { known = broker()?.knownContentHosts?.() ?? [] } catch { /* no broker in this shell */ }
  const hosts = [...new Set([...carried, ...known]
    .map(host => String(host ?? '').trim().toLowerCase())
    .filter(host => host && host.length <= 260 && HOST.test(host)))].sort()
  return hosts.length ? hosts : [...PUBLIC_CONTENT_HOSTS]
}
