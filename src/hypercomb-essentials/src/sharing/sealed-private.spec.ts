// sealed-private.spec.ts — the whole path through the signed index: a branch is published, a private version is sealed to a
// participant and named in the index, and the participant opens it by reading the index and the atoms from the host with
// nothing but their own key. The host is a stateful fake that keeps the index last PUT and bytes by signature.

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
import { openPrivate, publishSealed } from './sealed-publish.js'

const INDEX_POOL = await registerPoolMeaning('hive:indexes')
const SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'
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

let index: unknown
let atoms: Map<string, Uint8Array>
const realFetch = globalThis.fetch
beforeEach(() => {
  index = undefined
  atoms = new Map()
  forgetKeyReads()
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.pathname === `/${INDEX_POOL}/${publisher}`) {
      if ((init?.method ?? 'GET') === 'PUT') { index = JSON.parse(String(init!.body)); return new Response('held', { status: 201 }) }
      return index ? Response.json(index) : new Response('none', { status: 404 })
    }
    const held = atoms.get(url.pathname.slice(1))
    return held ? new Response(held) : new Response('none', { status: 404 })
  }) as typeof fetch
})
afterEach(() => { globalThis.fetch = realFetch; registry.clear() })

const publishAs = async (members: string[]) => {
  asSigner(publisherSk)
  const leaf = enc({ note: 'a private paragraph' })
  const leafSig = await sigOf(leaf)
  const head = enc({ name: 'secret', resources: [leafSig] })
  const headSig = await sigOf(head)
  const store = new Map([[leafSig, leaf], [headSig, head]])
  await setHiveRoot(HOST, 'secret', headSig)
  const result = await publishSealed(headSig, members, {
    getBytes: async sig => store.get(sig) ?? null,
    upload: async batch => { for (const [sig, bytes] of batch) atoms.set(sig, bytes); return { ok: true } },
    nip44: { encrypt: async (peer, text) => (registry.get(SIGNER_KEY) as { nip44Encrypt: (p: string, t: string) => Promise<string> }).nip44Encrypt(peer, text),
      decrypt: async (peer, payload) => (registry.get(SIGNER_KEY) as { nip44Decrypt: (p: string, t: string) => Promise<string | null> }).nip44Decrypt(peer, payload) },
    publisher,
    setSealed: async envelopes => { const named = await setHiveSealed(HOST, 'secret', envelopes); return { ok: named.ok, ...(named.reason ? { reason: named.reason } : {}) } },
  })
  return { result, headSig, leafSig }
}

describe('a private version, from publish to a participant opening it', () => {
  it('is named in the signed index, carried by the host as bytes nobody can read, and opened by the participant', async () => {
    const { result, headSig, leafSig } = await publishAs([alice])
    expect(result.ok).toBe(true)
    const content = JSON.parse(String((index as { content: string }).content)) as { roots: Record<string, string>; sealed: Record<string, string[]> }
    expect(content.roots.secret).toBe(headSig)
    expect(content.sealed.secret).toHaveLength(1)
    for (const bytes of atoms.values()) expect(new TextDecoder().decode(bytes)).not.toContain('private paragraph')

    asSigner(aliceSk)
    const opened = (await openPrivate(HOST, publisher, 'secret'))!
    expect(opened.head).toBe(headSig)
    expect(new TextDecoder().decode((await opened.read(headSig))!)).toContain('"secret"')
    expect(new TextDecoder().decode((await opened.read(leafSig))!)).toContain('private paragraph')
  })

  it('opens nothing for a participant it was not sealed to, or when no device key is present', async () => {
    await publishAs([alice])
    asSigner(bobSk)
    expect(await openPrivate(HOST, publisher, 'secret')).toBeNull()
    registry.delete(SIGNER_KEY)
    expect(await openPrivate(HOST, publisher, 'secret')).toBeNull()
    asSigner(aliceSk)
    expect(await openPrivate(HOST, publisher, 'other')).toBeNull()
  })

  it('a host that serves wrong bytes under any name never makes a wrong atom open: it opens right or not at all', async () => {
    const { headSig, leafSig } = await publishAs([alice])
    asSigner(aliceSk)
    const names = [...atoms.keys()]
    expect(names).toHaveLength(4) // two sealed atoms, the door and the envelope
    const original = new Map(atoms)
    let refused = 0
    for (const victim of names) {
      atoms = new Map(original)
      atoms.set(victim, new TextEncoder().encode('garbage'))
      const opened = await openPrivate(HOST, publisher, 'secret')
      const head = opened ? await opened.read(headSig) : null
      const leaf = opened ? await opened.read(leafSig) : null
      // Whatever opens is exactly what was sealed; whatever was tampered does not open.
      if (head) expect(new TextDecoder().decode(head)).toContain('"secret"')
      if (leaf) expect(new TextDecoder().decode(leaf)).toContain('private paragraph')
      if (!opened || !head || !leaf) refused++
    }
    expect(refused).toBe(4)
  })
})
