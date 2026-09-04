// The DeepSeek Harness / Hypercomb comparison, narrated.
//
// The composition is a Claude Design piece on the Broadsheet system — ten
// scenes, 1920×1080, authored in `deepseek/comparison-scenes.jsx` and shipped
// as one self-extracting bundle (`deepseek/comparison-shell.html`) that
// carries React, Babel and the fonts inlined. It had captions and no voice.
//
// This gives it the same voice as everything else: the SAME narrator, the
// SAME cache, the SAME key — sha256(voice|rate|spoken(say)) — so a line
// another piece already says costs no audio at all here.
//
//   deepseek/comparison-scenes.jsx    — the composition (edit the story here)
//   deepseek/comparison-shell.html    — the bundle shell (React/Babel/fonts)
//   audio-cache/<h16>.mp3             — narration, shared with build.cjs
//   dist/hypercomb-deepseek-comparison.html — the narrated deliverable
//
//   node scripts/presentation/deepseek.cjs             # narrate + assemble
//   node scripts/presentation/deepseek.cjs --check     # stale audio, no network
//   node scripts/presentation/deepseek.cjs --times     # report the retiming only
//   node scripts/presentation/deepseek.cjs --prompter  # a paced prompter to read from
//   node scripts/presentation/deepseek.cjs --takes     # master your reads into the cache
//
// The narration is the caption: one line per scene, spoken and shown from the
// same words. A scene keeps every beat it was drawn with and is given only the
// seconds its line needs — the silence between lines is what gets cut, never
// the speech.
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const crypto = require('crypto')
const { execFileSync } = require('child_process')

const ROOT = __dirname
const DS = path.join(ROOT, 'deepseek')
const CACHE = path.join(ROOT, 'audio-cache')          // the SAME cache the full build fills
const VOICE = 'en-US-AndrewMultilingualNeural'
const RATE = '+2%'
const LEAD = 0.35                                      // quiet before a line, in real seconds
const TAIL = 0.35                                      // quiet after it
const MAX_RATE = 1.4                                   // how much quicker a scene's picture may run

// One line per OM_SCENES entry — and the line IS the caption, so the words
// live here once and the composition reads them back. `lead` is the silence
// before it, in real seconds; give a scene more only when the picture has to
// arrive before the sentence makes sense.
const NARRATION = [
  { scene: 'Title', lead: 0.6, say: 'Two ways to say everything is a module: plugins in a harness, drones in a hive.' },
  { scene: 'Question', say: 'Every agent runs code it did not write. Three of these parts become plugins, three become drones. Which do you trust?' },
  { scene: 'Unit', say: 'A plugin docks into a tree, giving services, events and effects. A drone lands on a grid, lighting its neighbours.' },
  { scene: 'Identity', say: 'One names a package and a version — a pointer, which can be re-aimed. The other names the bytes: two faces that match are one cell.' },
  { scene: 'Fix', say: 'Move the registry pointer and every machine is patched at once. A signed fix is a new hash: each holder must be told.' },
  { scene: 'Later', say: 'A year on, the pointer names something newer and what it named is gone. The signature still resolves and still verifies. One tells you what is current; the other, what was.' },
  { scene: 'Memory', say: 'Both only append. But a log gets a version two, and every line is rewritten. Signed tiles stack at the head and never touch what is under them.' },
  { scene: 'Distribution', say: 'Parts arrive from registries, pinned by name and version. Or from whoever already holds them, each copy verified against its signature.' },
  { scene: 'Invariant', say: 'Both agree on one rule: anything the model saw must be rebuildable from the log. The same sequence, once as records and once as signatures.' },
  { scene: 'Close', say: 'So choose by what you fear. Fear silent drift, and pin by hash. Fear frozen bugs, and point and move.' },
]

// --- the cache key, identical to build.cjs ----------------------------------
const RULES = JSON.parse(fs.readFileSync(path.join(ROOT, 'pronunciations.json'), 'utf8'))
const spokenOf = say => RULES.reduce((text, r) =>
  r && r.match && r.say ? text.split(r.match).join(r.say) : text, say)
const hashOf = say => crypto.createHash('sha256').update(`${VOICE}|${RATE}|${spokenOf(say)}`).digest('hex').slice(0, 16)
const cachePath = say => path.join(CACHE, hashOf(say) + '.mp3')

async function ensureAudio() {
  const stale = NARRATION.filter(n => !fs.existsSync(cachePath(n.say)))
  if (process.argv.includes('--check')) {
    for (const n of stale) console.log(`stale audio: ${n.scene}`)
    console.log(stale.length ? `${stale.length} line(s) need audio` : 'audio cache complete')
    process.exit(stale.length ? 2 : 0)
  }
  if (!stale.length) return
  const { MsEdgeTTS, OUTPUT_FORMAT, ProsodyOptions } = require('msedge-tts')
  for (const n of stale) {
    const tts = new MsEdgeTTS()
    await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
    const pros = new ProsodyOptions(); pros.rate = RATE
    const { audioStream } = await tts.toStream(spokenOf(n.say), pros)
    const chunks = []
    await new Promise((res, rej) => { audioStream.on('data', c => chunks.push(c)); audioStream.on('end', res); audioStream.on('error', rej) })
    tts.close()
    fs.writeFileSync(cachePath(n.say), Buffer.concat(chunks))
    console.log(`recorded: ${n.scene}`)
  }
}

