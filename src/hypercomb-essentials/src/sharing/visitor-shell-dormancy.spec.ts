// visitor-shell-dormancy.spec.ts — THE PUBLISHED SITE MUST NOT GO DARK.
//
// The trap this file guards (found building the publications directory for
// pluginthematrix.com, 2026-08-28): a published visitor shell is a COLD
// install whose roster is seeded dark — `hc:behavior-global-on` is `[]` with
// every cohort marked seeded — so the raw roster read (`isKindGloballyOff`)
// answers "off" for EVERY kind. A view drone that gates its #mount on the raw
// read tears down to hexagons over a blank layer, and a site whose root
// `view:default` is that view renders nothing. `isBehaviorDormant` carries
// the exception: on the visitor shell (`data-hypercomb-mode="visitor"`),
// publishing the mark IS the enablement — only an explicit publisher
// withhold still answers dormant.
//
// Activation gates therefore ask isBehaviorDormant(kind, segments), never
// raw isKindGloballyOff — see square-tile-view.drone.ts and
// publications-view.drone.ts #mount for the pattern in place.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import {
  isKindGloballyOff, isBehaviorDormant, isPublishedVisitorShell,
  recordWithheldAtRoot, ENABLEMENT_CHANGED,
  GLOBAL_ON_KEY, SEEDED_COHORTS_KEY,
} from './behavior-enablement.js'

// The incident's kind — but the rule holds for every kind a published root
// can open as.
const KIND = 'visual:square-tile:view'
const SEGMENTS = ['publications'] as const

/** What the visitor shell's fresh install looks like: an empty on-list that
 *  is nonetheless the truth (every cohort marked seeded). */
const seedDarkRoster = (): void => {
  localStorage.setItem(GLOBAL_ON_KEY, '[]')
  localStorage.setItem(SEEDED_COHORTS_KEY, '["*"]')
  EffectBus.emit(ENABLEMENT_CHANGED, {})
}

beforeEach(() => {
  localStorage.clear()
  EffectBus.emit(ENABLEMENT_CHANGED, {})
})

afterEach(() => {
  delete document.documentElement.dataset['hypercombMode']
})

describe('dormancy on the published visitor shell', () => {

  it('the raw roster read answers off on a dark roster — the trap', () => {
    seedDarkRoster()
    expect(isKindGloballyOff(KIND)).toBe(true)
  })

  it('the visitor shell is recognized from the document stamp', () => {
    expect(isPublishedVisitorShell()).toBe(false)
    document.documentElement.dataset['hypercombMode'] = 'visitor'
    expect(isPublishedVisitorShell()).toBe(true)
  })

  it('on the visitor shell the published mark IS the enablement — not dormant', () => {
    seedDarkRoster()
    document.documentElement.dataset['hypercombMode'] = 'visitor'
    expect(isBehaviorDormant(KIND, [...SEGMENTS])).toBe(false)
    expect(isBehaviorDormant(KIND, [])).toBe(false)   // the site root too
  })

  it('a publisher withhold still answers dormant on the visitor shell', () => {
    seedDarkRoster()
    document.documentElement.dataset['hypercombMode'] = 'visitor'
    recordWithheldAtRoot([...SEGMENTS], [KIND])
    expect(isBehaviorDormant(KIND, [...SEGMENTS])).toBe(true)
    expect(isBehaviorDormant(KIND, ['elsewhere'])).toBe(false)
  })

  it('off a visitor shell the dark roster still means dormant — participants keep the opt-in model', () => {
    seedDarkRoster()
    expect(isBehaviorDormant(KIND, [...SEGMENTS])).toBe(true)
  })

  it('a game is never roster-dormant on the visitor shell — its open() must not refuse the start gesture', async () => {
    // Same trap, game flavour: `open()` gates on isGameDormant, and the raw
    // roster read on the cold shell would silently swallow the site's own
    // START GAME button (games/arkanoid arrival face).
    const { isGameDormant } = await import('../games/game-enablement.js')
    seedDarkRoster()
    expect(isGameDormant('arkanoid')).toBe(true)   // participant: opt-in holds
    document.documentElement.dataset['hypercombMode'] = 'visitor'
    expect(isGameDormant('arkanoid')).toBe(false)  // visitor: shipping IS the enablement
  })
})
