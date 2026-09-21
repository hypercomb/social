import { describe, expect, it, vi } from 'vitest'
vi.mock('@hypercomb/core', () => ({ EffectBus: { on: () => () => {} } }))
const { missRecord, summarizeMisses, verbOf } = await import('./machine-misses.js')

describe('what the hive could not do', () => {
  it('names the missing word from the sentence, slash or not', () => {
    expect(verbOf('/frobnicate everything')).toBe('frobnicate')
    expect(verbOf('  Publish site ')).toBe('publish')
  })

  it('keeps only real misses, bare of their slash', () => {
    expect(missRecord({ sentence: '/frobnicate x', reason: 'not a behaviour', at: 5, model: 'm' }))
      .toEqual({ kind: 'machine-miss', sentence: 'frobnicate x', verb: 'frobnicate', reason: 'not a behaviour', model: 'm', at: 5 })
    expect(missRecord({ sentence: '', reason: 'r', at: 1 })).toBeNull()
    expect(missRecord({ sentence: 'x', reason: '', at: 1 })).toBeNull()
    expect(missRecord({ sentence: 'x', reason: 'r' })).toBeNull()
    expect(missRecord('nope')).toBeNull()
  })

  it('groups by the missing word, most asked-for first', () => {
    const miss = (sentence: string, at: number, reason = 'not a behaviour') => missRecord({ sentence, reason, at })!
    const summary = summarizeMisses([
      miss('publish site', 1), miss('publish blog', 3), miss('publish site', 2),
      miss('frobnicate x', 9),
    ])
    expect(summary.map(row => [row.verb, row.count])).toEqual([['publish', 3], ['frobnicate', 1]])
    expect(summary[0].examples).toEqual(['publish blog', 'publish site'])
    expect(summary[0].lastAt).toBe(3)
  })
})
