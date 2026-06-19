// diamondcoreprocessor.com/games/roper/renderer.ts
//
// Draws the RoperEngine's world onto a 2D context the overlay has already
// transformed into world units. Pure draw — the only retained state is a cached
// terrain bitmap (rebuilt per arena; craters are punched into it incrementally).
//
// The frame is composed of self-contained per-layer draw functions: atmosphere
// (parallax cavern sky) → terrain bitmap → water → worms → rope → projectiles →
// particles → explosions → aim reticle → HUD. Each layer is an independent
// top-level function so it can be tuned in isolation. (Layers authored as a
// fan-out and assembled here.)

import {
  type RoperEngine, type Worm, type Projectile, type Particle, type Blast,
  WEAPON_META, WORM_RADIUS,
} from './engine.js'

const TEAM_COLORS = ['#4ea8ff', '#ff5b6e'] as const
const TEAM_NAMES = ['BLUE', 'RED'] as const

// Shared rounded-rect path helper used by the aim/power overlay.
function rdr_roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

// ───────────────── ATMOSPHERE helpers ─────────────────
// ── ATMOSPHERE helpers (atmo_-prefixed, stateless & deterministic) ──

// Cheap stable hash → [0,1). Deterministic per integer seed; no Math.random.
function atmo_hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

// Build a stable parallax mountain ridge path as world coords.
// seed varies the silhouette; baseY is the ridge baseline; amp the height.
function atmo_ridge(
  ctx: CanvasRenderingContext2D, W: number, H: number,
  seed: number, baseY: number, amp: number, drift: number,
): void {
  const step = Math.max(46, W / 16)
  ctx.beginPath()
  ctx.moveTo(-40, H)
  ctx.lineTo(-40, baseY)
  let first = true
  for (let x = -40; x <= W + 40; x += step) {
    // layered pseudo-noise from hashed control points + slow drift
    const c = (x + drift) / step
    const i = Math.floor(c)
    const f = c - i
    const e = f * f * (3 - 2 * f) // smoothstep interpolation
    const a = atmo_hash(i * 311 + seed)
    const b = atmo_hash((i + 1) * 311 + seed)
    const n = a + (b - a) * e
    const a2 = atmo_hash(i * 977 + seed * 7)
    const b2 = atmo_hash((i + 1) * 977 + seed * 7)
    const n2 = a2 + (b2 - a2) * e
    const y = baseY - (n * 0.72 + n2 * 0.28 - 0.3) * amp
    if (first) { ctx.lineTo(x, y); first = false } else ctx.lineTo(x, y)
  }
  ctx.lineTo(W + 40, H)
  ctx.closePath()
}

// ───────────────── TERRAIN helpers ─────────────────
// ── terrain layer helpers (prefix: terr_) ───────────────────────────────
// Deterministic integer hash → [0,1). Stable per (x,y), no Math.random.
function terr_hash(x: number, y: number): number {
  let h = (Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x45d9f3b) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
// Smooth value noise from the hash (bilinear over an integer lattice).
function terr_vnoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y)
  const fx = x - xi, fy = y - yi
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy)
  const a = terr_hash(xi, yi), b = terr_hash(xi + 1, yi)
  const c = terr_hash(xi, yi + 1), d = terr_hash(xi + 1, yi + 1)
  const top = a + (b - a) * sx, bot = c + (d - c) * sx
  return top + (bot - top) * sy
}
function terr_clamp8(v: number): number { return v < 0 ? 0 : v > 255 ? 255 : v | 0 }
// Linear blend between two rgb triples.
function terr_mix(
  ar: number, ag: number, ab: number, br: number, bg: number, bb: number, t: number
): [number, number, number] {
  return [ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]
}

// ───────────────── WORM helpers ─────────────────
// ── worm character helpers ───────────────────────────────────────
const worm_TEAM = ['#4ea8ff', '#ff5b6e'] as const

// Lighten/darken a #rrggbb hex toward white/black by t in [-1,1].
function worm_shade(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16)
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  if (t >= 0) { r += (255 - r) * t; g += (255 - g) * t; b += (255 - b) * t }
  else { const k = 1 + t; r *= k; g *= k; b *= k }
  return `rgb(${r | 0},${g | 0},${b | 0})`
}

// Deterministic 0..1 hash from an integer seed (no Math.random in frame path).
function worm_hash(i: number): number {
  const x = Math.sin(i * 12.9898 + 4.1) * 43758.5453
  return x - Math.floor(x)
}

// hp fraction → bar color (green → yellow → red).
function worm_hpColor(f: number): string {
  if (f > 0.6) return '#6ad15f'
  if (f > 0.3) return '#ffd24a'
  return '#ff5b6e'
}

// Rounded-rect path helper.
function worm_roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

// ───────────────── ROPE helpers ─────────────────
// --- NINJA ROPE + HOOK helpers (prefix: rope_) ---

// Build the rope centreline as an array of points. When attached and slack,
// we apply a catenary-style sag; when taut we keep it nearly straight with a
// tiny tension shimmer. While extending/retracting it's a straight live line.
function rope_path(
  ox: number, oy: number, tx: number, ty: number,
  attached: boolean, length: number, time: number,
): { pts: { x: number; y: number }[]; taut: number; nx: number; ny: number } {
  const dx = tx - ox, dy = ty - oy
  const dist = Math.hypot(dx, dy) || 0.0001
  // unit along & perpendicular (perp points "down-ish" for sag)
  const ux = dx / dist, uy = dy / dist
  let nx = -uy, ny = ux
  if (ny < 0) { nx = -nx; ny = -ny } // bias perpendicular downward so sag droops

  // tautness: 1 = fully taut (worm at full rope length), 0 = lots of slack.
  let taut = 1
  if (attached) {
    const slack = Math.max(0, length - dist)
    taut = Math.max(0, Math.min(1, 1 - slack / Math.max(40, length * 0.5)))
  }

  const segs = 18
  const pts: { x: number; y: number }[] = []
  // sag magnitude: big when slack, near-zero when taut. plus tension shimmer.
  const sagBase = attached ? (1 - taut) * Math.min(46, dist * 0.18) : 0
  const shimmer = attached
    ? Math.sin(time * 9) * (0.6 + taut * 1.4) // taut rope hums a little
    : 0

  for (let i = 0; i <= segs; i++) {
    const f = i / segs
    // parabolic sag profile (0 at ends, max in middle)
    const sag = sagBase * Math.sin(f * Math.PI)
    const hum = shimmer * Math.sin(f * Math.PI)
    const px = ox + dx * f + nx * (sag + hum)
    const py = oy + dy * f + ny * (sag + hum)
    pts.push({ x: px, y: py })
  }
  return { pts, taut, nx, ny }
}

function rope_strokePolyline(
  ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[],
): void {
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
  ctx.stroke()
}

// Draw the twined rope: soft shadow, dark core, lit body, side highlight, and
// faint twist ticks so it reads as braided cord rather than a flat line.
function rope_drawCord(
  ctx: CanvasRenderingContext2D,
  pts: { x: number; y: number }[],
  nx: number, ny: number, taut: number, attached: boolean, time: number,
): void {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  const offX = ny * 1.1, offY = -nx * 1.1 // highlight/shadow offset across width

  if (attached) {
    // soft drop shadow (offset down-right)
    ctx.save()
    ctx.translate(0.9, 1.2)
    ctx.strokeStyle = 'rgba(0,0,0,0.32)'
    ctx.lineWidth = 2.0
    rope_strokePolyline(ctx, pts)
    ctx.restore()

    // dark underside core
    ctx.strokeStyle = '#7a5a38'
    ctx.lineWidth = 1.9
    rope_strokePolyline(ctx, pts)

    // lit body
    ctx.strokeStyle = '#b8966a'
    ctx.lineWidth = 1.5
    rope_strokePolyline(ctx, pts)

    // bright side highlight, nudged to one side
    ctx.save()
    ctx.translate(offX * 0.45, offY * 0.45)
    ctx.strokeStyle = 'rgba(230,207,163,0.85)'
    ctx.lineWidth = 0.7
    rope_strokePolyline(ctx, pts)
    ctx.restore()

    // braid twist ticks (short cross-hatches along the cord)
    ctx.strokeStyle = 'rgba(90,66,40,0.55)'
    ctx.lineWidth = 0.7
    const twist = time * 6
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i]
      // local tangent
      const a = pts[i - 1], b = pts[i + 1]
      const tx = b.x - a.x, tyv = b.y - a.y
      const tl = Math.hypot(tx, tyv) || 1
      const pnx = -tyv / tl, pny = tx / tl
      const w = 1.6 + Math.sin(i * 0.9 + twist) * 0.4
      ctx.beginPath()
      ctx.moveTo(p.x - pnx * w, p.y - pny * w)
      ctx.lineTo(p.x + pnx * w, p.y + pny * w)
      ctx.stroke()
    }

    // taut tension glow: faint blue sheen down the rope when near full length
    if (taut > 0.55) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = (taut - 0.55) / 0.45 * (0.18 + 0.1 * (0.5 + 0.5 * Math.sin(time * 12)))
      ctx.strokeStyle = '#4ea8ff'
      ctx.lineWidth = 0.6
      rope_strokePolyline(ctx, pts)
      ctx.restore()
    }
  } else {
    // flying / retracting: thinner, lighter live line with a faint shadow
    ctx.save()
    ctx.translate(0.6, 0.8)
    ctx.strokeStyle = 'rgba(0,0,0,0.22)'
    ctx.lineWidth = 1.4
    rope_strokePolyline(ctx, pts)
    ctx.restore()

    ctx.strokeStyle = 'rgba(200,180,150,0.9)'
    ctx.lineWidth = 1.2
    rope_strokePolyline(ctx, pts)

    // little motion dashes streaming along the line
    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'
    ctx.lineWidth = 0.7
    ctx.setLineDash([3, 8])
    ctx.lineDashOffset = -(time * 60) % 11
    rope_strokePolyline(ctx, pts)
    ctx.setLineDash([])
    ctx.restore()
  }
  ctx.restore()
}

