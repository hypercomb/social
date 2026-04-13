// diamondcoreprocessor.com/editor/resource-thumbnail.ts
//
// Generates hex-sized thumbnails from an image Blob using a plain offscreen
// canvas (no Pixi, no ImageEditorService dependency). Produces BOTH orientations
// (point-top and flat-top) so the dropped resource survives the orientation
// toggle the same way a tile-editor-saved image does.

import type { Settings, HexOrientation } from '../preferences/settings.js'

type GeneratedThumbnails = {
  pointBlob: Blob | null
  flatBlob: Blob | null
}

/**
 * Decode `source` into an Image and produce cover-scaled thumbnails at the
 * point-top and flat-top hex dimensions reported by Settings.
 * Returns null blobs for orientations that failed to encode.
 */
export const generateHexThumbnails = async (source: Blob): Promise<GeneratedThumbnails> => {
  const settings = (window as any).ioc?.get?.('@diamondcoreprocessor.com/Settings') as Settings | undefined

  const pw = settings ? Math.round(settings.hexWidth('point-top')) : 346
  const ph = settings ? Math.round(settings.hexHeight('point-top')) : 400
  const fw = settings ? Math.round(settings.hexWidth('flat-top')) : 400
  const fh = settings ? Math.round(settings.hexHeight('flat-top')) : 346

  const objectUrl = URL.createObjectURL(source)
  try {
    const img = await loadImage(objectUrl)
    const [pointBlob, flatBlob] = await Promise.all([
      renderCover(img, pw, ph),
      renderCover(img, fw, fh),
    ])
    return { pointBlob, flatBlob }
  } catch {
    return { pointBlob: null, flatBlob: null }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

/**
 * Single-orientation helper — used for the in-memory `<img>` preview shown
 * in the command-line chevron slot (doesn't need hex dimensions).
 */
export const generatePreviewThumbnail = async (source: Blob, size = 256): Promise<Blob | null> => {
  const objectUrl = URL.createObjectURL(source)
  try {
    const img = await loadImage(objectUrl)
    return await renderCover(img, size, size)
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

const renderCover = (img: HTMLImageElement, targetW: number, targetH: number): Promise<Blob | null> => {
  const canvas = document.createElement('canvas')
  canvas.width = targetW
  canvas.height = targetH
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.resolve(null)

  const scale = Math.max(targetW / img.naturalWidth, targetH / img.naturalHeight)
  const drawW = img.naturalWidth * scale
  const drawH = img.naturalHeight * scale
  const dx = (targetW - drawW) / 2
  const dy = (targetH - drawH) / 2

  ctx.drawImage(img, dx, dy, drawW, drawH)
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(b => resolve(b), 'image/png')
  })
}

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image decode failed'))
    img.src = src
  })

// Back-compat: keep the original name as an alias for any older references.
export const generateThumbnailBlob = generatePreviewThumbnail

// Export orientation type for callers.
export type { HexOrientation }
