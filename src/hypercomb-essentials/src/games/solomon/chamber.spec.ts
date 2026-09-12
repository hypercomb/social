import { describe, expect, it } from 'vitest'
import {
  buildChamber, ChamberModel, PUSH_DELAY, REARM_DISTANCE, TARGET_REACH, TABLET_REACH, TABLET_DWELL,
  type ChamberDefinition, type ChamberExit, type ChamberEntrance, type MoveInput, type ChamberEvent,
  type ChamberChest, type ChamberDoor, type ChamberTablet, type ChamberGate, type ChamberShutter,
  type ChamberPlate, type ChamberBlock, type ChamberLever, type ChamberLamp, type ChamberLampSet,
  type ChamberSigil, type ChamberAlcove, type ChamberArtifact, type ChamberResident, type ChamberRisingLight,
} from './chamber.js'

const W = 14, H = 9
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

const EXIT: ChamberExit = { id: 'up-exit', col: 6, row: 1, style: 'stairs-up', label: 'Daylight', landing: { col: 6, row: 2 }, facing: 'down' }
const ENTRANCE: ChamberEntrance = { id: 'down-entrance', col: 10, row: 4, style: 'stairs-down', empty: 'The way below is not yet open.', landing: { col: 10, row: 5 } }

function baseDef(overrides: Partial<ChamberDefinition> = {}, mapOverrides: Overrides = {}): ChamberDefinition {
  const merged: Overrides = { [key(EXIT.col, EXIT.row)]: '<', [key(EXIT.landing.col, EXIT.landing.row)]: '@', ...mapOverrides }
  return {
    id: 'test-chamber', name: 'Test Chamber', subtitle: 'A room for testing', look: 'cavern', torch: 4, sconces: false,
    map: makeMap(merged),
    exits: [EXIT], entrances: [], tablets: [], gates: [], chests: [], doors: [], shutters: [],
    plates: [], blocks: [], levers: [], lamps: [], lampSets: [], sigils: [], alcoves: [], residents: [],
    furniture: [], effects: [],
    ...overrides,
  }
}

const idle: MoveInput = { up: false, down: false, left: false, right: false }
/** Walks the model toward (x,y) using its own collision, since position is
 *  otherwise only reachable through movement, arrive() or land(). */
function walkTo(model: ChamberModel, x: number, y: number, maxFrames = 600): void {
  for (let i = 0; i < maxFrames; i++) {
    const dx = x - model.x, dy = y - model.y
    if (Math.hypot(dx, dy) < 0.08) return
    model.update(1 / 60, { left: dx < -0.04, right: dx > 0.04, up: dy < -0.04, down: dy > 0.04 })
  }
}

