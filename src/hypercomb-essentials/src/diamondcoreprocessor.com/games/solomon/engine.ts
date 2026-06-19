// diamondcoreprocessor.com/games/solomon/engine.ts
//
// Solomon's Key — pure game engine. Framework-free: no DOM, no Pixi, no IoC.
// The overlay drives it (input + a fixed-timestep update loop) and the
// renderer draws its public state. Keeping this module pure makes the game
// trivially testable and lets the designer reuse the same LevelDef shape.
//
// The grid is the world. A level is a row-major array of tile codes plus a
// handful of entity placements (player spawn, door, key, gems, enemies).
// Dana walks, auto-climbs one-tile ledges, and conjures / dispels BRICK tiles
// in front of him at foot level — the core Solomon's Key verb. Build stairs to
// climb, crush enemies, grab the key to open the door, reach the door to win.

export const TILE = 32

// Tile codes. EMPTY is passable; WALL is permanent solid; BRICK is the solid
// the wand creates and destroys (level-authored bricks behave identically).
export const EMPTY = 0
export const WALL = 1
export const BRICK = 2
export type TileCode = 0 | 1 | 2

export interface Cell { col: number; row: number }
export interface EnemySpawn extends Cell { dir?: 1 | -1 }

export interface LevelDef {
  name: string
  cols: number
  rows: number
  /** rows*cols tile codes, row-major. */
  tiles: number[]
  player: Cell
  door: Cell
  key: Cell | null
  gems: Cell[]
  enemies: EnemySpawn[]
}

export type GameState = 'playing' | 'won' | 'dead' | 'gameover' | 'complete'

interface Body { x: number; y: number; w: number; h: number; vx: number; vy: number }

interface Enemy extends Body { dir: 1 | -1; alive: boolean; squash: number }

interface Gem extends Cell { taken: boolean }

/** A wand fireball in flight — a horizontal projectile that kills enemies on
 *  contact and dies on a wall, a brick, or leaving the field. */
export interface Fireball { x: number; y: number; vx: number; life: number }

