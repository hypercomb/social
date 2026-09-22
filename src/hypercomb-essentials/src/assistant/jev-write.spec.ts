// jev-write.spec.ts — A WRITE ROW SITS AT JEV'S TABLE. Rewriting a running
// module's section is judged like any change: fit, overreach, grounding and
// every doctrine section; it reaches as editing; Jev never sees the code.

import { describe, expect, it } from 'vitest'
import { JEV_CHOICE_GATES, JEV_ROW_QUESTIONS, WRITE_REACH, isChangeRow, jevInput, jevQuestions, jevResult, jevState } from './jev-decision.js'

const SIG = 'a'.repeat(64)
const LINE = `write ${SIG} src/games/solomon/labyrinth.ts`
const doctrine = ['### Nothing is deleted\nHide first; delete second.', '### The core rule\nContent is addressed by signature.']
const rows = [
  { id: 'w', kind: 'write', label: 'Write src/games/solomon/labyrinth.ts', lines: [LINE], why: 'rooms must start fresh' },
  { id: 'a', kind: 'answer', label: 'Answer now' },
]
const input = jevInput({ request: 'Make labyrinth rooms start fresh', doctrine, evidence: [`// src/games/solomon/labyrinth.ts\nvar rooms = "remembered";`], rows })
const noul = (value: number) => ({ type: 'noul', noul: value })
const choice = (pick: string, confidence = 0.96) => ({ type: 'choice', choice: pick, confidence })
const response = (over: Partial<Record<string, unknown>> = {}) => ({ model: 'typesafe/jev-resolved', answers: {
  w_toward: noul(0.97), w_beyond: noul(0.02), w_grounded: noul(0.95), w_rule0: noul(0.01), w_rule1: noul(0.02),
  a_answered: noul(0.1),
  next: choice('w'),
  ...over,
} })

describe('a write row', () => {
  it('is a change row that reaches as editing, with one header line', () => {
    expect(isChangeRow({ kind: 'write' })).toBe(true)
    expect(input.rows[0]!.reach).toBe(WRITE_REACH)
    expect(WRITE_REACH).toBe('editing')
    expect(() => jevInput({ request: 'r', doctrine, evidence: ['e'], rows: [{ id: 'w', kind: 'write', label: 'W', lines: ['write the file'] }] }))
      .toThrow('A write row carries one line: write <module signature> <src/path.ts>')
    expect(() => jevInput({ request: 'r', doctrine, evidence: ['e'], rows: [{ id: 'w', kind: 'write', label: 'W', lines: [LINE], reach: 'additive' }] }))
      .toThrow('Only a do row carries a reach')
  })

  it('is asked fit, overreach and grounding, plus one question per doctrine section; the code never travels', () => {
    const questions = jevQuestions(input)
    expect(Object.keys(questions).sort()).toEqual(['a_answered', 'next', 'w_beyond', 'w_grounded', 'w_rule0', 'w_rule1', 'w_toward'])
    expect(JEV_ROW_QUESTIONS.write.map(q => q.key)).toEqual(['toward', 'beyond', 'grounded'])
    expect(JSON.stringify(jevState(input))).not.toContain('reach')
    expect(jevState(input).rows[0]!.lines).toEqual([LINE])
  })

  it('runs without review when every gate passes and Jev is sure past the editing gate', () => {
    const result = jevResult(response(), input)
    expect(result.plan).toEqual({ kind: 'do', row: 'w', review: false })
    expect(result.reason).toContain('Jev chose Write src/games/solomon/labyrinth.ts')
    expect(JEV_CHOICE_GATES.editing).toBe(0.85)
  })

  it('waits for the participant when the section was not read first (grounded fails)', () => {
    const result = jevResult(response({ w_grounded: noul(0.2) }), input)
    expect(result.plan).toEqual({ kind: 'do', row: 'w', review: true })
    expect(result.reason).toContain('grounded .20')
  })

  it('is rejected outright when a doctrine section is broken', () => {
    const result = jevResult(response({ w_rule0: noul(0.98) }), input)
    expect(result.rejected).toEqual(['w'])
    expect(result.plan.kind).toBe('revise')
  })
})