const durationOf = file => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries',
  'format=duration', '-of', 'csv=p=0', file]).toString().trim())

// --- the bundle -------------------------------------------------------------
// A bundle is three script blocks: a uuid→asset map (gzipped base64), a list
// binding resource ids to uuids, and the page template. Patching one asset is
// therefore a JSON edit, not a rebuild — the shell keeps React, Babel and the
// fonts exactly as the canvas exported them.
const SHELL = path.join(DS, 'comparison-shell.html')

function readBundle() {
  const html = fs.readFileSync(SHELL, 'utf8')
  const lines = html.split('\n')
  const assetsLine = lines.findIndex(l => l.startsWith('{"') && l.includes('"compressed"'))
  if (assetsLine < 0) throw new Error('bundle: asset map not found')
  const assets = JSON.parse(lines[assetsLine])
  const grab = (tag) => {
    const open = html.indexOf(`<script type="__bundler/${tag}">`)
    if (open < 0) throw new Error(`bundle: no ${tag} block`)
    const from = html.indexOf('\n', open) + 1
    const to = html.indexOf('</script>', from)
    return { from, to, text: html.slice(from, to) }
  }
  return { html, lines, assetsLine, assets, ext: grab('ext_resources'), tpl: grab('template') }
}

const setAssetText = (a, text) => {
  a.compressed = true
  a.data = zlib.gzipSync(Buffer.from(text, 'utf8')).toString('base64')
}

function assemble() {
  const b = readBundle()
  const ids = JSON.parse(b.ext.text)
  const uuidOf = id => (ids.find(r => r.id === id) || {}).uuid
  const storyUuid = uuidOf('scenes')
  if (!storyUuid || !b.assets[storyUuid]) throw new Error('bundle: scenes asset missing')

  // 1. the story: the working copy in deepseek/ is the source of truth
  const story = fs.readFileSync(path.join(DS, 'comparison-scenes.jsx'), 'utf8')
  setAssetText(b.assets[storyUuid], story)

  // 2. the voice: measured, then given to the composition as cue + clip
  const track = NARRATION.map(n => {
    const file = cachePath(n.say)
    return { scene: n.scene, lead: n.lead == null ? LEAD : n.lead, dur: durationOf(file), file, text: n.caption == null ? n.say : n.caption }
  })

  // 3. the retiming — the silence is what goes, never the speech.
  //
  // A scene keeps its authored length as `nat`, so every beat it was drawn
  // with still happens, and gets `dur` — the real seconds it is given — from
  // the line it carries: lead, line, tail, and nothing else. The stage warps
  // one onto the other, so a scene with more picture than words simply plays
  // it a little quicker; MAX_RATE is how much quicker it is allowed to get.
  // The words never speed up: an mp3 is an mp3.
  let tpl = JSON.parse(b.tpl.text)
  const scenesJson = /window\.OM_SCENES = '(\[.*?\])'/s.exec(tpl)
  if (!scenesJson) throw new Error('bundle: OM_SCENES not found in the template')
  const scenes = JSON.parse(scenesJson[1])
  const round = x => Math.round(x * 100) / 100
  const retimed = scenes.map(s => {
    const n = track.find(t => t.scene === s.name)
    if (!n) return s
    const nat = s.nat || s.dur
    return { ...s, nat, dur: round(Math.max(n.lead + n.dur + TAIL, nat / MAX_RATE)) }
  })

  // Where each line lands, in both clocks: `at` is real seconds (the voice),
  // `T` is authored seconds (the caption), and they are the same instant.
  let play = 0, auth = 0
  const cued = retimed.map((s, i) => {
    const n = track[i], nat = s.nat || s.dur
    const cue = { at: round(play + n.lead), T: round(auth + n.lead * (nat / s.dur)), rate: round(nat / s.dur) }
    play += s.dur; auth += nat
    return cue
  })

  if (process.argv.includes('--times')) {
    for (const [i, s] of scenes.entries()) {
      const n = track[i], r = retimed[i]
      console.log(`${s.name.padEnd(13)} drawn ${String(s.dur).padStart(4)}s   line ${n.dur.toFixed(1)}s   →  ${String(r.dur).padStart(5)}s   picture ×${cued[i].rate.toFixed(2)}   quiet ${round(r.dur - n.lead - n.dur)}s`)
    }
    const sum = a => round(a.reduce((t, s) => t + s.dur, 0))
    const spoken = round(track.reduce((t, n) => t + n.dur, 0))
    console.log(`total ${sum(scenes)}s → ${sum(retimed)}s   (${spoken}s of it spoken)`)
    return
  }

  const narration = track.map((n, i) => ({
    scene: n.scene,
    at: cued[i].at,
    T: cued[i].T,
    dur: round(n.dur),
    text: n.text,
    src: 'data:audio/mpeg;base64,' + fs.readFileSync(n.file).toString('base64'),
  }))

  // The voice rides in the way every other authoring input does: one global in
  // the helmet, next to the scene list it is timed against. Without it the
  // composition renders exactly as the canvas exported it — silent.
  tpl = tpl.replace(scenesJson[0], `window.OM_SCENES = '${JSON.stringify(retimed)}'`)
    // stringified twice on purpose: the inner JSON is the value, the outer one
    // makes it a JS string literal — the lines are full of apostrophes, and
    // OM_SCENES' single quotes would end the string on the first one.
    .replace('</helmet>', `  <script>window.OM_NARRATION = ${JSON.stringify(JSON.stringify(narration))};</script>\n</helmet>`)

  // The template is JSON inside a <script>, so a closing tag in the page it
  // carries would end that script early — the bundler escapes the slash, and
  // anything we add must be escaped the same way.
  const encoded = JSON.stringify(tpl).replace(/<\/script>/g, '<\\u002Fscript>')
  const out = b.html.slice(0, b.tpl.from) + encoded + b.html.slice(b.tpl.to)
  const patched = out.split('\n')
  patched[b.assetsLine] = JSON.stringify(b.assets)
  const dist = path.join(ROOT, 'dist', 'hypercomb-deepseek-comparison.html')
  fs.mkdirSync(path.dirname(dist), { recursive: true })
  fs.writeFileSync(dist, patched.join('\n'))
  console.log(`assembled ${dist} (${(fs.statSync(dist).size / 1e6).toFixed(2)} MB, ${narration.length} narrated scenes, ${retimed.reduce((t, s) => t + s.dur, 0)}s)`)
}

