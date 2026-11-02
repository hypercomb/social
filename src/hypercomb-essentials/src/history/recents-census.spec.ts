// recents-census.spec.ts — the census fold: paths prefix on composition, an
// atom counts once however many pages list it, a null child truncates the
// parent, the reader rejects what it cannot read, and newest comes first.

import { describe, expect, it } from 'vitest'
import {
  MAX_CENSUS_ENTRIES, RECENTS_DERIVATION, composeCensus, gatherAtoms, isHusk, newestFirst, readableCensus,
  type CensusRecord,
} from './recents-census'

const sig = (c: string): string => c.repeat(64)

const leaf = (c: string, label: string, at: number): CensusRecord =>
  ({ v: RECENTS_DERIVATION, entries: [{ sig: sig(c), label, path: [], at }] })

describe('composeCensus', () => {
  it('prefixes each child name onto every path beneath it', () => {
    const people = composeCensus({ sig: sig('b'), label: 'people', at: 20 }, [
      { name: 'ann', record: leaf('c', 'ann', 30) },
    ])
    const root = composeCensus({ sig: sig('a'), label: '/', at: 10 }, [
      { name: 'people', record: people },
    ])
    expect(root.entries.map(e => e.path)).toEqual([[], ['people'], ['people', 'ann']])
    expect(root.truncated).toBeUndefined()
  })

  it('counts an atom once however many pages list it', () => {
    const shared = leaf('c', 'shared', 30)
    const root = composeCensus({ sig: sig('a'), label: '/', at: 10 }, [
      { name: 'first', record: composeCensus({ sig: sig('b'), label: 'first', at: 20 }, [{ name: 'shared', record: shared }]) },
      { name: 'second', record: composeCensus({ sig: sig('d'), label: 'second', at: 25 }, [{ name: 'shared', record: shared }]) },
    ])
    const hits = root.entries.filter(e => e.sig === sig('c'))
    expect(hits).toHaveLength(1)
    expect(hits[0]!.path).toEqual(['first', 'shared'])
  })

  it('a child that could not be read truncates the parent; so does a truncated child', () => {
    const missing = composeCensus({ sig: sig('a'), label: '/', at: 1 }, [{ name: 'x', record: null }])
    expect(missing.truncated).toBe(true)
    const partial: CensusRecord = { ...leaf('b', 'b', 2), truncated: true }
    expect(composeCensus({ sig: sig('a'), label: '/', at: 1 }, [{ name: 'b', record: partial }]).truncated).toBe(true)
  })

  it('caps the record and says so', () => {
    const big: CensusRecord = {
      v: RECENTS_DERIVATION,
      entries: Array.from({ length: MAX_CENSUS_ENTRIES }, (_, i) =>
        ({ sig: i.toString(16).padStart(64, '0'), label: String(i), path: [], at: i + 1 })),
    }
    const root = composeCensus({ sig: sig('f'), label: '/', at: 1 }, [{ name: 'big', record: big }])
    expect(root.truncated).toBe(true)
    expect(root.entries.length).toBe(MAX_CENSUS_ENTRIES)
  })
})

describe('readableCensus', () => {
  it('reads a record of this derivation, dropping malformed entries', () => {
    const read = readableCensus({
      v: RECENTS_DERIVATION,
      entries: [
        { sig: sig('A'), label: 'ok', path: ['x'], at: 5 },
        { sig: 'nope', label: 'bad', path: [], at: 5 },
        { sig: sig('b'), label: 7, path: 'not-a-path', at: 5 },
        { sig: sig('c'), label: 'cold', path: [], at: 'never' },
      ],
    })
    expect(read?.entries).toEqual([
      { sig: sig('a'), label: 'ok', path: ['x'], at: 5 },
      { sig: sig('c'), label: 'cold', path: [], at: 0 },
    ])
  })

  it('rejects another derivation, a truncated record, and non-records', () => {
    expect(readableCensus({ v: RECENTS_DERIVATION + 1, entries: [] })).toBeNull()
    expect(readableCensus({ v: RECENTS_DERIVATION, entries: [], truncated: true })).toBeNull()
    expect(readableCensus(null)).toBeNull()
    expect(readableCensus('x')).toBeNull()
  })
})

describe('newestFirst', () => {
  it('orders by date descending, unknown dates last, shallower then by name on a tie', () => {
    const record: CensusRecord = {
      v: RECENTS_DERIVATION,
      entries: [
        { sig: sig('1'), label: 'old', path: [], at: 1 },
        { sig: sig('2'), label: 'cold', path: ['a'], at: 0 },
        { sig: sig('3'), label: 'new', path: ['a', 'b'], at: 9 },
        { sig: sig('4'), label: 'beta', path: ['a'], at: 9 },
        { sig: sig('5'), label: 'alpha', path: ['a'], at: 9 },
      ],
    }
    expect(newestFirst(record).map(e => e.label)).toEqual(['alpha', 'beta', 'new', 'old', 'cold'])
    expect(newestFirst(null)).toEqual([])
  })
})

describe('gatherAtoms', () => {
  const record: CensusRecord = {
    v: RECENTS_DERIVATION,
    entries: [
      { sig: sig('a'), label: '/', path: [], at: 1 },
      { sig: sig('b'), label: 'ann', path: ['people', 'ann'], at: 5 },
    ],
  }

  it('leaves the root out and marks a hidden path, reading the session list shape', () => {
    const atoms = gatherAtoms(record, [], new Set(['people/ann']))
    expect(atoms).toHaveLength(1)
    expect(atoms[0]).toMatchObject({ label: 'ann', placed: true, hidden: true })
  })

  it('keeps an atom no page lists, at its date, unplaced', () => {
    const atoms = gatherAtoms(record, [{ sig: sig('c'), label: 'cut', path: [], at: 9 }], new Set())
    expect(atoms.map(a => a.label)).toEqual(['cut', 'ann'])
    expect(atoms[0]).toMatchObject({ placed: false, hidden: false })
  })

  it('counts an atom once when the tree and a bag both name it', () => {
    const atoms = gatherAtoms(record, [{ sig: sig('b'), label: 'ann', path: [], at: 9 }], new Set())
    expect(atoms).toHaveLength(1)
    expect(atoms[0]!.placed).toBe(true)
  })
})

describe('isHusk', () => {
  it('is a bare name on a single marker, and nothing else', () => {
    expect(isHusk({ name: 'x' }, 1)).toBe(true)
    expect(isHusk({ name: 'x' }, 2)).toBe(false)
    expect(isHusk({ name: 'x', children: [] }, 1)).toBe(false)
  })
})
