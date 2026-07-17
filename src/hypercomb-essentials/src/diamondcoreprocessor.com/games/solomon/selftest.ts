// diamondcoreprocessor.com/games/solomon/selftest.ts
//
// Headless engine verification — no DOM, pure sim, fixed steps. Run from
// hypercomb-essentials/:
//
//   npx tsx src/diamondcoreprocessor.com/games/solomon/selftest.ts
//
// Part A pins the MOVEMENT invariants the block puzzles depend on (jump reach,
// the apex-conjure trick, step-up) alongside the modern-feel features (variable
// jump height, coyote time, jump buffering, momentum, determinism). Imported by
// nothing — the entry-based module build never ships it.

import { Engine, TILE, EMPTY, BRICK, SIM_DT, type Enemy, type EnemyState } from './engine.js'
import { fromAscii, BUILTIN_LEVELS, PRINCESS_ROOM, SEAL_TOTAL, sanitizeLevel } from './levels.js'

let failures = 0
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ok  ${name}`); return }
  failures++
  console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`)
}

/** Advance the sim by `seconds` in exact SIM_DT steps (the overlay's contract). */
function step(e: Engine, seconds: number): void {
  const n = Math.round(seconds / SIM_DT)
  for (let i = 0; i < n; i++) e.update(SIM_DT)
}

function feet(e: Engine): number { return e.player.y + e.player.h }

// A flat run/jump room. Door parked in the top-left corner, out of every path.
function flatRoom(): Engine {
  return new Engine(fromAscii('flat', [
    '####################',
    '#D.................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#.......P..........#',
    '####################',
  ]))
}

// A raised platform `tall` blocks high on the right; Dana starts on the floor.
function platformRoom(tall: 2 | 3): Engine {
  const art = tall === 2 ? [
    '##################',
    '#D...............#',
    '#................#',
    '#................#',
    '#........#########',
    '#P.......#########',
    '##################',
  ] : [
    '##################',
    '#D...............#',
    '#................#',
    '#........#########',
    '#........#########',
    '#P.......#########',
    '##################',
  ]
  return new Engine(fromAscii(`platform${tall}`, art))
}

// A left-side ledge over a lower floor — walk right off the edge to fall.
function ledgeRoom(): Engine {
  return new Engine(fromAscii('ledge', [
    '##############',
    '#D...........#',
    '#P...........#',
    '#####........#',
    '#............#',
    '#............#',
    '##############',
  ]))
}

// ── Part A: movement ─────────────────────────────────────────

function testJumpArc(): void {
  const e = flatRoom()
  step(e, 0.2)                       // settle onto the floor
  const startFeet = feet(e)
  e.input.jump = true
  let minFeet = startFeet
  for (let i = 0; i < Math.round(1.2 / SIM_DT); i++) { e.update(SIM_DT); minFeet = Math.min(minFeet, feet(e)) }
  const rise = (startFeet - minFeet) / TILE
  check('full jump apex ≈ 2.25 tiles', rise >= 2.15 && rise <= 2.35, `rise=${rise.toFixed(3)} tiles`)
}

function testJumpCut(): void {
  const e = flatRoom()
  step(e, 0.2)
  const startFeet = feet(e)
  e.input.jump = true
  for (let i = 0; i < 3; i++) e.update(SIM_DT)   // 3-frame tap
  e.input.jump = false
  let minFeet = startFeet
  for (let i = 0; i < Math.round(1.0 / SIM_DT); i++) { e.update(SIM_DT); minFeet = Math.min(minFeet, feet(e)) }
  const tapRise = (startFeet - minFeet) / TILE
  check('tapped jump is short', tapRise >= 0.4 && tapRise <= 1.2, `rise=${tapRise.toFixed(3)} tiles`)
  check('held vs tapped differ > 1 tile', 2.15 - tapRise > 1, `tap=${tapRise.toFixed(3)}`)
}

