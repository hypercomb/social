import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PRELOADER = readFileSync(join(__dirname, 'script-preloader.ts'), 'utf8')

describe('ScriptPreloader critical-bee integration', () => {
  it('accepts startup hints only from the installed signed root', () => {
    expect(PRELOADER).toContain('const activeRoot = installedPackageSig()')
    expect(PRELOADER).toContain('if (activeRoot && clean === activeRoot) rootCriticalBees = parsed.criticalBees')
    expect(PRELOADER).toContain('validateCriticalBeeHints(rootCriticalBees, enabledBees)')
    expect(PRELOADER).toContain('await this.#loadBeesPrioritized(walked.bees, walked.criticalBees)')
  })

  it('checks readiness before backgrounding the remaining bees', () => {
    const status = PRELOADER.indexOf('const status = renderCriticalStatus(window.ioc)')
    const ready = PRELOADER.indexOf('if (status.ready)', status)
    const background = PRELOADER.indexOf('const restLoads = restPending.map', ready)

    expect(status).toBeGreaterThan(-1)
    expect(ready).toBeGreaterThan(status)
    expect(background).toBeGreaterThan(ready)
    expect(PRELOADER).toContain('const fallback = await this.#loadUntilRenderCritical(restPending)')
    expect(PRELOADER).toContain('unsubscribe?.()')
    expect(PRELOADER).not.toContain('#RENDER_CRITICAL_KEYS')
  })

  it('keeps learned hints package-bound and all-or-nothing', () => {
    expect(PRELOADER).toContain('parseLearnedCriticalBeeSigs(raw, packageSig, enabled) ?? []')
    expect(PRELOADER).toContain('serializeLearnedCriticalBeeSigs(packageSig, sigs)')
    expect(PRELOADER).toContain('if (!packageSig || !sigs) return')
  })

  it('walks current cells while retaining the legacy layer-link fallback', () => {
    expect(PRELOADER).toContain("Array.isArray(layer['cells']) ? layer['cells'] : layer['layers']")
  })
})
