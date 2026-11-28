// seal-restore.spec.ts — the restore walk puts EVERY location back, including the ones whose sealed layer is the same
// signature as a layer somewhere else in the tree (two tiles with the same name and the same content seal to one sig).

import { describe, expect, it } from 'vitest'

const registrations = new Map<string, unknown>()
const ioc = { register: (key: string, value: unknown) => registrations.set(key, value), get: (key: string) => registrations.get(key) }
;(globalThis as unknown as { window: unknown }).window = { ioc }
;(globalThis as unknown as { ioc: unknown }).ioc = ioc

const { applySealAt } = await import('./seal-restore.js')

type Layer = { name: string; children?: string[]; [slot: string]: unknown }

/** A history with layers by sig and one head per location (the location is its path). */
const fakeHistory = (layers: Record<string, Layer>) => {
  const heads = new Map<string, Layer>()
  const history = {
    getLayerBySig: async (sig: string) => layers[sig] ?? null,
    sign: async (lineage: { explorerSegments: () => readonly string[] }) => '/' + lineage.explorerSegments().join('/'),
    currentLayerAt: async (loc: string) => heads.get(loc) ?? null,
    latestMarkerSigFor: async (loc: string) => heads.has(loc) ? JSON.stringify(heads.get(loc)) : null,
    commitLayer: async (loc: string, layer: Layer) => { heads.set(loc, layer); return JSON.stringify(layer) },
  }
  registrations.set('@diamondcoreprocessor.com/HistoryService', history)
  return heads
}

describe('applySealAt', () => {
  it('restores a layer at every location it sits at, not only the first', async () => {
    // /a/notes and /b/notes are byte-identical (same name, no children): ONE sealed signature.
    const layers: Record<string, Layer> = {
      notes: { name: 'notes' },
      a: { name: 'a', children: ['notes'] },
      b: { name: 'b', children: ['notes'] },
      root: { name: '/', children: ['a', 'b'] },
    }
    const heads = fakeHistory(layers)
    const result = await applySealAt([], 'root', [])
    expect(result).toEqual({ changed: 5, failed: 0 })
    expect([...heads.keys()].sort()).toEqual(['/', '/a', '/a/notes', '/b', '/b/notes'])
  })

  it('still stops at a content cycle', async () => {
    const layers: Record<string, Layer> = { loop: { name: 'loop', children: ['loop'] } }
    const heads = fakeHistory(layers)
    const result = await applySealAt([], 'loop', [])
    expect(result).toEqual({ changed: 1, failed: 1 })
    expect([...heads.keys()]).toEqual(['/'])
  })
})
