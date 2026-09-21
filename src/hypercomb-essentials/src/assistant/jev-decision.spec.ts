import { describe, expect, it } from 'vitest'
import { JEV_MAX_READS, jevInput, jevQuestions, jevResult } from './jev-decision.js'

const rows = [
  { id: 'a', kind: 'read', label: 'See the people', lines: ['/list /business/people'] },
  { id: 'b', kind: 'read', label: 'Find cigar', lines: ['/find cigar'] },
  { id: 'c', kind: 'do', label: 'Create people', lines: ['/create people'], why: 'the request asks for it' },
  { id: 'd', kind: 'answer', label: 'Answer now' },
  { id: 'e', kind: 'ask', label: 'Ask how to group', lines: ['By city or by role?'] },
]
const input = jevInput({ request: 'Organize the people', doctrine: 'Preserve history.', evidence: ['Nothing read yet.'], rows })
const noul = (value: number) => ({ type: 'noul', noul: value })
const choice = (pick: string, probabilities: Record<string, number>, confidence = 0.96) => ({ type: 'choice', choice: pick, confidence, probabilities })
const response = (pick: string, over: Partial<Record<string, unknown>> = {}) => ({ model: 'typesafe/jev-resolved', answers: {
  a_fit: noul(0.95), b_fit: noul(0.3), c_fit: noul(0.97), c_rules: noul(0.99), c_grounded: noul(0.96), d_fit: noul(0.1), e_fit: noul(0.2),
  next: choice(pick, { a: 0, b: 0, c: 0, d: 0, e: 0, none: 0, [pick]: 1 }),
  ...over,
}, usage: { input_tokens: 500, output_tokens: 0, cost: 0.00002 } })

describe('the possibility table', () => {
  it('validates shape: kinds, distinct ids and labels, one answer row, line budgets', () => {
    expect(input.rows.map(row => row.kind)).toEqual(['read', 'read', 'do', 'answer', 'ask'])
    const bad = (patch: unknown[]) => () => jevInput({ request: 'r', doctrine: 'd', evidence: 'e', rows: patch })
    expect(bad([])).toThrow()
    expect(bad([{ id: 'none', kind: 'do', label: 'x', lines: ['y'] }])).toThrow()
    expect(bad([{ id: 'a', kind: 'plan', label: 'x', lines: ['y'] }])).toThrow()
    expect(bad([{ id: 'a', kind: 'answer', label: 'x', lines: ['y'] }])).toThrow()
    expect(bad([{ id: 'a', kind: 'read', label: 'x', lines: ['y', 'z'] }])).toThrow()
    expect(bad([{ id: 'a', kind: 'do', label: 'x', lines: ['y'] }, { id: 'b', kind: 'do', label: 'x', lines: ['z'] }])).toThrow()
    expect(bad([{ id: 'a', kind: 'answer', label: 'x' }, { id: 'b', kind: 'answer', label: 'y' }])).toThrow()
    expect(bad(Array.from({ length: 9 }, (_, i) => ({ id: `r${i}`, kind: 'answer', label: `L${i}` })))).toThrow()
    expect(jevInput({ request: 'r', doctrine: 'd', evidence: 'e', rows: [{ id: 'a', kind: 'do', label: 'x', line: 'y' }] }).rows[0].lines).toEqual(['y'])
  })
  it('asks one snap question per factor in one batch, plus the choice', () => {
    const questions = jevQuestions(input)
    expect(Object.keys(questions).sort()).toEqual(['a_fit', 'b_fit', 'c_fit', 'c_grounded', 'c_rules', 'd_fit', 'e_fit', 'next'].sort())
    expect((questions['next'] as { criteria: Record<string, string> }).criteria).toHaveProperty('none')
    expect((questions['c_rules'] as { instructions: string }).instructions).toContain('`rows[2].lines`')
    expect((questions['a_fit'] as { instructions: string }).instructions).toContain('not yet contain')
  })
})

describe('composition', () => {
  it('runs a confident, gated do row without review', () => {
    const result = jevResult(response('c'), input)
    expect(result.plan).toEqual({ kind: 'do', row: 'c', review: false })
    expect(result.usage).toEqual({ inputTokens: 500, outputTokens: 0, cost: 0.00002 })
    expect(result.model).toBe('typesafe/jev-resolved')
  })
  it('batches the reads that pass when Jev chooses a read, best fit first', () => {
    const result = jevResult(response('b', { b_fit: noul(0.9) }), input)
    expect(result.plan).toEqual({ kind: 'read', rows: ['b', 'a'].slice(0, JEV_MAX_READS) })
  })
  it('ends the work when Jev decides the evidence answers the request', () => {
    expect(jevResult(response('d', { d_fit: noul(0.95) }), input).plan).toEqual({ kind: 'answer' })
  })
  it('turns an ask row into a participant question', () => {
    expect(jevResult(response('e', { e_fit: noul(0.95) }), input).plan).toEqual({ kind: 'ask', row: 'e' })
  })
  it('sends a chosen change to review when a gate fails, and never averages past a rule', () => {
    expect(jevResult(response('c', { c_grounded: noul(0.5) }), input).plan).toEqual({ kind: 'do', row: 'c', review: true })
    expect(jevResult(response('c', { c_rules: noul(0.5), c_fit: noul(1), c_grounded: noul(1) }), input).plan).toEqual({ kind: 'do', row: 'c', review: true })
  })
  it('reads first when the choice is unclear or conflicts with doctrine', () => {
    const unclear = jevResult(response('none'), input)
    expect(unclear.plan).toEqual({ kind: 'read', rows: ['a'] })
    const conflict = jevResult(response('c', { c_rules: noul(0.01) }), input)
    expect(conflict.plan).toEqual({ kind: 'read', rows: ['a'] })
    expect(conflict.rejected).toEqual(['c'])
    expect(conflict.reason).toContain('doctrine')
  })
  it('asks the participant when nothing passes, excluding rejected rows; revises when every change conflicts', () => {
    const nothing = jevResult(response('none', { a_fit: noul(0.2) }), input)
    expect(nothing.plan).toEqual({ kind: 'participant', rows: ['a', 'b', 'c', 'e'] })
    const one = jevInput({ request: 'r', doctrine: 'd', evidence: 'e', rows: [rows[2]] })
    expect(jevResult({ answers: { c_fit: noul(1), c_rules: noul(0.01), c_grounded: noul(1), next: choice('c', { c: 1, none: 0 }) } }, one).plan).toEqual({ kind: 'revise' })
  })
  it('defers to the participant when confidence data is weak or absent', () => {
    const weak = jevResult(response('c', { a_fit: noul(0.2), next: choice('c', { a: 0, b: 0, c: 0.6, d: 0, e: 0, none: 0.4 }, 0.6) }), input)
    expect(weak.plan.kind).toBe('participant')
    const absent = jevResult(response('c', { a_fit: noul(0.2), next: { type: 'choice', choice: 'c' } }), input)
    expect(absent.plan.kind).toBe('participant')
    expect(absent.reason).toContain('confidence')
  })
  it('fails closed on missing answers, foreign choices and invalid probabilities', () => {
    expect(() => jevResult({ answers: {} }, input)).toThrow()
    expect(() => jevResult(response('execute'), input)).toThrow()
    expect(() => jevResult(response('c', { next: choice('c', { a: NaN, b: 0, c: 1, d: 0, e: 0, none: 0 }) }), input)).toThrow()
    expect(() => jevResult(response('c', { c_rules: { type: 'choice', choice: 'yes' } }), input)).toThrow()
  })
})
