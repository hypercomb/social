// diamondcoreprocessor.com/games/bubble/engine.ts
//
// Bubble Bobble — pure game engine. Framework-free: no DOM, no Pixi, no IoC.
// The overlay drives it (input + a fixed-timestep update loop) and the renderer
// draws its public state. Keeping this module pure makes the game trivially
// testable and mirrors the sibling Solomon engine's shape.
//
// Faithful to the 1986 arcade: ONE enclosed screen — solid side walls, a ceiling
// and a floor, NO wrapping and NO doors. Bub the round dragon walks + jumps
// across floating one-way platforms and BLOWS BUBBLES.
//
// The arcade dynamics this engine reproduces:
//   · A bubble SHOOTS forward fast and decelerates (it doesn't fly at constant
//     speed) — and it only TRAPS a foe while it still has shot momentum. Once it
//     slows to a float it's harmless foam: you aim shots, you don't lay mines.
//   · Floating bubbles pass through one-way platforms as the level's upward
//     air current carries them toward the ceiling.
//   · TOUCHING a bubble pops it — and the pop CASCADES through every touching
//     bubble, so a gathered cluster bursts in one chain (trapped foes defeated
//     en masse = the signature mass combo). Hold JUMP while landing on a
//     bubble's crown to BOUNCE off it instead and ride the foam upward.
//   · Jumping is a SHORT, snappy hop — about twice Bub's own height, barely
//     clearing the next ledge, exactly the arcade's ratio. Hopping island to
//     island through the one-way platforms is the normal way around a screen;
//     bubble bouncing is for the tall shafts, not every ledge.
//   · A trapped foe struggles and its bubble flashes red before it escapes,
//     angrier and faster. Defeated foes burst into food that arcs and bounces.
//   · Walkers roam: they stride off ledge edges, spring up through platforms to
//     chase you, and reverse at walls — they work the whole screen, like the
//     arcade cast.
//
// Terrain is BUBBLE BOBBLE one-way platforms for CHARACTERS: solid only from
// above (you land on top), passable from below and sideways. Bubbles also pass
// through these ledges. The screen is a closed box.

// A 15px tile — HALF the character height, the arcade's fine brick grid. In
// the 1986 original the field is 32×25 blocks and Bub is a 2×2-block sprite;
// here Bub spans ~1.5×1.7 tiles on a 40×26 grid, so platforms are one thin
// tile thick and levels can carve detailed geometry. Entities and physics are
// tuned in PIXELS (the same values as ever) — only the geometry grid is finer.
export const TILE = 15

// Tile codes. EMPTY is passable; WALL is a one-way platform (solid from above).
export const EMPTY = 0
export const WALL = 1
export type TileCode = 0 | 1

export interface Cell { col: number; row: number }
export interface EnemySpawn extends Cell { dir?: 1 | -1; kind?: number }

// ── enemy species (the classic Bubble Bobble cast) ───────────
// Each foe `kind` is a SPECIES — its own behaviour AND tint. Faithful, simple
// behaviours (no dashers, no homing hunters):
//   zen-chan — the basic blue roamer; walks off ledges, springs up after you.
//   mighta   — a tougher orange roamer (same gait, fiercer look).
//   banebou  — a green bouncer; patrols and springs up through ledges.
//   monsta   — the pink flyer; drifts diagonally and bounces off the walls.
// All are trapped + popped by bubbles the same way; `angry` (escaped a bubble,
// OR the screen's "Hurry up!" timer fired) multiplies their speed and reddens
// them whatever the species.
export type EnemyBehavior = 'walk' | 'hop' | 'fly'
export interface EnemyKind { name: string; tint: string; behavior: EnemyBehavior; speed: number }
export const ENEMY_KINDS: EnemyKind[] = [
  { name: 'zen-chan', tint: '#4aa3ff', behavior: 'walk', speed: 46 },
  { name: 'mighta',   tint: '#ff8a3d', behavior: 'walk', speed: 42 },
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
  /** World index (renderer THEMES) — classic BB rethemes each screen. */
  theme?: number
  /** Static treasure cells — the '*' glyph. */
  diamonds?: Cell[]
  /** A DIAMOND ROOM: no foes, grab the treasure before the clock runs out. */
  bonus?: boolean
  /** A BOSS ROUND: Super Drunk holds the screen. He replaces the roster (a boss
   *  level spawns no foes), so the round is won when HE goes down. */
  boss?: boolean
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
  aiTimer: number        // per-species clock: hop countdown / chase-jump think
  edgeLatch: boolean     // one roam decision per ledge-edge encounter
  throwTimer: number     // mighta only: countdown to the next boulder hurl
}

// Special bubbles — the arcade's drifting elementals. They enter from a side
// on a timer, cross the screen slowly, and NEVER trap a foe. Pop one (touch or
// cascade) to unleash its element:
//   water     — a burst of droplets that falls and FLOWS along the platforms,
//               sweeping any free foe it touches into the running chain
//   lightning — a bolt fired horizontally OPPOSITE the way Bub faces (the
//               arcade's famous quirk), killing every foe in its path
export type SpecialKind = 'water' | 'lightning'

export interface Bubble {
  x: number; y: number
  vx: number
  vy: number             // float-phase buoyancy (ramps up to the rise speed)
  phase: 'shoot' | 'float'
  age: number            // seconds alive (drives wobble + rim hue)
  life: number           // seconds remaining before it pops on its own
  r: number
  enemy: Enemy | null    // a trapped foe, or null for an empty bubble
  popped: boolean        // marked for removal this frame
  squash: number         // crown-bounce squash timer (renderer reads it)
  slide: 1 | -1          // preferred slide direction when blocked from above
  special: SpecialKind | null   // a drifting elemental, or null for plain foam
  // Stuck fast to Super Drunk's hide at this angle (radians) around his rim, or
  // null for every ordinary bubble. A blister rides him instead of floating, and
  // POPPING it is the only thing that hurts him — see #clingBoss / #popCascade.
  cling: number | null
}

/** One water droplet: falls, then flows along platform tops until it drips off
 *  an edge, drowning free foes on contact. */
export interface Droplet { x: number; y: number; w: number; h: number; vx: number; vy: number; flowing: boolean; life: number }

/** A projectile — the shared plumbing for elemental bolts (kill foes, pass
 *  through everything), Mighta's boulders (flat, kill Bub), and Super Drunk's
 *  ARCING bottles, which shatter on the first surface they meet into a pair of
 *  skidding glass shards. `vy` only matters to the bottle: the flat kinds keep
 *  it at 0 and fly level, exactly as before. */
export interface Shot {
  kind: 'bolt' | 'boulder' | 'bottle' | 'shard'
  x: number; y: number
  vx: number
  vy: number
  age: number
  /** Tumble phase — a thrown bottle spins end over end (the renderer reads it). */
  spin: number
}

export type FruitKind = 0 | 1 | 2 | 3

export interface Fruit extends Body { kind: FruitKind; life: number; taken: boolean; rest: boolean; mult: number }

export interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; hue: number; r: number }

/** An expanding pop ring (the burst outline every popped bubble leaves). */
export interface Ring { x: number; y: number; r: number; max: number; life: number; hue: number }

/** Baron von Blubba — the arcade's true "Hurry up!" consequence. Dawdle past
 *  the anger phase and this invincible skeletal whale enters and hunts Bub,
 *  flying straight through terrain. He cannot be trapped or popped; he leaves
 *  only when the screen is cleared or a life is lost. */
export interface Baron { x: number; y: number; vx: number; vy: number; age: number }

// ── Super Drunk — the boss of the last round ─────────────────
// The arcade's finale, and the one screen that isn't a roster of foes. He is a
// great hovering drunk who lobs whisky bottles at wherever Bub is STANDING, so
// every throw is dodgeable by moving — and he telegraphs each one by raising the
// bottle first. He can't be trapped (nothing that big fits in a bubble), so the
// screen's own signature mechanic is his weakness instead:
//
//   · bubbles that touch him CLING to his hide as blisters, spread around his
//     rim, and fizzle harmlessly after BOSS_CLING_LIFE if you leave them
//   · POPPING a blister is what hurts him — and pops CASCADE, so a hide ringed
//     with foam goes off in ONE chain for the huge hit (and the huge score)
//   · his belly (BOSS_CORE_R) kills on contact but the blisters ride further
//     out (BOSS_R), so darting the rim to set off the chain is a real, readable
//     risk rather than a coin-flip
//
// Three phases, HP-driven: lazy single lobs → two-bottle volleys → RAGE, where
// he rises and SLAMS the floor (a shockwave of shards each way) and is left
// winded and low — the window to blister him at your own height.
export type BossState = 'idle' | 'windup' | 'throw' | 'rise' | 'slam' | 'recover' | 'dying'

export interface Boss {
  x: number; y: number     // CENTRE (he hovers — no feet, no platforms)
  vx: number; vy: number
  hp: number
  maxHp: number
  state: BossState
  stateT: number           // seconds spent in the current state
  telegraph: number        // 0..1 windup charge — the renderer flashes on it
  face: 1 | -1
  bob: number              // hover phase
  hurt: number             // hit-flash timer
  age: number
  throwTimer: number       // countdown to the next volley
  slamTimer: number        // rage only: countdown to the next floor slam
  volley: number           // bottles left to throw in the current volley
  squash: number           // -1..1 slam squash/stretch the renderer reads
}

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

