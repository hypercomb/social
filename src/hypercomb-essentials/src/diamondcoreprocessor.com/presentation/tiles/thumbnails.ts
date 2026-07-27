// diamondcoreprocessor.com/presentation/tiles/thumbnails.ts
//
// Hex thumbnails — a derived cache, NOT a tile property.
//
// Drawing a branch as icon-sized tiles means decoding one picture per node.
// At full resolution that is ruinous: a viewport of 60 nodes can be tens of
// megabytes of decoded bitmap for something rendered 22 pixels across. A
// thumbnail fixes that — but where it lives matters more than that it exists.
//
// It does NOT go in `properties`. A thumbnail is a pure derivation of the
// image bytes, so by the optimize-phase contract it is a derived cache and
// never truth. Storing it in props would also mint a new props blob → a new
// layer → a HISTORY ENTRY for every tile whose thumbnail was generated,
// spamming the lineage with something any client can recompute.
//
// Instead: keyed by the SOURCE IMAGE SIGNATURE in the sign('thumbnails:hex')
// pool. That addressing direction makes invalidation automatic — a changed
// picture is a new sig with no record yet — and it dedupes across every tile
// sharing a picture, and across every feature that wants a small version of
// the same bytes. Nothing is load-bearing: a missing record just means the
// reader falls back to the full image, heavier but identical.
//
// The meaning carries a colon so it can never collide with a lineage bag
// named after a tile slug.

/** Pool of meaning holding hex thumbnails, keyed by source image sig. */
export const THUMBNAIL_MEANING = 'thumbnails:hex'

/** Long edge of a stored thumbnail. Comfortably above the largest icon
 *  (32px) at 2× device pixels plus zoom headroom, and still ~3KB of webp. */
export const THUMBNAIL_SIZE = 96

export type ThumbnailStore = {
  getPool(meaning: string): Promise<FileSystemDirectoryHandle | null>
  getResource(sig: string): Promise<Blob | null>
}

/** Read the thumbnail for a source image sig, or null when none is cached
 *  yet. A miss is normal and never an error — the caller falls back. */
export async function readThumbnail(
  store: ThumbnailStore,
  imageSig: string,
): Promise<Blob | null> {
  try {
    const pool = await store.getPool(THUMBNAIL_MEANING)
    if (!pool) return null
    const handle = await pool.getFileHandle(imageSig, { create: false })
    const file = await handle.getFile()
    return file.size > 0 ? file : null
  } catch {
    return null
  }
}

/** Write a thumbnail record. Best-effort: this is cache, and a failed write
 *  costs nothing but a re-derive later. */
export async function writeThumbnail(
  store: ThumbnailStore,
  imageSig: string,
  bytes: ArrayBuffer,
): Promise<boolean> {
  try {
    const pool = await store.getPool(THUMBNAIL_MEANING)
    if (!pool) return false
    const handle = await pool.getFileHandle(imageSig, { create: true })
    const writable = await handle.createWritable()
    try { await writable.write(bytes) } finally { await writable.close() }
    return true
  } catch {
    return false
  }
}

/**
 * Downscale image bytes to a square THUMBNAIL_SIZE, cover-cropped so a hex
 * clip never shows letterboxing. Returns null when the environment cannot
 * do it (no OffscreenCanvas / undecodable bytes) — the cold path stays
 * correct without a thumbnail, so refusing is always safe.
 */
export async function deriveThumbnail(source: Blob): Promise<ArrayBuffer | null> {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return null
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(source)
    const side = Math.min(bitmap.width, bitmap.height)
    if (side <= 0) return null
    // Already small enough that a thumbnail would not pay for itself.
    if (Math.max(bitmap.width, bitmap.height) <= THUMBNAIL_SIZE) return null

    const canvas = new OffscreenCanvas(THUMBNAIL_SIZE, THUMBNAIL_SIZE)
    const context = canvas.getContext('2d')
    if (!context) return null
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    // Centre cover-crop: take the largest centred square, scale it down.
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side,
      0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE,
    )
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.82 })
    return await blob.arrayBuffer()
  } catch {
    return null
  } finally {
    bitmap?.close()
  }
}
