// showcase-record.sites.spec.ts — a zone's sites answer where its apex holds
// no index (jwize 2026-11-13: "make sure our minimal version is able to get
// information from the subdomain. This would start from our community").
//
// jwize.com's apex is a home relay that keeps no index by design; every
// <name>.jwize.com is served from the store the index is written to. A
// visitor at jwize.com was shown "Nothing is published here yet." These cases
// hold the read that fixes it, and what it must never do: trust an address
// outside the zone, take an index that does not verify, or stop believing an
// apex that does answer.
//
// The last case is LIVE and skipped unless HC_LIVE_ZONE and HC_LIVE_OWNER are
// set. It only reads:
//   HC_LIVE_ZONE=jwize.com HC_LIVE_OWNER=<pubkey> HC_LIVE_SITES=games.jwize.com \
//     npx vitest run hypercomb-shim/src/bootstrap/showcase-record.sites.spec.ts   (from src/)

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readZoneOwners, showcaseBytes, showcaseKey, zoneSites, type ShowcaseRecord } from './showcase-record'

const ZONE = 'jwize.com'
const SITE = 'business-card.jwize.com'
const hex = (bytes: Uint8Array) => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
const sha = async (data: Uint8Array | string) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256',
  (typeof data === 'string' ? new TextEncoder().encode(data) : data) as BufferSource)))

const secret = generateSecretKey()
const owner = getPublicKey(secret)

const signedIndex = (content: Record<string, unknown>, by: Uint8Array = secret): Record<string, unknown> =>
  finalizeEvent({ kind: 30564, created_at: 1_794_000_000, tags: [], content: JSON.stringify(content) }, by) as unknown as Record<string, unknown>

/** The hosts of this world: host → path → what it answers. A host that is
 *  listed but has no entry for a path answers 404; an unlisted host is down. */
const world = (hosts: Record<string, Record<string, unknown>>) => {
  const asked: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = new URL(input)
    asked.push(`${url.host}${url.pathname}`)
    const held = hosts[url.host]
    if (!held) throw new TypeError('fetch failed')
    const body = held[url.pathname]
    if (body === undefined) return new Response('none held', { status: 404 })
    // isView, not instanceof: under jsdom the bytes can come from another realm.
    return new Response(ArrayBuffer.isView(body) ? new TextDecoder().decode(body) : typeof body === 'string' ? body : JSON.stringify(body))
  }))
  return asked
}

afterEach(() => { vi.unstubAllGlobals() })

describe('zoneSites — the addresses a zone’s index may be read from', () => {
  it('keeps names under the zone, each once, the first three, and nothing else', () => {
    expect(zoneSites(ZONE, [ZONE, 'games.jwize.com', 'Games.jwize.com', 'business-card.hypercomb.com', 'notjwize.com',
      'evil-jwize.com', 'meetups.jwize.com', 'hyperdex.jwize.com', 'fourth.jwize.com']))
      .toEqual(['games.jwize.com', 'meetups.jwize.com', 'hyperdex.jwize.com'])
    expect(zoneSites(ZONE, ['jwize.com.evil.example', 'not a host', ''])).toEqual([])
  })
})

