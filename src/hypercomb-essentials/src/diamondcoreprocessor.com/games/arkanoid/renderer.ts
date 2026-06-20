// diamondcoreprocessor.com/games/arkanoid/renderer.ts
//
// Draws the Engine's world (bricks, paddle, balls, pills, lasers, gun aim, HUD)
// onto a 2D context the overlay has already transformed into world units. Pure
// draw — no state.

import {
  type Engine, type Brick, type Ball, type Capsule, type Fireball, type TurretShot, type Rocket, type Explosion, type Enemy, type Tnt, type Bumper, type PinballProp, type Alien, type ExtraLife, type Pacman, type ComboPop, type Pickup,
  POWER_META, W, H, BRICK_W, BRICK_H, BRICK_TOP, BRICK_X0, GUN_AIM_MIN, GUN_AIM_MAX, GUN_DIAG_SPREAD,
  ROCKET_RADIUS, EXPLOSION_DUR, ENEMY_R, ALIEN_W, ALIEN_H, ALIEN_Y,
  FLIP_LEN, FLIP_PIVOT_DX, FLIP_Y_OFF, FLIP_REST, FLIP_UP,
  FROG_HOP_PERIOD, FROG_AIR_FRAC, BEE_WIGGLE_HZ, SCUTTLE_PERIOD, GHOST_BOB_PERIOD, CHICK_BOB_PERIOD,
} from './engine.js'
import { EDIT_COLS, EDIT_ROWS } from './levels.js'

// Brick colour by max hit-points. A disciplined two-hue scheme for "modern
// vector arcade" clarity: the 1–3 hp bricks share a COOL body family (teal →
// aqua → ocean blue) so the field reads as one cohesive wall, and the tough
// 4-hp bricks get a WARM accent so "this one needs more hits" pops out of the
// cool field instead of the whole board being confetti. At runtime a '4' and a
// '*' brick both collapse to max 4 and read GOLD; the editor, where the chars
// are still distinct, shows '4' in amber and '*' in gold (see drawEditor).
// Vivid arcade palette — bright, saturated, high-contrast so the tiles POP off the
// dark board (kept clearly distinct: mint → cyan → indigo → hot orange → gold).
const BRICK_COLORS: Record<number, string> = {
  1: '#2BE36B',   // spectral-green haunted stone
  2: '#39FF6A',   // brighter spectral green
  3: '#B65CFF',   // violet stone
  4: '#FFB23A',   // candle-amber — a clearly tougher haunted block
}
const TOUGH_COLOR = '#FFB23A'   // candle amber — the toughest '*' stone
// Cartoon frog (the hopping top dispenser) — bright candy greens + a dark-green ink contour.
const FROG_BODY_TOP = '#7CF05A'   // bright lime crown
const FROG_BODY_MID = '#3FD13A'   // saturated grass green
const FROG_BODY_BOT = '#1E9E2E'   // deep green base
const FROG_BELLY = '#E9FFD0'      // pale glossy belly
const FROG_INK = '#0E5A1E'        // dark-green ink contour (never #000)
// Bumblebee
const BEE_BODY_TOP = '#FFD23A', BEE_BODY_MID = '#FFB81F', BEE_BODY_BOT = '#E8870C'
const BEE_STRIPE = '#241A0A', BEE_INK = '#5A3A0E', BEE_WING = '210,235,255'
// Crab
const CRAB_SHELL_TOP = '#FF7A4D', CRAB_SHELL_MID = '#F2452E', CRAB_SHELL_BOT = '#B81E22'
const CRAB_LIMB = '#FF9166', CRAB_BELLY = '#FFE0C2', CRAB_INK = '#7A1410'
// Ghost
const GHOST_BODY_TOP = '#FFFFFF', GHOST_BODY_MID = '#F2ECFF', GHOST_BODY_BOT = '#D9C8FF'
const GHOST_BELLY = '#FBF7FF', GHOST_INK = '#6A4FA8', GHOST_CHEEK = '#FFA7D0'
// Baby chick
const CHICK_BODY_TOP = '#FFE86B', CHICK_BODY_MID = '#FFD23B', CHICK_BODY_BOT = '#F2A521'
const CHICK_BELLY = '#FFF6C8', CHICK_BEAK = '#FF8A2B', CHICK_INK = '#9A5410'

// Ten hunter looks, chosen by enemy.variant on spawn — a colour theme + spike
// count each, so a run shows a varied bestiary rather than one recoloured bug.
interface EnemyLook { aura: string; top: string; mid: string; bot: string; eye: string; accent: string; dark: string; spikes: number }
const ENEMY_LOOKS: EnemyLook[] = [
  { aura: '255,40,90',  top: '#e23a5e', mid: '#b81a3c', bot: '#6e0f24', eye: '#ff5b2e', accent: '#ffd24a', dark: '#7a0f25', spikes: 11 }, // crimson
  { aura: '70,220,90',  top: '#5fe07a', mid: '#23b84a', bot: '#0f6e24', eye: '#aaff5b', accent: '#d8ff7a', dark: '#0f5a1e', spikes: 9 },  // toxic green
  { aura: '60,150,255', top: '#5a9bff', mid: '#1a5cd8', bot: '#0f2a6e', eye: '#5be0ff', accent: '#a8e6ff', dark: '#10306e', spikes: 13 }, // electric blue
  { aura: '170,80,255', top: '#b07bff', mid: '#7a2ed8', bot: '#3a1070', eye: '#ff7bff', accent: '#e0a8ff', dark: '#3a106e', spikes: 8 },  // violet
  { aura: '255,150,40', top: '#ffa64d', mid: '#e2731a', bot: '#7a3a0f', eye: '#ffd24a', accent: '#ffe9a8', dark: '#6e3010', spikes: 12 }, // amber
  { aura: '40,220,210', top: '#5fe6dc', mid: '#1ab8a8', bot: '#0f6e66', eye: '#d0fff8', accent: '#a8fff0', dark: '#0f5a52', spikes: 10 }, // teal
  { aura: '255,60,180', top: '#ff6bbf', mid: '#d82e90', bot: '#70104e', eye: '#ffaee0', accent: '#ffc8e8', dark: '#6e1048', spikes: 14 }, // magenta
  { aura: '170,210,255',top: '#cfe2ff', mid: '#7fa0d6', bot: '#2f4b8a', eye: '#bcdcff', accent: '#eaf3ff', dark: '#2f4b7a', spikes: 7 },  // ice
  { aura: '210,220,40', top: '#e0e25f', mid: '#b8b023', bot: '#6e660f', eye: '#f0ff7a', accent: '#fbffb0', dark: '#5a5a0f', spikes: 9 },  // sickly
  { aura: '160,160,210',top: '#c0c0e0', mid: '#7070b8', bot: '#3a3a6e', eye: '#c0a8ff', accent: '#e0e0ff', dark: '#3a3a6e', spikes: 12 }, // steel
]

// Damage palette: a near-dead brick darkens toward this muted charred grey-brown
// (it is desaturated + darkened, NOT just faded), so wear reads at a glance while
// the shape stays solid.
const BRICK_CHARRED = { r: 58, g: 50, b: 46 }

// ── THE HAUNTED KEEP — neon cores over deep night ──
const NEON_GREEN = '#39FF6A'    // spectral green — will-o-wisp / crypts
const NEON_VIOLET = '#B65CFF'   // haunting violet
const NEON_AMBER = '#FFB23A'    // candle amber — the TOUGH read
const BONE = '#E8E0FF'          // mist/bone white
// One floor palette per ascent band; levelIndex climbs the keep (green crypts →
// violet halls → crimson belfry → gold spire) then cycles. Every neon read
// (bg, atmosphere, title-card) pulls its dominant hue from here per floor.
interface Floor { name: string; neon: string; neonRgb: string; accent: string; accentRgb: string; sky: [string, string, string]; mist: string }
const FLOORS: Floor[] = [
  { name: 'THE GREEN CRYPTS',   neon: '#39FF6A', neonRgb: '57,255,106',  accent: '#B65CFF', accentRgb: '182,92,255', sky: ['#0A0814', '#08110C', '#05070F'], mist: '57,255,106' },
  { name: 'THE VIOLET HALLS',   neon: '#B65CFF', neonRgb: '182,92,255',  accent: '#39FF6A', accentRgb: '57,255,106', sky: ['#120A22', '#0C0818', '#05060F'], mist: '122,60,255' },
  { name: 'THE CRIMSON BELFRY', neon: '#FF3A6E', neonRgb: '255,58,110',  accent: '#FFB23A', accentRgb: '255,178,58', sky: ['#1A0814', '#12060E', '#08040A'], mist: '255,58,110' },
  { name: 'THE GOLDEN SPIRE',   neon: '#FFB23A', neonRgb: '255,178,58',  accent: '#B65CFF', accentRgb: '182,92,255', sky: ['#170F08', '#100A14', '#06060F'], mist: '255,178,58' },
]
const floorFor = (levelIndex: number): Floor => FLOORS[Math.floor(levelIndex / 4) % FLOORS.length]
void NEON_VIOLET; void NEON_AMBER; void BONE

/** The fresh body colour for a brick of the given max-hp — exported so the
 *  overlay can tint a brick-break particle burst to the brick that just died
 *  (it owns no renderer state, only this colour lookup). */
export function brickColor(max: number): string {
  return max >= 4 ? TOUGH_COLOR : (BRICK_COLORS[max] ?? '#46b6f0')
}

/** Parse a '#rrggbb' string into rgb components (renderer-local, tiny). */
function hexRgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.slice(1), 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

const rgbStr = (r: number, g: number, b: number): string =>
  `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`

/** Mix two rgb colours, t=0 → a, t=1 → b. */
function mix(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }, t: number): { r: number; g: number; b: number } {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t }
}

/** Scale an rgb toward black (for the bottom of the body gradient / edges). */
function darken(c: { r: number; g: number; b: number }, k: number): { r: number; g: number; b: number } {
  return { r: c.r * k, g: c.g * k, b: c.b * k }
}

/** Tiny deterministic LCG (Park–Miller) seeded per brick so a crack pattern is
 *  stable across frames yet differs from brick to brick. */
function rngFrom(seed: number): () => number {
  let s = (seed | 0) % 2147483647
  if (s <= 0) s += 2147483646
  return () => { s = (s * 48271) % 2147483647; return s / 2147483647 }
}

// Per-kind look for the 20 pinball props: colour + draw shape + optional glyph.
const PROP_STYLE: Record<string, { c: string; shape: string; label?: string }> = {
  jet: { c: '#ff7043', shape: 'disc', label: 'J' }, pop: { c: '#5b9bff', shape: 'disc' }, mushroom: { c: '#5fe08a', shape: 'disc' },
  tunnel: { c: '#3dd7ff', shape: 'ring' }, jackpot: { c: '#ffd24a', shape: 'disc', label: '$' }, teleport: { c: '#b07bff', shape: 'ring' },
  multiplier: { c: '#ffd24a', shape: 'disc', label: '×' }, extraball: { c: '#eaffff', shape: 'disc', label: '+' }, orbit: { c: '#5fe6dc', shape: 'disc' },
  drop: { c: '#ff5b8a', shape: 'target' }, standup: { c: '#ffae4a', shape: 'target' }, bank: { c: '#b07bff', shape: 'target' },
  slingL: { c: '#aeb9ff', shape: 'slingL' }, slingR: { c: '#aeb9ff', shape: 'slingR' },
  magnet: { c: '#7ec8ff', shape: 'field' }, fan: { c: '#a8fff0', shape: 'field' }, kicker: { c: '#ffd24a', shape: 'field' },
  spinner: { c: '#d8c2ff', shape: 'spinner' }, rollover: { c: '#5fe08a', shape: 'bar' }, gate: { c: '#ff8f8f', shape: 'gate' },
}

export class Renderer {
  #ctx: CanvasRenderingContext2D
  constructor(ctx: CanvasRenderingContext2D) { this.#ctx = ctx }

  // ── orchestration spine: one candlelight clock the whole keep breathes on ──
  #pulseV = 0.6            // last computed candlelight value (0..1), recomputed atop draw()
  #spike = 0              // event energy; brick-break / frenzy / level-start / near-clear add to it
  #lastT = 0              // previous draw() time, for frame-rate-independent spike decay

  /** Candlelight: a slow sway + a faster flutter + a deterministic guttering stutter
   *  (no Math.random in render). Folds in #spike so events lift the glow board-wide.
   *  THE shared clock — every glowing element scales its glow by this.#pulse. */
  #computePulse(time: number): void {
    const base = 0.5 + 0.5 * Math.sin(time * 2.1)
    const flutter = 0.5 + 0.5 * Math.sin(time * 11.0 + 1.3)
    const q = Math.floor(time * 7), s = Math.sin(q * 12.9898) * 43758.5453
    const stutter = s - Math.floor(s)
    let v = base * 0.62 + flutter * 0.26 + stutter * 0.12
    v = 0.45 + 0.55 * v
    this.#pulseV = Math.min(1, v + this.#spike * 0.5)
  }

  /** Poke a synchronised glow spike (an orchestration MOMENT) — the overlay calls
   *  this on brick-break, frenzy, and level-start so the whole keep flares on one beat. */
  spike(amount: number): void { this.#spike = Math.min(2.2, this.#spike + amount) }

  /** The live candlelight value, for draws inside the class. */
  get #pulse(): number { return this.#pulseV }

  /** Neon convention: shadowColor = the hue, shadowBlur = base + swing*pulse. Call
   *  before filling/stroking a bright neon core so it glows on the shared candle. */
  #neon(hue: string, base: number, swing: number): void {
    const ctx = this.#ctx
    ctx.shadowColor = hue
    ctx.shadowBlur = base + swing * this.#pulseV
  }

  draw(engine: Engine, time: number): void {
    // orchestration: compute the candlelight ONCE; every glow reads this.#pulse.
    const dt = Math.min(0.05, Math.max(0, time - this.#lastT)); this.#lastT = time
    this.#spike = Math.max(0, this.#spike - dt * 3.2)            // event energy bleeds off in ~0.7s
    this.#computePulse(time)
    const floor = floorFor(engine.levelIndex)                   // which floor of the keep we're on
    this.#background(time, floor, this.#pulse)
    this.#atmosphere(time, this.#pulse, floor)                  // bats, wisps, lightning, candle flicker
    this.#bricks(engine.bricks, time)
    this.#bumpers(engine.bumpers, time)
    if (engine.pinballProps.length) this.#pinballProps(engine.pinballProps, time)
    this.#turretShots(engine.turretShots, time)
    this.#gunAim(engine, time)
    this.#paddle(engine, time)
    this.#chargeOrb(engine, time)                            // charging fireball at the bat muzzle
    this.#fireballs(engine.fireballs, time)                  // in-flight Hadoukens (on top of the bat)
    this.#beam(engine)
    if (engine.alien) this.#alien(engine.alien, time)
    if (engine.extraLife) this.#extraLife(engine.extraLife, time)
    if (engine.tnt) this.#tnt(engine.tnt, time)
    const fiery = engine.tnt !== null                       // dynamite on screen → balls catch fire
    const piercing = engine.pierceTimer > 0                  // white ball phases through tiles
    for (const b of engine.balls) this.#ball(b, time, fiery, piercing && b.primary, engine.frantic)
    if (engine.chainBall) this.#ballChain(engine, time)     // the swinging wrecking ball
    if (engine.freezeTimer > 0) this.#freeze(engine, time)  // clock freeze overlay + frost
    this.#capsules(engine.capsules, time)
    if (engine.enemies.length) { const white = engine.balls.find(b => b.primary) ?? null; for (const e of engine.enemies) this.#enemy(e, white, time) }
    if (engine.pacman) this.#pacman(engine.pacman, time)
    this.#rockets(engine.rockets)
    this.#explosions(engine.explosions)
    this.#pickups(engine.pickups)
    this.#comboPops(engine.comboPops)
    if (engine.milestoneFx) this.#milestone(engine.milestoneFx.n, engine.milestoneFx.t, engine.milestoneFx.life)
    if (engine.franticFlash > 0) this.#frenzy(engine.franticFlash, time)
    if (engine.nearClearFrac > 0) this.#nearClear(engine.nearClearFrac, engine, time)   // last-few-bricks BERSERK alert
    if (engine.aiming) this.#aimHint(engine, time)
    this.#hud(engine)
  }

  /** Near-clear ALERT: with only the last few bricks left the swarm goes berserk —
   *  a pulsing red-alert edge vignette, enemy speed-lines + after-images, and an
   *  "ALERT" klaxon flicker. Layered on top, cheap, deterministic. nc = 0..1. */
  #nearClear(nc: number, engine: Engine, time: number): void {
    const ctx = this.#ctx
    const hz = 3.5 + 4.5 * nc
    const pulse = 0.5 + 0.5 * Math.sin(time * hz)
    const intensity = nc * (0.55 + 0.45 * pulse)
    // 1 ── red-alert vignette (edge-only, so it can't fight the central gold #frenzy)
    ctx.save()
    const vg = ctx.createRadialGradient(W / 2, H * 0.5, H * 0.30, W / 2, H * 0.5, H * 0.74)
    vg.addColorStop(0, 'rgba(255,40,48,0)'); vg.addColorStop(1, `rgba(255,36,44,${0.34 * intensity})`)
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H)
    ctx.restore()
    // 2 ── enemy speed-lines + after-images (the "they got fast" read)
    if (engine.enemies.length) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'
      for (const e of engine.enemies) {
        const vx = e.vx ?? 0, vy = e.vy ?? 0
        const sp = Math.hypot(vx, vy)
        const dx = sp > 0.01 ? vx / sp : 0, dy = sp > 0.01 ? vy / sp : 1
        for (let i = 1; i <= 2; i++) {
          const gx = e.x - dx * i * ENEMY_R * 0.8, gy = e.y - dy * i * ENEMY_R * 0.8
          ctx.globalAlpha = 0.20 * intensity / i; ctx.fillStyle = 'rgba(255,90,90,1)'
          ctx.beginPath(); ctx.arc(gx, gy, ENEMY_R * (0.9 - i * 0.18), 0, Math.PI * 2); ctx.fill()
        }
        ctx.globalAlpha = 0.5 * intensity
        ctx.strokeStyle = 'rgba(255,170,170,0.9)'; ctx.lineWidth = 1.4; ctx.lineCap = 'round'
        const nx = -dy, ny = dx
        for (let k = -1; k <= 1; k++) {
          const ox = nx * k * ENEMY_R * 0.5, oy = ny * k * ENEMY_R * 0.5, len = ENEMY_R * (1.4 + 1.0 * pulse)
          ctx.beginPath()
          ctx.moveTo(e.x + ox - dx * ENEMY_R * 0.9, e.y + oy - dy * ENEMY_R * 0.9)
          ctx.lineTo(e.x + ox - dx * (ENEMY_R * 0.9 + len), e.y + oy - dy * (ENEMY_R * 0.9 + len))
          ctx.stroke()
        }
      }
      ctx.restore()
    }
    // 3 ── "ALERT" klaxon flicker, top-centre, strobing on the beat
    if (pulse > 0.6) {
      ctx.save()
      ctx.globalAlpha = (pulse - 0.6) / 0.4 * intensity
      ctx.translate(W / 2, 40 + Math.sin(time * 40) * 1.5)
      ctx.font = '900 22px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(60,0,4,0.9)'; ctx.strokeText('⚠ ALERT', 0, 0)
      ctx.fillStyle = '#ff5b5b'; ctx.shadowColor = '#ff2b2b'; ctx.shadowBlur = 14; ctx.fillText('⚠ ALERT', 0, 0)
      ctx.restore()
    }
  }

  // ── designer view ────────────────────────────────────────
  drawEditor(grid: readonly string[], hover: { col: number; row: number } | null): void {
    const ctx = this.#ctx
    // bricks from the grid chars
    for (let r = 0; r < grid.length; r++) {
      const line = grid[r]
      for (let c = 0; c < line.length; c++) {
        const ch = line[c]
        if (ch === '.' || ch === ' ') continue
        // In the editor '4' and '*' ARE distinguishable (unlike at runtime, where
        // both collapse to max 4): amber for a plain 4-hp brick, gold for the
        // tough '*'. Drawn fresh (wear = 1) through the same painter as play.
        const color = ch === '*' ? TOUGH_COLOR : (BRICK_COLORS[parseInt(ch, 10) || 1] ?? '#46b6f0')
        this.#drawBrick(BRICK_X0 + c * BRICK_W, BRICK_TOP + r * BRICK_H, BRICK_W, BRICK_H, color, 1)
      }
    }
    // grid over the editable area (centred to match the in-game wall)
    const gw = EDIT_COLS * BRICK_W, gh = EDIT_ROWS * BRICK_H
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1
    for (let c = 0; c <= EDIT_COLS; c++) { ctx.beginPath(); ctx.moveTo(BRICK_X0 + c * BRICK_W + 0.5, BRICK_TOP); ctx.lineTo(BRICK_X0 + c * BRICK_W + 0.5, BRICK_TOP + gh); ctx.stroke() }
    for (let r = 0; r <= EDIT_ROWS; r++) { ctx.beginPath(); ctx.moveTo(BRICK_X0, BRICK_TOP + r * BRICK_H + 0.5); ctx.lineTo(BRICK_X0 + gw, BRICK_TOP + r * BRICK_H + 0.5); ctx.stroke() }
    // hover cell
    if (hover && hover.col >= 0 && hover.row >= 0 && hover.col < EDIT_COLS && hover.row < EDIT_ROWS) {
      ctx.strokeStyle = 'rgba(126,224,255,0.9)'; ctx.lineWidth = 2
      ctx.strokeRect(BRICK_X0 + hover.col * BRICK_W + 1, BRICK_TOP + hover.row * BRICK_H + 1, BRICK_W - 2, BRICK_H - 2)
    }
    // bat preview + hint
    ctx.fillStyle = 'rgba(90,169,255,0.4)'
    this.#roundRect(W / 2 - 42, H - 34, 84, 13, 6); ctx.fill()
    ctx.fillStyle = 'rgba(154,160,200,0.85)'; ctx.font = '13px "Segoe UI", system-ui, sans-serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'
    ctx.fillText('paint bricks · ▶ Test to play', W / 2, H - 44)
  }

