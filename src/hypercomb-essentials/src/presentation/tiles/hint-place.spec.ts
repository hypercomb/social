// hint-place.spec.ts — where an icon's explanation is said, and how the choice is kept.

import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_HINT_PLACE, hintPlaceOf, keepHintPlace, otherHintPlace, recallHintPlace } from './hint-place.js'

type Holder = { bytes: ArrayBuffer | null }

/** A store with one pool doc per meaning, the way the real one keeps `keep: 'current'`. */
const installStore = (): Map<string, Holder> => {
  const pools = new Map<string, Holder>()
  const store = {
    getPool: async (meaning: string) => {
      if (!pools.has(meaning)) pools.set(meaning, { bytes: null })
      return { name: meaning } as unknown as FileSystemDirectoryHandle
    },
    getPoolDoc: async (pool: FileSystemDirectoryHandle) => pools.get((pool as unknown as { name: string }).name)?.bytes ?? null,
    putPoolDoc: async (pool: FileSystemDirectoryHandle, bytes: ArrayBuffer) => {
      pools.get((pool as unknown as { name: string }).name)!.bytes = bytes
    },
  }
  ;(globalThis as unknown as { ioc: unknown }).ioc = {
    get: (key: string) => (key === '@hypercomb.social/Store' ? store : undefined),
    whenReady: () => void 0,
  }
  return pools
}

afterEach(() => { delete (globalThis as { ioc?: unknown }).ioc })

describe('the words that name a place', () => {
  it('the tile is the default', () => {
    expect(DEFAULT_HINT_PLACE).toBe('tile')
  })

  it('names the tile and the top, in a few spellings, and nothing else', () => {
    expect(hintPlaceOf('tile')).toBe('tile')
    expect(hintPlaceOf(' On-Tile ')).toBe('tile')
    expect(hintPlaceOf('label')).toBe('tile')
    expect(hintPlaceOf('top')).toBe('top')
    expect(hintPlaceOf('Caption')).toBe('top')
    expect(hintPlaceOf('')).toBeNull()
    expect(hintPlaceOf('sideways')).toBeNull()
    expect(hintPlaceOf(undefined)).toBeNull()
  })

  it('a bare word flips to the other way', () => {
    expect(otherHintPlace('tile')).toBe('top')
    expect(otherHintPlace('top')).toBe('tile')
  })
})

describe('the choice is kept in the store', () => {
  it('recalls nothing when nothing was kept', async () => {
    installStore()
    expect(await recallHintPlace()).toBeNull()
  })

  it('recalls what was kept, as one current record in the hint:place pool', async () => {
    const pools = installStore()
    await keepHintPlace('top')
    expect([...pools.keys()]).toEqual(['hint:place'])
    expect(await recallHintPlace()).toBe('top')
    await keepHintPlace('tile')
    expect(await recallHintPlace()).toBe('tile')
  })

  it('a record that is not ours leaves the default standing', async () => {
    const pools = installStore()
    await keepHintPlace('top')
    pools.get('hint:place')!.bytes = new TextEncoder().encode('{"place":"sideways"}').buffer as ArrayBuffer
    expect(await recallHintPlace()).toBeNull()
    pools.get('hint:place')!.bytes = new TextEncoder().encode('not json').buffer as ArrayBuffer
    expect(await recallHintPlace()).toBeNull()
  })

  it('keeping with no store is a quiet no-op', async () => {
    ;(globalThis as unknown as { ioc: unknown }).ioc = { get: () => undefined, whenReady: () => void 0 }
    await expect(keepHintPlace('top')).resolves.toBeUndefined()
  })
})
