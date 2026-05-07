// diamondcoreprocessor.com/editor/tile-properties.ts
//
// 0000 — bootstrap skeleton standard
// =================================
// Every tile's directory holds a `0000` JSON file. This file is the tile's
// **bootstrap skeleton**: the minimum set of properties needed to render the
// tile at the right place with a default decoration before the live layer
// state has hydrated. Reading 0000 must be cheap, synchronous-ish, and
// sufficient to draw a first frame.
//
// Required fields:
//   - `index: number` — the tile's slot in the AxialService spiral. This is
//     the binding between a tile and its on-screen position. A tile without
//     an index has no place on the map; render must lazy-patch a missing
//     index the first time the tile is encountered (write next-free slot
//     back to 0000) so it never renders unanchored.
//
// Bootstrap-friendly optional fields:
//   - `imageSig: string` — signature of the bootstrap atlas image; resolves
//     to `__resources__/{sig}` and is enough for the shader to draw the
//     tile face on the first frame.
//
// Anything that is expensive to compute, changes frequently, or is
// authoritative belongs in the layer (live state) — not here. 0000 is
// open-ended; new bootstrap fields can be added as long as they remain
// cheap to read and meaningful for first paint.
export const TILE_PROPERTIES_FILE = '0000'

export interface TileProperties {
  /** Slot in the AxialService spiral. Required for placement; lazy-patched if missing. */
  index?: number
  /** Bootstrap atlas image signature; resolves to __resources__/{sig}. */
  imageSig?: string
  [key: string]: unknown
}

export const isSignature = (value: unknown): boolean =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)

// Write-through cache for 0000 properties. Keyed by a caller-supplied
// stable identifier (typically the cell's OPFS path). Reads consult the
// cache before hitting OPFS; writes update the cache synchronously and
// then persist. This makes the lazy index patch reliable: once a render
// pass assigns an index, every subsequent read in the same or later pass
// observes it immediately, regardless of OPFS read/write coherence
// timing.
const tilePropertiesCache = new Map<string, TileProperties>()

/**
 * Build a stable cache key from the cell's OPFS path. Pass the parent's
 * lineage segments and the cell label. Returns `undefined` when no
 * segments are provided so callers can opt out of caching by omitting
 * the path.
 */
export const tilePropertiesCacheKey = (
  parentSegments: readonly string[] | undefined,
  cellName: string
): string | undefined => {
  if (!cellName) return undefined
  if (!parentSegments) return cellName
  return parentSegments.length === 0 ? `/${cellName}` : `${parentSegments.join('/')}/${cellName}`
}

/** Drop a single cache entry — call when a cell is removed or renamed. */
export const invalidateTileProperties = (cacheKey: string | undefined): void => {
  if (cacheKey) tilePropertiesCache.delete(cacheKey)
}

/** Drop the entire cache — escape hatch for tests and full reloads. */
export const clearTilePropertiesCache = (): void => {
  tilePropertiesCache.clear()
}

/**
 * Read and parse the 0000 properties JSON from a cell directory.
 * Returns an empty object if the file doesn't exist or can't be parsed.
 *
 * When `cacheKey` is provided, the cache is consulted first and populated
 * on miss. Subsequent reads observe writes from the same render pass
 * without waiting on OPFS to settle.
 */
export const readCellProperties = async (
  cellDir: FileSystemDirectoryHandle,
  cacheKey?: string
): Promise<TileProperties> => {
  if (cacheKey) {
    const cached = tilePropertiesCache.get(cacheKey)
    if (cached) return cached
  }
  let parsed: TileProperties = {}
  try {
    const fileHandle = await cellDir.getFileHandle(TILE_PROPERTIES_FILE)
    const file = await fileHandle.getFile()
    const text = await file.text()
    const value = JSON.parse(text)
    if (value && typeof value === 'object') parsed = value as TileProperties
  } catch {
    // missing or unparseable — return empty object
  }
  if (cacheKey) tilePropertiesCache.set(cacheKey, parsed)
  return parsed
}

/**
 * Write properties JSON to a cell's 0000 file.
 * Merges with existing properties — pass only the fields to update.
 *
 * When `cacheKey` is provided, the cache is updated synchronously before
 * the OPFS write so concurrent and subsequent reads in the same render
 * pass see the new value immediately.
 */
export const writeCellProperties = async (
  cellDir: FileSystemDirectoryHandle,
  updates: TileProperties,
  cacheKey?: string
): Promise<void> => {
  const existing = await readCellProperties(cellDir, cacheKey)
  const merged: TileProperties = { ...existing, ...updates }
  if (cacheKey) tilePropertiesCache.set(cacheKey, merged)
  const fileHandle = await cellDir.getFileHandle(TILE_PROPERTIES_FILE, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(JSON.stringify(merged))
  await writable.close()
}

/**
 * Standard: any property value that is a signature (64 hex chars)
 * refers to a blob in __resources__/{signature}. This function
 * resolves all signature values in a properties object to Blobs.
 */
export const resolveResourceSignatures = async (
  properties: Record<string, unknown>,
  getResource: (sig: string) => Promise<Blob | null>
): Promise<Map<string, Blob>> => {
  const resolved = new Map<string, Blob>()

  const walk = async (obj: unknown): Promise<void> => {
    if (!obj || typeof obj !== 'object') return

    for (const value of Object.values(obj as Record<string, unknown>)) {
      if (isSignature(value)) {
        const sig = value as string
        if (!resolved.has(sig)) {
          const blob = await getResource(sig)
          if (blob) resolved.set(sig, blob)
        }
      } else if (typeof value === 'object' && value !== null) {
        await walk(value)
      }
    }
  }

  await walk(properties)
  return resolved
}
