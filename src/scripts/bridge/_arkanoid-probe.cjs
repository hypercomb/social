// Probe /games/arkanoid current state over the bridge (read-only).
const WebSocket = require('ws')
const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'
let ws, pending = new Map(), seq = 0, connected = null
async function connect() {
  if (connected) return connected
  connected = new Promise((res, rej) => {
    ws = new WebSocket(BRIDGE, { maxPayload: 128 * 1024 * 1024 })
    ws.on('open', () => res(ws))
    ws.on('error', rej)
    ws.on('close', () => { connected = null; for (const [, p] of pending) p.rej(new Error('socket closed')); pending.clear() })
    ws.on('message', raw => {
      let m; try { m = JSON.parse(String(raw)) } catch { return }
      const p = pending.get(m.id); if (p) { pending.delete(m.id); clearTimeout(p.timer); p.res(m) }
    })
  })
  return connected
}
async function call(req, timeoutMs = 60_000) {
  await connect()
  const id = `pr-${Date.now()}-${++seq}`
  return new Promise((res, rej) => {
    const timer = setTimeout(() => { pending.delete(id); rej(new Error('bridge timeout: ' + req.op)) }, timeoutMs)
    pending.set(id, { res, rej, timer })
    try { ws.send(JSON.stringify({ ...req, id })) } catch (e) { pending.delete(id); clearTimeout(timer); rej(e) }
  })
}
async function main() {
  const guard = await call({ op: 'layer-at', segments: ['revolucion', 'meetup'] })
  console.log('guard /revolucion/meetup:', guard.ok ? guard.data?.name : 'ERR ' + guard.error)

  const games = await call({ op: 'layer-at', segments: ['games'] })
  console.log('/games:', games.ok ? `name=${games.data?.name} children=${(games.data?.children || []).length}` : 'ERR ' + games.error)

  const ark = await call({ op: 'layer-at', segments: ['games', 'arkanoid'] })
  if (!ark.ok) { console.log('/games/arkanoid: ERR', ark.error); process.exit(1) }
  const d = ark.data
  console.log('/games/arkanoid:', JSON.stringify({
    name: d?.name, children: (d?.children || []).length,
    decorations: (d?.decorations || []).length,
    properties: (d?.properties || []).length,
    slots: Object.keys(d || {}),
  }))
  for (const sig of (d?.decorations || [])) {
    const r = await call({ op: 'get-resource', sig })
    if (!r.ok) { console.log('  deco', sig.slice(0, 12), 'UNRESOLVED:', r.error); continue }
    try {
      const rec = JSON.parse(r.data.text)
      console.log('  deco', sig.slice(0, 12), 'kind=' + rec.kind, 'appliesTo=' + JSON.stringify(rec.appliesTo), 'payload=' + JSON.stringify(rec.payload))
    } catch { console.log('  deco', sig.slice(0, 12), 'not JSON') }
  }
  const notes = await call({ op: 'note-list', segments: ['games', 'arkanoid'] })
  const items = notes.ok ? (Array.isArray(notes.data) ? notes.data : notes.data?.notes || []) : []
  console.log('notes:', notes.ok ? items.length : 'ERR ' + notes.error)
  for (const n of items.slice(0, 10)) console.log('  note:', String(n?.text || '').split('\n')[0].slice(0, 90))
  try { ws.close() } catch {}
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1) })
