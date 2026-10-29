// presentation/tiles/boot-sprite.ts
//
// ONE SMALL SHEET for a screen's pictures. A page of tiles used to wait on
// one decode per picture. The sheet is a single webp, a cell per source
// image, so the screen paints from one read and one decode.
//
// Derived cache, never truth. Keyed by the hash of the source image
// signatures, in sign('sprites:boot'). A miss paints from the per-image
// thumbnail, and a miss there paints the letter. Nothing here is load-bearing.

import type { ThumbnailStore } from './thumbnails.js'

/** Pool of meaning. Colon-scoped so it can never be a tile's bag. */
export const BOOT_SPRITE_MEANING = 'sprites:boot'

/** Edge of one cell in the sheet. Small on purpose: the whole screen is
 *  one tiny image, and the plate scales it up. */
export const BOOT_CELL = 64

/** Cells across the sheet. A short row uses fewer, so the sheet is tight. */
export const BOOT_COLS = 8

const SIG = /^[0-9a-f]{64}$/

/** Sorted unique source sigs, one per line. The sheet's cells follow this
 *  order, and the hash of this text is the pool key. */
export function bootSpriteMaterial(sigs: readonly string[]): string {
  return [...new Set(sigs.filter(sig => SIG.test(sig)))].sort().join('\n')
}

/** The pool file name for this set of pictures, or null when there are none. */
export async function bootSpriteSignature(sigs: readonly string[]): Promise<string | null> {
  const material = bootSpriteMaterial(sigs)
  if (!material) return null
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export function bootGrid(count: number): { cols: number; rows: number; cell: number } {
  const n = Math.max(0, Math.floor(count))
  const cols = n === 0 ? 1 : Math.min(BOOT_COLS, n)
  const rows = n === 0 ? 1 : Math.ceil(n / cols)
  return { cols, rows, cell: BOOT_CELL }
}

/**
 * CSS background-size and background-position that show cell `index` of a
 * sheet laid out by `bootGrid`. The percentages are the sprite-sheet
 * alignment: one cell fills the plate.
 */
export function spriteSliceStyle(
  index: number,
  count: number,
): { size: string; position: string } {
  const { cols, rows } = bootGrid(count)
  const at = Math.max(0, Math.floor(index))
  const col = at % cols
  const row = Math.floor(at / cols)
  const x = cols <= 1 ? 0 : (col / (cols - 1)) * 100
  const y = rows <= 1 ? 0 : (row / (rows - 1)) * 100
  return { size: `${cols * 100}% ${rows * 100}%`, position: `${x}% ${y}%` }
}

export async function readBootSprite(store: ThumbnailStore, key: string): Promise<Blob | null> {
  if (!SIG.test(key)) return null
  try {
    const pool = await store.getPool(BOOT_SPRITE_MEANING)
    if (!pool) return null
    const handle = await pool.getFileHandle(key, { create: false })
    const file = await handle.getFile()
    return file.size > 0 ? file : null
  } catch {
    return null
  }
}

export async function writeBootSprite(
  store: ThumbnailStore,
  key: string,
  bytes: ArrayBuffer,
): Promise<boolean> {
  if (!SIG.test(key) || bytes.byteLength === 0) return false
  try {
    const pool = await store.getPool(BOOT_SPRITE_MEANING)
    if (!pool) return false
    const handle = await pool.getFileHandle(key, { create: true })
    const writable = await handle.createWritable()
    try { await writable.write(bytes) } finally { await writable.close() }
    return true
  } catch {
    return false
  }
}

/**
 * Paint the sheet. `cells[i]` is the picture for material line i; a null
 * cell stays transparent so the index of every later picture holds.
 * Returns null where the environment cannot paint — the caller keeps the
 * per-image path, which is the correct picture, just heavier.
 */
export async function composeBootSprite(cells: readonly (Blob | null)[]): Promise<Blob | null> {
  if (!cells.length) return null
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return null
  const { cols, rows, cell } = bootGrid(cells.length)
  const canvas = new OffscreenCanvas(cols * cell, rows * cell)
  const context = canvas.getContext('2d')
  if (!context) return null
  for (let index = 0; index < cells.length; index++) {
    const blob = cells[index]
    if (!blob) continue
    let bitmap: ImageBitmap | null = null
    try {
      bitmap = await createImageBitmap(blob)
      const col = index % cols
      const row = Math.floor(index / cols)
      context.drawImage(bitmap, col * cell, row * cell, cell, cell)
    } catch {
      // A cell that will not decode stays blank. The rest of the sheet still lands.
    } finally {
      bitmap?.close()
    }
  }
  try {
    return await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 })
  } catch {
    return null
  }
}
