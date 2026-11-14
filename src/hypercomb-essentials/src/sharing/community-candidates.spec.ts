import { describe, expect, it } from 'vitest'
import { communityCandidates } from './community-candidates.js'

const ME = 'a'.repeat(64)
const THEM = 'b'.repeat(64)
const OTHER = 'c'.repeat(64)

describe('what the community window can promote', () => {
  it('lists what is on in a followed domain beside your own lineages', () => {
    const tiles = communityCandidates(
      [{ pubkey: ME, lineage: 'dylan' }],
      [{ name: 'meetups', pubkey: THEM, lineage: 'work/meetups', hosts: ['meetups.hypercomb.com', 'hypercomb.com'] }],
      [],
    )
    expect(tiles.map(tile => tile.name)).toEqual(['dylan', 'meetups'])
    expect(tiles[1]).toMatchObject({ pubkey: THEM, lineage: 'work/meetups', hosts: ['hypercomb.com', 'meetups.hypercomb.com'], shared: false })
    expect(tiles[0]!.hosts).toEqual([])
  })

  it('shows one tile per instance when the same name is on different domains', () => {
    const tiles = communityCandidates([], [
      { name: 'agenda', pubkey: THEM, lineage: 'agenda', hosts: ['hypercomb.com'] },
      { name: 'agenda', pubkey: OTHER, lineage: 'agenda', hosts: ['jwize.com'] },
    ], [])
    expect(tiles).toHaveLength(2)
    expect(tiles.every(tile => tile.shared)).toBe(true)
    expect(tiles.map(tile => tile.hosts[0])).toEqual(['hypercomb.com', 'jwize.com'])
  })

  it('keeps one tile for an instance several domains serve, naming them all', () => {
    const tiles = communityCandidates([], [
      { name: 'hosting', pubkey: THEM, lineage: 'hosting', hosts: ['hosting.hypercomb.com'] },
      { name: 'hosting', pubkey: THEM, lineage: 'hosting', hosts: ['host-setup.hypercomb.com'] },
    ], [])
    expect(tiles).toHaveLength(1)
    expect(tiles[0]).toMatchObject({ shared: false, hosts: ['host-setup.hypercomb.com', 'hosting.hypercomb.com'] })
  })

  it('keeps a tile the record names even when no list knows it, so it can be turned off', () => {
    const tiles = communityCandidates([], [], [{ pubkey: THEM, lineage: 'work/meetings' }])
    expect(tiles).toEqual([{ pubkey: THEM, lineage: 'work/meetings', name: 'meetings', hosts: [], shared: false }])
  })

  it('does not double a lineage that is both your own and on in a domain', () => {
    const tiles = communityCandidates(
      [{ pubkey: ME, lineage: 'dylan' }],
      [{ name: 'dylan', pubkey: ME, lineage: 'dylan', hosts: ['jwize.com'] }],
      [{ pubkey: ME, lineage: 'dylan' }],
    )
    expect(tiles).toHaveLength(1)
    expect(tiles[0]!.hosts).toEqual(['jwize.com'])
  })
})
