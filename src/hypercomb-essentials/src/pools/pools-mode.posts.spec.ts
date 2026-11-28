// pools/pools-mode.posts.spec.ts : the "Collect from phones" card and the pools
// bar's one line about posts, in the pools mode drone. The leader's index is
// played by the spec, so nothing leaves the page.

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
// Before the control is first made: it is made with what is here then.
drone.postsDeps = {
  host: () => 'example.com',
  publisherKey: async () => '5'.repeat(64),
  index: async () => { indexReads++; return { ok: true, manifest: { roots: { kitchen: '1'.repeat(64) }, createdAt: 1, pubkey: '5'.repeat(64) } } },
  records: { read: async () => [], write: async () => true },
  nonces: { get: () => '', set: () => true, drop: () => undefined },
  forms: () => [{ meaning: 'recipe:entry', templates: async () => [{ sig: '7'.repeat(64), name: 'Weeknight', bytes: new Uint8Array([1]) }] }],
}

const card = (): HTMLElement | null => document.querySelector('body > #hc-posts')
const line = (): HTMLElement | null => document.querySelector('#hc-pools-bar .hc-posts-bar')
const settle = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const held: string[] = []
EffectBus.on<{ reason?: string }>('keymap:hold', payload => { if (payload?.reason) held.push(`hold ${payload.reason}`) })
EffectBus.on<{ reason?: string }>('keymap:release', payload => { if (payload?.reason) held.push(`release ${payload.reason}`) })

describe('the card the word asks for', () => {
  it('comes up on its own, with no pools mode under it, straight on the form with a name filled in', async () => {
    await drone.pulse('')
    held.length = 0
    EffectBus.emitTransient(ENTRY_POSTS_WANTED, {})
    await settle()
    expect(card()).not.toBeNull()
    // No pools mode was asked for and none came up: the card needs no bar.
    expect(document.querySelector('#hc-pools-bar')).toBeNull()
    expect(card()?.getAttribute('role')).toBe('dialog')
    expect(card()?.querySelector<HTMLElement>('.hc-posts-form')?.hidden).toBe(false)
    expect(card()?.querySelector<HTMLInputElement>('.hc-posts-name')?.value).toMatch(/^Weeknight, /)
    expect(card()?.querySelector<HTMLButtonElement>('.hc-posts-open')?.disabled).toBe(false)
    const pages = [...(card()?.querySelectorAll<HTMLOptionElement>('.hc-posts-page option') ?? [])].map(one => one.value)
    expect(pages.length).toBeGreaterThan(0)
    expect(indexReads).toBeGreaterThan(0)
    // The hive's shortcuts are held while a name can be typed.
    expect(held).toEqual(['hold pools-posts-card'])
  })

  it('is one card however often it is asked for, and its Close takes it away and lets the keymap go', async () => {
    EffectBus.emitTransient(ENTRY_POSTS_WANTED, {})
    await settle()
    expect(document.querySelectorAll('#hc-posts')).toHaveLength(1)
    card()?.querySelector<HTMLButtonElement>('.hc-posts-dismiss')?.click()
    expect(card()).toBeNull()
    expect(held).toEqual(['hold pools-posts-card', 'release pools-posts-card'])
  })
})

describe('the pools bar keeps one line about posts', () => {
  it('says so in one line, with no form in the bar, and its press opens the card', async () => {
    EffectBus.emit(LIGHTS_MODE, { active: true })
    await settle()
    expect(line()).not.toBeNull()
    expect(document.querySelector('#hc-pools-bar .hc-posts-form')).toBeNull()
    expect(line()?.querySelector('.hc-posts-bar-words')?.textContent).toBeTruthy()
    expect(card()).toBeNull()
    line()?.querySelector<HTMLButtonElement>('.hc-posts-bar-open')?.click()
    await settle()
    expect(card()).not.toBeNull()
    // The card outlives the bar: leaving pools mode does not take it away.
    EffectBus.emit(LIGHTS_MODE, { active: false })
    expect(line()).toBeNull()
    expect(card()).not.toBeNull()
    card()?.querySelector<HTMLButtonElement>('.hc-posts-dismiss')?.click()
    expect(card()).toBeNull()
  })

  it('reads the pools again each time the bar comes up', async () => {
    const before = indexReads
    EffectBus.emit(LIGHTS_MODE, { active: true })
    await settle()
    EffectBus.emit(LIGHTS_MODE, { active: false })
    EffectBus.emit(LIGHTS_MODE, { active: true })
    await settle()
    expect(indexReads).toBeGreaterThan(before + 1)
    EffectBus.emit(LIGHTS_MODE, { active: false })
  })
})
