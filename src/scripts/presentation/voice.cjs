// Your voice, on lines you never read.
//
// record.cjs is you at a microphone. This is the other half: one take is enough
// to seed the rest. A zero-shot clone conditions on ~20 seconds of you, speaks a
// line it has never heard you say, and the result goes through the SAME
// mastering chain a real take does before it is allowed near the reel.
//
//   node voice.cjs --reference "…\Recording.m4a" --from 24.6 --to 43.6
//   node voice.cjs --teaser            # speak the teaser beats, master, seed
//   node voice.cjs --scenes 1,4,7      # speak whole scenes, master, seed
//   node voice.cjs --check             # which slots are spoken, and how close
//
// Short lines are where a clone is weakest — there is barely any line for it to
// settle into the voice. Re-roll one without redoing the rest:
//
//   node voice.cjs --teaser --only open --takes 8
//
// It seeds the very same cache slot a recorded take would land in, so nothing
// downstream needs to know: teaser.cjs and build.cjs find the audio already
// there and skip the neural narrator. voice/spoken.json is the ledger of which
// slots are spoken rather than read — the one place that distinction is kept.
//
// The models run locally and cost nothing (Chatterbox, MIT). Setup: voice/README.md.
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')
const { master, durationOf } = require('./master.cjs')

const ROOT = __dirname
const HOME = process.env.HYPERCOMB_VOICE_HOME || path.join(os.homedir(), '.hcvoice')
const PYTHON = path.join(HOME, 'venv', 'Scripts', process.platform === 'win32' ? 'python.exe' : 'python')
const VOICE_DIR = path.join(ROOT, 'voice')
const REFERENCE = path.join(VOICE_DIR, 'reference', 'reference.wav')
const SPOKEN = path.join(VOICE_DIR, 'spoken.json')
const RAW = path.join(VOICE_DIR, 'spoken')
const DEFAULT_TAKES = 4                            // sampled per line; the closest one wins

const arg = name => {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return undefined
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1)
  return process.argv[process.argv.indexOf(hit) + 1]
}
const has = name => process.argv.some(a => a === `--${name}` || a.startsWith(`--${name}=`))

fs.mkdirSync(path.dirname(REFERENCE), { recursive: true })
fs.mkdirSync(RAW, { recursive: true })
const ledger = fs.existsSync(SPOKEN) ? JSON.parse(fs.readFileSync(SPOKEN, 'utf8')) : {}

// ---------- the two targets --------------------------------------------------
// Each names where its audio cache lives and how that cache is keyed, so a
// spoken line lands in exactly the slot the target already looks in.
const rulesPath = path.join(ROOT, 'pronunciations.json')
const RULES = fs.existsSync(rulesPath) ? JSON.parse(fs.readFileSync(rulesPath, 'utf8')) : []
const spokenOf = say => RULES.reduce((t, r) => r && r.match && r.say ? t.split(r.match).join(r.say) : t, say)
const keyOf = (voice, rate, say) => crypto.createHash('sha256').update(`${voice}|${rate}|${say}`).digest('hex').slice(0, 16)

// The reader hears the pause; the clone would try to pronounce it.
const PAUSE = /\[pause(?::(\d+))?\]/g
const strip = say => say.replace(PAUSE, ' ').replace(/\s+/g, ' ').trim()

function teaserLines() {
  const src = fs.readFileSync(path.join(ROOT, 'teaser.cjs'), 'utf8')
  const cache = path.join(ROOT, 'teaser', 'audio')
  const voice = (src.match(/const VOICE = '([^']+)'/) || [])[1]
  const rate = (src.match(/const RATE = '([^']+)'/) || [])[1]
  return [...src.matchAll(/\{ id: '([^']+)'[\s\S]*?say: `([^`]*)`/g)].map(m => {
    const say = m[2].replace(/\s+/g, ' ').trim()
    return { id: `teaser:${m[1]}`, text: say, cache, slot: keyOf(voice, rate, say) }
  })
}

function sceneLines(which) {
  const cache = path.join(ROOT, 'audio-cache')
  const src = fs.readFileSync(path.join(ROOT, 'build.cjs'), 'utf8')
  const voice = (src.match(/const VOICE = '([^']+)'/) || [])[1]
  const rate = (src.match(/const RATE = '([^']+)'/) || [])[1]
  return fs.readdirSync(path.join(ROOT, 'scenes')).filter(f => f.endsWith('.json')).sort()
    .map(f => JSON.parse(fs.readFileSync(path.join(ROOT, 'scenes', f), 'utf8')))
    .filter(s => !which.length || which.includes(s.n))
    .map(s => ({ id: `scene:${String(s.n).padStart(2, '0')}`, text: strip(s.say),
                 cache, slot: keyOf(voice, rate, spokenOf(s.say)) }))
}

