// diamondcoreprocessor.com/games/arkanoid/selftest.ts
//
// Headless engine verification — no DOM, pure sim, fixed steps. Run from
// hypercomb-essentials/:
//
//   npx tsx src/diamondcoreprocessor.com/games/arkanoid/selftest.ts
//
// Part A pins THE AMP: the oscillator multiplies every other power-up's effect
// (1 O → double, 2 → triple, 3 → quadruple, then it stops). Part B is the
// regression guard that matters most — at amp 1 (no oscillator) every grant must
// still produce byte-for-byte the pre-amp values, so the un-amped game is
// untouched. Part C pins the HUD invariants the amped loaders could break (every
// bar frac must stay inside 0..1). Part D fuzzes a quadrupled board for runaway
// state. Imported by nothing — the entry-based module build never ships it.
//
// Pills are granted through the REAL path: a capsule is dropped onto the bat and
// caught by #stepCapsules, which is what calls #applyPower. Nothing here reaches
// past the engine's own pickup chain.

import { Engine, W, H, BRICK_TOP, GUN_LOADER, DIFFICULTY, type PowerKind, type Ball } from './engine.js'

let failures = 0
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ok  ${name}`); return }
  failures++
  console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`)
}
function near(a: number, b: number, eps = 1e-6): boolean { return Math.abs(a - b) <= eps }

const DT = 1 / 240

// A plain board: three solid rows of 1-hp bricks across all 11 columns.
function fresh(): Engine {
  return new Engine(['11111111111', '11111111111', '11111111111'])
}

/** Catch `times` pills of `kind` on the bat, through the real capsule path. */
function grant(e: Engine, kind: PowerKind, times = 1): void {
  for (let i = 0; i < times; i++) {
    e.capsules.push({ x: e.paddle.x, y: e.paddle.y - 5, kind })
    e.update(DT)
  }
}

/** A free (non-primary) colour ball — the clock pill refuses to fire without one. */
function colourBall(e: Engine): void {
  const b: Ball = { x: W / 2, y: H * 0.5, vx: 0, vy: -120, r: 7, stuck: false, wobble: 0, primary: false, color: '#ff5b5b' }
  e.balls.push(b)
}

/** Drop the white ball past the floor → the engine takes a life and resets the round. */
function loseBall(e: Engine): void {
  for (const b of e.balls) if (b.primary) { b.stuck = false; b.y = H + 100 }
  e.update(DT)
}

/** An engine with `stacks` oscillators already eaten. */
function amped(stacks: number): Engine {
  const e = fresh()
  if (stacks > 0) grant(e, 'oscillate', stacks)
  return e
}

/** Run `seconds` with every EXTERNAL threat suppressed, so the only thing that could
 *  end an effect is a clock. Needed because the swarm is real: left alone for a
 *  minute a firing enemy chips a shield away, and a queen will eventually knock the
 *  parked ball loose and drain it — both legitimate endings, but neither is a
 *  timeout. Without this the "never expires" checks are flaky ~1 run in 6, decided
 *  by which enemy kind randomly spawned. */
function idle(g: Engine, seconds: number): void {
  for (let i = 0; i < seconds * 120; i++) {
    g.update(1 / 120)
    g.enemies.length = 0
    g.turretShots.length = 0
    g.paddleHp = 100
  }
}

// ── A. the amp ladder ────────────────────────────────────────
console.log('\nA. amp ladder — double, triple, quadruple, then stop')
check('0 oscillators → amp 1 (un-amped)', amped(0).amp === 1, `got ${amped(0).amp}`)
check('1 oscillator  → amp 2 (DOUBLE)', amped(1).amp === 2, `got ${amped(1).amp}`)
check('2 oscillators → amp 3 (TRIPLE)', amped(2).amp === 3, `got ${amped(2).amp}`)
check('3 oscillators → amp 4 (QUADRUPLE)', amped(3).amp === 4, `got ${amped(3).amp}`)
check('4 oscillators → amp 4 (ladder caps)', amped(4).amp === 4, `got ${amped(4).amp}`)
check('9 oscillators → amp 4 (never runs away)', amped(9).amp === 4, `got ${amped(9).amp}`)
check('maxBalls scales with the amp', amped(0).maxBalls === 9 && amped(3).maxBalls === 36,
  `${amped(0).maxBalls} / ${amped(3).maxBalls}`)
