import { describe, expect, it } from 'vitest'
import { BRICK, EMPTY, SIM_DT, TILE } from './engine.js'
import { LabyrinthJourney } from './labyrinth.js'
import { RpgOverworld } from './rpg-overworld.js'

/** Exercise authored geometry through player controls. No test changes positions,
 * terrain, enemies, health or pickup flags; only normal doors change chambers. */
class PlayerControls {
  constructor(readonly journey: LabyrinthJourney) {}

  location(): string {
    const engine = this.journey.engine!
    return `${this.journey.room!.id} (${(engine.player.x / TILE).toFixed(2)}, ${(engine.player.y / TILE).toFixed(2)})`
  }

  tick(input: Partial<{ left: boolean; right: boolean; down: boolean; jump: boolean }> = {}): void {
    const engine = this.journey.engine!
    Object.assign(engine.input, { left: false, right: false, down: false, jump: false }, input)
    this.journey.update(SIM_DT)
    if (engine.lives !== 3 || engine.state !== 'playing') throw new Error(`Route lost a life at ${this.location()}`)
    // The Hush must never open on this pinned route once the Stand is armed
    // (§7.12/M17): every content placement (§6.11) sits clear of the walked
    // path by margin, and this guard is what actually protects that margin —
    // if a future placement or a geometry change ever brought a FIGHTER back
    // into HUSH_REACH, this throws immediately instead of silently drifting
    // the route's timing (a Hush changes Dana's own tempo — never — but slows
    // everything else, which would desync every frame-exact assertion below).
    if (engine.battle) throw new Error(`An unplanned Hush opened at ${this.location()}`)
  }

  wait(steps: number): void { for (let i = 0; i < steps; i++) this.tick() }

  walkTo(col: number): void {
    for (let step = 0; step < 300; step++) {
      const center = (this.journey.engine!.player.x + this.journey.engine!.player.w / 2) / TILE
      if (Math.abs(center - col - 0.5) < 0.08) { this.wait(8); return }
      this.tick({ left: center > col + 0.5, right: center < col + 0.5 })
    }
    throw new Error(`Could not walk to column ${col} from ${this.location()}`)
  }

  jumpToward(col: number): void {
    this.wait(2) // release the previous jump, then use a fresh press
    let airborne = false
    for (let step = 0; step < 100; step++) {
      const center = (this.journey.engine!.player.x + this.journey.engine!.player.w / 2) / TILE
      this.tick({ left: center > col + 0.58, right: center < col + 0.42, jump: true })
      airborne ||= !this.journey.engine!.onGround
      if (airborne && this.journey.engine!.onGround) return
    }
    throw new Error(`Could not finish jump toward column ${col} from ${this.location()}`)
  }

  cast(down = false): void {
    this.tick({ down })
    this.journey.engine!.cast()
    this.tick()
  }

  useDoor(id: string): void {
    const result = this.journey.useDoor(id)
    if (result.kind !== 'travelled') throw new Error(`${result.message} at ${this.location()}`)
  }

  climbMiddle(): void {
    this.jumpToward(5)
    this.walkTo(5)
    this.jumpToward(7)
    this.walkTo(8)
    expect(this.journey.engine!.player.y / TILE).toBe(6)
  }

  /** Extend the lower shelf left by one block; that standing position clears
   * the upper shelf's overhang so a normal two-tile jump reaches its top. */
  climbUpper(): void {
    this.walkTo(6)
    this.tick({ left: true })
    this.cast(true)
    expect(this.journey.engine!.tileAt(5, 7)).toBe(BRICK)
    this.walkTo(5)
    this.jumpToward(7)
    expect(this.journey.engine!.player.y / TILE).toBe(4)
  }

  findExpeditionSecret(): void {
    this.jumpToward(5)
    this.walkTo(5)
    this.jumpToward(7)
    this.climbUpper()
    this.walkTo(6)
    this.jumpToward(3)
    this.walkTo(3)
    this.tick({ left: true })
    expect(this.journey.engine!.targetCell()).toEqual({ col: 2, row: 2 })
    const secret = this.journey.engine!.items.find(item => item.secret && item.deep)!
    const before = this.journey.engine!.score
    this.cast()
    expect(secret.hidden).toBe(true)
    expect(this.journey.engine!.tileAt(2, 2)).toBe(BRICK)
    this.cast()
    expect(secret.hidden).toBe(false)
    expect(this.journey.engine!.tileAt(2, 2)).toBe(EMPTY)
    this.walkTo(2)
    expect(secret.taken).toBe(true)
    expect(this.journey.engine!.score - before).toBe(5000)
  }

  nextRoom(): void {
    this.walkTo(14)
    for (let step = 0; step < 120 && !this.journey.engine!.onGround; step++) this.tick()
    this.useDoor('deeper')
  }
}

describe('an uninterrupted physical labyrinth playthrough', () => {
  it('reaches all twelve rooms, both inscription secrets and the pyramid heart with real movement and spell inputs', () => {
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
    // Arm the Stand once, early (§6.11 places its stele one tile from spawn,
    // reachable without a single step) — so the tick() guard above actually
    // protects the margin §1.15/§3.5.3 measured, rather than passing trivially
    // forever against a permanently-empty kit.
    expect(journey.engine!.interact()?.id).toBe('stand')

    for (const id of ['sunseed', 'tideglass', 'starbloom']) {
      if (id !== 'sunseed') { journey.leave(); expect(journey.enterLabyrinth(id)).toBe(true) }
      if (id !== 'starbloom') player.findExpeditionSecret()
      else player.climbMiddle()
      player.nextRoom()

      // Walk away from the arrival lock, back through the reciprocal door,
      // and into the same retained room again, using its actual floor route.
      const stepsRoom = journey.engine!
      player.walkTo(3)
      player.walkTo(1)
      player.useDoor('return')
      player.walkTo(11)
      player.walkTo(14)
      player.useDoor('deeper')
      expect(journey.engine).toBe(stepsRoom)

      player.climbMiddle()
      player.climbUpper()
      player.walkTo(7)
      player.useDoor('fold')
      expect(journey.room!.id).toBe(`${id}-heart`)
      player.walkTo(9)
      player.walkTo(7)
      player.useDoor('fold')
      expect(journey.engine).toBe(stepsRoom)
      expect(journey.engine!.tileAt(5, 7)).toBe(BRICK)

      player.nextRoom()
      expect(journey.room!.id).toBe(`${id}-loft`)
      player.climbMiddle()
      player.nextRoom()
      player.climbMiddle()
      player.walkTo(12)
      player.wait(30)
      expect(journey.completed.has(id)).toBe(true)
      player.walkTo(14)
      player.wait(30)
      player.useDoor('home')
      expect(journey.room!.id).toBe(`${id}-porch`)
    }

    expect(journey.visited.size).toBe(12)
    expect([...journey.completed]).toEqual(['sunseed', 'tideglass', 'starbloom'])
    expect([...journey.inventory.triangles].sort()).toEqual([0, 1, 2, 3, 4, 5])
    expect(journey.inventory.hexagon && journey.inventory.star).toBe(true)
    expect(journey.engine!.lives).toBe(3)
  })
})
