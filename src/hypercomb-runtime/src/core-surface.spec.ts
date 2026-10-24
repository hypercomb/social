import { describe, expect, it } from 'vitest'
import { CORE_RUNTIME_URL, coreCompatibility, coreImportsOf, coreRuntimeUrl, describeCoreMismatch, requiredCoreExports } from './core-surface'

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s)

describe('coreImportsOf — what a built module names from @hypercomb/core', () => {
  it('reads named imports and folds aliases back to the core-side name', () => {
    const src = 'import { Drone as Drone2, EffectBus as EffectBus2, normalizeCell } from "@hypercomb/core";\nvar x = 1'
    expect(coreImportsOf(src)).toEqual(['Drone', 'EffectBus', 'normalizeCell'])
  })

  it('unions several import statements, both quote styles, and re-exports', () => {
    const src = [
      "import { EffectBus } from '@hypercomb/core'",
      'import { declarePoolKind, SignatureService as SignatureService2, isSignature } from "@hypercomb/core"',
      'export { MARKER_CEILING } from "@hypercomb/core"',
    ].join('\n')
    expect(coreImportsOf(src)).toEqual(['EffectBus', 'MARKER_CEILING', 'SignatureService', 'declarePoolKind', 'isSignature'])
  })

  it('names the default export for a default import and ignores other specifiers', () => {
    expect(coreImportsOf('import core from "@hypercomb/core"; import { x } from "pixi.js"')).toEqual(['default'])
    expect(coreImportsOf('import { Application } from "pixi.js"')).toEqual([])
  })

  it('cannot see through a namespace import and says nothing rather than guessing', () => {
    expect(coreImportsOf('import * as core from "@hypercomb/core"; core.EffectBus.emit()')).toEqual([])
  })
})

describe('requiredCoreExports — the union over admitted atoms', () => {
  it('unions across atoms and skips ones the reader cannot answer for', async () => {
    const heap = new Map<string, Uint8Array>([
      ['a', bytes('import { Drone, EffectBus } from "@hypercomb/core"')],
      ['b', bytes('import { EffectBus, poolKindOfMeaning } from "@hypercomb/core"')],
    ])
    const read = async (sig: string) => heap.get(sig) ?? null
    expect(await requiredCoreExports(['a', 'b', 'missing'], read)).toEqual(['Drone', 'EffectBus', 'poolKindOfMeaning'])
  })
})

describe('coreCompatibility — directional: a richer shell passes, a short one refuses by name', () => {
  it('passes when the live core exports everything required, including extras', () => {
    const verdict = coreCompatibility(['Drone', 'EffectBus'], new Set(['Drone', 'EffectBus', 'newerThing']))
    expect(verdict).toEqual({ ok: true, missing: [], required: 2, inspected: true })
  })

  it('refuses and names exactly what the shell lacks', () => {
    const verdict = coreCompatibility(['Drone', 'MARKER_CEILING', 'declarePoolKind'], new Set(['Drone']))
    expect(verdict.ok).toBe(false)
    expect(verdict.missing).toEqual(['MARKER_CEILING', 'declarePoolKind'])
  })

  it('stands aside when there is no live core to inspect', () => {
    expect(coreCompatibility(['Drone'], null)).toEqual({ ok: true, missing: [], required: 1, inspected: false })
  })

  it('describes a mismatch briefly, capping the list', () => {
    expect(describeCoreMismatch(['a', 'b'])).toBe('needs a newer shell — its core does not export a, b')
    expect(describeCoreMismatch(['a', 'b', 'c', 'd', 'e', 'f'])).toBe('needs a newer shell — its core does not export a, b, c, d and 2 more')
  })
})

describe('coreRuntimeUrl — the core the page runs, as its import map says', () => {
  const fixed = new URL(CORE_RUNTIME_URL, location.origin).href

  it("takes the import map's answer — a door maps core under /shell/", () => {
    expect(coreRuntimeUrl(() => 'https://swarm.hypercomb.com/shell/hypercomb-core.runtime.js'))
      .toBe('https://swarm.hypercomb.com/shell/hypercomb-core.runtime.js')
  })

  it('falls back to the fixed URL without import.meta.resolve, on a throw, or off the web', () => {
    expect(coreRuntimeUrl(null)).toBe(fixed)
    expect(coreRuntimeUrl(() => { throw new Error('no map') })).toBe(fixed)
    expect(coreRuntimeUrl(() => 'file:///C:/src/hypercomb-core/dist/index.js')).toBe(fixed)
  })
})
