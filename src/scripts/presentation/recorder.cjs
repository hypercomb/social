// The track recorder: read the narration yourself, one line at a time, and
// have each take land in the line's own time slot.
//
//   node scripts/presentation/recorder.cjs                 # http://127.0.0.1:4280
//   node scripts/presentation/recorder.cjs --port 4281
//   node scripts/presentation/recorder.cjs --master        # re-remaster every chosen take, then exit
//   … --cache <dir> --takes <dir>                          # another audio cache / takes folder (tests)
//
// One page, laid out like a gantt chart: a lane per tile (tree.cjs order, or
// the tour's own scene order), and in each lane the LINES it speaks, each a
// bar as long as its time slot. A tour scene's lines are its sentences, cut
// where the voice actually pauses (timing.cjs, the same finder concepts.cjs
// times its drawn clips with); a page's lines are its beats and capture
// captions. Click a line, read it with the light (karaoke), record as many
// takes as you like, and choose one. The chosen take is REMASTERED into the
// slot: trimmed, put through master.cjs, fitted to the slot (stretched with
// its pitch kept when within 15%, otherwise kept at its own length and the
// slot grows), and spliced into the scene's mp3 in place of that sentence.
//
// The audio cache is keyed by the words, so the result is written to the SAME
// audio-cache/<hash>.mp3 the generated voice had: build.cjs, the pages and
// concepts.cjs pick it up with no other change. The generated voice is kept,
// once, as audio-cache/generated/<hash>.mp3, so Restore can bring it back.
// Raw takes: record/takes/<line key>/<time>.<ext>; choices: record/takes/chosen.json
// (line key = the scene's hash and the sentence's index, or a beat's hash).
// Both are git-ignored (.gitignore beside this file).
//
// Local only: it listens on 127.0.0.1, asks nothing of the network, and uses
// nothing but Node and ffmpeg.
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { spawnSync, execFileSync } = require('child_process')

const T = require('./build.cjs')
const { master } = require('./master.cjs')
const { sentencesOf, sentenceTimes, silencesOf, durationOf, exists } = require('./timing.cjs')
const LP = path.join(__dirname, '..', 'bridge', 'living-presentation')
const tree = require(path.join(LP, 'tree.cjs'))
const tour = require(path.join(LP, 'blocks', 'tour.cjs'))
const content = require(path.join(LP, 'blocks', 'content.cjs'))

const ROOT = __dirname
const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt }
const PORT = Number(arg('--port', 4280))
const CACHE = path.resolve(arg('--cache', path.join(ROOT, 'audio-cache')))
const TAKES = path.resolve(arg('--takes', path.join(ROOT, 'record', 'takes')))
const GEN = path.join(CACHE, 'generated')
const CHOSEN = path.join(TAKES, 'chosen.json')
const PAGE = path.join(ROOT, 'recorder.html')

const FIT = 0.15                 // within ±15% of the slot: stretched to it exactly
const BEAT_GAP = 0.8             // a page holds 800 ms between voiced beats (blocks/page.cjs)
const WPS = 2.6                  // the reading pace for a line not voiced yet (concepts.cjs, page.cjs)
const PAUSE = /\[pause(?::(\d+))?\]/g
const AUDIO = { 'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a', 'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav' }
const TAKE_FILE = /^[\w.-]+\.(webm|ogg|m4a|mp3|wav|flac)$/
const KEY = /^[0-9a-f]{16}(-\d+)?$/

// ---------- files ------------------------------------------------------------
const cacheFile = (hash) => path.join(CACHE, hash + '.mp3')
const genFile = (hash) => path.join(GEN, hash + '.mp3')
const noneMark = (hash) => path.join(GEN, hash + '.none')     // there was no generated voice to keep
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } }
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.part', JSON.stringify(v, null, 2)); fs.renameSync(f + '.part', f) }
const loadChosen = () => readJson(CHOSEN, {})
const stamp = (f) => { try { const s = fs.statSync(f); return `${s.size}:${s.mtimeMs}` } catch { return null } }
/** the generated voice of a clip: the copy kept before a take replaced it, or the cache file itself */
const originalOf = (hash) => exists(genFile(hash)) ? genFile(hash) : exists(noneMark(hash)) ? null : exists(cacheFile(hash)) ? cacheFile(hash) : null

