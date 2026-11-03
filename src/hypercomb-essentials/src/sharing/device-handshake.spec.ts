import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import {
  currentDelegation,
  mintDelegation,
  mintRevocation,
  verifyDelegation,
  type EventSigner,
  type NostrEventLike,
} from './device-delegation.js'
import { newChallenge, proveDevice, verifyDeviceProof, PROOF_WINDOW_SECONDS } from './device-handshake.js'

/** A signer for one local key — what NostrSigner.signEvent does without an extension. */
const signerOf = (secret: Uint8Array): EventSigner => ({
  signEvent: async evt => finalizeEvent(evt, secret) as unknown as NostrEventLike,
})

const masterSecret = generateSecretKey()
const laptopSecret = generateSecretKey()
const strangerSecret = generateSecretKey()
const master = getPublicKey(masterSecret)
const laptop = getPublicKey(laptopSecret)
const stranger = getPublicKey(strangerSecret)
const desktopSecret = generateSecretKey()
const desktop = getPublicKey(desktopSecret)
const NOW = 1_800_000_000

describe('device delegation', () => {
  it('the master vouches for a device and a verifier accepts it', async () => {
    const grant = (await mintDelegation(signerOf(masterSecret), laptop, { label: 'laptop', now: NOW }))!
    expect(verifyDelegation(grant, master, laptop, NOW)).toEqual({
      ok: true, master, device: laptop, label: 'laptop', expiresAt: null,
    })
  })

  it('does not vouch for another device, another master, or a forged signer', async () => {
    const grant = (await mintDelegation(signerOf(masterSecret), laptop, { now: NOW }))!
    expect(verifyDelegation(grant, master, stranger, NOW)).toMatchObject({ ok: false, reason: 'wrong device' })
    expect(verifyDelegation(grant, stranger, laptop, NOW)).toMatchObject({ ok: false, reason: 'wrong master' })
    // A device vouching for itself is a delegation by the wrong key.
    const selfGrant = (await mintDelegation(signerOf(laptopSecret), laptop, { now: NOW }))!
    expect(verifyDelegation(selfGrant, master, laptop, NOW)).toMatchObject({ ok: false, reason: 'wrong master' })
    // Same declared pubkey, tampered content: the signature no longer holds.
    const forged = { ...grant, content: JSON.stringify({ v: 1, label: 'tampered' }) }
    expect(verifyDelegation(forged, master, laptop, NOW)).toMatchObject({ ok: false, reason: 'bad signature' })
  })

  it('expires, and a revocation replaces the grant', async () => {
    const grant = (await mintDelegation(signerOf(masterSecret), laptop, { expiresAt: NOW + 100, now: NOW }))!
    expect(verifyDelegation(grant, master, laptop, NOW + 99).ok).toBe(true)
    expect(verifyDelegation(grant, master, laptop, NOW + 100)).toMatchObject({ ok: false, reason: 'expired' })

    const revoke = (await mintRevocation(signerOf(masterSecret), laptop, { now: NOW + 10 }))!
    expect(verifyDelegation(revoke, master, laptop, NOW + 11)).toMatchObject({ ok: false, reason: 'revoked' })
    // A relay hands back the stale grant too: the newest event is the current one.
    expect(currentDelegation([grant, revoke], master, laptop)).toBe(revoke)
    expect(currentDelegation([revoke, grant], master, laptop)).toBe(revoke)
    // Signed in the SAME second as the grant, the revocation still wins — in either order.
    const tied = (await mintRevocation(signerOf(masterSecret), laptop, { now: NOW }))!
    expect(currentDelegation([grant, tied], master, laptop)).toBe(tied)
    expect(currentDelegation([tied, grant], master, laptop)).toBe(tied)
    // Another device's events are not this device's.
    expect(currentDelegation([revoke], master, stranger)).toBeNull()
  })
})