// Steel grappling claw at the tip when attached: shaded shank + two gripping
// prongs hugging the surface, oriented along the incoming rope direction.
function rope_drawClaw(
  ctx: CanvasRenderingContext2D, tx: number, ty: number,
  ang: number, time: number,
): void {
  ctx.save()
  ctx.translate(tx, ty)
  ctx.rotate(ang)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // soft contact shadow under the claw
  ctx.save()
  ctx.globalAlpha = 0.3
  ctx.fillStyle = '#000'
  ctx.beginPath()
  ctx.ellipse(2, 2, 7, 4, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // shank (short shaded steel bar back along the rope)
  const shank = ctx.createLinearGradient(-6, -2, -6, 3)
  shank.addColorStop(0, '#d6dbe2')
  shank.addColorStop(0.5, '#9aa0a8')
  shank.addColorStop(1, '#4a4e56')
  ctx.strokeStyle = shank
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(-9, 0)
  ctx.lineTo(-1, 0)
  ctx.stroke()

  // central knuckle
  const knob = ctx.createRadialGradient(-1.2, -1.2, 0.4, 0, 0, 4)
  knob.addColorStop(0, '#eef1f5')
  knob.addColorStop(0.6, '#aeb4bc')
  knob.addColorStop(1, '#5a5f67')
  ctx.fillStyle = knob
  ctx.beginPath()
  ctx.arc(0, 0, 3.2, 0, Math.PI * 2)
  ctx.fill()

  // two prongs curving forward to grip
  ctx.strokeStyle = '#3a3e46'
  ctx.lineWidth = 3.2
  for (const s of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.quadraticCurveTo(4.5, s * 4.5, 8.5, s * 5.5)
    ctx.stroke()
  }
  // prong highlight pass
  ctx.strokeStyle = '#c8ced6'
  ctx.lineWidth = 1.4
  for (const s of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.quadraticCurveTo(4.5, s * 4.4, 8.3, s * 5.3)
    ctx.stroke()
  }

  // glint that drifts slowly along the metal
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const g = 0.4 + 0.35 * (0.5 + 0.5 * Math.sin(time * 3))
  ctx.globalAlpha = g
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(-1.4, -1.4, 1.1, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  ctx.restore()
}

// Aerodynamic dart head while the hook is in flight / retracting.
function rope_drawDart(
  ctx: CanvasRenderingContext2D, tx: number, ty: number, ang: number,
): void {
  ctx.save()
  ctx.translate(tx, ty)
  ctx.rotate(ang)
  ctx.lineJoin = 'round'

  const body = ctx.createLinearGradient(-7, -3, -7, 3)
  body.addColorStop(0, '#e2e6ec')
  body.addColorStop(0.5, '#aab0b8')
  body.addColorStop(1, '#5c606a')
  ctx.fillStyle = body
  ctx.strokeStyle = '#3a3e46'
  ctx.lineWidth = 0.8
  ctx.beginPath()
  ctx.moveTo(7, 0)        // nose
  ctx.lineTo(-4, -4)
  ctx.lineTo(-2, 0)
  ctx.lineTo(-4, 4)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  // tip glint
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = 0.7
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(4, -0.8, 0.9, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  ctx.restore()
}

// ───────────────── PROJECTILE helpers ─────────────────
// ── PROJECTILES layer helpers ───────────────────────────────
const proj_TAU = Math.PI * 2

// stable hash → [0,1) from an integer-ish seed
function proj_rand(seed: number): number {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

// velocity-derived motion trail: tapered fading ghosts opposite to travel
function proj_trail(ctx: CanvasRenderingContext2D, p: { x:number; y:number; vx:number; vy:number; r:number }, accent: string): void {
  const sp = Math.hypot(p.vx, p.vy)
  if (sp < 18) return
  const ux = p.vx / sp, uy = p.vy / sp
  // streak length scales with speed, clamped
  const len = Math.min(34, p.r * 1.4 + sp * 0.045)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  // soft warm streak
  const g = ctx.createLinearGradient(p.x, p.y, p.x - ux * len, p.y - uy * len)
  g.addColorStop(0, 'rgba(255,236,190,0.32)')
  g.addColorStop(0.45, 'rgba(255,150,70,0.16)')
  g.addColorStop(1, 'rgba(255,120,60,0)')
  ctx.strokeStyle = g
  ctx.lineCap = 'round'
  ctx.lineWidth = p.r * 1.5
  ctx.beginPath()
  ctx.moveTo(p.x, p.y)
  ctx.lineTo(p.x - ux * len, p.y - uy * len)
  ctx.stroke()
  // a few fading ghost dabs
  const n = 3
  for (let i = 1; i <= n; i++) {
    const f = i / (n + 1)
    const gx = p.x - ux * len * f
    const gy = p.y - uy * len * f
    ctx.globalAlpha = (1 - f) * 0.22
    ctx.fillStyle = accent
    ctx.beginPath()
    ctx.arc(gx, gy, p.r * (1 - f * 0.55), 0, proj_TAU)
    ctx.fill()
  }
  ctx.restore()
}

// tiny spark flecks crackling from a point; phase ties to time + jitter scale
function proj_sparks(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, seed: number, intensity: number, count: number): void {
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (let i = 0; i < count; i++) {
    const base = proj_rand(seed + i * 7.13)
    // each fleck has its own fast cycle, faster with intensity
    const cyc = (time * (5 + intensity * 9) + base * proj_TAU)
    const phase = (Math.sin(cyc) + 1) / 2          // 0..1 along its arc
    const ang = base * proj_TAU - Math.PI / 2 + (proj_rand(seed + i * 3.1) - 0.5) * 1.6
    const dist = (2 + phase * (3 + intensity * 5))
    const fx = x + Math.cos(ang) * dist
    const fy = y + Math.sin(ang) * dist - phase * 1.5
    const a = (1 - phase) * (0.5 + intensity * 0.5)
    if (a <= 0.02) continue
    ctx.globalAlpha = a
    ctx.fillStyle = phase < 0.5 ? '#fff6d8' : '#ff9a3c'
    const sz = 0.7 + (1 - phase) * (0.9 + intensity)
    ctx.beginPath()
    ctx.arc(fx, fy, sz, 0, proj_TAU)
    ctx.fill()
  }
  ctx.restore()
}

// glowing spark core at a fuse tip
function proj_fuseCore(ctx: CanvasRenderingContext2D, x: number, y: number, rad: number, intensity: number): void {
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const g = ctx.createRadialGradient(x, y, 0, x, y, rad * 3.2)
  g.addColorStop(0, `rgba(255,250,225,${0.95})`)
  g.addColorStop(0.35, `rgba(255,190,90,${0.7})`)
  g.addColorStop(1, 'rgba(255,120,40,0)')
  ctx.fillStyle = g
  ctx.beginPath(); ctx.arc(x, y, rad * 3.2, 0, proj_TAU); ctx.fill()
  ctx.fillStyle = '#fffdf2'
  ctx.beginPath(); ctx.arc(x, y, rad * (0.7 + intensity * 0.4), 0, proj_TAU); ctx.fill()
  ctx.restore()
}

// ───────────────── FX helpers ─────────────────
// Deterministic 0..1 hash from two stable coordinates (no Math.random in per-frame path).
function fx_blast_hash(a: number, b: number): number {
  let h = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453
  h = h - Math.floor(h)
  return h
}

// ───────────────── HUD helpers ─────────────────
// ── HUD helpers (uniquely prefixed hud_) ──────────────────────────────
const HUD_FONT = '"Segoe UI", system-ui, sans-serif'
const HUD_TEAM_COLORS = ['#4ea8ff', '#ff5b6e'] as const
const HUD_TEAM_NAMES = ['BLUE', 'RED'] as const

function hud_font(size: number, weight = 700): string {
  return `${weight} ${size}px ${HUD_FONT}`
}

/** Rounded-rect path (no fill/stroke). Clamps radius to half the smaller side. */
function hud_roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.lineTo(x + w - rr, y)
  ctx.arcTo(x + w, y, x + w, y + rr, rr)
  ctx.lineTo(x + w, y + h - rr)
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr)
  ctx.lineTo(x + rr, y + h)
  ctx.arcTo(x, y + h, x, y + h - rr, rr)
  ctx.lineTo(x, y + rr)
  ctx.arcTo(x, y, x + rr, y, rr)
  ctx.closePath()
}

function hud_withAlpha(hex: string, a: number): string {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return `rgba(${r},${g},${b},${a})`
}

/** Frosted dark panel with a team-colored accent edge on one side. */
function hud_panel(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  accent: string, accentSide: 'left' | 'right',
): void {
  ctx.save()
  // soft drop shadow under the panel
  ctx.shadowColor = 'rgba(0,0,0,0.45)'
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 4
  const bg = ctx.createLinearGradient(0, y, 0, y + h)
  bg.addColorStop(0, 'rgba(20,30,48,0.72)')
  bg.addColorStop(1, 'rgba(8,14,26,0.66)')
  ctx.fillStyle = bg
  hud_roundRect(ctx, x, y, w, h, 9)
  ctx.fill()
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0
  // hairline border
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(255,255,255,0.10)'
  hud_roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 9)
  ctx.stroke()
  // accent edge with glow, clipped to the panel
  ctx.save()
  hud_roundRect(ctx, x, y, w, h, 9)
  ctx.clip()
  ctx.shadowColor = accent
  ctx.shadowBlur = 0
  ctx.fillStyle = accent
  const aw = 3.5
  if (accentSide === 'left') ctx.fillRect(x, y, aw, h)
  else ctx.fillRect(x + w - aw, y, aw, h)
  ctx.restore()
  ctx.restore()
}

/** Tinted health bar with subtle inner gloss. value/max in [0..1] derived by caller. */
function hud_bar(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  frac: number, tint: string,
): void {
  const f = Math.max(0, Math.min(1, frac))
  ctx.save()
  // track
  hud_roundRect(ctx, x, y, w, h, h / 2)
  ctx.fillStyle = 'rgba(0,0,0,0.40)'
  ctx.fill()
  // fill
  if (f > 0.001) {
    hud_roundRect(ctx, x, y, Math.max(h, w * f), h, h / 2)
    ctx.clip()
    const g = ctx.createLinearGradient(0, y, 0, y + h)
    g.addColorStop(0, hud_withAlpha(tint, 1))
    g.addColorStop(1, hud_withAlpha(tint, 0.55))
    ctx.fillStyle = g
    ctx.fillRect(x, y, w, h)
    // top gloss
    ctx.fillStyle = 'rgba(255,255,255,0.22)'
    ctx.fillRect(x, y, w, h * 0.42)
  }
  ctx.restore()
  // outline
  hud_roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, h / 2)
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'
  ctx.stroke()
}

/** One team panel (corner). mirror=true draws right-aligned/mirrored content. */
function hud_teamPanel(
  ctx: CanvasRenderingContext2D,
  engine: RoperEngine,
  team: number,
  mirror: boolean,
): void {
  const W = engine.width
  const tint = HUD_TEAM_COLORS[team] ?? '#ccc'
  const living = engine.worms.filter(w => w.team === team && w.alive)
  const aliveCount = living.length
  const hp = Math.max(0, Math.round(engine.teamHp(team)))
  const maxHp = Math.max(1, aliveCount * 100)
  const frac = Math.min(1, hp / maxHp)

  const pad = 11
  const pw = 208, ph = 60
  const px = mirror ? W - 11 - pw : 11
  const py = 11

  hud_panel(ctx, px, py, pw, ph, tint, mirror ? 'right' : 'left')

  const innerL = px + pad
  const innerR = px + pw - pad
  ctx.textBaseline = 'alphabetic'

  // team name
  ctx.font = hud_font(15, 800)
  ctx.fillStyle = tint
  ctx.textAlign = mirror ? 'right' : 'left'
  ctx.shadowColor = hud_withAlpha(tint, 0.55)
  ctx.shadowBlur = 0
  ctx.fillText(HUD_TEAM_NAMES[team] ?? '—', mirror ? innerR : innerL, py + 21)
  ctx.shadowBlur = 0

  // hp number
  ctx.font = hud_font(13, 700)
  ctx.fillStyle = 'rgba(235,243,255,0.92)'
  ctx.textAlign = mirror ? 'left' : 'right'
  ctx.fillText(`${hp}`, mirror ? innerL : innerR, py + 21)

  // health bar
  const barY = py + 28
  const barH = 8
  const barX = innerL
  const barW = pw - pad * 2
  hud_bar(ctx, barX, barY, barW, barH, frac, tint)

  // worm pips — one per living worm
  const pipR = 3.4
  const pipGap = 11
  const pipY = py + ph - 11
  for (let i = 0; i < aliveCount; i++) {
    const idx = mirror ? (aliveCount - 1 - i) : i
    const cx = mirror ? (innerR - pipR - idx * pipGap) : (innerL + pipR + i * pipGap)
    ctx.beginPath()
    ctx.arc(cx, pipY, pipR, 0, Math.PI * 2)
    ctx.fillStyle = tint
    ctx.shadowColor = hud_withAlpha(tint, 0.7)
    ctx.shadowBlur = 0
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.lineWidth = 1
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'
    ctx.stroke()
  }
}

