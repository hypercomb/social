// sharing/device-signal.ts
//
// HOW TWO OF A PARTICIPANT'S DEVICES FIND EACH OTHER. A browser cannot accept an
// inbound connection, so before a data channel exists the two must pass a few
// small messages (a WebRTC offer, an answer, network candidates) through
// something both can reach: the relay the mesh already speaks to. The relay is
// a MEETING POINT here, never a store:
//
//   - the event kind is EPHEMERAL (20000-29999): a relay forwards it to whoever
//     is listening now and keeps nothing;
//   - the content is NIP-44 SEALED to the peer's key, so the relay sees only
//     that two keys exchanged something, and not the addresses inside;
//   - the rendezvous address is sha256('device-sync:' + master), so every
//     device of one participant listens at the same place and nobody else has a
//     reason to.
//
// WHO SENT IT is decided by the cipher, not by the event. NIP-44's key is shared
// between exactly two keys, so a message that opens under (peer, my key) was
// made by someone holding the peer's secret (or mine). An event's own `pubkey`
// field is unverified here and is only the hint for which key to try.
//
// This file carries messages. It decides nothing about trust: a stranger who
// reaches the link is turned away by the proof (device-link.ts), and `allow`
// only spares the cost of answering someone who cannot possibly pass it.

import { SignatureService } from '@hypercomb/core'

/** Ephemeral, so a relay forwards and forgets. 20400-20402 are the content broker's. */
export const DEVICE_SIGNAL_KIND = 20573

/** A message older than this is not answered (seconds). */
export const SIGNAL_MAX_AGE_SECONDS = 120

const HEX64 = /^[0-9a-f]{64}$/

export type SignalMessage =
  | { t: 'offer'; session: string; d: unknown }
  | { t: 'answer'; session: string; d: unknown }
  | { t: 'ice'; session: string; d: unknown }
  | { t: 'bye'; session: string }

type Envelope = SignalMessage & { v: 1; at: number }

export interface SignalMesh {
  publish(kind: number, sig: string, payload: unknown, extraTags?: string[][]): Promise<boolean>
  subscribe(
    sig: string,
    cb: (e: { event: { pubkey?: string; kind: number; tags: string[][]; content: string } }) => void,
  ): { close: () => void }
}

export interface SignalCipher {
  getPublicKeyHex(): Promise<string | null>
  nip44Encrypt(peer: string, plaintext: string): Promise<string | null>
  nip44Decrypt(peer: string, payload: string): Promise<string | null>
}

/** Where every device of one participant listens. */
export const rendezvousAddress = async (master: string): Promise<string> =>
  SignatureService.sign(new TextEncoder().encode(`device-sync:${master.toLowerCase()}`).buffer as ArrayBuffer)

/** A session id: both ends tag every message with it so two attempts never cross. */
export const newSession = (): string => {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

export class DeviceSignaler {
  readonly #mesh: SignalMesh
  readonly #cipher: SignalCipher
  readonly #master: string
  readonly #now: () => number

  constructor(mesh: SignalMesh, cipher: SignalCipher, master: string, now: () => number = () => Math.floor(Date.now() / 1000)) {
    this.#mesh = mesh
    this.#cipher = cipher
    this.#master = master.toLowerCase()
    this.#now = now
  }

  /** Seal one message to `peer` and hand it to the relay. False when it could not be sent. */
  async send(peer: string, message: SignalMessage): Promise<boolean> {
    const to = peer.toLowerCase()
    if (!HEX64.test(to)) return false
    const envelope: Envelope = { ...message, v: 1, at: this.#now() }
    const sealed = await this.#cipher.nip44Encrypt(to, JSON.stringify(envelope))
    if (!sealed) return false
    return this.#mesh.publish(DEVICE_SIGNAL_KIND, await rendezvousAddress(this.#master), sealed, [['p', to]]).catch(() => false)
  }

  /**
   * Listen for what the participant's other devices send to this one. `allow`
   * is asked with the sender's key before a message is even opened. Returns
   * the function that stops listening.
   */
  async listen(
    allow: (from: string) => boolean,
    onMessage: (from: string, message: SignalMessage) => void,
  ): Promise<() => void> {
    const self = (await this.#cipher.getPublicKeyHex())?.toLowerCase()
    if (!self || !HEX64.test(self)) return () => {}
    const sub = this.#mesh.subscribe(await rendezvousAddress(this.#master), event => { void this.#receive(self, event?.event, allow, onMessage) })
    return () => sub.close()
  }

  async #receive(
    self: string,
    event: { pubkey?: string; kind: number; tags: string[][]; content: string } | undefined,
    allow: (from: string) => boolean,
    onMessage: (from: string, message: SignalMessage) => void,
  ): Promise<void> {
    if (!event || event.kind !== DEVICE_SIGNAL_KIND) return
    const from = String(event.pubkey ?? '').toLowerCase()
    // Our own broadcast comes back to us; so does anything meant for someone else.
    if (!HEX64.test(from) || from === self) return
    if (event.tags?.find(tag => tag?.[0] === 'p')?.[1]?.toLowerCase() !== self) return
    if (!allow(from)) return
    const plain = await this.#cipher.nip44Decrypt(from, event.content)
    if (!plain) return
    let envelope: Partial<Envelope>
    try { envelope = JSON.parse(plain) } catch { return }
    if (envelope?.v !== 1 || typeof envelope.session !== 'string' || !/^[0-9a-f]{16}$/.test(envelope.session)) return
    if (!['offer', 'answer', 'ice', 'bye'].includes(String(envelope.t))) return
    if (typeof envelope.at !== 'number' || Math.abs(this.#now() - envelope.at) > SIGNAL_MAX_AGE_SECONDS) return
    const { v: _v, at: _at, ...message } = envelope as Envelope
    onMessage(from, message as SignalMessage)
  }
}