describe('device handshake', () => {
  it('a delegated device proves it belongs to the master, for this verifier and this question', async () => {
    const grant = (await mintDelegation(signerOf(masterSecret), laptop, { now: NOW }))!
    const challenge = newChallenge()
    const proof = (await proveDevice(signerOf(laptopSecret), { challenge, verifier: desktop, delegation: grant, now: NOW }))!
    expect(verifyDeviceProof(proof, { challenge, self: desktop, master, now: NOW }))
      .toEqual({ ok: true, device: laptop, master, via: 'delegation' })
  })

  it('the master device needs no delegation', async () => {
    const challenge = newChallenge()
    const proof = (await proveDevice(signerOf(masterSecret), { challenge, verifier: desktop, now: NOW }))!
    expect(verifyDeviceProof(proof, { challenge, self: desktop, master, now: NOW }))
      .toEqual({ ok: true, device: master, master, via: 'master' })
  })

  it('refuses a stranger, even one that copies a real delegation for someone else', async () => {
    const challenge = newChallenge()
    const noGrant = (await proveDevice(signerOf(strangerSecret), { challenge, verifier: desktop, now: NOW }))!
    expect(verifyDeviceProof(noGrant, { challenge, self: desktop, master, now: NOW })).toMatchObject({ ok: false, reason: 'not delegated' })

    // The laptop's grant is public; the stranger presents it under THEIR key.
    const laptopGrant = (await mintDelegation(signerOf(masterSecret), laptop, { now: NOW }))!
    const borrowed = (await proveDevice(signerOf(strangerSecret), { challenge, verifier: desktop, delegation: laptopGrant, now: NOW }))!
    expect(verifyDeviceProof(borrowed, { challenge, self: desktop, master, now: NOW }))
      .toMatchObject({ ok: false, reason: 'delegation: wrong device' })
    expect(stranger).not.toBe(laptop)
  })

  it('a proof cannot be replayed: not to another verifier, not for another question, not later', async () => {
    const grant = (await mintDelegation(signerOf(masterSecret), laptop, { now: NOW }))!
    const challenge = newChallenge()
    const proof = (await proveDevice(signerOf(laptopSecret), { challenge, verifier: desktop, delegation: grant, now: NOW }))!
    expect(verifyDeviceProof(proof, { challenge, self: stranger, master, now: NOW })).toMatchObject({ ok: false, reason: 'wrong verifier' })
    expect(verifyDeviceProof(proof, { challenge: newChallenge(), self: desktop, master, now: NOW })).toMatchObject({ ok: false, reason: 'wrong challenge' })
    expect(verifyDeviceProof(proof, { challenge, self: desktop, master, now: NOW + PROOF_WINDOW_SECONDS + 1 })).toMatchObject({ ok: false, reason: 'stale' })
  })

  it('a revoked device is turned away at the door', async () => {
    const revoke = (await mintRevocation(signerOf(masterSecret), laptop, { now: NOW }))!
    const challenge = newChallenge()
    const proof = (await proveDevice(signerOf(laptopSecret), { challenge, verifier: desktop, delegation: revoke, now: NOW }))!
    expect(verifyDeviceProof(proof, { challenge, self: desktop, master, now: NOW }))
      .toMatchObject({ ok: false, reason: 'delegation: revoked' })
  })

  it('a revoked device cannot keep presenting its old grant to a verifier that was told', async () => {
    const grant = (await mintDelegation(signerOf(masterSecret), laptop, { now: NOW }))!
    const revoke = (await mintRevocation(signerOf(masterSecret), laptop, { now: NOW + 5 }))!
    const challenge = newChallenge()
    const proof = (await proveDevice(signerOf(laptopSecret), { challenge, verifier: desktop, delegation: grant, now: NOW + 6 }))!
    // Not told: the stale grant still verifies. This is the limit, stated in a test.
    expect(verifyDeviceProof(proof, { challenge, self: desktop, master, now: NOW + 6 }).ok).toBe(true)
    // Told: the revocation outranks the grant the device presented.
    expect(verifyDeviceProof(proof, { challenge, self: desktop, master, now: NOW + 6, known: [revoke] }))
      .toMatchObject({ ok: false, reason: 'delegation: revoked' })
    // A renewal the device did not present is honoured too.
    const renewed = (await mintDelegation(signerOf(masterSecret), laptop, { label: 'renewed', now: NOW + 7 }))!
    expect(verifyDeviceProof(proof, { challenge, self: desktop, master, now: NOW + 8, known: [revoke, renewed] }).ok).toBe(true)
  })

  it('a tampered copy of a real proof is caught even in memory, where the library caches its verdict', async () => {
    const challenge = newChallenge()
    const proof = (await proveDevice(signerOf(masterSecret), { challenge, verifier: desktop, now: NOW }))!
    expect(verifyDeviceProof(proof, { challenge, self: desktop, master, now: NOW }).ok).toBe(true)
    const tampered = { ...proof, content: JSON.stringify({ v: 1, delegation: {} }) }
    expect(verifyDeviceProof(tampered, { challenge, self: desktop, master, now: NOW }))
      .toMatchObject({ ok: false, reason: 'bad signature' })
  })

  it('does not accept garbage', () => {
    const challenge = newChallenge()
    for (const bad of [null, undefined, {}, { kind: 30572, tags: 'x' }] as any[]) {
      expect(verifyDeviceProof(bad, { challenge, self: desktop, master, now: NOW }).ok).toBe(false)
    }
  })
})
