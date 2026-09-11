// substrate/tile-small-render.ts
//
// Re-draw a tile's SMALL picture from the participant's LARGE original.
//
// The tile editor stores two things when a person sets a picture: the
// full-resolution original (`large.image`) and the framing they chose
// (`large.x/y/scale` for point-top, `flat.large.x/y/scale` for flat-top).
// The two small renders it also writes are DERIVED from exactly those, so a
// small that was overwritten is not lost while the original and the framing
// survive: draw them again and the participant's picture is back. That is
// what the healing pass uses, and it is the reason healing is possible at all.
//
// It draws through the SAME capture the editor saves with
// (`editor/hex-capture.ts`) — never a copy of it. This file used to restate
// the editor's old capture, gold hex stroke and background fill included, and
// every tile it healed came back with a ring baked into its pixels.

import { captureHexSmall } from '../editor/hex-capture.js'
import type { Framing } from '../editor/crop-math.js'

export type SmallFraming = Framing

export type SmallRenderOptions = {
  /** Output box — the hex bounding box for this orientation, whole pixels. */
  width: number
  height: number
  orientation: 'point-top' | 'flat-top'
  /** The participant's framing. Absent ⇒ the editor's default (centred, covering). */
  framing?: SmallFraming
}

/**
 * Draw the participant's original into one orientation's hex box and
 * return it — the same bytes the editor's save makes for the same framing.
 */
export const renderTileSmall = async (
  original: Blob,
  options: SmallRenderOptions,
): Promise<Blob> => {
  // The box is the hex box of a side; recover the side from the long edge,
  // which is always exactly 2 × side.
  const side = Math.max(options.width, options.height) / 2
  return await captureHexSmall(original, {
    orientation: options.orientation,
    framing: options.framing,
    side,
  })
}
