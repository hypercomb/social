// diamondcoreprocessor.com/editor/tile-properties.ts
import { EffectBus, SignatureService, type Signature } from '@hypercomb/core'

export const TILE_PROPERTIES_FILE = '0000'

export const isSignature = (value: unknown): boolean =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)

type SignatureStoreLike = {
  signText: (text: string) => Promise<Signature>
}

/**
 * Lineage-signature cache key for a single cell.
 *
 * Every NurseBee read AND every writeCellProperties call must address
 * a cell by this key — never by the bare folder name. The leaf name
 * is not unique across the tree (e.g. a "Notes" tile can exist in
 * every folder), so a name-keyed cache returns the wrong value the
 * moment two cells with the same leaf name are touched in one
 * session, and writeCellProperties' invalidation broadcast misses
 * the actual collider. The lineage signature is unique per location
 * and stable as long as the cell stays put — exactly the address the
 * inflate primitive uses to compose layer state into a single
 * consumable JSON view. Same key here means the in-memory cache, the
 * disk-side broadcast, and the inflate tree all agree on identity.
 *
 * Memoised inside SignatureStore.signText, so repeat calls per render
 * are a Map lookup.
 */
export const cellLocationSig = async (
  parentSegments: readonly string[],
  cellName: string,
): Promise<string> => {
  const path = [...parentSegments, cellName].join('/')
  const sigStore = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc?.get<SignatureStoreLike>('@hypercomb/SignatureStore')
  if (sigStore?.signText) return sigStore.signText(path)
  return SignatureService.sign(new TextEncoder().encode(path).buffer as ArrayBuffer)
}

/**
 * Read and parse the 0000 properties JSON from a cell directory.
 * Returns empty object if file doesn't exist or can't be parsed.
 *
 * Missing file is silent (legitimate state for a freshly-created cell).
 * Corrupt or unreadable file logs a warning so the failure surfaces
 * instead of being indistinguishable from "no properties yet."
 */
export const readCellProperties = async (
  cellDir: FileSystemDirectoryHandle
): Promise<Record<string, unknown>> => {
  let fileHandle: FileSystemFileHandle
  try {
    fileHandle = await cellDir.getFileHandle(TILE_PROPERTIES_FILE)
  } catch {
    // file doesn't exist yet — legitimate state
    return {}
  }
  try {
    const file = await fileHandle.getFile()
    const text = await file.text()
    return JSON.parse(text)
  } catch (err) {
    console.warn('[tile-properties] failed to read/parse 0000 in', cellDir.name, err)
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
 * `cacheKey` MUST be the cell's lineage signature (see
 * `cellLocationSig`) — the same key the nurses are read with. The
 * legacy default (cellDir.name) collides across folders that share a
 * leaf name; any writer relying on the default is opting in to a
 * silent corruption of cross-folder cache state. Defaulted only so
 * the function stays callable from contexts that don't touch any
 * nurse-tended key.
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
