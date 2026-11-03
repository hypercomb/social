// sharing/device-pairing.spec.ts — the pairing record and its token: a master
// vouches for a device, the device takes the word, revocation reaches the
// devices that are told, and a handshake then turns the revoked one away.
// Real secp256k1 keys; no network, no store but a fake one.

import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = { register: () => {}, get: () => undefined, whenReady: () => {} }
})

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { mintDelegation, mintRevocation, type EventSigner, type NostrEventLike } from './device-delegation.js'
import { newChallenge, proveDevice, verifyDeviceProof } from './device-handshake.js'
import {
  PAIRING_POOL, activeDevices, decodeToken, emptyPairing, encodeToken, knownEvents, loadPairing,
  ownGrant, recordMinted, savePairing, takeToken, type PairingStoreLike,
} from './device-pairing.js'
import { deviceKeyOf, parsePairWord } from './pair.queen.js'

const signerOf = (secret: Uint8Array): EventSigner => ({
  signEvent: async evt => finalizeEvent(evt, secret) as unknown as NostrEventLike,
})

const masterSecret = generateSecretKey()
const laptopSecret = generateSecretKey()
const phoneSecret = generateSecretKey()
const strangerSecret = generateSecretKey()
const master = getPublicKey(masterSecret)
const laptop = getPublicKey(laptopSecret)
const phone = getPublicKey(phoneSecret)
const stranger = getPublicKey(strangerSecret)
const NOW = 1_800_000_000

/** The library tags signed events with a symbol-keyed cache; what travels is plain JSON. */
const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value))

/** A Store as the app has one: pools of documents, a read never creates one. */
const fakeStore = (): PairingStoreLike => {
  const docs = new Map<string, ArrayBuffer>()
  const handle = (m: string) => ({ name: m }) as unknown as FileSystemDirectoryHandle
  return {
    initialize: async () => {},
    openPool: async m => docs.has(m) ? handle(m) : null,
    getPool: async m => handle(m),
    getPoolDoc: async pool => docs.get((pool as unknown as { name: string }).name) ?? null,
    putPoolDoc: async (pool, bytes) => { docs.set((pool as unknown as { name: string }).name, bytes); return 'f'.repeat(64) },
  }
}

describe('the pairing token', () => {
  it('round-trips signed events and refuses what is not a token', async () => {
    const grant = (await mintDelegation(signerOf(masterSecret), laptop, { now: NOW }))!
    const token = encodeToken([grant])
    expect(token.startsWith('hcpair1.')).toBe(true)
    expect(plain(decodeToken(token))).toEqual(plain([grant]))
    for (const bad of ['', 'hello', 'hcpair1.', 'hcpair1.!!!', 'hcpair1.' + btoa('{"v":2}'), 'hcpair1.' + btoa('{"v":1,"events":[]}')]) {
      expect(decodeToken(bad)).toBeNull()
    }
  })
})

