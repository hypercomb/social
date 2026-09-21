import { describe, expect, it } from 'vitest'
import { splitQuestion } from '@hypercomb/core'
import { offeredSentence, prepareTable, stepFor, tableFor, TABLE_REFUSAL, type RoundCensus } from './jev-round'
import { tableQuestion, type Decision, type Row } from './hypercomb-jev'

/** A census that knows `create` (additive), `move` (editing), `remove`
 *  (destructive) and the read verbs `list` and `find`. */
const census: RoundCensus = {
  readRead: line => {
    const bare = line.replace(/^\//, '').trim()
    if (!/^(list|find)\b/.test(bare)) throw new Error(`${bare.split(' ')[0]} is not a read`)
    return `/${bare}`
  },
  readDo: lines => {
    const grammars = lines.map(line => `/${line.replace(/^\//, '').trim()}`)
    const reaches = grammars.map(grammar => {
      const verb = grammar.slice(1).split(' ')[0]
      if (verb === 'create') return 'additive' as const
      if (verb === 'move') return 'editing' as const
      if (verb === 'remove') return 'destructive' as const
      throw new Error(`/${verb} is not a behaviour in this hive`)
    })
    const order = ['additive', 'editing', 'destructive'] as const
    return { grammars, reach: reaches.reduce((far, reach) => order.indexOf(reach) > order.indexOf(far) ? reach : far, 'additive' as const) }
  },
}
const table = (rows: unknown[]) => [JSON.stringify({ rows })]
const rows = [
  { id: 'a', kind: 'read', label: 'See the people', line: 'list /people' },
  { id: 'b', kind: 'do', label: 'Make people', lines: ['create people'] },
  { id: 'c', kind: 'answer', label: 'Answer now' },
  { id: 'd', kind: 'ask', label: 'Ask how', line: 'By city or by role?' },
  { id: 'x', kind: 'do', label: 'Frobnicate', lines: ['frobnicate it'] },
]
const decision = (plan: Decision['plan'], rejected: string[] = []): Decision => ({ plan, rejected, reason: 'Because.', model: 'm', answers: {} })

describe('which reply is a table', () => {
  it('takes a table as written and leaves reads alone', () => {
    expect(tableFor({ kind: 'table', lines: ['{"rows":[]}'] }, false)).toEqual(['{"rows":[]}'])
    expect(tableFor({ kind: 'read', lines: ['/list /'] }, true)).toBeUndefined()
  })
  it('wraps a bare change block in Jev mode in the worker’s own words', () => {
    expect(tableFor({ kind: 'do', lines: ['/create jev-proof'] }, false)).toBeUndefined()
    const wrapped = JSON.parse(tableFor({ kind: 'do', lines: ['/create jev-proof', '/move a b'] }, true)![0])
    expect(wrapped.rows).toEqual([{ id: 'action', kind: 'do', label: 'create jev-proof', lines: ['/create jev-proof', '/move a b'] }])
  })
})

describe('the hive’s parsers go first', () => {
  it('keeps what can run, with reach, and drops what cannot as a miss', () => {
    const prepared = prepareTable(table(rows), census)
    expect(prepared.rows.map(row => row.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(prepared.rows.find(row => row.id === 'b')?.reach).toBe('additive')
    expect(prepared.grammarOf.get('a')).toEqual(['/list /people'])
    expect(prepared.grammarOf.get('b')).toEqual(['/create people'])
    expect(prepared.dropped).toEqual([{ id: 'x', reason: '/frobnicate is not a behaviour in this hive', sentence: 'frobnicate it' }])
  })
  it('takes a change’s farthest reach', () => {
    const prepared = prepareTable(table([{ id: 'm', kind: 'do', label: 'Tidy', lines: ['create a', 'remove b'] }]), census)
    expect(prepared.rows[0].reach).toBe('destructive')
  })
  it('refuses a malformed table, and a table where nothing can run', () => {
    expect(() => prepareTable(['not json'], census)).toThrow(TABLE_REFUSAL)
    expect(() => prepareTable(table([rows[4]]), census)).toThrow('no row can run: x: /frobnicate is not a behaviour in this hive')
  })
})

describe('the plan becomes one step', () => {
  const prepared = prepareTable(table(rows), census)
  it('runs a chosen change, with or without review', () => {
    expect(stepFor(decision({ kind: 'do', row: 'b', review: false }), prepared)).toMatchObject({ kind: 'do', grammars: ['/create people'], review: false })
    expect(stepFor(decision({ kind: 'do', row: 'b', review: true }), prepared)).toMatchObject({ kind: 'do', review: true })
  })
  it('reads every chosen read in one round, and tells the worker what could not run', () => {
    const step = stepFor(decision({ kind: 'read', rows: ['a'] }), prepared)
    expect(step).toMatchObject({ kind: 'read', grammars: ['/list /people'] })
    expect(step.kind === 'read' && step.note).toContain('x (/frobnicate is not a behaviour in this hive)')
  })
  it('tells the worker to answer', () => {
    const step = stepFor(decision({ kind: 'answer' }), prepared)
    expect(step.kind === 'answer' && step.reply).toContain('Answer the participant now in prose')
  })
  it('refuses when every change conflicts with doctrine', () => {
    expect(stepFor({ ...decision({ kind: 'revise' }), reason: 'Conflict.' }, prepared)).toEqual({ kind: 'refuse', reason: 'Conflict.' })
  })
  it('asks the participant with the sentences, never the rejected ones or the answer row', () => {
    const step = stepFor(decision({ kind: 'participant', rows: ['a', 'b'] }, ['b']), prepared)
    expect(step.kind).toBe('question')
    const options = splitQuestion(step.kind === 'question' ? step.text : '').question?.options
    // An ask row is a question for the participant, shown but never a clickable sentence.
    expect(options).toEqual(['list /people', 'Something else'])
    expect(step.kind === 'question' && step.text).toContain('By city or by role?')
  })
  it('asks the worker’s own question when Jev chose to ask', () => {
    const step = stepFor(decision({ kind: 'ask', row: 'd' }), prepared)
    const question = splitQuestion(step.kind === 'question' ? step.text : '').question
    expect(question?.prompt).toBe('By city or by role?')
    expect(question?.options).toEqual(['list /people', 'create people', 'Something else'])
  })
})

describe('the question speaks the participant language', () => {
  it('uses the words the shell passes for the prompt and the other option', () => {
    const prepared = prepareTable(table(rows), census)
    const step = stepFor(decision({ kind: 'participant', rows: ['a'] }), prepared, { which: 'Welchen Schritt?', other: 'Etwas anderes' })
    const question = splitQuestion(step.kind === 'question' ? step.text : '').question
    expect(question?.prompt).toBe('Welchen Schritt?')
    expect(question?.options.at(-1)).toBe('Etwas anderes')
  })
})

describe('the participant speaks the hive’s language', () => {
  const asked = tableQuestion([{ id: 'b', kind: 'do', label: 'Make people', lines: ['/create people'] }, { id: 'a', kind: 'read', label: 'See', lines: ['list /people'] }] as Row[], 'Because.')
  it('runs an offered sentence as the behaviour it is', () => {
    expect(offeredSentence('create people', asked, census)).toEqual({ kind: 'do', grammar: '/create people' })
    expect(offeredSentence('list /people', asked, census)).toEqual({ kind: 'read', grammar: '/list /people' })
  })
  it('never turns prose, an unoffered sentence, or a non-sentence option into a command', () => {
    expect(offeredSentence('Something else', asked, census)).toBeNull()
    expect(offeredSentence('create robots', asked, census)).toBeNull()
    expect(offeredSentence('create people', 'no question here', census)).toBeNull()
    expect(offeredSentence('create people', undefined, census)).toBeNull()
  })
})
