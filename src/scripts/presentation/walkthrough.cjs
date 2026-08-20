// A worked example: one tile becomes a hierarchy, verb by verb.
//
// The verbs reel (verbs.cjs) shows the three movements in the abstract. This
// piece walks ONE concrete concept — planning a neighborhood bakery — from a
// single tile to a three-level plan, and shows the machinery honestly: every
// verb is typed at the command line, minted as an ask, and answered by a
// Claude session parked on the bridge. Tiles carry drawn vector art (no text
// inside the art — the platform labels tiles), in the shell's honey palette.
//
// Same shell, same narrator and the same audio contract as the last rendered
// full presentation (en-US-AndrewMultilingualNeural at +2%, cached by the
// words), so a line can change without re-voicing the rest.
//
//   node walkthrough.cjs              → walkthrough/hypercomb-walkthrough.mp4
//   node walkthrough.cjs --frames     → draw the frames only, no encode
//   node walkthrough.cjs --check id t → one frame of beat `id` at time t, as png
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')

const ROOT = __dirname
const OUT = path.join(ROOT, 'walkthrough')
const WORK = path.join(OUT, 'frames')
const CACHE = path.join(ROOT, 'audio-cache')          // the SAME cache the full build fills
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const VOICE = 'en-US-AndrewMultilingualNeural'
const RATE = '+2%'
const W = 1280, H = 720
const FPS = 12
const TAIL = 0.6
let STRIP_ROWS = 12

for (const d of [OUT, WORK, CACHE]) fs.mkdirSync(d, { recursive: true })

