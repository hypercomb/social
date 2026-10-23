import { describe, expect, it } from 'vitest'
import { JEV_CORROBORATED_FLOOR, JEV_VERIFY_GATES, corroborate, jevVerifyInput, jevVerifyQuestions, jevVerifyResult, routesCorroborated } from './jev-verify.js'

const noul = (value: number) => ({ type: 'noul', noul: value })

describe('Jev checks the answer', () => {
  it('asks two single-condition questions, each with what yes and no mean', () => {
    const questions = jevVerifyQuestions()
    expect(Object.keys(questions)).toEqual(['supported', 'complete'])
    for (const question of Object.values(questions)) {
      expect(question.type).toBe('noul')
      expect(question.criteria.true).toBeTruthy()
      expect(question.criteria.false).toBeTruthy()
    }
  })
  it('needs something read to check against, within its budget', () => {
    expect(() => jevVerifyInput({ request: 'r', evidence: [], answer: 'a' })).toThrow('needs what was read')
    expect(() => jevVerifyInput({ request: 'r', evidence: ['x'.repeat(16_001)], answer: 'a' })).toThrow()
    expect(jevVerifyInput({ request: ' r ', evidence: ['read'], answer: ' a ' })).toEqual({ request: 'r', evidence: ['read'], answer: 'a' })
  })
  it('verifies only when the answer is both supported and complete', () => {
    const at = (supported: number, complete: number) => jevVerifyResult({ model: 'm', answers: { supported: noul(supported), complete: noul(complete) } })
    expect(at(0.95, 0.9).verified).toBe(true)
    expect(at(JEV_VERIFY_GATES.supported - 0.01, 0.95).verified).toBe(false)
    expect(at(0.95, 0.3).verified).toBe(false)
    expect(at(0.2, 0.9).reason).toBe('supported .20 · complete .90')
  })
  // 2026-10-22: the same two routes, read whole, scored .57 to 1.0 across a
  // morning, and four in five correct finds ended "Jev could not confirm".
  // Where code can check the claims itself, it does.
  describe('code corroborates the routes it can check', () => {
    const evidence = [[
      'hive read results, 1 read:',
      'read 1 of 1: /find betz /',
      '  matches (2):',
      '  - /people/betz',
      '  - /dolphin/associates/betz',
      '  truncated: no',
    ].join('\n')]
    const answer = 'Found two tiles named **betz**:\n\n- `/people/betz`\n- `/dolphin/associates/betz`'
    const input = { request: 'find betz /', evidence, answer }
    const judged = (supported: number, complete = 0.9) =>
      jevVerifyResult({ model: 'm', answers: { supported: noul(supported), complete: noul(complete) } })

    it('lets a bare list of returned routes clear the floor instead of the gate, and says why', () => {
      const verdict = corroborate(judged(0.59), input)
      expect(verdict.verified).toBe(true)
      expect(verdict.reason).toBe('supported .59 · complete .90 · every route is one the reads returned')
      expect(corroborate(judged(JEV_CORROBORATED_FLOOR), input).verified).toBe(true)
    })

    it('leaves the judge its veto below the floor, and `complete` its gate', () => {
      expect(corroborate(judged(JEV_CORROBORATED_FLOOR - 0.01), input).verified).toBe(false)
      expect(corroborate(judged(0.9, JEV_VERIFY_GATES.complete - 0.01), input).verified).toBe(false)
    })

    it('does not touch a verdict that already stands', () => {
      const clean = judged(0.95)
      expect(corroborate(clean, input)).toBe(clean)
    })

    it('says nothing for a route no read returned, or one that only starts like it', () => {
      expect(corroborate(judged(0.6), { ...input, answer: `${answer}\n- \`/dolphin/betz\`` }).verified).toBe(false)
      expect(corroborate(judged(0.6), { ...input, evidence: [evidence[0].replace('/people/betz', '/people/betzy')] }).verified).toBe(false)
      expect(corroborate(judged(0.6), { ...input, evidence: [evidence[0].replace('/dolphin/associates/betz', '/x/dolphin/associates/betz')] }).verified).toBe(false)
    })

    it('says nothing when a read was cut', () => {
      for (const cut of ['  truncated: yes', '  not in this piece (cut to fit): read 2', 'the walk did not finish these branches']) {
        expect(corroborate(judged(0.6), { ...input, evidence: [evidence[0].replace('  truncated: no', cut)] }).verified).toBe(false)
      }
    })

    it('says nothing for more than a list: prose, or a count the list does not bear out', () => {
      const prose = `${answer}\n\nBoth of them are the oldest pages in the hive and were written by the same person in the same week.`
      expect(corroborate(judged(0.6), { ...input, answer: prose }).verified).toBe(false)
      expect(corroborate(judged(0.6), { ...input, answer: answer.replace('two', '3') }).verified).toBe(false)
      expect(corroborate(judged(0.6), { ...input, answer: answer.replace('two', '2') }).verified).toBe(true)
      expect(corroborate(judged(0.6), { ...input, answer: 'Nothing matched.' }).verified).toBe(false)
    })

    it('reads a route the way a person writes it: after a bullet or a backtick, before a full stop', () => {
      expect(routesCorroborated('Found `/people/betz`.', evidence)).toBe(true)
      expect(routesCorroborated('/people/betz and /dolphin/associates/betz', evidence)).toBe(true)
      expect(routesCorroborated('see /PEOPLE/BETZ', evidence)).toBe(true)
    })
  })

  it('fails closed on a missing or malformed answer', () => {
    expect(() => jevVerifyResult({ answers: { supported: noul(1) } })).toThrow()
    expect(() => jevVerifyResult({ answers: { supported: noul(1.5), complete: noul(1) } })).toThrow()
  })
})
