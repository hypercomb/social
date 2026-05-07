// diamondcoreprocessor.com/editor/tile-properties.ts
import { EffectBus } from '@hypercomb/core'

export const TILE_PROPERTIES_FILE = '0000'

export const isSignature = (value: unknown): boolean =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)

/**
 * Read and parse the 0000 properties JSON from a cell directory.
 * Returns empty object if file doesn't exist or can't be parsed.
 */
export const readCellProperties = async (
  cellDir: FileSystemDirectoryHandle
): Promise<Record<string, unknown>> => {
  try {
    const fileHandle = await cellDir.getFileHandle(TILE_PROPERTIES_FILE)
    const file = await fileHandle.getFile()
    const text = await file.text()
    return JSON.parse(text)
  } catch {
    return {}
  }
}

/**
 * Write properties JSON to a cell's 0000 file.
 * Merges with existing properties — pass only the fields to update.
 *
 * Broadcasts `cell:0000-changed` with the cell's cache key and the
 * names of the keys it touched. NurseBee subclasses (IndexNurse, etc.)
 * subscribe and invalidate their caches when their attribute is in
 * the changed set. This is the canonical write path — there are no
 * other writers — so the nurse cache stays coherent without anyone
 * else having to remember to invalidate.
 *
 * `cacheKey` defaults to `cellDir.name` (the immediate folder name).
 * Callers that key by a fully-qualified lineage path can pass it
 * explicitly so cross-folder cells with the same leaf name don't
 * collide.
 */
export const writeCellProperties = async (
  cellDir: FileSystemDirectoryHandle,
  updates: Record<string, unknown>,
  cacheKey?: string,
): Promise<void> => {
  const existing = await readCellProperties(cellDir)
  const merged = { ...existing, ...updates }
  const fileHandle = await cellDir.getFileHandle(TILE_PROPERTIES_FILE, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(JSON.stringify(merged))
  await writable.close()
  EffectBus.emit('cell:0000-changed', {
    cacheKey: cacheKey ?? cellDir.name,
    keys: Object.keys(updates),
  })
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
