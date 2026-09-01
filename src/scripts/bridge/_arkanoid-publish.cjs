// Republish games/arkanoid to arkanoid.pluginthematrix.com — drives the
// SANCTIONED panel path over the bridge (publish:* effects are the bridge's
// remote-intent allowlist). The branch is already in hc:public-branches and
// the signed index; this is a re-run after new content landed on the tile.
//
//   node scripts/bridge/_arkanoid-publish.cjs

const WebSocket = require('ws')
const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'
const KEY = 'games/arkanoid'
const log = (...a) => console.log(...a)

let ws, pending = new Map(), seq = 0, connected = null
async function connect() {
  if (connected) return connected
  connected = new Promise((res, rej) => {
    ws = new WebSocket(BRIDGE, { maxPayload: 16 * 1024 * 1024 })
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
async function call(req, timeoutMs = 30_000) {
  await connect()
  const id = `ap-${Date.now()}-${++seq}`
  return new Promise((res, rej) => {
    const timer = setTimeout(() => { pending.delete(id); rej(new Error('bridge timeout: ' + req.op)) }, timeoutMs)
    pending.set(id, { res, rej, timer })
    try { ws.send(JSON.stringify({ ...req, id })) } catch (e) { pending.delete(id); clearTimeout(timer); rej(e) }
  })
}
const emit = (cell, payload) => call({ op: 'effect-emit', cell, payload })
const last = (cell) => call({ op: 'effect-last', cell })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// The row key is the lineageKey; be tolerant of the fold (non-letter/number → '-').
const KEYS = [KEY, KEY.replace(/[^a-zA-Z0-9]/g, '-')]
async function renderRow() {
  const r = await last('publish:render')
  const rows = r?.data?.last?.rows
  if (!Array.isArray(rows)) return null
  return rows.find(x => KEYS.includes(String(x?.key))) ?? null
}

async function main() {
  // 1. Open the panel — #refresh only runs while it is open.
  let r = await emit('publish:view-toggle', {})
  if (!r.ok) throw new Error('view-toggle: ' + r.error)
  log('panel: toggled')

  // 2. Wait for the refresh to surface the games/arkanoid row.
  let row = null
  for (let i = 0; i < 30; i++) {
    await sleep(2000)
    row = await renderRow()
    if (row) break
    if (i === 5) { await emit('publish:refresh', {}) }
  }
  if (!row) {
    // Maybe the panel was already open and our toggle CLOSED it — flip once more.
    await emit('publish:view-toggle', {})
    for (let i = 0; i < 15 && !row; i++) { await sleep(2000); row = await renderRow() }
  }
  if (!row) throw new Error(`no "${KEY}" row in the publish panel`)
  log(`row: key=${row.key} state=${row.state ?? '?'} path=${row.path ?? '?'}`)

  // 3. Publish.
  r = await emit('publish:run', { key: row.key })
  if (!r.ok) throw new Error('publish:run: ' + r.error)
  log('publish: running (seal → stage → availability gate → index → confirm)')

  // 4. Watch the row until it settles.
  const deadline = Date.now() + 5 * 60_000
  let lastPhase = ''
  while (Date.now() < deadline) {
    await sleep(3000)
    row = await renderRow()
    if (!row) continue
    const phase = String(row.busyPhase ?? '')
    if (phase && phase !== lastPhase) { log('  phase: ' + phase); lastPhase = phase }
    if (!phase && row.state && !['pending'].includes(String(row.state))) {
      log(`settled: state=${row.state} head=${String(row.localHead ?? row.publishedHead ?? '').slice(0, 16)}`)
      break
    }
  }
  log('row (final): ' + JSON.stringify({ state: row?.state, path: row?.path, busyPhase: row?.busyPhase, localHead: row?.localHead, publishedHead: row?.publishedHead }))

  // 5. Close the panel again — leave the hive as we found it.
  await emit('publish:close', {})
  try { ws.close() } catch {}
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1) })