// ── treasure ─────────────────────────────────────────────────
// Diamonds are STATIC treasure: they hang where the level places them and are
// grabbed on contact. A DIAMOND ROOM (`LevelDef.bonus`) is the arcade's secret
// screen — no foes, tiers of treasure, and a short clock: grab what you can.
// Diamonds work in ordinary rounds too; they're just placed loot.
export interface Diamond extends Body { taken: boolean; bob: number }

// ── umbrellas (the arcade's warp items) ──────────────────────
// Grab one and the round ENDS where it stands and you skip ahead — rarer
// colours skip further. Chained pops earn the better ones (see #defeatEnemy).
export type UmbrellaKind = 'blue' | 'red' | 'pink'
export interface UmbrellaMeta { skip: number; color: string; hue: number }
export const UMBRELLA_META: Record<UmbrellaKind, UmbrellaMeta> = {
  blue: { skip: 3, color: '#4aa3ff', hue: 212 },
  red:  { skip: 5, color: '#ff4d5e', hue: 353 },
  pink: { skip: 7, color: '#ff7ad5', hue: 320 },
}
export interface Umbrella extends Body { kind: UmbrellaKind; life: number; taken: boolean; rest: boolean; bob: number }

/** A rising, fading "+N" score popup (spawned when chained food is grabbed). */
export interface FloatText { x: number; y: number; vy: number; life: number; max: number; text: string; color: string }

// Tuning — pixels, pixels/second, pixels/second².
// JUMP HEIGHT IS A RATIO, NOT A NUMBER. In the arcade Bub is 2 blocks tall, the
// ledge tiers sit ~4 blocks apart, and his hop only just clears one — roughly 2×
// his own height. That ratio IS the feel: a chubby dragon hopping ledge to
// ledge, not a floaty moon leap. So jump and tier spacing move TOGETHER —
// inflate the spacing and the jump must inflate to reach it, which is exactly
// how this drifted to a 4.3×-Bub-height leap over a 6-row rhythm.
//   apex = JUMP_V² / (2·GRAVITY) = 415² / 2500 ≈ 69px ≈ 2.7 × Bub's height,
//   just clearing the levels' 4-row (60px) tiers; apex time ≈ 0.33s — snappy.
// Retuning either means re-spacing levels.ts (see its LAYOUT RULE); the sim's
// jump-reach gate holds you to it.
const GRAVITY = 1250
const MOVE_SPEED = 138
const MAX_FALL = 520                  // lands quickly — no float on the way down
const PLAYER_W = TILE * 1.48          // ≈22px — Bub spans ~1.5 tiles, arcade-style
const PLAYER_H = TILE * 1.72          // ≈26px
const JUMP_V = 415                    // apex ≈ 4.6 tiles — just clears one tier
const COYOTE = 0.09                   // brief grounded grace after leaving a ledge
const LAND_EPS = 2                    // slack (px) for one-way platform landing

// Per-species base speeds live in ENEMY_KINDS; ANGRY_MULT scales whichever one a
// foe carries once it's angry (faster + red).
const ANGRY_MULT = 1.7
const ENEMY_W = TILE * 1.44            // ≈22px round bodies
const ENEMY_H = TILE * 1.44
const ENEMY_RELEASE_GRACE = 0.5
const ENEMY_JUMP_V = 405               // walker chase-spring — clears one tier, like Bub
const ENEMY_EDGE_TURN = 0.35           // chance a walker turns at a ledge edge (else strides off)
const ENEMY_HOP_V = 400                // banebou spring impulse — a tier per bounce
const ENEMY_HOP_MIN = 1.0              // …on a random 1.0–2.2 s cadence
const ENEMY_HOP_MAX = 2.2

// "Hurry up!" — after this long on one screen the survivors turn angry…
const HURRY_UP = 24
// …and this much longer brings out Baron von Blubba: invincible, terrain-blind,
// homing ever faster the longer he's out. Clear the screen or lose a life.
const BARON_DELAY = 10
const BARON_SPEED = 84                 // starting pursuit speed…
const BARON_RAMP = 4.5                 // …+px/s for every second he's out
const BARON_MAX = 170
const BARON_STEER = 260                // homing acceleration (curved pursuit)
const BARON_R = TILE * 1.1             // contact radius (≈16px)

// Super Drunk. He is BIG — a five-tile bulk — and split into two radii: the
// belly that kills, and the wider hide the blisters ride on. The gap between
// them is a bubble's diameter, so brushing a blister off his rim never clips
// the belly: dart the edge and you live, drift into him and you don't.
const BOSS_R = TILE * 2.6              // hide / cling radius (≈39px)
const BOSS_CORE_R = TILE * 1.7         // the lethal belly (≈25px)
const BOSS_HP = 18
const BOSS_DRIFT = 44                  // lazy cruise…
const BOSS_DRIFT_RAGE = 78             // …and the rage lunge
const BOSS_TRACK = 30                  // homing accel toward Bub's column
const BOSS_BOB = 7                     // hover bob amplitude (px)
const BOSS_TOP = TILE * 3.4            // he holds the upper air…
const BOSS_FLOOR_GAP = TILE * 2.2      // …and never sinks below this off the floor, except mid-slam
const BOSS_CLING_LIFE = 7              // a blister's fuse — pop it before it fizzles
const BOSS_POP_DMG = 1                 // one blister popped = one hit
const BOSS_ELEMENT_DMG = 3             // a bolt / water sweep chunks him
const BOSS_HURT_FLASH = 0.22
const BOSS_THROW_MIN = 2.5             // volley cadence (tightened by phase + the slow squeeze)
const BOSS_THROW_RAND = 1.2
const BOSS_THROW_GAP = 0.34            // between the bottles WITHIN a volley
const BOSS_WINDUP = 0.5                // every throw is telegraphed — bottle raised, then hurled
const BOSS_SQUEEZE = 240               // …and the cadence tightens toward ×0.55 over this long (no turtling)
const BOSS_SLAM_EVERY = 7              // rage: seconds between floor slams
const BOSS_RISE_TIME = 0.55            // the slam's telegraph: he hauls himself up first
const BOSS_SLAM_V = 940
const BOSS_RECOVER = 1.15              // winded on the floor — the window to blister him low
const BOSS_DEATH_TIME = 2.2
const BOSS_LOOT = 12                   // the treasure rain he bursts into
const BOSS_SCORE = 20000
const BOSS_SWEEP = 5                   // a longer post-clear sweep for the rain
const BOTTLE_FLIGHT = 0.95             // aimed to land where Bub STANDS this many seconds later
const BOTTLE_GRAV = 640
const BOTTLE_VX_CAP = 260
const BOTTLE_R = 7
const SHARD_SPEED = 158                // glass skids away flat along the surface it broke on
const SHARD_R = 5
const SHARD_LIFE = 2.2

// Death: Bub spins skyward and tumbles off before the respawn (arcade beat).
const DEATH_TIME = 1.35

// Extra lives at the arcade score thresholds; the HUD row stays sane past 7.
const LIFE_AWARDS = [30000, 100000] as const
const LIVES_CAP = 7

// Bubbles: blow rate, shoot ballistics, buoyancy, lifespan, trap-escape window.
const BLOW_COOLDOWN = 0.26
const RAPID_MULT = 0.5                 // candy blows at half the cooldown (~2× rate)
const MAX_BUBBLES = 16
const BUBBLE_R = TILE * 0.84           // big, BB-style bubbles (≈ Bub-sized)
const BUBBLE_SHOOT_SPEED = 560         // launch speed…
const BUBBLE_SHOOT_DRAG = 5.2          // …decaying exponentially (range ≈ 7 tiles)
const BUBBLE_SHOOT_MIN = 40            // slower than this → the shot becomes a float
const BUBBLE_RISE = 72                 // terminal float-up speed
const BUBBLE_RISE_RAMP = 2.6           // buoyancy ramp: hangs a beat, then lifts
const BUBBLE_SWAY = 10                 // horizontal wobble amplitude while floating
const BUBBLE_LIFE = 11
const BUBBLE_TRAP_LIFE = 8             // a trapped enemy gets this long before escaping
export const BUBBLE_WARN = 1.8         // …and its bubble flashes red for the last stretch
const BUBBLE_BOUNCE_V = 480            // hold-JUMP crown bounce — a full jump's worth
const POP_LINK = 1.12                  // pops cascade to bubbles within (r1+r2)×this
const CEIL_GATHER = 34                 // px/s drift toward the top-centre cluster point

// Special bubbles: entry cadence, drift, lifespan, and element tuning.
const SPECIAL_MIN = 7                  // 7–13 s between entries…
const SPECIAL_RAND = 6
const SPECIAL_MAX_OUT = 2              // …never more than two drifting at once
const SPECIAL_LIFE = 14                // unpopped, it fizzles (no effect)
const SPECIAL_DRIFT = 26               // slow horizontal crossing speed
const SPECIAL_RISE = 6                 // barely buoyant — it stays reachable
const WATER_COUNT = 12                 // droplets per burst
const WATER_FLOW = 170                 // flow speed along platform tops
const WATER_LIFE = 4.5
const BOLT_SPEED = 520                 // fired OPPOSITE Bub's facing (the quirk)
const BOLT_R = 10                      // kill radius around the bolt head

