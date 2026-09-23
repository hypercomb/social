// commands/lightbox-kind.ts
//
// THE LIGHTBOX'S NAMES AND ITS PICTURES — the gallery kind, the picture
// relation, the view, and every picture a tile holds. The /lightbox word and
// the view that renders it both read these, and a bee is never imported for
// a value (atomic-modules-plan.md), so they live here, in a dependency both
// import.

import { listDecorations } from './decoration-manifest.js'
import { terminalContentSig } from '../presentation/tiles/artifact-content.js'

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
