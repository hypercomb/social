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
const { master, LUFS } = require('./master.cjs')
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
  // the usual rough count: a silent final e (but "people" is two), -ed and -es mostly silent
  const n = (s.replace(/(?:[^laeiouy]es|[^laeiouytd]ed|[^laeiouy]e)$/, '').match(/[aeiouy]{1,2}/g) || []).length
  return Math.max(1, n)
}
const holdOf = (w) => /[.!?]["”’)]*$/.test(w) ? 1.6 : /[,;:—–]["”’)]*$/.test(w) ? 1 : 0

/** which word each pause heard inside [a, b] follows: chosen TOGETHER, so that
 *  every stretch between pauses is read at one pace (syllables a second), a
 *  pause after a comma or full stop counting for a little more and a pause
 *  left unexplained for a little less. Placing each pause at the word nearest
 *  where it ought to fall slips a word early or late whenever one phrase is
 *  quicker than the next; this does not. → [{ word, endAt }, { word: word + 1, at }] */
function anchorsOf(unit, hold, a, b, gaps) {
  const n = unit.length, G = gaps.length
  if (!G || n < 2) return []
  const P = [0]
  for (const u of unit) P.push(P[P.length - 1] + u)
  const avg = P[n] / Math.max(0.1, b - a - gaps.reduce((t, g) => t + g.end - g.start, 0))
  const seg = (u, d) => d <= 0.04 ? 1e9 : Math.log(u / d / avg) ** 2
  const SKIP = 0.15, PUNCT = 0.25        // a voice pauses at a comma or full stop far more often than anywhere else
  const best = gaps.map(() => new Array(n - 1).fill(Infinity)), from = gaps.map(() => new Array(n - 1).fill(null))
  for (let i = 0; i < G; i++) for (let k = 0; k < n - 1; k++) {
    const bonus = hold[k] ? -PUNCT : 0
    let c = seg(P[k + 1], gaps[i].start - a) + SKIP * i, f = null
    for (let i2 = 0; i2 < i; i2++) for (let k2 = 0; k2 < k; k2++) {
      const v = best[i2][k2] + seg(P[k + 1] - P[k2 + 1], gaps[i].start - gaps[i2].end) + SKIP * (i - i2 - 1)
      if (v < c) { c = v; f = [i2, k2] }
    }
    best[i][k] = c + bonus; from[i][k] = f
  }
  let end = null, cost = seg(P[n], b - a) + SKIP * G
  for (let i = 0; i < G; i++) for (let k = 0; k < n - 1; k++) {
    const v = best[i][k] + seg(P[n] - P[k + 1], b - gaps[i].end) + SKIP * (G - 1 - i)
    if (v < cost) { cost = v; end = [i, k] }
  }
  const out = []
  for (let at = end; at; at = from[at[0]][at[1]]) {
    const g = gaps[at[0]]
    out.unshift({ word: at[1], endAt: g.start }, { word: at[1] + 1, at: g.end })
  }
  return out
}

/** each word's moment in [a, b]: anchored on the pauses heard inside the span
 *  (anchorsOf), proportional to syllables between, commas and full stops
 *  holding a little */
function wordTimes(text, a, b, silences = []) {
  const words = text.split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const n = words.length
  const unit = words.map(w => syllables(w) + 0.4)
  const hold = words.map((w, i) => i < n - 1 ? holdOf(w) : 0)
  const gaps = silences.filter(g => g.start > a + 0.05 && g.end < b - 0.05 && g.end - g.start >= 0.12)
  const anchors = [{ word: 0, at: a }, ...anchorsOf(unit, hold, a, b, gaps)]
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
    shift += len - slot + (p && p.fitted && !waiting ? p.round || 0 : 0)
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
  if (tail && tail.end >= dur - 0.15 && tail.start > s) e = tail.start
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
const ff = (args) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: ['ignore', 'ignore', 'pipe'], maxBuffer: 1 << 30 })
const SR = 24000                 // the voice's rate: 24 kHz mono
const PCM = ['-f', 's16le', '-ac', '1', '-ar', String(SR)]

/** master, trim and fit one take to its slot: 24 kHz mono samples, and what was done.
 *  The SPEECH is what is measured and fitted (the slot is the voice's speech,
 *  pause to pause); 20 ms before it and 50 ms after ride along in the gaps, so
 *  a word's onset and decay are never clipped. `room` is the slot in samples
 *  (a scene's first sentence can give its first 50 ms to the encoder, below). */
