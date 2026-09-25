// one-core.spec.ts — every service is ONE instance (jwize 2026-09-25).
//
// @hypercomb/core used to be evaluated twice: compiled into the shell's bundle
// AND served to the bees as /hypercomb-core.runtime.js, so every service core
// makes at module load existed twice (DockLanes and LlmKeyStore were measured
// with two distinct instances). The shell now imports the bees' module, and
// IoC says so out loud if a second instance is ever offered again.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CORE_RUNTIME_URL } from '@hypercomb/runtime/core-surface'

const web = join(__dirname, '..')
const read = (path: string): string => readFileSync(join(web, path), 'utf8')

describe('one core', () => {
  it('the shell leaves @hypercomb/core out of its bundle', () => {
    const angular = JSON.parse(read('angular.json'))
    const options = angular.projects['hypercomb-web'].architect.build.options
    expect(options.externalDependencies).toContain('@hypercomb/core')
  })

  it('both pages map core to the runtime module before any module runs', () => {
    for (const page of ['src/index.html', 'src/index.visitor.html']) {
      const html = read(page)
      const map = html.indexOf(`'@hypercomb/core': '${CORE_RUNTIME_URL}'`) >= 0 || html.indexOf(`"@hypercomb/core": "${CORE_RUNTIME_URL}"`) >= 0
      expect(map, page).toBe(true)
    }
  })

  it('every build points the core preload at its real address', () => {
    const scripts = JSON.parse(read('package.json')).scripts
    expect(scripts.build).toContain('one-core-index.mjs')
    expect(scripts['build:visitor']).toMatch(/one-core-index\.mjs.*prepare-visitor-assets/)
  })

  it('IoC keeps the first instance and names a second one', async () => {
    delete (window as { ioc?: unknown }).ioc
    await import('@hypercomb/runtime/ioc.web')
    const first = { name: 'first' }
    const second = { name: 'second' }
    window.ioc.register('@test.com/Service', first)
    window.ioc.register('@test.com/Service', first)
    expect((window as { __hcSecondInstances?: string[] }).__hcSecondInstances ?? []).toEqual([])
    window.ioc.register('@test.com/Service', second)
    expect(window.ioc.get('@test.com/Service')).toBe(first)
    expect((window as { __hcSecondInstances?: string[] }).__hcSecondInstances).toEqual(['@test.com/Service'])
  })
})
