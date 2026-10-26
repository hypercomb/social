// sealed-publish.spec.ts — a private version published, carried by a host that can read none of it, and opened by the
// participants it was sealed to. Real keys, real ciphers; the host is a Map of bytes by signature.

import { describe, expect, it } from 'vitest'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import * as nip44 from 'nostr-tools/nip44'
import { SignatureService } from '@hypercomb/core'
import { openSealedVersion, publishSealed } from './sealed-publish.js'
import { collectClosure, openFromIndex, openKeyIndex, sealClosure, sealKeyIndex, signBytes } from './sealed-closure.js'
import { newDoorSecret, type Nip44 } from './sealed-envelope.js'

const signerOf = (secret: Uint8Array): Nip44 => ({
  encrypt: async (peer, text) => nip44.encrypt(text, nip44.getConversationKey(secret, peer)),
  decrypt: async (peer, payload) => { try { return nip44.decrypt(payload, nip44.getConversationKey(secret, peer)) } catch { return null } },
})
const bytesOf = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))
const sigOfBytes = (bytes: Uint8Array): Promise<string> => SignatureService.sign(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)

const publisherSk = generateSecretKey(), aliceSk = generateSecretKey(), bobSk = generateSecretKey()
const publisher = getPublicKey(publisherSk), alice = getPublicKey(aliceSk), bob = getPublicKey(bobSk)

/** A small tree: a head layer naming a child layer and a resource; the child names another resource. */
const tree = async () => {
  const leaf = bytesOf({ note: 'a private paragraph' })
  const leafSig = await sigOfBytes(leaf)
  const photo = new TextEncoder().encode('not really a photo, but bytes')
  const photoSig = await sigOfBytes(photo)
  const child = bytesOf({ name: 'child', resources: [leafSig] })
  const childSig = await sigOfBytes(child)
  const head = bytesOf({ name: 'head', layers: [childSig], image: photoSig })
  const headSig = await sigOfBytes(head)
  const store = new Map<string, Uint8Array>([[leafSig, leaf], [photoSig, photo], [childSig, child], [headSig, head]])
  return { store, headSig, leafSig, photoSig, childSig, leaf, photo }
}

const makeHost = () => {
  const host = new Map<string, Uint8Array>()
  return {
    host,
    upload: async (atoms: ReadonlyMap<string, Uint8Array>) => { for (const [sig, bytes] of atoms) host.set(sig, bytes); return { ok: true as const } },
    fetch: async (sig: string) => host.get(sig) ?? null,
  }
}

describe('collectClosure', () => {
  it('walks from the head through every atom it names, and only what the store holds', async () => {
    const t = await tree()
    const found = await collectClosure(t.headSig, async sig => t.store.get(sig) ?? null)
    expect([...found.keys()].sort()).toEqual([...t.store.keys()].sort())
    expect((await collectClosure('f'.repeat(64), async () => null)).size).toBe(0)
  })
})

describe('sealClosure and the key index', () => {
  it('seals every atom under a signature of its own, and the door secret alone opens the index', async () => {
    const t = await tree()
    const closure = await collectClosure(t.headSig, async sig => t.store.get(sig) ?? null)
    const sealed = (await sealClosure(closure, t.headSig))!
    expect(sealed.sealed.size).toBe(4)
    for (const [sig, bytes] of sealed.sealed) expect(await signBytes(bytes)).toBe(sig)
    for (const plain of t.store.keys()) expect(sealed.sealed.has(sealed.keyIndex.atoms[plain]!.c)).toBe(true)
    // No ciphertext carries a plaintext word.
    for (const bytes of sealed.sealed.values()) expect(new TextDecoder().decode(bytes)).not.toContain('private paragraph')
    const secret = newDoorSecret()
    const door = (await sealKeyIndex(sealed.keyIndex, secret))!
    expect(await openKeyIndex(door.bytes, secret)).toEqual(sealed.keyIndex)
    expect(await openKeyIndex(door.bytes, newDoorSecret())).toBeNull()
  })

  it('refuses a closure whose bytes are not what their signature says', async () => {
    const t = await tree()
    const closure = new Map(t.store)
    closure.set(t.leafSig, new TextEncoder().encode('swapped'))
    expect(await sealClosure(closure, t.headSig)).toBeNull()
    expect(await sealClosure(t.store, 'a'.repeat(64))).toBeNull()
  })

  it('hands over an atom only if it opens AND hashes to the signature asked for', async () => {
    const t = await tree()
    const closure = await collectClosure(t.headSig, async sig => t.store.get(sig) ?? null)
    const sealed = (await sealClosure(closure, t.headSig))!
    const fetch = async (sig: string) => sealed.sealed.get(sig) ?? null
    expect(new TextDecoder().decode((await openFromIndex(sealed.keyIndex, t.photoSig, fetch))!)).toBe('not really a photo, but bytes')
    // A host that serves the wrong ciphertext under the right name is caught by the hash of the ciphertext.
    const swapped = async (sig: string) => (sig === sealed.keyIndex.atoms[t.photoSig]!.c ? sealed.sealed.get(sealed.keyIndex.atoms[t.leafSig]!.c)! : fetch(sig))
    expect(await openFromIndex(sealed.keyIndex, t.photoSig, swapped)).toBeNull()
    expect(await openFromIndex(sealed.keyIndex, 'c'.repeat(64), fetch)).toBeNull()
  })
})

