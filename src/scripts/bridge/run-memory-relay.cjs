// In-memory Nostr relay. No SQLite, no on-disk persistence — events
// live in a JS Map and disappear when the process exits. Enough for
// the paired-channel click-test.
//
// Listens on :7777 (matches the hardcoded LOCAL_RELAY in
// nostr-mesh.drone.ts).
//
// Protocol: standard Nostr (NIP-01) — EVENT, REQ, CLOSE, EOSE, NOTICE.
// Signatures are NOT verified (this is for local dev only; the wall is
// `localhost` reachability + the channel-secret derivation).
const { WebSocketServer, WebSocket } = require('ws')

const PORT = 7777
const wss = new WebSocketServer({ port: PORT })

/** id → event */
const events = new Map()
/** subId → { ws, filters[] } */
const subs = new Map()

function matchesFilter(evt, f) {
  if (Array.isArray(f.ids) && !f.ids.includes(evt.id)) return false
  if (Array.isArray(f.authors) && !f.authors.includes(evt.pubkey)) return false
  if (Array.isArray(f.kinds) && !f.kinds.includes(evt.kind)) return false
  if (typeof f.since === 'number' && evt.created_at < f.since) return false
  if (typeof f.until === 'number' && evt.created_at > f.until) return false
  if (typeof f.limit === 'number' && f.limit < 0) return false
  // Tag filters: keys like "#e", "#p", "#x", "#t"
  for (const key of Object.keys(f)) {
    if (!key.startsWith('#')) continue
    const tagName = key.slice(1)
    const wanted = f[key]
    if (!Array.isArray(wanted) || wanted.length === 0) continue
    const matched = (evt.tags || []).some(t => Array.isArray(t) && t[0] === tagName && wanted.includes(t[1]))
    if (!matched) return false
  }
  return true
}

function matchesAny(evt, filters) {
  if (!Array.isArray(filters) || filters.length === 0) return true
  return filters.some(f => matchesFilter(evt, f))
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg
    try { msg = JSON.parse(String(raw)) } catch { return }
    if (!Array.isArray(msg)) return
    const verb = msg[0]

    if (verb === 'EVENT') {
      const evt = msg[1]
      if (!evt?.id || !evt?.kind || !evt?.pubkey) {
        try { ws.send(JSON.stringify(['OK', evt?.id ?? '', false, 'invalid event'])) } catch {}
        return
      }
      if (events.has(evt.id)) {
        try { ws.send(JSON.stringify(['OK', evt.id, true, 'duplicate'])) } catch {}
        return
      }
      events.set(evt.id, evt)
      try { ws.send(JSON.stringify(['OK', evt.id, true, ''])) } catch {}
      // Fan out to subscribers whose filters match.
      for (const [subId, sub] of subs) {
        if (sub.ws.readyState !== WebSocket.OPEN) continue
        if (!matchesAny(evt, sub.filters)) continue
        try { sub.ws.send(JSON.stringify(['EVENT', subId, evt])) } catch {}
      }
      return
    }

    if (verb === 'REQ') {
      const subId = String(msg[1] ?? '')
      if (!subId) return
      const filters = msg.slice(2)
      subs.set(subId, { ws, filters })
      // Send matching stored events.
      const matching = [...events.values()].filter(e => matchesAny(e, filters))
      // Honor `limit` across the union (simple — most recent first).
      const maxLimit = Array.isArray(filters)
        ? Math.max(...filters.map(f => typeof f.limit === 'number' ? f.limit : Infinity))
        : Infinity
      matching.sort((a, b) => b.created_at - a.created_at)
      const slice = Number.isFinite(maxLimit) ? matching.slice(0, maxLimit) : matching
      for (const evt of slice.reverse()) {
        try { ws.send(JSON.stringify(['EVENT', subId, evt])) } catch {}
      }
      try { ws.send(JSON.stringify(['EOSE', subId])) } catch {}
      return
    }

    if (verb === 'CLOSE') {
      const subId = String(msg[1] ?? '')
      if (subId) subs.delete(subId)
      return
    }
  })

  ws.on('close', () => {
    // Drop subs owned by this socket.
    for (const [subId, sub] of subs) {
      if (sub.ws === ws) subs.delete(subId)
    }
  })
})

console.log(`[memory-relay] listening on ws://localhost:${PORT}`)

process.on('SIGINT', () => { wss.close(); process.exit(0) })
process.on('SIGTERM', () => { wss.close(); process.exit(0) })
