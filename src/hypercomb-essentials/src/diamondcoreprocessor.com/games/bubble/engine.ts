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

// A 30px tile (down from 40) — a finer grid for more detailed level geometry
// (smaller "bricks"). The spatial physics constants below were scaled ×0.75 to
// match, so movement still reads identically in TILE units.
export const TILE = 30

// Tile codes. EMPTY is passable; WALL is a one-way platform (solid from above);
// DOOR is a passable TUNNEL tile — step your CENTRE onto one and you warp out of
// its partner door (and so do enemies). Doors are NOT solid: you pass through,
// stand on whatever platform sits under them, and the warp fires on entry.
export const EMPTY = 0
export const WALL = 1
export const DOOR = 2
export type TileCode = 0 | 1 | 2

export interface Cell { col: number; row: number }
export interface EnemySpawn extends Cell { dir?: 1 | -1; kind?: number }

// ── doors (tunnelling warp tiles) ────────────────────────────
// Doors link in PAIRS: scanning the grid row-major, the 1st door tunnels to the
// 2nd, the 3rd to the 4th, and so on. A lone, unpaired door is inert (it links
// to itself — a no-op). `partner` maps a door's grid index to its exit; `pairOf`
// maps it to its pair number so the renderer can tint linked doors alike.
export interface DoorIndex {
  cells: number[]
  partner: Map<number, number>
  pairOf: Map<number, number>
}

/** Index every DOOR tile and pair them two-by-two in scan order. Pure: works on
 *  any tile accessor, so the engine (its live grid) and the designer preview (a
 *  LevelDef's tiles) share one source of truth for pairing + colour. */
export function indexDoors(at: (i: number) => number, cols: number, rows: number): DoorIndex {
  const cells: number[] = []
  const n = cols * rows
  for (let i = 0; i < n; i++) if (at(i) === DOOR) cells.push(i)
  const partner = new Map<number, number>()
  const pairOf = new Map<number, number>()
  for (let k = 0; k < cells.length; k += 2) {
    const a = cells[k]
    const b = cells[k + 1] ?? a            // odd one out → links to itself (inert)
    partner.set(a, b); partner.set(b, a)
    pairOf.set(a, k >> 1); pairOf.set(b, k >> 1)
  }
  return { cells, partner, pairOf }
}

// ── enemy species ────────────────────────────────────────────
// Each foe `kind` is a SPECIES — its own behaviour AND tint, not just a colour
// swatch. Five archetypes for the one-way-platform, screen-wrapping field:
//   walker  — classic ground patrol; reverses at a ledge.
//   hopper  — patrols + springs up on a timer (pops up through one-way ledges).
//   charger — patrols, then dashes when Bub lines up ahead on its row.
//   flyer   — ignores gravity; drifts + weaves, loosely homing on your row.
//   ghost   — a hunter: flies straight at Bub (the fastest — bubble it to stop it).
// All are trapped + popped by bubbles the same way; `angry` (escaped a bubble)
// still multiplies their speed whatever the species.
export type EnemyBehavior = 'walk' | 'hop' | 'charge' | 'fly' | 'ghost'
export interface EnemyKind { name: string; tint: string; behavior: EnemyBehavior; speed: number }
export const ENEMY_KINDS: EnemyKind[] = [
  { name: 'walker',  tint: '#ff5d8f', behavior: 'walk',   speed: 44 },
  { name: 'hopper',  tint: '#7c5cff', behavior: 'hop',    speed: 40 },
  { name: 'charger', tint: '#e3a356', behavior: 'charge', speed: 46 },
  { name: 'flyer',   tint: '#2fd3a0', behavior: 'fly',    speed: 40 },
  { name: 'ghost',   tint: '#bfe3ff', behavior: 'ghost',  speed: 52 },
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
// playing for a couple of seconds to sweep up the leftover fruit (see cleanupTimer)
// before the level-clear tally rolls.
export type GameState = 'playing' | 'cleanup' | 'won' | 'gameover'

interface Body { x: number; y: number; w: number; h: number; vx: number; vy: number }

export interface Enemy extends Body {
  dir: 1 | -1
  alive: boolean
  captured: boolean      // held inside a bubble (AI suspended, follows the bubble)
  angry: boolean         // escaped a bubble once — faster + redder
  kind: number           // species index into ENEMY_KINDS (behaviour + tint)
  grace: number          // post-release seconds during which it can't kill Bub
  bob: number            // idle animation phase (renderer reads it)
  onDoor: boolean        // armed-off while standing on a door (prevents warp ping-pong)
  aiTimer: number        // per-species clock: hop countdown / charge phase / fly-roam + perch
  flying: boolean        // flyers/ghosts: airborne (true) vs descending+perched (false)
}

export interface Bubble {
  x: number; y: number
  vx: number
  phase: 'shoot' | 'float'
  age: number            // seconds alive (drives wobble + rim hue)
  life: number           // seconds remaining before it pops on its own
  r: number
  riseV: number          // float-up speed (charged bubbles rise faster)
  shootTime: number      // how long the forward shoot phase lasts (long bubbles fly farther)
  enemy: Enemy | null    // a trapped foe, or null for an empty bubble
  popped: boolean        // marked for removal this frame
}

export type FruitKind = 0 | 1 | 2 | 3

export interface Fruit extends Body { kind: FruitKind; life: number; taken: boolean; rest: boolean; mult: number }

export interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; hue: number; r: number }

