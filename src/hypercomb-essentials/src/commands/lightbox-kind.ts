// commands/lightbox-kind.ts
//
// THE LIGHTBOX'S NAMES AND ITS PICTURES — the gallery kind, the picture
// relation, the view, and every picture a tile holds. The /lightbox word and
// the view that renders it both read these, and a bee is never imported for
// a value (atomic-modules-plan.md), so they live here, in a dependency both
// import.

import { listDecorations, writeDecoration, removeDecoration } from './decoration-manifest.js'
import { mintContentRef, terminalContentSig } from '../presentation/tiles/artifact-content.js'

const SIG = /^[0-9a-f]{64}$/

const get = <T,>(key: string): T | undefined => (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

/** Pictures held on a tile — the lightbox's own content, and a source for any
 *  view that renders a set this tile is enrolled in. Payload:
 *  `{ images: [ref, …] }`, where each ref is a Life Primitive content hop. */
export const GALLERY_KIND = 'visual:lightbox:gallery'

/** The slot a picture's incidence is held in. Distinct from a slide's, so the
 *  same bytes used both ways mint two envelopes rather than colliding. */
export const PICTURE_RELATION = 'picture'

/** The ViewMode surface this behaviour renders on. Matches the kind's own
 *  `visual:<view>:<noun>` middle segment — the vocabulary the command line's
 *  `name@lightbox` and the Beehaviors panel both read. */
export const LIGHTBOX_VIEW = 'lightbox'

/**
 * Every picture held on a tile, RESOLVED to the signature of its bytes.
 *
 * The payload declares a Life Primitive hop — a meta envelope under the current
 * model, a raw resource signature under the retired one — and this seam follows
 * it, so every caller gets the same thing it always got. That matters because
 * `Store.getResource` does NOT follow the hop: a consumer handed an envelope
 * signature would fetch the envelope's JSON and try to paint it as a picture.
 * Resolving once, here, is what keeps the full-screen lightbox and the images
 * chooser both correct without either learning about incidences.
 *
 * An envelope whose target is not held locally resolves to itself, which is the
 * honest answer — the caller's own fetch cascade is what can still reach it, and
 * `fetchThroughContentHop` is how it should.
 */
export async function galleryImageSigsAt(segments: readonly string[]): Promise<string[]> {
  const out: string[] = []
  const store = get<{ getResourceLocal?(sig: string): Promise<Blob | null> }>('@hypercomb.social/Store')
  try {
    const decorations = await listDecorations<{ images?: unknown }>({
      kind: GALLERY_KIND,
      segments,
    })
    for (const { record } of decorations) {
      const images = record.payload?.images
      if (!Array.isArray(images)) continue
      for (const value of images) {
        const ref = String(value)
        if (!SIG.test(ref)) continue
        const imageSig = store?.getResourceLocal
          ? (await terminalContentSig(store as { getResourceLocal(s: string): Promise<Blob | null> }, ref)) ?? ref
          : ref
        if (!out.includes(imageSig)) out.push(imageSig)
      }
    }
  } catch { /* no readable gallery at this location */ }
  return out
}

/**
 * Hold pictures on a tile — the ONE way a picture joins a tile's collection.
 *
 * Each byte signature is minted into a typed incidence (the Life Primitive hop,
 * never raw bytes in a payload field) and merged into the tile's single gallery
 * decoration, which is REPLACED by the merged record. Pictures already held are
 * kept, so adding a picture never loses the ones before it. Returns the refs now
 * held. `/lightbox add`, the tile editor's save and the images wall's pool pick
 * all come through here, so a tile's pictures are retained however they arrived.
 */
export async function holdPictures(
  segments: readonly string[],
  bytesSigs: readonly string[],
): Promise<string[]> {
  const store = get<{ putResource(blob: Blob): Promise<string> }>('@hypercomb.social/Store')
  if (!store || segments.length === 0) return []
  const added: string[] = []
  for (const bytesSig of bytesSigs) {
    if (!SIG.test(bytesSig)) continue
    const ref = await mintContentRef(store, bytesSig, PICTURE_RELATION)
    if (SIG.test(ref) && !added.includes(ref)) added.push(ref)
  }
  if (added.length === 0) return []

  const existing = await listDecorations<{ images?: unknown }>({ kind: GALLERY_KIND, segments })
  const kept: string[] = []
  for (const { record } of existing) {
    const imgs = record.payload?.images
    if (!Array.isArray(imgs)) continue
    for (const value of imgs) {
      const ref = String(value)
      if (SIG.test(ref) && !kept.includes(ref)) kept.push(ref)
    }
  }
  const images = [...kept, ...added.filter(ref => !kept.includes(ref))]
  if (images.length === kept.length) return images        // already held — no new revision

  await writeDecoration({ kind: GALLERY_KIND, appliesTo: segments, segments, payload: { images }, mark: 'persistent' })
  for (const e of existing) removeDecoration({ sig: e.sig, segments })
  return images
}
