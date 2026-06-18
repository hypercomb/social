// diamondcoreprocessor.com/games/bubble/engine.ts
//
// Bubble Bobble — pure game engine. Framework-free: no DOM, no Pixi, no IoC.
// The overlay drives it (input + a fixed-timestep update loop) and the renderer
// draws its public state. Keeping this module pure makes the game trivially
// testable and mirrors the sibling Solomon engine's shape.
//
// The verbs: Bub the dragon walks + jumps on a single screen of floating
// platforms and BLOWS BUBBLES. A bubble shoots forward, then drifts UP through
// the terrain to the top of the screen. A bubble that touches an enemy traps
// it; jump into a trapped-enemy bubble to pop it and defeat the foe, which
// drops fruit. Clear every enemy to advance.
//
// Terrain is BUBBLE BOBBLE one-way platforms: solid only from ABOVE (you land
// on top), passable from below and sideways — so you jump UP through blocks and
// never get stuck on a ceiling. The screen WRAPS on every edge: hop off the top
// and you come up through the floor; walk off a side and you reappear opposite.

export const TILE = 40

// Tile codes. EMPTY is passable; WALL is a one-way platform (solid from above).
export const EMPTY = 0
export const WALL = 1
export type TileCode = 0 | 1

export interface Cell { col: number; row: number }
export interface EnemySpawn extends Cell { dir?: 1 | -1; kind?: number }

export interface LevelDef {
  name: string
  cols: number
  rows: number
  /** rows*cols tile codes, row-major. */
  tiles: number[]
  player: Cell
  enemies: EnemySpawn[]
}

export type GameState = 'playing' | 'won' | 'gameover'

interface Body { x: number; y: number; w: number; h: number; vx: number; vy: number }

export interface Enemy extends Body {
  dir: 1 | -1
  alive: boolean
  captured: boolean      // held inside a bubble (AI suspended, follows the bubble)
  angry: boolean         // escaped a bubble once — faster + redder
  kind: number           // visual variant
  grace: number          // post-release seconds during which it can't kill Bub
  bob: number            // idle animation phase (renderer reads it)
}

export interface Bubble {
  x: number; y: number
  vx: number
  phase: 'shoot' | 'float'
  age: number            // seconds alive (drives wobble + rim hue)
  life: number           // seconds remaining before it pops on its own
  r: number
  enemy: Enemy | null    // a trapped foe, or null for an empty bubble
  popped: boolean        // marked for removal this frame
}

export type FruitKind = 0 | 1 | 2 | 3

export interface Fruit extends Body { kind: FruitKind; life: number; taken: boolean; rest: boolean }

export interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; hue: number; r: number }

// Tuning — pixels, pixels/second, pixels/second².
const GRAVITY = 1750
const MOVE_SPEED = 178
const MAX_FALL = 760
const PLAYER_W = TILE * 0.74
const PLAYER_H = TILE * 0.86
const JUMP_V = 580                    // clears ~2 tiles
const COYOTE = 0.09                   // brief grounded grace after leaving a ledge
const LAND_EPS = 2                    // slack (px) for one-way platform landing

const ENEMY_SPEED = 58
const ENEMY_ANGRY_SPEED = 104
const ENEMY_W = TILE * 0.72
const ENEMY_H = TILE * 0.72
const ENEMY_RELEASE_GRACE = 0.5

// Bubbles: blow rate, shoot phase, drift, lifespan, trapped-escape window.
const BLOW_COOLDOWN = 0.26
const MAX_BUBBLES = 16
const BUBBLE_R = TILE * 0.52
const BUBBLE_SHOOT_SPEED = 360
const BUBBLE_SHOOT_TIME = 0.42
const BUBBLE_RISE = 64                 // float-up speed — bubbles pass through terrain
const BUBBLE_SWAY = 16                 // horizontal drift amplitude while floating
const BUBBLE_LIFE = 11
const BUBBLE_TRAP_LIFE = 7             // a trapped enemy gets this long before escaping
const BUBBLE_BOUNCE_V = 430           // upward kick when Bub lands on a bubble's crown

const FRUIT_LIFE = 7
const POP_SCORE = 100                  // base, multiplied by the chain count
const FRUIT_SCORE = [300, 500, 700, 1000] as const
const CHAIN_WINDOW = 1.1               // seconds to land the next pop and grow the chain

export class Engine {
  level: LevelDef
  cols: number
  rows: number
  grid: Uint8Array

