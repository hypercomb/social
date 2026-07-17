// diamondcoreprocessor.com/games/bubble/selftest.ts
//
// Headless engine verification — no DOM, pure sim, fixed steps. Run from
// hypercomb-essentials/:
//
//   npx tsx src/diamondcoreprocessor.com/games/bubble/selftest.ts
//
// Pins the arcade dynamics (jump-height ratio, shot ballistics, trap-only-
// while-shooting, SOLID floating foam, cascade pops, crown bounce), the EXTEND
// letter word, the entire Super Drunk machine, and an integrity gate over every
// built-in round. Imported by nothing — the entry-based module build never
// ships it (build-module/prepare exclude selftest files from bundles).

import {
  Engine, TILE, WALL, EXTEND_WORD, UMBRELLA_META,
  type Bubble, type LevelDef, type Umbrella,
} from './engine.js'
import { fromAscii, BUILTIN_LEVELS, DIAMOND_ROOM, BOSS_ROOM, cloneLevel, sanitizeLevel } from './levels.js'
import { THEME_COUNT } from './renderer.js'

const DT = 1 / 120   // the overlay's physics step

let failures = 0
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ok  ${name}`); return }
  failures++
  console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`)
}

/** Advance `seconds` in exact DT steps; `each` runs after every update (strip
 *  random drifters, keep invulnerability topped, record traces, …). */
function step(e: Engine, seconds: number, each?: (e: Engine) => void): void {
  const n = Math.round(seconds / DT)
  for (let i = 0; i < n; i++) { e.update(DT); each?.(e) }
}

/** Strip everything that enters on a random clock, so a long-running check
 *  stays deterministic (drifting elementals, letter deals, umbrella drops). */
function mundane(e: Engine): void {
  e.bubbles = e.bubbles.filter(b => !b.special && b.letter === null)
  e.umbrellas = []
  e.warp = 0
}

/** A hand-placed floating bubble with every required field. */
function floatAt(x: number, y: number, r = TILE * 0.84): Bubble {
  return {
    x, y, vx: 0, vy: 0, phase: 'float', age: 1, life: 9, r,
    enemy: null, popped: false, squash: 0, slide: 1, special: null,
    cling: null, letter: null,
  }
}

function feet(e: Engine): number { return e.player.y + e.player.h }

// A small flat room — floor only, no foes (a foe-less room never auto-wins).
function flatRoom(): Engine {
  return new Engine(fromAscii('flat', [
    '', '', '', '', '', '', '', '', '', '',
    '.P',
    '####################',
  ]))
}

// A left ledge over a lower floor — walk right off the edge to fall.
function ledgeRoom(): Engine {
  return new Engine(fromAscii('ledge', [
    '', '', '', '',
    '.P',
    '#####',
    '', '', '', '', '',
    '####################',
  ]))
}

// A wide shelf (cols 4-31) over the floor — the solid-float gauntlet: foam
// blown beneath must gather, slide out the NEARER open flank and rise around.
function shelfRoom(): Engine {
  return new Engine(fromAscii('shelf', [
    '', '', '', '', '', '', '', '', '', '',
    '....############################',
    '', '', '', '', '', '', '', '', '', '', '', '', '',
    '.P',
    '########################################',
  ]))
}

function bossEngine(): Engine { return new Engine(cloneLevel(BOSS_ROOM)) }

/** Park the player at an exact centre point (test positioning helper). */
function park(e: Engine, cx: number, cy: number): void {
  e.player.x = cx - e.player.w / 2
  e.player.y = cy - e.player.h / 2
  e.player.vx = 0
  e.player.vy = 0
}

// ── Part A: movement ─────────────────────────────────────────

