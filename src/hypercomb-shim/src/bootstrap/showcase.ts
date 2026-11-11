// hypercomb-shim/src/bootstrap/showcase.ts
//
// A DOMAIN'S ROOT IS A SHOWCASE OF ITS HIVES (jwize 2026-10-24): "the idea
// behind the root domain is like your tiles with the beautiful images showing
// and they lead to the subdomains." It is "strictly for showcasing": search
// at the top, then ONE list of everything hosted (jwize, the same day: "we
// collapse all domains into a single list of hosted software") with the
// domains as a filter on it, and the doors to the platform's other features at
// the bottom, beside what a member does to share their own favourite things. A
// tile opens its details: every version, and every domain each one opens on.
//
// A colony is a domain and its hives are its subdomains. Which hives are open
// on which domain is the ledger this origin already serves — /publications.json,
// verified heads only — and a domain's shared creations are its public offering
// pools, so nothing here names a domain. Each tile wears the picture its own
// tile wears (tile-picture.ts); a hive that wears none gets a cover drawn from
// its own signature, never text.

import type { HostCreation, HostOffering } from '@hypercomb/core'
import { pictureOrigins, tilePicture } from './tile-picture'
import { communityKey, doorsOpen, parseView, viewLabel, type ShowcaseCommunity, type ShowcaseItem, type ShowcaseView, type ZoneOwners } from './showcase-record'
import { DEFAULT_HOME, homeOrigin, turnOffHref } from './turn-off-link'
import type { OwnerBridge } from './owner-bridge'
import { showcaseHref } from './showcase-link'
import type { CommunityPick } from './community-tiles'
import {
  LaneTouch, hostOf as laneHostOf, keepLaneOrientation, laneDrift, laneLayout, laneMaxShift, lanePosition, laneSnap, laneTileAt, onePerHost,
  keepTriedViews, readLaneOrientation, readTriedViews, type LaneLayout,
} from './showcase-lanes'
import type { LinkIcon, Starter, WelcomeLink } from './welcome'

const SIG = /^[a-f0-9]{64}$/
const HOSTNAME = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{1,5})?$/
const LOOPBACK = /^(?:[a-z0-9-]+\.)*localhost(?::\d{1,5})?$/

/** A phone, as the hive's phone gateway asks it (hypercomb-web index.html): a coarse pointer on a small screen. */
const onPhone = (): boolean => {
  try { return matchMedia('(pointer: coarse)').matches && matchMedia('(max-width: 599px), (max-height: 449px)').matches } catch { return false }
}

/** One publisher of a site: its key, the name the ledger gives it, the head it signed. */
export type LedgerPublisher = { readonly pubkey: string; readonly label: string; readonly head: string }

/** One published site in the ledger, as far as a showcase needs it. */
export type LedgerSite = {
  readonly title: string
  readonly lineage: string
  /** Every address the site answers at: its own host, then its bindings. */
  readonly hosts: readonly string[]
  /** Every publisher holding a verified head, the primary first; none for a
   *  domain whose root has published nothing. */
  readonly publishers: readonly LedgerPublisher[]
  /** Every key the ledger names for the site, a head or not, the primary
   *  first: a domain's root names its owners even before it publishes. */
  readonly owners: readonly string[]
}

/** Somebody who owns a publish: their key, and the name the ledger gives them. */
export type Owner = { readonly pubkey: string; readonly label: string }

/** ONE PUBLISH: one owner's signed head, open at one address on one domain. */
export type Publish = {
  readonly zone: string
  readonly kind: 'hive' | 'creation'
  /** The name it goes by, folded — every publish of one name is one tile. */
  readonly name: string
  readonly title: string
  readonly head: string
  readonly owner: Owner
  readonly address: string
  readonly href: string
  /** The door its picture is asked from; a creation wears its cover. */
  readonly route?: string
  /** Where it was read: the ledger's verified heads lead, a domain's pool follows. */
  readonly source: 'ledger' | 'pool'
  /** The followed domain whose own word this is. Its names are its own: a peer's publish never merges into a tile of this domain's. */
  readonly peer?: string
  /** The index key it is published under — known for what the ledger read. */
  readonly lineage?: string
}

/** One owner's verified publish of a version: what an Off switch names. */
export type Claim = {
  readonly pubkey: string
  readonly label: string
  readonly lineage: string
  /** The domains it opens on, as the ledger read them. */
  readonly zones: readonly string[]
}

export type Place = { readonly zone: string; readonly address: string; readonly href: string
  readonly source: 'ledger' | 'pool' }

/** One version of a name: a head, everyone who publishes exactly it, and every
 *  place it opens. */
export type Version = {
  readonly head: string
  readonly title: string
  readonly owners: readonly Owner[]
  /** This domain's place first. */
  readonly places: readonly Place[]
  readonly route?: string
  /** The lineage it was published under, when the ledger named one. */
  readonly lineage?: string
  /** The ledger-verified publishes of it, per owner — only these can be
   *  turned off, and only by their owner's own hive. */
  readonly claims: readonly Claim[]
}

/** A NAME, AS THE PAGE SHOWS IT: one tile, every version behind it. */
export type Aggregate = {
  /** `<kind>:<folded name>` — one per page. */
  readonly key: string
  readonly kind: 'hive' | 'creation'
  readonly title: string
  /** This domain's version first, then the rest by how widely they open. */
  readonly versions: readonly Version[]
  /** How many people own it, across every version. */
  readonly owners: number
  /** Every domain it opens on. */
  readonly zones: readonly string[]
  /** The one band it is drawn in: this domain when it opens here, else the
   *  first band that has it. */
  readonly home: string
}

export type Band = {
  readonly zone: string
  /** The tiles drawn in this band. */
  readonly tiles: readonly Aggregate[]
  /** Every name open on this domain, drawn here or in a band above. */
  readonly open: readonly Aggregate[]
}

/** Text from outside, as plain words: no bidi or format characters that could
 *  make one owner's name read as another's. */
const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/\p{Cf}/gu, '').trim().replace(/\s+/g, ' ').slice(0, max) : ''

export const matchesDomain = (host: string, domain: string): boolean =>
  host === domain || host.endsWith(`.${domain}`)

export const searchTerms = (query: string): string[] => query.toLowerCase().trim().split(/\s+/).filter(Boolean)

/** A host is a root zone when no other known host contains it. */
export const rootZones = (zones: readonly string[]): string[] => {
  const unique = [...new Set(zones.filter(Boolean))]
  const known = new Set(unique)
  return unique.filter(zone => {
    for (let dot = zone.indexOf('.'); dot >= 0; dot = zone.indexOf('.', dot + 1)) {
      if (known.has(zone.slice(dot + 1))) return false
    }
    return true
  })
}

/** Where a host answers: plain http on a machine's loopback, https elsewhere. */
export const doorOrigin = (host: string): string => `${LOOPBACK.test(host) ? 'http' : 'https'}://${host}`

/** The ledger, believed only as far as each field survives its check. */
export const parseLedger = (raw: unknown): LedgerSite[] => {
  const sites = (raw as { sites?: unknown } | null)?.sites
  if (!Array.isArray(sites)) return []
  const out: LedgerSite[] = []
  for (const entry of sites.slice(0, 500)) {
    if (!entry || typeof entry !== 'object') continue
    const site = entry as Record<string, unknown>
    const bindings = (Array.isArray(site['hosts']) ? site['hosts'] as unknown[] : []).slice(0, 24)
    const hosts = [site['host'], ...bindings.map(row => (row as { host?: unknown } | null)?.host)]
      .map(host => typeof host === 'string' ? host.trim().toLowerCase() : '')
      .filter(host => HOSTNAME.test(host))
    if (!hosts.length) continue
    const named = (Array.isArray(site['publishers']) ? site['publishers'] as unknown[] : []).slice(0, 16)
      .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
      .filter(row => typeof row['pubkey'] === 'string' && SIG.test(row['pubkey']))
      .sort((a, b) => Number(b['primary'] === true) - Number(a['primary'] === true))
    const publishers = named.filter(row => typeof row['head'] === 'string' && SIG.test(row['head']))
    const lineage = text(site['lineage'], 200)
    out.push({
      title: text(site['title'], 60) || lineage || hosts[0]!,
      lineage,
      hosts: [...new Set(hosts)],
      publishers: publishers.map(row => ({ pubkey: row['pubkey'] as string, label: text(row['label'], 40),
        head: row['head'] as string })),
      owners: [...new Set(named.map(row => row['pubkey'] as string))],
    })
  }
  return out
}

/** A name folded the way a molecule address folds: case and accents never
 *  make two names of one. */
export const foldName = (value: string): string =>
  value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim()

/** A tile's name is the last word of its lineage: games/arkanoid is arkanoid. */
const nameOf = (lineage: string, title: string): string =>
  foldName(lineage.split('/').filter(Boolean).pop() || title)

/** The domains a page draws, this door's own first, the rest by name. */
export const bandZones = (sites: readonly LedgerSite[], self: string, sources: readonly string[] = []): string[] =>
  rootZones([self, ...sites.flatMap(site => site.hosts), ...sources])
    .sort((a, b) => (a === self ? -1 : b === self ? 1 : a.localeCompare(b)))

/** Every publish the ledger names, at the address it answers on each domain.
 *  This host's own ledger is `ledger`, which verifies; a followed domain's is its
 *  own word and is drawn as `pool`, which never counts as proof of who owns a name. */
export const ledgerPublishes = (sites: readonly LedgerSite[], zones: readonly string[], source: Publish['source'] = 'ledger', peer?: string): Publish[] => {
  const out: Publish[] = []
  for (const zone of zones) {
    for (const site of sites) {
      const host = site.hosts.find(row => row !== zone && matchesDomain(row, zone))
        ?? site.hosts.find(row => row === zone)
      if (!host) continue
      const href = `${doorOrigin(host)}/`
      for (const publisher of site.publishers) {
        out.push({ zone, kind: 'hive', name: nameOf(site.lineage, site.title), title: site.title,
          head: publisher.head, owner: { pubkey: publisher.pubkey, label: publisher.label },
          address: host, href, route: href, source, lineage: site.lineage, ...(peer ? { peer } : {}) })
      }
    }
  }
  return out
}

/** What a domain's public pools share, as publishes on that domain — and only
 *  at addresses under that domain: a pool speaks for its own domain, never for
 *  a place on someone else's. */
export const sharedPublishes = (zone: string, offers: readonly HostOffering[],
  creations: readonly HostCreation[]): Publish[] => {
  const out: Publish[] = []
  for (const offer of offers) {
    if (!SIG.test(offer.head)) continue
    let route: URL
    try { route = new URL('/', offer.route) } catch { continue }
    if (!matchesDomain(route.host, zone)) continue
    const title = text(offer.title, 60) || offer.lineage
    out.push({ zone, kind: 'hive', name: nameOf(offer.lineage, title), title, head: offer.head,
      owner: { pubkey: offer.pubkey, label: '' }, address: route.host, href: route.href, route: route.href, source: 'pool' })
  }
  // A creation is not a place: it opens the signed creation itself, never the
  // domain's root, which in this door's own band is this page.
  for (const creation of creations) {
    if (!SIG.test(creation.head) || !HOSTNAME.test(creation.host) || !matchesDomain(creation.host, zone)) continue
    out.push({ zone, kind: 'creation', name: foldName(`${creation.meaning}:${creation.key}`),
      title: text(creation.title, 60) || creation.key, head: creation.head, owner: { pubkey: creation.pubkey, label: '' },
      address: creation.host, href: `${doorOrigin(creation.host)}/${creation.head}`, source: 'pool' })
  }
  return out
}

const byTitle = (a: Aggregate, b: Aggregate): number =>
  (a.kind === b.kind ? 0 : a.kind === 'hive' ? -1 : 1) || a.title.localeCompare(b.title)

/**
 * EVERY PUBLISH OF ONE NAME IS ONE TILE (jwize 2026-10-24: "an aggregate so we
 * don't duplicate tiles on the home pages … your own version pinned to the
 * top … no need to include stuff that is already identical but the count can
 * be incremented for how many people own that publish location").
 *
 * Exactly identical publishes — one head — are one version, however many
 * domains open it and however many people own it; a different head is a
 * version of its own. This domain's version is pinned first, and the tile is
 * drawn once: in this domain's band when it opens here, else in the first
 * band that has it.
 *
 * TRUST ORDER. A head is public: anyone can name one in their own index. So
 * what the ledger verified leads — its places before any pool's, its versions
 * before a pool-only one, its domains before a pool's when choosing the band —
 * and a pool that claims a head only adds its own place and its own owner.
 */
export const aggregate = (publishes: readonly Publish[], zones: readonly string[], self: string): Band[] => {
  type Gathering = { head: string; title: string; owners: Map<string, Owner>; places: Map<string, Place>
    route?: string; lineage?: string; ledger: boolean; claims: Map<string, { pubkey: string; label: string; lineage: string; zones: Set<string> }> }
  const groups = new Map<string, Publish[]>()
  for (const publish of publishes) {
    const key = `${publish.kind}:${publish.name}${publish.peer ? `@${publish.peer}` : ''}`
    const group = groups.get(key)
    if (group) group.push(publish)
    else groups.set(key, [publish])
  }
  const here = (places: readonly Place[]): boolean => places.some(place => place.zone === self)
  const aggregates: Aggregate[] = []
  for (const [key, group] of groups) {
    const byHead = new Map<string, Gathering>()
    // The ledger's publishes first, so a pool never names a version's title or picture door.
    for (const publish of [...group].sort((a, b) => Number(b.source === 'ledger') - Number(a.source === 'ledger'))) {
      let version = byHead.get(publish.head)
      if (!version) byHead.set(publish.head, version = { head: publish.head, title: publish.title,
        owners: new Map(), places: new Map(), route: publish.route, ledger: false, claims: new Map() })
      if (publish.kind === 'hive' && publish.lineage) version.lineage ??= publish.lineage
      version.ledger ||= publish.source === 'ledger'
      if (publish.source === 'ledger' && publish.kind === 'hive' && publish.lineage) {
        const id = `${publish.owner.pubkey}:${publish.lineage}`
        let claim = version.claims.get(id)
        if (!claim) version.claims.set(id, claim = { pubkey: publish.owner.pubkey, label: publish.owner.label,
          lineage: publish.lineage, zones: new Set() })
        claim.zones.add(publish.zone)
      }
      const known = version.owners.get(publish.owner.pubkey)
      if (!known || (!known.label && publish.owner.label)) version.owners.set(publish.owner.pubkey, publish.owner)
      const place = version.places.get(publish.address)
      if (!place || (place.source === 'pool' && publish.source === 'ledger')) {
        version.places.set(publish.address, { zone: publish.zone, address: publish.address, href: publish.href,
          source: publish.source })
      }
      version.route ??= publish.route
    }
    const ledgerFirst = (a: { source: string }, b: { source: string }): number =>
      Number(b.source === 'ledger') - Number(a.source === 'ledger')
    const gathered = [...byHead.values()]
    const versions: Version[] = gathered.map(version => ({
      head: version.head,
      title: version.title,
      owners: [...version.owners.values()],
      places: [...version.places.values()].sort((a, b) =>
        Number(b.zone === self) - Number(a.zone === self) || ledgerFirst(a, b) || a.address.localeCompare(b.address)),
      ...(version.route ? { route: version.route } : {}),
      ...(version.lineage ? { lineage: version.lineage } : {}),
      claims: [...version.claims.values()].map(claim => ({ pubkey: claim.pubkey, label: claim.label,
        lineage: claim.lineage, zones: [...claim.zones].sort() })),
    })).sort((a, b) => Number(here(b.places)) - Number(here(a.places))
      || Number(byHead.get(b.head)!.ledger) - Number(byHead.get(a.head)!.ledger)
      || b.places.length - a.places.length || a.head.localeCompare(b.head))
    const opens = [...new Set(group.map(publish => publish.zone))]
    const verified = new Set(group.filter(publish => publish.source === 'ledger').map(publish => publish.zone))
    aggregates.push({
      key,
      kind: group[0]!.kind,
      title: versions[0]!.title,
      versions,
      owners: new Set(versions.flatMap(version => version.owners.map(owner => owner.pubkey))).size,
      zones: opens,
      home: opens.includes(self) ? self
        : zones.find(zone => verified.has(zone)) ?? zones.find(zone => opens.includes(zone)) ?? opens[0]!,
    })
  }
  return zones.map(zone => ({
    zone,
    tiles: aggregates.filter(entry => entry.home === zone).sort(byTitle),
    open: aggregates.filter(entry => entry.zones.includes(zone)).sort(byTitle),
  }))
}

/** A search finds a tile by any name, address, domain or owner behind it. */
export const aggregateMatches = (entry: Aggregate, terms: readonly string[]): boolean => {
  if (!terms.length) return true
  const words = [entry.title, ...entry.zones, ...entry.versions.flatMap(version => [version.title,
    ...version.places.map(place => place.address), ...version.owners.map(owner => owner.label)])]
    .join(' ').toLowerCase()
  return terms.every(term => words.includes(term))
}

/** Who owns a version, in a few words: names where the ledger gives them, and
 *  otherwise enough of the key that a ground-out look-alike cannot pass. */
