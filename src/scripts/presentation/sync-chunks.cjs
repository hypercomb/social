// Sync scene chunks from the template's SCENES array.
//
// Run this after adding, removing, or reordering scenes in template.html —
// it rewrites scenes/scene-NN.json from each scene's act / name / say. After
// the sync, the chunks are the narration authority again (build.cjs injects
// them back over the template), so day-to-day script edits happen in the
// chunk files or on the hive tiles that mirror them.
//
//   node scripts/presentation/sync-chunks.cjs
const fs = require('fs')
const path = require('path')

const ROOT = __dirname
const CHAPTER = { what: 'what is hypercomb', why: 'why hypercomb', roadmap: 'roadmap' }

const html = fs.readFileSync(path.join(ROOT, 'template.html'), 'utf8')
const re = /\{ act:"(what|why|roadmap)", name:"([^"]+)"[\s\S]*?say:`([^`]+)`\}/g

const scenes = [...html.matchAll(re)].map((m, i) => ({
  n: i + 1,
  name: m[2],
  chapter: CHAPTER[m[1]],
  say: m[3].replace(/\s+/g, ' ').trim(),
}))
if (!scenes.length) throw new Error('no scenes matched — did the template shape change?')

for (const f of fs.readdirSync(path.join(ROOT, 'scenes'))) {
  if (f.endsWith('.json')) fs.unlinkSync(path.join(ROOT, 'scenes', f))
}
for (const s of scenes) {
  fs.writeFileSync(path.join(ROOT, 'scenes', `scene-${String(s.n).padStart(2, '0')}.json`), JSON.stringify(s, null, 2))
}
console.log(`synced ${scenes.length} scene chunks`)
for (const s of scenes) console.log(`  ${String(s.n).padStart(2)} ${s.chapter.padEnd(18)} ${s.name}`)
