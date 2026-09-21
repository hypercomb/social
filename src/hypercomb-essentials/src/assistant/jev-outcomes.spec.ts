import { describe, expect, it, vi } from 'vitest'
vi.mock('@hypercomb/core', () => ({ EffectBus: { on: () => () => {} } }))
const { outcomeRecord, tallyOutcomes } = await import('./jev-outcomes.js')

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
})
