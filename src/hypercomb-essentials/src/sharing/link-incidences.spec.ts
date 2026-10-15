// link-incidences.spec.ts — who names whom, read off the links the rule made.
//
// The derived record is proven pure: the same page and the same door table
// give the same key, a different table a different one; the incidences are
// exactly the links on the page, grouped by creation; the clusters fold the
// newest record per page into inbound and outbound ends, and a page naming
// itself makes no edge.

import { describe, expect, it } from 'vitest'

;(globalThis as unknown as { window: { ioc: unknown } }).window ??= { ioc: { register() {}, get() { return undefined } } }

import { compileDoors, linkify } from './domain-links.js'
import { clustersOf, incidenceKey, readIncidences, tableSignature, type LinkIncidenceRecord } from './link-incidences.js'
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
})

describe('clustersOf', () => {
  const record = (page: string, at: number, from: { lineageKey: string; zone: string } | undefined, names: Array<[string, string, number]>): LinkIncidenceRecord => ({
    v: 1, key: sig('k'), page: sig(page), table: sig('t'), at, ...(from ? { from } : {}),
    names: names.map(([lineageKey, zone, count]) => ({ lineageKey, zone, address: `https://${lineageKey}.${zone}`, count })),
  })

  it('folds pages to inbound and outbound ends across zones', () => {
    const clusters = clustersOf([
      record('a', 1, { lineageKey: 'business-card', zone: 'jwize.com' }, [['pointblank', 'pointblanksolutions.ca', 3], ['business-card', 'jwize.com', 1]]),
      record('b', 1, { lineageKey: 'meetings', zone: 'jwize.com' }, [['pointblank', 'pointblanksolutions.ca', 1]]),
    ])
    expect(clusters.get('pointblank')?.inbound.map(e => [e.lineageKey, e.zone, e.count])).toEqual([
      ['business-card', 'jwize.com', 3],
      ['meetings', 'jwize.com', 1],
    ])
    expect(clusters.get('business-card')?.outbound.map(e => e.lineageKey)).toEqual(['pointblank'])
    // a page naming itself is no edge
    expect(clusters.get('business-card')?.inbound).toEqual([])
  })

  it('takes the newest record per page and ignores a page nobody owns', () => {
    const clusters = clustersOf([
      record('a', 1, { lineageKey: 'x', zone: 'z.com' }, [['old', 'z.com', 1]]),
      record('a', 2, { lineageKey: 'x', zone: 'z.com' }, [['new', 'z.com', 1]]),
      record('b', 9, undefined, [['new', 'z.com', 5]]),
    ])
    expect(clusters.has('old')).toBe(false)
    expect(clusters.get('new')?.inbound.map(e => e.count)).toEqual([1])
  })
})
