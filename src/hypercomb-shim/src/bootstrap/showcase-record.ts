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

import { SignatureService, moleculeKey } from '@hypercomb/core'
import { verifyEvent } from 'nostr-tools/pure'

const SIG = /^[0-9a-f]{64}$/
const ZONE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/
const LOOPBACK = /^(?:[a-z0-9-]+\.)*localhost(?::\d{1,5})?$/

/** One item turned on: whose it is and which of their lineages. */
export type ShowcaseItem = { readonly pubkey: string; readonly lineage: string }
/** A domain's showcase: the items turned on, and the domains shown in full. */
export type ShowcaseRecord = { readonly zone: string; readonly items: readonly ShowcaseItem[]; readonly domains: readonly string[]
  /** The named pages after All, when the owners made any. */
  readonly communities?: readonly ShowcaseCommunity[]
  /** How the page is drawn; absent, as hexagons. */
  readonly view?: ShowcaseView }

/** HOW A PAGE IS DRAWN (jwize 2026-10-25: "a rendering aspect that keeps the
 *  same images and properties but allows a more traditional row of four
 *  launcher. The default is hexagons for the brand"; "a way on the groups to
 *  change launcher renderings"). The tiles, their pictures and their
 *  properties never change; only the shape they are drawn in does. A closed set
 *  of names here — a name this reader does not know is not a view, and the page
 *  is drawn as hexagons. */
export type ShowcaseView = 'hex' | 'launcher'
export const parseView = (raw: unknown): ShowcaseView | undefined => (raw === 'hex' || raw === 'launcher' ? raw : undefined)

/** A community: a named page of the showcase — a filter over what it already
 *  shows, never a way to show more (jwize 2026-10-25: "you create a community
 *  that is the name"; "swiping between your communities"). */
export type ShowcaseCommunity = { readonly name: string; readonly items: readonly ShowcaseItem[]; readonly domains: readonly string[]
  /** How this community's page is drawn; absent, it is drawn as All is. */
  readonly view?: ShowcaseView }

/** The most communities a showcase carries, and the longest name a community has. */
export const COMMUNITIES_MAX = 24
export const COMMUNITY_NAME_MAX = 40

/** A community's name as it may be shown: no format or control characters, runs
 *  of space folded, cut to 40 code points. '' when it is not a name. */
export const communityName = (raw: unknown): string => {
  if (typeof raw !== 'string') return ''
  const clean = raw.replace(/\p{Cf}/gu, '').replace(/[\p{Cc}\s]+/gu, ' ').trim()
  return [...clean].slice(0, COMMUNITY_NAME_MAX).join('').trim()
}

/** The identity of a community: its name folded the way a molecule folds a
 *  name, so 'Games!' and 'games' are one community. '' for a name that is none
 *  or that is the built-in first page, `all`. */
export const communityKey = (name: unknown): string => {
  const clean = communityName(name)
  const key = clean ? moleculeKey(clean) : ''
  return key && key !== 'all' ? key : ''
}

const parseItems = (raw: unknown): ShowcaseItem[] =>
  (Array.isArray(raw) ? raw as unknown[] : []).slice(0, 2000)
    .map(row => row as Record<string, unknown> | null)
    .filter((row): row is Record<string, unknown> => !!row && SIG.test(String(row['pubkey']))
      && typeof row['lineage'] === 'string' && row['lineage'].length > 0 && row['lineage'].length <= 200)
    .map(row => ({ pubkey: String(row['pubkey']), lineage: String(row['lineage']) }))

const parseDomains = (raw: unknown): string[] =>
  (Array.isArray(raw) ? raw as unknown[] : []).slice(0, 200)
    .filter((domain): domain is string => typeof domain === 'string' && ZONE.test(domain))

/** The communities a record names, believed only as far as each survives its
 *  check. A community that asks for access this reader does not understand is
 *  dropped, never shown: an unknown gate fails closed. */
