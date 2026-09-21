import { describe, expect, it } from 'vitest'
import { JEV_VERIFY_GATES, jevVerifyInput, jevVerifyQuestions, jevVerifyResult } from './jev-verify.js'

const noul = (value: number) => ({ type: 'noul', noul: value })

describe('Jev checks the answer', () => {
  it('asks two single-condition questions, each with what yes and no mean', () => {
    const questions = jevVerifyQuestions()
    expect(Object.keys(questions)).toEqual(['supported', 'complete'])
    for (const question of Object.values(questions)) {
      expect(question.type).toBe('noul')
      expect(question.criteria.true).toBeTruthy()
      expect(question.criteria.false).toBeTruthy()
    }
  })
  it('needs something read to check against, within its budget', () => {
    expect(() => jevVerifyInput({ request: 'r', evidence: [], answer: 'a' })).toThrow('needs what was read')
    expect(() => jevVerifyInput({ request: 'r', evidence: ['x'.repeat(16_001)], answer: 'a' })).toThrow()
    expect(jevVerifyInput({ request: ' r ', evidence: ['read'], answer: ' a ' })).toEqual({ request: 'r', evidence: ['read'], answer: 'a' })
  })
  it('verifies only when the answer is both supported and complete', () => {
    const at = (supported: number, complete: number) => jevVerifyResult({ model: 'm', answers: { supported: noul(supported), complete: noul(complete) } })
    expect(at(0.95, 0.9).verified).toBe(true)
    expect(at(JEV_VERIFY_GATES.supported - 0.01, 0.95).verified).toBe(false)
    expect(at(0.95, 0.3).verified).toBe(false)
    expect(at(0.2, 0.9).reason).toBe('supported .20 · complete .90')
  })
  it('fails closed on a missing or malformed answer', () => {
    expect(() => jevVerifyResult({ answers: { supported: noul(1) } })).toThrow()
    expect(() => jevVerifyResult({ answers: { supported: noul(1.5), complete: noul(1) } })).toThrow()
  })
})