// Power-ups: defeated foes drop a CANDY that Bub collects by walking over it
// (same pickup feel as fruit). None are timed — they last for the player's life,
// cleared only when a life is lost. The exception is the BLUE shoe, which lasts
// just the current level (dropped on clear); the RED shoe, like the other
// candies, survives level clears and is lost only on death. `duration` and
// `weight` (drop frequency) encode this:
//   👟 shoe-blue — run faster · lasts the level · drops OFTEN
//   👟 shoe-red  — run faster · lasts until you lose a life
//   🍬 rapid     — blow bubbles rapid-fire · until you lose a life
//   🍭 big       — huge bubbles, wide trap · until you lose a life
//   ⠿  triple    — blow a 3-bubble spread · lasts the level · drops OFTEN
//   🛡 shield     — absorb one hit · lasts the level · drops OFTEN
// Bubbles are SMALL by default (the standard size), so 'big' is the only size
// power. The 'level'-duration perks (blue shoe, triple, shield) are weighted to
// drop often, so a screen usually yields one or two of them.
export type PowerKind = 'shoe-blue' | 'shoe-red' | 'rapid' | 'big' | 'triple' | 'shield'

export interface PowerMeta { name: string; color: string; hue: number; duration: 'level' | 'life'; weight: number; desc: string }
export const POWER_META: Record<PowerKind, PowerMeta> = {
  'shoe-blue': { name: 'blue shoe',   color: '#4aa3ff', hue: 212, duration: 'level', weight: 4, desc: 'Run faster — lasts the level' },
  'shoe-red':  { name: 'red shoe',    color: '#ff5a5a', hue: 0,   duration: 'life',  weight: 1, desc: 'Run faster — until you lose a life' },
  rapid:       { name: 'rapid candy', color: '#ff5d8f', hue: 335, duration: 'life',  weight: 2, desc: 'Blow bubbles rapid-fire' },
  big:         { name: 'big bubbles', color: '#ffd76a', hue: 45,  duration: 'life',  weight: 2, desc: 'Huge bubbles, wide trap' },
  triple:      { name: 'triple shot', color: '#5fe0ff', hue: 190, duration: 'level', weight: 4, desc: 'Blow a 3-bubble spread — lasts the level' },
  shield:      { name: 'shield',      color: '#86f0b0', hue: 150, duration: 'level', weight: 3, desc: 'Absorb one hit — lasts the level' },
}
export const POWER_ORDER: PowerKind[] = ['shoe-blue', 'shoe-red', 'rapid', 'big', 'triple', 'shield']
/** Drop pool weighted by POWER_META.weight (blue shoes come up often, red rarely). */
const CANDY_POOL: PowerKind[] = POWER_ORDER.flatMap(k => Array<PowerKind>(POWER_META[k].weight).fill(k))

export interface Candy extends Body { kind: PowerKind; life: number; taken: boolean; rest: boolean; bob: number }

// Point-bonus treasures. While you already hold the permanent RED shoe, the
// frequent BLUE shoe drops would be redundant — so those drops become one of
// these instead: pure points, no power. Variants escalate in value and are
// weighted so the small ones come up often and a crown is a rare jackpot.
export interface BonusMeta { name: string; color: string; hue: number; value: number; weight: number }
export const BONUS_KINDS: BonusMeta[] = [
  { name: 'coin',  color: '#ffcf4a', hue: 46,  value: 500,  weight: 5 },
  { name: 'gem',   color: '#5fe0ff', hue: 190, value: 1000, weight: 4 },
  { name: 'ruby',  color: '#ff5d8f', hue: 335, value: 2000, weight: 3 },
  { name: 'star',  color: '#b08bff', hue: 265, value: 3000, weight: 2 },
  { name: 'crown', color: '#ffd76a', hue: 46,  value: 8000, weight: 1 },
]
const BONUS_POOL: number[] = BONUS_KINDS.flatMap((b, i) => Array<number>(b.weight).fill(i))

export interface Bonus extends Body { kind: number; life: number; taken: boolean; rest: boolean; bob: number }

/** A rising, fading "+N" score popup (spawned when a bonus treasure is grabbed). */
export interface FloatText { x: number; y: number; vy: number; life: number; max: number; text: string; color: string }

// Tuning — pixels, pixels/second, pixels/second². The spatial constants were
// scaled ×0.75 from the original 40px-tile values to match TILE=30, so the feel
// is unchanged in tile units (jump ≈ 2.4 tiles, bubble bounce ≈ 1.3 tiles).
const GRAVITY = 1312
const MOVE_SPEED = 134
const MAX_FALL = 570
const PLAYER_W = TILE * 0.74
const PLAYER_H = TILE * 0.86
const JUMP_V = 435                    // clears ~2.4 tiles
const COYOTE = 0.09                   // brief grounded grace after leaving a ledge
const LAND_EPS = 2                    // slack (px) for one-way platform landing

// Per-species base speeds live in ENEMY_KINDS; ANGRY_MULT scales whichever one a
// foe carries once it's escaped a bubble (faster + red).
const ANGRY_MULT = 1.7
const ENEMY_W = TILE * 0.72
const ENEMY_H = TILE * 0.72
const ENEMY_RELEASE_GRACE = 0.5

