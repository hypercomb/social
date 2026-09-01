// Games are behaviours: they take a row in the Beehaviors roster and one
// global light, like everything else. What is special about them is only how
// they GET there — no decoration kind, so the identity is minted from the
// launch descriptor — and how the light must arrive on a hive that already
// had them working before the roster knew the word.
import { describe, it, expect, beforeEach } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import {
  GLOBAL_ON_KEY, GLOBAL_OFF_KEY, SEEDED_COHORTS_KEY, ENABLEMENT_CHANGED,
  seedCohortOn, isKindGloballyOff,
} from '../sharing/behavior-enablement.js'
import { gameKind, isGameDormant, gameCensus, gameKinds, GAME_COHORT } from './game-enablement.js'

/** The reader caches per frame and drops only on the change event — so a test
 *  that writes localStorage behind its back must say so. */
let tick = 0
const bump = (): void => { EffectBus.emit(ENABLEMENT_CHANGED, { test: ++tick }) }

const reset = (): void => { localStorage.clear(); bump() }

/** A `genotype:'game'` bee, as the launcher and the census see one. */
const fakeGame = (id: string, label = id) => ({
  genotype: 'game', gameId: id, gameLabel: label, gameIcon: 'castle',
  description: `${label} — a game`,
})

const installIoc = (bees: Record<string, unknown>): void => {
  ;(window as unknown as { ioc?: unknown }).ioc = {
    list: () => Object.keys(bees),
    get: (k: string) => bees[k],
  }
}

describe('a game is identified by its launch descriptor, not a decoration', () => {
  beforeEach(reset)

  it('mints `game:<gameId>` — never a visual:* kind, because nothing marks a tile', () => {
    expect(gameKind('solomon')).toBe('game:solomon')
    expect(gameKind('  roper  ')).toBe('game:roper')
    expect(gameKind('')).toBe('')
  })

  it('a bee with no game id is not a game the roster can switch', () => {
    installIoc({ a: { genotype: 'game', gameLabel: 'nameless' } })
    expect(gameCensus()).toEqual([])
  })

  it('reads the census straight off window.ioc, deduped by id and sorted by label', () => {
    installIoc({
      '@x/Solomon': fakeGame('solomon', "Solomon's Key"),
      '@x/SolomonAgain': fakeGame('solomon', "Solomon's Key"),
      '@x/Arkanoid': fakeGame('arkanoid', 'Arkanoid'),
      '@x/NotAGame': { genotype: 'view', gameId: 'nope' },
    })
    expect(gameCensus().map(g => g.id)).toEqual(['arkanoid', 'solomon'])
    expect(gameKinds()).toEqual(['game:arkanoid', 'game:solomon'])
  })

  it('dormancy is the ONE global light — no location, so no wake and no binding', () => {
    localStorage.setItem(GLOBAL_ON_KEY, JSON.stringify(['game:roper']))
    bump()
    expect(isGameDormant('roper')).toBe(false)
    expect(isGameDormant('solomon')).toBe(true)
  })
})

describe('seedCohortOn — putting a switch on something must not turn it off', () => {
  beforeEach(reset)

  it('lights a cohort ONCE on a hive that already has an on-list', () => {
    localStorage.setItem(GLOBAL_ON_KEY, JSON.stringify(['visual:postit:note']))
    bump()
    expect(isKindGloballyOff('game:roper')).toBe(true)   // unknown kind = off

    expect(seedCohortOn(GAME_COHORT, ['game:roper', 'game:solomon'])).toBe(true)
    expect(isKindGloballyOff('game:roper')).toBe(false)
    expect(isKindGloballyOff('game:solomon')).toBe(false)
    expect(isKindGloballyOff('visual:postit:note')).toBe(false)  // untouched
  })

  it('never runs twice — a deliberate switch-off survives the next boot', () => {
    localStorage.setItem(GLOBAL_ON_KEY, JSON.stringify(['visual:postit:note']))
    bump()
    seedCohortOn(GAME_COHORT, ['game:roper'])

    // The participant switches it off, then reloads.
    localStorage.setItem(GLOBAL_ON_KEY, JSON.stringify(['visual:postit:note']))
    bump()
    expect(seedCohortOn(GAME_COHORT, ['game:roper'])).toBe(false)
    expect(isKindGloballyOff('game:roper')).toBe(true)
  })

  it('a hive that STARTED DARK stays dark — no light ever appears behind you', () => {
    localStorage.setItem(GLOBAL_ON_KEY, '[]')
    localStorage.setItem(SEEDED_COHORTS_KEY, JSON.stringify(['*']))
    bump()
    expect(seedCohortOn(GAME_COHORT, ['game:roper'])).toBe(false)
    expect(isGameDormant('roper')).toBe(true)
  })

  it('clears the off-list mirror too, or the swarm keeps withholding what is now lit', () => {
    localStorage.setItem(GLOBAL_ON_KEY, JSON.stringify(['visual:postit:note']))
    localStorage.setItem(GLOBAL_OFF_KEY, JSON.stringify(['game:roper', 'visual:x:y']))
    bump()
    seedCohortOn(GAME_COHORT, ['game:roper'])
    expect(JSON.parse(localStorage.getItem(GLOBAL_OFF_KEY)!)).toEqual(['visual:x:y'])
  })

  it('records the cohort but lights nothing when the census seed has not run yet', () => {
    expect(localStorage.getItem(GLOBAL_ON_KEY)).toBeNull()
    expect(seedCohortOn(GAME_COHORT, ['game:roper'])).toBe(false)
    expect(JSON.parse(localStorage.getItem(SEEDED_COHORTS_KEY)!)).toEqual([GAME_COHORT])
    expect(localStorage.getItem(GLOBAL_ON_KEY)).toBeNull()
  })
})
