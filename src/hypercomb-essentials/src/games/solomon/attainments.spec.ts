import { describe, expect, it } from 'vitest'
import {
  ATTAINMENTS, attainmentById, attainmentsOf, heldAttainments, itemsBoards, itemsProgress,
  useAttainment, useVerb, type AttainmentDef, type UseContext,
} from './attainments.js'
import { STORY_BOARDS } from './story.js'
import { storyRefs, type StoryFacts } from './story-when.js'
import type { SigilRequirement } from './labyrinth.js'
import { COMBAT_SKILLS } from './engine.js'

// A `StoryFacts` stub built from plain lists — never a real journey, never a
// real chamber; every predicate is a lookup against what the test declares.
function makeFacts(opts: { has?: readonly SigilRequirement[]; knows?: readonly string[]; done?: readonly string[] } = {}): StoryFacts {
  const knows = new Set(opts.knows ?? [])
  const done = new Set(opts.done ?? [])
  const has = opts.has ?? []
  return {
    has: requirement => has.some(candidate => JSON.stringify(candidate) === JSON.stringify(requirement)),
    knows: id => knows.has(id),
    done: ref => done.has(ref),
  }
}

const NO_FACTS = makeFacts()
const context = (over: Partial<UseContext> = {}): UseContext => ({ place: 'island', group: null, shrine: null, needle: null, ...over })

