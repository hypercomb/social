import { describe, expect, it, vi } from 'vitest'
vi.mock('@hypercomb/core', () => ({ EffectBus: { on: () => () => {}, emit: () => {} } }))
const { jevInput } = await import('./jev-decision.js')
const { outcomeRecord } = await import('./jev-outcomes.js')
const { replayCases, runsOnItsOwn } = await import('./jev-replay.js')

const doctrine = ['### Nothing is deleted\nHide first; delete second.']
const input = jevInput({ request: 'Make people', doctrine, evidence: ['Nothing read.'], rows: [
  { id: 'a', kind: 'read', label: 'See', lines: ['/list here'] },
  { id: 'c', kind: 'do', label: 'Create people', lines: ['/create people'], reach: 'additive' },
] })
const noul = (value: number) => ({ type: 'noul', noul: value })
const answers = (toward: number, pick = 'c', confidence = 0.95) => ({
  a_needed: noul(0.2), a_known: noul(0.1),
  c_toward: noul(toward), c_beyond: noul(0.02), c_grounded: noul(0.3), c_rule0: noul(0.01),
  next: { type: 'choice', choice: pick, confidence },
})
const at = (plan: string, outcome: string, review?: boolean) => outcomeRecord({ plan, outcome, at: 1, ...(review ? { review: true } : {}) })!

describe('the golden set', () => {
  it('knows which plans act without the participant', () => {
    expect(runsOnItsOwn({ kind: 'read' })).toBe(true)
    expect(runsOnItsOwn({ kind: 'do', review: false })).toBe(true)
    expect(runsOnItsOwn({ kind: 'do', review: true })).toBe(false)
    expect(runsOnItsOwn({ kind: 'participant' })).toBe(false)
  })
  it('reproduces every decision under the thresholds that made it', () => {
    const cases = [
      { outcome: at('do', 'ran'), answers: answers(0.95), input },
      { outcome: at('do', 'skipped', true), answers: answers(0.8), input },
    ]
    const [current] = replayCases(cases, [{ name: 'current' }])
    expect(current).toMatchObject({ decisions: 2, same: 2 })
  })
  it('counts what a candidate would newly run, and what the participant did with it', () => {
    const cases = [
      { outcome: at('do', 'skipped', true), answers: answers(0.8), input },
      { outcome: at('do', 'ran', true), answers: answers(0.85), input },
    ]
    const [, loose] = replayCases(cases, [{ name: 'current' }, { name: 'loose', gates: { toward: 0.75 } }])
    expect(loose.newlyAutomatic).toEqual({ ran: 1, skipped: 1, other: 0 })
    expect(loose.same).toBe(0)
  })
  it('counts what a stricter candidate would newly hold', () => {
    const cases = [{ outcome: at('do', 'ran'), answers: answers(0.95, 'c', 0.8), input }]
    const [, strict] = replayCases(cases, [{ name: 'current' }, { name: 'strict', choice: { additive: 0.9 } }])
    expect(strict.newlyHeld).toEqual({ ran: 1, skipped: 0, other: 0 })
  })
})