// ffmpeg is slow next to a page refresh: every measurement is kept by the file's size and time
const memo = new Map()
const remember = (kind, file, fn) => {
  const k = `${kind}|${file}|${stamp(file)}`
  if (!memo.has(k)) memo.set(k, fn())
  return memo.get(k)
}

// ---------- word timing ------------------------------------------------------
const syllables = (w) => {
  const s = w.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (/^\d+$/.test(s)) return s.length
  const n = (s.replace(/e$/, '').match(/[aeiouy]+/g) || []).length
  return Math.max(1, n)
}
const holdOf = (w) => /[.!?]["”’)]*$/.test(w) ? 1.6 : /[,;:—–]["”’)]*$/.test(w) ? 1 : 0

/** each word's moment in [a, b]: anchored on the pauses heard inside the span
 *  where they fall near where a word ends, proportional to syllables between,
 *  commas and full stops holding a little */
function wordTimes(text, a, b, silences = []) {
  const words = text.split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const n = words.length
  const unit = words.map(w => syllables(w) + 0.4)
  const hold = words.map((w, i) => i < n - 1 ? holdOf(w) : 0)
  const span = Math.max(0.2, b - a)
  const total = unit.reduce((t, u, i) => t + u + hold[i], 0)
  const expect = []                              // where word i is expected to end, holds included
  let cum = 0
  for (let i = 0; i < n - 1; i++) { cum += unit[i] + hold[i]; expect.push(a + cum / total * span) }
  // anchors: a gap heard inside the span is the end of the word nearest it
  const gaps = silences.filter(g => g.start > a + 0.05 && g.end < b - 0.05 && g.end - g.start >= 0.12)
  const anchors = [{ word: 0, at: a }]          // word index that starts at a given time
  let last = -1
  for (const g of gaps) {
    const mid = (g.start + g.end) / 2
    let best = -1, score = Infinity
    for (let k = last + 1; k < n - 1; k++) {
      const s = Math.abs(expect[k] - mid) * (hold[k] ? 0.6 : 1)
      if (s < score) { score = s; best = k }
    }
    if (best < 0 || Math.abs(expect[best] - mid) > Math.max(0.8, span * 0.25)) continue
    anchors.push({ word: best, endAt: g.start }, { word: best + 1, at: g.end })
    last = best
  }
  // distribute each run of words between its anchors
  const out = new Array(n)
  const starts = anchors.filter(x => x.at != null)
  starts.forEach((st, si) => {
    const nextStart = starts[si + 1]
    const lastWord = nextStart ? nextStart.word - 1 : n - 1
    const endAnchor = anchors.find(x => x.endAt != null && x.word === lastWord)
    const end = endAnchor ? endAnchor.endAt : b
    const run = []
    for (let i = st.word; i <= lastWord; i++) run.push(i)
    const weight = run.map((i, k) => unit[i] + (k < run.length - 1 ? hold[i] : 0))
    const sum = weight.reduce((x, y) => x + y, 0) || 1
    let t = st.at
    run.forEach((i, k) => {
      const d = weight[k] / sum * Math.max(0.05, end - st.at)
      out[i] = { w: words[i], t0: +t.toFixed(3), t1: +(t + d * unit[i] / weight[k]).toFixed(3) }
      t += d
    })
  })
  return out
}

// ---------- clips: one audio file each, holding one line or a scene's sentences
/** a line not voiced yet, timed from its text at the reading pace */
function textSpans(spokenSentences) {
  let t = 0.15
  const spans = spokenSentences.map((s, j) => {
    let start = null
    s.split(PAUSE).forEach((part, i) => {
      if (i % 2) { t += (Number(part) || 700) / 1000; return }
      const n = part.split(/\s+/).filter(Boolean).length
      if (n && start == null) start = t
      t += n / WPS
    })
    const span = { start: start ?? t, end: t }
    if (j < spokenSentences.length - 1) t += 0.35
    return span
  })
  return { spans, audioDur: t + 0.3, speechEnd: t }
}

