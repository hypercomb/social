#!/usr/bin/env node
// hypercomb-relay — minimal Nostr relay for private swarm meetings
// usage: node relay.js [--port 7777] [--pubkeys hex1,hex2] [--memory] [--db ./relay.db] [--max-event-size 65536]

import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import Database from 'better-sqlite3'
import { WebSocketServer } from 'ws'
import { verifyEvent } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'

// ── cli ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { port: 7777, pubkeys: null, memory: false, db: './relay.db', maxEventSize: 65536 }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--memory') { args.memory = true; continue }
    const next = argv[i + 1]
    if (a === '--port' && next) { args.port = Number(next); i++ }
    else if (a === '--pubkeys' && next) { args.pubkeys = next.split(',').map(normalizePubkey).filter(Boolean); i++ }
    else if (a === '--db' && next) { args.db = next; i++ }
    else if (a === '--max-event-size' && next) { args.maxEventSize = Number(next); i++ }
  }
  return args
}

function normalizePubkey(raw) {
  const s = raw.trim()
  if (/^[0-9a-f]{64}$/i.test(s)) return s.toLowerCase()
  try { const { type, data } = nip19.decode(s); if (type === 'npub') return data } catch {}
  return null
}

const cfg = parseArgs(process.argv)

// ── database ─────────────────────────────────────────────────────────────────

const db = new Database(cfg.memory ? ':memory:' : cfg.db)
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY, pubkey TEXT NOT NULL, created_at INTEGER NOT NULL,
    kind INTEGER NOT NULL, tags TEXT NOT NULL, content TEXT NOT NULL, sig TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_kind ON events(kind);
  CREATE INDEX IF NOT EXISTS idx_pubkey ON events(pubkey);
  CREATE INDEX IF NOT EXISTS idx_created_at ON events(created_at);
