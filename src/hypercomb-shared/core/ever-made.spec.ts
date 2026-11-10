// core/ever-made.spec.ts — the names the line completes from beyond the level:
// one row per name, newest first, prefix only, never a blank line's whole
// history, and never a name the level already shows.

import { describe, expect, it } from 'vitest'
import { EVER_MADE_CAP, everMadeNames, namesBeyond } from './ever-made'

describe('everMadeNames', () => {
  it('lists each name once, in the order given, in the spelling first seen', () => {
    const atoms = [{ label: 'Music' }, { label: 'jazz' }, { label: 'music' }, { label: 'JAZZ' }]
    expect(everMadeNames(atoms)).toEqual(['Music', 'jazz'])
  })

  it('skips blank and malformed labels rather than offering an empty row', () => {
    const atoms = [{ label: '' }, { label: '   ' }, { label: 7 }, {}, { label: 'cigars' }]
    expect(everMadeNames(atoms as never)).toEqual(['cigars'])
  })
})

describe('namesBeyond', () => {
  const ever = ['music-archive', 'music', 'jazz', 'musette', 'Muse']

  it('offers the names that begin with what was typed, in the order they were made', () => {
    expect(namesBeyond('mus', [], ever)).toEqual(['music-archive', 'music', 'musette', 'Muse'])
  })

  it('does not repeat a name the level already shows, in any case', () => {
    expect(namesBeyond('mus', ['Music', 'muse'], ever)).toEqual(['music-archive', 'musette'])
  })

  it('offers nothing for a blank line — history is never thrown at a blank bar', () => {
    expect(namesBeyond('', [], ever)).toEqual([])
    expect(namesBeyond('   ', [], ever)).toEqual([])
  })

  it('matches by prefix only — a name that merely contains the letters is not offered', () => {
    expect(namesBeyond('usic', [], ever)).toEqual([])
  })

  it('caps the rows so a short prefix over a large hive stays a usable list', () => {
    const many = Array.from({ length: EVER_MADE_CAP + 25 }, (_, i) => `tile-${i}`)
    expect(namesBeyond('tile', [], many)).toHaveLength(EVER_MADE_CAP)
    expect(namesBeyond('tile', [], many, 5)).toHaveLength(5)
  })
})
