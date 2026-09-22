// jev-round-write.spec.ts — THE WRITE BLOCK MEETS JEV. In Jev mode a
// hypercomb-write block is a one-row write table: Jev judges the header, the
// code stays in the block, and the chosen step is a write the loop runs
// through the same door the participant's own writes take.

import { describe, expect, it } from 'vitest'
import { prepareTable, stepFor, tableFor, WRITE_ROW_REFUSAL, writeLine, type RoundCensus } from './jev-round'
import { parseTable, type Decision } from './hypercomb-jev'

const SIG = 'c'.repeat(64)
const SECTION = 'src/games/solomon/labyrinth.ts'
const block = [`${SIG} ${SECTION}`, 'var rooms = "fresh";', 'export {};']
const census: RoundCensus = {
  readRead: line => `/${line.replace(/^\//, '')}`,
  readDo: lines => ({ grammars: lines.map(line => `/${line.replace(/^\//, '')}`), reach: 'additive' }),
}
const decision = (plan: Decision['plan'], answers: Record<string, unknown> = {}): Decision =>
  ({ plan, rejected: [], reason: 'Jev chose it.', model: 'jev', answers })

describe('a write block in Jev mode', () => {
  it('becomes a one-row write table whose line is the header, with the block kept beside it', () => {
    const table = tableFor({ kind: 'write', lines: block }, true)!
    expect(table.write).toBe(block)
    const [row] = parseTable(table.lines)
    expect(row).toEqual({ id: 'write', kind: 'write', label: `Write ${SECTION}`, lines: [writeLine(SIG, SECTION)] })
    expect(tableFor({ kind: 'write', lines: block }, false)).toBeUndefined()
  })

  it('is refused in the block\'s own words when the header is malformed', () => {
    const table = tableFor({ kind: 'write', lines: ['not a header', 'code'] }, true)!
    expect(() => prepareTable(table, census)).toThrow('block starts with <module signature> <src/path.ts>')
  })

  it('prepares as an editing row that runs the block, never a grammar', () => {
    const prepared = prepareTable(tableFor({ kind: 'write', lines: block }, true)!, census)
    expect(prepared.rows[0]!.reach).toBe('editing')
    expect(prepared.writeOf.get('write')).toBe(block)
    expect(prepared.grammarOf.has('write')).toBe(false)
    const step = stepFor(decision({ kind: 'do', row: 'write', review: false }), prepared)
    expect(step).toMatchObject({ kind: 'write', lines: block, review: false })
    expect(stepFor(decision({ kind: 'do', row: 'write', review: true }), prepared)).toMatchObject({ kind: 'write', review: true })
  })

  it('drops a write row a table lists without its block', () => {
    const lines = [JSON.stringify({ rows: [
      { id: 'w', kind: 'write', label: 'Write it', line: writeLine(SIG, SECTION) },
      { id: 'c', kind: 'do', label: 'Create it', lines: ['create solomon'] },
    ] })]
    const prepared = prepareTable({ lines }, census)
    expect(prepared.rows.map(row => row.id)).toEqual(['c'])
    expect(prepared.dropped[0]).toMatchObject({ id: 'w', reason: WRITE_ROW_REFUSAL })
  })

  it('offers no write as a sentence, and orders the question by the live fit keys', () => {
    const lines = [JSON.stringify({ rows: [
      { id: 'l', kind: 'read', label: 'Look first', line: 'list /' },
      { id: 'c', kind: 'do', label: 'Create it', lines: ['create solomon'] },
    ] })]
    const prepared = prepareTable({ lines, write: block }, census)
    const step = stepFor(decision({ kind: 'participant', rows: ['l', 'c'] }, {
      l_needed: { type: 'noul', noul: 0.3 }, c_toward: { type: 'noul', noul: 0.9 },
    }), prepared)
    expect(step.kind).toBe('question')
    if (step.kind !== 'question') return
    // The change scored higher on its own fit question, so it is listed first.
    expect(step.text.indexOf('**Create it**')).toBeLessThan(step.text.indexOf('**Look first**'))
    expect(step.text).not.toContain(writeLine(SIG, SECTION))
  })
})
