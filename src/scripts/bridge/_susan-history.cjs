// Navigate to top-level /susan, then walk its ENTIRE bag history —
// inflate every past layer and report susan's children + notes at each
// commit, so we can spot any earlier content we can rebuild from.
const WebSocket = require('ws')
let c = 0
const send = (req) => new Promise((res, rej) => {
  const ws = new WebSocket('ws://localhost:2401'); const id = 'S' + (++c)
  const t = setTimeout(() => { ws.close(); rej(new Error('timeout')) }, 25000)
  ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
  ws.on('message', r => { clearTimeout(t); res(JSON.parse(String(r))); ws.close() })
  ws.on('error', e => { clearTimeout(t); rej(e) })
})
const wait = (ms) => new Promise(r => setTimeout(r, ms))
function noteText(n) { if (typeof n === 'string') return n; if (n && typeof n === 'object') { if (typeof n.text === 'string') return n.text; if (Array.isArray(n.body) && n.body[0]) return String(n.body[0].text || '') } return '' }
function descCount(n) { let c = 1; for (const k of (n && n.children || [])) c += descCount(k); return c }
function notesDeep(n, acc) { for (const t of (n && n.notes || [])) { const x = noteText(t).trim(); if (x) acc.push(x) } for (const k of (n && n.children || [])) notesDeep(k, acc); return acc }
;(async () => {
  await send({ op: 'submit', text: '/susan?[family-support]' })
  await wait(2000)
  const h = await send({ op: 'history' })
  if (!h.ok) { console.log('history ERR', h.error); return }
  const sigs = h.data.map(o => o.layer).filter(Boolean)
  console.log(`susan bag history: ${sigs.length} layers\n`)
  let best = null
  for (let i = 0; i < sigs.length; i++) {
    const r = await send({ op: 'inflate', cell: sigs[i] })
    if (!r.ok) { console.log(`#${i}: ERR ${r.error}`); continue }
    const node = r.data
    const kids = (node.children || []).map(k => (k && k.name) || k)
    const dc = descCount(node)
    const notes = notesDeep(node, [])
    const slots = Object.keys(node).filter(k => !['name', 'children'].includes(k))
    console.log(`#${i} name=${node.name} desc=${dc} children=[${kids.join(',')}] notes=${notes.length} slots=[${slots.join(',')}]`)
    if (notes.length) for (const t of notes) console.log(`     note: ${t.slice(0, 120)}`)
    if (!best || dc > best.dc || notes.length > best.notes) best = { i, dc, notes: notes.length, sig: sigs[i] }
  }
  console.log(`\nRICHEST susan commit: #${best.i} desc=${best.dc} notes=${best.notes} sig=${best.sig.slice(0, 12)}`)
})().catch(e => { console.error(e.message); process.exit(1) })
