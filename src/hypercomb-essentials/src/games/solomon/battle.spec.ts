// games/solomon/battle.spec.ts
//
// The Hush — Solomon's Key's own duel state, weapons, spells and their
// steles/chests/barriers — exercised entirely through the pure Engine class.
// No LevelDef here comes from real content (§6.11's placements are stage 2's
// job, landed in labyrinth.ts's buildRooms()/chamber()); every fixture below
// is a small, hand-built room, literal in this file per the "no fixture
// files outside *.spec.ts" rule.
//
// Numeric tuning constants (HUSH_REACH, STRIKE_CD, EMBER_COST, …) are
// module-private in engine.ts, so the values pinned below are copied from the
// spec's own exact tuning table rather than imported — a drift in either
// place will show up as a mismatch here.

import { describe, expect, it } from 'vitest'
import {
  COMBAT_SKILLS, EMPTY, Engine, FIGHTERS, SIM_DT, SKILL_NAMES, TILE, WALL,
  type CombatSkillId, type EnemySpawn, type ItemSpawn, type LevelDef,
} from './engine.js'

// ── the fixture room ─────────────────────────────────────────────────────
// A bordered box, floor along the second-to-last row, everything else EMPTY.
// Most tests place Dana/foes by directly writing their x/y after construction
// (pixel-exact control) rather than trusting spawn()'s col/row rounding.

const COLS = 20
const ROWS = 8
const FLOOR_ROW = ROWS - 2
const STAND_ROW = FLOOR_ROW - 1

function baseTiles(): number[] {
  const tiles = new Array(COLS * ROWS).fill(EMPTY)
  for (let c = 0; c < COLS; c++) tiles[c] = WALL
  for (let c = 0; c < COLS; c++) tiles[(ROWS - 1) * COLS + c] = WALL
  for (let c = 0; c < COLS; c++) tiles[FLOOR_ROW * COLS + c] = WALL
  for (let r = 0; r < ROWS; r++) { tiles[r * COLS] = WALL; tiles[r * COLS + COLS - 1] = WALL }
  return tiles
}

function level(opts: { tiles?: number[]; enemies?: EnemySpawn[]; items?: ItemSpawn[] } = {}): LevelDef {
  return {
    name: 'battle-fixture', cols: COLS, rows: ROWS, tiles: opts.tiles ?? baseTiles(),
    player: { col: 2, row: STAND_ROW }, door: { col: COLS - 2, row: STAND_ROW },
    enemies: opts.enemies ?? [], items: opts.items ?? [], mirrors: [], interconnected: true,
  }
}

/** A fresh engine with the Stand already known (the common case — most tests
 *  are not testing the gate itself). */
function withStand(opts?: Parameters<typeof level>[0]): Engine {
  const engine = new Engine(level(opts))
  engine.kit.push('stand')
  return engine
}

/** Place a foe's centre at an exact pixel offset from Dana's own centre. */
function placeFoeNear(engine: Engine, index: number, dx: number, dy: number): void {
  const p = engine.player
  const pcx = p.x + p.w / 2, pcy = p.y + p.h / 2
  const e = engine.enemies[index]!
  e.x = pcx + dx - e.w / 2
  e.y = pcy + dy - e.h / 2
}

// Tuning values pinned from the spec's own exact table (module-private in
// engine.ts — copied here, not imported).
const HUSH_REACH = TILE * 2.25
const HUSH_BAND = TILE * 1.5
const HUSH_BREAK = TILE * 3.25
const HUSH_LINGER = 0.4
const TEMPO_IN = 0.25
const TEMPO_OUT = 0.4
const HUSH_REST = 1.2
const HUSH_MAX = 12
const DUEL_BONUS = 500
const HURT_SAND = 2500
const MERCY_T = 1.2
const STAGGER_T = 0.9
const STAGGER_LONG = 1.4
const WARD_PERFECT = 0.75
const STRIKE_CD_SICKLE = 0.45
const STRIKE_CD_SLING = 0.35
const SLING_SPEED = 260
const SLING_RANGE = TILE * 3.5
const EMBER_COST = 600
const HOLD_COST = 1500
const HOLD_STILL = 2.5
const HOLD_FOE = 1.4
const INTERACT_REACH = TILE * 1.25