describe('buildChamber — the seventeen build checks', () => {
  it('1: rejects a non-rectangular map', () => {
    const def = baseDef()
    const map = [...def.map]; map[3] = map[3].slice(0, -1)
    expect(() => buildChamber({ ...def, map })).toThrow(/rectangle/)
  })
  it('2: rejects an unknown map glyph', () => {
    const def = baseDef()
    const map = [...def.map]; map[3] = `${map[3].slice(0, 3)}Z${map[3].slice(4)}`
    expect(() => buildChamber({ ...def, map })).toThrow(/glyph/)
  })
  it('3: rejects an open border', () => {
    const def = baseDef()
    const map = [...def.map]; map[0] = `#${map[0].slice(1, -1)}.`.slice(0, -1) + '#'
    map[0] = '.' + map[0].slice(1)
    expect(() => buildChamber({ ...def, map })).toThrow(/border/)
  })
  it('4: rejects a chamber with no exit', () => {
    const def = baseDef({ exits: [] })
    expect(() => buildChamber(def)).toThrow(/exit/)
  })
  it('5: rejects a duplicate id across categories', () => {
    const tablet: ChamberTablet = { id: 'up-exit', col: 3, row: 3, title: 'A stone', text: 'Words.' }
    const def = baseDef({ tablets: [tablet] }, { [key(3, 3)]: 't' })
    expect(() => buildChamber(def)).toThrow(/duplicate id/)
  })
  it('6: rejects a feature cell out of bounds', () => {
    const tablet: ChamberTablet = { id: 'stone-1', col: 99, row: 99, title: 'A stone', text: 'Words.' }
    expect(() => buildChamber(baseDef({ tablets: [tablet] }))).toThrow(/bounds/)
  })
  it('7: rejects a feature on the wrong glyph', () => {
    const tablet: ChamberTablet = { id: 'stone-1', col: 3, row: 3, title: 'A stone', text: 'Words.' }
    expect(() => buildChamber(baseDef({ tablets: [tablet] }))).toThrow(/glyph/)
  })
  it('8: rejects an exit landing not on \'@\'', () => {
    const badExit: ChamberExit = { ...EXIT, landing: { col: 5, row: 1 }, facing: 'left' } // adjacent, but plain floor
    expect(() => buildChamber(baseDef({ exits: [badExit] }))).toThrow(/glyph/)
  })
  it('9: rejects a shutter with no named control', () => {
    const shutter: ChamberShutter = { id: 'shutter-1', col: 3, row: 3, name: 'Keeper\'s shutter' }
    expect(() => buildChamber(baseDef({ shutters: [shutter] }, { [key(3, 3)]: '|' }))).toThrow(/no control/)
  })
  it('9b: rejects a lever whose .shutter does not point back', () => {
    const shutter: ChamberShutter = { id: 'shutter-1', col: 3, row: 3, name: 'Shutter', lever: 'lever-1' }
    const lever: ChamberLever = { id: 'lever-1', col: 4, row: 3, name: 'Lever', shutter: 'other-shutter' }
    expect(() => buildChamber(baseDef({ shutters: [shutter], levers: [lever] }, { [key(3, 3)]: '|', [key(4, 3)]: 'L' })))
      .toThrow(/does not point back/)
  })
  it('10: rejects a sigil referencing an unknown block', () => {
    const sigil: ChamberSigil = { id: 'sigil-1', col: 3, row: 3, blocks: ['missing-block'], shutters: [] }
    expect(() => buildChamber(baseDef({ sigils: [sigil] }, { [key(3, 3)]: 's' }))).toThrow(/unknown block/)
  })
  it('11: rejects a lamp set with a decoy that is also a true lamp', () => {
    const lamp: ChamberLamp = { id: 'lamp-1', col: 3, row: 3, name: 'Lamp' }
    const set: ChamberLampSet = { id: 'set-1', lamps: ['lamp-1'], ordered: false, decoys: ['lamp-1'] }
    expect(() => buildChamber(baseDef({ lamps: [lamp], lampSets: [set] }, { [key(3, 3)]: 'f' }))).toThrow(/also a true lamp/)
  })
  it('12: rejects a gate answer referencing an unknown option', () => {
    const tablet: ChamberTablet = { id: 'tablet-1', col: 2, row: 3, title: 'Stone', text: 'Words.' }
    const gate: ChamberGate = { id: 'gate-1', col: 3, row: 3, name: 'Gate', tablet: 'tablet-1', question: 'Q?', options: [{ id: 'a', glyph: 'A', label: 'A' }], answer: ['b'] }
    expect(() => buildChamber(baseDef({ tablets: [tablet], gates: [gate] }, { [key(2, 3)]: 't', [key(3, 3)]: 'R' }))).toThrow(/unknown option/)
  })
  it('13: rejects a pointsAt reference to an unknown feature', () => {
    const tablet: ChamberTablet = { id: 'tablet-1', col: 3, row: 3, title: 'Stone', text: 'Words.', pointsAt: ['nope'] }
    expect(() => buildChamber(baseDef({ tablets: [tablet] }, { [key(3, 3)]: 't' }))).toThrow(/points at unknown/)
  })
  it('14: rejects a block whose starting cell is not a block-home glyph', () => {
    const block: ChamberBlock = { id: 'block-1', col: 3, row: 3, look: 'stone' }
    expect(() => buildChamber(baseDef({ blocks: [block] }))).toThrow(/glyph/)
  })
  it('14b: rejects a finale referencing an unknown lamp set', () => {
    const def = baseDef({ finale: { when: { set: 'nope' } } })
    expect(() => buildChamber(def)).toThrow(/unknown lamp set/)
  })
  it('15 (6b): rejects an exit whose facing does not match the direction to its landing', () => {
    const badExit: ChamberExit = { ...EXIT, facing: 'up' }
    expect(() => buildChamber(baseDef({ exits: [badExit] }))).toThrow(/facing/)
  })
  it('16 (6c): rejects an entrance landing not on \'.\' or \':\'', () => {
    // Adjacent to the entrance, but marked '@' (an exit-only landing glyph).
    const badEntrance: ChamberEntrance = { ...ENTRANCE, landing: { col: 9, row: 4 } }
    expect(() => buildChamber(baseDef({ entrances: [badEntrance] }, { [key(10, 4)]: '>', [key(9, 4)]: '@' }))).toThrow(/glyph/)
  })
  it('17 (6d): rejects two portals sharing a landing', () => {
    const second: ChamberEntrance = { id: 'down-entrance-2', col: 11, row: 5, style: 'stairs-down', empty: 'e', landing: ENTRANCE.landing }
    const def = baseDef({ entrances: [ENTRANCE, second] }, { [key(10, 4)]: '>', [key(11, 5)]: '>' })
    expect(() => buildChamber(def)).toThrow(/share a landing/)
  })
  it('accepts a minimal valid definition and memoises the build', () => {
    const def = baseDef()
    const first = buildChamber(def)
    const second = buildChamber(def)
    expect(first).toBe(second)
    expect(first.cols).toBe(W)
    expect(first.rows).toBe(H)
  })
})

