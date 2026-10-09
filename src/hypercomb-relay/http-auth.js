import { createHash } from 'node:crypto'
import { verifyEvent } from 'nostr-tools/pure'

export const payloadHash = bytes => createHash('sha256').update(bytes).digest('hex')

// options.allow(pubkey) — who may write, when the operator's writer list is not
// the whole answer (the relay's participants: a live swarm member uploading to
// the meeting's host). Absent, the answer is the writer list and nothing else,
// and an empty list means writes are off. options.skewSecs — the freshness
// window, ±60 s unless a route that can only ever re-store the same bytes asks
// for more. The result says which kind of key it was: 'writer' (listed) or
// 'participant' (admitted by allow). A key that is neither comes back
// `denied`, so the caller can say WHY it is not admitted, not just that.
export function verifyNip98(req, writers, options = {}) {
  if (options.devOpen) return { ok: true, pubkey: 'dev-open', role: 'writer' }
  const allow = typeof options.allow === 'function' ? options.allow : null
  if (!allow && !writers.size) return { ok: false, reason: 'writes not enabled (no authorized writers configured)' }
  const match = /^Nostr\s+(.+)$/i.exec(String(req.headers.authorization || '').trim())
  if (!match) return { ok: false, reason: 'missing Nostr authorization header' }
  let event
  try { event = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8')) } catch { return { ok: false, reason: 'malformed auth token' } }
  try { if (!verifyEvent(event)) return { ok: false, reason: 'invalid signature' } } catch { return { ok: false, reason: 'invalid signature' } }
  if (Number(event.kind) !== 27235) return { ok: false, reason: 'wrong auth event kind (expected NIP-98 27235)' }
  const pubkey = String(event.pubkey || '').toLowerCase()
  if (!(allow ? allow(pubkey) : writers.has(pubkey))) return { ok: false, denied: true, pubkey, reason: 'pubkey is not an authorized writer' }
  const now = options.now ?? Math.floor(Date.now() / 1000)
  const skewSecs = Number.isFinite(options.skewSecs) ? options.skewSecs : 60
  if (Math.abs(now - Number(event.created_at || 0)) > skewSecs) return { ok: false, reason: 'auth token outside freshness window' }
  const tags = Array.isArray(event.tags) ? event.tags : []
  const tag = name => tags.find(value => Array.isArray(value) && value[0] === name)?.[1]
  if (String(tag('method') || '').toUpperCase() !== String(req.method || '').toUpperCase()) return { ok: false, reason: 'auth method tag mismatch' }
  const signedUrl = String(tag('u') || '')
  let signed
  try { signed = new URL(signedUrl) } catch { return { ok: false, reason: 'invalid auth url tag' } }
  const authority = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim()
  const protocol = String(req.headers['x-forwarded-proto'] || (req.socket?.encrypted ? 'https' : 'http')).split(',')[0].trim()
  let actual
  try { actual = new URL(req.url || '/', `${protocol}://${authority}`) } catch { return { ok: false, reason: 'invalid request url' } }
  if (signed.href !== actual.href) return { ok: false, reason: 'auth url tag mismatch' }
  if (options.payload !== undefined && String(tag('payload') || '').toLowerCase() !== payloadHash(options.payload)) {
    return { ok: false, reason: 'auth payload tag mismatch' }
  }
  return { ok: true, pubkey, role: writers.has(pubkey) ? 'writer' : 'participant' }
}

// WHO IS ON THE OTHER END, as far as budgets are concerned. Behind the tunnel
// every socket's peer is cloudflared on loopback, and Cloudflare names the real
// client in CF-Connecting-IP — a header it overwrites, so the client cannot
// choose it. X-Forwarded-For's FIRST hop is the client's own claim and is never
// read: keyed on it, one device could spend a fresh budget per request. A peer
// that is NOT loopback reached this process directly, so its socket address is
// the answer and any header it sent is its own word, ignored.
export function requestIp(req) {
  const peer = String(req?.socket?.remoteAddress || '')
  if (isLoopback(peer)) {
    const cf = String(req.headers?.['cf-connecting-ip'] || '').trim()
    if (cf && cf.length <= 64) return cf
  }
  return peer || 'unknown'
}

function isLoopback(address) {
  return address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.')
}
