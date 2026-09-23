import { describe, expect, it } from 'vitest'
import { JEV_CHOICE_GATES, JEV_MAX_READS, jevDoctrineSections, jevInput, jevQuestions, jevReadingQuestions, jevReadingResult, jevReadingState, jevResult, jevState, jevPassQuestions, jevPassResult, jevPassState } from './jev-decision.js'

const doctrine = ['### Nothing is deleted\nHide first; delete second.', '### The core rule\nContent is addressed by signature.']
const rows = [
  { id: 'a', kind: 'read', label: 'See the people', lines: ['/list /business/people'] },
  { id: 'b', kind: 'read', label: 'Find cigar', lines: ['/find cigar'] },
  { id: 'c', kind: 'do', label: 'Create people', lines: ['/create people'], why: 'the request asks for it' },
  { id: 'd', kind: 'answer', label: 'Answer now' },
  { id: 'e', kind: 'ask', label: 'Ask how to group', lines: ['By city or by role?'] },
]
const build = (overrides: Partial<Record<string, unknown>> = {}) =>
  jevInput({ request: 'Organize the people', doctrine, evidence: ['Nothing read yet.'], rows: rows.map(row => row.id === 'c' ? { ...row, ...overrides } : row) })
const input = build()
const noul = (value: number) => ({ type: 'noul', noul: value })
const choice = (pick: string, confidence = 0.96) => ({ type: 'choice', choice: pick, confidence, probabilities: { a: 0, b: 0, c: 0, d: 0, e: 0, none: 0, [pick]: 1 } })
const response = (pick: string, over: Partial<Record<string, unknown>> = {}) => ({ model: 'typesafe/jev-resolved', answers: {
  a_needed: noul(0.95), a_known: noul(0.1), b_needed: noul(0.3), b_known: noul(0.1),
  c_toward: noul(0.97), c_beyond: noul(0.03), c_grounded: noul(0.96), c_rule0: noul(0.01), c_rule1: noul(0.02),
  d_answered: noul(0.1), e_open: noul(0.2),
  next: choice(pick),
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
  it('takes doctrine as sections, or as one string for older callers', () => {
    expect(input.doctrine).toEqual(doctrine)
    expect(jevInput({ request: 'r', doctrine: 'Follow the request.', evidence: 'e', rows: [rows[3]] }).doctrine).toEqual(['Follow the request.'])
    expect(() => jevInput({ request: 'r', doctrine: [], evidence: 'e', rows: [rows[3]] })).toThrow()
  })
})

describe('the questions follow the vendor guidance our doctrine allows', () => {
  const questions = jevQuestions(input)
  it('asks one condition per question, with what yes and no mean', () => {
    expect(Object.keys(questions).sort()).toEqual([
      'a_known', 'a_needed', 'b_known', 'b_needed',
      'c_beyond', 'c_grounded', 'c_rule0', 'c_rule1', 'c_toward',
      'd_answered', 'e_open', 'next',
    ])
    for (const [key, question] of Object.entries(questions)) {
      if (key === 'next') continue
      const criteria = (question as { criteria: { true: string; false: string } }).criteria
      expect(question.type).toBe('noul')
      expect(criteria.true).toBeTruthy()
      expect(criteria.false).toBeTruthy()
    }
  })
  it('carries each doctrine section in its own question, never the whole doctrine', () => {
    expect(questions['c_rule0'].instructions).toContain('Hide first; delete second.')
    expect(questions['c_rule0'].instructions).not.toContain('addressed by signature')
    expect(questions['c_rule1'].instructions).toContain('`rows[2].lines`')
  })
  it('keeps doctrine and the hive reach out of the shared state', () => {
    const state = JSON.stringify(jevState(build({ reach: 'additive' })))
    expect(state).not.toContain('Hide first')
    expect(state).not.toContain('reach')
    expect(state).toContain('Organize the people')
  })
  it('keeps the choice free of policy: the preferences live in code', () => {
    expect(questions['next'].instructions).not.toMatch(/prefer/i)
    expect((questions['next'] as { criteria: Record<string, string> }).criteria).toHaveProperty('none')
  })
})

describe('composition', () => {
  it('runs a confident change that passes every gate', () => {
    const result = jevResult(response('c'), input)
    expect(result.plan).toEqual({ kind: 'do', row: 'c', review: false })
    expect(result.usage).toEqual({ inputTokens: 500, outputTokens: 0, cost: 0.00002 })
  })
  it('gates a change by the reach its behaviours declare', () => {
    const thin = { c_grounded: noul(0.4) }
    expect(jevResult(response('c', thin), build({ reach: 'additive' })).plan).toEqual({ kind: 'do', row: 'c', review: false })
    expect(jevResult(response('c', thin), build({ reach: 'editing' })).plan).toEqual({ kind: 'do', row: 'c', review: true })
    expect(jevResult(response('c', thin), input).plan).toEqual({ kind: 'do', row: 'c', review: true })
    const destructive = jevResult(response('c'), build({ reach: 'destructive' }))
    expect(destructive.plan).toEqual({ kind: 'do', row: 'c', review: true })
    expect(destructive.reason).toContain('always reviews')
  })
  it('scales the choice threshold with risk', () => {
    const at = (confidence: number) => ({ next: choice('c', confidence) })
    expect(JEV_CHOICE_GATES.additive).toBeLessThan(JEV_CHOICE_GATES.editing)
    expect(jevResult(response('c', at(0.75)), build({ reach: 'additive' })).plan).toEqual({ kind: 'do', row: 'c', review: false })
    expect(jevResult(response('c', at(0.75)), build({ reach: 'editing' })).plan).toEqual({ kind: 'do', row: 'c', review: true })
    expect(jevResult(response('d', { d_answered: noul(0.95), next: choice('d', 0.65) }), input).plan).toEqual({ kind: 'answer' })
    expect(jevResult(response('c', at(0.45)), input).plan).toEqual({ kind: 'read', rows: ['a'] })
  })
  it('sends a change that strays beyond the request to review', () => {
    expect(jevResult(response('c', { c_beyond: noul(0.5) }), input).plan).toEqual({ kind: 'do', row: 'c', review: true })
  })
  it('holds a change on any doubtful doctrine section, and rejects a clear breach, naming the rule', () => {
    const doubt = jevResult(response('c', { c_rule1: noul(0.3) }), input)
    expect(doubt.plan).toEqual({ kind: 'do', row: 'c', review: true })
    expect(doubt.reason).toContain('rules .30 (The core rule)')
    const breach = jevResult(response('c', { c_rule0: noul(0.97) }), input)
    expect(breach.rejected).toEqual(['c'])
    expect(breach.plan).toEqual({ kind: 'read', rows: ['a'] })
    expect(breach.reason).toContain('conflicts with Hypercomb doctrine')
  })
  it('runs a read Jev only half-trusts, but never re-reads what the evidence already shows', () => {
    const replay = response('none', { a_needed: noul(0.66), c_toward: noul(0.17), c_rule0: noul(0.5), c_grounded: noul(0.13) })
    expect(jevResult(replay, input).plan).toEqual({ kind: 'read', rows: ['a'] })
    expect(jevResult(response('none', { a_known: noul(0.8) }), input).plan.kind).toBe('participant')
    expect(jevResult(response('none', { a_needed: noul(0.55) }), input).plan.kind).toBe('participant')
  })
  it('batches the reads that pass when Jev chooses a read, most needed first', () => {
    const result = jevResult(response('b', { b_needed: noul(0.9) }), input)
    expect(result.plan).toEqual({ kind: 'read', rows: ['b', 'a'].slice(0, JEV_MAX_READS) })
  })
  it('ends the work, or asks, when those rows pass', () => {
    expect(jevResult(response('d', { d_answered: noul(0.95) }), input).plan).toEqual({ kind: 'answer' })
    expect(jevResult(response('e', { e_open: noul(0.95) }), input).plan).toEqual({ kind: 'ask', row: 'e' })
  })
  it('asks the participant when nothing passes, excluding rejected rows; revises when every change breaks doctrine', () => {
    const nothing = jevResult(response('none', { a_needed: noul(0.2) }), input)
    expect(nothing.plan).toEqual({ kind: 'participant', rows: ['a', 'b', 'c', 'e'] })
    const one = jevInput({ request: 'r', doctrine, evidence: 'e', rows: [rows[2]] })
    const answers = { c_toward: noul(1), c_beyond: noul(0), c_grounded: noul(1), c_rule0: noul(0.99), c_rule1: noul(0), next: { type: 'choice', choice: 'c', confidence: 1 } }
    expect(jevResult({ answers }, one).plan).toEqual({ kind: 'revise' })
  })
  it('defers to the participant when confidence is absent', () => {
    const absent = jevResult(response('c', { a_needed: noul(0.2), next: { type: 'choice', choice: 'c' } }), input)
    expect(absent.plan.kind).toBe('participant')
    expect(absent.reason).toContain('confidence')
  })
  it('fails closed on missing answers, foreign choices and invalid probabilities', () => {
    expect(() => jevResult({ answers: {} }, input)).toThrow()
    expect(() => jevResult(response('execute'), input)).toThrow()
    expect(() => jevResult(response('c', { next: { ...choice('c'), probabilities: { a: Number.NaN } } }), input)).toThrow()
    expect(() => jevResult(response('c', { c_rule0: { type: 'choice', choice: 'yes' } }), input)).toThrow()
  })
})

describe('Jev reads a trial', () => {
  const reading = { sandbox: 'try-zoom', doctrine, files: [
    { section: 'src/a.ts', diff: '+ export const zoom = 2;\n− export const zoom = 1;' },
    { section: 'src/b.ts', diff: '+ globalThis.__proof = 1;' },
  ] }

  it('asks the write\'s own rule question, once per file per doctrine section, and nothing else', () => {
    const questions = jevReadingQuestions(reading)
    expect(Object.keys(questions).sort()).toEqual(['f0_rule0', 'f0_rule1', 'f1_rule0', 'f1_rule1'])
    expect(questions['f1_rule0']!.instructions).toContain('rows[1].lines')
    expect(questions['f1_rule0']!.instructions).toContain('Hide first; delete second.')
    const state = jevReadingState(reading)
    expect(state.rows.map(row => `${row.kind}:${row.label}`)).toEqual(['write:src/a.ts', 'write:src/b.ts'])
    expect(state.evidence[1]).toBe('+ globalThis.__proof = 1;')
    expect(state.rows[1]!.lines).toEqual(['write src/b.ts', 'the change is evidence[1]'])
  })

  it('reads the standing from the worst rule: follows within the gate, breaks past reject, unsure between', () => {
    const answer = (over: Record<string, number>) => ({ model: 'typesafe/jev-resolved', answers: Object.fromEntries(
      Object.entries({ f0_rule0: 0.01, f0_rule1: 0.02, f1_rule0: 0.03, f1_rule1: 0.01, ...over }).map(([key, value]) => [key, noul(value)])), usage: { input_tokens: 42, cost: 0.00001 } })
    const follows = jevReadingResult(answer({}), reading)
    expect(follows.verdict).toBe('follows')
    expect(follows.files.map(file => file.worst)).toEqual([{ rule: 'The core rule', breaks: 0.02 }, { rule: 'Nothing is deleted', breaks: 0.03 }])
    expect(follows.files[0]!.rules.map(rule => rule.rule)).toEqual(['Nothing is deleted', 'The core rule'])
    expect([follows.model, follows.usage?.inputTokens]).toEqual(['typesafe/jev-resolved', 42])
    expect(jevReadingResult(answer({ f1_rule1: 0.5 }), reading).verdict).toBe('unsure')
    expect(jevReadingResult(answer({ f0_rule0: 0.97 }), reading).verdict).toBe('breaks')
    expect(() => jevReadingResult({ answers: {} }, reading)).toThrow()
  })

  it('cuts the doctrine from the anatomy the way a write does', () => {
    const anatomy = '# Hypercomb anatomy\n\nmechanics\n\n# Doctrine\n\nlifted verbatim\n\n### One\nfirst rule\n\n### Two\nsecond rule\n'
    expect(jevDoctrineSections(anatomy)).toEqual(['### One\nfirst rule', '### Two\nsecond rule'])
    expect(jevDoctrineSections('no doctrine here')).toEqual(['no doctrine here'])
    expect(jevDoctrineSections('')).toEqual([])
  })
})

describe('Jev weighs a zone', () => {
  const pass = { zone: 'hypercomb.com', trials: [
    { name: 'try-rooms', evidence: 'try-rooms by Jaime: changes src/a.ts.\nThe host\'s AI says accept. Jev says follows.\nPeople: 0 accept, 1 refuse, 0 unclear. Notes: refuse — "raises zoom without asking".' },
    { name: 'try-rooms-mine', evidence: 'try-rooms-mine by Other: no source changes; takes commands from other builds.\nThe host\'s AI says accept. Jev says follows.\nPeople: 0 accept, 0 refuse, 0 unclear.' },
  ] }

  it('asks whether each trial conforms and whether anyone refused it, and which to focus on', () => {
    const questions = jevPassQuestions(pass)
    expect(Object.keys(questions).sort()).toEqual(['focus', 't0_conforms', 't0_refused', 't1_conforms', 't1_refused'])
    expect(questions['t1_refused']!.instructions).toContain('evidence[1]')
    expect((questions['focus'] as { criteria: Record<string, string> }).criteria).toEqual({ t0: 'rows[0]: try-rooms', t1: 'rows[1]: try-rooms-mine', none: 'No trial stands out' })
    const state = jevPassState(pass)
    expect(state.rows.map(row => `${row.kind}:${row.label}`)).toEqual(['do:try-rooms', 'do:try-rooms-mine'])
    expect(state.evidence[0]).toContain('raises zoom without asking')
  })

  it('reads each standing from the gates and the focus from a confident choice', () => {
    const answer = (focus: string, confidence: number, over: Record<string, number> = {}) => ({ model: 'typesafe/jev-resolved', answers: {
      ...Object.fromEntries(Object.entries({ t0_conforms: 0.96, t0_refused: 0.9, t1_conforms: 0.95, t1_refused: 0.02, ...over }).map(([key, value]) => [key, noul(value)])),
      focus: { type: 'choice', choice: focus, confidence },
    }, usage: { input_tokens: 42 } })
    const weighed = jevPassResult(answer('t1', 0.9), pass)
    expect(weighed.trials.map(trial => `${trial.name}:${trial.standing}`)).toEqual(['try-rooms:discuss', 'try-rooms-mine:take'])
    expect([weighed.focus, weighed.confidence, weighed.model, weighed.usage?.inputTokens]).toEqual(['try-rooms-mine', 0.9, 'typesafe/jev-resolved', 42])
    expect(jevPassResult(answer('t1', 0.3), pass).focus).toBeNull()
    expect(jevPassResult(answer('none', 0.9), pass).focus).toBeNull()
    expect(jevPassResult(answer('t1', 0.9, { t1_conforms: 0.5 }), pass).trials[1]!.standing).toBe('wait')
    expect(() => jevPassResult(answer('t9', 0.9), pass)).toThrow()
  })
})
