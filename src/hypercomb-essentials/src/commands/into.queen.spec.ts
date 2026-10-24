import { beforeEach, describe, expect, it } from 'vitest'

const registrations = new Map<string, unknown>()
;(globalThis as unknown as { window: unknown }).window = {
  ioc: {
    register: (key: string, value: unknown) => registrations.set(key, value),
    get: (key: string) => registrations.get(key),
  },
}

const { EffectBus } = await import('@hypercomb/core')
const { IntoQueenBee } = await import('./into.queen.js')

type Call = { labels: readonly string[]; source: readonly string[]; target: readonly string[] }

/** A MoveDrone that lands what it is told, except the names `taken` lists. */
const moveDrone = (taken: readonly string[] = []): Call[] => {
  const calls: Call[] = []
  registrations.set('@diamondcoreprocessor.com/MoveDrone', {
    commitMoveInto: async (labels: readonly string[], source: readonly string[], target: readonly string[]) => {
      calls.push({ labels, source, target })
      return labels.filter(label => !taken.includes(label))
    },
  })
  return calls
}

beforeEach(() => {
  EffectBus.clear()
  registrations.clear()
  registrations.set('@hypercomb.social/Lineage', { explorerSegments: () => [] })
  registrations.set('@hypercomb.social/CellSuggestionProvider', { suggestions: () => ['work', 'Business-Card', 'domains', 'people'] })
})

// 2026-10-24: asked to organize the home page, a hive model made the group
// tiles and then asked the participant to open each one and paste by hand.
describe('/into with its tiles named', () => {
  it('moves the named tiles of this page into a tile here, spelled as the page spells them', async () => {
    const calls = moveDrone()
    await new IntoQueenBee().invoke('Work = [business-card, domains]')
    expect(calls).toEqual([{ labels: ['Business-Card', 'domains'], source: [], target: ['work'] }])
  })

  it('reaches a route anywhere in the hive', async () => {
    const calls = moveDrone()
    await new IntoQueenBee().invoke('/people/friends = domains')
    expect(calls[0].target).toEqual(['people', 'friends'])
  })

  it('throws for a name this page does not hold, and moves nothing', async () => {
    const calls = moveDrone()
    await expect(new IntoQueenBee().invoke('work = [domains, ghost]')).rejects.toThrow('no tile named "ghost" on this page')
    expect(calls).toEqual([])
  })

  it('never reads a move that did not happen as one', async () => {
    moveDrone(['domains'])
    await expect(new IntoQueenBee().invoke('work = [Business-Card, domains]'))
      .rejects.toThrow('"domains" did not move into /work, which already holds a tile by that name')
    moveDrone(['domains'])
    await expect(new IntoQueenBee().invoke('work = domains')).rejects.toThrow('nothing moved into /work')
  })

  it('still moves the selection when no tiles are named', async () => {
    const calls = moveDrone()
    registrations.set('@diamondcoreprocessor.com/SelectionService', { selected: new Set(['domains']) })
    await new IntoQueenBee().invoke('work')
    expect(calls).toEqual([{ labels: ['domains'], source: [], target: ['work'] }])
  })
})
