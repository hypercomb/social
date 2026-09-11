// editor/hex-capture.ts
//
// THE ONE CAPTURE — the original picture, drawn at a framing, into one
// orientation's hex box. Every small picture the hive renders comes from
// here: the tile editor's save, the heal pass, a dropped or pasted picture,
// the substrate pool.
//
// WHAT IT CAN NEVER DRAW. There is no stroke, no rim, no vignette, no name,
// no mask and no default colour in this file, and the box is transparent
// until the picture lands on it. The tile's look (rim, glow, band, name) is
// the RENDERER'S job and is drawn over the picture at display time; baking
// any of it into the bytes is how a second gold rim came to sit inside the
// shader's own, and how a hexagon came to be painted across the middle of a
// picture shown in a rectangle. The only thing besides the picture a capture
// may hold is a FILL the participant chose to sit behind a picture set to
// Fit — and only when they chose one.
//
// Pure geometry lives in crop-math.ts; this adds the canvas. OffscreenCanvas
// where it exists, so it runs the same in a worker as on the page.

import {
  captureBox,
  defaultFraming,
  drawRect,
  DEFAULT_HEX_SIDE,
  type Framing,
  type HexOrientation,
  type Size,
} from './crop-math.js'

export type CaptureOptions = {
  orientation: HexOrientation
  /** The participant's framing. Absent = the default (centred, covering). */
  framing?: Framing
  /** `#rrggbb` painted behind the picture. Only ever the participant's own
   *  choice for a picture set to Fit; anything else is ignored. */
  fill?: string | null
  side?: number
  quality?: number
}

export const CAPTURE_TYPE = 'image/webp'
export const CAPTURE_QUALITY = 0.92

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement
type Ctx2d = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
type Drawable = ImageBitmap | AnyCanvas

/** `#rgb` / `#rrggbb` → `#rrggbb`, else null. Black is black: a parse that
 *  fell back to a default on a zero value turned `#000000` into light grey. */
export const parseHexColour = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const raw = value.trim().replace(/^#/, '')
  if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw.toLowerCase()}`
  if (/^[0-9a-f]{3}$/i.test(raw)) return `#${raw.split('').map(c => c + c).join('').toLowerCase()}`
  return null
}

/** The pure half: the box, the framing actually used, and where the picture
 *  lands in the box. */
export const captureGeometry = (
  source: Size,
  options: Pick<CaptureOptions, 'orientation' | 'framing' | 'side'>,
): { box: Size; framing: Framing; rect: { x: number; y: number; width: number; height: number } } => {
  const side = options.side ?? DEFAULT_HEX_SIDE
  const box = captureBox(options.orientation, side)
  const framing = options.framing ?? defaultFraming(source, side)
  return { box, framing, rect: drawRect(source, framing, box) }
}

const makeCanvas = (width: number, height: number): AnyCanvas =>
  typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement('canvas'), { width, height })

const context = (canvas: AnyCanvas): Ctx2d => {
  const ctx = (canvas as HTMLCanvasElement).getContext('2d') as Ctx2d | null
  if (!ctx) throw new Error('2d context unavailable')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  return ctx
}

/** Decode a picture. `createImageBitmap` first; an <img> decode for formats
 *  a bitmap decoder refuses on some engines (HEIC from an iPhone library). */
export const decodePicture = async (blob: Blob): Promise<ImageBitmap> => {
  try {
    return await createImageBitmap(blob)
  } catch (first) {
    if (typeof document === 'undefined') throw first
    const url = URL.createObjectURL(blob)
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      return await createImageBitmap(img)
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}

/** Step a large picture down by halves before the final draw. A single
 *  bilinear draw from a 4000px photo into a 346px box samples one texel in
 *  eleven and bakes the aliasing into the bytes; halving until the source is
 *  within twice the drawn size keeps every step a clean 2:1. Deterministic,
 *  so the same picture at the same framing gives the same bytes. */
const reduceFor = (bitmap: ImageBitmap, drawWidth: number, drawHeight: number): Drawable => {
  let source: Drawable = bitmap
  let width = bitmap.width
  let height = bitmap.height
  while (width > drawWidth * 2 && height > drawHeight * 2 && width > 2 && height > 2) {
    const nextWidth = Math.max(1, Math.round(width / 2))
    const nextHeight = Math.max(1, Math.round(height / 2))
    const step = makeCanvas(nextWidth, nextHeight)
    context(step).drawImage(source as CanvasImageSource, 0, 0, nextWidth, nextHeight)
    source = step
    width = nextWidth
    height = nextHeight
  }
  return source
}

const encode = async (canvas: AnyCanvas, quality: number): Promise<Blob> => {
  if ('convertToBlob' in canvas) return await canvas.convertToBlob({ type: CAPTURE_TYPE, quality })
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), CAPTURE_TYPE, quality))
}

const isBitmap = (value: unknown): value is ImageBitmap =>
  typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap

/** Capture one orientation's small picture. Pass a decoded bitmap to capture
 *  several orientations from one decode; a Blob is decoded and released here. */
export const captureHexSmall = async (source: Blob | ImageBitmap, options: CaptureOptions): Promise<Blob> => {
  const owned = !isBitmap(source)
  const bitmap = owned ? await decodePicture(source as Blob) : source as ImageBitmap
  try {
    const { box, rect } = captureGeometry({ width: bitmap.width, height: bitmap.height }, options)
    const canvas = makeCanvas(box.width, box.height)
    const ctx = context(canvas)
    const fill = parseHexColour(options.fill)
    if (fill) {
      ctx.fillStyle = fill
      ctx.fillRect(0, 0, box.width, box.height)
    }
    const drawable = reduceFor(bitmap, Math.max(1, rect.width), Math.max(1, rect.height))
    ctx.drawImage(drawable as CanvasImageSource, rect.x, rect.y, rect.width, rect.height)
    return await encode(canvas, options.quality ?? CAPTURE_QUALITY)
  } finally {
    if (owned) bitmap.close()
  }
}

/** Both orientations from one decode — what every writer of a tile picture
 *  needs. `framings` absent for an orientation means the default framing. */
export const captureBothOrientations = async (
  source: Blob | ImageBitmap,
  options: { point?: Framing; flat?: Framing; fill?: string | null; side?: number } = {},
): Promise<{ point: Blob; flat: Blob }> => {
  const owned = !isBitmap(source)
  const bitmap = owned ? await decodePicture(source as Blob) : source as ImageBitmap
  try {
    const point = await captureHexSmall(bitmap, { orientation: 'point-top', framing: options.point, fill: options.fill, side: options.side })
    const flat = await captureHexSmall(bitmap, { orientation: 'flat-top', framing: options.flat, fill: options.fill, side: options.side })
    return { point, flat }
  } finally {
    if (owned) bitmap.close()
  }
}
