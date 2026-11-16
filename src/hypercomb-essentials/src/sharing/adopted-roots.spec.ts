// adopted-roots.spec.ts — adopted roots + adopt tombstones (revocations).
// Participant-local localStorage registries; prefix semantics throughout.
// The tombstone contract is what keeps deleted tiles DELETED: auto-sync
// consults isAdoptTombstoned before folding a publisher's copy back in.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  markAdoptedRoot,
  unmarkAdoptedRoot,
  isWithinAdoptedRoot,
  markAdoptTombstone,
  clearAdoptTombstone,
  isAdoptTombstoned,
  markCarriedRoot,
  unmarkCarriedRoot,
  isPeerContentAt,
  _resetAdoptedRootsCache,
} from './adopted-roots.js'

beforeEach(() => { localStorage.clear(); _resetAdoptedRootsCache() })

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

describe('whose words a route holds', () => {
  it('a branch folded in from a peer is peer content, top to bottom', () => {
    markAdoptedRoot(['theirs'])
    expect(isPeerContentAt(['theirs'])).toBe(true)
    expect(isPeerContentAt(['theirs', 'deep'])).toBe(true)
    expect(isPeerContentAt(['mine'])).toBe(false)
    expect(isPeerContentAt([])).toBe(false)
  })

  it("a peer's tile carried onto the participant's own page stays peer content there", () => {
    markCarriedRoot(['mine', 'their-note'])
    expect(isPeerContentAt(['mine', 'their-note'])).toBe(true)
    expect(isPeerContentAt(['mine', 'their-note', 'inside'])).toBe(true)
    expect(isPeerContentAt(['mine'])).toBe(false)
    expect(isPeerContentAt(['mine', 'my-note'])).toBe(false)
  })

  describe("on a managed site door, the owner's own replica", () => {
    // The worker's record, as the worker plants it: a JSON script in <head>.
    const door = (lineage: string): void => {
      const record = document.createElement('script')
      record.type = 'application/json'
      record.id = 'hc-manage'
      record.textContent = JSON.stringify({ lineage })
      document.head.appendChild(record)
    }
    afterEach(() => { document.getElementById('hc-manage')?.remove() })

    it('is adopted, and is not a peer: the card and everything on it are the owner’s words', () => {
      markAdoptedRoot(['business-card'])
      expect(isPeerContentAt(['business-card'])).toBe(true)
      door('business-card')
      expect(isPeerContentAt(['business-card'])).toBe(false)
      expect(isPeerContentAt(['business-card', 'animation'])).toBe(false)
      // The record itself stays: the swarm still follows the publisher by it.
      expect(isWithinAdoptedRoot(['business-card'])).toBe(true)
    })

    it('a site that lives deeper is its whole route', () => {
      markAdoptedRoot(['revolucion', 'meetup'])
      markAdoptedRoot(['revolucion'])
      door('revolucion/meetup')
      expect(isPeerContentAt(['revolucion', 'meetup', 'page'])).toBe(true) // /revolucion is still a peer's branch
      unmarkAdoptedRoot(['revolucion'])
      markAdoptedRoot(['revolucion', 'meetup'])
      expect(isPeerContentAt(['revolucion', 'meetup', 'page'])).toBe(false)
    })

    it('a branch taken in beneath it, a carried tile, and any other branch are still a peer’s', () => {
      markAdoptedRoot(['business-card'])
      markAdoptedRoot(['business-card', 'found'])
      markCarriedRoot(['business-card', 'their-note'])
      markAdoptedRoot(['theirs'])
      door('business-card')
      expect(isPeerContentAt(['business-card', 'found'])).toBe(true)
      expect(isPeerContentAt(['business-card', 'found', 'inside'])).toBe(true)
      expect(isPeerContentAt(['business-card', 'their-note'])).toBe(true)
      expect(isPeerContentAt(['theirs'])).toBe(true)
      expect(isPeerContentAt(['business-card', 'mine'])).toBe(false)
    })

    it('markup planted in the page is not the record: the branch stays a peer’s', () => {
      markAdoptedRoot(['theirs'])
      const planted = document.createElement('script')
      planted.type = 'application/json'
      planted.id = 'hc-manage'
      planted.textContent = JSON.stringify({ lineage: 'theirs' })
      document.body.appendChild(planted)
      expect(isPeerContentAt(['theirs'])).toBe(true)
    })
  })

  it('a carried root drives nothing in the swarm: it is not an adopted root', () => {
    markCarriedRoot(['mine', 'their-note'])
    expect(isWithinAdoptedRoot(['mine', 'their-note'])).toBe(false)
  })

  it('a carried root goes when its tile goes, ancestors stay; a covered path is not repeated', () => {
    markCarriedRoot(['a', 'b'])
    markCarriedRoot(['a', 'b', 'c'])
    expect(JSON.parse(localStorage.getItem('hc:carried-roots') ?? '[]')).toEqual([['a', 'b']])
    markCarriedRoot(['x'])
    unmarkCarriedRoot(['a', 'b', 'c'])
    expect(isPeerContentAt(['a', 'b'])).toBe(true)
    unmarkCarriedRoot(['a'])
    expect(isPeerContentAt(['a', 'b'])).toBe(false)
    expect(isPeerContentAt(['x'])).toBe(true)
  })
})