describe('the Hush — gate and proximity', () => {
  it('never opens without the Stand, even nose-to-nose with a FIGHTER', () => {
    const engine = new Engine(level({ enemies: [{ col: 4, row: STAND_ROW, kind: 'goblin' }] }))
    placeFoeNear(engine, 0, 40, 0)
    engine.update(0)
    expect(engine.battle).toBeNull()
  })

  it('opens once the Stand is known and a FIGHTER is within reach', () => {
    const engine = withStand({ enemies: [{ col: 4, row: STAND_ROW, kind: 'goblin' }] })
    placeFoeNear(engine, 0, HUSH_REACH - 4, 0)
    engine.update(0)
    expect(engine.battle).not.toBeNull()
    expect(engine.battle!.foe).toBe(engine.enemies[0])
    expect(engine.battle!.phase).toBe('closing')
    expect(engine.hushFlash).toBe(1)
  })

  it('gates on distance — just outside HUSH_REACH stays quiet', () => {
    const engine = withStand({ enemies: [{ col: 4, row: STAND_ROW, kind: 'goblin' }] })
    placeFoeNear(engine, 0, HUSH_REACH + 8, 0)
    engine.update(0)
    expect(engine.battle).toBeNull()
  })

  it('the dev-only hushEnabled override blocks the gate even with the Stand in reach', () => {
    const engine = withStand({ enemies: [{ col: 4, row: STAND_ROW, kind: 'goblin' }] })
    engine.hushEnabled = false
    placeFoeNear(engine, 0, 40, 0)
    engine.update(0)
    expect(engine.battle).toBeNull()
  })

  it('a post-Hush rest blocks re-opening until it elapses', () => {
    const engine = withStand({ enemies: [{ col: 4, row: STAND_ROW, kind: 'goblin' }] })
    engine.hushRest = HUSH_REST
    placeFoeNear(engine, 0, 40, 0)
    engine.update(0)
    expect(engine.battle).toBeNull()
    engine.hushRest = 0
    engine.update(0)
    expect(engine.battle).not.toBeNull()
  })

  it.each(['ghost', 'sparkball', 'demonhead', 'panel'] as const)('%s never bends time, however close', kind => {
    const engine = withStand({ enemies: [{ col: 4, row: STAND_ROW, kind }] })
    placeFoeNear(engine, 0, 40, 0)
    engine.update(0)
    expect(engine.battle).toBeNull()
    expect(FIGHTERS.has(kind)).toBe(false)
  })

  it('grounded FIGHTERS need HUSH_BAND vertical alignment; the flying neul does not', () => {
    const goblin = withStand({ enemies: [{ col: 4, row: STAND_ROW, kind: 'goblin' }] })
    placeFoeNear(goblin, 0, 20, HUSH_BAND + 10)
    goblin.update(0)
    expect(goblin.battle).toBeNull()

    const neul = withStand({ enemies: [{ col: 4, row: STAND_ROW, kind: 'neul' }] })
    placeFoeNear(neul, 0, 20, HUSH_BAND + 10)
    neul.update(0)
    expect(neul.battle).not.toBeNull()
  })

  it('a foe already touching Dana is an instant hit, never a Hush', () => {
    const engine = withStand({ enemies: [{ col: 4, row: STAND_ROW, kind: 'goblin' }] })
    placeFoeNear(engine, 0, 0, 0)   // dead centre overlap
    const lives = engine.lives
    engine.update(0)
    expect(engine.battle).toBeNull()
    expect(engine.lives).toBe(lives - 1)
  })

  it('marks the nearest of several qualifying foes', () => {
    const engine = withStand({ enemies: [{ col: 4, row: STAND_ROW, kind: 'goblin' }, { col: 6, row: STAND_ROW, kind: 'gargoil' }] })
    placeFoeNear(engine, 0, 55, 0)
    placeFoeNear(engine, 1, 35, 0)
    engine.update(0)
    expect(engine.battle!.foe).toBe(engine.enemies[1])
  })
})

