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

// ── published application domains ───────────────────────────────────────────
//
// SITE_BINDINGS is operator configuration, never publisher content. It binds a
// hostname to the publisher keys allowed to appear there and the lineage each
// key contributes. DCP keeps publishing through the existing signed hive
// index; the website view is derived from that verified index on every read.
//
// { "pluginthematrix.com": {
//     "title":"Plugin the Matrix", "lineage":"pluginthematrix",
//     "publishers":[{"pubkey":"<64-hex>","label":"Jaime","primary":true}]
//   },
//   "revolucion.pluginthematrix.com": {
//     "title":"Revolución", "lineage":"revolucion",
//     "publishers":[{"pubkey":"<64-hex>","label":"Jaime","primary":true}]
// } }

function siteBindings(env) {
  let rawBindings
  try { rawBindings = JSON.parse(String(env.SITE_BINDINGS || '{}')) } catch { return {} }
  const bindings = {}
  for (const [rawHost, raw] of Object.entries(rawBindings || {})) {
    if (!raw || typeof raw !== 'object') continue
    const host = String(rawHost || '').trim().toLowerCase()
    const lineage = String(raw.lineage || '').split('/').map((s) => s.trim()).filter(Boolean).join('/')
    if (!host || !lineage) continue
    const publishers = (Array.isArray(raw.publishers) ? raw.publishers : [])
      .map((p) => ({
        pubkey: String(p?.pubkey || '').toLowerCase(),
        label: String(p?.label || '').trim(),
        primary: p?.primary === true,
      }))
      .filter((p) => SIG_RE.test(p.pubkey))
    bindings[host] = {
      title: String(raw.title || lineage.split('/').at(-1) || 'Published Hypercomb').trim(),
      lineage,
      publishers,
    }
  }
  return bindings
}

function siteBinding(env, hostname) {
  return siteBindings(env)[String(hostname || '').toLowerCase()] || null
}

// Publish IS the naming step: any first-level subdomain of a bound zone is an
// IMPLICIT site — lineage = the label, publishers = the zone's allowlist. No
// per-name configuration; a name goes live the moment an approved publisher's
// signed index carries a root for it, and says "nothing here" until then.
// content.<zone> stays the write/relay face and is never a site.
function resolveSite(env, hostname) {
  const host = String(hostname || '').toLowerCase()
  const bindings = siteBindings(env)
  const exact = bindings[host]
  if (exact) return { site: exact, implicit: false, zone: null }
  const zone = Object.keys(bindings).find(h => host !== h && host.endsWith('.' + h))
  if (!zone || host === `content.${zone}`) return { site: null, implicit: false, zone: zone ?? null }
  const label = host.slice(0, -(zone.length + 1))
  if (!label || label.includes('.')) return { site: null, implicit: false, zone }
  return {
    site: { title: label, lineage: label, publishers: bindings[zone].publishers },
    implicit: true,
    zone,
  }
}

async function anyPublishedRoot(env, site) {
  for (const publisher of site.publishers ?? []) {
    if (await publishedRoot(env, publisher, site.lineage)) return true
  }
  return false
}

function nothingHere(hostname, zone) {
  const name = zone ? hostname.slice(0, -(zone.length + 1)) : hostname
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>nothing here yet</title><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#0b1218;color:#dce7ef;font:16px/1.6 system-ui,sans-serif"><main style="text-align:center;padding:2rem"><h1 style="font-size:1.3rem;margin:0 0 .5rem">nothing published at ${name}${zone ? '.' + zone : ''}</h1><p style="opacity:.7;margin:0">Publishing a hive named “${name}” makes this address its website. <a href="https://${zone ?? hostname}/" style="color:#7eb6d6">${zone ?? hostname}</a></p></main>`,
    { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...CORS } },
  )
}

async function publishedRoot(env, publisher, lineage) {
  let evt
  try { evt = JSON.parse((await env.HIVES.get(publisher.pubkey)) ?? 'null') } catch { return null }
  if (!evt || Number(evt.kind) !== HIVE_KIND || evt.pubkey !== publisher.pubkey) return null
  if (!(await verifyEventSig(evt))) return null
  let content
  try { content = JSON.parse(evt.content) } catch { return null }
  const head = String(content?.roots?.[lineage] || '').toLowerCase()
  if (!SIG_RE.test(head)) return null
  return {
    head,
    pubkey: publisher.pubkey,
    label: publisher.label || publisher.pubkey.slice(0, 12) + '…',
    publishedAt: Number(evt.created_at || 0),
  }
}

