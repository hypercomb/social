// A fought playthrough of the Sump, driven the way a player plays it: run
// the causeway under the bats, take the goblins in the warren one at a
// time with the wand's stone, lift the key, open the heart, deal with its
// guard, and take the pearl. Pinned so the place stays winnable — and stays
// a fight — as the model changes.
import { describe, expect, it } from 'vitest'
import { CHAMBER_SPEED, ChamberModel, type ChamberEvent, type Facing, type MoveInput } from './chamber.js'
import { THE_SUMP } from './chamber-places.js'

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

  wait(seconds: number): boolean {
    for (let t = 0; t < seconds; t += DT) if (this.tick().some(event => event.kind === 'caught')) return false
    return true
  }

  /** Straight toward (x,y); false the moment she is caught (she is back at the stair). */
  walkTo(x: number, y: number, maxSeconds = 30): boolean {
    const tolerance = Math.max(0.08, CHAMBER_SPEED * DT * 1.15)
    for (let t = 0; t < maxSeconds; t += DT) {
      const dx = x - this.model.x, dy = y - this.model.y
      if (Math.hypot(dx, dy) < tolerance) return true
      if (this.tick({ left: dx < -0.04, right: dx > 0.04, up: dy < -0.04, down: dy > 0.04 }).some(event => event.kind === 'caught')) return false
    }
    throw new Error(`walkTo(${x},${y}) did not arrive (at ${this.model.x.toFixed(2)},${this.model.y.toFixed(2)})`)
  }

  /** Cell by cell along the shortest open route — the warren's corridors are one wide. */
  walkVia(x: number, y: number): boolean {
    const cols = THE_SUMP.map[0]!.length, rows = THE_SUMP.map.length
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
    if (!prev.has(target)) throw new Error(`no open route to (${Math.floor(x)},${Math.floor(y)})`)
    const path: number[] = []
    for (let idx = target; idx !== -1; idx = prev.get(idx)!) path.push(idx)
    path.reverse()
    for (const idx of path) if (!this.walkTo((idx % cols) + 0.5, Math.floor(idx / cols) + 0.5)) return false
    return this.walkTo(x, y)
  }

  /** Run the causeway east. The bats keep their rounds over the pool and
   *  cross the causeway at a few points; a bat cannot be outrun head-on or
   *  crushed, so the crossing is timed — stop short of a bat crossing ahead,
   *  and go when it has passed. */
  runCauseway(targetX: number, maxSeconds = 120): boolean {
    for (let t = 0; t < maxSeconds; t += DT) {
      if (this.model.x >= targetX) return true
      const crossingAhead = this.model.foes.some(foe => foe.alive && foe.kind === 'flitter'
        && foe.x > this.model.x - 0.4 && foe.x - this.model.x < 2.6 && Math.abs(foe.y - this.model.y) < 1.4)
      if (this.tick(crossingAhead ? IDLE : { ...IDLE, right: true }).some(event => event.kind === 'caught')) return false
    }
    throw new Error(`runCauseway did not arrive (at ${this.model.x.toFixed(2)},${this.model.y.toFixed(2)})`)
  }

  /** Stand and take the nearest goblin as it comes: face it, and cast the
   *  moment it stands on the faced square. True on a crush. */
  fight(seconds = 20): boolean {
    for (let t = 0; t < seconds; t += DT) {
      const goblin = this.model.foes
        .filter(foe => foe.alive && foe.kind === 'prowler')
        .map(foe => ({ foe, d: Math.hypot(foe.x - this.model.x, foe.y - this.model.y) }))
        .sort((a, b) => a.d - b.d)[0]
      if (goblin && goblin.d < 2.2) {
        const dx = goblin.foe.x - this.model.x, dy = goblin.foe.y - this.model.y
        const facing: Facing = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up')
        this.model.turn(facing)
        const [sc, sr] = STEP[facing]
        if (Math.floor(goblin.foe.x) === Math.floor(this.model.x) + sc && Math.floor(goblin.foe.y) === Math.floor(this.model.y) + sr) {
          const result = this.model.cast()
          if (result.events.some(event => event.kind === 'crushed')) { this.crushed.push(goblin.foe.id); return true }
        }
      }
      if (this.tick().some(event => event.kind === 'caught')) return false
    }
    return false
  }
}

describe('the Sump, fought through', () => {
  it('is winnable the way it is meant to be won, and is a fight', () => {
    const model = new ChamberModel(THE_SUMP)
    model.arrive('stair-up')
    const dana = new Fighter(model)

    // The causeway: run it. A bat that gets her sends her back to the stair;
    // wait a breath and run again.
    let across = false
    for (let attempt = 0; attempt < 8 && !across; attempt++) {
      across = dana.walkVia(1.5, 6.5) && dana.runCauseway(36.5) && dana.walkTo(37.5, 6.5, 10)
      if (!across) dana.wait(2)
    }
    expect(across, `caught ${dana.caught} times on the causeway`).toBe(true)
    const causewayCatches = dana.caught

    // Into the warren. The east goblin keeps its loop; take it as it comes.
    expect(dana.walkVia(37.5, 11.5)).toBe(true)
    expect(dana.fight(40)).toBe(true)
    // West along the top corridor to the west loop, and its goblin.
    expect(dana.walkVia(21.5, 11.5)).toBe(true)
    expect(dana.fight(40)).toBe(true)
    // The key, at the dead end.
    expect(dana.walkVia(15.5, 14.5)).toBe(true)
    model.turn('up')
    model.interact('warren-chest')
    expect(model.opened.has('warren-chest')).toBe(true)
    expect(model.keysHeld()).toBe(1)

    // The heart door, and the guard inside.
    expect(dana.walkVia(13.5, 16.5)).toBe(true)
    model.turn('down')
    model.interact('heart-door')
    expect(model.unlocked.has('heart-door')).toBe(true)
    expect(dana.walkVia(13.5, 18.5)).toBe(true)
    expect(dana.fight(40)).toBe(true)

    // The pearl.
    expect(dana.walkVia(4.5, 23.5)).toBe(true)
    model.turn('left')
    model.interact('pearl-chest')
    expect(model.opened.has('pearl-chest')).toBe(true)

    // It was a fight: every goblin met the stone, the bats were a real risk
    // but not a wall, and it did not take all day.
    expect(new Set(dana.crushed)).toEqual(new Set(['goblin-warren-east', 'goblin-warren-west', 'goblin-heart']))
    expect(causewayCatches).toBeLessThanOrEqual(4)
    expect(dana.caught).toBe(causewayCatches)
    expect(dana.seconds).toBeLessThan(240)
  })
})
