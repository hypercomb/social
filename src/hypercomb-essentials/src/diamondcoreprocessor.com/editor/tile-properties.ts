// hypercomb-essentials/src/diamondcoreprocessor.com/editor/tile-properties.ts

export const TILE_PROPERTIES_FILE = '0000'

export const isSignature = (value: unknown): boolean =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)

/**
 * Read and parse the 0000 properties JSON from a seed directory.
 * Returns empty object if file doesn't exist or can't be parsed.
 */
export const readSeedProperties = async (
  seedDir: FileSystemDirectoryHandle
): Promise<Record<string, unknown>> => {
  try {
    const fileHandle = await seedDir.getFileHandle(TILE_PROPERTIES_FILE)
    const file = await fileHandle.getFile()
    const text = await file.text()
    return JSON.parse(text)
  } catch {
    return {}
  }
}

/**
 * Write properties JSON to a seed's 0000 file.
 * Merges with existing properties — pass only the fields to update.
 */
export const writeSeedProperties = async (
  seedDir: FileSystemDirectoryHandle,
  updates: Record<string, unknown>
): Promise<void> => {
  const existing = await readSeedProperties(seedDir)
  const merged = { ...existing, ...updates }
  const fileHandle = await seedDir.getFileHandle(TILE_PROPERTIES_FILE, { create: true })
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
