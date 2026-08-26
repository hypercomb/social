import { describe, it, expect, beforeEach, vi } from 'vitest'

;(globalThis as any).register = vi.fn()

const KEY = 'hc:room'

class RoomStore extends EventTarget {
  #value: string
  public get value(): string { return this.#value }

  constructor() {
    super()
    this.#value = this.#read()
    if (!this.#value) {
      const extracted = RoomStore.extractSubdomain()
      if (extracted) this.set(extracted)
    }
  }

  public set = (room: string): void => {
    const clean = (room ?? '').trim()
    this.#value = clean
    this.#write(clean)
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

describe('RoomStore', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('starts empty on localhost with no stored value', () => {
    const store = new RoomStore()
    expect(store.value).toBe('')
  })

  it('set() persists to localStorage', () => {
    const store = new RoomStore()
    store.set('my-room')
    expect(store.value).toBe('my-room')
    expect(localStorage.getItem(KEY)).toBe('my-room')
  })

  it('set() trims whitespace', () => {
    const store = new RoomStore()
    store.set('  padded  ')
    expect(store.value).toBe('padded')
  })

  it('clear() removes from localStorage', () => {
    const store = new RoomStore()
    store.set('room')
    store.clear()
    expect(store.value).toBe('')
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('dispatches change event on set()', () => {
    const store = new RoomStore()
    const handler = vi.fn()
    store.addEventListener('change', handler)
    store.set('abc')
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('dispatches change event on clear()', () => {
    const store = new RoomStore()
    store.set('room')
    const handler = vi.fn()
    store.addEventListener('change', handler)
    store.clear()
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('reads persisted value from localStorage on construction', () => {
    localStorage.setItem(KEY, 'persisted-room')
    const store = new RoomStore()
    expect(store.value).toBe('persisted-room')
  })

  describe('extractSubdomain()', () => {
    it('returns empty for localhost', () => {
      expect(RoomStore.extractSubdomain()).toBe('')
    })

    it('returns subdomain for 3-part hostname', () => {
      const original = Object.getOwnPropertyDescriptor(window, 'location')!
      Object.defineProperty(window, 'location', {
        value: { hostname: 'myroom.hypercomb.io' },
        writable: true,
        configurable: true,
      })
      expect(RoomStore.extractSubdomain()).toBe('myroom')
      Object.defineProperty(window, 'location', original)
    })

    it('returns empty for IP addresses', () => {
      const original = Object.getOwnPropertyDescriptor(window, 'location')!
      Object.defineProperty(window, 'location', {
        value: { hostname: '10.0.0.1' },
        writable: true,
        configurable: true,
      })
      expect(RoomStore.extractSubdomain()).toBe('')
      Object.defineProperty(window, 'location', original)
    })
  })
})
