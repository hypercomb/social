// commands/decoration-kind-index.peer-only.spec.ts
//
// A PEER'S CELL HAS NO LAYER HERE, SO THE INDEX NEVER WALKS IT (SCALE-1).
//
// Every render pass hands the decoration index the page's labels, and the
// index walks each one's layer for its decorations. A label whose walk finds
// no layer is forgotten so the next pass retries it — right for the hive's own
// cells (a visitor's preview head lands just after the first paint), but a
// peer's cell has no layer of this hive at all. At a meeting of a thousand
// peer tiles every pass asked history for a thousand absent layers — each a
// lineage sign, a bag miss and a parent-manifest read — measured at ~79,000
// layer reads and ~37,000 manifest reads in 40 s of one shell, with its own
// new tile queued behind them on the way to the room (0.87-1.57 s from Enter).
// show-cell now names the peer-only cells in `render:cell-count`
// (`peerOnlyLabels`) and the walk leaves them out.

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: (key: string) => iocTable[key],
    whenReady: () => { /* noop */ },
  }
})

const resources = new Map<string, string>()
const layers = new Map<string, string[]>()
/** Every location the walk asked history for, in order. */
const asked: string[] = []
let here: readonly string[] = []

const iocTable: Record<string, unknown> = {
  '@hypercomb.social/Store': {
    getResource: async (sig: string) => {
      const json = resources.get(sig)
      return json === undefined ? null : ({ text: async () => json } as unknown as Blob)
    },
  },
  '@hypercomb.social/Lineage': { explorerSegments: () => here },
  '@diamondcoreprocessor.com/HistoryService': {
    sign: async (l: { explorerSegments?: () => readonly string[] }) =>
      (l.explorerSegments?.() ?? []).join('/'),
    currentLayerAt: async (sig: string) => {
      asked.push(sig)
      const decorations = layers.get(sig)
      return decorations ? { decorations } : null
    },
  },
}

const { EffectBus } = await import('@hypercomb/core')
const index = await import('./decoration-kind-index.js')

const tagSig = (name: string): string => {
  const json = JSON.stringify({ kind: 'tag', appliesTo: [], payload: { name } })
  const sig = String(resources.size + 1).padStart(64, '0')
  resources.set(sig, json)
  return sig
}

/** One render pass's emit, and the walk it starts settled. */
async function pass(labels: string[], peerOnlyLabels?: string[]): Promise<void> {
  EffectBus.emit('render:cell-count', { labels, flatPaths: {}, ...(peerOnlyLabels ? { peerOnlyLabels } : {}) })
  for (let i = 0; i < 6; i++) await Promise.resolve()
  await new Promise(r => setTimeout(r, 0))
}

beforeEach(() => {
  asked.length = 0
  here = ['meeting']
})

describe('decoration index — a peer-only cell is never walked', () => {
  it('passes that name peer-only cells ask history nothing about them', async () => {
    const peers = Array.from({ length: 50 }, (_, i) => `peer-${i}`)
    layers.set('meeting/own', [tagSig('mine')])
    for (let n = 0; n < 3; n++) await pass(['own', ...peers], peers)
    // Each of three passes used to walk all fifty again (no layer → retried).
    expect(asked.filter(sig => sig.startsWith('meeting/peer-'))).toEqual([])
    // The hive's own cell is walked once and remembered, as before.
    expect(asked.filter(sig => sig === 'meeting/own')).toEqual(['meeting/own'])
    expect(index.tagsForLabel('own')).toEqual(['mine'])
  })

  it('a name the hive comes to hold is walked on the first pass that is not peer-only', async () => {
    await pass(['adopted'], ['adopted'])
    expect(asked).not.toContain('meeting/adopted')
    layers.set('meeting/adopted', [tagSig('taken')])
    await pass(['adopted'], [])
    expect(asked).toContain('meeting/adopted')
    await vi.waitFor(() => expect(index.tagsForLabel('adopted')).toEqual(['taken']))
  })

  it('an own cell with no layer yet is still retried on every pass (the preview race)', async () => {
    await pass(['cold'], [])
    await pass(['cold'], [])
    expect(asked.filter(sig => sig === 'meeting/cold')).toEqual(['meeting/cold', 'meeting/cold'])
  })

  it('a payload without the field walks every label, as before', async () => {
    await pass(['legacy-a', 'legacy-b'])
    expect(asked).toEqual(expect.arrayContaining(['meeting/legacy-a', 'meeting/legacy-b']))
  })
})