describe('readZoneOwners — an apex that holds no index', () => {
  it('reads the owner’s index, doors and showcase from one of the zone’s own sites', async () => {
    const indexes = await sha('hive:indexes')
    const record: ShowcaseRecord = { zone: ZONE, items: [{ pubkey: owner, lineage: 'business-card' }], domains: [] }
    const bytes = showcaseBytes(record)
    const sig = await sha(bytes)
    const index = signedIndex({ v: 1, roots: { [showcaseKey(ZONE)]: sig }, doors: { 'business-card': [ZONE, 'hypercomb.com'] } })
    const asked = world({
      [ZONE]: {},                                             // the home relay: answers, holds none
      [SITE]: { [`/${indexes}/${owner}`]: index, [`/${sig}`]: bytes },
    })
    const read = await readZoneOwners(ZONE, [owner], [ZONE, 'business-card.hypercomb.com', SITE])
    expect(read.reached).toBe(true)
    expect(read.unreadable).toBe(false)
    expect(read.doors.get(owner)?.get('business-card')).toEqual([ZONE, 'hypercomb.com'])
    expect(read.showcase?.items).toEqual([{ pubkey: owner, lineage: 'business-card' }])
    expect(read.from).toBe(SITE)
    // The apex is asked first, and no address outside the zone is ever asked.
    expect(asked[0]).toBe(`${ZONE}/${indexes}/${owner}`)
    expect(asked.some(line => line.startsWith('business-card.hypercomb.com'))).toBe(false)
    // The showcase is read where the index was found.
    expect(asked).toContain(`${SITE}/${sig}`)
  })

  it('still shows nothing where no site of the zone holds an index either', async () => {
    world({ [ZONE]: {}, [SITE]: {} })
    const read = await readZoneOwners(ZONE, [owner], [SITE])
    expect(read.reached).toBe(true)                            // read, and the owner has signed nothing here
    expect(read.doors.size).toBe(0)
    expect(read.showcase).toBeNull()
  })

  it('does not take an index a site serves that the owner did not sign', async () => {
    const indexes = await sha('hive:indexes')
    const forged = signedIndex({ v: 1, roots: {}, doors: { everything: [ZONE] } }, generateSecretKey())
    world({ [ZONE]: {}, [SITE]: { [`/${indexes}/${owner}`]: forged } })
    const read = await readZoneOwners(ZONE, [owner], [SITE])
    expect(read.doors.size).toBe(0)
    expect(read.showcase).toBeNull()
  })

  it('believes an apex that answers: its sites are not asked', async () => {
    const indexes = await sha('hive:indexes')
    const apex = signedIndex({ v: 1, roots: {}, doors: { dylan: [ZONE] } })
    const other = signedIndex({ v: 1, roots: {}, doors: { 'business-card': [ZONE] } })
    const asked = world({ [ZONE]: { [`/${indexes}/${owner}`]: apex }, [SITE]: { [`/${indexes}/${owner}`]: other } })
    const read = await readZoneOwners(ZONE, [owner], [SITE])
    expect([...read.doors.get(owner)!.keys()]).toEqual(['dylan'])
    expect(read.from).toBeUndefined()
    expect(asked.some(line => line.startsWith(SITE))).toBe(false)
  })

  it('an apex that cannot be read is unknown, never answered by a site', async () => {
    const indexes = await sha('hive:indexes')
    const other = signedIndex({ v: 1, roots: {}, doors: { 'business-card': [ZONE] } })
    const asked = world({ [SITE]: { [`/${indexes}/${owner}`]: other } })   // the apex is down
    const read = await readZoneOwners(ZONE, [owner], [SITE])
    expect(read.reached).toBe(false)
    expect(read.doors.size).toBe(0)
    expect(asked.some(line => line.startsWith(SITE))).toBe(false)
  })
})

describe('the front door — the zone’s own names come from where its index lives', () => {
  it('takes the site’s ledger for names under the zone, and keeps everything else as the apex said', async () => {
    const { parseLedger, showcase } = await import('./showcase')
    const head = (ch: string) => ch.repeat(64)
    const entry = (host: string, lineage: string, h: string, hosts: string[] = []) => ({ host, url: `https://${host}/`, title: lineage, lineage,
      hosts: hosts.map(name => ({ host: name, url: `https://${name}/`, primary: false, implicit: true })),
      publishers: [{ pubkey: owner, label: 'Jaime', primary: true, head: h, publishedAt: 1 }] })
    const root = { host: ZONE, url: `https://${ZONE}/`, title: 'jwize', lineage: ZONE, hosts: [], publishers: [{ pubkey: owner, label: 'Jaime', primary: true, head: null }] }
    // The apex's list: an older head for the card, a tile the store no longer has, and another domain's site.
    const apex = parseLedger({ sites: [root, entry('business-card.hypercomb.com', 'business-card', head('b'), [SITE]),
      entry('gone.jwize.com', 'gone', head('9')), entry('elsewhere.example', 'elsewhere', head('e'))] })
    // The site's list: the card as it is now, a second tile, and a claim about another domain that must not be taken.
    const theirs = parseLedger({ sites: [root, entry(SITE, 'business-card', head('1')), entry('games.jwize.com', 'games', head('2')),
      entry('elsewhere.example', 'forged', head('f'))] })
    const asked: string[] = []
    const { bands } = showcase({
      self: ZONE, groups: true, title: ZONE, tagline: '', sources: [],
      ledger: Promise.resolve(apex), readShared: async () => ({ offers: [], creations: [] }),
      readOwners: async () => ({ showcase: null, reached: true, unreadable: false, from: SITE,
        doors: new Map([[owner, new Map([['business-card', [ZONE]], ['games', [ZONE]], ['gone', [ZONE]]])]]),
        live: new Set([head('1'), head('2')]) }),
      readLedgerAt: async host => { asked.push(host); return theirs },
    })
    const names = (): string[] => [...bands.querySelectorAll('.dex-row.own .hex-name')].map(name => name.textContent ?? '')
    await vi.waitFor(() => expect(names().sort()).toEqual(['business-card', 'games']))
    expect(asked).toEqual([SITE])
    expect(bands.textContent).not.toContain('forged')
  })

  it('asks no site where the zone answered for itself', async () => {
    const { parseLedger, showcase } = await import('./showcase')
    const apex = parseLedger({ sites: [{ host: ZONE, url: `https://${ZONE}/`, title: 'jwize', lineage: ZONE, hosts: [],
      publishers: [{ pubkey: owner, label: 'Jaime', primary: true, head: null }] }] })
    let asked = 0
    let read = 0
    showcase({
      self: ZONE, groups: true, title: ZONE, tagline: '', sources: [],
      ledger: Promise.resolve(apex), readShared: async () => ({ offers: [], creations: [] }),
      readOwners: async () => { read++; return { showcase: null, reached: true, unreadable: false, doors: new Map() } },
      readLedgerAt: async () => { asked++; return [] },
    })
    await vi.waitFor(() => expect(read).toBe(1))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(asked).toBe(0)
  })
})

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}
const LIVE_ZONE = env['HC_LIVE_ZONE'] ?? ''
const LIVE_OWNER = env['HC_LIVE_OWNER'] ?? ''

