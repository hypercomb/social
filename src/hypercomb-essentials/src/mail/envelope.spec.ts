// mail/envelope.spec.ts — the browser opens what the mail Worker sealed. The
// envelopes here are written by the Worker's OWN sealing code
// (hypercomb-relay/mail-worker/seal.js: `sealMessage` writes v2, `sealMessageV1`
// writes what older objects in the bucket hold), not by a copy of it, so the two
// halves cannot drift apart unnoticed.

import { describe, expect, it, vi } from 'vitest'
import * as nip44 from 'nostr-tools/nip44'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
// @ts-ignore — the Worker's seal is plain JavaScript with no declaration file
import { sealMessage, sealMessageV1, sealMetaUnbound } from '../../../hypercomb-relay/mail-worker/seal.js'
import { openEnvelope, openItemMeta, openMetaToken, unwrapKey, type Decrypt, type MailWrap } from './envelope.js'

const enc = new TextEncoder()
const MESSAGE = enc.encode('From: a@example.org\r\nSubject: sealed\r\n\r\nthe body\r\n')

interface Sealed { sig: string; envelope: Uint8Array; metaToken: string; wraps?: MailWrap[]; customMetadata: Record<string, string> }
const seal = sealMessage as (plain: Uint8Array, keys: string | string[], meta?: object) => Promise<Sealed>
const sealV1 = sealMessageV1 as (plain: Uint8Array, key: string, meta?: object) => Promise<Sealed>

/** What the hive's signer does with the device key: the secret stays inside this closure. */
const signerFor = (secret: Uint8Array): Decrypt => async (peer, payload) => {
  try { return nip44.decrypt(payload, nip44.getConversationKey(secret, peer)) } catch { return null }
}

/** The envelope with its header replaced (the ciphertext is bound to `sig`, not to the header). */
function reframe(envelope: Uint8Array, change: (header: Record<string, unknown>) => Record<string, unknown>): Uint8Array {
  const length = new DataView(envelope.buffer, envelope.byteOffset).getUint32(0)
  const header = JSON.parse(new TextDecoder().decode(envelope.subarray(4, 4 + length)))
  const head = enc.encode(JSON.stringify(change(header)))
  const out = new Uint8Array(4 + head.length + envelope.length - 4 - length)
  new DataView(out.buffer).setUint32(0, head.length)
  out.set(head, 4)
  out.set(envelope.subarray(4 + length), 4 + head.length)
  return out
}

