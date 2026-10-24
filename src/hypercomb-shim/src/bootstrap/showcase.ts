// hypercomb-shim/src/bootstrap/showcase.ts
//
// A DOMAIN'S ROOT IS A SHOWCASE OF ITS HIVES (jwize 2026-10-24): "the idea
// behind the root domain is like your tiles with the beautiful images showing
// and they lead to the subdomains." It is "strictly for showcasing": search
// at the top, then one horizontal band per domain holding its hives and its
// shared creations, and the doors to the platform's other features at the
// bottom, beside what a member does to share their own favourite things. On a
// phone the bands are a rolodex: a domain opens like an accordion.
//
// A colony is a domain and its hives are its subdomains. Which hives are open
// on which domain is the ledger this origin already serves — /publications.json,
// verified heads only — and a domain's shared creations are its public offering
// pools, so nothing here names a domain. Each tile wears the picture its own
// tile wears (tile-picture.ts); a hive that wears none gets a cover drawn from
// its own signature, never text.

import type { HostCreation, HostOffering } from '@hypercomb/core'
import { pictureOrigins, tilePicture } from './tile-picture'
import type { LinkIcon, WelcomeLink } from './welcome'

const SIG = /^[a-f0-9]{64}$/
const HOSTNAME = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{1,5})?$/
const LOOPBACK = /^(?:[a-z0-9-]+\.)*localhost(?::\d{1,5})?$/

/** One published site in the ledger, as far as a showcase needs it. */
export type LedgerSite = {
  readonly title: string
  readonly lineage: string
  /** Every address the site answers at: its own host, then its bindings. */
  readonly hosts: readonly string[]
  readonly pubkey: string
  /** The verified head; '' for a domain whose root has published nothing. */
  readonly head: string
}

export type ShowcaseTile = {
  readonly kind: 'hive' | 'creation'
  /** One tile per key in a band: a publisher's lineage, or a creation's name. */
  readonly key: string
  readonly title: string
  /** Where it lives, said under its name. */
  readonly address: string
  readonly href: string
  /** The signature its picture is read from, and the seed of its cover. */
  readonly head: string
  /** The door its picture is asked from; a creation wears its cover. */
  readonly route?: string
}

export type ShowcaseBand = { readonly zone: string; readonly tiles: readonly ShowcaseTile[] }

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : ''

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
    const publishers = (Array.isArray(site['publishers']) ? site['publishers'] as unknown[] : [])
      .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
      .filter(row => typeof row['head'] === 'string' && SIG.test(row['head']))
    const publisher = publishers.find(row => row['primary'] === true) ?? publishers[0]
    const lineage = text(site['lineage'], 200)
    const pubkey = publisher?.['pubkey']
    out.push({
      title: text(site['title'], 60) || lineage || hosts[0]!,
      lineage,
      hosts: [...new Set(hosts)],
      pubkey: typeof pubkey === 'string' && SIG.test(pubkey) ? pubkey : '',
      head: typeof publisher?.['head'] === 'string' ? publisher['head'] : '',
    })
  }
  return out
}

const byTitle = (a: ShowcaseTile, b: ShowcaseTile): number =>
  (a.kind === b.kind ? 0 : a.kind === 'hive' ? -1 : 1) || a.title.localeCompare(b.title)

/** One band per root domain, this door's own first: every published hive open
 *  on that domain, at the address it answers there. A hive two domains both
 *  open is shown under each — each domain is its own place. */
export const ledgerBands = (sites: readonly LedgerSite[], self: string): ShowcaseBand[] => {
  const zones = rootZones([self, ...sites.flatMap(site => site.hosts)])
  const bands = zones.map(zone => {
    const tiles = new Map<string, ShowcaseTile>()
    for (const site of sites) {
      if (!site.head) continue
      const host = site.hosts.find(row => row !== zone && matchesDomain(row, zone))
        ?? site.hosts.find(row => row === zone)
      const key = `${site.pubkey}:${site.lineage}`
      if (!host || tiles.has(key)) continue
      const origin = `${doorOrigin(host)}/`
      tiles.set(key, { kind: 'hive', key, title: site.title, address: host, href: origin, head: site.head, route: origin })
    }
    return { zone, tiles: [...tiles.values()].sort(byTitle) }
  })
  return orderBands(bands, self)
}

