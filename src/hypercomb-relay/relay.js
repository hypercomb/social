#!/usr/bin/env node
// hypercomb-relay — minimal Nostr relay AND HTTP content host for private swarm meetings
// usage: node relay.js [--port 7777] [--pubkeys hex1,hex2] [--max-event-size 65536] [--content-dir ./content] [--writers hex1,hex2] [--max-body-bytes 52428800] [--replication-origins https://a.example,https://b.example] [--allow-private-sources]
//
// env fallbacks (used when the matching --flag is absent):
//   PORT             → port to listen on (Azure App Service injects this)
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
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { verifyEvent } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { verifyNip98 } from './http-auth.js'
import { blockedSourcesReason } from './address-guard.js'
import { contentDirectoryIO, HOST_PACKAGES_POOL, PUBLIC_POOL_ADDRESSES, parseReplicationRequest, publishReplicatedPackage, resolvePackageClosure, resolveSignatureClosure, resolveSignatureInventory } from './replicate.js'
import { ReceiptIndex } from './receipt-index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── cli ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const envPort = Number(process.env.PORT)
  const envContentDir = String(process.env.CONTENT_DIR ?? '').trim()
  const args = {
    port: Number.isFinite(envPort) && envPort > 0 ? envPort : 7777,
    pubkeys: null,
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
    // Replication destinations. `POST /replicate` asks THIS host to GET origins
    // the caller names, so the caller chooses where the host's socket goes.
    // Authorization answers who is asking, never where they pointed it.
    //
    // replicationOrigins: when non-empty, a source must match one of these
    // origins exactly (scheme + host + port). Empty means "any origin that
    // survives the address screen" — the same shape --writers uses, except an
    // empty set here widens rather than closes, because replication from the
    // open web is the ordinary case and an origin list is the operator's
    // tightening, not their opt-in.
    replicationOrigins: (() => {
      const value = String(process.env.REPLICATION_ORIGINS ?? '').trim()
      return value ? value.split(',').map(normalizeOrigin).filter(Boolean) : null
    })(),
    // DEV ONLY: let replication sources point into loopback / private / link-local
    // space. Off by default: otherwise an authorized writer can read the
    // operator's cloud metadata endpoint, admin ports and internal services
    // through a replication result. A dev relay pulling from 127.0.0.1 needs it;
    // a public host must never set it.
    allowPrivateSources: String(process.env.ALLOW_PRIVATE_SOURCES ?? '').trim() === '1',
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
    if (a === '--memory') continue  // accepted for old launch lines; memory is the only mode now
    if (a === '--dev-open-writes') { args.devOpenWrites = true; continue }
    if (a === '--allow-private-sources') { args.allowPrivateSources = true; continue }
    const next = argv[i + 1]
    if (a === '--port' && next) { args.port = Number(next); i++ }
    else if (a === '--pubkeys' && next) { args.pubkeys = next.split(',').map(normalizePubkey).filter(Boolean); i++ }
    else if (a === '--max-event-size' && next) { args.maxEventSize = Number(next); i++ }
    else if (a === '--content-dir' && next) { args.contentDir = resolve(next); i++ }
    else if (a === '--writers' && next) { args.writers = next.split(',').map(normalizePubkey).filter(Boolean); i++ }
    else if (a === '--max-body-bytes' && next) { args.maxBodyBytes = Number(next); i++ }
    else if (a === '--replication-origins' && next) { args.replicationOrigins = next.split(',').map(normalizeOrigin).filter(Boolean); i++ }
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

/** An allowed replication origin is scheme + host + port and nothing else —
 * a path would invite a caller to think a prefix was enforced when only the
 * ORIGIN can be. */
function normalizeOrigin(raw) {
  try {
    const url = new URL(String(raw).trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.origin
  } catch { return null }
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

// Origins a replication source may name. Empty = unrestricted (the address
// screen still applies); non-empty = an exact-origin allowlist.
const replicationOrigins = new Set(cfg.replicationOrigins || [])

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

// ── event store (memory only) ────────────────────────────────────────────────
//
// The relay is a MEETING POINT, not a store. Participants meet at a
// signature address; the bytes behind a signature travel between a HOST
// and a participant by replication, never through here. So the relay
// remembers only what rendezvous needs: replaceable slots (one per
// publisher + kind + d-tag, the newest wins) and expiring beacons — in
// process memory, gone on restart, nothing on disk. Every event the swarm
// publishes is one or the other. Ephemeral kinds (20000–29999) are
// broadcast to live subscribers and never kept at all.

const events = new Map()  // id → event
const slots = new Map()   // pubkey\0kind\0d → id of the replaceable event held

const isEphemeralKind = (kind) => kind >= 20000 && kind < 30000
const isAddressableKind = (kind) => kind >= 30000 && kind < 40000                       // one per pubkey+kind+d
const isReplaceableKind = (kind) => kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000)  // one per pubkey+kind
const tagValue = (evt, name) => (evt.tags || []).find((t) => Array.isArray(t) && t[0] === name)?.[1]
const dTagOf = (evt) => String(tagValue(evt, 'd') ?? '')
const expirationOf = (evt) => { const n = Number(tagValue(evt, 'expiration')); return Number.isFinite(n) && n > 0 ? n : 0 }
const slotKey = (evt, kind) => `${evt.pubkey}\0${kind}\0${isAddressableKind(kind) ? dTagOf(evt) : ''}`

// Returns the NIP-01 verdict: 'stored' | 'duplicate' | 'stale' | 'ephemeral'.
function insertEvent(evt) {
  const kind = Number(evt.kind)
  if (isEphemeralKind(kind)) return 'ephemeral'
  if (events.has(evt.id)) return 'duplicate'
  if (isAddressableKind(kind) || isReplaceableKind(kind)) {
    // NIP-01: exactly ONE event per slot — the newest; on equal created_at
    // the lowest id wins. The whole swarm wire model assumes this. A stale
    // republish never displaces the held slot.
    const key = slotKey(evt, kind)
    const heldId = slots.get(key)
    const held = heldId ? events.get(heldId) : undefined
    if (held && (held.created_at > evt.created_at || (held.created_at === evt.created_at && held.id < evt.id))) return 'stale'
    if (heldId) events.delete(heldId)
    slots.set(key, evt.id)
  }
  events.set(evt.id, { id: evt.id, pubkey: evt.pubkey, created_at: Number(evt.created_at), kind, tags: evt.tags, content: evt.content, sig: evt.sig })
  return 'stored'
}

// NIP-01 event shape, checked before the (expensive) signature. Every
// refusal is an OK false with a machine-readable prefix.
const HEX64 = /^[0-9a-f]{64}$/
const HEX128 = /^[0-9a-f]{128}$/
const FUTURE_SKEW_SECS = 15 * 60
function eventShapeError(evt) {
  if (!evt || typeof evt !== 'object') return 'invalid: event is not an object'
  if (!HEX64.test(String(evt.id))) return 'invalid: id must be 64 lowercase hex'
  if (!HEX64.test(String(evt.pubkey))) return 'invalid: pubkey must be 64 lowercase hex'
  if (!HEX128.test(String(evt.sig))) return 'invalid: sig must be 128 lowercase hex'
  if (!Number.isInteger(evt.kind) || evt.kind < 0 || evt.kind > 65535) return 'invalid: kind must be an integer 0–65535'
  if (!Number.isInteger(evt.created_at)) return 'invalid: created_at must be an integer'
  if (evt.created_at > Math.floor(Date.now() / 1000) + FUTURE_SKEW_SECS) return 'invalid: created_at is too far in the future'
  if (!Array.isArray(evt.tags) || !evt.tags.every((tag) => Array.isArray(tag) && tag.every((v) => typeof v === 'string'))) return 'invalid: tags must be an array of string arrays'
  if (typeof evt.content !== 'string') return 'invalid: content must be a string'
  return null
}

function newestEvent(pubkey, kind) {
  let best
  for (const evt of events.values()) {
    if (evt.pubkey !== pubkey || evt.kind !== kind) continue
    if (!best || evt.created_at > best.created_at) best = evt
  }
  return best
}

function queryEvents(filters) {
  const results = []
  const now = Math.floor(Date.now() / 1000)
  for (const f of filters) {
    const hits = []
    for (const evt of events.values()) {
      const exp = expirationOf(evt)
      if (exp && exp < now) continue  // NIP-40: never replay an expired beacon, even before the sweep
      if (matchFilter(f, evt)) hits.push(evt)
    }
    hits.sort((a, b) => b.created_at - a.created_at)
    results.push(...hits.slice(0, Math.min(f.limit ?? 500, 5000)))
  }
  return results
}

function deleteExpired() {
  const now = Math.floor(Date.now() / 1000)
  for (const [id, evt] of events) {
    const exp = expirationOf(evt)
    if (exp && exp < now) {
      events.delete(id)
      if ((isAddressableKind(evt.kind) || isReplaceableKind(evt.kind)) && slots.get(slotKey(evt, evt.kind)) === id) slots.delete(slotKey(evt, evt.kind))
    }
  }
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
  if (filter.since != null && evt.created_at < filter.since) return false
  if (filter.until != null && evt.created_at > filter.until) return false

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
  // NIP-42: the auth event must be fresh (±10 minutes). The relay tag is
  // not checked — behind a tunnel this process cannot know its public URL.
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(evt.created_at)) > 600) return false

  if (!cfg.pubkeys.includes(evt.pubkey)) return false
  return true
}

