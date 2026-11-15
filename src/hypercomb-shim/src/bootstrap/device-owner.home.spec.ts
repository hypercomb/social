// device-owner.home.spec.ts — where a key-holding device signs a zone's showcase (jwize 2026-11-14: "I need the
// device that has a key to be able to update a shared community. Then either side if they have the key can add or
// remove items from the published list").
//
// jwize.com's apex is his home relay and answers with a stray copy of the index; every <name>.jwize.com reads the
// store written at pluginthematrix.com. A phone that signed at the apex wrote where no visitor reads. The home is
// the host serving the very index the zone's sites serve.
//
// The last case is LIVE and skipped unless HC_LIVE_ZONE and HC_LIVE_OWNER are set. It only reads:
//   HC_LIVE_ZONE=jwize.com HC_LIVE_OWNER=<pubkey> npx vitest run hypercomb-shim/src/bootstrap/device-owner.home.spec.ts   (from src/)

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { indexHomeFor } from './device-owner'

const ZONE = 'jwize.com'
const SITE = 'games.jwize.com'
const WRITER = 'pluginthematrix.com'
const hex = (bytes: Uint8Array) => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
const sha = async (data: string) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data))))

const secret = generateSecretKey()
const owner = getPublicKey(secret)
const signed = (roots: Record<string, string>, at: number) =>
  finalizeEvent({ kind: 30564, created_at: at, tags: [], content: JSON.stringify({ v: 1, roots }) }, secret) as unknown as Record<string, unknown>

/** host → the index it serves for the owner; a listed host with none answers 404, an unlisted host is down. */
const world = (hosts: Record<string, Record<string, unknown> | null>) => {
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = new URL(input)
    if (!(url.host in hosts)) throw new TypeError('down')
    const held = hosts[url.host]
    if (url.pathname === `/${await sha('hive:indexes')}/${owner}` && held) return new Response(JSON.stringify(held), { headers: { 'content-type': 'application/json' } })
    return new Response('', { status: 404 })
  }))
}

afterEach(() => { vi.unstubAllGlobals() })

describe('indexHomeFor — the showcase is signed where the zone\'s visitors read the index', () => {
  const store = signed({ games: 'a'.repeat(64) }, 1_794_707_812)
  const stray = signed({ 'list:x': 'b'.repeat(64) }, 1_794_645_082)

  it('skips the apex\'s stray copy and signs at the writer serving the sites\' index', async () => {
    world({ [ZONE]: stray, [SITE]: store, [WRITER]: store })
    expect(await indexHomeFor(ZONE, owner, [SITE, WRITER], [WRITER])).toBe(WRITER)
  })

  it('signs at the zone itself when it serves the same index', async () => {
    world({ [ZONE]: store, [SITE]: store })
    expect(await indexHomeFor(ZONE, owner, [SITE], [WRITER])).toBe(ZONE)
  })

  it('signs at the zone when no site holds an index (the first one starts there)', async () => {
    world({ [ZONE]: null, [SITE]: null, [WRITER]: store })
    expect(await indexHomeFor(ZONE, owner, [SITE], [WRITER])).toBe(ZONE)
  })

  it('writes nothing when no writer serves the visitors\' index', async () => {
    world({ [ZONE]: stray, [SITE]: store, [WRITER]: stray })
    expect(await indexHomeFor(ZONE, owner, [SITE], [WRITER])).toEqual({ split: SITE })
  })

  it('never asks a host outside the zone for the visitors\' index', async () => {
    world({ [ZONE]: stray, 'games.example.com': store, [WRITER]: store })
    expect(await indexHomeFor(ZONE, owner, ['games.example.com'], [WRITER])).toBe(ZONE)
  })
})

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}
describe.skipIf(!env['HC_LIVE_ZONE'] || !env['HC_LIVE_OWNER'])('live: where a phone would sign (read only)', () => {
  it('finds a home that serves the sites\' index, never a split', async () => {
    const zone = env['HC_LIVE_ZONE']!
    const ledger = await (await fetch(`https://${zone}/publications.json`)).json() as { sites: { host: string; hosts: { host: string }[] }[] }
    const hosts = ledger.sites.flatMap(site => [site.host, ...site.hosts.map(row => row.host)])
    const roots = hosts.filter(host => /^[a-z0-9-]+\.[a-z0-9-]+$/.test(host))
    const home = await indexHomeFor(zone, env['HC_LIVE_OWNER']!, hosts, roots)
    console.log('home', home)
    expect(typeof home).toBe('string')
  }, 60_000)
})
