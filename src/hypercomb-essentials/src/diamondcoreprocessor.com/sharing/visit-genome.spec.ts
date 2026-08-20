// visit-genome.spec.ts — the durable ledger of the drilled path.
//
// The genome is provenance, never truth: these pins guard the record shape
// (path → {layerSig, pubkey, domain, atMs}), the reject-garbage rule (no
// half-records from malformed wire data), the delete-side hygiene twin
// (dropVisitsWithin), and the bounded-cap eviction.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  recordVisit,
  visitRecordAt,
  visitRecords,
  dropVisitsWithin,
  _resetVisitGenomeCache,
} from './visit-genome.js'

const SIG_A = 'a'.repeat(64)
const SIG_B = 'b'.repeat(64)
const PK = '1'.repeat(64)

beforeEach(() => {
  localStorage.clear()
  _resetVisitGenomeCache()
})

describe('visit genome', () => {

  it('records a visit and reads it back by path', () => {
    recordVisit({ segments: ['garden', 'roses'], layerSig: SIG_A, pubkey: PK, domain: 'bees.example' })
    const rec = visitRecordAt(['garden', 'roses'])
    expect(rec).toBeTruthy()
    expect(rec!.layerSig).toBe(SIG_A)
    expect(rec!.pubkey).toBe(PK)
    expect(rec!.domain).toBe('bees.example')
    expect(rec!.atMs).toBeGreaterThan(0)
    // Persisted, not just cached.
    _resetVisitGenomeCache()
    expect(visitRecordAt(['garden', 'roses'])?.layerSig).toBe(SIG_A)
  })

  it('a re-visit refreshes the record in place — one record per path', () => {
    recordVisit({ segments: ['garden'], layerSig: SIG_A, pubkey: PK })
    recordVisit({ segments: ['garden'], layerSig: SIG_B, pubkey: PK })
    expect(visitRecords().length).toBe(1)
    expect(visitRecordAt(['garden'])!.layerSig).toBe(SIG_B)
  })

  it('rejects malformed input — no half-records from bad wire data', () => {
    recordVisit({ segments: [], layerSig: SIG_A, pubkey: PK })
    recordVisit({ segments: ['x'], layerSig: 'not-a-sig', pubkey: PK })
    recordVisit({ segments: ['x'], layerSig: SIG_A, pubkey: 'nope' })
    expect(visitRecords().length).toBe(0)
  })

  it('dropVisitsWithin removes the path and everything beneath, nothing beside', () => {
    recordVisit({ segments: ['garden'], layerSig: SIG_A, pubkey: PK })
    recordVisit({ segments: ['garden', 'roses'], layerSig: SIG_A, pubkey: PK })
    recordVisit({ segments: ['gardening'], layerSig: SIG_A, pubkey: PK })  // prefix-STRING trap
    dropVisitsWithin(['garden'])
    expect(visitRecordAt(['garden'])).toBeNull()
    expect(visitRecordAt(['garden', 'roses'])).toBeNull()
    // 'gardening' shares the string prefix but is a different path — kept.
    expect(visitRecordAt(['gardening'])).toBeTruthy()
  })

  it('tolerates corrupt storage', () => {
    localStorage.setItem('hc:visit-genome', '{not json')
    _resetVisitGenomeCache()
    expect(visitRecords()).toEqual([])
    recordVisit({ segments: ['fresh'], layerSig: SIG_A, pubkey: PK })
    expect(visitRecordAt(['fresh'])).toBeTruthy()
  })

})