describe('the Hush — phases and endings', () => {
  it('closes over TEMPO_IN, locking world/foe tempo down as k rises', () => {
    const engine = withStand({ enemies: [{ col: 4, row: STAND_ROW, kind: 'goblin' }] })
    placeFoeNear(engine, 0, 40, 0)
    engine.update(0)
    expect(engine.battle!.phase).toBe('closing')
    const before = engine.life
    for (let i = 0; i < Math.ceil(TEMPO_IN / SIM_DT) + 2; i++) engine.update(SIM_DT)
    expect(engine.battle!.phase).toBe('exchange')
    expect(engine.battle!.k).toBe(1)
    // World-speed things (the life meter) drained SLOWER than raw dt would.
    expect(before - engine.life).toBeLessThan(100 * TEMPO_IN)
  })

  it('winning with nobody else in reach parts ways and pays the duel bonus', () => {
    const engine = withStand({ enemies: [{ col: 4, row: STAND_ROW, kind: 'goblin' }] })
    placeFoeNear(engine, 0, 40, 0)
    engine.update(0)
    engine.battle!.phase = 'exchange'; engine.battle!.k = 1
    const score = engine.score
    engine.enemies[0]!.alive = false
    engine.update(SIM_DT)
    expect(engine.score).toBe(score + DUEL_BONUS)
    expect(engine.battle!.end).toBe('won')
    expect(engine.battle!.phase).toBe('parting')
    // TEMPO_OUT decay eventually clears it, with no rest (only hurt/stalemate rest).
    for (let i = 0; i < Math.ceil(TEMPO_OUT / SIM_DT) + 2; i++) engine.update(SIM_DT)
    expect(engine.battle).toBeNull()
    expect(engine.hushRest).toBe(0)
  })

  it('the chain rule: killing the marked foe with another FIGHTER in reach passes the mark without resetting k', () => {
    const engine = withStand({ enemies: [{ col: 4, row: STAND_ROW, kind: 'goblin' }, { col: 6, row: STAND_ROW, kind: 'gargoil' }] })
    placeFoeNear(engine, 0, 35, 0)
    placeFoeNear(engine, 1, 55, 0)
    const foe0 = engine.enemies[0]!, foe1 = engine.enemies[1]!
    engine.update(0)
    engine.battle!.phase = 'exchange'; engine.battle!.k = 1
    expect(engine.battle!.foe).toBe(foe0)
    // A real #killEnemy (not a bare alive=false) — squash keeps it in the
    // array (post-death effects still animate) exactly like any other kill.
    foe0.alive = false; foe0.squash = 0.4
    engine.update(SIM_DT)
    expect(engine.battle).not.toBeNull()
    expect(engine.battle!.foe).toBe(foe1)
    expect(engine.battle!.phase).toBe('exchange')
    expect(engine.battle!.k).toBe(1)
  })

  it('parting for HUSH_LINGER beyond HUSH_BREAK ends it with no bonus, and a brief excursion inside the window resets cleanly', () => {
    const engine = withStand({ enemies: [{ col: 4, row: STAND_ROW, kind: 'goblin' }] })
    placeFoeNear(engine, 0, 40, 0)
    engine.update(0)
    engine.battle!.phase = 'exchange'; engine.battle!.k = 1
    const score = engine.score
    // A brief excursion beyond HUSH_BREAK, back within the linger window, never parts.
    engine.player.x -= HUSH_BREAK + 20
    engine.update(0.1)
    expect(engine.battle!.phase).toBe('exchange')
    engine.player.x += HUSH_BREAK + 20
    engine.update(0)
    expect(engine.battle!.partedFor).toBe(0)
    // Now stay beyond HUSH_BREAK for the full linger window.
    engine.player.x -= HUSH_BREAK + 20
    engine.update(HUSH_LINGER + 0.01)
    expect(engine.battle!.end).toBe('parted')
    expect(engine.battle!.phase).toBe('parting')
    expect(engine.score).toBe(score)
  })

  it('an unresolved Hush times out to a stalemate after HUSH_MAX seconds and rests', () => {
    const engine = withStand({ enemies: [{ col: 4, row: STAND_ROW, kind: 'goblin' }] })
    placeFoeNear(engine, 0, 40, 0)
    engine.update(0)
    engine.battle!.phase = 'exchange'; engine.battle!.k = 1; engine.battle!.age = HUSH_MAX - 0.01
    engine.update(SIM_DT)
    expect(engine.battle!.end).toBe('stalemate')
    expect(engine.hushRest).toBeGreaterThan(0)
  })

  it('a marked foe’s touch costs sand and mercy, not a life, and ends the Hush as ‘hurt’', () => {
    const engine = withStand({ enemies: [{ col: 4, row: STAND_ROW, kind: 'goblin' }] })
    placeFoeNear(engine, 0, 40, 0)
    engine.update(0)
    engine.battle!.phase = 'exchange'; engine.battle!.k = 1
    const lives = engine.lives, life = engine.life
    placeFoeNear(engine, 0, 0, 0)   // walk it into contact
    engine.update(0)
    expect(engine.lives).toBe(lives)
    expect(engine.life).toBe(life - HURT_SAND)
    expect(engine.battle!.end).toBe('hurt')
    expect(engine.mercy).toBeGreaterThan(0)
    // Mercy gates a second hit the same beat — no further sand lost.
    const afterFirst = engine.life
    engine.update(0)
    expect(engine.life).toBe(afterFirst)
  })

  it('life reaching zero from a hurt contact is an ordinary lost life', () => {
    const engine = withStand({ enemies: [{ col: 4, row: STAND_ROW, kind: 'goblin' }] })
    placeFoeNear(engine, 0, 40, 0)
    engine.update(0)
    engine.battle!.phase = 'exchange'; engine.battle!.k = 1
    engine.life = HURT_SAND - 1
    const lives = engine.lives
    placeFoeNear(engine, 0, 0, 0)
    engine.update(0)
    expect(engine.lives).toBe(lives - 1)
  })

  it('a shot costs the same sand inside a Hush and kills outright outside one', () => {
    const inHush = withStand({ enemies: [{ col: 4, row: STAND_ROW, kind: 'goblin' }] })
    placeFoeNear(inHush, 0, 40, 0)
    inHush.update(0)
    inHush.battle!.phase = 'exchange'; inHush.battle!.k = 1
    const p = inHush.player
    inHush.shots.push({ x: p.x + p.w / 2, y: p.y + p.h / 2, vx: 0, life: 1 })
    const life = inHush.life, lives = inHush.lives
    inHush.update(0)
    expect(inHush.lives).toBe(lives)
    expect(inHush.life).toBe(life - HURT_SAND)

    const noHush = withStand()
    const q = noHush.player
    noHush.shots.push({ x: q.x + q.w / 2, y: q.y + q.h / 2, vx: 0, life: 1 })
    const lives2 = noHush.lives
    noHush.update(0)
    expect(noHush.lives).toBe(lives2 - 1)
  })

  it('a bystander FIGHTER is still instant death, even mid-Hush with someone else', () => {
    const engine = withStand({ enemies: [{ col: 4, row: STAND_ROW, kind: 'goblin' }, { col: 8, row: STAND_ROW, kind: 'gargoil' }] })
    placeFoeNear(engine, 0, 40, 0)
    placeFoeNear(engine, 1, 300, 0)   // far away (but still inside the room) — never marked
    engine.update(0)
    expect(engine.battle!.foe).toBe(engine.enemies[0])
    placeFoeNear(engine, 1, 0, 0)       // now walked into contact with Dana
    const lives = engine.lives
    engine.update(0)
    expect(engine.lives).toBe(lives - 1)
  })

  it('is deterministic across an identical closing/strike/ward sequence', () => {
    const run = (): unknown => {
      const engine = withStand({ enemies: [{ col: 4, row: STAND_ROW, kind: 'goblin' }] })
      engine.kit.push('sickle', 'ward')
      engine.weapon = 'sickle'; engine.spell = 'ward'
      placeFoeNear(engine, 0, HUSH_REACH - 4, 0)
      for (let i = 0; i < 40; i++) {
        engine.update(SIM_DT)
        if (i === 10) engine.castSpell()
        if (i === 20) engine.strike()
      }
      return { score: engine.score, life: Math.round(engine.life), battle: engine.battle && { ...engine.battle, foe: undefined }, kit: [...engine.kit] }
    }
    expect(run()).toEqual(run())
  })
})

