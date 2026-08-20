// The three structural verbs, in one short reel.
//
// break apart goes DEEPER, organize goes SHALLOWER, expand goes WIDER — the three
// are only really legible next to each other, which is what this cut is for.
// Same shell, same narrator and the same audio contract as the full piece
// (en-US-AndrewMultilingualNeural at +2%, cached by the words), so a line can
// change without re-voicing the rest.
//
// The verb beats are DRAWN, not captured: each is a real animation rendered
// frame by frame, because what a verb does is a MOVEMENT — children fanning
// out, a crowded level folding into groups, a row spreading to make room — and
// a still of the after-state shows none of it. Frames are shot in filmstrips
// (many frames per headless launch) because the launch, not the drawing, is
// what costs.
//
//   node verbs.cjs              → verbs/hypercomb-verbs.mp4
//   node verbs.cjs --frames     → draw the frames only, no encode
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')

const ROOT = __dirname
const OUT = path.join(ROOT, 'verbs')
const WORK = path.join(OUT, 'frames')
const CACHE = path.join(ROOT, 'audio-cache')          // the SAME cache the full build fills
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const VOICE = 'en-US-AndrewMultilingualNeural'
const RATE = '+2%'
const W = 1280, H = 720
const FPS = 12                                        // drawn rate; encoded at 30
const TAIL = 0.6                                      // a breath after each line, as in the full cut
let STRIP_ROWS = 12                                   // frames per headless launch (shrinks if a shot comes back short)

for (const d of [OUT, WORK, CACHE]) fs.mkdirSync(d, { recursive: true })

