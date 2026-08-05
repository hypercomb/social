// One mastering chain, so every voice on the reel sits at the same level.
//
// A broadcast chain: rumble filter, gentle de-noise, de-esser, light
// compression, then TWO-PASS EBU R128 loudness normalisation. The second pass
// is what makes separate takes match — which is the thing that actually reads
// as "produced". Whether a line was read into a microphone or spoken by a model
// of the same voice, it goes through here; nothing reaches the reel unmastered.
const { execFileSync, spawnSync } = require('child_process')
const path = require('path')

const LUFS = -16, TRUE_PEAK = -1.5, LRA = 11      // podcast/broadcast target

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

module.exports = { CLEANUP, LUFS, TRUE_PEAK, LRA, measure, master, durationOf }
