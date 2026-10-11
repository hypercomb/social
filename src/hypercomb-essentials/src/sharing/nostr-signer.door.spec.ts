// @vitest-environment-options {"url": "https://try-fix-zoom.hypercomb.com/"}
//
// nostr-signer.door.spec.ts — a sandbox door holds no signer. This file's page
// IS a door (the environment URL above), so the signer answers for a real
// location: it asks no extension, reads no key, mints none and signs nothing.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NostrSigner } from './nostr-signer.js'

const SECRET_KEY_STORAGE = 'hc:nostr:secret-key'

describe('NostrSigner at a sandbox door', () => {
  beforeEach(() => {
    localStorage.clear()
    delete (globalThis as Record<string, unknown>)['nostr']
  })

  it('reports no key and mints none', async () => {
    expect(await new NostrSigner().getPublicKeyHex()).toBeNull()
    expect(localStorage.getItem(SECRET_KEY_STORAGE)).toBeNull()
  })

  it('refuses to sign, and still keeps no key afterwards', async () => {
    await expect(new NostrSigner().signEvent({ kind: 1, created_at: 0, tags: [], content: '' }))
      .rejects.toThrow(/sandbox door/)
    expect(localStorage.getItem(SECRET_KEY_STORAGE)).toBeNull()
  })

  it('never uses a key a door minted before the rule', async () => {
    localStorage.setItem(SECRET_KEY_STORAGE, '11'.repeat(32))
    const signer = new NostrSigner()
    expect(await signer.getPublicKeyHex()).toBeNull()
    await expect(signer.signEvent({ kind: 1, created_at: 0, tags: [], content: '' })).rejects.toThrow(/sandbox door/)
  })

  it('never asks an extension the pin could not remove', async () => {
    const extension = { getPublicKey: vi.fn(async () => 'ab'.repeat(32)), signEvent: vi.fn(async (e: unknown) => e) }
    ;(globalThis as Record<string, unknown>)['nostr'] = extension
    const signer = new NostrSigner()
    expect(await signer.getPublicKeyHex()).toBeNull()
    await expect(signer.signEvent({ kind: 1, created_at: 0, tags: [], content: '' })).rejects.toThrow(/sandbox door/)
    expect(extension.getPublicKey).not.toHaveBeenCalled()
    expect(extension.signEvent).not.toHaveBeenCalled()
  })

  it('passes an already-signed event through — no key is involved', async () => {
    const signed = { id: 'i', pubkey: 'p', sig: 's', kind: 1, created_at: 0, tags: [], content: '' }
    expect(await new NostrSigner().signEvent(signed)).toBe(signed)
  })
})
