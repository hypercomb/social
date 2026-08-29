import { beforeEach, describe, expect, it } from 'vitest'
import { GROUP_DECORATION_KIND, groupSignature } from '@hypercomb/core'
import {
  SITE_ARTIFACT_KIND,
  carries,
  enrolledCells,
  forgetEnrollments,
  nextOrder,
  ordered,
  payloadOf,
  payloadsOf,
  readCell,
  siteMeaning,
  siteNameOf,
  siteSlug,
  type CellEnrollment,
} from './enrollment.js'

const SLIDE_KIND = 'visual:diagram:slide'
const GALLERY_KIND = 'visual:lightbox:gallery'

/** Distinct sig-SHAPED names. Everything the model reads filters on 64-hex, so
 *  a readable stand-in like 'd1' is invisible to it — a test record has to look
 *  like the real thing. Names are global because the sig→record cache is keyed
 *  by signature and content-addressed bytes never change: reusing a name across
 *  two different records would be a test bug, not a cache bug. */
let minted = 0
const named = new Map<string, string>()
const hex = (label: string): string => {
  const known = named.get(label)
  if (known) return known
  const value = (++minted).toString(16).padStart(64, '0')
  named.set(label, value)
  return value
}

const jsonBlob = (value: unknown): Blob => {
  const text = JSON.stringify(value)
  return { size: text.length, text: async () => text } as unknown as Blob
}

const makeStore = () => {
  const records = new Map<string, unknown>()
  return {
    records,
    put(label: string, value: unknown): string {
      const key = hex(label)
      records.set(key, value)
      return key
    },
    async getResourceLocal(s: string): Promise<Blob | null> {
      return records.has(s) ? jsonBlob(records.get(s)) : null
    },
  }
}

describe('site meanings', () => {
  it('scopes every meaning with a colon so it can never collide with a location', () => {
    // `lineageKey` folds every non-alphanumeric to `-`, so a colon is the one
    // thing a lineage sigbag or a pool address can never contain.
    expect(siteMeaning('pitch')).toBe('site:pitch')
    expect(siteMeaning('pitch')).toContain(':')
  })

  it('normalizes before minting, because a signature is forever', () => {
    expect(siteSlug('My  Pitch!')).toBe('my-pitch')
    expect(siteMeaning('My  Pitch!')).toBe(siteMeaning('my-pitch'))
    expect(siteNameOf('site:my-pitch')).toBe('my-pitch')
  })

  it('refuses to mint a bare site: from an empty name', () => {
    expect(siteMeaning('   ')).toBe('')
    expect(siteMeaning('!!!')).toBe('')
  })
})

describe('readCell — type-agnostic on purpose', () => {
  it('hands back every kind the cell carries, so no behaviour is taught another', async () => {
    const store = makeStore()
    const g = hex('read:group-sig')
    store.put('read:slide', { kind: SLIDE_KIND, payload: { content: hex('read:bytes'), title: 'One' } })
    store.put('read:enrol', { kind: GROUP_DECORATION_KIND, payload: { sig: g, meaning: 'site:pitch', order: 3 } })
    store.put('read:tag', { kind: 'tag', payload: { name: 'draft' } })
    store.put('read:gallery', { kind: GALLERY_KIND, payload: { images: [hex('read:img')] } })

    const cell = await readCell(store, {
      decorations: [hex('read:slide'), hex('read:enrol'), hex('read:tag'), hex('read:gallery')],
    }, ['a'])

    expect(payloadOf(cell, SLIDE_KIND)?.['title']).toBe('One')
    expect(payloadsOf(cell, GALLERY_KIND)).toHaveLength(1)
    expect(carries(cell, GALLERY_KIND)).toBe(true)
    expect(cell.enrollments).toEqual([{ sig: g, meaning: 'site:pitch', order: 3 }])
    expect(cell.marks).toEqual(['draft'])
    expect(cell.names).toBeNull()
  })

  it('does not stop at the first content record — a membership can sit after it', async () => {
    const store = makeStore()
    const g = hex('after:group-sig')
    store.put('after:slide', { kind: SLIDE_KIND, payload: {} })
    store.put('after:enrol', { kind: GROUP_DECORATION_KIND, payload: { sig: g, meaning: 'site:pitch' } })
    const cell = await readCell(store, { decorations: [hex('after:slide'), hex('after:enrol')] })
    expect(cell.enrollments).toHaveLength(1)
  })

  it('makes a site a member of its own relation even with no membership record', async () => {
    const store = makeStore()
    const g = hex('own:group-sig')
    store.put('own:artifact', {
      kind: SITE_ARTIFACT_KIND,
      payload: { groupSig: g, meaning: 'site:pitch', name: 'pitch' },
    })
    const cell = await readCell(store, { decorations: [hex('own:artifact')] })
    expect(cell.names?.name).toBe('pitch')
    expect(cell.enrollments.map(e => e.sig)).toEqual([g])
  })

  it('answers empty for a cell with no decorations', async () => {
    const cell = await readCell(makeStore(), { name: 'plain' }, ['plain'])
    expect(cell.enrollments).toEqual([])
    expect(cell.names).toBeNull()
    expect(payloadOf(cell, SLIDE_KIND)).toBeNull()
  })
})

