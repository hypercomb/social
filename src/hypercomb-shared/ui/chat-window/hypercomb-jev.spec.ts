import { describe, expect, it } from 'vitest'
import { splitQuestion } from '@hypercomb/core'
import { parseTable, tableQuestion, tableChoiceNote, persistJevInput, persistJevReceipt, formatJevUsage, type Row } from './hypercomb-jev'
import { Blob as NodeBlob } from 'node:buffer'
import { createHash } from 'node:crypto'
import { splitWork, WorkStreamGuard } from './hypercomb-work-fence'

const rows: Row[] = [
  { id: 'a', kind: 'read', label: 'See the notes', lines: ['list /notes'] },
  { id: 'b', kind: 'do', label: 'Group by topic', lines: ['create topics', 'move notes topics'], why: 'asked for' },
  { id: 'c', kind: 'answer', label: 'Answer now', lines: [] },
]
const fence = '```hypercomb-table\n' + JSON.stringify({ rows: [{ id: 'a', kind: 'read', label: 'See the notes', line: 'list /notes' }, { id: 'b', kind: 'do', label: 'Group by topic', lines: ['create topics', 'move notes topics'], why: 'asked for' }, { id: 'c', kind: 'answer', label: 'Answer now' }] }) + '\n```'
describe('Jev usage report', () => {
  it('separates worker and decision usage across rounds', () => {
    expect(formatJevUsage([
      { usage: { inputTokens: 100, outputTokens: 20 } },
      { usage: { inputTokens: 50, outputTokens: 5 } },
      { category: 'jev-decision', usage: { inputTokens: 80, outputTokens: 0 } },
    ])).toBe('Tokens — workers: 150 input, 25 output; Jev: 80 input, 0 output.')
  })
  it('keeps partial and unavailable usage explicit for each dimension', () => {
    expect(formatJevUsage([
      { usage: { inputTokens: 100 } }, {},
      { category: 'jev-decision', usage: { inputTokens: NaN, outputTokens: -1 } },
    ])).toBe('Tokens — workers: 100 input (partial), output unavailable; Jev: input unavailable, output unavailable.')
  })
  it('distinguishes no attempts from attempts with unreported usage', () => {
    expect(formatJevUsage([])).toBe('Tokens — workers: no calls; Jev: no calls.')
    expect(formatJevUsage([{}])).toBe('Tokens — workers: input unavailable, output unavailable; Jev: no calls.')
  })
})
describe('the possibility table protocol', () => {
  it('reuses signed content while changed evidence creates new provenance', async () => {
    const records = new Map<string, unknown>()
    const store = { async putResource(blob: Blob) {
      const text = await blob.text()
      const sig = createHash('sha256').update(text).digest('hex')
      records.set(sig, JSON.parse(text)); return sig
    } }
    const original = globalThis.Blob
    globalThis.Blob = NodeBlob as typeof Blob
    try {
      const input = { request: 'Organize', doctrine: 'Append history.', evidence: ['Before'], rows }
      const first = await persistJevInput(store, input)
      expect(await persistJevInput(store, input)).toBe(first)
      const second = await persistJevInput(store, { ...input, evidence: ['After'] })
      expect(second).not.toBe(first)
      const a = records.get(first!) as Record<string, unknown>
      const b = records.get(second!) as Record<string, unknown>
      expect(a['doctrine']).toBe(b['doctrine'])
      expect(a['rows']).toEqual(b['rows'])
      expect(records.get(a['doctrine'] as string)).toBe(input.doctrine)
      expect(a).not.toHaveProperty('state')
      const receipt = await persistJevReceipt(store, second!, { plan: { kind: 'revise' }, rejected: ['b'], model: 'resolved', reason: 'Conflict', answers: { b_rules: 0.01 } })
      const decision = records.get(receipt!) as Record<string, unknown>
      expect(decision['source']).toBe(second)
      expect(decision['plan']).toEqual({ kind: 'revise' })
      expect(records.get(decision['reason'] as string)).toBe('Conflict')
      expect(records.get(decision['answers'] as string)).toEqual({ b_rules: 0.01 })
    } finally { globalThis.Blob = original }
  })
  it('parses the table verbatim and never executes a co-emitted action', () => {
    const work = splitWork(fence + '\n```hypercomb-do\nhide notes\n```')
    expect(work.request?.kind).toBe('table')
    expect(parseTable(work.request!.lines)).toEqual(rows)
    expect(work.heldDo).toBe(true)
  })
  it('reads first and refuses partial, duplicate or malformed tables', () => {
    expect(splitWork('```hypercomb-read\nread here\n```\n' + fence).request?.kind).toBe('read')
    expect(() => parseTable(splitWork(fence.slice(0, -3)).request!.lines)).toThrow()
    expect(() => parseTable(splitWork(fence + '\n' + fence).request!.lines)).toThrow()
    expect(() => parseTable([JSON.stringify({ rows: [{ id: 'a', kind: 'plan', label: 'x', line: 'y' }] })])).toThrow()
    expect(() => parseTable([JSON.stringify({ rows: [{ id: 'a', kind: 'read', label: 'Something else', line: 'y' }] })])).toThrow()
    expect(() => parseTable([JSON.stringify({ rows: [{ id: 'a', kind: 'read', label: 'x', lines: ['y', 'z'] }] })])).toThrow()
  })
  it('recognises a table by shape in a json fence, a bare fence, or no fence at all', () => {
    const body = JSON.stringify({ rows: [{ id: 'a', kind: 'read', label: 'See the notes', line: 'list /notes' }] })
    for (const text of ['```json\n' + body + '\n```', '```\n' + body + '\n```', body, 'Here is the table:\n```json\n' + body + '\n```']) {
      const work = splitWork(text)
      expect(work.request?.kind).toBe('table')
      expect(parseTable(work.request!.lines)[0].label).toBe('See the notes')
    }
    expect(splitWork('```json\n{"nodes":[]}\n```').request).toBeUndefined()
    expect(splitWork('plain prose about rows').request).toBeUndefined()
  })
  it('hides the table during streaming', () => {
    const guard = new WorkStreamGuard()
    expect([...fence].map(c => guard.push(c)).join('') + guard.end()).toBe('')
  })
  it('offers the behaviour sentences as the options, never the labels, with an ask row as the prompt', () => {
    const text = tableQuestion(rows.slice(0, 2), 'Evidence is insufficient.')
    expect(text).toContain('create topics')
    expect(splitQuestion(text).question?.options).toEqual(['list /notes', 'create topics', 'move notes topics', 'Something else'])
    const asked = tableQuestion(rows.slice(0, 2), 'Jev chose to ask.', 'By city or by role?')
    expect(splitQuestion(asked).question?.prompt).toBe('By city or by role?')
  })
  it('tells the worker what Jev chose, what could not run, and what conflicts', () => {
    const note = tableChoiceNote(
      { plan: { kind: 'read', rows: ['a'] }, rejected: ['b'], reason: '', model: 'm', answers: {} },
      rows, [{ id: 'z', reason: 'unknown verb' }],
    )
    expect(note).toContain('Jev chose to read: See the notes.')
    expect(note).toContain('z (unknown verb)')
    expect(note).toContain('Group by topic')
    expect(note).toContain('grants no permission')
  })
})