// Mighta's boulders: hurled on a cadence, flying flat, deadly to Bub only.
const BOULDER_MIN = 3.5                // 3.5–6 s between hurls (angry: ×0.6)
const BOULDER_RAND = 2.5
const BOULDER_SPEED = 205
const BOULDER_R = 7.5

// Scoring + chain. Pop trapped-foe bubbles in quick succession (or in one
// cascade) to build the chain: each pop scores more AND drops bigger food.
const COMBO_WINDOW = 1.0
const POP_BASE = 100                   // points per foe pop (× chain length)
const FRUIT_SCORE = [300, 500, 700, 1000] as const
const FRUIT_LIFE = 9                    // seconds a dropped food lingers during play
const FRUIT_BOUNCE = 0.42               // arc restitution — food bounces before resting

// Level-clear "clean up" grace: a short fixed window to sweep the leftover food
// before the next screen rolls in.
const CLEANUP_GRACE = 2.5

// Power-up sweets. Each defeated foe has a chance to drop one; it falls, rests on
// a platform, and is collected on contact. Effects are untimed — they last until
// a life is lost (a respawn clears them).
const CANDY_LIFE = 9
const CANDY_DROP_CHANCE = 0.22
const CANDY_SCORE = 500
const SHOE_MULT = 1.5                   // run 50% faster

// Treasure + the diamond room's clock. The all-clear pays for sweeping the
// whole room before time runs out.
const DIAMOND_SIZE = TILE * 1.05
const DIAMOND_SCORE = 500
const BONUS_TIME = 14
const BONUS_ALL_CLEAR = 5000

