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

import { SignatureService, isReservedPoolWord, moleculeKey } from '@hypercomb/core'
import { ownHiveRoot, setHiveRoot } from './hive-pointer.js'

const get = <T,>(key: string): T | undefined => (window as any).ioc?.get?.(key) as T | undefined

const SIG = /^[0-9a-f]{64}$/
const ZONE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/

/** One creation turned on: whose it is and which of their lineages. */
export type ShowcaseItem = { readonly pubkey: string; readonly lineage: string }
/** A domain's showcase: the items turned on, and the domains shown in full. */
export type Showcase = { readonly zone: string; readonly items: readonly ShowcaseItem[]; readonly domains: readonly string[]
  /** The named pages after All, in the order they are swiped. */
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


/** The index key for one domain's showcase. Never a pool meaning: it names
 *  one root in a signed index, as `welcome:<zone>` does. */
export const showcaseKey = (zone: string): string => `showcase:${zone}`

const itemId = (item: ShowcaseItem): string => `${item.pubkey}\n${item.lineage}`

/** A record, believed only as far as each field survives its check; null when
 *  it is not this zone's showcase. The shim's parseShowcase is the same check. */
export const parseShowcase = (raw: unknown, zone: string): Showcase | null => {
  const record = raw as Record<string, unknown> | null
  if (!record || typeof record !== 'object' || record['kind'] !== 'host:showcase' || record['zone'] !== zone) return null
  const items = parseItems(record['items'])
  const domains = parseDomains(record['domains'])
  const communities = parseCommunities(record['communities'])
  const view = parseView(record['view'])
  return { zone, items, domains, ...(communities.length ? { communities } : {}), ...(view ? { view } : {}) }
}

const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** The record's bytes: canonical — items and domains in code-unit order, no
 *  clock — so the same choice always lands on the same signature, and undoing a
 *  switch lands back on the very resource it left. Communities come last, in
 *  the order they are swiped, and only when there are any: a showcase with
 *  none is the very bytes it was before communities existed. */
export const showcaseBytes = (showcase: Showcase): Uint8Array => {
  const sortedItems = (items: readonly ShowcaseItem[]): { pubkey: string; lineage: string }[] =>
    [...new Map(items.map(item => [itemId(item), item])).values()]
      .sort((a, b) => byCode(itemId(a), itemId(b)))
      .map(item => ({ pubkey: item.pubkey, lineage: item.lineage }))
  const sortedDomains = (domains: readonly string[]): string[] => [...new Set(domains)].sort(byCode)
  const seen = new Set<string>()
  const communities: { name: string; items: { pubkey: string; lineage: string }[]; domains: string[]; view?: ShowcaseView }[] = []
  for (const community of showcase.communities ?? []) {
    const name = communityName(community.name)
    const key = communityKey(name)
    if (!key || seen.has(key) || communities.length >= COMMUNITIES_MAX) continue
    seen.add(key)
    const view = parseView(community.view)
    communities.push({ name, items: sortedItems(community.items), domains: sortedDomains(community.domains), ...(view ? { view } : {}) })
  }
  return new TextEncoder().encode(JSON.stringify({
    kind: 'host:showcase', zone: showcase.zone, items: sortedItems(showcase.items), domains: sortedDomains(showcase.domains),
    ...(communities.length ? { communities } : {}),
    ...(parseView(showcase.view) ? { view: parseView(showcase.view) } : {}),
  }))
}

/** Is this creation in the showcase — named itself, or on a domain shown in full? */
export const showcases = (showcase: Showcase, item: ShowcaseItem, zones: readonly string[] = []): boolean =>
  showcase.items.some(row => itemId(row) === itemId(item)) || zones.some(zone => showcase.domains.includes(zone))

/** One switch: a named creation on when it was off, off when it was on. Off
 *  takes it out of every community in the same commit — a community only ever
 *  filters what the showcase shows. */
export const toggleItem = (showcase: Showcase, item: ShowcaseItem): Showcase => {
  const named = showcase.items.some(row => itemId(row) === itemId(item))
  if (!named) return { ...showcase, items: [...showcase.items, item] }
  return {
    ...showcase,
    items: showcase.items.filter(row => itemId(row) !== itemId(item)),
    ...(showcase.communities ? { communities: showcase.communities.map(community =>
      ({ ...community, items: community.items.filter(row => itemId(row) !== itemId(item)) })) } : {}),
  }
}

/** "Show all" of a domain, or not. Not takes it out of every community too. */
export const toggleDomain = (showcase: Showcase, zone: string): Showcase => {
  if (!showcase.domains.includes(zone)) return { ...showcase, domains: [...showcase.domains, zone] }
  return {
    ...showcase,
    domains: showcase.domains.filter(row => row !== zone),
    ...(showcase.communities ? { communities: showcase.communities.map(community =>
      ({ ...community, domains: community.domains.filter(row => row !== zone) })) } : {}),
  }
}

/** Why a name did not become a community. */
export type CommunityRefusal = 'empty' | 'all' | 'reserved' | 'taken' | 'full'

/** Create a community: the name IS the community. It starts with no members.
 *  `all` is the first page and a reserved pool word is never a name. */
export const addCommunity = (showcase: Showcase, raw: unknown): { ok: true; showcase: Showcase; key: string } | { ok: false; reason: CommunityRefusal } => {
  const name = communityName(raw)
  if (!name) return { ok: false, reason: 'empty' }
  const key = communityKey(name)
  if (!key) return { ok: false, reason: 'all' }
  if (isReservedPoolWord(name)) return { ok: false, reason: 'reserved' }
  const communities = showcase.communities ?? []
  if (communities.some(community => communityKey(community.name) === key)) return { ok: false, reason: 'taken' }
  if (communities.length >= COMMUNITIES_MAX) return { ok: false, reason: 'full' }
  return { ok: true, key, showcase: { ...showcase, communities: [...communities, { name, items: [], domains: [] }] } }
}

/** How the page is drawn: hexagons (the brand's default) or the launcher; `undefined` clears it. */
export const setView = (showcase: Showcase, view: ShowcaseView | undefined): Showcase => {
  const { view: _gone, ...rest } = showcase
  return view ? { ...rest, view } : rest
}

/** How one community is drawn; `undefined` clears it, and it is drawn as All is. */
export const setCommunityView = (showcase: Showcase, key: string, view: ShowcaseView | undefined): Showcase => ({
  ...showcase,
  communities: (showcase.communities ?? []).map(community => {
    if (communityKey(community.name) !== key) return community
    const { view: _gone, ...rest } = community
    return view ? { ...rest, view } : rest
  }),
})

/** Delete a community. Its members stay in the showcase. */
export const removeCommunity = (showcase: Showcase, key: string): Showcase => ({
  ...showcase,
  communities: (showcase.communities ?? []).filter(community => communityKey(community.name) !== key),
})

/** One switch inside a community: a creation in when it was out, out when it was in. */
export const toggleCommunityItem = (showcase: Showcase, key: string, item: ShowcaseItem): Showcase => ({
  ...showcase,
  communities: (showcase.communities ?? []).map(community => {
    if (communityKey(community.name) !== key) return community
    const named = community.items.some(row => itemId(row) === itemId(item))
    return { ...community, items: named ? community.items.filter(row => itemId(row) !== itemId(item)) : [...community.items, item] }
  }),
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

/** Rename a community: the same members under a new name, kept in its place. The new name goes
 *  through the same check as a new one, and is refused when another community already has it. */
export const renameCommunity = (showcase: Showcase, key: string, raw: unknown): { ok: true; showcase: Showcase; key: string } | { ok: false; reason: CommunityRefusal } => {
  const name = communityName(raw)
  if (!name) return { ok: false, reason: 'empty' }
  const next = communityKey(name)
  if (!next) return { ok: false, reason: 'all' }
  if (isReservedPoolWord(name)) return { ok: false, reason: 'reserved' }
  const communities = showcase.communities ?? []
  if (next !== key && communities.some(community => communityKey(community.name) === next)) return { ok: false, reason: 'taken' }
  return { ok: true, key: next, showcase: { ...showcase,
    communities: communities.map(community => (communityKey(community.name) === key ? { ...community, name } : community)) } }
}

/** The record this key already signed for the zone. Null when none is signed.
 *  Throws when a named record cannot be read: that is not an empty showcase. */
export async function readSignedShowcase(zone: string): Promise<Showcase | null> {
  const sig = await ownHiveRoot(zone, showcaseKey(zone))
  if (!sig) return null
  const response = await fetch(`https://${zone}/${sig}`, { cache: 'no-store', signal: AbortSignal.timeout(8_000) })
  if (!response.ok) throw new Error('could not read the showcase')
  const record = parseShowcase(await response.json(), zone)
  if (!record) throw new Error('could not read the showcase')
  return record
}
