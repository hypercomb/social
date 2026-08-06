import { describe, expect, it } from 'vitest'
import { flattenHierarchy, stepIndex, type Nested } from './note-cycle'

type N = { text: string }
const n = (text: string, ...children: Nested<N>[]): Nested<N> => ({ text, children })

describe('flattenHierarchy', () => {
  it('is depth-first: a node, then its children, recursively', () => {
    const tree = n('root', n('a', n('a1'), n('a2')), n('b'))
    expect(flattenHierarchy(tree).map(r => r.note.text))
      .toEqual(['root', 'a', 'a1', 'a2', 'b'])
  })

  it('reports the depth each row sits at', () => {
    const tree = n('root', n('a', n('a1')))
    expect(flattenHierarchy(tree).map(r => r.depth)).toEqual([0, 1, 2])
  })

  it('a childless root is a hierarchy of one', () => {
    expect(flattenHierarchy(n('only'))).toHaveLength(1)
  })

  it('no root is no rows', () => {
    expect(flattenHierarchy<N>(null)).toEqual([])
  })
})

describe('stepIndex', () => {
  it('walks forward', () => {
    expect(stepIndex(0, 1, 3)).toBe(1)
    expect(stepIndex(1, 1, 3)).toBe(2)
  })

  it('WRAPS off the end back to the front', () => {
    expect(stepIndex(2, 1, 3)).toBe(0)
  })

  it('WRAPS off the front back to the end — the case a bare % gets wrong', () => {
    expect(stepIndex(0, -1, 3)).toBe(2)
  })

  it('has no bound in either direction, so a full lap returns to the start', () => {
    let at = 0
    for (let i = 0; i < 4; i++) at = stepIndex(at, 1, 4)
    expect(at).toBe(0)
    for (let i = 0; i < 4; i++) at = stepIndex(at, -1, 4)
    expect(at).toBe(0)
  })

  it('a single note cycles to itself rather than going nowhere', () => {
    expect(stepIndex(0, 1, 1)).toBe(0)
    expect(stepIndex(0, -1, 1)).toBe(0)
  })

  it('clamps a stale focus that outlived a shortened hierarchy', () => {
    // Focus was on row 9; a write left only 3 rows. Clamp to 2, then step.
    expect(stepIndex(9, 1, 3)).toBe(0)
    expect(stepIndex(9, -1, 3)).toBe(1)
  })

  it('is a no-op on an empty hierarchy', () => {
    expect(stepIndex(0, 1, 0)).toBe(0)
  })
})
