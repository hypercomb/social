// sharing/showcase-record.ts
//
// WHAT YOUR ADDRESS SHOWS (jwize 2026-10-24: "The showcase is the only thing
// people see when they are at your address. You see your whole network.").
// You turn a domain's creations on or off for your showcase; the choice for one
// domain is ONE record — the items turned on, and the domains shown in full —
// kept in your hive as a resource whose signature rides a passive layer slot,
// so a switch is an ordinary commit and undo is the hive's own. In public the
// same bytes go to the domain and are named in your signed index as
// `showcase:<zone>`, the path a zone's card takes (host-welcome.ts), and the
// front door draws exactly that (hypercomb-shim bootstrap/showcase-record.ts,
// which holds the record to the same check — a module may not import the shim).
//
// Full design: documentation/showcase.md.

import { SignatureService } from '@hypercomb/core'
import { setHiveRoot } from './hive-pointer.js'

const get = <T,>(key: string): T | undefined => (window as any).ioc?.get?.(key) as T | undefined

const SIG = /^[0-9a-f]{64}$/
const ZONE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/

/** One creation turned on: whose it is and which of their lineages. */
export type ShowcaseItem = { readonly pubkey: string; readonly lineage: string }
/** A domain's showcase: the items turned on, and the domains shown in full. */
export type Showcase = { readonly zone: string; readonly items: readonly ShowcaseItem[]; readonly domains: readonly string[] }

/** The index key for one domain's showcase. Never a pool meaning: it names
 *  one root in a signed index, as `welcome:<zone>` does. */
export const showcaseKey = (zone: string): string => `showcase:${zone}`

const itemId = (item: ShowcaseItem): string => `${item.pubkey}\n${item.lineage}`

/** A record, believed only as far as each field survives its check; null when
 *  it is not this zone's showcase. The shim's parseShowcase is the same check. */
export const parseShowcase = (raw: unknown, zone: string): Showcase | null => {
  const record = raw as Record<string, unknown> | null
  if (!record || typeof record !== 'object' || record['kind'] !== 'host:showcase' || record['zone'] !== zone) return null
  const items = (Array.isArray(record['items']) ? record['items'] as unknown[] : []).slice(0, 2000)
    .map(row => row as Record<string, unknown> | null)
    .filter((row): row is Record<string, unknown> => !!row && SIG.test(String(row['pubkey']))
      && typeof row['lineage'] === 'string' && row['lineage'].length > 0 && row['lineage'].length <= 200)
    .map(row => ({ pubkey: String(row['pubkey']), lineage: String(row['lineage']) }))
  const domains = (Array.isArray(record['domains']) ? record['domains'] as unknown[] : []).slice(0, 200)
    .filter((domain): domain is string => typeof domain === 'string' && ZONE.test(domain))
  return { zone, items, domains }
}

/** The record's bytes: canonical — items and domains sorted, no clock — so the
 *  same choice always lands on the same signature, and undoing a switch lands
 *  back on the very resource it left. */
export const showcaseBytes = (showcase: Showcase): Uint8Array => {
  const items = [...new Map(showcase.items.map(item => [itemId(item), item])).values()]
    .sort((a, b) => itemId(a).localeCompare(itemId(b)))
    .map(item => ({ pubkey: item.pubkey, lineage: item.lineage }))
  const domains = [...new Set(showcase.domains)].sort()
  return new TextEncoder().encode(JSON.stringify({ kind: 'host:showcase', zone: showcase.zone, items, domains }))
}

/** Is this creation in the showcase — named itself, or on a domain shown in full? */
export const showcases = (showcase: Showcase, item: ShowcaseItem, zones: readonly string[] = []): boolean =>
  showcase.items.some(row => itemId(row) === itemId(item)) || zones.some(zone => showcase.domains.includes(zone))

/** One switch: a named creation on when it was off, off when it was on. */
export const toggleItem = (showcase: Showcase, item: ShowcaseItem): Showcase => {
  const named = showcase.items.some(row => itemId(row) === itemId(item))
  return { ...showcase, items: named ? showcase.items.filter(row => itemId(row) !== itemId(item)) : [...showcase.items, item] }
}

/** "Show all" of a domain, or not. */
export const toggleDomain = (showcase: Showcase, zone: string): Showcase => ({
  ...showcase,
  domains: showcase.domains.includes(zone) ? showcase.domains.filter(row => row !== zone) : [...showcase.domains, zone],
})

type HostSyncLike = {
  publishAtoms?: (host: string, sigs: readonly string[], bytesOf: (sig: string) => Promise<Uint8Array | null>) =>
    Promise<{ ok: true } | { ok: false; error: string }>
}

/** Send the showcase to its domain and name it in the signed index as
 *  `showcase:<zone>` — what the front door reads. */
export async function signShowcase(showcase: Showcase): Promise<{ ok: true; sig: string } | { ok: false; reason: string }> {
  if (!ZONE.test(showcase.zone)) return { ok: false, reason: 'not a domain' }
  const bytes = showcaseBytes(showcase)
  const sig = await SignatureService.sign(bytes.slice().buffer as ArrayBuffer)
  const sync = get<HostSyncLike>('@diamondcoreprocessor.com/HostSyncService')
  if (!sync?.publishAtoms) return { ok: false, reason: 'host sync is not available here' }
  const sent = await sync.publishAtoms(showcase.zone, [sig], async wanted => (wanted === sig ? bytes : null))
  if (!sent.ok) return { ok: false, reason: sent.error }
  const stamped = await setHiveRoot(showcase.zone, showcaseKey(showcase.zone), sig)
  return stamped.ok ? { ok: true, sig } : { ok: false, reason: stamped.reason ?? 'the index refused it' }
}
