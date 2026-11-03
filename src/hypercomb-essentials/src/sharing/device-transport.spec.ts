// sharing/device-transport.spec.ts — the whole way from "two paired devices" to
// "one asks the other for an atom": sealed signalling over a fake relay, the
// WebRTC choreography over fake peers, then the proof and a fetch over the
// channel that came out. Real secp256k1 keys and real NIP-44; no network.

import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import * as nip44 from 'nostr-tools/nip44'
import { mintDelegation, type EventSigner, type NostrEventLike } from './device-delegation.js'
import { DeviceLink, type LinkIdentity } from './device-link.js'
import { answer, dial, type RtcChannelLike, type RtcPeerLike } from './device-rtc.js'
import {
  DEVICE_SIGNAL_KIND, DeviceSignaler, rendezvousAddress, newSession,
  type SignalCipher, type SignalMesh,
} from './device-signal.js'

const masterSecret = generateSecretKey()
const laptopSecret = generateSecretKey()
const strangerSecret = generateSecretKey()
const master = getPublicKey(masterSecret)
const laptop = getPublicKey(laptopSecret)
const stranger = getPublicKey(strangerSecret)

const cipherOf = (secret: Uint8Array): SignalCipher => ({
  getPublicKeyHex: async () => getPublicKey(secret),
  nip44Encrypt: async (peer, text) => nip44.encrypt(text, nip44.getConversationKey(secret, peer)),
  nip44Decrypt: async (peer, payload) => { try { return nip44.decrypt(payload, nip44.getConversationKey(secret, peer)) } catch { return null } },
})

const signerOf = (secret: Uint8Array): EventSigner => ({
  signEvent: async evt => finalizeEvent(evt, secret) as unknown as NostrEventLike,
})

/** A relay: everything published at an address reaches everyone listening there — the publisher too, as the mesh does. */
const relay = () => {
  const listeners = new Map<string, Set<(e: any) => void>>()
  const log: { kind: number; sig: string; content: string; tags: string[][] }[] = []
  const meshFor = (secret: Uint8Array): SignalMesh => ({
    async publish(kind, sig, payload, extraTags = []) {
      const event = { pubkey: getPublicKey(secret), kind, tags: [['x', sig], ...extraTags], content: String(payload) }
      log.push({ kind, sig, content: event.content, tags: event.tags })
      for (const cb of listeners.get(sig) ?? []) queueMicrotask(() => cb({ event }))
      return true
    },
    subscribe(sig, cb) {
      const set = listeners.get(sig) ?? new Set()
      set.add(cb as any); listeners.set(sig, set)
      return { close: () => set.delete(cb as any) }
    },
  })
  return { meshFor, log }
}

const signalerFor = (net: ReturnType<typeof relay>, secret: Uint8Array, masterKey = master, now?: () => number) =>
  new DeviceSignaler(net.meshFor(secret), cipherOf(secret), masterKey, now)

// --- fake WebRTC: a pair of peers that link up through their descriptions ------

const peers = new Map<string, FakePeer>()
let counter = 0

class FakeChannel implements RtcChannelLike {
  readyState = 'connecting'
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  other: FakeChannel | null = null
  constructor(readonly label: string) {}
  send(text: string) { const to = this.other; queueMicrotask(() => to?.onmessage?.({ data: text })) }
  close() { if (this.readyState === 'closed') return; this.readyState = 'closed'; const to = this.other; queueMicrotask(() => { if (to && to.readyState !== 'closed') { to.readyState = 'closed'; to.onclose?.() } }) }
}

