// Re-link /susan so the branch names its tiles' CURRENT generations.
// `update` with the SAME child names in the SAME order: moves pointers,
// never membership. Refuses to run if the name census is incomplete —
// update is a SET and would drop any child it cannot name.
const WebSocket = require('ws')
const BRIDGE = 'ws://localhost:2401'
const APPLY = process.argv.includes('--apply')
let n = 0
const send = (req, ms = 60000) => new Promise((res, rej) => {
  const ws = new WebSocket(BRIDGE); const id = `rl-${Date.now()}-${++n}`
  const t = setTimeout(() => { ws.close(); rej(new Error('timeout')) }, ms)
  ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
  ws.on('message', r => { clearTimeout(t); try { res(JSON.parse(String(r))) } catch { rej(new Error('bad')) } ws.close() })
  ws.on('error', e => { clearTimeout(t); rej(e) })
})
;(async () => {
  const before = await send({ op: 'layer-at', segments: ['susan'] })
  if (!before.ok) { console.error('no layer at /susan:', before.error); process.exit(1) }
  const sigs = (before.data.children ?? []).map(String)
  const names = []
  for (const sig of sigs) {
    const inf = await send({ op: 'inflate', cell: sig })
    const name = inf?.data?.name
    if (typeof name === 'string' && name.trim()) names.push(name.trim())
  }
  console.log(`children in /susan : ${sigs.length}`)
  console.log(`names resolved     : ${names.length} → ${names.join(', ')}`)
  if (names.length !== sigs.length) {
    console.error('REFUSING: census incomplete — update is a SET and would drop the unnamed children')
    process.exit(1)
  }
  if (!APPLY) { console.log('\ndry run — pass --apply to re-link'); return }
  const res = await send({ op: 'update', segments: ['susan'], layer: { name: before.data.name ?? 'susan', children: names } })
  console.log('update:', res.ok ? 'ok' : `FAILED — ${res.error}`)
  if (!res.ok) process.exit(1)
  const after = await send({ op: 'layer-at', segments: ['susan'] })
  const changed = JSON.stringify(after.data) !== JSON.stringify(before.data)
  console.log('branch layer changed:', changed ? 'YES — it now names the current generations' : 'no (already current)')
  console.log('children after      :', (after.data.children ?? []).length)
})().catch(e => { console.error('failed:', e.message || e); process.exit(1) })
