// Concept clips — the flow of the experience, drawn.
//
// Three scenes of the deck talk about things live capture cannot show: what
// the words MEAN (scene 8), what verification IS (scene 13), what time FEELS
// like (scene 14). Each gets a drawn concept clip: one continuous world per
// scene, a camera that travels through it, and beats that land on the
// narration's own sentence boundaries — measured from the cached audio with
// silencedetect, so an edited line re-times the clip on the next run.
//
// The clips are silent by design: the deck plays the scene's narration and the
// film pane plays the clip muted from t=0, so matching the audio's length and
// sentence timing is the whole synchronisation contract.
//
// Same filmstrip pipeline as verbs.cjs: many frames per headless launch,
// ffmpeg untile to cut them apart, one encode per clip.
//
//   node concepts.cjs                 → media/concept-{vocabulary,integrity,time}.mp4
//   node concepts.cjs vocabulary      → just that clip
//   node concepts.cjs time --frames   → draw frames only, no encode
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync, spawnSync } = require('child_process')

const ROOT = __dirname
const OUT = path.join(ROOT, 'concepts')
const WORK = path.join(OUT, 'frames')
const MEDIA = path.join(ROOT, 'media')
const CACHE = path.join(ROOT, 'audio-cache')
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const VOICE = 'en-US-AndrewMultilingualNeural'
const RATE = '+2%'
// the filmwrap pane is 960/328 — draw at 1.5× for a crisp downscale
const W = 1440, H = 492
const FPS = 12                       // drawn rate; encoded at 30
const HOLD = 1.6                     // the world keeps breathing after the last word
let STRIP_ROWS = 10

for (const d of [OUT, WORK, MEDIA]) fs.mkdirSync(d, { recursive: true })

// design tokens lifted from the real template, so the clips cannot drift
const shell = fs.readFileSync(path.join(ROOT, 'template.html'), 'utf8')
const STYLE = (shell.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || ''

// ---------- narration timing -------------------------------------------------
// The scene's cached mp3 is the clock. Sentences are found by matching the
// word-count-proportional expectation against the silences the voice actually
// left — clause pauses and sentence pauses overlap in duration, so “nearest
// gap to where the sentence OUGHT to end” beats “longest gaps”.
const RULES = fs.existsSync(path.join(ROOT, 'pronunciations.json'))
  ? JSON.parse(fs.readFileSync(path.join(ROOT, 'pronunciations.json'), 'utf8')) : []
const spokenOf = say => RULES.reduce((t, r) => r && r.match && r.say ? t.split(r.match).join(r.say) : t, say)

function sceneSay(n) {
  const f = path.join(ROOT, 'scenes', `scene-${String(n).padStart(2, '0')}.json`)
  return JSON.parse(fs.readFileSync(f, 'utf8')).say
}
const audioPathOf = say => path.join(CACHE,
  crypto.createHash('sha256').update(`${VOICE}|${RATE}|${spokenOf(say)}`).digest('hex').slice(0, 16) + '.mp3')

function beatTimes(say, beatCount) {
  const audio = audioPathOf(say)
  if (!fs.existsSync(audio)) throw new Error(`no cached narration for this scene — run build.cjs first (${path.basename(audio)})`)
  const dur = parseFloat(execFileSync('ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', audio], { encoding: 'utf8' }).trim())
  const det = spawnSync('ffmpeg', ['-i', audio, '-af', 'silencedetect=noise=-38dB:d=0.25', '-f', 'null', '-'], { encoding: 'utf8' })
  const silences = []
  for (const m of (det.stderr || '').matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)/g))
    silences.push({ start: +m[1], end: +m[2] })
  const trailing = silences.length && Math.abs(silences[silences.length - 1].end - dur) < 0.08
  const speechEnd = trailing ? silences[silences.length - 1].start : dur
  const gaps = silences.filter(s => s.end < dur - 0.08).map(s => s.end)

  const sentences = spokenOf(say).split(/(?<=[.!?])\s+/).filter(s => s.trim())
  if (sentences.length !== beatCount)
    throw new Error(`beat count ${beatCount} != sentence count ${sentences.length}: ${sentences.map(s => s.slice(0, 30)).join(' | ')}`)
  const words = sentences.map(s => s.split(/\s+/).length)
  const total = words.reduce((a, b) => a + b, 0)

  const starts = [0]
  let cum = 0, last = 0
  for (let j = 0; j < beatCount - 1; j++) {
    cum += words[j]
    const expect = cum / total * speechEnd
    const usable = gaps.filter(g => g > last + 0.3)
    const pick = usable.length
      ? usable.reduce((a, b) => Math.abs(b - expect) < Math.abs(a - expect) ? b : a)
      : expect
    starts.push(pick); last = pick
  }
  return { starts, audioDur: dur }
}