// --- reading it yourself ----------------------------------------------------
// One take per line, in `record/`, named for its scene. The prompter paces you
// against the narrator's own length so a read take drops straight in; the pace
// is a guide, not a contract, because the scene is timed from the take.
const TAKES = path.join(ROOT, 'record')
const AUDIO_EXT = ['.wav', '.flac', '.m4a', '.mp3', '.aac', '.ogg', '.webm']
const takeName = scene => `comparison-${scene.toLowerCase()}`
const takeFor = scene => AUDIO_EXT.map(e => path.join(TAKES, takeName(scene) + e)).find(fs.existsSync) || null

function prompter() {
  const { writePrompter } = require('./prompter.cjs')
  const out = path.join(TAKES, 'comparison-prompter.html')
  const r = writePrompter({
    title: 'Read the comparison — DeepSeek Harness vs Hypercomb',
    intro: 'Press <b>space</b>, wait for the count, and read with the light. The pace is the narrator\'s, ' +
      'so it drops straight in — but read it how it wants to be read: the scene is given the seconds ' +
      'your take actually takes. Save each one as the filename shown, in <b>record/</b>, then run ' +
      '<b>node deepseek.cjs --takes</b> and rebuild.',
    out,
    lines: NARRATION.map(n => ({
      name: n.scene,
      say: n.say,
      seconds: durationOf(cachePath(n.say)),
      file: `record/${takeName(n.scene)}.wav`,
      done: !!takeFor(n.scene),
    })),
  })
  console.log(`${path.relative(ROOT, r.file)} — ${r.lines} lines, ${r.seconds}s of reading`)
}

function takes() {
  const { master, durationOf: lengthOf, LUFS } = require('./master.cjs')
  const mastered = path.join(TAKES, 'mastered')
  fs.mkdirSync(mastered, { recursive: true })
  const ledgerPath = path.join(TAKES, 'comparison-takes.json')
  const ledger = fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath, 'utf8')) : {}
  const found = NARRATION.map(n => ({ n, take: takeFor(n.scene) })).filter(r => r.take)
  if (!found.length) {
    console.log('No takes in record/. Run `node deepseek.cjs --prompter` and read from record/comparison-prompter.html.')
    return
  }
  for (const { n, take } of found) {
    const out = path.join(mastered, `${takeName(n.scene)}.mp3`)
    const m = master(take, out)
    fs.copyFileSync(out, cachePath(n.say))
    ledger[n.scene] = { file: path.basename(take), hash: hashOf(n.say), at: new Date().toISOString().slice(0, 10) }
    console.log(`  ${n.scene.padEnd(13)} ${lengthOf(out).toFixed(1)}s  ${(+m.input_i).toFixed(1)} → ${LUFS} LUFS`)
  }
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2))
  console.log(`\n${found.length} take(s) seeded. Run \`node deepseek.cjs\` — it will use yours, and re-time to them.`)
}

if (process.argv.includes('--prompter')) prompter()
else if (process.argv.includes('--takes')) takes()
else ensureAudio()
  .then(assemble)
  .catch(e => { console.error('deepseek build failed:', e.message); process.exit(1) })