/** This door's own band first, the rest by name. */
export const orderBands = (bands: readonly ShowcaseBand[], self: string): ShowcaseBand[] =>
  [...bands].sort((a, b) => (a.zone === self ? -1 : b.zone === self ? 1 : a.zone.localeCompare(b.zone)))

/** A band with what its domain's public pools offer: hives the ledger did not
 *  already name, then its shared creations. */
export const withShared = (band: ShowcaseBand, offers: readonly HostOffering[],
  creations: readonly HostCreation[]): ShowcaseBand => {
  const tiles = new Map(band.tiles.map(tile => [tile.key, tile]))
  for (const offer of offers) {
    const key = `${offer.pubkey}:${offer.lineage}`
    if (tiles.has(key) || !SIG.test(offer.head)) continue
    let route: URL
    try { route = new URL('/', offer.route) } catch { continue }
    tiles.set(key, { kind: 'hive', key, title: offer.title, address: route.host, href: route.href,
      head: offer.head, route: route.href })
  }
  // A creation is not a place: its tile opens the signed creation itself,
  // never the domain's root, which in this door's own band is this page.
  for (const creation of creations) {
    const key = `creation:${creation.pubkey}:${creation.meaning}:${creation.key}`
    if (tiles.has(key) || !SIG.test(creation.head) || !HOSTNAME.test(creation.host)) continue
    tiles.set(key, { kind: 'creation', key, title: creation.title, address: creation.host,
      href: `${doorOrigin(creation.host)}/${creation.head}`, head: creation.head })
  }
  return { zone: band.zone, tiles: [...tiles.values()].sort(byTitle) }
}

export const tileMatches = (tile: ShowcaseTile, zone: string, terms: readonly string[]): boolean =>
  terms.every(term => [tile.title, tile.address, zone].some(value => value.toLowerCase().includes(term)))

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

const ICONS: Record<LinkIcon | 'search' | 'arrow' | 'chevron' | 'hive' | 'sparkle' | 'heart' | 'share' | 'globe' | 'link', string> = {
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

/** The platform's mark, gold, for the centre of the hero's comb. */
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
  /** Domains this hive added, shown after the ledger's. */
  readonly sources: readonly string[]
  readonly ledger: Promise<readonly LedgerSite[]>
  readonly readShared: SharedReader
}

export type Showcase = {
  /** The mark, the name, the sentence and the search. */
  readonly hero: HTMLElement
  /** One band per domain, beneath it. */
  readonly bands: HTMLElement
  readonly refresh: (ledger: Promise<readonly LedgerSite[]>) => void
}

