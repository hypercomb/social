// sharing/publications-ledger.spec.ts
//
// THE LEDGER DRIVES THE PAGE — mechanical proof that the directory view's
// plates are exactly the publish state, nothing hand-maintained:
//
//   1. a site whose approved publisher has a verified head is a plate
//   2. head:null (approved, never published) is NO plate — and that is
//      also what unpublishing looks like from here
//   3. the primary publisher's publication names the plate; with the
//      primary unpublished, any approved publisher's does
//   4. the directory never lists itself (own host, own lineage)
//   5. newest shared first
//   6. a head that is not a 64-hex signature never becomes a plate, and
//      malformed ledger rows are dropped whole

import { describe, expect, it } from 'vitest'
import { shapePublications } from './publications-ledger.js'

const SIG_A = 'a'.repeat(64)
const SIG_B = 'b'.repeat(64)

const site = (over: Record<string, unknown> = {}) => ({
  host: 'revolucion.pluginthematrix.com',
  url: 'https://revolucion.pluginthematrix.com/',
  title: 'Revolución',
  lineage: 'revolucion',
  publishers: [
    { pubkey: 'e'.repeat(64), label: 'Jaime', primary: true, head: SIG_A, publishedAt: 200 },
  ],
  ...over,
})

describe('shapePublications', () => {
  it('a verified publication is a plate', () => {
    const cards = shapePublications([site()])
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      host: 'revolucion.pluginthematrix.com',
      title: 'Revolución',
      publisherLabel: 'Jaime',
      publishedAt: 200,
    })
  })

  it('head:null is no plate — approved is not published', () => {
    const cards = shapePublications([site({
      publishers: [{ pubkey: 'e'.repeat(64), label: 'Jaime', primary: true, head: null, publishedAt: null }],
    })])
    expect(cards).toHaveLength(0)
  })

  it('the primary names the plate; an unpublished primary yields to any published key', () => {
    const publishers = [
      { pubkey: 'a'.repeat(64), label: 'Second', head: SIG_B, publishedAt: 50 },
      { pubkey: 'e'.repeat(64), label: 'Jaime', primary: true, head: SIG_A, publishedAt: 200 },
    ]
    expect(shapePublications([site({ publishers })])[0].publisherLabel).toBe('Jaime')
    const primaryCold = publishers.map(p => p.primary ? { ...p, head: null, publishedAt: null } : p)
    expect(shapePublications([site({ publishers: primaryCold })])[0].publisherLabel).toBe('Second')
  })

  it('the directory never lists itself, by host or by lineage', () => {
    const directory = site({
      host: 'pluginthematrix.com',
      url: 'https://pluginthematrix.com/',
      title: 'Plugin the Matrix',
      lineage: 'pluginthematrix',
    })
    expect(shapePublications([directory, site()], { host: 'pluginthematrix.com' })).toHaveLength(1)
    expect(shapePublications([directory, site()], { lineage: 'pluginthematrix' })).toHaveLength(1)
  })

  it('newest shared first', () => {
    const older = site({ host: 'a.example', lineage: 'a', publishers: [
      { pubkey: 'e'.repeat(64), label: 'Jaime', primary: true, head: SIG_A, publishedAt: 100 },
    ] })
    const newer = site({ host: 'b.example', lineage: 'b', publishers: [
      { pubkey: 'e'.repeat(64), label: 'Jaime', primary: true, head: SIG_B, publishedAt: 300 },
    ] })
    expect(shapePublications([older, newer]).map(c => c.host)).toEqual(['b.example', 'a.example'])
  })

  it('a non-signature head and malformed rows never become plates', () => {
    const forged = site({ publishers: [
      { pubkey: 'e'.repeat(64), label: 'Jaime', primary: true, head: 'not-a-sig', publishedAt: 200 },
    ] })
    expect(shapePublications([forged, { host: 'x' }, null, 42])).toHaveLength(0)
  })

  it('a publisher with no label wears a shortened pubkey', () => {
    const cards = shapePublications([site({ publishers: [
      { pubkey: 'c'.repeat(64), label: '', primary: true, head: SIG_A, publishedAt: 1 },
    ] })])
    expect(cards[0].publisherLabel).toBe('c'.repeat(12) + '…')
  })
})
