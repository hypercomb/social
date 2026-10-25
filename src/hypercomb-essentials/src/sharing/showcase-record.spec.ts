// sharing/showcase-record.spec.ts — one domain's showcase, as the hive writes it
// and as the front door reads it.

import { describe, expect, it } from 'vitest'
import { addCommunity, communityKey, communityName, parseShowcase, removeCommunity, showcaseBytes, showcaseKey, showcases,
  toggleCommunityItem, toggleDomain, toggleItem, type Showcase } from './showcase-record'

const key = (char: string): string => char.repeat(64)
const empty: Showcase = { zone: 'hypercomb.com', items: [], domains: [] }
const dylan = { pubkey: key('a'), lineage: 'dylan' }
const games = { pubkey: key('b'), lineage: 'games' }

// The shim is read at runtime, never imported by a module: the front door
// must take the hive's bytes for exactly the showcase the hive meant.
const SHIM_RECORD = '../../../hypercomb-shim/src/bootstrap/showcase-record'

describe('showcase — a switch is a record', () => {
  it('turns a creation on, and the same switch turns it off', () => {
    const on = toggleItem(empty, dylan)
    expect(showcases(on, dylan)).toBe(true)
    expect(showcases(toggleItem(on, dylan), dylan)).toBe(false)
  })

  it('shows everything on a domain shown in full', () => {
    const all = toggleDomain(empty, 'jwize.com')
    expect(showcases(all, games, ['jwize.com'])).toBe(true)
    expect(showcases(all, games, ['cafesociety.buzz'])).toBe(false)
    expect(toggleDomain(all, 'jwize.com').domains).toEqual([])
  })

  it('writes the same bytes for the same choice, whatever order it was made in — undo lands on the same signature', () => {
    const one = toggleItem(toggleItem(toggleDomain(empty, 'jwize.com'), games), dylan)
    const other = toggleDomain(toggleItem(toggleItem(empty, dylan), games), 'jwize.com')
    expect(new TextDecoder().decode(showcaseBytes(one))).toBe(new TextDecoder().decode(showcaseBytes(other)))
    // On, off, on again: back to the very bytes it left.
    const back = toggleItem(toggleItem(one, dylan), dylan)
    expect(new TextDecoder().decode(showcaseBytes(back))).toBe(new TextDecoder().decode(showcaseBytes(one)))
  })

  it('is read back by the front door as exactly the showcase the hive wrote', async () => {
    const shim = await import(/* @vite-ignore */ SHIM_RECORD) as { parseShowcase: (raw: unknown, zone: string) => unknown }
    const written = toggleDomain(toggleItem(empty, dylan), 'jwize.com')
    const raw = JSON.parse(new TextDecoder().decode(showcaseBytes(written)))
    expect(shim.parseShowcase(raw, 'hypercomb.com')).toEqual(parseShowcase(raw, 'hypercomb.com'))
    expect(parseShowcase(raw, 'hypercomb.com')).toEqual({ zone: 'hypercomb.com', items: [dylan], domains: ['jwize.com'] })
    expect(showcaseKey('hypercomb.com')).toBe('showcase:hypercomb.com')
  })
})

