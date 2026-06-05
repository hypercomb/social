#!/usr/bin/env node
// hypercomb-relay — minimal Nostr relay AND HTTP content host for private swarm meetings
// usage: node relay.js [--port 7777] [--pubkeys hex1,hex2] [--memory] [--db ./relay.db] [--max-event-size 65536] [--content-dir ./content] [--writers hex1,hex2] [--max-body-bytes 52428800]
//
// env fallbacks (used when the matching --flag is absent):
//   PORT             → port to listen on (Azure App Service injects this)
//   WEBSITE_HOSTNAME → presence implies App Service: default db moves to
//                      /home/relay.db (persistent across restarts on the
//                      App Service Linux /home mount).
//   CONTENT_DIR      → directory to serve HTTP content from (sig-addressed
//                      content store). Defaults to ./content next to the
//                      script. Operators populate it however they want
//                      (rsync, symlink, manual copy); the relay just
//                      serves whatever's in there.
//
// HTTP file serving makes this a "host" in the domain-as-identity sense
// (per project_domain_as_identity.md). The relay endpoint (wss://) and
// the content endpoint (https://) share a hostname; askers learn the
// hostname via the { bytes, domains } primitive and HTTPS-GET against
// it for resources/bees/deps/layers.

import { createServer } from 'node:http'
import { randomBytes, createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { WebSocketServer } from 'ws'
import { verifyEvent } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── cli ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const envPort = Number(process.env.PORT)
  const onAppService = !!process.env.WEBSITE_HOSTNAME
  const envContentDir = String(process.env.CONTENT_DIR ?? '').trim()
  const args = {
    port: Number.isFinite(envPort) && envPort > 0 ? envPort : 7777,
    pubkeys: null,
    memory: false,
    db: onAppService ? '/home/relay.db' : './relay.db',
    maxEventSize: 65536,
    // Content dir for HTTP file serving. Default: ./content next to the
    // script. Operators populate it however they like (symlink to their
    // dist/, rsync from elsewhere, manual copy). The relay serves only
    // files inside this dir — directory traversal is blocked.
    contentDir: envContentDir || resolve(__dirname, 'content'),
    // Allowed-writer pubkeys for HTTP PUT (content backup). When unset
    // here, falls back to --pubkeys after parse; empty => writes disabled.
    // Each PUT carries a NIP-98 signed event whose pubkey must be in this set.
    writers: (() => { const e = String(process.env.WRITERS ?? '').trim(); return e ? e.split(',').map(normalizePubkey).filter(Boolean) : null })(),
    // Hard cap on a single PUT body (default 50 MB) — prevents disk-fill abuse.
    maxBodyBytes: 52_428_800,
  }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--memory') { args.memory = true; continue }
    const next = argv[i + 1]
    if (a === '--port' && next) { args.port = Number(next); i++ }
    else if (a === '--pubkeys' && next) { args.pubkeys = next.split(',').map(normalizePubkey).filter(Boolean); i++ }
    else if (a === '--db' && next) { args.db = next; i++ }
    else if (a === '--max-event-size' && next) { args.maxEventSize = Number(next); i++ }
    else if (a === '--content-dir' && next) { args.contentDir = resolve(next); i++ }
    else if (a === '--writers' && next) { args.writers = next.split(',').map(normalizePubkey).filter(Boolean); i++ }
    else if (a === '--max-body-bytes' && next) { args.maxBodyBytes = Number(next); i++ }
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

// Allowed-writer pubkeys for HTTP PUT. Defaults to the relay's event-auth
// whitelist (--pubkeys) when --writers is absent. Empty set => writes are
// rejected — an open relay does not accept content writes by default; the
// operator opts in by listing their own pubkey(s).
const writers = new Set(
  ((cfg.writers && cfg.writers.length ? cfg.writers : cfg.pubkeys) || []).map((p) => p.toLowerCase())
)

function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

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

// ── content-host (HTTP file serving) ─────────────────────────────────────────
//
// Per the "host is a verb" doctrine (project_domain_as_identity.md):
// a host captures + packages + SERVES. This is the serve half — the
// relay's http handler also returns sig-addressed content blobs at
// well-known paths so peers can HTTPS-GET them directly without
// going through the mesh broker.
//
// Path validation:
//  - Accepted paths: anything that resolves inside cfg.contentDir
//  - Rejected: ../, absolute paths, anything escaping the content root
//  - This is a content store, not a filesystem — only files matching
//    the standard hypercomb layout (__bees__/, __dependencies__/,
//    __layers__/, __resources__/, manifest.json) are intended targets,
//    but the resolution check below is generic — anything inside the
//    contentDir is fair game. Operators control what's there.

function getContentType(path) {
  const ext = extname(path).toLowerCase()
  if (ext === '.js')   return 'application/javascript; charset=utf-8'
  if (ext === '.json') return 'application/json; charset=utf-8'
  if (ext === '.css')  return 'text/css; charset=utf-8'
  if (ext === '.html') return 'text/html; charset=utf-8'
  if (ext === '.svg')  return 'image/svg+xml'
  if (ext === '.png')  return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  return 'application/octet-stream'
}

// Flat sig resolution (protocol-spec §21.10): a bare `/<64-hex>` resolves
// to whichever pool holds it — no type prefix, no extension. The pool the
// sig is found in supplies the Content-Type. This is the canonical read
// endpoint: `https://<host>/<sig>`. Knowing the address is decoupled from
// knowing the type — the consumer already knows the type from the
// referring layer; the host resolves the bytes by probing its pools.
//
// Probe order is the membership oracle; first hit wins. A sig lives in
// exactly one pool (its bytes are one thing), so order only decides which
// stat lands first. __roots__ attestations (grouped by domain) resolve
// too when present. Returns { path, contentType } or null (→ 404).
function resolveFlatSig(sig) {
  const root = resolve(cfg.contentDir)
  const probes = [
    [join(root, '__layers__', sig + '.json'), 'application/json; charset=utf-8'],
    [join(root, '__bees__', sig + '.js'), 'application/javascript; charset=utf-8'],
    [join(root, '__dependencies__', sig + '.js'), 'application/javascript; charset=utf-8'],
    [join(root, '__resources__', sig), 'application/octet-stream'],
  ]
  for (const [p, ct] of probes) {
    try { if (statSync(p).isFile()) return { path: p, contentType: ct } } catch { /* not in this pool */ }
  }
  // __roots__/<domain>/<sig> — attestations, grouped by attester domain.
  try {
    const rootsDir = join(root, '__roots__')
    if (statSync(rootsDir).isDirectory()) {
      for (const domain of readdirSync(rootsDir)) {
        const p = join(rootsDir, domain, sig)
        try { if (statSync(p).isFile()) return { path: p, contentType: 'application/json; charset=utf-8' } } catch { /* next domain */ }
      }
    }
  } catch { /* no __roots__ pool */ }
  return null
}

function tryServeContent(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') return false

  // CORS preflight — relays serve from <op>.domain, askers come from
  // other origins (hypercomb.io, alice.dev, etc.); blanket-permit.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    })
    res.end()
    return true
  }

  // Strip query string + decode
  let urlPath
  try { urlPath = decodeURIComponent((req.url || '').split('?')[0]) } catch { return false }
  if (!urlPath || urlPath === '/') return false

  let resolved
  let contentType
  const sigMatch = urlPath.match(/^\/([0-9a-f]{64})$/)
  if (sigMatch) {
    // Flat sig endpoint: /<sig> → probe the pools (§21.10). A miss is a
    // clean 404 (NOT the liveness fallthrough) so an adopting client can
    // tell "host doesn't have it" from real content and try another host
    // / treat it as an egg. No immutable cache on the 404 — the sig may
    // arrive later.
    const hit = resolveFlatSig(sigMatch[1])
    if (!hit) { respondText(res, 404, 'sig not held'); return true }
    resolved = hit.path
    contentType = hit.contentType
  } else {
    // Legacy typed path (/__bees__/<sig>.js, /__layers__/<sig>.json, …),
    // kept during the migration to bare-sig URLs. Resolve under
    // contentDir, then verify the result is still inside it.
    resolved = resolve(cfg.contentDir, '.' + urlPath)
    const rootDir = resolve(cfg.contentDir)
    if (!resolved.startsWith(rootDir + sep) && resolved !== rootDir) return false
    if (!existsSync(resolved)) return false
    let st
    try { st = statSync(resolved) } catch { return false }
    if (!st.isFile()) return false
    contentType = getContentType(resolved)
  }

  try {
    const bytes = readFileSync(resolved)
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': String(bytes.length),
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=31536000, immutable',
    })
    if (req.method === 'HEAD') { res.end(); return true }
    res.end(bytes)
    return true
  } catch {
    return false
  }
}

