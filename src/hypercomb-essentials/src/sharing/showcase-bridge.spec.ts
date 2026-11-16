import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  ;(globalThis as unknown as { window: unknown }).window = globalThis
  ;(globalThis as unknown as { ioc: unknown }).ioc = { register: () => {}, get: () => undefined, whenReady: () => {} }
})

import { applyInvite, applyPublish, applyStage, applyToggle, applyView } from './showcase-bridge.js'
import type { Showcase } from './showcase-record.js'
import { ROOT_MOVED } from './hive-pointer.js'

const key = 'a'.repeat(64)
const empty: Showcase = { zone: 'example.com', items: [], domains: [] }
const request = { zone: 'example.com', pubkey: key, lineage: 'dylan', on: true }
/** Optimizing has its own case below; elsewhere it always succeeds and touches no network. */
const promote = async () => ({ ok: true as const, promoted: false })

describe('applyToggle', () => {
  it('puts a creation in, signs the record once, and does nothing when asked again', async () => {
    const sign = vi.fn(async (_record: Showcase) => ({ ok: true as const, sig: 'b'.repeat(64) }))
    const deps = { own: async () => key, read: async () => empty, sign, promote }
    expect(await applyToggle(request, deps)).toEqual({ ok: true, changed: true })
    expect(sign).toHaveBeenCalledTimes(1)
    expect(sign.mock.calls[0]![0].items).toEqual([{ pubkey: key, lineage: 'dylan' }])
    const there: Showcase = { ...empty, items: [{ pubkey: key, lineage: 'dylan' }] }
    expect(await applyToggle(request, { ...deps, read: async () => there })).toEqual({ ok: true, changed: false })
    expect(sign).toHaveBeenCalledTimes(1)
  })

  it('going live optimizes your own creation first, and one that cannot be optimized does not go live', async () => {
    // jwize 2026-11-13: "toggle from domain, toggle from off items in community to live, no other interface".
    const sign = vi.fn(async (_record: Showcase) => ({ ok: true as const, sig: 'b'.repeat(64) }))
    const optimized = vi.fn(async () => ({ ok: true as const, promoted: true }))
    expect(await applyToggle(request, { own: async () => key, read: async () => empty, sign, promote: optimized })).toEqual({ ok: true, changed: true })
    expect(optimized).toHaveBeenCalledWith('example.com', 'dylan')
    const failed = vi.fn(async () => ({ ok: false as const, reason: 'other is not published on example.com yet' }))
    expect(await applyToggle({ ...request, lineage: 'other' }, { own: async () => key, read: async () => empty, sign, promote: failed }))
      .toEqual({ ok: false, reason: 'other is not published on example.com yet' })
    expect(sign).toHaveBeenCalledTimes(1)
    // Another key's creation is theirs to promote, and taking one out is never gated.
    const never = vi.fn(async () => ({ ok: false as const, reason: 'no' }))
    expect(await applyToggle({ ...request, pubkey: 'c'.repeat(64) }, { own: async () => key, read: async () => empty, sign, promote: never })).toEqual({ ok: true, changed: true })
    const there: Showcase = { ...empty, items: [{ pubkey: key, lineage: 'dylan' }] }
    expect(await applyToggle({ ...request, on: false }, { own: async () => key, read: async () => there, sign, promote: never })).toEqual({ ok: true, changed: true })
    expect(never).not.toHaveBeenCalled()
  })

  it('takes it out again', async () => {
    const sign = vi.fn(async (_record: Showcase) => ({ ok: true as const, sig: 'b'.repeat(64) }))
    const there: Showcase = { ...empty, items: [{ pubkey: key, lineage: 'dylan' }] }
    expect(await applyToggle({ ...request, on: false }, { own: async () => key, read: async () => there, sign })).toEqual({ ok: true, changed: true })
    expect(sign.mock.calls[0]![0].items).toEqual([])
  })

  it('accepts a nested lineage', async () => {
    const sign = vi.fn(async (_record: Showcase) => ({ ok: true as const, sig: 'b'.repeat(64) }))
    expect(await applyToggle({ ...request, lineage: 'work/meetings' }, { own: async () => key, read: async () => empty, sign, promote })).toEqual({ ok: true, changed: true })
    expect(sign.mock.calls[0]![0].items).toEqual([{ pubkey: key, lineage: 'work/meetings' }])
  })

  it('refuses a device with no key and a bad request, and reports a failed signing', async () => {
    const sign = vi.fn(async (_record: Showcase) => ({ ok: false as const, reason: 'host refused' }))
    expect(await applyToggle(request, { own: async () => '', read: async () => empty, sign })).toEqual({ ok: false, reason: 'no key on this device' })
    expect(await applyToggle({ ...request, lineage: 'bad\nname' }, { own: async () => key, read: async () => empty, sign })).toEqual({ ok: false, reason: 'bad request' })
    expect(await applyToggle({ ...request, zone: 'nope' }, { own: async () => key, read: async () => empty, sign })).toEqual({ ok: false, reason: 'bad request' })
    expect(await applyToggle(request, { own: async () => key, read: async () => empty, sign, promote })).toEqual({ ok: false, reason: 'host refused' })
    expect(sign).toHaveBeenCalledTimes(1)
  })

  it('when nothing is signed, taking one out signs the rest of what is published here', async () => {
    const sign = vi.fn(async (_record: Showcase) => ({ ok: true as const, sig: 'b'.repeat(64) }))
    const published = vi.fn(async () => [
      { pubkey: key, lineage: 'dylan' },
      { pubkey: key, lineage: 'work/meetings' },
    ])
    expect(await applyToggle({ ...request, lineage: 'dylan', on: false }, {
      own: async () => key, read: async () => null, sign, published,
    })).toEqual({ ok: true, changed: true })
    expect(sign.mock.calls[0]![0]).toEqual({
      zone: 'example.com',
      items: [{ pubkey: key, lineage: 'work/meetings' }],
      domains: [],
    })
    expect(published).toHaveBeenCalledWith('example.com', key)
  })

  it('does not rewrite an explicit empty showcase, and does not sign when the creation was not published here', async () => {
    const sign = vi.fn(async (_record: Showcase) => ({ ok: true as const, sig: 'b'.repeat(64) }))
    const published = vi.fn(async () => [{ pubkey: key, lineage: 'camelflage' }])
    expect(await applyToggle({ ...request, on: false }, { own: async () => key, read: async () => empty, sign, published })).toEqual({ ok: true, changed: false })
    expect(await applyToggle({ ...request, lineage: 'dylan', on: false }, { own: async () => key, read: async () => null, sign, published })).toEqual({ ok: true, changed: false })
    expect(sign).not.toHaveBeenCalled()
    expect(published).toHaveBeenCalledTimes(1)
  })

  it('does not sign when the showcase or the published list cannot be read', async () => {
    const sign = vi.fn(async (_record: Showcase) => ({ ok: true as const, sig: 'b'.repeat(64) }))
    expect(await applyToggle(request, { own: async () => key, read: async () => { throw new Error('no') }, sign })).toEqual({ ok: false, reason: 'could not read the showcase' })
    expect(await applyToggle({ ...request, on: false }, { own: async () => key, read: async () => null, sign, published: async () => null })).toEqual({ ok: false, reason: 'could not read what is published here' })
    expect(sign).not.toHaveBeenCalled()
  })
})

