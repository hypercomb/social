// diamondcoreprocessor.com/games/solomon/engine.ts
//
// Solomon's Key — pure game engine. Framework-free: no DOM, no Pixi, no IoC.
// The overlay drives it (input + a fixed-timestep update loop) and the renderer
// draws its public state. Keeping this module pure makes the game trivially
// testable and lets the designer reuse the same LevelDef shape.
//
// This is a faithful clone of the NES original (Tecmo, 1987), not a generic
// block platformer. The pieces that make it *Solomon's Key* specifically:
//
//   • Dana conjures / dispels an ORANGE block in the tile he faces (at body
//     level standing, one lower crouched, mid-air when jumping) — the verb you
//     build staircases, bridges and traps with. GREY blocks are permanent.
//   • A life-force METER drains continuously. Empty = death. It doubles as the
//     end-of-room time bonus. This is the signature pressure of the game.
//   • Dana has NO default ranged attack. He kills by DROPPING enemies (dispel
//     the block under a foe so it falls to its death) or CRUSHING them (conjure
//     a block in their cell). Fireballs are limited ammo, gained only from items.
//   • Faithful foes: Goblin (chaser), Gargoil + Dragon + Saramandor (fire-spitters),
//     Ghost (horizontal flyer), Neul (vertical flyer), Sparkball (bouncer),
//     Demonhead (endless mirror spawns), Panel Monster (fixed turret).
//   • The key opens the door; reach the open door to clear the room. Bells free
//     fairies (ten = an extra Dana); hourglasses refill the meter; jars load the
//     fireball scroll. Solomon's Seals, constellation panels (→ a fairy bonus
//     room) and Golden Wings (→ a warp) drive the meta-progression.

export const TILE = 32

// Tile codes. EMPTY is passable. WALL is the permanent grey stone (immovable —
// the wand can't touch it). BRICK is the breakable orange block the wand creates
// and destroys. CRACKED is a brick that's taken one head-butt — a second head-hit
// finishes it (the wand still clears either in a single cast).
export const EMPTY = 0
export const WALL = 1
export const BRICK = 2
export const CRACKED = 3
export type TileCode = 0 | 1 | 2 | 3

export interface Cell { col: number; row: number }

// The faithful NES foes. Each archetype has a distinct movement + kill rule.
export type EnemyKind =
  | 'goblin' | 'gargoil' | 'ghost' | 'demonhead' | 'dragon' | 'panel'
  | 'neul' | 'saramandor' | 'sparkball'
export interface EnemySpawn extends Cell { kind?: EnemyKind; dir?: 1 | -1 }

// Pickups. `key` opens the door; `jewel` / `treasure` are pure score; `bell`
// frees a fairy; `jar` / `superjar` load the fireball scroll; `scroll` widens it;
// `hourglass` / `hourglassHalf` reset the life meter; `fairy` counts toward an
// extra life; `life` is a 1-up. The meta items: `seal` (a Solomon's Seal, kept
// permanently), `zodiac` (a constellation panel — clear the room holding it to
// reach a bonus room), `wings` (Golden Wings — clear holding it to warp ahead).
// A `hidden` item sits inside a brick — destroy the covering block to reveal it.
export type ItemKind =
  | 'key' | 'jewel' | 'treasure' | 'bell' | 'jar' | 'superjar' | 'scroll'
  | 'hourglass' | 'hourglassHalf' | 'fairy' | 'life' | 'seal' | 'zodiac' | 'wings'
export interface ItemSpawn extends Cell { kind: ItemKind; hidden?: boolean; value?: number }

// A demon mirror — a generator that emits a steady stream of one foe kind.
export type MirrorKind = 'demonhead' | 'saramandor'
export interface MirrorSpawn extends Cell { kind?: MirrorKind }

export interface LevelDef {
  name: string
  cols: number
  rows: number
  /** rows*cols tile codes, row-major. */
  tiles: number[]
  player: Cell
  door: Cell
  enemies: EnemySpawn[]
  items: ItemSpawn[]
  mirrors: MirrorSpawn[]
  /** Starting life-meter value (defaults to LIFE_FULL). */
  lifeStart?: number
}

export type GameState = 'playing' | 'won' | 'dead' | 'gameover' | 'complete'

interface Body { x: number; y: number; w: number; h: number; vx: number; vy: number }

interface Enemy extends Body {
  kind: EnemyKind
  dir: 1 | -1
  alive: boolean
  squash: number          // death flatten timer (seconds remaining)
  anim: number            // animation phase, advances while moving
  fireCd: number          // gargoil / dragon / saramandor / panel shot cadence
  smashCd: number         // goblin chewing through a brick ahead
  ttl: number             // demonhead self-expire countdown (0 = immortal)
  airY: number | null     // y at the moment it left the ground (for drop-death)
}

