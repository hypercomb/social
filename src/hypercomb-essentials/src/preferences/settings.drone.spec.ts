// The settings bee registers its own instance, as every drone does. The
// preloader knows a bee by the instance its module registered whose class the
// module exports; a bundle that only wires services (ZoomSettings, mobile
// mode) and never registers its drone was reported as "returned null from
// getBee()" on every load, though its wiring ran.

import { describe, expect, it, vi } from 'vitest'

const registered = vi.hoisted(() => {
  const map = new Map<string, unknown>()
  const w = (globalThis as unknown as { window?: Record<string, unknown> }).window ?? {}
  w['ioc'] = {
    register: (key: string, value: unknown) => { if (!map.has(key)) map.set(key, value) },
    get: (key: string) => map.get(key),
  }
  ;(globalThis as unknown as { window: unknown }).window = w
  return map
})

const mod = await import('./settings.drone.js')

describe('the settings bee', () => {
  it('registers an instance of the class it exports', () => {
    const own = [...registered.values()].filter(v => v instanceof mod.SettingsDrone)

    expect(own).toHaveLength(1)
    expect(registered.get('@diamondcoreprocessor.com/SettingsDrone')).toBe(own[0])
  })

  it('still wires zoom settings and mobile mode', () => {
    expect(registered.get('@diamondcoreprocessor.com/ZoomSettings')).toMatchObject({ minScale: expect.any(Number) })
    expect([...registered.keys()].length).toBeGreaterThanOrEqual(3)
  })
})
