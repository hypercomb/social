import { describe, expect, it } from 'vitest'
import {
  RENDER_CRITICAL_IOC_GROUPS,
  learnedCriticalBeeSigs,
  normalizeCriticalClassName,
  parseLearnedCriticalBeeSigs,
  renderCriticalStatus,
  serializeLearnedCriticalBeeSigs,
  validateCriticalBeeHints,
} from './critical-bees'

const sig = (character: string): string => character.repeat(64)

const PACKAGE = sig('a')
const PIXI = sig('b')
const SHOW = sig('c')
const BACKGROUND = sig('d')
const OTHER = sig('e')
const ENABLED = [PIXI, SHOW, BACKGROUND, OTHER]

describe('critical bee hints', () => {
  it('uses the fully-qualified canonical ShowCell readiness key', () => {
    expect(RENDER_CRITICAL_IOC_GROUPS).toContainEqual([
      '@diamondcoreprocessor.com/ShowCellDrone',
    ])
    expect(RENDER_CRITICAL_IOC_GROUPS.flat()).not.toContain('@ShowCellDrone')
    expect(RENDER_CRITICAL_IOC_GROUPS.flat()).not.toContain('@diamondcoreprocessor.com/_ShowCellDrone')
  })

  it('normalizes qualified, legacy-short, and collision-renamed class names', () => {
    expect(normalizeCriticalClassName('@diamondcoreprocessor.com/PixiHostWorker')).toBe('PixiHostWorker')
    expect(normalizeCriticalClassName('@BackgroundDrone')).toBe('BackgroundDrone')
    expect(normalizeCriticalClassName('@diamondcoreprocessor.com/_ShowCellDrone')).toBe('ShowCellDrone')
    expect(normalizeCriticalClassName(null)).toBe('')
  })

  it('canonicalizes a valid hint and verifies every member is enabled', () => {
    expect(validateCriticalBeeHints([`${SHOW.toUpperCase()}.js`, ` ${PIXI} `, BACKGROUND], ENABLED))
      .toEqual([PIXI, SHOW, BACKGROUND].sort())
  })

  it.each([
    ['a non-array value', PIXI],
    ['an empty list', []],
    ['a partial list', [PIXI, SHOW]],
    ['a non-string member', [PIXI, SHOW, 7]],
    ['an invalid signature', [PIXI, SHOW, 'not-a-signature']],
    ['a duplicate after canonicalization', [PIXI, SHOW, PIXI.toUpperCase()]],
    ['a signature outside the enabled inventory', [PIXI, SHOW, sig('f')]],
  ])('rejects the whole hint for %s', (_label, value) => {
    expect(validateCriticalBeeHints(value, ENABLED)).toBeNull()
  })
})

describe('render-critical readiness', () => {
  const allProductionKeys = RENDER_CRITICAL_IOC_GROUPS.map(group => group[0])

  it('is ready when every requirement group has a registered member', () => {
    const held = new Set(allProductionKeys)
    expect(renderCriticalStatus({ has: key => held.has(key) })).toEqual({ ready: true, missing: [] })
  })

  it('does not accept the development constructor alias as service readiness', () => {
    const held = new Set([
      ...allProductionKeys.filter(key => !key.endsWith('/ShowCellDrone')),
      '@diamondcoreprocessor.com/_ShowCellDrone',
    ])
    const status = renderCriticalStatus({ has: key => held.has(key) })
    expect(status.ready).toBe(false)
    expect(status.missing).toEqual([['@diamondcoreprocessor.com/ShowCellDrone']])
  })

  it('returns the unsatisfied canonical ShowCell requirement', () => {
    const held = new Set(allProductionKeys.filter(key => !key.endsWith('/ShowCellDrone')))
    const status = renderCriticalStatus({ has: key => held.has(key) })
    expect(status.ready).toBe(false)
    expect(status.missing).toEqual([['@diamondcoreprocessor.com/ShowCellDrone']])
  })

  it('fails closed when the IoC lookup throws', () => {
    const status = renderCriticalStatus({ has: () => { throw new Error('not ready') } })
    expect(status.ready).toBe(false)
    expect(status.missing).toHaveLength(RENDER_CRITICAL_IOC_GROUPS.length)
  })
})