function testCoyote(): void {
  // Walk off the ledge; jump 0.06s after the ground drops → still takes off.
  const run = (pressDelay: number): { jumped: boolean } => {
    const e = ledgeRoom()
    step(e, 0.2)
    e.input.right = true
    // walk until airborne
    let guard = Math.round(3 / SIM_DT)
    while (e.onGround && guard-- > 0) e.update(SIM_DT)
    check('walked off the ledge', !e.onGround)
    e.input.right = false
    step(e, pressDelay)
    e.input.jump = true
    // a coyote takeoff flips vy negative within a step or two
    let jumped = false
    for (let i = 0; i < 3; i++) { e.update(SIM_DT); if (e.player.vy < -250) jumped = true }
    return { jumped }
  }
  check('coyote jump at 0.06s works', run(0.06).jumped)
  check('no mid-air jump at 0.15s', !run(0.15).jumped)
}

function testJumpBuffer(): void {
  // Dry-run the fall to find the landing step, then press ~0.08s early.
  const fall = (): Engine => {
    const e = ledgeRoom()
    step(e, 0.2)
    e.input.right = true
    let guard = Math.round(3 / SIM_DT)
    while (e.onGround && guard-- > 0) e.update(SIM_DT)
    e.input.right = false
    return e
  }
  let probe = fall()
  let stepsToLand = 0
  while (!probe.onGround && stepsToLand < 600) { probe.update(SIM_DT); stepsToLand++ }
  check('fall lands', probe.onGround)

  const e = fall()
  const early = Math.round(0.08 / SIM_DT)
  for (let i = 0; i < stepsToLand - early; i++) e.update(SIM_DT)
  const flashBefore = e.jumpFlash
  e.input.jump = true
  let launched = -1
  for (let i = 0; i <= early + 2; i++) {
    e.update(SIM_DT)
    if (launched < 0 && e.jumpFlash > flashBefore) launched = i
  }
  check('buffered press fires on landing', launched >= 0 && e.player.vy < 0, `launched@+${launched}`)
}

function testApexConjure(): void {
  // Rise, cast when the foot row first climbs one row, drift right, land ON the
  // conjured brick — the signature staircase-in-the-air trick.
  const e = flatRoom()
  step(e, 0.2)
  const startRow = Math.floor((feet(e) - 1) / TILE)
  e.input.jump = true
  let cast = false
  let castCol = -1
  const castRow = startRow - 1
  for (let i = 0; i < Math.round(2.5 / SIM_DT); i++) {
    e.update(SIM_DT)
    if (!cast && e.player.vy < 0 && Math.floor((feet(e) - 1) / TILE) === castRow) {
      const t = e.targetCell()
      const r = e.cast()
      cast = true
      castCol = t.col
      check('mid-air cast conjures', r === 'conjure', `got ${r}`)
      e.input.right = true   // drift onto the new block
    }
    if (cast && e.onGround) break
  }
  check('conjured brick exists', cast && e.tileAt(castCol, castRow) === BRICK)
  check('landed on the conjured brick', e.onGround && Math.abs(feet(e) - castRow * TILE) < 0.5,
    `feet=${feet(e).toFixed(1)} want ${castRow * TILE}`)
}

