import { describe, expect, it } from 'vitest'
import { promptFromTile, promptFromWords, tilePhrases } from './comfy-roll.js'

const seq = (...values: number[]) => {
  let i = 0
  return () => values[i++] ?? 0
}

describe('prompt rolls', () => {
  it('keeps the tile name and drops picture signatures', () => {
    const sig = 'a'.repeat(64)
    expect(tilePhrases('brass-lantern', {
      material: 'brass',
      imageSig: sig,
      generation: sig,
      note: 'harbor fog',
    })).toEqual(['brass lantern', 'brass', 'harbor fog'])
  })

  it('builds a prompt from the tile and a fresh dressing', () => {
    const made = promptFromTile('brass-lantern', { note: 'harbor fog' }, seq(0, 0, 0, 0, 0))
    expect(made.startsWith('brass lantern, harbor fog, ')).toBe(true)
    expect(made).toContain('soft side light')
    expect(made).toContain('painted illustration')
  })

  it('a second roll of the same tile can read differently', () => {
    const props = { note: 'harbor fog', hour: 'evening' }
    const first = promptFromTile('lantern', props, seq(0, 0, 0, 0, 0))
    const second = promptFromTile('lantern', props, seq(0.9, 0.9, 0.9, 0.9, 0.9))
    expect(first).not.toBe(second)
    expect(second.startsWith('lantern')).toBe(true)
  })

  it('common words do not need a tile', () => {
    const made = promptFromWords(seq(0, 0, 0, 0, 0))
    expect(made.startsWith('a single brass lantern, on a wooden table, ')).toBe(true)
    expect(promptFromWords(seq(0.99, 0.99, 0.99, 0.99, 0.99))).not.toBe(made)
  })

  it('an unnamed tile makes no prompt', () => {
    expect(promptFromTile('  ', {}, seq(0))).toBe('')
  })
})
