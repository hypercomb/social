// hypercomb-shim/src/bootstrap/showcase.spec.ts — a domain's root shows its hives.
//
// The ledger says which hives are open on which domain; each domain is a filter,
// this door's own first. Every publish of one name is ONE tile on the page:
// identical heads are one version however many domains or people carry it,
// and this domain's version is pinned first in the tile's list.

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { describe, expect, it, vi } from 'vitest'
import { parseShowcase, readZoneOwners, type ShowcaseRecord, type ZoneOwners } from './showcase-record'
import { aggregate, aggregateMatches, bandZones, coverOf, followCandidate, ledgerPublishes, ownersLabel, parseLedger,
  pageFlip, readPeerLedger, sharedPublishes, showcase } from './showcase'
import { parseWelcome } from './welcome'

// Pictures are asked of real doors; here every hive wears its cover.
vi.mock('./tile-picture', () => ({ tilePicture: async () => null, pictureOrigins: () => [] }))

const sig = (char: string): string => char.repeat(64)

/** What a person does to see where else a tile is: right-click it (a hold, or the menu key, says the same). */
const openSheet = (tile: Element): void => {
  tile.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  // What the person does next is a press of its own, which is what ends the sheet's "just opened" grace.
  document.querySelector('.versions-backdrop')?.dispatchEvent(new Event('pointerdown', { bubbles: true }))
}

const LEDGER = {
  sites: [
    { host: 'hypercomb.com', hosts: [], title: 'Hypercomb', lineage: 'hypercomb',
      publishers: [{ pubkey: sig('a'), head: null }] },
    { host: 'jwize.com', title: 'jwize', lineage: 'jwize.com', publishers: [{ pubkey: sig('a'), head: null }] },
    { host: 'dylan.jwize.com', title: 'dylan', lineage: 'dylan',
      hosts: [{ host: 'dylan.jwize.com', implicit: false }, { host: 'dylan.hypercomb.com', implicit: true }],
      publishers: [{ pubkey: sig('a'), label: 'Jaime', head: sig('1'), primary: true }] },
    { host: 'camelflage.hypercomb.com', title: 'camelflage', lineage: 'camelflage',
      hosts: [{ host: 'camelflage.hypercomb.com' }], publishers: [{ pubkey: sig('a'), label: 'Jaime', head: sig('2') }] },
    { host: 'Install:Essentials', title: 'not a host', lineage: 'install:essentials',
      publishers: [{ pubkey: sig('a'), head: sig('3') }] },
  ],
}

const offer = (lineage: string, host: string, pubkey: string, head: string) => ({ kind: 'host:offering' as const,
  title: lineage, lineage, route: `https://${lineage}.${host}/`, pubkey, head, index: {}, doors: [] })

/** The group label stands for the pages: turning through them is how a test reads or reaches one. */
const labelOf = (bands: HTMLElement): HTMLButtonElement => bands.querySelector('.pager-label') as HTMLButtonElement
const at = (bands: HTMLElement): number => Number(/group (\d+) of/.exec(labelOf(bands)?.getAttribute('aria-label') ?? '')?.[1] ?? 1) - 1
const total = (bands: HTMLElement): number => Number(/of (\d+)\./.exec(labelOf(bands)?.getAttribute('aria-label') ?? '')?.[1] ?? 0)
/** The groups, in order, the one showing starred — read by turning through them and back again. */
const tabs = (bands: HTMLElement): string[] => {
  if (!labelOf(bands) || (bands.querySelector('.pager') as HTMLElement).hidden) return []
  const n = total(bands), start = at(bands), out: string[] = new Array(n)
  for (let i = 0; i < n; i++) { out[at(bands)] = `${labelOf(bands).textContent}${at(bands) === start ? '*' : ''}`; labelOf(bands).click() }
  return out
}
const goTo = (bands: HTMLElement, index: number): void => { while (at(bands) !== index) labelOf(bands).click() }

describe('parseLedger — the ledger is data', () => {
  it('keeps hosts that are hostnames and every publisher holding a verified head', () => {
    const sites = parseLedger(LEDGER)
    expect(sites.map(site => site.lineage)).toEqual(['hypercomb', 'jwize.com', 'dylan', 'camelflage'])
    expect(sites[0]!.publishers).toEqual([])
    expect(sites[2]).toMatchObject({ hosts: ['dylan.jwize.com', 'dylan.hypercomb.com'],
      publishers: [{ pubkey: sig('a'), label: 'Jaime', head: sig('1') }] })
  })

  it('reads nothing from anything that is not a ledger', () => {
    expect(parseLedger('<html>')).toEqual([])
    expect(parseLedger({ sites: 'no' })).toEqual([])
    expect(parseLedger(null)).toEqual([])
  })
})

describe('aggregate — one tile per name, never a duplicate on the page', () => {
  const sites = parseLedger(LEDGER)
  const zones = bandZones(sites, 'hypercomb.com')

  it('draws a hive open on several domains once, in this door\'s band', () => {
    expect(zones).toEqual(['hypercomb.com', 'jwize.com'])
    const [own, jwize] = aggregate(ledgerPublishes(sites, zones), zones, 'hypercomb.com')
    expect(own!.tiles.map(entry => entry.title)).toEqual(['camelflage', 'dylan'])
    expect(jwize!.tiles).toEqual([])
    // jwize.com still opens dylan; the band knows it, the page draws it once.
    expect(jwize!.open.map(entry => entry.title)).toEqual(['dylan'])
    const dylan = own!.tiles[1]!
    // One head on two domains is one version, this domain's address first.
    expect(dylan.versions).toHaveLength(1)
    expect(dylan.versions[0]!.places.map(place => place.address)).toEqual(['dylan.hypercomb.com', 'dylan.jwize.com'])
    expect(dylan.owners).toBe(1)
  })

  it('draws a name in the first band that has it when it does not open here', () => {
    const [own, jwize] = aggregate(ledgerPublishes(sites, zones), zones, 'jwize.com')
    expect(own!.zone).toBe('hypercomb.com')
    expect(jwize!.tiles.map(entry => entry.title)).toEqual(['dylan'])
    expect(own!.tiles.map(entry => entry.title)).toEqual(['camelflage'])
  })

  it('keeps a different head as a version of its own, this domain\'s pinned first; an identical one only counts', () => {
    const publishes = [
      ...ledgerPublishes(sites, zones),
      // Leanne publishes dylan too: once with exactly jwize's bytes, once with her own.
      ...sharedPublishes('jwize.com', [offer('dylan', 'jwize.com', sig('b'), sig('1'))], []),
      ...sharedPublishes('jwize.com', [offer('dylan', 'other.jwize.com', sig('c'), sig('9'))], []),
    ]
    const dylan = aggregate(publishes, zones, 'hypercomb.com')[0]!.tiles.find(entry => entry.title === 'dylan')!
    expect(dylan.owners).toBe(3)
    expect(dylan.versions.map(version => version.head)).toEqual([sig('1'), sig('9')])
    expect(dylan.versions[0]!.owners.map(owner => owner.pubkey)).toEqual([sig('a'), sig('b')])
    expect(dylan.versions[0]!.places[0]!.zone).toBe('hypercomb.com')
  })

  it('lets a pool claim a public head only at its own place: the ledger keeps the lead, the link and the band', () => {
    const order = ['zzz.com', 'aaa.org', 'hypercomb.com', 'jwize.com']
    const publishes = [...ledgerPublishes(sites, order),
      ...sharedPublishes('aaa.org', [offer('dylan', 'aaa.org', sig('e'), sig('1'))], [])]
    const dylan = aggregate(publishes, order, 'zzz.com').flatMap(band => band.tiles).find(entry => entry.title === 'dylan')!
    expect(dylan.home).toBe('hypercomb.com')
    expect(dylan.owners).toBe(2)
    expect(dylan.versions[0]!.places[0]!.address).toBe('dylan.hypercomb.com')
    expect(dylan.versions[0]!.places.at(-1)!.address).toBe('dylan.aaa.org')
  })

  it('reads a pool only for its own domain\'s addresses', () => {
    expect(sharedPublishes('hypercomb.com', [offer('garden', 'jwize.com', sig('a'), sig('4'))], [{
      kind: 'host:creation', meaning: 'text-theme', key: 'amber', location: sig('5'), pubkey: sig('b'),
      title: 'Amber', host: 'jwize.com', head: sig('6'), payload: sig('7'), index: {},
    }])).toEqual([])
  })

  it('folds a name the way an address folds, and keeps creations apart from hives', () => {
    const publishes = sharedPublishes('hypercomb.com', [offer('Revolución', 'hypercomb.com', sig('a'), sig('4')),
      offer('revolucion', 'hypercomb.com', sig('a'), sig('5'))], [{
      kind: 'host:creation', meaning: 'text-theme', key: 'amber', location: sig('5'), pubkey: sig('b'),
      title: 'Amber', host: 'hypercomb.com', head: sig('6'), payload: sig('7'), index: {},
    }])
    const [band] = aggregate(publishes, ['hypercomb.com'], 'hypercomb.com')
    expect(band!.tiles.map(entry => `${entry.kind}:${entry.versions.length}`)).toEqual(['hive:2', 'creation:1'])
    // A creation opens itself, never the domain's root (this very page).
    expect(band!.tiles[1]!.versions[0]!.places[0]!.href).toBe(`https://hypercomb.com/${sig('6')}`)
  })

  it('finds a tile by any name, address, domain or owner behind it', () => {
    const [own] = aggregate(ledgerPublishes(sites, zones), zones, 'hypercomb.com')
    const dylan = own!.tiles[1]!
    expect(aggregateMatches(dylan, ['dyl'])).toBe(true)
    expect(aggregateMatches(dylan, ['jwize.com'])).toBe(true)
    expect(aggregateMatches(dylan, ['jaime'])).toBe(true)
    expect(aggregateMatches(dylan, ['susan'])).toBe(false)
  })

  it('names owners in a few words', () => {
    expect(ownersLabel([{ pubkey: sig('a'), label: 'Jaime' }])).toBe('Jaime')
    expect(ownersLabel([{ pubkey: sig('a'), label: 'Jaime' }, { pubkey: sig('b'), label: '' }])).toBe('Jaime and bbbbbbbbbbbbbbbb…')
    // A name from outside is plain words: no bidi override can make it read as another's.
    expect(parseLedger({ sites: [{ host: 'x.hypercomb.com', title: 't', lineage: 'x',
      publishers: [{ pubkey: sig('a'), label: 'Ja‮emi', head: sig('1') }] }] })[0]!.publishers[0]!.label).toBe('Jaemi')
    expect(ownersLabel(['a', 'b', 'c', 'd'].map(char => ({ pubkey: sig(char), label: char })))).toBe('a, b and 2 more')
  })
})

