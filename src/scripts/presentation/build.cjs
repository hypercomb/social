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
// [pause] in a narration is DIRECTION, not text: the line is spoken either side
// of it and the silence is cut in between, because the Edge voice endpoint
// rejects SSML <break> and <mstts:silence> outright. [pause:1400] for a longer
// one. The caption never shows the marker.
const PAUSE = /\[pause(?::(\d+))?\]/g
const spokenOf = say => RULES.reduce((text, r) =>
  r && r.match && r.say ? text.split(r.match).join(r.say) : text, say)
/** what the viewer reads — the direction is stripped out */
const captionOf = say => say.replace(PAUSE, ' ').replace(/\s{2,}/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim()

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
  const { execFileSync } = require('child_process')

  const speak = async text => {
    const tts = new MsEdgeTTS()
    await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
    const pros = new ProsodyOptions(); pros.rate = RATE
    const { audioStream } = await tts.toStream(text, pros)
    const chunks = []
    await new Promise((res, rej) => { audioStream.on('data', c => chunks.push(c)); audioStream.on('end', res); audioStream.on('error', rej) })
    tts.close()
    return Buffer.concat(chunks)
  }

  const tmp = path.join(ROOT, 'audio-cache', '.tmp')
  fs.mkdirSync(tmp, { recursive: true })

  for (const s of stale) {
    const out = path.join(ROOT, 'audio-cache', hashOf(s.say) + '.mp3')
    // split on the direction: odd entries are the pause lengths the regex captured
    const parts = spokenOf(s.say).split(PAUSE)
    if (parts.length === 1) {
      fs.writeFileSync(out, await speak(parts[0]))
    } else {
      const pieces = []
      for (const [i, part] of parts.entries()) {
        const file = path.join(tmp, `p${i}.mp3`)
        if (i % 2 === 0) {                                   // spoken text
          if (!part.trim()) continue
          fs.writeFileSync(file, await speak(part.trim()))
        } else {                                             // the silence between
          const secs = (Number(part) || 700) / 1000
          execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi',
            '-i', 'anullsrc=r=24000:cl=mono', '-t', String(secs),
            '-c:a', 'libmp3lame', '-b:a', '48k', file], { stdio: 'ignore' })
        }
        pieces.push(file)
      }
      const list = path.join(tmp, 'list.txt')
      fs.writeFileSync(list, pieces.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n'))
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0',
        '-i', list, '-c', 'copy', out], { stdio: 'ignore' })
      for (const f of [...pieces, list]) { try { fs.unlinkSync(f) } catch {} }
    }
    console.log(`regenerated audio: scene ${s.n} (${s.name})${parts.length > 1 ? ` · ${Math.floor(parts.length / 2)} pause(s)` : ''}`)
  }
  try { fs.rmdirSync(tmp) } catch {}
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
      // drawn concept clips (concepts.cjs) are labelled as drawings, not captures
      const DRAWN = { vocabulary: 'the flow of it', integrity: 'proof, not trust', time: 'the past, kept' }
      const tag = { navigate: 'localhost hive', zoom: 'the whole hive at a glance',
                    create: 'your first tile', children: 'creating structure' }[clip] || DRAWN[clip] || 'live capture'
      const cls = DRAWN[clip] ? 'filmtag drawn' : 'filmtag'
      return `\n  <div class="filmwrap"><span class="${cls}">${DRAWN[clip] ? 'drawn' : 'live capture'} · ${esc(tag)}</span>` +
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
      // the plate's own viewBox decides the frame: tall plates stay portrait,
      // wide ones get the film's cinematic width — one CSS rule can't know
      const vb = svg.match(/viewBox="([-\d.\s]+)"/)
      const [, , w, h] = (vb ? vb[1].trim().split(/\s+/) : [0, 0, 580, 596]).map(Number)
      // an inline svg with no width/height has a 300x150 intrinsic size, and the
      // centred flex column shrinks the frame to it — stamp the real one on
      const sized = svg.replace(/^<svg /, `<svg width="${w}" height="${h}" `)
      // wide plates cap at 36vh so the sub line always clears the caption box
      const wide = w / h > 1.4
      const style = `aspect-ratio:${w}/${h};max-width:min(${wide ? 1040 : 520}px,${wide ? 88 : 70}vw)${wide ? ';max-height:36vh' : ''}`
      const cap = rows.length ? `<span class="platecap">${esc(rows[0])}</span>` : ''
      return `\n  <div class="platewrap" style="${style}">${sized}${cap}</div>`
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
  o.say = captionOf(s.say)
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
    .replace('{{VID_VOCABULARY}}', vuri('concept-vocabulary.mp4'))
    .replace('{{VID_INTEGRITY}}', vuri('concept-integrity.mp4'))
    .replace('{{VID_TIME}}', vuri('concept-time.mp4'))
    .replace('{{AUDIO_JSON}}', JSON.stringify(scenes.map(auri)))
  const out = path.join(ROOT, 'dist', 'hypercomb-presentation.html')
  fs.writeFileSync(out, html)
  console.log(`assembled ${out} (${(fs.statSync(out).size / 1e6).toFixed(2)} MB, ${scenes.length} scenes)`)
}

ensureAudio().then(() => { if (!process.argv.includes('--check')) assemble() })
  .catch(e => { console.error('build failed:', e.message); process.exit(1) })