const shell = fs.readFileSync(path.join(ROOT, 'template.html'), 'utf8')
const STYLE = (shell.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || ''

// ---------- geometry ---------------------------------------------------------
const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x
const easeOut = x => 1 - Math.pow(1 - clamp01(x), 3)
const easeInOut = x => (x = clamp01(x)) < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
const lerp = (a, b, t) => a + (b - a) * t

function hexPoints(cx, cy, r) {
  const p = []
  for (let k = 0; k < 6; k++) {
    const a = Math.PI / 180 * (90 + k * 60)
    p.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy - r * Math.sin(a)).toFixed(1)}`)
  }
  return p.join(' ')
}
const link = (x1, y1, x2, y2, op) => op <= 0.01 ? '' :
  `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" ` +
  `stroke="var(--honey-deep)" stroke-width="1.6" opacity="${(op * 0.5).toFixed(3)}"/>`

// ---------- the art -----------------------------------------------------------
// Flat vector glyphs in a 100x100 box, honey palette only. NO text in the art —
// tile labels are drawn by the shell, outside the glyph.
const D = '#7d5107'                                    // honey-deep outline
const A = '#e0a520'                                    // honey-bright body
const C = '#fdf6e3'                                    // cream
const SW = 4.5
const s0 = `fill="none" stroke="${D}" stroke-width="${SW}" stroke-linecap="round" stroke-linejoin="round"`
const sA = `fill="${A}" stroke="${D}" stroke-width="${SW}" stroke-linejoin="round"`
const sC = `fill="${C}" stroke="${D}" stroke-width="${SW}" stroke-linejoin="round"`
const dot = (x, y, r = 2.6) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${D}"/>`

const ART = {
  bakery: `
    <rect x="16" y="44" width="68" height="38" rx="3" ${sC}/>
    <path d="M12 26 h76 v10 h-76 z" ${sA}/>
    <path d="M12 36 a9.5 9.5 0 0 0 19 0 a9.5 9.5 0 0 0 19 0 a9.5 9.5 0 0 0 19 0 a9.5 9.5 0 0 0 19 0" ${sA}/>
    <rect x="42" y="58" width="16" height="24" rx="2" ${sA}/>
    <rect x="22" y="58" width="13" height="13" rx="1.5" fill="#fff" stroke="${D}" stroke-width="${SW}"/>
    <rect x="65" y="58" width="13" height="13" rx="1.5" fill="#fff" stroke="${D}" stroke-width="${SW}"/>`,
  recipes: `
    <path d="M18 46 a32 32 0 0 0 64 0 z" ${sC}/>
    <path d="M30 46 q20 -8 40 0" ${s0}/>
    <path d="M60 40 L82 18" ${s0}/>
    <ellipse cx="84" cy="16" rx="7" ry="5" transform="rotate(45 84 16)" ${sA}/>`,
  equipment: `
    <rect x="20" y="20" width="60" height="60" rx="5" ${sC}/>
    <rect x="28" y="38" width="44" height="30" rx="3" ${sA}/>
    <path d="M28 28 h12 M46 28 h8 M60 28 h12" ${s0}/>`,
  space: `
    <rect x="20" y="22" width="60" height="56" rx="2" ${sC}/>
    <path d="M20 50 h22 M56 50 h24 M56 50 v28" ${s0}/>
    <path d="M42 50 a14 14 0 0 1 14 -14" fill="none" stroke="${D}" stroke-width="3" stroke-dasharray="4 4"/>
    <circle cx="36" cy="66" r="7" ${sA}/>`,
  paperwork: `
    <path d="M30 16 h32 l12 12 v56 h-44 z" ${sC}/>
    <path d="M62 16 v12 h12" ${s0}/>
    <path d="M38 40 h24 M38 50 h24 M38 60 h14" ${s0}/>
    <circle cx="64" cy="68" r="9" ${sA}/>`,
  opening: `
    <path d="M14 24 q36 18 72 0" ${s0}/>
    <path d="M24 27 l6 14 l8 -11 z" ${sA}/>
    <path d="M44 31 l6 14 l8 -11 z" ${sC}/>
    <path d="M64 29 l6 14 l8 -11 z" ${sA}/>
    <path d="M14 58 q36 18 72 0" ${s0}/>
    <path d="M28 61 l6 14 l8 -11 z" ${sC}/>
    <path d="M48 65 l6 13 l8 -10 z" ${sA}/>
    <path d="M66 62 l6 14 l8 -11 z" ${sC}/>`,
  sourdough: `
    <path d="M14 62 a36 26 0 0 1 72 0 a36 14 0 0 1 -72 0 z" ${sA}/>
    <path d="M36 40 q6 10 0 20 M50 36 q6 12 0 24 M64 40 q6 10 0 20" fill="none" stroke="${C}" stroke-width="4" stroke-linecap="round"/>`,
  baguette: `
    <path d="M16 70 q-6 -8 4 -14 l46 -30 q12 -6 18 4 q6 10 -6 16 l-46 28 q-10 4 -16 -4 z" ${sA}/>
    <path d="M34 56 l10 -8 M46 48 l10 -8 M58 40 l10 -8" fill="none" stroke="${C}" stroke-width="4" stroke-linecap="round"/>`,
  croissant: `
    <ellipse cx="15" cy="60" rx="8" ry="5.5" transform="rotate(-48 15 60)" ${sA}/>
    <ellipse cx="85" cy="60" rx="8" ry="5.5" transform="rotate(48 85 60)" ${sA}/>
    <ellipse cx="30" cy="52" rx="13" ry="9.5" transform="rotate(-26 30 52)" ${sA}/>
    <ellipse cx="70" cy="52" rx="13" ry="9.5" transform="rotate(26 70 52)" ${sA}/>
    <ellipse cx="50" cy="46" rx="17" ry="13.5" ${sA}/>`,
  rye: `
    <ellipse cx="50" cy="52" rx="34" ry="24" ${sA}/>
    ${dot(38, 46)}${dot(52, 42)}${dot(64, 50)}${dot(44, 58)}${dot(58, 60)}`,
  focaccia: `
    <rect x="18" y="26" width="64" height="48" rx="10" ${sA}/>
    ${dot(34, 40, 3.4)}${dot(52, 36, 3.4)}${dot(66, 44, 3.4)}${dot(30, 58, 3.4)}${dot(48, 56, 3.4)}${dot(64, 62, 3.4)}
    <path d="M40 66 q4 -8 12 -10 m-8 4 l-4 -4 m8 0 l-2 -5" fill="none" stroke="${D}" stroke-width="3" stroke-linecap="round"/>`,
  brioche: `
    <circle cx="50" cy="42" r="13" ${sC}/>
    <path d="M20 78 q-10 -20 12 -25 h36 q22 5 12 25 z" ${sA}/>
    <path d="M36 60 v14 M50 61 v15 M64 60 v14" fill="none" stroke="${D}" stroke-width="3" stroke-linecap="round"/>`,
  cinnamonroll: `
    <circle cx="50" cy="50" r="30" ${sA}/>
    <path d="M50 50 m0 -18 a18 18 0 1 1 -18 18 a13 13 0 1 0 13 -13 a8 8 0 1 1 -8 8" fill="none" stroke="${D}" stroke-width="${SW}" stroke-linecap="round"/>`,
  bagel: `
    <circle cx="50" cy="50" r="30" ${sA}/>
    <circle cx="50" cy="50" r="11" fill="var(--bg)" stroke="${D}" stroke-width="${SW}"/>
    ${dot(34, 34)}${dot(58, 28)}${dot(70, 46)}${dot(30, 58)}`,
  seededloaf: `
    <path d="M20 52 h60 v20 a4 4 0 0 1 -4 4 h-52 a4 4 0 0 1 -4 -4 z" ${sC}/>
    <path d="M20 52 a30 22 0 0 1 60 0 z" ${sA}/>
    ${dot(38, 42)}${dot(52, 36)}${dot(62, 44)}`,
  scone: `
    <path d="M50 20 l34 56 a6 6 0 0 1 -6 6 h-56 a6 6 0 0 1 -6 -6 z" ${sA}/>
    ${dot(50, 48)}${dot(40, 64)}${dot(60, 62)}`,
  ciabatta: `
    <ellipse cx="50" cy="52" rx="36" ry="20" ${sA}/>
    <path d="M28 46 h14 M54 42 h16 M36 58 h20" fill="none" stroke="${C}" stroke-width="4" stroke-linecap="round"/>`,
  fougasse: `
    <path d="M50 16 q30 14 24 44 q-4 20 -24 24 q-20 -4 -24 -24 q-6 -30 24 -44 z" ${sA}/>
    <path d="M50 34 v14 M40 46 l-8 12 M60 46 l8 12 M44 66 l-4 8 M56 66 l4 8" fill="none" stroke="${C}" stroke-width="4" stroke-linecap="round"/>`,
  breads: `
    <path d="M18 58 a32 22 0 0 1 64 0 v10 a4 4 0 0 1 -4 4 h-56 a4 4 0 0 1 -4 -4 z" ${sA}/>
    <path d="M34 44 q4 8 0 16 M50 40 q4 10 0 20 M66 44 q4 8 0 16" fill="none" stroke="${C}" stroke-width="4" stroke-linecap="round"/>`,
  pastries: `
    <ellipse cx="15" cy="60" rx="8" ry="5.5" transform="rotate(-48 15 60)" ${sC}/>
    <ellipse cx="85" cy="60" rx="8" ry="5.5" transform="rotate(48 85 60)" ${sC}/>
    <ellipse cx="30" cy="52" rx="13" ry="9.5" transform="rotate(-26 30 52)" ${sC}/>
    <ellipse cx="70" cy="52" rx="13" ry="9.5" transform="rotate(26 70 52)" ${sC}/>
    <ellipse cx="50" cy="46" rx="17" ry="13.5" ${sC}/>`,
  signature: `
    <path d="M50 84 v-44" ${s0}/>
    <path d="M50 44 q-14 -4 -16 -18 q14 2 16 18 z" ${sA}/>
    <path d="M50 44 q14 -4 16 -18 q-14 2 -16 18 z" ${sA}/>
    <path d="M50 60 q-12 -4 -14 -16 q12 2 14 16 z" ${sA}/>
    <path d="M50 60 q12 -4 14 -16 q-12 2 -14 16 z" ${sA}/>`,
  starter: `
    <path d="M30 34 h40 v40 a8 8 0 0 1 -8 8 h-24 a8 8 0 0 1 -8 -8 z" ${sC}/>
    <rect x="26" y="24" width="48" height="10" rx="3" ${sA}/>
    <path d="M30 56 h40" ${s0}/>
    <circle cx="42" cy="66" r="3.4" fill="none" stroke="${D}" stroke-width="3"/>
    <circle cx="56" cy="70" r="2.6" fill="none" stroke="${D}" stroke-width="3"/>
    <circle cx="52" cy="62" r="2" fill="none" stroke="${D}" stroke-width="3"/>`,
  schedule: `
    <circle cx="50" cy="52" r="30" ${sC}/>
    <path d="M50 34 v18 l12 8" ${s0}/>
    <path d="M30 20 l-10 8 M70 20 l10 8" ${s0}/>`,
  shaping: `
    <circle cx="50" cy="52" r="18" ${sA}/>
    <path d="M20 40 q10 18 8 30 M80 40 q-10 18 -8 30" ${s0}/>
    <path d="M42 30 q8 -6 16 0" ${s0}/>`,
  scoring: `
    <path d="M18 64 a32 22 0 0 1 64 0 a32 12 0 0 1 -64 0 z" ${sA}/>
    <path d="M36 50 l26 -8" fill="none" stroke="${C}" stroke-width="5" stroke-linecap="round"/>
    <path d="M60 24 l20 -8" ${s0}/>
    <rect x="70" y="10" width="14" height="8" rx="2" transform="rotate(-22 77 14)" ${sC}/>`,
  bake: `
    <path d="M22 82 v-30 a28 28 0 0 1 56 0 v30" ${sC}/>
    <path d="M14 82 h72" ${s0}/>
    <path d="M38 66 q-4 -8 2 -12 q6 -4 4 -12 M58 66 q-4 -8 2 -12 q6 -4 4 -12" fill="none" stroke="${A}" stroke-width="${SW}" stroke-linecap="round"/>`,
}
const spark = (x, y, r, fill = '#fff') =>
  `<path d="M${x} ${y - r} L${x + r * .28} ${y - r * .28} L${x + r} ${y} L${x + r * .28} ${y + r * .28} L${x} ${y + r} L${x - r * .28} ${y + r * .28} L${x - r} ${y} L${x - r * .28} ${y - r * .28} Z" fill="${fill}"/>`

// ---------- tiles -------------------------------------------------------------
// honey fill marks what a verb JUST MADE; white is what was already there.
function tile(cx, cy, r, art, o = {}) {
  const op = o.op ?? 1
  if (r <= 0.5 || op <= 0.004) return ''
  let s = `<polygon points="${hexPoints(cx, cy, r)}" fill="${o.made ? 'var(--honey-glow)' : '#fff'}" ` +
    `stroke="${o.made ? 'var(--honey)' : 'var(--honey-deep)'}" stroke-width="${o.sw ?? 2}" opacity="${op.toFixed(3)}"/>`
  if (art && ART[art]) {
    const box = r * 1.12
    s += `<g transform="translate(${(cx - box / 2).toFixed(1)},${(cy - box / 2).toFixed(1)}) scale(${(box / 100).toFixed(4)})" opacity="${op.toFixed(3)}">${ART[art]}</g>`
  }
  if (o.label) {
    const fs_ = o.labelSize ?? 14
    s += `<text x="${cx.toFixed(1)}" y="${(cy + r + fs_ + 8).toFixed(1)}" text-anchor="middle" ` +
      `font-family="Cascadia Code,Consolas,monospace" font-size="${fs_}" fill="var(--dim)" opacity="${op.toFixed(3)}">${o.label}</text>`
  }
  return s
}

// ---------- the bridge furniture ---------------------------------------------
// The command line, the ask in flight, and the parked session badge — the same
// three pieces in every verb beat, because the mechanism is the same.
const BADGE = { x: 1078, y: 92 }
function badge(t, o = {}) {
  const op = easeOut((t - (o.from ?? 0)) / 0.15)
  if (op <= 0.01) return ''
  let s = ''
  if (o.pulseFrom != null && t > o.pulseFrom) {
    const frac = ((t - o.pulseFrom) * (o.pulseSpeed ?? 6)) % 1
    s += `<circle cx="${BADGE.x - 82}" cy="${BADGE.y}" r="${(9 + 22 * frac).toFixed(1)}" fill="none" ` +
      `stroke="var(--honey)" stroke-width="2" opacity="${((1 - frac) * 0.55 * op).toFixed(3)}"/>`
  }
  s += `<rect x="${BADGE.x - 104}" y="${BADGE.y - 19}" width="208" height="38" rx="19" fill="#fff" ` +
    `stroke="var(--honey-deep)" stroke-width="1.6" opacity="${op.toFixed(3)}"/>` +
    `<circle cx="${BADGE.x - 82}" cy="${BADGE.y}" r="9" fill="var(--honey-bright)" opacity="${op.toFixed(3)}"/>` +
    `<g opacity="${op.toFixed(3)}">${spark(BADGE.x - 82, BADGE.y, 5.5)}</g>` +
    `<text x="${BADGE.x - 66}" y="${BADGE.y + 4.5}" font-family="Cascadia Code,Consolas,monospace" ` +
    `font-size="12" fill="var(--dim)" opacity="${op.toFixed(3)}">parked claude session</text>`
  return s
}
function bar(text, t, o = {}) {
  const from = o.from ?? 0.05, typedBy = o.typedBy ?? 0.5
  const y = o.y ?? 500, cx = 640, w = 460, h = 50
  const op = easeOut((t - from) / 0.12)
  if (op <= 0.01) return ''
  const n = Math.floor(clamp01((t - (from + 0.06)) / (typedBy - from - 0.06)) * text.length)
  const typed = text.slice(0, n)
  const done = n >= text.length
  const caretOn = Math.floor(t * 46) % 2 === 0
  let s = `<rect x="${cx - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="10" fill="#fff" ` +
    `stroke="${done && o.flashAt != null && t > o.flashAt ? 'var(--honey)' : 'var(--line)'}" ` +
    `stroke-width="${done && o.flashAt != null && t > o.flashAt ? 2.2 : 1.6}" opacity="${op.toFixed(3)}"/>` +
    `<text x="${cx - w / 2 + 22}" y="${y + 6}" font-family="Cascadia Code,Consolas,monospace" font-size="19" ` +
    `fill="var(--honey)" opacity="${op.toFixed(3)}">&#10095;</text>` +
    `<text x="${cx - w / 2 + 46}" y="${y + 6.5}" font-family="Cascadia Code,Consolas,monospace" font-size="18.5" ` +
    `fill="var(--ink)" opacity="${op.toFixed(3)}">${typed}${caretOn && !done ? '▌' : ''}</text>`
  return s
}
// the ask itself: a small honey hex that flies from the bar to the badge
function askFlight(t, from, to_, o = {}) {
  const u = easeInOut((t - from) / (to_ - from))
  if (u <= 0.001 || u >= 0.999) return ''
  const P0 = { x: 870, y: o.fromY ?? 500 }, P1 = { x: BADGE.x - 82, y: BADGE.y }
  const Pc = { x: (P0.x + P1.x) / 2 + 90, y: Math.min(P0.y, P1.y) - 120 }
  const x = (1 - u) * (1 - u) * P0.x + 2 * (1 - u) * u * Pc.x + u * u * P1.x
  const y = (1 - u) * (1 - u) * P0.y + 2 * (1 - u) * u * Pc.y + u * u * P1.y
  return `<polygon points="${hexPoints(x, y, 13)}" fill="var(--honey-bright)" stroke="var(--honey-deep)" stroke-width="2"/>` +
    spark(x, y, 6.5)
}

// ---------- the cast ----------------------------------------------------------
const PARTS = [
  { art: 'recipes', label: 'recipes' }, { art: 'equipment', label: 'equipment' },
  { art: 'space', label: 'the space' }, { art: 'paperwork', label: 'paperwork' },
  { art: 'opening', label: 'opening day' },
]
// the recipes shelf, in the slot order the verbs leave it in
const SHELF = [
  { art: 'sourdough', label: 'sourdough', old: 0 }, { art: 'rye', label: 'rye' },
  { art: 'focaccia', label: 'focaccia' }, { art: 'baguette', label: 'baguette', old: 1 },
  { art: 'brioche', label: 'brioche' }, { art: 'cinnamonroll', label: 'cinnamon roll' },
  { art: 'croissant', label: 'croissant', old: 2 }, { art: 'bagel', label: 'bagel' },
  { art: 'seededloaf', label: 'seeded loaf' }, { art: 'scone', label: 'scone' },
  { art: 'ciabatta', label: 'ciabatta' }, { art: 'fougasse', label: 'fougasse' },
]
const GROUPS = [
  { art: 'breads', label: 'breads', members: [0, 3, 1, 8, 10] },
  { art: 'pastries', label: 'pastries', members: [6, 4, 5, 9] },
  { art: 'signature', label: 'signature', members: [2, 7, 11] },
]
const SOUR = [
  { art: 'starter', label: 'starter' }, { art: 'schedule', label: 'schedule' },
  { art: 'shaping', label: 'shaping' }, { art: 'scoring', label: 'scoring' },
  { art: 'bake', label: 'the bake' },
]
const trioAt = i => ({ x: 640 + (i - 1) * 190, y: 330, r: 62 })            // shelf before expand
const shelf8At = i => ({ x: 640 + (i - 3.5) * 140, y: 330, r: 48 })        // shelf after expand
const grid12At = i => {                                                    // the crowded shelf
  const row = i < 7 ? 0 : 1, col = row ? i - 7 : i
  return { x: 640 + (col - 3) * 96 + (row ? 48 : 0), y: row ? 396 : 312, r: 40 }
}
const groupAt = g => ({ x: 640 + (g - 1) * 300, y: 196, r: 52 })
const memberAt = (g, j, n) => ({ x: 640 + (g - 1) * 300 + (j - (n - 1) / 2) * 64, y: 388, r: 29 })

// ---------- the movements -----------------------------------------------------
function drawSeed(t) {
  const e = easeOut(t / 0.3)
  const pulse = t > 0.5 ? ((t - 0.5) * 3) % 1 : 1
  let s = ''
  if (t > 0.5) s += `<polygon points="${hexPoints(640, 320, 100 + 26 * pulse)}" fill="none" ` +
    `stroke="var(--honey)" stroke-width="1.6" opacity="${((1 - pulse) * 0.4).toFixed(3)}"/>`
  s += tile(640, 320, 100 * e, 'bakery', { sw: 2.6, op: e, label: 'the bakery', labelSize: 17 })
  return s
}
function drawAskBreakApart(t) {
  let s = tile(640, 268, 84, 'bakery', { sw: 2.4, label: 'the bakery', labelSize: 15 })
  s += bar('/break-apart', t, { from: 0.06, typedBy: 0.42, flashAt: 0.46 })
  s += badge(t, { from: 0.38, pulseFrom: 0.72, pulseSpeed: 3 })
  s += askFlight(t, 0.5, 0.72)
  return s
}
function drawBreakApart(t) {
  const PX = 640, PY = 168, PR = 58
  let s = badge(t, { pulseFrom: 0, pulseSpeed: 3 })
  for (let i = 0; i < 5; i++) {
    const e = easeOut((t - (0.14 + i * 0.1)) / 0.24)
    if (e <= 0) continue
    const cx = 640 + (i - 2) * 150, cy = 420 - 20 * (1 - e)
    s += link(PX, PY + PR, cx, cy - 52 * e, e)
  }
  s += tile(PX, PY, PR, 'bakery', { sw: 2.4 })
  for (let i = 0; i < 5; i++) {
    const e = easeOut((t - (0.14 + i * 0.1)) / 0.24)
    if (e <= 0) continue
    s += tile(640 + (i - 2) * 150, 420 - 20 * (1 - e), 52 * e, PARTS[i].art,
      { made: true, op: e, label: e > 0.85 ? PARTS[i].label : '' })
  }
  return s
}
function drawTravel(t) {
  // dive into the recipes tile; its inside fades up around us
  const zoom = 1 + 2.6 * easeInOut((t - 0.12) / 0.5)
  const fade = 1 - easeInOut((t - 0.42) / 0.25)
  const P = { x: 640 + (0 - 2) * 150, y: 420 }                             // recipes' place on the old layer
  let s = ''
  if (fade > 0.01) {
    s += `<g transform="translate(${(640 - zoom * P.x).toFixed(1)},${(340 - zoom * P.y).toFixed(1)}) scale(${zoom.toFixed(3)})" opacity="${fade.toFixed(3)}">`
    s += link(640, 226, P.x, P.y - 52, 1)
    for (let i = 1; i < 5; i++) s += link(640, 226, 640 + (i - 2) * 150, 368, 1) +
      tile(640 + (i - 2) * 150, 420, 52, PARTS[i].art, {})
    s += tile(640, 168, 58, 'bakery', { sw: 2.4 })
    s += tile(P.x, P.y, 52, 'recipes', { sw: 2.6 })
    s += `</g>`
  }
  const inOp = easeOut((t - 0.5) / 0.25)
  if (inOp > 0.01) {
    const grow = lerp(0.82, 1, easeOut((t - 0.5) / 0.35))
    s += `<g transform="translate(${(640 * (1 - grow)).toFixed(1)},${(340 * (1 - grow)).toFixed(1)}) scale(${grow.toFixed(3)})" opacity="${inOp.toFixed(3)}">`
    for (let i = 0; i < 3; i++) {
      const p = trioAt(i)
      s += tile(p.x, p.y, p.r, SHELF[[0, 3, 6][i]].art, { sw: 2.2, label: SHELF[[0, 3, 6][i]].label })
    }
    s += `</g>`
  }
  return s
}
function drawExpand(t) {
  let s = bar('/expand', t, { from: 0.03, typedBy: 0.2, flashAt: 0.23, y: 520 })
  s += badge(t, { pulseFrom: 0.36, pulseSpeed: 3 })
  s += askFlight(t, 0.24, 0.38, { fromY: 520 })
  const spread = easeInOut((t - 0.34) / 0.24)
  for (let i = 0; i < 12; i++) {
    if (i > 7) continue
    const at = shelf8At(i), old = SHELF[i].old
    if (old != null) {                                                     // was already there — it travels
      const o = trioAt(old)
      s += tile(lerp(o.x, at.x, spread), lerp(o.y, at.y, spread), lerp(o.r, at.r, spread),
        SHELF[i].art, { sw: 2.2, label: spread > 0.9 || spread < 0.1 ? SHELF[i].label : '', labelSize: 12.5 })
    } else {                                                               // the sibling the shelf was missing
      const e = easeOut((t - (0.5 + [1, 2, 4, 5, 7].indexOf(i) * 0.085)) / 0.2)
      if (e <= 0) continue
      s += tile(at.x, at.y, at.r * e, SHELF[i].art, { made: true, op: e, label: e > 0.85 ? SHELF[i].label : '', labelSize: 12.5 })
    }
  }
  return s
}
function drawCrowded(t) {
  let s = badge(t, { pulseFrom: 0.05, pulseSpeed: 3 })
  const m = easeInOut((t - 0.14) / 0.3)
  for (let i = 0; i < 12; i++) {
    if (i < 8) {
      const a = shelf8At(i), b = grid12At(i)
      s += tile(lerp(a.x, b.x, m), lerp(a.y, b.y, m), lerp(a.r, b.r, m), SHELF[i].art, { sw: 2 })
    } else {
      const e = easeOut((t - (0.42 + (i - 8) * 0.1)) / 0.22)
      if (e <= 0) continue
      const p = grid12At(i)
      s += tile(p.x, p.y, p.r * e, SHELF[i].art, { made: true, op: e })
    }
  }
  return s
}
function drawOrganize(t) {
  let s = bar('/organize', t, { from: 0.03, typedBy: 0.18, flashAt: 0.21, y: 520 })
  s += badge(t, { pulseFrom: 0.32, pulseSpeed: 3 })
  s += askFlight(t, 0.22, 0.34, { fromY: 520 })
  const groupIn = easeOut((t - 0.34) / 0.18)
  GROUPS.forEach((G, g) => {
    const q = groupAt(g)
    G.members.forEach((idx, j) => {
      const m = easeInOut((t - (0.46 + j * 0.05 + g * 0.02)) / 0.34)
      if (m <= 0) return
      const p = memberAt(g, j, G.members.length), f = grid12At(idx)
      s += link(q.x, q.y + q.r, lerp(f.x, p.x, m), lerp(f.y, p.y, m) - p.r, m * m)
    })
  })
  GROUPS.forEach((G, g) => {
    const q = groupAt(g)
    if (groupIn > 0) s += tile(q.x, q.y, q.r * groupIn, G.art,
      { made: true, op: groupIn, label: groupIn > 0.85 ? G.label : '', labelSize: 14 })
    G.members.forEach((idx, j) => {
      const m = easeInOut((t - (0.46 + j * 0.05 + g * 0.02)) / 0.34)
      const p = memberAt(g, j, G.members.length), f = grid12At(idx)
      s += tile(lerp(f.x, p.x, m), lerp(f.y, p.y, m), lerp(f.r, p.r, m), SHELF[idx].art, { sw: 1.8 })
    })
  })
  return s
}
function drawDeepBreakApart(t) {
  const PX = 640, PY = 168, PR = 56
  let s = badge(t, { pulseFrom: 0.05, pulseSpeed: 3 })
  for (let i = 0; i < 5; i++) {
    const e = easeOut((t - (0.2 + i * 0.1)) / 0.24)
    if (e <= 0) continue
    const cx = 640 + (i - 2) * 150, cy = 420 - 20 * (1 - e)
    s += link(PX, PY + PR, cx, cy - 48 * e, e)
  }
  s += tile(PX, PY, PR, 'sourdough', { sw: 2.4, label: 'sourdough', labelSize: 14 })
  for (let i = 0; i < 5; i++) {
    const e = easeOut((t - (0.2 + i * 0.1)) / 0.24)
    if (e <= 0) continue
    s += tile(640 + (i - 2) * 150, 420 - 20 * (1 - e), 48 * e, SOUR[i].art,
      { made: true, op: e, label: e > 0.85 ? SOUR[i].label : '' })
  }
  return s
}
function drawMap(t) {
  // the whole plan, level by level — nothing is being made; this is a look back
  const lv = k => easeOut((t - k) / 0.16)
  let s = ''
  const root = { x: 640, y: 144, r: 34 }
  const l2 = [{ x: 300 }, { x: 520 }, { x: 700 }, { x: 880 }, { x: 1060 }].map((p, i) =>
    ({ x: p.x, y: 240, r: 26, art: PARTS[i].art, label: PARTS[i].label }))
  const gx = [170, 330, 510]
  const e1 = lv(0.04), e2 = lv(0.2), e3 = lv(0.38), e4 = lv(0.54), e5 = lv(0.7)
  l2.forEach(p => { s += link(root.x, root.y + root.r, p.x, p.y - p.r, Math.min(e2, 1)) })
  GROUPS.forEach((G, g) => {
    if (e3 <= 0) return
    s += link(l2[0].x, l2[0].y + l2[0].r, gx[g], 330 - 20, e3)
    G.members.forEach((idx, j) => {
      if (e4 <= 0) return
      const x = gx[g] + (j - (G.members.length - 1) / 2) * 40
      s += link(gx[g], 350, x, 425 - 14, e4)
      if (idx === 0 && e5 > 0) for (let k = 0; k < 5; k++)
        s += link(x, 439, x - 64 + k * 32 + 64, 505 - 10, e5)                // sourdough's parts
    })
  })
  s += tile(root.x, root.y, root.r * e1, 'bakery', { op: e1, sw: 2.2, label: 'the bakery', labelSize: 13 })
  l2.forEach(p => { if (e2 > 0) s += tile(p.x, p.y, p.r * e2, p.art, { op: e2, label: p.label, labelSize: 11 }) })
  GROUPS.forEach((G, g) => {
    if (e3 <= 0) return
    s += tile(gx[g], 330, 22 * e3, G.art, { op: e3 })
    G.members.forEach((idx, j) => {
      if (e4 <= 0) return
      const x = gx[g] + (j - (G.members.length - 1) / 2) * 40
      s += tile(x, 425, 15 * e4, SHELF[idx].art, { op: e4, sw: 1.4 })
      if (idx === 0 && e5 > 0) for (let k = 0; k < 5; k++)
        s += tile(x - 64 + k * 32 + 64, 505, 11 * e5, SOUR[k].art, { op: e5, sw: 1.2 })
    })
  })
  return s
}

const MOVEMENT = {
  seed: drawSeed, askbreakapart: drawAskBreakApart, breakapart: drawBreakApart, travel: drawTravel,
  expand: drawExpand, crowded: drawCrowded, organize: drawOrganize,
  deepbreakapart: drawDeepBreakApart, map: drawMap,
}

// ---------- the reel ----------------------------------------------------------
const BEATS = [
  { id: 'open', kind: 'still',
    body: `<div class="eyebrow">a worked example</div><h1>One tile becomes a <b>world</b>.</h1>
           <p class="sub">Three structural verbs, each one an AI request over the bridge. Let's plan a neighborhood bakery.</p>`,
    say: `Here is how a hive grows. One tile, three verbs, and a Claude session parked on the bridge. Let's plan a neighborhood bakery.` },

  { id: 'seed', kind: 'move', verb: 'the seed', gloss: 'one tile',
    say: `This is the whole hive so far. One tile — the bakery. Everything it will become is still folded inside it.` },

  { id: 'askbreakapart', kind: 'move', verb: '/break-apart', gloss: 'mint the ask',
    say: `Type break apart. The hive doesn't call a model directly — it mints an ask, and the Claude session you have parked on the bridge picks it up.` },

  { id: 'breakapart', kind: 'move', verb: '/break-apart', gloss: 'go deeper',
    say: `The session reads the tile and answers with its parts. Recipes. Equipment. The space. Paperwork. Opening day. Break apart goes deeper — one tile becomes the pieces that compose it.` },

  { id: 'travel', kind: 'move', verb: 'recipes', gloss: 'travel inside',
    say: `Click a tile and you travel into it. Inside recipes, three ideas are already waiting.` },

  { id: 'expand', kind: 'move', verb: '/expand', gloss: 'go wider',
    say: `Expand goes wider. The ask carries what the layer already holds, so nothing is duplicated — the session adds only the siblings the shelf is missing.` },

  { id: 'crowded', kind: 'move', verb: '/expand', gloss: 'ask again',
    say: `Ask again and the shelf keeps growing. Twelve kinds of dough on one layer — a good problem, but hard to scan.` },

  { id: 'organize', kind: 'move', verb: '/organize', gloss: 'go shallower',
    say: `Organize goes shallower. The session answers with a plan — groups, and where each tile belongs — and the hive applies it. No model ever moves your tiles.` },

  { id: 'deepbreakapart', kind: 'move', verb: '/break-apart', gloss: 'stack the verbs',
    say: `And the verbs stack. Break apart sourdough, and the method fans out beneath it — starter, schedule, shaping, scoring, the bake.` },

  { id: 'map', kind: 'move', verb: 'the plan', gloss: 'three levels deep',
    say: `Step back. One tile is now a working plan, three levels deep — and every level was a request you could read, answered by a session you parked yourself.` },

  { id: 'close', kind: 'still',
    body: `<div class="eyebrow">deeper · shallower · wider</div><h1><b>break apart</b> · <b>organize</b> · <b>expand</b></h1>
           <p class="sub">Say what you mean, and the hive takes that shape.</p>
           <div class="golink" style="margin-top:1.5vh">hypercomb.io</div>`,
    say: `Break apart. Organize. Expand. Say what you mean, and the hive takes that shape.` },
]

// ---------- narration ---------------------------------------------------------
const rulesPath = path.join(ROOT, 'pronunciations.json')
const RULES = fs.existsSync(rulesPath) ? JSON.parse(fs.readFileSync(rulesPath, 'utf8')) : []
const spokenOf = say => RULES.reduce((t, r) => r && r.match && r.say ? t.split(r.match).join(r.say) : t, say)
const audioPath = b => path.join(CACHE,
  crypto.createHash('sha256').update(`${VOICE}|${RATE}|${spokenOf(b.say)}`).digest('hex').slice(0, 16) + '.mp3')

async function ensureAudio() {
  const stale = BEATS.filter(b => !fs.existsSync(audioPath(b)))
  if (!stale.length) { console.log('narration: all lines already cached'); return }
  const { MsEdgeTTS, OUTPUT_FORMAT, ProsodyOptions } = require('msedge-tts')
  for (const b of stale) {
    const tts = new MsEdgeTTS()
    await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
    const pros = new ProsodyOptions(); pros.rate = RATE
    const { audioStream } = await tts.toStream(spokenOf(b.say), pros)
    const chunks = []
    await new Promise((res, rej) => { audioStream.on('data', c => chunks.push(c)); audioStream.on('end', res); audioStream.on('error', rej) })
    fs.writeFileSync(audioPath(b), Buffer.concat(chunks))
    tts.close()
    console.log(`  voiced: ${b.id}`)
  }
}

// ---------- pages -------------------------------------------------------------
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const PAGE_CSS = `${STYLE}
  html,body{width:${W}px;background:var(--bg)}
  .pane{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:var(--bg)}
  .pane svg.comb{position:absolute;inset:0;width:100%;height:100%;opacity:.5}
  .pane svg.stage{position:absolute;inset:0;width:100%;height:100%}
  .frame{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
    gap:22px;padding:64px 90px 210px;text-align:center}
  .frame h1{font-weight:200;font-size:74px;line-height:1.04;margin:0;letter-spacing:-.01em;text-wrap:balance}
  .frame h1 b{font-weight:600;color:var(--honey)}
  .frame .sub{color:var(--dim);font-weight:300;font-size:23px;max-width:60ch;margin:0;text-wrap:balance}
  .frame .eyebrow{font-size:13px}
  .tag{position:absolute;top:40px;left:0;right:0;text-align:center;font-family:var(--mono)}
  .tag b{font-weight:600;font-size:28px;color:var(--honey);letter-spacing:.02em}
  .tag span{display:block;margin-top:7px;font-size:12px;letter-spacing:.42em;text-transform:uppercase;color:var(--faint)}
  #cap{position:absolute;left:50%;bottom:38px;transform:translateX(-50%);width:1060px;text-align:center;
    color:var(--ink);font-weight:400;font-size:24px;line-height:1.42;
    background:rgba(255,255,255,.94);border:1px solid var(--line);border-radius:12px;padding:18px 26px}
  .golink{border-color:var(--honey-deep);color:var(--honey);font-size:15px}`

const COMB = `<svg class="comb"><defs>
  <pattern id="hexp" width="56" height="97" patternUnits="userSpaceOnUse" patternTransform="scale(1.6)">
    <polygon points="28,0 56,16.2 56,48.5 28,64.7 0,48.5 0,16.2" fill="none" stroke="var(--hexline)" stroke-width="1"/>
    <polygon points="28,0 56,16.2 56,48.5 28,64.7 0,48.5 0,16.2" fill="none" stroke="var(--hexline)" stroke-width="1" transform="translate(28,48.5)"/>
    <polygon points="28,0 56,16.2 56,48.5 28,64.7 0,48.5 0,16.2" fill="none" stroke="var(--hexline)" stroke-width="1" transform="translate(-28,48.5)"/>
  </pattern></defs><rect width="120%" height="120%" fill="url(#hexp)"/></svg>`

const paneStill = b => `<div class="pane">${COMB}<div class="frame">${b.body}</div><div id="cap">${esc(b.say)}</div></div>`
const paneMove = (b, t) => `<div class="pane">${COMB}` +
  `<svg class="stage" viewBox="0 0 ${W} ${H}">${MOVEMENT[b.id](t)}</svg>` +
  `<div class="tag"><b>${esc(b.verb)}</b><span>${esc(b.gloss)}</span></div>` +
  `<div id="cap">${esc(b.say)}</div></div>`

const document_ = panes => `<meta charset="utf-8"><style>${PAGE_CSS}</style>${panes.join('')}`

// ---------- shooting ----------------------------------------------------------
function shootStrip(html, rows, stripPng) {
  const htmlPath = stripPng.replace(/\.png$/, '.html')
  fs.writeFileSync(htmlPath, html)
  try { fs.unlinkSync(stripPng) } catch {}
  execFileSync(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
    `--window-size=${W},${H * rows}`, '--virtual-time-budget=4000',
    `--screenshot=${stripPng}`, 'file:///' + htmlPath.split(path.sep).join('/')], { stdio: 'ignore' })
  const deadline = Date.now() + 30_000
  let size = -1
  for (;;) {
    if (Date.now() > deadline) throw new Error(`filmstrip never appeared: ${path.basename(stripPng)}`)
    let s = -1
    try { s = fs.statSync(stripPng).size } catch {}
    if (s > 0 && s === size) break
    size = s
    execFileSync('powershell', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 200'], { stdio: 'ignore' })
  }
  try { fs.unlinkSync(htmlPath) } catch {}
  const h = parseInt(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=height', '-of', 'csv=p=0', stripPng], { encoding: 'utf8' }).trim(), 10)
  return h
}

const ff = (...a) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...a], { stdio: 'inherit' })
const durationOf = f => parseFloat(execFileSync('ffprobe',
  ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim())

function drawMovementFrames(b, motionSeconds) {
  const dir = path.join(WORK, b.id)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  const total = Math.max(2, Math.round(motionSeconds * FPS))
  let done = 0, strip = 0
  while (done < total) {
    for (;;) {
      const rows = Math.min(STRIP_ROWS, total - done)
      const panes = []
      for (let k = 0; k < rows; k++) panes.push(paneMove(b, (done + k) / (total - 1)))
      const png = path.join(dir, `strip-${strip}.png`)
      const got = shootStrip(document_(panes), rows, png)
      if (got < H * rows) {
        if (STRIP_ROWS <= 2) throw new Error('cannot capture even two frames at a time')
        STRIP_ROWS = Math.max(2, Math.floor(STRIP_ROWS / 2))
        console.log(`  (filmstrip came back ${got}px — dropping to ${STRIP_ROWS} frames per shot)`)
        continue
      }
      ff('-i', png, '-vf', `untile=1x${rows}`, '-start_number', String(done + 1),
        path.join(dir, 'f%04d.png'))
      fs.unlinkSync(png)
      done += rows; strip++
      break
    }
  }
  console.log(`  ${b.id}: ${total} frames drawn`)
  return { dir, total }
}

// ---------- assemble ----------------------------------------------------------
;(async () => {
  // single-frame check: node walkthrough.cjs --check breakapart 0.8
  const ci = process.argv.indexOf('--check')
  if (ci > -1) {
    const id = process.argv[ci + 1], t = parseFloat(process.argv[ci + 2] ?? '0.8')
    const b = BEATS.find(x => x.id === id)
    if (!b) throw new Error(`no beat ${id}`)
    const png = path.join(WORK, `check-${id}-${t}.png`)
    shootStrip(document_([b.kind === 'still' ? paneStill(b) : paneMove(b, t)]), 1, png)
    console.log(png)
    return
  }

  console.log('voicing…'); await ensureAudio()
  const framesOnly = process.argv.includes('--frames')

  console.log('drawing…')
  const segs = []
  for (let i = 0; i < BEATS.length; i++) {
    const b = BEATS[i]
    const audio = audioPath(b)
    const dur = durationOf(audio) + TAIL
    const seg = path.join(OUT, `seg-${String(i).padStart(2, '0')}.mp4`)
    const fadeOut = Math.max(1, Math.round(dur * 30) - 12)

    if (b.kind === 'still') {
      if (framesOnly) continue
      const png = path.join(WORK, `${b.id}.png`)
      const got = shootStrip(document_([paneStill(b)]), 1, png)
      if (got < H) throw new Error(`still came back ${got}px`)
      ff('-loop', '1', '-i', png, '-i', audio, '-t', String(dur),
        '-vf', `fps=30,format=yuv420p,fade=in:0:12,fade=out:${fadeOut}:12`,
        '-c:v', 'libx264', '-crf', '21', '-preset', 'medium',
        '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2', '-shortest', seg)
    } else {
      const motion = Math.max(2.5, Math.min(dur - 1.2, 11))
      const { dir, total } = drawMovementFrames(b, motion)
      if (framesOnly) continue
      const hold = Math.max(0.2, dur - total / FPS)
      ff('-framerate', String(FPS), '-i', path.join(dir, 'f%04d.png'), '-i', audio, '-t', String(dur),
        '-vf', `fps=30,tpad=stop_mode=clone:stop_duration=${hold.toFixed(2)},format=yuv420p,` +
               `fade=in:0:12,fade=out:${fadeOut}:12`,
        '-c:v', 'libx264', '-crf', '21', '-preset', 'medium',
        '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2', '-shortest', seg)
    }
    segs.push(seg)
    console.log(`  ${b.id.padEnd(12)} ${dur.toFixed(1)}s`)
  }
  if (framesOnly) { console.log('\nframes only — nothing encoded'); return }

  const list = path.join(OUT, 'segments.txt')
  fs.writeFileSync(list, segs.map(s => `file '${s.replace(/\\/g, '/')}'`).join('\n'))
  const final = path.join(OUT, 'hypercomb-walkthrough.mp4')
  ff('-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', final)
  const total = durationOf(final)
  console.log(`\n${final}\n${total.toFixed(1)}s · ${(fs.statSync(final).size / 1e6).toFixed(1)} MB · ${W}x${H} · H.264/AAC`)
})().catch(e => { console.error('walkthrough failed:', e.message); process.exit(1) })
