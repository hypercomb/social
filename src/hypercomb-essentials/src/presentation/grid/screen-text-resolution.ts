// presentation/grid/screen-text-resolution.ts
//
// Pixi Text that lives in WORLD space — under the stage scale and the camera —
// must be rasterised at the density it is DISPLAYED at. Baked once at a fixed
// oversample it is minified when zoomed out and magnified when zoomed in,
// bilinear either way, and reads soft at every zoom but the one the constant
// happened to match. Every scene text takes the same answer from here: bake at
// (screen scale × renderer resolution), rounded UP to the next eighth so the
// raster never runs short, and re-bake the moment the camera moves the text
// off that grid. Pixi regenerates the texture on a resolution change and keeps
// the logical size, so layout around the text stays valid.
//
// Eighth steps bound the churn during a continuous zoom while keeping the
// oversample under 12.5%. The clamp keeps a far zoom-out from asking for a
// sub-pixel raster and a deep zoom-in from allocating a wall of texels.

import type { Container, Text } from 'pixi.js'

export const TEXT_RESOLUTION_STEP = 8
export const TEXT_RESOLUTION_MIN = 0.5
export const TEXT_RESOLUTION_MAX = 24

/** Screen pixels per local unit of `container` (1 when unattached). */
export function containerScreenScale(container: Container | null | undefined): number {
  const wt = container?.worldTransform
  return wt ? Math.hypot(wt.a, wt.b) || 1 : 1
}

/** Raster density that lands one text texel on one device pixel. */
export function screenTextResolution(screenScale: number, rendererResolution?: number): number {
  const dpr = rendererResolution
    ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)
  const raw = Math.ceil(screenScale * dpr * TEXT_RESOLUTION_STEP) / TEXT_RESOLUTION_STEP
  return Math.min(TEXT_RESOLUTION_MAX, Math.max(TEXT_RESOLUTION_MIN, raw))
}

/** Re-bake every live text whose raster is off the screen grid. A few
 *  compares when nothing moved. */
export function followTextResolution(
  texts: Iterable<Text | null | undefined>,
  resolution: number,
): void {
  for (const text of texts) {
    if (text && text.resolution !== resolution) text.resolution = resolution
  }
}
