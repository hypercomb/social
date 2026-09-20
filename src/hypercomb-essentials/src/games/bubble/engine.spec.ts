import { describe, expect, it } from 'vitest'
import { CAVE_LEFT, Engine, HEIGHT, TILE, WIDTH, type Input, type LevelDef } from './engine.js'
import { BUILTIN_LEVELS } from './levels.js'

const idle: Input = { left: false, right: false, jump: false, blow: false }
function advance(game: Engine, seconds: number, input: Partial<Input> = {}): void {
  for (let elapsed = 0; elapsed < seconds - 0.00001; elapsed += 1 / 120) game.update(1 / 120, { ...idle, ...input })
}
function arena(platform = false): LevelDef {
  const tiles = Array.from({ length: 25 }, (_, row) => row === 24 ? '#'.repeat(32) : '##' + '.'.repeat(28) + '##')
  if (platform) tiles[19] = '##' + '.'.repeat(8) + '='.repeat(10) + '.'.repeat(10) + '##'
  return { name: 'Test cave', tiles, spawn: { x: 136, y: 176 }, enemies: [{ x: 248, y: 176, kind: 'zenchan' }] }
}
function nativeArena(name = 'Native test cave'): LevelDef {
  return { ...arena(), name, nativeCells: Array.from({ length: 25 }, () => Array<number>(40).fill(0)) }
}
function playing(level: LevelDef = arena()): Engine {
  const game = new Engine([level], () => 0.5)
  advance(game, level.nativeCells ? 2.5 : 1.05)
  game.player.invulnerable = 100
  return game
}
function capture(game: Engine): void {
  game.player.x = 72
  game.enemies[0].x = 112
  game.enemies[0].y = 176
  game.enemies[0].facing = -1
  advance(game, 0.2, { blow: true })
  expect(game.enemies[0].state).toBe('trapped')
  expect(game.fx.trap).toBe(1)
}
function jumpPop(game: Engine): void {
  const b = game.bubbles.find(bubble => bubble.trappedId !== null)!
  b.age = 1.2
  b.vx = 0; b.vy = 0; b.x = 168; b.y = 164
  game.player.x = 160
  game.player.y = 176
  game.player.grounded = true
  advance(game, 0.08, { jump: true })
}

