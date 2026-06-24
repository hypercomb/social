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
import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
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
    // Must clear the swarm's resource pipeline: kind-30201 events inline
    // up to MAX_RESOURCE_BYTES (256 KB) of image bytes as base64 — ≈342 KB
    // of JSON before the envelope. At the old 64 KB cap every tile-image
    // event was rejected with NOTICE 'message too large' (silently ignored
    // by the mesh client), so peer tiles could never carry their images.
    maxEventSize: 524288,
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
    // DEV ONLY: skip writer-authorization on PUT (sha256 content-integrity is
    // STILL enforced — bytes must hash to the sig). Lets a local browser stage
    // its own authored content on a dev relay without NIP-98 key setup. Never
    // use on a public host.
    devOpenWrites: false,
    // SPA serving REMOVED — the relay is a slim STORAGE/MESH host only.
    //
    // Under the full-split model, the installer's code-serving role is fixed
    // to the canonical project origin (diamondcoreprocessor.com). Any host
    // that ALSO serves installer code becomes a trust-surface because the
    // operator can swap that code silently between visits. Slim hosts CAN'T
    // do that — they serve `/<sig>` bytes (content-addressed, unforgeable)
    // and the WSS relay (passes messages). That's it.
    //
    // A request for `/` now returns a small landing page that names the host
    // and links the participant to the canonical installer. No SPA, no client
    // routing, no index.html fallback. If you want to develop on the
    // installer, run `npm start` from `diamond-core-processor/` separately
    // (it serves at localhost:2400). Don't conflate.
    //
    // swarm-temp REMOVED — the relay does not host other participants'
    // bytes. Per the byte-path model: the mesh resolves sig→domains, bytes
    // come HTTP-direct from real endpoints, and a sig with no endpoint
    // stays an EGG (durable placeholder, hatches when an endpoint delivers).
    // No mesh file transfers, no host-brokering of others' content.
  }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--memory') { args.memory = true; continue }
    if (a === '--dev-open-writes') { args.devOpenWrites = true; continue }
    const next = argv[i + 1]
    if (a === '--port' && next) { args.port = Number(next); i++ }
    else if (a === '--pubkeys' && next) { args.pubkeys = next.split(',').map(normalizePubkey).filter(Boolean); i++ }
    else if (a === '--db' && next) { args.db = next; i++ }
    else if (a === '--max-event-size' && next) { args.maxEventSize = Number(next); i++ }
    else if (a === '--content-dir' && next) { args.contentDir = resolve(next); i++ }
    else if (a === '--writers' && next) { args.writers = next.split(',').map(normalizePubkey).filter(Boolean); i++ }
    else if (a === '--max-body-bytes' && next) { args.maxBodyBytes = Number(next); i++ }
    else if (a === '--spa-dir' && next) {
      // Removed flag — surface a clear error so legacy startup scripts get
      // updated rather than silently changing behavior. The relay no longer
      // serves the SPA under any circumstances.
      console.error('[relay] --spa-dir was removed. The relay is a slim storage/mesh host.')
      console.error('[relay] Update your startup script to drop --spa-dir.')
      console.error('[relay] To develop on the installer, run `npm start` from diamond-core-processor/ separately (localhost:2400).')
      process.exit(2)
    }
    else if (a === '--swarm-temp' || a === '--swarm-temp-ttl' || a === '--swarm-temp-cap' || a === '--swarm-temp-total') {
      console.error(`[relay] ${a} was removed — swarm-temp no longer exists (no host-brokering; missing sigs are eggs). Drop it from your startup script.`)
      process.exit(2)
    }
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

// ── swarm-temp pool: REMOVED ─────────────────────────────────────────────────
//
// The relay no longer hosts other participants' bytes. Per the byte-path
// model (confirmed 2026-06): the mesh resolves sig→domains, bytes come
// HTTP-direct from real endpoints, and a sig with no endpoint stays an EGG
// (durable placeholder that hatches when an endpoint delivers). No mesh file
// transfers, no host-brokering — so the __swarm_temp__ pool, its NIP-98
// per-participant write path, quotas, and sweeper are all gone.

