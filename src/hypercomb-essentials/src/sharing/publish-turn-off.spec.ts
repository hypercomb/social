// publish-turn-off.spec.ts — an owner turns a publish off from a front door.
//
// The front door hands the hive public coordinates; the hive decodes them
// here, believes only what survives, and rewrites ONLY doors[key] — the head
// stays published, so turning off is reversible. A key that is not the
// hive's, a head the index has moved past, and an index nobody could read
// are refused before anything is signed.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HiveIndexResult, PutHiveResult } from './hive-pointer.js'

const PUB = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)
const HEAD = 'c'.repeat(64)

let index: { roots: Record<string, string>; doors?: Record<string, string[]> } | null = null
let puts: { host: string; roots: Record<string, string>; doors: Record<string, readonly string[]> }[] = []

vi.mock('./hive-pointer.js', () => ({
  nip98Header: async () => 'Nostr test',
  fetchHiveIndex: async (): Promise<HiveIndexResult> => (index
    ? { ok: true, manifest: { roots: { ...index.roots }, ...(index.doors ? { doors: { ...index.doors } } : {}),
      createdAt: 1_700_000_000, pubkey: PUB } } as HiveIndexResult
    : { ok: false, reason: 'http', status: 404 } as HiveIndexResult),
  fetchHiveManifest: async () => null,
  fetchHiveManifestFromAny: async () => null,
  putHiveManifest: async (host: string, roots: Record<string, string>, doors: Record<string, readonly string[]>): Promise<PutHiveResult> => {
    puts.push({ host, roots: { ...roots }, doors: { ...doors } })
    return { ok: true, pubkey: PUB, createdAt: 1_700_000_001 } as PutHiveResult
  },
}))

;(window as unknown as { ioc: unknown }).ioc = {
  register: () => void 0,
  get: (key: string): unknown => {
    if (key === '@hypercomb.social/Store') return { putResource: async () => 'd'.repeat(64) }
    if (key === '@diamondcoreprocessor.com/HostSyncService') {
      return { isEnabled: () => false, isPublicHostEnabled: () => true, publicHostDomain: () => 'hypercomb.com', markPublic: async () => void 0, addPublishNodes: () => void 0 }
    }
    if (key === '@diamondcoreprocessor.com/NostrSigner') return { getPublicKeyHex: async () => PUB, knownPublicKeyHex: async () => PUB }
    return undefined
  },
}

const { setHiveDoors } = await import('./publish-branch.js')
const { backUrl, decodeTurnOff, nextDoors, openZonesOf, parseTurnOff, TURN_OFF_PREFIX } = await import('./publish-turn-off.js')
// The front door's own encoder, loaded at run time (it sits outside this
// package's rootDir): the contract is that the hive decodes what it encodes.
const SHIM_LINK = '../../../hypercomb-shim/src/bootstrap/turn-off-link'
const { turnOffHref } = await import(/* @vite-ignore */ SHIM_LINK) as {
  turnOffHref: (home: unknown, link: Record<string, string>) => string | null }

beforeEach(() => {
  index = null
  puts = []
})

const request = { title: 'dylan', lineage: 'dylan', publisher: PUB, zone: 'hypercomb.com',
  scope: 'here' as const, head: HEAD, back: 'https://hypercomb.com/' }

