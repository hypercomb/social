// sharing/membership.spec.ts — swarm membership is THIS tab's.
//
// The origin-wide `hc:mesh-public` flag is shared by every tab, and the shell
// rewrites it from each tab's own session at boot — so a second, unjoined tab
// used to silence the joined one mid-meeting. isJoinedHere() answers from the
// tab's session (`hc:mesh-session`) and the `mesh:public-changed` effect, and
// nothing else. The module seeds at load, so each case imports it fresh.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const load = async (): Promise<() => boolean> => {
  vi.resetModules()
  const mod = await import('./membership.js')
  return mod.isJoinedHere
}

beforeEach(() => {
  EffectBus.clear()
  sessionStorage.clear()
  localStorage.clear()
})

describe('isJoinedHere', () => {
  it('seeds from this tab\'s session', async () => {
    sessionStorage.setItem('hc:mesh-session', 'true')
    expect((await load())()).toBe(true)
  })

  it('is not joined when the session never joined', async () => {
    expect((await load())()).toBe(false)
  })

  it('follows mesh:public-changed — join and leave', async () => {
    const isJoinedHere = await load()
    EffectBus.emit('mesh:public-changed', { public: true })
    expect(isJoinedHere()).toBe(true)
    EffectBus.emit('mesh:public-changed', { public: false })
    expect(isJoinedHere()).toBe(false)
  })

  it('ignores the origin-wide flag a second tab writes', async () => {
    sessionStorage.setItem('hc:mesh-session', 'true')
    const isJoinedHere = await load()
    // A second tab boots unjoined: the shell rewrites the shared flag.
    localStorage.setItem('hc:mesh-public', 'false')
    window.dispatchEvent(new StorageEvent('storage', { key: 'hc:mesh-public', newValue: 'false' }))
    expect(isJoinedHere()).toBe(true)
  })

  it('a flag that says joined does not join a tab whose session never did', async () => {
    localStorage.setItem('hc:mesh-public', 'true')
    expect((await load())()).toBe(false)
  })
})