function testJumpRatio(): void {
  console.log('jump-height ratio (the tier rhythm gate)')
  const e = flatRoom()
  step(e, 0.2, mundane)                    // settle onto the floor
  check('grounded before the hop', e.onGround)
  const start = feet(e)
  e.jump()
  let apex = 0
  step(e, 1.2, en => { apex = Math.max(apex, start - feet(en)); mundane(en) })
  // 4-row tiers are 60px; Bub is ~26px tall. The arcade hop *just* clears one:
  // >2× his height and under 5 rows, or the level rhythm has drifted.
  check('apex clears a 4-row tier', apex >= 62, `apex ${apex.toFixed(1)}px`)
  check('apex cannot clear a 5-row tier', apex < 75, `apex ${apex.toFixed(1)}px`)
  check('landed again', Math.abs(feet(e) - start) < 1)
  check('jump fx counted', e.fx.jump === 1)
}

function testCoyote(): void {
  console.log('coyote grace off a ledge')
  const e = ledgeRoom()
  step(e, 0.2, mundane)
  e.input.right = true
  // walk until the ledge is left behind…
  let walked = 0
  while (e.onGround && walked < 600) { e.update(DT); mundane(e); walked++ }
  check('walked off the edge', !e.onGround)
  e.update(DT)                              // one airborne frame — inside 0.09s
  e.jump()
  check('coyote jump granted just past the lip', e.player.vy < -300, `vy ${e.player.vy}`)
}

// ── Part B: bubble dynamics ──────────────────────────────────

function testShotBallistics(): void {
  console.log('shot ballistics — launch, decay, float')
  const e = flatRoom()
  step(e, 0.2, mundane)
  e.blow()
  check('blow fx counted', e.fx.blow === 1)
  const b = e.bubbles[0]
  check('launches in shoot phase', b.phase === 'shoot' && Math.abs(b.vx) > 400)
  step(e, 1.4, mundane)
  const f = e.bubbles[0]
  check('decays into a float', !!f && f.phase === 'float')
  check('a float rises', f.vy < 0 || f.y < b.y)
}

function testTrapOnlyWhileShooting(): void {
  console.log('traps only with momentum — floated foam is harmless')
  const near = new Engine(fromAscii('near', [
    '', '', '', '', '', '', '', '', '', '',
    '.P..z',
    '####################',
  ]))
  step(near, 0.05, mundane)
  near.blow()
  step(near, 0.3, mundane)
  check('a fresh shot traps the foe ahead', near.enemies[0].captured)
  check('trap fx counted', near.fx.trap === 1)

  const far = flatRoom()
  far.enemies.push({
    x: 150, y: far.height - TILE - 22, w: 21.6, h: 21.6, vx: 0, vy: 0,
    dir: -1, alive: true, captured: false, angry: false, kind: 0,
    grace: 0, bob: 0, aiTimer: 9, edgeLatch: false, throwTimer: 0,
  })
  // resting foam parked exactly on the foe — floated foam must NOT trap
  far.bubbles.push(floatAt(160, far.height - TILE - 11))
  step(far, 0.3, e => { e.bubbles.forEach(b => { b.y = far.height - TILE - 11; b.vy = 0 }); mundane(e) })
  check('floated foam never traps', !far.enemies.some(en => en.captured))
}

function testSolidFloat(): void {
  console.log('SOLID floating foam — the under-shelf tripwire')
  const e = shelfRoom()
  step(e, 0.1, mundane)
  e.blow()
  const shelfRow = 10
  let crossed = false
  let escaped = false
  step(e, 12, en => {
    mundane(en)
    for (const b of en.bubbles) {
      const col = Math.floor(b.x / TILE)
      // ghosting through = the bubble's body INTERSECTS the shelf band while
      // well inside the span. Above the shelf is fine (it went around); the
      // end tiles are excused (the resolver legitimately rounds the lip).
      const intersects = b.y - b.r < (shelfRow + 1) * TILE - 0.75
        && b.y + b.r > shelfRow * TILE + 0.75
      if (col >= 5 && col <= 30 && intersects) crossed = true
      if (b.y <= b.r + 1) escaped = true
    }
  })
  check('foam never crossed the shelf body', !crossed)
  check('foam slid out the open flank and reached the ceiling', escaped)

  // …and the one sanctioned exception: a BOSS round's updraft lifts foam
  // straight through the ledges (that's how floor shots blister him).
  const bs = bossEngine()
  bs.boss = null                       // bare arena — no hide to cling to
  bs.bubbles.push(floatAt(19.5 * TILE, 24 * TILE))
  let through = false
  step(bs, 5, en => {
    en.bubbles = en.bubbles.filter(b => !b.special)
    for (const b of en.bubbles) if (b.y < 20 * TILE) through = true
  })
  check('boss-round updraft carries foam through the pad', through)
}

