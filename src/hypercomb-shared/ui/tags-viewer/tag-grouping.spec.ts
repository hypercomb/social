// hypercomb-shared/ui/tags-viewer/tag-grouping.spec.ts
//
// The grouping rule is a doctrine — "a bouquet is a set, not a folder" — and
// the two ways it can silently rot are (a) a gathered mark quietly vanishing
// from the panel entirely, and (b) namespaced marks drifting into the loose
// list until it is unreadable again. Both are asserted here.

import { describe, it, expect } from 'vitest'
import {
  namespaceOf, looseMarks, namespaceGroupsOf,
  matchesQuery, filterRowsByQuery, bouquetMatchesQuery, filterNamespaceGroups,
} from './tag-grouping'

const rows = (...names: string[]) => names.map(name => ({ name }))

describe('namespaceOf', () => {
  it('splits on the FIRST colon, so deeper segments stay detail', () => {
    expect(namespaceOf('visual:website:page')).toBe('visual')
    expect(namespaceOf('visual:slide:deck')).toBe('visual')
    expect(namespaceOf('usage:dwell')).toBe('usage')
  })

  it('treats a plain keyword as having no namespace', () => {
    expect(namespaceOf('family')).toBeNull()
    expect(namespaceOf('close friends')).toBeNull()
  })

  it('refuses a leading colon — that is a malformed name, not a group', () => {
    // Grouping on '' would collect every such mistake into one unnamed pile.
    expect(namespaceOf(':orphan')).toBeNull()
  })
})

describe('looseMarks', () => {
  it('drops marks that a bouquet already holds', () => {
    const out = looseMarks(rows('close', 'family', 'friend'), new Set(['close', 'friend']))
    expect(out.map(r => r.name)).toEqual(['family'])
  })

  it('never lists a namespaced mark, gathered or not', () => {
    const out = looseMarks(rows('family', 'visual:website:page', 'usage:dwell'), new Set())
    expect(out.map(r => r.name)).toEqual(['family'])
  })

  it('lists everything when nothing has been gathered', () => {
    const out = looseMarks(rows('close', 'family'), new Set())
    expect(out.map(r => r.name)).toEqual(['close', 'family'])
  })
})

describe('namespaceGroupsOf', () => {
  it('groups by prefix and orders the groups by name', () => {
    const out = namespaceGroupsOf(rows(
      'visual:website:page', 'usage:dwell', 'visual:slide:deck', 'family'))
    expect(out.map(g => g.name)).toEqual(['usage', 'visual'])
    expect(out[0].rows.map(r => r.name)).toEqual(['usage:dwell'])
    expect(out[1].rows.map(r => r.name)).toEqual(['visual:website:page', 'visual:slide:deck'])
  })

  it('keeps a namespaced mark in its namespace even when it is in a bouquet', () => {
    // A namespace is where a mark IS; a bouquet is where someone filed it.
    // Being gathered must not empty a namespace group.
    const all = rows('visual:website:page', 'family')
    const gathered = new Set(['visual:website:page'])
    expect(namespaceGroupsOf(all)[0].rows.map(r => r.name)).toEqual(['visual:website:page'])
    expect(looseMarks(all, gathered).map(r => r.name)).toEqual(['family'])
  })

  it('is empty when the vocabulary is all plain keywords', () => {
    expect(namespaceGroupsOf(rows('family', 'close'))).toEqual([])
  })
})

describe('every mark stays reachable', () => {
  it('lists each mark in at least one part of the panel', () => {
    const all = rows('family', 'close', 'friend', 'visual:website:page', 'usage:dwell')
    const gathered = new Set(['close', 'friend'])
    const shown = new Set([
      ...looseMarks(all, gathered).map(r => r.name),
      ...namespaceGroupsOf(all).flatMap(g => g.rows.map(r => r.name)),
      ...gathered,   // shown inside their bouquet
    ])
    expect([...shown].sort()).toEqual(all.map(r => r.name).sort())
  })
})

// ── the search ──────────────────────────────────────────────────────────────

describe('matchesQuery', () => {
  it('is a case-insensitive substring match', () => {
    expect(matchesQuery('Family', 'fam')).toBe(true)
    expect(matchesQuery('family', 'FAM')).toBe(true)
    expect(matchesQuery('family', 'friend')).toBe(false)
  })

  it('matches everything on a blank or whitespace query', () => {
    expect(matchesQuery('anything', '')).toBe(true)
    expect(matchesQuery('anything', '   ')).toBe(true)
  })
})

describe('filterRowsByQuery', () => {
  it('keeps only the rows whose name matches', () => {
    const out = filterRowsByQuery(rows('family', 'friend', 'draft'), 'fr')
    expect(out.map(r => r.name)).toEqual(['friend'])
  })

  it('is the identity on a blank query', () => {
    const all = rows('family', 'friend')
    expect(filterRowsByQuery(all, '')).toEqual(all)
  })
})

describe('bouquetMatchesQuery', () => {
  it('matches on the bouquet name', () => {
    expect(bouquetMatchesQuery('field-notes', ['draft', 'idea'], 'field')).toBe(true)
  })

  it('matches on any mark it holds — searching a keyword must surface the bouquets that would land it', () => {
    expect(bouquetMatchesQuery('field-notes', ['draft', 'idea'], 'idea')).toBe(true)
    expect(bouquetMatchesQuery('field-notes', ['draft', 'idea'], 'family')).toBe(false)
  })
})

describe('filterNamespaceGroups', () => {
  const groups = namespaceGroupsOf(rows(
    'visual:website:page', 'visual:slide:deck', 'usage:dwell'))

  it('a matching GROUP NAME keeps the whole group', () => {
    const out = filterNamespaceGroups(groups, 'visual')
    expect(out).toHaveLength(1)
    expect(out[0].rows.map(r => r.name)).toEqual(['visual:website:page', 'visual:slide:deck'])
  })

  it('otherwise a group survives with just its matching rows', () => {
    const out = filterNamespaceGroups(groups, 'slide')
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('visual')
    expect(out[0].rows.map(r => r.name)).toEqual(['visual:slide:deck'])
  })

  it('drops groups left with nothing', () => {
    expect(filterNamespaceGroups(groups, 'dwell').map(g => g.name)).toEqual(['usage'])
  })

  it('is the identity on a blank query', () => {
    expect(filterNamespaceGroups(groups, ' ')).toEqual(groups)
  })
})