describe('stage, then publish (jwize 2026-11-15)', () => {
  const other = { pubkey: 'c'.repeat(64), lineage: 'games' }
  const live: Showcase = { zone: 'example.com', items: [{ pubkey: key, lineage: 'camelflage' }], domains: [], view: 'list' }
  /** One host's records, by index key, changed by what is signed. */
  const held = (records: Record<string, Showcase | null>) => ({
    read: async (zone: string, name = `showcase:${zone}`) => records[name] ?? null,
    sign: vi.fn(async (record: Showcase, name = `showcase:${record.zone}`) => { records[name] = record; return { ok: true as const, sig: 'b'.repeat(64) } }),
    records,
  })

  it('staging signs only the staged list, starting from what visitors see; publishing makes it the showcase and optimizes what goes live', async () => {
    const host = held({ 'showcase:example.com': live })
    const promoted = vi.fn(async () => ({ ok: true as const, promoted: true }))
    const deps = { own: async () => key, read: host.read, sign: host.sign, promote: promoted }
    expect(await applyPublish({ zone: 'example.com' }, deps)).toEqual({ ok: true, changed: false })
    expect(await applyStage({ zone: 'example.com', on: [{ pubkey: key, lineage: 'dylan' }, other], off: [{ pubkey: key, lineage: 'camelflage' }] }, deps)).toEqual({ ok: true, changed: true })
    expect(host.sign).toHaveBeenLastCalledWith({ zone: 'example.com', domains: [], items: [{ pubkey: key, lineage: 'dylan' }, other] }, 'staged:example.com', undefined)
    expect(host.records['showcase:example.com']).toBe(live)
    expect(promoted).not.toHaveBeenCalled()
    expect(await applyStage({ zone: 'example.com', on: [other], off: [] }, deps)).toEqual({ ok: true, changed: false })
    expect(await applyPublish({ zone: 'example.com' }, deps)).toEqual({ ok: true, changed: true })
    expect(host.records['showcase:example.com']).toEqual({ ...live, items: [{ pubkey: key, lineage: 'dylan' }, other] })
    // Only this key's own creation going live is optimized.
    expect(promoted).toHaveBeenCalledTimes(1)
    expect(promoted).toHaveBeenCalledWith('example.com', 'dylan')
    expect(await applyPublish({ zone: 'example.com' }, deps)).toEqual({ ok: true, changed: false })
  })

  it('another device staging between the read and the write is kept: the write expects what it read, and on a moved root reads and applies again (jwize 2026-11-16)', async () => {
    // A host that signs only when the root still names what the writer read, as setHiveRoot's expect does.
    const records: Record<string, { sig: string; record: Showcase } | undefined> = {
      'staged:example.com': { sig: '1'.repeat(64), record: { zone: 'example.com', domains: [], items: [{ pubkey: key, lineage: 'camelflage' }] } },
    }
    let n = 1
    let interrupt = true
    const readAt = vi.fn(async (_zone: string, name = 'showcase:example.com') => {
      const held = records[name]
      return { sig: held?.sig ?? null, record: held?.record ?? null }
    })
    const sign = vi.fn(async (record: Showcase, name = 'showcase:example.com', expect?: string | null) => {
      // The phone stages games first, after this hive read and before it writes.
      if (interrupt && name === 'staged:example.com') {
        interrupt = false
        const was = records[name]!.record
        records[name] = { sig: String(++n).repeat(64), record: { ...was, items: [...was.items, other] } }
      }
      if (expect !== undefined && (records[name]?.sig ?? null) !== expect) return { ok: false as const, reason: ROOT_MOVED }
      records[name] = { sig: String(++n).repeat(64), record }
      return { ok: true as const, sig: records[name]!.sig }
    })
    expect(await applyStage({ zone: 'example.com', on: [{ pubkey: key, lineage: 'dylan' }], off: [] }, { own: async () => key, readAt, sign }))
      .toEqual({ ok: true, changed: true })
    expect(sign).toHaveBeenCalledTimes(2)
    expect(records['staged:example.com']!.record.items.map(item => item.lineage).sort()).toEqual(['camelflage', 'dylan', 'games'])
  })

  it('a creation that cannot be optimized publishes nothing, and a bad request or a missing key is refused', async () => {
    const host = held({ 'showcase:example.com': live, 'staged:example.com': { zone: 'example.com', domains: [], items: [{ pubkey: key, lineage: 'dylan' }] } })
    const failed = vi.fn(async () => ({ ok: false as const, reason: 'dylan is not published on example.com yet' }))
    expect(await applyPublish({ zone: 'example.com' }, { own: async () => key, read: host.read, sign: host.sign, promote: failed }))
      .toEqual({ ok: false, reason: 'dylan is not published on example.com yet' })
    expect(host.records['showcase:example.com']).toBe(live)
    expect(await applyStage({ zone: 'example.com', on: [{ pubkey: 'nope', lineage: 'x' }], off: [] }, { own: async () => key, read: host.read, sign: host.sign })).toEqual({ ok: false, reason: 'bad request' })
    expect(await applyStage({ zone: 'example.com', on: [], off: [] }, { own: async () => '', read: host.read, sign: host.sign })).toEqual({ ok: false, reason: 'no key on this device' })
  })
})