function testWandTargeting(): void {
  // The airborne cast obeys intent, not pixels: every rising tick targets one
  // row above the takeoff row (jump+cast on the same frame reaches the brick
  // overhead), the apex hang can never aim TWO rows up, and only after falling
  // below the takeoff row does the target track the feet again.

  // 2-high wall: dispel the lower brick standing, the upper brick on frame 1 of a jump.
  const wall = () => new Engine(fromAscii('wall', [
    '##################',
    '#D...............#',
    '#................#',
    '#................#',
    '#.....B..........#',
    '#....PB..........#',
    '##################',
  ]))
  let e = wall()
  step(e, 0.2)
  check('standing cast dispels the brick at body level', e.cast() === 'dispel' && e.tileAt(6, 5) === EMPTY)
  e.input.jump = true
  e.update(SIM_DT)
  check('first rising tick targets the brick overhead', e.targetCell().row === 4 && !e.onGround)
  check('jump-cast dispels the brick overhead', e.cast() === 'dispel' && e.tileAt(6, 4) === EMPTY)

  // The whole arc: never two-up, and the upper row owns the meat of the jump.
  e = wall()
  step(e, 0.2)
  e.cast()
  e.input.jump = true
  let upper = 0, twoUp = 0
  for (let i = 0; i < 140; i++) {
    e.update(SIM_DT)
    const r = e.targetCell().row
    if (r === 4) upper++
    if (r <= 3) twoUp++
    if (e.onGround && i > 5) break
  }
  check('apex never aims two rows up (no stray mid-air block)', twoUp === 0, `${twoUp} ticks`)
  check('upper row holds through the arc (≥0.5s)', upper * SIM_DT >= 0.5, `${(upper * SIM_DT).toFixed(3)}s`)

  // Tight ceiling (one free row): the whole rise still offers the upper cell.
  const ceil = new Engine(fromAscii('ceil', [
    '##################',
    '#................#',
    '#..D.P...........#',
    '##################',
  ]))
  step(ceil, 0.2)
  ceil.input.jump = true
  let hits = 0
  for (let i = 0; i < 60; i++) {
    ceil.update(SIM_DT)
    if (ceil.targetCell().row === 1) hits++
    if (ceil.onGround && i > 5) break
  }
  check('low-ceiling hop offers the head-height cell (≥0.15s)', hits * SIM_DT >= 0.15, `${(hits * SIM_DT).toFixed(3)}s`)
  ceil.input.jump = false
  step(ceil, 0.3)
  ceil.input.jump = true
  ceil.update(SIM_DT)
  check('low-ceiling jump-cast conjures the upper block', ceil.cast() === 'conjure' && ceil.tileAt(6, 1) === BRICK)

  // Walk-off fall: the target tracks the feet down (the rescue-cast), no pin.
  const ledge = new Engine(fromAscii('ledge', [
    '##################',
    '#D...............#',
    '#....P...........#',
    '#..####..........#',
    '#................#',
    '#................#',
    '##################',
  ]))
  step(ledge, 0.2)
  ledge.input.right = true
  const rows: number[] = []
  let flew = false
  for (let i = 0; i < 200; i++) {
    ledge.update(SIM_DT)
    if (!ledge.onGround) { flew = true; rows.push(ledge.targetCell().row) }
    if (flew && ledge.onGround) break
  }
  const descends = rows.length > 0 && rows.every((r, i) => i === 0 || r >= rows[i - 1])
  check('walk-off fall tracks the feet down through the drop', flew && descends && rows[0] === 2 && rows[rows.length - 1] >= 4,
    `rows ${rows.join(',')}`)
}

function testLedgeReach(): void {
  // Pulse-jump rightward: a 2-tall platform is mountable, a 3-tall is not.
  const attempt = (tall: 2 | 3): number => {
    const e = platformRoom(tall)
    step(e, 0.2)
    e.input.right = true
    let minFeet = feet(e)
    // hold through the whole rise (a shorter hold would jump-cut the arc)
    const pulse = Math.round(0.45 / SIM_DT), rest = Math.round(0.25 / SIM_DT)
    for (let cycle = 0; cycle < 10; cycle++) {
      e.input.jump = true
      for (let i = 0; i < pulse; i++) { e.update(SIM_DT); minFeet = Math.min(minFeet, e.onGround ? feet(e) : minFeet) }
      e.input.jump = false
      for (let i = 0; i < rest; i++) { e.update(SIM_DT); minFeet = Math.min(minFeet, e.onGround ? feet(e) : minFeet) }
    }
    return minFeet   // lowest GROUNDED feet height reached
  }
  check('2-tile ledge mountable', attempt(2) <= 4 * TILE + 0.5, `minFeet=${attempt(2)}`)
  check('3-tile ledge NOT mountable', attempt(3) > 3 * TILE + 0.5, `minFeet=${attempt(3)}`)
}

function testMomentum(): void {
  const e = flatRoom()
  step(e, 0.2)
  e.input.right = true
  let toFull = -1
  for (let i = 0; i < Math.round(0.3 / SIM_DT); i++) { e.update(SIM_DT); if (toFull < 0 && e.player.vx >= 104.5) { toFull = (i + 1) * SIM_DT; break } }
  check('reaches full speed ≤ 0.12s', toFull > 0 && toFull <= 0.12, `t=${toFull.toFixed(3)}`)
  step(e, 0.3)
  e.input.right = false
  let toStop = -1
  for (let i = 0; i < Math.round(0.2 / SIM_DT); i++) { e.update(SIM_DT); if (toStop < 0 && Math.abs(e.player.vx) < 0.5) { toStop = (i + 1) * SIM_DT; break } }
  check('stops ≤ 0.09s after release', toStop > 0 && toStop <= 0.09, `t=${toStop.toFixed(3)}`)

  // skid state on reversal
  e.input.right = true
  step(e, 0.3)
  e.input.right = false
  e.input.left = true
  let skidded = false
  for (let i = 0; i < 6; i++) { e.update(SIM_DT); if (e.playerAnim === 'skid') skidded = true }
  check('skid anim on reversal', skidded)
}

