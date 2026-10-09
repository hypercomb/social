// sharing/zone-door.spec.ts — THE ROOT IS THE DOOR (jwize 2026-10-03).
//
// Writes go to the zone root; the `content.<zone>` face is retired as a write
// target. A stored setting from before the retirement is READ as its zone, so
// an updated hive keeps publishing to the same place with no action; reads of
// old published data may still fall back to the content face after the root.
// A creation lives at its zone's root path, or at an own address the signed
// index gives it — and every index write carries those addresses through.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'

const SECRET = new Uint8Array(32).fill(9)
const PUB = getPublicKey(SECRET)
const HEAD = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)

const registry = new Map<string, unknown>()
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registry.set(key, value) },
  get: (key: string) => registry.get(key),
  whenReady: () => undefined,
}
registry.set('@diamondcoreprocessor.com/NostrSigner', {
  signEvent: async (evt: { kind: number; created_at: number; tags: string[][]; content: string }) => finalizeEvent(evt, SECRET),
  getPublicKeyHex: async () => PUB,
})

const zone = await import('./zone-door.js')
const pointer = await import('./hive-pointer.js')
const { PUBLIC_CONTENT_HOSTS } = await import('./hive-link.js')

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks() })

describe('the write door is the zone root', () => {
  it('folds a leading content. label away — scheme, path, @ and case too', () => {
    expect(zone.zoneDoor('content.pluginthematrix.com')).toBe('pluginthematrix.com')
    expect(zone.zoneDoor('https://Content.CafeSociety.buzz/x')).toBe('cafesociety.buzz')
    expect(zone.zoneDoor('@content.example.org')).toBe('example.org')
    expect(zone.zoneDoor('pluginthematrix.com')).toBe('pluginthematrix.com')
  })

  it('leaves a domain that merely starts with content alone, and loopback stays a machine', () => {
    expect(zone.zoneDoor('content.com')).toBe('content.com')
    expect(zone.zoneDoor('localhost:4291')).toBe('localhost:4291')
    expect(zone.zoneDoor('content.localhost:4291')).toBe('localhost:4291')
  })

  it('the standing public endpoint is the worker root', () => {
    expect(PUBLIC_CONTENT_HOSTS).toEqual(['pluginthematrix.com'])
  })
})

describe('reads fall back to the retired content face — after every root', () => {
  it('asks each root first, then each old face, never for loopback', () => {
    expect(zone.readDoorsOf(['pluginthematrix.com'])).toEqual(['pluginthematrix.com', 'content.pluginthematrix.com'])
    expect(zone.readDoorsOf(['content.example.com', 'jwize.com', 'localhost:4270']))
      .toEqual(['example.com', 'jwize.com', 'localhost:4270', 'content.example.com', 'content.jwize.com'])
    expect(zone.legacyContentFace('localhost:4270')).toBe('')
  })

  it('a reader still finds an index only the old content face holds', async () => {
    const event = finalizeEvent({ kind: 30564, created_at: 1_700_000_000, tags: [],
      content: JSON.stringify({ v: 1, roots: { site: HEAD } }) }, SECRET)
    const asked: string[] = []
    globalThis.fetch = vi.fn(async (url: string) => {
      asked.push(new URL(url).host)
      return new URL(url).host.startsWith('content.') ? Response.json(event) : new Response(null, { status: 404 })
    }) as unknown as typeof fetch
    const manifest = await pointer.fetchHiveManifestFromAny(['example.com'], PUB)
    expect(manifest?.roots).toEqual({ site: HEAD })
    expect(asked).toEqual(['example.com', 'content.example.com'])
  })
})

