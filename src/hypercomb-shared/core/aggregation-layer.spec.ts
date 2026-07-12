// aggregation-layer.spec.ts — curated menu membership as a LAYER.
//
// The load-bearing claim: enable/disable are ordinary commits at the group's
// page location `[g]` through LayerCommitter — so membership is a layer, and
// undo/redo is the location's normal history (proven here by reverting the
// committed children set). No bespoke pool is touched.
//
// The ambient global `get` (ioc.web) is stubbed to an in-memory model of
// HistoryService + Store + LayerCommitter. Store blobs are duck-typed
// ({ text() }) so nothing depends on jsdom's Blob.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'

// jsdom's Blob has no .text() (every real browser does); the module puts a
// real Blob into putResource, so polyfill it via FileReader (see
// participant-path-rehome.spec.ts for the same shim).
if (typeof Blob !== 'undefined' && !Blob.prototype.text) {
  Blob.prototype.text = function (this: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(String(fr.result))
      fr.onerror = () => reject(fr.error)
      fr.readAsText(this)
    })
  }
}

// ── deterministic 64-hex from any string (real sha256 — collision-free,
//    matching the production signature shape so distinct locations/markers
//    never alias) ──
function hex64(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

interface Layer { name?: string; children?: string[]; decorations?: string[] }

// In-memory model of the three services the module resolves via `get`.
class Model {
  layers = new Map<string, Layer>()          // layerSig → layer
  heads = new Map<string, string>()           // locSig → current layerSig
  resources = new Map<string, string>()       // resSig → text
  #n = 0
  commitSlotSetCalls: Array<{ segments: string[]; slot: string; sigs: string[] }> = []

  readonly history = {
    sign: async (l: { explorerSegments: () => readonly string[] }) => hex64('loc:' + l.explorerSegments().join('/')),
    commitLayer: async (locSig: string, layer: Layer) => {
      const sig = hex64('layer:' + JSON.stringify(layer) + ':' + (this.#n++))
      this.layers.set(sig, layer)
      this.heads.set(locSig, sig)
      return sig
    },
    currentLayerAt: async (locSig: string) => {
      const head = this.heads.get(locSig)
      return head ? this.layers.get(head) ?? null : null
    },
    getLayerBySig: async (sig: string) => this.layers.get(sig) ?? null,
    latestMarkerSigFor: async (locSig: string) => this.heads.get(locSig) ?? '',
  }

  readonly store = {
    putResource: async (blob: { text(): Promise<string> } | Blob) => {
      const text = await (blob as { text(): Promise<string> }).text()
      const sig = hex64('res:' + text)
      this.resources.set(sig, text)
      return sig
    },
    getResource: async (sig: string) => {
      if (!this.resources.has(sig)) return null
      return { text: async () => this.resources.get(sig)! } as unknown as Blob
    },
  }

  readonly committer = {
    // Full-replace of [g]'s children slot — a new marker preserving name.
    commitSlotSet: async (segments: readonly string[], slot: string, sigs: readonly string[]) => {
      this.commitSlotSetCalls.push({ segments: [...segments], slot, sigs: [...sigs] })
      const locSig = hex64('loc:' + segments.join('/'))
      const cur = (this.heads.get(locSig) && this.layers.get(this.heads.get(locSig)!)) || { name: segments[segments.length - 1] }
      await this.history.commitLayer(locSig, { ...cur, [slot]: [...sigs] })
    },
  }

  registry(): Record<string, unknown> {
    return {
      '@diamondcoreprocessor.com/HistoryService': this.history,
      '@hypercomb.social/Store': this.store,
      '@diamondcoreprocessor.com/LayerCommitter': this.committer,
      '@hypercomb.social/Lineage': { domain: () => 'test' },
    }
  }

  /** The children sigs currently committed at [g] — what undo/redo moves. */
  headChildren(groupId: string): string[] {
    const head = this.heads.get(hex64('loc:' + groupId))
    return head ? (this.layers.get(head)?.children ?? []) : []
  }
}

let model: Model
let mod: typeof import('./aggregation-layer')

beforeEach(async () => {
  model = new Model()
  ;(globalThis as unknown as { get: (k: string) => unknown }).get = (k: string) => model.registry()[k]
  mod = await import('./aggregation-layer')
})

afterEach(() => {
  delete (globalThis as unknown as { get?: unknown }).get
})

describe('aggregation-layer — curated menu membership as a layer', () => {
  it('enable commits a launcher child into [g] via the committer and list reads it back', async () => {
    const marker = await mod.enableAggregation('websites', ['humanity-centres'], { label: 'Humanity Centres', icon: 'web' })
    expect(marker).toMatch(/^[0-9a-f]{64}$/)

    // the mutation went through the committer at ['websites'] (undo/redo unit)
    expect(model.commitSlotSetCalls).toHaveLength(1)
    expect(model.commitSlotSetCalls[0]).toMatchObject({ segments: ['websites'], slot: 'children' })
    expect(model.commitSlotSetCalls[0].sigs).toContain(marker)

    const members = await mod.listAggregation('websites')
    expect(members).toHaveLength(1)
    expect(members[0]).toMatchObject({ segments: ['humanity-centres'], label: 'Humanity Centres', icon: 'web' })
  })

  it('accumulates multiple members, order preserved', async () => {
    await mod.enableAggregation('websites', ['susan'], { label: 'Susan' })
    await mod.enableAggregation('websites', ['howard'], { label: 'Howard' })
    const labels = (await mod.listAggregation('websites')).map(m => m.label)
    expect(labels).toEqual(['Susan', 'Howard'])
  })

  it('re-enabling the same path replaces (never duplicates) its launcher cell', async () => {
    await mod.enableAggregation('websites', ['susan'], { label: 'Susan', icon: 'web' })
    await mod.enableAggregation('websites', ['susan'], { label: 'Susan Family Support', icon: 'favorite' })
    const members = await mod.listAggregation('websites')
    expect(members).toHaveLength(1)
    expect(members[0]).toMatchObject({ label: 'Susan Family Support', icon: 'favorite' })
  })

  it('disable commits the children minus the member and returns true', async () => {
    await mod.enableAggregation('websites', ['susan'], { label: 'Susan' })
    await mod.enableAggregation('websites', ['howard'], { label: 'Howard' })
    const before = model.commitSlotSetCalls.length

    const removed = await mod.disableAggregation('websites', ['susan'])
    expect(removed).toBe(true)
    expect(model.commitSlotSetCalls.length).toBe(before + 1)   // one more commit — one undo step

    const labels = (await mod.listAggregation('websites')).map(m => m.label)
    expect(labels).toEqual(['Howard'])
  })

  it('disabling an absent member is a no-op (no commit, returns false)', async () => {
    await mod.enableAggregation('websites', ['susan'], { label: 'Susan' })
    const before = model.commitSlotSetCalls.length
    const removed = await mod.disableAggregation('websites', ['nope'])
    expect(removed).toBe(false)
    expect(model.commitSlotSetCalls.length).toBe(before)
  })

  it('membership IS the layer: reverting the committed children (undo) restores the prior menu', async () => {
    await mod.enableAggregation('websites', ['susan'], { label: 'Susan' })
    const childrenAfterSusan = model.headChildren('websites')          // the committed state
    await mod.enableAggregation('websites', ['howard'], { label: 'Howard' })
    expect((await mod.listAggregation('websites')).map(m => m.label)).toEqual(['Susan', 'Howard'])

    // Undo = move [websites]'s head back to the prior marker — normal history.
    // Re-commit the earlier children set to simulate the cursor stepping back.
    await model.committer.commitSlotSet(['websites'], 'children', childrenAfterSusan)
    expect((await mod.listAggregation('websites')).map(m => m.label)).toEqual(['Susan'])
  })

  it('is generic across groups — the same primitive drives any curated menu', async () => {
    await mod.enableAggregation('collections', ['sets', 'favorites'], { label: 'Favorites' })
    const members = await mod.listAggregation('collections')
    expect(members).toHaveLength(1)
    expect(members[0].segments).toEqual(['sets', 'favorites'])
    // and it didn't leak into another group
    expect(await mod.listAggregation('websites')).toHaveLength(0)
  })
})