`)

const stmtInsert = db.prepare(
  'INSERT OR IGNORE INTO events (id, pubkey, created_at, kind, tags, content, sig) VALUES (?, ?, ?, ?, ?, ?, ?)'
)

function insertEvent(evt) {
  stmtInsert.run(evt.id, evt.pubkey, evt.created_at, evt.kind, JSON.stringify(evt.tags), evt.content, evt.sig)
}

function queryEvents(filters) {
  const results = []
  for (const f of filters) {
    const clauses = []; const params = []

    if (f.ids?.length) { clauses.push(`id IN (${f.ids.map(() => '?').join(',')})`); params.push(...f.ids) }
    if (f.authors?.length) { clauses.push(`pubkey IN (${f.authors.map(() => '?').join(',')})`); params.push(...f.authors) }
    if (f.kinds?.length) { clauses.push(`kind IN (${f.kinds.map(() => '?').join(',')})`); params.push(...f.kinds) }
    if (f.since != null) { clauses.push('created_at >= ?'); params.push(f.since) }
    if (f.until != null) { clauses.push('created_at <= ?'); params.push(f.until) }

    // generic tag filters (#x, #e, #p, etc.)
    for (const [key, values] of Object.entries(f)) {
      if (!key.startsWith('#') || key.length !== 2 || !Array.isArray(values)) continue
      const tagName = key[1]
      clauses.push(
        `EXISTS (SELECT 1 FROM json_each(tags) AS t WHERE json_extract(t.value, '$[0]') = ? AND json_extract(t.value, '$[1]') IN (${values.map(() => '?').join(',')}))`
      )
      params.push(tagName, ...values)
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const limit = Math.min(f.limit ?? 500, 5000)
    const rows = db.prepare(`SELECT id, pubkey, created_at, kind, tags, content, sig FROM events ${where} ORDER BY created_at DESC LIMIT ?`).all(...params, limit)

    for (const r of rows) {
      results.push({ id: r.id, pubkey: r.pubkey, created_at: r.created_at, kind: r.kind, tags: JSON.parse(r.tags), content: r.content, sig: r.sig })
    }
  }
  return results
}

function deleteExpired() {
  const now = Math.floor(Date.now() / 1000)
  db.prepare(
    `DELETE FROM events WHERE EXISTS (SELECT 1 FROM json_each(tags) AS t WHERE json_extract(t.value, '$[0]') = 'expiration' AND CAST(json_extract(t.value, '$[1]') AS INTEGER) > 0 AND CAST(json_extract(t.value, '$[1]') AS INTEGER) < ?)`
  ).run(now)
}

// ── rate limiting ────────────────────────────────────────────────────────────

const rates = new Map() // ip -> { count, windowStart }
const RATE_WINDOW = 60_000
const RATE_LIMIT = 100

function checkRate(ip) {
  const now = Date.now()
  let entry = rates.get(ip)
  if (!entry || now - entry.windowStart > RATE_WINDOW) {
    entry = { count: 0, windowStart: now }
    rates.set(ip, entry)
  }
  entry.count++
  return entry.count <= RATE_LIMIT
}

setInterval(() => {
  const cutoff = Date.now() - RATE_WINDOW
  for (const [ip, e] of rates) { if (e.windowStart < cutoff) rates.delete(ip) }
}, RATE_WINDOW)

// ── filter matching (for live broadcast) ─────────────────────────────────────

function matchFilter(filter, evt) {
  if (filter.ids && !filter.ids.includes(evt.id)) return false
  if (filter.authors && !filter.authors.includes(evt.pubkey)) return false
  if (filter.kinds && !filter.kinds.includes(evt.kind)) return false
  if (filter.since && evt.created_at < filter.since) return false
  if (filter.until && evt.created_at > filter.until) return false

  for (const [key, values] of Object.entries(filter)) {
    if (!key.startsWith('#') || key.length !== 2 || !Array.isArray(values)) continue
    const tagName = key[1]
    const evtValues = evt.tags.filter(t => t[0] === tagName).map(t => t[1])
    if (!values.some(v => evtValues.includes(v))) return false
  }
  return true
}

function matchesAny(filters, evt) {
  return filters.some(f => matchFilter(f, evt))
}

// ── nip-42 auth ──────────────────────────────────────────────────────────────

const authRequired = Array.isArray(cfg.pubkeys)

function makeChallenge() { return randomBytes(32).toString('hex') }

function verifyAuth(evt, challenge) {
  if (!evt || evt.kind !== 22242) return false
  try { if (!verifyEvent(evt)) return false } catch { return false }

  const challengeTag = evt.tags.find(t => t[0] === 'challenge')
  if (!challengeTag || challengeTag[1] !== challenge) return false

  if (!cfg.pubkeys.includes(evt.pubkey)) return false
  return true
}

// ── connections ──────────────────────────────────────────────────────────────

const clients = new Set()
const MAX_SUBS_PER_CLIENT = 20

function broadcast(evt, sourceWs) {
  const frame = JSON.stringify(['EVENT', '__broadcast__', evt])
  for (const c of clients) {
    if (c.ws === sourceWs) continue
    if (c.ws.readyState !== 1) continue
    if (authRequired && !c.authed) continue
    for (const [subId, filters] of c.subs) {
      if (matchesAny(filters, evt)) {
        try { c.ws.send(JSON.stringify(['EVENT', subId, evt])) } catch {}
      }
    }
  }
}

function send(ws, msg) {
  if (ws.readyState === 1) try { ws.send(JSON.stringify(msg)) } catch {}
}

function handleMessage(client, raw) {
  if (typeof raw !== 'string') return
  if (Buffer.byteLength(raw, 'utf8') > cfg.maxEventSize) {
    send(client.ws, ['NOTICE', 'message too large']); return
  }
  if (!checkRate(client.ip)) {
    send(client.ws, ['NOTICE', 'rate-limited']); return
  }

  let msg
  try { msg = JSON.parse(raw) } catch { send(client.ws, ['NOTICE', 'invalid JSON']); return }
  if (!Array.isArray(msg) || msg.length < 1) { send(client.ws, ['NOTICE', 'invalid message']); return }

  const type = msg[0]

  if (type === 'AUTH') {
    if (!authRequired) return
    const ok = verifyAuth(msg[1], client.challenge)
    if (ok) {
      client.authed = true
      client.pubkey = msg[1].pubkey
      send(client.ws, ['OK', msg[1].id, true, ''])
    } else {
      send(client.ws, ['OK', msg[1]?.id ?? '', false, 'auth-required: verification failed'])
    }
    return
  }

  if (authRequired && !client.authed) {
    if (type === 'EVENT') { send(client.ws, ['OK', msg[1]?.id ?? '', false, 'auth-required: please authenticate']); return }
    if (type === 'REQ') { send(client.ws, ['NOTICE', 'auth-required: please authenticate']); return }
  }

  if (type === 'EVENT') {
    const evt = msg[1]
    if (!evt || !evt.id || !evt.pubkey || !evt.sig) {
      send(client.ws, ['OK', evt?.id ?? '', false, 'invalid: missing fields']); return
    }
    try { if (!verifyEvent(evt)) { send(client.ws, ['OK', evt.id, false, 'invalid: bad signature']); return } }
    catch { send(client.ws, ['OK', evt.id, false, 'invalid: verification error']); return }

    insertEvent(evt)
    send(client.ws, ['OK', evt.id, true, ''])
    broadcast(evt, client.ws)
    return
  }

  if (type === 'REQ') {
    const subId = msg[1]
    if (typeof subId !== 'string' || !subId) { send(client.ws, ['NOTICE', 'invalid subscription id']); return }
    if (client.subs.size >= MAX_SUBS_PER_CLIENT) { send(client.ws, ['NOTICE', 'too many subscriptions']); return }

    const filters = msg.slice(2)
    client.subs.set(subId, filters)

    const events = queryEvents(filters)
    for (const evt of events) send(client.ws, ['EVENT', subId, evt])
    send(client.ws, ['EOSE', subId])
    return
  }

  if (type === 'CLOSE') {
    client.subs.delete(msg[1])
    return
  }
}

// ── http + websocket server ──────────────────────────────────────────────────

const relayInfo = {
  name: 'hypercomb-relay',
  description: 'Minimal Nostr relay for Hypercomb swarms',
  supported_nips: [1, 11, ...(authRequired ? [42] : [])],
  software: 'https://github.com/nicepkg/hypercomb',
  version: '0.1.0',
  limitation: {
    max_message_length: cfg.maxEventSize,
    max_subscriptions: MAX_SUBS_PER_CLIENT,
    auth_required: authRequired
  }
}

const server = createServer((req, res) => {
  if (req.headers.accept?.includes('application/nostr+json')) {
    res.writeHead(200, { 'Content-Type': 'application/nostr+json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify(relayInfo))
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('hypercomb-relay running. Connect via WebSocket.')
  }
})

const wss = new WebSocketServer({ server })

wss.on('connection', (ws, req) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown'
  const client = { ws, ip, authed: !authRequired, pubkey: null, challenge: null, subs: new Map() }

  if (authRequired) {
    client.challenge = makeChallenge()
    send(ws, ['AUTH', client.challenge])
  }

  clients.add(client)

  ws.on('message', (data) => handleMessage(client, String(data)))
  ws.on('close', () => clients.delete(client))
  ws.on('error', () => clients.delete(client))
})

// periodic cleanup
setInterval(deleteExpired, 60_000)

// graceful shutdown
function shutdown() {
  console.log('\nshutting down...')
  for (const c of clients) try { c.ws.close() } catch {}
  wss.close()
  server.close()
  db.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

// start
server.listen(cfg.port, () => {
  console.log(`hypercomb-relay listening on ws://0.0.0.0:${cfg.port}`)
  if (authRequired) console.log(`auth required — ${cfg.pubkeys.length} pubkey(s) whitelisted`)
  if (cfg.memory) console.log('in-memory mode — events will not persist')
  else console.log(`database: ${cfg.db}`)
})
