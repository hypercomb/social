// nostr-signer.spec.ts — the signing key lives in this device's storage and
// nowhere else: no page global can choose it, and once resolved it is pinned
// for the session, so a signature is always made by the key the signer reported.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getPublicKey } from 'nostr-tools/pure'
import { NostrSigner } from './nostr-signer.js'

const SECRET_KEY_STORAGE = 'hc:nostr:secret-key'
const SECRET_A = '11'.repeat(32)
const SECRET_B = '22'.repeat(32)

const hexToBytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(32)
  for (let i = 0; i < 32; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}
const pubkeyOf = (secret: string): string => getPublicKey(hexToBytes(secret) as never).toLowerCase()
const blank = () => ({ kind: 1, created_at: 0, tags: [] as string[][], content: '' })

describe('NostrSigner — the key is this device\'s', () => {
  beforeEach(() => {
    localStorage.clear()
    delete (globalThis as Record<string, unknown>)['nostr']
    delete (globalThis as Record<string, unknown>)['NOSTR_SECRET_KEY']
  })

  it('a page global cannot choose the key', async () => {
    localStorage.setItem(SECRET_KEY_STORAGE, SECRET_B)
    ;(globalThis as Record<string, unknown>)['NOSTR_SECRET_KEY'] = SECRET_A
    const signer = new NostrSigner()
    expect(await signer.getPublicKeyHex()).toBe(pubkeyOf(SECRET_B))
    expect((await signer.signEvent(blank())).pubkey).toBe(pubkeyOf(SECRET_B))
  })

  it('the key is pinned for the session — a later storage write or global changes nothing', async () => {
    localStorage.setItem(SECRET_KEY_STORAGE, SECRET_B)
    const signer = new NostrSigner()
    const reported = await signer.getPublicKeyHex()
    await signer.signEvent(blank())
    localStorage.setItem(SECRET_KEY_STORAGE, SECRET_A)
    ;(globalThis as Record<string, unknown>)['NOSTR_SECRET_KEY'] = SECRET_A
    const later = await signer.signEvent(blank())
    expect(later.pubkey).toBe(pubkeyOf(SECRET_B))
    expect(later.pubkey).toBe(reported)
  })

  it('the key a device already holds is known without minting or asking an extension', async () => {
    expect(await new NostrSigner().knownPublicKeyHex()).toBeNull()
    expect(localStorage.getItem(SECRET_KEY_STORAGE)).toBeNull()
    localStorage.setItem(SECRET_KEY_STORAGE, SECRET_B)
    const signer = new NostrSigner()
    expect(await signer.knownPublicKeyHex()).toBe(pubkeyOf(SECRET_B))
    expect((await signer.signEvent(blank())).pubkey).toBe(pubkeyOf(SECRET_B))
    // With an extension present, asking could prompt: nothing is known.
    const extension = { getPublicKey: vi.fn(async () => 'ab'.repeat(32)), signEvent: vi.fn() }
    ;(globalThis as Record<string, unknown>)['nostr'] = extension
    expect(await new NostrSigner().knownPublicKeyHex()).toBeNull()
    expect(extension.getPublicKey).not.toHaveBeenCalled()
  })

  it('a miss mints one key, persists it, and the next instance reports the same pubkey', async () => {
    const first = await new NostrSigner().getPublicKeyHex()
    const stored = localStorage.getItem(SECRET_KEY_STORAGE)
    expect(stored).toMatch(/^[0-9a-f]{64}$/)
    expect(first).toBe(pubkeyOf(stored!))
    expect(await new NostrSigner().getPublicKeyHex()).toBe(first)
  })
})
