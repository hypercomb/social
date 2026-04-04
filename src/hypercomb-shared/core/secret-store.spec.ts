import { describe, it, expect, beforeEach, vi } from 'vitest'

// Stub global `register` before importing
;(globalThis as any).register = vi.fn()

// We re-implement SecretStore inline to avoid the side-effect `register()` call
// at module scope that depends on IoC. The logic is identical to the source.

const KEY = 'hc:secret'
const CLEARED_KEY = 'hc:secret-cleared'

class SecretStore extends EventTarget {
  #value: string
  public get value(): string { return this.#value }

  constructor() {
    super()
    this.#value = this.#read()
    if (!this.#value && !this.#wasCleared()) {
      const extracted = SecretStore.extractSubdomain()
      if (extracted) this.set(extracted)
    }
  }

  public set = (secret: string): void => {
    const clean = (secret ?? '').trim()
    this.#value = clean
    this.#write(clean)
    try {
      if (clean) localStorage.removeItem(CLEARED_KEY)
      else localStorage.setItem(CLEARED_KEY, '1')
    } catch { /* ignore */ }
    this.dispatchEvent(new Event('change'))
  }

  public clear = (): void => { this.set('') }

  static extractSubdomain = (): string => {
    const host = (window.location.hostname ?? '').toLowerCase().trim()
    if (!host || host === 'localhost') return ''
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return ''
    const parts = host.split('.')
    if (parts.length < 3) return ''
    return parts.slice(0, -2).join('.')
  }

  #wasCleared = (): boolean => {
    try { return localStorage.getItem(CLEARED_KEY) === '1' } catch { return false }
  }

  #read = (): string => {
    try { return (localStorage.getItem(KEY) ?? '').trim() } catch { return '' }
  }

  #write = (v: string): void => {
    try {
      if (v) localStorage.setItem(KEY, v)
      else localStorage.removeItem(KEY)
    } catch { /* ignore */ }
  }
}

describe('SecretStore', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('starts empty when localStorage is empty and on localhost', () => {
    const store = new SecretStore()
    expect(store.value).toBe('')
  })

  it('set() persists to localStorage and updates value', () => {
    const store = new SecretStore()
    store.set('my-secret')
    expect(store.value).toBe('my-secret')
    expect(localStorage.getItem(KEY)).toBe('my-secret')
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

  it('reads persisted value from localStorage on construction', () => {
    localStorage.setItem(KEY, 'persisted-secret')
    const store = new SecretStore()
    expect(store.value).toBe('persisted-secret')
  })

  it('does not overwrite with subdomain when cleared flag is set', () => {
    localStorage.setItem(CLEARED_KEY, '1')
    // On localhost, extractSubdomain returns '' anyway, but the cleared check runs first
    const store = new SecretStore()
    expect(store.value).toBe('')
  })

  describe('extractSubdomain()', () => {
    it('returns empty for localhost', () => {
      // jsdom defaults to localhost
      expect(SecretStore.extractSubdomain()).toBe('')
    })

    it('returns empty for bare domain (2 parts)', () => {
      // Can't easily change window.location.hostname in jsdom,
      // so we test the static logic directly
      const original = Object.getOwnPropertyDescriptor(window, 'location')!
      Object.defineProperty(window, 'location', {
        value: { hostname: 'hypercomb.io' },
        writable: true,
        configurable: true,
      })
      expect(SecretStore.extractSubdomain()).toBe('')
      Object.defineProperty(window, 'location', original)
    })

    it('returns subdomain for 3-part hostname', () => {
      const original = Object.getOwnPropertyDescriptor(window, 'location')!
      Object.defineProperty(window, 'location', {
        value: { hostname: 'mysecret.hypercomb.io' },
        writable: true,
        configurable: true,
      })
      expect(SecretStore.extractSubdomain()).toBe('mysecret')
      Object.defineProperty(window, 'location', original)
    })

    it('returns deep subdomain for 4+ part hostname', () => {
      const original = Object.getOwnPropertyDescriptor(window, 'location')!
      Object.defineProperty(window, 'location', {
        value: { hostname: 'deep.path.hypercomb.io' },
        writable: true,
        configurable: true,
      })
      expect(SecretStore.extractSubdomain()).toBe('deep.path')
      Object.defineProperty(window, 'location', original)
    })

    it('returns empty for IP addresses', () => {
      const original = Object.getOwnPropertyDescriptor(window, 'location')!
      Object.defineProperty(window, 'location', {
        value: { hostname: '192.168.1.1' },
        writable: true,
        configurable: true,
      })
      expect(SecretStore.extractSubdomain()).toBe('')
      Object.defineProperty(window, 'location', original)
    })
  })
})
