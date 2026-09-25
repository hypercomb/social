// ALLOW, NEVER FORCE — the followed channel is taken on its own only when the
// participant said so, through the same acquire the Packages window uses, and
// a take that did not stick is not retried this session.
import { describe, expect, it, vi } from 'vitest'

const storage = (allow: boolean) => ({ getItem: (k: string) => (k === 'hc:upgrade:allow' && allow ? '1' : null) })

describe('upgrade allow', () => {
  it('does nothing unless the participant allowed it', async () => {
    const { takeIfAllowed } = await import('./upgrade-allow.js')
    const acquire = vi.fn(async () => ({ ok: true }))
    expect(await takeIfAllowed('a'.repeat(64), ['content.example.com'], { storage: storage(false), port: { acquire }, zones: async () => [], reload: () => {} })).toBe('not-allowed')
    expect(acquire).not.toHaveBeenCalled()
  })

  it('takes the announced root from carried hosts + the follow hosts, then restarts', async () => {
    const { takeIfAllowed } = await import('./upgrade-allow.js')
    const acquire = vi.fn(async () => ({ ok: true }))
    const reload = vi.fn()
    const sig = 'b'.repeat(64)
    expect(await takeIfAllowed(sig, ['content.example.com'], { storage: storage(true), port: { acquire }, zones: async () => ['jwize.com'], reload })).toBe('taken')
    expect(acquire).toHaveBeenCalledWith(sig, ['jwize.com', 'content.example.com'])
    await new Promise(r => setTimeout(r, 500))
    expect(reload).toHaveBeenCalled()
  })

  it('never loops on a root that did not stick — one attempt per session', async () => {
    const { takeIfAllowed } = await import('./upgrade-allow.js')
    const acquire = vi.fn(async () => ({ ok: false, error: 'package incomplete' }))
    const sig = 'c'.repeat(64)
    expect(await takeIfAllowed(sig, [], { storage: storage(true), port: { acquire }, zones: async () => [], reload: () => {} })).toBe('failed')
    expect(await takeIfAllowed(sig, [], { storage: storage(true), port: { acquire }, zones: async () => [], reload: () => {} })).toBe('already-tried')
    expect(acquire).toHaveBeenCalledTimes(1)
  })

  it('says so when the shell has no install port (dev shell)', async () => {
    const { takeIfAllowed } = await import('./upgrade-allow.js')
    expect(await takeIfAllowed('d'.repeat(64), [], { storage: storage(true), port: null, zones: async () => [], reload: () => {} })).toBe('no-port')
  })
})
