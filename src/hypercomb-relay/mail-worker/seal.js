// seal.js — mail is encrypted to its owners' keys before it is stored, so the bucket holds
// ciphertext and only a holder of one of those private keys can read it.
//
// Nostr's own encryption (NIP-44) takes at most 65,535 bytes, and a message can be far larger, so
// this is the usual two layers: the message is encrypted with a fresh one-time AES-256-GCM key K,
// and only K (32 bytes) is wrapped to each owner's Nostr key with NIP-44 — each wrap from its own
// fresh ephemeral key, so nothing ties two messages, or two owners of one message, together.
//
// ── Envelope v2 (what the Worker writes) ────────────────────────────────────────────────────────
//   envelope   = [4-byte big-endian header length][header JSON (UTF-8)][ciphertext]
//   header     = { v: 2, sig, iv, wraps: [ { to, epk, wk }, … ] }
//     sig        sha256 hex of the plaintext; the AES additionalData, and checked again after opening
//     iv         the 12-byte AES-GCM nonce, base64
//     wraps      one per owner key (at most 3):
//       to         the owner's public key (hex) — so a reader finds its own wrap without guessing
//       epk        a fresh ephemeral public key (hex), one per wrap
//       wk         nip44.encrypt(base64(K), getConversationKey(ephemeralSecret, to))
//   ciphertext = AES-256-GCM(plain, K, iv, additionalData = UTF-8(sig))   (the 16-byte tag at its end)
//
//   The R2 object's customMetadata (all strings), so an inbox lists in one request:
//     at     arrival time, ms since the epoch
//     v      "2"
//     wraps  JSON.stringify(wraps) — the same wraps as the header
//     meta   base64(iv2) + "." + base64(AES-256-GCM(UTF-8 JSON meta, K, iv2, additionalData = UTF-8("meta:" + sig)))
//            iv2 a second fresh 12-byte nonce; K is the message's own key. The sig in the additionalData ties
//            the list line to its own object: copied onto another sig it no longer opens. (Objects sealed
//            before this used the bare "meta"; a reader tries "meta:<sig>" first, then "meta" — H3.)
//
// ── Envelope v1 (older objects in the live bucket; opened forever, never written again: H3) ────
//   header = { v: 1, sig, epk, wk, iv }        one owner, one wrap, the same AES layer
//   customMetadata = { at, meta: "<epk hex>.<nip44.encrypt(JSON meta, conversationKey)>" }
//
// The list metadata is bounded by R2's 2 KB customMetadata cap, which is why an address may have at
// most 3 keys: three wraps take ~1 KB, and fitMeta() keeps the sealed meta inside what remains.

import * as nip44 from 'nostr-tools/nip44'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'

const enc = new TextEncoder()
const dec = new TextDecoder()

export const MAX_RECIPIENT_KEYS = 3
// R2 counts customMetadata as the UTF-8 bytes of every key and value; it refuses more than 2048.
export const R2_METADATA_LIMIT = 2048
// The JSON meta may take this many UTF-8 bytes. With three wraps (~982 chars of JSON), the four key
// names, `at` and `v`, a meta JSON of 720 bytes seals to a token of ~1,000 chars: ~2,010 in all.
export const META_JSON_BUDGET = 720

const toHex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
export const toBase64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s) }
export const fromBase64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0))

export async function sha256Hex(bytes) {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
}

/** The UTF-8 size R2 charges for a customMetadata object. */
export const metadataBytes = customMetadata =>
  Object.entries(customMetadata).reduce((n, [k, v]) => n + enc.encode(k).length + enc.encode(String(v)).length, 0)

const aes = async (raw, usage) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [usage])

function frame(header, body) {
  const head = enc.encode(JSON.stringify(header))
  const envelope = new Uint8Array(4 + head.length + body.length)
  new DataView(envelope.buffer).setUint32(0, head.length)
  envelope.set(head, 4)
  envelope.set(body, 4 + head.length)
  return envelope
}

function unframe(envelope) {
  if (envelope.length < 4) throw new Error('malformed envelope')
  const headerLength = new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength).getUint32(0)
  if (4 + headerLength > envelope.length) throw new Error('malformed envelope')
  return { header: JSON.parse(dec.decode(envelope.subarray(4, 4 + headerLength))), body: envelope.subarray(4 + headerLength) }
}