  player: Body & { facing: 1 | -1 } = { x: 0, y: 0, w: PLAYER_W, h: PLAYER_H, vx: 0, vy: 0, facing: 1 }
  onGround = false
  walking = false
  blowFlash = 0          // mouth-open animation timer the renderer reads
  invuln = 0             // post-respawn invulnerability (also a blink cue)
  #coyote = 0
  #blowCooldown = 0

  enemies: Enemy[] = []
  bubbles: Bubble[] = []
  fruits: Fruit[] = []
  particles: Particle[] = []

  lives = 3
  score = 0
  state: GameState = 'playing'

  chain = 0
  #chainTimer = 0
  hurtFlash = 0

  // Held input — the overlay writes these from key events. Jump + blow are
  // edge-triggered methods, not held flags.
  input = { left: false, right: false }

  constructor(level: LevelDef) {
    this.level = level
    this.cols = level.cols
    this.rows = level.rows
    this.grid = new Uint8Array(level.cols * level.rows)
    this.load(level)
  }

  get width(): number { return this.cols * TILE }
  get height(): number { return this.rows * TILE }

  /** (Re)load a level from its definition, resetting score + lives. */
  load(level: LevelDef): void {
    this.level = level
    this.cols = level.cols
    this.rows = level.rows
    this.grid = Uint8Array.from(level.tiles.slice(0, level.cols * level.rows))
    this.score = 0
    this.lives = 3
    this.spawn()
  }

  /** Reset Bub, enemies, bubbles + fruit to the level start. Keeps lives + score. */
  spawn(): void {
    this.grid = Uint8Array.from(this.level.tiles.slice(0, this.cols * this.rows))
    const p = this.level.player
    this.player.w = PLAYER_W
    this.player.h = PLAYER_H
    this.player.x = p.col * TILE + (TILE - PLAYER_W) / 2
    this.player.y = p.row * TILE + (TILE - PLAYER_H)
    this.player.vx = 0
    this.player.vy = 0
    this.player.facing = 1
    this.onGround = false
    this.#coyote = 0
    this.#blowCooldown = 0
    this.blowFlash = 0
    this.invuln = 1.4
    this.input.left = this.input.right = false
    this.bubbles = []
    this.fruits = []
    this.particles = []
    this.chain = 0
    this.#chainTimer = 0
    this.hurtFlash = 0
    this.enemies = this.level.enemies.map(e => ({
      x: e.col * TILE + (TILE - ENEMY_W) / 2,
      y: e.row * TILE + (TILE - ENEMY_H),
      w: ENEMY_W, h: ENEMY_H, vx: 0, vy: 0,
      dir: e.dir ?? 1, alive: true, captured: false, angry: false,
      kind: e.kind ?? 0, grace: 0, bob: Math.PI * (e.col + e.row),
    }))
    this.state = 'playing'
  }

  // ── tile helpers ─────────────────────────────────────────

  inBounds(col: number, row: number): boolean {
    return col >= 0 && col < this.cols && row >= 0 && row < this.rows
  }

  tileAt(col: number, row: number): number {
    if (!this.inBounds(col, row)) return EMPTY  // open world — outside is empty, wrap handles edges
    return this.grid[row * this.cols + col]
  }

