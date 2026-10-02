// games/arkanoid/theme.spec.ts
//
// The pluggable scene-theme slot: the registry resolves what is registered,
// falls back to the first theme when the pick is unknown, and the three shipped
// themes (haunted-keep, neon-grid, space-madness) are present and paint without
// throwing. Registries are built fresh per test; the module singleton is only
// checked for the IoC adoption rule.

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import {
  ARKANOID_THEMES_IOC_KEY, ThemeRegistry, bandFor, darkenHex,
  type ArkanoidTheme, type ThemeBand, type ThemeEnv,
} from './theme.js'
import { BUILT_IN_THEMES } from './themes/register-themes.js'

const LS_KEY = 'ark:theme'

const band = (name: string): ThemeBand => ({
  name, neon: '#ffffff', neonRgb: '255,255,255', accent: '#000000', accentRgb: '0,0,0',
  sky: ['#000000', '#111111', '#222222'], mist: '1,2,3',
})
const theme = (id: string, bands = 1): ArkanoidTheme => ({
  id, name: id.toUpperCase(),
  bands: Array.from({ length: bands }, (_, i) => band(`${id}-${i}`)),
  background: vi.fn(), atmosphere: vi.fn(),
})

/** A 2D context stand-in: every method is a no-op, gradients accept colour stops. */
function fakeContext(): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => {} }
  const target: Record<string, unknown> = {}
  return new Proxy(target, {
    get(t, key: string) {
      if (key in t) return t[key]
      if (key === 'createLinearGradient' || key === 'createRadialGradient' || key === 'createConicGradient') return () => gradient
      if (key === 'measureText') return () => ({ width: 10 })
      return () => {}
    },
    set(t, key: string, value) { t[key] = value; return true },
  }) as unknown as CanvasRenderingContext2D
}

beforeEach(() => { localStorage.clear() })
afterEach(() => { vi.unstubAllGlobals() })

describe('ThemeRegistry', () => {
  it('has no active theme until one registers', () => {
    const r = new ThemeRegistry()
    expect(r.list()).toEqual([])
    expect(r.active()).toBeNull()
    expect(r.activeId()).toBeNull()
  })

  it('resolves every registered theme by id', () => {
    const r = new ThemeRegistry()
    const a = theme('a'), b = theme('b'), c = theme('c')
    for (const t of [a, b, c]) r.register(t)
    expect(r.list()).toEqual([a, b, c])
    expect(r.get('a')).toBe(a)
    expect(r.get('b')).toBe(b)
    expect(r.get('c')).toBe(c)
  })

  it('makes the first registered theme active', () => {
    const r = new ThemeRegistry()
    r.register(theme('first')); r.register(theme('second'))
    expect(r.activeId()).toBe('first')
    expect(r.active()!.name).toBe('FIRST')
  })

  it('registering is idempotent by id', () => {
    const r = new ThemeRegistry()
    const first = theme('dup')
    r.register(first)
    r.register(theme('dup'))
    expect(r.list()).toHaveLength(1)
    expect(r.get('dup')).toBe(first)
  })

  it('announces change on register and on a successful pick', () => {
    const r = new ThemeRegistry()
    let changes = 0
    r.addEventListener('change', () => changes++)
    r.register(theme('a')); r.register(theme('b'))
    expect(changes).toBe(2)
    r.setActive('b')
    expect(changes).toBe(3)
  })

  it('list() is a copy', () => {
    const r = new ThemeRegistry()
    r.register(theme('a'))
    r.list().length = 0
    expect(r.list()).toHaveLength(1)
  })

  it('get() of an unknown id is undefined', () => {
    const r = new ThemeRegistry()
    r.register(theme('a'))
    expect(r.get('nope')).toBeUndefined()
  })

  it('setActive switches the active theme and persists the pick', () => {
    const r = new ThemeRegistry()
    r.register(theme('a')); r.register(theme('b'))
    r.setActive('b')
    expect(r.activeId()).toBe('b')
    expect(localStorage.getItem(LS_KEY)).toBe('b')
  })

  it('setActive of an unknown id is ignored: no change, no event, nothing stored', () => {
    const r = new ThemeRegistry()
    r.register(theme('a')); r.register(theme('b'))
    r.setActive('b')
    let changes = 0
    r.addEventListener('change', () => changes++)
    r.setActive('ghost')
    expect(r.activeId()).toBe('b')
    expect(changes).toBe(0)
    expect(localStorage.getItem(LS_KEY)).toBe('b')
  })

  it('an unknown stored pick falls back to the first registered theme', () => {
    localStorage.setItem(LS_KEY, 'uninstalled')
    const r = new ThemeRegistry()
    r.register(theme('a')); r.register(theme('b'))
    expect(r.activeId()).toBe('a')
    expect(r.active()!.id).toBe('a')
  })

  it('honours a stored pick when that theme registers, even if it arrives later', () => {
    localStorage.setItem(LS_KEY, 'b')
    const r = new ThemeRegistry()
    r.register(theme('a'))
    expect(r.activeId()).toBe('a')                           // the pick has not arrived yet: first wins
    r.register(theme('b'))
    expect(r.activeId()).toBe('b')                           // it arrives: the pick takes over
  })

  it('survives localStorage refusing writes', () => {
    const r = new ThemeRegistry()
    r.register(theme('a')); r.register(theme('b'))
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(() => r.setActive('b')).not.toThrow()
    expect(r.activeId()).toBe('b')
    spy.mockRestore()
  })

  it('survives localStorage refusing reads', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    const r = new ThemeRegistry()
    expect(() => r.register(theme('a'))).not.toThrow()
    expect(r.activeId()).toBe('a')
    spy.mockRestore()
  })
})