interface Item extends ItemSpawn { taken: boolean; reveal: number }

/** A released fairy — bobs where it was freed until Dana collects it. */
interface Fairy { x: number; y: number; phase: number; taken: boolean }

interface Mirror extends Cell { cd: number; kind: MirrorKind }

/** Dana's fireball — a horizontal projectile. A normal bolt dies on the first
 *  enemy it hits; a SUPER bolt plows through every enemy in its path. */
export interface Fireball { x: number; y: number; vx: number; life: number; super: boolean }

/** An enemy projectile (gargoil / dragon / saramandor / panel). Breaks bricks,
 *  kills Dana. */
export interface Shot { x: number; y: number; vx: number; life: number }

// Tuning — pixels, pixels/second, pixels/second².
const GRAVITY = 900
const MOVE_SPEED = 105
const CROUCH_SPEED = 58
const MAX_FALL = 560
const PLAYER_W = TILE * 0.7
const PLAYER_H = TILE
const DUCK_H = TILE * 0.7
const STEP_UP = TILE
const JUMP_V = 360

// Life meter. Drains continuously; empty = a lost Dana. Full hourglass restores
// LIFE_FULL, half restores LIFE_HALF. Remaining life becomes the room's time
// bonus on clear. (~100/s ⇒ a full meter is ~100s — generous puzzle headroom.)
export const LIFE_FULL = 10000
export const LIFE_HALF = 5000
const LIFE_DRAIN = 100

// Fireball scroll: at most MAX_AMMO bolts by default (a Scroll of Lyra widens it
// up to SCROLL_CAP). Dana starts EMPTY — there is no default ranged attack.
export const MAX_AMMO = 3
export const SCROLL_CAP = 8
const FIRE_SPEED = 320
const FIRE_R = 6
const FIRE_COOLDOWN = 0.28
const FIRE_LIFE = 1.6

// An enemy that falls this far past where it left the ground dies on landing —
// the "drop him to ruin him" kill. Falling out the bottom of the room also kills.
const DROP_KILL = TILE * 1.6
const FAIRIES_PER_LIFE = 10

// Per-kind hitbox + score. Scores follow the NES treasure tiers loosely.
const E = {
  goblin:     { w: TILE * 0.72, h: TILE * 0.84, speed: 62, score: 200 },
  gargoil:    { w: TILE * 0.78, h: TILE * 0.82, speed: 44, score: 500 },
  dragon:     { w: TILE * 0.86, h: TILE * 0.78, speed: 40, score: 1000 },
  saramandor: { w: TILE * 0.7,  h: TILE * 0.74, speed: 50, score: 400 },
  ghost:      { w: TILE * 0.74, h: TILE * 0.74, speed: 74, score: 500 },
  neul:       { w: TILE * 0.66, h: TILE * 0.66, speed: 58, score: 600 },
  sparkball:  { w: TILE * 0.58, h: TILE * 0.58, speed: 78, score: 700 },
  demonhead:  { w: TILE * 0.6,  h: TILE * 0.6,  speed: 86, score: 100 },
  panel:      { w: TILE * 0.9,  h: TILE * 0.9,  speed: 0,  score: 0 },
} as const satisfies Record<EnemyKind, { w: number; h: number; speed: number; score: number }>

const MIRROR_INTERVAL = 2.4   // seconds between spawns
const MIRROR_CAP = 3          // live spawned foes a single mirror sustains
const DEMONHEAD_TTL = 7       // a Demonhead fades after this long
const GARGOIL_FIRE_CD = 1.8
const PANEL_FIRE_CD = 2.2
const DRAGON_FIRE_CD = 1.5
const SARAMANDOR_FIRE_CD = 1.6
const SHOT_SPEED = 150
const SHOT_LIFE = 3

const WALKERS = new Set<EnemyKind>(['goblin', 'gargoil', 'dragon', 'saramandor'])
const SHOOTERS = new Set<EnemyKind>(['gargoil', 'dragon', 'saramandor'])
const PATROLLERS = new Set<EnemyKind>(['gargoil', 'saramandor']) // turn at walls/ledges
const HUNTERS = new Set<EnemyKind>(['goblin', 'dragon'])         // steer toward Dana

export class Engine {
  level: LevelDef
  cols: number
  rows: number
  grid: Uint8Array

  player: Body = { x: 0, y: 0, w: PLAYER_W, h: PLAYER_H, vx: 0, vy: 0 }
  facing: 1 | -1 = 1
  onGround = false
  walking = false
  ducking = false

  enemies: Enemy[] = []
  items: Item[] = []
  fairies: Fairy[] = []
  fireballs: Fireball[] = []
  shots: Shot[] = []
  mirrors: Mirror[] = []
  #fireCooldown = 0

