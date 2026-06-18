// diamondcoreprocessor.com/games/arkanoid/engine.ts
//
// Pure game state + physics for the Arkanoid / Breakout game. No DOM, no
// canvas — the overlay owns those and calls update(dt) each frame, then the
// renderer draws this state. Everything works in fixed WORLD units (W×H); the
// overlay scales the world to fit the screen (DPR-aware), same split as the
// bubble/solomon engines.
//
// Bricks drop power-up "pills" the paddle can catch:
//   O oscillate — balls weave on a sine path instead of a straight line
//   B break     — every ball splits into more (multi-ball)
//   L laser     — Space fires upward beams (countdown-timed)
//   E expand     — wider paddle (countdown-timed)
//   G gun       — Space fires balls along an aim you steer by moving the
//                 paddle; the aim sweeps all the way around (countdown-timed)

export type GameState = 'playing' | 'won' | 'gameover'
export type PowerKind = 'oscillate' | 'break' | 'laser' | 'expand' | 'gun'

export interface Brick { x: number; y: number; w: number; h: number; hp: number; max: number; alive: boolean }
export interface Ball { x: number; y: number; vx: number; vy: number; r: number; stuck: boolean; wobble: number }
export interface Capsule { x: number; y: number; kind: PowerKind }
export interface Laser { x: number; y: number }

export interface PowerMeta { letter: string; color: string; name: string }
export const POWER_META: Record<PowerKind, PowerMeta> = {
  oscillate: { letter: 'O', color: '#5fe0c0', name: 'oscillate' },
  break: { letter: 'B', color: '#ff9f43', name: 'break apart' },
  laser: { letter: 'L', color: '#ff5b5b', name: 'laser' },
  expand: { letter: 'E', color: '#5fe08a', name: 'expand' },
  gun: { letter: 'G', color: '#b07bff', name: 'gun' },
}
const POWER_ORDER: PowerKind[] = ['oscillate', 'break', 'laser', 'expand', 'gun']

// ── World geometry (units; the overlay scales to fit) ──────────────
export const COLS = 11
export const BRICK_W = 42
export const BRICK_H = 20
export const W = COLS * BRICK_W      // 462
export const H = 600
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
const START_LIVES = 3
const MAX_BALLS = 9

const CAPSULE_W = 30
const CAPSULE_H = 15
const CAPSULE_SPEED = 135
const DROP_CHANCE = 0.24             // per brick destroyed

const LASER_SPEED = 640
const LASER_COOLDOWN = 0.2
const LASER_DURATION = 10

const GUN_DURATION = 10
const GUN_COOLDOWN = 0.17
const GUN_SENS = 0.05                 // radians of aim per px of paddle travel

const EXPAND_DURATION = 13

