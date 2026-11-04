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

import { KEY_LIST_MEANING, SignatureService, moleculeKey, verifyKeyListChain, type SignedKeyList } from '@hypercomb/core'
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
 *  of names here, in the order a sideways swipe walks them while managing —
 *  a name this reader does not know is not a view, and the page is drawn as
 *  hexagons. A new idea is another name in this list, drawn by both readers. */
export const SHOWCASE_VIEWS = ['hex', 'launcher', 'iphone', 'list', 'tiles'] as const
export type ShowcaseView = (typeof SHOWCASE_VIEWS)[number]
export const parseView = (raw: unknown): ShowcaseView | undefined =>
  (typeof raw === 'string' && (SHOWCASE_VIEWS as readonly string[]).includes(raw) ? raw as ShowcaseView : undefined)

const VIEW_LABELS: Record<ShowcaseView, string> = { hex: 'Hexagons', launcher: 'Launcher', iphone: 'iPhone', list: 'List', tiles: 'Tiles' }
/** The words a person sees for a template. */
export const viewLabel = (view: ShowcaseView): string => VIEW_LABELS[view]

/** The template a sideways step lands on. Absent is hexagons, the brand's default. */
export const stepView = (current: ShowcaseView | undefined, by: -1 | 1): ShowcaseView => {
  const at = Math.max(0, SHOWCASE_VIEWS.indexOf(current ?? 'hex'))
  return SHOWCASE_VIEWS[(at + by + SHOWCASE_VIEWS.length) % SHOWCASE_VIEWS.length]!
}

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
  /** Heads the first owner lists as live (`stage:live`). Absent when that
   *  index has no live list: a door is enough, as it was before the list
   *  existed. Present: a head that is not in it is not on the visitor site,
   *  even when a door still names the domain. */
  readonly live?: ReadonlySet<string>
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

/** The index key of the author's live list: the heads a visitor site may show. */
const LIVE_ROOT = 'stage:live'

/** Bytes at `sig` whose hash is `sig`, from either face of the origin. */
const verified = async (origin: string, sig: string, limit: number): Promise<unknown | null> => {
  for (const path of [`/${sig}`, `/content/${sig}`]) {
    const atom = await fetchJson(`${origin}${path}`, limit)
    if (!atom || atom === 'missing' || await SignatureService.sign(atom.bytes) !== sig) continue
    return atom.value
  }
  return null
}

/** The heads an author's `stage:live` claim lists, or null when the claim
 *  cannot be read. An empty set is a list that names nothing. */
const readLiveHeads = async (origin: string, root: string): Promise<ReadonlySet<string> | null> => {
  if (!SIG.test(root)) return null
  const claim = await verified(origin, root, 65_536) as { kind?: unknown; tags?: unknown } | null
  if (!claim || Number(claim.kind) !== 30565) return null
  try { if (!verifyEvent(claim as never)) return null } catch { return null }
  const tag = (Array.isArray(claim.tags) ? claim.tags : []).find(row => Array.isArray(row) && row[0] === 'h') as unknown[] | undefined
  const head = String(tag?.[1] ?? '').toLowerCase()
  if (!SIG.test(head)) return null
  const list = await verified(origin, head, 262_144) as { succession?: unknown; members?: unknown } | null
  if (!list || list.succession !== 1 || !Array.isArray(list.members)) return null
  const members = list.members.map(sig => String(sig).toLowerCase()).filter(sig => SIG.test(sig)).slice(0, 500)
  const heads = new Set<string>()
  for (let at = 0; at < members.length; at += 8) {
    const batch = await Promise.all(members.slice(at, at + 8).map(async sig => {
      const envelope = await verified(origin, sig, 8_192) as { layer?: unknown } | null
      const layer = typeof envelope?.layer === 'string' ? envelope.layer.toLowerCase() : ''
      return SIG.test(layer) ? layer : ''
    }))
    for (const layer of batch) if (layer) heads.add(layer)
  }
  // A list that names members we could not read is not an empty list.
  if (members.length && heads.size === 0) return null
  return heads
}

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

/** A read that failed is `null`; a host that answers that it holds nothing is `'missing'` — an owner
 *  with no index here yet is not an owner who could not be read. */
const fetchJson = async (url: string, limit: number): Promise<{ bytes: ArrayBuffer; value: unknown } | null | 'missing'> => {
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8_000) })
    if (response.status === 404) return 'missing'
    if (!response.ok || Number(response.headers.get('content-length') ?? 0) > limit) return null
    const bytes = await response.arrayBuffer()
    return bytes.byteLength <= limit ? { bytes, value: JSON.parse(new TextDecoder().decode(bytes)) } : null
  } catch { return null }
}

/** The keys the anchor's signed key list on this zone names, or null when the zone holds no list that
 *  verifies (core key-list.ts; becoming-a-host.md, "Letting another place publish for you"). Asked only
 *  for an index the anchor did not sign itself. */
const listedSigners = async (origin: string, anchor: string): Promise<ReadonlySet<string> | null> => {
  const pool = await SignatureService.sign(new TextEncoder().encode(KEY_LIST_MEANING).buffer as ArrayBuffer)
  const read = await fetchJson(`${origin}/${pool}/${anchor}`, 1_048_576)
  if (!read || read === 'missing' || !Array.isArray(read.value)) return null
  // nostr-tools caches a verdict on the object it is handed; a copy keeps that off the chain.
  const verdict = verifyKeyListChain(anchor, read.value as SignedKeyList[], event => {
    try { return verifyEvent(structuredClone(event) as never) } catch { return false }
  })
  return verdict.ok ? new Set(verdict.keys) : null
}

/** Is this index the owner's? Signed by the owner, or by a key the owner's list names on an event that
 *  says it is for this owner — the tag stops one event standing under another anchor that lists the key. */
