// A zone's community is a record its owners sign under the index key
// `showcase:<zone>`, not a pool: read where the front door reads it.

import { describe, expect, it, vi } from 'vitest'
import { readZoneShowcase, type ShowcaseReadDeps } from './hive-showcase-read.js'
import { readPool, type PoolReadDeps } from './hive-pool-read.js'

const LEDGER_AT = 'l'.repeat(64)
const OWNER = 'e'.repeat(64)
const FRIEND = 'f'.repeat(64)
const RECORD = 'd'.repeat(64)
const HEAD_A = 'a'.repeat(64)
const HEAD_B = 'b'.repeat(64)
const LEDGER = JSON.stringify({ sites: [
  { host: 'example.com', title: 'Example', lineage: '', publishers: [{ pubkey: FRIEND }, { pubkey: OWNER, primary: true }] },
  { host: 'card.example.com', title: 'Card', lineage: 'card', publishers: [{ pubkey: OWNER, head: HEAD_A, primary: true }] },
  { host: 'other.net', title: 'Other', lineage: 'x', publishers: [{ pubkey: FRIEND, head: HEAD_B }] },
] })
const SHOWCASE = { kind: 'host:showcase', zone: 'example.com', items: [
  { pubkey: OWNER, lineage: 'card' }, { pubkey: FRIEND, lineage: 'games' }, { pubkey: OWNER, lineage: 'gone' },
], domains: [] }

const deps = (over: Partial<ShowcaseReadDeps> = {}): ShowcaseReadDeps => ({
  address: async () => LEDGER_AT,
  document: async () => LEDGER,
  roots: async (host, pubkey): Promise<Record<string, string> | null> => {
    // The apex keeps a stray copy that names no showcase; the site holds the real one.
    if (pubkey === OWNER) return host === 'card.example.com' ? { card: HEAD_A, 'showcase:example.com': RECORD } : { card: HEAD_A }
    if (pubkey === FRIEND) return { games: HEAD_B }
    return null
  },
  atom: async (_origin, sig) => sig === RECORD ? new TextEncoder().encode(JSON.stringify(SHOWCASE)) : null,
  ...over,
})

describe('a zone\'s community, read where its owners sign it', () => {
  it('reads the primary owner\'s index on the zone\'s own site before its apex, and resolves each creation to its head', async () => {
    const note = vi.fn()
    const roots = vi.fn(deps().roots)
    const found = await readZoneShowcase('showcase:example.com', ['card.example.com', 'hypercomb.com'], deps({ roots, note }))
    expect(found?.host).toBe('card.example.com')
    // The primary owner is asked first, on the site first.
    expect(roots.mock.calls[0]).toEqual(['card.example.com', OWNER, undefined])
    const text = JSON.parse(found!.text)
    expect(text).toMatchObject({ kind: 'host:showcase', zone: 'example.com', record: RECORD, signedBy: OWNER, readAt: 'card.example.com' })
    expect(text.items).toEqual([
      { pubkey: OWNER, lineage: 'card', head: HEAD_A },
      { pubkey: FRIEND, lineage: 'games', head: HEAD_B },
      { pubkey: OWNER, lineage: 'gone', head: null },
    ])
    expect(found!.heads).toEqual([{ sig: HEAD_A, hosts: ['card.example.com'] }, { sig: HEAD_B, hosts: ['card.example.com'] }])
    // The broker is told where each head lives.
    expect(note).toHaveBeenCalledWith(HEAD_A, ['card.example.com'])
  })

  it('never reads a zone this hive does not already ask, nor a meaning that is not a showcase', async () => {
    const document = vi.fn(async () => LEDGER)
    expect(await readZoneShowcase('showcase:example.com', ['hypercomb.com', 'notexample.com'], deps({ document }))).toBeNull()
    expect(await readZoneShowcase('staged:example.com', ['example.com'], deps({ document }))).toBeNull()
    expect(await readZoneShowcase('showcase:https://evil', ['example.com'], deps({ document }))).toBeNull()
    expect(document).not.toHaveBeenCalled()
  })

  it('refuses a record that does not hash to its name or is for another zone', async () => {
    expect(await readZoneShowcase('showcase:example.com', ['example.com'], deps({ atom: async () => null }))).toBeNull()
    const elsewhere = new TextEncoder().encode(JSON.stringify({ ...SHOWCASE, zone: 'other.net' }))
    expect(await readZoneShowcase('showcase:example.com', ['example.com'], deps({ atom: async () => elsewhere }))).toBeNull()
  })

  it('is null when no owner names a showcase', async () => {
    expect(await readZoneShowcase('showcase:example.com', ['example.com'], deps({ roots: async () => ({ card: HEAD_A }) }))).toBeNull()
  })
})

describe('pool showcase:<zone>', () => {
  const poolDeps = (over: Partial<PoolReadDeps> = {}): PoolReadDeps => ({
    hosts: async () => ['card.example.com', 'example.com'],
    address: async () => 'c'.repeat(64),
    listing: async () => 'absent',
    document: async () => null,
    ...over,
  })

  it('falls back to the signed record when no host answers at the pool address, and names its heads', async () => {
    const signed = vi.fn(async () => ({ host: 'card.example.com', text: '{"kind":"host:showcase"}', heads: [{ sig: HEAD_A, hosts: ['card.example.com'] }] }))
    const read = await readPool('showcase:example.com', {}, poolDeps({ signed }))
    if (!read.ok) throw new Error('unreachable')
    expect(signed).toHaveBeenCalledWith('showcase:example.com', ['card.example.com', 'example.com'], undefined)
    expect(read.documents).toEqual([{ hosts: ['card.example.com'], size: 24, from: 0, text: '{"kind":"host:showcase"}', truncated: false }])
    expect(read.members).toEqual([{ sig: HEAD_A, hosts: ['card.example.com'] }])
    expect(read.hosts).toContainEqual({ host: 'card.example.com', state: 'document' })
  })

  it('does not ask the owners when a host answers the pool itself', async () => {
    const signed = vi.fn(async () => null)
    await readPool('host:offerings', {}, poolDeps({ signed, listing: async () => `${HEAD_A}\n` }))
    expect(signed).not.toHaveBeenCalled()
  })
})
