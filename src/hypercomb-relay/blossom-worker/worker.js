// hypercomb blossom-worker — the PUBLIC CONTENT ENDPOINT
// Cloudflare Worker speaking the Blossom dialect over an R2 bucket.
//
// Doctrine: swarms resolve around hosts; public content posts to the CDN.
// This is the CDN tier. A host (relay.js) is a participant's living edge —
// it captures, packages, serves, and can say no. The CDN tier is dumber and
// wider: an R2 bucket of sig-named blobs behind Cloudflare's edge, for
// content that is ALREADY public. Private and group content never lands
// here — it stays host-tier (see documentation/consent-hosting.md).
//
// The wire shape is Blossom (BUD-01/02/06) because hypercomb's flat
// `GET /<sig>` heap and Blossom's `GET /<sha256>` are the same URL — a
// signature IS a sha256 of the bytes. Where the dialects differ (upload
// auth), we accept both on their natural routes:
//
//   GET/HEAD /<sig>   open read — immutable, edge-cacheable, Range-capable
//   PUT /<sig>        hypercomb host-sync shape — NIP-98 (kind 27235)
//   PUT /upload       Blossom BUD-02 — kind 24242, t=upload
//   HEAD /upload      Blossom BUD-06 preflight — X-SHA-256/X-Content-Length
//
// Two guards on every write, independent (same doctrine as relay.js):
//   1. content-integrity — sha256(body) MUST equal the declared sig.
//      Bytes authenticate themselves; a forged sig is computationally
//      impossible. Idempotent: same sig == same bytes, so an existing
//      object returns 200 without a rewrite (dedup is free).
//   2. writer-authorization — a schnorr-signed nostr event proves WHO
//      without ever sending a secret. Instead of relay.js's static
//      --writers allowlist, this tier meters an auto-grant guest list:
//      KV GRANTS[pubkey] → { quotaBytes, usedBytes, expiresAt }.
//
// Never logs or echoes request bodies. Only dependency: @noble/curves
// (schnorr verify — wrangler bundles it).

import { schnorr } from '@noble/curves/secp256k1'

const SIG_RE = /^[0-9a-f]{64}$/
const NIP98_KIND = 27235      // NIP-98 HTTP auth (hypercomb host-sync PUTs)
const BLOSSOM_KIND = 24242    // Blossom BUD-02 upload auth
const HIVE_KIND = 30564       // hive index — publisher-signed {lineageKey → head sig} manifest
const AUTH_SKEW_SECS = 60     // freshness window — bounds replay of a captured token
const HIVE_MAX_BYTES = 65_536 // a hive index is a small map, never a byte store

// ── responses ────────────────────────────────────────────────────────────────

// Permissive CORS on everything: content is public, uploaders come from any
// origin (hypercomb.io, operator domains, other Blossom clients).
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range, X-SHA-256, X-Content-Length',
  'Access-Control-Expose-Headers': 'ETag, Accept-Ranges, Content-Range, Content-Length, X-Reason',
  'Access-Control-Max-Age': '86400',
}

// Immutable forever — content-addressed bytes can never change under a sig.
const IMMUTABLE = 'public, max-age=31536000, immutable'

// Plain-text response. The message rides X-Reason too (BUD-06's error
// channel — HEAD responses have no body, so the header carries the why).
function text(status, msg) {
  return new Response(msg + '\n', {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Reason': msg, ...CORS },
  })
}

function json(status, obj, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...extraHeaders },
  })
}

// ── crypto ───────────────────────────────────────────────────────────────────

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// NIP-01 event verification: id = sha256 of the canonical serialization,
// sig = BIP-340 schnorr over the id. Both checked — an event whose id
// doesn't match its own content is a forgery regardless of the signature.
async function verifyEventSig(evt) {
  if (!evt || typeof evt !== 'object') return false
  if (!SIG_RE.test(String(evt.pubkey || ''))) return false
  if (!/^[0-9a-f]{128}$/i.test(String(evt.sig || ''))) return false
  if (!Array.isArray(evt.tags) || typeof evt.content !== 'string') return false
  const serial = JSON.stringify([0, evt.pubkey, evt.created_at, evt.kind, evt.tags, evt.content])
  const id = await sha256Hex(new TextEncoder().encode(serial))
  if (String(evt.id || '').toLowerCase() !== id) return false
  try { return schnorr.verify(evt.sig, id, evt.pubkey) } catch { return false }
}