// ---------- prepare the reference --------------------------------------------
// Deliberately NOT the mastering chain: conditioning wants the voice as it is,
// with its dynamics intact. Clean the room out of it and level it, no more.
function prepareReference(file, from, to) {
  if (!fs.existsSync(file)) throw new Error(`no such recording: ${file}`)
  const span = [...(from ? ['-ss', String(from)] : []), ...(to ? ['-to', String(to)] : [])]
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...span, '-i', file,
    '-af', 'highpass=f=80,afftdn=nf=-25,deesser=i=0.4,loudnorm=I=-18:TP=-2:LRA=11',
    '-ar', '24000', '-ac', '1', REFERENCE], { stdio: ['ignore', 'ignore', 'inherit'] })
  const secs = durationOf(REFERENCE)
  console.log(`reference: ${secs.toFixed(1)}s from ${path.basename(file)} → voice/reference/reference.wav`)
  if (secs < 7) console.log('  ⚠ under 7 seconds — the clone will be thin. Give it more.')
  if (secs > 40) console.log('  ⚠ over 40 seconds — trim to the cleanest run with --from/--to.')
}

// ---------- speak, master, seed ----------------------------------------------
function speak(lines) {
  if (!fs.existsSync(PYTHON)) {
    console.error(`no local voice environment at ${HOME}\nSee voice/README.md — it is a one-time, free setup.`)
    process.exit(1)
  }
  if (!fs.existsSync(REFERENCE)) {
    console.error('no reference yet. Run: node voice.cjs --reference "path\\to\\your-recording.m4a"')
    process.exit(1)
  }
  const only = arg('only')
  if (only) {
    const wanted = only.split(',').map(s => s.trim())
    lines = lines.filter(l => wanted.some(w => l.id === w || l.id.endsWith(`:${w}`)))
    if (!lines.length) { console.error(`no line matches --only ${only}`); process.exit(1) }
  }
  const takes = parseInt(arg('takes'), 10) || DEFAULT_TAKES

  const listPath = path.join(VOICE_DIR, 'lines.json')
  const flat = lines.map(l => ({ id: l.id.replace(':', '-'), text: l.text }))
  fs.writeFileSync(listPath, JSON.stringify(flat, null, 2))

  console.log(`speaking ${lines.length} line(s) — ${takes} takes each, closest to you wins`)
  execFileSync(PYTHON, [path.join(VOICE_DIR, 'clone.py'), REFERENCE, listPath, RAW, String(takes)],
    { stdio: 'inherit' })

  const scores = JSON.parse(fs.readFileSync(path.join(RAW, 'scores.json'), 'utf8'))
  console.log('\nmastering…')
  for (const line of lines) {
    const raw = path.join(RAW, `${line.id.replace(':', '-')}.wav`)
    if (!fs.existsSync(raw)) { console.log(`  ${line.id}: nothing came back — skipped`); continue }
    fs.mkdirSync(line.cache, { recursive: true })
    const out = path.join(line.cache, `${line.slot}.mp3`)
    const m = master(raw, out)
    const score = scores[line.id.replace(':', '-')] || {}
    ledger[line.id] = { slot: line.slot, similarity: score.similarity, wer: score.wer,
                        seconds: +durationOf(out).toFixed(2), at: new Date().toISOString().slice(0, 10),
                        text: line.text, ...(score.flagged ? { flagged: score.flagged, heard: score.heard } : {}) }
    console.log(`  ${line.id.padEnd(18)} ${durationOf(out).toFixed(1)}s  ` +
      `${(+m.input_i).toFixed(1)} → -16 LUFS   likeness ${score.similarity?.toFixed(3) ?? '—'}` +
      (score.flagged ? `   ⚠ ${score.flagged}` : ''))
  }
  fs.writeFileSync(SPOKEN, JSON.stringify(ledger, null, 2))
  console.log(`\n${lines.length} line(s) spoken, mastered and seeded. Run the target build — it will use yours.`)
}

// ---------- run --------------------------------------------------------------
try {
  if (has('reference')) {
    prepareReference(arg('reference'), arg('from'), arg('to'))
  } else if (has('check')) {
    const rows = Object.entries(ledger)
    if (!rows.length) console.log('nothing spoken yet.')
    for (const [id, r] of rows) {
      console.log(`  ${id.padEnd(18)} ${String(r.seconds).padStart(5)}s  likeness ${r.similarity ?? '—'}` +
        `  WER ${r.wer === undefined ? '—' : (r.wer * 100).toFixed(1) + '%'}  ${r.at}` +
        (r.flagged ? `   ⚠ heard "${r.heard}"` : ''))
    }
    console.log(fs.existsSync(REFERENCE)
      ? `\nreference: ${durationOf(REFERENCE).toFixed(1)}s`
      : '\nno reference yet — node voice.cjs --reference "…"')
  } else if (has('teaser')) {
    speak(teaserLines())
  } else if (has('scenes')) {
    const which = String(arg('scenes') || '').split(',').map(n => parseInt(n, 10)).filter(Number.isFinite)
    speak(sceneLines(which))
  } else {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').filter(l => l.startsWith('//')).join('\n'))
  }
} catch (e) {
  console.error(`voice failed: ${e.message}`)
  process.exit(1)
}