async function serveSiteDescriptor(request, env, site) {
  const selected = String(new URL(request.url).searchParams.get('publisher') || '').toLowerCase()
  const allowed = selected
    ? site.publishers.find((p) => p.pubkey === selected)
    : site.publishers.find((p) => p.primary) || site.publishers[0]
  if (!allowed) return json(404, { error: 'no approved publisher is configured for this domain' }, { 'Cache-Control': 'no-store' })
  const publication = await publishedRoot(env, allowed, site.lineage)
  if (!publication) return json(404, { error: 'the approved publisher has not published this lineage yet' }, { 'Cache-Control': 'no-store' })
  return json(200, {
    title: site.title,
    pubkey: publication.pubkey,
    head: publication.head,
    lineage: site.lineage,
    segments: site.lineage.split('/'),
    hosts: [new URL(request.url).host],
    publishedAt: publication.publishedAt,
  }, { 'Cache-Control': 'no-store' })
}

async function servePublications(request, env) {
  const protocol = new URL(request.url).protocol
  const sites = await Promise.all(Object.entries(siteBindings(env)).map(async ([host, site]) => ({
    host,
    url: `${protocol}//${host}/`,
    title: site.title,
    lineage: site.lineage,
    publishers: await Promise.all(site.publishers.map(async (publisher) => {
      const publication = await publishedRoot(env, publisher, site.lineage)
      return {
        pubkey: publisher.pubkey,
        label: publisher.label || publisher.pubkey.slice(0, 12) + '…',
        primary: publisher.primary,
        head: publication?.head ?? null,
        publishedAt: publication?.publishedAt ?? null,
      }
    })),
  })))
  return json(200, { sites }, { 'Cache-Control': 'no-store' })
}

async function serveVisitorAsset(request, env) {
  if (!env.ASSETS?.fetch) return text(503, 'visitor engine is not deployed')
  let response = await env.ASSETS.fetch(request)
  if (response.status === 404) {
    const url = new URL(request.url)
    url.pathname = '/index.html'
    response = await env.ASSETS.fetch(new Request(url, request))
  }
  const headers = new Headers(response.headers)
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'")
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')
  headers.set('Referrer-Policy', 'no-referrer')
  headers.set('X-Content-Type-Options', 'nosniff')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

// ── responses ────────────────────────────────────────────────────────────────

// Permissive CORS on everything: content is public, uploaders come from any
// origin (hypercomb.io, operator domains, other Blossom clients).
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, PUT, POST, OPTIONS',
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
    // Header values are ByteStrings. Keep the UTF-8 prose in the body and an
    // ASCII-safe equivalent in BUD-06's HEAD/error channel.
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Reason': String(msg).replace(/[^\x20-\x7e]/g, '-'),
      ...CORS,
    },
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
    // The bytes are immutable but their MIME depends on what the REQUEST is
    // for (module imports get text/javascript) — cache per purpose.
    'Vary': 'Sec-Fetch-Dest',
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

// A name suffix (`/<sig>/chrome.css`) declares the PRESENTATION type the way
// a module import does: content-addressed storage holds most bytes as
// octet-stream, and with nosniff the browser refuses those as stylesheets or
// images. sha256 gating is unchanged — the extension only picks the MIME.
const SUFFIX_TYPES = {
  css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon',
  woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf',
  mp3: 'audio/mpeg', mp4: 'video/mp4', webm: 'video/webm', wav: 'audio/wav',
  txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8',
}
function suffixType(pathname) {
  const dot = pathname.lastIndexOf('.')
  if (dot < 0) return null
  return SUFFIX_TYPES[pathname.slice(dot + 1).toLowerCase()] ?? null
}

async function serveBlob(request, env, sig, typeOverride) {
  // If-None-Match short-circuit, no R2 op. Content-addressing makes this
  // unconditionally correct: an ETag match means the client's cached bytes
  // hash to the sig — they ARE the content, whatever this bucket holds.
  const inm = String(request.headers.get('if-none-match') || '')
  if (inm.replace(/^W\//, '').replace(/"/g, '').toLowerCase() === sig) {
    return new Response(null, { status: 304, headers: { 'ETag': `"${sig}"`, 'Cache-Control': IMMUTABLE, ...CORS } })
  }

  const headersFor = (obj, len) => {
    const h = blobHeaders(sig, obj, len)
    if (typeOverride) h['Content-Type'] = typeOverride
    return h
  }

  if (request.method === 'HEAD') {
    const head = await env.CONTENT.head(sig)
    if (!head) return text(404, 'sig not held')
    return new Response(null, { status: 200, headers: headersFor(head, head.size) })
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
      headers: { ...headersFor(object, length), 'Content-Range': `bytes ${offset}-${offset + length - 1}/${size}` },
    })
  }
  return new Response(object.body, { status: 200, headers: headersFor(object, object.size) })
}