describe('opening what the Worker seals now (v2)', () => {
  it('opens the message and its list metadata with the owner key', async () => {
    const secret = generateSecretKey()
    const pub = getPublicKey(secret)
    const meta = { from: 'a@example.org', to: 'jaime@hypercomb.com', subject: 'sealed', size: MESSAGE.length, at: 1, hasAttachments: false, preview: 'the body' }
    const sealed = await seal(MESSAGE, pub, meta)

    const opened = await openEnvelope(sealed.envelope, signerFor(secret), pub)
    expect(opened).toMatchObject({ sig: sealed.sig, v: 2 })
    expect(Array.from(opened.bytes)).toEqual(Array.from(MESSAGE))
    // A list row: what the Worker's list route hands back for this object.
    const row = { sig: sealed.sig, v: 2, meta: sealed.customMetadata.meta!, wraps: JSON.parse(sealed.customMetadata.wraps!) as MailWrap[] }
    expect(await openItemMeta(row, signerFor(secret), pub)).toEqual(meta)
    // The wraps as the stored JSON string open as well.
    expect(await openItemMeta({ sig: sealed.sig, v: 2, meta: sealed.metaToken, wraps: sealed.customMetadata.wraps }, signerFor(secret))).toEqual(meta)
  })

  it('opens with ANY of the owner keys, asking the signer for its own wrap first', async () => {
    const secrets = [generateSecretKey(), generateSecretKey(), generateSecretKey()]
    const pubs = secrets.map(s => getPublicKey(s))
    const sealed = await seal(MESSAGE, pubs, { subject: 'three keys' })
    for (const [i, secret] of secrets.entries()) {
      const decrypt = vi.fn(signerFor(secret))
      expect(Array.from((await openEnvelope(sealed.envelope, decrypt, pubs[i])).bytes)).toEqual(Array.from(MESSAGE))
      expect(decrypt).toHaveBeenCalledTimes(1) // its own wrap, found by `to`, not tried in turn
      expect(await openItemMeta({ sig: sealed.sig, v: 2, meta: sealed.metaToken, wraps: sealed.wraps }, signerFor(secret), pubs[i])).toEqual({ subject: 'three keys' })
    }
  })

  it('tries every wrap when it is not told its key, or a wrap is mislabelled', async () => {
    const [a, b] = [generateSecretKey(), generateSecretKey()]
    const sealed = await seal(MESSAGE, [getPublicKey(a), getPublicKey(b)], { subject: 's' })
    const decrypt = vi.fn(signerFor(b))
    await openEnvelope(sealed.envelope, decrypt)
    expect(decrypt).toHaveBeenCalledTimes(2)

    const stranger = getPublicKey(generateSecretKey())
    const mislabelled = sealed.wraps!.map(w => ({ ...w, to: stranger }))
    const relabelled = reframe(sealed.envelope, header => ({ ...header, wraps: mislabelled }))
    expect(Array.from((await openEnvelope(relabelled, signerFor(b), getPublicKey(b))).bytes)).toEqual(Array.from(MESSAGE))
    expect(await openItemMeta({ sig: sealed.sig, v: 2, meta: sealed.metaToken, wraps: mislabelled }, signerFor(b), getPublicKey(b))).toEqual({ subject: 's' })
  })

  it('unwraps the 32-byte message key and nothing else', async () => {
    const secret = generateSecretKey()
    const sealed = await seal(MESSAGE, getPublicKey(secret), {})
    expect((await unwrapKey(sealed.wraps!, signerFor(secret))).length).toBe(32)
    await expect(unwrapKey(sealed.wraps!, async () => btoa('short key'))).rejects.toThrow(/does not open/)
    await expect(unwrapKey('not json', signerFor(secret))).rejects.toThrow(/malformed/)
    await expect(unwrapKey([], signerFor(secret))).rejects.toThrow(/malformed/)
  })

  it('opens a message far past the 64 KB the Nostr cipher takes', async () => {
    const secret = generateSecretKey()
    const big = new Uint8Array(3 * 1024 * 1024).map((_, i) => (i * 31) % 251)
    const sealed = await seal(big, getPublicKey(secret), {})
    const opened = await openEnvelope(sealed.envelope, signerFor(secret))
    expect(opened.bytes.length).toBe(big.length)
    expect(Array.from(opened.bytes.subarray(0, 64))).toEqual(Array.from(big.subarray(0, 64)))
  })

  it('hands the signer only a wrapped key and its sender, never anything else', async () => {
    const secret = generateSecretKey()
    const sealed = await seal(MESSAGE, getPublicKey(secret), {})
    const decrypt = vi.fn(signerFor(secret))
    await openEnvelope(sealed.envelope, decrypt, getPublicKey(secret))
    expect(decrypt).toHaveBeenCalledTimes(1)
    const [peer, payload] = decrypt.mock.calls[0]!
    expect(peer).toMatch(/^[0-9a-f]{64}$/)
    expect(peer).not.toBe(getPublicKey(secret)) // the wrap's ephemeral key, never the owner's own
    expect(payload.length).toBeLessThan(200) // a wrapped 32-byte key, not the message
  })

  it('asks a signer at most three times, whatever a host puts in the wraps', async () => {
    const secret = generateSecretKey()
    const sealed = await seal(MESSAGE, getPublicKey(generateSecretKey()), {})
    const many = Array.from({ length: 9 }, () => sealed.wraps![0]!)
    const decrypt = vi.fn(signerFor(secret))
    await expect(openEnvelope(reframe(sealed.envelope, h => ({ ...h, wraps: many })), decrypt)).rejects.toThrow(/does not open/)
    expect(decrypt).toHaveBeenCalledTimes(3)
  })
})