check('maxLives scales with the amp (5 → 10 → 15 → 20)',
  [0, 1, 2, 3].every(s => amped(s).maxLives === 5 * (1 + s)),
  [0, 1, 2, 3].map(s => amped(s).maxLives).join(', '))

// ── B. PARITY at amp 1 — the un-amped game must be untouched ──
console.log('\nB. parity at amp 1 — every legacy value preserved')
{
  let e = fresh(); grant(e, 'gun')
  check('gun loads 6', e.gunAmmo === 6 && e.gunLoaderSize === GUN_LOADER, `ammo ${e.gunAmmo} loader ${e.gunLoaderSize}`)
  e = fresh(); grant(e, 'beam')
  check('beam loads 4', e.beamShots === 4, `${e.beamShots}`)
  e = fresh(); grant(e, 'laser')
  check('laser loads 4', e.laserShots === 4, `${e.laserShots}`)
  e = fresh(); grant(e, 'rocket')
  check('rocket carries 1', e.rocketAmmo === 1, `${e.rocketAmmo}`)
  e = fresh(); grant(e, 'expand')
  check('expand → w 134, 13s', near(e.paddle.w, 134) && near(e.expandTimer, 13, 0.01), `w ${e.paddle.w} t ${e.expandTimer}`)
  e = fresh(); grant(e, 'magnet')
  check('magnet → 11s', near(e.magnetTimer, 11, 0.01), `${e.magnetTimer}`)
  e = fresh(); grant(e, 'burst')
  check('burst → 8s', near(e.burstTimer, 8, 0.01), `${e.burstTimer}`)
  e = fresh(); grant(e, 'pierce')
  check('pierce → 9s', near(e.pierceTimer, 9, 0.01), `${e.pierceTimer}`)
  e = fresh(); grant(e, 'shield')
  check('shield → pool 100, frac 1', e.shieldHp === 100 && near(e.shieldHpFrac, 1),
    `hp ${e.shieldHp} frac ${e.shieldHpFrac}`)
  e = fresh(); e.paddleHp = 10; grant(e, 'heal')
  check('heal → +45', near(e.paddleHp, 55), `${e.paddleHp}`)
  e = fresh(); colourBall(e); grant(e, 'clock')
  check('clock → 6s', near(e.freezeTimer, 6, 0.01), `${e.freezeTimer}`)
  e = fresh(); grant(e, 'scramble')
  check('scramble → 1s', near(e.scrambleTimer, 1, 0.01), `${e.scrambleTimer}`)
  e = fresh(); grant(e, 'ballchain')
  check('ballchain → 16s', near(e.ballchainTimer, 16, 0.01), `${e.ballchainTimer}`)
  e = fresh(); grant(e, 'pinball')
  check('pinball → machine mode on', e.pinball === true)
  // The un-amped life economy must be exactly the old one: +1 per 1UP, ceiling 5.
  e = fresh(); e.lives = 3; grant(e, 'extralife')
  check('1UP → +1 life', e.lives === 4, `${e.lives}`)
  e = fresh(); e.lives = 5; grant(e, 'extralife')
  check('1UP at the ceiling → still 5', e.lives === 5, `${e.lives}`)
  check('un-amped life ceiling is 5', fresh().maxLives === 5, `${fresh().maxLives}`)

  // Break at amp 1 must still be the original two splits on exactly ±0.35 rad.
  e = fresh()
  const before = e.balls.length
  const parent = e.balls[0]
  parent.stuck = false; parent.vx = 0; parent.vy = -400
  grant(e, 'break')
  const added = e.balls.length - before
  const angles = e.balls.slice(before).map(b => Math.atan2(b.vy, b.vx) - Math.atan2(-400, 0)).sort((x, y) => x - y)
  check('break → 2 splits', added === 2, `${added}`)
  check('break → exactly ±0.35 rad', angles.length === 2 && near(angles[0], -0.35, 1e-9) && near(angles[1], 0.35, 1e-9),
    angles.map(a => a.toFixed(4)).join(', '))
}