// /content/<sig> — a signed module import from the visitor engine. The same
// immutable blob as the flat read, re-typed: ES modules are refused by the
// browser unless the response carries a JavaScript MIME, and content-addressed
// storage often holds them as octet-stream (or worse, the SPA fallback served
// index.html here). sha256 gating is unchanged — the type is presentation.
async function serveModule(request, env, sig) {
  // The deployed renderer package ships its modules as extension-less
  // content/<sig> asset files — served first (edge-cached), but with no
  // extension the asset host guesses no MIME at all. Fall back to the R2
  // heap for modules that arrive by publish rather than by deploy.
  let response = null
  if (env.ASSETS?.fetch) {
    // The renderer package ships its modules as content/<sig> asset files;
    // probe that shape regardless of which URL shape the import used, so
    // flat-root module imports find deploy-shipped modules too.
    const assetUrl = new URL(request.url)
    assetUrl.pathname = `/content/${sig}`
    response = await env.ASSETS.fetch(new Request(assetUrl, request))
  }
  if (!response || response.status === 404) response = await serveBlob(request, env, sig)
  if (response.status !== 200 && response.status !== 206 && response.status !== 304) return response
  const headers = new Headers(response.headers)
  headers.set('Content-Type', 'text/javascript; charset=utf-8')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
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

// ── host AI (the immediate-answer tier) ──────────────────────────────────────
//
// POST /ai/ask — the host FIELDS conversational requests so a participant can
// talk to their hive from anywhere and get an answer NOW, without their home
// server being awake. The worker relays to the Anthropic API (Haiku by
// default) and streams the reply straight through as SSE — first tokens in
// well under a second. This is the shallow immediate tier; the home Claude
// Code bridge (ws:2401, full agent) remains the deep one.
//
// Trust model mirrors the byte side — a schnorr-signed NIP-98 event proves
// WHO without secrets:
//   AI_WRITERS set   → allowlist (comma-separated pubkeys): only the
//                      operator's own keys may spend their API money.
//   AI_WRITERS unset → any valid signer, throttled by a per-pubkey per-day
//                      token meter in GRANTS KV (`ai:<pubkey>:<day>`). An
//                      anti-abuse ceiling, not billing — same doctrine as
//                      the byte quota.
//
// Context rides as CONTENT SIGS (signature doctrine — reference, never
// inline): the client names sigs already on this CDN; the worker resolves
// them from R2, inlines capped text, and the model sees the participant's
// actual content. Bytes never ride the request twice.
//
// The API key is a Wrangler secret, never a var:
//   wrangler secret put ANTHROPIC_API_KEY

const AI_Q_MAX = 4_000            // question chars
const AI_CTX_SIGS_MAX = 8         // context sigs per ask
const AI_CTX_EACH_MAX = 16_384    // bytes considered per context sig
const AI_CTX_TOTAL_MAX = 49_152   // total context chars inlined

function aiPolicy(env) {
  return {
    model: String(env.AI_MODEL || 'claude-haiku-4-5'),
    maxTokens: Number(env.AI_MAX_TOKENS || 1024),
    dailyTokens: Number(env.AI_DAILY_TOKENS || 100_000),
    writers: String(env.AI_WRITERS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean),
    system: String(env.AI_SYSTEM ||
      'You are the assistant of a Hypercomb hive host. Answer briefly and concretely. ' +
      'When tile content is provided as context, ground your answer in it.'),
  }
}

// Per-day token meter (estimate: chars/4 in + max_tokens reserved out).
// KV row auto-expires two days on so the ledger cleans itself.
async function aiAdmit(env, pubkey, estimate) {
  const p = aiPolicy(env)
  if (p.writers.length) {
    return p.writers.includes(pubkey)
      ? { ok: true, meter: null }
      : { ok: false, reason: 'this key is not on the AI writers list — ask the operator' }
  }
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const key = `ai:${pubkey}:${day}`
  let used = 0
  try { used = Number(JSON.parse((await env.GRANTS.get(key)) ?? '0')) || 0 } catch { used = 0 }
  if (used + estimate > p.dailyTokens) {
    return { ok: false, reason: 'daily AI allowance used up for this key — try again tomorrow' }
  }
  return { ok: true, meter: { key, used, estimate } }
}

async function aiConsume(env, meter) {
  if (!meter) return
  try {
    await env.GRANTS.put(meter.key, JSON.stringify(meter.used + meter.estimate), { expirationTtl: 172_800 })
  } catch { /* meter write raced — ceiling holds on next read */ }
}

// Resolve context sigs from the R2 heap into capped text blocks. Non-text or
// missing sigs are skipped silently — context is best-effort, the question
// always goes through.
async function aiContext(env, sigs) {
  const parts = []
  let total = 0
  for (const sig of sigs.slice(0, AI_CTX_SIGS_MAX)) {
    if (!SIG_RE.test(String(sig || ''))) continue
    let obj = null
    try { obj = await env.CONTENT.get(sig, { range: { offset: 0, length: AI_CTX_EACH_MAX } }) } catch { obj = null }
    if (!obj) continue
    let text = ''
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(await obj.arrayBuffer()) } catch { continue }
    if (!text.trim()) continue
    const room = AI_CTX_TOTAL_MAX - total
    if (room <= 0) break
    const clipped = text.slice(0, room)
    total += clipped.length
    parts.push(`--- context ${sig.slice(0, 12)}… ---\n${clipped}`)
  }
  return parts.length ? parts.join('\n\n') + '\n\n' : ''
}

