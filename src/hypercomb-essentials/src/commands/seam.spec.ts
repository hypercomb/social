import { describe, it, expect } from 'vitest'
import {
  describeResolution, parseFillArgs, parseSeamArgs, resolveSeam, sameWord, seamWords,
} from './seam.js'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)

describe('seam words', () => {
  it('two spellings of one word are one seam', () => {
    expect(sameWord('Portrait', 'portrait')).toBe(true)
    expect(seamWords([{ word: 'Portrait' }, { word: 'portrait' }, { word: 'tagline' }])).toEqual(['Portrait', 'tagline'])
  })

  it('an empty word is never the same as anything', () => {
    expect(sameWord('', '')).toBe(false)
    expect(seamWords([{ word: '  ' }, null])).toEqual([])
  })
})

describe('resolveSeam — the rungs, in order', () => {
  const none = { fills: [], children: [], hive: [] }

  it('a fill mark wins over a child and the hive', () => {
    const r = resolveSeam('portrait', {
      fills: [{ word: 'Portrait', sig: A }],
      children: [{ name: 'portrait', sig: B, segments: ['card', 'portrait'] }],
      hive: [{ sig: C, route: ['elsewhere', 'portrait'] }],
    })
    expect(r).toEqual({ word: 'portrait', rung: 'fill', sig: A })
  })

  it('a malformed fill mark is ignored, not trusted', () => {
    const r = resolveSeam('portrait', { ...none, fills: [{ word: 'portrait', sig: 'not-a-sig' }] })
    expect(r.rung).toBe('miss')
  })

  it('a child named the word fills it before the hive is asked', () => {
    const r = resolveSeam('portrait', {
      ...none,
      children: [{ name: 'Portrait', sig: B, segments: ['card', 'Portrait'] }],
      hive: [{ sig: C, route: ['x', 'portrait'] }],
    })
    expect(r).toEqual({ word: 'portrait', rung: 'child', sig: B, route: ['card', 'Portrait'] })
  })

  it('one tile in the hive fills it', () => {
    const r = resolveSeam('portrait', { ...none, hive: [{ sig: C, route: ['x', 'portrait'] }] })
    expect(r).toEqual({ word: 'portrait', rung: 'hive', sig: C, route: ['x', 'portrait'] })
  })

  it('several tiles are offered, never first-wins; the same sig twice is one offer', () => {
    const r = resolveSeam('portrait', {
      ...none,
      hive: [{ sig: B, route: ['a', 'portrait'] }, { sig: C, route: ['b', 'portrait'] }, { sig: B, route: ['c', 'portrait'] }],
    })
    expect(r.rung).toBe('choose')
    if (r.rung === 'choose') expect(r.candidates.map(c => c.sig)).toEqual([B, C])
  })

  it('nothing anywhere is a miss', () => {
    expect(resolveSeam('portrait', none)).toEqual({ word: 'portrait', rung: 'miss' })
  })
})

describe('parsing the words', () => {
  it('seam', () => {
    expect(parseSeamArgs('')).toEqual({ verb: 'list' })
    expect(parseSeamArgs('portrait tagline')).toEqual({ verb: 'open', words: ['portrait', 'tagline'] })
    expect(parseSeamArgs('~ portrait')).toEqual({ verb: 'close', words: ['portrait'] })
    expect(parseSeamArgs('~')).toEqual({ error: 'unknown' })
    expect(parseSeamArgs('portrait ~ tagline')).toEqual({ error: 'unknown' })
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
    expect(describeResolution({ word: 'portrait', rung: 'miss' })).toContain('open')
    expect(describeResolution({ word: 'portrait', rung: 'hive', sig: A, route: ['x', 'portrait'] })).toBe('portrait: filled by /x/portrait')
    expect(describeResolution({ word: 'portrait', rung: 'choose', candidates: [{ sig: A, route: [] }, { sig: B, route: [] }] }))
      .toContain('2 tiles')
  })
})
