// update-sources.spec.ts — the hosts this device asks for the package: a
// managed site door's list, and everywhere else the carried hosts then the
// followed ones. A reader of the package's TypeScript asks these and no other.

import { describe, expect, it } from 'vitest'
import { managedSiteZone, packageHosts, updateSources } from './update-sources.js'

const storage = (value: string | null) => ({ getItem: () => value })
const follow = (hosts: string[]): string => JSON.stringify({ pubkey: 'b'.repeat(64), hosts })

describe('where an offered update is asked for', () => {
  it('names the zone a site door hangs off', () => {
    expect(managedSiteZone('business-card.jwize.com')).toBe('jwize.com')
    expect(managedSiteZone('BUSINESS-CARD.jwize.com:443')).toBe('jwize.com')
    expect(managedSiteZone('jwize.com')).toBe('jwize.com')
  })

  it('names the zone under a deep name: the host is the route, leaf first', () => {
    const deep = ['hyperdex', 'knowledge']
    expect(managedSiteZone('knowledge.hyperdex.jwize.com', deep)).toBe('jwize.com')
    expect(managedSiteZone('Knowledge.Hyperdex.jwize.com:443', deep)).toBe('jwize.com')
    expect(managedSiteZone('part.knowledge.hyperdex.jwize.com', ['hyperdex', 'knowledge', 'part'])).toBe('jwize.com')
    // An own address does not spell the route: it loses one label, as before.
    expect(managedSiteZone('card.jwize.com', deep)).toBe('jwize.com')
    // The route alone is no host under a zone.
    expect(managedSiteZone('knowledge.hyperdex', deep)).toBe('knowledge.hyperdex')
  })

  it('asks the site’s zone and the followed hosts, once each', () => {
    expect(updateSources('business-card.jwize.com', storage(follow(['hypercomb.com', 'jwize.com'])))).toEqual(['jwize.com', 'hypercomb.com'])
    expect(updateSources('business-card.jwize.com', storage('off'))).toEqual(['jwize.com'])
    expect(updateSources('business-card.jwize.com', null)).toEqual(['jwize.com'])
  })
})

describe('the hosts this device asks for the package', () => {
  it('is the door’s own list on a managed site door, and the carried hosts are not read', async () => {
    let asked = 0
    const hosts = await packageHosts({
      door: true, host: 'business-card.jwize.com', storage: storage(follow(['hypercomb.com'])),
      carried: async () => { asked++; return ['stranger.example'] },
    })
    expect(hosts).toEqual(updateSources('business-card.jwize.com', storage(follow(['hypercomb.com']))))
    expect(hosts).toEqual(['jwize.com', 'hypercomb.com'])
    expect(asked).toBe(0)
  })

  it('is the carried hosts, then the followed ones, once each, everywhere else', async () => {
    const hosts = await packageHosts({
      door: false, host: 'hive.example', storage: storage(follow(['hypercomb.com', 'jwize.com'])),
      carried: async () => ['jwize.com', ' friend.example '],
    })
    expect(hosts).toEqual(['jwize.com', 'friend.example', 'hypercomb.com'])
  })

  it('is empty when the follow is off and no host is carried', async () => {
    expect(await packageHosts({ door: false, host: 'hive.example', storage: storage('off'), carried: async () => [] })).toEqual([])
    expect(await packageHosts({ door: false, host: 'hive.example', storage: null, carried: async () => [] })).toEqual([])
  })

  it('never adds the page’s own host, and a carried list that cannot be read is no host', async () => {
    const hosts = await packageHosts({
      door: false, host: 'hive.example', storage: storage(follow(['hypercomb.com'])),
      carried: async () => { throw new Error('no pool') },
    })
    expect(hosts).toEqual(['hypercomb.com'])
    expect(hosts).not.toContain('hive.example')
  })
})