describe('guard and stagger', () => {
  it('the Sickle stops on cooldown, stagger-then-kills a goblin (guard 2), and tags the kill ‘blade’', () => {
    const engine = withStand({ enemies: [{ col: 4, row: STAND_ROW, kind: 'goblin' }] })
    engine.kit.push('sickle'); engine.weapon = 'sickle'
    placeFoeNear(engine, 0, TILE * 0.5, 0)
    const foe = engine.enemies[0]!
    expect(engine.strike()).toBe('sickle')
    expect(engine.strikeCd).toBeCloseTo(STRIKE_CD_SICKLE, 5)
    expect(foe.alive).toBe(true)
    expect(foe.state).toBe('stagger')
    expect(engine.staggerFlash).toBe(1)
    expect(engine.strike()).toBe('blocked')   // still on cooldown
    engine.strikeCd = 0
    expect(engine.strike()).toBe('sickle')
    expect(foe.alive).toBe(false)
    expect(engine.killCause).toBe('blade')
  })

  it('the dragon’s guard of 4 survives three hits and dies on the fourth', () => {
    const engine = withStand({ enemies: [{ col: 4, row: STAND_ROW, kind: 'dragon' }] })
    engine.kit.push('sickle'); engine.weapon = 'sickle'
    placeFoeNear(engine, 0, TILE * 0.5, 0)
    const foe = engine.enemies[0]!
    for (let i = 0; i < 3; i++) { engine.strikeCd = 0; engine.strike(); expect(foe.alive).toBe(true) }
    engine.strikeCd = 0; engine.strike()
    expect(foe.alive).toBe(false)
  })

  it('sparkball is batted, never staggered or killed', () => {
    const engine = withStand({ enemies: [{ col: 4, row: STAND_ROW, kind: 'sparkball' }] })
    engine.kit.push('sickle'); engine.weapon = 'sickle'
    placeFoeNear(engine, 0, TILE * 0.5, 0)
    const foe = engine.enemies[0]!
    const vx = foe.vx = 40
    engine.strike()
    expect(foe.alive).toBe(true)
    expect(foe.state).not.toBe('stagger')
    expect(engine.batFlash).toBe(1)
    expect(foe.vx).toBe(-vx)
  })

  it('panel clangs and stays alive, invulnerable as ever', () => {
    const engine = withStand({ enemies: [{ col: 4, row: STAND_ROW, kind: 'panel' }] })
    engine.kit.push('sickle'); engine.weapon = 'sickle'
    placeFoeNear(engine, 0, TILE * 0.5, 0)
    const foe = engine.enemies[0]!
    engine.strike()
    expect(foe.alive).toBe(true)
    expect(engine.clangFlash).toBe(1)
  })

  it('a staggered walker still falls — gravity never pauses for a stagger', () => {
    const engine = withStand({ enemies: [{ col: 4, row: STAND_ROW, kind: 'goblin' }] })
    const foe = engine.enemies[0]!
    foe.state = 'stagger'; foe.stateT = STAGGER_T
    foe.y -= TILE * 3   // lift it into the air
    const y = foe.y
    engine.update(SIM_DT)
    expect(foe.y).toBeGreaterThan(y)   // gravity moved it down
  })
})

