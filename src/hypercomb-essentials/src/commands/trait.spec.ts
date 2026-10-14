import { describe, it, expect } from 'vitest'
import { describeResolution, parseFillArgs, parseTraitArgs } from './trait.js'

// The rungs, the fold and the declarations are core's and tested there (hypercomb-core/src/core/trait.spec.ts).

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)

describe('parsing the words', () => {
  it('trait', () => {
    expect(parseTraitArgs('')).toEqual({ verb: 'list' })
    expect(parseTraitArgs('portrait tagline')).toEqual({ verb: 'open', words: ['portrait', 'tagline'] })
    expect(parseTraitArgs('~ portrait')).toEqual({ verb: 'close', words: ['portrait'] })
    expect(parseTraitArgs('~')).toEqual({ error: 'unknown' })
    expect(parseTraitArgs('own name portrait')).toEqual({ verb: 'own', words: ['name', 'portrait'] })
    expect(parseTraitArgs('own')).toEqual({ error: 'unknown' })
    expect(parseTraitArgs('portrait ~ tagline')).toEqual({ error: 'unknown' })
  })

  it('fill', () => {
    expect(parseFillArgs('portrait')).toEqual({ verb: 'pin', word: 'portrait' })
    expect(parseFillArgs('portrait /people/jwize/portrait')).toEqual({ verb: 'with', word: 'portrait', source: '/people/jwize/portrait' })
    expect(parseFillArgs('~ portrait')).toEqual({ verb: 'clear', word: 'portrait' })
    expect(parseFillArgs('')).toEqual({ error: 'unknown' })
    expect(parseFillArgs('a b c')).toEqual({ error: 'unknown' })
  })
})

describe('describeResolution', () => {
  it('says each rung in a line', () => {
    expect(describeResolution({ word: 'portrait', rung: 'miss' })).toContain('needs a filler')
    expect(describeResolution({ word: 'portrait', rung: 'own', offers: [] })).toBe('portrait: its own version')
    expect(describeResolution({ word: 'portrait', rung: 'own', offers: [{ sig: A, route: [] }] })).toContain('1 other in this hive')
    expect(describeResolution({ word: 'portrait', rung: 'hive', sig: A, route: ['x', 'portrait'] })).toBe('portrait: filled by /x/portrait')
    expect(describeResolution({ word: 'portrait', rung: 'choose', candidates: [{ sig: A, route: [] }, { sig: B, route: [] }] }))
      .toContain('2 tiles')
  })
})