function testStepUp(): void {
  // A 1-tile step is climbed by walking alone (the auto step-up).
  const e = new Engine(fromAscii('step', [
    '##############',
    '#D...........#',
    '#............#',
    '#............#',
    '#............#',
    '#P......######',
    '##############',
  ]))
  step(e, 0.2)
  e.input.right = true
  step(e, 3)
  check('auto step-up climbs a 1-tile step', e.onGround && Math.abs(feet(e) - 5 * TILE) < 0.5 && e.player.x > 8.5 * TILE,
    `feet=${feet(e).toFixed(1)} x=${e.player.x.toFixed(1)}`)
}

function testDeterminism(): void {
  const script = (e: Engine): number[] => {
    const trace: number[] = []
    step(e, 0.2)
    e.input.right = true
    step(e, 0.4)
    e.input.jump = true
    step(e, 0.2)
    e.input.jump = false
    step(e, 0.3)
    e.input.right = false
    e.input.left = true
    step(e, 0.5)
    trace.push(e.player.x, e.player.y, e.player.vx, e.player.vy)
    return trace
  }
  const a = script(flatRoom())
  const b = script(flatRoom())
  check('bit-identical determinism', a.every((v, i) => Object.is(v, b[i])), `${a} vs ${b}`)
}

// ── Part B: enemy state machines ─────────────────────────────

/** Step until `pred` is true (or the time budget runs out). Returns seconds
 *  elapsed, or -1 on timeout. Samples AFTER each update. */
function until(e: Engine, seconds: number, pred: () => boolean): number {
  const n = Math.round(seconds / SIM_DT)
  for (let i = 0; i < n; i++) { e.update(SIM_DT); if (pred()) return (i + 1) * SIM_DT }
  return -1
}

function foe(e: Engine, kind: string): Enemy {
  const f = e.enemies.find(en => en.kind === kind)
  if (!f) throw new Error(`no ${kind} in room`)
  return f
}

function testGoblinCharge(): void {
  const e = new Engine(fromAscii('goblinCharge', [
    '##################',
    '#D...............#',
    '#................#',
    '#....g......P....#',
    '#########..#######',
    '#................#',
    '#................#',
    '##################',
  ]))
  const g = foe(e, 'goblin')
  const seen = new Set<EnemyState>()
  let telegraphRamped = false
  let chargeSpeed = 0
  let prevX = g.x
  const t = until(e, 6, () => {
    seen.add(g.state)
    if (g.state === 'windup' && g.telegraph > 0.5) telegraphRamped = true
    if (g.state === 'attack') chargeSpeed = Math.max(chargeSpeed, Math.abs(g.x - prevX) / SIM_DT)
    prevX = g.x
    return !g.alive
  })
  check('goblin chases → telegraphs → charges', seen.has('chase') && seen.has('windup') && seen.has('attack'),
    [...seen].join(','))
  check('goblin windup telegraph ramps', telegraphRamped)
  check('goblin charge is 1.6×', chargeSpeed > 62 * 1.5 && chargeSpeed < 62 * 1.7, `v=${chargeSpeed.toFixed(1)}`)
  check('goblin charges off the ledge and drop-dies', t > 0 && e.killCause === 'drop')
}

function testGoblinCrush(): void {
  const e = new Engine(fromAscii('goblinCrush', [
    '############',
    '#D.........#',
    '#..........#',
    '#..........#',
    '#..........#',
    '#...Pg.....#',
    '############',
  ]))
  e.update(SIM_DT)
  const score0 = e.score
  e.facing = 1
  const r = e.cast()
  check('crush cast conjures', r === 'conjure', r)
  check('goblin crushed', e.killFlash === 1 && e.killCause === 'crush' && !foe(e, 'goblin').alive)
  check('crush scores', e.score === score0 + 200, `${e.score - score0}`)
}

