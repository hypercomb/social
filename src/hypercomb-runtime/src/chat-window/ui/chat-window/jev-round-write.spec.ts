// jev-round-write.spec.ts — THE WRITE BLOCK MEETS JEV. In Jev mode a
// hypercomb-write block is a one-row write table: Jev judges the header AS THE
// WORKER WROTE IT, the body stays in the block, and the chosen step is a
// write the loop runs through the same door the participant's own writes take.

import { describe, expect, it } from 'vitest'
import { prepareTable, stepFor, tableFor, WRITE_ROW_REFUSAL, writeLabelOf, type RoundCensus } from './jev-round'
import { parseTable, type Decision } from './hypercomb-jev'
import { parseWriteBlock, splitWork, writeHeaderOf } from './hypercomb-work-fence'

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
  it('becomes a one-row write table whose line is the header as written, with the block kept beside it', () => {
    const table = tableFor({ kind: 'write', lines: block }, true)!
    expect(table.write).toBe(block)
    const [row] = parseTable(table.lines)
    expect(row).toEqual({ id: 'write', kind: 'write', label: SECTION, lines: [`${SIG} ${SECTION}`] })
    expect(tableFor({ kind: 'write', lines: block }, false)).toBeUndefined()
  })

  it('keeps the header and label verbatim in the worker\'s own message — the source boundary finds them', () => {
    const reply = ['Here is the change.', '```hypercomb-write', `\`/write ${SIG} ${SECTION}\``, 'var rooms = "fresh";', '```'].join('\n')
    const request = splitWork(reply).request!
    const [row] = parseTable(tableFor(request, true)!.lines)
    expect(reply).toContain(row!.lines[0]!)
    expect(reply).toContain(row!.label)
    expect(writeHeaderOf(request.lines)).toBe(`/write ${SIG} ${SECTION}`)
  })

  it('is refused in the block\'s own words when the header is malformed', () => {
    const table = tableFor({ kind: 'write', lines: ['not a header', 'code'] }, true)!
    expect(() => prepareTable(table, census)).toThrow('block starts with <module signature> <src/path.ts>, page /<tile>, or file /<tile> <name.ext>,')
  })

  it('prepares as an editing row that runs the block, never a grammar', () => {
    const prepared = prepareTable(tableFor({ kind: 'write', lines: block }, true)!, census)
    expect(prepared.rows[0]!.reach).toBe('editing')
    expect(prepared.writeOf.get('write')).toBe(block)
    expect(prepared.grammarOf.has('write')).toBe(false)
    expect(stepFor(decision({ kind: 'do', row: 'write', review: false }), prepared)).toMatchObject({ kind: 'write', lines: block, review: false })
    expect(stepFor(decision({ kind: 'do', row: 'write', review: true }), prepared)).toMatchObject({ kind: 'write', review: true })
  })

  it('drops a write row a table lists without its block', () => {
    const lines = [JSON.stringify({ rows: [
      { id: 'w', kind: 'write', label: 'Write it', line: `${SIG} ${SECTION}` },
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
    expect(step.text.indexOf('**Create it**')).toBeLessThan(step.text.indexOf('**Look first**'))
    expect(step.text).not.toContain(SIG)
  })
})

describe('a doctrine block (retired 2026-11-16: the doctrine is tiles)', () => {
  it('is no write target: a doctrine header is refused like any unknown header', () => {
    expect(parseWriteBlock(['doctrine The rule', 'Nesting tiles is ordinary use of the hive.'])).toHaveProperty('error')
    expect(parseWriteBlock(['write doctrine ### The core rule', 'x'])).toHaveProperty('error')
    expect(writeLabelOf(['doctrine The rule', 'x'])).toBe('')
  })
})