describe('publishSealed and openSealedVersion', () => {
  it('publishes ciphertext a host cannot read, and each participant opens the whole tree with their own key', async () => {
    const t = await tree()
    const h = makeHost()
    let named: readonly string[] = []
    const result = await publishSealed(t.headSig, [alice], {
      getBytes: async sig => t.store.get(sig) ?? null, upload: h.upload, nip44: signerOf(publisherSk), publisher,
      setSealed: async envelopes => { named = envelopes; return { ok: true } },
    })
    expect(result).toMatchObject({ ok: true, atoms: 4 })
    expect(named).toEqual([(result as { envelope: string }).envelope])
    // 4 sealed atoms + the door + the envelope; nothing on the host reads as the plaintext.
    expect(h.host.size).toBe(6)
    for (const bytes of h.host.values()) expect(new TextDecoder().decode(bytes)).not.toContain('private paragraph')

    for (const [who, sk] of [[alice, aliceSk], [publisher, publisherSk]] as const) {
      const opened = (await openSealedVersion(named, who, signerOf(sk), h.fetch))!
      expect(opened.head).toBe(t.headSig)
      const head = JSON.parse(new TextDecoder().decode((await opened.read(t.headSig))!)) as { layers: string[]; image: string }
      expect(head.layers).toEqual([t.childSig])
      expect(new TextDecoder().decode((await opened.read(head.image))!)).toBe('not really a photo, but bytes')
      expect(new TextDecoder().decode((await opened.read(t.leafSig))!)).toContain('private paragraph')
    }
  })

  it('opens nothing for someone outside the audience, or with the wrong key, or from a tampered envelope', async () => {
    const t = await tree()
    const h = makeHost()
    let named: readonly string[] = []
    await publishSealed(t.headSig, [alice], {
      getBytes: async sig => t.store.get(sig) ?? null, upload: h.upload, nip44: signerOf(publisherSk), publisher,
      setSealed: async envelopes => { named = envelopes; return { ok: true } },
    })
    expect(await openSealedVersion(named, bob, signerOf(bobSk), h.fetch)).toBeNull()
    expect(await openSealedVersion(named, alice, signerOf(bobSk), h.fetch)).toBeNull()
    const tampered = async (sig: string) => (sig === named[0] ? new TextEncoder().encode('{"seal":1}') : h.fetch(sig))
    expect(await openSealedVersion(named, alice, signerOf(aliceSk), tampered)).toBeNull()
  })

  it('the first openable version wins, and a newer envelope is named ahead of the ones it follows', async () => {
    const t = await tree()
    const h = makeHost()
    const first = { ok: true as const }
    let named: readonly string[] = []
    const deps = (previous: readonly string[]) => ({
      getBytes: async (sig: string) => t.store.get(sig) ?? null, upload: h.upload, nip44: signerOf(publisherSk), publisher, previous,
      setSealed: async (envelopes: readonly string[]) => { named = envelopes; return first },
    })
    const one = (await publishSealed(t.headSig, [alice], deps([]))) as { envelope: string }
    const two = (await publishSealed(t.headSig, [bob], deps([one.envelope]))) as { envelope: string }
    expect(named).toEqual([two.envelope, one.envelope])
    // Bob is only in the newer one, Alice only in the older: each opens the first one that has a seal for them.
    expect((await openSealedVersion(named, bob, signerOf(bobSk), h.fetch))!.envelope).toBe(two.envelope)
    expect((await openSealedVersion(named, alice, signerOf(aliceSk), h.fetch))!.envelope).toBe(one.envelope)
  })

  it('stops, saying why, when the head is missing, the upload fails, or the index will not name it', async () => {
    const t = await tree()
    const base = { getBytes: async (sig: string) => t.store.get(sig) ?? null, nip44: signerOf(publisherSk), publisher }
    const upload = async () => ({ ok: true as const })
    expect(await publishSealed('e'.repeat(64), [alice], { ...base, upload, setSealed: async () => ({ ok: true }) })).toMatchObject({ ok: false, reason: 'no-head' })
    expect(await publishSealed(t.headSig, [alice], { ...base, upload: async () => ({ ok: false as const, reason: 'down' }), setSealed: async () => ({ ok: true }) }))
      .toMatchObject({ ok: false, reason: 'upload-failed', detail: 'down' })
    expect(await publishSealed(t.headSig, [alice], { ...base, upload, setSealed: async () => ({ ok: false, reason: 'not-published' }) }))
      .toMatchObject({ ok: false, reason: 'index-failed', detail: 'not-published' })
    expect(await publishSealed(t.headSig, ['bad-key'], { ...base, upload, setSealed: async () => ({ ok: true }) })).toMatchObject({ ok: false, reason: 'envelope-failed' })
  })
})
