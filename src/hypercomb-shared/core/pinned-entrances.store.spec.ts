// hypercomb-shared/core/pinned-entrances.store.spec.ts
//
// The pin REACH rule: a pinned entrance shows on the page it was dropped on
// and nowhere else, unless its behavior CASCADES — then it stays up for as
// long as you are standing inside that entrance's subtree.

import { beforeEach, describe, expect, it } from 'vitest'
import { PinnedEntrancesStore, withinSubtree, type PinnedEntrance } from './pinned-entrances.store'
import type { DocumentStoreLike } from './participant-document'

/** A cascading behavior rooted at `root`; anything else is node-local. */
const resolver = (cascading: Record<string, string[]>) =>
  (pin: PinnedEntrance) => ({
    cascades: !!pin.view && pin.view in cascading,
    root: (pin.view && cascading[pin.view]) || pin.segments || [],
  })

const pin = (memberKey: string, view: string, segments: string[]): PinnedEntrance =>
  ({ groupId: 'websites', memberKey, icon: 'language', label: memberKey, view, segments })

const keysOf = (entries: { pin: PinnedEntrance }[]) => entries.map(e => e.pin.memberKey).sort()

describe('withinSubtree', () => {
  it('contains the root itself and everything below it', () => {
    expect(withinSubtree(['a', 'site'], ['a', 'site'])).toBe(true)
    expect(withinSubtree(['a', 'site', 'deep'], ['a', 'site'])).toBe(true)
  })

  it('excludes ancestors and sibling branches', () => {
    expect(withinSubtree(['a'], ['a', 'site'])).toBe(false)
    expect(withinSubtree(['a', 'other'], ['a', 'site'])).toBe(false)
    expect(withinSubtree(['b', 'site'], ['a', 'site'])).toBe(false)
  })

  it('treats the hive root as containing everything', () => {
    expect(withinSubtree(['a', 'b'], [])).toBe(true)
  })

  it('normalizes both sides so raw and descent paths agree', () => {
    expect(withinSubtree(['My Site', 'Page One'], ['my-site'])).toBe(true)
  })
})

