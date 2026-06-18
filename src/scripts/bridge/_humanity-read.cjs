// Inflate the humanity-centres subtree, save raw JSON, print readable digest.
const WebSocket = require('ws')
const fs = require('fs')
const BRIDGE = 'ws://localhost:2401'
const ROOT = process.argv[2] || 'humanity-centres'
let counter = 0
const send = (req) => new Promise((resolve, reject) => {
  const id = `read-${Date.now()}-${++counter}`
  const ws = new WebSocket(BRIDGE)
  const t = setTimeout(() => { ws.close(); reject(new Error('timeout')) }, 25000)
  ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
  ws.on('message', raw => { clearTimeout(t); try { resolve(JSON.parse(String(raw))) } catch (e) { reject(e) } ws.close() })
  ws.on('error', e => { clearTimeout(t); reject(e) })
})
function noteText(note) {
  if (typeof note === 'string') return note
  if (note && typeof note === 'object') {
    const body = note.body
    if (Array.isArray(body) && body.length) return body.map(b => String(b?.text ?? '')).join('\n')
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
function walk(node, depth) {
  const pad = '  '.repeat(depth)
  const name = node?.name ?? '(unnamed)'
  const kids = (node?.children || [])
  const otherSlots = Object.keys(node || {}).filter(k => !['name','children','notes'].includes(k))
  console.log(`${pad}• ${name}${kids.length ? `  (${kids.length} children)` : ''}${otherSlots.length ? `  [slots: ${otherSlots.join(',')}]` : ''}`)
  for (const t of notesOf(node)) console.log(`${pad}    note: ${t}`)
  for (const k of kids) walk(k, depth + 1)
}
;(async () => {
  const r = await send({ op: 'inflate', segments: [ROOT] })
  if (!r.ok) { console.log('inflate FAILED:', r.error); process.exit(1) }
  fs.writeFileSync(`scripts/bridge/_${ROOT}.json`, JSON.stringify(r.data, null, 2))
  console.log(`=== inflated /${ROOT}  (saved scripts/bridge/_${ROOT}.json) ===\n`)
  walk(r.data, 0)
  let cells = 0, notes = 0
  ;(function count(n){ cells++; notes += notesOf(n).length; for (const k of (n.children||[])) count(k) })(r.data)
  console.log(`\n=== totals: ${cells} cells, ${notes} unique notes ===`)
})().catch(e => { console.error('FATAL', e.message); process.exit(2) })
