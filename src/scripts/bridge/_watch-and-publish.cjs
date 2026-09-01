// Wait for host-sync to settle (backed-up / pending 0), then emit publish:run
// for revolucion and watch publish:render until live or definitive failure.
const WebSocket = require('ws')
function call(req, ms) {
  return new Promise(res => {
    const ws = new WebSocket('ws://localhost:2401')
    const t = setTimeout(() => { try { ws.close() } catch {}; res(null) }, ms || 20000)
    ws.on('open', () => ws.send(JSON.stringify({ ...req, id: 'w' + Date.now() + Math.random() })))
    ws.on('message', raw => { clearTimeout(t); try { res(JSON.parse(String(raw))) } catch { res(null) }; ws.close() })
    ws.on('error', () => { clearTimeout(t); res(null) })
  })
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
;(async () => {
  // phase 1: wait for sync to settle (max 25 min)
  const settleBy = Date.now() + 25 * 60000
  for (;;) {
    const r = await call({ op: 'effect-last', cell: 'sync:state' })
    const s = r && r.ok && r.data && r.data.last
    console.log(new Date().toISOString(), 'sync:', s ? `${s.status} pending=${s.pending}` : '(none)')
    if (s && s.pending === 0 && s.status === 'backed-up') break
    if (Date.now() > settleBy) { console.log('SETTLE TIMEOUT'); break }
    await sleep(20000)
  }
  // phase 2: publish
  await call({ op: 'effect-emit', cell: 'publish:refresh', payload: {} })
  await sleep(15000)
  await call({ op: 'effect-emit', cell: 'publish:run', payload: { key: 'revolucion' } })
  console.log('publish:run emitted')
  // phase 3: watch
  const doneBy = Date.now() + 10 * 60000
  for (;;) {
    await sleep(10000)
    const r = await call({ op: 'effect-last', cell: 'publish:render' })
    const p = r && r.ok && r.data && r.data.last
    const row = p && p.rows && p.rows.find(x => x.key === 'revolucion')
    if (row) console.log(new Date().toISOString(), 'revolucion:', row.state, 'busy:', row.busyPhase, 'live:', (row.live || '').slice(0, 12))
    if (row && row.state === 'live') { console.log('LIVE'); break }
    if (row && !row.busyPhase && row.state === 'unpublished') {
      const t = await call({ op: 'effect-last', cell: 'toast:show' })
      const msg = t && t.data && t.data.last
      console.log('FAILED AGAIN:', msg ? JSON.stringify(msg) : '(no toast)')
      break
    }
    if (Date.now() > doneBy) { console.log('WATCH TIMEOUT'); break }
  }
  process.exit(0)
})()
