// probe-hide-events.cjs
//
// Read-only probe: dump every kind-30202 (swarm hide) event the local
// relay currently retains, with pubkey, d-tag (composed location sig),
// hidden names, created_at, and expiration. Run when tiles "render then
// hide" — a retained hide event at the visited location is the usual
// culprit.

const WebSocket = require('ws')

const ws = new WebSocket('ws://localhost:7777')
const events = []

ws.on('open', () => {
  ws.send(JSON.stringify(['REQ', 'hideprobe', { kinds: [30202] }]))
})

ws.on('message', (raw) => {
  let msg
  try { msg = JSON.parse(raw.toString()) } catch { return }
  if (msg[0] === 'EVENT' && msg[2]) {
    const evt = msg[2]
    let hidden = null
    try { hidden = JSON.parse(evt.content)?.hidden } catch { }
    const d = (evt.tags.find(t => t[0] === 'd') ?? [])[1] ?? ''
    const exp = (evt.tags.find(t => t[0] === 'expiration') ?? [])[1] ?? ''
    events.push({
      pubkey: evt.pubkey.slice(0, 8),
      sig: d.slice(0, 12),
      hidden,
      created: new Date(evt.created_at * 1000).toISOString(),
      expires: exp ? new Date(Number(exp) * 1000).toISOString() : '(none)',
      expired: exp ? Number(exp) * 1000 < Date.now() : false,
    })
  }
  if (msg[0] === 'EOSE') {
    console.log(JSON.stringify({ hideEventCount: events.length, events }, null, 1))
    ws.close()
    process.exit(0)
  }
})

ws.on('error', (err) => { console.error('ws error:', err.message); process.exit(1) })
setTimeout(() => { console.log(JSON.stringify({ hideEventCount: events.length, events, note: 'timeout before EOSE' }, null, 1)); process.exit(0) }, 8000)
