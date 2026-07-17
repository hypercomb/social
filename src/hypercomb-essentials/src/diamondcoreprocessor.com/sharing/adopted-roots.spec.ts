// adopted-roots.spec.ts — adopted roots + adopt tombstones (revocations).
// Participant-local localStorage registries; prefix semantics throughout.
// The tombstone contract is what keeps deleted tiles DELETED: auto-sync
// consults isAdoptTombstoned before folding a publisher's copy back in.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  markAdoptedRoot,
  unmarkAdoptedRoot,
  isWithinAdoptedRoot,
  markAdoptTombstone,
  clearAdoptTombstone,
  isAdoptTombstoned,
} from './adopted-roots.js'

beforeEach(() => localStorage.clear())

describe('adopted roots', () => {
  it('marks a root and matches it and its descendants', () => {
    markAdoptedRoot(['styles'])
    expect(isWithinAdoptedRoot(['styles'])).toBe(true)
    expect(isWithinAdoptedRoot(['styles', 'page'])).toBe(true)
    expect(isWithinAdoptedRoot(['other'])).toBe(false)
    expect(isWithinAdoptedRoot([])).toBe(false)
  })

  it('unmark removes roots at and beneath the path, keeps ancestors and siblings', () => {
    markAdoptedRoot(['hive', 'styles'])
    markAdoptedRoot(['hive', 'styles', 'inner'])
    markAdoptedRoot(['hive', 'sync'])
    unmarkAdoptedRoot(['hive', 'styles'])
    expect(isWithinAdoptedRoot(['hive', 'styles'])).toBe(false)
    expect(isWithinAdoptedRoot(['hive', 'styles', 'inner'])).toBe(false)
    expect(isWithinAdoptedRoot(['hive', 'sync'])).toBe(true)
  })

  it('unmark leaves an ancestor root standing (siblings still adopted)', () => {
    markAdoptedRoot(['hive'])
    unmarkAdoptedRoot(['hive', 'styles'])
    // the ancestor root still covers the deleted path — the TOMBSTONE is
    // what revokes it (see below); unmark alone must not orphan siblings
    expect(isWithinAdoptedRoot(['hive', 'sync'])).toBe(true)
    expect(isWithinAdoptedRoot(['hive', 'styles'])).toBe(true)
  })
})

describe('adopt tombstones — delete is the unsubscribe', () => {
  it('a stone covers its path and everything beneath it', () => {
    markAdoptTombstone(['hive', 'styles'])
    expect(isAdoptTombstoned(['hive', 'styles'])).toBe(true)
    expect(isAdoptTombstoned(['hive', 'styles', 'page'])).toBe(true)
    expect(isAdoptTombstoned(['hive', 'sync'])).toBe(false)
    expect(isAdoptTombstoned(['hive'])).toBe(false)
  })

  it('a covering stone absorbs deeper ones', () => {
    markAdoptTombstone(['hive', 'styles', 'deep'])
    markAdoptTombstone(['hive', 'styles'])
    // still one effective revocation; the deep one folded into its ancestor
    expect(JSON.parse(localStorage.getItem('hc:adopt-tombstones') ?? '[]')).toHaveLength(1)
    expect(isAdoptTombstoned(['hive', 'styles', 'deep'])).toBe(true)
  })

  it('marking a path already covered is a no-op', () => {
    markAdoptTombstone(['hive'])
    markAdoptTombstone(['hive', 'styles'])
    expect(JSON.parse(localStorage.getItem('hc:adopt-tombstones') ?? '[]')).toHaveLength(1)
  })

  it('an explicit re-adopt clears stones at, beneath AND above the path', () => {
    markAdoptTombstone(['hive', 'styles'])
    clearAdoptTombstone(['hive', 'styles'])
    expect(isAdoptTombstoned(['hive', 'styles'])).toBe(false)

    // ancestor stone must not keep blocking a just-adopted descendant
    markAdoptTombstone(['hive'])
    clearAdoptTombstone(['hive', 'styles'])
    expect(isAdoptTombstoned(['hive', 'styles'])).toBe(false)
  })

  it('the delete → re-adopt round trip', () => {
    // adopt
    markAdoptedRoot(['hive', 'styles'])
    expect(isWithinAdoptedRoot(['hive', 'styles'])).toBe(true)
    // delete = revoke
    markAdoptTombstone(['hive', 'styles'])
    unmarkAdoptedRoot(['hive', 'styles'])
    expect(isWithinAdoptedRoot(['hive', 'styles'])).toBe(false)
    expect(isAdoptTombstoned(['hive', 'styles'])).toBe(true)
    // explicit adopt click = re-subscribe
    clearAdoptTombstone(['hive', 'styles'])
    markAdoptedRoot(['hive', 'styles'])
    expect(isAdoptTombstoned(['hive', 'styles'])).toBe(false)
    expect(isWithinAdoptedRoot(['hive', 'styles'])).toBe(true)
  })

  it('ignores empty paths', () => {
    markAdoptTombstone([])
    markAdoptTombstone(['', '  '])
    expect(localStorage.getItem('hc:adopt-tombstones')).toBeNull()
    expect(isAdoptTombstoned([])).toBe(false)
  })
})