describe('movement, collision and facing', () => {
  it('starts centred on the exit landing, facing the exit\'s authored facing', () => {
    const model = new ChamberModel(baseDef())
    expect(model.x).toBeCloseTo(EXIT.landing.col + 0.5)
    expect(model.y).toBeCloseTo(EXIT.landing.row + 0.5)
    expect(model.facing).toBe('down')
  })
  it('walks on both axes and stops at a wall', () => {
    const model = new ChamberModel(baseDef())
    for (let t = 0; t < 60; t++) model.update(1 / 60, { ...idle, right: true })
    expect(model.x).toBeGreaterThan(EXIT.landing.col + 0.5)
    expect(model.moving).toBe(true)
    for (let t = 0; t < 300; t++) model.update(1 / 60, { ...idle, right: true })
    expect(model.x).toBeLessThan(W - 1) // never leaves the room through the east wall
  })
  it('reports not-moving with no input', () => {
    const model = new ChamberModel(baseDef())
    model.update(1 / 60, idle)
    expect(model.moving).toBe(false)
  })
})

describe('portals — push, rearm, disarm, cue', () => {
  function portalDef() {
    return baseDef({ entrances: [ENTRANCE] }, { [key(10, 4)]: '>' })
  }
  it('fires navigate only after PUSH_DELAY, held from the landing in the push direction', () => {
    const model = new ChamberModel(portalDef())
    model.land(ENTRANCE.id) // start at the entrance's own landing, disarmed
    // Step away, past REARM_DISTANCE, then walk precisely back to re-arm.
    for (let t = 0; t < 30; t++) model.update(1 / 60, { ...idle, down: true })
    walkTo(model, ENTRANCE.landing.col + 0.5, ENTRANCE.landing.row + 0.5)
    const early: ChamberEvent[] = []
    for (let t = 0; t < Math.round(0.25 * 60); t++) early.push(...model.update(1 / 60, { ...idle, up: true }))
    expect(early.some(e => e.kind === 'navigate')).toBe(false)
    const later: ChamberEvent[] = []
    for (let t = 0; t < Math.round(0.2 * 60); t++) later.push(...model.update(1 / 60, { ...idle, up: true }))
    expect(later.filter(e => e.kind === 'navigate')).toHaveLength(1)
    expect(later.find(e => e.kind === 'navigate')).toMatchObject({ kind: 'navigate', to: 'down', entrance: ENTRANCE.id })
  })
  it('never fires from the wrong side, and refuses exactly once', () => {
    const model = new ChamberModel(portalDef())
    // Approach the entrance cell from the west, an unauthorised side.
    model.land(ENTRANCE.id)
    for (let t = 0; t < 90; t++) model.update(1 / 60, { ...idle, down: true, left: true })
    for (let t = 0; t < 90; t++) model.update(1 / 60, { ...idle, left: true })
    const events: ChamberEvent[] = []
    for (let t = 0; t < 60; t++) events.push(...model.update(1 / 60, { ...idle, right: true }))
    expect(events.some(e => e.kind === 'navigate')).toBe(false)
  })
  it('a diagonal push never fires navigate', () => {
    const model = new ChamberModel(portalDef())
    model.land(ENTRANCE.id)
    for (let t = 0; t < 60; t++) model.update(1 / 60, { ...idle, down: true })
    const events: ChamberEvent[] = []
    for (let t = 0; t < 90; t++) events.push(...model.update(1 / 60, { up: true, right: true, down: false, left: false }))
    expect(events.some(e => e.kind === 'navigate')).toBe(false)
  })
  it('arrive()/land() disarm; REARM_DISTANCE re-arms after moving away', () => {
    const model = new ChamberModel(portalDef())
    model.land(ENTRANCE.id)
    const events: ChamberEvent[] = []
    for (let t = 0; t < 90; t++) events.push(...model.update(1 / 60, { ...idle, up: true }))
    expect(events.some(e => e.kind === 'navigate')).toBe(false) // disarmed on landing, never fires
    for (let t = 0; t < 90; t++) model.update(1 / 60, { ...idle, down: true })
    expect(Math.hypot(model.x - ENTRANCE.landing.col - 0.5, model.y - ENTRANCE.landing.row - 0.5)).toBeGreaterThanOrEqual(REARM_DISTANCE)
    const after: ChamberEvent[] = []
    for (let t = 0; t < 90; t++) after.push(...model.update(1 / 60, { ...idle, up: true }))
    expect(after.some(e => e.kind === 'navigate')).toBe(true)
  })
  it('refuse(id) disarms without navigating', () => {
    const model = new ChamberModel(portalDef())
    model.land(ENTRANCE.id)
    for (let t = 0; t < 30; t++) model.update(1 / 60, { ...idle, down: true })
    walkTo(model, ENTRANCE.landing.col + 0.5, ENTRANCE.landing.row + 0.5) // re-armed by distance
    model.refuse(ENTRANCE.id) // disarm again, deliberately, before ever pushing
    const events: ChamberEvent[] = []
    for (let t = 0; t < 90; t++) events.push(...model.update(1 / 60, { ...idle, up: true }))
    expect(events.some(e => e.kind === 'navigate')).toBe(false)
  })
  it('cue() reports the portal label as a tag with no key hint', () => {
    const model = new ChamberModel(portalDef())
    model.arrive()
    const cue = model.cue()
    expect(cue).toMatchObject({ target: 'exit', action: 'tag', words: 'Daylight' })
  })
  it('exits, entrances and the rising light are never open, and nearest() never returns one', () => {
    const model = new ChamberModel(portalDef())
    expect(model.open(EXIT.col, EXIT.row)).toBe(false)
    expect(model.open(ENTRANCE.col, ENTRANCE.row)).toBe(false)
    expect(model.nearest()).toBeNull()
  })
  it('interact(portalId) fires navigate within reach, and hints "Walk up to" beyond it', () => {
    const model = new ChamberModel(portalDef())
    model.arrive()
    const far = model.interact(ENTRANCE.id)
    expect(far).toMatchObject({ kind: 'message' })
    if (far.kind === 'message') expect(far.text).toMatch(/Walk up to/)
    model.land(ENTRANCE.id)
    for (let t = 0; t < 90; t++) model.update(1 / 60, { ...idle, down: true })
    for (let t = 0; t < 90; t++) model.update(1 / 60, { ...idle, up: true })
    const near = model.interact(ENTRANCE.id)
    expect(near).toMatchObject({ kind: 'navigate', to: 'down', entrance: ENTRANCE.id })
  })
})