describe('pairing two devices', () => {
  it('the master vouches, the new device takes the word, and both then know the pair', async () => {
    // MASTER: pair add <laptop>
    const grant = (await mintDelegation(signerOf(masterSecret), laptop, { label: 'laptop', now: NOW }))!
    const onMaster = recordMinted(emptyPairing(), master, grant)
    expect(onMaster.master).toBe(master)
    expect(activeDevices(onMaster, NOW)).toEqual([{ device: laptop, label: 'laptop', expiresAt: null }])

    // LAPTOP: pair accept <token>
    const taken = takeToken(emptyPairing(), encodeToken([grant]), laptop, NOW)
    expect(taken).toMatchObject({ ok: true, self: 'paired', noted: 0 })
    if (!taken.ok) return
    expect(taken.state.master).toBe(master)
    expect(plain(ownGrant(taken.state, laptop))).toEqual(plain(grant))
    expect(ownGrant(onMaster, master)).toBeNull()
  })

  it('refuses a token for another device, a forged one, and a second master', async () => {
    const forLaptop = (await mintDelegation(signerOf(masterSecret), laptop, { now: NOW }))!
    // The phone was handed the laptop's token.
    expect(takeToken(emptyPairing(), encodeToken([forLaptop]), phone, NOW)).toEqual({ ok: false, reason: 'nothing valid' })
    // A tampered grant no longer verifies.
    const forged = { ...forLaptop, content: JSON.stringify({ v: 1, label: 'x' }) }
    expect(takeToken(emptyPairing(), encodeToken([forged]), laptop, NOW)).toEqual({ ok: false, reason: 'nothing valid' })
    // Already paired to the master: a stranger's grant for the same device is not taken.
    const paired = (takeToken(emptyPairing(), encodeToken([forLaptop]), laptop, NOW) as { state: ReturnType<typeof emptyPairing> }).state
    const rival = (await mintDelegation(signerOf(strangerSecret), laptop, { now: NOW + 1 }))!
    expect(takeToken(paired, encodeToken([rival]), laptop, NOW + 2)).toEqual({ ok: false, reason: 'other master' })
    // And a token with no key to take it against.
    expect(takeToken(emptyPairing(), encodeToken([forLaptop]), null, NOW)).toEqual({ ok: false, reason: 'no key' })
    expect(takeToken(emptyPairing(), 'nope', laptop, NOW)).toEqual({ ok: false, reason: 'not a token' })
  })

  it('a revocation reaches the devices that are told, and a handshake then turns the revoked one away', async () => {
    const laptopGrant = (await mintDelegation(signerOf(masterSecret), laptop, { now: NOW }))!
    const phoneGrant = (await mintDelegation(signerOf(masterSecret), phone, { now: NOW }))!
    // The phone is paired; the laptop will be removed.
    const phoneState = (takeToken(emptyPairing(), encodeToken([phoneGrant]), phone, NOW) as { state: ReturnType<typeof emptyPairing> }).state
    const revocation = (await mintRevocation(signerOf(masterSecret), laptop, { now: NOW + 10 }))!

    // The laptop still holds and presents its old grant.
    const challenge = newChallenge()
    const proof = (await proveDevice(signerOf(laptopSecret), { challenge, verifier: phone, delegation: laptopGrant, now: NOW + 11 }))!
    // Before the phone is told, the old grant stands.
    expect(verifyDeviceProof(proof, { challenge, self: phone, master, now: NOW + 11, known: knownEvents(phoneState) }).ok).toBe(true)

    // pair accept <revocation token> on the phone: noted, and now it refuses the laptop.
    const told = takeToken(phoneState, encodeToken([revocation]), phone, NOW + 12)
    expect(told).toMatchObject({ ok: true, self: null, noted: 1 })
    if (!told.ok) return
    expect(verifyDeviceProof(proof, { challenge, self: phone, master, now: NOW + 12, known: knownEvents(told.state) }))
      .toMatchObject({ ok: false, reason: 'delegation: revoked' })
  })

  it('a device learns it has been taken out, and only from its own master', async () => {
    const grant = (await mintDelegation(signerOf(masterSecret), laptop, { now: NOW }))!
    const paired = (takeToken(emptyPairing(), encodeToken([grant]), laptop, NOW) as { state: ReturnType<typeof emptyPairing> }).state
    const revocation = (await mintRevocation(signerOf(masterSecret), laptop, { now: NOW + 5 }))!
    const out = takeToken(paired, encodeToken([revocation]), laptop, NOW + 6)
    expect(out).toMatchObject({ ok: true, self: 'revoked' })
    if (out.ok) expect(ownGrant(out.state, laptop)).toBeNull()
    // The stranger's revocation of the laptop means nothing.
    const fake = (await mintRevocation(signerOf(strangerSecret), laptop, { now: NOW + 7 }))!
    expect(takeToken(paired, encodeToken([fake]), laptop, NOW + 8)).toEqual({ ok: false, reason: 'other master' })
    expect(stranger).not.toBe(master)
  })
})

describe('the pairing document', () => {
  it('is not created by a read, survives a round trip, and drops what no longer verifies', async () => {
    const store = fakeStore()
    expect(await loadPairing(store)).toEqual(emptyPairing())
    expect(await store.openPool!(PAIRING_POOL)).toBeNull()

    const grant = (await mintDelegation(signerOf(masterSecret), laptop, { label: 'laptop', now: NOW }))!
    const state = recordMinted(emptyPairing(), master, grant)
    expect(await savePairing(store, state)).toBe(true)
    expect(await loadPairing(store)).toEqual(plain(state))

    // A document edited on disk: the stored event no longer verifies and is dropped.
    const tampered = { ...state, events: { [laptop]: { ...grant, content: JSON.stringify({ v: 1, label: 'evil' }) } } }
    const other = fakeStore()
    await savePairing(other, tampered)
    expect((await loadPairing(other)).events).toEqual({})
  })
})

describe('the word', () => {
  it('reads its four forms and names what it cannot read', async () => {
    expect(await parsePairWord('')).toEqual({ form: 'show' })
    expect(await parsePairWord(`add ${laptop} my laptop`)).toEqual({ form: 'add', key: laptop, label: 'my laptop' })
    expect(await parsePairWord('add not-a-key')).toEqual({ form: 'add', key: null, label: '' })
    expect(await parsePairWord('accept hcpair1.abc def')).toEqual({ form: 'accept', token: 'hcpair1.abcdef' })
    expect(await parsePairWord(`remove ${laptop}`)).toEqual({ form: 'remove', key: laptop })
    expect(await parsePairWord('frobnicate')).toEqual({ form: 'unknown', word: 'frobnicate' })
  })

  it('takes a key as hex or as an npub', async () => {
    const { npubEncode } = await import('nostr-tools/nip19')
    expect(await deviceKeyOf(laptop.toUpperCase())).toBe(laptop)
    expect(await deviceKeyOf(npubEncode(laptop))).toBe(laptop)
    expect(await deviceKeyOf('npub1nonsense')).toBeNull()
  })
})
