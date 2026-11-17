// execution-change.spec.ts — what Run will change, said beside the button.

import { describe, expect, it } from 'vitest'
import { changeLines, changedSpan } from './execution-change.js'

const file = (...lines: string[]): string => lines.join('\n') + '\n'

describe('where two texts differ', () => {
  it('is nowhere when they are the same', () => {
    expect(changedSpan(file('a', 'b'), file('a', 'b'))).toBeNull()
  })

  it('is the span between the first and the last line that differ', () => {
    expect(changedSpan(file('a', 'b', 'c', 'd'), file('a', 'B', 'C2', 'c', 'd')))
      .toEqual({ from: 2, removed: ['b'], added: ['B', 'C2'] })
    expect(changedSpan(file('a', 'b'), file('a', 'b', 'c'))).toEqual({ from: 3, removed: [], added: ['c'] })
    expect(changedSpan(file('a', 'b', 'c'), file('a', 'c'))).toEqual({ from: 2, removed: ['b'], added: [] })
  })
})

describe('what Run will change', () => {
  it('says a new file and how it starts', () => {
    expect(changeLines(null, file('export const a = 1', 'export const b = 2', 'export const c = 3')))
      .toEqual(['New file: 3 lines.', '+ export const a = 1', '+ export const b = 2'])
    expect(changeLines(null, 'one line')).toEqual(['New file: 1 line.', '+ one line'])
  })

  it('says when the write changes nothing', () => {
    expect(changeLines(file('a'), file('a'))).toEqual(['No change: the file already holds exactly this.'])
  })

  it('says one changed line, what goes and what comes', () => {
    const before = file('const colour = "teal"', 'const size = 4', 'draw(colour, size)')
    const after = file('const colour = "red"', 'const size = 4', 'draw(colour, size)')
    expect(changeLines(before, after)).toEqual([
      'Changes 1 line from line 1 into 1 (3 lines now).',
      '- const colour = "teal"',
      '+ const colour = "red"',
    ])
  })

  it('says lines added, and lines removed', () => {
    expect(changeLines(file('a', 'z'), file('a', 'b', 'c', 'd', 'z'))).toEqual([
      'Adds 3 lines at line 2 (2 lines now).', '+ b', '+ c', '+ … 1 more',
    ])
    expect(changeLines(file('a', 'b', 'c', 'z'), file('a', 'z'))).toEqual([
      'Removes 2 lines from line 2 (4 lines now).', '- b', '- c',
    ])
  })

  it('says when the whole file is replaced', () => {
    expect(changeLines(file('one', 'two'), file('uno', 'dos', 'tres'))[0]).toBe('Replaces the whole file: 2 lines become 3.')
  })

  it('keeps a long line short', () => {
    const shown = changeLines(null, 'x'.repeat(400))[1]!
    expect(shown.length).toBeLessThan(120)
    expect(shown.endsWith('…')).toBe(true)
  })
})