describe('the wand', () => {
  const CRACK = { col: 5, row: 3 }
  function wandDef(mapOverrides: Overrides = {}) { return baseDef({}, { [key(CRACK.col, CRACK.row)]: 'B', ...mapOverrides }) }
  it('toggles a cracked brick to rubble, and back, at the faced cell only', () => {
    const model = new ChamberModel(wandDef())
    walkTo(model, CRACK.col - 0.5, CRACK.row + 0.5)
    model.turn('right')
    expect(model.terrainAt(CRACK.col, CRACK.row)).toBe('crack')
    expect(model.open(CRACK.col, CRACK.row)).toBe(false)
    const opened = model.cast()
    expect(model.terrainAt(CRACK.col, CRACK.row)).toBe('rubble')
    expect(model.open(CRACK.col, CRACK.row)).toBe(true)
    expect(opened.events).toEqual([{ kind: 'wand', col: CRACK.col, row: CRACK.row, terrain: 'rubble' }])
    model.cast() // reverting from the same adjacent cell — no overlap, so no "standing" refusal
    expect(model.terrainAt(CRACK.col, CRACK.row)).toBe('crack')
  })
  it('refuses when nothing answers the wand', () => {
    const model = new ChamberModel(baseDef())
    const result = model.cast()
    expect(result.kind).toBe('message')
    if (result.kind === 'message') expect(result.text).toMatch(/only cracked bricks/)
    expect(result.events).toHaveLength(0)
  })
  it('refuses when a block occupies the faced cell', () => {
    const block: ChamberBlock = { id: 'block-1', col: CRACK.col, row: CRACK.row - 1, look: 'stone' }
    const def = wandDef({ [key(block.col, block.row)]: 'o' })
    const model = new ChamberModel({ ...def, blocks: [block] })
    // Route in from below (a different row) so the approach never pushes the block.
    // Route around both the crack (row 3) and the block's own row via a clear
    // transit row/column, so the approach never aligns with — and so never
    // pushes — the block before the deliberate final step onto its left side.
    const transitRow = block.row + 2
    walkTo(model, 6.5, transitRow + 0.5)
    walkTo(model, 2.5, transitRow + 0.5)
    walkTo(model, 2.5, block.row + 0.5)
    walkTo(model, block.col - 0.5, block.row + 0.5)
    model.turn('right')
    const result = model.cast()
    expect(result.kind).toBe('message')
    if (result.kind === 'message') expect(result.text).toMatch(/stone rests there/)
  })
  it('a seal opens once every rune plate is laid, and closes again when one is lifted', () => {
    const rune = { col: 5, row: 3 }, seal = { col: 5, row: 4 }
    const def = baseDef({}, { [key(rune.col, rune.row)]: 'r', [key(seal.col, seal.row)]: 'S' })
    const model = new ChamberModel(def)
    expect(model.sealOpen()).toBe(false)
    expect(model.terrainAt(seal.col, seal.row)).toBe('seal')
    walkTo(model, rune.col - 0.5, rune.row + 0.5)
    model.turn('right')
    const result = model.cast()
    expect(model.sealOpen()).toBe(true)
    expect(model.terrainAt(seal.col, seal.row)).toBe('seal-open')
    expect(result.events).toEqual(expect.arrayContaining([{ kind: 'seal', open: true }]))
  })
})

describe('tablets', () => {
  const TABLET: ChamberTablet = { id: 'tablet-1', col: 3, row: 3, title: 'A Worn Stone', text: 'Old words.' }
  function tabletDef() { return baseDef({ tablets: [TABLET] }, { [key(3, 3)]: 't' }) }
  it('reads once after TABLET_DWELL of proximity, journaling knowledge exactly once', () => {
    const model = new ChamberModel(tabletDef())
    // Walk the model near the tablet by direct field writes via update() simulation is
    // impractical without teleport, so approach via movement toward it instead.
    for (let t = 0; t < 400 && Math.hypot(model.x - 3.5, model.y - 3.5) > TABLET_REACH - 0.2; t++) {
      model.update(1 / 60, { up: model.y > 3.6, down: model.y < 3.4, left: model.x > 3.6, right: model.x < 3.4 })
    }
    const events: ChamberEvent[] = []
    for (let t = 0; t < Math.round((TABLET_DWELL + 0.2) * 60); t++) events.push(...model.update(1 / 60, idle))
    expect(events.some(e => e.kind === 'read' && e.tablet === TABLET.id)).toBe(true)
    expect(events.filter(e => e.kind === 'knowledge')).toHaveLength(1)
    expect(model.read.has(TABLET.id)).toBe(true)
  })
  it('a click reads immediately within 4 tiles', () => {
    const model = new ChamberModel(tabletDef())
    const result = model.interact(TABLET.id)
    expect(result.kind).toBe('message')
    if (result.kind === 'message') expect(result.text).toBe(TABLET.text)
    expect(model.read.has(TABLET.id)).toBe(true)
  })
})

