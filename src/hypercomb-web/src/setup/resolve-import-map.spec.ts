import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

let resolveImportMap: typeof import('./resolve-import-map').resolveImportMap

beforeAll(async () => {
  resolveImportMap = (await import('./resolve-import-map')).resolveImportMap
})

describe('resolveImportMap', () => {
  beforeEach(() => {
    delete (globalThis as { __hypercombAliasMap?: unknown }).__hypercombAliasMap
  })

  it('keeps namespace aliases as metadata while emitting only platform shims', async () => {
    const bagSig = 'a'.repeat(64)
    const dependencySig = 'b'.repeat(64)
    const alias = '@example.test/tools'
    const bagDir = {
      kind: 'directory',
      async *entries() { yield ['00000000', { kind: 'file' }] as const },
      async getFileHandle() {
        return { async getFile() { return { async text() { return `${alias}\n${dependencySig}\n` } } } }
      },
    }
    const dependencies = {
      async *entries() {
        yield [bagSig, bagDir] as const
        yield [`${dependencySig}.js`, { kind: 'file' }] as const
      },
    }
    const store = {
      opfsAvailable: true,
      dependencies,
      legacyDependencies: null,
      initialize: vi.fn(async () => {}),
    }
    ;(window as unknown as { ioc: unknown }).ioc = {
      get: (key: string) => key === '@hypercomb.social/Store' ? store : undefined,
    }

    await expect(resolveImportMap()).resolves.toEqual({
      '@hypercomb/core': '/hypercomb-core.runtime.js',
      'pixi.js': '/vendor/pixi.runtime.js',
    })
    expect((globalThis as { __hypercombAliasMap?: Map<string, string> }).__hypercombAliasMap)
      .toEqual(new Map([[alias, dependencySig]]))
  })
})