// ── the score booster ladder (×1.6 at one stack, exactly as before) ──
// On a clean multiplier state, catching one pill scores round(100 · 1.1 · boost).
function boostAt(stacks: number): number {
  const e = amped(stacks)
  e.score = 0; e.combo = 0; e.goldBonus = 0; e.pillMul = 1
  grant(e, 'expand')
  return e.score / 110
}
check('score boost, un-amped → ×1 (unchanged)', near(boostAt(0), 1, 1e-9), `${boostAt(0)}`)
check('score boost, 1 oscillator → ×1.6 (legacy value)', near(boostAt(1), 1.6, 1e-9), `${boostAt(1)}`)
check('score boost, 2 oscillators → ×2.2', near(boostAt(2), 2.2, 1e-9), `${boostAt(2)}`)
check('score boost, quadruple → ×2.8', near(boostAt(3), 2.8, 1e-9), `${boostAt(3)}`)

// ── C. amped grants ──────────────────────────────────────────
console.log('\nC. amped grants — the whole kit turns up')
{
  const loaders: [PowerKind, (e: Engine) => number, number][] = [
    ['gun', e => e.gunAmmo, 6],
    ['beam', e => e.beamShots, 4],
    ['laser', e => e.laserShots, 4],
    ['rocket', e => e.rocketAmmo, 1],
  ]
  for (const [kind, read, base] of loaders) {
    for (const stacks of [0, 1, 2, 3, 5]) {
      const e = amped(stacks); grant(e, kind)
      const want = base * Math.min(4, 1 + stacks)
      check(`${kind} at ${stacks} osc → ${want}`, read(e) === want, `got ${read(e)}`)
    }
  }
  const timers: [PowerKind, (e: Engine) => number, number][] = [
    ['magnet', e => e.magnetTimer, 11],
    ['burst', e => e.burstTimer, 8],
    ['pierce', e => e.pierceTimer, 9],
    ['expand', e => e.expandTimer, 13],
  ]
  for (const [kind, read, base] of timers) {
    const e = amped(3); grant(e, kind)
    check(`${kind} duration quadruples → ${base * 4}s`, near(read(e), base * 4, 0.02), `got ${read(e)}`)
  }
  let e = amped(3); grant(e, 'shield')
  check('shield pool quadruples → 400, frac still 1', e.shieldHp === 400 && near(e.shieldHpFrac, 1),
    `hp ${e.shieldHp} frac ${e.shieldHpFrac}`)
  e = amped(1); e.paddleHp = 10; grant(e, 'heal')
  check('doubled heal tops the bat off', near(e.paddleHp, 100), `${e.paddleHp}`)
  e = amped(3); grant(e, 'expand')
  check('quadrupled bat is wider but not the whole board', e.paddle.w > 300 && e.paddle.w <= W * 0.9, `w ${e.paddle.w}`)

  // Extra lives: the 1UP pays `amp` lives INTO an amped ceiling. Both halves matter —
  // a quadrupled +4 into the old cap of 5 would have handed back almost nothing.
  for (const stacks of [0, 1, 2, 3]) {
    const g = amped(stacks); g.lives = 1; grant(g, 'extralife')
    const want = 1 + Math.min(4, 1 + stacks)
    check(`1UP at ${stacks} osc → +${Math.min(4, 1 + stacks)} lives`, g.lives === want, `got ${g.lives}`)
  }
  e = amped(3); e.lives = 1
  grant(e, 'extralife', 12)                       // keep eating 1UPs at quadruple
  check('quadrupled 1UPs bank up to the raised ceiling of 20', e.lives === 20, `${e.lives}`)
  e = amped(0); e.lives = 1
  grant(e, 'extralife', 12)                       // …the un-amped ceiling still holds at 5
  check('un-amped 1UPs still stop at 5', e.lives === 5, `${e.lives}`)
  // A death drops the amp but must never claw back lives already banked.
  e = amped(3); e.lives = 1; grant(e, 'extralife', 12)
  loseBall(e)
  check('death drops the amp without clipping banked lives', e.amp === 1 && e.lives === 19,
    `amp ${e.amp} lives ${e.lives}`)

  // Break at quadruple: 8 splits per ball, all still inside the ±0.7 cone.
  e = amped(3)
  const p = e.balls[0]
  p.stuck = false; p.vx = 0; p.vy = -400
  const n0 = e.balls.length
  grant(e, 'break')
  const splits = e.balls.slice(n0)
  const off = splits.map(b => Math.atan2(b.vy, b.vx) - Math.atan2(-400, 0))
  check('quadrupled break → 8 splits', splits.length === 8, `${splits.length}`)
  check('quadrupled break stays inside the ±0.7 cone', off.every(a => Math.abs(a) <= 0.7 + 1e-9),
    off.map(a => a.toFixed(3)).join(', '))

  // Ammo counts must never outrun the pip row the renderer draws from.
  for (const stacks of [0, 1, 2, 3]) {
    const g = amped(stacks); grant(g, 'gun')
    check(`gun pip row matches ammo at ${stacks} osc`, g.gunLoaderSize === g.gunAmmo, `${g.gunLoaderSize} vs ${g.gunAmmo}`)
  }
}

