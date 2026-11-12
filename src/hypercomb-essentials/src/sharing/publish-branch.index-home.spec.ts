// publish-branch.index-home.spec.ts — THE INDEX LIVES WHERE ITS READERS READ IT.
//
// 2026-11-11: /business-card was published through jwize.com. That apex is the
// home relay on the publisher's machine; every <name>.jwize.com is served by
// the worker whose store is written at pluginthematrix.com. The relay held no
// index, so the publish started an empty one there and signed 6 branches,
// while the card's address went on serving the old head under the 78-branch
// index. The index a stranger reads at the address now decides the home.

import { describe, expect, it } from 'vitest'
import type { HiveIndexResult } from './hive-pointer.js'
import { indexHome, readerSiteOf, resolveIndexDoor } from './publish-branch.js'

const PUBKEY = 'c'.repeat(64)
const index = (eventId: string, roots: Record<string, string>, createdAt: number): HiveIndexResult =>
  ({ ok: true, manifest: { roots, doors: {}, createdAt, pubkey: PUBKEY, eventId } })
// The 78-branch index every jwize.com site reads, and the 6-branch one the relay was handed later.
const FULL = index('e'.repeat(64), { 'business-card': 'b'.repeat(64), susan: 'a'.repeat(64) }, 1_794_425_907)
const STRAY = index('f'.repeat(64), { 'business-card': 'd'.repeat(64) }, 1_794_447_953)
const ABSENT: HiveIndexResult = { ok: false, reason: 'http', status: 404 }
const DOWN: HiveIndexResult = { ok: false, reason: 'unreachable' }

const hosts = (held: Record<string, HiveIndexResult>) => async (host: string): Promise<HiveIndexResult> => held[host] ?? DOWN

describe('indexHome', () => {
  it('passes over the relay copy for the store the sites read', async () => {
    const at = hosts({ 'jwize.com': STRAY, 'business-card.jwize.com': FULL, 'pluginthematrix.com': FULL })
    const home = await indexHome(['jwize.com'], PUBKEY, { readAt: 'business-card.jwize.com', elsewhere: ['pluginthematrix.com'] }, at)
    expect(home).toEqual({ host: 'pluginthematrix.com', read: FULL })
  })

  it('finds the home when the door keeps no index at all: no empty index is started', async () => {
    const at = hosts({ 'jwize.com': ABSENT, 'business-card.jwize.com': FULL, 'pluginthematrix.com': FULL })
    const found = await resolveIndexDoor(['jwize.com'], PUBKEY, at, { readAt: 'business-card.jwize.com', elsewhere: ['pluginthematrix.com'] })
    expect(found).toEqual({ host: 'pluginthematrix.com', read: FULL })
  })

  it('keeps the door when it holds what the readers read', async () => {
    const at = hosts({ 'hypercomb.com': FULL, 'card.hypercomb.com': FULL, 'pluginthematrix.com': FULL })
    expect(await indexHome(['hypercomb.com'], PUBKEY, { readAt: 'card.hypercomb.com', elsewhere: ['pluginthematrix.com'] }, at))
      .toEqual({ host: 'hypercomb.com', read: FULL })
  })

  it('refuses when no host holds what the readers read', async () => {
    const at = hosts({ 'jwize.com': STRAY, 'business-card.jwize.com': FULL })
    const found = await resolveIndexDoor(['jwize.com'], PUBKEY, at, { readAt: 'business-card.jwize.com', elsewhere: ['realones.online'] })
    expect(found.split).toBe('business-card.jwize.com')
    expect(found.read.ok).toBe(false)
  })

  it('says nothing when the readers hold no index: the doors decide as before', async () => {
    const at = hosts({ 'a.example': ABSENT, 'card.a.example': ABSENT })
    expect(await indexHome(['a.example'], PUBKEY, { readAt: 'card.a.example' }, at)).toBeNull()
    expect(await resolveIndexDoor(['a.example'], PUBKEY, at, { readAt: 'card.a.example' })).toEqual({ host: 'a.example', read: ABSENT })
    expect(await indexHome(['a.example'], PUBKEY, {}, at)).toBeNull()
  })
})

describe('readerSiteOf', () => {
  it('is the branch label on its first domain', () => {
    expect(readerSiteOf(['business-card'], ['jwize.com', 'hypercomb.com'])).toBe('business-card.jwize.com')
    expect(readerSiteOf(['Business Card', 'front'], ['content.jwize.com'])).toBe('business-card.jwize.com')
  })

  it('is nothing for a machine door or a reserved label', () => {
    expect(readerSiteOf(['business-card'], ['localhost:4291'])).toBe('')
    expect(readerSiteOf(['content'], ['jwize.com'])).toBe('')
    expect(readerSiteOf([], ['jwize.com'])).toBe('')
  })
})