function testGargoil(): void {
  // scan-pause at a ledge (Dana far below — never triggers a shot)
  const scanRoom = new Engine(fromAscii('gargoilScan', [
    '################',
    '#D.............#',
    '#r.............#',
    '#####..........#',
    '#............P.#',
    '################',
  ]))
  const r1 = foe(scanRoom, 'gargoil')
  let scanned = false
  let dirBefore: number = r1.dir
  const flipped = until(scanRoom, 4, () => {
    if (r1.state === 'scan') { scanned = true; dirBefore = r1.dir }
    return scanned && r1.state === 'patrol' && r1.dir !== dirBefore
  })
  check('gargoil scans at the edge, then flips', scanned && flipped > 0)

  // telegraphed shot on the same row
  const e = new Engine(fromAscii('gargoilShot', [
    '################',
    '#D.............#',
    '#..............#',
    '#..r......P....#',
    '################',
  ]))
  const r2 = foe(e, 'gargoil')
  let ramp = false
  const fired = until(e, 2.2, () => {
    if (r2.state === 'windup' && r2.telegraph > 0.5) ramp = true
    return e.shotFlash > 0
  })
  check('gargoil telegraphs then fires', fired > 0 && ramp && e.shots.length === 1)
}

function testDragon(): void {
  // burst: 3 shots, ~0.16s apart
  const e = new Engine(fromAscii('dragonBurst', [
    '##################',
    '#D...............#',
    '#................#',
    '#..a.........P...#',
    '##################',
  ]))
  const times: number[] = []
  let prevShots = 0
  let t = 0
  until(e, 3.4, () => {
    t += SIM_DT
    if (e.shotFlash > prevShots) { times.push(t); prevShots = e.shotFlash }
    return times.length >= 3
  })
  const gapsOk = times.length === 3
    && Math.abs((times[1] - times[0]) - 0.16) < 0.04
    && Math.abs((times[2] - times[1]) - 0.16) < 0.04
  check('dragon fires a 3-shot burst at 0.16s gaps', gapsOk, times.map(x => x.toFixed(2)).join(','))

  // ledge refusal while hunting
  const led = new Engine(fromAscii('dragonLedge', [
    '################',
    '#D.............#',
    '#a.............#',
    '#####..........#',
    '#...........P..#',
    '################',
  ]))
  const d = foe(led, 'dragon')
  until(led, 3, () => false)
  check('dragon refuses the ledge', d.alive && d.x < 5 * TILE, `x=${d.x.toFixed(1)}`)
}

function testSaramandor(): void {
  const e = new Engine(fromAscii('saramandor', [
    '##################',
    '#D...............#',
    '#................#',
    '#....s......P....#',
    '##################',
  ]))
  const s = foe(e, 'saramandor')
  const fired = until(e, 2.4, () => e.shotFlash > 0)
  check('saramandor fires', fired > 0)
  let fled = false
  const xAtShot = s.x
  until(e, 0.6, () => { if (s.state === 'flee' && s.x < xAtShot - 4) fled = true; return fled })
  check('saramandor flees away after firing', fled && s.dir === -1)
}

function testGhost(): void {
  const e = new Engine(fromAscii('ghost', [
    '################',
    '#D.............#',
    '#..............#',
    '#h....B....P...#',
    '################',
  ]))
  const h = foe(e, 'ghost')
  let hunted = false
  const smashed = until(e, 4, () => {
    if (h.state === 'hunt') hunted = true
    return e.smashCell !== null && e.tileAt(6, 3) === EMPTY
  })
  check('ghost hunts on its row', hunted)
  check('ghost smashes the brick', smashed > 0 && e.smashCell?.col === 6)
  check('ghost stun state entered', h.state === 'stun')
  const xAfter = h.x
  let moved = false
  until(e, 0.3, () => { if (h.state === 'stun' && Math.abs(h.x - xAfter) > 0.5) moved = true; return false })
  check('ghost is frozen while stunned', !moved)
}

function testNeul(): void {
  const e = new Engine(fromAscii('neul', [
    '############',
    '#D.........#',
    '#..........#',
    '#l.B..P....#',
    '############',
  ]))
  const l = foe(e, 'neul')
  let brickIntactUntilSwoop = true
  let sawWindup = false
  const swooped = until(e, 4, () => {
    if (l.state !== 'swoop' && l.state !== 'rise' && e.tileAt(3, 3) === EMPTY) brickIntactUntilSwoop = false
    if (l.state === 'windup' && l.telegraph > 0.5) sawWindup = true
    return l.state === 'swoop'
  })
  check('neul aligns without smashing, then telegraphs a swoop', swooped > 0 && sawWindup && brickIntactUntilSwoop)
  check('neul swoop vector is locked toward Dana', Math.abs(Math.hypot(l.lockX, l.lockY) - 1) < 1e-6 && l.lockX > 0)
  const smashed = until(e, 1.2, () => e.tileAt(3, 3) === EMPTY)
  check('neul smashes bricks during the swoop', smashed > 0)
}

