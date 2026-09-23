// script-preloader.boot-lane.spec.ts — THE BOOT LANE READS THE ROOT IT IS
// GIVEN. A shell that keeps its own install record (meadowverse) names its
// root; every other shell reads the live package. Either way the root's
// `bootBees` load before anything else asks for them.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { INSTALLED_KEY } from './installed-package'

vi.mock('@hypercomb/core', () => ({
  Bee: class {},
  EffectBus: { emit: vi.fn() },
  mayRunBee: async () => true,
}))

vi.mock('./store', () => ({ Store: class {} }))

const LIVE_ROOT = 'a'.repeat(64)
const MEADOW_ROOT = 'b'.repeat(64)
const LIVE_BOOT = 'c'.repeat(64)
const MEADOW_BOOT = 'd'.repeat(64)

const services = new Map<string, unknown>()
const ioc = {
  register: (key: string, value: unknown) => { if (!services.has(key)) services.set(key, value) },
  get: <T = unknown>(key: string): T | undefined => services.get(key) as T | undefined,
  has: (key: string): boolean => services.has(key),
  list: (): readonly string[] => [...services.keys()],
  onRegister: () => () => {},
  whenReady: () => {},
}

const loaded: string[] = []
const root = (bootBees: string[]) => new TextEncoder().encode(JSON.stringify({ name: 'root', cells: [], bees: bootBees, dependencies: [], bootBees }))
const store = {
  getLayerBytes: async (sig: string) => sig === LIVE_ROOT ? root([LIVE_BOOT]) : sig === MEADOW_ROOT ? root([MEADOW_BOOT]) : null,
  bees: {
    getFileHandle: async (name: string) => ({
      getFile: async () => ({ arrayBuffer: async () => new TextEncoder().encode(name).buffer as ArrayBuffer }),
    }),
  },
  legacyBees: undefined,
  getBee: async (sig: string) => {
    loaded.push(sig)
    return { iocKey: `@spec/${sig.slice(0, 4)}`, name: sig.slice(0, 4), pulse: async () => {} }
  },
  preheatResource: async () => undefined,
}

let ScriptPreloader: typeof import('./script-preloader')['ScriptPreloader']

beforeAll(async () => {
  ;(globalThis as unknown as { get: (key: string) => unknown }).get = key => key === '@hypercomb.social/Store' ? store : services.get(key)
  ;(globalThis as unknown as { register: typeof ioc.register }).register = ioc.register
  ;(window as unknown as { ioc: typeof ioc }).ioc = ioc
  ;({ ScriptPreloader } = await import('./script-preloader'))
})

beforeEach(() => {
  services.clear()
  loaded.length = 0
  localStorage.clear()
})

describe('ScriptPreloader.loadBootBees', () => {
  it('loads the boot bees of the live package when no root is named', async () => {
    localStorage.setItem(INSTALLED_KEY, LIVE_ROOT)
    await new ScriptPreloader().loadBootBees()
    expect(loaded).toEqual([LIVE_BOOT])
  })

  it('loads the boot bees of the root a shell names, even with no live package', async () => {
    await new ScriptPreloader().loadBootBees(MEADOW_ROOT)
    expect(loaded).toEqual([MEADOW_BOOT])
  })

  it('does nothing when there is no root at all', async () => {
    await new ScriptPreloader().loadBootBees(null)
    await new ScriptPreloader().loadBootBees()
    expect(loaded).toEqual([])
  })
})
