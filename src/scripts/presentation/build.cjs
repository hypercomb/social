// Assemble the Hypercomb video presentation from chunks.
//
//   scenes/scene-NN.json   — one chunk per scene: { n, name, chapter, say }
//   template.html          — layout + player engine (visual chunks live here)
//   hosts.json             — the doors under hypercomb.com (hosts.cjs derives them)
//   media/*.mp4            — live-capture clips
//   fonts/*.woff2          — the vendored faces, embedded as data URIs
//   audio-cache/<h16>.mp3  — narration audio, named by sha256(voice|say)
//   dist/hypercomb-presentation.html — the assembled, self-contained deliverable
//
//   node scripts/presentation/build.cjs             # assemble (regenerates stale audio)
//   node scripts/presentation/build.cjs --check     # report stale audio without network
//   node scripts/presentation/build.cjs --no-hosts  # assemble from the committed hosts.json
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const hosts = require('./hosts.cjs')

const ROOT = __dirname
const VOICE = 'en-US-AndrewMultilingualNeural'
const RATE = '+2%'

const scenes = fs.readdirSync(path.join(ROOT, 'scenes')).filter(f => f.endsWith('.json')).sort()
  .map(f => JSON.parse(fs.readFileSync(path.join(ROOT, 'scenes', f), 'utf8')))

const rulesPath = path.join(ROOT, 'pronunciations.json')
const RULES = fs.existsSync(rulesPath) ? JSON.parse(fs.readFileSync(rulesPath, 'utf8')) : []
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
    const parts = spokenOf(s.say).split(PAUSE)
    if (parts.length === 1) {
      fs.writeFileSync(out, await speak(parts[0]))
    } else {
      const pieces = []
      for (const [i, part] of parts.entries()) {
        const file = path.join(tmp, `p${i}.mp3`)
        if (i % 2 === 0) { if (!part.trim()) continue; fs.writeFileSync(file, await speak(part.trim())) }
        else {
          const secs = (Number(part) || 700) / 1000
          execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', String(secs), '-c:a', 'libmp3lame', '-b:a', '48k', file], { stdio: 'ignore' })
        }
        pieces.push(file)
      }
      const list = path.join(tmp, 'list.txt')
      fs.writeFileSync(list, pieces.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n'))
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out], { stdio: 'ignore' })
      for (const f of [...pieces, list]) { try { fs.unlinkSync(f) } catch {} }
    }
    console.log(`regenerated audio: scene ${s.n} (${s.name})`)
  }
  try { fs.rmdirSync(tmp) } catch {}
}

// --- instructions → scene HTML ----------------------------------------------
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
// smart punctuation for on-screen copy only — never the narration
const smart = s => String(s).replace(/(\w)'(\w)/g, '$1’$2').replace(/"([^"]*)"/g, '“$1”').replace(/'/g, '’')
// *asterisks* are the emphasis a participant types; they become the honey <b>
const emph = (s, tag = 'b') => esc(smart(s)).replace(/\*([^*]+)\*/g, `<${tag}>$1</${tag}>`)
const plain = s => smart(s).replace(/\*/g, '')
const ACT_OF = { 'what is hypercomb': 'what', 'why hypercomb': 'why', roadmap: 'roadmap' }
const icon = name => `<svg class="g" aria-hidden="true"><use href="#i-${name}"/></svg>`
const HEX = '50,0 100,28.87 100,86.6 50,115.47 0,86.6 0,28.87'
const HEX_IN = '50,4.62 96,31.18 96,84.29 50,110.85 4,84.29 4,31.18'
const hexSvg = () => `<svg class="h" viewBox="0 0 100 115.47" aria-hidden="true"><polygon class="o" points="${HEX}"/><polygon class="in" points="${HEX_IN}"/></svg>`
const MARK14 = `<svg class="mk" viewBox="0 0 14 16" aria-hidden="true"><polygon points="7,0.5 13.06,4 13.06,12 7,15.5 0.94,12 0.94,4"/></svg>`

const CLIP = {
  navigate: { kind: 'live', title: 'a real hive' }, zoom: { kind: 'live', title: 'the whole hive' },
  children: { kind: 'live', title: 'building structure' }, create: { kind: 'live', title: 'the first tile' },
  vocabulary: { kind: 'drawn', title: 'vocabulary' }, integrity: { kind: 'drawn', title: 'integrity' }, time: { kind: 'drawn', title: 'time' },
}
const RATIO = { live: '960/328', drawn: '1440/492' }
// the sig stamp (scene field "sig": true): the caption's own sha-256, first eight hex in honey
const stamp = s => { const h = crypto.createHash('sha256').update(captionOf(s.say)).digest('hex'); return `<span class="sig" title="sha-256 of the caption"><b>${h.slice(0, 8)}</b>${h.slice(8, 16)}…</span>` }
const figcap = (kind, title, sig = '') => `<div class="figcap ${kind}">${icon('hex')}<span>${esc(kind)} · ${esc(title)}</span>${sig}</div>`