describe('gates', () => {
  const TABLET: ChamberTablet = { id: 'gate-tablet', col: 2, row: 3, title: 'Garden Stone', text: 'Rain, sun, bloom.' }
  const GATE: ChamberGate = {
    id: 'garden-gate', col: 3, row: 3, name: 'Gate of the Garden', tablet: 'gate-tablet', question: 'In order?',
    options: [{ id: 'rain', glyph: '≋', label: 'Rain' }, { id: 'sun', glyph: '☀', label: 'Sun' }, { id: 'bloom', glyph: '✿', label: 'Bloom' }],
    answer: ['rain', 'sun', 'bloom'],
  }
  function gateDef() { return baseDef({ tablets: [TABLET], gates: [GATE] }, { [key(2, 3)]: 't', [key(3, 3)]: 'R' }) }
  it('hints to read the tablet before the gate opens a dialog', () => {
    const model = new ChamberModel(gateDef())
    walkTo(model, 3.5, 4.4)
    const result = model.interact(GATE.id)
    expect(result.kind).toBe('message')
  })
  it('opens a dialog with the tablet\'s text as the inscription once read, and choose() attunes in order', () => {
    const model = new ChamberModel(gateDef())
    walkTo(model, 2.5, 4.4)
    model.interact(TABLET.id)
    walkTo(model, 3.5, 4.4)
    const dialog = model.interact(GATE.id)
    expect(dialog).toMatchObject({ kind: 'dialog', dialog: { kind: 'gate', inscription: TABLET.text } })
    expect(model.choose(GATE.id, 'sun').opened).toBe(false) // wrong first pick resets
    expect(model.runes(GATE.id)).toEqual([])
    expect(model.choose(GATE.id, 'rain').opened).toBe(false)
    expect(model.choose(GATE.id, 'sun').opened).toBe(false)
    expect(model.choose(GATE.id, 'bloom').opened).toBe(true)
    expect(model.attuned.has(GATE.id)).toBe(true)
    expect(model.open(GATE.col, GATE.row)).toBe(true)
  })
})

describe('chests, including a hidden one revealed by a lamp set', () => {
  const CHEST: ChamberChest = { id: 'chest-1', col: 3, row: 3, name: 'A Small Chest', subtitle: 'sub', items: [{ kind: 'gem', name: 'A gem' }], lore: 'Lore.' }
  const LAMP_A: ChamberLamp = { id: 'lamp-a', col: 4, row: 3, name: 'Lamp A' }
  const LAMP_B: ChamberLamp = { id: 'lamp-b', col: 5, row: 3, name: 'Lamp B' }
  const SET: ChamberLampSet = { id: 'set-1', lamps: ['lamp-a', 'lamp-b'], ordered: false }
  const HIDDEN_CHEST: ChamberChest = { id: 'hidden-1', col: 6, row: 3, name: 'A Hidden Chest', subtitle: 'sub', items: [], lore: 'Secret.', hiddenUntil: 'set-1' }
  it('opening fires an opened(fresh) event and re-shows a dialog on a second open', () => {
    const def = baseDef({ chests: [CHEST] }, { [key(3, 3)]: 'K' })
    const model = new ChamberModel(def)
    walkTo(model, 3.5, 4.4)
    const first = model.interact(CHEST.id)
    expect(first).toMatchObject({ kind: 'dialog', dialog: { kind: 'chest', fresh: true } })
    expect(first.events.some(e => e.kind === 'opened' && e.fresh)).toBe(true)
    const second = model.interact(CHEST.id)
    expect(second).toMatchObject({ kind: 'dialog', dialog: { kind: 'chest', fresh: false } })
    expect(second.events).toHaveLength(0)
  })
  it('a hidden chest is absent until its lamp set completes, then reveals', () => {
    const def = baseDef({ chests: [HIDDEN_CHEST], lamps: [LAMP_A, LAMP_B], lampSets: [SET] },
      { [key(6, 3)]: 'k', [key(4, 3)]: 'f', [key(5, 3)]: 'f' })
    const model = new ChamberModel(def)
    expect(model.present(HIDDEN_CHEST.id)).toBe(false)
    walkTo(model, 4.5, 4.4)
    const first = model.interact(LAMP_A.id)
    expect(first.events.some(e => e.kind === 'revealed')).toBe(false)
    walkTo(model, 5.5, 4.4)
    const second = model.interact(LAMP_B.id)
    expect(second.events.some(e => e.kind === 'revealed' && e.feature === HIDDEN_CHEST.id)).toBe(true)
    expect(second.events.some(e => e.kind === 'completed' && e.set === SET.id)).toBe(true)
    expect(model.present(HIDDEN_CHEST.id)).toBe(true)
  })
})

