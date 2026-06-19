// diamondcoreprocessor.com/games/arkanoid/engine.ts
//
// Pure game state + physics for the Arkanoid / Breakout game. No DOM, no
// canvas — the overlay owns those and calls update(dt) each frame, then the
// renderer draws this state. Everything works in fixed WORLD units (W×H); the
// overlay scales the world to fit the screen (DPR-aware), same split as the
// bubble/solomon engines.
//
// Bricks drop power-up "pills" the paddle can catch:
//   O oscillate — balls weave on a sine path. PERMANENT for the round (no
//                 timeout): each O doubles the weave width and nudges ball
//                 speed up a notch. Stacks until you die / clear the level.
//   B break     — every ball splits into three of its own kind (white → white,
//                 colour → colour) — multi-ball, and more lives if you split white
//   L laser     — Space fires upward beams (countdown-timed)
//   E expand     — wider paddle (countdown-timed)
//   G gun       — loads a 6-shot magazine (shown as pips, no timeout). Space
//                 fires a volley of coloured ammo along an aim you steer with
//                 the paddle, within a short 120° up-fan. Grab another gun
//                 before the loader empties to stack: 2nd adds a diagonal
//                 spread (+2 shots), 3rd doubles every shot; diagonals stay in
//                 the up-fan so they always climb past half the playfield.
//   M magnet    — "gravity" toward the paddle, but only while a ball is in the
//                 TOP half: it curves toward the bat (reel it in) above the
//                 halfway line and releases below it, so after a hit the ball
//                 must climb back over the line for the pull to kick in again.
//   ↑ rocket    — RIGHT-CLICK launches your one missile straight up. It explodes
//                 on the first thing it hits (brick, hunter or ceiling), blasting
//                 every brick in radius. Only one at a time — no manual detonate.
//   × multiplier— a 2× or 3× score multiplier (one per pickup) for a while;
//                 doubles/triples the points everything scores while active.
//   * burst     — for 8s EVERY brick is one-hit: a single touch destroys it,
//                 tough bricks included.
//   P pinball   — timed flipper mode (10/12/15s): two field bumpers bounce balls
//                 around and the white ball doubles in size and damage.
//   I beam      — a PURPLE magic mushroom. 5 shots (no timer): auto-charges
//                 ~1.2s then releases a laser up the paddle's middle, damaging
//                 the whole column. Grab more to power up 1→2→3 (level 3 clears
//                 the whole line). Aim it by moving the paddle.
//
// The primary ball is WHITE and is your life: lose the white ball and a life is
// gone, even while coloured ammo balls are still bouncing. The coloured balls
// the gun fires (and the extras Break spawns) are expendable — they clear
// bricks but never save you.

export type GameState = 'playing' | 'won' | 'gameover'
export type PowerKind = 'oscillate' | 'break' | 'laser' | 'expand' | 'gun' | 'magnet' | 'rocket' | 'multiplier' | 'burst' | 'pinball' | 'beam'

export interface Brick {
  x: number; y: number; w: number; h: number; hp: number; max: number; alive: boolean
  col?: number; row?: number             // grid cell (footprint math)
  seed?: boolean; bloom?: number          // a sparkling seed; blooms into a mega when bloom <= 0
  mega?: boolean                          // a big multi-cell brick (breaks into shards)
  megaCols?: number; megaRows?: number    // a mega's footprint size, in cells
  covered?: boolean                       // silently consumed under a mega (not a player kill — skip death FX)
  drop?: PowerKind                        // forced power-up drop when destroyed (e.g. a multiplier shard)
}
export interface Ball { x: number; y: number; vx: number; vy: number; r: number; stuck: boolean; wobble: number; primary: boolean; color: string }
export interface Capsule { x: number; y: number; kind: PowerKind }
export interface Laser { x: number; y: number }
export interface Rocket { x: number; y: number; vy: number }
export interface Explosion { x: number; y: number; t: number }
export interface Enemy { x: number; y: number; hp: number }
export interface Bumper { x: number; y: number; r: number; flash: number }
export interface Alien { x: number; y: number; vx: number; frame: number }
export interface ComboPop { x: number; y: number; n: number; t: number }
export interface Pickup { x: number; y: number; kind: PowerKind; t: number }   // a caught-bonus flash

export interface PowerMeta { letter: string; color: string; name: string; desc: string }
export const POWER_META: Record<PowerKind, PowerMeta> = {
  oscillate: { letter: 'O', color: '#5fe0c0', name: 'oscillate', desc: 'Green mushroom. Balls weave side to side and you score 1.6× points. Permanent for the round — each one doubles the weave and speeds balls up.' },
  break: { letter: 'B', color: '#ff9f43', name: 'break apart', desc: 'Splits every ball into three of its own kind — white into white, colour into colour.' },
  laser: { letter: 'L', color: '#ff5b5b', name: 'laser', desc: 'Space fires twin laser beams up the screen. Timed.' },
  expand: { letter: 'E', color: '#5fe08a', name: 'expand', desc: 'Widens your paddle. Timed.' },
  gun: { letter: 'G', color: '#b07bff', name: 'gun', desc: '6-shot magazine. Space fires coloured ammo in a 120° fan. Grab more to stack: +diagonals, then double.' },
  magnet: { letter: 'M', color: '#ff5b8a', name: 'magnet', desc: 'Pulls the ball toward the paddle, but only while it is in the top half — releases below the halfway line. Timed.' },
  rocket: { letter: '↑', color: '#ff7043', name: 'rocket', desc: 'Right-click to launch your one missile. It explodes on the first thing it hits, blasting bricks in range.' },
  multiplier: { letter: '×', color: '#ffd24a', name: 'multiplier', desc: '2× or 3× score for everything while it lasts.' },
  burst: { letter: '∗', color: '#3dd7ff', name: 'burst', desc: 'For 8 seconds every brick dies in one hit — tough ones included.' },
  pinball: { letter: 'P', color: '#8c9eff', name: 'pinball', desc: 'Flipper mode: two field bumpers bounce balls around and the white ball doubles in size and damage. Timed.' },
  beam: { letter: 'I', color: '#9d5cff', name: 'beam', desc: 'A purple magic mushroom. 4 shots, no timer: charges ~1.2–1.5s then fires a laser up the middle, damaging that whole column. Grab more to power up — level 3 clears the line.' },
}
export const POWER_ORDER: PowerKind[] = ['oscillate', 'break', 'laser', 'expand', 'gun', 'magnet', 'rocket', 'multiplier', 'burst', 'pinball', 'beam']

// ── World geometry (units; the overlay scales to fit) ──────────────
// The playfield is 20% wider than the base and bricks are 80% size, kept
// CONTIGUOUS (brick width = pitch): the smaller solid wall is centred (BRICK_X0)
// in the wider field, leaving open margins down each side.
export const COLS = 11
export const BRICK_W = 33.6          // brick width = pitch (contiguous), 80% of the base 42
export const BRICK_H = 16            // row pitch = brick height, 80% of the base 20
export const W = 554.4               // playfield width — 20% wider than the base 462
export const H = 600
export const BRICK_X0 = (W - COLS * BRICK_W) / 2   // x of column 0 — centres the wall
export const BRICK_TOP = 56           // first brick row's y (shared with the designer view)

const PADDLE_W = 84
const PADDLE_EXPAND_W = 134
const PADDLE_H = 13
const PADDLE_Y = H - 34
const PADDLE_SPEED = 620              // px/s for keyboard control
const BALL_R = 7
const BALL_SPEED = 320                // px/s, base magnitude
const BALL_SPEEDUP = 1.03            // each paddle hit nudges speed up
const BALL_SPEED_MAX = 560
const MIN_VY_RATIO = 0.3             // keep ≥30% of speed vertical so a ball can't loop horizontally
const START_LIVES = 3
const MAX_BALLS = 9