function respondText(res, code, msg) {
  res.writeHead(code, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' })
  res.end(msg)
}

// ── content-host (HTTP write — the backup/push side) ─────────────────────────
//
// The push counterpart to tryServeContent. A PUT lands content into the
// sig pool so the host can serve it (and others adopt it). Two guards,
// independent (protocol-spec §21.12):
//   1. content-integrity — the target must be sig-addressed, and
//      sha256(body) MUST equal that sig. Bytes authenticate themselves;
//      a forged sig is computationally impossible. Idempotent: same sig
//      == same bytes.
//   2. writer-authorization — a NIP-98 signed event (Authorization:
//      Nostr <base64-event>) whose pubkey is in the allowed-writers set.
//      Proves WHO without ever sending a secret; the host holds only
//      public keys. Empty writer set => writes disabled.
//
// Reads stay open (tryServeContent); only writes are gated.

function verifyWriteAuth(req) {
  if (writers.size === 0) return { ok: false, reason: 'writes not enabled (no authorized writers configured)' }
  const header = String(req.headers['authorization'] || '').trim()
  const m = /^Nostr\s+(.+)$/i.exec(header)
  if (!m) return { ok: false, reason: 'missing Nostr authorization header' }
  let evt
  try { evt = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')) } catch { return { ok: false, reason: 'malformed auth token' } }
  try { if (!verifyEvent(evt)) return { ok: false, reason: 'invalid signature' } } catch { return { ok: false, reason: 'invalid signature' } }
  if (Number(evt.kind) !== 27235) return { ok: false, reason: 'wrong auth event kind (expected NIP-98 27235)' }
  const pubkey = String(evt.pubkey || '').toLowerCase()
  if (!writers.has(pubkey)) return { ok: false, reason: 'pubkey is not an authorized writer' }
  // freshness window (±60s) — bounds replay of a captured token
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - Number(evt.created_at || 0)) > 60) return { ok: false, reason: 'auth token outside freshness window' }
  // bind to method + path (body is bound implicitly: the URL sig == sha256(body))
  const tags = Array.isArray(evt.tags) ? evt.tags : []
  const methodTag = tags.find((t) => Array.isArray(t) && t[0] === 'method')?.[1]
  if (String(methodTag || '').toUpperCase() !== 'PUT') return { ok: false, reason: 'auth method tag mismatch' }
  const uTag = tags.find((t) => Array.isArray(t) && t[0] === 'u')?.[1]
  let signedPath
  try { signedPath = new URL(String(uTag)).pathname } catch { signedPath = String(uTag || '') }
  const reqPath = (req.url || '').split('?')[0]
  if (signedPath !== reqPath) return { ok: false, reason: 'auth url tag mismatch' }
  return { ok: true, pubkey }
}

