// sealed-adopt.spec.ts — the adopter's half: a branch rooted at a signature the hosts cannot serve in plain bytes, sealed to
// the adopter's key, is opened and KEPT — every atom, under the signature the publisher made it with — and nothing is kept
// when the key does not open it. Real keys and ciphers, the real signed index; the host is a stateful fake and the store a Map.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const registry = vi.hoisted(() => {
  const held = new Map<string, unknown>()
  ;(globalThis as unknown as { window: unknown }).window = globalThis
  ;(globalThis as unknown as { ioc: unknown }).ioc = {
    register: (key: string, value: unknown) => { held.set(key, value) },
    get: (key: string) => held.get(key),
    whenReady: () => {},
  }
  return held
})

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import * as nip44 from 'nostr-tools/nip44'
import { SignatureService, registerPoolMeaning } from '@hypercomb/core'
import { setHiveRoot, setHiveSealed } from './hive-pointer.js'
import { forgetKeyReads } from './key-list.client.js'
import { publishSealed } from './sealed-publish.js'
import { localizeSealed } from './sealed-adopt.js'

const INDEX_POOL = await registerPoolMeaning('hive:indexes')
const SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'
const STORE_KEY = '@hypercomb.social/Store'
const HOST = 'one.example'

const publisherSk = generateSecretKey(), aliceSk = generateSecretKey(), bobSk = generateSecretKey()
const publisher = getPublicKey(publisherSk), alice = getPublicKey(aliceSk), bob = getPublicKey(bobSk)

const asSigner = (sk: Uint8Array): void => {
  const pk = getPublicKey(sk)
  registry.set(SIGNER_KEY, {
    signEvent: async (evt: never) => finalizeEvent(evt, sk),
    getPublicKeyHex: async () => pk,
    knownPublicKeyHex: async () => pk,
    nip44Encrypt: async (peer: string, text: string) => nip44.encrypt(text, nip44.getConversationKey(sk, peer)),
    nip44Decrypt: async (peer: string, payload: string) => { try { return nip44.decrypt(payload, nip44.getConversationKey(sk, peer)) } catch { return null } },
  })
}

const sigOf = (bytes: Uint8Array): Promise<string> => SignatureService.sign(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
const enc = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))
const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

let index: unknown
let atoms: Map<string, Uint8Array>
let kept: Map<string, Uint8Array>
let storeFails = false
let named: string[] = []
const realFetch = globalThis.fetch

beforeEach(() => {
  index = undefined
  atoms = new Map()
  kept = new Map()
  storeFails = false
  named = []
  forgetKeyReads()
  registry.set(STORE_KEY, {
    writeLayerBytes: async (sig: string, bytes: ArrayBuffer) => { if (storeFails) throw new Error('disk full'); kept.set(sig, new Uint8Array(bytes)) },
  })
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.pathname === `/${INDEX_POOL}/${publisher}`) {
      if ((init?.method ?? 'GET') === 'PUT') { index = JSON.parse(String(init!.body)); return new Response('held', { status: 201 }) }
      return index ? Response.json(index) : new Response('none', { status: 404 })
    }
    const held = atoms.get(url.pathname.slice(1))
    return held ? new Response(held as unknown as BodyInit) : new Response('none', { status: 404 })
  }) as typeof fetch
})
afterEach(() => { globalThis.fetch = realFetch; registry.delete(SIGNER_KEY); registry.delete(STORE_KEY) })

/** A branch whose ROOT the index names but whose plain bytes no host holds — only the sealed version is served. */
const publishPrivately = async (members: string[]) => {
  asSigner(publisherSk)
  const leaf = enc({ note: 'a private paragraph' })
  const leafSig = await sigOf(leaf)
  const photo = new TextEncoder().encode('not really a photo, but bytes')
  const photoSig = await sigOf(photo)
  const head = enc({ name: 'secret', resources: [leafSig], image: photoSig })
  const headSig = await sigOf(head)
  const store = new Map([[leafSig, leaf], [photoSig, photo], [headSig, head]])
  await setHiveRoot(HOST, 'secret', headSig)
  const result = await publishSealed(headSig, members, {
    getBytes: async sig => store.get(sig) ?? null,
    upload: async batch => { for (const [sig, bytes] of batch) atoms.set(sig, bytes); return { ok: true } },
    nip44: {
      encrypt: async (peer, plain) => (registry.get(SIGNER_KEY) as { nip44Encrypt: (p: string, t: string) => Promise<string> }).nip44Encrypt(peer, plain),
      decrypt: async (peer, payload) => (registry.get(SIGNER_KEY) as { nip44Decrypt: (p: string, t: string) => Promise<string | null> }).nip44Decrypt(peer, payload),
    },
    publisher, previous: named,
    setSealed: async envelopes => { named = [...envelopes]; const done = await setHiveSealed(HOST, 'secret', envelopes); return { ok: done.ok, ...(done.reason ? { reason: done.reason } : {}) } },
  })
  expect(result.ok).toBe(true)
  return { headSig, leafSig, photoSig, leaf, photo, head }
}

