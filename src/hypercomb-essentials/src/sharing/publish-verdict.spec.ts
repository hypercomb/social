// publish-verdict.spec.ts — the honesty of the publish differential.
//
// Every case here is a way the panel could LIE, pinned so it cannot start
// lying again. The ladder's whole job is to distinguish three things that all
// look like "not live": the world is behind (drift), the world asserted
// nothing (unknown), and we could not look at our own side (cannot-compare).

import { describe, expect, it } from 'vitest'
import { publishVerdict, RECENT_PUBLISH_MS, type VerdictInput } from './publish-verdict.js'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const NOW = 1_700_000_000_000

const verdict = (patch: Partial<VerdictInput>): string =>
  publishVerdict({
    live: A,
    here: A,
    served: 'served',
    indexState: 'ok',
    indexStale: false,
    record: undefined,
    sealable: true,
    now: NOW,
    ...patch,
  })

describe('publish verdict ladder', () => {

  it('same head both sides, bytes confirmed served — the only path to live', () => {
    expect(verdict({})).toBe('live')
  })

  it('a different local head is drift', () => {
    expect(verdict({ here: B })).toBe('drift')
  })

  // ── the three honesty rules ────────────────────────────────────────────

  it('an unprovable service verdict is NOT live, even with matching heads', () => {
    // 'unknown' = offline / CORS / 5xx / breaker. Nothing was asserted, so the
    // green light is not earned. This is the cached-200 discipline: matching
    // signatures alone never prove the world can fetch them.
    expect(verdict({ served: 'unknown' })).toBe('unknown')
  })

  it('a cold child reads as cannot-compare, never as drift', () => {
    // sealSubtree returns null when a child has never been opened. Collapsing
    // that into "different" would invent drift out of an unvisited tile and
    // push the participant to republish something that never changed.
    expect(verdict({ here: null })).toBe('cannot-compare')
  })

  it('only a 404 asserts absence', () => {
    expect(verdict({ served: 'absent' })).toBe('gone')
    expect(verdict({ served: 'unknown', here: B })).not.toBe('gone')
  })

  // ── the index cannot be believed ───────────────────────────────────────

  it('an unreadable index makes every row unknown, not broken', () => {
    for (const indexState of ['unreachable', 'malformed', 'http', 'checking'] as const) {
      expect(verdict({ indexState })).toBe('unknown')
    }
  })

  it('a forged index does not paint rows red — it is reported once, at the panel', () => {
    expect(verdict({ indexState: 'forged' })).toBe('unknown')
  })

  it('an index older than one we signed is stale-edge, outranking a byte probe', () => {
    // Authentic AND wrong: the schnorr check passes, so only our own monotonic
    // stamp can catch it. It must win over the served probe, which would
    // otherwise light the row green off the superseded head.
    expect(verdict({ indexStale: true })).toBe('stale-edge')
    expect(verdict({ indexStale: true, served: 'served', here: A })).toBe('stale-edge')
  })

  // ── nothing published ──────────────────────────────────────────────────

  it('no index entry for a branch we can seal is unpublished', () => {
    expect(verdict({ live: null, indexState: 'none' })).toBe('unpublished')
  })

  it('no index entry and nothing to seal is unknown, not unpublished', () => {
    // An entry with no local path (published from another device) cannot be
    // called "not published" — we have no idea what it is.
    expect(verdict({ live: null, sealable: false, indexState: 'none' })).toBe('unknown')
  })

  it('an index entry with no local branch reports unknown rather than guessing', () => {
    expect(verdict({ sealable: false, here: null })).toBe('unknown')
  })

  // ── pending is time-bounded ────────────────────────────────────────────

  it('a just-published head the index does not name yet is pending', () => {
    expect(verdict({
      live: B,
      here: A,
      record: { sealed: A, at: NOW - 1000 },
    })).toBe('pending')
  })

  it('an OLD record naming a head the index moved past is not pending — the index wins', () => {
    // Another device published. The panel must not insist its own memory
    // outranks what the world actually serves.
    expect(verdict({
      live: B,
      here: A,
      record: { sealed: A, at: NOW - RECENT_PUBLISH_MS - 1 },
    })).toBe('drift')
  })

  it('a stale edge outranks pending — the read itself is the problem', () => {
    expect(verdict({
      live: B,
      here: A,
      indexStale: true,
      record: { sealed: A, at: NOW - 1000 },
    })).toBe('stale-edge')
  })
})
