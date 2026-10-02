// games/arkanoid/engine.spec.ts
//
// The Arkanoid engine under fixed time steps: clearing a board wins it (after
// the finale), losing the white ball costs a life, zero lives is game over, the
// built-in walls all load, and the twenty power-up pills each apply cleanly.
//
// The engine plays ONE wall at a time. Moving from wall to wall (a random next
// index, carrying lives and score) is the overlay's job and is DOM-bound, so it
// is not driven here — what the engine owes the overlay is the `won` /
// `gameover` state and a board that loads from any LEVELS entry.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BRICK_H, BRICK_TOP, BRICK_W, COLS, DIFFICULTY, Engine, H, POWER_META, POWER_ORDER, W,
  type Ball, type PowerKind,
} from './engine.js'
import { LEVELS } from './levels.js'

const DT = 1 / 120

/** A deterministic Math.random so the swarm / dispenser / multiplier tiles are repeatable. */
function seedRandom(seed = 12345): void {
  let s = seed >>> 0
  vi.spyOn(Math, 'random').mockImplementation(() => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  })
}

function advance(g: Engine, seconds: number): void {
  for (let t = 0; t < seconds - 1e-9; t += DT) g.update(DT)
}

/** Three solid rows of 1-hp bricks across all eleven columns. */
const board = (): Engine => new Engine(['11111111111', '11111111111', '11111111111'])

/** Drop the white ball past the floor → the engine takes a life. */
function loseWhiteBall(g: Engine): void {
  for (const b of g.balls) if (b.primary) { b.stuck = false; b.y = H + 100 }
  g.update(DT)
}

function colourBall(g: Engine): void {
  const b: Ball = { x: W / 2, y: H * 0.5, vx: 0, vy: -120, r: 7, stuck: false, wobble: 0, primary: false, color: '#ff5b5b' }
  g.balls.push(b)
}

/** Catch a pill on the bat through the REAL capsule path (what calls #applyPower). */
function grant(g: Engine, kind: PowerKind, times = 1): void {
  for (let i = 0; i < times; i++) {
    g.capsules.push({ x: g.paddle.x, y: g.paddle.y - 5, kind })
    g.update(1 / 240)
  }
}

beforeEach(() => seedRandom())
afterEach(() => vi.restoreAllMocks())

describe('Arkanoid engine: building a board', () => {
  it('reads brick hit-points, barriers and gaps from the row characters', () => {
    const g = new Engine(['1.2*#', '  3 4'])
    const at = (col: number, row: number) => g.bricks.find(b => b.col === col && b.row === row)
    expect(at(0, 0)).toMatchObject({ hp: 1, max: 1 })
    expect(at(0, 0)!.unbreakable).toBeUndefined()
    expect(at(1, 0)).toBeUndefined()                       // '.' is empty
    expect(at(2, 0)).toMatchObject({ hp: 2 })
    expect(at(3, 0)).toMatchObject({ hp: 4 })              // '*' is a tough 4-hp brick
    expect(at(4, 0)).toMatchObject({ unbreakable: true })  // '#' is an ice barrier
    expect(at(0, 1)).toBeUndefined()                       // ' ' is empty
    expect(at(2, 1)).toMatchObject({ hp: 3 })
    expect(at(4, 1)).toMatchObject({ hp: 4 })
    expect(g.bricks).toHaveLength(6)
  })

  it('lays the grid flush to the walls at the documented pitch', () => {
    const g = board()
    expect(COLS).toBe(11)
    expect(BRICK_W * COLS).toBeCloseTo(W, 6)
    const first = g.bricks.find(b => b.col === 0 && b.row === 0)!
    const last = g.bricks.find(b => b.col === 10 && b.row === 2)!
    expect(first.x).toBe(0)
    expect(first.y).toBe(BRICK_TOP)
    expect(last.x + last.w).toBeCloseTo(W, 6)
    expect(last.y).toBe(BRICK_TOP + 2 * BRICK_H)
  })

  it('never counts barriers toward the clear', () => {
    const g = new Engine(['#1#'])
    expect(g.bricks).toHaveLength(3)
    expect(g.bricksLeft).toBe(1)
  })

  it('starts playing with the Rookie lives and one stuck white ball', () => {
    const g = board()
    expect(g.state).toBe('playing')
    expect(g.lives).toBe(DIFFICULTY[0].lives)
    expect(g.balls).toHaveLength(1)
    expect(g.balls[0]).toMatchObject({ primary: true, stuck: true, color: '#ffffff' })
  })

  it('tags three distinct multiplier tiles (x1, x2, x3) on a board with room for them', () => {
    const g = board()
    const mults = g.bricks.filter(b => b.mult && !b.hidden).map(b => b.mult).sort()
    expect(mults).toEqual([1, 2, 3])
  })
})

