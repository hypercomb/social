// editor/tile-props-index.spec.ts — the props index is a session cache, not a store.
//
// It used to live in localStorage: participant state outside the graph, keyed
// by location, written on the commit path. It is memory now. The legacy key is
// read once as the walk-back and never written again, and nobody else reads
// the key at all — the layer IS the index.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

vi.hoisted(() => {
  ;(globalThis as unknown as { window: unknown }).window = globalThis
  ;(globalThis as unknown as { ioc: unknown }).ioc = { register: () => {}, get: () => undefined, whenReady: () => {} }
})

import { TILE_PROPS_INDEX_KEY, _resetTilePropsIndex, readTilePropsIndex, writeTilePropsIndex } from './tile-properties.js'

const A = 'a'.repeat(64), B = 'b'.repeat(64), C = 'c'.repeat(64)

describe('the session props index', () => {
  beforeEach(() => { localStorage.clear(); _resetTilePropsIndex() })

  it('walks back to the legacy key ONCE, then lives in memory', () => {
    localStorage.setItem(TILE_PROPS_INDEX_KEY, JSON.stringify({ [A]: B }))
    expect(readTilePropsIndex()).toEqual({ [A]: B })
    localStorage.setItem(TILE_PROPS_INDEX_KEY, JSON.stringify({ [A]: C }))   // storage moves; the session does not follow it
    expect(readTilePropsIndex()).toEqual({ [A]: B })
  })

  it('a write lands in memory and never in localStorage', () => {
    localStorage.setItem(TILE_PROPS_INDEX_KEY, JSON.stringify({ [A]: B }))
    const index = readTilePropsIndex()
    index[C] = A
    writeTilePropsIndex(index)
    expect(readTilePropsIndex()).toEqual({ [A]: B, [C]: A })
    expect(localStorage.getItem(TILE_PROPS_INDEX_KEY)).toBe(JSON.stringify({ [A]: B }))   // untouched
  })

  it('hands out snapshots — a caller that mutates without writing changes nothing', () => {
    const index = readTilePropsIndex()
    index[A] = B
    expect(readTilePropsIndex()).toEqual({})
  })

  it('starts empty from garbage in the legacy key', () => {
    localStorage.setItem(TILE_PROPS_INDEX_KEY, '[not, json')
    expect(readTilePropsIndex()).toEqual({})
  })
})

describe('the legacy key has ONE reader', () => {
  it('is read from storage only where the walk-back lives, and written nowhere', () => {
    const files = [
      ['hypercomb-essentials', 'src', 'editor', 'tile-properties.ts'],
      ['hypercomb-essentials', 'src', 'presentation', 'tiles', 'show-cell.drone.ts'],
      ['hypercomb-essentials', 'src', 'substrate', 'substrate.service.ts'],
      ['hypercomb-essentials', 'src', 'commands', 'translation.service.ts'],
      ['hypercomb-shared', 'ui', 'clipboard-thumbs.ts'],
      ['hypercomb-shared', 'ui', 'notes-strip', 'notes-strip.component.ts'],
    ]
    const storageRead = /localStorage\.getItem\(\s*(?:'hc:tile-props-index'|TILE_PROPS_INDEX_KEY|PROPS_INDEX_KEY)/g
    const storageWrite = /localStorage\.setItem\(\s*(?:'hc:tile-props-index'|TILE_PROPS_INDEX_KEY|PROPS_INDEX_KEY)/g
    for (const f of files) {
      const src = readFileSync(join(process.cwd(), ...f), 'utf8')
      const reads = (src.match(storageRead) ?? []).length
      expect(reads, f.join('/')).toBe(f[f.length - 1] === 'tile-properties.ts' ? 1 : 0)
      expect((src.match(storageWrite) ?? []).length, f.join('/')).toBe(0)
    }
  })
})
