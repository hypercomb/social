// nip98.js — who is asking, for the mail Worker. The same proof the relay takes (NIP-98: a signed
// event naming the method and the exact URL), minus anything a Worker does not need.
//
// Only a key that owns the mailbox is accepted: never a list of writers, never another mailbox's owner.
// An address may have more than one owner key (a person's second device, a recovery key kept offline),
// so `owner` is one hex key or a list of them; the answer names which one signed.

import { verifyEvent } from 'nostr-tools/pure'

const fromBase64Utf8 = text => new TextDecoder().decode(Uint8Array.from(atob(text), c => c.charCodeAt(0)))

// options.payload — the sha256 (hex) of the request body, for a request that carries one: the
// signed event must name it, so the body cannot be swapped after it was signed.
// options.anyKey — accept a valid signature from ANY key and say which it was, for the one question that has no
// address to own (`GET /mail/me`: which addresses does this key own?). Never set it for a route that returns or
// changes a mailbox — unless the caller then holds the answer's `pubkey` against the address's owners itself,
// which is how the Worker answers a real address and a ghost the same way, in the same time.
//
// The answer: { ok: true, pubkey, id, at, payloadTag } — id the event id (a write spends it once), at its
// created_at, payloadTag the sha256 it committed to (if any). A refusal is { ok: false, reason }, and once
// the signature itself has checked out it also says whose it was (`pubkey`), so the caller can keep the
// precise reason for the owner and give everyone else the same "not authorized".
export async function verifyNip98(request, { owner, anyKey = false, payload, now = Math.floor(Date.now() / 1000), skewSecs = 60 }) {
  const match = /^Nostr\s+(.+)$/i.exec(String(request.headers.get('authorization') || '').trim())
  if (!match) return { ok: false, reason: 'missing Nostr authorization header' }

  let event
  try { event = JSON.parse(fromBase64Utf8(match[1])) } catch { return { ok: false, reason: 'malformed auth token' } }
  try { if (!verifyEvent(event)) return { ok: false, reason: 'invalid signature' } } catch { return { ok: false, reason: 'invalid signature' } }
  const pubkey = String(event.pubkey || '').toLowerCase()
  const refuse = reason => ({ ok: false, reason, pubkey })
  if (Number(event.kind) !== 27235) return refuse('wrong auth event kind (expected NIP-98 27235)')
  const owners = (Array.isArray(owner) ? owner : [owner]).map(key => String(key || '').toLowerCase()).filter(Boolean)
  if (!anyKey && !owners.includes(pubkey)) return refuse('not authorized')
  if (Math.abs(now - Number(event.created_at || 0)) > skewSecs) return refuse('auth token outside freshness window')

  const tags = Array.isArray(event.tags) ? event.tags : []
  const tag = name => tags.find(value => Array.isArray(value) && value[0] === name)?.[1]
  if (String(tag('method') || '').toUpperCase() !== request.method.toUpperCase()) return refuse('auth method tag mismatch')
  let signed
  try { signed = new URL(String(tag('u') || '')) } catch { return refuse('invalid auth url tag') }
  if (signed.href !== new URL(request.url).href) return refuse('auth url tag mismatch')
  const payloadTag = tag('payload') === undefined ? undefined : String(tag('payload')).toLowerCase()
  if (payload !== undefined && payloadTag !== payload) return refuse('auth payload tag mismatch')
  return { ok: true, pubkey: event.pubkey, id: String(event.id), at: Number(event.created_at), payloadTag }
}
