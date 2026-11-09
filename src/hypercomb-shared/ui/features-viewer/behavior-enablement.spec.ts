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

// A WORD'S LIGHT, as the shell's own surfaces read it — the chat window, the
// rail's chat and meeting buttons, the bar's hosts and comfy launchers. They
// are all the build's, so a word is off exactly when the participant
// switched it off, which the writer records on the off-list in the same
// gesture as the on-list.
import { isWordSwitchedOff, GLOBAL_OFF_KEY } from './behavior-enablement'

describe('isWordSwitchedOff', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset['hypercombMode']
  })

  it('reads a word lit on a hive that started dark — nothing switched it off', () => {
    seedDarkOnFreshInstall()
    expect(isWordSwitchedOff('chat')).toBe(false)
  })

  it('reads it off once the roster switches it off, and on again once it is lit', () => {
    seedDarkOnFreshInstall()
    setKindGlobalOn('word:chat', false)
    expect(isWordSwitchedOff('chat')).toBe(true)
    expect(isWordSwitchedOff('/Chat')).toBe(true)
    expect(isWordSwitchedOff('meeting')).toBe(false)
    setKindGlobalOn('word:chat', true)
    expect(isWordSwitchedOff('chat')).toBe(false)
  })

  it('has no roster to consult on a published visitor shell', () => {
    localStorage.setItem(GLOBAL_OFF_KEY, JSON.stringify(['word:chat']))
    document.documentElement.dataset['hypercombMode'] = 'visitor'
    expect(isWordSwitchedOff('chat')).toBe(false)
  })
})
