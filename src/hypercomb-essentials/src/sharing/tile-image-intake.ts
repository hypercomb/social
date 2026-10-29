// sharing/tile-image-intake.ts
//
// A picture dropped on a tile becomes the picture it wears. The one it wore
// stays in its image collection, and so does every other picture in that
// drop, so the images button can offer them again.
//
// A paste while exactly one tile is selected does the same replacement.
// A paste while the pointer rests on a tile, with nothing selected, only
// joins the collection — the tile keeps the picture it wears.
//
// The collection is the lightbox gallery (`holdPictures`). The address is the
// one the images button and the wall already read: the page you are standing
// on, plus the tile's name.

import { EffectBus, I18N_IOC_KEY, RESOURCE_URL_PREFIX, type I18nProvider } from '@hypercomb/core'
import { largeImage } from '../editor/arm-resource.js'
import { generateHexThumbnails } from '../editor/resource-thumbnail.js'
import { readTilePropertiesAt, writeTilePropertiesAt } from '../editor/tile-properties.js'
import { galleryImageSigsAt, holdPictures } from '../commands/lightbox-kind.js'
import { terminalContentSig } from '../presentation/tiles/artifact-content.js'

const SIG = /^[0-9a-f]{64}$/

type Store = {
  putResource(blob: Blob): Promise<string>
  getResourceLocal?(sig: string): Promise<Blob | null>
}

const say = (key: string, fallback: string, params: Record<string, string | number> = {}): string => {
  let text = fallback
  try {
    const got = window.ioc?.get<I18nProvider>(I18N_IOC_KEY)?.t?.(key, params)
    if (got && got !== key) text = got
  } catch { /* the fallback is the sentence */ }
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name]
    return value == null ? whole : String(value)
  })
}

/** The picture the tile wears, as the bytes' own signature. '' when it has
 *  none (a substrate fill writes no `large`). */
export async function wornPictureSig(parent: readonly string[], label: string): Promise<string> {
  try {
    const props = await readTilePropertiesAt(parent, label)
    const large = (props['large'] as { image?: unknown } | undefined)?.image
    if (typeof large !== 'string' || !SIG.test(large)) return ''
    const store = window.ioc?.get?.<Store>('@hypercomb.social/Store')
    if (!store?.getResourceLocal) return large
    return (await terminalContentSig(store as { getResourceLocal(sig: string): Promise<Blob | null> }, large)) ?? large
  } catch {
    return ''
  }
}

export type HeldImages = { added: number; total: number }

/**
 * Store `blobs` and hold them on the tile, keeping the picture it already
 * wears. `added` counts only the blobs that were not already in the
 * collection. Emits `tile:saved` when the collection grew, so the images
 * button recounts.
 */