// ── permissions-policy ───────────────────────────────────────────────────────
//
// Sent on every HTTP response. Tells the browser, structurally, which Web APIs
// this site uses and which it explicitly DOES NOT use. The `=()` form disables
// the feature for THIS origin and any embedded frames; `=(self)` allows it for
// our own origin only (no third-party iframes get it).
//
// This is what closes the "Edge auto-prompts for window-management because it
// saw a multi-monitor setup" class of bug: with the policy header set, the
// browser knows the API isn't in use and skips the prompt entirely. Same
// principle for every other prompting Web API — explicitly closing the door
// for APIs we don't use, opening it only for the camera/mic/clipboard/etc.
// surfaces the meeting + recording + tile-editor features actually need.
const PERMISSIONS_POLICY = [
  // ── explicitly DENIED (we do not use these — no prompt should ever fire) ──
  'accelerometer=()',
  'ambient-light-sensor=()',
  'battery=()',
  'bluetooth=()',
  'browsing-topics=()',
  'compute-pressure=()',
  'display-capture=()',
  'document-domain=()',
  'gamepad=()',
  'geolocation=()',
  'gyroscope=()',
  'hid=()',
  'idle-detection=()',
  'local-fonts=()',
  'magnetometer=()',
  'midi=()',
  'otp-credentials=()',
  'payment=()',
  'publickey-credentials-create=()',
  'publickey-credentials-get=()',
  'screen-wake-lock=()',
  'serial=()',
  'speaker-selection=()',
  'storage-access=()',
  'usb=()',
  'web-share=()',
  'window-management=()',   // ← the one that produced the Edge "access other apps and services" prompt
  'xr-spatial-tracking=()',
  // ── allowed for OUR ORIGIN only (features the site actually uses) ──
  'autoplay=(self)',
  'camera=(self)',
  'clipboard-read=(self)',
  'clipboard-write=(self)',
  'encrypted-media=(self)',
  'fullscreen=(self)',
  'microphone=(self)',
  'picture-in-picture=(self)',
].join(', ')

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
  // NIP-33 parameterized replaceable events (kind 30000–39999): the relay
  // holds exactly ONE event per (pubkey, kind, d-tag) — the newest. The
  // whole swarm wire model assumes this (kinds 30200–30205 all publish to
  // a replaceable slot). Without the eviction, every publish accumulated
  // and REQ replay returned the full history newest-first — receivers
  // applying events in arrival order ended on the publisher's OLDEST
  // event, so a late joiner saw a peer's initial empty publish instead of
  // their current tiles.
  const kind = Number(evt.kind)
  if (kind >= 30000 && kind < 40000) {
    const d = String((evt.tags || []).find((t) => Array.isArray(t) && t[0] === 'd')?.[1] ?? '')
    const dMatch = `EXISTS (SELECT 1 FROM json_each(tags) AS t WHERE json_extract(t.value, '$[0]') = 'd' AND json_extract(t.value, '$[1]') = ?)`
    const newest = db.prepare(
      `SELECT created_at FROM events WHERE pubkey = ? AND kind = ? AND ${dMatch} ORDER BY created_at DESC LIMIT 1`
    ).get(evt.pubkey, kind, d)
    if (newest && newest.created_at > evt.created_at) return  // stale republish — keep the newer slot
    db.prepare(`DELETE FROM events WHERE pubkey = ? AND kind = ? AND ${dMatch}`).run(evt.pubkey, kind, d)
  }
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
// Per-IP message budget. An IP is NOT one participant: localhost dev runs
// every browser through 127.0.0.1, and NAT'd households/offices share one
// address. A single swarm publish burst is up to MAX_PUBLISH_NODES (200)
// layer events plus personal-channel/presence/resource traffic, so two
// peers navigating a content-rich location together can legitimately emit
// several hundred messages inside a window. At 100 this silently dropped
// one peer's layer events (NOTICE 'rate-limited' — the mesh client ignores
// NOTICEs) and the swarm union went one-sided. 1200/min ≈ 20 msg/s
// sustained still stops floods without starving co-located participants.
const RATE_LIMIT = 1200

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