// the shell's design tokens, lifted from the real template so this cannot drift
const shell = fs.readFileSync(path.join(ROOT, 'template.html'), 'utf8')
const STYLE = (shell.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || ''

// ---------- geometry ---------------------------------------------------------
// Pointy-top hexes, the same orientation as the shell's ambient comb.
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
// honey fill marks what the verb JUST MADE; white is what was already there.
const hex = (cx, cy, r, o = {}) => r <= 0.5 || (o.op ?? 1) <= 0.004 ? '' :
  `<polygon points="${hexPoints(cx, cy, r)}" fill="${o.made ? 'var(--honey-glow)' : '#fff'}" ` +
  `stroke="${o.made ? 'var(--honey)' : 'var(--honey-deep)'}" stroke-width="${o.sw ?? 2}" ` +
  `opacity="${(o.op ?? 1).toFixed(3)}"/>`
const link = (x1, y1, x2, y2, op) => op <= 0.01 ? '' :
  `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" ` +
  `stroke="var(--honey-deep)" stroke-width="1.6" opacity="${(op * 0.5).toFixed(3)}"/>`

// ---------- the three movements ----------------------------------------------
// Each takes normalised time and returns the drawing at that instant.

// DEEPER — one leaf, then the parts it is composed of, fanning out beneath it.
function drawBreakApart(t) {
  const PX = 640, PY = 208, PR = 62, CY = 452, CR = 44, N = 5
  let s = ''
  for (let i = 0; i < N; i++) {
    const e = easeOut((t - (0.20 + i * 0.105)) / 0.24)
    if (e <= 0) continue
    const cx = PX + (i - (N - 1) / 2) * 112
    const cy = CY - 22 * (1 - e)
    s += link(PX, PY + PR, cx, cy - CR * e, e)
  }
  s += hex(PX, PY, PR, { sw: 2.4 })
  for (let i = 0; i < N; i++) {
    const e = easeOut((t - (0.20 + i * 0.105)) / 0.24)
    if (e <= 0) continue
    s += hex(PX + (i - (N - 1) / 2) * 112, CY - 22 * (1 - e), CR * e, { made: true, op: e })
  }
  return s
}

// SHALLOWER — a crowded level, a level inserted above it, and the tiles that
// were already there travelling into named groups. Nothing new is minted below.
function drawOrganize(t) {
  const GROUPS = [4, 4, 3, 3], TOTAL = 14
  const flat = []
  for (let i = 0; i < TOTAL; i++) {
    const row = i < 7 ? 0 : 1, col = i % 7
    flat.push({ x: 640 + (col - 3) * 62 + (row ? 31 : 0), y: row ? 356 : 304, r: 32 })
  }
  const home = []
  let i = 0
  GROUPS.forEach((n, g) => {
    const gx = 640 + (g - 1.5) * 248
    for (let j = 0; j < n; j++, i++) home.push({ x: gx + (j - (n - 1) / 2) * 52, y: 428, r: 26, g })
  })
  const groupIn = easeOut((t - 0.22) / 0.22)
  const gpos = GROUPS.map((_, g) => ({ x: 640 + (g - 1.5) * 248, y: 244, r: 48 }))

  let s = ''
  for (let k = 0; k < TOTAL; k++) {
    const m = easeInOut((t - (0.36 + (k % 7) * 0.016)) / 0.42)
    if (m <= 0) continue
    const p = home[k], q = gpos[p.g]
    s += link(q.x, q.y + q.r, lerp(flat[k].x, p.x, m), lerp(flat[k].y, p.y, m) - p.r, m * m)
  }
  gpos.forEach(q => { s += hex(q.x, q.y, q.r * easeOut((t - 0.22) / 0.22), { made: true, op: groupIn }) })
  for (let k = 0; k < TOTAL; k++) {
    const m = easeInOut((t - (0.36 + (k % 7) * 0.016)) / 0.42)
    const p = home[k], f = flat[k]
    s += hex(lerp(f.x, p.x, m), lerp(f.y, p.y, m), lerp(f.r, p.r, m), { sw: 1.8 })
  }
  return s
}

// WIDER — the row spreads to make room, and the siblings the subject was
// missing arrive in the gaps. Nothing already on the layer is duplicated.
function drawExpand(t) {
  const Y = 358, R = 52, GAP = 120
  const spread = easeInOut((t - 0.12) / 0.42)
  let s = ''
  const xs = []
  for (let k = 0; k < 4; k++) xs.push(lerp(640 + (k - 1.5) * GAP, 640 + (2 * k - 3) * GAP, spread))
  for (let m = 0; m < 3; m++) {
    const e = easeOut((t - (0.50 + m * 0.115)) / 0.2)
    if (e <= 0) continue
    s += hex(640 + (2 * m - 2) * GAP, Y, R * e, { made: true, op: e })
  }
  xs.forEach(x => { s += hex(x, Y, R, { sw: 2.2 }) })
  return s
}

const MOVEMENT = { 'break-apart': drawBreakApart, organize: drawOrganize, expand: drawExpand }

// ---------- the reel ---------------------------------------------------------
const BEATS = [
  { id: 'open', kind: 'still',
    body: `<div class="eyebrow">three structural verbs</div><h1>Three ways to <b>reshape</b> a hive.</h1>
           <p class="sub">One goes deeper. One goes shallower. One goes wider.</p>`,
    say: `A hive has three structural verbs. One goes deeper, one goes shallower, and one goes wider.` },

  { id: 'break-apart', kind: 'move', verb: '/break-apart', gloss: 'go deeper',
    say: `Break apart goes deeper. Point at a tile that has no parts yet, and it is broken into the pieces that compose it.` },

  { id: 'organize', kind: 'move', verb: '/organize', gloss: 'go shallower',
    say: `Organize goes the other way. A crowded layer has a level inserted above it, and the tiles already there are re-homed into named groups.` },

  { id: 'expand', kind: 'move', verb: '/expand', gloss: 'go wider',
    say: `Expand goes wider. It reads what the layer already holds, and adds the siblings the subject is missing.` },

  { id: 'bridge', kind: 'still',
    body: `<div class="eyebrow">no api key, no account</div><h1>The hive <b>asks</b>. Your session <b>builds</b>.</h1>
           <p class="sub">Each verb mints an ask. A Claude session parked on the bridge answers it — and for organize it only advises, because the hive is the one that moves your tiles.</p>`,
    say: `All three ask the same way, over the bridge. The hive mints an ask and a Claude session you have parked answers it. Nothing is billed to a pasted key, and no model ever moves a tile — it advises, and the hive moves.` },

  { id: 'close', kind: 'still',
    body: `<div class="eyebrow">deeper · shallower · wider</div><h1><b>break apart</b> · <b>organize</b> · <b>expand</b></h1>
           <p class="sub">Type the slash and the verb. The layer takes the shape you meant.</p>
           <div class="golink" style="margin-top:1.5vh">hypercomb.io</div>`,
    say: `Break apart, organize, expand. Three words, and the shape of your hive follows what you actually mean.` },
]

// ---------- narration --------------------------------------------------------
// Same key as the full build: the words are the cache address, so a line that
// already exists anywhere in the presentation costs nothing here.
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

// ---------- pages ------------------------------------------------------------
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
  .tag{position:absolute;top:46px;left:0;right:0;text-align:center;font-family:var(--mono)}
  .tag b{font-weight:600;font-size:30px;color:var(--honey);letter-spacing:.02em}
  .tag span{display:block;margin-top:8px;font-size:12px;letter-spacing:.42em;text-transform:uppercase;color:var(--faint)}
  #cap{position:absolute;left:50%;bottom:44px;transform:translateX(-50%);width:1040px;text-align:center;
    color:var(--ink);font-weight:400;font-size:25px;line-height:1.45;
    background:rgba(255,255,255,.94);border:1px solid var(--line);border-radius:12px;padding:20px 26px}
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

