import { describe, expect, it } from 'vitest'
import { directArgOf, jevDirectInput, jevDirectQuestions, jevDirectResult, jevDirectState, requestSpans } from './jev-direct.js'

const behaviours = [
  { name: 'create', description: 'Create a tile here', forms: '<name> | <parent>/<child>', reach: 'additive' },
  { name: 'copy', description: 'Copy tiles to the clipboard', forms: '<tile> | [<tile>, <tile>, ...]', reach: 'additive' },
  { name: 'paste', description: 'Paste the clipboard here', forms: '', bare: true, reach: 'additive' },
  { name: 'postit', description: 'Leave a note here', forms: 'here <text>', reach: 'additive' },
]
const request = 'Make a tile called jev-proof here'
const input = jevDirectInput({ request, behaviours, tiles: ['drafts', 'people'] })
const spanId = (span: string): string => `s${input.spans.indexOf(span)}`
const noul = (value: number) => ({ type: 'noul', noul: value })
const choice = (pick: string, confidence = 0.95) => ({ type: 'choice', choice: pick, confidence })
const answer = (over: Record<string, unknown> = {}) => ({ model: 'jev-resolved', answers: {
  single: noul(0.97), behaviour: choice('create'), span: choice(spanId('jev-proof')), target: choice('none'), ...over,
}, usage: { input_tokens: 300, output_tokens: 0, cost: 0.00001 } })

describe('candidates found in code', () => {
  it('reads the argument kind from the census forms', () => {
    expect(directArgOf('<name> | <parent>/<child>')).toBe('name')
    expect(directArgOf('<tile> | [<tile>, ...]')).toBe('tile')
    expect(directArgOf('here <text>')).toBe('text')
    expect(directArgOf('', true)).toBe('none')
    expect(input.behaviours.map(b => b.arg)).toEqual(['name', 'tile', 'none', 'text'])
  })
  it('finds exact spans of the request only, quoted text first', () => {
    expect(requestSpans('Name it "Garden Plan" please')[0]).toBe('Garden Plan')
    const spans = requestSpans(request)
    expect(spans).toContain('jev-proof')
    expect(spans).toContain('called jev-proof')
    expect(spans.every(span => request.includes(span))).toBe(true)
    expect(requestSpans('Tidy up, please!')).toContain('Tidy up')
  })
})

describe('the input never offers what the path must not do', () => {
  it('refuses removals, invented spans and too much', () => {
    expect(() => jevDirectInput({ request, behaviours: [{ ...behaviours[0], reach: 'destructive' }] })).toThrow('never offers a removal')
    expect(() => jevDirectInput({ request, behaviours, spans: ['something else'] })).toThrow('exact part of the request')
    expect(() => jevDirectInput({ request, behaviours: [] })).toThrow()
    expect(() => jevDirectInput({ request, behaviours, tiles: Array.from({ length: 49 }, (_, k) => `t${k}`) })).toThrow()
  })
  it('asks one condition per yes/no and offers none on every choice', () => {
    const questions = jevDirectQuestions(input)
    expect(Object.keys(questions).sort()).toEqual(['behaviour', 'single', 'span', 'target'])
    expect((questions['single'] as { criteria: { true: string } }).criteria.true).toBeTruthy()
    for (const key of ['behaviour', 'span', 'target']) expect((questions[key] as { criteria: Record<string, string> }).criteria).toHaveProperty('none')
    expect(JSON.stringify(jevDirectState(input))).not.toContain('forms')
  })
})

describe('composition', () => {
  it('builds the sentence from the census word and the participant own words', () => {
    const result = jevDirectResult(answer(), input)
    expect(result.sentence).toBe('create jev-proof')
    expect(result.reach).toBe('additive')
    expect(result.usage).toEqual({ inputTokens: 300, outputTokens: 0, cost: 0.00001 })
  })
  it('uses a listed tile for a behaviour that points at one, and nothing for a bare word', () => {
    expect(jevDirectResult(answer({ behaviour: choice('copy'), target: choice('t0') }), input).sentence).toBe('copy drafts')
    expect(jevDirectResult(answer({ behaviour: choice('paste') }), input).sentence).toBe('paste')
  })
  it('hands the turn to the worker whenever any answer is unsure', () => {
    expect(jevDirectResult(answer({ single: noul(0.6) }), input).sentence).toBeUndefined()
    expect(jevDirectResult(answer({ behaviour: choice('create', 0.6) }), input).sentence).toBeUndefined()
    expect(jevDirectResult(answer({ behaviour: choice('none') }), input).reason).toContain('No single behaviour')
    expect(jevDirectResult(answer({ span: choice('none') }), input).reason).toContain('which words')
    expect(jevDirectResult(answer({ behaviour: choice('copy'), target: choice('t1', 0.5) }), input).reason).toContain('which tile')
    expect(jevDirectResult(answer({ single: noul(0.6) }), input).reason).toMatch(/single \.60 · create \.95/)
  })
  it('fails closed on unknown choices and wrong types', () => {
    expect(() => jevDirectResult(answer({ behaviour: choice('remove') }), input)).toThrow()
    expect(() => jevDirectResult(answer({ single: choice('yes') }), input)).toThrow()
    expect(() => jevDirectResult({ answers: { single: noul(1) } }, input)).toThrow()
  })
})
