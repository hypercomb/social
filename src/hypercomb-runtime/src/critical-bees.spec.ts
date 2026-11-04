import { describe, expect, it } from 'vitest'
import {
  FIRST_PAINT_LANE,
  RENDER_CRITICAL_IOC_GROUPS,
  learnedCriticalBeeSigs,
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

  it('canonicalizes a valid hint and verifies every member is enabled', () => {
    expect(validateCriticalBeeHints([`${SHOW.toUpperCase()}.js`, ` ${PIXI} `, BACKGROUND], ENABLED))
      .toEqual([PIXI, SHOW, BACKGROUND].sort())
  })

  it.each([
    ['a non-array value', PIXI],
    ['an empty list', []],
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
  // A bee is critical because IT says so (`readonly lane = 'first-paint'`) —
  // not because its class name is on a list here.
  const marked = (iocKey: string) => ({ iocKey, lane: FIRST_PAINT_LANE })
  const completeEntries = [
    [PIXI, marked('@diamondcoreprocessor.com/PixiHostWorker')],
    [SHOW, marked('@diamondcoreprocessor.com/_ShowCellDrone')],
    [BACKGROUND, marked('@diamondcoreprocessor.com/BackgroundDrone')],
    [OTHER, { iocKey: '@diamondcoreprocessor.com/UnrelatedDrone', lane: 'boot' }],
  ] as const

  it('learns every bee that declares the first-paint lane, and only those', () => {
    expect(learnedCriticalBeeSigs(completeEntries)).toEqual([PIXI, SHOW, BACKGROUND].sort())
  })

  it('needs no list: a fourth marked bee is learned, an unmarked class of the same name is not', () => {
    const FOURTH = sig('1')
    expect(learnedCriticalBeeSigs([...completeEntries, [FOURTH, marked('@x.com/AnythingAtAll')]]))
      .toEqual([PIXI, SHOW, BACKGROUND, FOURTH].sort())
    class PixiHostWorker {}
    expect(learnedCriticalBeeSigs([[PIXI, new PixiHostWorker()], [OTHER, { lane: 'boot' }]])).toBeNull()
  })

  it('learns nothing from bees with no mark, or from a bee whose lane throws', () => {
    expect(learnedCriticalBeeSigs([[PIXI, {}], [SHOW, null], [BACKGROUND, 'x']])).toBeNull()
    const hostile = { get lane(): string { throw new Error('no') } }
    expect(learnedCriticalBeeSigs([[PIXI, hostile]])).toBeNull()
  })

  it('rejects a list holding a marked bee with a malformed signature', () => {
    expect(learnedCriticalBeeSigs([...completeEntries, ['nope', marked('@x.com/Bad')]])).toBeNull()
  })

  it('counts a bee once however many times it is offered', () => {
    expect(learnedCriticalBeeSigs([...completeEntries, [PIXI, marked('@diamondcoreprocessor.com/PixiHostWorker')]]))
      .toEqual([PIXI, SHOW, BACKGROUND].sort())
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
    ['an empty learned list', JSON.stringify({ version: 1, packageSig: PACKAGE, sigs: [] }), PACKAGE, ENABLED],
  ])('rejects %s', (_label, raw, packageSig, enabled) => {
    expect(parseLearnedCriticalBeeSigs(raw, packageSig, enabled)).toBeNull()
  })

  it('refuses to serialize malformed or partial learned data', () => {
    expect(() => serializeLearnedCriticalBeeSigs(PACKAGE, [])).toThrow(TypeError)
    expect(() => serializeLearnedCriticalBeeSigs('bad-package', [PIXI, SHOW, BACKGROUND])).toThrow(TypeError)
    expect(() => serializeLearnedCriticalBeeSigs(PACKAGE, [PIXI, PIXI, BACKGROUND])).toThrow(TypeError)
  })
})
