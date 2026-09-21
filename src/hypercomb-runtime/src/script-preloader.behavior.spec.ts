import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { INSTALLED_KEY } from './installed-package'

vi.mock('@hypercomb/core', () => ({
  Bee: class {},
  EffectBus: { emit: vi.fn() },
  // Nothing is held in the brood in these tests; the gate's own behaviour
  // lives in script-preloader.brood.spec.ts.
  mayRunBee: async () => true,
}))

vi.mock('./store', () => ({ Store: class {} }))

const signature = (character: string): string => character.repeat(64)

const ROOT = signature('a')
const PIXI = signature('b')
const SHOW = signature('c')
const BACKGROUND = signature('d')
const REST = signature('e')
const CRITICAL = [PIXI, SHOW, BACKGROUND]
const ALL = [...CRITICAL, REST]

const PIXI_KEY = '@diamondcoreprocessor.com/PixiHostWorker'
const SHOW_KEY = '@diamondcoreprocessor.com/ShowCellDrone'
const BACKGROUND_KEY = '@diamondcoreprocessor.com/BackgroundDrone'

type Registered = (key: string, value: unknown) => void
type RegisterListener = (key: string, value: unknown) => void

const services = new Map<string, unknown>()
const listeners = new Set<RegisterListener>()
let currentStore: Record<string, unknown> | null = null

