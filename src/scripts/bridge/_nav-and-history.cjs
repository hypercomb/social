// Navigate the renderer to an absolute path (via the paste-url-navigate
// behavior — pushState + 'navigate', no cell creation), then read that
// lineage's history chain.  node _nav-and-history.cjs '/?[susan]'
const WebSocket = require('ws')
let c = 0
const send = (req) => new Promise((res, rej) => {
  const ws = new WebSocket('ws://localhost:2401'); const id = 'N' + (++c)
  const t = setTimeout(() => { ws.close(); rej(new Error('timeout')) }, 20000)
  ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
  ws.on('message', r => { clearTimeout(t); res(JSON.parse(String(r))); ws.close() })
  ws.on('error', e => { clearTimeout(t); rej(e) })
})
const wait = (ms) => new Promise(r => setTimeout(r, ms))
function summ(node) {
  if (!node || typeof node !== 'object') return String(node)
  const kids = (node.children || []).map(k => (k && k.name) || k)
  return `name=${node.name} children=[${kids.join(',')}]`
}
;(async () => {
  const target = process.argv[2] || '/?[susan]'
  console.log('submit nav →', target)
  const s = await send({ op: 'submit', text: target })
  console.log('submit:', JSON.stringify(s))
  await wait(2000)
  const h = await send({ op: 'history' })
  if (!h.ok) { console.log('history ERR', h.error); return }
  const sigs = h.data.map(o => o.layer).filter(Boolean)
  console.log(`\nhistory at current lineage: ${sigs.length} layers`)
  const head = await send({ op: 'inflate', cell: sigs[sigs.length - 1] })
  console.log('HEAD:', head.ok ? summ(head.data) : 'ERR ' + head.error)
})().catch(e => { console.error(e.message); process.exit(1) })
