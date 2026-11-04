import { describe, expect, it } from 'vitest'
import { entriesToMembers, membersToEntries, shelfType, bouquetOf } from './quick-tray.ring.js'

const sig = 'a'.repeat(64)

describe('the shelf ring', () => {
  it('keeps only the rows a page lists by signature', () => {
    const members = entriesToMembers([
      { label: 'a', sourceSegments: ['x', 'y'], sig },
      { label: 'b', sourceSegments: [] },
    ])
    expect(members).toEqual([{ path: 'x/y/a', name: 'a', sig }])
  })

  it('reads a group back as the rows it was kept from', () => {
    const rows = [{ label: 'a', sourceSegments: ['x', 'y'], sig }]
    expect(membersToEntries(entriesToMembers(rows))).toEqual(rows)
  })
})

describe('a shelf of tags', () => {
  const tag = { label: 'work', sourceSegments: [], sig, kind: 'tag' as const }

  it('is kept as tag members and comes back as tags', () => {
    const members = entriesToMembers([tag])
    expect(members).toEqual([{ path: 'tag:work', name: 'work', sig }])
    expect(membersToEntries(members)).toEqual([tag])
  })

  it('is a tags shelf only when every member is a tag', () => {
    expect(shelfType({ members: entriesToMembers([tag]) })).toBe('tags')
    expect(shelfType({ members: [...entriesToMembers([tag]), { path: 'a', name: 'a', sig }] })).toBe('tiles')
    expect(shelfType({ members: [] })).toBe('tiles')
  })
})

describe('the bouquet', () => {
  it('is the tags the shelf holds, in order, and leaves the tiles out', () => {
    expect(bouquetOf([
      { label: 'a', sourceSegments: [], sig },
      { label: 'work', sourceSegments: [], sig, kind: 'tag' },
      { label: 'home', sourceSegments: [], sig, kind: 'tag' },
    ])).toEqual(['work', 'home'])
  })
})
