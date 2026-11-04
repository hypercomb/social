// Concept clips — the flow of the experience, drawn.
//
// Four scenes of the deck talk about things live capture cannot show: what
// the words MEAN (scene 8), what verification IS (scene 13), what time FEELS
// like (scene 14), and who SERVES the work (scene 17). Each gets a drawn concept
// clip: one continuous world per scene, a camera that travels through it, and
// beats that land on the narration's own sentence boundaries — measured from the
// cached audio with silencedetect, so an edited line re-times the clip on the
// next run. Until a reworded line has been voiced, the beats are timed from its
// text instead (textBeatTimes), and the next run after build.cjs re-times them.
//
// The clips are silent by design: the deck plays the scene's narration and the
// film pane plays the clip muted from t=0, so matching the audio's length and
// sentence timing is the whole synchronisation contract.
//
// Same filmstrip pipeline as verbs.cjs: many frames per headless launch,
// ffmpeg untile to cut them apart, one encode per clip.
//
//   node concepts.cjs                 → media/concept-{vocabulary,integrity,time,served}.mp4
//   node concepts.cjs vocabulary      → just that clip
//   node concepts.cjs time --frames   → draw frames only, no encode
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync, spawnSync } = require('child_process')

const { fontsCss } = require('./build.cjs')
const { sentencesOf, sentenceTimes } = require('./timing.cjs')

const ROOT = __dirname
const OUT = path.join(ROOT, 'concepts')
const WORK = path.join(OUT, 'frames')
const MEDIA = path.join(ROOT, 'media')
const CACHE = path.join(ROOT, 'audio-cache')
// the headless browser that shoots the filmstrips: Edge on the Windows desk, or
// any Chromium named by CHROMIUM (e.g. CHROMIUM=/opt/pw-browsers/chromium)
const EDGE = process.env.CHROMIUM || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const VOICE = 'en-US-AndrewMultilingualNeural'
const RATE = '+2%'
// the filmwrap pane is 960/328 — draw at 1.5× for a crisp downscale
const W = 1440, H = 492
const FPS = 12                       // drawn rate; encoded at 30
const HOLD = 1.6                     // the world keeps breathing after the last word
const LEAD = 0.5                     // the first frames hold the title and the world, never a blank pane
let STRIP_ROWS = 10

for (const d of [OUT, WORK, MEDIA]) fs.mkdirSync(d, { recursive: true })