describe('the hand-off — what a front door may say to a hive', () => {
  it('decodes exactly what the front door\'s link carries', () => {
    const href = turnOffHref('http://localhost:4250', request)!
    expect(href.startsWith(`http://localhost:4250/${TURN_OFF_PREFIX}`)).toBe(true)
    expect(decodeTurnOff(href.slice(href.indexOf('#')))).toEqual({ v: 1, ...request })
  })

  it('believes nothing that does not survive its check', () => {
    expect(parseTurnOff({ v: 1, ...request, publisher: 'nope' })).toBeNull()
    expect(parseTurnOff({ v: 1, ...request, head: 'x'.repeat(64) })).toBeNull()
    expect(parseTurnOff({ v: 1, ...request, scope: 'all' })).toBeNull()
    expect(parseTurnOff({ v: 1, ...request, lineage: 'stage:live' })).toBeNull()
    expect(parseTurnOff({ v: 2, ...request })).toBeNull()
    expect(decodeTurnOff('#turn-off=not-base64-json')).toBeNull()
    // A title is words to ask with, never markup or a bidi trick.
    expect(parseTurnOff({ v: 1, ...request, title: 'dy‮lan' })?.title).toBe('dylan')
  })

  it('goes back only to the row\'s own domain', () => {
    expect(backUrl('https://hypercomb.com/anything?x=1', 'hypercomb.com')).toBe('https://hypercomb.com/')
    expect(backUrl('https://host.pointblanksolutions.ca/', 'pointblanksolutions.ca')).toBe('https://host.pointblanksolutions.ca/')
    expect(backUrl('https://evil.example/', 'hypercomb.com')).toBeNull()
    expect(backUrl('https://hypercomb.com.evil.example/', 'hypercomb.com')).toBeNull()
    expect(backUrl('http://hypercomb.com/', 'hypercomb.com')).toBeNull()
    expect(backUrl('https://user:pw@hypercomb.com/', 'hypercomb.com')).toBeNull()
    expect(parseTurnOff({ v: 1, ...request, back: 'https://evil.example/' })).toBeNull()
  })
})