function visualHtml(s) {
  const rows = s.visualData || []
  const [kind, arg] = (s.visual || 'none').split(':').map(x => (x || '').trim())
  switch (kind) {
    case 'film': {
      const c = CLIP[arg]; if (!c) throw new Error(`unknown clip ${arg} on scene ${s.n}`)
      return `<div class="figbox"><div class="fig film" style="--ratio:${RATIO[c.kind]}">` +
        `<video muted playsinline preload="metadata" data-clip="${arg}"${c.kind === 'drawn' ? ' data-drawn="1"' : ''}></video></div>${figcap(c.kind, c.title)}</div>`
    }
    case 'hexes':
      return `<div class="fig hexrow">` + rows.map((r, i) => {
        const m = String(r).trim().match(/^icon:(\S+)\s+(.*)$/)
        if (!m) throw new Error(`badge row needs icon:<name> <label> on scene ${s.n}: ${r}`)
        if (m[2].length > 12) console.warn(`scene ${s.n}: badge label over 12 characters: ${m[2]}`)
        return `<div class="hexb" style="--i:${i}"><div class="hx">${hexSvg()}${icon(m[1])}</div><span class="t">${esc(m[2])}</span></div>`
      }).join('') + `</div>`
    case 'stack': case 'list':
      return `<div class="fig ${kind}">` + rows.map((r, i) => {
        const head = /^\*\s/.test(r)
        const parts = String(r).replace(/^\*\s/, '').split('|').map(x => x.trim())
        if (parts[1] && parts[1].length > 36) console.warn(`scene ${s.n}: row value over 36 characters: ${parts[1]}`)
        const cls = ['lay', head ? 'head' : '', parts.length === 1 ? 'one' : ''].filter(Boolean).join(' ')
        return `<div class="${cls}" style="--i:${i}">` + parts.map(p => `<span>${esc(smart(p))}</span>`).join('') + `</div>`
      }).join('') + `</div>`
    case 'road': {
      const state = arg || 'landed'
      return `<div class="fig road">` + rows.map((r, i) => {
        const [title, ...rest] = String(r).split('—')
        if (rest.length !== 1) console.warn(`scene ${s.n}: roadmap row needs exactly one em dash: ${r}`)
        return `<div class="mile ${state}" style="--i:${i}">${MARK14}<div><div class="mt">${esc(smart(title.trim()))}</div>` +
               `<div class="md">${esc(smart(rest.join('—').trim()))}</div></div></div>`
      }).join('') + `</div>`
    }
    // a drawn plate: the file is inlined, so it scales with the stage and carries no payload
    case 'plate': {
      let svg = fs.readFileSync(path.join(ROOT, 'visuals', arg + '.svg'), 'utf8').trim()
      if (!/viewBox="0 0 960 400"/.test(svg)) throw new Error(`plate ${arg} is not on the 960x400 frame`)
      if (/font-family|@keyframes|feGaussianBlur|Gradient|<style/.test(svg)) throw new Error(`plate ${arg} carries styling the page owns`)
      const title = rows[0] || arg.replace(/-/g, ' ')
      return `<div class="figbox"><div class="fig plate" style="--ratio:960/400">${svg}</div>${figcap('plate', title, s.sig ? stamp(s) : '')}</div>`
    }
    case 'none': return ''
    default: throw new Error(`unknown visual ${kind} on scene ${s.n}`)
  }
}

function sceneObject(s) {
  const parts = [`<h1>${emph(s.headline)}</h1>`, `<div class="fz">${visualHtml(s)}</div>`]
  if (s.sub) parts.push(`<p class="sub">${emph(s.sub)}</p>`)
  if (s.link) parts.push(`<a class="cta" href="${esc(s.link.href)}" target="_blank" rel="noopener">${esc(smart(s.link.label))}${icon('external')}</a>`)
  return { act: ACT_OF[s.chapter], name: plain(s.headline).replace(/[.]$/, ''), eyebrow: esc(smart(s.eyebrow)), html: parts.join(''), say: captionOf(s.say) }
}

// --- the zone directory ------------------------------------------------------
function doorsHtml(doors) {
  if (!doors.length) return ''
  const sorted = [...doors].sort((a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }))
  const chip = d => `
      <a class="door" href="https://${esc(d.host)}/" target="_blank" rel="noopener"><b>${esc(d.title)}</b><span>${esc(d.host)}</span></a>`
  return `  <nav id="doors" aria-label="Hives published on ${hosts.ZONE}" hidden>
    <p class="lbl">Live on ${hosts.ZONE} · ${doors.length} ${doors.length === 1 ? 'hive' : 'hives'}</p>
    <div id="doorrow">${sorted.map(chip).join('')}
    </div>
  </nav>
  <script>try{var v=localStorage.getItem('hc:show-deployed-nodes');if(v==='1'||v==='true')document.getElementById('doors').hidden=false}catch(e){}</script>`
}