export const ownersLabel = (owners: readonly Owner[]): string => {
  const names = owners.map(owner => owner.label || `${owner.pubkey.slice(0, 16)}…`)
  if (names.length <= 2) return names.join(' and ')
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`
}

/** The colours a hive with no picture wears — warm, deep and never flat. */
const COVERS: readonly (readonly [string, string])[] = [
  ['#f6c453', '#a3520c'], // honey
  ['#86d3c8', '#1d5a63'], // sea glass
  ['#f3a7ad', '#7b2443'], // rose
  ['#c4d27f', '#3c5520'], // moss
  ['#aebcf2', '#2b3878'], // dusk
  ['#f2b58b', '#863817'], // terracotta
  ['#d8b6f1', '#4c2871'], // lilac
  ['#f7d98a', '#6b4a12'], // amber
]

export type Cover = { readonly from: string; readonly to: string; readonly angle: number
  readonly x: number; readonly y: number; readonly scale: number; readonly turn: number }

/** A cover drawn from a signature alone: the same hive always wears the same one. */
export const coverOf = (seed: string): Cover => {
  const hex = SIG.test(seed) ? seed : [...seed].map(char => char.charCodeAt(0).toString(16)).join('').padEnd(16, '7')
  const byte = (at: number): number => Number.parseInt(hex.slice(at * 2, at * 2 + 2), 16) || 0
  const [from, to] = COVERS[byte(0) % COVERS.length]!
  return {
    from, to,
    angle: 110 + byte(1) % 120,
    x: (byte(2) % 41) - 20,
    y: (byte(3) % 41) - 26,
    scale: 0.8 + (byte(4) % 50) / 100,
    turn: byte(5) % 60,
  }
}

/**
 * WHICH WAY A DRAG TURNS THE PAGE: -1 back, 1 on, 0 not at all. The repo's page
 * flip rule (viewer-walk, the app deck): committed at release only, far enough —
 * 56px, or a short quick flick — and clearly sideways, 1.4 times more across
 * than down, so a vertical scroll is never read as a swipe. Left is next.
 */
export const pageFlip = (dx: number, dy: number, ms: number): -1 | 0 | 1 => {
  const across = Math.abs(dx)
  const far = across >= 56 || (across >= 24 && across / Math.max(1, ms) >= 0.3)
  return far && across >= 1.4 * Math.abs(dy) ? (dx < 0 ? 1 : -1) : 0
}

/**
 * A drag that is clearly one way, by the page-flip rule on either axis.
 * Across: -1 back, 1 on (a finger moving left goes on). Up and down: -1 the
 * previous set, 1 the next (a finger moving up goes on). A drag that is
 * neither clearly across nor clearly down is not a swipe, so a scroll stays a scroll.
 */
export const gestureStep = (dx: number, dy: number, ms: number): { readonly axis: 'x' | 'y'; readonly by: -1 | 1 } | null => {
  const across = pageFlip(dx, dy, ms)
  if (across) return { axis: 'x', by: across }
  const down = Math.abs(dy)
  const far = down >= 56 || (down >= 24 && down / Math.max(1, ms) >= 0.3)
  return far && down >= 1.4 * Math.abs(dx) ? { axis: 'y', by: dy < 0 ? 1 : -1 } : null
}

/** THE FOUR LOOKS A SIDEWAYS SWIPE WALKS WHILE EDITING (jwize 2026-11-10: "the four different views on the mobile that you
 *  should be able to activate by swiping left or right while in edit mode … iphone tile launcher a hexagon launcher a
 *  button list launcher"). The square column scrolls on its own axis and is not one of them; a signed record may still
 *  name it. */
const SWIPE_VIEWS: readonly ShowcaseView[] = ['hex', 'launcher', 'iphone', 'list']
const swipeView = (current: ShowcaseView, by: -1 | 1): ShowcaseView => {
  const at = SWIPE_VIEWS.indexOf(current)
  // From a look the swipe does not walk, on is the first and back is the last.
  return at < 0 ? SWIPE_VIEWS[by > 0 ? 0 : SWIPE_VIEWS.length - 1]! : SWIPE_VIEWS[(at + by + SWIPE_VIEWS.length) % SWIPE_VIEWS.length]!
}

/** How many icons the iPhone dock holds, once the page has more than that. */
const IPHONE_DOCK = 4

/** The domain a typed line names, or '' when it names none: a bare hostname
 *  with a dot, whatever scheme or path was pasted around it. */
export const followCandidate = (text: string): string => {
  const bare = text.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#]/)[0] ?? ''
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(bare) ? bare : ''
}

/** A followed domain's own ledger. A peer speaks only for the names under its
 *  own domain, so every host outside it is dropped: it cannot claim a place on
 *  this one. */
export const readPeerLedger = async (zone: string): Promise<LedgerSite[]> => {
  try {
    const response = await fetch(`${doorOrigin(zone)}/publications.json`, { cache: 'no-store', signal: AbortSignal.timeout(8_000) })
    if (!response.ok) return []
    const body = await response.text()
    if (body.length > 1_000_000) return []
    return parseLedger(JSON.parse(body))
      .map(site => ({ ...site, hosts: site.hosts.filter(host => matchesDomain(host, zone)) }))
      .filter(site => site.hosts.length > 0)
  } catch { return [] }
}

/** Read the ledger this origin serves, or nothing where it serves none. A host
 *  with an SPA fallback answers 200 with HTML, so the type is checked first. */
export const readLedger = async (): Promise<LedgerSite[]> => {
  try {
    const response = await fetch('/publications.json', { cache: 'no-store', signal: AbortSignal.timeout(8_000) })
    if (!response.ok || !(response.headers.get('content-type') ?? '').toLowerCase().includes('json')) return []
    return parseLedger(await response.json())
  } catch { return [] }
}

// ── drawing ──────────────────────────────────────────────────────────────
// Constants only reach innerHTML below: no data from anywhere is written into
// markup. Names and addresses are text nodes.

const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`

const ICONS: Record<LinkIcon | 'search' | 'arrow' | 'chevron' | 'hive' | 'sparkle' | 'heart' | 'share' | 'globe' | 'link'
  | 'people' | 'close' | 'sliders' | 'folder', string> = {
  folder: svg('<path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4.2l2 2.2H19a1.5 1.5 0 0 1 1.5 1.5v8.8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5Z"/>'),
  sliders: svg('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
  people: svg('<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.6-3.3 2.8-5.2 5.5-5.2s4.9 1.9 5.5 5.2"/><circle cx="16.8" cy="9.5" r="2.6"/><path d="M15.6 14.1c2.6.2 4.4 1.9 4.9 4.9"/>'),
  close: svg('<path d="m6 6 12 12M18 6 6 18"/>'),
  search: svg('<circle cx="10.25" cy="10.25" r="6.25"/><path d="M7.55 8.05a3.5 3.5 0 0 1 2.9-1.45"/><path d="m14.85 14.85 5.3 5.3"/>'),
  arrow: svg('<path d="M7 17 17 7M9 7h8v8"/>'),
  chevron: svg('<path d="m6 9 6 6 6-6"/>'),
  hive: svg('<path d="M12 2.8 20 7.4v9.2l-8 4.6-8-4.6V7.4Z"/><path d="M12 8.6v6.8M8.6 12h6.8"/>'),
  sparkle: svg('<path d="M12 3.5 13.9 9 19.5 11 13.9 13 12 18.5 10.1 13 4.5 11 10.1 9Z"/>'),
  heart: svg('<path d="M12 20s-7.5-4.6-7.5-10.4A4.1 4.1 0 0 1 12 7.2a4.1 4.1 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20Z"/>'),
  share: svg('<circle cx="6" cy="12" r="2.4"/><circle cx="18" cy="6" r="2.4"/><circle cx="18" cy="18" r="2.4"/><path d="m8.2 10.9 7.6-3.8M8.2 13.1l7.6 3.8"/>'),
  globe: svg('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.9 5.2 3.9 8.5s-1.3 6.1-3.9 8.5c-2.6-2.4-3.9-5.2-3.9-8.5s1.3-6.1 3.9-8.5Z"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  tour: svg('<circle cx="12" cy="12" r="8.5"/><path d="M10.2 8.6 15.6 12l-5.4 3.4Z"/>'),
  app: svg('<path d="M12 2.8 20 7.4v9.2l-8 4.6-8-4.6V7.4Z"/><path d="M12 12.1 20 7.4M12 12.1v9.1M12 12.1 4 7.4"/>'),
  host: svg('<rect x="4" y="4" width="16" height="6.5" rx="1"/><rect x="4" y="13.5" width="16" height="6.5" rx="1"/><path d="M7.5 7.25h.01M7.5 16.75h.01M11 7.25h5.5M11 16.75h5.5"/>'),
  download: svg('<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>'),
  extension: svg('<path d="M5 8h3.6a2.4 2.4 0 1 1 4.8 0H17v3.6a2.4 2.4 0 1 1 0 4.8V20H5Z"/>'),
  docs: svg('<path d="M6 4h9.5A2.5 2.5 0 0 1 18 6.5V20H8.5A2.5 2.5 0 0 1 6 17.5Z"/><path d="M6 17.5A2.5 2.5 0 0 1 8.5 15H18M9.5 8h5M9.5 11h3.5"/>'),
  source: svg('<path d="m9 8-4 4 4 4M15 8l4 4-4 4"/>'),
}

const iconOf = (name: keyof typeof ICONS): Element => {
  const holder = document.createElement('span')
  holder.innerHTML = ICONS[name]
  return holder.firstElementChild ?? holder
}

/** The platform's mark, gold, beside the page's name. */
const GOLD_MARK = '<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">'
  + '<defs><linearGradient id="sc-g" gradientUnits="userSpaceOnUse" x1="6" y1="1" x2="26" y2="31">'
  + '<stop offset="0" stop-color="#ffe08a"/><stop offset=".42" stop-color="#f8b73a"/><stop offset="1" stop-color="#d9860b"/></linearGradient>'
  + '<mask id="sc-h"><polygon points="16,1.2 28.6,8.6 28.6,23.4 16,30.8 3.4,23.4 3.4,8.6" fill="#fff"/><g fill="#000">'
  + '<rect x="9.7" y="8.6" width="4.1" height="14.8" rx=".5"/><rect x="18.2" y="8.6" width="4.1" height="14.8" rx=".5"/>'
  + '<rect x="9.7" y="14.3" width="12.6" height="3.4"/></g></mask></defs>'
  + '<polygon points="16,1.2 28.6,8.6 28.6,23.4 16,30.8 3.4,23.4 3.4,8.6" fill="url(#sc-g)" stroke="url(#sc-g)" stroke-width="1.6" stroke-linejoin="round" mask="url(#sc-h)"/></svg>'

/** Three nested hexagons, placed by the cover's own numbers. */
const motif = (cover: Cover): string => '<svg class="hex-motif" viewBox="-50 -58 100 116" aria-hidden="true" focusable="false">'
  + `<g transform="translate(${cover.x} ${cover.y}) rotate(${cover.turn}) scale(${cover.scale.toFixed(2)})" fill="none" stroke="currentColor">`
  + '<polygon points="0,-46 39.8,-23 39.8,23 0,46 -39.8,23 -39.8,-23" stroke-width="1.1"/>'
  + '<polygon points="0,-31 26.8,-15.5 26.8,15.5 0,31 -26.8,15.5 -26.8,-15.5" stroke-width="1"/>'
  + '<polygon points="0,-16 13.9,-8 13.9,8 0,16 -13.9,8 -13.9,-8" stroke-width=".9"/>'
  + '<polygon points="0,-5 4.3,-2.5 4.3,2.5 0,5 -4.3,2.5 -4.3,-2.5" fill="currentColor" stroke="none"/></g></svg>'

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}

/** A cover on an art box, until — or instead of — a picture. */
const dressCover = (art: HTMLElement, seed: string): void => {
  const cover = coverOf(seed)
  art.style.setProperty('--c1', cover.from)
  art.style.setProperty('--c2', cover.to)
  art.style.setProperty('--ang', `${cover.angle}deg`)
  art.insertAdjacentHTML('afterbegin', motif(cover))
}

const wearPicture = (art: HTMLElement, url: string, className: string): void => {
  if (art.querySelector(`img.${className}`)) return
  const image = document.createElement('img')
  image.className = className
  image.alt = ''
  image.decoding = 'async'
  // It fades in once. A tile moved to another row would restart the fade from
  // nothing, so once it has played the picture simply stays.
  image.addEventListener('animationend', () => { image.style.animation = 'none'; image.style.opacity = '1' }, { once: true })
  image.src = url
  art.append(image)
  art.classList.add('has-picture')
}

export type SharedReader = (zone: string) => Promise<{ offers: readonly HostOffering[]; creations: readonly HostCreation[] }>

export type ShowcaseOptions = {
  /** The domain this door speaks for. */
  readonly self: string
  readonly title: string
  readonly tagline: string
  /** The zone's room (a sealed swarm link), drawn first — or ''. */
  readonly swarm?: string
  /** The published hive a phone is shown in place of the search and tiles (an https address) — or ''. */
  readonly presentation?: string
  /** Domains this hive added, shown after the ledger's. */
  readonly sources: readonly string[]
  readonly ledger: Promise<readonly LedgerSite[]>
  readonly readShared: SharedReader
  /** The hive this page was opened from, when it was — where an owner's Off is handed. */
  readonly home?: string
  /** What this domain's owners sign — their showcase and their doors
   *  (showcase-record.ts readZoneOwners) — read after every ledger read. */
  readonly readOwners?: (zone: string, owners: readonly string[]) => Promise<ZoneOwners>
  /** The platform's own doors — the tour, the app, the minimal host, the
   *  downloads, the extensions — drawn as tiles in this domain's row. They are
   *  pages deployed somewhere, reached by a link (jwize 2026-10-25: "everything
   *  in your home page should be a tile … they have deployed webpages that we
   *  can navigate to"). */
  readonly links?: readonly WelcomeLink[]
  /** The faux starting tile of a vanilla hive: drawn in this domain's row only
   *  while the row holds nothing and no doors were staged; a click opens its steps. */
  readonly starter?: Starter | null
  /** THE HELP TILES ARE OPTIONAL (jwize 2026-11-10: "the help tiles should be optional and off by default for non
   *  hypercomb.com hives"): the platform's own doors a host did not stage itself. Off until this browser turns one on
   *  while editing; the starting tile is one of them. */
  readonly help?: readonly WelcomeLink[]
  /** Follow a domain: checked, then kept in this browser's community. */
  /** Stop following a domain: forget it where the browser kept it. True when it is gone. */
  readonly unfollow?: (zone: string) => Promise<boolean>
  readonly follow?: (raw: string) => Promise<{ readonly ok: true; readonly zone: string } | { readonly ok: false; readonly reason: string }>
  /** A followed domain's own ledger, kept to the names under that domain. */
  /** Groups (named pages of the showcase, swiped between) are set aside for now (jwize 2026-10-25: "we aren't
   *  doing groups for now"): off unless asked for. The record still carries them; the page does not draw them. */
  readonly groups?: boolean
  /** Told when Manage is turned on or off: the hive's own setup shows only while the page is managing. */
  readonly onManage?: (managing: boolean) => void
  /** The hive beside this page, when this device is its owner's: a tap on a tile puts it in the showcase or takes it out. */
  readonly owner?: OwnerBridge | null
  /** The tiles this browser brought into its community while managing (community-tiles.ts). */
  /** Whether a revision, as `zone` serves it, is optimized and minimized. Only such a tile can be put in the showcase;
   *  without it the page cannot tell and gates nothing. */
  readonly minimized?: (zone: string, head: string) => Promise<boolean>
  readonly readCommunity?: () => Promise<readonly CommunityPick[]>
  readonly keepCommunity?: (picks: readonly CommunityPick[]) => Promise<boolean>
  readonly readPeerLedger?: (zone: string) => Promise<readonly LedgerSite[]>
  /** Open this signature as files on the host page. */
  readonly onOpenHead?: (head: string, zone: string) => void
  /** The Files section (a signature to open, the latest revisions): kept out of the page's flow, opened as a sheet from the bar. */
  readonly files?: HTMLElement
}

export type Showcase = {
  /** The mark, the name, the sentence and the search. */
  readonly hero: HTMLElement
  /** The one list of everything hosted, beneath it. */
  readonly bands: HTMLElement
  readonly refresh: (ledger: Promise<readonly LedgerSite[]>) => void
  /** Open or close the Files sheet (a branch opened from anywhere on the page shows in it). */
  readonly showFiles: (on: boolean) => void
}

export const showcase = (options: ShowcaseOptions): Showcase => {
  // THE HEADER IS LEAN (jwize 2026-10-24: "this area needs to be lean … header
  // with area for branding (small) and then search across the top and then the
  // list of items"): the mark, the name and its sentence on one small row,
  // the search across the full width beneath, and the list straight after.
  const hero = el('header', 'hero')
  const brand = el('div', 'hero-brand')
  const mark = el('span', 'hero-mark')
  mark.innerHTML = GOLD_MARK
  const words = el('div', 'hero-words')
  const title = el('h1')
  title.textContent = options.title
  const tagline = el('p', 'hero-tagline')
  tagline.textContent = options.tagline
  tagline.title = options.tagline
  words.append(title, tagline)
  const stats = el('p', 'hero-stats')
  brand.append(mark, words, stats)
  // JUST A SEARCH AND THE TILES (jwize 2026-11-10: "just a search and the tiles no informational header by default"):
  // the mark, the name, its sentence and the counts show only while editing, where they say which domain is being
  // edited. A room, when the owner hosts one, stays: it is a door, not information.
  const paintBrand = (on: boolean): void => {
    for (const part of [mark, words, stats]) part.hidden = !on
    brand.hidden = !on && !options.swarm
  }
  // THE ROOM FIRST: a front page whose owner hosts a swarm says so before
  // anything else (room host <domain>). The link carries no words a reader
  // could copy down — the room and its secret travel sealed.
  if (options.swarm) {
    const join = el('a', 'hero-swarm')
    join.href = options.swarm
    join.rel = 'noopener'
    const label = el('span')
    label.textContent = 'Join the swarm'
    join.append(iconOf('hive'), label, iconOf('arrow'))
    brand.append(join)
  }
  // THE SEARCH IS ALWAYS THERE (jwize 2026-11-05: "you don't need the search it is always there. so just the options so it
  // should be at the top so you can filter. You are always going somewhere so it is okay on the screen"): one row at the
  // top — the search, and beside it the options. No bar at the foot.
  const searchBox = el('label', 'search')
  const search = el('input')
  search.type = 'search'
  search.id = 'showcase-search'
  search.placeholder = 'Search'
  search.setAttribute('aria-label', 'Search')
  search.autocomplete = 'off'
  search.spellcheck = false
  // THE ONE INPUT (jwize 2026-11-04: "get rid of the bottom input and follow button … you just have a header search";
  // 2026-11-05: "when the domain is a valid domain make the link say add domain and otherwise make it filter … a link to
  // the right instead of a button to not interfere with the interface … change from follow to add domain" · "so the bottom
  // input is no longer needed"): the search filters, and while its line is a domain nobody follows yet a quiet link at the
  // right end of the field offers to add it. There is no follow box at the foot, on any screen.
  // ONE INPUT, CALLED SEARCH (jwize 2026-11-10: "no follow a domain anymore we just add a button at the bottom when the
  // string matches a domain name. That way it is a search until it matches those criteria"): the button is at the foot
  // of the page and names the domain it adds.
  const searchAdd = el('button', 'foot-bar search-add')
  searchAdd.type = 'button'
  searchAdd.textContent = 'Add domain'
  searchAdd.hidden = true
  search.enterKeyHint = 'go'
  // The field and its link are one box, so the link sits inside the field's right end and takes no room beside it.
  const searchField = el('span', 'search-field')
  searchField.append(search)
  searchBox.append(iconOf('search'), searchField)
  // Manage opens the management screen: the domains you follow as rows, their tiles grayed until you turn them on,
  // and the follow box. Pressing it again returns to the showcase. Escape in the search clears what was typed.
  let managing = false
  /** This domain's ledger names no owner: nothing is signed here to read. */
  let ownerless = false
  const tools = el('span', 'page-tools')
  search.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !search.value) return
    event.preventDefault()
    search.value = ''
    paint()
  })
  const manageButton = el('button', 'manage-toggle')
  manageButton.type = 'button'
  manageButton.title = 'Manage'
  manageButton.setAttribute('aria-label', 'Manage')
  manageButton.setAttribute('aria-pressed', 'false')
  manageButton.append(iconOf('sliders'))
  const setManaging = (on: boolean): void => {
    managing = on
    dropMissing()
    manageButton.setAttribute('aria-pressed', String(managing))
    // FILES ARE A MANAGE TOOL (jwize 2026-11-05: "the files are not shown by default … we can have it in manage mode only").
    filesButton.hidden = !managing || !files
    if (!managing) setFilesOpen(false)
    // What the last tap said belongs to the editing; the page it comes back to is only the tiles.
    if (!managing) ownerNote.hidden = true
    if (!managing) closeConfirm()
    paintBrand(managing)
    if (managing && !openRow) openRow = options.self
    options.onManage?.(managing)
    paint()
  }
  manageButton.addEventListener('click', () => setManaging(!managing))
  // FILES (jwize 2026-11-04: "we are trying not to have anything scroll except for the tiles"): the signature box and the
  // latest revisions open as a sheet, never as a section the page scrolls down to. Its button shows only while managing.
  const files = options.files
  const filesButton = el('button', 'page-files')
  filesButton.hidden = true
  filesButton.type = 'button'
  filesButton.title = 'Files'
  filesButton.setAttribute('aria-label', 'Files')
  filesButton.setAttribute('aria-pressed', 'false')
  filesButton.append(iconOf('folder'))
  const setFilesOpen = (on: boolean): void => {
    if (!files) return
    files.hidden = !on
    filesButton.setAttribute('aria-pressed', String(on))
  }
  if (files) {
    files.classList.add('files-sheet')
    files.hidden = true
    // A close in the title row: the Files button is not the only way out of the sheet.
    const close = el('button', 'files-close')
    close.type = 'button'
    close.title = 'Close'
    close.setAttribute('aria-label', 'Close files')
    close.append(iconOf('close'))
    close.addEventListener('click', () => { setFilesOpen(false); filesButton.focus() })
    files.querySelector('.files-head')?.append(close)
    filesButton.addEventListener('click', () => setFilesOpen(files.hidden))
    files.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setFilesOpen(false)
      filesButton.focus()
    })
    tools.append(filesButton)
  }
  tools.append(manageButton)
  searchBox.append(tools)
  // The Add button is fixed to the foot of the screen wherever it sits in the page; it is kept beside the search it belongs to.
  hero.append(brand, searchBox, searchAdd)
  paintBrand(false)
  // THE PRESENTATION IS THE PHONE'S FRONT PAGE (jwize 2026-11-11: "for hypercomb.com on the mobile we are going to put
  // the protocol presentation. On the front page hypercomb an open protocol for humanity" · "we need to publish
  // hypercomb.com to load this hive signature"). A host that stages a presentation shows it to a phone in place: its name
  // and its line across the top, and under them the published hive, framed from its own address. That address always
  // answers with the head its publisher last signed, so a publish there is on this page at once, nothing is copied to
  // this host, and what the hive keeps stays with its own domain. The search and the tiles are one press away, and one
  // press brings the presentation back.
  if (options.presentation && onPhone()) {
    const front = el('section', 'front')
    front.setAttribute('aria-label', options.title)
    const bar = el('div', 'front-bar')
    const frontMark = el('span', 'front-mark')
    // its own ids: the header's mark is hidden on this page, and a gradient inside a hidden mark paints nothing
    frontMark.innerHTML = GOLD_MARK.split('sc-').join('front-')
    const frontWords = el('div', 'front-words')
    const frontName = el('h1')
    frontName.textContent = options.title
    const frontLine = el('p')
    frontLine.textContent = options.tagline
    frontWords.append(frontName, frontLine)
    const toSearch = el('button', 'front-search')
    toSearch.type = 'button'
    toSearch.textContent = 'Search'
    bar.append(frontMark, frontWords, toSearch)
    const frame = el('iframe', 'front-frame')
    frame.title = options.tagline ? `${options.title}: ${options.tagline}` : options.title
    frame.setAttribute('allow', 'fullscreen; autoplay')
    frame.setAttribute('referrerpolicy', 'no-referrer')
    frame.src = options.presentation
    front.append(bar, frame)
    const back = el('button', 'front-back')
    back.type = 'button'
    back.textContent = `Back to ${options.title}`
    back.hidden = true
    toSearch.addEventListener('click', () => { front.hidden = true; back.hidden = false; search.focus() })
    back.addEventListener('click', () => { front.hidden = false; back.hidden = true; toSearch.focus() })
    hero.prepend(back)
    hero.append(front)
  }

  const bandsHost = el('div', 'bands')

  // ── what is known ──
  let sites: readonly LedgerSite[] = []
  let ledgerRead = false
  const shared = new Map<string, { offers: readonly HostOffering[]; creations: readonly HostCreation[] }>()
  const asked = new Set<string>()

  // ── pictures: one ask per head, every box that shows that head wears it ──
  const pictures = new Map<string, string | null>()
  const wearers = new Map<string, Set<HTMLElement>>()
  const routes = new Map<string, string>()
  const waiting: string[] = []
  let readers = 0
  // One tile's picture is a short chain (its layer, its properties, the
  // image). Four of those chains left the rest of the row waiting on the
  // first handful. Eight matches what one HTTP/2 connection can carry while
  // the pictures are still arriving one chain at a time inside each tile.
  const PICTURE_READERS = 8
  // THE PAGE ARRIVES WHOLE (jwize 2026-10-31: "they should all show together").
  // The comb stays back while the first pictures are read, and shows at once
  // when the last lands or the wait runs out, whichever is first: a picture
  // that misses it fades in on its own.
  const GATHER_MS = 1_200
  let gathered = false
  let gatherTimer = 0
  const gather = (): void => {
    if (gathered) return
    gathered = true
    window.clearTimeout(gatherTimer)
    bandsHost.classList.remove('gathering')
  }
  const drainPictures = (): void => {
    while (readers < PICTURE_READERS && waiting.length) {
      const head = waiting.shift()!
      readers++
      void tilePicture(head, pictureOrigins(routes.get(head) ?? location.origin)).then(url => {
        readers--
        pictures.set(head, url)
        if (url) {
          for (const art of wearers.get(head) ?? []) wearPicture(art, url, 'hex-picture')
        }
        drainPictures()
        if (!readers && !waiting.length) gather()
      })
    }
  }
  const askPicture = (head: string, route?: string): void => {
    if (!route || pictures.has(head) || routes.has(head)) return
    routes.set(head, route)
    waiting.push(head)
    if (!gathered && !gatherTimer) {
      bandsHost.classList.add('gathering')
      gatherTimer = window.setTimeout(gather, GATHER_MS)
    }
    drainPictures()
  }
  const wear = (art: HTMLElement, head: string, route?: string): void => {
    let set = wearers.get(head)
    if (!set) wearers.set(head, set = new Set())
    set.add(art)
    const url = pictures.get(head)
    if (url) wearPicture(art, url, 'hex-picture')
    else askPicture(head, route)
  }
  /** A small hexagon wearing one version's picture. */
  const miniOf = (head: string, route?: string): HTMLElement => {
    const mini = el('span', 'mini')
    const art = el('span', 'hex-art cover')
    dressCover(art, head)
    wear(art, head, route)
    mini.append(art)
    return mini
  }

  // ── a held tile lists the domains that hold it differently; a click goes to their revision ──
  const backdrop = el('div', 'versions-backdrop')
  backdrop.hidden = true
  const sheet = el('div', 'versions')
  sheet.setAttribute('role', 'dialog')
  sheet.setAttribute('aria-modal', 'true')
  backdrop.append(sheet)
  // In the hero, not the bands: a band re-orders its own children.
  hero.append(backdrop)
  let opener: HTMLElement | null = null
  /** The click a hold ends with lands on the sheet that hold just opened: it is not a tap on the backdrop. */
  let heldOpen = false
  const closeVersions = (): void => {
    document.removeEventListener('keydown', onKey, true)
    backdrop.hidden = true
    sheet.replaceChildren()
    if (opener?.isConnected) opener.focus()
    opener = null
  }
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeVersions() }
  }
  backdrop.addEventListener('pointerdown', () => { heldOpen = false })
  backdrop.addEventListener('click', event => {
    if (heldOpen) { heldOpen = false; return }
    closeVersions()
    event.stopPropagation()
  })
  const openVersions = (entry: Aggregate, from: HTMLElement, row: string): void => {
    opener = from
    const heading = el('h3', 'versions-title')
    heading.textContent = entry.title
    // The domains that hold it as something else. A domain whose copy is signed the same as this
    // domain's own is the same thing, so it is not listed; a click goes to that domain's revision.
    // Only a tile that is IN the showcase has a copy of its own to overlap: take it out and every domain
    // that was left out for holding the same signature is listed again (jwize 2026-10-25: "untap would
    // reshow domain's items that were omitted due to the same signatures filter").
    const mine = showcased(entry) ? entry.versions.find(version => version.places.some(place => place.zone === options.self))?.head : undefined
    const list = el('ul', 'version-list')
    const seen = new Set<string>()
    for (const version of entry.versions) {
      if (version.head === mine) continue
      for (const place of version.places) {
        if (seen.has(place.address)) continue
        seen.add(place.address)
        const item = el('li', 'version')
        const link = el('a', 'version-visit')
        link.href = place.href
        link.target = '_blank'
        link.rel = 'noopener'
        link.textContent = place.address
        const sig = el('span', 'version-sig')
        sig.textContent = version.head.slice(0, 8)
        item.append(link, sig)
        if (options.onOpenHead) {
          const files = el('button', 'version-files')
          files.type = 'button'
          files.textContent = 'Files'
          const head = version.head
          const zone = place.zone
          files.addEventListener('click', () => {
            closeVersions()
            options.onOpenHead?.(head, zone)
          })
          item.append(files)
        }
        list.append(item)
      }
    }
    if (!list.children.length) {
      const none = el('li', 'version')
      none.textContent = 'Every domain holds the same version.'
      list.append(none)
    }
    // The way to put it in (or take it out): on this device when a hive of yours answers here, else by
    // handing the switch to the hive that has the key.
    const item = itemOf(entry, row)
    const inside = showcased(entry)
    const label = inside ? 'Take it out of my showcase' : 'Put it in my showcase'
    let act: HTMLElement | null = null
    if (item) {
      // Putting one in is checked first (optimized and minimized), so it goes through the same act whoever holds the key.
      if ((options.owner && ownerKey) || (!inside && options.minimized)) {
        const button = el('button', 'version-act')
        button.type = 'button'
        button.textContent = label
        button.addEventListener('click', () => { closeVersions(); void tapTile(entry, row) })
        act = button
      } else {
        const href = showcaseHref(keyHome(), { zone: options.self, pubkey: item.pubkey, lineage: item.lineage, on: !inside,
          title: entry.title, back: location.href.split('#')[0]! })
        if (href) {
          const link = el('a', 'version-act')
          link.href = href
          link.target = '_blank'
          link.rel = 'noopener'
          link.textContent = label
          act = link
        }
      }
    }
    sheet.replaceChildren(...[heading, act, list].filter((node): node is HTMLElement => !!node))
    sheet.tabIndex = -1
    backdrop.hidden = false
    document.addEventListener('keydown', onKey, true)
    sheet.focus()
  }

  // ── tiles: ONE link per name, kept and updated in place — a pool arriving
  //    never swaps a tile out from under focus or an open sheet ──
  type TileView = { tile: HTMLAnchorElement; art: HTMLElement; name: HTMLElement; address: HTMLElement
    owners: HTMLElement; head: string; entry: Aggregate }
  const tileViews = new Map<string, TileView>()
  /** The key of the hive beside this page, once it has answered; '' for every visitor. */
  let ownerKey = ''
  const ownerNote = el('p', 'owner-note')
  ownerNote.setAttribute('role', 'status')
  ownerNote.hidden = true
  let tapping = false
  const itemOf = (entry: Aggregate, row: string): ShowcaseItem | null => {
    const version = entry.versions.find(candidate => candidate.places.some(place => place.zone === row)) ?? entry.versions[0]
    const lineage = version?.lineage ?? ''
    const owner = version?.owners.find(candidate => candidate.pubkey === ownerKey) ?? version?.owners[0]
    return lineage && owner ? { pubkey: owner.pubkey, lineage } : null
  }
  const say = (words: string): void => { ownerNote.hidden = false; ownerNote.textContent = words }
  /** The hive that holds the key: the one this page was opened from, else your hive's own address (jwize 2026-11-05: "it
   *  says in order to do this to type keys allow hypercomb.com?" — a click hands the switch to the hive, which asks once,
   *  signs and comes back). Never on a phone, where the hive's address serves this same front door. */
  const keyHome = (): unknown => options.home ?? (onPhone() ? undefined : DEFAULT_HOME)
  // ── WHAT THIS BROWSER TURNED ON (jwize 2026-11-04: the community is "a target, not a domain"; 2026-11-10: tiles toggle
  //    where they sit). The picks are kept in this browser; a picked tile is lit in its domain's row while editing and
  //    shows on the page otherwise. Publishing is its own, signed act, and only for what is optimized and minimized. ──
  let picks: CommunityPick[] = []
  const picked = (entry: Aggregate): boolean => picks.some(pick => pick.key === entry.key)
  let picking = false
  const pickTile = async (entry: Aggregate, row: string): Promise<void> => {
    if (picking) return
    if (!options.keepCommunity) { say('This page cannot keep a community.'); return }
    const was = picks
    const on = !picked(entry)
    // ONE PER SUBDOMAIN, ON ANY DOMAIN (jwize 2026-11-05; a bare apex counts as one): a tile brought in from a host
    // that already has one in the community takes that one's place.
    const known = new Map(bands().flatMap(band => band.open).map(found => [found.key, found] as const))
    const hostOfPick = (pick: CommunityPick): string => {
      const found = pick.key === entry.key ? entry : known.get(pick.key)
      return found ? laneHostOf(placeFor(found, pick.zone).href, pick.zone) : pick.zone
    }
    picks = on ? onePerHost(picks, { zone: row, key: entry.key }, hostOfPick) : picks.filter(pick => pick.key !== entry.key)
    picking = true
    paint()
    const kept = await options.keepCommunity(picks).catch(() => false)
    picking = false
    if (!kept) { picks = was; paint(); say(`Could not turn ${entry.title} ${on ? 'on' : 'off'}.`); return }
    say(`${entry.title} is ${on ? 'on' : 'off'}.`)
  }
  /** Whether a tile's revision is optimized and minimized — asked of the domain that serves it. True where the page
   *  cannot ask (nothing was wired to), so it gates nothing it cannot know. */
  const minimizedFor = async (entry: Aggregate, row: string): Promise<boolean> => {
    if (!options.minimized) return true
    const version = entry.versions.find(candidate => candidate.places.some(place => place.zone === row)) ?? entry.versions[0]
    const zone = version?.places.find(place => place.zone === row)?.zone ?? version?.places[0]?.zone ?? options.self
    return version ? options.minimized(zone, version.head).catch(() => false) : false
  }
  const tapTile = async (entry: Aggregate, row: string): Promise<void> => {
    if (tapping) return
    const on = !showcased(entry)
    const item = itemOf(entry, row)
    if (!item) { say(`${entry.title} names no lineage to sign, so it cannot go live from here.`); return }
    // ONLY WHAT IS OPTIMIZED AND MINIMIZED CAN BE IN THE SHOWCASE (jwize 2026-11-04). Taking one out is never gated.
    if (on && options.minimized) {
      tapping = true
      say(`Checking ${entry.title}…`)
      const ready = await minimizedFor(entry, row)
      tapping = false
      if (!ready) {
        say(`${entry.title} is not optimized and minimized yet, so it cannot be in the showcase. Minify it from its hive, then try again.`)
        return
      }
    }
    const bridge = options.owner
    if (!bridge || !ownerKey) {
      // No hive of yours answers here: hand the switch to the hive that has the key, when the page knows it —
      // except on a phone, where the hive's address serves this same front door (hypercomb-web index.html, the
      // phone gateway) and a handed-off tap would land on a page that cannot sign either.
      const href = onPhone() ? null : showcaseHref(keyHome(), { zone: options.self, pubkey: item.pubkey, lineage: item.lineage, on,
        title: entry.title, back: location.href.split('#')[0]! })
      if (href) { window.open(href, '_blank', 'noopener'); return }
      say(`Going live is signed with your hive's key, and no hive of yours answers in this browser. To promote ${entry.title} from here, `
        + `type "keys allow ${options.self}" in your hive and open its link in this browser; or open ${options.self} where your hive runs.`)
      return
    }
    tapping = true
    ownerNote.hidden = false
    ownerNote.textContent = on ? `Putting ${entry.title} in the showcase…` : `Taking ${entry.title} out of the showcase…`
    const result = await bridge.toggle({ zone: options.self, pubkey: item.pubkey, lineage: item.lineage, on })
    tapping = false
    ownerNote.textContent = result.ok ? (on ? `${entry.title} is in the showcase.` : `${entry.title} is out of the showcase.`) : `Not changed: ${result.reason}.`
    if (result.ok && result.changed) takeLedger(options.ledger)
  }
  // ── A TAP IS A TOGGLE AND A CONFIRM (jwize 2026-11-05: "You should just be able to click and maybe confirm then it is
  //    deployed" / "That simplifies to toggles and confirms" / "remember the community just feeds from the taps" / "it
  //    needs to be just confirm"). Managing, a tap on a domain's tile asks once; yes brings it into your community and
  //    puts it live in the showcase. A tap on a community tile asks once; yes sends it back and takes it off. The going
  //    live is the same signed act as ever (tapTile): gated on optimized and minimized, signed by your hive's key. ──
  // ── IN PLACE (jwize 2026-11-10: "you add domains. You go to them and toggle things on or off. Then you are back in
  //    your mobile app view and you are just using the creations" · "they should have to be published so that the
  //    visitor can see the community but if you have your private key you can publish unpublish stuff"). A tile is ON
  //    when it is published here or this browser turned it on; it lights or grays where it sits, in its own domain's
  //    row. With the key a tap asks once and the yes is the signed act; without one a tap is this browser's own
  //    switch, at once, and what it turns on shows in the page it comes back to. ──
  const isOn = (entry: Aggregate): boolean => showcased(entry) || picked(entry)
  /** Can a tap here end in a signature: a hive or an invited key answers, or (off a phone) the hive can be handed it. */
  const canSign = (): boolean => (!!options.owner && !!ownerKey) || !onPhone()
  const toggleTile = async (entry: Aggregate, row: string, into: boolean): Promise<void> => {
    if (into) {
      if (!picked(entry)) await pickTile(entry, row)
      if (!showcased(entry) && canSign()) await tapTile(entry, row)
      return
    }
    const from = picks.find(pick => pick.key === entry.key)?.zone ?? row
    if (picked(entry)) await pickTile(entry, row)
    if (!showcased(entry)) return
    if (canSign()) await tapTile(entry, from)
    else say(`${entry.title} is published on ${options.self}. Only its key can take it off.`)
  }
  // ONE TAP, THEN ONE RED BUTTON ACROSS THE FOOT (jwize 2026-11-10: "it should be single click to activate with a red
  // confirm button across the bottom of the phone"). No sheet opens over the tiles: the tap names the tile, the bar says
  // what pressing it will sign, and a tap anywhere else, or Escape, puts it away with nothing done.
  const confirmBar = el('button', 'foot-bar confirm-bar')
  confirmBar.type = 'button'
  confirmBar.hidden = true
  let confirming: (() => void) | null = null
  let confirmFrom: HTMLElement | null = null
  const closeConfirm = (): void => {
    if (confirmBar.hidden) return
    confirming = null
    confirmBar.hidden = true
    confirmFrom?.classList.remove('asking')
    confirmFrom = null
    document.removeEventListener('keydown', onConfirmKey, true)
    document.removeEventListener('pointerdown', onConfirmAway, true)
  }
  const onConfirmKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    closeConfirm()
  }
  const onConfirmAway = (event: Event): void => {
    const path = event.composedPath()
    // The bar itself is the answer; another tile asks its own question.
    if (path.includes(confirmBar) || path.some(node => node instanceof Element && node.classList.contains('hex'))) return
    closeConfirm()
  }
  confirmBar.addEventListener('click', () => {
    const act = confirming
    closeConfirm()
    act?.()
  })
  const openConfirm = (entry: Aggregate, from: HTMLElement, row: string): void => {
    closeConfirm()
    const into = !isOn(entry)
    confirmBar.textContent = into ? `Put ${entry.title} in my showcase` : `Take ${entry.title} out of my showcase`
    confirming = () => { void toggleTile(entry, row, into) }
    confirmFrom = from
    from.classList.add('asking')
    confirmBar.hidden = false
    document.addEventListener('keydown', onConfirmKey, true)
    document.addEventListener('pointerdown', onConfirmAway, true)
  }
  bandsHost.append(confirmBar)
  /** Where a tap goes: this row's own place for the name, else its first. */
  const placeFor = (entry: Aggregate, row: string): Place => {
    for (const version of entry.versions) {
      const place = version.places.find(candidate => candidate.zone === row)
      if (place) return place
    }
    return entry.versions[0]!.places[0]!
  }
  /** How long a press is a hold. */
  const HOLD_MS = 500
  /** A name's tile in one row: the same name may show in your domain's row and
   *  in the row of the domain it came from, each its own link. */
  const tileView = (entry: Aggregate, row: string): HTMLAnchorElement => {
    const lead = entry.versions[0]!
    const id = `${row}
${entry.key}`
    let view = tileViews.get(id)
    if (!view) {
      const tile = el('a', `hex hex-${entry.kind}`)
      tile.draggable = false
      const art = el('span', 'hex-art cover')
      const label = el('span', 'hex-label')
      if (entry.kind === 'creation') {
        const kind = el('span', 'hex-kind')
        kind.append(iconOf('sparkle'))
        label.append(kind)
      }
      const name = el('span', 'hex-name')
      const address = el('span', 'hex-address')
      label.append(name, address)
      // How many people own this name — said on the tile only when it is more than one.
      const owners = el('span', 'hex-owners')
      tile.append(art, label, owners)
      const made: TileView = { tile, art, name, address, owners, head: '', entry }
      // A HELD TILE (or a right-click, or Space) says which domains it is on. A tap does nothing:
      // the page is the showcase, not a way out of it.
      let timer: ReturnType<typeof setTimeout> | undefined
      let down: { x: number; y: number } | null = null
      let held = false
      const stop = (): void => { if (timer) clearTimeout(timer); timer = undefined; down = null }
      tile.addEventListener('pointerdown', event => {
        if (event.button > 0 || !event.isPrimary) return
        stop()
        held = false
        down = { x: event.clientX, y: event.clientY }
        timer = setTimeout(() => {
          stop()
          if (!tile.isConnected) return
          held = true
          // In the showcase, on the owner's device, a hold takes the tile out; everywhere else it lists the domains.
          if (row === options.self && options.owner && ownerKey) void tapTile(made.entry, row)
          else { heldOpen = true; openVersions(made.entry, tile, row) }
        }, HOLD_MS)
      })
      tile.addEventListener('pointermove', event => {
        if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 10) stop()
      })
      for (const type of ['pointerup', 'pointercancel', 'pointerleave']) tile.addEventListener(type, stop)
      // IN THE SHOWCASE A TAP VISITS. UNDER ANOTHER DOMAIN A TAP TURNS THE TILE ON OR OFF (jwize 2026-10-25: "of
      // course on other domains it is just toggling"; "they should all be grayed out under other domains and
      // when you click it lights up and it is added to the showcase"). The click a hold ends with is swallowed.
      // MANAGING, A TAP IS THE SWITCH, AND IT ASKS ONCE (jwize 2026-11-05: "it needs to be just confirm"): yes in a
      // domain's row brings the tile into your community and puts it live; yes in the community takes it back out.
      tile.addEventListener('click', event => {
        if (held) { held = false; event.preventDefault(); event.stopPropagation(); return }
        if (row === options.self && !managing) return
        event.preventDefault()
        if (canSign()) openConfirm(made.entry, tile, row)
        else void toggleTile(made.entry, row, !isOn(made.entry))
      })
      tile.addEventListener('contextmenu', event => { event.preventDefault(); stop(); heldOpen = true; openVersions(made.entry, tile, row) })
      tile.addEventListener('keydown', event => {
        if (event.key !== ' ' || event.altKey || event.ctrlKey || event.metaKey) return
        event.preventDefault()
        openVersions(made.entry, tile, row)
      })
      tileViews.set(id, view = made)
    }
    view.entry = entry
    const live = showcased(entry)
    // Gray: not in the showcase yet, in any domain's row; the community row is lit — what is in it is in.
    const lit = live || picked(entry)
    view.tile.classList.toggle('off', row === options.self && !managing ? false : !lit)
    if (managing) view.tile.setAttribute('aria-pressed', String(lit))
    else view.tile.removeAttribute('aria-pressed')
    if (view.head !== lead.head) {
      // A new lead version: its own cover and picture, and the old head forgets this box.
      wearers.get(view.head)?.delete(view.art)
      view.art.replaceChildren()
      view.art.classList.remove('has-picture')
      dressCover(view.art, lead.head)
      wear(view.art, lead.head, lead.route)
      view.head = lead.head
    }
    const place = placeFor(entry, row)
    view.tile.href = place.href
    // Somewhere else on the web opens in its own tab; this origin is this site still.
    if (view.tile.origin !== location.origin) { view.tile.target = '_blank'; view.tile.rel = 'noopener' }
    else { view.tile.removeAttribute('target'); view.tile.removeAttribute('rel') }
    view.tile.title = row !== options.self || managing
        ? `${entry.title} · ${place.address} — tap to turn it ${lit ? 'off' : 'on'}, hold for ${row === options.self ? 'more' : 'its domains'}`
        : `${entry.title} · ${place.address} — tap to visit, hold for more`
    view.name.textContent = entry.title
    view.address.textContent = place.address
    view.owners.hidden = entry.owners < 2
    view.owners.setAttribute('aria-label', count(entry.owners, 'owner', 'owners'))
    view.owners.replaceChildren(iconOf('people'), document.createTextNode(String(entry.owners)))
    return view.tile
  }

  // THE COMB: as many hexes as fit, then one fewer, shifted half a hex — rows
  // counted from the width, never left to float layout, so the comb's height
  // is always the height of the rows it holds.
  const combTiles = new WeakMap<HTMLElement, readonly HTMLElement[]>()
  const combWidths = new WeakMap<HTMLElement, number>()
  const combShapes = new WeakMap<HTMLElement, ShowcaseView>()
  const placeFlat = (parent: HTMLElement, tiles: readonly HTMLElement[]): void => {
    const kept = [...parent.children]
    if (kept.length !== tiles.length || kept.some((node, index) => node !== tiles[index])) parent.replaceChildren(...tiles)
  }
  /** The iPhone launcher: a phone-shaped screen, icons in a grid, the first four in the dock once there are more. */
  const arrangeIphone = (comb: HTMLElement, tiles: readonly HTMLElement[]): void => {
    let spring = comb.querySelector(':scope > .spring')
    if (!spring) {
      spring = el('div', 'spring')
      const grid = el('div', 'spring-grid')
      const dock = el('div', 'spring-dock')
      dock.setAttribute('aria-label', 'Dock')
      const home = el('div', 'spring-home')
      home.setAttribute('aria-hidden', 'true')
      spring.append(grid, dock, home)
      comb.replaceChildren(spring)
    }
    const dockCount = tiles.length > IPHONE_DOCK ? IPHONE_DOCK : 0
    const grid = spring.querySelector('.spring-grid') as HTMLElement
    const dock = spring.querySelector('.spring-dock') as HTMLElement
    placeFlat(grid, tiles.slice(dockCount))
    placeFlat(dock, tiles.slice(0, dockCount))
    dock.hidden = dockCount === 0
    combTiles.set(comb, tiles)
  }
  // ── THE PHONE'S LANES (jwize 2026-11-05: "we want the lanes look for the showcase"): the open row's hexagons sit in a
  //    fixed block of lanes that fills the space between the comb's top and the dock — the landing grid. A drag up or
  //    down moves the window over the tiles, never the page; the tiles follow a clear drag and snap to whole steps, and
  //    a confusing touch (a second finger, a drag across or between) puts them straight back in their slots. ──
  const lanesWanted = (): boolean => { try { return matchMedia('(max-width: 720px)').matches } catch { return false } }
  type LaneState = { layout: LaneLayout; tiles: readonly HTMLElement[]; shift: number; touch: LaneTouch; drifted: boolean; turn: HTMLButtonElement }
  const laneStates = new WeakMap<HTMLElement, LaneState>()
  let laneFlat = false
  const laneSpace = (comb: HTMLElement): { width: number; height: number } => {
    const viewHeight = globalThis.visualViewport?.height ?? innerHeight
    let top = comb.getBoundingClientRect().top
    for (let node = comb.parentElement; node; node = node.parentElement) top += node.scrollTop
    return { width: comb.clientWidth, height: Math.max(220, viewHeight - top - 12) }
  }
  /** How far the comb's scrollers can still move: what the page holds under the comb, beyond the screen. */
  const overflowBelow = (comb: HTMLElement): number => {
    let most = 0
    for (let node = comb.parentElement; node; node = node.parentElement) {
      const scrolls = node === document.scrollingElement || /auto|scroll/.test(getComputedStyle(node).overflowY)
      if (scrolls) most = Math.max(most, node.scrollHeight - node.clientHeight)
    }
    return most
  }
  const drawLanes = (comb: HTMLElement, state: LaneState, dy: number): void => {
    const { layout, tiles, shift } = state
    const placed: HTMLElement[] = []
    // The block, plus one step above and below for the tiles a drag slides in.
    for (let row = -layout.stepRows; row < layout.rows + layout.stepRows; row++) {
      for (let lane = 0; lane < layout.lanes; lane++) {
        const index = laneTileAt(layout, shift, lane, row, tiles.length)
        if (index < 0) continue
        const tile = tiles[index]!
        const at = lanePosition(layout, lane, row)
        tile.style.transform = `translate(${at.x}px, ${at.y + dy}px)`
        placed.push(tile)
      }
    }
    const kept = [...comb.children].filter(node => node !== state.turn)
    if (kept.length !== placed.length || kept.some((node, index) => node !== placed[index])) comb.replaceChildren(...placed, state.turn)
    else if (state.turn.parentElement !== comb) comb.append(state.turn)
    comb.dataset['more'] = shift < laneMaxShift(layout, tiles.length) ? 'below' : ''
    comb.dataset['less'] = shift > 0 ? 'above' : ''
  }
  /** A step lands: drawn first where the finger left it, then eased into the slots. */
  const settleLanes = (comb: HTMLElement, state: LaneState, from: number): void => {
    comb.classList.remove('settling')
    drawLanes(comb, state, from)
    if (!from) return
    void comb.offsetWidth
    comb.classList.add('settling')
    drawLanes(comb, state, 0)
    setTimeout(() => comb.classList.remove('settling'), 240)
  }
  const laneState = (comb: HTMLElement): LaneState => {
    const found = laneStates.get(comb)
    if (found) return found
    const turn = el('button', 'lane-turn')
    turn.type = 'button'
    turn.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      laneFlat = !laneFlat
      void keepLaneOrientation(laneFlat)
      paint()
    })
    const state: LaneState = { layout: laneLayout(1, 1, laneFlat), tiles: [], shift: 0, touch: new LaneTouch(), drifted: false, turn }
    laneStates.set(comb, state)
    const end = (event: PointerEvent): void => {
      const ended = state.touch.up(event.pointerId)
      if (!ended) return
      if (ended.mode !== 'drift') {
        // A drift that ended locked still swallows its own click, and only that one.
        if (state.drifted) { settleLanes(comb, state, 0); setTimeout(() => { state.drifted = false }, 0) }
        return
      }
      const max = laneMaxShift(state.layout, state.tiles.length)
      const drawn = laneDrift(ended.dy, state.layout.stepPx, state.shift, max)
      const next = laneSnap(ended.dy, state.layout.stepPx, state.shift, max)
      const from = drawn + (next - state.shift) * state.layout.stepPx
      state.shift = next
      settleLanes(comb, state, from)
      // The click a drift ends with never presses the tile it ended on.
      setTimeout(() => { state.drifted = false }, 0)
    }
    comb.addEventListener('pointerdown', event => {
      if (event.target instanceof Element && event.target.closest('.lane-turn')) return
      const mode = state.touch.down(event.pointerId, event.clientX, event.clientY)
      if (mode === 'locked') settleLanes(comb, state, 0)
    })
    comb.addEventListener('pointermove', event => {
      const was = state.touch.mode
      const mode = state.touch.move(event.pointerId, event.clientX, event.clientY)
      if (mode === 'drift') {
        if (!state.drifted) { state.drifted = true; try { comb.setPointerCapture(event.pointerId) } catch { /* gone already */ } }
        comb.classList.remove('settling')
        drawLanes(comb, state, laneDrift(state.touch.dy, state.layout.stepPx, state.shift, laneMaxShift(state.layout, state.tiles.length)))
      } else if (mode === 'locked' && was === 'drift') settleLanes(comb, state, 0)
    })
    comb.addEventListener('pointerup', end)
    comb.addEventListener('pointercancel', end)
    comb.addEventListener('click', event => {
      if (!state.drifted) return
      state.drifted = false
      event.preventDefault()
      event.stopPropagation()
    }, true)
    // A wheel or a trackpad at phone width steps the same window, one step a notch.
    comb.addEventListener('wheel', event => {
      if (Math.abs(event.deltaY) < 4) return
      const max = laneMaxShift(state.layout, state.tiles.length)
      const next = Math.min(max, Math.max(0, state.shift + Math.sign(event.deltaY)))
      if (next === state.shift) return
      event.preventDefault()
      const from = (next - state.shift) * state.layout.stepPx
      state.shift = next
      settleLanes(comb, state, from)
    }, { passive: false })
    return state
  }
  const arrangeLanes = (comb: HTMLElement, tiles: readonly HTMLElement[]): void => {
    const state = laneState(comb)
    const sameTiles = state.tiles.length === tiles.length && state.tiles.every((tile, index) => tile === tiles[index])
    combTiles.set(comb, tiles)
    comb.dataset['lanes'] = laneFlat ? 'flat' : 'pointy'
    if (!tiles.length) { comb.style.removeProperty('height'); state.tiles = []; comb.replaceChildren(); return }
    const space = laneSpace(comb)
    if (!space.width) return
    // Nothing scrolls but the tiles: whatever the page still holds under the comb comes off its height.
    comb.style.height = `${space.height}px`
    const excess = overflowBelow(comb)
    const height = Math.floor(excess > 0 ? Math.max(220, space.height - excess - 1) : space.height)
    const { width } = space
    const layout = laneLayout(width, height, laneFlat)
    state.layout = layout
    state.tiles = tiles
    if (!sameTiles) state.shift = 0
    state.shift = Math.min(state.shift, laneMaxShift(layout, tiles.length))
    comb.style.height = `${height}px`
    comb.style.setProperty('--lw', `${layout.tileWidth}px`)
    comb.style.setProperty('--lh', `${layout.tileHeight}px`)
    state.turn.title = laneFlat ? 'Pointy-top tiles' : 'Flat-top tiles'
    state.turn.setAttribute('aria-label', state.turn.title)
    state.turn.dataset['flat'] = String(laneFlat)
    if (!state.turn.firstChild) state.turn.innerHTML = '<svg viewBox="-12 -12 24 24" aria-hidden="true" focusable="false"><polygon points="0,-10 8.66,-5 8.66,5 0,10 -8.66,5 -8.66,-5" fill="none" stroke="currentColor" stroke-width="2"/></svg>'
    drawLanes(comb, state, 0)
  }
  /** Back to the honeycomb rows: what the lanes set on the comb and its tiles is taken off. */
  const leaveLanes = (comb: HTMLElement): void => {
    if (!comb.dataset['lanes']) return
    delete comb.dataset['lanes']
    delete comb.dataset['more']
    delete comb.dataset['less']
    comb.style.removeProperty('height')
    for (const tile of combTiles.get(comb) ?? []) tile.style.removeProperty('transform')
    laneStates.get(comb)?.turn.remove()
    comb.replaceChildren()
  }
  void readLaneOrientation().then(flat => { if (flat !== laneFlat) { laneFlat = flat; paint() } })
  const arrange = (comb: HTMLElement, tiles: readonly HTMLElement[], shape: ShowcaseView = combShapes.get(comb) ?? 'hex'): void => {
    // A change of shape starts the comb over: a launcher is the tiles in a plain
    // grid, an iPhone page is a springboard, a list is a column of blocks, tiles are squares, hexagons are rows counted from the width.
    if (combShapes.get(comb) !== shape) {
      leaveLanes(comb)
      combShapes.set(comb, shape)
      combTiles.delete(comb)
      combWidths.delete(comb)
      comb.replaceChildren()
      if (shape === 'hex') delete comb.dataset['shape']
      else comb.dataset['shape'] = shape
    }
    if (shape === 'iphone') { arrangeIphone(comb, tiles); return }
    // A launcher, a list and tiles are the same tiles, flat. The stylesheet makes one a grid of icons,
    // one a column of blocks, and one a column of squares that snaps like a scroller.
    if (shape === 'launcher' || shape === 'list' || shape === 'tiles') {
      placeFlat(comb, tiles)
      combTiles.set(comb, tiles)
      return
    }
    // ON A PHONE THE HEXAGONS ARE LANES: a fixed block sized to the space, a window that steps (showcase-lanes.ts).
    if (lanesWanted()) { arrangeLanes(comb, tiles); return }
    leaveLanes(comb)
    // The same tiles at the same width are already where they belong: moving
    // them would take focus from a tile and restart its picture's fade.
    const width = comb.clientWidth
    const before = combTiles.get(comb)
    if (before && width === combWidths.get(comb) && before.length === tiles.length
      && before.every((tile, index) => tile === tiles[index])) return
    combTiles.set(comb, tiles)
    combWidths.set(comb, width)
    const row = (members: readonly HTMLElement[], shift: boolean): HTMLElement => {
      const line = el('div', shift ? 'comb-row shift' : 'comb-row')
      line.append(...members)
      return line
    }
    if (!tiles.length || !width) { comb.replaceChildren(row(tiles, false)); return }
    if (!tiles[0]!.isConnected) comb.replaceChildren(row(tiles.slice(0, 1), false))
    // Measure at the stylesheet's size, then grow the tiles just enough that a full row spans the comb EDGE TO EDGE
    // (jwize 2026-10-26: "the tiles need to be flush with the flat sides of the outer pointy-top hexagons"): the outer
    // hexagons' flat sides then sit on the comb's own edges, with no leftover strip to the right.
    comb.style.removeProperty('--s')
    const size = tiles[0]!.getBoundingClientRect().width
    const gap = Number.parseFloat(getComputedStyle(tiles[0]!.parentElement!).columnGap) || 0
    const fit = Math.max(1, Math.floor((width + gap) / (size + gap)))
    if (fit > 1) comb.style.setProperty('--s', `${(width - (fit - 1) * gap) / fit}px`)
    const zigzag = fit > 1 || width >= 1.5 * (size + gap) - gap
    const rows: HTMLElement[] = []
    for (let at = 0, line = 0; at < tiles.length; line++) {
      const shift = zigzag && line % 2 === 1
      const take = fit > 1 && shift ? fit - 1 : fit
      rows.push(row(tiles.slice(at, at + take), shift))
      at += take
    }
    comb.replaceChildren(...rows)
  }
  const combs = typeof ResizeObserver === 'function' ? new ResizeObserver(entries => {
    for (const { target } of entries) arrange(target as HTMLElement, combTiles.get(target as HTMLElement) ?? [])
  }) : null

  // ── THE HYPERDEX: ONE ROW PER DOMAIN (jwize 2026-10-25: "above the tiles
  //    there should be the domain hypercomb.com or your.com. That is the list
  //    item and it is expanded. After should be more domains … when you expand
  //    other domains you see the tiles they have to offer"). This domain's row
  //    comes first and open: its tiles are its showcase — what its owners sign
  //    as `showcase:<zone>`, else what opens here. The rows after it are the
  //    domains this browser holds (its community, `options.sources`), so a
  //    stranger sees only the showcase and you see your whole network. One row
  //    is open at a time. ──
  type RowView = { section: HTMLElement; toggle: HTMLButtonElement; meta: HTMLElement; comb: HTMLElement; empty: HTMLElement }
  const rowViews = new Map<string, RowView>()
  /** The row open now; this domain's until another is opened. */
  let openRow = options.self
  const rowView = (zone: string): RowView => {
    const found = rowViews.get(zone)
    if (found) return found
    const own = zone === options.self
    const section = el('section', own ? 'dex-row own' : 'dex-row')
    const id = `dex-${rowViews.size}`
    const toggle = el('button', 'dex-head')
    toggle.type = 'button'
    toggle.setAttribute('aria-controls', id)
    const name = el('span', 'dex-name')
    name.textContent = zone
    const meta = el('span', 'dex-meta')
    const chevron = el('span', 'dex-chevron')
    chevron.append(iconOf('chevron'))
    toggle.append(iconOf('globe'), name, meta, chevron)
    toggle.addEventListener('click', () => {
      dropMissing(zone)
      openRow = openRow === zone ? '' : zone
      paint()
    })
    const body = el('div', 'dex-body')
    body.id = id
    const comb = el('div', 'comb')
    combs?.observe(comb)
    const empty = el('p', 'hosted-empty')
    body.append(empty, comb)
    section.append(toggle, body)
    // A DOMAIN LEAVES ONLY WHEN IT IS REMOVED (jwize 2026-10-26: "they need to be alive when added and only leave when
    // removed"): a followed domain has a remove control; nothing else — a refresh, a click elsewhere — takes it away.
    if (!own) {
      const remove = el('button', 'dex-remove')
      remove.type = 'button'
      remove.title = `Remove ${zone}`
      remove.setAttribute('aria-label', `Remove ${zone}`)
      remove.append(iconOf('close'))
      remove.addEventListener('click', event => { event.stopPropagation(); void removeDomain(zone) })
      section.append(remove)
    }
    const view = { section, toggle, meta, comb, empty }
    rowViews.set(zone, view)
    return view
  }
  const hosted = el('div', 'hosted')
  const nothing = el('p', 'hosted-nothing')
  nothing.textContent = 'Nothing matches your search.'
  // The domains this browser follows: its community, kept on this origin. Yours
  // to add to here, at the foot — a stranger follows nothing and sees only this
  // domain.
  const held: string[] = [...new Set(options.sources)].filter(zone => zone !== options.self)
  // A DOMAIN BEING CHECKED, OR NOT FOUND (jwize 2026-10-26: "add the domain temporarily before check and not found message, and
  // when refreshed or a new item is clicked remove the items that say not found"): the row is there the moment the domain is
  // asked for, says it is checking, and — if the host does not answer — stays with its message until the page is refreshed or
  // anything else is clicked. A domain that checks out stops being temporary and joins the list.
  const pending = new Map<string, { state: 'checking' | 'missing'; reason: string }>()
  const removeDomain = async (zone: string): Promise<void> => {
    // A row that was only being checked, or was not found, was never kept: removing it is only forgetting it.
    if (pending.has(zone)) pending.delete(zone)
    else if (options.unfollow && !(await options.unfollow(zone).catch(() => false))) { followNote.textContent = `Could not remove ${zone}.`; return }
    const at = held.indexOf(zone)
    if (at >= 0) held.splice(at, 1)
    rowViews.get(zone)?.section.remove()
    rowViews.delete(zone)
    if (openRow === zone) openRow = options.self
    followNote.textContent = `Removed ${zone}.`
    paint()
  }
  const dropMissing = (except = ''): void => {
    let changed = false
    for (const [zone, entry] of pending) if (entry.state === 'missing' && zone !== except) { pending.delete(zone); changed = true }
    if (changed) { for (const zone of [...rowViews.keys()]) if (!pending.has(zone) && !held.includes(zone) && zone !== options.self) { rowViews.get(zone)?.section.remove(); rowViews.delete(zone) } }
  }
  const peerSites = new Map<string, readonly LedgerSite[]>()
  const peerAsked = new Set<string>()
  // What adding or removing a domain said last — the input that once sat beside it is gone (the search adds now).
  const followNote = el('p', 'follow-note')
  followNote.setAttribute('role', 'status')
  // THE COMMUNITIES (jwize 2026-10-25: "swiping between your communities"): the
  // pages after All. A tab strip names them and a sideways swipe on the list
  // turns them; the accordion beneath stays the master list.
  const pager = el('div', 'pager')
  pager.setAttribute('aria-label', 'Communities')
  pager.hidden = true
  bandsHost.append(ownerNote, pager, hosted, nothing, followNote)
  /** The shape asked for on the address (`?view=launcher`), or none. */
  const viewAsked: ShowcaseView | undefined = (() => {
    try { return parseView(new URLSearchParams(location.search).get('view')) } catch { return undefined }
  })()
  /** The community page showing now, by key; '' is All. */
  let page = ''
  /** The one label of the group showing now: a tap on it turns to the next. */
  const label = el('button', 'pager-label')
  label.type = 'button'
  label.id = 'community-label'
  const templateNote = el('span', 'pager-template')
  templateNote.hidden = true
  // WITH THE KEY, THE LOOK CAN BE EVERYONE'S (jwize 2026-11-10: "if you have your private key you can publish"): a quiet
  // link beside the look's name, there only while the look tried here is not the one a visitor is shown.
  const publishLook = el('button', 'pager-publish')
  publishLook.type = 'button'
  publishLook.textContent = 'Show visitors this look'
  publishLook.hidden = true
  let lookSigning = false
  publishLook.addEventListener('click', () => {
    const bridge = options.owner
    if (lookSigning || !bridge?.view || !ownerKey) return
    const view = showing()
    lookSigning = true
    say(`Publishing the ${viewLabel(view)} look…`)
    void bridge.view({ zone: options.self, view }).catch(() => ({ ok: false as const, reason: 'failed' })).then(result => {
      lookSigning = false
      say(result.ok ? `Visitors now see the ${viewLabel(view)} look.` : `Not changed: ${result.reason}.`)
      if (result.ok && result.changed) takeLedger(options.ledger)
      else paint()
    })
  })
  // ADD A PHONE (jwize 2026-11-10: "we need a very easy way to allow our phone to promote"): with the hive beside this
  // page, one press asks it for an invite and shows it as a code. The phone's camera opens it, the phone asks once, and
  // from then on a tap there publishes. The key never moves; the invite works once and runs out.
  const addPhone = el('button', 'pager-publish pager-phone')
  addPhone.type = 'button'
  addPhone.textContent = 'Add a phone'
  addPhone.hidden = true
  let inviting = false
  addPhone.addEventListener('click', () => {
    const bridge = options.owner
    if (inviting || !bridge?.invite || !ownerKey) return
    inviting = true
    say('Making an invite…')
    void bridge.invite({ zone: options.self }).catch(() => ({ ok: false as const, reason: 'failed' })).then(result => {
      inviting = false
      if (!result.ok) { say(`No invite: ${result.reason}.`); return }
      ownerNote.hidden = true
      opener = addPhone
      const heading = el('h3', 'versions-title')
      heading.textContent = 'Add a phone'
      const words = el('p', 'invite-words')
      const minutes = Math.max(1, Math.round((result.until - Date.now() / 1000) / 60))
      words.textContent = `Point the phone's camera at this and tap Allow there. It works once, within ${minutes} minute${minutes === 1 ? '' : 's'}. The phone makes its own key; yours never leaves this device.`
      const parts: HTMLElement[] = [heading]
      if (result.code) {
        const code = el('img', 'invite-code')
        code.alt = 'The invite, as a code for a camera'
        code.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.code)}`
        parts.push(code)
      }
      const copy = el('button', 'version-visit invite-copy')
      copy.type = 'button'
      copy.textContent = 'Copy the link instead'
      copy.addEventListener('click', () => {
        void navigator.clipboard?.writeText(result.link).then(() => { copy.textContent = 'Link copied' }, () => { copy.textContent = 'Could not copy' })
      })
      parts.push(words, copy)
      sheet.replaceChildren(...parts)
      sheet.tabIndex = -1
      backdrop.hidden = false
      document.addEventListener('keydown', onKey, true)
      sheet.focus()
    })
  })
  const hint = el('p', 'pager-hint')
  hint.hidden = true
  const HINT = 'Swipe sideways for another look. Tap a tile to turn it on or off.'
  hint.textContent = HINT
  /** The template tried on this visit, by community key ('' is All). It wins over the signed one until the page is left. */
  const tried = new Map<string, ShowcaseView>()
  const namedCommunities = (): ShowcaseCommunity[] =>
    (signed?.showcase?.communities ?? []).filter(community => community.items.length > 0 || community.domains.length > 0)
  // Groups stay off the public page unless asked for. Manage brings the named sets back, because that is
  // when an up or down swipe walks them.
  const pages = (): ShowcaseCommunity[] => (options.groups || managing) ? namedCommunities() : []
  /** This domain, then the domains followed, then one being checked. The sets an up or down swipe walks when no community is named. */
  const zoneSets = (): string[] =>
    [options.self, ...[...held].sort(), ...[...pending.keys()].filter(zone => !held.includes(zone) && zone !== options.self)]
  const select = (key: string, focus = false): void => {
    page = key
    paint()
    if (focus) label.focus()
  }
  /** The pages go round: on from the last is All, and back from All is the last (jwize 2026-10-25: "it can cycle as well"). */
  const turn = (by: number): void => {
    const keys = ['', ...pages().map(community => communityKey(community.name))]
    const next = (Math.max(0, keys.indexOf(page)) + by + keys.length) % keys.length
    if (keys[next] !== page) select(keys[next]!)
  }
  /** The template showing now: a try on this page, else the community's own, else All's, else hexagons. */
  const showing = (): ShowcaseView => {
    const community = pages().find(row => communityKey(row.name) === page)
    const base = tried.get('') ?? viewAsked ?? signed?.showcase?.view ?? 'hex'
    return tried.get(page) ?? community?.view ?? base
  }
  const cycleTemplate = (by: -1 | 1): void => {
    tried.set(page, swipeView(showing(), by))
    // The look chosen is kept in this browser, so the page comes back as it was left.
    void keepTriedViews(Object.fromEntries(tried))
    paint()
  }
  void readTriedViews().then(kept => {
    let changed = false
    for (const [key, view] of Object.entries(kept)) if (!tried.has(key)) { tried.set(key, view); changed = true }
    if (changed) paint()
  }).catch(() => undefined)
  /** Up or down while managing: the named sets, or the domains you follow when none are named. */
  const cycleSet = (by: -1 | 1): void => {
    if (namedCommunities().length > 0) { turn(by); return }
    const keys = zoneSets()
    if (keys.length < 2) return
    const at = Math.max(0, keys.indexOf(openRow))
    const next = keys[(at + by + keys.length) % keys.length]!
    if (next === openRow) return
    openRow = next
    paint()
  }
  label.addEventListener('click', () => { if (managing && namedCommunities().length === 0) cycleSet(1); else turn(1) })
  pager.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (managing && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
      event.preventDefault()
      cycleTemplate(event.key === 'ArrowRight' ? 1 : -1)
      return
    }
    if (managing && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      cycleSet(event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    const domainKeys = managing && namedCommunities().length === 0
    if (domainKeys && (event.key === 'Home' || event.key === 'End')) {
      const keys = zoneSets()
      if (!keys.length) return
      event.preventDefault()
      openRow = event.key === 'Home' ? keys[0]! : keys[keys.length - 1]!
      paint()
      label.focus()
      return
    }
    const keys = ['', ...pages().map(community => communityKey(community.name))]
    const at = keys.indexOf(page)
    const to = event.key === 'ArrowRight' ? (at + 1) % keys.length : event.key === 'ArrowLeft' ? (at - 1 + keys.length) % keys.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? keys.length - 1 : -1
    if (to < 0) return
    event.preventDefault()
    select(keys[to]!, true)
  })
  // The swipe: touch and pen only (a mouse has the tabs and the arrows), never
  // from the screen's own edge, never calling preventDefault — the browser
  // keeps the vertical scroll — and the click a swipe ends with is swallowed so
  // it can never press a tile. Managing turns the axes: sideways changes the
  // template, up and down changes the set. Otherwise sideways is back and forward.
  let drag: { id: number; x: number; y: number; at: number } | null = null
  let swiped = false
  hosted.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' || event.clientX < 24 || event.clientX > innerWidth - 24) return
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, at: event.timeStamp }
  })
  hosted.addEventListener('pointercancel', () => { drag = null })
  hosted.addEventListener('pointerup', event => {
    const start = drag
    drag = null
    if (!start || event.pointerId !== start.id) return
    const step = gestureStep(event.clientX - start.x, event.clientY - start.y, event.timeStamp - start.at)
    if (!step) return
    swiped = true
    setTimeout(() => { swiped = false }, 0)
    // The square column is its own scroller. Up and down moves the next tile into the frame, and does not turn the set.
    const tiling = step.axis === 'y' && event.target instanceof Element && !!event.target.closest('.comb[data-shape="tiles"], .comb[data-lanes]')
    if (managing) {
      if (step.axis === 'x') cycleTemplate(step.by)
      else if (!tiling) cycleSet(step.by)
      return
    }
    if (step.axis !== 'x') return
    if (pages().length > 0) turn(step.by)
    else if (step.by < 0) { try { history.back() } catch { /* a page with nowhere to go stays */ } }
    else { try { history.forward() } catch { /* a page with nowhere to go stays */ } }
  })
  hosted.addEventListener('click', event => {
    if (!swiped) return
    swiped = false
    event.preventDefault()
    event.stopPropagation()
  }, true)

  // ── THE PLATFORM'S DOORS, AS TILES: the same hexagon as a hive, a link to a
  //    page deployed somewhere — kept, one anchor per address ──
  const hostOf = (href: string): string => {
    try { const url = new URL(href, location.origin); return url.host + (url.pathname.length > 1 ? url.pathname.replace(/\/$/, '') : '') } catch { return '' }
  }
  const linkTiles = new Map<string, HTMLAnchorElement>()
  const linkTile = (link: WelcomeLink): HTMLAnchorElement => {
    const found = linkTiles.get(link.href)
    if (found) return found
    const tile = el('a', 'hex hex-link')
    tile.href = link.href
    // Somewhere else on the web opens in its own tab; this origin is this site still.
    if (tile.origin !== location.origin) { tile.target = '_blank'; tile.rel = 'noopener' }
    tile.title = link.note ? `${link.label} · ${link.note}` : link.label
    const art = el('span', 'hex-art link-art')
    art.append(iconOf(link.icon ?? 'link'))
    const label = el('span', 'hex-label')
    const name = el('span', 'hex-name')
    name.textContent = link.label
    const where = el('span', 'hex-address')
    where.textContent = hostOf(link.href)
    label.append(name, where)
    tile.append(art, label)
    linkTiles.set(link.href, tile)
    return tile
  }
  const linkMatches = (link: WelcomeLink, terms: readonly string[]): boolean => {
    const words = `${link.label} ${link.note} ${link.href}`.toLowerCase()
    return terms.every(term => words.includes(term))
  }

  // ── THE HELP TILES ARE OPTIONAL, AND OFF UNTIL TURNED ON (jwize 2026-11-10). While editing they sit gray in this
  //    domain's row and a tap turns one on or off; what is on is kept in this browser beside its other picks, under a
  //    key no tile has. Outside editing only the ones turned on are drawn, and they are links again. ──
  const HELP_START = 'help:start'
  const helpKey = (link: WelcomeLink): string => `help:${link.href}`
  const helpOn = (key: string): boolean => picks.some(pick => pick.key === key)
  const toggleHelp = async (key: string, title: string): Promise<void> => {
    if (picking) return
    if (!options.keepCommunity) { say('This page cannot keep that choice.'); return }
    const was = picks
    const on = !helpOn(key)
    picks = on ? [...picks, { zone: 'help', key }] : picks.filter(pick => pick.key !== key)
    picking = true
    paint()
    const kept = await options.keepCommunity(picks).catch(() => false)
    picking = false
    if (!kept) { picks = was; paint(); say(`Could not turn ${title} ${on ? 'on' : 'off'}.`); return }
    say(`${title} is ${on ? 'on' : 'off'}.`)
  }
  /** A help tile as it is now: gray and a switch while editing, a plain link otherwise. */
  const asHelp = (tile: HTMLAnchorElement, key: string): HTMLAnchorElement => {
    const on = helpOn(key)
    tile.classList.toggle('off', managing && !on)
    if (managing) tile.setAttribute('aria-pressed', String(on))
    else tile.removeAttribute('aria-pressed')
    return tile
  }
  const helpTile = (link: WelcomeLink): HTMLAnchorElement => {
    const tile = linkTile(link)
    if (!tile.dataset.help) {
      tile.dataset.help = helpKey(link)
      tile.addEventListener('click', event => {
        if (!managing) return
        event.preventDefault()
        void toggleHelp(helpKey(link), link.label)
      })
    }
    return asHelp(tile, helpKey(link))
  }

  // ── THE STARTING TILE of a vanilla hive: the same hexagon, one of the help tiles. It links nowhere: outside editing
  //    a click opens the steps in the sheet a held tile uses ──
  let starterTile: HTMLAnchorElement | null = null
  const openStarter = (guide: Starter, from: HTMLElement): void => {
    opener = from
    const heading = el('h3', 'versions-title')
    heading.textContent = guide.title
    const steps = el('ol', 'starter-steps')
    for (const step of guide.steps) {
      const item = el('li')
      item.append(document.createTextNode(step.text))
      if (step.link) {
        item.append(document.createTextNode(' '))
        const link = el('a', 'version-visit')
        link.href = step.link.href
        link.target = '_blank'
        link.rel = 'noopener'
        link.textContent = step.link.label
        item.append(link)
      }
      steps.append(item)
    }
    sheet.replaceChildren(heading, steps)
    sheet.tabIndex = -1
    backdrop.hidden = false
    document.addEventListener('keydown', onKey, true)
    sheet.focus()
  }
  const starterOf = (guide: Starter): HTMLAnchorElement => {
    if (starterTile) return starterTile
    const tile = el('a', 'hex hex-link hex-starter')
    tile.href = '#start'
    tile.setAttribute('role', 'button')
    tile.title = `${guide.label} · ${guide.note}`
    const art = el('span', 'hex-art link-art')
    art.append(iconOf('hive'))
    const label = el('span', 'hex-label')
    const name = el('span', 'hex-name')
    name.textContent = guide.label
    const hint = el('span', 'hex-address')
    hint.textContent = guide.note
    label.append(name, hint)
    tile.append(art, label)
    tile.addEventListener('click', event => {
      event.preventDefault()
      if (managing) void toggleHelp(HELP_START, guide.label)
      else openStarter(guide, tile)
    })
    starterTile = tile
    return tile
  }
  /** Every publish known now — the ledger's, then each domain's pools — one tile per name. */
  const bands = (): Band[] => {
    const peers = [...peerSites.values()]
    const zones = bandZones([...sites, ...peers.flat()], options.self, held)
    // This host's ledger verifies. A followed domain's ledger is its own word: drawn, never proof.
    // A peer speaks for its own domain only — never for this one — and its names stay its own tiles.
    const publishes = [...ledgerPublishes(sites, zones), ...[...peerSites].flatMap(([peer, list]) =>
      ledgerPublishes(list, zones.filter(row => row !== options.self && within(peer, row)), 'pool', peer))]
    // Only the pools of this domain and the domains followed: a refresh can drop one.
    for (const [zone, pools] of shared) {
      if (zones.includes(zone) || held.includes(zone)) publishes.push(...sharedPublishes(zone, pools.offers, pools.creations))
    }
    return aggregate(publishes, zones, options.self)
  }

  // A domain's pools are asked once, three domains at a time.
  const queue: string[] = []
  let asking = 0
  const drainShared = (): void => {
    while (asking < 3 && queue.length) {
      const zone = queue.shift()!
      asking++
      void options.readShared(zone).catch(() => ({ offers: [], creations: [] })).then(found => {
        asking--
        shared.set(zone, found)
        paint()
        drainShared()
      })
    }
  }
  const askShared = (zone: string): void => {
    if (!asked.has(zone)) {
      asked.add(zone)
      queue.push(zone)
      drainShared()
    }
    // A followed domain's published items come from its own ledger — asked for every
    // domain followed, whether or not this host's ledger happens to know it too.
    if (zone !== options.self && options.readPeerLedger && held.includes(zone) && !peerAsked.has(zone)) {
      peerAsked.add(zone)
      void options.readPeerLedger(zone).catch(() => []).then(found => {
        // A read that brought back nothing never replaces what was known.
        if (found.length || !peerSites.has(zone)) peerSites.set(zone, found)
        paint()
      })
    }
  }
  // Pictures are asked for when a tile is drawn (wear), never for tiles the page hides.

  /** What this domain's owners sign; undefined until read, null when it could not be. */
  let signed: ZoneOwners | null | undefined
  /**
   * IN THIS DOMAIN'S SHOWCASE. What its owners chose, when they signed a
   * showcase; else what they PUBLISHED here — a lineage whose signed doors
   * name this domain (jwize 2026-10-25: "what ever you turn on and off on
   * publish window should be hidden from your public domain showcase"). A
   * lineage with no doors opens everywhere on the worker, which keeps older
   * versions working, but it was never published here, so it is not shown.
   * A head the owner's live list does not name is not on the visitor site
   * either, even when a door still names the domain.
   */
  const covers = (entry: Aggregate, items: readonly ShowcaseItem[], domains: readonly string[]): boolean =>
    entry.zones.some(zone => domains.includes(zone))
    || entry.versions.some(version => version.claims.some(claim =>
      items.some(item => item.pubkey === claim.pubkey && item.lineage === claim.lineage)))
  const showcased = (entry: Aggregate): boolean => {
    // Nothing is known of what the owners meant — no index was reached, or the showcase one names
    // could not be read: show nothing rather than a larger set than they chose.
    if (signed && (!signed.reached || signed.unreadable)) return false
    // No live list: a door is enough. A list: a head it does not name stays off the visitor site.
    const liveHere = (head: string): boolean => !signed?.live || signed.live.has(head)
    const record = signed?.showcase
    if (record) {
      if (entry.zones.some(zone => record.domains.includes(zone))) return true
      // A named item is shown unless Publish has turned it off for this domain.
      if (entry.versions.some(version => liveHere(version.head) && version.claims.some(claim =>
        record.items.some(item => item.pubkey === claim.pubkey && item.lineage === claim.lineage)
        && doorsOpen(signed!, claim.pubkey, claim.lineage, options.self) !== false))) return true
      // A followed domain's tile has no claim this ledger verified: the owners' signed record naming its
      // publisher and lineage is the choice, so a tile promoted from your community is live.
      return entry.versions.some(version => !version.claims.length && !!version.lineage && version.owners.some(owner =>
        record.items.some(item => item.pubkey === owner.pubkey && item.lineage === version.lineage)))
    }
    const claims = entry.versions.flatMap(version => version.claims)
    // A domain's own pool offers what it shares here by putting it there.
    if (!claims.length) return entry.zones.includes(options.self)
    if (!signed) return entry.zones.includes(options.self)
    return entry.versions.some(version => liveHere(version.head) && version.claims.some(claim =>
      doorsOpen(signed!, claim.pubkey, claim.lineage, options.self) === true))
  }

  const within = (zone: string, of: string): boolean => zone === of || zone.endsWith(`.${of}`)
  /** What a row offers: its band, or — for a followed domain under one already drawn — the parent's names that open under it. */
  const rowItems = (all: readonly Band[], zone: string): readonly Aggregate[] => {
    const band = all.find(row => row.zone === zone)
    if (band) return band.open
    const parent = all.find(row => within(zone, row.zone))
    return parent ? parent.open.filter(entry => entry.versions.some(version => version.places.some(place => {
      try { return within(new URL(place.href).hostname, zone) } catch { return false }
    }))) : []
  }
  /** The label of the current group — All, or a community's name — kept in place so a repaint never takes its focus.
   *  While managing with no named set, the label is the domain whose tiles are open. */
  const paintPager = (communities: readonly ShowcaseCommunity[], shape: ShowcaseView): void => {
    const domains = managing && namedCommunities().length === 0
    const names = domains ? zoneSets() : ['All', ...communities.map(row => row.name)]
    const keys = domains ? names : ['', ...communities.map(row => communityKey(row.name))]
    const at = Math.max(0, keys.indexOf(domains ? openRow : page))
    label.textContent = names[at] ?? 'All'
    label.setAttribute('aria-label', `${label.textContent}, group ${at + 1} of ${Math.max(1, names.length)}. Press for the next.`)
    templateNote.hidden = !managing
    templateNote.textContent = managing ? viewLabel(shape) : ''
    hint.hidden = !managing
    publishLook.hidden = !managing || !ownerKey || !options.owner?.view || lookSigning || !!page || shape === (signed?.showcase?.view ?? 'hex')
    addPhone.hidden = !managing || !ownerKey || !options.owner?.invite || onPhone()
    // A phone with no key is told the one thing that gives it one.
    hint.textContent = managing && onPhone() && !ownerKey && !!options.owner && !ownerless
      ? `${HINT} To publish from this phone, open ${options.self} on your computer, turn on Manage and press Add a phone.` : HINT
    if (label.parentElement !== pager) pager.replaceChildren(label, templateNote, publishLook, addPhone, hint)
    pager.hidden = !managing && communities.length === 0
    if (pager.hidden) hosted.removeAttribute('aria-labelledby')
    else hosted.setAttribute('aria-labelledby', label.id)
  }
  /** The domain the search offers to add now, or ''. */
  let offered = ''

  function paint(): void {
    const terms = searchTerms(search.value)
    const all = bands()
    askShared(options.self)
    for (const zone of held) askShared(zone)
    const unread = !!options.readOwners && signed === undefined
    const communities = pages()
    // A community that is gone is a page that is gone: back to All.
    if (page && !communities.some(community => communityKey(community.name) === page)) page = ''
    const community = communities.find(row => communityKey(row.name) === page)
    // A community only ever filters: its members must already be in the showcase.
    const published = unread ? [] : all.flatMap(band => band.tiles).filter(showcased)
      .filter(entry => !community || covers(entry, community.items, community.domains))
    /** What this browser turned on, found wherever a row offers it now; a pick no row offers waits unseen. */
    const known = new Map(all.flatMap(band => band.open).map(entry => [entry.key, entry] as const))
    const turnedOn = community || unread ? [] : picks.map(pick => known.get(pick.key)).filter((entry): entry is Aggregate => !!entry)
    // THE PAGE YOU COME BACK TO: what is published here, and what this browser turned on in any domain it added.
    const everything = [...new Map([...published, ...turnedOn].map(entry => [entry.key, entry] as const)).values()].sort(byTitle)
    // The platform's doors are the first page's; a community is about what is shared.
    const links = community ? [] : options.links ?? []
    // HOW IT IS DRAWN: a try from this visit, else a community's own view, else All's
    // (`?view=` on the address, else what was signed), else the brand's hexagons.
    // A try changes nothing signed. An explicit view on a community beats what All lends it.
    const base = tried.get('') ?? viewAsked ?? signed?.showcase?.view ?? 'hex'
    const shape = tried.get(page) ?? community?.view ?? base
    // This domain first; then the domains this browser follows, by name.
    const rows: HTMLElement[] = []
    let visible = 0
    // AN ACCORDION OF DOMAINS, THE OPEN ONE ALWAYS AT THE TOP (jwize 2026-10-26: "you click the domain view and it is an accordion
    // of domains with the open one showing the available; they are below the open item, which is always at the top"). While
    // managing, every domain is a row; the open row shows its tiles and is first, the rest follow below it as headers.
    const everyZone = zoneSets()
    const rowZones = everyZone
    const order = managing && openRow && rowZones.includes(openRow) ? [openRow, ...rowZones.filter(zone => zone !== openRow)] : rowZones
    // What this domain holds, managing: what is in its showcase and what else it publishes — lit when live, gray when not.
    const ownHeld = [...new Map([...published, ...rowItems(all, options.self)].map(entry => [entry.key, entry] as const)).values()].sort(byTitle)
    for (const zone of order) {
      const view = rowView(zone)
      const own = zone === options.self
      // EVERY TILE STAYS IN ITS DOMAIN'S ROW, lit when it is on and gray when it is not. Editing, this domain's row is
      // what it holds; otherwise it is the page itself — everything that is on.
      const items = own ? (managing ? ownHeld : everything) : rowItems(all, zone).slice().sort(byTitle)
      const shown = items.filter(entry => aggregateMatches(entry, terms))
      // The doors wait for the ledger: the row draws once, not the doors and then the hives.
      const doors = own && ledgerRead && !unread ? links.filter(link => linkMatches(link, terms)) : []
      // The help tiles: every one while editing, so it can be turned on; otherwise only those this browser turned on.
      const helps = own && ledgerRead && !unread && !community
        ? (options.help ?? []).filter(link => (managing || helpOn(helpKey(link))) && linkMatches(link, terms)) : []
      const starting = own && ledgerRead && !unread && !!options.starter && !community && !terms.length && (managing || helpOn(HELP_START))
      const total = shown.length + doors.length + helps.length
      visible += !managing && !own ? 0 : terms.length ? total : 1
      // While a search runs every row holding a match is open; otherwise one is.
      const open = !managing ? own : openRow === zone
      view.section.classList.toggle('open', open)
      view.toggle.setAttribute('aria-expanded', String(open))
      view.section.hidden = !managing && !own
      const temp = pending.get(zone)
      view.meta.textContent = temp ? (temp.state === 'checking' ? 'Checking…' : 'Not found') : count(items.length + (own ? links.length : 0), 'tile', 'tiles')
      view.section.classList.toggle('missing', temp?.state === 'missing')
      arrange(view.comb, open ? [...shown.map(entry => {
        const tile = tileView(entry, zone)
        // In another domain's row, a tile already on this domain's page says so.
        tile.classList.toggle('in-showcase', !own && showcased(entry))
        return tile
      }), ...doors.map(link => linkTile(link)), ...helps.map(helpTile),
      ...(starting && options.starter ? [asHelp(starterOf(options.starter), HELP_START)] : [])] : [], own ? shape : base)
      view.empty.hidden = !open || (own ? shown.length > 0 && !unread : total > 0)
      view.empty.textContent = temp ? (temp.state === 'checking' ? `Checking ${zone}…` : `${zone} was not found — ${temp.reason}`)
        : own && (!ledgerRead || unread) ? 'Reading what is published here…'
        : own && signed && !ownerless && (!signed.reached || signed.unreadable) ? 'Could not read what is published here.'
          : own ? 'Nothing is published here yet.' : `Nothing is published on ${zone} yet.`
      rows.push(view.section)
    }
    // Re-insert only when the order changed: moving a row takes focus from it.
    const current = [...hosted.children]
    if (current.length !== rows.length || current.some((node, index) => node !== rows[index])) hosted.replaceChildren(...rows)
    paintPager(communities, shape)
    bandsHost.classList.toggle('managing', managing)
    // WHEN THE OPEN ROW IS COLLAPSED, EVERY ROW SITS AT THE TOP (jwize 2026-10-26: "if you collapse the row showing data they should
    // all collapse to the top"): with nothing open there is no row to take the free height, so the rows stack from the top.
    hosted.classList.toggle('none-open', managing && !rowZones.includes(openRow))
    hosted.classList.toggle('swipeable', (managing || communities.length > 0) && !terms.length)
    // A domain being checked or not found is a row on the page: the search that named it has not matched nothing.
    nothing.hidden = !terms.length || visible > 0 || pending.size > 0
    // THE SEARCH FILTERS; while its line is a valid domain nobody follows yet, the link at its right end offers to add it.
    // The link is never rebuilt, only shown or hidden, so a press that began on it still lands.
    const candidate = followCandidate(search.value)
    offered = options.follow && candidate && !held.includes(candidate) && !within(candidate, options.self) ? candidate : ''
    searchAdd.hidden = !offered
    if (offered) searchAdd.textContent = `Add ${offered}`
    const hives = everything.filter(entry => entry.kind === 'hive')
    const creations = everything.length - hives.length
    stats.replaceChildren()
    for (const [n, icon, one, many] of [[hives.length, 'hive', 'hive', 'hives'],
      [creations, 'sparkle', 'shared creation', 'shared creations']] as const) {
      if (!n) continue
      const row = el('span')
      row.append(iconOf(icon), document.createTextNode(count(n, one, many)))
      stats.append(row)
    }
  }

  /** Add a domain: asked of the host that keeps the list, then drawn as a row, open. */
  let following = false
  const follow = async (raw: string): Promise<void> => {
    if (!options.follow || following) return
    following = true
    searchAdd.disabled = true
    followNote.textContent = 'Checking…'
    // The row appears NOW, before the host has been asked, so the person sees what is being looked for.
    const asked = followCandidate(raw)
    const temporary = !!asked && !held.includes(asked) && !within(asked, options.self)
    if (temporary) {
      dropMissing(asked)
      pending.set(asked, { state: 'checking', reason: '' })
      openRow = asked
      if (!managing) setManaging(true)
      else paint()
    }
    const result = await options.follow(raw).catch(() => ({ ok: false as const, reason: 'Could not add it.' }))
    searchAdd.disabled = false
    following = false
    if (!result.ok) {
      followNote.textContent = result.reason
      if (temporary) { pending.set(asked, { state: 'missing', reason: result.reason }); paint() }
      return
    }
    if (asked) pending.delete(asked)
    pending.delete(result.zone)
    if (!held.includes(result.zone)) held.push(result.zone)
    followNote.textContent = `Added ${result.zone}.`
    openRow = result.zone
    // A domain just added is looked at in the filter: Manage turns on to show it.
    if (!managing) setManaging(true)
    else paint()
    rowViews.get(result.zone)?.section.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }

  /** The search's act. While it offers a domain, adding it; otherwise settling the search: a domain you already follow
   *  opens as its row, and the keyboard goes so the results can be seen. */
  const goOrFollow = async (): Promise<void> => {
    const asked = followCandidate(search.value)
    if (offered) {
      await follow(search.value)
      // Added: the line did its job. A miss keeps the line, so a typo can be mended and asked again.
      if (asked && held.includes(asked) && followCandidate(search.value) === asked) { search.value = ''; paint() }
      return
    }
    const zone = asked === options.self || held.includes(asked) ? asked : ''
    if (zone) {
      search.value = ''
      openRow = zone
      if (zone !== options.self && !managing) setManaging(true)
      else paint()
    }
    search.blur()
  }
  searchAdd.addEventListener('click', () => { void goOrFollow() })
  // Enter does what the link does while a domain is offered, on any screen. Otherwise the keyboard's own Go key settles the
  // search on a phone, and on a wide screen the search is only for searching.
  const narrow = (): boolean => { try { return matchMedia('(max-width: 720px)').matches } catch { return false } }
  search.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || (!offered && !narrow())) return
    event.preventDefault()
    void goOrFollow()
  })

  search.addEventListener('input', () => paint())
  // WHAT IS PUBLISHED NOW: the page is the ledger as read, nothing kept from
  // a deploy. Only the newest read is believed if two cross on the wire.
  let reads = 0
  const takeLedger = (ledger: Promise<readonly LedgerSite[]>): void => {
    const read = ++reads
    void ledger.then(found => {
      if (read !== reads) return
      // A read that brought back nothing is a read that failed: the page never trades what it knew for nothing.
      if (!found.length && sites.length) return
      sites = found
      ledgerRead = true
      // The owners of this domain are the keys its own root names. Until their
      // record is read the list waits rather than show what it may not.
      const owners = found.find(site => site.hosts[0] === options.self)?.owners ?? []
      // A domain whose ledger names no owner has nothing signed to read: that is nothing published, not a failed read.
      ownerless = owners.length === 0
      const owned = options.readOwners?.(options.self, owners)
      if (owned) {
        void owned.catch((): ZoneOwners | null => null).then(found => {
          if (read !== reads) return
          // A read that reached no owner's index says nothing: keep what was last known,
          // and where nothing was known show nothing rather than guess.
          if (!found?.reached && signed?.reached) { paint(); return }
          signed = found ?? { showcase: null, doors: new Map(), reached: false, unreadable: false }
          paint()
        })
      }
      paint()
    })
  }
  takeLedger(options.ledger)
  paint()
  options.owner?.hello().then(key => { if (key) { ownerKey = key; paint() } }).catch(() => undefined)
  options.readCommunity?.().then(found => { if (found.length && !picks.length) { picks = [...found]; paint() } }).catch(() => undefined)
  /** Read again: what is published now replaces what was, and each domain's
   *  pools are asked again. */
  const refresh = (ledger: Promise<readonly LedgerSite[]>): void => {
    dropMissing()
    asked.clear()
    peerAsked.clear()
    takeLedger(ledger)
  }
  return { hero, bands: bandsHost, refresh, showFiles: setFilesOpen }
}

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

// A honeycomb, as a mask: one tile of the lattice, repeated.
const LATTICE = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='52' height='90' viewBox='0 0 51.96 90'%3E%3Cpath d='M25.98 0V15L51.96 30V60L25.98 75L0 60V30L25.98 15M25.98 75V90' fill='none' stroke='%23000' stroke-width='1.2'/%3E%3C/svg%3E")`

export const SHOWCASE_STYLE = `
.card.showcase-page {
  --hex: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
  --gold-1: #ffe08a; --gold-2: #f8b73a; --gold-3: #d9860b;
  background:
    radial-gradient(62rem 34rem at 88% -8%, color-mix(in srgb, var(--gold-2) 30%, transparent), transparent 70%),
    radial-gradient(48rem 30rem at -12% 30%, color-mix(in srgb, #e0607e 11%, transparent), transparent 70%),
    radial-gradient(60rem 40rem at 112% 75%, color-mix(in srgb, #3aa6a0 10%, transparent), transparent 70%),
    linear-gradient(180deg, var(--md-surface-c-low), var(--md-surface) 45%);
}
.card.showcase-page::before {
  content: ''; position: absolute; inset: 0 0 auto; height: 18rem; pointer-events: none;
  background: var(--md-primary); opacity: .09;
  -webkit-mask: ${LATTICE} 0 0 / 52px 90px repeat, linear-gradient(#000, transparent 85%);
  -webkit-mask-composite: source-in;
  mask: ${LATTICE} 0 0 / 52px 90px repeat, linear-gradient(#000, transparent 85%);
  mask-composite: intersect;
}
.showcase-page .panel { position: relative; }

/* the room, last in the brand row: a front page that hosts a swarm says so beside its name */
.hero-swarm { flex: none; display: inline-flex; align-items: center; gap: .45rem; padding: .45rem .8rem; font-size: .85rem;
  border-radius: var(--hc-radius-control, 2px); background: var(--md-primary); color: var(--md-on-primary); font-weight: 600; text-decoration: none;
  box-shadow: 0 6px 18px -8px color-mix(in srgb, var(--md-primary) 70%, transparent); }
.hero-swarm:hover, .hero-swarm:focus-visible { filter: brightness(1.06); }
.hero-swarm svg { width: 1.05rem; height: 1.05rem; }
/* the header: a small brand row, then the search across the full width. The
   brand takes at most 2.5 times the search's height, margins and all (jwize
   2026-10-24) — lean, never cramped. */
.card.showcase-page { grid-template-columns: minmax(0, 1fr); scroll-padding-top: 4.5rem; }
.card.showcase-page .panel { margin-top: 1.75rem; width: min(100rem, calc(100vw - 1rem)); min-width: 0; }
/* the header's two rows are the page's own: the search sticks flush to the top of the scrolled
   page where the brand was, and the brand comes back when the page is scrolled back to it */
.hero { display: contents; }
/* a phone's front page on a host that stages a presentation: its name and line, and the published hive in place */
.front { position: fixed; inset: 0; height: 100vh; height: 100dvh; z-index: 45; display: flex; flex-direction: column; background: var(--md-surface); }
.front[hidden] { display: none; }
.front-bar { flex: none; display: flex; align-items: center; gap: .65rem; padding: calc(.55rem + env(safe-area-inset-top, 0px)) .8rem .55rem;
  border-bottom: 1px solid var(--md-outline); }
.front-mark { flex: none; display: block; width: 1.6rem; height: 1.6rem; }
.front-mark svg { display: block; width: 100%; height: 100%; }
.front-words { flex: 1 1 auto; min-width: 0; }
.front-words h1 { margin: 0; color: var(--md-on-surface-strong); font-size: 1.05rem; line-height: 1.2; letter-spacing: 0; }
.front-words p { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--md-on-surface-var); font-size: .82rem; line-height: 1.3; }
.front-search, .front-back { box-sizing: border-box; min-height: 2.75rem; padding: 0 1rem; border: 1px solid var(--md-outline); border-radius: .6rem; cursor: pointer;
  background: var(--md-surface-c-highest); color: var(--md-on-surface-strong); font: 600 .9rem/1 var(--md-font-ui, Inter, system-ui, sans-serif); }
.front-search { flex: none; }
.front-search:focus-visible, .front-back:focus-visible { outline: 2px solid var(--md-primary); outline-offset: 2px; }
.front-back { display: block; width: 100%; margin: 0 0 .6rem; text-align: left; }
.front-back[hidden] { display: none; }
.front-frame { flex: 1 1 auto; min-height: 0; width: 100%; border: 0; background: var(--md-surface-c-lowest); }
.hero-brand { display: flex; align-items: center; gap: .75rem; min-width: 0; margin: 0 0 .15rem; }
.hero-mark { flex: none; display: grid; width: 2.1rem; height: 2.1rem; }
.hero-mark svg { width: 100%; height: 100%; }
.hero-words { display: flex; align-items: baseline; gap: .9rem; flex: 1; min-width: 0; }
.hero h1 { flex: none; margin: 0; overflow-wrap: anywhere; color: var(--md-on-surface-strong);
  font: 600 1.45rem/1.15 'Source Serif 4', Georgia, serif; letter-spacing: -.025em; }
.hero-tagline { margin: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--md-on-surface-var); font-size: .9rem; line-height: 1.4; }
.hero-stats { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: .4rem 1.1rem; margin: 0 0 0 auto; flex: none;
  font: 500 .66rem/1 ui-monospace, "SF Mono", Menlo, Consolas, monospace; letter-spacing: .14em; text-transform: uppercase; color: var(--md-on-surface-faint); }
.hero-stats span, .band-meta span { display: inline-flex; align-items: center; gap: .45rem; }
.hero-stats svg, .band-meta svg { width: .95rem; height: .95rem; color: var(--md-primary); }
.search { position: sticky; top: 0; z-index: 25; display: flex; align-items: center; margin: 0; padding: .55rem 0;
  background: color-mix(in srgb, var(--md-surface-c-low) 90%, transparent); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }
.search[hidden] { display: none; }
.search > svg { position: absolute; z-index: 1; left: .95rem; top: 50%; margin-top: -.575rem; width: 1.15rem; height: 1.15rem; color: var(--md-primary); pointer-events: none; }
.search input {
  flex: 1; width: 100%; padding: .78rem 1rem .78rem 2.8rem; font: 400 1rem/1.3 var(--md-font-ui, Inter, system-ui, sans-serif);
  color: var(--md-on-surface-strong); border-radius: var(--hc-radius-control, 2px);
  background: var(--md-surface-c-lowest);
  border: 1px solid color-mix(in srgb, var(--md-primary) 32%, var(--md-outline-variant));
}
/* ADD DOMAIN: a quiet link inside the field's right end, shown only while the line is a domain nobody follows yet */
.search-field { position: relative; flex: 1; min-width: 0; display: flex; align-items: center; }
.hero-brand[hidden], .hero-brand > [hidden] { display: none; }
.invite-code { display: block; width: min(16rem, 70vw); height: auto; margin: 0 auto .8rem; border-radius: 4px; background: #fff; }
.invite-words { margin: 0 0 .8rem; color: var(--md-on-surface-var); font: 500 .92rem/1.45 var(--md-font-ui, Inter, system-ui, sans-serif); }
.pager-phone { margin-left: .9rem; }
.pager-publish:not([hidden]) ~ .pager-phone { margin-left: .9rem; }
/* the foot of the page: the one act the last tap or the search offers, across the bottom of a phone */
.foot-bar { position: fixed; left: 50%; bottom: 0; z-index: 6; transform: translateX(-50%); box-sizing: border-box; width: min(100vw, 34rem);
  margin: 0; padding: 1.05rem 1.2rem calc(1.05rem + env(safe-area-inset-bottom, 0px)); border: 0; border-radius: 0; cursor: pointer;
  font: 700 1rem/1.25 var(--md-font-ui, Inter, system-ui, sans-serif); text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  box-shadow: 0 -.4rem 1.6rem rgb(0 0 0 / .35); }
.foot-bar[hidden] { display: none; }
.foot-bar:hover:not(:disabled) { transform: translateX(-50%); filter: brightness(1.08); }
.foot-bar:disabled { opacity: .6; cursor: default; }
.foot-bar:focus-visible { outline: 2px solid var(--md-on-surface-strong); outline-offset: -4px; }
.search-add { background: var(--md-surface-c-highest); color: var(--md-on-surface-strong); border-top: 1px solid var(--md-outline); }
.search-add:hover:not(:disabled) { background: var(--md-surface-c-highest); }
.confirm-bar { z-index: 7; background: #c62828; color: #fff; }
.confirm-bar:hover:not(:disabled) { background: #c62828; }
.hex.asking { outline: 2px solid #c62828; outline-offset: 3px; }
@media (min-width: 720px) { .foot-bar { bottom: 1rem; border-radius: .7rem; } }
/* the options sit beside the search, at the top: Files (while managing) and Manage */
.page-tools { flex: none; display: flex; align-items: center; gap: .45rem; margin-left: .5rem; }
.page-tools button[hidden] { display: none; }
.page-tools button { display: grid; place-items: center; width: 2.75rem; height: 2.75rem; margin: 0; padding: 0; cursor: pointer;
  border: 1px solid color-mix(in srgb, var(--md-primary) 32%, var(--md-outline-variant)); border-radius: 999px;
  background: var(--md-surface-c-lowest); color: var(--md-on-surface); }
.page-tools button svg { width: 1.3rem; height: 1.3rem; }
.page-tools button:hover { border-color: var(--md-primary); color: var(--md-primary); }
.page-tools button[aria-pressed='true'] { background: var(--md-primary); border-color: var(--md-primary); color: var(--md-on-primary); }
.page-tools button[aria-pressed='true']:hover { color: var(--md-on-primary); filter: brightness(1.06); }
.page-tools button:focus-visible { outline: 2px solid var(--md-primary); outline-offset: 2px; }
/* the Files sheet: above the bar. A fixed title row, and one body that scrolls on its own; the page beneath never moves */
.files-sheet { position: fixed; z-index: 39; left: 50%; bottom: calc(.5rem + env(safe-area-inset-bottom)); transform: translateX(-50%);
  box-sizing: border-box; display: flex; flex-direction: column; width: min(calc(100% - 1rem), 36rem); max-height: min(36rem, calc(100dvh - 9rem));
  margin: 0; padding: 0; overflow: hidden; border: 1px solid var(--md-outline-variant); border-radius: 1rem;
  background: color-mix(in srgb, var(--md-surface-c-low) 97%, transparent); -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px);
  box-shadow: 0 18px 48px -18px rgb(0 0 0 / .55); }
.files-sheet[hidden] { display: none; }
.files-sheet > .files-head { flex: none; padding: .6rem .6rem .6rem 1rem; border-bottom: 1px solid var(--md-outline-variant); }
.files-sheet .files-title { flex: 1; font: 600 1.1rem/1.2 var(--md-font-ui, Inter, system-ui, sans-serif); letter-spacing: normal; text-transform: none;
  color: var(--md-on-surface-strong); }
.files-sheet .files-close { display: grid; place-items: center; flex: none; width: 2.5rem; height: 2.5rem; padding: 0; border: 0; background: transparent;
  color: var(--md-on-surface-var); border-radius: var(--hc-radius-control, 2px); }
.files-sheet .files-close svg { width: 1.2rem; height: 1.2rem; }
.files-sheet > .files-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 1rem; }
.files-sheet .branch-view { margin: 0; padding: 0; border-top: 0; }
.bands:not(.managing) .dex-row > .dex-head { display: none; }
/* managing: the open domain is the first row and takes the free height; the others sit below it as plain header rows */
.bands.managing > .hosted { grid-template-rows: minmax(min-content, 1fr); grid-auto-rows: min-content; align-content: start; }
.bands > .hosted > .dex-row:not(.open) { align-self: start; }
.bands.managing > .hosted.none-open { grid-template-rows: none; }
/* a domain that was asked for and not found: a temporary row, toned as a warning until something else is clicked */
.dex-row.missing { border-color: color-mix(in srgb, var(--hc-status-alert, #b3261e) 55%, var(--md-outline-variant)); }
.dex-row.missing .dex-meta { color: var(--hc-status-alert, #b3261e); }
.dex-row { position: relative; }
.dex-remove { position: absolute; top: .45rem; right: 3.1rem; display: grid; place-items: center; width: 2rem; height: 2rem; padding: 0; z-index: 2;
  border: 0; border-radius: var(--hc-radius-control, 2px); background: transparent; color: var(--md-on-surface-var); cursor: pointer; }
.dex-remove svg { width: .95rem; height: .95rem; }
.dex-remove:hover, .dex-remove:focus-visible { background: color-mix(in srgb, var(--hc-status-alert, #b3261e) 18%, transparent); color: var(--hc-status-alert, #b3261e); outline: none; }
.bands:not(.managing) .dex-remove { display: none; }
.search input::placeholder { color: var(--md-on-surface-faint); }
.search input:focus { outline: 2px solid var(--md-primary); outline-offset: 1px; }

/* every hex: a gold frame, art inside it, a name across its lower half */
.hex-art { position: absolute; inset: 0; overflow: hidden; clip-path: var(--hex); isolation: isolate; color: #fff; }
.hex-art.cover { background:
    radial-gradient(circle at 28% 20%, color-mix(in srgb, var(--c1, #f6c453) 62%, #fff), transparent 46%),
    radial-gradient(circle at 76% 86%, color-mix(in srgb, var(--c2, #a3520c) 72%, #000), transparent 58%),
    linear-gradient(var(--ang, 140deg), var(--c1, #f6c453), var(--c2, #a3520c)); }
.hex-art.cover::before { content: ''; position: absolute; inset: 0; z-index: 0; background: #fff; opacity: .1;
  -webkit-mask: ${LATTICE} 0 0 / 26px 45px repeat; mask: ${LATTICE} 0 0 / 26px 45px repeat; }
.hex-motif { position: absolute; inset: 0; z-index: 0; width: 100%; height: 100%; opacity: .32; transition: transform .6s cubic-bezier(.2, 0, 0, 1); }
.hex-art > svg:not(.hex-motif) { position: relative; z-index: 1; width: 42%; height: 42%; margin: 29%; opacity: .8; }
.hex-picture { position: absolute; inset: 0; z-index: 1; width: 100%; height: 100%; object-fit: cover; opacity: 0;
  animation: sc-in .5s ease forwards; transition: transform .6s cubic-bezier(.2, 0, 0, 1); }
.bands.gathering .comb { opacity: 0; }
.hex-art.has-picture::before, .hex-art.has-picture > .hex-motif { display: none; }
@keyframes sc-in { to { opacity: 1; } }

.bands { position: relative; }
.hosted { position: relative; margin: 0 0 clamp(2rem, 5vh, 3rem); }
.band-meta { display: flex; flex-wrap: wrap; gap: .3rem 1.1rem;
  font: 500 .66rem/1.2 ui-monospace, "SF Mono", Menlo, Consolas, monospace; letter-spacing: .14em; text-transform: uppercase; color: var(--md-on-surface-faint); }
.hosted-empty[hidden], .dex-row[hidden], .hosted-nothing[hidden], .follow-suggest[hidden], .follow-note:empty { display: none; }
/* the communities: a strip of names after All; the list beneath turns with a swipe */
.pager { display: flex; flex-wrap: wrap; align-items: baseline; gap: .35rem .75rem; margin: 0 0 .5rem; padding: .3rem 0; }
.pager[hidden] { display: none; }
.pager-template { color: var(--md-primary); font: 600 .78rem/1.2 var(--md-font-ui, Inter, system-ui, sans-serif); }
.pager-hint { flex-basis: 100%; margin: 0; color: var(--md-on-surface-faint); font-size: .75rem; line-height: 1.35; }
.pager-template[hidden], .pager-hint[hidden], .pager-publish[hidden] { display: none; }
.pager-publish { margin-left: auto; padding: .2rem 0; border: 0; background: transparent; cursor: pointer; color: var(--md-primary);
  font: 600 .78rem/1.2 var(--md-font-ui, Inter, system-ui, sans-serif); text-decoration: underline; text-underline-offset: .2em; }
.pager-publish:focus-visible { outline: 2px solid var(--md-primary); outline-offset: 2px; }
.owner-note { margin: 0 0 .5rem; color: var(--md-on-surface-var); font-size: .85rem; }
.owner-note[hidden] { display: none; }
.hex.off { opacity: .35; filter: grayscale(1); }
.pager-label { padding: .2rem 0; border: 0; background: transparent; cursor: pointer; color: var(--md-on-surface-strong);
  font: 600 1rem/1.2 var(--md-font-ui, Inter, system-ui, sans-serif); }
.pager-label:focus-visible { outline: 2px solid var(--md-primary); outline-offset: 2px; }
.hosted { touch-action: pan-y pinch-zoom; }
/* THE LAUNCHER (jwize 2026-10-25): the same tiles — the same pictures, names, badges and links — in the traditional rows of four. The hexagon stays the brand's default. */
.comb[data-shape='launcher'] { --icon: 6rem; display: grid; grid-template-columns: repeat(4, minmax(0, var(--icon))); justify-content: start; gap: 1.3rem 1.1rem; }
.comb[data-shape='launcher'] .hex { width: 100%; height: auto; display: grid; justify-items: center; align-content: start; gap: .45rem;
  clip-path: none; background: none; transition: none; }
.comb[data-shape='launcher'] .hex > .hex-art { position: relative; inset: auto; width: 100%; aspect-ratio: 1; clip-path: none; border-radius: 22%;
  box-shadow: 0 .35rem .9rem -.45rem rgb(60 35 0 / .55), inset 0 0 0 1px rgb(255 255 255 / .18); transition: transform .2s; }
.comb[data-shape='launcher'] .hex > .hex-art::after { display: none; }
.comb[data-shape='launcher'] .hex-label { position: static; width: 100%; color: var(--md-on-surface-strong); }
.comb[data-shape='launcher'] .hex-name { font-size: .78rem; line-height: 1.2; letter-spacing: 0; text-shadow: none; }
.comb[data-shape='launcher'] .hex-address, .comb[data-shape='launcher'] .hex-kind { display: none; }
.comb[data-shape='launcher'] .hex-owners { top: -.3rem; right: -.3rem; left: auto; transform: none; }
.comb[data-shape='launcher'] .hex.in-showcase::after { top: -.3rem; right: -.3rem; left: auto; transform: none; width: 1.25rem; height: 1.25rem; font-size: .7rem; }
.comb[data-shape='launcher'] a.hex:hover, .comb[data-shape='launcher'] a.hex:focus-visible { background: none; }
.comb[data-shape='launcher'] .hex:hover > .hex-art { transform: translateY(-2px); }
.comb[data-shape='launcher'] a.hex:focus-visible { outline: 2px solid var(--md-primary); outline-offset: 3px; }
.comb[data-shape='launcher'] a.hex:focus-visible > .hex-art { inset: auto; }
/* THE IPHONE LAUNCHER: the same tiles on a phone-shaped screen. Four columns, the name under each icon,
   a dock of the first four once there are more, and the home bar. */
.comb[data-shape='iphone'] { display: flex; justify-content: center; min-width: 0; max-width: 100%; }
.comb[data-shape='iphone'] .spring { box-sizing: border-box; display: flex; flex-direction: column; min-width: 0; width: min(100%, 26rem); max-width: 100%;
  min-height: 28rem; padding: 1.15rem .85rem .7rem; border-radius: 1.75rem; color: #fff;
  background:
    radial-gradient(120% 80% at 12% -10%, color-mix(in srgb, var(--md-primary) 72%, #fff), transparent 48%),
    radial-gradient(90% 70% at 110% 8%, color-mix(in srgb, var(--gold-1) 50%, #9ab), transparent 46%),
    radial-gradient(80% 60% at 50% 110%, color-mix(in srgb, #e0607e 35%, transparent), transparent 52%),
    linear-gradient(165deg, #1a2744, #2c3358 58%, #1b2433);
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / .14), 0 1rem 2.4rem -1.2rem rgb(12 16 32 / .55); }
.comb[data-shape='iphone'] .spring-grid, .comb[data-shape='iphone'] .spring-dock { display: grid; min-width: 0; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1.05rem .45rem; align-content: start; }
.comb[data-shape='iphone'] .spring-grid { flex: 1 1 auto; }
.comb[data-shape='iphone'] .spring-dock { margin-top: .85rem; padding: .65rem .35rem .5rem; border-radius: 1.5rem;
  background: rgb(255 255 255 / .16); -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px); }
.comb[data-shape='iphone'] .spring-dock[hidden] { display: none; }
.comb[data-shape='iphone'] .spring-home { width: 34%; height: .28rem; margin: .65rem auto 0; border-radius: 999px; background: rgb(255 255 255 / .88); }
.comb[data-shape='iphone'] .hex { width: 100%; height: auto; display: grid; justify-items: center; align-content: start; gap: .35rem;
  clip-path: none; background: none; transition: none; }
.comb[data-shape='iphone'] .hex > .hex-art { position: relative; inset: auto; width: 100%; max-width: 4.4rem; aspect-ratio: 1; clip-path: none; border-radius: 22.5%;
  box-shadow: 0 .4rem .9rem rgb(0 0 0 / .28), inset 0 0 0 1px rgb(255 255 255 / .22); transition: transform .2s; }
.comb[data-shape='iphone'] .hex > .hex-art::after { display: none; }
.comb[data-shape='iphone'] .link-art > svg { position: absolute; inset: 0; width: 42%; height: 42%; margin: auto; }
.comb[data-shape='iphone'] .hex-label { position: static; width: 100%; color: #fff; }
.comb[data-shape='iphone'] .hex-name { font-size: .68rem; font-weight: 500; line-height: 1.15; letter-spacing: 0; text-shadow: 0 1px 2px rgb(0 0 0 / .7); -webkit-line-clamp: 1; }
.comb[data-shape='iphone'] .hex-address, .comb[data-shape='iphone'] .hex-kind { display: none; }
.comb[data-shape='iphone'] .hex-owners, .comb[data-shape='iphone'] .hex.in-showcase::after { top: -.2rem; right: auto;
  left: calc(50% + min(2.2rem, 50%) - .85rem); transform: none; }
.comb[data-shape='iphone'] .hex.in-showcase::after { width: 1.15rem; height: 1.15rem; font-size: .65rem; }
.comb[data-shape='iphone'] a.hex:hover, .comb[data-shape='iphone'] a.hex:focus-visible { background: none; }
.comb[data-shape='iphone'] .hex:hover > .hex-art { transform: translateY(-2px); }
.comb[data-shape='iphone'] a.hex:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
.comb[data-shape='iphone'] a.hex:focus-visible > .hex-art { inset: auto; }
/* THE LIST: the same tiles as blocks down the page. One in your own showcase is a link.
   One under another domain is on (a check) or off (gray), and a tap switches it. */
.comb[data-shape='list'] { display: flex; flex-direction: column; gap: .4rem; min-width: 0; max-width: 100%; }
.comb[data-shape='list'] .hex { box-sizing: border-box; width: 100%; min-width: 0; height: auto; min-height: 3.4rem; display: flex; align-items: center; gap: .75rem;
  padding: .45rem .75rem; clip-path: none; border-radius: var(--hc-radius-card, 3px);
  background: color-mix(in srgb, var(--md-surface-c-lowest) 80%, transparent);
  border: 1px solid var(--md-outline-variant); }
.comb[data-shape='list'] .hex > .hex-art { position: relative; inset: auto; flex: none; width: 2.6rem; height: 2.6rem; aspect-ratio: 1;
  clip-path: none; border-radius: 22%; }
.comb[data-shape='list'] .hex > .hex-art::after { display: none; }
.comb[data-shape='list'] .link-art > svg { position: absolute; inset: 0; width: 46%; height: 46%; margin: auto; }
.comb[data-shape='list'] .hex-label { position: static; flex: 1 1 auto; min-width: 0; display: grid; justify-items: start; gap: .1rem; text-align: left;
  color: var(--md-on-surface-strong); }
.comb[data-shape='list'] .hex-name { -webkit-line-clamp: 1; font-size: .92rem; line-height: 1.2; letter-spacing: 0; text-shadow: none; }
.comb[data-shape='list'] .hex-address { display: block; opacity: .75; }
.comb[data-shape='list'] .hex-kind { display: none; }
.comb[data-shape='list'] .hex-owners { position: static; transform: none; flex: none; }
.comb[data-shape='list'] .hex.in-showcase { padding-right: 2.4rem; border-color: color-mix(in srgb, var(--md-primary) 55%, var(--md-outline-variant)); }
.comb[data-shape='list'] .hex.in-showcase::after { top: 50%; right: .75rem; left: auto; transform: translateY(-50%); }
.comb[data-shape='list'] a.hex:not(.off):not(.in-showcase) { padding-right: 2rem; }
.comb[data-shape='list'] a.hex:not(.off):not(.in-showcase)::after { content: ''; position: absolute; right: .95rem; top: 50%; width: .4rem; height: .4rem;
  border-right: 2px solid var(--md-on-surface-var); border-top: 2px solid var(--md-on-surface-var); transform: translateY(-50%) rotate(45deg); }
.comb[data-shape='list'] a.hex:hover, .comb[data-shape='list'] a.hex:focus-visible { background: color-mix(in srgb, var(--md-primary) 10%, transparent); }
.comb[data-shape='list'] a.hex:focus-visible { outline: 2px solid var(--md-primary); outline-offset: 2px; }
.comb[data-shape='list'] a.hex:focus-visible > .hex-art { inset: auto; }
/* TILES: one column, and the column is a scroller. The frame is a square (a container cannot
   query its own size, so the side is the width and the ratio makes the height). Each square fills
   that frame, the picture goes to every edge, and a flick lands on the next square. Up and down
   inside the column move the frame; they do not turn the set. */
.comb[data-shape='tiles'] { box-sizing: border-box; display: flex; flex-direction: column; flex: none; align-self: center;
  width: min(100%, 30rem, 78dvh); max-width: 100%; aspect-ratio: 1; height: auto; min-width: 0; min-height: 0;
  margin-inline: auto; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain;
  scroll-snap-type: y mandatory; touch-action: pan-y; scrollbar-width: none; background: #0c1016;
  border-radius: var(--hc-radius-card, 3px);
  box-shadow: 0 1.25rem 2.8rem -1.4rem rgb(8 10 16 / .65), inset 0 0 0 1px rgb(255 255 255 / .08); }
.comb[data-shape='tiles']::-webkit-scrollbar { width: 0; height: 0; }
.comb[data-shape='tiles'] .hex { flex: none; width: 100%; min-width: 0; height: auto; aspect-ratio: 1; clip-path: none;
  border-radius: 0; background: none; scroll-snap-align: start; scroll-snap-stop: always; }
.comb[data-shape='tiles'] .hex > .hex-art { position: absolute; inset: 0; width: auto; height: auto; clip-path: none; border-radius: 0; }
.comb[data-shape='tiles'] .hex > .hex-art::after { background: linear-gradient(180deg, transparent 52%, rgb(8 10 14 / .28) 74%, rgb(8 10 14 / .82)); }
.comb[data-shape='tiles'] .link-art > svg { position: absolute; inset: 0; width: 28%; height: 28%; margin: auto; }
.comb[data-shape='tiles'] .hex-label { position: absolute; left: .9rem; right: .9rem; top: auto; bottom: .85rem; z-index: 3;
  display: grid; justify-items: start; gap: .22rem; text-align: left; color: #fff; }
.comb[data-shape='tiles'] .hex-name { -webkit-line-clamp: 1; font-size: 1.05rem; font-weight: 600; line-height: 1.15; letter-spacing: -.01em; }
.comb[data-shape='tiles'] .hex-address { display: block; opacity: .78; font-size: .62rem; letter-spacing: .12em; text-transform: uppercase; }
.comb[data-shape='tiles'] .hex-kind { display: none; }
.comb[data-shape='tiles'] .hex-owners { top: .7rem; right: .7rem; left: auto; transform: none; }
.comb[data-shape='tiles'] .hex.in-showcase::after { top: .7rem; left: .7rem; right: auto; transform: none; }
.comb[data-shape='tiles'] a.hex:hover, .comb[data-shape='tiles'] a.hex:focus-visible { background: none; }
.comb[data-shape='tiles'] a.hex:focus-visible { outline: 2px solid #fff; outline-offset: -3px; }
.comb[data-shape='tiles'] a.hex:focus-visible > .hex-art { inset: 0; }
.hosted-nothing { margin: .4rem 0 1rem; color: var(--md-on-surface-var); }
/* the platform's doors are tiles: the same hexagon, a glyph for a picture, a link for a click */
a.hex { color: inherit; text-decoration: none; cursor: pointer; }
.link-art { display: block; background: linear-gradient(160deg, #1d2733, #10161e); color: var(--gold-2); }
.link-art > svg { position: relative; z-index: 1; display: block; width: 38%; height: 38%; margin: 20% 31% 0; opacity: .95; }
.hex-link:hover .link-art, .hex-link:focus-visible .link-art { color: var(--gold-1); }
/* the faux starting tile: the same hexagon, quieter than a real one until it is reached for */
.hex-starter { opacity: .72; transition: background .25s, opacity .25s; }
.hex-starter:hover, .hex-starter:focus-visible { opacity: 1; }
.starter-steps { display: grid; gap: .7rem; margin: 0; padding-left: 1.2rem; color: var(--md-on-surface-var); font: 500 .92rem/1.45 var(--md-font-ui, Inter, system-ui, sans-serif); }
/* the card's generic li is a flex row with a rule above it; a step is a plain numbered line */
.starter-steps li { display: list-item; padding: 0; border-top: 0; }
.starter-steps li::marker { color: var(--md-primary); font-weight: 700; }
.hex-link:focus-visible { outline: 2px solid var(--md-primary); outline-offset: 3px; }
/* following a domain: a search that found nothing offers it, and the foot always can */
.follow-suggest { display: flex; margin: 0 0 1.2rem; }
.follow-suggest button { flex: none; padding: .68rem 1.1rem; border: 0; border-radius: var(--hc-radius-control, 2px);
  background: var(--md-primary); color: var(--md-on-primary); font: 600 .92rem/1.2 var(--md-font-ui, Inter, system-ui, sans-serif); cursor: pointer; }
.follow-suggest button:hover:not(:disabled) { filter: brightness(1.08); }
.follow-suggest button:disabled { opacity: .6; cursor: default; }
.follow-suggest button:focus-visible { outline: 2px solid var(--md-primary); outline-offset: 2px; }
/* ANCHORED TO THE BOTTOM (jwize 2026-10-26: "anchor the input and follow to the bottom and expand the div fit to content, aside
   from the same gutter as the top input and the div"): the panel is at least the screen tall and the follow bar is pushed to
   its foot, so a short list leaves the bar at the bottom of the screen and a long one carries it along; the card above
   is exactly as tall as its tiles, and the gap to the bar is the search's own .55rem. */
.card.showcase-page .panel { display: flex; flex-direction: column; min-height: calc(100dvh - 1.75rem); margin-bottom: 0;
  padding-bottom: calc(4.1rem + env(safe-area-inset-bottom)); }
.bands { display: flex; flex: 1 1 auto; flex-direction: column; min-width: 0; }
.bands > .hosted { margin-bottom: 0; flex: 1 1 auto; align-content: stretch; }
/* NO DEAD AREA (jwize 2026-10-26: "need to close the dead area"): the open card takes the whole space between the search and
   the follow bar, so the dark surface runs unbroken from one to the other and the tiles sit at its top. */
.bands > .hosted > .dex-row.open { display: flex; flex-direction: column; }
.bands > .hosted > .dex-row.open > .dex-body { flex: 1 1 auto; }
.follow-note { margin: .6rem 0 0; color: var(--md-on-surface-var); font-size: .85rem; line-height: 1.4; }
/* the hyperdex: one row per domain, this one first and open */
.hosted { display: grid; grid-template-columns: minmax(0, 1fr); gap: .5rem; margin: 0 0 clamp(2rem, 5vh, 3rem); }
.dex-row { min-width: 0; margin: 0; border: 1px solid var(--md-outline-variant); border-radius: var(--hc-radius-card, 3px);
  background: color-mix(in srgb, var(--md-surface-c-lowest) 72%, transparent); }
.dex-row.open { border-color: color-mix(in srgb, var(--md-primary) 40%, var(--md-outline-variant)); }
.dex-head { display: flex; align-items: center; gap: .6rem; width: 100%; padding: .7rem .9rem; border: 0; background: transparent;
  color: var(--md-on-surface-strong); font: 600 1rem/1.2 var(--md-font-ui, Inter, system-ui, sans-serif); text-align: left; cursor: pointer; }
.dex-head:hover:not(:disabled) { background: color-mix(in srgb, var(--md-primary) 6%, transparent); }
.dex-head:focus-visible { outline: 2px solid var(--md-primary); outline-offset: -2px; }
.dex-head > svg { flex: none; width: 1.05rem; height: 1.05rem; color: var(--md-primary); }
.dex-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dex-meta { flex: none; margin-left: auto; color: var(--md-on-surface-faint);
  font: 500 .66rem/1 ui-monospace, "SF Mono", Menlo, Consolas, monospace; letter-spacing: .12em; text-transform: uppercase; }
.dex-chevron { display: grid; flex: none; color: var(--md-on-surface-var); transition: transform .2s; }
.dex-chevron svg { width: 1.1rem; height: 1.1rem; }
.dex-row.open .dex-chevron { transform: rotate(180deg); color: var(--md-primary); }
.dex-body { padding: 1rem; }
.dex-row:not(.open) .dex-body { display: none; }
/* a tile in another domain's row that is already in your showcase */
.hex.in-showcase::after { content: '✓'; position: absolute; z-index: 3; top: 12%; left: 50%; transform: translateX(-50%);
  display: grid; place-items: center; width: 1.5rem; height: 1.5rem; border-radius: 50%;
  background: var(--md-primary); color: var(--md-on-primary); font: 700 .8rem/1 var(--md-font-ui, Inter, system-ui, sans-serif); }
.hosted-empty { margin: 0; padding: 1.3rem 1.2rem; border: 1px dashed var(--md-outline-variant); border-radius: var(--hc-radius-card, 3px); color: var(--md-on-surface-var); }
.mini { position: relative; width: 2.3rem; height: calc(2.3rem * 1.1547); margin-left: -.7rem; clip-path: var(--hex);
  background: linear-gradient(160deg, var(--gold-1), var(--gold-3)); }
.mini:first-child { margin-left: 0; }
.mini > .hex-art { inset: 1.5px; }
.mini > .hex-art:not(.has-picture) { background-color: var(--md-surface-c-high); }

/* the honeycomb: rows of pointy-top hexagons, every other one shifted half a hex */
.comb { --s: 10.4rem; --g: .3rem; display: grid; justify-content: start; min-width: 0; }
.comb-row { display: flex; gap: var(--g); }
.comb-row + .comb-row { margin-top: calc(var(--g) * .866 - var(--s) * .2887); }
.comb-row.shift { padding-left: calc((var(--s) + var(--g)) / 2); }
.hex { position: relative; display: block; flex: none; width: var(--s); height: calc(var(--s) * 1.1547); clip-path: var(--hex);
  margin: 0; padding: 0; border: 0; border-radius: 0; font: inherit; color: inherit;
  background: linear-gradient(160deg, color-mix(in srgb, var(--gold-1) 75%, transparent), color-mix(in srgb, var(--gold-3) 55%, transparent));
  text-decoration: none; transition: background .25s; }
.hex-owners { position: absolute; top: 11%; left: 50%; z-index: 3; display: inline-flex; align-items: center; gap: .25rem;
  transform: translateX(-50%); padding: .15rem .45rem; border-radius: var(--hc-radius-pill, 999px);
  background: rgb(14 8 2 / .62); color: #fff; font: 700 .7rem/1 var(--md-font-ui, Inter, system-ui, sans-serif); pointer-events: none; }
.hex-owners svg { width: .85rem; height: .85rem; color: var(--gold-1); }
.hex > .hex-art { inset: 2.5px; }
.hex > .hex-art::after { content: ''; position: absolute; inset: 0; z-index: 2; transition: opacity .3s;
  background: linear-gradient(180deg, transparent 36%, rgb(14 8 2 / .55) 70%, rgb(14 8 2 / .82)); }
.hex-label { position: absolute; left: 9%; right: 9%; top: 57%; z-index: 3; display: grid; justify-items: center; gap: .18rem; text-align: center; color: #fff; pointer-events: none; }
.hex-name { max-width: 100%; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere;
  font: 650 .98rem/1.15 var(--md-font-ui, Inter, system-ui, sans-serif); letter-spacing: -.01em; text-shadow: 0 1px 3px rgb(0 0 0 / .6); }
.hex-address { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: .8;
  font: 500 .58rem/1.3 ui-monospace, "SF Mono", Menlo, Consolas, monospace; letter-spacing: .03em; }
.hex-kind svg { width: .95rem; height: .95rem; color: var(--gold-1); }
/* only a real tile answers the pointer: a hive's button, or a door's link */
a.hex { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent; }
a.hex:hover { background: linear-gradient(160deg, var(--gold-1), var(--gold-2) 50%, var(--gold-3)); }
a.hex:hover .hex-picture, a.hex:hover .hex-motif { transform: scale(1.07); }
a.hex:hover > .hex-art::after { opacity: .8; }
a.hex:focus-visible { outline: none; background: var(--md-primary); }
a.hex:focus-visible > .hex-art { inset: 4px; }
.hex-owners[hidden] { display: none; }
/* THE PHONE'S LANES: slots never move, the tiles are placed in them (showcase-lanes.ts) */
.comb[data-lanes] { position: relative; display: block; overflow: hidden; touch-action: none; overscroll-behavior: contain; }
.comb[data-lanes] > .hex { position: absolute; left: 0; top: 0; width: var(--lw); height: var(--lh); will-change: transform; }
.comb[data-lanes='flat'] { --hex: polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%); }
.comb[data-lanes='flat'] .hex-label { top: 54%; left: 14%; right: 14%; }
.comb[data-lanes].settling > .hex { transition: transform .22s cubic-bezier(.2, 0, 0, 1); }
.comb[data-lanes]::before, .comb[data-lanes]::after { content: ''; position: absolute; left: 0; right: 0; height: 1.6rem; z-index: 4; pointer-events: none; opacity: 0; transition: opacity .2s; }
.comb[data-lanes]::before { top: 0; background: linear-gradient(180deg, var(--md-surface), transparent); }
.comb[data-lanes]::after { bottom: 0; background: linear-gradient(0deg, var(--md-surface), transparent); }
.comb[data-lanes][data-less='above']::before, .comb[data-lanes][data-more='below']::after { opacity: .9; }
.lane-turn { position: absolute; right: .25rem; bottom: .25rem; z-index: 5; display: grid; place-items: center; width: 2.25rem; height: 2.25rem; padding: 0;
  border: 1px solid var(--md-outline-variant); border-radius: 999px; background: color-mix(in srgb, var(--md-surface) 88%, transparent);
  color: var(--md-on-surface-var); cursor: pointer; }
.lane-turn svg { width: 1.1rem; height: 1.1rem; transition: transform .25s; }
.lane-turn[data-flat='true'] svg { transform: rotate(30deg); }

/* a held tile: the domains it is on */
.versions-backdrop { position: fixed; inset: 0; z-index: 30; display: grid; place-items: center; padding: 1rem;
  background: rgb(20 12 4 / .45); }
.versions-backdrop[hidden] { display: none; }
.versions { box-sizing: border-box; width: min(24rem, 100%); max-height: 70vh; overflow: auto; padding: 1rem 1.1rem;
  background: var(--md-surface-c-low); color: var(--md-on-surface); border: 1px solid var(--md-outline-variant);
  border-radius: var(--hc-radius-card, 3px); outline: 0; }
.versions-title { margin: 0 0 .6rem; overflow-wrap: anywhere; color: var(--md-on-surface-strong); }
.version-list { list-style: none; margin: 0; padding: 0; display: grid; gap: .35rem; }
.version-cancel { display: block; width: 100%; padding: .55rem .8rem; border: 1px solid var(--md-outline-variant); border-radius: var(--hc-radius-control, 2px);
  background: transparent; color: var(--md-on-surface); font: inherit; cursor: pointer; }
.version-act { display: block; box-sizing: border-box; width: 100%; margin: 0 0 .7rem; padding: .6rem .8rem; text-align: center; text-decoration: none;
  border: 1px solid var(--md-primary); border-radius: var(--hc-radius-control, 2px); background: transparent; color: var(--md-primary); cursor: pointer;
  font: 600 .9rem/1.2 var(--md-font-ui, Inter, system-ui, sans-serif); }
.version { display: flex; justify-content: space-between; gap: .8rem; overflow-wrap: anywhere; font: 500 .85rem/1.35 ui-monospace, "SF Mono", Menlo, Consolas, monospace; color: var(--md-on-surface-var); }
a.version-visit { color: var(--md-primary); }
.version-sig { opacity: .6; }
@media (max-width: 720px) { .versions-backdrop { place-items: end stretch; padding: 0; } .versions { width: 100%; } }

/* A PHONE: one column of the same list. */
@media (max-width: 720px) {
  /* the list is the whole width of the screen: rows edge to edge, room to see and to do */
  .card.showcase-page { scroll-padding-bottom: 0; }
  /* ONE SIDE MARGIN, NARROW OR WIDE (jwize 2026-10-26: "when squeezed it has a margin again"): everything sits .5rem from the
     screen edge, the same as the wide page, and the follow bar is in the flow at the foot of a screen-tall panel, so the card
     fills right down to it with no band between. */
  .card.showcase-page .panel { margin-top: 0; width: 100%; min-width: 0; min-height: 100dvh; padding-bottom: 0; }
  .hero-brand { padding: .8rem .5rem .15rem; }
  .search { padding: .55rem .5rem; }
  .search > svg { left: calc(.5rem + .95rem); }
  .follow-note { margin-left: .5rem; margin-right: .5rem; }
  .pager { margin: 0 0 .5rem; padding: .3rem .5rem; }
  .hosted { gap: 0; }
  .dex-row { border-left: 0; border-right: 0; border-radius: 0; margin-top: -1px; }
  .dex-head { padding: 1rem .5rem; }
  .hosted-nothing, .follow-suggest { margin-left: .5rem; margin-right: .5rem; }
  /* the phone is a dead-simple hyperdex (jwize 2026-10-25): the rows, with the search above them — nothing else. The desktop
     keeps the setup beneath, because it is the dashboard and the hosting. */
  .showcase-page details.manage { display: none; }
  .dex-body { padding: .5rem; }
  /* the swipe's ground: a short community must not shrink the place a thumb can turn the page */
  .hosted.swipeable { min-height: 60vh; min-height: 60dvh; align-content: start; }
  /* ONLY THE TILES SCROLL (jwize 2026-11-04: "we are trying not to have anything scroll except for the tiles or the viewport
     for other sections"): the panel is exactly the screen, the brand and the search hold still at the top, and the list
     beneath is the one thing a thumb moves. */
  .card.showcase-page { overflow: hidden; }
  .card.showcase-page .panel { height: 100dvh; min-height: 0; }
  .bands { min-height: 0; }
  /* THE LIST REACHES THE FOOT OF THE SCREEN: no bar sits there any more (the options are at the top), so its end padding
     is only the safe area. */
  .bands > .hosted, .hosted.swipeable { min-height: 0; overflow-y: auto; overscroll-behavior: contain;
    padding-bottom: calc(env(safe-area-inset-bottom) + .75rem); }
  .files-sheet { width: calc(100% - 1rem); }
  .hero-brand { gap: .6rem; }
  .hero-mark { width: 1.7rem; height: 1.7rem; }
  .hero h1 { font-size: 1.2rem; }
  /* the sentence goes on a phone: the name, the count and the search are the header */
  .hero-tagline { display: none; }
  .mini { width: 1.8rem; height: calc(1.8rem * 1.1547); margin-left: -.55rem; }
  .comb { --s: 6.1rem; --g: .18rem; }
  .comb[data-shape='launcher'] { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1.1rem .7rem; }
  .comb[data-shape='launcher'] .hex-name { font-size: .72rem; }
  .comb[data-shape='iphone'] .spring { width: 100%; min-height: 22rem; padding: .85rem .55rem .6rem; border-radius: 0; }
  .comb[data-shape='iphone'] .hex-name { font-size: .64rem; }
  .hex-name { font-size: .74rem; }
  .hex-address { display: none; }
  .hex-label { top: 60%; }
  .hex-owners { top: 9%; padding: .1rem .35rem; font-size: .6rem; }
  .hex-owners svg { width: .7rem; height: .7rem; }
  .versions { width: 100%; max-height: 86vh; max-height: 86dvh; padding-bottom: env(safe-area-inset-bottom);
    border-radius: var(--hc-radius-floating, 4px) var(--hc-radius-floating, 4px) 0 0; }
  .version-list .version { grid-template-columns: auto minmax(0, 1fr); }
  .version-places { grid-column: 1 / -1; justify-items: stretch; }
  .version-visit { justify-content: center; max-width: none; }
}
@media (prefers-reduced-motion: reduce) {
  .hex-picture, .hex-motif, .versions, .pager-label { transition: none !important; animation: none !important; opacity: 1; }
}
`