class FakePeer implements RtcPeerLike {
  readonly id = `peer${++counter}`
  onicecandidate: RtcPeerLike['onicecandidate'] = null
  ondatachannel: RtcPeerLike['ondatachannel'] = null
  onconnectionstatechange: (() => void) | null = null
  connectionState = 'new'
  #remote: FakePeer | null = null
  #channel: FakeChannel | null = null
  #candidates = 0
  #hasRemoteDescription = false
  constructor() { peers.set(this.id, this) }
  createDataChannel(label: string) { this.#channel = new FakeChannel(label); return this.#channel }
  async createOffer() { return { type: 'offer' as const, sdp: this.id } }
  async createAnswer() { return { type: 'answer' as const, sdp: this.id } }
  async setLocalDescription() {
    // A candidate is found the moment the local description is set — BEFORE the
    // description itself reaches the other side, as it can on a real network.
    queueMicrotask(() => this.onicecandidate?.({ candidate: { toJSON: () => ({ candidate: `cand:${this.id}` }) } }))
  }
  async setRemoteDescription(description: RTCSessionDescriptionInit) {
    this.#remote = peers.get(String(description.sdp)) ?? null
    this.#hasRemoteDescription = true
    this.#maybeConnect()
  }
  async addIceCandidate() {
    // A browser refuses a candidate before the remote description is set.
    if (!this.#hasRemoteDescription) throw new Error('InvalidStateError: no remote description')
    this.#candidates++
    this.#maybeConnect()
  }
  close() { this.connectionState = 'closed' }

  #maybeConnect() {
    const remote = this.#remote
    if (!remote || this.#candidates < 1 || remote.#candidates < 1 || !this.#hasRemoteDescription || !remote.#hasRemoteDescription) return
    // The dialler owns the data channel; the answerer is handed the other end.
    const dialler = this.#channel ? this : remote
    const answerer = dialler === this ? remote : this
    const mine = dialler.#channel!
    if (mine.other) return
    const theirs = new FakeChannel(mine.label)
    mine.other = theirs; theirs.other = mine
    mine.readyState = 'open'; theirs.readyState = 'open'
    queueMicrotask(() => { answerer.ondatachannel?.({ channel: theirs }); mine.onopen?.() })
  }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 20))

describe('signalling', () => {
  it('delivers a message to the device it is meant for, and the relay sees only ciphertext', async () => {
    const net = relay()
    const heard: unknown[] = []
    const stop = await signalerFor(net, laptopSecret).listen(() => true, (from, message) => heard.push({ from, message }))
    const session = newSession()
    expect(await signalerFor(net, masterSecret).send(laptop, { t: 'offer', session, d: { sdp: 'secret-address-10.0.0.7' } })).toBe(true)
    await settle()
    expect(heard).toEqual([{ from: master, message: { t: 'offer', session, d: { sdp: 'secret-address-10.0.0.7' } } }])
    expect(JSON.stringify(net.log)).not.toContain('10.0.0.7')
    expect(net.log[0]).toMatchObject({ kind: DEVICE_SIGNAL_KIND, tags: expect.arrayContaining([['p', laptop]]) })
    stop()
  })

  it('ignores its own echo, mail for someone else, senders it does not allow, stale and garbled messages', async () => {
    const net = relay()
    let now = 1_800_000_000
    const heard: string[] = []
    const laptopHears = signalerFor(net, laptopSecret, master, () => now)
    await laptopHears.listen(from => from !== stranger, (_from, message) => heard.push(message.t))

    const session = newSession()
    // Mail for a third device, not for the laptop.
    await signalerFor(net, masterSecret, master, () => now).send(getPublicKey(generateSecretKey()), { t: 'bye', session })
    // From a sender the laptop does not allow — sealed to the laptop, but refused before opening.
    await signalerFor(net, strangerSecret, master, () => now).send(laptop, { t: 'bye', session })
    // Stale: sent two minutes and a bit ago.
    await signalerFor(net, masterSecret, master, () => now - 200).send(laptop, { t: 'bye', session })
    // A bad session id.
    await signalerFor(net, masterSecret, master, () => now).send(laptop, { t: 'bye', session: 'nope' } as any)
    // The laptop's own broadcast comes back to it.
    await laptopHears.send(master, { t: 'bye', session })
    await settle()
    expect(heard).toEqual([])

    // And the good one still lands.
    await signalerFor(net, masterSecret, master, () => now).send(laptop, { t: 'bye', session })
    await settle()
    expect(heard).toEqual(['bye'])
  })

  it('does not reach a device of a different participant, and cannot be opened by one that was not meant', async () => {
    const net = relay()
    const other = generateSecretKey()
    const heardByOther: unknown[] = []
    await signalerFor(net, other, getPublicKey(other)).listen(() => true, (f, m) => heardByOther.push([f, m]))
    await signalerFor(net, masterSecret).send(laptop, { t: 'bye', session: newSession() })
    await settle()
    expect(heardByOther).toEqual([])
    expect(await rendezvousAddress(master)).not.toBe(await rendezvousAddress(laptop))
    expect(stranger).not.toBe(laptop)
  })
})

describe('the whole way across', () => {
  it('two paired devices meet through the relay, prove themselves over the channel, and one fetches an atom', async () => {
    const net = relay()
    const grant = (await mintDelegation(signerOf(masterSecret), laptop))!
    const masterId: LinkIdentity = { signer: signerOf(masterSecret), self: master, master, grant: null, known: () => [] }
    const laptopId: LinkIdentity = { signer: signerOf(laptopSecret), self: laptop, master, grant, known: () => [] }
    const atom = new TextEncoder().encode('{"a":"layer"}')
    const A = '0'.repeat(63) + 'a'

    // The master waits for its devices; the laptop dials.
    let masterLink: DeviceLink | null = null
    const stop = await answer(
      signalerFor(net, masterSecret), from => from === laptop,
      (peer, channel) => { masterLink = new DeviceLink(channel, masterId, async sig => (sig === A ? atom : null), { expectedPeer: peer }); masterLink.start() },
      { createPeer: () => new FakePeer() },
    )
    const channel = await dial(signalerFor(net, laptopSecret), master, { createPeer: () => new FakePeer() })
    expect(channel).not.toBeNull()
    const laptopLink = new DeviceLink(channel!, laptopId, async () => null, { expectedPeer: master })
    laptopLink.start()

    expect(await laptopLink.ready).toEqual({ ok: true, peer: master, via: 'delegation' })
    expect((await masterLink!.ready)).toEqual({ ok: true, peer: laptop, via: 'master' })
    expect(Array.from((await laptopLink.fetch(A))!)).toEqual(Array.from(atom))
    expect(await laptopLink.fetch('0'.repeat(63) + 'b')).toBeNull()
    stop()
  })

  it('says null when the peer is not listening', async () => {
    const net = relay()
    const channel = await dial(signalerFor(net, laptopSecret), master, { createPeer: () => new FakePeer(), connectMs: 50 })
    expect(channel).toBeNull()
  })

  it('does not answer a device it does not allow', async () => {
    const net = relay()
    let answered = 0
    const stop = await answer(signalerFor(net, masterSecret), from => from === laptop, () => { answered++ }, { createPeer: () => new FakePeer() })
    const channel = await dial(signalerFor(net, strangerSecret), master, { createPeer: () => new FakePeer(), connectMs: 50 })
    expect(channel).toBeNull()
    expect(answered).toBe(0)
    stop()
  })
})
