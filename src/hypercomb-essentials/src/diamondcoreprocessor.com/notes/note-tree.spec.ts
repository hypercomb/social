import { describe, expect, it } from 'vitest'
import { addChildInTree, insertAtIndex, removeFromTree, setTextInTree, splitInTree, type Note } from './note-tree.js'

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

// ── The list interface's two writes ─────────────────────────────────────
// A list is grown one line at a time (addChildInTree) and corrected in
// place (setTextInTree). Both had to exist because `note:commit` can only
// touch the cell's TOP-LEVEL slot, and a list item is nested by definition.

describe('addChildInTree', () => {

  it('appends the new line as the parent\'s last child', () => {
    const tree = [note('a', 'shopping', { children: [note('a1', 'milk')] })]

    const { tree: next, changed } = addChildInTree(tree, 'a', 'bread')

    expect(changed).toBe(true)
    expect(next[0].children.map(c => c.text)).toEqual(['milk', 'bread'])
  })

  it('gives the new line no id — it has no bytes yet, so no signature', () => {
    const { tree: next } = addChildInTree([note('a', 'list')], 'a', 'first item')
    expect(next[0].children[0].id).toBe('')
  })

  it('carries the mark the line was written with', () => {
    const { tree: next } = addChildInTree([note('a', 'list')], 'a', 'item', 'check_box')
    expect(next[0].children[0].mark).toBe('check_box')
  })

  it('grows a nested list at any depth', () => {
    const tree = [note('a', 'top', { children: [note('a1', 'sub list')] })]

    const { tree: next, changed } = addChildInTree(tree, 'a1', 'deep item')

    expect(changed).toBe(true)
    expect(next[0].children[0].children.map(c => c.text)).toEqual(['deep item'])
  })

  it('refuses a blank line and an unknown parent', () => {
    const tree = [note('a', 'list')]
    expect(addChildInTree(tree, 'a', '   ').changed).toBe(false)
    expect(addChildInTree(tree, 'nope', 'item').changed).toBe(false)
    expect(addChildInTree(tree, 'a', '   ').tree).toBe(tree)
  })

  it('never mutates the input tree or its nodes', () => {
    const parent = note('a', 'list', { children: [note('a1', 'one')] })
    const tree = [parent]

    addChildInTree(tree, 'a', 'two')

    expect(parent.children).toHaveLength(1)
  })
})

describe('setTextInTree', () => {

  it('retexts a NESTED note, keeping its children and position', () => {
    const tree = [
      note('a', 'first'),
      note('b', 'list', { children: [note('b1', 'typo', { children: [note('b1a', 'kid')] }), note('b2', 'other')] }),
    ]

    const { tree: next, changed } = setTextInTree(tree, 'b1', 'fixed')

    expect(changed).toBe(true)
    expect(next.map(n => n.id)).toEqual(['a', 'b'])
    const item = next[1].children[0]
    expect(item.text).toBe('fixed')
    expect(item.children.map(c => c.id)).toEqual(['b1a'])   // subtree survives
    expect(next[1].children.map(n => n.id)).toEqual(['b1', 'b2'])  // position held
  })

  it('keeps the mark and the pheromones when only text is given', () => {
    const tree = [note('a', 'old', { mark: 'lightbulb', tags: ['jwize.com:idea'] })]

    const { tree: next } = setTextInTree(tree, 'a', 'new')

    expect(next[0].mark).toBe('lightbulb')
    expect(next[0].tags).toEqual(['jwize.com:idea'])
  })

  it('sets the mark too when the caller passes one', () => {
    const { tree: next } = setTextInTree([note('a', 'old', { mark: 'lightbulb' })], 'a', 'new', 'check_box')
    expect(next[0].mark).toBe('check_box')

    const cleared = setTextInTree([note('a', 'old', { mark: 'lightbulb' })], 'a', 'new', null)
    expect(cleared.tree[0].mark).toBeNull()
  })

  it('refuses a blank text — a blank is a delete, and the caller has to say so', () => {
    const tree = [note('a', 'text')]
    const { tree: next, changed } = setTextInTree(tree, 'a', '   ')
    expect(changed).toBe(false)
    expect(next).toBe(tree)
  })

  it('reports no change when the note already reads exactly that', () => {
    const tree = [note('a', 'same')]
    expect(setTextInTree(tree, 'a', 'same').changed).toBe(false)
    expect(setTextInTree(tree, 'a', '  same  ').changed).toBe(false)
  })

  it('returns untouched subtrees by reference so re-materialization dedups them', () => {
    const sibling = note('a', 'first', { children: [note('a1', 'kid')] })
    const tree = [sibling, note('b', 'old')]

    const { tree: next } = setTextInTree(tree, 'b', 'new')

    expect(next[0]).toBe(sibling)
    expect(next[1]).not.toBe(tree[1])
  })
})

describe('insertAtIndex', () => {

  it('puts a node among its siblings at a depth, not just at the end', () => {
    const tree = [note('a', 'a', { children: [note('a1', 'one'), note('a2', 'two')] })]

    const { tree: next, placed } = insertAtIndex(tree, 'a', note('x', 'new'), 1)

    expect(placed).toBe(true)
    expect(next[0]!.children.map(c => c.id)).toEqual(['a1', 'x', 'a2'])
  })

  it('inserts among the roots when the parent is null, and clamps a long index', () => {
    const tree = [note('a', 'a'), note('b', 'b')]

    expect(insertAtIndex(tree, null, note('x', 'x'), 0).tree.map(n => n.id)).toEqual(['x', 'a', 'b'])
    expect(insertAtIndex(tree, null, note('x', 'x'), 99).tree.map(n => n.id)).toEqual(['a', 'b', 'x'])
  })

  it('says so when the parent is not in the tree — nothing is placed', () => {
    const { tree: next, placed } = insertAtIndex([note('a', 'a')], 'ghost', note('x', 'x'), 0)

    expect(placed).toBe(false)
    expect(next.map(n => n.id)).toEqual(['a'])
  })

  it('reorders a line among its siblings — pluck, then place', () => {
    // The move the list pane makes: drag the third line above the first.
    const tree = [note('L', 'list', {
      children: [note('l1', 'one'), note('l2', 'two'), note('l3', 'three')],
    })]

    const { tree: without, removed } = removeFromTree(tree, 'l3')
    const { tree: next } = insertAtIndex(without, 'L', removed!, 0)

    expect(next[0]!.children.map(c => c.id)).toEqual(['l3', 'l1', 'l2'])
  })

  it('carries a moved line and the lines under it', () => {
    const tree = [note('L', 'list', {
      children: [note('l1', 'one', { children: [note('l1a', 'under one')] }), note('l2', 'two')],
    })]

    const { tree: without, removed } = removeFromTree(tree, 'l1')
    const { tree: next } = insertAtIndex(without, 'l2', removed!, 0)

    const moved = next[0]!.children[0]!.children[0]!
    expect(moved.id).toBe('l1')
    expect(moved.children.map(c => c.id)).toEqual(['l1a'])
  })
})