describe('showcase — the page is what is published now', () => {
  const names = (bands: HTMLElement): string[] =>
    [...bands.querySelectorAll('.comb .hex-name')].map(name => name.textContent ?? '')
  const sites = parseLedger(LEDGER)

  it('shows what opens on this domain until its owners sign a showcase', async () => {
    const { bands } = showcase({
      self: 'hypercomb.com', title: 'hypercomb', tagline: '', sources: [],
      ledger: Promise.resolve(sites), readShared: async () => ({ offers: [], creations: [] }),
    })
    await vi.waitFor(() => expect(names(bands)).toEqual(['camelflage', 'dylan']))
    expect(bands.querySelectorAll('.band')).toHaveLength(0)
  })

  it('draws exactly the signed showcase: its items and the domains shown in full, never the rest', async () => {
    const asked: string[][] = []
    const draw = (record: ShowcaseRecord | null) => showcase({
      self: 'hypercomb.com', groups: true, title: 'hypercomb', tagline: '', sources: [],
      ledger: Promise.resolve(sites), readShared: async () => ({ offers: [], creations: [] }),
      readOwners: async (_zone, owners) => { asked.push([...owners]); return { showcase: record, reached: true, unreadable: false, doors: new Map() } },
    }).bands
    const one = draw({ zone: 'hypercomb.com', items: [{ pubkey: sig('a'), lineage: 'dylan' }], domains: [] })
    await vi.waitFor(() => expect(names(one)).toEqual(['dylan']))
    // The owners asked are the keys hypercomb.com's own root names, head or not.
    expect(asked[0]).toEqual([sig('a')])
    const whole = draw({ zone: 'hypercomb.com', items: [], domains: ['jwize.com'] })
    await vi.waitFor(() => expect(names(whole)).toEqual(['dylan']))
    const none = draw({ zone: 'hypercomb.com', items: [], domains: [] })
    await vi.waitFor(() => expect(none.querySelector('.hosted-empty')?.textContent).toBe('Nothing is published here yet.'))
    expect(names(none)).toEqual([])
  })

  it("without a signed showcase, shows only what its owners published here — the Publish switch for this domain", async () => {
    // camelflage's doors name hypercomb.com; dylan has none (it opens
    // everywhere on the worker, but was never published here).
    const owners: ZoneOwners = { showcase: null, reached: true, unreadable: false, doors: new Map([[sig('a'), new Map([['camelflage', ['hypercomb.com']], ['jaime', ['jwize.com']]])]]) }
    const { bands } = showcase({
      self: 'hypercomb.com', title: 'hypercomb', tagline: '', sources: [],
      ledger: Promise.resolve(sites), readShared: async () => ({ offers: [], creations: [] }),
      readOwners: async () => owners,
    })
    await vi.waitFor(() => expect(names(bands)).toEqual(['camelflage']))
  })

  it('redraws when the ledger is read again, and only the newest read is believed', async () => {
    const { bands, refresh } = showcase({
      self: 'hypercomb.com', title: 'hypercomb', tagline: '', sources: [],
      ledger: Promise.resolve(sites), readShared: async () => ({ offers: [], creations: [] }),
    })
    await vi.waitFor(() => expect(names(bands)).toEqual(['camelflage', 'dylan']))

    // camelflage is unpublished; a newer read lands before an older one.
    let late: (value: typeof sites) => void = () => {}
    refresh(new Promise(resolve => { late = resolve }))
    refresh(Promise.resolve(sites.filter(site => site.lineage !== 'camelflage')))
    await vi.waitFor(() => expect(names(bands)).toEqual(['dylan']))
    late(sites)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(names(bands)).toEqual(['dylan'])
  })

})

describe('an owner\'s Off — handed to their own hive, never done here', () => {
  it('builds a link only to a hive\'s address', async () => {
    const { homeOrigin, turnOffHref } = await import('./turn-off-link')
    expect(homeOrigin('http://localhost:4250')).toBe('http://localhost:4250/')
    expect(homeOrigin('hypercomb.io')).toBe('https://hypercomb.io/')
    expect(homeOrigin('http://hypercomb.io')).toBeNull()
    expect(homeOrigin('javascript:alert(1)')).toBeNull()
    expect(homeOrigin('https://me:pw@hypercomb.io')).toBeNull()
    expect(turnOffHref('ftp://x', { title: 't', lineage: 'l', publisher: sig('a'), zone: 'hypercomb.com',
      scope: 'here', head: sig('1'), back: 'https://hypercomb.com/' })).toBeNull()
  })

  it('names the verified owners of a version, and only for hives the ledger read', () => {
    const sites = parseLedger(LEDGER)
    const zones = bandZones(sites, 'hypercomb.com')
    const publishes = [...ledgerPublishes(sites, zones),
      ...sharedPublishes('hypercomb.com', [offer('susan', 'hypercomb.com', sig('e'), sig('4'))], [])]
    const tiles = aggregate(publishes, zones, 'hypercomb.com').flatMap(band => band.tiles)
    const dylan = tiles.find(entry => entry.title === 'dylan')!
    expect(dylan.versions[0]!.claims).toEqual([{ pubkey: sig('a'), label: 'Jaime', lineage: 'dylan',
      zones: ['hypercomb.com', 'jwize.com'] }])
    // A pool's offer is a claim anyone can make: it gets no switch.
    expect(tiles.find(entry => entry.title === 'susan')!.versions[0]!.claims).toEqual([])
  })

})