// ── connections ──────────────────────────────────────────────────────────────

const clients = new Set()
// A joined shell holds ~14 long-lived subscriptions (lifecycle, location,
// presence, follow, channels, broker broadcast, peer models, avatars,
// meeting, feedback) before a single image is requested — and every image
// a peer's layer references that isn't local yet opens one more. At 20 the
// cap was reached in ordinary use; the refusal was a NOTICE the client
// ignored, so the NEXT location a participant walked into was silently
// deaf until reload. 200 leaves an order of magnitude of headroom while
// still bounding one connection's share of the broadcast loop.
const MAX_SUBS_PER_CLIENT = 200
const MAX_SUBID_LENGTH = 64  // NIP-01

// ── subscription routing ─────────────────────────────────────────────────────
//
// Every swarm subscription is addressed by a signature in its `#x` filter —
// that IS the meeting point. So live fan-out is routed by that tag: an
// event is offered only to the subscriptions that asked for one of its
// `x` values, never to every subscription of every connection. A filter
// without `#x` (a generic Nostr client) lands in the catch-all and is
// checked against everything. Cost per event is the number of listeners
// at that address, not the number of listeners on the relay.

const subsByX = new Map()     // x value → Set<{ client, subId }>
const subsCatchAll = new Set() // { client, subId } for filters without #x