async function aiAsk(request, env) {
  if (!env.ANTHROPIC_API_KEY) return text(503, 'AI is not configured on this host (missing ANTHROPIC_API_KEY secret)')

  const auth = await verifyNip98(request, parseAuthEvent(request), 'POST')
  if (!auth.ok) return text(401, auth.reason)

  let body
  try { body = await request.json() } catch { return text(400, 'body is not JSON') }
  const question = String(body?.question || '').trim()
  if (!question) return text(400, 'missing question')
  if (question.length > AI_Q_MAX) return text(413, `question too long (max ${AI_Q_MAX} chars)`)
  const sigs = Array.isArray(body?.context) ? body.context : []
  const wantStream = body?.stream !== false

  const p = aiPolicy(env)
  const context = await aiContext(env, sigs)
  const estimate = Math.ceil((question.length + context.length) / 4) + p.maxTokens
  const adm = await aiAdmit(env, auth.pubkey, estimate)
  if (!adm.ok) return text(429, adm.reason)

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: p.model,
      max_tokens: p.maxTokens,
      system: p.system,
      messages: [{ role: 'user', content: context + question }],
      stream: wantStream,
    }),
  })

  if (!upstream.ok) {
    // Never leak the upstream body verbatim (it may include request echoes);
    // status + a terse reason is enough for the client to display.
    return text(upstream.status === 429 ? 429 : 502, `AI upstream error (${upstream.status})`)
  }

  await aiConsume(env, adm.meter)

  if (wantStream) {
    // SSE passthrough — the client parses Anthropic's event shapes directly.
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-AI-Model': p.model,
        ...CORS,
      },
    })
  }
  return new Response(upstream.body, {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-AI-Model': p.model, ...CORS },
  })
}