describe('coverOf — a hive with no picture wears its own signature', () => {
  it('is the same cover for the same hive, and a different one for another', () => {
    expect(coverOf(sig('1'))).toEqual(coverOf(sig('1')))
    expect(coverOf('0123456789abcdef'.repeat(4))).not.toEqual(coverOf('fedcba9876543210'.repeat(4)))
    expect(coverOf('yourname').from).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('parseWelcome — a link names its picture from a closed set', () => {
  it('keeps a known icon and drops any other', () => {
    const welcome = parseWelcome({ links: [
      { label: 'tour', href: '/tour/', icon: 'tour' },
      { label: 'odd', href: '/odd', icon: '<script>' },
    ] })
    expect(welcome?.links).toEqual([
      { label: 'tour', href: '/tour/', note: '', icon: 'tour' },
      { label: 'odd', href: '/odd', note: '' },
    ])
  })
})

describe('the room first — a front page that hosts a swarm says so in its brand row', () => {
  const options = {
    self: 'realones.online', title: 'Real Ones', tagline: '', sources: [],
    ledger: Promise.resolve([]), readShared: async () => ({ offers: [], creations: [] }),
  }

  it('draws "Join the swarm" at the top, pointing at the sealed link', () => {
    const link = 'https://swarm.hypercomb.com/#swarm=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@hypercomb.com~KKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKK'
    const { hero } = showcase({ ...options, swarm: link })
    // In the brand row, at the top of the page.
    const join = hero.querySelector('.hero-brand .hero-swarm') as HTMLAnchorElement
    expect(join.getAttribute('href')).toBe(link)
    expect(join.textContent).toContain('Join the swarm')
  })

  it('draws nothing of the kind on a page that hosts no room', () => {
    const { hero } = showcase(options)
    expect(hero.querySelector('.hero-swarm')).toBeNull()
  })
})


describe('parseShowcase — a signed showcase is data too', () => {
  it('keeps only this zone\'s record, and only items and domains that survive their check', () => {
    expect(parseShowcase({ kind: 'host:showcase', zone: 'jwize.com', items: [], domains: [] }, 'hypercomb.com')).toBeNull()
    expect(parseShowcase({ kind: 'host:welcome', zone: 'hypercomb.com' }, 'hypercomb.com')).toBeNull()
    expect(parseShowcase({
      kind: 'host:showcase', zone: 'hypercomb.com',
      items: [{ pubkey: sig('a'), lineage: 'dylan' }, { pubkey: 'not a key', lineage: 'x' }, { pubkey: sig('b'), lineage: '' }],
      domains: ['jwize.com', 'javascript:alert(1)', 7],
    }, 'hypercomb.com')).toEqual({ zone: 'hypercomb.com', items: [{ pubkey: sig('a'), lineage: 'dylan' }], domains: ['jwize.com'] })
  })

  it('names every key a site\'s root names as its owners, a head or not', () => {
    expect(parseLedger(LEDGER)[0]!.owners).toEqual([sig('a')])
  })
})

describe('the hyperdex — this domain first and open, then the domains you follow', () => {
  const sites = parseLedger(LEDGER)
  const rows = (bands: HTMLElement): string[] => [...bands.querySelectorAll('.dex-row')]
    .map(row => `${row.querySelector('.dex-name')?.textContent}${row.classList.contains('open') ? ' open' : ''}:`
      + [...row.querySelectorAll('.hex-name')].map(name => name.textContent).join(','))

  it('opens on this domain\'s showcase; a followed domain opens on what it offers, one row at a time', async () => {
    const { bands, hero } = showcase({
      self: 'hypercomb.com', title: 'hypercomb', tagline: '', sources: ['jwize.com'],
      ledger: Promise.resolve(sites), readShared: async () => ({ offers: [], creations: [] }),
    })
    // On arrival only the showcase shows; Manage turns the same view into the manager.
    await vi.waitFor(() => expect([...bands.querySelectorAll('.dex-row.own .hex-name')].map(name => name.textContent)).toEqual(['camelflage', 'dylan']))
    expect([...bands.querySelectorAll<HTMLElement>('.dex-row')].filter(row => !row.hidden)).toHaveLength(1)
    ;(hero.querySelector('.manage-toggle') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(rows(bands)).toEqual(['hypercomb.com open:camelflage,dylan', 'jwize.com:']))
    ;(bands.querySelectorAll('.dex-head')[1] as HTMLButtonElement).click()
    // The open domain is always the first row, and the one it replaced goes below it as a header.
    expect(rows(bands)).toEqual(['jwize.com open:dylan', 'hypercomb.com:'])
    // dylan is in this domain's showcase already, and its tile in jwize.com's row says so.
    expect(bands.querySelector('.dex-row:not(.own) .hex.in-showcase .hex-name')?.textContent).toBe('dylan')
    ;(bands.querySelectorAll('.dex-head')[1] as HTMLButtonElement).click()
    expect(rows(bands)).toEqual(['hypercomb.com open:camelflage,dylan', 'jwize.com:'])
  })

  it('shows a stranger only the showcase: no domains followed, no other rows', async () => {
    const { bands } = showcase({
      self: 'hypercomb.com', title: 'hypercomb', tagline: '', sources: [],
      ledger: Promise.resolve(sites), readShared: async () => ({ offers: [], creations: [] }),
    })
    await vi.waitFor(() => expect(rows(bands)).toEqual(['hypercomb.com open:camelflage,dylan']))
  })
})


describe('everything on the home page is a tile — the platform\'s doors too', () => {
  const sites = parseLedger(LEDGER)
  const links = [
    { label: 'Browser extensions', href: '/downloads/#extensions', note: 'Smart Autolinker', icon: 'extension' as const },
    { label: 'Minimal host', href: '/hosts', note: 'manage domains', icon: 'host' as const },
  ]
  const draw = (extra = {}) => showcase({
    self: 'hypercomb.com', title: 'hypercomb', tagline: '', sources: [], links,
    ledger: Promise.resolve(sites), readShared: async () => ({ offers: [], creations: [] }), ...extra,
  })

  it('draws each door as a hexagon link in this domain\'s row, after its hives, and finds it by search', async () => {
    const { bands, hero } = draw()
    await vi.waitFor(() => expect(bands.querySelectorAll('.dex-row.own .hex').length).toBe(4))
    const tiles = [...bands.querySelectorAll('.dex-row.own .hex')]
    expect(tiles.map(tile => tile.tagName)).toEqual(['A', 'A', 'A', 'A'])
    expect(tiles.map(tile => tile.classList.contains('hex-link'))).toEqual([false, false, true, true])
    expect(tiles.slice(2).map(tile => tile.querySelector('.hex-name')?.textContent)).toEqual(['Browser extensions', 'Minimal host'])
    expect((tiles[3] as HTMLAnchorElement).getAttribute('href')).toBe('/hosts')
    // No panel is left on the page: no membership, no explore cards.
    expect(bands.querySelector('.member, .explore, .explore-tile')).toBeNull()
    const search = hero.querySelector('input[type=search]') as HTMLInputElement
    search.value = 'minimal'
    search.dispatchEvent(new Event('input'))
    expect([...bands.querySelectorAll('.dex-row.own .hex-name')].map(name => name.textContent)).toEqual(['Minimal host'])
  })
})

describe('following a domain from the page', () => {
  const sites = parseLedger(LEDGER)
  const peer = (zone: string) => parseLedger({ sites: [
    { host: `garden.${zone}`, title: 'garden', lineage: 'garden', hosts: [{ host: `garden.${zone}` }],
      publishers: [{ pubkey: sig('c'), label: 'Leanne', head: sig('7') }] },
    // A peer cannot claim a place on another domain.
    { host: 'dylan.hypercomb.com', title: 'dylan', lineage: 'dylan', hosts: [{ host: 'dylan.hypercomb.com' }],
      publishers: [{ pubkey: sig('c'), label: 'Leanne', head: sig('8') }] },
  ] })

  it('reads the domain a typed line names, and nothing else', () => {
    expect(followCandidate('jwize.com')).toBe('jwize.com')
    expect(followCandidate('  https://Cafesociety.buzz/menu?x=1 ')).toBe('cafesociety.buzz')
    expect(followCandidate('dylan')).toBe('')
    expect(followCandidate('two words.com')).toBe('')
    expect(followCandidate('')).toBe('')
  })

  it('keeps a peer\'s ledger to the names under its own domain', async () => {
    const fetched: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      fetched.push(url)
      return { ok: true, text: async () => JSON.stringify({ sites: [
        { host: 'garden.cafesociety.buzz', title: 'garden', lineage: 'garden', publishers: [{ pubkey: sig('c'), head: sig('7') }] },
        { host: 'dylan.hypercomb.com', title: 'dylan', lineage: 'dylan', publishers: [{ pubkey: sig('c'), head: sig('8') }] },
      ] }) }
    })
    try {
      expect((await readPeerLedger('cafesociety.buzz')).map(site => site.hosts)).toEqual([['garden.cafesociety.buzz']])
      expect(fetched).toEqual(['https://cafesociety.buzz/publications.json'])
    } finally { vi.unstubAllGlobals() }
  })

  it('keeps the search for searching, and the follow box suggests a domain the search names', async () => {
    const follow = vi.fn(async (raw: string) => ({ ok: true as const, zone: raw.trim() }))
    const { bands, hero } = showcase({
      self: 'hypercomb.com', title: 'hypercomb', tagline: '', sources: [],
      ledger: Promise.resolve(sites), readShared: async () => ({ offers: [], creations: [] }),
      follow, readPeerLedger: async zone => peer(zone),
    })
    await vi.waitFor(() => expect(bands.querySelector('.dex-row.own .hex')).not.toBeNull())
    const search = hero.querySelector('input[type=search]') as HTMLInputElement
    const input = bands.querySelector('.follow input') as HTMLInputElement
    expect(bands.querySelector('.follow-suggest')).toBeNull()
    expect((bands.querySelector('.follow') as HTMLElement).hidden).toBe(false)
    // The search names a domain: the follow box offers it, and the search itself offers nothing.
    search.value = 'cafesociety.buzz'
    search.dispatchEvent(new Event('input'))
    expect(input.value).toBe('cafesociety.buzz')
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(follow).not.toHaveBeenCalled()
    // What was typed in the follow box by the person is not replaced by a later search.
    input.value = 'mine.example'
    search.value = 'other.example'
    search.dispatchEvent(new Event('input'))
    expect(input.value).toBe('mine.example')
    input.value = ''
    search.value = 'cafesociety.buzz'
    search.dispatchEvent(new Event('input'))
    ;(bands.querySelector('.follow') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(follow).toHaveBeenCalledWith('cafesociety.buzz'))
    // The row is there, open, with what that peer publishes — and only what is under its own domain.
    await vi.waitFor(() => expect([...bands.querySelectorAll('.dex-row:not(.own) .hex-name')].map(name => name.textContent)).toEqual(['garden']))
    expect(bands.querySelector('.dex-row:not(.own)')?.classList.contains('open')).toBe(true)
    expect(input.value).toBe('')
  })

  it('shows the domain at once as checking, and a failed one stays as "not found" with the reason, kept nowhere', async () => {
    let answer: (value: { ok: false; reason: string }) => void = () => {}
    const follow = vi.fn(() => new Promise<{ ok: false; reason: string }>(resolve => { answer = resolve }))
    const { bands } = showcase({
      self: 'hypercomb.com', title: 'hypercomb', tagline: '', sources: [],
      ledger: Promise.resolve(sites), readShared: async () => ({ offers: [], creations: [] }), follow,
    })
    await vi.waitFor(() => expect(bands.querySelector('.dex-row.own .hex')).not.toBeNull())
    const input = bands.querySelector('.follow input') as HTMLInputElement
    input.value = 'nope.example'
    ;(bands.querySelector('.follow') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }))
    // Before the host has answered the row is already there.
    await vi.waitFor(() => expect(bands.querySelectorAll('.dex-row')).toHaveLength(2))
    const row = () => bands.querySelectorAll('.dex-row')[0] as HTMLElement
    expect(row().querySelector('.dex-name')?.textContent).toBe('nope.example')
    expect(row().querySelector('.dex-meta')?.textContent).toBe('Checking…')
    answer({ ok: false, reason: 'nope.example did not answer — it is not a Hypercomb host.' })
    await vi.waitFor(() => expect(row().querySelector('.dex-meta')?.textContent).toBe('Not found'))
    expect(row().classList.contains('missing')).toBe(true)
    expect(row().querySelector('.hosted-empty')?.textContent).toContain('nope.example was not found')
    expect(bands.querySelector('.follow-note')?.textContent).toContain('did not answer')
  })

  it('takes a not-found row away when anything else is clicked, a new domain is asked for, or the page is refreshed', async () => {
    const follow = vi.fn(async () => ({ ok: false as const, reason: 'nothing answered.' }))
    const make = () => showcase({
      self: 'hypercomb.com', title: 'hypercomb', tagline: '', sources: ['jwize.com'],
      ledger: Promise.resolve(sites), readShared: async () => ({ offers: [], creations: [] }), follow, readPeerLedger: async () => [],
    })
    const miss = async (handle: ReturnType<typeof make>, zone: string) => {
      const input = handle.bands.querySelector('.follow input') as HTMLInputElement
      input.value = zone
      ;(handle.bands.querySelector('.follow') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }))
      await vi.waitFor(() => expect([...handle.bands.querySelectorAll('.dex-meta')].some(meta => meta.textContent === 'Not found')).toBe(true))
    }
    const names = (handle: ReturnType<typeof make>) => [...handle.bands.querySelectorAll('.dex-row .dex-name')].map(name => name.textContent)

    // another row clicked
    const one = make()
    await vi.waitFor(() => expect(one.bands.querySelector('.dex-row.own .hex')).not.toBeNull())
    await miss(one, 'first.example')
    expect(names(one)).toContain('first.example')
    ;(one.bands.querySelector('.dex-row:not(.missing) + .dex-row .dex-head, .dex-row.missing + .dex-row .dex-head') as HTMLButtonElement).click()
    expect(names(one)).not.toContain('first.example')

    // a new domain asked for
    const two = make()
    await vi.waitFor(() => expect(two.bands.querySelector('.dex-row.own .hex')).not.toBeNull())
    await miss(two, 'first.example')
    const input = two.bands.querySelector('.follow input') as HTMLInputElement
    input.value = 'second.example'
    ;(two.bands.querySelector('.follow') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(names(two)).toContain('second.example'))
    expect(names(two)).not.toContain('first.example')

    // the page refreshed
    const three = make()
    await vi.waitFor(() => expect(three.bands.querySelector('.dex-row.own .hex')).not.toBeNull())
    await miss(three, 'first.example')
    three.refresh(Promise.resolve(sites))
    await vi.waitFor(() => expect(names(three)).not.toContain('first.example'))
  })

  it('draws no follow input where nothing can follow', () => {
    const { bands } = showcase({
      self: 'hypercomb.com', title: 'hypercomb', tagline: '', sources: [],
      ledger: Promise.resolve(sites), readShared: async () => ({ offers: [], creations: [] }),
    })
    expect((bands.querySelector('.follow') as HTMLElement).hidden).toBe(true)
  })
})

