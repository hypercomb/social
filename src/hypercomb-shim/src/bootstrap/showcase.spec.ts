// hypercomb-shim/src/bootstrap/showcase.spec.ts — a domain's root shows its hives.
//
// The ledger says which hives are open on which domain; each domain is a band,
// this door's own first; a domain's pools add what the ledger did not name.

import { describe, expect, it, vi } from 'vitest'
import { coverOf, ledgerBands, parseLedger, showcase, tileMatches, withShared } from './showcase'
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
      publishers: [{ pubkey: sig('a'), head: sig('1'), primary: true }] },
    { host: 'camelflage.hypercomb.com', title: 'camelflage', lineage: 'camelflage',
      hosts: [{ host: 'camelflage.hypercomb.com' }], publishers: [{ pubkey: sig('a'), head: sig('2') }] },
    { host: 'Install:Essentials', title: 'not a host', lineage: 'install:essentials',
      publishers: [{ pubkey: sig('a'), head: sig('3') }] },
  ],
}

describe('parseLedger — the ledger is data', () => {
  it('keeps hosts that are hostnames and the head a publisher verified', () => {
    const sites = parseLedger(LEDGER)
    expect(sites.map(site => site.lineage)).toEqual(['hypercomb', 'jwize.com', 'dylan', 'camelflage'])
    expect(sites[0]!.head).toBe('')
    expect(sites[2]).toMatchObject({ hosts: ['dylan.jwize.com', 'dylan.hypercomb.com'], head: sig('1'), pubkey: sig('a') })
  })

  it('reads nothing from anything that is not a ledger', () => {
    expect(parseLedger('<html>')).toEqual([])
    expect(parseLedger({ sites: 'no' })).toEqual([])
    expect(parseLedger(null)).toEqual([])
  })
})

describe('ledgerBands — one band per domain, this door first', () => {
  it('shows each hive under every domain it is open on, at that domain\'s address', () => {
    const bands = ledgerBands(parseLedger(LEDGER), 'hypercomb.com')
    expect(bands.map(band => band.zone)).toEqual(['hypercomb.com', 'jwize.com'])
    expect(bands[0]!.tiles.map(tile => tile.href)).toEqual(['https://camelflage.hypercomb.com/', 'https://dylan.hypercomb.com/'])
    expect(bands[1]!.tiles.map(tile => tile.address)).toEqual(['dylan.jwize.com'])
  })

  it('keeps this door\'s band when nothing is published on it', () => {
    expect(ledgerBands([], 'localhost:4270')).toEqual([{ zone: 'localhost:4270', tiles: [] }])
  })
})

describe('withShared — a domain\'s pools add what the ledger did not name', () => {
  const band = ledgerBands(parseLedger(LEDGER), 'hypercomb.com')[0]!
  const offer = (lineage: string, head: string) => ({ kind: 'host:offering' as const, title: lineage, lineage,
    route: `https://${lineage}.hypercomb.com/`, pubkey: sig('a'), head, index: {}, doors: [] })

  it('adds an offered hive once, and shared creations after the hives', () => {
    const merged = withShared(band, [offer('dylan', sig('9')), offer('susan', sig('4'))], [{
      kind: 'host:creation', meaning: 'text-theme', key: 'amber', location: sig('5'), pubkey: sig('b'),
      title: 'Amber', host: 'hypercomb.com', head: sig('6'), payload: sig('7'), index: {},
    }])
    expect(merged.tiles.map(tile => `${tile.kind}:${tile.title}`)).toEqual(['hive:camelflage', 'hive:dylan', 'hive:susan', 'creation:Amber'])
    expect(merged.tiles.find(tile => tile.title === 'dylan')!.head).toBe(sig('1'))
    // A creation opens itself, never the domain's root (this very page).
    expect(merged.tiles.find(tile => tile.kind === 'creation')!.href).toBe(`https://hypercomb.com/${sig('6')}`)
  })

  it('finds a tile by its name, its address or its domain', () => {
    const [camelflage] = band.tiles
    expect(tileMatches(camelflage!, band.zone, ['camel'])).toBe(true)
    expect(tileMatches(camelflage!, band.zone, ['hypercomb.com'])).toBe(true)
    expect(tileMatches(camelflage!, band.zone, ['susan'])).toBe(false)
  })
})

describe('showcase — the page is what is published now', () => {
  const names = (bands: HTMLElement, zone: string): string[] =>
    [...[...bands.querySelectorAll('.band')].find(band => band.querySelector('h2')?.textContent === zone)
      ?.querySelectorAll('.hex-name') ?? []].map(name => name.textContent ?? '')

  it('draws the hives the ledger names, and redraws when it is read again', async () => {
    const sites = parseLedger(LEDGER)
    const { bands, refresh } = showcase({
      self: 'hypercomb.com', title: 'hypercomb', tagline: '', sources: [],
      ledger: Promise.resolve(sites), readShared: async () => ({ offers: [], creations: [] }),
    })
    await vi.waitFor(() => expect(names(bands, 'hypercomb.com')).toEqual(['camelflage', 'dylan']))
    expect(names(bands, 'jwize.com')).toEqual(['dylan'])

    // camelflage is unpublished; a newer read lands before an older one.
    let late: (value: typeof sites) => void = () => {}
    refresh(new Promise(resolve => { late = resolve }))
    refresh(Promise.resolve(sites.filter(site => site.lineage !== 'camelflage')))
    await vi.waitFor(() => expect(names(bands, 'hypercomb.com')).toEqual(['dylan']))
    late(sites)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(names(bands, 'hypercomb.com')).toEqual(['dylan'])
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
