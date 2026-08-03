// diamondcoreprocessor.com/substrate/tile-small-render.ts
//
// Re-draw a tile's SMALL picture from the participant's LARGE original.
//
// The tile editor stores two things when a person sets a picture: the
// full-resolution original (`large.image`) and the framing they chose
// (`large.x/y/scale` for point-top, `flat.large.x/y/scale` for flat-top).
// The two small renders it also writes are DERIVED from exactly those —
// they are the original, drawn at the chosen framing, cropped to the hex
// box. Nothing about that derivation needs the editor's Pixi canvas.
//
// So a small that was overwritten is not lost while the original and the
// framing survive: draw them again and the participant's picture is back,
// pixel-for-pixel what the editor would have produced. That is what the
// healing pass uses, and it is the reason healing is possible at all.
//
// The geometry is the editor's, restated:
//   · the editor's canvas is a square of side S, the hex centred in it;
//   · the sprite is anchored at its centre, placed at (S/2 + x, S/2 + y)
//     and scaled by `scale`;
//   · the capture crops a hexWidth × hexHeight box centred on the square.
// S cancels: in the cropped box the sprite centre lands at
// (hexWidth/2 + x, hexHeight/2 + y). The frame stroke keeps the editor's
// own 346×400 hex constants so a healed tile draws the same ring it had.

export type SmallFraming = { x: number; y: number; scale: number }

export type SmallRenderOptions = {
  /** Output box — the hex bounding box for this orientation. */
  width: number
  height: number
  orientation: 'point-top' | 'flat-top'
  /** The participant's framing. Absent ⇒ cover-fit, the editor's default. */
  framing?: SmallFraming
  /** `background.color` from the tile's props. */
  background?: string
  /** `border.color` from the tile's props — the hex ring. */
  border?: string
}

const EDITOR_BACKGROUND = '#1e1e1e'
const EDITOR_BORDER = '#c8975a'
const FRAME_STROKE = 14.44

const canvasOf = (w: number, h: number): OffscreenCanvas | HTMLCanvasElement =>
  typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h })

const toBlob = async (canvas: OffscreenCanvas | HTMLCanvasElement): Promise<Blob> => {
  if ('convertToBlob' in canvas) return await canvas.convertToBlob({ type: 'image/webp' })
  return await new Promise<Blob>((resolve, reject) =>
    (canvas as HTMLCanvasElement).toBlob(
      b => b ? resolve(b) : reject(new Error('toBlob failed')),
      'image/webp',
    ))
}

/** The six vertices of the hex the editor strokes, centred in the box. */
const hexVertices = (w: number, h: number, flat: boolean): [number, number][] => {
  const cx = w / 2
  const cy = h / 2
  const hw = (flat ? 400 : 346) / 2 - FRAME_STROKE / 2
  const hh = (flat ? 346 : 400) / 2 - FRAME_STROKE / 2
  return flat
    ? [[cx + hw, cy], [cx + hw / 2, cy + hh], [cx - hw / 2, cy + hh],
       [cx - hw, cy], [cx - hw / 2, cy - hh], [cx + hw / 2, cy - hh]]
    : [[cx, cy - hh], [cx + hw, cy - hh / 2], [cx + hw, cy + hh / 2],
       [cx, cy + hh], [cx - hw, cy + hh / 2], [cx - hw, cy - hh / 2]]
}

/**
 * Draw the participant's original into one orientation's hex box and
 * return it as a webp blob — the same bytes the editor's capture makes.
 */
export const renderTileSmall = async (
  original: Blob,
  options: SmallRenderOptions,
): Promise<Blob> => {
  const { width: w, height: h, orientation, framing } = options
  const bitmap = await createImageBitmap(original)
  try {
    const canvas = canvasOf(w, h)
    const ctx = (canvas as any).getContext('2d') as CanvasRenderingContext2D | null
    if (!ctx) throw new Error('2d context unavailable')

    ctx.fillStyle = options.background || EDITOR_BACKGROUND
    ctx.fillRect(0, 0, w, h)

    // Cover-fit when there is no saved framing — what the editor does for
    // an image it has just been handed.
    const scale = framing?.scale ?? Math.max(w / bitmap.width, h / bitmap.height)
    const cx = w / 2 + (framing?.x ?? 0)
    const cy = h / 2 + (framing?.y ?? 0)
    const drawW = bitmap.width * scale
    const drawH = bitmap.height * scale
    ctx.drawImage(bitmap, cx - drawW / 2, cy - drawH / 2, drawW, drawH)

    const verts = hexVertices(w, h, orientation === 'flat-top')
    ctx.beginPath()
    ctx.moveTo(verts[0][0], verts[0][1])
    for (const [x, y] of verts.slice(1)) ctx.lineTo(x, y)
    ctx.closePath()
    ctx.lineWidth = FRAME_STROKE
    ctx.strokeStyle = options.border || EDITOR_BORDER
    ctx.stroke()

    return await toBlob(canvas)
  } finally {
    bitmap.close()
  }
}