function testSparkball(): void {
  const e = new Engine(fromAscii('sparkball', [
    '##########',
    '#........#',
    '#...k....#',
    '#........#',
    '#BB......#',
    '#PB......#',
    '##########',
  ]))
  const k = foe(e, 'sparkball')
  const baseVx = Math.abs(k.vx), baseVy = Math.abs(k.vy)
  let sawWindup = false
  const supered = until(e, 20, () => {
    if (k.state === 'windup') sawWindup = true
    return k.state === 'attack'
  })
  check('sparkball supercharges after its bounce quota', supered > 0 && sawWindup && k.bounces >= 6)
  check('supercharge is 1.6×', Math.abs(Math.abs(k.vx) - baseVx * 1.6) < 1e-9 && Math.abs(Math.abs(k.vy) - baseVy * 1.6) < 1e-9)
  const reverted = until(e, 3, () => k.state === 'patrol')
  check('sparkball renormalizes EXACTLY to base', reverted > 0
    && Math.abs(k.vx) === baseVx && Math.abs(k.vy) === baseVy && k.bounces < 6)
}

function testDemonheadAndMirror(): void {
  const e = new Engine(fromAscii('mirror', [
    '##############',
    '#............#',
    '#....M.......#',
    '#............#',
    '#BB..........#',
    '#PB..........#',
    '##############',
  ]))
  // mirror telegraph ramps, then a spawn pops
  const m = e.mirrors[0]
  let ramped = false
  const spawned = until(e, 2, () => {
    if (m.telegraph > 0.5 && e.spawnFlash === 0) ramped = true
    return e.spawnFlash > 0
  })
  check('mirror telegraphs then emits', spawned > 0 && ramped && e.spawnCell?.col === 5)
  const first = e.enemies[e.enemies.length - 1]
  const dir1 = first.dir
  until(e, 2.5, () => e.spawnFlash > 1)
  const second = e.enemies[e.enemies.length - 1]
  check('mirror alternates emission direction', second.dir === -dir1)

  // demonhead cycles drift → windup → dart, and expiry scores nothing
  const seen = new Set<EnemyState>()
  const scoreBefore = e.score
  const expired = until(e, 9, () => {
    seen.add(first.state)
    return !first.alive
  })
  check('demonhead cycles drift/windup/dart', seen.has('drift') && seen.has('windup') && seen.has('dart'),
    [...seen].join(','))
  check('demonhead expiry scores nothing', expired > 0 && e.killCause === 'expire' && e.score === scoreBefore)
  // cap: never more than 3 live spawns
  let maxLive = 0
  until(e, 6, () => {
    maxLive = Math.max(maxLive, e.enemies.filter(x => x.alive && x.kind === 'demonhead').length)
    return false
  })
  check('mirror honors the 3-live cap', maxLive <= 3 && maxLive >= 2, `max=${maxLive}`)
}

function testPanel(): void {
  const e = new Engine(fromAscii('panel', [
    '##############',
    '#D...........#',
    '#............#',
    '#..P......n..#',
    '##############',
  ]))
  const n = foe(e, 'panel')
  // a fireball sails straight through the invulnerable panel
  e.addAmmo(false)
  e.update(SIM_DT)
  e.facing = 1
  e.fireball()
  let passed = false
  until(e, 1.4, () => {
    if (e.fireballs.some(f => f.x > (n.x + n.w + 4))) passed = true
    return passed
  })
  check('fireball passes through the panel', passed && n.alive)
  // telegraph ramps before each shot
  let ramp = false
  const fired = until(e, 2.6, () => {
    if (n.state === 'windup' && n.telegraph > 0.5) ramp = true
    return e.shotFlash > 0
  })
  check('panel telegraphs before firing', fired > 0 && ramp)
}