  /** The fireball scroll: each slot is a stored bolt, `true` = a super bolt.
   *  Fired oldest-first (shift the front). Capped at `ammoCap`. */
  ammo: boolean[] = []
  ammoCap = MAX_AMMO
  fairyCount = 0
  doorOpen = false

  // Meta-progression. sealCount + collected seals persist across deaths (and the
  // overlay carries them across rooms); zodiac / wings are held only for the
  // current room (lost on death — you must re-grab them).
  sealCount = 0
  #collectedSeals = new Set<string>()
  zodiacHeld = false
  wingsHeld = false

  life = LIFE_FULL
  lives = 3
  score = 0
  state: GameState = 'playing'

  // Transient flash timers the renderer / overlay read (seconds remaining).
  conjureFlash = 0
  hurtFlash = 0
  smashFlash = 0
  smashCell: Cell | null = null
  fireFlash = 0       // bumps when Dana looses a fireball
  pickupFlash = 0     // bumps when Dana grabs any item
  pickupCell: Cell | null = null

  // Held input — the overlay writes these from key events.
  input = { left: false, right: false, down: false }

  constructor(level: LevelDef) {
    this.level = level
    this.cols = level.cols
    this.rows = level.rows
    this.grid = new Uint8Array(level.cols * level.rows)
    this.load(level)
  }

  get width(): number { return this.cols * TILE }
  get height(): number { return this.rows * TILE }

  /** (Re)load a level from its definition, resetting ALL dynamic state including
   *  the persistent seal tally (a brand-new game). */
  load(level: LevelDef): void {
    this.level = level
    this.cols = level.cols
    this.rows = level.rows
    this.grid = Uint8Array.from(level.tiles.slice(0, level.cols * level.rows))
    this.score = 0
    this.lives = 3
    this.fairyCount = 0
    this.sealCount = 0
    this.#collectedSeals.clear()
    this.spawn()
  }

  /** Reset Dana, foes, items and the meter to the level's start — keeps lives,
   *  score, fairy count and the seal tally (used after a death + between rooms). */
  spawn(): void {
    this.grid = Uint8Array.from(this.level.tiles.slice(0, this.cols * this.rows))
    const p = this.level.player
    this.player.w = PLAYER_W
    this.player.h = PLAYER_H
    this.player.x = p.col * TILE + (TILE - PLAYER_W) / 2
    this.player.y = p.row * TILE + (TILE - PLAYER_H)
    this.player.vx = 0
    this.player.vy = 0
    this.facing = 1
    this.onGround = false
    this.ducking = false
    this.fireballs = []
    this.shots = []
    this.fairies = []
    this.ammo = []
    this.ammoCap = MAX_AMMO
    this.#fireCooldown = 0
    this.input.left = this.input.right = this.input.down = false
    this.doorOpen = false
    this.zodiacHeld = false
    this.wingsHeld = false
    this.life = this.level.lifeStart ?? LIFE_FULL

    this.items = this.level.items.map(it => ({ ...it, taken: false, reveal: 0 }))
    // Seals already collected this game don't reappear.
    for (const it of this.items) if (it.kind === 'seal' && this.#collectedSeals.has(this.#sealKey(it))) it.taken = true
    this.enemies = this.level.enemies.map(e => this.#makeEnemy(e.kind ?? 'goblin', e.col, e.row, e.dir ?? 1))
    this.mirrors = this.level.mirrors.map(m => ({ col: m.col, row: m.row, kind: m.kind ?? 'demonhead', cd: MIRROR_INTERVAL * 0.6 }))

    this.state = 'playing'
    this.conjureFlash = this.hurtFlash = this.smashFlash = this.fireFlash = this.pickupFlash = 0
    this.smashCell = this.pickupCell = null
  }

  #makeEnemy(kind: EnemyKind, col: number, row: number, dir: 1 | -1): Enemy {
    const d = E[kind]
    const e: Enemy = {
      kind, dir, alive: true, squash: 0, anim: 0,
      x: col * TILE + (TILE - d.w) / 2,
      y: row * TILE + (TILE - d.h),
      w: d.w, h: d.h, vx: 0, vy: 0,
      fireCd: kind === 'panel' ? PANEL_FIRE_CD : 1.2,
      smashCd: 0,
      ttl: kind === 'demonhead' ? DEMONHEAD_TTL : 0,
      airY: null,
    }
    if (kind === 'sparkball') { e.vx = dir * E.sparkball.speed; e.vy = E.sparkball.speed * 0.6 }
    return e
  }

  #sealKey(c: Cell): string { return `${c.col},${c.row}` }

  // ── tile helpers ─────────────────────────────────────────

  inBounds(col: number, row: number): boolean {
    return col >= 0 && col < this.cols && row >= 0 && row < this.rows
  }

  tileAt(col: number, row: number): number {
    if (!this.inBounds(col, row)) return WALL
    return this.grid[row * this.cols + col]
  }

  setTile(col: number, row: number, code: number): void {
    if (this.inBounds(col, row)) this.grid[row * this.cols + col] = code
  }

  solidAt(col: number, row: number): boolean {
    const t = this.tileAt(col, row)
    return t === WALL || t === BRICK || t === CRACKED
  }

  /** A brick the wand or a head-butt can clear (not permanent grey stone). */
  breakableAt(col: number, row: number): boolean {
    const t = this.tileAt(col, row)
    return t === BRICK || t === CRACKED
  }

  rectSolid(x: number, y: number, w: number, h: number): boolean {
    const c0 = Math.floor(x / TILE)
    const c1 = Math.floor((x + w - 1) / TILE)
    const r0 = Math.floor(y / TILE)
    const r1 = Math.floor((y + h - 1) / TILE)
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++)
        if (this.solidAt(c, r)) return true
    return false
  }

