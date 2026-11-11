import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { INSTALLED_KEY } from './installed-package'

// THE VIEW YOU ARE IN GOES FIRST (jwize, 2026-11-11: "any list can be expanded
// warmed up and it is optimized and it is shown first in any race if you are
// in the view and its resources as well").
//
// The background queues — the resource preheat above all — only fill spare
// time. While a view is being entered, a word said or a window read, they
// wait; the view's own resources are warmed at once; then the queue carries on.

let active: { find(grammar: string): Promise<Array<{ pulse(grammar: string): Promise<void> }>> } | null = null

vi.mock('@hypercomb/core', () => ({
  Bee: class {},
  EffectBus: { emit: vi.fn(), on: vi.fn() },
  mayRunBee: async () => true,
  hypercomb: class {
    act = async (): Promise<void> => {
      for (const bee of await active!.find('')) await bee.pulse('')
    }
  },
}))

vi.mock('./store', () => ({ Store: class {} }))

const signature = (character: string): string => character.repeat(64)

const ROOT = signature('a')
const VIEW_LAYER = signature('b')
const TOOL = signature('c')       // runs from the start
const LIFT = signature('d')       // a view, asleep until entered
const PACKAGE_PICTURES = [signature('1'), signature('2'), signature('3'), signature('4'), signature('5'), signature('6')]
const LIFT_PICTURE = signature('7')

const KEYS: Record<string, string> = {
  [TOOL]: '@diamondcoreprocessor.com/ToolDrone',
  [LIFT]: '@diamondcoreprocessor.com/LiftView',
}

const services = new Map<string, unknown>()
const ioc = {
  register: (key: string, value: unknown) => { if (!services.has(key)) services.set(key, value) },
  unregister: (key: string) => { services.delete(key) },
  get: <T = unknown>(key: string): T | undefined => services.get(key) as T | undefined,
  has: (key: string): boolean => services.has(key),
  list: (): readonly string[] => [...services.keys()],
  onRegister: (): (() => void) => () => undefined,
  whenReady: (): void => undefined,
}
let currentStore: Record<string, unknown> | null = null

const fakeStore = () => {
  const warmed: string[] = []
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
  const layers: Record<string, Uint8Array> = {
    [ROOT]: bytes({ name: 'root', cells: [VIEW_LAYER], bees: [TOOL], dependencies: [], resources: PACKAGE_PICTURES }),
    [VIEW_LAYER]: bytes({
      name: 'lift', cells: [], bees: [LIFT], dependencies: [], resources: [LIFT_PICTURE],
      docs: { bees: { [LIFT]: { className: 'LiftView', passive: true, renders: ['lift'] } } },
    }),
  }
  const store = {
    getLayerBytes: async (sig: string) => layers[sig] ?? null,
    bees: {
      getFileHandle: async (name: string) => ({
        getFile: async () => ({ arrayBuffer: async () => new TextEncoder().encode(name).buffer as ArrayBuffer }),
      }),
    },
    legacyBees: undefined,
    getBee: async (sig: string) => {
      const bee = { iocKey: KEYS[sig], pulse: async () => undefined, markDisposed: () => undefined, dispose: () => undefined }
      ioc.register(KEYS[sig]!, bee)
      return bee
    },
    preheatResource: async (sig: string) => { warmed.push(sig) },
  }
  return { store, warmed }
}

let ScriptPreloader: typeof import('./script-preloader')['ScriptPreloader']

beforeAll(async () => {
  ;(globalThis as unknown as { get: (key: string) => unknown }).get = (key) =>
    key === '@hypercomb.social/Store' ? currentStore : services.get(key)
  ;(globalThis as unknown as { register: typeof ioc.register }).register = ioc.register
  ;(window as unknown as { ioc: typeof ioc }).ioc = ioc
  ;({ ScriptPreloader } = await import('./script-preloader'))
})

/** Idle time, one callback per macrotask, as a browser would hand it out. */
const idle = (): void => {
  ;(globalThis as { requestIdleCallback?: (run: () => void) => void }).requestIdleCallback = run => { setTimeout(run, 0) }
}
const tick = (n = 1) => new Promise<void>(resolve => { let left = n; const step = () => (--left <= 0 ? resolve() : setTimeout(step, 0)); setTimeout(step, 0) })

beforeEach(() => {
  services.clear()
  localStorage.clear()
  currentStore = null
  active = null
  idle()
})

const boot = async () => {
  const harness = fakeStore()
  currentStore = harness.store
  localStorage.setItem(INSTALLED_KEY, ROOT)
  localStorage.setItem('core-adapter.installed-manifest', JSON.stringify({ version: 2, layers: [ROOT, VIEW_LAYER], bees: [TOOL, LIFT], dependencies: [] }))
  const preloader = new ScriptPreloader()
  active = preloader as unknown as typeof active
  for (const bee of await preloader.find('')) await bee.pulse('')
  return { preloader, ...harness }
}

describe('ScriptPreloader — the view you are in goes first', () => {
  it('nothing in the background moves while a view holds the foreground, and the queue carries on after', async () => {
    const { preloader, warmed } = await boot()
    let release!: () => void
    const held = preloader.foreground(() => new Promise<void>(resolve => { release = resolve }))

    await tick(20)
    expect(warmed).toEqual([])

    release()
    await held
    await tick(20)
    expect(warmed.filter(sig => PACKAGE_PICTURES.includes(sig)).sort()).toEqual([...PACKAGE_PICTURES].sort())
  })

  it('entering a view warms that view\'s own resources at once, ahead of the package\'s', async () => {
    const { preloader, warmed } = await boot()
    expect(services.has(KEYS[LIFT]!)).toBe(false)

    await preloader.wakeView('lift')

    expect(services.has(KEYS[LIFT]!)).toBe(true)
    expect(warmed[0]).toBe(LIFT_PICTURE)
    await tick(20)
    // Warmed once: the idle queue skips what the view already took.
    expect(warmed.filter(sig => sig === LIFT_PICTURE)).toHaveLength(1)
  })

  it('a window holds the foreground through IoC, and what it throws still lets the background go', async () => {
    const { preloader, warmed } = await boot()
    await expect(preloader.foreground(async () => { throw new Error('host down') })).rejects.toThrow('host down')
    await tick(20)
    expect(warmed.length).toBeGreaterThan(0)
  })
})
