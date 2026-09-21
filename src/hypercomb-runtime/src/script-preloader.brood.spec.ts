// The brood gate, where it actually bites: the single point at which a
// signature becomes running code. Held code must not merely fail to register
// — its bytes must never be read.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { INSTALLED_KEY } from './installed-package'

const held = new Set<string>()

vi.mock('@hypercomb/core', () => ({
  Bee: class {},
  EffectBus: { emit: vi.fn() },
  mayRunBee: async (sig: string) => !held.has(sig),
}))
vi.mock('./store', () => ({ Store: class {} }))

const signature = (character: string): string => character.repeat(64)
const ROOT = signature('a')
const HELD = signature('b')
const FREE = signature('c')

const services = new Map<string, unknown>()
const ioc = {
  register: (key: string, value: unknown) => { if (!services.has(key)) services.set(key, value) },
  unregister: (key: string) => { services.delete(key) },
  get: <T = unknown>(key: string): T | undefined => services.get(key) as T | undefined,
  has: (key: string): boolean => services.has(key),
  onRegister: () => () => {},
  whenReady: () => () => {},
}

let opened: string[] = []
let currentStore: Record<string, unknown> | null = null

const fakeStore = () => {
  opened = []
  const rootBytes = new TextEncoder().encode(JSON.stringify({
    name: 'root', cells: [], bees: [HELD, FREE], dependencies: [], criticalBees: [],
  }))
  return {
    getLayerBytes: async (sig: string) => sig === ROOT ? rootBytes : null,
    bees: {
      getFileHandle: async (name: string) => {
        const sig = name.replace(/\.js$/i, '')
        opened.push(sig)
        return { getFile: async () => ({ arrayBuffer: async () => new TextEncoder().encode(sig).buffer as ArrayBuffer }) }
      },
    },
    legacyBees: undefined,
    getBee: async (sig: string) => ({ iocKey: `@test/${sig.slice(0, 4)}`, name: sig.slice(0, 4), pulse: async () => {} }),
    preheatResource: async () => undefined,
  }
}

let ScriptPreloader: typeof import('./script-preloader')['ScriptPreloader']

beforeAll(async () => {
  ;(globalThis as unknown as { get: (key: string) => unknown }).get = (key) =>
    key === '@hypercomb.social/Store' ? currentStore : services.get(key)
  ;(globalThis as unknown as { register: (key: string, value: unknown) => void }).register = ioc.register
  ;(window as unknown as { ioc: typeof ioc }).ioc = ioc
  ;({ ScriptPreloader } = await import('./script-preloader'))
})

beforeEach(() => {
  services.clear()
  localStorage.clear()
  held.clear()
  currentStore = fakeStore()
  localStorage.setItem(INSTALLED_KEY, ROOT)
  localStorage.setItem('core-adapter.installed-manifest', JSON.stringify({
    version: 2, layers: [ROOT], bees: [HELD, FREE], dependencies: [],
  }))
})

describe('the brood gate in the loader', () => {
  it('never even reads the bytes of held code, and runs the rest', async () => {
    held.add(HELD)
    const preloader = new ScriptPreloader()
    await preloader.find('')
    expect(opened).not.toContain(HELD)
    expect(opened).toContain(FREE)
  })

  it('runs everything when nothing is held', async () => {
    const preloader = new ScriptPreloader()
    await preloader.find('')
    expect(opened).toEqual(expect.arrayContaining([HELD, FREE]))
  })
})
