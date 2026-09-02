// One definition of "mobile". MobileModeService stamps what it decides on
// <html> — data-hc-mobile and data-hc-orientation — so a stylesheet keys on
// the SAME fact the drones read, and `/mobile on|off` drives the whole shell.
// jsdom has no matchMedia; the one here answers from a table the test edits
// and fires the change listeners the service registered.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { MOBILE_MODE_EFFECT, MOBILE_MODE_KEY } from './mobile-pheromones.js'

const COARSE = '(pointer: coarse)'
const PHONE = '(max-width: 599px), (max-height: 449px)'
const LANDSCAPE = '(orientation: landscape)'

type Query = { matches: boolean; listeners: Set<() => void> }
const queries = new Map<string, Query>()
const query = (media: string): Query => {
  let hit = queries.get(media)
  if (!hit) { hit = { matches: false, listeners: new Set() }; queries.set(media, hit) }
  return hit
}
const matchMedia = (media: string): MediaQueryList => {
  const hit = query(media)
  return {
    media,
    get matches() { return hit.matches },
    addEventListener: (_type: string, fn: () => void) => { hit.listeners.add(fn) },
    removeEventListener: (_type: string, fn: () => void) => { hit.listeners.delete(fn) },
  } as unknown as MediaQueryList
}
/** The device changed: flip a query and tell whoever listens. */
const device = (media: string, matches: boolean): void => {
  const hit = query(media)
  hit.matches = matches
  for (const fn of [...hit.listeners]) fn()
}

const registrations = new Map<string, unknown>()
;(globalThis as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => registrations.set(key, value),
  get: (key: string) => registrations.get(key),
  whenReady: () => void 0,
}
Object.defineProperty(window, 'matchMedia', { value: matchMedia, configurable: true, writable: true })

const { MobileModeService } = await import('./mobile-mode.service.js')
// The module-level singleton subscribed to the same table; it must not stamp
// over the instances under test when the table changes.
for (const hit of queries.values()) hit.listeners.clear()

const root = (): DOMStringMap => document.documentElement.dataset

beforeEach(() => {
  localStorage.clear()
  for (const hit of queries.values()) { hit.matches = false; hit.listeners.clear() }
  delete root().hcMobile
  delete root().hcOrientation
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('one definition of mobile — the stamp on <html>', () => {
  it('stamps off and portrait for a desktop at construction', () => {
    const service = new MobileModeService()
    expect(service.active).toBe(false)
    expect(root().hcMobile).toBe('off')
    expect(root().hcOrientation).toBe('portrait')
  })

  it('stamps on when the device is a phone — coarse pointer AND phone-shaped', () => {
    device(COARSE, true)
    expect(new MobileModeService().active).toBe(false)
    expect(root().hcMobile).toBe('off')
    device(PHONE, true)
    expect(new MobileModeService().active).toBe(true)
    expect(root().hcMobile).toBe('on')
  })

  it('/mobile on|off drives the stamp; auto returns to detection', () => {
    const service = new MobileModeService()
    service.setOverride('on')
    expect(root().hcMobile).toBe('on')
    expect(localStorage.getItem(MOBILE_MODE_KEY)).toBe('on')
    service.setOverride('off')
    expect(root().hcMobile).toBe('off')
    service.setOverride('auto')
    expect(root().hcMobile).toBe('off')
    expect(localStorage.getItem(MOBILE_MODE_KEY)).toBeNull()
  })

  it('follows the device turning, with no mode change', () => {
    const service = new MobileModeService()
    const changed = vi.fn()
    service.addEventListener('change', changed)
    device(LANDSCAPE, true)
    expect(root().hcOrientation).toBe('landscape')
    device(LANDSCAPE, false)
    expect(root().hcOrientation).toBe('portrait')
    expect(changed).not.toHaveBeenCalled()
  })

  it('re-stamps when the device becomes a phone in hand', () => {
    const service = new MobileModeService()
    device(COARSE, true)
    device(PHONE, true)
    expect(service.active).toBe(true)
    expect(root().hcMobile).toBe('on')
  })

  it('keeps the mobile:mode effect exactly as it was — { active }', () => {
    const service = new MobileModeService()
    const seen: unknown[] = []
    const off = EffectBus.on(MOBILE_MODE_EFFECT, p => { seen.push(p) })
    service.setOverride('on')
    off()
    expect(seen.at(-1)).toEqual({ active: true })
  })

  it('reads the viewport when there is no matchMedia at all', () => {
    Object.defineProperty(window, 'matchMedia', { value: undefined, configurable: true, writable: true })
    Object.defineProperty(window, 'innerWidth', { value: 844, configurable: true, writable: true })
    Object.defineProperty(window, 'innerHeight', { value: 390, configurable: true, writable: true })
    try {
      new MobileModeService()
      expect(root().hcMobile).toBe('off')
      expect(root().hcOrientation).toBe('landscape')
    } finally {
      Object.defineProperty(window, 'matchMedia', { value: matchMedia, configurable: true, writable: true })
    }
  })
})
