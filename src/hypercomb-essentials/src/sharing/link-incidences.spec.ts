// link-incidences.spec.ts — who names whom, read off the links the rule made.
//
// The derived record is proven pure: the same page and the same door table
// give the same key, a different table a different one; the incidences are
// exactly the links on the page, grouped by creation; the clusters fold the
// newest record per source creation (made with the current table, when it is
// known) into inbound and outbound ends keyed by creation AND zone, and a
// page naming itself makes no edge. The pool read is not repeated for a
// record already read.

import { afterEach, describe, expect, it } from 'vitest'

;(globalThis as unknown as { window: { ioc: unknown } }).window ??= { ioc: { register() {}, get() { return undefined } } }

import { compileDoors, linkify } from './domain-links.js'
import { clusterAt, clustersOf, incidenceKey, listIncidenceRecords, readIncidences, tableSignature, type LinkIncidenceRecord } from './link-incidences.js'
import type { PublishedDoor } from './publish-results.js'

const door = (name: string, zone: string): PublishedDoor => ({
  name, segments: [name], lineageKey: name, zone, address: `https://${name}.${zone}`, at: 1,
})
const sig = (c: string): string => c.repeat(64)

describe('readIncidences', () => {
  it('counts the links on a page by the creation they lead to', () => {
    const host = document.createElement('div')
    host.innerHTML = '<p>meetings, meetings and arkanoid.</p>'
    const entries = compileDoors([door('meetings', 'jwize.com'), door('arkanoid', 'pointblanksolutions.ca')])
    linkify(host, entries)
    expect(readIncidences(host)).toEqual([
      { lineageKey: 'meetings', zone: 'jwize.com', address: 'https://meetings.jwize.com/', count: 2 },
      { lineageKey: 'arkanoid', zone: 'pointblanksolutions.ca', address: 'https://arkanoid.pointblanksolutions.ca/', count: 1 },
    ])
  })
})

describe('keys', () => {
  it('derive from the inputs alone: same table in any order, same key; another table, another key', async () => {
    const a = compileDoors([door('meetings', 'jwize.com'), door('arkanoid', 'jwize.com')])
    const b = compileDoors([door('arkanoid', 'jwize.com'), door('meetings', 'jwize.com')])
    const c = compileDoors([door('meetings', 'jwize.com')])
    const [ta, tb, tc] = await Promise.all([tableSignature(a), tableSignature(b), tableSignature(c)])
    expect(ta).toBe(tb)
    expect(ta).not.toBe(tc)
    expect(await incidenceKey(sig('a'), ta)).toBe(await incidenceKey(sig('a'), tb))
    expect(await incidenceKey(sig('a'), ta)).not.toBe(await incidenceKey(sig('a'), tc))
    expect(await incidenceKey(sig('a'), ta)).not.toBe(await incidenceKey(sig('b'), ta))
  })

  it('carry the creation read from: one page atom in two creations is two records', async () => {
    const t = sig('t')
    const a = await incidenceKey(sig('p'), t, { lineageKey: 'a', zone: 'jwize.com' })
    const b = await incidenceKey(sig('p'), t, { lineageKey: 'b', zone: 'jwize.com' })
    expect(a).not.toBe(b)
    expect(a).not.toBe(await incidenceKey(sig('p'), t))
    expect(a).toBe(await incidenceKey(sig('p'), t, { lineageKey: 'a', zone: 'JWIZE.com' }))
    // the same key on another publisher's zone is another creation
    expect(a).not.toBe(await incidenceKey(sig('p'), t, { lineageKey: 'a', zone: 'pointblanksolutions.ca' }))
  })
})

