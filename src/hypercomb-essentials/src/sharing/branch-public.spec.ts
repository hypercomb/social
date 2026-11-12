import { describe, expect, it } from 'vitest'
import { branchPublicAt, placeKey, type BranchPublicDeps } from './branch-public.js'
import type { Showcase } from './showcase-record.js'

const ME = 'a'.repeat(64)
const ROOT = 'b'.repeat(64)

type World = {
  marks?: Record<string, readonly string[] | null>
  roots?: Record<string, string>
  showcases?: Record<string, Showcase | null | 'unreadable'>
  pubkey?: string
}

const deps = (world: World): BranchPublicDeps => ({
  hostsAt: async segments => {
    const at = (world.marks ?? {})[segments.join('/')]
    return at === undefined ? [] : at
  },
  publishedRoot: async (zone, lineage) => (world.roots ?? {})[`${zone}|${lineage}`] ?? null,
  showcase: async zone => {
    const said = (world.showcases ?? {})[zone]
    if (said === 'unreadable') throw new Error('could not read the showcase')
    return said ?? null
  },
  pubkey: async () => world.pubkey ?? ME,
})

const showcase = (zone: string, lineages: readonly string[], domains: readonly string[] = []): Showcase =>
  ({ zone, items: lineages.map(lineage => ({ pubkey: ME, lineage })), domains })

describe('branch public — public means published and in the community', () => {
  it('a place nothing above publishes is private', async () => {
    expect((await branchPublicAt(['kitchen', 'soup'], deps({}))).public).toBe(false)
  })

  it('published but not in the community is not public', async () => {
    const said = await branchPublicAt(['recipes'], deps({
      marks: { recipes: ['jwize.com'] },
      roots: { 'jwize.com|recipes': ROOT },
      showcases: { 'jwize.com': showcase('jwize.com', []) },
    }))
    expect(said).toEqual({ key: placeKey(['recipes']), public: false, lineage: 'recipes' })
  })

  it('in the showcase but not published is not public', async () => {
    const said = await branchPublicAt(['recipes'], deps({
      marks: { recipes: ['jwize.com'] },
      showcases: { 'jwize.com': showcase('jwize.com', ['recipes']) },
    }))
    expect(said.public).toBe(false)
  })

  it('published and turned on in the showcase is public, on that host', async () => {
    const said = await branchPublicAt(['recipes'], deps({
      marks: { recipes: ['jwize.com'] },
      roots: { 'jwize.com|recipes': ROOT },
      showcases: { 'jwize.com': showcase('jwize.com', ['recipes']) },
    }))
    expect(said).toEqual({ key: placeKey(['recipes']), public: true, lineage: 'recipes', zone: 'jwize.com' })
  })

  it('a domain shown in full counts as in the community', async () => {
    const said = await branchPublicAt(['recipes'], deps({
      marks: { recipes: ['jwize.com'] },
      roots: { 'jwize.com|recipes': ROOT },
      showcases: { 'jwize.com': showcase('jwize.com', [], ['jwize.com']) },
    }))
    expect(said.public).toBe(true)
  })

  it('a tile inside a public branch is public, through the nearest marked tile above it', async () => {
    const said = await branchPublicAt(['recipes', 'soup', 'miso'], deps({
      marks: { recipes: ['jwize.com'] },
      roots: { 'jwize.com|recipes': ROOT },
      showcases: { 'jwize.com': showcase('jwize.com', ['recipes']) },
    }))
    expect(said).toMatchObject({ key: placeKey(['recipes', 'soup', 'miso']), public: true, lineage: 'recipes' })
  })

  it('any one host with both is enough', async () => {
    const said = await branchPublicAt(['recipes'], deps({
      marks: { recipes: ['one.test', 'two.test'] },
      roots: { 'one.test|recipes': ROOT, 'two.test|recipes': ROOT },
      showcases: { 'one.test': showcase('one.test', []), 'two.test': showcase('two.test', ['recipes']) },
    }))
    expect(said).toMatchObject({ public: true, zone: 'two.test' })
  })

  it('never claims more than it can prove: a cold layer is unknown', async () => {
    const said = await branchPublicAt(['recipes', 'soup'], deps({ marks: { 'recipes/soup': null } }))
    expect(said.public).toBeNull()
  })

  it('an unreadable showcase is unknown, not private and not public', async () => {
    const said = await branchPublicAt(['recipes'], deps({
      marks: { recipes: ['jwize.com'] },
      roots: { 'jwize.com|recipes': ROOT },
      showcases: { 'jwize.com': 'unreadable' },
    }))
    expect(said.public).toBeNull()
  })

  it('another key\'s showcase item does not make your branch public', async () => {
    const said = await branchPublicAt(['recipes'], deps({
      marks: { recipes: ['jwize.com'] },
      roots: { 'jwize.com|recipes': ROOT },
      showcases: { 'jwize.com': { zone: 'jwize.com', items: [{ pubkey: 'c'.repeat(64), lineage: 'recipes' }], domains: [] } },
    }))
    expect(said.public).toBe(false)
  })

  it('without a signer nothing is public', async () => {
    const said = await branchPublicAt(['recipes'], deps({
      marks: { recipes: ['jwize.com'] },
      roots: { 'jwize.com|recipes': ROOT },
      showcases: { 'jwize.com': showcase('jwize.com', ['recipes']) },
      pubkey: '',
    }))
    expect(said.public).toBe(false)
  })
})
