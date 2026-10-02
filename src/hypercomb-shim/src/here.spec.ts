// A host runs from whatever folder its page declares as <base href>: a
// domain's root, or a folder beside another build on the same origin
// (hypercomb.com serves the minimal host at /minimal/ next to the Angular
// shell). The page's address is a hive location (/minimal/garden/kitchen), so
// it is no guide to the folder. Its named files and its worker live in the
// folder; another build's worker and import map are not its own.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

const shim = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path: string): string => readFileSync(join(shim, path), 'utf8')

const at = async (path: string, folder = '/') => {
  document.head.querySelector('base')?.remove()
  const base = document.createElement('base')
  base.href = folder
  document.head.prepend(base)
  window.history.replaceState(null, '', path)
  vi.resetModules()
  return import('./here')
}
const controlledBy = (script: string | null): void => {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { controller: script ? { scriptURL: new URL(script, location.origin).href } : null },
  })
}

describe('a host in a folder', () => {
  afterEach(() => { document.head.querySelector('base')?.remove(); window.history.replaceState(null, '', '/') })

  it('resolves its named files and its worker in the folder of its page', async () => {
    for (const page of ['/', '/garden/kitchen', '/hosts']) {
      const root = await at(page)
      expect(root.here('pin')).toBe('/pin')
      expect(root.WORKER.pathname).toBe('/hypercomb.worker.js')
    }
    for (const page of ['/minimal/', '/minimal/index.html', '/minimal/garden/kitchen', '/minimal/hosts']) {
      const folder = await at(page, '/minimal/')
      expect(folder.HERE.pathname).toBe('/minimal/')
      expect(folder.here('hypercomb-core.runtime.js')).toBe('/minimal/hypercomb-core.runtime.js')
      expect(folder.WORKER.pathname).toBe('/minimal/hypercomb.worker.js')
    }
  })

  it('counts only its own worker as control', async () => {
    const { controlledHere } = await at('/minimal/garden', '/minimal/')
    controlledBy('/hypercomb.worker.js?v=7')   // the other build's, at the root
    expect(controlledHere()).toBe(false)
    controlledBy(null)
    expect(controlledHere()).toBe(false)
    controlledBy('/minimal/hypercomb.worker.js')
    expect(controlledHere()).toBe(true)
  })

  it('the kernel repeats the same rule, and keeps its own import map', () => {
    const kernel = read('src/kernel.ts')
    expect(kernel).toContain("const HERE = new URL('./', document.baseURI)")
    expect(kernel).toContain("navigator.serviceWorker?.controller?.scriptURL?.split('?')[0] === WORKER")
    expect(kernel).not.toMatch(/['`]\/hypercomb-core\.runtime\.js/)
    expect(kernel).not.toContain("'hc:importmap'")
    const key = /const IMPORT_MAP_KEY = '([^']+)'/.exec(kernel)?.[1]
    expect(read('src/import-map.ts')).toContain(`export const IMPORT_MAP_STORAGE_KEY = '${key}'`)
  })

  it('registers its worker scoped to its folder, and the page names its folder once', () => {
    expect(read('src/main.ts')).toContain('navigator.serviceWorker.register(WORKER, { scope: HERE.pathname })')
    const html = read('index.html')
    // The one root the page names is its folder, which start-points.mjs moves.
    expect(html.match(/<base\s[^>]*>/g)).toEqual(['<base href="/" />'])
    expect(html.replace('<base href="/" />', '')).not.toMatch(/(?:href|src)="\//)
    const manifest = JSON.parse(read('public/manifest.webmanifest'))
    for (const key of ['id', 'start_url', 'scope']) expect(manifest[key]).toBe('./')
  })
})
