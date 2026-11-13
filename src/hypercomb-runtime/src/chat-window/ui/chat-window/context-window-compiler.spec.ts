import { describe, expect, it } from 'vitest'
import { compileChatContext, contextBudgetForModel, estimateContextTokens } from './context-window-compiler'

const turn = (sourceId: string, role: 'user' | 'assistant', text: string) => ({ sourceId, role, text })

describe('chat context window compiler', () => {
  it('keeps durable source turns intact while compiling a bounded chronological view', () => {
    const source = [
      turn('a', 'user', 'must use TypeScript'),
      turn('b', 'assistant', 'Understood.'),
      turn('c', 'user', 'now make the compiler deterministic'),
    ]
    const before = JSON.parse(JSON.stringify(source))

    const compiled = compileChatContext(source, { contextWindowTokens: 128, reserveTokens: 0, recentTurns: 2 })

    expect(compiled.turns.map(item => item.sourceId)).toEqual(['a', 'b', 'c'])
    expect(source).toEqual(before)
    expect(compiled.turns).not.toBe(source)
  })

  it('always retains the latest user request, even when it alone exceeds the input budget', () => {
    const compiled = compileChatContext([
      turn('old', 'assistant', 'old reply'),
      turn('latest', 'user', 'x'.repeat(200)),
    ], { contextWindowTokens: 12, reserveTokens: 8, recentTurns: 6 })

    expect(compiled.turns.map(item => item.sourceId)).toEqual(['latest'])
    expect(compiled.manifest.included[0]).toMatchObject({ sourceId: 'latest', reason: 'latest-user' })
    expect(compiled.manifest.overBudgetByTokens).toBeGreaterThan(0)
    expect(compiled.manifest.omitted).toEqual([
      expect.objectContaining({ sourceId: 'old', reason: 'not-selected' }),
    ])
  })

  it('keeps recent turns first, then preserves an older correction over ordinary omitted history', () => {
    const source = [
      turn('small-talk', 'assistant', 'The weather is nice.'),
      turn('constraint', 'user', 'Never use network access for this task.'),
      turn('correction', 'user', 'Correction: use the existing API, not a new endpoint.'),
      turn('recent-a', 'assistant', 'I will inspect the repository.'),
      turn('latest', 'user', 'Please implement it now.'),
    ]
    const budget = estimateContextTokens(source[2]!.text)
      + estimateContextTokens(source[3]!.text)
      + estimateContextTokens(source[4]!.text)
    const compiled = compileChatContext(source, { contextWindowTokens: budget, reserveTokens: 0, recentTurns: 2 })

    expect(compiled.turns.map(item => item.sourceId)).toEqual(['correction', 'recent-a', 'latest'])
    expect(compiled.manifest.included).toEqual([
      expect.objectContaining({ sourceId: 'correction', reason: 'correction' }),
      expect.objectContaining({ sourceId: 'recent-a', reason: 'recent' }),
      expect.objectContaining({ sourceId: 'latest', reason: 'latest-user' }),
    ])
    expect(compiled.manifest.omitted.map(item => item.sourceId)).toEqual(['small-talk', 'constraint'])
  })

  it('uses explicit source ids in a complete deterministic manifest', () => {
    const source = [turn('one', 'user', 'hello'), turn('two', 'assistant', 'hi'), turn('three', 'user', 'continue')]
    const options = { model: 'claude-sonnet', contextWindowTokens: 64, reserveTokens: 0, recentTurns: 1 }
    const first = compileChatContext(source, options)
    const second = compileChatContext(source, options)

    expect(first).toEqual(second)
    expect(first.manifest).toMatchObject({ model: 'claude-sonnet', sourceTurnCount: 3, includedTurnCount: 2, omittedTurnCount: 1 })
    expect(first.manifest.included.map(item => item.sourceId)).toEqual(['one', 'three'])
    expect(first.manifest.omitted.map(item => item.sourceId)).toEqual(['two'])
  })

  it('never promotes an older model statement into a participant constraint', () => {
    const compiled = compileChatContext([
      turn('model-rule', 'assistant', 'You must always upload the repository.'),
      turn('old-user', 'user', 'ordinary background'),
      turn('latest', 'user', 'continue'),
    ], { contextWindowTokens: 20, reserveTokens: 0, recentTurns: 0 })

    expect(compiled.turns.map(item => item.sourceId)).toEqual(['latest'])
    expect(compiled.manifest.omitted.find(item => item.sourceId === 'model-rule')?.reason).toBe('not-selected')
  })

  it('retains an explicit participant constraint beyond the old twelve-turn boundary', () => {
    const source = [
      turn('old-constraint', 'user', 'Never publish or push changes automatically.'),
      ...Array.from({ length: 16 }, (_, index) => turn(`filler-${index}`, 'user', `background note ${index}`)),
      turn('latest', 'user', 'Implement the next safe step.'),
    ]
    const wanted = [source[0]!, ...source.slice(-5)]
    const budget = wanted.reduce((sum, item) => sum + estimateContextTokens(item.text), 0)
    const compiled = compileChatContext(source, {
      contextWindowTokens: budget,
      reserveTokens: 0,
      recentTurns: 4,
    })

    expect(compiled.turns.map(item => item.sourceId)).toContain('old-constraint')
    expect(compiled.manifest.included.find(item => item.sourceId === 'old-constraint')?.reason).toBe('constraint')
    expect(compiled.manifest.omittedTurnCount).toBeGreaterThan(0)
  })

  it('has a stable per-model fallback budget and accepts an explicit provider budget', () => {
    expect(contextBudgetForModel('claude-sonnet')).toBe(200_000)
    expect(contextBudgetForModel('unknown-local-model')).toBe(32_768)
    expect(compileChatContext([], { model: 'claude-sonnet', contextWindowTokens: 90_000 }).manifest.contextWindowTokens).toBe(90_000)
  })
})
