const WebSocket = require('ws')
const BRIDGE = 'ws://localhost:2401'
let n = 0
const send = (req, ms = 30000) => new Promise((res, rej) => {
  const ws = new WebSocket(BRIDGE); const id = `pp-${Date.now()}-${++n}`
  const t = setTimeout(() => { ws.close(); rej(new Error('timeout')) }, ms)
  ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
  ws.on('message', r => { clearTimeout(t); try { res(JSON.parse(String(r))) } catch { rej(new Error('bad')) } ws.close() })
  ws.on('error', e => { clearTimeout(t); rej(e) })
})
const sleep = ms => new Promise(r => setTimeout(r, ms))
;(async () => {
  console.log('render before:', JSON.stringify(await send({ op: 'effect-last', effect: 'publish:render' })).slice(0, 400))
  await send({ op: 'effect-emit', effect: 'publish:view-toggle', payload: {} })
  await sleep(2500)
  console.log('render after toggle:', JSON.stringify(await send({ op: 'effect-last', effect: 'publish:render' })).slice(0, 800))
})().catch(e => { console.error('failed:', e.message || e); process.exit(1) })