describe('opening what older objects hold (v1, forever)', () => {
  it('opens a v1 message and its v1 list metadata', async () => {
    const secret = generateSecretKey()
    const meta = { from: 'a@example.org', subject: 'old', at: 5 }
    const sealed = await sealV1(MESSAGE, getPublicKey(secret), meta)
    const opened = await openEnvelope(sealed.envelope, signerFor(secret), getPublicKey(secret))
    expect(opened).toMatchObject({ sig: sealed.sig, v: 1 })
    expect(Array.from(opened.bytes)).toEqual(Array.from(MESSAGE))
    expect(await openMetaToken(sealed.metaToken, signerFor(secret))).toEqual(meta)
    // A v1 row from the list route carries v: 1 and no wraps.
    expect(await openItemMeta({ v: 1, meta: sealed.metaToken }, signerFor(secret), getPublicKey(secret))).toEqual(meta)
  })
})

describe('what does not open', () => {
  it('refuses with another key, and says so — both versions', async () => {
    const other = signerFor(generateSecretKey())
    const v2 = await seal(MESSAGE, getPublicKey(generateSecretKey()), {})
    await expect(openEnvelope(v2.envelope, other)).rejects.toThrow(/does not open/)
    const v1 = await sealV1(MESSAGE, getPublicKey(generateSecretKey()), {})
    await expect(openEnvelope(v1.envelope, other)).rejects.toThrow(/does not open/)
  })

  it('refuses when the signer cannot decrypt at all', async () => {
    const secret = generateSecretKey()
    const sealed = await seal(MESSAGE, getPublicKey(secret), {})
    await expect(openEnvelope(sealed.envelope, async () => null)).rejects.toThrow()
    await expect(openEnvelope(sealed.envelope, async () => { throw new Error('extension said no') })).rejects.toThrow(/does not open/)
  })

  it('refuses a message changed after it was sealed', async () => {
    const secret = generateSecretKey()
    const sealed = await seal(MESSAGE, getPublicKey(secret), {})
    const changed: Uint8Array = sealed.envelope.slice()
    changed[changed.length - 1] ^= 1
    await expect(openEnvelope(changed, signerFor(secret))).rejects.toThrow()
    // A header that claims another signature: the AES tag is bound to the real one.
    const resigned = reframe(sealed.envelope, h => ({ ...h, sig: 'f'.repeat(64) }))
    await expect(openEnvelope(resigned, signerFor(secret))).rejects.toThrow()
  })

  it('refuses a damaged or unknown envelope', async () => {
    const secret = generateSecretKey()
    const sealed = await seal(MESSAGE, getPublicKey(secret), {})
    await expect(openEnvelope(sealed.envelope.slice(0, 3), signerFor(secret))).rejects.toThrow(/malformed/)
    const long: Uint8Array = sealed.envelope.slice()
    new DataView(long.buffer).setUint32(0, long.length)
    await expect(openEnvelope(long, signerFor(secret))).rejects.toThrow(/malformed/)
    await expect(openEnvelope(reframe(sealed.envelope, h => ({ ...h, v: 3 })), signerFor(secret))).rejects.toThrow(/unknown envelope/)
    await expect(openEnvelope(reframe(sealed.envelope, h => ({ ...h, wraps: [] })), signerFor(secret))).rejects.toThrow(/unknown envelope/)
    await expect(openEnvelope(reframe(sealed.envelope, h => ({ v: 1, sig: h['sig'], iv: h['iv'] })), signerFor(secret))).rejects.toThrow(/unknown envelope/)
  })

  it('answers null, not a throw, for list metadata that does not open', async () => {
    const secret = generateSecretKey()
    const sealed = await seal(MESSAGE, getPublicKey(secret), { subject: 's' })
    const other = signerFor(generateSecretKey())
    expect(await openItemMeta({ v: 2, meta: sealed.metaToken, wraps: sealed.wraps }, other)).toBeNull()
    expect(await openItemMeta({ v: 2, meta: sealed.metaToken }, signerFor(secret))).toBeNull() // v2 with no wraps
    expect(await openItemMeta({ v: 2, meta: sealed.metaToken, wraps: 'not json' }, signerFor(secret))).toBeNull()
    expect(await openItemMeta({ v: 2, meta: 'no-dot', wraps: sealed.wraps }, signerFor(secret))).toBeNull()
    expect(await openItemMeta({ v: 2, meta: 'AAAA.AAAA', wraps: sealed.wraps }, signerFor(secret))).toBeNull()
    // A v2 token read as v1 does not open, and does not throw.
    expect(await openMetaToken(sealed.metaToken, signerFor(secret))).toBeNull()
    expect(await openMetaToken('no-dot-here', signerFor(secret))).toBeNull()
    expect(await openMetaToken('.', signerFor(secret))).toBeNull()
    expect(await openMetaToken(`${'a'.repeat(64)}.garbage`, signerFor(secret))).toBeNull()
  })
})

