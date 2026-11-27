// served-ledger.spec.ts — what the hive reads from its host's ledger before it
// asks a nested place's own name. The console once filled with failed TLS
// handshakes (`net::ERR_SSL_VERSION_OR_CIPHER_MISMATCH`) for names no
// certificate covered: names under zones that were really site doors
// (`…architecture.hypercomb.architecture.hypercomb.jwize.com`), and real deep
// names the host had never attached. A zone is the door with its PLACE's labels
// taken off, and a deep name is asked only once the host lists it attached
// and its certificate can have arrived.

import { describe, expect, it } from 'vitest'
import { deepNameReady, readServedLedger } from './publish-status.drone.js'

const ledger = {
  sites: [
    // A hand-bound site whose lineage is nested: its implicit door hangs off jwize.com.
    { lineage: 'hypercomb/architecture/replication-by-signature', hosts: [
      { host: 'replication.hypercomb.com', implicit: false },
      { host: 'replication-by-signature.architecture.hypercomb.jwize.com', implicit: true },
    ] },
    // A top-level place: its one-label door hangs off its zone.
    { lineage: 'hyperdex', hosts: [{ host: 'hyperdex.pluginthematrix.com', implicit: true }] },
    { lineage: 'revolucion/meetup', hosts: [
      { host: 'meetup.pluginthematrix.com', implicit: false },
      { host: 'meetup.revolucion.realones.online', implicit: true },
    ] },
  ],
  deepNames: { 'hyperdex.knowledge.jwize.com': 0, 'part.hyperdex.knowledge.jwize.com': 1_800_000_000_000, 'bad.example.com': 'soon' },
}

describe('the zones in the ledger', () => {
  it('take the place\'s own labels off an implicit door, never just one', () => {
    const { zones } = readServedLedger('jwize.com', ledger)
    expect(zones).toContain('jwize.com')
    expect(zones).toContain('realones.online')
    expect(zones).toContain('pluginthematrix.com')
    expect(zones).toContain('hypercomb.com')       // from the bound door, as before
    expect(zones).not.toContain('architecture.hypercomb.jwize.com')
    expect(zones).not.toContain('revolucion.realones.online')
  })

  it('read nothing from a ledger that is not one', () => {
    expect(readServedLedger('jwize.com', null)).toEqual({ zones: ['jwize.com'], attached: new Map(), read: true })
    expect(readServedLedger('jwize.com', { sites: 'x' }).zones).toEqual(['jwize.com'])
  })
})

describe('the deep names the host attached', () => {
  it('are read with when, and a time that is not a number is left out', () => {
    const { attached } = readServedLedger('jwize.com', ledger)
    expect(attached.get('hyperdex.knowledge.jwize.com')).toBe(0)
    expect(attached.get('part.hyperdex.knowledge.jwize.com')).toBe(1_800_000_000_000)
    expect(attached.has('bad.example.com')).toBe(false)
  })

  it('a host that predates the list says none are attached', () => {
    expect(readServedLedger('jwize.com', { sites: ledger.sites }).attached.size).toBe(0)
  })
})

describe('when a deep name may be asked', () => {
  const at = 1_800_000_000_000
  it('never while the host has not attached it', () => {
    expect(deepNameReady(undefined, at)).toBe(false)
  })
  it('at once for a name attached before the host kept times', () => {
    expect(deepNameReady(0, at)).toBe(true)
  })
  it('only once its certificate can have arrived', () => {
    expect(deepNameReady(at, at + 60_000)).toBe(false)
    expect(deepNameReady(at, at + 6 * 60_000)).toBe(true)
  })
})