describe('applyView', () => {
  const sign = () => vi.fn(async (_record: Showcase) => ({ ok: true as const, sig: 'b'.repeat(64) }))

  it('signs the look a visitor is shown, keeps what the record holds, and does nothing when asked again', async () => {
    const signed = sign()
    const there: Showcase = { ...empty, items: [{ pubkey: key, lineage: 'dylan' }] }
    expect(await applyView({ zone: 'example.com', view: 'list' }, { own: async () => key, read: async () => there, sign: signed })).toEqual({ ok: true, changed: true })
    expect(signed.mock.calls[0]![0]).toEqual({ ...there, view: 'list' })
    expect(await applyView({ zone: 'example.com', view: 'list' }, { own: async () => key, read: async () => ({ ...there, view: 'list' }), sign: signed })).toEqual({ ok: true, changed: false })
    expect(signed).toHaveBeenCalledTimes(1)
  })

  it('hexagons is the absence of a view', async () => {
    const signed = sign()
    const there: Showcase = { ...empty, view: 'iphone' }
    expect(await applyView({ zone: 'example.com', view: 'hex' }, { own: async () => key, read: async () => there, sign: signed })).toEqual({ ok: true, changed: true })
    expect(signed.mock.calls[0]![0]).toEqual(empty)
    expect(await applyView({ zone: 'example.com', view: 'hex' }, { own: async () => key, read: async () => null, sign: signed })).toEqual({ ok: true, changed: false })
    expect(signed).toHaveBeenCalledTimes(1)
  })

  it('a zone with no record keeps showing what it publishes: the first record names those too', async () => {
    const signed = sign()
    const open = [{ pubkey: key, lineage: 'camelflage' }]
    expect(await applyView({ zone: 'example.com', view: 'launcher' }, { own: async () => key, read: async () => null, sign: signed, published: async () => open }))
      .toEqual({ ok: true, changed: true })
    expect(signed.mock.calls[0]![0]).toEqual({ zone: 'example.com', items: open, domains: [], view: 'launcher' })
  })

  it('refuses a view it does not know, a device with no key, and a zone it could not read', async () => {
    const signed = sign()
    expect(await applyView({ zone: 'example.com', view: 'cube' }, { own: async () => key, read: async () => empty, sign: signed })).toEqual({ ok: false, reason: 'bad request' })
    expect(await applyView({ zone: 'example.com', view: 'list' }, { own: async () => '', read: async () => empty, sign: signed })).toEqual({ ok: false, reason: 'no key on this device' })
    expect(await applyView({ zone: 'example.com', view: 'list' }, { own: async () => key, read: async () => null, sign: signed, published: async () => null }))
      .toEqual({ ok: false, reason: 'could not read what is published here' })
    expect(signed).not.toHaveBeenCalled()
  })
})

