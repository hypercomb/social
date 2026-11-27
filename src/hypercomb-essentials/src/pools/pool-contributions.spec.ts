// pools/pool-contributions.spec.ts : who leaves what in which pool, with fake
// lit tiles, fake contributions and a fake publish. Nothing reaches a host.

import { describe, expect, it } from 'vitest'
import type { LitTile } from './lit-tiles.js'
import type { OfferedPublishResult } from './offered-pool.js'
import {
  litPoolPreview,
  poolContributions,
  publishLitPools,
  registerPoolContribution,
  type LitPoolsDeps,
  type PoolContribution,
} from './pool-contributions.js'

const sigOf = (ch: string): string => ch.repeat(64)
const label = (word: string): PoolContribution['label'] => ({ key: `test.${word}`, one: `1 ${word}`, other: `{count} ${word}s` })

/** A contribution whose members are whatever sits under each lit route. */
const contributionOf = (
  meaning: string,
  carried: Record<string, string[]>,
  closure?: Record<string, string[]>,
): PoolContribution & { asked: string[][][] } => {
  const asked: string[][][] = []
  return {
    asked,
    meaning,
    label: label(meaning.split(':')[0] ?? meaning),
    membersOf: async routes => { asked.push(routes.map(route => [...route])); return routes.flatMap(route => carried[route.join('/')] ?? []) },
    ...(closure ? { closureOf: async (members: readonly string[]) => members.flatMap(member => closure[member] ?? []) } : {}),
  }
}

type Sent = { host: string; meaning: string; members: string[]; closure: string[] }

/** A hive with lit tiles, a tree under them, a named host and a publish that records what it was asked. */
const world = (over: Partial<LitPoolsDeps> & { failing?: string } = {}) => {
  const sent: Sent[] = []
  const lit: LitTile[] = [{ segments: ['notes'], branch: false }, { segments: ['recipes'], branch: true }]
  const tree: Record<string, string[]> = { recipes: ['soup', 'bread'] }
  let clock = 1000
  const deps: LitPoolsDeps = {
    host: () => 'content.example.com',
    lit: async () => lit,
    childrenOf: async segments => tree[segments.join('/')] ?? [],
    contributions: () => [],
    publish: async (host, meaning, members, options): Promise<OfferedPublishResult> => {
      sent.push({ host, meaning, members: [...members], closure: [...(options?.closure ?? [])] })
      return meaning === over.failing
        ? { ok: false, reason: `${host} could not be reached` }
        : { ok: true, host, meaning, count: members.length }
    },
    now: () => clock++,
    ...over,
  }
  return { deps, sent }
}

describe('registerPoolContribution', () => {
  it('keeps one contribution per meaning, the later one in the place of the first', () => {
    const first = contributionOf('recipe:template', {})
    const second = contributionOf('recipe:template', {})
    const other = contributionOf('mail:template', {})
    registerPoolContribution(first)
    registerPoolContribution(other)
    registerPoolContribution(second)
    expect(poolContributions()).toEqual([second, other])
  })
})

describe('litPoolPreview', () => {
  it('counts the lit routes and what each pool would hold, and sends nothing', async () => {
    const recipes = contributionOf('recipe:template', { 'recipes/soup': [sigOf('a'), sigOf('a')], 'recipes/bread': [sigOf('b')], notes: ['not a signature'] })
    const mail = contributionOf('mail:template', {})
    const { deps, sent } = world({ contributions: () => [recipes, mail] })

    expect(await litPoolPreview(deps)).toEqual({
      lit: 4,
      pools: [
        { meaning: 'recipe:template', count: 2, label: recipes.label },
        { meaning: 'mail:template', count: 0, label: mail.label },
      ],
    })
    expect(recipes.asked).toEqual([[['notes'], ['recipes'], ['recipes', 'soup'], ['recipes', 'bread']]])
    expect(sent).toEqual([])
  })

  it('caps a pool at what one host offers, and counts a contribution that throws as none', async () => {
    const many = Array.from({ length: 70 }, (_, at) => at.toString(16).padStart(64, '0'))
    const broken: PoolContribution = { meaning: 'mail:template', label: label('mail'), membersOf: async () => { throw new Error('cold') } }
    const { deps } = world({ contributions: () => [contributionOf('recipe:template', { notes: many }), broken] })
    expect((await litPoolPreview(deps)).pools.map(pool => pool.count)).toEqual([64, 0])
  })

  it('answers zero lit when the lit tiles cannot be read', async () => {
    const { deps } = world({ lit: async () => { throw new Error('cold') }, contributions: () => [contributionOf('recipe:template', {})] })
    expect(await litPoolPreview(deps)).toEqual({ lit: 0, pools: [{ meaning: 'recipe:template', count: 0, label: label('recipe') }] })
  })
})

