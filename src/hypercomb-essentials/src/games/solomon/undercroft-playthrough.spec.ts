// A fought playthrough of the Undercroft, driven the way a player plays it:
// the goblin under the arrival stair, the twin lamps and their niche, the
// surveyor's chart, the lever, the gallery and its key across the cistern's
// bat, the vault door, the deep hall's goblin, and the stair on down through
// the south bat's round. Pinned so the place stays winnable — and a fight.
import { describe, expect, it } from 'vitest'
import { CHAMBER_SPEED, ChamberModel, type ChamberEvent, type Facing, type MoveInput } from './chamber.js'
import { UNDERCROFT } from './chamber-places.js'

const DT = 0.05
const IDLE: MoveInput = { up: false, down: false, left: false, right: false }
const STEP: Record<Facing, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }

/** Drives the model frame by frame and keeps the fight's score. */
class Fighter {
  caught = 0
  crushed: string[] = []
  seconds = 0
  constructor(readonly model: ChamberModel) {}

  tick(input: MoveInput = IDLE): ChamberEvent[] {
    const events = this.model.update(DT, input)
    this.seconds += DT
    for (const event of events) {
      if (event.kind === 'caught') this.caught++
      if (event.kind === 'crushed') this.crushed.push(event.foe)
    }
    return events
  }