const CAPSULE_W = 30
const CAPSULE_H = 15
const CAPSULE_SPEED = 135
const DROP_CHANCE = 0                 // bricks no longer drop — the alien is the dispenser

// Alien ship at the top: shoot it (ball or any weapon) and it explodes, dropping
// one power-up, then a new ship flies in. It is the source of all power-ups.
const ALIEN_Y = 24
export const ALIEN_W = 30
export const ALIEN_H = 20
const ALIEN_SPEED = 80               // px/s march
const SHIP_RESPAWN = 1.3             // seconds before the next ship flies in

// Combo: bricks killed since the last paddle bounce. The combo count IS a score
// MULTIPLIER on each chained kill (×N), strung together; every COMBO_MILESTONE
// chains earns a reward. Resets when a ball returns to the bat.
const COMBO_MIN = 2                  // ×multiplier + popup start here
const COMBO_MILESTONE = 5            // every Nth chain grants a reward
const COMBO_POP_DUR = 0.9
const PICKUP_DUR = 0.5               // seconds the caught-bonus flash lingers

// Weighted power-up drops: staples drop often, rares seldom (a rocket shouldn't
// be as common as oscillate). Higher = more common.
const POWER_WEIGHTS: Record<PowerKind, number> = {
  oscillate: 10, expand: 10, magnet: 8,
  laser: 7, break: 6, gun: 6, multiplier: 6,
  rocket: 3, burst: 3, beam: 3, pinball: 3,
}

const LASER_SPEED = 640
const LASER_COOLDOWN = 0.2
const LASER_DURATION = 10

export const GUN_LOADER = 6           // shots per gun pickup (shown as pips, no timer)
const GUN_COOLDOWN = 0.17
const GUN_SENS = 0.05                 // radians of aim per px of paddle travel
// The aim is limited to a 120° fan centred on straight up (±60°), not a full
// circle — slide the bat to sweep the barrel within it.
const GUN_AIM_CENTER = -Math.PI / 2
const GUN_AIM_SPAN = (2 * Math.PI) / 3                 // 120° total
export const GUN_AIM_MIN = GUN_AIM_CENTER - GUN_AIM_SPAN / 2   // hard left  (-150°)
export const GUN_AIM_MAX = GUN_AIM_CENTER + GUN_AIM_SPAN / 2   // hard right ( -30°)
// Gun stacking: a 2nd gun (before the loader empties) fans two diagonal shots
// out from the aim; a 3rd doubles every shot. Diagonals are re-clamped into the
// up-fan so each one keeps cos(±60°)≥0.5 of its speed upward — it always climbs
// far past half the playfield before it can drift to a side wall.
export const GUN_DIAG_SPREAD = 0.42   // rad each side of the aim (~24°)
const GUN_DOUBLE_JITTER = 0.1         // rad split between the doubled pair (so they don't overlap)
const GUN_MAX_LEVEL = 3

// Magnet: a gentle gravity toward the paddle (capped at max ball speed) so live
// balls curve back toward the bat — a "reel it in" assist, not a sticky catch.
const MAGNET_DURATION = 11
const MAGNET_G = 460                  // px/s² of pull toward the paddle

// Coloured "ammo" balls fired by the gun (and spawned by Break). The primary
// ball stays white — keep it alive or you lose a life; these are expendable.
const BALL_WHITE = '#ffffff'
const BALL_COLORS = ['#ff5b5b', '#ffb14e', '#ffe24e', '#5fe08a', '#5fd0e0', '#5a9bff', '#b07bff', '#ff7bd5']

const EXPAND_DURATION = 13

// Oscillation is PERMANENT for the round and stacks: each O pickup doubles the
// weave width (capped so it can't tunnel) and nudges ball speed up a notch. The
// displacement is applied per sub-step with collisions re-checked each step, so
// per-step travel stays a couple of px even at the widest weave.
const WOBBLE_BASE_AMP = 18            // px of lateral weave at 1 stack (doubled initial value)
const WOBBLE_AMP_MAX = 36             // px cap (keeps the wide weave from tunnelling)
const WOBBLE_FREQ = 8                 // rad/s
const OSC_SPEEDUP = 1.08             // ball-speed bump per O pickup (permanent)

// Rocket: right-click launches one missile straight up; it explodes on the first
// thing it hits (brick, hunter, or ceiling), blasting every brick in the radius.
// Only one missile exists at a time — no manual detonate.
const ROCKET_SPEED = 460
export const ROCKET_RADIUS = 58
const ROCKET_LOADER = 1              // one missile per pickup
const ROCKET_MAX = 1                 // hold at most one
export const EXPLOSION_DUR = 0.45    // seconds the blast ring lingers (visual)

// Multiplier: a 2× or 3× score multiplier (one per pickup) for a while.
const MULT_DURATION = 12

// Burst: for a few seconds every brick is one-hit, tough bricks included.
const BURST_DURATION = 8

// Enemy: dawdle on a level and a hunter spawns to chase your white ball. A hit
// on the WHITE ball whacks it away at top speed instead of stealing it — no life
// lost, but the fast ball is on screen a shorter time and easy to drop. It has 3
// hp: ball hits, coloured ammo, lasers and rockets all chip it, so 3 hits destroy
// the hunter. Killing it (or dying) resets the dawdle timer.
const ENEMY_SPAWN_DELAY = 22         // seconds of "taking too long" before it appears
const ENEMY_SPEED = 105              // px/s homing toward the white ball
const ENEMY_HP = 3
export const ENEMY_R = 15

// Mega brick: some bricks sparkle and bloom into one big brick spanning a block
// of cells (covering any bricks underneath). It takes MEGA_HP hits, then shatters
// into small shards — EVERY shard is a guaranteed power-up tile (a pill bonanza).
const MEGA_COLS = 3                  // footprint width in cells  (the "spots" it takes)
const MEGA_ROWS = 2                  // footprint height in cells (3×2 = 6 spots)
const MEGA_HP = 5                    // hits to break the big brick
const MEGA_BLOOM_DELAY = 1.6         // seconds a seed sparkles before it blooms
const MEGA_HIT_INTERVAL = 5          // a mega seed is earned every N hits on the hunter

// Pinball: a timed flipper mode. Two field bumpers bounce balls around and the
// white ball doubles in size + damage. The duration is randomly one of these.
const PINBALL_DURATIONS = [10, 12, 15]   // seconds (picked at random on pickup)
const BUMPER_R = 20
const BUMPER_KICK = 90               // speed added per bump (capped at BALL_SPEED_MAX)
const BUMPER_Y = H * 0.6             // bumpers sit below every brick row — the "non-tile" zone

// Beam (the purple mushroom): auto-charges and releases a single laser straight
// up from the paddle's middle, doing 1 damage to every brick in that column.
const BEAM_LOADER = 4               // shots per beam pickup (no timer)
const BEAM_MAX_LEVEL = 3            // power level: 1 = chip, 2 = ×2, 3 = clears the whole line
const BEAM_CHARGE_MIN = 1.2          // each charge takes a random 1.2–1.5s, re-rolled per shot
const BEAM_CHARGE_MAX = 1.5
const BEAM_FLASH = 0.16             // seconds the release beam lingers (visual)

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

export class Engine {
  readonly width = W
  readonly height = H
  state: GameState = 'playing'
  score = 0
  lives = START_LIVES