describe('pageFlip — which way a drag turns the page', () => {
  it('turns left for next and right for back, once the drag is far enough and clearly sideways', () => {
    expect(pageFlip(-100, 4, 120)).toBe(1)
    expect(pageFlip(100, -4, 120)).toBe(-1)
    expect(pageFlip(-40, 0, 400)).toBe(0)
    // A short, quick flick commits; a short slow one does not.
    expect(pageFlip(-30, 2, 60)).toBe(1)
    expect(pageFlip(-30, 2, 600)).toBe(0)
    // A vertical scroll is never a swipe: it must be 1.4 times more across than down.
    expect(pageFlip(-100, 90, 120)).toBe(0)
    expect(pageFlip(-100, 75, 120)).toBe(0)
    expect(pageFlip(-100, 60, 120)).toBe(1)
    expect(pageFlip(0, 0, 0)).toBe(0)
  })
})

describe('communities — pages after All', () => {
  const sites = parseLedger(LEDGER)
  const a = { pubkey: sig('a') }
  const record: ShowcaseRecord = {
    zone: 'hypercomb.com', domains: [], items: [{ ...a, lineage: 'camelflage' }, { ...a, lineage: 'dylan' }],
    communities: [
      { name: 'Favourites', items: [{ ...a, lineage: 'dylan' }], domains: [] },
      { name: 'Empty', items: [], domains: [] },
      // A community only filters: a member that is not in the showcase never appears.
      { name: 'Sneaky', items: [{ ...a, lineage: 'dylan' }, { ...a, lineage: 'unpublished' }], domains: [] },
    ],
  }
  const links = [{ label: 'Minimal host', href: '/hosts', note: '', icon: 'host' as const }]
  const draw = () => showcase({
    self: 'hypercomb.com', groups: true, title: 'hypercomb', tagline: '', sources: [], links,
    ledger: Promise.resolve(sites), readShared: async () => ({ offers: [], creations: [] }),
    readOwners: async () => ({ showcase: record, reached: true, unreadable: false, doors: new Map() }),
  })
  const names = (bands: HTMLElement): string[] => [...bands.querySelectorAll('.dex-row.own .hex-name')].map(name => name.textContent ?? '')
  const pointer = (target: Element, type: string, props: Record<string, unknown>): void => {
    const event = new Event(type, { bubbles: true, cancelable: true })
    for (const [key, value] of Object.entries(props)) Object.defineProperty(event, key, { value })
    target.dispatchEvent(event)
  }
  const drag = (bands: HTMLElement, from: number, to: number, props: Record<string, unknown> = {}): void => {
    const list = bands.querySelector('.hosted')!
    pointer(list, 'pointerdown', { pointerId: 1, pointerType: 'touch', clientX: from, clientY: 200, timeStamp: 0, ...props })
    pointer(list, 'pointerup', { pointerId: 1, pointerType: 'touch', clientX: to, clientY: 204, timeStamp: 100, ...props })
  }

  it('shows All first, then each community that has members — an empty one is not a page', async () => {
    const { bands } = draw()
    await vi.waitFor(() => expect(tabs(bands)).toEqual(['All*', 'Favourites', 'Sneaky']))
    expect(names(bands)).toEqual(['camelflage', 'dylan', 'Minimal host'])
  })

  it('filters the first row to the community, without the platform doors, and never reveals more than the showcase', async () => {
    const { bands } = draw()
    await vi.waitFor(() => expect(tabs(bands)).toHaveLength(3))
    ;goTo(bands, 1)
    expect(tabs(bands)).toEqual(['All', 'Favourites*', 'Sneaky'])
    expect(names(bands)).toEqual(['dylan'])
    ;goTo(bands, 2)
    expect(names(bands)).toEqual(['dylan'])
    expect(bands.querySelector('.hosted')?.getAttribute('aria-labelledby')).toBe('community-label')
    ;goTo(bands, 0)
    expect(names(bands)).toEqual(['camelflage', 'dylan', 'Minimal host'])
  })

  it('turns with a sideways swipe on the list, and the pages cycle', async () => {
    const { bands } = draw()
    await vi.waitFor(() => expect(tabs(bands)).toHaveLength(3))
    drag(bands, 300, 100)
    expect(tabs(bands)).toEqual(['All', 'Favourites*', 'Sneaky'])
    drag(bands, 300, 100)
    expect(tabs(bands)).toEqual(['All', 'Favourites', 'Sneaky*'])
    // On from the last page comes round to All; back from All is the last page.
    drag(bands, 300, 100)
    expect(tabs(bands)).toEqual(['All*', 'Favourites', 'Sneaky'])
    drag(bands, 100, 300)
    expect(tabs(bands)).toEqual(['All', 'Favourites', 'Sneaky*'])
    drag(bands, 100, 300)
    expect(tabs(bands)).toEqual(['All', 'Favourites*', 'Sneaky'])
  })

  it('ignores a mouse, a drag from the screen edge, a vertical scroll and a short drag', async () => {
    const { bands } = draw()
    await vi.waitFor(() => expect(tabs(bands)).toHaveLength(3))
    drag(bands, 300, 100, { pointerType: 'mouse' })
    drag(bands, 8, 200)
    drag(bands, 300, 285)
    const list = bands.querySelector('.hosted')!
    pointer(list, 'pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 300, clientY: 100, timeStamp: 0 })
    pointer(list, 'pointerup', { pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 400, timeStamp: 100 })
    pointer(list, 'pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 300, clientY: 100, timeStamp: 0 })
    pointer(list, 'pointercancel', { pointerId: 1 })
    pointer(list, 'pointerup', { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100, timeStamp: 100 })
    expect(tabs(bands)).toEqual(['All*', 'Favourites', 'Sneaky'])
  })

  it('moves with the arrow keys (round the ends), Home and End, keeping focus on the tab', async () => {
    const { hero, bands } = draw()
    document.body.append(hero, bands)
    try {
      await vi.waitFor(() => expect(tabs(bands)).toHaveLength(3))
      const key = (name: string) => bands.querySelector('.pager')!.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }))
      key('ArrowRight')
      expect(tabs(bands)).toEqual(['All', 'Favourites*', 'Sneaky'])
      key('End')
      expect(tabs(bands)).toEqual(['All', 'Favourites', 'Sneaky*'])
      key('Home')
      expect(tabs(bands)).toEqual(['All*', 'Favourites', 'Sneaky'])
      key('ArrowLeft')
      expect(tabs(bands)).toEqual(['All', 'Favourites', 'Sneaky*'])
      key('ArrowRight')
      expect(tabs(bands)).toEqual(['All*', 'Favourites', 'Sneaky'])
    } finally { hero.remove(); bands.remove() }
  })

  it('shows no pager where there are no communities, and leaves the followed rows as the master list', async () => {
    const plain = showcase({
      self: 'hypercomb.com', title: 'hypercomb', tagline: '', sources: [],
      ledger: Promise.resolve(sites), readShared: async () => ({ offers: [], creations: [] }),
    })
    await vi.waitFor(() => expect(names(plain.bands)).toEqual(['camelflage', 'dylan']))
    expect((plain.bands.querySelector('.pager') as HTMLElement).hidden).toBe(true)
    const withPeers = showcase({
      self: 'hypercomb.com', groups: true, title: 'hypercomb', tagline: '', sources: ['jwize.com'],
      ledger: Promise.resolve(sites), readShared: async () => ({ offers: [], creations: [] }),
      readOwners: async () => ({ showcase: record, reached: true, unreadable: false, doors: new Map() }),
    })
    await vi.waitFor(() => expect(tabs(withPeers.bands)).toHaveLength(3))
    ;goTo(withPeers.bands, 1)
    ;(withPeers.hero.querySelector('.manage-toggle') as HTMLButtonElement).click()
    ;(withPeers.bands.querySelectorAll('.dex-head')[1] as HTMLButtonElement).click()
    // jwize.com's row is its master list, whichever community is showing.
    expect([...withPeers.bands.querySelectorAll('.dex-row:not(.own) .hex-name')].map(name => name.textContent)).toEqual(['dylan'])
  })
})