function xValuesOf(filters) {
  const xs = new Set()
  for (const f of filters) {
    const values = f['#x']
    if (!Array.isArray(values) || values.length === 0) return null  // one unaddressed filter → catch-all
    for (const v of values) xs.add(String(v))
  }
  return xs
}

function routeSubscription(client, subId, filters) {
  unrouteSubscription(client, subId)
  const entry = { client, subId }
  const xs = xValuesOf(filters)
  if (!xs) { subsCatchAll.add(entry); client.routes.set(subId, { entry, xs: null }); return }
  for (const x of xs) {
    let set = subsByX.get(x)
    if (!set) { set = new Set(); subsByX.set(x, set) }
    set.add(entry)
  }
  client.routes.set(subId, { entry, xs })
}

function unrouteSubscription(client, subId) {
  const route = client.routes.get(subId)
  if (!route) return
  client.routes.delete(subId)
  if (!route.xs) { subsCatchAll.delete(route.entry); return }
  for (const x of route.xs) {
    const set = subsByX.get(x)
    if (!set) continue
    set.delete(route.entry)
    if (set.size === 0) subsByX.delete(x)
  }
}

function broadcast(evt, sourceWs) {
  const candidates = new Set(subsCatchAll)
  for (const tag of evt.tags || []) {
    if (!Array.isArray(tag) || tag[0] !== 'x') continue
    const set = subsByX.get(String(tag[1]))
    if (set) for (const entry of set) candidates.add(entry)
  }
  for (const { client: c, subId } of candidates) {
    if (c.ws === sourceWs) continue
    if (c.ws.readyState !== 1) continue
    if (authRequired && !c.authed) continue
    const filters = c.subs.get(subId)
    if (filters && matchesAny(filters, evt)) {
      try { c.ws.send(JSON.stringify(['EVENT', subId, evt])) } catch {}
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
  for (const subId of [...client.routes.keys()]) unrouteSubscription(client, subId)
  try { fireWills(client) } catch {}
  clients.delete(client)
}

// NIP-01: every EVENT gets an OK, every refused REQ gets a CLOSED, and a
// NOTICE is only for what cannot be tied to either. Reasons carry the
// standard machine-readable prefix (duplicate:, rate-limited:, invalid:,
// error:, auth-required:) so clients act on them instead of reading prose.
function handleMessage(client, raw) {
  if (typeof raw !== 'string') return
  if (Buffer.byteLength(raw, 'utf8') > cfg.maxEventSize) {
    // Too big to parse in good conscience — but an EVENT still deserves its
    // OK, so pull the id out of the raw text when it is one.
    const id = raw.startsWith('["EVENT"') ? raw.match(/"id"\s*:\s*"([0-9a-f]{64})"/)?.[1] : undefined
    if (id) send(client.ws, ['OK', id, false, `invalid: message exceeds ${cfg.maxEventSize} bytes`])
    else send(client.ws, ['NOTICE', `error: message exceeds ${cfg.maxEventSize} bytes`])
    return
  }

  let msg
  try { msg = JSON.parse(raw) } catch { send(client.ws, ['NOTICE', 'error: invalid JSON']); return }
  if (!Array.isArray(msg) || msg.length < 1) { send(client.ws, ['NOTICE', 'error: invalid message']); return }

  const type = msg[0]

  if (!checkRate(client.ip)) {
    if (type === 'EVENT') send(client.ws, ['OK', msg[1]?.id ?? '', false, 'rate-limited: slow down'])
    else if (type === 'REQ') send(client.ws, ['CLOSED', String(msg[1] ?? ''), 'rate-limited: slow down'])
    else send(client.ws, ['NOTICE', 'rate-limited: slow down'])
    return
  }

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
    if (type === 'REQ') { send(client.ws, ['CLOSED', String(msg[1] ?? ''), 'auth-required: please authenticate']); return }
  }

  if (type === 'EVENT') {
    const evt = msg[1]
    const shape = eventShapeError(evt)
    if (shape) { send(client.ws, ['OK', HEX64.test(String(evt?.id)) ? evt.id : '', false, shape]); return }
    try { if (!verifyEvent(evt)) { send(client.ws, ['OK', evt.id, false, 'invalid: bad signature']); return } }
    catch { send(client.ws, ['OK', evt.id, false, 'invalid: verification error']); return }

    const verdict = insertEvent(evt)
    if (verdict === 'duplicate') { send(client.ws, ['OK', evt.id, true, 'duplicate: already have this event']); return }
    send(client.ws, ['OK', evt.id, true, ''])
    // A stale replaceable is accepted (the publisher did nothing wrong) but
    // not fanned out: subscribers already hold the newer slot.
    if (verdict !== 'stale') broadcast(evt, client.ws)
    // Arm/disarm this connection's last-will from lifecycle beacons so we
    // can tombstone it server-side if the socket dies without a graceful
    // {left} (tab crash / kill — see fireWills).
    if (Number(evt.kind) === LIFECYCLE_KIND) trackLifecycle(client, evt)
    return
  }

  if (type === 'REQ') {
    const subId = msg[1]
    if (typeof subId !== 'string' || !subId || subId.length > MAX_SUBID_LENGTH) { send(client.ws, ['CLOSED', String(subId ?? ''), `invalid: subscription id must be 1–${MAX_SUBID_LENGTH} characters`]); return }
    if (client.subs.size >= MAX_SUBS_PER_CLIENT && !client.subs.has(subId)) {
      // Loud on the relay side too — a silent refusal here is a deaf
      // participant who cannot tell why.
      console.warn(`[subs] refused REQ from ${client.ip} (${client.pubkey?.slice(0, 8) ?? 'anon'}): ${client.subs.size} open subscriptions`)
      send(client.ws, ['CLOSED', subId, `error: too many subscriptions (max ${MAX_SUBS_PER_CLIENT})`]); return
    }

    const filters = msg.slice(2)
    if (filters.length === 0 || !filters.every((f) => f && typeof f === 'object' && !Array.isArray(f))) { send(client.ws, ['CLOSED', subId, 'invalid: a REQ needs at least one filter object']); return }
    client.subs.set(subId, filters)
    routeSubscription(client, subId, filters)

    const events = queryEvents(filters)
    for (const evt of events) send(client.ws, ['EVENT', subId, evt])
    send(client.ws, ['EOSE', subId])
    return
  }

  if (type === 'CLOSE') {
    client.subs.delete(msg[1])
    unrouteSubscription(client, String(msg[1] ?? ''))
    return
  }
}

// ── http + websocket server ──────────────────────────────────────────────────

const relayInfo = {
  name: 'hypercomb-relay',
  description: 'Minimal Nostr relay for Hypercomb swarms',
  supported_nips: [1, 11, 33, 40, ...(authRequired ? [42] : [])],
  software: 'https://github.com/nicepkg/hypercomb',
  version: '0.1.0',
  limitation: {
    max_message_length: cfg.maxEventSize,
    max_subscriptions: MAX_SUBS_PER_CLIENT,
    max_subid_length: MAX_SUBID_LENGTH,
    max_limit: 5000,
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
// stat lands first. Returns { path, contentType } or null (→ 404).
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
  return null
}

const receiptIndex = new ReceiptIndex(cfg.contentDir, resolveFlatSig)

// ── GET/PUT /hive/<pubkey> — the signed index a publisher owns here ──────────
//
// A HOST THAT CARRIES BYTES BUT CANNOT SAY WHO SIGNED THEM IS NOT A HOST.
// Every atom on this machine is content-addressed and verifiable, but the one
// question replication cannot answer from bytes alone is "whose build is
// this" — and that answer lives in a publisher's signed index (kind 30564).
// Until now only the Cloudflare worker served it, so a participant carrying
// this relay alone could fetch every byte of a package and still be refused
// at the activation gate with nowhere to look (observed 2026-09-20:
// `jwize.com/hive/<pubkey>` 404 while `jwize.com/<sig>` answered 200).
//
// The index is an ordinary parameterized-replaceable event, so the relay
// already knows how to keep exactly one per publisher — `insertEvent` does the
// eviction and the staleness compare. This route is only the HTTP face of it.
//
// Auth mirrors the worker's: NIP-98 proves the CALLER, the body event proves
// the OWNER, and a PUT is admitted only when both are the SAME key. A relay
// operator's `--writers` list does not enter into it — a publisher's own index
// is theirs, and nobody else may move it.
const HIVE_INDEX_KIND = 30564

function tryServeHiveIndex(req, res) {
  const match = (req.url || '').split('?')[0].match(/^\/hive\/([0-9a-f]{64})$/)
  if (!match) return false
  const pubkey = match[1]

  if (req.method === 'GET' || req.method === 'HEAD') {
    const row = newestEvent(pubkey, HIVE_INDEX_KIND)
    if (!row) { respondText(res, 404, 'no index for this publisher'); return true }
    const body = JSON.stringify({
      kind: row.kind,
      created_at: row.created_at,
      tags: row.tags,
      content: row.content,
      pubkey: row.pubkey,
      id: row.id,
      sig: row.sig,
    })
    // NEVER CACHED. The whole point of an index is that it moves; a reader
    // holding a stale one is told about a build that is no longer offered.
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    })
    res.end(req.method === 'HEAD' ? undefined : body)
    return true
  }

  if (req.method !== 'PUT') return false

  readRequestBody(req, res, 64 * 1024, body => {
    // THE ONLY AUTHORIZED WRITER OF AN INDEX IS ITS OWNER. Passing the
    // address's own key as the writer set says precisely that, and reuses
    // every other NIP-98 check (freshness window, method, url and payload
    // hash) rather than re-implementing them here. The operator's --writers
    // list governs the content heap; it has no say over whose index this is.
    const auth = verifyNip98(req, new Set([pubkey]), { devOpen: false, payload: body })
    if (!auth.ok) { respondText(res, 401, auth.reason); return }
    let evt
    try { evt = JSON.parse(body.toString('utf8')) } catch { respondText(res, 400, 'not an event'); return }
    if (Number(evt?.kind) !== HIVE_INDEX_KIND) { respondText(res, 400, 'not a hive index'); return }
    const owner = String(evt?.pubkey ?? '').toLowerCase()
    // The caller, the body and the address must be one key. Any disagreement
    // is somebody moving an index that is not theirs.
    if (owner !== pubkey || auth.pubkey !== pubkey) { respondText(res, 403, 'an index is moved only by its own publisher'); return }
    if (!verifyEvent(evt)) { respondText(res, 400, 'signature does not verify'); return }
    try { insertEvent(evt) } catch (error) { respondText(res, 500, String(error?.message || error)); return }
    // insertEvent keeps the NEWER of the two, so read back what is actually
    // served rather than claiming the write landed.
    const now = newestEvent(pubkey, HIVE_INDEX_KIND)
    console.log(`[hive] index for ${pubkey.slice(0, 8)}… now at ${now?.created_at ?? 0}`)
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({ ok: true, pubkey, created_at: now?.created_at ?? 0 }))
  })
  return true
}

