// diamondcoreprocessor.com/games/bubble/engine.ts
//
// Bubble Bobble — pure game engine. Framework-free: no DOM, no Pixi, no IoC.
// The overlay drives it (input + a fixed-timestep update loop) and the renderer
// draws its public state. Keeping this module pure makes the game trivially
// testable and mirrors the sibling Solomon engine's shape.
//
// Faithful to the 1986 arcade: ONE enclosed screen — solid side walls, a ceiling
// and a floor, NO wrapping and NO doors. Bub the round dragon walks + jumps
// across floating one-way platforms and BLOWS BUBBLES. A bubble shoots forward a
// short way, then drifts UP and gathers under the ceiling. A bubble that touches
// a foe traps it; bump the trapped bubble to pop it and the foe bursts into FOOD
// you collect for points. Clear every foe to advance. Pop foes in quick
// succession for bigger food and a chain bonus. Dawdle on a screen and the
// survivors turn ANGRY — faster and red (the arcade "Hurry up!").
//
// Terrain is BUBBLE BOBBLE one-way platforms: solid only from ABOVE (you land on
// top), passable from below and sideways — so you jump UP through ledges and
// never snag on a ceiling. The screen is a closed box: you bonk the side walls,
// you can't fall off the bottom (the floor catches you) and the top stops you.

// A 30px tile — a fine grid for detailed level geometry (small "bricks"). The
// spatial physics constants below are tuned to match.
export const TILE = 30

// Tile codes. EMPTY is passable; WALL is a one-way platform (solid from above).
export const EMPTY = 0
export const WALL = 1
export type TileCode = 0 | 1

export interface Cell { col: number; row: number }
export interface EnemySpawn extends Cell { dir?: 1 | -1; kind?: number }

// ── enemy species (the classic Bubble Bobble cast) ───────────
// Each foe `kind` is a SPECIES — its own behaviour AND tint. Faithful, simple
// behaviours (no dashers, no homing hunters):
//   zen-chan — the basic blue patroller; walks a ledge, reverses at an edge.
//   mighta   — a tougher orange patroller (same gait, fiercer look).
//   banebou  — a green bouncer; patrols and springs up through ledges.
//   monsta   — the pink flyer; drifts diagonally and bounces off the walls.
// All are trapped + popped by bubbles the same way; `angry` (escaped a bubble,
// OR the screen's "Hurry up!" timer fired) multiplies their speed and reddens
// them whatever the species.
export type EnemyBehavior = 'walk' | 'hop' | 'fly'
export interface EnemyKind { name: string; tint: string; behavior: EnemyBehavior; speed: number }
export const ENEMY_KINDS: EnemyKind[] = [
  { name: 'zen-chan', tint: '#4aa3ff', behavior: 'walk', speed: 44 },
  { name: 'mighta',   tint: '#ff8a3d', behavior: 'walk', speed: 40 },
  { name: 'banebou',  tint: '#6fe06a', behavior: 'hop',  speed: 40 },
  { name: 'monsta',   tint: '#ff9ad5', behavior: 'fly',  speed: 54 },
]
export const ENEMY_KIND_COUNT = ENEMY_KINDS.length
/** Resolve a (possibly out-of-range or negative) kind index to its species. */
export function enemyKind(kind: number): EnemyKind {
  return ENEMY_KINDS[((kind % ENEMY_KIND_COUNT) + ENEMY_KIND_COUNT) % ENEMY_KIND_COUNT]
}

export interface LevelDef {
  name: string
  cols: number
  rows: number
  /** rows*cols tile codes, row-major. */
  tiles: number[]
  player: Cell
  enemies: EnemySpawn[]
}

// 'cleanup' is the short post-clear grace: every foe is gone but Bub keeps
// playing for a couple of seconds to sweep up the leftover food before the
// level-clear tally rolls (see cleanupTimer).
export type GameState = 'playing' | 'cleanup' | 'won' | 'gameover'

interface Body { x: number; y: number; w: number; h: number; vx: number; vy: number }

export interface Enemy extends Body {
  dir: 1 | -1
  alive: boolean
  captured: boolean      // held inside a bubble (AI suspended, follows the bubble)
  angry: boolean         // escaped a bubble or the Hurry-up timer fired — faster + red
  kind: number           // species index into ENEMY_KINDS (behaviour + tint)
  grace: number          // post-release seconds during which it can't kill Bub
  bob: number            // idle animation phase (renderer reads it)
  aiTimer: number        // per-species clock: hop countdown
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

export interface Fruit extends Body { kind: FruitKind; life: number; taken: boolean; rest: boolean; mult: number }

export interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; hue: number; r: number }

