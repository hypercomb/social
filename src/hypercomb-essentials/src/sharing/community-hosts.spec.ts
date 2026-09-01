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
