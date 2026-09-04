import { describe, expect, it } from 'vitest'
import { hiveOutline, holeMeaning, interfaceName, withMeaningAt } from './hole-target.js'
import { builtinLayout, nodeOf, withNodeAt, type LayoutNode } from './layout-template.js'

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

  it('refuses a hole that is not there', () => {
    const root = nodeOf(split, {})
    expect(withMeaningAt(root, ['nonesuch'], 'site:masthead')).toBe(root)
    expect(withMeaningAt(root, [], 'site:masthead')).toBe(root)
  })

  it('NAMES A SECTION — a hole holding a layout is the branch, not a seat', () => {
    // This overturns the rule that stood here before: a hole with a layout in
    // it takes no MEMBER, and that was read as "so it can ask for nothing".
    // A name is not a seat. In a hive the section is the tile everything under
    // it hangs from, and withholding the name made every hive a design could
    // grow exactly one row deep.
    const [first] = holeKeys(split)
    const nested = withNodeAt(nodeOf(split, {}), [first], nodeOf(rail, {}))
    const named = withMeaningAt(nested, [first], 'site:masthead')

    expect(named).not.toBe(nested)
    expect(named.template.holes.find(h => h.key === first)?.meaning).toBe('site:masthead')
    // And the layout that was in it is still in it — naming the section says
    // what the section IS, and moves nothing.
    expect(named.nested[first]?.template.name).toBe(rail.name)
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

// ── THE HIVE A DESIGN IS ASKING FOR ────────────────────────────────────────

describe('hiveOutline', () => {

  const named = (node: LayoutNode, path: string[], name: string): LayoutNode =>
    withMeaningAt(node, path, holeMeaning('site', name))

  it('says nothing at all until something is named', () => {
    expect(hiveOutline(nodeOf(split, {}))).toEqual([])
  })

  it('reads named leaves as children, in the order the design reads', () => {
    const [one, two] = holeKeys(split)
    let root = named(nodeOf(split, {}), [one], 'masthead')
    root = named(root, [two], 'body')
    expect(hiveOutline(root)).toEqual([['masthead'], ['body']])
  })

  it('reads a named SECTION as the branch its leaves hang from', () => {
    const [one] = holeKeys(split)
    const [inner] = holeKeys(rail)
    let root = withNodeAt(nodeOf(split, {}), [one], nodeOf(rail, {}))
    root = named(root, [one], 'chrome')
    root = named(root, [one, inner], 'nav')
    expect(hiveOutline(root)).toEqual([['chrome'], ['chrome', 'nav']])
  })

  it('lets an UNNAMED section through — it is an arrangement, not a place', () => {
    const [one] = holeKeys(split)
    const [inner] = holeKeys(rail)
    let root = withNodeAt(nodeOf(split, {}), [one], nodeOf(rail, {}))
    root = named(root, [one, inner], 'nav')
    // `nav` hangs from the nearest NAMED ancestor, which here is the container
    // itself. A section nobody named is not a tile nobody asked for.
    expect(hiveOutline(root)).toEqual([['nav']])
  })
})
