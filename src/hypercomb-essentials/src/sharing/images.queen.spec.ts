// sharing/images.queen.spec.ts — `images` with nothing, one and several tiles
// selected: one tile is the wall as it always was, several is the queue (every
// selected tile, in selection order), and a named tile ignores the selection.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const held = vi.hoisted(() => ({ selected: new Set<string>(), segments: ['home'] as string[] }))

vi.hoisted(() => {
  ;(globalThis as unknown as { window: unknown }).window = globalThis
  ;(globalThis as unknown as { ioc: unknown }).ioc = {
    register: () => {},
    whenReady: () => {},
    get: (key: string) => {
      if (key === '@diamondcoreprocessor.com/SelectionService') return { selected: held.selected }
      if (key === '@hypercomb.social/Lineage') return { explorerSegments: () => held.segments }
      return undefined
    },
  }
})

import { EffectBus } from '@hypercomb/core'
import { ImagesQueenBee } from './images.queen.js'

const run = (args: string) => (new ImagesQueenBee() as unknown as { execute(a: string): Promise<void> }).execute(args)

let emitted: { effect: string; payload: unknown }[] = []
let spy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  emitted = []
  spy = vi.spyOn(EffectBus, 'emit').mockImplementation((effect: string, payload: unknown) => { emitted.push({ effect, payload }) })
})
afterEach(() => { spy.mockRestore(); held.selected = new Set() })

const opened = () => emitted.filter(e => e.effect === 'images:open').map(e => e.payload)

describe('images', () => {
  it('with nothing selected and nothing named, asks for a tile and opens nothing', async () => {
    await run('')
    expect(opened()).toEqual([])
    expect(emitted.some(e => e.effect === 'activity:log')).toBe(true)
  })

  it('with one tile selected, opens that tile\'s wall exactly as before — no queue', async () => {
    held.selected = new Set(['garden'])
    await run('')
    expect(opened()).toEqual([{ label: 'garden', segments: ['home'] }])
  })

  it('with several selected, opens the queue: the first now, every one in selection order', async () => {
    held.selected = new Set(['fog', 'garden', 'lantern'])
    await run('')
    expect(opened()).toEqual([{ label: 'fog', labels: ['fog', 'garden', 'lantern'], segments: ['home'] }])
  })

  it('a named tile is that tile, whatever is selected', async () => {
    held.selected = new Set(['fog', 'garden'])
    await run('Moss')
    expect(opened()).toEqual([{ label: 'moss', segments: ['home'] }])
  })
})
