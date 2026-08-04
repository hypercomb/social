// Read annotations exported from the presentation and fold them into the build.
//
// The player (bar → "⌁ N" → download) writes presentation-annotations.json:
// each entry names the scene, the highlighted quote, a kind, and an optional
// fix. This turns that file into things the next revision actually reads:
//
//   pronunciation → a rule in pronunciations.json — the voice says it right,
//                   the caption keeps the real text, and only the scenes that
//                   contain the phrase regenerate their audio
//   everything else → notes/annotations.md, one section per scene, so the
//                   next pass over the script has the feedback in hand
//                   (and `--to-hive` files each as a note on the scene's tile)
//
//   node scripts/presentation/ingest-annotations.cjs <exported.json> [--to-hive]
const fs = require('fs')
const path = require('path')

const ROOT = __dirname
const file = process.argv[2]
if (!file) { console.error('usage: node ingest-annotations.cjs <presentation-annotations.json> [--to-hive]'); process.exit(1) }
if (!fs.existsSync(file)) { console.error(`no such file: ${file}`); process.exit(1) }

const payload = JSON.parse(fs.readFileSync(file, 'utf8'))
const items = Array.isArray(payload) ? payload : (payload.annotations || [])
if (!items.length) { console.log('no annotations in that export'); process.exit(0) }

// --- pronunciation rules -----------------------------------------------------
const rulesPath = path.join(ROOT, 'pronunciations.json')
const rules = fs.existsSync(rulesPath) ? JSON.parse(fs.readFileSync(rulesPath, 'utf8')) : []
let added = 0, skipped = 0
for (const a of items.filter(x => x.kind === 'pronunciation')) {
  if (!a.fix) { console.log(`  skipped (no spoken form given): "${a.quote}"`); skipped++; continue }
  const existing = rules.find(r => r.match === a.quote)
  if (existing) { existing.say = a.fix; existing.note = `updated from scene ${a.scene}` }
  else { rules.push({ match: a.quote, say: a.fix, note: `from scene ${a.scene} · ${a.sceneName}` }); added++ }
}
if (added || items.some(x => x.kind === 'pronunciation' && x.fix)) {
  fs.writeFileSync(rulesPath, JSON.stringify(rules, null, 2) + '\n')
}

// --- everything else, as notes ----------------------------------------------
const others = items.filter(x => x.kind !== 'pronunciation')
fs.mkdirSync(path.join(ROOT, 'notes'), { recursive: true })
const notesPath = path.join(ROOT, 'notes', 'annotations.md')
const byScene = {}
for (const a of others) (byScene[`${String(a.scene).padStart(2, '0')} · ${a.sceneName}`] ??= []).push(a)
let md = `# Annotations for the next revision\n\nIngested from \`${path.basename(file)}\`.\n`
for (const [scene, list] of Object.entries(byScene).sort()) {
  md += `\n## Scene ${scene}\n\n`
  for (const a of list) {
    md += `- **${a.kind}**${a.at != null ? ` (at ${a.at}s)` : ''} — “${a.quote}”\n`
    if (a.fix) md += `  - → ${a.fix}\n`
  }
}
if (others.length) fs.appendFileSync(notesPath, fs.existsSync(notesPath) ? '\n---\n' + md : md)

console.log(`pronunciation rules: ${added} added, ${skipped} skipped for want of a spoken form`)
console.log(`other annotations: ${others.length}${others.length ? ` → ${path.relative(process.cwd(), notesPath)}` : ''}`)
if (added) console.log('run `node build.cjs` — only the scenes that say those phrases will regenerate')

// --- optionally file them on the hive tiles ---------------------------------
if (process.argv.includes('--to-hive') && others.length) {
  const WebSocket = require('ws')
  const CHAPTER = { what: 'what is hypercomb', why: 'why hypercomb', roadmap: 'roadmap' }
  let counter = 0
  const send = req => new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://localhost:2401')
    const timer = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, 15_000)
    ws.on('open', () => ws.send(JSON.stringify({ ...req, id: `ann-${Date.now()}-${++counter}` })))
    ws.on('message', raw => { clearTimeout(timer); ws.close(); resolve(JSON.parse(String(raw))) })
    ws.on('error', err => { clearTimeout(timer); reject(err) })
  })
  const scenes = fs.readdirSync(path.join(ROOT, 'scenes')).filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(ROOT, 'scenes', f), 'utf8')))
  ;(async () => {
    for (const a of others) {
      const scene = scenes.find(s => s.n === a.scene)
      if (!scene) continue
      const text = `Annotation (${a.kind})${a.at != null ? ` at ${a.at}s` : ''}:\n\n“${a.quote}”${a.fix ? `\n\n→ ${a.fix}` : ''}`
      const r = await send({ op: 'note-add', cell: scene.name, segments: ['presentation', scene.chapter], text })
      console.log(`  hive note on ${scene.name}:`, r.ok ? 'ok' : r.error)
    }
  })().catch(e => console.error('hive notes failed:', e.message))
}