function tryServeContent(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') return false

  // CORS preflight — relays serve from <op>.domain, askers come from
  // other origins (hypercomb.io, alice.dev, etc.); blanket-permit — but a
  // door is told only the reads it may make, since every write refuses it.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': fromSandboxDoor(req) ? 'GET, HEAD, OPTIONS' : 'GET, HEAD, PUT, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, If-None-Match',
      'Access-Control-Max-Age': '86400',
    })
    res.end()
    return true
  }

  // Strip query string + decode
  let urlPath
  try { urlPath = decodeURIComponent((req.url || '').split('?')[0]) } catch { return false }
  if (!urlPath || urlPath === '/') return false
  // Receipt documents contain private, capability-like signatures. They are
  // reachable only through authenticated /receipts, never through the legacy
  // generic content-directory fallback below.
  if (urlPath === '/.receipts' || urlPath.startsWith('/.receipts/')) return false

  // ── the directory branch (documentation/pools-across-hosts.md) ──────────
  //
  // A POOL IS A DIRECTORY, AND A DIRECTORY IS A SET. `/<sig>` names a file —
  // one closure, forever, cacheable for a year. `/<sig>/` names a set, and
  // sets grow. Without this branch a host cannot answer "what do you carry
  // under this meaning" at all, which is why discovery kept reaching for a
  // named index file next to the content instead: `packages.json` was never a
  // second dialect, only a relay that could not readdir.
  //
  // The listing is entry NAMES and nothing else — never sizes, never
  // contents, nothing that could decide what a client installs. It is
  // `readdir` on the wire, not a document: newline-separated, so a static
  // host's ship can write byte-identical bytes at the same address.
  const dirMatch = urlPath.match(/^\/([0-9a-f]{64})\/$/)
  if (dirMatch) {
    // Only a PUBLIC pool is listed (replicate.js PUBLIC_POOL_ADDRESSES). Any
    // other directory, such as a history bag or a molecule pool, answers "not
    // held", the exact answer an absent pool gets, so the 404 reveals nothing.
    if (!PUBLIC_POOL_ADDRESSES.has(dirMatch[1])) { respondText(res, 404, 'pool not held'); return true }
    const dir = join(resolve(cfg.contentDir), dirMatch[1])
    let names
    try {
      if (!statSync(dir).isDirectory()) return false
      // `index.html` is the STATIC ship's rendering of this very listing —
      // the directory describing itself so a bucket with no readdir can answer
      // the same URL. It is not a member, on either host shape.
      names = readdirSync(dir).filter(n => n !== 'index.html' && !n.startsWith('.')).sort()
    } catch {
      // A PUBLIC pool this relay holds nothing under is an EMPTY listing, not
      // a 404: every follower derives the address and asks it, and a browser
      // prints every 404 to the console. The empty set is the true answer.
      names = []
    }
    const body = Buffer.from(names.join('\n'), 'utf8')
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': String(body.length),
      'Access-Control-Allow-Origin': '*',
      // A SET GROWS. The members are immutable; the membership is not.
      'Cache-Control': 'no-store',
      'Permissions-Policy': PERMISSIONS_POLICY,
    })
    if (req.method === 'HEAD') { res.end(); return true }
    res.end(body)
    return true
  }

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
    //
    // A MEMBER of a directory that is not a public pool (a history bag's
    // 00000000 marker, a molecule pool's entry) is read exactly as a path that
    // does not exist: the listing is gated above, and a guessable member name
    // must not be a second way in.
    const memberMatch = urlPath.match(/^\/([0-9a-f]{64})\/[^/]+$/)
    if (memberMatch && !PUBLIC_POOL_ADDRESSES.has(memberMatch[1])) {
      let isDir = false
      try { isDir = statSync(join(resolve(cfg.contentDir), memberMatch[1])).isDirectory() } catch { /* absent */ }
      if (isDir) return false
    }
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
    // WHEN A HOST RECEIVED IT, from the filesystem rather than from anything
    // anyone published. A pool entry carries the package signature and nothing
    // about time; the fact that this file arrived on Tuesday is the transport's
    // own, not a claim in a document, and every static host (S3, Pages, nginx)
    // already answers with it. It is the last thing the manifest was carrying
    // for the browse list.
    let lastModified = ''
    try { lastModified = statSync(resolved).mtime.toUTCString() } catch { /* unknowable */ }
    // IMMUTABLE MEANS SIG-ADDRESSED, AND NOTHING ELSE. A signature names one
    // closure forever, so those bytes can be pinned for a year. A NAMED file
    // — manifest.json, packages.json — is the domain's mutable voice: the one
    // thing on this wire that changes at the same URL. Serving those with the
    // sig header (which is what the typed-path branch used to do to
    // everything) invites any intermediary to pin a year-old view of what a
    // host publishes, which reads exactly like a host that stopped shipping.
    const sigAddressed = /[a-f0-9]{64}/i.test(urlPath)
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': String(bytes.length),
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': sigAddressed ? 'public, max-age=31536000, immutable' : 'no-store',
      ...(lastModified ? { 'Last-Modified': lastModified } : {}),
      'Access-Control-Expose-Headers': 'Last-Modified',
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