/** Top-center turn indicator with depleting circular timer ring. */
function hud_turn(
  ctx: CanvasRenderingContext2D,
  engine: RoperEngine,
): void {
  const active = engine.active
  if (!active) return
  const W = engine.width
  const cx = W / 2
  const tint = HUD_TEAM_COLORS[active.team] ?? '#fff'
  const retreating = engine.state === 'fired'
  const secs = retreating ? engine.retreatTime : engine.turnTime
  const total = retreating ? Math.max(0.001, engine.retreatTime, 5) : Math.max(0.001, engine.turnTime, 30)
  const remain = Math.max(0, Math.ceil(secs))
  const urgent = secs < 6

  const ringR = 25
  const ringY = 40

  // label above the ring
  const label = retreating ? 'RETREAT' : `${HUD_TEAM_NAMES[active.team]} — YOUR TURN`
  ctx.font = hud_font(12, 800)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = retreating ? '#ffd23a' : tint
  ctx.shadowColor = retreating ? 'rgba(255,210,58,0.5)' : hud_withAlpha(tint, 0.5)
  ctx.shadowBlur = 0
  // letter-spaced label
  const lw = ctx.measureText(label).width
  ctx.fillText(label, cx, ringY - ringR - 6)
  ctx.shadowBlur = 0
  void lw

  // ring track
  ctx.lineWidth = 4
  ctx.strokeStyle = 'rgba(255,255,255,0.14)'
  ctx.beginPath()
  ctx.arc(cx, ringY, ringR, 0, Math.PI * 2)
  ctx.stroke()

  // depleting arc (clockwise from top)
  const frac = Math.max(0, Math.min(1, secs / total))
  if (frac > 0.001) {
    const start = -Math.PI / 2
    const end = start + frac * Math.PI * 2
    ctx.lineWidth = 4
    ctx.lineCap = 'round'
    ctx.strokeStyle = urgent ? '#ff5b5b' : tint
    ctx.shadowColor = urgent ? 'rgba(255,91,91,0.7)' : hud_withAlpha(tint, 0.6)
    ctx.shadowBlur = 0
    ctx.beginPath()
    ctx.arc(cx, ringY, ringR, start, end)
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.lineCap = 'butt'
  }

  // countdown number centered in ring
  ctx.font = hud_font(urgent ? 24 : 22, 800)
  ctx.textBaseline = 'middle'
  ctx.fillStyle = urgent ? '#ff6b6b' : '#fff'
  if (urgent) { ctx.shadowColor = 'rgba(255,91,91,0.6)'; ctx.shadowBlur = 0 }
  ctx.fillText(String(remain), cx, ringY + 1)
  ctx.shadowBlur = 0
}

/** Wind gauge: horizontal track, centre tick, directional arrow ∝ strength. */
function hud_wind(
  ctx: CanvasRenderingContext2D,
  engine: RoperEngine,
): void {
  const W = engine.width
  const cx = W / 2
  const cy = 84
  const trackW = 132
  const h = 7
  const max = 220
  const frac = Math.max(-1, Math.min(1, engine.wind / max))
  const half = trackW / 2

  // track panel
  hud_roundRect(ctx, cx - half - 6, cy - 4, trackW + 12, h + 8, 7)
  ctx.fillStyle = 'rgba(10,18,32,0.55)'
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(255,255,255,0.10)'
  ctx.stroke()

  // baseline track
  hud_roundRect(ctx, cx - half, cy, trackW, h, h / 2)
  ctx.fillStyle = 'rgba(255,255,255,0.10)'
  ctx.fill()

  // centre tick
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.fillRect(cx - 0.75, cy - 3, 1.5, h + 6)

  // directional fill bar
  if (Math.abs(frac) > 0.01) {
    const len = half * Math.abs(frac)
    const dir = frac > 0 ? 1 : -1
    const wcol = dir > 0 ? '#9fd6ff' : '#ffd6a0'
    const bx = dir > 0 ? cx : cx - len
    hud_roundRect(ctx, bx, cy, len, h, h / 2)
    ctx.fillStyle = hud_withAlpha(wcol, 0.85)
    ctx.shadowColor = hud_withAlpha(wcol, 0.5)
    ctx.shadowBlur = 0
    ctx.fill()
    ctx.shadowBlur = 0
    // arrow head at the leading edge
    const tipX = dir > 0 ? cx + len : cx - len
    const ay = cy + h / 2
    ctx.beginPath()
    ctx.moveTo(tipX + dir * 6, ay)
    ctx.lineTo(tipX, ay - 5)
    ctx.lineTo(tipX, ay + 5)
    ctx.closePath()
    ctx.fillStyle = wcol
    ctx.fill()
  }

  // label
  ctx.font = hud_font(9, 800)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillStyle = 'rgba(210,228,250,0.8)'
  ctx.fillText('WIND', cx, cy - 5)
}

/** Bottom-center weapon chip with colored icon dot. */
function hud_weaponChip(
  ctx: CanvasRenderingContext2D,
  engine: RoperEngine,
): void {
  const meta = WEAPON_META[engine.weapon]
  if (!meta) return
  const W = engine.width, H = engine.height
  const cx = W / 2

  ctx.font = hud_font(14, 800)
  const tw = ctx.measureText(meta.name).width
  const dotR = 5
  const padX = 14
  const gap = 9
  const chipW = padX + dotR * 2 + gap + tw + padX
  const chipH = 30
  const cyTop = H - 14 - chipH
  const cxLeft = cx - chipW / 2

  // chip body
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.4)'
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 3
  hud_roundRect(ctx, cxLeft, cyTop, chipW, chipH, chipH / 2)
  const bg = ctx.createLinearGradient(0, cyTop, 0, cyTop + chipH)
  bg.addColorStop(0, 'rgba(22,32,50,0.78)')
  bg.addColorStop(1, 'rgba(10,16,28,0.74)')
  ctx.fillStyle = bg
  ctx.fill()
  ctx.restore()
  ctx.lineWidth = 1
  ctx.strokeStyle = hud_withAlpha(meta.color, 0.5)
  hud_roundRect(ctx, cxLeft + 0.5, cyTop + 0.5, chipW - 1, chipH - 1, chipH / 2)
  ctx.stroke()

  // icon dot
  const dotX = cxLeft + padX + dotR
  const dotY = cyTop + chipH / 2
  ctx.beginPath()
  ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2)
  ctx.fillStyle = meta.color
  ctx.shadowColor = hud_withAlpha(meta.color, 0.7)
  ctx.shadowBlur = 0
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.stroke()

  // name
  ctx.font = hud_font(14, 800)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#f3f7ff'
  ctx.fillText(meta.name, dotX + dotR + gap, dotY + 0.5)
}