// ── router ───────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const requestUrl = new URL(request.url)
    const { pathname } = requestUrl
    const method = request.method
    const { site, implicit, zone: siteZone } = resolveSite(env, requestUrl.hostname)

    // Application domains run Core with a narrower host capability profile.
    // The relay host may accept signed writes; a published Core host never
    // does. Keep this boundary above every mutation endpoint so adding another
    // relay feature cannot accidentally grant it to websites.
    if (site && method !== 'GET' && method !== 'HEAD') {
      return text(405, 'published Core hosts are read-only')
    }

    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

    // Flat sig endpoint — the canonical read: https://<host>/<sig>.
    // Lowercase 64-hex only; this bucket is flat from birth (no legacy
    // typed-dir layout ever lands here, so no fallback probing).
    // `/@resource/<sig>` is accepted as a READ alias: hypercomb clients
    // probe both URL shapes (the relay serves both), and without the alias
    // every @resource probe against this endpoint was a guaranteed 404 —
    // half the console-noise wall of 2026-07-16. Same object, same
    // immutable caching; reads only (writes stay on the canonical shapes).
    // An optional one-segment suffix (`/<sig>/chrome.css`) is a READ-ONLY
    // human name: pages authored in the hive reference shared chrome and art
    // as `resource:<sig>/<name>`, and the visitor rewrites those verbatim.
    // The bytes come from the sig alone; without this the suffixed form fell
    // through to the SPA asset handler, which 307'd to `/` and served the
    // page's stylesheet as index.html — the unstyled-website bug.
    const sigMatch = pathname.match(/^\/(?:(@resource)\/)?([0-9a-f]{64})(?:\/[^/]+)?$/)
    if (sigMatch) {
      const isAlias = !!sigMatch[1]
      const named = pathname.length > pathname.indexOf(sigMatch[2]) + 64
      if (method === 'GET' || method === 'HEAD') {
        // Everything serves from the root — one flat heap, one URL shape.
        // Content-addressed bytes carry no type, so the type comes from the
        // REQUEST: a module import declares itself (Sec-Fetch-Dest: script /
        // worker) and gets a JavaScript MIME; every other consumer gets the
        // stored type. No typed prefix needed for modules either.
        const dest = String(request.headers.get('sec-fetch-dest') || '').toLowerCase()
        if (dest === 'script' || dest === 'worker' || dest === 'sharedworker') {
          return serveModule(request, env, sigMatch[2])
        }
        return serveBlob(request, env, sigMatch[2], named ? suffixType(pathname) : null)
      }
      if (method === 'PUT' && !isAlias && !named) return putSig(request, env, sigMatch[2])
      return text(405, 'method not allowed')
    }

    if (!site && pathname === '/upload') {
      if (method === 'PUT') return putUpload(request, env)
      if (method === 'HEAD') return headUpload(request, env)
      return text(405, 'method not allowed')
    }

    if (!site && pathname === '/grant') {
      if (method === 'GET') return getGrant(request, env)
      return text(405, 'method not allowed')
    }

    // Host AI — the immediate conversational tier (see aiAsk above).
    if (!site && pathname === '/ai/ask') {
      if (method === 'POST') return aiAsk(request, env)
      return text(405, 'method not allowed')
    }

    // Hive pointer — the per-publisher path→head index (see putHive/getHive).
    const hiveMatch = pathname.match(/^\/hive\/([0-9a-f]{64})$/)
    if (hiveMatch) {
      if (method === 'GET' || method === 'HEAD') return getHive(request, env, hiveMatch[1])
      if (method === 'PUT') return putHive(request, env, hiveMatch[1])
      return text(405, 'method not allowed')
    }

    // A published application domain is a normal Core host over the same heap.
    // Machine endpoints expose only signed coordinates; EVERY human route,
    // including /revisions, receives the shared read-only engine.
    if (site && (method === 'GET' || method === 'HEAD')) {
      if (pathname === '/site.json') return serveSiteDescriptor(request, env, site)
      if (pathname === '/publications.json') return servePublications(request, env)
      // Signed module imports — the visitor engine maps bee/dependency
      // imports to /content/<sig>. Same immutable blob as the flat read,
      // but with a JavaScript MIME: browsers enforce strict MIME checks on
      // ES modules, and the SPA fallback was answering these with index.html
      // (an empty/HTML Content-Type), which bricked every module load.
      const moduleMatch = pathname.match(/^\/content\/([0-9a-f]{64})$/)
      if (moduleMatch) return serveModule(request, env, moduleMatch[1])
      // An implicit name is a website only once an approved publisher's
      // signed index carries its lineage — until then, an honest 404 page.
      if (implicit && !(await anyPublishedRoot(env, site))) {
        return nothingHere(requestUrl.hostname, siteZone)
      }
      return serveVisitorAsset(request, env)
    }

    // A zone subdomain that could not even become an implicit site (nested
    // label, garbled name): fail closed with a human answer, never the relay
    // banner. content.<zone> is exempt above — it IS the relay face.
    if (!site && siteZone && requestUrl.hostname !== `content.${siteZone}` && (method === 'GET' || method === 'HEAD')) {
      return nothingHere(requestUrl.hostname, siteZone)
    }

    // Bare / names the endpoint (relay.js landing instinct, one line).
    if (pathname === '/' && (method === 'GET' || method === 'HEAD')) {
      return text(200, 'hypercomb public content endpoint — GET /<sig> · Blossom BUD-01/02/06')
    }

    return text(404, 'not found')
  },
}