// ── doors write nothing (documentation/module-sandbox.md) ───────────────────
//
// A sandbox door — `try-<change>.<zone>` — runs its publisher's package with
// full page power, so a request whose Origin is a door never writes here: a
// signed PUT or POST from it (the visitor's own key through NIP-07, or one the
// package minted) would move this host as if the visitor's hive had. Reads
// stay open. The label is the content worker's SANDBOX_LABEL_RE
// (blossom-worker/worker.js), on any zone.
const SANDBOX_LABEL_RE = /^try-[a-z0-9](?:[a-z0-9-]{0,55}[a-z0-9])?$/

// An opaque origin (`Origin: null` — a sandboxed frame or data: worker the
// package opens) counts as a door too; no writer of ours sends it. Writes made
// from the browser stop here; a signature replayed from elsewhere is the
// extension prompt's to refuse (see the content worker's fromSandboxDoor).
function fromSandboxDoor(req) {
  const origin = req.headers.origin
  if (origin === 'null') return true
  try { return SANDBOX_LABEL_RE.test(new URL(String(origin)).hostname.split('.')[0]) } catch { return false }
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
  return verifyNip98(req, writers, { devOpen: cfg.devOpenWrites })
}

const replicationJobs = new Map()
const replicationResults = new Map()
function setReplicationResult(key, value) {
  replicationResults.delete(key)
  replicationResults.set(key, value)
  while (replicationResults.size > 1000) replicationResults.delete(replicationResults.keys().next().value)
}

