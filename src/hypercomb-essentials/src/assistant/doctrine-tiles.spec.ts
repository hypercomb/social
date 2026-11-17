// doctrine-tiles.spec.ts — the codex laid out as the hive's doctrine tiles.
// Every name is its own (notes are read by word), every note is a codex line
// exactly, parents come before what they hold, and saying it twice adds nothing.

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseCodex } from './anatomy/codex.js'
import { doctrineTilePlan, makeDoctrineTiles, reconcileDoctrine, ruleTileName, tierTileName, type DoctrineHeldLine, type DoctrineTileDeps } from './doctrine-tiles.js'

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
    expect(outcome).toEqual({ ok: true, made: notes, kept: 0, differs: [] })
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

// SAYING IT AGAIN, against what the tiles hold now: by tier number and rule
// id, never by a tile's name.
describe('laid against what the hive holds', () => {
  /** The hive's tiles as the plan lays them, as held lines. */
  const laid = (): DoctrineHeldLine[] => doctrineTilePlan(tiers)
    .filter(entry => entry.note !== undefined)
    .map(entry => ({ path: entry.path, kind: entry.path.length === 2 ? 'tier' as const : 'rule' as const, line: entry.note! }))

  it('lays nothing when the hive holds every tier and rule', () => {
    const all = laid()
    const again = reconcileDoctrine(tiers, all)
    expect(again.plan).toEqual([{ path: ['doctrine'] }])
    expect(again.held).toBe(all.length)
    expect(again.differs).toEqual([])
    expect(again.missing).toEqual([])
  })

  it('never lays a rule the hive holds under another name or in other words: its id is taken', () => {
    const all = laid()
    const first = all.findIndex(line => line.kind === 'rule')
    const id = /^[A-Z]\d+/.exec(all[first]!.line)![0]
    const moved = all.map((line, i) => i === first
      ? { ...line, path: [...line.path.slice(0, -1), 'renamed-by-hand'], line: `${id}: the hive's own wording of this rule` }
      : line)
    const again = reconcileDoctrine(tiers, moved)
    expect(again.plan).toEqual([{ path: ['doctrine'] }])
    expect(again.differs).toEqual([id])
    expect(again.missing).toEqual([])
  })

  it('lays a rule the package added since, into the tier that carries its number, whatever that tile is named', () => {
    const all = laid()
    const last = all.length - 1
    const gone = all[last]!
    const tierPath = gone.path.slice(0, -1)
    const renamed = all.slice(0, last).map(line => line.path.slice(0, 2).join('/') === tierPath.join('/')
      ? { ...line, path: ['doctrine', 'my-own-tier-name', ...line.path.slice(2)] }
      : line)
    const again = reconcileDoctrine(tiers, renamed)
    expect(again.missing).toEqual([/^[A-Z]\d+/.exec(gone.line)![0]])
    expect(again.plan).toEqual([{ path: ['doctrine'] }, { path: ['doctrine', 'my-own-tier-name', gone.path[2]!], note: gone.line }])
  })

  it('tells a new rule apart from a standing tile its opening names', () => {
    const all = laid()
    const last = all.length - 1
    const gone = all[last]!
    const id = /^[A-Z]\d+/.exec(gone.line)![0]
    // Another rule now sits on the tile the missing rule's opening would name.
    const squatted = [...all.slice(0, last), { path: gone.path, kind: 'rule' as const, line: 'Z99: another rule on that tile' }]
    const entry = reconcileDoctrine(tiers, squatted).plan[1]!
    expect(entry.path[2]).toBe(`${gone.path[2]}-${id.toLowerCase()}`)
    expect(entry.note).toBe(gone.line)
  })

  it('counts what it left and names what reads differently', async () => {
    const w = world()
    const all = laid()
    const outcome = await makeDoctrineTiles(tiers, w.deps, all.map((line, i) => i === 0 ? { ...line, line: `${line.line} and more` } : line))
    expect(outcome).toEqual({ ok: true, made: 0, kept: all.length, differs: [`@${tiers[0]!.index}`] })
    expect(w.notes.size).toBe(0)
  })

  it('gives a standing tile that holds other notes the rule line too', async () => {
    const w = world()
    const plan = doctrineTilePlan(tiers)
    const rule = plan.find(entry => entry.path.length === 3)!
    w.notes.set(rule.path.join('/'), ['a thought about this rule'])
    await makeDoctrineTiles(tiers, w.deps)
    expect(w.notes.get(rule.path.join('/'))).toEqual(['a thought about this rule', rule.note])
  })
})
