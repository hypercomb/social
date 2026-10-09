// sharing/publish-root-address.spec.ts — THE ROOT IS THE DOOR, in the publish
// routine (jwize 2026-10-03: "when you publish you always publish to the root
// domain unless otherwise added … make sure it is retired across the board").
//
//   • every node a branch publishes through is a ZONE ROOT — its host marks
//     and the standing public host alike, even one stored as `content.<zone>`
//     by an install from before the face retired;
//   • the share address is the zone's ROOT PATH by default, its OWN ADDRESS
//     (`<label>.<zone>`) when the signed index gives it one;
//   • every index writer carries `addresses` through, unpublishing drops the
//     withdrawn creation's addresses, and setting/clearing one is a single
//     signed write that refuses labels that are not DNS labels or are reserved.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HiveIndexResult, PutHiveResult } from './hive-pointer.js'

const HEAD = 'a'.repeat(64)
const OTHER_HEAD = 'b'.repeat(64)
const PUBKEY = 'c'.repeat(64)
const BUNDLE = 'd'.repeat(64)

type Put = { host: string; roots: Record<string, string>; doors: Record<string, string[]>; previous?: Record<string, unknown> }

let indexRead: HiveIndexResult
let puts: Put[]
let asked: string[]
let marks: string[]
let standing: string

vi.mock('./hive-pointer.js', () => ({
  nip98Header: async () => 'Nostr test',
  fetchHiveIndex: async (host: string): Promise<HiveIndexResult> => {
    asked.push(host)
    const last = puts[puts.length - 1]
    return last
      ? { ok: true, manifest: { roots: last.roots, doors: last.doors, createdAt: 1_700_000_001, pubkey: PUBKEY, signedContent: last.previous } }
      : indexRead
  },
  putHiveManifest: async (host: string, roots: Record<string, string>, doors: Record<string, string[]> = {},
    _replaces: number, previous?: Record<string, unknown>): Promise<PutHiveResult> => {
    puts.push({ host, roots, doors, previous })
    return { ok: true, pubkey: PUBKEY, createdAt: 1_700_000_001 }
  },
}))
vi.mock('./community-hosts.js', () => ({ hostsOfBranch: async () => marks }))

;(window as unknown as { ioc: unknown }).ioc = {
  register: () => void 0,
  get: (key: string): unknown => {
    if (key === '@hypercomb.social/Store') return { putResource: async () => BUNDLE }
    if (key === '@diamondcoreprocessor.com/HistoryService') return { sealSubtree: async () => HEAD }
    if (key === '@diamondcoreprocessor.com/HostSyncService') {
      return {
        isEnabled: () => false,
        isPublicHostEnabled: () => true,
        publicHostDomain: () => standing,
        addPublishNodes: () => void 0,
        markPublic: async () => void 0,
        drain: async () => void 0,
        isClosureAvailable: async () => true,
        ensureReceipt: async () => true,
        probeServed: async () => 'served' as const,
      }
    }
    if (key === '@diamondcoreprocessor.com/NostrSigner') return { getPublicKeyHex: async () => PUBKEY }
    return undefined
  },
}

const { nodesFor, publishBranch, setBranchAddress, setBranchDoors, unpublishBranch } = await import('./publish-branch.js')
const { lineageKey } = await import('../history/lineage-key.js')

const SEGS = ['honey-garden', 'rituals']
const KEY = lineageKey(SEGS)

const published = (extra: Record<string, unknown> = {}): HiveIndexResult => {
  const roots = { [KEY]: HEAD, other: OTHER_HEAD }
  const doors = { [KEY]: ['cafesociety.buzz'] }
  const addresses = { 'rituals.cafesociety.buzz': KEY, 'shop.cafesociety.buzz': 'other' }
  const signedContent = { v: 1, roots, doors, addresses, future: { kept: true }, ...extra }
  return { ok: true, manifest: { roots, doors, addresses, createdAt: 1_700_000_000, pubkey: PUBKEY, signedContent } }
}

beforeEach(() => {
  indexRead = { ok: false, reason: 'http', status: 404 }
  puts = []
  asked = []
  marks = []
  standing = 'pluginthematrix.com'
})

describe('the nodes a branch publishes through are zone roots', () => {
  it('a branch marked with domains writes to those domains themselves — never content.<zone>', async () => {
    marks = ['cafesociety.buzz', 'example.org']
    const nodes = await nodesFor(SEGS, undefined)
    expect(nodes).toEqual(['cafesociety.buzz', 'example.org'])
    expect(nodes.some(n => n.startsWith('content.'))).toBe(false)
  })

  it('the standing public host stored as content.<zone> before the retirement is read as its zone', async () => {
    standing = 'content.pluginthematrix.com'
    const hostSync = { isPublicHostEnabled: () => true, publicHostDomain: () => standing }
    expect(await nodesFor(SEGS, hostSync)).toEqual(['pluginthematrix.com'])
  })

  it('a marked branch plus the standing host: roots, primary first, no duplicates', async () => {
    marks = ['pluginthematrix.com', 'cafesociety.buzz']
    standing = 'content.pluginthematrix.com'
    const hostSync = { isPublicHostEnabled: () => true, publicHostDomain: () => standing }
    expect(await nodesFor(SEGS, hostSync)).toEqual(['pluginthematrix.com', 'cafesociety.buzz'])
  })

  it('publishing reads and writes the index at the zone root', async () => {
    marks = ['cafesociety.buzz']
    const result = await publishBranch(SEGS)
    expect(result.ok).toBe(true)
    expect(asked.every(h => !h.startsWith('content.'))).toBe(true)
    expect(puts[0]!.host).toBe('cafesociety.buzz')
  })
})

