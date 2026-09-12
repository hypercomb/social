// hypercomb-shared/core/mixed-group-bag.spec.ts
//
// A refresh straight into /games reconciled the page before every game bee had
// registered: the first pass dropped the not-yet-loaded games, and each later
// registration appended one back — the page emptied and refilled on every
// reload. Drops now wait for the loader to settle (`loader:bees-done`).

import '@hypercomb/runtime/ioc.web'
import { describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { MixedGroupBag } from './mixed-group-bag'
import type { GroupMember, GroupRegistry, LaunchGroup } from './group-registry'

type Layer = { name?: string; children?: string[]; [slot: string]: unknown }

const sigs = new Map<string, string>()
const sigOf = (key: string): string => {
  if (!sigs.has(key)) sigs.set(key, (sigs.size + 1).toString(16).padStart(64, '0'))
  return sigs.get(key)!
}
let markers = 0
const layers = new Map<string, Layer>()
const heads = new Map<string, string>()

const history = {
  async sign(l: { explorerSegments?: () => readonly string[] }) { return sigOf('loc:' + (l.explorerSegments?.() ?? []).join('/')) },
  async commitLayer(locationSig: string, layer: Layer) {
    const marker = sigOf('marker:' + ++markers)
    layers.set(marker, layer)
    heads.set(locationSig, marker)
    return marker
  },
  async currentLayerAt(locationSig: string) { return layers.get(heads.get(locationSig) ?? '') ?? null },
  async getLayerBySig(sig: string) { return layers.get(sig) ?? null },
  async latestMarkerSigFor(locationSig: string) { return heads.get(locationSig) ?? '' },
}
const committer = {
  async commitSlotSet(segments: readonly string[], slot: string, values: readonly string[]) {
    const locSig = await history.sign({ explorerSegments: () => segments })
    const prior = await history.currentLayerAt(locSig)
    await history.commitLayer(locSig, { ...prior, name: segments.at(-1), [slot]: [...values] })
  },
}
let putCount = 0
const lineage = { segments: ['games'], explorerSegments(): string[] { return this.segments } }

window.ioc.register('@diamondcoreprocessor.com/HistoryService', history)
window.ioc.register('@diamondcoreprocessor.com/LayerCommitter', committer)
window.ioc.register('@hypercomb.social/Store', { async putResource() { return sigOf('resource:' + ++putCount) } })
window.ioc.register('@hypercomb.social/Lineage', lineage)
window.ioc.register('@hypercomb.social/Navigation', { goRaw() {}, replaceRaw() {} })

let loaded: string[] = []
const games: LaunchGroup = {
  id: 'games',
  icon: 'sports_esports',
  label: 'Games',
  members: (): GroupMember[] => loaded.map(label => ({ key: label, label, segments: [] })),
  open() {},
}
const registry = { get: (id: string) => (id === 'games' ? games : undefined) } as unknown as GroupRegistry
const bag = new MixedGroupBag(registry)

const pageChildren = async (): Promise<string[]> => {
  const page = await history.currentLayerAt(await history.sign({ explorerSegments: () => ['games'] }))
  const names: string[] = []
  for (const sig of page?.children ?? []) names.push(String((await history.getLayerBySig(sig))?.name))
  return names
}

describe('launcher page reconcile — a member not loaded yet is not gone', () => {
  it('keeps every game on the page while game bees are still registering', async () => {
    loaded = ['Arkanoid', 'Bubble', 'Roper', "Solomon's Key"]
    await bag.refreshIfActive()
    expect(await pageChildren()).toEqual(['Arkanoid', 'Bubble', 'Roper', "Solomon's Key"])

    // Reload: the bees arrive one at a time, each one refreshing the page.
    for (const arrived of [['Roper'], ['Roper', 'Arkanoid'], ['Roper', 'Arkanoid', 'Bubble']]) {
      loaded = arrived
      await bag.refreshIfActive()
      expect(await pageChildren()).toEqual(['Arkanoid', 'Bubble', 'Roper', "Solomon's Key"])
    }
  })

  it('a load with failures never settles — the failed module keeps its cell', async () => {
    loaded = ['Arkanoid', 'Bubble', 'Roper']
    EffectBus.emit('loader:bees-done', { loaded: 3, failed: 1, total: 3 })
    await bag.refreshIfActive()
    expect(await pageChildren()).toEqual(['Arkanoid', 'Bubble', 'Roper', "Solomon's Key"])
  })

  it('once the loader settles, a genuinely removed game leaves the page', async () => {
    loaded = ['Arkanoid', 'Bubble', 'Roper']
    EffectBus.emit('loader:bees-done', { loaded: 3, failed: 0, total: 3 })
    await bag.refreshIfActive()
    expect(await pageChildren()).toEqual(['Arkanoid', 'Bubble', 'Roper'])
  })
})
