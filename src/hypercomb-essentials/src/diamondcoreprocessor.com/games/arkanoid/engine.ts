// diamondcoreprocessor.com/games/arkanoid/engine.ts
//
// Pure game state + physics for the Arkanoid / Breakout game. No DOM, no
// canvas — the overlay owns those and calls update(dt) each frame, then the
// renderer draws this state. Everything works in fixed WORLD units (W×H); the
// overlay scales the world to fit the screen (DPR-aware), same split as the
// bubble/solomon engines.
//
// Bricks drop power-up "pills" the paddle can catch:
//   O oscillate — THE AMP. Balls weave on a sine path, and every stack multiplies
//                 the effect of every OTHER power-up you pick up: 1 O DOUBLES them,
//                 2 TRIPLES, 3 QUADRUPLES (the ladder stops at quadruple). See the
//                 `amp` getter — it is the single knob, read at every grant site, so
//                 an amped E is wider AND longer, an amped G loads 4× the shots, an
//                 amped ↑ carries 4 missiles with a 4× blast, an amped 1UP is a
//                 4-UP into a 4× life ceiling, and so on. PERMANENT
//                 for the round (no timeout): each O also doubles the weave width and
//                 nudges ball speed up a notch. Stacks until you die / clear the
//                 level. A coloured weave halo signals the stack state (cool teal →
//                 hot magenta); harder difficulties weave more AGGRESSIVELY (wider,
//                 faster) — peaking at Gangster.
//                 Amp is read at PICKUP time for one-shot/timed grants (so a pill you
//                 already hold is never retro-buffed) and LIVE for continuous forces
//                 (magnet pull, regen rate, the score booster).
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
//   P pinball   — timed flipper mode: two field bumpers bounce balls around and
//                 the white ball doubles in SIZE but does only a quarter damage.
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
export type PowerKind = 'oscillate' | 'break' | 'laser' | 'expand' | 'gun' | 'magnet' | 'rocket' | 'multiplier' | 'burst' | 'pinball' | 'beam' | 'clock' | 'ballchain' | 'extralife' | 'crane' | 'pierce' | 'heal' | 'shield' | 'regen' | 'scramble'

export interface Brick {
  x: number; y: number; w: number; h: number; hp: number; max: number; alive: boolean
  col?: number; row?: number             // grid cell (footprint math)
  seed?: boolean; bloom?: number          // a sparkling seed; blooms into a mega when bloom <= 0
  mega?: boolean                          // a big multi-cell brick (breaks into shards)
  megaCols?: number; megaRows?: number    // a mega's footprint size, in cells
  covered?: boolean                       // silently consumed under a mega (not a player kill — skip death FX)
  drop?: PowerKind                        // forced power-up drop when destroyed (e.g. a multiplier shard)
  turret?: boolean                        // pinball: a tile a bumper hit lit up; fires at the player
  mult?: number                           // a points-multiplier tile (×1/×2/×3, or the hidden rare ×5)
  hidden?: boolean                        // a mult tile that looks like a normal brick until broken (the rare ×5)
  gold?: boolean                          // the LAST brick standing — the level's finale beacon (set by #markFinalBrick, purely a marker)
}
export interface Ball { x: number; y: number; vx: number; vy: number; r: number; stuck: boolean; wobble: number; primary: boolean; color: string; pierced?: Set<Brick> }
export interface Capsule { x: number; y: number; kind: PowerKind; delay?: number; dir?: number }   // delay = hover seconds before it starts falling
/** A Street-Fighter-style fireball launched by the charge cannon. Stats are
 *  snapshotted at launch so a later level-up never retro-buffs an orb in flight. */
export interface Fireball {
  x: number; y: number; vy: number
  tier: 1 | 2 | 3
  dmg: number; aoe: number; pierce: number; r: number; tail: number
  spin: number; hit: Set<Brick | Enemy>; t: number
}

/** A difficulty mode — easy (Rookie) at index 0, hardest (Gangster) at 4. Each is a
 *  set of multipliers/offsets the engine reads at its tuning sites; Rookie = current. */
export interface DifficultyProfile {
  name: string; tagline: string; lives: number; ballSpeedMul: number; enemyCapBonus: number
  enemyFireMul: number; enemyRefillMul: number; turretDmgMul: number; hazardCooldownMul: number
  oscAggroMul: number   // oscillate aggression: scales weave width, weave frequency AND the per-stack speed bump (1 = base, Gangster = wildest)
  supportMul: number    // defensive-drop flood: scales heal/shield/regen weights (1 = base, Gangster = drowning in support)
  mayhemMul: number     // action intensity: quickens the pill waves (1 = base cadence, Gangster = relentless)
}
export const DIFFICULTY: readonly DifficultyProfile[] = [
  { name: 'Rookie',   tagline: 'Fresh off the block — the streets are still smiling at you.',                  lives: 3, ballSpeedMul: 1,    enemyCapBonus: 0, enemyFireMul: 1,    enemyRefillMul: 1,    turretDmgMul: 1,    hazardCooldownMul: 1,    oscAggroMul: 1,    supportMul: 1,   mayhemMul: 1   },
  { name: 'Hustler',  tagline: "You've got a corner now — and the corner's got eyes on you.",                  lives: 3, ballSpeedMul: 1.08, enemyCapBonus: 0, enemyFireMul: 0.9,  enemyRefillMul: 0.85, turretDmgMul: 1.15, hazardCooldownMul: 0.88, oscAggroMul: 1.15, supportMul: 1.3, mayhemMul: 1.2 },
  { name: 'Made',     tagline: "You got your button — respect's real now, and so are the targets on your back.", lives: 3, ballSpeedMul: 1.16, enemyCapBonus: 1, enemyFireMul: 0.8,  enemyRefillMul: 0.72, turretDmgMul: 1.3,  hazardCooldownMul: 0.78, oscAggroMul: 1.3,  supportMul: 1.7, mayhemMul: 1.4 },
  { name: 'Kingpin',  tagline: 'Half the city runs on your say-so — the other half wants you in the river.',   lives: 2, ballSpeedMul: 1.24, enemyCapBonus: 2, enemyFireMul: 0.68, enemyRefillMul: 0.6,  turretDmgMul: 1.45, hazardCooldownMul: 0.68, oscAggroMul: 1.5,  supportMul: 2.2, mayhemMul: 1.7 },
  { name: 'Gangster', tagline: "No rank above you, no mercy below — everybody's gunning for the throne.",       lives: 1, ballSpeedMul: 1.32, enemyCapBonus: 2, enemyFireMul: 0.58, enemyRefillMul: 0.5,  turretDmgMul: 1.6,  hazardCooldownMul: 0.6,  oscAggroMul: 1.8,  supportMul: 3.2, mayhemMul: 2.2 },
]
export type ProjKind = 'shot' | 'bomb' | 'bolt' | 'seeker' | 'spread'   // enemy projectile flavours
export interface TurretShot { x: number; y: number; vx: number; vy: number; kind?: ProjKind; t?: number }
export interface Rocket { x: number; y: number; vy: number }
/** `r` = blast radius in world px. Omitted means "the default rocket radius" — set
 *  it when the blast was amped, so the drawn shock ring matches the real blast. */
export interface Explosion { x: number; y: number; t: number; hue?: 'plasma'; r?: number }
// Ten DISTINCT enemies — each its own movement, tactic AND look (see ENEMY_KINDS).
export type EnemyKind = 'hunter' | 'bomber' | 'splitter' | 'leech' | 'mirror' | 'orbit' | 'dart' | 'blink' | 'polarity' | 'queen'
export interface Enemy {
  x: number; y: number; hp: number; variant: number; kind: EnemyKind
  vx?: number; vy?: number                                   // velocity (strafe/drift/dive/march)
  t?: number; cd?: number                                    // phase clock / cooldown (fire, flip, blink, birth, re-anchor)
  ax?: number; ay?: number                                   // anchor (orbit) / figure-8 centre (leech) / blink destination / lane
  phase?: 'patrol' | 'dive' | 'retreat' | 'idle' | 'out' | 'in'
  flash?: number                                             // visual flash (leech gold / polarity flip / queen birth / blink land)
  polarity?: 'blue' | 'red'                                  // polarity knight's active armour
  eaten?: number                                             // leech: pills swallowed
  brood?: { x: number; y: number; vx: number; vy: number }[] // queen broodlings
  ghostX?: number; ghostY?: number                           // blink after-image
  split?: number                                             // splitter: 0 whole → 1 cracked
}
export interface Tnt { x: number; y: number; t: number; fuse: number; lit: boolean }   // centre dynamite; a ball hit lights the fuse
export interface Bumper { x: number; y: number; r: number; flash: number }
// 20 tasteful pinball props; a random handful spawn each time the P pill is caught.
export type PinballKind =
  | 'jet' | 'pop' | 'mushroom' | 'tunnel' | 'jackpot' | 'teleport' | 'multiplier' | 'extraball' | 'orbit'   // discs
  | 'drop' | 'standup' | 'bank'                                                                              // targets
  | 'slingL' | 'slingR'                                                                                      // slingshots
  | 'magnet' | 'fan' | 'kicker'                                                                              // field forces
  | 'spinner' | 'rollover' | 'gate'                                                                          // bars
export interface PinballProp { kind: PinballKind; x: number; y: number; r: number; hp: number; flash: number; spin: number; lit: boolean; cd: number; partner: number }
/** The top pill-dispenser is a rotating cast of cartoon critters (one at a time). */
export type DispenserKind = 'frog' | 'bee' | 'crab' | 'ghost' | 'chick'
export const DISPENSER_KINDS: readonly DispenserKind[] = ['frog', 'bee', 'crab', 'ghost', 'chick']
export interface Alien { x: number; y: number; vx: number; frame: number; kind: DispenserKind }
// The extra-life carrier: a beautiful winged heart (NOT the alien) that sweeps to
// one side, back, then leaves. Shoot it for a 1-UP.
export interface ExtraLife { x: number; y: number; vx: number; t: number; bounced: boolean }
export interface Pacman { x: number; y: number; dir: number; hp: number; mouth: number; eaten: number; eatCd: number; leaving: boolean }
export interface ComboPop { x: number; y: number; n: number; t: number; pts?: number }
export interface Pickup { x: number; y: number; kind: PowerKind; t: number }   // a caught-bonus flash

export interface PowerMeta { letter: string; color: string; name: string; desc: string }
export const POWER_META: Record<PowerKind, PowerMeta> = {
  oscillate: { letter: 'O', color: '#5fe0c0', name: 'oscillate', desc: 'Green mushroom — THE AMP. Every other power-up you grab hits harder: one O doubles them, two triples, three quadruples. Balls also weave side to side and score more. Permanent for the round.' },
  break: { letter: 'B', color: '#ff9f43', name: 'break apart', desc: 'Splits every ball into three of its own kind — white into white, colour into colour.' },
  laser: { letter: 'L', color: '#ff5b5b', name: 'laser', desc: 'Hold SPACE to charge a fireball at the bat — release to launch. Longer hold = bigger Hadouken. 4 shots, no timer; grab more to power up.' },
  expand: { letter: 'E', color: '#5fe08a', name: 'expand', desc: 'Widens your paddle. Timed.' },
  gun: { letter: 'G', color: '#b07bff', name: 'gun', desc: '6-shot magazine. Space fires coloured ammo in a 120° fan. Grab more to stack: +diagonals, then double.' },
  magnet: { letter: 'M', color: '#ff5b8a', name: 'magnet', desc: 'Pulls the ball toward the paddle, but only while it is in the top half — releases below the halfway line. Timed.' },
  rocket: { letter: '↑', color: '#ff7043', name: 'rocket', desc: 'Right-click to launch your one missile. It explodes on the first thing it hits, blasting bricks in range.' },
  multiplier: { letter: '×', color: '#ffd24a', name: 'multiplier', desc: '2× or 3× score for everything while it lasts.' },
  burst: { letter: '∗', color: '#3dd7ff', name: 'burst', desc: 'For 8 seconds every brick dies in one hit — tough ones included.' },
  pinball: { letter: 'P', color: '#8c9eff', name: 'pinball', desc: 'The board becomes a PINBALL MACHINE — fixed flippers on the mouse buttons, bumpers and table props. No timer: you play it out. It ends when you clear the level or lose a ball, then play carries on as normal. The white ball doubles in size but does only a quarter of the damage.' },
  beam: { letter: 'I', color: '#9d5cff', name: 'beam', desc: 'A purple magic mushroom. 4 shots, no timer: charges ~1.2–1.5s then fires a laser up the middle, damaging that whole column. Grab more to power up — level 3 clears the line.' },
  clock: { letter: 'T', color: '#7ee0ff', name: 'time clock', desc: 'Caught from the alien with at least one colour ball in play: freezes your white ball(s) and every hazard for a few seconds while colour balls keep clearing.' },
  ballchain: { letter: '&', color: '#cfd3da', name: 'ball & chain', desc: 'A spiked wrecking ball swings from the white ball — kills the hunter and smashes falling pills. Smash 5 pills before it ends and a gold paper crane flutters down — catch it for the 100,000 jackpot.' },
  extralife: { letter: '1UP', color: '#5fe08a', name: 'extra life', desc: 'A 1-UP! Catch this pill to gain a life. Spat out by the hopping dispenser, or by shooting the rare winged-heart carrier on its single pass. Amped by the oscillator: a 2-UP, 3-UP or 4-UP, and the life ceiling rises with it (5 → 20).' },
  crane: { letter: '☆', color: '#ffd24a', name: 'paper crane', desc: 'The gold paper-crane prize from a ball & chain run. Catch it for a 100,000 jackpot.' },
  pierce: { letter: '»', color: '#d8e6ff', name: 'pierce', desc: 'The white ball phases THROUGH tiles — one damage each as it passes, no bounce — carving a tunnel. Colour balls do not pierce. Timed.' },
  scramble: { letter: '?', color: '#ff3df0', name: 'scramble', desc: 'Scrambles EVERY ball — including your white one — into random, ever-shifting colours, so you can no longer tell yours apart by colour and must FOLLOW it by eye. Snaps back to normal (yours back to white) when it ends. Grab more to hold it longer (1 → 3 → 5s).' },
  heal: { letter: '♥', color: '#5fe08a', name: 'repair', desc: 'Repairs the paddle — restores a chunk of bat health.' },
  shield: { letter: '⛨', color: '#5b9bff', name: 'shield', desc: 'A force shield over the bat: it takes no damage and DEFLECTS enemy fire back up. No timer — it lasts until enemy fire chips its strength away and BUSTS it. Amped shields hold a deeper pool, so they soak more hits.' },
  regen: { letter: '✚', color: '#3fe0a8', name: 'healing shield', desc: 'A shield that also REGENERATES bat health — defend and heal at once. Like the plain shield it has no timer: it heals for as long as it survives, and stops when it busts.' },
}
export const POWER_ORDER: PowerKind[] = ['oscillate', 'break', 'laser', 'expand', 'gun', 'magnet', 'rocket', 'multiplier', 'burst', 'pinball', 'beam', 'clock', 'ballchain', 'pierce', 'scramble', 'heal', 'shield', 'regen']

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
const AIM_RANGE = PADDLE_W * 0.25    // one-time aim: the ball sits within ±25% of paddle width of centre
const AIM_ANCHOR = W / 2             // the ball hangs still here while you slide the paddle under it
const PADDLE_Y = H - 34
const PADDLE_SPEED = 620              // px/s for keyboard control
const BALL_R = 7
const BALL_SPEED = 450                // px/s, base magnitude (faster start)
const BALL_SPEED_MIN = BALL_SPEED / 2   // never let a ball crawl below half the start speed
const LAUNCH_MAX_ANGLE = 0.7          // rad — the on-paddle offset sets the launch angle (centre pivot = straight up)
const BALL_SPEEDUP = 1.03            // each paddle hit nudges speed up
const BALL_SPEED_MAX = 640            // headroom for the faster start + the oscillate bumps + pinball ×2
const MIN_VY_RATIO = 0.3             // keep ≥30% of speed vertical so a ball can't loop horizontally
const START_LIVES = 3
const MAX_BALLS = 9

const CAPSULE_W = 30
const CAPSULE_H = 15
const CAPSULE_SPEED = 135
const INVADER_MARCH = 150            // px/s sideways march on invader levels
const INVADER_STEP = 18              // px the pill drops each time it hits a wall
const INVADER_FALL = 55              // px/s slow descent so it still works its way down
const DROP_CHANCE = 0                 // bricks no longer drop — the alien is the dispenser
const MAX_CAPSULES = 5                // never more than this many pills on screen at once
const PILL_STAGGER = 0.25             // each pill hovers this long at spawn before it starts falling

// Alien ship at the top: shoot it (ball or any weapon) and it explodes, dropping
// one power-up, then a new ship flies in. It is the source of all power-ups.
export const ALIEN_Y = 24
export const ALIEN_W = 30
export const ALIEN_H = 20
const ALIEN_SPEED = 80               // px/s march (average; the frog lurches forward in airborne bursts)
// The top dispenser is a cartoon FROG that HOPS across the playfield (reskins the old saucer).
export const FROG_HOP_PERIOD = 0.62  // seconds per hop (airborne arc + a brief landing squat)
const FROG_HOP_HEIGHT = 16           // px the frog rises at hop apex (above ALIEN_Y)
export const FROG_AIR_FRAC = 0.78    // fraction of each hop spent airborne; the rest is the squat
// Bumblebee: fast tight buzz.
export const BEE_WIGGLE_HZ = 6.0     // cycles/sec of the vertical buzz
export const BEE_BOB = 10            // px peak vertical wiggle
const BEE_SPEED_MUL = 1.15           // a touch faster than average
// Crab: sideways scuttle.
export const SCUTTLE_PERIOD = 0.42   // seconds per skitter cycle (two quick steps)
const SCUTTLE_BOB = 8                // px vertical bounce
const SCUTTLE_SKITTER = 0.55         // ± fraction of vx the side-skitter adds (zero mean)
// Ghost: slow dreamy float.
export const GHOST_BOB_PERIOD = 1.7  // seconds per full float cycle (slow)
export const GHOST_BOB_AMP = 14      // px vertical sway about the baseline
// Chick: flappy wing-beat bob + occasional glide-dip.
export const CHICK_BOB_PERIOD = 0.34 // seconds per wing-beat
const CHICK_BOB_AMP = 9              // px the chick rises on the down-flap
const CHICK_GLIDE_PERIOD = 1.9       // seconds per slow glide cycle
const CHICK_GLIDE_DIP = 7            // px of extra sink during a glide-dip
const SHIP_RESPAWN = 6               // seconds before the next ship flies in (was 1.3 — far less spammy)
const EXTRALIFE_CHANCE = 0.12        // chance a fresh ship spawn also releases an extra-life carrier (lives < 5)
const EXTRALIFE_PILL_CHANCE = 0.18   // chance a bonked dispenser spits a 1-UP pill instead of a random one (lives < 5)
const EXTRALIFE_SPEED = 50           // slow, for a fair shot
const EXTRALIFE_R = 14               // the winged heart's radius
const EXTRALIFE_Y = H * 0.2          // sweeps across the upper play area
const MAX_LIVES = 5

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
  clock: 4, ballchain: 2,
  pierce: 3, scramble: 4,
  heal: 5, shield: 5, regen: 3,        // defensive drops — more common when the bat is hurt (see #randomPower)
  extralife: 0,                        // never an ambient drop — only the carrier alien gives it
  crane: 0,                            // never an ambient drop — only earned from a ball & chain run
}
// Defensive (survival) drops — their weight is FLOODED by the difficulty's supportMul
// and again by live danger (low bat HP / on the brink). See #randomPower.
const DEFENSIVE = new Set<PowerKind>(['heal', 'shield', 'regen'])