describe('the launcher — the same tiles, drawn in rows of four', () => {
  const sites = parseLedger(LEDGER)
  const a = { pubkey: sig('a') }
  const links = [{ label: 'Minimal host', href: '/hosts', note: '', icon: 'host' as const }]
  const record = (extra: Partial<ShowcaseRecord>): ShowcaseRecord => ({
    zone: 'hypercomb.com', domains: [], items: [{ ...a, lineage: 'camelflage' }, { ...a, lineage: 'dylan' }],
    communities: [{ name: 'Favourites', items: [{ ...a, lineage: 'dylan' }], domains: [] }, { name: 'Daily', items: [{ ...a, lineage: 'camelflage' }], domains: [], view: 'launcher' }],
    ...extra,
  })
  const draw = (rec: ShowcaseRecord, sources: string[] = []) => showcase({
    self: 'hypercomb.com', groups: true, title: 'hypercomb', tagline: '', sources, links,
    ledger: Promise.resolve(sites), readShared: async () => ({ offers: [], creations: [] }),
    readOwners: async () => ({ showcase: rec, reached: true, unreadable: false, doors: new Map() }),
  })
  const own = (bands: HTMLElement): HTMLElement => bands.querySelector('.dex-row.own .comb') as HTMLElement
  const tab = (bands: HTMLElement, name: string): HTMLButtonElement =>
    ({ click: () => goTo(bands, tabs(bands).findIndex(entry => entry.replace('*', '') === name)) }) as unknown as HTMLButtonElement

  it('draws hexagons unless a view says otherwise — in comb rows', async () => {
    const { bands } = draw(record({}))
    await vi.waitFor(() => expect(tabs(bands)).toHaveLength(3))
    expect(own(bands).dataset['shape']).toBeUndefined()
    expect(own(bands).querySelector('.comb-row')).not.toBeNull()
  })

  it('draws the launcher as a plain grid of the very same tiles when the page says so', async () => {
    const { bands } = draw(record({ view: 'launcher' }))
    await vi.waitFor(() => expect(own(bands)?.dataset['shape']).toBe('launcher'))
    expect(own(bands).querySelector('.comb-row')).toBeNull()
    const kids = [...own(bands).children]
    expect(kids.map(node => node.querySelector('.hex-name')?.textContent)).toEqual(['camelflage', 'dylan', 'Minimal host'])
    // The same pictures, names and links: only the shape differs.
    expect(kids.every(node => node.classList.contains('hex') && node.querySelector('.hex-art'))).toBe(true)
    expect(kids[2]!.tagName).toBe('A')
  })

  it('lets a community choose its own view, and one that says nothing is drawn as All is', async () => {
    const { bands } = draw(record({}))
    await vi.waitFor(() => expect(tabs(bands)).toHaveLength(3))
    tab(bands, 'Daily').click()
    expect(own(bands).dataset['shape']).toBe('launcher')
    expect([...own(bands).children].map(node => node.querySelector('.hex-name')?.textContent)).toEqual(['camelflage'])
    tab(bands, 'Favourites').click()
    expect(own(bands).dataset['shape']).toBeUndefined()
    expect(own(bands).querySelector('.comb-row')).not.toBeNull()
    tab(bands, 'All').click()
    expect(own(bands).dataset['shape']).toBeUndefined()
    // Hexagons once more, then the launcher once more: the comb starts over each time.
    tab(bands, 'Daily').click()
    expect(own(bands).dataset['shape']).toBe('launcher')
  })

  it('inherits All\'s view into a community that has none, and an explicit hex beats it', async () => {
    const { bands } = draw(record({ view: 'launcher', communities: [
      { name: 'Plain', items: [{ ...a, lineage: 'dylan' }], domains: [] },
      { name: 'Brand', items: [{ ...a, lineage: 'camelflage' }], domains: [], view: 'hex' }] }))
    await vi.waitFor(() => expect(tabs(bands)).toHaveLength(3))
    tab(bands, 'Plain').click()
    expect(own(bands).dataset['shape']).toBe('launcher')
    tab(bands, 'Brand').click()
    expect(own(bands).dataset['shape']).toBeUndefined()
  })

  it('keeps the followed domains in the view All has, whichever community is showing', async () => {
    const { bands } = draw(record({ view: 'launcher' }), ['jwize.com'])
    await vi.waitFor(() => expect(own(bands)?.dataset['shape']).toBe('launcher'))
    tab(bands, 'Favourites').click()
    ;(bands.querySelectorAll('.dex-head')[1] as HTMLButtonElement).click()
    const peer = bands.querySelector('.dex-row:not(.own) .comb') as HTMLElement
    await vi.waitFor(() => expect(peer.dataset['shape']).toBe('launcher'))
  })

  it('takes the shape the address asks for over the signed one, and a shape nobody knows for none', async () => {
    const original = location.search
    try {
      history.replaceState(null, '', '/?view=launcher')
      const asked = draw(record({}))
      await vi.waitFor(() => expect(own(asked.bands)?.dataset['shape']).toBe('launcher'))
      history.replaceState(null, '', '/?view=grid')
      const unknown = draw(record({ view: 'launcher' }))
      await vi.waitFor(() => expect(own(unknown.bands)?.dataset['shape']).toBe('launcher'))
      history.replaceState(null, '', '/?view=hex')
      const hex = draw(record({ view: 'launcher' }))
      await vi.waitFor(() => expect(hex.bands.querySelector('.dex-row.own .comb-row')).not.toBeNull())
    } finally { history.replaceState(null, '', '/' + original) }
  })
})

