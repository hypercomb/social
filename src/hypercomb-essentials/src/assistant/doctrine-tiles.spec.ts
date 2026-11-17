// doctrine-tiles.spec.ts — the codex laid out as the hive's doctrine tiles.
// Every name is its own (notes are read by word), every note is a codex line
// exactly, parents come before what they hold, and saying it twice adds nothing.

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseCodex } from './anatomy/codex.js'
import { doctrineTilePlan, makeDoctrineTiles, ruleTileName, tierTileName, type DoctrineTileDeps } from './doctrine-tiles.js'

const file = resolve(__dirname, '../../../documentation/doctrine.codex')
const tiers = parseCodex(existsSync(file) ? readFileSync(file, 'utf8') : '')

const world = () => {
  const stands = new Set<string>()
  const notes = new Map<string, string[]>()
  const created: string[] = []
  const deps: DoctrineTileDeps = {
    segments: () => [],
    create: async path => { created.push(path); stands.add(path) },
    notesAt: async segments => (notes.get(segments.join('/')) ?? []).map(text => ({ text })),
    addNote: async (parent, tile, text) => {
      const key = [...parent, tile].join('/')
      notes.set(key, [...(notes.get(key) ?? []), text])
    },
  }
  return { deps, created, notes }
}

describe('the plan', () => {
  it('lays a doctrine tile, a tile per tier, and a tile per rule, parents first', () => {
    const plan = doctrineTilePlan(tiers)
    expect(plan[0]).toEqual({ path: ['doctrine'] })
    expect(plan).toHaveLength(1 + tiers.length + tiers.reduce((sum, tier) => sum + tier.axioms.length, 0))
    plan.forEach((entry, at) => {
      if (entry.path.length > 1) expect(plan.slice(0, at).some(earlier => earlier.path.join('/') === entry.path.slice(0, -1).join('/'))).toBe(true)
    })
  })

  it('names every tile to be its own: tiers are doctrine-<tier>, rules open as the rule opens, none repeat', () => {
    const plan = doctrineTilePlan(tiers)
    expect(tierTileName(tiers[3]!)).toBe('doctrine-history')
    expect(ruleTileName('Nothing is rewritten and nothing is deleted. Change is')).toBe('nothing-is-rewritten-and-nothing-is')
    const paths = plan.map(entry => entry.path.join('/'))
    expect(new Set(paths).size).toBe(paths.length)
    expect(plan.every(entry => entry.path.every(name => /^[a-z0-9-]+$/.test(name)))).toBe(true)
  })

  it('tells two rules that open alike apart by their id', () => {
    const twin = parseCodex('@0 Twin\nA1: Alpha beta gamma delta epsilon zeta one.\nA2: Alpha beta gamma delta epsilon zeta two.')
    const names = doctrineTilePlan(twin).filter(entry => entry.path.length === 3).map(entry => entry.path[2])
    expect(names).toEqual(['alpha-beta-gamma-delta-epsilon-zeta', 'alpha-beta-gamma-delta-epsilon-zeta-a2'])
  })

  it('notes every tier with its header line and every rule with its codex line, exactly', () => {
    const plan = doctrineTilePlan(tiers)
    const history = plan.find(entry => entry.note?.startsWith('H2'))!
    expect(history.note).toBe(tiers[3]!.axioms.find(axiom => axiom.id === 'H2')!.line)
    expect(plan.find(entry => entry.path.join('/') === 'doctrine/doctrine-history')!.note).toBe(tiers[3]!.line)
  })
})

describe('laying it out', () => {
  it('creates every tile at the hive root and notes every tier and rule', async () => {
    const w = world()
    const outcome = await makeDoctrineTiles(tiers, w.deps)
    const notes = tiers.length + tiers.reduce((sum, tier) => sum + tier.axioms.length, 0)
    expect(outcome).toEqual({ ok: true, made: notes, kept: 0 })
    expect(w.created[0]).toBe('doctrine')
    expect(w.notes.size).toBe(notes)
    expect([...w.notes.keys()].every(key => key.startsWith('doctrine/doctrine-'))).toBe(true)
  })

  it('lays the doctrine only at the root, where it is read', async () => {
    const w = world()
    expect(await makeDoctrineTiles(tiers, { ...w.deps, segments: () => ['page'] })).toEqual({ ok: false, error: expect.stringContaining('root of the hive') })
    expect(w.created).toEqual([])
  })

  it('says nothing twice: a rule that already carries its note is left alone', async () => {
    const w = world()
    await makeDoctrineTiles(tiers, w.deps)
    const again = await makeDoctrineTiles(tiers, w.deps)
    expect(again).toMatchObject({ ok: true, made: 0 })
    expect([...w.notes.values()].every(list => list.length === 1)).toBe(true)
  })

  it('stops at a refused create and says why', async () => {
    const w = world()
    const deps: DoctrineTileDeps = { ...w.deps, create: async () => { throw Object.assign(new Error('x'), { name: 'RewoundCommitError' }) } }
    expect(await makeDoctrineTiles(tiers, deps)).toEqual({ ok: false, error: expect.stringContaining('viewing the past') })
    expect(await makeDoctrineTiles(tiers, null)).toEqual({ ok: false, error: 'the notes are not loaded' })
  })
})
