// publish-results.spec.ts — the running list, and where its doors lead.
//
// A door is a name and an address a reader can open. The host opens a
// creation's own address, `<key>.<zone>` only when the key already IS a DNS
// label (it maps the label to the lineage verbatim), and `<top>.<zone>/<rest>`
// only when the top place is itself open there. Anything else is no door, so
// its name stays text rather than linking to "nothing published here". The
// list itself keeps every creation's deciding result however long it grows,
// and two results landing together both stay on it.

import { beforeEach, describe, expect, it } from 'vitest'

let doc: ArrayBuffer | null = null
let atoms: string[] = []
let failRead = false
const pool = {
  async *keys(): AsyncIterable<string> { for (const a of atoms) yield a },
} as unknown as FileSystemDirectoryHandle

;(window as unknown as { ioc: unknown }).ioc = {
  register: () => void 0,
  get: (key: string): unknown => key === '@hypercomb.social/Store'
    ? {
        opfsRoot: { getDirectoryHandle: async () => pool },
        getPool: async () => pool,
        getPoolDoc: async () => {
          await new Promise(r => setTimeout(r, 5))
          return failRead ? null : doc
        },
        putPoolDoc: async (_pool: unknown, bytes: ArrayBuffer) => {
          await new Promise(r => setTimeout(r, 5))
          doc = bytes
          atoms = ['f'.repeat(64)]
          return 'f'.repeat(64)
        },
      }
    : undefined,
}

const {
  compactResults, doorsOfIndex, doorsOfResults, listPublishResults, recordPublishResult,
} = await import('./publish-results.js')
type Result = import('./publish-results.js').PublishResultRecord

const r = (op: 'publish' | 'unpublish', segments: string[], at: number, extra: Partial<Result> = {}): Result => ({
  v: 1, op, at, segments, lineageKey: segments.join('/'), host: 'jwize.com',
  ...(op === 'publish' ? { address: `https://jwize.com/${segments.join('/')}` } : {}),
  ...extra,
})

describe('where a door leads', () => {
  it('is the subdomain only for a key that is already a DNS label', () => {
    const doors = doorsOfResults([r('publish', ['meetings'], 1), r('publish', ['Meetings Room'], 2)])
    expect(doors.map(d => [d.name, d.address])).toEqual([['meetings', 'https://meetings.jwize.com']])
  })

  it('walks into a nested creation only through a top place that is open on that zone', () => {
    const closed = doorsOfResults([r('publish', ['games', 'arkanoid'], 1)])
    expect(closed).toEqual([])
    const open = doorsOfResults([r('publish', ['games'], 1), r('publish', ['games', 'arkanoid'], 2)])
    expect(open.map(d => d.address)).toEqual(['https://games.jwize.com', 'https://games.jwize.com/arkanoid'])
  })

  it('keeps an own address, the apex included, whatever the key', () => {
    const doors = doorsOfResults([
      r('publish', ['Point Blank Solutions'], 1, { host: 'pointblanksolutions.ca', address: 'https://pointblanksolutions.ca' }),
      r('publish', ['card'], 2, { address: 'https://me.jwize.com' }),
      r('publish', ['Business Card'], 3, { address: 'https://card.jwize.com', own: true, zone: 'jwize.com' }),
      r('publish', ['Notes'], 4, { address: 'https://notes.jwize.com', own: false, zone: 'jwize.com' }),
    ])
    expect(doors.map(d => [d.name, d.address])).toEqual([
      ['Point Blank Solutions', 'https://pointblanksolutions.ca'],
      ['card', 'https://me.jwize.com'],
      ['Business Card', 'https://card.jwize.com'],
    ])
  })

  it('puts the door on the zone its address is on, not the host the index went through', () => {
    const [recorded] = doorsOfResults([r('publish', ['shop'], 1, { zone: 'pointblanksolutions.ca', address: 'https://shop.pointblanksolutions.ca' })])
    expect(recorded?.zone).toBe('pointblanksolutions.ca')
    const [older] = doorsOfResults([r('publish', ['shop'], 1, { address: 'https://pointblanksolutions.ca/shop' })])
    expect([older?.zone, older?.address]).toEqual(['pointblanksolutions.ca', 'https://shop.pointblanksolutions.ca'])
  })

  it('reads the same doors off a signed index, a root with no doors entry on the zone it was read from', () => {
    const doors = doorsOfIndex({
      roots: { meetings: 'a', 'Point-Blank': 'b', games: 'c', 'games/arkanoid': 'd', solo: 'e', 'stage:live': 'f' },
      doors: { meetings: ['jwize.com'], 'Point-Blank': ['pointblanksolutions.ca'], games: ['jwize.com'], 'games/arkanoid': ['jwize.com'] },
      addresses: { 'pointblanksolutions.ca': 'Point-Blank' },
      createdAt: 10,
    }, 'jwize.com')
    expect(doors.map(d => [d.lineageKey, d.zone, d.address])).toEqual([
      ['meetings', 'jwize.com', 'https://meetings.jwize.com'],
      ['Point-Blank', 'pointblanksolutions.ca', 'https://pointblanksolutions.ca'],
      ['games', 'jwize.com', 'https://games.jwize.com'],
      ['games/arkanoid', 'jwize.com', 'https://games.jwize.com/arkanoid'],
      ['solo', 'jwize.com', 'https://solo.jwize.com'],
    ])
  })
})

describe('the running list', () => {
  beforeEach(() => { doc = null; atoms = []; failRead = false })

  it('keeps the result that decides every creation however long the list grows', () => {
    const list: Result[] = [r('publish', ['meetings'], 1)]
    for (let i = 0; i < 600; i++) list.push(r('publish', ['card'], 10 + i))
    const kept = compactResults(list, 512)
    expect(kept).toHaveLength(512)
    expect(doorsOfResults(kept).map(d => d.name).sort()).toEqual(['card', 'meetings'])
  })

  it('keeps both of two results that land together', async () => {
    await Promise.all([
      recordPublishResult({ op: 'publish', at: 1, segments: ['meetings'], lineageKey: 'meetings', host: 'jwize.com', address: 'https://meetings.jwize.com' }),
      recordPublishResult({ op: 'publish', at: 2, segments: ['card'], lineageKey: 'card', host: 'jwize.com', address: 'https://card.jwize.com' }),
    ])
    expect((await listPublishResults()).map(x => x.lineageKey)).toEqual(['meetings', 'card'])
  })

  it('never rewrites a list it could not read as a list of one', async () => {
    await recordPublishResult({ op: 'publish', at: 1, segments: ['meetings'], lineageKey: 'meetings', host: 'jwize.com', address: 'https://meetings.jwize.com' })
    const before = doc
    failRead = true
    expect(await recordPublishResult({ op: 'unpublish', at: 2, segments: ['card'], lineageKey: 'card', host: 'jwize.com' })).toBe(false)
    expect(doc).toBe(before)
  })
})
