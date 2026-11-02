import { describe, expect, it } from 'vitest'
import { JEV_CLARIFY_GATES, JEV_CLARIFY_MAX, jevClarifyInput, jevClarifyQuestions, jevClarifyResult } from './jev-clarify.js'

const input = jevClarifyInput({
  line: 'open the thing', word: 'open',
  options: [{ name: 'view', description: 'show it' }, { name: 'edit', description: 'change it' }, { name: 'copy', description: '' }],
})
const which = (choice: string, confidence = 0.9) => ({ answers: { which: { type: 'choice', choice, confidence } } })

describe('Jev clears an ambiguous word', () => {
  it('asks one choice over the claimants, with none as the way out', () => {
    expect(jevClarifyQuestions(input).which.criteria).toEqual({ o0: 'view — show it', o1: 'edit — change it', o2: 'copy', none: expect.any(String) })
  })
  it('moves the sure pick to the top and keeps the rest in order', () => {
    expect(jevClarifyResult(which('o1'), input).order).toEqual(['edit', 'view', 'copy'])
  })
  it('keeps census order when Jev says none or is not sure enough', () => {
    const census = ['view', 'edit', 'copy']
    expect(jevClarifyResult(which('none'), input).order).toEqual(census)
    expect(jevClarifyResult(which('o2', JEV_CLARIFY_GATES.pick - 0.01), input).order).toEqual(census)
  })
  it('refuses foreign answers, empty lines and too few or too many options', () => {
    expect(() => jevClarifyResult(which('o9'), input)).toThrow()
    expect(() => jevClarifyResult({ answers: {} }, input)).toThrow()
    const many = (n: number) => Array.from({ length: n }, (_, k) => ({ name: `b${k}`, description: '' }))
    expect(() => jevClarifyInput({ line: ' ', word: 'x', options: many(3) })).toThrow()
    expect(() => jevClarifyInput({ line: 'x', word: 'x', options: many(1) })).toThrow()
    expect(() => jevClarifyInput({ line: 'x', word: 'x', options: many(JEV_CLARIFY_MAX + 1) })).toThrow()
  })
})