// ── D. HUD invariants — no amped bar may overflow ────────────
console.log('\nD. HUD invariants')
{
  const e = amped(3)
  colourBall(e)
  for (const k of ['expand', 'magnet', 'burst', 'pierce', 'shield', 'regen', 'pinball', 'scramble',
    'clock', 'ballchain', 'beam', 'laser', 'rocket', 'gun'] as PowerKind[]) grant(e, k)
  const bad = e.activePowers.filter(p => !(p.frac >= 0 && p.frac <= 1))
  check('every amped HUD frac stays in 0..1', bad.length === 0,
    bad.map(p => `${p.kind}=${p.frac}`).join(', '))
  check('the amp badge reports the level', e.activePowers.some(p => p.kind === 'oscillate' && p.label === 'AMP×4'),
    e.activePowers.filter(p => p.kind === 'oscillate').map(p => p.label).join(','))
  // Re-grant each and re-check: a second (stacking) grant must not overflow either.
  for (const k of ['expand', 'magnet', 'burst', 'shield', 'scramble', 'clock'] as PowerKind[]) grant(e, k)
  const bad2 = e.activePowers.filter(p => !(p.frac >= 0 && p.frac <= 1))
  check('stacked amped grants keep fracs in 0..1', bad2.length === 0, bad2.map(p => `${p.kind}=${p.frac}`).join(', '))
}

// ── E. a death resets the amp AND the sizes it scaled ────────
console.log('\nE. reset')
{
  const e = amped(3)
  grant(e, 'gun'); grant(e, 'shield')
  check('pre-death: amped loader', e.gunLoaderSize === 24 && e.shieldHp === 400, `${e.gunLoaderSize} / ${e.shieldHp}`)
  loseBall(e)
  check('death clears the amp', e.oscillateStacks === 0 && e.amp === 1, `stacks ${e.oscillateStacks} amp ${e.amp}`)
  check('death restores the base loaders', e.gunLoaderSize === GUN_LOADER, `${e.gunLoaderSize}`)
  const bad = e.activePowers.filter(p => !(p.frac >= 0 && p.frac <= 1))
  check('post-death HUD fracs clean', bad.length === 0, bad.map(p => `${p.kind}=${p.frac}`).join(', '))
  grant(e, 'gun')
  check('post-death gun grants the un-amped 6', e.gunAmmo === 6, `${e.gunAmmo}`)
}


