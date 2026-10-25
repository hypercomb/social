// hypercomb-shim/src/bootstrap/showcase-record.ts
//
// WHAT A DOMAIN SHOWCASES (jwize 2026-10-24: "your visitors should only see
// your showcase not your connections"). The owner keeps their domains as a
// list in their own hive; opening one, they turn its items on or off for
// their showcase, or show all of it. What they chose is ONE signed record per
// domain — an atom named in their signed index as `showcase:<zone>`, the same
// path a zone's card takes (`welcome:<zone>`) — so a front door, which holds no
// key and cannot tell its owner from a visitor, draws exactly what the owner
// signed and nothing else.
//
// The record's shape is held to the same check here and in the hive that
// writes it (hypercomb-essentials sharing/showcase-record.ts): a module may not
// import the shim, and the shim may not import a module.

import { SignatureService } from '@hypercomb/core'
import { verifyEvent } from 'nostr-tools/pure'

const SIG = /^[0-9a-f]{64}$/
const ZONE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/
const LOOPBACK = /^(?:[a-z0-9-]+\.)*localhost(?::\d{1,5})?$/

/** One item turned on: whose it is and which of their lineages. */
export type ShowcaseItem = { readonly pubkey: string; readonly lineage: string }
/** A domain's showcase: the items turned on, and the domains shown in full. */
export type ShowcaseRecord = { readonly zone: string; readonly items: readonly ShowcaseItem[]; readonly domains: readonly string[] }

/** The index key — and the pool's meaning — for one domain's showcase. */
export const showcaseKey = (zone: string): string => `showcase:${zone}`

/** A record, believed only as far as each field survives its check; null when
 *  it is not this zone's showcase. */
export const parseShowcase = (raw: unknown, zone: string): ShowcaseRecord | null => {
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

const fetchJson = async (url: string, limit: number): Promise<{ bytes: ArrayBuffer; value: unknown } | null> => {
  try {
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok || Number(response.headers.get('content-length') ?? 0) > limit) return null
    const bytes = await response.arrayBuffer()
    return bytes.byteLength <= limit ? { bytes, value: JSON.parse(new TextDecoder().decode(bytes)) } : null
  } catch { return null }
}

/**
 * The showcase the zone's owners sign now — the primary owner first — read
 * from the zone itself and checked here: the index by its signature, the
 * record by its name. Null when no owner signs one, and then the page shows
 * what opens on the zone, as it always has.
 */
export const readShowcase = async (zone: string, owners: readonly string[]): Promise<ShowcaseRecord | null> => {
  if (!ZONE.test(zone) && !LOOPBACK.test(zone)) return null
  const origin = `${LOOPBACK.test(zone) ? 'http' : 'https'}://${zone}`
  const indexes = await SignatureService.sign(new TextEncoder().encode('hive:indexes').buffer as ArrayBuffer)
  for (const pubkey of owners.filter(key => SIG.test(key)).slice(0, 8)) {
    const index = await fetchJson(`${origin}/${indexes}/${pubkey}`, 524_288)
    const event = index?.value as Record<string, unknown> | undefined
    if (!event || Number(event['kind']) !== 30564 || event['pubkey'] !== pubkey) continue
    try { if (!verifyEvent(event as never)) continue } catch { continue }
    let roots: Record<string, unknown> | undefined
    try { roots = (JSON.parse(String(event['content'] ?? '')) as { roots?: Record<string, unknown> }).roots } catch { continue }
    const sig = String(roots?.[showcaseKey(zone)] ?? '').toLowerCase()
    if (!SIG.test(sig)) continue
    for (const path of [`/${sig}`, `/content/${sig}`]) {
      const atom = await fetchJson(`${origin}${path}`, 262_144)
      if (!atom || await SignatureService.sign(atom.bytes) !== sig) continue
      const record = parseShowcase(atom.value, zone)
      if (record) return record
    }
  }
  return null
}
