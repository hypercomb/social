const WebSocket = require('ws')
const BRIDGE = 'ws://localhost:2401'
let n = 0
const send = (req, ms = 15000) => new Promise((res, rej) => {
  const ws = new WebSocket(BRIDGE); const id = `sp-${Date.now()}-${++n}`
  const t = setTimeout(() => { ws.close(); rej(new Error('timeout')) }, ms)
  ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
  ws.on('message', r => { clearTimeout(t); try { res(JSON.parse(String(r))) } catch { rej(new Error('bad')) } ws.close() })
  ws.on('error', e => { clearTimeout(t); rej(e) })
})
;(async () => {
  for (const name of ['family-support', 'its-allowed-heavy', 'dont-start-static']) {
    const r = await send({ op: 'layer-at', segments: ['susan', name] })
    console.log(`\n=== ${name}`)
    if (!r.ok) { console.log('  layer-at failed:', r.error); continue }
    console.log('  layer keys :', Object.keys(r.data).join(', '))
    console.log('  properties :', JSON.stringify(r.data.properties))
    const sig = Array.isArray(r.data.properties) ? r.data.properties[0] : null
    if (!sig) continue
    const g = await send({ op: 'get-resource', sig })
    console.log('  get-resource ok:', g.ok, g.ok ? '' : g.error)
    if (g.ok) {
      const raw = typeof g.data === 'string' ? g.data : JSON.stringify(g.data)
      console.log('  props bytes:', String(raw).slice(0, 400))
    }
  }
})().catch(e => { console.error('failed:', e.message || e); process.exit(1) })