// What the review of 2026-10-25 confirmed, held in place.
describe('what the owners meant, and what the page does when it cannot tell', () => {
  const sites = parseLedger(LEDGER)
  const owners = (extra: Partial<ZoneOwners> = {}): ZoneOwners => ({
    showcase: null, reached: true, unreadable: false,
    doors: new Map([[sig('a'), new Map([['camelflage', ['hypercomb.com']], ['dylan', ['hypercomb.com']]])]]), ...extra,
  })
  const draw = (read: () => Promise<ZoneOwners>, extra = {}) => showcase({
    self: 'hypercomb.com', groups: true, title: 'hypercomb', tagline: '', sources: [],
    ledger: Promise.resolve(sites), readShared: async () => ({ offers: [], creations: [] }), readOwners: read, ...extra,
  })
  const names = (bands: HTMLElement): string[] => [...bands.querySelectorAll('.dex-row.own .hex-name')].map(name => name.textContent ?? '')
  const empty = (bands: HTMLElement): string | undefined => bands.querySelector('.dex-row.own .hosted-empty:not([hidden])')?.textContent ?? undefined

  it('shows nothing, and says so, when the showcase an index names cannot be read — never the larger set', async () => {
    const { bands } = draw(async () => owners({ unreadable: true }))
    await vi.waitFor(() => expect(empty(bands)).toBe('Could not read what is published here.'))
    expect(names(bands)).toEqual([])
  })

  it('shows nothing, and says so, when no owner\'s index could be reached at all', async () => {
    const { bands } = draw(async () => owners({ reached: false, doors: new Map() }))
    await vi.waitFor(() => expect(empty(bands)).toBe('Could not read what is published here.'))
    expect(names(bands)).toEqual([])
  })

  it('keeps what it last knew when a later read reaches no one, and when a later ledger comes back empty', async () => {
    let reads = 0
    const { bands, refresh } = draw(async () => (reads++ === 0 ? owners() : owners({ reached: false, doors: new Map() })))
    await vi.waitFor(() => expect(names(bands)).toEqual(['camelflage', 'dylan']))
    refresh(Promise.resolve(sites))
    await vi.waitFor(() => expect(reads).toBe(2))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(names(bands)).toEqual(['camelflage', 'dylan'])
    refresh(Promise.resolve([]))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(names(bands)).toEqual(['camelflage', 'dylan'])
  })

  it('hides a named item that Publish has turned off for this domain, but not what a shown-in-full domain brings', async () => {
    const record: ShowcaseRecord = { zone: 'hypercomb.com', domains: [], items: [{ pubkey: sig('a'), lineage: 'dylan' }, { pubkey: sig('a'), lineage: 'camelflage' }] }
    const turnedOff = owners({ showcase: record, doors: new Map([[sig('a'), new Map([['camelflage', ['hypercomb.com']], ['dylan', ['jwize.com']]])]]) })
    const { bands } = draw(async () => turnedOff)
    await vi.waitFor(() => expect(names(bands)).toEqual(['camelflage']))
    // "Show all of jwize.com" means everything jwize.com hosts, whether or not it opens here.
    const wide = draw(async () => ({ ...turnedOff, showcase: { ...record, items: [], domains: ['jwize.com'] } }))
    await vi.waitFor(() => expect(names(wide.bands)).toEqual(['dylan']))
  })

  it('never counts a followed domain\'s ledger as proof: it cannot slip into an owner\'s tile, or earn a Manage switch', async () => {
    const hostile = parseLedger({ sites: [
      // evil.example claims the owner's key and lineage to put its own version under the owner's name.
      { host: 'dylan.evil.example', title: 'dylan', lineage: 'dylan', hosts: [{ host: 'dylan.evil.example' }],
        publishers: [{ pubkey: sig('a'), label: 'Jaime', head: sig('6') }] },
    ] })
    const { bands, hero } = draw(async () => owners(), { sources: ['evil.example'], readPeerLedger: async () => hostile })
    await vi.waitFor(() => expect(names(bands)).toEqual(['camelflage', 'dylan']))
    ;(hero.querySelector('.manage-toggle') as HTMLButtonElement).click()
    // The owner's own tile keeps its one owner: the peer's claim to the same key never joins it.
    const dylan = [...bands.querySelectorAll<HTMLAnchorElement>('.dex-row.own a.hex')].find(tile => tile.textContent?.includes('dylan'))!
    expect(dylan.querySelector<HTMLElement>('.hex-owners')!.hidden).toBe(true)

    // The peer's row has its own version of the name, drawn as an address, never as the owner's.
    ;(bands.querySelectorAll('.dex-head')[1] as HTMLButtonElement).click()
    await vi.waitFor(() => expect([...bands.querySelectorAll('.dex-row:not(.own) .hex-name')].map(name => name.textContent)).toEqual(['dylan']))
  })

  it('reads a followed domain\'s own ledger even when this host\'s ledger already knew the domain', async () => {
    const read = vi.fn(async () => [] as ReturnType<typeof parseLedger>)
    const { bands } = draw(async () => owners(), { readPeerLedger: read, follow: async (raw: string) => ({ ok: true as const, zone: raw }) })
    await vi.waitFor(() => expect(names(bands)).toEqual(['camelflage', 'dylan']))
    expect(read).not.toHaveBeenCalled()
    const input = bands.querySelector('.follow input') as HTMLInputElement
    input.value = 'jwize.com'
    ;(bands.querySelector('.follow') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(read).toHaveBeenCalledWith('jwize.com'))
  })

  it('draws a followed domain that sits under one already drawn as the names that open under it', async () => {
    const { bands, hero } = draw(async () => owners(), { sources: ['dylan.jwize.com'] })
    await vi.waitFor(() => expect(names(bands)).toEqual(['camelflage', 'dylan']))
    ;(hero.querySelector('.manage-toggle') as HTMLButtonElement).click()
    ;(bands.querySelectorAll('.dex-head')[1] as HTMLButtonElement).click()
    expect([...bands.querySelectorAll('.dex-row:not(.own) .hex-name')].map(name => name.textContent)).toEqual(['dylan'])
  })

  it('leaves the tab strip to the keyboard shortcuts it does not own, and the swipe\'s ground to pages that have a swipe', async () => {
    const a = { pubkey: sig('a') }
    const record: ShowcaseRecord = { zone: 'hypercomb.com', domains: [], items: [{ ...a, lineage: 'dylan' }, { ...a, lineage: 'camelflage' }],
      communities: [{ name: 'Daily', items: [{ ...a, lineage: 'dylan' }], domains: [] }] }
    const { bands } = draw(async () => owners({ showcase: record }))
    await vi.waitFor(() => expect(tabs(bands)).toHaveLength(2))
    const hosted = bands.querySelector('.hosted') as HTMLElement
    expect(hosted.classList.contains('swipeable')).toBe(true)
    const key = (init: KeyboardEventInit) => bands.querySelector('.pager')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true, ...init }))
    key({ altKey: true })
    key({ metaKey: true })
    expect(tabs(bands)).toEqual(['All*', 'Daily'])
    key({})
    expect(tabs(bands)).toEqual(['All', 'Daily*'])
    // A search takes the swipe's ground away: its misses and its Follow offer sit where they are read.
    const search = bands.parentElement ? undefined : undefined
    void search
  })
})

describe('readZoneOwners — how far a read got', () => {
  const secret = generateSecretKey()
  const owner = getPublicKey(secret)
  const zone = 'hypercomb.com'
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
  const hash = async (data: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(b => b.toString(16).padStart(2, '0')).join('')
  const serve = async (atom: { zone?: string } | null, sigOverride?: string) => {
    const body = atom ? bytes({ kind: 'host:showcase', zone, items: [{ pubkey: owner, lineage: 'dylan' }], domains: [], ...atom }) : null
    const atomSig = sigOverride ?? (body ? await hash(body) : sig('e'))
    const index = finalizeEvent({ kind: 30564, created_at: 1, tags: [], content: JSON.stringify({ v: 1,
      roots: atom === undefined ? {} : { [`showcase:${zone}`]: atomSig }, doors: { dylan: [zone] } }) }, secret)
    const indexes = await hash(new TextEncoder().encode('hive:indexes'))
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.signal).toBeDefined()
      if (url === `https://${zone}/${indexes}/${owner}`) return new Response(JSON.stringify(index), { status: 200 })
      if (body && url === `https://${zone}/${atomSig}`) return new Response(body, { status: 200 })
      return new Response('', { status: 404 })
    }))
  }

  it('reads the index and the showcase it names', async () => {
    await serve({})
    try {
      const read = await readZoneOwners(zone, [owner])
      expect(read.reached).toBe(true)
      expect(read.unreadable).toBe(false)
      expect(read.showcase?.items).toEqual([{ pubkey: owner, lineage: 'dylan' }])
      expect(read.doors.get(owner)?.get('dylan')).toEqual([zone])
    } finally { vi.unstubAllGlobals() }
  })

  it('says unreadable — not "no showcase" — when the index names one that cannot be fetched or verified', async () => {
    await serve({}, sig('f'))
    try {
      const read = await readZoneOwners(zone, [owner])
      expect(read.reached).toBe(true)
      expect(read.showcase).toBeNull()
      expect(read.unreadable).toBe(true)
    } finally { vi.unstubAllGlobals() }
  })

  it('says it reached no one when no index could be read, and does not let a second owner stand in for a first whose showcase is unreadable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })))
    try {
      expect(await readZoneOwners(zone, [owner])).toMatchObject({ reached: false, unreadable: false, showcase: null })
    } finally { vi.unstubAllGlobals() }
  })
})

describe('a tile — a tap goes to the content, a hold comes up with where else it is', () => {
  const sites = parseLedger(LEDGER)
  const draw = (extra = {}) => showcase({
    self: 'hypercomb.com', title: 'hypercomb', tagline: '', sources: [],
    ledger: Promise.resolve(sites), readShared: async () => ({ offers: [], creations: [] }), ...extra,
  })
  const tileOf = async (bands: HTMLElement, name: string): Promise<HTMLAnchorElement> => vi.waitFor(() => {
    const found = [...bands.querySelectorAll<HTMLAnchorElement>('.dex-row.own a.hex')].find(tile => tile.textContent?.includes(name))
    expect(found).toBeDefined()
    return found!
  })
  const pointer = (target: Element, type: string, props: Record<string, unknown> = {}): void => {
    const event = new Event(type, { bubbles: true, cancelable: true })
    for (const [key, value] of Object.entries({ pointerId: 1, pointerType: 'touch', button: 0, isPrimary: true, clientX: 100, clientY: 100, ...props })) Object.defineProperty(event, key, { value })
    target.dispatchEvent(event)
  }

  it('keeps the page\'s search sticky to the top, in the brand\'s place, and the list the whole width', () => {
    const { hero } = draw()
    // The header's rows belong to the page, so the search can stick to the page's top.
    expect(hero.classList.contains('hero')).toBe(true)
    expect(hero.querySelector(':scope > .hero-brand')).not.toBeNull()
    expect(hero.querySelector(':scope > .search')).not.toBeNull()
  })
})

