// assistant/change-seal.ts
//
// THE PAYLOAD HALF of the change channel (change-channel.ts names the address
// half). A change that leaves the device is sealed before it goes: encrypted
// AND authenticated under a key derived from the same shared secret that
// derives the channel id. The relay carries only the sealed text, so it sees
// that a change passed, never what it says; and a record that was not sealed
// with the secret, or was altered on the way, does not open at all.
//
// So the seal is also the authority. Only someone holding the secret can make
// a record that opens, so no signing key list is needed for a channel that is
// one participant's own devices and the sessions they hand the secret to.
//
// The format is deliberately plain, so any program can speak it:
//
//   key     = HKDF-SHA-256(secret, salt "hc:change-channel:salt",
//                          info "hc:change-channel:key") → AES-256-GCM
//   sealed  = "v1." + base64(iv, 12 bytes) + "." + base64(ciphertext + tag)
//   aad     = the channel id, so a record sealed for one channel never opens
//             on another
//   plain   = the record as JSON
//
// The channel id is sha256 of the secret and travels in the clear as the
// relay tag, so a short secret can be guessed from it offline. Use a long,
// random secret.

const enc = new TextEncoder()
const dec = new TextDecoder()

export const CHANGE_SEAL_VERSION = 'v1'

const toBase64 = (bytes: Uint8Array): string => {
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}

const fromBase64 = (text: string): Uint8Array => {
  const raw = atob(text)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

const buffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

const changeKey = async (secret: string): Promise<CryptoKey> => {
  const base = await crypto.subtle.importKey('raw', buffer(enc.encode(secret)), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: buffer(enc.encode('hc:change-channel:salt')),
      info: buffer(enc.encode('hc:change-channel:key')),
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Seal a record for one channel. */
export const sealChange = async (secret: string, channel: string, record: unknown): Promise<string> => {
  const key = await changeKey(secret)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: buffer(iv), additionalData: buffer(enc.encode(channel)) },
    key,
    buffer(enc.encode(JSON.stringify(record))),
  )
  return `${CHANGE_SEAL_VERSION}.${toBase64(iv)}.${toBase64(new Uint8Array(sealed))}`
}

/** Open a sealed record, or null when it is not one, was sealed with another
 *  secret or for another channel, or was altered on the way. Never throws. */
export const unsealChange = async (secret: string, channel: string, sealed: string): Promise<unknown | null> => {
  const [version, ivText, bodyText, ...extra] = String(sealed ?? '').split('.')
  if (version !== CHANGE_SEAL_VERSION || !ivText || !bodyText || extra.length) return null
  try {
    const key = await changeKey(secret)
    const iv = fromBase64(ivText)
    if (iv.length !== 12) return null
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: buffer(iv), additionalData: buffer(enc.encode(channel)) },
      key,
      buffer(fromBase64(bodyText)),
    )
    return JSON.parse(dec.decode(plain))
  } catch {
    return null
  }
}
