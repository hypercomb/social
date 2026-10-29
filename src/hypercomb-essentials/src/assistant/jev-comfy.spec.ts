import { describe, expect, it } from 'vitest'
import { jevComfyInput, jevComfyQuestions, jevComfyResult } from './jev-comfy.js'

const input = () => jevComfyInput({
  tile: 'lantern',
  own: 'in fog',
  brief: 'Tile: lantern',
  options: ['a lantern in fog', 'a gate at dusk'],
})

describe('Jev picks a picture prompt', () => {
  it('offers each option and a way to keep the participant\'s words', () => {
    const questions = jevComfyQuestions(input())
    expect(questions.prompt.criteria['o0']).toBe('a lantern in fog')
    expect(questions.prompt.criteria['o1']).toBe('a gate at dusk')
    expect(questions.prompt.criteria['none']).toContain('own words')
  })

  it('takes the option Jev is sure about', () => {
    const result = jevComfyResult({
      model: 'jev',
      answers: { prompt: { type: 'choice', choice: 'o1', confidence: 0.9 } },
    }, input())
    expect(result.index).toBe(1)
  })

  it('leaves the participant\'s words when Jev is unsure or wants none', () => {
    const low = jevComfyResult({
      answers: { prompt: { type: 'choice', choice: 'o0', confidence: 0.2 } },
    }, input())
    const none = jevComfyResult({
      answers: { prompt: { type: 'choice', choice: 'none', confidence: 0.9 } },
    }, input())
    expect(low.index).toBe(-1)
    expect(none.index).toBe(-1)
  })

  it('refuses a pile of options', () => {
    expect(() => jevComfyInput({
      tile: 'lantern', own: '', brief: '', options: Array.from({ length: 9 }, (_, i) => `p${i}`),
    })).toThrow(/1–8/)
  })
})