  #bricks(bricks: readonly Brick[], time: number): void {
    const ctx = this.#ctx
    for (const b of bricks) {
      if (!b.alive) continue
      if (b.mega) {
        // The big sparkling brick: gold body via the shared painter (which now
        // streams lightning-fork cracks as it takes hits) plus a twinkle. No hit
        // counter — the spreading cracks read the damage.
        this.#drawBrick(b.x, b.y, b.w, b.h, TOUGH_COLOR, b.hp / b.max)
        this.#sparkle(b, time, 6)
        continue
      }
      const baseHex = b.max >= 4 ? TOUGH_COLOR : (BRICK_COLORS[b.max] ?? '#46b6f0')
      this.#drawBrick(b.x, b.y, b.w, b.h, baseHex, b.hp / b.max)
      if (b.seed) this.#sparkle(b, time, 2)        // a seed about to bloom into a mega
      if (b.turret) this.#turretTile(b, time)      // pinball: a bumper lit this tile into a turret
      if (b.mult && !b.hidden) this.#multBadge(b, time)   // a ×1/×2/×3 score-multiplier tile
    }
    ctx.globalAlpha = 1
  }

  /** A ×N badge on a multiplier tile — blue ×1, green ×2, gold ×3. The hidden ×5
   *  has no badge (it looks like a normal brick until broken). */
  #multBadge(b: Brick, time: number): void {
    const ctx = this.#ctx
    const n = b.mult ?? 1
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2
    const col = n >= 3 ? '#ffd24a' : n === 2 ? '#7ee0a0' : '#7ec8ff'
    const pulse = 0.5 + 0.5 * Math.sin(time * 5 + cx * 0.2)
    ctx.save()
    ctx.fillStyle = 'rgba(8,12,24,0.5)'
    this.#roundRect(b.x + 2, b.y + 2, b.w - 4, b.h - 4, 3); ctx.fill()
    ctx.shadowColor = col; ctx.shadowBlur = 5 + 5 * pulse
    ctx.fillStyle = col
    ctx.font = `800 ${Math.min(b.h - 3, 13)}px "Segoe UI", system-ui, sans-serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(`×${n}`, cx, cy + 0.5)
    ctx.restore()
  }

  /** The centre dynamite crate: a bound bundle of red sticks with a fuse. Unlit it
   *  pulses with a draining lifetime ring; lit, the fuse sparks and the crate shakes. */
  #tnt(t: Tnt, time: number): void {
    const ctx = this.#ctx
    const shake = t.lit ? (0.5 - ((time * 53) % 1)) * 3 : 0    // deterministic jitter, no Math.random in render
    const x = t.x + shake, y = t.y + shake
    ctx.save()
    const glow = ctx.createRadialGradient(x, y, 2, x, y, 30)
    glow.addColorStop(0, t.lit ? 'rgba(255,80,40,0.5)' : 'rgba(255,140,40,0.28)')
    glow.addColorStop(1, 'rgba(255,80,40,0)')
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, 30, 0, Math.PI * 2); ctx.fill()
    for (let i = -1; i <= 1; i++) {                            // three sticks
      const sx = x + i * 8
      const g = ctx.createLinearGradient(sx - 4, 0, sx + 4, 0)
      g.addColorStop(0, '#a01b1b'); g.addColorStop(0.5, '#e23b3b'); g.addColorStop(1, '#7a1010')
      ctx.fillStyle = g
      this.#roundRect(sx - 4, y - 12, 8, 24, 2); ctx.fill()
      ctx.fillStyle = '#2a0a0a'; ctx.fillRect(sx - 4, y - 2, 8, 4)   // label band
    }
    ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 1.5                 // binding wire
    ctx.beginPath(); ctx.moveTo(x - 13, y - 5); ctx.lineTo(x + 13, y - 5); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(x - 13, y + 6); ctx.lineTo(x + 13, y + 6); ctx.stroke()
    ctx.strokeStyle = '#caa46a'; ctx.lineWidth = 1.6; ctx.lineCap = 'round'   // fuse
    ctx.beginPath(); ctx.moveTo(x, y - 12); ctx.quadraticCurveTo(x + 8, y - 20, x + 4, y - 26); ctx.stroke()
    if (t.lit) {
      const sp = 0.5 + 0.5 * Math.sin(time * 40)
      ctx.fillStyle = `rgba(255,${180 + Math.floor(60 * sp)},80,1)`
      ctx.shadowColor = '#ffd24a'; ctx.shadowBlur = 10
      ctx.beginPath(); ctx.arc(x + 4, y - 26, 2 + 2 * sp, 0, Math.PI * 2); ctx.fill()
    } else {
      const frac = Math.max(0, 1 - t.t / 30)                   // 30s lifetime ring draining
      ctx.strokeStyle = 'rgba(255,160,60,0.7)'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(x, y, 21, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); ctx.stroke()
    }
    ctx.restore()
  }

  /** A lit turret tile: a dark hostile plate, a pulsing red core "eye", and a
   *  barrel poking down out of the bottom edge — clearly aimed at the player. */
  #turretTile(b: Brick, time: number): void {
    const ctx = this.#ctx
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2
    const pulse = 0.5 + 0.5 * Math.sin(time * 9)
    ctx.save()
    // hostile dark plate over the tile
    ctx.fillStyle = 'rgba(30,8,12,0.55)'
    this.#roundRect(b.x + 2, b.y + 2, b.w - 4, b.h - 4, 3); ctx.fill()
    // the barrel poking down out of the bottom
    ctx.fillStyle = '#2a2f3a'
    ctx.fillRect(cx - 3, b.y + b.h - 2, 6, 6)
    ctx.fillStyle = '#11151c'
    ctx.fillRect(cx - 1.5, b.y + b.h + 2, 3, 2)
    // pulsing red core
    ctx.shadowColor = '#ff3b3b'; ctx.shadowBlur = 8 + 6 * pulse
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 6)
    g.addColorStop(0, '#ffd0d0'); g.addColorStop(0.5, '#ff4d4d'); g.addColorStop(1, 'rgba(255,40,40,0)')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(cx, cy, 4 + 1.5 * pulse, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }

  /** Turret shots raining toward the paddle — small red tracer slugs with a tail. */
  #turretShots(shots: readonly TurretShot[], time: number): void {
    if (!shots.length) return
    const ctx = this.#ctx
    ctx.save()
    for (const s of shots) {
      const len = Math.hypot(s.vx, s.vy) || 1
      const dx = s.vx / len, dy = s.vy / len
      if (s.kind === 'bomb') {                               // lobbed bomb: dark sphere + pulsing fuse + fins
        const pulse = 0.5 + 0.5 * Math.sin((s.t ?? 0) * 12)
        ctx.save()
        ctx.fillStyle = '#4a2410'
        for (const f of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s.x, s.y - 4); ctx.lineTo(s.x + f * 5, s.y - 8); ctx.lineTo(s.x + f * 2, s.y - 2); ctx.closePath(); ctx.fill() }
        const g = ctx.createRadialGradient(s.x - 1.6, s.y - 1.6, 1, s.x, s.y, 6)
        g.addColorStop(0, '#7a4a2a'); g.addColorStop(1, '#231007')
        ctx.fillStyle = g; ctx.shadowColor = '#ffb43c'; ctx.shadowBlur = 4 + 8 * pulse
        ctx.beginPath(); ctx.arc(s.x, s.y, 5.5, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = `rgba(255,200,80,${0.6 + 0.4 * pulse})`
        ctx.beginPath(); ctx.arc(s.x, s.y - 8, 1.4 + pulse, 0, Math.PI * 2); ctx.fill()
        ctx.restore()
      } else if (s.kind === 'bolt') {                        // mirror's fast energy bolt
        ctx.save()
        ctx.strokeStyle = 'rgba(150,220,255,0.55)'; ctx.lineWidth = 4; ctx.shadowColor = '#7ee0ff'; ctx.shadowBlur = 11; ctx.lineCap = 'round'
        ctx.beginPath(); ctx.moveTo(s.x - dx * 17, s.y - dy * 17); ctx.lineTo(s.x, s.y); ctx.stroke()
        ctx.strokeStyle = '#eaffff'; ctx.lineWidth = 1.8
        ctx.beginPath(); ctx.moveTo(s.x - dx * 8, s.y - dy * 8); ctx.lineTo(s.x, s.y); ctx.stroke()
        ctx.restore()
      } else if (s.kind === 'seeker') {                      // homing missile + flame trail
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        for (let i = 1; i <= 3; i++) { ctx.globalAlpha = 0.45 / i; ctx.fillStyle = i === 1 ? '#ffd24a' : '#ff7043'; ctx.beginPath(); ctx.arc(s.x - dx * i * 5, s.y - dy * i * 5, 3 - i * 0.6, 0, Math.PI * 2); ctx.fill() }
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1
        ctx.translate(s.x, s.y); ctx.rotate(Math.atan2(dy, dx))
        ctx.fillStyle = '#dbe3ee'; ctx.shadowColor = '#ff5b3a'; ctx.shadowBlur = 6
        ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-3, -3.2); ctx.lineTo(-3, 3.2); ctx.closePath(); ctx.fill()
        ctx.fillStyle = '#ff5b3a'; ctx.fillRect(-4.5, -2, 2.2, 4)
        ctx.restore()
      } else {                                               // basic round bolt (shot / spread)
        const tx = s.x - dx * 9, ty = s.y - dy * 9
        ctx.strokeStyle = 'rgba(255,90,80,0.5)'; ctx.lineWidth = 2
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(s.x, s.y); ctx.stroke()
        ctx.shadowColor = '#ff3b3b'; ctx.shadowBlur = 8
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, 4)
        g.addColorStop(0, '#fff0e0'); g.addColorStop(0.5, '#ff5a45'); g.addColorStop(1, 'rgba(255,60,40,0)')
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.x, s.y, 3.5, 0, Math.PI * 2); ctx.fill()
        ctx.shadowBlur = 0
      }
    }
    ctx.restore()
  }

  /** A few twinkling 4-point sparkles over a brick (seed or mega). */
  #sparkle(b: Brick, time: number, n: number): void {
    const ctx = this.#ctx
    ctx.save()
    ctx.fillStyle = '#fffbe6'
    ctx.shadowColor = '#ffe9a8'; ctx.shadowBlur = 6
    const iw = Math.max(2, b.w - 12), ih = Math.max(2, b.h - 10)
    for (let i = 0; i < n; i++) {
      const px = b.x + 6 + ((i * 37 + 13) % iw)
      const py = b.y + 5 + ((i * 53 + 7) % ih)
      const tw = 0.5 + 0.5 * Math.sin(time * 5 + i * 1.7)
      ctx.globalAlpha = tw
      const r = 1 + 2 * tw
      ctx.fillRect(px - r, py - 0.6, r * 2, 1.2)
      ctx.fillRect(px - 0.6, py - r, 1.2, r * 2)
    }
    ctx.restore()
  }

  /** Paint one brick. `wear` is hp/max (1 = fresh, →0 = nearly dead). Damaged
   *  bricks DARKEN + DESATURATE toward a charred grey-brown rather than fading
   *  alpha, so a battered brick reads as obviously cracked/charred while the
   *  shape stays solid (crisp top highlight + a clear darker edge). Heavily
   *  damaged bricks also get a couple of dark crack lines. */
  #drawBrick(x: number, y: number, w: number, h: number, baseHex: string, wear: number): void {
    const ctx = this.#ctx
    const fresh = hexRgb(baseHex)
    // 0 = full damage, 1 = fresh. Pull the colour toward charred and darken it as
    // wear falls. Squaring keeps the first hit subtle and the last hit dramatic.
    const dmg = 1 - Math.max(0, Math.min(1, wear))
    const toward = dmg * dmg
    const body = mix(fresh, BRICK_CHARRED, toward * 0.82)
    const top = mix(body, { r: 255, g: 255, b: 255 }, 0.45)   // bright glossy top of the gradient
    const shade = darken(body, 0.5)                           // rich (not muddy) bottom
    const rx = x + 1.5, ry = y + 1.5, rw = w - 3, rh = h - 3

    ctx.globalAlpha = 1
    // body — a vivid top-lit gradient (bright crown → saturated body → rich base)
    this.#roundRect(rx, ry, rw, rh, 4)
    const g = ctx.createLinearGradient(rx, ry, rx, ry + rh)
    g.addColorStop(0, rgbStr(top.r, top.g, top.b))
    g.addColorStop(0.42, rgbStr(body.r, body.g, body.b))
    g.addColorStop(1, rgbStr(shade.r, shade.g, shade.b))
    ctx.fillStyle = g
    ctx.fill()

    // bright lit shine-edge along the top + left (the arcade "this tile glows" cue)
    ctx.globalAlpha = 0.55 * (0.4 + 0.6 * wear)
    ctx.strokeStyle = rgbStr(Math.min(255, top.r + 28), Math.min(255, top.g + 28), Math.min(255, top.b + 28))
    ctx.lineWidth = 1.3; ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(rx + 4, ry + 0.8); ctx.lineTo(rx + rw - 4, ry + 0.8)
    ctx.moveTo(rx + 0.8, ry + 4); ctx.lineTo(rx + 0.8, ry + rh - 4)
    ctx.stroke()
    ctx.globalAlpha = 1

    // tinted ink contour — the cartoon outline that unifies the look (never #000)
    const ink = darken(body, 0.22)
    ctx.globalAlpha = 0.55 + 0.45 * wear
    this.#roundRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1, 3.5)
    this.#inkContour(rgbStr(ink.r, ink.g, ink.b), 1.6)
    ctx.globalAlpha = 1

    // ONE hard-edged cel shadow band across the lower ~42% (cel-shading read)
    if (rw >= 6 && rh >= 6) {
      ctx.save()
      this.#roundRect(rx, ry, rw, rh, 4); ctx.clip()
      const band = darken(body, 0.62)
      ctx.globalAlpha = 0.32; ctx.fillStyle = rgbStr(band.r, band.g, band.b)
      ctx.fillRect(rx, ry + rh * 0.58, rw, rh * 0.42)
      ctx.restore()
    }

    // GLOSS — a candy specular sweep across the top + a plastic hotspot
    ctx.globalAlpha = 0.5 * (0.45 + 0.55 * wear)
    const gloss = ctx.createLinearGradient(rx, ry, rx, ry + rh * 0.55)
    gloss.addColorStop(0, 'rgba(255,255,255,0.92)'); gloss.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gloss
    this.#roundRect(rx + 2, ry + 1.2, rw - 4, rh * 0.42, 3)
    ctx.fill()
    ctx.globalAlpha = 0.5 * wear
    ctx.fillStyle = '#ffffff'
    ctx.beginPath(); ctx.ellipse(rx + rw * 0.26, ry + rh * 0.34, rw * 0.15, rh * 0.2, -0.35, 0, Math.PI * 2); ctx.fill()
    ctx.globalAlpha = 1

    // Branching fracture network that grows as the brick disintegrates.
    this.#cracks(rx, ry, rw, rh, dmg)
  }

  /** Organic, branching fracture cracks that accumulate as damage rises
   *  (dmg = 1 - wear). Each crack's shape is seeded per brick+index so existing
   *  cracks stay put and only NEW ones appear on each hit (no flicker / reshuffle);
   *  every crack is drawn as a dark fissure with a 1px lit edge so it reads as an
   *  engraved groove rather than a flat scribble. */
  #cracks(rx: number, ry: number, rw: number, rh: number, dmg: number): void {
    if (dmg <= 0.05 || rw < 6 || rh < 6) return
    const ctx = this.#ctx
    const cx = rx + rw / 2, cy = ry + rh / 2
    const base = ((Math.floor(rx) * 374761393) ^ (Math.floor(ry) * 668265263)) | 0
    const nCracks = Math.max(1, Math.min(5, Math.round(dmg * 4)))
    const span = Math.min(rw, rh)
    ctx.save()
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    for (let i = 0; i < nCracks; i++) {
      const rnd = rngFrom(base + i * 1013904223 + 1)        // stable per crack (shape fixed across hits)
      const ang = rnd() * Math.PI * 2
      const len = span * (0.6 + 0.9 * rnd())
      this.#crackBranch(cx, cy, ang, len, 2, rnd, dmg, rx, ry, rw, rh)   // depth 2 → a lightning fork tree
    }
    ctx.restore()
  }

  /** One lightning-shaped crack bolt that recursively forks — "streams out like a
   *  branch". The whole tree depends only on the seeded `rnd`, so a crack stays
   *  put across hits and only its darkness/width grows with damage. */
  #crackBranch(sx: number, sy: number, ang: number, len: number, depth: number,
               rnd: () => number, dmg: number, rx: number, ry: number, rw: number, rh: number): void {
    const segs = 2 + Math.floor(rnd() * 2)
    const pts: [number, number][] = [[sx, sy]]
    let px = sx, py = sy, a = ang
    const step = len / segs
    for (let s = 0; s < segs; s++) {
      a += (rnd() - 0.5) * 1.15                              // sharp jag → reads as lightning
      px = Math.max(rx + 1, Math.min(rx + rw - 1, px + Math.cos(a) * step))
      py = Math.max(ry + 1, Math.min(ry + rh - 1, py + Math.sin(a) * step))
      pts.push([px, py])
    }
    this.#strokeCrack(pts, dmg)
    if (depth <= 0) return
    const forks = depth >= 2 ? 2 : 1
    for (let f = 0; f < forks; f++) {
      const p = pts[1 + Math.floor(rnd() * (pts.length - 1))] ?? pts[pts.length - 1]
      const ba = a + (f === 0 ? 1 : -1) * (0.5 + rnd() * 0.7)
      this.#crackBranch(p[0], p[1], ba, len * 0.58, depth - 1, rnd, dmg * 0.9, rx, ry, rw, rh)
    }
  }

  /** Stroke a crack polyline as an engraved groove: a lit far-wall highlight
   *  offset down-right, then the dark fissure on top. */
  #strokeCrack(pts: [number, number][], dmg: number): void {
    if (pts.length < 2) return
    const ctx = this.#ctx
    const lw = 0.7 + dmg * 1.1
    ctx.lineWidth = lw
    ctx.strokeStyle = `rgba(255,255,255,${0.10 + 0.14 * dmg})`
    ctx.beginPath(); ctx.moveTo(pts[0][0] + 0.7, pts[0][1] + 0.7)
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] + 0.7, pts[i][1] + 0.7)
    ctx.stroke()
    ctx.strokeStyle = `rgba(6,4,10,${0.5 + 0.4 * dmg})`
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1])
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
    ctx.stroke()
  }

  // The rotating gun: a dashed 120° arc above the bat (the fan the aim can
  // travel) plus a barrel + reticle dot at the current aim — slide the bat to
  // sweep it between the hard stops.
  #gunAim(engine: Engine, time: number): void {
    if (!engine.gunActive) return
    const ctx = this.#ctx
    const p = engine.paddle
    const cx = p.x, cy = p.y + p.h / 2
    const R = 46
    const a = engine.aimAngle
    ctx.save()
    // orbit arc — only the 120° fan the aim can sweep, not a full ring
    ctx.strokeStyle = 'rgba(176,123,255,0.35)'
    ctx.lineWidth = 1.5
    ctx.setLineDash([4, 5])
    ctx.beginPath(); ctx.arc(cx, cy, R, GUN_AIM_MIN, GUN_AIM_MAX); ctx.stroke()
    ctx.setLineDash([])
    // aim line
    ctx.strokeStyle = 'rgba(200,160,255,0.55)'
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.stroke()
    // barrel
    ctx.strokeStyle = '#d8c2ff'
    ctx.lineWidth = 5
    ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * 22, cy + Math.sin(a) * 22); ctx.stroke()
    // Diagonal barrels appear once the gun has stacked (L2+): the extra shots'
    // headings, clamped into the same up-fan so they always climb.
    if (engine.gunLevel >= 2) {
      ctx.strokeStyle = 'rgba(200,160,255,0.45)'
      ctx.lineWidth = 4
      for (const off of [-GUN_DIAG_SPREAD, GUN_DIAG_SPREAD]) {
        const da = Math.max(GUN_AIM_MIN, Math.min(GUN_AIM_MAX, a + off))
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(da) * 20, cy + Math.sin(da) * 20); ctx.stroke()
      }
    }
    // reticle dot
    const dotR = 4 + Math.sin(time * 8) * 1
    ctx.fillStyle = '#e9ddff'
    ctx.shadowColor = 'rgba(176,123,255,0.9)'; ctx.shadowBlur = 10
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * R, cy + Math.sin(a) * R, dotR, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }

  #paddle(engine: Engine, time = 0): void {
    const ctx = this.#ctx
    const p = engine.paddle
    const x = p.x - p.w / 2
    // health is shown by the bat itself (below) — no separate floating gauge
    // ── glossy cartoon bubble shield dome over the bat ──
    if (engine.shielded) {
      const heal = engine.regenTimer > 0
      const frac = engine.shieldHpFrac                                   // 1 fresh, 0 about to break
      const flash = engine.shieldFlash
      const base = hexRgb(heal ? '#43e0a8' : '#7A3CFF')                 // violet ghost-ward (heal = mint)
      const stress = Math.min(1, (1 - frac) * 0.85 + flash * 0.6)
      const c = mix(base, { r: 255, g: 90, b: 70 }, stress)             // reddens under stress
      const rim = mix(c, { r: 255, g: 255, b: 255 }, 0.45)              // bright rim highlight
      const col = rgbStr(c.r, c.g, c.b), rimCol = rgbStr(rim.r, rim.g, rim.b)
      const pulse = 0.5 + 0.5 * Math.sin(time * 6)
      const cy = p.y + p.h / 2
      const rx = p.w / 2 + 16, ry = (p.h + 22) * (0.45 + 0.55 * frac)   // dome shrinks toward the bat as it weakens
      ctx.save(); ctx.lineCap = 'round'
      // translucent glossy fill, brighter at the crown
      ctx.beginPath(); ctx.ellipse(p.x, cy, rx, ry, 0, Math.PI, Math.PI * 2)
      const bg = ctx.createLinearGradient(p.x, cy - ry, p.x, cy)
      bg.addColorStop(0, `rgba(${Math.round(rim.r)},${Math.round(rim.g)},${Math.round(rim.b)},${0.34 * (0.5 + 0.5 * frac)})`)
      bg.addColorStop(1, `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${0.10 * frac})`)
      ctx.fillStyle = bg; ctx.shadowColor = col; ctx.shadowBlur = 8 + 16 * flash; ctx.fill()
      // bright rim, glowing; flares on a hit
      ctx.beginPath(); ctx.ellipse(p.x, cy, rx, ry, 0, Math.PI, Math.PI * 2)
      ctx.strokeStyle = rimCol; ctx.lineWidth = 2 + 1.4 * pulse + flash * 4
      ctx.globalAlpha = Math.min(1, 0.55 + 0.3 * frac + 0.5 * flash); ctx.shadowBlur = 10 + 18 * flash
      ctx.stroke(); ctx.globalAlpha = 1; ctx.shadowBlur = 0
      // upper-left bubble shine crescent
      ctx.beginPath(); ctx.ellipse(p.x, cy, rx * 0.78, ry * 0.78, 0, Math.PI * 1.12, Math.PI * 1.42)
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2.2; ctx.globalAlpha = 0.5 + 0.4 * frac; ctx.stroke(); ctx.globalAlpha = 1
      // depletion meter — a bright top arc that narrows toward centre as the shield is chipped
      ctx.beginPath(); ctx.ellipse(p.x, cy, rx, ry, 0, 1.5 * Math.PI - 0.5 * Math.PI * frac, 1.5 * Math.PI + 0.5 * Math.PI * frac)
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.6 + flash * 3
      ctx.globalAlpha = Math.min(1, 0.6 + 0.3 * pulse + 0.5 * flash); ctx.shadowColor = rimCol; ctx.shadowBlur = 8 + 12 * flash; ctx.stroke()
      if (heal) {                                // healing shield: rising mint sparkles (fade as it weakens)
        ctx.shadowBlur = 0; ctx.globalAlpha = 0.7 * frac; ctx.fillStyle = '#caffe8'
        for (let i = 0; i < 3; i++) { const sx = p.x + Math.sin(time * 2 + i * 2) * p.w * 0.4; const sy = cy - ((time * 30 + i * 14) % (ry + 8)); ctx.beginPath(); ctx.arc(sx, sy, 1.6, 0, Math.PI * 2); ctx.fill() }
      }
      ctx.restore()
    }
    ctx.save()
    if (engine.pinballTimer > 0) {
      this.#flippers(engine)                   // real flippers replace the bat (+ its attachments)
      ctx.restore()
      return
    }
    // === THE PADDLE IS A SECTIONED ENERGY TANK — one clean casing whose charge
    //     DRAINS RIGHT→LEFT as you take damage. The five sections are marked by
    //     short engraved seams that "hang" from the top edge — not full dividers —
    //     for a refined, professional read. Glows on the shared candle pulse.
    //     (The fireball charge shows at the muzzle via #chargeOrb.) ===
    const candle = this.#pulse
    const r0 = p.h / 2
    const hpFrac = Math.max(0, Math.min(1, engine.paddleHpFrac))
    const band = hpFrac > 0.5 ? { top: '#bfffd6', mid: '#33e664', bot: '#179a4a' }   // spectral green
      : hpFrac > 0.25 ? { top: '#ffe7a3', mid: '#f5a82c', bot: '#b9760f' }            // candle amber
        : { top: '#ffc0c0', mid: '#f24b54', bot: '#9e242e' }                          // crimson
    const glow = hpFrac > 0.5 ? '#33e664' : hpFrac > 0.25 ? '#f5a82c' : '#f24b54'
    // dark casing — one clean machined shell
    this.#roundRect(x, p.y, p.w, p.h, r0)
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 9; ctx.shadowOffsetY = 1.5
    ctx.fillStyle = 'rgba(9,7,17,0.96)'; ctx.fill()
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0
    // continuous energy charge, left-anchored so the RIGHT end empties first
    const fw = Math.max(p.h, p.w * hpFrac)
    this.#roundRect(x, p.y, p.w, p.h, r0); ctx.save(); ctx.clip()
    const g = ctx.createLinearGradient(x, p.y, x, p.y + p.h)
    g.addColorStop(0, band.top); g.addColorStop(0.5, band.mid); g.addColorStop(1, band.bot)
    this.#roundRect(x, p.y, fw, p.h, r0); ctx.fillStyle = g
    ctx.shadowColor = glow; ctx.shadowBlur = 8 + 5 * candle; ctx.fill(); ctx.shadowBlur = 0
    // a soft inner-edge highlight at the leading (right) edge of the charge — reads as live energy
    ctx.globalAlpha = 0.5 + 0.3 * candle
    ctx.fillStyle = band.top; ctx.fillRect(Math.min(x + fw - 2.2, x + p.w - 2.2), p.y + 1.5, 2.2, p.h - 3)
    ctx.globalAlpha = 1
    // restrained top gloss sweep
    ctx.globalAlpha = 0.5
    const sweep = ctx.createLinearGradient(x, p.y, x, p.y + p.h * 0.55)
    sweep.addColorStop(0, 'rgba(255,255,255,0.7)'); sweep.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = sweep; this.#roundRect(x + 3, p.y + 1, Math.max(1, fw - 6), p.h * 0.4, p.h / 3); ctx.fill()
    ctx.globalAlpha = 1; ctx.restore()
    // 4 chunky SHORT "hanging" section seams (5 equal parts → 4 separations), biting in
    //   from the TOP and the BOTTOM edges (open in the middle so the charge flows through)
    const seamH = p.h * 0.3, seamW = 3.6
    for (let i = 1; i < 5; i++) {
      const nx = x + (p.w * i) / 5
      for (const ny of [p.y + 1.2, p.y + p.h - 1.2 - seamH]) {   // top notch + bottom notch
        ctx.fillStyle = 'rgba(6,4,14,0.5)'; ctx.fillRect(nx - seamW / 2, ny, seamW, seamH)
        ctx.fillStyle = 'rgba(255,255,255,0.16)'; ctx.fillRect(nx + seamW / 2 - 0.2, ny, 1, seamH)
      }
    }
    // crisp casing contour
    this.#roundRect(x, p.y, p.w, p.h, r0); this.#inkContour('rgba(6,3,14,0.85)', 1.3)
    // took a turret shot: a spectral-red wash over the tank, fading out
    const hf = engine.paddleHitFlashFrac
    if (hf > 0) {
      ctx.save(); ctx.globalAlpha = 0.55 * hf
      ctx.shadowColor = '#FF3B6A'; ctx.shadowBlur = 15 * hf
      this.#roundRect(x, p.y, p.w, p.h, r0); ctx.fillStyle = '#FF4D6A'; ctx.fill()
      ctx.restore()
    }
    ctx.restore()
  }

  /** Draw the two pinball flippers from the engine's raise state, sliding with the bat. */
  #flippers(engine: Engine): void {
    const fy = engine.paddle.y + FLIP_Y_OFF
    const cxp = engine.flipperCenterX
    const la = FLIP_REST + (FLIP_UP - FLIP_REST) * engine.flipLeftRaise
    const ra = (Math.PI - FLIP_REST) + ((Math.PI - FLIP_UP) - (Math.PI - FLIP_REST)) * engine.flipRightRaise
    this.#flipper(cxp - FLIP_PIVOT_DX, fy, la, engine.flipLeftRaise)
    this.#flipper(cxp + FLIP_PIVOT_DX, fy, ra, engine.flipRightRaise)
  }

  /** One chrome flipper: a tapered bar from pivot to tip, glowing when raised. */
  #flipper(px: number, py: number, ang: number, raise: number): void {
    const ctx = this.#ctx
    const tx = px + Math.cos(ang) * FLIP_LEN, ty = py + Math.sin(ang) * FLIP_LEN
    ctx.save()
    ctx.lineCap = 'round'
    ctx.shadowColor = `rgba(140,158,255,${0.45 + 0.5 * raise})`
    ctx.shadowBlur = 9 + 9 * raise
    const g = ctx.createLinearGradient(px, py, tx, ty)
    g.addColorStop(0, '#f0f4ff'); g.addColorStop(0.5, '#aeb9ff'); g.addColorStop(1, '#6b7cff')
    ctx.strokeStyle = g; ctx.lineWidth = 11
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(tx, ty); ctx.stroke()
    ctx.strokeStyle = '#6b7cff'; ctx.lineWidth = 6                  // tapered tip
    ctx.beginPath(); ctx.moveTo((px + tx) / 2, (py + ty) / 2); ctx.lineTo(tx, ty); ctx.stroke()
    ctx.shadowBlur = 0
    ctx.fillStyle = '#ffe9a8'; ctx.beginPath(); ctx.arc(px, py, 4.5, 0, Math.PI * 2); ctx.fill()   // pivot stud
    ctx.fillStyle = '#8a6d2a'; ctx.beginPath(); ctx.arc(px, py, 1.8, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }

  /** The beam power: a charging glow on the paddle middle, then a violet column
   *  flash up the screen on release. */
  #beam(engine: Engine): void {
    const ctx = this.#ctx
    const py = engine.paddle.y
    const flash = engine.beamFlashFrac
    if (flash > 0) {
      const bx = engine.beamX
      const w = 5 + 9 * flash
      ctx.save()
      ctx.globalAlpha = flash
      ctx.shadowColor = '#9d5cff'; ctx.shadowBlur = 18
      const g = ctx.createLinearGradient(bx - w, 0, bx + w, 0)
      g.addColorStop(0, 'rgba(157,92,255,0)'); g.addColorStop(0.5, '#ece0ff'); g.addColorStop(1, 'rgba(157,92,255,0)')
      ctx.fillStyle = g
      ctx.fillRect(bx - w, 0, w * 2, py)
      ctx.restore()
    } else if (engine.beamShots > 0) {
      const bx = engine.paddle.x
      const c = engine.beamChargeFrac
      ctx.save()
      ctx.globalAlpha = 0.5 + 0.5 * c
      ctx.shadowColor = '#9d5cff'; ctx.shadowBlur = 6 + 16 * c
      ctx.fillStyle = '#c9a8ff'
      ctx.beginPath(); ctx.arc(bx, py - 2, 2 + 5 * c, 0, Math.PI * 2); ctx.fill()
      if (c > 0.6) {                                   // a faint pre-beam as it nears release
        const h = py * ((c - 0.6) / 0.4)
        ctx.globalAlpha = (c - 0.6) / 0.4 * 0.45
        ctx.fillStyle = '#9d5cff'
        ctx.fillRect(bx - 1.5, py - h, 3, h)
      }
      ctx.restore()
    }
  }

  #darken(hex: string): string {
    const n = parseInt(hex.slice(1), 16)
    return `rgb(${Math.floor(((n >> 16) & 255) * 0.45)},${Math.floor(((n >> 8) & 255) * 0.45)},${Math.floor((n & 255) * 0.45)})`
  }

  /** Draw the random handful of pinball props — discs, targets, slings, fields, bars. */
  #pinballProps(props: readonly PinballProp[], time: number): void {
    const ctx = this.#ctx
    for (const p of props) {
      const s = PROP_STYLE[p.kind]; if (!s) continue
      const fl = p.flash
      ctx.save()
      ctx.shadowColor = s.c; ctx.shadowBlur = 6 + 12 * fl
      if (s.shape === 'disc') {
        const g = ctx.createRadialGradient(p.x - 3, p.y - 3, 1, p.x, p.y, p.r)
        g.addColorStop(0, '#ffffff'); g.addColorStop(0.45, s.c); g.addColorStop(1, this.#darken(s.c))
        ctx.fillStyle = (p.kind === 'jackpot' && !p.lit) ? 'rgba(110,100,40,0.7)' : g
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 + 0.12 * fl), 0, Math.PI * 2); ctx.fill()
        ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1.5; ctx.stroke()
        if (p.kind === 'extraball' && p.hp <= 0) { /* used — still a faint puck */ }
        if (s.label) { ctx.fillStyle = '#10131f'; ctx.font = '800 11px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(s.label, p.x, p.y + 0.5) }
      } else if (s.shape === 'ring') {
        ctx.strokeStyle = s.c; ctx.lineWidth = 3 + 2 * fl
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.stroke()
        ctx.globalAlpha = 0.3; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.5 + 0.3 * Math.sin(time * 4)), 0, Math.PI * 2); ctx.stroke()
      } else if (s.shape === 'target') {
        if ((p.kind === 'drop' || p.kind === 'bank') && p.hp <= 0) { ctx.restore(); continue }
        this.#roundRect(p.x - p.r, p.y - 7, p.r * 2, 14, 4)
        const g = ctx.createLinearGradient(p.x, p.y - 7, p.x, p.y + 7); g.addColorStop(0, fl > 0.3 ? '#fff' : s.c); g.addColorStop(1, this.#darken(s.c))
        ctx.fillStyle = g; ctx.fill()
        if (p.kind === 'bank') { ctx.shadowBlur = 0; for (let i = 0; i < 3; i++) { ctx.fillStyle = i < p.hp ? '#10131f' : 'rgba(255,255,255,0.4)'; ctx.beginPath(); ctx.arc(p.x - 8 + i * 8, p.y, 1.6, 0, Math.PI * 2); ctx.fill() } }
      } else if (s.shape === 'slingL' || s.shape === 'slingR') {
        const dir = s.shape === 'slingL' ? 1 : -1
        ctx.fillStyle = fl > 0.3 ? '#fff' : s.c
        ctx.beginPath(); ctx.moveTo(p.x - dir * p.r, p.y + p.r); ctx.lineTo(p.x + dir * p.r, p.y); ctx.lineTo(p.x - dir * p.r, p.y - p.r); ctx.closePath(); ctx.fill()
      } else if (s.shape === 'field') {
        ctx.globalAlpha = 0.16 + 0.22 * fl
        const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, p.r); g.addColorStop(0, s.c); g.addColorStop(1, s.c + '00')
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill()
        ctx.globalAlpha = 0.8; ctx.fillStyle = s.c; ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill()
      } else if (s.shape === 'spinner') {
        const a = time * (2 + 12 * fl)
        ctx.strokeStyle = s.c; ctx.lineWidth = 3; ctx.lineCap = 'round'
        ctx.beginPath(); ctx.moveTo(p.x - Math.cos(a) * p.r, p.y - Math.sin(a) * 4); ctx.lineTo(p.x + Math.cos(a) * p.r, p.y + Math.sin(a) * 4); ctx.stroke()
      } else if (s.shape === 'gate') {
        ctx.strokeStyle = s.c; ctx.lineWidth = 3
        ctx.beginPath(); ctx.moveTo(p.x - p.r, p.y); ctx.lineTo(p.x + p.r, p.y); ctx.stroke()
        ctx.fillStyle = s.c; ctx.beginPath(); ctx.moveTo(p.x, p.y - 6); ctx.lineTo(p.x - 4, p.y - 1); ctx.lineTo(p.x + 4, p.y - 1); ctx.closePath(); ctx.fill()
      } else {   // bar / rollover
        ctx.strokeStyle = p.lit ? '#fff' : s.c; ctx.lineWidth = p.lit ? 4 : 2.5; ctx.globalAlpha = p.lit ? 1 : 0.6
        ctx.beginPath(); ctx.moveTo(p.x - p.r, p.y); ctx.lineTo(p.x + p.r, p.y); ctx.stroke()
      }
      ctx.restore()
    }
  }

  #bumpers(bumpers: readonly Bumper[], time: number): void {
    if (!bumpers.length) return
    const ctx = this.#ctx
    for (const bm of bumpers) {
      ctx.save()
      const pulse = 0.6 + 0.4 * Math.sin(time * 4)
      const glow = Math.max(pulse, bm.flash)
      ctx.shadowColor = '#8c9eff'; ctx.shadowBlur = 12 + bm.flash * 18
      ctx.lineWidth = 3
      ctx.strokeStyle = `rgba(140,158,255,${0.5 + 0.5 * glow})`
      ctx.beginPath(); ctx.arc(bm.x, bm.y, bm.r, 0, Math.PI * 2); ctx.stroke()
      const g = ctx.createRadialGradient(bm.x, bm.y - 3, 2, bm.x, bm.y, bm.r * 0.7)
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, '#a9b4ff'); g.addColorStop(1, '#5a6cff')
      ctx.fillStyle = g
      ctx.beginPath(); ctx.arc(bm.x, bm.y, bm.r * 0.62, 0, Math.PI * 2); ctx.fill()
      if (bm.flash > 0) {
        ctx.globalAlpha = bm.flash
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2
        ctx.beginPath(); ctx.arc(bm.x, bm.y, bm.r + (1 - bm.flash) * 10, 0, Math.PI * 2); ctx.stroke()
      }
      ctx.restore()
    }
  }

  #ball(ball: Ball, time: number, fiery = false, pierce = false, frantic = false): void {
    const ctx = this.#ctx
    if (fiery) this.#ballFire(ball, time)                    // dynamite live: flames lick off the ball
    if (pierce) this.#ballPhase(ball, time)                  // pierce active: ghostly phasing aura + trail
    else if (frantic) this.#windTrail(ball)                  // FRENZY: streaking wind trail behind the doubled ball
    ctx.save()
    // squash/stretch along velocity — a base-speed (450) ball is round; only fast /
    // pinball balls stretch. Capped at 0.22 so it reads as juice, not a needle.
    const speed = Math.hypot(ball.vx, ball.vy)
    const sq = Math.max(0, Math.min(0.22, (speed / 450 - 1) * 0.18))
    if (sq > 0.001) {
      const dir = Math.atan2(ball.vy, ball.vx)
      ctx.translate(ball.x, ball.y); ctx.rotate(dir); ctx.scale(1 + sq, 1 - sq * 0.7); ctx.translate(-ball.x, -ball.y)
    }
    let base: string
    if (ball.primary) {
      // The will-o-wisp — a spectral green-white spirit you must keep alight; glows on the candle pulse.
      this.#neon(NEON_GREEN, 10, 8)
      ctx.shadowColor = pierce ? 'rgba(216,230,255,0.95)' : NEON_GREEN
    } else {
      // Coloured ammo fired by the gun / spawned by Break — expendable.
      this.#neon(ball.color, 6, 7)
    }
    // glowing orb — the primary is a green-white wisp core; ammo keeps its colour
    if (ball.primary && !pierce) {
      const g = ctx.createRadialGradient(ball.x - 1, ball.y - 1, 0.5, ball.x, ball.y, ball.r)
      g.addColorStop(0, '#F4FFEA'); g.addColorStop(0.55, '#9BFFB8'); g.addColorStop(1, '#2BE36B')
      ctx.fillStyle = g; base = NEON_GREEN
    } else {
      base = pierce ? '#eef4ff' : ball.color
      const sg = ctx.createRadialGradient(ball.x - ball.r * 0.35, ball.y - ball.r * 0.4, ball.r * 0.1, ball.x, ball.y, ball.r)
      sg.addColorStop(0, '#ffffff'); sg.addColorStop(0.38, base); sg.addColorStop(1, this.#darken(base))
      ctx.fillStyle = sg
    }
    ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2); ctx.fill()
    // soft cartoon contour — light grey on the white hero ball (a dark ring reads as a
    // hole), tinted-dark on coloured ammo. Before the specular so the hotspot stays last.
    ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2)
    this.#inkContour(ball.primary ? 'rgba(200,210,230,0.5)' : this.#darken(base), 1.4)
    // crisp specular dot
    ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(255,255,255,0.95)'
    ctx.beginPath(); ctx.arc(ball.x - ball.r * 0.32, ball.y - ball.r * 0.36, ball.r * 0.22, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }

  /** Pierce active: a ghostly icy halo with two offset afterimages, reading as the
   *  ball phasing THROUGH matter. */
  #ballPhase(ball: Ball, time: number): void {
    const ctx = this.#ctx
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    const dir = Math.atan2(ball.vy, ball.vx)
    for (let i = 1; i <= 2; i++) {                            // afterimages trailing behind the motion
      const bx = ball.x - Math.cos(dir) * i * ball.r * 1.1, by = ball.y - Math.sin(dir) * i * ball.r * 1.1
      ctx.globalAlpha = 0.28 / i
      ctx.fillStyle = '#bcd4ff'
      ctx.beginPath(); ctx.arc(bx, by, ball.r * (1 - i * 0.12), 0, Math.PI * 2); ctx.fill()
    }
    ctx.globalAlpha = 0.5 + 0.3 * Math.sin(time * 10)        // shimmering ring
    ctx.strokeStyle = '#d8e6ff'; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r + 3, 0, Math.PI * 2); ctx.stroke()
    ctx.restore()
  }

  /** Frenzy wind trail: fading afterimages + thin speed-lines streaking behind a
   *  doubled-speed ball, in its own glow hue. Additive so it reads as wind/motion. */
  #windTrail(ball: Ball): void {
    const ctx = this.#ctx
    const sp = Math.hypot(ball.vx, ball.vy)
    if (sp < 1) return
    const dx = ball.vx / sp, dy = ball.vy / sp
    const col = ball.primary ? '#9BFFB8' : ball.color        // green wisp / ammo colour
    ctx.save(); ctx.globalCompositeOperation = 'lighter'
    // fading afterimages behind the motion
    for (let i = 1; i <= 4; i++) {
      const bx = ball.x - dx * i * ball.r * 1.25, by = ball.y - dy * i * ball.r * 1.25
      ctx.globalAlpha = 0.34 / i
      ctx.fillStyle = col
      ctx.beginPath(); ctx.arc(bx, by, ball.r * (1.0 - i * 0.16), 0, Math.PI * 2); ctx.fill()
    }
    // thin wind speed-lines streaking back, fanned across the motion
    ctx.globalAlpha = 0.55; ctx.strokeStyle = ball.primary ? 'rgba(190,255,210,0.85)' : col
    ctx.lineWidth = 1.3; ctx.lineCap = 'round'
    const nx = -dy, ny = dx, len = ball.r * 4.5
    for (const k of [-1, 0, 1]) {
      const ox = nx * k * ball.r * 0.55, oy = ny * k * ball.r * 0.55
      ctx.beginPath()
      ctx.moveTo(ball.x + ox - dx * ball.r, ball.y + oy - dy * ball.r)
      ctx.lineTo(ball.x + ox - dx * (ball.r + len), ball.y + oy - dy * (ball.r + len))
      ctx.stroke()
    }
    ctx.restore()
  }

  /** A flaming halo + a few flickering tongues around a ball — drawn additively so
   *  the balls visibly burn while a dynamite crate is on the field. */
  #ballFire(ball: Ball, time: number): void {
    const ctx = this.#ctx
    const f = 0.6 + 0.4 * Math.sin(time * 22 + ball.x * 0.3)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    const g = ctx.createRadialGradient(ball.x, ball.y, 0, ball.x, ball.y, ball.r * 2.6)
    g.addColorStop(0, `rgba(255,214,96,${0.7 * f})`)
    g.addColorStop(0.5, `rgba(255,110,30,${0.4 * f})`)
    g.addColorStop(1, 'rgba(255,60,0,0)')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r * 2.6, 0, Math.PI * 2); ctx.fill()
    for (let i = -1; i <= 1; i++) {
      const fl = 0.5 + 0.5 * Math.sin(time * 26 + i * 2 + ball.x)
      const fx = ball.x + i * ball.r * 0.6
      const fy = ball.y - ball.r - 2 - (1 + fl) * 3
      ctx.fillStyle = `rgba(255,${150 + Math.floor(70 * fl)},50,${0.45 * f})`
      ctx.beginPath(); ctx.ellipse(fx, fy, ball.r * 0.42, ball.r * (0.7 + 0.5 * fl), 0, 0, Math.PI * 2); ctx.fill()
    }
    ctx.restore()
  }

  /** The ball & chain: a beaded chain from the white ball to a spiked steel
   *  wrecking ball swinging on the end. */
  #ballChain(engine: Engine, time: number): void {
    const c = engine.chainBall
    if (!c) return
    const p = engine.balls.find(b => b.primary)
    if (!p) return
    const ctx = this.#ctx
    const dx = c.x - p.x, dy = c.y - p.y, d = Math.hypot(dx, dy) || 1
    ctx.save()
    ctx.strokeStyle = 'rgba(150,155,165,0.7)'; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(c.x, c.y); ctx.stroke()
    const links = Math.max(3, Math.floor(d / 7))
    for (let i = 1; i < links; i++) {
      const t = i / links, lx = p.x + dx * t, ly = p.y + dy * t
      ctx.fillStyle = i % 2 ? '#b6bbc4' : '#71757e'
      ctx.beginPath(); ctx.arc(lx, ly, 2.1, 0, Math.PI * 2); ctx.fill()
    }
    ctx.fillStyle = '#5a5f68'                               // spikes
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + time * 0.6
      ctx.beginPath()
      ctx.moveTo(c.x + Math.cos(a) * 13, c.y + Math.sin(a) * 13)
      ctx.lineTo(c.x + Math.cos(a - 0.2) * 8, c.y + Math.sin(a - 0.2) * 8)
      ctx.lineTo(c.x + Math.cos(a + 0.2) * 8, c.y + Math.sin(a + 0.2) * 8)
      ctx.closePath(); ctx.fill()
    }
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 6   // steel sphere
    const g = ctx.createRadialGradient(c.x - 3, c.y - 3, 1, c.x, c.y, 10)
    g.addColorStop(0, '#dfe3ea'); g.addColorStop(0.5, '#9aa0aa'); g.addColorStop(1, '#4a4f58')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(c.x, c.y, 9, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }

  /** Clock freeze: a cool blue wash over the field + frost spikes on frozen white balls. */
  #freeze(engine: Engine, time: number): void {
    const ctx = this.#ctx
    ctx.save()
    ctx.fillStyle = 'rgba(126,224,255,0.08)'
    ctx.fillRect(0, 0, W, H)
    ctx.strokeStyle = 'rgba(190,235,255,0.9)'; ctx.lineWidth = 1.5
    ctx.shadowColor = '#7ee0ff'; ctx.shadowBlur = 8
    for (const b of engine.balls) {
      if (!b.primary) continue
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + time * 0.5
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + Math.cos(a) * (b.r + 5), b.y + Math.sin(a) * (b.r + 5)); ctx.stroke()
      }
    }
    ctx.restore()
  }

  /** The time-clock pickup: a cyan clock face with sweeping hands. */
  #clockCapsule(x: number, y: number, time: number): void {
    const ctx = this.#ctx
    ctx.save()
    ctx.shadowColor = '#7ee0ff'; ctx.shadowBlur = 10
    const g = ctx.createRadialGradient(x - 2, y - 2, 1, x, y, 10)
    g.addColorStop(0, '#eaffff'); g.addColorStop(0.6, '#7ee0ff'); g.addColorStop(1, '#2a8fb0')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill()
    ctx.shadowBlur = 0
    ctx.strokeStyle = '#0b3a4a'; ctx.lineWidth = 1.2
    ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke()
    ctx.strokeStyle = 'rgba(11,58,74,0.7)'; ctx.lineWidth = 1
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * 7.5, y + Math.sin(a) * 7.5); ctx.lineTo(x + Math.cos(a) * 9, y + Math.sin(a) * 9); ctx.stroke() }
    ctx.strokeStyle = '#0b2a36'; ctx.lineWidth = 1.6; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(time * 1.2) * 6, y + Math.sin(time * 1.2) * 6); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(time * 0.4) * 4, y + Math.sin(time * 0.4) * 4); ctx.stroke()
    ctx.restore()
  }

  /** The gold paper-crane jackpot prize — a folded origami crane that flutters down. */
  #paperCrane(x: number, y: number, time: number): void {
    const ctx = this.#ctx
    const flap = Math.sin(time * 7)                    // wing flap
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(Math.sin(time * 2.2) * 0.12)            // gentle sway as it falls
    ctx.shadowColor = '#ffcf3a'; ctx.shadowBlur = 16
    const gold = ctx.createLinearGradient(-18, -14, 18, 14)
    gold.addColorStop(0, '#fff3b0'); gold.addColorStop(0.5, '#ffd24a'); gold.addColorStop(1, '#e0a516')
    ctx.fillStyle = '#e0a516'                          // far wing (behind)
    ctx.beginPath(); ctx.moveTo(-2, -1); ctx.lineTo(-20, -10 - 6 * flap); ctx.lineTo(-4, 4); ctx.closePath(); ctx.fill()
    ctx.fillStyle = gold                               // tail
    ctx.beginPath(); ctx.moveTo(-2, 0); ctx.lineTo(-16, -2); ctx.lineTo(-6, 6); ctx.closePath(); ctx.fill()
    ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(2, -5); ctx.lineTo(8, 1); ctx.lineTo(1, 6); ctx.closePath(); ctx.fill()   // body diamond
    ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 2.4; ctx.lineCap = 'round'    // neck
    ctx.beginPath(); ctx.moveTo(5, -2); ctx.lineTo(15, -12); ctx.stroke()
    ctx.fillStyle = '#ffe98a'                          // head / beak
    ctx.beginPath(); ctx.moveTo(15, -12); ctx.lineTo(21, -12); ctx.lineTo(15, -8); ctx.closePath(); ctx.fill()
    ctx.fillStyle = gold                               // near wing (flapping)
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(18, -12 - 8 * flap); ctx.lineTo(6, 4); ctx.closePath(); ctx.fill()
    ctx.strokeStyle = 'rgba(140,90,10,0.5)'; ctx.lineWidth = 1                 // a fold crease
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(12, -8 - 5 * flap); ctx.stroke()
    ctx.restore()
    const sp = 0.5 + 0.5 * Math.sin(time * 5)          // a sparkle
    ctx.save(); ctx.globalAlpha = sp; ctx.fillStyle = '#fffbe0'
    ctx.beginPath(); ctx.arc(x + 16, y - 12, 1.6 + sp, 0, Math.PI * 2); ctx.fill(); ctx.restore()
  }

  #capsules(capsules: readonly Capsule[], time: number): void {
    const ctx = this.#ctx
    for (const cap of capsules) {
      const meta = POWER_META[cap.kind]
      // a little flashy: a soft pulsing aura so the bonus reads as it falls
      const pulse = 0.5 + 0.5 * Math.sin(time * 6 + cap.x * 0.3)
      ctx.save()
      const aura = ctx.createRadialGradient(cap.x, cap.y, 2, cap.x, cap.y, 15 + 4 * pulse)
      aura.addColorStop(0, meta.color + '55'); aura.addColorStop(1, meta.color + '00')
      ctx.fillStyle = aura
      ctx.beginPath(); ctx.arc(cap.x, cap.y, 15 + 4 * pulse, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
      // gentle falling wobble — a slow side bob + tiny vertical bob + lazy tilt (the soft aura above does NOT wobble)
      const wob = Math.sin(time * 3.2 + cap.x * 0.12)
      const tilt = wob * 0.10
      const dx = cap.x + wob * 2.2, dy = cap.y + Math.sin(time * 4.6 + cap.x * 0.12) * 1.3
      if (cap.kind === 'oscillate' || cap.kind === 'beam') { this.#mushroom(dx, dy, meta.color, tilt); continue }   // magic mushrooms
      if (cap.kind === 'clock') { this.#clockCapsule(cap.x, cap.y, time); continue }                                // the time clock
      if (cap.kind === 'crane') { this.#paperCrane(cap.x, cap.y, time); continue }                                  // the gold paper-crane jackpot
      if (cap.kind === 'extralife') { this.#lifeCapsule(dx, dy, tilt, time); continue }                             // the 1UP heart
      // generic glossy candy capsule — chunky body, ink outline, gloss highlight, bold glyph
      const w = 32, h = 17, r = h / 2
      ctx.save(); ctx.translate(dx, dy); ctx.rotate(tilt)
      const lx = -w / 2, ly = -h / 2
      const cbase = hexRgb(meta.color)
      const lite = mix(cbase, { r: 255, g: 255, b: 255 }, 0.55)
      const deep = darken(cbase, 0.62)
      const ink = this.#darken(meta.color)
      ctx.shadowColor = meta.color; ctx.shadowBlur = 14
      this.#roundRect(lx, ly, w, h, r)
      const g = ctx.createLinearGradient(0, ly, 0, ly + h)
      g.addColorStop(0, rgbStr(lite.r, lite.g, lite.b)); g.addColorStop(0.45, rgbStr(cbase.r, cbase.g, cbase.b)); g.addColorStop(1, rgbStr(deep.r, deep.g, deep.b))
      ctx.fillStyle = g; ctx.fill(); ctx.shadowBlur = 0
      this.#roundRect(lx + 0.5, ly + 0.5, w - 1, h - 1, r - 0.5); this.#inkContour(ink, 2)
      ctx.beginPath(); ctx.ellipse(0, ly + h * 0.30, w * 0.36, h * 0.24, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fill()
      ctx.beginPath(); ctx.arc(-w * 0.26, ly + h * 0.28, 1.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.fill()
      ctx.font = '800 12px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'
      ctx.strokeStyle = ink; ctx.lineWidth = 3; ctx.strokeText(meta.letter, 0, 1)
      ctx.fillStyle = '#ffffff'; ctx.fillText(meta.letter, 0, 1)
      ctx.restore()
    }
    void time
  }

  /** The oscillate pickup, drawn as a magic mushroom: a spotted dome cap in the
   *  power colour over a cream stem. */
  #mushroom(cx: number, cy: number, color: string, tilt = 0): void {
    const ctx = this.#ctx
    const base = hexRgb(color)
    const lite = mix(base, { r: 255, g: 255, b: 255 }, 0.5)
    const deep = darken(base, 0.55)
    const ink = this.#darken(color)
    const squash = 1 + tilt * 0.6                                    // breathes ±6% as it falls
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(tilt * 0.5)                                           // mushrooms feel heavier — half the lozenge tilt
    ctx.shadowColor = color; ctx.shadowBlur = 12
    // --- STEM (creamy, beveled) ---
    const sg = ctx.createLinearGradient(-5, 0, 5, 0)
    sg.addColorStop(0, '#fff6e2'); sg.addColorStop(0.5, '#fbe7c6'); sg.addColorStop(1, '#e7c79a')
    this.#roundRect(-5, -1, 10, 13, 4); ctx.fillStyle = sg; ctx.fill()
    ctx.shadowBlur = 0
    this.#roundRect(-5, -1, 10, 13, 4); this.#inkContour(ink, 1.6)
    this.#roundRect(-3.6, 0.5, 2.2, 10, 1.1); ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fill()
    // --- CAP (rounder glossy dome) ---
    ctx.shadowColor = color; ctx.shadowBlur = 12
    ctx.beginPath(); ctx.ellipse(0, 0, 14, 12 * squash, 0, Math.PI, 2 * Math.PI); ctx.closePath()
    const dg = ctx.createLinearGradient(0, -12 * squash, 0, 0)
    dg.addColorStop(0, rgbStr(lite.r, lite.g, lite.b)); dg.addColorStop(0.5, rgbStr(base.r, base.g, base.b)); dg.addColorStop(1, rgbStr(deep.r, deep.g, deep.b))
    ctx.fillStyle = dg; ctx.fill()
    ctx.shadowBlur = 0
    ctx.beginPath(); ctx.ellipse(0, 0, 14, 12 * squash, 0, Math.PI, 2 * Math.PI); ctx.closePath(); this.#inkContour(ink, 2)
    // broad glossy sheen across the cap
    ctx.beginPath(); ctx.ellipse(-2, -7 * squash, 7, 3.4, -0.25, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fill()
    // dark rim band under the cap so it reads separate from the stem
    this.#roundRect(-13, -2.5, 26, 3, 1.5); ctx.fillStyle = rgbStr(deep.r, deep.g, deep.b); ctx.globalAlpha = 0.5; ctx.fill(); ctx.globalAlpha = 1
    // --- GLOSSY RAISED SPOTS (creamy disc + faint outline + gloss dot) ---
    for (const [sx, sy, sr] of [[-7, -6, 2.6], [4, -7.5, 2.1], [9, -3, 1.6], [-1, -3, 2.3], [6, -1.5, 1.3]] as const) {
      ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fillStyle = '#fffaf0'; ctx.fill()
      this.#inkContour('rgba(120,90,50,0.45)', 0.8)
      ctx.beginPath(); ctx.arc(sx - sr * 0.35, sy - sr * 0.35, sr * 0.4, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.fill()
    }
    ctx.restore()
  }

  /** The 1-UP / extra-life pill: a glossy green cartoon heart reading "1UP". */
  #lifeCapsule(cx: number, cy: number, tilt: number, time: number): void {
    const ctx = this.#ctx
    const green = hexRgb('#5fe08a')
    const lite = mix(green, { r: 255, g: 255, b: 255 }, 0.5)
    const deep = darken(green, 0.55)
    const ink = this.#darken('#2f9e5a')
    const beat = 1 + 0.06 * Math.sin(time * 6)                       // a tiny heartbeat pulse
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(tilt)
    const drawHeart = (s: number) => {
      const yo = -3
      ctx.beginPath()
      ctx.moveTo(0, yo + 9 * s)
      ctx.bezierCurveTo(-11 * s, yo - 1 * s, -10 * s, yo - 11 * s, 0, yo - 4 * s)
      ctx.bezierCurveTo(10 * s, yo - 11 * s, 11 * s, yo - 1 * s, 0, yo + 9 * s)
      ctx.closePath()
    }
    // glossy green fill
    ctx.shadowColor = '#5fe08a'; ctx.shadowBlur = 14
    drawHeart(beat)
    const g = ctx.createLinearGradient(0, -14, 0, 10)
    g.addColorStop(0, rgbStr(lite.r, lite.g, lite.b)); g.addColorStop(0.5, rgbStr(green.r, green.g, green.b)); g.addColorStop(1, rgbStr(deep.r, deep.g, deep.b))
    ctx.fillStyle = g; ctx.fill(); ctx.shadowBlur = 0
    // bold ink outline
    drawHeart(beat); this.#inkContour(ink, 2.2)
    // glossy highlights
    ctx.beginPath(); ctx.ellipse(-4.5 * beat, -7 * beat, 3.6, 2.4, -0.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fill()
    ctx.beginPath(); ctx.arc(4 * beat, -6 * beat, 1.3, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fill()
    // warm-pink "1UP" banner across the heart's lower middle
    ctx.rotate(-tilt * 0.3)                                          // keep the text near-upright vs the heart tilt
    const bw = 26, bh = 11, bx = -bw / 2, by = 1
    this.#roundRect(bx, by, bw, bh, bh / 2)
    const bg = ctx.createLinearGradient(0, by, 0, by + bh)
    bg.addColorStop(0, '#ffd0e0'); bg.addColorStop(0.5, '#ff7eb0'); bg.addColorStop(1, '#e0457f')
    ctx.fillStyle = bg; ctx.fill()
    this.#roundRect(bx, by, bw, bh, bh / 2); this.#inkContour(this.#darken('#c83a72'), 1.6)
    this.#roundRect(bx + 2, by + 1.4, bw - 4, bh * 0.34, bh / 4); ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fill()
    // "1UP" text — white with a dark-pink ink halo
    ctx.font = '900 9px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'
    ctx.strokeStyle = this.#darken('#c83a72'); ctx.lineWidth = 2.5; ctx.strokeText('1UP', 0, by + bh / 2 + 0.5)
    ctx.fillStyle = '#ffffff'; ctx.fillText('1UP', 0, by + bh / 2 + 0.5)
    ctx.restore()
  }

  /** The growing plasma orb at the bat muzzle while the fire input is HELD, plus the
   *  white launch-kick ring on release. Colour escalates with the charge tier. */
  #chargeOrb(engine: Engine, time: number): void {
    const ctx = this.#ctx
    const mx = engine.paddle.x, my = engine.paddle.y - 8
    const f = engine.laserChargeFrac
    if (engine.laserCharging && engine.laserShots > 0 && f > 0.001) {
      const tier = engine.laserTier
      const baseHex = tier >= 3 ? '#ff6bd5' : tier >= 2 ? '#ffb14e' : '#7ec8ff'
      const base = hexRgb(baseHex)
      const R = (4 + 11 * f) * (1 + 0.12 * Math.sin(time * 22))
      ctx.save(); ctx.globalCompositeOperation = 'lighter'
      // outer aura
      ctx.shadowColor = baseHex; ctx.shadowBlur = 10 + 26 * f
      const g = ctx.createRadialGradient(mx, my, 0, mx, my, R * 2.2)
      g.addColorStop(0, `rgba(255,255,255,${0.4 + 0.5 * f})`)
      g.addColorStop(0.35, rgbStr(base.r, base.g, base.b))
      g.addColorStop(1, `rgba(${Math.round(base.r)},${Math.round(base.g)},${Math.round(base.b)},0)`)
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(mx, my, R * 2.2, 0, Math.PI * 2); ctx.fill()
      // white-hot core
      ctx.shadowBlur = 0; ctx.fillStyle = `rgba(255,255,255,${0.6 + 0.4 * f})`
      ctx.beginPath(); ctx.arc(mx, my, R * 0.55, 0, Math.PI * 2); ctx.fill()
      // crackling energy arcs that intensify with charge (deterministic jitter)
      const bolts = 3 + Math.round(f * 4)
      ctx.strokeStyle = rgbStr(Math.min(255, base.r + 60), Math.min(255, base.g + 60), Math.min(255, base.b + 60)); ctx.lineWidth = 1.2
      for (let k = 0; k < bolts; k++) {
        const a = -Math.PI / 2 + (k / bolts - 0.5) * Math.PI * 1.1 + Math.sin(time * 18 + k) * 0.3
        const len = R * (1.4 + 1.2 * f) * (0.6 + 0.4 * Math.abs(Math.sin(time * 30 + k * 2)))
        ctx.beginPath(); ctx.moveTo(mx, my)
        for (let s = 1; s <= 3; s++) {
          const t2 = s / 3
          ctx.lineTo(mx + Math.cos(a) * len * t2 + Math.sin(time * 50 + k + s) * 3 * f, my + Math.sin(a) * len * t2 + Math.cos(time * 47 + k + s) * 3 * f)
        }
        ctx.stroke()
      }
      // gathering particles spiralling INTO the orb as it nears full
      if (f > 0.5) {
        ctx.globalAlpha = (f - 0.5) * 2; ctx.fillStyle = 'rgba(255,255,255,0.7)'
        for (let k = 0; k < 6; k++) {
          const a = time * 6 + k * Math.PI / 3, rr = R * (2.4 - 1.8 * ((time * 1.5 + k) % 1))
          ctx.beginPath(); ctx.arc(mx + Math.cos(a) * rr, my + Math.sin(a) * rr, 1.4, 0, Math.PI * 2); ctx.fill()
        }
        ctx.globalAlpha = 1
      }
      ctx.restore()
    }
    // launch kick — a quick white ring expanding off the muzzle on release
    const mf = engine.laserMuzzleFrac
    if (mf > 0) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = mf
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2 + 3 * mf
      ctx.beginPath(); ctx.arc(mx, my, 6 + 22 * (1 - mf), 0, Math.PI * 2); ctx.stroke()
      ctx.restore()
    }
  }

  /** Each in-flight fireball: a comet tail + motion streaks + a spinning white-hot
   *  plasma orb with swirl arms and crackling energy bolts. The Hadouken. */
  #fireballs(fbs: readonly Fireball[], time: number): void {
    if (!fbs.length) return
    const ctx = this.#ctx
    for (const fb of fbs) {
      const tier = fb.tier
      const baseHex = tier >= 3 ? '#ff6bd5' : tier >= 2 ? '#ffb14e' : '#7ec8ff'
      const rimHex = tier >= 3 ? '#5fd0e0' : tier >= 2 ? '#ffe24e' : '#bfe3ff'
      const base = hexRgb(baseHex), rim = hexRgb(rimHex)
      const x = fb.x, y = fb.y, R = fb.r, tailLen = fb.tail
      ctx.save(); ctx.globalCompositeOperation = 'lighter'
      // comet tail (down, opposite travel)
      const tg = ctx.createLinearGradient(x, y, x, y + tailLen)
      tg.addColorStop(0, rgbStr(base.r, base.g, base.b))
      tg.addColorStop(0.5, `rgba(${Math.round(base.r)},${Math.round(base.g)},${Math.round(base.b)},0.35)`)
      tg.addColorStop(1, `rgba(${Math.round(base.r)},${Math.round(base.g)},${Math.round(base.b)},0)`)
      ctx.fillStyle = tg
      ctx.beginPath(); ctx.moveTo(x - R * 0.7, y); ctx.quadraticCurveTo(x, y + tailLen * 0.6, x, y + tailLen); ctx.quadraticCurveTo(x, y + tailLen * 0.6, x + R * 0.7, y); ctx.closePath(); ctx.fill()
      // flickering inner tail wisps
      ctx.strokeStyle = rgbStr(rim.r, rim.g, rim.b); ctx.lineWidth = 1
      for (let k = 0; k < 3; k++) {
        const off = Math.sin(time * 40 + k * 2 + fb.t * 30) * R * 0.5
        ctx.globalAlpha = 0.4
        ctx.beginPath(); ctx.moveTo(x + off, y); ctx.lineTo(x + off * 0.3, y + tailLen * (0.5 + 0.2 * k)); ctx.stroke()
      }
      ctx.globalAlpha = 1
      // motion streaks behind, sells the speed
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.moveTo(x - R * 0.5, y + 2); ctx.lineTo(x - R * 0.5, y + tailLen * 0.4); ctx.moveTo(x + R * 0.5, y + 2); ctx.lineTo(x + R * 0.5, y + tailLen * 0.4); ctx.stroke()
      // spinning plasma orb — white-hot core → rim → base
      ctx.shadowColor = baseHex; ctx.shadowBlur = 14 + tier * 6
      const og = ctx.createRadialGradient(x, y, 0, x, y, R * 1.4)
      og.addColorStop(0, '#ffffff'); og.addColorStop(0.3, '#ffffff')
      og.addColorStop(0.55, rgbStr(rim.r, rim.g, rim.b)); og.addColorStop(0.8, rgbStr(base.r, base.g, base.b))
      og.addColorStop(1, `rgba(${Math.round(base.r)},${Math.round(base.g)},${Math.round(base.b)},0)`)
      ctx.fillStyle = og; ctx.beginPath(); ctx.arc(x, y, R * 1.4, 0, Math.PI * 2); ctx.fill()
      // rotating swirl arms (the Hadouken spin)
      ctx.save(); ctx.translate(x, y); ctx.rotate(fb.spin)
      ctx.strokeStyle = rgbStr(Math.min(255, rim.r + 40), Math.min(255, rim.g + 40), Math.min(255, rim.b + 40)); ctx.lineWidth = R * 0.35; ctx.globalAlpha = 0.6
      for (let a = 0; a < 2; a++) { ctx.beginPath(); ctx.arc(0, 0, R * 0.7, a * Math.PI, a * Math.PI + Math.PI * 0.7); ctx.stroke() }
      ctx.restore(); ctx.globalAlpha = 1
      // crackling energy bolts off the rim, denser at higher tiers
      const bolts = 2 + tier * 2
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1
      for (let k = 0; k < bolts; k++) {
        const a = fb.spin * 2 + k * (Math.PI * 2 / bolts)
        const len = R * (0.8 + 0.6 * Math.abs(Math.sin(time * 35 + k)))
        ctx.globalAlpha = 0.7
        ctx.beginPath()
        ctx.moveTo(Math.cos(a) * R * 0.9 + x, Math.sin(a) * R * 0.9 + y)
        ctx.lineTo(Math.cos(a) * (R * 0.9 + len) + x + Math.sin(time * 60 + k * 3) * 3, Math.sin(a) * (R * 0.9 + len) + y + Math.cos(time * 57 + k * 3) * 3)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      ctx.restore()
    }
  }

  #rockets(rockets: readonly Rocket[]): void {
    if (!rockets.length) return
    const ctx = this.#ctx
    for (const rk of rockets) {
      ctx.save()
      ctx.shadowColor = '#ff7043'; ctx.shadowBlur = 10
      // flame
      ctx.fillStyle = '#ffcf5e'
      ctx.beginPath(); ctx.moveTo(rk.x - 3, rk.y + 6); ctx.lineTo(rk.x + 3, rk.y + 6); ctx.lineTo(rk.x, rk.y + 13); ctx.closePath(); ctx.fill()
      // body (a little upward dart)
      ctx.fillStyle = '#ff7043'
      ctx.beginPath(); ctx.moveTo(rk.x, rk.y - 9); ctx.lineTo(rk.x + 4, rk.y + 6); ctx.lineTo(rk.x - 4, rk.y + 6); ctx.closePath(); ctx.fill()
      ctx.restore()
    }
  }

  /** The hunter: a detailed mechanical-organic sentinel. Pulsing aura, scanning
   *  antennae, a rotating armoured carapace whose 3 plates break as HP drops,
   *  reaching pincers, and a glowing slit eye that tracks the white ball. */
  /** An immaculate backdrop: a deep refined gradient, a soft top-light, a slow drifting
   *  aurora, a faint diamond lattice and a focusing vignette. Subtle by design — it
   *  sets a polished stage without competing with the play. */
  /** The Haunted Keep: deep moonlit night over a castle silhouette, per-floor sky,
   *  the candle stage-light breathing on the shared pulse. Stays DARK so neon bricks
   *  POP, keeps bright stuff out of the brick band (y 56-248). */
  #background(time: number, floor: Floor, pulse: number): void {
    const ctx = this.#ctx
    // 1 ── deep-night vertical gradient (per-floor sky)
    const g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, floor.sky[0]); g.addColorStop(0.55, floor.sky[1]); g.addColorStop(1, floor.sky[2])
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
    // 2 ── bone-white moon, low and cold, top-right
    const mx = W * 0.78, my = H * 0.12, mr = 26
    const moon = ctx.createRadialGradient(mx, my, 2, mx, my, mr * 3.2)
    moon.addColorStop(0, 'rgba(232,224,255,0.30)'); moon.addColorStop(0.18, 'rgba(232,224,255,0.10)'); moon.addColorStop(1, 'rgba(232,224,255,0)')
    ctx.fillStyle = moon; ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = 'rgba(232,224,255,0.92)'; ctx.shadowColor = 'rgba(232,224,255,0.6)'; ctx.shadowBlur = 22
    ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0
    // 3 ── candle stage-light in the floor's hue, breathing on the shared pulse
    const lit = 0.10 + 0.07 * pulse
    const glow = ctx.createRadialGradient(W / 2, -40, 20, W / 2, -40, H)
    glow.addColorStop(0, `rgba(${floor.mist},${lit})`); glow.addColorStop(1, `rgba(${floor.mist},0)`)
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H)
    // 4 ── the keep silhouette: crenellated towers + a ragged ridge, neon rim-lit
    this.#keepSilhouette(floor)
    // 5 ── faint neon dust motes drifting up
    ctx.fillStyle = `rgba(${floor.neonRgb},0.05)`
    let row = 0
    for (let yy = 26; yy < H; yy += 38, row++) {
      const drift = Math.sin(time * 0.2 + row) * 6
      for (let xx = (row % 2 ? 38 : 19); xx < W; xx += 38) {
        ctx.beginPath(); ctx.arc(xx + drift, yy - (time * 4 % 38), 0.9, 0, Math.PI * 2); ctx.fill()
      }
    }
    // 6 ── focusing vignette — deeper night
    const vg = ctx.createRadialGradient(W / 2, H * 0.46, H * 0.30, W / 2, H * 0.5, H * 0.82)
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.58)')
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H)
  }

  /** The keep's flat castle silhouette across the bottom third: a battlement ridge
   *  with two crenellated towers, near-black with a 1px neon rim + lit windows. */
  #keepSilhouette(floor: Floor): void {
    const ctx = this.#ctx
    const base = H * 0.86, ridge = H * 0.78
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(0, H); ctx.lineTo(0, ridge)
    const merlon = 18
    for (let x = 0, i = 0; x <= W; x += merlon, i++) {
      const up = i % 2 === 0 ? 0 : 7
      ctx.lineTo(x, ridge - up); ctx.lineTo(x + merlon, ridge - up)
    }
    for (const tx of [W * 0.18, W * 0.74]) {
      const tw = 46, ty = H * 0.58
      ctx.lineTo(tx - tw / 2, ridge); ctx.lineTo(tx - tw / 2, ty)
      for (let x = tx - tw / 2, j = 0; x < tx + tw / 2; x += 11, j++) { const up = j % 2 ? 0 : 6; ctx.lineTo(x, ty - up); ctx.lineTo(x + 11, ty - up) }
      ctx.lineTo(tx + tw / 2, ty); ctx.lineTo(tx + tw / 2, ridge)
    }
    ctx.lineTo(W, ridge); ctx.lineTo(W, H); ctx.closePath()
    ctx.fillStyle = '#05040A'; ctx.fill()
    ctx.lineWidth = 1; ctx.strokeStyle = `rgba(${floor.neonRgb},0.30)`; ctx.shadowColor = floor.neon; ctx.shadowBlur = 6; ctx.stroke()
    ctx.shadowBlur = 8; ctx.shadowColor = floor.accent
    ctx.fillStyle = `rgba(${floor.accentRgb},0.8)`
    for (const wx of [W * 0.18, W * 0.74]) { ctx.fillRect(wx - 3, base - 60, 6, 9); ctx.fillRect(wx - 3, base - 40, 6, 9) }
    ctx.restore()
  }

  /** Ambient keep life under the play field: drifting bats, floating spectral wisps,
   *  an occasional lightning flash, and a candle flicker — all on the shared pulse,
   *  deterministic off time (no per-frame randomness). */
  #atmosphere(time: number, pulse: number, floor: Floor): void {
    const ctx = this.#ctx
    ctx.save()
    // 1 ── LIGHTNING: a rare double-strike on a 14s cycle, flooding the keep cold-white
    const cyc = (time % 14) / 14
    const strike = cyc < 0.022 ? 1 : (cyc > 0.030 && cyc < 0.045) ? 0.7 : 0
    if (strike > 0) {
      ctx.fillStyle = `rgba(232,224,255,${0.22 * strike})`; ctx.fillRect(0, 0, W, H)
      const bx = W * (0.3 + 0.4 * ((Math.floor(time / 14) * 0.61803) % 1))
      ctx.globalCompositeOperation = 'lighter'
      ctx.strokeStyle = `rgba(255,255,255,${0.9 * strike})`; ctx.lineWidth = 2; ctx.shadowColor = '#E8E0FF'; ctx.shadowBlur = 16
      ctx.beginPath(); ctx.moveTo(bx, 0)
      for (let y = 0; y <= H * 0.5; y += 26) ctx.lineTo(bx + Math.sin(y * 0.13 + time) * 18, y)
      ctx.stroke(); ctx.globalCompositeOperation = 'source-over'; ctx.shadowBlur = 0
    }
    // 2 ── BATS: silhouettes flapping across looping lanes
    const flap = Math.sin(time * 9)
    for (let i = 0; i < 4; i++) {
      const lane = H * (0.14 + 0.13 * i)
      const speed = 38 + i * 9
      const bx = ((time * speed + i * 260) % (W + 120)) - 60
      const by = lane + Math.sin(time * 1.4 + i) * 16
      const s = 0.7 + 0.18 * i
      this.#bat(bx, by, s, flap * (i % 2 ? -1 : 1), floor)
    }
    // 3 ── WISPS: floating will-o-wisp orbs in the floor hue, twinkling on the pulse
    ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < 6; i++) {
      const wx = W * (0.08 + 0.16 * i) + Math.sin(time * 0.5 + i * 1.7) * 26
      const wy = H - ((time * (14 + i * 3) + i * 130) % (H + 60))
      const tw = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(time * 3 + i + pulse))
      const hue = i % 3 === 0 ? floor.accentRgb : floor.neonRgb
      const r = 2.4 + 1.6 * tw
      const g = ctx.createRadialGradient(wx, wy, 0, wx, wy, r * 3.2)
      g.addColorStop(0, `rgba(${hue},${0.55 * tw})`); g.addColorStop(0.4, `rgba(${hue},${0.22 * tw})`); g.addColorStop(1, `rgba(${hue},0)`)
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(wx, wy, r * 3.2, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = `rgba(232,224,255,${0.5 * tw})`; ctx.beginPath(); ctx.arc(wx, wy, 1, 0, Math.PI * 2); ctx.fill()
    }
    ctx.globalCompositeOperation = 'source-over'
    // 4 ── CANDLE FLICKER: a soft warm vignette breathing on the candle pulse
    const cand = 0.04 + 0.05 * pulse
    const cg = ctx.createRadialGradient(W / 2, H * 0.55, H * 0.2, W / 2, H * 0.55, H * 0.75)
    cg.addColorStop(0, `rgba(255,178,58,${cand})`); cg.addColorStop(1, 'rgba(255,178,58,0)')
    ctx.fillStyle = cg; ctx.fillRect(0, 0, W, H)
    ctx.restore()
  }

  /** One bat silhouette: a two-arc winged body; flap (-1..1) raises/drops the tips. */
  #bat(x: number, y: number, s: number, flap: number, floor: Floor): void {
    const ctx = this.#ctx
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s)
    ctx.fillStyle = '#040308'; ctx.strokeStyle = `rgba(${floor.neonRgb},0.22)`; ctx.lineWidth = 0.6
    const lift = flap * 6
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.quadraticCurveTo(-7, -4 - lift, -16, -1 - lift * 0.4)
    ctx.quadraticCurveTo(-10, 1, -5, 3)
    ctx.lineTo(0, 1)
    ctx.lineTo(5, 3)
    ctx.quadraticCurveTo(10, 1, 16, -1 - lift * 0.4)
    ctx.quadraticCurveTo(7, -4 - lift, 0, 0)
    ctx.closePath(); ctx.fill(); ctx.stroke()
    ctx.fillStyle = '#040308'; ctx.beginPath(); ctx.ellipse(0, 0, 2, 3, 0, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }

  /** Dispatch the enemy draw by kind — ten distinct silhouettes. */
  #enemy(enemy: Enemy, target: { x: number; y: number } | null, time: number): void {
    switch (enemy.kind) {
      case 'bomber': return this.#enemyBomber(enemy, time)
      case 'splitter': return this.#enemySplitter(enemy, time)
      case 'leech': return this.#enemyLeech(enemy, time)
      case 'mirror': return this.#enemyMirror(enemy, time)
      case 'orbit': return this.#enemyOrbit(enemy, time)
      case 'dart': return this.#enemyDart(enemy, time)
      case 'blink': return this.#enemyBlink(enemy, time)
      case 'polarity': return this.#enemyPolarity(enemy, time)
      case 'queen': return this.#enemyQueen(enemy, time)
      default: return this.#enemyHunter(enemy, target, time)
    }
  }

  /** Hunter (variant 0): the spiked homing bug — the archetype the others vary from. */
  #enemyHunter(enemy: Enemy, target: { x: number; y: number } | null, time: number): void {
    const ctx = this.#ctx
    const { x, y, hp } = enemy
    const V = ENEMY_LOOKS[((enemy.variant % ENEMY_LOOKS.length) + ENEMY_LOOKS.length) % ENEMY_LOOKS.length]
    const r = ENEMY_R
    const pulse = 0.5 + 0.5 * Math.sin(time * 3)
    const dmg = 1 - hp / 3                                   // 0 fresh → 1 nearly dead
    // look direction toward the ball (defaults to looking down)
    let lx = 0, ly = 0.5
    if (target) { const dx = target.x - x, dy = target.y - y, d = Math.hypot(dx, dy) || 1; lx = dx / d; ly = dy / d }
    ctx.save()

    // 1 ── aura (breathing, angrier as it's hurt)
    const aura = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 2.5)
    aura.addColorStop(0, `rgba(${V.aura},${0.22 + 0.16 * pulse + 0.18 * dmg})`)
    aura.addColorStop(1, `rgba(${V.aura},0)`)
    ctx.fillStyle = aura
    ctx.beginPath(); ctx.arc(x, y, r * 2.5, 0, Math.PI * 2); ctx.fill()

    // 2 ── antennae with glowing sensor tips (scanning, slight sway)
    ctx.lineCap = 'round'
    for (const s of [-1, 1]) {
      const base = -Math.PI / 2 + s * 0.5, sway = Math.sin(time * 2 + s) * 0.13
      const bx = x + Math.cos(base) * (r - 2), by = y + Math.sin(base) * (r - 2)
      const tx = x + Math.cos(base + sway) * (r + 11), ty = y + Math.sin(base + sway) * (r + 11)
      ctx.strokeStyle = V.dark; ctx.lineWidth = 1.6
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo((bx + tx) / 2 + s * 3, (by + ty) / 2, tx, ty); ctx.stroke()
      ctx.fillStyle = V.accent; ctx.shadowColor = V.accent; ctx.shadowBlur = 7
      ctx.beginPath(); ctx.arc(tx, ty, 1.7 + pulse, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0
    }

    // 3 ── reaching pincers (open/close, hooked tips)
    const open = 0.32 + 0.26 * (0.5 + 0.5 * Math.sin(time * 4))
    for (const s of [-1, 1]) {
      const a = Math.PI / 2 + s * open, baseR = r - 1, tipR = r + 10
      const nx = Math.cos(a + Math.PI / 2), ny = Math.sin(a + Math.PI / 2)
      const tipx = x + Math.cos(a - s * 0.18) * tipR, tipy = y + Math.sin(a - s * 0.18) * tipR
      ctx.beginPath()
      ctx.moveTo(x + Math.cos(a) * baseR + nx * 2.6, y + Math.sin(a) * baseR + ny * 2.6)
      ctx.quadraticCurveTo(x + Math.cos(a) * (baseR + 5) + nx * 1.6, y + Math.sin(a) * (baseR + 5) + ny * 1.6, tipx, tipy)
      ctx.quadraticCurveTo(x + Math.cos(a) * (baseR + 5) - nx * 1.6, y + Math.sin(a) * (baseR + 5) - ny * 1.6, x + Math.cos(a) * baseR - nx * 2.6, y + Math.sin(a) * baseR - ny * 2.6)
      ctx.closePath()
      ctx.fillStyle = V.mid; ctx.fill()
      ctx.fillStyle = V.accent; ctx.beginPath(); ctx.arc(tipx, tipy, 1, 0, Math.PI * 2); ctx.fill()   // tip glint
    }

    // 4 ── rotating spiked carapace (top-lit gradient; spike count varies by look)
    ctx.shadowColor = `rgba(${V.aura},0.55)`; ctx.shadowBlur = 12
    const spikes = V.spikes
    ctx.beginPath()
    for (let i = 0; i < spikes * 2; i++) {
      const ang = (i / (spikes * 2)) * Math.PI * 2 + time * 0.5
      const rr = i % 2 === 0 ? r + 4 : r - 0.5
      const px = x + Math.cos(ang) * rr, py = y + Math.sin(ang) * rr
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
    }
    ctx.closePath()
    const shell = ctx.createLinearGradient(x, y - r, x, y + r)
    shell.addColorStop(0, V.top); shell.addColorStop(0.5, V.mid); shell.addColorStop(1, V.bot)
    ctx.fillStyle = shell; ctx.fill()
    ctx.shadowBlur = 0

    // 5 ── HP armour plates across the top; lost ones go dark + spark
    for (let i = 0; i < 3; i++) {
      const a0 = -Math.PI / 2 - 0.72 + (i / 3) * 1.44
      const lost = i >= hp
      ctx.strokeStyle = lost ? 'rgba(20,10,14,0.9)' : V.accent; ctx.lineWidth = lost ? 2.6 : 2
      ctx.beginPath(); ctx.arc(x, y, r - 1.5, a0, a0 + 0.42); ctx.stroke()
      if (lost) {
        const sa = a0 + 0.21, sx = x + Math.cos(sa) * (r - 1.5), sy = y + Math.sin(sa) * (r - 1.5)
        ctx.fillStyle = `rgba(255,220,120,${0.35 + 0.6 * pulse})`
        ctx.beginPath(); ctx.arc(sx, sy, 1.1 + pulse, 0, Math.PI * 2); ctx.fill()
      }
    }

    // 6 ── inner bezel + rivets
    const bezel = ctx.createRadialGradient(x - 2, y - 3, 1, x, y, r - 1)
    bezel.addColorStop(0, V.bot); bezel.addColorStop(1, '#160208')
    ctx.fillStyle = bezel
    ctx.beginPath(); ctx.arc(x, y, r - 2, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = V.dark
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + time * 0.5
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * (r - 4), y + Math.sin(a) * (r - 4), 0.9, 0, Math.PI * 2); ctx.fill()
    }

    // 7 ── the eye: glowing socket, iris rings, tracking slit pupil, specular
    const er = r * 0.62
    const socket = ctx.createRadialGradient(x, y, 1, x, y, er)
    socket.addColorStop(0, '#ffffff'); socket.addColorStop(0.45, V.eye); socket.addColorStop(1, V.bot)
    ctx.fillStyle = socket; ctx.shadowColor = V.accent; ctx.shadowBlur = 8
    ctx.beginPath(); ctx.arc(x, y, er, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0
    ctx.strokeStyle = 'rgba(0,0,0,0.32)'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.arc(x, y, er * 0.78, 0, Math.PI * 2); ctx.stroke()
    ctx.beginPath(); ctx.arc(x, y, er * 0.55, 0, Math.PI * 2); ctx.stroke()
    const pxe = x + lx * er * 0.32, pye = y + ly * er * 0.32
    ctx.fillStyle = '#0a0205'
    ctx.beginPath(); ctx.ellipse(pxe, pye, er * 0.22, er * 0.62, 0, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.beginPath(); ctx.arc(pxe - er * 0.17, pye - er * 0.28, er * 0.14, 0, Math.PI * 2); ctx.fill()
    // angry V-brow over the eye, anchored to (and turning with) its gaze
    ctx.shadowBlur = 0
    const bx = x + lx * er * 0.32, by = y + ly * er * 0.32 - er * 0.9
    ctx.strokeStyle = V.dark; ctx.lineWidth = 2; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(bx - er * 0.5, by - er * 0.18); ctx.lineTo(bx, by + er * 0.12); ctx.lineTo(bx + er * 0.5, by - er * 0.18); ctx.stroke()
    ctx.restore()
  }

  /** Shared soft aura behind the simpler enemy silhouettes. */
  #enemyAura(x: number, y: number, rgb: string, time: number, k = 2.2): void {
    const ctx = this.#ctx, p = this.#pulse           // specters breathe on the shared candle, not nine sines
    void time
    const g = ctx.createRadialGradient(x, y, ENEMY_R * 0.5, x, y, ENEMY_R * k)
    g.addColorStop(0, `rgba(${rgb},${0.18 + 0.12 * p})`); g.addColorStop(1, `rgba(${rgb},0)`)
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, ENEMY_R * k, 0, Math.PI * 2); ctx.fill()
  }

  #diamond(x: number, y: number, r: number): void {
    const ctx = this.#ctx
    ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.8, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r * 0.8, y); ctx.closePath()
  }

  /** Bombardier — an amber mortar dome that strafes a high lane and drops bombs. */
  #enemyBomber(e: Enemy, time: number): void {
    const ctx = this.#ctx, x = e.x, y = e.y + Math.sin(time * 2 + x * 0.1) * 1.5   // gentle hover bob
    const fuse = 1 - Math.min(1, (e.cd ?? 1.8) / 1.8)
    this.#enemyAura(x, y, '255,150,40', time)
    ctx.save()
    // fins + twin thruster glows
    for (const s of [-1, 1]) {
      ctx.fillStyle = '#7a3a0f'; ctx.beginPath(); ctx.moveTo(x + s * 14, y - 4); ctx.lineTo(x + s * 22, y - 9); ctx.lineTo(x + s * 16, y + 3); ctx.closePath(); ctx.fill()
      ctx.fillStyle = `rgba(255,150,60,${0.5 + 0.4 * fuse})`; ctx.shadowColor = '#ff9f43'; ctx.shadowBlur = 6
      ctx.beginPath(); ctx.arc(x + s * 19, y - 5, 1.6, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0
    }
    // riveted dome with a top-lit gradient
    ctx.shadowColor = '#e2731a'; ctx.shadowBlur = 10
    const g = ctx.createLinearGradient(x, y - 12, x, y + 12)
    g.addColorStop(0, '#ffd29a'); g.addColorStop(0.4, '#e2731a'); g.addColorStop(1, '#6e3410')
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, 17, 11, 0, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0
    // hull bands + rivets
    ctx.strokeStyle = 'rgba(90,42,12,0.6)'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.ellipse(x, y, 12, 7.5, 0, 0, Math.PI * 2); ctx.stroke()
    ctx.fillStyle = '#5a2a0c'; for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.arc(x + i * 6, y - 5, 1, 0, Math.PI * 2); ctx.fill() }
    // glowing cockpit eye, tracking the bottom
    const eg = ctx.createRadialGradient(x, y - 1, 0.5, x, y - 1, 4.5)
    eg.addColorStop(0, '#fff6d8'); eg.addColorStop(0.6, '#ffb43c'); eg.addColorStop(1, '#7a3a0f')
    ctx.fillStyle = eg; ctx.shadowColor = '#ffd24a'; ctx.shadowBlur = 6
    ctx.beginPath(); ctx.arc(x, y - 1, 4, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#3a1808'; ctx.beginPath(); ctx.arc(x, y + 0.5, 1.5, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0
    // belly hatch glowing brighter as the fuse nears
    ctx.fillStyle = `rgba(255,180,60,${0.35 + 0.6 * fuse})`; ctx.shadowColor = '#ffb43c'; ctx.shadowBlur = 4 + 12 * fuse
    ctx.beginPath(); ctx.arc(x, y + 9, 4 + 1.8 * fuse, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }

  /** Mitosis Pod — a blue-green dividing cell that drifts and splits when hit. */
  #enemySplitter(e: Enemy, time: number): void {
    const ctx = this.#ctx, sep = (e.split ?? 0) > 0 ? 6 : 1.5
    const seam = 0.5 + 0.5 * Math.sin(time * 5), breathe = 1 + 0.05 * Math.sin(time * 3)
    this.#enemyAura(e.x, e.y, '70,200,140', time, 1.9)
    ctx.save()
    for (const s of [-1, 1]) {
      const cx = e.x + s * sep, r = 11 * breathe
      // wiggling cilia around the membrane
      ctx.strokeStyle = 'rgba(120,224,170,0.55)'; ctx.lineWidth = 1
      for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2 + time * 0.6; const wob = 2 + Math.sin(time * 5 + i) * 1.5; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r, e.y + Math.sin(a) * r); ctx.lineTo(cx + Math.cos(a) * (r + wob), e.y + Math.sin(a) * (r + wob)); ctx.stroke() }
      // gelatinous body
      const g = ctx.createRadialGradient(cx - 3, e.y - 4, 1, cx, e.y, r)
      g.addColorStop(0, '#9ff2c2'); g.addColorStop(0.55, '#3a9d6e'); g.addColorStop(1, '#0d4e35')
      ctx.fillStyle = g; ctx.shadowColor = 'rgba(95,224,138,0.5)'; ctx.shadowBlur = 8
      ctx.beginPath(); ctx.arc(cx, e.y, r, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0
      // membrane rim highlight + glowing nucleus
      ctx.strokeStyle = 'rgba(200,255,224,0.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, e.y, r - 1.5, -2.2, 0.4); ctx.stroke()
      ctx.fillStyle = `rgba(190,255,212,${0.5 + 0.4 * seam})`; ctx.shadowColor = '#bfffd8'; ctx.shadowBlur = 6
      ctx.beginPath(); ctx.arc(cx + s * 1.5, e.y, 2.6, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0
      // googly eye that looks AWAY from its twin — pupils drift apart as the pod divides
      const lean = s * (0.6 + 0.18 * sep)
      ctx.fillStyle = '#f2fff8'; ctx.beginPath(); ctx.arc(cx, e.y, 3, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#0d2e1e'; ctx.beginPath(); ctx.arc(cx + lean, e.y - 0.4, 1.5, 0, Math.PI * 2); ctx.fill()
    }
    // dividing seam
    ctx.strokeStyle = `rgba(180,255,210,${0.4 + 0.5 * seam})`; ctx.lineWidth = 1.6; ctx.shadowColor = '#bfffd8'; ctx.shadowBlur = 6
    ctx.beginPath(); ctx.moveTo(e.x, e.y - 11); ctx.lineTo(e.x, e.y + 11); ctx.stroke()
    ctx.restore()
  }

  /** Leech Swooper — a magenta winged stingray that vacuums falling pills. */
  #enemyLeech(e: Enemy, time: number): void {
    const ctx = this.#ctx, x = e.x, y = e.y
    const flap = Math.sin((e.t ?? 0) * 6), gold = (e.flash ?? 0) > 0
    const main = gold ? '#ffd24a' : '#ff5bbf', lite = gold ? '#fff0b0' : '#ffaee0'
    this.#enemyAura(x, y, gold ? '255,210,74' : '255,90,200', time, 1.8)
    ctx.save()
    for (const s of [-1, 1]) {
      // wing with a soft gradient
      const tipY = y - 10 - 6 * flap
      const wg = ctx.createLinearGradient(x, y, x + s * 24, tipY)
      wg.addColorStop(0, main); wg.addColorStop(1, gold ? '#ffe98a' : '#ff8fd6')
      ctx.fillStyle = wg; ctx.shadowColor = main; ctx.shadowBlur = 8
      ctx.beginPath(); ctx.moveTo(x, y)
      ctx.quadraticCurveTo(x + s * 16, tipY, x + s * 24, y + 2)
      ctx.quadraticCurveTo(x + s * 14, y + 4, x, y + 3); ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0
      // membrane veins
      ctx.strokeStyle = gold ? 'rgba(255,255,255,0.5)' : 'rgba(255,200,235,0.55)'; ctx.lineWidth = 0.8
      for (const f of [0.4, 0.7]) { ctx.beginPath(); ctx.moveTo(x, y + 1); ctx.quadraticCurveTo(x + s * 14 * f, (tipY + y) / 2, x + s * 22 * f, y + 1); ctx.stroke() }
    }
    // body + glowing eye
    ctx.fillStyle = lite; ctx.beginPath(); ctx.ellipse(x, y, 5, 9, 0, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = gold ? '#a06a10' : '#7a1050'; ctx.beginPath(); ctx.arc(x, y - 3, 2, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x - 0.6, y - 3.6, 0.8, 0, Math.PI * 2); ctx.fill()
    // segmented trailing tail-barb
    ctx.strokeStyle = lite; ctx.lineWidth = 1.4; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(x, y + 8); ctx.quadraticCurveTo(x + flap * 4, y + 13, x + flap * 6, y + 18); ctx.stroke()
    ctx.fillStyle = main; ctx.beginPath(); ctx.arc(x + flap * 6, y + 18, 1.6, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }

  /** Mirror Sentinel — a chrome obelisk that mirrors the bat and beams its column. */
  #enemyMirror(e: Enemy, time: number): void {
    const ctx = this.#ctx, x = e.x, y = e.y, w = 11, h = 22
    const fire = e.flash ?? 0
    this.#enemyAura(x, y, '192,198,214', time, 1.6)
    ctx.save()
    // chrome body with a faceted vertical gradient
    ctx.shadowColor = '#dfe7ff'; ctx.shadowBlur = 8
    const g = ctx.createLinearGradient(x - w, y, x + w, y)
    g.addColorStop(0, '#474d5e'); g.addColorStop(0.35, '#cfd6e6'); g.addColorStop(0.5, '#f6f9ff'); g.addColorStop(0.65, '#cfd6e6'); g.addColorStop(1, '#474d5e')
    this.#roundRect(x - w / 2, y - h / 2, w, h, 3); ctx.fillStyle = g; ctx.fill(); ctx.shadowBlur = 0
    // bevelled end-caps
    ctx.fillStyle = '#aeb6c8'; this.#roundRect(x - w / 2, y - h / 2, w, 3, 1.5); ctx.fill(); this.#roundRect(x - w / 2, y + h / 2 - 3, w, 3, 1.5); ctx.fill()
    // specular stripe + a faint second facet line
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(x - 1.5, y - h / 2 + 3); ctx.lineTo(x - 1.5, y + h / 2 - 3); ctx.stroke()
    ctx.strokeStyle = 'rgba(120,140,180,0.5)'; ctx.beginPath(); ctx.moveTo(x + 2.5, y - h / 2 + 3); ctx.lineTo(x + 2.5, y + h / 2 - 3); ctx.stroke()
    // scanning eye-band
    const ey = y + Math.sin(time * 3) * (h / 2 - 4)
    ctx.fillStyle = `rgba(120,220,255,${0.6 + 0.4 * fire})`; ctx.shadowColor = '#7ee0ff'; ctx.shadowBlur = 6
    this.#roundRect(x - w / 2 + 1, ey - 1.5, w - 2, 3, 1.5); ctx.fill()
    // lone cyclops eye on the band — a slit pupil that scans side to side
    ctx.shadowBlur = 0
    const scan = Math.sin(time * 1.6) * (w * 0.18)
    ctx.fillStyle = '#eaf6ff'; ctx.beginPath(); ctx.arc(x, ey, 2.6, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#16202e'; ctx.beginPath(); ctx.ellipse(x + scan, ey, 0.9, 2.0, 0, 0, Math.PI * 2); ctx.fill()
    // beam-charge glow at the muzzle just before firing
    if (fire > 0) { ctx.fillStyle = `rgba(150,230,255,${fire})`; ctx.shadowColor = '#7ee0ff'; ctx.shadowBlur = 10 * fire; ctx.beginPath(); ctx.arc(x, y + h / 2, 3 * fire, 0, Math.PI * 2); ctx.fill() }
    ctx.restore()
  }

  /** Orbit Sentinel — a green core with two orbiting satellites that deflect shots. */
  #enemyOrbit(e: Enemy, time: number): void {
    const ctx = this.#ctx, x = e.x, y = e.y, t = e.t ?? 0
    this.#enemyAura(x, y, '200,255,74', time, 1.8)
    ctx.save()
    // orbit trail rings
    ctx.strokeStyle = 'rgba(200,255,74,0.22)'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.stroke()
    ctx.strokeStyle = 'rgba(200,255,74,0.12)'; ctx.beginPath(); ctx.ellipse(x, y, 14, 6, t, 0, Math.PI * 2); ctx.stroke()
    // pulsing core
    const beat = 1 + 0.12 * Math.sin(time * 5)
    const g = ctx.createRadialGradient(x - 2, y - 2, 1, x, y, 10 * beat)
    g.addColorStop(0, '#fbffd0'); g.addColorStop(0.6, '#cfff4a'); g.addColorStop(1, '#5a7008')
    ctx.fillStyle = g; ctx.shadowColor = '#cfff4a'; ctx.shadowBlur = 10
    ctx.beginPath(); ctx.arc(x, y, 9 * beat, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0
    // satellites with tethers + glows
    for (const k of [0, 1]) {
      const a = t * 2 + k * Math.PI, sx = x + Math.cos(a) * 14, sy = y + Math.sin(a) * 14
      ctx.strokeStyle = 'rgba(220,255,140,0.4)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(sx, sy); ctx.stroke()
      ctx.fillStyle = '#f4ffc0'; ctx.shadowColor = '#cfff4a'; ctx.shadowBlur = 7
      ctx.beginPath(); ctx.arc(sx, sy, 3.6, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0
    }
    ctx.restore()
  }

  /** Dart Diver — a red delta that patrols then commits a straight plunge. */
  #enemyDart(e: Enemy, time: number): void {
    const ctx = this.#ctx, x = e.x, y = e.y
    const tilt = e.phase === 'patrol' && (e.cd ?? 1) < 0.4 ? 0.18 : 0
    const diving = e.phase === 'dive'
    this.#enemyAura(x, y, '255,90,60', time, 1.7)
    ctx.save(); ctx.translate(x, y); ctx.rotate(tilt)
    // afterburner flames out the back (top), roaring during a dive
    const fl = (diving ? 1 : 0.4) * (0.7 + 0.3 * Math.sin(time * 30))
    ctx.save(); ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < 3; i++) { ctx.globalAlpha = (0.5 - i * 0.13) * fl; ctx.fillStyle = i === 0 ? '#fff0c0' : '#ff7043'; ctx.beginPath(); ctx.ellipse(0, -12 - i * (4 + 8 * fl), 3 - i * 0.7, 5 + i * 5 * fl, 0, 0, Math.PI * 2); ctx.fill() }
    ctx.restore()
    // glossy delta hull
    ctx.shadowColor = '#ff5b3a'; ctx.shadowBlur = 8
    const g = ctx.createLinearGradient(0, -14, 0, 12)
    g.addColorStop(0, '#ffd08a'); g.addColorStop(0.5, '#ff5b3a'); g.addColorStop(1, '#6e1606')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.moveTo(0, 14); ctx.lineTo(-11, -12); ctx.lineTo(0, -6); ctx.lineTo(11, -12); ctx.closePath(); ctx.fill()
    ctx.shadowBlur = 0
    // edge highlights down the leading edges
    ctx.strokeStyle = 'rgba(255,220,180,0.7)'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(0, 14); ctx.lineTo(-11, -12); ctx.moveTo(0, 14); ctx.lineTo(11, -12); ctx.stroke()
    // hot white nose
    ctx.fillStyle = '#fff'; ctx.shadowColor = '#fff'; ctx.shadowBlur = 6; ctx.beginPath(); ctx.arc(0, 12, 2.2, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }

  /** Blink Imp — a violet tetrahedron that teleport-stalks with a glitch halo. */
  #enemyBlink(e: Enemy, time: number): void {
    const ctx = this.#ctx, x = e.x, y = e.y
    const charge = e.phase === 'idle' ? 1 - Math.min(1, (e.cd ?? 1.4) / 1.4) : 0
    if (e.ghostX !== undefined && (e.flash ?? 0) > 0) {
      ctx.save(); ctx.globalAlpha = (e.flash ?? 0) * 0.4; ctx.fillStyle = '#a86bff'
      this.#diamond(e.ghostX, e.ghostY ?? y, 12); ctx.fill(); ctx.restore()
    }
    if (e.phase === 'out') return
    this.#enemyAura(x, y, '168,107,255', time, 1.6)
    ctx.save()
    // glitch fragment shards orbiting, jittered by time
    ctx.fillStyle = 'rgba(200,150,255,0.5)'
    for (let i = 0; i < 5; i++) { const a = time * 4 + i * 1.3, rr = 16 + Math.sin(time * 9 + i) * 4; const fx = x + Math.cos(a) * rr, fy = y + Math.sin(a) * rr; ctx.fillRect(fx - 1.4, fy - 1.4, 2.8, 2.8) }
    // contracting halo
    ctx.strokeStyle = `rgba(200,150,255,${0.4 + 0.5 * charge})`; ctx.lineWidth = 2; ctx.shadowColor = '#a86bff'; ctx.shadowBlur = 8 + 12 * charge
    ctx.beginPath(); ctx.arc(x, y, 18 - 8 * charge, 0, Math.PI * 2); ctx.stroke(); ctx.shadowBlur = 0
    // chromatic split ghosts (red/cyan offsets) — the unstable look
    const off = 1.5 + Math.sin(time * 11) * 0.8
    ctx.globalAlpha = 0.5; ctx.fillStyle = '#ff5bd0'; this.#diamond(x - off, y, 13); ctx.fill()
    ctx.fillStyle = '#5bd0ff'; this.#diamond(x + off, y, 13); ctx.fill(); ctx.globalAlpha = 1
    // the tetrahedron body + a dark void core
    const g = ctx.createLinearGradient(x, y - 12, x, y + 12); g.addColorStop(0, '#d2a8ff'); g.addColorStop(1, '#4a2390')
    ctx.fillStyle = g; this.#diamond(x, y, 13); ctx.fill()
    ctx.fillStyle = '#1a0a30'; this.#diamond(x, y, 5); ctx.fill()
    ctx.fillStyle = '#fff'; ctx.shadowColor = '#e0c8ff'; ctx.shadowBlur = 6; ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }

  /** Polarity Knight — a hex split blue|red; only the matching damage type hurts it. */
  #enemyPolarity(e: Enemy, time: number): void {
    const ctx = this.#ctx, x = e.x, y = e.y, r = 15, red = e.polarity === 'red'
    const acc = red ? '#ff4a4a' : '#3a7dff'
    this.#enemyAura(x, y, red ? '255,74,74' : '58,125,255', time, 1.7)
    ctx.save()
    const hexPath = () => { ctx.beginPath(); for (let i = 0; i <= 6; i++) { const a = -Math.PI / 2 + i * Math.PI / 3; const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py) } ctx.closePath() }
    hexPath(); ctx.save(); ctx.clip()
    // the two armour halves, the ACTIVE one brighter
    ctx.fillStyle = red ? '#1f4488' : '#3a7dff'; ctx.fillRect(x - r, y - r, r, r * 2)
    ctx.fillStyle = red ? '#ff4a4a' : '#882a2a'; ctx.fillRect(x, y - r, r, r * 2)
    // energy crackle down the split seam
    ctx.strokeStyle = `rgba(255,255,255,${0.5 + 0.4 * Math.sin(time * 20)})`; ctx.lineWidth = 1.2; ctx.shadowColor = acc; ctx.shadowBlur = 6
    ctx.beginPath(); ctx.moveTo(x, y - r)
    for (let yy = -r + 3; yy < r; yy += 4) ctx.lineTo(x + Math.sin(yy * 1.7 + time * 18) * 2, y + yy)
    ctx.stroke(); ctx.shadowBlur = 0
    ctx.restore()
    hexPath(); ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1.2; ctx.stroke()
    // spinning diamond core glowing the active polarity
    ctx.save(); ctx.translate(x, y); ctx.rotate(time * 1.5)
    ctx.fillStyle = acc; ctx.shadowColor = acc; ctx.shadowBlur = 12; this.#diamond(0, 0, 5); ctx.fill()
    ctx.restore(); ctx.shadowBlur = 0
    if ((e.flash ?? 0) > 0) { ctx.strokeStyle = `rgba(255,255,255,${e.flash})`; ctx.lineWidth = 2; ctx.shadowColor = '#fff'; ctx.shadowBlur = 8 * (e.flash ?? 0); ctx.beginPath(); ctx.arc(x, y, r + 3, 0, Math.PI * 2); ctx.stroke() }
    ctx.restore()
  }

  /** Hive Queen — the bloated boss-mother; her egg-sac glows before each broodling. */
  #enemyQueen(e: Enemy, time: number): void {
    const ctx = this.#ctx, x = e.x, y = e.y, r = 22
    const birth = 1 - Math.min(1, (e.cd ?? 4) / 4)
    if (e.brood) { ctx.save(); ctx.fillStyle = '#ff5b6e'; ctx.shadowColor = '#ff5b6e'; ctx.shadowBlur = 5; for (const m of e.brood) { ctx.beginPath(); ctx.moveTo(m.x, m.y - 4); ctx.lineTo(m.x + 3, m.y + 3); ctx.lineTo(m.x - 3, m.y + 3); ctx.closePath(); ctx.fill() } ctx.restore() }
    this.#enemyAura(x, y, '255,40,60', time, 2.4)
    ctx.save()
    // six articulated legs (3 pairs), twitching
    ctx.strokeStyle = '#7a0f1e'; ctx.lineWidth = 2.2; ctx.lineCap = 'round'
    for (const s of [-1, 1]) for (const k of [0, 1, 2]) {
      const a = Math.PI / 2 + s * (0.35 + k * 0.42), tw = Math.sin(time * 6 + k + (s > 0 ? 1.5 : 0)) * 3
      const kx = x + Math.cos(a) * (r * 0.7 + 5), ky = y + Math.sin(a) * (r * 0.5 + 4)         // knee
      ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6); ctx.lineTo(kx, ky); ctx.lineTo(kx + Math.cos(a) * 8, ky + Math.sin(a) * 8 + tw); ctx.stroke()
    }
    // abdomen with a top-lit gradient
    ctx.shadowColor = '#c41e3a'; ctx.shadowBlur = 12
    const g = ctx.createRadialGradient(x - 4, y - 6, 2, x, y + 4, r)
    g.addColorStop(0, '#f06078'); g.addColorStop(0.55, '#c41e3a'); g.addColorStop(1, '#600d1a')
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y + 3, r * 0.8, r, 0, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0
    // abdomen segment ridges
    ctx.strokeStyle = 'rgba(110,15,26,0.6)'; ctx.lineWidth = 1
    for (const f of [0.35, 0.62, 0.85]) { ctx.beginPath(); ctx.ellipse(x, y + 3, r * 0.8 * (1 - f * 0.15), r * f, 0, 0.5, Math.PI - 0.5); ctx.stroke() }
    // glowing egg-sac with eggs inside, swelling before a birth
    const sg = ctx.createRadialGradient(x, y + 10, 1, x, y + 10, 9 + 2 * birth)
    sg.addColorStop(0, `rgba(255,235,160,${0.5 + 0.5 * birth})`); sg.addColorStop(1, 'rgba(255,180,60,0)')
    ctx.fillStyle = sg; ctx.shadowColor = '#ffd24a'; ctx.shadowBlur = 4 + 14 * birth
    ctx.beginPath(); ctx.arc(x, y + 10, 8 + 2 * birth, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0
    ctx.fillStyle = `rgba(255,210,120,${0.6 + 0.4 * birth})`
    for (const o of [[-3, 8], [3, 9], [0, 12], [-2, 13]]) { ctx.beginPath(); ctx.arc(x + o[0], y + o[1], 1.5, 0, Math.PI * 2); ctx.fill() }
    // head, eyes + mandibles that open with the birth
    ctx.fillStyle = '#8a1226'; ctx.beginPath(); ctx.arc(x, y - r * 0.6, 8, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = '#5a0a16'; ctx.lineWidth = 2; ctx.lineCap = 'round'
    for (const s of [-1, 1]) { const m = 0.3 + birth * 0.4; ctx.beginPath(); ctx.moveTo(x + s * 5, y - r * 0.6 + 4); ctx.quadraticCurveTo(x + s * (9 + m * 4), y - r * 0.6 + 8, x + s * (5 + m * 6), y - r * 0.6 + 12); ctx.stroke() }
    ctx.fillStyle = '#ffd24a'; ctx.shadowColor = '#ffd24a'; ctx.shadowBlur = 5; for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(x + s * 3.2, y - r * 0.6, 1.8, 0, Math.PI * 2); ctx.fill() }
    ctx.restore()
  }

  /** Pac-Man — a chomping yellow rival that eats your colour balls. Faces its
   *  travel direction; HP pips float above; turns translucent as it leaves, full. */
  #pacman(p: Pacman, time: number): void {
    const ctx = this.#ctx
    const R = 14
    const open = 0.06 + 0.34 * (0.5 + 0.5 * Math.sin(p.mouth))   // chomp
    const facing = p.dir >= 0 ? 0 : Math.PI
    ctx.save()
    if (p.leaving) ctx.globalAlpha = 0.5
    ctx.shadowColor = 'rgba(255,224,74,0.6)'; ctx.shadowBlur = 12
    const g = ctx.createRadialGradient(p.x - 3, p.y - 3, 2, p.x, p.y, R)
    g.addColorStop(0, '#fff3a8'); g.addColorStop(0.6, '#ffd24a'); g.addColorStop(1, '#e0a01a')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    ctx.arc(p.x, p.y, R, facing + open, facing - open + Math.PI * 2)   // body minus the open wedge
    ctx.closePath(); ctx.fill()
    ctx.shadowBlur = 0
    const ex = p.x + Math.cos(facing - 1.15) * R * 0.42, ey = p.y + Math.sin(facing - 1.15) * R * 0.42
    ctx.fillStyle = '#221a00'; ctx.beginPath(); ctx.arc(ex, ey, 1.9, 0, Math.PI * 2); ctx.fill()   // eye
    for (let i = 0; i < 3; i++) {                                       // HP pips
      ctx.fillStyle = i < p.hp ? '#7ee0ff' : 'rgba(80,90,110,0.5)'
      ctx.beginPath(); ctx.arc(p.x - 6 + i * 6, p.y - R - 6, 1.8, 0, Math.PI * 2); ctx.fill()
    }
    ctx.restore()
  }

  /** The alien SHIP — a glowing UFO saucer with a glass dome and underside
   *  lights. Shoot it (ball/laser/beam/rocket) and it drops a power-up. */
  /** The top pill-dispenser — one of a rotating cast of cartoon critters. */
  #alien(a: Alien, time: number): void {
    switch (a.kind) {
      case 'bee': return this.#dispBee(a, time)
      case 'crab': return this.#dispCrab(a, time)
      case 'ghost': return this.#dispGhost(a, time)
      case 'chick': return this.#dispChick(a, time)
      default: return this.#dispFrog(a, time)
    }
  }

  /** The hopping FROG — hop phase from a.frame; squashes flat on landing, stretches
   *  tall at apex. Unified ink-contour cartoon. */
  #dispFrog(a: Alien, time: number): void {
    void time
    const ctx = this.#ctx
    const x = a.x, y = a.y, hw = ALIEN_W / 2
    // reconstruct the hop phase to drive squash/stretch (matches the engine's math)
    const ph = (a.frame % FROG_HOP_PERIOD) / FROG_HOP_PERIOD
    const airborne = ph < FROG_AIR_FRAC
    const lift = airborne ? Math.sin((ph / FROG_AIR_FRAC) * Math.PI) : 0      // 0 ground .. 1 apex
    const land = airborne ? 0 : 1 - (ph - FROG_AIR_FRAC) / (1 - FROG_AIR_FRAC) // 1 at touchdown → 0
    const sx = 1 + 0.22 * land - 0.12 * lift                                   // squash flat on landing
    const sy = 1 - 0.20 * land + 0.14 * lift                                   // stretch tall at apex
    const dir = Math.sign(a.vx) || 1
    const bw = 24, bh = 22
    ctx.save()
    // ground shadow pinned at the baseline, shrinking as the frog rises
    const groundY = 33                                                         // ALIEN_Y(24) + 9
    ctx.fillStyle = `rgba(10,30,12,${0.30 * (1 - 0.6 * lift)})`
    ctx.beginPath(); ctx.ellipse(x, groundY, hw * (1 - 0.35 * lift), 3.2 * (1 - 0.35 * lift), 0, 0, Math.PI * 2); ctx.fill()
    ctx.translate(x, y); ctx.scale(sx, sy)
    // ── BACK LEGS (tucked grounded, extended airborne) — behind the body ──
    const legExt = lift
    ctx.fillStyle = FROG_BODY_MID
    for (const s of [-1, 1]) {
      const hipX = s * bw * 0.42, hipY = bh * 0.30
      const footX = hipX + s * (3 + 9 * legExt), footY = hipY + (5 + 9 * legExt)
      const leg = () => {
        ctx.beginPath()
        ctx.moveTo(hipX, hipY - 3)
        ctx.quadraticCurveTo(hipX + s * 7, hipY + 2, footX, footY)
        ctx.quadraticCurveTo(footX + s * 5, footY + 1, footX + s * 8, footY - 1)
        ctx.quadraticCurveTo(footX + s * 4, footY + 3, footX, footY + 2)
        ctx.quadraticCurveTo(hipX + s * 4, hipY + 5, hipX, hipY + 2)
        ctx.closePath()
      }
      leg(); ctx.fillStyle = FROG_BODY_MID; ctx.fill()
      leg(); this.#inkContour(FROG_INK, 1.4)
    }
    // ── BODY — round green blob, top-lit ──
    ctx.shadowColor = 'rgba(63,209,58,0.5)'; ctx.shadowBlur = 9
    const body = ctx.createLinearGradient(0, -bh * 0.5, 0, bh * 0.5)
    body.addColorStop(0, FROG_BODY_TOP); body.addColorStop(0.5, FROG_BODY_MID); body.addColorStop(1, FROG_BODY_BOT)
    ctx.fillStyle = body
    ctx.beginPath(); ctx.ellipse(0, 0, bw * 0.5, bh * 0.5, 0, 0, Math.PI * 2); ctx.fill()
    ctx.shadowBlur = 0
    // glossy pale belly + a specular hotspot
    ctx.fillStyle = FROG_BELLY
    ctx.beginPath(); ctx.ellipse(0, bh * 0.16, bw * 0.30, bh * 0.26, 0, 0, Math.PI * 2); ctx.fill()
    ctx.globalAlpha = 0.55; ctx.fillStyle = '#ffffff'
    ctx.beginPath(); ctx.ellipse(-bw * 0.18, -bh * 0.20, bw * 0.12, bh * 0.10, -0.4, 0, Math.PI * 2); ctx.fill()
    ctx.globalAlpha = 1
    // body ink contour
    ctx.beginPath(); ctx.ellipse(0, 0, bw * 0.5, bh * 0.5, 0, 0, Math.PI * 2); this.#inkContour(FROG_INK, 1.7)
    // ── EYES — two big googly domes on top ──
    const eyeY = -bh * 0.42, eyeDX = bw * 0.26, eyeR = 5.2
    for (const s of [-1, 1]) {
      const ex = s * eyeDX
      ctx.fillStyle = FROG_BODY_MID
      ctx.beginPath(); ctx.ellipse(ex, eyeY + 2, eyeR + 1, eyeR + 1, 0, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.beginPath(); ctx.arc(ex, eyeY, eyeR, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.arc(ex, eyeY, eyeR, 0, Math.PI * 2); this.#inkContour(FROG_INK, 1.3)
      const pdx = dir * 1.6
      ctx.fillStyle = '#0c1410'
      ctx.beginPath(); ctx.arc(ex + pdx, eyeY + 1, 2.2, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.9)'
      ctx.beginPath(); ctx.arc(ex + pdx - 0.8, eyeY + 0.2, 0.8, 0, Math.PI * 2); ctx.fill()
    }
    // ── MOUTH — wide friendly smile, opens at apex ──
    const open = 0.5 + 0.5 * lift
    ctx.strokeStyle = FROG_INK; ctx.lineWidth = 1.8; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(-bw * 0.30, bh * 0.02); ctx.quadraticCurveTo(0, bh * (0.14 + 0.10 * open), bw * 0.30, bh * 0.02); ctx.stroke()
    ctx.fillStyle = FROG_INK
    ctx.beginPath(); ctx.arc(-bw * 0.07, -bh * 0.06, 0.9, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(bw * 0.07, -bh * 0.06, 0.9, 0, Math.PI * 2); ctx.fill()
    // rosy cheeks
    ctx.globalAlpha = 0.5; ctx.fillStyle = '#ff8fb0'
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(s * bw * 0.30, bh * 0.06, 2.4, 1.6, 0, 0, Math.PI * 2); ctx.fill() }
    ctx.globalAlpha = 1
    ctx.restore()
  }

  /** The buzzing BUMBLEBEE — an alternate top pill-dispenser. The wiggle phase comes
 *  from a.frame (matching the engine); wings flutter on `time` for a fast blur, the
 *  body banks slightly into its travel, and a faint air-shadow tracks it. Unified
 *  ink-contour cartoon to match the frog. */
#dispBee(a: Alien, time: number): void {
  const ctx = this.#ctx
  const x = a.x, y = a.y, hw = ALIEN_W / 2
  const dir = Math.sign(a.vx) || 1
  // reconstruct the wiggle phase to drive a tiny body bank + leg sway (matches engine)
  const w = a.frame * BEE_WIGGLE_HZ * Math.PI * 2
  const wob = Math.sin(w)                                   // -1..1 current wiggle
  const bank = dir * 0.14 + wob * 0.10                      // lean into travel + buzz
  // fast wing flutter (independent of travel speed — pure visual buzz)
  const flap = Math.sin(time * 42)                          // ~6-7 Hz visual beat
  const bw = 26, bh = 18                                    // wide round striped barrel
  ctx.save()
  // ── soft air-shadow on the baseline, offset under the floating bee ──
  const groundY = ALIEN_Y + 16
  ctx.fillStyle = `rgba(20,16,6,${0.22 - 0.06 * wob})`
  ctx.beginPath(); ctx.ellipse(x, groundY, hw * 0.7, 2.6, 0, 0, Math.PI * 2); ctx.fill()
  ctx.translate(x, y); ctx.rotate(bank)
  // ── WINGS — two big translucent blur-discs, fluttering fast, BEHIND the body ──
  ctx.save()
  for (const s of [-1, 1]) {
    const open = 0.62 + 0.38 * Math.abs(flap)              // wing-area pulse
    const wx = s * bw * 0.20, wyTop = -bh * 0.78
    ctx.save()
    ctx.translate(wx, wyTop)
    ctx.rotate(s * (0.5 - 0.32 * Math.abs(flap)))          // sweep up/down on the beat
    ctx.scale(1, open)
    // soft outer haze
    ctx.fillStyle = `rgba(${BEE_WING},0.18)`
    ctx.beginPath(); ctx.ellipse(0, 0, bw * 0.42, bh * 0.62, 0, 0, Math.PI * 2); ctx.fill()
    // brighter inner membrane + a thin ink rim
    ctx.fillStyle = `rgba(${BEE_WING},0.34)`
    ctx.beginPath(); ctx.ellipse(0, 0, bw * 0.30, bh * 0.46, 0, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.ellipse(0, 0, bw * 0.42, bh * 0.62, 0, 0, Math.PI * 2)
    this.#inkContour('rgba(140,170,200,0.55)', 1)
    // motion-blur ghost trailing the beat
    ctx.globalAlpha = 0.22 * Math.abs(flap)
    ctx.fillStyle = `rgba(${BEE_WING},0.5)`
    ctx.beginPath(); ctx.ellipse(0, bh * 0.12 * flap, bw * 0.34, bh * 0.5, 0, 0, Math.PI * 2); ctx.fill()
    ctx.globalAlpha = 1
    ctx.restore()
  }
  ctx.restore()
  // ── TINY LEGS — three dangling pairs swaying under the body ──
  ctx.strokeStyle = BEE_INK; ctx.lineWidth = 1.5; ctx.lineCap = 'round'
  for (let i = -1; i <= 1; i++) {
    const lx = i * bw * 0.26, ly = bh * 0.44
    const sway = wob * 1.4 + i * 0.4
    ctx.beginPath(); ctx.moveTo(lx, ly)
    ctx.quadraticCurveTo(lx + sway, ly + 4, lx + sway * 1.6 - dir * 1, ly + 6.5); ctx.stroke()
  }
  // ── STINGER — stubby cone at the tail (trailing edge) ──
  const tailX = -dir * bw * 0.52
  ctx.fillStyle = BEE_INK
  ctx.beginPath()
  ctx.moveTo(tailX, -2.5); ctx.lineTo(tailX, 2.5)
  ctx.lineTo(tailX - dir * 6, 0); ctx.closePath(); ctx.fill()
  // ── BODY — wide round fuzzy barrel, top-lit, with a warm buzz glow ──
  ctx.shadowColor = 'rgba(255,184,31,0.5)'; ctx.shadowBlur = 9
  const body = ctx.createLinearGradient(0, -bh * 0.5, 0, bh * 0.5)
  body.addColorStop(0, BEE_BODY_TOP); body.addColorStop(0.5, BEE_BODY_MID); body.addColorStop(1, BEE_BODY_BOT)
  ctx.fillStyle = body
  ctx.beginPath(); ctx.ellipse(0, 0, bw * 0.5, bh * 0.5, 0, 0, Math.PI * 2); ctx.fill()
  ctx.shadowBlur = 0
  // ── BLACK FUZZ STRIPES — clipped to the body so they hug the curve ──
  ctx.save()
  ctx.beginPath(); ctx.ellipse(0, 0, bw * 0.5, bh * 0.5, 0, 0, Math.PI * 2); ctx.clip()
  ctx.fillStyle = BEE_STRIPE
  for (const cx of [-bw * 0.14, bw * 0.16]) {              // two body stripes, angled
    ctx.save(); ctx.translate(cx, 0); ctx.rotate(-0.12 + dir * 0.04)
    ctx.beginPath(); ctx.ellipse(0, 0, bw * 0.085, bh * 0.6, 0, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }
  ctx.restore()
  // fuzzy top rim — a row of faint hairs along the crown
  ctx.strokeStyle = 'rgba(255,228,120,0.7)'; ctx.lineWidth = 1
  for (let i = -3; i <= 3; i++) {
    const hx = i * bw * 0.12, hy = -Math.sqrt(Math.max(0, 1 - (hx / (bw * 0.5)) ** 2)) * bh * 0.5
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + dir * 0.6, hy - 2.4); ctx.stroke()
  }
  // glossy specular hotspot
  ctx.globalAlpha = 0.5; ctx.fillStyle = '#ffffff'
  ctx.beginPath(); ctx.ellipse(-bw * 0.16, -bh * 0.22, bw * 0.11, bh * 0.12, -0.4, 0, Math.PI * 2); ctx.fill()
  ctx.globalAlpha = 1
  // body ink contour (re-issue the body path, then stroke)
  ctx.beginPath(); ctx.ellipse(0, 0, bw * 0.5, bh * 0.5, 0, 0, Math.PI * 2); this.#inkContour(BEE_INK, 1.7)
  // ── FACE pod at the leading edge — small lighter dome the eyes sit on ──
  const faceX = dir * bw * 0.42
  ctx.fillStyle = BEE_BODY_TOP
  ctx.beginPath(); ctx.ellipse(faceX, -bh * 0.06, bw * 0.18, bh * 0.34, 0, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.ellipse(faceX, -bh * 0.06, bw * 0.18, bh * 0.34, 0, 0, Math.PI * 2); this.#inkContour(BEE_INK, 1.4)
  // ── EYES — two big googly domes on the leading face ──
  const eyeR = 4.6
  for (const s of [-1, 1]) {
    const ex = faceX + dir * 1.0, ey = -bh * 0.20 + s * 4.4
    ctx.fillStyle = '#ffffff'
    ctx.beginPath(); ctx.arc(ex, ey, eyeR, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(ex, ey, eyeR, 0, Math.PI * 2); this.#inkContour(BEE_INK, 1.3)
    const pdx = dir * 1.5, pdy = wob * 0.8                 // pupils dart with the buzz
    ctx.fillStyle = '#160f06'
    ctx.beginPath(); ctx.arc(ex + pdx, ey + pdy, 2.1, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.beginPath(); ctx.arc(ex + pdx - 0.7, ey + pdy - 0.7, 0.8, 0, Math.PI * 2); ctx.fill()
  }
  // ── ANTENNAE — two springy stalks with bobble tips, jiggling on the buzz ──
  ctx.strokeStyle = BEE_INK; ctx.lineWidth = 1.4; ctx.lineCap = 'round'
  for (const s of [-1, 1]) {
    const ax = faceX + dir * 2, ay = -bh * 0.44
    const tipX = ax + dir * 4 + wob * 1.6, tipY = ay - 6 - s * 1.2
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(ax + dir * 4, ay - 5, tipX, tipY); ctx.stroke()
    ctx.fillStyle = BEE_STRIPE
    ctx.beginPath(); ctx.arc(tipX, tipY, 1.6, 0, Math.PI * 2); ctx.fill()
  }
  // ── little smile under the face ──
  ctx.strokeStyle = BEE_INK; ctx.lineWidth = 1.4
  ctx.beginPath()
  ctx.moveTo(faceX - 2.4, bh * 0.12)
  ctx.quadraticCurveTo(faceX + dir * 1.2, bh * 0.22, faceX + 2.4, bh * 0.12); ctx.stroke()
  ctx.restore()
}

  /** The scuttling CRAB — an alternate top pill-dispenser. Skitter phase comes
   *  from a.frame; legs pump, claws snap, stalk-eyes wobble. Faces its travel
   *  direction. Unified ink-contour cartoon, matching the frog's quality. */
  #dispCrab(a: Alien, time: number): void {
    const ctx = this.#ctx
    const x = a.x, y = a.y, hw = ALIEN_W / 2
    const dir = Math.sign(a.vx) || 1
    // reconstruct the scuttle phase (matches the engine's SCUTTLE_PERIOD math)
    const ph = (a.frame % SCUTTLE_PERIOD) / SCUTTLE_PERIOD
    const bob = Math.abs(Math.sin(ph * Math.PI * 2))                 // 0 ground .. 1 mid-step (height)
    const step = Math.sin(ph * Math.PI * 2)                          // ±1 leg-pump phase
    const lean = dir * 0.10 * Math.cos(ph * Math.PI * 2)             // tiny scuttle body-tilt into travel
    const snap = 0.5 + 0.5 * Math.sin(ph * Math.PI * 4 + 0.6)        // claws open/close twice per cycle
    const bw = 26, bh = 15                                           // wide & low — a crab silhouette
    ctx.save()
    // ── GROUND SHADOW — pinned at the baseline, shrinks as the crab pops up ──
    const groundY = 34
    ctx.fillStyle = `rgba(60,12,10,${0.30 * (1 - 0.5 * bob)})`
    ctx.beginPath(); ctx.ellipse(x, groundY, hw * (1 - 0.25 * bob), 3.0 * (1 - 0.25 * bob), 0, 0, Math.PI * 2); ctx.fill()
    ctx.translate(x, y); ctx.rotate(lean)
    // ── LEGS — three per side, pumping in a scuttling gait (behind the shell) ──
    ctx.strokeStyle = CRAB_LIMB; ctx.lineWidth = 2.2; ctx.lineCap = 'round'
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const gait = Math.sin(ph * Math.PI * 2 + i * 1.1 + (s > 0 ? Math.PI : 0))   // legs out of phase
        const hipX = s * (bw * 0.30 + i * 4.5), hipY = bh * 0.18
        const kneeX = hipX + s * (5 + 1.5 * gait), kneeY = hipY + 4
        const footX = kneeX + s * 3, footY = hipY + 9 + 1.5 * gait                  // foot pumps up/down
        ctx.beginPath()
        ctx.moveTo(hipX, hipY)
        ctx.quadraticCurveTo(kneeX, kneeY, footX, footY)
        ctx.strokeStyle = CRAB_LIMB; ctx.stroke()
        ctx.strokeStyle = CRAB_INK; ctx.lineWidth = 1.0; ctx.stroke(); ctx.lineWidth = 2.2  // thin ink pass
      }
    }
    // ── CLAWS — two big pincers out front (leading side bigger), opening/closing ──
    for (const s of [-1, 1]) {
      const lead = s === dir                                          // the claw facing travel leads
      const armX = s * bw * 0.46, armY = -bh * 0.05
      const cx = armX + s * (7 + 2 * (lead ? 1 : 0)), cy = armY - 3 - 2 * bob       // claw centre
      const cs = lead ? 5.6 : 4.4                                     // claw size
      // upper arm
      ctx.strokeStyle = CRAB_LIMB; ctx.lineWidth = 3.2; ctx.lineCap = 'round'
      ctx.beginPath(); ctx.moveTo(armX, armY); ctx.quadraticCurveTo(armX + s * 4, armY - 4, cx, cy); ctx.stroke()
      ctx.strokeStyle = CRAB_INK; ctx.lineWidth = 1.0
      ctx.beginPath(); ctx.moveTo(armX, armY); ctx.quadraticCurveTo(armX + s * 4, armY - 4, cx, cy); ctx.stroke()
      // pincer: a fixed lower jaw + a hinged upper jaw that snaps
      const gap = (lead ? 0.9 : 0.6) * snap                          // how far the upper jaw lifts
      ctx.fillStyle = CRAB_LIMB
      // lower jaw (fixed)
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.quadraticCurveTo(cx + s * cs, cy + cs * 0.5, cx + s * cs * 1.5, cy + cs * 0.2)
      ctx.quadraticCurveTo(cx + s * cs, cy + cs * 0.9, cx, cy + cs * 0.3)
      ctx.closePath(); ctx.fill()
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.quadraticCurveTo(cx + s * cs, cy + cs * 0.5, cx + s * cs * 1.5, cy + cs * 0.2)
      ctx.quadraticCurveTo(cx + s * cs, cy + cs * 0.9, cx, cy + cs * 0.3)
      ctx.closePath(); this.#inkContour(CRAB_INK, 1.3)
      // upper jaw (snaps open by `gap`)
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(-s * gap)
      ctx.fillStyle = CRAB_LIMB
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.quadraticCurveTo(s * cs, -cs * 0.5, s * cs * 1.5, -cs * 0.2)
      ctx.quadraticCurveTo(s * cs, -cs * 0.9, 0, -cs * 0.3)
      ctx.closePath(); ctx.fill()
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.quadraticCurveTo(s * cs, -cs * 0.5, s * cs * 1.5, -cs * 0.2)
      ctx.quadraticCurveTo(s * cs, -cs * 0.9, 0, -cs * 0.3)
      ctx.closePath(); this.#inkContour(CRAB_INK, 1.3)
      ctx.restore()
    }
    // ── SHELL — wide top-lit dome ──
    ctx.shadowColor = 'rgba(242,69,46,0.5)'; ctx.shadowBlur = 9
    const shell = ctx.createLinearGradient(0, -bh * 0.7, 0, bh * 0.7)
    shell.addColorStop(0, CRAB_SHELL_TOP); shell.addColorStop(0.5, CRAB_SHELL_MID); shell.addColorStop(1, CRAB_SHELL_BOT)
    ctx.fillStyle = shell
    ctx.beginPath(); ctx.ellipse(0, 0, bw * 0.5, bh * 0.62, 0, 0, Math.PI * 2); ctx.fill()
    ctx.shadowBlur = 0
    // pale peach underside lip
    ctx.fillStyle = CRAB_BELLY
    ctx.beginPath(); ctx.ellipse(0, bh * 0.30, bw * 0.40, bh * 0.22, 0, 0, Math.PI * 2); ctx.fill()
    // specular hotspot on the dome
    ctx.globalAlpha = 0.55; ctx.fillStyle = '#ffffff'
    ctx.beginPath(); ctx.ellipse(-bw * 0.16, -bh * 0.30, bw * 0.13, bh * 0.16, -0.4, 0, Math.PI * 2); ctx.fill()
    ctx.globalAlpha = 1
    // a couple of darker shell bumps for texture
    ctx.fillStyle = this.#darken(CRAB_SHELL_MID); ctx.globalAlpha = 0.35
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * bw * 0.24, -bh * 0.05, 1.8, 0, Math.PI * 2); ctx.fill() }
    ctx.beginPath(); ctx.arc(0, bh * 0.10, 1.8, 0, Math.PI * 2); ctx.fill()
    ctx.globalAlpha = 1
    // shell ink contour
    ctx.beginPath(); ctx.ellipse(0, 0, bw * 0.5, bh * 0.62, 0, 0, Math.PI * 2); this.#inkContour(CRAB_INK, 1.7)
    // ── STALK EYES — two googly domes on wobbling stalks atop the shell ──
    const wob = Math.sin(time * 11) * 0.9                            // free eye-stalk wobble
    const eyeBaseY = -bh * 0.55, eyeDX = bw * 0.22, stalkH = 8, eyeR = 3.6
    for (const s of [-1, 1]) {
      const baseX = s * eyeDX
      const tipX = baseX + dir * 1.2 + s * wob, tipY = eyeBaseY - stalkH
      // stalk
      ctx.strokeStyle = CRAB_LIMB; ctx.lineWidth = 2.4; ctx.lineCap = 'round'
      ctx.beginPath(); ctx.moveTo(baseX, eyeBaseY); ctx.quadraticCurveTo(baseX + s * wob * 0.4, eyeBaseY - stalkH * 0.5, tipX, tipY); ctx.stroke()
      ctx.strokeStyle = CRAB_INK; ctx.lineWidth = 1.0
      ctx.beginPath(); ctx.moveTo(baseX, eyeBaseY); ctx.quadraticCurveTo(baseX + s * wob * 0.4, eyeBaseY - stalkH * 0.5, tipX, tipY); ctx.stroke()
      // eyeball
      ctx.fillStyle = '#ffffff'
      ctx.beginPath(); ctx.arc(tipX, tipY, eyeR, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.arc(tipX, tipY, eyeR, 0, Math.PI * 2); this.#inkContour(CRAB_INK, 1.2)
      // pupil looks toward travel; jiggles with the bounce
      const pdx = dir * 1.4, pdy = 0.6 * step
      ctx.fillStyle = '#1a0606'
      ctx.beginPath(); ctx.arc(tipX + pdx, tipY + pdy, 1.7, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.9)'
      ctx.beginPath(); ctx.arc(tipX + pdx - 0.6, tipY + pdy - 0.6, 0.7, 0, Math.PI * 2); ctx.fill()
    }
    // ── MOUTH — small bubbly grin under the dome, with two foam bubbles ──
    ctx.strokeStyle = CRAB_INK; ctx.lineWidth = 1.6; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(-bw * 0.18, bh * 0.20); ctx.quadraticCurveTo(0, bh * (0.30 + 0.06 * snap), bw * 0.18, bh * 0.20); ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.beginPath(); ctx.arc(-bw * 0.10 + dir, bh * 0.34, 1.0 * snap, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(bw * 0.06 + dir, bh * 0.40, 0.8 * snap, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }

  /** The floating GHOST — an alternate top pill-dispenser. Float phase comes from
   *  a.frame; a slow sine bob drives a soft vertical drift and a tilt, and the
   *  scalloped tail-hem ripples. Slightly translucent with a faint lilac glow.
   *  Unified ink-contour cartoon, matching the frog. */
  #dispGhost(a: Alien, time: number): void {
    const ctx = this.#ctx
    const x = a.x, y = a.y, hw = ALIEN_W / 2
    // Reconstruct the float phase to drive the lean + hem ripple (matches the engine).
    const ph = (a.frame / GHOST_BOB_PERIOD) * Math.PI * 2
    const bob = Math.sin(ph)                                  // -1 .. 1 (also where a.y came from)
    const dir = Math.sign(a.vx) || 1
    const bw = 24, bh = 26
    const lean = -dir * 0.10 + 0.05 * Math.sin(ph * 1.5)      // drifts/leans into travel
    const rise = (bob + 1) * 0.5                              // 0 low .. 1 high (shadow shrinks high)

    ctx.save()
    // Ground shadow far below — a ghost floats, so the shadow is small, soft, and
    // fades as it rises. Drawn BEFORE the body alpha so it stays opaque.
    ctx.fillStyle = `rgba(40,24,70,${0.20 * (1 - 0.5 * rise)})`
    ctx.beginPath()
    ctx.ellipse(x, 40, hw * (0.85 - 0.30 * rise), 2.8 * (0.85 - 0.30 * rise), 0, 0, Math.PI * 2)
    ctx.fill()

    ctx.translate(x, y)
    ctx.rotate(lean)
    ctx.globalAlpha = 0.85                                    // the whole spook is gently translucent

    // ── BODY SILHOUETTE — domed top + straight sides + a rippling scalloped hem ──
    // Build one closed path: half-circle dome, down the sides, then a wavy bottom.
    const top = -bh * 0.5, bottom = bh * 0.5, hwx = bw * 0.5
    const buildBody = () => {
      ctx.beginPath()
      ctx.moveTo(-hwx, bottom * 0.1)
      // left shoulder up and over the dome to the right shoulder
      ctx.arc(0, top + hwx, hwx, Math.PI, 0, false)          // semicircle crown
      ctx.lineTo(hwx, bottom * 0.1)
      // scalloped tail-hem: 4 bumps, each phase-shifted so the hem RIPPLES over time
      const bumps = 4, span = (hwx * 2) / bumps
      for (let i = 0; i < bumps; i++) {
        const x0 = hwx - i * span
        const x1 = x0 - span
        const dip = 5 + 2.2 * Math.sin(time * 5 + i * 1.5 + ph)   // each scallop wobbles
        ctx.quadraticCurveTo((x0 + x1) / 2, bottom * 0.1 + dip, x1, bottom * 0.1)
      }
      ctx.closePath()
    }

    // soft lilac glow behind the body
    ctx.shadowColor = `rgba(201,182,255,0.85)`               // GHOST_GLOW, soft
    ctx.shadowBlur = 12
    const body = ctx.createLinearGradient(0, top, 0, bottom)
    body.addColorStop(0, GHOST_BODY_TOP)
    body.addColorStop(0.45, GHOST_BODY_MID)
    body.addColorStop(1, GHOST_BODY_BOT)
    buildBody(); ctx.fillStyle = body; ctx.fill()
    ctx.shadowBlur = 0

    // faint cool-white belly sheen, offset toward the lit side
    ctx.globalAlpha = 0.85 * 0.5
    ctx.fillStyle = GHOST_BELLY
    ctx.beginPath()
    ctx.ellipse(-bw * 0.10, bh * 0.04, bw * 0.30, bh * 0.30, 0, 0, Math.PI * 2)
    ctx.fill()
    // crisp white specular hotspot up top
    ctx.globalAlpha = 0.85 * 0.7
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.ellipse(-bw * 0.18, -bh * 0.28, bw * 0.13, bh * 0.11, -0.4, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 0.85

    // ── BODY INK CONTOUR — re-issue the same body path, then stroke it once ──
    buildBody(); this.#inkContour(GHOST_INK, 1.7)

    // ── EYES — two big innocent googly ovals, pupils lean with travel + a slow drift ──
    const eyeY = -bh * 0.16, eyeDX = bw * 0.22, eyeRX = 4.2, eyeRY = 5.4
    const look = dir * 1.5 + 0.6 * Math.sin(time * 2)         // dreamy wandering gaze
    for (const s of [-1, 1]) {
      const ex = s * eyeDX
      ctx.fillStyle = '#ffffff'
      ctx.beginPath(); ctx.ellipse(ex, eyeY, eyeRX, eyeRY, 0, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.ellipse(ex, eyeY, eyeRX, eyeRY, 0, 0, Math.PI * 2)
      this.#inkContour(GHOST_INK, 1.2)
      // big dark pupil
      ctx.fillStyle = '#2A1E45'
      ctx.beginPath(); ctx.arc(ex + look, eyeY + 1.4, 2.4, 0, Math.PI * 2); ctx.fill()
      // glossy catch-light
      ctx.fillStyle = 'rgba(255,255,255,0.95)'
      ctx.beginPath(); ctx.arc(ex + look - 0.9, eyeY + 0.4, 0.9, 0, Math.PI * 2); ctx.fill()
    }

    // ── MOUTH — a little round "oooo", breathing wider on the up-bob ──
    const oo = 2.6 + 1.4 * (rise)                             // wider at the top of the float
    ctx.fillStyle = GHOST_INK
    ctx.beginPath(); ctx.ellipse(0, bh * 0.20, oo * 0.75, oo, 0, 0, Math.PI * 2); ctx.fill()
    // inner dark of the mouth so it reads open, not a dot
    ctx.fillStyle = '#3A2A5E'
    ctx.beginPath(); ctx.ellipse(0, bh * 0.21, oo * 0.5, oo * 0.7, 0, 0, Math.PI * 2); ctx.fill()

    // ── ROSY CHEEKS ──
    ctx.globalAlpha = 0.85 * 0.55
    ctx.fillStyle = GHOST_CHEEK
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.ellipse(s * bw * 0.30, bh * 0.06, 2.6, 1.7, 0, 0, Math.PI * 2); ctx.fill()
    }

    ctx.globalAlpha = 1
    ctx.restore()
  }

  /** The flappy baby CHICK — top pill-dispenser. Wing-beat phase comes from a.frame;
 *  wings sweep down as the body rises. Unified ink-cartoon look. */
#dispChick(a: Alien, time: number): void {
  const ctx = this.#ctx
  const x = a.x, y = a.y, hw = ALIEN_W / 2
  // Reconstruct the engine's wing-beat phase from a.frame (matches #stepAlien).
  const beat = (a.frame % CHICK_BOB_PERIOD) / CHICK_BOB_PERIOD          // 0..1 across one beat
  // Wing down-stroke fraction: 0 (wings up/high) .. 1 (wings swept fully down) — peaks with the rise.
  const flap = -Math.cos(beat * Math.PI * 2) * 0.5 + 0.5               // 0 .. 1, =1 at beat 0.5 (chick highest)
  const dir = Math.sign(a.vx) || 1
  // Squash: chick puffs round at the top of the bob (down-flap), stretches a touch on the up-beat.
  const sx = 1 + 0.06 * flap
  const sy = 1 - 0.06 * flap + 0.03 * Math.sin(time * 9)               // tiny idle breathing
  const bw = 23, bh = 21
  ctx.save()
  // ── AIR SHADOW — soft ground hint at the baseline, fading as the chick climbs ──
  const climb = (ALIEN_Y - y) / 12                                     // ~0 low .. ~1 high
  const sh = Math.max(0, Math.min(1, climb))
  ctx.fillStyle = `rgba(40,30,8,${0.26 * (1 - 0.55 * sh)})`
  ctx.beginPath()
  ctx.ellipse(x, 35, hw * (1 - 0.30 * sh), 3 * (1 - 0.30 * sh), 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.translate(x, y); ctx.scale(sx, sy)

  // ── TAIL FEATHERS — a little three-feather fan at the back, opposite travel ──
  const tailX = -dir * bw * 0.46
  ctx.fillStyle = CHICK_BODY_BOT
  for (const k of [-1, 0, 1]) {
    const ang = k * 0.42 - 0.10 * dir
    const tx = tailX - dir * 6 * Math.cos(ang), ty = -bh * 0.06 + 7 * Math.sin(ang)
    const tail = () => {
      ctx.beginPath()
      ctx.moveTo(tailX, -bh * 0.04)
      ctx.quadraticCurveTo(tailX - dir * 3, ty - 2, tx, ty)
      ctx.quadraticCurveTo(tailX - dir * 2, ty + 2, tailX, bh * 0.06)
      ctx.closePath()
    }
    tail(); ctx.fillStyle = CHICK_BODY_BOT; ctx.fill()
    tail(); this.#inkContour(CHICK_INK, 1.2)
  }

  // ── FAR WING (behind the body) — sweeps with the beat, dimmer ──
  const wingAng = (0.55 - 1.15 * flap)                                 // up at beat 0, swept DOWN at beat 0.5
  const drawWing = (side: number, shade: string) => {
    ctx.save()
    ctx.translate(side * bw * 0.40, -bh * 0.06)
    ctx.rotate(side * wingAng)
    ctx.fillStyle = shade
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.quadraticCurveTo(side * 6, -9, side * 15, -3)
    ctx.quadraticCurveTo(side * 18, 2, side * 13, 6)
    ctx.quadraticCurveTo(side * 6, 7, 0, 4)
    ctx.closePath()
    ctx.fill()
    // re-issue the wing path for the single ink pass
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.quadraticCurveTo(side * 6, -9, side * 15, -3)
    ctx.quadraticCurveTo(side * 18, 2, side * 13, 6)
    ctx.quadraticCurveTo(side * 6, 7, 0, 4)
    ctx.closePath()
    this.#inkContour(CHICK_INK, 1.3)
    // two feather creases
    ctx.strokeStyle = CHICK_INK; ctx.lineWidth = 0.8; ctx.globalAlpha = 0.5
    ctx.beginPath(); ctx.moveTo(side * 4, 0); ctx.quadraticCurveTo(side * 9, -1, side * 12, 1); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(side * 4, 3); ctx.quadraticCurveTo(side * 8, 3, side * 11, 4); ctx.stroke()
    ctx.globalAlpha = 1
    ctx.restore()
  }
  drawWing(-dir, CHICK_BODY_BOT)                                       // far wing first, darker

  // ── HEAD TUFT — three little feathers, jiggle with the flap ──
  const tuftJ = Math.sin(time * 11) * 0.10 + (flap - 0.5) * 0.18
  ctx.fillStyle = CHICK_BODY_MID
  for (const k of [-1, 0, 1]) {
    const ang = k * 0.46 + tuftJ
    const px = Math.sin(ang) * 8, py = -bh * 0.5 - 6 - Math.cos(ang) * 4
    const tuft = () => {
      ctx.beginPath()
      ctx.moveTo(k * 2.2, -bh * 0.5 + 2)
      ctx.quadraticCurveTo(px * 0.5, py + 4, px, py)
      ctx.quadraticCurveTo(px + 1.2, py + 2.5, k * 2.2 + 1.4, -bh * 0.5 + 3)
      ctx.closePath()
    }
    tuft(); ctx.fillStyle = CHICK_BODY_MID; ctx.fill()
    tuft(); this.#inkContour(CHICK_INK, 1.1)
  }

  // ── FEET — two little orange danglers, tuck up on the down-flap (climbing) ──
  const tuck = flap                                                    // legs tuck as it rises
  ctx.strokeStyle = CHICK_BEAK; ctx.lineWidth = 2.2; ctx.lineCap = 'round'
  for (const s of [-1, 1]) {
    const lx = s * bw * 0.16, ly = bh * 0.46
    const fy = ly + 6 - 4 * tuck
    ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + s * 1.5, fy); ctx.stroke()
    // three toes
    ctx.lineWidth = 1.6
    for (const t of [-1, 0, 1]) { ctx.beginPath(); ctx.moveTo(lx + s * 1.5, fy); ctx.lineTo(lx + s * 1.5 + t * 2.4, fy + 2.4); ctx.stroke() }
    ctx.lineWidth = 2.2
  }

  // ── BODY — round fluffy yellow ball, top-lit ──
  ctx.shadowColor = 'rgba(255,210,59,0.5)'; ctx.shadowBlur = 9
  const body = ctx.createLinearGradient(0, -bh * 0.5, 0, bh * 0.5)
  body.addColorStop(0, CHICK_BODY_TOP); body.addColorStop(0.5, CHICK_BODY_MID); body.addColorStop(1, CHICK_BODY_BOT)
  ctx.fillStyle = body
  ctx.beginPath(); ctx.ellipse(0, 0, bw * 0.5, bh * 0.5, 0, 0, Math.PI * 2); ctx.fill()
  ctx.shadowBlur = 0
  // glossy pale belly + a specular hotspot
  ctx.fillStyle = CHICK_BELLY
  ctx.beginPath(); ctx.ellipse(0, bh * 0.20, bw * 0.32, bh * 0.26, 0, 0, Math.PI * 2); ctx.fill()
  ctx.globalAlpha = 0.6; ctx.fillStyle = '#ffffff'
  ctx.beginPath(); ctx.ellipse(-bw * 0.18, -bh * 0.22, bw * 0.13, bh * 0.10, -0.4, 0, Math.PI * 2); ctx.fill()
  ctx.globalAlpha = 1
  // soft fluff scallops along the lower edge (cheap: short arcs)
  ctx.strokeStyle = this.#darken(CHICK_BODY_MID); ctx.lineWidth = 0.9; ctx.globalAlpha = 0.35
  for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.arc(i * bw * 0.16, bh * 0.42, 2.2, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke() }
  ctx.globalAlpha = 1
  // body ink contour (re-issue path, then one ink pass)
  ctx.beginPath(); ctx.ellipse(0, 0, bw * 0.5, bh * 0.5, 0, 0, Math.PI * 2); this.#inkContour(CHICK_INK, 1.7)

  // ── EYES — two big googly domes, pupils lead the travel direction ──
  const eyeY = -bh * 0.16, eyeDX = bw * 0.22, eyeR = 5
  for (const s of [-1, 1]) {
    const ex = s * eyeDX
    ctx.fillStyle = '#ffffff'
    ctx.beginPath(); ctx.arc(ex, eyeY, eyeR, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(ex, eyeY, eyeR, 0, Math.PI * 2); this.#inkContour(CHICK_INK, 1.3)
    const pdx = dir * 1.7, pdy = -0.6 + 1.2 * flap                     // pupils bounce a touch with the beat
    ctx.fillStyle = '#1a1206'
    ctx.beginPath(); ctx.arc(ex + pdx, eyeY + pdy, 2.2, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.95)'
    ctx.beginPath(); ctx.arc(ex + pdx - 0.8, eyeY + pdy - 0.9, 0.85, 0, Math.PI * 2); ctx.fill()
  }

  // ── BEAK — little orange diamond between the eyes, opens a hair on the up-beat ──
  const gape = (1 - flap) * 1.4                                        // mouth wider mid-up-stroke
  const bkX = dir * 1.5, bkY = bh * 0.04
  ctx.fillStyle = CHICK_BEAK
  const beak = () => {
    ctx.beginPath()
    ctx.moveTo(bkX - 4, bkY)
    ctx.lineTo(bkX + 4, bkY - 1)
    ctx.lineTo(bkX + 1, bkY + 2.6 + gape)
    ctx.closePath()
  }
  beak(); ctx.fillStyle = CHICK_BEAK; ctx.fill()
  beak(); this.#inkContour(this.#darken(CHICK_BEAK), 1.2)
  // lower beak half on the gape
  if (gape > 0.3) {
    ctx.fillStyle = '#d96a14'
    ctx.beginPath(); ctx.moveTo(bkX - 3, bkY + 1.2); ctx.lineTo(bkX + 3, bkY + 0.6); ctx.lineTo(bkX + 1, bkY + 2.6 + gape); ctx.closePath(); ctx.fill()
  }
  // rosy cheeks
  ctx.globalAlpha = 0.5; ctx.fillStyle = '#ff9a7a'
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(s * bw * 0.34, bh * 0.04, 2.4, 1.6, 0, 0, Math.PI * 2); ctx.fill() }
  ctx.globalAlpha = 1

  // ── NEAR WING (in front of the body) — same beat, brighter ──
  drawWing(dir, CHICK_BODY_MID)
  ctx.restore()
}

  /** The extra-life carrier — a beautiful winged heart trailing sparkles and a soft
   *  golden aura, gently bobbing as it sweeps across. */
  #extraLife(c: ExtraLife, time: number): void {
    const ctx = this.#ctx
    const x = c.x, y = c.y + Math.sin(time * 3) * 3            // gentle bob
    const flap = Math.sin(time * 9)                            // wing beat
    ctx.save()
    // soft golden aura
    const aura = ctx.createRadialGradient(x, y, 2, x, y, 30)
    aura.addColorStop(0, 'rgba(255,224,120,0.45)'); aura.addColorStop(1, 'rgba(255,224,120,0)')
    ctx.fillStyle = aura
    ctx.beginPath(); ctx.arc(x, y, 30, 0, Math.PI * 2); ctx.fill()
    // trailing sparkles
    for (let i = 0; i < 5; i++) {
      const a = time * 2 + i * 1.3, rr = 16 + 6 * Math.sin(time * 4 + i)
      const sx = x - Math.sign(c.vx || 1) * (10 + i * 5), sy = y + Math.sin(a) * 6
      ctx.globalAlpha = 0.5 - i * 0.08
      ctx.fillStyle = '#fff6c8'
      ctx.beginPath(); ctx.arc(sx, sy, 1.6, 0, Math.PI * 2); ctx.fill()
    }
    ctx.globalAlpha = 1
    // feathered wings (flap), behind the heart
    for (const s of [-1, 1]) {
      ctx.save()
      ctx.translate(x + s * 9, y - 2)
      ctx.rotate(s * (-0.5 + 0.35 * flap))
      ctx.shadowColor = 'rgba(255,255,255,0.7)'; ctx.shadowBlur = 8
      const wg = ctx.createLinearGradient(0, 0, s * 18, -4)
      wg.addColorStop(0, '#ffffff'); wg.addColorStop(1, '#cfe2ff')
      ctx.fillStyle = wg
      ctx.beginPath()
      ctx.moveTo(0, 4)
      ctx.quadraticCurveTo(s * 14, -6, s * 20, -2)
      ctx.quadraticCurveTo(s * 13, 2, s * 16, 8)
      ctx.quadraticCurveTo(s * 9, 5, s * 10, 11)
      ctx.quadraticCurveTo(s * 5, 7, 0, 4)
      ctx.closePath(); ctx.fill()
      ctx.restore()
    }
    // the heart — glossy red→pink, with a highlight
    const beat = 1 + 0.06 * Math.sin(time * 6)
    ctx.shadowColor = '#ff5b8a'; ctx.shadowBlur = 12
    const hg = ctx.createRadialGradient(x - 3, y - 4, 1, x, y, 12)
    hg.addColorStop(0, '#ffd0e0'); hg.addColorStop(0.5, '#ff5b8a'); hg.addColorStop(1, '#c81e5a')
    ctx.fillStyle = hg
    const R = 11 * beat
    ctx.beginPath()
    ctx.moveTo(x, y + R * 0.85)
    ctx.bezierCurveTo(x - R * 1.3, y - R * 0.25, x - R * 0.55, y - R * 0.95, x, y - R * 0.35)
    ctx.bezierCurveTo(x + R * 0.55, y - R * 0.95, x + R * 1.3, y - R * 0.25, x, y + R * 0.85)
    ctx.closePath(); ctx.fill()
    ctx.shadowBlur = 0
    ctx.fillStyle = 'rgba(255,255,255,0.8)'                    // gloss
    ctx.beginPath(); ctx.ellipse(x - 3.5, y - 3, 2.4, 1.6, -0.5, 0, Math.PI * 2); ctx.fill()
    // a tiny "1UP" tag
    ctx.fillStyle = '#fff'; ctx.font = '800 7px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('1UP', x, y + R + 7)
    ctx.restore()
  }

  /** A flashy burst where a bonus was just caught: an expanding colour ring,
   *  radiating sparks, and the power glyph popping up — keyed to its colour. */
  #pickups(pickups: readonly Pickup[]): void {
    if (!pickups.length) return
    const ctx = this.#ctx
    for (const p of pickups) {
      const meta = POWER_META[p.kind]
      const k = Math.min(1, p.t / 0.5)
      const a = 1 - k
      ctx.save()
      ctx.shadowColor = meta.color; ctx.shadowBlur = 12
      ctx.globalAlpha = a
      ctx.strokeStyle = meta.color; ctx.lineWidth = 2 + 2.5 * a
      ctx.beginPath(); ctx.arc(p.x, p.y, 5 + k * 26, 0, Math.PI * 2); ctx.stroke()   // expanding ring
      ctx.fillStyle = meta.color                                                     // radiating sparks
      for (let i = 0; i < 9; i++) {
        const ang = (i / 9) * Math.PI * 2, rr = 7 + k * 24
        ctx.beginPath(); ctx.arc(p.x + Math.cos(ang) * rr, p.y + Math.sin(ang) * rr, 1.4 * a + 0.4, 0, Math.PI * 2); ctx.fill()
      }
      ctx.font = `800 ${13 + 6 * a}px "Segoe UI", system-ui, sans-serif`                // glyph pops up
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(meta.letter, p.x, p.y - 12 - k * 18)
      ctx.restore()
    }
  }

  /** Floating combo counters rising from each chained kill (×N). */
  /** Floating combo counters (×N) only — the point NUMBERS no longer clutter the
   *  playfield (the score lives in the corner HUD). */
  #comboPops(pops: readonly ComboPop[]): void {
    if (!pops.length) return
    const ctx = this.#ctx
    for (const p of pops) {
      if (p.t < 0) continue                                // staggered milestone bead — not started yet
      if (p.pts !== undefined) continue                    // points removed from the screen — combo ×N only
      const k = Math.min(1, p.t / 0.9)
      ctx.save()
      ctx.globalAlpha = Math.max(0, 1 - k)
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      const big = p.n >= 6
      ctx.font = `800 ${13 + Math.min(11, p.n)}px "Segoe UI", system-ui, sans-serif`
      ctx.fillStyle = big ? '#ffd24a' : '#ffffff'
      ctx.shadowColor = big ? '#ff7043' : 'rgba(126,224,255,0.85)'; ctx.shadowBlur = 8
      ctx.fillText(`×${p.n}`, p.x, p.y - k * 30)
      ctx.restore()
    }
  }

  /** The milestone eruption (combo ×5/×10/×15/×20+): an escalating tier-coloured burst
   *  with a 'COMBO ×N' headline. Deterministic in time (no Math.random in render). */
  #milestone(n: number, t: number, life = false): void {
    const ctx = this.#ctx
    const cx = W / 2, cy = H * 0.40
    const tier = n >= 20 ? 3 : n >= 15 ? 2 : n >= 10 ? 1 : 0
    const col = ['#7ee0ff', '#5fe08a', '#ffd24a', '#ff7043'][tier]
    const rings = tier + 1                                  // 1..4 concentric rings escalate with the tier
    const fade = t > 0.8 ? Math.max(0, 1 - (t - 0.8) / 0.3) : 1
    ctx.save()
    // tier vignette / brief screen flash
    if (tier >= 1 && t < 0.5) { ctx.globalAlpha = (tier >= 3 ? 0.12 : 0.06) * (1 - t / 0.5); ctx.fillStyle = col; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1 }
    // expanding burst ring(s)
    ctx.shadowColor = col; ctx.shadowBlur = 10
    for (let i = 0; i < rings; i++) {
      const rp = Math.min(1, Math.max(0, (t - i * 0.06) / 1.0))
      if (rp <= 0) continue
      ctx.globalAlpha = (1 - rp) * 0.9
      ctx.strokeStyle = col; ctx.lineWidth = 6 - rp * 5
      ctx.beginPath(); ctx.arc(cx, cy, 10 + rp * 120, 0, Math.PI * 2); ctx.stroke()
    }
    ctx.shadowBlur = 0
    // 'COMBO ×N' headline — quick overshoot, fading the last 0.3s
    const pop = 1 + 0.4 * Math.sin(Math.min(1, t / 0.18) * Math.PI)
    ctx.globalAlpha = fade
    ctx.save()
    ctx.translate(cx, cy); ctx.scale(pop, pop)
    ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 18
    ctx.font = `800 ${28 + Math.min(28, n)}px "Segoe UI", system-ui, sans-serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(`COMBO ×${n}`, 0, 0)
    ctx.restore()
    if (life) {                                            // only when a life was actually granted (not at max lives)
      ctx.globalAlpha = fade
      ctx.fillStyle = '#ffffff'; ctx.shadowColor = col; ctx.shadowBlur = 8
      ctx.font = '800 16px "Segoe UI", system-ui, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText('+1 LIFE', cx, cy - 42 - Math.min(28, n) / 2)
    }
    ctx.restore()
  }

  /** Frenzy start: a red screen flash + jagged lightning bolts + a "FRENZY!" shout —
   *  the gold brick wasn't broken in time. Deterministic in time (no Math.random). */
  #frenzy(flash: number, time: number): void {
    const ctx = this.#ctx
    const f = Math.min(1, flash / 0.7)                     // 1 at the start → 0 as it fades
    ctx.save()
    ctx.fillStyle = `rgba(255,48,48,${0.20 * f})`          // red wash
    ctx.fillRect(0, 0, W, H)
    // a few jagged lightning bolts top→bottom, flickering with time
    ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < 4; i++) {
      const baseX = W * (0.18 + 0.21 * i) + Math.sin(time * 30 + i) * 10
      ctx.strokeStyle = `rgba(${i % 2 ? 200 : 255},${230},255,${(0.55 + 0.35 * Math.sin(time * 50 + i * 2)) * f})`
      ctx.lineWidth = 2.2; ctx.shadowColor = '#bfe3ff'; ctx.shadowBlur = 12
      ctx.beginPath(); ctx.moveTo(baseX, 0)
      for (let y = 0; y <= H; y += 40) {
        const jx = baseX + Math.sin(y * 0.09 + i * 3 + time * 40) * 22 + Math.cos(y * 0.21 + time * 60) * 9
        ctx.lineTo(jx, y)
      }
      ctx.stroke()
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.shadowBlur = 0
    // FRENZY! shout, jittering
    const pop = 1 + 0.12 * Math.sin(time * 40)
    ctx.save()
    ctx.translate(W / 2 + Math.sin(time * 53) * 4, H * 0.3); ctx.scale(pop, pop)
    ctx.globalAlpha = f
    ctx.fillStyle = '#fff'; ctx.shadowColor = '#ff3b3b'; ctx.shadowBlur = 16
    ctx.font = '900 40px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('FRENZY!', 0, 0)
    ctx.restore()
    ctx.restore()
  }

  #explosions(explosions: readonly Explosion[]): void {
    if (!explosions.length) return
    const ctx = this.#ctx
    for (const e of explosions) {
      const p = Math.min(1, e.t / EXPLOSION_DUR)        // 0 → 1 over the blast life
      const r = 8 + p * ROCKET_RADIUS
      const plasma = e.hue === 'plasma'                  // fireball detonation = white-hot cyan, not TNT orange
      const core = plasma ? '#7ec8ff' : '#ff7043'
      const ring = plasma ? '#bfe3ff' : '#ffcf5e'
      ctx.save()
      ctx.shadowColor = core; ctx.shadowBlur = 14
      ctx.globalAlpha = (1 - p) * 0.5
      ctx.fillStyle = plasma ? '#ffffff' : core
      ctx.beginPath(); ctx.arc(e.x, e.y, r * 0.6, 0, Math.PI * 2); ctx.fill()
      ctx.globalAlpha = 1 - p
      ctx.strokeStyle = ring; ctx.lineWidth = 3 + (1 - p) * 4
      ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, Math.PI * 2); ctx.stroke()
      ctx.restore()
    }
  }

  /** One-time aim hint: the ±25% movable band + a lock/launch prompt. */
  #aimHint(engine: Engine, time: number): void {
    const ctx = this.#ctx
    const p = engine.paddle
    const anchor = engine.aimAnchorX, range = engine.aimRange
    const lo = anchor - range, hi = anchor + range          // the paddle's slide range under the still ball
    ctx.save()
    ctx.strokeStyle = 'rgba(126,224,255,0.35)'; ctx.lineWidth = 2; ctx.setLineDash([5, 5])
    ctx.beginPath(); ctx.moveTo(lo, p.y + p.h / 2); ctx.lineTo(hi, p.y + p.h / 2); ctx.stroke()
    ctx.setLineDash([])
    for (const x of [lo, hi]) { ctx.beginPath(); ctx.moveTo(x, p.y - 6); ctx.lineTo(x, p.y + p.h + 6); ctx.stroke() }
    // a gold tick on the paddle marking where on it the ball will sit (the contact point)
    ctx.strokeStyle = 'rgba(255,210,74,0.9)'; ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(anchor, p.y - p.h / 2 - 2); ctx.lineTo(anchor, p.y + p.h / 2 + 2); ctx.stroke()
    const pulse = 0.5 + 0.5 * Math.sin(time * 6)            // the still ball, hovering at the anchor
    ctx.strokeStyle = `rgba(255,255,255,${0.4 + 0.4 * pulse})`; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.arc(anchor, p.y - 15, 12 + 3 * pulse, 0, Math.PI * 2); ctx.stroke()
    ctx.fillStyle = '#bfe3ff'; ctx.font = '600 13px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'
    ctx.fillText('slide the paddle to set the ball’s spot · click to set, then launch any time', anchor, p.y - 30)
    ctx.restore()
  }

  #hud(engine: Engine): void {
    const ctx = this.#ctx
    ctx.save()
    ctx.textBaseline = 'top'
    ctx.textAlign = 'left'
    // Score — pops with a scale pulse when a milestone bonus lands.
    const sf = engine.scoreFlash > 0 ? 1 + 0.3 * (engine.scoreFlash / 0.45) : 1
    ctx.save()
    ctx.translate(8, 8); ctx.scale(sf, sf)
    ctx.fillStyle = 'rgba(223,231,255,0.95)'
    ctx.font = '600 18px "Segoe UI", system-ui, sans-serif'
    ctx.fillText(`✦ ${engine.score}`, 0, 0)
    ctx.restore()
    // Unified multiplier block in the LEFT MARGIN (bricks start at x≈92): the grand
    // TOTAL, then the two axes that multiply into it. (Oscillate's ×1.6 rides on top.)
    const pts = engine.pointsMul, pil = engine.pillMul, total = pts * pil
    const tcol = total >= 12 ? '#ff7043' : total >= 6 ? '#ffd24a' : '#7ee0ff'
    ctx.font = `800 ${16 + Math.min(10, total)}px "Segoe UI", system-ui, sans-serif`
    ctx.fillStyle = tcol; ctx.shadowColor = tcol; ctx.shadowBlur = 4 + Math.min(12, total)
    ctx.fillText(`×${total.toFixed(1)}`, 8, 30)
    ctx.shadowBlur = 0
    const chip = (label: string, col: string, frac: number, y: number) => {
      ctx.font = '700 11px "Segoe UI", system-ui, sans-serif'
      ctx.fillStyle = col
      ctx.fillText(label, 8, y)
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; this.#roundRect(8, y + 13, 72, 3, 1.5); ctx.fill()
      ctx.fillStyle = col; this.#roundRect(8, y + 13, 72 * Math.max(0, Math.min(1, frac)), 3, 1.5); ctx.fill()
    }
    chip(`points ×${pts.toFixed(1)}`, pts >= 5.5 ? '#ffd24a' : '#7ee0ff', pts / 6, 54)
    chip(`pills ×${pil.toFixed(1)}`, pil >= 3 ? '#ffd24a' : '#3fd6c0', (pil - 1) / 2, 74)
    // Reserve balls, top-right — the one in PLAY isn't counted, so on your last
    // life the reserve reads empty. We draw the full reserve capacity as hollow
    // sockets and fill the ones you still hold, so "down to your last" is visible.
    const reserve = Math.max(0, engine.lives - 1)
    const sockets = Math.max(reserve, 4)   // MAX_LIVES(5) - 1 reserve sockets
    for (let i = 0; i < sockets; i++) {
      const cx = W - 12 - i * 16
      ctx.beginPath()
      ctx.arc(cx, 16, 5, 0, Math.PI * 2)
      if (i < reserve) {
        ctx.fillStyle = '#ffffff'; ctx.fill()
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fill()
        ctx.lineWidth = 1; ctx.strokeStyle = reserve === 0 ? 'rgba(255,90,90,0.7)' : 'rgba(255,255,255,0.3)'; ctx.stroke()
      }
    }
    // Gun magazine: G (+ stack level) and a row of ball pips — filled = loaded,
    // hollow = spent — so you can see your shots deplete as you fire.
    if (engine.gunActive) this.#gunMagazine(engine)
    // Active power countdown badges, centred just under the top edge.
    const powers = engine.activePowers
    if (powers.length) {
      const bw = 46, gap = 6
      let bx = (W - (powers.length * bw + (powers.length - 1) * gap)) / 2
      for (const pw of powers) {
        const meta = POWER_META[pw.kind]
        const glyph = meta.letter
        this.#roundRect(bx, 6, bw, 18, 5)
        ctx.fillStyle = 'rgba(10,14,30,0.66)'
        ctx.fill()
        // countdown bar
        ctx.fillStyle = meta.color
        ctx.globalAlpha = 0.85
        this.#roundRect(bx, 21, bw * pw.frac, 3, 1.5)
        ctx.fill()
        ctx.globalAlpha = 1
        ctx.fillStyle = meta.color
        ctx.font = '700 11px "Segoe UI", system-ui, sans-serif'
        ctx.textBaseline = 'middle'; ctx.textAlign = 'left'
        ctx.fillText(glyph, bx + 6, 15)
        ctx.fillStyle = '#dfe7ff'
        ctx.textAlign = 'right'
        ctx.fillText(pw.label, bx + bw - 6, 15)
        bx += bw + gap
      }
    }
    ctx.restore()
  }

  /** Gun magazine readout (top-left, under the score): the letter G, its stack
   *  level once upgraded, then a pip per shot — bright = loaded, hollow = used. */
  #gunMagazine(engine: Engine): void {
    const ctx = this.#ctx
    const gy = 38
    ctx.save()
    ctx.fillStyle = '#d8c2ff'
    ctx.font = '700 12px "Segoe UI", system-ui, sans-serif'
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
    const label = engine.gunLevel >= 2 ? `G L${engine.gunLevel}` : 'G'
    ctx.fillText(label, 10, gy)
    const x0 = 10 + (engine.gunLevel >= 2 ? 36 : 18)
    for (let i = 0; i < engine.gunLoaderSize; i++) {
      const cx = x0 + i * 12
      ctx.beginPath(); ctx.arc(cx, gy, 4, 0, Math.PI * 2)
      if (i < engine.gunAmmo) {
        ctx.fillStyle = '#ffffff'; ctx.fill()
      } else {
        ctx.strokeStyle = 'rgba(216,194,255,0.5)'; ctx.lineWidth = 1; ctx.stroke()
      }
    }
    ctx.restore()
  }

  #roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const ctx = this.#ctx
    const rr = Math.min(r, w / 2, h / 2)
    ctx.beginPath()
    ctx.moveTo(x + rr, y)
    ctx.arcTo(x + w, y, x + w, y + h, rr)
    ctx.arcTo(x + w, y + h, x, y + h, rr)
    ctx.arcTo(x, y + h, x, y, rr)
    ctx.arcTo(x, y, x + w, y, rr)
    ctx.closePath()
  }

  /** Stroke the CURRENT path as a tinted-dark ink contour — the one unifying
   *  cartoon cue. The caller re-issues the same #roundRect/arc path on the line
   *  before. Always a darken()/#darken tint of the body (or soft grey for the
   *  white ball), NEVER #000. Resets shadowBlur so a leftover body glow can't
   *  bleed into the crisp line. A named stroke, not a path-builder. */
  #inkContour(stroke: string, lineWidth: number): void {
    const ctx = this.#ctx
    ctx.shadowBlur = 0
    ctx.lineWidth = lineWidth
    ctx.strokeStyle = stroke
    ctx.stroke()
  }
}
