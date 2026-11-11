import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { INSTALLED_KEY } from './installed-package'

// ON AND OFF WHILE THE HIVE RUNS (jwize, 2026-11-10: "shouldn't we be able to
// add and remove features in realtime from the hosts window?").
//
// The hosts window rewrites the activation record from held bytes and asks the
// preloader to make the running hive match it. These hold the contract: what
// came on loads in the processor's own pass, what went off is disposed and
// leaves the registry, a sleeping queen goes with her package — and whenever a
// restart is the only honest way, the answer is false and nothing has moved.

let active: { find(grammar: string): Promise<Array<{ pulse(grammar: string): Promise<void> }>> } | null = null

vi.mock('@hypercomb/core', () => ({
  Bee: class {},
  EffectBus: { emit: vi.fn(), on: vi.fn() },
  mayRunBee: async () => true,
  // The processor, as far as the preloader is concerned: one pass asks the
  // resolver what to pulse, and pulses it.
  hypercomb: class {
    act = async (): Promise<void> => {
      for (const bee of await active!.find('')) await bee.pulse('')
    }
  },
}))

vi.mock('./store', () => ({ Store: class {} }))

const signature = (character: string): string => character.repeat(64)

const ROOT = signature('a')
const GAME = signature('b')    // lets go while the hive runs: it declares dispose()
const TOOL = signature('c')    // wires by hand and declares nothing
const QUEEN = signature('d')   // asleep until her word
const BUNDLE = signature('e')  // a namespace bundle
const OTHER_BUNDLE = signature('f')

const KEYS: Record<string, string> = {
  [GAME]: '@diamondcoreprocessor.com/GameDrone',
  [TOOL]: '@diamondcoreprocessor.com/ToolDrone',
  [QUEEN]: '@diamondcoreprocessor.com/PlayQueenBee',
}

const services = new Map<string, unknown>()
const listeners = new Set<(key: string, value: unknown) => void>()
const GAME_QUEEN_KEY = '@diamondcoreprocessor.com/GameQueenBee'
const GAME_SERVICE_KEY = '@diamondcoreprocessor.com/GameService'
let currentStore: Record<string, unknown> | null = null

const ioc = {
  register: (key: string, value: unknown) => {
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
  whenReady: (): void => undefined,
}

const fakeStore = () => {
  const loads: string[] = []
  const pulses = new Map<string, number>()
  const disposed: string[] = []
  const rootBytes = new TextEncoder().encode(JSON.stringify({
    name: 'root',
    cells: [],
    bees: [GAME, TOOL, QUEEN],
    dependencies: [BUNDLE],
    docs: { bees: { [QUEEN]: { className: 'PlayQueenBee', command: 'play', description: 'Play', passive: true } } },
  }))
  const store = {
    getLayerBytes: async (sig: string) => sig === ROOT ? rootBytes : null,
    bees: {
      getFileHandle: async (name: string) => ({
        getFile: async () => ({ arrayBuffer: async () => new TextEncoder().encode(name).buffer as ArrayBuffer }),
      }),
    },
    legacyBees: undefined,
    getBee: async (sig: string) => {
      loads.push(sig)
      // A module evaluates in a task of its own, never in another's run.
      await new Promise<void>(resolve => { setTimeout(resolve, 0) })
      const bee: Record<string, unknown> = {
        iocKey: KEYS[sig],
        name: KEYS[sig]!.split('/').pop(),
        pulse: async () => { pulses.set(sig, (pulses.get(sig) ?? 0) + 1) },
        markDisposed: () => { disposed.push(sig) },
      }
      if (sig !== TOOL) bee['dispose'] = () => undefined
      ioc.register(KEYS[sig]!, bee)
      // THE BEE WIRES: the game's module registers its queen and a service too.
      if (sig === GAME) {
        ioc.register(GAME_QUEEN_KEY, { command: 'game', markDisposed: () => { disposed.push('queen') } })
        ioc.register(GAME_SERVICE_KEY, { plays: true })
      }
      return bee
    },
    preheatResource: async () => undefined,
  }
  return { store, loads, pulses, disposed }
}

const record = (bees: readonly string[], dependencies: readonly string[] = [BUNDLE]): void => {
  localStorage.setItem(INSTALLED_KEY, ROOT)
  localStorage.setItem('core-adapter.installed-manifest', JSON.stringify({ version: 2, layers: [ROOT], bees, dependencies }))
}

let ScriptPreloader: typeof import('./script-preloader')['ScriptPreloader']

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
  delete (globalThis as { __HC_MODULE_ROOT__?: unknown }).__HC_MODULE_ROOT__
  currentStore = null
  active = null
})

const boot = async (bees: readonly string[]) => {
  const harness = fakeStore()
  currentStore = harness.store
  record(bees)
  const preloader = new ScriptPreloader()
  active = preloader as unknown as typeof active
  for (const bee of await preloader.find('')) await bee.pulse('')
  return { preloader, ...harness }
}