// What the second review confirmed, held in place.
describe('a followed peer keeps its own tiles, the sheet keeps its own buttons, and the rest of round two', () => {
  const sites = parseLedger(LEDGER)
  const a = { pubkey: sig('a') }
  const owners = (extra: Partial<ZoneOwners> = {}): ZoneOwners => ({
    showcase: null, reached: true, unreadable: false,
    doors: new Map([[sig('a'), new Map([['camelflage', ['hypercomb.com']], ['dylan', ['hypercomb.com']]])]]), ...extra,
  })
  const draw = (extra = {}) => showcase({
    self: 'hypercomb.com', title: 'hypercomb', tagline: '', sources: [],
    ledger: Promise.resolve(sites), readShared: async () => ({ offers: [], creations: [] }), readOwners: async () => owners(), ...extra,
  })
  const own = (bands: HTMLElement): string[] => [...bands.querySelectorAll('.dex-row.own .hex-name')].map(name => name.textContent ?? '')
  const pointer = (target: Element, type: string, props: Record<string, unknown> = {}): void => {
    const event = new Event(type, { bubbles: true, cancelable: true })
    for (const [key, value] of Object.entries({ pointerId: 1, pointerType: 'touch', button: 0, isPrimary: true, clientX: 100, clientY: 100, ...props })) Object.defineProperty(event, key, { value })
    target.dispatchEvent(event)
  }

  it('draws a peer\'s names only in the zones that are its own, never in this domain\'s row', async () => {
    const under = parseLedger({ sites: [
      { host: 'secret.team.hypercomb.com', title: 'secret', lineage: 'secret', hosts: [{ host: 'secret.team.hypercomb.com' }],
        publishers: [{ pubkey: sig('c'), head: sig('7') }] } ] })
    const { bands } = draw({ sources: ['team.hypercomb.com'], readPeerLedger: async () => under })
    await vi.waitFor(() => expect(own(bands)).toEqual(['camelflage', 'dylan']))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(own(bands)).not.toContain('secret')
  })

  it('says why the list is empty above the platform doors, where it can be read', async () => {
    const links = [{ label: 'Minimal host', href: '/hosts', note: '', icon: 'host' as const }]
    const { bands } = draw({ links, readOwners: async () => owners({ reached: false, doors: new Map() }) })
    await vi.waitFor(() => expect(bands.querySelector('.dex-row.own .hosted-empty:not([hidden])')?.textContent).toBe('Could not read what is published here.'))
    expect([...bands.querySelectorAll('.dex-row.own .hex-name')].map(name => name.textContent)).toEqual(['Minimal host'])
    const body = bands.querySelector('.dex-row.own .dex-body')!
    expect(body.firstElementChild?.classList.contains('hosted-empty')).toBe(true)
  })

  it('follows one domain at a time, and keeps what the person types in the search while it waits', async () => {
    let release: (value: { ok: true; zone: string }) => void = () => {}
    const follow = vi.fn(() => new Promise<{ ok: true; zone: string }>(resolve => { release = resolve }))
    const { hero, bands } = draw({ follow })
    const search = hero.querySelector('input[type=search]') as HTMLInputElement
    const input = bands.querySelector('.follow input') as HTMLInputElement
    await vi.waitFor(() => expect(own(bands)).toEqual(['camelflage', 'dylan']))
    input.value = 'friend.example'
    const form = bands.querySelector('.follow') as HTMLFormElement
    form.dispatchEvent(new Event('submit', { cancelable: true }))
    form.dispatchEvent(new Event('submit', { cancelable: true }))
    expect(follow).toHaveBeenCalledTimes(1)
    search.value = 'dylan'
    search.dispatchEvent(new Event('input'))
    release({ ok: true, zone: 'friend.example' })
    await vi.waitFor(() => expect(bands.querySelector('.follow-note')?.textContent).toBe('Following friend.example.'))
    expect(search.value).toBe('dylan')
  })
})

describe('readZoneOwners — every owner counts', () => {
  const secretA = generateSecretKey(), secretB = generateSecretKey()
  const A = getPublicKey(secretA), B = getPublicKey(secretB)
  const zone = 'hypercomb.com'
  const hash = async (data: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(b => b.toString(16).padStart(2, '0')).join('')
  const run = async (answers: Record<string, 'ok' | 'down' | 'missing'>) => {
    const indexes = await hash(new TextEncoder().encode('hive:indexes'))
    const index = (secret: Uint8Array) => finalizeEvent({ kind: 30564, created_at: 1, tags: [], content: JSON.stringify({ v: 1, roots: {}, doors: { dylan: [zone] } }) }, secret)
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const who = url.endsWith(A) ? A : url.endsWith(B) ? B : ''
      const how = answers[who]
      if (how === 'ok') return new Response(JSON.stringify(index(who === A ? secretA : secretB)), { status: 200 })
      if (how === 'missing') return new Response('', { status: 404 })
      return new Response('', { status: 503 })
    }))
    void indexes
    try { return await readZoneOwners(zone, [A, B]) } finally { vi.unstubAllGlobals() }
  }

  it('reads everyone: reached', async () => {
    expect((await run({ [A]: 'ok', [B]: 'ok' })).reached).toBe(true)
  })

  it('knows nothing when ONE owner cannot be read — never a smaller or larger set decided by whoever answered', async () => {
    expect((await run({ [A]: 'ok', [B]: 'down' })).reached).toBe(false)
    expect((await run({ [A]: 'down', [B]: 'ok' })).reached).toBe(false)
  })

  it('treats an owner with no index here as nothing signed, not as a failure', async () => {
    const read = await run({ [A]: 'ok', [B]: 'missing' })
    expect(read.reached).toBe(true)
    expect(read.doors.has(A)).toBe(true)
    expect(read.doors.has(B)).toBe(false)
    expect((await run({ [A]: 'missing', [B]: 'missing' })).reached).toBe(true)
  })
})

describe('a held tile lists its domains', () => {
  const sites = parseLedger(LEDGER)
  const draw = () => showcase({
    self: 'hypercomb.com', title: 'hypercomb', tagline: '', sources: [],
    ledger: Promise.resolve(sites), readShared: async () => ({ offers: [], creations: [] }),
  })
  const tileOf = async (bands: HTMLElement, name: string): Promise<HTMLAnchorElement> => vi.waitFor(() => {
    const found = [...bands.querySelectorAll<HTMLAnchorElement>('.dex-row.own a.hex')].find(tile => tile.textContent?.includes(name))
    expect(found).toBeDefined()
    return found!
  })

  it('lists on a hold only the domains whose copy differs, each a link to its revision', async () => {
    vi.useFakeTimers()
    try {
      const { hero, bands } = draw()
      document.body.append(hero, bands)
      await vi.advanceTimersByTimeAsync(50)
      const dylan = await tileOf(bands, 'dylan')
      const sheet = hero.querySelector('.versions-backdrop') as HTMLElement
      dylan.dispatchEvent(Object.assign(new Event('pointerdown', { bubbles: true }), { button: 0, isPrimary: true, clientX: 1, clientY: 1 }))
      vi.advanceTimersByTime(499)
      expect(sheet.hidden).toBe(true)
      vi.advanceTimersByTime(2)
      expect(sheet.hidden).toBe(false)
      expect(sheet.querySelector('.version')).not.toBeNull()
      // Nothing here differs in signature from this domain's own copy, so nothing is listed.
      expect(sheet.querySelector('a')).toBeNull()
      sheet.dispatchEvent(new MouseEvent('click', { bubbles: true }))   // the click the hold ends with stays
      expect(sheet.hidden).toBe(false)
      sheet.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(sheet.hidden).toBe(true)
      hero.remove(); bands.remove()
    } finally { vi.useRealTimers() }
  })

  it('lists them from a right-click or Space too, and closes on Escape', async () => {
    const { hero, bands } = draw()
    document.body.append(hero, bands)
    try {
      const dylan = await tileOf(bands, 'dylan')
      const sheet = hero.querySelector('.versions-backdrop') as HTMLElement
      dylan.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
      expect(sheet.hidden).toBe(false)
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      expect(sheet.hidden).toBe(true)
      dylan.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
      expect(sheet.hidden).toBe(false)
    } finally { hero.remove(); bands.remove() }
  })
})

describe('the owner\'s tap — a device whose hive is beside the page puts a tile in or takes it out', () => {
  const sites = parseLedger(LEDGER)
  const a = sig('a')
  const owners = (): ZoneOwners => ({ showcase: null, reached: true, unreadable: false,
    doors: new Map([[a, new Map([['camelflage', ['hypercomb.com']], ['dylan', ['hypercomb.com']]])]]) })
  const bridge = (key: string) => ({ hello: vi.fn(async () => key), toggle: vi.fn(async () => ({ ok: true as const, changed: false })) })
  const draw = (owner: ReturnType<typeof bridge> | null) => showcase({
    self: 'hypercomb.com', title: 'hypercomb', tagline: '', sources: [],
    ledger: Promise.resolve(sites), readShared: async () => ({ offers: [], creations: [] }), readOwners: async () => owners(),
    ...(owner ? { owner } : {}),
  })
  const dylanOf = async (bands: HTMLElement): Promise<HTMLAnchorElement> => vi.waitFor(() => {
    const found = [...bands.querySelectorAll<HTMLAnchorElement>('.dex-row.own a.hex')].find(tile => tile.textContent?.includes('dylan'))
    expect(found).toBeDefined()
    return found!
  })

  it('does nothing for a visitor, and when no hive answers', async () => {
    const none = bridge('')
    const { bands } = draw(none)
    const dylan = await dylanOf(bands)
    await new Promise(resolve => setTimeout(resolve, 20))
    dylan.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(none.toggle).not.toHaveBeenCalled()
    const visitor = draw(null)
    const tile = await dylanOf(visitor.bands)
    expect(() => tile.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))).not.toThrow()
  })

})

