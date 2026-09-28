// packed-visuals.ts — VISUALS CARRIED INSIDE A LAYER'S MANIFEST. A leaf of the
// tile renderer (documentation/tile-renderer-tree.md): layer membership fills
// it as it reads a pack, the image decode reads it before touching a file.
//
// Keyed by source image sig. The pack for one layer serves any pass that
// paints those tiles, and content-addressed keys make that safe forever — a
// sig is its bytes. Bounded: the entries are ~6KB renditions and the map is
// trimmed oldest-first past the cap.

const PACK_VISUAL_CAP = 2048
const packVisuals = new Map<string, Blob>()

export type PackedVisualEntry = { visual?: { sig?: string; webp?: string; type?: string } } | null

/** Take a manifest entry's inlined visual into the pack. No-op for entries
 *  that carry only a sig (source too big to inline, or not local when the
 *  pack was minted) — those decode from the file as they always did. */
export const adoptPackedVisual = (entry: PackedVisualEntry): void => {
  const v = entry?.visual
  if (!v?.sig || !v.webp || packVisuals.has(v.sig)) return
  try {
    const binary = atob(v.webp)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    if (packVisuals.size >= PACK_VISUAL_CAP) {
      const oldest = packVisuals.keys().next().value
      if (oldest !== undefined) packVisuals.delete(oldest)
    }
    packVisuals.set(v.sig, new Blob([bytes], { type: v.type || 'image/webp' }))
  } catch { /* malformed inline — the file path still works */ }
}

/** The packed rendition of a source image, when a manifest carried one. */
export const packedVisual = (sig: string): Blob | undefined => packVisuals.get(sig)
