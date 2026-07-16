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
  | 'pageTime' | 'pageSpace' | 'princess'
// `hidden` items sit inside a brick (break it to reveal). `secret` items sit in an
// EMPTY cell, invisible, and materialise only when Dana waves his wand over them —
// the signature Solomon's Key reveal. A secret is also `hidden` until found.
export interface ItemSpawn extends Cell { kind: ItemKind; hidden?: boolean; secret?: boolean; value?: number }

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
  /** Visual theme the renderer bakes the room with (per-shrine identity):
   *  'sandstone' | 'verdant' | 'crystal' | 'abyss'. Defaults to sandstone. */
  theme?: string
}

export type GameState = 'playing' | 'won' | 'dead' | 'gameover' | 'complete'

interface Body { x: number; y: number; w: number; h: number; vx: number; vy: number }

/** Per-kind state machines — each foe uses a small subset of these. */
export type EnemyState =
  | 'patrol' | 'chase' | 'scan' | 'windup' | 'punch' | 'attack' | 'recover' | 'flee'
  | 'hover' | 'align' | 'swoop' | 'rise' | 'drift' | 'dart' | 'hunt' | 'stun'

/** How a foe died — the overlay picks SFX/bursts by cause; 'expire' scores nothing. */
export type KillCause = 'crush' | 'drop' | 'fire' | 'expire'

export interface Enemy extends Body {
  kind: EnemyKind
  dir: 1 | -1
  alive: boolean
  squash: number          // death flatten timer (seconds remaining)
  anim: number            // animation phase, advances while moving
  fireCd: number          // attack cadence (shots / charges / swoops per kind)
  smashCd: number         // goblin brick-punch cooldown
  ttl: number             // demonhead self-expire countdown (0 = immortal)
  airY: number | null     // y at the moment it left the ground (for drop-death)
  state: EnemyState
  stateT: number          // seconds remaining in the current state
  telegraph: number       // 0..1 attack imminence — the renderer's windup cue
  lockX: number           // locked dart/swoop unit vector (set at windup end)
  lockY: number
  homeY: number           // neul's hover baseline
  bounces: number         // sparkball bounce tally toward its supercharge
}

interface Item extends ItemSpawn { taken: boolean; reveal: number }

/** A released fairy — bobs where it was freed until Dana collects it. */
interface Fairy { x: number; y: number; phase: number; taken: boolean }

export interface Mirror extends Cell {
  cd: number
  kind: MirrorKind
  count: number       // spawns emitted so far — emission direction alternates
  telegraph: number   // 0..1 charge-up glow before the next emission
}

/** Dana's fireball — a horizontal projectile. A normal bolt dies on the first
 *  enemy it hits; a SUPER bolt plows through every enemy in its path. */
export interface Fireball { x: number; y: number; vx: number; life: number; super: boolean }

/** An enemy projectile (gargoil / dragon / saramandor / panel). Breaks bricks,
 *  kills Dana. */
export interface Shot { x: number; y: number; vx: number; life: number }

// Tuning — pixels, pixels/second, pixels/second².
const GRAVITY = 900          // enemies + projectiles fall at this
// Dana falls LIGHTER than everything else — the signature Solomon's Key floaty hop.
// It hangs at the apex long enough to conjure a block underneath and land on it.
const PLAYER_GRAVITY = 660
const MOVE_SPEED = 105
const CROUCH_SPEED = 58
const MAX_FALL = 560
const PLAYER_W = TILE * 0.7
const PLAYER_H = TILE
const DUCK_H = TILE * 0.7
const STEP_UP = TILE
const JUMP_V = 306   // retuned with the apex hang so the arc still tops out at ~2.25 tiles

// Modern platformer hands: the arc keeps the classic ~2.25-tile reach the block
// puzzles are built around, but the feel gains coyote time, a jump buffer,
// release-to-cut, momentum and a floaty apex (which WIDENS the conjure-at-apex
// window without raising the apex). Every window is ≥4 steps at SIM_DT.
const JUMP_CUT = 0.45        // release while rising → vy *= this, once
const COYOTE_TIME = 0.08     // grace after walking off a ledge
const JUMP_BUFFER = 0.12     // a press is remembered this long before landing
const APEX_BAND = 40         // |vy| below this counts as "at the apex"
const APEX_GRAVITY = 0.55    // gravity multiplier inside the apex band
const ACCEL_GROUND = 1500
const DECEL_GROUND = 2000
const SKID_ACCEL = 2600      // reversing against momentum
const ACCEL_AIR = 1050
const DECEL_AIR = 700
const LAND_FLASH_T = 0.15
/** Touchdown speed at/above which a landing reads as "heavy" (big dust/squash). */
export const LAND_HEAVY_VY = 320
/** The fixed simulation step the overlay's accumulator feeds to update(). */
export const SIM_DT = 1 / 60

/** Dana's animation state, recomputed every step — the renderer draws from this. */
export type PlayerAnim = 'idle' | 'run' | 'skid' | 'jump' | 'apex' | 'fall' | 'duck' | 'duckWalk' | 'land'

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
const MIRROR_TELEGRAPH = 0.9  // the glass charges up this long before emitting
const DEMONHEAD_TTL = 7       // a Demonhead fades after this long
const SHOT_SPEED = 150
const SHOT_LIFE = 3