const signedFor = async (origin: string, event: Record<string, unknown>, owner: string): Promise<boolean> => {
  const signer = String(event['pubkey'] ?? '').toLowerCase()
  if (signer === owner) return true
  if (!SIG.test(signer)) return false
  const tags = Array.isArray(event['tags']) ? event['tags'] as unknown[] : []
  if (!tags.some(tag => Array.isArray(tag) && tag[0] === 'anchor' && String(tag[1] ?? '').toLowerCase() === owner)) return false
  return (await listedSigners(origin, owner))?.has(signer) === true
}

/** Where a zone is read and written: plain http on this machine. */
export const zoneOrigin = (zone: string): string => `${LOOPBACK.test(zone) ? 'http' : 'https'}://${zone}`

/** One owner's signed index on a zone, checked: its kind, whose it is, its signature, and that its
 *  content is a map. `'missing'` when the zone answers it holds none; null when it could not be read
 *  or did not pass. */
export const readOwnerIndex = async (zone: string, owner: string): Promise<{ event: Record<string, unknown>; content: Record<string, unknown> } | 'missing' | null> => {
  if (!SIG.test(owner) || (!ZONE.test(zone) && !LOOPBACK.test(zone))) return null
  const origin = zoneOrigin(zone)
  const indexes = await SignatureService.sign(new TextEncoder().encode('hive:indexes').buffer as ArrayBuffer)
  const index = await fetchJson(`${origin}/${indexes}/${owner}`, 524_288)
  if (index === 'missing') return 'missing'
  const event = index?.value as Record<string, unknown> | undefined
  if (!event || Number(event['kind']) !== 30564 || !await signedFor(origin, event, owner)) return null
  try { if (!verifyEvent(structuredClone(event) as never)) return null } catch { return null }
  let content: unknown
  try { content = JSON.parse(String(event['content'] ?? '')) } catch { return null }
  return content && typeof content === 'object' && !Array.isArray(content) ? { event, content: content as Record<string, unknown> } : null
}

/** The record a showcase atom at `sig` on this zone holds, or null when it cannot be fetched, verified
 *  or understood. */
export const readShowcaseAtom = async (zone: string, sig: string): Promise<ShowcaseRecord | null> => {
  if (!SIG.test(sig)) return null
  const value = await verified(zoneOrigin(zone), sig, 262_144)
  return value ? parseShowcase(value, zone) : null
}

const itemId = (item: ShowcaseItem): string => `${item.pubkey}\n${item.lineage}`
const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** A record's bytes, canonical: the same record is always the same signature. The hive writes the same
 *  bytes (hypercomb-essentials sharing/showcase-record.ts showcaseBytes); the shim spec holds them together. */
export const showcaseBytes = (showcase: ShowcaseRecord): Uint8Array => {
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

/** Is this creation in the showcase by name? */
export const showcasesItem = (showcase: ShowcaseRecord, item: ShowcaseItem): boolean =>
  showcase.items.some(row => itemId(row) === itemId(item))

/** The record with one creation put in, or taken out — out of every community too, as the hive's
 *  toggleItem does: a community only ever filters what the showcase shows. */
export const toggleShowcaseItem = (showcase: ShowcaseRecord, item: ShowcaseItem): ShowcaseRecord => {
  const id = itemId(item)
  if (!showcasesItem(showcase, item)) return { ...showcase, items: [...showcase.items, item] }
  return {
    ...showcase,
    items: showcase.items.filter(row => itemId(row) !== id),
    ...(showcase.communities ? { communities: showcase.communities.map(community =>
      ({ ...community, items: community.items.filter(row => itemId(row) !== id) })) } : {}),
  }
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
  let live: ReadonlySet<string> | null = null
  let liveRead = false
  // `failed`: an owner this read could not see — a network error, a bad answer, a signature that
  // does not verify. One such owner makes the whole read unknown, because what they signed may be
  // the very thing that narrows or widens the rest.
  let failed = false
  let unreadable = false
  let decided = false
  const listed = owners.filter(key => SIG.test(key)).slice(0, 8)
  if (!ZONE.test(zone) && !LOOPBACK.test(zone)) return { showcase, doors, reached: false, unreadable }
  const origin = zoneOrigin(zone)
  for (const pubkey of listed) {
    const read = await readOwnerIndex(zone, pubkey)
    if (read === 'missing') continue
    if (!read) { failed = true; continue }
    const content = read.content as { roots?: Record<string, unknown>; doors?: Record<string, unknown> }
    const opened = new Map<string, readonly string[]>()
    for (const [lineage, listed] of Object.entries(content?.doors ?? {})) {
      if (Array.isArray(listed)) opened.set(lineage, listed.filter((door): door is string => typeof door === 'string').map(door => door.toLowerCase()))
    }
    doors.set(pubkey, opened)
    if (!liveRead) {
      liveRead = true
      const root = String(content?.roots?.[LIVE_ROOT] ?? '').toLowerCase()
      if (SIG.test(root)) live = await readLiveHeads(origin, root)
    }
    if (decided) continue
    const sig = String(content?.roots?.[showcaseKey(zone)] ?? '').toLowerCase()
    if (!SIG.test(sig)) continue
    decided = true
    for (const path of [`/${sig}`, `/content/${sig}`]) {
      const atom = await fetchJson(`${origin}${path}`, 262_144)
      if (!atom || atom === 'missing' || await SignatureService.sign(atom.bytes) !== sig) continue
      const record = parseShowcase(atom.value, zone)
      if (record) { showcase = record; break }
    }
    if (!showcase) unreadable = true
  }
  return { showcase, doors, reached: listed.length > 0 && !failed, unreadable, ...(live ? { live } : {}) }
}
