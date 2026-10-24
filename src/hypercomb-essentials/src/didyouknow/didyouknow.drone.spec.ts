// didyouknow/didyouknow.drone.spec.ts — the drone teaches the notes desk the one
// rule the game needs, and the rule follows the PAGE.
//
// The game's tile is named for its layer, so "is this the game's tile?" cannot
// be answered without the page you stand on. The rule the drone registers asks
// the lineage at the moment the desk asks; a drone that handed the desk a stale
// or empty page would hide nothing on any layer below the root and no other
// spec would notice.

import { describe, expect, it, vi } from 'vitest'

const world = vi.hoisted(() => {
  const state = {
    page: [] as string[],
    waiting: new Map<string, ((value: unknown) => void)[]>(),
    registry: new Map<string, unknown>(),
  }
  ;(window as unknown as { ioc: unknown }).ioc = {
    get: (key: string) => state.registry.get(key),
    register: (key: string, value: unknown) => { state.registry.set(key, value) },
    whenReady: (key: string, cb: (value: unknown) => void) => { state.waiting.set(key, [...(state.waiting.get(key) ?? []), cb]) },
  }
  state.registry.set('@hypercomb.social/Lineage', { explorerSegments: () => [...state.page] })
  return state
})

vi.mock('./didyouknow.service.js', () => ({ DidYouKnow: class { start(): Promise<never> { throw new Error('not under test') } } }))

const { concealsOnThisPage } = await import('./didyouknow.drone.js')

const taught = (): ((cell: string, texts: readonly string[]) => boolean)[] => {
  const rules: ((cell: string, texts: readonly string[]) => boolean)[] = []
  const deskLike = { concealAuthorsWhen: (rule: (cell: string, texts: readonly string[]) => boolean) => { rules.push(rule) } }
  for (const cb of world.waiting.get('@diamondcoreprocessor.com/SwarmNotes') ?? []) cb(deskLike)
  return rules
}

describe('the rule the drone teaches the notes desk', () => {
  it('is registered once, as the one named rule', () => {
    expect(taught()).toEqual([concealsOnThisPage])
  })

  it('conceals the root\'s tile at the root, and nothing else there', () => {
    world.page = []
    expect(concealsOnThisPage('did-you-know', ['an idea'])).toBe(true)
    expect(concealsOnThisPage('did-you-know-lecture', ['an idea'])).toBe(false)
    expect(concealsOnThisPage('lectures', ['an idea'])).toBe(false)
  })

  it('follows the page: the same tile is the game on its own layer and an ordinary tile elsewhere', () => {
    world.page = ['lecture']
    expect(concealsOnThisPage('did-you-know-lecture', ['an idea'])).toBe(true)
    expect(concealsOnThisPage('did-you-know', ['an idea'])).toBe(false)
    world.page = ['other']
    expect(concealsOnThisPage('did-you-know-lecture', ['an idea'])).toBe(false)
    world.page = ['lecture', 'biology']
    expect(concealsOnThisPage('did-you-know-lecture-biology', ['an idea'])).toBe(true)
    expect(concealsOnThisPage('did-you-know-lecture', ['an idea'])).toBe(false)
  })

  it('stops concealing a layer once its own tile carries the reveal', () => {
    world.page = ['lecture']
    expect(concealsOnThisPage('did-you-know-lecture', ['an idea', 'Revealed · 1 idea\n1. an idea — Ana'])).toBe(false)
  })

  it('reads the page when asked, not when the drone was built', () => {
    world.page = ['lecture']
    const asked = concealsOnThisPage
    expect(asked('did-you-know-lecture', [])).toBe(true)
    world.page = []
    expect(asked('did-you-know-lecture', [])).toBe(false)
  })
})
