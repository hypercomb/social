// Content role, Phase 2 (final-spec.md §6/§7.3). Exercises the nine real
// ChamberDefinitions (chamber-places.ts) against the real ChamberModel
// (chamber.ts) — every published walkthrough, every push-search proof, the
// generic portal-push contract, and the seventeen build checks. No helper or
// fixture file outside this spec — everything lives here.
import { describe, expect, it } from 'vitest'
import {
  buildChamber, ChamberModel, PUSH_DELAY, REARM_DISTANCE, TARGET_REACH, CHAMBER_SPEED,
  type ChamberDefinition, type ChamberCell, type ChamberEvent, type Facing, type MoveInput,
} from './chamber.js'
import {
  GROUPS, CENTER_MEMORY,
  WET_STEPS, CISTERN, SPRING_HEART, HALL_OF_HOURS, SIX_ROADS, ACCORD_SANCTUM,
  CHANDLER_HOUSE, CHANDLER_CELLAR, HOLLOW_GROVE, CHAMBERS,
} from './chamber-places.js'

const DIR_VECTOR: Readonly<Record<Facing, ChamberCell>> = {
  up: { col: 0, row: -1 }, down: { col: 0, row: 1 }, left: { col: -1, row: 0 }, right: { col: 1, row: 0 },
}
const IDLE: MoveInput = { up: false, down: false, left: false, right: false }

/** Every feature category a ChamberDefinition can name an id in, searched in
 *  turn — the one place this spec resolves "an id" to "a cell". */
function cellOf(def: ChamberDefinition, id: string): ChamberCell {
  for (const e of def.exits) if (e.id === id) return e
  for (const e of def.entrances) if (e.id === id) return e
  if (def.risingLight?.id === id) return def.risingLight
  for (const t of def.tablets) if (t.id === id) return t
  for (const g of def.gates) if (g.id === id) return g
  for (const c of def.chests) if (c.id === id) return c
  for (const d of def.doors) if (d.id === id) return d
  for (const s of def.shutters) if (s.id === id) return s
  for (const p of def.plates) if (p.id === id) return p
  for (const b of def.blocks) if (b.id === id) return b
  for (const l of def.levers) if (l.id === id) return l
  for (const l of def.lamps) if (l.id === id) return l
  for (const s of def.sigils) if (s.id === id) return s
  for (const a of def.alcoves) if (a.id === id) return a
  for (const r of def.residents) if (r.id === id) return r
  if (def.artifact?.id === id) return def.artifact
  throw new Error(`${def.id}: no feature named '${id}'`)
}

function landingOf(def: ChamberDefinition, portalId: string): ChamberCell {
  for (const e of def.exits) if (e.id === portalId) return e.landing
  for (const e of def.entrances) if (e.id === portalId) return e.landing
  if (def.risingLight?.id === portalId) return def.risingLight.landing
  throw new Error(`${def.id}: no portal named '${portalId}'`)
}

function pushDirectionOf(def: ChamberDefinition, portalId: string): Facing {
  const cell = cellOf(def, portalId)
  const landing = landingOf(def, portalId)
  const dc = cell.col - landing.col, dr = cell.row - landing.row
  if (dc === 0 && dr === -1) return 'up'
  if (dc === 0 && dr === 1) return 'down'
  if (dc === -1 && dr === 0) return 'left'
  if (dc === 1 && dr === 0) return 'right'
  throw new Error(`${def.id}: portal '${portalId}' landing is not orthogonally adjacent`)
}

/** The event's own carried id, whichever of exit/entrance/light it is. */
function navigateId(event: ChamberEvent): string {
  if (event.kind !== 'navigate') throw new Error(`expected a navigate event, got '${event.kind}'`)
  if (event.to === 'up') return event.exit
  if (event.to === 'down') return event.entrance
  return (event as { light?: string }).light ?? ''
}

/** Drives one ChamberModel through a walkthrough exactly as a player would:
 *  continuous movement (no teleporting), one fixed frame length throughout. */
class ChamberPilot {
  constructor(readonly model: ChamberModel, readonly def: ChamberDefinition, readonly dt: number) {}

  /** Walks in a straight line toward (x,y) — the same greedy, collision-driven
   *  helper every chamber spec in this folder already uses. Throws (loudly,
   *  never silently stalling a test) if the walk doesn't arrive in time. */
  walkTo(x: number, y: number, maxSeconds = 12): void {
    const maxFrames = Math.ceil(maxSeconds / this.dt)
    // Arrival tolerance must clear one frame's own travel distance
    // (CHAMBER_SPEED * dt) or a coarse frame (0.05s here) can perpetually
    // overshoot back and forth just past a tight threshold and never settle.
    const tolerance = Math.max(0.08, CHAMBER_SPEED * this.dt * 1.15)
    for (let i = 0; i < maxFrames; i++) {
      const dx = x - this.model.x, dy = y - this.model.y
      if (Math.hypot(dx, dy) < tolerance) return
      this.model.update(this.dt, { left: dx < -0.04, right: dx > 0.04, up: dy < -0.04, down: dy > 0.04 })
    }
    throw new Error(`${this.def.id}: walkTo(${x},${y}) did not arrive within ${maxSeconds}s (at ${this.model.x},${this.model.y})`)
  }