describe('where a creation lives', () => {
  it('by default at the zone root path', () => {
    expect(zone.rootPathUrl('cafesociety.buzz', ['honey-garden', 'rituals'])).toBe('https://cafesociety.buzz/honey-garden/rituals')
    expect(zone.rootPathUrl('content.cafesociety.buzz', ['honey garden'])).toBe('https://cafesociety.buzz/honey%20garden')
    expect(zone.rootPathUrl('cafesociety.buzz', [])).toBe('https://cafesociety.buzz')
    expect(zone.rootPathUrl('localhost:4291', ['a'])).toBe('http://localhost:4291/a')
  })

  it('at its own address once the signed index gives it one on that zone — and only there', () => {
    const addresses = { 'rituals.cafesociety.buzz': 'honey-garden/rituals' }
    expect(zone.creationUrl('cafesociety.buzz', ['honey-garden', 'rituals'], 'honey-garden/rituals', addresses))
      .toBe('https://rituals.cafesociety.buzz')
    expect(zone.creationUrl('pluginthematrix.com', ['honey-garden', 'rituals'], 'honey-garden/rituals', addresses))
      .toBe('https://pluginthematrix.com/honey-garden/rituals')
    expect(zone.creationUrl('cafesociety.buzz', ['shop'], 'shop', addresses)).toBe('https://cafesociety.buzz/shop')
    expect(zone.ownLabelOn(addresses, 'cafesociety.buzz', 'honey-garden/rituals')).toBe('rituals')
  })
})

describe('the own-address label', () => {
  it('defaults to the tile name folded to a DNS label', () => {
    expect(zone.foldDnsLabel('Rituals')).toBe('rituals')
    expect(zone.foldDnsLabel('Café Société!')).toBe('cafe-societe')
    expect(zone.foldDnsLabel('  --honey  garden--  ')).toBe('honey-garden')
    expect(zone.foldDnsLabel('x'.repeat(80))).toHaveLength(63)
    expect(zone.foldDnsLabel('☕')).toBe('')
  })

  it('refuses what is not a DNS label, and the reserved content and try-*', () => {
    expect(zone.ownAddressRefusal('rituals')).toBe('')
    expect(zone.ownAddressRefusal('a')).toBe('')
    expect(zone.ownAddressRefusal('tea-2')).toBe('')
    expect(zone.ownAddressRefusal('Tea')).toBe('not-a-label')
    expect(zone.ownAddressRefusal('-tea')).toBe('not-a-label')
    expect(zone.ownAddressRefusal('tea-')).toBe('not-a-label')
    expect(zone.ownAddressRefusal('tea.rituals')).toBe('not-a-label')
    expect(zone.ownAddressRefusal('x'.repeat(64))).toBe('not-a-label')
    expect(zone.ownAddressRefusal('')).toBe('not-a-label')
    expect(zone.ownAddressRefusal('content')).toBe('reserved')
    expect(zone.ownAddressRefusal('host')).toBe('reserved')
    expect(zone.ownAddressRefusal('try-rituals')).toBe('reserved')
    expect(zone.ownAddressHost('content', 'cafesociety.buzz')).toBe('')
    expect(zone.ownAddressHost('tea', 'localhost:4291')).toBe('')
  })

  it('setting replaces the creation\'s entry on that zone; null drops it; one host names one creation', () => {
    const start = { 'old.cafesociety.buzz': 'k', 'shop.cafesociety.buzz': 'other', 'k.example.org': 'k' }
    expect(zone.withOwnAddress(start, 'cafesociety.buzz', 'k', 'tea'))
      .toEqual({ 'shop.cafesociety.buzz': 'other', 'k.example.org': 'k', 'tea.cafesociety.buzz': 'k' })
    expect(zone.withOwnAddress(start, 'cafesociety.buzz', 'k', null))
      .toEqual({ 'shop.cafesociety.buzz': 'other', 'k.example.org': 'k' })
    expect(zone.withOwnAddress(start, 'cafesociety.buzz', 'k', 'shop'))
      .toEqual({ 'k.example.org': 'k', 'shop.cafesociety.buzz': 'k' })
  })

  it('reads the signed map leniently: a bad entry or an unpublished key drops alone', () => {
    const roots = { k: HEAD }
    expect(zone.readAddresses({
      'tea.cafesociety.buzz': 'k',
      'content.cafesociety.buzz': 'k',
      'try-x.cafesociety.buzz': 'k',
      'gone.cafesociety.buzz': 'not-published',
      'Bad Host': 'k',
    }, roots)).toEqual({ 'tea.cafesociety.buzz': 'k' })
    expect(zone.readAddresses([], roots)).toEqual({})
  })
})

