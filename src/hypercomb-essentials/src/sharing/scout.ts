// sharing/scout.ts
//
// A SCOUT READS POOLS AND BRINGS BACK OFFERS (documentation/pools-across-hosts.md).
//
// Given the meanings a task is about (`family:name`, the words, traits and
// pheromone kinds the task names), it opens each meaning's pool on every host
// the participant follows — `<origin>/<sign(meaning)>`, the same address on
// every host — and counts which signatures show up. A signature that sits in
// several of the task's pools, on several hosts, is the target: the overlap
// IS the triangulation. Nothing is looked up and nothing is indexed.
//
// It follows the rule the pools follow: anyone may promote into a pool,
// nobody has to read one. So the scout
//   · reads only followed hosts, and only a pool's index (a few signatures);
//   · keeps only what the participant's interest set allows;
//   · TAKES NOTHING AND WRITES NOTHING — it returns offers, and replicating
//     one into the workbench is the participant's own act;
//   · says "nothing" by returning nothing, and never invents a meaning.
// Members are not fetched here; whoever takes an offer verifies the bytes
// against the signature, as `published-pools` does.

import { registerPoolMeaning } from '@hypercomb/core'
import { allows as intakeAllows } from '../pheromones/intake-filter.js'
import { listCommunityHosts } from './community-hosts.js'
import { membersOf, originHost, originUrl } from './published-pools.js'

export interface ScoutOffer {
  readonly sig: string
  /** The task meanings whose pool holds it. */
  readonly meanings: readonly string[]
  /** The followed hosts that carry it in any of those pools. */
  readonly hosts: readonly string[]
}

/** One pool's member signatures on one host; empty for any miss. */
export type ScoutRead = (host: string, meaning: string) => Promise<string[]>

export interface ScoutDeps {
  readonly followed?: () => Promise<readonly string[]>
  readonly read?: ScoutRead
  readonly allows?: (carrier: { sig: string }) => Promise<boolean>
}

export const SCOUT_MAX_MEANINGS = 12
export const SCOUT_MAX_OFFERS = 24

const readPool: ScoutRead = async (host, meaning) => {
  try {
    const response = await fetch(`${originUrl(host)}/${await registerPoolMeaning(meaning)}`)
    if (!response.ok) return []
    const text = await response.text()
    let index: unknown
    try { index = JSON.parse(text) } catch { index = text }
    return membersOf(index)
  } catch { return [] }
}

export const scout = async (rawMeanings: readonly string[], deps: ScoutDeps = {}): Promise<ScoutOffer[]> => {
  const meanings = [...new Set(rawMeanings.map(m => String(m ?? '').trim()).filter(Boolean))].slice(0, SCOUT_MAX_MEANINGS)
  const hosts = [...new Set((await (deps.followed ?? listCommunityHosts)()).map(originHost).filter(Boolean))]
  if (!meanings.length || !hosts.length) return []

  const read = deps.read ?? readPool
  const found = new Map<string, { meanings: Set<string>; hosts: Set<string> }>()
  await Promise.all(hosts.flatMap(host => meanings.map(async meaning => {
    for (const sig of await read(host, meaning)) {
      const at = found.get(sig) ?? { meanings: new Set<string>(), hosts: new Set<string>() }
      at.meanings.add(meaning)
      at.hosts.add(host)
      found.set(sig, at)
    }
  })))

  const gate = deps.allows ?? intakeAllows
  const ranked = [...found.entries()]
    .map(([sig, at]) => ({ sig, meanings: [...at.meanings].sort(), hosts: [...at.hosts].sort() }))
    .sort((a, b) => b.meanings.length - a.meanings.length || b.hosts.length - a.hosts.length || a.sig.localeCompare(b.sig))
  const offers: ScoutOffer[] = []
  for (const offer of ranked) {
    if (offers.length >= SCOUT_MAX_OFFERS) break
    if (await gate({ sig: offer.sig })) offers.push(offer)
  }
  return offers
}