function readRequestBody(req, res, maxBytes, done) {
  const chunks = []
  let size = 0
  let ended = false
  req.on('data', chunk => {
    if (ended) return
    size += chunk.length
    if (size > maxBytes) { ended = true; respondText(res, 413, 'body too large'); req.destroy(); return }
    chunks.push(chunk)
  })
  req.on('end', () => { if (!ended) done(Buffer.concat(chunks)) })
  req.on('error', () => { if (!ended) { ended = true; respondText(res, 400, 'request stream error') } })
}

function tryReplicate(req, res) {
  if (req.method !== 'POST' || (req.url || '').split('?')[0] !== '/replicate') return false
  readRequestBody(req, res, 64 * 1024, body => {
    const auth = verifyNip98(req, writers, { devOpen: cfg.devOpenWrites, payload: body })
    if (!auth.ok) { respondText(res, 401, auth.reason); return }
    let request
    try {
      request = parseReplicationRequest(JSON.parse(body.toString('utf8')), {
        allowedOrigins: replicationOrigins,
        allowPrivate: cfg.allowPrivateSources,
      })
    } catch (error) {
      respondText(res, 400, error?.message || 'invalid replication request'); return
    }
    // The caller names the destinations, so the host screens them before it
    // opens a socket: a source resolving into loopback, link-local, private or
    // CGNAT space is refused HERE, where the caller learns why, rather than
    // becoming an empty job whose holes read like an unreachable peer. A source
    // that does not resolve at all is NOT refused here — the answer is unknown
    // and `guardedLookup` screens it again at connect time, so a DNS blip stays
    // a retry instead of a rejection.
    blockedSourcesReason(request.sources, cfg.allowPrivateSources, replicationOrigins).then(blocked => {
      if (blocked) { respondText(res, 400, blocked); return }
      const key = `${auth.pubkey}:${request.signature}`
      const existing = replicationJobs.get(key)
      // Preserve one job per status identity. If a package request arrives
      // behind a generic/inventory walk, queue its FULL request (sources and
      // limit included) as a second delta pass. That avoids both status races
      // and a false 202 whose package intent inherited insufficient inputs.
      if (existing && request.package && !existing.packageRequest) existing.packageRequest = request
      if (!existing) {
        const entry = { packageRequest: request.package ? request : null, promise: null }
        setReplicationResult(key, { state: 'running', signature: request.signature, startedAt: new Date().toISOString() })
        const resolveRequest = async jobRequest => {
          const resolver = jobRequest.package
            ? resolvePackageClosure
            : jobRequest.inventory ? resolveSignatureInventory : resolveSignatureClosure
          const io = contentDirectoryIO(cfg.contentDir, jobRequest.sources, resolveFlatSig, {
            allowPrivate: cfg.allowPrivateSources,
            allowedOrigins: replicationOrigins,
          })
          return await resolver(jobRequest.signature, io, { limit: jobRequest.limit })
        }
        const job = (async () => {
          const receipted = new Set()
          let result = await resolveRequest(request)
          for (const signature of result.held) receipted.add(signature)

          // A package request attached to an earlier non-package job gets its
          // own structural walk with its own inputs. Atoms already landed make
          // this an inexpensive delta pass in the successful common case.
          const packageRequest = entry.packageRequest
          if (packageRequest && packageRequest !== request) {
            result = await resolveRequest(packageRequest)
            for (const signature of result.held) receipted.add(signature)
          }

          receiptIndex.add(auth.pubkey, receipted)
          const publication = publishReplicatedPackage(cfg.contentDir, packageRequest, result)
          setReplicationResult(key, {
            state: 'complete', completedAt: new Date().toISOString(), ...result,
            ...(packageRequest ? {
              package: {
                label: packageRequest.package.label,
                published: publication !== null,
                ...(publication ?? {}),
              },
            } : {}),
          })
          console.log(`[replicate] ${auth.pubkey.slice(0, 8)}… ${request.signature.slice(0, 12)}… fetched=${result.fetched} present=${result.present} holes=${result.holes.length} refused=${result.refused.length}${result.limited ? ' limited' : ''}${publication ? ` package=${publication.appended ? 'appended' : 'held'}:${publication.name}` : ''}`)
        })()
          .catch(error => {
            setReplicationResult(key, { state: 'failed', signature: request.signature, completedAt: new Date().toISOString(), error: String(error?.message || error) })
            console.error('[replicate] job failed:', error?.message || error)
          })
          .finally(() => replicationJobs.delete(key))
        entry.promise = job
        replicationJobs.set(key, entry)
      }
      res.writeHead(202, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({ accepted: true, signature: request.signature, running: !!existing }))
    }).catch(error => respondText(res, 500, `source screening failed: ${error?.message || error}`))
  })
  return true
}

