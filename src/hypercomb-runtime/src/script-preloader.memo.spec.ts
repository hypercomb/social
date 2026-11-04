// hypercomb-runtime/src/script-preloader.memo.spec.ts
//
// find() is asked on every act. The walk is done once per package (install
// pointer + manifest text), and a bee that failed to load is remembered —
// reported once, not retried every act — until the package changes.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { INSTALLED_KEY } from './installed-package'

vi.mock('@hypercomb/core', () => ({
  Bee: class {},
  EffectBus: { emit: vi.fn(), on: vi.fn() },
  mayRunBee: async () => true,
}))
vi.mock('./store', () => ({ Store: class {} }))

const signature = (character: string): string => character.repeat(64)
const ROOT = signature('a')
const OTHER_ROOT = signature('9')
const PIXI = signature('b')
const SHOW = signature('c')
const BACKGROUND = signature('d')
const MISSING = signature('e')   // no module bytes anywhere
const BROKEN = signature('f')    // bytes, but the module evaluates to nothing
const ALL = [PIXI, SHOW, BACKGROUND, MISSING, BROKEN]

const KEYS: Record<string, string> = {
  [PIXI]: '@diamondcoreprocessor.com/PixiHostWorker',
  [SHOW]: '@diamondcoreprocessor.com/ShowCellDrone',
  [BACKGROUND]: '@diamondcoreprocessor.com/BackgroundDrone',
}

const services = new Map<string, unknown>()
const listeners = new Set<(key: string, value: unknown) => void>()
let currentStore: Record<string, unknown> | null = null

const ioc = {
  register: (key: string, value: unknown): void => {
    if (services.has(key)) return
    services.set(key, value)
    for (const listener of [...listeners]) listener(key, value)
  },
  unregister: (key: string) => { services.delete(key) },
  get: <T = unknown>(key: string): T | undefined => services.get(key) as T | undefined,
  has: (key: string): boolean => services.has(key),
  list: (): readonly string[] => [...services.keys()],
  onRegister: (listener: (key: string, value: unknown) => void): (() => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
  whenReady: <T = unknown>(key: string, callback: (value: T) => void): void => {
    const value = services.get(key)
    if (value !== undefined) callback(value as T)
  },
  graph: () => ({}),
}

const fakeStore = () => {
  const layerReads: string[] = []
  const opened: string[] = []
  const evaluated: string[] = []
  const rootBytes = new TextEncoder().encode(JSON.stringify({
    name: 'root', cells: [], bees: ALL, dependencies: [], criticalBees: [PIXI, SHOW, BACKGROUND],
  }))
  const store = {
    getLayerBytes: async (sig: string) => { layerReads.push(sig); return sig === ROOT || sig === OTHER_ROOT ? rootBytes : null },
    bees: {
      getFileHandle: async (name: string) => {
        const sig = name.replace(/\.js$/i, '')
        opened.push(sig)
        if (sig === MISSING) throw new Error('NotFoundError')
        return { getFile: async () => ({ arrayBuffer: async () => new TextEncoder().encode(sig).buffer as ArrayBuffer }) }
      },
    },
    legacyBees: undefined,
    getBee: async (sig: string) => {
      evaluated.push(sig)
      if (sig === BROKEN) return null
      const bee = { iocKey: KEYS[sig], name: sig.slice(0, 4), pulse: async () => {} }
      ioc.register(KEYS[sig], bee)
      if (sig === PIXI) ioc.register('@diamondcoreprocessor.com/Settings', {})
      if (sig === SHOW) {
        ioc.register('@diamondcoreprocessor.com/AxialService', {})
        ioc.register('@diamondcoreprocessor.com/LayoutService', {})
      }
      return bee
    },
    preheatResource: async () => undefined,
  }
  return { store, layerReads, opened, evaluated }
}

const publish = (root: string): void => {
  localStorage.setItem(INSTALLED_KEY, root)
  localStorage.setItem('core-adapter.installed-manifest', JSON.stringify({
    version: 2, layers: [root], bees: ALL, dependencies: [],
  }))
}

const nextTask = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

let ScriptPreloader: typeof import('./script-preloader')['ScriptPreloader']
let warn: ReturnType<typeof vi.spyOn>
let log: ReturnType<typeof vi.spyOn>

beforeAll(async () => {
  ;(globalThis as unknown as { get: (key: string) => unknown }).get = (key) =>
    key === '@hypercomb.social/Store' ? currentStore : services.get(key)
  ;(globalThis as unknown as { register: typeof ioc.register }).register = ioc.register
  ;(window as unknown as { ioc: typeof ioc }).ioc = ioc
  ;({ ScriptPreloader } = await import('./script-preloader'))
})

beforeEach(() => {
  services.clear()
  listeners.clear()
  localStorage.clear()
  currentStore = null
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  log = vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  warn.mockRestore()
  log.mockRestore()
})

/** One load attempt probes two file names (`<sig>.js`, then `<sig>`). */
const attemptsOn = (opened: readonly string[], sig: string): number => opened.filter(s => s === sig).length / 2

const walks = (): number => log.mock.calls.filter(call => String(call[0]).includes('walkLayers:')).length
const warnsAbout = (sig: string): number => warn.mock.calls.filter(call => String(call[0]).includes(sig)).length

describe('ScriptPreloader — one walk per package, failures remembered', () => {
  it('walks the layers once; later finds answer from the held walk', async () => {
    const harness = fakeStore()
    currentStore = harness.store
    publish(ROOT)
    const preloader = new ScriptPreloader()

    const first = await preloader.find('')
    await nextTask()
    const second = await preloader.find('alpha')
    const third = await preloader.find('')
    await nextTask()

    expect(walks()).toBe(1)
    expect(harness.layerReads).toEqual([ROOT])
    expect(first.length).toBeGreaterThan(0)
    expect(second.map(b => b.iocKey)).toEqual(third.map(b => b.iocKey))
  })

  it('a bee that did not load is reported once and never asked for again under the same package', async () => {
    const harness = fakeStore()
    currentStore = harness.store
    publish(ROOT)
    const preloader = new ScriptPreloader()

    await preloader.find('')
    await nextTask()
    await preloader.find('')
    await nextTask()
    await preloader.find('')
    await nextTask()

    expect(attemptsOn(harness.opened, MISSING)).toBe(1)
    expect(harness.evaluated.filter(sig => sig === BROKEN)).toHaveLength(1)
    expect(warnsAbout(MISSING)).toBe(1)
    expect(warnsAbout(BROKEN)).toBe(1)
    expect([...preloader.failedBees.keys()].sort()).toEqual([MISSING, BROKEN].sort())
    expect(preloader.failedBees.get(MISSING)).toBeInstanceOf(Error)
  })

  it('a new package forgets the failures and walks again', async () => {
    const harness = fakeStore()
    currentStore = harness.store
    publish(ROOT)
    const preloader = new ScriptPreloader()

    await preloader.find('')
    await nextTask()
    expect(preloader.failedBees.size).toBe(2)

    publish(OTHER_ROOT)
    await preloader.find('')
    await nextTask()

    expect(walks()).toBe(2)
    expect(harness.layerReads).toEqual([ROOT, OTHER_ROOT])
    expect(attemptsOn(harness.opened, MISSING)).toBe(2)
    expect(preloader.failedBees.size).toBe(2)
  })
})
