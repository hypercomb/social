// Re-voice the living presentation in the reference voice, a sentence at a time.
//
// voice.cjs clones a whole line in one breath, and a clone runs sentences
// together: on the protocol tile only four of six pauses were long enough for
// timing.cjs to hear, so its words drifted from the voice. Here every sentence
// is cloned on its own (clone.py: best of N takes, right first, then closest
// to the reference), the sentences are joined with GAP_MS of silence, and the
// whole is mastered by master.cjs's chain into the tour's format (24 kHz mono,
// 48 kbit/s, the rate blocks/build.cjs reads a narration's length from). It
// lands in the line's own audio-cache slot, so the page build needs no flag;
// the voice it replaces is kept once in audio-cache/generated/ (recorder.cjs's
// Restore), and voice/spoken.json notes every line spoken this way.
//
//   node reclone.cjs --scenes [--under protocol] [--takes 3]     tour scenes on tiles under the route
//   node reclone.cjs --beats  [--under protocol] [--takes 2]     page beats, captions and figure lines
//   node reclone.cjs ... --only scene:13,scene:14                just those lines
//   node reclone.cjs ... --skip scene:02                         all but those
//   node reclone.cjs ... --check                                 list what would be spoken; clone nothing
//
// A line already spoken from the same reference with the same words is
// skipped, so a run that stops can be started again.
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')
const T = require('./build.cjs')
const { CLEANUP, LUFS, TRUE_PEAK, LRA, measure, durationOf } = require('./master.cjs')
const { sentencesOf } = require('./timing.cjs')

const ROOT = __dirname
const HOME = process.env.HYPERCOMB_VOICE_HOME || path.join(os.homedir(), '.hcvoice')
const PYTHON = path.join(HOME, 'venv', 'Scripts', process.platform === 'win32' ? 'python.exe' : 'python')
const REFERENCE = path.join(ROOT, 'voice', 'reference', 'reference.wav')
const SPOKEN = path.join(ROOT, 'voice', 'spoken.json')
const WORK = path.join(ROOT, 'voice', 'voxtral', 'reclone')
const GAP_MS = 350
const SR = 24000

const arg = name => {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return undefined
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1)
  const next = process.argv[process.argv.indexOf(hit) + 1]
  return next && !next.startsWith('--') ? next : ''
}
const has = name => arg(name) !== undefined

const PAUSE = /\[pause(?::(\d+))?\]/g
const clean = s => s.replace(PAUSE, ' ').replace(/\s+/g, ' ').trim()
const pauseAt = (s, end) => {           // a [pause] at a sentence's edge lengthens the gap there
  const m = end ? s.trim().match(/\[pause(?::(\d+))?\]$/) : s.trim().match(/^\[pause(?::(\d+))?\]/)
  return m ? Number(m[1]) || 700 : 0
}
const refSig = () => crypto.createHash('sha256').update(fs.readFileSync(REFERENCE)).digest('hex').slice(0, 16)

function lines() {
  const tour = require('../bridge/living-presentation/blocks/tour.cjs')
  const under = arg('under') ?? 'protocol'
  const inside = r => !under || r === under || r.startsWith(`${under}/`)
  let out = []
  if (has('scenes')) {
    for (const [tile, n] of Object.entries(tour.SCENES_OF)) {
      if (!inside(tile)) continue
      const s = JSON.parse(fs.readFileSync(path.join(ROOT, 'scenes', `scene-${String(n).padStart(2, '0')}.json`), 'utf8'))
      out.push({ id: `scene:${String(n).padStart(2, '0')}`, say: s.say })
    }
  }
  if (has('beats')) {
    const content = require('../bridge/living-presentation/blocks/content.cjs')
    const seen = new Set()
    for (const [route, b] of Object.entries(content)) {
      if (!inside(route)) continue
      const says = [
        ...(!tour.sceneAt(route) && Array.isArray(b.beats) ? b.beats.map(x => x.say) : []),
        ...(b.live || []).map(l => l.caption),
        ...Object.values(b.figures || {}).filter(f => f.say).map(f => f.say),
      ]
      says.forEach((say, i) => {
        if (!say || seen.has(say)) return
        seen.add(say)
        out.push({ id: `beat:${route}#${i + 1}`, say })
      })
    }
  }
  const only = arg('only')
  if (only) { const want = only.split(','); out = out.filter(l => want.includes(l.id)) }
  const skip = arg('skip')
  if (skip) { const drop = skip.split(','); out = out.filter(l => !drop.includes(l.id)) }
  return out.map(l => {
    const spoken = sentencesOf(T.spokenOf(l.say))
    return { ...l, slot: T.hashOf(l.say), text: clean(T.spokenOf(l.say)),
             sentences: spoken.map((s, k) => ({ key: `${l.id.replace(/[^a-z0-9]+/gi, '-')}-s${k + 1}`, text: clean(s),
               before: pauseAt(s, false), after: pauseAt(s, true) })).filter(s => s.text) }
  })
}

