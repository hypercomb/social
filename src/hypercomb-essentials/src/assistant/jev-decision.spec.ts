import { describe, expect, it } from 'vitest'
import { jevInput, jevQuestions, jevResult } from './jev-decision.js'

const input = jevInput({ request: 'Organize these notes', doctrine: 'Append history; share by signature.', evidence: 'The notes already exist.',
  proposals: [{ id: 'a', label: 'Group notes', plan: 'Group the existing notes.' }, { id: 'b', label: 'Link notes', plan: 'Link the existing notes.' }] })
const response = () => ({ model: 'typesafe/jev-resolved', answers: {
  a_fit: { type: 'noul', noul: 0.99 }, a_rules: { type: 'noul', noul: 0.99 }, a_evidence: { type: 'noul', noul: 0.99 },
  b_fit: { type: 'noul', noul: 0.99 }, b_rules: { type: 'noul', noul: 0.99 }, b_evidence: { type: 'noul', noul: 0.99 },
  direction: { type: 'choice', choice: 'a', confidence: 0.96, probabilities: { a: 0.97, b: 0.02, none: 0.01 } },
}, usage: { input_tokens: 123, output_tokens: 0, cost: 0.00001 } })

describe('Jev decision gates', () => {
  it('batches atomic questions and keeps a reject-all choice', () => {
    expect(Object.keys(jevQuestions(input))).toHaveLength(7)
    expect(jevQuestions(input).direction).toMatchObject({ criteria: { none: expect.any(String) } })
    expect(jevResult(response(), input)).toMatchObject({ outcome: 'selected', selected: 'a', model: 'typesafe/jev-resolved', usage: { inputTokens: 123 } })
  })
  it('never compensates for a doctrine conflict using another score', () => {
    const raw = response(); raw.answers.a_rules.noul = 0.1
    expect(jevResult(raw, input).outcome).toBe('participant')
  })
  it('returns clear doctrine conflicts for revision, including single actions', () => {
    const raw = response(); raw.answers.a_rules.noul = 0.01
    expect(jevResult(raw, input)).toMatchObject({ outcome: 'revise', rejected: ['a'] })
    expect(jevResult(raw, { ...input, proposals: [input.proposals[0]] }).outcome).toBe('revise')
  })
  it('does not treat relative preference as evidence of adequacy', () => {
    const raw = response(); raw.answers.a_evidence.noul = 0.5
    expect(jevResult(raw, input).outcome).toBe('participant')
  })
  it('routes ambiguous preferences and none to the participant', () => {
    const raw = response(); raw.answers.direction.confidence = 0.6
    expect(jevResult(raw, input).outcome).toBe('participant')
    raw.answers.direction = { type: 'choice', choice: 'none', confidence: 1, probabilities: { a: 0, b: 0, none: 1 } }
    expect(jevResult(raw, input).outcome).toBe('participant')
  })
  it('fails closed on missing answers, foreign choices and invalid distributions', () => {
    expect(() => jevResult({ answers: {} }, input)).toThrow()
    const raw = response(); raw.answers.direction.choice = 'execute'
    expect(() => jevResult(raw, input)).toThrow()
    raw.answers.direction.choice = 'a'; raw.answers.direction.probabilities.a = Number.NaN
    expect(() => jevResult(raw, input)).toThrow()
  })
  it('evaluates one action without inventing a competing alternative', () => {
    const one = { ...input, proposals: [input.proposals[0]] }
    expect(Object.keys(jevQuestions(one))).toHaveLength(3)
    expect(jevResult(response(), one).selected).toBe('a')
  })
  it('refuses duplicate identifiers and oversized context before sending', () => {
    expect(() => jevInput({ ...input, proposals: [input.proposals[0], input.proposals[0]] })).toThrow()
    expect(() => jevInput({ ...input, evidence: 'x'.repeat(24_001) })).toThrow()
  })
})