// Tuning — pixels, pixels/second, pixels/second². Calibrated to the original
// Solomon's Key feel: low gravity gives Dana that signature floaty hang time,
// and walking is deliberate/methodical (it's a puzzle platformer, not a runner).
const GRAVITY = 900
const MOVE_SPEED = 105
const CROUCH_SPEED = 58              // crouch-walk: slower, but still moving (squeeze through gaps)
const MAX_FALL = 560                 // gentle terminal velocity — Dana drifts down, never plummets
const ENEMY_SPEED = 52
const PLAYER_W = TILE * 0.7
// Dana stands exactly one tile tall — the same height as a brick. Ducking
// still drops him to a shorter crouch (slower crouch-walk + a lower fireball).
const PLAYER_H = TILE
const DUCK_H = TILE * 0.7            // crouched hitbox height (feet stay put)
const ENEMY_W = TILE * 0.78
const ENEMY_H = TILE * 0.78
// Largest vertical assist when walking into a ledge — one tile. Bigger walls
// can't be climbed; that's what the wand (and now the jump) are for.
const STEP_UP = TILE
// Jump impulse — a FIXED-height hop (like the original; holding longer doesn't
// jump higher). Apex ≈ 2.25 tiles with ~0.8s of air time, so Dana floats up
// onto a 2-high ledge but a 3-high barrier still needs conjured stair-blocks.
const JUMP_V = 360
// Fireball: speed, radius, fire-rate cap, max airtime, kill score.
const FIRE_SPEED = 320
const FIRE_R = 6
const FIRE_COOLDOWN = 0.3
const FIRE_LIFE = 1.6
const FIRE_SCORE = 150

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
  gems: Gem[] = []
  fireballs: Fireball[] = []
  #fireCooldown = 0
  key: (Cell & { taken: boolean }) | null = null
  doorOpen = false

  lives = 3
  score = 0
  state: GameState = 'playing'

  // Transient flash timers the renderer reads (seconds remaining).
  conjureFlash = 0
  hurtFlash = 0
  // Head-butt: a rising-edge flash + the cell that just shattered, so the overlay
  // can spray stone debris at the broken brick (not the wand's foot-level target).
  smashFlash = 0
  smashCell: Cell | null = null

  // Held input — the overlay writes these from key events. `down` is the
  // crouch key; jump + fireball are edge-triggered methods, not held flags.
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

  /** (Re)load a level from its definition, resetting all dynamic state. */
  load(level: LevelDef): void {
    this.level = level
    this.cols = level.cols
    this.rows = level.rows
    this.grid = Uint8Array.from(level.tiles.slice(0, level.cols * level.rows))
    this.score = 0
    this.lives = 3
    this.spawn()
  }

  /** Reset Dana, enemies, key, gems and door to the level's start — keeps
   *  lives + score (used after a death). */
  spawn(): void {
    // Restore the authored brick layout (created/destroyed bricks revert).
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
    this.#fireCooldown = 0
    this.input.left = this.input.right = this.input.down = false
    this.doorOpen = false
    this.key = this.level.key ? { ...this.level.key, taken: false } : null
    this.gems = this.level.gems.map(g => ({ ...g, taken: false }))
    this.enemies = this.level.enemies.map(e => ({
      x: e.col * TILE + (TILE - ENEMY_W) / 2,
      y: e.row * TILE + (TILE - ENEMY_H),
      w: ENEMY_W, h: ENEMY_H, vx: 0, vy: 0,
      dir: e.dir ?? 1, alive: true, squash: 0,
    }))
    this.state = 'playing'
    this.conjureFlash = 0
    this.hurtFlash = 0
    this.smashFlash = 0
    this.smashCell = null
  }

  // ── tile helpers ─────────────────────────────────────────

  inBounds(col: number, row: number): boolean {
    return col >= 0 && col < this.cols && row >= 0 && row < this.rows
  }

  tileAt(col: number, row: number): number {
    if (!this.inBounds(col, row)) return WALL // out-of-bounds reads as solid wall
    return this.grid[row * this.cols + col]
  }

  setTile(col: number, row: number, code: number): void {
    if (this.inBounds(col, row)) this.grid[row * this.cols + col] = code
  }

  solidAt(col: number, row: number): boolean {
    const t = this.tileAt(col, row)
    return t === WALL || t === BRICK
  }

  /** True if the rect [x,y,w,h] overlaps any solid tile. */
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

  /** The cell the wand targets: the column Dana faces. Standing aims at his
   *  foot row (body level — the classic stair-step); crouching aims one row
   *  LOWER, so a duck lets you conjure a brick at the low level in front
   *  (fill a pit ahead, build a descending step). */
  targetCell(): Cell {
    const footRow = Math.floor((this.player.y + this.player.h - 1) / TILE)
    const centerCol = Math.floor((this.player.x + this.player.w / 2) / TILE)
    return { col: centerCol + this.facing, row: footRow + (this.ducking ? 1 : 0) }
  }

  /** Fire the wand. Empty target → conjure a brick (crushing any enemy there);
   *  brick target → dispel it. Walls are immovable. Returns what happened. */
  cast(): 'conjure' | 'dispel' | 'blocked' {
    if (this.state !== 'playing') return 'blocked'
    const { col, row } = this.targetCell()
    if (!this.inBounds(col, row)) return 'blocked'
    const t = this.tileAt(col, row)
    if (t === WALL) return 'blocked'
    if (t === BRICK) {
      this.setTile(col, row, EMPTY)
      this.conjureFlash = 0.18
      return 'dispel'
    }
    // EMPTY → conjure. You can never be "in the way" of a brick: if Dana's
    // box slightly intrudes into the target cell, shove him back out so he
    // ends flush against it, then conjure. Only a genuine sandwich (a solid
    // right behind him, leaving nowhere to eject to) still blocks.
    if (!this.#ejectFromCell(col, row)) return 'blocked'
    this.setTile(col, row, BRICK)
    this.conjureFlash = 0.18
    // Crush any enemy standing in the freshly-filled cell.
    for (const e of this.enemies) {
      if (e.alive && this.rectOverlapsCell(e, col, row)) {
        e.alive = false
        e.squash = 0.4
        this.score += 200
      }
    }
    return 'conjure'
  }

  rectOverlapsCell(b: Body, col: number, row: number): boolean {
    const cx = col * TILE, cy = row * TILE
    return b.x < cx + TILE && b.x + b.w > cx && b.y < cy + TILE && b.y + b.h > cy
  }

  /** If Dana's box intrudes into cell (col,row), push him horizontally out of
   *  it (away from the brick, i.e. opposite his facing) until he's flush. The
   *  brick is always conjured in the facing direction, so the eject is always
   *  backwards. Returns false only if there's no room to back up (a solid right
   *  behind him) — the caller treats that as a genuine block. A no-op (true)
   *  when he isn't intruding, so a normal conjure never moves him. */
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

  /** Advance one frame. dt in seconds (clamped by the caller). */
  update(dt: number): void {
    if (this.conjureFlash > 0) this.conjureFlash = Math.max(0, this.conjureFlash - dt)
    if (this.hurtFlash > 0) this.hurtFlash = Math.max(0, this.hurtFlash - dt)
    if (this.smashFlash > 0) this.smashFlash = Math.max(0, this.smashFlash - dt)
    if (this.state !== 'playing') return

    this.#stepPlayer(dt)
    this.#stepEnemies(dt)
    this.#stepFireballs(dt)
    this.#collectibles()
    this.#enemyContact()
  }

  /** Jump — an upward impulse, only from the ground and only while standing
   *  (you can't spring out of a crouch). Edge-triggered by the overlay. */
  jump(): void {
    if (this.state !== 'playing') return
    if (!this.onGround || this.ducking) return
    this.player.vy = -JUMP_V
    this.onGround = false
  }

  /** Shoot a fireball in the facing direction (rate-limited). Fired lower
   *  while crouched, so ducking hugs the floor to pick off ground enemies. */
  fireball(): void {
    if (this.state !== 'playing') return
    if (this.#fireCooldown > 0) return
    this.#fireCooldown = FIRE_COOLDOWN
    const p = this.player
    // Anchor to the FEET (not the head): Dana stands taller than a ground enemy,
    // so a head-relative shot sails over them. Feet-relative keeps it at enemy
    // height whether standing or crouched — a touch lower while ducked.
    const fy = (p.y + p.h) - TILE * (this.ducking ? 0.3 : 0.5)
    const fx = this.facing > 0 ? p.x + p.w : p.x - FIRE_R
    this.fireballs.push({ x: fx, y: fy, vx: this.facing * FIRE_SPEED, life: FIRE_LIFE })
    this.conjureFlash = 0.12 // brief muzzle spark at the wand
  }

  #stepPlayer(dt: number): void {
    const p = this.player

    // Crouch: engage on the ground when Down is held; keep trying to stand the
    // moment it's released (blocked if there's a low ceiling overhead).
    if (this.input.down && this.onGround && !this.ducking) this.#engageDuck()
    else if (!this.input.down && this.ducking) this.#tryStand()

    // Crouch-walking is slower than standing, but you CAN still move while
    // ducked — that's how you squeeze through a 1-tile-high gap.
    const held = (this.input.left ? -1 : 0) + (this.input.right ? 1 : 0)
    if (held !== 0) this.facing = held as 1 | -1
    this.walking = held !== 0
    p.vx = held * (this.ducking ? CROUCH_SPEED : MOVE_SPEED)
    p.vy = Math.min(p.vy + GRAVITY * dt, MAX_FALL)

    this.#moveX(p, p.vx * dt)
    this.#moveYPlayer(p, p.vy * dt)

    // Fell out the bottom of the world (open pit) — lose a life.
    if (p.y > this.height + TILE) this.#die()
  }

  // Shrink to the crouched hitbox, keeping the feet pinned in place.
  #engageDuck(): void {
    const p = this.player
    const footY = p.y + p.h
    p.h = DUCK_H
    p.y = footY - DUCK_H
    this.ducking = true
  }

  // Stand back up — but only if the full-height hitbox is clear above (so you
  // can't pop up through a brick conjured on your head).
  #tryStand(): void {
    const p = this.player
    const footY = p.y + p.h
    const ny = footY - PLAYER_H
    if (this.rectSolid(p.x, ny, p.w, PLAYER_H)) return // low ceiling — stay crouched
    p.y = ny
    p.h = PLAYER_H
    this.ducking = false
  }

  #stepFireballs(dt: number): void {
    if (this.#fireCooldown > 0) this.#fireCooldown = Math.max(0, this.#fireCooldown - dt)
    if (this.fireballs.length === 0) return
    const survive: Fireball[] = []
    for (const f of this.fireballs) {
      f.x += f.vx * dt
      f.life -= dt
      const col = Math.floor(f.x / TILE), row = Math.floor(f.y / TILE)
      // Die on a wall/brick, on leaving the field, or on running out of airtime.
      if (f.life <= 0 || f.x < 0 || f.x > this.width || this.solidAt(col, row)) continue
      let hit = false
      for (const e of this.enemies) {
        if (!e.alive) continue
        if (f.x > e.x && f.x < e.x + e.w && f.y > e.y && f.y < e.y + e.h) {
          e.alive = false
          e.squash = 0.4
          this.score += FIRE_SCORE
          hit = true
          break
        }
      }
      if (!hit) survive.push(f)
    }
    this.fireballs = survive
  }

  // Horizontal move with a one-tile climb assist when grounded.
  #moveX(p: Body, dx: number): void {
    if (dx === 0) return
    const step = Math.sign(dx)
    let remaining = Math.abs(dx)
    while (remaining > 0) {
      const move = Math.min(remaining, TILE / 2)
      remaining -= move
      const nx = p.x + step * move
      if (!this.rectSolid(nx, p.y, p.w, p.h)) { p.x = nx; continue }
      // Blocked. Try to climb up to one tile if grounded and there's room.
      if (this.onGround) {
        let lifted = false
        for (let lift = 2; lift <= STEP_UP; lift += 2) {
          if (!this.rectSolid(nx, p.y - lift, p.w, p.h)) {
            p.y -= lift
            p.x = nx
            lifted = true
            break
          }
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
      // Rising into the ceiling: a BRICK directly overhead shatters from the
      // head-butt (the classic "break bricks with your head") and Dana keeps his
      // upward momentum, punching on through; a permanent WALL stops him cold.
      if (step < 0 && this.#headButt(p, ny)) { p.y = ny; continue }
      if (step > 0) this.onGround = true
      p.vy = 0
      break
    }
    if (step > 0 && !this.onGround) this.#groundCheck(p)
  }

  /** Smash any BRICK tiles the head overlaps at the proposed top edge `ny`.
   *  Returns true only when the path is clear afterwards (so the rise continues);
   *  an immovable WALL sharing the head row can't break and still blocks Dana. */
  #headButt(p: Body, ny: number): boolean {
    const headRow = Math.floor(ny / TILE)
    const c0 = Math.floor(p.x / TILE)
    const c1 = Math.floor((p.x + p.w - 1) / TILE)
    let smashed = false
    for (let c = c0; c <= c1; c++) {
      if (this.tileAt(c, headRow) === BRICK) {
        this.setTile(c, headRow, EMPTY)
        this.smashCell = { col: c, row: headRow }
        smashed = true
      }
    }
    if (!smashed) return false
    this.smashFlash = 0.18
    return !this.rectSolid(p.x, ny, p.w, p.h)
  }

  #groundCheck(p: Body): void {
    this.onGround = this.rectSolid(p.x, p.y + 1, p.w, p.h)
  }

  #stepEnemies(dt: number): void {
    for (const e of this.enemies) {
      if (!e.alive) { if (e.squash > 0) e.squash = Math.max(0, e.squash - dt); continue }
      // Gravity so enemies sit on platforms / fall if their floor is removed.
      e.vy = Math.min(e.vy + GRAVITY * dt, MAX_FALL)
      this.#moveYSimple(e, e.vy * dt)

      // Patrol: reverse at a wall ahead or at a ledge (won't walk off edges).
      const aheadX = e.dir > 0 ? e.x + e.w + 1 : e.x - 1
      const aheadCol = Math.floor(aheadX / TILE)
      const midRow = Math.floor((e.y + e.h / 2) / TILE)
      const footRow = Math.floor((e.y + e.h + 2) / TILE)
      const wallAhead = this.solidAt(aheadCol, midRow)
      const groundAhead = this.solidAt(aheadCol, footRow)
      const grounded = this.rectSolid(e.x, e.y + 1, e.w, e.h)
      if (grounded && (wallAhead || !groundAhead)) e.dir = (e.dir === 1 ? -1 : 1)

      const nx = e.x + e.dir * ENEMY_SPEED * dt
      if (!this.rectSolid(nx, e.y, e.w, e.h)) e.x = nx
      else e.dir = (e.dir === 1 ? -1 : 1)
    }
  }

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

  #collectibles(): void {
    const p = this.player
    for (const g of this.gems) {
      if (!g.taken && this.rectOverlapsCell(p, g.col, g.row)) { g.taken = true; this.score += 100 }
    }
    if (this.key && !this.key.taken && this.rectOverlapsCell(p, this.key.col, this.key.row)) {
      this.key.taken = true
      this.doorOpen = true
      this.score += 500
    }
    // No key in the level → the door is open from the start.
    if (!this.key) this.doorOpen = true

    if (this.doorOpen && this.rectOverlapsCell(p, this.level.door.col, this.level.door.row)) {
      this.score += 1000
      this.state = 'won'
    }
  }

  #enemyContact(): void {
    const p = this.player
    for (const e of this.enemies) {
      if (!e.alive) continue
      if (p.x < e.x + e.w && p.x + p.w > e.x && p.y < e.y + e.h && p.y + p.h > e.y) {
        this.#die()
        return
      }
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
