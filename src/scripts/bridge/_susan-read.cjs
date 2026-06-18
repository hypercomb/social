// Read Susan's branch from the live renderer: inflate the subtree and
// print a readable digest (structure + notes at every depth) so we can
// see what content/interests already exist before building the site.
//   node scripts/bridge/_susan-read.cjs [rootCell]
const WebSocket = require('ws')
const BRIDGE = 'ws://localhost:2401'
const ROOT = process.argv[2] || 'susan'

let counter = 0
const send = (req) => new Promise((resolve, reject) => {
  const id = `read-${Date.now()}-${++counter}`
  const ws = new WebSocket(BRIDGE)
  const t = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, 20_000)
  ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
  ws.on('message', raw => { clearTimeout(t); try { resolve(JSON.parse(String(raw))) } catch (e) { reject(e) } ws.close() })
  ws.on('error', e => { clearTimeout(t); reject(e) })
})

function noteText(note) {
  if (typeof note === 'string') return note
  if (note && typeof note === 'object') {
    const body = note.body
    if (Array.isArray(body) && body.length) return String(body[0]?.text ?? '')
    if (typeof body === 'string') return body
    if (typeof note.text === 'string') return note.text
  }
  return ''
}
function notesOf(node) {
  const raw = node?.notes
  if (!Array.isArray(raw)) return []
  const seen = new Set(); const out = []
  for (const n of raw) { const t = noteText(n).trim(); if (t && !seen.has(t)) { seen.add(t); out.push(t) } }
  return out
}

function walk(node, depth, path) {
  const pad = '  '.repeat(depth)
  const name = node?.name ?? '(unnamed)'
  const kids = (node?.children || [])
  const otherSlots = Object.keys(node || {}).filter(k => !['name','children','notes'].includes(k))
  console.log(`${pad}• ${name}${kids.length ? `  (${kids.length} children)` : ''}${otherSlots.length ? `  [slots: ${otherSlots.join(',')}]` : ''}`)
  for (const t of notesOf(node)) {
    console.log(`${pad}    note: ${t.length > 220 ? t.slice(0, 217) + '…' : t}`)
  }
  for (const k of kids) walk(k, depth + 1, [...path, name])
}

;(async () => {
  const r = await send({ op: 'inflate', segments: [ROOT] })
  if (!r.ok) { console.log('inflate FAILED:', r.error); process.exit(1) }
  console.log(`=== inflated /${ROOT} ===\n`)
  walk(r.data, 0, [])
  // counts
  let cells = 0, notes = 0
  ;(function count(n){ cells++; notes += notesOf(n).length; for (const k of (n.children||[])) count(k) })(r.data)
  console.log(`\n=== totals: ${cells} cells, ${notes} unique notes ===`)
})().catch(e => { console.error('FATAL', e.message); process.exit(2) })
