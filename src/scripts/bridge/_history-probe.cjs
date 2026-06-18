// Inspect the current lineage's history chain: list the 59 marker layer
// sigs, inflate the head + a few earlier layers, and report each layer's
// name + children so we can identify the location and spot susan content.
const WebSocket = require('ws')
let c = 0
const send = (req) => new Promise((res, rej) => {
  const ws = new WebSocket('ws://localhost:2401'); const id = 'H' + (++c)
  const t = setTimeout(() => { ws.close(); rej(new Error('timeout')) }, 20000)
  ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
  ws.on('message', r => { clearTimeout(t); res(JSON.parse(String(r))); ws.close() })
  ws.on('error', e => { clearTimeout(t); rej(e) })
})
function summarize(node, depth = 0) {
  if (!node || typeof node !== 'object') return String(node)
  const kids = (node.children || []).map(k => (k && k.name) || k)
  const slots = Object.keys(node).filter(k => !['name', 'children'].includes(k))
  return `name=${node.name} children=[${kids.join(',')}]${slots.length ? ' slots=[' + slots.join(',') + ']' : ''}`
}
;(async () => {
  const h = await send({ op: 'history' })
  if (!h.ok) { console.log('history ERR', h.error); return }
  const sigs = h.data.map(o => o.layer).filter(Boolean)
  console.log(`history: ${sigs.length} layers (oldest→newest)`)
  // head
  const headSig = sigs[sigs.length - 1]
  const head = await send({ op: 'inflate', cell: headSig })
  console.log('\nHEAD (current):', head.ok ? summarize(head.data) : 'ERR ' + head.error)
  // sample a spread of earlier layers
  const idxs = [0, Math.floor(sigs.length * 0.25), Math.floor(sigs.length * 0.5), Math.floor(sigs.length * 0.75), sigs.length - 2].filter((v, i, a) => a.indexOf(v) === i && v >= 0 && v < sigs.length)
  for (const i of idxs) {
    const r = await send({ op: 'inflate', cell: sigs[i] })
    console.log(`#${i}:`, r.ok ? summarize(r.data) : 'ERR ' + r.error)
  }
})().catch(e => { console.error(e.message); process.exit(1) })