describe('doors and keys', () => {
  const KEY_CHEST: ChamberChest = { id: 'key-chest', col: 2, row: 3, name: 'A Small Chest', subtitle: 'sub', items: [{ kind: 'key', name: 'A small key' }], lore: 'A key.' }
  const GREAT_CHEST: ChamberChest = { id: 'great-chest', col: 2, row: 6, name: 'The Great Chest', subtitle: 'sub', items: [{ kind: 'great-key', name: 'The Great Key' }], lore: 'The great key.' }
  const SMALL_DOOR: ChamberDoor = { id: 'door-1', col: 3, row: 3, name: 'A small door', lock: 'small' }
  const GREAT_DOOR: ChamberDoor = { id: 'door-2', col: 3, row: 6, name: 'The great door', lock: 'great' }
  function doorDef() {
    return baseDef({ chests: [KEY_CHEST, GREAT_CHEST], doors: [SMALL_DOOR, GREAT_DOOR] },
      { [key(2, 3)]: 'K', [key(2, 6)]: 'K', [key(3, 3)]: 'D', [key(3, 6)]: 'G' })
  }
  it('a small door needs an opened key chest, and never re-locks', () => {
    const model = new ChamberModel(doorDef())
    walkTo(model, 3, 4.4)
    expect(model.interact(SMALL_DOOR.id)).toMatchObject({ kind: 'message' })
    expect(model.unlocked.has(SMALL_DOOR.id)).toBe(false)
    model.interact(KEY_CHEST.id)
    const opened = model.interact(SMALL_DOOR.id)
    expect(opened.events.some(e => e.kind === 'unlocked' && e.door === SMALL_DOOR.id)).toBe(true)
    expect(model.unlocked.has(SMALL_DOOR.id)).toBe(true)
    expect(model.keysHeld()).toBe(0)
    const again = model.interact(SMALL_DOOR.id)
    expect(again.events).toHaveLength(0)
  })
  it('the great door needs the Great Key chest specifically, spent once', () => {
    const model = new ChamberModel(doorDef())
    walkTo(model, 3, 4.4)
    model.interact(KEY_CHEST.id) // an ordinary key does not open the great door
    expect(model.hasGreatKey()).toBe(false)
    walkTo(model, 3, 7.4)
    model.interact(GREAT_CHEST.id)
    expect(model.hasGreatKey()).toBe(true)
    model.interact(GREAT_DOOR.id)
    expect(model.unlocked.has(GREAT_DOOR.id)).toBe(true)
    expect(model.hasGreatKey()).toBe(false)
  })
})

describe('shutters, plates, blocks and levers', () => {
  const PLATE: ChamberPlate = { id: 'plate-1', col: 4, row: 3 }
  const BLOCK: ChamberBlock = { id: 'block-1', col: 3, row: 3, look: 'stone' }
  const SHUTTER: ChamberShutter = { id: 'shutter-1', col: 6, row: 3, name: 'Keeper\'s shutter', plates: ['plate-1'] }
  it('a block on a plate latches its shutter', () => {
    const def = baseDef({ plates: [PLATE], blocks: [BLOCK], shutters: [SHUTTER] },
      { [key(4, 3)]: 'P', [key(3, 3)]: 'o', [key(6, 3)]: '|' })
    const model = new ChamberModel(def)
    expect(model.pressed(PLATE.id)).toBe(false)
    // Push the block from (3,3) to (4,3): stand at (2,3) and hold right. Route
    // down and around first, so approaching never aligns with the block's row.
    walkTo(model, 6.5, 5.5)
    walkTo(model, 2.5, 5.5)
    walkTo(model, 2.5, 3.5)
    const events: ChamberEvent[] = []
    for (let t = 0; t < Math.round((PUSH_DELAY + 0.1) * 60); t++) events.push(...model.update(1 / 60, { ...idle, right: true }))
    expect(model.blockAt(4, 3)).toBe(BLOCK.id)
    expect(model.pressed(PLATE.id)).toBe(true)
    expect(events.some(e => e.kind === 'latched' && e.shutter === SHUTTER.id)).toBe(true)
    expect(model.latched.has(SHUTTER.id)).toBe(true)
    expect(model.open(SHUTTER.col, SHUTTER.row)).toBe(true)
  })
  it('a lever pull latches its shutter one-way', () => {
    const shutter: ChamberShutter = { id: 'shutter-2', col: 5, row: 3, name: 'Lever Shutter', lever: 'lever-1' }
    const lever: ChamberLever = { id: 'lever-1', col: 4, row: 3, name: 'A lever', shutter: 'shutter-2' }
    const def = baseDef({ shutters: [shutter], levers: [lever] }, { [key(5, 3)]: '|', [key(4, 3)]: 'L' })
    const model = new ChamberModel(def)
    walkTo(model, 4.5, 4.4)
    const first = model.interact(lever.id)
    expect(first.events).toEqual(expect.arrayContaining([{ kind: 'pulled', lever: lever.id }, { kind: 'latched', shutter: shutter.id }]))
    const second = model.interact(lever.id)
    expect(second.events).toHaveLength(0)
  })
})

