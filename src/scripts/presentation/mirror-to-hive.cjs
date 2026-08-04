// Mirror the presentation's scene chunks into the hive (requires a live bridge).
// Each scene becomes a tile under presentation/<chapter>, carrying its
// narration as a note — so the hive is the editable surface: change a scene's
// note there, copy it back into its scenes/scene-NN.json chunk (or edit the
// chunk directly), and re-run build.cjs.
//
//   node scripts/presentation/mirror-to-hive.cjs
const fs = require('fs')
const path = require('path')
const WebSocket = require('ws')

const BRIDGE = 'ws://localhost:2401'
let counter = 0
const send = req => new Promise((resolve, reject) => {
  const ws = new WebSocket(BRIDGE)
  const timer = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, 15_000)
  ws.on('open', () => ws.send(JSON.stringify({ ...req, id: `pres-${Date.now()}-${++counter}` })))
  ws.on('message', raw => { clearTimeout(timer); ws.close(); resolve(JSON.parse(String(raw))) })
  ws.on('error', err => { clearTimeout(timer); reject(err) })
})

const scenes = fs.readdirSync(path.join(__dirname, 'scenes')).filter(f => f.endsWith('.json')).sort()
  .map(f => JSON.parse(fs.readFileSync(path.join(__dirname, 'scenes', f), 'utf8')))

;(async () => {
  const byChapter = {}
  for (const s of scenes) (byChapter[s.chapter] ??= []).push(s)
  for (const [chapter, list] of Object.entries(byChapter)) {
    const segments = ['presentation', chapter]
    const r = await send({ op: 'add', cells: list.map(s => s.name), segments })
    console.log(`add ${list.length} under presentation/${chapter}:`, r.ok ? 'ok' : r.error)
    for (const s of list) {
      const nr = await send({ op: 'note-add', cell: s.name, text: `Scene ${s.n} — narration:\n\n${s.say}`, segments })
      console.log(`  note ${s.name}:`, nr.ok ? 'ok' : nr.error)
    }
  }
})().catch(e => { console.error('mirror failed:', e.message); process.exit(1) })
