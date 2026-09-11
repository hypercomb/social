// editor/resource-thumbnail.ts
//
// Small pictures for a dropped or pasted image, in BOTH orientations, so the
// resource survives the orientation toggle the same way a tile-editor-saved
// image does.
//
// They come from the same capture the editor saves with (`hex-capture.ts`),
// at the default framing — so when the tile is later opened in the editor
// the picture sits exactly where the hive showed it, and a save without a
// touch changes nothing.

import { captureBothOrientations, decodePicture } from './hex-capture.js'
import type { Settings, HexOrientation } from '../preferences/settings.js'

type GeneratedThumbnails = {
  pointBlob: Blob | null
  flatBlob: Blob | null
}

/** Both orientations' small pictures at the default framing. Null blobs when
 *  the picture cannot be decoded. */
export const generateHexThumbnails = async (source: Blob): Promise<GeneratedThumbnails> => {
  const settings = (window as any).ioc?.get?.('@diamondcoreprocessor.com/Settings') as Settings | undefined
  const side = settings?.hexagonSide
  try {
    const both = await captureBothOrientations(source, typeof side === 'number' && side > 0 ? { side } : {})
    return { pointBlob: both.point, flatBlob: both.flat }
  } catch {
    return { pointBlob: null, flatBlob: null }
  }
}

/**
 * Single-orientation helper — used for the in-memory `<img>` preview shown
 * in the command-line chevron slot (doesn't need hex dimensions).
 */
export const generatePreviewThumbnail = async (source: Blob, size = 256): Promise<Blob | null> => {
  try {
    const bitmap = await decodePicture(source)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      const scale = Math.max(size / bitmap.width, size / bitmap.height)
      const drawW = bitmap.width * scale
      const drawH = bitmap.height * scale
      ctx.drawImage(bitmap, (size - drawW) / 2, (size - drawH) / 2, drawW, drawH)
      return await new Promise<Blob | null>(resolve => canvas.toBlob(b => resolve(b), 'image/webp', 0.9))
    } finally {
      bitmap.close()
    }
  } catch {
    return null
  }
}

// Back-compat: keep the original name as an alias for any older references.
export const generateThumbnailBlob = generatePreviewThumbnail

// Export orientation type for callers.
export type { HexOrientation }
