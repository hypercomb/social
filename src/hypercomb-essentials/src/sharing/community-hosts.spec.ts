import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BINDING_ARTIFACT_KIND,
  HOST_ARTIFACT_KIND,
  HOST_FAMILY,
  COMMUNITY_HOSTS_POOL,
  bindingArtifactBytes,
  bindingArtifactRecord,
  bindingArtifactSig,
  bindingRecordsFromSiteBindings,
  canonicalJson,
  hostArtifactRecord,
  hostMeaning,
  hostSignature,
  hostZone,
  parseBindingRecord,
  zoneOfBindingMeaning,
  zoneOfHostMeaning,
} from './community-hosts.js'
import { familyOfMeaning } from '../pheromones/enrollment.js'
import { groupPreimage, registerPoolMeaning } from '@hypercomb/core'

const VECTOR_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'hypercomb-relay', 'blossom-worker', 'site-bindings.vector.json')
const VECTOR = JSON.parse(readFileSync(VECTOR_FILE, 'utf8')) as {
  poolAddresses: Record<string, string>
  zone: string
  siteBindings: Record<string, unknown>
  record: string
  recordSig: string
}

// ── the zone side (documentation/signed-site-bindings.md, Plan A) ──────────
describe('site bindings — the allowlist as content', () => {
  it('derives pool addresses exactly as the worker does, pinned by the shared vector', async () => {
    for (const [meaning, address] of Object.entries(VECTOR.poolAddresses)) {
      expect(await registerPoolMeaning(meaning)).toBe(address)
    }
  })

  it("encodes a zone's bindings to the vector's exact bytes and name", async () => {
    const records = bindingRecordsFromSiteBindings(VECTOR.siteBindings)
    expect([...records.keys()]).toEqual([VECTOR.zone])
    const sites = records.get(VECTOR.zone)!
    expect(new TextDecoder().decode(bindingArtifactBytes(VECTOR.zone, sites)!)).toBe(VECTOR.record)
    expect(await bindingArtifactSig(VECTOR.zone, sites)).toBe(VECTOR.recordSig)
  })

  it('is canonical: keys sorted at every depth, authored order kept, no wall clock', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 2 } })).toBe('{"a":{"c":2,"d":[3,{"y":2,"z":1}]},"b":1}')
    const shuffled = Object.fromEntries(Object.entries(VECTOR.siteBindings).map(([h, v]) => [h, Object.fromEntries(Object.entries(v as object).reverse())]))
    const sites = bindingRecordsFromSiteBindings(shuffled).get(VECTOR.zone)!
    expect(new TextDecoder().decode(bindingArtifactBytes(VECTOR.zone, sites)!)).toBe(VECTOR.record)
    expect(VECTOR.record).not.toMatch(/\d{10,}/)
  })

  it('splits a var by outermost zone and keeps each record to its own zone', () => {
    const records = bindingRecordsFromSiteBindings({
      'pluginthematrix.com': { lineage: 'pluginthematrix', publishers: [] },
      'meetup.pluginthematrix.com': { lineage: 'revolucion/meetup', publishers: [] },
      'hypercomb.com': { lineage: 'hypercomb', title: 'Hypercomb', routed: false, publishers: [] },
    })
    expect([...records.keys()]).toEqual(['pluginthematrix.com', 'hypercomb.com'])
    expect(records.get('pluginthematrix.com')!.map(s => s.host)).toEqual(['pluginthematrix.com', 'meetup.pluginthematrix.com'])
    expect(records.get('pluginthematrix.com')![1]!.title).toBe('meetup')
    expect(records.get('hypercomb.com')![0]).toMatchObject({ routed: false, wildcard: true })
    const record = bindingArtifactRecord('hypercomb.com', [...records.get('pluginthematrix.com')!, ...records.get('hypercomb.com')!])!
    expect((record['payload'] as { sites: { host: string }[] }).sites.map(s => s.host)).toEqual(['hypercomb.com'])
  })

  it('reads a record back, and refuses one that names another zone or another kind', () => {
    const parsed = parseBindingRecord(JSON.parse(VECTOR.record))!
    expect(parsed.zone).toBe(VECTOR.zone)
    expect(parsed.sites.map(s => s.host)).toEqual(['pluginthematrix.com', 'revolucion.pluginthematrix.com'])
    const record = JSON.parse(VECTOR.record)
    expect(parseBindingRecord({ ...record, meaning: 'binding:hypercomb.com' })).toBeNull()
    expect(parseBindingRecord({ ...record, kind: HOST_ARTIFACT_KIND })).toBeNull()
    expect(record.kind).toBe(BINDING_ARTIFACT_KIND)
  })

  it('a binding member never reads as a host, and a host member never as a binding', () => {
    expect(zoneOfHostMeaning('binding:hypercomb.com')).toBe('')
    expect(zoneOfBindingMeaning('host:hypercomb.com')).toBe('')
    expect(zoneOfBindingMeaning('binding:hypercomb.com')).toBe('hypercomb.com')
  })
})

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