// Per-kind state-machine tuning. Every attack is TELEGRAPHED (a windup the
// renderer draws from `telegraph` 0..1) — individually each foe got fairer, so
// the level rosters got denser to compensate. All timers, no RNG: determinism.
const GOBLIN_SIGHT = TILE * 6         // sees Dana this far (same height band)
const GOBLIN_CHARGE_RANGE = TILE * 4
const GOBLIN_WINDUP = 0.3
const GOBLIN_CHARGE_T = 0.9           // locked-direction sprint (runs off ledges — baitable)
const GOBLIN_CHARGE_MULT = 1.6
const GOBLIN_CHARGE_CD = 2.5
const GOBLIN_PUNCH_WINDUP = 0.4       // brick punch is telegraphed now, not instant
const GOBLIN_PUNCH_RECOVER = 0.35
const GOBLIN_RECOVER = 0.5
const GARGOIL_SCAN_T = 0.6            // stands and scans before flipping at an edge
const GARGOIL_WINDUP = 0.45
const GARGOIL_RECOVER = 0.4
const GARGOIL_FIRE_CD = 2.2
const DRAGON_WINDUP = 0.6
const DRAGON_BURST_N = 3
const DRAGON_BURST_GAP = 0.16
const DRAGON_RECOVER = 0.8
const DRAGON_FIRE_CD = 3.2
const SARA_WINDUP = 0.3
const SARA_FLEE_T = 0.7               // hit-and-run: fires then darts away
const SARA_FLEE_MULT = 1.3
const SARAMANDOR_FIRE_CD = 1.8
const GHOST_HUNT_MULT = 1.5
const GHOST_HUNT_RANGE = TILE * 7
const GHOST_STUN_T = 0.35             // smashing a brick stuns it — walls buy time
const NEUL_WAKE_RANGE = TILE * 6
const NEUL_SWOOP_RANGE = TILE * 5
const NEUL_WINDUP = 0.5
const NEUL_SWOOP_MULT = 2.2
const NEUL_SWOOP_T = 1.0
const NEUL_RISE_T = 0.8
const NEUL_SWOOP_CD = 2.8
const SPARK_BOUNCES = 6               // every Nth bounce → a supercharge cycle
const SPARK_WINDUP = 0.5
const SPARK_SUPER_MULT = 1.6
const SPARK_SUPER_T = 2.2
const DHEAD_DRIFT_T = 1.4
const DHEAD_WINDUP = 0.3
const DHEAD_DART_T = 0.55
const DHEAD_DART_MULT = 1.9
const PANEL_FIRE_CD = 1.7             // idle + the 0.5 windup = the old 2.2 period
const PANEL_WINDUP = 0.5