function tryServeReplicationStatus(req, res) {
  if (req.method !== 'GET') return false
  const match = (req.url || '').split('?')[0].match(/^\/replicate\/([a-f0-9]{64})$/)
  if (!match) return false
  const auth = verifyNip98(req, writers, { devOpen: cfg.devOpenWrites })
  if (!auth.ok) { respondText(res, 401, auth.reason); return true }
  const result = replicationResults.get(`${auth.pubkey}:${match[1]}`)
  if (!result) { respondText(res, 404, 'replication job not found'); return true }
  const body = JSON.stringify(result)
  res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)), 'Cache-Control': 'private, no-store', 'Access-Control-Allow-Origin': '*', Vary: 'Authorization' })
  res.end(body)
  return true
}

// POST /forget — SECURE DELETE (documentation/remove-from-my-hosts.md). An
// authorized writer names sigs this host should stop holding. This relay has
// one owner, so ownership is not the question; what it must never lose is
// what its PUBLISHED PACKAGES need — every sig in the closure of a
// host:packages member is kept. Only flat atoms are removed (never a pool or
// a history bag), and their receipts go with them. Deleting is this host
// forgetting: anyone who already holds the bytes keeps them.
const FORGET_MAX = 1000

function tryForget(req, res) {
  if (req.method !== 'POST' || (req.url || '').split('?')[0] !== '/forget') return false
  const auth = verifyNip98(req, writers, { devOpen: cfg.devOpenWrites })
  if (!auth.ok) { respondText(res, 401, auth.reason); return true }
  const chunks = []
  let size = 0
  let aborted = false
  req.on('data', (c) => {
    if (aborted) return
    size += c.length
    if (size > 256 * 1024) { aborted = true; respondText(res, 413, 'body too large'); req.destroy(); return }
    chunks.push(c)
  })
  req.on('end', async () => {
    if (aborted) return
    let body
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { respondText(res, 400, 'body is not JSON'); return }
    const sigs = [...new Set((Array.isArray(body?.sigs) ? body.sigs : []).map(s => String(s || '').toLowerCase()))]
      .filter(s => /^[0-9a-f]{64}$/.test(s))
    if (sigs.length === 0) { respondText(res, 400, 'no sigs named'); return }
    if (sigs.length > FORGET_MAX) { respondText(res, 413, `at most ${FORGET_MAX} sigs per call`); return }

    const root = resolve(cfg.contentDir)
    const localIO = {
      read: async (sig) => { try { return readFileSync(join(root, sig)) } catch { return null } },
      fetch: async () => null,
      write: async () => { throw new Error('read-only walk') },
    }
    // What the published packages need is never forgotten.
    const keep = new Set()
    try {
      const poolDir = join(root, HOST_PACKAGES_POOL)
      for (const name of readdirSync(poolDir)) {
        if (!/^\d{8}$/.test(name)) continue
        const pkg = readFileSync(join(poolDir, name), 'utf8').split('\n')[0].trim().toLowerCase()
        if (!/^[0-9a-f]{64}$/.test(pkg)) continue
        const closure = await resolvePackageClosure(pkg, localIO)
        for (const sig of closure.held) keep.add(sig)
        keep.add(pkg)
      }
    } catch { /* no packages pool — nothing to protect */ }

    const removed = []
    const kept = {}
    for (const sig of sigs) {
      if (keep.has(sig)) { kept[sig] = 'package'; continue }
      const path = join(root, sig)
      let isFile = false
      try { isFile = statSync(path).isFile() } catch { /* absent */ }
      if (!isFile) { kept[sig] = 'not-held'; continue }
      try { rmSync(path); removed.push(sig) } catch { kept[sig] = 'locked' }
    }
    if (removed.length > 0) receiptIndex.forget(removed)
    const out = JSON.stringify({ removed, kept })
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(out)), 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' })
    res.end(out)
  })
  return true
}