// design tokens and faces lifted from the real template, so the clips cannot drift:
// the ink ground, the hairlines, the two honeys, the embedded Inter / JetBrains Mono
const shell = fs.readFileSync(path.join(ROOT, 'template.html'), 'utf8')
const STYLE = ((shell.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '').replace('{{FONTS}}', () => fontsCss())

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

// No voice recorded yet (a line was just reworded): time the beats from the text
// alone — sentence starts at an even speaking rate, [pause:N] honoured — so the
// clip can be drawn now. Once the mp3 exists the audio path above takes over.
const WORDS_PER_SEC = 2.6
const PAUSE = /\[pause(?::(\d+))?\]/g
function textBeatTimes(say, beatCount) {
  const tokens = spokenOf(say).split(PAUSE)          // even: speech, odd: pause ms (or undefined)
  const starts = []
  let t = 0, open = true, sentences = 0
  tokens.forEach((part, i) => {
    if (i % 2) { t += (Number(part) || 700) / 1000; return }
    for (const w of part.split(/\s+/).filter(Boolean)) {
      if (open) { starts.push(t); sentences++; open = false }
      t += 1 / WORDS_PER_SEC
      if (/[.!?]["”’)]*$/.test(w)) open = true
    }
  })
  if (sentences !== beatCount)
    throw new Error(`beat count ${beatCount} != sentence count ${sentences} (timed from text)`)
  return { starts, audioDur: t, fromText: true }
}

function beatTimes(say, beatCount) {
  const audio = audioPathOf(say)
  if (!fs.existsSync(audio)) return textBeatTimes(say, beatCount)
  // the sentence finder is shared with recorder.cjs (timing.cjs), so a line
  // re-read there is cut exactly where these beats land
  const sentences = sentencesOf(spokenOf(say))
  if (sentences.length !== beatCount)
    throw new Error(`beat count ${beatCount} != sentence count ${sentences.length}: ${sentences.map(s => s.slice(0, 30)).join(' | ')}`)
  const { starts, audioDur } = sentenceTimes(audio, sentences)
  return { starts, audioDur }
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
// honey tint marks what the moment just made or marked; the panel is what was there
const hex = (cx, cy, r, o = {}) => r <= 0.5 || (o.op ?? 1) <= 0.004 ? '' :
  `<polygon points="${hexPoints(cx, cy, r)}" fill="${o.fill ?? (o.made ? 'var(--honey-tint)' : 'var(--panel)')}" ` +
  `${o.fo != null ? `fill-opacity="${o.fo.toFixed(3)}" ` : ''}` +
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
// no font-family here: the page's sheet owns the faces (text = sans, text.m = mono)
const txt = (x, y, s, o = {}) => (o.op ?? 1) <= 0.01 ? '' :
  `<text x="${x}" y="${y}"${o.sans ? '' : ' class="m"'} ` +
  `font-size="${o.size ?? 16}" fill="${o.fill ?? 'var(--dim)'}" text-anchor="${o.anchor ?? 'middle'}" ` +
  `${o.spacing ? `letter-spacing="${o.spacing}" ` : ''}${o.weight ? `font-weight="${o.weight}" ` : ''}` +
  `opacity="${(o.op ?? 1).toFixed(3)}">${s}</text>`
// hairline geometry instead of glyphs: a check, a typing cursor, a two-hex bee, a six-spoke mark
const check = (x, y, k = 1, o = {}) => (o.op ?? 1) <= 0.01 || k <= 0.01 ? '' :
  `<path d="M${(x - 6 * k).toFixed(1)},${y.toFixed(1)} L${(x - 1.5 * k).toFixed(1)},${(y + 4.5 * k).toFixed(1)} L${(x + 7 * k).toFixed(1)},${(y - 5 * k).toFixed(1)}" fill="none" stroke="${o.stroke ?? 'var(--honey)'}" stroke-width="${o.sw ?? 2.2}" opacity="${(o.op ?? 1).toFixed(3)}"/>`
const cursor = (x, y, h = 18, op = 1) => `<rect x="${x.toFixed(1)}" y="${(y - h * 0.8).toFixed(1)}" width="2.5" height="${h}" fill="var(--honey-fill)" opacity="${op.toFixed(3)}"/>`
const MONO_ADV = 0.6                 // JetBrains Mono advance, em per character
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
// the bee the plates and the sprite draw: two hexagons and two wing strokes, head first
function beeGlyph(x, y, ang, T, scale = 1, op = 1) {
  if (op <= 0.01) return ''
  const wing = Math.sin(T * Math.PI * 14) * 9
  return `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${ang.toFixed(1)}) scale(${scale})" opacity="${op.toFixed(3)}">` +
    `<polygon points="${hexPoints(-2, 1, 9)}" fill="var(--honey-fill)"/><polygon points="${hexPoints(11, -3, 5)}" fill="var(--honey-fill)"/>` +
    `<g transform="rotate(${(-wing).toFixed(1)} 0 -6)"><path d="M1,-7 C-1,-15 -8,-17 -13,-14 M-4,-7 C-7,-13 -13,-14 -17,-11" fill="none" stroke="var(--honey)" stroke-width="1.3"/></g></g>`
}
// a pheromone: six spokes and a honey dot, turning into place
const mark = (x, y, e, op = 1) => e <= 0.01 ? '' :
  `<g transform="translate(${x},${y}) rotate(${((1 - e) * 140).toFixed(1)}) scale(${e.toFixed(3)})" opacity="${(op * clamp01(e * 1.4)).toFixed(3)}">` +
  `<path d="M0,-10V10M-8.7,-5L8.7,5M-8.7,5L8.7,-5" fill="none" stroke="var(--honey)" stroke-width="2"/><circle r="2.6" fill="var(--honey-fill)"/></g>`
// the six words, as geometry: hive, tile, layer, signature, bee, pheromone
function glyph(name, x, y, e) {
  const g = inner => `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${e.toFixed(3)})" opacity="${e.toFixed(3)}">${inner}</g>`
  switch (name) {
    case 'hive': return g(`<polygon points="${hexPoints(0, 0, 15)}" fill="none" stroke="var(--honey)" stroke-width="1.6"/><polygon points="${hexPoints(0, 0, 6)}" fill="var(--honey-fill)"/>`)
    case 'tile': return g(`<polygon points="${hexPoints(0, 0, 13)}" fill="var(--honey-fill)"/>`)
    case 'layer': return g(`<polygon points="${hexPoints(0, 0, 15)}" fill="none" stroke="var(--honey)" stroke-width="1.6" opacity=".55"/><polygon points="${hexPoints(0, 0, 9)}" fill="none" stroke="var(--honey)" stroke-width="1.6"/>`)
    case 'signature': return g(txt(0, 8, '#', { size: 26, fill: 'var(--honey)', weight: 600 }))
    case 'bee': return g(beeGlyph(0, 2, 0, 0, 0.9, 1))
    case 'pheromone': return g(mark(0, 0, 1))
  }
  return ''
}

// ---------- the three worlds -------------------------------------------------
// Each world is ONE coordinate space; beats add to it and the camera travels.
// p(i) is beat i's progress: 0 before, 0→1 across its window, 1 forever after —
// so everything a beat draws persists, and the flow stays continuous.

const SIG8 = '#5d26ece71420adb8'
function vocabularyWorld(T, p) {
  const sp = (i, a, b) => clamp01((p(i) - a) / (b - a))
  let s = ''

  // beat 0 — the language: six words, precise
  const GLY = ['hive', 'tile', 'layer', 'signature', 'bee', 'pheromone']
  GLY.forEach((w, k) => {
    const e = easeOut(sp(0, 0.04 + k * 0.11, 0.34 + k * 0.11)); if (e <= 0) return
    const x = 720 + (k - 2.5) * 150, y = 246 + 16 * (1 - e)
    s += hex(x, y, 46 * e, { sw: 1.8, op: e })
    s += glyph(w, x, y - 8, e)
    s += txt(x, y + 30, w, { size: 16, fill: 'var(--dim)', spacing: '.06em', op: e })
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
  s += glyph('hive', ROOT.x, ROOT.y, eR * 0.9)

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
    // a pheromone never changes how the tile looks (R2: it never labels; A8: appearance is the incidence's)
    s += hex(n.x, n.y, 30 * e, {
      sw: 1.8, op: e,
      fill: acted > 0 ? 'var(--honey-fill)' : 'var(--panel)', fo: acted > 0 ? 0.22 * acted : 1,
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
    s += txt(FOCUS.x, FOCUS.y + 84, SIG8.slice(0, chars), { size: 18, fill: 'var(--honey)', weight: 600 })
    if (chars < SIG8.length) s += cursor(FOCUS.x + (chars - SIG8.length / 2) * 18 * MONO_ADV + 2, FOCUS.y + 84)
    s += check(FOCUS.x + 114, FOCUS.y + 80, 1, { op: easeOut(sp(4, 0.78, 0.95)) })
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

  // beat 6 — a signed interest mark lands on the content; the tile itself is unchanged
  s += mark(PERCH.x, PERCH.y, easeOut(sp(6, 0.1, 0.38)))
  for (const [a, b] of [[0.32, 0.62], [0.48, 0.78]]) {
    const e = sp(6, a, b)
    if (e > 0 && e < 1) s += ring(PERCH.x, PERCH.y, 30 + 34 * e, (1 - e) * 0.7)
  }

  // beat 7 — replication: the work goes up to a host; the other hive asks for it,
  // takes it from the host and checks it (T1: from a host; T4: the consumer requests)
  const e7 = sp(7, 0, 1)
  const R2 = { x: 3260, y: 246, r: 48 }
  const R2L = [{ x: 3010, y: 156, r: 32 }, { x: 3010, y: 336, r: 32 }]
  const SLOT = { x: 3010, y: 246, r: 30 }
  const HOST = { x: 2740, y: 60 }
  if (e7 > 0) {
    const eT = easeOut(sp(7, 0, 0.25))
    R2L.forEach(n => { s += link(R2.x - R2.r * 0.8, R2.y, n.x + n.r, n.y, eT) })
    s += link(R2.x - R2.r * 0.8, R2.y, SLOT.x + SLOT.r, SLOT.y, eT, { dash: '4 5', dim: 0.4 })
    s += hex(R2.x, R2.y, R2.r * eT, { sw: 2.2, op: eT })
    s += glyph('hive', R2.x, R2.y, eT * 0.9)
    R2L.forEach(n => { s += hex(n.x, n.y, n.r * eT, { sw: 1.8, op: eT }) })
    // the host, drawn like the integrity clip's host nodes
    s += `<circle cx="${HOST.x}" cy="${HOST.y}" r="30" fill="var(--bg)" stroke="var(--steel)" stroke-width="1.5" opacity="${eT.toFixed(2)}"/>`
    s += txt(HOST.x, HOST.y + 5, 'host', { size: 15, spacing: '.06em', fill: 'var(--steel)', op: eT })
    // leg one: the work rises from its tile to the host
    const HELD = { x: HOST.x, y: HOST.y - 50 }
    const LEG1 = [{ x: PERCH.x, y: PERCH.y }, { x: 2540, y: 20 }, HELD]
    // leg two: only after the other hive asks does it come down to the slot
    const LEG2 = [HELD, { x: 2900, y: 60 }, { x: SLOT.x, y: SLOT.y }]
    const up = easeInOut(sp(7, 0.22, 0.48))
    const ask = easeOut(sp(7, 0.5, 0.64))
    const down = easeInOut(sp(7, 0.66, 0.9))
    const traveller = (leg, tt) => {
      const q = qbez(...leg, tt)
      let g = hex(q.x, q.y, 26, { dash: '5 4', op: 0.9 })
      for (let d = 1; d <= 3; d++) {
        const q2 = qbez(...leg, clamp01(tt - d * 0.07))
        g += `<circle cx="${q2.x.toFixed(1)}" cy="${q2.y.toFixed(1)}" r="2.2" fill="var(--honey)" opacity="${(0.5 - d * 0.13).toFixed(2)}"/>`
      }
      return g
    }
    if (up > 0 && up < 1) s += traveller(LEG1, up)
    if (up >= 1 && down <= 0) s += hex(HELD.x, HELD.y, 22, { made: true, sw: 1.6 })       // the host holds it
    const answered = sp(7, 0.92, 1)                                                        // the request is answered once the work lands
    if (ask > 0 && answered < 1) {                                                         // the request, from the reader
      const REQ = [{ x: R2.x - 24, y: R2.y - 46 }, { x: 3080, y: -10 }, { x: HELD.x + 34, y: HELD.y + 6 }]
      const pts = []
      for (let k = 0; k <= 24; k++) { const q = qbez(...REQ, ask * k / 24); pts.push(`${q.x.toFixed(1)},${q.y.toFixed(1)}`) }
      s += `<polyline points="${pts.join(' ')}" fill="none" stroke="var(--honey)" stroke-width="1.8" stroke-dasharray="4 6" opacity="${(0.7 * clamp01(ask * 3) * (1 - answered)).toFixed(3)}"/>`
    }
    if (down > 0 && down < 1) s += traveller(LEG2, down)
  }

  // beat 7's arrival is checked; beat 8 — the brood: code from someone else lands
  // in the slot and is HELD, still and dim, never run, until your hand accepts it
  // (brood.ts: held, inspectable, inert; script-preloader asks mayRunBee)
  const e8 = sp(8, 0, 1)
  const landed = sp(7, 0.9, 1) > 0
  if (landed || e8 > 0) {
    const accept = easeOut(sp(8, 0.5, 0.66))           // your hand: the check beside it
    const live = easeOut(sp(8, 0.68, 0.85))            // only then does the slot go solid and the bee move
    s += hex(SLOT.x, SLOT.y, SLOT.r, { dash: live > 0.5 ? '' : '5 4', op: 0.9, sw: 1.8 + live, made: live > 0.5 })
    const eHeld = easeOut(sp(8, 0.04, 0.3))
    s += check(SLOT.x, SLOT.y + 48, 0.9, { op: easeOut(sp(7, 0.9, 1)) * (1 - eHeld) })   // bytes checked on arrival
    if (eHeld > 0) {
      const wob = live > 0 ? Math.sin(T * 5) * 3 * live : 0
      const bx = SLOT.x + 8 * live * Math.sin(T * 1.7), by = SLOT.y + 2 + wob - 22 * (1 - eHeld)
      s += beeGlyph(bx, by, 8 * live, live > 0 ? T : 0, 0.95, eHeld * (0.4 + 0.6 * live))
      s += txt(SLOT.x, SLOT.y + 52, 'held', { size: 13, spacing: '.1em', fill: 'var(--faint-text)', op: eHeld * (1 - live) })
    }
    if (accept > 0) s += check(SLOT.x + 44, SLOT.y - 26, 1.1 * accept, { op: accept })
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
  if (chars > 0) {
    s += txt(EM.x + EM.r + 58, EM.y + 6, SIGT.slice(0, chars), { size: 20, fill: 'var(--honey)', weight: 600, anchor: 'start' })
    if (chars < SIGT.length) s += cursor(EM.x + EM.r + 58 + chars * 20 * MONO_ADV + 2, EM.y + 6, 20)
  }
  const e0c = easeOut(sp(0, 0.82, 0.98))
  if (e0c > 0) {
    s += ring(EM.x + EM.r + 326, EM.y, 26 * e0c, e0c * 0.9, { sw: 2 })
    s += check(EM.x + EM.r + 326, EM.y, 1.3 * e0c, { op: e0c })
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
    s += `<rect x="${MACH.x}" y="${MACH.y}" width="${MACH.w}" height="${MACH.h}" rx="4" fill="var(--bg)" stroke="var(--line)" stroke-width="1.5" opacity="${eT.toFixed(2)}"/>`
    s += txt(MACH.x + MACH.w / 2, MACH.y + 30, 'your machine', { size: 16, spacing: '.12em', fill: 'var(--faint-text)', op: eT * 0.9 })
    SIGS13.forEach((sig, k) => {
      const y = MACH.y + 74 + k * 56
      const tt = easeInOut(sp(1, 0.08 + k * 0.09, 0.42 + k * 0.09))
      const from = BR[k], to = { x: MACH.x + 64, y }
      if (tt > 0) {
        const q = qbez(from, { x: (from.x + to.x) / 2, y: from.y - 66 }, to, tt)
        s += `<rect x="${q.x - 38}" y="${q.y - 14}" width="76" height="28" rx="2" fill="var(--bg)" stroke="var(--honey-deep)" stroke-width="1.4" opacity=".95"/>`
        s += txt(q.x, q.y + 6, sig, { size: 16, fill: 'var(--honey)', weight: 600 })
      }
      const fill = sp(1, 0.44 + k * 0.09, 0.72 + k * 0.09)
      if (fill > 0) {
        s += `<rect x="${MACH.x + 116}" y="${y - 5}" width="180" height="10" rx="5" fill="none" stroke="var(--line)" stroke-width="1.5"/>`
        s += `<rect x="${MACH.x + 116}" y="${y - 5}" width="${180 * easeOut(fill)}" height="10" rx="5" fill="var(--honey-fill)" opacity=".8"/>`
        s += txt(MACH.x + 116 + 90, y + 28, 'sha256(bytes) = signature', { size: 15, fill: 'var(--faint-text)', op: clamp01(fill * 2) * 0.9 })
      }
      const ok = easeOut(sp(1, 0.74 + k * 0.09, 0.88 + k * 0.09))
      if (ok > 0) s += check(MACH.x + 336, y, 1.3 * ok, { op: ok })
    })
  }

  // beat 2 — each host keeps its own replica under the same name; inside each,
  // the same content is stored once (A6). You fetch from one host and check it on
  // arrival (T1: replicate from a host; S3/T2: verify before you keep it)
  const e2 = sp(2, 0, 1)
  const PEERS = [{ x: 3060, y: 138 }, { x: 3330, y: 350 }, { x: 3670, y: 118 }, { x: 3850, y: 312 }]
  const replicaAt = n => ({ x: n.x + 54, y: n.y - 26 })
  const SRC = PEERS[1]                                   // the host you happen to fetch from
  const MINE = { x: PEERS[0].x + 74, y: PEERS[0].y - 42 }  // the copy that arrives at you
  if (e2 > 0) {
    const eT = easeOut(sp(2, 0, 0.14))
    const MESH = [[0, 1], [1, 2], [2, 3], [0, 3], [1, 3]]
    MESH.forEach(([a, b]) => { s += link(PEERS[a].x, PEERS[a].y, PEERS[b].x, PEERS[b].y, eT * 0.5, { dash: '2 6', dim: 0.5 }) })
    PEERS.forEach((n, k) => {
      s += `<circle cx="${n.x}" cy="${n.y}" r="30" fill="var(--bg)" stroke="${k === 0 ? 'var(--honey)' : 'var(--steel)'}" stroke-width="${k === 0 ? 2.4 : 1.5}" opacity="${eT.toFixed(2)}"/>`
      s += txt(n.x, n.y + 5, k === 0 ? 'you' : 'host', { size: 15, spacing: '.06em', fill: k === 0 ? 'var(--honey)' : 'var(--steel)', op: eT })
    })
    const merge = easeInOut(sp(2, 0.14, 0.4))           // two uses of the same bytes, one stored copy — per host
    const eL = easeOut(sp(2, 0.36, 0.52))
    PEERS.slice(1).forEach((n, k) => {
      const r = replicaAt(n), eH = easeOut(sp(2, 0.04 + k * 0.04, 0.2 + k * 0.04))
      if (merge < 1) s += hex(r.x + 11 * (1 - merge), r.y - 6 * (1 - merge), 18, { made: true, op: eH * (1 - merge) * 0.9, sw: 1.4 })
      s += hex(r.x - 11 * (1 - merge), r.y + 6 * (1 - merge), 18, { made: true, op: eH, sw: 1.6 })
      s += txt(r.x, r.y - 30, '#e3a1', { size: 15, fill: 'var(--honey)', weight: 600, op: eL })
    })
    const R = replicaAt(SRC)
    const ask = easeInOut(sp(2, 0.58, 0.72)), back = easeInOut(sp(2, 0.74, 0.92))
    if (ask > 0 && back < 1) {
      const at = back > 0 ? { x: lerp(R.x, MINE.x, back), y: lerp(R.y, MINE.y, back) } : { x: lerp(PEERS[0].x, R.x, ask), y: lerp(PEERS[0].y, R.y, ask) }
      if (back > 0) s += hex(at.x, at.y, 13, { made: true, sw: 1.4, op: 0.95 })
      else s += `<circle cx="${at.x.toFixed(1)}" cy="${at.y.toFixed(1)}" r="5" fill="var(--honey)" opacity=".9"/>`
    }
    if (back >= 1) {
      s += hex(MINE.x, MINE.y, 14, { made: true, sw: 1.5 })
      s += txt(MINE.x, MINE.y - 52, '#e3a1', { size: 15, fill: 'var(--honey)', weight: 600 })   // the same name it had on every host
      s += check(MINE.x + 30, MINE.y, 0.9, { op: 1 - easeOut(sp(3, 0.1, 0.4)) })   // beat 3's seal takes it over
    }
  }

  // beat 3 — sharing a signature is sharing a proof: the copy that arrived proves itself
  const e3 = sp(3, 0, 1)
  if (e3 > 0) {
    const seal = easeOut(sp(3, 0.1, 0.5))
    s += ring(MINE.x, MINE.y, 34 * seal, seal * 0.9, { dash: '10 7', sw: 2.6 })
    const spin = (T * 40) % 360
    s += `<g transform="rotate(${spin.toFixed(1)} ${MINE.x} ${MINE.y})">` + ring(MINE.x, MINE.y, 42 * seal, seal * 0.5, { dash: '2 12', sw: 2 }) + '</g>'
    const ck = easeOut(sp(3, 0.45, 0.7))
    if (ck > 0) s += check(MINE.x, MINE.y, 1.4 * ck, { op: ck, sw: 2.6 })
  }
  return s
}

const hex4 = i => ((i * 2654435761 >>> 0).toString(16).padStart(8, '0')).slice(0, 4)
function timeWorld(T, p) {
  const sp = (i, a, b) => clamp01((p(i) - a) / (b - a))
  let s = ''
  const CY = 330, CW = 92, CH = 64, X0 = 240, DX = 120
  const cardX = u => X0 + u * DX
  const N = 9                                   // the strip; experiments add 9 and 10, the restore 11
  const RESTORE = 11

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
  const expandN = sp(4, 0, 1) > 0 ? RESTORE + 1 : N
  let headU = 8
  if (p(1) > 0) headU = undoU
  if (p(2) > 0) headU = scrubU
  if (p(3) > 0) headU = 2 + 4 * easeInOut(sp(3, 0.1, 0.5))                // drift to the revisions
  // beat 4: back to the live state, snapshot it, out through the experiments, then
  // restore — a new head that matches the snapshot (restore.queen.ts: append, never rewrite)
  if (p(4) > 0) headU = sp(4, 0.3, 1) > 0
    ? lerp(8, RESTORE, easeInOut(sp(4, 0.42, 0.95)))
    : lerp(6, 8, easeInOut(sp(4, 0, 0.14)))
  if (p(5) > 0) headU = RESTORE

  // session break between cards 3 and 4
  const eDiv = easeOut(sp(0, 0.7, 1))
  const divPulse = p(1) > 0 && Math.abs(undoU - 3.5) < 0.6 ? 0.6 : 0
  s += link(660, 262, 660, 408, eDiv * (0.5 + divPulse), { dash: '5 6', dim: 0.8, sw: 1.8, stroke: divPulse ? 'var(--honey)' : 'var(--faint)' })

  for (let k = 0; k < expandN; k++) {
    const exp = k >= N && k < RESTORE                                      // experimental cards, kept in history
    const e = k === RESTORE ? easeOut(sp(4, 0.74, 0.9))
            : exp ? easeOut(sp(4, 0.34 + (k - N) * 0.16, 0.6 + (k - N) * 0.16))
                  : easeOut(sp(0, 0.02 + k * 0.075, 0.3 + k * 0.075))
    const state = k === RESTORE ? 8 : k                                    // the restore holds the snapshot's state
    if (e <= 0) continue
    const x = cardX(k) + (1 - e) * (k >= N ? 60 : 220), y = CY      // beat 4's cards stay inside the frame
    const behind = p(1) > 0.05 && k > headU + 0.3 && p(2) <= 0
    const dim = behind ? 0.5 : 1
    // beat 5 — the ripple back through every immutable state
    const rip = sp(5, 0.06 + (expandN - 1 - k) * 0.05, 0.2 + (expandN - 1 - k) * 0.05)
    const lift = Math.sin(Math.PI * clamp01(rip)) * 6
    s += `<rect x="${(x - CW / 2).toFixed(1)}" y="${(y - CH / 2 - lift).toFixed(1)}" width="${CW}" height="${CH}" rx="3" ` +
      `fill="${exp ? 'var(--panel)' : 'var(--bg)'}" stroke="${rip > 0.5 ? 'var(--honey)' : exp ? 'var(--honey-deep)' : 'var(--line)'}" ` +
      `stroke-width="${rip > 0.5 ? 2 : 1.6}" ${exp ? 'stroke-dasharray="6 4" ' : ''}opacity="${(e * dim).toFixed(2)}"/>`
    s += pageAt(x, y - lift, state, 1, e * dim)
    const sigOn = p(5) > 0 ? clamp01(rip * 2) : 0
    s += txt(x, y + 52, '#' + hex4(state + 3), { size: k === 0 && sp(5, 0.75, 0.95) > 0 ? 18 : 15, fill: sigOn > 0.4 ? 'var(--honey)' : 'var(--faint-text)', weight: sigOn > 0.4 ? 600 : 400, op: e * (0.65 + 0.35 * sigOn) })
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
    s += `<rect x="560" y="64" width="320" height="168" rx="4" fill="var(--bg)" stroke="var(--honey-deep)" stroke-width="1.5" opacity="${eWin.toFixed(2)}"/>`
    s += txt(720, 90, 'rewind', { size: 16, spacing: '.12em', fill: 'var(--honey)', op: eWin * 0.9 })
    s += pageAt(720, 152, scrubU, 2.1, eWin)
    s += link(cardX(headU), 232, cardX(headU), CY - CH / 2 - 30, eWin * 0.7, { dash: '3 5', dim: 0.6 })
  }

  // beat 3 — named revisions dropping onto the strip
  ;[['adopted', 4, 0.08, 0.38], ['synced', 6, 0.45, 0.75]].forEach(([name, u, a, b]) => {
    const e = easeOut(sp(3, a, b)); if (e <= 0) return
    const x = cardX(u), ty = CY - CH / 2 - 58 + (1 - e) * -26
    s += link(x, ty + 12, x, CY - CH / 2 - 2, e * 0.8, { dim: 0.6 })
    s += `<rect x="${x - 44}" y="${ty - 14}" width="88" height="28" rx="2" fill="var(--honey-tint)" stroke="var(--honey)" stroke-width="1.4" opacity="${e.toFixed(2)}"/>`
    s += txt(x, ty + 6, name, { size: 16, fill: 'var(--honey)', weight: 600, op: e })
  })

  // beat 4 — the snapshot pin on the live state (snapshot.queen.ts: the whole hive,
  // one commit), the experiments, then the restore that comes back to it
  const ePin = easeOut(sp(4, 0.14, 0.34))
  if (ePin > 0) {
    const x = cardX(8)
    s += link(x, CY - CH / 2 - 40 * ePin, x, CY - CH / 2 - 2, ePin * 0.9, { dim: 0.8, sw: 2 })
    s += hex(x, CY - CH / 2 - 46, 11 * ePin, { made: true, sw: 2 })
    s += txt(x, CY - CH / 2 - 66, 'snapshot · whole hive', { size: 16, spacing: '.04em', fill: 'var(--honey)', op: ePin })
  }
  const eBack = easeOut(sp(4, 0.74, 0.92))
  if (eBack > 0) {
    const x = cardX(RESTORE)
    s += txt(x, CY - CH / 2 - 66, 'restore', { size: 16, spacing: '.08em', fill: 'var(--honey)', op: eBack })
  }
  return s
}

// one work, held by several hosts: each keeps its own replica under the same
// signature, checked as it arrives (T1: replicate from a host; S3: verify before
// write; A6: same content, one signature). You take it from one host you chose
// (T4: the consumer requests; T5: selection is yours) and check it yourself.
const person = (x, y, op) => op <= 0.01 ? '' :
  `<g opacity="${op.toFixed(3)}" fill="none" stroke="var(--steel)" stroke-width="1.5">` +
  `<circle cx="${x}" cy="${y - 7}" r="4.5"/><path d="M${x - 7},${y + 7} Q${x},${y - 3} ${x + 7},${y + 7}"/></g>`
function servedWorld(T, p) {
  const sp = (i, a, b) => clamp01((p(i) - a) / (b - a))
  let s = ''
  const YOU = { x: 260, y: 250 }
  const HOSTS = [{ x: 560, y: 390 }, { x: 900, y: 130 }, { x: 1110, y: 330 }]
  const ORIGIN = 2, NEXT = 1, NEAR = 0                    // made at one host, replicated on, fetched from another
  const replicaAt = n => ({ x: n.x + 54, y: n.y - 26 })
  const MINE = { x: YOU.x + 54, y: YOU.y - 26 }
  const SIG = '#e3a1'

  // beat 0 — the community: hosts, the mesh between them, you, and one work
  const eHost = k => easeOut(sp(0, 0.06 + k * 0.12, 0.36 + k * 0.12))
  const eMesh = easeOut(sp(0, 0.4, 0.7)), eYou = easeOut(sp(0, 0.5, 0.78))
  ;[[0, 1], [1, 2], [0, 2]].forEach(([a, b]) => { s += link(HOSTS[a].x, HOSTS[a].y, HOSTS[b].x, HOSTS[b].y, eMesh * 0.6, { dash: '2 6', dim: 0.5 }) })
  // you could reach any host; the one you choose is the allowance you give (beat 3)
  const allow = easeOut(sp(3, 0.05, 0.3))
  HOSTS.forEach((n, k) => {
    const chosen = k === NEAR
    s += link(YOU.x, YOU.y, n.x, n.y, eYou * (chosen ? 0.5 + 0.5 * allow : 0.5), chosen && allow > 0.3
      ? { stroke: 'var(--honey)', dim: 0.75, sw: 1.8 } : { dash: '2 6', dim: 0.35 })
  })
  HOSTS.forEach((n, k) => {
    const e = eHost(k); if (e <= 0) return
    s += `<circle cx="${n.x}" cy="${n.y}" r="30" fill="var(--bg)" stroke="var(--steel)" stroke-width="1.5" opacity="${e.toFixed(2)}"/>`
    s += txt(n.x, n.y + 5, 'host', { size: 15, spacing: '.06em', fill: 'var(--steel)', op: e })
  })
  if (eYou > 0) {
    s += `<circle cx="${YOU.x}" cy="${YOU.y}" r="30" fill="var(--bg)" stroke="var(--honey)" stroke-width="2.4" opacity="${eYou.toFixed(2)}"/>`
    s += txt(YOU.x, YOU.y + 5, 'you', { size: 15, spacing: '.06em', fill: 'var(--honey)', op: eYou })
  }

  // beat 1 — hosts are run by the people who use them; one is shared with friends
  HOSTS.forEach((n, k) => {
    const e = easeOut(sp(1, 0.05 + k * 0.1, 0.3 + k * 0.1))
    s += person(n.x - 44, n.y + 40, e); s += person(n.x - 20, n.y + 48, e)
  })
  const F = HOSTS[NEXT]
  ;[{ x: F.x - 86, y: F.y - 34 }, { x: F.x - 50, y: F.y - 58 }].forEach((q, j) => {
    const e = easeOut(sp(1, 0.55 + j * 0.12, 0.8 + j * 0.12))
    s += link(q.x + 9, q.y + 2, F.x - 22, F.y - 20, e, { dash: '3 4', dim: 0.4 })
    s += person(q.x, q.y, e)
  })

  // the work and its replicas: each host's own copy, the same signature
  const replica = (n, e, checked) => {
    if (e <= 0) return ''
    const r = replicaAt(n)
    return hex(r.x, r.y, 18 * e, { made: true, sw: 1.6, op: e }) +
      txt(r.x, r.y - 30, SIG, { size: 15, fill: 'var(--honey)', weight: 600, op: e }) +
      (checked > 0 ? check(r.x + 32, r.y, 0.9 * checked, { op: checked }) : '')
  }
  const travel = (a, b, tt) => {
    if (tt <= 0 || tt >= 1) return ''
    const A = replicaAt(a), B = replicaAt(b), c = { x: (A.x + B.x) / 2, y: Math.min(A.y, B.y) - 70 }
    let g = hex(qbez(A, c, B, tt).x, qbez(A, c, B, tt).y, 14, { made: true, sw: 1.4, op: 0.95 })
    for (let d = 1; d <= 3; d++) {
      const q = qbez(A, c, B, clamp01(tt - d * 0.07))
      g += `<circle cx="${q.x.toFixed(1)}" cy="${q.y.toFixed(1)}" r="2.2" fill="var(--honey)" opacity="${(0.5 - d * 0.13).toFixed(2)}"/>`
    }
    return g
  }
  // the maker's own host checks it too as it is written (S3), so "every replica
  // checked" shows a check on every replica, the first one included
  const eCap = easeOut(sp(2, 0.8, 0.96))
  s += replica(HOSTS[ORIGIN], easeOut(sp(0, 0.62, 0.9)), eCap)

  // beat 2 — replicated host to host, each replica checked against its signature
  const t1 = easeInOut(sp(2, 0.06, 0.32)), t2 = easeInOut(sp(2, 0.42, 0.68))
  s += travel(HOSTS[ORIGIN], HOSTS[NEXT], t1)
  s += replica(HOSTS[NEXT], t1 >= 1 ? 1 : 0, easeOut(sp(2, 0.32, 0.42)))
  s += travel(HOSTS[NEXT], HOSTS[NEAR], t2)
  s += replica(HOSTS[NEAR], t2 >= 1 ? 1 : 0, easeOut(sp(2, 0.68, 0.78)))
  s += txt(720, 470, `${SIG} · every replica checked`, { size: 16, fill: 'var(--honey)', weight: 600, op: eCap })

  // beat 3 — you ask the host you chose, take its replica and check it yourself
  const R = replicaAt(HOSTS[NEAR])
  const ask = easeInOut(sp(3, 0.32, 0.5)), back = easeInOut(sp(3, 0.52, 0.78))
  if (ask > 0 && back < 1) {
    if (back > 0) s += hex(lerp(R.x, MINE.x, back), lerp(R.y, MINE.y, back), 13, { made: true, sw: 1.4, op: 0.95 })
    else s += `<circle cx="${lerp(YOU.x, R.x, ask).toFixed(1)}" cy="${lerp(YOU.y, R.y, ask).toFixed(1)}" r="5" fill="var(--honey)" opacity=".9"/>`
  }
  if (back >= 1) {
    s += hex(MINE.x, MINE.y, 16, { made: true, sw: 1.6 })
    s += txt(MINE.x, MINE.y - 30, SIG, { size: 15, fill: 'var(--honey)', weight: 600 })
    s += check(MINE.x + 32, MINE.y, 0.9 * easeOut(sp(3, 0.8, 0.92)))
  }

  // beat 5 — served by everyone: every place that holds it, alive
  const e5 = sp(5, 0, 1)
  if (e5 > 0) {
    [...HOSTS.map(replicaAt), MINE].forEach((r, k) => {
      const o = (0.3 + 0.24 * Math.sin(T * 2.1 + k * 1.7)) * easeOut(sp(5, 0, 0.3))
      s += ring(r.x, r.y, 28, Math.max(0, o), { sw: 1.6 })
    })
  }
  return s
}

// ---------- clip definitions -------------------------------------------------
const CLIPS = {
  vocabulary: {
    scene: 8, file: 'concept-vocabulary.mp4', world: vocabularyWorld,
    beats: [
      { term: 'the language', gloss: 'precise words', cam: { x: 720, y: 246, s: 1.0 } },
      { term: 'hive', gloss: 'your own place, kept', cam: { x: 2215, y: 246, s: 1.25 } },
      { term: 'tile', gloss: 'one piece of content', cam: { x: 2238, y: 246, s: 2.5 } },
      { term: 'layer', gloss: 'one moment of a place, kept', cam: { x: 2200, y: 238, s: 2.0 } },
      { term: 'signature', gloss: 'the name the content gives itself', cam: { x: 2230, y: 282, s: 2.0 } },
      { term: 'bee', gloss: 'acts when needed, or on its word', cam: { x: 2280, y: 226, s: 1.25 } },
      { term: 'pheromone', gloss: 'a signed signal of interest', cam: { x: 2350, y: 250, s: 1.25 } },
      { term: 'replication', gloss: 'work crossing hives, checked', cam: { x: 2740, y: 240, s: 0.56 } },
      { term: 'brood', gloss: 'held, never run, until you accept', cam: { x: 3090, y: 246, s: 1.7 } },
      { term: 'colony', gloss: 'a domain and its hives; none in charge', cam: { x: 2620, y: 246, s: 0.55 } },
    ],
  },
  integrity: {
    scene: 13, file: 'concept-integrity.mp4', world: integrityWorld,
    beats: [
      { term: 'integrity', gloss: 'verify, don’t trust', cam: { x: 760, y: 240, s: 1.15 } },
      { term: 'share = signatures', gloss: 'every byte proven on arrival', cam: { x: 1990, y: 240, s: 0.92 } },
      { term: 'one name', gloss: 'any host can serve it', cam: { x: 3585, y: 215, s: 0.76 } },
      { term: 'proof', gloss: 'sharing a signature is sharing a proof', cam: { x: 3070, y: 110, s: 1.55 } },
    ],
  },
  time: {
    scene: 14, file: 'concept-time.mp4', world: timeWorld,
    beats: [
      { term: 'time', gloss: 'on your side', cam: { x: 720, y: 288, s: 1.0 } },
      { term: 'undo', gloss: 'across sessions', cam: { x: 720, y: 288, s: 1.0 } },
      { term: 'rewind', gloss: 'scrub what a page used to be', cam: { x: 720, y: 240, s: 1.0 } },
      { term: 'revisions', gloss: 'updates wait for you', cam: { x: 720, y: 270, s: 1.0 } },
      { term: 'snapshots', gloss: 'try something risky, come back', cam: { x: 880, y: 278, s: 0.9 } },
      { term: 'immutable', gloss: 'the past is one signature away', cam: { x: 840, y: 282, s: 0.86 } },
    ],
  },
  served: {
    scene: 17, file: 'concept-served.mp4', world: servedWorld,
    beats: [
      { term: 'community', gloss: 'carried by the people who use it', cam: { x: 700, y: 250, s: 1.0 } },
      { term: 'hosts', gloss: 'run by people, shared with friends', cam: { x: 700, y: 260, s: 1.0 } },
      { term: 'replicas', gloss: 'every replica checked', cam: { x: 720, y: 246, s: 1.0 } },
      { term: 'trust', gloss: 'an allowance you give', cam: { x: 690, y: 250, s: 1.0 } },
      { term: 'no tracking', gloss: 'not one statistic about you', cam: { x: 690, y: 250, s: 1.0 } },
      { term: 'served by everyone', gloss: 'secured by your peers', cam: { x: 700, y: 246, s: 0.97 } },
    ],
  },
}

// ---------- frame assembly ---------------------------------------------------
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
// the pane is the plate's material: panel ground, the stage comb barely there, the page's faces
const PAGE_CSS = `${STYLE}
  html,body{width:${W}px;background:var(--panel)}
  .pane{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:var(--panel)}
  .pane svg.comb{position:absolute;inset:0;width:100%;height:100%;opacity:.7}
  .pane svg.stage{position:absolute;inset:0;width:100%;height:100%}
  .pane svg.stage text{font-family:var(--sans);font-weight:400}
  .pane svg.stage text.m{font-family:var(--mono)}`
const COMB = `<svg class="comb"><defs>
  <pattern id="hexp" width="56" height="97" patternUnits="userSpaceOnUse" patternTransform="scale(1.6)">
    <polygon points="28,0 56,16.2 56,48.5 28,64.7 0,48.5 0,16.2" fill="none" stroke="var(--hexline)" stroke-width="1"/>
    <polygon points="28,0 56,16.2 56,48.5 28,64.7 0,48.5 0,16.2" fill="none" stroke="var(--hexline)" stroke-width="1" transform="translate(28,48.5)"/>
    <polygon points="28,0 56,16.2 56,48.5 28,64.7 0,48.5 0,16.2" fill="none" stroke="var(--hexline)" stroke-width="1" transform="translate(-28,48.5)"/>
  </pattern></defs><rect width="120%" height="120%" fill="url(#hexp)"/></svg>`

function paneAt(clip, starts, audioDur, T0) {
  const T = Math.max(T0, LEAD)              // the lead-in: the first half second holds the opened world
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
    txt(46, 66, esc(b.term), { size: 30, fill: 'var(--honey)', anchor: 'start', weight: 500, sans: true, op }) +
    txt(47, 94, esc(b.gloss).toUpperCase(), { size: 17, fill: 'var(--faint-text)', anchor: 'start', spacing: '.2em', op: op * 0.9 })
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
    ...(process.getuid && process.getuid() === 0 ? ['--no-sandbox'] : []),   // a root container refuses the sandbox
    `--window-size=${W},${H * rows}`, '--virtual-time-budget=4000',
    `--screenshot=${stripPng}`, require('url').pathToFileURL(htmlPath).href], { stdio: 'ignore' })
  const deadline = Date.now() + 30_000
  let size = -1
  for (;;) {
    if (Date.now() > deadline) throw new Error(`filmstrip never appeared: ${path.basename(stripPng)}`)
    let z = -1
    try { z = fs.statSync(stripPng).size } catch {}
    if (z > 0 && z === size) break
    size = z
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200)
  }
  try { fs.unlinkSync(htmlPath) } catch {}
  return parseInt(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=height', '-of', 'csv=p=0', stripPng], { encoding: 'utf8' }).trim(), 10)
}
const ff = (...a) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...a], { stdio: 'inherit' })

function drawClip(name) {
  const clip = CLIPS[name]
  const say = sceneSay(clip.scene)
  const { starts, audioDur, fromText } = beatTimes(say, clip.beats.length)
  if (fromText) console.log(`${name}: no recorded narration for scene ${clip.scene} yet — beats timed from the text at ${WORDS_PER_SEC} words/s; run build.cjs, then this again, to re-time from the voice`)
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