describe('clustersOf', () => {
  const record = (
    page: string,
    at: number,
    from: { lineageKey: string; zone: string } | undefined,
    names: Array<[string, string, number]>,
    table = 't',
  ): LinkIncidenceRecord => ({
    v: 1, key: sig('k'), page: sig(page), table: sig(table), at, ...(from ? { from } : {}),
    names: names.map(([lineageKey, zone, count]) => ({ lineageKey, zone, address: `https://${lineageKey}.${zone}`, count })),
  })

  it('folds pages to inbound and outbound ends across zones', () => {
    const clusters = clustersOf([
      record('a', 1, { lineageKey: 'business-card', zone: 'jwize.com' }, [['pointblank', 'pointblanksolutions.ca', 3], ['business-card', 'jwize.com', 1]]),
      record('b', 1, { lineageKey: 'meetings', zone: 'jwize.com' }, [['pointblank', 'pointblanksolutions.ca', 1]]),
    ])
    expect(clusters.get('pointblank@pointblanksolutions.ca')?.inbound.map(e => [e.lineageKey, e.zone, e.count])).toEqual([
      ['business-card', 'jwize.com', 3],
      ['meetings', 'jwize.com', 1],
    ])
    expect(clusters.get('business-card@jwize.com')?.outbound.map(e => e.lineageKey)).toEqual(['pointblank'])
    // a page naming itself is no edge
    expect(clusters.get('business-card@jwize.com')?.inbound).toEqual([])
  })

  it('takes the newest record per source creation and ignores a page nobody owns', () => {
    const clusters = clustersOf([
      record('a', 1, { lineageKey: 'x', zone: 'z.com' }, [['old', 'z.com', 1]]),
      record('a', 2, { lineageKey: 'x', zone: 'z.com' }, [['new', 'z.com', 1]]),
      record('b', 9, undefined, [['new', 'z.com', 5]]),
    ])
    expect(clusters.has('old@z.com')).toBe(false)
    expect(clusters.get('new@z.com')?.inbound.map(e => e.count)).toEqual([1])
  })

  it('an edited page replaces its older version: the source answers once', () => {
    // P1 said Beta; the edit (a new page sig, P2) took the mention out.
    const clusters = clustersOf([
      record('1', 1, { lineageKey: 'alpha', zone: 'z.com' }, [['beta', 'z.com', 1]]),
      record('2', 2, { lineageKey: 'alpha', zone: 'z.com' }, []),
    ])
    expect(clusters.has('beta@z.com')).toBe(false)
    expect(clusters.has('alpha@z.com')).toBe(false)
  })

  it('given the current table, a newer record made with another table does not win', () => {
    // T1, then T2 (C published, P names it), then T1 again (C withdrawn):
    // the T2 record is newer but answers inputs that no longer hold.
    const records = [
      record('p', 1, { lineageKey: 'alpha', zone: 'z.com' }, [], 't1'),
      record('p', 2, { lineageKey: 'alpha', zone: 'z.com' }, [['charlie', 'z.com', 1]], 't2'),
    ]
    expect(clustersOf(records, sig('t1')).has('charlie@z.com')).toBe(false)
    expect(clustersOf(records, sig('t2')).get('charlie@z.com')?.inbound.map(e => e.lineageKey)).toEqual(['alpha'])
    // no table known (a visitor): the newest record stands
    expect(clustersOf(records).has('charlie@z.com')).toBe(true)
  })

  it('one page atom in two creations gives each its own edge', () => {
    const clusters = clustersOf([
      record('p', 1, { lineageKey: 'a', zone: 'z.com' }, [['b', 'z.com', 1]]),
      record('p', 2, { lineageKey: 'b', zone: 'z.com' }, [['a', 'z.com', 1]]),
    ])
    expect(clusters.get('a@z.com')?.outbound.map(e => e.lineageKey)).toEqual(['b'])
    expect(clusters.get('b@z.com')?.outbound.map(e => e.lineageKey)).toEqual(['a'])
  })

  it('two publishers with a same-named creation stay two clusters', () => {
    const clusters = clustersOf([
      record('p', 1, { lineageKey: 'meetings', zone: 'jwize.com' }, [['business-card', 'jwize.com', 1]]),
    ])
    expect(clusterAt(clusters, 'business-card', ['business-card.jwize.com', 'jwize.com'])?.inbound.map(e => e.lineageKey)).toEqual(['meetings'])
    // alice's business-card shares the key but not the zone: no lines
    expect(clusterAt(clusters, 'business-card', ['business-card.alice.com', 'alice.com'])).toBeUndefined()
  })

  it('clusterAt folds the ends of every zone a creation answers on', () => {
    const clusters = clustersOf([
      record('p', 1, { lineageKey: 'x', zone: 'a.com' }, [['site', 'a.com', 2]]),
      record('r', 1, { lineageKey: 'y', zone: 'a.com' }, [['site', 'b.com', 4]]),
    ])
    expect(clusterAt(clusters, 'site', ['a.com', 'b.com'])?.inbound.map(e => [e.lineageKey, e.count])).toEqual([['y', 4], ['x', 2]])
  })
})

describe('listIncidenceRecords', () => {
  // core's `get` falls back to the shell registry on globalThis.ioc
  const g = globalThis as unknown as { ioc?: unknown }
  const realIoc = g.ioc
  afterEach(() => { g.ioc = realIoc })

  it('reads a record once, then answers from what it read while the bucket stays', async () => {
    const rec = (n: string): LinkIncidenceRecord => ({ v: 1, key: sig(n), page: sig('a'), table: sig('b'), names: [], at: 1 })
    let buckets = [{ kind: 'directory', name: 'b1', doc: rec('1') }, { kind: 'directory', name: 'b2', doc: rec('2') }]
    let reads = 0
    const pool = { values: async function* () { yield* buckets } }
    const store = {
      openPool: async () => pool,
      getPoolDoc: async (bucket: { doc: LinkIncidenceRecord }) => {
        reads++
        return new TextEncoder().encode(JSON.stringify(bucket.doc)).buffer
      },
    }
    g.ioc = { get: (key: string) => key === '@hypercomb.social/Store' ? store : undefined }
    expect((await listIncidenceRecords()).length).toBe(2)
    expect(reads).toBe(2)
    expect((await listIncidenceRecords()).length).toBe(2)
    expect(reads).toBe(2)
    // a new bucket is read; a bucket gone from the pool is gone from the answer
    buckets = [buckets[1]!, { kind: 'directory', name: 'b3', doc: rec('3') }]
    expect((await listIncidenceRecords()).map(r => r.key)).toEqual([sig('2'), sig('3')])
    expect(reads).toBe(3)
  })

  it('answers nothing until a large pool is wholly read, then all of it', async () => {
    // A partial set could fold a source to its older record while the newer
    // bucket waits unread, so a capped listing is absent, never partial.
    const hex = (n: number): string => n.toString(16).padStart(64, '0')
    const rec = (n: number): LinkIncidenceRecord => ({ v: 1, key: hex(n), page: sig('a'), table: sig('b'), names: [], at: n })
    const buckets = Array.from({ length: 300 }, (_, n) => ({ kind: 'directory', name: `big${n}`, doc: rec(n) }))
    let reads = 0
    const pool = { values: async function* () { yield* buckets } }
    const store = {
      openPool: async () => pool,
      getPoolDoc: async (bucket: { doc: LinkIncidenceRecord }) => {
        reads++
        return new TextEncoder().encode(JSON.stringify(bucket.doc)).buffer
      },
    }
    g.ioc = { get: (key: string) => key === '@hypercomb.social/Store' ? store : undefined }
    expect(await listIncidenceRecords()).toEqual([])
    expect(reads).toBe(256)
    expect((await listIncidenceRecords()).length).toBe(300)
    expect(reads).toBe(300)
  })
})
