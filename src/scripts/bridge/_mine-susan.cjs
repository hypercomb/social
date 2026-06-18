// Mine root's full history for susan content. Samples root layers across
// all of history, finds the `susan` child in each, and reports its
// children + notes. Dumps the full susan subtree whenever it has more than
// the known stub, and reports the richest susan state ever committed.
const WebSocket = require('ws')
let c = 0
const send = (req) => new Promise((res, rej) => {
  const ws = new WebSocket('ws://localhost:2401'); const id = 'M' + (++c)
  const t = setTimeout(() => { ws.close(); rej(new Error('timeout')) }, 30000)
  ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
  ws.on('message', r => { clearTimeout(t); res(JSON.parse(String(r))); ws.close() })
  ws.on('error', e => { clearTimeout(t); rej(e) })
})
function noteText(n) { if (typeof n === 'string') return n; if (n && typeof n === 'object') { if (typeof n.text === 'string') return n.text; if (Array.isArray(n.body) && n.body[0]) return String(n.body[0].text || '') } return '' }
function childName(k) { return (k && typeof k === 'object') ? (k.name || '?') : String(k) }
function descCount(n) { let x = 1; for (const k of (n && n.children || [])) if (typeof k === 'object') x += descCount(k); return x }
function notesDeep(n, acc) { for (const t of (n && n.notes || [])) { const v = noteText(t).trim(); if (v) acc.push(v) } for (const k of (n && n.children || [])) if (typeof k === 'object') notesDeep(k, acc); return acc }
function findChild(root, name) { for (const k of (root && root.children || [])) if (k && typeof k === 'object' && k.name === name) return k; return null }
;(async () => {
  const h = await send({ op: 'history' })
  if (!h.ok) { console.log('history ERR', h.error); return }
  const sigs = h.data.map(o => o.layer).filter(Boolean)
  const N = sigs.length
  console.log(`root history: ${N} layers. sampling for susan...\n`)
  const SAMPLES = 40
  const idxs = []
  for (let s = 0; s < SAMPLES; s++) idxs.push(Math.floor((s / (SAMPLES - 1)) * (N - 1)))
  const uniq = [...new Set(idxs)]
  let best = { i: -1, dc: 0, notes: 0, sig: null, kids: [] }
  for (const i of uniq) {
    const r = await send({ op: 'inflate', cell: sigs[i] })
    if (!r.ok) { console.log(`#${i}: ERR ${r.error}`); continue }
    const rootKids = (r.data.children || []).map(childName)
    const susan = findChild(r.data, 'susan')
    if (!susan) { console.log(`#${i}/${N}: root=[${rootKids.join(',')}]  (no susan)`); continue }
    const kids = (susan.children || []).map(childName)
    const dc = descCount(susan)
    const notes = notesDeep(susan, [])
    console.log(`#${i}/${N}: susan children=[${kids.join(',')}] desc=${dc} notes=${notes.length}`)
    if (notes.length) for (const t of notes.slice(0, 4)) console.log(`      note: ${t.slice(0, 110)}`)
    if (dc > best.dc || notes.length > best.notes) best = { i, dc, notes: notes.length, sig: sigs[i], kids }
  }
  console.log(`\n=== richest susan: #${best.i} desc=${best.dc} notes=${best.notes} children=[${best.kids.join(',')}] sig=${best.sig ? best.sig.slice(0, 12) : '-'} ===`)
})().catch(e => { console.error(e.message); process.exit(1) })