// Power-ups, classic Bubble Bobble flavour: defeated foes occasionally drop a
// sweet that Bub collects by walking over it. Just the two staples — no timers,
// they last until you lose a life:
//   👟 shoe  — run faster
//   🍬 candy — blow bubbles faster (rapid fire)
export type PowerKind = 'shoe' | 'candy'

export interface PowerMeta { name: string; color: string; hue: number; desc: string }
export const POWER_META: Record<PowerKind, PowerMeta> = {
  shoe:  { name: 'magic shoes', color: '#4aa3ff', hue: 212, desc: 'Run faster' },
  candy: { name: 'sweet candy', color: '#ff5d8f', hue: 335, desc: 'Blow bubbles faster' },
}
export const POWER_ORDER: PowerKind[] = ['shoe', 'candy']

export interface Candy extends Body { kind: PowerKind; life: number; taken: boolean; rest: boolean; bob: number }

/** A rising, fading "+N" score popup (spawned when chained food is grabbed). */
export interface FloatText { x: number; y: number; vy: number; life: number; max: number; text: string; color: string }

// Tuning — pixels, pixels/second, pixels/second².
const GRAVITY = 1312
const MOVE_SPEED = 134
const MAX_FALL = 570
const PLAYER_W = TILE * 0.74
const PLAYER_H = TILE * 0.86
const JUMP_V = 435                    // clears ~2.4 tiles
const COYOTE = 0.09                   // brief grounded grace after leaving a ledge
const LAND_EPS = 2                    // slack (px) for one-way platform landing

// Per-species base speeds live in ENEMY_KINDS; ANGRY_MULT scales whichever one a
// foe carries once it's angry (faster + red).
const ANGRY_MULT = 1.7
const ENEMY_W = TILE * 0.72
const ENEMY_H = TILE * 0.72
const ENEMY_RELEASE_GRACE = 0.5
const ENEMY_HOP_V = 360                // banebou spring impulse (clears ~1.5 tiles)
const ENEMY_HOP_MIN = 1.0              // …on a random 1.0–2.2 s cadence
const ENEMY_HOP_MAX = 2.2

// "Hurry up!" — after this long on one screen the survivors turn angry.
const HURRY_UP = 22

// Bubbles: blow rate, shoot phase, drift, lifespan, trapped-escape window.
const BLOW_COOLDOWN = 0.30
const RAPID_MULT = 0.5                 // candy blows at half the cooldown (~2× rate)
const MAX_BUBBLES = 14
const BUBBLE_R = TILE * 0.42           // big, BB-style bubbles (≈ a tile across)
const BUBBLE_SHOOT_SPEED = 300
const BUBBLE_SHOOT_TIME = 0.34         // shoot reach ≈ 3 tiles, then it drifts up
const BUBBLE_RISE = 46                 // float-up speed — bubbles pass through terrain
const BUBBLE_SWAY = 14                 // horizontal drift amplitude while floating
const BUBBLE_LIFE = 10
const BUBBLE_TRAP_LIFE = 7             // a trapped enemy gets this long before escaping
const BUBBLE_BOUNCE_V = 330            // upward kick when Bub rides a bubble's crown

// Scoring + chain. Pop trapped-foe bubbles in quick succession (no >1s gap) to
// build the chain: each pop scores more AND drops bigger, multiplied food.
const COMBO_WINDOW = 1.0
const POP_BASE = 100                   // points per foe pop (× chain length)
const FRUIT_SCORE = [300, 500, 700, 1000] as const
const FRUIT_LIFE = 8                    // seconds a dropped food lingers during play

// Level-clear "clean up" grace: a short fixed window to sweep the leftover food
// before the next screen rolls in.
const CLEANUP_GRACE = 2.5