export async function holdImagesOnTile(
  parent: readonly string[],
  label: string,
  blobs: readonly Blob[],
): Promise<HeldImages> {
  const cell = label.trim()
  if (!cell || blobs.length === 0) return { added: 0, total: 0 }
  const store = window.ioc?.get?.<Store>('@hypercomb.social/Store')
  if (!store?.putResource) throw new Error('storage unavailable')

  const address = [...parent.map(segment => String(segment ?? '').trim()).filter(Boolean), cell]
  const before = new Set(await galleryImageSigsAt(address))
  const worn = await wornPictureSig(address.slice(0, -1), cell)

  const fresh: string[] = []
  for (const blob of blobs) {
    const large = await largeImage(blob)
    fresh.push(await store.putResource(large.blob))
  }
  const bytes = worn ? [worn, ...fresh] : fresh
  await holdPictures(address, bytes)

  const after = await galleryImageSigsAt(address)
  if (after.length > before.size) {
    EffectBus.emit<{ cell: string; segments: readonly string[] }>('tile:saved', {
      cell,
      segments: address.slice(0, -1),
    })
  }
  // The worn picture is kept quietly. Count only pictures this call brought
  // in, so "added a picture" means the drop, not the one the tile already wore.
  const grew = Math.max(0, after.length - before.size)
  const wornWasNew = worn && !before.has(worn) ? 1 : 0
  return { added: Math.max(0, grew - wornWasNew), total: after.length }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/**
 * The clipboard picture becomes the picture this tile wears. It is framed
 * the same way a dropped picture is: both hex captures at the default
 * framing (centred, covering), and the large copy with no hand-made crop.
 * The one it wore stays in the collection, so the images button can offer
 * it back.
 */
export async function replaceWornPicture(
  parent: readonly string[],
  label: string,
  blob: Blob,
): Promise<boolean> {
  const cell = label.trim()
  if (!cell) return false
  const store = window.ioc?.get?.<Store>('@hypercomb.social/Store')
  if (!store?.putResource) throw new Error('storage unavailable')

  const segments = parent.map(segment => String(segment ?? '').trim()).filter(Boolean)
  const existing = await readTilePropertiesAt(segments, cell)
  const oldLarge = (existing['large'] as { image?: unknown } | undefined)?.image
  const previous = typeof oldLarge === 'string' ? oldLarge : ''
  const worn = await wornPictureSig(segments, cell)
  const large = await largeImage(blob)
  const sig = await store.putResource(large.blob)
  if (worn && sig === worn) return false

  // The hex shows the capture, not the raw file. Same door a dropped
  // picture takes: both orientations, default framing.
  const hex = await generateHexThumbnails(large.blob)
  const pointSig = hex.pointBlob ? await store.putResource(hex.pointBlob) : ''
  const flatSig = hex.flatBlob ? await store.putResource(hex.flatBlob) : ''

  const updates: Record<string, unknown> = {
    large: { image: sig },
    small: pointSig ? { image: pointSig } : undefined,
    point: undefined,
    imageSig: undefined,
    substrate: undefined,
  }
  if (flatSig) {
    const previousFlat = existing['flat']
    const kept: Record<string, unknown> = {}
    if (isRecord(previousFlat)) {
      for (const [key, value] of Object.entries(previousFlat)) {
        if (key === 'large' || key === 'small') continue
        kept[key] = value
      }
    }
    updates['flat'] = { ...kept, small: { image: flatSig } }
  } else {
    updates['flat'] = undefined
  }
  const link = existing['link']
  if (typeof link === 'string' && previous && link === `${RESOURCE_URL_PREFIX}${previous}`) {
    updates['link'] = `${RESOURCE_URL_PREFIX}${sig}`
  }
  await writeTilePropertiesAt(segments, cell, updates)
  const keep = [worn, sig].filter(item => item.length > 0)
  if (keep.length > 0) {
    await holdPictures([...segments, cell], keep).catch(err => {
      console.warn('[image-paste] the replaced picture could not be held', err)
    })
  }
  EffectBus.emit<{ cell: string; segments: readonly string[] }>('tile:saved', { cell, segments })
  return true
}

export type SwappedImages = { replaced: boolean; held: number }

/**
 * Pictures dropped on a tile. The first blob is framed and worn the same way
 * a paste onto a selected tile is. The picture the tile wore stays in the
 * collection, and so does every other blob in the drop.
 */
export async function swapImagesOnTile(
  parent: readonly string[],
  label: string,
  blobs: readonly Blob[],
): Promise<SwappedImages> {
  if (blobs.length === 0) return { replaced: false, held: 0 }
  const replaced = await replaceWornPicture(parent, label, blobs[0])
  let held = 0
  if (blobs.length > 1) {
    const extra = await holdImagesOnTile(parent, label, blobs.slice(1))
    held = extra.added
  }
  return { replaced, held }
}

/** Say what a drop on a tile did. A worn picture that changed is the news;
 *  extra pictures in the same drop are mentioned only when nothing changed. */
export function announceSwappedImages(label: string, result: SwappedImages): void {
  if (result.replaced) {
    announceReplacedPicture(label, true)
    return
  }
  if (result.held > 0) {
    announceHeldImages(label, result.held)
    return
  }
  announceReplacedPicture(label, false)
}

/** Say what the hold did. `added` is what {@link holdImagesOnTile} returned. */
export function announceHeldImages(label: string, added: number): void {
  const tile = label.trim() || 'this tile'
  const message = added <= 0
    ? say('images.already', `Already held on "${tile}"`, { tile })
    : added === 1
      ? say('images.added.one', `Added a picture to "${tile}"`, { tile })
      : say('images.added.other', `Added ${added} pictures to "${tile}"`, { count: added, tile })
  EffectBus.emit('toast:show', { type: 'info', message })
}

/** Say that a paste replaced the picture a selected tile wears. */
export function announceReplacedPicture(label: string, replaced: boolean): void {
  const tile = label.trim() || 'this tile'
  const message = replaced
    ? say('images.replaced', `Replaced the picture on "${tile}"`, { tile })
    : say('images.wearing', `"${tile}" already wears that picture`, { tile })
  EffectBus.emit('toast:show', { type: 'info', message })
}

/** The first image on the system clipboard, or null. Call this inside the
 *  gesture (the right-click) so the browser still treats the read as one. */
export async function clipboardImage(): Promise<Blob | null> {
  try {
    const clip = navigator.clipboard
    if (!clip?.read) return null
    const items = await clip.read()
    for (const item of items) {
      const types = item.types as readonly string[]
      for (const mime of types) {
        if (!mime.startsWith('image/')) continue
        return await item.getType(mime)
      }
    }
  } catch {
    // Denied, empty, or a clipboard this browser will not read.
  }
  return null
}
