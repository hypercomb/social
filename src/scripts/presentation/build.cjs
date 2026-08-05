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

// Pronunciation rules rewrite what the VOICE reads; captions keep the real text.
// Because the cache key is the spoken form, fixing a pronunciation regenerates
// exactly the scenes that say the word — and nothing else.
const rulesPath = path.join(ROOT, 'pronunciations.json')
const RULES = fs.existsSync(rulesPath) ? JSON.parse(fs.readFileSync(rulesPath, 'utf8')) : []
const spokenOf = say => RULES.reduce((text, r) =>
  r && r.match && r.say ? text.split(r.match).join(r.say) : text, say)

const hashOf = say => crypto.createHash('sha256').update(`${VOICE}|${RATE}|${spokenOf(say)}`).digest('hex').slice(0, 16)

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
    const { audioStream } = await tts.toStream(spokenOf(s.say), pros)
    const chunks = []
    await new Promise((res, rej) => { audioStream.on('data', c => chunks.push(c)); audioStream.on('end', res); audioStream.on('error', rej) })
    fs.writeFileSync(path.join(ROOT, 'audio-cache', hashOf(s.say) + '.mp3'), Buffer.concat(chunks))
    tts.close()
    console.log(`regenerated audio: scene ${s.n} (${s.name})`)
  }
}

// --- instructions → scene HTML ----------------------------------------------
// The template is the shell: styles, chrome, and the player engine. Every scene
// is compiled here from its instruction, so editing a tile's instruction and
// recompiling is the whole authoring loop.
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
// *asterisks* are the emphasis a participant types; they become the honey <b>
const emph = (s, tag = 'b') => esc(s).replace(/\*([^*]+)\*/g, `<${tag}>$1</${tag}>`)
const ACT_OF = { 'what is hypercomb': 'what', 'why hypercomb': 'why', roadmap: 'roadmap' }

function visualHtml(s) {
  const rows = s.visualData || []
  switch ((s.visual || 'none').split(':')[0]) {
    case 'film': {
      const clip = (s.visual.split(':')[1] || '').trim()
      const tag = { navigate: 'localhost hive', zoom: 'one hive, many worlds',
                    create: 'your first tile', children: 'creating structure' }[clip] || 'live capture'
      return `\n  <div class="filmwrap"><span class="filmtag">live capture · ${esc(tag)}</span>` +
             `<video muted playsinline loop src="{{${clip}}}"></video></div>`
    }
    case 'hexes':
      return `\n  <div class="hexrow">` + rows.map(r => {
        const [glyph, ...rest] = String(r).trim().split(/\s+/)
        return `<div class="hexb"><span class="g">${esc(glyph)}</span><span class="t">${esc(rest.join(' '))}</span></div>`
      }).join('') + `</div>`
    case 'stack':
      return `\n  <div class="stack">` + rows.map(r => {
        const head = /^\*\s/.test(r)
        const [left, right] = String(r).replace(/^\*\s/, '').split('|').map(x => (x || '').trim())
        const m = head ? ' class="m"' : ''
        return `<div class="lay${head ? ' head' : ''}"><span${m}>${esc(left)}</span><span${m}>${esc(right)}</span></div>`
      }).join('') + `</div>`
    case 'road':
      return `\n  <div class="road">` + rows.map(r => {
        const [title, ...rest] = String(r).split('—')
        return `<div class="mile"><div class="dot"></div><div><div class="mt">${esc(title.trim())}</div>` +
               `<div class="md">${esc(rest.join('—').trim())}</div></div></div>`
      }).join('') + `</div>`
    case 'sig':
      return rows.length ? `\n  <div class="sig">${emph(rows[0], 'em')}</div>` : ''
    // a drawn plate: the file is inlined, so it scales with the stage and carries no payload
    case 'plate': {
      const name = (s.visual.split(':')[1] || '').trim()
      const svg = fs.readFileSync(path.join(ROOT, 'visuals', name + '.svg'), 'utf8').trim()
      const cap = rows.length ? `<span class="platecap">${esc(rows[0])}</span>` : ''
      return `\n  <div class="platewrap">${svg}${cap}</div>`
    }
    default: return ''
  }
}

function sceneObject(s) {
  const parts = [`\n  <h1>${emph(s.headline)}</h1>`]
  const vis = visualHtml(s)
  // a film sits under the headline; badge rows and diagrams sit under the sub line
  if ((s.visual || '').startsWith('film')) parts.push(vis)
  if (s.sub) parts.push(`\n  <p class="sub">${emph(s.sub)}</p>`)
  if (vis && !(s.visual || '').startsWith('film')) parts.splice(1, 0, vis)
  if (s.link) parts.push(`\n  <a class="golink" href="${esc(s.link.href)}" target="_blank" rel="noopener">${esc(s.link.label)}</a>`)
  const o = { act: ACT_OF[s.chapter], name: s.name, eyebrow: s.eyebrow, html: parts.join('') }
  if ((s.visual || '').startsWith('film')) o.media = s.visual.split(':')[1]
  o.say = s.say
  return o
}

function assemble() {
  let html = fs.readFileSync(path.join(ROOT, 'template.html'), 'utf8')
  html = html.replace('{{SCENES}}', JSON.stringify(scenes.map(sceneObject), null, 1))
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
