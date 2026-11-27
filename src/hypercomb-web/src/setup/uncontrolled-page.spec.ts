// A page the service worker does not control (hard reload, DevTools "bypass
// for network", no worker at all) must still boot: nothing answers /opfs/
// there, so its dependency map carries self-typed blob URLs and is never
// cached for the next boot's early script.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

// resolve-import-map registers the Store at import; the map helpers need none of it.
vi.mock('@hypercomb/runtime/store', () => ({ Store: class {} }))
vi.mock('@hypercomb/runtime/core-surface', () => ({ CORE_RUNTIME_URL: '/hypercomb-core.runtime.js', pixiRuntimeUrl: () => '/vendor/pixi.runtime.js' }))
vi.mock('@hypercomb/runtime/install-index', () => ({ activeInstallIndex: () => null }))

const web = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('an uncontrolled page', () => {
  it('replays no cached /opfs/ map before the module graph loads', () => {
    const html = readFileSync(join(web, 'src/index.html'), 'utf8')
    const at = html.indexOf("localStorage.getItem('hc:importmap')")
    const early = html.slice(at - 800, at + 100)
    expect(early).toContain('navigator.serviceWorker.controller')
    expect(early).toMatch(/controlled \? localStorage\.getItem\('hc:importmap'\) : null/)
  })

  it('a blob map is session-bound; a worker-served map is not', async () => {
    const { sessionBound } = await import('./resolve-import-map')
    const sig = 'a'.repeat(64)
    expect(sessionBound({ '@x.com/atom': 'blob:https://hypercomb.io/1234' })).toBe(true)
    expect(sessionBound({ '@x.com/atom': `/opfs/${sig}/${sig}`, '@hypercomb/core': '/hypercomb-core.runtime.js' })).toBe(false)
    expect(sessionBound({})).toBe(false)
  })

  it('resolves an uncontrolled participant map to blob URLs and never caches it', async () => {
    const sig = 'b'.repeat(64)
    const bytes = new TextEncoder().encode('// @x.com/atom\nexport const atom = 1\n')
    const bag = {
      kind: 'directory',
      entries: async function* () { yield ['0000', { kind: 'file', getFile: async () => ({ text: async () => `@x.com/atom\n${sig}` }) }] },
      getFileHandle: async () => ({ getFile: async () => ({ text: async () => `@x.com/atom\n${sig}` }) }),
    }
    const pool = {
      entries: async function* () { yield [sig, bag]; yield [`${sig}.js`, { kind: 'file' }] },
    }
    const store = {
      initialize: async () => {},
      opfsAvailable: true,
      dependencies: pool,
      legacyDependencies: null,
      getDependencyBytes: async (s: string) => (s === sig ? bytes : null),
    }
    ;(window as any).ioc = { get: (k: string) => (k === '@hypercomb.social/Store' ? store : undefined) }
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { controller: null } })
    ;(globalThis as any).URL.createObjectURL = () => 'blob:https://hypercomb.io/atom'
    const { resolveImportMap, cacheImportMap, IMPORT_MAP_STORAGE_KEY } = await import('./resolve-import-map')
    const { Store } = await import('@hypercomb/runtime/store') as any
    Store.poolSignature = async () => 'c'.repeat(64)
    Store.DEPENDENCIES_MEANING = 'dependencies'

    const imports = await resolveImportMap()
    expect(imports['@x.com/atom']).toBe('blob:https://hypercomb.io/atom')

    localStorage.removeItem(IMPORT_MAP_STORAGE_KEY)
    await cacheImportMap()
    expect(localStorage.getItem(IMPORT_MAP_STORAGE_KEY)).toBeNull()

    // Controlled again: the worker-served map, and it is cached.
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { controller: {} } })
    const served = await resolveImportMap()
    expect(served['@x.com/atom']).toBe(`/opfs/${'c'.repeat(64)}/${sig}`)
    await cacheImportMap()
    expect(localStorage.getItem(IMPORT_MAP_STORAGE_KEY)).toContain('/opfs/')
  })

  // THE BROOD GATE (held-dependencies.ts). A held dependency draft sits in the
  // pool beside the trunk's bundle for its namespace; neither path may map it.
  describe('a held dependency draft', () => {
    const trunk = 'd'.repeat(64)
    const draft = 'e'.repeat(64)
    const pool = 'c'.repeat(64)
    const file = (text: string) => {
      const bytes = new TextEncoder().encode(text)
      return { kind: 'file', getFile: async () => ({ slice: () => ({ arrayBuffer: async () => bytes.buffer }) }) }
    }
    const bagNaming = (leaf: string) => ({
      kind: 'directory',
      entries: async function* () { yield ['0000', { kind: 'file' }] },
      getFileHandle: async () => ({ getFile: async () => ({ text: async () => `@x.com/ns\n${leaf}` }) }),
    })
    const boot = async (entries: [string, unknown][]) => {
      const store = {
        initialize: async () => {},
        opfsAvailable: true,
        dependencies: { entries: async function* () { yield* entries } },
        legacyDependencies: null,
        getDependencyBytes: async () => null,
      }
      ;(window as any).ioc = { get: (k: string) => (k === '@hypercomb.social/Store' ? store : undefined) }
      Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { controller: {} } })
      const { Store } = await import('@hypercomb/runtime/store') as any
      Store.poolSignature = async () => pool
      Store.DEPENDENCIES_MEANING = 'dependencies'
      const { resolveImportMap } = await import('./resolve-import-map')
      return resolveImportMap()
    }

    it('the flat scan skips it and maps the trunk, even when the draft is listed first', async () => {
      const { flagInBrood } = await import('@hypercomb/core')
      await flagInBrood(draft, { by: 'scan', reason: 'a draft of a dependency' }, { kind: 'own' })
      const imports = await boot([
        [`${draft}.js`, file('// @x.com/ns\nexport const v = 2\n')],
        [`${trunk}.js`, file('// @x.com/ns\nexport const v = 1\n')],
      ])
      expect(imports['@x.com/ns']).toBe(`/opfs/${pool}/${trunk}.js`)
      expect((globalThis as any).__hypercombAliasMap.get('@x.com/ns')).toBe(`${trunk}.js`)
    })

    it('a bag naming a held leaf keeps the rest of the bag, and leaves that namespace unmapped', async () => {
      // A trunk bag can name a held bundle (composeDependencies keeps every
      // trunk dependency; a dependency draft carried home held and then
      // committed into the trunk elsewhere): only that leaf is left out. The
      // other namespace still maps the bag's leaf, not an older file the pool
      // lists first; and the held one is filled by NO other file of its
      // namespace (the previous trunk's, a stale copy), which the trunk's bees
      // were never built against.
      const older = 'a'.repeat(64)
      const current = 'b'.repeat(64)
      const bag = {
        kind: 'directory',
        entries: async function* () { yield ['0000', { kind: 'file' }]; yield ['0001', { kind: 'file' }] },
        getFileHandle: async (n: string) => ({
          getFile: async () => ({ text: async () => (n === '0000' ? `@x.com/ns\n${draft}` : `@y.com/other\n${current}`) }),
        }),
      }
      const imports = await boot([
        [pool, bag],
        [`${older}.js`, file('// @y.com/other\nexport const v = 0\n')],
        [`${draft}.js`, file('// @x.com/ns\nexport const v = 2\n')],
        [`${trunk}.js`, file('// @x.com/ns\nexport const v = 1\n')],
        [`${current}.js`, file('// @y.com/other\nexport const v = 1\n')],
      ])
      expect(imports['@x.com/ns']).toBeUndefined()
      expect((globalThis as any).__hypercombAliasMap.has('@x.com/ns')).toBe(false)
      expect(imports['@y.com/other']).toBe(`/opfs/${pool}/${current}`)
    })

    it('a bag whose every leaf is held publishes its held namespaces, so the loader never scans an empty map', async () => {
      const imports = await boot([
        [pool, bagNaming(draft)],
        [`${draft}.js`, file('// @x.com/ns\nexport const v = 2\n')],
        [`${trunk}.js`, file('// @x.com/ns\nexport const v = 1\n')],
      ])
      expect(imports['@x.com/ns']).toBeUndefined()
      expect((globalThis as any).__hypercombAliasMap.size).toBe(0)
      expect([...(globalThis as any).__hypercombHeldAliases]).toEqual(['@x.com/ns'])
    })

    it('a bag naming the trunk still maps through the bag', async () => {
      const imports = await boot([
        [pool, bagNaming(trunk)],
        [`${draft}.js`, file('// @x.com/ns\nexport const v = 2\n')],
        [`${trunk}.js`, file('// @x.com/ns\nexport const v = 1\n')],
      ])
      expect(imports['@x.com/ns']).toBe(`/opfs/${pool}/${trunk}`)
    })
  })
})