function clipOf(say, kind) {
  const hash = T.hashOf(say)
  const spoken = T.spokenOf(say)
  let spokenLines = kind === 'scene' ? sentencesOf(spoken) : [spoken]
  if (!spokenLines.length) spokenLines = [spoken]
  const caption = T.captionOf(say)
  const shown = kind === 'scene' ? sentencesOf(caption) : [caption]
  const texts = shown.length === spokenLines.length ? shown : spokenLines.map(T.captionOf)
  const original = originalOf(hash)
  const timing = original
    ? remember('sentences:' + spokenLines.length, original, () => sentenceTimes(original, spokenLines))
    : textSpans(spokenLines)
  return { hash, kind, say, spokenLines, texts, original, spans: timing.spans, audioDur: timing.audioDur }
}

const lineKey = (clip, j) => clip.kind === 'scene' ? `${clip.hash}-${j}` : clip.hash

/** a clip as it is now: the generated slots, moved by any chosen take that kept its own length */
function layoutOf(clip, chosen) {
  const n = clip.spans.length
  const picks = clip.spans.map((_, j) => chosen[lineKey(clip, j)] || null)
  const all = picks.every(Boolean)
  const waiting = !clip.original && picks.some(Boolean) && !all
  let shift = 0
  const now = clip.spans.map((sp, j) => {
    const p = picks[j]
    const slot = sp.end - sp.start
    const len = p && p.fitted && !waiting ? p.fitted : slot
    const at = { start: sp.start + shift, end: sp.start + shift + len, slot }
    shift += len - slot
    return at
  })
  return { now, picks, waiting, dur: clip.audioDur + shift, n }
}

// ---------- takes ------------------------------------------------------------
/** a take's length and the pauses in it, measured once and kept beside it */
function takeInfo(dir, file) {
  const f = path.join(dir, file), side = f + '.json'
  const st = stamp(f)
  const known = readJson(side, null)
  if (known && known.stamp === st) return known
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', f, '-af', 'silencedetect=noise=-45dB:d=0.12', '-f', 'null', '-'], { encoding: 'utf8' })
  const text = r.stderr || ''
  const times = [...text.matchAll(/time=(\d+):(\d+):([\d.]+)/g)]
  const lastT = times.length ? times[times.length - 1] : null
  let dur = lastT ? (+lastT[1]) * 3600 + (+lastT[2]) * 60 + (+lastT[3]) : 0
  if (!dur) { try { dur = durationOf(f) } catch { dur = 0 } }
  const silences = []
  for (const m of text.matchAll(/silence_start: (-?[\d.]+)[\s\S]*?silence_end: ([\d.]+)/g)) silences.push({ start: Math.max(0, +m[1]), end: +m[2] })
  const open = [...text.matchAll(/silence_start: (-?[\d.]+)/g)]
  if (open.length > silences.length) silences.push({ start: Math.max(0, +open[open.length - 1][1]), end: dur })
  let s = 0, e = dur
  if (silences.length && silences[0].start < 0.05) s = silences[0].end
  const tail = silences[silences.length - 1]
  if (tail && tail.end >= dur - 0.05 && tail.start > s) e = tail.start
  const info = { stamp: st, dur: +dur.toFixed(3), speech: [+s.toFixed(3), +Math.max(s, e).toFixed(3)], silences }
  try { fs.writeFileSync(side, JSON.stringify(info)) } catch {}
  return info
}

function takesOf(key, text) {
  const dir = path.join(TAKES, key)
  let files = []
  try { files = fs.readdirSync(dir).filter(f => TAKE_FILE.test(f)).sort() } catch {}
  return files.map(file => {
    const info = takeInfo(dir, file)
    return { file, dur: info.dur, speech: info.speech[1] - info.speech[0],
      words: wordTimes(text, info.speech[0], info.speech[1], info.silences) }
  })
}

// ---------- the model: lanes of lines ---------------------------------------
function walk(tile, route, depth, out) {
  out.push({ route, depth, name: tile.name })
  for (const c of tile.children || []) walk(c, `${route}/${c.name}`, depth + 1, out)
}
const tiles = () => {
  const out = []
  for (const root of [tree, tree.road]) walk(root, root.name, 0, out)   // the presenter has no pages
  return out
}

