import { describe, expect, it } from 'vitest'
import { moleculeAddress, registerPoolMeaning } from '@hypercomb/core'
import {
  NEED_LIST_VALUE_MAX, NEED_LIST_VALUES_MAX, isNeedListKey, needListKey, needListMolecule, needListOf,
  needListPoolAddress, needListValues, offerNeedList,
} from './need-lists.js'
import type { HostOfferDeps } from './host-offer.js'

const SIG = 'f'.repeat(64)

/** A host offer that records what it was asked, failing where told to. */
const offerWorld = (fail: { publish?: string; stamp?: string | true } = {}) => {
  const calls: string[] = []
  const put: { text: string; type: string }[] = []
  const stamped: { host: string; key: string; sig: string }[] = []
  const deps: HostOfferDeps = {
    put: async (text, type) => { calls.push('put'); put.push({ text, type }); return SIG },
    publish: async (host, sigs) => {
      calls.push(`publish ${host} ${sigs.join(',')}`)
      return fail.publish ? { ok: false, error: fail.publish } : { ok: true }
    },
    stamp: async (host, key, sig) => {
      calls.push('stamp')
      stamped.push({ host, key, sig })
      if (fail.stamp === true) return { ok: false }
      return fail.stamp ? { ok: false, reason: fail.stamp } : { ok: true }
    },
    now: () => 1_700_000_000_000,
  }
  return { deps, calls, put, stamped }
}

describe('need lists — the key and the pool', () => {
  it('keys a name by its molecule address, never the name', async () => {
    const key = await needListKey('Recipes')
    expect(key).toBe(`list:${await moleculeAddress('Recipes')}`)
    expect(isNeedListKey(key!)).toBe(true)
    expect(needListMolecule(key!)).toBe(await moleculeAddress('Recipes'))
    expect(key).not.toContain('Recipes')
  })

  it('the empty name has no key and no pool', async () => {
    expect(await needListKey('')).toBeNull()
    expect(await needListKey('   ')).toBeNull()
    expect(await needListPoolAddress('')).toBeNull()
  })

  it('the pool is the derived address of the key', async () => {
    const key = (await needListKey('recipes'))!
    expect(await needListPoolAddress('recipes')).toBe(await registerPoolMeaning(key))
  })

  it('tells its keys from any other', () => {
    expect(isNeedListKey(`pictures:${'a'.repeat(64)}`)).toBe(false)
    expect(isNeedListKey(`list:${'A'.repeat(64)}`)).toBe(false)
    expect(isNeedListKey('list:abc')).toBe(false)
    expect(needListMolecule('page:abc')).toBe('')
  })
})

describe('need lists — the record', () => {
  it('collapses spacing, drops empty and over-long values, never cuts', () => {
    const long = 'x'.repeat(NEED_LIST_VALUE_MAX + 1)
    const edge = 'y'.repeat(NEED_LIST_VALUE_MAX)
    expect(needListValues(['  olive   oil ', '', '   ', long, edge, 7, null])).toEqual(['olive oil', edge])
  })

  it('dedupes by case, keeping the first spelling', () => {
    expect(needListValues(['Soup', 'soup', 'SOUP ', 'bread', 'Bread'])).toEqual(['Soup', 'bread'])
  })

  it(`carries ${NEED_LIST_VALUES_MAX} values at most`, () => {
    const many = Array.from({ length: NEED_LIST_VALUES_MAX + 40 }, (_, i) => `v${i}`)
    const kept = needListValues(many)
    expect(kept.length).toBe(NEED_LIST_VALUES_MAX)
    expect(kept[0]).toBe('v0')
  })

  it('reads a record field by field, in canonical order', async () => {
    const record = await needListOf({ at: 5, values: ['a', 'A', 'b'], name: '  recipes ', kind: 'need-list', extra: 1 })
    expect(record).toEqual({ kind: 'need-list', name: 'recipes', values: ['a', 'b'], at: 5 })
    expect(Object.keys(record!)).toEqual(['kind', 'name', 'values', 'at'])
  })

  it('is not a record without its kind, a name, or a value', async () => {
    expect(await needListOf({ kind: 'i18n-catalog', name: 'recipes', values: ['a'], at: 1 })).toBeNull()
    expect(await needListOf({ kind: 'need-list', name: ' ', values: ['a'], at: 1 })).toBeNull()
    expect(await needListOf({ kind: 'need-list', name: 'recipes', values: [], at: 1 })).toBeNull()
    expect(await needListOf(null)).toBeNull()
    expect(await needListOf('need-list')).toBeNull()
  })

  it('is ignored unless its name is the molecule its key named', async () => {
    const m = await moleculeAddress('recipes')
    const raw = { kind: 'need-list', name: 'Recipes', values: ['a'], at: 1 }
    expect(await needListOf(raw, m)).not.toBeNull()
    expect(await needListOf(raw, m.toUpperCase())).not.toBeNull()
    expect(await needListOf({ ...raw, name: 'cakes' }, m)).toBeNull()
    expect(await needListOf(raw, 'not-a-molecule')).toBeNull()
  })
})

describe('need lists — the offer', () => {
  it('puts the record, publishes it to the host, then stamps list:<m> in the index', async () => {
    const { deps, calls, put, stamped } = offerWorld()
    const done = await offerNeedList('example.com', 'recipes', ['Soup', 'soup', 'bread'], deps)
    expect(done).toEqual({ ok: true, sig: SIG, record: { kind: 'need-list', name: 'recipes', values: ['Soup', 'bread'], at: 1_700_000_000_000 } })
    expect(calls).toEqual(['put', `publish example.com ${SIG}`, 'stamp'])
    expect(put[0]!.type).toBe('application/json')
    expect(JSON.parse(put[0]!.text)).toEqual({ kind: 'need-list', name: 'recipes', values: ['Soup', 'bread'], at: 1_700_000_000_000 })
    expect(put[0]!.text.indexOf('"kind"')).toBeLessThan(put[0]!.text.indexOf('"values"'))
    expect(stamped).toEqual([{ host: 'example.com', key: `list:${await moleculeAddress('recipes')}`, sig: SIG }])
  })

  it('refuses before writing anything: no host, no name, no values', async () => {
    const world = offerWorld()
    expect(await offerNeedList(' ', 'recipes', ['a'], world.deps)).toEqual({ ok: false, error: 'no host is named for this list' })
    expect(await offerNeedList('example.com', '', ['a'], world.deps)).toEqual({ ok: false, error: 'a list needs a tile name' })
    expect(await offerNeedList('example.com', 'recipes', ['  ', 'z'.repeat(NEED_LIST_VALUE_MAX + 1)], world.deps))
      .toEqual({ ok: false, error: 'nothing to offer: no values for that name' })
    expect(world.calls).toEqual([])
  })

  it('reports a publish that failed, and stamps nothing', async () => {
    const { deps, calls } = offerWorld({ publish: 'the host refused the atoms' })
    expect(await offerNeedList('example.com', 'recipes', ['a'], deps)).toEqual({ ok: false, error: 'the host refused the atoms' })
    expect(calls).toEqual(['put', `publish example.com ${SIG}`])
  })

  it('reports a stamp that failed, with its reason or the default', async () => {
    const withReason = offerWorld({ stamp: 'no key to sign with' })
    expect(await offerNeedList('example.com', 'recipes', ['a'], withReason.deps)).toEqual({ ok: false, error: 'no key to sign with' })
    const bare = offerWorld({ stamp: true })
    expect(await offerNeedList('example.com', 'recipes', ['a'], bare.deps)).toEqual({ ok: false, error: 'the list was not named in your index' })
  })
})