/** Step `v` toward `target` by at most `maxDelta` (never overshoots). */
function moveToward(v: number, target: number, maxDelta: number): number {
  if (v < target) return Math.min(v + maxDelta, target)
  if (v > target) return Math.max(v - maxDelta, target)
  return v
}

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
  // The two lost Pages persist across deaths (like seals); reaching the caged
  // Princess in her room is the true-ending goal.
  pageTime = false
  pageSpace = false

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

  // Movement state the renderer/overlay read. jumpFlash bumps on takeoff;
  // landFlash counts down after touchdown with landVy holding the impact speed.
  playerAnim: PlayerAnim = 'idle'
  jumpFlash = 0
  landFlash = 0
  landVy = 0
  coyote = 0
  jumpBuffer = 0
  #jumpHeldPrev = false
  #jumpActive = false   // a started jump that release can still cut short
  #groundRow = 0        // body row of the last grounded tick — anchors the airborne cast

  // One-shot event counters + cells (the overlay diffs these after update() for
  // particles/SFX — same pattern as pickupFlash/pickupCell).
  killFlash = 0
  killCell: Cell | null = null
  killCause: KillCause = 'fire'
  shotFlash = 0
  shotCell: Cell | null = null
  spawnFlash = 0
  spawnCell: Cell | null = null
  secretFlash = 0
  secretCell: Cell | null = null
  revealFlash = 0
  revealCell: Cell | null = null

  // Held input — the overlay writes these from key events (jump: press AND
  // release matter — the release cuts a rising arc short).
  input = { left: false, right: false, down: false, jump: false }

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
    this.pageTime = false
    this.pageSpace = false
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
    this.#groundRow = p.row
    this.fireballs = []
    this.shots = []
    this.fairies = []
    this.ammo = []
    this.ammoCap = MAX_AMMO
    this.#fireCooldown = 0
    this.input.left = this.input.right = this.input.down = this.input.jump = false
    this.playerAnim = 'idle'
    this.jumpFlash = this.landFlash = this.landVy = this.coyote = this.jumpBuffer = 0
    this.#jumpHeldPrev = this.#jumpActive = false
    this.doorOpen = false
    this.zodiacHeld = false
    this.wingsHeld = false
    this.life = this.level.lifeStart ?? LIFE_FULL

    this.items = this.level.items.map(it => ({ ...it, taken: false, reveal: 0 }))
    // Seals already collected this game don't reappear.
    for (const it of this.items) if (it.kind === 'seal' && this.#collectedSeals.has(this.#sealKey(it))) it.taken = true
    // Pages collected this game don't reappear either.
    for (const it of this.items) if ((it.kind === 'pageTime' && this.pageTime) || (it.kind === 'pageSpace' && this.pageSpace)) it.taken = true
    this.enemies = this.level.enemies.map(e => this.#makeEnemy(e.kind ?? 'goblin', e.col, e.row, e.dir ?? 1))
    this.mirrors = this.level.mirrors.map(m => ({ col: m.col, row: m.row, kind: m.kind ?? 'demonhead', cd: MIRROR_INTERVAL * 0.6, count: 0, telegraph: 0 }))

    this.state = 'playing'
    this.conjureFlash = this.hurtFlash = this.smashFlash = this.fireFlash = this.pickupFlash = 0
    this.killFlash = this.shotFlash = this.spawnFlash = this.secretFlash = this.revealFlash = 0
    this.smashCell = this.pickupCell = this.killCell = this.shotCell = this.spawnCell = this.secretCell = this.revealCell = null
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
      state: kind === 'neul' ? 'hover' : kind === 'demonhead' ? 'drift' : 'patrol',
      stateT: kind === 'demonhead' ? DHEAD_DRIFT_T : 0,
      telegraph: 0,
      lockX: 0, lockY: 0,
      homeY: row * TILE + (TILE - d.h),
      bounces: 0,
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

  /** The cell the wand targets: the column Dana faces, at his body row standing
   *  or one row LOWER crouched. Airborne, intent wins over pixel position: any
   *  RISING tick targets one row ABOVE the takeoff row (the classic diagonal-up
   *  cast — jump+cast always reaches the brick overhead, even under a low
   *  ceiling), and it stays pinned there through the apex so the hang can never
   *  aim two rows up and conjure a stray block. Only after falling back below
   *  the takeoff row does the target track his feet again (the ledge-drop
   *  rescue-cast). */
  targetCell(): Cell {
    const footRow = Math.floor((this.player.y + this.player.h - 1) / TILE)
    const centerCol = Math.floor((this.player.x + this.player.w / 2) / TILE)
    let row: number
    if (this.onGround || this.ducking) row = footRow + (this.ducking ? 1 : 0)
    else if (this.player.vy < 0) row = this.#groundRow - 1
    else row = Math.max(footRow, this.#groundRow - 1)
    return { col: centerCol + this.facing, row }
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
    // A SECRET hides in an empty cell — the wand uncovers it instead of conjuring.
    if (this.#revealSecret(col, row)) {
      this.conjureFlash = 0.18
      this.secretFlash += 1
      this.secretCell = { col, row }
      return 'conjure'
    }
    if (!this.#ejectFromCell(col, row)) return 'blocked'
    this.setTile(col, row, BRICK)
    this.conjureFlash = 0.18
    for (const e of this.enemies) {
      if (e.alive && e.kind !== 'panel' && this.rectOverlapsCell(e, col, row)) this.#killEnemy(e, 'crush')
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

  /** Buffered jump press (compat shim — the overlay now drives input.jump; the
   *  buffer converts the press into a takeoff on the next grounded/coyote tick). */
  jump(): void {
    if (this.state !== 'playing') return
    this.jumpBuffer = JUMP_BUFFER
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

    // Jump edges: a press arms the buffer; a release while still rising cuts the
    // arc short (variable jump height).
    if (this.input.jump && !this.#jumpHeldPrev) this.jumpBuffer = JUMP_BUFFER
    if (!this.input.jump && this.#jumpHeldPrev && this.#jumpActive && p.vy < 0) {
      p.vy *= JUMP_CUT
      this.#jumpActive = false
    }
    this.#jumpHeldPrev = this.input.jump

    // Takeoff BEFORE the coyote decay — a press on the last coyote tick still flies.
    if (this.jumpBuffer > 0 && (this.onGround || this.coyote > 0) && !this.ducking) {
      p.vy = -JUMP_V
      this.onGround = false
      this.coyote = 0
      this.jumpBuffer = 0
      this.#jumpActive = true
      this.jumpFlash += 1
    }

    if (this.onGround) { this.coyote = COYOTE_TIME; this.#jumpActive = false }
    else this.coyote = Math.max(0, this.coyote - dt)
    if (this.jumpBuffer > 0) this.jumpBuffer = Math.max(0, this.jumpBuffer - dt)
    if (this.landFlash > 0) this.landFlash = Math.max(0, this.landFlash - dt)

    const held = (this.input.left ? -1 : 0) + (this.input.right ? 1 : 0)
    if (held !== 0) this.facing = held as 1 | -1
    this.walking = held !== 0
    // Momentum: accelerate toward the held target speed, skid hard on reversal,
    // coast down when nothing is held (air keeps a little more carry).
    const target = held * (this.ducking ? CROUCH_SPEED : MOVE_SPEED)
    const reversing = target !== 0 && Math.abs(p.vx) > 1 && Math.sign(target) !== Math.sign(p.vx)
    const rate = reversing ? (this.onGround ? SKID_ACCEL : ACCEL_AIR)
      : target !== 0 ? (this.onGround ? ACCEL_GROUND : ACCEL_AIR)
        : (this.onGround ? DECEL_GROUND : DECEL_AIR)
    p.vx = moveToward(p.vx, target, rate * dt)
    // Dana floats near the apex — the hang that makes conjure-a-step land.
    const g = !this.onGround && Math.abs(p.vy) < APEX_BAND ? PLAYER_GRAVITY * APEX_GRAVITY : PLAYER_GRAVITY
    p.vy = Math.min(p.vy + g * dt, MAX_FALL)   // Dana falls lighter; enemies use GRAVITY

    const wasGround = this.onGround
    const vyBefore = p.vy
    this.#moveX(p, p.vx * dt)
    this.#moveYPlayer(p, p.vy * dt)
    if (!wasGround && this.onGround) { this.landFlash = LAND_FLASH_T; this.landVy = vyBefore }
    if (this.onGround) this.#groundRow = Math.floor((p.y + p.h - 1) / TILE)

    this.playerAnim = this.#animState(reversing)

    if (p.y > this.height + TILE) this.#die()
  }

  #animState(reversing: boolean): PlayerAnim {
    const p = this.player
    if (this.ducking) return Math.abs(p.vx) > 4 ? 'duckWalk' : 'duck'
    if (!this.onGround) return p.vy < -APEX_BAND ? 'jump' : Math.abs(p.vy) <= APEX_BAND ? 'apex' : 'fall'
    if (this.landFlash > 0) return 'land'
    if (reversing && Math.abs(p.vx) > 30) return 'skid'
    return Math.abs(p.vx) > 4 ? 'run' : 'idle'
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
          this.#killEnemy(e, 'fire')
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
    this.shotFlash += 1
    this.shotCell = { col: Math.floor(x / TILE), row: Math.floor(y / TILE) }
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
      // Snap flush to the tile boundary (no sub-tile hover): a landing puts the
      // feet exactly on the surface — onGround is immediate, jumps stay crisp.
      if (step > 0) {
        const row = Math.floor((ny + p.h - 1) / TILE)
        p.y = Math.max(p.y, row * TILE - p.h)
        this.onGround = true
      } else {
        const row = Math.floor(ny / TILE)
        p.y = Math.min(p.y, (row + 1) * TILE)
      }
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
    if (!this.onGround) return
    // Rest flush on the surface (the probe tolerates a sub-pixel hover; the
    // ground row is floor((y+h)/TILE) whenever the probe hits).
    const fy = Math.floor((p.y + p.h) / TILE) * TILE - p.h
    if (fy !== p.y && !this.rectSolid(p.x, fy, p.w, p.h)) p.y = fy
    // Grounded means no downward motion: without this, sub-pixel sinking lets
    // gravity sawtooth vy up to ~66px/s between snap ticks, so a ledge walk-off
    // launches with whatever the tooth held at the edge — exit speed would
    // depend on x-position parity.
    if (p.vy > 0) p.vy = 0
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

  /** Ground foes: shared gravity + drop-death prelude, then a per-kind machine. */
  #stepWalker(e: Enemy, dt: number): void {
    e.vy = Math.min(e.vy + GRAVITY * dt, MAX_FALL)
    const before = e.y
    if (!this.#grounded(e) && e.airY === null) e.airY = before
    this.#moveYSimple(e, e.vy * dt)
    const grounded = this.#grounded(e)
    if (grounded && e.airY !== null) {
      if (e.y - e.airY > DROP_KILL) { this.#killEnemy(e, 'drop'); return }
      e.airY = null
    }
    if (e.y > this.height + TILE) { this.#killEnemy(e, 'drop'); return }

    if (e.smashCd > 0) e.smashCd -= dt
    if (e.fireCd > 0) e.fireCd -= dt
    if (e.stateT > 0) e.stateT -= dt

    switch (e.kind) {
      case 'gargoil': this.#stepGargoil(e, dt, grounded); break
      case 'dragon': this.#stepDragon(e, dt, grounded); break
      case 'saramandor': this.#stepSaramandor(e, dt, grounded); break
      default: this.#stepGoblin(e, dt, grounded); break
    }
  }

  // ── walker senses ────────────────────────────────────────

  #aheadInfo(e: Enemy): { col: number; row: number; wallAhead: boolean; brickAhead: boolean; groundAhead: boolean } {
    const aheadX = e.dir > 0 ? e.x + e.w + 1 : e.x - 1
    const col = Math.floor(aheadX / TILE)
    const row = Math.floor((e.y + e.h / 2) / TILE)
    const footRow = Math.floor((e.y + e.h + 2) / TILE)
    const t = this.tileAt(col, row)
    return {
      col, row,
      wallAhead: t === WALL || t === BRICK || t === CRACKED,
      brickAhead: t === BRICK || t === CRACKED,
      groundAhead: this.solidAt(col, footRow),
    }
  }

  #walk(e: Enemy, dt: number, speed: number): void {
    const nx = e.x + e.dir * speed * dt
    if (!this.rectSolid(nx, e.y, e.w, e.h)) { e.x = nx; e.anim += dt * speed }
    else e.dir = -e.dir as 1 | -1
  }

  #danaDir(e: Enemy): 1 | -1 {
    return (this.player.x + this.player.w / 2) >= (e.x + e.w / 2) ? 1 : -1
  }

  #seesDana(e: Enemy, range: number): boolean {
    const dx = (this.player.x + this.player.w / 2) - (e.x + e.w / 2)
    const sameBand = Math.abs((this.player.y + this.player.h) - (e.y + e.h)) < TILE * 1.5
    return Math.abs(dx) < range && sameBand
  }

  #facingDana(e: Enemy): boolean { return Math.sign(this.player.x - e.x) === e.dir }

  #sameRow(e: Enemy): boolean {
    return Math.abs((this.player.y + this.player.h) - (e.y + e.h)) < TILE * 1.2
  }

  // ── the walkers ──────────────────────────────────────────

  /** Goblin — the brute who commits. Patrols (walks off ledges: the drop-bait
   *  stays), chases on sight, then telegraphs and CHARGES in a locked direction —
   *  straight off a ledge if you bait it. Brick punches are telegraphed too. */
  #stepGoblin(e: Enemy, dt: number, grounded: boolean): void {
    e.telegraph = 0
    switch (e.state) {
      case 'chase': {
        if (!this.#seesDana(e, GOBLIN_SIGHT * 2)) { e.state = 'patrol'; break }
        if (grounded) e.dir = this.#danaDir(e)
        const ahead = this.#aheadInfo(e)
        if (grounded && ahead.brickAhead && e.smashCd <= 0) { e.state = 'punch'; e.stateT = GOBLIN_PUNCH_WINDUP; break }
        if (grounded && e.fireCd <= 0 && this.#seesDana(e, GOBLIN_CHARGE_RANGE)) {
          e.dir = this.#danaDir(e)
          e.state = 'windup'; e.stateT = GOBLIN_WINDUP
          break
        }
        this.#walk(e, dt, E.goblin.speed)
        break
      }
      case 'punch': {
        e.telegraph = 1 - Math.max(0, e.stateT) / GOBLIN_PUNCH_WINDUP
        if (e.stateT > 0) break
        const ahead = this.#aheadInfo(e)
        if (ahead.brickAhead) {
          this.setTile(ahead.col, ahead.row, EMPTY)
          this.#revealAt(ahead.col, ahead.row)
          this.smashCell = { col: ahead.col, row: ahead.row }
          this.smashFlash = 0.14
          e.smashCd = 0.7
        }
        e.state = 'recover'; e.stateT = GOBLIN_PUNCH_RECOVER
        break
      }
      case 'windup':
        e.telegraph = 1 - Math.max(0, e.stateT) / GOBLIN_WINDUP
        if (e.stateT <= 0) { e.state = 'attack'; e.stateT = GOBLIN_CHARGE_T; e.fireCd = GOBLIN_CHARGE_CD }
        break
      case 'attack': {
        e.telegraph = 1
        const nx = e.x + e.dir * E.goblin.speed * GOBLIN_CHARGE_MULT * dt
        if (this.rectSolid(nx, e.y, e.w, e.h)) { e.state = 'recover'; e.stateT = GOBLIN_RECOVER; break }
        e.x = nx
        e.anim += dt * E.goblin.speed * GOBLIN_CHARGE_MULT
        if (e.stateT <= 0) { e.state = 'recover'; e.stateT = GOBLIN_RECOVER }
        break
      }
      case 'recover':
        if (e.stateT <= 0) e.state = 'patrol'
        break
      default: {
        if (grounded && this.#seesDana(e, GOBLIN_SIGHT)) { e.state = 'chase'; break }
        this.#walk(e, dt, E.goblin.speed)
        break
      }
    }
  }

  /** Gargoil — the sentry with a rhythm. Stands and SCANS at walls/ledges before
   *  flipping (a readable patrol), and telegraphs every shot. */
  #stepGargoil(e: Enemy, dt: number, grounded: boolean): void {
    e.telegraph = 0
    switch (e.state) {
      case 'scan':
        if (e.stateT <= 0) { e.dir = -e.dir as 1 | -1; e.state = 'patrol' }
        break
      case 'windup':
        e.telegraph = 1 - Math.max(0, e.stateT) / GARGOIL_WINDUP
        if (e.stateT <= 0) {
          this.#fireShot(e.dir > 0 ? e.x + e.w : e.x, e.y + e.h * 0.45, e.dir)
          e.fireCd = GARGOIL_FIRE_CD
          e.state = 'recover'; e.stateT = GARGOIL_RECOVER
        }
        break
      case 'recover':
        if (e.stateT <= 0) e.state = 'patrol'
        break
      default: {
        if (e.fireCd <= 0 && this.#facingDana(e) && this.#sameRow(e)) { e.state = 'windup'; e.stateT = GARGOIL_WINDUP; break }
        const ahead = this.#aheadInfo(e)
        if (grounded && (ahead.wallAhead || !ahead.groundAhead)) { e.state = 'scan'; e.stateT = GARGOIL_SCAN_T; break }
        this.#walk(e, dt, E.gargoil.speed)
        break
      }
    }
  }

  /** Dragon — the boss walker. Hunts but REFUSES ledges (you must dispel the
   *  floor under it or spend a fireball), and rears up into a 3-shot burst. */
  #stepDragon(e: Enemy, dt: number, grounded: boolean): void {
    e.telegraph = 0
    switch (e.state) {
      case 'windup':
        e.telegraph = 1 - Math.max(0, e.stateT) / DRAGON_WINDUP
        if (e.stateT <= 0) { e.state = 'attack'; e.stateT = DRAGON_BURST_N * DRAGON_BURST_GAP; e.lockX = 0 }
        break
      case 'attack': {
        e.telegraph = 1
        const elapsed = DRAGON_BURST_N * DRAGON_BURST_GAP - Math.max(0, e.stateT)
        const due = Math.min(DRAGON_BURST_N, 1 + Math.floor(elapsed / DRAGON_BURST_GAP))
        while (e.lockX < due) {
          this.#fireShot(e.dir > 0 ? e.x + e.w : e.x, e.y + e.h * 0.45, e.dir)
          e.lockX += 1
        }
        if (e.stateT <= 0) { e.fireCd = DRAGON_FIRE_CD; e.state = 'recover'; e.stateT = DRAGON_RECOVER; e.lockX = 0 }
        break
      }
      case 'recover':
        if (e.stateT <= 0) e.state = 'patrol'
        break
      default: {
        if (e.fireCd <= 0 && this.#facingDana(e) && this.#sameRow(e)) { e.state = 'windup'; e.stateT = DRAGON_WINDUP; break }
        if (grounded) e.dir = this.#danaDir(e)
        const ahead = this.#aheadInfo(e)
        if (grounded && (!ahead.groundAhead || ahead.wallAhead)) break   // ledge-aware: stands its ground
        this.#walk(e, dt, E.dragon.speed)
        break
      }
    }
  }

  /** Saramandor — the skirmisher. A fast telegraphed shot, then it FLEES away
   *  from Dana before settling back into its patrol. */
  #stepSaramandor(e: Enemy, dt: number, grounded: boolean): void {
    e.telegraph = 0
    switch (e.state) {
      case 'windup':
        e.telegraph = 1 - Math.max(0, e.stateT) / SARA_WINDUP
        if (e.stateT <= 0) {
          this.#fireShot(e.dir > 0 ? e.x + e.w : e.x, e.y + e.h * 0.45, e.dir)
          e.fireCd = SARAMANDOR_FIRE_CD
          e.dir = this.#danaDir(e) === 1 ? -1 : 1
          e.state = 'flee'; e.stateT = SARA_FLEE_T
        }
        break
      case 'flee': {
        const ahead = this.#aheadInfo(e)
        if (grounded && (ahead.wallAhead || !ahead.groundAhead)) { e.state = 'patrol'; break }   // cornered
        this.#walk(e, dt, E.saramandor.speed * SARA_FLEE_MULT)
        if (e.stateT <= 0) e.state = 'patrol'
        break
      }
      default: {
        if (e.fireCd <= 0 && this.#facingDana(e) && this.#sameRow(e)) { e.state = 'windup'; e.stateT = SARA_WINDUP; break }
        const ahead = this.#aheadInfo(e)
        if (grounded && (ahead.wallAhead || !ahead.groundAhead)) { e.dir = -e.dir as 1 | -1; break }
        this.#walk(e, dt, E.saramandor.speed)
        break
      }
    }
  }

  /** Ghost — the pendulum stalker (fireball-only). Glides with a gentle bob;
   *  when Dana shares its row it HUNTS at 1.5× with lit eyes (telegraph = 1).
   *  Smashing a brick STUNS it briefly — walls buy time instead of nothing. */
  #stepGhost(e: Enemy, dt: number): void {
    if (e.stateT > 0) e.stateT -= dt
    e.anim += dt * E.ghost.speed
    if (e.state === 'stun') {
      e.telegraph = 0
      if (e.stateT <= 0) e.state = 'patrol'
      return
    }
    const rowAligned = Math.abs((this.player.y + this.player.h / 2) - (e.y + e.h / 2)) < TILE
    const inRange = Math.abs((this.player.x + this.player.w / 2) - (e.x + e.w / 2)) < GHOST_HUNT_RANGE
    const hunting = rowAligned && inRange
    e.state = hunting ? 'hunt' : 'patrol'
    e.telegraph = hunting ? 1 : 0
    const speed = E.ghost.speed * (hunting ? GHOST_HUNT_MULT : 1)
    const by = e.y + Math.sin(e.anim * 0.05) * 8 * dt
    if (!this.rectSolid(e.x, by, e.w, e.h)) e.y = by
    const nx = e.x + e.dir * speed * dt
    const col = Math.floor((e.dir > 0 ? nx + e.w : nx) / TILE)
    const row = Math.floor((e.y + e.h / 2) / TILE)
    const t = this.tileAt(col, row)
    if (t === BRICK || t === CRACKED) {
      this.setTile(col, row, EMPTY)
      this.#revealAt(col, row)
      this.smashCell = { col, row }
      this.smashFlash = 0.14
      e.state = 'stun'; e.stateT = GHOST_STUN_T
      return
    }
    if (t === WALL) { e.dir = -e.dir as 1 | -1; return }
    e.x = nx
  }

  /** Neul — the elevator ambusher (fireball-only). Hovers at its home height
   *  ignoring a distant Dana; aligns to his row WITHOUT smashing; then shivers
   *  (windup) and SWOOPS along a locked vector, smashing bricks en route. */
  #stepNeul(e: Enemy, dt: number): void {
    if (e.stateT > 0) e.stateT -= dt
    if (e.fireCd > 0) e.fireCd -= dt
    e.anim += dt * E.neul.speed
    const sp = E.neul.speed
    const pcx = this.player.x + this.player.w / 2, pcy = this.player.y + this.player.h / 2
    const ecx = e.x + e.w / 2, ecy = e.y + e.h / 2
    const dist = Math.hypot(pcx - ecx, pcy - ecy)
    e.telegraph = 0
    switch (e.state) {
      case 'align': {
        if (dist > NEUL_WAKE_RANGE * 1.4) { e.state = 'hover'; e.homeY = e.y; break }
        const dy = pcy - ecy
        const ny = e.y + Math.sign(dy) * Math.min(Math.abs(dy), sp * dt)
        if (!this.rectSolid(e.x, ny, e.w, e.h)) e.y = ny
        const dx = pcx - ecx
        const nx = e.x + Math.sign(dx) * Math.min(Math.abs(dx), sp * 0.5 * dt)
        if (!this.rectSolid(nx, e.y, e.w, e.h)) e.x = nx
        if (Math.abs(dy) < TILE * 0.6 && Math.abs(dx) < NEUL_SWOOP_RANGE && e.fireCd <= 0) {
          e.state = 'windup'; e.stateT = NEUL_WINDUP
        }
        break
      }
      case 'windup':
        e.telegraph = 1 - Math.max(0, e.stateT) / NEUL_WINDUP
        if (e.stateT <= 0) {
          const d = Math.max(1, dist)
          e.lockX = (pcx - ecx) / d
          e.lockY = (pcy - ecy) / d
          e.dir = e.lockX >= 0 ? 1 : -1
          e.state = 'swoop'; e.stateT = NEUL_SWOOP_T
          e.fireCd = NEUL_SWOOP_CD
        }
        break
      case 'swoop': {
        e.telegraph = 1
        const sv = sp * NEUL_SWOOP_MULT * dt
        const nx = e.x + e.lockX * sv
        const ny = e.y + e.lockY * sv
        const col = Math.floor((nx + e.w / 2 + Math.sign(e.lockX) * e.w / 2) / TILE)
        const row = Math.floor((ny + e.h / 2 + Math.sign(e.lockY) * e.h / 2) / TILE)
        const t = this.tileAt(col, row)
        if (t === BRICK || t === CRACKED) {
          this.setTile(col, row, EMPTY)
          this.#revealAt(col, row)
          this.smashCell = { col, row }
          this.smashFlash = 0.14
        }
        if (this.rectSolid(nx, ny, e.w, e.h)) { e.state = 'rise'; e.stateT = NEUL_RISE_T; break }
        e.x = nx; e.y = ny
        if (e.stateT <= 0) { e.state = 'rise'; e.stateT = NEUL_RISE_T }
        break
      }
      case 'rise': {
        const ny = e.y - sp * 0.6 * dt
        if (!this.rectSolid(e.x, ny, e.w, e.h)) e.y = ny
        if (e.stateT <= 0) { e.state = 'hover'; e.homeY = e.y }
        break
      }
      default: {   // hover
        const ny = e.homeY + Math.sin(e.anim * 0.045) * 6
        if (!this.rectSolid(e.x, ny, e.w, e.h)) e.y = ny
        if (dist < NEUL_WAKE_RANGE) e.state = 'align'
        break
      }
    }
  }

  /** Sparkball — the clockwork hazard (fireball-only). Ricochets forever; every
   *  SPARK_BOUNCES-th bounce it pulses (windup) then SUPERCHARGES to 1.6× for a
   *  spell, then renormalizes to base speed EXACTLY (no float drift). */
  #stepSparkball(e: Enemy, dt: number): void {
    if (e.stateT > 0) e.stateT -= dt
    e.anim += dt * E.sparkball.speed
    e.telegraph = 0
    if (e.state === 'windup') {
      e.telegraph = 1 - Math.max(0, e.stateT) / SPARK_WINDUP
      if (e.stateT <= 0) { e.state = 'attack'; e.stateT = SPARK_SUPER_T; this.#sparkNormalize(e, SPARK_SUPER_MULT) }
    } else if (e.state === 'attack') {
      e.telegraph = 1
      if (e.stateT <= 0) { e.state = 'patrol'; e.bounces = 0; this.#sparkNormalize(e, 1) }
    } else if (e.bounces >= SPARK_BOUNCES) {
      e.state = 'windup'; e.stateT = SPARK_WINDUP
    }
    const nx = e.x + e.vx * dt
    if (this.rectSolid(nx, e.y, e.w, e.h)) { e.vx = -e.vx; e.bounces += 1 } else e.x = nx
    const ny = e.y + e.vy * dt
    if (this.rectSolid(e.x, ny, e.w, e.h)) { e.vy = -e.vy; e.bounces += 1 } else e.y = ny
    e.dir = (e.vx >= 0 ? 1 : -1)
  }

  #sparkNormalize(e: Enemy, mult: number): void {
    const base = E.sparkball.speed
    e.vx = Math.sign(e.vx || 1) * base * mult
    e.vy = Math.sign(e.vy || 1) * base * 0.6 * mult
  }

  /** Demonhead — the swarm that lunges. Drifts with the classic bob, then slows
   *  (windup) and DARTS along a locked vector at Dana. Expiry scores nothing. */
  #stepDemonhead(e: Enemy, dt: number): void {
    if (e.stateT > 0) e.stateT -= dt
    e.anim += dt * E.demonhead.speed
    if (e.ttl > 0) { e.ttl -= dt; if (e.ttl <= 0) { this.#killEnemy(e, 'expire'); return } }
    e.telegraph = 0
    switch (e.state) {
      case 'windup': {
        e.telegraph = 1 - Math.max(0, e.stateT) / DHEAD_WINDUP
        const nx = e.x + e.dir * E.demonhead.speed * 0.4 * dt
        if (!this.rectSolid(nx, e.y, e.w, e.h)) e.x = nx
        if (e.stateT <= 0) {
          const pcx = this.player.x + this.player.w / 2, pcy = this.player.y + this.player.h / 2
          const ecx = e.x + e.w / 2, ecy = e.y + e.h / 2
          const d = Math.max(1, Math.hypot(pcx - ecx, pcy - ecy))
          e.lockX = (pcx - ecx) / d
          e.lockY = (pcy - ecy) / d
          e.dir = e.lockX >= 0 ? 1 : -1
          e.state = 'dart'; e.stateT = DHEAD_DART_T
        }
        break
      }
      case 'dart': {
        e.telegraph = 1
        const sv = E.demonhead.speed * DHEAD_DART_MULT * dt
        const nx = e.x + e.lockX * sv, ny = e.y + e.lockY * sv
        if (this.rectSolid(nx, ny, e.w, e.h)) { e.state = 'drift'; e.stateT = DHEAD_DRIFT_T; break }
        e.x = nx; e.y = ny
        if (e.stateT <= 0) { e.state = 'drift'; e.stateT = DHEAD_DRIFT_T }
        break
      }
      default: {   // drift
        const nx = e.x + e.dir * E.demonhead.speed * dt
        const col = Math.floor((e.dir > 0 ? nx + e.w : nx) / TILE)
        const row = Math.floor((e.y + e.h / 2) / TILE)
        if (this.solidAt(col, row)) e.dir = -e.dir as 1 | -1
        else e.x = nx
        e.y += Math.sin(e.anim * 0.06) * 14 * dt
        if (e.stateT <= 0) { e.state = 'windup'; e.stateT = DHEAD_WINDUP }
        break
      }
    }
  }

  /** Panel Monster — the fair turret (invulnerable). Same firing period as ever,
   *  but the maw now visibly opens for PANEL_WINDUP before each shot. */
  #stepPanel(e: Enemy, dt: number): void {
    if (e.state === 'windup') {
      e.stateT -= dt
      e.telegraph = 1 - Math.max(0, e.stateT) / PANEL_WINDUP
      if (e.stateT <= 0) {
        this.#fireShot(e.dir > 0 ? e.x + e.w : e.x, e.y + e.h * 0.45, e.dir)
        e.state = 'patrol'
        e.fireCd = PANEL_FIRE_CD
        e.telegraph = 0
      }
      return
    }
    e.telegraph = 0
    if (e.fireCd > 0) { e.fireCd -= dt; return }
    e.state = 'windup'; e.stateT = PANEL_WINDUP
  }

  #stepMirrors(dt: number): void {
    for (const m of this.mirrors) {
      m.cd -= dt
      m.telegraph = Math.max(0, Math.min(1, 1 - m.cd / MIRROR_TELEGRAPH))
      if (m.cd > 0) continue
      m.cd = MIRROR_INTERVAL
      m.telegraph = 0
      const live = this.enemies.filter(e => e.alive && e.kind === m.kind).length
      if (live >= MIRROR_CAP) continue
      const base: 1 | -1 = m.col < this.cols / 2 ? 1 : -1
      const dir: 1 | -1 = m.count % 2 === 0 ? base : (base === 1 ? -1 : 1)
      m.count += 1
      this.enemies.push(this.#makeEnemy(m.kind, m.col, m.row, dir))
      this.spawnFlash += 1
      this.spawnCell = { col: m.col, row: m.row }
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

  #killEnemy(e: Enemy, cause: KillCause): void {
    if (!e.alive) return
    e.alive = false
    e.squash = cause === 'crush' ? 0.4 : 0.3
    if (cause !== 'expire') this.score += E[e.kind].score   // a timed-out demonhead earns nothing
    this.killFlash += 1
    this.killCell = { col: Math.floor((e.x + e.w / 2) / TILE), row: Math.floor((e.y + e.h / 2) / TILE) }
    this.killCause = cause
  }

  // ── items, fairies, the door ─────────────────────────────

  #revealAt(col: number, row: number): void {
    for (const it of this.items) {
      if (!it.taken && it.hidden && it.col === col && it.row === row) {
        it.hidden = false
        it.reveal = 0.4
        this.revealFlash += 1
        this.revealCell = { col, row }
      }
    }
  }

  /** Uncover a SECRET (a hidden item in an empty cell) when the wand targets it.
   *  Returns true if anything was revealed (so the cast counts as a reveal, not a
   *  conjure). Secrets are the cast-to-find Solomon's Key reward. */
  #revealSecret(col: number, row: number): boolean {
    let found = false
    for (const it of this.items) {
      if (!it.taken && it.hidden && it.secret && it.col === col && it.row === row) { it.hidden = false; it.reveal = 0.4; found = true }
    }
    return found
  }

  #collectibles(): void {
    const p = this.player
    for (const it of this.items) {
      if (it.reveal > 0) it.reveal = Math.max(0, it.reveal - 0.016)   // the reveal pop always plays out
      if (it.taken || it.hidden) continue
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
      case 'pageTime':      this.pageTime = true; this.score += 3000; break
      case 'pageSpace':     this.pageSpace = true; this.score += 3000; break
      case 'princess':      this.score += 10000; this.state = 'won'; break  // reaching her clears the room
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