function lineOut(clip, j, lay, chosen, offset, extra = {}) {
  const key = lineKey(clip, j)
  const at = lay.now[j]
  const text = clip.texts[j]
  const current = exists(cacheFile(clip.hash)) && !lay.waiting ? cacheFile(clip.hash) : null
  const fine = current ? remember('fine', current, () => silencesOf(current, { noise: -38, d: 0.12 })) : []
  const takes = takesOf(key, text)
  const pick = lay.picks[j]
  const has = pick && takes.some(t => t.file === pick.take)
  const state = has ? 'chosen' : takes.length ? 'takes' : clip.original ? 'generated' : 'none'
  return {
    key, clip: clip.hash, j, n: lay.n, text, state, ...extra,
    start: +(offset + at.start).toFixed(3), end: +(offset + at.end).toFixed(3),
    clipStart: +at.start.toFixed(3), clipEnd: +at.end.toFixed(3), slot: +at.slot.toFixed(3),
    audio: current ? `/audio/clip/${clip.hash}.mp3?v=${encodeURIComponent(stamp(current))}` : null,
    voiced: !!clip.original, waiting: !!(has && lay.waiting),
    chosen: has ? { take: pick.take, mode: pick.mode, natural: pick.natural, fitted: pick.fitted, tempo: pick.tempo } : null,
    words: wordTimes(text, at.start, at.end, fine),
    takes,
  }
}

function model() {
  const chosen = loadChosen()
  const lanes = []
  for (const t of tiles()) {
    const n = tour.sceneAt(t.route)
    const block = content[t.route] || {}
    const lines = []
    let offset = 0
    const clips = []
    if (n) clips.push({ clip: clipOf(tour.T.scenes.find(s => s.n === n).say, 'scene'), extra: { kind: 'sentence' } })
    else if (Array.isArray(block.beats)) block.beats.forEach((b, i) => clips.push({ clip: clipOf(b.say, 'beat'), extra: { kind: 'beat', beat: i + 1 } }))
    for (const l of block.live || []) clips.push({ clip: clipOf(l.caption, 'beat'), extra: { kind: 'caption', shot: l.shot } })
    for (const { clip, extra } of clips) {
      const lay = layoutOf(clip, chosen)
      clip.spans.forEach((_, j) => lines.push(lineOut(clip, j, lay, chosen, offset, extra)))
      offset += lay.dur + BEAT_GAP
    }
    lanes.push({ route: t.route, name: t.name, depth: t.depth, scene: n, lines, end: lines.length ? Math.max(...lines.map(l => l.end)) : 0 })
  }
  const all = lanes.flatMap(l => l.lines)
  const count = (s) => all.filter(l => l.state === s).length
  return {
    lanes,
    end: Math.max(10, ...lanes.map(l => l.end)),
    counts: { lines: all.length, chosen: count('chosen'), takes: count('takes'), generated: count('generated'), none: count('none'),
      recorded: all.reduce((t, l) => t + l.takes.length, 0), waiting: all.filter(l => l.waiting).length },
    changed,
    paths: { cache: CACHE, takes: TAKES },
  }
}
const findLine = (key) => {
  for (const lane of model().lanes) for (const l of lane.lines) if (l.key === key) return { lane, line: l }
  return null
}
/** the clip (and its kind) a line key belongs to, wherever it lives in the tree */
function clipForKey(key) {
  const hash = key.slice(0, 16)
  for (const t of tiles()) {
    const n = tour.sceneAt(t.route)
    const block = content[t.route] || {}
    if (n) { const say = tour.T.scenes.find(s => s.n === n).say; if (T.hashOf(say) === hash) return clipOf(say, 'scene') }
    for (const b of [...(!n && Array.isArray(block.beats) ? block.beats.map(b => b.say) : []), ...(block.live || []).map(l => l.caption)])
      if (T.hashOf(b) === hash) return clipOf(b, 'beat')
  }
  return null
}

// ---------- remastering ------------------------------------------------------
const ff = (args) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: ['ignore', 'ignore', 'pipe'] })

