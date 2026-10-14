import { describe, it, expect } from 'vitest'
import { mergeTraits, resolveTrait, sameTraitWord, traitFiller, traitSpecs, traitWords } from './trait.js'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)
const none = { fills: [], children: [], hive: [] }

describe('trait words', () => {
  it('two spellings of one word are one trait; blanks are nothing', () => {
    expect(sameTraitWord('Portrait', 'portrait')).toBe(true)
    expect(sameTraitWord('', '')).toBe(false)
    expect(traitWords(['Portrait', { word: 'portrait' }, '  ', null, 'tagline'])).toEqual(['Portrait', 'tagline'])
  })
})

describe('declarations', () => {
  it('a plain word has its own version; needs is a reminder with none', () => {
    expect(traitSpecs(['portrait', { word: 'contact-script', needs: true }, { word: 'logo' }, 'Portrait'])).toEqual([
      { word: 'portrait', own: true },
      { word: 'contact-script', own: false },
      { word: 'logo', own: true },
    ])
    expect(traitSpecs(undefined)).toEqual([])
  })

  it('a given trait has its own version only when its record says so', () => {
    expect(mergeTraits([], [{ word: 'portrait', own: true }, { word: 'tagline' }, 'logo', { word: 'Portrait' }])).toEqual([
      { word: 'portrait', own: true },
      { word: 'tagline', own: false },
      { word: 'logo', own: false },
    ])
  })

  it('declared traits come first; an opened trait has no own version; a declared word keeps its spec', () => {
    expect(mergeTraits([{ word: 'portrait', own: true }], [{ word: 'Portrait' }, { word: 'tagline' }])).toEqual([
      { word: 'portrait', own: true },
      { word: 'tagline', own: false },
    ])
  })
})

describe('resolveTrait', () => {
  it('a fill wins over a child, a child over the own version', () => {
    const own = { word: 'portrait', own: true }
    expect(resolveTrait(own, { ...none, fills: [{ word: 'portrait', sig: A }], children: [{ name: 'portrait', sig: B, segments: ['x', 'portrait'] }] }))
      .toEqual({ word: 'portrait', rung: 'fill', sig: A })
    expect(resolveTrait(own, { ...none, children: [{ name: 'Portrait', sig: B, segments: ['x', 'Portrait'] }] }))
      .toEqual({ word: 'portrait', rung: 'child', sig: B, route: ['x', 'Portrait'] })
  })

  it('the own version stands; other tiles are offers, never replacements', () => {
    const r = resolveTrait({ word: 'portrait', own: true }, { ...none, hive: [{ sig: C, route: ['y', 'portrait'] }] })
    expect(r).toEqual({ word: 'portrait', rung: 'own', offers: [{ sig: C, route: ['y', 'portrait'] }] })
    expect(traitFiller(r)).toBeNull()
  })

  it('with no own version, one tile fills it, several are offered, nothing is a miss', () => {
    expect(resolveTrait('portrait', { ...none, hive: [{ sig: C, route: ['y', 'portrait'] }] }).rung).toBe('hive')
    const several = resolveTrait({ word: 'portrait', own: false }, { ...none, hive: [{ sig: B, route: [] }, { sig: C, route: [] }, { sig: B, route: [] }] })
    expect(several.rung).toBe('choose')
    if (several.rung === 'choose') expect(several.candidates.map(c => c.sig)).toEqual([B, C])
    expect(resolveTrait('portrait', none)).toEqual({ word: 'portrait', rung: 'miss' })
  })

  it('a malformed fill is ignored, not trusted', () => {
    expect(resolveTrait('portrait', { ...none, fills: [{ word: 'portrait', sig: 'nope' }] }).rung).toBe('miss')
  })
})
