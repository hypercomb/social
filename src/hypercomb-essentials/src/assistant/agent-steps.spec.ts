import { describe, expect, it } from 'vitest'
import {
  EffectBus, shippedFoldStep, shippedHandoverStep, shippedReceiptStep, type FoldStep,
} from '@hypercomb/core'
import { AgentStepRegistryStore } from './agent-steps.js'

describe('the step registry', () => {
  it('answers the shipped step for a word, and a harness-named bee before it', () => {
    const registry = new AgentStepRegistryStore()
    registry.register(shippedFoldStep)
    const quiet: FoldStep = { word: 'fold', name: 'quiet', run: input => ({ messages: [...input.messages], folded: 0, fits: true }) }
    const sig = 'b'.repeat(64)
    registry.register(quiet, sig)
    expect(registry.resolve('fold')?.name).toBe('shipped')
    expect(registry.resolve('fold', ['a'.repeat(64), sig])?.name).toBe('quiet')
    expect(registry.resolve('fold', ['a'.repeat(64)])?.name).toBe('shipped')
    expect(registry.resolve('handover')).toBeUndefined()
    expect(registry.list()).toEqual([{ word: 'fold', name: 'shipped' }, { word: 'fold', name: 'quiet', sig }])
  })
})

describe('the shipped steps', () => {
  const message = (role: 'user' | 'assistant', content: string) => ({ role, content })

  it('fold leaves a stretch that fits alone, and folds one that does not', () => {
    const messages = [message('user', 'the request'), message('assistant', 'r1'), message('user', 'x'.repeat(4_000)), message('assistant', 'r2'), message('user', 'y'), message('assistant', 'r3'), message('user', 'z')]
    expect(shippedFoldStep.run({ messages, workStart: 1, keep: 2, systemTokens: 10, window: 100_000, reserve: 8_000 }))
      .toMatchObject({ folded: 0, fits: true })
    const out = shippedFoldStep.run({ messages, workStart: 1, keep: 2, systemTokens: 10, window: 900, reserve: 100 })
    expect(out.folded).toBe(4)
    expect(out.messages[1].content).toContain('PROGRESS LEDGER')
    expect(out.messages.slice(2)).toEqual(messages.slice(5))
    expect(out.fits).toBe(true)
  })

  it('handover ends a leg on the budget, the round count, or a stretch that will not fit', () => {
    const base = { request: 'q', reply: 'the hive said', rounds: 3, legRounds: 12, spent: false, lastRound: false, fits: true }
    expect(shippedHandoverStep.decide(base)).toEqual({ end: false, reply: 'the hive said' })
    for (const over of [{ spent: true }, { rounds: 12 }, { fits: false }, { lastRound: true }]) {
      const decided = shippedHandoverStep.decide({ ...base, ...over })
      expect(decided.end).toBe(true)
      expect(decided.reply).toContain('This stretch of context is full')
    }
  })

  it('handover reads what is left: the fence first, an open request next, prose last and only at the end', () => {
    expect(shippedHandoverStep.left({ left: 'read /b', prose: 'Next step: other', lastRound: true, proseFallback: true })).toBe('read /b')
    expect(shippedHandoverStep.left({ requestLines: ['/read /a'], prose: '', lastRound: true, proseFallback: true })).toBe('carry on from: /read /a')
    expect(shippedHandoverStep.left({ prose: 'Done.\n\nNext step: read the rest of it.', lastRound: true, proseFallback: true })).toBe('read the rest of it.')
    expect(shippedHandoverStep.left({ prose: 'Done.\n\nNext step: read the rest of it.', lastRound: false, proseFallback: true })).toBeUndefined()
    expect(shippedHandoverStep.left({ prose: 'Done.\n\nNext step: read the rest of it.', lastRound: true, proseFallback: false })).toBeUndefined()
    expect(shippedHandoverStep.continueWord('the rest')).toBe('Continue. Left: the rest')
    expect(shippedHandoverStep.pausedNote({ rounds: 400, tokens: 6_000_000 })).toContain('400 rounds')
  })

  it('receipt puts the turn on the bus, and jev:turn only for an answered one', () => {
    const emitted: [string, Record<string, unknown>][] = []
    const step = shippedReceiptStep((name, payload) => { emitted.push([name, payload]) })
    const facts = { id: 'chat:a', convoId: 'chat:a', leg: 1, at: 5, path: 'judged', rounds: 2, weight: 'deep', ms: 900, spent: { rounds: 2, tokens: 100 } }
    step.run({ ...facts, outcome: 'answered', answered: true })
    step.run({ ...facts, outcome: 'stopped', answered: false })
    expect(emitted.map(([name]) => name)).toEqual(['jev:turn', 'agent:receipt', 'agent:receipt'])
    expect(emitted[1][1]).not.toHaveProperty('answered')
    expect(emitted[2][1]).toMatchObject({ outcome: 'stopped' })
  })

  it('a receipt step built on the real bus is heard there', () => {
    const seen: unknown[] = []
    const off = EffectBus.on('agent:receipt', p => { seen.push(p) })
    const step = shippedReceiptStep((name, payload) => { EffectBus.emit(name, payload) })
    step.run({ id: 'chat:b', convoId: 'chat:b', leg: 1, at: 1, path: 'off', rounds: 1, weight: 'fast', ms: 10, outcome: 'failed', spent: { rounds: 1, tokens: 1 }, answered: false })
    off()
    expect(seen.at(-1)).toMatchObject({ convoId: 'chat:b', outcome: 'failed' })
  })
})