function testCascadeAndCrown(): void {
  console.log('cascade pops + crown bounce')
  const e = flatRoom()
  step(e, 0.1, mundane)
  e.bubbles.push(floatAt(120, 100), floatAt(142, 100), floatAt(164, 100))
  park(e, 120, 100)
  e.update(DT)
  check('one touch bursts the whole cluster', e.bubbles.filter(b => !b.special).length === 0)
  check('pop fx counted the cascade', e.fx.pop >= 3, `pops ${e.fx.pop}`)

  const c = flatRoom()
  step(c, 0.1, mundane)
  c.bubbles.push(floatAt(150, 120))
  c.input.jump = true
  c.player.x = 150 - c.player.w / 2
  c.player.y = 112 - c.player.h        // feet at 112: touching, above the crown line
  c.player.vy = 60
  c.update(DT)
  check('crown bounce with jump held', c.player.vy <= -450, `vy ${c.player.vy}`)
  check('bounce fx counted', c.fx.bounce === 1)
}

// ── Part C: EXTEND ───────────────────────────────────────────

function testExtendLetters(): void {
  console.log('EXTEND — letters, the word, the carry')
  const e = flatRoom()
  step(e, 0.1, mundane)
  e.spawnLetter(2)
  check('a letter bubble deals', e.bubbles.some(b => b.letter === 2))
  e.spawnLetter(4)
  check('only one letter out at a time', e.bubbles.filter(b => b.letter !== null).length === 1)
  const lb = e.bubbles.find(b => b.letter !== null)!
  lb.x = e.player.x + e.player.w / 2
  lb.y = e.player.y + e.player.h / 2
  e.update(DT)
  check('touching collects the letter', e.letters[2] && e.fx.letter === 1)
  check('collecting does not end the round', e.state === 'playing')

  // a letter parked on a foe must neither trap nor be popped by it
  const f = new Engine(fromAscii('foe', [
    '', '', '', '', '', '', '', '', '', '',
    '.P........z',
    '####################',
  ]))
  step(f, 0.05, mundane)
  f.spawnLetter(0)
  const flb = f.bubbles.find(b => b.letter !== null)!
  const foe = f.enemies[0]
  flb.x = foe.x + foe.w / 2
  flb.y = foe.y + foe.h / 2
  f.update(DT)
  check('a letter never traps a foe', !foe.captured && f.bubbles.some(b => b.letter !== null))

  // slipping out the top pays nothing
  const s = flatRoom()
  s.spawnLetter(1)
  const slb = s.bubbles.find(b => b.letter !== null)!
  slb.y = -40
  s.update(DT)
  check('an escaped letter pays nothing', !s.bubbles.some(b => b.letter !== null) && s.fx.letter === 0)

  // the sixth letter: 1UP + the round ends + the word resets
  const w = flatRoom()
  step(w, 0.1, mundane)
  w.letters = [true, true, true, true, true, false]
  w.spawnLetter()
  const wlb = w.bubbles.find(b => b.letter !== null)!
  check('only the missing letter deals', wlb.letter === 5)
  wlb.x = w.player.x + w.player.w / 2
  wlb.y = w.player.y + w.player.h / 2
  const livesBefore = w.lives
  w.update(DT)
  check('EXTEND pays a 1UP', w.lives === livesBefore + 1 && w.fx.oneUp === 1)
  check('EXTEND ends the round', w.state === 'won')
  check('the word resets', w.letters.every(l => !l) && w.fx.extend === 1)

  const carry = flatRoom()
  const prev = flatRoom()
  prev.letters = [true, false, true, false, false, false]
  carry.carryLettersFrom(prev)
  check('letters carry across engines', carry.letters[0] && carry.letters[2] && !carry.letters[1])
}

