// assistant/picture-read.ts
//
// A MODEL SEES A PICTURE IT READS (jwize 2026-11-13: "things like images and
// other document resources that the ai can scrutinize"). `read <signature>`
// of picture bytes answered only "not text; only its type and size". The
// agent built a card's back faces from pictures it never saw, and both real
// bugs in that work were found only by a person looking (2026-11-15).
//
// Now a picture read answers with what can be said in words — its size and a
// short reading of its colours (comfy-help.ts pictureReading) — and a JPEG of
// it, at most PICTURE_SIDE on its longest edge. The chat attaches that JPEG to
// the next message when the conversation's model can see pictures; a model
// that cannot gets the words alone, told so (hypercomb-runtime chat-window).
// Nothing is stored: the JPEG is made from the bytes for that one answer.

import { pictureContext } from '../comfy/comfy-help.js'

/** The longest edge a model is sent: enough to read text on a card. */
export const PICTURE_SIDE = 1024
/** A JPEG larger than this, as base64, is not sent (about 1 MB of picture). */
export const PICTURE_MAX_BASE64 = 1_400_000
/** Bytes larger than this are not decoded for a model. */
export const PICTURE_MAX_BYTES = 24_000_000

export type HypercombPicture = {
  readonly width: number
  readonly height: number
  /** Its size and colours, in words. */
  readonly reading: string
  /** What a model that sees is shown. Absent when it could not be made small enough. */
  readonly image?: { readonly mime: 'image/jpeg'; readonly base64: string }
}

/** The picture type of these bytes, by their first bytes when the store gave
 *  no type or a generic one; '' for anything that is not a picture a browser
 *  decodes. SVG is text and is read as text. */
export const pictureType = (bytes: Uint8Array, type: string): string => {
  const said = String(type ?? '').split(';')[0]!.trim().toLowerCase()
  if (/^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(said)) return said
  const at = (i: number): number => bytes[i] ?? -1
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png'
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg'
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return 'image/gif'
  if (at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46
    && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) return 'image/webp'
  return ''
}

export type PictureContext = typeof pictureContext

/** The picture these bytes hold, for a model; undefined when they are not one
 *  or cannot be decoded here (no canvas in this shell). Never throws. */
export const readPicture = async (
  bytes: Uint8Array,
  type: string,
  context: PictureContext = pictureContext,
): Promise<HypercombPicture | undefined> => {
  const mime = pictureType(bytes, type)
  if (!mime || bytes.byteLength > PICTURE_MAX_BYTES) return undefined
  try {
    const blob = new Blob([bytes as BlobPart], { type: mime })
    const seen = await context(blob, { side: PICTURE_SIDE, maxBase64: PICTURE_MAX_BASE64 })
    if (!seen.width || !seen.height) return undefined
    const image = seen.image && seen.image.mime === 'image/jpeg' ? { mime: 'image/jpeg' as const, base64: seen.image.base64 } : undefined
    return { width: seen.width, height: seen.height, reading: seen.reading, ...(image ? { image } : {}) }
  } catch { return undefined }
}
