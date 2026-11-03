// sharing/device-link.spec.ts — two devices talk over an in-memory pipe: the
// mutual proof, what is and is not served before it, atoms in chunks, and the
// ways a link ends. Real secp256k1 keys; the pipe stands in for a data channel.

import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { mintDelegation, mintRevocation, type EventSigner, type NostrEventLike } from './device-delegation.js'
import { CHUNK_BYTES, DeviceLink, peerIo, type LinkChannel, type LinkIdentity } from './device-link.js'

const signerOf = (secret: Uint8Array): EventSigner => ({
  signEvent: async evt => finalizeEvent(evt, secret) as unknown as NostrEventLike,
})

const masterSecret = generateSecretKey()
const laptopSecret = generateSecretKey()
const strangerSecret = generateSecretKey()
const master = getPublicKey(masterSecret)
const laptop = getPublicKey(laptopSecret)
const stranger = getPublicKey(strangerSecret)

const sig = (n: number): string => n.toString(16).padStart(64, '0')

/** Two ends of a pipe: text sent on one arrives on the other, a tick later; closing one closes both. */
const pipe = (): [LinkChannel & { sent: string[] }, LinkChannel & { sent: string[] }] => {
  const make = (): LinkChannel & { sent: string[]; peer?: LinkChannel; closed: boolean } => ({
    sent: [], closed: false, onmessage: null, onclose: null,
    send(text: string) {
      this.sent.push(text)
      const to = this.peer
      queueMicrotask(() => { if (!this.closed && to && !(to as any).closed) to.onmessage?.(text) })
    },
    close() {
      if (this.closed) return
      this.closed = true
      const to = this.peer as any
      queueMicrotask(() => { if (to && !to.closed) { to.closed = true; to.onclose?.() } })
    },
  })
  const a = make(); const b = make()
  a.peer = b; b.peer = a
  return [a, b]
}

const masterIdentity = (known: NostrEventLike[] = []): LinkIdentity =>
  ({ signer: signerOf(masterSecret), self: master, master, grant: null, known: () => known })

const laptopIdentity = async (known: NostrEventLike[] = []): Promise<LinkIdentity> => {
  const grant = (await mintDelegation(signerOf(masterSecret), laptop))!
  return { signer: signerOf(laptopSecret), self: laptop, master, grant, known: () => known }
}

const heap = (atoms: Record<string, Uint8Array>) => async (signature: string) => atoms[signature] ?? null

const connect = (
  a: LinkIdentity, b: LinkIdentity,
  aServes: Record<string, Uint8Array> = {}, bServes: Record<string, Uint8Array> = {},
  options: { a?: object; b?: object } = {},
) => {
  const [ca, cb] = pipe()
  const la = new DeviceLink(ca, a, heap(aServes), options.a)
  const lb = new DeviceLink(cb, b, heap(bServes), options.b)
  la.start(); lb.start()
  return { la, lb, ca, cb }
}

describe('the proof', () => {
  it('a delegated device and its master accept each other, in both directions', async () => {
    const { la, lb } = connect(masterIdentity(), await laptopIdentity())
    expect(await la.ready).toEqual({ ok: true, peer: laptop, via: 'master' })
    expect(await lb.ready).toEqual({ ok: true, peer: master, via: 'delegation' })
    expect(la.peer).toBe(laptop)
    expect(lb.peer).toBe(master)
  })

  it('turns a stranger away on both sides, and the pipe closes', async () => {
    const stranger_: LinkIdentity = { signer: signerOf(strangerSecret), self: stranger, master, grant: null, known: () => [] }
    const { la, lb, ca } = connect(masterIdentity(), stranger_)
    const [a, b] = await Promise.all([la.ready, lb.ready])
    expect(a.ok).toBe(false)
    expect(b.ok).toBe(false)
    expect((ca as any).closed).toBe(true)
  })

  it('turns away a revoked device its verifier has been told about, but not one it has not', async () => {
    const revocation = (await mintRevocation(signerOf(masterSecret), laptop, { now: Math.floor(Date.now() / 1000) + 1 }))!
    const told = connect(masterIdentity([revocation]), await laptopIdentity())
    expect(await told.la.ready).toMatchObject({ ok: false, reason: 'delegation: revoked' })

    const untold = connect(masterIdentity([]), await laptopIdentity())
    expect((await untold.la.ready).ok).toBe(true)
  })

  it('turns away a hello from a device signalling did not name', async () => {
    const { la } = connect(masterIdentity(), await laptopIdentity(), {}, {}, { a: { expectedPeer: stranger } })
    expect(await la.ready).toMatchObject({ ok: false, reason: 'wrong peer' })
  })

  it('gives up when the other end never speaks', async () => {
    const [ca] = pipe()
    const link = new DeviceLink(ca, masterIdentity(), heap({}), { handshakeMs: 20 })
    link.start()
    expect(await link.ready).toEqual({ ok: false, reason: 'timeout' })
  })
})