// ── H. shield busts, never expires ───────────────────────────
console.log('\nH. shield — no clock, only a bust')
{
  /** Fire `n` turret shots into the bat through the real route. */
  const shellBat = (g: Engine, n: number): void => {
    for (let i = 0; i < n; i++) {
      g.turretShots.push({ x: g.paddle.x, y: g.paddle.y - 4, vx: 0, vy: 200 })
      g.update(1 / 120)
    }
  }
  let e = fresh(); grant(e, 'shield')
  idle(e, 120)                                             // 120 SECONDS
  check('shield survives 120s untouched (no clock)', e.shielded && e.shieldHp === 100, `hp ${e.shieldHp}`)

  e = fresh(); grant(e, 'shield')
  shellBat(e, 4)                                           // 4 × 24 dmg = 96 … one short
  check('4 hits chip but do not bust it', e.shielded && e.shieldHp > 0, `hp ${e.shieldHp}`)
  shellBat(e, 1)
  check('the 5th hit BUSTS it', !e.shielded && e.shieldHp === 0, `hp ${e.shieldHp}`)
  check('busting flashes', e.shieldFlash > 0, `${e.shieldFlash}`)

  e = fresh(); grant(e, 'shield')
  const hpBefore = e.paddleHp
  shellBat(e, 3)
  check('a live shield takes the damage, not the bat', e.paddleHp === hpBefore, `${e.paddleHp} vs ${hpBefore}`)

  // amped: a deeper pool = proportionally more hits before it busts
  e = amped(3); grant(e, 'shield')
  check('a quadrupled shield holds 400', e.shieldHp === 400 && near(e.shieldHpFrac, 1), `${e.shieldHp}`)
  shellBat(e, 5)
  check('…and survives the 5 hits that bust a plain one', e.shielded, `hp ${e.shieldHp}`)

  // healing shield: heals until it busts, then stops
  e = fresh(); e.paddleHp = 20; grant(e, 'regen')
  check('regen marks the shield as healing', e.regenShield && e.shielded)
  for (let i = 0; i < 60; i++) e.update(1 / 120)
  check('a healing shield regenerates the bat', e.paddleHp > 20, `${e.paddleHp.toFixed(1)}`)
  shellBat(e, 5)                                           // bust it
  check('busting ends the healing too', !e.regenShield && !e.shielded)
  const afterBust = e.paddleHp
  for (let i = 0; i < 120; i++) e.update(1 / 120)
  check('…and the bat stops regenerating', near(e.paddleHp, afterBust, 1e-6), `${e.paddleHp} vs ${afterBust}`)

  // the HUD bar is STRENGTH, not a countdown
  e = fresh(); grant(e, 'shield')
  shellBat(e, 2)
  const badge = e.activePowers.find(p => p.kind === 'shield')
  check('the shield badge reports strength', !!badge && badge.frac > 0 && badge.frac < 1 && badge.label.endsWith('%'),
    `${badge?.frac} ${badge?.label}`)
  e = fresh(); e.paddleHp = 20; grant(e, 'regen')
  check('a healing shield badges as regen', e.activePowers.some(p => p.kind === 'regen'))
  check('…and never as a second shield badge', e.activePowers.filter(p => p.kind === 'shield').length === 0)
}