describe('the signed index carries addresses through every write', () => {
  let puts: { url: string; content: Record<string, unknown> }[]
  beforeEach(() => {
    puts = []
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const evt = JSON.parse(String(init.body)) as { content: string }
        puts.push({ url, content: JSON.parse(evt.content) as Record<string, unknown> })
        return new Response(null, { status: 200 })
      }
      return new Response(null, { status: 404 })
    }) as unknown as typeof fetch
  })

  it('a roots/doors write keeps the addresses of every key it still names, at the zone root', async () => {
    const previous = { v: 1, roots: { k: HEAD, other: OTHER }, addresses: { 'tea.cafesociety.buzz': 'k', 'shop.cafesociety.buzz': 'other' } }
    const put = await pointer.putHiveManifest('cafesociety.buzz', { k: HEAD, other: OTHER }, {}, 0, previous)
    expect(put.ok).toBe(true)
    expect(new URL(puts[0]!.url).host).toBe('cafesociety.buzz')
    expect(puts[0]!.content['addresses']).toEqual({ 'tea.cafesociety.buzz': 'k', 'shop.cafesociety.buzz': 'other' })
  })

  it('a key the write no longer names loses its address; none left, the field is omitted', async () => {
    const previous = { v: 1, roots: { k: HEAD }, addresses: { 'tea.cafesociety.buzz': 'k' } }
    await pointer.putHiveManifest('cafesociety.buzz', { other: OTHER }, {}, 0, previous)
    expect('addresses' in puts[0]!.content).toBe(false)
  })

  it('setHiveRoot (install stamps) carries them untouched', async () => {
    const signedContent = { v: 1, roots: { k: HEAD }, addresses: { 'tea.cafesociety.buzz': 'k' } }
    const read = { ok: true as const, manifest: { roots: { k: HEAD }, createdAt: 1, pubkey: PUB, signedContent } }
    const out = await pointer.setHiveRoot('pluginthematrix.com', 'install:essentials', OTHER, {
      publicKey: async () => PUB, fetchIndex: async () => read,
    })
    expect(out.ok).toBe(true)
    expect(puts[0]!.content['addresses']).toEqual({ 'tea.cafesociety.buzz': 'k' })
  })

  it('a verified read hands the addresses back on the manifest', async () => {
    const event = finalizeEvent({ kind: 30564, created_at: 1_700_000_000, tags: [], content: JSON.stringify({
      v: 1, roots: { k: HEAD }, addresses: { 'tea.cafesociety.buzz': 'k', 'x.cafesociety.buzz': 'nope' },
    }) }, SECRET)
    globalThis.fetch = vi.fn(async () => Response.json(event)) as unknown as typeof fetch
    const read = await pointer.fetchHiveIndex('cafesociety.buzz', PUB)
    expect(read.ok && read.manifest.addresses).toEqual({ 'tea.cafesociety.buzz': 'k' })
  })
})

