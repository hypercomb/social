// The marker byte protocol shared by full history and cold host locations.
import { markerName } from './directory-safety.js'

const SIG = /^[a-f0-9]{64}$/
const MARKER = /^\d{8}$/

export const layerMarkerBytes = (layer: string): Uint8Array => {
  if (!SIG.test(layer)) throw new Error('A location marker needs a signed layer')
  return new TextEncoder().encode(JSON.stringify({ layer }))
}

export const latestLayerMarker = async (bag: FileSystemDirectoryHandle):
  Promise<{ name: string; layer: string } | null> => {
  let latest = ''
  for await (const [name, handle] of bag.entries()) {
    if (handle.kind === 'file' && MARKER.test(name) && name > latest) latest = name
  }
  if (!latest) return null
  try {
    const bytes = await (await bag.getFileHandle(latest)).getFile()
    const record = JSON.parse(await bytes.text()) as { layer?: unknown }
    if (!SIG.test(String(record.layer))) throw new Error(`Invalid location marker ${latest}`)
    return { name: latest, layer: String(record.layer) }
  } catch { throw new Error(`Unreadable location marker ${latest}`) }
}

/** A caller may supply HistoryService's cached next name; cold writers scan.
 *  The layer bytes must already be stored before this pointer is appended. */
export const writeLayerMarker = async (
  bag: FileSystemDirectoryHandle, layer: string, next?: string,
): Promise<{ name: string; bytes: Uint8Array }> => {
  const current = next ? null : await latestLayerMarker(bag)
  const name = next ?? markerName(current ? Number(current.name) + 1 : 0)
  if (!name || !MARKER.test(name) || (current && name <= current.name)) {
    throw new Error('Location marker sequence is invalid or exhausted')
  }
  const bytes = layerMarkerBytes(layer)
  // A second writer may have claimed this name after our scan. Never replace
  // a marker: it is an immutable revision even when the next commit races.
  try {
    await bag.getFileHandle(name, { create: false })
    throw new Error(`Location marker ${name} already exists`)
  } catch (error) {
    if ((error as { name?: string })?.name !== 'NotFoundError') throw error
  }
  const handle = await bag.getFileHandle(name, { create: true })
  const writer = await handle.createWritable()
  try { await writer.write(bytes.buffer as ArrayBuffer) } finally { await writer.close() }
  return { name, bytes }
}
