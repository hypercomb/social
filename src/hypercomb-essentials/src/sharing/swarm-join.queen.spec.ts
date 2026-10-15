// sharing/swarm-join.queen.spec.ts — `join` joins THIS tab's zone, or asks.
//
// The origin-wide room and secret only pre-fill a new tab: on a returning
// device they are last week's meeting, and `join` there used to go straight
// back in (ZI-4). Unless this tab joined or chose a zone itself, `join` opens
// the selector pre-filled (D5) — asked here as well as at the shell's guard,
// so an older shell asks too. `leave` is never gated.

import { beforeEach, describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const registry = new Map<string, unknown>()
;(window as unknown as { ioc: unknown }).ioc = {
  register: (k: string, v: unknown) => { registry.set(k, v) },
  get: (k: string) => registry.get(k),
}

await import('./swarm-join.queen.js')
const join = registry.get('@diamondcoreprocessor.com/JoinQueenBee') as { invoke: (a: string) => Promise<void> }
const leave = registry.get('@diamondcoreprocessor.com/LeaveQueenBee') as { invoke: (a: string) => Promise<void> }

const seen: Array<[string, unknown]> = []
EffectBus.on('keymap:invoke', (p) => { if (p) seen.push(['toggle', p]) })
EffectBus.on('mesh:open-modal', (p) => { if (p) seen.push(['modal', p]) })

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  EffectBus.emit('mesh:public-changed', { public: false })
  seen.length = 0
})

describe('join', () => {
  it('a tab with no zone of its own — last week\'s pair only pre-filled — opens the selector, never joins', async () => {
    localStorage.setItem('hc:room', 'downtown')
    localStorage.setItem('hc:secret', 'rose')
    await join.invoke('')
    expect(seen).toEqual([['modal', { join: true }]])
  })

  it('a tab with its own zone joins it through the one guarded toggle', async () => {
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'downtown', secret: 'rose' }))
    await join.invoke('')
    expect(seen).toEqual([['toggle', { cmd: 'mesh.togglePublic', binding: null, event: null }]])
  })

  it('already joined: says so, toggles nothing', async () => {
    EffectBus.emit('mesh:public-changed', { public: true })
    await join.invoke('')
    expect(seen).toEqual([])
  })
})

describe('leave', () => {
  it('is never gated on a zone', async () => {
    EffectBus.emit('mesh:public-changed', { public: true })
    await leave.invoke('')
    expect(seen).toEqual([['toggle', { cmd: 'mesh.togglePublic', binding: null, event: null }]])
  })
})

describe('join with values (2026-10-12: "or you can use those overrides")', () => {
  it('location, secret and host ride the one step /use-live-relay and the selector share — never the selector itself', async () => {
    const calls: string[] = []
    registry.set('@diamondcoreprocessor.com/UseLiveRelayQueenBee', { invoke: (a: string) => { calls.push(a) } })
    try {
      await join.invoke('downtown downtown hypercomb.com')
      await join.invoke('mynewroom mynewpass')
      expect(calls).toEqual(['downtown downtown hypercomb.com', 'mynewroom mynewpass'])
      expect(seen).toEqual([])
    } finally { registry.delete('@diamondcoreprocessor.com/UseLiveRelayQueenBee') }
  })

  it('keeps the values as typed (the room folds case itself)', () => {
    expect((join as { rawArgs?: boolean }).rawArgs).toBe(true)
  })
})
