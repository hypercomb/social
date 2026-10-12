// Live watcher: subscribe to the local Nostr relay and print every event.
// Useful for confirming publish/sync from the browser tabs.
const W = require('ws')
const ws = new W('ws://127.0.0.1:7777')
const since = Math.floor(Date.now() / 1000)
// The relay's address gate refuses a read that names no signature
// (documentation/swarm-host.md, "Reads name an address"): name the
// addresses to read, HC_X=<sig>,<sig> (a page sig, a lifecycle sig).
const XS = String(process.env.HC_X || '').split(',').map(s => s.trim()).filter(s => /^[0-9a-f]{64}$/.test(s))
let n = 0

ws.on('open', () => {
  console.log(`[watch] connected, listening for events since ${new Date(since * 1000).toISOString()}`)
  ws.send(JSON.stringify(['REQ', 'live', { since, ...(XS.length ? { '#x': XS } : {}) }]))
})

ws.on('message', (raw) => {
  try {
    const arr = JSON.parse(String(raw))
    if (arr[0] === 'EVENT') {
      n++
      const e = arr[2]
      const tagSummary = (e.tags || []).map(t => t[0]).join(',')
      const contentPreview = String(e.content || '').slice(0, 100).replace(/\n/g, ' ')
      console.log(`[evt #${n}] kind=${e.kind} pk=${(e.pubkey || '').slice(0, 12)} tags=[${tagSummary}] content=${contentPreview}`)
    } else if (arr[0] === 'EOSE') {
      console.log('[watch] caught up, now live')
    } else if (arr[0] === 'CLOSED') {
      console.error(`[watch] refused: ${arr[2]} — name the addresses: HC_X=<sig>,<sig>`)
      process.exit(1)
    } else if (arr[0] === 'NOTICE') {
      console.log('[watch] notice:', arr[1])
    }
  } catch (err) {
    console.error('[watch] parse:', err.message)
  }
})

ws.on('error', (e) => { console.error('[watch] err:', e.message); process.exit(1) })
ws.on('close', () => { console.log('[watch] closed after', n, 'events'); process.exit(0) })

process.on('SIGINT', () => { ws.close(); process.exit(0) })
