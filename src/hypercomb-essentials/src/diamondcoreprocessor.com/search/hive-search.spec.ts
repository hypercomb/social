import { describe, expect, it } from 'vitest'
import {
  depthOf, groupHits, rowsOfManifest, scoreRow, searchRecord, spliceChildRows, wordsOf,
  type SearchRecord,
} from './hive-search.js'

const SIG = 'a'.repeat(64)

describe('search rows', () => {

  it('indexes a tile\'s words but never its signatures', () => {
    const words = wordsOf('Lounge', { note: 'cigar room', small: { image: SIG } })
    expect(words).toContain('lounge')
    expect(words).toContain('cigar room')
    expect(words).not.toContain(SIG)
  })

  it('reads a manifest ring as rows rooted at the parent', () => {
    const rows = rowsOfManifest([
      { sig: SIG, layer: { name: 'Lounge' } },
      { sig: 'b'.repeat(64), layer: { name: 'Humidor' } },
    ], [])
    expect(rows.map(r => r.name)).toEqual(['Lounge', 'Humidor'])
    expect(rows.map(depthOf)).toEqual([1, 1])
  })
})

describe('composition — the merkle payout', () => {

  it('splices a child record whole, deepening its paths', () => {
    const child: SearchRecord = {
      v: 1,
      rows: [
        { sig: 'c'.repeat(64), name: 'darts', path: ['darts'], words: 'darts' },
        { sig: 'd'.repeat(64), name: 'board', path: ['darts', 'board'], words: 'board' },
      ],
    }
    const spliced = spliceChildRows(child, ['lounge'])
    expect(spliced.map(r => r.path)).toEqual([
      ['lounge', 'darts'],
      ['lounge', 'darts', 'board'],
    ])
    // Depth is the path length — the splice deepens rows without a second
    // field to keep in step.
    expect(spliced.map(depthOf)).toEqual([2, 3])
  })
})

describe('answering', () => {

  const record: SearchRecord = {
    v: 1,
    rows: [
      { sig: '1'.repeat(64), name: 'notes', path: ['notes'], words: 'notes' },
      { sig: '2'.repeat(64), name: 'notes', path: ['lounge', 'notes'], words: 'notes' },
      { sig: '3'.repeat(64), name: 'noteworthy', path: ['noteworthy'], words: 'noteworthy' },
      { sig: '4'.repeat(64), name: 'humidor', path: ['lounge', 'humidor'], words: 'humidor cigars' },
    ],
  }

  it('ranks exact over prefix, and nearer over deeper', () => {
    // All three are prefix matches, so depth separates them and same-depth
    // rows fall back to name order.
    expect(searchRecord(record, 'note').map(h => h.path)).toEqual([
      ['notes'],
      ['noteworthy'],
      ['lounge', 'notes'],
    ])
    expect(searchRecord(record, 'notes').map(h => h.path)).toEqual([
      ['notes'],            // exact, shallowest
      ['lounge', 'notes'],  // exact, deeper
    ])
  })

  it('matches a tile by what it says, not only by its name', () => {
    expect(searchRecord(record, 'cigars').map(h => h.name)).toEqual(['humidor'])
  })

  it('keeps a deep exact match above a shallow weaker one', () => {
    const mixed: SearchRecord = {
      v: 1,
      rows: [
        { sig: '6'.repeat(64), name: 'humidor cabinet', path: ['humidor cabinet'], words: 'humidor cabinet' },
        { sig: '7'.repeat(64), name: 'humidor', path: ['a', 'b', 'c', 'humidor'], words: 'humidor' },
      ],
    }
    expect(searchRecord(mixed, 'humidor').map(h => h.name)).toEqual(['humidor', 'humidor cabinet'])
  })

  it('never filters the answer by depth — only ranks it', () => {
    const deep: SearchRecord = {
      v: 1,
      rows: [{
        sig: '5'.repeat(64), name: 'ashtray',
        path: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'ashtray'], words: 'ashtray',
      }],
    }
    expect(searchRecord(deep, 'ashtray')).toHaveLength(1)
    expect(scoreRow(deep.rows[0], 'ashtray')).toBeGreaterThan(0)
  })

  it('gathers hits by the branch they live in', () => {
    const groups = groupHits(searchRecord(record, 'notes'))
    expect(groups.map(g => g.branch)).toEqual(['', 'lounge'])
  })
})
