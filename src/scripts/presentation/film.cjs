// Any narrated composition as an MP4 — for anywhere that will not run a page.
//
// The deliverable is already the whole film: the picture, the voice as inlined
// data uris, and the seconds each line lands at. So this re-voices nothing and
// re-times nothing. It reads the page, draws it frame by frame, and lays the
// same clips at the same cue seconds. If the MP4 and the page disagree, the
// bug is here, not in the story.
//
// Frame-exact, not a screen recording. The stage OWNS the export transport:
// dispatch 'data-om-seek-to-time-frame' with {time, sync:true} on the
// exportable root and the DOM reflects that instant the moment dispatchEvent
// returns (the stage commits it through flushSync). So a frame is never "what
// the browser managed to paint in 33ms" — it is the composition AT that
// second, and a slow machine makes the render take longer rather than making
// the film stutter.
//
//   node film.cjs deepseek-comparison        → posts/deepseek-comparison.mp4 + .srt
//   node film.cjs ecosystem-bloom            → the ecosystem film, same way
//   node film.cjs deepseek-comparison --keep # reuse the frames already drawn
//   node film.cjs deepseek-comparison --max 45   # ceiling in MB (default 9.4)
//
// The name is the deliverable in dist/, with or without the `hypercomb-`
// prefix and the `.html`. Frames land in full/frames/<name>/ (gitignored) and
// are wiped first — a shorter re-cut must not inherit the old tail.
//
// The size ceiling is not a quality opinion. The browser-extension upload path
// these are posted through caps a file at 10MB, so the encode starts at a good
// CRF and only walks it up if the result overshoots; flat vector and type
// compress far better than footage, so the first try usually ships. Raise it
// with --max when the destination is not that path.
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = __dirname
const DIST = path.join(ROOT, 'dist')
const POSTS = path.join(ROOT, 'posts')
const FPS = 30
const W = 1920, H = 1080

const flag = (name, fallback) => {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback
}
const KEEP = process.argv.includes('--keep')
const MAX_MB = Number(flag('max', '9.4'))
const asked = process.argv.slice(2).find(a => !a.startsWith('--') && a !== String(MAX_MB))
if (!asked) throw new Error('name a deliverable: node film.cjs deepseek-comparison')

const stem = asked.replace(/\.html$/, '').replace(/^hypercomb-/, '')
const deliverable = path.join(DIST, `hypercomb-${stem}.html`)
if (!fs.existsSync(deliverable)) throw new Error(`no such deliverable: ${path.relative(ROOT, deliverable)}`)
const FRAMES = path.join(ROOT, 'full', 'frames', stem)
const CLIPS = path.join(ROOT, 'full', 'clips', stem)
const mp4 = path.join(POSTS, `${stem}.mp4`)
const srt = path.join(POSTS, `${stem}.srt`)

const ff = (args) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' })
const MB = f => fs.statSync(f).size / 1e6
const even = n => Math.floor(n / 2) * 2