// Umbrellas: a rare drop off a defeated foe. The chain that killed it decides
// the colour — a longer cascade earns a longer skip.
const UMBRELLA_DROP_CHANCE = 0.06
const UMBRELLA_LIFE = 8
const UMBRELLA_SCORE = 1000
// An umbrella drops where the foe died — which is usually exactly where Bub is
// standing. Without an arming delay it would be swallowed the same frame it
// appeared: an invisible, unavoidable warp. This lets it arc clear and land, so
// taking the ride is a CHOICE you can see coming (and refuse).
const UMBRELLA_ARM = 0.7

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
  rings: Ring[] = []
  floats: FloatText[] = []     // rising "+N" score popups
  waters: Droplet[] = []       // water-burst droplets (fall + flow)
  shots: Shot[] = []           // bolts (kill foes) + boulders (kill Bub)
  diamonds: Diamond[] = []     // static treasure, grabbed on contact
  umbrellas: Umbrella[] = []   // warp items — grabbing one ends the round
  baron: Baron | null = null   // the Hurry-up hunter (null until he enters)
  boss: Boss | null = null     // Super Drunk — only on a `level.boss` round
  dying = 0                    // death-tumble timer; > 0 = Bub is spinning out
  /** Rounds to skip: set when an umbrella is grabbed, read by the overlay. */
  warp = 0
  /** Seconds left in a DIAMOND ROOM (`level.bonus`); 0 in ordinary rounds. */
  bonusTimer = 0
  #diamondTotal = 0            // how many the room started with (all-clear test)
  #specialTimer = 0            // countdown to the next drifting elemental

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

  // Held input — the overlay writes these from key events. `jump` held while
  // landing on a bubble's crown bounces instead of popping (the arcade move).
  // The jump IMPULSE itself stays the edge-triggered jump() method.
  input = { left: false, right: false, jump: false }

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
    this.boss = null   // a fresh round — spawn() mints Super Drunk at full health
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
    this.input.left = this.input.right = this.input.jump = false
    this.bubbles = []
    this.fruits = []
    this.candies = []
    this.particles = []
    this.rings = []
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
    this.baron = null
    this.dying = 0
    this.waters = []
    this.shots = []
    this.umbrellas = []
    this.warp = 0
    // Treasure is placed, not dropped — it hangs on its cell like a foe stands
    // on one, so a '*' on row r sits on the platform at row r+1.
    this.diamonds = (this.level.diamonds ?? []).map(d => ({
      x: d.col * TILE + (TILE - DIAMOND_SIZE) / 2,
      y: d.row * TILE + (TILE - DIAMOND_SIZE),
      w: DIAMOND_SIZE, h: DIAMOND_SIZE, vx: 0, vy: 0,
      taken: false, bob: Math.PI * (d.col * 0.7 + d.row),
    }))
    this.#diamondTotal = this.diamonds.length
    this.bonusTimer = this.level.bonus ? BONUS_TIME : 0
    this.#specialTimer = SPECIAL_MIN + Math.random() * SPECIAL_RAND
    // Super Drunk enters high and centred, already winding up his first bottle.
    // Losing a life resets the SCREEN, never his health — every blister you
    // burst stays burst. (load() nulls him first, so a fresh round starts full.)
    const bossHp = this.boss?.hp ?? BOSS_HP
    this.boss = this.level.boss
      ? {
          x: this.width / 2, y: BOSS_TOP + BOSS_R,
          vx: BOSS_DRIFT, vy: 0,
          hp: bossHp, maxHp: BOSS_HP,
          state: 'idle', stateT: 0, telegraph: 0,
          face: -1, bob: 0, hurt: 0, age: 0,
          throwTimer: BOSS_THROW_MIN, slamTimer: BOSS_SLAM_EVERY,
          volley: 0, squash: 0,
        }
      : null
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
        // hoppers get a randomised first-hop delay so they don't jump in unison;
        // walkers use the same clock as their chase-jump think cadence.
        aiTimer: kind.behavior === 'hop'
          ? ENEMY_HOP_MIN + Math.random() * (ENEMY_HOP_MAX - ENEMY_HOP_MIN)
          : Math.random() * 0.8,
        edgeLatch: false,
        // mighta winds up his first boulder on the normal cadence
        throwTimer: enemyKind(e.kind ?? 0).name === 'mighta'
          ? BOULDER_MIN + Math.random() * BOULDER_RAND
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
    if (!this.#live || this.dying > 0) return
    if (!this.onGround && this.#coyote <= 0) return
    this.player.vy = -JUMP_V
    this.onGround = false
    this.#coyote = 0
  }

  /** Blow one bubble in the facing direction (rate-limited, capped). */
  blow(): void {
    if (!this.#live || this.dying > 0) return
    if (this.#blowCooldown > 0) return
    if (this.bubbles.length >= MAX_BUBBLES) return
    this.#blowCooldown = this.#blowDelay
    this.blowFlash = 0.2
    const p = this.player
    const r = BUBBLE_R
    const x = p.facing > 0 ? p.x + p.w + r * 0.4 : p.x - r * 0.4
    const y = p.y + p.h * 0.4
    this.bubbles.push({
      x, y, vx: p.facing * BUBBLE_SHOOT_SPEED, vy: 0,
      phase: 'shoot', age: 0, life: BUBBLE_LIFE, r,
      enemy: null, popped: false, squash: 0,
      slide: p.facing > 0 ? 1 : -1, special: null, cling: null,
    })
  }

  /** A drifting elemental enters from a side edge and crosses the screen. */
  #spawnSpecial(): void {
    const fromLeft = Math.random() < 0.5
    const r = BUBBLE_R
    this.bubbles.push({
      x: fromLeft ? r + 2 : this.width - r - 2,
      y: this.height * (0.25 + Math.random() * 0.45),
      vx: fromLeft ? SPECIAL_DRIFT : -SPECIAL_DRIFT, vy: 0,
      phase: 'float', age: 0, life: SPECIAL_LIFE, r,
      enemy: null, popped: false, squash: 0,
      slide: fromLeft ? 1 : -1,
      special: Math.random() < 0.5 ? 'water' : 'lightning',
      cling: null,
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
    this.#stepRings(dt)
    this.#stepFloats(dt)
    if (!this.#live) return

    // Death tumble: the world keeps moving while Bub spins out; when the beat
    // ends the life is resolved — respawn, or game over on the last one.
    if (this.dying > 0) {
      this.dying = Math.max(0, this.dying - dt)
      if (this.dying === 0) {
        if (this.lives <= 0) { this.state = 'gameover'; return }
        this.spawn()
        return
      }
    }

    this.#stepPlayer(dt)
    this.#stepEnemies(dt)
    this.#stepBubbles(dt)
    this.#stepWaters(dt)
    this.#stepShots(dt)
    this.#stepFruit(dt)
    this.#stepCandies(dt)
    this.#stepDiamonds()
    this.#stepUmbrellas(dt)
    // An umbrella ends the round the instant it's grabbed — nothing below has
    // any say once the warp is set.
    if (this.warp > 0) return

    if (this.state === 'playing') {
      // A DIAMOND ROOM is its own game: no foes, no Hurry-up, no Baron, no
      // elementals — just Bub, the treasure, and the clock.
      if (this.level.bonus) {
        this.bonusTimer = Math.max(0, this.bonusTimer - dt)
        const swept = this.#diamondTotal > 0 && this.diamonds.length === 0
        if (swept) this.#addScore(BONUS_ALL_CLEAR)
        if (swept || this.bonusTimer === 0) this.state = 'won'
        return
      }
      // a drifting elemental enters on a timer (never more than two out)
      this.#specialTimer -= dt
      if (this.#specialTimer <= 0) {
        this.#specialTimer = SPECIAL_MIN + Math.random() * SPECIAL_RAND
        if (this.bubbles.filter(b => b.special).length < SPECIAL_MAX_OUT) this.#spawnSpecial()
      }
      // A BOSS ROUND is its own game too: Super Drunk is the pressure, so no
      // Hurry-up anger (there's no roster to anger) and no Baron — but the
      // elementals still drift in, and popping one in his face is a real play.
      if (this.level.boss) {
        const b = this.boss
        this.#stepBoss(dt)
        if (this.dying === 0) this.#bossContact()
        if (b && b.state === 'dying' && b.stateT >= BOSS_DEATH_TIME) {
          this.#bossLoot()
          this.boss = null
          this.state = 'cleanup'
          this.cleanupTimer = BOSS_SWEEP
        }
        return
      }

      // Hurry up! — dawdle and the survivors turn angry (faster + red)…
      this.#levelTime += dt
      if (!this.#hurried && this.#levelTime > HURRY_UP) {
        this.#hurried = true
        this.hurryFlash = 1.0
        for (const e of this.enemies) if (e.alive && !e.captured) e.angry = true
      }
      // …and keep dawdling and Baron von Blubba comes for you.
      if (!this.baron && this.#hurried && this.dying === 0
        && this.#levelTime > HURRY_UP + BARON_DELAY) {
        const fromLeft = this.player.x + this.player.w / 2 > this.width / 2
        this.baron = {
          x: fromLeft ? TILE * 1.4 : this.width - TILE * 1.4, y: TILE * 1.4,
          vx: fromLeft ? BARON_SPEED : -BARON_SPEED, vy: 0, age: 0,
        }
        this.hurryFlash = 1.0
      }
      this.#stepBaron(dt)
      if (this.dying === 0) {
        this.#enemyContact()
        this.#baronContact()
      }
      // Last foe down → the round is won (never mid-death-tumble — the life
      // resolves first). The length guard matters because [].every(...) is
      // true: a level that never spawned a foe must NOT instant-win (it would
      // softlock the designer's blank-level test).
      if (this.dying === 0 && this.enemies.length > 0 && this.enemies.every(e => !e.alive)) {
        this.baron = null   // he leaves the moment the screen is beaten
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
      || this.diamonds.length > 0 || this.umbrellas.length > 0
  }

  #stepPlayer(dt: number): void {
    const p = this.player
    // death tumble: ballistic only — no control, no platforms, off the screen
    if (this.dying > 0) {
      p.vy = Math.min(p.vy + GRAVITY * dt, MAX_FALL)
      p.y += p.vy * dt
      this.walking = false
      this.onGround = false
      return
    }
    const held = (this.input.left ? -1 : 0) + (this.input.right ? 1 : 0)
    if (held !== 0) p.facing = held as 1 | -1
    this.walking = held !== 0 && this.onGround
    p.vx = held * this.#moveSpeed
    p.vy = Math.min(p.vy + GRAVITY * dt, MAX_FALL)

    // horizontal — bounded by the side walls
    p.x += p.vx * dt
    this.#clampX(p)
    this.#bubbleContact(p)

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

  /** Bub vs bubbles — the heart of arcade traversal + combat:
   *    · a bubble still SHOOTING is ignored (you can't pop your own fresh shot)
   *    · landing on an empty bubble's crown with JUMP HELD bounces you up —
   *      ride the foam; without jump held, contact POPS
   *    · any pop CASCADES through every touching bubble (see #popCascade) */
  #bubbleContact(p: Body): void {
    for (const b of this.bubbles) {
      if (b.popped || b.phase === 'shoot') continue
      const cx = Math.max(p.x, Math.min(b.x, p.x + p.w))
      const cy = Math.max(p.y, Math.min(b.y, p.y + p.h))
      if ((b.x - cx) ** 2 + (b.y - cy) ** 2 >= b.r * b.r) continue
      const feet = p.y + p.h
      const onCrown = p.vy > 0 && feet < b.y - b.r * 0.2
        && Math.abs((p.x + p.w / 2) - b.x) < b.r * 1.05
      if (onCrown && this.input.jump && !b.enemy) {
        // bounce — the bubble dips + squashes under the weight
        p.vy = -BUBBLE_BOUNCE_V
        p.y = b.y - b.r - p.h
        b.y += 7
        b.squash = 0.2
        return
      }
      this.#popCascade(b)
      // popping while falling gives a small hop, so cascade-bounding along a
      // cluster feels continuous
      if (p.vy > 0) p.vy = -BUBBLE_BOUNCE_V * 0.55
      return
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

  /** Ground species (walk / hop): gravity + one-way platforms. Walkers ROAM —
   *  they stride off ledge edges (only sometimes turning), spring up through
   *  the platforms toward a higher Bub, and reverse at walls. Banebou springs
   *  on its own timer instead. */
  #groundEnemy(e: Enemy, kind: EnemyKind, dt: number): void {
    const speed = kind.speed * (e.angry ? ANGRY_MULT : 1)

    // vertical: gravity, rising UP through one-way platforms, landing on top.
    e.vy = Math.min(e.vy + GRAVITY * dt, MAX_FALL)
    let grounded: boolean
    if (e.vy < 0) { e.y += e.vy * dt; grounded = false; if (e.y < 0) { e.y = 0; e.vy = 0 } }
    else grounded = this.#descend(e, e.vy * dt) || this.#onPlatform(e)
    if (e.y + e.h > this.height) { e.y = this.height - e.h; e.vy = 0; grounded = true }

    if (kind.behavior === 'hop') {
      // banebou: spring when grounded and the timer elapses.
      e.aiTimer -= dt
      if (grounded && e.aiTimer <= 0) {
        e.vy = -ENEMY_HOP_V
        e.aiTimer = ENEMY_HOP_MIN + Math.random() * (ENEMY_HOP_MAX - ENEMY_HOP_MIN)
        grounded = false
      }
    } else if (grounded) {
      // walker chase-spring: think on a cadence; when Bub is a couple of rows
      // up and roughly overhead, jump — up THROUGH the ledges, like the arcade.
      e.aiTimer -= dt
      if (e.aiTimer <= 0) {
        e.aiTimer = 0.55 + Math.random() * 0.9
        const p = this.player
        const rise = (e.y + e.h) - (p.y + p.h)          // + = Bub is higher
        const dx = (p.x + p.w / 2) - (e.x + e.w / 2)
        if (rise > TILE * 3.6 && Math.abs(dx) < TILE * 10 && Math.random() < 0.7) {
          e.vy = -ENEMY_JUMP_V
          e.dir = dx >= 0 ? 1 : -1
          grounded = false
        }
      }
    }

    // mighta hurls a boulder on his own cadence (angrier = more often),
    // flying flat in whichever direction he's stomping.
    if (kind.name === 'mighta' && grounded) {
      e.throwTimer -= dt * (e.angry ? 1 / 0.6 : 1)
      if (e.throwTimer <= 0) {
        e.throwTimer = BOULDER_MIN + Math.random() * BOULDER_RAND
        this.shots.push({
          kind: 'boulder',
          x: e.x + e.w / 2 + e.dir * e.w * 0.7,
          y: e.y + e.h * 0.45,
          vx: e.dir * BOULDER_SPEED, vy: 0, age: 0, spin: 0,
        })
      }
    }

    // roam: at a ledge edge, mostly stride off (work the whole screen); only
    // sometimes turn back. One decision per edge — the latch stops re-rolling
    // every frame while the edge stays underfoot.
    if (grounded) {
      const aheadX = e.dir > 0 ? e.x + e.w + 2 : e.x - 2
      const footRow = Math.floor((e.y + e.h + 2) / TILE)
      if (!this.#platformRow(aheadX, 1, footRow)) {
        if (!e.edgeLatch) {
          e.edgeLatch = true
          if (Math.random() < ENEMY_EDGE_TURN) e.dir = e.dir === 1 ? -1 : 1
        }
      } else e.edgeLatch = false
    } else e.edgeLatch = false

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

  // ── bubbles ──────────────────────────────────────────────

  /** Solid-tile collision for fresh shots and low-drifting elemental bubbles.
   *  Ordinary floating bubbles skip this and follow the upward airflow through
   *  one-way platforms. */
  #bubbleTerrain(b: Bubble): { up: boolean; side: boolean } {
    let up = false, side = false
    const c0 = Math.max(0, Math.floor((b.x - b.r) / TILE))
    const c1 = Math.min(this.cols - 1, Math.floor((b.x + b.r) / TILE))
    const r0 = Math.max(0, Math.floor((b.y - b.r) / TILE))
    const r1 = Math.min(this.rows - 1, Math.floor((b.y + b.r) / TILE))
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (this.grid[r * this.cols + c] !== WALL) continue
        const nx = Math.max(c * TILE, Math.min(b.x, (c + 1) * TILE))
        const ny = Math.max(r * TILE, Math.min(b.y, (r + 1) * TILE))
        const dx = b.x - nx, dy = b.y - ny
        const d2 = dx * dx + dy * dy
        if (d2 >= b.r * b.r) continue
        const d = Math.sqrt(d2)
        if (d < 0.0001) { b.y = (r + 1) * TILE + b.r; up = true; continue }
        const push = b.r - d
        b.x += (dx / d) * push
        b.y += (dy / d) * push
        if (dy > 0.3) up = true
        if (Math.abs(dx) > Math.abs(dy)) side = true
      }
    }
    return { up, side }
  }

  #stepBubbles(dt: number): void {
    if (this.bubbles.length === 0) return
    for (const b of this.bubbles) {
      if (b.popped) continue
      b.age += dt
      b.life -= dt
      if (b.squash > 0) b.squash = Math.max(0, b.squash - dt)

      if (b.cling !== null) {
        // A blister: it rides Super Drunk's hide and ignores buoyancy, terrain
        // and the walls entirely. The jostle pass below shoves neighbours apart;
        // re-deriving the angle from wherever it ended up is what makes a hide
        // full of foam SPREAD into an even ring — and a ring chains end to end.
        const boss = this.boss
        if (boss) {
          b.cling = Math.atan2(b.y - boss.y, b.x - boss.x)
          b.x = boss.x + Math.cos(b.cling) * BOSS_R
          b.y = boss.y + Math.sin(b.cling) * BOSS_R
        }
      } else if (b.phase === 'shoot') {
        // ballistic shot: fast launch, exponential decay — then it floats.
        b.x += b.vx * dt
        b.vx *= Math.exp(-BUBBLE_SHOOT_DRAG * dt)
        const hit = this.#bubbleTerrain(b)
        if (b.x < b.r) { b.x = b.r; b.vx = 0 }
        else if (b.x > this.width - b.r) { b.x = this.width - b.r; b.vx = 0 }
        if (hit.side || Math.abs(b.vx) < BUBBLE_SHOOT_MIN) {
          b.phase = 'float'
          b.vx *= 0.4
          b.vy = 0
        }
      } else if (b.special) {
        // elemental drift: a steady slow crossing — barely buoyant, bouncing
        // off walls and terrain so it stays down in the play space, reachable.
        b.x += b.vx * dt + Math.sin(b.age * 2.0) * BUBBLE_SWAY * 0.5 * dt
        b.y -= SPECIAL_RISE * dt
        const hit = this.#bubbleTerrain(b)
        if (hit.side) b.vx = -b.vx
        if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx) }
        else if (b.x > this.width - b.r) { b.x = this.width - b.r; b.vx = -Math.abs(b.vx) }
        if (b.y < b.r) b.y = b.r
      } else {
        // Buoyancy ramps in: the bubble hangs a beat, then the level's upward
        // airflow carries it through the one-way platforms.
        b.vy = Math.max(-BUBBLE_RISE, b.vy - BUBBLE_RISE * BUBBLE_RISE_RAMP * dt)
        b.vx *= Math.max(0, 1 - 3.5 * dt)
        b.x += b.vx * dt + Math.sin(b.age * 2.4) * BUBBLE_SWAY * dt
        b.y += b.vy * dt
        if (b.x < b.r) { b.x = b.r; b.slide = 1 }
        else if (b.x > this.width - b.r) { b.x = this.width - b.r; b.slide = -1 }
        if (b.y <= b.r) {
          // gathered at the ceiling: drift toward the top-centre cluster point
          b.y = b.r
          b.vy = 0
          const gx = this.width / 2
          if (Math.abs(gx - b.x) > TILE * 0.8) b.x += Math.sign(gx - b.x) * CEIL_GATHER * dt
        }
      }

      // Super Drunk is far too big to bottle up, so foam STICKS to him instead —
      // and unlike trapping a foe this needs no momentum: the bubbles you blow
      // from the floor rise on their own and blister him overhead. Elementals
      // pass him by (they hit him with their element instead, on the pop).
      if (b.cling === null && !b.enemy && !b.special && this.boss && this.boss.state !== 'dying') {
        const boss = this.boss
        const d = Math.hypot(b.x - boss.x, b.y - boss.y)
        if (d < BOSS_R + b.r * 0.5) {
          b.cling = Math.atan2(b.y - boss.y, b.x - boss.x) || 0
          b.phase = 'float'
          b.life = BOSS_CLING_LIFE
          b.vx = 0
          b.vy = 0
          this.#spawnPop(b.x, b.y, 150, 4, 300)
        }
      }

      // Trap a foe ONLY while the shot still has momentum — floated foam is
      // harmless (you aim shots at foes; you don't lay mines). Elementals
      // never trap; they carry an element instead.
      if (b.cling === null && !b.enemy && !b.special && (b.phase === 'shoot' || b.age < 0.55)) {
        for (const e of this.enemies) {
          if (!e.alive || e.captured) continue
          const ecx = e.x + e.w / 2, ecy = e.y + e.h / 2
          if (Math.hypot(ecx - b.x, ecy - b.y) < b.r + e.w * 0.32) {
            e.captured = true
            b.enemy = e
            b.phase = 'float'
            b.life = BUBBLE_TRAP_LIFE
            b.vx *= 0.3
            b.vy = 0
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
          this.#spawnRing(b.x, b.y, b.r * 2.4, 0)
        } else {
          this.#spawnPop(b.x, b.y, 160, 5)
          this.#spawnRing(b.x, b.y, b.r * 2, 195)
        }
        b.popped = true
      }
    }
    this.bubbles = this.bubbles.filter(b => !b.popped)

    // jostle: soft pairwise separation, so gathered bubbles cluster shoulder to
    // shoulder under the ceiling instead of stacking into one point.
    for (let i = 0; i < this.bubbles.length; i++) {
      const a = this.bubbles[i]
      for (let j = i + 1; j < this.bubbles.length; j++) {
        const c = this.bubbles[j]
        const dx = c.x - a.x, dy = c.y - a.y
        const min = (a.r + c.r) * 0.94
        const d2 = dx * dx + dy * dy
        if (d2 >= min * min || d2 === 0) continue
        const d = Math.sqrt(d2)
        const push = (min - d) / 2
        const ux = dx / d, uy = dy / d
        a.x -= ux * push; a.y -= uy * push
        c.x += ux * push; c.y += uy * push
      }
    }
  }

  /** Pop a bubble and CASCADE through every touching bubble — one cluster, one
   *  burst. Every trapped foe defeated in the cascade grows the same chain, so
   *  a gathered cluster is the big-score play, exactly like the arcade. */
  #popCascade(root: Bubble): void {
    if (root.popped) return
    root.popped = true
    const queue: Bubble[] = [root]
    while (queue.length > 0) {
      const b = queue.shift()!
      for (const o of this.bubbles) {
        if (o.popped) continue
        const link = (b.r + o.r) * POP_LINK
        if ((o.x - b.x) ** 2 + (o.y - b.y) ** 2 < link * link) {
          o.popped = true
          queue.push(o)
        }
      }
      if (b.cling !== null) {
        // a blister bursting on Super Drunk's hide — the one thing that hurts
        // him, and it CASCADES, so a ringed hide goes off in a single chain
        this.#hurtBoss(BOSS_POP_DMG, b.x, b.y)
        this.#spawnRing(b.x, b.y, b.r * 3, 300)
      } else if (b.enemy) {
        this.#defeatEnemy(b.enemy, b.x, b.y)
        this.#spawnRing(b.x, b.y, b.r * 3.2, 45)
      } else if (b.special === 'water') {
        this.#burstWater(b.x, b.y)
        this.#spawnPop(b.x, b.y, 220, 8, 205)
        this.#spawnRing(b.x, b.y, b.r * 2.8, 205)
      } else if (b.special === 'lightning') {
        this.#burstBolt(b.x, b.y)
        this.#spawnPop(b.x, b.y, 220, 8, 55)
        this.#spawnRing(b.x, b.y, b.r * 2.8, 55)
      } else {
        this.#spawnPop(b.x, b.y, 180, 6)
        this.#spawnRing(b.x, b.y, b.r * 2.2, 195)
      }
    }
    this.bubbles = this.bubbles.filter(x => !x.popped)
  }

  /** Defeat a foe and pay out the running chain: score, particles, food, the
   *  occasional sweet. Shared by bubble pops, water sweeps and bolt strikes so
   *  every kill route feeds the SAME combo. */
  #defeatEnemy(e: Enemy, x: number, y: number): void {
    e.alive = false
    e.captured = false
    this.chain += 1
    this.#chainTimer = COMBO_WINDOW
    this.#addScore(POP_BASE * this.chain)
    this.#spawnPop(x, y, 320, 14)
    this.#spawnFruit(x, y, (Math.max(0, Math.min(this.chain - 1, 3))) as FruitKind, this.chain)
    if (Math.random() < CANDY_DROP_CHANCE) this.#spawnCandy(x, y)
    // …and rarely an umbrella. The cascade that earned the kill picks its
    // colour, so the bigger the chain, the further the skip.
    if (Math.random() < UMBRELLA_DROP_CHANCE) {
      this.#spawnUmbrella(x, y, this.chain >= 5 ? 'pink' : this.chain >= 3 ? 'red' : 'blue')
    }
  }

  // ── treasure + warp items ────────────────────────────────

  /** Diamonds never move — they just wait to be walked into. */
  #stepDiamonds(): void {
    if (this.diamonds.length === 0) return
    const p = this.player
    for (const d of this.diamonds) {
      if (d.taken) continue
      if (p.x < d.x + d.w && p.x + p.w > d.x && p.y < d.y + d.h && p.y + p.h > d.y) {
        d.taken = true
        this.#addScore(DIAMOND_SCORE)
        const cx = d.x + d.w / 2, cy = d.y + d.h / 2
        this.#spawnPop(cx, cy, 230, 9, 190)
        this.#spawnRing(cx, cy, TILE * 2.4, 190)
      }
    }
    this.diamonds = this.diamonds.filter(d => !d.taken)
  }

  #spawnUmbrella(x: number, y: number, kind: UmbrellaKind): void {
    const dir = Math.random() < 0.5 ? -1 : 1
    this.umbrellas.push({
      x: x - TILE * 0.7, y: y - TILE * 0.7, w: TILE * 1.4, h: TILE * 1.4,
      vx: dir * (40 + Math.random() * 60), vy: -190,
      kind, life: UMBRELLA_LIFE, taken: false, rest: false, bob: x,
    })
  }

  /** Umbrellas arc and rest like sweets — but grabbing one sets `warp` and ENDS
   *  the round on the spot, foes still standing or not. That's the arcade. */
  #stepUmbrellas(dt: number): void {
    if (this.umbrellas.length === 0) return
    const p = this.player
    for (const u of this.umbrellas) {
      if (u.taken) continue
      if (!u.rest) {
        u.x += u.vx * dt
        if (u.x < 0) { u.x = 0; u.vx = Math.abs(u.vx) }
        else if (u.x + u.w > this.width) { u.x = this.width - u.w; u.vx = -Math.abs(u.vx) }
        u.vy = Math.min(u.vy + GRAVITY * dt, MAX_FALL)
        if (u.vy < 0) u.y += u.vy * dt
        else {
          const fall = u.vy
          const floor = u.y + u.h + u.vy * dt >= this.height
          if (this.#descend(u, u.vy * dt) || floor) {
            if (floor) u.y = this.height - u.h
            if (fall > 150) { u.vy = -fall * FRUIT_BOUNCE; u.vx *= 0.7 }
            else { u.vy = 0; u.vx = 0; u.rest = true }
          }
        }
        if (u.y < 0) { u.y = 0; u.vy = Math.abs(u.vy) }
      }
      if (this.state !== 'cleanup') { u.life -= dt; if (u.life <= 0) { u.taken = true; continue } }
      // it has to clear the pop it came from before it can be picked up
      if (u.life > UMBRELLA_LIFE - UMBRELLA_ARM) continue
      if (p.x < u.x + u.w && p.x + p.w > u.x && p.y < u.y + u.h && p.y + p.h > u.y) {
        u.taken = true
        const meta = UMBRELLA_META[u.kind]
        this.#addScore(UMBRELLA_SCORE)
        this.warp = meta.skip
        this.state = 'won'
        this.#spawnPop(u.x + u.w / 2, u.y + u.h / 2, 300, 16, meta.hue)
        this.#spawnRing(u.x + u.w / 2, u.y + u.h / 2, TILE * 5, meta.hue)
      }
    }
    this.umbrellas = this.umbrellas.filter(u => !u.taken)
  }

  // ── elements (water + lightning) and boulders ────────────

  /** A popped water bubble bursts into droplets that splash out, fall, and
   *  then flow along the platforms, drowning free foes on contact. */
  #burstWater(x: number, y: number): void {
    for (let i = 0; i < WATER_COUNT; i++) {
      const spread = (i / (WATER_COUNT - 1)) * 2 - 1        // -1 .. 1
      this.waters.push({
        x: x + spread * 6, y, w: 6, h: 6,
        vx: spread * (30 + Math.random() * 60),
        vy: -80 - Math.random() * 90,
        flowing: false, life: WATER_LIFE,
      })
    }
  }

  /** A popped lightning bubble fires its bolt OPPOSITE Bub's facing — the
   *  arcade's famous quirk. It flies flat through everything. */
  #burstBolt(x: number, y: number): void {
    this.shots.push({ kind: 'bolt', x, y, vx: -this.player.facing * BOLT_SPEED, vy: 0, age: 0, spin: 0 })
  }

  #stepWaters(dt: number): void {
    if (this.waters.length === 0) return
    for (const d of this.waters) {
      d.life -= dt
      if (d.life <= 0) continue
      if (d.flowing) {
        d.x += d.vx * dt
        // dried up at a side wall; dripped off at a platform edge
        if (d.x < 0 || d.x + d.w > this.width) { d.life = 0; continue }
        const footRow = Math.floor((d.y + d.h + 2) / TILE)
        const onFloor = d.y + d.h >= this.height - 1
        if (!onFloor && !this.#platformRow(d.x, d.w, footRow)) { d.flowing = false; d.vy = 0 }
      } else {
        d.x += d.vx * dt
        if (d.x < 0) { d.x = 0; d.vx = Math.abs(d.vx) }
        else if (d.x + d.w > this.width) { d.x = this.width - d.w; d.vx = -Math.abs(d.vx) }
        d.vy = Math.min(d.vy + GRAVITY * dt, MAX_FALL)
        if (d.vy < 0) d.y += d.vy * dt
        else {
          const floor = d.y + d.h + d.vy * dt >= this.height
          if (this.#descend(d, d.vy * dt) || floor) {
            if (floor) d.y = this.height - d.h
            d.flowing = true
            d.vx = (d.vx === 0 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(d.vx)) * WATER_FLOW
            d.vy = 0
          }
        }
      }
      // the sweep: any free foe the water touches is carried off
      for (const e of this.enemies) {
        if (!e.alive || e.captured) continue
        const cx = Math.max(e.x, Math.min(d.x + d.w / 2, e.x + e.w))
        const cy = Math.max(e.y, Math.min(d.y + d.h / 2, e.y + e.h))
        if ((d.x + d.w / 2 - cx) ** 2 + (d.y + d.h / 2 - cy) ** 2 < 16) {
          this.#defeatEnemy(e, e.x + e.w / 2, e.y + e.h / 2)
          this.#spawnRing(e.x + e.w / 2, e.y + e.h / 2, TILE * 3.2, 205)
        }
      }
    }
    this.waters = this.waters.filter(d => d.life > 0)
  }

  #stepShots(dt: number): void {
    if (this.shots.length === 0) return
    // Bottles that met a surface this frame — shattered AFTER the walk so the
    // shards they throw aren't stepped by the same loop that made them.
    const shattered: Shot[] = []
    for (const s of this.shots) {
      s.age += dt
      s.x += s.vx * dt
      if (s.kind === 'bolt') {
        // kills every free foe along its path…
        for (const e of this.enemies) {
          if (!e.alive || e.captured) continue
          const cx = Math.max(e.x, Math.min(s.x, e.x + e.w))
          const cy = Math.max(e.y, Math.min(s.y, e.y + e.h))
          if ((s.x - cx) ** 2 + (s.y - cy) ** 2 < BOLT_R * BOLT_R) {
            this.#defeatEnemy(e, e.x + e.w / 2, e.y + e.h / 2)
            this.#spawnRing(e.x + e.w / 2, e.y + e.h / 2, TILE * 3.2, 55)
          }
        }
        // …and a bolt run through Super Drunk stings him properly. Popping an
        // elemental at his height is a real play, not a consolation prize.
        const boss = this.boss
        if (boss && boss.state !== 'dying' && s.age < 9
          && Math.hypot(s.x - boss.x, s.y - boss.y) < BOSS_R + BOLT_R) {
          this.#hurtBoss(BOSS_ELEMENT_DMG, s.x, boss.y)
          this.#spawnRing(boss.x, boss.y, BOSS_R * 2.2, 55)
          s.age = 99   // spent — one boss hit per bolt
        }
        continue
      }

      if (s.kind === 'bottle') {
        // arcing glass: it falls, tumbling, and breaks on the first surface it
        // meets — the platform tops included, so the ledges rain glass too.
        s.vy += BOTTLE_GRAV * dt
        s.spin += dt * (5 + Math.abs(s.vx) * 0.02)
        if (s.vy <= 0) {
          s.y += s.vy * dt
        } else {
          // reuse the one-way landing walk so a bottle breaks exactly where a
          // body would stand
          const probe = { x: s.x - BOTTLE_R, y: s.y - BOTTLE_R, w: BOTTLE_R * 2, h: BOTTLE_R * 2, vx: 0, vy: s.vy }
          const landed = this.#descend(probe, s.vy * dt)
          s.y = probe.y + BOTTLE_R
          if (landed) shattered.push(s)
        }
        if (s.y + BOTTLE_R >= this.height) {
          s.y = this.height - BOTTLE_R
          if (!shattered.includes(s)) shattered.push(s)
        }
      }

      // boulder / bottle / shard — all deadly to Bub alone.
      if (this.state === 'playing' && this.dying === 0 && this.invuln <= 0) {
        const r = s.kind === 'boulder' ? BOULDER_R : s.kind === 'bottle' ? BOTTLE_R : SHARD_R
        const p = this.player
        const cx = Math.max(p.x, Math.min(s.x, p.x + p.w))
        const cy = Math.max(p.y, Math.min(s.y, p.y + p.h))
        if ((s.x - cx) ** 2 + (s.y - cy) ** 2 < r * r) this.#die()
      }
    }

    for (const s of shattered) {
      this.#spawnPop(s.x, s.y, 210, 7, 40)
      for (const dir of [-1, 1] as const) {
        this.shots.push({ kind: 'shard', x: s.x, y: s.y, vx: dir * SHARD_SPEED, vy: 0, age: 0, spin: 0 })
      }
    }

    this.shots = this.shots.filter(s =>
      !shattered.includes(s)
      && s.x > -TILE * 2 && s.x < this.width + TILE * 2
      && s.y < this.height + TILE * 2
      && !(s.kind === 'shard' && s.age > SHARD_LIFE)
      && !(s.kind === 'bolt' && s.age > 90))
  }

  /** Drop a food item — it ARCS away from the pop, bounces, then rests. `mult`
   *  is the chain length at the pop: chained pops drop multiplied food. */
  #spawnFruit(x: number, y: number, kind: FruitKind, mult: number): void {
    const dir = Math.random() < 0.5 ? -1 : 1
    this.fruits.push({
      x: x - TILE * 0.6, y: y - TILE * 0.6, w: TILE * 1.2, h: TILE * 1.2,
      vx: dir * (70 + Math.random() * 110), vy: -260,
      kind, mult, life: FRUIT_LIFE, taken: false, rest: false,
    })
  }

  /** Food arcs, bounces off walls + platforms with damping, rests, and is
   *  collected on contact for points. During play it expires on its own life;
   *  during the post-clear sweep its life is frozen so loot can't vanish. */
  #stepFruit(dt: number): void {
    const p = this.player
    const cleaning = this.state === 'cleanup'
    for (const f of this.fruits) {
      if (f.taken) continue
      if (!f.rest) {
        f.x += f.vx * dt
        if (f.x < 0) { f.x = 0; f.vx = Math.abs(f.vx) }
        else if (f.x + f.w > this.width) { f.x = this.width - f.w; f.vx = -Math.abs(f.vx) }
        f.vy = Math.min(f.vy + GRAVITY * dt, MAX_FALL)
        if (f.vy < 0) f.y += f.vy * dt
        else {
          const fall = f.vy
          const floor = f.y + f.h + f.vy * dt >= this.height
          if (this.#descend(f, f.vy * dt) || floor) {
            if (floor) f.y = this.height - f.h
            if (fall > 150) { f.vy = -fall * FRUIT_BOUNCE; f.vx *= 0.7 }
            else { f.vy = 0; f.vx = 0; f.rest = true }
          }
        }
        if (f.y < 0) { f.y = 0; f.vy = Math.abs(f.vy) }
      }
      if (!cleaning) { f.life -= dt; if (f.life <= 0) { f.taken = true; continue } }
      if (p.x < f.x + f.w && p.x + p.w > f.x && p.y < f.y + f.h && p.y + p.h > f.y) {
        f.taken = true
        const value = FRUIT_SCORE[f.kind] * f.mult
        this.#addScore(value)
        const fcx = f.x + f.w / 2, fcy = f.y + f.h / 2
        this.#spawnPop(fcx, fcy, 220, 8, 48)
        // chained food is worth a multiple — show the boosted value rising off it.
        if (f.mult > 1) this.#spawnFloat(fcx, fcy - TILE * 0.6, '+' + value, '#ffd76a')
      }
    }
    this.fruits = this.fruits.filter(f => !f.taken)
  }

  // ── power-up sweets ──────────────────────────────────────

  #spawnCandy(x: number, y: number): void {
    const kind = POWER_ORDER[Math.floor(Math.random() * POWER_ORDER.length)]
    const dir = Math.random() < 0.5 ? -1 : 1
    this.candies.push({
      x: x - TILE * 0.64, y: y - TILE * 0.64, w: TILE * 1.28, h: TILE * 1.28,
      vx: dir * (40 + Math.random() * 70), vy: -180,
      kind, life: CANDY_LIFE, taken: false, rest: false, bob: x,
    })
  }

  /** Sweets arc + bounce like food; pickup switches on a power instead of just
   *  scoring. */
  #stepCandies(dt: number): void {
    if (this.candies.length === 0) return
    const p = this.player
    for (const c of this.candies) {
      if (c.taken) continue
      if (!c.rest) {
        c.x += c.vx * dt
        if (c.x < 0) { c.x = 0; c.vx = Math.abs(c.vx) }
        else if (c.x + c.w > this.width) { c.x = this.width - c.w; c.vx = -Math.abs(c.vx) }
        c.vy = Math.min(c.vy + GRAVITY * dt, MAX_FALL)
        if (c.vy < 0) c.y += c.vy * dt
        else {
          const fall = c.vy
          const floor = c.y + c.h + c.vy * dt >= this.height
          if (this.#descend(c, c.vy * dt) || floor) {
            if (floor) c.y = this.height - c.h
            if (fall > 150) { c.vy = -fall * FRUIT_BOUNCE; c.vx *= 0.7 }
            else { c.vy = 0; c.vx = 0; c.rest = true }
          }
        }
        if (c.y < 0) { c.y = 0; c.vy = Math.abs(c.vy) }
      }
      if (this.state !== 'cleanup') { c.life -= dt; if (c.life <= 0) { c.taken = true; continue } }
      if (p.x < c.x + c.w && p.x + p.w > c.x && p.y < c.y + c.h && p.y + p.h > c.y) {
        c.taken = true
        this.#applyPower(c.kind)
        this.#addScore(CANDY_SCORE)
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

  /** Start the death tumble: Bub spins skyward and falls away; the Baron
   *  withdraws. update() resolves the life when the timer runs out. */
  #die(): void {
    if (this.dying > 0) return
    this.lives = Math.max(0, this.lives - 1)
    this.dying = DEATH_TIME
    this.hurtFlash = 0.5
    this.baron = null
    this.player.vy = -360
    this.input.left = this.input.right = this.input.jump = false
    this.#spawnPop(this.player.x + this.player.w / 2, this.player.y + this.player.h / 2, 260, 16, 20)
  }

  // ── Baron von Blubba ─────────────────────────────────────

  /** Curved pursuit, faster the longer he's out; terrain means nothing to him. */
  #stepBaron(dt: number): void {
    const b = this.baron
    if (!b) return
    b.age += dt
    const cap = Math.min(BARON_MAX, BARON_SPEED + b.age * BARON_RAMP)
    const px = this.player.x + this.player.w / 2
    const py = this.player.y + this.player.h / 2
    const dx = px - b.x, dy = py - b.y
    const d = Math.hypot(dx, dy) || 1
    b.vx += (dx / d) * BARON_STEER * dt
    b.vy += (dy / d) * BARON_STEER * dt
    const sp = Math.hypot(b.vx, b.vy) || 1
    if (sp > cap) { b.vx = (b.vx / sp) * cap; b.vy = (b.vy / sp) * cap }
    b.x += b.vx * dt
    b.y += b.vy * dt
    // he ignores walls entirely but never drifts far off the screen
    b.x = Math.max(-TILE * 2, Math.min(this.width + TILE * 2, b.x))
    b.y = Math.max(-TILE * 2, Math.min(this.height + TILE * 2, b.y))
  }

  #baronContact(): void {
    const b = this.baron
    if (!b || this.invuln > 0) return
    const p = this.player
    const cx = Math.max(p.x, Math.min(b.x, p.x + p.w))
    const cy = Math.max(p.y, Math.min(b.y, p.y + p.h))
    if ((b.x - cx) ** 2 + (b.y - cy) ** 2 < BARON_R * BARON_R) this.#die()
  }

  // ── Super Drunk ──────────────────────────────────────────

  /** Which of the three escalations he's in, read off his health. 0 lazy,
   *  1 angry (two-bottle volleys), 2 RAGE (volleys + floor slams). */
  get bossPhase(): 0 | 1 | 2 {
    const b = this.boss
    if (!b) return 0
    const f = b.hp / b.maxHp
    return f > 0.66 ? 0 : f > 0.33 ? 1 : 2
  }

  /** Hover, drift, and run the attack machine. He is terrain-blind (a bulk that
   *  size doesn't stand on ledges) but stays inside the box and out of the floor. */
  #stepBoss(dt: number): void {
    const b = this.boss
    if (!b) return
    b.age += dt
    b.bob += dt * 2.2
    if (b.hurt > 0) b.hurt = Math.max(0, b.hurt - dt)
    if (b.squash !== 0) b.squash *= Math.max(0, 1 - 6 * dt)
    b.stateT += dt

    // The death throes: he sags, bursts, and rains his hoard (update() resolves).
    if (b.state === 'dying') {
      b.y += 26 * dt
      if (Math.random() < 0.5) {
        this.#spawnPop(b.x + (Math.random() - 0.5) * BOSS_R * 1.6,
                       b.y + (Math.random() - 0.5) * BOSS_R * 1.6, 260, 5, 300)
      }
      return
    }

    const phase = this.bossPhase
    const px = this.player.x + this.player.w / 2

    // ── hover: cruise, loosely stalking Bub's column, bouncing off the walls
    if (b.state !== 'slam' && b.state !== 'rise' && b.state !== 'recover') {
      const cruise = phase === 2 ? BOSS_DRIFT_RAGE : BOSS_DRIFT
      b.vx += Math.sign(px - b.x) * BOSS_TRACK * dt
      if (Math.abs(b.vx) > cruise) b.vx = Math.sign(b.vx) * cruise
      b.x += b.vx * dt
      if (b.x < BOSS_R) { b.x = BOSS_R; b.vx = Math.abs(b.vx) }
      else if (b.x > this.width - BOSS_R) { b.x = this.width - BOSS_R; b.vx = -Math.abs(b.vx) }
      // he holds the upper air, bobbing on his own weight
      const rest = BOSS_TOP + BOSS_R + Math.sin(b.bob) * BOSS_BOB
      b.y += (rest - b.y) * Math.min(1, 2.4 * dt)
      b.face = px < b.x ? -1 : 1
    }

    switch (b.state) {
      case 'idle': {
        // (the gap itself is set on the way OUT of a volley — see 'throw')
        b.throwTimer -= dt
        if (b.throwTimer <= 0) {
          b.volley = phase === 0 ? 1 : 2
          b.state = 'windup'
          b.stateT = 0
          b.telegraph = 0
        }
        // rage: the floor slam runs on its own clock, on top of the bottles
        if (phase === 2) {
          b.slamTimer -= dt
          if (b.slamTimer <= 0 && b.state === 'idle') {
            b.slamTimer = BOSS_SLAM_EVERY
            b.state = 'rise'
            b.stateT = 0
            b.telegraph = 0
          }
        }
        break
      }
      case 'windup': {
        // bottle raised, glinting — the whole tell
        b.telegraph = Math.min(1, b.stateT / BOSS_WINDUP)
        if (b.stateT >= BOSS_WINDUP) { b.state = 'throw'; b.stateT = 0 }
        break
      }
      case 'throw': {
        this.#throwBottle()
        b.volley -= 1
        b.telegraph = 0
        if (b.volley > 0) {
          // the rest of the volley follows on a short beat (no fresh windup)
          b.state = 'windup'
          b.stateT = BOSS_WINDUP - BOSS_THROW_GAP
        } else {
          b.state = 'idle'
          b.stateT = 0
          const squeeze = 1 - 0.45 * Math.min(1, b.age / BOSS_SQUEEZE)
          const rate = phase === 0 ? 1 : phase === 1 ? 0.75 : 0.55
          b.throwTimer = (BOSS_THROW_MIN + Math.random() * BOSS_THROW_RAND) * rate * squeeze
        }
        break
      }
      case 'rise': {
        // hauling himself up — the slam's telegraph
        b.telegraph = Math.min(1, b.stateT / BOSS_RISE_TIME)
        b.y -= 90 * dt
        if (b.y < BOSS_R * 0.7) b.y = BOSS_R * 0.7
        if (b.stateT >= BOSS_RISE_TIME) { b.state = 'slam'; b.stateT = 0; b.vy = BOSS_SLAM_V; b.telegraph = 1 }
        break
      }
      case 'slam': {
        b.y += b.vy * dt
        const rest = this.height - BOSS_FLOOR_GAP - BOSS_R * 0.2
        if (b.y >= rest) {
          b.y = rest
          b.vy = 0
          b.squash = 1
          b.state = 'recover'
          b.stateT = 0
          b.telegraph = 0
          this.#slamShock()
        }
        break
      }
      case 'recover': {
        // winded and low: the window to blister him at your own height
        b.squash = Math.max(-0.35, b.squash - dt * 1.4)
        if (b.stateT >= BOSS_RECOVER) { b.state = 'idle'; b.stateT = 0; b.vy = 0 }
        break
      }
    }
  }

  /** Lob a bottle at where Bub is STANDING — a real ballistic solve for a fixed
   *  flight time, so it lands on the spot he occupied a beat ago. Every throw is
   *  therefore dodgeable by simply moving, which is the whole game of it. */
  #throwBottle(): void {
    const b = this.boss
    if (!b) return
    const p = this.player
    const tx = p.x + p.w / 2
    const ty = p.y + p.h
    const ox = b.x + b.face * BOSS_R * 0.55
    const oy = b.y - BOSS_R * 0.25
    const T = BOTTLE_FLIGHT
    let vx = (tx - ox) / T
    if (Math.abs(vx) > BOTTLE_VX_CAP) vx = Math.sign(vx) * BOTTLE_VX_CAP
    const vy = (ty - oy - 0.5 * BOTTLE_GRAV * T * T) / T
    this.shots.push({ kind: 'bottle', x: ox, y: oy, vx, vy, age: 0, spin: 0 })
    this.#spawnPop(ox, oy, 90, 3, 40)
  }

  /** The floor slam's shockwave: glass and grit skidding away both ways. */
  #slamShock(): void {
    const b = this.boss
    if (!b) return
    const y = this.height - TILE * 0.6
    for (const dir of [-1, 1] as const) {
      this.shots.push({ kind: 'shard', x: b.x + dir * BOSS_R * 0.5, y, vx: dir * SHARD_SPEED * 1.15, vy: 0, age: 0, spin: 0 })
    }
    this.#spawnPop(b.x, y, 320, 18, 40)
    this.#spawnRing(b.x, y, TILE * 6, 40)
    this.hurtFlash = 0.18
  }

  /** Take `n` off Super Drunk. Every damage route (a popped blister, a bolt, a
   *  water sweep) funnels through here so the flash, the score and the death
   *  beat are identical whichever way you got him. */
  #hurtBoss(n: number, x: number, y: number): void {
    const b = this.boss
    if (!b || b.state === 'dying') return
    b.hp = Math.max(0, b.hp - n)
    b.hurt = BOSS_HURT_FLASH
    this.#spawnPop(x, y, 300, 8, 300)
    if (b.hp > 0) return
    // down he goes — the throes run, then update() rains the hoard.
    b.state = 'dying'
    b.stateT = 0
    b.telegraph = 0
    b.volley = 0
    this.shots = this.shots.filter(s => s.kind === 'bolt')
    // every blister still on his hide bursts with him
    for (const bub of this.bubbles) if (bub.cling !== null) bub.popped = true
    this.bubbles = this.bubbles.filter(bub => !bub.popped)
    this.#addScore(BOSS_SCORE)
    this.#spawnFloat(b.x, b.y - BOSS_R, `+${BOSS_SCORE}`, '#ffe27a')
  }

  /** He bursts into his hoard: a rain of food + treasure over the whole floor,
   *  and a long sweep window to go and get it. */
  #bossLoot(): void {
    const b = this.boss
    if (!b) return
    for (let i = 0; i < BOSS_LOOT; i++) {
      const x = TILE * 3 + Math.random() * (this.width - TILE * 6)
      const y = b.y + (Math.random() - 0.5) * BOSS_R
      this.#spawnFruit(x, y, (i % 4) as FruitKind, 1 + (i % 4))
    }
    this.#spawnPop(b.x, b.y, 420, 34, 300)
    this.#spawnRing(b.x, b.y, BOSS_R * 6, 300)
    this.hurtFlash = 0.3
  }

  /** His belly kills; the blisters on his hide ride further out and don't. */
  #bossContact(): void {
    const b = this.boss
    if (!b || b.state === 'dying' || this.invuln > 0) return
    const p = this.player
    const cx = Math.max(p.x, Math.min(b.x, p.x + p.w))
    const cy = Math.max(p.y, Math.min(b.y, p.y + p.h))
    if ((b.x - cx) ** 2 + (b.y - cy) ** 2 < BOSS_CORE_R * BOSS_CORE_R) this.#die()
  }

  // ── extra lives ──────────────────────────────────────────

  /** All in-play scoring funnels through here so a threshold crossing awards
   *  its 1UP THE MOMENT it happens — even when that same pop wins the level
   *  and the state flips before the next frame. */
  #addScore(n: number): void {
    const before = this.score
    this.score += n
    for (const t of LIFE_AWARDS) {
      if (before < t && this.score >= t) this.#award1up()
    }
  }

  #award1up(): void {
    if (this.lives >= LIVES_CAP) return
    this.lives += 1
    const p = this.player
    this.#spawnFloat(p.x + p.w / 2, p.y - TILE * 0.8, '1UP!', '#6fe06a')
    this.#spawnRing(p.x + p.w / 2, p.y + p.h / 2, TILE * 4.4, 130)
  }

  /** Carry a running total in from a cleared screen. `prevFinal` is the score
   *  the cleared engine ended on — a clear BONUS can cross an extra-life
   *  threshold between screens, and that award must not be lost (nor re-fired
   *  for thresholds already crossed during play). */
  seedScore(score: number, prevFinal: number): void {
    this.score = score
    for (const t of LIFE_AWARDS) {
      if (prevFinal < t && score >= t) this.#award1up()
    }
  }

  // ── particles (pop sparkles) + rings ─────────────────────

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

  #spawnRing(x: number, y: number, max: number, hue: number): void {
    this.rings.push({ x, y, r: 5, max, life: 0.32, hue })
  }

  #stepRings(dt: number): void {
    if (this.rings.length === 0) return
    for (const r of this.rings) {
      r.life -= dt
      r.r += (r.max - r.r) * Math.min(1, 11 * dt)
    }
    this.rings = this.rings.filter(r => r.life > 0)
  }
}