  bricks: Brick[] = []
  paddle = { x: W / 2, y: PADDLE_Y, w: PADDLE_W, h: PADDLE_H }
  balls: Ball[] = []
  capsules: Capsule[] = []
  lasers: Laser[] = []
  rockets: Rocket[] = []
  explosions: Explosion[] = []
  enemy: Enemy | null = null
  bumpers: Bumper[] = []              // pinball-mode field bumpers (empty otherwise)
  alien: Alien | null = null         // the top ship dispenser (respawns when shot)
  combo = 0                          // bricks killed since the last paddle bounce
  comboPops: ComboPop[] = []         // floating combo counters (transient, for the renderer)
  pickups: Pickup[] = []             // caught-bonus flashes (transient, for the renderer)

  // Timed power state (seconds remaining; 0 = inactive).
  laserTimer = 0
  expandTimer = 0
  magnetTimer = 0
  multTimer = 0
  burstTimer = 0
  pinballTimer = 0
  // Beam (purple mushroom): ammo-based (no timer) with a power level 1-3.
  beamShots = 0                      // shots left in the loader (0 = no beam)
  beamLevel = 0                      // 1 = chip, 2 = ×2 damage, 3 = clears the whole line
  beamCharge = 0                     // seconds into the current charge (fires at beamTarget)
  beamTarget = BEAM_CHARGE_MIN       // this cycle's charge duration (random 1.2–1.5s)
  beamFlash = 0                     // seconds left of the release-flash visual
  beamX = W / 2                      // x of the last released beam
  // Oscillate is permanent for the round and stacks (0 = off). Each pickup
  // widens the weave (doubling) and bumps ball speed.
  oscillateStacks = 0
  // Score multiplier from the multiplier pill (1 = none, 2 or 3 while active).
  scoreMul = 1
  // Rocket charges available to fire (a rocket in flight lives in `rockets`).
  rocketAmmo = 0
  // The gun is ammo-based, not timed: shots left in the loader (0 = no gun).
  gunAmmo = 0
  // Gun stacking level (1 = single, 2 = +diagonals, 3 = double shots). Raised by
  // grabbing another gun before the loader runs dry.
  gunLevel = 0
  /** Gun aim, radians (0 = +x, -PI/2 = straight up). Steered by paddle motion,
   *  clamped to the 120° fan [GUN_AIM_MIN, GUN_AIM_MAX]. */
  aimAngle = -Math.PI / 2

  /** Set by the overlay from keyboard. */
  input = { left: false, right: false }
  #pointerX: number | null = null
  #laserCd = 0
  #gunCd = 0
  #prevPaddleX = W / 2
  #colorIdx = 0                       // cycles BALL_COLORS so each ammo ball differs
  #levelClock = 0                     // seconds on this screen — drives the enemy spawn
  #levelRows = 0                      // rows in the current level (mega footprint clamp)
  #pinballDur = 0                     // the picked pinball duration (for the HUD bar)
  #enemyHits = 0                      // cumulative hits on the hunter — every 5 earns a mega
  #shipRespawn = 0                    // seconds until the next alien ship flies in (when destroyed)

  constructor(level: readonly string[]) {
    this.#build(level)
    this.#resetForLife()
  }

