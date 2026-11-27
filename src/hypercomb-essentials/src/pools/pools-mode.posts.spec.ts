// pools/pools-mode.posts.spec.ts : the pools bar's "Open for posts" row, in the
// pools mode drone. The leader's index is played by the spec, so nothing
// leaves the page.

import { describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const services = new Map<string, unknown>()
;(globalThis as unknown as { ioc: unknown }).ioc = {
  get: (key: string) => services.get(key),
  register: (key: string, value: unknown) => { services.set(key, value) },
  whenReady: (key: string, ready: (value: unknown) => void) => { if (services.has(key)) ready(services.get(key)) },
  onRegister: () => () => void 0,
}
services.set('@hypercomb.social/Lineage', { explorerLabel: () => '/', explorerSegments: () => [] })

const { LIGHTS_MODE } = await import('./lights-contract.js')
const { ENTRY_POSTS_WANTED } = await import('./open-entries-forms.js')
const { PoolsModeDrone } = await import('./pools-mode.drone.js')

const drone = services.get('@diamondcoreprocessor.com/PoolsModeDrone') as InstanceType<typeof PoolsModeDrone>
let indexReads = 0
// Before the bar is first built: the control is made with what is here then.
drone.postsDeps = {
  host: () => 'example.com',
  publisherKey: async () => '5'.repeat(64),
  index: async () => { indexReads++; return { ok: true, manifest: { roots: { kitchen: '1'.repeat(64) }, createdAt: 1, pubkey: '5'.repeat(64) } } },
  records: { read: async () => [], write: async () => true },
  nonces: { get: () => '', set: () => true, drop: () => undefined },
  forms: () => [{ meaning: 'recipe:entry', templates: async () => [{ sig: '7'.repeat(64), name: 'Weeknight', bytes: new Uint8Array([1]) }] }],
}

const row = (): HTMLElement | null => document.querySelector('#hc-pools-bar #hc-posts')
const settle = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve() }

describe('the pools bar carries the leader\'s posts', () => {
  it('opens the form the word asked for once the bar is up, with the pages the index gives', async () => {
    await drone.pulse('')
    // Pools mode is up but a view holds the bar down: the ask waits for the bar.
    EffectBus.emit('view:active', { active: true })
    EffectBus.emit(LIGHTS_MODE, { active: true })
    EffectBus.emitTransient(ENTRY_POSTS_WANTED, {})
    expect(row()).toBeNull()
    EffectBus.emit('view:active', { active: false })
    await settle()
    expect(row()).not.toBeNull()
    const form = row()?.querySelector<HTMLElement>('.hc-posts-form')
    expect(form?.hidden).toBe(false)
    const pages = [...(row()?.querySelectorAll<HTMLOptionElement>('.hc-posts-page option') ?? [])].map(one => one.value)
    expect(pages.length).toBeGreaterThan(0)
    expect(indexReads).toBeGreaterThan(0)
  })

  it('reads the pools again each time the bar comes up, and drops an ask made while pools mode is down', async () => {
    row()?.querySelector<HTMLButtonElement>('.hc-posts-cancel')?.click()
    EffectBus.emit(LIGHTS_MODE, { active: false })
    expect(row()).toBeNull()
    const before = indexReads
    // The header refused (inside a swarm): the word's ask is not kept for later.
    EffectBus.emitTransient(ENTRY_POSTS_WANTED, {})
    EffectBus.emit(LIGHTS_MODE, { active: true })
    await settle()
    expect(row()?.querySelector<HTMLElement>('.hc-posts-form')?.hidden).toBe(true)
    EffectBus.emit(LIGHTS_MODE, { active: false })
    EffectBus.emit(LIGHTS_MODE, { active: true })
    await settle()
    expect(indexReads).toBeGreaterThan(before + 1)
    // With the bar up, the word opens the form at once.
    EffectBus.emitTransient(ENTRY_POSTS_WANTED, {})
    await settle()
    expect(row()?.querySelector<HTMLElement>('.hc-posts-form')?.hidden).toBe(false)
  })
})