export const parseCommunities = (raw: unknown): ShowcaseCommunity[] => {
  const seen = new Set<string>()
  const out: ShowcaseCommunity[] = []
  for (const row of (Array.isArray(raw) ? raw as unknown[] : []).slice(0, COMMUNITIES_MAX)) {
    const entry = row as Record<string, unknown> | null
    if (!entry || typeof entry !== 'object') continue
    if (entry['access'] !== undefined && entry['access'] !== 'public') continue
    const name = communityName(entry['name'])
    const key = communityKey(name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    const view = parseView(entry['view'])
    out.push({ name, items: parseItems(entry['items']), domains: parseDomains(entry['domains']), ...(view ? { view } : {}) })
  }
  return out
}


/** What a domain's owners sign, as far as its page needs: the showcase they
 *  chose, and where each of their lineages opens (`doors`; a lineage with no
 *  doors is absent, and opens nowhere the page will showcase). Two flags say
 *  how far the read got, because "nothing" and "could not read" are not the
 *  same answer: `reached` is false when no owner's index could be read at all,
 *  and `unreadable` is true when an index names a showcase that could not be
 *  fetched, verified or understood. Either way the page shows nothing rather
 *  than guess at what the owners meant. */
export type ZoneOwners = {
  readonly showcase: ShowcaseRecord | null
  /** pubkey → lineage → the domains its signed doors name. */
  readonly doors: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>
  readonly reached: boolean
  readonly unreadable: boolean
}

/** Does an owner's signed doors open this lineage on this domain, by name?
 *  Unknown when the key is not one of the domain's owners. */
export const doorsOpen = (owners: ZoneOwners, pubkey: string, lineage: string, zone: string): boolean | undefined => {
  const byLineage = owners.doors.get(pubkey)
  if (!byLineage) return undefined
  return (byLineage.get(lineage) ?? []).some(door => door === zone || zone.endsWith(`.${door}`))
}

/** The index key — and the pool's meaning — for one domain's showcase. */
export const showcaseKey = (zone: string): string => `showcase:${zone}`

/** A record, believed only as far as each field survives its check; null when
 *  it is not this zone's showcase. */
export const parseShowcase = (raw: unknown, zone: string): ShowcaseRecord | null => {
  const record = raw as Record<string, unknown> | null
  if (!record || typeof record !== 'object' || record['kind'] !== 'host:showcase' || record['zone'] !== zone) return null
  const items = parseItems(record['items'])
  const domains = parseDomains(record['domains'])
  const communities = parseCommunities(record['communities'])
  const view = parseView(record['view'])
  return { zone, items, domains, ...(communities.length ? { communities } : {}), ...(view ? { view } : {}) }
}

const fetchJson = async (url: string, limit: number): Promise<{ bytes: ArrayBuffer; value: unknown } | null> => {
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8_000) })
    if (!response.ok || Number(response.headers.get('content-length') ?? 0) > limit) return null
    const bytes = await response.arrayBuffer()
    return bytes.byteLength <= limit ? { bytes, value: JSON.parse(new TextDecoder().decode(bytes)) } : null
  } catch { return null }
}

/**
 * What the zone's owners sign now — the primary owner first — read from the
 * zone itself and checked here: each index by its signature, the showcase by
 * its name. The first owner who NAMES a showcase decides it: if that one cannot
 * be read, the next owner's is not a stand-in. Every owner's doors are kept, so
 * the page shows only what they published here.
 */
export const readZoneOwners = async (zone: string, owners: readonly string[]): Promise<ZoneOwners> => {
  const doors = new Map<string, ReadonlyMap<string, readonly string[]>>()
  let showcase: ShowcaseRecord | null = null
  let reached = false
  let unreadable = false
  let decided = false
  if (!ZONE.test(zone) && !LOOPBACK.test(zone)) return { showcase, doors, reached, unreadable }
  const origin = `${LOOPBACK.test(zone) ? 'http' : 'https'}://${zone}`
  const indexes = await SignatureService.sign(new TextEncoder().encode('hive:indexes').buffer as ArrayBuffer)
  for (const pubkey of owners.filter(key => SIG.test(key)).slice(0, 8)) {
    const index = await fetchJson(`${origin}/${indexes}/${pubkey}`, 524_288)
    const event = index?.value as Record<string, unknown> | undefined
    if (!event || Number(event['kind']) !== 30564 || event['pubkey'] !== pubkey) continue
    try { if (!verifyEvent(event as never)) continue } catch { continue }
    let content: { roots?: Record<string, unknown>; doors?: Record<string, unknown> } | undefined
    try { content = JSON.parse(String(event['content'] ?? '')) } catch { continue }
    reached = true
    const opened = new Map<string, readonly string[]>()
    for (const [lineage, listed] of Object.entries(content?.doors ?? {})) {
      if (Array.isArray(listed)) opened.set(lineage, listed.filter((door): door is string => typeof door === 'string').map(door => door.toLowerCase()))
    }
    doors.set(pubkey, opened)
    if (decided) continue
    const sig = String(content?.roots?.[showcaseKey(zone)] ?? '').toLowerCase()
    if (!SIG.test(sig)) continue
    decided = true
    for (const path of [`/${sig}`, `/content/${sig}`]) {
      const atom = await fetchJson(`${origin}${path}`, 262_144)
      if (!atom || await SignatureService.sign(atom.bytes) !== sig) continue
      const record = parseShowcase(atom.value, zone)
      if (record) { showcase = record; break }
    }
    if (!showcase) unreadable = true
  }
  return { showcase, doors, reached, unreadable }
}
