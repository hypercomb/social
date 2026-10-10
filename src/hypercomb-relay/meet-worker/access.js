// access.js — the meeting point's door: the access code a dial carries, and
// the operator's signed recycle that replaces it (worker.js says why). Kept
// apart from worker.js because the Workers runtime takes only handlers and
// classes as that module's exports.

import { HEX64, sha256Hex, verifyEvent } from './meeting.js'

export const ACCESS_PREFIX = 'hc-access.'
export const CODE_PATH = '/.well-known/hc-meet/code'
export const ACCESS_REFUSED = 4401
const NIP98_KIND = 27235
const RECYCLE_SKEW_SECS = 60
// RFC 6455 subprotocols are tokens; a code is base64url (scripts/recycle-code.mjs).
const CODE_RE = /^[A-Za-z0-9_-]{16,128}$/

/** The access token a dial offered: the first `hc-access.<code>` among its
 *  subprotocols, echoed back verbatim (a browser fails a handshake whose
 *  answer names no protocol it offered). Null when it offered none. */
export function offeredAccess(header) {
  for (const raw of String(header || '').split(',')) {
    const token = raw.trim()
    if (token.startsWith(ACCESS_PREFIX)) return { token, code: token.slice(ACCESS_PREFIX.length) }
  }
  return null
}

/** Equal hex digests, compared without an early exit. */
export function sameDigest(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Is this a code at all — the shape any code the door could open has? */
export const wellFormedCode = (code) => typeof code === 'string' && CODE_RE.test(code)

/** Does this code open the door whose hash is `hash`? */
export function codeOpens(code, hash) {
  return !!hash && wellFormedCode(code) && sameDigest(sha256Hex(code), hash)
}

/** The answer to a dial that is not let in: accepted on the standard API (so
 *  it is never one of the object's sockets) and closed 4401 before a byte. The
 *  offered token is echoed — a browser fails a handshake that names none — and
 *  a browser can read a close code, never the status of a refused upgrade. */
export function refuseDial(offered, reason) {
  const [client, server] = Object.values(new WebSocketPair())
  server.accept()
  server.close(ACCESS_REFUSED, reason)
  return new Response(null, { status: 101, webSocket: client, headers: offered ? { 'Sec-WebSocket-Protocol': offered.token } : {} })
}

/** The operator keys, lowercase hex, from a comma/space separated env var. */
export function operatorKeys(env) {
  return new Set(String(env?.OPERATOR_KEYS || '').split(/[\s,]+/).map((k) => k.trim().toLowerCase()).filter((k) => HEX64.test(k)))
}

/** Authorization: Nostr <base64(event JSON)> → the event, or null. */
function authEvent(header) {
  const m = /^Nostr\s+(.+)$/i.exec(String(header || '').trim())
  if (!m) return null
  try { return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0)))) } catch { return null }
}

const tag = (evt, name) => (Array.isArray(evt?.tags) ? evt.tags : []).find((t) => Array.isArray(t) && t[0] === name)?.[1]

/**
 * Check a recycle request. NIP-98 (kind 27235) binds the method, the full URL
 * and — REQUIRED here — the body's hash, so a signed recycle cannot carry
 * another code. Freshness ±60 s, and `created_at` must be newer than the
 * recycle in force, so a captured older recycle cannot set a destroyed code
 * back. Returns { ok, pubkey, hash, at } or { ok: false, status, reason }.
 */
export function checkRecycle({ url, method, authorization, body, operators, nowSec, inForceAt = 0 }) {
  if (!operators.size) return { ok: false, status: 503, reason: 'no operator keys are configured (OPERATOR_KEYS)' }
  const evt = authEvent(authorization)
  if (!evt) return { ok: false, status: 401, reason: 'missing Nostr authorization' }
  if (Number(evt.kind) !== NIP98_KIND) return { ok: false, status: 401, reason: 'wrong auth event kind (expected NIP-98 27235)' }
  if (!HEX64.test(String(evt.pubkey)) || !verifyEvent(evt)) return { ok: false, status: 401, reason: 'invalid auth event signature' }
  if (Math.abs(nowSec - Number(evt.created_at)) > RECYCLE_SKEW_SECS) return { ok: false, status: 401, reason: 'auth outside its freshness window' }
  if (String(tag(evt, 'method') || '').toUpperCase() !== method) return { ok: false, status: 401, reason: 'auth method tag mismatch' }
  let signed
  try { signed = new URL(String(tag(evt, 'u'))).href } catch { return { ok: false, status: 401, reason: 'auth u tag is not a URL' } }
  if (signed !== new URL(url).href) return { ok: false, status: 401, reason: 'auth u tag does not match the request URL' }
  if (String(tag(evt, 'payload') || '').toLowerCase() !== sha256Hex(body)) return { ok: false, status: 401, reason: 'auth payload tag does not match the body' }
  if (!operators.has(evt.pubkey)) return { ok: false, status: 403, reason: 'not an operator of this meeting point' }
  if (Number(evt.created_at) <= inForceAt) return { ok: false, status: 409, reason: 'stale: a newer recycle is already in force' }
  let parsed
  try { parsed = JSON.parse(body) } catch { return { ok: false, status: 400, reason: 'body must be JSON' } }
  if (parsed?.close === true) return { ok: true, pubkey: evt.pubkey, hash: null, at: Number(evt.created_at) }
  const hash = String(parsed?.hash ?? '')
  if (!HEX64.test(hash)) return { ok: false, status: 400, reason: 'hash must be the 64-hex sha256 of the new code (or { "close": true })' }
  return { ok: true, pubkey: evt.pubkey, hash, at: Number(evt.created_at) }
}
