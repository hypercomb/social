// core/edge-registry.spec.ts — the edge/referent contract.

import { describe, expect, it } from 'vitest'
import { EDGE_FIELDS, REFERENT_FIELDS, edgeSigsOf, isEdgeField, isReferentField } from './edge-registry.js'

const sigA = 'a'.repeat(64)
const sigB = 'b'.repeat(64)
const sigC = 'c'.repeat(64)

describe('edge registry', () => {
  it('declares the uniform-node edge vocabulary and nothing else', () => {
    // Frozen contract: extending EDGE_FIELDS is a closure-protocol decision.
    // If this fails you are CHANGING THE PROTOCOL — every precise walker and
    // the native client must agree before the list moves.
    expect([...EDGE_FIELDS].sort()).toEqual([
      'bee', 'children', 'content', 'dependency', 'layer', 'refs', 'resource',
    ])
  })

  it('a field is never both an edge and a referent', () => {
    for (const field of EDGE_FIELDS) expect(isReferentField(field), field).toBe(false)
    for (const field of REFERENT_FIELDS) expect(isEdgeField(field), field).toBe(false)
  })

  // A succession's predecessor is a POINTER, not bytes the closure owes.
  // Carrying it would drag the whole past into every read (measured: 123 atom
  // fetches to render one member) and make prune unimplementable, because
  // `prev` chains all history into merkle reachability.
  // See documentation/hypergraph-molecule-lineage.md.
  it('treats a succession `prev` as a referent, never an edge', () => {
    expect(isReferentField('prev')).toBe(true)
    expect(isEdgeField('prev')).toBe(false)
  })

  it('never harvests `prev` into a closure', () => {
    expect(edgeSigsOf({ children: [sigA], prev: sigB })).toEqual([sigA])
  })

  it('edgeSigsOf harvests edge fields only, shallow, deduped, lowercased', () => {
    const sigs = edgeSigsOf({
      children: [sigA, sigB, sigA.toUpperCase(), 'not-a-sig'],
      content: sigC,
      layer: sigA,
      resource: sigB,
      dependency: sigC,
      bee: sigA,
      targetSig: 'd'.repeat(64),   // referent — never harvested
      groupSig: 'e'.repeat(64),    // referent — never harvested
      payload: { htmlSig: 'f'.repeat(64) },  // nested — a per-kind hop, not a node edge
      name: 'plain',
    })
    expect(sigs.sort()).toEqual([sigA, sigB, sigC])
  })

  it('edgeSigsOf tolerates absent and malformed fields', () => {
    expect(edgeSigsOf({})).toEqual([])
    expect(edgeSigsOf({ children: 'not-an-array-or-sig', content: 42 as unknown as string, refs: null })).toEqual([])
  })
})
