// Where each sentence sits in a voiced line.
//
// The clock is the mp3 itself. Sentences are found by matching the
// word-count-proportional expectation against the silences the voice actually
// left — clause pauses and sentence pauses overlap in duration, so "nearest
// gap to where the sentence OUGHT to end" beats "longest gaps". concepts.cjs
// times its drawn clips with this; recorder.cjs cuts a scene into the lines a
// person re-reads with it, so both agree on where a sentence starts.
//
//   const { sentencesOf, sentenceTimes, silencesOf } = require('./timing.cjs')
//   sentenceTimes(mp3, sentencesOf(spokenText))
//     → { starts, spans: [{ start, end }], audioDur, speechEnd, silences }
const fs = require('fs')
const { execFileSync, spawnSync } = require('child_process')

/** the spoken text, one string per sentence */
const sentencesOf = (spoken) => spoken.split(/(?<=[.!?])\s+/).filter(s => s.trim())

const durationOf = (f) => parseFloat(execFileSync('ffprobe',
  ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim())

/** every silence ffmpeg hears: [{ start, end }] (a silence still open at the end closes there) */
function silencesOf(audio, { noise = -38, d = 0.25, dur } = {}) {
  const det = spawnSync('ffmpeg', ['-i', audio, '-af', `silencedetect=noise=${noise}dB:d=${d}`, '-f', 'null', '-'], { encoding: 'utf8' })
  const text = det.stderr || ''
  const out = []
  for (const m of text.matchAll(/silence_start: (-?[\d.]+)[\s\S]*?silence_end: ([\d.]+)/g))
    out.push({ start: Math.max(0, +m[1]), end: +m[2] })
  const open = [...text.matchAll(/silence_start: (-?[\d.]+)/g)]
  if (open.length > out.length) out.push({ start: Math.max(0, +open[open.length - 1][1]), end: dur ?? durationOf(audio) })
  return out
}

/** the sentences' starts (the gap each one follows) and their spoken spans */
function sentenceTimes(audio, sentences, { silences } = {}) {
  const dur = durationOf(audio)
  silences = silences || silencesOf(audio, { dur })
  const trailing = silences.length && Math.abs(silences[silences.length - 1].end - dur) < 0.08
  const speechEnd = trailing ? silences[silences.length - 1].start : dur
  const gaps = silences.filter(s => s.end < dur - 0.08)
  const words = sentences.map(s => s.split(/\s+/).length)
  const total = words.reduce((a, b) => a + b, 0)

  const starts = [0]
  const cuts = []                              // the silence each later sentence follows, or null
  let cum = 0, last = 0
  for (let j = 0; j < sentences.length - 1; j++) {
    cum += words[j]
    const expect = cum / total * speechEnd
    const usable = gaps.filter(g => g.end > last + 0.3)
    const pick = usable.length
      ? usable.reduce((a, b) => Math.abs(b.end - expect) < Math.abs(a.end - expect) ? b : a)
      : null
    const at = pick ? pick.end : expect
    starts.push(at); cuts.push(pick); last = at
  }
  const lead = silences.length && silences[0].start < 0.05 ? silences[0].end : 0
  const spans = sentences.map((_, j) => ({
    start: j === 0 ? Math.min(lead, starts[1] ?? speechEnd) : starts[j],
    end: j === sentences.length - 1 ? speechEnd : (cuts[j] ? cuts[j].start : starts[j + 1]),
  }))
  return { starts, spans, audioDur: dur, speechEnd, silences }
}

const exists = (f) => { try { return fs.statSync(f).isFile() } catch { return false } }

module.exports = { sentencesOf, sentenceTimes, silencesOf, durationOf, exists }
