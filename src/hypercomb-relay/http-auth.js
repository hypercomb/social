import { createHash } from 'node:crypto'
import { verifyEvent } from 'nostr-tools/pure'

export const payloadHash = bytes => createHash('sha256').update(bytes).digest('hex')

export function verifyNip98(req, writers, options = {}) {
  if (options.devOpen) return { ok: true, pubkey: 'dev-open' }
  if (!writers.size) return { ok: false, reason: 'writes not enabled (no authorized writers configured)' }
  const match = /^Nostr\s+(.+)$/i.exec(String(req.headers.authorization || '').trim())
  if (!match) return { ok: false, reason: 'missing Nostr authorization header' }
  let event
  try { event = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8')) } catch { return { ok: false, reason: 'malformed auth token' } }
  try { if (!verifyEvent(event)) return { ok: false, reason: 'invalid signature' } } catch { return { ok: false, reason: 'invalid signature' } }
  if (Number(event.kind) !== 27235) return { ok: false, reason: 'wrong auth event kind (expected NIP-98 27235)' }
  const pubkey = String(event.pubkey || '').toLowerCase()
  if (!writers.has(pubkey)) return { ok: false, reason: 'pubkey is not an authorized writer' }
  const now = options.now ?? Math.floor(Date.now() / 1000)
  if (Math.abs(now - Number(event.created_at || 0)) > 60) return { ok: false, reason: 'auth token outside freshness window' }
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
  return { ok: true, pubkey }
}