  /** Is there a one-way platform tile anywhere under [x, x+w) at `row`?
   *  Columns wrap horizontally so a body straddling the screen seam still
   *  reads the platform on the far side. Rows outside the field are empty. */
  #platformRow(x: number, w: number, row: number): boolean {
    if (row < 0 || row >= this.rows) return false
    const c0 = Math.floor(x / TILE)
    const c1 = Math.floor((x + w - 1) / TILE)
    for (let c = c0; c <= c1; c++) {
      const cc = ((c % this.cols) + this.cols) % this.cols
      if (this.grid[row * this.cols + cc] === WALL) return true
    }
    return false
  }

  /** True when the body's feet are resting on top of a platform right now.
   *  Backs up #descend for the one frame where vy is exactly 0. */
  #onPlatform(b: Body): boolean {
    const feet = b.y + b.h
    const row = Math.round(feet / TILE)
    if (Math.abs(feet - row * TILE) > LAND_EPS) return false
    return this.#platformRow(b.x, b.w, row)
  }

  /** Descend by `dy` (>= 0), landing on the first platform TOP the feet cross.
   *  One-way: only the top surface stops you. Returns whether it grounded.
   *
   *  Each substep, a platform row `r` catches the feet when its top (r*TILE)
   *  lies within the swept feet interval — with LAND_EPS slack so feet resting
   *  or drifting a hair past a top still land (no clip-through, no onGround
   *  flicker). The `top + LAND_EPS >= feetBefore` guard preserves one-way
   *  semantics: never snap UP onto a platform clearly above the feet — those
   *  you pass through from below. */
  #descend(b: Body, dy: number): boolean {
    let remaining = dy
    while (remaining > 0) {
      const move = Math.min(remaining, TILE / 2)
      remaining -= move
      const feetBefore = b.y + b.h
      const feetAfter = feetBefore + move
      const r0 = Math.floor((feetBefore + LAND_EPS) / TILE)
      const r1 = Math.floor(feetAfter / TILE)
      for (let r = r0; r <= r1; r++) {
        if (r * TILE + LAND_EPS >= feetBefore && this.#platformRow(b.x, b.w, r)) {
          b.y = r * TILE - b.h
          b.vy = 0
          return true
        }
      }
      b.y += move
    }
    return false
  }

  /** Wrap a body around all four screen edges (toroidal field, à la BB). */
  #wrap(b: Body): void {
    const W = this.width, H = this.height
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2
    if (cx < 0) b.x += W
    else if (cx > W) b.x -= W
    if (cy < 0) b.y += H
    else if (cy > H) b.y -= H
  }

  // ── edge-triggered actions (overlay calls these on keydown) ──

  /** Jump — an upward impulse from the ground (with a little coyote-time grace). */
  jump(): void {
    if (this.state !== 'playing') return
    if (!this.onGround && this.#coyote <= 0) return
    this.player.vy = -JUMP_V
    this.onGround = false
    this.#coyote = 0
  }

  /** Blow a bubble in the facing direction (rate-limited, capped). */
  blow(): void {
    if (this.state !== 'playing') return
    if (this.#blowCooldown > 0) return
    if (this.bubbles.length >= MAX_BUBBLES) return
    this.#blowCooldown = BLOW_COOLDOWN
    this.blowFlash = 0.2
    const p = this.player
    const mouthY = p.y + p.h * 0.4
    const x = p.facing > 0 ? p.x + p.w + BUBBLE_R * 0.5 : p.x - BUBBLE_R * 0.5
    this.bubbles.push({
      x, y: mouthY, vx: p.facing * BUBBLE_SHOOT_SPEED,
      phase: 'shoot', age: 0, life: BUBBLE_LIFE, r: BUBBLE_R,
      enemy: null, popped: false,
    })
  }

  // ── simulation ───────────────────────────────────────────

  /** Advance one frame. dt in seconds (clamped by the caller). */
  update(dt: number): void {
    if (this.blowFlash > 0) this.blowFlash = Math.max(0, this.blowFlash - dt)
    if (this.hurtFlash > 0) this.hurtFlash = Math.max(0, this.hurtFlash - dt)
    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt)
    if (this.#blowCooldown > 0) this.#blowCooldown = Math.max(0, this.#blowCooldown - dt)
    if (this.#chainTimer > 0) { this.#chainTimer -= dt; if (this.#chainTimer <= 0) this.chain = 0 }
    this.#stepParticles(dt)
    if (this.state !== 'playing') return

    this.#stepPlayer(dt)
    this.#stepEnemies(dt)
    this.#stepBubbles(dt)
    this.#stepFruit(dt)
    this.#enemyContact()

    if (this.enemies.every(e => !e.alive)) {
      this.state = 'won'
    }
  }

  #stepPlayer(dt: number): void {
    const p = this.player
    const held = (this.input.left ? -1 : 0) + (this.input.right ? 1 : 0)
    if (held !== 0) p.facing = held as 1 | -1
    this.walking = held !== 0 && this.onGround
    p.vx = held * MOVE_SPEED
    p.vy = Math.min(p.vy + GRAVITY * dt, MAX_FALL)

    // horizontal — no walls; movement is free and the screen wraps. Wrap NOW so
    // the ground/platform queries below read the canonical position, not a
    // pre-wrap x that would sample terrain on the opposite screen seam.
    p.x += p.vx * dt
    this.#wrap(p)
    this.#bubbleRide(p)

    // vertical — one-way platforms: pass UP through, land on TOP coming down
    if (p.vy < 0) {
      p.y += p.vy * dt
      this.onGround = false
    } else {
      this.onGround = this.#descend(p, p.vy * dt) || this.#onPlatform(p)
    }

    this.#wrap(p)

    // coyote-time: keep a brief jump grace just after leaving a ledge
    if (this.onGround) this.#coyote = COYOTE
    else if (this.#coyote > 0) this.#coyote = Math.max(0, this.#coyote - dt)
  }

  /** Let Bub bounce off the crown of a bubble while falling — the signature
   *  "ride the bubbles up" move. Empty bubbles bounce; enemy bubbles pop. */
  #bubbleRide(p: Body): void {
    for (const b of this.bubbles) {
      if (b.popped) continue
      if (b.enemy) {
        // POP a trapped-enemy bubble on contact from ANY direction — jump or run
        // into it. Defeats the foe and bounces you up, so you can chain pops by
        // bounding from bubble to bubble (the signature Bubble Bobble combo).
        // Circle (bubble) vs rect (player) overlap.
        const cx = Math.max(p.x, Math.min(b.x, p.x + p.w))
        const cy = Math.max(p.y, Math.min(b.y, p.y + p.h))
        if ((b.x - cx) ** 2 + (b.y - cy) ** 2 < b.r * b.r) {
          this.#popBubble(b, true)
          p.vy = -BUBBLE_BOUNCE_V
          return
        }
      } else if (p.vy > 0) {
        // Empty bubble: bounce off the crown when you land on it (ride up).
        const dx = (p.x + p.w / 2) - b.x
        const feet = p.y + p.h
        if (Math.abs(dx) < b.r * 0.9 && feet > b.y - b.r && feet < b.y - b.r * 0.2) {
          p.vy = -BUBBLE_BOUNCE_V
          p.y = b.y - b.r - p.h
          b.y += 6  // the bubble dips a touch under the weight
          return
        }
      }
    }
  }

  #stepEnemies(dt: number): void {
    for (const e of this.enemies) {
      if (!e.alive || e.captured) continue
      e.bob += dt * 6
      if (e.grace > 0) e.grace = Math.max(0, e.grace - dt)
      const speed = e.angry ? ENEMY_ANGRY_SPEED : ENEMY_SPEED

      e.vy = Math.min(e.vy + GRAVITY * dt, MAX_FALL)
      const grounded = this.#descend(e, e.vy * dt) || this.#onPlatform(e)

      // Patrol: reverse at a ledge edge (won't walk off platforms). With no
      // body-height walls, ledge-edges are the only thing that turns them.
      if (grounded) {
        const aheadX = e.dir > 0 ? e.x + e.w + 2 : e.x - 2
        const footRow = Math.floor((e.y + e.h + 2) / TILE)
        if (!this.#platformRow(aheadX, 1, footRow)) e.dir = (e.dir === 1 ? -1 : 1)
      }

      e.x += e.dir * speed * dt
      this.#wrap(e)
    }
  }

  #stepBubbles(dt: number): void {
    if (this.bubbles.length === 0) return
    for (const b of this.bubbles) {
      if (b.popped) continue
      b.age += dt
      b.life -= dt

      if (b.phase === 'shoot') {
        b.x += b.vx * dt
        if (b.x < b.r) { b.x = b.r; b.phase = 'float' }
        else if (b.x > this.width - b.r) { b.x = this.width - b.r; b.phase = 'float' }
        if (b.age >= BUBBLE_SHOOT_TIME) b.phase = 'float'
      } else {
        // Drift UP through everything; collect just under the top of the screen.
        b.y -= BUBBLE_RISE * dt
        b.x += Math.sin(b.age * 2.2) * BUBBLE_SWAY * dt
        if (b.y < b.r) b.y = b.r
        if (b.x < b.r) b.x = b.r
        if (b.x > this.width - b.r) b.x = this.width - b.r
      }

      // Trap an enemy on contact (empty bubbles only).
      if (!b.enemy) {
        for (const e of this.enemies) {
          if (!e.alive || e.captured) continue
          const ecx = e.x + e.w / 2, ecy = e.y + e.h / 2
          if (Math.hypot(ecx - b.x, ecy - b.y) < b.r + e.w * 0.32) {
            e.captured = true
            b.enemy = e
            b.phase = 'float'
            b.life = BUBBLE_TRAP_LIFE
            b.vx = 0
            this.#spawnPop(b.x, b.y, 200, 6)
            break
          }
        }
      }

      // A trapped enemy rides the bubble.
      if (b.enemy) {
        b.enemy.x = b.x - b.enemy.w / 2
        b.enemy.y = b.y - b.enemy.h / 2
      }

      if (b.life <= 0) {
        if (b.enemy) {
          // Timed out — the foe escapes, angrier and faster.
          b.enemy.captured = false
          b.enemy.angry = true
          b.enemy.grace = ENEMY_RELEASE_GRACE
          b.enemy.vy = 0
          this.#spawnPop(b.x, b.y, 240, 8)
        } else {
          this.#spawnPop(b.x, b.y, 160, 5)
        }
        b.popped = true
      }
    }
    this.bubbles = this.bubbles.filter(b => !b.popped)
  }

  /** Pop a bubble. `byPlayer` means Bub touched it — a trapped foe is defeated
   *  (and drops fruit + grows the combo); an empty bubble just bursts. */
  #popBubble(b: Bubble, byPlayer: boolean): void {
    if (b.popped) return
    b.popped = true
    if (b.enemy && byPlayer) {
      b.enemy.alive = false
      b.enemy.captured = false
      this.chain += 1
      this.#chainTimer = CHAIN_WINDOW
      this.score += POP_SCORE * this.chain
      this.#spawnPop(b.x, b.y, 320, 14)
      this.#spawnFruit(b.x, b.y, (Math.max(0, Math.min(this.chain - 1, 3))) as FruitKind)
    } else {
      this.#spawnPop(b.x, b.y, 180, 6)
    }
    this.bubbles = this.bubbles.filter(x => !x.popped)
  }

  #spawnFruit(x: number, y: number, kind: FruitKind): void {
    this.fruits.push({
      x: x - TILE * 0.3, y: y - TILE * 0.3, w: TILE * 0.6, h: TILE * 0.6,
      vx: 0, vy: -60, kind, life: FRUIT_LIFE, taken: false, rest: false,
    })
  }

  #stepFruit(dt: number): void {
    const p = this.player
    for (const f of this.fruits) {
      if (f.taken) continue
      if (f.vy < 0) { f.y += f.vy * dt; f.vy = Math.min(f.vy + GRAVITY * dt, MAX_FALL) }
      else {
        f.vy = Math.min(f.vy + GRAVITY * dt, MAX_FALL)
        f.rest = this.#descend(f, f.vy * dt) || this.#onPlatform(f)
      }
      this.#wrap(f)
      f.life -= dt
      if (f.life <= 0) { f.taken = true; continue }
      if (p.x < f.x + f.w && p.x + p.w > f.x && p.y < f.y + f.h && p.y + p.h > f.y) {
        f.taken = true
        this.score += FRUIT_SCORE[f.kind]
        this.#spawnPop(f.x + f.w / 2, f.y + f.h / 2, 220, 8, 48)
      }
    }
    this.fruits = this.fruits.filter(f => !f.taken)
  }

  #enemyContact(): void {
    if (this.invuln > 0) return
    const p = this.player
    for (const e of this.enemies) {
      if (!e.alive || e.captured || e.grace > 0) continue
      if (p.x < e.x + e.w && p.x + p.w > e.x && p.y < e.y + e.h && p.y + p.h > e.y) {
        this.#die()
        return
      }
    }
  }

  #die(): void {
    this.lives -= 1
    this.hurtFlash = 0.5
    this.#spawnPop(this.player.x + this.player.w / 2, this.player.y + this.player.h / 2, 260, 16, 20)
    if (this.lives <= 0) { this.lives = 0; this.state = 'gameover' }
    else this.spawn()
  }

  // ── particles (pop sparkles) ─────────────────────────────

  #spawnPop(x: number, y: number, speed: number, count: number, hue = 190): void {
    for (let i = 0; i < count; i++) {
      const a = (Math.PI * 2 * i) / count + (i * 0.7)
      const s = speed * (0.4 + (i % 5) / 6)
      this.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 30,
        life: 0.5, max: 0.5, hue: hue + (i % 7) * 10, r: 2 + (i % 3),
      })
    }
  }

  #stepParticles(dt: number): void {
    if (this.particles.length === 0) return
    for (const pt of this.particles) {
      pt.life -= dt
      pt.vy += 420 * dt
      pt.x += pt.vx * dt
      pt.y += pt.vy * dt
    }
    this.particles = this.particles.filter(pt => pt.life > 0)
  }
}