  /** A bat crossing within reach of a square: wait it out rather than walk into it. */
  #batNear(x: number, y: number, reach = 2.2): boolean {
    return this.model.foes.some(foe => foe.alive && foe.kind === 'flitter' && Math.hypot(foe.x - x, foe.y - y) < reach)
  }

  /** The nearest live goblin within `reach`, if any. */
  #goblinNear(reach: number): { id: string; x: number; y: number } | null {
    const goblin = this.model.foes
      .filter(foe => foe.alive && foe.kind === 'prowler')
      .map(foe => ({ foe, d: Math.hypot(foe.x - this.model.x, foe.y - this.model.y) }))
      .sort((a, b) => a.d - b.d)[0]
    return goblin && goblin.d < reach ? { id: goblin.foe.id, x: goblin.foe.x, y: goblin.foe.y } : null
  }

  /** Face a close goblin, and cast the moment it stands on the faced square. */
  #stroke(goblin: { id: string; x: number; y: number }): boolean {
    const dx = goblin.x - this.model.x, dy = goblin.y - this.model.y
    const facing: Facing = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up')
    this.model.turn(facing)
    const [sc, sr] = STEP[facing]
    if (Math.floor(goblin.x) !== Math.floor(this.model.x) + sc || Math.floor(goblin.y) !== Math.floor(this.model.y) + sr) return false
    const result = this.model.cast()
    if (!result.events.some(event => event.kind === 'crushed')) return false
    this.crushed.push(goblin.id)
    // The stone that did it stays where it fell; in a corridor that is a wall
    // of her own making, so she lifts it before going on.
    this.model.cast()
    return true
  }

  /** Walks straight toward (x,y). A goblin closing in is taken first: she
   *  stands, faces it, and casts when it is on the faced square. */
  walkTo(x: number, y: number, maxSeconds = 40): boolean {
    const tolerance = Math.max(0.08, CHAMBER_SPEED * DT * 1.15)
    for (let t = 0; t < maxSeconds; t += DT) {
      const dx = x - this.model.x, dy = y - this.model.y
      if (Math.hypot(dx, dy) < tolerance) return true
      const goblin = this.#goblinNear(2.4)
      if (goblin) { this.#stroke(goblin); if (this.tick().some(event => event.kind === 'caught')) return false; continue }
      const input = this.#batNear(x, y) || this.#batNear(this.model.x, this.model.y, 1.6)
        ? IDLE
        : { left: dx < -0.04, right: dx > 0.04, up: dy < -0.04, down: dy > 0.04 }
      if (this.tick(input).some(event => event.kind === 'caught')) return false
    }
    throw new Error(`walkTo(${x},${y}) did not arrive (at ${this.model.x.toFixed(2)},${this.model.y.toFixed(2)})`)
  }

  /** Cell by cell along the shortest open route, as the doors and shutters stand now. */
  walkVia(x: number, y: number): boolean {
    const cols = UNDERCROFT.map[0]!.length, rows = UNDERCROFT.map.length
    const start = Math.floor(this.model.y) * cols + Math.floor(this.model.x)
    const target = Math.floor(y) * cols + Math.floor(x)
    const prev = new Map<number, number>([[start, -1]])
    const queue = [start]
    for (let head = 0; head < queue.length; head++) {
      const idx = queue[head]!, c = idx % cols, r = Math.floor(idx / cols)
      for (const [dc, dr] of Object.values(STEP)) {
        const nc = c + dc, nr = r + dr
        if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue
        const next = nr * cols + nc
        if (prev.has(next) || !this.model.open(nc, nr)) continue
        prev.set(next, idx); queue.push(next)
      }
    }
    if (!prev.has(target)) throw new Error(`no open route to (${Math.floor(x)},${Math.floor(y)}) from (${Math.floor(this.model.x)},${Math.floor(this.model.y)})`)
    const path: number[] = []
    for (let idx = target; idx !== -1; idx = prev.get(idx)!) path.push(idx)
    path.reverse()
    for (const idx of path) if (!this.walkTo((idx % cols) + 0.5, Math.floor(idx / cols) + 0.5)) return false
    return this.walkTo(x, y)
  }

  /** Stand and take the nearest goblin as it comes: face it, and cast the
   *  moment it stands on the faced square. True on a crush. */
  fight(seconds = 25): boolean {
    for (let t = 0; t < seconds; t += DT) {
      const goblin = this.#goblinNear(2.2)
      if (goblin && this.#stroke(goblin)) return true
      if (this.tick().some(event => event.kind === 'caught')) return false
    }
    return false
  }

  /** Walk somewhere and, if a goblin is on her before she arrives (she is
   *  sent back to the stair), fight it from there and try again. */
  go(x: number, y: number, tries = 4): void {
    for (let attempt = 0; attempt < tries; attempt++) {
      if (this.walkVia(x, y)) return
      this.fight()
    }
    throw new Error(`could not reach (${x},${y}) in ${tries} tries`)
  }
}

describe('the Undercroft, fought through', () => {
  it('is winnable the way it is meant to be won, and is a fight', () => {
    const model = new ChamberModel(UNDERCROFT)
    model.arrive('stair-up')
    const dana = new Fighter(model)

    // The goblin under the stair sees her at once: take it on the landing.
    expect(dana.fight(30)).toBe(true)

    // The twin lamps, and the niche between them.
    dana.go(16.5, 2.5)
    if (dana.fight(6)) { /* the lamp hall's goblin came early */ }
    model.turn('up'); model.interact('lamp-west')
    dana.go(23.5, 2.5)
    model.turn('up'); model.interact('lamp-east')
    if (!model.lit.includes('lamp-west') || !model.lit.includes('lamp-east')) { dana.fight(20); dana.go(16.5, 2.5); model.turn('up'); model.interact('lamp-west'); dana.go(23.5, 2.5); model.turn('up'); model.interact('lamp-east') }
    expect(model.lit).toEqual(expect.arrayContaining(['lamp-west', 'lamp-east']))
    if (!dana.crushed.includes('goblin-mid')) expect(dana.fight(30)).toBe(true)
    dana.go(20.5, 2.5)
    model.turn('up'); model.interact('lamp-niche')
    expect(model.opened.has('lamp-niche')).toBe(true)

    // The surveyor's chart, past the east hall's goblin.
    dana.go(45.5, 2.5)
    if (!dana.crushed.includes('goblin-east')) expect(dana.fight(30)).toBe(true)
    model.turn('up'); model.interact('surveyor-chest')
    expect(model.opened.has('surveyor-chest')).toBe(true)

    // The lever in the great hall lifts the gallery shutter.
    dana.go(31.5, 10.5)
    model.turn('left'); model.interact('gallery-lever')
    expect(model.pulled.has('gallery-lever')).toBe(true)
    expect(model.latched.has('gallery-shutter')).toBe(true)

    // Across the cistern's bat to the gallery, and the vault key.
    dana.go(45.5, 12.5)
    model.turn('up'); model.interact('gallery-chest')
    expect(model.opened.has('gallery-chest')).toBe(true)
    expect(model.keysHeld()).toBe(1)

    // Down to the vault door, through the south-west hall's goblin.
    dana.go(22.5, 26.5)
    if (!dana.crushed.includes('goblin-south')) expect(dana.fight(30)).toBe(true)
    model.turn('right'); model.interact('vault-door')
    expect(model.unlocked.has('vault-door')).toBe(true)

    // The deep hall: the south bat's round runs the hall's edges — rows 23
    // and 27, columns 25 and 44 — and the stair's landing is its very corner.
    // Row 26 is the lane between; walk it, then take the corner in the gap.
    dana.go(43.5, 26.5)
    for (let t = 0; t < 30; t += DT) {
      const clear = !model.foes.some(foe => foe.alive && foe.kind === 'flitter' && Math.hypot(foe.x - 44.5, foe.y - 27.5) < 4)
      if (clear) break
      dana.tick()
    }
    expect(dana.walkTo(44.5, 27.5, 5)).toBe(true)
    expect([Math.floor(model.x), Math.floor(model.y)]).toEqual([44, 27])

    expect(new Set(dana.crushed)).toEqual(new Set(['goblin-west', 'goblin-mid', 'goblin-east', 'goblin-south']))
    expect(dana.caught).toBeLessThanOrEqual(4)
    expect(dana.seconds).toBeLessThan(600)
  })
})