// Laser → charge-and-release FIREBALL cannon: 4 shots (no timer); hold to charge,
// release to launch a Street-Fighter fireball. Longer hold = bigger tier.
const LASER_LOADER = 4               // shots per laser pickup
const LASER_MAX_LEVEL = 3            // re-grab before empty to power up (1→2→3)
const LASER_CHARGE_FULL = 1.4        // seconds of hold to reach max tier
const LASER_TIER2_AT = 0.45          // hold ≥ this → tier 2 (Flare)
const LASER_TIER3_AT = 0.95          // hold ≥ this → tier 3 (HADOUKEN)
const LASER_FIRE_CD = 0.12           // min seconds between launches (debounce a key-repeat edge)
const LASER_MUZZLE_FLASH = 0.22      // seconds the launch kick lingers at the bat
const FIREBALL_SPEED = 560           // px/s up
// per-tier tables, indexed [tier-1]
const FIREBALL_DMG = [2, 4, 99]      // damage to each brick pierced (tier 3 one-shots)
const FIREBALL_PIERCE = [2, 4, 8]    // bricks it passes through before detonating
const FIREBALL_AOE = [14, 22, 34]    // splash radius at each pierce + detonation (world px)
const FIREBALL_R = [6, 9, 13]        // orb radius (world px)
const FIREBALL_TAIL = [22, 34, 50]   // comet-tail length (world px)

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
// per-step travel stays a couple of px even at the widest weave. The active
// difficulty's `oscAggroMul` scales the width, the frequency AND the speed bump,
// so harder modes weave more aggressively (Gangster is the wildest); the sub-step
// count below folds in the weave's lateral speed so a wide/fast weave can't tunnel.
const WOBBLE_BASE_AMP = 18            // px of lateral weave at 1 stack (doubled initial value)
const WOBBLE_AMP_MAX = 36             // px cap at base aggression (scaled up by oscAggroMul)
const WOBBLE_FREQ = 8                 // rad/s at base aggression (scaled up by oscAggroMul)
const OSC_SPEEDUP = 1.08             // ball-speed bump per O pickup at base aggression (permanent)
// The AMP ladder: oscillate stacks multiply every OTHER power-up's effect.
// 0 stacks → ×1 (the un-amped game), 1 → DOUBLE, 2 → TRIPLE, 3+ → QUADRUPLE.
// The ladder deliberately stops at quadruple: `amp` is a factor on ammo counts,
// blast radii, durations and ball caps, so an uncapped ladder would run away.
const AMP_MAX = 4
// Score booster: 1 + 0.6·(amp-1) → ×1 un-amped, ×1.6 at one stack (exactly as
// before), rising to ×2.8 at quadruple.
const OSC_SCORE_PER_AMP = 0.6
// Break's split cone (rad each side of the parent's heading). The amp subdivides
// THIS fan into 2·amp splits rather than widening it, so an amped split never
// fires sideways: at amp 1 the two splits land on exactly the original ±0.35.
const BREAK_FAN = 0.7

// Rocket: right-click launches one missile straight up; it explodes on the first
// thing it hits (brick, hunter, or ceiling), blasting every brick in the radius.
// Only one missile exists at a time — no manual detonate.
const ROCKET_SPEED = 460
export const ROCKET_RADIUS = 58
const ROCKET_LOADER = 1              // one missile per pickup
const ROCKET_MAX = 1                 // hold at most one
export const EXPLOSION_DUR = 0.45    // seconds the blast ring lingers (visual)

// Multiplier: a 2× or 3× score multiplier (one per pickup) for a while.
// Multiplier system — two capped axes whose product is the score multiplier:
//   POINTS × (skill: combo + the unified gold bonus)   PILLS × (collection: pills eaten)
// Oscillate keeps its ×1.6 as a separate booster riding on top of the two-axis product.
const GOLD_WINDOW = 12               // the unified gold-bonus window (gold pill + ×N tiles + pinball disc)
const GOLD_BONUS_CAP = 2             // max additive gold bonus into the points multiplier
const POINTS_CAP = 6                 // skill-axis ceiling (1 + combo·0.2 + goldBonus)
const PILLS_CAP = 3                  // collection-axis ceiling (1 + 0.1 per pill)
const TOTAL_CAP = 18                 // ceiling on the two-axis product (oscillate ×1.6 rides on top)

// Burst: for a few seconds every brick is one-hit, tough bricks included.
const BURST_DURATION = 8
const PIERCE_DURATION = 9             // the white ball phases through tiles (1 dmg each) for a while
const SCRAMBLE_DURS = [1, 3, 5]      // ? scramble: stacked hold-time of the random-colour shuffle (1 → 3 → 5s)

// Enemy: dawdle on a level and a hunter spawns to chase your white ball. A hit
// on the WHITE ball whacks it away at top speed instead of stealing it — no life
// lost, but the fast ball is on screen a shorter time and easy to drop. It has 3
// hp: ball hits, coloured ammo, lasers and rockets all chip it, so 3 hits destroy
// the hunter. Killing it (or dying) resets the dawdle timer.
const ENEMY_SPAWN_DELAY = 22         // seconds of "taking too long" before the first one appears
const ENEMY_REFILL_GAP = 6           // gap before the swarm spawns its next member (up to the level cap)
const ENEMY_SPEED = 105              // px/s homing toward the white ball
const ENEMY_HP = 3
// The ten enemy kinds (picked at random on spawn) and their hp ladder — Blink is a
// 1-hp twitch, the Queen is a 5-hp boss.
const ENEMY_KINDS: EnemyKind[] = ['hunter', 'bomber', 'splitter', 'leech', 'mirror', 'orbit', 'dart', 'blink', 'polarity', 'queen']
const ENEMY_HP_BY_KIND: Record<EnemyKind, number> = { hunter: 3, bomber: 2, splitter: 2, leech: 2, mirror: 2, orbit: 3, dart: 2, blink: 1, polarity: 3, queen: 5 }
export const ENEMY_R = 15

// Mega brick: some bricks sparkle and bloom into one big brick spanning a block
// of cells (covering any bricks underneath). It takes MEGA_HP hits, then shatters
// into small shards — EVERY shard is a guaranteed power-up tile (a pill bonanza).
const MEGA_COLS = 3                  // footprint width in cells  (the "spots" it takes)
const MEGA_ROWS = 2                  // footprint height in cells (3×2 = 6 spots)
const MEGA_HP = 5                    // hits to break the big brick
// ── The FINALE ────────────────────────────────────────────
// Every level ends on a payoff instead of a fizzle. Down to the LAST brick, that
// brick turns gold and pulses — a beacon (see #markFinalBrick). Clear the board and
// the finale fires: a jackpot, a gold flash and a ring of fireworks, played out on
// the LIVE board for FINALE_HOLD seconds before the overlay's tally opens.
//
// There is no timer and no fail state — the finale is pure reward for finishing.
// (It replaces the old centre "gold brick": a 5-hp throne on a 15s fuse that, if you
// missed it, threw every ball to 2× speed permanently. Do not bring that back — the
// end of a level must be a victory lap, never a punishment. The near-clear enemy
// BERSERK that used to rage below 12 bricks is gone for the same reason.)
const FINALE_HOLD = 1.3             // seconds the fireworks play on the live board before the level is declared won
const FINALE_FLASH = 0.7            // seconds of the finale's gold flash / shout
const FINALE_JACKPOT = 10000        // the level-clear jackpot (rides the score multipliers)

// Pinball: a timed flipper mode. Two field bumpers bounce balls around and the
// white ball doubles in SIZE — but does only a QUARTER of the damage, so it's
// bouncy chaos, not a board-melter. The duration is randomly one of these.
// Pinball is a MODE, not a timed power: catch the P pill and the board becomes a real
// pinball machine — fixed flippers, bumpers, props — and you PLAY IT OUT. There is no
// clock. It ends exactly two ways, both of which already reset it: clear the level (the
// overlay builds a fresh Engine for the next screen) or drain and lose a life
// (#resetForLife). Either way play continues as normal afterwards.
const PINBALL_DAMAGE = 0.25          // the giant pinball ball does only 25% of a normal hit's damage
const BUMPER_R = 20
const BUMPER_Y = H * 0.6             // bumpers sit below every brick row — the "non-tile" zone
// Pinball props: a random subset (kept small so it never clutters) drops into the
// open zone below the bricks each time pinball mode is activated.
const PINBALL_PROPS_MIN = 1          // only a couple props per activation
const PINBALL_PROPS_MAX = 2
const PINBALL_SHAPE: Record<PinballKind, 'disc' | 'target' | 'sling' | 'field' | 'bar'> = {
  jet: 'disc', pop: 'disc', mushroom: 'disc', tunnel: 'disc', jackpot: 'disc', teleport: 'disc', multiplier: 'disc', extraball: 'disc', orbit: 'disc',
  drop: 'target', standup: 'target', bank: 'target',
  slingL: 'sling', slingR: 'sling',
  magnet: 'field', fan: 'field', kicker: 'field',
  spinner: 'bar', rollover: 'bar', gate: 'bar',
}
// Pinball flippers: in pinball mode the bat becomes two REAL flippers, flicked up
// by the LEFT / RIGHT mouse buttons, that launch the ball back into play. They
// pivot near the bottom with a small central drain gap between the resting tips.
export const FLIP_LEN = 64
const FLIP_THICK = 5
export const FLIP_PIVOT_DX = 82      // pivots sit at W/2 ± this
export const FLIP_Y_OFF = 2          // pivot height above PADDLE_Y baseline
export const FLIP_REST = 0.38        // resting angle (rad) of the LEFT flipper (tip down toward centre)
export const FLIP_UP = -0.56         // flipped-up angle of the LEFT flipper
const FLIP_RAISE_SPEED = 12          // how fast a flipper snaps up / down (per second)
const PINBALL_LAUNCH = 480           // launch speed imparted by an active flip
// Turret: in pinball mode, each bumper hit toggles a random tile into a turret
// that fires aimed shots at the paddle; the next hit morphs it back (on/off).
const TURRET_FIRE_INTERVAL = 1.1     // seconds between a lit turret's shots
const TURRET_SHOT_SPEED = 210        // px/s, aimed at the paddle's position at fire time
const TURRET_SHOT_R = 4              // shot radius for the paddle hit-test
const PADDLE_HIT_FLASH = 0.3         // seconds the paddle flashes red after taking a shot
// Paddle health: enemy fire chips the bat's HP; deplete it and you lose a life.
const PADDLE_MAX_HP = 100
const TURRET_DMG = 24                // damage from a turret shot / bomb that lands on the bat
const HEAL_AMOUNT = 45               // ♥ heal pill
// ⛨ / ✚ shields have NO clock: they last until they're BUSTED. The strength pool is
// the whole lifetime — every deflected shot chips it, and at 0 the shield breaks.
// (Amp deepens the pool, so an amped shield survives proportionally more hits.)
const SHIELD_MAX_HP = 100            // ⛨ shield strength pool — projectiles chip it, 0 → shield breaks
const SHIELD_HIT_DMG = TURRET_DMG    // strength a deflected shot costs the shield (~4 hits to break)
const REGEN_RATE = 14               // HP per second while a healing shield is up (it heals until the shield busts)

// Dynamite (TNT): periodically a crate appears in the middle for TNT_LIFETIME
// seconds; a ball hit lights the fuse, and TNT_FUSE seconds later it detonates,
// dealing a random 1..TNT_DMG_MAX to EVERY tile within TNT_RADIUS. While a crate
// is on screen the balls carry a fire aspect.
const TNT_LIFETIME = 30              // seconds a crate lingers before it fizzles
const TNT_FUSE = 1.6                 // seconds from "lit" to the blast (telegraphs the big blast)
const TNT_RADIUS = 150               // blast radius — a genuinely board-shaking blast (was 92)
const TNT_R = 15                     // crate half-size for the ball hit-test
const TNT_FIRST = 14                 // seconds into a level before the (single) crate
const TNT_DMG_MAX = 3               // a tile caught in the blast takes a random 1..3
const TNT_PER_LEVEL = 0.2            // ~ one level in five is a TNT level (exactly one crate)
const ENEMY_VARIANTS = 10            // distinct hunter looks, picked at random on spawn
// Special multiplier tiles: three tiles per board show ×1/×2/×3 and grant that
// score multiplier when broken; rarely (~every 5 boards) a hidden ×5 lurks in a
// normal-looking brick.
const MULT_TILE_5X_CHANCE = 0.2      // ~ one in five boards hides the rare ×5

// Pill waves: ambient power-ups arrive in a deliberate ebb-and-flow instead of a
// per-kill firehose. QUIET (no drops) → WAVE (a trickle of PILLS_PER_WAVE) → QUIET.
const PILL_QUIET = 9                 // seconds of calm between waves
const PILL_WAVE = 5                  // seconds the wave window stays open
const PILLS_PER_WAVE = 3             // pills the alien can dispense per wave (the cap)

// Encounter director: at most ONE major hazard at a time, with a guaranteed calm
// between them. The ordinary wave-alien is NOT a major hazard (it is pill delivery).
const HAZARD_COOLDOWN = 8            // seconds of calm after a major hazard resolves

// Pac-Man: a comedic ammo-economy rival — eats only COLOUR balls (never the white
// one), immune to colour balls, destroyed by the white ball / weapons.
const PAC_R = 14
const PACMAN_SPEED = 130             // px/s — quick, but it leads/intercepts to make up the rest
const PACMAN_HP = 3
const PAC_EAT_CD = 0.8              // seconds between bites (so it can't vacuum a cluster)
const PAC_EAT_CAP = 4               // colour balls eaten before it leaves, full
const PAC_COLOR_MIN = 2             // colour balls needed on screen to summon it
const PAC_SUMMON_HOLD = 1.5        // …held for this long first

