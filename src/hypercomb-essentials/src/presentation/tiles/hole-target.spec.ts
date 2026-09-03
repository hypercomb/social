import { describe, expect, it } from 'vitest'
import { holeMeaning, interfaceName, withMeaningAt } from './hole-target.js'
import { builtinLayout, nodeOf, withNodeAt } from './layout-template.js'

const rail = builtinLayout('rail')!
const split = builtinLayout('split')!

const holeKeys = (t = rail): readonly string[] => t.holes.filter(h => !h.self).map(h => h.key)

describe('naming a hole mints a variant, never an edit in place', () => {
  it('leaves the layout it was made from untouched', () => {
    const key = holeKeys()[0]
    const before = nodeOf(rail, {})
    const after = withMeaningAt(before, [key], 'site:masthead')

    expect(after.template.holes.find(h => h.key === key)?.meaning).toBe('site:masthead')
    // The SHARED record is the thing that must not move: N containers read it.
    expect(rail.holes.find(h => h.key === key)?.meaning).toBeUndefined()
    expect(before.template.holes.find(h => h.key === key)?.meaning).toBeUndefined()
  })

  it('refuses a hole that is not there, and one holding a nested layout', () => {
    const root = nodeOf(split, {})
    const [first] = holeKeys(split)
    expect(withMeaningAt(root, ['nonesuch'], 'site:masthead')).toBe(root)
    expect(withMeaningAt(root, [], 'site:masthead')).toBe(root)

    // A hole with a layout in it is filled BY THAT LAYOUT — it takes no member,
    // so it can ask for nothing.
    const nested = withNodeAt(root, [first], nodeOf(rail, {}))
    expect(withMeaningAt(nested, [first], 'site:masthead')).toBe(nested)
  })

  it('refuses an unscoped name rather than guessing a family', () => {
    const key = holeKeys()[0]
    const root = nodeOf(rail, {})
    // Same node back: nothing moved, so nothing is re-minted.
    expect(withMeaningAt(root, [key], 'masthead')).toBe(root)
  })

  it('does not re-mint when the name is the one already there', () => {
    const key = holeKeys()[0]
    const named = withMeaningAt(nodeOf(rail, {}), [key], 'site:masthead')
    expect(withMeaningAt(named, [key], 'site:masthead')).toBe(named)
  })

  it('DROPS the field when unnamed — not an empty string', () => {
    const key = holeKeys()[0]
    const named = withMeaningAt(nodeOf(rail, {}), [key], 'site:masthead')
    const cleared = withMeaningAt(named, [key], '')
    const hole = cleared.template.holes.find(h => h.key === key)!
    expect('meaning' in hole).toBe(false)
  })

  it('names a hole on a NESTED level without touching the level above', () => {
    const [outer] = holeKeys(split)
    const inner = holeKeys(rail)[0]
    const root = withNodeAt(nodeOf(split, {}), [outer], nodeOf(rail, {}))
    const after = withMeaningAt(root, [outer, inner], 'site:masthead')

    expect(after.nested[outer]!.template.holes.find(h => h.key === inner)?.meaning)
      .toBe('site:masthead')
    // The outer level re-mints (its child changed) but its own holes do not.
    expect(after.template.holes).toEqual(root.template.holes)
  })
})

describe('a variant is named after the interface it declares', () => {
  it('takes the family as its suffix, and does not stack suffixes', () => {
    expect(interfaceName('split', [{ meaning: 'site:masthead' }])).toBe('split-site')
    // A second hole named in the same family gives the same name back.
    expect(interfaceName(
      'split-site',
      [{ meaning: 'site:masthead' }, { meaning: 'site:body' }],
      [{ meaning: 'site:masthead' }],
    )).toBe('split-site')
  })

  it('gives the stem back when the last name comes off', () => {
    expect(interfaceName('split-site', [], [{ meaning: 'site:masthead' }])).toBe('split')
  })

  it('says `interface` when the holes serve more than one family', () => {
    expect(interfaceName(
      'split',
      [{ meaning: 'site:masthead' }, { meaning: 'gallery:cover' }],
    )).toBe('split-interface')
  })

  it('never shortens a name it did not write', () => {
    // Nothing ever declared a `thirds` family, so the suffix is part of the
    // layout's own name and stays.
    expect(interfaceName('two-thirds', [{ meaning: 'site:masthead' }]))
      .toBe('two-thirds-site')
    expect(interfaceName('two-thirds', [])).toBe('two-thirds')
  })
})

describe('a meaning is folded before it is minted', () => {
  it('scopes and slugs both halves', () => {
    expect(holeMeaning('site', 'My Masthead')).toBe('site:my-masthead')
    expect(holeMeaning('', 'masthead')).toBe('site:masthead')
    expect(holeMeaning('Gallery', 'Cover')).toBe('gallery:cover')
  })

  it('is empty for an empty name — never a bare `site:`', () => {
    expect(holeMeaning('site', '')).toBe('')
    expect(holeMeaning('site', '   ')).toBe('')
  })
})
