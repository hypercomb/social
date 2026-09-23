import { describe, expect, it } from 'vitest'
import { BRICK, CRACKED, EMPTY, SIM_DT, TILE, WALL, type Engine, type ItemKind } from './engine.js'
import { LabyrinthJourney, roomId } from './labyrinth.js'
import { RpgOverworld } from './rpg-overworld.js'

/** The room as it stands, for a route that loses its footing: stone `#`,
 *  brick `B`/`b`, a pickup `i`, a foe `E`, Dana `@`. */
function picture(engine: Engine): string {
  const dana = { col: Math.floor((engine.player.x + engine.player.w / 2) / TILE), row: Math.floor((engine.player.y + engine.player.h - 1) / TILE) }
  const rows: string[] = []
  for (let row = 0; row < engine.rows; row++) {
    let line = ''
    for (let col = 0; col < engine.cols; col++) {
      const tile = engine.tileAt(col, row)
      let mark = tile === WALL ? '#' : tile === BRICK ? 'B' : tile === CRACKED ? 'b' : '.'
      if (engine.items.some(item => !item.taken && !item.hidden && item.col === col && item.row === row)) mark = 'i'
      if (engine.enemies.some(foe => foe.alive && Math.floor((foe.x + foe.w / 2) / TILE) === col && Math.floor((foe.y + foe.h - 1) / TILE) === row)) mark = 'E'
      if (col === dana.col && row === dana.row) mark = '@'
      line += mark
    }
    rows.push(line)
  }
  return rows.join('\n')
}

/** Exercise authored geometry through player controls. No test changes
 *  positions, terrain, enemies, health or pickup flags; only normal doors
 *  change chambers. Every foe on the route is fought the Solomon way — dropped
 *  through the stone it stands on, or crushed by a conjured block. */
class PlayerControls {
  /** Lives only ever go up on this route: a buried life is found, none is lost. */
  #lives = 3

  constructor(readonly journey: LabyrinthJourney) {}

  get engine(): Engine { return this.journey.engine! }

  location(): string {
    const engine = this.engine
    return `${this.journey.room!.id} (${(engine.player.x / TILE).toFixed(2)}, ${(engine.player.y / TILE).toFixed(2)})\n${picture(engine)}`
  }

