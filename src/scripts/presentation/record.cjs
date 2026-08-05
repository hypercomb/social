// Read it yourself, and have it sit beside everything else.
//
// The audio cache is keyed by the words, so a human take is a FILE DROP: record
// scene 5, drop it in, and scene 5 is you while the other 23 are untouched. You
// can convert the whole thing one scene at a time.
//
//   node record.cjs --script     # a teleprompter to read from (record/script.html)
//   node record.cjs --check      # which scenes have takes, which drifted
//   node record.cjs              # master every take and seed it into the cache
//
// Put takes in record/ named by scene: scene-01.wav, scene-05.m4a, …
// (wav/flac preferred — master from the cleanest source you have.)
//
// Mastering is a broadcast chain: rumble filter, gentle de-noise, de-esser,
// light compression, then TWO-PASS EBU R128 loudness normalisation. The second
// pass is what makes twenty-four separate takes sit at the same level — which
// is the thing that actually reads as "produced".
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')

const ROOT = __dirname
const TAKES = path.join(ROOT, 'record')
const MASTERED = path.join(TAKES, 'mastered')
const CACHE = path.join(ROOT, 'audio-cache')
const VOICE = 'en-US-AndrewMultilingualNeural'
const RATE = '+2%'
const LUFS = -16, TRUE_PEAK = -1.5, LRA = 11      // podcast/broadcast target
const AUDIO_EXT = ['.wav', '.flac', '.m4a', '.mp3', '.aac', '.ogg', '.webm']

fs.mkdirSync(TAKES, { recursive: true })
fs.mkdirSync(MASTERED, { recursive: true })

const scenes = fs.readdirSync(path.join(ROOT, 'scenes')).filter(f => f.endsWith('.json')).sort()
  .map(f => JSON.parse(fs.readFileSync(path.join(ROOT, 'scenes', f), 'utf8')))

// the same key the build uses, so a take lands exactly where the build looks
const rulesPath = path.join(ROOT, 'pronunciations.json')
const RULES = fs.existsSync(rulesPath) ? JSON.parse(fs.readFileSync(rulesPath, 'utf8')) : []
const spokenOf = say => RULES.reduce((t, r) => r && r.match && r.say ? t.split(r.match).join(r.say) : t, say)
const hashOf = say => crypto.createHash('sha256').update(`${VOICE}|${RATE}|${spokenOf(say)}`).digest('hex').slice(0, 16)
const PAUSE = /\[pause(?::(\d+))?\]/g

const ledgerPath = path.join(TAKES, 'takes.json')
const ledger = fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath, 'utf8')) : {}

const takeFor = n => {
  for (const ext of AUDIO_EXT) {
    const f = path.join(TAKES, `scene-${String(n).padStart(2, '0')}${ext}`)
    if (fs.existsSync(f)) return f
  }
  return null
}

// ---------- the teleprompter -------------------------------------------------
function writeScript() {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const cards = scenes.map(s => {
    const lines = esc(s.say).replace(PAUSE, (_, ms) =>
      `<span class="pause">⏸ hold ${((Number(ms) || 700) / 1000).toFixed(1)}s</span>`)
    const has = takeFor(s.n)
    return `<section${has ? ' class="done"' : ''}>
      <div class="bar"><span class="n">scene ${s.n}</span><span class="nm">${esc(s.name)}</span>
        <span class="file">record/scene-${String(s.n).padStart(2, '0')}.wav</span>
        ${has ? '<span class="tick">✓ recorded</span>' : ''}</div>
      <p>${lines}</p></section>`
  }).join('')
  const html = `<meta charset="utf-8"><title>Read this — Hypercomb narration</title><style>
    :root{--bg:#0f1115;--ink:#f2efe6;--dim:#8b93a0;--honey:#f2b632;--line:#242a33}
    *{box-sizing:border-box}
    body{margin:0;background:var(--bg);color:var(--ink);font:400 17px/1.5 "Segoe UI",system-ui,sans-serif}
    header{position:sticky;top:0;background:linear-gradient(180deg,var(--bg) 70%,transparent);padding:22px 6vw 14px;z-index:2}
    h1{margin:0 0 4px;font-size:21px;font-weight:600}
    .how{color:var(--dim);font-size:14px;max-width:70ch}
    .how b{color:var(--honey);font-weight:600}
    section{padding:26px 6vw;border-top:1px solid var(--line)}
    section.done{opacity:.45}
    .bar{display:flex;gap:14px;align-items:baseline;flex-wrap:wrap;margin-bottom:12px;
      font:600 11px/1 ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase}
    .n{color:var(--honey)} .nm{color:var(--ink)} .file{color:var(--dim);letter-spacing:.06em;text-transform:none}
    .tick{color:#7bd6a0}
    section p{font-size:clamp(20px,2.5vw,30px);line-height:1.55;max-width:34ch;margin:0;font-weight:300}
    .pause{display:inline-block;margin:0 .3em;padding:.1em .5em;border:1px dashed var(--honey);border-radius:6px;
      color:var(--honey);font:600 .5em/1.6 ui-monospace,monospace;letter-spacing:.1em;vertical-align:middle}
    @media print{body{background:#fff;color:#000}section{break-inside:avoid}}
  </style>
  <header><h1>Read this</h1><div class="how">
    One file per scene, named <b>record/scene-05.wav</b> and so on — you don't have to do them all,
    and you can do them in any order. Leave a breath of silence at the top and tail of each take;
    it gets trimmed. Where you see <b>⏸ hold</b>, actually hold it — the silence is part of the line.
    Then run <b>node record.cjs</b>.</div></header>${cards}`
  fs.writeFileSync(path.join(TAKES, 'script.html'), html)
  console.log(`record/script.html — ${scenes.length} scenes, ${scenes.filter(s => takeFor(s.n)).length} already recorded`)
}