// ── I. pinball is a machine you play out ─────────────────────
console.log('\nI. pinball — a machine, played out')
{
  let e = fresh(); grant(e, 'pinball')
  check('the P pill flips the board to machine mode', e.pinball)
  check('the machine racks bumpers + props', e.bumpers.length > 0 && e.pinballProps.length > 0,
    `${e.bumpers.length} bumpers, ${e.pinballProps.length} props`)
  check('the white ball goes big', (e.balls.find(b => b.primary)?.r ?? 0) > 7, `r ${e.balls.find(b => b.primary)?.r}`)
  idle(e, 180)                                             // THREE MINUTES
  check('pinball never times out (3 min)', e.pinball && e.bumpers.length > 0, `pinball=${e.pinball}`)
  check('its badge is a mode, not a countdown',
    e.activePowers.some(p => p.kind === 'pinball' && p.frac === 1 && p.label === 'ON'),
    e.activePowers.filter(p => p.kind === 'pinball').map(p => p.label).join(','))

  // ── the flippers are BOLTED to the table (they used to slide with the bat) ──
  e = fresh(); grant(e, 'pinball')
  const centre = e.flipperCenterX
  for (const x of [40, W / 2, W - 40]) { e.movePaddleTo(x); e.update(1 / 120) }
  check('the flippers never move with the mouse', e.flipperCenterX === centre, `${centre} → ${e.flipperCenterX}`)
  check('…and sit at the table centre', near(e.flipperCenterX, W / 2), `${e.flipperCenterX}`)

  // ── on the table the BALL collects pills, not a bat ──
  e = fresh(); grant(e, 'pinball')
  e.movePaddleTo(40); e.update(1 / 120)                    // park the (now absent) bat far away
  const ball = e.balls.find(b => b.primary)!
  ball.stuck = false; ball.x = W / 2; ball.y = H * 0.5; ball.vx = 0; ball.vy = 0
  const pills0 = e.pillMul
  e.capsules.push({ x: W / 2, y: H * 0.5, kind: 'expand' })   // drop one ONTO the ball
  e.update(1 / 120)
  check('a ball rolling over a pill collects it', e.capsules.length === 0 && e.pillMul > pills0,
    `${e.capsules.length} left, pillMul ${e.pillMul}`)
  check('…and its power lands', e.expandTimer > 0, `${e.expandTimer}`)

  e = fresh(); grant(e, 'pinball')
  e.movePaddleTo(W / 2); e.update(1 / 120)
  for (const b of e.balls) { b.stuck = false; b.x = 40; b.y = 40 }   // ball nowhere near
  e.capsules.push({ x: W / 2, y: e.paddle.y - 5, kind: 'expand' })   // …right on top of the old bat line
  e.update(1 / 120)
  check('the vanished bat no longer catches pills on the table', e.expandTimer === 0, `${e.expandTimer}`)

  // ── …but the bat still catches normally OUTSIDE pinball ──
  e = fresh()
  grant(e, 'expand')
  check('outside pinball the bat still catches', e.expandTimer > 0, `${e.expandTimer}`)

  // ── on the table the ONLY way to lose a ball is the drain ──
  e = fresh(); grant(e, 'pinball')
  const hp0 = e.paddleHp, lives0 = e.lives
  for (let i = 0; i < 40; i++) {                           // shell the (absent) bat hard
    e.turretShots.push({ x: e.paddle.x, y: e.paddle.y - 4, vx: 0, vy: 200 })
    e.update(1 / 120)
  }
  check('table fire cannot chip a bat that is not there', e.paddleHp === hp0, `${e.paddleHp} vs ${hp0}`)
  check('…and cannot cost a life', e.lives === lives0 && e.state === 'playing', `lives ${e.lives}`)
  check('…so pinball is still running', e.pinball)
  // …but outside pinball that same fire absolutely still hurts
  e = fresh()
  const hpNormal = e.paddleHp
  for (let i = 0; i < 3; i++) { e.turretShots.push({ x: e.paddle.x, y: e.paddle.y - 4, vx: 0, vy: 200 }); e.update(1 / 120) }
  check('outside pinball enemy fire still chips the bat', e.paddleHp < hpNormal, `${e.paddleHp}`)

  // ends on a DEATH → back to a normal bat, play continues
  e = fresh(); grant(e, 'pinball')
  const lives = e.lives
  loseBall(e)
  check('draining ends the machine', !e.pinball && e.bumpers.length === 0 && e.pinballProps.length === 0)
  check('…costing exactly one life', e.lives === lives - 1, `${e.lives} vs ${lives - 1}`)
  check('…and play continues as normal', e.state === 'playing')
  check('…with a normal-sized white ball back', near(e.balls.find(b => b.primary)?.r ?? 0, 7), `r ${e.balls.find(b => b.primary)?.r}`)
  e.update(1 / 120)
  check('…and the bat back (no flippers)', e.flipLeftRaise === 0 && e.flipRightRaise === 0)

  // ends on a level CLEAR → the overlay builds a fresh Engine, so the next screen is normal
  e = fresh(); grant(e, 'pinball')
  e.aiming = false
  for (const b of e.bricks) b.alive = false
  for (let i = 0; i < 3 * 120; i++) e.update(1 / 120)
  check('clearing the level while in pinball still resolves to won', e.state === 'won', `${e.state}`)
  check('a fresh level starts as a normal bat', new Engine(['11111111111']).pinball === false)
}