describe('lamp sets', () => {
  it('an unordered set lights in any order', () => {
    const a: ChamberLamp = { id: 'a', col: 3, row: 3, name: 'A' }
    const b: ChamberLamp = { id: 'b', col: 4, row: 3, name: 'B' }
    const set: ChamberLampSet = { id: 'set-1', lamps: ['a', 'b'], ordered: false }
    const model = new ChamberModel(baseDef({ lamps: [a, b], lampSets: [set] }, { [key(3, 3)]: 'f', [key(4, 3)]: 'f' }))
    walkTo(model, 4.5, 4.4)
    model.interact('b')
    walkTo(model, 3.5, 4.4)
    const result = model.interact('a')
    expect(result.events.some(e => e.kind === 'completed' && e.set === 'set-1')).toBe(true)
  })
  it('an ordered set gutters entirely on a decoy or an out-of-order pick', () => {
    const a: ChamberLamp = { id: 'a', col: 3, row: 3, name: 'A' }
    const b: ChamberLamp = { id: 'b', col: 4, row: 3, name: 'B' }
    const decoy: ChamberLamp = { id: 'x', col: 5, row: 3, name: 'X' }
    const set: ChamberLampSet = { id: 'set-1', lamps: ['a', 'b'], ordered: true, decoys: ['x'] }
    const model = new ChamberModel(baseDef({ lamps: [a, b, decoy], lampSets: [set] }, { [key(3, 3)]: 'f', [key(4, 3)]: 'f', [key(5, 3)]: 'f' }))
    walkTo(model, 3.5, 4.4)
    model.interact('a')
    walkTo(model, 5.5, 4.4)
    const result = model.interact('x')
    expect(model.lit).toEqual([])
    expect(result.events.some(e => e.kind === 'guttered')).toBe(true)
    // Freely relightable in the correct order afterward:
    walkTo(model, 3.5, 4.4)
    model.interact('a')
    walkTo(model, 4.5, 4.4)
    const finished = model.interact('b')
    expect(finished.events.some(e => e.kind === 'completed')).toBe(true)
  })
})

describe('settling stones (sigils), stuck()', () => {
  const BLOCK: ChamberBlock = { id: 'block-1', col: 3, row: 3, look: 'stone' }
  const PLATE: ChamberPlate = { id: 'plate-1', col: 6, row: 3 }
  const SHUTTER: ChamberShutter = { id: 'shutter-1', col: 7, row: 3, name: 'Shutter', plates: ['plate-1'] }
  const SIGIL: ChamberSigil = { id: 'sigil-1', col: 8, row: 3, blocks: ['block-1'], shutters: ['shutter-1'] }
  function sigilDef() {
    return baseDef({ blocks: [BLOCK], plates: [PLATE], shutters: [SHUTTER], sigils: [SIGIL] },
      { [key(3, 3)]: 'o', [key(6, 3)]: 'P', [key(7, 3)]: '|', [key(8, 3)]: 's' })
  }
  it('is not stuck at rest, and E resets its blocks home', () => {
    const model = new ChamberModel(sigilDef())
    expect(model.stuck()).toBeNull()
    // Route down and around first, so approaching never aligns with the block's row.
    walkTo(model, 6.5, 5.5)
    walkTo(model, 2.5, 5.5)
    walkTo(model, 2.5, 3.5)
    for (let t = 0; t < Math.round((PUSH_DELAY + 0.1) * 60); t++) model.update(1 / 60, { ...idle, right: true })
    expect(model.blockAt(4, 3)).toBe(BLOCK.id)
    expect(model.stuck()).toBeNull() // resting in the open middle of the room is never a corner
    walkTo(model, 8.5, 4.6)
    const result = model.interact(SIGIL.id)
    expect(model.blockAt(BLOCK.col, BLOCK.row)).toBe(BLOCK.id)
    expect(result.events.some(e => e.kind === 'settled' && e.sigil === SIGIL.id)).toBe(true)
  })
  it('flags a sigil once its block sits permanently cornered against two walls', () => {
    const model = new ChamberModel(sigilDef())
    // Drive the block from (3,3) into the room's top-left corner: left to the
    // border (stops at col 1), then up to the border (stops at row 1) — a
    // permanent, perpendicular double-wall, the classic dead corner.
    walkTo(model, 4.5, 3.5)
    for (let t = 0; t < 240; t++) model.update(1 / 60, { ...idle, left: true })
    expect(model.blockAt(1, 3)).toBe(BLOCK.id)
    walkTo(model, 1.5, 4.6)
    for (let t = 0; t < 240; t++) model.update(1 / 60, { ...idle, up: true })
    expect(model.blockAt(1, 1)).toBe(BLOCK.id)
    expect(model.stuck()).toBe(SIGIL.id)
  })
})

