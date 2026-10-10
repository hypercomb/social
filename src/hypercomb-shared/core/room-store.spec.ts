// core/room-store.spec.ts — the room is THIS tab's.
//
// The origin-wide `hc:room` only pre-fills a NEW tab; a tab that has a zone
// of its own (sessionStorage `hc:mesh-zone`) reads that first, so a reload
// comes back in the room it was in whatever another tab wrote since. Setting
// the value it already holds does nothing — no write, no 'change' (the swarm
// tears down on 'change', and a no-op save used to send a {left}).
//
// Runs against the real module; its module-scope register() is stubbed.

import { describe, it, expect, beforeEach, vi } from 'vitest'

;(globalThis as { register?: unknown }).register = vi.fn()

const { RoomStore } = await import('./room-store')

const KEY = 'hc:room'
const ZONE = 'hc:mesh-zone'

describe('RoomStore', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('starts empty on localhost with no stored value', () => {
    const store = new RoomStore()
    expect(store.value).toBe('')
  })

  it('set() persists to localStorage (the new-tab pre-fill) and to this tab\'s zone', () => {
    const store = new RoomStore()
    store.set('my-room')
    expect(store.value).toBe('my-room')
    expect(localStorage.getItem(KEY)).toBe('my-room')
    expect(JSON.parse(sessionStorage.getItem(ZONE)!)).toMatchObject({ room: 'my-room' })
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

  it('set() with the value it already holds fires nothing and writes nothing', () => {
    const store = new RoomStore()
    store.set('meetup')
    // Another tab moves the origin-wide pair; this tab saves its own unchanged.
    localStorage.setItem(KEY, 'elsewhere')
    const handler = vi.fn()
    store.addEventListener('change', handler)
    store.set('meetup')
    store.set('  meetup ')
    expect(handler).not.toHaveBeenCalled()
    expect(localStorage.getItem(KEY)).toBe('elsewhere')
  })

  it('clear() on an empty room fires nothing', () => {
    const store = new RoomStore()
    const handler = vi.fn()
    store.addEventListener('change', handler)
    store.clear()
    expect(handler).not.toHaveBeenCalled()
  })

  it('reads persisted value from localStorage on construction', () => {
    localStorage.setItem(KEY, 'persisted-room')
    const store = new RoomStore()
    expect(store.value).toBe('persisted-room')
  })

  it('a tab with a zone of its own reads it, whatever another tab wrote since', () => {
    sessionStorage.setItem(ZONE, JSON.stringify({ room: 'downtown', secret: 'downtown' }))
    localStorage.setItem(KEY, 'xtab-b') // another tab joined another meeting
    expect(new RoomStore().value).toBe('downtown')
  })

  it('a tab whose own room is empty keeps it empty (its answer, not a gap)', () => {
    sessionStorage.setItem(ZONE, JSON.stringify({ room: '' }))
    localStorage.setItem(KEY, 'someone-elses')
    expect(new RoomStore().value).toBe('')
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
