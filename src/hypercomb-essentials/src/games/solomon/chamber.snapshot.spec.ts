import { describe, expect, it } from 'vitest'
import {
  ChamberModel,
  type ChamberDefinition, type ChamberExit, type ChamberEntrance, type ChamberTablet, type ChamberGate,
  type ChamberChest, type ChamberDoor, type ChamberShutter, type ChamberLever, type ChamberPlate,
  type ChamberBlock, type ChamberLamp, type ChamberLampSet, type ChamberAlcove, type ChamberSnapshot,
} from './chamber.js'

const W = 14, H = 18
type Overrides = Record<string, string>
const key = (col: number, row: number): string => `${col},${row}`
function makeMap(overrides: Overrides = {}, width = W, height = H): string[] {
  const rows: string[] = []
  for (let row = 0; row < height; row++) {
    let line = ''
    for (let col = 0; col < width; col++) {
      line += (row === 0 || row === height - 1 || col === 0 || col === width - 1) ? '#' : overrides[key(col, row)] ?? '.'
    }
    rows.push(line)
  }
  return rows
}

/** Walks the model toward (x,y) using its own collision. */
function walkTo(model: ChamberModel, x: number, y: number, maxFrames = 600): void {
  for (let i = 0; i < maxFrames; i++) {
    const dx = x - model.x, dy = y - model.y
    if (Math.hypot(dx, dy) < 0.08) return
    model.update(1 / 60, { left: dx < -0.04, right: dx > 0.04, up: dy < -0.04, down: dy > 0.04 })
  }
}

const EXIT: ChamberExit = { id: 'up-exit', col: 6, row: 1, style: 'stairs-up', label: 'Daylight', landing: { col: 6, row: 2 }, facing: 'down' }
const ENTRANCE: ChamberEntrance = { id: 'down-entrance', col: 10, row: 4, style: 'stairs-down', empty: 'The way below is not yet open.', landing: { col: 10, row: 5 } }

function baseDef(overrides: Partial<ChamberDefinition> = {}, mapOverrides: Overrides = {}): ChamberDefinition {
  const merged: Overrides = { [key(EXIT.col, EXIT.row)]: '<', [key(EXIT.landing.col, EXIT.landing.row)]: '@', ...mapOverrides }
  return {
    id: 'snap-chamber', name: 'Snapshot Chamber', subtitle: 'A room for save tests', look: 'cavern', torch: 4, sconces: false,
    map: makeMap(merged),
    exits: [EXIT], entrances: [], tablets: [], gates: [], chests: [], doors: [], shutters: [],
    plates: [], blocks: [], levers: [], lamps: [], lampSets: [], sigils: [], alcoves: [], residents: [],
    furniture: [], effects: [],
    ...overrides,
  }
}

function base(raw: Partial<ChamberSnapshot> = {}, place = 'snap-chamber'): ChamberSnapshot {
  return {
    version: 1, place,
    player: { x: EXIT.landing.col + 0.5, y: EXIT.landing.row + 0.5, facing: 'down' },
    read: [], attuned: [], runes: [], opened: [], unlocked: [], latched: [], pulled: [], lit: [],
    wand: [], blocks: [], memories: [], claimed: false, explored: '',
    ...raw,
  }
}