const PRE = 0.02, POST = 0.05
function fitTake(raw, slot, tmp, name, room = Math.round(slot * SR), gain = 0) {
  const mastered = path.join(tmp, name + '.m.mp3')
  master(raw, mastered)
  const dur = durationOf(mastered)
  const sil = silencesOf(mastered, { noise: -45, d: 0.08, dur })
  let s = 0, e = dur
  if (sil.length && sil[0].start < 0.03) s = sil[0].end
  const tail = sil[sil.length - 1]
  if (tail && tail.end >= dur - 0.15 && tail.start > s) e = tail.start     // an mp3 ends on a few frames of encoder tail
  const speech = e - s
  if (speech < 0.2) throw new Error('the take is silent — nothing above the noise floor')
  const cutS = Math.max(0, s - PRE), cutE = Math.min(dur, e + POST)
  const stretch = Math.abs(speech / slot - 1) <= FIT
  const tempo = stretch ? speech * SR / room : 1
  const want = Math.round((cutE - cutS) * SR / tempo)
  const af = [`atrim=start=${cutS.toFixed(4)}:end=${cutE.toFixed(4)}`, 'asetpts=PTS-STARTPTS']
  if (stretch) af.push(`atempo=${tempo.toFixed(6)}`)
  if (gain) af.push(`volume=${gain.toFixed(2)}dB`)
  af.push(`aresample=${SR}`)
  const out = path.join(tmp, name + '.fit.raw')
  ff(['-i', mastered, '-af', af.join(','), ...PCM, out])
  const pcm = Buffer.alloc(want * 2)               // exactly that long: pad or cut the last samples
  fs.readFileSync(out).copy(pcm, 0, 0, want * 2)
  const pre = Math.round((s - cutS) * SR / tempo)
  const said = stretch ? room : Math.round(speech * SR)
  return { pcm, pre, post: want - pre - said, natural: +speech.toFixed(3), fitted: +(said / SR).toFixed(3),
    mode: stretch ? 'stretched' : 'natural', tempo: +tempo.toFixed(4), gain: +gain.toFixed(2) }
}

/** integrated loudness (LUFS) of a file as it is, no cleanup in front */
function loudnessOf(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' })
  const m = /Integrated loudness:\s*I:\s*(-?[\d.]+) LUFS/.exec(r.stderr || '')
  return m ? +m[1] : NaN
}

// ---------- the voice, frame by frame -----------------------------------------
// The generated voice is a bare stream of 144-byte MPEG-2 layer III frames
// (24 kHz mono, 48 kbit/s, 576 samples = 24 ms each). Re-encoding the whole
// scene would put every other sentence through a second generation of loss, so
// it is spliced instead: the frames before and after a replaced sentence are
// COPIED, and only the stretch from the gap before it to the gap after it is
// encoded anew. Three things make the copy exact. A fresh encoder says nothing
// for PRIME samples, so a new stretch starts in the gap. A frame may keep part
// of its data in the frames before it (the bit reservoir, up to 255 bytes), so
// the CARRY frames before the first copied one are rebuilt as silent frames
// that still carry the original's bytes. And the decoder's overlap needs a
// couple of frames to settle, so the copy resumes SETTLE frames before the
// next sentence's first word. Everything outside the new stretch then decodes
// to the very same samples. A voice that is not such a stream (one assembled
// around [pause] marks has a header) is re-encoded whole instead.
const FRAME = 576, PRIME = 1105, CARRY = 2, SETTLE = 2, TAIL = 2
function plainFrames(buf) {
  if (buf.length < 4 || buf[0] !== 0xff) return null
  const [h1, h2, h3] = [buf[1], buf[2], buf[3]]
  // MPEG-2, layer III, no CRC; 48 kbit/s, 24 kHz, no padding; mono
  if ((h1 & 0xff) !== 0xf3 || (h2 & 0xfe) !== 0x64 || (h3 & 0xc0) !== 0xc0) return null
  const size = 144
  if (buf.length % size) return null
  for (let i = 0; i < buf.length; i += size)
    if (buf[i] !== 0xff || buf[i + 1] !== h1 || (buf[i + 2] & 0xfe) !== (h2 & 0xfe) || (buf[i + 3] & 0xc0) !== 0xc0) return null
  return { size, count: buf.length / size, side: 9 }
}
/** a frame that says nothing but still carries an original frame's bytes for the reservoir */
function carrier(buf, k, fr) {
  const f = Buffer.from(buf.subarray(k * fr.size, (k + 1) * fr.size))
  f.fill(0, 4, 4 + fr.side)                       // main_data_begin 0, no bits: a silent granule
  return f
}
function encodeFrames(pcm, tmp, name, want) {
  const inp = path.join(tmp, name + '.raw'), out = path.join(tmp, name + '.mp3')
  fs.writeFileSync(inp, pcm)
  ff([...PCM, '-i', inp, '-c:a', 'libmp3lame', '-b:a', '48k', '-write_xing', '0', '-id3v2_version', '0', '-f', 'mp3', out])
  const b = fs.readFileSync(out), fr = plainFrames(b)
  if (!fr || fr.count < want) throw new Error('the encoder did not give the frames the splice needs')
  return b.subarray(0, want * fr.size)
}
const decode = (file) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, ...PCM, '-'], { maxBuffer: 1 << 30 })