describe('pinsForLocation', () => {
  let pinnedEntrances: PinnedEntrancesStore
  beforeEach(() => { localStorage.clear(); pinnedEntrances = new PinnedEntrancesStore() })

  it('shows a node-local pin ONLY on the page it was dropped on', () => {
    pinnedEntrances.addPin(['a'], pin('site', 'website', ['a', 'site']))
    const resolve = resolver({})   // website is node-local

    expect(keysOf(pinnedEntrances.pinsForLocation(['a'], resolve))).toEqual(['site'])
    // Entering the site itself, or going deeper, drops it.
    expect(pinnedEntrances.pinsForLocation(['a', 'site'], resolve)).toEqual([])
    expect(pinnedEntrances.pinsForLocation(['a', 'site', 'deep'], resolve)).toEqual([])
    expect(pinnedEntrances.pinsForLocation([], resolve)).toEqual([])
  })

  it('keeps a CASCADING pin up throughout the entrance subtree', () => {
    pinnedEntrances.addPin(['a'], pin('drop', 'dropbox', ['a', 'drop']))
    const resolve = resolver({ dropbox: ['a', 'drop'] })

    expect(keysOf(pinnedEntrances.pinsForLocation(['a'], resolve))).toEqual(['drop'])
    expect(keysOf(pinnedEntrances.pinsForLocation(['a', 'drop'], resolve))).toEqual(['drop'])
    expect(keysOf(pinnedEntrances.pinsForLocation(['a', 'drop', 'x', 'y'], resolve))).toEqual(['drop'])
  })

  it('does not leak a cascading pin onto sibling branches or ancestors', () => {
    pinnedEntrances.addPin(['a'], pin('drop', 'dropbox', ['a', 'drop']))
    const resolve = resolver({ dropbox: ['a', 'drop'] })

    expect(pinnedEntrances.pinsForLocation(['a', 'other'], resolve)).toEqual([])
    expect(pinnedEntrances.pinsForLocation(['b'], resolve)).toEqual([])
    expect(pinnedEntrances.pinsForLocation([], resolve)).toEqual([])
  })

  it('reports the level that STORES a cascaded pin, so removal targets it', () => {
    pinnedEntrances.addPin(['a'], pin('drop', 'dropbox', ['a', 'drop']))
    const resolve = resolver({ dropbox: ['a', 'drop'] })

    const [entry] = pinnedEntrances.pinsForLocation(['a', 'drop', 'deep'], resolve)
    expect(entry.level).toEqual(['a'])

    pinnedEntrances.removePin(entry.level, entry.pin.groupId, entry.pin.memberKey)
    expect(pinnedEntrances.pinsForLocation(['a', 'drop', 'deep'], resolve)).toEqual([])
  })

  it('lists a pin once when it is both pinned here and cascading here', () => {
    // Pinned AT the entrance root — direct and in-subtree at the same time.
    pinnedEntrances.addPin(['a', 'drop'], pin('drop', 'dropbox', ['a', 'drop']))
    const entries = pinnedEntrances.pinsForLocation(['a', 'drop'], resolver({ dropbox: ['a', 'drop'] }))

    expect(entries).toHaveLength(1)
    expect(entries[0].level).toEqual(['a', 'drop'])   // the direct claim wins
  })

  it('never cascades an entrance that has no hive location', () => {
    pinnedEntrances.addPin(['a'], pin('solomon', 'game', []))
    // Declared cascading, but segments are empty — an overlay game roots nowhere.
    expect(pinnedEntrances.pinsForLocation(['a', 'x'], resolver({ game: [] }))).toEqual([])
  })
})

describe('the pin record', () => {
  const settle = async (): Promise<void> => { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0)) }

  it('reads the per-level legacy keys once, then writes ONE document and never localStorage', async () => {
    localStorage.clear()
    localStorage.setItem('hc:pinned-entrances:/a', JSON.stringify([pin('site', 'website', ['a', 'site'])]))
    localStorage.setItem('hc:pinned-entrances:/', JSON.stringify([pin('root', 'website', ['root'])]))
    let ready: ((s: DocumentStoreLike) => void) | null = null
    const store = new PinnedEntrancesStore({ whenStore: r => { ready = r } })
    // the walk-back: both levels, painted before the disk has answered
    expect(keysOf(store.pinsForLocation(['a'], resolver({})))).toEqual(['site'])
    expect(keysOf(store.pinsForLocation([], resolver({})))).toEqual(['root'])

    const docs = new Map<string, string>()
    const created: string[] = []
    const fake: DocumentStoreLike = {
      openPool: async () => null,
      getPool: async m => { created.push(m); return { name: m } as unknown as FileSystemDirectoryHandle },
      putPoolDoc: async (_p, bytes) => { docs.set('doc', new TextDecoder().decode(bytes)); return 'f'.repeat(64) },
    }
    ready!(fake)
    store.addPin(['a'], pin('other', 'website', ['a', 'other']))
    await settle()
    expect(created).toEqual(['entrances:pinned'])
    const record = JSON.parse(docs.get('doc')!)
    expect(Object.keys(record).sort()).toEqual(['', 'a'])
    expect(record['a'].map((p: PinnedEntrance) => p.memberKey)).toEqual(['site', 'other'])
    // the legacy keys are exactly as they were — read, never advanced, never removed
    expect(Object.keys(localStorage).filter(k => k.startsWith('hc:pinned-entrances:/')).sort()).toEqual(['hc:pinned-entrances:/', 'hc:pinned-entrances:/a'])
    expect(JSON.parse(localStorage.getItem('hc:pinned-entrances:/a')!)).toHaveLength(1)
  })
})