// --- fonts: the vendored faces, embedded -------------------------------------
// The faces are the ones the shells already vendor (scripts/fetch-fonts.cjs,
// documentation/no-third-party-requests.md) — read from there, never a second
// copy: one file per face in the repository, inlined here so the deliverable
// still carries them when opened from disk.
const FONT_DIRS = {
  dev: path.join(ROOT, '..', '..', 'hypercomb-dev', 'public', 'fonts'),
  shared: path.join(ROOT, '..', '..', 'hypercomb-shared', 'fonts'),
}
const FONTS = [
  { family: 'Inter', dir: 'dev', file: 'inter-latin.woff2', weight: '300 700' },
  { family: 'JetBrains Mono', dir: 'shared', file: 'JetBrainsMono-Regular.woff2', weight: '400' },
  { family: 'JetBrains Mono', dir: 'shared', file: 'JetBrainsMono-SemiBold.woff2', weight: '600' },
]
function fontsCss() {
  return FONTS.map(f => {
    const p = path.join(FONT_DIRS[f.dir], f.file)
    if (!fs.existsSync(p)) throw new Error(`vendored face missing: ${p} — run scripts/fetch-fonts.cjs`)
    const b64 = fs.readFileSync(p).toString('base64')
    return `  @font-face{font-family:"${f.family}";font-style:normal;font-weight:${f.weight};font-display:block;src:url(data:font/woff2;base64,${b64}) format("woff2")}`
  }).join('\n')
}

function assemble(doors) {
  let html = fs.readFileSync(path.join(ROOT, 'template.html'), 'utf8')
  const mark = path.join(ROOT, '..', '..', 'hypercomb-web', 'public', 'favicon.svg')
  if (!fs.existsSync(mark)) throw new Error('the mark is missing — run `node scripts/build-favicons.cjs`')
  const markSvg = fs.readFileSync(mark, 'utf8').trim()
    .replace(/ width="32" height="32"/, '').replace(/id="(\w+)"/g, 'id="mk-$1"').replace(/url\(#(\w+)\)/g, 'url(#mk-$1)')
  // the narrated length, from the cached mp3s (48 kbit/s constant rate)
  const secs = scenes.reduce((t, s) => t + fs.statSync(cachePath(s.say)).size * 8 / 48000, 0) + scenes.length * 0.8
  const minutes = Math.round(secs / 60)
  html = html.replace('{{FAVICON}}', () => 'data:image/svg+xml;base64,' + fs.readFileSync(mark).toString('base64'))
  let marks = 0
  html = html.replace(/\{\{MARK\}\}/g, () => markSvg.replace(/mk-/g, `mk${++marks}-`))
  html = html.replace('{{MINUTES}}', String(minutes))
  html = html.replace('{{FONTS}}', () => fontsCss())
  html = html.replace('{{SCENES}}', () => JSON.stringify(scenes.map(sceneObject), null, 1))
  html = html.replace('{{DOORS}}', () => doorsHtml(doors))
  // media follow the engine as inert text blocks, read lazily on first use
  const blocks = []
  const clips = { navigate: 'hive-navigate.mp4', zoom: 'hive-zoom.mp4', create: 'hive-create.mp4', children: 'hive-children.mp4',
    vocabulary: 'concept-vocabulary.mp4', integrity: 'concept-integrity.mp4', time: 'concept-time.mp4' }
  scenes.forEach((s, i) => blocks.push(`<template id="aud-${String(i).padStart(2, '0')}">data:audio/mpeg;base64,${fs.readFileSync(cachePath(s.say)).toString('base64')}</template>`))
  for (const [k, f] of Object.entries(clips)) blocks.push(`<template id="vid-${k}">data:video/mp4;base64,${fs.readFileSync(path.join(ROOT, 'media', f)).toString('base64')}</template>`)
  html = html.replace('{{MEDIA}}', () => blocks.join('\n'))
  const out = path.join(ROOT, 'dist', 'hypercomb-presentation.html')
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, html)
  console.log(`assembled ${out} (${(fs.statSync(out).size / 1e6).toFixed(2)} MB, ${scenes.length} scenes, ${minutes} min, ${doors.length} door(s))`)
}

async function currentDoors() {
  if (process.argv.includes('--no-hosts')) return hosts.load().doors
  try { return (await hosts.refresh()).doors }
  catch (e) { console.warn(`hosts: ${e.message} — using the committed hosts.json`); return hosts.load().doors }
}

// the pieces other recipes share (concepts.cjs draws its clips with the same fonts and caption text)
module.exports = { fontsCss, captionOf, spokenOf, hashOf, VOICE, RATE }

if (require.main === module) ensureAudio()
  .then(async () => { if (!process.argv.includes('--check')) assemble(await currentDoors()) })
  .catch(e => { console.error('build failed:', e.message); process.exit(1) })