describe('communities — named pages of the showcase', () => {
  const text = (showcase: Showcase): string => new TextDecoder().decode(showcaseBytes(showcase))
  const made = (showcase: Showcase, name: string): Showcase => {
    const result = addCommunity(showcase, name)
    if (!result.ok) throw new Error(result.reason)
    return result.showcase
  }

  it('leaves a showcase with no communities the very bytes it was before they existed', () => {
    const plain = toggleDomain(toggleItem(empty, dylan), 'jwize.com')
    expect(text(plain)).toBe(JSON.stringify({ kind: 'host:showcase', zone: 'hypercomb.com', items: [dylan], domains: ['jwize.com'] }))
    expect(text({ ...plain, communities: [] })).toBe(text(plain))
  })

  it('creates a community by its name: the name is the community', () => {
    const one = made(empty, '  Favourite   hives  ')
    expect(one.communities).toEqual([{ name: 'Favourite hives', items: [], domains: [] }])
    expect(communityKey('Favourite hives')).toBe(communityKey('favourite HIVES'))
    expect(addCommunity(one, 'favourite hives')).toEqual({ ok: false, reason: 'taken' })
  })

  it('refuses a name that is none, the first page, or a reserved word', () => {
    expect(addCommunity(empty, '   ')).toEqual({ ok: false, reason: 'empty' })
    expect(addCommunity(empty, 'All')).toEqual({ ok: false, reason: 'all' })
    expect(addCommunity(empty, 'bees')).toEqual({ ok: false, reason: 'reserved' })
    let full = empty
    for (let index = 0; index < 24; index++) full = made(full, `page ${index}`)
    expect(addCommunity(full, 'one more')).toEqual({ ok: false, reason: 'full' })
  })

  it('cleans a name to what can be shown: no format characters, controls and spaces folded to one, forty code points', () => {
    expect(communityName('a‮b\u0000c\n\td')).toBe('ab c d')
    expect([...communityName('x'.repeat(80))]).toHaveLength(40)
    expect([...communityName('😀'.repeat(60))]).toHaveLength(40)
    expect(communityName(7)).toBe('')
  })

  it('keeps the order they are swiped in, and the same choice always signs the same bytes', () => {
    const one = toggleCommunityItem(toggleCommunityItem(made(made(empty, 'Zeta'), 'Alpha'), 'zeta', games), 'zeta', dylan)
    const other = toggleCommunityItem(toggleCommunityItem(made(made(empty, 'Zeta'), 'Alpha'), 'zeta', dylan), 'zeta', games)
    expect(text(one)).toBe(text(other))
    expect(JSON.parse(text(one)).communities.map((row: { name: string }) => row.name)).toEqual(['Zeta', 'Alpha'])
    // On, off, on again: back to the very bytes it left.
    expect(text(toggleCommunityItem(toggleCommunityItem(one, 'alpha', dylan), 'alpha', dylan))).toBe(text(one))
  })

  it('turning something off takes it out of every community in the same commit', () => {
    const on = toggleDomain(toggleItem(toggleItem(empty, dylan), games), 'jwize.com')
    const grouped = toggleCommunityItem(toggleCommunityItem(made(on, 'Mine'), 'mine', dylan), 'mine', games)
    const withDomain = { ...grouped, communities: [{ ...grouped.communities![0]!, domains: ['jwize.com'] }] }
    const off = toggleDomain(toggleItem(withDomain, dylan), 'jwize.com')
    expect(off.communities![0]!.items).toEqual([games])
    expect(off.communities![0]!.domains).toEqual([])
    expect(removeCommunity(off, 'mine').communities).toEqual([])
    // Its members stay in the showcase.
    expect(off.items).toEqual([games])
  })

  it('is read back by the front door as exactly the communities the hive wrote', async () => {
    const shim = await import(/* @vite-ignore */ SHIM_RECORD) as {
      parseShowcase: (raw: unknown, zone: string) => unknown; communityName: (raw: unknown) => string; communityKey: (raw: unknown) => string }
    const written = toggleCommunityItem(made(made(toggleItem(toggleItem(empty, dylan), games), 'Daily'), 'Weekend'), 'daily', dylan)
    const raw = JSON.parse(text(written))
    expect(shim.parseShowcase(raw, 'hypercomb.com')).toEqual(parseShowcase(raw, 'hypercomb.com'))
    expect(parseShowcase(raw, 'hypercomb.com')!.communities).toEqual([
      { name: 'Daily', items: [dylan], domains: [] }, { name: 'Weekend', items: [], domains: [] }])
    for (const name of ['Daily', 'ALL', '  x  ', '😀😀', 'a‮b', 7]) {
      expect(shim.communityName(name)).toBe(communityName(name))
      expect(shim.communityKey(name)).toBe(communityKey(name))
    }
  })

  it('reads a hostile record as only what survives: dropped names, fail-closed access, caps', async () => {
    const shim = await import(/* @vite-ignore */ SHIM_RECORD) as { parseShowcase: (raw: unknown, zone: string) => { communities?: unknown[] } | null }
    const record = {
      kind: 'host:showcase', zone: 'hypercomb.com', items: [], domains: [],
      communities: [
        { name: 'Open', items: [dylan, { pubkey: 'nope', lineage: 'x' }], domains: ['jwize.com', 'javascript:alert(1)'] },
        { name: 'open', items: [games] },
        { name: 'All', items: [dylan] },
        { name: 'Gated', access: 'grant', items: [dylan] },
        { name: 'Marked', access: 'public', items: [] },
        { name: '‮​' },
        null, 7, 'text',
      ],
    }
    for (const parse of [parseShowcase, shim.parseShowcase]) {
      expect(parse(record, 'hypercomb.com')!.communities).toEqual([
        { name: 'Open', items: [dylan], domains: ['jwize.com'] },
        { name: 'Marked', items: [], domains: [] },
      ])
    }
    const many = { ...record, communities: Array.from({ length: 80 }, (_, index) => ({ name: `page ${index}`, items: [dylan] })) }
    expect(parseShowcase(many, 'hypercomb.com')!.communities).toHaveLength(24)
    expect(shim.parseShowcase(many, 'hypercomb.com')!.communities).toHaveLength(24)
  })
})
