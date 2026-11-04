import { describe, expect, it } from 'vitest'
import {
  FILL_CAPACITY, FILL_GAP, FILL_HEX_R, FILL_ORIENTATIONS,
  divideBySheet, fillCentre, fillFrame, fillManifestKey, fillSheetKey, fillSheetSize, fillSlotKey, fillTailKey,
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

const pair = (a: number, b: number) => ({ point: sig(a), flat: sig(b) })

describe('fill sheets — the normal hexagon matrix, in pairs', () => {
  it('slot 0 is the centre of the honeycomb and ring one sits one spacing away', () => {
    for (const orientation of FILL_ORIENTATIONS) {
      const centre = fillCentre(0, orientation)
      for (let slot = 1; slot <= 6; slot++) {
        const c = fillCentre(slot, orientation)
        // Neighbours on the hive's grid: √3 × (circumradius + gap) apart.
        expect(Math.hypot(c.x - centre.x, c.y - centre.y)).toBeCloseTo(Math.sqrt(3) * (FILL_HEX_R + FILL_GAP), 6)
      }
    }
  })

  it('every slot of a full sheet is on the canvas, with the gap as its margin', () => {
    for (const orientation of FILL_ORIENTATIONS) {
      const size = fillSheetSize(orientation)
      for (let slot = 0; slot < FILL_CAPACITY; slot++) {
        const f = fillFrame(slot, orientation)
        expect(f.x).toBeGreaterThanOrEqual(0)
        expect(f.y).toBeGreaterThanOrEqual(0)
        expect(f.x + f.width).toBeLessThanOrEqual(size.width)
        expect(f.y + f.height).toBeLessThanOrEqual(size.height)
      }
    }
  })

  it('no two cells overlap: centres are at least two circumradii plus the gap apart', () => {
    for (const orientation of FILL_ORIENTATIONS) {
      for (let a = 0; a < FILL_CAPACITY; a++) {
        for (let b = a + 1; b < FILL_CAPACITY; b++) {
          const p = fillCentre(a, orientation)
          const q = fillCentre(b, orientation)
          // Inscribed circles (r·√3/2) must not meet: hexagons that touch only at the gap.
          expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(Math.sqrt(3) * FILL_HEX_R)
        }
      }
    }
  })

  it('a pointy cell is taller than wide, a flat cell wider than tall', () => {
    const point = fillFrame(0, 'point')
    const flat = fillFrame(0, 'flat')
    expect(point.height).toBeGreaterThan(point.width)
    expect(flat.width).toBeGreaterThan(flat.height)
  })

  it('every kind of record has its own key, and none is the source signature', async () => {
    const keys = [
      await fillSheetKey([sig(1)], 'point'), await fillSheetKey([sig(1)], 'flat'),
      await fillManifestKey(sig(1)), await fillSlotKey(sig(1)), await fillTailKey(),
    ]
    expect(new Set(keys).size).toBe(5)
    expect(keys).not.toContain(sig(1))
    expect(await fillSheetKey([sig(1), sig(2)], 'point')).not.toBe(await fillSheetKey([sig(2), sig(1)], 'point'))
  })

  it('divides what is wanted by the orientation asked for: two or more on a sheet, singles for the rest', async () => {
    const store = await storeWith({
      [await fillSlotKey(sig(1))]: { sheets: pair(100, 101), slot: 0 },
      [await fillSlotKey(sig(2))]: { sheets: pair(100, 101), slot: 3 },
      [await fillSlotKey(sig(3))]: { sheets: pair(200, 201), slot: 1 },
    })
    const point = await divideBySheet(store, [sig(1), sig(2), sig(3), sig(4), sig(1)], 'point')
    expect([...point.sheets.keys()]).toEqual([sig(100)])
    expect(point.sheets.get(sig(100))).toEqual([{ sig: sig(1), slot: 0 }, { sig: sig(2), slot: 3 }])
    expect(point.singles.sort()).toEqual([sig(3), sig(4)].sort())
    const flat = await divideBySheet(store, [sig(1), sig(2)], 'flat')
    expect([...flat.sheets.keys()]).toEqual([sig(101)])
  })

  it('a slot record out of range, or missing half its pair, is no slot at all', async () => {
    const store = await storeWith({
      [await fillSlotKey(sig(1))]: { sheets: pair(100, 101), slot: FILL_CAPACITY },
      [await fillSlotKey(sig(2))]: { sheets: { point: sig(100) }, slot: 0 },
    })
    const division = await divideBySheet(store, [sig(1), sig(2)], 'point')
    expect(division.sheets.size).toBe(0)
    expect(division.singles.sort()).toEqual([sig(1), sig(2)].sort())
  })
})