/** the scene with its chosen sentences spliced in, every other frame copied */
function splice(clip, picks, fitted, original, voice, fr, tmp) {
  const N = fr.count
  const pcm = decode(original)
  const at = (sec) => Math.round(sec * SR)
  const span = (a, b) => { const out = Buffer.alloc(Math.max(0, b - a) * 2); pcm.copy(out, 0, Math.max(0, a) * 2, Math.max(0, Math.min(b, pcm.length / 2)) * 2); return out }
  const n = clip.spans.length
  // each chosen sentence's stretch of frames [A, B): from the gap before it to the gap after
  const runs = []
  picks.forEach((p, j) => {
    if (!p) return
    const sp = clip.spans[j]
    const A = j === 0 ? 0 : Math.ceil((at(clip.spans[j - 1].end) + 240) / FRAME)
    let B = N
    if (j < n - 1) {
      const next = at(clip.spans[j + 1].start)
      B = Math.ceil((at(sp.end) + fitted[j].post + TAIL * FRAME) / FRAME) + CARRY
      B = Math.max(Math.ceil(at(sp.end) / FRAME) + CARRY, Math.min(B, Math.floor(next / FRAME) - SETTLE))
    }
    const last = runs[runs.length - 1]
    if (last && A < last.B + 1) { last.B = B; last.js.push(j) } else runs.push({ A, B, js: [j] })
  })
  const parts = []
  let copied = 0
  runs.forEach((run, r) => {
    const { A, js } = run
    const B = Math.min(N, run.B)
    parts.push(voice.subarray(copied * fr.size, A * fr.size))
    const seg = []
    let cursor = A * FRAME                                // where the original is read from
    let longer = 0                                        // seconds the takes run past their slots
    let said = 0                                          // where the last take ends in the new stretch
    js.forEach((j, i) => {
      const sp = clip.spans[j], f = fitted[j]
      // the take replaces its sentence and the margins around it, which come out of the gaps
      let start = at(sp.start) - f.pre
      if (i === 0) start = Math.max(start, A * FRAME + PRIME + 120)
      seg.push(span(cursor, start))
      seg.push(f.pcm)
      said = seg.reduce((t, b) => t + b.length / 2, 0)
      longer += f.fitted - (sp.end - sp.start)
      cursor = at(sp.end) + f.post
    })
    const stop = B < N ? (B - CARRY) * FRAME : N * FRAME
    seg.push(span(cursor, stop))
    let body = Buffer.concat(seg)
    // whole frames: the nearest count, with at least a frame of the gap after the take
    const m = Math.max(Math.ceil(said / FRAME) + 1, Math.round(body.length / 2 / FRAME))
    body = body.length / 2 >= m * FRAME ? body.subarray(0, m * FRAME * 2)
      : Buffer.concat([body, span(stop, stop + m * FRAME - body.length / 2)])
    body = Buffer.concat([body, Buffer.alloc(4 * FRAME * 2)])          // the encoder's last frames say nothing we keep
    parts.push(encodeFrames(body.subarray(PRIME * 2), tmp, `run${r}`, m))
    if (B < N) for (let k = B - CARRY; k < B; k++) parts.push(carrier(voice, k, fr))
    const moved = (A + m + (B < N ? CARRY : 0) - B) * FRAME / SR
    // what the frames move beyond the takes' own lengths (whole frames), carried by the run's last line
    picks[js[js.length - 1]].round = +(moved - longer).toFixed(6)
    copied = B
  })
  parts.push(voice.subarray(copied * fr.size))
  return Buffer.concat(parts)
}

