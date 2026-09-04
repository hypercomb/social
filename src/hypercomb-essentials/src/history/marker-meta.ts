// history/marker-meta.ts
//
// A MARKER IS IMMUTABLE. WHAT YOU SAY ABOUT IT IS A RECORD OF ITS OWN.
//
// A ★ mark, a restore-point label, a prune receipt — each is a fact about a
// revision. They used to be written by REWRITING THE MARKER FILE IN PLACE
// (`{layer, label, marked, prune}`), which broke the primitive three ways
// (write-conformance, history.service.ts:4338 / :4653): a marker under a
// non-content name gained content-shaped fields; the same bytes could
// disagree between two replicas that each rewrote them; and any reader that
// cached marker bytes by filename went stale on every edit.
//
// Now the marker is never touched. The annotation is ONE current document
// per LAYER SIG in the `history:marker-meta` document pool — the sig-keyed
// sub-bucket shape `putPoolDoc` already gives translations and the insight
// catalog. Keying by the layer sig is deliberate: a mark is about the
// REVISION (the content), and the same revision reached by undo/redo or on
// another replica is the same mark.
//
// READS WALK BACK, WRITES NEVER DO. Markers annotated before this pool
// existed still carry their fields; the readers union them (record wins).
// No marker is rewritten to "migrate" — data never heals.

import { declarePoolKind, registerPoolMeaning } from '@hypercomb/core'

/** The document pool: one current record per marker layer sig. */
export const MARKER_META_MEANING = 'history:marker-meta'
declarePoolKind(MARKER_META_MEANING, 'document')
void registerPoolMeaning(MARKER_META_MEANING)

const SIG_RE = /^[0-9a-f]{64}$/

export interface MarkerMetaRecord {
  /** The marker's layer sig — the revision this record is about. The key. */
  layer: string
  /** Where the marker was when the annotation was made: its bag and name.
   *  Addresses, so a surface can jump there; never bytes to carry. */
  location: string
  marker: string
  label?: string
  marked?: boolean
  path?: string[]
  /** When the record was last written. */
  at: number
  /** Named supporting-data sigs — a prune receipt, a decoration, a context. */
  [field: string]: unknown
}

/** The fields no patch may set: the key and the address are the caller's
 *  arguments, `at` is minted here. */
const RESERVED = new Set(['layer', 'location', 'marker', 'at'])

export interface MarkerMetaStore {
  getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | undefined>
  getPoolDoc?: (pool: FileSystemDirectoryHandle | undefined, subKey?: string) => Promise<ArrayBuffer | null>
  putPoolDoc?: (pool: FileSystemDirectoryHandle, bytes: ArrayBuffer, subKey?: string) => Promise<string | null>
}

const parse = (bytes: ArrayBuffer | null): MarkerMetaRecord | null => {
  if (!bytes || bytes.byteLength === 0) return null
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes))
    return value && typeof value === 'object' && SIG_RE.test(String(value.layer ?? '')) ? value as MarkerMetaRecord : null
  } catch { return null }
}

/** The current record for a layer sig, or null. Never throws. */
export const readMarkerMetaRecord = async (
  store: MarkerMetaStore | undefined,
  layerSig: string,
): Promise<MarkerMetaRecord | null> => {
  const layer = String(layerSig ?? '').toLowerCase()
  if (!SIG_RE.test(layer) || !store?.getPool || !store.getPoolDoc) return null
  try {
    const pool = await store.getPool(MARKER_META_MEANING)
    return parse(await store.getPoolDoc(pool, layer))
  } catch { return null }
}

/**
 * Merge `patch` over the current record for this layer sig and write the
 * result as the new current document. A patch value of `undefined` is "not
 * mentioned"; `null`, `''`, `false` and `[]` DROP the field. Reserved fields
 * in the patch are ignored. Returns the record written, or null when the
 * store cannot take a document — never a false success.
 */
export const writeMarkerMetaRecord = async (
  store: MarkerMetaStore | undefined,
  where: { layer: string; location: string; marker: string },
  patch: Record<string, unknown>,
): Promise<MarkerMetaRecord | null> => {
  const layer = String(where.layer ?? '').toLowerCase()
  if (!SIG_RE.test(layer) || !store?.getPool || !store.putPoolDoc) return null
  const existing = await readMarkerMetaRecord(store, layer)
  const next: MarkerMetaRecord = {
    ...(existing ?? {}),
    layer,
    location: String(where.location ?? ''),
    marker: String(where.marker ?? ''),
    at: Date.now(),
  }
  for (const [key, value] of Object.entries(patch)) {
    if (RESERVED.has(key) || value === undefined) continue
    const drop = value === null || value === false || value === ''
      || (Array.isArray(value) && value.length === 0)
    if (drop) delete next[key]
    else if (Array.isArray(value)) next[key] = value.map(v => String(v ?? '').trim()).filter(Boolean)
    else if (typeof value === 'string') next[key] = value.trim()
    else next[key] = value
  }
  try {
    const pool = await store.getPool(MARKER_META_MEANING)
    if (!pool) return null
    const bytes = new TextEncoder().encode(JSON.stringify(next)).buffer as ArrayBuffer
    const sig = await store.putPoolDoc(pool, bytes, layer)
    return sig ? next : null
  } catch { return null }
}

/** Every current record in the pool — one per sub-bucket. Never throws. */
export const listMarkerMetaRecords = async (store: MarkerMetaStore | undefined): Promise<MarkerMetaRecord[]> => {
  if (!store?.getPool) return []
  let pool: FileSystemDirectoryHandle | undefined
  try { pool = await store.getPool(MARKER_META_MEANING) } catch { return [] }
  if (!pool) return []
  const out: MarkerMetaRecord[] = []
  try {
    for await (const [, bucket] of (pool as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      if (bucket.kind !== 'directory') continue
      try {
        for await (const [name, handle] of (bucket as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
          if (handle.kind !== 'file' || !SIG_RE.test(name)) continue
          const record = parse(await (await (handle as FileSystemFileHandle).getFile()).arrayBuffer())
          if (record) { out.push(record); break }
        }
      } catch { /* one unreadable bucket hides only itself */ }
    }
  } catch { /* pool unreadable — nothing listed, nothing invented */ }
  return out
}
