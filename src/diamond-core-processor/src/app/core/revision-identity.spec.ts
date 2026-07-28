import { describe, expect, it } from 'vitest'
import { collapseRevisions, identityKey, type RevisionCandidate } from './revision-identity'

const c = (
  sig: string,
  identity: string | null,
  rank = 0,
  order = 0,
): RevisionCandidate<string> => ({ sig, identity, rank, order, item: sig })

describe('identityKey', () => {
  it('is the class name at its lineage', () => {
    expect(identityKey('presentation/tiles', 'TileOverlayDrone')).toBe('presentation/tiles/TileOverlayDrone')
  })

  it('is null when the class name never resolved — an unnameable artifact can never be proven a duplicate', () => {
    expect(identityKey('presentation/tiles', null)).toBeNull()
    expect(identityKey('presentation/tiles', '')).toBeNull()
    expect(identityKey('presentation/tiles', '   ')).toBeNull()
  })
})

describe('collapseRevisions', () => {
  it('keeps ONE revision per identity and records the rest as superseded', () => {
    const { kept, superseded, losers } = collapseRevisions([
      c('aaa', 'grid/HexDrone', 0, 0),
      c('bbb', 'grid/HexDrone', 1, 1),
    ])
    expect(kept.map(k => k.sig)).toEqual(['aaa'])
    expect(losers).toEqual(new Set(['bbb']))
    expect(superseded.get('aaa')).toEqual(['bbb'])
  })

  it('ranks LOWEST-WINS regardless of the order candidates arrive in', () => {
    const { kept, losers } = collapseRevisions([
      c('stale', 'grid/HexDrone', 2, 0),
      c('fresh', 'grid/HexDrone', 0, 1),
    ])
    expect(kept.map(k => k.sig)).toEqual(['fresh'])
    expect(losers).toEqual(new Set(['stale']))
  })

  it('breaks rank ties on document order, never on iteration luck', () => {
    const { kept } = collapseRevisions([
      c('second', 'grid/HexDrone', 1, 5),
      c('first', 'grid/HexDrone', 1, 2),
    ])
    expect(kept.map(k => k.sig)).toEqual(['first'])
  })

  // The three duplicate shapes: only the middle one is a revision.

  it('does NOT treat one signature seen twice as a revision conflict', () => {
    // Same artifact referenced from two layers. Activation is keyed by
    // signature and happens once, so this is one instance and one switch.
    const { kept, losers } = collapseRevisions([
      c('aaa', 'grid/HexDrone', 0, 0),
      c('aaa', 'grid/HexDrone', 1, 1),
    ])
    expect(kept.map(k => k.sig)).toEqual(['aaa'])
    expect(losers.size).toBe(0)
  })

  it('does NOT fold the same class name at different lineages — that is a fork, not a revision', () => {
    const { kept, losers } = collapseRevisions([
      c('aaa', 'grid/HexDrone', 0, 0),
      c('bbb', 'wheel/HexDrone', 0, 1),
    ])
    expect(kept.map(k => k.sig)).toEqual(['aaa', 'bbb'])
    expect(losers.size).toBe(0)
  })

  it('never collapses identityless candidates away', () => {
    const { kept, losers } = collapseRevisions([
      c('aaa', null, 0, 0),
      c('bbb', null, 0, 1),
    ])
    expect(kept.map(k => k.sig)).toEqual(['aaa', 'bbb'])
    expect(losers.size).toBe(0)
  })

  it('folds a repeated identityless sig to one row without calling it a loser', () => {
    const { kept, losers } = collapseRevisions([
      c('aaa', null, 0, 0),
      c('aaa', null, 0, 1),
    ])
    expect(kept.map(k => k.sig)).toEqual(['aaa'])
    expect(losers.size).toBe(0)
  })

  it('emits winners in first-appearance order so the collapsed list reads like the source', () => {
    const { kept } = collapseRevisions([
      c('a1', 'x/A', 1, 0),
      c('b1', 'x/B', 0, 1),
      c('a2', 'x/A', 0, 2), // the winner for A, but A still appears first
      c('c1', null, 0, 3),
    ])
    expect(kept.map(k => k.sig)).toEqual(['a2', 'b1', 'c1'])
  })

  it('collapses three generations to one, recording both losers', () => {
    const { kept, superseded, losers } = collapseRevisions([
      c('g1', 'x/A', 2, 0),
      c('g2', 'x/A', 1, 1),
      c('g3', 'x/A', 0, 2),
    ])
    expect(kept.map(k => k.sig)).toEqual(['g3'])
    expect(losers).toEqual(new Set(['g1', 'g2']))
    expect(superseded.get('g3')).toEqual(['g1', 'g2'])
  })
})
