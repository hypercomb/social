// editor/picture-history.ts — every picture a NAME has worn
// (documentation/alias-properties.md, step 5).
//
// A name's pictures live in three places, all kept forever:
//   - this alias's own revisions (its location's history);
//   - the name's REPO revisions (the root tile `/<name>`);
//   - `canonical:variants/<sign(name)>` — the target layer kept each time a
//     reference to the name was placed.
// Nothing here writes. The list is newest first (this alias, then the repo,
// then the kept variants), one entry per picture.

import { SignatureService } from '@hypercomb/core'

export type PictureHistoryEntry = {
  /** The small picture — what a thumbnail shows. */
  readonly thumb: string
  /** The picture to load: the full-size original when one was kept. */
  readonly original: string
  readonly from: 'here' | 'repo' | 'variant'
}

type LayerLike = { properties?: readonly unknown[] } | null
type HistoryLike = {
  sign(lineage: { explorerSegments: () => readonly string[] }): Promise<string>
  listLayers?(locationSig: string): Promise<Array<{ layerSig: string }>>
  getLayerBySig(sig: string): Promise<LayerLike>
}
type StoreLike = {
  getResource(sig: string): Promise<Blob | null>
  openPool?(meaning: string): Promise<FileSystemDirectoryHandle | null>
}

/** Colon-scoped, as the reference door writes it. */
const CANONICAL_VARIANTS_MEANING = 'canonical:variants'
const SIG = /^[0-9a-f]{64}$/
/** Enough to choose from; the full record stays in history. */
const MAX_ENTRIES = 24

const imageOf = (value: unknown): string => {
  const sig = (value as { image?: unknown } | undefined)?.image
  return typeof sig === 'string' && SIG.test(sig) ? sig : ''
}

/** A layer's picture: the small one for the thumbnail, the original to load.
 *  Null when the layer wears no picture. */
const pictureOfLayer = async (
  layer: LayerLike,
  store: StoreLike,
): Promise<{ thumb: string; original: string } | null> => {
  const propsSig = layer?.properties?.[0]
  if (typeof propsSig !== 'string' || !SIG.test(propsSig)) return null
  const blob = await store.getResource(propsSig).catch(() => null)
  if (!blob) return null
  let props: Record<string, unknown>
  try { props = JSON.parse(await blob.text()) as Record<string, unknown> } catch { return null }
  const thumb = imageOf(props['small']) || imageOf((props['flat'] as { small?: unknown } | undefined)?.small)
  const original = imageOf(props['large']) || thumb
  return thumb ? { thumb, original } : null
}

const layersAt = async (history: HistoryLike, segments: readonly string[]): Promise<string[]> => {
  if (!history.listLayers) return []
  const sig = await history.sign({ explorerSegments: () => segments })
  const list = await history.listLayers(sig).catch(() => [])
  return list.map(entry => entry.layerSig).reverse()
}

const variantLayers = async (store: StoreLike, name: string): Promise<string[]> => {
  const pool = await store.openPool?.(CANONICAL_VARIANTS_MEANING).catch(() => null)
  if (!pool) return []
  const nameKey = await SignatureService.sign(new TextEncoder().encode(name).buffer as ArrayBuffer)
  const bucket = await pool.getDirectoryHandle(nameKey, { create: false }).catch(() => null)
  if (!bucket) return []
  const out: string[] = []
  for await (const handle of (bucket as unknown as { values(): AsyncIterable<FileSystemHandle> }).values()) {
    if (handle.kind !== 'file') continue
    try {
      const record = JSON.parse(await (await (handle as FileSystemFileHandle).getFile()).text()) as { payload?: { layerSig?: unknown } }
      const sig = record.payload?.layerSig
      if (typeof sig === 'string' && SIG.test(sig)) out.push(sig)
    } catch { /* not a variant record */ }
  }
  return out
}

/** Every picture `name` has worn, seen from the alias at `parentSegments`
 *  (empty for a top-level tile, which IS its repo). */
export const pictureHistory = async (
  history: HistoryLike,
  store: StoreLike,
  parentSegments: readonly string[],
  name: string,
): Promise<PictureHistoryEntry[]> => {
  const sources: Array<{ from: PictureHistoryEntry['from']; layers: string[] }> = [
    ...(parentSegments.length > 0 ? [{ from: 'here' as const, layers: await layersAt(history, [...parentSegments, name]) }] : []),
    { from: 'repo', layers: await layersAt(history, [name]) },
    { from: 'variant', layers: await variantLayers(store, name) },
  ]
  const seen = new Set<string>()
  const entries: PictureHistoryEntry[] = []
  for (const { from, layers } of sources) {
    for (const layerSig of layers) {
      if (entries.length >= MAX_ENTRIES) return entries
      const picture = await pictureOfLayer(await history.getLayerBySig(layerSig).catch(() => null), store)
      if (!picture || seen.has(picture.original)) continue
      seen.add(picture.original)
      entries.push({ ...picture, from })
    }
  }
  return entries
}
