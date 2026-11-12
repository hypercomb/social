import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { packageIsOff } from './package-off'

// A LAUNCHER GOES WITH ITS PACKAGE (jwize, 2026-11-11: "I removed comfy
// refreshed and still it was showing").

const here = dirname(fileURLToPath(import.meta.url))
const BAR = readFileSync(join(here, 'controls-bar.component.ts'), 'utf8')
const HOSTS = readFileSync(join(here, '..', '..', '..', 'hypercomb-essentials', 'src', 'sharing', 'host-directory.view.ts'), 'utf8')

const ioc = (services: Record<string, unknown>) => ({ get: (key: string) => services[key] })
const install = (off: string[]) => ({ offUnits: () => new Set(off) })

describe('a launcher goes with its package', () => {
  it('is off when the hosts window turned off a package of its name, at any depth', () => {
    expect(packageIsOff('comfy', ioc({ '@hypercomb.social/Install': install(['comfy']) }))).toBe(true)
    expect(packageIsOff('Comfy', ioc({ '@hypercomb.social/Install': install(['games/comfy']) }))).toBe(true)
    expect(packageIsOff('comfy', ioc({ '@hypercomb.social/Install': install(['games', 'comfy-desk']) }))).toBe(false)
    expect(packageIsOff('hosts', ioc({ '@hypercomb.social/Install': install(['comfy']) }))).toBe(false)
  })

  it('hides nothing without positive evidence: no port, no word, a port that throws', () => {
    expect(packageIsOff('comfy', ioc({}))).toBe(false)
    expect(packageIsOff('comfy', undefined)).toBe(false)
    expect(packageIsOff('', ioc({ '@hypercomb.social/Install': install(['']) }))).toBe(false)
    expect(packageIsOff('comfy', ioc({ '@hypercomb.social/Install': { offUnits: () => { throw new Error('unreadable') } } }))).toBe(false)
  })

  it('a shell that runs its working tree ignores the off list: everything is compiled in', () => {
    expect(packageIsOff('comfy', ioc({
      '@hypercomb.social/Install': install(['comfy']),
      '@hypercomb.social/DevSourceCatalog': {},
    }))).toBe(false)
  })

  it('the rail asks it for every launcher that names a word, and repaints when packages change', () => {
    expect(BAR).toContain('if (ctrl.word && packageIsOff(ctrl.word)) return false')
    expect(BAR).toContain("EffectBus.on('packages:changed', () => this.#lights.update(n => n + 1))")
    // The hosts window says so when a switch took effect while the hive runs.
    expect(HOSTS).toContain("EffectBus.emit('packages:changed', { off: [...install.offUnits()] })")
  })
})