// ───────────────── WATER helpers ─────────────────
// --- WATER layer helpers (prefix water_) ---
// Deterministic hash -> [0,1) from an integer seed (no Math.random in per-frame path)
function water_hash(n: number): number {
  let x = (n ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 4294967296;
}

// Height of a layered sine wave at world-x for a given surface line.
function water_waveY(x: number, surfaceY: number, time: number,
                     amp: number, len: number, speed: number, phase: number): number {
  return surfaceY + Math.sin(x / len + time * speed + phase) * amp;
}

// Trace a wave crest as a path along the full width; leaves the path open at the top
// so the caller can close it down to the base and fill a band.
function water_traceWave(ctx: CanvasRenderingContext2D, w: number, surfaceY: number,
                         time: number, amp: number, len: number, speed: number,
                         phase: number, step: number): void {
  ctx.moveTo(0, water_waveY(0, surfaceY, time, amp, len, speed, phase));
  for (let x = step; x <= w; x += step) {
    ctx.lineTo(x, water_waveY(x, surfaceY, time, amp, len, speed, phase));
  }
  ctx.lineTo(w, water_waveY(w, surfaceY, time, amp, len, speed, phase));
}

// ───────────────── ATMOSPHERE ─────────────────
function drawAtmosphere(ctx: CanvasRenderingContext2D, engine: RoperEngine, time: number): void {
  const W = engine.width, H = engine.height

  ctx.save()

  // ── 1. Deep vertical sky gradient: indigo/teal up top → warm haze at horizon ──
  const horizon = H * 0.78
  const sky = ctx.createLinearGradient(0, 0, 0, horizon)
  sky.addColorStop(0.0, '#070d22')
  sky.addColorStop(0.28, '#0d1a38')
  sky.addColorStop(0.55, '#173050')
  sky.addColorStop(0.78, '#2f4a6c')
  sky.addColorStop(0.92, '#5b6580')
  sky.addColorStop(1.0, '#7d7682')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, W, horizon + 2)
  // warm haze beneath the horizon line so distant land sits in glow
  const haze = ctx.createLinearGradient(0, horizon - 40, 0, H)
  haze.addColorStop(0, 'rgba(150,130,128,0)')
  haze.addColorStop(0.5, 'rgba(168,142,128,0.30)')
  haze.addColorStop(1, 'rgba(120,108,118,0.10)')
  ctx.fillStyle = haze
  ctx.fillRect(0, horizon - 40, W, H - (horizon - 40))

  // ── 2. Star / dust field — sparse, slow drift, deterministic per index ──
  const starBand = horizon * 0.7
  const starCount = 70
  for (let i = 0; i < starCount; i++) {
    const sx = ((atmo_hash(i * 2 + 1) * W) + time * (4 + atmo_hash(i * 5) * 8)) % (W + 40) - 20
    const sy = atmo_hash(i * 3 + 7) * starBand
    const fade = 0.18 + 0.55 * (1 - sy / starBand) // dimmer toward horizon
    const tw = 0.55 + 0.45 * Math.sin(time * (0.8 + atmo_hash(i) * 1.6) + i * 1.7)
    const a = fade * (0.35 + 0.65 * tw)
    const rad = 0.5 + atmo_hash(i * 11) * 1.1
    ctx.globalAlpha = a
    ctx.fillStyle = i % 7 === 0 ? '#cfe0ff' : '#eef3ff'
    ctx.beginPath(); ctx.arc(sx, sy, rad, 0, Math.PI * 2); ctx.fill()
  }
  ctx.globalAlpha = 1

  // ── 3. Celestial body (hazy moon) with layered bloom ──
  const moonX = W * 0.74
  const moonY = horizon * 0.34
  const moonR = Math.min(W, H) * 0.052
  // outer atmospheric bloom
  const bloom = ctx.createRadialGradient(moonX, moonY, moonR * 0.4, moonX, moonY, moonR * 9)
  bloom.addColorStop(0, 'rgba(214,228,255,0.42)')
  bloom.addColorStop(0.22, 'rgba(168,190,238,0.20)')
  bloom.addColorStop(0.55, 'rgba(120,150,210,0.07)')
  bloom.addColorStop(1, 'rgba(120,150,210,0)')
  ctx.fillStyle = bloom
  ctx.fillRect(0, 0, W, horizon)
  // moon disc with soft inner shading
  const disc = ctx.createRadialGradient(
    moonX - moonR * 0.35, moonY - moonR * 0.35, moonR * 0.15,
    moonX, moonY, moonR,
  )
  disc.addColorStop(0, '#fdf6e4')
  disc.addColorStop(0.6, '#f0e6cf')
  disc.addColorStop(0.92, '#d8cfbe')
  disc.addColorStop(1, 'rgba(200,196,184,0.35)')
  ctx.fillStyle = disc
  ctx.beginPath(); ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2); ctx.fill()
  // faint craters (stable, no glow)
  ctx.globalAlpha = 0.10
  ctx.fillStyle = '#9a9080'
  for (let i = 0; i < 5; i++) {
    const ca = atmo_hash(i * 17 + 3) * Math.PI * 2
    const cd = (0.2 + atmo_hash(i * 23) * 0.6) * moonR
    const cr = (0.10 + atmo_hash(i * 31) * 0.16) * moonR
    ctx.beginPath()
    ctx.arc(moonX + Math.cos(ca) * cd, moonY + Math.sin(ca) * cd, cr, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1

  // ── 4. Volumetric light shaft falling from the moon ──
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = 0.06 + 0.02 * Math.sin(time * 0.4)
  const shaft = ctx.createLinearGradient(moonX, moonY, moonX - W * 0.18, horizon)
  shaft.addColorStop(0, 'rgba(220,232,255,1)')
  shaft.addColorStop(1, 'rgba(220,232,255,0)')
  ctx.fillStyle = shaft
  ctx.beginPath()
  ctx.moveTo(moonX, moonY)
  ctx.lineTo(moonX - W * 0.10, horizon)
  ctx.lineTo(moonX - W * 0.34, horizon)
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  // ── 5. Drifting clouds — soft elongated blobs, slow horizontal drift ──
  ctx.save()
  for (let i = 0; i < 6; i++) {
    const speed = 6 + atmo_hash(i * 13 + 2) * 10
    const cw = W * (0.14 + atmo_hash(i * 19) * 0.16)
    const cx = ((atmo_hash(i * 7 + 1) * (W + 200)) + time * speed) % (W + cw * 2) - cw
    const cy = horizon * (0.28 + atmo_hash(i * 29 + 5) * 0.42)
    const ch = cw * (0.16 + atmo_hash(i * 37) * 0.08)
    const alpha = 0.05 + atmo_hash(i * 41) * 0.07
    const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, cw * 0.6)
    cg.addColorStop(0, `rgba(150,168,200,${alpha})`)
    cg.addColorStop(1, 'rgba(150,168,200,0)')
    ctx.fillStyle = cg
    ctx.beginPath(); ctx.ellipse(cx, cy, cw * 0.6, ch, 0, 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()

  // ── 6. Parallax distant ridges — 3 bands, lighter & hazier toward horizon ──
  // Far band (darkest at top of stack, but high & hazy)
  ctx.fillStyle = '#1b2c4c'
  atmo_ridge(ctx, W, H, 101, horizon * 0.66, horizon * 0.30, time * 1.2)
  ctx.fill()
  // mid band — pick up warm horizon haze
  ctx.fillStyle = '#28405f'
  atmo_ridge(ctx, W, H, 211, horizon * 0.80, horizon * 0.26, time * 2.4)
  ctx.fill()
  // near band — lightest/warmest, sits just above the play horizon
  ctx.fillStyle = '#3a5172'
  atmo_ridge(ctx, W, H, 331, horizon * 0.93, horizon * 0.20, time * 4.0)
  ctx.fill()
  // atmospheric haze veil over the ridges to push them back
  const veil = ctx.createLinearGradient(0, horizon * 0.55, 0, horizon)
  veil.addColorStop(0, 'rgba(120,128,150,0)')
  veil.addColorStop(1, 'rgba(150,140,148,0.34)')
  ctx.fillStyle = veil
  ctx.fillRect(0, horizon * 0.55, W, horizon - horizon * 0.55)

  // ── 7. Soft vignette + gentle color grade over the whole frame ──
  const vig = ctx.createRadialGradient(
    W * 0.5, H * 0.42, Math.min(W, H) * 0.30,
    W * 0.5, H * 0.5, Math.max(W, H) * 0.78,
  )
  vig.addColorStop(0, 'rgba(4,7,18,0)')
  vig.addColorStop(0.7, 'rgba(4,7,18,0.10)')
  vig.addColorStop(1, 'rgba(3,5,14,0.46)')
  ctx.fillStyle = vig
  ctx.fillRect(0, 0, W, H)
  // subtle cool top grade for cohesion
  ctx.globalCompositeOperation = 'soft-light'
  ctx.globalAlpha = 0.5
  const grade = ctx.createLinearGradient(0, 0, 0, H)
  grade.addColorStop(0, 'rgba(40,70,130,1)')
  grade.addColorStop(0.6, 'rgba(20,30,55,0.2)')
  grade.addColorStop(1, 'rgba(70,40,30,0.6)')
  ctx.fillStyle = grade
  ctx.fillRect(0, 0, W, H)
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1

  ctx.restore()
}

// ───────────────── TERRAIN ─────────────────
function buildTerrainCanvas(engine: RoperEngine): HTMLCanvasElement {
  const W = engine.width, H = engine.height
  const cv = document.createElement('canvas')
  cv.width = W; cv.height = H
  const tctx = cv.getContext('2d')!
  const img = tctx.createImageData(W, H)
  const data = img.data
  const mask = engine.terrain

  // Per-column distance from the topmost solid pixel (the open-sky surface for
  // that column). Used for grass crust + depth shading of the floor body.
  const topSolid = new Int32Array(W).fill(H)
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) { if (mask[y * W + x] === 1) { topSolid[x] = y; break } }
  }

  const solid = (x: number, y: number): boolean =>
    x >= 0 && x < W && y >= 0 && y < H && mask[y * W + x] === 1

  // ── palette ──────────────────────────────────────────────
  // floor earth
  const GRASS_HI: [number, number, number] = [120, 200, 64]
  const GRASS_LO: [number, number, number] = [58, 120, 44]
  const SOIL: [number, number, number] = [138, 92, 54]
  const CLAY: [number, number, number] = [96, 68, 50]
  const DEEP: [number, number, number] = [60, 48, 44]
  // rock (walls / ceiling underside / overhangs)
  const ROCK_HI: [number, number, number] = [104, 98, 110]
  const ROCK_LO: [number, number, number] = [54, 50, 60]
  const CEIL_DARK: [number, number, number] = [38, 34, 42]
  const MOSS: [number, number, number] = [74, 104, 58]

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x
      if (mask[idx] !== 1) { data[idx * 4 + 3] = 0; continue }

      // ── classify exposed surfaces by neighbour openness ──
      const openUp = !solid(x, y - 1)
      const openDn = !solid(x, y + 1)
      const openL = !solid(x - 1, y)
      const openR = !solid(x + 1, y)
      const exposed = openUp || openDn || openL || openR

      // Distance below this column's open surface. If the column has no sky
      // surface above (sealed under a ceiling/overhang) treat depth as large.
      const colTop = topSolid[x]
      const depth = (colTop <= y) ? (y - colTop) : 9999

      // Nearest-empty distance (for rim highlight + AO), cheap 2-ring probe.
      let nearOpen = 99
      if (exposed) nearOpen = 0
      else {
        for (let d = 1; d <= 3 && nearOpen > d; d++) {
          if (!solid(x - d, y) || !solid(x + d, y) || !solid(x, y - d) || !solid(x, y + d)) { nearOpen = d; break }
        }
      }

      // Is this an UP-FACING floor surface eligible for grass? Only if it has
      // open sky above it and isn't an underside (ceiling) pixel.
      const grassDepth = openUp ? 0 : (y - colTop)
      const isFloorTop = (colTop <= y) && grassDepth <= 7 && (openUp || grassDepth < 7)

      // ── decide base colour ──
      let r: number, g: number, b: number

      // ROCK regions: ceiling undersides, walls, overhangs — anything exposed
      // sideways/below without sky above, or deep sealed body.
      const isRock = (depth === 9999) || (exposed && !openUp && grassDepth > 10)

      if (isFloorTop && grassDepth <= 6) {
        // lush grass crust → darker grass shadow band
        const gt = grassDepth / 6
        const blade = terr_vnoise(x * 0.5, y * 1.7)            // vertical blade streaks
        const bladeLift = (blade - 0.5) * 26 * (1 - gt)
        let [gr, gg, gb] = terr_mix(
          GRASS_HI[0], GRASS_HI[1], GRASS_HI[2],
          GRASS_LO[0], GRASS_LO[1], GRASS_LO[2], gt * gt
        )
        gr += bladeLift * 0.4; gg += bladeLift; gb += bladeLift * 0.25
        // a soft top sheen on the very crown pixels
        if (grassDepth <= 1) { gr += 18; gg += 22; gb += 10 }
        r = gr; g = gg; b = gb
      } else if (isRock) {
        // rocky face: mottled cool grey, darker on ceiling undersides
        const rn = terr_vnoise(x * 0.18, y * 0.18)
        const rn2 = terr_vnoise(x * 0.9 + 40, y * 0.9 - 17)    // fine grain
        const ceilUnder = openDn && !openUp                    // pointing downward
        const baseLo = ceilUnder ? CEIL_DARK : ROCK_LO
        let [rr, rg, rb] = terr_mix(baseLo[0], baseLo[1], baseLo[2], ROCK_HI[0], ROCK_HI[1], ROCK_HI[2], rn)
        const grain = (rn2 - 0.5) * 22
        rr += grain; rg += grain; rb += grain * 1.05
        // mossy / damp tint near ceiling edges (where it meets open air)
        if (ceilUnder && nearOpen <= 1) {
          const m = terr_vnoise(x * 0.4, y * 0.4)
          if (m > 0.55) { const mm = (m - 0.55) * 1.6; ;[rr, rg, rb] = terr_mix(rr, rg, rb, MOSS[0], MOSS[1], MOSS[2], Math.min(0.6, mm)) }
        }
        r = rr; g = rg; b = rb
      } else {
        // EARTH BODY: topsoil → clay → deep rock with depth, strata bands +
        // horizontal hash texture so it isn't flat.
        const eff = Math.min(1, depth / 320)
        let er: number, eg: number, eb: number
        if (depth < 90) {
          const t = depth / 90
          ;[er, eg, eb] = terr_mix(SOIL[0], SOIL[1], SOIL[2], CLAY[0], CLAY[1], CLAY[2], t)
        } else {
          const t = Math.min(1, (depth - 90) / 230)
          ;[er, eg, eb] = terr_mix(CLAY[0], CLAY[1], CLAY[2], DEEP[0], DEEP[1], DEEP[2], t)
        }
        // strata: gentle horizontal bands, position-stable
        const strata = Math.sin(depth * 0.10 + terr_vnoise(0, depth * 0.05) * 6) * 7 * (1 - eff * 0.4)
        // clay/pebble hash noise
        const hn = (terr_hash(x, y) - 0.5) * 16
        const blotch = (terr_vnoise(x * 0.25, y * 0.25) - 0.5) * 18
        er += strata + hn + blotch * 0.9
        eg += strata * 0.85 + hn + blotch * 0.7
        eb += strata * 0.6 + hn * 0.8 + blotch * 0.4
        r = er; g = eg; b = eb
      }

      // ── ambient occlusion: darken interior pixels away from any edge ──
      // (Deep-buried pixels get a touch darker so excavated tunnels read.)
      if (!exposed) {
        const ao = nearOpen >= 99 ? 1 : nearOpen / 3       // 0 at edge → 1 buried
        const darken = 1 - 0.10 * ao
        r *= darken; g *= darken; b *= darken
      }

      // ── rim highlight: bright lip on exposed edges, biased to top-lit ──
      if (exposed) {
        // top edges catch more light than side/under edges
        const lit = openUp ? 1.0 : (openL || openR ? 0.55 : 0.25)
        const rim = lit * (isRock ? 26 : 20)
        r += rim; g += rim; b += rim * 0.9
        // subtle inner shadow on undersides so ceilings read as overhead
        if (openDn && !openUp) { r *= 0.82; g *= 0.82; b *= 0.85 }
      }

      const o = idx * 4
      data[o] = terr_clamp8(r)
      data[o + 1] = terr_clamp8(g)
      data[o + 2] = terr_clamp8(b)
      data[o + 3] = 255
    }
  }

  tctx.putImageData(img, 0, 0)
  return cv
}