// A rich fixture exercising every category at once, for the full round trip.
// Every feature sits at col 5 (or 6, for the shutter, which is never visited
// directly), on its own row well spaced from the next; col 4 stays clear at
// every row, so a single vertical walk down that column reaches each one in
// turn without ever crossing a solid feature cell — reading a tablet along
// the way would otherwise wall off the column it sits in.
const TABLET: ChamberTablet = { id: 'gate-tablet', col: 5, row: 3, title: 'Garden Stone', text: 'Rain, sun, bloom.' }
const GATE: ChamberGate = {
  id: 'garden-gate', col: 5, row: 5, name: 'Gate of the Garden', tablet: 'gate-tablet', question: 'In order?',
  options: [{ id: 'rain', glyph: '≋', label: 'Rain' }, { id: 'sun', glyph: '☀', label: 'Sun' }, { id: 'bloom', glyph: '✿', label: 'Bloom' }],
  answer: ['rain', 'sun', 'bloom'],
}
const KEY_CHEST: ChamberChest = { id: 'key-chest', col: 5, row: 7, name: 'A Small Chest', subtitle: 'sub', items: [{ kind: 'key', name: 'A small key' }], lore: 'A key.' }
const SMALL_DOOR: ChamberDoor = { id: 'door-1', col: 5, row: 9, name: 'A small door', lock: 'small' }
const LEVER: ChamberLever = { id: 'lever-1', col: 5, row: 11, name: 'A lever', shutter: 'shutter-1' }
const SHUTTER: ChamberShutter = { id: 'shutter-1', col: 6, row: 11, name: 'A shutter', lever: 'lever-1' }
const LAMP: ChamberLamp = { id: 'lamp-1', col: 5, row: 13, name: 'A lamp' }
const SET: ChamberLampSet = { id: 'set-1', lamps: ['lamp-1'], ordered: false }
const ALCOVE: ChamberAlcove = { id: 'alcove-1', col: 5, row: 15, memoryId: 'map:test', text: 'A quiet memory.', locked: 'A tiny hexagon rests in the carving.' }

function richDef(): ChamberDefinition {
  return baseDef(
    { tablets: [TABLET], gates: [GATE], chests: [KEY_CHEST], doors: [SMALL_DOOR], levers: [LEVER], shutters: [SHUTTER], lamps: [LAMP], lampSets: [SET], alcoves: [ALCOVE] },
    {
      [key(5, 3)]: 't', [key(5, 5)]: 'R', [key(5, 7)]: 'K', [key(5, 9)]: 'D', [key(5, 11)]: 'L', [key(6, 11)]: '|',
      [key(5, 13)]: 'f', [key(5, 15)]: 'h',
    },
  )
}

describe('exportState / restoreState — the full round trip', () => {
  it('restores every category exactly (facts, not motion) on a fresh instance', () => {
    const model = new ChamberModel(richDef(), { has: () => true })
    walkTo(model, 4.5, EXIT.landing.row + 0.5) // off the exit's own column before descending
    walkTo(model, 4.5, 3.5)
    model.interact(TABLET.id)
    walkTo(model, 4.5, 5.5)
    model.interact(GATE.id)
    model.choose(GATE.id, 'rain'); model.choose(GATE.id, 'sun'); model.choose(GATE.id, 'bloom')
    walkTo(model, 4.5, 7.5)
    model.interact(KEY_CHEST.id)
    walkTo(model, 4.5, 9.5)
    model.interact(SMALL_DOOR.id)
    walkTo(model, 4.5, 11.5)
    model.interact(LEVER.id)
    walkTo(model, 4.5, 13.5)
    model.interact(LAMP.id)
    walkTo(model, 4.5, 15.5)
    model.interact(ALCOVE.id)
    const snapshot = model.exportState()
    expect(snapshot.version).toBe(1)
    expect(snapshot.place).toBe('snap-chamber')
    expect(snapshot.read).toEqual([TABLET.id])
    expect(snapshot.attuned).toEqual([GATE.id])
    expect(snapshot.runes).toEqual([[GATE.id, ['rain', 'sun', 'bloom']]])
    expect(snapshot.opened).toEqual([KEY_CHEST.id])
    expect(snapshot.unlocked).toEqual([SMALL_DOOR.id])
    expect(snapshot.latched).toEqual([SHUTTER.id])
    expect(snapshot.pulled).toEqual([LEVER.id])
    expect(snapshot.lit).toEqual([LAMP.id])
    expect(snapshot.memories).toEqual([ALCOVE.id])
    expect(snapshot.explored.length).toBe(W * H)

    const fresh = new ChamberModel(richDef(), { has: () => true })
    fresh.restoreState(snapshot)
    expect(fresh.read.has(TABLET.id)).toBe(true)
    expect(fresh.attuned.has(GATE.id)).toBe(true)
    expect(fresh.runes(GATE.id)).toEqual(['rain', 'sun', 'bloom'])
    expect(fresh.opened.has(KEY_CHEST.id)).toBe(true)
    expect(fresh.unlocked.has(SMALL_DOOR.id)).toBe(true)
    expect(fresh.latched.has(SHUTTER.id)).toBe(true)
    expect(fresh.pulled.has(LEVER.id)).toBe(true)
    expect(fresh.lit).toEqual([LAMP.id])
    expect(fresh.memories.has(ALCOVE.id)).toBe(true)
    expect(fresh.exportState()).toEqual(snapshot)
  })

  it('resets to a fresh arrival on a version or place mismatch, without throwing', () => {
    const model = new ChamberModel(baseDef())
    expect(() => model.restoreState(base({ version: 1 as const, place: 'somewhere-else' }))).not.toThrow()
    expect(model.x).toBeCloseTo(EXIT.landing.col + 0.5)
    expect(model.read.size).toBe(0)
  })

  it('never throws on malformed raw input', () => {
    const model = new ChamberModel(baseDef())
    for (const raw of [null, undefined, 'nope', 42, [], {}]) expect(() => model.restoreState(raw)).not.toThrow()
  })
})