// Species AI tuning.
const ENEMY_HOP_V = 360                // hopper spring impulse (clears ~1.5 tiles)
const ENEMY_HOP_MIN = 1.1              // …on a random 1.1–2.4 s cadence
const ENEMY_HOP_MAX = 2.4
const CHARGE_SIGHT = TILE * 6          // charger fires when Bub is this close, ahead, on its row
const CHARGE_TIME = 0.6                // dash duration
const CHARGE_COOLDOWN = 1.2            // rest before it can dash again
const CHARGE_MULT = 2.4                // dash speed over the species base
const HUNT_TURN = 1.7                  // ghost velocity-steer responsiveness
// Flyers + ghosts ROAM the room, then come down and PERCH on a platform for a
// beat before taking off again — so they always land somewhere, never float forever.
const FLY_DUR_MIN = 2.5                // seconds airborne before seeking a perch
const FLY_DUR_MAX = 4.5
const PERCH_MIN = 1.2                  // seconds resting on a platform before lift-off
const PERCH_MAX = 2.6
const FLY_TAKEOFF = 300                // upward kick when leaving a perch

// Doors: the spark hue for the tunnelling puff (a portal violet).
const WARP_HUE = 280

// Bubbles: blow rate, shoot phase, drift, lifespan, trapped-escape window.
const BLOW_COOLDOWN = 0.26
const MAX_BUBBLES = 16
const BUBBLE_R = TILE * 0.30           // small by default (the standard size); 'big' candy + charge grow it
const BUBBLE_SHOOT_SPEED = 270
const BUBBLE_SHOOT_TIME = 0.36         // shoot reach ≈ 3.2 tiles (trimmed from 3.8 — was overshooting)
const BUBBLE_RISE = 48                 // float-up speed — bubbles pass through terrain
const BUBBLE_SWAY = 12                 // horizontal drift amplitude while floating
const BUBBLE_LIFE = 11
const BUBBLE_TRAP_LIFE = 7             // a trapped enemy gets this long before escaping
const BUBBLE_BOUNCE_V = 323           // upward kick when Bub rides a bubble's crown

// Hold-to-charge: holding the blow key swells the bubble — at full charge it is
// bigger AND rises faster, an express elevator you can hop onto and ride up. A
// quick tap fires a normal bubble (charge ≈ 0).
const BUBBLE_CHARGE_TIME = 1.0        // hold ~1s for a full-power bubble
const BUBBLE_CHARGE_SIZE = 0.55       // +55% radius at full charge
const BUBBLE_CHARGE_RISE = 1.9        // float-rise ×1.9 at full charge
// The L key blows a long-distance bubble (no perk needed): a long flat shot that
// crosses the screen before drifting up.
const BUBBLE_LONG_SHOOT_TIME = 0.95   // extended shoot phase (≈8 tiles of reach)
const BUBBLE_LONG_SHOOT_SPEED = 1.15  // …and a touch faster out of the mouth

// Scoring + combos. Two contiguous-action combos, each reset after a >1s gap:
//   • bounce combo  — riding empty-bubble crowns  (BOUNCE_BASE pts each)
//   • pop combo (`chain`) — popping trapped-foe bubbles (POP_BASE pts each)
// Both escalate by the SAME tier: ×1 normally, ×2 once you reach 5 in a row,
// ×4 once you reach 10.
const COMBO_WINDOW = 1.0               // max gap (s) before a combo resets
const BOUNCE_BASE = 10                 // points per empty-bubble bounce (× tier)
const POP_BASE = 100                   // points per foe pop (× tier)
const FRUIT_SCORE = [300, 500, 700, 1000] as const
const FRUIT_LIFE = 8                    // seconds a dropped fruit lingers during play

// Level-clear "clean up" grace: when the last foe falls Bub gets a window to
// sweep the leftover fruit before the tally rolls. The window is a RANDOM
// CLEANUP_MIN..CLEANUP_MAX seconds; every fruit grabbed buys FRUIT_TIME_BONUS
// more (capped at CLEANUP_MAX). Even if you sweep everything instantly, the
// window holds for at least CLEANUP_HOLD seconds before the early-out can fire.
const CLEANUP_MIN = 4                   // random window low end (s)
const CLEANUP_MAX = 10                  // random window high end + fruit-extension cap (s)
const CLEANUP_HOLD = 3                  // guaranteed minimum before an early-out (loot swept) can end it
const FRUIT_TIME_BONUS = 0.5

// Power-up candies. Each defeated foe has a chance to drop one; it falls, rests
// on a platform, and is collected on contact. Effects are NOT timed — they apply
// through the effective-value getters below and last until cleared (a level
// clear drops 'level' powers; losing a life drops everything).
const CANDY_LIFE = 9                    // seconds a dropped candy lingers
const CANDY_DROP_CHANCE = 0.34          // per defeated foe
const CANDY_SCORE = 200                 // bonus for grabbing one
const BONUS_LIFE = 9                    // seconds a point-bonus treasure lingers
const SHOE_MULT = 1.6                   // run 60% faster
const RAPID_MULT = 0.42                 // blow at 42% of the base cooldown (~2.4× rate)
const BIG_MULT = 2.6                    // 'big' candy radius vs the small base (≈ the old big bubble)
const BIG_SHOOT_MULT = 0.78            // big bubbles lumber out

export class Engine {
  level: LevelDef
  cols: number
  rows: number
  grid: Uint8Array