describe('Arkanoid engine: clearing a level', () => {
  it('a ball that breaks the last brick lights the finale, then the level is won', () => {
    const g = new Engine(['1'])
    const ball = g.balls[0]
    ball.stuck = false; ball.x = BRICK_W / 2; ball.y = BRICK_TOP + BRICK_H + 24; ball.vx = 0; ball.vy = -300
    advance(g, 0.5)
    expect(g.bricksLeft).toBe(0)
    expect(g.finale).toBe(true)
    expect(g.state).toBe('playing')                        // the win waits for the fireworks
    expect(g.score).toBeGreaterThanOrEqual(10000)          // the level-clear jackpot
    advance(g, 1.5)
    expect(g.finale).toBe(false)
    expect(g.state).toBe('won')
  })

  it('wipes a full built-in wall: every brick gone → finale → won, no life lost', () => {
    const g = new Engine(LEVELS[0].rows)
    expect(g.bricksLeft).toBeGreaterThan(0)
    for (const b of g.bricks) b.alive = false
    g.update(DT)
    expect(g.finale).toBe(true)
    expect(g.state).toBe('playing')
    advance(g, 1.5)
    expect(g.state).toBe('won')
    expect(g.lives).toBe(DIFFICULTY[0].lives)
  })

  it('does not win while barriers stand if a breakable brick is left', () => {
    const g = new Engine(['#1#'])
    advance(g, 0.5)
    expect(g.state).toBe('playing')
    g.bricks.find(b => !b.unbreakable)!.alive = false
    advance(g, 1.6)
    expect(g.state).toBe('won')                            // barriers alone never block the win
  })

  it('marks the last brick standing as the gold beacon', () => {
    const g = new Engine(['11'])
    g.bricks[0].alive = false
    g.update(DT)
    expect(g.bricks[1].gold).toBe(true)
  })

  it('a ball draining through the finale does not cost a life', () => {
    const g = board()
    for (const b of g.bricks) b.alive = false
    g.update(DT)
    expect(g.finale).toBe(true)
    loseWhiteBall(g)
    expect(g.lives).toBe(DIFFICULTY[0].lives)
    expect(g.state).toBe('playing')
  })

  it('a finished engine ignores further updates', () => {
    const g = new Engine(['1'])
    g.bricks[0].alive = false
    advance(g, 2)
    expect(g.state).toBe('won')
    const score = g.score
    advance(g, 1)
    expect(g.score).toBe(score)
    expect(g.state).toBe('won')
  })
})

