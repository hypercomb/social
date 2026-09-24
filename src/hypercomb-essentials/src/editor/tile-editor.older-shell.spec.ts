// An older shell still carrying the Angular tile editor keeps it: the bee's
// lazy path must not define a second presenter for the same session when the
// first edit arrives (see tile-editor.lazy.spec.ts for the ordinary shell).

import { describe, expect, it, vi } from 'vitest'

const TAG = 'hc-tile-editor'

const state = vi.hoisted(() => ({ services: new Map<string, unknown>(), added: [] as unknown[] }))

vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    get: (key: string) => state.services.get(key),
    register: (key: string, value: unknown) => { if (!state.services.has(key)) state.services.set(key, value) },
    whenReady: (key: string, callback: (value: unknown) => void) => {
      if (key !== '@hypercomb.social/ShellSurfaceRegistry') return
      callback({ add: (s: unknown) => state.added.push(s), all: () => [{ name: TAG, component: class AngularTileEditor {} }] })
    },
  }
})

vi.mock('./tile-properties.js', () => ({
  readTilePropertiesAt: vi.fn(async () => ({})),
  writeTilePropertiesAt: vi.fn(),
  cellLocationSig: vi.fn(),
  readTilePropsIndex: vi.fn(() => ({})),
  lookupTilePropsSig: vi.fn(),
  readCellProperties: vi.fn(),
}))
vi.mock('../commands/decoration-kind-index.js', () => ({
  referenceTargetForLabel: vi.fn(() => null),
  referenceEditsRootDefaultForLabel: vi.fn(() => false),
}))

import { EffectBus } from '@hypercomb/core'
import type { TileEditorService } from './tile-editor.service.js'

state.services.set('@hypercomb.social/Store', { getResource: async () => null, putResource: async () => '' })
state.services.set('@hypercomb.social/Lineage', { explorerSegments: () => [] })
await import('./tile-editor.drone.js')

describe('tile editor — an older shell with the Angular editor', () => {
  it('adds no surface, and the first edit opens the session without defining the element', async () => {
    const service = state.services.get('@diamondcoreprocessor.com/TileEditorService') as TileEditorService
    EffectBus.emit('tile:action', { action: 'edit', label: 'alpha', q: 0, r: 0, index: 0 })
    await vi.waitFor(() => expect(service.cell).toBe('alpha'))
    expect(state.added).toEqual([])
    expect(customElements.get(TAG)).toBeUndefined()
    service.close()
  })
})
