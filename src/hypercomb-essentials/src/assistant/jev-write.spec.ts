// jev-write.spec.ts — A WRITE ROW SITS AT JEV'S TABLE. Rewriting a running
// module's section is judged like any change: fit, overreach, grounding and
// every doctrine section; it reaches as editing; Jev never sees the code.

import { describe, expect, it } from 'vitest'
import { JEV_CHOICE_GATES, JEV_ROW_QUESTIONS, WRITE_REACH, isChangeRow, isDoctrineWrite, jevInput, jevQuestions, jevResult, jevState } from './jev-decision.js'
import { jevUnseen } from './jev-decision.service.js'

const SIG = 'a'.repeat(64)
/** The block's header exactly as the worker wrote it. */
const LINE = `${SIG} src/games/solomon/labyrinth.ts`
const doctrine = ['### Nothing is deleted\nHide first; delete second.', '### The core rule\nContent is addressed by signature.']
const rows = [
  { id: 'w', kind: 'write', label: 'src/games/solomon/labyrinth.ts', lines: [LINE], why: 'rooms must start fresh' },
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
      .toThrow('A write row carries one line: the write block header')
    expect(() => jevInput({ request: 'r', doctrine, evidence: ['e'], rows: [{ id: 'w', kind: 'write', label: 'W', lines: [LINE], reach: 'additive' }] }))
      .toThrow('A write row reaches as editing')
    // The row exactly as the chat hands it over: the hive's own reach on it (2026-09-22,
    // the live run: the chat marked the write editing and the service refused the row).
    expect(jevInput({ request: 'r', doctrine, evidence: ['e'], rows: [{ id: 'w', kind: 'write', label: 'W', lines: [LINE], reach: 'editing' }] }).rows[0]!.reach).toBe('editing')
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
    expect(result.reason).toContain('Jev chose src/games/solomon/labyrinth.ts')
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

  it('passes the source boundary: its line and label are the worker\'s own words', () => {
    const block = ['```hypercomb-write', LINE, 'var rooms = "fresh";', '```'].join('\n')
    const messages = [
      { content: 'Make labyrinth rooms start fresh' },
      { content: '// src/games/solomon/labyrinth.ts\nvar rooms = "remembered";' },
      { content: `rooms must start fresh\n${block}` },
    ]
    // The table the hive builds from a write block holds the write row alone.
    const written = jevInput({ request: 'Make labyrinth rooms start fresh', doctrine, evidence: ['// src/games/solomon/labyrinth.ts\nvar rooms = "remembered";'], rows: [rows[0]] })
    expect(jevUnseen(written, { providerId: 'p', system: doctrine.join('\n\n'), messages })).toBeNull()
  })
})

describe('a doctrine write', () => {
  const doctrineInput = jevInput({
    request: 'Loosen the nesting rule', doctrine, evidence: ['Nothing read yet.'],
    rows: [{ id: 'w', kind: 'write', label: 'The rule', lines: ['doctrine The rule'] }, { id: 'a', kind: 'answer', label: 'Answer now' }],
  })

  it('is a write row whose header names the doctrine', () => {
    expect(isDoctrineWrite(doctrineInput.rows[0]!)).toBe(true)
    expect(isDoctrineWrite(input.rows[0]!)).toBe(false)
  })

  it('never runs on its own: every gate passing and Jev sure, the participant still reviews it', () => {
    const result = jevResult(response({ w_grounded: noul(0.1) }), doctrineInput)
    expect(result.plan).toEqual({ kind: 'do', row: 'w', review: true })
    expect(result.reason).toContain('it changes the doctrine, so the participant always reviews it')
  })
})
