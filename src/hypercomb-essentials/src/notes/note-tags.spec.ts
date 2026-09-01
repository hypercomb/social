// Pheromones ON NOTES — the tree rewrite and the value guard.
//
// Lives beside note-tree.spec.ts rather than inside it: that spec covers the
// tree algebra it was extracted for, this one covers the pheromone slot added
// on top. Same module, two concerns.
//
// The invariant worth guarding here is the one that keeps content-addressing
// honest: an UNTAGGED note must normalize to an empty list so its layer omits
// the slot entirely and signs to exactly the bytes it did before notes could
// carry pheromones. If that ever breaks, every nest / mark / delete would
// re-sign the whole tree instead of dedupe-ing the untouched branches.

import { describe, expect, it } from 'vitest'
import { normalizeTags, setTagInTree, type Note } from './note-tree.js'

const note = (id: string, tags: string[] = [], children: Note[] = []): Note =>
  ({ id, text: id, shape: null, mark: null, tags, children })

describe('normalizeTags', () => {
  it('an absent / non-array value is no tags at all', () => {
    expect(normalizeTags(undefined)).toEqual([])
    expect(normalizeTags(null)).toEqual([])
    expect(normalizeTags('design')).toEqual([])
  })

  it('sorts, so the same SET always signs to the same bytes', () => {
    expect(normalizeTags(['risk', 'design'])).toEqual(['design', 'risk'])
    expect(normalizeTags(['design', 'risk'])).toEqual(['design', 'risk'])
  })

  it('collapses duplicates and trims', () => {
    expect(normalizeTags(['design', ' design ', 'design'])).toEqual(['design'])
  })

  it('drops what could not have come from a keyword', () => {
    expect(normalizeTags([42, null, {}, '', '   '])).toEqual([])
    expect(normalizeTags(['two\nlines'])).toEqual([])
    expect(normalizeTags(['x'.repeat(49)])).toEqual([])
  })

  it('caps the list so one note cannot grow unbounded', () => {
    const many = Array.from({ length: 40 }, (_, i) => 'tag' + i)
    expect(normalizeTags(many)).toHaveLength(24)
  })
})

describe('setTagInTree', () => {
  it('puts a keyword on the named note', () => {
    const { tree, changed } = setTagInTree([note('a')], 'a', 'design', true)
    expect(changed).toBe(true)
    expect(tree[0]!.tags).toEqual(['design'])
  })

  it('finds a note at ANY depth and leaves its children alone', () => {
    const deep = note('root', [], [note('mid', [], [note('leaf')])])
    const { tree, changed } = setTagInTree([deep], 'leaf', 'design', true)
    expect(changed).toBe(true)
    const leaf = tree[0]!.children[0]!.children[0]!
    expect(leaf.tags).toEqual(['design'])
    expect(tree[0]!.tags).toEqual([])
  })

  it('keeps the note in place, with its children', () => {
    const parent = note('p', [], [note('c1'), note('c2')])
    const { tree } = setTagInTree([parent], 'p', 'design', true)
    expect(tree[0]!.children.map(c => c.id)).toEqual(['c1', 'c2'])
  })

  it('re-dropping the same keyword changes NOTHING — no new revision', () => {
    const { changed } = setTagInTree([note('a', ['design'])], 'a', 'design', true)
    expect(changed).toBe(false)
  })

  it('takes a keyword back off', () => {
    const { tree, changed } = setTagInTree([note('a', ['design', 'risk'])], 'a', 'design', false)
    expect(changed).toBe(true)
    expect(tree[0]!.tags).toEqual(['risk'])
  })

  it('removing one that was never there changes nothing', () => {
    const { changed } = setTagInTree([note('a')], 'a', 'design', false)
    expect(changed).toBe(false)
  })

  it('an untagged note ends with an EMPTY list, so its layer omits the slot', () => {
    const { tree } = setTagInTree([note('a', ['design'])], 'a', 'design', false)
    expect(tree[0]!.tags).toEqual([])
    expect(normalizeTags(tree[0]!.tags)).toHaveLength(0)
  })

  it('a note that is not in this tree is left alone', () => {
    const { changed } = setTagInTree([note('a')], 'elsewhere', 'design', true)
    expect(changed).toBe(false)
  })

  it('does not touch siblings', () => {
    const { tree } = setTagInTree([note('a'), note('b')], 'a', 'design', true)
    expect(tree[1]!.tags).toEqual([])
  })
})