describe('weapons', () => {
  it('the Sling flies out, homes back, catches, and only then starts its own cooldown', () => {
    const engine = withStand()
    engine.kit.push('sling'); engine.weapon = 'sling'
    expect(engine.strike()).toBe('sling')
    expect(engine.sling).not.toBeNull()
    expect(engine.strikeCd).toBe(0)          // not yet — the cooldown starts at the catch
    expect(engine.strike()).toBe('blocked')  // one disc at a time
    for (let i = 0; i < 400 && engine.sling; i++) engine.update(SIM_DT)
    expect(engine.sling).toBeNull()
    expect(engine.catchFlash).toBe(1)
    expect(engine.strikeCd).toBeCloseTo(STRIKE_CD_SLING, 5)
  })

  it('the Sling hits a goblin once per flight and fetches a plain item it crosses', () => {
    // Deliberately without the Stand: a many-tick loop below would otherwise
    // risk a real Hush opening against this same goblin (it's well within
    // HUSH_REACH) and confusing this test's own assertions with an unrelated
    // mechanic — the Hush itself is battle.spec.ts's other describe blocks.
    const engine = new Engine(level({
      enemies: [{ col: 6, row: STAND_ROW, kind: 'goblin' }],
      items: [{ col: 5, row: STAND_ROW, kind: 'jewel' }],
    }))
    engine.kit.push('sling'); engine.weapon = 'sling'
    placeFoeNear(engine, 0, TILE * 2, 0)
    const foe = engine.enemies[0]!
    engine.strike()
    for (let i = 0; i < 400 && engine.sling; i++) engine.update(SIM_DT)
    expect(foe.guard).toBeLessThan(2)   // hit exactly once (goblin guard starts at 2)
    expect(engine.items.find(it => it.kind === 'jewel')!.taken).toBe(true)
  })

  it('N/B cycle only the owned weapons/spells, and stay null with none held', () => {
    const engine = withStand()
    expect(engine.nextWeapon()).toBeNull()
    engine.kit.push('sickle', 'sling')
    const first = engine.nextWeapon()
    const second = engine.nextWeapon()
    expect(new Set([first, second])).toEqual(new Set(['sickle', 'sling']))
    expect(engine.nextWeapon()).toBe(first)   // wraps

    expect(engine.nextSpell()).toBeNull()
    engine.kit.push('ward')
    expect(engine.nextSpell()).toBe('ward')
  })

  it('equip() only equips a held id into its own slot; ‘stand’ has none', () => {
    const engine = withStand()
    expect(engine.equip('sickle')).toBe(false)   // not held
    engine.kit.push('sickle', 'ward')
    expect(engine.equip('sickle')).toBe(true)
    expect(engine.weapon).toBe('sickle')
    expect(engine.equip('ward')).toBe(true)
    expect(engine.spell).toBe('ward')
    expect(engine.equip('stand')).toBe(false)
  })
})