describe('the shell\'s capture mirrors these literals', () => {
  it('stashes under the same key, from the same fragment, on the same channel', async () => {
    const { readFileSync } = await import('node:fs')
    const { TURN_OFF_CHANNEL, PENDING_TURN_OFF_KEY } = await import('./publish-turn-off.js')
    // The suite runs from src/ (the monorepo root vitest).
    const capture = readFileSync('hypercomb-shared/core/invite-capture.ts', 'utf8')
    expect(capture).toContain(`const TURN_OFF_PREFIX = '${TURN_OFF_PREFIX}'`)
    expect(capture).toContain(`const PENDING_TURN_OFF_KEY = '${PENDING_TURN_OFF_KEY}'`)
    expect(capture).toContain(`const TURN_OFF_CHANNEL = '${TURN_OFF_CHANNEL}'`)
    // Stored, never transient: the bus must replay the wake to a sleeping bee.
    expect(capture).not.toMatch(/emitTransient\(\s*'publish:turn-off'/)
  })
})

describe('nextDoors — what the turn-off writes', () => {
  it('takes this domain out, with anything under it, and keeps the rest', () => {
    expect(nextDoors(['hypercomb.com', 'jwize.com', 'dylan.hypercomb.com'], undefined, 'hypercomb.com', 'here')).toEqual(['jwize.com'])
  })
  it('writes the list the ledger read when the index names none, and refuses to guess without one', () => {
    expect(nextDoors(undefined, ['hypercomb.com', 'realones.online'], 'hypercomb.com', 'here')).toEqual(['realones.online'])
    expect(nextDoors(undefined, undefined, 'hypercomb.com', 'here')).toBeNull()
  })
  it('closes every domain for everywhere', () => {
    expect(nextDoors(['hypercomb.com'], undefined, 'hypercomb.com', 'everywhere')).toEqual([])
  })
})

describe('openZonesOf — where the ledger shows a publish open', () => {
  it('names each domain the publisher\'s site answers on', () => {
    const ledger = { sites: [
      { host: 'hypercomb.com', publishers: [] }, { host: 'jwize.com', publishers: [] },
      { host: 'dylan.jwize.com', lineage: 'dylan', hosts: [{ host: 'dylan.hypercomb.com' }],
        publishers: [{ pubkey: PUB, head: HEAD }] },
      { host: 'dylan.other.example', lineage: 'dylan', publishers: [{ pubkey: OTHER, head: HEAD }] },
    ] }
    expect(openZonesOf(ledger, 'dylan', PUB)).toEqual(['hypercomb.com', 'jwize.com'])
    expect(openZonesOf('<html>', 'dylan', PUB)).toEqual([])
  })
})

describe('setHiveDoors — reversible: only doors[key] moves, the head stays', () => {
  it('turns one domain off and keeps it published', async () => {
    index = { roots: { dylan: HEAD }, doors: { dylan: ['hypercomb.com', 'jwize.com'] } }
    const done = await setHiveDoors('hypercomb.com', 'dylan', 'here', { pubkey: PUB, expectHead: HEAD })
    expect(done).toMatchObject({ ok: true, doors: ['jwize.com'], written: true })
    expect(puts).toHaveLength(1)
    expect(puts[0]!.roots['dylan']).toBe(HEAD)
    expect(puts[0]!.doors['dylan']).toEqual(['jwize.com'])
  })

  it('turns it off everywhere with an empty list, never by deleting the root', async () => {
    index = { roots: { dylan: HEAD, susan: 'e'.repeat(64) }, doors: { dylan: ['hypercomb.com'] } }
    const done = await setHiveDoors('hypercomb.com', 'dylan', 'everywhere', { pubkey: PUB, expectHead: HEAD })
    expect(done).toMatchObject({ ok: true, doors: [] })
    expect(puts[0]!.roots).toMatchObject({ dylan: HEAD, susan: 'e'.repeat(64) })
    expect(puts[0]!.doors['dylan']).toEqual([])
  })

  it('answers what it would write and writes nothing on a dry run', async () => {
    index = { roots: { dylan: HEAD }, doors: { dylan: ['hypercomb.com', 'jwize.com'] } }
    const preview = await setHiveDoors('hypercomb.com', 'dylan', 'here', { pubkey: PUB, expectHead: HEAD, dryRun: true })
    expect(preview).toMatchObject({ ok: true, doors: ['jwize.com'], written: false, was: ['hypercomb.com', 'jwize.com'] })
    expect(puts).toHaveLength(0)
  })

  it("never reads or writes through the link's own zone", async () => {
    index = { roots: { dylan: HEAD }, doors: { dylan: ['evil.example', 'jwize.com'] } }
    const done = await setHiveDoors('evil.example', 'dylan', 'here', { pubkey: PUB, expectHead: HEAD })
    expect(done).toMatchObject({ ok: true, host: 'hypercomb.com', doors: ['jwize.com'] })
    expect(puts.map(put => put.host)).toEqual(['hypercomb.com'])
  })

  it('refuses a key that is not this hive\'s, a moved head, an unread index and a guess', async () => {
    index = { roots: { dylan: HEAD } }
    expect(await setHiveDoors('hypercomb.com', 'dylan', 'everywhere', { pubkey: OTHER, expectHead: HEAD }))
      .toMatchObject({ ok: false, failure: 'not-yours' })
    expect(await setHiveDoors('hypercomb.com', 'dylan', 'everywhere', { pubkey: PUB, expectHead: 'f'.repeat(64) }))
      .toMatchObject({ ok: false, failure: 'moved' })
    expect(await setHiveDoors('hypercomb.com', 'dylan', 'here', { pubkey: PUB, expectHead: HEAD }))
      .toMatchObject({ ok: false, failure: 'opens-everywhere' })
    index = null
    expect(await setHiveDoors('hypercomb.com', 'dylan', 'everywhere', { pubkey: PUB, expectHead: HEAD }))
      .toMatchObject({ ok: false, failure: 'index-unsafe' })
    expect(puts).toHaveLength(0)
  })

  it('writes nothing when the doors already say so', async () => {
    index = { roots: { dylan: HEAD }, doors: { dylan: ['jwize.com'] } }
    expect(await setHiveDoors('hypercomb.com', 'dylan', 'here', { pubkey: PUB, expectHead: HEAD }))
      .toMatchObject({ ok: true, unchanged: true, written: false })
    expect(puts).toHaveLength(0)
  })
})
