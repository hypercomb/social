// hypercomb-shared/core/boot-pulses.spec.ts
//
// THE BOOT CENSUS. One cold boot of the web shell, driven end to end through
// the real processor (`hypercomb.act`), the real resolver (`ScriptPreloader`
// over a fake store) and the real `BootstrapHistory`, with the web shell's
// `startRegisteredBees` reduced to the lines that pulse. Every pulse is
// counted per bee and per grammar, every `synchronize` is counted, and the
// numbers are asserted — so the next owner who adds a pulse path sees the
// census move.
//
// The contract under test (documentation/doctrine.codex `D4`, and the
// processor's own single-flight rule): each bee's heartbeat runs ONCE per
// grammar it senses on a cold boot, `synchronize` is dispatched once per
// coalesced pass and only by the processor, and a deep link still reaches
// every bee with every segment.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { INSTALLED_KEY } from '../../hypercomb-runtime/src/installed-package'

vi.mock('@hypercomb/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@hypercomb/core')>()),
  // Nothing is held in the brood here; the gate has its own spec.
  mayRunBee: async () => true,
}))
vi.mock('../../hypercomb-runtime/src/store', () => ({ Store: class {} }))

const signature = (character: string): string => character.repeat(64)

const ROOT = signature('a')
const PIXI = signature('b')
const SHOW = signature('c')
const BACKGROUND = signature('d')
const LATE = signature('e')
const REST = signature('f')
const CRITICAL = [PIXI, SHOW, BACKGROUND]
const ALL = [...CRITICAL, LATE, REST]

const KEYS: Record<string, string> = {
  [PIXI]: '@diamondcoreprocessor.com/PixiHostWorker',
  [SHOW]: '@diamondcoreprocessor.com/ShowCellDrone',
  [BACKGROUND]: '@diamondcoreprocessor.com/BackgroundDrone',
  [LATE]: '@test.com/LateDrone',
  [REST]: '@test.com/RestDrone',
}
const NAMES: Record<string, string> = {
  [PIXI]: 'pixi', [SHOW]: 'show', [BACKGROUND]: 'background', [LATE]: 'late', [REST]: 'rest',
}

type RegisterListener = (key: string, value: unknown) => void

const services = new Map<string, unknown>()
const listeners = new Set<RegisterListener>()
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
  onRegister: (listener: RegisterListener): (() => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
  whenReady: <T = unknown>(key: string, callback: (value: T) => void): void => {
    const value = services.get(key)
    if (value !== undefined) callback(value as T)
  },
  graph: () => ({}),
}

/** pulses[bee name][grammar] = how many times that heartbeat ran. */
type Census = Record<string, Record<string, number>>

const fakeStore = (lateGate: Promise<void>) => {
  const pulses: Census = Object.fromEntries(ALL.map(sig => [NAMES[sig], {}]))
  const rootBytes = new TextEncoder().encode(JSON.stringify({
    name: 'root', cells: [], bees: ALL, dependencies: [], criticalBees: CRITICAL,
  }))
  const store = {
    getLayerBytes: async (sig: string) => sig === ROOT ? rootBytes : null,
    bees: {
      getFileHandle: async (name: string) => ({
        getFile: async () => ({
          arrayBuffer: async () => new TextEncoder().encode(name).buffer as ArrayBuffer,
        }),
      }),
    },
    legacyBees: undefined,
    getBee: async (sig: string) => {
      if (sig === LATE) await lateGate
      const key = KEYS[sig]
      const bee = {
        iocKey: key,
        name: NAMES[sig],
        pulse: async (grammar: string) => {
          const mine = pulses[NAMES[sig]]
          mine[grammar] = (mine[grammar] ?? 0) + 1
        },
      }
      ioc.register(key, bee)
      if (sig === PIXI) ioc.register('@diamondcoreprocessor.com/Settings', {})
      if (sig === SHOW) {
        ioc.register('@diamondcoreprocessor.com/AxialService', {})
        ioc.register('@diamondcoreprocessor.com/LayoutService', {})
      }
      return bee
    },
    preheatResource: async () => undefined,
  }
  return { store, pulses }
}

const publishRoot = (): void => {
  localStorage.setItem(INSTALLED_KEY, ROOT)
  localStorage.setItem('core-adapter.installed-manifest', JSON.stringify({
    version: 2, layers: [ROOT], bees: ALL, dependencies: [],
  }))
}

const tick = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/** Wait until the census has not moved for `quietMs` (bounded). */
const settle = async (pulses: Census, read: () => number, quietMs = 350, maxMs = 4000): Promise<void> => {
  const started = Date.now()
  let last = JSON.stringify(pulses) + read()
  let quietSince = Date.now()
  while (Date.now() - started < maxMs) {
    await tick(50)
    const now = JSON.stringify(pulses) + read()
    if (now !== last) { last = now; quietSince = Date.now() }
    else if (Date.now() - quietSince >= quietMs) return
  }
}

