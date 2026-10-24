// hypercomb-shim/src/bootstrap/showcase.spec.ts — a domain's root shows its hives.
//
// The ledger says which hives are open on which domain; each domain is a band,
// this door's own first. Every publish of one name is ONE tile on the page:
// identical heads are one version however many domains or people carry it,
// and this domain's version is pinned first in the tile's list.

import { describe, expect, it, vi } from 'vitest'
import { aggregate, aggregateMatches, bandZones, coverOf, ledgerPublishes, ownersLabel, parseLedger,
  sharedPublishes, showcase } from './showcase'
import { parseWelcome } from './welcome'

// Pictures are asked of real doors; here every hive wears its cover.
vi.mock('./tile-picture', () => ({ tilePicture: async () => null, pictureOrigins: () => [] }))

const sig = (char: string): string => char.repeat(64)

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
  const names = (bands: HTMLElement, zone: string): string[] =>
    [...[...bands.querySelectorAll('.band')].find(band => band.querySelector('h2')?.textContent === zone)
      ?.querySelectorAll('.hex-name') ?? []].map(name => name.textContent ?? '')
  const sites = parseLedger(LEDGER)

  it('draws each name once, and redraws when the ledger is read again', async () => {
    const { bands, refresh } = showcase({
      self: 'hypercomb.com', title: 'hypercomb', tagline: '', sources: [],
      ledger: Promise.resolve(sites), readShared: async () => ({ offers: [], creations: [] }),
    })
    await vi.waitFor(() => expect(names(bands, 'hypercomb.com')).toEqual(['camelflage', 'dylan']))
    expect(names(bands, 'jwize.com')).toEqual([])
    const jwize = [...bands.querySelectorAll('.band')].find(band => band.querySelector('h2')?.textContent === 'jwize.com')!
    expect(jwize.querySelector('.band-empty')?.textContent).toBe('Its one hive is shown above.')

    // camelflage is unpublished; a newer read lands before an older one.
    let late: (value: typeof sites) => void = () => {}
    refresh(new Promise(resolve => { late = resolve }))
    refresh(Promise.resolve(sites.filter(site => site.lineage !== 'camelflage')))
    await vi.waitFor(() => expect(names(bands, 'hypercomb.com')).toEqual(['dylan']))
    late(sites)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(names(bands, 'hypercomb.com')).toEqual(['dylan'])
  })

  it('opens a tile\'s versions, this domain\'s pinned first, and closes on Escape', async () => {
    const { hero, bands } = showcase({
      self: 'hypercomb.com', title: 'hypercomb', tagline: '', sources: [],
      ledger: Promise.resolve(sites),
      readShared: async zone => ({ offers: zone === 'jwize.com' ? [offer('dylan', 'jwize.com', sig('c'), sig('9'))] : [], creations: [] }),
    })
    document.body.append(hero, bands)
    const tile = await vi.waitFor(() => {
      const found = [...bands.querySelectorAll<HTMLButtonElement>('button.hex')].find(button => button.textContent?.includes('dylan'))
      expect(found?.querySelector('.hex-owners')?.textContent).toBe('2')
      return found!
    })
    tile.click()
    const sheet = hero.querySelector('.versions-backdrop') as HTMLElement
    expect(sheet.hidden).toBe(false)
    const rows = [...sheet.querySelectorAll('.version')]
    expect(rows).toHaveLength(2)
    expect(rows[0]!.classList.contains('pinned')).toBe(true)
    expect(rows[0]!.querySelector('.version-tag')?.textContent).toBe('On this domain')
    expect(rows[0]!.querySelector<HTMLAnchorElement>('.version-visit')!.href).toBe('https://dylan.hypercomb.com/')
    expect(rows[1]!.querySelector('.version-tag')?.textContent).toBe('Another version')
    sheet.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(sheet.hidden).toBe(true)
    hero.remove()
    bands.remove()
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