describe('NovaLogic DOS Bubble Bobble reconstruction', () => {
  it('decodes the exact 100-round DOS terrain and enemy descriptors', () => {
    expect([WIDTH, HEIGHT, TILE, CAVE_LEFT]).toEqual([320, 200, 8, 40])
    expect(BUILTIN_LEVELS).toHaveLength(100)
    for (const level of BUILTIN_LEVELS) {
      expect(level.tiles).toHaveLength(25)
      expect(level.tiles.every(row => row.length === 32)).toBe(true)
      expect(level.nativeCells).toHaveLength(25)
      expect(level.nativeCells?.every(row => row.length === 40 && row.every(cell => cell >= 0 && cell <= 7))).toBe(true)
      expect(level.spawn).toEqual({ x: 0x38, y: 0xb0 })
    }
    expect(BUILTIN_LEVELS[0].tiles[0]).toBe('##' + '='.repeat(28) + '##')
    expect(BUILTIN_LEVELS[0].tiles[9]).toBe('##==...==================...==##')
    expect(BUILTIN_LEVELS[0].enemies.map(enemy => enemy.kind)).toEqual(['zenchan', 'zenchan', 'zenchan'])
    expect(BUILTIN_LEVELS[0].enemies.map(({ x, y, spawnDelay }) => ({ x, y, spawnDelay }))).toEqual([
      { x: 160, y: 0, spawnDelay: 10 },
      { x: 160, y: 0, spawnDelay: 17 },
      { x: 160, y: 0, spawnDelay: 24 },
    ])
    expect(BUILTIN_LEVELS[0].enemies.map(enemy => enemy.activationDelayTicks)).toEqual([25, 42, 60])
    expect(BUILTIN_LEVELS[0].airflowSettings).toEqual([0x49, 0xea, 0x70])
    expect(BUILTIN_LEVELS[0].nativeCells?.[0][32]).toBe(4)
    // Round one's first native airflow rectangle paints x=0..13, y=1..4;
    // its mirror opcode derives the right half while preserving occupancy.
    expect(BUILTIN_LEVELS[0].nativeCells?.[1].slice(0, 16)).toEqual([
      3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 4, 4,
    ])
    // Round 28's AIRBLOCK record clears an otherwise occupied x=2 strip.
    expect(BUILTIN_LEVELS[27].tiles.slice(16, 24).every(row => row[2] === '.')).toBe(true)
    const firstRoundByKind = new Map<string, number>()
    BUILTIN_LEVELS.forEach((level, round) => level.enemies.forEach(enemy => {
      if (!firstRoundByKind.has(enemy.kind)) firstRoundByKind.set(enemy.kind, round + 1)
    }))
    expect(Object.fromEntries(firstRoundByKind)).toEqual({
      zenchan: 1, mighta: 7, monsta: 11, pulpul: 21,
      banebou: 31, hidegons: 41, drunk: 51, invader: 61,
    })
    expect(BUILTIN_LEVELS.reduce((count, level) => count + level.enemies.length, 0)).toBe(575)
    expect(BUILTIN_LEVELS[99].name).toBe('ROUND 100')
  })

  it('starts ready, settles onto the floor and cannot tunnel through solid side walls', () => {
    const game = new Engine([arena()], () => 0.5)
    advance(game, 0.5, { left: true })
    expect(game.state).toBe('ready')
    expect(game.player.x).toBe(136)
    advance(game, 0.55)
    game.player.invulnerable = 100
    advance(game, 3, { left: true })
    expect(game.state).toBe('playing')
    expect(game.player.x).toBe(56)
    expect(game.player.y).toBe(176)
    expect(game.player.grounded).toBe(true)
    expect(game.lives).toBe(3)
  })

  it('runs native entrances and descriptor delays on whole 60 Hz ticks', () => {
    const game = new Engine([BUILTIN_LEVELS[0]], () => 0.5)
    const tick = (): void => game.update(1 / 60, idle)
    expect(game.enemies.map(enemy => [enemy.y, enemy.state])).toEqual([
      [-1, 'entering'], [-1, 'entering'], [-1, 'entering'],
    ])
    for (let count = 0; count < 16; count++) tick()
    expect(game.enemies[0]).toMatchObject({ y: -1, state: 'entering' })
    tick()
    expect(game.enemies[0]).toMatchObject({ y: 0, state: 'entering' })
    tick()
    expect(game.enemies[0].state).toBe('waiting')
    for (let count = 18; count < 148; count++) tick()
    expect(game.state).toBe('playing')
    expect(game.player).toMatchObject({ x: 0x38, y: 0xb0 })
    expect(game.enemies.every(enemy => enemy.state === 'waiting')).toBe(true)
    tick() // deadlines are based on this first post-intro general tick
    for (let count = 0; count < 24; count++) tick()
    expect(game.enemies[0].state).toBe('waiting')
    tick()
    expect(game.enemies.map(enemy => enemy.state)).toEqual(['walking', 'waiting', 'waiting'])
  })

  it('keeps the native entrance gate open after player movement and resets it on restart', () => {
    const level: LevelDef = {
      ...arena(),
      nativeCells: Array.from({ length: 25 }, () => Array<number>(40).fill(0)),
      enemies: [{ x: 160, y: 8, kind: 'zenchan', headingCode: 1, activationDelayTicks: 0 }],
    }
    const game = new Engine([level], () => 0.5)
    for (let tick = 0; tick < 16; tick++) game.update(1 / 60, idle)
    expect(game.enemies[0].y).toBe(-1)
    game.update(1 / 60, idle)
    expect(game.enemies[0].y).toBe(0)
    game.player.y = 0
    game.update(1 / 60, idle)
    expect(game.enemies[0].y).toBe(1)

    game.restart()
    game.update(1 / 60, idle)
    expect(game.enemies[0].y).toBe(-1)
  })

  it('resets the native entrance gate when loading the next round', () => {
    const round = (name: string): LevelDef => ({
      ...arena(), name,
      nativeCells: Array.from({ length: 25 }, () => Array<number>(40).fill(0)),
      enemies: [{ x: 160, y: 0, kind: 'zenchan', headingCode: 1, activationDelayTicks: 0 }],
    })
    const game = new Engine([round('ROUND ONE'), round('ROUND TWO')], () => 0.5)
    for (let tick = 0; tick < 148; tick++) game.update(1 / 60, idle)
    game.enemies[0].state = 'trapped'
    game.player.x = 160; game.player.y = 176; game.player.grounded = true
    game.bubbles.push({ x: 168, y: 184, r: 6, vx: 0, vy: 0, age: 0,
      trappedId: game.enemies[0].id, phase: 'floating', ticksRemaining: 0x23f, travelRemaining: 0 })
    game.update(1 / 60, idle)
    expect(game.state).toBe('playing')
    for (let tick = 0; tick < 599 && game.level.name !== 'ROUND TWO'; tick++) game.update(1 / 60, idle)
    expect(game.level.name).toBe('ROUND TWO')
    expect(game.enemies[0].y).toBe(-1)
    game.update(1 / 60, idle)
    expect(game.enemies[0].y).toBe(-1)
  })

  it.each([0, 1, 63])('scales native descriptor delay %i and uses A974 raw wrap comparison', delay => {
    const activationDelayTicks = Math.floor(delay * 5 / 2)
    const level: LevelDef = {
      ...arena(),
      nativeCells: Array.from({ length: 25 }, () => Array<number>(40).fill(0)),
      enemies: [{ x: 160, y: 0, kind: 'zenchan', headingCode: 1, spawnDelay: delay, activationDelayTicks }],
    }
    const game = new Engine([level], () => 0.5)
    const tick = (): void => game.update(1 / 60, idle)
    for (let count = 0; count < 148; count++) tick()
    expect(game).toMatchObject({ state: 'playing' })
    tick() // A950 stores generalTick + floor(delay * 5 / 2).
    const activationTicks = Math.max(1, activationDelayTicks)
    for (let count = 1; count < activationTicks; count++) {
      tick()
      expect(game.enemies[0].state).toBe('waiting')
    }
    tick()
    expect(game.enemies[0].state).toBe('walking')
  })

  it('activates a wrapped native deadline with raw unsigned comparison and keeps split ticks identical', () => {
    const level: LevelDef = {
      ...arena(),
      nativeCells: Array.from({ length: 25 }, () => Array<number>(40).fill(0)),
      enemies: [{ x: 160, y: 0, kind: 'zenchan', headingCode: 1, spawnDelay: 10, activationDelayTicks: 25 }],
    }
    const direct = new Engine([level], () => 0.5)
    const split = new Engine([level], () => 0.5)
    const ready = (game: Engine, frame: () => void): void => {
      for (let tick = 0; tick < 148; tick++) frame()
      ;(game as unknown as { nativeTick: number }).nativeTick = 0xfff0
      frame() // schedule u16(FFF1 + 25) = 000A
    }
    ready(direct, () => direct.update(1 / 60, idle))
    ready(split, () => { split.update(1 / 120, idle); split.update(1 / 120, idle) })
    expect(direct.enemies[0].state).toBe('waiting')
    direct.update(1 / 60, idle)
    split.update(1 / 120, idle); split.update(1 / 120, idle)
    expect(direct.enemies[0].state).toBe('walking')
    expect(split.enemies[0]).toEqual(direct.enemies[0])
  })

  it.each([
    [0, -1],
    [1, 1],
  ] as const)('gives native Zen-Chan heading %i a D1C5 no-motion init tick before D204 walking', (headingCode, direction) => {
    const level: LevelDef = {
      ...arena(),
      nativeCells: Array.from({ length: 25 }, () => Array<number>(40).fill(0)),
      enemies: [{ x: 160, y: 0, kind: 'zenchan', headingCode, activationDelayTicks: 0 }],
    }
    const direct = new Engine([level], () => 0.5)
    const split = new Engine([level], () => 0.5)
    const advanceToActivation = (game: Engine, frame: () => void): void => {
      for (let tick = 0; tick < 240; tick++) {
        frame()
        if (game.enemies[0].state === 'walking') return
      }
      throw new Error('Zen-Chan did not reach its activation procedure')
    }

    advanceToActivation(direct, () => direct.update(1 / 60, idle))
    advanceToActivation(split, () => {
      split.update(1 / 120, idle)
      split.update(1 / 120, idle)
    })
    for (const game of [direct, split]) {
      // Keep the next D204 pass out of its native jump/hop selectors so this
      // test observes its ordinary directional walk.
      Object.assign(game.enemies[0], { x: 160, y: 32, vx: 0, vy: 0, grounded: true })
    }

    direct.update(1 / 60, idle)
    split.update(1 / 120, idle)
    split.update(1 / 120, idle)
    expect(direct.enemies[0]).toMatchObject({ x: 160, y: 32, vx: direction * 60, vy: 0 })
    expect(split.enemies[0]).toEqual(direct.enemies[0])

    direct.update(1 / 60, idle)
    split.update(1 / 120, idle)
    split.update(1 / 120, idle)
    expect(direct.enemies[0].x).toBe(160 + direction)
    expect(split.enemies[0]).toEqual(direct.enemies[0])
  })

  it('keeps a legacy custom activation-delay Zen-Chan on its existing immediate walking path', () => {
    const level: LevelDef = {
      ...arena(),
      enemies: [{ x: 160, y: 0, kind: 'zenchan', headingCode: 1, activationDelayTicks: 0 }],
    }
    const game = new Engine([level], () => 0.5)
    for (let tick = 0; tick < 120 && game.enemies[0].state !== 'walking'; tick++) game.update(1 / 60, idle)
    expect(game.enemies[0].state).toBe('walking')
    Object.assign(game.enemies[0], { x: 160, y: 32, vx: 0, vy: 0, grounded: true })

    game.update(1 / 60, idle)
    expect(game.enemies[0]).toMatchObject({ x: 161, vx: 60 })
  })

  it('cancels a native Zen-Chan initializer captured on its activation tick', () => {
    const level: LevelDef = {
      ...arena(),
      nativeCells: Array.from({ length: 25 }, () => Array<number>(40).fill(0)),
      enemies: [{ x: 160, y: 0, kind: 'zenchan', headingCode: 1, activationDelayTicks: 0 }],
    }
    const game = new Engine([level], () => 0.5)
    for (let tick = 0; tick < 200; tick++) {
      game.update(1 / 60, idle)
      if (game.state === 'playing' && game.enemies[0].state === 'waiting') break
    }
    expect(game).toMatchObject({ state: 'playing' })
    game.update(1 / 60, idle) // A950 schedules the zero-delay activation.
    game.bubbles.push({ x: 168, y: 8, r: 6, vx: 0, vy: 0, age: 0,
      trappedId: null, phase: 'projectile', ticksRemaining: 0x1fe, travelRemaining: 0x50 })

    game.update(1 / 60, idle) // A974 activates; moveBubbles captures in this tick.
    expect(game.enemies[0]).toMatchObject({ state: 'trapped', vx: 0, vy: 0 })
    game.update(1 / 60, idle)
    expect(game.enemies[0]).toMatchObject({ state: 'trapped', vx: 0, vy: 0 })

    game.bubbles[0].ticksRemaining = 1
    game.update(1 / 60, idle)
    expect(game.enemies[0]).toMatchObject({ state: 'walking', vx: 0, vy: 0 })
  })

  it('uses descriptor heading bits for Pulpul, Monsta and Invader handlers', () => {
    const level = arena()
    level.enemies = [
      { x: 104, y: 80, kind: 'monsta', headingCode: 0x14 },
      { x: 168, y: 80, kind: 'pulpul', headingCode: 0x0a },
      { x: 232, y: 80, kind: 'invader', headingCode: 0x01 },
    ]
    const game = playing(level)
    const before = game.enemies.map(({ x, y }) => ({ x, y }))
    game.update(1 / 60, idle)
    expect(game.enemies[0]).toMatchObject({ x: before[0].x + 1, y: before[0].y + 1, facing: 1 })
    expect(game.enemies[1]).toMatchObject({ x: before[1].x - 1, y: before[1].y - 0.5, facing: -1 })
    expect(game.enemies[2]).toMatchObject({ x: before[2].x + 2, y: before[2].y, facing: 1 })
  })

  it('moves native flying enemies y-first and reflects against directional collision masks', () => {
    const level: LevelDef = {
      ...BUILTIN_LEVELS[0],
      enemies: [{ x: 56, y: 88, kind: 'monsta', headingCode: 0x0a, activationDelayTicks: 1_000 }],
    }
    const game = playing(level)
    const enemy = game.enemies[0]
    Object.assign(enemy, { state: 'walking', x: 56, y: 88, vx: 0, vy: 0, grounded: false })

    game.update(1 / 60, idle)
    expect(enemy).toMatchObject({ x: 56, y: 87, vx: 60, vy: -60, facing: 1 })
  })

  it.each(['zenchan', 'mighta', 'hidegons', 'drunk', 'banebou'] as const)(
    'runs all four AA4A facing flips before %s high-jump movement', kind => {
      for (const facing of [-1, 1] as const) {
        const game = new Engine([BUILTIN_LEVELS[0]], () => 0)
        advance(game, 2.5)
        game.player.invulnerable = 100
        game.player.x = 56; game.player.y = 128
        game.enemies.slice(1).forEach(enemy => { enemy.state = 'trapped' })
        const enemy = game.enemies[0]
        Object.assign(enemy, { kind, state: 'walking', x: 160, y: 176, vx: 0, vy: 0, grounded: true, facing })

        game.update(1 / 60, idle) // A99F selects the jump state.
        expect(enemy).toMatchObject({ x: 160, y: 176, vx: 0, vy: 0, facing })
        for (let tick = 0; tick < 4; tick++) {
          // Sub-tick updates must not advance the native state machine.
          game.update(1 / 120, idle)
          expect(enemy.facing).toBe(tick % 2 === 0 ? facing : -facing)
          game.update(1 / 120, idle)
          expect(enemy).toMatchObject({ x: 160, y: 176, vx: 0,
            vy: tick === 3 ? -300 : 0, facing: tick % 2 === 0 ? -facing : facing })
        }
        expect(enemy).toMatchObject({ y: 176, vy: -300, grounded: false })
        game.update(1 / 60, idle)
        expect(enemy.y).toBe(171)
        expect(enemy.vy).toBe(-281.25)
      }
    })

  it('installs BANEBou\'s small hop one tick before its first 8.8 movement pass', () => {
    const level: LevelDef = {
      ...BUILTIN_LEVELS[0],
      enemies: [{ x: 160, y: 176, kind: 'banebou', activationDelayTicks: 1_000 }],
    }
    const game = playing(level)
    const enemy = game.enemies[0]
    Object.assign(enemy, { state: 'walking', x: 160, y: 176, vx: 0, vy: 0, grounded: true, facing: 1 })

    game.update(1 / 60, idle)
    expect(enemy).toMatchObject({ x: 160, y: 176, vy: -90, grounded: false })
    game.update(1 / 60, idle)
    expect(enemy).toMatchObject({ x: 161, y: 174.5, vy: -85.3125 })
  })

  it('uses AAF6 open-gap probing before installing a walker\'s small hop', () => {
    const level: LevelDef = {
      ...arena(),
      nativeCells: Array.from({ length: 25 }, () => Array<number>(40).fill(0)),
      enemies: [{ x: 160, y: 128, kind: 'zenchan', headingCode: 1, activationDelayTicks: 1_000 }],
    }
    const rolls = [0, 0.9, 0]
    const game = new Engine([level], () => rolls.shift() ?? 0.9)
    advance(game, 2.5)
    game.player.invulnerable = 100
    game.player.x = 56; game.player.y = 100
    const enemy = game.enemies[0]
    Object.assign(enemy, { state: 'walking', x: 160, y: 128, vx: 60, vy: 0, grounded: true, facing: 1 })

    game.update(1 / 60, idle)
    expect(enemy).toMatchObject({ x: 160, y: 128, vy: -90, grounded: false })
    game.update(1 / 60, idle)
    expect(enemy).toMatchObject({ x: 161, y: 126.5, vy: -85.3125 })
  })

  it('jumps upward through one-way ledges and lands on their top without auto-jumping', () => {
    const game = playing(arena(true))
    advance(game, 0.55, { jump: true })
    expect(game.player.y).toBeLessThan(136)
    advance(game, 0.9, { jump: true })
    expect(game.player.y).toBe(136)
    expect(game.player.grounded).toBe(true)
    expect(game.fx.jump).toBe(1)
    advance(game, 0.1)
    advance(game, 0.05, { jump: true })
    expect(game.fx.jump).toBe(2)
  })

  it.each([0, 1, 2])('uses round %i native bottom row as a landing surface', index => {
    const game = playing(BUILTIN_LEVELS[index])
    game.enemies.forEach(enemy => { enemy.state = 'trapped' })
    game.player.x = 168
    game.player.y = 160
    game.player.vx = 0
    game.player.vy = 0
    game.player.grounded = false
    advance(game, 0.5)
    expect(game.player.y).toBe(176)
    expect(game.player.grounded).toBe(true)
  })

  it('uses the native solid underside, turn tick and delayed first jump step', () => {
    const game = playing(BUILTIN_LEVELS[0])
    game.enemies.forEach(enemy => { enemy.state = 'trapped' })
    game.player.x = 160; game.player.y = 176; game.player.grounded = true
    game.player.vx = 0; game.player.vy = 0; game.player.facing = 1

    game.update(1 / 60, { ...idle, left: true })
    expect(game.player).toMatchObject({ x: 160, facing: -1, vx: 0 })
    game.update(1 / 60, { ...idle, left: true })
    expect(game.player.x).toBe(159)

    game.player.x = 160; game.player.y = 176; game.player.grounded = true
    game.update(1 / 60, { ...idle, jump: true })
    expect(game.player.y).toBe(176)
    expect(game.player.vy).toBe(-168.75)
    game.update(1 / 60, idle)
    expect(game.player.y).toBe(173.28125)
    let minimum = game.player.y
    for (let tick = 0; tick < 90; tick++) {
      game.update(1 / 60, idle)
      minimum = Math.min(minimum, game.player.y)
    }
    // ROUND 01's row-19 platform has a solid native underside at y=160.
    expect(minimum).toBe(160)
    expect(game.player).toMatchObject({ y: 176, grounded: true })
  })

  it('keeps takeoff momentum until reverse input gives air control', () => {
    const game = playing()
    advance(game, 0.1, { right: true })
    advance(game, 0.1, { right: true, jump: true })
    expect(game.player.vx).toBe(60)
    advance(game, 0.05, { left: true })
    expect(game.player.vx).toBe(-60)
    expect(game.player.facing).toBe(-1)
  })

  it('launches bubbles, captures an enemy, then releases it after 0x23f native ticks', () => {
    const game = playing()
    capture(game)
    const bubble = game.bubbles.find(b => b.trappedId !== null)!
    expect(bubble).toMatchObject({ phase: 'floating', vx: 0 })
    game.player.x = 56
    advance(game, 2)
    expect(bubble.y).toBeLessThan(200)
    expect(bubble.vy).toBeLessThan(0)
    advance(game, 7.7)
    expect(game.bubbles).toHaveLength(0)
    expect(game.enemies[0].state).toBe('walking')
    expect(game.enemies[0].angry).toBe(true)
    expect(game.score).toBe(0)
  })

  it('steers floating bubbles from the native airflow cell bits', () => {
    const level = arena()
    level.nativeCells = Array.from({ length: 25 }, () => Array<number>(40).fill(2))
    const game = playing(level)
    game.enemies[0].state = 'trapped'
    game.update(1 / 60, { ...idle, blow: true })
    advance(game, 0.55)
    expect(game.bubbles[0]).toMatchObject({ phase: 'floating', vx: 30, vy: 0 })
  })

  it('uses native directional masks to stop a projectile bubble at the side wall', () => {
    const game = playing(BUILTIN_LEVELS[0])
    game.enemies.forEach(enemy => { enemy.state = 'trapped' })
    game.bubbles.push({ x: 64, y: 104, r: 6, vx: -180, vy: 0, age: 0,
      trappedId: null, phase: 'projectile', ticksRemaining: 0, travelRemaining: 0x50 })

    game.update(1 / 60, idle)
    expect(game.bubbles[0]).toMatchObject({ x: 64, phase: 'floating', vx: 0, travelRemaining: 0 })
  })

  it('uses native masks for horizontal enemy shots and the 0xd8 Invader cutoff', () => {
    const game = playing(BUILTIN_LEVELS[0])
    game.enemies.forEach(enemy => { enemy.state = 'trapped' })
    game.player.x = 200; game.player.y = 176
    game.shots.push(
      { x: 64, y: 104, vx: -240, vy: 0, age: 0, kind: 'rock' },
      { x: 160, y: 212, vx: 0, vy: 240, age: 0, kind: 'invader' },
    )

    game.update(1 / 60, idle)
    expect(game.shots).toHaveLength(0)
  })

  it('uses the native 0x1f-tick player bubble-fire gate', () => {
    const game = playing(BUILTIN_LEVELS[0])
    game.enemies.forEach(enemy => { enemy.state = 'trapped' })
    game.update(1 / 60, { ...idle, blow: true })
    expect(game.bubbles).toHaveLength(1)
    for (let tick = 0; tick < 30; tick++) game.update(1 / 60, { ...idle, blow: true })
    expect(game.bubbles).toHaveLength(1)
    game.update(1 / 60, { ...idle, blow: true })
    expect(game.bubbles).toHaveLength(2)
  })

  it('expires the oldest empty bubble when the native 0x12-entry float list fills', () => {
    const game = playing(BUILTIN_LEVELS[0])
    game.enemies.forEach(enemy => { enemy.state = 'trapped' })
    game.player.x = 56; game.player.y = 176
    for (let index = 0; index < 17; index++) {
      game.bubbles.push({ x: 96 + index * 8, y: 40, r: 6, vx: 0, vy: 0, age: 0,
        trappedId: null, phase: 'floating', ticksRemaining: 500, travelRemaining: 0 })
    }
    game.bubbles.push({ x: 160, y: 104, r: 6, vx: 180, vy: 0, age: 0,
      trappedId: null, phase: 'projectile', ticksRemaining: 0, travelRemaining: 1 })

    game.update(1 / 60, idle)
    expect(game.bubbles).toHaveLength(18)
    expect(game.bubbles[0].ticksRemaining).toBe(1)
    game.update(1 / 60, idle)
    expect(game.bubbles).toHaveLength(17)
  })

  it('pops a native captured bubble immediately on active-player overlap', () => {
    const game = playing(BUILTIN_LEVELS[0])
    game.enemies.forEach(enemy => { enemy.state = 'trapped' })
    const enemy = game.enemies[0]
    game.player.x = 160; game.player.y = 176; game.player.grounded = true
    game.bubbles.push({ x: 168, y: 184, r: 6, vx: 0, vy: 0, age: 0,
      trappedId: enemy.id, phase: 'floating', ticksRemaining: 0x23f, travelRemaining: 0 })

    game.update(1 / 60, idle)
    expect(game.bubbles).toHaveLength(0)
    expect(enemy.state).toBe('defeated')
    expect(game.fx.pop).toBe(1)
  })

  it('counts 600 eligible native actor passes, keeping gameplay active until the final pass', () => {
    const game = playing(nativeArena())
    const native = game as unknown as { nativeClearPassesRemaining: number; nativeTrackedEnemies: Set<number> }
    const enemy = game.enemies[0]
    enemy.state = 'entering'
    game.update(1 / 60, idle)
    expect(native.nativeClearPassesRemaining).toBe(600)
    enemy.state = 'trapped'
    game.update(1 / 60, idle)
    expect(native.nativeClearPassesRemaining).toBe(600)
    game.player.x = 160; game.player.y = 176; game.player.grounded = true
    game.bubbles.push({ x: 168, y: 184, r: 6, vx: 0, vy: 0, age: 0,
      trappedId: enemy.id, phase: 'floating', ticksRemaining: 0x23f, travelRemaining: 0 })
    game.update(1 / 60, idle)
    expect(enemy.state).toBe('defeated')
    expect(native.nativeTrackedEnemies.size).toBe(0)
    expect(native.nativeClearPassesRemaining).toBe(599)
    game.player.x = 100; game.player.y = 176; game.player.grounded = true
    game.update(1 / 60, { ...idle, right: true })
    expect(game.player.x).toBeGreaterThan(100)
    for (let pass = 0; pass < 596; pass++) game.update(1 / 60, idle)
    expect(game.state).toBe('playing')
    expect(game.fx.clear).toBe(0)
    expect(native.nativeClearPassesRemaining).toBe(2)
    game.shots.push({ x: 200, y: 100, vx: 0, vy: 0, age: 0, kind: 'invader' })
    game.update(1 / 60, idle)
    expect(game.state).toBe('playing')
    expect(game.shots).toHaveLength(1)
    expect(native.nativeClearPassesRemaining).toBe(1)
    game.update(1 / 60, idle)
    expect(game.state).toBe('won') // Browser terminal adaptation; DOS ED6A remains separate.
    expect(game.fx.clear).toBe(1)
    expect(game.shots).toHaveLength(0)
  })

  it('pauses but does not reset the native clear counter if tracked enemies return', () => {
    const game = playing(nativeArena())
    const native = game as unknown as { nativeClearPassesRemaining: number; nativeTrackedEnemies: Set<number> }
    const enemy = game.enemies[0]
    enemy.state = 'trapped'
    game.player.x = 160; game.player.y = 176; game.player.grounded = true
    game.bubbles.push({ x: 168, y: 184, r: 6, vx: 0, vy: 0, age: 0,
      trappedId: enemy.id, phase: 'floating', ticksRemaining: 0x23f, travelRemaining: 0 })
    game.update(1 / 60, idle)
    for (let pass = 0; pass < 19; pass++) game.update(1 / 60, idle)
    expect(native.nativeClearPassesRemaining).toBe(580)
    // Synthetic re-addition of the same actor to the DS:4D64 analogue. The
    // current engine has no runtime dynamic-spawn path; this exercises the
    // countdown's interruption rule without inventing one.
    enemy.state = 'trapped'
    native.nativeTrackedEnemies.add(enemy.id)
    for (let pass = 0; pass < 30; pass++) game.update(1 / 60, idle)
    expect(native.nativeClearPassesRemaining).toBe(580)
    expect(game.state).toBe('playing')
    enemy.state = 'defeated'
    native.nativeTrackedEnemies.delete(enemy.id)
    game.update(1 / 60, idle)
    expect(native.nativeClearPassesRemaining).toBe(579)
  })

  it('waits for a living native next round after the 600th pass without another delay', () => {
    const first = nativeArena('Native ROUND 01')
    const next = nativeArena('Hydrated ROUND 02')
    const game = new Engine([first, next], () => 0.5)
    game.useLivingLevels()
    game.installLevel(0, first)
    advance(game, 2.5)
    game.player.invulnerable = 100
    const enemy = game.enemies[0]
    enemy.state = 'trapped'
    game.player.x = 160; game.player.y = 176; game.player.grounded = true
    game.bubbles.push({ x: 168, y: 184, r: 6, vx: 0, vy: 0, age: 0,
      trappedId: enemy.id, phase: 'floating', ticksRemaining: 0x23f, travelRemaining: 0 })
    for (let pass = 0; pass < 600; pass++) game.update(1 / 60, idle)
    expect(game.state).toBe('clear')
    expect(game.levelIndex).toBe(0)
    expect(game.fx.clear).toBe(1)
    for (let pass = 0; pass < 180; pass++) game.update(1 / 60, idle)
    expect(game.state).toBe('clear')
    expect(game.fx.clear).toBe(1)
    game.installLevel(1, next)
    game.update(1 / 60, idle)
    expect(game.state).toBe('ready')
    expect(game.levelIndex).toBe(1)
    expect(game.level.name).toBe('Hydrated ROUND 02')
    expect((game as unknown as { nativeClearPassesRemaining: number }).nativeClearPassesRemaining).toBe(600)
    game.restart()
    expect(game.levelIndex).toBe(0)
    expect((game as unknown as { nativeClearPassesRemaining: number }).nativeClearPassesRemaining).toBe(600)
  })

  it('loads native record 100 after record 99, then uses the labelled browser terminal adaptation', () => {
    const levels = Array.from({ length: 100 }, (_, index) => nativeArena(`ROUND ${index + 1}`))
    const game = new Engine(levels, () => 0.5)
    game.levelIndex = 98
    game['loadLevel']()
    for (const round of [98, 99]) {
      advance(game, 2.5)
      game.player.invulnerable = 100
      const enemy = game.enemies[0]
      enemy.state = 'trapped'
      game.player.x = 160; game.player.y = 176; game.player.grounded = true
      game.bubbles.push({ x: 168, y: 184, r: 6, vx: 0, vy: 0, age: 0,
        trappedId: enemy.id, phase: 'floating', ticksRemaining: 0x23f, travelRemaining: 0 })
      for (let pass = 0; pass < 600; pass++) game.update(1 / 60, idle)
      if (round === 98) {
        expect(game.levelIndex).toBe(99)
        expect(game.state).toBe('ready')
      }
    }
    expect(game.levelIndex).toBe(99)
    expect(game.state).toBe('won')
    expect(game.fx.clear).toBe(2)
  })

  it('uses BBB4/BBE5 two-deadline flight before native item conversion', () => {
    const game = playing(BUILTIN_LEVELS[0])
    game.enemies.forEach(enemy => { enemy.state = 'trapped' })
    const enemy = game.enemies[0]
    game.player.x = 160; game.player.y = 176; game.player.grounded = true
    game.bubbles.push({ x: 168, y: 184, r: 6, vx: 0, vy: 0, age: 0,
      trappedId: enemy.id, phase: 'floating', ticksRemaining: 0x23f, travelRemaining: 0 })
    game.update(1 / 60, idle)
    game.player.dead = true // Keep the resulting item uncollected for inspection.
    expect(enemy).toMatchObject({ vx: enemy.facing * 120, vy: -120 })

    for (let tick = 0; tick < 59; tick++) game.update(1 / 60, idle)
    expect(game.fruit).toHaveLength(0)
    expect(enemy.state).toBe('defeated')
    game.update(1 / 60, idle)
    expect(game.fruit).toHaveLength(0)
    expect(enemy.vy).toBe(120)
    for (let tick = 0; tick < 64; tick++) game.update(1 / 60, idle)
    expect(game.fruit).toHaveLength(0)
    game.update(1 / 60, idle)
    expect(game.fruit).toHaveLength(1)
    expect(game.enemies).not.toContain(enemy)
  })

  it('reflects native defeated flight at the left wall before its deadline transition', () => {
    const game = playing(BUILTIN_LEVELS[0])
    game.enemies.forEach(enemy => { enemy.state = 'trapped' })
    const enemy = game.enemies[0]
    Object.assign(enemy, { x: 0x38, y: 176, facing: -1 })
    game.player.x = 0x38; game.player.y = 176; game.player.grounded = true
    game.bubbles.push({ x: 0x40, y: 184, r: 6, vx: 0, vy: 0, age: 0,
      trappedId: enemy.id, phase: 'floating', ticksRemaining: 0x23f, travelRemaining: 0 })
    game.update(1 / 60, idle)
    game.player.dead = true
    game.update(1 / 60, idle)
    expect(enemy).toMatchObject({ x: 0x38, vx: 120, state: 'defeated' })
  })

  it('uses unsigned native defeated-flight deadlines across timer wrap', () => {
    const game = playing(BUILTIN_LEVELS[0])
    game.enemies.forEach(enemy => { enemy.state = 'trapped' })
    const enemy = game.enemies[0]
    game.player.x = 160; game.player.y = 176; game.player.grounded = true
    ;(game as unknown as { nativeTick: number }).nativeTick = 0xfff0
    game.bubbles.push({ x: 168, y: 184, r: 6, vx: 0, vy: 0, age: 0,
      trappedId: enemy.id, phase: 'floating', ticksRemaining: 0x23f, travelRemaining: 0 })
    game.update(1 / 60, idle) // BBB4 deadline is u16(FFF1 + 3C) = 002D.
    game.player.dead = true
    game.update(1 / 60, idle)
    expect(enemy).toMatchObject({ state: 'defeated', vy: 120 })
    game.update(1 / 60, idle)
    expect(game.enemies).not.toContain(enemy)
    expect(game.fruit).toHaveLength(1)
  })

  it('keeps native item, pickup and score phases separate from the legacy ten-second fruit path', () => {
    const game = playing(BUILTIN_LEVELS[0])
    game.enemies.forEach(enemy => { enemy.state = 'trapped' })
    const enemy = game.enemies[0]
    game.player.x = 160; game.player.y = 176; game.player.grounded = true
    game.bubbles.push({ x: 168, y: 184, r: 6, vx: 0, vy: 0, age: 0,
      trappedId: enemy.id, phase: 'floating', ticksRemaining: 0x23f, travelRemaining: 0 })
    game.update(1 / 60, idle)
    game.player.dead = true
    for (let tick = 0; tick < 125; tick++) game.update(1 / 60, idle)
    expect(game.fruit).toHaveLength(1)
    const item = game.fruit[0]
    expect(item).toMatchObject({ kind: 0x12, points: 500, phase: 'item' })
    const internals = game as unknown as {
      nativeFruitStates: WeakMap<typeof item, { x: number; y: number; phase: string; deadline: number; fresh: boolean }>
      nativeTick: number
      workTick: number
    }
    const native = internals.nativeFruitStates.get(item)!
    native.phase = 'timed'
    native.fresh = false
    native.x = 0x80
    native.y = 0xc0
    item.x = native.x + 8; item.y = native.y - 8
    item.age = 100 // Native lifetime is not the custom ten-second age.
    game.player.dead = false
    game.player.x = native.x; game.player.y = native.y - 16
    game.player.vx = 0; game.player.vy = 0; game.player.grounded = true
    internals.nativeTick = 100
    internals.workTick = 40_000
    native.deadline = 40_000
    game.update(1 / 60, idle) // BD0F picks up before equal-time expiry.
    expect(native.phase).toBe('pickup')
    expect(game.score).toBe(0)
    game.update(1 / 60, idle) // BD72 credits once and enters BE21 score display.
    expect(game.score).toBe(500)
    expect(game.fx.fruit).toBe(1)
    expect(item.phase).toBe('score')
    expect(game.fruit).toContain(item)
    for (let tick = 0; tick < 90; tick++) game.update(1 / 60, idle)
    expect(game.score).toBe(500)
    expect(game.fruit).toContain(item)
    game.update(1 / 60, idle) // BEC2 removes only after the general deadline.
    expect(game.fruit).not.toContain(item)
  })

  it('enters the native moving-bubble support state and installs jump on the release tick', () => {
    const game = playing(BUILTIN_LEVELS[0])
    game.enemies.forEach(enemy => { enemy.state = 'trapped' })
    game.player.x = 156; game.player.y = 128
    game.player.vx = 0; game.player.vy = 0; game.player.grounded = false
    game.bubbles.push({ x: 164, y: 136, r: 6, vx: 0, vy: 0, age: 0,
      trappedId: null, phase: 'floating', ticksRemaining: 0x1fe, travelRemaining: 0 })

    game.update(1 / 60, idle)
    const bubble = game.bubbles[0]
    expect(game.player).toMatchObject({ x: bubble.x - 4, y: bubble.y - 8, vx: 0, vy: 0, grounded: false })

    const attachedY = game.player.y
    game.update(1 / 60, { ...idle, jump: true })
    expect(game.player.y).toBe(attachedY)
    expect(game.player.vy).toBe(-168.75)
    expect(game.fx.jump).toBe(1)
    game.update(1 / 60, idle)
    expect(game.player.y).toBeLessThan(attachedY)
  })

  it('bubble-jumps without applying the inherited impact-strength pop threshold', () => {
    const game = playing(BUILTIN_LEVELS[0])
    game.enemies.forEach(enemy => { enemy.state = 'trapped' })
    game.player.x = 160; game.player.y = 120
    game.player.vx = 0; game.player.vy = 60; game.player.grounded = false
    game.bubbles.push({ x: 168, y: 140, r: 6, vx: 0, vy: 0, age: 100,
      trappedId: null, phase: 'floating', ticksRemaining: 0x1fe, travelRemaining: 0 })

    game.update(1 / 60, { ...idle, jump: true })
    expect(game.bubbles).toHaveLength(1)
    expect(game.player.vy).toBe(-97.5)
    expect(game.fx.jump).toBe(1)
  })

  it('assigns native 500/1000 point drops to kills popped within ten ticks', () => {
    const level = arena()
    level.enemies = [
      { x: 112, y: 176, kind: 'zenchan' },
      { x: 128, y: 176, kind: 'zenchan' },
    ]
    const game = playing(level)
    game.player.x = 100; game.player.y = 160; game.player.invulnerable = 100
    game.enemies.forEach((enemy, index) => {
      enemy.state = 'trapped'
      game.bubbles.push({ x: 108 + index * 2, y: 168, r: 6, vx: 0, vy: 0,
        age: 15, trappedId: enemy.id, phase: 'floating', ticksRemaining: 0x23f, travelRemaining: 0 })
    })
    game.update(1 / 60, idle)
    expect(game.enemies.map(enemy => enemy.state)).toEqual(['defeated', 'defeated'])
    expect(game.score).toBe(0)
    advance(game, 2.2)
    expect(game.fruit.map(item => item.points)).toEqual([500, 1_000])
  })

  it('jump-pops a captured enemy, converts the defeated sprite into fruit, and permits collection before winning', () => {
    const game = playing()
    capture(game)
    jumpPop(game)
    expect(game.fx.pop).toBe(1)
    expect(game.enemies[0].state).toBe('defeated')
    expect(game.state).toBe('clear')
    expect(game.score).toBe(0)
    advance(game, 2.2)
    expect(game.fruit).toHaveLength(1)
    const item = game.fruit[0]
    game.player.x = item.x - 8; game.player.y = item.y - 8
    advance(game, 0.025)
    expect(game.fruit).toHaveLength(0)
    expect(game.score).toBe(500)
    expect(game.fx.fruit).toBe(1)
    advance(game, 1.5)
    expect(game.state).toBe('won')
  })

  it('advances through levels after clearing and restarts the entire session', () => {
    const level = arena()
    const game = new Engine([level, level], () => 0.5)
    advance(game, 1.05)
    capture(game)
    jumpPop(game)
    advance(game, 3.1)
    expect(game.levelIndex).toBe(1)
    expect(game.state).toBe('ready')
    expect(game.score).toBe(0)
    const popCount = game.fx.pop
    game.restart()
    expect(game.levelIndex).toBe(0)
    expect(game.state).toBe('ready')
    expect(game.score).toBe(0)
    expect(game.lives).toBe(3)
    expect(game.bubbles).toHaveLength(0)
    expect(game.fx.pop).toBe(popCount)
  })

  it('never advances from a living round until the next hive level is installed', () => {
    const level = arena()
    const next = { ...arena(), name: 'Authored ROUND 02', spawn: { x: 104, y: 176 } }
    const game = new Engine([level, level], () => 0.5)
    game.useLivingLevels()
    expect(() => game.restart()).toThrow('has not loaded from the hive')
    game.installLevel(0, level)
    advance(game, 1.05)
    game.player.invulnerable = 100
    capture(game)
    jumpPop(game)
    advance(game, 3.1)
    expect(game.state).toBe('clear')
    expect(game.levelIndex).toBe(0)
    game.installLevel(1, next)
    game.update(1 / 60, idle)
    expect(game.levelIndex).toBe(1)
    expect(game.state).toBe('ready')
    expect(game.level.name).toBe('Authored ROUND 02')
    expect(game.player.x).toBe(104)
  })

  it('takes one hit, respawns with grace, and reaches game over after the final life', () => {
    const game = playing()
    const hit = (): void => {
      game.player.invulnerable = 0
      const enemy = game.enemies[0]
      enemy.x = game.player.x; enemy.y = game.player.y
      advance(game, 0.025)
    }
    hit()
    expect(game.player.dead).toBe(true)
    expect(game.lives).toBe(2)
    advance(game, 3.05)
    expect(game.player.dead).toBe(false)
    expect(game.player.invulnerable).toBeGreaterThan(2.8)
    game.enemies[0].x = game.player.x
    game.enemies[0].y = game.player.y
    advance(game, 0.05)
    expect(game.lives).toBe(2)
    hit(); advance(game, 3.05)
    hit(); advance(game, 3.05)
    expect(game.lives).toBe(0)
    expect(game.fx.hurt).toBe(3)
    expect(game.state).toBe('gameover')
  })

  it('Maita throws a bounded boulder that expires after three seconds', () => {
    const level = arena(true)
    level.enemies = [{ x: 232, y: 176, kind: 'mighta' }]
    const game = new Engine([level], () => 0)
    advance(game, 1.05)
    game.player.invulnerable = 100
    game.player.x = 168; game.player.y = 176; game.player.grounded = true
    game.enemies[0].facing = -1
    let sawShot = false
    for (let i = 0; i < 660; i++) {
      game.update(1 / 120, idle)
      sawShot ||= game.shots.length > 0
    }
    expect(sawShot).toBe(true)
    game.enemies[0].state = 'trapped'
    advance(game, 3.1)
    expect(game.shots).toHaveLength(0)
  })

  it.each([
    ['mighta', 120, 2],
    ['hidegons', 135, 2.25],
    ['drunk', 150, 2.5],
  ] as const)('uses the native %s projectile table speed in both directions', (kind, speed, firstStep) => {
    for (const facing of [-1, 1] as const) {
      const level: LevelDef = {
        ...arena(),
        nativeCells: Array.from({ length: 25 }, () => Array<number>(40).fill(0)),
        enemies: [{ x: 160, y: 100, kind, activationDelayTicks: 1_000 }],
      }
      const game = new Engine([level], () => 0)
      advance(game, 2.5)
      game.player.invulnerable = 100
      game.player.x = 160 + facing * 40
      game.player.y = 100
      const enemy = game.enemies[0]
      Object.assign(enemy, { state: 'walking', x: 160, y: 100, vx: 0, vy: 0, grounded: false, facing })

      game.update(1 / 60, idle)
      expect(game.shots).toHaveLength(1)
      expect(game.shots[0]).toMatchObject({ vx: facing * speed, kind: kind === 'mighta' ? 'rock' : kind === 'hidegons' ? 'fire' : 'bottle' })
      // D3DD/D5C8/D7A9 retain the staged velocity into their first clear 1C87 pass.
      expect(game.shots[0].x).toBe(168 + facing * firstStep)
    }
  })

  it.each([
    ['mighta', 240],
    ['hidegons', 270],
    ['drunk', 300],
  ] as const)('keeps legacy custom %s projectile speed unchanged', (kind, speed) => {
    const level: LevelDef = { ...arena(), enemies: [{ x: 160, y: 100, kind }] }
    const game = new Engine([level], () => 0)
    advance(game, 1.05)
    game.player.invulnerable = 100
    game.player.x = 200
    game.player.y = 100
    Object.assign(game.enemies[0], { state: 'walking', x: 160, y: 100, vx: 0, vy: 0, grounded: false, facing: 1 })

    game.update(1 / 60, idle)
    expect(game.shots).toHaveLength(1)
    expect(game.shots[0].vx).toBe(speed)
  })

  it('climbs toward a player on a platform above', () => {
    const level = arena(true)
    ;(level.tiles as string[])[19] = '##' + '='.repeat(28) + '##'
    const game = playing(level)
    game.player.x = 176; game.player.y = 136; game.player.grounded = true
    const enemy = game.enemies[0]
    enemy.x = 136; enemy.y = 176; enemy.grounded = true; enemy.facing = 1
    let climbed = false
    for (let i = 0; i < 480; i++) {
      game.update(1 / 120, idle)
      climbed ||= enemy.grounded && enemy.y === 136
    }
    expect(climbed).toBe(true)
  })

  it('wraps through an open floor and bounds bubbles during sustained fire', () => {
    const level = arena()
    ;(level.tiles as string[])[24] = '##' + '.'.repeat(28) + '##'
    const game = playing(level)
    advance(game, 0.8)
    expect(game.player.y).toBeLessThan(100)
    game.enemies[0].state = 'trapped'
    advance(game, 15, { blow: true })
    expect(game.bubbles.length).toBeLessThanOrEqual(24)
    expect(game.bubbles.every(b => b.age < 9 && b.ticksRemaining > 0
      && Number.isFinite(b.x) && Number.isFinite(b.y))).toBe(true)
    expect(game.lives).toBe(3)
  })

  it('replays the native scheduler identically at 60 Hz and split 120 Hz render cadence', () => {
    const direct = new Engine([BUILTIN_LEVELS[40]])
    const split = new Engine([BUILTIN_LEVELS[40]])
    direct.player.invulnerable = 1_000
    split.player.invulnerable = 1_000
    for (let tick = 0; tick < 1_200; tick++) {
      const input: Input = {
        left: tick % 240 >= 120,
        right: tick % 240 < 120,
        jump: tick % 97 === 0,
        blow: tick % 31 === 0,
      }
      direct.update(1 / 60, input)
      split.update(1 / 120, input)
      split.update(1 / 120, input)
    }
    const snapshot = (game: Engine): unknown => ({
      state: game.state, time: game.time, score: game.score, lives: game.lives,
      player: game.player, enemies: game.enemies, bubbles: game.bubbles,
      fruit: game.fruit, shots: game.shots, fx: game.fx,
    })
    expect(snapshot(split)).toEqual(snapshot(direct))
  })

  it('keeps every reconstructed round finite through entrance and active simulation', () => {
    for (const level of BUILTIN_LEVELS) {
      const game = new Engine([level])
      game.player.invulnerable = 1_000
      for (let tick = 0; tick < 600; tick++) game.update(1 / 60, idle)
      const values = [game.time, game.player.x, game.player.y, game.player.vx, game.player.vy,
        ...game.enemies.flatMap(enemy => [enemy.x, enemy.y, enemy.vx, enemy.vy]),
        ...game.bubbles.flatMap(bubble => [bubble.x, bubble.y, bubble.vx, bubble.vy]),
        ...game.shots.flatMap(shot => [shot.x, shot.y, shot.vx, shot.vy])]
      expect(values.every(Number.isFinite), level.name).toBe(true)
      expect(game.enemies.length, level.name).toBe(level.enemies.length)
    }
  })
})
