// A drop ends the selection (jwize 2026-11-06: "when you drop items on move
// they should always be unselected even on one"). Only a cross-layer move used
// to clear it, so a plain reorder left the dragged tiles lit — and a lone
// selected tile looked "still picked up" after it landed.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const registry = new Map<string, any>()

beforeAll(() => {
  Object.defineProperty(window, 'ioc', {
    configurable: true,
    value: {
      get: (key: string) => registry.get(key),
      register: (key: string, value: unknown) => registry.set(key, value),
      whenReady: () => {},
    },
  })
})

/** Three slots, two tiles on them, `picked` selected. */
const seed = (picked: string[]): { selected: Set<string>; cleared: number } => {
  const coords = [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }]
  registry.set('@diamondcoreprocessor.com/AxialService', {
    items: coords.map((c, i) => [i, c] as const),
  })
  const selection = {
    selected: new Set(picked),
    cleared: 0,
    clear() { this.cleared++; this.selected.clear() },
  }
  registry.set('@diamondcoreprocessor.com/SelectionService', selection)
  EffectBus.emit('render:cell-count', {
    count: 2,
    labels: ['alpha', 'beta'],
    coords: [coords[0], coords[1]],
  })
  return selection
}

describe('a drop deselects', () => {
  let move: any

  beforeEach(async () => {
    await import('./move.drone.js')
    move = registry.get('@diamondcoreprocessor.com/MoveDrone')
    await move.heartbeat()
  })

  it('one selected tile, dropped back where it was', async () => {
    const selection = seed(['alpha'])
    expect(move.beginMove({ q: 0, r: 0 }, 'test')).toBe(true)

    await move.commitMoveAt({ q: 0, r: 0 }, 'test')

    expect(selection.selected.size).toBe(0)
    expect(selection.cleared).toBe(1)
  })

  it('one selected tile, dropped on another slot', async () => {
    const selection = seed(['alpha'])
    expect(move.beginMove({ q: 0, r: 0 }, 'test')).toBe(true)

    await move.commitMoveAt({ q: 2, r: 0 }, 'test')

    expect(selection.selected.size).toBe(0)
  })

  it('a whole selection, dropped', async () => {
    const selection = seed(['alpha', 'beta'])
    expect(move.beginMove({ q: 0, r: 0 }, 'test')).toBe(true)

    await move.commitMoveAt({ q: 1, r: 0 }, 'test')

    expect(selection.selected.size).toBe(0)
  })

  it('an unselected tile dragged alone also leaves nothing selected', async () => {
    const selection = seed(['beta'])
    expect(move.beginMove({ q: 0, r: 0 }, 'test')).toBe(true)

    await move.commitMoveAt({ q: 2, r: 0 }, 'test')

    expect(selection.selected.size).toBe(0)
  })

  it('cancelling a drag (Escape) keeps the selection — nothing was dropped', () => {
    const selection = seed(['alpha'])
    expect(move.beginMove({ q: 0, r: 0 }, 'test')).toBe(true)

    move.cancelMove('test')

    expect([...selection.selected]).toEqual(['alpha'])
  })
})
