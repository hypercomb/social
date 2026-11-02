// quick-tray.entries.spec.ts — the tray's entry set: a take appends, the same
// tile taken twice is one row that keeps its sig, same-named tiles from two
// pages are two rows, and a drop lets go by key.

import { describe, expect, it } from 'vitest'
import { dropEntries, entryKey, takeEntries } from './quick-tray.entries'

const SIG = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)

describe('quick tray entries', () => {
  it('a take appends a reference, in the order taken', () => {
    const held = takeEntries([], [{ label: 'first', sourceSegments: ['page'] }])
    const next = takeEntries(held, [{ label: 'second', sourceSegments: ['page'], sig: SIG }])
    expect(next.map(e => e.label)).toEqual(['first', 'second'])
    expect(next[1]!.sig).toBe(SIG)
  })

  it('the same tile taken twice is one row, and a sig once captured is never erased', () => {
    const once = takeEntries([], [{ label: 'tile', sourceSegments: ['page'], sig: SIG }])
    const twice = takeEntries(once, [{ label: 'tile', sourceSegments: ['page'] }])
    expect(twice).toHaveLength(1)
    expect(twice[0]!.sig).toBe(SIG)
    const refreshed = takeEntries(twice, [{ label: 'tile', sourceSegments: ['page'], sig: OTHER }])
    expect(refreshed[0]!.sig).toBe(OTHER)
  })

  it('same-named tiles from different pages are two rows', () => {
    const held = takeEntries([], [
      { label: 'tile', sourceSegments: ['a'] },
      { label: 'tile', sourceSegments: ['b'] },
    ])
    expect(held).toHaveLength(2)
    expect(new Set(held.map(entryKey)).size).toBe(2)
  })

  it('ignores a blank label and a malformed sig, and cleans the source path', () => {
    const held = takeEntries([], [
      { label: '  ', sourceSegments: ['page'] },
      { label: 'tile', sourceSegments: [' page ', ''], sig: 'not-a-sig' },
    ])
    expect(held).toEqual([{ label: 'tile', sourceSegments: ['page'] }])
  })

  it('a drop lets go by key, never by bare label', () => {
    const held = takeEntries([], [
      { label: 'tile', sourceSegments: ['a'] },
      { label: 'tile', sourceSegments: ['b'] },
    ])
    const left = dropEntries(held, new Set([entryKey({ label: 'tile', sourceSegments: ['a'] })]))
    expect(left).toEqual([{ label: 'tile', sourceSegments: ['b'] }])
  })
})