function testSecrets(): void {
  const level = fromAscii('secrets', [
    '##############',
    '#D...........#',
    '#............#',
    '#..P.........#',
    '##############',
  ], { hidden: [{ col: 8, row: 3, kind: 'jar' }] })
  level.items.push({ col: 5, row: 3, kind: 'jewel', hidden: true, secret: true })
  const e = new Engine(level)
  e.update(SIM_DT)
  e.facing = 1
  // walk next to the secret cell: teleport Dana so his wand targets (5,3)
  e.player.x = 4 * TILE + (TILE - e.player.w) / 2
  const r = e.cast()
  const secretItem = e.items.find(i => i.secret)!
  check('wand reveals the secret (no brick conjured)', r === 'conjure' && e.tileAt(5, 3) === EMPTY
    && !secretItem.hidden && e.secretFlash === 1 && e.secretCell?.col === 5)
  // dispel the hidden-item brick → revealFlash
  e.player.x = 7 * TILE + (TILE - e.player.w) / 2
  const r2 = e.cast()
  const hiddenItem = e.items.find(i => i.kind === 'jar')!
  check('breaking the brick uncovers the hidden item', r2 === 'dispel' && !hiddenItem.hidden
    && e.revealFlash === 1 && e.revealCell?.col === 8)
}

// The flat 14-wide corridor the secret-mechanic tests share.
function secretRoom(): ReturnType<typeof fromAscii> {
  return fromAscii('secret-room', [
    '##############',
    '#D...........#',
    '#............#',
    '#..P.........#',
    '##############',
  ])
}

function testDeepSecret(): void {
  const level = secretRoom()
  level.items.push({ col: 5, row: 3, kind: 'treasure', hidden: true, secret: true, deep: true })
  const e = new Engine(level)
  e.update(SIM_DT)
  e.facing = 1
  e.player.x = 4 * TILE + (TILE - e.player.w) / 2   // wand targets (5,3)
  const r1 = e.cast()
  const it = e.items.find(i => i.secret)!
  check('deep secret: the first cast walls it in, still asleep', r1 === 'conjure'
    && e.tileAt(5, 3) === BRICK && it.hidden === true && e.secretFlash === 0)
  check('deep secret: the wand hums hot at distance zero', e.resonanceFlash === 1 && e.resonanceHot)
  const r2 = e.cast()
  check('deep secret: breaking the brick pays out as a SECRET', r2 === 'dispel'
    && !it.hidden && e.secretFlash === 1 && e.revealFlash === 0 && e.secretCell?.col === 5)
}

function testResonance(): void {
  const level = secretRoom()
  level.items.push({ col: 5, row: 3, kind: 'jewel', hidden: true, secret: true })
  const e = new Engine(level)
  e.update(SIM_DT)
  e.facing = -1
  e.player.x = 10 * TILE + (TILE - e.player.w) / 2   // casts (9,3): four cells out
  e.cast()
  check('a cast far from any secret stays silent', e.resonanceFlash === 0)
  e.player.x = 8 * TILE + (TILE - e.player.w) / 2    // casts (7,3): two cells out
  e.cast()
  check('two cells out: the wand hums cold', e.resonanceFlash === 1 && !e.resonanceHot)
  e.player.x = 7 * TILE + (TILE - e.player.w) / 2    // casts (6,3): one cell out
  e.cast()
  check('one cell out: the wand hums hot', e.resonanceFlash === 2 && e.resonanceHot)
}

function testFairyDowsing(): void {
  const level = secretRoom()
  level.items.push({ col: 10, row: 3, kind: 'jewel', hidden: true, secret: true })
  const e = new Engine(level)
  e.fairies.push({ x: 12.5 * TILE, y: 1.5 * TILE, phase: 0, taken: false })
  const f = e.fairies[0]
  const sx = 10.5 * TILE, sy = 3.5 * TILE
  const d0 = Math.hypot(f.x - sx, f.y - sy)
  step(e, 4)
  const d1 = Math.hypot(f.x - sx, f.y - sy)
  check('a freed fairy drifts in to circle the sleeping secret', d1 < d0 && d1 < TILE * 2.2,
    `d0=${d0.toFixed(0)} d1=${d1.toFixed(0)}`)
  // she circles the neighbourhood — never settling on the cell, never leaving it
  let sum = 0
  for (let i = 0; i < 240; i++) { e.update(SIM_DT); sum += Math.hypot(f.x - sx, f.y - sy) }
  const avgD = sum / 240
  check('the fairy orbits nearby without parking on the cell', avgD > TILE * 0.5 && avgD < TILE * 2,
    `avg=${avgD.toFixed(0)}`)
}

