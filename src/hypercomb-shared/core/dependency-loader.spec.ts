import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { importSignatureModule } from './signature-module-loader'

vi.mock('./signature-module-loader', () => ({
  importSignatureModule: vi.fn(async () => ({ loaded: true })),
}))

vi.mock('./store', () => ({
  Store: class Store {
    static readonly DEPENDENCIES_MEANING = 'dependencies'
    static readonly poolSignature = vi.fn(async () => 'a'.repeat(64))
  },
}))

const values = new Map<string, unknown>()
let DependencyLoaderClass: typeof import('./dependency-loader').DependencyLoader

beforeAll(async () => {
  const getValue = (key: string): unknown => values.get(key)
  const registerValue = (key: string, value: unknown): void => { values.set(key, value) }
  Object.assign(globalThis, { get: getValue, register: registerValue })
  ;(window as unknown as { ioc: unknown }).ioc = { get: getValue, register: registerValue }
  DependencyLoaderClass = (await import('./dependency-loader')).DependencyLoader
})

describe('DependencyLoader signature addressing', () => {
  beforeEach(() => {
    vi.mocked(importSignatureModule).mockClear()
    values.clear()
    delete (globalThis as { __hypercombBeeDeps?: unknown }).__hypercombBeeDeps
  })

  it('uses the alias as metadata but imports the dependency by pool and content sig', async () => {
    const signature = 'b'.repeat(64)
    const moduleBytes = new TextEncoder().encode('// @example.test/tools\nexport const loaded = true\n')
    const file = {
      slice: (start: number, end: number) => ({
        arrayBuffer: async () => moduleBytes.slice(start, end).buffer,
      }),
    } as unknown as Blob
    const dependencyPool = {
      async *entries(): AsyncGenerator<[string, { kind: 'file'; getFile: () => Promise<Blob> }]> {
        yield [`${signature}.js`, { kind: 'file', getFile: async () => file }]
      },
    }
    values.set('@hypercomb.social/Store', {
      opfsAvailable: true,
      dependencies: dependencyPool,
      legacyDependencies: undefined,
    })
    const loader = new DependencyLoaderClass()

    await loader.load()

    expect(importSignatureModule).toHaveBeenCalledWith('a'.repeat(64), signature)
    expect(loader.loadedSignatures).toEqual([signature])
    expect(loader.failedSignatures).toEqual([])
  })
})