describe('learned critical bees', () => {
  const completeEntries = [
    [PIXI, { iocKey: '@diamondcoreprocessor.com/PixiHostWorker' }],
    [SHOW, { iocKey: '@diamondcoreprocessor.com/_ShowCellDrone' }],
    [BACKGROUND, { iocKey: '@diamondcoreprocessor.com/BackgroundDrone' }],
    [OTHER, { iocKey: '@diamondcoreprocessor.com/UnrelatedDrone' }],
  ] as const

  it('learns exactly the three loadable critical classes', () => {
    expect(learnedCriticalBeeSigs(completeEntries)).toEqual([PIXI, SHOW, BACKGROUND].sort())
  })

  it('falls back to constructor names when a loaded product has no iocKey', () => {
    class PixiHostWorker {}
    class ShowCellDrone {}
    class BackgroundDrone {}
    expect(learnedCriticalBeeSigs([
      [PIXI, new PixiHostWorker()],
      [SHOW, new ShowCellDrone()],
      [BACKGROUND, new BackgroundDrone()],
    ])).toEqual([PIXI, SHOW, BACKGROUND].sort())
  })

  it('rejects a partial learned mapping', () => {
    expect(learnedCriticalBeeSigs(completeEntries.slice(0, 2))).toBeNull()
  })

  it('rejects an ambiguous class mapping', () => {
    expect(learnedCriticalBeeSigs([
      ...completeEntries,
      [sig('f'), { iocKey: '@diamondcoreprocessor.com/PixiHostWorker' }],
    ])).toBeNull()
  })

  it('round-trips a versioned record bound to the active package', () => {
    const encoded = serializeLearnedCriticalBeeSigs(PACKAGE, [SHOW, PIXI, BACKGROUND])
    expect(JSON.parse(encoded)).toEqual({
      version: 1,
      packageSig: PACKAGE,
      sigs: [PIXI, SHOW, BACKGROUND].sort(),
    })
    expect(parseLearnedCriticalBeeSigs(encoded, PACKAGE, ENABLED))
      .toEqual([PIXI, SHOW, BACKGROUND].sort())
  })

  it.each([
    ['legacy unbound array', JSON.stringify([PIXI, SHOW, BACKGROUND]), PACKAGE, ENABLED],
    ['malformed JSON', '{', PACKAGE, ENABLED],
    ['unknown record version', JSON.stringify({ version: 2, packageSig: PACKAGE, sigs: [PIXI, SHOW, BACKGROUND] }), PACKAGE, ENABLED],
    ['a different package', serializeLearnedCriticalBeeSigs(PACKAGE, [PIXI, SHOW, BACKGROUND]), sig('f'), ENABLED],
    ['a disabled learned bee', serializeLearnedCriticalBeeSigs(PACKAGE, [PIXI, SHOW, BACKGROUND]), PACKAGE, [PIXI, SHOW]],
    ['a partial learned list', JSON.stringify({ version: 1, packageSig: PACKAGE, sigs: [PIXI, SHOW] }), PACKAGE, ENABLED],
  ])('rejects %s', (_label, raw, packageSig, enabled) => {
    expect(parseLearnedCriticalBeeSigs(raw, packageSig, enabled)).toBeNull()
  })

  it('refuses to serialize malformed or partial learned data', () => {
    expect(() => serializeLearnedCriticalBeeSigs(PACKAGE, [PIXI, SHOW])).toThrow(TypeError)
    expect(() => serializeLearnedCriticalBeeSigs('bad-package', [PIXI, SHOW, BACKGROUND])).toThrow(TypeError)
    expect(() => serializeLearnedCriticalBeeSigs(PACKAGE, [PIXI, PIXI, BACKGROUND])).toThrow(TypeError)
  })
})
