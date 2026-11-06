// mail/envelope.ts
//
// OPENING A SEALED MESSAGE, IN THE BROWSER. The mail Worker (hypercomb-relay/
// mail-worker/seal.js) encrypts each message with a fresh AES-256-GCM key K and
// wraps only K to the owners' Nostr keys with NIP-44. This is the other half: it
// opens what that wrote, and it must stay byte-for-byte compatible
// (envelope.spec.ts opens the Worker's own output, both versions).
//
//   envelope = [4-byte big-endian header length][header JSON][ciphertext]
//   v2 header = { v: 2, sig, iv, wraps: [{ to, epk, wk }, …] }   one wrap per owner key
//   v1 header = { v: 1, sig, epk, wk, iv }                        one owner (older objects; open forever)
//   ciphertext = AES-256-GCM(plain, K, iv, additionalData = sig)
//   wk         = nip44(base64(K)) from the wrap's ephemeral `epk` to the owner
//
// The list metadata rides on the stored object, so a box lists without fetching
// a body:
//   v2  meta = base64(iv2) + '.' + base64(AES-256-GCM(JSON, K, iv2, additionalData = 'meta:' + sig))
//       — the SAME K, so a v2 row needs its `wraps` to open. The label carries the
//       message's sig so a line copied onto another message does not open there;
//       v2 objects sealed before that binding used the bare 'meta' and still open.
//   v1  meta = '<epk>.<nip44 ciphertext of the JSON>'
//
// ── THE KEY NEVER ARRIVES HERE ──────────────────────────────────────────────
//
// Opening needs the owner's secret for exactly one step: unwrapping K. That step
// is a `Decrypt` handed in (the hive's NostrSigner, which keeps the secret to
// itself or hands the work to a NIP-07 extension). This file never sees a key,
// so it cannot leak, persist or export one. It is told the reader's PUBLIC key
// only so it can ask the signer for its own wrap first instead of every wrap in
// turn (each ask may be an extension prompt).

/** Open what `peerPubkeyHex` sealed to this key; null when it does not open. */
export type Decrypt = (peerPubkeyHex: string, payload: string) => Promise<string | null>

/** One owner's copy of K in a v2 envelope (and on its list row). */
export interface MailWrap {
  readonly to: string
  readonly epk: string
  readonly wk: string
}

/** What the Worker seals beside a message so a list opens without its body. Every field may be missing. */
export interface MailMeta {
  readonly from?: string
  readonly to?: string
  /** As the sender wrote it, possibly RFC 2047 encoded; the reader decodes. */
  readonly subject?: string
  readonly size?: number
  readonly at?: number
  /** Sent copies: the Message-ID Cloudflare gave the message. */
  readonly id?: string | null
  readonly messageId?: string
  readonly inReplyTo?: string
  /** The last three, oldest first. */
  readonly references?: readonly string[]
  /** The Date header as written. */
  readonly date?: string
  readonly hasAttachments?: boolean
  /** The first 120 characters of the text part, whitespace collapsed. */
  readonly preview?: string
}

/** What a list row carries that opening its metadata needs. */
export interface SealedMeta {
  /** The message's signature, which v2 metadata is bound to. Without it only the older, unbound line opens. */
  readonly sig?: string
  readonly v?: number
  readonly meta: string
  readonly wraps?: readonly MailWrap[] | string | null
}

// The contract allows three owner keys. A host that sends more wraps is not
// trusted to make the signer (or an extension's prompt) work harder than that.
const MAX_WRAPS = 3

const enc = new TextEncoder()
const dec = new TextDecoder()
const HEX64 = /^[a-f0-9]{64}$/

const fromBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text), c => c.charCodeAt(0))

const toHex = (bytes: Uint8Array): string => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')

const sha256Hex = async (bytes: Uint8Array): Promise<string> =>
  toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)))

const isWrap = (value: unknown): value is MailWrap => {
  const w = value as Partial<MailWrap> | null
  return !!w && typeof w === 'object' && typeof w.to === 'string' && typeof w.epk === 'string' && HEX64.test(w.epk) && typeof w.wk === 'string'
}

/** The wraps as a checked list (a row may carry them as JSON); null when there are none to try. */
const wrapsOf = (value: SealedMeta['wraps'] | unknown): MailWrap[] | null => {
  let list: unknown = value
  if (typeof value === 'string') { try { list = JSON.parse(value) } catch { return null } }
  if (!Array.isArray(list)) return null
  const wraps = list.filter(isWrap)
  return wraps.length ? wraps : null
}

/**
 * K, from the wraps, through the signer. The reader's own wrap is asked first
 * (by `to`); failing that, every wrap in turn, so a wrap whose `to` was
 * mislabelled still opens. Throws when none opens with this key.
 */