describe('the shipped themes', () => {
  it('lists the three built-ins in picker order', () => {
    expect(BUILT_IN_THEMES.map(t => t.id)).toEqual(['haunted-keep', 'neon-grid', 'space-madness'])
    expect(BUILT_IN_THEMES.map(t => t.name)).toEqual(['Haunted Keep', 'Neon Grid', 'Space Madness'])
  })

  it('registers into a registry and every one resolves', () => {
    const r = new ThemeRegistry()
    for (const t of BUILT_IN_THEMES) r.register(t)
    for (const id of ['haunted-keep', 'neon-grid', 'space-madness']) {
      expect(r.get(id), id).toBeDefined()
      expect(r.get(id)!.id).toBe(id)
    }
    expect(r.activeId()).toBe('haunted-keep')
  })

  it('an unknown pick falls back to the first built-in', () => {
    localStorage.setItem(LS_KEY, 'no-such-theme')
    const r = new ThemeRegistry()
    for (const t of BUILT_IN_THEMES) r.register(t)
    expect(r.get('no-such-theme')).toBeUndefined()
    expect(r.active()!.id).toBe('haunted-keep')
  })

  it('picking one of them sticks', () => {
    const r = new ThemeRegistry()
    for (const t of BUILT_IN_THEMES) r.register(t)
    r.setActive('space-madness')
    expect(r.active()!.id).toBe('space-madness')
  })

  it.each(BUILT_IN_THEMES.map(t => [t.id, t] as const))('%s has a complete palette', (_id, t) => {
    expect(t.bands.length).toBeGreaterThan(0)
    for (const b of t.bands) {
      expect(b.name.length).toBeGreaterThan(0)
      expect(b.neon).toMatch(/^#[0-9a-f]{6}$/i)
      expect(b.accent).toMatch(/^#[0-9a-f]{6}$/i)
      expect(b.neonRgb).toMatch(/^\d{1,3},\d{1,3},\d{1,3}$/)
      expect(b.accentRgb).toMatch(/^\d{1,3},\d{1,3},\d{1,3}$/)
      expect(b.mist).toMatch(/^\d{1,3},\d{1,3},\d{1,3}$/)
      expect(b.sky).toHaveLength(3)
      for (const s of b.sky) expect(s).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it.each(BUILT_IN_THEMES.map(t => [t.id, t] as const))('%s paints its background and atmosphere on every band', (_id, t) => {
    const ctx = fakeContext()
    t.bands.forEach((b, i) => {
      const env: ThemeEnv = { W: 554.4, H: 600, time: 3.7, pulse: 0.5, band: b, levelIndex: i * 4 }
      expect(() => t.background(ctx, env)).not.toThrow()
      expect(() => t.atmosphere(ctx, env)).not.toThrow()
    })
  })
})

describe('bandFor', () => {
  it('moves to the next band every four levels, then cycles', () => {
    const t = theme('x', 3)
    const names = [0, 1, 3, 4, 7, 8, 11, 12, 13].map(i => bandFor(t, i).name)
    expect(names).toEqual(['x-0', 'x-0', 'x-0', 'x-1', 'x-1', 'x-2', 'x-2', 'x-0', 'x-0'])
  })

  it('always lands inside a built-in theme\'s bands, even at wall 99', () => {
    for (const t of BUILT_IN_THEMES) {
      for (let i = 0; i < 100; i++) expect(t.bands).toContain(bandFor(t, i))
    }
  })
})

describe('darkenHex', () => {
  it('scales each channel toward black', () => {
    expect(darkenHex('#ffffff', 0.5)).toBe('rgb(127,127,127)')
    expect(darkenHex('#102030', 0.5)).toBe('rgb(8,16,24)')
  })
  it('defaults to 0.45 and k=0 is black', () => {
    expect(darkenHex('#ffffff')).toBe('rgb(114,114,114)')
    expect(darkenHex('#abcdef', 0)).toBe('rgb(0,0,0)')
  })
  it('k=1 keeps the colour', () => {
    expect(darkenHex('#336699', 1)).toBe('rgb(51,102,153)')
  })
})

describe('the singleton registry', () => {
  it('adopts the instance already registered in IoC instead of minting its own', async () => {
    const shared = new ThemeRegistry()
    vi.stubGlobal('ioc', { get: (key: string) => key === ARKANOID_THEMES_IOC_KEY ? shared : undefined })
    vi.resetModules()
    const fresh = await import('./theme.js')
    expect(fresh.arkanoidThemes).toBe(shared)
  })

  it('mints its own when IoC does not hold one', async () => {
    vi.stubGlobal('ioc', { get: () => undefined })
    vi.resetModules()
    const fresh = await import('./theme.js')
    expect(fresh.arkanoidThemes).toBeInstanceOf(fresh.ThemeRegistry)
  })

  it('is registered under the documented IoC key', () => {
    expect(ARKANOID_THEMES_IOC_KEY).toBe('@diamondcoreprocessor.com/ArkanoidThemes')
  })
})