// ---------- drawing primitives ----------------------------------------------
const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x
const easeOut = x => 1 - Math.pow(1 - clamp01(x), 3)
const easeInOut = x => (x = clamp01(x)) < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
const lerp = (a, b, t) => a + (b - a) * t
const qbez = (a, c, b, t) => ({
  x: (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * c.x + t * t * b.x,
  y: (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * c.y + t * t * b.y,
})

function hexPoints(cx, cy, r) {
  const p = []
  for (let k = 0; k < 6; k++) {
    const a = Math.PI / 180 * (90 + k * 60)
    p.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy - r * Math.sin(a)).toFixed(1)}`)
  }
  return p.join(' ')
}
// honey fill marks what the moment just made or marked; white is what was there
const hex = (cx, cy, r, o = {}) => r <= 0.5 || (o.op ?? 1) <= 0.004 ? '' :
  `<polygon points="${hexPoints(cx, cy, r)}" fill="${o.fill ?? (o.made ? 'var(--honey-glow)' : '#fff')}" ` +
  `stroke="${o.stroke ?? (o.made ? 'var(--honey)' : 'var(--honey-deep)')}" stroke-width="${o.sw ?? 2}" ` +
  `${o.dash ? `stroke-dasharray="${o.dash}" ` : ''}opacity="${(o.op ?? 1).toFixed(3)}"/>`
const link = (x1, y1, x2, y2, op, o = {}) => op <= 0.01 ? '' :
  `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" ` +
  `stroke="${o.stroke ?? 'var(--honey-deep)'}" stroke-width="${o.sw ?? 1.6}" ` +
  `${o.dash ? `stroke-dasharray="${o.dash}" ` : ''}opacity="${(op * (o.dim ?? 0.5)).toFixed(3)}"/>`
const ring = (cx, cy, r, op, o = {}) => op <= 0.01 || r <= 0.5 ? '' :
  `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="none" ` +
  `stroke="${o.stroke ?? 'var(--honey)'}" stroke-width="${o.sw ?? 2}" ` +
  `${o.dash ? `stroke-dasharray="${o.dash}" ` : ''}opacity="${op.toFixed(3)}"/>`
const txt = (x, y, s, o = {}) => (o.op ?? 1) <= 0.01 ? '' :
  `<text x="${x}" y="${y}" font-family="${o.font ?? "'Cascadia Code','Consolas',monospace"}" ` +
  `font-size="${o.size ?? 13}" fill="${o.fill ?? 'var(--dim)'}" text-anchor="${o.anchor ?? 'middle'}" ` +
  `${o.spacing ? `letter-spacing="${o.spacing}" ` : ''}${o.weight ? `font-weight="${o.weight}" ` : ''}` +
  `opacity="${(o.op ?? 1).toFixed(3)}">${s}</text>`
// content lines inside a tile — the universal “this cell holds something”
function contentLines(cx, cy, e, scale = 1, op = 1) {
  const rows = [[-16, 44, 'var(--honey)', 4.5], [-4, 38, 'var(--faint)', 3], [6, 30, 'var(--faint)', 3], [16, 36, 'var(--faint)', 3]]
  let s = ''
  rows.forEach(([dy, w, c, h], i) => {
    const e2 = easeOut((e - i * 0.14) / 0.5); if (e2 <= 0) return
    s += `<rect x="${cx - w * scale * e2 / 2}" y="${cy + dy * scale}" width="${w * scale * e2}" height="${h * scale}" rx="${h * scale / 2}" fill="${c}" opacity="${(0.85 * op).toFixed(3)}"/>`
  })
  return s
}
function beeGlyph(x, y, ang, T, scale = 1, op = 1) {
  if (op <= 0.01) return ''
  const wing = Math.sin(T * Math.PI * 14) * 26
  return `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${ang.toFixed(1)}) scale(${scale})" opacity="${op.toFixed(3)}">` +
    `<ellipse cx="-3" cy="-8" rx="9" ry="5" fill="rgba(120,138,160,.45)" transform="rotate(${(-20 + wing).toFixed(1)} -3 -8)"/>` +
    `<ellipse cx="-3" cy="8" rx="9" ry="5" fill="rgba(120,138,160,.45)" transform="rotate(${(20 - wing).toFixed(1)} -3 8)"/>` +
    `<ellipse cx="0" cy="0" rx="11" ry="7.5" fill="var(--honey-bright)" stroke="var(--honey-deep)" stroke-width="1.4"/>` +
    `<path d="M-4,-7 L-4,7 M1.5,-7.4 L1.5,7.4" stroke="var(--honey-deep)" stroke-width="2.6" fill="none"/>` +
    `<circle cx="12.5" cy="0" r="4.6" fill="var(--ink)"/></g>`
}
const mark = (x, y, e, op = 1) => e <= 0.01 ? '' :
  `<text x="${x}" y="${y + 8}" font-size="${(24 * e).toFixed(1)}" text-anchor="middle" fill="var(--honey)" ` +
  `opacity="${(op * clamp01(e * 1.4)).toFixed(3)}" transform="rotate(${(1 - e) * 140} ${x} ${y})">✽</text>`

// ---------- the three worlds -------------------------------------------------
// Each world is ONE coordinate space; beats add to it and the camera travels.
// p(i) is beat i's progress: 0 before, 0→1 across its window, 1 forever after —
// so everything a beat draws persists, and the flow stays continuous.

const SIG8 = '#5d26ece71420adb8'
function vocabularyWorld(T, p) {
  const sp = (i, a, b) => clamp01((p(i) - a) / (b - a))
  let s = ''

  // beat 0 — the language: six words, precise
  const GLY = [['⬡', 'hive'], ['⬢', 'tile'], ['▤', 'layer'], ['#', 'signature'], ['🐝', 'bee'], ['✽', 'pheromone']]
  GLY.forEach(([g, w], k) => {
    const e = easeOut(sp(0, 0.04 + k * 0.11, 0.34 + k * 0.11)); if (e <= 0) return
    const x = 720 + (k - 2.5) * 150, y = 246 + 16 * (1 - e)
    s += hex(x, y, 46 * e, { sw: 1.8, op: e })
    s += txt(x, y - 2, g, { size: 26, fill: 'var(--honey-bright)', font: "'Segoe UI',sans-serif", op: e })
    s += txt(x, y + 24, w, { size: 10, fill: 'var(--dim)', spacing: '.06em', op: e })
  })

  // the tree — one participant's whole tree (beat 1), grown once, lived-in after
  const ROOT = { x: 1980, y: 246, r: 54 }
  const L1 = [{ x: 2230, y: 116, r: 40 }, { x: 2230, y: 246, r: 42 }, { x: 2230, y: 376, r: 40 }]
  const L2 = [[{ x: 2450, y: 96 }], [{ x: 2450, y: 186 }, { x: 2450, y: 306 }], [{ x: 2450, y: 396 }]]
  const FOCUS = L1[1], PERCH = L2[1][0]      // the tile we follow; the leaf the bee lands on
  const eR = easeOut(sp(1, 0, 0.3))
  L1.forEach((n, k) => {
    const e = easeOut(sp(1, 0.22 + k * 0.1, 0.52 + k * 0.1)); if (e <= 0) return
    s += link(ROOT.x + ROOT.r * 0.8, ROOT.y, n.x - n.r * e, n.y, e)
  })
  L2.forEach((pair, k) => pair.forEach((n, j) => {
    const e = easeOut(sp(1, 0.5 + (k * 2 + j) * 0.055, 0.8 + (k * 2 + j) * 0.055)); if (e <= 0) return
    s += link(L1[k].x + L1[k].r * 0.8, L1[k].y, n.x - 28 * e, n.y, e)
  }))
  s += hex(ROOT.x, ROOT.y, ROOT.r * eR, { sw: 2.4, op: eR })
  s += txt(ROOT.x, ROOT.y + 5, '⬡', { size: 30, fill: 'var(--honey-bright)', font: "'Segoe UI',sans-serif", op: eR * 0.9 })

  // versions behind the focus tile — one immutable version of a place (beat 3)
  for (let k = 3; k >= 1; k--) {
    const e = easeOut(sp(3, 0.08 + (3 - k) * 0.16, 0.42 + (3 - k) * 0.16)); if (e <= 0) continue
    s += hex(FOCUS.x - 17 * k * e, FOCUS.y - 13 * k * e, FOCUS.r + 6 - 2.5 * k, { sw: 1.5, op: e * (0.62 - k * 0.13), fill: 'var(--bg2)' })
  }

  // level-1 and leaves (drawn over the version ghosts)
  L1.forEach((n, k) => {
    const e = easeOut(sp(1, 0.22 + k * 0.1, 0.52 + k * 0.1)); if (e <= 0) return
    const focus = n === FOCUS
    const swell = focus ? 1 + 0.18 * easeOut(sp(2, 0, 0.4)) : 1
    const marked = false
    s += hex(n.x, n.y, n.r * e * swell, { sw: focus ? 2.4 : 2, op: e, made: focus && sp(3, 0.6, 1) > 0 })
  })
  L2.forEach((pair, k) => pair.forEach((n, j) => {
    const e = easeOut(sp(1, 0.5 + (k * 2 + j) * 0.055, 0.8 + (k * 2 + j) * 0.055)); if (e <= 0) return
    const isPerch = n === PERCH
    const acted = isPerch ? easeOut(sp(5, 0.75, 1)) : 0
    const restyled = isPerch ? easeOut(sp(6, 0.55, 0.85)) : 0
    s += hex(n.x, n.y, 30 * e * (1 + 0.12 * restyled), {
      sw: 1.8 + restyled, op: e,
      fill: restyled > 0.3 ? 'var(--honey-glow)' : acted > 0 ? `rgba(224,165,32,${(0.22 * acted).toFixed(2)})` : '#fff',
      stroke: restyled > 0.3 ? 'var(--honey)' : 'var(--honey-deep)',
    })
  }))

  // beat 2 — one hexagon of content
  s += contentLines(FOCUS.x, FOCUS.y, sp(2, 0.15, 0.9), 1.05)

  // beat 4 — the signature: the name computed from the content itself
  const e4 = sp(4, 0, 1)
  if (e4 > 0) {
    const conv = easeOut(sp(4, 0, 0.3))
    ;[-26, 0, 26].forEach(dx => { s += link(FOCUS.x + dx, FOCUS.y + 34, FOCUS.x, FOCUS.y + 62, conv, { dim: 0.35 }) })
    const chars = Math.ceil(SIG8.length * clamp01(sp(4, 0.12, 0.72)))
    s += txt(FOCUS.x, FOCUS.y + 84, SIG8.slice(0, chars) + (chars < SIG8.length ? '▌' : ''), { size: 15, fill: 'var(--honey-deep)', weight: 600 })
    s += txt(FOCUS.x + 92, FOCUS.y + 84, '✓', { size: 15, fill: 'var(--honey)', op: easeOut(sp(4, 0.78, 0.95)) })
  }

  // beat 5 — a bee senses, then acts. beat 6 lifts it away again.
  const eBee = sp(5, 0, 1)
  if (eBee > 0) {
    const flight = easeInOut(sp(5, 0, 0.55))
    const away = easeInOut(sp(6, 0, 0.35))
    let bx, by, ang
    if (away > 0) {
      const q = qbez({ x: PERCH.x, y: PERCH.y - 40 }, { x: 2580, y: 40 }, { x: 2760, y: -40 }, away)
      bx = q.x; by = q.y; ang = -30
    } else {
      const q = qbez({ x: 1830, y: 40 }, { x: 2330, y: -40 }, { x: PERCH.x, y: PERCH.y - 42 }, flight)
      bx = q.x; by = q.y + (flight >= 1 ? Math.sin(T * 5) * 3 : 0)
      ang = flight < 1 ? 18 : 8
    }
    s += beeGlyph(bx, by, ang, T, 1.15, away > 0 ? 1 - away : 1)
    const sense = sp(5, 0.55, 0.8)
    if (sense > 0 && sense < 1) s += ring(PERCH.x, PERCH.y, 34 + 16 * sense, (1 - sense) * 0.8, { dash: '3 5', sw: 1.6 })
  }

  // beat 6 — the pheromone mark lands and the tile re-renders from it
  s += mark(PERCH.x, PERCH.y, easeOut(sp(6, 0.1, 0.38)))
  for (const [a, b] of [[0.32, 0.62], [0.48, 0.78]]) {
    const e = sp(6, a, b)
    if (e > 0 && e < 1) s += ring(PERCH.x, PERCH.y, 30 + 34 * e, (1 - e) * 0.7)
  }

  // beat 7 — pollination: another hive, and work crossing to it
  const e7 = sp(7, 0, 1)
  const R2 = { x: 3260, y: 246, r: 48 }
  const R2L = [{ x: 3010, y: 156, r: 32 }, { x: 3010, y: 336, r: 32 }]
  const SLOT = { x: 3010, y: 246, r: 30 }
  if (e7 > 0) {
    const eT = easeOut(sp(7, 0, 0.25))
    R2L.forEach(n => { s += link(R2.x - R2.r * 0.8, R2.y, n.x + n.r, n.y, eT) })
    s += link(R2.x - R2.r * 0.8, R2.y, SLOT.x + SLOT.r, SLOT.y, eT, { dash: '4 5', dim: 0.4 })
    s += hex(R2.x, R2.y, R2.r * eT, { sw: 2.2, op: eT })
    s += txt(R2.x, R2.y + 5, '⬡', { size: 26, fill: 'var(--honey-bright)', font: "'Segoe UI',sans-serif", op: eT * 0.9 })
    R2L.forEach(n => { s += hex(n.x, n.y, n.r * eT, { sw: 1.8, op: eT }) })
    const tt = easeInOut(sp(7, 0.3, 0.88))
    if (tt > 0 && tt < 1) {
      const q = qbez({ x: PERCH.x, y: PERCH.y }, { x: 2740, y: -10 }, { x: SLOT.x, y: SLOT.y }, tt)
      s += hex(q.x, q.y, 26, { dash: '5 4', op: 0.9 })
      s += mark(q.x, q.y, 0.7, 0.9)
      for (let d = 1; d <= 3; d++) {
        const q2 = qbez({ x: PERCH.x, y: PERCH.y }, { x: 2740, y: -10 }, { x: SLOT.x, y: SLOT.y }, clamp01(tt - d * 0.07))
        s += `<circle cx="${q2.x.toFixed(1)}" cy="${q2.y.toFixed(1)}" r="2.2" fill="var(--honey)" opacity="${(0.5 - d * 0.13).toFixed(2)}"/>`
      }
    }
  }

  // beat 8 — brooding fills the cell; eclosion hatches it
  const e8 = sp(8, 0, 1)
  const landed = sp(7, 0.88, 1) > 0
  if (landed || e8 > 0) {
    const brood = easeOut(sp(8, 0.02, 0.5))
    const burst = sp(8, 0.55, 0.82)
    const done = easeOut(sp(8, 0.62, 0.9))
    s += hex(SLOT.x, SLOT.y, SLOT.r, { dash: done > 0.5 ? '' : '5 4', op: 0.9, sw: 1.8 + done, made: done > 0.5 })
    if (brood > 0 && done < 0.5) s += hex(SLOT.x, SLOT.y, SLOT.r * 0.82 * brood, { fill: 'var(--honey-glow)', stroke: 'var(--honey-bright)', sw: 1.2, op: 0.85 })
    if (burst > 0 && burst < 1) {
      s += ring(SLOT.x, SLOT.y, 30 + 40 * burst, (1 - burst) * 0.9, { sw: 2.4 })
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 3 * k + 0.26, rr = 32 + 30 * burst
        s += link(SLOT.x + Math.cos(a) * 30, SLOT.y + Math.sin(a) * 30, SLOT.x + Math.cos(a) * rr, SLOT.y + Math.sin(a) * rr, (1 - burst), { stroke: 'var(--honey)', dim: 0.8 })
      }
    }
    s += contentLines(SLOT.x, SLOT.y, done, 0.62)
    s += mark(SLOT.x + 16, SLOT.y - 15, done * 0.58, 0.9)   // the pollinated work keeps its mark
  }

  // beat 9 — the colony: everything alive, nothing central
  const e9 = sp(9, 0, 1)
  if (e9 > 0) {
    s += link(PERCH.x, PERCH.y, SLOT.x, SLOT.y, 0.5 * e9, { dash: '2 7', dim: 0.5 })
    const pulses = [[ROOT, 0], [L1[0], 1.9], [L2[2][0], 3.1], [R2, 4.3], [R2L[0], 5.6], [L2[0][0], 2.5]]
    pulses.forEach(([n, ph]) => {
      const o = (0.28 + 0.24 * Math.sin(T * 2.1 + ph)) * e9
      s += ring(n.x, n.y, (n.r || 30) + 9, Math.max(0, o), { sw: 1.6 })
    })
    for (let k = 0; k < 3; k++) {
      const a = T * (0.42 + k * 0.07) + k * 2.2
      const bx = 2700 + Math.cos(a) * (280 + k * 50)
      const by = 150 + Math.sin(a) * (86 + k * 22) + k * 60
      s += beeGlyph(bx, by, Math.cos(a) < 0 ? 195 : -15, T + k, 0.95, 0.85 * e9)
    }
  }
  return s
}

const SIGS13 = ['#a1f4', '#b27c', '#c9e3']
function integrityWorld(T, p) {
  const sp = (i, a, b) => clamp01((p(i) - a) / (b - a))
  let s = ''

  // beat 0 — a hex, hashed into its name, checked: verify instead of trust
  const EM = { x: 560, y: 240, r: 52 }
  const e0 = easeOut(sp(0, 0.02, 0.25))
  s += hex(EM.x, EM.y, EM.r * e0, { sw: 2.4, op: e0 })
  s += contentLines(EM.x, EM.y, sp(0, 0.12, 0.4), 1)
  const conv = easeOut(sp(0, 0.3, 0.55))
  ;[-22, 0, 22].forEach(dy => { s += link(EM.x + EM.r * 0.85, EM.y + dy, EM.x + EM.r + 46, EM.y, conv, { dim: 0.4 }) })
  const SIGT = '#f02ee1cb2faf6d1b'
  const chars = Math.ceil(SIGT.length * sp(0, 0.42, 0.8))
  if (chars > 0) s += txt(EM.x + EM.r + 58, EM.y + 5, SIGT.slice(0, chars) + (chars < SIGT.length ? '▌' : ''), { size: 17, fill: 'var(--honey-deep)', weight: 600, anchor: 'start' })
  const e0c = easeOut(sp(0, 0.82, 0.98))
  if (e0c > 0) {
    s += ring(EM.x + EM.r + 152, EM.y, 26 * e0c, e0c * 0.9, { sw: 2 })
    s += txt(EM.x + EM.r + 152, EM.y + 7, '✓', { size: 22 * e0c, fill: 'var(--honey)', op: e0c })
  }

  // beat 1 — a branch is shared as signatures; the machine proves every byte
  const e1 = sp(1, 0, 1)
  const BR = [{ x: 1520, y: 186, r: 38 }, { x: 1700, y: 122, r: 26 }, { x: 1700, y: 252, r: 26 }]
  const MACH = { x: 2170, y: 132, w: 420, h: 236 }
  if (e1 > 0) {
    const eT = easeOut(sp(1, 0, 0.18))
    s += link(BR[0].x + 30, BR[0].y, BR[1].x - 22, BR[1].y, eT)
    s += link(BR[0].x + 30, BR[0].y, BR[2].x - 22, BR[2].y, eT)
    BR.forEach((n, k) => {
      s += hex(n.x, n.y, n.r * eT, { sw: 2, op: eT })
      s += contentLines(n.x, n.y, eT, n.r / 52, 0.8)
    })
    s += `<rect x="${MACH.x}" y="${MACH.y}" width="${MACH.w}" height="${MACH.h}" rx="14" fill="#fff" stroke="var(--line)" stroke-width="2" opacity="${eT.toFixed(2)}"/>`
    s += txt(MACH.x + MACH.w / 2, MACH.y + 28, 'your machine', { size: 12, spacing: '.3em', op: eT * 0.9 })
    SIGS13.forEach((sig, k) => {
      const y = MACH.y + 74 + k * 56
      const tt = easeInOut(sp(1, 0.08 + k * 0.09, 0.42 + k * 0.09))
      const from = BR[k], to = { x: MACH.x + 64, y }
      if (tt > 0) {
        const q = qbez(from, { x: (from.x + to.x) / 2, y: from.y - 66 }, to, tt)
        s += `<rect x="${q.x - 34}" y="${q.y - 13}" width="68" height="26" rx="6" fill="#fff" stroke="var(--honey-deep)" stroke-width="1.4" opacity=".95"/>`
        s += txt(q.x, q.y + 5, sig, { size: 13, fill: 'var(--honey-deep)', weight: 600 })
      }
      const fill = sp(1, 0.44 + k * 0.09, 0.72 + k * 0.09)
      if (fill > 0) {
        s += `<rect x="${MACH.x + 116}" y="${y - 5}" width="180" height="10" rx="5" fill="none" stroke="var(--line)" stroke-width="1.5"/>`
        s += `<rect x="${MACH.x + 116}" y="${y - 5}" width="${180 * easeOut(fill)}" height="10" rx="5" fill="var(--honey-bright)" opacity=".8"/>`
        s += txt(MACH.x + 116 + 90, y + 26, 'hash(bytes) ≟ sig', { size: 10, fill: 'var(--faint)', op: clamp01(fill * 2) * 0.9 })
      }
      const ok = easeOut(sp(1, 0.74 + k * 0.09, 0.88 + k * 0.09))
      if (ok > 0) s += txt(MACH.x + 336, y + 7, '✓', { size: 21 * ok, fill: 'var(--honey)', op: ok })
    })
  }

  // beat 2 — identical content collapses to one copy; the network is a cache
  const e2 = sp(2, 0, 1)
  const PEERS = [{ x: 3060, y: 138 }, { x: 3330, y: 350 }, { x: 3670, y: 118 }, { x: 3850, y: 312 }]
  const C = { x: 3490, y: 232 }
  if (e2 > 0) {
    const eT = easeOut(sp(2, 0, 0.14))
    const MESH = [[0, 1], [1, 2], [2, 3], [0, 3], [1, 3]]
    MESH.forEach(([a, b]) => { s += link(PEERS[a].x, PEERS[a].y, PEERS[b].x, PEERS[b].y, eT * 0.5, { dash: '2 6', dim: 0.5 }) })
    PEERS.forEach((n, k) => {
      s += `<circle cx="${n.x}" cy="${n.y}" r="30" fill="#fff" stroke="${k === 0 ? 'var(--honey)' : 'var(--line)'}" stroke-width="${k === 0 ? 2.4 : 2}" opacity="${eT.toFixed(2)}"/>`
      s += txt(n.x, n.y + 4, k === 0 ? 'you' : 'peer', { size: 10.5, spacing: '.14em', fill: k === 0 ? 'var(--honey)' : 'var(--faint)', op: eT })
    })
    const collapse = easeInOut(sp(2, 0.12, 0.42))
    PEERS.forEach((n, k) => {
      const hx = lerp(n.x + 44, C.x, collapse), hy = lerp(n.y - 20, C.y, collapse)
      if (collapse < 1) s += hex(hx, hy, lerp(20, 27, collapse), { made: true, op: (1 - collapse * 0.5) * e2, sw: 1.6 })
      s += link(n.x, n.y, C.x, C.y, easeOut(sp(2, 0.36, 0.55)) * 0.9, { dim: 0.45 })
    })
    if (collapse >= 1) {
      s += hex(C.x, C.y, 29, { made: true, sw: 2.4 })
      s += txt(C.x, C.y + 52, '#e3a1 · one copy', { size: 12, fill: 'var(--honey-deep)', weight: 600 })
    }
    const out = easeInOut(sp(2, 0.6, 0.76)), back = easeInOut(sp(2, 0.78, 0.94))
    if (out > 0 && back < 1) {
      const a = PEERS[0], from = { x: a.x, y: a.y }
      const at = back > 0 ? { x: lerp(C.x, from.x, back), y: lerp(C.y, from.y, back) } : { x: lerp(from.x, C.x, out), y: lerp(from.y, C.y, out) }
      s += `<circle cx="${at.x.toFixed(1)}" cy="${at.y.toFixed(1)}" r="${back > 0 ? 9 : 5}" fill="var(--honey)" opacity=".9"/>`
      if (back > 0) s += hex(at.x, at.y, 13, { made: true, sw: 1.4, op: 0.95 })
    }
    if (back >= 1) { s += hex(PEERS[0].x, PEERS[0].y - 46, 14, { made: true, sw: 1.5 }); s += txt(PEERS[0].x + 26, PEERS[0].y - 41, '✓', { size: 14, fill: 'var(--honey)' }) }
  }

  // beat 3 — sharing a hash is sharing a proof
  const e3 = sp(3, 0, 1)
  if (e3 > 0) {
    const seal = easeOut(sp(3, 0.1, 0.5))
    s += ring(C.x, C.y + 8, 74 * seal, seal * 0.9, { dash: '10 7', sw: 2.6 })
    const spin = (T * 40) % 360
    s += `<g transform="rotate(${spin.toFixed(1)} ${C.x} ${C.y + 8})">` + ring(C.x, C.y + 8, 84 * seal, seal * 0.5, { dash: '2 12', sw: 2 }) + '</g>'
    const ck = easeOut(sp(3, 0.45, 0.7))
    if (ck > 0) s += txt(C.x, C.y + 10 + 9 * ck, '✓', { size: 26 * ck, fill: 'var(--honey-deep)', weight: 600, op: ck })
  }
  return s
}

const hex4 = i => ((i * 2654435761 >>> 0).toString(16).padStart(8, '0')).slice(0, 4)
function timeWorld(T, p) {
  const sp = (i, a, b) => clamp01((p(i) - a) / (b - a))
  let s = ''
  const CY = 330, CW = 92, CH = 64, X0 = 240, DX = 120
  const cardX = u => X0 + u * DX
  const N = 9                                   // the strip; experiments add 9 and 10

  // what the page looked like at continuous position u — morphs smoothly
  const pageAt = (cx, cy, u, scale, op) => {
    let g = ''
    for (let k = 0; k < 3; k++) {
      const hx = cx + (Math.sin(u * 0.9 + k * 2.1) * 22) * scale
      const hy = cy + (Math.cos(u * 0.7 + k * 1.5) * 10 - 4) * scale
      g += hex(hx, hy, (7.5 + 2 * Math.sin(u * 0.6 + k)) * scale, { sw: 1.3, op: op * 0.95, made: k === 0 })
    }
    g += `<rect x="${cx - 26 * scale}" y="${cy + 16 * scale}" width="${(30 + 14 * Math.abs(Math.sin(u * 0.8))) * scale}" height="${3 * scale}" rx="${1.5 * scale}" fill="var(--faint)" opacity="${(op * 0.8).toFixed(2)}"/>`
    return g
  }

  // undo/rewind/checkpoint state of the playhead, shared across beats
  const undoU = 8 - 6 * easeInOut(sp(1, 0.08, 0.9))                       // 8 → 2, across the session break
  const scrubU = 2 + 3.6 * Math.sin(Math.PI * easeInOut(sp(2, 0.12, 0.96)))  // out and back
  const expandN = sp(4, 0, 1) > 0 ? 11 : N
  let headU = 8
  if (p(1) > 0) headU = undoU
  if (p(2) > 0) headU = scrubU
  if (p(3) > 0) headU = 2 + 4 * easeInOut(sp(3, 0.1, 0.5))                // drift to the revisions
  if (p(4) > 0) headU = lerp(6, 10, easeInOut(sp(4, 0.55, 0.95)))         // out to the experiments
  if (p(5) > 0) headU = 10

  // session break between cards 3 and 4
  const eDiv = easeOut(sp(0, 0.7, 1))
  const divPulse = p(1) > 0 && Math.abs(undoU - 3.5) < 0.6 ? 0.6 : 0
  s += link(660, 262, 660, 408, eDiv * (0.5 + divPulse), { dash: '5 6', dim: 0.8, sw: 1.8, stroke: divPulse ? 'var(--honey)' : 'var(--faint)' })

  for (let k = 0; k < expandN; k++) {
    const exp = k >= N                                                     // experimental cards
    const e = exp ? easeOut(sp(4, 0.34 + (k - N) * 0.16, 0.6 + (k - N) * 0.16))
                  : easeOut(sp(0, 0.02 + k * 0.075, 0.3 + k * 0.075))
    if (e <= 0) continue
    const x = cardX(k) + (1 - e) * 220, y = CY
    const behind = p(1) > 0.05 && k > headU + 0.3 && p(2) <= 0
    const dim = behind ? 0.5 : 1
    // beat 5 — the ripple back through every immutable state
    const rip = sp(5, 0.06 + (expandN - 1 - k) * 0.05, 0.2 + (expandN - 1 - k) * 0.05)
    const lift = Math.sin(Math.PI * clamp01(rip)) * 6
    s += `<rect x="${(x - CW / 2).toFixed(1)}" y="${(y - CH / 2 - lift).toFixed(1)}" width="${CW}" height="${CH}" rx="10" ` +
      `fill="${exp ? 'var(--bg2)' : '#fff'}" stroke="${rip > 0.5 ? 'var(--honey)' : exp ? 'var(--honey-deep)' : 'var(--line)'}" ` +
      `stroke-width="${rip > 0.5 ? 2 : 1.6}" ${exp ? 'stroke-dasharray="6 4" ' : ''}opacity="${(e * dim).toFixed(2)}"/>`
    s += pageAt(x, y - lift, k, 1, e * dim)
    const sigOn = p(5) > 0 ? clamp01(rip * 2) : 0
    s += txt(x, y + 48, '#' + hex4(k + 3), { size: k === 0 && sp(5, 0.75, 0.95) > 0 ? 13 : 10, fill: sigOn > 0.4 ? 'var(--honey-deep)' : 'var(--faint)', weight: sigOn > 0.4 ? 600 : 400, op: e * (0.65 + 0.35 * sigOn) })
  }
  // the oldest state, as reachable as the head
  const eOld = easeOut(sp(5, 0.75, 0.95))
  if (eOld > 0) s += ring(cardX(0), CY, (CW / 2 + 12) * eOld, eOld * 0.8, { sw: 2 })

  // playhead
  const eHead = easeOut(sp(0, 0.75, 1))
  if (eHead > 0) {
    const hx = cardX(headU)
    s += hex(hx, CY - CH / 2 - 22, 9 * eHead, { made: true, sw: 1.6 })
    s += link(hx, CY - CH / 2 - 13, hx, CY - CH / 2 - 2, eHead * 0.9, { dim: 0.7 })
  }

  // beat 2 — the rewind window scrubs what the page used to look like
  const eWin = easeOut(sp(2, 0, 0.18)) * (1 - easeInOut(sp(3, 0, 0.25)))
  if (eWin > 0.01) {
    s += `<rect x="560" y="64" width="320" height="168" rx="12" fill="#fff" stroke="var(--honey-deep)" stroke-width="2" opacity="${eWin.toFixed(2)}"/>`
    s += txt(720, 88, 'rewind', { size: 11, spacing: '.3em', fill: 'var(--honey)', op: eWin * 0.9 })
    s += pageAt(720, 152, scrubU, 2.1, eWin)
    s += link(cardX(headU), 232, cardX(headU), CY - CH / 2 - 30, eWin * 0.7, { dash: '3 5', dim: 0.6 })
  }

  // beat 3 — named revisions dropping onto the strip
  ;[['adopt', 4, 0.08, 0.38], ['upgrade', 6, 0.45, 0.75]].forEach(([name, u, a, b]) => {
    const e = easeOut(sp(3, a, b)); if (e <= 0) return
    const x = cardX(u), ty = CY - CH / 2 - 58 + (1 - e) * -26
    s += link(x, ty + 12, x, CY - CH / 2 - 2, e * 0.8, { dim: 0.6 })
    s += `<rect x="${x - 37}" y="${ty - 13}" width="74" height="24" rx="6" fill="var(--honey-glow)" stroke="var(--honey)" stroke-width="1.4" opacity="${e.toFixed(2)}"/>`
    s += txt(x, ty + 3, name, { size: 11, fill: 'var(--honey-deep)', weight: 600, op: e })
  })

  // beat 4 — the checkpoint pin, then the experiments it protects against
  const ePin = easeOut(sp(4, 0.04, 0.3))
  if (ePin > 0) {
    const x = cardX(8)
    s += link(x, CY - CH / 2 - 40 * ePin, x, CY - CH / 2 - 2, ePin * 0.9, { dim: 0.8, sw: 2 })
    s += hex(x, CY - CH / 2 - 46, 11 * ePin, { made: true, sw: 2 })
    s += txt(x, CY - CH / 2 - 64, 'checkpoint', { size: 10, spacing: '.16em', fill: 'var(--honey-deep)', op: ePin })
  }
  return s
}

// ---------- clip definitions -------------------------------------------------
const CLIPS = {
  vocabulary: {
    scene: 8, file: 'concept-vocabulary.mp4', world: vocabularyWorld,
    beats: [
      { term: 'the language', gloss: 'precise words', cam: { x: 720, y: 246, s: 1.0 } },
      { term: 'hive', gloss: "one participant's whole tree", cam: { x: 2215, y: 246, s: 1.25 } },
      { term: 'tile', gloss: 'one hexagon of content', cam: { x: 2238, y: 246, s: 2.5 } },
      { term: 'layer', gloss: 'one immutable version of a place', cam: { x: 2200, y: 238, s: 2.0 } },
      { term: 'signature', gloss: 'the name computed from the content', cam: { x: 2230, y: 282, s: 2.0 } },
      { term: 'bee', gloss: 'senses, then acts', cam: { x: 2280, y: 226, s: 1.25 } },
      { term: 'pheromone', gloss: 'a mark that says what it is', cam: { x: 2400, y: 212, s: 1.65 } },
      { term: 'pollination', gloss: 'work crossing between hives', cam: { x: 2740, y: 240, s: 0.56 } },
      { term: 'brooding · eclosion', gloss: 'prepared, then hatched', cam: { x: 3010, y: 246, s: 2.2 } },
      { term: 'colony', gloss: 'no central authority', cam: { x: 2620, y: 246, s: 0.55 } },
    ],
  },
  integrity: {
    scene: 13, file: 'concept-integrity.mp4', world: integrityWorld,
    beats: [
      { term: 'integrity', gloss: 'verify, don’t trust', cam: { x: 760, y: 240, s: 1.15 } },
      { term: 'share = signatures', gloss: 'every byte proven on arrival', cam: { x: 1990, y: 240, s: 0.92 } },
      { term: 'one copy', gloss: 'the network is a global cache', cam: { x: 3585, y: 235, s: 0.76 } },
      { term: 'proof', gloss: 'sharing a hash is sharing a proof', cam: { x: 3575, y: 262, s: 1.55 } },
    ],
  },
  time: {
    scene: 14, file: 'concept-time.mp4', world: timeWorld,
    beats: [
      { term: 'time', gloss: 'a feature, not an accident', cam: { x: 720, y: 288, s: 1.0 } },
      { term: 'undo', gloss: 'across sessions', cam: { x: 720, y: 288, s: 1.0 } },
      { term: 'rewind', gloss: 'scrub what a page used to be', cam: { x: 720, y: 240, s: 1.0 } },
      { term: 'revisions', gloss: 'named on adopt and upgrade', cam: { x: 720, y: 270, s: 1.0 } },
      { term: 'checkpoints', gloss: 'before risky experiments', cam: { x: 880, y: 278, s: 0.9 } },
      { term: 'immutable', gloss: 'the past is one signature away', cam: { x: 840, y: 282, s: 0.86 } },
    ],
  },
}

// ---------- frame assembly ---------------------------------------------------
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const PAGE_CSS = `${STYLE}
  html,body{width:${W}px;background:var(--bg)}
  .pane{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:var(--bg)}
  .pane svg.comb{position:absolute;inset:0;width:100%;height:100%;opacity:.5}
  .pane svg.stage{position:absolute;inset:0;width:100%;height:100%}`
const COMB = `<svg class="comb"><defs>
  <pattern id="hexp" width="56" height="97" patternUnits="userSpaceOnUse" patternTransform="scale(1.6)">
    <polygon points="28,0 56,16.2 56,48.5 28,64.7 0,48.5 0,16.2" fill="none" stroke="var(--hexline)" stroke-width="1"/>
    <polygon points="28,0 56,16.2 56,48.5 28,64.7 0,48.5 0,16.2" fill="none" stroke="var(--hexline)" stroke-width="1" transform="translate(28,48.5)"/>
    <polygon points="28,0 56,16.2 56,48.5 28,64.7 0,48.5 0,16.2" fill="none" stroke="var(--hexline)" stroke-width="1" transform="translate(-28,48.5)"/>
  </pattern></defs><rect width="120%" height="120%" fill="url(#hexp)"/></svg>`

function paneAt(clip, starts, audioDur, T) {
  const i = Math.max(0, starts.findLastIndex(t => T >= t))
  const winEnd = j => j + 1 < starts.length ? starts[j + 1] : audioDur
  const pOf = j => T <= starts[j] ? 0 : T >= winEnd(j) ? 1 : (T - starts[j]) / (winEnd(j) - starts[j])

  // the camera glides for ~1.15s at each beat's start
  const from = clip.beats[Math.max(0, i - 1)].cam, to = clip.beats[i].cam
  const k = i === 0 ? 1 : easeInOut(clamp01((T - starts[i]) / 1.15))
  const cx = lerp(from.x, to.x, k), cy = lerp(from.y, to.y, k)
  const cs = Math.exp(lerp(Math.log(from.s), Math.log(to.s), k))

  const world = clip.world(T, pOf)
  // labels crossfade in screen space
  let labels = ''
  const fadeIn = clamp01((T - starts[i]) / 0.45)
  const prev = i > 0 && fadeIn < 1 ? clip.beats[i - 1] : null
  const put = (b, op) =>
    txt(46, 62, esc(b.term), { size: 24, fill: 'var(--honey)', anchor: 'start', spacing: '.06em', weight: 600, op }) +
    txt(47, 88, esc(b.gloss).toUpperCase(), { size: 10.5, fill: 'var(--faint)', anchor: 'start', spacing: '.26em', op: op * 0.9 })
  labels += put(clip.beats[i], fadeIn)
  if (prev) labels += put(prev, 1 - fadeIn)

  return `<div class="pane">${COMB}<svg class="stage" viewBox="0 0 ${W} ${H}">` +
    `<g transform="translate(${W / 2},${H / 2}) scale(${cs.toFixed(4)}) translate(${(-cx).toFixed(1)},${(-cy).toFixed(1)})">${world}</g>` +
    `${labels}</svg></div>`
}
const document_ = panes => `<meta charset="utf-8"><style>${PAGE_CSS}</style>${panes.join('')}`

// ---------- shooting (filmstrips, as in verbs.cjs) ---------------------------
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
    let z = -1
    try { z = fs.statSync(stripPng).size } catch {}
    if (z > 0 && z === size) break
    size = z
    execFileSync('powershell', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 200'], { stdio: 'ignore' })
  }
  try { fs.unlinkSync(htmlPath) } catch {}
  return parseInt(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=height', '-of', 'csv=p=0', stripPng], { encoding: 'utf8' }).trim(), 10)
}
const ff = (...a) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...a], { stdio: 'inherit' })