// Power-up sweets. Each defeated foe has a chance to drop one; it falls, rests on
// a platform, and is collected on contact. Effects are untimed — they last until
// a life is lost (a respawn clears them).
const CANDY_LIFE = 9
const CANDY_DROP_CHANCE = 0.22
const CANDY_SCORE = 500
const SHOE_MULT = 1.55                  // run ~55% faster

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
  candies: Candy[] = []
  particles: Particle[] = []
  floats: FloatText[] = []     // rising "+N" score popups

  // Power state — booleans, not timers: a power stays on until a life is lost.
  shoe = false
  rapid = false

  lives = 3
  score = 0
  state: GameState = 'playing'

  chain = 0                // pop combo: contiguous foe pops (no >1s gap)
  #chainTimer = 0
  cleanupTimer = 0
  hurtFlash = 0
  hurryFlash = 0           // brief flash when the Hurry-up anger fires
  #levelTime = 0
  #hurried = false

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

  /** True while the player is in control — normal play OR the post-clear sweep. */
  get #live(): boolean { return this.state === 'playing' || this.state === 'cleanup' }

  // ── effective (power-modified) values ────────────────────
  get #moveSpeed(): number { return this.shoe ? MOVE_SPEED * SHOE_MULT : MOVE_SPEED }
  get #blowDelay(): number { return this.rapid ? BLOW_COOLDOWN * RAPID_MULT : BLOW_COOLDOWN }

  /** Active powers for the HUD badge row. No timers — a power is simply on or off. */
  get activePowers(): PowerKind[] {
    const out: PowerKind[] = []
    if (this.shoe) out.push('shoe')
    if (this.rapid) out.push('candy')
    return out
  }

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

  /** Reset Bub, enemies, bubbles + food to the level start. Keeps lives + score. */
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
    this.candies = []
    this.particles = []
    this.floats = []
    // A respawn (death or fresh load) clears every power.
    this.shoe = false
    this.rapid = false
    this.chain = 0
    this.#chainTimer = 0
    this.cleanupTimer = 0
    this.hurtFlash = 0
    this.hurryFlash = 0
    this.#levelTime = 0
    this.#hurried = false
    this.enemies = this.level.enemies.map(e => {
      const kind = enemyKind(e.kind ?? 0)
      const fly = kind.behavior === 'fly'
      const dir = e.dir ?? 1
      return {
        x: e.col * TILE + (TILE - ENEMY_W) / 2,
        y: e.row * TILE + (TILE - ENEMY_H),
        w: ENEMY_W, h: ENEMY_H,
        // flyers launch on a fixed diagonal; ground foes start at rest.
        vx: fly ? dir * kind.speed : 0,
        vy: fly ? -kind.speed * 0.7 : 0,
        dir, alive: true, captured: false, angry: false,
        kind: e.kind ?? 0, grace: 0, bob: Math.PI * (e.col + e.row),
        // hoppers get a randomised first-hop delay so they don't jump in unison.
        aiTimer: kind.behavior === 'hop' ? ENEMY_HOP_MIN + Math.random() * (ENEMY_HOP_MAX - ENEMY_HOP_MIN) : 0,
      }
    })
    this.state = 'playing'
  }

  // ── tile helpers ─────────────────────────────────────────

  inBounds(col: number, row: number): boolean {
    return col >= 0 && col < this.cols && row >= 0 && row < this.rows
  }

  tileAt(col: number, row: number): number {
    if (!this.inBounds(col, row)) return EMPTY
    return this.grid[row * this.cols + col]
  }

  /** Is there a one-way platform tile anywhere under [x, x+w) at `row`? The field
   *  is a closed box, so columns are clamped (no horizontal wrap). */
  #platformRow(x: number, w: number, row: number): boolean {
    if (row < 0 || row >= this.rows) return false
    const c0 = Math.max(0, Math.floor(x / TILE))
    const c1 = Math.min(this.cols - 1, Math.floor((x + w - 1) / TILE))
    for (let c = c0; c <= c1; c++) {
      if (this.grid[row * this.cols + c] === WALL) return true
    }
    return false
  }

  /** True when the body's feet are resting on top of a platform right now. */
  #onPlatform(b: Body): boolean {
    const feet = b.y + b.h
    const row = Math.round(feet / TILE)
    if (Math.abs(feet - row * TILE) > LAND_EPS) return false
    return this.#platformRow(b.x, b.w, row)
  }

  /** Descend by `dy` (>= 0), landing on the first platform TOP the feet cross.
   *  One-way: only the top surface stops you. Returns whether it grounded. */
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

  /** Keep a body inside the screen horizontally (solid side walls). */
  #clampX(b: Body): void {
    if (b.x < 0) b.x = 0
    else if (b.x + b.w > this.width) b.x = this.width - b.w
  }

  // ── edge-triggered actions (overlay calls these on keydown) ──

  /** Jump — an upward impulse from the ground (with a little coyote-time grace). */
  jump(): void {
    if (!this.#live) return
    if (!this.onGround && this.#coyote <= 0) return
    this.player.vy = -JUMP_V
    this.onGround = false
    this.#coyote = 0
  }

  /** Blow one bubble in the facing direction (rate-limited, capped). */
  blow(): void {
    if (!this.#live) return
    if (this.#blowCooldown > 0) return
    if (this.bubbles.length >= MAX_BUBBLES) return
    this.#blowCooldown = this.#blowDelay
    this.blowFlash = 0.2
    const p = this.player
    const r = BUBBLE_R
    const x = p.facing > 0 ? p.x + p.w + r * 0.4 : p.x - r * 0.4
    const y = p.y + p.h * 0.4
    this.bubbles.push({
      x, y, vx: p.facing * BUBBLE_SHOOT_SPEED,
      phase: 'shoot', age: 0, life: BUBBLE_LIFE, r,
      enemy: null, popped: false,
    })
  }

  // ── simulation ───────────────────────────────────────────

  /** Advance one frame. dt in seconds (clamped by the caller). */
  update(dt: number): void {
    if (this.blowFlash > 0) this.blowFlash = Math.max(0, this.blowFlash - dt)
    if (this.hurtFlash > 0) this.hurtFlash = Math.max(0, this.hurtFlash - dt)
    if (this.hurryFlash > 0) this.hurryFlash = Math.max(0, this.hurryFlash - dt)
    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt)
    if (this.#blowCooldown > 0) this.#blowCooldown = Math.max(0, this.#blowCooldown - dt)
    if (this.#chainTimer > 0) { this.#chainTimer -= dt; if (this.#chainTimer <= 0) this.chain = 0 }
    this.#stepParticles(dt)
    this.#stepFloats(dt)
    if (!this.#live) return

    this.#stepPlayer(dt)
    this.#stepEnemies(dt)
    this.#stepBubbles(dt)
    this.#stepFruit(dt)
    this.#stepCandies(dt)

    if (this.state === 'playing') {
      // Hurry up! — dawdle and the survivors turn angry (faster + red).
      this.#levelTime += dt
      if (!this.#hurried && this.#levelTime > HURRY_UP) {
        this.#hurried = true
        this.hurryFlash = 1.0
        for (const e of this.enemies) if (e.alive && !e.captured) e.angry = true
      }
      this.#enemyContact()
      // Last foe down → the round is won. The length guard matters because
      // [].every(...) is true: a level that never spawned a foe must NOT
      // instant-win (it would softlock the designer's blank-level test).
      if (this.enemies.length > 0 && this.enemies.every(e => !e.alive)) {
        if (this.#hasLoot()) { this.state = 'cleanup'; this.cleanupTimer = CLEANUP_GRACE }
        else this.state = 'won'
      }
    } else {
      // cleanup: a short window to sweep the leftover food, then clear.
      this.cleanupTimer = Math.max(0, this.cleanupTimer - dt)
      if (this.cleanupTimer === 0 || !this.#hasLoot()) this.state = 'won'
    }
  }

  /** Anything still on the floor worth sweeping in the post-clear window. */
  #hasLoot(): boolean {
    return this.fruits.length > 0 || this.candies.length > 0
  }

  #stepPlayer(dt: number): void {
    const p = this.player
    const held = (this.input.left ? -1 : 0) + (this.input.right ? 1 : 0)
    if (held !== 0) p.facing = held as 1 | -1
    this.walking = held !== 0 && this.onGround
    p.vx = held * this.#moveSpeed
    p.vy = Math.min(p.vy + GRAVITY * dt, MAX_FALL)

    // horizontal — bounded by the side walls
    p.x += p.vx * dt
    this.#clampX(p)
    this.#bubbleRide(p)

    // vertical — one-way platforms: pass UP through, land on TOP coming down;
    // the ceiling stops upward travel.
    if (p.vy < 0) {
      p.y += p.vy * dt
      this.onGround = false
      if (p.y < 0) { p.y = 0; p.vy = 0 }
    } else {
      this.onGround = this.#descend(p, p.vy * dt) || this.#onPlatform(p)
    }
    // the screen bottom is always solid (enclosed box) — never fall off-screen
    if (p.y + p.h > this.height) { p.y = this.height - p.h; p.vy = 0; this.onGround = true }

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
      const kind = enemyKind(e.kind)
      if (kind.behavior === 'fly') this.#flyEnemy(e, kind, dt)
      else this.#groundEnemy(e, kind, dt)
    }
  }

  /** Ground species (walk / hop): gravity + one-way platforms, patrolling and
   *  reversing at ledge edges and side walls. Banebou springs on a timer. */
  #groundEnemy(e: Enemy, kind: EnemyKind, dt: number): void {
    const speed = kind.speed * (e.angry ? ANGRY_MULT : 1)

    // vertical: gravity, with hoppers able to rise UP through one-way platforms.
    e.vy = Math.min(e.vy + GRAVITY * dt, MAX_FALL)
    let grounded: boolean
    if (e.vy < 0) { e.y += e.vy * dt; grounded = false; if (e.y < 0) { e.y = 0; e.vy = 0 } }
    else grounded = this.#descend(e, e.vy * dt) || this.#onPlatform(e)
    if (e.y + e.h > this.height) { e.y = this.height - e.h; e.vy = 0; grounded = true }

    // hopper: spring when grounded and the timer elapses.
    if (kind.behavior === 'hop') {
      e.aiTimer -= dt
      if (grounded && e.aiTimer <= 0) {
        e.vy = -ENEMY_HOP_V
        e.aiTimer = ENEMY_HOP_MIN + Math.random() * (ENEMY_HOP_MAX - ENEMY_HOP_MIN)
        grounded = false
      }
    }

    // patrol: reverse at a ledge edge so it won't walk off.
    if (grounded) {
      const aheadX = e.dir > 0 ? e.x + e.w + 2 : e.x - 2
      const footRow = Math.floor((e.y + e.h + 2) / TILE)
      if (!this.#platformRow(aheadX, 1, footRow)) e.dir = e.dir === 1 ? -1 : 1
    }

    e.x += e.dir * speed * dt
    // bounce off the side walls
    if (e.x < 0) { e.x = 0; e.dir = 1 }
    else if (e.x + e.w > this.width) { e.x = this.width - e.w; e.dir = -1 }
  }

  /** Flying species (monsta): no gravity, no platforms — it drifts on a fixed
   *  diagonal and bounces off the four walls. No homing (faithful to Monsta). */
  #flyEnemy(e: Enemy, kind: EnemyKind, dt: number): void {
    const speed = kind.speed * (e.angry ? ANGRY_MULT : 1)
    // keep its diagonal heading but scale to the current (maybe-angry) speed
    const sp = Math.hypot(e.vx, e.vy) || 1
    e.vx = (e.vx / sp) * speed
    e.vy = (e.vy / sp) * speed
    e.x += e.vx * dt
    e.y += e.vy * dt
    if (e.x < 0) { e.x = 0; e.vx = Math.abs(e.vx) }
    else if (e.x + e.w > this.width) { e.x = this.width - e.w; e.vx = -Math.abs(e.vx) }
    if (e.y < 0) { e.y = 0; e.vy = Math.abs(e.vy) }
    else if (e.y + e.h > this.height) { e.y = this.height - e.h; e.vy = -Math.abs(e.vy) }
    e.dir = e.vx < 0 ? -1 : 1   // face the way it moves (eyes track)
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
        // Drift UP through everything; gather just under the top of the screen.
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
   *  (and bursts into food + grows the chain); an empty bubble just bursts. */
  #popBubble(b: Bubble, byPlayer: boolean): void {
    if (b.popped) return
    b.popped = true
    if (b.enemy && byPlayer) {
      b.enemy.alive = false
      b.enemy.captured = false
      this.chain += 1
      this.#chainTimer = COMBO_WINDOW
      this.score += POP_BASE * this.chain
      this.#spawnPop(b.x, b.y, 320, 14)
      this.#spawnFruit(b.x, b.y, (Math.max(0, Math.min(this.chain - 1, 3))) as FruitKind, this.chain)
      if (Math.random() < CANDY_DROP_CHANCE) this.#spawnCandy(b.x, b.y)
    } else {
      this.#spawnPop(b.x, b.y, 180, 6)
    }
    this.bubbles = this.bubbles.filter(x => !x.popped)
  }

  /** Drop a food item (it lingers FRUIT_LIFE seconds during play). `mult` is the
   *  chain length at the pop — chained pops drop food worth that many times. */
  #spawnFruit(x: number, y: number, kind: FruitKind, mult: number): void {
    this.fruits.push({
      x: x - TILE * 0.3, y: y - TILE * 0.3, w: TILE * 0.6, h: TILE * 0.6,
      vx: 0, vy: -45, kind, mult, life: FRUIT_LIFE, taken: false, rest: false,
    })
  }

  /** Food falls, rests on platforms, and is collected on contact for points.
   *  During play it expires on its own life; during the post-clear sweep its
   *  life is frozen so loot can't vanish out from under the player. */
  #stepFruit(dt: number): void {
    const p = this.player
    const cleaning = this.state === 'cleanup'
    for (const f of this.fruits) {
      if (f.taken) continue
      if (f.vy < 0) { f.y += f.vy * dt; f.vy = Math.min(f.vy + GRAVITY * dt, MAX_FALL) }
      else {
        f.vy = Math.min(f.vy + GRAVITY * dt, MAX_FALL)
        f.rest = this.#descend(f, f.vy * dt) || this.#onPlatform(f)
      }
      this.#clampX(f)
      if (!cleaning) { f.life -= dt; if (f.life <= 0) { f.taken = true; continue } }
      if (p.x < f.x + f.w && p.x + p.w > f.x && p.y < f.y + f.h && p.y + p.h > f.y) {
        f.taken = true
        const value = FRUIT_SCORE[f.kind] * f.mult
        this.score += value
        const fcx = f.x + f.w / 2, fcy = f.y + f.h / 2
        this.#spawnPop(fcx, fcy, 220, 8, 48)
        // chained food is worth a multiple — show the boosted value rising off it.
        if (f.mult > 1) this.#spawnFloat(fcx, fcy - TILE * 0.3, '+' + value, '#ffd76a')
      }
    }
    this.fruits = this.fruits.filter(f => !f.taken)
  }

  // ── power-up sweets ──────────────────────────────────────

  #spawnCandy(x: number, y: number): void {
    const kind = POWER_ORDER[Math.floor(Math.random() * POWER_ORDER.length)]
    this.candies.push({
      x: x - TILE * 0.32, y: y - TILE * 0.32, w: TILE * 0.64, h: TILE * 0.64,
      vx: 0, vy: -60, kind, life: CANDY_LIFE, taken: false, rest: false, bob: x,
    })
  }

  /** Sweets fall, rest on platforms, and are collected on contact — same shape as
   *  food, but pickup switches on a power instead of just scoring. */
  #stepCandies(dt: number): void {
    if (this.candies.length === 0) return
    const p = this.player
    for (const c of this.candies) {
      if (c.taken) continue
      if (c.vy < 0) { c.y += c.vy * dt; c.vy = Math.min(c.vy + GRAVITY * dt, MAX_FALL) }
      else {
        c.vy = Math.min(c.vy + GRAVITY * dt, MAX_FALL)
        c.rest = this.#descend(c, c.vy * dt) || this.#onPlatform(c)
      }
      this.#clampX(c)
      if (this.state !== 'cleanup') { c.life -= dt; if (c.life <= 0) { c.taken = true; continue } }
      if (p.x < c.x + c.w && p.x + p.w > c.x && p.y < c.y + c.h && p.y + p.h > c.y) {
        c.taken = true
        this.#applyPower(c.kind)
        this.score += CANDY_SCORE
        this.#spawnPop(c.x + c.w / 2, c.y + c.h / 2, 240, 10, POWER_META[c.kind].hue)
      }
    }
    this.candies = this.candies.filter(c => !c.taken)
  }

  // ── floating "+N" score popups ───────────────────────────

  #spawnFloat(x: number, y: number, text: string, color: string): void {
    this.floats.push({ x, y, vy: -42, life: 1.1, max: 1.1, text, color })
  }

  #stepFloats(dt: number): void {
    if (this.floats.length === 0) return
    for (const f of this.floats) {
      f.life -= dt
      f.y += f.vy * dt
      f.vy += 30 * dt          // ease the rise to a gentle stop
    }
    this.floats = this.floats.filter(f => f.life > 0)
  }

  /** Switch a power on. Powers stay on until a life is lost (spawn clears them). */
  #applyPower(kind: PowerKind): void {
    if (kind === 'shoe') this.shoe = true
    else this.rapid = true
  }

  /** Carry the powers from a just-cleared level's engine into this fresh one —
   *  in Bubble Bobble your sweets persist across screens, lost only on death. */
  carryLifePowersFrom(prev: Engine): void {
    this.shoe = prev.shoe
    this.rapid = prev.rapid
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
      pt.vy += 315 * dt
      pt.x += pt.vx * dt
      pt.y += pt.vy * dt
    }
    this.particles = this.particles.filter(pt => pt.life > 0)
  }
}