// ── Part D: Super Drunk ──────────────────────────────────────

function testBossSpawn(): void {
  console.log('Super Drunk — spawn + phases')
  const e = bossEngine()
  check('he holds the screen', !!e.boss && e.boss.hp === 18 && e.boss.maxHp === 18)
  check('a boss round spawns no roster', e.enemies.length === 0)
  check('phase 0 at full health', e.bossPhase === 0)
  e.boss!.hp = 11
  check('phase 1 wounded', e.bossPhase === 1)
  e.boss!.hp = 5
  check('phase 2 in rage', e.bossPhase === 2)
}

function testBossTelegraph(): void {
  console.log('every bottle is telegraphed')
  const e = bossEngine()
  let bottles = 0
  let fullTell = false
  let untelegraphed = 0
  step(e, 22, en => {
    en.invuln = 5
    en.bubbles = en.bubbles.filter(b => !b.special)
    const b = en.boss
    // at 120Hz the last windup frame reads ~0.98 before the throw fires
    if (b && b.state === 'windup' && b.telegraph >= 0.9) fullTell = true
    if (en.fx.bottle > bottles) {
      bottles = en.fx.bottle
      if (!fullTell) untelegraphed++
      fullTell = false
    }
  })
  check('he threw bottles', bottles >= 2, `${bottles} thrown`)
  check('every throw showed the raised bottle first', untelegraphed === 0, `${untelegraphed} un-telegraphed`)
}

function testBossBallistics(): void {
  console.log('bottles land where Bub stands')
  const e = bossEngine()
  const px = 150
  e.boss!.throwTimer = 0.01
  let shatterX: number | null = null
  let shatters = 0
  step(e, 6, en => {
    en.invuln = 5
    en.bubbles = en.bubbles.filter(b => !b.special)
    park(en, px, en.height - en.player.h / 2 - 0.1)
    if (en.fx.shatter > shatters && shatterX === null) {
      shatters = en.fx.shatter
      const shard = en.shots.find(s => s.kind === 'shard' && s.age < DT * 2)
      if (shard) shatterX = shard.x
    }
  })
  // (read through a widened alias — TS can't see the closure assignments)
  const sx = shatterX as number | null
  check('a bottle broke', sx !== null)
  check('…near the parked target', sx !== null && Math.abs(sx - px) < TILE * 3.5,
    `broke at ${sx === null ? 'never' : sx.toFixed(0)} vs Bub ${px}`)
}

function testBossBlisters(): void {
  console.log('blisters cling, cascade, and chunk him')
  const e = bossEngine()
  const b = e.boss!
  b.throwTimer = 99
  b.state = 'idle'
  // three blisters around the lower rim, close enough to chain
  for (const a of [1.25, Math.PI / 2, 1.89]) {
    e.bubbles.push(floatAt(b.x + Math.cos(a) * 39, b.y + Math.sin(a) * 39))
  }
  e.update(DT)
  const clung = e.bubbles.filter(x => x.cling !== null)
  check('foam clings to his hide', clung.length === 3)
  check('a blister carries the short fuse', clung.every(x => x.life <= 7))
  // pop the bottom one by touch — the whole ring must go up
  const bottom = clung.reduce((m, x) => (x.y > m.y ? x : m), clung[0])
  e.invuln = 5
  park(e, bottom.x, bottom.y)
  e.update(DT)
  check('the ring cascades in one chain', e.fx.bossHurt === 3, `${e.fx.bossHurt} hits`)
  check('three hits landed', e.boss!.hp === 15, `hp ${e.boss!.hp}`)
}

function testBossBolt(): void {
  console.log('a bolt stings him for a chunk')
  const e = bossEngine()
  e.boss!.throwTimer = 99
  e.shots.push({ kind: 'bolt', x: e.boss!.x - 90, y: e.boss!.y, vx: 520, vy: 0, age: 0, spin: 0 })
  step(e, 0.5, en => { en.invuln = 5; en.bubbles = en.bubbles.filter(x => !x.special) })
  check('bolt damage landed', e.boss !== null && e.boss.hp === 15, `hp ${e.boss?.hp}`)
}

