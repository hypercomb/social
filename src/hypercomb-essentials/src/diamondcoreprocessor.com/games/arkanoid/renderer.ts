// diamondcoreprocessor.com/games/arkanoid/renderer.ts
//
// Draws the Engine's world (bricks, paddle, balls, pills, lasers, gun aim, HUD)
// onto a 2D context the overlay has already transformed into world units. Pure
// draw — no state.

import {
  type Engine, type Brick, type Ball, type Capsule, type Laser, type Rocket, type Explosion, type Enemy, type Bumper, type Alien, type ComboPop, type Pickup,
  POWER_META, W, H, BRICK_W, BRICK_H, BRICK_TOP, BRICK_X0, GUN_AIM_MIN, GUN_AIM_MAX, GUN_DIAG_SPREAD,
  ROCKET_RADIUS, EXPLOSION_DUR, ENEMY_R, ALIEN_W, ALIEN_H,
} from './engine.js'
import { EDIT_COLS, EDIT_ROWS } from './levels.js'

// Brick colour by max hit-points. A disciplined two-hue scheme for "modern
// vector arcade" clarity: the 1–3 hp bricks share a COOL body family (teal →
// aqua → ocean blue) so the field reads as one cohesive wall, and the tough
// 4-hp bricks get a WARM accent so "this one needs more hits" pops out of the
// cool field instead of the whole board being confetti. At runtime a '4' and a
// '*' brick both collapse to max 4 and read GOLD; the editor, where the chars
// are still distinct, shows '4' in amber and '*' in gold (see drawEditor).
const BRICK_COLORS: Record<number, string> = {
  1: '#3fd6c0',   // teal
  2: '#46b6f0',   // aqua
  3: '#3d83e6',   // ocean blue
  4: '#ffae4a',   // warm accent — a clearly tougher brick
}
const TOUGH_COLOR = '#ffd24a'   // gold — the * 4-hp tough brick, the toughest read

// Damage palette: a near-dead brick darkens toward this muted charred grey-brown
// (it is desaturated + darkened, NOT just faded), so wear reads at a glance while
// the shape stays solid.
const BRICK_CHARRED = { r: 58, g: 50, b: 46 }

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

