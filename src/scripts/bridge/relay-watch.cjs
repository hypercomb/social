// Live watcher: subscribe to the local Nostr relay and print every event.
// Useful for confirming publish/sync from the browser tabs.
const W = require('ws')
const ws = new W('ws://127.0.0.1:7777')
const since = Math.floor(Date.now() / 1000)
let n = 0

ws.on('open', () => {
  console.log(`[watch] connected, listening for events since ${new Date(since * 1000).toISOString()}`)
  ws.send(JSON.stringify(['REQ', 'live', { since }]))
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