describe('ATTAINMENTS registry shape', () => {
  it('every id is unique', () => {
    const ids = ATTAINMENTS.map(def => def.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('carries the six new skill rows for the stance, weapons and spells (M2)', () => {
    const skills = ATTAINMENTS.filter(def => def.id.startsWith('skill:'))
    expect(skills.map(def => def.id).sort()).toEqual(['skill:ember', 'skill:hold', 'skill:sickle', 'skill:sling', 'skill:stand', 'skill:ward'])
    const byId = new Map(skills.map(def => [def.id, def]))
    expect(byId.get('skill:stand')?.kind).toBe('ability')
    expect(byId.get('skill:ward')?.kind).toBe('spell')
    expect(byId.get('skill:sickle')?.kind).toBe('weapon')
    expect(byId.get('skill:ember')?.kind).toBe('spell')
    expect(byId.get('skill:sling')?.kind).toBe('weapon')
    expect(byId.get('skill:hold')?.kind).toBe('spell')
    for (const def of skills) {
      expect(def.art).toEqual({ kind: 'skill', skill: def.id.slice('skill:'.length) })
      expect(def.when).toEqual({ done: `labyrinth/skill:${def.id.slice('skill:'.length)}` })
      expect(def.slot).toBeUndefined()
    }
  })

  it('none of the six skill rows carries a slot — no STORY_BOARDS board has a shape for one', () => {
    for (const board of STORY_BOARDS) for (const slot of board.slots) expect(slot.attainment?.startsWith('skill:')).not.toBe(true)
  })

  it('every def.art of kind "skill" names one of COMBAT_SKILLS, and vice versa', () => {
    const artSkills = ATTAINMENTS.filter(def => def.art.kind === 'skill').map(def => (def.art as { skill: string }).skill).sort()
    expect(artSkills).toEqual([...COMBAT_SKILLS].sort())
  })

  it('every slotted attainment names a real board and slot in STORY_BOARDS', () => {
    const boards = new Map(STORY_BOARDS.map(board => [board.id, new Set(board.slots.map(slot => slot.id))]))
    for (const def of ATTAINMENTS) {
      if (!def.slot) continue
      const slots = boards.get(def.slot.board)
      expect(slots, `${def.id}: board "${def.slot.board}" does not exist`).toBeDefined()
      expect(slots?.has(def.slot.slot), `${def.id}: slot "${def.slot.slot}" is not on board "${def.slot.board}"`).toBe(true)
    }
  })

  it('every STORY_BOARDS slot naming an attainment names a real one', () => {
    const ids = new Set(ATTAINMENTS.map(def => def.id))
    for (const board of STORY_BOARDS) for (const slot of board.slots) {
      if (slot.attainment) expect(ids.has(slot.attainment), `${board.id}/${slot.id} → ${slot.attainment}`).toBe(true)
    }
  })

  it('every done ref of shape labyrinth/skill:<id> names a real CombatSkillId', () => {
    for (const def of ATTAINMENTS) {
      const { done } = storyRefs(def.when)
      for (const ref of done) {
        const match = /^labyrinth\/skill:(.+)$/.exec(ref)
        if (match) expect(COMBAT_SKILLS as readonly string[]).toContain(match[1])
      }
    }
  })

  it('every done/knows ref resolves against a known place, chamber feature or island fact', () => {
    // The authoritative universe of real ids this registry may reference,
    // taken from the final spec's own §6 content tables — not re-derived
    // from chamber-places.ts (a sibling Phase-2 file this spec does not
    // import), so this check survives being run before that file lands.
    const places = new Set([
      'island', 'labyrinth', 'wet-steps', 'cistern', 'spring-heart',
      'hall-of-hours', 'six-roads', 'accord-sanctum', 'chandler-house', 'chandler-cellar', 'hollow-grove',
    ])
    const chamberFeatures: Record<string, readonly string[]> = {
      'wet-steps': ['gate:cycle', 'door:hall-door'],
      cistern: ['gate:meaning', 'shutter:shortcut-shutter'],
      'hall-of-hours': ['gate:cycle'],
      'six-roads': ['gate:meaning', 'door:east-door'],
      'accord-sanctum': ['shutter:sun-shutter'],
      'hollow-grove': ['chest:pool-chest'],
    }
    const islandFacts = new Set([
      'cache:court-cache', 'cache:pond-cache', 'cache:nook-cache',
      'person:mira', 'person:oren', 'person:sela',
      'found:grove-plot', 'found:lakeside-plot', 'found:cliff-plot', 'found:tidewater-plot',
    ])
    for (const def of ATTAINMENTS) {
      const { done } = storyRefs(def.when)
      for (const ref of done) {
        if (places.has(ref)) continue
        if (/^labyrinth\/skill:/.test(ref)) continue
        const island = /^island\/(.+)$/.exec(ref)
        if (island) { expect(islandFacts.has(island[1]), `${def.id}: ${ref}`).toBe(true); continue }
        const chamber = /^([a-z-]+)\/(.+)$/.exec(ref)
        expect(chamber, `${def.id}: "${ref}" is not a recognised ref shape`).not.toBeNull()
        const features = chamber ? chamberFeatures[chamber[1]] : undefined
        expect(features, `${def.id}: unknown chamber "${chamber?.[1]}" in "${ref}"`).toBeDefined()
        expect(features?.includes(chamber![2]), `${def.id}: "${ref}" names no known feature`).toBe(true)
      }
    }
  })
})

describe('attainmentById / heldAttainments / attainmentsOf', () => {
  it('attainmentById finds a row by id, or null', () => {
    expect(attainmentById('skill:stand')?.title).toBe('The Stand')
    expect(attainmentById('nothing-like-this')).toBeNull()
  })

  it('heldAttainments over a facts stub with done("labyrinth/skill:stand") → true returns exactly [skill:stand]', () => {
    const facts = makeFacts({ done: ['labyrinth/skill:stand'] })
    expect(heldAttainments(facts).map(def => def.id)).toEqual(['skill:stand'])
  })

  it('heldAttainments holds nothing over a facts stub with nothing set', () => {
    expect(heldAttainments(NO_FACTS)).toEqual([])
  })

  it('attainmentsOf filters by kind and by held', () => {
    const facts = makeFacts({ has: [{ kind: 'hexagon' }] })
    const held = attainmentsOf('piece', facts)
    expect(held.map(def => def.id)).toEqual(['piece:hexagon'])
    // the same fact also holds an ability row (a distinct card, same `when`)
    expect(attainmentsOf('ability', facts).map(def => def.id)).toContain('ability:hear-memories')
  })

  it('registry order is preserved (pieces, then items, then knowledge, …)', () => {
    const held = heldAttainments(makeFacts({
      has: [{ kind: 'star' }, { kind: 'hexagon' }],
      done: ['labyrinth/skill:stand'],
    }))
    const kinds = held.map(def => def.kind)
    expect(kinds.indexOf('piece')).toBeLessThan(kinds.lastIndexOf('piece'))
    expect(ATTAINMENTS.indexOf(held[0] as AttainmentDef)).toBeLessThan(ATTAINMENTS.indexOf(held[held.length - 1] as AttainmentDef))
  })
})

describe('useAttainment / useVerb', () => {
  it('useAttainment("skill:sickle", …) with it held → { kind: "equip", id: "sickle" }', () => {
    const facts = makeFacts({ done: ['labyrinth/skill:sickle'] })
    expect(useAttainment('skill:sickle', facts, context())).toEqual({ kind: 'equip', id: 'sickle' })
  })

  it('useAttainment with it not held → { kind: "none" }', () => {
    expect(useAttainment('skill:sickle', NO_FACTS, context())).toEqual({ kind: 'none' })
  })

  it('useAttainment on an unknown id → { kind: "none" }', () => {
    expect(useAttainment('not-a-real-id', NO_FACTS, context())).toEqual({ kind: 'none' })
  })

  it('useVerb on a weapon/spell row → "Equip" when not the equipped one, null when it is', () => {
    const sickle = attainmentById('skill:sickle') as AttainmentDef
    expect(useVerb(sickle, context({ weapon: null }))).toBe('Equip')
    expect(useVerb(sickle, context({ weapon: 'sling' }))).toBe('Equip')
    expect(useVerb(sickle, context({ weapon: 'sickle' }))).toBeNull()
    const ward = attainmentById('skill:ward') as AttainmentDef
    expect(useVerb(ward, context({ spell: 'ember' }))).toBe('Equip')
    expect(useVerb(ward, context({ spell: 'ward' }))).toBeNull()
  })

  it('the Stand (kind ability) never offers an Equip verb', () => {
    const stand = attainmentById('skill:stand') as AttainmentDef
    expect(useVerb(stand, context())).toBeNull()
  })

  it('a piece away from a shrine shows words-only; at a needing shrine it places', () => {
    const facts = makeFacts({ has: [{ kind: 'triangle', point: 0 }] })
    expect(useAttainment('piece:triangle:0', facts, context())).toMatchObject({ kind: 'words' })
    expect(useAttainment('piece:triangle:0', facts, context({ shrine: 'dawn-shrine' }))).toEqual({ kind: 'shrine', shrine: 'dawn-shrine' })
    expect(useVerb(attainmentById('piece:triangle:0') as AttainmentDef, context())).toBeNull()
    expect(useVerb(attainmentById('piece:triangle:0') as AttainmentDef, context({ shrine: 'dawn-shrine' }))).toBe('Place')
  })

  it('a map item opens a map; a lodestone item points a needle', () => {
    const facts = makeFacts({ knows: ['map:wayfarer-cavern', 'lodestone:wayfarer-cavern'] })
    expect(useAttainment('item:map-wayfarer-cavern', facts, context())).toEqual({ kind: 'map', group: 'wayfarer-cavern' })
    expect(useAttainment('item:lodestone-wayfarer-cavern', facts, context({ needle: 'toward the keeper’s vault' }))).toEqual({ kind: 'needle', text: 'toward the keeper’s vault' })
  })

  it('a knowledge row reads back its own words', () => {
    const facts = makeFacts({ knows: ['wet-steps-drip-line'] })
    expect(useAttainment('know:wet-steps-drip-line', facts, context())).toMatchObject({ kind: 'read', title: 'The Drip-Line' })
  })
})

describe('itemsBoards / itemsProgress', () => {
  it('every slot starts unfilled-but-shown over no facts', () => {
    const boards = itemsBoards(NO_FACTS)
    expect(boards).toHaveLength(STORY_BOARDS.length)
    for (const board of boards) for (const slot of board.slots) { expect(slot.filled).toBe(false); expect(slot.shown).toBe(true) }
    expect(itemsProgress(boards)).toEqual({ filled: 0, shown: boards.reduce((n, b) => n + b.slots.length, 0) })
  })

  it('a filled slot reports filled, and carries its attainment id through', () => {
    const facts = makeFacts({ has: [{ kind: 'hexagon' }] })
    const relics = itemsBoards(facts).find(board => board.id === 'relics')
    const hexagon = relics?.slots.find(slot => slot.id === 'hexagon')
    expect(hexagon).toMatchObject({ filled: true, attainment: 'piece:hexagon' })
    expect(relics?.filled).toBe(1)
  })

  it('itemsProgress sums filled/shown across every board', () => {
    const facts = makeFacts({ has: [{ kind: 'hexagon' }, { kind: 'star' }], knows: ['keepsake:lantern'] })
    const boards = itemsBoards(facts)
    const progress = itemsProgress(boards)
    const wantFilled = boards.reduce((n, b) => n + b.slots.filter(s => s.filled).length, 0)
    expect(progress.filled).toBe(wantFilled)
    expect(progress.filled).toBeGreaterThanOrEqual(3) // hexagon, star, keepsake-lantern
  })

  it('itemsBoards accepts a narrower board list without touching the default', () => {
    const one = itemsBoards(NO_FACTS, [STORY_BOARDS[0] as (typeof STORY_BOARDS)[number]])
    expect(one).toHaveLength(1)
    expect(one[0]?.id).toBe(STORY_BOARDS[0]?.id)
  })
})