/** trim, master, and fit one take to its slot: a 24 kHz mono wav, and what was done */
function fitTake(raw, slot, tmp, name) {
  const mastered = path.join(tmp, name + '.m.mp3')
  master(raw, mastered)
  const dur = durationOf(mastered)
  const sil = silencesOf(mastered, { noise: -45, d: 0.08, dur })
  let s = 0, e = dur
  if (sil.length && sil[0].start < 0.03) s = sil[0].end
  const tail = sil[sil.length - 1]
  if (tail && tail.end >= dur - 0.03 && tail.start > s) e = tail.start
  s = Math.max(0, s - 0.02); e = Math.min(dur, e + 0.05)
  const natural = e - s
  if (natural < 0.25) throw new Error('the take is silent — nothing above the noise floor')
  const ratio = natural / slot
  const stretch = Math.abs(ratio - 1) <= FIT
  const out = path.join(tmp, name + '.fit.wav')
  const af = [`atrim=start=${s.toFixed(4)}:end=${e.toFixed(4)}`, 'asetpts=PTS-STARTPTS']
  if (stretch) af.push(`atempo=${ratio.toFixed(5)}`, 'apad', `atrim=end=${slot.toFixed(4)}`)
  af.push('aresample=24000')
  ff(['-i', mastered, '-af', af.join(','), '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', out])
  return { file: out, natural: +natural.toFixed(3), fitted: +(stretch ? slot : natural).toFixed(3),
    mode: stretch ? 'stretched' : 'natural', tempo: +ratio.toFixed(4) }
}