  player: Body & { facing: 1 | -1 } = { x: 0, y: 0, w: PLAYER_W, h: PLAYER_H, vx: 0, vy: 0, facing: 1 }
  onGround = false
  walking = false
  blowFlash = 0          // mouth-open animation timer the renderer reads
  blowCharge = 0         // 0..1 hold-to-charge level (renderer draws the swelling bubble)
  #charging = false      // is the blow key currently held?
  invuln = 0             // post-respawn invulnerability (also a blink cue)
  #coyote = 0
  #blowCooldown = 0

  // Doors (warp tiles) indexed at spawn from the live grid. #playerOnDoor arms
  // off the warp while Bub stands on a door so he can't immediately tunnel back.
  #doorInfo: DoorIndex = { cells: [], partner: new Map(), pairOf: new Map() }
  #playerOnDoor = false

  enemies: Enemy[] = []
  bubbles: Bubble[] = []
  fruits: Fruit[] = []
  candies: Candy[] = []
  bonuses: Bonus[] = []        // point-bonus treasures (blue shoes when you already hold red)
  particles: Particle[] = []
  floats: FloatText[] = []     // rising "+N" score popups

  // Power state — booleans, not timers: a power stays on until cleared. shoeBlue
  // is dropped on level clear; shoeRed + rapid + bubbleSize survive clears and
  // fall only on death. Effects apply lazily through the effective-value getters.
  shoeBlue = false
  shoeRed = false
  rapid = false
  bubbleSize: 'normal' | 'big' = 'normal'   // 'normal' = the small default; 'big' candy grows it
  triple = false         // blow a 3-bubble spread (level-duration)
  shield = false         // absorb one hit (level-duration)

  lives = 3
  score = 0
  state: GameState = 'playing'

  chain = 0                // pop combo: contiguous foe pops (no >1s gap)
  #chainTimer = 0
  jumpCombo = 0            // bounce combo: contiguous empty-bubble rides (no >1s gap)
  #jumpComboTimer = 0
  // Level-clear clean-up window (seconds) that bleeds out and is extended by each
  // fruit grabbed. cleanupMax tracks the peak it was filled to so the HUD bar
  // reads as draining from full; cleanupElapsed enforces the CLEANUP_HOLD floor.
  cleanupTimer = 0
  cleanupMax = 0
  cleanupElapsed = 0
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