// Clock: caught from the alien (needs ≥1 colour ball), it freezes the white
// ball(s) + every hazard while colour balls keep clearing.
const CLOCK_DURATION = 6
// Ball & chain: a spiked wrecking ball swings from the white ball, killing the
// hunter and smashing falling pills. 10 pill-smashes in the window = a jackpot.
const BALLCHAIN_DURATION = 16
const CHAIN_LEN = 48                 // chain length: white ball → wrecking ball
const WRECK_R = 9                    // wrecking-ball radius for its hits
const CHAIN_K = 13                   // pendulum restoring force toward straight-down
const CHAIN_DAMP = 0.6               // swing damping
const CHAIN_DRIVE = 0.018            // how strongly the ball's motion swings the flail
const CHAIN_BONUS_PILLS = 5          // pills to smash before the gold paper crane drops
const CHAIN_BONUS = 100000           // the jackpot

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
  aiming = true                       // one-time launch-point aim (first start of a game); see aimClick()
  balls: Ball[] = []
  capsules: Capsule[] = []
  fireballs: Fireball[] = []         // in-flight charge-cannon fireballs
  rockets: Rocket[] = []
  explosions: Explosion[] = []
  enemies: Enemy[] = []               // the enemy swarm — its size cap grows with the level
  levelIndex = 0                      // difficulty slot (set by the overlay) — more enemies on harder levels
  bumpers: Bumper[] = []              // pinball-mode field bumpers (empty otherwise)
  pinballProps: PinballProp[] = []    // a random handful of pinball props (pinball mode only)
  flipLeftRaise = 0                   // 0 = resting, 1 = fully flipped (left flipper, pinball mode)
  flipRightRaise = 0                  // 0 = resting, 1 = fully flipped (right flipper)
  turretShots: TurretShot[] = []      // shots fired at the player by lit turret tiles
  paddleHitFlash = 0                  // seconds left of the red flash after a turret shot lands
  paddleHp = PADDLE_MAX_HP            // bat health — enemy fire chips it; 0 → lose a life
  shieldHp = 0                        // ⛨ shield strength remaining — projectiles chip it; 0 → it breaks. NO timer: this pool IS the lifetime
  regenShield = false                 // ✚ this shield also regenerates bat HP (until it busts)
  shieldFlash = 0                     // brief flash when the shield deflects a shot
  tnt: Tnt | null = null              // the centre dynamite crate (null = none on screen)
  alien: Alien | null = null         // the top ship dispenser (respawns when shot)
  extraLife: ExtraLife | null = null // the winged-heart 1-UP carrier (null = none)
  pacman: Pacman | null = null       // the colour-ball-eating rival (null = none)
  combo = 0                          // bricks killed since the last paddle bounce
  comboPops: ComboPop[] = []         // floating combo counters (transient, for the renderer)
  pickups: Pickup[] = []             // caught-bonus flashes (transient, for the renderer)

  // Fireball cannon (the reworked laser): a 4-loader you charge + release by hand.
  laserShots = 0                     // shots left in the loader (0 = no cannon)
  laserLevel = 0                     // power level 1..3 (re-grab before empty to raise)
  laserCharging = false              // true while the fire input is HELD
  laserCharge = 0                    // seconds the current hold has accumulated
  laserMuzzleFlash = 0               // seconds left of the launch kick-flash at the bat
  // The active difficulty mode (Rookie = current). The overlay sets this on a fresh run.
  difficulty: DifficultyProfile = DIFFICULTY[0]
  invaderPills = false                // SPACE-INVADER pill march (set by the overlay on invader levels)
  // Timed power state (seconds remaining; 0 = inactive).
  expandTimer = 0
  magnetTimer = 0
  burstTimer = 0
  pinball = false                     // pinball MACHINE mode — no clock; ends only on a level clear or a death
  pierceTimer = 0                     // white ball phases through tiles while > 0
  // Scramble (?): while > 0, EVERY ball renders in random, ever-shifting colours
  // (the hero loses its white too) so you must follow yours by eye; reverts to
  // normal when it ends. Purely a render concern — the engine just owns the clock.
  scrambleTimer = 0
  scrambleLevel = 0                  // 0..2 → index into SCRAMBLE_DURS (steps up on re-grab)
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
  // POINTS axis — the unified gold bonus (0..GOLD_BONUS_CAP) fed by the gold pill,
  // the ×N tiles AND the pinball multiplier disc, holding for one GOLD_WINDOW.
  goldBonus = 0
  goldTimer = 0
  // PILLS axis — every caught pill adds +0.1 (capped at PILLS_CAP); halves on death.
  pillMul = 1
  // Milestone celebration (combo ×5/×10/…): a transient eruption + a score flash.
  milestoneFx: { n: number; t: number; life: boolean } | null = null
  scoreFlash = 0
  // Clock freeze: while > 0, white ball(s) + every hazard are frozen.
  freezeTimer = 0
  // Ball & chain: a swinging spiked wrecking ball hanging off the white ball.
  ballchainTimer = 0
  chainBall: { x: number; y: number } | null = null   // the wrecking ball (render + hits)
  ballchainKills = 0                                   // pills smashed this window (10 → jackpot)
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
  #launchOffset = 0                   // the ball's position ON the paddle (offset from centre) — reused all game
  #colorIdx = 0                       // cycles BALL_COLORS so each ammo ball differs
  #levelClock = 0                     // seconds on this screen — drives the enemy spawn
  #levelRows = 0                      // rows in the current level (mega footprint clamp)
  #paddleBaseW = PADDLE_W             // permanent bat width (grown 25% by each oscillate); expand widens on top
  // Loader sizes / pools SNAPSHOTTED at pickup, because the AMP scales them. The HUD
  // pip rows and strength bars divide by these, so they must track the grant that
  // actually happened — reading the base constant would overflow an amped bar, and
  // reading `amp` live would rescale a bar the moment a later O landed.
  #gunLoader = GUN_LOADER
  #beamLoader = BEAM_LOADER
  #laserLoader = LASER_LOADER
  #rocketMax = ROCKET_MAX
  #shieldMax = SHIELD_MAX_HP
  // Same reason, for the timed powers whose HUD bar is EXACT today (they assign
  // rather than stack, so a clamped denominator would visibly lie once amped).
  // expand/magnet/burst/pierce/shield/regen already pin at full when stacked, so
  // they keep reading their base constant.
  #scrambleDur = SCRAMBLE_DURS[0]
  #clockDur = CLOCK_DURATION
  #ballchainDur = BALLCHAIN_DURATION
  #turretFireCd = 0                   // countdown to the active turret's next shot
  #tntTimer = TNT_FIRST               // seconds until the next dynamite crate appears
  #chainAngle = 0                     // wrecking-ball pendulum angle (0 = straight down)
  #chainAngVel = 0                    // pendulum angular velocity
  #chainBonusPaid = false             // the 100k jackpot pays once per window
  #flipLDown = false                  // left mouse held (left flipper up)
  #flipRDown = false                  // right mouse held (right flipper up)
  #flipLVel = 0                       // left flipper raise delta this frame (>0 = rising → kick)
  #flipRVel = 0                       // right flipper raise delta this frame
  // Encounter director: one major hazard at a time + a calm between them.
  #activeHazard: 'none' | 'hunter' | 'pacman' | 'tnt' | 'carrier' = 'none'
  #hazardCooldown = 0                 // seconds of guaranteed calm before the next major hazard
  // Pill waves (the only ambient pill source).
  #pillPhase: 'quiet' | 'wave' = 'quiet'
  #pillClock = 0
  #waveBudget = 0                     // pills the alien still has loaded this wave (released on hit)
  #colorBallTimer = 0                 // how long ≥ PAC_COLOR_MIN colour balls have been up (summons Pac-Man)
  #tntArmedThisLevel = false          // rolled once per level: is there a crate this board?
  finaleTimer = 0                     // > 0 = the board is clear and the finale fireworks are playing; the win is declared when it runs out
  rushFlash = 0                       // seconds left of the finale's gold flash burst
  #finaleFired = false                // the finale plays once per level
  #shipRespawn = 0                    // seconds until the next alien ship flies in (when destroyed)
  #dispenserSeq = Math.floor(Math.random() * DISPENSER_KINDS.length)   // rotates the critter cast (random start)

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
    this.#placeMultTiles()
    this.#tntArmedThisLevel = Math.random() < TNT_PER_LEVEL   // ~1 level in 5 gets a (single) crate
    this.#spawnShip(false)                                    // the level's first ship is never a carrier
  }

  /** A major hazard may begin only when the slot is free AND the calm has elapsed. */
  #hazardFree(): boolean { return this.#activeHazard === 'none' && this.#hazardCooldown <= 0 }
  /** A major hazard resolved — start the guaranteed calm before the next one. */
  #endHazard(): void { this.#activeHazard = 'none'; this.#hazardCooldown = HAZARD_COOLDOWN * this.difficulty.hazardCooldownMul }

  /** Tag three random tiles as ×1/×2/×3 score-multiplier tiles, and ~every fifth
   *  board hide a rare ×5 inside an ordinary-looking brick (revealed only when broken). */
  #placeMultTiles(): void {
    const pool = this.bricks.filter(b => b.alive && !b.mega && !b.seed)
    const pick = (): Brick | null => {
      if (!pool.length) return null
      return pool.splice(Math.floor(Math.random() * pool.length), 1)[0]   // distinct each time
    }
    for (const m of [1, 2, 3]) { const b = pick(); if (b) b.mult = m }
    if (Math.random() < MULT_TILE_5X_CHANCE) { const b = pick(); if (b) { b.mult = 5; b.hidden = true } }
  }

  #spawnShip(allowCarrier = true): void {
    const dir = Math.random() < 0.5 ? 1 : -1
    const kind = DISPENSER_KINDS[this.#dispenserSeq % DISPENSER_KINDS.length]   // rotate the cast — the frog is just one of five
    this.#dispenserSeq++
    this.alien = { x: dir > 0 ? ALIEN_W / 2 : W - ALIEN_W / 2, y: ALIEN_Y, vx: ALIEN_SPEED * dir, frame: 0, kind }
    // Occasionally release a separate extra-life carrier (a winged heart) — never on
    // the level's first ship, only when it helps (lives < max) and the slot is free.
    if (allowCarrier && !this.extraLife && this.lives < this.maxLives && this.#hazardFree() && Math.random() < EXTRALIFE_CHANCE) {
      this.#spawnExtraLife()
    }
  }

  /** Release the winged-heart 1-UP carrier from one edge, heading across. */
  #spawnExtraLife(): void {
    const fromLeft = Math.random() < 0.5
    this.extraLife = { x: fromLeft ? EXTRALIFE_R : W - EXTRALIFE_R, y: EXTRALIFE_Y, vx: (fromLeft ? 1 : -1) * EXTRALIFE_SPEED, t: 0, bounced: false }
    this.#activeHazard = 'carrier'
  }

  /** Move the active dispenser critter across the top (one of a rotating cast). Each
   *  kind sets a.y + its x-advance off the a.frame phase clock; every hit/bounce/spit
   *  site reads a.x/a.y live, so a critter dispenses from wherever its motion puts it. */
  #stepAlien(dt: number): void {
    if (this.freezeTimer > 0) return                  // clock: critter frozen mid-motion
    const a = this.alien
    if (!a) {
      this.#shipRespawn -= dt
      if (this.#shipRespawn <= 0) this.#spawnShip()
      return
    }
    a.frame += dt
    let dx = a.vx * dt                                           // default: a steady glide at the baseline
    switch (a.kind) {
      case 'frog': {                                            // hop arcs: travel only while airborne
        const ph = (a.frame % FROG_HOP_PERIOD) / FROG_HOP_PERIOD
        let lift = 0, glide = 0
        if (ph < FROG_AIR_FRAC) { const u = ph / FROG_AIR_FRAC; lift = Math.sin(u * Math.PI); glide = Math.sin(u * Math.PI) }
        a.y = ALIEN_Y - FROG_HOP_HEIGHT * lift
        dx = a.vx * (1 / ((2 / Math.PI) * FROG_AIR_FRAC)) * glide * dt
        break
      }
      case 'bee': {                                             // fast tight buzz, steady cruise
        const w = a.frame * BEE_WIGGLE_HZ * Math.PI * 2
        a.y = ALIEN_Y + BEE_BOB * (0.82 * Math.sin(w) + 0.18 * Math.sin(w * 2.7))
        dx = a.vx * BEE_SPEED_MUL * dt
        break
      }
      case 'crab': {                                            // sideways scuttle (zero-mean skitter keeps avg speed)
        const ph = (a.frame % SCUTTLE_PERIOD) / SCUTTLE_PERIOD
        a.y = ALIEN_Y - SCUTTLE_BOB * Math.abs(Math.sin(ph * Math.PI * 2))
        dx = a.vx * (1 + SCUTTLE_SKITTER * Math.cos(ph * Math.PI * 2)) * dt
        break
      }
      case 'ghost': {                                           // slow dreamy float + lazy speed breathing
        const t = (a.frame / GHOST_BOB_PERIOD) * Math.PI * 2
        a.y = ALIEN_Y + GHOST_BOB_AMP * Math.sin(t)
        dx = a.vx * (1 + 0.18 * Math.sin(t + Math.PI / 2)) * dt
        break
      }
      case 'chick': {                                           // flappy wing-beat bob + occasional glide-dip
        const beat = (a.frame % CHICK_BOB_PERIOD) / CHICK_BOB_PERIOD
        const bob = CHICK_BOB_AMP * (-Math.cos(beat * Math.PI * 2) * 0.5 + 0.5)
        const glidePh = (a.frame % CHICK_GLIDE_PERIOD) / CHICK_GLIDE_PERIOD
        const dip = CHICK_GLIDE_DIP * Math.max(0, -Math.sin(glidePh * Math.PI * 2))
        a.y = ALIEN_Y + (CHICK_BOB_AMP * 0.5 - bob) + dip
        break
      }
      default: a.y = ALIEN_Y
    }
    a.x += dx
    if (a.x < ALIEN_W / 2) { a.x = ALIEN_W / 2; a.vx = Math.abs(a.vx) }
    else if (a.x > W - ALIEN_W / 2) { a.x = W - ALIEN_W / 2; a.vx = -Math.abs(a.vx) }
  }

  /** Sweep the carrier to the FAR side, bounce once, return, and leave on the near
   *  side if it was never shot (travel to one side and back before leaving). */
  #stepExtraLife(dt: number): void {
    if (this.freezeTimer > 0) return
    const c = this.extraLife
    if (!c) return
    c.t += dt
    c.x += c.vx * dt
    if (!c.bounced) {
      if (c.x <= EXTRALIFE_R || c.x >= W - EXTRALIFE_R) {     // reached the far side → turn back
        c.vx = -c.vx; c.bounced = true; c.x = clamp(c.x, EXTRALIFE_R, W - EXTRALIFE_R)
      }
    } else if (c.x < -EXTRALIFE_R * 2 || c.x > W + EXTRALIFE_R * 2) {   // returned and left — missed
      this.extraLife = null; this.#endHazard()
    }
  }

  /** Shoot the carrier → drop a 1-UP. */
  #hitExtraLife(): void {
    const c = this.extraLife
    if (!c) return
    this.explosions.push({ x: c.x, y: c.y, t: 0 })
    this.#dropPill(c.x, c.y + EXTRALIFE_R, 'extralife')
    this.#addScore(150)
    this.extraLife = null
    this.#endHazard()
  }

  /** A ball touching the carrier pops it (and bounces down). */
  #extraLifeBounce(b: Ball): void {
    const c = this.extraLife
    if (!c) return
    const dx = b.x - c.x, dy = b.y - c.y
    if (dx * dx + dy * dy > (EXTRALIFE_R + b.r) * (EXTRALIFE_R + b.r)) return
    b.vy = Math.abs(b.vy); b.y = c.y + EXTRALIFE_R + b.r + 1
    this.#hitExtraLife()
  }

  /** Shoot the ship down: explode, feed the combo, score, and DROP A PILL when hit
   *  (the alien is the dispenser) — but only while the wave budget has one loaded. */
  #destroyShip(): void {
    const a = this.alien
    if (!a) return
    this.explosions.push({ x: a.x, y: a.y, t: 0 })
    if (this.#waveBudget > 0 && this.#dropPill(a.x, a.y + ALIEN_H / 2, this.#dispensePower())) {
      this.#waveBudget--                                     // the alien dispenses a wave pill ONLY when hit
    }
    this.#bumpCombo(a.x, a.y)                               // the bonus ship feeds the combo (chain → points ×)
    this.#addScore(100)                                     // combo is expressed once, via pointsMul (no double-count)
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

  /** A hit on an enemy feeds the combo. */
  #countEnemyHit(x = W / 2, y = BRICK_TOP * 0.5): void {
    this.#bumpCombo(x, y)                              // hitting an enemy feeds the combo too
  }

  /** Mark the LAST brick standing as the level's finale beacon: it turns gold and
   *  pulses, so the final hit of a level is a target you can see coming. Purely a
   *  marker — it keeps its own hp and dies to anything, exactly like any other tile.
   *  Megas are skipped: shattering one refills the board with shards, so it is never
   *  really "the last brick". */
  #markFinalBrick(): void {
    if (this.#finaleFired || this.bricksLeft !== 1) return
    const last = this.bricks.find(b => b.alive && !b.seed && !b.mega)
    if (last) last.gold = true
  }

  /** The board just emptied → the FINALE. Fires once, and deliberately on the CLEAR
   *  rather than on the gold brick's death, so it still pays out when a rocket or a
   *  TNT blast wipes the last several tiles at once (those routes bypass #damage).
   *  Holds the win for FINALE_HOLD so the fireworks play on the live board. */
  #startFinale(): void {
    if (this.#finaleFired || this.bricksLeft > 0) return
    this.#finaleFired = true
    this.finaleTimer = FINALE_HOLD
    this.rushFlash = FINALE_FLASH
    this.#addScore(FINALE_JACKPOT)
    this.comboPops.push({ x: W / 2, y: H * 0.42, n: 0, pts: FINALE_JACKPOT, t: 0 })
    for (let i = 0; i < 10; i++) {
      this.explosions.push({ x: W / 2 + Math.cos(i * 0.63) * 78, y: H * 0.42 + Math.sin(i * 0.63) * 46, t: 0 })
    }
  }

  /** The level is won once the board is empty — but NOT while the finale fireworks
   *  are still playing, or the overlay would cut to its tally mid-burst. Every win
   *  check routes through here. */
  #checkWin(): void {
    if (this.bricksLeft === 0 && this.finaleTimer <= 0) this.state = 'won'
  }

  /** True while the finale is playing (renderer/overlay cue). */
  get finale(): boolean { return this.finaleTimer > 0 }

  /** Tick seed bloom timers; a ripe seed blooms into a mega brick. */
  #stepBricks(dt: number): void {
    for (const b of this.bricks) {
      if (b.seed && b.alive && b.bloom !== undefined) {
        b.bloom -= dt
        if (b.bloom <= 0) this.#bloomSeed(b)
      }
    }
  }

  /** Grow a seed into a big brick over an MEGA_COLS×MEGA_ROWS block. */
  #bloomSeed(seed: Brick): void {
    const c0 = clamp((seed.col ?? 0) - Math.floor(MEGA_COLS / 2), 0, Math.max(0, COLS - MEGA_COLS))
    const r0 = clamp(seed.row ?? 0, 0, Math.max(0, this.#levelRows - MEGA_ROWS))
    this.#createMega(c0, r0)
  }

  /** Build the big gold brick over the MEGA_COLS×MEGA_ROWS block at (c0,r0),
   *  covering (consuming) any bricks inside the footprint and ejecting any ball
   *  caught within it. */
  #createMega(c0: number, r0: number): Brick {
    const cols = MEGA_COLS, rows = MEGA_ROWS
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
    const mega: Brick = {
      x: mx, y: my, w: mw, h: mh,
      hp: MEGA_HP, max: MEGA_HP, alive: true,
      mega: true, col: c0, row: r0, megaCols: cols, megaRows: rows,
    }
    this.bricks.push(mega)
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
    return mega
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
    this.#paddleBaseW = PADDLE_W
    this.paddle.w = PADDLE_W
    // The ball re-sticks at its set position ON the paddle (#launchOffset), handled by
    // the stuck-ball step; the paddle itself just stays put, clamped to the screen.
    this.paddle.x = clamp(this.paddle.x, PADDLE_W / 2, W - PADDLE_W / 2)
    this.#prevPaddleX = this.paddle.x
    this.balls = [this.#stuckBall()]
    this.capsules = []
    this.fireballs = []
    this.rockets = []
    this.explosions = []
    this.enemies = []
    this.extraLife = null
    this.bumpers = []
    this.pinballProps = []
    this.flipLeftRaise = this.flipRightRaise = 0
    this.#flipLDown = this.#flipRDown = false
    this.#flipLVel = this.#flipRVel = 0
    this.#clearTurrets()
    this.paddleHitFlash = 0
    this.paddleHp = PADDLE_MAX_HP                  // a fresh bat at full health
    this.shieldHp = this.shieldFlash = 0; this.regenShield = false
    this.tnt = null
    this.#tntTimer = TNT_FIRST
    this.rushFlash = 0                             // a death clears the finale's flash (the finale itself can't be running — the board was clear)
    this.pacman = null
    this.#activeHazard = 'none'
    this.#hazardCooldown = 0
    this.#colorBallTimer = 0
    this.#pillPhase = 'quiet'
    this.#pillClock = 0
    this.#waveBudget = 0
    this.pillMul = Math.max(1, this.pillMul / 2)   // PILLS axis: a death HALVES your collection (no-op on a fresh load)
    this.freezeTimer = 0
    this.ballchainTimer = 0
    this.chainBall = null
    this.ballchainKills = 0
    this.#chainBonusPaid = false
    this.#chainAngle = this.#chainAngVel = 0
    this.combo = 0
    this.comboPops = []
    this.pickups = []
    this.#levelClock = 0
    this.expandTimer = this.magnetTimer = this.burstTimer = this.pierceTimer = 0
    this.pinball = false                           // a death ends the pinball machine — back to the bat
    this.scrambleTimer = this.scrambleLevel = 0
    this.beamShots = this.beamLevel = this.beamCharge = this.beamFlash = 0
    this.laserShots = this.laserLevel = this.laserCharge = this.laserMuzzleFlash = 0; this.laserCharging = false; this.fireballs = []
    this.oscillateStacks = 0                       // the AMP resets with the round — a death costs you the whole ladder
    // …and so do the loader/pool sizes it had scaled up, or the HUD bars would keep
    // dividing by an amped denominator the next life never granted.
    this.#gunLoader = GUN_LOADER
    this.#beamLoader = BEAM_LOADER
    this.#laserLoader = LASER_LOADER
    this.#rocketMax = ROCKET_MAX
    this.#shieldMax = SHIELD_MAX_HP
    this.#scrambleDur = SCRAMBLE_DURS[0]
    this.#clockDur = CLOCK_DURATION
    this.#ballchainDur = BALLCHAIN_DURATION
    this.goldBonus = this.goldTimer = 0
    this.milestoneFx = null; this.scoreFlash = 0
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

  /** THE AMP — the oscillator's force multiplier on every OTHER power-up.
   *  0 stacks → 1 (un-amped), 1 → 2 (double), 2 → 3 (triple), 3+ → 4 (quadruple).
   *  Every grant site in #applyPower multiplies by this, so one green mushroom
   *  turns the whole kit up a notch. Capped at AMP_MAX — it scales ammo counts,
   *  blast radii, ball caps and durations, none of which may run away. */
  get amp(): number { return Math.min(AMP_MAX, 1 + this.oscillateStacks) }

  /** On-screen ball cap — amped, so a quadrupled Break really is a ball storm. */
  get maxBalls(): number { return MAX_BALLS * this.amp }

  /** Life ceiling — amped (5 → 10 → 15 → 20). Extra lives are an effect like any
   *  other, so the amp has to lift the CEILING too: a quadrupled 1-UP that pays +4
   *  into a cap of 5 would hand back nothing. Every "can you still earn a life?"
   *  gate reads this — the carrier spawn, the 1-UP pill roll, the combo milestone.
   *  Only GAINS are gated: a death drops the amp back to 1 without ever clipping
   *  lives you already banked. */
  get maxLives(): number { return MAX_LIVES * this.amp }

  /** Active powers for the HUD badge row (kind, 0..1 bar, label). The gun is NOT
   *  here — it renders its own pip magazine (see gunActive). */
  get activePowers(): { kind: PowerKind; frac: number; label: string }[] {
    const out: { kind: PowerKind; frac: number; label: string }[] = []
    const addTimed = (kind: PowerKind, t: number, dur: number) => {
      if (t > 0) out.push({ kind, frac: clamp(t / dur, 0, 1), label: `${Math.ceil(t)}s` })
    }
    // Oscillate is permanent (no countdown): the badge reports the AMP the whole kit
    // is running at, which is the number the player actually plays around.
    if (this.oscillateStacks > 0) out.push({ kind: 'oscillate', frac: 1, label: `AMP×${this.amp}` })
    addTimed('expand', this.expandTimer, EXPAND_DURATION)
    addTimed('magnet', this.magnetTimer, MAGNET_DURATION)
    addTimed('burst', this.burstTimer, BURST_DURATION)
    if (this.pinball) out.push({ kind: 'pinball', frac: 1, label: 'ON' })   // a mode, not a countdown — it runs till the level ends or you die
    addTimed('clock', this.freezeTimer, this.#clockDur)
    addTimed('pierce', this.pierceTimer, PIERCE_DURATION)
    if (this.scrambleTimer > 0) out.push({ kind: 'scramble', frac: clamp(this.scrambleTimer / this.#scrambleDur, 0, 1), label: `${Math.ceil(this.scrambleTimer)}s` })
    // The shield bar is its STRENGTH, not a clock — it only empties when shots chip it.
    if (this.shieldHp > 0) {
      out.push({ kind: this.regenShield ? 'regen' : 'shield', frac: this.shieldHpFrac, label: `${Math.ceil(this.shieldHpFrac * 100)}%` })
    }
    if (this.ballchainTimer > 0) out.push({ kind: 'ballchain', frac: clamp(this.ballchainTimer / this.#ballchainDur, 0, 1), label: `${this.ballchainKills}/${CHAIN_BONUS_PILLS}` })
    // The ammo bars divide by the loader that was actually granted (amped at pickup),
    // not the base constant — otherwise an amped loader pins the bar at full.
    if (this.beamShots > 0) {
      const lvl = this.beamLevel >= 2 ? `L${this.beamLevel}` : ''
      out.push({ kind: 'beam', frac: clamp(this.beamShots / this.#beamLoader, 0, 1), label: `${lvl}×${this.beamShots}` })
    }
    if (this.laserShots > 0) {
      const lvl = this.laserLevel >= 2 ? `L${this.laserLevel}` : ''
      out.push({ kind: 'laser', frac: clamp(this.laserShots / this.#laserLoader, 0, 1), label: `${lvl}×${this.laserShots}` })
    }
    if (this.rocketAmmo > 0 || this.rockets.length > 0) {
      out.push({ kind: 'rocket', frac: clamp(this.rocketAmmo / this.#rocketMax, 0, 1), label: `×${this.rocketAmmo}` })
    }
    return out
  }

  get gunActive(): boolean { return this.gunAmmo > 0 }
  /** Pips to draw in the magazine — the loader as GRANTED (amped), so the row
   *  always matches the ammo actually loaded. */
  get gunLoaderSize(): number { return this.#gunLoader }
  /** Shielded while a plain or healing shield is up AND still has strength left. */
  get shielded(): boolean { return this.shieldHp > 0 }
  /** 0..1 remaining shield strength (for the dome / depletion read), against the
   *  pool as GRANTED — an amped shield starts full and depletes over more hits. */
  get shieldHpFrac(): number { return clamp(this.shieldHp / this.#shieldMax, 0, 1) }
  /** 0..1 paddle health (for the bar). */
  get paddleHpFrac(): number { return clamp(this.paddleHp / PADDLE_MAX_HP, 0, 1) }
  /** 0..1 charge progress of the beam (purple mushroom), for the renderer. */
  get beamChargeFrac(): number { return this.beamShots > 0 ? clamp(this.beamCharge / this.beamTarget, 0, 1) : 0 }
  /** 0..1 fade of the beam's release flash, for the renderer. */
  get beamFlashFrac(): number { return clamp(this.beamFlash / BEAM_FLASH, 0, 1) }
  /** Hold-charge progress (0..1) of the fireball cannon, for the muzzle orb. */
  get laserChargeFrac(): number { return this.laserShots > 0 && this.laserCharging ? clamp(this.laserCharge / LASER_CHARGE_FULL, 0, 1) : 0 }
  /** 0..1 fade of the launch kick-flash at the bat. */
  get laserMuzzleFrac(): number { return clamp(this.laserMuzzleFlash / LASER_MUZZLE_FLASH, 0, 1) }
  /** Current charge tier (0 = no cannon), so the renderer can colour the orb. */
  get laserTier(): 0 | 1 | 2 | 3 { return this.laserShots > 0 ? this.#tierFor(this.laserCharge) : 0 }
  /** Hold-time → tier. Single source of truth for the tier mapping. */
  #tierFor(charge: number): 1 | 2 | 3 { return charge >= LASER_TIER3_AT ? 3 : charge >= LASER_TIER2_AT ? 2 : 1 }
  /** 0..1 fade of the paddle's red flash after a turret shot lands, for the renderer. */
  get paddleHitFlashFrac(): number { return clamp(this.paddleHitFlash / PADDLE_HIT_FLASH, 0, 1) }

  // ── input ────────────────────────────────────────────────
  movePaddleTo(worldX: number): void { this.#pointerX = worldX }

  /** The ball's set position ON the paddle — offset from paddle centre (for overlay reuse). */
  get launchOffset(): number { return this.#launchOffset }
  /** The still-ball anchor + slide range for the aim hint. */
  get aimAnchorX(): number { return AIM_ANCHOR }
  get aimRange(): number { return AIM_RANGE }

  /** One-time aim (the very first start of a game): the ball hangs still at centre
   *  while you slide the PADDLE under it (±25% of paddle width) to choose where on the
   *  paddle the ball sits. The FIRST click SETS that on-paddle spot and UNLOCKS the
   *  paddle (full range) — the ball stays stuck, so you can move around and then LAUNCH
   *  (shoot) whenever you want. The offset is reused for the whole game. */
  aimClick(): void {
    if (!this.aiming || this.state !== 'playing') return
    this.#launchOffset = clamp(AIM_ANCHOR - this.paddle.x, -AIM_RANGE, AIM_RANGE)   // set the ball position on the paddle
    this.aiming = false                                                            // unlock the paddle; ball stays stuck — launch any time
  }

  /** Pin the on-paddle position set by the first aim — skips aim on later levels/restarts. */
  pinLaunchOffset(offset: number): void {
    this.#launchOffset = clamp(offset, -AIM_RANGE, AIM_RANGE)
    this.aiming = false
    for (const b of this.balls) if (b.stuck) { b.x = this.paddle.x + this.#launchOffset; b.y = this.paddle.y - b.r - 1 }
  }

  /** Space / left-click: launch stuck balls, else fire gun + laser if armed.
   *  (The missile is on right-click — see fireRocket.) */
  shoot(): void {
    if (this.state !== 'playing' || this.aiming) return
    let launched = false
    for (const b of this.balls) {
      if (!b.stuck) continue
      this.#launchBall(b)
      launched = true
    }
    if (launched) return
    if (this.gunAmmo > 0) this.#fireGun()
  }

  /** PRESS: begin a fresh hold-charge of the fireball cannon (called once per press;
   *  the overlay latches key-repeat). No-op if no cannon, aiming, or already charging. */
  startLaserCharge(): void {
    if (this.laserCharging) return
    if (this.state !== 'playing' || this.aiming || this.laserShots <= 0 || this.#laserCd > 0) return
    this.laserCharging = true
    this.laserCharge = 0
  }

  /** RELEASE: launch the charged fireball (tier by hold time). Releasing with no
   *  shots just cancels the hold. */
  releaseLaser(): void {
    if (!this.laserCharging) return
    this.laserCharging = false
    if (this.laserShots > 0) this.#fireFireball()
    this.laserCharge = 0
  }

  /** Right-click: launch the one missile if you have it and none is airborne.
   *  It flies up and explodes on the first thing it hits. */
  fireRocket(): void {
    // Amped, up to `amp` missiles may be in the air at once (at amp 1: the original
    // one-at-a-time rule). Still no manual detonate — each blows on what it hits.
    if (this.state !== 'playing' || this.rocketAmmo <= 0 || this.rockets.length >= this.amp) return
    this.rocketAmmo--
    this.rockets.push({ x: this.paddle.x, y: this.paddle.y - 8, vy: -ROCKET_SPEED })
  }

  /** Blast every alive brick within ROCKET_RADIUS of the rocket and leave a
   *  visual shock-ring. Does NOT remove the rocket — the caller owns that. */
  #detonateRocket(rk: Rocket): void {
    // Amped: up to a 4× blast. The radius rides ON the explosion record so the shock
    // ring the renderer draws is the blast that actually happened, not the constant.
    const radius = ROCKET_RADIUS * this.amp
    this.explosions.push({ x: rk.x, y: rk.y, t: 0, r: radius })
    // Snapshot: #breakMega appends shards, which must NOT be caught by this blast.
    for (const brick of [...this.bricks]) {
      if (!brick.alive || brick.seed) continue            // seeds are immune until they bloom
      const bxc = brick.x + brick.w / 2, byc = brick.y + brick.h / 2
      if (Math.hypot(bxc - rk.x, byc - rk.y) > radius) continue
      if (brick.mega) { brick.alive = false; this.#breakMega(brick); continue }   // shatter, don't vaporise
      brick.alive = false
      brick.hp = 0
      this.#addScore(25)
      if (brick.drop) this.#dropPill(bxc, byc, brick.drop)
      else if (Math.random() < DROP_CHANCE) this.#dropPill(bxc, byc, this.#randomPower())
    }
    // A rocket caught in the blast also blows the ship out of the sky.
    if (this.alien && Math.hypot(this.alien.x - rk.x, this.alien.y - rk.y) <= radius) this.#destroyShip()
    if (this.extraLife && Math.hypot(this.extraLife.x - rk.x, this.extraLife.y - rk.y) <= radius) this.#hitExtraLife()
    this.#blastEnemies(rk.x, rk.y, radius)     // the rocket vaporises any enemies in the blast
    if (this.pacman && Math.hypot(this.pacman.x - rk.x, this.pacman.y - rk.y) <= radius) this.#killPacman()
    this.#checkWin()
  }

  #launchBall(b: Ball): void {
    b.stuck = false
    // The ball's set position ON the paddle sets the launch angle — centre is the
    // pivot (straight up); the further off-centre it sits, the more it angles that way.
    const theta = clamp(this.#launchOffset / AIM_RANGE, -1, 1) * LAUNCH_MAX_ANGLE
    const speed = BALL_SPEED * this.difficulty.ballSpeedMul          // difficulty scales the launch speed
    b.vx = speed * Math.sin(theta)
    b.vy = -speed * Math.cos(theta)
  }

  #fireGun(): void {
    if (this.gunAmmo <= 0 || this.#gunCd > 0 || this.balls.length >= this.maxBalls) return
    this.#gunCd = GUN_COOLDOWN
    this.gunAmmo--                         // one shot out of the loader
    const a = this.aimAngle, level = this.gunLevel
    // Magazine empty → the gun FULLY disappears: clear the stack level + recentre the
    // aim so no gun state (aim arc, diagonals, pips) lingers once the balls run out.
    // The current (last) volley still fires at the captured `level`.
    if (this.gunAmmo <= 0) { this.gunLevel = 0; this.aimAngle = GUN_AIM_CENTER }
    // Volley by stack level: L1 single, L2 adds two diagonals, L3 doubles each.
    const dirs = level >= 2 ? [a, a - GUN_DIAG_SPREAD, a + GUN_DIAG_SPREAD] : [a]
    const split = level >= 3 ? [-GUN_DOUBLE_JITTER, GUN_DOUBLE_JITTER] : [0]
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
    if (this.balls.length >= this.maxBalls) return false
    const r = BALL_R + 4
    this.balls.push(this.#newBall(
      this.paddle.x + Math.cos(ang) * r,
      this.paddle.y - 2 + Math.sin(ang) * r,
      Math.cos(ang) * BALL_SPEED,
      Math.sin(ang) * BALL_SPEED,
    ))
    return true
  }

  /** Launch one fireball straight up from the bat muzzle, tier set by hold time.
   *  Stats are snapshotted so a later level-up never retro-buffs this orb. */
  #fireFireball(): void {
    if (this.laserShots <= 0 || this.#laserCd > 0) return
    this.#laserCd = LASER_FIRE_CD
    this.laserShots--
    const tier = this.#tierFor(this.laserCharge)
    const i = tier - 1
    // Amped at LAUNCH — consistent with the tier snapshot above: an orb already in
    // flight is never retro-buffed, but the next one you throw carries the new amp.
    // Bite (dmg/aoe/pierce) scales fully; the orb's size is scaled more gently so a
    // quadrupled Hadouken reads bigger without swallowing the board.
    const amp = this.amp
    const bulk = 1 + (amp - 1) * 0.5
    this.fireballs.push({
      x: this.paddle.x, y: this.paddle.y - 10, vy: -FIREBALL_SPEED,
      tier, dmg: FIREBALL_DMG[i] * amp, aoe: FIREBALL_AOE[i] * amp, pierce: FIREBALL_PIERCE[i] * amp,
      r: FIREBALL_R[i] * bulk, tail: FIREBALL_TAIL[i] * bulk,
      spin: 0, hit: new Set(), t: 0,
    })
    this.laserMuzzleFlash = LASER_MUZZLE_FLASH
    if (this.laserShots === 0) this.laserLevel = 0          // loader empty → level resets
  }

  // ── per-frame update ─────────────────────────────────────
  update(dt: number): void {
    if (this.state !== 'playing') return
    this.#tickPowers(dt)
    this.#movePaddle(dt)
    this.#stepFlippers(dt)
    if (this.#laserCd > 0) this.#laserCd = Math.max(0, this.#laserCd - dt)
    if (this.#gunCd > 0) this.#gunCd = Math.max(0, this.#gunCd - dt)

    for (const b of this.balls) {
      if (b.stuck) { b.x = this.aiming ? AIM_ANCHOR : this.paddle.x + this.#launchOffset; b.y = this.paddle.y - b.r - 1; continue }
      if (this.freezeTimer > 0 && b.primary) continue   // clock: white ball frozen in place
      // Sub-step so a fast ball can't tunnel through a brick or the paddle. Fold
      // in the weave's peak lateral speed (amp × freq) so a wide/aggressive
      // oscillation also gets enough sub-steps to stay collision-safe.
      const weaveV = this.oscillateStacks > 0 ? this.#wobbleAmp() * WOBBLE_FREQ * this.difficulty.oscAggroMul : 0
      const dist = (Math.hypot(b.vx, b.vy) + weaveV) * dt
      const steps = Math.max(1, Math.ceil(dist / (b.r * 0.9)))
      const sdt = dt / steps
      for (let i = 0; i < steps && this.state === 'playing'; i++) this.#step(b, sdt)
    }

    // Drop balls that fell past the floor. The WHITE (primary) ball is your
    // life: lose it and a life is gone even while coloured ammo balls are still
    // in play — they clear bricks but never save you. (No primary remaining also
    // covers the plain case of every ball being gone.)
    this.balls = this.balls.filter(b => b.y - b.r <= H)
    // …EXCEPT during the finale: the board is already clear, so a ball draining
    // through the fireworks must not cost a life on a level you just won. Guarded
    // here rather than inside #loseLife because this branch RETURNS — a no-op
    // #loseLife would skip the finale tick below and the win would never land.
    if (!this.balls.some(b => b.primary) && this.finaleTimer <= 0) { this.#loseLife(); return }

    this.#stepPillWaves(dt)
    this.#stepCapsules(dt)
    this.#stepFireballs(dt)
    this.#stepTurrets(dt)
    this.#stepPinballProps(dt)
    this.#stepTnt(dt)
    this.#stepRockets(dt)
    this.#stepExplosions(dt)
    this.#stepEnemy(dt)
    this.#stepPacman(dt)
    this.#stepBallChain(dt)
    this.#stepBricks(dt)
    this.#stepAlien(dt)
    this.#stepExtraLife(dt)
    if (this.comboPops.length) { for (const p of this.comboPops) p.t += dt; this.comboPops = this.comboPops.filter(p => p.t < COMBO_POP_DUR) }
    if (this.milestoneFx) { this.milestoneFx.t += dt; if (this.milestoneFx.t > 1.1) this.milestoneFx = null }   // milestone eruption runs ~1.1s
    if (this.scoreFlash > 0) this.scoreFlash = Math.max(0, this.scoreFlash - dt)
    this.#markFinalBrick()                                              // down to one → light the finale beacon
    if (this.bricksLeft === 0) this.#startFinale()                      // board clear → fireworks (holds the win)
    if (this.finaleTimer > 0) this.finaleTimer = Math.max(0, this.finaleTimer - dt)
    if (this.pickups.length) { for (const p of this.pickups) p.t += dt; this.pickups = this.pickups.filter(p => p.t < PICKUP_DUR) }
    this.#checkWin()
  }

  #spawnEnemy(): void {
    const kind = ENEMY_KINDS[Math.floor(Math.random() * ENEMY_KINDS.length)]
    const e: Enemy = { x: W * (0.25 + Math.random() * 0.5), y: BRICK_TOP * 0.7, hp: ENEMY_HP_BY_KIND[kind], variant: ENEMY_KINDS.indexOf(kind), kind }
    const sgn = () => (Math.random() < 0.5 ? -1 : 1)
    switch (kind) {
      case 'bomber': e.vx = sgn(); e.cd = 1.8; e.y = BRICK_TOP * 0.8; break
      case 'mirror': e.cd = 2.2; e.y = BRICK_TOP; break
      case 'splitter': e.vx = sgn() * 60; e.vy = sgn() * 42; e.split = 0; break
      case 'leech': e.t = 0; e.ax = W / 2; e.ay = BRICK_TOP + 60; e.eaten = 0; break
      case 'orbit': e.t = 0; e.ax = e.x; e.ay = e.y; e.cd = 0; break
      case 'dart': e.phase = 'patrol'; e.vx = sgn() * 70; e.vy = 0; e.cd = 2.5 + Math.random() * 1.5; e.ay = e.y; break
      case 'blink': e.phase = 'idle'; e.cd = 1.4; e.ghostX = e.x; e.ghostY = e.y; e.flash = 0; break
      case 'polarity': e.polarity = sgn() < 0 ? 'blue' : 'red'; e.cd = 3; e.vx = sgn(); e.flash = 0; e.y = BRICK_TOP * 0.9; break
      case 'queen': e.cd = 4; e.brood = []; break
    }
    this.enemies.push(e)                                    // a swarm member (no longer a single hazard slot)
  }

  /** Swarm size cap by level: 1 early, 2 by level ~30, 3 by ~60. Harder = more enemies. */
  #enemyCap(): number { return 1 + (this.levelIndex >= 30 ? 1 : 0) + (this.levelIndex >= 60 ? 1 : 0) + this.difficulty.enemyCapBonus }

  /** Ten enemy kinds, each its own motion + threat. The swarm fills to its level cap —
   *  the first after a long dawdle, refills on a short gap. Per-kind move + contact. */
  #stepEnemy(dt: number): void {
    if (this.freezeTimer > 0) return                  // clock: enemies frozen
    if (this.enemies.length < this.#enemyCap() && this.bricksLeft > 0) {
      this.#levelClock += dt
      const delay = (this.enemies.length === 0 ? ENEMY_SPAWN_DELAY : ENEMY_REFILL_GAP) * this.difficulty.enemyRefillMul
      if (this.#levelClock >= delay) { this.#spawnEnemy(); this.#levelClock = 0 }
    }
    // The swarm keeps ONE cadence all level. (It used to go berserk below 12 bricks —
    // move and fire both ramping up — which made the run-in to a clear the most
    // punishing stretch of the level. The end is a victory lap now; see the FINALE.)
    for (const e of [...this.enemies]) {              // snapshot: a contact can remove an enemy mid-pass
      this.#enemyMove(e, dt)
      this.#enemyContact(e)
    }
  }

  /** Per-kind movement + special (bombs, brood, pill-theft, dive, teleport, flip). */
  #enemyMove(e: Enemy, dt: number): void {
    const white = this.balls.find(b => b.primary && !b.stuck)
    if (e.flash && e.flash > 0) e.flash = Math.max(0, e.flash - dt * 3)
    switch (e.kind) {
      case 'hunter': case 'queen': {
        const spd = e.kind === 'queen' ? 70 : ENEMY_SPEED
        if (white) { const dx = white.x - e.x, dy = white.y - e.y, d = Math.hypot(dx, dy) || 1; e.x += (dx / d) * spd * dt; e.y += (dy / d) * spd * dt }
        if (e.kind === 'queen') {
          e.cd = (e.cd ?? 4) - dt
          if (e.cd <= 0 && (e.brood?.length ?? 0) < 2) { e.cd = 4; e.flash = 1; (e.brood ??= []).push({ x: e.x, y: e.y + 12, vx: (Math.random() - 0.5) * 130, vy: 120 }) }
          if (e.brood) {
            for (const m of e.brood) { m.x += m.vx * dt; m.y += m.vy * dt }
            e.brood = e.brood.filter(m => m.y <= H + 20 && !this.balls.some(b => !b.stuck && Math.hypot(b.x - m.x, b.y - m.y) < b.r + 5))   // ball pops a broodling
          }
        }
        break
      }
      case 'bomber': {
        e.x += (e.vx ?? 1) * 70 * dt
        if (e.x < ENEMY_R + 30) { e.x = ENEMY_R + 30; e.vx = 1 } else if (e.x > W - ENEMY_R - 30) { e.x = W - ENEMY_R - 30; e.vx = -1 }
        e.cd = (e.cd ?? 1.8) - dt
        if (e.cd <= 0) {
          e.cd = 1.8 * this.difficulty.enemyFireMul                                // difficulty scales fire rate
          if (Math.random() < 0.3) this.turretShots.push({ x: e.x, y: e.y + 10, vx: 0, vy: 110, kind: 'seeker', t: 0 })   // a homing seeker
          else { const dx = clamp(this.paddle.x - e.x, -160, 160); this.turretShots.push({ x: e.x, y: e.y + 10, vx: dx * 0.45, vy: 130, kind: 'bomb', t: 0 }) }   // a lobbed bomb
        }
        break
      }
      case 'mirror': {
        e.x += clamp((W - this.paddle.x) - e.x, -200 * dt, 200 * dt)             // mirrors the bat (lagged)
        e.cd = (e.cd ?? 2.2) - dt
        if (e.cd <= 0) { e.cd = 2.2 * this.difficulty.enemyFireMul; e.flash = 1; this.turretShots.push({ x: e.x, y: e.y + 8, vx: 0, vy: 340, kind: 'bolt', t: 0 }) }   // a fast energy bolt
        break
      }
      case 'splitter': {
        e.x += (e.vx ?? 0) * dt; e.y += (e.vy ?? 0) * dt                         // DVD drift
        if (e.x < ENEMY_R + 20 || e.x > W - ENEMY_R - 20) { e.vx = -(e.vx ?? 0); e.x = clamp(e.x, ENEMY_R + 20, W - ENEMY_R - 20) }
        const lo = BRICK_TOP * 0.4, hi = H * 0.55
        if (e.y < lo || e.y > hi) { e.vy = -(e.vy ?? 0); e.y = clamp(e.y, lo, hi) }
        break
      }
      case 'leech': {
        e.t = (e.t ?? 0) + dt                                                    // figure-eight swoop
        e.x = clamp((e.ax ?? W / 2) + Math.sin(e.t * 1.2) * 120, ENEMY_R, W - ENEMY_R)
        e.y = clamp((e.ay ?? BRICK_TOP + 60) + Math.sin(e.t * 2.4) * 70, BRICK_TOP * 0.3, H * 0.6)
        for (let i = this.capsules.length - 1; i >= 0; i--) {                    // swallow a falling pill
          const c = this.capsules[i]
          if ((c.delay ?? 0) > 0) continue
          if (Math.hypot(c.x - e.x, c.y - e.y) < ENEMY_R + 8) { this.capsules.splice(i, 1); e.eaten = (e.eaten ?? 0) + 1; e.flash = 1; break }
        }
        break
      }
      case 'orbit': {
        e.t = (e.t ?? 0) + dt
        e.cd = (e.cd ?? 0) - dt
        if (e.cd <= 0) { const live = this.bricks.filter(b => b.alive && !b.seed); const pick = live.length ? live[Math.floor(Math.random() * live.length)] : null; if (pick) { e.ax = pick.x + pick.w / 2; e.ay = pick.y + pick.h / 2 } e.cd = 5 }
        e.x = (e.ax ?? e.x) + Math.cos(e.t * 2) * 14
        e.y = (e.ay ?? e.y) + Math.sin(e.t * 2) * 14
        break
      }
      case 'dart': {
        if (e.phase === 'patrol') {
          e.x += (e.vx ?? 70) * dt
          if (e.x < ENEMY_R + 24 || e.x > W - ENEMY_R - 24) { e.vx = -(e.vx ?? 0); e.x = clamp(e.x, ENEMY_R + 24, W - ENEMY_R - 24) }
          e.cd = (e.cd ?? 2.5) - dt
          if (e.cd <= 0) { e.phase = 'dive'; e.vy = 260; e.vx = clamp((white?.x ?? e.x) - e.x, -180, 180) }   // commit to the ball's CURRENT x
        } else if (e.phase === 'dive') {
          e.x += (e.vx ?? 0) * dt; e.y += (e.vy ?? 0) * dt
          if (e.y > H * 0.7) { e.phase = 'retreat'; e.vy = -200 }
        } else {
          e.y += (e.vy ?? -200) * dt
          if (e.y <= (e.ay ?? BRICK_TOP)) { e.y = e.ay ?? BRICK_TOP; e.phase = 'patrol'; e.vx = (Math.random() < 0.5 ? -1 : 1) * 70; e.cd = 2.5 + Math.random() * 1.5 }
        }
        break
      }
      case 'blink': {
        e.cd = (e.cd ?? 1.4) - dt
        if (e.phase === 'idle') {
          if (e.cd <= 0.3 && e.ax === undefined) {                              // telegraph the destination
            const bias = white ? 0.6 : 0
            e.ax = clamp(white ? e.x + (white.x - e.x) * bias : Math.random() * W, ENEMY_R, W - ENEMY_R)
            e.ay = clamp(BRICK_TOP + Math.random() * H * 0.35, BRICK_TOP * 0.3, H * 0.45)
          }
          if (e.cd <= 0) { e.phase = 'out'; e.cd = 0.3 }
        } else if (e.phase === 'out') {
          if (e.cd <= 0) {
            e.ghostX = e.x; e.ghostY = e.y
            e.x = e.ax ?? e.x; e.y = e.ay ?? e.y; e.ax = undefined; e.ay = undefined
            e.phase = 'in'; e.cd = 0.3; e.flash = 1
            if (white && Math.hypot(white.x - e.x, white.y - e.y) < 44) {        // landed on the ball → whack it
              const dx = white.x - e.x, dy = white.y - e.y, d = Math.hypot(dx, dy) || 1
              white.vx = (dx / d) * BALL_SPEED_MAX; white.vy = (dy / d) * BALL_SPEED_MAX
            }
          }
        } else if (e.cd <= 0) { e.phase = 'idle'; e.cd = 1.4 }
        break
      }
      case 'polarity': {
        e.x += (e.vx ?? 1) * 55 * dt                                             // invader march
        if (e.x < ENEMY_R + 20 || e.x > W - ENEMY_R - 20) { e.vx = -(e.vx ?? 1); e.x = clamp(e.x, ENEMY_R + 20, W - ENEMY_R - 20); e.y += BRICK_H * 0.5 }
        e.cd = (e.cd ?? 3) - dt
        if (e.cd <= 0) { e.cd = 3; e.polarity = e.polarity === 'blue' ? 'red' : 'blue'; e.flash = 1 }   // flip armour
        break
      }
    }
  }

  /** Per-kind contact: melee kinds whack the white ball; the rest bounce it like a
   *  bumper. Polarity is TYPE-GATED (white hurts only RED, colour only BLUE); mirror
   *  denies (bounce, no chip). Colour ammo ricochets + chips; lasers always chip. */
  #enemyContact(e: Enemy): void {
    const melee = e.kind === 'hunter' || e.kind === 'queen' || (e.kind === 'dart' && e.phase === 'dive')
    for (const b of this.balls) {
      if (b.stuck) continue
      const dx = b.x - e.x, dy = b.y - e.y, d = Math.hypot(dx, dy)
      if (d > ENEMY_R + b.r) continue
      const nd = d || 1
      if (b.primary && melee) {
        b.vx = (dx / nd) * BALL_SPEED_MAX; b.vy = (dy / nd) * BALL_SPEED_MAX     // whacked away, fast
        b.x = e.x + (dx / nd) * (ENEMY_R + b.r + 1); b.y = e.y + (dy / nd) * (ENEMY_R + b.r + 1)
        if (this.#hurtEnemy(e)) return
        continue
      }
      const sp = Math.hypot(b.vx, b.vy) || BALL_SPEED                            // otherwise it BOUNCES (bumper)
      b.vx = (dx / nd) * sp; b.vy = (dy / nd) * sp
      b.x = e.x + (dx / nd) * (ENEMY_R + b.r + 1); b.y = e.y + (dy / nd) * (ENEMY_R + b.r + 1)
      if (e.kind === 'splitter' && (e.split ?? 0) < 1) e.split = 1              // first hit cracks the pod
      let chip = e.kind !== 'mirror'                                            // mirror is a pure deny-wall (no chip)
      if (e.kind === 'polarity') chip = b.primary ? e.polarity === 'red' : e.polarity === 'blue'   // wrong type wasted
      if (chip && this.#hurtEnemy(e)) return
    }
    // (Fireballs hit enemies in #stepFireballs — no laser branch here anymore.)
  }

  /** Damage the enemy; returns true once it dies. The Leech coughs up a pill it ate. */
  #hurtEnemy(e: Enemy): boolean {
    this.#countEnemyHit(e.x, e.y)                     // every 5th hit earns a mega seed; feeds the combo at e
    e.hp--
    this.#addScore(15)
    if (e.hp <= 0) { this.#killEnemy(e); return true }
    return false
  }

  /** Remove one enemy from the swarm with its death FX + bounty (the Leech coughs up
   *  a pill it ate). Used by ball/laser kills and by AoE (rocket / ball-chain / TNT). */
  #killEnemy(e: Enemy): void {
    const i = this.enemies.indexOf(e)
    if (i < 0) return                                 // already gone (e.g. two AoE sources same frame)
    this.enemies.splice(i, 1)
    this.explosions.push({ x: e.x, y: e.y, t: 0 })
    if (e.kind === 'leech' && (e.eaten ?? 0) > 0) this.capsules.push({ x: e.x, y: e.y, kind: this.#randomPower() })   // regurgitate loot
    this.#levelClock = 0                              // pace the next swarm member
    this.#addScore(150)
  }

  /** AoE: kill every enemy within `r` of (x,y). Returns true if any died. */
  #blastEnemies(x: number, y: number, r: number): boolean {
    let any = false
    for (const e of [...this.enemies]) {
      if (Math.hypot(e.x - x, e.y - y) <= r) { this.#countEnemyHit(e.x, e.y); this.#killEnemy(e); any = true }
    }
    return any
  }

  /** The pill-wave clock no longer drops pills itself — it just RELOADS the alien's
   *  dispenser (#waveBudget) each wave. Pills are released only by HITTING the alien
   *  (see #destroyShip). Paused while frozen or once the board is cleared. */
  #stepPillWaves(dt: number): void {
    if (this.freezeTimer > 0 || this.bricksLeft === 0) return
    this.#pillClock += dt
    if (this.#pillPhase === 'quiet') {
      if (this.#pillClock >= this.#pillQuiet) {   // mayhem shortens the calm AND fattens the wave
        this.#pillPhase = 'wave'; this.#pillClock = 0; this.#waveBudget = Math.round(PILLS_PER_WAVE * this.difficulty.mayhemMul)
      }
    } else if (this.#pillClock >= PILL_WAVE) {
      this.#pillPhase = 'quiet'; this.#pillClock = 0
    }
  }

  /** Seconds of calm between pill waves — shortened by the difficulty's mayhem. */
  get #pillQuiet(): number { return PILL_QUIET / this.difficulty.mayhemMul }

  /** True in the last ~1.2s before a wave opens — the renderer can telegraph it. */
  get pillWaveArming(): boolean { return this.#pillPhase === 'quiet' && this.#pillClock >= this.#pillQuiet - 1.2 }

  /** Pac-Man: a comedic ammo-economy rival. Summoned when colour balls linger; it
   *  homes and EATS only colour balls (never the white one), is immune to colour
   *  balls, and is killed by the white ball / weapons. A director-gated hazard. */
  #stepPacman(dt: number): void {
    if (this.freezeTimer > 0) return
    const colours = this.balls.filter(b => !b.primary && !b.stuck)
    if (!this.pacman) {
      this.#colorBallTimer = colours.length >= PAC_COLOR_MIN ? this.#colorBallTimer + dt : 0
      if (this.#colorBallTimer >= PAC_SUMMON_HOLD && this.#hazardFree()) {
        const fromLeft = Math.random() < 0.5
        this.pacman = { x: fromLeft ? -PAC_R : W + PAC_R, y: H * 0.30, dir: fromLeft ? 1 : -1, hp: PACMAN_HP, mouth: 0, eaten: 0, eatCd: 0, leaving: false }
        this.#activeHazard = 'pacman'
        this.#colorBallTimer = 0
      }
      return
    }
    const p = this.pacman
    p.mouth = (p.mouth + dt * 8) % (Math.PI * 2)
    if (p.eatCd > 0) p.eatCd = Math.max(0, p.eatCd - dt)
    if (p.leaving) {                                        // slide off the nearest edge, then despawn
      p.x += p.dir * PACMAN_SPEED * dt
      if (p.x < -PAC_R * 2 || p.x > W + PAC_R * 2) { this.pacman = null; this.#endHazard() }
      return
    }
    if (colours.length === 0 || p.eaten >= PAC_EAT_CAP) { p.leaving = true; p.dir = p.x < W / 2 ? -1 : 1; return }
    // SMART targeting: pick the colour ball it can intercept SOONEST and steer to
    // where that ball WILL be (lead the target), not where it is now.
    let aimx = p.x, aimy = p.y, bestT = Infinity
    for (const b of colours) {
      let t = Math.hypot(b.x - p.x, b.y - p.y) / PACMAN_SPEED
      let px = b.x, py = b.y
      for (let k = 0; k < 2; k++) {                          // refine the lead point twice
        px = b.x + b.vx * t; py = b.y + b.vy * t
        px = clamp(px, 0, W); py = clamp(py, 0, H)           // it'll bounce off walls — don't chase off-field
        t = Math.hypot(px - p.x, py - p.y) / PACMAN_SPEED
      }
      if (t < bestT) { bestT = t; aimx = px; aimy = py }
    }
    {
      const dx = aimx - p.x, dy = aimy - p.y, d = Math.hypot(dx, dy) || 1
      p.x += (dx / d) * PACMAN_SPEED * dt; p.y += (dy / d) * PACMAN_SPEED * dt
      p.dir = dx >= 0 ? 1 : -1
    }
    // EAT one colour ball on contact (cooldown-gated so it can't vacuum a cluster)
    if (p.eatCd <= 0) {
      for (const b of colours) {
        if (Math.hypot(b.x - p.x, b.y - p.y) <= PAC_R + b.r) {
          this.balls = this.balls.filter(x => x !== b)     // eaten — no score, it's food
          this.explosions.push({ x: b.x, y: b.y, t: 0 })
          p.eaten++; p.eatCd = PAC_EAT_CD
          break
        }
      }
    }
    // the WHITE ball is NOT food: it chips Pac-Man and ricochets away (no life lost)
    for (const b of this.balls) {
      if (!b.primary || b.stuck) continue
      const dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy)
      if (d > PAC_R + b.r) continue
      const nd = d || 1, sp = Math.hypot(b.vx, b.vy) || BALL_SPEED
      b.vx = (dx / nd) * sp; b.vy = (dy / nd) * sp
      b.x = p.x + (dx / nd) * (PAC_R + b.r + 1); b.y = p.y + (dy / nd) * (PAC_R + b.r + 1)
      this.#hurtPacman(1)
      break
    }
  }

  /** Chip Pac-Man (white ball / laser / beam). It dies at 0 hp. */
  #hurtPacman(dmg: number): void {
    const p = this.pacman
    if (!p || p.leaving) return
    p.hp -= dmg
    this.#addScore(20)
    if (p.hp <= 0) this.#killPacman()
  }

  /** Pac-Man destroyed: explosion, a combo-strung bounty, and one wave-exempt pill. */
  #killPacman(): void {
    const p = this.pacman
    if (!p) return
    this.explosions.push({ x: p.x, y: p.y, t: 0 })
    this.#bumpCombo(p.x, p.y)
    this.#addScore(250)
    this.#dropPill(p.x, p.y, this.#randomPower())                        // a wave-exempt bonus pill
    this.pacman = null
    this.#endHazard()
  }

  /** Swing the wrecking ball off the white ball (a driven pendulum), then smash
   *  whatever it sweeps — the hunter, the ship, and falling pills. Smash
   *  CHAIN_BONUS_PILLS pills inside the window for the 100,000 jackpot. */
  #stepBallChain(dt: number): void {
    if (this.ballchainTimer <= 0 || this.freezeTimer > 0) return
    const p = this.balls.find(b => b.primary)
    if (!p) return
    // pendulum: restoring force toward straight-down + a drive from the ball's motion
    const drive = (p.stuck ? 0 : p.vx) * CHAIN_DRIVE
    this.#chainAngVel += (-CHAIN_K * Math.sin(this.#chainAngle) - drive) * dt
    this.#chainAngVel *= (1 - CHAIN_DAMP * dt)
    this.#chainAngle += this.#chainAngVel * dt
    const cx = p.x + Math.sin(this.#chainAngle) * CHAIN_LEN
    const cy = p.y + Math.cos(this.#chainAngle) * CHAIN_LEN
    this.chainBall = { x: cx, y: cy }
    this.#blastEnemies(cx, cy, ENEMY_R + WRECK_R)     // the wrecking ball kills enemies it sweeps
    // the ship — popped on contact
    if (this.alien && Math.hypot(this.alien.x - cx, this.alien.y - cy) <= ALIEN_W / 2 + WRECK_R) this.#destroyShip()
    // falling pills — smashed on contact, each counting toward the jackpot
    if (this.capsules.length) {
      const keep: Capsule[] = []
      for (const cap of this.capsules) {
        if (Math.hypot(cap.x - cx, cap.y - cy) <= WRECK_R + CAPSULE_W / 2) {
          this.ballchainKills++
          this.#addScore(200)
          this.explosions.push({ x: cap.x, y: cap.y, t: 0 })
          if (!this.#chainBonusPaid && this.ballchainKills >= CHAIN_BONUS_PILLS) {
            this.#chainBonusPaid = true
            // The prize is a GOLD PAPER CRANE that flutters down — catch it for the jackpot.
            keep.push({ x: cx, y: Math.max(cy, 70), kind: 'crane' })   // into `keep` (survives the reassign below); bypasses the pill cap
            for (let i = 0; i < 6; i++) this.explosions.push({ x: cx + Math.cos(i) * 22, y: cy + Math.sin(i) * 22, t: 0 })
          }
        } else keep.push(cap)
      }
      this.capsules = keep
    }
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
      // Also explode on contact with any enemy or the alien ship.
      if (!hit && this.enemies.some(e => Math.hypot(e.x - rk.x, e.y - rk.y) <= ENEMY_R + 4)) hit = true
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
    // The CLOCK stops time: while a freeze is active your own ability timers PAUSE —
    // only the clock itself (and cosmetic flashes) keep counting. (oscillate is
    // permanent; the gun/beam ammo deplete by firing, not by a timer.)
    if (this.freezeTimer <= 0) {
      if (this.laserCharging && this.laserShots > 0) this.laserCharge = Math.min(LASER_CHARGE_FULL, this.laserCharge + dt)   // hold builds the charge
      if (this.magnetTimer > 0) this.magnetTimer = Math.max(0, this.magnetTimer - dt)
      if (this.burstTimer > 0) this.burstTimer = Math.max(0, this.burstTimer - dt)
      if (this.pierceTimer > 0) {
        this.pierceTimer = Math.max(0, this.pierceTimer - dt)
        if (this.pierceTimer === 0) for (const b of this.balls) b.pierced = undefined   // clear pass-through tracking
      }
      if (this.scrambleTimer > 0) {
        this.scrambleTimer = Math.max(0, this.scrambleTimer - dt)
        if (this.scrambleTimer === 0) this.scrambleLevel = 0   // shuffle over — balls revert to normal colours
      }
      if (this.goldTimer > 0) {
        this.goldTimer = Math.max(0, this.goldTimer - dt)
        if (this.goldTimer === 0) this.goldBonus = 0           // gold window closed — bonus clears in one step
      }
      // Shields have no clock — they live until their strength is chipped away (see
      // #stepTurrets). A healing shield regenerates for exactly as long as it survives.
      if (this.regenShield && this.shieldHp > 0) {
        this.paddleHp = Math.min(PADDLE_MAX_HP, this.paddleHp + REGEN_RATE * this.amp * dt)   // rate amps live
      }
      if (this.expandTimer > 0) {
        this.expandTimer = Math.max(0, this.expandTimer - dt)
        if (this.expandTimer === 0) { this.paddle.w = this.#paddleBaseW; this.paddle.x = clamp(this.paddle.x, this.paddle.w / 2, W - this.paddle.w / 2) }   // restore the oscillate-grown base
      }
      if (this.beamShots > 0) {
        this.beamCharge += dt
        if (this.beamCharge >= this.beamTarget) {            // charge → release, then re-roll the charge time
          this.#fireBeam()
          this.beamCharge = 0
          this.beamTarget = BEAM_CHARGE_MIN + Math.random() * (BEAM_CHARGE_MAX - BEAM_CHARGE_MIN)
        }
      }
      if (this.ballchainTimer > 0) {
        this.ballchainTimer = Math.max(0, this.ballchainTimer - dt)
        if (this.ballchainTimer === 0) this.chainBall = null                            // window closed
      }
    }
    if (this.beamFlash > 0) this.beamFlash = Math.max(0, this.beamFlash - dt)            // cosmetic, keeps running
    if (this.rushFlash > 0) this.rushFlash = Math.max(0, this.rushFlash - dt)            // cosmetic, keeps running
    if (this.laserMuzzleFlash > 0) this.laserMuzzleFlash = Math.max(0, this.laserMuzzleFlash - dt)   // launch kick, cosmetic
    if (this.shieldFlash > 0) this.shieldFlash = Math.max(0, this.shieldFlash - dt * 3)
    for (const bm of this.bumpers) if (bm.flash > 0) bm.flash = Math.max(0, bm.flash - dt * 5)
    if (this.freezeTimer > 0) this.freezeTimer = Math.max(0, this.freezeTimer - dt)     // the clock itself keeps ticking down
    else if (this.#hazardCooldown > 0) this.#hazardCooldown = Math.max(0, this.#hazardCooldown - dt)   // director calm (paused while frozen)
  }

  /** Release one beam shot: a single laser straight up from the paddle's middle.
   *  Level 1 = 1 damage to the column, level 2 = ×2, level 3 clears the whole line. */
  #fireBeam(): void {
    if (this.beamShots <= 0) return
    this.beamShots--
    const bx = this.paddle.x
    this.beamX = bx
    this.beamFlash = BEAM_FLASH
    const dmg = this.beamLevel >= 3 ? 99 : this.beamLevel * this.amp   // L3 already clears the line; below that the amp bites harder
    for (const brick of [...this.bricks]) {            // snapshot: #damage may shatter a mega
      if (!brick.alive || brick.seed) continue          // seeds are invincible until they bloom
      if (bx >= brick.x && bx <= brick.x + brick.w) this.#damage(brick, dmg)
    }
    const a = this.alien                                // the beam also shoots a ship in its column
    if (a && bx >= a.x - ALIEN_W / 2 && bx <= a.x + ALIEN_W / 2) this.#destroyShip()
    if (this.extraLife && Math.abs(this.extraLife.x - bx) <= EXTRALIFE_R + 4) this.#hitExtraLife()   // beam zaps the carrier
    if (this.pacman && Math.abs(this.pacman.x - bx) <= PAC_R + 4) this.#hurtPacman(this.beamLevel >= 3 ? 99 : this.beamLevel)   // beam zaps Pac-Man in its column
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
    // During aim the paddle slides ±25% of paddle width under the still ball, so the
    // ball ends up at that offset ON the paddle. In play it uses the full screen.
    const lo = this.aiming ? AIM_ANCHOR - AIM_RANGE : half
    const hi = this.aiming ? AIM_ANCHOR + AIM_RANGE : W - half
    this.paddle.x = clamp(this.paddle.x, lo, hi)
    // The gun aim sweeps with paddle travel, clamped to a short 120° fan
    // balanced facing up: slide left/right to swing the barrel between the stops.
    if (this.gunAmmo > 0) {
      this.aimAngle = clamp(this.aimAngle + (this.paddle.x - this.#prevPaddleX) * GUN_SENS, GUN_AIM_MIN, GUN_AIM_MAX)
    }
    this.#prevPaddleX = this.paddle.x
  }

  /** Current lateral weave amplitude (px): the stacking double-up, clamped to the
   *  cap, then scaled by the active difficulty's oscillate-aggression. */
  #wobbleAmp(): number {
    return Math.min(WOBBLE_AMP_MAX, WOBBLE_BASE_AMP * Math.pow(2, this.oscillateStacks - 1)) * this.difficulty.oscAggroMul
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
      const amp = this.#wobbleAmp()
      const freq = WOBBLE_FREQ * this.difficulty.oscAggroMul   // harder modes weave faster too
      const sp = Math.hypot(b.vx, b.vy) || 1
      const px = -b.vy / sp, py = b.vx / sp
      const oldW = amp * Math.sin(b.wobble)
      b.wobble += freq * dt
      const dW = amp * Math.sin(b.wobble) - oldW
      b.x += px * dW
      b.y += py * dW
    }

    // Walls (left / right / top).
    if (b.x - b.r < 0) { b.x = b.r; b.vx = Math.abs(b.vx) }
    else if (b.x + b.r > W) { b.x = W - b.r; b.vx = -Math.abs(b.vx) }
    if (b.y - b.r < 0) { b.y = b.r; b.vy = Math.abs(b.vy) }

    if (this.bumpers.length) this.#bumperBounce(b)        // pinball bumpers
    if (this.pinballProps.length) this.#pinballPropBounce(b, dt)   // pinball props
    if (this.tnt) this.#tntBounce(b)                      // light the dynamite's fuse
    if (this.alien) this.#alienBounce(b)                  // bonk the top dispenser
    if (this.extraLife) this.#extraLifeBounce(b)          // pop the winged-heart 1-UP carrier
    if (this.pinball) this.#flipperBounce(b)     // pinball: real flippers (L/R mouse)
    else this.#paddleBounce(b)                            // normal: the sliding bat
    this.#brickHits(b)

    // Minimum speed: never crawl below half the start speed. (The Gold Rush does NOT
    // touch ball speed — the old frenzy pinned a 1.85× floor here.)
    const floor = BALL_SPEED_MIN
    let sp = Math.hypot(b.vx, b.vy)
    if (sp > 0 && sp < floor) {
      const k = floor / sp
      b.vx *= k; b.vy *= k
      sp = floor
    }

    // Anti-stuck: never let the ball run too horizontal (it would loop between
    // the side walls forever). Keep at least MIN_VY_RATIO of its speed vertical,
    // preserving direction — and steering DOWN if it's dead flat, so it heads to
    // the bat. Speed is unchanged; we just rotate the velocity steeper.
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
    const g = MAGNET_G * this.amp        // a continuous force: reads the amp LIVE, so an O turns the pull up at once
    b.vx += (dx / d) * g * dt
    b.vy += (dy / d) * g * dt
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
    // Pierce: the WHITE ball phases through tiles (no bounce), one damage each as it
    // passes. Colour balls never pierce. Each brick is damaged once per pass — the
    // `pierced` set holds bricks still being overlapped, pruned as the ball moves on.
    const pierce = this.pierceTimer > 0 && b.primary
    if (pierce) {
      if (b.pierced) for (const br of b.pierced) {           // prune bricks the ball has left (or that died)
        const px = clamp(b.x, br.x, br.x + br.w), py = clamp(b.y, br.y, br.y + br.h)
        if (!br.alive || (b.x - px) ** 2 + (b.y - py) ** 2 > b.r * b.r) b.pierced.delete(br)
      }
      for (const brick of [...this.bricks]) {               // snapshot: #damage may shatter a mega (shards must not be re-hit this pass)
        if (!brick.alive) continue
        const cx = clamp(b.x, brick.x, brick.x + brick.w), cy = clamp(b.y, brick.y, brick.y + brick.h)
        if ((b.x - cx) ** 2 + (b.y - cy) ** 2 > b.r * b.r) continue
        if (b.pierced?.has(brick)) continue                 // already damaged on this pass
        ;(b.pierced ??= new Set()).add(brick)
        this.#damage(brick, 1)                              // one damage, no bounce, keep going
      }
      return
    }
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
      // The white pinball ball does only a quarter of a normal hit (bouncy chaos, not a board-melter).
      this.#damage(brick, this.pinball && b.primary ? PINBALL_DAMAGE : 1)
      return                                               // one brick per sub-step
    }
  }

  /** POINTS axis (skill): the combo chain + the unified gold bonus, capped. A getter
   *  so it can never desync from combo/gold. The ceiling amps, so an amped gold pill
   *  is not handed back a bonus the cap immediately clips off. */
  get pointsMul(): number {
    return Math.min(POINTS_CAP * this.amp, 1 + Math.min(this.combo, 25) * 0.2 + this.goldBonus)
  }

  /** Add points through the two-axis multiplier — POINTS × × PILLS × (capped at
   *  TOTAL_CAP) with the oscillator's booster riding on top. Both the cap and the
   *  booster scale with the AMP; at amp 1 this is byte-for-byte the old ×1 / ×1.6. */
  #addScore(n: number): void {
    const amp = this.amp
    const boost = 1 + OSC_SCORE_PER_AMP * (amp - 1)   // amp 1 → ×1, one stack → ×1.6, quadruple → ×2.8
    const total = Math.min(TOTAL_CAP * amp, this.pointsMul * this.pillMul) * boost
    this.score += Math.round(n * total)
  }

  #damage(brick: Brick, dmg = 1): void {
    if (brick.seed) return                            // a sparkle seed is invincible until it blooms
    if (this.burstTimer > 0) brick.hp = Math.min(brick.hp, dmg)   // burst: one touch destroys any brick (even the quarter-damage pinball hit)
    brick.hp -= dmg
    this.#addScore(5)
    if (brick.hp > 0) return
    brick.alive = false
    // Combo: each brick killed since the last paddle bounce raises the chain. The
    // combo IS a score MULTIPLIER (×N) on the kill, strung together; milestones
    // earn a reward.
    const cm = this.#bumpCombo(brick.x + brick.w / 2, brick.y + brick.h / 2)
    if (brick.mega) { this.#breakMega(brick); return } // shatter into shards, no normal drop
    const before = this.score
    this.#addScore(20)                                  // combo expressed once, via pointsMul (no double-count)
    // Float the ACTUAL points earned on this tile (combo × all multipliers at work).
    this.comboPops.push({ x: brick.x + brick.w / 2, y: brick.y + brick.h / 2 - 14, n: cm, pts: this.score - before, t: 0 })
    if (brick.mult) this.#grantMultTile(brick)          // ×1/×2/×3 tile (or the hidden ×5) pays out
    if (brick.drop) {
      this.#dropPill(brick.x + brick.w / 2, brick.y + brick.h / 2, brick.drop)
    } else if (Math.random() < DROP_CHANCE) {
      this.#dropPill(brick.x + brick.w / 2, brick.y + brick.h / 2, this.#randomPower())
    }
  }

  /** Weighted pick — staples common, rares seldom (see POWER_WEIGHTS). The clock is
   *  excluded unless a colour ball is on screen (it only freezes things while colour
   *  balls keep clearing — releasing it otherwise would be a dead pill). */
  /** A dispenser pill: a rare 1-UP when you're below max lives, else a random power. */
  #dispensePower(): PowerKind {
    if (this.lives < this.maxLives && Math.random() < EXTRALIFE_PILL_CHANCE) return 'extralife'
    return this.#randomPower()
  }

  #randomPower(): PowerKind {
    const colourUp = this.balls.some(b => !b.primary && !b.stuck)
    const allow = (k: PowerKind): boolean => k !== 'clock' || colourUp
    // Defensive flood: the harder the mode (supportMul) the more heal/shield/regen rain
    // down — and ANY mode floods them harder under live danger (a hurt bat, or ≤1 life).
    // So Gangster drowns you in support while the action stays brutal.
    const hurt = 1 - clamp(this.paddleHp / PADDLE_MAX_HP, 0, 1)
    const need = 1 + 1.6 * hurt + (this.lives <= 1 ? 0.8 : 0)
    const defBoost = this.difficulty.supportMul * need
    const wt = (k: PowerKind): number => POWER_WEIGHTS[k] * (DEFENSIVE.has(k) ? defBoost : 1)
    let total = 0
    for (const k of POWER_ORDER) if (allow(k)) total += wt(k)
    let r = Math.random() * total
    for (const k of POWER_ORDER) { if (!allow(k)) continue; r -= wt(k); if (r < 0) return k }
    return POWER_ORDER[0]
  }

  /** Raise the combo chain by one and flag a floating ×N at (x,y); milestones earn
   *  a reward. The combo IS the score multiplier — shared by brick kills, the bonus
   *  ship, and enemy hits, so every chained kill (not just bricks) strings together. */
  #bumpCombo(x: number, y: number): number {
    this.combo++
    const cm = this.combo
    if (cm >= COMBO_MIN) {
      this.comboPops.push({ x, y, n: cm, t: 0 })
      if (cm % COMBO_MILESTONE === 0) this.#comboReward(cm)
    }
    return cm
  }

  /** Breaking a ×N multiplier tile ADDS to the unified gold bonus (same pool + window
   *  as the gold pill and pinball disc — no more replace-vs-stack), pays a bonus, pops
   *  a big ×N. The hidden ×5 simply adds more toward the cap. */
  #grantMultTile(brick: Brick): void {
    const n = brick.mult ?? 1
    this.goldBonus = Math.min(GOLD_BONUS_CAP, this.goldBonus + n * 0.4)
    this.goldTimer = Math.min(GOLD_WINDOW * 4, this.goldTimer + GOLD_WINDOW)   // extend (never clobber) the window, like the pill/disc
    this.#addScore(n * 50)
    this.comboPops.push({ x: brick.x + brick.w / 2, y: brick.y + brick.h / 2, n, t: 0 })
  }

  /** Combo milestone (×5, ×10, …): a fat score bonus, +1 life at ×15, and a CELEBRATION
   *  — an escalating tier-coloured burst plus a stream of the bonus points raining up
   *  into the score counter. (No free pill — pills only fall from the alien when hit.) */
  #comboReward(n: number): void {
    const before = this.score
    this.#addScore(n * 30)
    const reward = this.score - before
    const gotLife = n % 15 === 0 && this.lives < this.maxLives
    if (gotLife) this.lives = Math.min(this.maxLives, this.lives + this.amp)   // amped: the milestone pays a multi-UP
    this.milestoneFx = { n, t: 0, life: gotLife }           // renderer draws the burst + 'COMBO ×N' (+ '+1 LIFE' only if granted)
    this.scoreFlash = 0.45                                  // the ✦ score pulses as the points land
    this.explosions.push({ x: W / 2, y: H * 0.42, t: 0 })
    this.comboPops.push({ x: W / 2, y: H * 0.42, n, t: 0 })
    // Rain the bonus as a staggered stream of +pts (negative t = a brief delay each).
    const beads = Math.min(n, 12), share = Math.max(1, Math.round(reward / beads))
    for (let i = 0; i < beads; i++) {
      this.comboPops.push({ x: W / 2 + (Math.random() - 0.5) * 64, y: H * 0.40, n: 0, pts: share, t: -i * 0.05 })
    }
  }

  /** Spawn a falling pill — enforces the on-screen cap (≤ MAX_CAPSULES) and gives it
   *  a brief hover (PILL_STAGGER) before it starts to fall. Returns false at the cap. */
  #dropPill(x: number, y: number, kind: PowerKind): boolean {
    if (this.capsules.length >= MAX_CAPSULES) return false
    this.capsules.push({ x, y, kind, delay: PILL_STAGGER })
    return true
  }

  #stepCapsules(dt: number): void {
    if (!this.capsules.length) return
    const p = this.paddle
    const survive: Capsule[] = []
    for (const cap of this.capsules) {
      if (cap.delay && cap.delay > 0) { cap.delay -= dt; survive.push(cap); continue }   // hover, then fall
      if (this.invaderPills) {
        // SPACE-INVADER march: step sideways, reverse + drop a row at each wall, slow descent.
        cap.dir ??= cap.x < W / 2 ? 1 : -1
        cap.x += INVADER_MARCH * cap.dir * dt
        if (cap.x < CAPSULE_W) { cap.x = CAPSULE_W; cap.dir = 1; cap.y += INVADER_STEP }
        else if (cap.x > W - CAPSULE_W) { cap.x = W - CAPSULE_W; cap.dir = -1; cap.y += INVADER_STEP }
        cap.y += INVADER_FALL * dt
      } else {
        cap.y += CAPSULE_SPEED * dt
      }
      if (cap.y - CAPSULE_H / 2 > H) continue
      // On the pinball TABLE there is no bat to catch with — a pill is collected the
      // way a real machine awards a rollover: the BALL runs over it.
      const caught = this.pinball
        ? this.balls.some(b => !b.stuck
          && Math.abs(b.x - cap.x) <= CAPSULE_W / 2 + b.r
          && Math.abs(b.y - cap.y) <= CAPSULE_H / 2 + b.r)
        : cap.y + CAPSULE_H / 2 >= p.y - 2
          && cap.y - CAPSULE_H / 2 <= p.y + p.h + 2
          && cap.x >= p.x - p.w / 2 - CAPSULE_W / 2
          && cap.x <= p.x + p.w / 2 + CAPSULE_W / 2
      if (caught) {
        this.#applyPower(cap.kind)
        this.pillMul = Math.min(PILLS_CAP, this.pillMul + 0.1)           // PILLS axis: +0.1 per pill, capped
        this.#addScore(100)                                             // each pill is worth 100 (through the multipliers)
        this.pickups.push({ x: cap.x, y: cap.y, kind: cap.kind, t: 0 })   // flash where it was grabbed
      } else survive.push(cap)
    }
    this.capsules = survive
  }

  /** Advance every fireball up the screen. Each PIERCES bricks (chipping each once
   *  via fb.hit), carves a small AoE at every pierce, damages enemies it passes, and
   *  detonates a bigger plasma burst on its last pierce or at the ceiling. */
  #stepFireballs(dt: number): void {
    if (!this.fireballs.length) return
    const survive: Fireball[] = []
    outer: for (const fb of this.fireballs) {
      fb.t += dt
      fb.spin += dt * 16
      const steps = Math.max(1, Math.ceil((FIREBALL_SPEED * dt) / Math.max(4, fb.r)))   // sub-step so it can't tunnel
      const sdt = dt / steps
      for (let s = 0; s < steps; s++) {
        fb.y += fb.vy * sdt
        if (fb.y < 0) { this.#detonateFireball(fb); continue outer }                    // hit the ceiling
        if (this.#shipHitAt(fb.x, fb.y)) { this.#destroyShip(); this.#detonateFireball(fb); continue outer }
        if (this.extraLife && Math.hypot(this.extraLife.x - fb.x, this.extraLife.y - fb.y) <= EXTRALIFE_R) { this.#hitExtraLife(); this.#detonateFireball(fb); continue outer }
        if (this.pacman && Math.hypot(this.pacman.x - fb.x, this.pacman.y - fb.y) <= PAC_R) { this.#hurtPacman(fb.dmg); this.#detonateFireball(fb); continue outer }
        for (const e of [...this.enemies]) {                                            // chip each enemy once per orb
          if (!fb.hit.has(e) && Math.hypot(e.x - fb.x, e.y - fb.y) <= ENEMY_R + fb.r) { fb.hit.add(e); this.#hurtEnemy(e) }
        }
        let hit: Brick | null = null, lowest = -Infinity
        for (const brick of this.bricks) {
          if (!brick.alive || brick.seed || fb.hit.has(brick)) continue
          if (fb.x >= brick.x && fb.x <= brick.x + brick.w && fb.y >= brick.y && fb.y <= brick.y + brick.h) {
            if (brick.y > lowest) { lowest = brick.y; hit = brick }
          }
        }
        if (hit) {
          fb.hit.add(hit)
          this.#damage(hit, fb.dmg)
          this.#fireballSplash(fb.x, fb.y, fb.aoe)
          if (fb.hit.size >= fb.pierce) { this.#detonateFireball(fb); continue outer }
        }
      }
      survive.push(fb)
    }
    this.fireballs = survive
  }

  /** A light AoE at each pierce point — chips neighbours (1 dmg) so the orb carves a
   *  channel, and clears any swarm in radius. The punch is the core pierce dmg. */
  #fireballSplash(x: number, y: number, r: number): void {
    for (const brick of [...this.bricks]) {
      if (!brick.alive || brick.seed) continue
      const bxc = brick.x + brick.w / 2, byc = brick.y + brick.h / 2
      if (Math.hypot(bxc - x, byc - y) > r) continue
      if (brick.mega) { brick.alive = false; this.#breakMega(brick); continue }
      this.#damage(brick, 1)
    }
    this.#blastEnemies(x, y, r)
  }

  /** The fireball's terminal burst — a plasma shock-ring + a full-strength splash. */
  #detonateFireball(fb: Fireball): void {
    this.explosions.push({ x: fb.x, y: fb.y, t: 0, hue: 'plasma' })
    this.#fireballSplash(fb.x, fb.y, fb.aoe * 1.4)
    this.#checkWin()
  }

  #applyPower(kind: PowerKind): void {
    // THE AMP — the oscillator's multiplier on this grant (1 = un-amped, 4 = quadruple).
    // Snapshotted here rather than read later, so an O picked up afterwards never
    // retro-buffs a power already in hand. Where a grant has a stacking ceiling, the
    // ceiling is amped too — otherwise an amped grant would be clipped straight back
    // down by an un-amped cap and the amp would do nothing.
    const amp = this.amp
    switch (kind) {
      case 'oscillate':
        // Permanent for the round: raise the AMP (every future pill hits harder),
        // stack the weave, nudge every ball faster, AND grow the bat 25% each time
        // (capped). expand widens on top of this base.
        this.oscillateStacks++
        this.#paddleBaseW = Math.min(W * 0.6, this.#paddleBaseW * 1.25)
        if (this.expandTimer <= 0) this.paddle.w = this.#paddleBaseW
        this.paddle.x = clamp(this.paddle.x, this.paddle.w / 2, W - this.paddle.w / 2)
        {
          const speedup = 1 + (OSC_SPEEDUP - 1) * this.difficulty.oscAggroMul   // harder modes kick speed harder per stack
          for (const b of this.balls) {
            if (b.stuck) continue
            const sp = Math.hypot(b.vx, b.vy) || 1
            const ns = Math.min(BALL_SPEED_MAX, sp * speedup)
            b.vx = (b.vx / sp) * ns
            b.vy = (b.vy / sp) * ns
          }
        }
        break
      case 'break': {
        // Amped: the SAME ±BREAK_FAN spread, subdivided into 2·amp splits per ball —
        // at amp 1 that is exactly the original ±0.35 pair, and at quadruple it is an
        // eight-way burst inside the same cone (so splits never fly off sideways).
        const add: Ball[] = []
        const cap = this.maxBalls
        const n = 2 * amp
        for (const b of this.balls) {
          if (this.balls.length + add.length >= cap) break
          const speed = Math.hypot(b.vx, b.vy) || BALL_SPEED
          const ang = b.stuck ? -Math.PI / 2 : Math.atan2(b.vy, b.vx)
          if (b.stuck) { b.stuck = false; b.vx = speed * Math.cos(ang); b.vy = speed * Math.sin(ang) }
          for (let i = 0; i < n; i++) {
            if (this.balls.length + add.length >= cap) break
            const d = -BREAK_FAN + (2 * BREAK_FAN * (i + 0.5)) / n
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
        this.laserLevel = this.laserShots > 0 ? Math.min(LASER_MAX_LEVEL, this.laserLevel + 1) : 1   // re-grab before empty powers up
        this.#laserLoader = LASER_LOADER * amp        // amped: up to 4× the fireballs
        this.laserShots = this.#laserLoader
        this.laserCharge = 0
        this.laserCharging = false
        break
      case 'expand':
        // Amped: wider AND longer. The width factor grows 0.3 per amp step (×1.3 at
        // amp 1, exactly as before) and is capped so a quadrupled bat still leaves the
        // player some board to miss.
        this.paddle.w = Math.min(W * 0.9, Math.max(PADDLE_EXPAND_W, this.#paddleBaseW * (1 + 0.3 * amp)))
        this.expandTimer = Math.min(EXPAND_DURATION * 4 * amp, this.expandTimer + EXPAND_DURATION * amp)   // time stacks
        this.paddle.x = clamp(this.paddle.x, this.paddle.w / 2, W - this.paddle.w / 2)
        break
      case 'gun':
        // Stacking: a 2nd/3rd gun grabbed while the loader still has shots steps
        // the level up (diagonals, then double). A gun grabbed with an empty
        // loader starts fresh at level 1. Either way it reloads to a full — amped,
        // that full is up to 4× the shots.
        this.gunLevel = this.gunAmmo > 0 ? Math.min(GUN_MAX_LEVEL, this.gunLevel + 1) : 1
        this.#gunLoader = GUN_LOADER * amp
        this.gunAmmo = this.#gunLoader      // fresh loader, no timeout
        this.aimAngle = GUN_AIM_CENTER      // balanced, facing straight up
        this.#prevPaddleX = this.paddle.x
        break
      case 'magnet':
        this.magnetTimer = Math.min(MAGNET_DURATION * 4 * amp, this.magnetTimer + MAGNET_DURATION * amp)   // time stacks; pull strength amps live
        break
      case 'rocket':
        this.#rocketMax = ROCKET_MAX * amp            // amped: carry (and fly) up to 4 missiles, each with a 4× blast
        this.rocketAmmo = Math.min(this.#rocketMax, this.rocketAmmo + ROCKET_LOADER * amp)
        break
      case 'multiplier':
        // The gold pill ADDS to the unified gold bonus (same pool as the ×N tiles and
        // the pinball disc) and refreshes the window. Stacks toward the cap.
        this.goldBonus = Math.min(GOLD_BONUS_CAP * amp, this.goldBonus + 0.5 * amp)
        this.goldTimer = Math.min(GOLD_WINDOW * 4 * amp, this.goldTimer + GOLD_WINDOW * amp)
        break
      case 'burst':
        this.burstTimer = Math.min(BURST_DURATION * 4 * amp, this.burstTimer + BURST_DURATION * amp)   // time stacks
        break
      case 'pierce':
        this.pierceTimer = Math.min(PIERCE_DURATION * 4 * amp, this.pierceTimer + PIERCE_DURATION * amp)   // time stacks
        break
      case 'scramble':
        // Scramble every ball into random colours so you must follow yours, then it
        // reverts. Re-grab while it's lit to step the hold-time up (1 → 3 → 5s); each
        // grab refreshes it.
        this.scrambleLevel = this.scrambleTimer > 0 ? Math.min(SCRAMBLE_DURS.length - 1, this.scrambleLevel + 1) : 0
        this.#scrambleDur = SCRAMBLE_DURS[this.scrambleLevel] * amp
        this.scrambleTimer = this.#scrambleDur
        break
      case 'heal':
        this.paddleHp = Math.min(PADDLE_MAX_HP, this.paddleHp + HEAL_AMOUNT * amp)   // amped: always a full patch-up
        break
      case 'shield':
        // No clock — an amped shield is a DEEPER pool, so it soaks proportionally more
        // hits before it busts. A fresh grab refills the strength either way.
        this.#shieldMax = SHIELD_MAX_HP * amp
        this.shieldHp = this.#shieldMax
        break
      case 'regen':
        // The healing flavour. Deliberately does NOT clear on a later plain ⛨ grab —
        // once you've earned the heal it rides the shield until it busts.
        this.#shieldMax = SHIELD_MAX_HP * amp
        this.shieldHp = this.#shieldMax
        this.regenShield = true
        break
      case 'pinball':
        // Flip the board into MACHINE mode and leave it there — no timer to stack.
        this.pinball = true
        this.#spawnBumpers()
        this.#spawnPinballProps()                     // a fresh random handful of props each activation (amped = more)
        this.#setPrimaryRadius(BALL_R * 2)            // white ball doubles in size
        break
      case 'beam':
        // Stacking like the gun: another beam before the loader empties powers it
        // up (1 → 2 → 3, where 3 clears the whole line); either way it reloads —
        // amped, to up to 4× the shots.
        this.beamLevel = this.beamShots > 0 ? Math.min(BEAM_MAX_LEVEL, this.beamLevel + 1) : 1
        this.#beamLoader = BEAM_LOADER * amp
        this.beamShots = this.#beamLoader
        this.beamCharge = 0                           // charges up before the first release
        this.beamTarget = BEAM_CHARGE_MIN + Math.random() * (BEAM_CHARGE_MAX - BEAM_CHARGE_MIN)
        break
      case 'clock':
        // Only with at least one colour ball in play: freeze the white ball(s) +
        // every hazard while colour balls keep clearing.
        if (this.balls.some(b => !b.primary)) { this.#clockDur = CLOCK_DURATION * amp; this.freezeTimer = this.#clockDur }
        break
      case 'ballchain': {
        this.#ballchainDur = BALLCHAIN_DURATION * amp
        this.ballchainTimer = this.#ballchainDur
        this.ballchainKills = 0
        this.#chainBonusPaid = false
        this.#chainAngle = 0; this.#chainAngVel = 0
        const p = this.balls.find(b => b.primary) ?? this.balls[0]
        this.chainBall = p ? { x: p.x, y: p.y + CHAIN_LEN } : { x: W / 2, y: H / 2 }
        break
      }
      case 'extralife':
        this.lives = Math.min(this.maxLives, this.lives + amp)   // the 1-UP from the carrier alien — amped, a multi-UP into an amped ceiling
        break
      // The crane is deliberately NOT amped here: its jackpot is paid through
      // #addScore, which already carries the oscillator's score booster. Amping the
      // payout too would compound the same multiplier twice.
      case 'crane': {                                  // caught the gold paper crane → jackpot
        this.#addScore(CHAIN_BONUS)
        this.comboPops.push({ x: this.paddle.x, y: this.paddle.y - 26, n: 0, pts: CHAIN_BONUS, t: 0 })
        for (let i = 0; i < 10; i++) this.explosions.push({ x: this.paddle.x + Math.cos(i) * 26, y: this.paddle.y - 20 + Math.sin(i) * 16, t: 0 })
        break
      }
    }
  }

  /** Two field bumpers in the open "non-tile" zone below the bricks. */
  #spawnBumpers(): void {
    this.bumpers = [
      { x: W * 0.3, y: BUMPER_Y, r: BUMPER_R, flash: 0 },
      { x: W * 0.7, y: BUMPER_Y, r: BUMPER_R, flash: 0 },
    ]
  }

  /** Left / right mouse buttons flick the flippers (pinball mode only). */
  flipLeft(down: boolean): void { this.#flipLDown = down }
  flipRight(down: boolean): void { this.#flipRDown = down }

  /** Animate each flipper toward its target (up while its button is held). */
  #stepFlippers(dt: number): void {
    const step = FLIP_RAISE_SPEED * dt
    const approach = (cur: number, target: number) => target > cur ? Math.min(target, cur + step) : Math.max(target, cur - step)
    const pl = this.flipLeftRaise, pr = this.flipRightRaise
    this.flipLeftRaise = approach(this.flipLeftRaise, this.#flipLDown ? 1 : 0)
    this.flipRightRaise = approach(this.flipRightRaise, this.#flipRDown ? 1 : 0)
    this.#flipLVel = this.flipLeftRaise - pl                 // >0 this frame = swinging up → kick
    this.#flipRVel = this.flipRightRaise - pr
  }

  /** The flipper assembly is BOLTED to the middle of the table — a real machine's
   *  flippers don't slide. (They used to track the bat's x, which turned the whole
   *  assembly into a moving platform.) Click L/R to flip; that's the only control. */
  get flipperCenterX(): number { return W / 2 }

  /** The two flippers as segments: pivot (px,py) → tip at the lerped angle. The
   *  right flipper mirrors the left about the table's fixed centre. */
  #flippers(): { px: number; py: number; ang: number; vel: number }[] {
    const fy = PADDLE_Y + FLIP_Y_OFF
    const cxp = this.flipperCenterX
    const la = FLIP_REST + (FLIP_UP - FLIP_REST) * this.flipLeftRaise
    const ra = (Math.PI - FLIP_REST) + ((Math.PI - FLIP_UP) - (Math.PI - FLIP_REST)) * this.flipRightRaise
    return [
      { px: cxp - FLIP_PIVOT_DX, py: fy, ang: la, vel: this.#flipLVel },
      { px: cxp + FLIP_PIVOT_DX, py: fy, ang: ra, vel: this.#flipRVel },
    ]
  }

  /** Bounce the ball off the flippers (pinball mode). An actively-rising flipper
   *  launches the ball back up into play; a resting one is a passive wall. The
   *  central gap between the resting tips is the drain. */
  #flipperBounce(b: Ball): void {
    for (const f of this.#flippers()) {
      const tx = f.px + Math.cos(f.ang) * FLIP_LEN, ty = f.py + Math.sin(f.ang) * FLIP_LEN
      const ex = tx - f.px, ey = ty - f.py
      const t = clamp(((b.x - f.px) * ex + (b.y - f.py) * ey) / (ex * ex + ey * ey || 1), 0, 1)
      const cx = f.px + ex * t, cy = f.py + ey * t
      let nx = b.x - cx, ny = b.y - cy
      const d = Math.hypot(nx, ny) || 1
      if (d > b.r + FLIP_THICK) continue
      nx /= d; ny /= d
      b.x = cx + nx * (b.r + FLIP_THICK); b.y = cy + ny * (b.r + FLIP_THICK)
      const vn = b.vx * nx + b.vy * ny
      if (vn < 0) { b.vx -= 2 * vn * nx; b.vy -= 2 * vn * ny }
      if (f.vel > 0.001) {                                   // active flip → ACCELERATE, hardest at the tip (sweet spot)
        const sweet = t                                       // 0 at the pivot → 1 at the tip (fastest part, like a real flipper)
        const cur = Math.hypot(b.vx, b.vy) || BALL_SPEED
        const launch = Math.min(BALL_SPEED_MAX, Math.max(PINBALL_LAUNCH, cur) * (1.2 + 0.7 * sweet))   // +20% at the base, up to +90% on the sweet spot
        const horiz = -Math.sign(b.x - W / 2) * launch * 0.4
        b.vx = horiz
        b.vy = -Math.sqrt(Math.max(0, launch * launch - horiz * horiz))
      } else {                                               // passive bounce — keep pinball-lively speed
        const s = Math.hypot(b.vx, b.vy) || 1
        const ns = clamp(s, BALL_SPEED, BALL_SPEED_MAX)
        b.vx = (b.vx / s) * ns; b.vy = (b.vy / s) * ns
      }
      return
    }
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
      const sp = Math.min(BALL_SPEED_MAX, cur * 2)               // a pinball hit DOUBLES the speed (capped)
      b.vx = (b.vx / cur) * sp; b.vy = (b.vy / cur) * sp          // pinball kick
      bm.flash = 1
      this.#addScore(10)
      this.#toggleTurret()                                       // each bumper hit flips a tile turret on/off
    }
  }

  /** Drop a random handful of pinball props into the open zone below the bricks. */
  #spawnPinballProps(): void {
    const pool = (Object.keys(PINBALL_SHAPE) as PinballKind[]).slice()
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[pool[i], pool[j]] = [pool[j], pool[i]] }
    // Amped: a fuller table (the slot grid below seats 9, and the kind pool is 20,
    // so a quadrupled handful of 8 still lays out cleanly and never repeats a kind).
    const n = (PINBALL_PROPS_MIN + Math.floor(Math.random() * (PINBALL_PROPS_MAX - PINBALL_PROPS_MIN + 1))) * this.amp
    const props: PinballProp[] = []
    const place = (kind: PinballKind, x: number, y: number): PinballProp => {
      const sh = PINBALL_SHAPE[kind]
      const r = sh === 'field' ? 34 : sh === 'bar' ? 26 : sh === 'target' ? 16 : 15
      const hp = kind === 'bank' ? 3 : (kind === 'drop' || kind === 'extraball') ? 1 : 0
      const p: PinballProp = { kind, x: clamp(x, 60, W - 60), y, r, hp, flash: 0, spin: 0, lit: kind === 'jackpot', cd: 0, partner: -1 }
      props.push(p); return p
    }
    const ys = [H * 0.40, H * 0.50, H * 0.60]
    let slot = 0
    for (const kind of pool.slice(0, n)) {
      const x = 80 + (slot % 3) * (W - 160) / 2 + (Math.random() - 0.5) * 28
      const y = ys[Math.floor(slot / 3) % ys.length] + (Math.random() - 0.5) * 18
      const p = place(kind, x, y)
      if (kind === 'teleport') { const q = place('teleport', W - x, y + 36); p.partner = props.indexOf(q); q.partner = props.indexOf(p) }   // linked pair
      slot++
    }
    this.pinballProps = props
  }

  /** Per-frame prop upkeep: flash/cooldown decay + jackpot relight. */
  #stepPinballProps(dt: number): void {
    for (const p of this.pinballProps) {
      if (p.flash > 0) p.flash = Math.max(0, p.flash - dt * 3)
      if (p.cd > 0) p.cd = Math.max(0, p.cd - dt)
      if (p.kind === 'jackpot' && !p.lit && p.cd <= 0) p.lit = true
    }
  }

  /** Collide one ball with every pinball prop, by shape. */
  #pinballPropBounce(b: Ball, dt: number): void {
    for (const p of this.pinballProps) {
      const sh = PINBALL_SHAPE[p.kind]
      if (sh === 'disc') this.#discProp(b, p)
      else if (sh === 'target') this.#targetProp(b, p)
      else if (sh === 'sling') this.#slingProp(b, p)
      else if (sh === 'field') this.#fieldProp(b, p, dt)
      else this.#barProp(b, p)
    }
  }

  #discProp(b: Ball, p: PinballProp): void {
    const dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy), rr = p.r + b.r
    if (d >= rr || d === 0) return
    const nx = dx / d, ny = dy / d
    const pass = p.kind === 'tunnel' || p.kind === 'teleport'
    if (!pass) {
      b.x = p.x + nx * rr; b.y = p.y + ny * rr
      const vdot = b.vx * nx + b.vy * ny
      if (vdot < 0) { b.vx -= 2 * vdot * nx; b.vy -= 2 * vdot * ny }
    }
    const mul = p.kind === 'jet' ? 2 : p.kind === 'pop' ? 1.35 : p.kind === 'tunnel' ? 1.6 : p.kind === 'orbit' ? 1.2 : 1
    if (mul !== 1) { const cur = Math.hypot(b.vx, b.vy) || 1; const sp = Math.min(BALL_SPEED_MAX, cur * mul); b.vx = (b.vx / cur) * sp; b.vy = (b.vy / cur) * sp }
    if (p.cd > 0) return
    p.flash = 1; p.cd = 0.12
    switch (p.kind) {
      case 'jet': this.#addScore(50); break
      case 'pop': this.#addScore(30); break
      case 'mushroom': this.#addScore(20); break
      case 'orbit': this.#addScore(40); break
      case 'tunnel': this.#addScore(15); break
      case 'jackpot': if (p.lit) { this.#addScore(1000); p.lit = false; p.cd = 6; this.explosions.push({ x: p.x, y: p.y, t: 0 }) } else this.#addScore(20); break
      case 'multiplier': this.goldBonus = Math.min(GOLD_BONUS_CAP, this.goldBonus + 0.5); this.goldTimer = Math.min(GOLD_WINDOW * 4, this.goldTimer + GOLD_WINDOW); p.cd = 2; this.#addScore(10); break
      case 'teleport': { const q = this.pinballProps[p.partner]; if (q) { b.x = q.x; b.y = q.y + q.r + b.r + 2; q.cd = p.cd = 0.5; q.flash = 1 } this.#addScore(25); break }
      case 'extraball': if (p.hp > 0 && this.balls.length < MAX_BALLS) { p.hp = 0; this.balls.push(this.#newBall(p.x, p.y + p.r + b.r + 2, (Math.random() < 0.5 ? -1 : 1) * BALL_SPEED * 0.5, BALL_SPEED * 0.7, false, false)); this.#addScore(50) } break
    }
  }

  #targetProp(b: Ball, p: PinballProp): void {
    if ((p.kind === 'drop' || p.kind === 'bank') && p.hp <= 0) return     // cleared
    const hw = p.r, hh = 7
    const cx = clamp(b.x, p.x - hw, p.x + hw), cy = clamp(b.y, p.y - hh, p.y + hh)
    const dx = b.x - cx, dy = b.y - cy
    if (dx * dx + dy * dy > b.r * b.r) return
    const ox = b.r - Math.abs(dx), oy = b.r - Math.abs(dy)
    if (ox < oy) { b.vx = dx >= 0 ? Math.abs(b.vx) : -Math.abs(b.vx); b.x += dx >= 0 ? ox : -ox }
    else { b.vy = dy >= 0 ? Math.abs(b.vy) : -Math.abs(b.vy); b.y += dy >= 0 ? oy : -oy }
    if (p.cd > 0) return
    p.flash = 1; p.cd = 0.12
    if (p.kind === 'drop') { p.hp = 0; this.#addScore(100) }
    else if (p.kind === 'bank') { p.hp--; this.#addScore(60) }
    else this.#addScore(40)
  }

  #slingProp(b: Ball, p: PinballProp): void {
    const dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy), rr = p.r + b.r
    if (d >= rr || d === 0) return
    const dir = p.kind === 'slingL' ? 1 : -1
    const sp = Math.min(BALL_SPEED_MAX, Math.max(BALL_SPEED, Math.hypot(b.vx, b.vy) * 1.3))
    const vx = dir * sp * 0.55
    b.vx = vx; b.vy = -Math.sqrt(Math.max(0, sp * sp - vx * vx))
    b.x = p.x + (dx / d) * rr; b.y = p.y + (dy / d) * rr
    if (p.cd > 0) return
    p.flash = 1; p.cd = 0.1; this.#addScore(25)
  }

  #fieldProp(b: Ball, p: PinballProp, dt: number): void {
    const dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy)
    if (d > p.r) return
    const cap = () => { const sp = Math.hypot(b.vx, b.vy); if (sp > BALL_SPEED_MAX) { b.vx = b.vx / sp * BALL_SPEED_MAX; b.vy = b.vy / sp * BALL_SPEED_MAX } }
    if (p.kind === 'magnet') { b.vx += Math.sign(W / 2 - b.x) * 260 * dt; cap() }
    else if (p.kind === 'fan') { b.vy -= 320 * dt; cap() }
    else if (b.vy > 0 && p.cd <= 0) {   // kicker — punt a falling ball back up
      const sp = Math.min(BALL_SPEED_MAX, Math.max(BALL_SPEED, Math.hypot(b.vx, b.vy)))
      b.vy = -sp * 0.9; b.vx = (Math.random() - 0.5) * sp * 0.4
      p.cd = 1.5; p.flash = 1; this.#addScore(15)
    }
  }

  #barProp(b: Ball, p: PinballProp): void {
    if (b.x < p.x - p.r || b.x > p.x + p.r || Math.abs(b.y - p.y) > b.r + 4) return
    if (p.kind === 'spinner') { if (p.cd <= 0) { p.spin++; this.#addScore(5); p.cd = 0.08; p.flash = 1 } }
    else if (p.kind === 'rollover') { if (!p.lit) { p.lit = true; p.flash = 1; this.#addScore(25) } }
    else if (b.vy > 0 && p.cd <= 0) { b.vy = -Math.abs(b.vy); b.y = p.y - b.r - 4; p.cd = 0.2; p.flash = 1; this.#addScore(10) }   // gate: one-way up
  }

  /** Each bumper hit toggles a single turret: if one is already lit, morph it back
   *  to a plain tile; otherwise light a random live tile so it starts firing. */
  #toggleTurret(): void {
    const lit = this.bricks.find(b => b.turret && b.alive)
    if (lit) { lit.turret = false; return }                      // morph back to a tile
    const cands = this.bricks.filter(b => b.alive && !b.turret && !b.mega && !b.seed && !b.covered)
    if (!cands.length) return
    cands[Math.floor(Math.random() * cands.length)].turret = true
    this.#turretFireCd = TURRET_FIRE_INTERVAL * 0.5              // first shot comes a touch sooner
  }

  /** Fire the lit turret at the paddle on a cadence, then advance every shot;
   *  a shot that lands on the paddle breaks the combo chain and flashes it red. */
  #stepTurrets(dt: number): void {
    if (this.freezeTimer > 0) return                  // clock: turrets + shots frozen
    const turret = this.pinball ? this.bricks.find(b => b.turret && b.alive) : null
    if (turret) {
      this.#turretFireCd -= dt
      if (this.#turretFireCd <= 0) {
        this.#turretFireCd = TURRET_FIRE_INTERVAL
        const ox = turret.x + turret.w / 2, oy = turret.y + turret.h
        const base = Math.atan2(this.paddle.y - oy, this.paddle.x - ox)
        for (const a of [-0.32, 0, 0.32]) {                          // a 3-way spread fan
          this.turretShots.push({ x: ox, y: oy, vx: Math.cos(base + a) * TURRET_SHOT_SPEED, vy: Math.sin(base + a) * TURRET_SHOT_SPEED, kind: 'spread', t: 0 })
        }
      }
    }
    if (this.paddleHitFlash > 0) this.paddleHitFlash = Math.max(0, this.paddleHitFlash - dt)
    if (!this.turretShots.length) return
    const p = this.paddle
    const survive: TurretShot[] = []
    for (const s of this.turretShots) {
      s.t = (s.t ?? 0) + dt
      if (s.kind === 'bomb') s.vy += 230 * dt                     // lobbed arc (gravity)
      else if (s.kind === 'seeker') {                             // homing missile — steers toward the bat
        const dx = this.paddle.x - s.x, dy = this.paddle.y - s.y, d = Math.hypot(dx, dy) || 1
        s.vx += (dx / d) * 220 * dt; s.vy += (dy / d) * 220 * dt
        const ns = Math.hypot(s.vx, s.vy); if (ns > 195) { s.vx = s.vx / ns * 195; s.vy = s.vy / ns * 195 }
      }
      s.x += s.vx * dt; s.y += s.vy * dt
      if (s.y - TURRET_SHOT_R > H || s.x < -20 || s.x > W + 20) continue   // off-screen
      // On the pinball TABLE there is no bat, so a shot has nothing to hit: fire is a
      // visual hazard and the only way to lose a ball is the DRAIN. Without this the
      // bolted-down flippers leave the bat invisible AND decoupled, so turret fire —
      // which only exists in pinball mode — would chip an off-screen phantom and take
      // a life the player never saw coming.
      const hit = !this.pinball
        && s.y + TURRET_SHOT_R >= p.y && s.y - TURRET_SHOT_R <= p.y + p.h
        && s.x >= p.x - p.w / 2 - TURRET_SHOT_R && s.x <= p.x + p.w / 2 + TURRET_SHOT_R
      if (hit) {
        this.combo = 0                                            // chain broken
        if (this.shielded) {                                       // shield DEFLECTS it back up (and dumbs a seeker)...
          s.vy = -Math.abs(s.vy) * 1.1; s.y = p.y - TURRET_SHOT_R - 2; s.kind = 'shot'; survive.push(s)
          this.shieldHp = Math.max(0, this.shieldHp - SHIELD_HIT_DMG)   // ...but the hit CHIPS the shield's strength
          if (this.shieldHp <= 0) { this.regenShield = false; this.shieldFlash = 1.6 }   // drained → shield BUSTS (bigger flash); the heal goes with it
          else this.shieldFlash = 1
          continue
        }
        this.paddleHitFlash = PADDLE_HIT_FLASH
        this.paddleHp -= TURRET_DMG * this.difficulty.turretDmgMul   // difficulty scales enemy-fire damage
        if (this.paddleHp <= 0) { this.paddleHp = 0; this.turretShots = []; this.#loseLife(); return }   // bat destroyed → lose a life
        continue
      }
      survive.push(s)
    }
    this.turretShots = survive
  }

  /** Pinball ended (a life lost — there is no timeout): morph every turret back to
   *  a tile and clear any shots in flight. */
  #clearTurrets(): void {
    for (const b of this.bricks) if (b.turret) b.turret = false
    this.turretShots = []
    this.#turretFireCd = 0
  }

  /** Tick the centre dynamite: spawn one on a cadence, burn a lit fuse down to the
   *  blast, or let an untouched crate fizzle after TNT_LIFETIME. */
  #stepTnt(dt: number): void {
    if (this.freezeTimer > 0) return                  // clock: dynamite frozen (fuse paused)
    if (!this.tnt) {
      if (!this.#tntArmedThisLevel) return            // no crate this level (~4 in 5 levels)
      this.#tntTimer -= dt
      // place the single crate once its timer elapses AND the encounter slot is free
      if (this.#tntTimer <= 0 && this.bricksLeft > 0 && this.#hazardFree()) {
        // float the crate at the CENTRE of the tile area (over the bricks, even if tiles are there)
        this.tnt = { x: W / 2, y: BRICK_TOP + this.#levelRows * BRICK_H / 2, t: 0, fuse: TNT_FUSE, lit: false }
        this.#activeHazard = 'tnt'
      }
      return
    }
    const t = this.tnt
    t.t += dt
    if (t.lit) { t.fuse -= dt; if (t.fuse <= 0) this.#detonateTnt() }
    else if (t.t >= TNT_LIFETIME) { this.tnt = null; this.#tntArmedThisLevel = false; this.#endHazard() }   // fizzled — no re-arm
  }

  /** A ball touching the crate bounces off it (AABB) and lights the fuse once. */
  #tntBounce(b: Ball): void {
    const t = this.tnt
    if (!t) return
    const cx = clamp(b.x, t.x - TNT_R, t.x + TNT_R)
    const cy = clamp(b.y, t.y - TNT_R, t.y + TNT_R)
    const dx = b.x - cx, dy = b.y - cy
    if (dx * dx + dy * dy > b.r * b.r) return
    const ox = b.r - Math.abs(dx), oy = b.r - Math.abs(dy)
    if (ox < oy) { b.vx = dx >= 0 ? Math.abs(b.vx) : -Math.abs(b.vx); b.x += dx >= 0 ? ox : -ox }
    else { b.vy = dy >= 0 ? Math.abs(b.vy) : -Math.abs(b.vy); b.y += dy >= 0 ? oy : -oy }
    if (!t.lit) { t.lit = true; t.fuse = TNT_FUSE }
  }

  /** Detonate: a big blast that deals a random 1..TNT_DMG_MAX to EVERY tile within
   *  TNT_RADIUS (plus the hunter/ship if caught) and scatters a cluster of fireballs. */
  #detonateTnt(): void {
    const t = this.tnt
    if (!t) return
    const cx = t.x, cy = t.y
    this.explosions.push({ x: cx, y: cy, t: 0 })           // two rings of puffs fill the big 150-radius blast
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      this.explosions.push({ x: cx + Math.cos(a) * TNT_RADIUS * 0.45, y: cy + Math.sin(a) * TNT_RADIUS * 0.45, t: 0 })
      this.explosions.push({ x: cx + Math.cos(a + 0.4) * TNT_RADIUS * 0.8, y: cy + Math.sin(a + 0.4) * TNT_RADIUS * 0.8, t: 0 })
    }
    for (const brick of [...this.bricks]) {                // snapshot: #damage may shatter a mega
      if (!brick.alive || brick.seed) continue
      const bxc = brick.x + brick.w / 2, byc = brick.y + brick.h / 2
      if (Math.hypot(bxc - cx, byc - cy) > TNT_RADIUS) continue
      this.#damage(brick, 1 + Math.floor(Math.random() * TNT_DMG_MAX))   // random 1..3 impacts per tile
    }
    if (this.alien && Math.hypot(this.alien.x - cx, this.alien.y - cy) <= TNT_RADIUS) this.#destroyShip()
    this.#blastEnemies(cx, cy, TNT_RADIUS)            // the TNT blast kills enemies in range
    if (this.pacman && Math.hypot(this.pacman.x - cx, this.pacman.y - cy) <= TNT_RADIUS) this.#killPacman()
    this.tnt = null
    this.#tntArmedThisLevel = false                        // one crate per level, no re-arm
    this.#endHazard()
    this.#checkWin()
  }

  #loseLife(): void {
    this.lives--
    if (this.lives <= 0) {                                  // game over: clear transient FX so nothing freezes behind the banner
      this.lives = 0; this.state = 'gameover'
      this.milestoneFx = null; this.scoreFlash = 0; this.comboPops = []; this.rushFlash = 0
      return
    }
    this.#resetForLife()
  }

  /** Continue after a game over: refill lives and drop a fresh ball onto the level
   *  where you fell — score and surviving bricks are kept, so you play right on. */
  continueGame(): void {
    if (this.state !== 'gameover') return
    this.lives = this.difficulty.lives
    this.state = 'playing'
    this.#resetForLife()
  }
}

