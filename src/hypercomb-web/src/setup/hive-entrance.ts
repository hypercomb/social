// setup/hive-entrance.ts
//
// THE HIVE AN ENTRANCE CHOSE (documentation/hives.md). A visit opened as
// `…/?hive=<signature>` runs on that hive: only the bees it names load now, the
// rest wait passive. The hive document is a content-addressed resource, so the
// bytes are hashed against the signature before anything reads them — a wrong
// or tampered document is no hive, and the package loads as it always has.
//
// Started before the boot graph; the runtime waits on the hand-off, bounded
// (hypercomb-runtime hive.ts selectedHive). Nothing is stored or changed: the
// next visit without `?hive=` is the full package again.

const SIG_RE = /^[a-f0-9]{64}$/

const hex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')

/** The hive signature this visit names, or null. */
export const hiveSignatureOf = (search: string): string | null => {
  const raw = new URLSearchParams(search).get('hive')?.trim().toLowerCase() ?? ''
  return SIG_RE.test(raw) ? raw : null
}

/** The hive document this visit names — fetched, hashed against its name, parsed
 *  — or null. Never throws: a hive that cannot be read is no hive. */
export const readHiveEntrance = async (
  search: string = location.search,
  fetcher: (url: string) => Promise<Response> = url => fetch(url),
): Promise<unknown | null> => {
  const sig = hiveSignatureOf(search)
  if (!sig) return null
  try {
    const response = await fetcher(`/content/${sig}`)
    if (!response.ok) return null
    const bytes = await response.arrayBuffer()
    if (hex(await crypto.subtle.digest('SHA-256', bytes)) !== sig) return null
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
}

/** Hand the hive to the runtime, which reads it before deciding what loads.
 *  Only a visit that names one sets the handle. */
export const handOffHive = (search: string = location.search): void => {
  if (!hiveSignatureOf(search)) return
  ;(globalThis as { __hcHive?: Promise<unknown | null> }).__hcHive = readHiveEntrance(search)
}