export async function unwrapKey(wraps: readonly MailWrap[] | string, decrypt: Decrypt, ownKey?: string | null): Promise<Uint8Array> {
  const list = wrapsOf(wraps)
  if (!list) throw new Error('malformed wraps')
  const me = String(ownKey ?? '').toLowerCase()
  const ordered = me ? [...list.filter(w => w.to.toLowerCase() === me), ...list.filter(w => w.to.toLowerCase() !== me)] : list
  // The reader's own wrap leads, so the cap never keeps it from being asked.
  for (const wrap of ordered.slice(0, MAX_WRAPS)) {
    let wrapped: string | null = null
    try { wrapped = await decrypt(wrap.epk, wrap.wk) } catch { wrapped = null }
    if (!wrapped) continue
    let raw: Uint8Array
    try { raw = fromBase64(wrapped) } catch { continue }
    // Only a 256-bit key is K; anything else came from a wrap that is not ours.
    if (raw.length === 32) return raw
  }
  throw new Error('this key does not open the message')
}

const aesKey = (raw: Uint8Array): Promise<CryptoKey> =>
  crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['decrypt'])

interface Header { v?: number; sig?: string; iv?: string; epk?: string; wk?: string; wraps?: unknown }

/**
 * Opens an envelope, v1 or v2. Throws on any damage; a message that opens is
 * exactly the message that was sealed (AES-GCM's tag over the bytes and the
 * signature, then the signature checked again over what came out). With
 * `expectSig`, a sound envelope for some OTHER message is refused too: a host
 * must not answer one sig with another's bytes.
 */
export async function openEnvelope(envelope: Uint8Array, decrypt: Decrypt, ownKey?: string | null, expectSig?: string | null): Promise<{ sig: string; bytes: Uint8Array; v: 1 | 2 }> {
  if (envelope.length < 4) throw new Error('malformed envelope')
  const headerLength = new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength).getUint32(0)
  if (headerLength < 2 || 4 + headerLength > envelope.length) throw new Error('malformed envelope')
  let header: Header
  try { header = JSON.parse(dec.decode(envelope.subarray(4, 4 + headerLength))) as Header } catch { throw new Error('malformed envelope') }
  if (!header || typeof header !== 'object' || typeof header.sig !== 'string' || typeof header.iv !== 'string') throw new Error('unknown envelope')
  // Before any signer ask: a wrong message is refused without a prompt.
  if (expectSig && header.sig !== expectSig.toLowerCase()) throw new Error('signature mismatch')

  let raw: Uint8Array
  let v: 1 | 2
  if (header.v === 2) {
    const wraps = wrapsOf(header.wraps)
    if (!wraps) throw new Error('unknown envelope')
    raw = await unwrapKey(wraps, decrypt, ownKey)
    v = 2
  } else if (header.v === 1 && typeof header.epk === 'string' && typeof header.wk === 'string') {
    const wrapped = await decrypt(header.epk, header.wk)
    if (!wrapped) throw new Error('this key does not open the message')
    raw = fromBase64(wrapped)
    v = 1
  } else {
    throw new Error('unknown envelope')
  }

  const bytes = new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(header.iv) as BufferSource, additionalData: enc.encode(header.sig) as BufferSource },
    await aesKey(raw),
    envelope.subarray(4 + headerLength) as BufferSource,
  ))
  if (await sha256Hex(bytes) !== header.sig) throw new Error('signature mismatch')
  return { sig: header.sig, bytes, v }
}

/** Opens v1 list metadata (`<epk>.<nip44 ciphertext>`); null if it does not open. */
export async function openMetaToken(token: string, decrypt: Decrypt): Promise<MailMeta | null> {
  const dot = token.indexOf('.')
  if (dot < 1) return null
  try {
    const plain = await decrypt(token.slice(0, dot), token.slice(dot + 1))
    return plain ? asMeta(JSON.parse(plain)) : null
  } catch { return null }
}

/**
 * Opens a list row's metadata, whichever version wrote it: a v2 row (it carries
 * `wraps`) through K, a v1 row through its own NIP-44 token. Null, never a throw,
 * when it does not open — one unreadable row is not a failed box.
 */
export async function openItemMeta(item: SealedMeta, decrypt: Decrypt, ownKey?: string | null): Promise<MailMeta | null> {
  const token = String(item?.meta ?? '')
  const isV2 = Number(item?.v) === 2 || (item?.wraps !== undefined && item?.wraps !== null && item?.wraps !== '')
  if (!isV2) return openMetaToken(token, decrypt)
  const dot = token.indexOf('.')
  const wraps = wrapsOf(item.wraps)
  if (dot < 1 || !wraps) return null
  let key: CryptoKey, iv: Uint8Array, ct: Uint8Array
  try {
    key = await aesKey(await unwrapKey(wraps, decrypt, ownKey))
    iv = fromBase64(token.slice(0, dot))
    ct = fromBase64(token.slice(dot + 1))
  } catch { return null }
  // The bound label first (everything sealed now), then the bare one (v2 objects
  // sealed before the binding). K is unwrapped once: the second try costs no signer ask.
  const sig = String(item.sig ?? '').toLowerCase()
  for (const label of [...(HEX64.test(sig) ? [`meta:${sig}`] : []), 'meta']) {
    try {
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv as BufferSource, additionalData: enc.encode(label) as BufferSource },
        key,
        ct as BufferSource,
      )
      return asMeta(JSON.parse(dec.decode(plain)))
    } catch { /* the next label, or it does not open */ }
  }
  return null
}

// Metadata is the host's to write and a JSON object or nothing; an array or a
// bare value is not a description of a message.
const asMeta = (value: unknown): MailMeta | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as MailMeta : null
