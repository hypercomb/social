import { describe, expect, it } from 'vitest'
import { JEV_FRONT_GATES, jevFrontInput, jevFrontQuestions, jevFrontResult, jevFrontState } from './jev-front.js'

const behaviours = [{ name: 'create', description: 'Create a tile here', forms: '<name>', reach: 'additive' }]
const noul = (p: number) => ({ type: 'noul', noul: p })
const weight = (choice: string, confidence = 0.9) => ({ type: 'choice', choice, confidence })
const direct = { single: noul(0.2), behaviour: { type: 'choice', choice: 'none', confidence: 0.9 } }

describe('the front door', () => {
  it('asks the direct questions only when behaviours are offered, and carry only after an answer', () => {
    const bare = jevFrontInput({ request: 'hello' })
    expect(Object.keys(jevFrontQuestions(bare))).toEqual(['hive', 'weight'])
    expect(jevFrontState(bare)).toEqual({ request: 'hello' })
    const full = jevFrontInput({ request: 'create garden', behaviours, carrying: true })
    expect(Object.keys(jevFrontQuestions(full))).toEqual(['single', 'behaviour', 'span', 'hive', 'weight', 'carry'])
  })
  it('steps aside only when sure the hive is not needed, and never over a direct step', () => {
    const input = jevFrontInput({ request: 'write a haiku about rain', behaviours })
    expect(jevFrontResult({ answers: { ...direct, hive: noul(0.05), weight: weight('fast') } }, input).aside).toBe(true)
    expect(jevFrontResult({ answers: { ...direct, hive: noul(1 - JEV_FRONT_GATES.aside + 0.01), weight: weight('fast') } }, input).aside).toBe(false)
    expect(jevFrontResult({ answers: { ...direct } }, input).aside).toBe(false)
    const take = jevFrontInput({ request: 'create garden', behaviours })
    const taken = jevFrontResult({ answers: { single: noul(0.97), behaviour: { type: 'choice', choice: 'create', confidence: 0.95 }, span: { type: 'choice', choice: 's1', confidence: 0.9 }, hive: noul(0.01) } }, take)
    expect(taken.direct?.sentence).toBe('create garden')
    expect(taken.aside).toBe(false)
  })
  it('names a weight only above its gate', () => {
    const input = jevFrontInput({ request: 'plan the release' })
    expect(jevFrontResult({ answers: { hive: noul(0.5), weight: weight('deep') } }, input).weight).toBe('deep')
    expect(jevFrontResult({ answers: { hive: noul(0.5), weight: weight('deep', JEV_FRONT_GATES.weight - 0.01) } }, input).weight).toBeUndefined()
    expect(() => jevFrontResult({ answers: { weight: weight('heavy') } }, input)).toThrow('unknown weight')
  })
  it('reads a continuing request only when the thread has an answer to continue', () => {
    const input = jevFrontInput({ request: 'why?', carrying: true })
    expect(jevFrontResult({ answers: { hive: noul(0.3), weight: weight('fast'), carry: noul(0.95) } }, input).carry).toBe(true)
    expect(jevFrontResult({ answers: { hive: noul(0.3), weight: weight('fast'), carry: noul(0.5) } }, input).carry).toBe(false)
  })
})