// ── auth events ──────────────────────────────────────────────────────────────

function tagValue(evt, name) {
  return (evt.tags.find((t) => Array.isArray(t) && t[0] === name) || [])[1]
}

function tagValues(evt, name) {
  return evt.tags.filter((t) => Array.isArray(t) && t[0] === name).map((t) => String(t[1] ?? ''))
}

// Authorization: Nostr <base64(event JSON)> — shared envelope for both
// dialects. base64 payload is UTF-8 (clients btoa an encodeURIComponent'd
// string), so decode bytes properly, not via raw atob charcodes-as-text.
function parseAuthEvent(request) {
  const header = String(request.headers.get('authorization') || '').trim()
  const m = /^Nostr\s+(.+)$/i.exec(header)
  if (!m) return null
  try {
    const raw = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(raw))
  } catch { return null }
}

// Dialect 1 — NIP-98 (kind 27235), the hypercomb host-sync shape.
// Binds method + full URL + freshness. The payload tag is verified WHEN
// PRESENT; the deployed HostSyncService signs only [u, method] tags, and
// the body is bound implicitly anyway — the URL sig == sha256(body) is
// enforced by the caller (same reasoning as relay.js's writer auth).
async function verifyNip98(request, evt, expectedMethod = 'PUT') {
  if (!evt) return { ok: false, reason: 'missing Nostr authorization header' }
  if (Number(evt.kind) !== NIP98_KIND) return { ok: false, reason: 'wrong auth event kind (expected NIP-98 27235)' }
  if (!(await verifyEventSig(evt))) return { ok: false, reason: 'invalid auth event signature' }
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - Number(evt.created_at || 0)) > AUTH_SKEW_SECS) return { ok: false, reason: 'auth token outside freshness window' }
  if (String(tagValue(evt, 'method') || '').toUpperCase() !== expectedMethod) return { ok: false, reason: 'auth method tag mismatch' }
  let signedUrl
  try { signedUrl = new URL(String(tagValue(evt, 'u'))).href } catch { return { ok: false, reason: 'auth u tag is not a URL' } }
  if (signedUrl !== new URL(request.url).href) return { ok: false, reason: 'auth u tag does not match request URL' }
  return { ok: true, pubkey: String(evt.pubkey).toLowerCase() }
}

// Dialect 2 — Blossom BUD-02 (kind 24242): t tag 'upload', at least one
// x tag equal to sha256(body), expiration in the future, created_at not
// in the future. One event may authorize several blobs (multiple x tags).
async function verifyBud02(evt, bodyHash) {
  if (!evt) return { ok: false, reason: 'missing Nostr authorization header' }
  if (Number(evt.kind) !== BLOSSOM_KIND) return { ok: false, reason: 'wrong auth event kind (expected Blossom 24242)' }
  if (!(await verifyEventSig(evt))) return { ok: false, reason: 'invalid auth event signature' }
  const now = Math.floor(Date.now() / 1000)
  if (Number(evt.created_at || 0) > now + AUTH_SKEW_SECS) return { ok: false, reason: 'auth event created_at is in the future' }
  if (!(Number(tagValue(evt, 'expiration') || 0) > now)) return { ok: false, reason: 'auth event expired (or missing expiration tag)' }
  if (!tagValues(evt, 't').includes('upload')) return { ok: false, reason: "auth event missing t tag 'upload'" }
  if (!tagValues(evt, 'x').map((x) => x.toLowerCase()).includes(bodyHash)) return { ok: false, reason: 'no x tag matches the sha256 of the upload' }
  return { ok: true, pubkey: String(evt.pubkey).toLowerCase() }
}