describe('publishLitPools', () => {
  it('leaves every pool on the named host, members once each with what they name', async () => {
    const recipes = contributionOf('recipe:template',
      { 'recipes/soup': [sigOf('a')], 'recipes/bread': [sigOf('b'), sigOf('a')] },
      { [sigOf('a')]: [sigOf('c')], [sigOf('b')]: [sigOf('c'), sigOf('d')] })
    const mail = contributionOf('mail:template', { notes: [sigOf('e')] })
    const { deps, sent } = world({ contributions: () => [recipes, mail] })

    expect(await publishLitPools(deps)).toEqual({
      at: 1000,
      ok: true,
      host: 'example.com',
      pools: [{ meaning: 'recipe:template', count: 2 }, { meaning: 'mail:template', count: 1 }],
    })
    expect(sent).toEqual([
      { host: 'example.com', meaning: 'recipe:template', members: [sigOf('a'), sigOf('b')], closure: [sigOf('c'), sigOf('d')] },
      { host: 'example.com', meaning: 'mail:template', members: [sigOf('e')], closure: [] },
    ])
    // The lit routes are expanded once and handed to every contribution.
    expect(recipes.asked).toHaveLength(1)
    expect(mail.asked).toEqual(recipes.asked)
  })

  it('is not ok when one pool fails: the reason is the first failure, the others still publish', async () => {
    const recipes = contributionOf('recipe:template', { notes: [sigOf('a')] })
    const mail = contributionOf('mail:template', { notes: [sigOf('e')] })
    const { deps, sent } = world({ contributions: () => [recipes, mail], failing: 'recipe:template' })

    expect(await publishLitPools(deps)).toEqual({
      at: 1000,
      ok: false,
      host: 'example.com',
      pools: [{ meaning: 'mail:template', count: 1 }],
      reason: 'example.com could not be reached',
    })
    expect(sent.map(one => one.meaning)).toEqual(['recipe:template', 'mail:template'])
  })

  it('withdraws a pool whose lit members are now none, without asking for a closure', async () => {
    const recipes = contributionOf('recipe:template', {}, { [sigOf('a')]: [sigOf('c')] })
    const { deps, sent } = world({ contributions: () => [recipes] })

    const done = await publishLitPools(deps)

    expect(done.ok).toBe(true)
    expect(done.pools).toEqual([{ meaning: 'recipe:template', count: 0 }])
    expect(sent).toEqual([{ host: 'example.com', meaning: 'recipe:template', members: [], closure: [] }])
  })

  it('says to name a host first when none is named, and asks nobody', async () => {
    const recipes = contributionOf('recipe:template', { notes: [sigOf('a')] })
    const { deps, sent } = world({ host: () => '', contributions: () => [recipes] })

    expect(await publishLitPools(deps)).toEqual({
      at: 1000,
      ok: false,
      host: '',
      pools: [],
      reason: 'Name your home domain first, in the hosts window. That is where your pools are left.',
    })
    expect(sent).toEqual([])
    expect(recipes.asked).toEqual([])
  })

  it('answers a contribution that throws with words, and still publishes the rest', async () => {
    const broken: PoolContribution = { meaning: 'recipe:template', label: label('recipe'), membersOf: async () => { throw new Error('cold') } }
    const mail = contributionOf('mail:template', { notes: [sigOf('e')] })
    const { deps } = world({ contributions: () => [broken, mail] })

    const done = await publishLitPools(deps)

    expect(done.ok).toBe(false)
    expect(done.reason).toBe('What the lit tiles carry for recipe:template could not be read, so it was left as it is on example.com.')
    expect(done.pools).toEqual([{ meaning: 'mail:template', count: 1 }])
  })

  it('never publishes a pool whose contribution could not read a lit tile: what is published is left as it is', async () => {
    // A contribution that knows a lit tile could not be read says so by throwing. Nothing is sent and nothing is cleared.
    const unread: PoolContribution = { meaning: 'recipe:entry', label: label('recipe'), membersOf: async () => { throw new Error('a lit tile could not be read') } }
    const { deps, sent } = world({ contributions: () => [unread] })
    const done = await publishLitPools(deps)
    expect(done).toMatchObject({ ok: false, host: 'example.com', pools: [] })
    expect(sent).toEqual([])
  })

  /** A history: a layer for each route in `layers`, a head known but not readable yet for each in `cold`, none for any other. */
  const historyOf = (
    layers: Record<string, { name?: string; children?: readonly string[] }>,
    cold: readonly string[] = [],
    bySig: Record<string, { name?: string }> = {},
  ): NonNullable<LitPoolsDeps['history']> => ({
    sign: async lineage => lineage.explorerSegments().join('/'),
    currentLayerAt: async (locationSig, stats) => {
      if (cold.includes(locationSig)) { if (stats) stats.cold = true; return null }
      return layers[locationSig] ?? null
    },
    getLayerBySig: async sig => bySig[sig] ?? null,
    commitLayer: async () => '',
  })

  it('a lit tile that could not be read is not a tile that holds nothing: no pool is cleared or shortened on its word', async () => {
    // These contributions know nothing of a tile that could not be read: they answer what they could read.
    const recipes = contributionOf('recipe:template', { 'recipes/soup': [sigOf('a')] })
    const mail = contributionOf('mail:template', {})
    const history = historyOf({ notes: { name: 'notes' }, recipes: { name: 'recipes' }, 'recipes/soup': { name: 'soup' } }, ['recipes/bread'])
    const { deps, sent } = world({ contributions: () => [recipes, mail], history })

    const done = await publishLitPools(deps)

    expect(done).toEqual({
      at: 1000,
      ok: false,
      host: 'example.com',
      pools: [],
      reason: '"recipes/bread" could not be read just now, so what example.com holds was left as it is. Publish again in a moment.',
    })
    // Neither the shorter recipe list nor the cleared mail key reached the host.
    expect(sent).toEqual([])
    expect(recipes.asked).toEqual([])
  })

  it('a lit branch with a tile under it that cannot be named yet could not be read', async () => {
    const recipes = contributionOf('recipe:template', { 'recipes/soup': [sigOf('a')] })
    // The branch lists two tiles. Only one is here to be named, so the walk under it saw one where there are two.
    const history = historyOf(
      { notes: { name: 'notes', children: [sigOf('8')] }, recipes: { name: 'recipes', children: [sigOf('1'), sigOf('2')] }, 'recipes/soup': { name: 'soup' } },
      [],
      { [sigOf('1')]: { name: 'soup' } },
    )
    const { deps, sent } = world({ contributions: () => [recipes], childrenOf: async segments => segments.join('/') === 'recipes' ? ['soup'] : [], history })

    const done = await publishLitPools(deps)

    expect(done.ok).toBe(false)
    expect(done.reason).toBe('"recipes" could not be read just now, so what example.com holds was left as it is. Publish again in a moment.')
    expect(sent).toEqual([])
  })

  it('a lit tile with no layer at all holds nothing: its pool is still withdrawn, and a tile lit on its own is not asked about its children', async () => {
    const recipes = contributionOf('recipe:template', {})
    // `notes` is lit on its own: a tile under it that cannot be named is not lit, and no reason to refuse.
    const history = historyOf({ notes: { name: 'notes', children: [sigOf('8')] } })
    const { deps, sent } = world({ contributions: () => [recipes], history })

    const done = await publishLitPools(deps)

    expect(done.ok).toBe(true)
    expect(sent).toEqual([{ host: 'example.com', meaning: 'recipe:template', members: [], closure: [] }])
  })

  it('a history that fails to answer for a lit tile did not read it', async () => {
    const recipes = contributionOf('recipe:template', {})
    const history = { ...historyOf({}), currentLayerAt: async () => { throw new Error('down') } }
    const { deps, sent } = world({ contributions: () => [recipes], history })
    expect((await publishLitPools(deps)).ok).toBe(false)
    expect(sent).toEqual([])
  })

  it('stamps the result when it finished', async () => {
    const { deps } = world({ contributions: () => [contributionOf('recipe:template', {})] })
    expect((await publishLitPools(deps)).at).toBe(1000)
    expect((await publishLitPools(deps)).at).toBe(1001)
  })
})
