// Mark /revolucion as a WELCOME THRESHOLD (visual:revolucion:welcome).
//
//   node scripts/bridge/_welcome-decorate.cjs [--dry]
//
// The welcome view builds itself from the layer's CHILDREN — no page
// resource to author. One live record (replaceKind), no wall-clock fields:
// identical content mints an identical record, so this is safe to re-run.

const WebSocket = require('ws')
const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'
const DRY = process.argv.includes('--dry')
const log = (...a) => console.log(...a)

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
async function call(req, timeoutMs = 90_000) {
  await connect()
  const id = `wd-${Date.now()}-${++seq}`
  return new Promise((res, rej) => {
    const timer = setTimeout(() => { pending.delete(id); rej(new Error('bridge timeout: ' + req.op)) }, timeoutMs)
    pending.set(id, { res, rej, timer })
    try { ws.send(JSON.stringify({ ...req, id })) } catch (e) { pending.delete(id); clearTimeout(timer); rej(e) }
  })
}
async function ask(req, attempts = 8) {
  let wait = 2000
  for (let i = 0; i < attempts; i++) {
    try { const r = await call(req); if (r.ok || r.error !== 'no renderer connected') return r }
    catch (e) { if (i === attempts - 1) return { ok: false, error: e.message } }
    await new Promise(r => setTimeout(r, wait)); wait = Math.min(wait * 1.7, 30_000); connected = null
  }
  return { ok: false, error: 'renderer never came back' }
}

const SEGMENTS = ['revolucion']
const KIND = 'visual:revolucion:welcome'

async function main() {
  const layer = await ask({ op: 'layer-at', segments: SEGMENTS })
  if (!layer.ok) throw new Error('no layer at /revolucion: ' + layer.error)
  log(`/revolucion holds ${(layer.data?.children || []).length} children`)

  if (DRY) { log('  deco       : would-add'); return }
  const deco = await ask({
    op: 'decoration-add',
    segments: SEGMENTS,
    kind: KIND,
    appliesTo: SEGMENTS,
    payload: { version: 1, title: 'Revolución', tagline: 'Walk in — the room is yours' },
    mark: 'persistent',
    replaceKind: true,
  })
  if (!deco.ok) throw new Error('decoration-add: ' + deco.error)
  log(`  deco       : ${String(deco.data.sig).slice(0, 12)}…${deco.data.unchanged ? ' (unchanged)' : ''}`)
  log('done')
  try { ws.close() } catch {}
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1) })
