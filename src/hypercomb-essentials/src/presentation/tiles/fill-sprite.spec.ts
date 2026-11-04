import { describe, expect, it } from 'vitest'
import {
  FILL_CAPACITY, FILL_CELL, FILL_COLS,
  divideBySheet, fillFrame, fillManifestKey, fillSheetKey, fillSheetSize, fillSlotKey, fillTailKey,
} from './fill-sprite.js'
import type { ThumbnailStore } from './thumbnails.js'

const sig = (n: number): string => n.toString(16).padStart(64, '0')

/** A sprites:boot pool held in memory: file name → text. */
const storeWith = async (records: Record<string, unknown>): Promise<ThumbnailStore> => {
  const files = new Map<string, string>()
  for (const [key, value] of Object.entries(records)) files.set(key, JSON.stringify(value))
  const pool = {
    getFileHandle: async (name: string) => {
      const text = files.get(name)
      if (text === undefined) throw new DOMException('missing', 'NotFoundError')
      // A file as the reader uses it (jsdom's Blob has no text()).
      return { getFile: async () => ({ size: text.length, text: async () => text }) }
    },
  } as unknown as FileSystemDirectoryHandle
  return { getPool: async () => pool, getResource: async () => null }
}

describe('fill sheets', () => {
  it('a slot sits at the same frame on every version of its sheet', () => {
    expect(fillFrame(0)).toEqual({ x: 0, y: 0, width: FILL_CELL, height: FILL_CELL })
    expect(fillFrame(FILL_COLS)).toEqual({ x: 0, y: FILL_CELL, width: FILL_CELL, height: FILL_CELL })
    expect(fillFrame(FILL_CAPACITY - 1)).toEqual({
      x: (FILL_COLS - 1) * FILL_CELL, y: (FILL_CAPACITY / FILL_COLS - 1) * FILL_CELL, width: FILL_CELL, height: FILL_CELL,
    })
  })

  it('a sheet is only as tall as the rows it fills', () => {
    expect(fillSheetSize(1)).toEqual({ width: FILL_CELL, height: FILL_CELL })
    expect(fillSheetSize(FILL_COLS + 1)).toEqual({ width: FILL_COLS * FILL_CELL, height: 2 * FILL_CELL })
    expect(fillSheetSize(FILL_CAPACITY + 9)).toEqual(fillSheetSize(FILL_CAPACITY))
  })

  it('every kind of record has its own key, and none is the source signature', async () => {
    const keys = [
      await fillSheetKey([sig(1)]), await fillManifestKey(sig(1)), await fillSlotKey(sig(1)), await fillTailKey(),
    ]
    expect(new Set(keys).size).toBe(4)
    expect(keys).not.toContain(sig(1))
    expect(await fillSheetKey([sig(1), sig(2)])).not.toBe(await fillSheetKey([sig(2), sig(1)]))
  })

  it('divides what is wanted: a sheet holding two or more, singles for the rest', async () => {
    const sheetA = sig(100)
    const sheetB = sig(200)
    const store = await storeWith({
      [await fillSlotKey(sig(1))]: { sheet: sheetA, slot: 0 },
      [await fillSlotKey(sig(2))]: { sheet: sheetA, slot: 3 },
      [await fillSlotKey(sig(3))]: { sheet: sheetB, slot: 1 },
    })
    const division = await divideBySheet(store, [sig(1), sig(2), sig(3), sig(4), sig(1)])
    expect([...division.sheets.keys()]).toEqual([sheetA])
    expect(division.sheets.get(sheetA)).toEqual([{ sig: sig(1), slot: 0 }, { sig: sig(2), slot: 3 }])
    expect(division.singles.sort()).toEqual([sig(3), sig(4)].sort())
  })

  it('a slot record out of range is no slot at all', async () => {
    const store = await storeWith({
      [await fillSlotKey(sig(1))]: { sheet: sig(100), slot: FILL_CAPACITY },
      [await fillSlotKey(sig(2))]: { sheet: sig(100), slot: 0 },
    })
    const division = await divideBySheet(store, [sig(1), sig(2)])
    expect(division.sheets.size).toBe(0)
    expect(division.singles.sort()).toEqual([sig(1), sig(2)].sort())
  })
})
