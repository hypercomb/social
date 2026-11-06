// nip98.js — who is asking, for the mail Worker. The same proof the relay takes (NIP-98: a signed
// event naming the method and the exact URL), minus anything a Worker does not need.
//
// Only the key that owns the mailbox is accepted: not a list of writers, not another mailbox's owner.

import { verifyEvent } from 'nostr-tools/pure'

const fromBase64Utf8 = text => new TextDecoder().decode(Uint8Array.from(atob(text), c => c.charCodeAt(0)))

// options.payload — the sha256 (hex) of the request body, for a request that carries one: the
// signed event must name it, so the body cannot be swapped after it was signed.
// options.anyKey — accept a valid signature from ANY key and say which it was, for the one question that has no
// address to own (`GET /mail/me`: which addresses does this key own?). Never set it for a route that returns or
// changes a mailbox.
export async function verifyNip98(request, { owner, anyKey = false, payload, now = Math.floor(Date.now() / 1000), skewSecs = 60 }) {
  const match = /^Nostr\s+(.+)$/i.exec(String(request.headers.get('authorization') || '').trim())
  if (!match) return { ok: false, reason: 'missing Nostr authorization header' }

  let event
  try { event = JSON.parse(fromBase64Utf8(match[1])) } catch { return { ok: false, reason: 'malformed auth token' } }
  try { if (!verifyEvent(event)) return { ok: false, reason: 'invalid signature' } } catch { return { ok: false, reason: 'invalid signature' } }
  if (Number(event.kind) !== 27235) return { ok: false, reason: 'wrong auth event kind (expected NIP-98 27235)' }
  if (!anyKey && String(event.pubkey || '').toLowerCase() !== String(owner || '').toLowerCase()) return { ok: false, reason: 'not authorized' }
  if (Math.abs(now - Number(event.created_at || 0)) > skewSecs) return { ok: false, reason: 'auth token outside freshness window' }

  const tags = Array.isArray(event.tags) ? event.tags : []
  const tag = name => tags.find(value => Array.isArray(value) && value[0] === name)?.[1]
  if (String(tag('method') || '').toUpperCase() !== request.method.toUpperCase()) return { ok: false, reason: 'auth method tag mismatch' }
  let signed
  try { signed = new URL(String(tag('u') || '')) } catch { return { ok: false, reason: 'invalid auth url tag' } }
  if (signed.href !== new URL(request.url).href) return { ok: false, reason: 'auth url tag mismatch' }
  if (payload !== undefined && String(tag('payload') || '').toLowerCase() !== payload) return { ok: false, reason: 'auth payload tag mismatch' }
  return { ok: true, pubkey: event.pubkey }
}