  // ── setup ────────────────────────────────────────────────
  #build(level: readonly string[]): void {
    this.bricks = []
    this.#levelRows = level.length
    for (let r = 0; r < level.length; r++) {
      const row = level[r] ?? ''
      for (let c = 0; c < COLS; c++) {
        const ch = row[c] ?? '.'
        if (ch === '.' || ch === ' ') continue
        const hp = ch === '*' ? 4 : Math.max(1, parseInt(ch, 10) || 1)
        this.bricks.push({ x: BRICK_X0 + c * BRICK_W, y: BRICK_TOP + r * BRICK_H, w: BRICK_W, h: BRICK_H, hp, max: hp, alive: true, col: c, row: r })
      }
    }
    this.#spawnShip()
  }

  #spawnShip(): void {
    const dir = Math.random() < 0.5 ? 1 : -1
    this.alien = { x: dir > 0 ? ALIEN_W / 2 : W - ALIEN_W / 2, y: ALIEN_Y, vx: ALIEN_SPEED * dir, frame: 0 }
  }

  /** March the alien ship; when none is up, fly the next one in after a beat. */
  #stepAlien(dt: number): void {
    const a = this.alien
    if (!a) {
      this.#shipRespawn -= dt
      if (this.#shipRespawn <= 0) this.#spawnShip()
      return
    }
    a.x += a.vx * dt
    if (a.x < ALIEN_W / 2) { a.x = ALIEN_W / 2; a.vx = Math.abs(a.vx) }
    else if (a.x > W - ALIEN_W / 2) { a.x = W - ALIEN_W / 2; a.vx = -Math.abs(a.vx) }
    a.frame += dt
  }

  /** Shoot the ship down: explode, drop ONE power-up, and queue the next ship. */
  #destroyShip(): void {
    const a = this.alien
    if (!a) return
    this.explosions.push({ x: a.x, y: a.y, t: 0 })
    this.capsules.push({ x: a.x, y: a.y + ALIEN_H / 2, kind: this.#randomPower() })
    this.#addScore(100)
    this.alien = null
    this.#shipRespawn = SHIP_RESPAWN
  }

  /** True if (x,y) is inside the ship — used by laser/beam hits. */
  #shipHitAt(x: number, y: number): boolean {
    const a = this.alien
    return !!a && x >= a.x - ALIEN_W / 2 && x <= a.x + ALIEN_W / 2 && y >= a.y - ALIEN_H / 2 && y <= a.y + ALIEN_H / 2
  }

  /** Ball reaches the ship: bounce it down and shoot the ship out of the sky. */
  #alienBounce(b: Ball): void {
    const a = this.alien
    if (!a) return
    const cx = clamp(b.x, a.x - ALIEN_W / 2, a.x + ALIEN_W / 2)
    const cy = clamp(b.y, a.y - ALIEN_H / 2, a.y + ALIEN_H / 2)
    const dx = b.x - cx, dy = b.y - cy
    if (dx * dx + dy * dy > b.r * b.r) return
    b.vy = Math.abs(b.vy)                                   // send it back down
    b.y = a.y + ALIEN_H / 2 + b.r + 1
    this.#destroyShip()
  }

  /** Tag one random live brick as a sparkling seed that will bloom into a mega.
   *  Earned by landing hits on the hunter (every MEGA_HIT_INTERVAL hits), not
   *  spawned at level start. */
  #seedMega(): void {
    const candidates = this.bricks.filter(b => b.alive && !b.mega && !b.seed && b.col !== undefined)
    if (!candidates.length) return
    const seed = candidates[Math.floor(Math.random() * candidates.length)]
    seed.seed = true
    seed.bloom = MEGA_BLOOM_DELAY
  }

  /** Count a hit on the hunter; every MEGA_HIT_INTERVAL hits earns a mega seed. */
  #countEnemyHit(): void {
    this.#enemyHits++
    if (this.#enemyHits % MEGA_HIT_INTERVAL === 0) this.#seedMega()
  }

  /** Tick seed bloom timers; a ripe seed blooms into a mega brick. */
  #stepBricks(dt: number): void {
    for (const b of this.bricks) {
      if (b.seed && b.alive && b.bloom !== undefined) {
        b.bloom -= dt
        if (b.bloom <= 0) this.#bloomSeed(b)
      }
    }
  }

  /** Grow a seed into a big brick over an MEGA_COLS×MEGA_ROWS block, covering
   *  (consuming) any bricks inside the footprint, the seed included. */
  #bloomSeed(seed: Brick): void {
    const cols = MEGA_COLS, rows = MEGA_ROWS
    const c0 = clamp((seed.col ?? 0) - Math.floor(cols / 2), 0, Math.max(0, COLS - cols))
    const r0 = clamp(seed.row ?? 0, 0, Math.max(0, this.#levelRows - rows))
    for (const b of this.bricks) {
      if (!b.alive || b.mega) continue
      if (b.col !== undefined && b.row !== undefined
        && b.col >= c0 && b.col < c0 + cols && b.row >= r0 && b.row < r0 + rows) {
        b.alive = false
        b.seed = false
        b.covered = true                      // silently consumed — not a player kill (no death FX)
      }
    }
    const mx = BRICK_X0 + c0 * BRICK_W, my = BRICK_TOP + r0 * BRICK_H
    const mw = cols * BRICK_W, mh = rows * BRICK_H
    this.bricks.push({
      x: mx, y: my, w: mw, h: mh,
      hp: MEGA_HP, max: MEGA_HP, alive: true,
      mega: true, col: c0, row: r0, megaCols: cols, megaRows: rows,
    })
    // Never let the mega be born on top of a live ball — eject any whose centre
    // lands inside the new block out to its nearest edge (avoids deep-penetration
    // that #brickHits can't cleanly resolve).
    for (const b of this.balls) {
      if (b.stuck || b.x < mx || b.x > mx + mw || b.y < my || b.y > my + mh) continue
      const dl = b.x - mx, dr = mx + mw - b.x, dtop = b.y - my, dbot = my + mh - b.y
      const m = Math.min(dl, dr, dtop, dbot)
      if (m === dl) { b.x = mx - b.r; b.vx = -Math.abs(b.vx) }
      else if (m === dr) { b.x = mx + mw + b.r; b.vx = Math.abs(b.vx) }
      else if (m === dtop) { b.y = my - b.r; b.vy = -Math.abs(b.vy) }
      else { b.y = my + mh + b.r; b.vy = Math.abs(b.vy) }
    }
  }

  /** Shatter a destroyed mega into 1-hit shards filling its footprint; EVERY shard
   *  is a guaranteed power-up tile — each drops a (weighted-random) power-up when
   *  broken, so cracking the big block rains a bonanza of pills. */
  #breakMega(mega: Brick): void {
    const c0 = mega.col ?? 0, r0 = mega.row ?? 0
    const cc = mega.megaCols ?? MEGA_COLS, rr = mega.megaRows ?? MEGA_ROWS
    const shards: Brick[] = []
    for (let r = r0; r < r0 + rr; r++) {
      for (let c = c0; c < c0 + cc; c++) {
        shards.push({ x: BRICK_X0 + c * BRICK_W, y: BRICK_TOP + r * BRICK_H, w: BRICK_W, h: BRICK_H, hp: 1, max: 1, alive: true, col: c, row: r, drop: this.#randomPower() })
      }
    }
    this.bricks.push(...shards)
    this.#addScore(80)
  }

  #newBall(x: number, y: number, vx: number, vy: number, stuck = false, primary = false): Ball {
    return { x, y, vx, vy, r: BALL_R, stuck, wobble: 0, primary, color: primary ? BALL_WHITE : this.#pickColor() }
  }

  /** Next colour for an ammo ball, cycling the palette so consecutive shots differ. */
  #pickColor(): string {
    const c = BALL_COLORS[this.#colorIdx % BALL_COLORS.length]
    this.#colorIdx++
    return c
  }

  /** The white primary ball, stuck to the bat — the one you must keep alive. */
  #stuckBall(): Ball {
    return this.#newBall(this.paddle.x, this.paddle.y - BALL_R - 1, 0, 0, true, true)
  }

  /** Reset bat width + a single stuck ball + clear power state (load or after a
   *  death). Keeps the bat's current X (only re-clamps to the base width) so a
   *  lost ball never teleports the bat to centre mid-game; the constructor seeds
   *  the initial centre via the field initializer. */
  #resetForLife(): void {
    this.paddle.w = PADDLE_W
    this.paddle.x = clamp(this.paddle.x, PADDLE_W / 2, W - PADDLE_W / 2)
    this.#prevPaddleX = this.paddle.x
    this.balls = [this.#stuckBall()]
    this.capsules = []
    this.lasers = []
    this.rockets = []
    this.explosions = []
    this.enemy = null
    this.bumpers = []
    this.combo = 0
    this.comboPops = []
    this.pickups = []
    this.#levelClock = 0
    this.laserTimer = this.expandTimer = this.magnetTimer = this.multTimer = this.burstTimer = this.pinballTimer = 0
    this.beamShots = this.beamLevel = this.beamCharge = this.beamFlash = 0
    this.oscillateStacks = 0
    this.scoreMul = 1
    this.gunAmmo = this.gunLevel = this.rocketAmmo = 0
    this.#laserCd = this.#gunCd = 0
    this.aimAngle = GUN_AIM_CENTER
    this.input.left = this.input.right = false
    this.#pointerX = null
  }

  get bricksLeft(): number {
    let n = 0
    for (const b of this.bricks) if (b.alive) n++
    return n
  }

  /** Active powers for the HUD badge row (kind, 0..1 bar, label). The gun is NOT
   *  here — it renders its own pip magazine (see gunActive). */
  get activePowers(): { kind: PowerKind; frac: number; label: string }[] {
    const out: { kind: PowerKind; frac: number; label: string }[] = []
    const addTimed = (kind: PowerKind, t: number, dur: number) => {
      if (t > 0) out.push({ kind, frac: clamp(t / dur, 0, 1), label: `${Math.ceil(t)}s` })
    }
    // Oscillate is permanent (no countdown): show its stack count, full bar.
    if (this.oscillateStacks > 0) out.push({ kind: 'oscillate', frac: 1, label: `×${this.oscillateStacks}` })
    addTimed('laser', this.laserTimer, LASER_DURATION)
    addTimed('expand', this.expandTimer, EXPAND_DURATION)
    addTimed('magnet', this.magnetTimer, MAGNET_DURATION)
    addTimed('multiplier', this.multTimer, MULT_DURATION)
    addTimed('burst', this.burstTimer, BURST_DURATION)
    addTimed('pinball', this.pinballTimer, this.#pinballDur || 15)
    if (this.beamShots > 0) {
      const lvl = this.beamLevel >= 2 ? `L${this.beamLevel}` : ''
      out.push({ kind: 'beam', frac: clamp(this.beamShots / BEAM_LOADER, 0, 1), label: `${lvl}×${this.beamShots}` })
    }
    if (this.rocketAmmo > 0 || this.rockets.length > 0) {
      out.push({ kind: 'rocket', frac: clamp(this.rocketAmmo / ROCKET_MAX, 0, 1), label: `×${this.rocketAmmo}` })
    }
    return out
  }

  get gunActive(): boolean { return this.gunAmmo > 0 }
  get gunLoaderSize(): number { return GUN_LOADER }
  /** 0..1 charge progress of the beam (purple mushroom), for the renderer. */
  get beamChargeFrac(): number { return this.beamShots > 0 ? clamp(this.beamCharge / this.beamTarget, 0, 1) : 0 }
  /** 0..1 fade of the beam's release flash, for the renderer. */
  get beamFlashFrac(): number { return clamp(this.beamFlash / BEAM_FLASH, 0, 1) }

  // ── input ────────────────────────────────────────────────
  movePaddleTo(worldX: number): void { this.#pointerX = worldX }

  /** Space / left-click: launch stuck balls, else fire gun + laser if armed.
   *  (The missile is on right-click — see fireRocket.) */
  shoot(): void {
    if (this.state !== 'playing') return
    let launched = false
    for (const b of this.balls) {
      if (!b.stuck) continue
      this.#launchBall(b)
      launched = true
    }
    if (launched) return
    if (this.gunAmmo > 0) this.#fireGun()
    if (this.laserTimer > 0) this.#fireLaser()
  }

  /** Right-click: launch the one missile if you have it and none is airborne.
   *  It flies up and explodes on the first thing it hits. */
  fireRocket(): void {
    if (this.state !== 'playing' || this.rocketAmmo <= 0 || this.rockets.length > 0) return
    this.rocketAmmo--
    this.rockets.push({ x: this.paddle.x, y: this.paddle.y - 8, vy: -ROCKET_SPEED })
  }

  /** Blast every alive brick within ROCKET_RADIUS of the rocket and leave a
   *  visual shock-ring. Does NOT remove the rocket — the caller owns that. */
  #detonateRocket(rk: Rocket): void {
    this.explosions.push({ x: rk.x, y: rk.y, t: 0 })
    // Snapshot: #breakMega appends shards, which must NOT be caught by this blast.
    for (const brick of [...this.bricks]) {
      if (!brick.alive || brick.seed) continue            // seeds are immune until they bloom
      const bxc = brick.x + brick.w / 2, byc = brick.y + brick.h / 2
      if (Math.hypot(bxc - rk.x, byc - rk.y) > ROCKET_RADIUS) continue
      if (brick.mega) { brick.alive = false; this.#breakMega(brick); continue }   // shatter, don't vaporise
      brick.alive = false
      brick.hp = 0
      this.#addScore(25)
      if (brick.drop) this.capsules.push({ x: bxc, y: byc, kind: brick.drop })
      else if (Math.random() < DROP_CHANCE) this.capsules.push({ x: bxc, y: byc, kind: this.#randomPower() })
    }
    // A rocket caught in the blast also blows the ship out of the sky.
    if (this.alien && Math.hypot(this.alien.x - rk.x, this.alien.y - rk.y) <= ROCKET_RADIUS) this.#destroyShip()
    // A rocket caught in the blast vaporises the hunter outright (and counts as a hit).
    if (this.enemy && Math.hypot(this.enemy.x - rk.x, this.enemy.y - rk.y) <= ROCKET_RADIUS) {
      this.#countEnemyHit()
      this.explosions.push({ x: this.enemy.x, y: this.enemy.y, t: 0 })
      this.enemy = null
      this.#levelClock = 0
      this.#addScore(150)
    }
    if (this.bricksLeft === 0) this.state = 'won'
  }

  #launchBall(b: Ball): void {
    b.stuck = false
    const theta = Math.random() * 0.5 - 0.25      // ±0.25 rad from straight up
    b.vx = BALL_SPEED * Math.sin(theta)
    b.vy = -BALL_SPEED * Math.cos(theta)
  }

  #fireGun(): void {
    if (this.gunAmmo <= 0 || this.#gunCd > 0 || this.balls.length >= MAX_BALLS) return
    this.#gunCd = GUN_COOLDOWN
    this.gunAmmo--                         // one shot out of the loader
    const a = this.aimAngle
    // Volley by stack level: L1 single, L2 adds two diagonals, L3 doubles each.
    const dirs = this.gunLevel >= 2 ? [a, a - GUN_DIAG_SPREAD, a + GUN_DIAG_SPREAD] : [a]
    const split = this.gunLevel >= 3 ? [-GUN_DOUBLE_JITTER, GUN_DOUBLE_JITTER] : [0]
    for (const dir of dirs) {
      for (const j of split) {
        // Re-clamp into the up-fan so every gun ball climbs well past half height.
        if (!this.#spawnGunBall(clamp(dir + j, GUN_AIM_MIN, GUN_AIM_MAX))) return
      }
    }
  }

  /** Spawn one coloured ammo ball fired along `ang`. Returns false (and spawns
   *  nothing) once the on-screen ball cap is reached, so a volley stops cleanly. */
  #spawnGunBall(ang: number): boolean {
    if (this.balls.length >= MAX_BALLS) return false
    const r = BALL_R + 4
    this.balls.push(this.#newBall(
      this.paddle.x + Math.cos(ang) * r,
      this.paddle.y - 2 + Math.sin(ang) * r,
      Math.cos(ang) * BALL_SPEED,
      Math.sin(ang) * BALL_SPEED,
    ))
    return true
  }

  #fireLaser(): void {
    if (this.#laserCd > 0) return
    this.#laserCd = LASER_COOLDOWN
    const y = this.paddle.y - 4
    this.lasers.push({ x: this.paddle.x - this.paddle.w / 2 + 7, y }, { x: this.paddle.x + this.paddle.w / 2 - 7, y })
  }

  // ── per-frame update ─────────────────────────────────────
  update(dt: number): void {
    if (this.state !== 'playing') return
    this.#tickPowers(dt)
    this.#movePaddle(dt)
    if (this.#laserCd > 0) this.#laserCd = Math.max(0, this.#laserCd - dt)
    if (this.#gunCd > 0) this.#gunCd = Math.max(0, this.#gunCd - dt)

    for (const b of this.balls) {
      if (b.stuck) { b.x = this.paddle.x; b.y = this.paddle.y - b.r - 1; continue }
      // Sub-step so a fast ball can't tunnel through a brick or the paddle.
      const dist = Math.hypot(b.vx, b.vy) * dt
      const steps = Math.max(1, Math.ceil(dist / (b.r * 0.9)))
      const sdt = dt / steps
      for (let i = 0; i < steps && this.state === 'playing'; i++) this.#step(b, sdt)
    }

    // Drop balls that fell past the floor. The WHITE (primary) ball is your
    // life: lose it and a life is gone even while coloured ammo balls are still
    // in play — they clear bricks but never save you. (No primary remaining also
    // covers the plain case of every ball being gone.)
    this.balls = this.balls.filter(b => b.y - b.r <= H)
    if (!this.balls.some(b => b.primary)) { this.#loseLife(); return }

    this.#stepCapsules(dt)
    this.#stepLasers(dt)
    this.#stepRockets(dt)
    this.#stepExplosions(dt)
    this.#stepEnemy(dt)
    this.#stepBricks(dt)
    this.#stepAlien(dt)
    if (this.comboPops.length) { for (const p of this.comboPops) p.t += dt; this.comboPops = this.comboPops.filter(p => p.t < COMBO_POP_DUR) }
    if (this.pickups.length) { for (const p of this.pickups) p.t += dt; this.pickups = this.pickups.filter(p => p.t < PICKUP_DUR) }
    if (this.bricksLeft === 0) this.state = 'won'
  }

  #spawnEnemy(): void {
    this.enemy = { x: W * (0.2 + Math.random() * 0.6), y: BRICK_TOP * 0.5, hp: ENEMY_HP }
  }

  /** The hunter: appears once you've dawdled and homes the white ball. A hit on
   *  the white ball whacks it away at TOP SPEED (no life lost — the fast ball is
   *  just on screen a shorter time); coloured ammo / lasers chip the hunter. */
  #stepEnemy(dt: number): void {
    if (!this.enemy) {
      this.#levelClock += dt
      if (this.#levelClock >= ENEMY_SPAWN_DELAY && this.bricksLeft > 0) this.#spawnEnemy()
      return
    }
    const e = this.enemy
    const target = this.balls.find(b => b.primary && !b.stuck)
    if (target) {
      const dx = target.x - e.x, dy = target.y - e.y
      const d = Math.hypot(dx, dy) || 1
      e.x += (dx / d) * ENEMY_SPEED * dt
      e.y += (dy / d) * ENEMY_SPEED * dt
    }
    // Ball contact: the WHITE ball is whacked away at top speed (no life lost —
    // the danger is the fast ball is on screen a shorter time) AND it chips the
    // hunter, so 3 ball hits destroy it. Coloured ammo ricochets and hurts too.
    for (const b of this.balls) {
      if (b.stuck) continue
      const dx = b.x - e.x, dy = b.y - e.y
      const d = Math.hypot(dx, dy)
      if (d > ENEMY_R + b.r) continue
      if (b.primary) {
        const ndp = d || 1
        b.vx = (dx / ndp) * BALL_SPEED_MAX; b.vy = (dy / ndp) * BALL_SPEED_MAX     // whacked away, fast
        b.x = e.x + (dx / ndp) * (ENEMY_R + b.r + 1); b.y = e.y + (dy / ndp) * (ENEMY_R + b.r + 1)
        if (this.#hurtEnemy()) return                                             // 1 of 3 hits — no life lost
        continue
      }
      const nd = d || 1, sp = Math.hypot(b.vx, b.vy) || BALL_SPEED
      b.vx = (dx / nd) * sp; b.vy = (dy / nd) * sp                 // ricochet away from the hunter
      b.x = e.x + (dx / nd) * (ENEMY_R + b.r + 1); b.y = e.y + (dy / nd) * (ENEMY_R + b.r + 1)
      if (this.#hurtEnemy()) return
    }
    // Lasers zap it too.
    if (this.lasers.length) {
      const survive: Laser[] = []
      for (const l of this.lasers) {
        if (Math.hypot(l.x - e.x, l.y - e.y) <= ENEMY_R) { if (this.#hurtEnemy()) return; continue }
        survive.push(l)
      }
      this.lasers = survive
    }
  }

  /** Damage the hunter; returns true once it dies (blast + bounty + reset clock). */
  #hurtEnemy(): boolean {
    const e = this.enemy
    if (!e) return false
    this.#countEnemyHit()                             // every 5th hit earns a mega seed
    e.hp--
    this.#addScore(15)
    if (e.hp <= 0) {
      this.explosions.push({ x: e.x, y: e.y, t: 0 })
      this.enemy = null
      this.#levelClock = 0
      this.#addScore(150)
      return true
    }
    return false
  }

  #stepRockets(dt: number): void {
    if (!this.rockets.length) return
    const survive: Rocket[] = []
    for (const rk of this.rockets) {
      rk.y += rk.vy * dt
      if (rk.y <= 0) { this.#detonateRocket(rk); continue }      // hit the ceiling
      let hit = false
      for (const brick of this.bricks) {
        if (!brick.alive) continue
        if (rk.x >= brick.x && rk.x <= brick.x + brick.w && rk.y - 9 <= brick.y + brick.h && rk.y >= brick.y) { hit = true; break }
      }
      // Also explode on contact with the hunter or the alien ship.
      if (!hit && this.enemy && Math.hypot(this.enemy.x - rk.x, this.enemy.y - rk.y) <= ENEMY_R + 4) hit = true
      if (!hit && this.#shipHitAt(rk.x, rk.y)) hit = true
      if (hit) { this.#detonateRocket(rk); continue }
      survive.push(rk)
    }
    this.rockets = survive
  }

  #stepExplosions(dt: number): void {
    if (!this.explosions.length) return
    const survive: Explosion[] = []
    for (const e of this.explosions) { e.t += dt; if (e.t < EXPLOSION_DUR) survive.push(e) }
    this.explosions = survive
  }

  #tickPowers(dt: number): void {
    // (oscillate has no timer — it's permanent for the round; the gun depletes
    //  by firing, not the clock)
    if (this.laserTimer > 0) this.laserTimer = Math.max(0, this.laserTimer - dt)
    if (this.magnetTimer > 0) this.magnetTimer = Math.max(0, this.magnetTimer - dt)
    if (this.burstTimer > 0) this.burstTimer = Math.max(0, this.burstTimer - dt)
    if (this.multTimer > 0) {
      this.multTimer = Math.max(0, this.multTimer - dt)
      if (this.multTimer === 0) this.scoreMul = 1            // multiplier ran out
    }
    if (this.expandTimer > 0) {
      this.expandTimer = Math.max(0, this.expandTimer - dt)
      if (this.expandTimer === 0) { this.paddle.w = PADDLE_W; this.paddle.x = clamp(this.paddle.x, PADDLE_W / 2, W - PADDLE_W / 2) }
    }
    if (this.pinballTimer > 0) {
      this.pinballTimer = Math.max(0, this.pinballTimer - dt)
      if (this.pinballTimer === 0) { this.bumpers = []; this.#setPrimaryRadius(BALL_R) }   // pinball over
    }
    if (this.beamShots > 0) {
      this.beamCharge += dt
      if (this.beamCharge >= this.beamTarget) {            // charge → release, then re-roll the charge time
        this.#fireBeam()
        this.beamCharge = 0
        this.beamTarget = BEAM_CHARGE_MIN + Math.random() * (BEAM_CHARGE_MAX - BEAM_CHARGE_MIN)
      }
    }
    if (this.beamFlash > 0) this.beamFlash = Math.max(0, this.beamFlash - dt)
    for (const bm of this.bumpers) if (bm.flash > 0) bm.flash = Math.max(0, bm.flash - dt * 5)
  }

  /** Release one beam shot: a single laser straight up from the paddle's middle.
   *  Level 1 = 1 damage to the column, level 2 = ×2, level 3 clears the whole line. */
  #fireBeam(): void {
    if (this.beamShots <= 0) return
    this.beamShots--
    const bx = this.paddle.x
    this.beamX = bx
    this.beamFlash = BEAM_FLASH
    const dmg = this.beamLevel >= 3 ? 99 : this.beamLevel   // L3: enough to clear any brick in the line
    for (const brick of [...this.bricks]) {            // snapshot: #damage may shatter a mega
      if (!brick.alive || brick.seed) continue          // seeds are invincible until they bloom
      if (bx >= brick.x && bx <= brick.x + brick.w) this.#damage(brick, dmg)
    }
    const a = this.alien                                // the beam also shoots a ship in its column
    if (a && bx >= a.x - ALIEN_W / 2 && bx <= a.x + ALIEN_W / 2) this.#destroyShip()
    if (this.beamShots === 0) this.beamCharge = 0
  }

  /** Set the white (primary) ball's radius — doubled in pinball mode, normal otherwise. */
  #setPrimaryRadius(r: number): void {
    for (const b of this.balls) if (b.primary) b.r = r
  }

  #movePaddle(dt: number): void {
    const half = this.paddle.w / 2
    if (this.input.left || this.input.right) {
      this.#pointerX = null
      const dir = (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0)
      this.paddle.x += dir * PADDLE_SPEED * dt
    } else if (this.#pointerX !== null) {
      this.paddle.x = this.#pointerX
    }
    this.paddle.x = clamp(this.paddle.x, half, W - half)
    // The gun aim sweeps with paddle travel, clamped to a short 120° fan
    // balanced facing up: slide left/right to swing the barrel between the stops.
    if (this.gunAmmo > 0) {
      this.aimAngle = clamp(this.aimAngle + (this.paddle.x - this.#prevPaddleX) * GUN_SENS, GUN_AIM_MIN, GUN_AIM_MAX)
    }
    this.#prevPaddleX = this.paddle.x
  }

  #step(b: Ball, dt: number): void {
    // Magnet only reels the ball in while it's above the halfway line. Below it
    // the pull releases, so after a paddle hit the ball must climb back over H/2
    // for the magnet to kick in again.
    if (this.magnetTimer > 0 && b.y < H / 2) this.#applyMagnet(b, dt)

    b.x += b.vx * dt
    b.y += b.vy * dt

    // Oscillation: layer a perpendicular sine weave onto the straight path
    // (velocity unchanged, so collisions still reflect cleanly). Permanent and
    // stacking — each O doubles the width up to the cap. Applies to EVERY
    // non-stuck ball; each carries its own phase in `b.wobble`.
    if (this.oscillateStacks > 0) {
      const amp = Math.min(WOBBLE_AMP_MAX, WOBBLE_BASE_AMP * Math.pow(2, this.oscillateStacks - 1))
      const sp = Math.hypot(b.vx, b.vy) || 1
      const px = -b.vy / sp, py = b.vx / sp
      const oldW = amp * Math.sin(b.wobble)
      b.wobble += WOBBLE_FREQ * dt
      const dW = amp * Math.sin(b.wobble) - oldW
      b.x += px * dW
      b.y += py * dW
    }

    // Walls (left / right / top).
    if (b.x - b.r < 0) { b.x = b.r; b.vx = Math.abs(b.vx) }
    else if (b.x + b.r > W) { b.x = W - b.r; b.vx = -Math.abs(b.vx) }
    if (b.y - b.r < 0) { b.y = b.r; b.vy = Math.abs(b.vy) }

    if (this.bumpers.length) this.#bumperBounce(b)        // pinball bumpers
    if (this.alien) this.#alienBounce(b)                  // bonk the top dispenser
    this.#paddleBounce(b)
    this.#brickHits(b)

    // Anti-stuck: never let the ball run too horizontal (it would loop between
    // the side walls forever). Keep at least MIN_VY_RATIO of its speed vertical,
    // preserving direction — and steering DOWN if it's dead flat, so it heads to
    // the bat. Speed is unchanged; we just rotate the velocity steeper.
    const sp = Math.hypot(b.vx, b.vy)
    if (sp > 0) {
      const minVy = sp * MIN_VY_RATIO
      if (Math.abs(b.vy) < minVy) {
        b.vy = (b.vy === 0 ? 1 : Math.sign(b.vy)) * minVy
        b.vx = Math.sign(b.vx || 1) * Math.sqrt(Math.max(0, sp * sp - b.vy * b.vy))
      }
    }
  }

  /** "Gravity" toward the paddle (the caller only runs this while the ball is in
   *  the top half). Accelerates the ball toward the bat, capped at the max ball
   *  speed so it curves home without running away. Not a sticky catch. */
  #applyMagnet(b: Ball, dt: number): void {
    const dx = this.paddle.x - b.x
    const dy = this.paddle.y - b.y
    const d = Math.hypot(dx, dy) || 1
    b.vx += (dx / d) * MAGNET_G * dt
    b.vy += (dy / d) * MAGNET_G * dt
    const sp = Math.hypot(b.vx, b.vy)
    if (sp > BALL_SPEED_MAX) { b.vx = (b.vx / sp) * BALL_SPEED_MAX; b.vy = (b.vy / sp) * BALL_SPEED_MAX }
  }

  #paddleBounce(b: Ball): void {
    const p = this.paddle
    if (b.vy <= 0) return                                  // only when descending
    if (b.y + b.r < p.y || b.y - b.r > p.y + p.h) return
    if (b.x < p.x - p.w / 2 - b.r || b.x > p.x + p.w / 2 + b.r) return
    const off = clamp((b.x - p.x) / (p.w / 2), -1, 1)
    const speed = Math.min(BALL_SPEED_MAX, Math.hypot(b.vx, b.vy) * BALL_SPEEDUP)
    const angle = off * (Math.PI / 3)                      // up to 60° off vertical
    b.vx = speed * Math.sin(angle)
    b.vy = -speed * Math.abs(Math.cos(angle))
    b.y = p.y - b.r - 0.5
    this.combo = 0                                          // ball returned to the bat — chain ends
  }

  #brickHits(b: Ball): void {
    for (const brick of this.bricks) {
      if (!brick.alive) continue
      const cx = clamp(b.x, brick.x, brick.x + brick.w)
      const cy = clamp(b.y, brick.y, brick.y + brick.h)
      const dx = b.x - cx, dy = b.y - cy
      if (dx * dx + dy * dy > b.r * b.r) continue          // no overlap
      const overlapX = b.r - Math.abs(dx)
      const overlapY = b.r - Math.abs(dy)
      if (overlapX < overlapY) {
        b.vx = dx >= 0 ? Math.abs(b.vx) : -Math.abs(b.vx)
        b.x += dx >= 0 ? overlapX : -overlapX
      } else {
        b.vy = dy >= 0 ? Math.abs(b.vy) : -Math.abs(b.vy)
        b.y += dy >= 0 ? overlapY : -overlapY
      }
      // The white ball does double damage in pinball mode.
      this.#damage(brick, this.pinballTimer > 0 && b.primary ? 2 : 1)
      return                                               // one brick per sub-step
    }
  }

  /** Add points through the active multipliers — the multiplier pill (1×/2×/3×)
   *  and a 1.6× bonus while the green oscillate mushroom is in effect. */
  #addScore(n: number): void {
    const mul = this.scoreMul * (this.oscillateStacks > 0 ? 1.6 : 1)
    this.score += Math.round(n * mul)
  }

  #damage(brick: Brick, dmg = 1): void {
    if (brick.seed) return                            // a sparkle seed is invincible until it blooms
    if (this.burstTimer > 0) brick.hp = 1             // burst: one touch destroys any brick
    brick.hp -= dmg
    this.#addScore(5)
    if (brick.hp > 0) return
    brick.alive = false
    // Combo: each brick killed since the last paddle bounce raises the chain. The
    // combo IS a score MULTIPLIER (×N) on the kill, strung together; milestones
    // earn a reward.
    this.combo++
    const cm = this.combo
    if (cm >= COMBO_MIN) {
      this.comboPops.push({ x: brick.x + brick.w / 2, y: brick.y + brick.h / 2, n: cm, t: 0 })
      if (cm % COMBO_MILESTONE === 0) this.#comboReward(cm)
    }
    if (brick.mega) { this.#breakMega(brick); return } // shatter into shards, no normal drop
    this.#addScore(20 * cm)                             // kill points strung up by the combo
    if (brick.drop) {
      this.capsules.push({ x: brick.x + brick.w / 2, y: brick.y + brick.h / 2, kind: brick.drop })
    } else if (Math.random() < DROP_CHANCE) {
      this.capsules.push({ x: brick.x + brick.w / 2, y: brick.y + brick.h / 2, kind: this.#randomPower() })
    }
  }

  /** Weighted pick — staples common, rares seldom (see POWER_WEIGHTS). */
  #randomPower(): PowerKind {
    let total = 0
    for (const k of POWER_ORDER) total += POWER_WEIGHTS[k]
    let r = Math.random() * total
    for (const k of POWER_ORDER) { r -= POWER_WEIGHTS[k]; if (r < 0) return k }
    return POWER_ORDER[0]
  }

  /** Combo milestone (×5, ×10, …): a free power-up, a fat score bonus, and an
   *  extra life at ×15. A big central popup flags it. */
  #comboReward(n: number): void {
    this.capsules.push({ x: this.alien?.x ?? W / 2, y: ALIEN_Y + ALIEN_H, kind: this.#randomPower() })
    this.#addScore(n * 30)
    if (n % 15 === 0 && this.lives < 5) this.lives++
    this.comboPops.push({ x: W / 2, y: H * 0.42, n, t: 0 })
  }

  #stepCapsules(dt: number): void {
    if (!this.capsules.length) return
    const p = this.paddle
    const survive: Capsule[] = []
    for (const cap of this.capsules) {
      cap.y += CAPSULE_SPEED * dt
      if (cap.y - CAPSULE_H / 2 > H) continue
      const caught = cap.y + CAPSULE_H / 2 >= p.y - 2
        && cap.y - CAPSULE_H / 2 <= p.y + p.h + 2
        && cap.x >= p.x - p.w / 2 - CAPSULE_W / 2
        && cap.x <= p.x + p.w / 2 + CAPSULE_W / 2
      if (caught) {
        this.#applyPower(cap.kind); this.#addScore(120)
        this.pickups.push({ x: cap.x, y: cap.y, kind: cap.kind, t: 0 })   // flash where it was grabbed
      } else survive.push(cap)
    }
    this.capsules = survive
  }

  #stepLasers(dt: number): void {
    if (!this.lasers.length) return
    const survive: Laser[] = []
    for (const l of this.lasers) {
      l.y -= LASER_SPEED * dt
      if (l.y < 0) continue
      if (this.#shipHitAt(l.x, l.y)) { this.#destroyShip(); continue }   // a laser shoots the ship
      let hit: Brick | null = null
      let lowest = -Infinity
      for (const brick of this.bricks) {
        if (!brick.alive) continue
        if (l.x >= brick.x && l.x <= brick.x + brick.w && l.y >= brick.y && l.y <= brick.y + brick.h) {
          if (brick.y > lowest) { lowest = brick.y; hit = brick }
        }
      }
      if (hit) this.#damage(hit)
      else survive.push(l)
    }
    this.lasers = survive
  }

  #applyPower(kind: PowerKind): void {
    switch (kind) {
      case 'oscillate':
        // Permanent for the round: stack the weave and nudge every ball faster.
        this.oscillateStacks++
        for (const b of this.balls) {
          if (b.stuck) continue
          const sp = Math.hypot(b.vx, b.vy) || 1
          const ns = Math.min(BALL_SPEED_MAX, sp * OSC_SPEEDUP)
          b.vx = (b.vx / sp) * ns
          b.vy = (b.vy / sp) * ns
        }
        break
      case 'break': {
        const add: Ball[] = []
        for (const b of this.balls) {
          if (this.balls.length + add.length >= MAX_BALLS) break
          const speed = Math.hypot(b.vx, b.vy) || BALL_SPEED
          const ang = b.stuck ? -Math.PI / 2 : Math.atan2(b.vy, b.vx)
          if (b.stuck) { b.stuck = false; b.vx = speed * Math.cos(ang); b.vy = speed * Math.sin(ang) }
          for (const d of [-0.35, 0.35]) {
            if (this.balls.length + add.length >= MAX_BALLS) break
            // Splits inherit the parent's kind + size: a WHITE ball splits into
            // whites (each a life-bearing primary), a coloured ammo ball into colour.
            const nb = this.#newBall(b.x, b.y, speed * Math.cos(ang + d), speed * Math.sin(ang + d), false, b.primary)
            nb.r = b.r
            add.push(nb)
          }
        }
        this.balls.push(...add)
        break
      }
      case 'laser':
        this.laserTimer = LASER_DURATION
        break
      case 'expand':
        this.paddle.w = PADDLE_EXPAND_W
        this.expandTimer = EXPAND_DURATION
        this.paddle.x = clamp(this.paddle.x, this.paddle.w / 2, W - this.paddle.w / 2)
        break
      case 'gun':
        // Stacking: a 2nd/3rd gun grabbed while the loader still has shots steps
        // the level up (diagonals, then double). A gun grabbed with an empty
        // loader starts fresh at level 1. Either way it reloads to a full 10.
        this.gunLevel = this.gunAmmo > 0 ? Math.min(GUN_MAX_LEVEL, this.gunLevel + 1) : 1
        this.gunAmmo = GUN_LOADER           // fresh 10-shot loader, no timeout
        this.aimAngle = GUN_AIM_CENTER      // balanced, facing straight up
        this.#prevPaddleX = this.paddle.x
        break
      case 'magnet':
        this.magnetTimer = MAGNET_DURATION
        break
      case 'rocket':
        this.rocketAmmo = Math.min(ROCKET_MAX, this.rocketAmmo + ROCKET_LOADER)
        break
      case 'multiplier':
        // One 2× or 3× multiplier per pickup (randomised), refreshing the timer.
        this.scoreMul = Math.random() < 0.5 ? 2 : 3
        this.multTimer = MULT_DURATION
        break
      case 'burst':
        this.burstTimer = BURST_DURATION
        break
      case 'pinball':
        this.#pinballDur = PINBALL_DURATIONS[Math.floor(Math.random() * PINBALL_DURATIONS.length)]
        this.pinballTimer = this.#pinballDur
        this.#spawnBumpers()
        this.#setPrimaryRadius(BALL_R * 2)            // white ball doubles in size
        break
      case 'beam':
        // Stacking like the gun: another beam before the loader empties powers it
        // up (1 → 2 → 3, where 3 clears the whole line); either way reloads to 4.
        this.beamLevel = this.beamShots > 0 ? Math.min(BEAM_MAX_LEVEL, this.beamLevel + 1) : 1
        this.beamShots = BEAM_LOADER
        this.beamCharge = 0                           // charges up before the first release
        this.beamTarget = BEAM_CHARGE_MIN + Math.random() * (BEAM_CHARGE_MAX - BEAM_CHARGE_MIN)
        break
    }
  }

  /** Two field bumpers in the open "non-tile" zone below the bricks. */
  #spawnBumpers(): void {
    this.bumpers = [
      { x: W * 0.3, y: BUMPER_Y, r: BUMPER_R, flash: 0 },
      { x: W * 0.7, y: BUMPER_Y, r: BUMPER_R, flash: 0 },
    ]
  }

  /** Pinball bumper: push the ball out, reflect it, and add a speed kick. */
  #bumperBounce(b: Ball): void {
    for (const bm of this.bumpers) {
      const dx = b.x - bm.x, dy = b.y - bm.y
      const d = Math.hypot(dx, dy)
      const rr = bm.r + b.r
      if (d >= rr || d === 0) continue
      const nx = dx / d, ny = dy / d
      b.x = bm.x + nx * rr; b.y = bm.y + ny * rr                 // push clear of the bumper
      const vdot = b.vx * nx + b.vy * ny
      if (vdot < 0) { b.vx -= 2 * vdot * nx; b.vy -= 2 * vdot * ny }   // reflect about the normal
      const cur = Math.hypot(b.vx, b.vy) || 1
      const sp = Math.min(BALL_SPEED_MAX, cur + BUMPER_KICK)
      b.vx = (b.vx / cur) * sp; b.vy = (b.vy / cur) * sp          // pinball kick
      bm.flash = 1
      this.#addScore(10)
    }
  }

  #loseLife(): void {
    this.lives--
    if (this.lives <= 0) { this.lives = 0; this.state = 'gameover'; return }
    this.#resetForLife()
  }

  /** Continue after a game over: refill lives and drop a fresh ball onto the level
   *  where you fell — score and surviving bricks are kept, so you play right on. */
  continueGame(): void {
    if (this.state !== 'gameover') return
    this.lives = START_LIVES
    this.state = 'playing'
    this.#resetForLife()
  }
}