function punchCrater(tctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  tctx.save()

  // 1) carve the hole
  tctx.globalCompositeOperation = 'destination-out'
  tctx.beginPath(); tctx.arc(x, y, r, 0, Math.PI * 2); tctx.fill()

  // 2) scorched / molten rim painted just inside the new edge
  tctx.globalCompositeOperation = 'source-over'

  // dark charred band hugging the rim
  const rim = tctx.createRadialGradient(x, y, Math.max(0, r - 9), x, y, r)
  rim.addColorStop(0, 'rgba(26,18,12,0)')
  rim.addColorStop(0.55, 'rgba(26,18,12,0.30)')
  rim.addColorStop(0.82, 'rgba(18,12,8,0.72)')
  rim.addColorStop(1, 'rgba(10,7,5,0.88)')
  tctx.fillStyle = rim
  tctx.beginPath(); tctx.arc(x, y, r, 0, Math.PI * 2); tctx.fill()

  // faint ember/scorch glow biased into the soil, drawn just inside the lip
  tctx.globalCompositeOperation = 'overlay'
  const ember = tctx.createRadialGradient(x, y, r * 0.55, x, y, r)
  ember.addColorStop(0, 'rgba(255,122,42,0)')
  ember.addColorStop(0.8, 'rgba(255,96,30,0.10)')
  ember.addColorStop(0.97, 'rgba(255,70,20,0.22)')
  ember.addColorStop(1, 'rgba(120,30,10,0)')
  tctx.fillStyle = ember
  tctx.beginPath(); tctx.arc(x, y, r, 0, Math.PI * 2); tctx.fill()

  // crisp bright lip line right at the edge so the crater reads carved
  tctx.globalCompositeOperation = 'source-over'
  tctx.lineWidth = 1.4
  tctx.strokeStyle = 'rgba(40,30,22,0.55)'
  tctx.beginPath(); tctx.arc(x, y, r - 0.7, 0, Math.PI * 2); tctx.stroke()

  tctx.restore()
}

