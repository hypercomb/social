// script-preloader.flavour.spec.ts — ONE FLAVOUR PER CLASS. A landing spot's
// behaviour loads beside the package; when the package carries a bee of the
// same class, the spot's choice runs and the package's copy never loads, so
// no IoC key is registered twice. The same bytes are the same flavour.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { INSTALLED_KEY } from './installed-package'

vi.mock('@hypercomb/core', () => ({
  Bee: class {},
  EffectBus: { emit: vi.fn() },
  mayRunBee: async () => true,
}))

vi.mock('./store', () => ({ Store: class {} }))

const ROOT = 'a'.repeat(64)
const PACKAGE_SHOW = 'b'.repeat(64)
const PACKAGE_OTHER = 'c'.repeat(64)
const SPOT_SHOW = 'd'.repeat(64)
const NEED = 'e'.repeat(64)
const CLASS: Record<string, string> = { [PACKAGE_SHOW]: 'ShowCellDrone', [SPOT_SHOW]: 'ShowCellDrone', [PACKAGE_OTHER]: 'OtherDrone' }

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
const root = new TextEncoder().encode(JSON.stringify({
  name: 'root', cells: [], bees: [PACKAGE_SHOW, PACKAGE_OTHER], dependencies: [],
  docs: { bees: { [PACKAGE_SHOW]: { className: 'ShowCellDrone' }, [PACKAGE_OTHER]: { className: 'OtherDrone' } } },
}))
const store = {
  getLayerBytes: async (sig: string) => sig === ROOT ? root : null,
  bees: {
    getFileHandle: async (name: string) => ({
      getFile: async () => ({ arrayBuffer: async () => new TextEncoder().encode(name).buffer as ArrayBuffer }),
    }),
  },
  legacyBees: undefined,
  getBee: async (sig: string) => {
    loaded.push(sig)
    return { iocKey: `@diamondcoreprocessor.com/${CLASS[sig]}`, pulse: async () => {} }
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
  delete (globalThis as { __hypercombBeeDeps?: unknown }).__hypercombBeeDeps
  localStorage.setItem(INSTALLED_KEY, ROOT)
  localStorage.setItem('core-adapter.installed-manifest', JSON.stringify({ layers: [ROOT] }))
})

describe('the flavour rule', () => {
  it("runs a spot's flavour of a class instead of the package's", async () => {
    const preloader = new ScriptPreloader()
    expect(await preloader.loadBeside([SPOT_SHOW], { [SPOT_SHOW]: [NEED] })).toBe(1)
    // Its closure is claimed, so the preloader asks for all of it at once.
    expect((globalThis as { __hypercombBeeDeps?: unknown }).__hypercombBeeDeps).toEqual({ [SPOT_SHOW]: [NEED] })
    await preloader.find('')
    expect(loaded).toEqual(expect.arrayContaining([SPOT_SHOW, PACKAGE_OTHER]))
    expect(loaded).not.toContain(PACKAGE_SHOW)
  })

  it('displaces nothing when the spot names the bytes the package carries', async () => {
    const preloader = new ScriptPreloader()
    await preloader.loadBeside([PACKAGE_SHOW])
    await preloader.find('')
    expect(loaded.filter(sig => sig === PACKAGE_SHOW)).toHaveLength(1)
    expect(loaded).toContain(PACKAGE_OTHER)
  })

  it('leaves a bee the installed package runs to the package, loaded once', async () => {
    localStorage.setItem('core-adapter.installed-manifest', JSON.stringify({ layers: [ROOT], bees: [PACKAGE_SHOW, PACKAGE_OTHER] }))
    const preloader = new ScriptPreloader()
    expect(await preloader.loadBeside([PACKAGE_SHOW], { [PACKAGE_SHOW]: [NEED] })).toBe(0)
    expect(loaded).toEqual([])
    // The package loads it as it always has: nothing is claimed for it.
    expect((globalThis as { __hypercombBeeDeps?: unknown }).__hypercombBeeDeps).toBeUndefined()
    await preloader.find('')
    expect(loaded.filter(sig => sig === PACKAGE_SHOW)).toHaveLength(1)
  })

  it('leaves the package whole when no spot chose anything', async () => {
    await new ScriptPreloader().find('')
    expect(loaded).toEqual(expect.arrayContaining([PACKAGE_SHOW, PACKAGE_OTHER]))
  })
})