describe('Arkanoid engine: lives and game over', () => {
  it('losing the white ball costs one life and re-sticks a fresh ball, keeping the bricks', () => {
    const g = board()
    const bricks = g.bricks.length
    loseWhiteBall(g)
    expect(g.lives).toBe(2)
    expect(g.state).toBe('playing')
    expect(g.balls).toHaveLength(1)
    expect(g.balls[0]).toMatchObject({ primary: true, stuck: true })
    expect(g.bricks.filter(b => b.alive)).toHaveLength(bricks)
  })

  it('the white ball is the life: a coloured ball still flying does not save you', () => {
    const g = board()
    colourBall(g)
    loseWhiteBall(g)
    expect(g.lives).toBe(2)
    expect(g.balls.every(b => b.stuck || b.primary)).toBe(true)
  })

  it('a lost ball clears a held power state (the round resets)', () => {
    const g = board()
    grant(g, 'gun')
    grant(g, 'oscillate')
    expect(g.gunAmmo).toBeGreaterThan(0)
    expect(g.oscillateStacks).toBe(1)
    loseWhiteBall(g)
    expect(g.gunAmmo).toBe(0)
    expect(g.oscillateStacks).toBe(0)
    expect(g.amp).toBe(1)
  })

  it('reaches game over at zero lives and stays there', () => {
    const g = board()
    loseWhiteBall(g); loseWhiteBall(g)
    expect(g.lives).toBe(1)
    expect(g.state).toBe('playing')
    loseWhiteBall(g)
    expect(g.lives).toBe(0)
    expect(g.state).toBe('gameover')
    const score = g.score
    advance(g, 1)
    expect(g.state).toBe('gameover')
    expect(g.lives).toBe(0)
    expect(g.score).toBe(score)
  })

  it('continueGame refills to the difficulty lives and keeps score and bricks', () => {
    const g = board()
    g.score = 777
    g.lives = 1
    loseWhiteBall(g)
    expect(g.state).toBe('gameover')
    g.continueGame()
    expect(g.state).toBe('playing')
    expect(g.lives).toBe(DIFFICULTY[0].lives)
    expect(g.score).toBe(777)
    expect(g.bricksLeft).toBe(33)
    expect(g.balls[0]).toMatchObject({ primary: true, stuck: true })
  })

  it('continueGame honours a harder difficulty and is a no-op while playing', () => {
    const g = board()
    g.difficulty = DIFFICULTY[4]
    g.lives = DIFFICULTY[4].lives
    g.continueGame()                                       // not game over → nothing happens
    expect(g.lives).toBe(1)
    loseWhiteBall(g)
    expect(g.state).toBe('gameover')
    g.continueGame()
    expect(g.lives).toBe(1)
    expect(g.state).toBe('playing')
  })

  it('difficulties run Rookie → Gangster with falling lives', () => {
    expect(DIFFICULTY.map(d => d.name)).toEqual(['Rookie', 'Hustler', 'Made', 'Kingpin', 'Gangster'])
    expect(DIFFICULTY.map(d => d.lives)).toEqual([3, 3, 3, 2, 1])
  })
})