const recipientsOf = value => {
  const list = [...new Set((Array.isArray(value) ? value : [value]).map(k => String(k ?? '').toLowerCase()))]
  if (!list.length || list.some(k => !/^[a-f0-9]{64}$/.test(k))) throw new Error('bad recipient key')
  if (list.length > MAX_RECIPIENT_KEYS) throw new Error(`at most ${MAX_RECIPIENT_KEYS} recipient keys`)
  return list
}

// Shrinks the meta until its JSON fits the budget, giving up the least useful things first: the
// preview (it is only a glance), then the oldest references, then the date, then the subject's tail
// down to 40 characters, then the threading ids (the body still carries them), then the rest of the
// subject and the names. A field is dropped whole rather than cut where cutting would corrupt it (a
// Message-ID cut short threads nothing).
export function fitMeta(meta, budget = META_JSON_BUDGET) {
  const out = { ...meta }
  if (Array.isArray(out.references)) out.references = [...out.references]
  const size = () => enc.encode(JSON.stringify(out)).length
  const shrink = (field, floor = 0) => { while (size() > budget && typeof out[field] === 'string' && out[field].length > floor) out[field] = out[field].slice(0, Math.max(floor, out[field].length - 8)) }
  shrink('preview')
  if (out.preview === '') delete out.preview
  while (size() > budget && Array.isArray(out.references) && out.references.length) out.references.shift()
  if (Array.isArray(out.references) && !out.references.length) delete out.references
  if (size() > budget) delete out.date
  shrink('subject', 40)
  for (const field of ['id', 'inReplyTo', 'messageId']) if (size() > budget) delete out[field]
  shrink('subject', 1)
  shrink('from', 1)
  shrink('to', 1)
  return out
}

/**
 * Seals `plain` to one owner key or a list of them (hex, at most 3), with the list metadata.
 * Answers { sig, envelope, wraps, customMetadata, metaToken } — customMetadata goes on the R2 object
 * as it is; metaToken is customMetadata.meta.
 */
export async function sealMessage(plain, recipients, meta = {}) {
  const keys = recipientsOf(recipients)
  const sig = await sha256Hex(plain)
  const raw = crypto.getRandomValues(new Uint8Array(32))
  const wrapped = toBase64(raw)
  const wraps = keys.map(to => {
    const ephemeral = generateSecretKey()
    return { to, epk: getPublicKey(ephemeral), wk: nip44.encrypt(wrapped, nip44.getConversationKey(ephemeral, to)) }
  })

  const key = await aes(raw, 'encrypt')
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(sig) }, key, plain))
  const envelope = frame({ v: 2, sig, iv: toBase64(iv), wraps }, body)

  // The budget is sized for three wraps and the worst meta the Worker clips to; should anything still
  // overflow R2's cap, the meta is fitted tighter until it lands, so a put never fails on metadata.
  const base = { at: String(meta?.at ?? Date.now()), v: '2', wraps: JSON.stringify(wraps) }
  for (let budget = META_JSON_BUDGET; ; budget -= 64) {
    const iv2 = crypto.getRandomValues(new Uint8Array(12))
    const sealedMeta = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv2, additionalData: enc.encode(`meta:${sig}`) }, key, enc.encode(JSON.stringify(fitMeta(meta ?? {}, Math.max(budget, 0)))),
    ))
    const metaToken = `${toBase64(iv2)}.${toBase64(sealedMeta)}`
    const customMetadata = { ...base, meta: metaToken }
    if (metadataBytes(customMetadata) <= R2_METADATA_LIMIT || budget <= 0) return { sig, envelope, wraps, customMetadata, metaToken }
  }
}

/**
 * Seals the list line the way v2 did before it was bound to the sig (additionalData "meta"), so the
 * tests can prove such objects still open. The Worker never calls it.
 */
export async function sealMetaUnbound(raw, meta) {
  const iv2 = crypto.getRandomValues(new Uint8Array(12))
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv2, additionalData: enc.encode('meta') }, await aes(raw, 'encrypt'), enc.encode(JSON.stringify(meta))))
  return `${toBase64(iv2)}.${toBase64(sealed)}`
}