// ── quota (the auto-grant guest list) ────────────────────────────────────────
//
// GRANTS[pubkey] → { quotaBytes, usedBytes, expiresAt }. Policy via env:
//   AUTO_GRANT           '1' (default) mints a grant on first valid upload
//   DEFAULT_QUOTA_BYTES  104857600 (100 MB)
//   GRANT_TTL_DAYS       90
//
// The quota is an anti-abuse throttle, not billing: a malicious uploader
// can waste granted bytes, never corrupt a reader (every read is sha256-
// gated at the client). Existing-object PUTs consume nothing — the bytes
// are already here. Under AUTO_GRANT an EXPIRED grant re-mints fresh, same
// as an unknown pubkey: the guest list forgets you, it doesn't ban you.
// With AUTO_GRANT off, missing and expired both close the door (403).
//
// KV is eventually consistent and last-write-wins; two racing uploads can
// under-count briefly. Acceptable for a guest list — the ceiling holds on
// the next read.

function policy(env) {
  return {
    autoGrant: String(env.AUTO_GRANT ?? '1') === '1',
    defaultQuota: Number(env.DEFAULT_QUOTA_BYTES ?? 104_857_600),
    ttlDays: Number(env.GRANT_TTL_DAYS ?? 90),
  }
}

// Would this pubkey be allowed to store `size` more bytes? Returns the
// (possibly freshly minted, NOT yet persisted) grant on ok — persistence
// happens in consume(), only after bytes actually land.
async function admit(env, pubkey, size) {
  const p = policy(env)
  const now = Math.floor(Date.now() / 1000)
  let grant = null
  try { grant = JSON.parse((await env.GRANTS.get(pubkey)) ?? 'null') } catch { grant = null }
  const expired = !!grant && Number(grant.expiresAt || 0) <= now
  if (!grant || expired) {
    if (!p.autoGrant) {
      return {
        ok: false, kind: expired ? 'expired' : 'missing',
        reason: expired
          ? 'your hosting grant has expired — ask the operator for a renewal'
          : 'no hosting grant for this key and auto-grants are off — ask the operator for one',
      }
    }
    grant = { quotaBytes: p.defaultQuota, usedBytes: 0, expiresAt: now + p.ttlDays * 86_400 }
  }
  if (Number(grant.usedBytes || 0) + size > Number(grant.quotaBytes || 0)) {
    return { ok: false, kind: 'exhausted', reason: 'hosting quota used up — this key has no room left for new bytes' }
  }
  return { ok: true, grant }
}

async function consume(env, pubkey, grant, size) {
  grant.usedBytes = Number(grant.usedBytes || 0) + size
  await env.GRANTS.put(pubkey, JSON.stringify(grant))
}

// ── read side (BUD-01) ───────────────────────────────────────────────────────

function blobHeaders(sig, obj, contentLength) {
  return {
    'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
    'Content-Length': String(contentLength),
    'ETag': `"${sig}"`,
    'Accept-Ranges': 'bytes',
    'Cache-Control': IMMUTABLE,
    // Strangers' bytes must never become pages acting under this domain:
    // sandbox neuters scripts/forms/top-nav on anything a browser would
    // render (HTML/SVG/XML), nosniff stops type-guessing around it. Media,
    // JSON, and octet-stream consumers are unaffected — hive clients fetch
    // and hash-verify bytes; they never render this origin directly.
    'Content-Security-Policy': 'sandbox',
    'X-Content-Type-Options': 'nosniff',
    ...CORS,
  }
}