const ioc = {
  register: ((key, value) => {
    if (services.has(key)) return
    services.set(key, value)
    for (const listener of [...listeners]) listener(key, value)
  }) as Registered,
  unregister: (key: string) => { services.delete(key) },
  get: <T = unknown>(key: string): T | undefined => services.get(key) as T | undefined,
  has: (key: string): boolean => services.has(key),
  list: (): readonly string[] => [...services.keys()],
  onRegister: (listener: RegisterListener): (() => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
  whenReady: <T = unknown>(key: string, callback: (value: T) => void): void => {
    const value = services.get(key)
    if (value !== undefined) callback(value as T)
  },
  graph: (): Record<string, { deps: string[]; listens: string[]; emits: string[] }> => ({}),
}

type FakeStoreOptions = {
  criticalGate?: Promise<void>
  criticalBees?: readonly string[]
  fail?: string
  restGate?: Promise<void>
}

const fakeStore = ({ criticalGate, criticalBees = CRITICAL, fail, restGate }: FakeStoreOptions = {}) => {
  const started: string[] = []
  const pulses = new Map<string, number>(ALL.map(sig => [sig, 0]))
  const rootBytes = new TextEncoder().encode(JSON.stringify({
    name: 'root',
    cells: [],
    bees: ALL,
    dependencies: [],
    criticalBees,
  }))

  const registerCriticalServices = (sig: string, bee: unknown): void => {
    if (sig === PIXI) {
      ioc.register(PIXI_KEY, bee)
      ioc.register('@diamondcoreprocessor.com/Settings', {})
    } else if (sig === SHOW) {
      ioc.register(SHOW_KEY, bee)
      ioc.register('@diamondcoreprocessor.com/AxialService', {})
      ioc.register('@diamondcoreprocessor.com/LayoutService', {})
    } else if (sig === BACKGROUND) {
      ioc.register(BACKGROUND_KEY, bee)
    }
  }

  const store = {
    getLayerBytes: async (sig: string) => sig === ROOT ? rootBytes : null,
    bees: {
      getFileHandle: async (name: string) => {
        const sig = name.replace(/\.js$/i, '')
        started.push(sig)
        return {
          getFile: async () => ({
            arrayBuffer: async () => new TextEncoder().encode(sig).buffer as ArrayBuffer,
          }),
        }
      },
    },
    legacyBees: undefined,
    getBee: async (sig: string) => {
      if (criticalGate && CRITICAL.includes(sig)) await criticalGate
      if (restGate && sig === REST) await restGate
      if (sig === fail) return null
      const key = sig === PIXI ? PIXI_KEY
        : sig === SHOW ? SHOW_KEY
        : sig === BACKGROUND ? BACKGROUND_KEY
        : '@diamondcoreprocessor.com/RestDrone'
      const bee = {
        iocKey: key,
        name: key.split('/').pop(),
        pulse: async () => { pulses.set(sig, (pulses.get(sig) ?? 0) + 1) },
      }
      registerCriticalServices(sig, bee)
      return bee
    },
    preheatResource: async () => undefined,
  }

  return { store, started, pulses }
}

const publishRoot = (): void => {
  localStorage.setItem(INSTALLED_KEY, ROOT)
  localStorage.setItem('core-adapter.installed-manifest', JSON.stringify({
    version: 2,
    layers: [ROOT],
    bees: ALL,
    dependencies: [],
  }))
}

const nextTask = async (): Promise<void> => {
  await new Promise<void>(resolve => { setTimeout(resolve, 0) })
}

let ScriptPreloader: typeof import('./script-preloader')['ScriptPreloader']

beforeAll(async () => {
  ;(globalThis as unknown as { get: (key: string) => unknown }).get = (key) =>
    key === '@hypercomb.social/Store' ? currentStore : services.get(key)
  ;(globalThis as unknown as { register: Registered }).register = ioc.register
  ;(window as unknown as { ioc: typeof ioc }).ioc = ioc
  ;({ ScriptPreloader } = await import('./script-preloader'))
})

beforeEach(() => {
  services.clear()
  listeners.clear()
  localStorage.clear()
  delete (globalThis as { __hypercombBeeDeps?: unknown }).__hypercombBeeDeps
  currentStore = null
})

describe('ScriptPreloader priority scheduling', () => {
  it('exposes registered readable artifacts through the preloader and caches reads by signature', async () => {
    const sourceSig = 'f'.repeat(64)
    const readArtifact = vi.fn(async (requested: string) => requested === sourceSig
      ? {
          name: 'hypercomb-essentials/src/assistant/hive-tree-reader.ts',
          sig: sourceSig,
          of: 'bee' as const,
          type: 'text/typescript',
          bytes: new TextEncoder().encode('export class HypercombHiveTreeReader {}'),
        }
      : null)

    const preloader = new ScriptPreloader()
    preloader.registerReadableArtifacts({
      entries: async () => [{
        name: 'hypercomb-essentials/src/assistant/hive-tree-reader.ts',
        sig: sourceSig,
        of: 'bee',
        type: 'text/typescript',
      }],
      readArtifact,
    })

    await expect(preloader.readableArtifacts()).resolves.toMatchObject([{
      name: 'hypercomb-essentials/src/assistant/hive-tree-reader.ts',
      sig: sourceSig,
      of: 'bee',
      type: 'text/typescript',
    }])
    expect(await preloader.readArtifact(sourceSig)).toMatchObject({ sig: sourceSig, type: 'text/typescript' })
    expect(await preloader.readArtifact(sourceSig)).toMatchObject({ sig: sourceSig, type: 'text/typescript' })
    expect(readArtifact).toHaveBeenCalledTimes(1)
  })

  it('starts only the signed critical wave first and pulses every bee once', async () => {
    let releaseCritical: () => void = () => {}
    const criticalGate = new Promise<void>(resolve => { releaseCritical = resolve })
    const harness = fakeStore({ criticalGate })
    currentStore = harness.store
    publishRoot()

    const preloader = new ScriptPreloader()
    const finding = preloader.find('')
    await nextTask()

    expect(new Set(harness.started)).toEqual(new Set(CRITICAL))
    expect(harness.started).not.toContain(REST)

    releaseCritical()
    const encounter = await finding
    expect(harness.started).toContain(REST)

    for (const bee of encounter) await bee.pulse('')
    await nextTask()

    expect([...harness.pulses.values()]).toEqual([1, 1, 1, 1])
  })

  it('falls back to every bee when a hinted critical module fails', async () => {
    const harness = fakeStore({ fail: SHOW })
    currentStore = harness.store
    publishRoot()

    const preloader = new ScriptPreloader()
    const encounter = await preloader.find('')
    for (const bee of encounter) await bee.pulse('')
    await nextTask()

    expect(new Set(harness.started)).toEqual(new Set(ALL))
    expect(listeners.size).toBe(0)
    expect(harness.pulses.get(SHOW)).toBe(0)
    expect(harness.pulses.get(PIXI)).toBe(1)
    expect(harness.pulses.get(BACKGROUND)).toBe(1)
    expect(harness.pulses.get(REST)).toBe(1)
  })

  it('gives a genuinely late background bee exclusive pulse ownership', async () => {
    let releaseRest: () => void = () => {}
    const restGate = new Promise<void>(resolve => { releaseRest = resolve })
    const harness = fakeStore({ restGate })
    currentStore = harness.store
    publishRoot()

    const preloader = new ScriptPreloader()
    const encounter = await preloader.find('')
    for (const bee of encounter) await bee.pulse('')

    expect(harness.started).toContain(REST)
    expect(harness.pulses.get(REST)).toBe(0)

    releaseRest()
    await nextTask()
    expect([...harness.pulses.values()]).toEqual([1, 1, 1, 1])
  })

  it('rejects a partial root hint and starts the ordinary cold wave', async () => {
    let releaseCritical: () => void = () => {}
    const criticalGate = new Promise<void>(resolve => { releaseCritical = resolve })
    const harness = fakeStore({ criticalGate, criticalBees: [PIXI, SHOW] })
    currentStore = harness.store
    publishRoot()

    const preloader = new ScriptPreloader()
    const finding = preloader.find('')
    await nextTask()

    expect(new Set(harness.started)).toEqual(new Set(ALL))

    releaseCritical()
    const encounter = await finding
    for (const bee of encounter) await bee.pulse('')
    await nextTask()
    expect([...harness.pulses.values()]).toEqual([1, 1, 1, 1])
  })
})