describe('applyInvite', () => {
  const link = 'https://example.com/#invite=host.example/' + 'a'.repeat(64) + '/' + 'b'.repeat(64)

  it('asks for what keys allow makes, to be opened at the zone, and hands back the link, its end and a code', async () => {
    const allow = vi.fn(async () => ({ ok: true as const, link, anchor: 'a'.repeat(64), until: 1700000600, held: ['host.example'], failed: [] }))
    const result = await applyInvite({ zone: 'Example.com' }, { hosts: async () => ['host.example'], allow, code: text => `<svg>${text.length}</svg>` })
    expect(allow).toHaveBeenCalledWith(['host.example'], { where: 'example.com' })
    expect(result).toEqual({ ok: true, link, until: 1700000600, code: `<svg>${link.length}</svg>` })
  })

  it('still hands back the link when no code can be drawn', async () => {
    const allow = async () => ({ ok: true as const, link, anchor: 'a'.repeat(64), until: 1, held: ['host.example'], failed: [] })
    expect(await applyInvite({ zone: 'example.com' }, { hosts: async () => ['host.example'], allow, code: () => null })).toEqual({ ok: true, link, until: 1 })
  })

  it('refuses a name that is no zone, and says in words why no invite was made', async () => {
    const allow = vi.fn(async () => ({ ok: false as const, reason: 'no-host' as const }))
    expect(await applyInvite({ zone: 'not a zone' }, { hosts: async () => [], allow })).toEqual({ ok: false, reason: 'bad request' })
    expect(allow).not.toHaveBeenCalled()
    expect(await applyInvite({ zone: 'example.com' }, { hosts: async () => [], allow })).toEqual({ ok: false, reason: 'this hive publishes to no host yet' })
    expect(await applyInvite({ zone: 'example.com' }, { hosts: async () => { throw new Error('x') }, allow })).toEqual({ ok: false, reason: 'could not read where this hive publishes' })
  })
})