describe('spells', () => {
  it('Ward staggers an attacker instead of hurting Dana, and reflects a shot into one of her own fireballs', () => {
    const engine = withStand({ enemies: [{ col: 4, row: STAND_ROW, kind: 'goblin' }] })
    engine.kit.push('ward'); engine.spell = 'ward'
    expect(engine.castSpell()).toBe('ward')
    expect(engine.wardT).toBeGreaterThan(0)
    const foe = engine.enemies[0]!
    placeFoeNear(engine, 0, 0, 0)
    const life = engine.life
    engine.update(0)
    expect(engine.life).toBe(life)
    expect(foe.state).toBe('stagger')
    expect(engine.parryFlash).toBe(1)

    const shots = withStand()
    shots.kit.push('ward'); shots.spell = 'ward'
    shots.castSpell()
    const p = shots.player
    shots.shots.push({ x: p.x + p.w / 2, y: p.y + p.h / 2, vx: 80, life: 1 })
    shots.update(0)
    expect(shots.shots).toHaveLength(0)
    expect(shots.fireballs).toHaveLength(1)
    expect(shots.fireballs[0]!.vx).toBe(-80)
    expect(shots.wardFlash).toBe(1)
  })

  it('a well-timed (high-telegraph) Ward parry staggers longer and scores 200', () => {
    const engine = withStand({ enemies: [{ col: 4, row: STAND_ROW, kind: 'goblin' }] })
    engine.kit.push('ward'); engine.spell = 'ward'
    engine.castSpell()
    const foe = engine.enemies[0]!
    // Mid-windup, telegraph rises toward 1 — this is what "a well-timed catch"
    // means; the enemy's own step function computes telegraph fresh every
    // tick (before #hazardContact reads it), so a directly-set value alone
    // would just be overwritten.
    foe.state = 'windup'; foe.stateT = 0.001
    placeFoeNear(engine, 0, 0, 0)
    const score = engine.score
    engine.update(0)
    expect(foe.stateT).toBe(STAGGER_LONG)
    expect(engine.score).toBe(score + 200)
  })

  it('Ember burns the target cell and the one beyond it, at power 2, tagged ‘spell’, and costs sand with no brazier involved', () => {
    const engine = withStand({ enemies: [{ col: 4, row: STAND_ROW, kind: 'goblin' }, { col: 5, row: STAND_ROW, kind: 'gargoil' }] })
    engine.kit.push('ember'); engine.spell = 'ember'
    const a = engine.enemies[0]!, b = engine.enemies[1]!
    a.x = engine.targetCell().col * TILE; a.y = STAND_ROW * TILE
    b.x = (engine.targetCell().col + engine.facing) * TILE; b.y = STAND_ROW * TILE
    const life = engine.life
    expect(engine.castSpell()).toBe('ember')
    expect(engine.life).toBe(life - EMBER_COST)
    expect(a.guard).toBeLessThanOrEqual(0)
    expect(a.alive).toBe(false)
    expect(a.alive || b.alive).toBe(false) // both power-2 hits vs guard-2 goblin/gargoil kill outright
    expect(engine.killCause).toBe('spell')
  })

  it('Ember and Hold refuse with ‘no-sand’ rather than draining life below zero, and both respect their own cooldown', () => {
    const engine = withStand()
    engine.kit.push('ember', 'hold')
    engine.spell = 'ember'
    engine.life = EMBER_COST
    expect(engine.castSpell()).toBe('no-sand')
    engine.life = EMBER_COST + 1000
    expect(engine.castSpell()).toBe('ember')
    expect(engine.castSpell()).toBe('blocked')   // on cooldown
    engine.spellCd = 0
    engine.spell = 'hold'
    engine.life = HOLD_COST
    expect(engine.castSpell()).toBe('no-sand')
  })

  it('Hold freezes the world clock (and the meter); mid-Hush it also freezes the marked foe, longer', () => {
    const engine = withStand({ enemies: [{ col: 4, row: STAND_ROW, kind: 'goblin' }, { col: 8, row: STAND_ROW, kind: 'gargoil' }] })
    engine.kit.push('hold'); engine.spell = 'hold'
    placeFoeNear(engine, 0, 40, 0)
    engine.update(0)
    engine.battle!.phase = 'exchange'; engine.battle!.k = 1
    engine.enemies[1]!.x = 6 * TILE; engine.enemies[1]!.y = STAND_ROW * TILE   // a bystander, far off
    expect(engine.castSpell()).toBe('hold')
    expect(engine.stillT).toBeCloseTo(HOLD_STILL, 5)
    expect(engine.holdT).toBeCloseTo(HOLD_FOE, 5)
    const life = engine.life
    const bystanderX = engine.enemies[1]!.x
    engine.update(SIM_DT)
    expect(engine.life).toBe(life)                 // the meter is frozen too
    expect(engine.enemies[1]!.x).toBe(bystanderX)   // world-speed things are held at 0
  })
})

