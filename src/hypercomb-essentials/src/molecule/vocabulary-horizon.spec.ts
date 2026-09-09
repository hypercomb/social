// molecule/vocabulary-horizon.spec.ts
//
// THE ROUTING TABLE — pure, so this reads no localStorage, opens no pool and
// contacts no host.

import { describe, expect, it } from 'vitest'
import { apexOf, buildHorizon, doorsOfZone, publishersFromCards, contentDoorOf } from './vocabulary-horizon.js'

const K1 = '1'.repeat(64)
const K2 = '2'.repeat(64)

describe('the doors', () => {
  it('turns a ZONE into its content door', () => {
    expect(contentDoorOf('example.com')).toBe('content.example.com')
    expect(contentDoorOf('content.example.com')).toBe('content.example.com')
    expect(contentDoorOf('https://Example.com/')).toBe('content.example.com')
    expect(contentDoorOf('')).toBe('')
  })

  // THE DEAD DOOR. A DNS wildcard covers ONE label, so a site on a wildcard
  // zone has its relay face at the zone's APEX. `content.susan.hypercomb.com`
  // is a name nothing answers, and asking it spent the search's whole timeout
  // before reporting that no door answered.
  it('puts the relay face on the APEX of a wildcard zone, never on the site', () => {
    expect(apexOf('susan.hypercomb.com')).toBe('hypercomb.com')
    expect(apexOf('hypercomb.com')).toBe('hypercomb.com')
    expect(apexOf('a.b.hypercomb.com')).toBe('hypercomb.com')
    expect(contentDoorOf('susan.hypercomb.com')).toBe('content.hypercomb.com')
    expect(contentDoorOf('https://revolucion.pluginthematrix.com/')).toBe('content.pluginthematrix.com')
  })

  it('leaves a machine alone — a port or a loopback is not a zone', () => {
    expect(apexOf('localhost:4250')).toBe('localhost:4250')
    expect(apexOf('127.0.0.1')).toBe('127.0.0.1')
    expect(contentDoorOf('localhost:4250')).toBe('content.localhost:4250')
  })

  // A published site serves its publisher's signed index on its OWN hostname:
  // `/hive/<pubkey>` is matched above the site branch in the worker's router.
  // Asking only the relay face threw that door away.
  it('asks the zone itself as well as the relay face', () => {
    expect(doorsOfZone('susan.hypercomb.com')).toEqual(['susan.hypercomb.com', 'content.hypercomb.com'])
    expect(doorsOfZone('example.com')).toEqual(['example.com', 'content.example.com'])
    expect(doorsOfZone('content.example.com')).toEqual(['content.example.com'])
    expect(doorsOfZone('')).toEqual([])
  })
})

describe('the horizon', () => {
  it('folds one publisher reached two ways into ONE row holding both doors', () => {
    const horizon = buildHorizon({
      visits: [{ pubkey: K1, domain: 'one.com' }],
      follows: { root: { pubkey: K1, hosts: ['content.two.com'] } },
    })
    expect(horizon.publishers).toHaveLength(1)
    expect(horizon.publishers[0]?.hosts).toEqual(
      expect.arrayContaining(['content.one.com', 'content.two.com']))
  })

  // This test used to assert the opposite — every community door AND the
  // standing endpoint handed to every publisher. `hiveIndexUrl` puts the
  // publisher's KEY in the path, so that shape disclosed the whole follow
  // graph, in one burst, to a host that hosts none of them. A shared door is
  // offered only where this reader holds no door of its own; the standing
  // endpoint is never a per-publisher door.
  it('a publisher with its own door gets ONLY its own door — no shared host learns who you follow', () => {
    const horizon = buildHorizon({
      visits: [{ pubkey: K1, domain: 'one.com' }, { pubkey: K2, domain: 'two.com' }],
      communityZones: ['shared.example'],
      fallbackHosts: ['content.pluginthematrix.com'],
    })
    expect(horizon.publishers).toHaveLength(2)
    const byKey = new Map(horizon.publishers.map(p => [p.pubkey, p.hosts]))
    // Its own door means the site AND its relay face — both are the
    // publisher's own, and neither is a host that learns who else you follow.
    expect(byKey.get(K1)).toEqual(['one.com', 'content.one.com'])
    expect(byKey.get(K2)).toEqual(['two.com', 'content.two.com'])
    for (const row of horizon.publishers) {
      expect(row.hosts).not.toContain('content.shared.example')
      expect(row.hosts).not.toContain('content.pluginthematrix.com')
    }
  })

  it('a publisher with NO door of its own gets the community zones, and still never the standing endpoint', () => {
    const horizon = buildHorizon({
      follows: { r: { pubkey: K1, hosts: [] } },
      communityZones: ['shared.example'],
      fallbackHosts: ['content.pluginthematrix.com'],
    })
    expect(horizon.publishers).toHaveLength(1)
    expect(horizon.publishers[0]?.hosts).toEqual(['shared.example', 'content.shared.example'])
  })

  it('drops a relay address and a host carrying a path — a door is a bare authority', () => {
    // A host with a path would send the signatures this reader is probing for
    // to somewhere of the horizon-writer's choosing.
    const horizon = buildHorizon({
      follows: { r: { pubkey: K1, hosts: ['wss://relay.example.com', 'evil.example/collect?s=', 'ok.example.com'] } },
    })
    expect(horizon.publishers[0]?.hosts).toEqual(['ok.example.com'])
  })

  it('gives an entry with no usable key its OWN row rather than folding it away', () => {
    // N publishers in can never become fewer than N rows out — a fold is not
    // allowed to be the place an answer disappears.
    const horizon = buildHorizon({
      follows: { a: { pubkey: 'nope', hosts: ['a.example.com'] }, b: { pubkey: '', hosts: [] } },
      visits: [{ pubkey: K1, domain: 'one.com' }],
    })
    expect(horizon.publishers.length).toBeGreaterThanOrEqual(1)
    expect(horizon.publishers.some(p => p.pubkey === K1)).toBe(true)
  })

  it('an empty world produces an EMPTY horizon — a state, never an invented publisher', () => {
    expect(buildHorizon({}).publishers).toEqual([])
  })
})

describe('publishersFromCards — the community as a horizon', () => {
  it('every publisher a host lists becomes a row holding every door its creations answer on', () => {
    const P = 'e'.repeat(64), Q = 'f'.repeat(64)
    const rows = publishersFromCards([
      { pubkey: P, hosts: [{ host: 'revolucion.pluginthematrix.com' }, { host: 'revolucion.hypercomb.com' }] },
      { pubkey: P, hosts: [{ host: 'meetup.pluginthematrix.com' }] },
      { pubkey: Q, hosts: [{ host: 'susan.hypercomb.com' }] },
      { pubkey: 'not-a-key', hosts: [{ host: 'x.example' }] },
    ])
    expect(Object.keys(rows).sort()).toEqual([`ledger:${P}`, `ledger:${Q}`])
    expect(rows[`ledger:${P}`]!.hosts).toEqual(['revolucion.pluginthematrix.com', 'revolucion.hypercomb.com', 'meetup.pluginthematrix.com'])
    // and the horizon keeps those doors verbatim — the site door serves the index
    const horizon = buildHorizon({ follows: rows })
    expect(horizon.publishers.find(p => p.pubkey === P)?.hosts).toContain('revolucion.pluginthematrix.com')
  })
})