async function serveBlob(request, env, sig) {
  // If-None-Match short-circuit, no R2 op. Content-addressing makes this
  // unconditionally correct: an ETag match means the client's cached bytes
  // hash to the sig — they ARE the content, whatever this bucket holds.
  const inm = String(request.headers.get('if-none-match') || '')
  if (inm.replace(/^W\//, '').replace(/"/g, '').toLowerCase() === sig) {
    return new Response(null, { status: 304, headers: { 'ETag': `"${sig}"`, 'Cache-Control': IMMUTABLE, ...CORS } })
  }

  if (request.method === 'HEAD') {
    const head = await env.CONTENT.head(sig)
    if (!head) return text(404, 'sig not held')
    return new Response(null, { status: 200, headers: blobHeaders(sig, head, head.size) })
  }

  // Range per BUD-01: hand the Range header straight to R2; an
  // unsatisfiable/garbled range throws → 416 with the full size.
  const ranged = request.headers.has('range')
  let object
  try {
    object = await env.CONTENT.get(sig, ranged ? { range: request.headers } : undefined)
  } catch {
    const head = await env.CONTENT.head(sig)
    if (!head) return text(404, 'sig not held')
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${head.size}`, ...CORS } })
  }
  if (!object) return text(404, 'sig not held')

  if (ranged && object.range) {
    const size = object.size
    const offset = object.range.suffix != null ? size - object.range.suffix : (object.range.offset ?? 0)
    const length = object.range.suffix != null ? object.range.suffix : (object.range.length ?? size - offset)
    return new Response(object.body, {
      status: 206,
      headers: { ...blobHeaders(sig, object, length), 'Content-Range': `bytes ${offset}-${offset + length - 1}/${size}` },
    })
  }
  return new Response(object.body, { status: 200, headers: blobHeaders(sig, object, object.size) })
}

// ── write side ───────────────────────────────────────────────────────────────

// Shared store: existence → quota → put → meter. Returns a shape the two
// routes dress differently (plain text for /<sig>, BUD-02 descriptor for
// /upload). `size`/`type` reflect what the bucket holds after the call.
async function storeBlob(env, pubkey, sig, body, contentType) {
  const existing = await env.CONTENT.head(sig)
  if (existing) {
    // Same sig == same bytes — nothing to write, nothing to meter.
    return { outcome: 'exists', size: existing.size, type: existing.httpMetadata?.contentType || 'application/octet-stream' }
  }
  const adm = await admit(env, pubkey, body.byteLength)
  if (!adm.ok) return { outcome: 'denied', kind: adm.kind, reason: adm.reason }
  const type = contentType || 'application/octet-stream'
  await env.CONTENT.put(sig, body, { httpMetadata: { contentType: type } })
  await consume(env, pubkey, adm.grant, body.byteLength)
  return { outcome: 'stored', size: body.byteLength, type }
}

// PUT /<sig> — hypercomb host-sync shape (NIP-98). The URL names the
// content; sha256(body) must equal it.
async function putSig(request, env, sig) {
  const evt = parseAuthEvent(request)
  const auth = await verifyNip98(request, evt)
  if (!auth.ok) return text(401, auth.reason)

  const body = await request.arrayBuffer()
  const actual = await sha256Hex(body)
  if (actual !== sig) return text(400, `hash mismatch: sha256(body)=${actual.slice(0, 12)}… != ${sig.slice(0, 12)}…`)
  const payload = tagValue(evt, 'payload')
  if (payload != null && String(payload).toLowerCase() !== actual) return text(401, 'auth payload tag does not match body sha256')

  const stored = await storeBlob(env, auth.pubkey, sig, body, request.headers.get('content-type'))
  if (stored.outcome === 'denied') return text(403, stored.reason)
  if (stored.outcome === 'exists') return text(200, `already held ${sig}`)
  return text(201, `stored ${sig}`)
}

// PUT /upload — Blossom BUD-02. The x tag names the content; sha256(body)
// must be among the x tags. Responds with a blob descriptor either way
// (an existing blob is a successful upload that cost nothing).
async function putUpload(request, env) {
  const evt = parseAuthEvent(request)
  const body = await request.arrayBuffer()
  const sig = await sha256Hex(body)
  const auth = await verifyBud02(evt, sig)
  if (!auth.ok) return text(401, auth.reason)

  const stored = await storeBlob(env, auth.pubkey, sig, body, request.headers.get('content-type'))
  if (stored.outcome === 'denied') return text(403, stored.reason)
  return json(200, {
    url: new URL(request.url).origin + '/' + sig,
    sha256: sig,
    size: stored.size,
    type: stored.type,
    uploaded: Math.floor(Date.now() / 1000),
  })
}

// HEAD /upload — BUD-06 preflight: would this upload be accepted? Nothing
// is stored, no grant is minted (minting waits for real bytes). The verdict
// rides the status + X-Reason header (HEAD has no body).
async function headUpload(request, env) {
  const declared = String(request.headers.get('x-sha-256') || '').toLowerCase()
  if (!SIG_RE.test(declared)) return text(400, 'missing or malformed X-SHA-256 header')
  const size = Number(request.headers.get('x-content-length'))
  if (!Number.isFinite(size) || size < 0) return text(400, 'missing or malformed X-Content-Length header')

  const auth = await verifyBud02(parseAuthEvent(request), declared)
  if (!auth.ok) return text(401, auth.reason)

  if (await env.CONTENT.head(declared)) return text(200, 'already held — upload will be a no-op')
  const adm = await admit(env, auth.pubkey, size)
  if (!adm.ok) return text(adm.kind === 'exhausted' ? 413 : 403, adm.reason)
  return text(200, 'upload will be accepted')
}

// ── grant status (the quota meter) ───────────────────────────────────────────
//
// GET /grant, NIP-98-authenticated (method tag GET, u = this URL): a pubkey
// may read ITS OWN ledger row — nothing else, nobody else's. Reading never
// mints or mutates a grant; `state:'none'` with the default quota tells a
// fresh key what an auto-grant WOULD give it. Feeds the client's share-flow
// meter ("2.1 MB of 100 MB") and the plain-language over-quota moment.
async function getGrant(request, env) {
  const auth = await verifyNip98(request, parseAuthEvent(request), 'GET')
  if (!auth.ok) return text(401, auth.reason)
  const p = policy(env)
  const now = Math.floor(Date.now() / 1000)
  let grant = null
  try { grant = JSON.parse((await env.GRANTS.get(auth.pubkey)) ?? 'null') } catch { grant = null }
  const state = !grant ? 'none' : Number(grant.expiresAt || 0) <= now ? 'expired' : 'active'
  const body = state === 'active'
    ? { state, quotaBytes: Number(grant.quotaBytes || 0), usedBytes: Number(grant.usedBytes || 0), expiresAt: Number(grant.expiresAt || 0) }
    : { state, quotaBytes: p.autoGrant ? p.defaultQuota : 0, usedBytes: 0, expiresAt: null, autoGrant: p.autoGrant }
  return json(200, body, { 'Cache-Control': 'no-store' })
}

// ── hive pointers (path → head, one signed index per publisher) ──────────────
//
// GET/PUT /hive/<pubkey> — the ONE mutable object per publisher on an
// otherwise immutable heap: a schnorr-signed nostr event (kind 30564) whose
// content is {"v":1,"roots":{"<lineageKey>":"<headSig>", …}} mapping the
// publisher's PUBLIC lineage keys to their current sealed head sigs. This is
// the pointer that makes a statically-hosted hive live: bytes are already
// here under their sigs; the index says which sig is "now".
//
// Trust model mirrors the byte side: the event is signed by the pubkey in
// the path, so a client that pins the pubkey (it rides in the hive-link
// bundle) verifies the index END-TO-END — this worker, or any mirror
// serving the same JSON from a static file, can withhold an index but never
// forge one. Monotonic created_at closes the rollback hole: a replayed
// older index can never overwrite a newer one. Kept in its own KV namespace
// (HIVES) because R2 objects here are content-addressed and this is not.

function validHiveEventContent(evt) {
  let parsed
  try { parsed = JSON.parse(evt.content) } catch { return false }
  if (!parsed || typeof parsed !== 'object') return false
  const roots = parsed.roots
  if (!roots || typeof roots !== 'object' || Array.isArray(roots)) return false
  for (const [key, sig] of Object.entries(roots)) {
    if (typeof key !== 'string' || !key.trim()) return false
    if (!SIG_RE.test(String(sig || ''))) return false
  }
  return true
}

// PUT /hive/<pubkey> — NIP-98 proves the CALLER, the body event proves the
// INDEX. Both must be the path pubkey: a valid guest can't plant an index
// under someone else's key, and a leaked index event can't be replanted by
// a stranger (the NIP-98 envelope binds this URL + freshness).
async function putHive(request, env, pubkey) {
  const auth = await verifyNip98(request, parseAuthEvent(request))
  if (!auth.ok) return text(401, auth.reason)
  if (auth.pubkey !== pubkey) return text(403, 'auth pubkey does not match the hive being written')

  const body = await request.arrayBuffer()
  if (body.byteLength > HIVE_MAX_BYTES) return text(413, 'hive index too large')
  let evt
  try { evt = JSON.parse(new TextDecoder().decode(body)) } catch { return text(400, 'body is not a JSON nostr event') }
  if (Number(evt?.kind) !== HIVE_KIND) return text(400, `wrong event kind (expected hive index ${HIVE_KIND})`)
  if (String(evt?.pubkey || '').toLowerCase() !== pubkey) return text(403, 'index event pubkey does not match the hive being written')
  if (!(await verifyEventSig(evt))) return text(401, 'invalid index event signature')
  if (!validHiveEventContent(evt)) return text(400, 'index content is not {"v","roots":{lineageKey: sig}}')

  let stored = null
  try { stored = JSON.parse((await env.HIVES.get(pubkey)) ?? 'null') } catch { stored = null }
  if (stored) {
    if (String(stored.id || '') === String(evt.id || '')) return text(200, 'index already current')
    if (Number(evt.created_at || 0) <= Number(stored.created_at || 0)) {
      return text(409, 'a newer (or same-age) index is already held - refusing rollback')
    }
  }
  await env.HIVES.put(pubkey, JSON.stringify(evt))
  // NOTE: the message rides the X-Reason header (ByteString) — ASCII only.
  return text(stored ? 200 : 201, `hive index updated for ${pubkey.slice(0, 12)}...`)
}

// GET /hive/<pubkey> — open read, never cached: the whole point of the
// pointer is freshness. The client re-verifies the schnorr signature, so
// serving it needs no auth and grants no trust.
async function getHive(request, env, pubkey) {
  const raw = await env.HIVES.get(pubkey)
  if (raw == null) return text(404, 'no hive index for this key')
  return new Response(raw, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...CORS,
    },
  })
}

// ── router ───────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url)
    const method = request.method

    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

    // Flat sig endpoint — the canonical read: https://<host>/<sig>.
    // Lowercase 64-hex only; this bucket is flat from birth (no legacy
    // typed-dir layout ever lands here, so no fallback probing).
    // `/@resource/<sig>` is accepted as a READ alias: hypercomb clients
    // probe both URL shapes (the relay serves both), and without the alias
    // every @resource probe against this endpoint was a guaranteed 404 —
    // half the console-noise wall of 2026-07-16. Same object, same
    // immutable caching; reads only (writes stay on the canonical shapes).
    const sigMatch = pathname.match(/^\/(?:(@resource)\/)?([0-9a-f]{64})$/)
    if (sigMatch) {
      const isAlias = !!sigMatch[1]
      if (method === 'GET' || method === 'HEAD') return serveBlob(request, env, sigMatch[2])
      if (method === 'PUT' && !isAlias) return putSig(request, env, sigMatch[2])
      return text(405, 'method not allowed')
    }

    if (pathname === '/upload') {
      if (method === 'PUT') return putUpload(request, env)
      if (method === 'HEAD') return headUpload(request, env)
      return text(405, 'method not allowed')
    }

    if (pathname === '/grant') {
      if (method === 'GET') return getGrant(request, env)
      return text(405, 'method not allowed')
    }

    // Hive pointer — the per-publisher path→head index (see putHive/getHive).
    const hiveMatch = pathname.match(/^\/hive\/([0-9a-f]{64})$/)
    if (hiveMatch) {
      if (method === 'GET' || method === 'HEAD') return getHive(request, env, hiveMatch[1])
      if (method === 'PUT') return putHive(request, env, hiveMatch[1])
      return text(405, 'method not allowed')
    }

    // Bare / names the endpoint (relay.js landing instinct, one line).
    if (pathname === '/' && (method === 'GET' || method === 'HEAD')) {
      return text(200, 'hypercomb public content endpoint — GET /<sig> · Blossom BUD-01/02/06')
    }

    return text(404, 'not found')
  },
}