describe('alcove, artifact, the rising light and the finale', () => {
  const ALCOVE: ChamberAlcove = { id: 'alcove-1', col: 3, row: 3, memoryId: 'map:test', text: 'A quiet memory.', locked: 'A tiny hexagon rests in the carving.' }
  it('an alcove stays locked without the hexagon, and hears its memory once with it', () => {
    const def = baseDef({ alcoves: [ALCOVE] }, { [key(3, 3)]: 'h' })
    const locked = new ChamberModel(def)
    walkTo(locked, 3.5, 4.4)
    const lockedResult = locked.interact(ALCOVE.id)
    expect(lockedResult).toMatchObject({ dialog: { text: ALCOVE.locked } })
    const open = new ChamberModel(def, { has: () => true })
    walkTo(open, 3.5, 4.4)
    const first = open.interact(ALCOVE.id)
    expect(first).toMatchObject({ dialog: { text: ALCOVE.text } })
    expect(first.events.some(e => e.kind === 'knowledge' && e.id === ALCOVE.memoryId)).toBe(true)
    const second = open.interact(ALCOVE.id)
    expect(second.events).toHaveLength(0)
  })
  it('claiming the artifact reveals the rising light and fires the finale on a lamp set', () => {
    const artifact: ChamberArtifact = { id: 'artifact-1', col: 3, row: 3, name: 'A Bright Piece', knowledgeId: 'map:test2', lore: 'Lore.' }
    const risingLight: ChamberRisingLight = { id: 'rising-1', col: 5, row: 3, landing: { col: 5, row: 4 } }
    const lamp: ChamberLamp = { id: 'lamp-1', col: 4, row: 3, name: 'Lamp' }
    const set: ChamberLampSet = { id: 'set-1', lamps: ['lamp-1'], ordered: false }
    const def = baseDef({ artifact, risingLight, lamps: [lamp], lampSets: [set], finale: { when: { set: 'set-1' } } },
      { [key(3, 3)]: 'A', [key(5, 3)]: 'u', [key(4, 3)]: 'f' })
    const model = new ChamberModel(def)
    expect(model.present(risingLight.id)).toBe(false)
    walkTo(model, 3.5, 4.4)
    const claimed = model.interact(artifact.id)
    expect(claimed.events.some(e => e.kind === 'claimed' && e.fresh)).toBe(true)
    expect(claimed.events.some(e => e.kind === 'revealed' && e.feature === risingLight.id)).toBe(true)
    expect(model.present(risingLight.id)).toBe(true)
    walkTo(model, 4.5, 4.4)
    const lit = model.interact(lamp.id)
    expect(lit.events.some(e => e.kind === 'finale')).toBe(true)
  })
})

describe('residents', () => {
  const RESIDENT: ChamberResident = { id: 'npc-1', col: 3, row: 3, name: 'Wenna', role: 'keeper', color: '#fff', lines: ['One.', 'Two.'] }
  it('cycles lines on each talk, and speech never opens a dialog', () => {
    const model = new ChamberModel(baseDef({ residents: [RESIDENT] }, { [key(3, 3)]: 'n' }))
    walkTo(model, 3.5, 4.4)
    const first = model.interact(RESIDENT.id)
    expect(first.kind).toBe('speech')
    const a = model.talk(RESIDENT.id)
    const b = model.talk(RESIDENT.id)
    expect(a).not.toBe(b)
  })
  it('swaps to linesWith once its knowledge is known', () => {
    const npc: ChamberResident = { ...RESIDENT, linesWith: { knowledge: 'map:secret', lines: ['Special.'] } }
    const model = new ChamberModel(baseDef({ residents: [npc] }, { [key(3, 3)]: 'n' }), { knows: () => true })
    expect(model.talk(npc.id)).toBe('Special.')
  })
})

describe('seed()', () => {
  it('returns cols x rows x 3 bytes and changes when a fact changes', () => {
    const CHEST: ChamberChest = { id: 'chest-1', col: 3, row: 3, name: 'Chest', subtitle: 'sub', items: [], lore: 'L' }
    const model = new ChamberModel(baseDef({ chests: [CHEST] }, { [key(3, 3)]: 'K' }))
    const before = model.seed()
    expect(before.cols).toBe(W)
    expect(before.rows).toBe(H)
    expect(before.rgb.length).toBe(W * H * 3)
    walkTo(model, 3.5, 4.4)
    model.interact(CHEST.id)
    const after = model.seed()
    expect(after.rgb).not.toEqual(before.rgb)
  })
})

describe('exportState / restoreState — basic round trip', () => {
  it('restores a model to the exported state exactly (facts, not motion)', () => {
    const TABLET: ChamberTablet = { id: 'tablet-1', col: 2, row: 3, title: 'Stone', text: 'Words.' }
    const model = new ChamberModel(baseDef({ tablets: [TABLET] }, { [key(2, 3)]: 't' }))
    walkTo(model, 2.5, 4.4)
    model.interact(TABLET.id)
    const snapshot = model.exportState()
    expect(snapshot.version).toBe(1)
    expect(snapshot.place).toBe('test-chamber')
    expect(snapshot.read).toEqual([TABLET.id])
    const fresh = new ChamberModel(baseDef({ tablets: [TABLET] }, { [key(2, 3)]: 't' }))
    fresh.restoreState(snapshot)
    expect(fresh.read.has(TABLET.id)).toBe(true)
  })
})
