import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_RANGE, DEFAULT_STAGES, STAGE_MAX, measuredPrice, noCeiling, openRouterRange, openRouterStages,
  outsideRange, placeModel, stageFor, stagePosition, stagePrice,
} from './openrouter-stages.js'

beforeEach(() => {
  localStorage.removeItem('hc:llm:openrouter:stages')
  localStorage.removeItem('hc:llm:openrouter:range')
})

describe('price stages', () => {
  it('starts near DeepSeek: quick work at its price, double and triple for heavier work', () => {
    expect(openRouterStages.get()).toEqual(DEFAULT_STAGES)
  })

  it('keeps the stops in order and inside the scale', () => {
    openRouterStages.set({ fast: 5, balanced: 0.05, deep: 999 })
    expect(openRouterStages.get()).toEqual({ fast: 0.05, balanced: 5, deep: STAGE_MAX })
  })

  it('puts a price in the stage it falls in, and above the last stop out', () => {
    const stages = { fast: 0.1, balanced: 0.2, deep: 0.3 }
    expect(stageFor(0.08, stages)).toBe('fast')
    expect(stageFor(0.17, stages)).toBe('balanced')
    expect(stageFor(0.3, stages)).toBe('deep')
    expect(stageFor(15, stages)).toBe('over')
    expect(stageFor(undefined, stages)).toBeUndefined()
  })

  it('maps prices onto a logarithmic track and back', () => {
    expect(stagePosition(0.01)).toBe(0)
    expect(stagePosition(STAGE_MAX)).toBe(1)
    expect(stagePrice(stagePosition(0.3))).toBe(0.3)
  })
})

describe('price range', () => {
  const opus = { input: 15, output: 75 }
  const flash = { input: 0.02, output: 0.08 }

  it('starts as the stops alone: output measured, no floor, no input limit', () => {
    expect(openRouterRange.get()).toEqual(DEFAULT_RANGE)
    expect(placeModel(flash)).toBe('fast')
    expect(placeModel(opus)).toBe('over')
  })

  it('a ceiling typed empty, or at the end of the scale, lets every price through as heavy work', () => {
    openRouterStages.setCeiling(undefined)
    expect(noCeiling()).toBe(true)
    expect(placeModel(opus)).toBe('deep')
    expect(placeModel({ input: 150, output: 600 })).toBe('deep')
  })

  it('a ceiling typed low brings the stops above it down, never reorders them', () => {
    openRouterStages.setCeiling(0.15)
    expect(openRouterStages.get()).toEqual({ fast: 0.1, balanced: 0.15, deep: 0.15 })
  })

  it('measures input + output under the total basis', () => {
    openRouterRange.set({ basis: 'total' })
    expect(measuredPrice(opus)).toBe(90)
    expect(measuredPrice({ output: 2 })).toBe(2)
    expect(measuredPrice({ input: 1 })).toBeUndefined()
    openRouterStages.set({ fast: 1, balanced: 10, deep: 100 })
    expect(placeModel(opus)).toBe('deep')
    expect(placeModel({ input: 1, output: 5 })).toBe('balanced')
  })

  it('leaves out a model under the floor', () => {
    openRouterStages.setCeiling(undefined)
    openRouterRange.set({ floor: 1 })
    expect(placeModel(flash)).toBe('under')
    expect(outsideRange(placeModel(flash))).toBe(true)
    expect(outsideRange(placeModel(opus))).toBe(false)
  })

  it('"in and out" holds the input price to its own bounds', () => {
    openRouterStages.setCeiling(undefined)
    openRouterRange.set({ inputMax: 10 })
    expect(placeModel(opus)).toBe('over')
    expect(placeModel({ input: 3, output: 15 })).toBe('deep')
    openRouterRange.set({ inputMin: 1 })
    expect(placeModel(flash)).toBe('under')
    // the total basis ignores the input bounds
    openRouterRange.set({ basis: 'total' })
    expect(placeModel(opus)).toBe('deep')
  })

  it('remembers no input limit across a reload (JSON has no Infinity)', () => {
    openRouterRange.set({ floor: 0.5, inputMax: Number.POSITIVE_INFINITY })
    expect(openRouterRange.get()).toEqual({ basis: 'split', floor: 0.5, inputMin: 0, inputMax: Number.POSITIVE_INFINITY })
  })
})
