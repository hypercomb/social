// core/layer-combine.spec.ts
import { describe, expect, it } from 'vitest'
import { combineBags, combineLayers, nothingLost } from './layer-combine.js'

const S = (c: string) => c.repeat(64)
const [A, B, C, D] = [S('a'), S('b'), S('c'), S('d')]

describe('combineLayers', () => {
  it('unions lists: own order first, incoming appended, nothing dropped', () => {
    const own = { name: 'x', children: [A, B], notes: [A] }
    const r = combineLayers(own, { name: 'x', children: [C, A], notes: [B] })
    expect(r.layer.children).toEqual([A, B, C])
    expect(r.layer.notes).toEqual([A, B])
    expect(r.changed).toBe(true)
    expect(nothingLost(own, r.layer)).toBe(true)
  })

  it('an incoming list that omits own children never drops them', () => {
    const own = { name: 'x', children: [A, B, C] }
    const r = combineLayers(own, { name: 'x', children: [D] })
    expect(r.layer.children).toEqual([A, B, C, D])
    expect(combineLayers(own, { name: 'x', children: [] }).layer.children).toEqual([A, B, C])
  })

  it('scalars: own wins, incoming fills absent', () => {
    const r = combineLayers({ name: 'x', cells: undefined, mood: 'mine', blank: '' }, { name: 'x', mood: 'theirs', blank: 'filled', extra: 'new' })
    expect(r.layer.mood).toBe('mine')
    expect(r.layer.blank).toBe('filled')
    expect(r.layer.extra).toBe('new')
  })

  it('name: own, else incoming', () => {
    expect(combineLayers({ name: 'mine' }, { name: 'theirs' }).layer.name).toBe('mine')
    expect(combineLayers(null, { name: 'theirs' }).layer.name).toBe('theirs')
  })

  it('blob slots: own blob stands, a differing incoming blob is reported, an absent one is filled', () => {
    const r = combineLayers({ name: 'x', properties: [A] }, { name: 'x', properties: [B], order: [C] })
    expect(r.layer.properties).toEqual([A])
    expect(r.layer.order).toEqual([C])
    expect(r.blobs).toEqual([{ slot: 'properties', own: A, incoming: B }])
  })

  it('same-name child under a different sig keeps the owner sig and reports it', () => {
    const names: Record<string, string> = { [A]: 'menu', [B]: 'specials', [C]: 'menu', [D]: 'new' }
    const r = combineLayers(
      { name: 'p', children: [A, B] },
      { name: 'p', children: [C, D] },
      { nameOf: s => names[s] },
    )
    expect(r.layer.children).toEqual([A, B, D])
    expect(r.sameName).toEqual([{ slot: 'children', name: 'menu', own: A, incoming: C }])
  })

  it('is idempotent and no-op on identical input', () => {
    const own = { name: 'x', children: [A], properties: [B] }
    const r = combineLayers(own, own)
    expect(r.changed).toBe(false)
    expect(combineLayers(r.layer, own).changed).toBe(false)
  })

  it('does not mutate its inputs', () => {
    const own = { name: 'x', children: [A] }
    const inc = { name: 'x', children: [B] }
    combineLayers(own, inc)
    expect(own.children).toEqual([A])
    expect(inc.children).toEqual([B])
  })

  it('dedups inline payloads by JSON key', () => {
    const r = combineLayers({ name: 'x', tags: [{ k: 1 }] }, { name: 'x', tags: [{ k: 1 }, { k: 2 }] })
    expect(r.layer.tags).toEqual([{ k: 1 }, { k: 2 }])
  })
})

describe('combineBags', () => {
  it('own keys win, incoming fills absent', () => {
    const r = combineBags({ link: 'mine', tags: ['a'] }, { link: 'theirs', tags: ['b'], accent: 'red' })
    expect(r.bag).toEqual({ link: 'mine', tags: ['a'], accent: 'red' })
    expect(r.changed).toBe(true)
  })

  it('a worn picture is one unit: no incoming picture key is mixed in', () => {
    const r = combineBags({ large: { image: A } }, { small: { image: B }, flat: { small: { image: B } }, link: 'l' })
    expect(r.bag).toEqual({ large: { image: A }, link: 'l' })
  })

  it('an absent picture is filled whole; skip keys are never taken', () => {
    const r = combineBags({}, { small: { image: B }, large: { image: C }, index: 3 }, { skip: ['index'] })
    expect(r.bag).toEqual({ small: { image: B }, large: { image: C } })
  })

  it('no-op when the owner already has everything', () => {
    expect(combineBags({ a: 1 }, { a: 2 }).changed).toBe(false)
  })
})