  // ── the wand: conjure / dispel a brick in front of Dana ──

  /** The cell the wand targets: the column Dana faces, at his foot row standing
   *  (body level — the classic stair-step) or one row LOWER crouched. */
  targetCell(): Cell {
    const footRow = Math.floor((this.player.y + this.player.h - 1) / TILE)
    const centerCol = Math.floor((this.player.x + this.player.w / 2) / TILE)
    return { col: centerCol + this.facing, row: footRow + (this.ducking ? 1 : 0) }
  }

  cast(): 'conjure' | 'dispel' | 'blocked' {
    if (this.state !== 'playing') return 'blocked'
    const { col, row } = this.targetCell()
    if (!this.inBounds(col, row)) return 'blocked'
    const t = this.tileAt(col, row)
    if (t === WALL) return 'blocked'
    if (t === BRICK || t === CRACKED) {
      this.setTile(col, row, EMPTY)
      this.#revealAt(col, row)
      this.conjureFlash = 0.18
      return 'dispel'
    }
    if (!this.#ejectFromCell(col, row)) return 'blocked'
    this.setTile(col, row, BRICK)
    this.conjureFlash = 0.18
    for (const e of this.enemies) {
      if (e.alive && e.kind !== 'panel' && this.rectOverlapsCell(e, col, row)) this.#killEnemy(e, true)
    }
    return 'conjure'
  }

  rectOverlapsCell(b: Body, col: number, row: number): boolean {
    const cx = col * TILE, cy = row * TILE
    return b.x < cx + TILE && b.x + b.w > cx && b.y < cy + TILE && b.y + b.h > cy
  }

  #ejectFromCell(col: number, row: number): boolean {
    const p = this.player
    if (!this.rectOverlapsCell(p, col, row)) return true
    const nx = this.facing > 0 ? col * TILE - p.w : (col + 1) * TILE
    if (this.rectSolid(nx, p.y, p.w, p.h)) return false
    p.x = nx
    p.vx = 0
    return true
  }

  // ── simulation ───────────────────────────────────────────

  update(dt: number): void {
    if (this.conjureFlash > 0) this.conjureFlash = Math.max(0, this.conjureFlash - dt)
    if (this.hurtFlash > 0) this.hurtFlash = Math.max(0, this.hurtFlash - dt)
    if (this.smashFlash > 0) this.smashFlash = Math.max(0, this.smashFlash - dt)
    if (this.state !== 'playing') return

    this.life -= LIFE_DRAIN * dt
    if (this.life <= 0) { this.life = 0; this.#die(); return }

    this.#stepPlayer(dt)
    this.#stepEnemies(dt)
    this.#stepMirrors(dt)
    this.#stepFireballs(dt)
    this.#stepShots(dt)
    this.#stepFairies(dt)
    this.#collectibles()
    this.#hazardContact()
  }

  jump(): void {
    if (this.state !== 'playing') return
    if (!this.onGround || this.ducking) return
    this.player.vy = -JUMP_V
    this.onGround = false
  }

  fireball(): void {
    if (this.state !== 'playing') return
    if (this.#fireCooldown > 0 || this.ammo.length === 0) return
    const isSuper = this.ammo.shift() === true
    this.#fireCooldown = FIRE_COOLDOWN
    const p = this.player
    const fy = (p.y + p.h) - TILE * (this.ducking ? 0.3 : 0.5)
    const fx = this.facing > 0 ? p.x + p.w : p.x - FIRE_R
    this.fireballs.push({ x: fx, y: fy, vx: this.facing * FIRE_SPEED, life: FIRE_LIFE, super: isSuper })
    this.fireFlash += 1
    this.conjureFlash = 0.12
  }

  /** Push a bolt onto the scroll (drops if full). `super` = a piercing bolt. */
  addAmmo(isSuper: boolean): void {
    if (this.ammo.length >= this.ammoCap) return
    this.ammo.push(isSuper)
  }

  #stepPlayer(dt: number): void {
    const p = this.player
    if (this.input.down && this.onGround && !this.ducking) this.#engageDuck()
    else if (!this.input.down && this.ducking) this.#tryStand()

    const held = (this.input.left ? -1 : 0) + (this.input.right ? 1 : 0)
    if (held !== 0) this.facing = held as 1 | -1
    this.walking = held !== 0
    p.vx = held * (this.ducking ? CROUCH_SPEED : MOVE_SPEED)
    p.vy = Math.min(p.vy + GRAVITY * dt, MAX_FALL)

    this.#moveX(p, p.vx * dt)
    this.#moveYPlayer(p, p.vy * dt)

    if (p.y > this.height + TILE) this.#die()
  }

  #engageDuck(): void {
    const p = this.player
    const footY = p.y + p.h
    p.h = DUCK_H
    p.y = footY - DUCK_H
    this.ducking = true
  }