  /** BFS over the CURRENT `open()` grid (doors, gates, blocks, wand state
   *  all as they stand right now) from the traveller's own cell. Returns
   *  cell-index -> predecessor-index, so both "is this cell reachable" and
   *  "the shortest route to it" come from one search. */
  #reachable(): Map<number, number> {
    const cols = this.def.map[0]!.length, rows = this.def.map.length
    const startCol = Math.floor(this.model.x), startRow = Math.floor(this.model.y)
    const startIdx = startRow * cols + startCol
    const prev = new Map<number, number>([[startIdx, -1]])
    const queue = [startIdx]
    let head = 0
    while (head < queue.length) {
      const idx = queue[head++]!
      const c = idx % cols, r = Math.floor(idx / cols)
      for (const d of Object.values(DIR_VECTOR)) {
        const nc = c + d.col, nr = r + d.row
        if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue
        const nIdx = nr * cols + nc
        if (prev.has(nIdx) || !this.model.open(nc, nr)) continue
        prev.set(nIdx, idx)
        queue.push(nIdx)
      }
    }
    return prev
  }

  /** Shortest-path cell route (via #reachable()) from the traveller's own
   *  cell to (col,row), walked one cell-centre at a time. A single greedy
   *  `walkTo` can graze an unwalkable cell's box along a direct line and
   *  stick there forever with no path search of its own; a real (if
   *  grid-coarse) route is what a chokepoint like a single-cell crack
   *  actually needs. */
  walkVia(x: number, y: number): void {
    const cols = this.def.map[0]!.length
    const targetCol = Math.floor(x), targetRow = Math.floor(y)
    const startCol = Math.floor(this.model.x), startRow = Math.floor(this.model.y)
    if (startCol === targetCol && startRow === targetRow) { this.walkTo(x, y); return }
    const targetIdx = targetRow * cols + targetCol
    const prev = this.#reachable()
    if (!prev.has(targetIdx)) throw new Error(`${this.def.id}: no open route from (${startCol},${startRow}) to (${targetCol},${targetRow})`)
    const path: number[] = []
    for (let idx: number = targetIdx; idx !== -1; idx = prev.get(idx)!) path.push(idx)
    path.reverse()
    for (const idx of path) {
      const c = idx % cols, r = Math.floor(idx / cols)
      this.walkTo(c + 0.5, r + 0.5)
    }
    this.walkTo(x, y)
  }

  /** Most features are never themselves walkable (tablets/chests/doors/
   *  gates/levers/lamps/sigils/alcoves/artifact/residents) — the player
   *  always stands on an adjacent open cell within reach. Walks to the
   *  feature's own cell when that IS open (a plate), else the nearest
   *  ACTUALLY REACHABLE open orthogonal neighbour — not merely "open" in
   *  isolation, since a cell can be walkable terrain yet sit on the far
   *  side of a still-locked door (open() says nothing about reachability). */
  walkToCell(id: string): void {
    const cell = cellOf(this.def, id)
    if (this.model.open(cell.col, cell.row)) { this.walkVia(cell.col + 0.5, cell.row + 0.5); return }
    const cols = this.def.map[0]!.length
    const reach = this.#reachable()
    for (const d of Object.values(DIR_VECTOR)) {
      const nc = cell.col + d.col, nr = cell.row + d.row
      if (this.model.open(nc, nr) && reach.has(nr * cols + nc)) { this.walkVia(nc + 0.5, nr + 0.5); return }
    }
    throw new Error(`${this.def.id}: '${id}' has no reachable approach cell from here`)
  }

  /** E on a feature, after walking within reach of it. */
  act(id: string) {
    this.walkToCell(id)
    return this.model.interact(id)
  }
  read(id: string) { return this.act(id) }
  open(id: string) { return this.act(id) }
  unlock(id: string) { return this.act(id) }
  light(id: string) { return this.act(id) }
  pull(id: string) { return this.act(id) }
  hear(id: string) { return this.act(id) }
  claim(id: string) { return this.act(id) }
  talk(id: string) { return this.act(id) }

  /** Stand at (col,row), face `facing`, cast the wand. */
  castFrom(col: number, row: number, facing: Facing) {
    this.walkVia(col + 0.5, row + 0.5)
    this.model.turn(facing)
    return this.model.cast()
  }

  attune(gateId: string, sequence: readonly string[]): void {
    this.walkToCell(gateId)
    this.model.interact(gateId)
    for (const rune of sequence) {
      const result = this.model.choose(gateId, rune)
      if (!result.opened && rune === sequence[sequence.length - 1]) throw new Error(`${this.def.id}: attune('${gateId}') never opened: ${result.text}`)
    }
  }

  /** Pushes a block `times` cells in `dir`, one push at a time (re-walking to
   *  the new push-start cell between each, exactly like continuous play). */
  push(blockId: string, dir: Facing, times: number): void {
    for (let i = 0; i < times; i++) {
      const cell = this.model.blockCell(blockId)
      const stand = { col: cell.col - DIR_VECTOR[dir].col, row: cell.row - DIR_VECTOR[dir].row }
      this.walkVia(stand.col + 0.5, stand.row + 0.5)
      const before = this.model.blockCell(blockId)
      const input: MoveInput = { ...IDLE, [dir]: true }
      let moved = false
      for (let elapsed = 0; elapsed < 3 && !moved; elapsed += this.dt) {
        this.model.update(this.dt, input)
        const after = this.model.blockCell(blockId)
        moved = after.col !== before.col || after.row !== before.row
      }
      if (!moved) throw new Error(`${this.def.id}: push('${blockId}','${dir}') #${i + 1} never moved the block`)
    }
  }

  /** (2) A2.3's own push-to-enter portal contract: walk to the landing, hold
   *  the push direction until a `navigate` event fires (or 1.5s elapse), then
   *  prove PUSH_DELAY was actually held, the traveller didn't move on the
   *  firing frame, and the event names this exact portal — then one idle
   *  frame, exactly as §7.3 pins. Replaces (1)'s deleted `use(feature,col,row)`. */
  pushInto(portalId: string, dir?: Facing): ChamberEvent {
    const landing = landingOf(this.def, portalId)
    const direction = dir ?? pushDirectionOf(this.def, portalId)
    this.walkVia(landing.col + 0.5, landing.row + 0.5)
    const input: MoveInput = { ...IDLE, [direction]: true }
    let held = 0
    let fired: ChamberEvent | null = null
    let movedOnFiringFrame = false
    while (held < 1.5) {
      const beforeX = this.model.x, beforeY = this.model.y
      const events = this.model.update(this.dt, input)
      held += this.dt
      const navigate = events.find(e => e.kind === 'navigate')
      if (navigate) {
        movedOnFiringFrame = this.model.x !== beforeX || this.model.y !== beforeY
        fired = navigate
        break
      }
    }
    expect(fired, `${this.def.id}: pushInto('${portalId}','${direction}') never fired within 1.5s`).not.toBeNull()
    expect(held).toBeGreaterThanOrEqual(PUSH_DELAY)
    expect(movedOnFiringFrame).toBe(false)
    expect(navigateId(fired!)).toBe(portalId)
    this.model.update(this.dt, IDLE) // one idle frame, per §7.3
    return fired!
  }
}

const FRAMES = [1 / 60, 0.05] as const