export class Renderer {
  #ctx: CanvasRenderingContext2D
  constructor(ctx: CanvasRenderingContext2D) { this.#ctx = ctx }

  draw(engine: Engine, time: number): void {
    this.#bricks(engine.bricks, time)
    this.#bumpers(engine.bumpers, time)
    this.#lasers(engine.lasers)
    this.#gunAim(engine, time)
    this.#paddle(engine)
    this.#beam(engine)
    if (engine.alien) this.#alien(engine.alien, time)
    for (const b of engine.balls) this.#ball(b, time)
    this.#capsules(engine.capsules, time)
    if (engine.enemy) this.#enemy(engine.enemy, engine.balls.find(b => b.primary) ?? null, time)
    this.#rockets(engine.rockets)
    this.#explosions(engine.explosions)
    this.#pickups(engine.pickups)
    this.#comboPops(engine.comboPops)
    this.#hud(engine)
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
    }
    ctx.globalAlpha = 1
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
    const shade = darken(body, 0.62)                  // bottom of the gradient
    const rx = x + 1.5, ry = y + 1.5, rw = w - 3, rh = h - 3

    ctx.globalAlpha = 1
    // body — a top-lit vertical gradient so it reads as a beveled tile
    this.#roundRect(rx, ry, rw, rh, 4)
    const g = ctx.createLinearGradient(rx, ry, rx, ry + rh)
    g.addColorStop(0, rgbStr(body.r, body.g, body.b))
    g.addColorStop(1, rgbStr(shade.r, shade.g, shade.b))
    ctx.fillStyle = g
    ctx.fill()

    // crisp darker edge so the shape stays solid even when charred
    const edge = darken(body, 0.42)
    ctx.lineWidth = 1
    ctx.strokeStyle = rgbStr(edge.r, edge.g, edge.b)
    this.#roundRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1, 3.5)
    ctx.stroke()

    // top highlight — kept crisp (fades only slightly with wear), the strongest
    // "this is a fresh solid tile" cue
    ctx.globalAlpha = 0.4 * (0.45 + 0.55 * wear)
    ctx.fillStyle = '#ffffff'
    this.#roundRect(rx + 1, ry + 1, rw - 2, rh * 0.4, 3)
    ctx.fill()
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

  #paddle(engine: Engine): void {
    const ctx = this.#ctx
    const p = engine.paddle
    const x = p.x - p.w / 2
    ctx.save()
    if (engine.pinballTimer > 0) {
      // Pinball mode: chrome flipper bats (collision unchanged — still the bar).
      ctx.shadowColor = 'rgba(140,158,255,0.7)'
      ctx.shadowBlur = 12
      this.#roundRect(x, p.y, p.w, p.h, p.h / 2)
      const g = ctx.createLinearGradient(x, p.y, x, p.y + p.h)
      g.addColorStop(0, '#f0f4ff'); g.addColorStop(0.5, '#aeb9ff'); g.addColorStop(1, '#6b7cff')
      ctx.fillStyle = g
      ctx.fill()
      ctx.shadowBlur = 0
      ctx.strokeStyle = 'rgba(40,50,90,0.5)'; ctx.lineWidth = 1.5      // centre seam = two flippers
      ctx.beginPath(); ctx.moveTo(p.x, p.y + 1); ctx.lineTo(p.x, p.y + p.h - 1); ctx.stroke()
      ctx.fillStyle = '#ffe9a8'                                       // pivot studs at the ends
      ctx.beginPath(); ctx.arc(x + 5, p.y + p.h / 2, 2.5, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.arc(x + p.w - 5, p.y + p.h / 2, 2.5, 0, Math.PI * 2); ctx.fill()
    } else {
      ctx.shadowColor = 'rgba(126,224,255,0.65)'
      ctx.shadowBlur = 12
      this.#roundRect(x, p.y, p.w, p.h, p.h / 2)
      const g = ctx.createLinearGradient(x, p.y, x, p.y + p.h)
      g.addColorStop(0, '#bfe9ff')
      g.addColorStop(1, '#5aa9ff')
      ctx.fillStyle = g
      ctx.fill()
    }
    ctx.restore()
    // Laser cannons on the bat ends while armed.
    if (engine.laserTimer > 0) {
      ctx.fillStyle = '#ff8f8f'
      ctx.fillRect(x + 4, p.y - 5, 4, 6)
      ctx.fillRect(x + p.w - 8, p.y - 5, 4, 6)
    }
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

  #ball(ball: Ball, time: number): void {
    const ctx = this.#ctx
    ctx.save()
    const pulse = 0.85 + 0.15 * Math.sin(time * 6)
    if (ball.primary) {
      // The white ball — the one you must keep alive.
      ctx.shadowColor = `rgba(255,255,255,${0.7 * pulse})`
      ctx.shadowBlur = 14
    } else {
      // Coloured ammo fired by the gun / spawned by Break — expendable.
      ctx.shadowColor = ball.color
      ctx.shadowBlur = 12 * pulse
    }
    ctx.beginPath()
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2)
    ctx.fillStyle = ball.color
    ctx.fill()
    ctx.restore()
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
      if (cap.kind === 'oscillate' || cap.kind === 'beam') { this.#mushroom(cap.x, cap.y, meta.color); continue }   // magic mushrooms
      const w = 30, h = 15
      const x = cap.x - w / 2, y = cap.y - h / 2
      ctx.save()
      ctx.shadowColor = meta.color
      ctx.shadowBlur = 12
      this.#roundRect(x, y, w, h, h / 2)
      const g = ctx.createLinearGradient(x, y, x, y + h)
      g.addColorStop(0, '#ffffff')
      g.addColorStop(0.25, meta.color)
      g.addColorStop(1, meta.color)
      ctx.fillStyle = g
      ctx.fill()
      ctx.restore()
      ctx.fillStyle = 'rgba(10,12,26,0.92)'
      ctx.font = '700 11px "Segoe UI", system-ui, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(meta.letter, cap.x, cap.y + 0.5)
    }
    void time
  }

