// Assemble the Hypercomb video presentation from chunks.
//
//   scenes/scene-NN.json   — one chunk per scene: { n, name, chapter, say }
//   template.html          — layout + player engine (visual chunks live here)
//   media/*.mp4            — live-capture clips
//   audio-cache/<h16>.mp3  — narration audio, named by sha256(voice|say)
//   dist/hypercomb-presentation.html — the assembled, self-contained deliverable
//
// Edit a scene's `say` (or sync it from its hive note), re-run build — only
// that scene's audio is regenerated; everything else is a cache hit. Same
// content, same hash, no work: the signature idea applied to the build.
//
//   node scripts/presentation/build.cjs           # assemble (regenerates stale audio)
//   node scripts/presentation/build.cjs --check   # report stale audio without network
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ROOT = __dirname
const VOICE = 'en-US-AndrewMultilingualNeural'
const RATE = '+2%'

const scenes = fs.readdirSync(path.join(ROOT, 'scenes')).filter(f => f.endsWith('.json')).sort()
  .map(f => JSON.parse(fs.readFileSync(path.join(ROOT, 'scenes', f), 'utf8')))

const hashOf = say => crypto.createHash('sha256').update(`${VOICE}|${RATE}|${say}`).digest('hex').slice(0, 16)

const cachePath = say => {
  const p = path.join(ROOT, 'audio-cache', hashOf(say) + '.mp3')
  return fs.existsSync(p) ? p : null
}

async function ensureAudio() {
  const stale = scenes.filter(s => !cachePath(s.say))
  if (process.argv.includes('--check')) {
    for (const s of stale) console.log(`stale audio: scene ${s.n} (${s.name})`)
    console.log(stale.length ? `${stale.length} scene(s) need audio regeneration` : 'audio cache complete')
    if (stale.length) process.exit(2)
    return
  }
  if (!stale.length) return
  const { MsEdgeTTS, OUTPUT_FORMAT, ProsodyOptions } = require('msedge-tts')
  for (const s of stale) {
    const tts = new MsEdgeTTS()
    await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
    const pros = new ProsodyOptions(); pros.rate = RATE
    const { audioStream } = await tts.toStream(s.say, pros)
    const chunks = []
    await new Promise((res, rej) => { audioStream.on('data', c => chunks.push(c)); audioStream.on('end', res); audioStream.on('error', rej) })
    fs.writeFileSync(path.join(ROOT, 'audio-cache', hashOf(s.say) + '.mp3'), Buffer.concat(chunks))
    tts.close()
    console.log(`regenerated audio: scene ${s.n} (${s.name})`)
  }
}

function assemble() {
  let html = fs.readFileSync(path.join(ROOT, 'template.html'), 'utf8')
  // narration source of truth is the scene chunks — inject over the template's say fields
  let i = 0
  html = html.replace(/say:`[^`]+`/g, () => 'say:`' + scenes[i++].say.replace(/[`\\]/g, '\\$&').replace(/\$\{/g, '\\${') + '`')
  if (i !== scenes.length) throw new Error(`template has ${i} say slots, ${scenes.length} scene chunks`)
  const vuri = f => 'data:video/mp4;base64,' + fs.readFileSync(path.join(ROOT, 'media', f)).toString('base64')
  const auri = s => 'data:audio/mpeg;base64,' + fs.readFileSync(cachePath(s.say)).toString('base64')
  html = html
    .replace('{{VID_NAVIGATE}}', vuri('hive-navigate.mp4'))
    .replace('{{VID_ZOOM}}', vuri('hive-zoom.mp4'))
    .replace('{{VID_CREATE}}', vuri('hive-create.mp4'))
    .replace('{{VID_CHILDREN}}', vuri('hive-children.mp4'))
    .replace('{{AUDIO_JSON}}', JSON.stringify(scenes.map(auri)))
  const out = path.join(ROOT, 'dist', 'hypercomb-presentation.html')
  fs.writeFileSync(out, html)
  console.log(`assembled ${out} (${(fs.statSync(out).size / 1e6).toFixed(2)} MB, ${scenes.length} scenes)`)
}

ensureAudio().then(() => { if (!process.argv.includes('--check')) assemble() })
  .catch(e => { console.error('build failed:', e.message); process.exit(1) })