// ---------- shooting ---------------------------------------------------------
// One headless launch per FILMSTRIP: the panes stack down a tall page, the
// screenshot takes them all, and untile cuts them back into frames.
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

// Draw a movement's frames into WORK/<id>/f0001.png …
function drawMovement(b, motionSeconds) {
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
      if (got < H * rows) {                    // the compositor capped the surface — take less at a time
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

// ---------- assemble ---------------------------------------------------------
;(async () => {
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
      // Move for most of the line, then hold the finished shape while the
      // sentence lands — a movement that outruns its own narration reads as a
      // glitch, and one that stops dead reads as a broken clip.
      const motion = Math.max(2.5, Math.min(dur - 1.4, 8))
      const { dir, total } = drawMovement(b, motion)
      if (framesOnly) continue
      const hold = Math.max(0.2, dur - total / FPS)
      ff('-framerate', String(FPS), '-i', path.join(dir, 'f%04d.png'), '-i', audio, '-t', String(dur),
        '-vf', `fps=30,tpad=stop_mode=clone:stop_duration=${hold.toFixed(2)},format=yuv420p,` +
               `fade=in:0:12,fade=out:${fadeOut}:12`,
        '-c:v', 'libx264', '-crf', '21', '-preset', 'medium',
        '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2', '-shortest', seg)
    }
    segs.push(seg)
    console.log(`  ${b.id.padEnd(10)} ${dur.toFixed(1)}s`)
  }
  if (framesOnly) { console.log('\nframes only — nothing encoded'); return }

  const list = path.join(OUT, 'segments.txt')
  fs.writeFileSync(list, segs.map(s => `file '${s.replace(/\\/g, '/')}'`).join('\n'))
  const final = path.join(OUT, 'hypercomb-verbs.mp4')
  ff('-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', final)
  const total = durationOf(final)
  console.log(`\n${final}\n${total.toFixed(1)}s · ${(fs.statSync(final).size / 1e6).toFixed(1)} MB · ${W}x${H} · H.264/AAC`)
})().catch(e => { console.error('verbs failed:', e.message); process.exit(1) })
