// hypercomb-shared/ui/markup-overlay/markup-cut.ts
//
// CUTS, MAPPED ONTO THE FRAME. A cut is a frame the participant drags on the
// sheet around a part of the screen that matters; the shot then sends each
// cut as its own picture instead of the whole screen. Two gains, and they are
// the reason the gesture exists:
//
//   sharper   the whole screen is downscaled to its longest-edge budget,
//             which is where small interface text goes soft; a cut is taken
//             from the full-resolution frame and seldom needs downscaling.
//   quicker   what a vision model spends on a picture grows with its area, so
//             a panel-sized cut is read for a fraction of the whole screen.
//             Several cuts beat one frame around all of them whenever the
//             parts are far apart — that frame would carry everything between.
//
// A cut is drawn in CSS pixels on the sheet; the frame is in the capture's own
// pixels. A tab capture is the viewport scaled uniformly (device pixel ratio,
// browser zoom, any downscale the capture applied), so one ratio per axis maps
// one onto the other. When the two ratios disagree the shared surface was not
// this tab — a window, or a whole monitor — and no cut drawn on the page can be
// found in it: the answer is null, never a guess.

export type CutPoint = { readonly x: number; readonly y: number }
export type Cut = { readonly from: CutPoint; readonly to: CutPoint }
export type Size = { readonly width: number; readonly height: number }
export type Region = { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

/** How far the two axis ratios may disagree before the frame is called some
 *  other surface. Rounding of an odd viewport size stays well inside it; a
 *  monitor behind a browser window does not. */
const SAME_SURFACE_TOLERANCE = 0.02

/** Each cut as a region of the frame, in the order the cuts were drawn. A cut
 *  running off the screen is clamped to it; one lying wholly off it is
 *  dropped. Null when the frame is not the viewport the cuts were drawn on. */
export function cutRegions(cuts: readonly Cut[], viewport: Size, frame: Size): Region[] | null {
  if (!(viewport.width > 0 && viewport.height > 0 && frame.width > 0 && frame.height > 0)) return null
  const scaleX = frame.width / viewport.width
  const scaleY = frame.height / viewport.height
  if (Math.abs(scaleX - scaleY) / Math.max(scaleX, scaleY) > SAME_SURFACE_TOLERANCE) return null

  const regions: Region[] = []
  for (const cut of cuts) {
    const left = Math.round(clamp(Math.min(cut.from.x, cut.to.x), viewport.width) * scaleX)
    const right = Math.round(clamp(Math.max(cut.from.x, cut.to.x), viewport.width) * scaleX)
    const top = Math.round(clamp(Math.min(cut.from.y, cut.to.y), viewport.height) * scaleY)
    const bottom = Math.round(clamp(Math.max(cut.from.y, cut.to.y), viewport.height) * scaleY)
    if (right - left < 1 || bottom - top < 1) continue
    regions.push({ x: left, y: top, width: right - left, height: bottom - top })
  }
  return regions
}

const clamp = (value: number, limit: number): number => Math.min(Math.max(value, 0), limit)