describe('the list line is bound to its message (R1 #11)', () => {
  const sealUnbound = sealMetaUnbound as (raw: Uint8Array, meta: object) => Promise<string>

  it('does not open a line moved onto another message, nor one read without its sig', async () => {
    const secret = generateSecretKey()
    const pub = getPublicKey(secret)
    const a = await seal(MESSAGE, pub, { subject: 'Invoice paid' })
    const b = await seal(enc.encode('another message'), pub, { subject: 'b' })
    // A's line and wraps, on B: the label names B, so A's line does not open there.
    expect(await openItemMeta({ sig: b.sig, v: 2, meta: a.metaToken, wraps: a.wraps }, signerFor(secret), pub)).toBeNull()
    // Without the sig only the older unbound label is tried, and a bound line does not open with it.
    expect(await openItemMeta({ v: 2, meta: a.metaToken, wraps: a.wraps }, signerFor(secret), pub)).toBeNull()
    expect(await openItemMeta({ sig: a.sig, v: 2, meta: a.metaToken, wraps: a.wraps }, signerFor(secret), pub)).toEqual({ subject: 'Invoice paid' })
  })

  it('still opens a v2 line sealed before the binding, with one signer ask', async () => {
    const secret = generateSecretKey()
    const pub = getPublicKey(secret)
    const sealed = await seal(MESSAGE, pub, { subject: 'new' })
    const k = await unwrapKey(sealed.wraps!, signerFor(secret), pub)
    const older = await sealUnbound(k, { subject: 'sealed before the binding' })
    const decrypt = vi.fn(signerFor(secret))
    expect(await openItemMeta({ sig: sealed.sig, v: 2, meta: older, wraps: sealed.wraps }, decrypt, pub)).toEqual({ subject: 'sealed before the binding' })
    expect(decrypt).toHaveBeenCalledTimes(1) // K once, both labels tried with it
  })

  it('refuses a sound envelope for another message when told which sig it asked for, before any signer ask', async () => {
    const secret = generateSecretKey()
    const pub = getPublicKey(secret)
    const a = await seal(MESSAGE, pub)
    const b = await seal(enc.encode('another message'), pub)
    const decrypt = vi.fn(signerFor(secret))
    await expect(openEnvelope(b.envelope, decrypt, pub, a.sig)).rejects.toThrow(/signature mismatch/)
    expect(decrypt).not.toHaveBeenCalled()
    expect((await openEnvelope(a.envelope, decrypt, pub, a.sig)).sig).toBe(a.sig)
    // v1 too.
    const v1 = await sealV1(MESSAGE, pub)
    await expect(openEnvelope(v1.envelope, signerFor(secret), pub, b.sig)).rejects.toThrow(/signature mismatch/)
  })
})

describe('the host does not choose how much a row costs (R2 #3)', () => {
  /** A v1 list line, sealed to `pub` with whatever JSON a host likes. */
  const v1Line = (pub: string, value: unknown): string => {
    const ephemeral = generateSecretKey()
    return `${getPublicKey(ephemeral)}.${nip44.encrypt(JSON.stringify(value), nip44.getConversationKey(ephemeral, pub))}`
  }

  it('keeps only the last three references, oldest first, and drops a references that is not a list', async () => {
    const secret = generateSecretKey()
    const pub = getPublicKey(secret)
    const references = Array.from({ length: 2000 }, (_, i) => `<r${i}@example.org>`)
    const meta = await openMetaToken(v1Line(pub, { subject: 's', references }), signerFor(secret))
    expect(meta).toEqual({ subject: 's', references: ['<r1997@example.org>', '<r1998@example.org>', '<r1999@example.org>'] })
    expect(await openMetaToken(v1Line(pub, { subject: 's', references: ['<a@x>', 7, null, '<b@x>'] }), signerFor(secret)))
      .toEqual({ subject: 's', references: ['<a@x>', '<b@x>'] })
    expect(await openMetaToken(v1Line(pub, { subject: 's', references: '<a@x>'.repeat(5000) }), signerFor(secret))).toEqual({ subject: 's' })
  })
})