let ScriptPreloader: typeof import('../../hypercomb-runtime/src/script-preloader')['ScriptPreloader']
let BootstrapHistory: typeof import('./bootstrap-history')['BootstrapHistory']
let CompletionUtility: typeof import('./completion-utility')['CompletionUtility']
let core: typeof import('@hypercomb/core')

beforeAll(async () => {
  ;(globalThis as unknown as { get: (key: string) => unknown }).get = (key) =>
    key === '@hypercomb.social/Store' ? currentStore : services.get(key)
  ;(globalThis as unknown as { register: typeof ioc.register }).register = ioc.register
  ;(globalThis as unknown as { list: typeof ioc.list }).list = ioc.list
  ;(window as unknown as { ioc: typeof ioc }).ioc = ioc
  core = await import('@hypercomb/core')
  ;({ ScriptPreloader } = await import('../../hypercomb-runtime/src/script-preloader'))
  ;({ BootstrapHistory } = await import('./bootstrap-history'))
  ;({ CompletionUtility } = await import('./completion-utility'))
})

let synchronizes = 0
let logs: ReturnType<typeof vi.spyOn>[] = []
const onSynchronize = (): void => { synchronizes++ }

beforeEach(() => {
  services.clear()
  listeners.clear()
  localStorage.clear()
  core.EffectBus.clear()
  currentStore = null
  synchronizes = 0
  window.addEventListener('synchronize', onSynchronize)
  logs = [
    vi.spyOn(console, 'log').mockImplementation(() => {}),
    vi.spyOn(console, 'warn').mockImplementation(() => {}),
  ]
})

afterEach(() => {
  window.removeEventListener('synchronize', onSynchronize)
  for (const spy of logs) spy.mockRestore()
})

/**
 * The web shell's `startRegisteredBees` (hypercomb-web/src/app/app.ts),
 * reduced to the lines that pulse. Kept in step with the shell by hand: the
 * census below is only as honest as this copy.
 */
const webShellStart = async (): Promise<void> => {
  const { hypercomb } = core
  await new hypercomb().act('')
}

/** One cold boot at `path`. Returns the census once everything has settled. */
const coldBoot = async (path: string): Promise<{ pulses: Census; synchronizes: number; finds: number }> => {
  let releaseLate: () => void = () => {}
  const lateGate = new Promise<void>(resolve => { releaseLate = resolve })
  const harness = fakeStore(lateGate)
  currentStore = harness.store
  publishRoot()

  const preloader = new ScriptPreloader()
  const find = vi.spyOn(preloader, 'find')
  ioc.register('@hypercomb.social/ScriptPreloader', preloader)
  ioc.register(core.BEE_RESOLVER_KEY, preloader)
  ioc.register('@hypercomb.social/CompletionUtility', new CompletionUtility())

  window.history.replaceState(null, '', path)

  // The runtime initializer runs BootstrapHistory (Phase 1 restores the URL,
  // Phase 2 waits for the first settled frame) before the shell's
  // ngAfterViewInit starts the bees.
  await new BootstrapHistory().run()
  await webShellStart()

  // The renderer publishes its settled frame for the restored location; the
  // late bee lands after the first pass, as a real background load does.
  const segments = path.split('/').filter(Boolean)
  core.EffectBus.emit('render:cell-count', { locationKey: segments.length ? `/${segments.join('/')}` : '/', settled: true, count: 1 })
  releaseLate()

  await settle(harness.pulses, () => synchronizes)
  if (process.env['HC_CENSUS']) console.info('CENSUS', path, JSON.stringify({ pulses: harness.pulses, synchronizes, finds: find.mock.calls.length }))
  return { pulses: harness.pulses, synchronizes, finds: find.mock.calls.length }
}

describe('boot census — one owner, one pass', () => {
  it('cold boot at /: every bee pulses once with the empty grammar', async () => {
    const census = await coldBoot('/')
    for (const name of Object.values(NAMES)) {
      expect(census.pulses[name], name).toEqual({ '': 1 })
    }
    // The first pass (`act('')`) and the late bee's arrival pass.
    expect(census.synchronizes).toBe(2)
  })

  it('cold boot at a three-segment deep link: once per grammar, nothing lost', async () => {
    const census = await coldBoot('/alpha/beta/gamma')
    for (const sig of [PIXI, SHOW, BACKGROUND, REST]) {
      expect(census.pulses[NAMES[sig]], NAMES[sig]).toEqual({ '': 1, alpha: 1, beta: 1, gamma: 1 })
    }
    // The late bee arrived after the first pass: its first pulse is the
    // processor's arrival pass, and every segment pass that ran after it
    // landed reached it too.
    expect(census.pulses[NAMES[LATE]]['']).toBe(1)
    for (const grammar of Object.keys(census.pulses[NAMES[LATE]])) {
      expect(census.pulses[NAMES[LATE]][grammar], `late/${grammar}`).toBe(1)
    }
    // First pass, the segments (coalesced into at most two passes by the
    // latch), and the arrival.
    expect(census.synchronizes).toBeGreaterThanOrEqual(3)
    expect(census.synchronizes).toBeLessThanOrEqual(5)
  })
})
