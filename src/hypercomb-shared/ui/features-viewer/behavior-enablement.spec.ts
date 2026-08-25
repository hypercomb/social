// A new install starts DARK — the whole point of the opt-in model.
import { describe, it, expect, beforeEach } from 'vitest'
import { seedDarkOnFreshInstall, hasGlobalOnList, isKindGloballyOff, setKindGlobalOn, GLOBAL_ON_KEY } from './behavior-enablement'

describe('seedDarkOnFreshInstall', () => {
  beforeEach(() => localStorage.clear())

  it('materializes an EMPTY on-list, so every behavior is globally off', () => {
    expect(seedDarkOnFreshInstall()).toBe(true)
    expect(hasGlobalOnList()).toBe(true)
    expect(localStorage.getItem(GLOBAL_ON_KEY)).toBe('[]')
    expect(isKindGloballyOff('visual:postit:note')).toBe(true)
    expect(isKindGloballyOff('anything:at:all')).toBe(true)
  })

  it('never darkens a hive that already has a list', () => {
    localStorage.setItem(GLOBAL_ON_KEY, JSON.stringify(['visual:postit:note']))
    expect(seedDarkOnFreshInstall()).toBe(false)
    expect(isKindGloballyOff('visual:postit:note')).toBe(false)
  })

  it('lights up again from the roster', () => {
    seedDarkOnFreshInstall()
    setKindGlobalOn('visual:postit:note', true)
    expect(isKindGloballyOff('visual:postit:note')).toBe(false)
  })
})
