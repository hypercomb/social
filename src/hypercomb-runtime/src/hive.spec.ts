// hive.spec.ts — a hive loads what its faces name and what those read, in the
// tier it says; the rest waits, and depth decides how much waits.

import { describe, expect, it } from 'vitest'
import { beeClassesOfDocs } from './arrival-plan'
import { parseHive, resolveHive } from './hive'

const sig = (c: string): string => c.repeat(64)

const docs = {
  bees: {
    [sig('a')]: { className: 'SiteViewDrone', deps: { link: '@x.com/LinkService' } },
    [sig('b')]: { className: 'LinkService' },
    [sig('c')]: { className: 'ChatDrone', deps: { link: '@x.com/LinkService' } },
    [sig('d')]: { className: 'GameDrone' },
    [sig('e')]: { className: 'ShellBee' },
  },
}
const classes = new Map(beeClassesOfDocs(docs))
const all = new Set([sig('a'), sig('b'), sig('c'), sig('d'), sig('e')])

const hive = (extra: Record<string, unknown> = {}) =>
  parseHive({ name: 'h', package: sig('1'), core: sig('2'), arrival: ['SiteViewDrone'], ...extra })!

describe('parseHive', () => {
  it('reads a hive and defaults depth', () => {
    const h = hive()
    expect(h.arrival).toEqual(['SiteViewDrone'])
    expect(h.depth).toBe(1)
  })

  it('names faces by class whether given a key or a class', () => {
    expect(hive({ arrival: ['@x.com/SiteViewDrone'] }).arrival).toEqual(['SiteViewDrone'])
  })

  it('is no hive without a face, or with a package or core that is not a signature', () => {
    expect(parseHive({ package: sig('1'), core: sig('2'), arrival: [] })).toBeNull()
    expect(parseHive({ package: 'x', core: sig('2'), arrival: ['A'] })).toBeNull()
    expect(parseHive({ package: sig('1'), core: 'x', arrival: ['A'] })).toBeNull()
    expect(parseHive(null)).toBeNull()
  })

  it('drops tiers that are not 0, 1 or 2', () => {
    expect(hive({ tiers: { ChatDrone: 1, GameDrone: 7 } }).tiers).toEqual({ ChatDrone: 1 })
  })
})

describe('resolveHive', () => {
  it('loads the face and what it reads now; everything else is passive at depth 0', () => {
    const r = resolveHive(hive({ depth: 0 }), classes, all)
    expect([...r.now].sort()).toEqual([sig('a'), sig('b')])
    expect(r.idle.size).toBe(0)
    expect([...r.passive].sort()).toEqual([sig('c'), sig('d'), sig('e')])
  })

  it('loads unreached bees only at depth 2', () => {
    const r = resolveHive(hive({ depth: 2 }), classes, all)
    expect([...r.idle].sort()).toEqual([sig('c'), sig('d'), sig('e')])
    expect(r.passive.size).toBe(0)
  })

  it('puts a tier-1 face at idle when depth allows, passive when it does not', () => {
    const tiers = { ChatDrone: 1 }
    const arrival = ['SiteViewDrone', 'ChatDrone']
    expect([...resolveHive(hive({ arrival, tiers, depth: 1 }), classes, all).idle]).toEqual([sig('c')])
    expect([...resolveHive(hive({ arrival, tiers, depth: 0 }), classes, all).passive]).toContain(sig('c'))
  })

  it('never makes a tier-0 bee wait on a later tier: a shared dependency takes the earliest', () => {
    const r = resolveHive(hive({ arrival: ['SiteViewDrone', 'ChatDrone'], tiers: { ChatDrone: 2 }, depth: 2 }), classes, all)
    expect(r.now.has(sig('b'))).toBe(true)
  })

  it('keeps critical bees now, even when excluded', () => {
    const r = resolveHive(hive({ depth: 0 }), classes, all, new Set([sig('e')]), new Set([sig('e')]))
    expect(r.now.has(sig('e'))).toBe(true)
  })

  it('leaves excluded bees out of every tier', () => {
    const r = resolveHive(hive({ depth: 2 }), classes, all, new Set([sig('d')]))
    for (const set of [r.now, r.idle, r.passive]) expect(set.has(sig('d'))).toBe(false)
  })

  it('reports a face the package does not carry', () => {
    const r = resolveHive(hive({ arrival: ['SiteViewDrone', 'ArcadeDrone'] }), classes, all)
    expect(r.missing).toEqual(['ArcadeDrone'])
    expect(r.now.has(sig('a'))).toBe(true)
  })
})
