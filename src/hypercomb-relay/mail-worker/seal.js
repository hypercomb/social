// seal.js — mail is encrypted to its recipient's key before it is stored, so the bucket holds
// ciphertext and only the holder of the private key can read it.
//
// Nostr's own encryption (NIP-44) takes at most 65,535 bytes, and a message can be far larger, so
// this is the usual two layers: the message is encrypted with a fresh one-time AES-256-GCM key, and
// only that 32-byte key is wrapped to the recipient's Nostr key with NIP-44 — from a fresh
// ephemeral key, so nothing ties two messages together.
//
// Envelope bytes: [4-byte big-endian header length][header JSON][ciphertext]
//   header = { v: 1, sig, epk, wk, iv }
//     sig  sha256 of the plaintext, checked again after decrypting
//     epk  the ephemeral public key (hex)
//     wk   the AES key, wrapped with NIP-44
//     iv   the AES-GCM nonce (base64)
//
// The list metadata (who, subject, size, when) is sealed the same way, to the same key, so an inbox
// can be listed in one request without the server being able to read any of it.

import * as nip44 from 'nostr-tools/nip44'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'

const enc = new TextEncoder()
const dec = new TextDecoder()

const toHex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
const toBase64 = bytes => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s) }
const fromBase64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0))

export async function sha256Hex(bytes) {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
}

/** Seals `plain` (and the list metadata) to `recipientPub` (hex). */
export async function sealMessage(plain, recipientPub, meta) {
  const sig = await sha256Hex(plain)
  const ephemeral = generateSecretKey()
  const epk = getPublicKey(ephemeral)
  const wrapKey = nip44.getConversationKey(ephemeral, recipientPub)

  const raw = crypto.getRandomValues(new Uint8Array(32))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt'])
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(sig) }, key, plain))

  const header = enc.encode(JSON.stringify({ v: 1, sig, epk, wk: nip44.encrypt(toBase64(raw), wrapKey), iv: toBase64(iv) }))
  const envelope = new Uint8Array(4 + header.length + body.length)
  new DataView(envelope.buffer).setUint32(0, header.length)
  envelope.set(header, 4)
  envelope.set(body, 4 + header.length)

  const metaToken = `${epk}.${nip44.encrypt(JSON.stringify(meta ?? {}), wrapKey)}`
  return { sig, envelope, metaToken }
}

/** Opens an envelope with the recipient's secret key (32 bytes). Throws on any tampering. */
export async function openMessage(envelope, ownerSecret) {
  if (envelope.length < 4) throw new Error('malformed envelope')
  const headerLength = new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength).getUint32(0)
  if (4 + headerLength > envelope.length) throw new Error('malformed envelope')
  const header = JSON.parse(dec.decode(envelope.subarray(4, 4 + headerLength)))
  if (header.v !== 1) throw new Error('unknown envelope version')

  const raw = fromBase64(nip44.decrypt(header.wk, nip44.getConversationKey(ownerSecret, header.epk)))
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt'])
  const bytes = new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(header.iv), additionalData: enc.encode(header.sig) },
    key,
    envelope.subarray(4 + headerLength),
  ))
  if (await sha256Hex(bytes) !== header.sig) throw new Error('signature mismatch')
  return { sig: header.sig, bytes }
}

/** Opens the list metadata that rode with an envelope. */
export function openMeta(token, ownerSecret) {
  const dot = token.indexOf('.')
  if (dot < 1) throw new Error('malformed metadata')
  return JSON.parse(nip44.decrypt(token.slice(dot + 1), nip44.getConversationKey(ownerSecret, token.slice(0, dot))))
}