function tryWriteContent(req, res) {
  if (req.method !== 'PUT') return false

  let urlPath
  try { urlPath = decodeURIComponent((req.url || '').split('?')[0]) } catch { respondText(res, 400, 'bad path'); return true }
  if (!urlPath || urlPath === '/') { respondText(res, 400, 'no target path'); return true }

  // traversal defense — identical to the read path
  const resolved = resolve(cfg.contentDir, '.' + urlPath)
  const root = resolve(cfg.contentDir)
  if (!resolved.startsWith(root + sep) && resolved !== root) { respondText(res, 403, 'target outside content root'); return true }

  // writes must be sig-addressed: basename (minus .js/.json) must be a 64-hex sig
  const base = urlPath.split('/').pop() || ''
  const sig = base.replace(/\.(js|json)$/i, '').toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(sig)) { respondText(res, 400, 'target is not sig-addressed'); return true }

  const auth = verifyWriteAuth(req)
  if (!auth.ok) { respondText(res, 401, auth.reason); return true }

  const chunks = []
  let size = 0
  let aborted = false
  req.on('data', (c) => {
    if (aborted) return
    size += c.length
    if (size > cfg.maxBodyBytes) { aborted = true; respondText(res, 413, 'body too large'); req.destroy(); return }
    chunks.push(c)
  })
  req.on('end', () => {
    if (aborted) return
    const body = Buffer.concat(chunks)
    const actual = sha256Hex(body)
    if (actual !== sig) { respondText(res, 422, `hash mismatch: sha256(body)=${actual.slice(0, 12)} != ${sig.slice(0, 12)}`); return }
    try {
      mkdirSync(dirname(resolved), { recursive: true })
      writeFileSync(resolved, body)
    } catch (e) {
      respondText(res, 500, 'write failed: ' + (e?.message || 'unknown'))
      return
    }
    res.writeHead(201, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' })
    res.end(`stored ${sig}`)
    console.log(`[write] ${auth.pubkey.slice(0, 8)}… PUT ${urlPath} (${body.length} bytes)`)
  })
  req.on('error', () => { if (!aborted) respondText(res, 400, 'request stream error') })
  return true
}

const server = createServer((req, res) => {
  // NIP-11 relay metadata (Accept: application/nostr+json)
  if (req.headers.accept?.includes('application/nostr+json')) {
    res.writeHead(200, { 'Content-Type': 'application/nostr+json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify(relayInfo))
    return
  }

  // Read side: GET/HEAD/OPTIONS content serving (returns true if handled)
  if (tryServeContent(req, res)) return

  // Write side: PUT content into the sig pool (gated). Returns true if handled.
  if (tryWriteContent(req, res)) return

  // Default: liveness message
  res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' })
  res.end('hypercomb-relay running. Connect via WebSocket or GET sig-addressed content.')
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
  console.log(`hypercomb-relay listening on ws://0.0.0.0:${cfg.port} (WebSocket relay + HTTP content host)`)
  if (authRequired) console.log(`auth required — ${cfg.pubkeys.length} pubkey(s) whitelisted`)
  if (cfg.memory) console.log('in-memory mode — events will not persist')
  else console.log(`database: ${cfg.db}`)
  const contentReady = existsSync(cfg.contentDir)
  console.log(`content-dir: ${cfg.contentDir} ${contentReady ? '(ready)' : '(empty — host will 404 until populated)'}`)
  if (writers.size > 0) console.log(`writes: enabled — ${writers.size} authorized writer pubkey(s) (NIP-98 + sha256 verify)`)
  else console.log('writes: disabled (no --writers / --pubkeys configured)')
})