describe.skipIf(!LIVE_ZONE || !LIVE_OWNER)(`live (read only): ${LIVE_ZONE || 'a zone'}’s owner is read from its sites`, () => {
  it('finds the owner’s doors where the apex alone finds none', async () => {
    // The addresses the zone's own ledger names, as the front door hands them in; HC_LIVE_SITES overrides.
    const { parseLedger } = await import('./showcase')
    const named = parseLedger(await (await fetch(`https://${LIVE_ZONE}/publications.json`, { cache: 'no-store' })).json()).flatMap(site => site.hosts)
    const sites = env['HC_LIVE_SITES'] ? env['HC_LIVE_SITES'].split(',').map(site => site.trim()).filter(Boolean) : named
    const apexOnly = await readZoneOwners(LIVE_ZONE, [LIVE_OWNER])
    const withSites = await readZoneOwners(LIVE_ZONE, [LIVE_OWNER], sites)
    const here = [...(withSites.doors.get(LIVE_OWNER)?.entries() ?? [])].filter(([, doors]) => doors.includes(LIVE_ZONE)).map(([lineage]) => lineage)
    console.log(JSON.stringify({ zone: LIVE_ZONE, apexOnly: { reached: apexOnly.reached, owners: apexOnly.doors.size },
      withSites: { reached: withSites.reached, owners: withSites.doors.size, showcase: withSites.showcase ? withSites.showcase.items.length : null,
        live: withSites.live?.size ?? null, opensHere: here } }))
    expect(withSites.reached).toBe(true)
    expect(withSites.doors.get(LIVE_OWNER)).toBeDefined()
  }, 60_000)

  it('draws the zone’s own row from its real ledgers, the way the front door does', async () => {
    const { readLedgerAt, parseLedger, showcase } = await import('./showcase')
    const ledger = parseLedger(await (await fetch(`https://${LIVE_ZONE}/publications.json`, { cache: 'no-store' })).json())
    const { bands } = showcase({
      self: LIVE_ZONE, groups: true, title: LIVE_ZONE, tagline: '', sources: [],
      ledger: Promise.resolve(ledger), readShared: async () => ({ offers: [], creations: [] }), readOwners: readZoneOwners, readLedgerAt,
    })
    const names = (): string[] => [...bands.querySelectorAll('.dex-row.own .hex-name')].map(name => name.textContent ?? '')
    const want = env['HC_LIVE_TILE'] ?? ''
    await vi.waitFor(() => { expect(names().length).toBeGreaterThan(0); if (want) expect(names()).toContain(want) }, { timeout: 30_000, interval: 250 })
    console.log(JSON.stringify({ drawn: names() }))
  }, 60_000)
})