function testBossSlam(): void {
  console.log('rage — the floor slam sequence')
  const e = bossEngine()
  const b = e.boss!
  b.hp = 3
  b.state = 'idle'
  b.stateT = 0
  b.throwTimer = 99
  b.slamTimer = 0.05
  const seen = new Set<string>()
  step(e, 4, en => {
    en.invuln = 5
    en.bubbles = en.bubbles.filter(x => !x.special)
    if (en.boss) seen.add(en.boss.state)
  })
  check('he rose, slammed and lay winded', seen.has('rise') && seen.has('slam') && seen.has('recover'),
    [...seen].join(','))
  check('the slam shocked the floor', e.fx.slam >= 1 && e.fx.shatter === 0)
}

function testBossContact(): void {
  console.log('the belly kills; the rim does not')
  const e = bossEngine()
  const b = e.boss!
  b.throwTimer = 99
  b.state = 'idle'
  // burn off the spawn invulnerability parked out of harm's way
  step(e, 1.6, en => { en.shots = []; en.bubbles = en.bubbles.filter(x => !x.special); if (en.boss) en.boss.throwTimer = 99 })
  check('invulnerability spent', e.invuln === 0)
  park(e, b.x + 28 + e.player.w / 2, b.y)
  e.update(DT)
  check('brushing the rim is survivable', e.dying === 0)
  park(e, b.x, b.y)
  e.update(DT)
  check('the belly is death', e.dying > 0 && e.lives === 2)
}

function testBossDeathAndRespawn(): void {
  console.log('his fall — loot, sweep, and the screen-reset rule')
  const e = bossEngine()
  const b = e.boss!
  b.throwTimer = 99
  b.state = 'idle'
  b.hp = 1
  e.bubbles.push(floatAt(b.x, b.y + 39))
  e.update(DT)
  const blister = e.bubbles.find(x => x.cling !== null)!
  e.invuln = 5
  park(e, blister.x, blister.y)
  e.update(DT)
  check('the last blister fells him', e.boss!.state === 'dying' && e.fx.bossDown === 1)
  check('his hide sheds its foam with him', !e.bubbles.some(x => x.cling !== null))
  check('the bounty pays', e.score >= 20000, `score ${e.score}`)
  step(e, 2.4, en => { en.invuln = 5; en.bubbles = en.bubbles.filter(x => !x.special) })
  check('the throes end in a loot rain', e.boss === null && e.fruits.length >= 10)
  check('a long sweep window opens', e.state === 'cleanup')

  // losing a life resets the SCREEN, never his health
  const r = bossEngine()
  r.boss!.hp = 7
  r.boss!.throwTimer = 99
  step(r, 1.6, en => { en.shots = []; en.bubbles = en.bubbles.filter(x => !x.special); if (en.boss) en.boss.throwTimer = 99 })
  park(r, r.boss!.x, r.boss!.y)             // into the belly
  r.update(DT)
  check('the belly took the life', r.dying > 0)
  step(r, 1.5, en => { en.bubbles = en.bubbles.filter(x => !x.special) })
  check('the screen reset kept his wounds', r.boss !== null && r.boss.hp === 7 && r.lives === 2,
    `hp ${r.boss?.hp} lives ${r.lives}`)
}

// ── Part E: built-in integrity gate ──────────────────────────