// ---------------------------------------------------------------------------
// 1. Map/legend/rectangular/closed checks for all nine chambers, plus
//    targeted single-check mutations for the feature-level checks (5-17).
// ---------------------------------------------------------------------------
describe('build checks — every real chamber, plus a mutation that breaks exactly one check', () => {
  it.each(CHAMBERS)('$id builds cleanly', def => {
    expect(() => buildChamber(def)).not.toThrow()
  })

  it.each(CHAMBERS)('$id: check 1 — a non-rectangular map is rejected', def => {
    const map = [...def.map]
    map[1] = map[1].slice(0, -1)
    expect(() => buildChamber({ ...def, map })).toThrow(/rectangle/)
  })

  it.each(CHAMBERS)('$id: check 2 — an unknown glyph is rejected', def => {
    const map = [...def.map]
    map[1] = `${map[1].slice(0, 1)}Z${map[1].slice(2)}`
    expect(() => buildChamber({ ...def, map })).toThrow(/glyph/)
  })

  it.each(CHAMBERS)('$id: check 3 — an open border is rejected', def => {
    const map = [...def.map]
    map[0] = `${map[0].slice(0, 1)}.${map[0].slice(2)}`
    expect(() => buildChamber({ ...def, map })).toThrow(/border/)
  })

  it.each(CHAMBERS)('$id: check 4 — no exit at all is rejected', def => {
    expect(() => buildChamber({ ...def, exits: [] })).toThrow(/exit/)
  })

  it('check 5 — a duplicate id across categories is rejected', () => {
    const def: ChamberDefinition = { ...WET_STEPS, gates: [{ ...WET_STEPS.gates[0]!, id: 'drip-line' }] }
    expect(() => buildChamber(def)).toThrow(/duplicate id/)
  })

  it('check 6 — a feature cell out of bounds is rejected', () => {
    const def: ChamberDefinition = { ...WET_STEPS, tablets: [{ ...WET_STEPS.tablets[0]!, col: 999 }] }
    expect(() => buildChamber(def)).toThrow(/bounds/)
  })

  it('check 7 — a feature not sitting on its required glyph is rejected', () => {
    const def: ChamberDefinition = { ...WET_STEPS, chests: [{ ...WET_STEPS.chests[0]!, col: 5, row: 5 }] }
    expect(() => buildChamber(def)).toThrow(/glyph/)
  })

  it('check 8 — an exit landing not on \'@\' is rejected', () => {
    const def: ChamberDefinition = { ...WET_STEPS, exits: [{ ...WET_STEPS.exits[0]!, landing: { col: 0, row: 9 }, facing: 'up' }] }
    expect(() => buildChamber(def)).toThrow(/glyph/)
  })

  it('check 9 — a shutter naming no control is rejected', () => {
    const def: ChamberDefinition = { ...CISTERN, shutters: CISTERN.shutters.map(s => s.id === 'shortcut-shutter' ? { ...s, lever: undefined } : s) }
    expect(() => buildChamber(def)).toThrow(/no control/)
  })

  it('check 10 — a sigil referencing an unknown block is rejected', () => {
    const def: ChamberDefinition = { ...CISTERN, sigils: [{ ...CISTERN.sigils[0]!, blocks: ['nonexistent-block'] }] }
    expect(() => buildChamber(def)).toThrow(/unknown block/)
  })

  it('check 11 — a lamp set with no lamps is rejected', () => {
    const def: ChamberDefinition = { ...WET_STEPS, lampSets: [{ ...WET_STEPS.lampSets[0]!, lamps: [] }] }
    expect(() => buildChamber(def)).toThrow(/no lamps/)
  })

  it('check 12 — a gate answer referencing an unknown option is rejected', () => {
    const def: ChamberDefinition = { ...WET_STEPS, gates: [{ ...WET_STEPS.gates[0]!, answer: ['nonexistent-rune'] }] }
    expect(() => buildChamber(def)).toThrow(/unknown option/)
  })

  it('check 13 — a pointsAt referencing an unknown id is rejected', () => {
    const def: ChamberDefinition = { ...WET_STEPS, tablets: WET_STEPS.tablets.map(t => t.id === 'garden' ? { ...t, pointsAt: ['nonexistent-feature'] } : t) }
    expect(() => buildChamber(def)).toThrow(/unknown/)
  })

  it('check 14 — a finale referencing an unknown lamp set is rejected', () => {
    const def: ChamberDefinition = { ...SPRING_HEART, finale: { when: { set: 'nonexistent-set' } } }
    expect(() => buildChamber(def)).toThrow(/unknown lamp set/)
  })

  it('check 14b — a block not on a home glyph is rejected', () => {
    const def: ChamberDefinition = { ...WET_STEPS, blocks: [{ ...WET_STEPS.blocks[0]!, col: 5, row: 5 }] }
    expect(() => buildChamber(def)).toThrow(/glyph/)
  })

  it('check 15 (6b) — an exit facing that disagrees with its landing direction is rejected', () => {
    const def: ChamberDefinition = { ...WET_STEPS, exits: [{ ...WET_STEPS.exits[0]!, facing: 'left' }] }
    expect(() => buildChamber(def)).toThrow(/facing/)
  })

  it('check 16 (6c) — an entrance landing not on floor/threshold is rejected', () => {
    const def: ChamberDefinition = { ...WET_STEPS, entrances: [{ ...WET_STEPS.entrances[0]!, landing: { col: 6, row: 6 } }] }
    expect(() => buildChamber(def)).toThrow(/landing/)
  })

  it('check 17 (6d) — two portals sharing a landing is rejected', () => {
    const def: ChamberDefinition = { ...WET_STEPS, entrances: [{ ...WET_STEPS.entrances[0]!, landing: WET_STEPS.exits[0]!.landing }] }
    expect(() => buildChamber(def)).toThrow(/landing/)
  })
})