/** rebuild a clip's mp3 from its generated voice and every chosen take in it */
const FMT = `aresample=${SR},aformat=sample_fmts=fltp:sample_rates=${SR}:channel_layouts=mono`
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
    const voice = original ? fs.readFileSync(original) : null
    const fr = voice && plainFrames(voice)
    // master.cjs brings a take to its broadcast level; the generated voice around it is
    // quieter (about -20 LUFS against -16), so a take spliced into it is brought down to
    // the voice's own measured level and never sticks out (never brought UP: no clipping)
    const level = original ? remember('loudness', original, () => loudnessOf(original)) : LUFS
    const gain = Number.isFinite(level) ? Math.min(0, level - LUFS) : 0
    const fitted = picks.map((p, j) => {
      if (!p) return null
      const sp = clip.spans[j]
      const slot = sp.end - sp.start
      // a scene that speaks before a fresh encoder can gives it those first samples
      const head = fr && j === 0 ? Math.max(0, PRIME + 120 + Math.round(PRE * SR) - Math.round(sp.start * SR)) : 0
      const r = fitTake(path.join(TAKES, keys[j], p.take), slot, tmp, `t${j}`, Math.round(slot * SR) - head, gain)
      Object.assign(p, { natural: r.natural, fitted: r.fitted, mode: r.mode, tempo: r.tempo, gain: r.gain, slot: +slot.toFixed(3) })
      delete p.round
      return r
    })
    let built
    if (fr) built = splice(clip, picks, fitted, original, voice, fr, tmp)
    else {
      // no frames to keep: the pieces in order, each gap the voice left (or the
      // reading pace's) kept as it was, the whole encoded once
      const pieces = []
      const gap = (a, b) => { if (b - a > 0.004) pieces.push(original ? { a, b } : { d: b - a }) }
      // a take's margins come out of the gaps beside it
      const left = (j) => fitted[j] ? Math.max(0, clip.spans[j].start - fitted[j].pre / SR) : clip.spans[j].start
      const right = (j) => fitted[j] ? clip.spans[j].end + fitted[j].post / SR : clip.spans[j].end
      clip.spans.forEach((sp, j) => {
        gap(j === 0 ? 0 : right(j - 1), left(j))
        pieces.push(fitted[j] ? { j } : { a: sp.start, b: sp.end })
      })
      gap(right(clip.spans.length - 1), Math.max(clip.audioDur, right(clip.spans.length - 1)))
      const lent = pieces.filter(x => x.a != null)
      const inputs = [], graph = []
      let ins = 0
      if (lent.length) { inputs.push('-i', original); ins++; graph.push(`[0:a]${FMT},asplit=${lent.length}` + lent.map((_, i) => `[s${i}]`).join('')) }
      let si = 0, zi = 0
      const labels = pieces.map(x => {
        if (x.a != null) { const i = si++; graph.push(`[s${i}]atrim=start=${x.a.toFixed(4)}:end=${x.b.toFixed(4)},asetpts=PTS-STARTPTS[o${i}]`); return `o${i}` }
        if (x.j != null) {
          const f = path.join(tmp, `t${x.j}.pcm`); fs.writeFileSync(f, fitted[x.j].pcm)
          inputs.push(...PCM, '-i', f); graph.push(`[${ins++}:a]${FMT}[t${x.j}]`); return `t${x.j}`
        }
        const z = zi++; graph.push(`aevalsrc=0:c=mono:s=${SR}:d=${x.d.toFixed(4)},${FMT}[z${z}]`); return `z${z}`
      })
      graph.push(labels.map(l => `[${l}]`).join('') + `concat=n=${labels.length}:v=0:a=1[out]`)
      const file = path.join(tmp, 'clip.mp3')
      ff([...inputs, '-filter_complex', graph.join(';'), '-map', '[out]', '-ar', String(SR), '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '48k', file])
      built = fs.readFileSync(file)
    }
    // the generated voice is kept once, before the first replacement
    fs.mkdirSync(GEN, { recursive: true })
    if (!exists(genFile(hash)) && !exists(noneMark(hash))) {
      if (original) fs.copyFileSync(original, genFile(hash))
      else fs.writeFileSync(noneMark(hash), 'no generated voice existed when the takes were chosen\n')
    }
    const part = out + '.part'
    fs.writeFileSync(part, built)
    fs.renameSync(part, out)
    return { written: true, spliced: !!fr, dur: durationOf(out) }
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
  // and only this page may change anything: another site's page can still send a
  // request here (its Host is this one), but not with this Origin
  const origin = req.headers.origin
  if (req.method !== 'GET' && origin && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) return send(res, 403, { error: 'local only' })
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
    // JSON only: a form or a plain-text post from elsewhere is not a simple request this accepts
    if (!/^application\/json\b/.test(String(req.headers['content-type'] || ''))) return send(res, 415, { error: 'send JSON' })
    let q
    try { q = JSON.parse((await body(req, 1e5)).toString('utf8') || '{}') } catch { return send(res, 400, { error: 'bad JSON' }) }
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
