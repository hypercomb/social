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
vi.mock('@hypercomb/runtime/core-surface', () => ({ CORE_RUNTIME_URL: '/hypercomb-core.runtime.js' }))
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
})
