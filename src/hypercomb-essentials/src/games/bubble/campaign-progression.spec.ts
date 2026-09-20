import { describe, expect, it } from 'vitest'
import { Engine, type Input, type LevelDef } from './engine.js'
import { BUILTIN_LEVELS } from './levels.js'

const idle: Input = { left: false, right: false, jump: false, blow: false }

/**
 * This is a deterministic structural progression harness, not a solvability
 * test or a golden DOS playthrough. It hydrates the decoded round geometry one
 * at a time and uses synthetic captured-bubble fixtures to drive Engine's
 * public update/pop path through each native clear boundary.
 */
function hydratedRound(index: number): LevelDef {
  const source = BUILTIN_LEVELS[index]
  return {
    ...source,
    tiles: [...source.tiles],
    nativeCells: source.nativeCells?.map(row => [...row]),
    enemies: source.enemies.map(enemy => ({ ...enemy })),
    spawn: { ...source.spawn },
  }
}

describe('decoded campaign structural progression', () => {
  it('hydrates every round once, waits for each missing successor, and reaches ROUND 100', () => {
    const rounds = BUILTIN_LEVELS.map((_, index) => hydratedRound(index))
    // This deliberately differs from its bundled source object. It represents
    // authored hydrated content, and progression must retain it rather than
    // re-seeding the bundled round when the predecessor clears.
    const authoredIndex = 50
    rounds[authoredIndex] = {
      ...rounds[authoredIndex],
      name: 'Authored hydrated ROUND 51',
      spawn: { x: 88, y: 160 },
    }

    const game = new Engine(BUILTIN_LEVELS, () => 0.5)
    game.useLivingLevels()
    game.installLevel(0, rounds[0])
    const entered: number[] = []

    for (let index = 0; index < 100; index++) {
      expect(game.levelIndex).toBe(index)
      expect(game.level).toBe(rounds[index])
      entered.push(index)
      if (index === authoredIndex) {
        expect(game.level).toMatchObject({ name: 'Authored hydrated ROUND 51', spawn: { x: 88, y: 160 } })
      }

      // Native ready/entrance transitions are exercised through update(), not
      // by setting state. The bound leaves room for the documented entrance.
      for (let tick = 0; tick < 180 && game.state !== 'playing'; tick++) game.update(1 / 60, idle)
      expect(game.state).toBe('playing')
      if (index === 99) break // Reaching record 100 is the structural gate; its ending is not asserted here.

      game.player.invulnerable = 1_000
      game.player.x = 160
      game.player.y = 176
      game.player.grounded = true
      const popsBefore = game.fx.pop
      // Public bubble data is a synthetic fixture. moveBubbles() performs the
      // actual captured-enemy pop, which updates the native tracked set; this
      // test never mutates the private clear counter or tracked-enemy state.
      for (const enemy of game.enemies) {
        game.bubbles.push({ x: 168, y: 184, r: 6, vx: 0, vy: 0, age: 0,
          trappedId: enemy.id, phase: 'floating', ticksRemaining: 0x23f, travelRemaining: 0 })
      }
      game.update(1 / 60, idle)
      expect(game.fx.pop - popsBefore).toBe(rounds[index].enemies.length)

      // The pop pass already consumes the first eligible native control pass.
      for (let pass = 0; pass < 599; pass++) game.update(1 / 60, idle)
      expect(game.state).toBe('clear')
      expect(game.levelIndex).toBe(index)
      expect(game.fx.clear).toBe(index + 1)

      // No successor is hydrated yet: repeated updates neither skip nor reload.
      game.update(1 / 60, idle)
      expect(game).toMatchObject({ state: 'clear', levelIndex: index })

      game.installLevel(index + 1, rounds[index + 1])
      game.update(1 / 60, idle)
      expect(game).toMatchObject({ state: 'ready', levelIndex: index + 1 })
      expect(game.level).toBe(rounds[index + 1])
      // The resumed successor is installed exactly once; a following ready
      // update advances its entrance but cannot reload or skip it.
      game.update(1 / 60, idle)
      expect(game.levelIndex).toBe(index + 1)
      expect(game.level).toBe(rounds[index + 1])
    }

    expect(entered).toEqual(Array.from({ length: 100 }, (_, index) => index))
    expect(game.level).toBe(rounds[99])
    expect(game.level.name).toBe('ROUND 100')
  }, 30_000)
})
