import { describe, expect, it, vi } from 'vitest'
vi.mock('@hypercomb/core', () => ({ EffectBus: { on: () => () => {} } }))
const { outcomeRecord, tallyOutcomes, turnRecord, turnSpeeds } = await import('./jev-outcomes.js')

const sig = 'a'.repeat(64)

describe('what happened after Jev decided', () => {
  it('keeps only real outcomes, with the decision they answer', () => {
    expect(outcomeRecord({ decision: sig, plan: 'do', outcome: 'skipped', review: true, reach: 'additive', at: 5 }))
      .toEqual({ kind: 'jev-outcome', decision: sig, plan: 'do', outcome: 'skipped', review: true, reach: 'additive', at: 5 })
    expect(outcomeRecord({ plan: 'participant', outcome: 'deferred', at: 1 })).toEqual({ kind: 'jev-outcome', plan: 'participant', outcome: 'deferred', at: 1 })
    expect(outcomeRecord({ plan: 'front', outcome: 'aside', weight: 'deep', at: 2 })).toEqual({ kind: 'jev-outcome', plan: 'front', outcome: 'aside', weight: 'deep', at: 2 })
    expect(outcomeRecord({ plan: 'front', outcome: 'passed', weight: 'heavy', at: 3 })).toEqual({ kind: 'jev-outcome', plan: 'front', outcome: 'passed', at: 3 })
  })
  it('refuses anything that is not an outcome', () => {
    expect(outcomeRecord({ plan: 'launch', outcome: 'ran', at: 1 })).toBeNull()
    expect(outcomeRecord({ plan: 'do', outcome: 'maybe', at: 1 })).toBeNull()
    expect(outcomeRecord({ plan: 'do', outcome: 'ran' })).toBeNull()
    expect(outcomeRecord('ran')).toBeNull()
    expect(outcomeRecord({ plan: 'do', outcome: 'ran', at: 1, decision: 'not-a-sig', reach: 'sideways' }))
      .toEqual({ kind: 'jev-outcome', plan: 'do', outcome: 'ran', at: 1 })
  })
  it('tallies outcomes for the providers window', () => {
    const records = [
      outcomeRecord({ plan: 'do', outcome: 'ran', at: 1 })!,
      outcomeRecord({ plan: 'do', outcome: 'skipped', at: 2 })!,
      outcomeRecord({ plan: 'read', outcome: 'ran', at: 3 })!,
      outcomeRecord({ plan: 'participant', outcome: 'deferred', at: 4 })!,
    ]
    expect(tallyOutcomes(records)).toEqual({ decisions: 4, ran: 2, skipped: 1, failed: 0, answered: 0, deferred: 1, refused: 0, passed: 0, verified: 0, unverified: 0, aside: 0 })
  })
  it('keeps the timing of a turn only when it is whole', () => {
    expect(turnRecord({ path: 'aside', ms: 1800.4, firstMs: 420, rounds: 1, weight: 'fast', at: 9 }))
      .toEqual({ kind: 'jev-turn', path: 'aside', ms: 1800, firstMs: 420, rounds: 1, weight: 'fast', at: 9 })
    expect(turnRecord({ path: 'direct', ms: 900, rounds: 0, at: 9 })).toEqual({ kind: 'jev-turn', path: 'direct', ms: 900, rounds: 0, at: 9 })
    expect(turnRecord({ path: 'sideways', ms: 1, rounds: 0, at: 1 })).toBeNull()
    expect(turnRecord({ path: 'judged', ms: -1, rounds: 0, at: 1 })).toBeNull()
    expect(turnRecord({ path: 'judged', ms: 100, firstMs: 500, rounds: 2, at: 1 })).toEqual({ kind: 'jev-turn', path: 'judged', ms: 100, rounds: 2, at: 1 })
  })
  it('compares the ways a turn went by their median', () => {
    const turns = [
      turnRecord({ path: 'direct', ms: 800, rounds: 0, at: 1 })!,
      turnRecord({ path: 'direct', ms: 1200, rounds: 0, at: 2 })!,
      turnRecord({ path: 'judged', ms: 9000, firstMs: 9000, rounds: 3, at: 3 })!,
      turnRecord({ path: 'off', ms: 4000, firstMs: 600, rounds: 1, at: 4 })!,
      turnRecord({ path: 'down', ms: 6000, firstMs: 900, rounds: 1, at: 5 })!,
      turnRecord({ path: 'gone', ms: 60000, rounds: 2, at: 6 })!,
    ]
    expect(turnSpeeds(turns)).toEqual({
      direct: { turns: 2, ms: 1000 },
      judged: { turns: 1, ms: 9000, firstMs: 9000 },
      without: { turns: 3, ms: 6000, firstMs: 750 },
    })
  })
})
