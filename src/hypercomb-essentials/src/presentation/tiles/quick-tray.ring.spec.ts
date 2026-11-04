import { describe, expect, it } from 'vitest'
import { entriesToMembers, membersToEntries } from './quick-tray.ring.js'

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
