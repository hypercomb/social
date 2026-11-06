// mail/envelope.spec.ts — the browser opens what the mail Worker sealed. The
// envelopes here are written by the Worker's OWN sealing code
// (hypercomb-relay/mail-worker/seal.js), not by a copy of it, so the two halves
// cannot drift apart unnoticed.

import { describe, expect, it, vi } from 'vitest'
import * as nip44 from 'nostr-tools/nip44'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
// @ts-ignore — the Worker's seal is plain JavaScript with no declaration file
import { sealMessage } from '../../../hypercomb-relay/mail-worker/seal.js'
import { openEnvelope, openMetaToken, type Decrypt } from './envelope.js'

const enc = new TextEncoder()
const MESSAGE = enc.encode('From: a@example.org\r\nSubject: sealed\r\n\r\nthe body\r\n')

/** What the hive's signer does with the device key: the secret stays inside this closure. */
const signerFor = (secret: Uint8Array): Decrypt => async (peer, payload) => {
  try { return nip44.decrypt(payload, nip44.getConversationKey(secret, peer)) } catch { return null }
}

describe('opening what the Worker sealed', () => {
  it('opens the message and its list metadata with the owner key', async () => {
    const secret = generateSecretKey()
    const meta = { from: 'a@example.org', to: 'jaime@hypercomb.com', subject: 'sealed', size: MESSAGE.length, at: 1 }
    const sealed = await sealMessage(MESSAGE, getPublicKey(secret), meta)

    const opened = await openEnvelope(sealed.envelope, signerFor(secret))
    expect(opened.sig).toBe(sealed.sig)
    expect(Array.from(opened.bytes)).toEqual(Array.from(MESSAGE))
    expect(await openMetaToken(sealed.metaToken, signerFor(secret))).toEqual(meta)
  })

  it('opens a message far past the 64 KB the Nostr cipher takes', async () => {
    const secret = generateSecretKey()
    const big = new Uint8Array(3 * 1024 * 1024).map((_, i) => (i * 31) % 251)
    const sealed = await sealMessage(big, getPublicKey(secret), {})
    expect(Array.from((await openEnvelope(sealed.envelope, signerFor(secret))).bytes.subarray(0, 64))).toEqual(Array.from(big.subarray(0, 64)))
    expect((await openEnvelope(sealed.envelope, signerFor(secret))).bytes.length).toBe(big.length)
  })

  it('hands the signer only the wrapped key and the sender, never anything else', async () => {
    const secret = generateSecretKey()
    const sealed = await sealMessage(MESSAGE, getPublicKey(secret), {})
    const decrypt = vi.fn(signerFor(secret))
    await openEnvelope(sealed.envelope, decrypt)
    expect(decrypt).toHaveBeenCalledTimes(1)
    const [peer, payload] = decrypt.mock.calls[0]
    expect(peer).toMatch(/^[0-9a-f]{64}$/)
    expect(payload.length).toBeLessThan(200) // a wrapped 32-byte key, not the message
  })
})

describe('what does not open', () => {
  it('refuses with another key, and says so', async () => {
    const sealed = await sealMessage(MESSAGE, getPublicKey(generateSecretKey()), {})
    await expect(openEnvelope(sealed.envelope, signerFor(generateSecretKey()))).rejects.toThrow(/does not open/)
  })

  it('refuses when the signer cannot decrypt at all', async () => {
    const secret = generateSecretKey()
    const sealed = await sealMessage(MESSAGE, getPublicKey(secret), {})
    await expect(openEnvelope(sealed.envelope, async () => null)).rejects.toThrow()
  })

  it('refuses a message changed after it was sealed', async () => {
    const secret = generateSecretKey()
    const sealed = await sealMessage(MESSAGE, getPublicKey(secret), {})
    const changed: Uint8Array = sealed.envelope.slice()
    changed[changed.length - 1] ^= 1
    await expect(openEnvelope(changed, signerFor(secret))).rejects.toThrow()
  })

  it('refuses a damaged or unknown envelope', async () => {
    const secret = generateSecretKey()
    const sealed = await sealMessage(MESSAGE, getPublicKey(secret), {})
    await expect(openEnvelope(sealed.envelope.slice(0, 3), signerFor(secret))).rejects.toThrow(/malformed/)
    const long: Uint8Array = sealed.envelope.slice()
    new DataView(long.buffer).setUint32(0, long.length)
    await expect(openEnvelope(long, signerFor(secret))).rejects.toThrow(/malformed/)
    const future = enc.encode(JSON.stringify({ v: 2, sig: 'x', epk: 'x', wk: 'x', iv: 'x' }))
    const framed = new Uint8Array(4 + future.length)
    new DataView(framed.buffer).setUint32(0, future.length)
    framed.set(future, 4)
    await expect(openEnvelope(framed, signerFor(secret))).rejects.toThrow(/unknown envelope/)
  })

  it('answers null, not a throw, for list metadata that does not open', async () => {
    const secret = generateSecretKey()
    const sealed = await sealMessage(MESSAGE, getPublicKey(secret), { subject: 's' })
    expect(await openMetaToken(sealed.metaToken, signerFor(generateSecretKey()))).toBeNull()
    expect(await openMetaToken('no-dot-here', signerFor(secret))).toBeNull()
    expect(await openMetaToken('.', signerFor(secret))).toBeNull()
    expect(await openMetaToken(`${'a'.repeat(64)}.garbage`, signerFor(secret))).toBeNull()
  })
})
