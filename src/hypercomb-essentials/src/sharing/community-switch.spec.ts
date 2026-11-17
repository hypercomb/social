// community-switch.spec.ts — LIVE IN YOUR COMMUNITY, OR OUT (jwize 2026-11-16:
// "add to community through domains and publish live"). The Publish window's
// community press: into the owners' signed showcase, or out of it; one version
// of a name live at a time; going live optimizes this key's own creation first;
// the front door's staged list follows when it has one.

import { describe, expect, it } from 'vitest'
import { ROOT_MOVED } from './hive-pointer.js'
import { switchInCommunity, switchedItems } from './community-switch.js'
import { showcaseKey, stagedKey, type Showcase, type ShowcaseItem } from './showcase-record.js'

const me = 'a'.repeat(64)
const them = 'b'.repeat(64)
const zone = 'jwize.com'
const mine = (lineage: string): ShowcaseItem => ({ pubkey: me, lineage })
const theirs = (lineage: string): ShowcaseItem => ({ pubkey: them, lineage })

/** A tiny index: key → record, with the signature it is named by. */
const store = (records: Record<string, Showcase | null>) => {
  const held = new Map<string, { sig: string; record: Showcase }>()
  let n = 0
  for (const [key, record] of Object.entries(records)) if (record) held.set(key, { sig: `sig${n++}`, record })
  const signed: { key: string; record: Showcase }[] = []
  return {
    held, signed,
    readAt: async (_zone: string, key: string = showcaseKey(zone)) => {
      const at = held.get(key)
      return at ? { sig: at.sig, record: at.record } : { sig: null, record: null }
    },
    sign: async (record: Showcase, key: string = showcaseKey(zone), expect?: string | null) => {
      if ((held.get(key)?.sig ?? null) !== (expect ?? null)) return { ok: false as const, reason: ROOT_MOVED }
      const sig = `sig${n++}`
      held.set(key, { sig, record })
      signed.push({ key, record })
      return { ok: true as const, sig }
    },
  }
}

const deps = (s: ReturnType<typeof store>, promoted: string[] = []) => ({
  own: async () => me,
  readAt: s.readAt,
  sign: s.sign,
  promote: async (_zone: string, lineage: string) => { promoted.push(lineage); return { ok: true as const, promoted: true } },
  backoff: () => 0,
  // What the doors publish on the zone: one of mine, shown while it has no showcase record yet.
  published: async () => [mine('camelflage')],
})

describe('the items after a press', () => {
  it('in: added once, and the other versions of the name out with it', () => {
    expect(switchedItems([theirs('arkanoid'), mine('x')], { zone, item: mine('games/arkanoid'), on: true, others: [theirs('arkanoid')] }))
      .toEqual([mine('x'), mine('games/arkanoid')])
    expect(switchedItems([mine('x')], { zone, item: mine('x'), on: true })).toEqual([mine('x')])
  })

  it('out: only the one pressed', () => {
    expect(switchedItems([mine('x'), mine('y')], { zone, item: mine('x'), on: false, others: [mine('y')] })).toEqual([mine('y')])
  })
})