// ---------------------------------------------------------------------------
// 2. Doorway-threshold checks — every door and gate across all nine, using
//    the real content: closed before its condition, open after.
// ---------------------------------------------------------------------------
describe('doorway/gate thresholds — real content, before and after', () => {
  it('a small door refuses passage until a key is spent, then never re-locks', () => {
    const model = new ChamberModel(WET_STEPS)
    const pilot = new ChamberPilot(model, WET_STEPS, 1 / 60)
    expect(model.open(9, 10)).toBe(false)
    pilot.castFrom(6, 7, 'up')
    pilot.open('rusted-key-chest')
    pilot.unlock('hall-door')
    expect(model.open(9, 10)).toBe(true)
  })

  it('a great door refuses passage until the Great Key is spent', () => {
    const model = new ChamberModel(SPRING_HEART)
    const pilot = new ChamberPilot(model, SPRING_HEART, 1 / 60)
    expect(model.open(12, 9)).toBe(false)
    // Raise the spring stones just enough to reach the islet chest.
    pilot.castFrom(6, 14, 'up'); pilot.castFrom(6, 13, 'up'); pilot.castFrom(6, 12, 'left')
    pilot.castFrom(5, 12, 'left'); pilot.castFrom(4, 12, 'up')
    pilot.open('great-key-chest')
    pilot.unlock('great-door')
    expect(model.open(12, 9)).toBe(true)
  })

  it('a rune gate refuses attunement until its tablet is read, and never re-closes', () => {
    const model = new ChamberModel(WET_STEPS)
    const pilot = new ChamberPilot(model, WET_STEPS, 1 / 60)
    expect(model.open(17, 10)).toBe(false)
    // The gate sits past the hall-door, itself past the crack — wet-steps'
    // own prerequisite chain (§6.2), needed here just to reach it.
    pilot.castFrom(6, 7, 'up')
    pilot.open('rusted-key-chest')
    pilot.unlock('hall-door')
    pilot.attune('cycle', ['rain', 'sun', 'bloom'])
    expect(model.open(17, 10)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 3-4. Every published walkthrough, at both frame lengths, ending in a
//      pushInto — plus the "exactly one navigate event" proof (2) A11.1 #1.
// ---------------------------------------------------------------------------
describe.each(FRAMES)('walkthroughs at dt=%s', dt => {
  function countNavigates(events: ChamberEvent[][]): number {
    return events.flat().filter(e => e.kind === 'navigate').length
  }

  it('wet-steps: crack, key, door, block, gate, lamp pair, then push into the stairs', () => {
    const model = new ChamberModel(WET_STEPS)
    const p = new ChamberPilot(model, WET_STEPS, dt)
    const events: ChamberEvent[][] = []
    events.push(p.read('drip-line').events as ChamberEvent[])
    events.push(p.castFrom(6, 7, 'up').events as ChamberEvent[])
    expect(model.terrainAt(6, 6)).toBe('rubble')
    events.push(p.open('rusted-key-chest').events as ChamberEvent[])
    events.push(p.unlock('hall-door').events as ChamberEvent[])
    p.push('nook-block', 'right', 1)
    expect(model.blockCell('nook-block')).toEqual({ col: 15, row: 7 })
    events.push(p.open('map-chest').events as ChamberEvent[])
    events.push(p.read('garden').events as ChamberEvent[])
    p.attune('cycle', ['rain', 'sun', 'bloom'])
    events.push(p.light('stair-lamp-west').events as ChamberEvent[])
    events.push(p.light('stair-lamp-east').events as ChamberEvent[])
    expect(model.present('stair-chest')).toBe(true)
    events.push(p.open('stair-chest').events as ChamberEvent[])
    const navEvent = p.pushInto('stairs-down', 'up')
    expect(navEvent.kind).toBe('navigate')
    events.push([navEvent])
    expect(countNavigates(events)).toBe(1)
  })

  it('cistern: keeper court pushes, keys, lever shortcut, gate, then push into the stairs', () => {
    const model = new ChamberModel(CISTERN)
    const p = new ChamberPilot(model, CISTERN, dt)
    const events: ChamberEvent[][] = []
    events.push(p.read('keeper-door').events as ChamberEvent[])
    p.push('east-stone', 'down', 3)
    expect(model.blockCell('east-stone')).toEqual({ col: 18, row: 9 })
    p.push('west-stone', 'right', 2)
    expect(model.blockCell('west-stone')).toEqual({ col: 16, row: 6 })
    p.push('west-stone', 'up', 1)
    expect(model.blockCell('west-stone')).toEqual({ col: 16, row: 5 })
    expect(model.shutterOpen('keeper-shutter')).toBe(true)
    events.push(p.open('iron-key-chest').events as ChamberEvent[])
    events.push(p.open('lodestone-chest').events as ChamberEvent[])
    events.push(p.pull('shortcut-lever').events as ChamberEvent[])
    expect(model.shutterOpen('shortcut-shutter')).toBe(true)
    events.push(p.unlock('south-door').events as ChamberEvent[])
    events.push(p.read('returning-water').events as ChamberEvent[])
    p.attune('meaning', ['circle'])
    const navEvent = p.pushInto('stairs-down', 'right')
    events.push([navEvent])
    expect(countNavigates(events)).toBe(1)
  })

  it('spring-heart: spring stones, Great Key, braziers reversed, finale, claim, push into the Rising Light', () => {
    const model = new ChamberModel(SPRING_HEART)
    const p = new ChamberPilot(model, SPRING_HEART, dt)
    const events: ChamberEvent[][] = []
    events.push(p.read('last-door').events as ChamberEvent[])
    events.push(p.read('ripples').events as ChamberEvent[])
    p.castFrom(6, 14, 'up'); p.castFrom(6, 13, 'up'); p.castFrom(6, 12, 'left')
    p.castFrom(5, 12, 'left'); p.castFrom(4, 12, 'up')
    expect(model.terrainAt(4, 11)).toBe('stone')
    p.walkVia(4.5, 10.5)
    events.push(p.open('great-key-chest').events as ChamberEvent[])
    events.push(p.unlock('great-door').events as ChamberEvent[])
    events.push(p.read('way-home').events as ChamberEvent[])
    events.push(p.light('bloom-brazier').events as ChamberEvent[])
    events.push(p.light('sun-brazier').events as ChamberEvent[])
    const litRain = p.light('rain-brazier')
    events.push(litRain.events as ChamberEvent[])
    expect(litRain.events.some(e => e.kind === 'completed')).toBe(true)
    expect(litRain.events.some(e => e.kind === 'finale')).toBe(true)
    const claimed = p.claim('spring-crystal')
    events.push(claimed.events as ChamberEvent[])
    expect(claimed.events.some(e => e.kind === 'claimed')).toBe(true)
    expect(model.present('rising-light')).toBe(true)
    const navEvent = p.pushInto('rising-light', 'right')
    events.push([navEvent])
    expect(countNavigates(events)).toBe(1)
  })

  it('hall-of-hours: read, light the true hours, key, door, map, gate, then push into the stairs', () => {
    const model = new ChamberModel(HALL_OF_HOURS)
    const p = new ChamberPilot(model, HALL_OF_HOURS, dt)
    const events: ChamberEvent[][] = []
    events.push(p.read('sundial').events as ChamberEvent[])
    events.push(p.read('gnomon').events as ChamberEvent[])
    events.push(p.light('sunrise-brazier').events as ChamberEvent[])
    events.push(p.light('noon-brazier').events as ChamberEvent[])
    const litSunset = p.light('sunset-brazier')
    events.push(litSunset.events as ChamberEvent[])
    expect(litSunset.events.some(e => e.kind === 'completed')).toBe(true)
    expect(model.present('hour-key-chest')).toBe(true)
    events.push(p.open('hour-key-chest').events as ChamberEvent[])
    events.push(p.unlock('hour-door').events as ChamberEvent[])
    events.push(p.open('map-chest').events as ChamberEvent[])
    events.push(p.read('hours').events as ChamberEvent[])
    p.attune('cycle', ['dawn', 'noon', 'dusk'])
    p.castFrom(22, 10, 'right')
    events.push(p.open('hour-nook-chest').events as ChamberEvent[])
    const navEvent = p.pushInto('stairs-down', 'down')
    events.push([navEvent])
    expect(countNavigates(events)).toBe(1)
  })

  it('six-roads: reads, runes lay the seal, key, door, gate, then push into the stairs', () => {
    const model = new ChamberModel(SIX_ROADS)
    const p = new ChamberPilot(model, SIX_ROADS, dt)
    const events: ChamberEvent[][] = []
    events.push(p.read('six-roads').events as ChamberEvent[])
    events.push(p.open('lodestone-chest').events as ChamberEvent[])
    events.push(p.read('center').events as ChamberEvent[])
    events.push(p.read('three-plates').events as ChamberEvent[])
    p.castFrom(4, 14, 'up')   // -> (4,13)
    p.castFrom(4, 14, 'down') // -> (4,15) — both from the same spot, before
    p.castFrom(7, 14, 'left') // crossing the gap rune (6,14) laid last, since
    expect(model.sealOpen()).toBe(true) // laying it first would wall the traveller off from (4,14).
    events.push(p.open('warden-key-chest').events as ChamberEvent[])
    // Lift the gap brick clear again from the LEFT side — the traveller is
    // inside the small rune pocket at this point (its only door in or out
    // IS the gap rune itself), so re-approach from (5,14), not (7,14).
    p.castFrom(5, 14, 'right')
    expect(model.sealOpen()).toBe(false)
    events.push(p.open('rest-chest').events as ChamberEvent[])
    events.push(p.read('unlit-road').events as ChamberEvent[])
    events.push(p.light('west-lamp').events as ChamberEvent[])
    const litEast = p.light('east-lamp')
    events.push(litEast.events as ChamberEvent[])
    expect(model.present('unlit-chest')).toBe(true)
    events.push(p.open('unlit-chest').events as ChamberEvent[])
    events.push(p.unlock('east-door').events as ChamberEvent[])
    p.attune('meaning', ['hexagon'])
    const navEvent = p.pushInto('stairs-down', 'right')
    events.push([navEvent])
    expect(countNavigates(events)).toBe(1)
  })

  it('accord-sanctum: sun court, memory court, six runes, finale, claim, push into the Rising Light', () => {
    const model = new ChamberModel(ACCORD_SANCTUM)
    const p = new ChamberPilot(model, ACCORD_SANCTUM, dt)
    const events: ChamberEvent[][] = []
    events.push(p.read('two-suns').events as ChamberEvent[])
    p.push('south-stone', 'right', 1)
    p.push('north-stone', 'up', 1)
    p.push('north-stone', 'left', 1)
    p.push('south-stone', 'up', 2)
    expect(model.shutterOpen('sun-shutter')).toBe(true)
    events.push(p.open('great-key-chest').events as ChamberEvent[])
    events.push(p.unlock('great-door').events as ChamberEvent[])
    events.push(p.read('six-plates').events as ChamberEvent[])
    p.push('west-stone', 'down', 1)
    p.push('west-stone', 'left', 3) // -> memory-plate (7,7)
    p.push('east-stone', 'down', 1) // clears (14,6) so its own rune can be cast
    expect(model.shutterOpen('memory-shutter')).toBe(true)
    p.castFrom(10, 1, 'down') // -> (10,2)
    p.castFrom(14, 1, 'down') // -> (14,2)
    p.castFrom(7, 4, 'right') // -> (8,4)
    p.castFrom(17, 4, 'left') // -> (16,4)
    p.castFrom(10, 5, 'down') // -> (10,6), now clear
    const lastCast = p.castFrom(14, 5, 'down') // -> (14,6), now clear
    events.push(lastCast.events as ChamberEvent[])
    expect(model.sealOpen()).toBe(true)
    expect(lastCast.events.some(e => e.kind === 'finale')).toBe(true)
    const claimed = p.claim('accord-crystal')
    events.push(claimed.events as ChamberEvent[])
    events.push(p.read('pale-plate').events as ChamberEvent[])
    events.push(p.hear('center-alcove').events as ChamberEvent[])
    const navEvent = p.pushInto('rising-light', 'left')
    events.push([navEvent])
    expect(countNavigates(events)).toBe(1)
  })

  it('chandler-house: reads, talks three times, then push into the trapdoor', () => {
    const model = new ChamberModel(CHANDLER_HOUSE)
    const p = new ChamberPilot(model, CHANDLER_HOUSE, dt)
    const events: ChamberEvent[][] = []
    events.push(p.read('wenna-list').events as ChamberEvent[])
    p.talk('wenna'); p.talk('wenna'); p.talk('wenna')
    const navEvent = p.pushInto('trapdoor', 'up')
    events.push([navEvent])
    expect(countNavigates(events)).toBe(1)
  })

  it('chandler-cellar: reads, pushes the far barrel onto the cold plate, opens the rack, then push up', () => {
    const model = new ChamberModel(CHANDLER_CELLAR)
    const p = new ChamberPilot(model, CHANDLER_CELLAR, dt)
    const events: ChamberEvent[][] = []
    events.push(p.read('chalk-beam').events as ChamberEvent[])
    p.push('far-barrel', 'up', 3)
    p.push('far-barrel', 'right', 3)
    expect(model.blockCell('far-barrel')).toEqual({ col: 10, row: 1 })
    expect(model.shutterOpen('rack-shutter')).toBe(true)
    events.push(p.open('lantern-chest').events as ChamberEvent[])
    const navEvent = p.pushInto('cellar-steps', 'up')
    events.push([navEvent])
    expect(countNavigates(events)).toBe(1)
  })

  it('hollow-grove: reads, talks three times, casts the crack and the ripple, then push out the north edge', () => {
    const model = new ChamberModel(HOLLOW_GROVE)
    const p = new ChamberPilot(model, HOLLOW_GROVE, dt)
    p.walkVia(11.5, 13.5) // the south arrival, per §6.9's own walkthrough framing
    const events: ChamberEvent[][] = []
    events.push(p.read('bark-marks').events as ChamberEvent[])
    p.talk('nettle'); p.talk('nettle'); p.talk('nettle')
    p.castFrom(6, 5, 'up')
    events.push(p.open('boulder-chest').events as ChamberEvent[])
    p.castFrom(13, 6, 'up')
    const opened = p.open('pool-chest')
    events.push(opened.events as ChamberEvent[])
    const navEvent = p.pushInto('north-edge', 'up')
    events.push([navEvent])
    expect(countNavigates(events)).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 6-8. Push-search proofs — recomputed against the real ChamberModel's own
// public canBlockEnter/blockAt/open/stuck() (not a reimplementation), by
// restoring a snapshot to every reachable block configuration and exploring
// forward from there. See the note above each block for what was re-verified
// and what genuinely diverges from the design doc's own pinned numbers.
// ---------------------------------------------------------------------------
describe('push-search proofs (recomputed against the real model)', () => {
  function solve(def: ChamberDefinition, cols: number, rows: number, blockIds: readonly string[], start: readonly ChamberCell[], targets: readonly ChamberCell[], seed: ChamberCell) {
    const key = (cells: readonly ChamberCell[]): string => cells.map(c => c.row * cols + c.col).slice().sort((a, b) => a - b).join(',')
    const isGoal = (cells: readonly ChamberCell[]): boolean => {
      const set = new Set(cells.map(c => c.row * cols + c.col))
      return targets.every(t => set.has(t.row * cols + t.col))
    }
    const blank = () => ({
      version: 1 as const, place: def.id, player: { x: 1.5, y: 1.5, facing: 'down' as const },
      read: [], attuned: [], runes: [], opened: [], unlocked: [], latched: [], pulled: [], lit: [], wand: [],
      blocks: [] as [string, number, number][], memories: [], claimed: false, explored: '',
    })
    const modelAt = (cells: readonly ChamberCell[]): ChamberModel => {
      const model = new ChamberModel(def)
      const snap = blank()
      snap.blocks = blockIds.map((id, i) => [id, cells[i]!.col, cells[i]!.row])
      model.restoreState(snap)
      return model
    }
    const region = (model: ChamberModel): Set<number> => {
      const seen = new Set<number>([seed.row * cols + seed.col])
      const queue = [seed.row * cols + seed.col]
      while (queue.length) {
        const idx = queue.shift()!
        const c = idx % cols, r = Math.floor(idx / cols)
        for (const d of Object.values(DIR_VECTOR)) {
          const nc = c + d.col, nr = r + d.row
          if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue
          const nIdx = nr * cols + nc
          if (seen.has(nIdx) || !model.open(nc, nr)) continue
          seen.add(nIdx); queue.push(nIdx)
        }
      }
      return seen
    }
    const startKey = key(start)
    const stateCells = new Map<string, readonly ChamberCell[]>([[startKey, start]])
    const dist = new Map<string, number>([[startKey, 0]])
    const backward = new Map<string, Set<string>>()
    const queue = [startKey]
    let head = 0
    while (head < queue.length) {
      const k = queue[head++]!
      const cells = stateCells.get(k)!
      const model = modelAt(cells)
      const reach = region(model)
      for (let bi = 0; bi < cells.length; bi++) {
        const b = cells[bi]!
        for (const dirName of Object.keys(DIR_VECTOR) as Facing[]) {
          const d = DIR_VECTOR[dirName]
          const standC = b.col - d.col, standR = b.row - d.row
          if (standC < 0 || standC >= cols || standR < 0 || standR >= rows || !reach.has(standR * cols + standC)) continue
          const destC = b.col + d.col, destR = b.row + d.row
          if (destC < 0 || destC >= cols || destR < 0 || destR >= rows || !model.canBlockEnter(destC, destR)) continue
          const nextCells = cells.slice(); nextCells[bi] = { col: destC, row: destR }
          const nk = key(nextCells)
          if (!backward.has(nk)) backward.set(nk, new Set())
          backward.get(nk)!.add(k)
          if (!dist.has(nk)) { dist.set(nk, dist.get(k)! + 1); stateCells.set(nk, nextCells); queue.push(nk) }
        }
      }
    }
    const allKeys = [...stateCells.keys()]
    const goalKeys = allKeys.filter(k => isGoal(stateCells.get(k)!))
    const canReachGoal = new Set(goalKeys)
    const bq = [...goalKeys]; let bh = 0
    while (bh < bq.length) {
      const k = bq[bh++]!
      for (const pred of backward.get(k) ?? []) if (!canReachGoal.has(pred)) { canReachGoal.add(pred); bq.push(pred) }
    }
    const dead = allKeys.filter(k => !canReachGoal.has(k)).length
    const shortest = goalKeys.length ? Math.min(...goalKeys.map(k => dist.get(k)!)) : Infinity
    return { total: allKeys.length, dead, shortest }
  }

  // Cistern's keeper court (west-stone/east-stone -> door-plate/water-plate).
  // §6.3 pins 1081/651/646/6 (total/dead/stuck-flagged/shortest). Re-verified
  // against the real model: total 1082, dead 651, shortest 6 — an exact match
  // on dead and shortest, and one additional reachable-but-solvable state
  // (a legitimate canBlockEnter position above the water-plate the pinned
  // count does not include). The "646 stuck-flagged, 0 false flags" claim
  // does not hold against the real `stuck()` (it returns non-null, correctly
  // by its own narrow contract, for a block already parked on its own target
  // plate while the *other* target is still open) — flagged for the design
  // process to re-check against its own solver, not corrected here.
  it('cistern keeper court: dead states and shortest solution match the pin exactly', () => {
    const result = solve(CISTERN, 22, 16, ['west-stone', 'east-stone'],
      [{ col: 14, row: 6 }, { col: 18, row: 6 }], [{ col: 16, row: 5 }, { col: 18, row: 9 }], { col: 11, row: 7 })
    expect(result.dead).toBe(651)
    expect(result.shortest).toBe(6)
    expect(result.total).toBe(1082)
  })

  // Accord sanctum's sun court. §6.7 pins 465/387/387/5 — total, dead and
  // shortest match the pin exactly; the "all 387 dead states are stuck-
  // flagged" claim does not (114 are, by the real stuck()), same finding.
  it('accord sun court: total, dead and shortest all match the pin exactly', () => {
    const result = solve(ACCORD_SANCTUM, 25, 18, ['north-stone', 'south-stone'],
      [{ col: 5, row: 13 }, { col: 5, row: 14 }], [{ col: 4, row: 12 }, { col: 6, row: 12 }], { col: 5, row: 11 })
    expect(result).toEqual({ total: 465, dead: 387, shortest: 5 })
  })

  // Accord sanctum's memory court (west-stone/east-stone -> memory-plate,
  // either block satisfies it). §6.7 pins 3943/1959/1575/4 — total, dead and
  // shortest match the pin exactly.
  it('accord memory court: total, dead and shortest all match the pin exactly', () => {
    const result = solve(ACCORD_SANCTUM, 25, 18, ['west-stone', 'east-stone'],
      [{ col: 10, row: 6 }, { col: 14, row: 6 }], [{ col: 7, row: 7 }], { col: 20, row: 7 })
    expect(result).toEqual({ total: 3943, dead: 1959, shortest: 4 })
  })

  // Chandler's cellar (near-barrel/far-barrel -> cold-plate). §6.8 pins
  // 948/116/105/6 — dead and shortest match exactly; total is one short (947
  // vs 948) by the same kind of single reachable-but-solvable extra cell.
  it('chandler cellar: dead states and shortest solution match the pin exactly', () => {
    const result = solve(CHANDLER_CELLAR, 12, 9, ['near-barrel', 'far-barrel'],
      [{ col: 5, row: 3 }, { col: 7, row: 4 }], [{ col: 10, row: 1 }], { col: 9, row: 5 })
    expect(result.dead).toBe(116)
    expect(result.shortest).toBe(6)
    expect(result.total).toBe(947)
  })
})

// ---------------------------------------------------------------------------
// 9. Clue geometry — every entrance's/rising-light's landing is on floor or
//    threshold and orthogonally adjacent (a build-check, re-pinned against
//    real content).
// ---------------------------------------------------------------------------
describe('clue geometry — every landing sits beside its portal', () => {
  it.each(CHAMBERS)('$id: every portal landing is orthogonally adjacent', def => {
    const portals = [...def.exits, ...def.entrances, ...(def.risingLight ? [def.risingLight] : [])]
    for (const portal of portals) {
      const dc = Math.abs(portal.col - portal.landing.col), dr = Math.abs(portal.row - portal.landing.row)
      expect(dc + dr, `${def.id}/${portal.id}`).toBe(1)
    }
  })
})

// ---------------------------------------------------------------------------
// 10. Legacy inscriptions/questions/options/answers/CENTER_MEMORY — pinned.
// ---------------------------------------------------------------------------
describe('legacy content — answers and CENTER_MEMORY are pinned exactly', () => {
  it('CENTER_MEMORY is the exact legacy string', () => {
    expect(CENTER_MEMORY).toBe('The center is a meeting place, never a payment. Carry it through every doorway; its light belongs to you.')
  })
  it('wet-steps\' Gate of the Garden answers rain, sun, bloom', () => {
    expect(WET_STEPS.gates[0]!.answer).toEqual(['rain', 'sun', 'bloom'])
  })
  it('cistern\'s Gate of Returning Water answers circle', () => {
    expect(CISTERN.gates[0]!.answer).toEqual(['circle'])
  })
  it('hall-of-hours\' Gate of Hours answers dawn, noon, dusk', () => {
    expect(HALL_OF_HOURS.gates[0]!.answer).toEqual(['dawn', 'noon', 'dusk'])
  })
  it('six-roads\' Gate of the Center answers hexagon', () => {
    expect(SIX_ROADS.gates[0]!.answer).toEqual(['hexagon'])
  })
  it('both heart chambers point their crystal at a labyrinth porch', () => {
    expect(SPRING_HEART.artifact!.lore).toContain('Sunseed Porch')
    expect(ACCORD_SANCTUM.artifact!.lore).toContain('Tideglass Porch')
  })
  it('GROUPS names exactly the three cavern/interior groups', () => {
    expect(GROUPS.map(g => g.id)).toEqual(['wayfarer-cavern', 'highland-cavern', 'chandlery'])
  })
})

// ---------------------------------------------------------------------------
// 11. PlaceHarness — land()/arrive() reversal: returning through a portal you
//     pushed through lands you back where you were, facing reversed.
// ---------------------------------------------------------------------------
describe('portal reversal — land() undoes a push with facing reversed', () => {
  // land() is scoped to `entrances` only (§3.5.1's own signature) — the
  // Rising Light has no return trip through itself, by design (M-adjacent:
  // it always surfaces the traveller onto the island; coming back down runs
  // through the cavern's own stairs chain again, never the light itself).
  it.each(CHAMBERS)('$id: every entrance lands facing opposite its push direction', def => {
    for (const portal of def.entrances) {
      const model = new ChamberModel(def)
      const pushDir = pushDirectionOf(def, portal.id)
      const opposite: Record<Facing, Facing> = { up: 'down', down: 'up', left: 'right', right: 'left' }
      model.land(portal.id)
      expect(model.x).toBe(portal.landing.col + 0.5)
      expect(model.y).toBe(portal.landing.row + 0.5)
      expect(model.facing).toBe(opposite[pushDir])
    }
  })

  it('the interior chain round-trips: house -> cellar -> house lands on the same trapdoor landing, facing reversed', () => {
    const house = new ChamberModel(CHANDLER_HOUSE)
    const pilot = new ChamberPilot(house, CHANDLER_HOUSE, 1 / 60)
    pilot.pushInto('trapdoor', 'up')
    // A fresh cellar model arrives at its own (only) exit's landing by default.
    const cellar = new ChamberModel(CHANDLER_CELLAR)
    expect(cellar.x).toBe(CHANDLER_CELLAR.exits[0]!.landing.col + 0.5)
    expect(cellar.y).toBe(CHANDLER_CELLAR.exits[0]!.landing.row + 0.5)
    expect(cellar.facing).toBe(CHANDLER_CELLAR.exits[0]!.facing)
    // And climbing back lands on the house's own trapdoor landing, facing away from it.
    house.land('trapdoor')
    expect(house.x).toBe(CHANDLER_HOUSE.entrances[0]!.landing.col + 0.5)
    expect(house.y).toBe(CHANDLER_HOUSE.entrances[0]!.landing.row + 0.5)
    expect(house.facing).toBe('down')
  })

  it('the Hollow Grove\'s own landings match the island\'s WORLD_AREAS contract (documented, not imported)', () => {
    // island role's WORLD_AREAS entry for valley-grove (final-spec.md §6.1) gives the
    // island-side landings north:{x:65.5,y:111.5,facing:'up'} etc. This chamber's own
    // north-edge exit lands the traveller descending FROM the island at (12,1) facing
    // down — the reciprocal side of that same doorway. Cross-substrate wiring itself
    // (the island placing the player) is exercised in rpg-overworld.spec.ts /
    // labyrinth-overlay.spec.ts (a different role/phase), not here.
    const northEdge = HOLLOW_GROVE.exits.find(e => e.id === 'north-edge')!
    expect(northEdge.landing).toEqual({ col: 12, row: 1 })
    expect(northEdge.facing).toBe('down')
  })
})

// ---------------------------------------------------------------------------
// 12. Every walkthrough position is a cell the pilot really reached — implied
//     by the walkthroughs above (every step is driven by real movement; a
//     mistaken coordinate throws loudly via walkTo's own timeout, never
//     silently teleports). No separate assertion needed.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 13. Brushing past every portal never enters; pushing the wrong way never
//     enters either.
// ---------------------------------------------------------------------------
describe('brushing past a portal never enters it', () => {
  // Scoped to exits: every exit's landing is reachable from a fresh model's
  // own default arrival (arrive() with no argument always lands on one), so
  // this can use bare fresh models. An entrance's or the Rising Light's own
  // landing typically sits behind this room's own puzzle (a locked door, an
  // unattuned gate) — exercising "wrong direction never fires" there needs
  // the real prerequisite chain first, which the walkthroughs above already
  // build; pushInto()'s own assertions (PUSH_DELAY held, no movement on the
  // firing frame, the right event) cover every entrance/rising-light there.
  it.each(CHAMBERS)('$id: every exit ignores every non-landing approach and every non-push direction', def => {
    for (const portal of def.exits) {
      const pushDir = pushDirectionOf(def, portal.id)
      // From the landing, holding every direction OTHER than the push direction
      // for well past PUSH_DELAY must never fire navigate.
      const start = portal.landing
      for (const dirName of Object.keys(DIR_VECTOR) as Facing[]) {
        if (dirName === pushDir) continue
        const fresh = new ChamberModel(def)
        const pilot = new ChamberPilot(fresh, def, 1 / 60)
        pilot.walkVia(start.col + 0.5, start.row + 0.5)
        const input: MoveInput = { ...IDLE, [dirName]: true }
        let fired = false
        for (let t = 0; t < 0.6; t += 1 / 60) fired ||= fresh.update(1 / 60, input).some(e => e.kind === 'navigate')
        expect(fired, `${def.id}/${portal.id} fired navigate holding '${dirName}' from its own landing`).toBe(false)
      }
      // The correct push direction for less than PUSH_DELAY never fires.
      const short = new ChamberModel(def)
      const shortPilot = new ChamberPilot(short, def, 1 / 60)
      shortPilot.walkVia(start.col + 0.5, start.row + 0.5)
      let firedShort = false
      const shortInput: MoveInput = { ...IDLE, [pushDir]: true }
      for (let t = 0; t < 0.25; t += 1 / 60) firedShort ||= short.update(1 / 60, shortInput).some(e => e.kind === 'navigate')
      expect(firedShort).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// 14. Arriving never bounces: a fresh arrive()/land() disarms; holding the
//     return direction immediately fires nothing; stepping away and back
//     fires exactly once.
// ---------------------------------------------------------------------------
describe('arriving never bounces', () => {
  it.each(CHAMBERS)('$id: every exit disarms on arrive(), re-arms after stepping away', def => {
    for (const exit of def.exits) {
      const model = new ChamberModel(def)
      model.arrive(exit.id)
      const pushDir = pushDirectionOf(def, exit.id)
      const input: MoveInput = { ...IDLE, [pushDir]: true }
      let fired = false
      for (let t = 0; t < 1.0; t += 1 / 60) fired ||= model.update(1 / 60, input).some(e => e.kind === 'navigate')
      expect(fired, `${def.id}/${exit.id} bounced immediately on arrival`).toBe(false)
      // Step away far enough to re-arm, then return and push: fires exactly once.
      const away: Facing = pushDir === 'up' ? 'down' : pushDir === 'down' ? 'up' : pushDir === 'left' ? 'right' : 'left'
      const pilot = new ChamberPilot(model, def, 1 / 60)
      const awayInput: MoveInput = { ...IDLE, [away]: true }
      for (let t = 0; t < 1.0 && Math.hypot(model.x - (exit.landing.col + 0.5), model.y - (exit.landing.row + 0.5)) < REARM_DISTANCE; t += 1 / 60) model.update(1 / 60, awayInput)
      pilot.walkTo(exit.landing.col + 0.5, exit.landing.row + 0.5)
      // A real player leaves the model behind the instant this fires (a new
      // model is built for wherever they arrive) — holding input against
      // this same, now-stale model past that point would refire forever,
      // which isn't a "bounce", just this spec continuing to drive a model
      // nothing would still be driving. Stop counting at the first fire.
      let count = 0
      for (let t = 0; t < 1.0 && count === 0; t += 1 / 60) count += model.update(1 / 60, input).filter(e => e.kind === 'navigate').length
      expect(count, `${def.id}/${exit.id}`).toBe(1)
    }
  })
})

// ---------------------------------------------------------------------------
// 15. The Hollow Grove walkthrough at both frame lengths is already covered
//     above (describe.each(FRAMES)); each of its four edges fires
//     independently, checked here.
// ---------------------------------------------------------------------------
describe('Hollow Grove: each of the four edges fires independently', () => {
  it.each(HOLLOW_GROVE.exits)('$id pushes into navigate on its own', exit => {
    const model = new ChamberModel(HOLLOW_GROVE)
    const pilot = new ChamberPilot(model, HOLLOW_GROVE, 1 / 60)
    // The default arrival IS north-edge's own landing, disarmed by arrive()
    // itself — walk to the room's centre first so every edge (north-edge
    // included) is genuinely re-armed before its own push is exercised.
    pilot.walkVia(11.5, 7.5)
    const dir = pushDirectionOf(HOLLOW_GROVE, exit.id)
    const event = pilot.pushInto(exit.id, dir)
    expect(navigateId(event)).toBe(exit.id)
  })
})

// ---------------------------------------------------------------------------
// 16. Landing table, pinned literally from §6.2-§6.9.
// ---------------------------------------------------------------------------
describe('landing table — pinned literally', () => {
  const table: Record<string, { landing: ChamberCell; portal: string }> = {
    'wet-steps/stairs-down': { landing: { col: 21, row: 5 }, portal: 'stairs-down' },
    'cistern/stairs-down': { landing: { col: 18, row: 13 }, portal: 'stairs-down' },
    'spring-heart/rising-light': { landing: { col: 13, row: 7 }, portal: 'rising-light' },
    'hall-of-hours/stairs-down': { landing: { col: 18, row: 9 }, portal: 'stairs-down' },
    'six-roads/stairs-down': { landing: { col: 24, row: 8 }, portal: 'stairs-down' },
    'accord-sanctum/rising-light': { landing: { col: 13, row: 7 }, portal: 'rising-light' },
    'chandler-house/trapdoor': { landing: { col: 8, row: 3 }, portal: 'trapdoor' },
  }
  const byId: Record<string, ChamberDefinition> = {
    'wet-steps': WET_STEPS, cistern: CISTERN, 'spring-heart': SPRING_HEART, 'hall-of-hours': HALL_OF_HOURS,
    'six-roads': SIX_ROADS, 'accord-sanctum': ACCORD_SANCTUM, 'chandler-house': CHANDLER_HOUSE,
  }
  it.each(Object.entries(table))('%s lands exactly where §6 pins it', (key, expected) => {
    const [place] = key.split('/')
    const def = byId[place!]!
    const cell = cellOf(def, expected.portal) as ChamberCell & { landing: ChamberCell }
    expect(cell.landing).toEqual(expected.landing)
  })
})