describe('enrolledCells — the relation is a mark, not containment', () => {
  beforeEach(() => forgetEnrollments())

  /** A hive where two members of one site are filed in DIFFERENT branches,
   *  which no container model could express — and where a PHOTO and a SLIDE are
   *  in the same site, which no typed container could express either. */
  const makeHive = async () => {
    const store = makeStore()
    const g = await groupSignature('site:pitch')
    const other = await groupSignature('site:notes')

    store.put('hive:slide', { kind: SLIDE_KIND, payload: { content: hex('hive:bytes'), title: 'A' } })
    store.put('hive:photo', { kind: GALLERY_KIND, payload: { images: [hex('hive:img')] } })
    store.put('hive:elsewhere', { kind: SLIDE_KIND, payload: { content: hex('hive:bytes2'), title: 'C' } })
    store.put('hive:in0', { kind: GROUP_DECORATION_KIND, payload: { sig: g, meaning: 'site:pitch', order: 0 } })
    store.put('hive:in1', { kind: GROUP_DECORATION_KIND, payload: { sig: g, meaning: 'site:pitch', order: 1 } })
    store.put('hive:inNotes', { kind: GROUP_DECORATION_KIND, payload: { sig: other, meaning: 'site:notes', order: 0 } })
    store.put('hive:artifact', {
      kind: SITE_ARTIFACT_KIND,
      payload: { groupSig: g, meaning: 'site:pitch', name: 'pitch' },
    })

    const layers: Record<string, Record<string, unknown>> = {
      '': { name: 'root', children: ['@work', '@personal', '@pitch'] },
      'work': { name: 'work', children: ['@b'] },
      'work/b': { name: 'b', decorations: [hex('hive:photo'), hex('hive:in1')] },
      'personal': { name: 'personal', children: ['@a', '@c'] },
      'personal/a': { name: 'a', decorations: [hex('hive:slide'), hex('hive:in0')] },
      'personal/c': { name: 'c', decorations: [hex('hive:elsewhere'), hex('hive:inNotes')] },
      'pitch': { name: 'pitch', decorations: [hex('hive:artifact')] },
    }
    const names: Record<string, string> = {
      '@work': 'work', '@personal': 'personal', '@pitch': 'pitch', '@a': 'a', '@b': 'b', '@c': 'c',
    }
    const history = {
      async sign(l: { explorerSegments?: () => readonly string[] }) {
        return (l.explorerSegments?.() ?? []).join('/')
      },
      async currentLayerAt(s: string) { return layers[s] ?? null },
      async getLayerBySig(s: string) { return names[s] ? { name: names[s] } : null },
    }
    return { store, history, g, other }
  }

  it('finds members across unrelated branches — a member filed elsewhere is still a member', async () => {
    const { store, history, g } = await makeHive()
    const found = await enrolledCells(history, store, [g])
    expect(found.map(c => c.segments.join('/')).sort())
      .toEqual(['personal/a', 'pitch', 'work/b'])
  })

  it('puts a photo and a slide in one set, because a set has no member type', async () => {
    const { store, history, g } = await makeHive()
    const found = await enrolledCells(history, store, [g])
    const kinds = found.map(c => (carries(c, SLIDE_KIND) ? 'slide' : carries(c, GALLERY_KIND) ? 'photo' : 'site'))
    expect(new Set(kinds)).toEqual(new Set(['slide', 'photo', 'site']))
  })

  it('leaves another site alone', async () => {
    const { store, history, other } = await makeHive()
    const found = await enrolledCells(history, store, [other])
    expect(found.map(c => c.segments.join('/'))).toEqual(['personal/c'])
  })

  it('orders by the position on the MARK, not by where the tile is filed', async () => {
    const { store, history, g } = await makeHive()
    const list = ordered(await enrolledCells(history, store, [g]), [g])
    // personal/a is order 0, work/b is order 1, the site artifact is unplaced.
    expect(list.map(c => c.segments.join('/'))).toEqual(['personal/a', 'work/b', 'pitch'])
  })

  it('answers nothing for no marks rather than walking the hive', async () => {
    const { store, history } = await makeHive()
    expect(await enrolledCells(history, store, [])).toEqual([])
  })
})

describe('position is an attribute of the membership, never of the artifact', () => {
  const cell = (order: number | undefined, groupSig: string): CellEnrollment => ({
    segments: ['x'], name: 'x', layer: {}, names: null, marks: [], payloads: new Map(),
    enrollments: [order === undefined
      ? { sig: groupSig, meaning: 'site:pitch' }
      : { sig: groupSig, meaning: 'site:pitch', order }],
  })

  it('takes the next free position from the members themselves', () => {
    const g = hex('pos:mine')
    expect(nextOrder([cell(0, g), cell(4, g)], [g])).toBe(5)
    expect(nextOrder([], [g])).toBe(0)
  })

  it('ignores positions belonging to a DIFFERENT site', () => {
    // The whole point: one tile in two sites carries two marks with two
    // positions, and neither site can renumber the other.
    const mine = hex('pos:a')
    const theirs = hex('pos:b')
    expect(nextOrder([cell(9, theirs)], [mine])).toBe(0)
  })

  it('accepts a caller-supplied fallback so container-model sets keep their sequence', () => {
    const g = hex('pos:legacy')
    expect(nextOrder([cell(undefined, g)], [g], () => 7)).toBe(8)
  })
})