function testBuiltinIntegrity(): void {
  console.log('built-in integrity gate (every round, every world)')
  check('24 rounds ship', BUILTIN_LEVELS.length === 24, `${BUILTIN_LEVELS.length}`)
  check('worlds run in blocks of three', BUILTIN_LEVELS.every((l, i) => (l.theme ?? 0) === Math.floor(i / 3)))
  check('all eight worlds are used', new Set(BUILTIN_LEVELS.map(l => l.theme)).size === 8 && THEME_COUNT === 8)

  const problems: string[] = []
  const gate = (l: LevelDef, tag: string): void => {
    const at = (c: number, r: number): number => (c >= 0 && c < l.cols && r >= 0 && r < l.rows) ? l.tiles[r * l.cols + c] : 0
    if (l.cols !== 40 || l.rows !== 26) problems.push(`${tag}: ${l.cols}×${l.rows}`)
    if (at(l.player.col, l.player.row) === WALL) problems.push(`${tag}: spawn in a wall`)
    for (let r = 0; r <= 8; r++) for (let c = 0; c < l.cols; c++) {
      if (at(c, r) === WALL) { problems.push(`${tag}: wall in the sky row ${r}`); r = 9; break }
    }
    for (const en of l.enemies) {
      if (at(en.col, en.row) === WALL) problems.push(`${tag}: foe inside a wall @${en.col},${en.row}`)
      // ground species must STAND on something — the row below is a platform
      const flyer = (((en.kind ?? 0) % 4) + 4) % 4 === 3
      if (!flyer && (en.row + 1 >= l.rows || at(en.col, en.row + 1) !== WALL)) {
        problems.push(`${tag}: ground foe floating @${en.col},${en.row}`)
      }
    }
    for (const d of l.diamonds ?? []) {
      if (at(d.col, d.row) === WALL) problems.push(`${tag}: diamond inside a wall @${d.col},${d.row}`)
      if (d.row + 1 >= l.rows || at(d.col, d.row + 1) !== WALL) problems.push(`${tag}: diamond floating @${d.col},${d.row}`)
    }
    // the tier rhythm: every platform row within a 4-row hop of the one below
    const rows: number[] = []
    for (let r = 0; r < l.rows; r++) {
      for (let c = 0; c < l.cols; c++) if (at(c, r) === WALL) { rows.push(r); break }
    }
    for (let i = 0; i < rows.length - 1; i++) {
      if (rows[i + 1] - rows[i] > 4) problems.push(`${tag}: tier gap ${rows[i]}→${rows[i + 1]} beyond the jump`)
    }
    if (rows[rows.length - 1] !== l.rows - 1) problems.push(`${tag}: no full floor`)
  }
  BUILTIN_LEVELS.forEach((l, i) => gate(l, `R${i + 1} ${l.name}`))
  gate(DIAMOND_ROOM, 'DIAMOND_ROOM')
  check('every room passes the gate', problems.length === 0, problems.slice(0, 6).join(' | '))

  check('the diamond room is a bonus with 40 gems', DIAMOND_ROOM.bonus === true && (DIAMOND_ROOM.diamonds?.length ?? 0) === 40)
  check('the boss room is a boss round with no roster', BOSS_ROOM.boss === true && BOSS_ROOM.enemies.length === 0)
  check('the boss room is a full screen', BOSS_ROOM.cols === 40 && BOSS_ROOM.rows === 26)

  // round-trips: clone + sanitize both carry the special-round flags
  const c = cloneLevel(BOSS_ROOM)
  check('cloneLevel carries boss', c.boss === true)
  const rt = sanitizeLevel(JSON.parse(JSON.stringify(BOSS_ROOM)))
  check('sanitize round-trips boss', rt?.boss === true && rt?.bonus === false)
  const rtd = sanitizeLevel(JSON.parse(JSON.stringify(DIAMOND_ROOM)))
  check('sanitize round-trips bonus + diamonds', rtd?.bonus === true && (rtd?.diamonds?.length ?? 0) === 40)
}

// ── Part F: round flow odds and ends ─────────────────────────

