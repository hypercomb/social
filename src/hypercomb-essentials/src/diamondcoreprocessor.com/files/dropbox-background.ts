// diamondcoreprocessor.com/files/dropbox-background.ts
//
// Generates the default "dropbox item" background — the visual a tile gets
// when you drop a document onto the hive. It reads as a sheet of paper with
// a type-coloured extension badge (PDF / DOCX / XLSX …) so you can see at a
// glance that the tile you just made is a dropped file, and which kind.
//
// The flow mirrors a user-supplied image: the SVG is rasterised to a PNG
// Blob and fed through the same `armImageBlob` / `storeImageResources`
// pipeline, so it becomes an ordinary content-addressed tile picture (no
// substrate flag, stable across devices/witnesses).

import { extOf } from './file-types.js'

/** Extension → badge colour. Cool, flat, professional — no glow. */
const TYPE_COLOR: Record<string, string> = {
  pdf: '#d4524e',
  doc: '#3b6fb6', docx: '#3b6fb6', rtf: '#3b6fb6', odt: '#3b6fb6',
  txt: '#5f7080', md: '#5f7080',
  xls: '#1f9d57', xlsx: '#1f9d57', csv: '#1f9d57', tsv: '#1f9d57',
  ppt: '#d9863a', pptx: '#d9863a', key: '#d9863a',
  zip: '#8a6db0', rar: '#8a6db0', '7z': '#8a6db0', tar: '#8a6db0', gz: '#8a6db0',
  json: '#6a7b88', svg: '#6a7b88', xml: '#6a7b88',
}

const colorFor = (ext: string): string => TYPE_COLOR[ext] ?? '#5f7080'

/** Short uppercase label for the badge (max 4 chars, 'FILE' when unknown). */
const labelFor = (ext: string): string => (ext ? ext.toUpperCase().slice(0, 4) : 'FILE')

/**
 * Default dropbox-item background as an SVG string (512×512). A folded sheet
 * of paper on a cool gradient, faint text lines, and a coloured extension
 * pill centred near the bottom.
 */
export const dropboxBackgroundSvg = (extOrName: string): string => {
  const ext = extOrName.includes('.') ? extOf(extOrName) : extOrName.toLowerCase()
  const color = colorFor(ext)
  const label = labelFor(ext)
  const badgeW = Math.min(150, 64 + label.length * 20)
  const badgeX = 256 - badgeW / 2

  // body text lines (skip the row the badge sits over)
  const lines = [200, 226, 252, 278]
    .map((y, i) => `<rect x="184" y="${y}" width="${i % 2 ? 128 : 144}" height="10" rx="5" fill="#d6dee5"/>`)
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#eef3f7"/>
      <stop offset="1" stop-color="#cbd8e2"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <!-- soft shadow -->
  <rect x="166" y="120" width="192" height="276" rx="8" fill="#16202b" opacity="0.10"/>
  <!-- sheet with folded top-right corner -->
  <path d="M168 112 H316 L356 152 V378 a8 8 0 0 1 -8 8 H176 a8 8 0 0 1 -8 -8 V120 a8 8 0 0 1 8 -8 Z" fill="#ffffff"/>
  <path d="M316 112 V152 H356 Z" fill="#dde6ee"/>
  <!-- title + body lines -->
  <rect x="184" y="168" width="92" height="14" rx="7" fill="#9aa8b4"/>
  ${lines}
  <!-- extension badge -->
  <rect x="${badgeX}" y="320" width="${badgeW}" height="36" rx="18" fill="${color}"/>
  <text x="256" y="345" text-anchor="middle" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="20" font-weight="700" letter-spacing="1.5" fill="#ffffff">${label}</text>
</svg>`
}

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('svg decode failed'))
    img.src = src
  })

/**
 * Rasterise the dropbox background to a 512×512 PNG Blob so it can be stored
 * and rendered exactly like a user-supplied tile image. Falls back to the raw
 * SVG Blob if canvas rasterisation is unavailable.
 */
export const dropboxBackgroundBlob = async (extOrName: string): Promise<Blob> => {
  const svg = dropboxBackgroundSvg(extOrName)
  const svgBlob = new Blob([svg], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(svgBlob)
  try {
    const img = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 512
    const ctx = canvas.getContext('2d')
    if (!ctx) return svgBlob
    ctx.drawImage(img, 0, 0, 512, 512)
    const png = await new Promise<Blob | null>(res => canvas.toBlob(b => res(b), 'image/png'))
    return png ?? svgBlob
  } catch {
    return svgBlob
  } finally {
    URL.revokeObjectURL(url)
  }
}