function drawClip(name) {
  const clip = CLIPS[name]
  const say = sceneSay(clip.scene)
  const { starts, audioDur } = beatTimes(say, clip.beats.length)
  console.log(`${name}: narration ${audioDur.toFixed(1)}s · beats at ${starts.map(t => t.toFixed(1)).join(' ')}`)

  const dir = path.join(WORK, name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  const total = Math.ceil((audioDur + HOLD) * FPS)
  let done = 0, strip = 0
  while (done < total) {
    for (;;) {
      const rows = Math.min(STRIP_ROWS, total - done)
      const panes = []
      for (let k = 0; k < rows; k++) panes.push(paneAt(clip, starts, audioDur, (done + k) / FPS))
      const png = path.join(dir, `strip-${strip}.png`)
      const got = shootStrip(document_(panes), rows, png)
      if (got < H * rows) {
        if (STRIP_ROWS <= 2) throw new Error('cannot capture even two frames at a time')
        STRIP_ROWS = Math.max(2, Math.floor(STRIP_ROWS / 2))
        console.log(`  (filmstrip came back ${got}px — dropping to ${STRIP_ROWS} frames per shot)`)
        continue
      }
      ff('-i', png, '-vf', `untile=1x${rows}`, '-start_number', String(done + 1), path.join(dir, 'f%04d.png'))
      fs.unlinkSync(png)
      done += rows; strip++
      break
    }
    if (done % 120 < STRIP_ROWS) console.log(`  ${name}: ${done}/${total} frames`)
  }
  console.log(`  ${name}: ${total} frames drawn`)
  return { dir, total }
}

function encodeClip(name, dir) {
  const out = path.join(MEDIA, CLIPS[name].file)
  ff('-framerate', String(FPS), '-i', path.join(dir, 'f%04d.png'),
    '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '24', '-preset', 'medium',
    '-an', '-movflags', '+faststart', out)
  console.log(`  → ${out} (${(fs.statSync(out).size / 1e6).toFixed(2)} MB)`)
}

// ---------- main -------------------------------------------------------------
const args = process.argv.slice(2)
const framesOnly = args.includes('--frames')
const probeArg = (args.find(a => a.startsWith('--probe')) || '').split('=')[1]
const wanted = args.filter(a => !a.startsWith('--'))
const names = wanted.length ? wanted : Object.keys(CLIPS)
for (const n of names) if (!CLIPS[n]) { console.error(`unknown clip: ${n} (${Object.keys(CLIPS).join(', ')})`); process.exit(1) }

// --probe=t1,t2,… shoots single stills at those times (mid-beat by default)
if (args.some(a => a.startsWith('--probe'))) {
  for (const n of names) {
    const clip = CLIPS[n]
    const { starts, audioDur } = beatTimes(sceneSay(clip.scene), clip.beats.length)
    const times = probeArg ? probeArg.split(',').map(Number)
      : starts.map((t, j) => lerp(t, j + 1 < starts.length ? starts[j + 1] : audioDur, 0.72))
    times.forEach((t, j) => {
      const png = path.join(OUT, `probe-${n}-${String(j).padStart(2, '0')}-${t.toFixed(1)}s.png`)
      shootStrip(document_([paneAt(clip, starts, audioDur, t)]), 1, png)
      console.log(`  ${png}`)
    })
  }
  process.exit(0)
}

for (const n of names) {
  const { dir } = drawClip(n)
  if (!framesOnly) encodeClip(n, dir)
}
if (framesOnly) console.log('frames only — nothing encoded')
