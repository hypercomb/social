import { describe, expect, it } from 'vitest'
import { splitInTree, type Note } from './note-tree.js'

const note = (id: string, text: string, extra: Partial<Note> = {}): Note => ({
  id,
  text,
  shape: null,
  mark: null,
  children: [],
  ...extra,
  // `extra` is a Partial, so an explicit `tags: undefined` would punch a hole
  // in a required field. Assert the default after the spread.
  tags: extra.tags ?? [],
})

describe('splitInTree', () => {

  it('replaces the note in place — position, mark and shape all survive', () => {
    const tree = [
      note('a', 'first'),
      note('b', 'a long note. with two sentences.', { mark: 'lightbulb', shape: 'diamond' }),
      note('c', 'last'),
    ]

    const { tree: next, changed } = splitInTree(tree, 'b', 'a long note', ['with two sentences'])

    expect(changed).toBe(true)
    expect(next.map(n => n.id)).toEqual(['a', 'b', 'c'])  // position held
    const split = next[1]
    expect(split.text).toBe('a long note')
    expect(split.mark).toBe('lightbulb')   // mark rides along
    expect(split.shape).toBe('diamond')    // legacy shape too
    expect(split.children.map(c => c.text)).toEqual(['with two sentences'])
  })

  it('prepends the parts to children the note already had', () => {
    const tree = [note('b', 'head. body.', { children: [note('b1', 'existing')] })]

    const { tree: next } = splitInTree(tree, 'b', 'head', ['body'])

    expect(next[0].children.map(c => c.text)).toEqual(['body', 'existing'])
    expect(next[0].children[1].id).toBe('b1')  // the existing child is untouched
  })

  it('splits a note at any depth', () => {
    const tree = [
      note('a', 'top', { children: [note('a1', 'mid', { children: [note('a2', 'deep. detail.') ] })] }),
    ]

    const { tree: next, changed } = splitInTree(tree, 'a2', 'deep', ['detail'])

    expect(changed).toBe(true)
    const deep = next[0].children[0].children[0]
    expect(deep.text).toBe('deep')
    expect(deep.children.map(c => c.text)).toEqual(['detail'])
  })

  it('gives parts no id — they have no bytes yet, so no signature', () => {
    const { tree: next } = splitInTree([note('b', 'head. body.')], 'b', 'head', ['body'])

    expect(next[0].children[0].id).toBe('')
  })

  it('carries a mark on a part, and drops one that is not a valid icon name', () => {
    const { tree: next } = splitInTree(
      [note('b', 'head. one. two.')],
      'b',
      'head',
      [{ text: 'one', mark: 'check_circle' }, { text: 'two', mark: 'NOT AN ICON' }],
    )

    expect(next[0].children.map(c => c.mark)).toEqual(['check_circle', null])
  })

  it('accepts bare strings and part objects in the same call', () => {
    const { tree: next } = splitInTree(
      [note('b', 'head. one. two.')],
      'b',
      'head',
      ['one', { text: 'two', mark: 'star' }],
    )

    expect(next[0].children.map(c => c.text)).toEqual(['one', 'two'])
    expect(next[0].children.map(c => c.mark)).toEqual([null, 'star'])
  })

  it('trims the head and every part, and drops blank parts', () => {
    const { tree: next } = splitInTree(
      [note('b', 'x')],
      'b',
      '  head  ',
      ['  one  ', '   ', { text: '' }, 'two'],
    )

    expect(next[0].text).toBe('head')
    expect(next[0].children.map(c => c.text)).toEqual(['one', 'two'])
  })

  // ── refusals: each returns the ORIGINAL tree by reference, so the
  //    caller's `if (!changed) return` skips the commit and no layer is
  //    minted for a no-op.

  it('refuses a blank head — a head is extracted, never invented', () => {
    const tree = [note('b', 'body text')]

    const result = splitInTree(tree, 'b', '   ', ['body text'])

    expect(result.changed).toBe(false)
    expect(result.tree).toBe(tree)
  })

  it('refuses a split into no parts — retitling is note:commit, not a split', () => {
    const tree = [note('b', 'body text')]

    expect(splitInTree(tree, 'b', 'head', []).changed).toBe(false)
    expect(splitInTree(tree, 'b', 'head', ['  ']).tree).toBe(tree)
  })

  it('refuses a note that is not in this tree', () => {
    const tree = [note('a', 'first'), note('b', 'second')]

    const result = splitInTree(tree, 'nope', 'head', ['part'])

    expect(result.changed).toBe(false)
    expect(result.tree).toBe(tree)
  })

  // ── immutability + dedup

  it('never mutates the input tree or its nodes', () => {
    const child = note('b1', 'existing')
    const target = note('b', 'head. body.', { children: [child] })
    const tree = [note('a', 'first'), target]

    splitInTree(tree, 'b', 'head', ['body'])

    expect(tree).toHaveLength(2)
    expect(target.text).toBe('head. body.')
    expect(target.children).toEqual([child])
    expect(child.children).toEqual([])
  })

  it('returns untouched subtrees by reference so re-materialization dedups them', () => {
    const sibling = note('a', 'first', { children: [note('a1', 'kid')] })
    const tree = [sibling, note('b', 'head. body.')]

    const { tree: next } = splitInTree(tree, 'b', 'head', ['body'])

    // The sibling branch is the SAME object — materializing it hits the
    // Store's content address and writes no new bytes.
    expect(next[0]).toBe(sibling)
    expect(next[1]).not.toBe(tree[1])
  })
})