describe('Arkanoid engine: the built-in walls', () => {
  it('ships exactly 100 walls', () => {
    expect(LEVELS).toHaveLength(100)
  })

  it('gives every wall a unique name and at least one row', () => {
    const names = LEVELS.map(l => l.name)
    expect(names.every(n => typeof n === 'string' && n.length > 0)).toBe(true)
    expect(new Set(names).size).toBe(names.length)
    expect(LEVELS.every(l => l.rows.length > 0)).toBe(true)
  })

  it('draws every wall from the documented alphabet within the 11-column grid', () => {
    for (const level of LEVELS) {
      for (const row of level.rows) {
        expect(row.length, `${level.name}: "${row}"`).toBeLessThanOrEqual(COLS)
        expect(/^[.1-4*# ]*$/.test(row), `${level.name}: "${row}"`).toBe(true)
      }
    }
  })

  it('loads every wall into an engine with something to clear', () => {
    LEVELS.forEach((level, index) => {
      const g = new Engine(level.rows)
      g.levelIndex = index
      expect(g.state, level.name).toBe('playing')
      expect(g.bricksLeft, level.name).toBeGreaterThan(0)
      expect(g.balls, level.name).toHaveLength(1)
      for (const b of g.bricks) {
        expect(b.col!).toBeGreaterThanOrEqual(0)
        expect(b.col!).toBeLessThan(COLS)
        expect(b.x + b.w).toBeLessThanOrEqual(W + 1e-6)
      }
    })
  })

  it('lets every wall run a couple of seconds without throwing', () => {
    for (const level of LEVELS) {
      const g = new Engine(level.rows)
      advance(g, 0.5)
      expect(['playing', 'won', 'gameover']).toContain(g.state)
    }
  })

  it('does not hand out the same rows by reference (the engine only reads them)', () => {
    const rows = LEVELS[0].rows.slice()
    new Engine(LEVELS[0].rows)
    expect(LEVELS[0].rows).toEqual(rows)
  })
})

const ALL_KINDS: PowerKind[] = [
  'oscillate', 'break', 'laser', 'expand', 'gun', 'magnet', 'rocket', 'multiplier', 'burst', 'pinball',
  'beam', 'clock', 'ballchain', 'extralife', 'crane', 'pierce', 'heal', 'shield', 'regen', 'scramble',
]

describe('Arkanoid engine: power-up pills', () => {
  it('defines exactly twenty pill kinds', () => {
    expect(Object.keys(POWER_META).sort()).toEqual([...ALL_KINDS].sort())
    expect(Object.keys(POWER_META)).toHaveLength(20)
  })

  it('describes every kind with a letter, colour, name and text', () => {
    for (const kind of ALL_KINDS) {
      const m = POWER_META[kind]
      expect(m.letter.length, kind).toBeGreaterThan(0)
      expect(m.color, kind).toMatch(/^#[0-9a-f]{6}$/i)
      expect(m.name.length, kind).toBeGreaterThan(0)
      expect(m.desc.length, kind).toBeGreaterThan(0)
    }
  })

  it('drops eighteen kinds ambiently; the 1-UP and the crane are earned', () => {
    expect([...POWER_ORDER].sort()).toEqual(ALL_KINDS.filter(k => k !== 'extralife' && k !== 'crane').sort())
    expect(POWER_ORDER).toHaveLength(18)
    expect(new Set(POWER_ORDER).size).toBe(18)
  })

  it.each(ALL_KINDS)('%s applies without throwing, alone and under a quadruple amp', kind => {
    const plain = board()
    expect(() => { colourBall(plain); grant(plain, kind); advance(plain, 0.2) }).not.toThrow()
    expect(plain.state).not.toBe('won')
    const amped = board()
    grant(amped, 'oscillate', 3)
    expect(amped.amp).toBe(4)
    expect(() => { colourBall(amped); grant(amped, kind); advance(amped, 0.2) }).not.toThrow()
  })

  it('a caught pill is spent, flashes, scores and fattens the pill axis', () => {
    const g = board()
    grant(g, 'expand')
    expect(g.capsules).toHaveLength(0)
    expect(g.pickups.some(p => p.kind === 'expand')).toBe(true)
    expect(g.score).toBeGreaterThan(0)
    expect(g.pillMul).toBeCloseTo(1.1, 6)
  })

  it('a pill that misses the bat is not applied', () => {
    const g = board()
    g.capsules.push({ x: 5, y: g.paddle.y - 5, kind: 'gun' })
    g.paddle.x = W - 50
    g.update(1 / 240)
    expect(g.gunAmmo).toBe(0)
    expect(g.capsules).toHaveLength(1)
  })

  describe('what each pill does at amp 1', () => {
    it('oscillate raises the amp ladder and widens the bat', () => {
      const g = board()
      const w = g.paddle.w
      grant(g, 'oscillate')
      expect(g.oscillateStacks).toBe(1)
      expect(g.amp).toBe(2)
      expect(g.paddle.w).toBeCloseTo(w * 1.25, 6)
    })
    it('the amp ladder stops at quadruple', () => {
      const g = board()
      grant(g, 'oscillate', 9)
      expect(g.amp).toBe(4)
      expect(g.maxBalls).toBe(36)
      expect(g.maxLives).toBe(20)
    })
    it('break splits the ball in two more', () => {
      const g = board()
      g.balls[0].stuck = false; g.balls[0].vx = 0; g.balls[0].vy = -400
      grant(g, 'break')
      expect(g.balls).toHaveLength(3)
      expect(g.balls.every(b => b.primary)).toBe(true)     // white splits into whites
    })
    it('laser loads four fireballs', () => {
      const g = board(); grant(g, 'laser')
      expect(g.laserShots).toBe(4)
      expect(g.laserLevel).toBe(1)
    })
    it('laser powers up when re-grabbed before it empties, topping out at three', () => {
      const g = board(); grant(g, 'laser', 5)
      expect(g.laserLevel).toBe(3)
    })
    it('expand widens the bat for thirteen seconds', () => {
      const g = board(); grant(g, 'expand')
      expect(g.paddle.w).toBeCloseTo(134, 6)
      expect(g.expandTimer).toBeCloseTo(13, 1)
    })
    it('gun loads six shots', () => {
      const g = board(); grant(g, 'gun')
      expect(g.gunAmmo).toBe(6)
      expect(g.gunActive).toBe(true)
      expect(g.gunLevel).toBe(1)
    })
    it('gun stacks to a second level', () => {
      const g = board(); grant(g, 'gun', 2)
      expect(g.gunLevel).toBe(2)
    })
    it('magnet pulls for eleven seconds', () => {
      const g = board(); grant(g, 'magnet')
      expect(g.magnetTimer).toBeCloseTo(11, 1)
    })
    it('rocket carries one missile', () => {
      const g = board(); grant(g, 'rocket')
      expect(g.rocketAmmo).toBe(1)
    })
    it('multiplier adds to the gold bonus', () => {
      const g = board(); grant(g, 'multiplier')
      expect(g.goldBonus).toBeCloseTo(0.5, 6)
      expect(g.goldTimer).toBeGreaterThan(11)
    })
    it('burst makes every brick one-hit for eight seconds', () => {
      const g = new Engine(['4'])
      grant(g, 'burst')
      expect(g.burstTimer).toBeCloseTo(8, 1)
      const ball = g.balls[0]
      ball.stuck = false; ball.x = BRICK_W / 2; ball.y = BRICK_TOP + BRICK_H + 24; ball.vx = 0; ball.vy = -300
      advance(g, 0.5)
      expect(g.bricksLeft).toBe(0)                         // a 4-hp brick died to one touch
    })
    it('pinball flips the board into machine mode with bumpers and a doubled white ball', () => {
      const g = board(); grant(g, 'pinball')
      expect(g.pinball).toBe(true)
      expect(g.bumpers.length).toBeGreaterThan(0)
      expect(g.balls[0].r).toBe(14)
    })
    it('beam loads four shots', () => {
      const g = board(); grant(g, 'beam')
      expect(g.beamShots).toBe(4)
      expect(g.beamLevel).toBe(1)
    })
    it('clock freezes things for six seconds, but only with a colour ball in play', () => {
      const without = board(); grant(without, 'clock')
      expect(without.freezeTimer).toBe(0)
      const withBall = board(); colourBall(withBall); grant(withBall, 'clock')
      expect(withBall.freezeTimer).toBeCloseTo(6, 1)
    })
    it('ball & chain swings a wrecking ball for sixteen seconds', () => {
      const g = board(); grant(g, 'ballchain')
      expect(g.ballchainTimer).toBeCloseTo(16, 1)
      expect(g.chainBall).not.toBeNull()
    })
    it('1UP adds a life up to the ceiling of five', () => {
      const g = board(); g.lives = 3; grant(g, 'extralife')
      expect(g.lives).toBe(4)
      g.lives = 5; grant(g, 'extralife')
      expect(g.lives).toBe(5)
    })
    it('the paper crane pays the 100,000 jackpot', () => {
      const g = board(); grant(g, 'crane')
      expect(g.score).toBeGreaterThanOrEqual(100000)
    })
    it('pierce lasts nine seconds', () => {
      const g = board(); grant(g, 'pierce')
      expect(g.pierceTimer).toBeCloseTo(9, 1)
    })
    it('heal restores 45 bat health, capped at full', () => {
      const g = board(); g.paddleHp = 10; grant(g, 'heal')
      expect(g.paddleHp).toBeCloseTo(55, 6)
      grant(g, 'heal', 3)
      expect(g.paddleHp).toBe(100)
      expect(g.paddleHpFrac).toBe(1)
    })
    it('shield raises a 100-point force field', () => {
      const g = board(); grant(g, 'shield')
      expect(g.shieldHp).toBe(100)
      expect(g.shielded).toBe(true)
      expect(g.regenShield).toBe(false)
    })
    it('regen is a shield that also heals', () => {
      const g = board(); grant(g, 'regen')
      expect(g.shieldHp).toBe(100)
      expect(g.regenShield).toBe(true)
    })
    it('scramble runs one second, then steps up to three on a re-grab', () => {
      const g = board(); grant(g, 'scramble')
      expect(g.scrambleTimer).toBeCloseTo(1, 1)
      grant(g, 'scramble')
      expect(g.scrambleTimer).toBeCloseTo(3, 1)
    })
  })

  describe('what the amp does', () => {
    it('doubles the gun magazine and the heal, and raises the 1UP ceiling', () => {
      const g = board(); grant(g, 'oscillate')
      grant(g, 'gun')
      expect(g.gunAmmo).toBe(12)
      g.lives = 3; grant(g, 'extralife')
      expect(g.lives).toBe(5)                              // a 2-UP
      expect(g.maxLives).toBe(10)
    })
    it('does not retro-buff a pill already held when the amp rises', () => {
      const g = board(); grant(g, 'gun')
      grant(g, 'oscillate')
      expect(g.gunAmmo).toBe(6)
    })
  })
})