  /** The oscillate pickup, drawn as a magic mushroom: a spotted dome cap in the
   *  power colour over a cream stem. */
  #mushroom(cx: number, cy: number, color: string): void {
    const ctx = this.#ctx
    ctx.save()
    ctx.shadowColor = color; ctx.shadowBlur = 11
    // stem (cream) — drawn first so the cap overlaps its top
    ctx.fillStyle = '#fbe7c6'
    this.#roundRect(cx - 5, cy - 1, 10, 12, 3); ctx.fill()
    ctx.shadowBlur = 0
    ctx.fillStyle = 'rgba(150,120,80,0.3)'
    this.#roundRect(cx + 1.5, cy - 1, 3.5, 12, 2); ctx.fill()        // stem shading
    // cap dome in the power colour
    ctx.fillStyle = color
    ctx.beginPath(); ctx.ellipse(cx, cy, 13, 11, 0, Math.PI, 2 * Math.PI); ctx.closePath(); ctx.fill()
    ctx.fillStyle = 'rgba(0,0,0,0.18)'                               // darker rim under the cap
    this.#roundRect(cx - 12, cy - 2.5, 24, 3, 1.5); ctx.fill()
    // white spots
    ctx.fillStyle = '#fffaf0'
    for (const [sx, sy, sr] of [[-6, -6, 2.3], [4, -7, 1.9], [9, -3, 1.5], [-1, -3.5, 2.1]] as const) {
      ctx.beginPath(); ctx.arc(cx + sx, cy + sy, sr, 0, Math.PI * 2); ctx.fill()
    }
    ctx.restore()
  }

  #lasers(lasers: readonly Laser[]): void {
    const ctx = this.#ctx
    ctx.save()
    ctx.shadowColor = 'rgba(255,90,90,0.9)'
    ctx.shadowBlur = 8
    ctx.fillStyle = '#ff6b6b'
    for (const l of lasers) ctx.fillRect(l.x - 1.5, l.y, 3, 12)
    ctx.restore()
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
  #enemy(enemy: Enemy, target: { x: number; y: number } | null, time: number): void {
    const ctx = this.#ctx
    const { x, y, hp } = enemy
    const r = ENEMY_R
    const pulse = 0.5 + 0.5 * Math.sin(time * 3)
    const dmg = 1 - hp / 3                                   // 0 fresh → 1 nearly dead
    // look direction toward the ball (defaults to looking down)
    let lx = 0, ly = 0.5
    if (target) { const dx = target.x - x, dy = target.y - y, d = Math.hypot(dx, dy) || 1; lx = dx / d; ly = dy / d }
    ctx.save()

    // 1 ── aura (breathing, angrier as it's hurt)
    const aura = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 2.5)
    aura.addColorStop(0, `rgba(255,40,90,${0.22 + 0.16 * pulse + 0.18 * dmg})`)
    aura.addColorStop(1, 'rgba(255,40,90,0)')
    ctx.fillStyle = aura
    ctx.beginPath(); ctx.arc(x, y, r * 2.5, 0, Math.PI * 2); ctx.fill()

    // 2 ── antennae with glowing sensor tips (scanning, slight sway)
    ctx.lineCap = 'round'
    for (const s of [-1, 1]) {
      const base = -Math.PI / 2 + s * 0.5, sway = Math.sin(time * 2 + s) * 0.13
      const bx = x + Math.cos(base) * (r - 2), by = y + Math.sin(base) * (r - 2)
      const tx = x + Math.cos(base + sway) * (r + 11), ty = y + Math.sin(base + sway) * (r + 11)
      ctx.strokeStyle = '#7a0f25'; ctx.lineWidth = 1.6
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo((bx + tx) / 2 + s * 3, (by + ty) / 2, tx, ty); ctx.stroke()
      ctx.fillStyle = '#ffd24a'; ctx.shadowColor = '#ffae4a'; ctx.shadowBlur = 7
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
      ctx.fillStyle = '#8f1228'; ctx.fill()
      ctx.fillStyle = '#ff7a96'; ctx.beginPath(); ctx.arc(tipx, tipy, 1, 0, Math.PI * 2); ctx.fill()   // tip glint
    }

    // 4 ── rotating spiked carapace (top-lit metallic gradient)
    ctx.shadowColor = 'rgba(255,40,90,0.55)'; ctx.shadowBlur = 12
    const spikes = 11
    ctx.beginPath()
    for (let i = 0; i < spikes * 2; i++) {
      const ang = (i / (spikes * 2)) * Math.PI * 2 + time * 0.5
      const rr = i % 2 === 0 ? r + 4 : r - 0.5
      const px = x + Math.cos(ang) * rr, py = y + Math.sin(ang) * rr
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
    }
    ctx.closePath()
    const shell = ctx.createLinearGradient(x, y - r, x, y + r)
    shell.addColorStop(0, '#e23a5e'); shell.addColorStop(0.5, '#b81a3c'); shell.addColorStop(1, '#6e0f24')
    ctx.fillStyle = shell; ctx.fill()
    ctx.shadowBlur = 0

    // 5 ── HP armour plates across the top; lost ones go dark + spark
    for (let i = 0; i < 3; i++) {
      const a0 = -Math.PI / 2 - 0.72 + (i / 3) * 1.44
      const lost = i >= hp
      ctx.strokeStyle = lost ? 'rgba(40,6,14,0.9)' : '#ff8aa0'; ctx.lineWidth = lost ? 2.6 : 2
      ctx.beginPath(); ctx.arc(x, y, r - 1.5, a0, a0 + 0.42); ctx.stroke()
      if (lost) {
        const sa = a0 + 0.21, sx = x + Math.cos(sa) * (r - 1.5), sy = y + Math.sin(sa) * (r - 1.5)
        ctx.fillStyle = `rgba(255,220,120,${0.35 + 0.6 * pulse})`
        ctx.beginPath(); ctx.arc(sx, sy, 1.1 + pulse, 0, Math.PI * 2); ctx.fill()
      }
    }

    // 6 ── inner metallic bezel + rivets
    const bezel = ctx.createRadialGradient(x - 2, y - 3, 1, x, y, r - 1)
    bezel.addColorStop(0, '#5a0c1c'); bezel.addColorStop(1, '#2a0510')
    ctx.fillStyle = bezel
    ctx.beginPath(); ctx.arc(x, y, r - 2, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#7a1228'
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + time * 0.5
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * (r - 4), y + Math.sin(a) * (r - 4), 0.9, 0, Math.PI * 2); ctx.fill()
    }

    // 7 ── the eye: glowing socket, iris rings, tracking slit pupil, specular
    const er = r * 0.62
    const socket = ctx.createRadialGradient(x, y, 1, x, y, er)
    socket.addColorStop(0, '#ffcf3f'); socket.addColorStop(0.45, `rgb(255,${Math.round(91 - 50 * dmg)},46)`); socket.addColorStop(1, '#7a0f0f')
    ctx.fillStyle = socket; ctx.shadowColor = '#ff6a2a'; ctx.shadowBlur = 8
    ctx.beginPath(); ctx.arc(x, y, er, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0
    ctx.strokeStyle = 'rgba(120,20,10,0.5)'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.arc(x, y, er * 0.78, 0, Math.PI * 2); ctx.stroke()
    ctx.beginPath(); ctx.arc(x, y, er * 0.55, 0, Math.PI * 2); ctx.stroke()
    const pxe = x + lx * er * 0.32, pye = y + ly * er * 0.32
    ctx.fillStyle = '#160205'
    ctx.beginPath(); ctx.ellipse(pxe, pye, er * 0.22, er * 0.62, 0, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.beginPath(); ctx.arc(pxe - er * 0.17, pye - er * 0.28, er * 0.14, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }

  /** The alien SHIP — a glowing UFO saucer with a glass dome and underside
   *  lights. Shoot it (ball/laser/beam/rocket) and it drops a power-up. */
  #alien(a: Alien, time: number): void {
    const ctx = this.#ctx
    const x = a.x, y = a.y, hw = ALIEN_W / 2
    ctx.save()
    // underside tractor glow
    const glow = ctx.createRadialGradient(x, y + 4, 1, x, y + 4, hw)
    glow.addColorStop(0, 'rgba(110,240,122,0.4)'); glow.addColorStop(1, 'rgba(110,240,122,0)')
    ctx.fillStyle = glow
    ctx.beginPath(); ctx.ellipse(x, y + 5, hw, ALIEN_H * 0.5, 0, 0, Math.PI * 2); ctx.fill()
    // saucer hull (metallic ellipse, top-lit)
    ctx.shadowColor = 'rgba(57,217,87,0.5)'; ctx.shadowBlur = 10
    const hull = ctx.createLinearGradient(x, y - 4, x, y + 5)
    hull.addColorStop(0, '#cfe8d6'); hull.addColorStop(0.5, '#7fb98f'); hull.addColorStop(1, '#2f6b40')
    ctx.fillStyle = hull
    ctx.beginPath(); ctx.ellipse(x, y + 2, hw, ALIEN_H * 0.34, 0, 0, Math.PI * 2); ctx.fill()
    ctx.shadowBlur = 0
    // glass dome
    const dome = ctx.createRadialGradient(x - 2, y - 4, 1, x, y - 1, hw * 0.5)
    dome.addColorStop(0, '#eafff4'); dome.addColorStop(0.6, '#5fd0e0'); dome.addColorStop(1, '#2a7a9a')
    ctx.fillStyle = dome
    ctx.beginPath(); ctx.ellipse(x, y - 1, hw * 0.5, ALIEN_H * 0.42, 0, Math.PI, 2 * Math.PI); ctx.fill()
    ctx.fillStyle = 'rgba(20,40,30,0.5)'                  // dome base seam
    ctx.fillRect(x - hw * 0.5, y - 1, hw, 1.5)
    // blinking underside lights
    for (let i = 0; i < 5; i++) {
      const lx = x - hw * 0.7 + (i / 4) * hw * 1.4
      const on = 0.5 + 0.5 * Math.sin(time * 7 + i * 1.3)
      ctx.fillStyle = `rgba(255,210,74,${0.4 + 0.6 * on})`
      ctx.beginPath(); ctx.arc(lx, y + ALIEN_H * 0.32, 1.4, 0, Math.PI * 2); ctx.fill()
    }
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
  #comboPops(pops: readonly ComboPop[]): void {
    if (!pops.length) return
    const ctx = this.#ctx
    for (const p of pops) {
      const k = Math.min(1, p.t / 0.9)
      const big = p.n >= 6
      ctx.save()
      ctx.globalAlpha = Math.max(0, 1 - k)
      ctx.font = `800 ${13 + Math.min(11, p.n)}px "Segoe UI", system-ui, sans-serif`
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillStyle = big ? '#ffd24a' : '#ffffff'
      ctx.shadowColor = big ? '#ff7043' : 'rgba(126,224,255,0.85)'; ctx.shadowBlur = 8
      ctx.fillText(`×${p.n}`, p.x, p.y - k * 30)
      ctx.restore()
    }
  }

  #explosions(explosions: readonly Explosion[]): void {
    if (!explosions.length) return
    const ctx = this.#ctx
    for (const e of explosions) {
      const p = Math.min(1, e.t / EXPLOSION_DUR)        // 0 → 1 over the blast life
      const r = 8 + p * ROCKET_RADIUS
      ctx.save()
      ctx.shadowColor = '#ff7043'; ctx.shadowBlur = 14
      ctx.globalAlpha = (1 - p) * 0.5
      ctx.fillStyle = '#ff7043'
      ctx.beginPath(); ctx.arc(e.x, e.y, r * 0.6, 0, Math.PI * 2); ctx.fill()
      ctx.globalAlpha = 1 - p
      ctx.strokeStyle = '#ffcf5e'; ctx.lineWidth = 3 + (1 - p) * 4
      ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, Math.PI * 2); ctx.stroke()
      ctx.restore()
    }
  }

  #hud(engine: Engine): void {
    const ctx = this.#ctx
    ctx.save()
    ctx.fillStyle = 'rgba(223,231,255,0.9)'
    ctx.font = '600 18px "Segoe UI", system-ui, sans-serif'
    ctx.textBaseline = 'top'
    ctx.textAlign = 'left'
    ctx.fillText(`✦ ${engine.score}`, 8, 8)
    // Combo meter under the score — grows + warms as the chain builds.
    if (engine.combo >= 2) {
      const cn = engine.combo
      const hot = Math.min(1, (cn - 2) / 8)
      ctx.font = `800 ${14 + Math.min(8, cn)}px "Segoe UI", system-ui, sans-serif`
      ctx.fillStyle = hot > 0.5 ? '#ffd24a' : '#7ee0ff'
      ctx.shadowColor = hot > 0.5 ? 'rgba(255,112,67,0.8)' : 'rgba(126,224,255,0.7)'; ctx.shadowBlur = 8
      ctx.fillText(`combo ×${cn}`, 8, 30)
      ctx.shadowBlur = 0
    }
    // Lives as small balls, top-right.
    for (let i = 0; i < engine.lives; i++) {
      ctx.beginPath()
      ctx.arc(W - 12 - i * 16, 16, 5, 0, Math.PI * 2)
      ctx.fillStyle = '#ffffff'
      ctx.fill()
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
        // The multiplier badge shows its live value (2× / 3×) instead of 'X'.
        const glyph = pw.kind === 'multiplier' ? `${engine.scoreMul}×` : meta.letter
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
}
