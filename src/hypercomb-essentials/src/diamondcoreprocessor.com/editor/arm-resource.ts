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
 * Store `blob` as content-addressed resources (full size + both hex
 * orientations) and build a preview Object URL. Shared by the command-line
 * arming flow and the direct create-and-attach path. Returns null if the
 * Store is unavailable.
 */
export const storeImageResources = async (blob: Blob): Promise<ImageResources | null> => {
  const store = (window as any).ioc?.get?.('@hypercomb.social/Store') as Store | undefined
  if (!store) return null

  const [largeSig, hex, preview] = await Promise.all([
    store.putResource(blob),
    generateHexThumbnails(blob),
    generatePreviewThumbnail(blob),
  ])
  const smallPointSig = hex.pointBlob ? await store.putResource(hex.pointBlob) : null
  const smallFlatSig = hex.flatBlob ? await store.putResource(hex.flatBlob) : null
  const previewUrl = URL.createObjectURL(preview ?? blob)

  return { largeSig, smallPointSig, smallFlatSig, previewUrl }
}

export const armImageBlob = async (
  blob: Blob,
  opts: { url?: string | null; type?: ArmType; attachment?: PendingAttachment | null } = {},
): Promise<boolean> => {
  const res = await storeImageResources(blob)
  if (!res) return false

  EffectBus.emit('command:arm-resource', {
    previewUrl: res.previewUrl,
    largeSig: res.largeSig,
    smallPointSig: res.smallPointSig,
    smallFlatSig: res.smallFlatSig,
    url: opts.url ?? null,
    type: opts.type ?? 'image',
    attachment: opts.attachment ?? null,
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
