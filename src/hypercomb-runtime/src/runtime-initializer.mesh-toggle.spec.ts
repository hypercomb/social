// runtime-initializer.mesh-toggle.spec.ts — THE TOGGLE READS THIS TAB.
//
// `mesh.togglePublic` used to read the origin-wide `hc:mesh-public` flag. Every
// tab shares that flag and a second tab's boot writes it 'false', so the joined
// tab's `leave` became a second join. The toggle now reads this tab's own
// membership — sessionStorage `hc:mesh-session` (mesh-session.ts) — and still
// writes the origin-wide flag for packages older than per-tab membership.
//
// And a join needs THIS TAB's zone (D5): a new tab's stores are only
// pre-filled from the origin-wide pair — last week's meeting on a returning
// device — so with no `hc:mesh-zone` of its own the toggle opens the
// selector, pre-filled, instead of joining.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const registry = new Map<string, unknown>()

beforeAll(async () => {
  // The runtime resolves services through the shell's global `get` and the
  // install monitor registers through `register` (ioc.web.ts in a shell).
  const g = globalThis as unknown as { get: (key: string) => unknown; register: (key: string, value: unknown) => void }
  g.get = (key: string) => registry.get(key)
  g.register = (key: string, value: unknown) => { registry.set(key, value) }
  registry.set('@hypercomb.social/RoomStore', { value: 'meeting' })
  registry.set('@hypercomb.social/SecretStore', { value: 'downtown', set: () => undefined })
  const { initializeRuntime } = await import('./runtime-initializer')
  await initializeRuntime()
})

beforeEach(() => {
  localStorage.removeItem('hc:mesh-public')
  sessionStorage.removeItem('hc:mesh-session')
  // This tab chose its zone (the selector, a link, use-live-relay).
  sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'meeting', secret: 'downtown' }))
})

const toggle = (): Array<{ public: boolean }> => {
  const seen: Array<{ public: boolean }> = []
  const off = EffectBus.on<{ public: boolean }>('mesh:public-changed', p => { seen.push(p) })
  seen.length = 0 // last-value replay is an earlier case's evidence, not this one's
  EffectBus.emit('keymap:invoke', { cmd: 'mesh.togglePublic' })
  off()
  return seen
}

describe('mesh.togglePublic follows this tab', () => {
  it('leaves when this tab is joined, though another tab wrote the shared flag false', () => {
    sessionStorage.setItem('hc:mesh-session', 'true')
    localStorage.setItem('hc:mesh-public', 'false')
    expect(toggle()).toEqual([{ public: false }])
    expect(localStorage.getItem('hc:mesh-public')).toBe('false')
    expect(sessionStorage.getItem('hc:mesh-session')).toBe('false')
  })

  it('joins when this tab is not joined, though another tab left the shared flag true — and a second press leaves', () => {
    localStorage.setItem('hc:mesh-public', 'true')
    expect(toggle()).toEqual([{ public: true }])
    expect(localStorage.getItem('hc:mesh-public')).toBe('true')
    expect(toggle()).toEqual([{ public: false }])
  })
})

describe('mesh.togglePublic asks a tab with no zone of its own (D5)', () => {
  const modals: unknown[] = []
  EffectBus.on('mesh:open-modal', p => { if (p) modals.push(p) })

  it('stores pre-filled from the origin-wide pair, no zone in this tab: the selector — no join', () => {
    sessionStorage.removeItem('hc:mesh-zone')
    modals.length = 0
    expect(toggle()).toEqual([])
    expect(modals).toEqual([{ join: true }])
    expect(sessionStorage.getItem('hc:mesh-session')).toBeNull()
  })

  it('a zone with only a room (a zone host\'s pre-fill) is not one of its own', () => {
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'meeting' }))
    modals.length = 0
    expect(toggle()).toEqual([])
    expect(modals).toEqual([{ join: true }])
  })

  it('leaving is never gated', () => {
    sessionStorage.removeItem('hc:mesh-zone')
    sessionStorage.setItem('hc:mesh-session', 'true')
    expect(toggle()).toEqual([{ public: false }])
  })
})