// ── G. the FINALE — every level ends on a payoff ─────────────
console.log('\nG. finale — the last brick is the prize')
{
  /** A board with exactly `n` bricks left alive. */
  const boardOf = (n: number): Engine => {
    const g = fresh()
    g.aiming = false
    let kept = 0
    for (const b of g.bricks) { if (kept < n) kept++; else { b.alive = false } }
    return g
  }

  // ── the beacon ──
  let e = boardOf(3)
  e.update(1 / 120)
  check('3 bricks left → no beacon yet', !e.bricks.some(b => b.gold), `${e.bricks.filter(b => b.gold).length}`)
  e = boardOf(1)
  e.update(1 / 120)
  const beacon = e.bricks.find(b => b.alive)
  check('down to the LAST brick → it turns gold', !!beacon?.gold)
  check('the beacon is a normal brick (no hp inflation)', beacon!.hp === beacon!.max && beacon!.max <= 4,
    `hp ${beacon?.hp}/${beacon?.max}`)

  // ── clearing fires the finale, and the win WAITS for the fireworks ──
  e = boardOf(1)
  e.update(1 / 120)
  const scoreBefore = e.score
  const last = e.bricks.find(b => b.alive)!
  last.alive = false                                   // smash it
  e.update(1 / 120)
  check('clearing the board fires the finale', e.finale && e.finaleTimer > 0, `${e.finaleTimer}`)
  // Exactly 10000 on a bare engine — every multiplier sits at 1. It rides them when
  // they aren't (checked below), which is why this pays THROUGH #addScore.
  check('the finale pays the jackpot', e.score - scoreBefore >= 10000, `+${e.score - scoreBefore}`)
  check('the finale fires its gold flash', e.rushFlash > 0, `${e.rushFlash}`)
  check('the finale throws fireworks', e.explosions.length >= 10, `${e.explosions.length}`)
  check('the win WAITS while the fireworks play', e.state === 'playing', `${e.state}`)
  for (let i = 0; i < 2 * 120; i++) e.update(1 / 120)   // let the hold run out
  check('the level is won once the finale ends', e.state === 'won' && e.finaleTimer === 0, `${e.state}`)

  // ── no fail state: draining the ball mid-finale must not cost a life ──
  e = boardOf(1)
  e.update(1 / 120)
  const livesBefore = e.lives
  e.bricks.find(b => b.alive)!.alive = false
  e.update(1 / 120)
  for (const b of e.balls) if (b.primary) { b.stuck = false; b.y = H + 100 }   // drain it through the fireworks
  for (let i = 0; i < 2 * 120; i++) e.update(1 / 120)
  check('draining a ball mid-finale costs no life', e.lives === livesBefore, `${e.lives} vs ${livesBefore}`)
  check('…and the level still resolves to won (no soft-lock)', e.state === 'won', `${e.state}`)

  // ── the finale pays once ──
  e = boardOf(1)
  e.update(1 / 120)
  e.bricks.find(b => b.alive)!.alive = false
  e.update(1 / 120)
  const afterFirst = e.score
  for (let i = 0; i < 30; i++) e.update(1 / 120)
  check('the finale pays exactly once', e.score === afterFirst, `${e.score} vs ${afterFirst}`)

  // ── the jackpot rides the score multipliers (it pays through #addScore) ──
  e = boardOf(1)
  e.update(1 / 120)
  grant(e, 'oscillate', 3)                            // amp 4 → the ×2.8 booster
  const ampedBefore = e.score
  e.bricks.find(b => b.alive)!.alive = false
  e.update(1 / 120)
  check('the jackpot rides the amp booster', e.score - ampedBefore > 10000,
    `+${e.score - ampedBefore} at amp ${e.amp}`)

  // ── a rocket wiping the last several tiles still pays out ──
  e = boardOf(4)
  e.update(1 / 120)
  for (const b of e.bricks) b.alive = false            // as a blast would
  e.update(1 / 120)
  check('a blast clearing the last tiles still fires the finale', e.finale && e.rushFlash > 0)

  // ── the gold brick is GONE: no throne ever blooms mid-board ──
  const g = fresh()
  g.aiming = false
  for (let i = 0; i < 4; i++) {                        // kill hunters — the old 2nd-kill bloom trigger
    g.enemies.push({ x: W / 2, y: BRICK_TOP + 120, hp: 1, variant: 0, kind: 'hunter' })
    g.rocketAmmo = 1
    g.rockets = [{ x: W / 2, y: BRICK_TOP + 120, vy: -1 }]
    g.update(1 / 240)
    g.rockets = []
  }
  check('hunter kills no longer bloom a centre gold throne',
    !g.bricks.some(b => b.gold && b.alive && b.mega), `${g.bricks.filter(b => b.gold).length} gold`)
  check('no mega throne exists at all', !g.bricks.some(b => b.mega && b.alive))

  // ── the near-clear BERSERK is gone ──
  check('nearClear berserk removed', !('nearClearFrac' in (Engine.prototype as object)))
  const slow = boardOf(2)
  slow.enemies.push({ x: 40, y: BRICK_TOP + 40, hp: 3, variant: 0, kind: 'hunter' })
  const many = fresh()
  many.aiming = false
  many.enemies.push({ x: 40, y: BRICK_TOP + 40, hp: 3, variant: 0, kind: 'hunter' })
  const travel = (h: Engine): number => {
    const s = h.enemies[0]
    const x0 = s.x, y0 = s.y
    for (let i = 0; i < 60; i++) h.update(1 / 120)
    return Math.hypot(h.enemies[0].x - x0, h.enemies[0].y - y0)
  }
  const nearEnd = travel(slow), midLevel = travel(many)
  check('the swarm moves at ONE speed regardless of bricks left',
    Math.abs(nearEnd - midLevel) < 1e-6, `2 bricks: ${nearEnd.toFixed(2)} vs full board: ${midLevel.toFixed(2)}`)
}

