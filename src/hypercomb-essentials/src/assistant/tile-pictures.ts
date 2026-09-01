// assistant/tile-pictures.ts
//
// A TILE'S PICTURE, FOR SURFACES THAT CANNOT GO AND GET IT.
//
// The rail resolves its own square icons: props sig → the tile's picture
// candidates → the 96px thumbnail pool, falling back to the original and
// asking the optimize phase to mint the thumbnail for next time. That walk
// needs `tilePictureCandidates` and `readThumbnail`, both of which live in
// essentials — and the chat window, which is shell UI, may never import a
// module.
//
// So the walk is published instead. The window drags a tile out of the rail,
// gets a props signature in the payload, and asks here for something it can
// put in an <img>. One cache for the whole document: a picture asked for by
// three surfaces is read once, and a tile with no picture is asked once and
// then remembered as pictureless.

import { EffectBus } from '@hypercomb/core'
import { readThumbnail, type ThumbnailStore } from '../presentation/tiles/thumbnails.js'
import { tilePictureCandidates } from '../editor/tile-properties.js'

type PictureStore = ThumbnailStore & { getResource(sig: string): Promise<Blob | null> }

const ioc = <T,>(key: string): T | undefined =>
  (window as unknown as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

/** propsSig → object URL, or null for "looked, and there is no picture". */
const cache = new Map<string, string | null>()
/** In-flight reads, so three surfaces asking at once cost one walk. */
const inFlight = new Map<string, Promise<string | null>>()

const read = async (propsSig: string): Promise<string | null> => {
  const store = ioc<PictureStore>('@hypercomb.social/Store')
  if (!store?.getResource) return null
  try {
    const blob = await store.getResource(propsSig)
    if (!blob) return null
    const props = JSON.parse(await blob.text()) as unknown
    // First candidate whose BYTES are actually here — a tile can name an
    // original that stayed with its publisher, and a broken square is worse
    // than the next candidate down.
    for (const sig of tilePictureCandidates(props)) {
      const thumbnail = await readThumbnail(store, sig)
      if (thumbnail) return URL.createObjectURL(thumbnail)
      const bytes = await store.getResource(sig)
      if (bytes && bytes.size > 0) {
        try { EffectBus.emit('thumbnail:wanted', { sig }) } catch { /* non-fatal */ }
        return URL.createObjectURL(bytes)
      }
    }
    return null
  } catch { return null }
}

/** Something to put in an <img>, or null when the tile has no picture. */
export const tilePictureUrl = async (propsSig: string): Promise<string | null> => {
  const key = String(propsSig ?? '')
  if (!key) return null
  const known = cache.get(key)
  if (known !== undefined) return known
  const pending = inFlight.get(key) ?? read(key).then(url => {
    cache.set(key, url)
    inFlight.delete(key)
    return url
  })
  inFlight.set(key, pending)
  return pending
}

// ── the seam to the shell ──────────────────────────────────────────────
export class TilePictures {
  readonly urlFor = tilePictureUrl
}

export const TILE_PICTURES_IOC_KEY = '@diamondcoreprocessor.com/TilePictures'

window.ioc.register(TILE_PICTURES_IOC_KEY, new TilePictures())
