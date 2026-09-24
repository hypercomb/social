// game-play.spec.ts — THE GAME FACE, WARMED: the tile walk asks the game view
// to load a game's code for a tile whose face is that game. Only a game that
// can be played here is warmed; the open then finds its code ready.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { ENABLEMENT_CHANGED, GLOBAL_OFF_KEY } from '../sharing/behavior-enablement.js'
import { gameKind } from './game-enablement.js'
import { prefetchGameFace } from './game-play.js'

let tick = 0
const reset = (): void => { localStorage.clear(); EffectBus.emit(ENABLEMENT_CHANGED, { test: ++tick }) }

const installIoc = (bees: Record<string, unknown>): void => {
  ;(window as unknown as { ioc?: unknown }).ioc = {
    list: () => Object.keys(bees),
    get: (k: string) => bees[k],
  }
}

const game = (id: string) => ({
  genotype: 'game', gameId: id, gameLabel: id, gameIcon: 'castle', description: id,
  prefetch: vi.fn(async () => {}),
})

describe('a game face is warmed only when it can be played here', () => {
  beforeEach(reset)

  it('loads the named game\'s code through its own bee', async () => {
    const solomon = game('solomon')
    installIoc({ '@diamondcoreprocessor.com/SolomonDrone': solomon })
    expect(await prefetchGameFace({ payload: { gameId: 'solomon' } })).toBe(true)
    expect(solomon.prefetch).toHaveBeenCalledTimes(1)
  })

  it('never warms a game that is switched off, missing, or not named', async () => {
    const solomon = game('solomon')
    installIoc({ '@diamondcoreprocessor.com/SolomonDrone': solomon })
    expect(await prefetchGameFace({ payload: { gameId: 'arkanoid' } })).toBe(false)
    expect(await prefetchGameFace({ payload: {} })).toBe(false)
    expect(await prefetchGameFace({})).toBe(false)
    localStorage.setItem(GLOBAL_OFF_KEY, JSON.stringify([gameKind('solomon')]))
    EffectBus.emit(ENABLEMENT_CHANGED, { test: ++tick })
    expect(await prefetchGameFace({ payload: { gameId: 'solomon' } })).toBe(false)
    expect(solomon.prefetch).not.toHaveBeenCalled()
  })
})
