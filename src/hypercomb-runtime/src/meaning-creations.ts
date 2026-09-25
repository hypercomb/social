// Interim local writer on the shipped marker path. The mandated molecule
// protocol replaces numbered markers with per-author signed head claims and
// succession atoms; this module must not be treated as that public protocol.
//
// A creation is discovered through a pool of meaning. The pool holds one
// content-addressed membership record per stable identity; the highest marker
// in that identity's hashed location bag names its current meta envelope.
// Earlier markers and all signatured bytes remain available for inspection.
import {
  SignatureService, canonicalLayerJson, isMetaEnvelope, latestLayerMarker,
  metaPayloadOf, registerPoolMeaning, writeLayerMarker,
  type CanonicalLayerContent,
} from '@hypercomb/core'
import { locationAddress } from './location-layer'

const SIG = /^[a-f0-9]{64}$/
const text = new TextEncoder()

export type CreationStore = {
  getPool(meaning: string): Promise<FileSystemDirectoryHandle | null>
  openPool(meaning: string): Promise<FileSystemDirectoryHandle | null>
  writeLayerBytes(sig: string, bytes: ArrayBuffer): Promise<void>
  getLayerPoolBytes(sig: string): Promise<Uint8Array | null>
  putArtifactMeta(kind: 'layer', sig: string, incidence: Record<string, unknown>): Promise<string>
  getResourceLocal(sig: string): Promise<Blob | null>
}

export type CreationHead<T extends CanonicalLayerContent> = {
  key: string
  location: string
  head: string
  marker: string
  layer: T
}

type Member = { kind: 'pool:location'; key: string; location: string }
const bytesOf = (value: unknown): Uint8Array => text.encode(JSON.stringify(value))
const exact = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
const digest = (bytes: Uint8Array): Promise<string> => SignatureService.sign(exact(bytes))
const address = (meaning: string, key: string): Promise<string> =>
  locationAddress(`${meaning}:${key}`)

const heldLayer = async <T extends CanonicalLayerContent>(
  store: CreationStore, meaning: string, head: string,
): Promise<T | null> => {
  if (!SIG.test(head)) return null
  const metaBlob = await store.getResourceLocal(head)
  if (!metaBlob || await SignatureService.sign(await metaBlob.arrayBuffer()) !== head) return null
  let meta: unknown
  try { meta = JSON.parse(await metaBlob.text()) } catch { return null }
  const payload = metaPayloadOf(meta)
  if (!isMetaEnvelope(meta) || payload?.kind !== 'layer' || meta.relation !== meaning) return null
  const layerBytes = await store.getLayerPoolBytes(payload.sig)
  if (!layerBytes || await digest(layerBytes) !== payload.sig) return null
  let layer: T
  try { layer = JSON.parse(new TextDecoder().decode(layerBytes)) as T } catch { return null }
  return layer && typeof layer.name === 'string' ? layer : null
}

const writeMember = async (pool: FileSystemDirectoryHandle, member: Member): Promise<void> => {
  const bytes = bytesOf(member)
  const handle = await pool.getFileHandle(await digest(bytes), { create: true })
  const writable = await handle.createWritable()
  try { await writable.write(exact(bytes)) } finally { await writable.close() }
}

const readHead = async <T extends CanonicalLayerContent>(
  store: CreationStore, pool: FileSystemDirectoryHandle, meaning: string, member: Member,
): Promise<CreationHead<T> | null> => {
  if (member.kind !== 'pool:location' || !member.key || !SIG.test(member.location)
    || await address(meaning, member.key) !== member.location) return null
  let bag: FileSystemDirectoryHandle
  try { bag = await pool.getDirectoryHandle(member.location, { create: false }) }
  catch { return null }
  const marker = await latestLayerMarker(bag)
  if (!marker) return null
  const layer = await heldLayer<T>(store, meaning, marker.layer)
  if (!layer) return null
  return { key: member.key, location: member.location, head: marker.layer,
    marker: marker.name, layer }
}

/** Read exactly one current revision from a known hashed location. */
export const readCreation = async <T extends CanonicalLayerContent>(
  store: CreationStore, meaning: string, key: string,
): Promise<CreationHead<T> | null> => {
  await registerPoolMeaning(meaning)
  const pool = await store.openPool(meaning)
  if (!pool) return null
  const location = await address(meaning, key)
  return readHead<T>(store, pool, meaning, { kind: 'pool:location', key, location })
}

