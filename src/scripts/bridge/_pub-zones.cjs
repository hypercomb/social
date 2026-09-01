const WebSocket = require('ws')
const BRIDGE = 'ws://localhost:2401'
let n = 0
const send = (req, ms = 30000) => new Promise((res, rej) => {
  const ws = new WebSocket(BRIDGE); const id = `pz-${Date.now()}-${++n}`
  const t = setTimeout(() => { ws.close(); rej(new Error('timeout')) }, ms)
  ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
  ws.on('message', r => { clearTimeout(t); try { res(JSON.parse(String(r))) } catch { rej(new Error('bad')) } ws.close() })
  ws.on('error', e => { clearTimeout(t); rej(e) })
})
const sleep = ms => new Promise(r => setTimeout(r, ms))
;(async () => {
  let last = null
  for (let i = 0; i < 12; i++) {
    const r = await send({ op: 'effect-last', cell: 'publish:render' })
    last = r.ok ? r.data?.last : null
    if (last) break
    await sleep(1000)
  }
  const list = Array.isArray(last) ? last : (Array.isArray(last?.rows) ? last.rows : [])
  for (const r of list) {
    console.log(`${String(r.key ?? r.lineageKey).padEnd(22)} ${String(r.state).padEnd(12)} zones: ${(r.zones ?? []).join(', ') || '(none)'}`)
  }
})().catch(e => { console.error('failed:', e.message || e); process.exit(1) })