  tick(input: Partial<{ left: boolean; right: boolean; down: boolean; jump: boolean }> = {}): void {
    const engine = this.engine
    Object.assign(engine.input, { left: false, right: false, down: false, jump: false }, input)
    const before = picture(engine) + `
  foes: ${engine.enemies.map(foe => `${foe.kind} ${(foe.x / TILE).toFixed(2)},${(foe.y / TILE).toFixed(2)} ${foe.state}`).join("; ")} bolts: ${engine.shots.map(shot => `${(shot.x / TILE).toFixed(2)},${(shot.y / TILE).toFixed(2)}`).join(" ")} dana y ${(engine.player.y / TILE).toFixed(2)} vy ${engine.player.vy.toFixed(0)}`
    this.journey.update(SIM_DT)
    if (engine.lives < this.#lives || engine.state !== 'playing') throw new Error(`Route lost a life (lives ${engine.lives}, ${engine.state}, sand ${Math.round(engine.life)}) at ${this.location()}
the step before:
${before}`)
    // The route never reads the Stele of the Stand, so no Hush can open: every
    // fight below is the classic one, decided by stone.
    if (engine.battle) throw new Error(`An unplanned Hush opened at ${this.location()}`)
    this.#lives = engine.lives
  }

  wait(steps: number): void { for (let i = 0; i < steps; i++) this.tick() }

  waitFor(what: string, done: () => boolean, steps = 600): void {
    for (let i = 0; i < steps; i++) { if (done()) return; this.tick() }
    throw new Error(`Waited in vain for ${what} at ${this.location()}`)
  }

  column(): number { return (this.engine.player.x + this.engine.player.w / 2) / TILE }

  walkTo(col: number): void {
    for (let step = 0; step < 300; step++) {
      const center = this.column()
      if (Math.abs(center - col - 0.5) < 0.08) { this.wait(8); return }
      this.tick({ left: center > col + 0.5, right: center < col + 0.5 })
    }
    throw new Error(`Could not walk to column ${col} from ${this.location()}`)
  }

  jumpToward(col: number): void {
    this.wait(2) // release the previous jump, then use a fresh press
    let airborne = false
    for (let step = 0; step < 100; step++) {
      const center = this.column()
      this.tick({ left: center > col + 0.58, right: center < col + 0.42, jump: true })
      airborne ||= !this.engine.onGround
      if (airborne && this.engine.onGround) return
    }
    throw new Error(`Could not finish jump toward column ${col} from ${this.location()}`)
  }

  /** Turn in place: one step's press, then settle. */
  face(dir: 1 | -1): void {
    this.tick(dir > 0 ? { right: true } : { left: true })
    this.wait(3)
  }

  cast(down = false): void {
    this.tick({ down })
    this.engine.cast()
    this.tick()
  }

  /** Jump and cast while rising: the wand reaches the square one row above
   *  the takeoff row, in front — a block to climb, or the stone overhead. */
  jumpCast(): void {
    this.wait(2)
    this.tick({ jump: true })
    this.engine.cast()
    this.waitFor('landing after a jump-cast', () => this.engine.onGround)
    this.wait(4)
  }

  /** Hold still facing `dir` until a foe walks into the wand's square, then
   *  conjure on it. */
  crush(dir: 1 | -1, steps = 600): void {
    this.face(dir)
    const alive = this.alive()
    this.waitFor('a foe to step in front of the wand', () => {
      const target = this.engine.targetCell()
      return this.engine.enemies.some(foe => foe.alive && this.engine.rectOverlapsCell(foe, target.col, target.row))
    }, steps)
    this.engine.cast()
    this.tick()
    expect(this.alive(), `the crush at ${this.location()}`).toBe(alive - 1)
  }

  /** Stand below and beside a ledge's edge; when a foe steps onto the square
   *  over the wand's diagonal-up reach, jump and conjure on it. */
  crushAbove(dir: 1 | -1, steps = 1800): void {
    this.face(dir)
    const alive = this.alive()
    const col = Math.floor(this.column()) + dir
    const row = Math.floor((this.engine.player.y + this.engine.player.h - 1) / TILE) - 1
    // Never jump into a bolt already in the air: the crush is instant, the
    // bolts are not.
    const clear = (): boolean => this.engine.shots.every(shot => Math.abs(shot.x / TILE - this.column()) > 2.5)
    this.waitFor(`a foe on ${col},${row}`, () => clear() && this.engine.enemies.some(foe => foe.alive && this.engine.rectOverlapsCell(foe, col, row)), steps)
    this.jumpCast()
    expect(this.alive(), `the crush at ${this.location()}`).toBe(alive - 1)
  }

  alive(): number { return this.engine.enemies.filter(foe => foe.alive).length }

  useDoor(id: string): void {
    const result = this.journey.useDoor(id)
    if (result.kind !== 'travelled') throw new Error(`${result.message} at ${this.location()}`)
  }

  /** A buried find is in the open (and, if Dana stood in it, taken). */
  found(kind: ItemKind, col: number, row: number): { hidden: boolean; taken: boolean } {
    const item = this.engine.items.find(candidate => candidate.kind === kind && candidate.col === col && candidate.row === row)
    if (!item) throw new Error(`No ${kind} at ${col},${row} in ${this.location()}`)
    return { hidden: !!item.hidden, taken: item.taken }
  }

  holdsKey(): boolean { return this.engine.doorOpen }
}

// ── Sunseed ──────────────────────────────────────────────────────────────

function sunPorch(p: PlayerControls): void {
  // Under the terrace: a jump-cast takes the stone out from under the
  // goblin's beat. Step back — it walks into the gap and falls to its ruin.
  p.walkTo(6); p.jumpToward(7)
  p.face(1); p.jumpCast()
  expect(p.found('jar', 6, 7).hidden).toBe(false)
  p.walkTo(2)
  p.waitFor('the goblin to fall through the terrace', () => p.alive() === 0)
  // Up through the gap to the first point; the shrine gate answers it.
  p.walkTo(6); p.jumpToward(7); p.walkTo(7); p.jumpToward(9)
  p.walkTo(9)
  expect(p.journey.collected('sunseed-point-1')).toBe(true)
  expect(p.engine.tileAt(10, 10)).toBe(EMPTY)
  // Across the gap and up the left shelves to the inscription's find.
  p.walkTo(8); p.jumpToward(5)
  p.walkTo(4); p.jumpToward(3)
  p.jumpToward(2)
  p.walkTo(2); p.face(-1)
  const before = p.engine.score
  p.cast()
  expect(p.engine.tileAt(1, 2)).toBe(BRICK)
  expect(p.found('jewel', 1, 2).hidden).toBe(true)
  p.cast()
  expect(p.found('jewel', 1, 2).hidden).toBe(false)
  p.walkTo(1)
  expect(p.found('jewel', 1, 2).taken).toBe(true)
  expect(p.engine.score - before).toBe(5000)
  // Down, through the gate, and build a stair to the key.
  p.walkTo(9); p.waitFor('landing', () => p.engine.onGround)
  p.walkTo(11)
  p.face(1); p.jumpCast()
  p.jumpToward(12); p.jumpToward(13)
  p.walkTo(14); p.face(-1); p.jumpCast()
  p.jumpToward(13); p.jumpToward(12)
  expect(p.holdsKey()).toBe(false)
  p.walkTo(11)
  expect(p.holdsKey()).toBe(true)
  // Down the stair she built, and out.
  p.walkTo(14); p.walkTo(12); p.walkTo(11)
  p.waitFor('landing', () => p.engine.onGround)
  p.walkTo(14)
  p.useDoor('deeper')
}

function sunSteps(p: PlayerControls): void {
  // The first goblin charges the moment it sees her: crush it where it runs.
  p.crush(1)
  p.cast() // clear the block the crush left
  // The pedestal holds the key. Break it, step back, and the second goblin
  // comes through the gap to be crushed in turn.
  p.walkTo(10); p.face(1); p.cast()
  expect(p.found('key', 11, 10).hidden).toBe(false)
  p.walkTo(9)
  p.crush(1)
  p.cast() // clear the block the crush left
  p.walkTo(11)
  expect(p.holdsKey()).toBe(true)
  // Up the stair to the second point.
  p.walkTo(3); p.jumpToward(4); p.jumpToward(5); p.jumpToward(6); p.jumpToward(7)
  p.walkTo(9)
  expect(p.journey.collected('sunseed-point-2')).toBe(true)
  p.walkTo(11); p.waitFor('landing', () => p.engine.onGround)
  p.walkTo(14)
  p.useDoor('deeper')
}

function sunLoft(p: PlayerControls): void {
  // Open the well's wall and catch the sparkball in the gap.
  p.walkTo(3); p.face(1); p.cast()
  expect(p.engine.tileAt(4, 7)).toBe(EMPTY)
  p.crush(1, 1800)
  p.cast() // the crush's block
  p.walkTo(6)
  expect(p.holdsKey()).toBe(true)
  // Break out the far side and drop to the floor, where the ghost hunts.
  p.walkTo(8); p.face(1); p.cast()
  const ghost = p.engine.enemies.find(foe => foe.kind === 'ghost')!
  p.waitFor('the ghost to fly off', () => (ghost.x + ghost.w / 2) / TILE < 5 && ghost.dir < 0, 1800)
  p.walkTo(10); p.waitFor('landing', () => p.engine.onGround)
  p.crush(-1)
  p.walkTo(14)
  p.useDoor('deeper')
}

function sunHeart(p: PlayerControls): void {
  // Up the two steps to the tier's edge. When the gargoil stops there to
  // scan, conjure on it from below.
  p.walkTo(12); p.jumpToward(11); p.jumpToward(10)
  p.crushAbove(-1)
  // Its tomb is the stair: the key at the tier's far end, then the hexagon.
  p.jumpToward(9)
  p.walkTo(3)
  expect(p.holdsKey()).toBe(true)
  p.walkTo(8); p.jumpToward(9); p.walkTo(9)
  const ghost = p.engine.enemies.find(foe => foe.kind === 'ghost')!
  // Let the ghost pass toward the barrier, land behind it, and crush it on
  // its way back.
  p.waitFor('the ghost to pass', () => (ghost.x + ghost.w / 2) / TILE < 5 && ghost.dir < 0, 1800)
  p.walkTo(9); p.jumpToward(8)
  p.crush(-1)
  p.cast() // the crush's block
  p.walkTo(6)
  expect(p.journey.collected('sunseed-center'), p.location()).toBe(true)
  // Down the way she came, and home.
  for (const col of [9, 10, 11, 12]) { p.walkTo(col); p.waitFor('landing', () => p.engine.onGround) }
  p.walkTo(14)
  p.useDoor('home')
}

// ── Tideglass ────────────────────────────────────────────────────────────

/** Walk a floor toward `col`, breaking any brick in the way first. */
function breakThrough(p: PlayerControls, row: number, from: number, to: number): void {
  const dir = to > from ? 1 : -1
  for (let col = from + dir; col !== to + dir; col += dir) {
    if (p.engine.tileAt(col, row) === BRICK) { p.walkTo(col - dir); p.face(dir); p.cast() }
  }
  p.walkTo(to)
}

function tidePorch(p: PlayerControls): void {
  // The low ghost hunts along the floor, smashing the pedestal as it comes.
  p.crush(1)
  p.cast()
  expect(p.found('hourglass', 7, 10).hidden).toBe(false)
  p.walkTo(6); p.jumpToward(7)
  expect(p.journey.collected('tideglass-point-3')).toBe(true)
  // Up the east stair; let the high ghost fly west, then meet it.
  p.walkTo(14); p.jumpToward(13)
  const ghost = p.engine.enemies.find(foe => foe.alive && foe.kind === 'ghost')!
  p.waitFor('the high ghost to fly west', () => (ghost.x + ghost.w / 2) / TILE < 5 && ghost.dir < 0, 1800)
  p.jumpToward(12); p.jumpToward(11)
  p.crush(-1)
  p.cast()
  breakThrough(p, 5, 11, 2)
  expect(p.holdsKey()).toBe(true)
  // The step and the high shelf, where the accord crystal's memory waits.
  p.walkTo(5); p.jumpToward(4); p.jumpToward(3)
  p.walkTo(2); p.face(-1)
  const before = p.engine.score
  p.cast(); p.cast()
  p.walkTo(1)
  expect(p.found('jewel', 1, 2).taken).toBe(true)
  expect(p.engine.score - before).toBe(5000)
  for (const col of [4, 5, 12, 13, 14]) { p.walkTo(col); p.waitFor('landing', () => p.engine.onGround) }
  p.useDoor('deeper')
}

function tideSteps(p: PlayerControls): void {
  p.crush(1)
  p.cast()
  p.walkTo(4); p.jumpToward(5)
  // The turret's bolt passes; step into its line and wall it off.
  p.waitFor('a bolt to pass the stair', () => p.engine.shots.some(shot => shot.x / TILE > 7.2 && shot.x / TILE < 8.5), 600)
  p.jumpToward(6); p.face(-1); p.cast()
  expect(p.engine.tileAt(5, 6)).toBe(BRICK)
  p.jumpToward(7); p.jumpToward(8)
  p.walkTo(12)
  expect(p.journey.collected('tideglass-point-4')).toBe(true)
  // The key is in the ledge: break it and fall through with it.
  // Every bolt smashes the brick it meets, so the shield below is spent; fall
  // through the turret's line just behind a bolt.
  p.walkTo(10); p.face(1)
  p.waitFor('a bolt to pass the fall', () => p.engine.shots.some(shot => shot.x / TILE > 11.8 && shot.x / TILE < 13.5), 600)
  p.cast(true)
  p.walkTo(11); p.waitFor('landing', () => p.engine.onGround)
  expect(p.holdsKey()).toBe(true)
  p.walkTo(14)
  p.useDoor('deeper')
}

function tideLoft(p: PlayerControls): void {
  p.walkTo(14); p.jumpToward(13); p.walkTo(12)
  p.crushAbove(-1)
  p.jumpToward(11); p.jumpToward(10)
  p.crushAbove(-1)
  p.jumpToward(9)
  p.walkTo(8); p.waitFor('landing', () => p.engine.onGround)
  p.walkTo(5)
  expect(p.holdsKey()).toBe(true)
  p.walkTo(8); p.jumpToward(9); p.walkTo(9); p.jumpToward(11)
  p.walkTo(14)
  p.useDoor('deeper')
}

function tideHeart(p: PlayerControls): void {
  // Break the terrace from the step below, step back, and let both goblins
  // walk into the gap.
  p.walkTo(5); p.jumpToward(6)
  p.face(1); p.jumpCast()
  p.walkTo(2)
  p.waitFor('both goblins to fall', () => p.engine.enemies.filter(foe => foe.alive && foe.kind === 'goblin').length === 0, 1800)
  // Up through the gap (the key was in its stone), then the stair.
  p.walkTo(5); p.jumpToward(6); p.walkTo(6); p.jumpToward(8)
  expect(p.holdsKey(), p.location()).toBe(true)
  p.walkTo(10); p.jumpToward(9)
  const ghost = p.engine.enemies.find(foe => foe.kind === 'ghost')!
  p.waitFor('the ghost to pass', () => (ghost.x + ghost.w / 2) / TILE < 5 && ghost.dir < 0, 1800)
  p.walkTo(9); p.jumpToward(8)
  p.crush(-1)
  p.cast()
  p.walkTo(7)
  expect(p.journey.collected('tideglass-point-5')).toBe(true)
  expect(p.journey.inventory.star).toBe(true)
  // Down, through the bumper (a bell in it), and home.
  for (const col of [9, 10]) { p.walkTo(col); p.waitFor('landing', () => p.engine.onGround) }
  p.walkTo(11); p.face(1); p.cast()
  p.walkTo(13); p.waitFor('landing', () => p.engine.onGround)
  p.walkTo(14)
  p.useDoor('home')
}

// ── Starbloom ────────────────────────────────────────────────────────────

function starPorch(p: PlayerControls): void {
  p.crush(1)
  p.cast()
  // The bell frees a fairy that drifts toward the sleeping key.
  p.walkTo(6)
  expect(p.engine.fairies.length).toBe(1)
  // Draw the dragon to the tier's edge from the stair below, and crush it.
  p.walkTo(14); p.jumpToward(13); p.jumpToward(12); p.walkTo(11)
  p.crushAbove(-1)
  p.jumpCast() // clear its tomb from the edge
  p.jumpToward(10)
  // The fairy hovers by the key; the wand finds it in the empty air.
  p.walkTo(9); p.face(-1); p.cast()
  expect(p.found('key', 8, 5).hidden).toBe(false)
  p.walkTo(8)
  expect(p.holdsKey()).toBe(true)
  p.walkTo(6); p.jumpToward(5)
  p.walkTo(3); p.face(-1)
  const before = p.engine.score
  p.cast(); p.cast()
  p.walkTo(2)
  expect(p.engine.score - before, p.location()).toBe(5000)
  p.walkTo(1)
  p.useDoor('deeper')
}

function starSteps(p: PlayerControls): void {
  p.crush(1)
  p.cast()
  p.walkTo(3); p.jumpToward(4)
  // The east turret: in behind a bolt, and wall it off.
  p.waitFor('an east bolt to pass the stair', () => p.engine.shots.some(shot => shot.vx < 0 && shot.x / TILE < 4.6 && shot.x / TILE > 2.5), 600)
  p.jumpToward(5); p.face(1); p.cast()
  // The west turret: the same, one flight higher.
  p.waitFor('a west bolt to pass the stair', () => p.engine.shots.some(shot => shot.vx > 0 && shot.x / TILE > 7.5 && shot.x / TILE < 9), 600)
  p.jumpToward(6); p.face(-1); p.cast()
  breakThrough(p, 4, 6, 10)
  expect(p.holdsKey(), p.location()).toBe(true)
  p.jumpToward(11)
  p.walkTo(14)
  p.useDoor('deeper')
}

function starLoft(p: PlayerControls): void {
  p.crush(1); p.cast()
  p.crush(1); p.cast()
  p.walkTo(14); p.jumpToward(13); p.jumpToward(12)
  const ghost = p.engine.enemies.find(foe => foe.kind === 'ghost')!
  p.waitFor('the ghost to tunnel west', () => (ghost.x + ghost.w / 2) / TILE < 5 && ghost.dir < 0, 3600)
  p.jumpToward(11)
  p.crush(-1)
  p.cast()
  breakThrough(p, 4, 11, 4)
  expect(p.holdsKey(), p.location()).toBe(true)
  expect(p.found('life', 10, 4).taken).toBe(true)
  expect(p.engine.lives).toBe(4) // three, and the one the ghost dug out
  p.jumpToward(3)
  p.walkTo(1)
  p.useDoor('deeper')
}

function starHeart(p: PlayerControls): void {
  p.crush(1); p.cast()
  p.crush(1); p.cast()
  // Open the well from the ledge beside it, and catch the sparkball.
  p.walkTo(2); p.jumpToward(3); p.jumpToward(4)
  p.walkTo(6); p.face(1); p.cast()
  p.crush(1, 1800)
  p.cast()
  p.walkTo(9)
  expect(p.journey.collected('starbloom-heart')).toBe(true)
  // Out, down, and the classic find beside the door: wall in, break open.
  for (const col of [3, 2]) { p.walkTo(col); p.waitFor('landing', () => p.engine.onGround) }
  p.walkTo(12); p.face(1)
  p.cast()
  expect(p.engine.tileAt(13, 10)).toBe(BRICK)
  p.cast()
  p.walkTo(13)
  expect(p.holdsKey()).toBe(true)
  p.walkTo(14)
  p.useDoor('home')
}

describe('an uninterrupted physical labyrinth playthrough', () => {
  it('fights through every room — foes, keys, relics and buried finds — with real movement and wand inputs', () => {
    const journey = new LabyrinthJourney()
    const world = new RpgOverworld({
      has: requirement => journey.has(requirement),
      grantRelic: relic => journey.grantRelic(relic),
      seat: () => true,
      onEntrance: () => {},
    })
    expect(world.answer('mira', 1).ok).toBe(true)
    expect(journey.enterLabyrinth('sunseed')).toBe(true)
    const player = new PlayerControls(journey)
    player.wait(2)

    sunPorch(player)
    expect(journey.room!.id).toBe(roomId('sunseed', 'steps'))
    sunSteps(player)
    expect(journey.room!.id).toBe(roomId('sunseed', 'loft'))
    sunLoft(player)
    expect(journey.room!.id).toBe(roomId('sunseed', 'heart'))
    sunHeart(player)
    expect(journey.room!.id).toBe(roomId('sunseed', 'porch'))
    expect(journey.completed.has('sunseed')).toBe(true)

    journey.leave()
    expect(journey.enterLabyrinth('tideglass')).toBe(true)
    player.wait(2)
    tidePorch(player)
    expect(journey.room!.id).toBe(roomId('tideglass', 'steps'))
    tideSteps(player)
    expect(journey.room!.id).toBe(roomId('tideglass', 'loft'))
    tideLoft(player)
    expect(journey.room!.id).toBe(roomId('tideglass', 'heart'))
    tideHeart(player)
    expect(journey.room!.id).toBe(roomId('tideglass', 'porch'))
    expect(journey.completed.has('tideglass')).toBe(true)

    journey.leave()
    expect(journey.enterLabyrinth('starbloom')).toBe(true)
    player.wait(2)
    starPorch(player)
    expect(journey.room!.id).toBe(roomId('starbloom', 'steps'))
    starSteps(player)
    expect(journey.room!.id).toBe(roomId('starbloom', 'loft'))
    starLoft(player)
    expect(journey.room!.id).toBe(roomId('starbloom', 'heart'))
    starHeart(player)
    expect(journey.room!.id).toBe(roomId('starbloom', 'porch'))

    expect(journey.visited.size).toBe(12)
    expect([...journey.completed]).toEqual(['sunseed', 'tideglass', 'starbloom'])
    expect([...journey.inventory.triangles].sort()).toEqual([0, 1, 2, 3, 4, 5])
    expect(journey.inventory.hexagon && journey.inventory.star).toBe(true)
  })
})