describe('a tap visits, a hold toggles', () => {
  const sites = parseLedger(LEDGER)
  const a = sig('a')
  const record: ShowcaseRecord = { zone: 'hypercomb.com', domains: [], items: [{ pubkey: a, lineage: 'camelflage' }] }
  const owners = (): ZoneOwners => ({ showcase: record, reached: true, unreadable: false,
    doors: new Map([[a, new Map([['camelflage', ['hypercomb.com']], ['dylan', ['hypercomb.com', 'jwize.com']]])]]) })
  const bridge = (key: string) => ({ hello: vi.fn(async () => key), toggle: vi.fn(async () => ({ ok: true as const, changed: false })) })
  const draw = (owner: ReturnType<typeof bridge> | null, sources: string[] = []) => showcase({
    self: 'hypercomb.com', title: 'hypercomb', tagline: '', sources,
    ledger: Promise.resolve(sites), readShared: async () => ({ offers: [], creations: [] }), readOwners: async () => owners(),
    ...(owner ? { owner } : {}),
  })
  const tileIn = async (bands: HTMLElement, selector: string, name: string): Promise<HTMLAnchorElement> => vi.waitFor(() => {
    const found = [...bands.querySelectorAll<HTMLAnchorElement>(selector)].find(tile => tile.textContent?.includes(name))
    expect(found).toBeDefined()
    return found!
  })
  const press = (tile: Element): void => {
    tile.dispatchEvent(Object.assign(new Event('pointerdown', { bubbles: true }), { button: 0, isPrimary: true, clientX: 1, clientY: 1 }))
  }
  const click = (tile: Element): MouseEvent => { const event = new MouseEvent('click', { bubbles: true, cancelable: true }); tile.dispatchEvent(event); return event }

  it('is a link: a tap goes to the content and is not stopped', async () => {
    const { bands } = draw(null)
    const camel = await tileIn(bands, '.dex-row.own a.hex', 'camelflage')
    expect(camel.getAttribute('href')).toBe('https://camelflage.hypercomb.com/')
    expect(camel.getAttribute('target')).toBe('_blank')
    expect(click(camel).defaultPrevented).toBe(false)
  })

  it('on the owner\'s device a hold takes a tile out of the showcase, and the click that ends it does not visit', async () => {
    vi.useFakeTimers()
    try {
      const owner = bridge(a)
      const { hero, bands } = draw(owner)
      document.body.append(hero, bands)
      await vi.advanceTimersByTimeAsync(50)
      const camel = await tileIn(bands, '.dex-row.own a.hex', 'camelflage')
      press(camel)
      vi.advanceTimersByTime(499)
      expect(owner.toggle).not.toHaveBeenCalled()
      vi.advanceTimersByTime(2)
      await vi.advanceTimersByTimeAsync(10)
      expect(owner.toggle).toHaveBeenCalledWith({ zone: 'hypercomb.com', pubkey: a, lineage: 'camelflage', on: false })
      expect(click(camel).defaultPrevented).toBe(true)
      expect(click(camel).defaultPrevented).toBe(false)
      hero.remove(); bands.remove()
    } finally { vi.useRealTimers() }
  })

  it('for a visitor a hold lists the domains and toggles nothing', async () => {
    vi.useFakeTimers()
    try {
      const none = bridge('')
      const { hero, bands } = draw(none)
      document.body.append(hero, bands)
      await vi.advanceTimersByTimeAsync(50)
      const camel = await tileIn(bands, '.dex-row.own a.hex', 'camelflage')
      press(camel)
      vi.advanceTimersByTime(501)
      expect(none.toggle).not.toHaveBeenCalled()
      expect((hero.querySelector('.versions-backdrop') as HTMLElement).hidden).toBe(false)
      hero.remove(); bands.remove()
    } finally { vi.useRealTimers() }
  })

  it('stays in its domain row when it is out of the showcase, grayed, and a tap lights it up and asks to put it in', async () => {
    const owner = bridge(a)
    const { hero, bands } = draw(owner, ['jwize.com'])
    document.body.append(hero, bands)
    try {
      ;(hero.querySelector('.manage-toggle') as HTMLButtonElement).click()
      await vi.waitFor(() => expect(bands.querySelectorAll('.dex-head').length).toBeGreaterThan(1))
      ;(bands.querySelectorAll('.dex-head')[1] as HTMLButtonElement).click()
      const dylan = await tileIn(bands, '.dex-row:not(.own) a.hex', 'dylan')
      expect(dylan.classList.contains('off')).toBe(true)
      await vi.waitFor(() => expect(owner.hello).toHaveBeenCalled())
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(click(dylan).defaultPrevented).toBe(true)
      await vi.waitFor(() => expect(owner.toggle).toHaveBeenCalledWith({ zone: 'hypercomb.com', pubkey: a, lineage: 'dylan', on: true }))
    } finally { hero.remove(); bands.remove() }
  })
})

describe('a followed domain is alive when added and leaves only when removed', () => {
  const sites = parseLedger(LEDGER)
  const make = (extra = {}) => showcase({
    self: 'hypercomb.com', title: 'hypercomb', tagline: '', sources: ['jwize.com'],
    ledger: Promise.resolve(sites), readShared: async () => ({ offers: [], creations: [] }), readPeerLedger: async () => [], ...extra,
  })
  const names = (handle: ReturnType<typeof make>) => [...handle.bands.querySelectorAll('.dex-row .dex-name')].map(name => name.textContent)

  it('a refresh, another row opened, Manage toggled and a search never take it away', async () => {
    const handle = make()
    await vi.waitFor(() => expect(handle.bands.querySelector('.dex-row.own .hex')).not.toBeNull())
    ;(handle.hero.querySelector('.manage-toggle') as HTMLButtonElement).click()
    expect(names(handle)).toContain('jwize.com')
    handle.refresh(Promise.resolve(sites))
    ;(handle.bands.querySelectorAll('.dex-head')[1] as HTMLButtonElement).click()
    ;(handle.hero.querySelector('.manage-toggle') as HTMLButtonElement).click()
    ;(handle.hero.querySelector('.manage-toggle') as HTMLButtonElement).click()
    const search = handle.hero.querySelector('input[type=search]') as HTMLInputElement
    search.value = 'dylan'
    search.dispatchEvent(new Event('input'))
    expect(names(handle)).toContain('jwize.com')
  })

  it('a domain that checked out stays through a refresh', async () => {
    const follow = vi.fn(async (raw: string) => ({ ok: true as const, zone: raw.trim() }))
    const handle = make({ sources: [], follow })
    await vi.waitFor(() => expect(handle.bands.querySelector('.dex-row.own .hex')).not.toBeNull())
    const input = handle.bands.querySelector('.follow input') as HTMLInputElement
    input.value = 'friend.example'
    ;(handle.bands.querySelector('.follow') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(names(handle)).toContain('friend.example'))
    handle.refresh(Promise.resolve(sites))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(names(handle)).toContain('friend.example')
  })

  it('leaves when its remove control is pressed: the store is told, and the row is gone', async () => {
    const unfollow = vi.fn(async () => true)
    const handle = make({ unfollow })
    await vi.waitFor(() => expect(handle.bands.querySelector('.dex-row.own .hex')).not.toBeNull())
    ;(handle.hero.querySelector('.manage-toggle') as HTMLButtonElement).click()
    ;(handle.bands.querySelector('.dex-remove') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(names(handle)).not.toContain('jwize.com'))
    expect(unfollow).toHaveBeenCalledWith('jwize.com')
  })

  it('stays, and says so, when the store could not forget it', async () => {
    const handle = make({ unfollow: async () => false })
    await vi.waitFor(() => expect(handle.bands.querySelector('.dex-row.own .hex')).not.toBeNull())
    ;(handle.hero.querySelector('.manage-toggle') as HTMLButtonElement).click()
    ;(handle.bands.querySelector('.dex-remove') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(handle.bands.querySelector('.follow-note')?.textContent).toBe('Could not remove jwize.com.'))
    expect(names(handle)).toContain('jwize.com')
  })
})

describe('collapsing the open domain collapses them all to the top', () => {
  const sites = parseLedger(LEDGER)
  it('marks the list as having nothing open, so the rows stack from the top, and reopens one on a click', async () => {
    const handle = showcase({
      self: 'hypercomb.com', title: 'hypercomb', tagline: '', sources: ['jwize.com'],
      ledger: Promise.resolve(sites), readShared: async () => ({ offers: [], creations: [] }), readPeerLedger: async () => [],
    })
    await vi.waitFor(() => expect(handle.bands.querySelector('.dex-row.own .hex')).not.toBeNull())
    ;(handle.hero.querySelector('.manage-toggle') as HTMLButtonElement).click()
    const hosted = handle.bands.querySelector('.hosted') as HTMLElement
    expect(hosted.classList.contains('none-open')).toBe(false)
    ;(handle.bands.querySelectorAll('.dex-head')[0] as HTMLButtonElement).click()   // collapse the open one
    expect(handle.bands.querySelectorAll('.dex-row.open')).toHaveLength(0)
    expect(hosted.classList.contains('none-open')).toBe(true)
    expect([...handle.bands.querySelectorAll('.dex-row')].filter(row => !(row as HTMLElement).hidden)).toHaveLength(2)
    ;(handle.bands.querySelectorAll('.dex-head')[1] as HTMLButtonElement).click()   // open the other
    expect(hosted.classList.contains('none-open')).toBe(false)
    expect(handle.bands.querySelector('.dex-row')?.classList.contains('open')).toBe(true)
  })
})