const source = { hosts: [HOST], publisher }

describe('an adopter opens a private version and keeps it', () => {
  it('keeps every atom of the tree under the signature the publisher made it with, and nothing else', async () => {
    const tree = await publishPrivately([publisher, alice])
    // The host holds ciphertext only: the plain head is not served under its own name.
    expect(atoms.has(tree.headSig)).toBe(false)

    asSigner(aliceSk)
    const result = await localizeSealed(tree.headSig, source)
    expect(result).toMatchObject({ ok: true, head: tree.headSig, atoms: 3, host: HOST })

    expect([...kept.keys()].sort()).toEqual([tree.headSig, tree.leafSig, tree.photoSig].sort())
    expect(text(kept.get(tree.headSig)!)).toBe(text(tree.head))
    expect(text(kept.get(tree.leafSig)!)).toContain('private paragraph')
    expect(text(kept.get(tree.photoSig)!)).toBe('not really a photo, but bytes')
    // What is kept hashes to its name: the tree is the publisher's own, not a copy that merely reads the same.
    for (const [sig, bytes] of kept) expect(await sigOf(bytes)).toBe(sig)
    // No ciphertext is kept.
    for (const sig of atoms.keys()) expect(kept.has(sig)).toBe(false)
  })

  it('keeps nothing for a key the version was not sealed to — the tile stays an egg', async () => {
    const tree = await publishPrivately([publisher, alice])
    asSigner(bobSk)
    expect(await localizeSealed(tree.headSig, source)).toEqual({ ok: false, reason: 'no-version' })
    expect(kept.size).toBe(0)
  })

  it('opens once the key arrives: a newer envelope that seals the door to the adopter is tried first', async () => {
    const tree = await publishPrivately([publisher, alice])
    asSigner(bobSk)
    expect((await localizeSealed(tree.headSig, source)).ok).toBe(false)
    expect(kept.size).toBe(0)

    await publishPrivately([publisher, alice, bob])
    asSigner(bobSk)
    const result = await localizeSealed(tree.headSig, source)
    expect(result).toMatchObject({ ok: true, head: tree.headSig, atoms: 3 })
    expect(text(kept.get(tree.leafSig)!)).toContain('private paragraph')
  })

  it('keeps nothing when no signing key is present on this device', async () => {
    const tree = await publishPrivately([publisher, alice])
    registry.delete(SIGNER_KEY)
    expect(await localizeSealed(tree.headSig, source)).toEqual({ ok: false, reason: 'no-version' })
    expect(kept.size).toBe(0)
  })

  it('keeps nothing for a root the index does not name a private version for', async () => {
    await publishPrivately([publisher, alice])
    asSigner(aliceSk)
    expect(await localizeSealed('9'.repeat(64), source)).toEqual({ ok: false, reason: 'no-version' })
    expect(kept.size).toBe(0)
  })

  it('is complete or absent: one ciphertext the host lost leaves nothing behind, not a husk', async () => {
    const tree = await publishPrivately([publisher, alice])
    asSigner(aliceSk)
    // Lose one ciphertext (not the door, not the envelope): an atom the key index names.
    const envelope = JSON.parse(text(atoms.get(named[0]!)!)) as { door: string }
    const lost = [...atoms.keys()].find(sig => sig !== named[0] && sig !== envelope.door)
    expect(lost).toBeDefined()
    atoms.delete(lost!)
    // 'incomplete', not 'no-version': the key DID open the version, one of its atoms was missing, and nothing was kept.
    expect(await localizeSealed(tree.headSig, source)).toEqual({ ok: false, reason: 'incomplete' })
    expect(kept.size).toBe(0)
  })

  it('says so when the store will not take the bytes, and refuses a malformed source up front', async () => {
    const tree = await publishPrivately([publisher, alice])
    asSigner(aliceSk)
    storeFails = true
    expect(await localizeSealed(tree.headSig, source)).toEqual({ ok: false, reason: 'unwritable' })
    expect(await localizeSealed('not-a-sig', source)).toEqual({ ok: false, reason: 'no-source' })
    expect(await localizeSealed(tree.headSig, { hosts: [], publisher })).toEqual({ ok: false, reason: 'no-source' })
    expect(await localizeSealed(tree.headSig, { hosts: [HOST], publisher: 'nope' })).toEqual({ ok: false, reason: 'no-source' })
  })
})
