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

  it('refuses a device with no key and a bad request, and reports a failed signing', async () => {
    const sign = vi.fn(async (_record: Showcase) => ({ ok: false as const, reason: 'host refused' }))
    expect(await applyToggle(request, { own: async () => '', read: async () => empty, sign })).toEqual({ ok: false, reason: 'no key on this device' })
    expect(await applyToggle({ ...request, lineage: 'a/b' }, { own: async () => key, read: async () => empty, sign })).toEqual({ ok: false, reason: 'bad request' })
    expect(await applyToggle({ ...request, zone: 'nope' }, { own: async () => key, read: async () => empty, sign })).toEqual({ ok: false, reason: 'bad request' })
    expect(await applyToggle(request, { own: async () => key, read: async () => empty, sign })).toEqual({ ok: false, reason: 'host refused' })
  })
})
