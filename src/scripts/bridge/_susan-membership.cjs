// Local /susan membership vs what the published head carries.
const WebSocket = require('ws')
const BRIDGE = 'ws://localhost:2401'
let n = 0
const send = (req, ms = 30000) => new Promise((res, rej) => {
  const ws = new WebSocket(BRIDGE); const id = `mb-${Date.now()}-${++n}`
  const t = setTimeout(() => { ws.close(); rej(new Error('timeout')) }, ms)
  ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
  ws.on('message', r => { clearTimeout(t); try { res(JSON.parse(String(r))) } catch { rej(new Error('bad')) } ws.close() })
  ws.on('error', e => { clearTimeout(t); rej(e) })
})
const http = async sig => { const r = await fetch(`https://susan.pluginthematrix.com/${sig}`); if (!r.ok) return null; try { return JSON.parse(await r.text()) } catch { return null } }
;(async () => {
  const HEAD = process.argv[2]
  const head = await http(HEAD)
  const pub = []
  for (const cs of head.children ?? []) {
    let c = await http(cs); if (c && c.meta === 1) c = await http(c.layer)
    if (c?.name) pub.push(c.name)
  }
  const l = await send({ op: 'list-at', segments: ['susan'] })
  const local = Array.isArray(l.data) ? l.data.map(x => (typeof x === 'string' ? x : x?.name)).filter(Boolean) : []
  console.log('published tiles :', pub.join(', '))
  console.log('local tiles     :', local.join(', '))
  console.log('local only      :', local.filter(x => !pub.includes(x)).join(', ') || '(none)')
  console.log('published only  :', pub.filter(x => !local.includes(x)).join(', ') || '(none)')
})().catch(e => { console.error('failed:', e.message || e); process.exit(1) })
