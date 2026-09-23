// line-diff.spec.ts — ONE DIFFERENCE AT A TIME. The rows a reader walks from
// a file before a change to after it: the change, a little context around
// it, and every longer unchanged stretch folded to a count.

import { describe, expect, it } from 'vitest'
import { diffLines, type DiffRow } from './line-diff.js'

const file = (count: number, edit: (lines: string[]) => void = () => {}): string => {
  const lines = Array.from({ length: count }, (_, i) => `line ${i + 1}`)
  edit(lines)
  return lines.join('\n') + '\n'
}
const shape = (rows: readonly DiffRow[]): string[] => rows.map(row => row.kind === 'skip' ? `skip ${row.count}` : `${row.kind} ${row.text}`)

describe('diffLines', () => {
  it('folds a file that did not change into one count', () => {
    expect(diffLines(file(40), file(40))).toEqual({ rows: [{ kind: 'skip', count: 40 }], added: 0, removed: 0 })
  })

  it('shows a changed line with three lines around it, and folds the rest', () => {
    const diff = diffLines(file(40), file(40, lines => { lines[19] = 'line twenty' }))
    expect(shape(diff.rows)).toEqual([
      'skip 16', 'same line 17', 'same line 18', 'same line 19',
      'remove line 20', 'add line twenty',
      'same line 21', 'same line 22', 'same line 23', 'skip 17',
    ])
    expect([diff.added, diff.removed]).toEqual([1, 1])
  })

  it('keeps two changes far apart as two hunks', () => {
    const diff = diffLines(file(100), file(100, lines => { lines.splice(90, 0, 'late'); lines.splice(4, 1) }))
    expect(diff.rows.filter(row => row.kind === 'skip').length).toBe(2)
    // One unchanged line before the first hunk is shown, never folded to "1 line".
    expect(shape(diff.rows)[0]).toBe('same line 1')
    expect(shape(diff.rows).filter(row => !row.startsWith('same') && !row.startsWith('skip'))).toEqual(['remove line 5', 'add late'])
  })

  it('walks back to exactly the file before and the file after', () => {
    // A deterministic scramble: every edit script must replay both sides.
    let seed = 7
    const next = (): number => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648
    for (let round = 0; round < 25; round++) {
      const before = Array.from({ length: 30 + Math.floor(next() * 40) }, () => `v${Math.floor(next() * 6)}`)
      const after = before.filter(() => next() > 0.2).flatMap(line => next() > 0.85 ? [line, `new${Math.floor(next() * 9)}`] : [line])
      const { rows, added, removed } = diffLines(before.join('\n'), after.join('\n'), { context: 1_000_000 })
      const lines = rows.filter((row): row is Exclude<DiffRow, { kind: 'skip' }> => row.kind !== 'skip')
      expect(lines.filter(row => row.kind !== 'add').map(row => row.text)).toEqual(before)
      expect(lines.filter(row => row.kind !== 'remove').map(row => row.text)).toEqual(after)
      expect(added).toBe(lines.filter(row => row.kind === 'add').length)
      expect(removed).toBe(lines.filter(row => row.kind === 'remove').length)
    }
  })

  it('reads a change past its edit budget as a rewrite, every line out and every line in', () => {
    const diff = diffLines('a\nb\nc\n', 'x\ny\n', { maxEdits: 1, context: 0 })
    expect(shape(diff.rows)).toEqual(['remove a', 'remove b', 'remove c', 'add x', 'add y'])
  })
})