  #tryStand(): void {
    const p = this.player
    const footY = p.y + p.h
    const ny = footY - PLAYER_H
    if (this.rectSolid(p.x, ny, p.w, PLAYER_H)) return
    p.y = ny
    p.h = PLAYER_H
    this.ducking = false
  }

  // ── Dana's fireballs ─────────────────────────────────────

  #stepFireballs(dt: number): void {
    if (this.#fireCooldown > 0) this.#fireCooldown = Math.max(0, this.#fireCooldown - dt)
    if (this.fireballs.length === 0) return
    const survive: Fireball[] = []
    for (const f of this.fireballs) {
      f.x += f.vx * dt
      f.life -= dt
      const col = Math.floor(f.x / TILE), row = Math.floor(f.y / TILE)
      if (f.life <= 0 || f.x < 0 || f.x > this.width || this.solidAt(col, row)) continue
      let consumed = false
      for (const e of this.enemies) {
        if (!e.alive || e.kind === 'panel') continue
        if (f.x > e.x && f.x < e.x + e.w && f.y > e.y && f.y < e.y + e.h) {
          this.#killEnemy(e, false)
          if (!f.super) { consumed = true; break }
        }
      }
      if (!consumed) survive.push(f)
    }
    this.fireballs = survive
  }

  // ── enemy projectiles ────────────────────────────────────

  #stepShots(dt: number): void {
    if (this.shots.length === 0) return
    const survive: Shot[] = []
    for (const s of this.shots) {
      s.x += s.vx * dt
      s.life -= dt
      const col = Math.floor(s.x / TILE), row = Math.floor(s.y / TILE)
      if (s.life <= 0 || s.x < 0 || s.x > this.width) continue
      const t = this.tileAt(col, row)
      if (t === WALL) continue
      if (t === BRICK || t === CRACKED) {
        this.setTile(col, row, EMPTY)
        this.#revealAt(col, row)
        this.smashCell = { col, row }
        this.smashFlash = 0.16
        continue
      }
      survive.push(s)
    }
    this.shots = survive
  }

  #fireShot(x: number, y: number, dir: 1 | -1): void {
    this.shots.push({ x, y, vx: dir * SHOT_SPEED, life: SHOT_LIFE })
  }

  // ── movement primitives ──────────────────────────────────

  #moveX(p: Body, dx: number): void {
    if (dx === 0) return
    const step = Math.sign(dx)
    let remaining = Math.abs(dx)
    while (remaining > 0) {
      const move = Math.min(remaining, TILE / 2)
      remaining -= move
      const nx = p.x + step * move
      if (!this.rectSolid(nx, p.y, p.w, p.h)) { p.x = nx; continue }
      if (this.onGround) {
        let lifted = false
        for (let lift = 2; lift <= STEP_UP; lift += 2) {
          if (!this.rectSolid(nx, p.y - lift, p.w, p.h)) { p.y -= lift; p.x = nx; lifted = true; break }
        }
        if (lifted) continue
      }
      p.vx = 0
      break
    }
  }

  #moveYPlayer(p: Body, dy: number): void {
    if (dy === 0) { this.#groundCheck(p); return }
    const step = Math.sign(dy)
    let remaining = Math.abs(dy)
    this.onGround = false
    while (remaining > 0) {
      const move = Math.min(remaining, TILE / 2)
      remaining -= move
      const ny = p.y + step * move
      if (!this.rectSolid(p.x, ny, p.w, p.h)) { p.y = ny; continue }
      if (step < 0 && this.#headButt(p, ny)) { p.y = ny; continue }
      if (step > 0) this.onGround = true
      p.vy = 0
      break
    }
    if (step > 0 && !this.onGround) this.#groundCheck(p)
  }

  #headButt(p: Body, ny: number): boolean {
    const headRow = Math.floor(ny / TILE)
    const c0 = Math.floor(p.x / TILE)
    const c1 = Math.floor((p.x + p.w - 1) / TILE)
    let broke = false
    let cracked = false
    for (let c = c0; c <= c1; c++) {
      const t = this.tileAt(c, headRow)
      if (t === BRICK) { this.setTile(c, headRow, CRACKED); cracked = true }
      else if (t === CRACKED) {
        this.setTile(c, headRow, EMPTY)
        this.#revealAt(c, headRow)
        this.smashCell = { col: c, row: headRow }
        broke = true
      }
    }
    if (broke) this.smashFlash = 0.18
    else if (cracked) this.smashFlash = 0.1
    if (!broke && !cracked) return false
    return !this.rectSolid(p.x, ny, p.w, p.h)
  }

  #groundCheck(p: Body): void {
    this.onGround = this.rectSolid(p.x, p.y + 1, p.w, p.h)
  }

  // ── enemies ──────────────────────────────────────────────

  #stepEnemies(dt: number): void {
    for (const e of this.enemies) {
      if (!e.alive) { if (e.squash > 0) e.squash = Math.max(0, e.squash - dt); continue }
      switch (e.kind) {
        case 'ghost': this.#stepGhost(e, dt); break
        case 'neul': this.#stepNeul(e, dt); break
        case 'sparkball': this.#stepSparkball(e, dt); break
        case 'demonhead': this.#stepDemonhead(e, dt); break
        case 'panel': this.#stepPanel(e, dt); break
        default: this.#stepWalker(e, dt); break   // goblin, gargoil, dragon, saramandor
      }
    }
    this.enemies = this.enemies.filter(e => e.alive || e.squash > 0)
  }

  /** Ground foes: gravity + drop-death, then per-kind horizontal AI. */
  #stepWalker(e: Enemy, dt: number): void {
    e.vy = Math.min(e.vy + GRAVITY * dt, MAX_FALL)
    const before = e.y
    if (!this.#grounded(e) && e.airY === null) e.airY = before
    this.#moveYSimple(e, e.vy * dt)
    const grounded = this.#grounded(e)
    if (grounded && e.airY !== null) {
      if (e.y - e.airY > DROP_KILL) { this.#killEnemy(e, false); return }
      e.airY = null
    }
    if (e.y > this.height + TILE) { this.#killEnemy(e, false); return }

    const speed = E[e.kind].speed
    e.anim += dt * speed
    if (e.smashCd > 0) e.smashCd -= dt
    if (e.fireCd > 0) e.fireCd -= dt

    if (grounded && HUNTERS.has(e.kind)) {
      const dx = this.player.x - e.x
      if (Math.abs(dx) > 2) e.dir = (dx > 0 ? 1 : -1)
    }

    const aheadX = e.dir > 0 ? e.x + e.w + 1 : e.x - 1
    const aheadCol = Math.floor(aheadX / TILE)
    const midRow = Math.floor((e.y + e.h / 2) / TILE)
    const footRow = Math.floor((e.y + e.h + 2) / TILE)
    const aheadTile = this.tileAt(aheadCol, midRow)
    const wallAhead = aheadTile === WALL || aheadTile === BRICK || aheadTile === CRACKED
    const groundAhead = this.solidAt(aheadCol, footRow)

    // Goblins punch through a breakable brick blocking the chase.
    if (e.kind === 'goblin' && grounded && (aheadTile === BRICK || aheadTile === CRACKED)) {
      if (e.smashCd <= 0) {
        this.setTile(aheadCol, midRow, EMPTY)
        this.#revealAt(aheadCol, midRow)
        this.smashCell = { col: aheadCol, row: midRow }
        this.smashFlash = 0.14
        e.smashCd = 0.7
      }
      return
    }

    // Fire-spitters loose a block-breaking bolt when Dana is ahead at a similar height.
    if (SHOOTERS.has(e.kind) && e.fireCd <= 0) {
      const facingDana = Math.sign(this.player.x - e.x) === e.dir
      const sameRow = Math.abs((this.player.y + this.player.h) - (e.y + e.h)) < TILE * 1.2
      if (facingDana && sameRow) {
        this.#fireShot(e.dir > 0 ? e.x + e.w : e.x, e.y + e.h * 0.45, e.dir)
        e.fireCd = e.kind === 'dragon' ? DRAGON_FIRE_CD : e.kind === 'saramandor' ? SARAMANDOR_FIRE_CD : GARGOIL_FIRE_CD
      }
    }

    if (grounded && PATROLLERS.has(e.kind) && (wallAhead || !groundAhead)) { e.dir = -e.dir as 1 | -1; return }

    const nx = e.x + e.dir * speed * dt
    if (!this.rectSolid(nx, e.y, e.w, e.h)) e.x = nx
    else e.dir = -e.dir as 1 | -1
  }

  /** Ghost: a horizontal flyer (no gravity). Bounces off grey walls and SMASHES
   *  any brick it touches. Fireball-only kill. */
  #stepGhost(e: Enemy, dt: number): void {
    e.anim += dt * E.ghost.speed
    const nx = e.x + e.dir * E.ghost.speed * dt
    const col = Math.floor((e.dir > 0 ? nx + e.w : nx) / TILE)
    const row = Math.floor((e.y + e.h / 2) / TILE)
    const t = this.tileAt(col, row)
    if (t === BRICK || t === CRACKED) { this.setTile(col, row, EMPTY); this.#revealAt(col, row); e.x = nx; return }
    if (t === WALL) { e.dir = -e.dir as 1 | -1; return }
    e.x = nx
  }

  /** Neul: a vertical flyer that homes on Dana's height (and drifts toward his
   *  column), smashing bricks in its path. Fireball-only kill. */
  #stepNeul(e: Enemy, dt: number): void {
    e.anim += dt * E.neul.speed
    const sp = E.neul.speed
    // vertical homing
    const dy = (this.player.y + this.player.h / 2) - (e.y + e.h / 2)
    const stepY = Math.sign(dy) * Math.min(Math.abs(dy), sp * dt)
    const ny = e.y + stepY
    const colY = Math.floor((e.x + e.w / 2) / TILE)
    const rowY = Math.floor((stepY > 0 ? ny + e.h : ny) / TILE)
    const tY = this.tileAt(colY, rowY)
    if (tY === BRICK || tY === CRACKED) { this.setTile(colY, rowY, EMPTY); this.#revealAt(colY, rowY) }
    if (!this.rectSolid(e.x, ny, e.w, e.h)) e.y = ny
    // slow horizontal drift toward Dana's column
    const dx = (this.player.x + this.player.w / 2) - (e.x + e.w / 2)
    const stepX = Math.sign(dx) * Math.min(Math.abs(dx), sp * 0.5 * dt)
    const nx = e.x + stepX
    const colX = Math.floor((stepX > 0 ? nx + e.w : nx) / TILE)
    const rowX = Math.floor((e.y + e.h / 2) / TILE)
    const tX = this.tileAt(colX, rowX)
    if (tX === BRICK || tX === CRACKED) { this.setTile(colX, rowX, EMPTY); this.#revealAt(colX, rowX) }
    if (!this.rectSolid(nx, e.y, e.w, e.h)) e.x = nx
  }

  /** Sparkball: a relentless 2D bouncer (no gravity) that ricochets off any solid.
   *  Doesn't expire and doesn't smash blocks — wall it off or fireball it. */
  #stepSparkball(e: Enemy, dt: number): void {
    e.anim += dt * E.sparkball.speed
    const nx = e.x + e.vx * dt
    if (this.rectSolid(nx, e.y, e.w, e.h)) e.vx = -e.vx; else e.x = nx
    const ny = e.y + e.vy * dt
    if (this.rectSolid(e.x, ny, e.w, e.h)) e.vy = -e.vy; else e.y = ny
    e.dir = (e.vx >= 0 ? 1 : -1)
  }

  /** Demonhead: mirror-spawned bouncer. Drifts with a vertical bob, reverses at
   *  any solid, and self-expires after its ttl. */
  #stepDemonhead(e: Enemy, dt: number): void {
    e.anim += dt * E.demonhead.speed
    if (e.ttl > 0) { e.ttl -= dt; if (e.ttl <= 0) { this.#killEnemy(e, false); return } }
    const nx = e.x + e.dir * E.demonhead.speed * dt
    const col = Math.floor((e.dir > 0 ? nx + e.w : nx) / TILE)
    const row = Math.floor((e.y + e.h / 2) / TILE)
    if (this.solidAt(col, row)) e.dir = -e.dir as 1 | -1
    else e.x = nx
    e.y += Math.sin(e.anim * 0.06) * 14 * dt
  }

  /** Panel Monster: a fixed turret embedded in the wall. */
  #stepPanel(e: Enemy, dt: number): void {
    if (e.fireCd > 0) { e.fireCd -= dt; return }
    e.fireCd = PANEL_FIRE_CD
    this.#fireShot(e.dir > 0 ? e.x + e.w : e.x, e.y + e.h * 0.45, e.dir)
  }

  #stepMirrors(dt: number): void {
    for (const m of this.mirrors) {
      m.cd -= dt
      if (m.cd > 0) continue
      m.cd = MIRROR_INTERVAL
      const live = this.enemies.filter(e => e.alive && e.kind === m.kind).length
      if (live >= MIRROR_CAP) continue
      const dir: 1 | -1 = m.col < this.cols / 2 ? 1 : -1
      this.enemies.push(this.#makeEnemy(m.kind, m.col, m.row, dir))
    }
  }

  #stepFairies(dt: number): void {
    for (const f of this.fairies) {
      if (f.taken) continue
      f.phase += dt
      f.y += Math.sin(f.phase * 3) * 10 * dt
    }
  }

  #grounded(e: Body): boolean { return this.rectSolid(e.x, e.y + 1, e.w, e.h) }

  #moveYSimple(b: Body, dy: number): void {
    if (dy === 0) return
    const step = Math.sign(dy)
    let remaining = Math.abs(dy)
    while (remaining > 0) {
      const move = Math.min(remaining, TILE / 2)
      remaining -= move
      const ny = b.y + step * move
      if (!this.rectSolid(b.x, ny, b.w, b.h)) { b.y = ny; continue }
      b.vy = 0
      break
    }
  }

  #killEnemy(e: Enemy, crushed: boolean): void {
    if (!e.alive) return
    e.alive = false
    e.squash = crushed ? 0.4 : 0.3
    this.score += E[e.kind].score
  }

  // ── items, fairies, the door ─────────────────────────────

  #revealAt(col: number, row: number): void {
    for (const it of this.items) {
      if (!it.taken && it.hidden && it.col === col && it.row === row) { it.hidden = false; it.reveal = 0.4 }
    }
  }

  #collectibles(): void {
    const p = this.player
    for (const it of this.items) {
      if (it.taken || it.hidden) { if (it.reveal > 0) it.reveal = Math.max(0, it.reveal - 0.016); continue }
      if (this.rectOverlapsCell(p, it.col, it.row)) this.#takeItem(it)
    }
    for (const f of this.fairies) {
      if (f.taken) continue
      if (p.x < f.x + 12 && p.x + p.w > f.x - 12 && p.y < f.y + 12 && p.y + p.h > f.y - 12) {
        f.taken = true
        this.#gainFairy()
      }
    }
    if (!this.items.some(i => i.kind === 'key')) this.doorOpen = true

    const d = this.level.door
    if (this.doorOpen && this.rectOverlapsCell(p, d.col, d.row)) {
      this.score += 1000
      this.state = 'won'
    }
  }

  #takeItem(it: Item): void {
    it.taken = true
    this.pickupFlash += 1
    this.pickupCell = { col: it.col, row: it.row }
    switch (it.kind) {
      case 'key':           this.doorOpen = true; this.score += 1000; break
      case 'jewel':         this.score += it.value ?? 500; break
      case 'treasure':      this.score += it.value ?? 2000; break
      case 'bell':          this.score += 100; this.#freeFairy(); break
      case 'jar':           this.addAmmo(false); this.score += 200; break
      case 'superjar':      this.addAmmo(true); this.score += 500; break
      case 'scroll':        this.ammoCap = Math.min(SCROLL_CAP, this.ammoCap + 1); this.score += 200; break
      case 'hourglass':     this.life = LIFE_FULL; this.score += 500; break
      case 'hourglassHalf': this.life = LIFE_HALF; this.score += 100; break
      case 'fairy':         this.#gainFairy(); break
      case 'life':          this.lives += 1; this.score += 1000; break
      case 'seal':          this.#collectedSeals.add(this.#sealKey(it)); this.sealCount += 1; this.score += 1000; break
      case 'zodiac':        this.zodiacHeld = true; this.score += 5000; break
      case 'wings':         this.wingsHeld = true; this.score += 500; break
    }
  }

  #freeFairy(): void {
    const d = this.level.door
    this.fairies.push({ x: d.col * TILE + TILE / 2, y: d.row * TILE + TILE / 2, phase: 0, taken: false })
  }

  #gainFairy(): void {
    this.fairyCount += 1
    if (this.fairyCount >= FAIRIES_PER_LIFE) { this.fairyCount -= FAIRIES_PER_LIFE; this.lives += 1 }
  }

  // ── hazards + death ──────────────────────────────────────

  #hazardContact(): void {
    const p = this.player
    for (const e of this.enemies) {
      if (!e.alive) continue
      if (p.x < e.x + e.w && p.x + p.w > e.x && p.y < e.y + e.h && p.y + p.h > e.y) { this.#die(); return }
    }
    for (const s of this.shots) {
      if (p.x < s.x + 4 && p.x + p.w > s.x - 4 && p.y < s.y + 4 && p.y + p.h > s.y - 4) { this.#die(); return }
    }
  }

  #die(): void {
    this.lives -= 1
    this.hurtFlash = 0.5
    if (this.lives <= 0) {
      this.lives = 0
      this.state = 'gameover'
    } else {
      this.spawn()
    }
  }
}