// ---------- mastering --------------------------------------------------------
const CLEANUP = [
  'highpass=f=80',                        // room rumble and handling noise
  'afftdn=nf=-25',                        // gentle broadband de-noise
  'deesser=i=0.4',                        // tame sibilance
  'acompressor=threshold=-18dB:ratio=3:attack=8:release=250',
  // Trim the run-up only, and KEEP 0.2s of it. Never touch the tail or use
  // stop_periods here: silenceremove would cut at the first pause inside the
  // line, and the pauses are the performance.
  'silenceremove=start_periods=1:start_silence=0.2:start_threshold=-50dB',
].join(',')

function measure(file) {
  // pass one: find out what we actually have. loudnorm reports on STDERR.
  const { spawnSync } = require('child_process')
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af',
    `${CLEANUP},loudnorm=I=${LUFS}:TP=${TRUE_PEAK}:LRA=${LRA}:print_format=json`,
    '-f', 'null', '-'], { encoding: 'utf8' })
  const text = `${r.stderr || ''}${r.stdout || ''}`
  const open = text.lastIndexOf('{'), close = text.lastIndexOf('}')
  if (open < 0 || close < open) throw new Error(`could not measure ${path.basename(file)} — ffmpeg said:\n${text.slice(-400)}`)
  return JSON.parse(text.slice(open, close + 1))
}

function master(file, out) {
  const m = measure(file)
  // pass two: apply it with the measurements, which is what makes takes match
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', file, '-af',
    `${CLEANUP},loudnorm=I=${LUFS}:TP=${TRUE_PEAK}:LRA=${LRA}:` +
    `measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:` +
    `measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`,
    '-ar', '44100', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '96k', out],
    { stdio: ['ignore', 'ignore', 'inherit'] })
  return m
}

const durationOf = f => parseFloat(execFileSync('ffprobe',
  ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim())

// ---------- run --------------------------------------------------------------
if (process.argv.includes('--script')) { writeScript(); return }

const rows = scenes.map(s => {
  const take = takeFor(s.n)
  const wanted = hashOf(s.say)
  const rec = ledger[s.n]
  return { s, take, wanted, drifted: !!(rec && rec.hash !== wanted), seeded: fs.existsSync(path.join(CACHE, wanted + '.mp3')) && rec && rec.hash === wanted }
})

if (process.argv.includes('--check')) {
  for (const r of rows) {
    const state = !r.take ? 'no take — the built voice is used'
      : r.drifted ? '⚠ the script changed since you recorded this — re-record'
      : r.seeded ? '✓ yours' : 'take waiting — run node record.cjs'
    console.log(`  ${String(r.s.n).padStart(2)} ${r.s.name.padEnd(30)} ${state}`)
  }
  const mine = rows.filter(r => r.seeded).length
  console.log(`\n${mine}/${scenes.length} scenes are in your voice`)
  return
}

const pending = rows.filter(r => r.take)
if (!pending.length) {
  console.log('No takes found in record/. Run `node record.cjs --script` and read from record/script.html.')
  return
}
for (const r of pending) {
  const out = path.join(MASTERED, `scene-${String(r.s.n).padStart(2, '0')}.mp3`)
  const m = master(r.take, out)
  fs.copyFileSync(out, path.join(CACHE, r.wanted + '.mp3'))
  ledger[r.s.n] = { file: path.basename(r.take), hash: r.wanted, at: new Date().toISOString().slice(0, 10) }
  console.log(`  ${String(r.s.n).padStart(2)} ${r.s.name.padEnd(28)} ${durationOf(out).toFixed(1)}s  ` +
    `${(+m.input_i).toFixed(1)} → ${LUFS} LUFS`)
}
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2))
console.log(`\n${pending.length} take(s) mastered and seeded. Run \`node build.cjs\` — it will use yours.`)
