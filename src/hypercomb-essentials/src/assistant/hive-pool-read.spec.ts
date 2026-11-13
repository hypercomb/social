// A model asks the hosts this hive follows for one pool of meaning, at the
// address every host carries it at. It names a meaning, never a host.

import { describe, expect, it, vi } from 'vitest'
import { readPool, type PoolReadDeps } from './hive-pool-read.js'

const ADDRESS = 'a'.repeat(64)
const MEMBER = 'b'.repeat(64)
const OTHER = 'c'.repeat(64)
const LEDGER = JSON.stringify({ sites: [{ host: 'card.example', url: 'https://card.example/', title: 'Card', lineage: 'card', publishers: [{ pubkey: OTHER, head: MEMBER }] }] })

const deps = (over: Partial<PoolReadDeps> = {}): PoolReadDeps => ({
  hosts: async () => ['b.example', 'a.example'],
  address: async () => ADDRESS,
  listing: async () => 'absent',
  document: async () => null,
  ...over,
})

describe('a pool of meaning, asked of the hosts', () => {
  it('reads the one-file index a host answers at the pool address, once per distinct content', async () => {
    const document = vi.fn(async () => LEDGER)
    const read = await readPool('host:publications', {}, deps({ document }))
    expect(read).toMatchObject({
      ok: true, root: 'pool host:publications', meaning: 'host:publications', address: ADDRESS,
      hosts: [{ host: 'a.example', state: 'document' }, { host: 'b.example', state: 'document' }],
      members: [], total: 0, truncated: false,
    })
    if (!read.ok) throw new Error('unreachable')
    // Two hosts, one ledger: said once, with both hosts on it.
    expect(read.documents).toEqual([{ hosts: ['a.example', 'b.example'], size: LEDGER.length, from: 0, text: LEDGER, truncated: false }])
    // The request is the derived address at each host's root, and nothing else.
    expect(document).toHaveBeenCalledWith('https://a.example', ADDRESS, undefined)
  })

  it('merges a set across hosts, most carried first, and says which host said what', async () => {
    const listing = vi.fn(async (origin: string) => origin.includes('a.example') ? `${MEMBER}\n${OTHER}\n0000\n` : `${MEMBER}\n`)
    const read = await readPool('host:offerings', {}, deps({ listing }))
    if (!read.ok) throw new Error('unreachable')
    expect(read.hosts).toEqual([{ host: 'a.example', state: 'listed' }, { host: 'b.example', state: 'listed' }])
    // A marker is not a member; a member two hosts carry comes first.
    expect(read.members).toEqual([{ sig: MEMBER, hosts: ['a.example', 'b.example'] }, { sig: OTHER, hosts: ['a.example'] }])
    expect(read.documents).toEqual([])
  })

  it('tells a host with no pool from a host that did not answer', async () => {
    const read = await readPool('themes:card', {}, deps({
      listing: async origin => origin.includes('a.example') ? 'absent' : null,
    }))
    if (!read.ok) throw new Error('unreachable')
    expect(read.hosts).toEqual([{ host: 'a.example', state: 'absent' }, { host: 'b.example', state: 'silent' }])
    expect(read.members).toEqual([])
  })

  it('pages a long index from where the last page stopped', async () => {
    const long = 'x'.repeat(3_000)
    const first = await readPool('host:publications', { maxBytes: 2_000 }, deps({ document: async () => long }))
    if (!first.ok) throw new Error('unreachable')
    expect(first.documents[0]).toMatchObject({ from: 0, truncated: true, next: 2_000 })
    expect(first.truncated).toBe(true)
    const rest = await readPool('host:publications', { maxBytes: 2_000, from: 2_000 }, deps({ document: async () => long }))
    if (!rest.ok) throw new Error('unreachable')
    expect(rest.documents[0]).toMatchObject({ from: 2_000, text: 'x'.repeat(1_000), truncated: false })
  })

  it('asks nobody for a tile name, a host, or anything that is not a colon meaning', async () => {
    const hosts = vi.fn(async () => ['a.example'])
    for (const raw of ['deployments', 'https://evil.example', 'Host:Publications', 'host: publications', '', 'a:'.repeat(120)]) {
      expect(await readPool(raw, {}, deps({ hosts }))).toEqual({ ok: false, root: `pool ${raw.trim()}`, code: 'not-a-pool' })
    }
    expect(hosts).not.toHaveBeenCalled()
  })

  it('says so when the hive follows no hosts', async () => {
    expect(await readPool('host:publications', {}, deps({ hosts: async () => [] })))
      .toEqual({ ok: false, root: 'pool host:publications', code: 'no-hosts' })
  })
})