describe('the share address', () => {
  it('is the root path on the primary domain by default', async () => {
    marks = ['cafesociety.buzz']
    const result = await publishBranch(SEGS)
    expect(result.ok && result.address).toBe('https://cafesociety.buzz/honey-garden/rituals')
  })

  it('is the own address when the signed index gives the creation one there', async () => {
    marks = ['cafesociety.buzz']
    indexRead = published()
    const result = await publishBranch(SEGS)
    expect(result.ok && result.address).toBe('https://rituals.cafesociety.buzz')
  })
})

describe('every index writer carries the addresses', () => {
  it('a publish carries the signed content — addresses included — into its write', async () => {
    marks = ['cafesociety.buzz']
    indexRead = published()
    await publishBranch(SEGS)
    expect(puts[0]!.previous?.['addresses']).toEqual({ 'rituals.cafesociety.buzz': KEY, 'shop.cafesociety.buzz': 'other' })
  })

  it('a domain switch carries them unchanged', async () => {
    marks = ['cafesociety.buzz']
    indexRead = published()
    const out = await setBranchDoors(SEGS, ['cafesociety.buzz', 'pluginthematrix.com'])
    expect(out.ok).toBe(true)
    expect(puts[0]!.previous?.['addresses']).toEqual({ 'rituals.cafesociety.buzz': KEY, 'shop.cafesociety.buzz': 'other' })
    expect(puts[0]!.previous?.['future']).toEqual({ kept: true })
  })

  it('unpublishing drops the withdrawn creation\'s addresses and keeps everyone else\'s', async () => {
    marks = ['cafesociety.buzz']
    indexRead = published()
    const out = await unpublishBranch(SEGS)
    expect(out).toEqual({ ok: true, removed: true })
    expect(puts[0]!.roots).toEqual({ other: OTHER_HEAD })
    expect(puts[0]!.previous?.['addresses']).toEqual({ 'shop.cafesociety.buzz': 'other' })
  })
})

describe('the own-address option', () => {
  it('saving a label writes <label>.<zone> → lineage key in ONE signed write, carrying the rest', async () => {
    marks = ['cafesociety.buzz']
    indexRead = published({ addresses: { 'shop.cafesociety.buzz': 'other' } })
    if (indexRead.ok) indexRead.manifest.addresses = { 'shop.cafesociety.buzz': 'other' }
    const out = await setBranchAddress(SEGS, 'cafesociety.buzz', 'tea-rituals')
    expect(out).toEqual({ ok: true, host: 'tea-rituals.cafesociety.buzz' })
    expect(puts).toHaveLength(1)
    expect(puts[0]!.host).toBe('cafesociety.buzz')
    expect(puts[0]!.roots).toEqual({ [KEY]: HEAD, other: OTHER_HEAD })
    expect(puts[0]!.doors).toEqual({ [KEY]: ['cafesociety.buzz'] })
    expect(puts[0]!.previous?.['addresses']).toEqual({ 'shop.cafesociety.buzz': 'other', 'tea-rituals.cafesociety.buzz': KEY })
    expect(puts[0]!.previous?.['future']).toEqual({ kept: true })
  })

  it('a new label replaces the creation\'s old one on that zone', async () => {
    marks = ['cafesociety.buzz']
    indexRead = published()
    await setBranchAddress(SEGS, 'cafesociety.buzz', 'tea')
    expect(puts[0]!.previous?.['addresses']).toEqual({ 'shop.cafesociety.buzz': 'other', 'tea.cafesociety.buzz': KEY })
  })

  it('turning the option off drops that entry — the creation lives at the root path again', async () => {
    marks = ['cafesociety.buzz']
    indexRead = published()
    const out = await setBranchAddress(SEGS, 'cafesociety.buzz', null)
    expect(out).toEqual({ ok: true, host: 'cafesociety.buzz' })
    expect(puts[0]!.previous?.['addresses']).toEqual({ 'shop.cafesociety.buzz': 'other' })
  })

  it('refuses a label that is not a DNS label, or is reserved, before anything is signed', async () => {
    marks = ['cafesociety.buzz']
    indexRead = published()
    expect(await setBranchAddress(SEGS, 'cafesociety.buzz', 'Tea Rituals')).toMatchObject({ ok: false, failure: 'not-a-label' })
    expect(await setBranchAddress(SEGS, 'cafesociety.buzz', '-tea')).toMatchObject({ ok: false, failure: 'not-a-label' })
    expect(await setBranchAddress(SEGS, 'cafesociety.buzz', 'content')).toMatchObject({ ok: false, failure: 'reserved' })
    expect(await setBranchAddress(SEGS, 'cafesociety.buzz', 'try-rituals')).toMatchObject({ ok: false, failure: 'reserved' })
    expect(puts).toEqual([])
  })

  it('a branch the index does not name has nothing to address yet', async () => {
    marks = ['cafesociety.buzz']
    indexRead = { ok: true, manifest: { roots: { other: OTHER_HEAD }, createdAt: 1, pubkey: PUBKEY, signedContent: { v: 1, roots: { other: OTHER_HEAD } } } }
    expect(await setBranchAddress(SEGS, 'cafesociety.buzz', 'rituals')).toMatchObject({ ok: false, failure: 'not-published' })
    expect(puts).toEqual([])
  })

  it('names the zone root even when it is handed the retired face', async () => {
    marks = ['cafesociety.buzz']
    indexRead = published()
    expect(await setBranchAddress(SEGS, 'content.cafesociety.buzz', 'tea')).toEqual({ ok: true, host: 'tea.cafesociety.buzz' })
  })
})
