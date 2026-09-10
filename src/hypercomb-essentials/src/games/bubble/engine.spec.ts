import { describe, expect, it } from 'vitest'
import { Engine, HEIGHT, TILE, WIDTH, type Input, type LevelDef } from './engine.js'
import { BUILTIN_LEVELS } from './levels.js'

const idle: Input = { left: false, right: false, jump: false, blow: false }
function advance(game: Engine, seconds: number, input: Partial<Input> = {}): void {
  for (let elapsed = 0; elapsed < seconds - 0.00001; elapsed += 1 / 120) game.update(1 / 120, { ...idle, ...input })
}
function arena(platform = false): LevelDef {
  const tiles = Array.from({ length: 28 }, (_, row) => row < 2 || row === 27 ? '.'.repeat(32)
    : row === 26 ? '#'.repeat(32) : '##' + '.'.repeat(28) + '##')
  if (platform) tiles[21] = '##' + '.'.repeat(8) + '='.repeat(10) + '.'.repeat(10) + '##'
  return { name: 'Test cave', tiles, spawn: { x: 96, y: 192 }, enemies: [{ x: 208, y: 192, kind: 'zenchan' }] }
}
function playing(level: LevelDef = arena()): Engine {
  const game = new Engine([level], () => 0.5)
  advance(game, 1.05)
  game.player.invulnerable = 100
  return game
}
function capture(game: Engine): void {
  game.player.x = 32
  game.enemies[0].x = 72
  game.enemies[0].y = 192
  game.enemies[0].facing = -1
  advance(game, 0.2, { blow: true })
  expect(game.enemies[0].state).toBe('trapped')
  expect(game.fx.trap).toBe(1)
}
function jumpPop(game: Engine): void {
  const b = game.bubbles.find(bubble => bubble.trappedId !== null)!
  b.age = 1.2
  b.vx = 0; b.vy = 0; b.x = 128; b.y = 180
  game.player.x = 120
  game.player.y = 192
  game.player.grounded = true
  advance(game, 0.08, { jump: true })
}

