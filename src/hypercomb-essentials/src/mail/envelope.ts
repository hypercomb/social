// mail/envelope.ts
//
// OPENING A SEALED MESSAGE, IN THE BROWSER. The mail Worker (hypercomb-relay/
// mail-worker/seal.js) encrypts each message with a fresh AES-256-GCM key and
// wraps only that key to the owner's Nostr key with NIP-44. This is the other
// half: it opens what that wrote, and it must stay byte-for-byte compatible
// (envelope.spec.ts opens the Worker's own output).
//
//   envelope = [4-byte big-endian header length][header JSON][ciphertext]
//   header   = { v: 1, sig, epk, wk, iv }
//
// ── THE KEY NEVER ARRIVES HERE ──────────────────────────────────────────────
//
// Opening needs the owner's secret for exactly one step: unwrapping the AES key.
// That step is a `Decrypt` handed in (the hive's NostrSigner, which keeps the
// secret to itself or hands the work to a NIP-07 extension). This file never
// sees a key, so it cannot leak, persist or export one.

/** Open what `peerPubkeyHex` sealed to this key; null when it does not open. */
export type Decrypt = (peerPubkeyHex: string, payload: string) => Promise<string | null>

export interface MailMeta {
  readonly from?: string
  readonly to?: string
  readonly subject?: string
  readonly size?: number
  readonly at?: number
  readonly id?: string
}

const enc = new TextEncoder()
const dec = new TextDecoder()

const fromBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text), c => c.charCodeAt(0))

const toHex = (bytes: Uint8Array): string => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')

const sha256Hex = async (bytes: Uint8Array): Promise<string> =>
  toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)))

/** Opens an envelope. Throws on any damage; a message that opens is exactly the message that was sealed. */
export async function openEnvelope(envelope: Uint8Array, decrypt: Decrypt): Promise<{ sig: string; bytes: Uint8Array }> {
  if (envelope.length < 4) throw new Error('malformed envelope')
  const headerLength = new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength).getUint32(0)
  if (headerLength < 2 || 4 + headerLength > envelope.length) throw new Error('malformed envelope')
  const header = JSON.parse(dec.decode(envelope.subarray(4, 4 + headerLength))) as { v?: number; sig?: string; epk?: string; wk?: string; iv?: string }
  if (header.v !== 1 || !header.sig || !header.epk || !header.wk || !header.iv) throw new Error('unknown envelope')

  const wrapped = await decrypt(header.epk, header.wk)
  if (!wrapped) throw new Error('this key does not open the message')
  const key = await crypto.subtle.importKey('raw', fromBase64(wrapped) as BufferSource, 'AES-GCM', false, ['decrypt'])
  const bytes = new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(header.iv) as BufferSource, additionalData: enc.encode(header.sig) as BufferSource },
    key,
    envelope.subarray(4 + headerLength) as BufferSource,
  ))
  if (await sha256Hex(bytes) !== header.sig) throw new Error('signature mismatch')
  return { sig: header.sig, bytes }
}

/** Opens the list metadata that rode with an envelope (`<epk>.<nip44 ciphertext>`); null if it does not open. */
export async function openMetaToken(token: string, decrypt: Decrypt): Promise<MailMeta | null> {
  const dot = token.indexOf('.')
  if (dot < 1) return null
  try {
    const plain = await decrypt(token.slice(0, dot), token.slice(dot + 1))
    return plain ? JSON.parse(plain) as MailMeta : null
  } catch { return null }
}