// ───────────────── WORM ─────────────────
function drawWorm(ctx: CanvasRenderingContext2D, engine: RoperEngine, w: Worm, active: boolean, time: number): void {
  const R = WORM_RADIUS
  const color = worm_TEAM[w.team]
  const seed = w.index * 7 + w.team * 31
  const live = active && engine.state !== 'over'

  // Idle life: gentle breathing squash + a tiny side-to-side wiggle, phase-offset per worm.
  const phase = time * 2.1 + seed * 1.37
  const breathe = Math.sin(phase) * 0.5 + 0.5            // 0..1
  const squash = 1 + (live ? 0.05 : 0.03) * Math.sin(phase)        // vertical scale
  const stretch = 1 - (squash - 1) * 0.6                          // conserve volume-ish
  const wiggle = (live ? 0.7 : 0.4) * Math.sin(time * 1.6 + seed)  // px lateral sway

  // Body anchor: feet sit on (x,y); body center is a radius above the feet.
  const cx = w.x + wiggle
  const baseY = w.y
  const bodyH = R * 1.92 * squash
  const bodyW = R * 1.7 * stretch
  const cyc = baseY - bodyH * 0.5 - R * 0.18              // body center y

  ctx.save()

  // ── 1. Active aura: soft team glow ring + pulse, behind everything ──
  if (live) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 3.2)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    const aura = ctx.createRadialGradient(cx, cyc, R * 0.4, cx, cyc, R * 2.5)
    aura.addColorStop(0, worm_shade(color, 0.2))
    aura.addColorStop(0.5, color)
    aura.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.globalAlpha = 0.20 + 0.12 * pulse
    ctx.fillStyle = aura
    ctx.beginPath()
    ctx.arc(cx, cyc, R * 2.5, 0, Math.PI * 2)
    ctx.fill()
    // crisp ring
    ctx.globalAlpha = 0.55 + 0.25 * pulse
    ctx.lineWidth = 1.4
    ctx.strokeStyle = worm_shade(color, 0.35)
    ctx.beginPath()
    ctx.arc(cx, cyc, R * (1.55 + 0.08 * pulse), 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }

  // ── 2. Contact drop-shadow on the ground beneath the worm ──
  ctx.save()
  ctx.globalAlpha = 0.32
  const sw = bodyW * (1.1 - 0.12 * (squash - 1) * 8)
  const shGrad = ctx.createRadialGradient(cx, baseY + 1, 0, cx, baseY + 1, sw)
  shGrad.addColorStop(0, 'rgba(0,0,0,0.55)')
  shGrad.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = shGrad
  ctx.beginPath()
  ctx.ellipse(cx, baseY + 1.5, sw, R * 0.42, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // ── 3. Body: shaded rounded capsule with rim light + team sheen ──
  ctx.save()
  // ground-shadow ambient occlusion under the belly
  ctx.beginPath()
  ctx.ellipse(cx, cyc, bodyW * 0.5, bodyH * 0.5, 0, 0, Math.PI * 2)
  // base radial shading: lit from upper-left
  const lx = cx - bodyW * 0.26, ly = cyc - bodyH * 0.32
  const body = ctx.createRadialGradient(lx, ly, R * 0.18, cx, cyc, bodyH * 0.62)
  body.addColorStop(0, worm_shade(color, 0.42))
  body.addColorStop(0.45, color)
  body.addColorStop(1, worm_shade(color, -0.5))
  ctx.fillStyle = body
  ctx.fill()

  // soft team-colored top sheen (specular band near the crown)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = 0.5
  const sheen = ctx.createRadialGradient(cx - bodyW * 0.18, cyc - bodyH * 0.34, 0, cx - bodyW * 0.18, cyc - bodyH * 0.34, bodyW * 0.6)
  sheen.addColorStop(0, worm_shade(color, 0.65))
  sheen.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = sheen
  ctx.beginPath()
  ctx.ellipse(cx - bodyW * 0.12, cyc - bodyH * 0.18, bodyW * 0.42, bodyH * 0.4, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // lighter belly (front-lower lobe)
  ctx.globalAlpha = 0.85
  const belly = ctx.createRadialGradient(cx, cyc + bodyH * 0.2, R * 0.1, cx, cyc + bodyH * 0.2, bodyW * 0.62)
  belly.addColorStop(0, worm_shade(color, 0.55))
  belly.addColorStop(0.7, worm_shade(color, 0.22))
  belly.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = belly
  ctx.beginPath()
  ctx.ellipse(cx, cyc + bodyH * 0.22, bodyW * 0.44, bodyH * 0.32, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1

  // rim light along the lower-right edge for depth separation
  ctx.save()
  ctx.lineWidth = 1.3
  ctx.strokeStyle = worm_shade(color, 0.5)
  ctx.globalAlpha = 0.5
  ctx.beginPath()
  ctx.ellipse(cx, cyc, bodyW * 0.5 - 0.6, bodyH * 0.5 - 0.6, 0, Math.PI * 0.15, Math.PI * 0.95)
  ctx.stroke()
  ctx.restore()

  // dark contour for crisp read at small size
  ctx.lineWidth = 1
  ctx.strokeStyle = worm_shade(color, -0.62)
  ctx.beginPath()
  ctx.ellipse(cx, cyc, bodyW * 0.5, bodyH * 0.5, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()

  // ── 4. Face: eyes that aim, catchlights, blink; small mouth ──
  // Look direction: active worm tracks aim, others face w.facing.
  let lookX: number, lookY: number
  if (live) { lookX = Math.cos(engine.aimAngle); lookY = Math.sin(engine.aimAngle) }
  else { lookX = w.facing; lookY = -0.12 }
  const lookLen = Math.hypot(lookX, lookY) || 1
  lookX /= lookLen; lookY /= lookLen

  // Blink: short closure on a per-worm cycle.
  const blinkCycle = 2.6 + worm_hash(seed) * 2.4
  const blinkPhase = (time + worm_hash(seed * 3) * blinkCycle) % blinkCycle
  const blinking = blinkPhase < 0.11
  const open = blinking ? 0.12 : 1

  const eyeR = R * 0.5
  const eyeDX = bodyW * 0.22
  const eyeY = cyc - bodyH * 0.16
  const eyes = [
    { ex: cx - eyeDX, ey: eyeY },
    { ex: cx + eyeDX, ey: eyeY },
  ]
  for (const e of eyes) {
    ctx.save()
    // eye white
    ctx.fillStyle = '#f4f7fb'
    ctx.beginPath()
    ctx.ellipse(e.ex, e.ey, eyeR, eyeR * open, 0, 0, Math.PI * 2)
    ctx.fill()
    // subtle eye-socket shade
    ctx.lineWidth = 0.8
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'
    ctx.stroke()
    if (!blinking) {
      // pupil tracks look direction, clamped inside the white
      const px = e.ex + lookX * eyeR * 0.5
      const py = e.ey + lookY * eyeR * 0.5
      const pr = eyeR * 0.56
      ctx.fillStyle = '#1a1f2e'
      ctx.beginPath()
      ctx.arc(px, py, pr, 0, Math.PI * 2)
      ctx.fill()
      // catchlight
      ctx.fillStyle = 'rgba(255,255,255,0.92)'
      ctx.beginPath()
      ctx.arc(px - pr * 0.32, py - pr * 0.38, pr * 0.34, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  // brow line over the eyes for expression (slightly determined for active)
  ctx.save()
  ctx.strokeStyle = worm_shade(color, -0.55)
  ctx.lineWidth = 1.1
  ctx.lineCap = 'round'
  const browTilt = live ? 0.16 : 0.06
  ctx.beginPath()
  ctx.moveTo(cx - eyeDX - eyeR * 0.8, eyeY - eyeR - 0.6 + browTilt * eyeR)
  ctx.lineTo(cx - eyeDX + eyeR * 0.6, eyeY - eyeR - 1.2)
  ctx.moveTo(cx + eyeDX - eyeR * 0.6, eyeY - eyeR - 1.2)
  ctx.lineTo(cx + eyeDX + eyeR * 0.8, eyeY - eyeR - 0.6 + browTilt * eyeR)
  ctx.stroke()

  // mouth: small smile that bends toward facing; opens a touch with breathing
  ctx.strokeStyle = worm_shade(color, -0.6)
  ctx.lineWidth = 1.2
  const mY = cyc + bodyH * 0.16
  const mW = bodyW * 0.26
  const mDip = R * (0.22 + 0.1 * breathe)
  ctx.beginPath()
  ctx.moveTo(cx - mW, mY)
  ctx.quadraticCurveTo(cx + (live ? lookX : w.facing) * mW * 0.25, mY + mDip, cx + mW, mY)
  ctx.stroke()
  ctx.restore()

  // ── 5. HP bar floating above ──
  const f = Math.max(0, Math.min(1, w.hp / 100))
  const barW = R * 2.4
  const barH = R * 0.5
  const barX = cx - barW / 2
  const barY = cyc - bodyH * 0.5 - R * 1.05
  ctx.save()
  // dark backing
  worm_roundRect(ctx, barX - 1, barY - 1, barW + 2, barH + 2, barH * 0.6 + 1)
  ctx.fillStyle = 'rgba(8,12,20,0.78)'
  ctx.fill()
  // fill
  if (f > 0) {
    worm_roundRect(ctx, barX, barY, barW * f, barH, barH * 0.5)
    const hc = worm_hpColor(f)
    const g = ctx.createLinearGradient(barX, barY, barX, barY + barH)
    g.addColorStop(0, worm_shade(hc, 0.4))
    g.addColorStop(1, worm_shade(hc, -0.18))
    ctx.fillStyle = g
    ctx.fill()
  }
  // border
  worm_roundRect(ctx, barX, barY, barW, barH, barH * 0.5)
  ctx.lineWidth = 0.8
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.stroke()
  ctx.restore()

  // ── 6. Active marker: bobbing chevron above the HP bar ──
  if (live) {
    const bob = Math.sin(time * 4) * R * 0.22
    const chY = barY - R * 0.7 + bob
    ctx.save()
    ctx.shadowColor = color
    ctx.shadowBlur = 0
    ctx.fillStyle = worm_shade(color, 0.25)
    ctx.strokeStyle = worm_shade(color, -0.4)
    ctx.lineWidth = 1
    ctx.lineJoin = 'round'
    const chW = R * 0.85, chH = R * 0.7
    ctx.beginPath()
    ctx.moveTo(cx - chW, chY - chH)
    ctx.lineTo(cx, chY)
    ctx.lineTo(cx + chW, chY - chH)
    ctx.lineTo(cx + chW * 0.5, chY - chH)
    ctx.lineTo(cx, chY - chH * 0.45)
    ctx.lineTo(cx - chW * 0.5, chY - chH)
    ctx.closePath()
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.stroke()
    ctx.restore()
  }

  ctx.restore()
}

// ───────────────── ROPE ─────────────────
function drawRope(ctx: CanvasRenderingContext2D, engine: RoperEngine, time: number): void {
  const rope = engine.rope
  const worm = engine.active
  if (!rope || !worm) return

  const attached = rope.phase === 'attached'
  // origin = the active worm's hand (just above centre, biased to facing side)
  const ox = worm.x + worm.facing * 2
  const oy = worm.y - 2
  // tip = locked anchor when attached, else the live flying/retracting hook tip
  const tx = attached ? rope.ax : rope.hx
  const ty = attached ? rope.ay : rope.hy

  // degenerate guard
  if (!isFinite(tx) || !isFinite(ty)) return
  const span = Math.hypot(tx - ox, ty - oy)
  if (span < 0.5) return

  ctx.save()

  // Build the centreline (with sag/taut behaviour) and stroke the cord.
  const { pts, taut, nx, ny } = rope_path(ox, oy, tx, ty, attached, rope.length, time)
  rope_drawCord(ctx, pts, nx, ny, taut, attached, time)

  // Hook orientation: aim it along the final segment of the rope (pointing out
  // toward the surface it grips / the direction it's flying).
  const last = pts[pts.length - 1]
  const prev = pts[pts.length - 2] || pts[0]
  const ang = Math.atan2(last.y - prev.y, last.x - prev.x)

  if (attached) {
    // anchor glint — subtle spark where the claw bites the rock
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    const flash = Math.max(0, 0.5 + 0.5 * Math.sin(time * 4)) * 0.22
    ctx.globalAlpha = 0.14 + flash
    const ag = ctx.createRadialGradient(tx, ty, 0, tx, ty, 9)
    ag.addColorStop(0, 'rgba(255,245,220,1)')
    ag.addColorStop(1, 'rgba(255,245,220,0)')
    ctx.fillStyle = ag
    ctx.beginPath()
    ctx.arc(tx, ty, 9, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    rope_drawClaw(ctx, tx, ty, ang, time)
  } else {
    rope_drawDart(ctx, tx, ty, ang)
  }

  // small anchor collar at the worm's hand so the rope reads as gripped, not floating
  ctx.fillStyle = 'rgba(40,30,20,0.85)'
  ctx.beginPath()
  ctx.arc(ox, oy, 1.8, 0, Math.PI * 2)
  ctx.fill()

  // reset any lingering state
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.setLineDash([])
  ctx.restore()
}

// ───────────────── PROJECTILE ─────────────────
function drawProjectile(ctx: CanvasRenderingContext2D, p: Projectile, time: number): void {
  const meta = WEAPON_META[p.kind]
  const accent = meta.color

  // 1) motion trail (drawn under the sprite, in world space)
  proj_trail(ctx, p, accent)

  // 2) soft cast glow / contact shadow under the body
  ctx.save()
  ctx.globalCompositeOperation = 'multiply'
  const sg = ctx.createRadialGradient(p.x, p.y + p.r * 0.5, 0, p.x, p.y + p.r * 0.5, p.r * 2)
  sg.addColorStop(0, 'rgba(0,0,0,0.30)')
  sg.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = sg
  ctx.beginPath(); ctx.ellipse(p.x, p.y + p.r * 0.6, p.r * 1.7, p.r * 0.85, 0, 0, proj_TAU); ctx.fill()
  ctx.restore()

  // sprite local frame: roll with motion
  const sp = Math.hypot(p.vx, p.vy)
  const roll = sp > 6 ? Math.atan2(p.vy, p.vx) : (time * 1.3 + p.owner)
  ctx.save()
  ctx.translate(p.x, p.y)

  if (p.kind === 'grenade') {
    // ── GRENADE: shaded segmented pineapple ──
    const r = p.r
    ctx.save()
    ctx.rotate(roll)

    // body base with directional shading
    const bg = ctx.createRadialGradient(-r * 0.4, -r * 0.5, r * 0.2, 0, 0, r * 1.25)
    bg.addColorStop(0, '#6fae54')
    bg.addColorStop(0.5, '#3f7d2e')
    bg.addColorStop(1, '#1f4417')
    ctx.fillStyle = bg
    ctx.beginPath(); ctx.ellipse(0, 0, r, r * 1.12, 0, 0, proj_TAU); ctx.fill()

    // serrated segment grooves (pineapple texture) — vertical + horizontal lattice
    ctx.save()
    ctx.beginPath(); ctx.ellipse(0, 0, r, r * 1.12, 0, 0, proj_TAU); ctx.clip()
    ctx.strokeStyle = 'rgba(20,45,15,0.55)'
    ctx.lineWidth = 0.7
    for (let i = -2; i <= 2; i++) {
      const gx = (i / 2.5) * r
      ctx.beginPath(); ctx.moveTo(gx, -r * 1.2); ctx.lineTo(gx, r * 1.2); ctx.stroke()
    }
    for (let j = -2; j <= 2; j++) {
      const gy = (j / 2.5) * r * 1.12
      ctx.beginPath(); ctx.moveTo(-r * 1.2, gy); ctx.lineTo(r * 1.2, gy); ctx.stroke()
    }
    // highlight glint sweeping the upper-left lattice
    ctx.strokeStyle = 'rgba(190,230,150,0.30)'
    ctx.lineWidth = 0.6
    ctx.beginPath(); ctx.moveTo(-r * 0.6, -r * 1.2); ctx.lineTo(-r * 0.6, r * 1.2); ctx.stroke()
    ctx.restore()

    // rim shade for roundness
    ctx.strokeStyle = 'rgba(10,30,8,0.5)'
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.ellipse(0, 0, r - 0.4, r * 1.12 - 0.4, 0, 0, proj_TAU); ctx.stroke()

    // specular highlight
    ctx.fillStyle = 'rgba(225,245,200,0.6)'
    ctx.beginPath(); ctx.ellipse(-r * 0.42, -r * 0.55, r * 0.26, r * 0.18, -0.5, 0, proj_TAU); ctx.fill()

    // top cap
    ctx.fillStyle = '#2a5a1f'
    ctx.fillRect(-2.2, -r * 1.12 - 3, 4.4, 3.4)
    ctx.fillStyle = '#173a10'
    ctx.fillRect(-2.2, -r * 1.12 - 0.4, 4.4, 1)

    // safety lever along the side
    ctx.strokeStyle = '#cfcfcf'
    ctx.lineWidth = 1.4
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(1.6, -r * 1.12 - 1.5)
    ctx.lineTo(r * 0.85, -r * 0.2)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'
    ctx.lineWidth = 0.5
    ctx.stroke()

    ctx.restore() // end roll

    // fuse spark sits at the world-top of the grenade (not rolled), above the cap
    const GREN_FUSE = 3
    const left = Math.max(0, Math.min(GREN_FUSE, p.fuse))
    const intensity = 1 - left / GREN_FUSE          // 0 fresh → 1 about to blow
    const tipY = -(r * 1.12 + 4.5)
    // accent-tinted fuse stub
    ctx.strokeStyle = accent
    ctx.lineWidth = 1.2
    ctx.beginPath(); ctx.moveTo(0, -(r * 1.12 + 1)); ctx.lineTo(0, tipY + 1); ctx.stroke()
    proj_fuseCore(ctx, 0, tipY, 1.6, intensity)
    proj_sparks(ctx, 0, tipY, time, p.owner * 13.7 + 1, intensity, 4)
  } else {
    // ── BOMB: heavy glossy cartoon sphere ──
    const r = p.r
    ctx.save()
    ctx.rotate(roll * 0.4)   // bombs barely roll — subtle

    // dark glossy sphere
    const bg = ctx.createRadialGradient(-r * 0.45, -r * 0.5, r * 0.15, 0, r * 0.2, r * 1.35)
    bg.addColorStop(0, '#4a4a58')
    bg.addColorStop(0.45, '#23232c')
    bg.addColorStop(1, '#0a0a10')
    ctx.fillStyle = bg
    ctx.beginPath(); ctx.arc(0, 0, r, 0, proj_TAU); ctx.fill()

    // rim light at bottom-right (bounce light)
    ctx.strokeStyle = 'rgba(120,130,160,0.35)'
    ctx.lineWidth = 1.1
    ctx.beginPath(); ctx.arc(0, 0, r - 0.6, Math.PI * 0.1, Math.PI * 0.9); ctx.stroke()

    // accent equator band
    ctx.strokeStyle = accent
    ctx.globalAlpha = 0.55
    ctx.lineWidth = 1.2
    ctx.beginPath(); ctx.ellipse(0, 0, r * 0.92, r * 0.34, 0, 0, proj_TAU); ctx.stroke()
    ctx.globalAlpha = 1

    // bright specular highlight + tiny secondary glint
    ctx.fillStyle = 'rgba(235,240,255,0.85)'
    ctx.beginPath(); ctx.ellipse(-r * 0.4, -r * 0.45, r * 0.26, r * 0.18, -0.5, 0, proj_TAU); ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.6)'
    ctx.beginPath(); ctx.arc(-r * 0.12, -r * 0.62, r * 0.08, 0, proj_TAU); ctx.fill()

    // fuse collar at top
    ctx.fillStyle = '#15151b'
    ctx.fillRect(-r * 0.3, -r - 2.5, r * 0.6, 3)

    ctx.restore() // end subtle roll

    // short curled fuse + bright sputtering spark (world-top, not rolled)
    const baseY = -(r + 2.5)
    const wob = Math.sin(time * 9 + p.owner) * 1.6
    ctx.strokeStyle = '#caa46a'
    ctx.lineWidth = 1.3
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(0, baseY)
    ctx.quadraticCurveTo(2.2 + wob, baseY - 3.5, 1.2 + wob, baseY - 6.5)
    ctx.stroke()
    const tipX = 1.2 + wob, tipY = baseY - 6.5
    // bright sputter (always near-max intensity for a lit bomb)
    const intensity = 0.7 + (Math.sin(time * 13 + p.owner) + 1) * 0.15
    proj_fuseCore(ctx, tipX, tipY, 1.9, intensity)
    proj_sparks(ctx, tipX, tipY, time, p.owner * 9.1 + 5, intensity, 5)

    // tiny smoke puff drifting up from the spark
    ctx.save()
    ctx.globalCompositeOperation = 'source-over'
    for (let i = 0; i < 2; i++) {
      const ph = ((time * 0.9 + i * 0.5 + p.owner) % 1)
      const sx = tipX + Math.sin(time * 2 + i) * 1.5
      const sy = tipY - 2 - ph * 7
      ctx.globalAlpha = (1 - ph) * 0.18
      ctx.fillStyle = '#9a9aa6'
      ctx.beginPath(); ctx.arc(sx, sy, 1.2 + ph * 2.4, 0, proj_TAU); ctx.fill()
    }
    ctx.globalAlpha = 1
    ctx.restore()
  }

  ctx.restore() // end translate
  // explicit state reset (defensive)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.shadowBlur = 0
}

// ───────────────── FX ─────────────────
function drawBlast(ctx: CanvasRenderingContext2D, b: Blast, time: number): void {
  const p = Math.max(0, Math.min(1, b.t / b.life))   // 0 -> 1
  const inv = 1 - p
  const R = b.r
  if (R <= 0) return

  ctx.save()

  // ── 1. SHOCKWAVE RING — thin bright ring growing past b.r, fading fast ──
  // Strongest early, gone by ~70% of life.
  if (p < 0.72) {
    const ringP = p / 0.72                        // 0..1 over the early window
    const ringR = R * (0.65 + ringP * 1.35)       // expands past b.r
    const ringA = (1 - ringP) * (1 - ringP) * 0.85
    ctx.globalCompositeOperation = 'lighter'
    ctx.strokeStyle = `rgba(255,${Math.round(230 - ringP * 70)},${Math.round(170 - ringP * 110)},${ringA})`
    ctx.lineWidth = Math.max(1, R * 0.06 * (1 - ringP) + 1)
    ctx.beginPath(); ctx.arc(b.x, b.y, ringR, 0, Math.PI * 2); ctx.stroke()
    // faint outer echo ring
    ctx.strokeStyle = `rgba(255,255,255,${ringA * 0.35})`
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.arc(b.x, b.y, ringR * 1.12, 0, Math.PI * 2); ctx.stroke()
  }

  // ── 2. SMOKE PUFFS — soft dark-grey blobs drifting up, lingering & fading ──
  // Drawn under the fire (source-over), persist longer than the core.
  ctx.globalCompositeOperation = 'source-over'
  const puffs = 5
  for (let i = 0; i < puffs; i++) {
    const a = fx_blast_hash(b.x + i * 53.3, b.y - i * 31.7)   // stable per-blast pseudo-random
    const ang = a * Math.PI * 2
    const spread = R * (0.25 + (i / puffs) * 0.55)
    const px = b.x + Math.cos(ang) * spread * (0.4 + p * 0.6)
    const py = b.y + Math.sin(ang) * spread * 0.45 - p * R * (0.5 + a * 0.5)   // drift up
    const pr = R * (0.32 + a * 0.30) * (0.55 + p * 0.85)
    const smokeA = p < 0.18 ? (p / 0.18) * 0.45 : Math.max(0, (1 - (p - 0.18) / 0.82)) * 0.45
    if (smokeA <= 0.01) continue
    const shade = 38 + Math.round(a * 34)
    const sg = ctx.createRadialGradient(px, py, 0, px, py, pr)
    sg.addColorStop(0, `rgba(${shade + 14},${shade + 12},${shade + 12},${smokeA})`)
    sg.addColorStop(0.6, `rgba(${shade},${shade},${shade + 4},${smokeA * 0.6})`)
    sg.addColorStop(1, `rgba(${shade},${shade},${shade},0)`)
    ctx.fillStyle = sg
    ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill()
  }

  // ── 3. FIREBALL CORE — white-hot flashing to orange/red (additive) ──
  ctx.globalCompositeOperation = 'lighter'
  const coreR = R * (0.42 + p * 0.78)
  const coreA = inv * inv                              // fade out quadratically
  if (coreA > 0.01) {
    const cg = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, coreR)
    const hot = 1 - Math.min(1, p / 0.45)              // how white-hot the centre still is
    cg.addColorStop(0, `rgba(255,255,${Math.round(220 + hot * 35)},${coreA})`)
    cg.addColorStop(0.30, `rgba(255,${Math.round(210 - p * 70)},${Math.round(110 - p * 90)},${coreA * 0.95})`)
    cg.addColorStop(0.62, `rgba(255,${Math.round(120 - p * 50)},${Math.round(40)},${coreA * 0.7})`)
    cg.addColorStop(1, `rgba(150,20,10,0)`)
    ctx.fillStyle = cg
    ctx.beginPath(); ctx.arc(b.x, b.y, coreR, 0, Math.PI * 2); ctx.fill()

    // a tiny searing white nucleus, only in the first flash
    if (hot > 0) {
      const ng = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, coreR * 0.5)
      ng.addColorStop(0, `rgba(255,255,255,${hot * coreA})`)
      ng.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = ng
      ctx.beginPath(); ctx.arc(b.x, b.y, coreR * 0.5, 0, Math.PI * 2); ctx.fill()
    }
  }

  // ── 4. EMBER STREAKS — deterministic spray radiating out (additive) ──
  if (p < 0.85) {
    const rays = 12
    const emberP = p
    const eA = (1 - emberP) * (1 - emberP) * 0.9
    ctx.lineCap = 'round'
    for (let i = 0; i < rays; i++) {
      const seed = fx_blast_hash(b.x + i * 12.1, b.y + i * 7.7)
      const ang = (i / rays) * Math.PI * 2 + seed * 0.9
      const len = R * (0.7 + seed * 1.3) * (0.4 + emberP * 1.1)
      const x0 = b.x + Math.cos(ang) * R * 0.25
      const y0 = b.y + Math.sin(ang) * R * 0.25
      const x1 = b.x + Math.cos(ang) * (R * 0.25 + len)
      const y1 = b.y + Math.sin(ang) * (R * 0.25 + len)
      ctx.strokeStyle = `rgba(255,${Math.round(190 - emberP * 80)},${Math.round(70 - emberP * 50)},${eA})`
      ctx.lineWidth = Math.max(0.8, (1 - emberP) * 2.4)
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke()
      // glowing ember head
      ctx.fillStyle = `rgba(255,${Math.round(230 - emberP * 90)},${Math.round(150 - emberP * 110)},${eA})`
      ctx.beginPath(); ctx.arc(x1, y1, Math.max(0.8, (1 - emberP) * 2), 0, Math.PI * 2); ctx.fill()
    }
  }

  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.restore()
}

function drawParticle(ctx: CanvasRenderingContext2D, p: Particle): void {
  const a = Math.max(0, Math.min(1, p.life / p.max))
  if (a <= 0.01) { ctx.globalAlpha = 1; return }

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'

  // velocity-aligned elongation -> a tiny streak
  const speed = Math.hypot(p.vx, p.vy)
  const dirx = speed > 0.001 ? p.vx / speed : 1
  const diry = speed > 0.001 ? p.vy / speed : 0
  const streak = Math.min(7, speed * 0.045)          // trail length scaled by speed
  const tailX = p.x - dirx * streak
  const tailY = p.y - diry * streak

  const baseR = 2.4
  // soft additive glow halo
  const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, baseR * 2.2)
  glow.addColorStop(0, p.color)
  glow.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.globalAlpha = a * 0.5
  ctx.fillStyle = glow
  ctx.beginPath(); ctx.arc(p.x, p.y, baseR * 2.2, 0, Math.PI * 2); ctx.fill()

  // tinted streak body
  if (streak > 0.6) {
    ctx.globalAlpha = a * 0.7
    ctx.strokeStyle = p.color
    ctx.lineCap = 'round'
    ctx.lineWidth = 1.6
    ctx.beginPath(); ctx.moveTo(tailX, tailY); ctx.lineTo(p.x, p.y); ctx.stroke()
  }

  // brighter near-white core at the head
  ctx.globalAlpha = a
  ctx.fillStyle = 'rgba(255,250,235,0.95)'
  ctx.beginPath(); ctx.arc(p.x, p.y, 0.9, 0, Math.PI * 2); ctx.fill()

  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.restore()
}

// ───────────────── HUD ─────────────────
function drawHUD(ctx: CanvasRenderingContext2D, engine: RoperEngine, time: number): void {
  void time
  ctx.save()

  // Corner team panels (left = team 0, right mirrored = team 1).
  hud_teamPanel(ctx, engine, 0, false)
  hud_teamPanel(ctx, engine, 1, true)

  // Top-center turn indicator + wind, only while the match is live.
  if (engine.state !== 'over' && engine.active) {
    hud_turn(ctx, engine)
    hud_wind(ctx, engine)
  }

  // Bottom-center weapon chip while aiming.
  if (engine.state === 'aim' && engine.active) {
    hud_weaponChip(ctx, engine)
  }

  // Reset any state we touched.
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.globalAlpha = 1
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0
  ctx.lineCap = 'butt'
  ctx.restore()
}

// ───────────────── WATER ─────────────────
function drawWater(ctx: CanvasRenderingContext2D, engine: RoperEngine, time: number): void {
  const w = engine.width;
  const h = engine.height;

  // Water band: deep enough to feel like a real body, ~22 world units.
  const band = 22;
  const surfaceY = h - band;       // nominal still-water surface line
  const step = 14;                 // wave path sampling step (cheap, smooth enough)

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // ---- 1. Deep body: translucent vertical gradient (aerated cyan -> deep navy-teal) ----
  // Drawn as a filled band capped by the topmost wave so the surface undulates.
  const bodyAmp = 3.0;
  const bodyLen = 150;
  const bodySpeed = 0.5;

  const bodyGrad = ctx.createLinearGradient(0, surfaceY - bodyAmp, 0, h);
  bodyGrad.addColorStop(0.0, 'rgba(150, 235, 248, 0.62)'); // aerated surface
  bodyGrad.addColorStop(0.18, 'rgba(58, 198, 224, 0.70)');
  bodyGrad.addColorStop(0.55, 'rgba(20, 132, 162, 0.82)'); // mid teal
  bodyGrad.addColorStop(1.0, 'rgba(4, 38, 52, 0.94)');     // deep navy-teal

  ctx.beginPath();
  water_traceWave(ctx, w, surfaceY, time, bodyAmp, bodyLen, bodySpeed, 0, 8);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = bodyGrad;
  ctx.fill();

  // Clip everything that follows to the water body so highlights never spill onto land.
  ctx.save();
  ctx.beginPath();
  water_traceWave(ctx, w, surfaceY, time, bodyAmp, bodyLen, bodySpeed, 0, 8);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.clip();

  // ---- 2. Faint caustic shimmer: two wide, soft diagonal bands of light ----
  ctx.globalCompositeOperation = 'screen';
  const causticGrad = ctx.createLinearGradient(0, surfaceY, 0, h);
  causticGrad.addColorStop(0.0, 'rgba(180, 245, 255, 0.0)');
  causticGrad.addColorStop(0.35, 'rgba(150, 235, 252, 0.10)');
  causticGrad.addColorStop(1.0, 'rgba(40, 150, 180, 0.0)');
  ctx.globalAlpha = 0.6;
  for (let c = 0; c < 2; c++) {
    const phase = c * Math.PI * 1.3;
    const cw = 70;                                  // caustic band half-width
    const cx = (Math.sin(time * 0.25 + phase) * 0.5 + 0.5) * w;
    ctx.beginPath();
    ctx.moveTo(cx - cw, surfaceY - bodyAmp);
    ctx.lineTo(cx + cw, surfaceY - bodyAmp);
    ctx.lineTo(cx + cw * 1.8, h);
    ctx.lineTo(cx - cw * 1.8, h);
    ctx.closePath();
    ctx.fillStyle = causticGrad;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  // ---- 3. Mid wave lines (under the crest) — subtle layered motion ----
  // Wave 1: slow, long
  ctx.beginPath();
  water_traceWave(ctx, w, surfaceY + 6, time, 2.2, 110, -0.7, 1.1, step);
  ctx.strokeStyle = 'rgba(120, 220, 240, 0.22)';
  ctx.lineWidth = 2.0;
  ctx.stroke();

  // Wave 2: faster, shorter, deeper down
  ctx.beginPath();
  water_traceWave(ctx, w, surfaceY + 12, time, 1.6, 78, 1.3, 2.7, step);
  ctx.strokeStyle = 'rgba(90, 200, 225, 0.16)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // ---- 4. Top crest wave with bright foam highlight ----
  const crestAmp = bodyAmp;
  const crestLen = bodyLen;
  const crestSpeed = bodySpeed;

  // Soft inner glow just beneath the crest (gives the surface depth/aeration)
  ctx.save();
  ctx.shadowColor = 'rgba(180, 245, 255, 0.55)';
  ctx.shadowBlur = 0;
  ctx.beginPath();
  water_traceWave(ctx, w, surfaceY, time, crestAmp, crestLen, crestSpeed, 0, step);
  ctx.strokeStyle = 'rgba(210, 250, 255, 0.85)';
  ctx.lineWidth = 2.4;
  ctx.stroke();
  ctx.restore();

  // Crisp foam line on the very crest
  ctx.beginPath();
  water_traceWave(ctx, w, surfaceY - 0.6, time, crestAmp, crestLen, crestSpeed, 0, step);
  ctx.strokeStyle = 'rgba(242, 255, 255, 0.95)';
  ctx.lineWidth = 1.3;
  ctx.stroke();

  // ---- 5. Specular sparkles — deterministic twinkling dots riding the surface ----
  ctx.globalCompositeOperation = 'screen';
  const SPARKLES = 26;
  for (let i = 0; i < SPARKLES; i++) {
    const baseX = water_hash(i * 2 + 1) * w;
    // gentle horizontal drift so they're not static
    const drift = Math.sin(time * (0.3 + water_hash(i * 7 + 3) * 0.5) + i) * 10;
    const sx = ((baseX + drift) % w + w) % w;
    const sy = water_waveY(sx, surfaceY, time, crestAmp, crestLen, crestSpeed, 0)
             + 1.5 + water_hash(i * 5 + 2) * 6;

    // twinkle 0..1 from a per-sparkle phase
    const tw = Math.sin(time * (2.2 + water_hash(i * 11 + 4) * 2.0) + i * 1.7) * 0.5 + 0.5;
    const a = tw * tw * 0.9;
    if (a < 0.04) continue;
    const r = 0.7 + tw * 1.6;

    const spark = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 2.4);
    spark.addColorStop(0, `rgba(255, 255, 255, ${a})`);
    spark.addColorStop(0.5, `rgba(190, 245, 255, ${a * 0.5})`);
    spark.addColorStop(1, 'rgba(190, 245, 255, 0)');
    ctx.fillStyle = spark;
    ctx.beginPath();
    ctx.arc(sx, sy, r * 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;

  ctx.restore(); // remove water-body clip

  ctx.restore(); // outer save
}

// ───────────────── AIM RETICLE + POWER METER ─────────────────
function drawAim(ctx: CanvasRenderingContext2D, engine: RoperEngine): void {
  const w = engine.active
  if (!w || !w.alive || engine.busy) return
  const dx = Math.cos(engine.aimAngle), dy = Math.sin(engine.aimAngle)
  const len = 50
  const ox = w.x + dx * (WORM_RADIUS + 5), oy = w.y + dy * (WORM_RADIUS + 5)
  const cx = w.x + dx * len, cy = w.y + dy * len
  const col = WEAPON_META[engine.weapon].color
  ctx.save()
  // dotted aim line
  ctx.setLineDash([2.5, 5])
  ctx.lineWidth = 1.6
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'
  ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(cx, cy); ctx.stroke()
  ctx.setLineDash([])
  // crosshair reticle in the weapon colour
  ctx.strokeStyle = col
  ctx.lineWidth = 2
  ctx.beginPath(); ctx.arc(cx, cy, 5.5, 0, Math.PI * 2); ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx - 9, cy); ctx.lineTo(cx - 3.5, cy)
  ctx.moveTo(cx + 3.5, cy); ctx.lineTo(cx + 9, cy)
  ctx.moveTo(cx, cy - 9); ctx.lineTo(cx, cy - 3.5)
  ctx.moveTo(cx, cy + 3.5); ctx.lineTo(cx, cy + 9)
  ctx.stroke()
  ctx.restore()

  // Rope launch preview — where the rope will ACTUALLY fire: clamped to the upper
  // hemisphere and flipped to the side opposite your last rope. Lets you see the
  // "reverse angle" before you commit (cyan, distinct from the weapon reticle).
  const rd = engine.ropeLaunchDir()
  const rl = 60
  ctx.save()
  ctx.setLineDash([2, 6])
  ctx.lineWidth = 1.4
  ctx.strokeStyle = 'rgba(126,224,255,0.8)'
  ctx.beginPath()
  ctx.moveTo(w.x + rd.dx * (WORM_RADIUS + 5), w.y + rd.dy * (WORM_RADIUS + 5))
  ctx.lineTo(w.x + rd.dx * rl, w.y + rd.dy * rl)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = 'rgba(180,230,255,0.95)'
  ctx.beginPath(); ctx.arc(w.x + rd.dx * rl, w.y + rd.dy * rl, 2.6, 0, Math.PI * 2); ctx.fill()
  ctx.restore()

  // power meter grows out of the worm while charging the throw
  if (engine.charging) {
    const pw = 52, ph = 6
    const bx = w.x - pw / 2, by = w.y - WORM_RADIUS - 32
    ctx.save()
    rdr_roundRect(ctx, bx - 1, by - 1, pw + 2, ph + 2, 4)
    ctx.fillStyle = 'rgba(6,10,18,0.8)'; ctx.fill()
    const p = Math.max(0, Math.min(1, engine.power))
    rdr_roundRect(ctx, bx, by, pw * p, ph, 3)
    const g = ctx.createLinearGradient(bx, 0, bx + pw, 0)
    g.addColorStop(0, '#5ad17a'); g.addColorStop(0.55, '#ffd23a'); g.addColorStop(1, '#ff5b5b')
    ctx.fillStyle = g; ctx.fill()
    rdr_roundRect(ctx, bx, by, pw, ph, 3)
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1; ctx.stroke()
    ctx.restore()
  }
}


// ───────────────── RENDERER (composes the layers) ─────────────────
export class Renderer {
  #ctx: CanvasRenderingContext2D
  // Cached visual terrain at world resolution; rebuilt when the engine changes.
  #terrain: HTMLCanvasElement | null = null
  #tctx: CanvasRenderingContext2D | null = null
  // The atmosphere backdrop is expensive (full-screen gradients, parallax ridges,
  // star/cloud fields, vignette + grade passes) but essentially static, so it's
  // baked to an offscreen canvas once per arena and blitted each frame instead of
  // being rebuilt 60×/sec. This is the single biggest per-frame saving.
  #atmo: HTMLCanvasElement | null = null
  #forEngine: RoperEngine | null = null

  constructor(ctx: CanvasRenderingContext2D) { this.#ctx = ctx }

  /** Rebuild the terrain + atmosphere bitmaps for a new arena, or punch out
   *  craters that accumulated since the last frame. Call once per frame before
   *  draw(). */
  sync(engine: RoperEngine): void {
    if (engine !== this.#forEngine) {
      this.#terrain = buildTerrainCanvas(engine)
      this.#tctx = this.#terrain.getContext('2d')
      this.#atmo = document.createElement('canvas')
      this.#atmo.width = engine.width; this.#atmo.height = engine.height
      const actx = this.#atmo.getContext('2d')
      if (actx) drawAtmosphere(actx, engine, 0)
      this.#forEngine = engine
    }
    if (engine.craterQueue.length && this.#tctx) {
      for (const c of engine.craterQueue) punchCrater(this.#tctx, c.x, c.y, c.r)
      engine.craterQueue.length = 0
    }
  }

  draw(engine: RoperEngine, time: number): void {
    const ctx = this.#ctx
    if (this.#atmo) ctx.drawImage(this.#atmo, 0, 0)
    if (this.#terrain) ctx.drawImage(this.#terrain, 0, 0)
    // (No water — the arena is a fully sealed rock box, not an island.)
    for (const w of engine.worms) if (w.alive) drawWorm(ctx, engine, w, w === engine.active, time)
    if (engine.rope && engine.active) drawRope(ctx, engine, time)
    for (const p of engine.projectiles) drawProjectile(ctx, p, time)
    for (const p of engine.particles) drawParticle(ctx, p)
    for (const b of engine.blasts) drawBlast(ctx, b, time)
    if (engine.state !== 'over') drawAim(ctx, engine)
    drawHUD(ctx, engine, time)
  }
}