describe('stored settings carry over on update — folded on read, never rewritten', () => {
  beforeEach(() => { localStorage.clear() })

  it('hc:public-host:domain stored as content.<zone> publishes to <zone>', async () => {
    const { hostSyncService } = await import('./host-sync.service.js')
    expect(hostSyncService.defaultPublicHostDomain()).toBe('pluginthematrix.com')
    expect(hostSyncService.publicHostDomain()).toBe('pluginthematrix.com')
    localStorage.setItem('hc:public-host:domain', 'content.cafesociety.buzz')
    expect(hostSyncService.publicHostDomain()).toBe('cafesociety.buzz')
    // Read-only: the stored value is untouched until the participant sets one.
    expect(localStorage.getItem('hc:public-host:domain')).toBe('content.cafesociety.buzz')
    expect(hostSyncService.setPublicHostDomain('content.example.org')).toBe(true)
    expect(localStorage.getItem('hc:public-host:domain')).toBe('example.org')
  })

  it('the AI host: default is the worker root, a content. override asks the root', async () => {
    const { AI_HOST_DEFAULT, AI_HOST_STORAGE_KEY, HostAiService } = await import('../assistant/host-ai.service.js')
    const service = new HostAiService()
    expect(AI_HOST_DEFAULT).toBe('pluginthematrix.com')
    expect(service.host).toBe('pluginthematrix.com')
    localStorage.setItem(AI_HOST_STORAGE_KEY, 'content.jwize.com')
    expect(service.host).toBe('jwize.com')
    expect(localStorage.getItem(AI_HOST_STORAGE_KEY)).toBe('content.jwize.com')
    service.setHost('https://content.example.org/')
    expect(localStorage.getItem(AI_HOST_STORAGE_KEY)).toBe('example.org')
  })

  it('an install follow record naming content.<zone> follows <zone>', async () => {
    const { readInstallFollow } = await import('./update-scout.service.js')
    const storage = { getItem: () => JSON.stringify({ pubkey: HEAD, hosts: ['content.pluginthematrix.com', 'pluginthematrix.com'] }) }
    expect(readInstallFollow(storage)?.hosts).toEqual(['pluginthematrix.com'])
  })

  it('a domain claim kept on content.<zone> is watched on <zone>', async () => {
    const { claimHost } = await import('./domain-claim.js')
    expect(claimHost('content.hypercomb.com')).toBe('hypercomb.com')
  })
})

// ── the Publish panel's own-address words, in every language ──────────
describe('publish.own.* — catalog parity', () => {
  const DIR = join(__dirname, '../../../hypercomb-shared/i18n')
  const catalogs = readdirSync(DIR).filter(f => f.endsWith('.json'))
  const read = (file: string) => JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Record<string, string>
  const reference = read('en.json')
  const keys = Object.keys(reference).filter(k => k.startsWith('publish.own.'))
  const placeholders = (text: string): string[] => [...new Set(text.match(/\{[a-zA-Z]+\}/g) ?? [])].sort()

  it('finds all fourteen catalogs and the keys to compare', () => {
    expect(catalogs.length).toBeGreaterThanOrEqual(14)
    expect(keys.length).toBe(13)
  })

  for (const file of catalogs) {
    if (file === 'en.json') continue
    it(`${file} carries every publish.own.* key, non-empty, translated, placeholders intact`, () => {
      const json = read(file)
      expect(keys.filter(k => typeof json[k] !== 'string' || !json[k]!.trim())).toEqual([])
      expect(keys.filter(k => placeholders(reference[k]!).join() !== placeholders(json[k]!).join())).toEqual([])
      expect(keys.filter(k => json[k] === reference[k])).toEqual([])
    })
  }
})

describe('the domain itself as an own address', () => {
  it('is `@`, the apex: the bare domain opens on the creation', () => {
    expect(zone.ownAddressRefusal('@')).toBe('')
    expect(zone.ownAddressHost('@', 'pointblanksolutions.ca')).toBe('pointblanksolutions.ca')
    expect(zone.ownAddressHost('@', 'localhost:4291')).toBe('')
    const addresses = zone.withOwnAddress({ 'shop.pointblanksolutions.ca': 'site' }, 'pointblanksolutions.ca', 'site', '@')
    expect(addresses).toEqual({ 'pointblanksolutions.ca': 'site' })
    expect(zone.ownLabelOn(addresses, 'pointblanksolutions.ca', 'site')).toBe('@')
    expect(zone.creationUrl('pointblanksolutions.ca', ['site'], 'site', addresses)).toBe('https://pointblanksolutions.ca')
    expect(zone.readAddresses(addresses, { site: 'a'.repeat(64) })).toEqual(addresses)
  })

  it('names one creation; giving it to another moves it, and null takes it back', () => {
    const start = { 'pointblanksolutions.ca': 'old' }
    expect(zone.withOwnAddress(start, 'pointblanksolutions.ca', 'new', '@')).toEqual({ 'pointblanksolutions.ca': 'new' })
    expect(zone.withOwnAddress(start, 'pointblanksolutions.ca', 'old', null)).toEqual({})
  })
})
