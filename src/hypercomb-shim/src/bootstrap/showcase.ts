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
import type { ShowcaseRecord } from './showcase-record'
import { DEFAULT_HOME, homeOrigin, turnOffHref } from './turn-off-link'
import type { LinkIcon, WelcomeLink } from './welcome'

const SIG = /^[a-f0-9]{64}$/
const HOSTNAME = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{1,5})?$/
const LOOPBACK = /^(?:[a-z0-9-]+\.)*localhost(?::\d{1,5})?$/

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
    const bindings = Array.isArray(site['hosts']) ? site['hosts'] as unknown[] : []
    const hosts = [site['host'], ...bindings.map(row => (row as { host?: unknown } | null)?.host)]
      .map(host => typeof host === 'string' ? host.trim().toLowerCase() : '')
      .filter(host => HOSTNAME.test(host))
    if (!hosts.length) continue
    const named = (Array.isArray(site['publishers']) ? site['publishers'] as unknown[] : [])
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

/** Every publish the ledger names, at the address it answers on each domain. */
export const ledgerPublishes = (sites: readonly LedgerSite[], zones: readonly string[]): Publish[] => {
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
          address: host, href, route: href, source: 'ledger', lineage: site.lineage })
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
    route?: string; ledger: boolean; claims: Map<string, { pubkey: string; label: string; lineage: string; zones: Set<string> }> }
  const groups = new Map<string, Publish[]>()
  for (const publish of publishes) {
    const key = `${publish.kind}:${publish.name}`
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

/** Read the ledger this origin serves, or nothing where it serves none. A host
 *  with an SPA fallback answers 200 with HTML, so the type is checked first. */
export const readLedger = async (): Promise<LedgerSite[]> => {
  try {
    const response = await fetch('/publications.json', { cache: 'no-store' })
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
  | 'people' | 'close', string> = {
  people: svg('<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.6-3.3 2.8-5.2 5.5-5.2s4.9 1.9 5.5 5.2"/><circle cx="16.8" cy="9.5" r="2.6"/><path d="M15.6 14.1c2.6.2 4.4 1.9 4.9 4.9"/>'),
  close: svg('<path d="m6 6 12 12M18 6 6 18"/>'),
  search: svg('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>'),
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
  /** Domains this hive added, shown after the ledger's. */
  readonly sources: readonly string[]
  readonly ledger: Promise<readonly LedgerSite[]>
  readonly readShared: SharedReader
  /** The hive this page was opened from, when it was — where an owner's Off is handed. */
  readonly home?: string
  /** The showcase this domain's owners sign (showcase-record.ts readShowcase),
   *  read after every ledger read. Absent, or null, shows what opens here. */
  readonly readShowcase?: (zone: string, owners: readonly string[]) => Promise<ShowcaseRecord | null>
}

export type Showcase = {
  /** The mark, the name, the sentence and the search. */
  readonly hero: HTMLElement
  /** The one list of everything hosted, beneath it. */
  readonly bands: HTMLElement
  readonly refresh: (ledger: Promise<readonly LedgerSite[]>) => void
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
  const searchBox = el('label', 'search')
  const search = el('input')
  search.type = 'search'
  search.placeholder = 'Search hives, creations and domains'
  search.setAttribute('aria-label', 'Search hives, creations and domains')
  search.autocomplete = 'off'
  search.spellcheck = false
  searchBox.append(iconOf('search'), search)
  hero.append(brand, searchBox)

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
  const drainPictures = (): void => {
    while (readers < 4 && waiting.length) {
      const head = waiting.shift()!
      readers++
      void tilePicture(head, pictureOrigins(routes.get(head) ?? location.origin)).then(url => {
        readers--
        pictures.set(head, url)
        if (url) {
          for (const art of wearers.get(head) ?? []) wearPicture(art, url, 'hex-picture')
        }
        drainPictures()
      })
    }
  }
  const askPicture = (head: string, route?: string): void => {
    if (!route || pictures.has(head) || routes.has(head)) return
    routes.set(head, route)
    waiting.push(head)
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

  // ── a tile's versions: this domain's first, every other version after it,
  //    identical copies counted rather than listed ──
  const backdrop = el('div', 'versions-backdrop')
  backdrop.hidden = true
  const sheet = el('div', 'versions')
  sheet.setAttribute('role', 'dialog')
  sheet.setAttribute('aria-modal', 'true')
  sheet.setAttribute('aria-labelledby', 'versions-title')
  backdrop.append(sheet)
  // In the hero, not the bands: a band re-orders its own children.
  hero.append(backdrop)
  let opener: HTMLElement | null = null
  const stops = (): HTMLElement[] => [...sheet.querySelectorAll<HTMLElement>('a[href], button, input')]
    .filter(stop => !stop.closest('[hidden]'))
  /** The owner's switches stay shown, and the hive they typed stays typed, for
   *  the life of the page — this page keeps nothing of theirs beyond it. */
  let managing = false
  let homeValue = homeOrigin(options.home) ?? DEFAULT_HOME
  const activeHere = (): Element | null => (sheet.getRootNode() as ShadowRoot | Document).activeElement
  // While the sheet is open, Escape and Tab belong to it wherever focus has
  // wandered: the listeners sit on the document, not on the sheet.
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeVersions(); return }
    if (event.key !== 'Tab') return
    const all = stops()
    const first = all[0]
    const last = all[all.length - 1]
    const active = activeHere()
    const inside = !!active && sheet.contains(active)
    if (!inside || (event.shiftKey && active === first) || (!event.shiftKey && active === last)) {
      event.preventDefault()
      ;(event.shiftKey ? last : first)?.focus()
    }
  }
  const onFocus = (event: FocusEvent): void => {
    const target = event.composedPath()[0]
    if (target instanceof Node && !sheet.contains(target)) stops()[0]?.focus()
  }
  const closeVersions = (): void => {
    document.removeEventListener('keydown', onKey, true)
    document.removeEventListener('focusin', onFocus, true)
    backdrop.hidden = true
    sheet.replaceChildren()
    // The tile is kept, so it is still on the page to take focus back.
    if (opener?.isConnected) opener.focus()
    opener = null
  }
  backdrop.addEventListener('click', event => { if (event.target === backdrop) closeVersions() })
  const openVersions = (entry: Aggregate, from: HTMLElement): void => {
    opener = from
    const lead = entry.versions[0]!
    const head = el('header', 'versions-head')
    const titles = el('span', 'versions-titles')
    const heading = el('h3')
    heading.id = 'versions-title'
    heading.textContent = entry.title
    const meta = el('span', 'band-meta')
    const domains = new Set(entry.versions.flatMap(version => version.places.map(place => place.zone))).size
    for (const [icon, words] of [
      ['people', count(entry.owners, 'owner', 'owners')],
      ['hive', count(entry.versions.length, 'version', 'versions')],
      ['globe', count(domains, 'domain', 'domains')],
    ] as const) {
      const row = el('span')
      row.append(iconOf(icon), document.createTextNode(words))
      meta.append(row)
    }
    titles.append(heading, meta)
    const close = el('button', 'versions-close')
    close.type = 'button'
    close.setAttribute('aria-label', 'Close')
    close.append(iconOf('close'))
    close.addEventListener('click', closeVersions)
    head.append(miniOf(lead.head, lead.route), titles)
    // AN OWNER'S SWITCHES, folded away: this page holds no key, so Off only
    // hands the row to the owner's own hive, which asks, signs and comes back.
    const owned = entry.kind === 'hive' && entry.versions.some(version => version.claims.length)
    const manage = el('button', 'versions-manage')
    manage.type = 'button'
    manage.textContent = 'Yours? Manage it'
    manage.setAttribute('aria-pressed', String(managing))
    const panel = el('div', 'versions-manage-panel')
    const field = el('label', 'versions-home')
    const fieldName = el('span')
    fieldName.textContent = 'Your hive'
    const homeInput = el('input')
    homeInput.type = 'url'
    homeInput.value = homeValue
    homeInput.spellcheck = false
    homeInput.autocomplete = 'off'
    homeInput.addEventListener('input', () => { homeValue = homeInput.value })
    field.append(fieldName, homeInput)
    const explain = el('p', 'versions-manage-note')
    explain.textContent = 'Off hands the switch to your hive, which holds your key — it asks before anything changes, and nothing is turned off from this page. Turning off keeps it published; you can turn it back on from Publish.'
    const problem = el('p', 'versions-manage-problem')
    problem.setAttribute('role', 'alert')
    panel.append(field, explain, problem)
    const showManaging = (): void => {
      manage.setAttribute('aria-pressed', String(managing))
      panel.hidden = !managing
      for (const claims of sheet.querySelectorAll<HTMLElement>('.version-claims')) claims.hidden = !managing
    }
    manage.addEventListener('click', () => { managing = !managing; showManaging(); if (managing) homeInput.focus() })
    if (owned) head.append(manage)
    head.append(close)
    const handOff = (version: Version, claim: Claim, scope: 'here' | 'everywhere'): void => {
      const href = turnOffHref(homeInput.value, { title: entry.title, lineage: claim.lineage, publisher: claim.pubkey,
        zone: options.self, scope, head: version.head, back: `${location.origin}/` })
      if (!href) { problem.textContent = 'That is not a hive address — try https://hypercomb.io or http://localhost:4250.'; homeInput.focus(); return }
      location.assign(href)
    }
    const list = el('ol', 'version-list')
    for (const [index, version] of entry.versions.entries()) {
      const onThisDomain = version.places.some(place => place.zone === options.self)
      const row = el('li', index === 0 && onThisDomain ? 'version pinned' : 'version')
      const about = el('span', 'version-words')
      const tag = el('span', 'version-tag')
      tag.textContent = onThisDomain ? 'On this domain' : entry.versions.length > 1 ? 'Another version' : 'Published'
      const who = el('b', 'version-who')
      who.textContent = ownersLabel(version.owners)
      const what = el('span', 'version-what')
      const zones = new Set(version.places.map(place => place.zone)).size
      what.textContent = `${version.head.slice(0, 12)}… · ${count(zones, 'domain', 'domains')}`
        + (version.owners.length > 1 ? ` · ${count(version.owners.length, 'owner', 'owners')}` : '')
      about.append(tag, who, what)
      // Every domain this version opens on, each its own way in — the reader
      // chooses where to go, this domain's place first.
      const places = el('span', 'version-places')
      for (const place of version.places) {
        const visit = el('a', 'version-visit')
        visit.href = place.href
        const words = el('span', 'version-visit-label')
        words.textContent = entry.kind === 'creation' ? `Inspect on ${place.zone}` : place.address
        visit.append(words, iconOf('arrow'))
        places.append(visit)
      }
      row.append(miniOf(version.head, version.route), about, places)
      if (entry.kind === 'hive' && version.claims.length) {
        const claims = el('div', 'version-claims')
        for (const claim of version.claims) {
          const line = el('span', 'version-claim')
          const owner = el('span', 'version-claim-owner')
          owner.textContent = ownersLabel([claim])
          line.append(owner)
          if (claim.zones.includes(options.self)) {
            const here = el('button', 'version-off')
            here.type = 'button'
            here.textContent = `Off on ${options.self}`
            here.addEventListener('click', () => handOff(version, claim, 'here'))
            line.append(here)
          }
          const everywhere = el('button', 'version-off')
          everywhere.type = 'button'
          everywhere.textContent = 'Off everywhere'
          everywhere.addEventListener('click', () => handOff(version, claim, 'everywhere'))
          line.append(everywhere)
          claims.append(line)
        }
        row.append(claims)
      }
      list.append(row)
    }
    sheet.replaceChildren(head, panel, list)
    showManaging()
    if (backdrop.hidden) {
      document.addEventListener('keydown', onKey, true)
      document.addEventListener('focusin', onFocus, true)
    }
    backdrop.hidden = false
    ;(list.querySelector('a') as HTMLElement | null)?.focus()
  }

  // ── tiles and bands: ONE button per name, kept and updated in place — a pool
  //    arriving never swaps a button out from under focus or an open sheet ──
  type TileView = { tile: HTMLButtonElement; art: HTMLElement; name: HTMLElement; address: HTMLElement
    owners: HTMLElement; head: string; entry: Aggregate }
  const tileViews = new Map<string, TileView>()
  /** A name's tile in one row: the same name may show in your domain's row and
   *  in the row of the domain it came from, each its own button. */
  const tileView = (entry: Aggregate, row: string): HTMLButtonElement => {
    const lead = entry.versions[0]!
    const id = `${row}
${entry.key}`
    let view = tileViews.get(id)
    if (!view) {
      const tile = el('button', `hex hex-${entry.kind}`)
      tile.type = 'button'
      tile.setAttribute('aria-haspopup', 'dialog')
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
      tile.addEventListener('click', () => openVersions(made.entry, tile))
      tileViews.set(id, view = made)
    }
    view.entry = entry
    if (view.head !== lead.head) {
      // A new lead version: its own cover and picture, and the old head forgets this box.
      wearers.get(view.head)?.delete(view.art)
      view.art.replaceChildren()
      view.art.classList.remove('has-picture')
      dressCover(view.art, lead.head)
      wear(view.art, lead.head, lead.route)
      view.head = lead.head
    }
    view.tile.title = `${entry.title} · ${lead.places[0]!.address}`
    view.name.textContent = entry.title
    view.address.textContent = lead.places[0]!.address
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
  const arrange = (comb: HTMLElement, tiles: readonly HTMLElement[]): void => {
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
    const size = tiles[0]!.getBoundingClientRect().width
    const gap = Number.parseFloat(getComputedStyle(tiles[0]!.parentElement!).columnGap) || 0
    const fit = Math.max(1, Math.floor((width + gap) / (size + gap)))
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
      openRow = openRow === zone ? '' : zone
      paint()
    })
    const body = el('div', 'dex-body')
    body.id = id
    const comb = el('div', 'comb')
    combs?.observe(comb)
    const empty = el('p', 'hosted-empty')
    body.append(comb, empty)
    section.append(toggle, body)
    const view = { section, toggle, meta, comb, empty }
    rowViews.set(zone, view)
    return view
  }
  const hosted = el('div', 'hosted')
  bandsHost.append(hosted)
  /** Every publish known now — the ledger's, then each domain's pools — one tile per name. */
  const bands = (): Band[] => {
    const zones = bandZones(sites, options.self, options.sources)
    const publishes = ledgerPublishes(sites, zones)
    // Only the pools of domains the page still draws: a refresh can drop one.
    for (const [zone, pools] of shared) {
      if (zones.includes(zone)) publishes.push(...sharedPublishes(zone, pools.offers, pools.creations))
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
    if (asked.has(zone)) return
    asked.add(zone)
    queue.push(zone)
    drainShared()
  }

  /** What this domain's owners signed it shows; undefined until read, null when none. */
  let record: ShowcaseRecord | null | undefined
  const showcased = (entry: Aggregate): boolean => {
    if (!record) return entry.zones.includes(options.self)
    if (entry.zones.some(zone => record!.domains.includes(zone))) return true
    return entry.versions.some(version => version.claims.some(claim =>
      record!.items.some(item => item.pubkey === claim.pubkey && item.lineage === claim.lineage)))
  }

  function paint(): void {
    const terms = searchTerms(search.value)
    const all = bands()
    for (const band of all) askShared(band.zone)
    const unread = !!options.readShowcase && record === undefined
    const everything = unread ? [] : all.flatMap(band => band.tiles).filter(showcased).sort(byTitle)
    // This domain first; then the domains this browser holds, by name.
    const held = [...new Set(options.sources)].filter(zone => zone !== options.self).sort()
    const rows: HTMLElement[] = []
    for (const zone of [options.self, ...held]) {
      const view = rowView(zone)
      const own = zone === options.self
      const offered = own ? everything : (all.find(band => band.zone === zone)?.open ?? []).slice().sort(byTitle)
      const shown = offered.filter(entry => aggregateMatches(entry, terms))
      // While a search runs every row holding a match is open; otherwise one is.
      const open = terms.length ? shown.length > 0 : openRow === zone
      view.section.classList.toggle('open', open)
      view.toggle.setAttribute('aria-expanded', String(open))
      view.section.hidden = terms.length > 0 && shown.length === 0
      view.meta.textContent = own ? count(offered.length, 'in the showcase', 'in the showcase') : count(offered.length, 'offered', 'offered')
      arrange(view.comb, open ? shown.map(entry => {
        const tile = tileView(entry, zone)
        // In another domain's row, a tile already in this domain's showcase says so.
        tile.classList.toggle('in-showcase', !own && showcased(entry))
        return tile
      }) : [])
      view.empty.hidden = !open || shown.length > 0
      view.empty.textContent = terms.length ? 'Nothing here matches your search.'
        : own && (!ledgerRead || unread) ? 'Reading what is showcased here…'
          : own ? 'Nothing is showcased here yet.' : `Nothing is offered on ${zone} yet.`
      rows.push(view.section)
    }
    // Re-insert only when the order changed: moving a row takes focus from it.
    const current = [...hosted.children]
    if (current.length !== rows.length || current.some((node, index) => node !== rows[index])) hosted.replaceChildren(...rows)
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

  search.addEventListener('input', () => paint())
  // WHAT IS PUBLISHED NOW: the page is the ledger as read, nothing kept from
  // a deploy. Only the newest read is believed if two cross on the wire.
  let reads = 0
  const takeLedger = (ledger: Promise<readonly LedgerSite[]>): void => {
    const read = ++reads
    void ledger.then(found => {
      if (read !== reads) return
      sites = found
      ledgerRead = true
      // The owners of this domain are the keys its own root names. Until their
      // record is read the list waits rather than show what it may not.
      const owners = found.find(site => site.hosts[0] === options.self)?.owners ?? []
      void (options.readShowcase?.(options.self, owners) ?? Promise.resolve(null))
        .catch(() => null).then(signed => {
          if (read !== reads) return
          record = signed
          paint()
        })
      // Every version's picture is asked for at once — the tiles and their lists want them all.
      for (const band of bands()) for (const entry of band.tiles) {
        for (const version of entry.versions) askPicture(version.head, version.route)
      }
      paint()
    })
  }
  takeLedger(options.ledger)
  paint()
  /** Read again: what is published now replaces what was, and each domain's
   *  pools are asked again. */
  const refresh = (ledger: Promise<readonly LedgerSite[]>): void => {
    asked.clear()
    takeLedger(ledger)
  }
  return { hero, bands: bandsHost, refresh }
}

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** What a member does with a hive: start it, fill it, share it here. */
export const memberSection = (zone: string, appHref: string): HTMLElement => {
  const section = el('section', 'member')
  const words = el('div', 'member-words')
  const kicker = el('p', 'kicker')
  kicker.textContent = 'Membership'
  const heading = el('h2')
  heading.textContent = 'Share your favourite things'
  const lede = el('p', 'member-lede')
  lede.textContent = `Every tile above is somebody's hive — the pictures, links, notes and places they love, `
    + `arranged their own way. Members of ${zone} publish theirs at an address of their own, right here among the others.`
  const steps = el('ol', 'steps')
  const yourAddress = `yourname.${zone}`
  for (const [icon, title, body] of [
    ['hive', 'Start your hive', 'Open hypercomb.io. Your hive lives in your own browser: no account to make, nothing to install.'],
    ['heart', 'Gather your favourites', 'Put what you love on tiles — pictures, links, notes, music, places — and arrange them your way.'],
    ['share', 'Share it at your address', `As a member, publish a tile and it opens at ${yourAddress} — and takes its place here.`],
  ] as const) {
    const step = el('li', 'step')
    const badge = el('span', 'step-icon')
    badge.append(iconOf(icon))
    const name = el('b')
    name.textContent = title
    const text = el('span')
    text.textContent = body
    step.append(badge, name, text)
    steps.append(step)
  }
  const cta = el('a', 'member-cta')
  cta.href = appHref
  cta.target = '_blank'
  cta.rel = 'noopener'
  cta.append(document.createTextNode('Start your hive'), iconOf('arrow'))
  words.append(kicker, heading, lede, steps, cta)

  // Your own tile, waiting: a hive with your name on it, at your address.
  const art = el('div', 'member-art')
  art.setAttribute('aria-hidden', 'true')
  const ring = el('span', 'member-ring')
  ring.innerHTML = '<svg viewBox="0 0 100 115.47" aria-hidden="true" focusable="false"><polygon points="50,1.5 98.5,29.5 98.5,86 50,114 1.5,86 1.5,29.5" '
    + 'fill="none" stroke="currentColor" stroke-width=".7" stroke-dasharray="2.4 2.4"/></svg>'
  const sample = el('span', 'hex member-hex')
  const sampleArt = el('span', 'hex-art cover')
  dressCover(sampleArt, 'yourname')
  const label = el('span', 'hex-label')
  const name = el('span', 'hex-name')
  name.textContent = 'yourname'
  label.append(name)
  sample.append(sampleArt, label)
  const address = el('span', 'member-address')
  address.textContent = yourAddress
  art.append(ring, sample, address)
  section.append(words, art)
  return section
}

/** The doors to the platform's other features, at the foot of the showcase. */
export const exploreSection = (links: readonly WelcomeLink[]): HTMLElement | null => {
  if (!links.length) return null
  const section = el('section', 'explore')
  const kicker = el('p', 'kicker')
  kicker.textContent = 'Explore'
  const grid = el('div', 'explore-grid')
  links.forEach((link, index) => {
    const tile = el('a', index === 0 ? 'explore-tile lead' : 'explore-tile')
    tile.href = link.href
    // Somewhere else on the web opens in its own tab; this origin is this site still.
    if (tile.origin !== location.origin) { tile.target = '_blank'; tile.rel = 'noopener' }
    const badge = el('span', 'explore-icon')
    badge.append(iconOf(link.icon ?? 'link'))
    const name = el('b')
    name.textContent = link.label
    const note = el('span')
    note.textContent = link.note
    const go = el('span', 'explore-go')
    go.append(iconOf('arrow'))
    tile.append(badge, name, note, go)
    grid.append(tile)
  })
  section.append(kicker, grid)
  return section
}

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

/* the room, first: a front page that hosts a swarm says so above its name */
.hero-swarm { flex: none; display: inline-flex; align-items: center; gap: .45rem; padding: .45rem .8rem; font-size: .85rem;
  border-radius: var(--hc-radius-control, 2px); background: var(--md-primary); color: var(--md-on-primary); font-weight: 600; text-decoration: none;
  box-shadow: 0 6px 18px -8px color-mix(in srgb, var(--md-primary) 70%, transparent); }
.hero-swarm:hover, .hero-swarm:focus-visible { filter: brightness(1.06); }
.hero-swarm svg { width: 1.05rem; height: 1.05rem; }
/* the header: a small brand row, then the search across the full width. The
   brand takes at most 2.5 times the search's height, margins and all (jwize
   2026-10-24) — lean, never cramped. */
.card.showcase-page .panel { margin-top: 1.75rem; }
.hero { margin: 0 0 1.1rem; }
.hero-brand { display: flex; align-items: center; gap: .75rem; min-width: 0; }
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
.search { position: relative; display: flex; align-items: center; margin: 1.1rem 0 0; }
.search svg { position: absolute; z-index: 1; left: .95rem; width: 1.15rem; height: 1.15rem; color: var(--md-primary); pointer-events: none; }
.search input {
  flex: 1; width: 100%; padding: .78rem 1rem .78rem 2.8rem; font: 400 1rem/1.3 var(--md-font-ui, Inter, system-ui, sans-serif);
  color: var(--md-on-surface-strong); border-radius: var(--hc-radius-control, 2px);
  background: var(--md-surface-c-lowest);
  border: 1px solid color-mix(in srgb, var(--md-primary) 32%, var(--md-outline-variant));
}
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
.hex-art.has-picture::before, .hex-art.has-picture > .hex-motif { display: none; }
@keyframes sc-in { to { opacity: 1; } }

.bands { position: relative; }
.hosted { position: relative; margin: 0 0 clamp(2rem, 5vh, 3rem); }
.band-meta { display: flex; flex-wrap: wrap; gap: .3rem 1.1rem;
  font: 500 .66rem/1.2 ui-monospace, "SF Mono", Menlo, Consolas, monospace; letter-spacing: .14em; text-transform: uppercase; color: var(--md-on-surface-faint); }
.hosted-empty[hidden], .dex-row[hidden] { display: none; }
/* the hyperdex: one row per domain, this one first and open */
.hosted { display: grid; gap: .5rem; margin: 0 0 clamp(2rem, 5vh, 3rem); }
.dex-row { margin: 0; border: 1px solid var(--md-outline-variant); border-radius: var(--hc-radius-card, 3px);
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
.dex-body { padding: .2rem .9rem 1rem; }
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
.comb { --s: 10.4rem; --g: .6rem; display: grid; justify-content: start; min-width: 0; }
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
/* only a real tile answers the pointer; the sample tile in the membership panel is a picture */
button.hex { cursor: pointer; }
button.hex:hover, button.hex:hover:not(:disabled) { background: linear-gradient(160deg, var(--gold-1), var(--gold-2) 50%, var(--gold-3)); }
button.hex:hover .hex-picture, button.hex:hover .hex-motif { transform: scale(1.07); }
button.hex:hover > .hex-art::after { opacity: .8; }
button.hex:focus-visible { outline: none; background: var(--md-primary); }
button.hex:focus-visible > .hex-art { inset: 4px; }
.hex-owners[hidden] { display: none; }

/* a tile's versions: this domain's pinned first, identical copies counted */
.versions-backdrop { position: fixed; inset: 0; z-index: 20; display: grid; place-items: center; padding: 1rem;
  background: rgb(20 12 4 / .45); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); }
.versions-backdrop[hidden] { display: none; }
.versions { box-sizing: border-box; width: min(36rem, 100%); max-height: min(82vh, 46rem); overflow: auto;
  border: 1px solid color-mix(in srgb, var(--md-primary) 30%, var(--md-outline-variant)); border-radius: var(--hc-radius-floating, 4px);
  background: var(--md-surface-c-lowest); color: var(--md-on-surface); box-shadow: 0 2rem 4rem -1.5rem rgb(40 20 0 / .6);
  text-align: left; animation: sc-rise .22s cubic-bezier(.2, 0, 0, 1); }
@keyframes sc-rise { from { opacity: 0; transform: translateY(.6rem); } }
.versions-head { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: .9rem; padding: .95rem 1rem .95rem 1.1rem;
  border-bottom: 1px solid var(--md-outline-variant);
  background: linear-gradient(90deg, color-mix(in srgb, var(--md-primary) 10%, var(--md-surface-c-lowest)), var(--md-surface-c-lowest) 70%); }
.versions-head .mini { width: 2.8rem; height: calc(2.8rem * 1.1547); flex: none; }
.versions-titles { display: grid; gap: .3rem; min-width: 0; }
.versions-head h3 { margin: 0; overflow-wrap: anywhere; color: var(--md-on-surface-strong);
  font: 500 1.55rem/1.1 'Source Serif 4', Georgia, serif; letter-spacing: -.03em; }
.versions-head .band-meta span { display: inline-flex; align-items: center; gap: .4rem; }
.versions-head .band-meta svg { width: .9rem; height: .9rem; color: var(--md-primary); }
.versions-close { flex: none; display: grid; place-items: center; width: 2.3rem; height: 2.3rem; margin-left: auto; padding: 0;
  border: 1px solid var(--md-outline-variant); border-radius: var(--hc-radius-control, 2px); background: transparent; color: var(--md-on-surface-var); }
.versions-close svg { width: 1.1rem; height: 1.1rem; }
.versions-close:hover:not(:disabled) { background: var(--md-surface-c-high); color: var(--md-on-surface-strong); }
.version-list { list-style: none; margin: 0; padding: .4rem .5rem .6rem; }
.version-list .version { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: .2rem .9rem;
  padding: .8rem .65rem; border-top: 1px solid var(--md-outline-variant); }
.version-list .version:first-child { border-top: 0; }
.version-list .version.pinned { border-radius: var(--hc-radius-card, 3px); background: color-mix(in srgb, var(--md-primary) 9%, transparent); }
.version .mini { width: 2.4rem; height: calc(2.4rem * 1.1547); margin: 0; }
.version-words { display: grid; gap: .12rem; min-width: 0; }
.version-tag { font: 600 .62rem/1.2 ui-monospace, "SF Mono", Menlo, Consolas, monospace; letter-spacing: .16em; text-transform: uppercase; color: var(--md-on-surface-faint); }
.version.pinned .version-tag { color: var(--md-primary); }
.version-who { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--md-on-surface-strong); font: 600 .95rem/1.3 var(--md-font-ui, Inter, system-ui, sans-serif); }
.version-what { overflow-wrap: anywhere; color: var(--md-on-surface-var); font: 500 .72rem/1.35 ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
.version-places { display: grid; gap: .35rem; justify-items: end; }
.version-visit { display: inline-flex; align-items: center; gap: .4rem; max-width: 15rem; padding: .5rem .75rem;
  border: 1px solid color-mix(in srgb, var(--md-primary) 42%, transparent); border-radius: var(--hc-radius-control, 2px);
  color: var(--md-primary); font: 600 .8rem/1.2 var(--md-font-ui, Inter, system-ui, sans-serif); text-decoration: none;
  transition: background .2s, color .2s; }
.version-visit-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.version-visit svg { flex: none; width: .9rem; height: .9rem; }
.version-visit:hover { background: var(--md-primary); color: var(--md-on-primary); }
.version-visit:focus-visible, .versions-close:focus-visible { outline: 2px solid var(--md-primary); outline-offset: 2px; }
/* an owner's switches: folded until "Yours? Manage it" */
.versions-manage { flex: none; margin-left: auto; padding: .45rem .7rem; border: 1px solid var(--md-outline-variant);
  border-radius: var(--hc-radius-control, 2px); background: transparent; color: var(--md-on-surface-var);
  font: 600 .76rem/1.2 var(--md-font-ui, Inter, system-ui, sans-serif); }
.versions-manage[aria-pressed='true'] { border-color: var(--md-primary); color: var(--md-primary);
  background: color-mix(in srgb, var(--md-primary) 9%, transparent); }
.versions-manage + .versions-close { margin-left: 0; }
.versions-manage-panel { display: grid; gap: .45rem; padding: .85rem 1.1rem; border-bottom: 1px solid var(--md-outline-variant);
  background: color-mix(in srgb, var(--md-primary) 5%, var(--md-surface-c-lowest)); }
.versions-manage-panel[hidden], .version-claims[hidden] { display: none; }
.versions-home { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: .7rem; }
.versions-home span { font: 600 .62rem/1.2 ui-monospace, "SF Mono", Menlo, Consolas, monospace; letter-spacing: .16em; text-transform: uppercase; color: var(--md-on-surface-faint); }
.versions-home input { min-width: 0; padding: .5rem .65rem; border-radius: var(--hc-radius-control, 2px); font: 500 .85rem/1.3 ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
.versions-manage-note { margin: 0; color: var(--md-on-surface-var); font-size: .78rem; line-height: 1.45; }
.versions-manage-problem { margin: 0; color: var(--hc-status-alert, #b3261e); font-size: .8rem; }
.versions-manage-problem:empty { display: none; }
.version-claims { grid-column: 1 / -1; display: grid; gap: .35rem; padding-top: .35rem; }
.version-claim { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem .5rem; }
.version-claim-owner { margin-right: auto; color: var(--md-on-surface-var); font: 600 .78rem/1.2 var(--md-font-ui, Inter, system-ui, sans-serif); }
.version-off { padding: .4rem .65rem; border: 1px solid color-mix(in srgb, var(--hc-status-alert, #b3261e) 45%, var(--md-outline-variant));
  border-radius: var(--hc-radius-control, 2px); background: transparent; color: var(--md-on-surface-strong);
  font: 600 .76rem/1.2 var(--md-font-ui, Inter, system-ui, sans-serif); }
.version-off:hover:not(:disabled) { background: color-mix(in srgb, var(--hc-status-alert, #b3261e) 10%, transparent); }
.version-off:focus-visible, .versions-manage:focus-visible { outline: 2px solid var(--md-primary); outline-offset: 2px; }

/* membership: what a member does, on the colours of the mark */
.member { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: clamp(1.5rem, 4vw, 3.5rem);
  margin: clamp(3rem, 8vh, 5.5rem) 0 0; padding: clamp(1.5rem, 4vw, 3rem); overflow: hidden; isolation: isolate;
  border-radius: var(--hc-radius-card, 3px); color: #fdf3dd;
  background: radial-gradient(42rem 24rem at 102% -5%, rgb(248 183 58 / .5), transparent 65%),
    radial-gradient(30rem 20rem at -5% 105%, rgb(224 96 126 / .25), transparent 70%),
    linear-gradient(135deg, #2c1907, #120a03 72%);
  box-shadow: 0 2rem 4rem -2.5rem rgb(60 30 0 / .75); }
.member::before { content: ''; position: absolute; inset: 0; z-index: -1; background: var(--gold-1); opacity: .09;
  -webkit-mask: ${LATTICE} 0 0 / 52px 90px repeat; mask: ${LATTICE} 0 0 / 52px 90px repeat; }
.kicker { margin: 0 0 .7rem; font: 500 .68rem/1.2 ui-monospace, "SF Mono", Menlo, Consolas, monospace; letter-spacing: .26em; text-transform: uppercase; color: var(--md-on-surface-faint); }
.member .kicker { color: var(--gold-2); }
.member h2 { margin: 0; color: #fff4d8; font: 500 clamp(2rem, 4.2vw, 3rem)/1.05 'Source Serif 4', Georgia, serif; letter-spacing: -.04em; }
.member-lede { max-width: 42rem; margin: .9rem 0 0; color: rgb(253 243 221 / .8); font-size: 1.02rem; line-height: 1.6; }
.steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .9rem; margin: 1.7rem 0 1.8rem; padding: 0; list-style: none; }
.step { display: grid; align-content: start; align-items: start; gap: .45rem; padding: 1rem 1.05rem 1.1rem;
  border: 1px solid rgb(255 224 138 / .2); border-radius: var(--hc-radius-card, 3px); background: rgb(255 240 210 / .05); }
.step-icon { display: grid; place-items: center; width: 2.5rem; height: calc(2.5rem * 1.1547); margin-bottom: .2rem; clip-path: var(--hex);
  background: linear-gradient(160deg, var(--gold-1), var(--gold-3)); color: #2c1907; }
.step-icon svg { width: 1.2rem; height: 1.2rem; }
.step b { color: #fff4d8; font: 650 1rem/1.3 var(--md-font-ui, Inter, system-ui, sans-serif); }
.step > span:not(.step-icon) { color: rgb(253 243 221 / .72); font-size: .88rem; line-height: 1.5; overflow-wrap: anywhere; }
.member-cta { display: inline-flex; align-items: center; gap: .55rem; padding: .9rem 1.25rem; border-radius: var(--hc-radius-control, 2px);
  background: linear-gradient(180deg, #ffd66d, #f0a224); color: #2c1907; font: 700 .98rem/1 var(--md-font-ui, Inter, system-ui, sans-serif);
  text-decoration: none; box-shadow: 0 .7rem 1.6rem -.7rem rgb(248 183 58 / .9); transition: filter .2s, transform .2s; }
.member-cta svg { width: 1.05rem; height: 1.05rem; }
.member-cta:hover { filter: brightness(1.07); transform: translateY(-1px); }
.member-cta:focus-visible { outline: 2px solid var(--gold-1); outline-offset: 3px; }
.member-art { position: relative; display: grid; justify-items: center; gap: 1rem; padding: 1.2rem; }
.member-ring { position: absolute; top: .1rem; left: 50%; width: 12.8rem; transform: translateX(-50%); color: var(--gold-1); opacity: .6; }
.member-ring svg { display: block; width: 100%; height: auto; }
.member-hex { --s: 10.4rem; margin: 1.3rem 0 0; }
.member-address { padding: .4rem .7rem; border: 1px solid rgb(255 224 138 / .35); border-radius: var(--hc-radius-control, 2px);
  color: var(--gold-1); font: 500 .78rem/1.2 ui-monospace, "SF Mono", Menlo, Consolas, monospace; letter-spacing: .04em; background: rgb(0 0 0 / .25); }

/* the doors to everything else, at the foot */
.explore { margin: clamp(2.5rem, 6vh, 4rem) 0 0; }
.explore-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 15.5rem), 1fr)); gap: .8rem; }
.explore-tile { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; grid-template-rows: auto auto; column-gap: .9rem; row-gap: .15rem; align-items: center;
  padding: .95rem 1rem; border: 1px solid var(--md-outline-variant); border-radius: var(--hc-radius-card, 3px);
  background: color-mix(in srgb, var(--md-surface-c-lowest) 72%, transparent); text-decoration: none;
  transition: transform .2s, border-color .2s, box-shadow .2s; }
.explore-tile:hover { transform: translateY(-2px); border-color: color-mix(in srgb, var(--md-primary) 60%, var(--md-outline-variant));
  box-shadow: 0 1rem 2rem -1.4rem color-mix(in srgb, #7a4a06 70%, transparent); }
.explore-tile:focus-visible { outline: 2px solid var(--md-primary); outline-offset: 2px; }
.explore-icon { grid-row: span 2; display: grid; place-items: center; width: 2.5rem; height: calc(2.5rem * 1.1547); clip-path: var(--hex);
  background: linear-gradient(160deg, var(--gold-1), var(--gold-3)); color: #2c1907; }
.explore-icon svg { width: 1.15rem; height: 1.15rem; }
.explore-tile b { color: var(--md-on-surface-strong); font: 600 .98rem/1.25 var(--md-font-ui, Inter, system-ui, sans-serif); }
.explore-tile > span:not(.explore-icon):not(.explore-go) { color: var(--md-on-surface-var); font-size: .8rem; line-height: 1.4; }
.explore-go { grid-row: 1 / span 2; grid-column: 3; color: var(--md-on-surface-faint); }
.explore-go svg { width: 1rem; height: 1rem; }
.explore-tile.lead { border-color: color-mix(in srgb, var(--md-primary) 55%, var(--md-outline-variant));
  background: linear-gradient(120deg, color-mix(in srgb, var(--md-primary) 14%, var(--md-surface-c-lowest)), var(--md-surface-c-lowest)); }

/* Too narrow for the name beside the comb: the comb goes above it. */
@media (max-width: 1024px) {
  .member { grid-template-columns: minmax(0, 1fr); }
  .member-art { display: none; }
}
/* A PHONE: one column of the same list. */
@media (max-width: 720px) {
  .card.showcase-page .panel { margin-top: 1rem; padding-bottom: 5.5rem; }
  /* the phone is a dead-simple hyperdex (jwize 2026-10-25): the rows, and the
     search fixed at the bottom where a thumb is — nothing else. The desktop
     keeps the setup beneath, because it is the dashboard and the hosting. */
  .search { position: fixed; z-index: 20; left: 0; right: 0; bottom: 0; margin: 0;
    padding: .6rem 16px calc(.6rem + env(safe-area-inset-bottom));
    background: color-mix(in srgb, var(--md-surface) 92%, transparent); border-top: 1px solid var(--md-outline-variant);
    -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); }
  .search svg { left: calc(16px + .95rem); }
  .showcase-page .member, .showcase-page .explore, .showcase-page details.manage, .showcase-page footer { display: none; }
  .dex-body { padding: .1rem .5rem .8rem; }
  .hero-brand { gap: .6rem; }
  .hero-mark { width: 1.7rem; height: 1.7rem; }
  .hero h1 { font-size: 1.2rem; }
  /* the sentence goes on a phone: the name, the count and the search are the header */
  .hero-tagline { display: none; }
  .search { margin-top: .8rem; }
  .mini { width: 1.8rem; height: calc(1.8rem * 1.1547); margin-left: -.55rem; }
  .comb { --s: 6.1rem; --g: .36rem; }
  .hex-name { font-size: .74rem; }
  .hex-address { display: none; }
  .hex-label { top: 60%; }
  .hex-owners { top: 9%; padding: .1rem .35rem; font-size: .6rem; }
  .hex-owners svg { width: .7rem; height: .7rem; }
  /* the versions open as a sheet from the bottom edge */
  .versions-backdrop { place-items: end stretch; padding: 0; }
  .versions { width: 100%; max-height: 86vh; max-height: 86dvh; padding-bottom: env(safe-area-inset-bottom);
    border-radius: var(--hc-radius-floating, 4px) var(--hc-radius-floating, 4px) 0 0; }
  .version-list .version { grid-template-columns: auto minmax(0, 1fr); }
  .version-places { grid-column: 1 / -1; justify-items: stretch; }
  .version-visit { justify-content: center; max-width: none; }
  .member { padding: 1.4rem 1.15rem 1.6rem; }
  .steps { grid-template-columns: minmax(0, 1fr); }
  .member-cta { width: 100%; justify-content: center; box-sizing: border-box; }
}
@media (prefers-reduced-motion: reduce) {
  .hex-picture, .hex-motif, .explore-tile, .member-cta, .versions { transition: none !important; animation: none !important; opacity: 1; }
}
`
