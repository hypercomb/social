// hypercomb-shim/src/bootstrap/item-details.ts
//
// MORE ABOUT ONE ITEM IN A COMMUNITY (jwize 2026-11-18: "you should be able to hold down on the item and open up
// the row's details … get more information and share more information if you are the author"; "using pools so that
// it is a proper extension point like everything").
//
// What is said about an item is a POOL OF MEANING, never a field on the item. The item is the publisher's key and
// the lineage they publish under (a showcase item); its pool's meaning is `details:<sign(key + lineage)>`. Anybody
// with a key says more by putting ONE record on a host and naming it in their OWN signed index under that meaning
// — the path a page's contributions take (`page:<base>`). A host that knows the convention lists who spoke at the
// pool's derived address, `<origin>/<sign(meaning)>/`, one key per line; the listing is membership only, and each
// speaker's word is read back from their own index and checked against its name.
//
// The author is asked first and by key, listing or not: the item names its publisher, so the author's own word is
// found on a host that lists no pools at all. Everybody else is found by the listing.
//
// A record is named parts, `{ name, text }`. The names are open: `about` is the one the page writes; a part this
// reader has no special drawing for is drawn as its name over its words. Words only, drawn as text.
//
// MIRRORED: hypercomb-essentials/src/sharing/item-details.ts holds the same key and the same bytes.

import { SignatureService, listPoolNames } from '@hypercomb/core'
import { readOwnerIndex, zoneOrigin, type ShowcaseItem } from './showcase-record'

const SIG = /^[0-9a-f]{64}$/

export const DETAILS_PREFIX = 'details:'
export const DETAILS_KIND = 'item:details'
/** The part the page itself writes and draws without a heading. */
export const ABOUT_PART = 'about'
export const PARTS_MAX = 12
export const PART_NAME_MAX = 40
export const PART_TEXT_MAX = 2000
/** Speakers read per host per item: a pool to look through, not a dump. */
export const SPEAKERS_SHOWN = 16
const HOSTS_ASKED = 3
const RECORD_BYTES_MAX = 65_536

export type DetailPart = { readonly name: string; readonly text: string }
/** What one key says about one item. */
export type ItemDetails = { readonly by: string; readonly parts: readonly DetailPart[] }

const sha = (value: string | Uint8Array): Promise<string> =>
  SignatureService.sign((typeof value === 'string' ? new TextEncoder().encode(value) : value).slice().buffer as ArrayBuffer)

/** The item's own signature: its publisher's key and its lineage, as a showcase names it. */
export const itemSignature = (item: ShowcaseItem): Promise<string> => sha(`${item.pubkey}\n${item.lineage}`)

/** The index key, and the pool meaning, an item's details are found under. */
export const detailsKey = async (item: ShowcaseItem): Promise<string> => `${DETAILS_PREFIX}${await itemSignature(item)}`

/** Words from outside, as plain words: no format characters, line breaks kept, cut to length. */
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

/** A record's bytes, canonical: the same words about the same item are always the same signature. */
export const detailsBytes = (item: ShowcaseItem, parts: readonly DetailPart[]): Uint8Array =>
  new TextEncoder().encode(JSON.stringify({
    kind: DETAILS_KIND, pubkey: item.pubkey, lineage: item.lineage,
    parts: cleanParts(parts).map(part => ({ name: part.name, text: part.text })),
  }))

/** A record, believed only when it is about this item; its parts as far as each survives its check. */
export const parseDetails = (raw: unknown, item: ShowcaseItem): DetailPart[] | null => {
  const record = raw as Record<string, unknown> | null
  if (!record || typeof record !== 'object' || record['kind'] !== DETAILS_KIND) return null
  if (record['pubkey'] !== item.pubkey || record['lineage'] !== item.lineage) return null
  return cleanParts(record['parts'])
}

/** The keys a host lists in the item's pool, or none: a host with no such pool, or no listing at all, lists nobody. */
const speakersOn = async (host: string, pool: string): Promise<string[]> =>
  (await listPoolNames(zoneOrigin(host), pool)).map(name => name.toLowerCase()).filter(name => SIG.test(name)).slice(-SPEAKERS_SHOWN)

/** What `by` says about the item on `host`: their own signed index names the record, and the record hashes to its name. */
const wordOf = async (host: string, by: string, key: string, item: ShowcaseItem): Promise<DetailPart[] | null> => {
  const index = await readOwnerIndex(host, by).catch(() => null)
  if (!index || index === 'missing') return null
  const roots = index.content['roots'] && typeof index.content['roots'] === 'object' ? index.content['roots'] as Record<string, unknown> : {}
  const sig = String(roots[key] ?? '').toLowerCase()
  if (!SIG.test(sig)) return null
  try {
    const response = await fetch(`${zoneOrigin(host)}/${sig}`, { cache: 'no-store', signal: AbortSignal.timeout(8_000) })
    if (!response.ok) return null
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > RECORD_BYTES_MAX || await sha(bytes) !== sig) return null
    return parseDetails(JSON.parse(new TextDecoder().decode(bytes)), item)
  } catch { return null }
}

/**
 * Everything said about an item on these hosts, the author first, then the rest in the order they were found. One
 * word per key: the first host that serves it. `also` are keys asked whether or not a host lists them (this
 * browser's own, so what it just saved shows before any listing does).
 */
export const readDetails = async (hosts: readonly string[], item: ShowcaseItem, also: readonly string[] = []): Promise<ItemDetails[]> => {
  if (!SIG.test(item.pubkey) || !item.lineage) return []
  const key = await detailsKey(item)
  const pool = await sha(key)
  const asked = [...new Set(hosts.map(host => String(host ?? '').toLowerCase()).filter(Boolean))].slice(0, HOSTS_ASKED)
  const first = [item.pubkey, ...also.map(by => by.toLowerCase()).filter(by => SIG.test(by))]
  const found = new Map<string, readonly DetailPart[]>()
  await Promise.all(asked.map(async host => {
    const speakers = [...new Set([...first, ...await speakersOn(host, pool)])]
    await Promise.all(speakers.map(async by => {
      const parts = await wordOf(host, by, key, item)
      if (parts?.length && !found.has(by)) found.set(by, parts)
    }))
  }))
  const order = [...found.keys()].sort((a, b) => Number(b === item.pubkey) - Number(a === item.pubkey))
  return order.map(by => ({ by, parts: found.get(by)! }))
}
