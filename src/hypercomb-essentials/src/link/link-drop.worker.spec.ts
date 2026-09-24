// The drop's verification card arrives with the first drop, not at boot
// (atomic-modules-plan.md, "adopt the proper load"). It only reports, so the
// drop never waits for it: a card that cannot load costs the card, never the
// drop, and a loaded card is loaded once.

import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  services: new Map<string, unknown>(),
  failNextLoad: false,
  cardLoads: 0,
  cards: [] as { url: string; destination: unknown }[],
}))

vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    get: (key: string) => state.services.get(key),
    register: (key: string, value: unknown) => { if (!state.services.has(key)) state.services.set(key, value) },
    whenReady: () => {},
  }
  // Held before the worker registers its own (first wins): no safety endpoint.
  state.services.set('@diamondcoreprocessor.com/LinkSafetyService', { check: async () => ({ decision: 'allow', reason: 'spec' }) })
  // The worker reads the shell's global `get`.
  ;(globalThis as unknown as { get: (key: string) => unknown }).get = (key: string) => state.services.get(key)
})

vi.mock('./link-drop-card.view.js', async () => {
  if (state.failNextLoad) { state.failNextLoad = false; throw new Error('the atom did not arrive') }
  state.cardLoads++
  return { verifyLinkDropCard: (card: { url: string; destination: unknown }) => { state.cards.push(card) } }
})
// No picture is fetched for these drops: the spec never touches the network.
vi.mock('./photo.js', () => ({ fetchImageBlob: async () => null, isImageUrl: () => false }))

import { EffectBus } from '@hypercomb/core'

await import('./link-drop.worker.js')

const commits: string[] = []
EffectBus.on<{ armId?: string }>('command:commit-armed', payload => { if (payload?.armId) commits.push(payload.armId) })
commits.length = 0 // the bus replays whatever was committed last

const drop = async (url: string): Promise<void> => {
  const before = commits.length
  EffectBus.emit('link:intake', { url })
  await vi.waitFor(() => expect(commits.length).toBe(before + 1))
}

describe('link drop — the card arrives with the first drop', () => {
  it('does not load the card at boot', () => {
    expect(state.cardLoads).toBe(0)
  })

  it('commits the drop even when the card cannot load', async () => {
    state.failNextLoad = true
    await drop('https://example.com/one')
    await vi.waitFor(() => expect(state.failNextLoad).toBe(false))
    expect(state.cards).toEqual([])
  })

  it('shows the card on the next drop, and loads it only once', async () => {
    await drop('https://example.com/two')
    await vi.waitFor(() => expect(state.cards).toHaveLength(1))
    await drop('https://example.com/three')
    await vi.waitFor(() => expect(state.cards).toHaveLength(2))
    expect(state.cards.map(card => card.url)).toEqual(['https://example.com/two', 'https://example.com/three'])
    expect(state.cards[0]!.destination).toEqual({ kind: 'create' })
    expect(state.cardLoads).toBe(1)
  })
})
