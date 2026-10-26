import { describe, expect, it } from 'vitest'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import * as nip44 from 'nostr-tools/nip44'
import { envelopeBytes, envelopeMembers, newDoorSecret, openEnvelope, parseEnvelope, sealEnvelope, type Nip44 } from './sealed-envelope.js'
import { openWithSecret, sealToSecret } from '@hypercomb/core'

/** A signer's NIP-44, for one local key — what NostrSigner lends. */
const signerOf = (secret: Uint8Array): Nip44 => ({
  encrypt: async (peer, text) => nip44.encrypt(text, nip44.getConversationKey(secret, peer)),
  decrypt: async (peer, payload) => { try { return nip44.decrypt(payload, nip44.getConversationKey(secret, peer)) } catch { return null } },
})

const publisherSecret = generateSecretKey()
const aliceSecret = generateSecretKey()
const bobSecret = generateSecretKey()
const publisher = getPublicKey(publisherSecret)
const alice = getPublicKey(aliceSecret)
const bob = getPublicKey(bobSecret)
const door = 'd'.repeat(64)

describe('sealed envelope', () => {
  it('seals one secret to every member and the publisher, and each opens it with their own key', async () => {
    const secret = newDoorSecret()
    const envelope = (await sealEnvelope({ door, secret, publisher, members: [alice] }, signerOf(publisherSecret)))!
    expect(envelopeMembers(envelope).sort()).toEqual([alice, publisher].sort())
    expect(await openEnvelope(envelope, alice, signerOf(aliceSecret))).toBe(secret)
    expect(await openEnvelope(envelope, publisher, signerOf(publisherSecret))).toBe(secret)
  })

  it('does not open for someone outside the audience, or with the wrong key', async () => {
    const secret = newDoorSecret()
    const envelope = (await sealEnvelope({ door, secret, publisher, members: [alice] }, signerOf(publisherSecret)))!
    expect(await openEnvelope(envelope, bob, signerOf(bobSecret))).toBeNull()
    // Bob claiming to be Alice cannot open Alice's seal with his own key.
    expect(await openEnvelope(envelope, alice, signerOf(bobSecret))).toBeNull()
  })

  it('the secret it carries is what opens the sealed key index — end to end', async () => {
    const secret = newDoorSecret()
    const index = new TextEncoder().encode(JSON.stringify({ head: 'h'.repeat(64), keys: { ['a'.repeat(64)]: 'k'.repeat(64) } }))
    const sealed = await sealToSecret(index, new TextEncoder().encode(secret))
    const envelope = (await sealEnvelope({ door, secret, publisher, members: [alice] }, signerOf(publisherSecret)))!
    const opened = await openEnvelope(envelope, alice, signerOf(aliceSecret))
    expect(new TextDecoder().decode((await openWithSecret(sealed, new TextEncoder().encode(opened!)))!)).toContain('"head"')
    // A secret that is not the door's opens nothing.
    expect(await openWithSecret(sealed, new TextEncoder().encode(newDoorSecret()))).toBeNull()
  })

  it('is canonical: the same envelope has the same bytes whatever order the seals were made in, and round-trips the parser', async () => {
    const secret = newDoorSecret()
    const envelope = (await sealEnvelope({ door, secret, publisher, members: [alice, bob] }, signerOf(publisherSecret)))!
    const reordered = { ...envelope, seals: Object.fromEntries(Object.entries(envelope.seals).reverse()) }
    expect(new TextDecoder().decode(envelopeBytes(reordered))).toBe(new TextDecoder().decode(envelopeBytes(envelope)))
    expect(parseEnvelope(JSON.parse(new TextDecoder().decode(envelopeBytes(envelope))))).toEqual(
      { ...envelope, seals: Object.fromEntries(Object.keys(envelope.seals).sort().map(key => [key, envelope.seals[key]])) })
  })

  it('refuses to make an envelope that leaves someone out, or from bad input', async () => {
    const failing: Nip44 = { encrypt: async peer => (peer === alice ? null : 'x'), decrypt: async () => null }
    expect(await sealEnvelope({ door, secret: newDoorSecret(), publisher, members: [alice] }, failing)).toBeNull()
    expect(await sealEnvelope({ door: 'nope', secret: newDoorSecret(), publisher, members: [] }, signerOf(publisherSecret))).toBeNull()
    expect(await sealEnvelope({ door, secret: 'short', publisher, members: [] }, signerOf(publisherSecret))).toBeNull()
    expect(await sealEnvelope({ door, secret: newDoorSecret(), publisher, members: ['not-a-key'] }, signerOf(publisherSecret))).toBeNull()
  })

  it('parses only what has its shape', () => {
    expect(parseEnvelope(null)).toBeNull()
    expect(parseEnvelope({ seal: 2, door, from: publisher, seals: {} })).toBeNull()
    expect(parseEnvelope({ seal: 1, door: 'x', from: publisher, seals: {} })).toBeNull()
    expect(parseEnvelope({ seal: 1, door, from: publisher, seals: { bad: 'x' } })).toBeNull()
    expect(parseEnvelope({ seal: 1, door, from: publisher, seals: { [alice]: 'payload' } })).not.toBeNull()
  })
})