/**
 * The v1 sealer, kept so the tests can prove older objects still open. The Worker never calls it.
 * Answers { sig, envelope, metaToken, customMetadata } in the v1 layout.
 */
export async function sealMessageV1(plain, recipientPub, meta = {}) {
  const sig = await sha256Hex(plain)
  const ephemeral = generateSecretKey()
  const epk = getPublicKey(ephemeral)
  const wrapKey = nip44.getConversationKey(ephemeral, recipientPub)
  const raw = crypto.getRandomValues(new Uint8Array(32))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(sig) }, await aes(raw, 'encrypt'), plain))
  const envelope = frame({ v: 1, sig, epk, wk: nip44.encrypt(toBase64(raw), wrapKey), iv: toBase64(iv) }, body)
  const metaToken = `${epk}.${nip44.encrypt(JSON.stringify(meta ?? {}), wrapKey)}`
  return { sig, envelope, metaToken, customMetadata: { at: String(meta?.at ?? Date.now()), meta: metaToken } }
}

/**
 * K, from the wraps, with an owner's secret key (32 bytes). The owner's own wrap is tried first (by
 * `to`); failing that every wrap is tried, so a wrap whose `to` was mislabelled still opens.
 */
export function unwrapKey(wraps, ownerSecret) {
  const list = typeof wraps === 'string' ? JSON.parse(wraps) : wraps
  if (!Array.isArray(list) || !list.length) throw new Error('malformed wraps')
  const me = getPublicKey(ownerSecret)
  const ordered = [...list.filter(w => w?.to === me), ...list.filter(w => w?.to !== me)]
  for (const wrap of ordered) {
    try { return fromBase64(nip44.decrypt(wrap.wk, nip44.getConversationKey(ownerSecret, wrap.epk))) } catch { /* not ours */ }
  }
  throw new Error('no wrap opens with this key')
}

/** Opens a v1 or v2 envelope with an owner's secret key (32 bytes). Throws on any tampering. */
export async function openMessage(envelope, ownerSecret) {
  const { header, body } = unframe(envelope)
  let raw
  if (header.v === 2) raw = unwrapKey(header.wraps, ownerSecret)
  else if (header.v === 1) raw = fromBase64(nip44.decrypt(header.wk, nip44.getConversationKey(ownerSecret, header.epk)))
  else throw new Error('unknown envelope version')
  const bytes = new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(header.iv), additionalData: enc.encode(header.sig) }, await aes(raw, 'decrypt'), body,
  ))
  if (await sha256Hex(bytes) !== header.sig) throw new Error('signature mismatch')
  return { sig: header.sig, bytes }
}

/**
 * Opens the list metadata (always a promise). Takes a v1 token string, or anything carrying `meta`
 * and `wraps` (an R2 customMetadata, or a list item `{ sig, v, meta, wraps }` where wraps may be the
 * array or its JSON); an object without wraps is read as v1. A v2 meta is bound to its message's sig:
 * from a list item it is `item.sig`; for a bare customMetadata pass it as the third argument.
 */
export async function openMeta(source, ownerSecret, sig = source?.sig) {
  const token = typeof source === 'string' ? source : String(source?.meta ?? '')
  const wraps = typeof source === 'string' ? undefined : source?.wraps
  const dot = token.indexOf('.')
  if (dot < 1) throw new Error('malformed metadata')
  if (wraps === undefined || wraps === null || wraps === '') {
    return JSON.parse(nip44.decrypt(token.slice(dot + 1), nip44.getConversationKey(ownerSecret, token.slice(0, dot))))
  }
  const key = await aes(unwrapKey(wraps, ownerSecret), 'decrypt')
  const iv = fromBase64(token.slice(0, dot))
  const sealed = fromBase64(token.slice(dot + 1))
  // "meta:<sig>" for everything written now; the bare "meta" only opens what was sealed before the
  // binding, and never a line moved from another object (that one was sealed to its own sig).
  for (const label of [...(sig ? [`meta:${sig}`] : []), 'meta']) {
    try { return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(label) }, key, sealed))) } catch { /* the next label */ }
  }
  throw new Error('the list line does not open for this message')
}
