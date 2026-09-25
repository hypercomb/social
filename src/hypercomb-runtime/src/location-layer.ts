// A cold shell and a full hive write the same canonical layer bytes and the
// same immutable marker record. A hashed location bag's highest marker is its
// current head; earlier markers remain available for inspection.
import { SignatureService, canonicalLayerJson, latestLayerMarker, writeLayerMarker,
  type CanonicalLayerContent } from '@hypercomb/core'

export type LocationLayerStore = {
  opfsRoot: FileSystemDirectoryHandle
  writeLayerBytes(sig: string, bytes: ArrayBuffer): Promise<void>
  getLayerPoolBytes(sig: string): Promise<Uint8Array | null>
}

const bytesOf = (layer: CanonicalLayerContent): Uint8Array => new TextEncoder().encode(canonicalLayerJson(layer))
const digest = (bytes: Uint8Array): Promise<string> => SignatureService.sign(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)

export const locationAddress = (meaning: string): Promise<string> =>
  SignatureService.sign(new TextEncoder().encode(meaning).buffer as ArrayBuffer)

export const currentLocationLayer = async <T extends CanonicalLayerContent>(
  store: LocationLayerStore, location: string,
): Promise<{ layer: T; sig: string; marker: string } | null> => {
  let bag: FileSystemDirectoryHandle
  try { bag = await store.opfsRoot.getDirectoryHandle(location, { create: false }) }
  catch { return null }
  const latest = await latestLayerMarker(bag)
  if (!latest) return null
  const bytes = await store.getLayerPoolBytes(latest.layer)
  if (!bytes || await digest(bytes) !== latest.layer) throw new Error('Location layer bytes did not verify')
  const layer = JSON.parse(new TextDecoder().decode(bytes)) as T
  if (typeof layer?.name !== 'string') throw new Error('Location head is not a layer')
  return { layer, sig: latest.layer, marker: latest.name }
}

export const commitLocationLayer = async (
  store: LocationLayerStore, location: string, layer: CanonicalLayerContent,
): Promise<string> => {
  const bytes = bytesOf(layer)
  const sig = await digest(bytes)
  const bag = await store.opfsRoot.getDirectoryHandle(location, { create: true })
  let current = await latestLayerMarker(bag)
  if (!current) {
    const empty = bytesOf({ name: layer.name })
    const emptySig = await digest(empty)
    await store.writeLayerBytes(emptySig, empty.buffer as ArrayBuffer)
    await writeLayerMarker(bag, emptySig, '00000000')
    current = { name: '00000000', layer: emptySig }
  }
  if (current.layer === sig) return sig
  // The immutable layer must exist before the marker can expose its name.
  await store.writeLayerBytes(sig, bytes.buffer as ArrayBuffer)
  await writeLayerMarker(bag, sig)
  return sig
}