function stitch(line, dir) {
  const parts = line.sentences.map(s => path.join(dir, `${s.key}.wav`))
  const missing = parts.filter(p => !fs.existsSync(p))
  if (missing.length) throw new Error(`${line.id}: ${missing.length} sentence(s) came back empty`)
  const raw = path.join(dir, `${line.id.replace(/[^a-z0-9]+/gi, '-')}.joined.wav`)
  const inputs = [], graph = []
  parts.forEach((p, k) => {
    inputs.push('-i', p)
    // a clone pads each sentence with its own silence; trim both ends to a breath so GAP_MS is the pause
    const trim = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05'
    graph.push(`[${k}:a]aresample=${SR},aformat=channel_layouts=mono,${trim},areverse,${trim.replace('0.05', '0.08')},areverse[s${k}]`)
  })
  const order = []
  parts.forEach((_, k) => {
    order.push(`[s${k}]`)
    if (k < parts.length - 1) {
      const ms = GAP_MS + line.sentences[k].after + line.sentences[k + 1].before
      graph.push(`anullsrc=r=${SR}:cl=mono,atrim=duration=${(ms / 1000).toFixed(3)}[g${k}]`)
      order.push(`[g${k}]`)
    }
  })
  graph.push(`${order.join('')}concat=n=${order.length}:v=0:a=1[out]`)
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...inputs, '-filter_complex', graph.join(';'), '-map', '[out]', raw])
  return raw
}

function masterInto(raw, out) {
  const m = measure(raw)
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', raw, '-af',
    `${CLEANUP},loudnorm=I=${LUFS}:TP=${TRUE_PEAK}:LRA=${LRA}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:` +
    `measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`,
    '-ar', String(SR), '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '48k', out])
}

function main() {
  if (!has('scenes') && !has('beats')) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').filter(l => l.startsWith('//')).join('\n'))
    return
  }
  if (!fs.existsSync(REFERENCE)) throw new Error('no reference: voice/reference/reference.wav')
  const ref = refSig()
  const ledger = fs.existsSync(SPOKEN) ? JSON.parse(fs.readFileSync(SPOKEN, 'utf8')) : {}
  const all = lines()
  const todo = all.filter(l => !(ledger[l.id]?.via === 'reclone' && ledger[l.id]?.reference === ref && ledger[l.id]?.text === l.text))
  const sentences = todo.flatMap(l => l.sentences)
  console.log(`${all.length} line(s), ${todo.length} to speak, ${sentences.length} sentence(s), reference ${ref}`)
  if (has('check') || !todo.length) { todo.forEach(l => console.log(`  ${l.id}  ${l.sentences.length} sentence(s)`)); return }

  const takes = parseInt(arg('takes'), 10) || (has('scenes') ? 3 : 2)
  const dir = path.join(WORK, has('scenes') ? 'scenes' : 'beats')
  fs.mkdirSync(dir, { recursive: true })
  const list = path.join(dir, 'lines.json')
  // clone.py writes every sentence it finishes; a sentence already on disk is not spoken again
  const pending = sentences.filter(s => !fs.existsSync(path.join(dir, `${s.key}.wav`)))
  fs.writeFileSync(list, JSON.stringify(pending.map(s => ({ id: s.key, text: s.text })), null, 2))
  if (pending.length) {
    console.log(`cloning ${pending.length} sentence(s), ${takes} takes each`)
    execFileSync(PYTHON, [path.join(ROOT, 'voice', 'clone.py'), REFERENCE, list, dir, String(takes)], { stdio: 'inherit' })
  }
  const scoresOf = () => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'scores.json'), 'utf8')) } catch { return {} } }
  const scores = { ...(fs.existsSync(path.join(dir, 'scores.all.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'scores.all.json'), 'utf8')) : {}), ...scoresOf() }
  fs.writeFileSync(path.join(dir, 'scores.all.json'), JSON.stringify(scores, null, 2))

  const generated = path.join(ROOT, 'audio-cache', 'generated')
  fs.mkdirSync(generated, { recursive: true })
  for (const line of todo) {
    const out = path.join(ROOT, 'audio-cache', `${line.slot}.mp3`)
    const keep = path.join(generated, `${line.slot}.mp3`)
    if (fs.existsSync(out) && !fs.existsSync(keep)) fs.copyFileSync(out, keep)
    masterInto(stitch(line, dir), out)
    const got = line.sentences.map(s => scores[s.key] || {})
    const flagged = line.sentences.filter((s, k) => got[k].flagged).map(s => s.key)
    ledger[line.id] = {
      slot: line.slot, via: 'reclone', reference: ref,
      similarity: +Math.min(...got.map(g => g.similarity ?? 1)).toFixed(4),
      wer: +Math.max(...got.map(g => g.wer ?? 0)).toFixed(4),
      seconds: +durationOf(out).toFixed(2), at: new Date().toISOString().slice(0, 10), text: line.text,
      ...(flagged.length ? { flagged } : {}),
    }
    console.log(`  ${line.id.padEnd(40)} ${durationOf(out).toFixed(1)}s  likeness ≥ ${ledger[line.id].similarity}  WER ≤ ${(ledger[line.id].wer * 100).toFixed(1)}%${flagged.length ? `  ⚠ ${flagged.length} flagged` : ''}`)
    fs.writeFileSync(SPOKEN, JSON.stringify(ledger, null, 2))
  }
  console.log(`${todo.length} line(s) spoken, mastered and seeded.`)
}

try { main() } catch (e) { console.error(`reclone failed: ${e.message}`); process.exitCode = 1 }
