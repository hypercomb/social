// sharing/item-details.ts
//
// MORE ABOUT ONE ITEM IN A COMMUNITY (documentation/item-details.md; jwize
// 2026-11-18: "share more information if you are the author"; "using pools so
// that it is a proper extension point like everything").
//
// What is said about a published item is a pool of meaning, never a field on
// the item: `details:<sign(publisher key + lineage)>`. This hive says more by
// putting ONE record on the domain's showcase home and naming it in its OWN
// signed index under that meaning — the path a page's contributions take
// (page-contributions.ts). A record is named parts, `{ name, text }`; the names
// are open, so anything may add a part of its own, and a reader draws every
// part it is given.
//
// MIRRORED: hypercomb-shim/src/bootstrap/item-details.ts holds the same key
// and the same bytes, and is the reader. A module may not import the shim.

import { SignatureService, registerPoolMeaning } from '@hypercomb/core'
import { clearHiveRoot } from './hive-pointer.js'
import { hostOfferDeps, type HostOfferDeps } from './host-offer.js'
import { showcaseHome } from './showcase-record.js'

export const DETAILS_PREFIX = 'details:'
export const DETAILS_KIND = 'item:details'
export const PARTS_MAX = 12
export const PART_NAME_MAX = 40
export const PART_TEXT_MAX = 2000

const SIG = /^[0-9a-f]{64}$/
const ZONE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/

export type DetailPart = { readonly name: string; readonly text: string }
export type DetailsItem = { readonly pubkey: string; readonly lineage: string }
export type DetailsRequest = { readonly zone: string; readonly pubkey: string; readonly lineage: string; readonly parts: unknown }
export type DetailsResult = { readonly ok: true; readonly changed: boolean } | { readonly ok: false; readonly reason: string }

/** The index key, and the pool meaning, an item's details are found under. */
export const detailsKey = async (item: DetailsItem): Promise<string> => {
  const key = `${DETAILS_PREFIX}${await SignatureService.sign(new TextEncoder().encode(`${item.pubkey}\n${item.lineage}`).buffer as ArrayBuffer)}`
  await registerPoolMeaning(key)
  return key
}

const words = (value: unknown, max: number, lines: boolean): string => {
  if (typeof value !== 'string') return ''
  const clean = value.replace(/\p{Cf}/gu, '').replace(/\r\n?/g, '\n')
  const folded = lines
    ? clean.replace(/[^\S\n]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n')
    : clean.replace(/\s+/g, ' ')
  return [...folded.trim()].slice(0, max).join('').trim()
}

/** The parts a record may carry: each named once (the first wins), each with words, the first twelve. */
export const cleanParts = (raw: unknown): DetailPart[] => {
  const seen = new Set<string>()
  const parts: DetailPart[] = []
  for (const row of Array.isArray(raw) ? raw as unknown[] : []) {
    const entry = row as Record<string, unknown> | null
    const name = words(entry?.['name'], PART_NAME_MAX, false).toLowerCase()
    const text = words(entry?.['text'], PART_TEXT_MAX, true)
    if (!name || !text || seen.has(name)) continue
    seen.add(name)
    parts.push({ name, text })
    if (parts.length === PARTS_MAX) break
  }
  return parts
}

/** A record, canonical: the same words about the same item are always the same signature. */
export const detailsText = (item: DetailsItem, parts: readonly DetailPart[]): string =>
  JSON.stringify({
    kind: DETAILS_KIND, pubkey: item.pubkey, lineage: item.lineage,
    parts: cleanParts(parts).map(part => ({ name: part.name, text: part.text })),
  })

export type DetailsDeps = {
  readonly offer?: () => HostOfferDeps | null
  readonly home?: (zone: string) => Promise<string | null>
  readonly clear?: (host: string, key: string) => Promise<{ ok: boolean; reason?: string }>
}

/** Say this about the item, under this hive's own key, where the zone's visitors read its index. No parts takes
 *  the word back: the index stops naming it, and the bytes are left where they are. */
export async function applyDetails(request: DetailsRequest, deps: DetailsDeps = {}): Promise<DetailsResult> {
  const zone = String(request.zone ?? '').toLowerCase()
  const pubkey = String(request.pubkey ?? '').toLowerCase()
  const lineage = typeof request.lineage === 'string' ? request.lineage : ''
  if (!ZONE.test(zone) || !SIG.test(pubkey) || !lineage || lineage.length > 200 || !Array.isArray(request.parts)) return { ok: false, reason: 'bad request' }
  const item = { pubkey, lineage }
  const key = await detailsKey(item)
  const host = (await (deps.home ?? showcaseHome)(zone).catch(() => null)) ?? zone
  const parts = cleanParts(request.parts)
  if (!parts.length) {
    const cleared = await (deps.clear ?? clearHiveRoot)(host, key)
    return cleared.ok ? { ok: true, changed: cleared.reason !== 'unchanged' } : { ok: false, reason: cleared.reason ?? 'the details were not taken back' }
  }
  const offer = (deps.offer ?? hostOfferDeps)()
  if (!offer) return { ok: false, reason: 'the hive is not ready to publish' }
  const sig = await offer.put(detailsText(item, parts), 'application/json')
  const published = await offer.publish(host, [sig])
  if (!published.ok) return { ok: false, reason: published.error }
  const stamped = await offer.stamp(host, key, sig)
  return stamped.ok ? { ok: true, changed: stamped.reason !== 'unchanged' } : { ok: false, reason: stamped.reason ?? 'the details were not named in your index' }
}
