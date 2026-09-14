import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_STAGES, openRouterStages, stageFor, stagePosition, stagePrice } from './openrouter-stages.js'

beforeEach(() => localStorage.removeItem('hc:llm:openrouter:stages'))

describe('price stages', () => {
  it('starts near DeepSeek: quick work at its price, double and triple for heavier work', () => {
    expect(openRouterStages.get()).toEqual(DEFAULT_STAGES)
  })

  it('keeps the stops in order and inside the scale', () => {
    openRouterStages.set({ fast: 5, balanced: 0.05, deep: 999 })
    expect(openRouterStages.get()).toEqual({ fast: 0.05, balanced: 5, deep: 20 })
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
    expect(stagePosition(20)).toBe(1)
    expect(stagePrice(stagePosition(0.3))).toBe(0.3)
  })
})
