// editor/arm-resource.ts
//
// Shared helper: store an image Blob as content-addressed resources (full
// size + both hex orientations), then emit `command:arm-resource` so the
// command-line renders a preview in its chevron slot. Reused by image-drop,
// link-drop, and the mobile long-press clipboard-paste flow.

import { EffectBus } from '@hypercomb/core'
import { generateHexThumbnails, generatePreviewThumbnail } from './resource-thumbnail.js'
import { decodePicture } from './hex-capture.js'

/** The longest edge a stored LARGE picture may have. */
export const LARGE_IMAGE_EDGE = 2560
const LARGE_IMAGE_TYPE = 'image/webp'
const LARGE_IMAGE_QUALITY = 0.9

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement

const encodeCanvas = async (canvas: AnyCanvas, type: string, quality: number): Promise<Blob | null> => {
  try {
    if ('convertToBlob' in canvas) return await canvas.convertToBlob({ type, quality })
    return await new Promise<Blob | null>(resolve => canvas.toBlob(blob => resolve(blob), type, quality))
  } catch { return null }
}

/**
 * THE LARGE COPY IS NEVER THE RAW FILE (owner decision D3). A phone photo is
 * 5–15 MB: over a host's 8 MB atom limit — so the tile it sits on could never
 * be taken — and a phone's storage fills one picture at a time. The large is
 * re-encoded as WebP with its long edge at most {@link LARGE_IMAGE_EDGE}.
 *
 * `ratio` is stored width / original width: a framing expressed against the
 * original's pixels (crop-math: `scale` is frame units per ORIGINAL pixel)
 * divides its scale by it. An engine that cannot encode WebP (Safari answers
 * PNG) shrinks to JPEG for a photo and to that PNG for anything that may
 * carry transparency.
 *
 * THE RE-ENCODE IS ALSO WHAT STRIPS THE METADATA. A photo's original bytes
 * carry its EXIF — the GPS of where it was taken — and the large copy is
 * uploaded to the room's hosts and served to every member who opens the
 * tile. So a picture this engine re-encodes is ALWAYS stored re-encoded,
 * even one already within the edge whose re-encode comes out no smaller.
 * Kept as it came only: a picture this engine cannot decode or draw, and a
 * GIF within the edge (the canvas would flatten its animation; GIF carries
 * no EXIF).
 */
export const largeImage = async (blob: Blob): Promise<{ blob: Blob; ratio: number }> => {
  let bitmap: ImageBitmap
  try { bitmap = await decodePicture(blob) } catch { return { blob, ratio: 1 } }
  try {
    const long = Math.max(bitmap.width, bitmap.height)
    if (!(long > 0)) return { blob, ratio: 1 }
    const shrink = long > LARGE_IMAGE_EDGE
    const k = shrink ? LARGE_IMAGE_EDGE / long : 1
    const width = Math.max(1, Math.round(bitmap.width * k))
    const height = Math.max(1, Math.round(bitmap.height * k))
    const canvas: AnyCanvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height })
    const ctx = (canvas as HTMLCanvasElement).getContext('2d') as CanvasRenderingContext2D | null
    if (!ctx) return { blob, ratio: 1 }
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, width, height)
    let out = await encodeCanvas(canvas, LARGE_IMAGE_TYPE, LARGE_IMAGE_QUALITY)
    if (out && out.type !== LARGE_IMAGE_TYPE && /^image\/(jpe?g|heic|heif)$/i.test(blob.type)) {
      out = await encodeCanvas(canvas, 'image/jpeg', LARGE_IMAGE_QUALITY)
    }
    if (!out || !out.size) return { blob, ratio: 1 }
    if (!shrink && /^image\/gif$/i.test(blob.type)) return { blob, ratio: 1 }
    return { blob: out, ratio: width / bitmap.width }
  } catch {
    return { blob, ratio: 1 } // a canvas this engine refused — the picture as it came
  } finally {
    try { bitmap.close() } catch { /* already closed */ }
  }
}

type Store = {
  putResource: (blob: Blob) => Promise<string>
}

type ArmType = 'image' | 'youtube' | 'link' | 'document'

/** A document to attach to the cell once the user names it and presses Enter. */
type PendingAttachment = { name: string; mime: string; size: number; sig: string }

export type ImageResources = {
  largeSig: string
  smallPointSig: string | null
  smallFlatSig: string | null
  /** Object URL of a small preview — the caller owns revocation. */
  previewUrl: string
}

/**
 * Store `blob` as content-addressed resources (the large copy — see
 * {@link largeImage} — plus both hex orientations) and build a preview Object
 * URL. Shared by the command-line arming flow and the direct create-and-attach
 * path. Returns null if the Store is unavailable.
 */
export const storeImageResources = async (blob: Blob): Promise<ImageResources | null> => {
  const store = (window as any).ioc?.get?.('@hypercomb.social/Store') as Store | undefined
  if (!store) return null

  // The original is decoded ONCE, for the large; the small pictures come
  // from the large (same aspect, so the same default framing) — three
  // parallel decodes of a 24-megapixel photo is how a phone runs out of memory.
  const large = await largeImage(blob)
  const [largeSig, hex, preview] = await Promise.all([
    store.putResource(large.blob),
    generateHexThumbnails(large.blob),
    generatePreviewThumbnail(large.blob),
  ])
  const smallPointSig = hex.pointBlob ? await store.putResource(hex.pointBlob) : null
  const smallFlatSig = hex.flatBlob ? await store.putResource(hex.flatBlob) : null
  const previewUrl = URL.createObjectURL(preview ?? large.blob)

  return { largeSig, smallPointSig, smallFlatSig, previewUrl }
}

export const armImageBlob = async (
  blob: Blob,
  opts: {
    url?: string | null
    type?: ArmType
    attachment?: PendingAttachment | null
    name?: string | null
    /** Identity of an already-armed slot this is filling in, if any. */
    armId?: string | null
    /** Pin the created tile to the first slot. */
    atTop?: boolean
  } = {},
): Promise<boolean> => {
  const res = await storeImageResources(blob)
  if (!res) return false

  EffectBus.emit('command:arm-resource', {
    armId: opts.armId ?? null,
    atTop: opts.atTop === true,
    previewUrl: res.previewUrl,
    largeSig: res.largeSig,
    smallPointSig: res.smallPointSig,
    smallFlatSig: res.smallFlatSig,
    url: opts.url ?? null,
    type: opts.type ?? 'image',
    attachment: opts.attachment ?? null,
    name: opts.name ?? null,
  })
  return true
}

/**
 * Try to read an image from `navigator.clipboard` and arm it. Returns true
 * if an image was found and armed. Must be called inside a user-gesture
 * window (touch-release, long-press fire, etc) on mobile browsers.
 */
export const armFromClipboard = async (): Promise<boolean> => {
  try {
    const clipboard = (navigator as any).clipboard
    if (!clipboard?.read) return false
    const items = await clipboard.read()
    for (const item of items) {
      for (const mime of item.types as string[]) {
        if (mime.startsWith('image/')) {
          const blob = await item.getType(mime)
          return await armImageBlob(blob, { type: 'image' })
        }
      }
    }
  } catch {
    // permission denied, empty clipboard, or unsupported — fall through
  }
  return false
}