describe('Julian Rijken BubbleBobble browser port', () => {
  it('preserves the three 32×28 maps and opens with the arcade trio of Zen-Chan', () => {
    expect([WIDTH, HEIGHT, TILE]).toEqual([256, 224, 8])
    expect(BUILTIN_LEVELS.map(level => level.enemies.length)).toEqual([3, 4, 4])
    for (const [index, level] of BUILTIN_LEVELS.entries()) {
      expect(level.tiles).toHaveLength(28)
      expect(level.tiles.every(row => row.length === 32)).toBe(true)
      expect(level.tiles[2]).toBe('##' + '+'.repeat(28) + '##')
      expect(level.tiles[index === 0 ? 27 : 26]).toBe('#'.repeat(32))
      expect(level.tiles[Math.floor(level.spawn.y / TILE)][Math.floor(level.spawn.x / TILE)]).toBe('.')
    }
    expect(BUILTIN_LEVELS[0].tiles[12]).toBe('##==...==================...==##')
    expect(BUILTIN_LEVELS[0].enemies.map(enemy => enemy.kind)).toEqual(['zenchan', 'zenchan', 'zenchan'])
    expect(BUILTIN_LEVELS[0].enemies.every(enemy => enemy.y + 16 === 12 * TILE)).toBe(true)
    expect(BUILTIN_LEVELS[1].tiles[6]).toBe('##...........======...........##')
    expect(BUILTIN_LEVELS[2].tiles[16]).toBe('##...==========..==========...##')
  })

  it('starts ready, settles onto the floor and cannot tunnel through solid side walls', () => {
    const game = new Engine([arena()], () => 0.5)
    advance(game, 0.5, { left: true })
    expect(game.state).toBe('ready')
    expect(game.player.x).toBe(96)
    advance(game, 0.55)
    game.player.invulnerable = 100
    advance(game, 3, { left: true })
    expect(game.state).toBe('playing')
    expect(game.player.x).toBe(16)
    expect(game.player.y).toBe(192)
    expect(game.player.grounded).toBe(true)
    expect(game.lives).toBe(3)
  })

  it('jumps upward through one-way ledges and lands on their top without auto-jumping', () => {
    const game = playing(arena(true))
    advance(game, 0.55, { jump: true })
    expect(game.player.y).toBeLessThan(152)
    advance(game, 0.9, { jump: true })
    expect(game.player.y).toBe(152)
    expect(game.player.grounded).toBe(true)
    expect(game.fx.jump).toBe(1)
    advance(game, 0.1)
    advance(game, 0.05, { jump: true })
    expect(game.fx.jump).toBe(2)
  })

  it('climbs all three arcade round-one ledges with ordinary jumps', () => {
    const game = playing(BUILTIN_LEVELS[0])
    // Move to the central platforms and climb from the actual arcade floor.
    advance(game, 1.25, { right: true })
    expect(game.player.y).toBe(200)
    expect(game.player.grounded).toBe(true)
    for (const standingY of [160, 120, 80]) {
      advance(game, 0.9, { jump: true })
      expect(game.player.y).toBe(standingY)
      expect(game.player.grounded).toBe(true)
      advance(game, 0.025)
    }
    expect(game.fx.jump).toBe(3)
  })

  it.each([0, 1, 2])('uses round %i solid floor for bubble launch and downward collision', index => {
    const game = playing(BUILTIN_LEVELS[index])
    const floor = index === 0 ? 216 : 208
    advance(game, 0.3)
    advance(game, 0.025, { blow: true })
    expect(game.bubbles[0].y).toBeCloseTo(floor - 8, 3)
    const falling = { x: 128, y: floor - 5, r: 6, vx: 0, vy: 24, age: 0.2, trappedId: null }
    game.bubbles.push(falling)
    advance(game, 1 / 120)
    expect(falling.y).toBe(floor - falling.r)
    expect(falling.vy).toBeLessThan(0)
  })

  it('keeps takeoff momentum until reverse input gives air control', () => {
    const game = playing()
    advance(game, 0.1, { right: true })
    advance(game, 0.1, { right: true, jump: true })
    expect(game.player.vx).toBe(64)
    advance(game, 0.05, { left: true })
    expect(game.player.vx).toBe(-32)
    expect(game.player.facing).toBe(-1)
  })

  it('launches bubbles, captures an enemy, then releases it angry after eight seconds', () => {
    const game = playing()
    capture(game)
    const bubble = game.bubbles.find(b => b.trappedId !== null)!
    expect(bubble.vx).toBeGreaterThan(0)
    game.player.x = 16
    advance(game, 2)
    expect(bubble.y).toBeLessThan(200)
    expect(bubble.vy).toBeLessThan(0)
    advance(game, 6)
    expect(game.bubbles).toHaveLength(0)
    expect(game.enemies[0].state).toBe('walking')
    expect(game.enemies[0].angry).toBe(true)
    expect(game.score).toBe(0)
  })

  it('jump-pops a captured enemy, converts the defeated sprite into fruit, and permits collection before winning', () => {
    const game = playing()
    capture(game)
    jumpPop(game)
    expect(game.fx.pop).toBe(1)
    expect(game.enemies[0].state).toBe('defeated')
    expect(game.state).toBe('clear')
    expect(game.score).toBe(100)
    advance(game, 1.6)
    expect(game.fruit).toHaveLength(1)
    const item = game.fruit[0]
    game.player.x = item.x - 8; game.player.y = item.y - 8
    advance(game, 0.025)
    expect(game.fruit).toHaveLength(0)
    expect(game.score).toBe(200)
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
    expect(game.score).toBeGreaterThan(0)
    const popCount = game.fx.pop
    game.restart()
    expect(game.levelIndex).toBe(0)
    expect(game.state).toBe('ready')
    expect(game.score).toBe(0)
    expect(game.lives).toBe(3)
    expect(game.bubbles).toHaveLength(0)
    expect(game.fx.pop).toBe(popCount)
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
    advance(game, 1)
    expect(game.player.dead).toBe(false)
    expect(game.player.invulnerable).toBeGreaterThan(2.8)
    game.enemies[0].x = game.player.x
    game.enemies[0].y = game.player.y
    advance(game, 0.05)
    expect(game.lives).toBe(2)
    hit(); advance(game, 1)
    hit(); advance(game, 1)
    expect(game.lives).toBe(0)
    expect(game.fx.hurt).toBe(3)
    expect(game.state).toBe('gameover')
  })

  it('Maita throws a bounded boulder that expires after three seconds', () => {
    const level = arena(true)
    level.enemies = [{ x: 192, y: 192, kind: 'mighta' }]
    const game = playing(level)
    game.player.x = 128; game.player.y = 152; game.player.grounded = true
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

  it('climbs toward a player on a platform above', () => {
    const level = arena(true)
    ;(level.tiles as string[])[21] = '##' + '='.repeat(28) + '##'
    const game = playing(level)
    game.player.x = 136; game.player.y = 152; game.player.grounded = true
    const enemy = game.enemies[0]
    enemy.x = 96; enemy.y = 192; enemy.grounded = true; enemy.facing = 1
    let climbed = false
    for (let i = 0; i < 480; i++) {
      game.update(1 / 120, idle)
      climbed ||= enemy.grounded && enemy.y === 152
    }
    expect(climbed).toBe(true)
  })

  it('wraps through an open floor and bounds bubbles during sustained fire', () => {
    const level = arena()
    ;(level.tiles as string[])[26] = '##' + '.'.repeat(28) + '##'
    const game = playing(level)
    advance(game, 0.8)
    expect(game.player.y).toBeLessThan(100)
    game.enemies[0].state = 'trapped'
    advance(game, 15, { blow: true })
    expect(game.bubbles.length).toBeLessThanOrEqual(24)
    expect(game.bubbles.every(b => b.age < 8 && Number.isFinite(b.x) && Number.isFinite(b.y))).toBe(true)
    expect(game.lives).toBe(3)
  })
})
