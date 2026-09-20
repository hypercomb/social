import { describe, expect, it } from 'vitest'
import { splitQuestion } from '@hypercomb/core'
import { parseProposals, proposalQuestion, persistJevInput, persistJevReceipt, formatJevUsage } from './hypercomb-jev'
import { Blob as NodeBlob } from 'node:buffer'
import { createHash } from 'node:crypto'
import { splitWork, WorkStreamGuard } from './hypercomb-work-fence'

const proposals = [{ id: 'a', label: 'Reuse', plan: 'Reuse existing notes.' }, { id: 'b', label: 'Organize', plan: 'Organize by topic.' }]
const fence = '```hypercomb-propose\n' + JSON.stringify({ proposals }) + '\n```'
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
describe('Jev work protocol', () => {
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
      const input = { request: 'Organize', doctrine: 'Append history.', evidence: ['Before'], proposals }
      const first = await persistJevInput(store, input)
      expect(await persistJevInput(store, input)).toBe(first)
      const second = await persistJevInput(store, { ...input, evidence: ['After'] })
      expect(second).not.toBe(first)
      const a = records.get(first!) as Record<string, unknown>
      const b = records.get(second!) as Record<string, unknown>
      expect(a['doctrine']).toBe(b['doctrine'])
      expect(records.get(a['doctrine'] as string)).toBe(input.doctrine)
      expect(a).not.toHaveProperty('state')
      const receipt = await persistJevReceipt(store, second!, { outcome: 'revise', rejected: ['a'], model: 'resolved', reason: 'Conflict', answers: { rules: 0.01 } })
      const decision = records.get(receipt!) as Record<string, unknown>
      expect(decision['source']).toBe(second)
      expect(records.get(decision['reason'] as string)).toBe('Conflict')
      expect(records.get(decision['answers'] as string)).toEqual({ rules: 0.01 })
    } finally { globalThis.Blob = original }
  })
  it('preserves proposal JSON and never executes a co-emitted action', () => {
    const work = splitWork(fence + '\n```hypercomb-do\nhide notes\n```')
    expect(work.request?.kind).toBe('propose')
    expect(parseProposals(work.request!.lines)).toEqual(proposals)
    expect(work.heldDo).toBe(true)
  })
  it('reads first and refuses partial or duplicate decision blocks', () => {
    expect(splitWork('```hypercomb-read\nread here\n```\n' + fence).request?.kind).toBe('read')
    expect(() => parseProposals(splitWork(fence.slice(0, -3)).request!.lines)).toThrow()
    expect(() => parseProposals(splitWork(fence + '\n' + fence).request!.lines)).toThrow()
  })
  it('hides the decision payload during streaming', () => {
    const guard = new WorkStreamGuard()
    expect([...fence].map(c => guard.push(c)).join('') + guard.end()).toBe('')
  })
  it('persists real alternatives as an answerable participant question', () => {
    const text = proposalQuestion(proposals, 'Evidence is insufficient.')
    expect(text).toContain('Reuse existing notes.')
    expect(splitQuestion(text).question?.options).toEqual(['Reuse', 'Organize', 'Choose a different direction'])
  })
})