describe('ScriptPreloader.recompose — on and off while the hive runs', () => {
  it('a package turned off is disposed and leaves the registry, and nothing else is touched', async () => {
    const { preloader, disposed, loads } = await boot([GAME, TOOL])
    expect(services.has(KEYS[GAME]!)).toBe(true)

    record([TOOL])
    expect(await preloader.recompose()).toBe(true)

    expect(disposed).toEqual([GAME, 'queen'])
    expect(services.has(KEYS[GAME]!)).toBe(false)
    expect(services.has(KEYS[TOOL]!)).toBe(true)
    expect(loads).toEqual([GAME, TOOL])
  })

  it('what its module registered beside it goes too, the queen disposed and the service gone, and comes back with it', async () => {
    const { preloader } = await boot([GAME, TOOL])
    const queen = services.get(GAME_QUEEN_KEY)
    expect(queen).toBeTruthy()
    expect(services.has(GAME_SERVICE_KEY)).toBe(true)

    record([TOOL])
    expect(await preloader.recompose()).toBe(true)
    expect(services.has(GAME_QUEEN_KEY)).toBe(false)
    expect(services.has(GAME_SERVICE_KEY)).toBe(false)
    // Nothing is left listening once the loads are done.
    expect(listeners.size).toBe(0)

    record([GAME, TOOL])
    expect(await preloader.recompose()).toBe(true)
    await new Promise<void>(resolve => { setTimeout(resolve, 5) })
    expect(services.get(GAME_QUEEN_KEY)).toBeTruthy()
    expect(services.get(GAME_QUEEN_KEY)).not.toBe(queen)
    expect(services.has(GAME_SERVICE_KEY)).toBe(true)
  })

  it('a package turned on loads and is pulsed in the same pass', async () => {
    const { preloader, pulses, loads } = await boot([TOOL])
    expect(services.has(KEYS[GAME]!)).toBe(false)

    record([GAME, TOOL])
    expect(await preloader.recompose()).toBe(true)

    expect(loads).toEqual([TOOL, GAME])
    expect(services.has(KEYS[GAME]!)).toBe(true)
    expect(pulses.get(GAME)).toBe(1)
  })

  it('off and on again in one session: the bee is evaluated anew', async () => {
    const { preloader, loads } = await boot([GAME, TOOL])
    record([TOOL])
    expect(await preloader.recompose()).toBe(true)
    record([GAME, TOOL])
    expect(await preloader.recompose()).toBe(true)
    expect(loads).toEqual([GAME, TOOL, GAME])
    expect(services.has(KEYS[GAME]!)).toBe(true)
  })

  it('a running bee with no dispose() is never half switched off: false, and nothing has moved', async () => {
    const { preloader, disposed } = await boot([GAME, TOOL])

    record([GAME])
    expect(await preloader.recompose()).toBe(false)

    expect(disposed).toEqual([])
    expect(services.has(KEYS[TOOL]!)).toBe(true)
  })

  it('a record naming other namespace bundles needs the restart: the import map is bound at load', async () => {
    const { preloader, disposed } = await boot([GAME, TOOL])

    record([TOOL], [BUNDLE, OTHER_BUNDLE])
    expect(await preloader.recompose()).toBe(false)
    record([TOOL], [OTHER_BUNDLE])
    expect(await preloader.recompose()).toBe(false)

    expect(disposed).toEqual([])
  })

  it('a bee evicted earlier does not come back by a stable address: the browser would not run it again', async () => {
    const { preloader, loads } = await boot([GAME, TOOL])
    record([TOOL])
    expect(await preloader.recompose()).toBe(true)

    ;(globalThis as { __HC_MODULE_ROOT__?: boolean }).__HC_MODULE_ROOT__ = true
    record([GAME, TOOL])
    expect(await preloader.recompose()).toBe(false)
    expect(loads).toEqual([GAME, TOOL])
  })

  it('a queen asleep goes with her package, and comes back asleep', async () => {
    const { preloader, loads } = await boot([GAME, TOOL, QUEEN])
    expect(preloader.sleepingWords().map(entry => entry.command)).toEqual(['play'])
    expect(loads).not.toContain(QUEEN)

    record([GAME, TOOL])
    expect(await preloader.recompose()).toBe(true)
    expect(preloader.sleepingWords()).toEqual([])
    expect(await preloader.wakeWord('play')).toBeNull()

    record([GAME, TOOL, QUEEN])
    expect(await preloader.recompose()).toBe(true)
    expect(preloader.sleepingWords().map(entry => entry.command)).toEqual(['play'])
    expect(loads).not.toContain(QUEEN)
  })

  it('a record that did not change is already running', async () => {
    const { preloader, loads } = await boot([GAME, TOOL])
    expect(await preloader.recompose()).toBe(true)
    expect(loads).toEqual([GAME, TOOL])
  })

  it('answers false before any package has been walked', async () => {
    currentStore = fakeStore().store
    record([GAME, TOOL])
    expect(await new ScriptPreloader().recompose()).toBe(false)
  })
})