/** The pool is a discoverable set; it contains locations, never mutable heads. */
export const listCreations = async <T extends CanonicalLayerContent>(
  store: CreationStore, meaning: string,
): Promise<CreationHead<T>[]> => {
  await registerPoolMeaning(meaning)
  const pool = await store.openPool(meaning)
  if (!pool) return []
  const members: Member[] = []
  try {
    for await (const [name, handle] of pool.entries()) {
      if (handle.kind !== 'file' || !SIG.test(name)) continue
      try {
        const bytes = new Uint8Array(await (await (handle as FileSystemFileHandle).getFile()).arrayBuffer())
        if (await digest(bytes) !== name) continue
        const member = JSON.parse(new TextDecoder().decode(bytes)) as Member
        if (member.kind === 'pool:location' && member.key && SIG.test(member.location)) members.push(member)
      } catch { /* One bad member cannot hide the others. */ }
    }
  } catch { return [] }
  const heads: CreationHead<T>[] = []
  for (let at = 0; at < members.length; at += 8) {
    const batch = await Promise.all(members.slice(at, at + 8).map(member =>
      readHead<T>(store, pool, meaning, member).catch(() => null)))
    heads.push(...batch.filter((head): head is CreationHead<T> => !!head))
  }
  return heads
}

/** Advance a stable location with a canonical layer and typed meta envelope. */
export const writeCreation = async <T extends CanonicalLayerContent>(
  store: CreationStore, meaning: string, key: string, layer: T,
): Promise<CreationHead<T> | null> => {
  if (!meaning.includes(':') || !key || !layer.name) return null
  await registerPoolMeaning(meaning)
  const pool = await store.getPool(meaning)
  if (!pool) return null
  const location = await address(meaning, key)
  const member: Member = { kind: 'pool:location', key, location }
  const bag = await pool.getDirectoryHandle(location, { create: true })
  const before = await readHead<T>(store, pool, meaning, member).catch(() => null)
  const layerBytes = text.encode(canonicalLayerJson(layer))
  if (before && canonicalLayerJson(before.layer) === new TextDecoder().decode(layerBytes)) return before
  const layerSig = await digest(layerBytes)
  await store.writeLayerBytes(layerSig, exact(layerBytes))
  if (await digest(await store.getLayerPoolBytes(layerSig) ?? new Uint8Array()) !== layerSig) return null
  const head = await store.putArtifactMeta('layer', layerSig, {
    relation: meaning, at: Date.now(),
  })
  if (!SIG.test(head)) return null
  const meta = await store.getResourceLocal(head)
  if (!meta || await SignatureService.sign(await meta.arrayBuffer()) !== head) return null
  await writeLayerMarker(bag, head)
  await writeMember(pool, member)
  return readHead<T>(store, pool, meaning, member)
}

/** Select an exact, already held meta revision. An imported creation keeps
 * its publisher's content identity; selecting it never mints a substitute. */
export const installCreationHead = async <T extends CanonicalLayerContent>(
  store: CreationStore, meaning: string, key: string, head: string,
): Promise<CreationHead<T> | null> => {
  if (!meaning.includes(':') || !key || !await heldLayer<T>(store, meaning, head)) return null
  await registerPoolMeaning(meaning)
  const pool = await store.getPool(meaning)
  if (!pool) return null
  const location = await address(meaning, key)
  const member: Member = { kind: 'pool:location', key, location }
  const before = await readHead<T>(store, pool, meaning, member).catch(() => null)
  if (before?.head === head) return before
  const bag = await pool.getDirectoryHandle(location, { create: true })
  await writeLayerMarker(bag, head)
  await writeMember(pool, member)
  return readHead<T>(store, pool, meaning, member)
}

/** Off is a new signed layer at the same location. The selected meta and its
 * bytes remain held, while ordinary pool discovery sees no active creation. */
export const disableCreation = async (
  store: CreationStore, meaning: string, key: string, expectedHead: string,
): Promise<boolean> => {
  const current = await readCreation(store, meaning, key)
  if (!current || current.head !== expectedHead) return false
  const bytes = text.encode(canonicalLayerJson({ name: 'creation:activation', enabled: false, head: expectedHead }))
  const sig = await digest(bytes)
  await store.writeLayerBytes(sig, exact(bytes))
  if (await digest(await store.getLayerPoolBytes(sig) ?? new Uint8Array()) !== sig) return false
  const pool = await store.openPool(meaning)
  if (!pool) return false
  const bag = await pool.getDirectoryHandle(current.location, { create: false })
  await writeLayerMarker(bag, sig)
  return (await readCreation(store, meaning, key)) === null
}
