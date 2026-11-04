// Where each sentence sits in a voiced line.
//
// The clock is the mp3 itself. Clause pauses and sentence pauses overlap in
// duration, so the longest gaps are not the sentence ends; and placing each
// cut at the gap nearest where it OUGHT to fall drifts, because one slow
// sentence pushes every later expectation off by a gap (scene 15 came out
// three sentences wrong that way). Instead the sentence ends are CHOSEN
// TOGETHER: of the silences the voice actually left, the n-1 that let every
// sentence be read at one pace (letters per second, a [pause:N] inside a
// sentence held as the pause) — a small dynamic programme, then once more at
// the pace those cuts imply. A sentence ends at a full stop followed by a
// capital, so "the A.I. reads" stays one sentence. concepts.cjs
// times its drawn clips with this; recorder.cjs cuts a scene into the lines a
// person re-reads with it, so both agree on where a sentence starts.
//
//   const { sentencesOf, sentenceTimes, silencesOf } = require('./timing.cjs')
//   sentenceTimes(mp3, sentencesOf(spokenText))
//     → { starts, spans: [{ start, end }], audioDur, speechEnd, silences }
const fs = require('fs')
const { execFileSync, spawnSync } = require('child_process')
/** the spoken text, one string per sentence ("A.I. reads" does not end one) */
const sentencesOf = (spoken) => spoken.split(/(?<=[.!?])\s+(?=[^a-z])/).filter(s => s.trim())
const durationOf = (f) => parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim())
/** every silence ffmpeg hears: [{ start, end }] (a silence still open at the end closes there) */
function silencesOf(audio, { noise = -38, d = 0.25, dur } = {}) {
  const det = spawnSync('ffmpeg', ['-i', audio, '-af', `silencedetect=noise=${noise}dB:d=${d}`, '-f', 'null', '-'], { encoding: 'utf8' })
  const text = det.stderr || ''
  const out = []
  for (const m of text.matchAll(/silence_start: (-?[\d.]+)[\s\S]*?silence_end: ([\d.]+)/g)) out.push({ start: Math.max(0, +m[1]), end: +m[2] })
  const open = [...text.matchAll(/silence_start: (-?[\d.]+)/g)]
  if (open.length > out.length) out.push({ start: Math.max(0, +open[open.length - 1][1]), end: dur ?? durationOf(audio) })
  return out
}
const PAUSE = /\[pause(?::(\d+))?\]/g
const weightOf = (s) => s.replace(PAUSE, ' ').replace(/[^A-Za-z0-9]/g, '').length || 1
// a pause inside a sentence is held inside its span; one at either end falls in the gap
const pauseOf = (s) => [...s.trim().matchAll(PAUSE)].filter(m => m.index > 0 && m.index + m[0].length < s.trim().length).reduce((t, m) => t + (Number(m[1]) || 700) / 1000, 0)
/** the sentences' starts (the gap each one follows) and their spoken spans */
function sentenceTimes(audio, sentences, { silences } = {}) {
  const dur = durationOf(audio)
  silences = silences || silencesOf(audio, { dur })
  const trailing = silences.length && Math.abs(silences[silences.length - 1].end - dur) < 0.08
  const speechEnd = trailing ? silences[silences.length - 1].start : dur
  const lead = silences.length && silences[0].start < 0.05 ? silences[0].end : 0
  const gaps = silences.filter(s => s.start > lead + 0.05 && s.end < dur - 0.08)
  const n = sentences.length
  const W = sentences.map(weightOf), P = sentences.map(pauseOf)
  let cuts
  if (n > 1 && gaps.length >= n - 1) {
    // choose n-1 of the gaps, in order, so every sentence is read at one pace
    let rate = W.reduce((a, b) => a + b, 0) / Math.max(0.5, speechEnd - lead - P.reduce((a, b) => a + b, 0) - (n - 1) * 0.4)
    for (let pass = 0; pass < 3; pass++) {
      const G = gaps.length
      const startOf = (g) => g < 0 ? lead : gaps[g].end
      const endOf = (g) => g >= G ? speechEnd : gaps[g].start
      const cost = (j, a, b) => {           // sentence j from after gap a to before gap b
        const d = endOf(b) - startOf(a) - P[j]
        if (d <= 0.05) return 1e9
        const r = Math.log(d * rate / W[j])
        return r * r - 0.4 * Math.min(0.6, b < G ? gaps[b].end - gaps[b].start : 0)
      }
      // best[j][g]: sentences 0..j placed, sentence j ends at gap g
      const best = [], from = []
      for (let j = 0; j < n - 1; j++) {
        best.push(new Array(G).fill(Infinity)); from.push(new Array(G).fill(-1))
        for (let g = j; g < G - (n - 2 - j); g++) {
          if (j === 0) { best[0][g] = cost(0, -1, g); continue }
          for (let p = j - 1; p < g; p++) {
            const c = best[j - 1][p] + cost(j, p, g)
            if (c < best[j][g]) { best[j][g] = c; from[j][g] = p }
          }
        }
      }
      let end = -1, bc = Infinity
      for (let g = n - 2; g < G; g++) { const c = best[n - 2][g] + cost(n - 1, g, G); if (c < bc) { bc = c; end = g } }
      const pick = [end]
      for (let j = n - 2; j > 0; j--) pick.unshift(from[j][pick[0]])
      cuts = pick.map(g => gaps[g])
      // the pace these cuts imply, and once more with it
      let said = 0
      sentences.forEach((_, j) => { said += (j === n - 1 ? speechEnd : cuts[j].start) - (j === 0 ? lead : cuts[j - 1].end) - P[j] })
      rate = W.reduce((a, b) => a + b, 0) / Math.max(0.5, said)
    }
  }
  const starts = [0]
  if (cuts) cuts.forEach(c => starts.push(c.end))
  else {
    cuts = []
    const total = W.reduce((a, b) => a + b, 0); let cum = 0
    for (let j = 0; j < n - 1; j++) { cum += W[j]; const at = lead + cum / total * (speechEnd - lead); starts.push(at); cuts.push(null) }
  }
  const spans = sentences.map((_, j) => ({
    start: j === 0 ? Math.min(lead, starts[1] ?? speechEnd) : starts[j],
    end: j === n - 1 ? speechEnd : (cuts[j] ? cuts[j].start : starts[j + 1]),
  }))
  return { starts, spans, audioDur: dur, speechEnd, silences }
}
const exists = (f) => { try { return fs.statSync(f).isFile() } catch { return false } }
module.exports = { sentencesOf, sentenceTimes, silencesOf, durationOf, exists }