  /** Door pairing for the current grid (the renderer reads this to draw portals). */
  get doorInfo(): DoorIndex { return this.#doorInfo }

  /** True while the player is in control — normal play OR the post-clear sweep. */
  get #live(): boolean { return this.state === 'playing' || this.state === 'cleanup' }

  // ── effective (power-modified) values ────────────────────
  get #moveSpeed(): number { return this.shoeBlue || this.shoeRed ? MOVE_SPEED * SHOE_MULT : MOVE_SPEED }
  get #blowDelay(): number { return this.rapid ? BLOW_COOLDOWN * RAPID_MULT : BLOW_COOLDOWN }
  get #bubbleR(): number {
    return this.bubbleSize === 'big' ? BUBBLE_R * BIG_MULT : BUBBLE_R
  }
  get #bubbleShoot(): number {
    return this.bubbleSize === 'big' ? BUBBLE_SHOOT_SPEED * BIG_SHOOT_MULT : BUBBLE_SHOOT_SPEED
  }

  /** Active powers for the HUD badge row. No timers — a power is simply on or off. */
  get activePowers(): PowerKind[] {
    const out: PowerKind[] = []
    if (this.shoeBlue) out.push('shoe-blue')
    if (this.shoeRed) out.push('shoe-red')
    if (this.rapid) out.push('rapid')
    if (this.bubbleSize !== 'normal') out.push(this.bubbleSize)
    if (this.triple) out.push('triple')
    if (this.shield) out.push('shield')
    return out
  }

  /** Combo score tier: ×1 normally, ×2 from 5 in a row, ×4 from 10. Shared by
   *  the bounce combo and the pop chain. */
  #comboTier(n: number): number { return n >= 10 ? 4 : n >= 5 ? 2 : 1 }

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
    this.#doorInfo = indexDoors(i => this.grid[i], this.cols, this.rows)
    this.#playerOnDoor = false
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
    this.blowCharge = 0
    this.#charging = false
    this.invuln = 1.4
    this.input.left = this.input.right = false
    this.bubbles = []
    this.fruits = []
    this.candies = []
    this.bonuses = []
    this.particles = []
    this.floats = []
    // A respawn (death or fresh load) clears EVERY power — red shoe included.
    this.shoeBlue = false
    this.shoeRed = false
    this.rapid = false
    this.bubbleSize = 'normal'
    this.triple = false
    this.shield = false
    this.chain = 0
    this.#chainTimer = 0
    this.jumpCombo = 0
    this.#jumpComboTimer = 0
    this.cleanupTimer = 0
    this.cleanupMax = 0
    this.cleanupElapsed = 0
    this.hurtFlash = 0
    this.enemies = this.level.enemies.map(e => {
      const beh = enemyKind(e.kind ?? 0).behavior
      const fly = beh === 'fly' || beh === 'ghost'
      return {
        x: e.col * TILE + (TILE - ENEMY_W) / 2,
        y: e.row * TILE + (TILE - ENEMY_H),
        w: ENEMY_W, h: ENEMY_H, vx: 0, vy: 0,
        dir: e.dir ?? 1, alive: true, captured: false, angry: false,
        kind: e.kind ?? 0, grace: 0, bob: Math.PI * (e.col + e.row),
        onDoor: false, flying: fly,
        // hoppers get a randomised first-hop delay so they don't jump in unison;
        // chargers start past their cooldown so they can dash the moment Bub lines up;
        // fliers start airborne on a roam timer before seeking their first perch.
        aiTimer: beh === 'hop' ? ENEMY_HOP_MIN + Math.random() * (ENEMY_HOP_MAX - ENEMY_HOP_MIN)
          : beh === 'charge' ? -CHARGE_COOLDOWN
          : fly ? FLY_DUR_MIN + Math.random() * (FLY_DUR_MAX - FLY_DUR_MIN)
          : 0,
      }
    })
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
    if (!this.#live) return
    if (!this.onGround && this.#coyote <= 0) return
    this.player.vy = -JUMP_V
    this.onGround = false
    this.#coyote = 0
  }

  /** Emit one bubble in the facing direction (rate-limited, capped). The size,
   *  rise speed, shoot speed + shoot reach are passed in so a normal tap, a
   *  charged hold, and a long-distance shot all share this one chokepoint. */
  #emitBubble(r: number, riseV: number, shootSpeed: number, shootTime: number): void {
    if (!this.#live) return
    if (this.#blowCooldown > 0) return
    if (this.bubbles.length >= MAX_BUBBLES) return
    this.#blowCooldown = this.#blowDelay
    this.blowFlash = 0.2
    const p = this.player
    const mouthY = p.y + p.h * 0.4
    const x = p.facing > 0 ? p.x + p.w + r * 0.5 : p.x - r * 0.5
    // triple-shot fans the blow into three stacked bubbles; otherwise just one.
    const offsets = this.triple ? [-1, 0, 1] : [0]
    for (const o of offsets) {
      if (this.bubbles.length >= MAX_BUBBLES) break
      this.bubbles.push({
        x, y: mouthY + o * r * 1.15, vx: p.facing * shootSpeed,
        phase: 'shoot', age: 0, life: BUBBLE_LIFE, r,
        riseV, shootTime,
        enemy: null, popped: false,
      })
    }
  }

  /** Begin charging a bubble (blow key pressed). Held charge swells the bubble;
   *  release with releaseBlow(). A quick tap charges ≈ 0 → a normal bubble. */
  startBlow(): void {
    if (!this.#live) return
    this.#charging = true
    this.blowCharge = 0
  }

  /** Release the charge → blow a bubble sized by how long it was held. At full
   *  charge it is bigger and rises faster (ride it up). */
  releaseBlow(): void {
    const c = this.#charging ? this.blowCharge : 0
    this.#charging = false
    this.blowCharge = 0
    const r = this.#bubbleR * (1 + c * BUBBLE_CHARGE_SIZE)
    const riseV = BUBBLE_RISE * (1 + c * (BUBBLE_CHARGE_RISE - 1))
    this.#emitBubble(r, riseV, this.#bubbleShoot, BUBBLE_SHOOT_TIME)
  }

  /** Blow a long-distance bubble (L key, no perk): a long flat shot that crosses
   *  the screen before drifting up. */
  blowLong(): void {
    this.#emitBubble(this.#bubbleR, BUBBLE_RISE, this.#bubbleShoot * BUBBLE_LONG_SHOOT_SPEED, BUBBLE_LONG_SHOOT_TIME)
  }

  // ── simulation ───────────────────────────────────────────

  /** Advance one frame. dt in seconds (clamped by the caller). */
  update(dt: number): void {
    if (this.blowFlash > 0) this.blowFlash = Math.max(0, this.blowFlash - dt)
    if (this.hurtFlash > 0) this.hurtFlash = Math.max(0, this.hurtFlash - dt)
    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt)
    if (this.#blowCooldown > 0) this.#blowCooldown = Math.max(0, this.#blowCooldown - dt)
    if (this.#chainTimer > 0) { this.#chainTimer -= dt; if (this.#chainTimer <= 0) this.chain = 0 }
    if (this.#jumpComboTimer > 0) { this.#jumpComboTimer -= dt; if (this.#jumpComboTimer <= 0) this.jumpCombo = 0 }
    this.#stepParticles(dt)
    this.#stepFloats(dt)
    // Powers are untimed; the only thing ticking is the post-clear sweep window.
    if (!this.#live) return

    this.#stepPlayer(dt)
    this.#stepEnemies(dt)
    this.#stepBubbles(dt)
    this.#stepFruit(dt)
    this.#stepCandies(dt)
    this.#stepBonuses(dt)

    if (this.state === 'playing') {
      this.#enemyContact()
      // Last foe down → the round is won. The length guard matters because
      // [].every(...) is true: a level that never spawned an enemy must NOT
      // instant-win (it would softlock the designer's blank-level test).
      // Only linger in a clean-up sweep if there's loot to grab; else clear at once.
      if (this.enemies.length > 0 && this.enemies.every(e => !e.alive)) {
        if (this.#hasLoot()) {
          // A random CLEANUP_MIN..CLEANUP_MAX-second sweep window.
          this.state = 'cleanup'
          this.cleanupTimer = this.cleanupMax = CLEANUP_MIN + Math.random() * (CLEANUP_MAX - CLEANUP_MIN)
          this.cleanupElapsed = 0
        } else this.state = 'won'
      }
    } else {
      // cleanup: the window bleeds out. It ends when the timer empties OR once
      // everything's swept up — but never before CLEANUP_HOLD seconds, so you
      // always get a real beat to collect even if you grab it all instantly.
      this.cleanupTimer = Math.max(0, this.cleanupTimer - dt)
      this.cleanupElapsed += dt
      if (this.cleanupTimer === 0 || (!this.#hasLoot() && this.cleanupElapsed >= CLEANUP_HOLD)) this.state = 'won'
    }
  }

  /** Anything still on the floor worth sweeping in the post-clear window. */
  #hasLoot(): boolean {
    return this.fruits.length > 0 || this.bonuses.length > 0 || this.candies.length > 0
  }

  #stepPlayer(dt: number): void {
    const p = this.player
    if (this.#charging) this.blowCharge = Math.min(1, this.blowCharge + dt / BUBBLE_CHARGE_TIME)
    const held = (this.input.left ? -1 : 0) + (this.input.right ? 1 : 0)
    if (held !== 0) p.facing = held as 1 | -1
    this.walking = held !== 0 && this.onGround
    p.vx = held * this.#moveSpeed
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
    this.#playerOnDoor = this.#stepWarp(p, this.#playerOnDoor)

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
          // Bounce combo: each contiguous crown-ride scores BOUNCE_BASE × tier.
          this.jumpCombo += 1
          this.#jumpComboTimer = COMBO_WINDOW
          this.score += BOUNCE_BASE * this.#comboTier(this.jumpCombo)
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
      if (kind.behavior === 'fly' || kind.behavior === 'ghost') this.#flyEnemy(e, kind, dt)
      else this.#groundEnemy(e, kind, dt)
      e.onDoor = this.#stepWarp(e, e.onDoor)   // enemies tunnel through doors too
    }
  }

  /** Ground species (walk / hop / charge): gravity + one-way platforms, patrolling
   *  and reversing at ledge edges. Hoppers spring on a timer; chargers dash when
   *  Bub lines up ahead on their row. */
  #groundEnemy(e: Enemy, kind: EnemyKind, dt: number): void {
    let speed = kind.speed * (e.angry ? ANGRY_MULT : 1)

    // charger: arm a dash when Bub is ahead, close, and on roughly this row.
    if (kind.behavior === 'charge') {
      e.aiTimer -= dt
      if (e.aiTimer <= -CHARGE_COOLDOWN && e.grace <= 0) {
        const dx = this.#wrapDelta(this.#cx(this.player) - this.#cx(e), this.width)
        const dy = (this.player.y + this.player.h / 2) - (e.y + e.h / 2)
        if (Math.abs(dy) < TILE * 0.8 && Math.sign(dx) === e.dir && Math.abs(dx) < CHARGE_SIGHT) e.aiTimer = CHARGE_TIME
      }
      if (e.aiTimer > 0) speed *= CHARGE_MULT   // mid-dash
    }
    const charging = kind.behavior === 'charge' && e.aiTimer > 0

    // vertical: gravity, with hoppers able to rise UP through one-way platforms.
    e.vy = Math.min(e.vy + GRAVITY * dt, MAX_FALL)
    let grounded: boolean
    if (e.vy < 0) { e.y += e.vy * dt; grounded = false }
    else grounded = this.#descend(e, e.vy * dt) || this.#onPlatform(e)

    // hopper: spring when grounded and the timer elapses.
    if (kind.behavior === 'hop') {
      e.aiTimer -= dt
      if (grounded && e.aiTimer <= 0) {
        e.vy = -ENEMY_HOP_V
        e.aiTimer = ENEMY_HOP_MIN + Math.random() * (ENEMY_HOP_MAX - ENEMY_HOP_MIN)
        grounded = false
      }
    }

    // patrol: reverse at a ledge edge so it won't walk off (a ledge also ends a dash).
    if (grounded) {
      const aheadX = e.dir > 0 ? e.x + e.w + 2 : e.x - 2
      const footRow = Math.floor((e.y + e.h + 2) / TILE)
      if (!this.#platformRow(aheadX, 1, footRow)) {
        e.dir = e.dir === 1 ? -1 : 1
        if (charging) e.aiTimer = 0
      }
    }

    e.x += e.dir * speed * dt
    this.#wrap(e)
  }

  /** Flying species (flyer / ghost): no gravity, no platforms — they cross open
   *  air and wrap. A flyer drifts + weaves, loosely homing on Bub's row; a ghost
   *  is a hunter that steers straight at him (and is the only thing a bubble stops). */
  #flyEnemy(e: Enemy, kind: EnemyKind, dt: number): void {
    const speed = kind.speed * (e.angry ? ANGRY_MULT : 1)

    if (e.flying) {
      // ── airborne: roam the room toward Bub, then time out and come down to perch ──
      e.aiTimer -= dt
      // DIRECT deltas (not the toroidal short-path) so fliers actually cross the
      // room toward Bub instead of hugging an edge and wrapping over the top.
      const dx = (this.player.x + this.player.w / 2) - this.#cx(e)
      const dy = (this.player.y + this.player.h / 2) - (e.y + e.h / 2)
      if (kind.behavior === 'ghost') {
        // ghost: steer the velocity vector straight at Bub, eased + capped at `speed`.
        const d = Math.hypot(dx, dy) || 1
        const k = Math.min(1, dt * HUNT_TURN)
        e.vx += ((dx / d) * speed - e.vx) * k
        e.vy += ((dy / d) * speed - e.vy) * k
      } else {
        // flyer: horizontal drift (wraps around the room) + vertical homing toward
        // Bub's row with a weave — wavy roaming that crosses the room, not a laser.
        e.vx = e.dir * speed
        e.vy = Math.sign(dy) * speed * 0.5 + Math.sin(e.bob * 0.8) * speed * 0.55
      }
      e.x += e.vx * dt
      e.y += e.vy * dt
      this.#wrap(e)
      if (Math.abs(e.vx) > 1) e.dir = e.vx < 0 ? -1 : 1   // face the way it moves (eyes track)
      if (e.aiTimer <= 0) { e.flying = false; e.aiTimer = PERCH_MIN + Math.random() * (PERCH_MAX - PERCH_MIN) }
    } else {
      // ── descend under gravity, land on a platform, perch + amble, then lift off ──
      e.vy = Math.min(e.vy + GRAVITY * dt, MAX_FALL)
      const grounded = this.#descend(e, e.vy * dt) || this.#onPlatform(e)
      if (grounded) {
        e.aiTimer -= dt   // the perch clock only runs once it has actually landed
        const aheadX = e.dir > 0 ? e.x + e.w + 2 : e.x - 2
        const footRow = Math.floor((e.y + e.h + 2) / TILE)
        if (!this.#platformRow(aheadX, 1, footRow)) e.dir = e.dir === 1 ? -1 : 1   // amble, turn at ledges
        e.x += e.dir * speed * 0.6 * dt
        this.#wrap(e)
        if (e.aiTimer <= 0) {
          e.flying = true
          e.vy = -FLY_TAKEOFF
          e.aiTimer = FLY_DUR_MIN + Math.random() * (FLY_DUR_MAX - FLY_DUR_MIN)
        }
      } else {
        e.x += e.dir * speed * 0.5 * dt   // a little forward drift while falling
        this.#wrap(e)
      }
    }
  }

  // ── doors (tunnelling warp) ──────────────────────────────

  #cx(b: Body): number { return b.x + b.w / 2 }

  /** Shortest signed delta on a wrapped axis of length `span`, so homing + line of
   *  sight take the short way around the toroidal field. */
  #wrapDelta(d: number, span: number): number {
    const h = span / 2
    return d > h ? d - span : d < -h ? d + span : d
  }

  /** Grid index of the cell under a body's centre (the body is already wrapped
   *  in-bounds; clamp just guards the seam). */
  #centerCell(b: Body): number {
    const col = Math.min(this.cols - 1, Math.max(0, Math.floor((b.x + b.w / 2) / TILE)))
    const row = Math.min(this.rows - 1, Math.max(0, Math.floor((b.y + b.h / 2) / TILE)))
    return row * this.cols + col
  }

  /** Tunnel a body to its door's partner the FRAME it enters a new door cell.
   *  Returns the body's new on-a-door state: it stays `true` right after a warp
   *  (the body now sits on the exit door) so it must step off and re-enter to
   *  warp again — no ping-pong. Velocity is preserved, so momentum carries. */
  #stepWarp(b: Body, wasOnDoor: boolean): boolean {
    const idx = this.#centerCell(b)
    const onDoorNow = this.grid[idx] === DOOR
    if (onDoorNow && !wasOnDoor) {
      const exit = this.#doorInfo.partner.get(idx)
      if (exit != null && exit !== idx) {
        this.#spawnPop(b.x + b.w / 2, b.y + b.h / 2, 200, 10, WARP_HUE)
        b.x = (exit % this.cols) * TILE + (TILE - b.w) / 2
        b.y = ((exit / this.cols) | 0) * TILE + (TILE - b.h) / 2
        this.#spawnPop(b.x + b.w / 2, b.y + b.h / 2, 220, 12, WARP_HUE)
        return true
      }
    }
    return onDoorNow
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
        if (b.age >= b.shootTime) b.phase = 'float'
      } else {
        // Drift UP through everything; collect just under the top of the screen.
        b.y -= b.riseV * dt
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
      this.#chainTimer = COMBO_WINDOW
      this.score += POP_BASE * this.#comboTier(this.chain)
      this.#spawnPop(b.x, b.y, 320, 14)
      this.#spawnFruit(b.x, b.y, (Math.max(0, Math.min(this.chain - 1, 3))) as FruitKind, this.chain)
      if (Math.random() < CANDY_DROP_CHANCE) this.#spawnCandy(b.x, b.y)
    } else {
      this.#spawnPop(b.x, b.y, 180, 6)
    }
    this.bubbles = this.bubbles.filter(x => !x.popped)
  }

  /** Drop a fruit (it lingers FRUIT_LIFE seconds during play). `mult` is the chain
   *  length at the pop — chained pops drop fruit worth that many times its value. */
  #spawnFruit(x: number, y: number, kind: FruitKind, mult: number): void {
    this.fruits.push({
      x: x - TILE * 0.3, y: y - TILE * 0.3, w: TILE * 0.6, h: TILE * 0.6,
      vx: 0, vy: -45, kind, mult, life: FRUIT_LIFE, taken: false, rest: false,
    })
  }

  /** Fruit fall, rest on platforms, and are collected on contact for points.
   *  During play they expire on their own life; during the post-clear clean-up
   *  their life is frozen and every grab instead extends the clean-up window. */
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
      this.#wrap(f)
      if (!cleaning) { f.life -= dt; if (f.life <= 0) { f.taken = true; continue } }
      if (p.x < f.x + f.w && p.x + p.w > f.x && p.y < f.y + f.h && p.y + p.h > f.y) {
        f.taken = true
        const value = FRUIT_SCORE[f.kind] * f.mult
        this.score += value
        if (cleaning) {
          this.cleanupTimer = Math.min(CLEANUP_MAX, this.cleanupTimer + FRUIT_TIME_BONUS)
          this.cleanupMax = Math.max(this.cleanupMax, this.cleanupTimer)
        }
        const fcx = f.x + f.w / 2, fcy = f.y + f.h / 2
        this.#spawnPop(fcx, fcy, 220, 8, 48)
        // chained fruit is worth a multiple — show the boosted value rising off it.
        if (f.mult > 1) this.#spawnFloat(fcx, fcy - TILE * 0.3, '+' + value, '#ffd76a')
      }
    }
    this.fruits = this.fruits.filter(f => !f.taken)
  }

  // ── power-up candies ─────────────────────────────────────

  #spawnCandy(x: number, y: number): void {
    const kind = CANDY_POOL[Math.floor(Math.random() * CANDY_POOL.length)]
    // A blue shoe is pointless once you already hold the permanent red one, so
    // that common drop turns into a point-bonus treasure instead.
    if (kind === 'shoe-blue' && this.shoeRed) { this.#spawnBonus(x, y); return }
    this.candies.push({
      x: x - TILE * 0.32, y: y - TILE * 0.32, w: TILE * 0.64, h: TILE * 0.64,
      vx: 0, vy: -60, kind, life: CANDY_LIFE, taken: false, rest: false, bob: x,
    })
  }

  /** Candies fall, rest on platforms, and are collected on contact — same shape
   *  as fruit, but pickup switches on a power instead of just scoring. */
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
      this.#wrap(c)
      // Freeze the timer during the post-clear sweep so loot can't vanish out
      // from under the player (mirrors #stepFruit).
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

  // ── point-bonus treasures ────────────────────────────────

  #spawnBonus(x: number, y: number): void {
    const kind = BONUS_POOL[Math.floor(Math.random() * BONUS_POOL.length)]
    this.bonuses.push({
      x: x - TILE * 0.32, y: y - TILE * 0.32, w: TILE * 0.64, h: TILE * 0.64,
      vx: 0, vy: -60, kind, life: BONUS_LIFE, taken: false, rest: false, bob: x,
    })
  }

  /** Treasures fall, rest, and are grabbed on contact for their point value —
   *  with a rising "+N" popup so the reward reads. No power, just points. */
  #stepBonuses(dt: number): void {
    if (this.bonuses.length === 0) return
    const p = this.player
    for (const b of this.bonuses) {
      if (b.taken) continue
      if (b.vy < 0) { b.y += b.vy * dt; b.vy = Math.min(b.vy + GRAVITY * dt, MAX_FALL) }
      else {
        b.vy = Math.min(b.vy + GRAVITY * dt, MAX_FALL)
        b.rest = this.#descend(b, b.vy * dt) || this.#onPlatform(b)
      }
      this.#wrap(b)
      // Frozen during the post-clear sweep, like fruit + candies — a treasure
      // worth thousands must not time out inside the window meant to grab it.
      if (this.state !== 'cleanup') { b.life -= dt; if (b.life <= 0) { b.taken = true; continue } }
      if (p.x < b.x + b.w && p.x + p.w > b.x && p.y < b.y + b.h && p.y + p.h > b.y) {
        b.taken = true
        const meta = BONUS_KINDS[b.kind]
        this.score += meta.value
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2
        this.#spawnPop(cx, cy, 260, 12, meta.hue)
        this.#spawnFloat(cx, cy - TILE * 0.35, '+' + meta.value, meta.color)
      }
    }
    this.bonuses = this.bonuses.filter(b => !b.taken)
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

  /** Switch a power on. big/small share one slot, so a fresh bubble candy
   *  replaces the other size. Powers stay on until cleared: a level clear drops
   *  the blue shoe (carryLifePowersFrom omits it); a respawn drops everything (spawn). */
  #applyPower(kind: PowerKind): void {
    switch (kind) {
      case 'shoe-blue': this.shoeBlue = true;  break
      case 'shoe-red':  this.shoeRed = true;   break
      case 'rapid':     this.rapid = true;     break
      case 'big':       this.bubbleSize = 'big';   break
      case 'triple':    this.triple = true;        break
      case 'shield':    this.shield = true;        break
    }
  }

  /** Carry the life-duration powers from a just-cleared level's engine into this
   *  fresh one. The blue shoe (a 'level' power) is intentionally NOT carried, so
   *  it ends with the level; red shoe + rapid + bubble size survive the clear. */
  carryLifePowersFrom(prev: Engine): void {
    this.shoeRed = prev.shoeRed
    this.rapid = prev.rapid
    this.bubbleSize = prev.bubbleSize
  }

  #enemyContact(): void {
    if (this.invuln > 0) return
    const p = this.player
    for (const e of this.enemies) {
      if (!e.alive || e.captured || e.grace > 0) continue
      if (p.x < e.x + e.w && p.x + p.w > e.x && p.y < e.y + e.h && p.y + p.h > e.y) {
        if (this.shield) {
          // shield absorbs the hit: spend it, flash, and grant a breather.
          this.shield = false
          this.invuln = 1.0
          this.hurtFlash = 0.35
          this.#spawnPop(p.x + p.w / 2, p.y + p.h / 2, 260, 14, 150)
        } else {
          this.#die()
        }
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