/** rebuild a clip's mp3 from its generated voice and every chosen take in it */
const FMT = 'aresample=24000,aformat=sample_fmts=fltp:sample_rates=24000:channel_layouts=mono'
function rebuildClip(clip, chosen = loadChosen()) {
  const { hash } = clip
  const keys = clip.spans.map((_, j) => lineKey(clip, j))
  const picks = keys.map(k => {
    const p = chosen[k]
    return p && exists(path.join(TAKES, k, p.take)) ? p : null
  })
  const out = cacheFile(hash)
  if (!picks.some(Boolean)) {
    // nothing chosen: the generated voice comes back (or, if there was none, the slot is empty again)
    if (exists(genFile(hash))) fs.copyFileSync(genFile(hash), out)
    else if (exists(noneMark(hash))) { try { fs.unlinkSync(out) } catch {} fs.unlinkSync(noneMark(hash)) }
    return { restored: true }
  }
  const original = originalOf(hash)
  // a scene with no generated voice is written once every sentence has a take
  if (!original && picks.some(p => !p)) return { waiting: true }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'recorder-'))
  try {
    const fitted = picks.map((p, j) => {
      if (!p) return null
      const sp = clip.spans[j]
      const r = fitTake(path.join(TAKES, keys[j], p.take), sp.end - sp.start, tmp, `t${j}`)
      Object.assign(p, { natural: r.natural, fitted: r.fitted, mode: r.mode, tempo: r.tempo, slot: +(sp.end - sp.start).toFixed(3) })
      return r
    })
    // the pieces in order: the lead, each sentence (generated or fitted take) and
    // the gap after it, the tail — every gap the voice left is kept as it was
    const pieces = []
    const gap = (a, b) => { if (b - a > 0.004) pieces.push(original ? { a, b } : { d: b - a }) }
    clip.spans.forEach((sp, j) => {
      gap(j === 0 ? 0 : clip.spans[j - 1].end, sp.start)
      pieces.push(fitted[j] ? { j } : { a: sp.start, b: sp.end })
    })
    gap(clip.spans[clip.spans.length - 1].end, clip.audioDur)
    const lent = pieces.filter(x => x.a != null)
    const inputs = [], graph = []
    if (lent.length) { inputs.push('-i', original); graph.push(`[0:a]${FMT},asplit=${lent.length}` + lent.map((_, i) => `[s${i}]`).join('')) }
    let si = 0, zi = 0
    const labels = pieces.map(x => {
      if (x.a != null) { const i = si++; graph.push(`[s${i}]atrim=start=${x.a.toFixed(4)}:end=${x.b.toFixed(4)},asetpts=PTS-STARTPTS[o${i}]`); return `o${i}` }
      if (x.j != null) { const k = inputs.length / 2; inputs.push('-i', fitted[x.j].file); graph.push(`[${k}:a]${FMT}[t${x.j}]`); return `t${x.j}` }
      const z = zi++; graph.push(`aevalsrc=0:c=mono:s=24000:d=${x.d.toFixed(4)},${FMT}[z${z}]`); return `z${z}`
    })
    graph.push(labels.map(l => `[${l}]`).join('') + `concat=n=${labels.length}:v=0:a=1[out]`)
    const built = path.join(tmp, 'clip.mp3')
    ff([...inputs, '-filter_complex', graph.join(';'), '-map', '[out]', '-ar', '24000', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '48k', built])
    // the generated voice is kept once, before the first replacement
    fs.mkdirSync(GEN, { recursive: true })
    if (!exists(genFile(hash)) && !exists(noneMark(hash))) {
      if (original) fs.copyFileSync(original, genFile(hash))
      else fs.writeFileSync(noneMark(hash), 'no generated voice existed when the takes were chosen\n')
    }
    const part = out + '.part'
    fs.copyFileSync(built, part)
    fs.renameSync(part, out)
    return { written: true, dur: durationOf(out) }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

let changed = null          // set once a choice or a restore moves the cache
function markChanged() { changed = new Date().toISOString() }

function choose(key, take) {
  const clip = clipForKey(key)
  if (!clip) throw new Error('no line has that key any more (its words changed?)')
  if (!TAKE_FILE.test(take) || !exists(path.join(TAKES, key, take))) throw new Error('no such take')
  const chosen = loadChosen()
  const before = chosen[key]
  chosen[key] = { take, at: new Date().toISOString() }
  try {
    const r = rebuildClip(clip, chosen)
    writeJson(CHOSEN, chosen)
    markChanged()
    return r
  } catch (e) {
    if (before) chosen[key] = before; else delete chosen[key]
    throw e
  }
}

function restore({ key, clip: hash }) {
  const clip = clipForKey(key || hash)
  if (!clip) throw new Error('no such line')
  const chosen = loadChosen()
  const keys = key ? [key] : clip.spans.map((_, j) => lineKey(clip, j))
  for (const k of keys) delete chosen[k]
  const r = rebuildClip(clip, chosen)
  writeJson(CHOSEN, chosen)
  markChanged()
  return r
}

function remasterAll() {
  const chosen = loadChosen()
  const hashes = [...new Set(Object.keys(chosen).map(k => k.slice(0, 16)))]
  let done = 0
  for (const h of hashes) {
    const clip = clipForKey(h)
    if (!clip) { console.log(`  ${h}  words changed since — its takes stay on disk, nothing to remaster`); continue }
    const r = rebuildClip(clip, chosen)
    const lines = Object.keys(chosen).filter(k => k.startsWith(h)).map(k => `${k.slice(17) || 'line'}:${chosen[k].mode || '?'}`)
    console.log(`  ${h}  ${r.waiting ? 'waiting for the other sentences (no generated voice)' : r.written ? `${r.dur.toFixed(2)}s` : 'restored'}  ${lines.join(' ')}`)
    done++
  }
  writeJson(CHOSEN, chosen)
  console.log(`${done} clip(s) remastered from the raw takes into ${CACHE}`)
}

// ---------- the server -------------------------------------------------------
const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
}
function sendFile(req, res, file, type) {
  const size = fs.statSync(file).size
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '')
  if (m) {
    const a = m[1] ? +m[1] : Math.max(0, size - +m[2]), b = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1
    if (a > b || a >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end() }
    res.writeHead(206, { 'Content-Type': type, 'Content-Length': b - a + 1, 'Content-Range': `bytes ${a}-${b}/${size}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' })
    return fs.createReadStream(file, { start: a, end: b }).pipe(res)
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' })
  fs.createReadStream(file).pipe(res)
}
const body = (req, limit) => new Promise((resolve, reject) => {
  const chunks = []; let n = 0
  req.on('data', c => { n += c.length; if (n > limit) { reject(new Error('too large')); req.destroy() } else chunks.push(c) })
  req.on('end', () => resolve(Buffer.concat(chunks)))
  req.on('error', reject)
})
const TYPES = { '.webm': 'audio/webm', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac' }

async function handle(req, res) {
  // only this machine, by name too (a page elsewhere cannot rebind a host name onto it)
  const host = String(req.headers.host || '')
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return send(res, 403, { error: 'local only' })
  const url = new URL(req.url, 'http://127.0.0.1')
  const p = url.pathname
  if (req.method === 'GET' && p === '/') return send(res, 200, fs.readFileSync(PAGE), 'text/html; charset=utf-8')
  if (req.method === 'GET' && p.startsWith('/fonts/')) {
    const f = T.FONTS.find(x => x.file === p.slice(7))
    if (!f) return send(res, 404, { error: 'no such face' })
    return sendFile(req, res, path.join(T.FONT_DIRS[f.dir], f.file), 'font/woff2')
  }
  if (req.method === 'GET' && p === '/api/state') return send(res, 200, model())
  let m
  if (req.method === 'GET' && (m = /^\/audio\/clip\/([0-9a-f]{16})\.mp3$/.exec(p))) {
    const f = cacheFile(m[1])
    return exists(f) ? sendFile(req, res, f, 'audio/mpeg') : send(res, 404, { error: 'not voiced' })
  }
  if (req.method === 'GET' && (m = /^\/audio\/take\/([0-9a-f-]+)\/([\w.-]+)$/.exec(p))) {
    if (!KEY.test(m[1]) || !TAKE_FILE.test(m[2])) return send(res, 400, { error: 'bad name' })
    const f = path.join(TAKES, m[1], m[2])
    return exists(f) ? sendFile(req, res, f, TYPES[path.extname(f)] || 'application/octet-stream') : send(res, 404, { error: 'no such take' })
  }
  if (req.method === 'POST' && (m = /^\/api\/take\/([0-9a-f-]+)$/.exec(p))) {
    if (!KEY.test(m[1])) return send(res, 400, { error: 'bad key' })
    const found = findLine(m[1])
    if (!found) return send(res, 404, { error: 'no line has that key' })
    const ext = AUDIO[String(req.headers['content-type'] || '').split(';')[0].trim()]
    if (!ext) return send(res, 415, { error: 'send audio (webm, ogg, mp4, mpeg or wav)' })
    const bytes = await body(req, 80e6)
    if (bytes.length < 200) return send(res, 400, { error: 'the take is empty' })
    const dir = path.join(TAKES, m[1])
    fs.mkdirSync(dir, { recursive: true })
    const file = new Date().toISOString().replace(/:/g, '-') + ext       // no colons: Windows names
    fs.writeFileSync(path.join(dir, file), bytes)
    const take = takesOf(m[1], found.line.text).find(t => t.file === file)
    return send(res, 200, { take })
  }
  if (req.method === 'POST' && (p === '/api/choose' || p === '/api/restore')) {
    const q = JSON.parse((await body(req, 1e5)).toString('utf8') || '{}')
    if ((q.key && !KEY.test(q.key)) || (q.clip && !/^[0-9a-f]{16}$/.test(q.clip))) return send(res, 400, { error: 'bad key' })
    try {
      const r = p === '/api/choose' ? choose(q.key, q.take) : restore(q)
      return send(res, 200, { ok: true, result: r })
    } catch (e) { return send(res, 422, { error: e.message }) }
  }
  send(res, 404, { error: 'not found' })
}

if (require.main === module) {
  if (process.argv.includes('--master')) { remasterAll(); process.exit(0) }
  fs.mkdirSync(TAKES, { recursive: true })
  const server = http.createServer((req, res) => handle(req, res).catch(e => { try { send(res, 500, { error: e.message }) } catch {} }))
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`track recorder: http://127.0.0.1:${PORT}/`)
    console.log(`  audio cache ${CACHE}`)
    console.log(`  takes       ${TAKES}`)
  })
}

module.exports = { wordTimes, textSpans, clipOf, layoutOf, fitTake, rebuildClip, model }
