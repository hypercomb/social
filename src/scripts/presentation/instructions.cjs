// Scene instructions — the parent holds the recipe, each child holds its own filling.
//
// A scene is not free-form HTML any more: it is an INSTRUCTION with named
// fields, and one shared behaviour — declared once on the `presentation`
// parent — says how any child of it becomes a scene. Work one tile at a time,
// then recompile.
//
//   node instructions.cjs            # extract instructions from template.html into scenes/
//   node instructions.cjs --push     # write them onto the hive tiles as notes (bridge)
//
// The instruction fields, in the order they are read:
//
//   eyebrow    the small uppercase line above the headline
//   headline   the big line; wrap the emphasised words in *asterisks*
//   sub        the calm sentence under it (optional)
//   visual     none | film:<clip> | hexes | stack | road | sig
//   visualData the rows/badges/lines that visual needs (optional)
//   narration  what the voice says — this is also the caption
//
const fs = require('fs')
const path = require('path')

const ROOT = __dirname
const CHAPTER = { what: 'what is hypercomb', why: 'why hypercomb', roadmap: 'roadmap' }
// the hive slugifies names for addressing: every non-alphanumeric becomes a dash
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// Post-migration the chunks ARE the instructions; the template is only the
// shell. The extractor below runs against template.scenes.bak.html, kept so the
// original hand-written scene array can still be re-read if ever needed.
const shell = fs.readFileSync(path.join(ROOT, 'template.html'), 'utf8')
const MIGRATED = shell.includes('{{SCENES}}')
const source = MIGRATED
  ? (fs.existsSync(path.join(ROOT, 'template.scenes.bak.html'))
      ? fs.readFileSync(path.join(ROOT, 'template.scenes.bak.html'), 'utf8') : '')
  : shell