// ── F. fuzz — 90s on a quadrupled board, everything on ───────
// A quadrupled kit clears a board in under two seconds, and update() early-returns
// once the state leaves 'playing' — so the board is REVIVED (and a game-over rolled
// back) every time it falls, or this whole section would idle through ~98% of its
// frames proving nothing. `liveFrames` is asserted below to keep it honest.
console.log('\nF. fuzz — 90s at quadruple, all powers live')
{
  const e = amped(3)
  e.aiming = false
  for (const b of e.balls) { b.stuck = false; b.vx = 180; b.vy = -420 }
  const every: PowerKind[] = ['gun', 'beam', 'laser', 'rocket', 'expand', 'magnet', 'burst',
    'pierce', 'shield', 'regen', 'pinball', 'scramble', 'ballchain', 'multiplier', 'break']
  for (const k of every) grant(e, k)

  let finite = true, inBounds = true, overCap = false, fracOk = true
  let liveFrames = 0, revivals = 0, maxSeen = 0
  const FRAMES = 90 * 120
  for (let i = 0; i < FRAMES; i++) {
    if (e.state === 'playing') liveFrames++
    e.update(1 / 120)
    if (i % 60 === 0) {                       // keep poking it with amped pills + fire
      // A death resets the amp ladder, and `every` deliberately holds no oscillate —
      // so without this the fuzz silently drops to amp 1 after its first drain and
      // spends the rest of the run testing the UN-amped game (peak 9 balls, not 36).
      // Re-amp every poke so "90s at quadruple" is actually true.
      if (e.amp < 4) grant(e, 'oscillate', 4 - e.amp)
      e.movePaddleTo(60 + Math.random() * (W - 120))
      grant(e, every[i % every.length])
      e.shoot(); e.fireRocket()
    }
    for (const b of e.balls) {
      if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.vx) || !Number.isFinite(b.vy)) finite = false
      if (b.x < -40 || b.x > W + 40 || b.y < -40) inBounds = false
    }
    // The cap tracks the LIVE amp: a death resets the ladder, so re-read it each frame.
    if (e.balls.length > e.maxBalls) overCap = true
    maxSeen = Math.max(maxSeen, e.balls.length)
    if (e.activePowers.some(p => !(p.frac >= 0 && p.frac <= 1))) fracOk = false
    if (!finite) break
    // Keep the sim alive so the remaining frames actually exercise the engine.
    if (e.state !== 'playing') {
      for (const b of e.bricks) { b.alive = true; b.hp = b.max; b.covered = false }
      if (e.state === 'gameover') { e.lives = 3 }
      e.state = 'playing'
      revivals++
      if (!e.balls.some(b => b.primary)) { e.aiming = false; e.shoot() }
    }
  }
  check('the fuzz actually ran (not idling on a won board)', liveFrames > FRAMES * 0.9,
    `${liveFrames}/${FRAMES} live, ${revivals} revivals`)
  check('no NaN/Infinity anywhere in the ball field', finite)
  check('balls stay on the board', inBounds)
  check('ball count never exceeds the amped cap', !overCap, `peak ${maxSeen}`)
  check('the amped ball storm really happens', maxSeen > 9, `peak ${maxSeen} balls`)
  check('HUD fracs stayed in 0..1 all run', fracOk)
  check('paddle stayed on screen', e.paddle.x >= 0 && e.paddle.x <= W, `${e.paddle.x}`)
  check('score is a finite number', Number.isFinite(e.score), `${e.score}`)
  check('rockets in flight never exceed the amp', e.rockets.length <= 4, `${e.rockets.length}`)
  console.log(`      (${liveFrames} live frames, ${revivals} board revivals, peak ${maxSeen} balls, score ${e.score})`)
}

console.log(failures === 0 ? '\nAll arkanoid amp checks passed.' : `\n${failures} FAILURE(S).`)
process.exit(failures === 0 ? 0 : 1)
