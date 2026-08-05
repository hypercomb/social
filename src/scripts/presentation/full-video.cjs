// The whole presentation as one MP4 — for anywhere that will not run a page.
//
// Nothing is re-voiced: every scene's narration is already in the audio cache,
// keyed by its words, so this only has to draw each scene and cut it to the
// length of its own line. Film scenes use the real capture; the rest are shot
// from the compiled page itself, so the video cannot drift from the site.
//
//   node full-video.cjs            → full/hypercomb-presentation.mp4
//   node full-video.cjs --frames   → redraw the frames only
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')

const ROOT = __dirname
const OUT = path.join(ROOT, 'full')
const FRAMES = path.join(OUT, 'frames')
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const VOICE = 'en-US-AndrewMultilingualNeural'
const RATE = '+2%'
const W = 1280, H = 720
const TAIL = 0.6                       // a breath between scenes

for (const d of [OUT, FRAMES]) fs.mkdirSync(d, { recursive: true })

const scenes = fs.readdirSync(path.join(ROOT, 'scenes')).filter(f => f.endsWith('.json')).sort()
  .map(f => JSON.parse(fs.readFileSync(path.join(ROOT, 'scenes', f), 'utf8')))

const rulesPath = path.join(ROOT, 'pronunciations.json')
const RULES = fs.existsSync(rulesPath) ? JSON.parse(fs.readFileSync(rulesPath, 'utf8')) : []
const spokenOf = say => RULES.reduce((t, r) => r && r.match && r.say ? t.split(r.match).join(r.say) : t, say)
const hashOf = say => crypto.createHash('sha256').update(`${VOICE}|${RATE}|${spokenOf(say)}`).digest('hex').slice(0, 16)
const audioFor = s => path.join(ROOT, 'audio-cache', hashOf(s.say) + '.mp3')

const dist = path.join(ROOT, 'dist', 'hypercomb-presentation.html')
if (!fs.existsSync(dist)) throw new Error('run build.cjs first')
const html = fs.readFileSync(dist, 'utf8')

// ---------- draw each scene from the built page ------------------------------
function shoot(n) {
  const png = path.join(FRAMES, `s${String(n).padStart(2, '0')}.png`)
  const tmp = path.join(FRAMES, `v${n}.html`)
  const inject = [
    "document.getElementById('enter').click();",
    `setPlayingSilent(false); goto(${n - 1}, true);`,
    // the chrome belongs to the page, not to a video file
    "document.getElementById('bar').style.display='none';",
    "document.getElementById('caption').style.bottom='4.5vh';",
    "document.querySelectorAll('.scene').forEach(function(s){s.style.transition='none'});",
    "document.querySelectorAll('video').forEach(function(v){try{v.pause();v.currentTime=0.6}catch(e){}});",
    '</script>',
  ].join('\n')
  fs.writeFileSync(tmp, html.replace(/<\/script>\s*$/, inject))
  try { fs.unlinkSync(png) } catch {}
  execFileSync(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
    `--window-size=${W},${H}`, '--virtual-time-budget=8000',
    `--screenshot=${png}`, 'file:///' + tmp.split(path.sep).join('/')], { stdio: 'ignore' })
  let waited = 0
  while (!fs.existsSync(png) && waited < 25000) {
    execFileSync('powershell', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 400'], { stdio: 'ignore' })
    waited += 400
  }
  if (!fs.existsSync(png)) throw new Error(`frame never appeared for scene ${n}`)
  try { fs.unlinkSync(tmp) } catch {}
  return png
}

const ff = (...a) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...a], { stdio: 'inherit' })
const durationOf = f => parseFloat(execFileSync('ffprobe',
  ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim())

const framesOnly = process.argv.includes('--frames')
const segs = []
let total = 0

for (const s of scenes) {
  const audio = audioFor(s)
  if (!fs.existsSync(audio)) throw new Error(`scene ${s.n} has no narration cached — run build.cjs`)
  const dur = durationOf(audio) + TAIL
  const png = shoot(s.n)
  if (framesOnly) { console.log(`scene ${String(s.n).padStart(2)} drawn`); continue }

  const seg = path.join(OUT, `.seg-${String(s.n).padStart(2, '0')}.mp4`)
  const fadeOut = Math.max(1, Math.round(dur * 30) - 15)
  // Film scenes hold the page's own paused frame. Compositing the moving clip
  // back in means guessing the frame's rect in CSS pixels, and a guess that is
  // four pixels out is worse than a still — the motion lives on the page and in
  // the social cuts, which letterbox the clip full-bleed instead.
  const film = (s.visual || '').startsWith('film')
  ff('-loop', '1', '-i', png, '-i', audio, '-t', String(dur),
    '-vf', `fps=30,format=yuv420p,fade=in:0:15,fade=out:${fadeOut}:15`,
    '-c:v', 'libx264', '-crf', '21', '-preset', 'medium',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2', '-shortest', seg)
  segs.push(seg); total += dur
  console.log(`scene ${String(s.n).padStart(2)} ${s.name.padEnd(30)} ${dur.toFixed(1)}s${film ? '  (still of the capture)' : ''}`)
}
if (framesOnly) return

const list = path.join(OUT, 'segments.txt')
fs.writeFileSync(list, segs.map(s => `file '${s.replace(/\\/g, '/')}'`).join('\n'))
const final = path.join(OUT, 'hypercomb-presentation.mp4')
ff('-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', final)
for (const s of segs) { try { fs.unlinkSync(s) } catch {} }
try { fs.unlinkSync(list) } catch {}

const mins = Math.floor(durationOf(final) / 60), secs = Math.round(durationOf(final) % 60)
console.log(`\n${final}`)
console.log(`${mins}m ${secs}s · ${(fs.statSync(final).size / 1e6).toFixed(1)} MB · ${W}x${H} · H.264/AAC`)