const WOBBLE_DURATION = 11
const WOBBLE_AMP = 1.35               // px of lateral weave (kept small: no tunneling)
const WOBBLE_FREQ = 15                // rad/s

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

  // Timed power state (seconds remaining; 0 = inactive).
  wobbleTimer = 0
  laserTimer = 0
  expandTimer = 0
  gunTimer = 0
  /** Gun aim, radians (0 = +x, -PI/2 = straight up). Steered by paddle motion. */
  aimAngle = -Math.PI / 2

  /** Set by the overlay from keyboard. */
  input = { left: false, right: false }
  #pointerX: number | null = null
  #laserCd = 0
  #gunCd = 0
  #prevPaddleX = W / 2

  constructor(level: readonly string[]) {
    this.#build(level)
    this.#resetForLife()
  }

  // ── setup ────────────────────────────────────────────────
  #build(level: readonly string[]): void {
    this.bricks = []
    for (let r = 0; r < level.length; r++) {
      const row = level[r] ?? ''
      for (let c = 0; c < COLS; c++) {
        const ch = row[c] ?? '.'
        if (ch === '.' || ch === ' ') continue
        const hp = ch === '*' ? 4 : Math.max(1, parseInt(ch, 10) || 1)
        this.bricks.push({ x: c * BRICK_W, y: BRICK_TOP + r * BRICK_H, w: BRICK_W, h: BRICK_H, hp, max: hp, alive: true })
      }
    }
  }

  #newBall(x: number, y: number, vx: number, vy: number, stuck = false): Ball {
    return { x, y, vx, vy, r: BALL_R, stuck, wobble: 0 }
  }

  #stuckBall(): Ball {
    return this.#newBall(this.paddle.x, this.paddle.y - BALL_R - 1, 0, 0, true)
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
    this.wobbleTimer = this.laserTimer = this.expandTimer = this.gunTimer = 0
    this.#laserCd = this.#gunCd = 0
    this.aimAngle = -Math.PI / 2
    this.input.left = this.input.right = false
    this.#pointerX = null
  }

  get bricksLeft(): number {
    let n = 0
    for (const b of this.bricks) if (b.alive) n++
    return n
  }

  /** Active timed powers for the HUD countdown (kind, whole seconds, 0..1 bar). */
  get activePowers(): { kind: PowerKind; secs: number; frac: number }[] {
    const out: { kind: PowerKind; secs: number; frac: number }[] = []
    const add = (kind: PowerKind, t: number, dur: number) => {
      if (t > 0) out.push({ kind, secs: Math.ceil(t), frac: clamp(t / dur, 0, 1) })
    }
    add('oscillate', this.wobbleTimer, WOBBLE_DURATION)
    add('laser', this.laserTimer, LASER_DURATION)
    add('expand', this.expandTimer, EXPAND_DURATION)
    add('gun', this.gunTimer, GUN_DURATION)
    return out
  }

  get gunActive(): boolean { return this.gunTimer > 0 }

  // ── input ────────────────────────────────────────────────
  movePaddleTo(worldX: number): void { this.#pointerX = worldX }

  /** Space / click. Launches stuck balls; otherwise fires gun + laser if armed. */
  shoot(): void {
    if (this.state !== 'playing') return
    let launched = false
    for (const b of this.balls) {
      if (!b.stuck) continue
      this.#launchBall(b)
      launched = true
    }
    if (launched) return
    if (this.gunTimer > 0) this.#fireGun()
    if (this.laserTimer > 0) this.#fireLaser()
  }

  #launchBall(b: Ball): void {
    b.stuck = false
    const theta = Math.random() * 0.5 - 0.25      // ±0.25 rad from straight up
    b.vx = BALL_SPEED * Math.sin(theta)
    b.vy = -BALL_SPEED * Math.cos(theta)
  }

  #fireGun(): void {
    if (this.#gunCd > 0 || this.balls.length >= MAX_BALLS) return
    this.#gunCd = GUN_COOLDOWN
    const r = BALL_R + 4
    this.balls.push(this.#newBall(
      this.paddle.x + Math.cos(this.aimAngle) * r,
      this.paddle.y - 2 + Math.sin(this.aimAngle) * r,
      Math.cos(this.aimAngle) * BALL_SPEED,
      Math.sin(this.aimAngle) * BALL_SPEED,
    ))
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

    // Drop balls that fell past the floor; losing the last one costs a life.
    this.balls = this.balls.filter(b => b.y - b.r <= H)
    if (this.balls.length === 0) { this.#loseLife(); return }

    this.#stepCapsules(dt)
    this.#stepLasers(dt)
    if (this.bricksLeft === 0) this.state = 'won'
  }

  #tickPowers(dt: number): void {
    if (this.wobbleTimer > 0) this.wobbleTimer = Math.max(0, this.wobbleTimer - dt)
    if (this.laserTimer > 0) this.laserTimer = Math.max(0, this.laserTimer - dt)
    if (this.gunTimer > 0) this.gunTimer = Math.max(0, this.gunTimer - dt)
    if (this.expandTimer > 0) {
      this.expandTimer = Math.max(0, this.expandTimer - dt)
      if (this.expandTimer === 0) { this.paddle.w = PADDLE_W; this.paddle.x = clamp(this.paddle.x, PADDLE_W / 2, W - PADDLE_W / 2) }
    }
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
    // The gun aim sweeps with paddle travel — slide to aim "around the outside".
    if (this.gunTimer > 0) this.aimAngle += (this.paddle.x - this.#prevPaddleX) * GUN_SENS
    this.#prevPaddleX = this.paddle.x
  }

  #step(b: Ball, dt: number): void {
    b.x += b.vx * dt
    b.y += b.vy * dt

    // Oscillation: layer a small perpendicular sine weave onto the straight
    // path (velocity unchanged, so collisions still reflect cleanly).
    if (this.wobbleTimer > 0) {
      const sp = Math.hypot(b.vx, b.vy) || 1
      const px = -b.vy / sp, py = b.vx / sp
      const oldW = WOBBLE_AMP * Math.sin(b.wobble)
      b.wobble += WOBBLE_FREQ * dt
      const dW = WOBBLE_AMP * Math.sin(b.wobble) - oldW
      b.x += px * dW
      b.y += py * dW
    }

    // Walls (left / right / top).
    if (b.x - b.r < 0) { b.x = b.r; b.vx = Math.abs(b.vx) }
    else if (b.x + b.r > W) { b.x = W - b.r; b.vx = -Math.abs(b.vx) }
    if (b.y - b.r < 0) { b.y = b.r; b.vy = Math.abs(b.vy) }

    this.#paddleBounce(b)
    this.#brickHits(b)
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
      this.#damage(brick)
      return                                               // one brick per sub-step
    }
  }

  #damage(brick: Brick): void {
    brick.hp--
    this.score += 5
    if (brick.hp > 0) return
    brick.alive = false
    this.score += 20
    if (Math.random() < DROP_CHANCE) {
      this.capsules.push({ x: brick.x + brick.w / 2, y: brick.y + brick.h / 2, kind: this.#randomPower() })
    }
  }

  #randomPower(): PowerKind { return POWER_ORDER[Math.floor(Math.random() * POWER_ORDER.length)] }

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
      if (caught) { this.#applyPower(cap.kind); this.score += 120 }
      else survive.push(cap)
    }
    this.capsules = survive
  }

  #stepLasers(dt: number): void {
    if (!this.lasers.length) return
    const survive: Laser[] = []
    for (const l of this.lasers) {
      l.y -= LASER_SPEED * dt
      if (l.y < 0) continue
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
        this.wobbleTimer = WOBBLE_DURATION
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
            add.push(this.#newBall(b.x, b.y, speed * Math.cos(ang + d), speed * Math.sin(ang + d)))
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
        this.gunTimer = GUN_DURATION
        this.aimAngle = -Math.PI / 2
        this.#prevPaddleX = this.paddle.x
        break
    }
  }

  #loseLife(): void {
    this.lives--
    if (this.lives <= 0) { this.lives = 0; this.state = 'gameover'; return }
    this.#resetForLife()
  }
}
