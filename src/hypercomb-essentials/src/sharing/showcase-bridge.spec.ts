import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  ;(globalThis as unknown as { window: unknown }).window = globalThis
  ;(globalThis as unknown as { ioc: unknown }).ioc = { register: () => {}, get: () => undefined, whenReady: () => {} }
})

import { applyToggle } from './showcase-bridge.js'
import type { Showcase } from './showcase-record.js'

const key = 'a'.repeat(64)
const empty: Showcase = { zone: 'example.com', items: [], domains: [] }
const request = { zone: 'example.com', pubkey: key, lineage: 'dylan', on: true }

describe('applyToggle', () => {
  it('puts a creation in, signs the record once, and does nothing when asked again', async () => {
    const sign = vi.fn(async (_record: Showcase) => ({ ok: true as const, sig: 'b'.repeat(64) }))
    const deps = { own: async () => key, read: async () => empty, sign }
    expect(await applyToggle(request, deps)).toEqual({ ok: true, changed: true })
    expect(sign).toHaveBeenCalledTimes(1)
    expect(sign.mock.calls[0]![0].items).toEqual([{ pubkey: key, lineage: 'dylan' }])
    const there: Showcase = { ...empty, items: [{ pubkey: key, lineage: 'dylan' }] }
    expect(await applyToggle(request, { ...deps, read: async () => there })).toEqual({ ok: true, changed: false })
    expect(sign).toHaveBeenCalledTimes(1)
  })

  it('takes it out again', async () => {
    const sign = vi.fn(async (_record: Showcase) => ({ ok: true as const, sig: 'b'.repeat(64) }))
    const there: Showcase = { ...empty, items: [{ pubkey: key, lineage: 'dylan' }] }
    expect(await applyToggle({ ...request, on: false }, { own: async () => key, read: async () => there, sign })).toEqual({ ok: true, changed: true })
    expect(sign.mock.calls[0]![0].items).toEqual([])
  })

  it('accepts a nested lineage', async () => {
    const sign = vi.fn(async (_record: Showcase) => ({ ok: true as const, sig: 'b'.repeat(64) }))
    expect(await applyToggle({ ...request, lineage: 'work/meetings' }, { own: async () => key, read: async () => empty, sign })).toEqual({ ok: true, changed: true })
    expect(sign.mock.calls[0]![0].items).toEqual([{ pubkey: key, lineage: 'work/meetings' }])
  })

  it('refuses a device with no key and a bad request, and reports a failed signing', async () => {
    const sign = vi.fn(async (_record: Showcase) => ({ ok: false as const, reason: 'host refused' }))
    expect(await applyToggle(request, { own: async () => '', read: async () => empty, sign })).toEqual({ ok: false, reason: 'no key on this device' })
    expect(await applyToggle({ ...request, lineage: 'bad\nname' }, { own: async () => key, read: async () => empty, sign })).toEqual({ ok: false, reason: 'bad request' })
    expect(await applyToggle({ ...request, zone: 'nope' }, { own: async () => key, read: async () => empty, sign })).toEqual({ ok: false, reason: 'bad request' })
    expect(await applyToggle(request, { own: async () => key, read: async () => empty, sign })).toEqual({ ok: false, reason: 'host refused' })
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