function tryServeReceipts(req, res) {
  if (req.method !== 'GET' || (req.url || '').split('?')[0] !== '/receipts') return false
  const auth = verifyNip98(req, writers, { devOpen: cfg.devOpenWrites })
  if (!auth.ok) { respondText(res, 401, auth.reason); return true }
  const etag = receiptIndex.etag(auth.pubkey)
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, 'Cache-Control': 'private, no-cache', 'Access-Control-Allow-Origin': '*' }); res.end(); return true
  }
  const body = JSON.stringify(receiptIndex.document(auth.pubkey))
  res.writeHead(200, {
    'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)), ETag: etag,
    'Cache-Control': 'private, no-cache', 'Access-Control-Allow-Origin': '*', Vary: 'Authorization',
  })
  res.end(body)
  return true
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

  // writes land FLAT. The sig check below pins the BYTES; it says nothing about
  // the PLACE, and `mkdirSync(dirname(resolved), { recursive: true })` let an
  // authorised writer choose any directory under the content root — including
  // a pool's, whose members it could then shadow. An atom has one address:
  // `/<sig>`. A second segment is refused before auth is even consulted.
  const segments = urlPath.split('/').filter(Boolean)
  if (segments.length !== 1) { respondText(res, 400, 'an atom is written at /<sig> — no directory may be chosen'); return true }

  // writes must be sig-addressed: basename (minus .js/.json) must be a 64-hex sig
  const base = urlPath.split('/').pop() || ''
  const sig = base.replace(/\.(js|json)$/i, '').toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(sig)) { respondText(res, 400, 'target is not sig-addressed'); return true }
  // The pool's address has a known atom preimage (`host:packages`). Reserve it
  // on BOTH write paths even before the directory exists, or a valid direct
  // PUT could occupy the path and permanently prevent package publication.
  if (sig === HOST_PACKAGES_POOL) { respondText(res, 409, 'target is reserved for the host:packages pool'); return true }

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
      receiptIndex.add(auth.pubkey, [sig])
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
  // Doors write nothing — refused before any write route can run.
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS' && fromSandboxDoor(req)) {
    respondText(res, 403, 'a sandbox door writes nothing — do this from your own hive\n')
    return
  }

  // NIP-11 relay metadata (Accept: application/nostr+json)
  if (req.headers.accept?.includes('application/nostr+json')) {
    res.writeHead(200, { 'Content-Type': 'application/nostr+json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify(relayInfo))
    return
  }

  // Authenticated job status must precede the generic typed-path fallback.
  if (tryServeReplicationStatus(req, res)) return

  // The publisher's signed index — must precede the generic content branch,
  // which would otherwise treat /hive/<pubkey> as a path in the heap.
  if (tryServeHiveIndex(req, res)) return

  // Read side: GET/HEAD/OPTIONS content serving (returns true if handled)
  if (tryServeContent(req, res)) return

  if (tryServeReceipts(req, res)) return

  if (tryForget(req, res)) return

  if (tryReplicate(req, res)) return

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
  const client = { ws, ip, authed: !authRequired, pubkey: null, challenge: null, subs: new Map(), routes: new Map(), lifecycle: new Map(), closed: false }

  if (authRequired) {
    client.challenge = makeChallenge()
    send(ws, ['AUTH', client.challenge])
  }

  clients.add(client)

  client.alive = true
  ws.on('pong', () => { client.alive = true })
  ws.on('message', (data) => { client.alive = true; handleMessage(client, String(data)) })
  ws.on('close', () => handleDisconnect(client))
  ws.on('error', () => handleDisconnect(client))
})

// Keepalive. A connection whose TCP path died without a FIN (NAT expiry,
// a laptop lid, a tunnel that went away) stays readyState OPEN here
// forever: its subscriptions keep costing the broadcast loop and its
// lifecycle will never fires, so peers keep seeing a ghost. Ping every
// 30 s; a socket that answered nothing in a full interval is terminated,
// which runs the ordinary disconnect path.
const KEEPALIVE_MS = 30_000
setInterval(() => {
  for (const c of clients) {
    if (c.ws.readyState !== 1) continue
    if (!c.alive) { try { c.ws.terminate() } catch {} ; handleDisconnect(c); continue }
    c.alive = false
    try { c.ws.ping() } catch {}
  }
}, KEEPALIVE_MS)

// periodic cleanup
setInterval(deleteExpired, 60_000)

// graceful shutdown
function shutdown() {
  console.log('\nshutting down...')
  for (const c of clients) try { c.ws.close() } catch {}
  wss.close()
  server.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

// start
server.listen(cfg.port, () => {
  console.log(`hypercomb-relay listening on ws://0.0.0.0:${cfg.port} (WebSocket relay + HTTP content host)`)
  if (authRequired) console.log(`auth required — ${cfg.pubkeys.length} pubkey(s) whitelisted`)
  console.log('events: memory only — a meeting point, not a store')
  const contentReady = existsSync(cfg.contentDir)
  console.log(`content-dir: ${cfg.contentDir} ${contentReady ? '(ready)' : '(empty — host will 404 until populated)'}`)
  if (cfg.devOpenWrites) console.log('writes: OPEN (--dev-open-writes — sha256 verify only, NEVER use on a public host)')
  else if (writers.size > 0) console.log(`writes: enabled — ${writers.size} authorized writer pubkey(s) (NIP-98 + sha256 verify)`)
  else console.log('writes: disabled (no --writers / --pubkeys configured)')
  console.log(`replication sources: ${replicationOrigins.size ? `${replicationOrigins.size} allowed origin(s)` : 'any public origin'}`)
  if (cfg.allowPrivateSources) console.log('replication sources: PRIVATE ADDRESSES ALLOWED (--allow-private-sources — dev only, NEVER use on a public host)')
  // Banner: slim storage-host announcement (no SPA — full-split model).
  // Visitors hitting `/` see the landing page → linked to canonical installer.
  console.log(`role: storage + mesh (slim host — installer code is canonical at ${CANONICAL_INSTALLER_URL})`)
})