describe('steles, chests and barriers', () => {
  it('nearInteractable() finds the nearest stele/chest in reach and ignores barriers and out-of-reach ones entirely', () => {
    // Player spawns at col 2 (INTERACT_REACH = TILE * 1.25 = 40px).
    const engine = withStand({
      items: [
        { col: 10, row: STAND_ROW, kind: 'stele', gives: 'ward' },     // 256px away — out of reach
        { col: 3, row: STAND_ROW, kind: 'chest', gives: 'sickle' },    // 32px away — in reach, nearer
        { col: 1, row: STAND_ROW, kind: 'barrier', needs: 'ember' },   // adjacent, but never an interactable
      ],
    })
    const near = engine.nearInteractable()
    expect(near?.kind).toBe('chest')
    expect(near?.gives).toBe('sickle')
  })

  it('a stele teaches once (‘read’), then only re-shows the inscription (‘again’) — and walking over it never grants anything', () => {
    const engine = withStand({ items: [{ col: 3, row: STAND_ROW, kind: 'stele', gives: 'ward' }] })
    expect(engine.kit.includes('ward')).toBe(false)
    const first = engine.interact()
    expect(first).toEqual({ kind: 'read', id: 'ward' })
    expect(engine.kit).toContain('ward')
    expect(engine.gotFlash).toBe(1)
    const again = engine.interact()
    expect(again).toEqual({ kind: 'again', id: 'ward' })
    expect(engine.kit.filter(id => id === 'ward')).toHaveLength(1)

    const stele = engine.items.find(it => it.kind === 'stele')!
    engine.player.x = stele.col * TILE; engine.player.y = stele.row * TILE
    engine.kit = []
    engine.update(0)
    expect(engine.kit).toHaveLength(0)   // touch alone never teaches
  })

  it('a chest hands over a weapon the first time (‘taken’)', () => {
    const engine = withStand({ items: [{ col: 3, row: STAND_ROW, kind: 'chest', gives: 'sickle' }] })
    expect(engine.interact()).toEqual({ kind: 'taken', id: 'sickle' })
    expect(engine.kit).toContain('sickle')
  })

  it('a barrier is a sealed WALL until its skill is learned, then opens instantly with no wand, prop or brazier — and stays correct across spawn()', () => {
    const barrierCell = { col: 5, row: STAND_ROW }
    const engine = withStand({ items: [{ ...barrierCell, kind: 'barrier', needs: 'ember' }] })
    expect(engine.solidAt(barrierCell.col, barrierCell.row)).toBe(true)
    engine.kit.push('ember')
    engine.applyBarriers()
    expect(engine.solidAt(barrierCell.col, barrierCell.row)).toBe(false)
    // A fresh spawn() (death/re-entry) re-derives it from the permanent kit, not the terrain.
    engine.setTile(barrierCell.col, barrierCell.row, WALL)
    engine.spawn()
    expect(engine.solidAt(barrierCell.col, barrierCell.row)).toBe(false)
  })

  it('#learn growing the kit re-derives every barrier immediately, mid-room', () => {
    const engine = withStand({ items: [
      { col: 5, row: STAND_ROW, kind: 'barrier', needs: 'ember' },
      { col: 3, row: STAND_ROW, kind: 'stele', gives: 'ember' },
    ] })
    expect(engine.solidAt(5, STAND_ROW)).toBe(true)
    engine.interact()
    expect(engine.kit).toContain('ember')
    expect(engine.solidAt(5, STAND_ROW)).toBe(false)
  })
})

