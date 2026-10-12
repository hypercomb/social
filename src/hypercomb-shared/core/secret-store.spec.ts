// core/secret-store.spec.ts — the secret is THIS tab's.
//
// Same contract as the room: the tab's own zone (sessionStorage
// `hc:mesh-zone`) first, the origin-wide `hc:secret` only for a new tab, and
// an unchanged set() is no event and no write.
//
// Runs against the real module; its module-scope register() is stubbed.

import { describe, it, expect, beforeEach, vi } from 'vitest'

;(globalThis as { register?: unknown }).register = vi.fn()

const { SecretStore } = await import('./secret-store')

const KEY = 'hc:secret'
const CLEARED_KEY = 'hc:secret-cleared'
const ZONE = 'hc:mesh-zone'

describe('SecretStore', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('starts empty when nothing is stored and on localhost', () => {
    const store = new SecretStore()
    expect(store.value).toBe('')
  })

  it('set() persists to localStorage and this tab\'s zone, and updates value', () => {
    const store = new SecretStore()
    store.set('my-secret')
    expect(store.value).toBe('my-secret')
    expect(localStorage.getItem(KEY)).toBe('my-secret')
    expect(JSON.parse(sessionStorage.getItem(ZONE)!)).toMatchObject({ secret: 'my-secret' })
  })

  it('set() trims whitespace', () => {
    const store = new SecretStore()
    store.set('  padded  ')
    expect(store.value).toBe('padded')
  })

  it('clear() sets value to empty and marks as cleared', () => {
    const store = new SecretStore()
    store.set('secret')
    store.clear()
    expect(store.value).toBe('')
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(localStorage.getItem(CLEARED_KEY)).toBe('1')
  })

  it('clear() with nothing to clear still remembers the choice — and fires nothing', () => {
    const store = new SecretStore()
    const handler = vi.fn()
    store.addEventListener('change', handler)
    store.clear()
    expect(localStorage.getItem(CLEARED_KEY)).toBe('1')
    expect(handler).not.toHaveBeenCalled()
  })

  it('set() with a value removes the cleared flag', () => {
    const store = new SecretStore()
    store.clear()
    expect(localStorage.getItem(CLEARED_KEY)).toBe('1')
    store.set('new-secret')
    expect(localStorage.getItem(CLEARED_KEY)).toBeNull()
  })

  it('dispatches change event on set()', () => {
    const store = new SecretStore()
    const handler = vi.fn()
    store.addEventListener('change', handler)
    store.set('abc')
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('dispatches change event on clear()', () => {
    const store = new SecretStore()
    store.set('abc')
    const handler = vi.fn()
    store.addEventListener('change', handler)
    store.clear()
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('set() with the value it already holds fires nothing and writes nothing', () => {
    const store = new SecretStore()
    store.set('4417')
    localStorage.setItem(KEY, 'another-tabs-secret')
    const handler = vi.fn()
    store.addEventListener('change', handler)
    store.set('4417')
    expect(handler).not.toHaveBeenCalled()
    expect(localStorage.getItem(KEY)).toBe('another-tabs-secret')
  })

  it('reads persisted value from localStorage on construction', () => {
    localStorage.setItem(KEY, 'persisted-secret')
    const store = new SecretStore()
    expect(store.value).toBe('persisted-secret')
  })

  it('a tab with a zone of its own reads it, whatever another tab wrote since', () => {
    sessionStorage.setItem(ZONE, JSON.stringify({ room: 'downtown', secret: 'downtown' }))
    localStorage.setItem(KEY, 'xtab-b')
    expect(new SecretStore().value).toBe('downtown')
  })

  it('a cleared secret stays cleared', () => {
    localStorage.setItem(CLEARED_KEY, '1')
    const store = new SecretStore()
    expect(store.value).toBe('')
  })

  // ZI-7: the secret used to be seeded from the subdomain, so every visitor
  // of business-card.<domain> shared one zone whose secret was the host name.
  describe('never from the address bar', () => {
    for (const hostname of ['mysecret.hypercomb.io', 'deep.path.hypercomb.io', 'business-card.jwize.com', 'x.pages.dev']) {
      it(`${hostname} seeds no secret`, () => {
        const original = Object.getOwnPropertyDescriptor(window, 'location')!
        Object.defineProperty(window, 'location', { value: { hostname }, writable: true, configurable: true })
        try {
          expect(new SecretStore().value).toBe('')
          expect(localStorage.getItem(KEY)).toBeNull()
        } finally { Object.defineProperty(window, 'location', original) }
      })
    }
  })
})