describe('restoreState — rejection rules', () => {
  it('ignores unknown ids in every category rather than throwing', () => {
    const model = new ChamberModel(richDef())
    const raw = base({
      read: ['ghost'], opened: ['ghost'], unlocked: ['ghost'], latched: ['ghost'], pulled: ['ghost'],
      lit: ['ghost'], memories: ['ghost'], runes: [['ghost', ['rain']]],
    })
    expect(() => model.restoreState(raw)).not.toThrow()
    expect(model.read.size).toBe(0)
    expect(model.opened.size).toBe(0)
    expect(model.unlocked.size).toBe(0)
    expect(model.latched.size).toBe(0)
    expect(model.pulled.size).toBe(0)
    expect(model.lit).toEqual([])
    expect(model.memories.size).toBe(0)
  })

  it('refuses rune progress for a gate whose tablet was never read', () => {
    const model = new ChamberModel(richDef())
    const raw = base({ runes: [[GATE.id, ['rain', 'sun', 'bloom']]] }) // read: [] — the tablet was never read
    model.restoreState(raw)
    expect(model.attuned.has(GATE.id)).toBe(false)
    expect(model.runes(GATE.id)).toEqual([])
  })

  it('keeps only the longest valid prefix of a rune sequence, once its tablet is read', () => {
    const model = new ChamberModel(richDef())
    const raw = base({ read: [TABLET.id], runes: [[GATE.id, ['rain', 'bloom', 'sun']]] }) // wrong from index 1
    model.restoreState(raw)
    expect(model.runes(GATE.id)).toEqual(['rain'])
    expect(model.attuned.has(GATE.id)).toBe(false)
  })

  it('refuses a forged small-door unlock with no opened key chest', () => {
    const model = new ChamberModel(richDef())
    const raw = base({ unlocked: [SMALL_DOOR.id] }) // opened: [] — no key chest was ever opened
    model.restoreState(raw)
    expect(model.unlocked.has(SMALL_DOOR.id)).toBe(false)
  })

  it('accepts a small-door unlock once its key chest is also restored as opened', () => {
    const model = new ChamberModel(richDef())
    const raw = base({ opened: [KEY_CHEST.id], unlocked: [SMALL_DOOR.id] })
    model.restoreState(raw)
    expect(model.unlocked.has(SMALL_DOOR.id)).toBe(true)
  })

  it('refuses a hidden chest marked opened before its lamp set is lit', () => {
    const hidden: ChamberChest = { id: 'hidden-1', col: 12, row: 5, name: 'A Hidden Chest', subtitle: 'sub', items: [], lore: 'Secret.', hiddenUntil: 'set-1' }
    const def = baseDef({ chests: [hidden], lamps: [LAMP], lampSets: [SET] }, { [key(12, 5)]: 'k', [key(LAMP.col, LAMP.row)]: 'f' })
    const model = new ChamberModel(def)
    const raw = base({ opened: [hidden.id] }, def.id) // lit: [] — the set was never completed
    model.restoreState(raw)
    expect(model.opened.has(hidden.id)).toBe(false)
    // Restoring the set as lit first legitimises the very same claim:
    const legit = base({ lit: [LAMP.id], opened: [hidden.id] }, def.id)
    model.restoreState(legit)
    expect(model.opened.has(hidden.id)).toBe(true)
  })

  it('keeps only the valid prefix of an out-of-order ordered lamp subsequence', () => {
    const a: ChamberLamp = { id: 'a', col: 3, row: 5, name: 'A' }
    const b: ChamberLamp = { id: 'b', col: 4, row: 5, name: 'B' }
    const set: ChamberLampSet = { id: 'set-1', lamps: ['a', 'b'], ordered: true }
    const def = baseDef({ lamps: [a, b], lampSets: [set] }, { [key(3, 5)]: 'f', [key(4, 5)]: 'f' })
    const model = new ChamberModel(def)
    // 'b' without 'a' is out of order: nothing should light.
    model.restoreState(base({ lit: ['b'] }, def.id))
    expect(model.lit).toEqual([])
    // 'a' then 'b' is the correct order: both light, and the set completes.
    model.restoreState(base({ lit: ['a', 'b'] }, def.id))
    expect(model.lit).toEqual(['a', 'b'])
    expect(model.setComplete('set-1')).toBe(true)
  })

  it('falls back a block on a threshold to its own home', () => {
    // A threshold (':') is walkable but never block-enterable by design —
    // exactly like a laid rune — so a saved position there is invalid.
    const block: ChamberBlock = { id: 'block-1', col: 5, row: 3, look: 'stone' }
    const def = baseDef({ blocks: [block] }, { [key(4, 3)]: ':', [key(block.col, block.row)]: 'o' })
    const fresh = new ChamberModel(def)
    fresh.restoreState(base({ blocks: [[block.id, 4, 3]] }, def.id))
    expect(fresh.blockCell(block.id)).toEqual({ col: block.col, row: block.row })
  })

  it('refuses memories without the hexagon, and accepts them with it', () => {
    const def = baseDef({ alcoves: [ALCOVE] }, { [key(ALCOVE.col, ALCOVE.row)]: 'h' })
    const locked = new ChamberModel(def, { has: () => false })
    locked.restoreState(base({ memories: [ALCOVE.id] }, def.id))
    expect(locked.memories.has(ALCOVE.id)).toBe(false)
    const open = new ChamberModel(def, { has: () => true })
    open.restoreState(base({ memories: [ALCOVE.id] }, def.id))
    expect(open.memories.has(ALCOVE.id)).toBe(true)
  })

  it('defaults a mismatched explored length to fully unexplored, without refusing the rest of the plan', () => {
    const model = new ChamberModel(richDef())
    const raw = base({ explored: '01', read: [TABLET.id] }) // far too short
    model.restoreState(raw)
    expect(model.explored.every(v => v === 0)).toBe(true)
    expect(model.read.has(TABLET.id)).toBe(true) // the rest of the plan still applies
  })

  it('a saved position on a (now-solid) portal cell falls back to its landing', () => {
    const def = baseDef({ entrances: [ENTRANCE] }, { [key(ENTRANCE.col, ENTRANCE.row)]: '>' })
    const model = new ChamberModel(def)
    const raw = base({ player: { x: ENTRANCE.col + 0.5, y: ENTRANCE.row + 0.5, facing: 'down' } }, def.id)
    model.restoreState(raw)
    expect(model.x).toBeCloseTo(ENTRANCE.landing.col + 0.5)
    expect(model.y).toBeCloseTo(ENTRANCE.landing.row + 0.5)
  })
})