// ── swarm lifecycle last-will (server-side LWT) ───────────────────────────────
//
// The swarm's presence protocol publishes a parameterized-replaceable
// "lifecycle" event (kind 30206) on a shared per-zone channel:
//   { alive: true }  — a periodic liveness beacon (NIP-40 expiry)
//   { left:  true }  — an explicit tombstone on graceful leave
// Receivers drop ALL of a participant's witnessed tiles on {left:true}.
//
// A tab that crashes / is killed can't send its own tombstone (a WebSocket
// send during unload usually doesn't flush). This is the classic MQTT
// Last-Will case, and the fix is the same: the SERVER emits the tombstone
// when the socket dies. We remember the last {alive} beacon each connection
// published (x-tag = zone channel sig, d-tag = pubkey) and, on disconnect,
// synthesize + store + broadcast a {left:true} tombstone with created_at =
// now — guaranteed newer than the beacon, so NIP-33 eviction replaces it
// and every member drops the departed peer instantly instead of waiting out
// the ~90s beacon expiry.
//
// The synthesized event is UNSIGNED: the relay can't sign as the user, and a
// fresh created_at is required for correct eviction (a pre-signed will would
// carry a stale timestamp and lose to its own newer beacon). The swarm mesh
// client trusts relay delivery and does not re-verify; a lifecycle tombstone
// can only REMOVE a peer's tiles (never inject content), and a relay can
// already drop a peer's events, so this grants it no new power. If a client
// is ever hardened to verify signatures on receive, switch to a client-
// registered pre-signed WILL that is re-signed on every beacon.
const LIFECYCLE_KIND = 30206
const LIFECYCLE_WILL_TTL = 300  // seconds the synthesized tombstone lingers for late joiners

function lifecycleInfo(evt) {
  const tags = Array.isArray(evt.tags) ? evt.tags : []
  const x = tags.find((t) => Array.isArray(t) && t[0] === 'x')?.[1]
  const d = tags.find((t) => Array.isArray(t) && t[0] === 'd')?.[1]
  if (!x || !d) return null
  let left = false
  try { const c = JSON.parse(evt.content || '{}'); left = !!(c && c.left === true) } catch {}
  return { x: String(x), d: String(d), pubkey: String(evt.pubkey || ''), left }
}

// Arm (or disarm) a connection's last-will from its lifecycle events.
// {alive} arms the will; an explicit {left} disarms it (the client left
// gracefully — no need for the server to fire a duplicate on close).
function trackLifecycle(client, evt) {
  const info = lifecycleInfo(evt)
  if (!info || !info.pubkey) return
  const key = info.x + '\0' + info.d
  if (info.left) { client.lifecycle.delete(key); return }
  client.lifecycle.set(key, { x: info.x, d: info.d, pubkey: info.pubkey })
}

function computeEventId(evt) {
  // NIP-01 id: sha256 of the canonical serialization.
  const serial = JSON.stringify([0, evt.pubkey, evt.created_at, evt.kind, evt.tags, evt.content])
  return sha256Hex(Buffer.from(serial, 'utf8'))
}

function synthTombstone(xSig, dTag, pubkey, nowSec) {
  const tags = [['x', xSig], ['d', dTag], ['expiration', String(nowSec + LIFECYCLE_WILL_TTL)]]
  const content = JSON.stringify({ left: true })
  const evt = { pubkey, created_at: nowSec, kind: LIFECYCLE_KIND, tags, content }
  evt.id = computeEventId(evt)
  evt.sig = ''  // relay-synthesized last-will (see comment above)
  return evt
}

// Fire a connection's last-will on disconnect: one tombstone per zone the
// connection beaconed in. The closing socket is excluded from broadcast()
// (readyState check + sourceWs skip), so only the remaining members get it.
function fireWills(client) {
  if (!client.lifecycle || client.lifecycle.size === 0) return
  const nowSec = Math.floor(Date.now() / 1000)
  for (const { x, d, pubkey } of client.lifecycle.values()) {
    const tomb = synthTombstone(x, d, pubkey, nowSec)
    try { insertEvent(tomb) } catch {}
    broadcast(tomb, client.ws)
  }
  client.lifecycle.clear()
}

