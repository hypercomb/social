// A published website has no early import map: index.visitor.html replays
// none, so the map appended at boot IS its map on every visit, and a reload
// could only land back in the same place. The visitor therefore never warns
// that it is "reloading once" (it never does); it asks the browser whether the
// late map was taken, and warns only when it was not.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

// resolve-import-map registers the Store at import; the map helpers need none of it.
vi.mock('@hypercomb/runtime/store', () => ({ Store: class {} }))
vi.mock('@hypercomb/runtime/core-surface', () => ({ CORE_RUNTIME_URL: '/hypercomb-core.runtime.js', pixiRuntimeUrl: () => '/vendor/pixi.runtime.js' }))
vi.mock('@hypercomb/runtime/install-index', () => ({ activeInstallIndex: () => null }))

const web = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const base = 'https://door.example/'
const sig = 'a'.repeat(64)
const imports = {
  '@x.com/atom': `/${sig}`,
  '@y.com/blob': 'blob:https://door.example/1234',
}

describe('a late import map', () => {
  it('is live when the browser resolves every alias to the URL the map names', async () => {
    const { lateMapLive } = await import('./resolve-import-map')
    const browser = (specifier: string): string => new URL(imports[specifier as keyof typeof imports], base).href
    expect(lateMapLive(imports, browser, base)).toBe(true)
  })

  it('is not live when the browser refuses the bare specifier (the late map was ignored)', async () => {
    const { lateMapLive } = await import('./resolve-import-map')
    const ignored = (specifier: string): string => {
      throw new TypeError(`Failed to resolve module specifier "${specifier}"`)
    }
    expect(lateMapLive(imports, ignored, base)).toBe(false)
  })

  it('is not live when an alias resolves anywhere but where the map points', async () => {
    const { lateMapLive } = await import('./resolve-import-map')
    const stale = (specifier: string): string => specifier === '@x.com/atom'
      ? `${base}${'b'.repeat(64)}`
      : new URL(imports[specifier as keyof typeof imports], base).href
    expect(lateMapLive(imports, stale, base)).toBe(false)
  })

  it('cannot be judged by a browser that cannot be asked', async () => {
    const { lateMapLive } = await import('./resolve-import-map')
    expect(lateMapLive(imports, undefined, base)).toBeNull()
  })

  it('the visitor asks the browser before, and instead of, the reload guard', () => {
    const main = readFileSync(join(web, 'src/main.ts'), 'utf8')
    const attach = main.slice(main.indexOf('const attachImportMap'), main.indexOf('const bootstrap'))
    const asked = attach.indexOf('lateMapLive(')
    const guard = attach.indexOf('sessionStorage.getItem(IMPORT_MAP_STORAGE_KEY)')
    expect(asked).toBeGreaterThan(0)
    expect(guard).toBeGreaterThan(asked)
    // The visitor's branch ends before the guard: it never reaches the
    // "reloading once" warning.
    expect(attach.slice(asked, guard)).toMatch(/return\s*\n\s*}/)
  })
})