describe('a press in the community', () => {
  it('a gray one of yours is optimized, then signed live', async () => {
    const s = store({ [showcaseKey(zone)]: { zone, items: [], domains: [] } })
    const promoted: string[] = []
    const result = await switchInCommunity({ zone, item: mine('meetups'), on: true }, deps(s, promoted))
    expect(result).toEqual({ ok: true, changed: true, items: [mine('meetups')] })
    expect(promoted).toEqual(['meetups'])
    expect(s.signed.map(w => w.key)).toEqual([showcaseKey(zone)])
  })

  it('another publisher\'s goes live with no optimizing — that is its author\'s', async () => {
    const s = store({})
    const promoted: string[] = []
    const result = await switchInCommunity({ zone, item: theirs('arkanoid'), on: true }, deps(s, promoted))
    expect(result.ok).toBe(true)
    expect(promoted).toEqual([])
    // A zone with no showcase yet gets one naming what visitors saw there (the doors) and it — never only it, which
    // would take every other tile off the page (2026-11-16).
    expect(s.held.get(showcaseKey(zone))?.record.items).toEqual([mine('camelflage'), theirs('arkanoid')])
  })

  it('a creation that cannot be optimized does not go live, and says why', async () => {
    const s = store({})
    const result = await switchInCommunity({ zone, item: mine('meetups'), on: true }, {
      ...deps(s), promote: async () => ({ ok: false as const, reason: 'meetups is not published on jwize.com yet' }),
    })
    expect(result).toEqual({ ok: false, reason: 'meetups is not published on jwize.com yet' })
    expect(s.signed).toEqual([])
  })

  it('a live one comes out — nothing is optimized for leaving', async () => {
    const s = store({ [showcaseKey(zone)]: { zone, items: [mine('a'), mine('b')], domains: [] } })
    const promoted: string[] = []
    const result = await switchInCommunity({ zone, item: mine('a'), on: false }, deps(s, promoted))
    expect(result).toEqual({ ok: true, changed: true, items: [mine('b')] })
    expect(promoted).toEqual([])
  })

  it('pressing what is already so signs nothing', async () => {
    const s = store({ [showcaseKey(zone)]: { zone, items: [mine('a')], domains: [] } })
    const result = await switchInCommunity({ zone, item: theirs('nope'), on: false }, deps(s))
    expect(result).toEqual({ ok: true, changed: false, items: [mine('a')] })
    expect(s.signed).toEqual([])
  })

  it('a community losing what left keeps the rest, and the look stays', async () => {
    const s = store({ [showcaseKey(zone)]: {
      zone, items: [mine('a'), mine('b')], domains: ['x.com'], view: 'list',
      communities: [{ name: 'Games', items: [mine('a'), mine('b')], domains: [] }],
    } })
    await switchInCommunity({ zone, item: mine('a'), on: false }, deps(s))
    const after = s.held.get(showcaseKey(zone))!.record
    expect(after.view).toBe('list')
    expect(after.domains).toEqual(['x.com'])
    expect(after.communities?.[0].items).toEqual([mine('b')])
  })

  it('the front door\'s staged list follows when it has one, and is not started when it has none', async () => {
    const withStaged = store({ [showcaseKey(zone)]: { zone, items: [], domains: [] }, [stagedKey(zone)]: { zone, items: [mine('z')], domains: [] } })
    await switchInCommunity({ zone, item: theirs('arkanoid'), on: true }, deps(withStaged))
    expect(withStaged.held.get(stagedKey(zone))?.record.items).toEqual([mine('z'), theirs('arkanoid')])

    const without = store({ [showcaseKey(zone)]: { zone, items: [], domains: [] } })
    await switchInCommunity({ zone, item: theirs('arkanoid'), on: true }, deps(without))
    expect(without.held.has(stagedKey(zone))).toBe(false)
  })

  it('another device saving meanwhile: read again and the difference applied to what it saved', async () => {
    const s = store({ [showcaseKey(zone)]: { zone, items: [mine('a')], domains: [] } })
    let first = true
    const racing = {
      ...deps(s),
      readAt: async (z: string, key?: string) => {
        const read = await s.readAt(z, key)
        if (first && key === showcaseKey(zone)) {
          first = false
          // the phone lands its own change between this read and the write
          s.held.set(showcaseKey(zone), { sig: 'phone', record: { zone, items: [mine('a'), mine('phone')], domains: [] } })
        }
        return read
      },
    }
    const result = await switchInCommunity({ zone, item: theirs('arkanoid'), on: true }, racing)
    expect(result.ok).toBe(true)
    expect(s.held.get(showcaseKey(zone))?.record.items).toEqual([mine('a'), mine('phone'), theirs('arkanoid')])
  })

  it('refuses what it cannot believe, and a device with no key', async () => {
    const s = store({})
    expect(await switchInCommunity({ zone: 'not a zone', item: mine('a'), on: true }, deps(s))).toEqual({ ok: false, reason: 'bad request' })
    expect(await switchInCommunity({ zone, item: { pubkey: 'x', lineage: 'a' }, on: true }, deps(s))).toEqual({ ok: false, reason: 'bad request' })
    expect(await switchInCommunity({ zone, item: mine('a'), on: true }, { ...deps(s), own: async () => '' })).toEqual({ ok: false, reason: 'no key on this device' })
  })
})
