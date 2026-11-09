// The preview ends with the drag (jwize 2026-11-09: "when I click any of the
// tiles instead of loading the related children it just renders the same layer
// again without images. I have to refresh to fix it").
//
// Read off the live hive: `move:preview` still held the root's slot array with
// `move:drag` inactive. A tile lifted past the drag threshold and set down on
// its own slot took the "no movement" way out of the drop, which cleared
// nothing — and the renderer treats a preview as the whole page, so every
// level walked into afterwards painted the root's tiles as tiles it does not
// hold (no pictures).

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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

const coords = [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }]

const seed = (): void => {
  registry.set('@diamondcoreprocessor.com/AxialService', {
    items: coords.map((c, i) => [i, c] as const),
  })
  registry.set('@diamondcoreprocessor.com/SelectionService', {
    selected: new Set<string>(),
    clear() { this.selected.clear() },
  })
  EffectBus.emit('render:cell-count', {
    count: 2,
    labels: ['alpha', 'beta'],
    coords: [coords[0], coords[1]],
  })
}

describe('the preview ends with the drag', () => {
  let move: any
  let previews: unknown[]
  let stop: (() => void) | undefined

  beforeEach(async () => {
    await import('./move.drone.js')
    move = registry.get('@diamondcoreprocessor.com/MoveDrone')
    await move.heartbeat()
    stop?.()
    previews = []
    seed()
    stop = EffectBus.on('move:preview', (p: unknown) => { previews.push(p) }) as (() => void) | undefined
    previews.length = 0   // drop the last-value replay
  })

  const last = (): unknown => previews[previews.length - 1]

  it('a tile lifted and set down on its own slot leaves no preview', async () => {
    expect(move.beginMove({ q: 0, r: 0 }, 'test')).toBe(true)
    move.updateMove({ q: 2, r: 0 }, 'test')
    move.updateMove({ q: 0, r: 0 }, 'test')
    expect(last()).not.toBeNull()   // a preview is up while the tile is in hand

    await move.commitMoveAt({ q: 0, r: 0 }, 'test')

    expect(last()).toBeNull()
  })

  it('a tile dropped on another slot leaves no preview', async () => {
    expect(move.beginMove({ q: 0, r: 0 }, 'test')).toBe(true)
    move.updateMove({ q: 2, r: 0 }, 'test')

    await move.commitMoveAt({ q: 2, r: 0 }, 'test')

    expect(last()).toBeNull()
  })

  it('a cancelled drag leaves no preview', () => {
    expect(move.beginMove({ q: 0, r: 0 }, 'test')).toBe(true)
    move.updateMove({ q: 2, r: 0 }, 'test')

    move.cancelMove('test')

    expect(last()).toBeNull()
  })

  // ShowCellDrone cannot be stood up under vitest, so its half is held by
  // shape: a preview belongs to the page it was made on, and arriving at
  // another location drops it whatever the emitter did.
  it('the renderer drops a preview when the location changes', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const source = readFileSync(join(here, '..', 'presentation', 'tiles', 'show-cell.drone.ts'), 'latin1')
    const start = source.indexOf('  #enterDerivedLocation = (locationKey: string): void => {')
    expect(start).toBeGreaterThan(-1)
    const body = source.slice(start, start + 900)
    expect(body).toMatch(/if \(locationKey === this\.#derivedLocationKey\) return[\s\S]*this\.moveNames = null/)
  })
})