function testFlowBits(): void {
  console.log('flow — diamond clock, umbrella warp, cross-screen 1UP, sweets')
  const d = new Engine(cloneLevel(DIAMOND_ROOM))
  check('the bonus clock arms', d.bonusTimer > 10)
  d.bonusTimer = 0.05
  step(d, 0.2)
  check('the clock alone ends a diamond room', d.state === 'won')

  const u = flatRoom()
  step(u, 0.1, mundane)
  const p = u.player
  const um: Umbrella = {
    x: p.x, y: p.y, w: TILE * 1.4, h: TILE * 1.4, vx: 0, vy: 0,
    kind: 'red', life: 5, taken: false, rest: true, bob: 0,
  }
  u.umbrellas.push(um)
  u.update(DT)
  check('an armed umbrella warps on touch', u.warp === UMBRELLA_META.red.skip && u.state === 'won')
  check('umbrella fx counted', u.fx.umbrella === 1)

  const s = flatRoom()
  s.seedScore(31000, 29000)
  check('a clear bonus crossing 30k still pays the 1UP', s.lives === 4)

  const c = flatRoom()
  step(c, 0.1, mundane)
  c.candies.push({
    x: c.player.x, y: c.player.y, w: TILE * 1.28, h: TILE * 1.28, vx: 0, vy: 0,
    kind: 'candy', life: 5, taken: false, rest: true, bob: 0,
  })
  c.update(DT)
  check('candy switches on rapid fire', c.rapid && c.fx.candy === 1)
  const c2 = flatRoom()
  c2.carryLifePowersFrom(c)
  check('sweets carry across screens', c2.rapid && !c2.shoe)
}

function testHurryAndBaron(): void {
  console.log('Hurry up! and Baron von Blubba')
  const e = new Engine(fromAscii('slow', [
    '', '', '', '', '', '', '', '', '', '',
    '.P................b',
    '####################',
  ]))
  step(e, 25, en => { en.invuln = 5; mundane(en) })
  check('dawdling angers the roster', e.fx.hurry === 1 && e.enemies[0].angry)
  check('the Baron waits a while longer', e.baron === null)
  step(e, 10, en => { en.invuln = 5; mundane(en) })
  check('…then comes for you', e.baron !== null && e.fx.baron === 1)
}

// ── Part G: fuzz ─────────────────────────────────────────────

function testFuzz(): void {
  console.log('fuzz — random play must never wedge the sim')
  const rooms = [cloneLevel(BUILTIN_LEVELS[0]), cloneLevel(BUILTIN_LEVELS[18]), cloneLevel(BOSS_ROOM)]
  let bad = ''
  for (const lvl of rooms) {
    const e = new Engine(lvl)
    let t = 0
    step(e, 45, en => {
      t += DT
      if (Math.random() < 0.02) en.input.left = !en.input.left
      if (Math.random() < 0.02) en.input.right = !en.input.right
      if (Math.random() < 0.015) { en.input.jump = true; en.jump() }
      if (Math.random() < 0.01) en.input.jump = false
      if (Math.random() < 0.05) en.blow()
      const px = en.player.x, py = en.player.y
      if (!Number.isFinite(px) || !Number.isFinite(py)) bad = `${lvl.name}: NaN player @${t.toFixed(1)}s`
      if (en.lives < 0 || en.lives > 7) bad = `${lvl.name}: lives ${en.lives}`
      if (en.bubbles.length > 60) bad = `${lvl.name}: ${en.bubbles.length} bubbles`
      if (!['playing', 'cleanup', 'won', 'gameover'].includes(en.state)) bad = `${lvl.name}: state ${en.state}`
      // a won/gameover screen is fine — revive it so the fuzz keeps testing live sim
      if (en.state !== 'playing') { en.spawn(); en.lives = 3 }
    })
    check(`45s of chaos on “${lvl.name}”`, bad === '', bad)
    bad = ''
  }
}

// ── run ──────────────────────────────────────────────────────

testJumpRatio()
testCoyote()
testShotBallistics()
testTrapOnlyWhileShooting()
testSolidFloat()
testCascadeAndCrown()
testExtendLetters()
testBossSpawn()
testBossTelegraph()
testBossBallistics()
testBossBlisters()
testBossBolt()
testBossSlam()
testBossContact()
testBossDeathAndRespawn()
testBuiltinIntegrity()
testFlowBits()
testHurryAndBaron()
testFuzz()

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