const blocks = [...source.matchAll(/\{ act:"(what|why|roadmap)", name:"([^"]+)", eyebrow:"([^"]+)", html:`([\s\S]*?)`,\s*(?:media:"([^"]+)",\s*)?say:`([\s\S]*?)`\}/g)]
if (!blocks.length && !MIGRATED) throw new Error('no scenes matched — did the template shape change?')

const entities = s => String(s)
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
// <b> and <em> are the honey-coloured emphasis; carry it as *asterisks* so a
// participant editing an instruction on a tile never has to type HTML
const marks = s => String(s).replace(/<(b|em)[^>]*>([\s\S]*?)<\/(b|em)>/g, '*$2*')
const strip = s => entities(String(s).replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
const striped = s => strip(marks(s))

function readVisual(body) {
  if (/class="filmwrap"/.test(body)) {
    const clip = (body.match(/src="\{\{(\w+)\}\}"/) || [])[1] || ''
    return { visual: `film:${clip}`, visualData: [] }
  }
  if (/class="hexrow"/.test(body)) {
    return { visual: 'hexes', visualData: [...body.matchAll(/<span class="g">([^<]*)<\/span><span class="t">([^<]*)<\/span>/g)]
      .map(m => `${m[1]} ${m[2]}`) }
  }
  if (/class="stack"/.test(body)) {
    return { visual: 'stack', visualData: [...body.matchAll(/<div class="lay( head)?">\s*<span[^>]*>([\s\S]*?)<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>\s*<\/div>/g)]
      .map(m => (m[1] ? '* ' : '') + strip(m[2]) + ' | ' + strip(m[3])) }
  }
  if (/class="road"/.test(body)) {
    return { visual: 'road', visualData: [...body.matchAll(/<div class="mt">([^<]+)<\/div><div class="md">([^<]+)<\/div>/g)]
      .map(m => `${strip(m[1])} — ${strip(m[2])}`) }
  }
  if (/class="sig"/.test(body)) {
    return { visual: 'sig', visualData: [striped((body.match(/<div class="sig">([\s\S]*?)<\/div>/) || [])[1] || '')] }
  }
  return { visual: 'none', visualData: [] }
}

const fromChunks = () => fs.readdirSync(path.join(ROOT, 'scenes')).filter(f => f.endsWith('.json')).sort()
  .map(f => JSON.parse(fs.readFileSync(path.join(ROOT, 'scenes', f), 'utf8')))

const scenes = MIGRATED ? fromChunks() : blocks.map((m, i) => {
  const [, act, name, eyebrow, body, media, say] = m
  const headline = strip((body.match(/<h1>([\s\S]*?)<\/h1>/) || [])[1] || '')
    // <b> is the emphasis the design paints in honey — keep it as *asterisks* so a
    // participant editing the instruction on a tile never has to type HTML
    .replace(/\s+/g, ' ')
  const rawH1 = (body.match(/<h1>([\s\S]*?)<\/h1>/) || [])[1] || ''
  const marked = striped(rawH1)
  const sub = strip((body.match(/<p class="sub">([\s\S]*?)<\/p>/) || [])[1] || '')
  const link = (body.match(/class="golink" href="([^"]+)"[^>]*>([^<]+)</) || []).slice(1)
  return {
    n: i + 1, name, chapter: CHAPTER[act], slug: slug(name),
    eyebrow, headline: marked || headline, sub,
    ...readVisual(body),
    ...(media ? { media } : {}),
    ...(link.length ? { link: { href: link[0], label: link[1].trim() } } : {}),
    say: say.replace(/\s+/g, ' ').trim(),
  }
})

function instructionText(s) {
  const lines = [
    `SCENE ${s.n} — ${s.name}`, '',
    `eyebrow: ${s.eyebrow}`,
    `headline: ${s.headline}`,
  ]
  if (s.sub) lines.push(`sub: ${s.sub}`)
  lines.push(`visual: ${s.visual}`)
  for (const v of s.visualData || []) lines.push(`  - ${v}`)
  if (s.link) lines.push(`link: ${s.link.label} -> ${s.link.href}`)
  lines.push('', 'narration:', s.say)
  return lines.join('\n')
}

const PRODUCTION = `HOW THIS PRESENTATION IS MADE

This tile is the production. Every tile beneath it is one SCENE, and they
compile, in order, into a single self-playing page.

The recipe is declared here once — the children only carry their own filling.
Edit one scene's instruction, recompile, and only that scene is rebuilt: the
narration audio is cached by the words themselves, so untouched scenes cost
nothing.

A scene instruction has these fields:

  eyebrow     the small uppercase line above the headline
  headline    the big line — wrap the emphasised words in *asterisks*
  sub         the calm sentence under it (optional)
  visual      one of:
                none          just words
                film:<clip>   a clip in the pane — live capture (navigate, zoom,
                              create, children) or a drawn concept clip timed to
                              the narration (vocabulary, integrity, time —
                              rendered by concepts.cjs)
                hexes         a row of hexagon badges — one "- glyph label" line each
                stack         stacked layer bars — one "- left | right" line each
                road          a milestone list — one "- title — detail" line each
                sig           a single monospace signature line
  link        an outbound call to action, "label -> url" (optional)
  narration   what the voice says; it is also the on-screen caption

Rules the compiler keeps:

  - The narration is the caption. Write it to be spoken, not to be read.
  - Never write a word in CAPITALS in the narration — the voice spells those
    out letter by letter. Put emphasis in the headline instead.
  - A pronunciation that comes out wrong is fixed once, in pronunciations.json,
    and every scene that says the phrase re-renders.
  - Anyone watching can highlight text and file an annotation against the scene
    it belongs to; those come back as notes here.

Chapters: what is hypercomb · why hypercomb · roadmap.
Compile with: node scripts/presentation/build.cjs`

if (!process.argv.includes('--push')) {
  for (const s of scenes) {
    fs.writeFileSync(path.join(ROOT, 'scenes', `scene-${String(s.n).padStart(2, '0')}.json`), JSON.stringify(s, null, 2))
  }
  fs.writeFileSync(path.join(ROOT, 'production.md'), PRODUCTION + '\n')
  console.log(`wrote ${scenes.length} scene instructions + production.md`)
  for (const s of scenes) console.log(`  ${String(s.n).padStart(2)} ${s.chapter.padEnd(18)} ${s.name.padEnd(30)} ${s.visual}`)
  return
}

// --- push onto the hive ------------------------------------------------------
const WebSocket = require('ws')
let counter = 0
const send = req => new Promise((resolve, reject) => {
  const ws = new WebSocket('ws://localhost:2401')
  const timer = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, 20_000)
  ws.on('open', () => ws.send(JSON.stringify({ ...req, id: `instr-${Date.now()}-${++counter}` })))
  ws.on('message', raw => { clearTimeout(timer); ws.close(); resolve(JSON.parse(String(raw))) })
  ws.on('error', err => { clearTimeout(timer); reject(err) })
})

;(async () => {
  const parent = await send({ op: 'note-add', cell: 'presentation', segments: [], text: PRODUCTION })
  console.log('production instruction on `presentation`:', parent.ok ? 'ok' : parent.error)
  for (const s of scenes) {
    const segments = ['presentation', slug(s.chapter)]
    const r = await send({ op: 'note-add', cell: s.slug, segments, text: instructionText(s) })
    console.log(`  ${String(s.n).padStart(2)} ${s.slug}:`, r.ok ? 'ok' : r.error)
  }
})().catch(e => { console.error('push failed:', e.message); process.exit(1) })