describe('the ask', () => {
  it('serves an atom, in chunks, byte for byte — and says none for what it lacks', async () => {
    const small = new TextEncoder().encode('{"layer":1}')
    const big = new Uint8Array(CHUNK_BYTES * 3 + 77).map((_, i) => (i * 31 + 7) & 0xff)
    const { la, lb } = connect(masterIdentity(), await laptopIdentity(), { [sig(1)]: small, [sig(2)]: big })
    await la.ready; await lb.ready

    expect(Array.from((await lb.fetch(sig(1)))!)).toEqual(Array.from(small))
    expect(Array.from((await lb.fetch(sig(2)))!)).toEqual(Array.from(big))
    expect(await lb.fetch(sig(3))).toBeNull()
    expect(await lb.fetch('not-a-signature')).toBeNull()
  })

  it('answers concurrent asks to the right askers', async () => {
    const atoms = Object.fromEntries([1, 2, 3, 4].map(n => [sig(n), new Uint8Array(CHUNK_BYTES * n).fill(n)]))
    const { la, lb } = connect(masterIdentity(), await laptopIdentity(), atoms)
    await la.ready; await lb.ready
    const got = await Promise.all([4, 1, 3, 2].map(n => lb.fetch(sig(n))))
    expect(got.map(bytes => bytes?.[0])).toEqual([4, 1, 3, 2])
    expect(got.map(bytes => bytes?.length)).toEqual([4, 1, 3, 2].map(n => CHUNK_BYTES * n))
  })

  it('serves nothing before the peer has proved itself, and closes on the ask', async () => {
    const [ca, cb] = pipe()
    const link = new DeviceLink(ca, masterIdentity(), heap({ [sig(1)]: new Uint8Array([1, 2, 3]) }))
    link.start()
    // A peer that skips the proof and just asks.
    cb.send(JSON.stringify({ t: 'get', id: 1, sig: sig(1) }))
    expect(await link.ready).toMatchObject({ ok: false })
    expect(cb.onmessage).toBeNull()
    expect(ca.sent.some(text => text.includes('"t":"atom"'))).toBe(false)
  })

  it('cannot fetch before the link is up', async () => {
    const [ca] = pipe()
    const link = new DeviceLink(ca, masterIdentity(), heap({}), { handshakeMs: 20 })
    expect(await link.fetch(sig(1))).toBeNull()
    expect(ca.sent).toEqual([])
    await link.ready
  })

  it('resolves an ask as none when the link drops mid-flight', async () => {
    const { la, lb, ca } = connect(masterIdentity(), await laptopIdentity(), {}, {})
    await la.ready; await lb.ready
    const asked = lb.fetch(sig(9))
    ca.close()
    expect(await asked).toBeNull()
    expect(lb.peer).toBeNull()
  })
})

describe('the replication io', () => {
  it('reads and writes locally and fetches from the peer', async () => {
    const atom = new TextEncoder().encode('hello')
    const { la, lb } = connect(masterIdentity(), await laptopIdentity(), { [sig(5)]: atom })
    await la.ready; await lb.ready
    const written: string[] = []
    const io = peerIo(lb, {
      read: async () => null,
      write: async signature => { written.push(signature) },
    })
    expect(await io.read(sig(5))).toBeNull()
    expect(Array.from((await io.fetch(sig(5)))!)).toEqual(Array.from(atom))
    await io.write(sig(5), atom as Uint8Array<ArrayBuffer>)
    expect(written).toEqual([sig(5)])
  })
})