// One disconnect path for both 'close' and 'error' — guarded so the will
// fires at most once.
function handleDisconnect(client) {
  if (client.closed) return
  client.closed = true
  try { fireWills(client) } catch {}
  clients.delete(client)
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
    // Arm/disarm this connection's last-will from lifecycle beacons so we
    // can tombstone it server-side if the socket dies without a graceful
    // {left} (tab crash / kill — see fireWills).
    if (Number(evt.kind) === LIFECYCLE_KIND) trackLifecycle(client, evt)
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
  if (ext === '.ico')  return 'image/x-icon'
  if (ext === '.woff2') return 'font/woff2'
  if (ext === '.woff') return 'font/woff'
  if (ext === '.ttf')  return 'font/ttf'
  if (ext === '.wasm') return 'application/wasm'
  if (ext === '.map')  return 'application/json; charset=utf-8'
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
    // Flat heap — canonical. One bucket, sig-named files at the content
    // root, no extensions: the consumer knows the type (it holds the
    // referring layer), so the wire type is opaque bytes. New writes
    // (PUT /<sig>) land here; the typed pools below are the legacy
    // layout, kept as fallback during the migration.
    [join(root, sig), 'application/octet-stream'],
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
    let typedHit = false
    if (existsSync(resolved)) {
      try { typedHit = statSync(resolved).isFile() } catch { typedHit = false }
    }
    if (typedHit) {
      contentType = getContentType(resolved)
    } else {
      // Typed-shape MISS → probe the flat heap by the basename's sig.
      // Host-sync pushes land flat at `/<sig>`, but deployed clients
      // still running pre-flat brokers ask `/__resources__/<sig>` etc.
      // The URL carries identity only — serve the bytes from whichever
      // layout holds them (the mirror of resolveFlatSig's typed
      // fallback). Non-sig paths keep falling through (landing page).
      const base = urlPath.split('/').pop() || ''
      const m = base.match(/^([0-9a-f]{64})(?:\.(?:js|json))?$/i)
      if (!m) return false
      const hit = resolveFlatSig(m[1].toLowerCase())
      if (!hit) return false
      resolved = hit.path
      contentType = hit.contentType
    }
  }

  try {
    const bytes = readFileSync(resolved)
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': String(bytes.length),
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Permissions-Policy': PERMISSIONS_POLICY,
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
  // DEV ONLY: bypass writer-auth (sha256(body)===sig is still enforced by the
  // caller, so content can't be forged — only the WHO check is skipped).
  if (cfg.devOpenWrites) return { ok: true, pubkey: 'dev-open' }
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

// ── landing page (slim storage-host identity announcement) ───────────────────
//
// Under the full-split model the relay is a STORAGE + MESH host only. It
// serves `/<sig>` content and the WSS relay endpoint. It DOES NOT serve
// the installer SPA — that's the canonical project origin's job. A bare
// GET / hits this small landing page so a casual visitor knows what they
// landed on and where to find the actual installer.
//
// Why HTML instead of a plain text liveness message: the URL is in the
// participant's browser, not a curl pipe. Telling them "open the canonical
// installer at <link>" with the host's domain visible defends against
// "I forgot which host I'm at" / typosquatting / phishing. It's a 1KB
// HTML response, no scripts, no external resources.

const CANONICAL_INSTALLER_URL = 'https://diamondcoreprocessor.com'

function renderLandingHtml() {
  // Best-effort host identity — falls back to "this storage host" if we
  // can't resolve. Pure server-side, no JS, no tracking, no CSS that
  // pulls externally.
  const hostHint = ''  // intentionally left blank — host is in the URL bar
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>hypercomb storage host</title>
<style>
  :root { color-scheme: light dark; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    max-width: 32rem; margin: 4rem auto; padding: 0 1.5rem;
    line-height: 1.55;
  }
  h1 { font-size: 1.1rem; font-weight: 600; letter-spacing: 0.06em;
       text-transform: uppercase; opacity: 0.7; margin: 0 0 1.5rem; }
  p { margin: 0 0 1rem; opacity: 0.9; }
  .cta { display: inline-block; margin-top: 0.5rem; padding: 0.5rem 1rem;
         border: 1px solid currentColor; border-radius: 4px;
         text-decoration: none; font-weight: 600; }
  .small { font-size: 0.85rem; opacity: 0.6; margin-top: 2rem; }
  code { background: rgba(127,127,127,0.15); padding: 0.1rem 0.35rem;
         border-radius: 3px; font-size: 0.9em; }
</style>
</head>
<body>
<h1>hypercomb · storage host</h1>
<p>This domain is a <strong>storage and mesh host</strong> in the hypercomb network. It serves signature-addressed content and relays peer messages.</p>
<p>It does <strong>not</strong> run the installer. To use the network, open the installer:</p>
<p><a class="cta" href="${CANONICAL_INSTALLER_URL}" rel="noopener">${CANONICAL_INSTALLER_URL}</a></p>
<p class="small">Storage endpoint: <code>GET /&lt;sig&gt;</code> &nbsp;·&nbsp; Mesh endpoint: <code>wss://</code>${hostHint}</p>
</body>
</html>`
}

function tryLanding(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false
  let urlPath
  try { urlPath = decodeURIComponent((req.url || '').split('?')[0]) } catch { return false }
  // Only the root path serves the landing page. Anything else is 404 (the
  // request already failed the /<sig> + swarm-temp routes that come before).
  if (urlPath !== '/' && urlPath !== '/index.html') return false

  const html = renderLandingHtml()
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': String(Buffer.byteLength(html, 'utf8')),
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=3600',
    'Permissions-Policy': PERMISSIONS_POLICY,
    // CSP belt-and-suspenders: no inline scripts can run, no external
    // resources can load. The landing is pure static text.
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; script-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  })
  if (req.method === 'HEAD') { res.end(); return true }
  res.end(html)
  return true
}

// ── (removed: trySPA) ────────────────────────────────────────────────────────
//
// The web half of the one-app node: besides the mesh (WS), the content read
// (GET /<sig>) and the content write (PUT /<sig>), the host serves a built
// SPA — the DCP installer and/or the front end — so you can VISIT the
// installer on your own relay. Static files come from cfg.spaDir; any path
// that isn't a real file falls back to index.html (client-side routing).
// Opt-in: only active when --spa-dir / SPA_DIR is set.
//
// Routing precedence (see createServer): NIP-11 → /<sig> content → PUT →
// SPA. So sig URLs and the typed pools always win; the SPA only catches
// what's left (/, /index.html, hashed assets, app routes).

// trySPA was removed in the full-split refactor. The relay no longer serves
// installer code under any circumstances. See the landing handler above.

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

  // Landing page: bare GET / shows a small "this is a storage host, go to
  // the canonical installer" page. Returns true if handled (any GET on `/`
  // or `/index.html`). Falls through for other paths to the 404 below.
  if (tryLanding(req, res)) return

  // Anything else hitting this far is unrecognized — return 404 (don't
  // help fingerprinting beyond the absolute minimum).
  res.writeHead(404, {
    'Content-Type': 'text/plain',
    'Access-Control-Allow-Origin': '*',
    'Permissions-Policy': PERMISSIONS_POLICY,
  })
  res.end('not found')
})

const wss = new WebSocketServer({ server })

wss.on('connection', (ws, req) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown'
  const client = { ws, ip, authed: !authRequired, pubkey: null, challenge: null, subs: new Map(), lifecycle: new Map(), closed: false }

  if (authRequired) {
    client.challenge = makeChallenge()
    send(ws, ['AUTH', client.challenge])
  }

  clients.add(client)

  ws.on('message', (data) => handleMessage(client, String(data)))
  ws.on('close', () => handleDisconnect(client))
  ws.on('error', () => handleDisconnect(client))
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
  if (cfg.devOpenWrites) console.log('writes: OPEN (--dev-open-writes — sha256 verify only, NEVER use on a public host)')
  else if (writers.size > 0) console.log(`writes: enabled — ${writers.size} authorized writer pubkey(s) (NIP-98 + sha256 verify)`)
  else console.log('writes: disabled (no --writers / --pubkeys configured)')
  // Banner: slim storage-host announcement (no SPA — full-split model).
  // Visitors hitting `/` see the landing page → linked to canonical installer.
  console.log(`role: storage + mesh (slim host — installer code is canonical at ${CANONICAL_INSTALLER_URL})`)
})
