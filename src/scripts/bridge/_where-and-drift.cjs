const WebSocket = require('ws')
const BRIDGE = 'ws://localhost:2401'
const SIG = /^[0-9a-f]{64}$/
let n = 0
const send = (req, ms = 40000) => new Promise((res, rej) => {
  const ws = new WebSocket(BRIDGE); const id = `wd-${Date.now()}-${++n}`
  const t = setTimeout(() => { ws.close(); rej(new Error('timeout')) }, ms)
  ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
  ws.on('message', r => { clearTimeout(t); try { res(JSON.parse(String(r))) } catch { rej(new Error('bad')) } ws.close() })
  ws.on('error', e => { clearTimeout(t); rej(e) })
})
;(async () => {
  const ui = await send({ op: 'ui-state' })
  console.log('renderer ui-state:', JSON.stringify(ui.data).slice(0, 500))
})().catch(e => { console.error('failed:', e.message || e); process.exit(1) })
