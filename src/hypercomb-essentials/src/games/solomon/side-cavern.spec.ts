import { describe, expect, it } from 'vitest'
import { BRICK, CRACKED, SIM_DT, TILE, WALL, type Engine } from './engine.js'
import { SIDE_CAVERNS, SideCavernRun, type CavernStep } from './side-cavern.js'
import { SideCavernRuntime } from './side-cavern-view.js'
import { LabyrinthJourney } from './labyrinth.js'
import type { RuntimeShell } from './place-runtimes.js'

function picture(engine: Engine, around = 10): string {
  const dana = { col: Math.floor((engine.player.x + engine.player.w / 2) / TILE), row: Math.floor((engine.player.y + engine.player.h - 1) / TILE) }
  const rows: string[] = []
  for (let row = Math.max(0, dana.row - around); row < Math.min(engine.rows, dana.row + around); row++) {
    let line = `${String(row).padStart(2)} `
    for (let col = Math.max(0, dana.col - 24); col < Math.min(engine.cols, dana.col + 24); col++) {
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

/** Walks a cavern with real inputs. Every foe is fought the Solomon way. */
class Walker {
  readonly steps: Exclude<CavernStep, null>[] = []
  constructor(readonly run: SideCavernRun) {}
  get engine(): Engine { return this.run.engine }

  location(): string {
    const p = this.engine.player
    return `${this.run.definition.id} (${(p.x / TILE).toFixed(2)}, ${(p.y / TILE).toFixed(2)}) lives ${this.engine.lives}\n${picture(this.engine)}`
  }

  tick(input: Partial<{ left: boolean; right: boolean; down: boolean; jump: boolean }> = {}): void {
    Object.assign(this.engine.input, { left: false, right: false, down: false, jump: false }, input)
    const lives = this.engine.lives
    const before = `${picture(this.engine, 4)}
  foes: ${this.engine.enemies.map(foe => `${foe.kind}${foe.alive ? '' : '†'} ${(foe.x / TILE).toFixed(2)},${(foe.y / TILE).toFixed(2)} ${foe.state}`).join('; ')} bolts: ${this.engine.shots.map(shot => `${(shot.x / TILE).toFixed(1)},${(shot.y / TILE).toFixed(1)}`).join(' ')}`
    const step = this.run.step(SIM_DT)
    if (step) this.steps.push(step)
    if (this.engine.lives < lives || this.engine.state !== 'playing') throw new Error(`Lost a life at ${this.location()}
the step before:
${before}`)
  }
  wait(n: number): void { for (let i = 0; i < n; i++) this.tick() }
  waitFor(what: string, done: () => boolean, n = 600): void {
    for (let i = 0; i < n; i++) { if (done()) return; this.tick() }
    throw new Error(`Waited in vain for ${what} at ${this.location()}`)
  }
  column(): number { return (this.engine.player.x + this.engine.player.w / 2) / TILE }
  walkTo(col: number): void {
    for (let i = 0; i < 600; i++) {
      const c = this.column()
      if (Math.abs(c - col - 0.5) < 0.08) { this.wait(8); return }
      this.tick({ left: c > col + 0.5, right: c < col + 0.5 })
    }
    throw new Error(`Could not walk to ${col} at ${this.location()}`)
  }
  jumpToward(col: number): void {
    this.wait(2)
    let air = false
    for (let i = 0; i < 120; i++) {
      const c = this.column()
      this.tick({ left: c > col + 0.58, right: c < col + 0.42, jump: true })
      air ||= !this.engine.onGround
      if (air && this.engine.onGround) return
    }
    throw new Error(`Could not jump toward ${col} at ${this.location()}`)
  }
  land(): void { this.waitFor('landing', () => this.engine.onGround) ; this.wait(4) }
  face(dir: 1 | -1): void { this.tick(dir > 0 ? { right: true } : { left: true }); this.wait(3) }
  cast(down = false): void { this.tick({ down }); this.engine.cast(); this.tick() }
  alive(): number { return this.engine.enemies.filter(foe => foe.alive).length }
  crush(dir: 1 | -1, n = 900): void {
    this.face(dir)
    const inFront = () => {
      const target = this.engine.targetCell()
      return this.engine.enemies.find(foe => foe.alive && this.engine.rectOverlapsCell(foe, target.col, target.row))
    }
    this.waitFor('a foe in front of the wand', () => !!inFront(), n)
    const foe = inFront()!
    this.engine.cast()
    this.tick()
    expect(foe.alive, `the crush at ${this.location()}`).toBe(false)
  }
  /** Bridge a bottomless gap brick by brick: kneel, conjure the floor in front, step on. */
  bridge(from: number, to: number): void {
    this.walkTo(from)
    for (let col = from + 1; col <= to; col++) {
      this.face(1)
      this.cast(true)
      expect(this.engine.tileAt(col, this.engine.rows - 1), this.location()).toBe(BRICK)
      this.walkTo(col)
    }
  }
}

const cavern = (id: string) => SIDE_CAVERNS.find(candidate => candidate.id === id)!

describe('side-view caverns', () => {
  it('draws each cavern its own size, with a mouth, a way deeper behind a key, foes and buried finds', () => {
    expect(SIDE_CAVERNS.map(c => [c.id, c.level.cols, c.level.rows])).toEqual([['root-run', 48, 12], ['the-burrow', 16, 36]])
    for (const c of SIDE_CAVERNS) {
      expect(c.keyed, c.id).toBe(true)
      expect(c.deeper, c.id).not.toBeNull()
      expect(c.level.enemies.length + c.level.mirrors.length, c.id).toBeGreaterThan(2)
      expect(c.level.items.filter(item => item.hidden).length, c.id).toBeGreaterThanOrEqual(4)
    }
  })

  it('walks out through the mouth, the way it came in', () => {
    const walker = new Walker(new SideCavernRun(cavern('root-run')))
    walker.walkTo(1)
    expect(walker.steps).toEqual([{ kind: 'up' }])
  })

  it('fights through the Root Run to the way deeper', () => {
    const run = new SideCavernRun(cavern('root-run')), p = new Walker(run)
    const goblins = run.engine.enemies.filter(foe => foe.kind === 'goblin')
    // The mouth goblin comes for you as soon as it sees you.
    p.crush(1); p.cast()
    // Break the bumper (a jar in it) and bridge the bottomless gap.
    p.walkTo(11); p.face(1); p.cast()
    expect(p.engine.items.find(item => item.kind === 'jar' && item.col === 12)?.hidden).toBe(false)
    p.bridge(12, 15)
    // The tunnel's ghost comes back west, hunting.
    p.crush(1); p.cast()
    p.walkTo(31)
    // The climb, across the turret's line: step in behind a bolt, wall it off.
    p.jumpToward(32)
    p.waitFor('a bolt to pass the stair', () => run.engine.shots.some(shot => shot.vx < 0 && shot.x / TILE < 32.5 && shot.x / TILE > 31), 900)
    p.jumpToward(33); p.face(1); p.cast()
    p.jumpToward(34); p.jumpToward(35); p.walkTo(37)
    expect(run.holdsKey).toBe(true)
    // Down past the turret's line behind a bolt.
    p.walkTo(38)
    p.waitFor('a bolt to pass the drop', () => run.engine.shots.some(shot => shot.vx < 0 && shot.x / TILE < 38.5 && shot.x / TILE > 36), 900)
    p.walkTo(40); p.land()
    // The last goblin punches through its bumper and charges into the gap.
    p.waitFor('the last goblin to charge into the gap', () => !goblins[1]!.alive, 900)
    p.bridge(40, 42)
    p.walkTo(46)
    expect(p.steps.at(-1)).toEqual({ kind: 'down', entrance: 'deeper' })
  })

  it('digs down through the Burrow to the way deeper', () => {
    const run = new SideCavernRun(cavern('the-burrow')), p = new Walker(run)
    p.crush(1); p.cast()
    // An open drop to the first tier; the ghost hunts it.
    p.walkTo(12); p.land()
    p.crush(-1); p.cast()
    // Dig through the brick floor on the west.
    p.walkTo(4); p.face(-1); p.cast(true)
    p.walkTo(3); p.land()
    p.crush(1); p.cast()
    p.crush(1); p.cast()
    // The key is in the brick you dig through.
    p.walkTo(9); p.face(1); p.cast(true)
    expect(run.engine.items.find(item => item.kind === 'key')?.hidden).toBe(false)
    p.walkTo(10); p.land()
    expect(run.holdsKey).toBe(true)
    // The gargoil fires on sight: wall it off, then dig on.
    p.face(-1); p.cast()
    p.face(1); p.cast(true)
    p.walkTo(11); p.land()
    p.crush(-1); p.cast()
    p.walkTo(13)
    expect(p.steps.at(-1)).toEqual({ kind: 'down', entrance: 'deeper' })
  })

  it('runs as a place: in at the mouth, out through it, and the way deeper says it wants the key', () => {
    const calls: string[] = []
    const journey = new LabyrinthJourney()
    const shell = {
      journey: () => journey,
      leave: (from: string, exit?: string) => { calls.push(`leave ${from} ${exit}`) },
      enter: (from: string, entrance: string) => { calls.push(`enter ${from} ${entrance}`) },
      message: (text: string) => { calls.push(`message ${text}`) },
      sound: () => {}, seat: () => null, seatSeed: () => null,
    } as unknown as RuntimeShell
    const host = document.createElement('div')
    document.body.append(host)
    const runtime = new SideCavernRuntime(host, cavern('root-run'), shell)
    runtime.show({ from: 'above', seat: { entrance: 'greenwood/root-cave', place: 'root-run' }, arrive: 'mouth' })
    const still = { left: false, right: false, up: false, down: false }
    // The way deeper, without its key.
    runtime.run.engine.arrive({ col: 46, row: 10 })
    runtime.update(1 / 60, still)
    expect(calls).toContain('message This cavern’s key opens the way deeper.')
    // Back to the mouth, and out.
    runtime.run.engine.arrive({ col: 3, row: 10 })
    for (let i = 0; i < 240 && !calls.some(call => call.startsWith('leave')); i++) runtime.update(1 / 60, { ...still, left: true })
    expect(calls).toContain('leave root-run mouth')
    expect(runtime.seed().cols).toBe(48)
    runtime.dispose()
    host.remove()
  })
})