// --- the picture -------------------------------------------------------------
// The stage fits itself into whatever room the page gives it, so the viewport
// is measured rather than assumed: shoot once, see how much room the chrome
// took, and give the window that much extra. A half-pixel offset can still
// leave an odd row (which x264 refuses), so the crop is the safety net.
async function draw() {
  const { chromium } = require('playwright')
  const browser = await chromium.launch({ args: ['--mute-audio'] })
  const open = async (width, height) => {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    await page.goto('file:///' + deliverable.split(path.sep).join('/'), { waitUntil: 'load' })
    await page.waitForSelector('[data-om-exportable-video-with-duration-secs]', { timeout: 30000 })
    await page.waitForTimeout(3000)          // fonts, first commit
    const seen = await page.evaluate(() => {
      const el = document.querySelector('[data-om-exportable-video-with-duration-secs]')
      const b = el.getBoundingClientRect()
      return {
        duration: +el.getAttribute('data-om-exportable-video-with-duration-secs'),
        sync: el.getAttribute('data-om-sync-seek') === 'true',
        w: b.width, h: b.height,
        narration: window.OM_NARRATION ? JSON.parse(window.OM_NARRATION) : [],
      }
    })
    return { ctx, page, seen }
  }

  let { ctx, page, seen } = await open(W, H)
  if (Math.round(seen.w) !== W || Math.round(seen.h) !== H) {
    const vw = Math.round(W + (W - seen.w)), vh = Math.round(H + (H - seen.h))
    await ctx.close()
    ;({ ctx, page, seen } = await open(vw, vh))
    console.log(`viewport ${vw}x${vh} → stage ${Math.round(seen.w)}x${Math.round(seen.h)}`)
  }
  if (!seen.sync) console.log('note: the stage does not advertise sync seeks — frames may lag their timestamp')
  if (!seen.narration.length) console.log('note: no OM_NARRATION in this deliverable — the film will be silent')

  // The clips, straight from the page: the same bytes the film plays.
  fs.rmSync(CLIPS, { recursive: true, force: true })
  fs.mkdirSync(CLIPS, { recursive: true })
  const cues = seen.narration.map((n, i) => {
    const file = path.join(CLIPS, `${String(i).padStart(2, '0')}-${n.scene.toLowerCase()}.mp3`)
    fs.writeFileSync(file, Buffer.from(n.src.split(',')[1], 'base64'))
    return { scene: n.scene, at: n.at, dur: n.dur, text: n.text, file }
  })

  const total = Math.round(seen.duration * FPS)
  if (!KEEP) {
    // A re-cut that is shorter than the last one must not inherit its tail.
    fs.rmSync(FRAMES, { recursive: true, force: true })
    fs.mkdirSync(FRAMES, { recursive: true })
    const el = await page.$('[data-om-exportable-video-with-duration-secs]')
    const t0 = Date.now()
    for (let f = 0; f < total; f++) {
      await page.evaluate((time) => {
        document.querySelector('[data-om-exportable-video-with-duration-secs]')
          .dispatchEvent(new CustomEvent('data-om-seek-to-time-frame', { detail: { time, sync: true } }))
      }, f / FPS)
      await el.screenshot({ path: path.join(FRAMES, `f${String(f).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 })
      if (f && f % 300 === 0) {
        const per = (Date.now() - t0) / f
        console.log(`  ${f}/${total}  ${per.toFixed(0)}ms/frame  ${(((total - f) * per) / 60000).toFixed(1)}min left`)
      }
    }
    console.log(`drew ${total} frames in ${((Date.now() - t0) / 60000).toFixed(1)}min`)
  } else {
    const have = fs.existsSync(FRAMES) ? fs.readdirSync(FRAMES).length : 0
    if (have !== total) throw new Error(`--keep: ${have} frames on disk, ${total} needed — drop --keep`)
    console.log(`reusing ${have} frames`)
  }

  await browser.close()
  return { duration: seen.duration, total, cues, crop: `${even(seen.w)}:${even(seen.h)}:0:0` }
}

// --- the voice, laid out on one track ---------------------------------------
// Each clip goes in at the `at` the build already computed, so the voice lands
// on the same frame it lands on in the page. amix with normalize=0 keeps every
// clip at its mastered level — normalising would duck all ten by 1/10th for
// the sake of overlaps that never happen.
//
// `apad` is not a nicety. amix ends at the last clip, and `-t` is a ceiling,
// never a floor — so without it the track is as long as the VOICE, and the
// mux's `-shortest` then ends the film at the last syllable, throwing away
// every frame the composition holds after it. That is silent: ffmpeg says
// nothing, exits 0, and the summary prints the truncated length as if it were
// the film. `apad` runs the track out to `-t duration`, so `-shortest` has
// nothing left to cut, and the SRT (clamped to the same duration) agrees with
// the file. The check in `cut` is what makes sure it stays that way.
function voice(cues, duration) {
  const track = path.join(CLIPS, 'track.m4a')
  if (!cues.length) return null
  const chains = cues.map((c, i) =>
    `[${i}]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${Math.round(c.at * 1000)}:all=1[a${i}]`)
  ff([...cues.flatMap(c => ['-i', c.file]),
    '-filter_complex', chains.join(';') + ';' + cues.map((_, i) => `[a${i}]`).join('') +
      `amix=inputs=${cues.length}:normalize=0:dropout_transition=0,apad[out]`,
    '-map', '[out]', '-t', String(duration), '-c:a', 'aac', '-b:a', '160k', track])
  return track
}

// --- captions, the same words a third time ----------------------------------
function captions(cues, duration) {
  const stamp = (s) => {
    const ms = Math.round(s * 1000)
    const pad = (n, w) => String(n).padStart(w, '0')
    return `${pad(Math.floor(ms / 3600000), 2)}:${pad(Math.floor(ms / 60000) % 60, 2)}:${pad(Math.floor(ms / 1000) % 60, 2)},${pad(ms % 1000, 3)}`
  }
  fs.writeFileSync(srt, cues.map((c, i) =>
    `${i + 1}\n${stamp(c.at)} --> ${stamp(Math.min(c.at + c.dur + 0.3, duration))}\n${c.text}\n`).join('\n'))
}

// Every frame that was drawn must be in the file. A mux can drop the tail
// without saying so, and a film that is quietly 2.7s short still probes as a
// perfectly valid mp4 — so count the frames back out and refuse to ship a
// number that disagrees with the number we drew.
function encoded(file) {
  // csv=p=0 still prints the row separator and a CRLF here ("2740,\r\n"), so
  // take the digits rather than the line — a NaN would fail the check for the
  // wrong reason and read exactly like a lost tail.
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file]).toString()
  const m = out.match(/\d+/)
  if (!m) throw new Error(`could not count the frames in ${path.basename(file)}: ffprobe said "${out.trim()}"`)
  return Number(m[0])
}

;(async () => {
  fs.mkdirSync(POSTS, { recursive: true })
  const { duration, total, cues, crop } = await draw()
  const track = voice(cues, duration)

  for (let crf = 19; ; crf += 4) {
    ff(['-framerate', String(FPS), '-i', path.join(FRAMES, 'f%05d.jpg'),
      ...(track ? ['-i', track] : []),
      '-vf', `crop=${crop}`, '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p',
      ...(track ? ['-c:a', 'copy', '-shortest'] : []),
      '-movflags', '+faststart', mp4])
    console.log(`crf ${crf}: ${MB(mp4).toFixed(2)} MB`)
    if (MB(mp4) <= MAX_MB || crf >= 32) break
  }
  if (MB(mp4) > MAX_MB) console.log(`note: ${MB(mp4).toFixed(2)} MB is over the ${MAX_MB} MB ceiling even at crf 32`)

  const got = encoded(mp4)
  if (got !== total) throw new Error(`the film lost frames: drew ${total}, encoded ${got} — the picture is ` +
    `${((total - got) / FPS).toFixed(2)}s shorter than the composition`)

  if (cues.length) captions(cues, duration)
  const shape = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate', '-show_entries', 'format=duration',
    '-of', 'csv=p=0', mp4]).toString().trim().split('\n').join(' ')
  console.log(`${path.relative(ROOT, mp4)}  ${shape}  ${got} frames  ${MB(mp4).toFixed(2)} MB` +
    (cues.length ? `  ·  ${path.relative(ROOT, srt)}, ${cues.length} cues` : '  ·  silent'))
})().catch(e => { console.error('film build failed:', e.message); process.exit(1) })