// ── Part C: built-in levels + sanitize round-trip ────────────

function testLevelSweep(): void {
  const WALKER = new Set(['goblin', 'gargoil', 'dragon', 'saramandor'])
  let sweepFails = 0
  const sweep = (name: string, cond: boolean, what: string): void => {
    if (!cond) { sweepFails++; failures++; console.error(`FAIL  [${name}] ${what}`) }
  }
  for (const l of BUILTIN_LEVELS) {
    const at = (c: number, r: number) => l.tiles[r * l.cols + c]
    sweep(l.name, l.items.some(i => i.kind === 'key'), 'has no key')
    sweep(l.name, at(l.player.col, l.player.row) === EMPTY && at(l.door.col, l.door.row) === EMPTY, 'player/door embedded')
    sweep(l.name, l.enemies.every(e => !WALKER.has(e.kind ?? 'goblin') || e.col >= 11), 'walker inside the safe zone')
    sweep(l.name, l.items.every(i => i.hidden ? true : at(i.col, i.row) === EMPTY), 'visible item embedded')
    sweep(l.name, l.items.filter(i => i.hidden && !i.secret).every(i => at(i.col, i.row) === BRICK), 'hidden item not sealed in brick')
    sweep(l.name, l.items.filter(i => i.secret).every(i => at(i.col, i.row) === EMPTY), 'secret not in an empty cell')
    sweep(l.name, l.items.some(i => i.secret), 'no wand-secret at all')
    sweep(l.name, l.items.filter(i => i.hidden).length >= 2, 'fewer than 2 buried finds')
    sweep(l.name, l.enemies.every(e => at(e.col, e.row) === EMPTY), 'enemy embedded in stone')
  }
  check('all 19 built-ins pass the sweep', sweepFails === 0, `${sweepFails} problems`)
  check('the curve densifies toward Cancer', BUILTIN_LEVELS[0].enemies.length < BUILTIN_LEVELS[16].enemies.length)
  check('4 seals exist (one wand-only)', SEAL_TOTAL === 4, `total=${SEAL_TOTAL}`)
  const deepRooms = BUILTIN_LEVELS.filter(l => l.items.some(i => i.secret && i.deep)).length
  check('deep finds thread the campaign (but not the tutorial)', deepRooms >= 6
    && !BUILTIN_LEVELS[0].items.some(i => i.deep), `deepRooms=${deepRooms}`)
  check('the wand-only seal hides deep', BUILTIN_LEVELS.some(l =>
    l.items.some(i => i.kind === 'seal' && i.secret && i.deep)))
}

function testSanitizeRoundTrip(): void {
  let bad = 0
  for (const l of [...BUILTIN_LEVELS, PRINCESS_ROOM]) {
    const rt = sanitizeLevel(JSON.parse(JSON.stringify(l)))
    const ok = rt !== null
      && rt.items.length === l.items.length
      && rt.items.every((it, i) => !!it.secret === !!l.items[i].secret && !!it.hidden === !!l.items[i].hidden && !!it.deep === !!l.items[i].deep && it.kind === l.items[i].kind)
    if (!ok) { bad++; console.error(`FAIL  [${l.name}] round-trip mangled`) }
  }
  failures += bad
  check('sanitize round-trips every level with secrets intact', bad === 0)
}

// ── runner ───────────────────────────────────────────────────

console.log('Solomon selftest — part A: movement')
testJumpArc()
testJumpCut()
testCoyote()
testJumpBuffer()
testApexConjure()
testWandTargeting()
testLedgeReach()
testMomentum()
testStepUp()
testDeterminism()

console.log('Solomon selftest — part B: enemies + secrets')
testGoblinCharge()
testGoblinCrush()
testGargoil()
testDragon()
testSaramandor()
testGhost()
testNeul()
testSparkball()
testDemonheadAndMirror()
testPanel()
testSecrets()
testDeepSecret()
testResonance()
testFairyDowsing()

console.log('Solomon selftest — part C: levels')
testLevelSweep()
testSanitizeRoundTrip()

if (failures > 0) throw new Error(`${failures} selftest failure(s)`)
console.log('all green')
