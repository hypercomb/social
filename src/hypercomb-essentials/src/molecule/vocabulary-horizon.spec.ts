// molecule/vocabulary-horizon.spec.ts
//
// THE ROUTING TABLE — pure, so this reads no localStorage, opens no pool and
// contacts no host.

import { describe, expect, it } from 'vitest'
import { buildHorizon, contentDoorOf } from './vocabulary-horizon.js'

const K1 = '1'.repeat(64)
const K2 = '2'.repeat(64)

describe('the doors', () => {
  it('turns a ZONE into its content door and never into itself', () => {
    expect(contentDoorOf('example.com')).toBe('content.example.com')
    expect(contentDoorOf('content.example.com')).toBe('content.example.com')
    expect(contentDoorOf('https://Example.com/')).toBe('content.example.com')
    expect(contentDoorOf('')).toBe('')
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
    expect(byKey.get(K1)).toEqual(['content.one.com'])
    expect(byKey.get(K2)).toEqual(['content.two.com'])
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
    expect(horizon.publishers[0]?.hosts).toEqual(['content.shared.example'])
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
