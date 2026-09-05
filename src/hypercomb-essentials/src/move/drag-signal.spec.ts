// The viewport refuses to fit while a tile is in hand. That refusal is only as
// good as the signal it reads, so the signal is pinned here: it goes up when a
// drag is genuinely established, comes down on every way out (commit, cancel,
// leaving move mode), and NEVER flashes on a refused grab.

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

/** Two tiles side by side, both selected, on a three-slot ring. */
const seed = (move: any): void => {
  const coords = [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }]
  registry.set('@diamondcoreprocessor.com/AxialService', {
    items: coords.map((c, i) => [i, c] as const),
  })
  registry.set('@diamondcoreprocessor.com/SelectionService', {
    selected: new Set(['alpha', 'beta']),
  })
  EffectBus.emit('render:cell-count', {
    count: 2,
    labels: ['alpha', 'beta'],
    coords: [coords[0], coords[1]],
  })
}

describe('move:drag — the tile-in-hand signal', () => {
  let move: any
  let seen: boolean[]

  beforeEach(async () => {
    await import('./move.drone.js')
    move = registry.get('@diamondcoreprocessor.com/MoveDrone')
    await move.heartbeat()
    seed(move)
    seen = []
    EffectBus.on('move:drag', (p: any) => { seen.push(p.active) })
    seen.length = 0
  })

  it('raises on an established grab and drops on cancel', () => {
    expect(move.beginMove({ q: 0, r: 0 }, 'test')).toBe(true)
    expect(move.dragActive).toBe(true)
    expect(seen).toEqual([true])

    move.cancelMove('test')
    expect(move.dragActive).toBe(false)
    expect(seen).toEqual([true, false])
  })

  it('never raises for a grab that was refused', () => {
    // Empty ground: no tile sits at this axial, so there is nothing in hand.
    expect(move.beginMove({ q: 9, r: 9 }, 'test')).toBe(false)
    expect(move.dragActive).toBe(false)
    expect(seen).not.toContain(true)
  })

  it('drops the signal when move mode is switched off mid-drag', () => {
    expect(move.beginMove({ q: 0, r: 0 }, 'test')).toBe(true)
    expect(seen.at(-1)).toBe(true)

    // The controls-bar move switch, pressed twice: on, then off while a tile
    // is still in hand. The second press cancels the drag.
    EffectBus.emit('controls:action', { action: 'move' })
    EffectBus.emit('controls:action', { action: 'move' })

    expect(move.dragActive).toBe(false)
    expect(seen.at(-1)).toBe(false)
  })
})
