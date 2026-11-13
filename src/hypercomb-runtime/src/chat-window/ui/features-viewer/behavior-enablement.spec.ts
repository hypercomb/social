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
    expect(isWordSwitchedOff('meeting')).toBe(false)
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

// SUGGESTED (jwize, 2026-11-11): "we can have suggested behaviors so the
// person who doesn't want ai doesn't get it". A fresh hive opens without the
// AI chat, and is offered it; a hive that already exists keeps what it had.
import { acceptSuggestedWord, isKindSuggested, isWordSuggested, readSuggestedKinds } from './behavior-enablement'

describe('a suggested behaviour is off, and offered once', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset['hypercombMode']
  })

  it('a fresh hive opens with the chat off and on offer', () => {
    seedDarkOnFreshInstall()
    expect(isWordSwitchedOff('chat')).toBe(true)
    expect(isWordSuggested('chat')).toBe(true)
    expect(readSuggestedKinds()).toEqual(['word:chat'])
    expect(isWordSuggested('meeting')).toBe(false)
  })

  it('a hive that already exists is offered nothing and loses nothing', () => {
    localStorage.setItem(GLOBAL_ON_KEY, JSON.stringify(['visual:postit:note']))
    seedDarkOnFreshInstall()
    expect(isWordSwitchedOff('chat')).toBe(false)
    expect(isWordSuggested('chat')).toBe(false)
  })

  it('taking the offer lights it, and the offer is spent', () => {
    seedDarkOnFreshInstall()
    expect(acceptSuggestedWord('chat')).toBe(true)
    expect(isWordSwitchedOff('chat')).toBe(false)
    expect(isKindSuggested('word:chat')).toBe(false)
    // Switched off afterwards, it is simply off: nobody is asked twice.
    setKindGlobalOn('word:chat', false)
    expect(isWordSwitchedOff('chat')).toBe(true)
    expect(isWordSuggested('chat')).toBe(false)
    expect(acceptSuggestedWord('chat')).toBe(false)
  })
})
