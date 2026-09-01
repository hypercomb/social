import { describe, it, expect } from 'vitest'
import {
  HOST_ARTIFACT_KIND,
  HOST_FAMILY,
  COMMUNITY_HOSTS_POOL,
  hostArtifactRecord,
  hostMeaning,
  hostSignature,
  hostZone,
  zoneOfHostMeaning,
} from './community-hosts.js'
import { familyOfMeaning } from '../pheromones/enrollment.js'
import { groupPreimage } from '@hypercomb/core'

describe('community hosts — the identity half', () => {
  it('folds scheme, case, path and the content. plumbing out of a zone', () => {
    for (const raw of [
      'hypercomb.com', 'HYPERCOMB.com', ' hypercomb.com ', 'https://hypercomb.com',
      'https://hypercomb.com/', 'content.hypercomb.com', 'https://content.hypercomb.com/x?y#z',
      'hypercomb.com.',
    ]) {
      expect(hostZone(raw)).toBe('hypercomb.com')
    }
  })

  it('refuses anything that is not a hostname, so a typo mints no group', () => {
    for (const raw of ['', '   ', 'hypercomb', 'not a host', 'http://', '../etc', 'a..b', null, undefined]) {
      expect(hostZone(raw)).toBe('')
      expect(hostMeaning(raw)).toBe('')
    }
    // A MISSPELLED host is still a host — it is deletable, not unmintable.
    expect(hostZone('hyperccomb.com')).toBe('hyperccomb.com')
  })

  it('scopes the meaning to the family, so it can never collide with a bag', () => {
    expect(hostMeaning('hypercomb.com')).toBe('host:hypercomb.com')
    expect(familyOfMeaning(hostMeaning('hypercomb.com'))).toBe(HOST_FAMILY)
    expect(hostMeaning('hypercomb.com')).toContain(':')
    expect(COMMUNITY_HOSTS_POOL).toContain(':')
  })

  it('round-trips a meaning back to a hostname you can visit', () => {
    for (const zone of ['hypercomb.com', 'plugin-the-matrix.co.uk', 'a.b.c.example.com']) {
      expect(zoneOfHostMeaning(hostMeaning(zone))).toBe(zone)
    }
    expect(zoneOfHostMeaning('site:pitch')).toBe('')
    expect(zoneOfHostMeaning('')).toBe('')
  })

  it('is a referent: the group signature is derived from the meaning alone', async () => {
    expect(groupPreimage(hostMeaning('hypercomb.com'))).toBe('group:host:hypercomb.com')
    const a = await hostSignature('https://CONTENT.hypercomb.com/')
    const b = await hostSignature('hypercomb.com')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(await hostSignature('nonsense')).toBe('')
  })

  it('names the artifact with the family kind and carries no wall clock', () => {
    const record = hostArtifactRecord('hypercomb.com')
    expect(record['kind']).toBe(HOST_ARTIFACT_KIND)
    expect(HOST_ARTIFACT_KIND).toBe('visual:host:artifact')
    expect(JSON.stringify(record)).toBe(JSON.stringify(hostArtifactRecord('https://hypercomb.com/')))
    expect(JSON.stringify(record)).not.toMatch(/at"|createdAt|Date/)
  })
})

// The shim and the app write the SAME `community:hosts` pool by address, so
// they must agree byte-for-byte on what a host IS. They did not: the shim
// accepted `localhost:4270` and the app silently refused it, which made the
// one host a participant is most certain about — the one on their own machine
// — unaddable from the app.
describe('hostZone matches the shim', () => {
  it('carries loopback with a port, so a node can name itself', () => {
    expect(hostZone('localhost:4270')).toBe('localhost:4270')
    expect(hostZone('http://localhost:4270/')).toBe('localhost:4270')
    expect(hostZone('127.0.0.1:4270')).toBe('127.0.0.1:4270')
  })

  it('carries a port on a real zone too', () => {
    expect(hostZone('example.com:8443')).toBe('example.com:8443')
  })

  it('still refuses what is not a host', () => {
    expect(hostZone('not a host')).toBe('')
    expect(hostZone('')).toBe('')
    expect(hostZone('localhost:999999')).toBe('')
  })

  it('still folds scheme, case, path and content. plumbing', () => {
    expect(hostZone('https://CONTENT.Jwize.com/x')).toBe('jwize.com')
  })
})