export const showcase = (options: ShowcaseOptions): Showcase => {
  const hero = el('header', 'hero')
  const words = el('div', 'hero-words')
  const title = el('h1')
  title.textContent = options.title
  // As large as its longest word allows: a domain has no space to wrap at, so
  // pluginthematrix.com is drawn smaller rather than broken mid-word.
  title.style.setProperty('--chars', String(Math.max(6, ...options.title.split(/\s+/).map(word => word.length))))
  const tagline = el('p', 'hero-tagline')
  tagline.textContent = options.tagline
  const searchBox = el('label', 'search')
  const search = el('input')
  search.type = 'search'
  search.placeholder = 'Search hives, creations and domains'
  search.setAttribute('aria-label', 'Search hives, creations and domains')
  search.autocomplete = 'off'
  search.spellcheck = false
  searchBox.append(iconOf('search'), search)
  const stats = el('p', 'hero-stats')
  words.append(title, tagline, searchBox, stats)
  const mosaic = el('div', 'mosaic')
  mosaic.setAttribute('aria-hidden', 'true')
  hero.append(words, mosaic)

  const bandsHost = el('div', 'bands')
  const nothing = el('p', 'bands-nothing')
  nothing.textContent = 'Nothing matches your search.'

  // ── what is known ──
  let ledgerBandsNow: ShowcaseBand[] = orderBands([{ zone: options.self, tiles: [] }], options.self)
  let ledgerRead = false
  const shared = new Map<string, { offers: readonly HostOffering[]; creations: readonly HostCreation[] }>()
  const asked = new Set<string>()
  let open: string | null = null
  /** Bands closed by hand during the current search. */
  const collapsed = new Set<string>()
  let lastTerms = ''

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
          placeInMosaic(head, url)
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
  const wear = (art: HTMLElement, tile: ShowcaseTile): void => {
    let set = wearers.get(tile.head)
    if (!set) wearers.set(tile.head, set = new Set())
    set.add(art)
    const url = pictures.get(tile.head)
    if (url) wearPicture(art, url, 'hex-picture')
    else askPicture(tile.head, tile.route)
  }

  // ── the hero's comb: the mark in the middle, hives around it. A slot that
  //    wears a picture keeps it; a picture arriving takes a slot still in cover.
  const slots: { art: HTMLElement; head: string; pictured: boolean }[] = []
  const OFFSETS: readonly (readonly [number, number])[] = [[-0.5, -1], [0.5, -1], [1, 0], [0.5, 1], [-0.5, 1], [-1, 0]]
  const centre = el('span', 'mosaic-cell mosaic-centre')
  centre.innerHTML = GOLD_MARK
  mosaic.append(centre)
  for (const [x, y] of OFFSETS) {
    const cell = el('span', 'mosaic-cell')
    cell.style.setProperty('--x', String(x))
    cell.style.setProperty('--y', String(y))
    const art = el('span', 'hex-art cover')
    cell.append(art)
    mosaic.append(cell)
    slots.push({ art, head: '', pictured: false })
  }
  const fillMosaic = (tiles: readonly ShowcaseTile[]): void => {
    // A hive no longer published leaves the comb with the rest of the page.
    const live = new Set(tiles.map(tile => tile.head))
    for (const slot of slots) {
      if (!slot.head || live.has(slot.head)) continue
      slot.art.replaceChildren()
      slot.art.classList.remove('has-picture')
      Object.assign(slot, { head: '', pictured: false })
    }
    // A hive open on several domains is one hive: it takes one slot.
    const shown = new Set(slots.map(slot => slot.head))
    const fresh = tiles.filter(tile => !shown.has(tile.head) && !!shown.add(tile.head))
    for (const slot of slots) {
      if (slot.head) continue
      const tile = fresh.shift()
      if (!tile) break
      slot.head = tile.head
      dressCover(slot.art, tile.head)
      const url = pictures.get(tile.head)
      if (url) { wearPicture(slot.art, url, 'hex-picture'); slot.pictured = true }
    }
  }
  function placeInMosaic(head: string, url: string): void {
    const held = slots.find(slot => slot.head === head)
    const slot = held ?? slots.find(row => !row.pictured)
    if (!slot || slot.pictured) return
    if (!held) {
      slot.art.replaceChildren()
      slot.art.classList.remove('has-picture')
      slot.head = head
      dressCover(slot.art, head)
    }
    wearPicture(slot.art, url, 'hex-picture')
    slot.pictured = true
  }

  // ── tiles and bands, each drawn once and kept, so a picture never flickers ──
  const tileViews = new Map<string, HTMLAnchorElement>()
  const tileView = (zone: string, tile: ShowcaseTile): HTMLAnchorElement => {
    const id = `${zone}|${tile.key}|${tile.head}`
    const found = tileViews.get(id)
    if (found) return found
    const link = el('a', `hex hex-${tile.kind}`)
    link.href = tile.href
    link.title = `${tile.title} · ${tile.address}`
    const art = el('span', 'hex-art cover')
    dressCover(art, tile.head)
    wear(art, tile)
    const label = el('span', 'hex-label')
    if (tile.kind === 'creation') {
      const kind = el('span', 'hex-kind')
      kind.append(iconOf('sparkle'))
      label.append(kind)
    }
    const name = el('span', 'hex-name')
    name.textContent = tile.title
    const address = el('span', 'hex-address')
    address.textContent = tile.address
    label.append(name, address)
    link.append(art, label)
    tileViews.set(id, link)
    return link
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

  type BandView = { section: HTMLElement; badge: HTMLElement; meta: HTMLElement; comb: HTMLElement
    empty: HTMLElement; toggle: HTMLButtonElement; badgeHeads: string | null }
  const bandViews = new Map<string, BandView>()
  const bandView = (zone: string): BandView => {
    const found = bandViews.get(zone)
    if (found) return found
    const own = zone === options.self
    const section = el('section', own ? 'band own' : 'band')
    const id = `band-${bandViews.size}`
    const head = el('header', 'band-head')
    const badge = el('span', 'band-badge')
    const titles = el('span', 'band-titles')
    const name = el('h2')
    name.textContent = zone
    const meta = el('span', 'band-meta')
    titles.append(name, meta)
    head.append(badge, titles)
    const visitFor = (inside: boolean): HTMLAnchorElement => {
      const visit = el('a', inside ? 'band-visit inside' : 'band-visit')
      visit.href = `${doorOrigin(zone)}/`
      visit.append(document.createTextNode(`Visit ${zone}`), iconOf('arrow'))
      return visit
    }
    if (!own) head.append(visitFor(false))
    const chevron = el('span', 'band-chevron')
    chevron.append(iconOf('chevron'))
    head.append(chevron)
    const toggle = el('button', 'band-toggle')
    toggle.type = 'button'
    toggle.setAttribute('aria-controls', id)
    toggle.setAttribute('aria-label', `Show what ${zone} shares`)
    toggle.addEventListener('click', () => {
      // While a search runs every band holding a match is open; a tap closes
      // one of them (and opens it again) without touching the search.
      if (searchTerms(search.value).length) {
        if (!collapsed.delete(zone)) collapsed.add(zone)
        paint()
        return
      }
      open = open === zone ? null : zone
      paint()
      if (open === zone) section.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
    })
    head.append(toggle)
    const body = el('div', 'band-body')
    body.id = id
    if (!own) body.append(visitFor(true))
    const comb = el('div', 'comb')
    combs?.observe(comb)
    const empty = el('p', 'band-empty')
    body.append(comb, empty)
    section.append(head, body)
    // No join of heads is ever null, so the first paint always draws the badge.
    const view = { section, badge, meta, comb, empty, toggle, badgeHeads: null }
    bandViews.set(zone, view)
    return view
  }

  const bands = (): ShowcaseBand[] => {
    const known = new Set(ledgerBandsNow.map(band => band.zone))
    const added = rootZones([...known, ...options.sources]).filter(zone => !known.has(zone))
    return [...ledgerBandsNow, ...added.map(zone => ({ zone, tiles: [] }))].map(band => {
      const pools = shared.get(band.zone)
      return pools ? withShared(band, pools.offers, pools.creations) : band
    })
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

  const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

  function paint(): void {
    const terms = searchTerms(search.value)
    if (terms.join(' ') !== lastTerms) { lastTerms = terms.join(' '); collapsed.clear() }
    const all = bands()
    const sections: HTMLElement[] = []
    const hives = new Set<string>()
    let creations = 0
    let domains = 0
    let matched = 0
    for (const band of all) {
      askShared(band.zone)
      const view = bandView(band.zone)
      const own = band.zone === options.self
      const shown = band.tiles.filter(tile => tileMatches(tile, band.zone, terms))
      const hiveCount = band.tiles.filter(tile => tile.kind === 'hive').length
      const creationCount = band.tiles.length - hiveCount
      for (const tile of band.tiles) if (tile.kind === 'hive') hives.add(tile.key)
      creations += creationCount
      if (band.tiles.length) domains++
      matched += shown.length
      view.meta.replaceChildren()
      if (hiveCount) {
        const row = el('span')
        row.append(iconOf('hive'), document.createTextNode(count(hiveCount, 'hive', 'hives')))
        view.meta.append(row)
      }
      if (creationCount) {
        const row = el('span')
        row.append(iconOf('sparkle'), document.createTextNode(count(creationCount, 'shared creation', 'shared creations')))
        view.meta.append(row)
      }
      if (!band.tiles.length) {
        const row = el('span')
        row.textContent = own && !ledgerRead ? 'Reading…' : 'Nothing shared yet'
        view.meta.append(row)
      }
      // The badge: the first three hives, overlapping like cards in a fan.
      const firsts = band.tiles.slice(0, 3)
      const heads = firsts.map(tile => tile.head).join()
      if (heads !== view.badgeHeads) {
        view.badgeHeads = heads
        view.badge.replaceChildren(...(firsts.length ? firsts : [null]).map(tile => {
          const mini = el('span', 'mini')
          const art = el('span', 'hex-art cover')
          if (tile) { dressCover(art, tile.head); wear(art, tile) }
          else art.append(iconOf('globe'))
          mini.append(art)
          return mini
        }))
        const lead = coverOf(firsts[0]?.head ?? band.zone)
        view.section.style.setProperty('--band-c1', lead.from)
        view.section.style.setProperty('--band-c2', lead.to)
      }
      arrange(view.comb, shown.map(tile => tileView(band.zone, tile)))
      view.empty.hidden = shown.length > 0
      view.empty.textContent = terms.length ? 'Nothing here matches your search.'
        : own && !ledgerRead ? 'Reading what lives here…' : `Nothing is shared on ${band.zone} yet.`
      view.section.hidden = terms.length ? shown.length === 0 : !own && band.tiles.length === 0
      const isOpen = terms.length ? shown.length > 0 && !collapsed.has(band.zone) : open === band.zone
      view.section.classList.toggle('open', isOpen)
      view.toggle.setAttribute('aria-expanded', String(isOpen))
      sections.push(view.section)
    }
    nothing.hidden = !terms.length || matched > 0
    // Re-insert only when the order changed: moving a section takes focus from
    // whatever inside it holds focus — the toggle a keyboard just pressed.
    const order = [...sections, nothing]
    const current = [...bandsHost.children]
    if (current.length !== order.length || current.some((node, index) => node !== order[index])) {
      bandsHost.replaceChildren(...order)
    }
    stats.replaceChildren()
    if (hives.size) {
      const row = el('span')
      row.append(iconOf('hive'), document.createTextNode(count(hives.size, 'hive', 'hives')))
      stats.append(row)
    }
    if (domains) {
      const row = el('span')
      row.append(iconOf('globe'), document.createTextNode(count(domains, 'domain', 'domains')))
      stats.append(row)
    }
    if (creations) {
      const row = el('span')
      row.append(iconOf('sparkle'), document.createTextNode(count(creations, 'shared creation', 'shared creations')))
      stats.append(row)
    }
    fillMosaic(all.flatMap(band => band.tiles.filter(tile => tile.kind === 'hive')))
  }

  search.addEventListener('input', () => paint())
  // WHAT IS PUBLISHED NOW: the page is the ledger as read, nothing kept from
  // a deploy. Only the newest read is believed if two cross on the wire.
  let reads = 0
  const takeLedger = (ledger: Promise<readonly LedgerSite[]>): void => {
    const read = ++reads
    void ledger.then(sites => {
      if (read !== reads) return
      ledgerBandsNow = ledgerBands(sites, options.self)
      ledgerRead = true
      // Every hive's picture is asked for at once — the comb at the top wants
      // the ones that wear one, and the bands want them all.
      for (const band of ledgerBandsNow) for (const tile of band.tiles) askPicture(tile.head, tile.route)
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
  content: ''; position: absolute; inset: 0 0 auto; height: 46rem; pointer-events: none;
  background: var(--md-primary); opacity: .09;
  -webkit-mask: ${LATTICE} 0 0 / 52px 90px repeat, linear-gradient(#000, transparent 85%);
  -webkit-mask-composite: source-in;
  mask: ${LATTICE} 0 0 / 52px 90px repeat, linear-gradient(#000, transparent 85%);
  mask-composite: intersect;
}
.showcase-page .panel { position: relative; }

/* the hero: the name, the sentence, the search — and a comb of real hives */
.hero { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: clamp(1.5rem, 5vw, 4rem); margin: 0 0 clamp(2.5rem, 7vh, 4.5rem); }
.hero-words { container-type: inline-size; width: 100%; min-width: 0; }
.hero h1 {
  --title-size: clamp(3.1rem, 8.5vw, 6.4rem);
  margin: 0; padding-bottom: .06em; overflow-wrap: anywhere;
  font: 500 var(--title-size)/.95 'Source Serif 4', Georgia, serif; letter-spacing: -.055em;
  font-size: min(var(--title-size), calc(100cqi / (var(--chars, 9) * .5)));
  background: linear-gradient(105deg, var(--md-on-surface-strong) 38%, #b0600c 78%, var(--gold-2));
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.hero-tagline { max-width: 40rem; margin: 1rem 0 0; color: var(--md-on-surface-var); font-size: clamp(1rem, 1.6vw, 1.18rem); line-height: 1.55; }
.search { position: relative; display: flex; align-items: center; max-width: 40rem; margin: 1.9rem 0 0; }
.search svg { position: absolute; z-index: 1; left: 1.05rem; width: 1.3rem; height: 1.3rem; color: var(--md-primary); pointer-events: none; }
.search input {
  flex: 1; width: 100%; padding: 1.05rem 1.15rem 1.05rem 3.2rem; font: 400 1.06rem/1.3 var(--md-font-ui, Inter, system-ui, sans-serif);
  color: var(--md-on-surface-strong); border-radius: var(--hc-radius-control, 2px);
  background: color-mix(in srgb, var(--md-surface-c-lowest) 86%, transparent);
  border: 1px solid color-mix(in srgb, var(--md-primary) 32%, var(--md-outline-variant));
  box-shadow: 0 .9rem 2.4rem -1.3rem color-mix(in srgb, #7a4a06 70%, transparent), inset 0 1px 0 color-mix(in srgb, #fff 55%, transparent);
  -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
}
.search input::placeholder { color: var(--md-on-surface-faint); }
.search input:focus { outline: 2px solid var(--md-primary); outline-offset: 2px; }
.hero-stats { display: flex; flex-wrap: wrap; gap: .5rem 1.4rem; min-height: 1rem; margin: 1.1rem 0 0;
  font: 500 .7rem/1 ui-monospace, "SF Mono", Menlo, Consolas, monospace; letter-spacing: .16em; text-transform: uppercase; color: var(--md-on-surface-faint); }
.hero-stats span, .band-meta span { display: inline-flex; align-items: center; gap: .45rem; }
.hero-stats svg, .band-meta svg { width: .95rem; height: .95rem; color: var(--md-primary); }

.mosaic { --w: 8.6rem; --h: calc(var(--w) * 1.1547); --g: .4rem; position: relative; flex: none;
  width: calc(var(--w) * 3 + var(--g) * 2); height: calc(var(--h) * 2.5 + var(--g) * 2); }
.mosaic-cell { --x: 0; --y: 0; position: absolute; width: var(--w); height: var(--h); clip-path: var(--hex);
  left: calc(50% + var(--x) * (var(--w) + var(--g)) - var(--w) / 2);
  top: calc(50% + var(--y) * (var(--h) * .75 + var(--g) * .866) - var(--h) / 2);
  background: linear-gradient(160deg, color-mix(in srgb, var(--gold-1) 85%, transparent), color-mix(in srgb, var(--gold-3) 70%, transparent)); }
.mosaic-cell > .hex-art { inset: 2px; }
.mosaic-cell > .hex-art::after { display: none; }
.mosaic-centre { display: grid; place-items: center; background: radial-gradient(circle at 50% 35%, #3d260b, #140b03 75%); }
.mosaic-centre svg { width: 46%; height: auto; filter: drop-shadow(0 .4rem .9rem rgb(248 183 58 / .35)); }

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
.bands-nothing { margin: 1rem 0; color: var(--md-on-surface-var); }
.band { position: relative; margin: 0 0 clamp(2.6rem, 6vh, 3.8rem); }
.band[hidden], .bands-nothing[hidden], .band-empty[hidden] { display: none; }
.band-head { position: relative; display: flex; align-items: center; gap: 1.1rem; padding: .85rem 1.1rem .85rem .9rem;
  border-top: 1px solid color-mix(in srgb, var(--md-primary) 40%, transparent);
  border-bottom: 1px solid var(--md-outline-variant);
  background: linear-gradient(90deg, color-mix(in srgb, var(--md-primary) 12%, transparent), color-mix(in srgb, var(--md-primary) 3%, transparent) 55%, transparent); }
.band-titles { display: grid; gap: .3rem; min-width: 0; }
.band-head h2 { margin: 0; overflow-wrap: anywhere; color: var(--md-on-surface-strong);
  font: 500 clamp(1.45rem, 2.6vw, 2.05rem)/1.1 'Source Serif 4', Georgia, serif; letter-spacing: -.035em; }
.band-meta { display: flex; flex-wrap: wrap; gap: .3rem 1.1rem;
  font: 500 .66rem/1.2 ui-monospace, "SF Mono", Menlo, Consolas, monospace; letter-spacing: .14em; text-transform: uppercase; color: var(--md-on-surface-faint); }
.band-badge { display: flex; flex: none; padding-left: .2rem; }
.mini { position: relative; width: 2.3rem; height: calc(2.3rem * 1.1547); margin-left: -.7rem; clip-path: var(--hex);
  background: linear-gradient(160deg, var(--gold-1), var(--gold-3)); }
.mini:first-child { margin-left: 0; }
.mini > .hex-art { inset: 1.5px; }
.mini > .hex-art:not(.has-picture) { background-color: var(--md-surface-c-high); }
.band-visit { margin-left: auto; display: inline-flex; flex: none; align-items: center; gap: .45rem; padding: .5rem .8rem;
  border: 1px solid color-mix(in srgb, var(--md-primary) 42%, transparent); border-radius: var(--hc-radius-control, 2px);
  background: color-mix(in srgb, var(--md-surface-c-lowest) 60%, transparent); color: var(--md-primary);
  font: 600 .82rem/1.2 var(--md-font-ui, Inter, system-ui, sans-serif); text-decoration: none; white-space: nowrap; transition: background .2s, color .2s; }
.band-visit svg { width: .95rem; height: .95rem; }
.band-visit:hover { background: var(--md-primary); color: var(--md-on-primary); }
.band-visit:focus-visible { outline: 2px solid var(--md-primary); outline-offset: 2px; }
.band-visit.inside, .band-chevron, .band-toggle { display: none; }
.band-body { padding-top: 1.4rem; }
.band-empty { margin: 0; padding: 1.3rem 1.2rem; border: 1px dashed var(--md-outline-variant); border-radius: var(--hc-radius-card, 3px); color: var(--md-on-surface-var); }

/* the honeycomb: rows of pointy-top hexagons, every other one shifted half a hex */
.comb { --s: 10.4rem; --g: .6rem; display: grid; justify-content: start; min-width: 0; }
.comb-row { display: flex; gap: var(--g); }
.comb-row + .comb-row { margin-top: calc(var(--g) * .866 - var(--s) * .2887); }
.comb-row.shift { padding-left: calc((var(--s) + var(--g)) / 2); }
.hex { position: relative; display: block; flex: none; width: var(--s); height: calc(var(--s) * 1.1547); clip-path: var(--hex);
  background: linear-gradient(160deg, color-mix(in srgb, var(--gold-1) 75%, transparent), color-mix(in srgb, var(--gold-3) 55%, transparent));
  text-decoration: none; transition: background .25s; }
.hex > .hex-art { inset: 2.5px; }
.hex > .hex-art::after { content: ''; position: absolute; inset: 0; z-index: 2; transition: opacity .3s;
  background: linear-gradient(180deg, transparent 36%, rgb(14 8 2 / .55) 70%, rgb(14 8 2 / .82)); }
.hex-label { position: absolute; left: 9%; right: 9%; top: 57%; z-index: 3; display: grid; justify-items: center; gap: .18rem; text-align: center; color: #fff; pointer-events: none; }
.hex-name { max-width: 100%; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere;
  font: 650 .98rem/1.15 var(--md-font-ui, Inter, system-ui, sans-serif); letter-spacing: -.01em; text-shadow: 0 1px 3px rgb(0 0 0 / .6); }
.hex-address { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: .8;
  font: 500 .58rem/1.3 ui-monospace, "SF Mono", Menlo, Consolas, monospace; letter-spacing: .03em; }
.hex-kind svg { width: .95rem; height: .95rem; color: var(--gold-1); }
.hex:hover { background: linear-gradient(160deg, var(--gold-1), var(--gold-2) 50%, var(--gold-3)); }
.hex:hover .hex-picture, .hex:hover .hex-motif { transform: scale(1.07); }
.hex:hover > .hex-art::after { opacity: .8; }
.hex:focus-visible { outline: none; background: var(--md-primary); }
.hex:focus-visible > .hex-art { inset: 4px; }

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
@media (max-width: 960px) {
  .hero { grid-template-columns: minmax(0, 1fr); justify-items: center; text-align: center; gap: 1.4rem; }
  .mosaic { order: -1; --w: 6.2rem; --g: .3rem; }
  .search { width: 100%; }
  .hero-stats { justify-content: center; }
}
@media (max-width: 1024px) {
  .member { grid-template-columns: minmax(0, 1fr); }
  .member-art { display: none; }
}
/* A PHONE: the bands are a rolodex, and a domain opens like an accordion. */
@media (max-width: 720px) {
  .hero { gap: 1.2rem; margin-bottom: 2rem; }
  .mosaic { --w: 4.6rem; --g: .25rem; }
  .hero h1 { --title-size: clamp(2.7rem, 13vw, 3.6rem); }
  .hero-tagline { font-size: .98rem; }
  .search { margin-top: 1.3rem; }
  .band { margin: 0 0 .55rem; border: 1px solid var(--md-outline-variant); border-radius: var(--hc-radius-card, 3px); overflow: hidden;
    background: color-mix(in srgb, var(--md-surface-c-low) 94%, transparent);
    box-shadow: inset 0 1px 0 color-mix(in srgb, #fff 45%, transparent), 0 -.35rem .9rem -.7rem rgb(60 35 0 / .35), 0 .5rem 1.2rem -1rem rgb(60 35 0 / .45); }
  .band::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; z-index: 1;
    background: linear-gradient(180deg, var(--band-c1, var(--gold-2)), var(--band-c2, var(--gold-3))); }
  .band.open { border-color: color-mix(in srgb, var(--md-primary) 45%, var(--md-outline-variant));
    box-shadow: 0 1rem 2rem -1.2rem rgb(60 35 0 / .55); }
  .band-head { gap: .8rem; padding: .75rem .9rem .75rem 1.05rem; border: 0; background: none; }
  .band-head h2 { font-size: 1.28rem; }
  .band-head .band-visit:not(.inside) { display: none; }
  .band-chevron { display: block; flex: none; margin-left: auto; color: var(--md-on-surface-var); transition: transform .25s; }
  .band-chevron svg { width: 1.2rem; height: 1.2rem; }
  .band.open .band-chevron { transform: rotate(180deg); color: var(--md-primary); }
  .band-toggle { display: block; position: absolute; inset: 0; z-index: 2; width: 100%; padding: 0; border: 0; border-radius: 0; background: transparent; cursor: pointer; }
  .band-toggle:hover:not(:disabled) { background: transparent; }
  .band-toggle:focus-visible { outline: 2px solid var(--md-primary); outline-offset: -2px; }
  .band:not(.open) .band-body { display: none; }
  .band-body { padding: .1rem .55rem .9rem .75rem; }
  .band-visit.inside { display: inline-flex; margin: 0 0 .6rem .25rem; }
  .mini { width: 1.8rem; height: calc(1.8rem * 1.1547); margin-left: -.55rem; }
  .comb { --s: 6.1rem; --g: .36rem; }
  .hex-name { font-size: .74rem; }
  .hex-address { display: none; }
  .hex-label { top: 60%; }
  .member { padding: 1.4rem 1.15rem 1.6rem; }
  .steps { grid-template-columns: minmax(0, 1fr); }
  .member-cta { width: 100%; justify-content: center; box-sizing: border-box; }
}
@media (prefers-reduced-motion: reduce) {
  .hex-picture, .hex-motif, .explore-tile, .member-cta, .band-chevron { transition: none !important; animation: none !important; opacity: 1; }
}
`
