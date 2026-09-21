import { describe, expect, it } from 'vitest'
import { JEV_FILE_GATES, jevFileInput, jevFileQuestions, jevFileResult } from './jev-file.js'

const input = jevFileInput({ note: 'water the tomatoes', tiles: ['garden', 'finance'] })
const where = (choice: string, confidence = 0.9) => ({ model: 'm', answers: { where: { type: 'choice', choice, confidence } } })

describe('Jev files a note', () => {
  it('asks one choice over the page tiles, with here as the way out', () => {
    const { where: question } = jevFileQuestions(input)
    expect(question.type).toBe('choice')
    expect(question.criteria).toEqual({ t0: 'garden', t1: 'finance', here: expect.any(String) })
  })
  it('files under the chosen tile only when sure enough, otherwise here', () => {
    expect(jevFileResult(where('t0'), input).tile).toBe('garden')
    expect(jevFileResult(where('t0', JEV_FILE_GATES.where - 0.01), input).tile).toBeUndefined()
    expect(jevFileResult(where('here'), input).tile).toBeUndefined()
    expect(jevFileResult(where('t1', 0.92), input).reason).toBe('finance .92')
  })
  it('refuses empty notes, no tiles, and foreign answers', () => {
    expect(() => jevFileInput({ note: ' ', tiles: ['a'] })).toThrow()
    expect(() => jevFileInput({ note: 'x', tiles: [] })).toThrow()
    expect(() => jevFileResult(where('t9'), input)).toThrow()
  })
})
