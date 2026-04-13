// diamondcoreprocessor.com/editor/arm-resource.ts
//
// Shared helper: store an image Blob as content-addressed resources (full
// size + both hex orientations), then emit `command:arm-resource` so the
// command-line renders a preview in its chevron slot. Reused by image-drop,
// link-drop, and the mobile long-press clipboard-paste flow.

import { EffectBus } from '@hypercomb/core'
import { generateHexThumbnails, generatePreviewThumbnail } from './resource-thumbnail.js'

type Store = {
  putResource: (blob: Blob) => Promise<string>
}

type ArmType = 'image' | 'youtube' | 'link' | 'document'

export const armImageBlob = async (
  blob: Blob,
  opts: { url?: string | null; type?: ArmType } = {},
): Promise<boolean> => {
  const store = (window as any).ioc?.get?.('@hypercomb.social/Store') as Store | undefined
  if (!store) return false

  const [largeSig, hex, preview] = await Promise.all([
    store.putResource(blob),
    generateHexThumbnails(blob),
    generatePreviewThumbnail(blob),
  ])
  const smallPointSig = hex.pointBlob ? await store.putResource(hex.pointBlob) : null
  const smallFlatSig = hex.flatBlob ? await store.putResource(hex.flatBlob) : null

  const previewUrl = URL.createObjectURL(preview ?? blob)

  EffectBus.emit('command:arm-resource', {
    previewUrl,
    largeSig,
    smallPointSig,
    smallFlatSig,
    url: opts.url ?? null,
    type: opts.type ?? 'image',
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