describe('EngineSnapshot: kit/weapon/spell', () => {
  it('round-trips through exportState()/restoreState()', () => {
    const engine = withStand()
    engine.kit.push('sickle', 'ward')
    engine.weapon = 'sickle'; engine.spell = 'ward'
    const snapshot = JSON.parse(JSON.stringify(engine.exportState()))
    const fresh = new Engine(level())
    expect(fresh.restoreState(snapshot)).toBe(true)
    expect(fresh.kit.sort()).toEqual(['sickle', 'stand', 'ward'])
    expect(fresh.weapon).toBe('sickle')
    expect(fresh.spell).toBe('ward')
  })

  it('a v1-shaped snapshot with no kit/weapon/spell at all restores empty/null', () => {
    const engine = new Engine(level())
    const raw = engine.exportState() as unknown as { runtime: Record<string, unknown> }
    delete raw.runtime['kit']; delete raw.runtime['weapon']; delete raw.runtime['spell']
    const fresh = new Engine(level())
    expect(fresh.restoreState(raw)).toBe(true)
    expect(fresh.kit).toEqual([])
    expect(fresh.weapon).toBeNull()
    expect(fresh.spell).toBeNull()
  })

  it('refuses a forged kit (unknown id, or a duplicate)', () => {
    const engine = new Engine(level())
    const raw1 = engine.exportState() as unknown as { runtime: Record<string, unknown> }
    raw1.runtime['kit'] = ['not-a-skill']
    expect(new Engine(level()).restoreState(raw1)).toBe(false)

    const raw2 = engine.exportState() as unknown as { runtime: Record<string, unknown> }
    raw2.runtime['kit'] = ['ward', 'ward']
    expect(new Engine(level()).restoreState(raw2)).toBe(false)
  })

  it('refuses a weapon/spell not actually present in the kit', () => {
    const engine = new Engine(level())
    const raw = engine.exportState() as unknown as { runtime: Record<string, unknown> }
    raw.runtime['kit'] = []
    raw.runtime['weapon'] = 'sickle'
    expect(new Engine(level()).restoreState(raw)).toBe(false)
  })

  it('an enemy snapshot missing ‘guard’ restores with the per-kind default, but a forged guard is refused', () => {
    const engine = new Engine(level({ enemies: [{ col: 4, row: STAND_ROW, kind: 'dragon' }] }))
    const raw = engine.exportState() as unknown as { runtime: { enemies: Record<string, unknown>[] } }
    delete raw.runtime.enemies[0]!['guard']
    const fresh = new Engine(level({ enemies: [{ col: 4, row: STAND_ROW, kind: 'dragon' }] }))
    expect(fresh.restoreState(raw)).toBe(true)
    expect(fresh.enemies[0]!.guard).toBe(4)   // the dragon's own GUARD default

    const raw2 = engine.exportState() as unknown as { runtime: { enemies: Record<string, unknown>[] } }
    raw2.runtime.enemies[0]!['guard'] = 9999
    expect(new Engine(level({ enemies: [{ col: 4, row: STAND_ROW, kind: 'dragon' }] })).restoreState(raw2)).toBe(false)
  })

  it('a live Hush never appears in any snapshot, and is re-detected fresh the very next tick', () => {
    const engine = withStand({ enemies: [{ col: 4, row: STAND_ROW, kind: 'goblin' }] })
    placeFoeNear(engine, 0, 40, 0)
    engine.update(0)
    expect(engine.battle).not.toBeNull()
    const raw = JSON.parse(JSON.stringify(engine.exportState())) as Record<string, unknown>
    expect(JSON.stringify(raw)).not.toContain('"battle"')
    const fresh = new Engine(level({ enemies: [{ col: 4, row: STAND_ROW, kind: 'goblin' }] }))
    expect(fresh.restoreState(raw)).toBe(true)
    expect(fresh.battle).toBeNull()
    fresh.kit.push('stand')
    placeFoeNear(fresh, 0, 40, 0)
    fresh.update(0)
    expect(fresh.battle).not.toBeNull()
  })
})

describe('CombatSkillId / COMBAT_SKILLS / SKILL_NAMES', () => {
  it('names exactly the six skills, each with a display name', () => {
    const expected: readonly CombatSkillId[] = ['stand', 'ward', 'sickle', 'ember', 'sling', 'hold']
    expect(COMBAT_SKILLS).toEqual(expected)
    for (const id of COMBAT_SKILLS) expect(typeof SKILL_NAMES[id]).toBe('string')
  })
})
