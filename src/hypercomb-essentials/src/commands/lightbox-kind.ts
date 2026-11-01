// commands/lightbox-kind.ts
//
// THE LIGHTBOX'S NAMES AND ITS PICTURES — the gallery kind, the picture
// relation, the view, and every picture a tile holds. The /lightbox word and
// the view that renders it both read these, and a bee is never imported for
// a value (atomic-modules-plan.md), so they live here, in a dependency both
// import.

import { listDecorations, writeDecoration, removeDecoration, removeDecorationAndWait } from './decoration-manifest.js'
import { mintContentRef, terminalContentSig } from '../presentation/tiles/artifact-content.js'
import { readTilePropertiesAt, tilePictureCandidates } from '../editor/tile-properties.js'
import { childNamesOfStrict, resolveLayerAt, type PlacementHistory, type PlacementLayer } from '../history/layer-placement.js'

const SIG = /^[0-9a-f]{64}$/

const get = <T,>(key: string): T | undefined => (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

/** Pictures held on a tile — the lightbox's own content, and a source for any
 *  view that renders a set this tile is enrolled in. Payload:
 *  `{ images: [ref, …] }`, where each ref is a Life Primitive content hop. */
export const GALLERY_KIND = 'visual:lightbox:gallery'

/** The slot a picture's incidence is held in. Distinct from a slide's, so the
 *  same bytes used both ways mint two envelopes rather than colliding. */
export const PICTURE_RELATION = 'picture'

/** The ViewMode surface this behaviour renders on. Matches the kind's own
 *  `visual:<view>:<noun>` middle segment — the vocabulary the command line's
 *  `name@lightbox` and the Beehaviors panel both read. */
export const LIGHTBOX_VIEW = 'lightbox'

/**
 * Every picture held on a tile, RESOLVED to the signature of its bytes.
 *
 * The payload declares a Life Primitive hop — a meta envelope under the current
 * model, a raw resource signature under the retired one — and this seam follows
 * it, so every caller gets the same thing it always got. That matters because
 * `Store.getResource` does NOT follow the hop: a consumer handed an envelope
 * signature would fetch the envelope's JSON and try to paint it as a picture.
 * Resolving once, here, is what keeps the full-screen lightbox and the images
 * chooser both correct without either learning about incidences.
 *
 * An envelope whose target is not held locally resolves to itself, which is the
 * honest answer — the caller's own fetch cascade is what can still reach it, and
 * `fetchThroughContentHop` is how it should.
 */
export async function galleryImageSigsAt(segments: readonly string[]): Promise<string[]> {
  const out: string[] = []
  const store = get<{ getResourceLocal?(sig: string): Promise<Blob | null> }>('@hypercomb.social/Store')
  try {
    const decorations = await listDecorations<{ images?: unknown }>({
      kind: GALLERY_KIND,
      segments,
    })
    for (const { record } of decorations) {
      const images = record.payload?.images
      if (!Array.isArray(images)) continue
      for (const value of images) {
        const ref = String(value)
        if (!SIG.test(ref)) continue
        const imageSig = store?.getResourceLocal
          ? (await terminalContentSig(store as { getResourceLocal(s: string): Promise<Blob | null> }, ref)) ?? ref
          : ref
        if (!out.includes(imageSig)) out.push(imageSig)
      }
    }
  } catch { /* no readable gallery at this location */ }
  return out
}

/**
 * Hold pictures on a tile — the ONE way a picture joins a tile's collection.
 *
 * Each byte signature is minted into a typed incidence (the Life Primitive hop,
 * never raw bytes in a payload field) and merged into the tile's single gallery
 * decoration, which is REPLACED by the merged record. Pictures already held are
 * kept, so adding a picture never loses the ones before it. Returns the refs now
 * held. `/lightbox add`, the tile editor's save and the images wall's pool pick
 * all come through here, so a tile's pictures are retained however they arrived.
 */
export async function holdPictures(
  segments: readonly string[],
  bytesSigs: readonly string[],
): Promise<string[]> {
  const store = get<{ putResource(blob: Blob): Promise<string> }>('@hypercomb.social/Store')
  if (!store || segments.length === 0) return []
  const added: string[] = []
  for (const bytesSig of bytesSigs) {
    if (!SIG.test(bytesSig)) continue
    const ref = await mintContentRef(store, bytesSig, PICTURE_RELATION)
    if (SIG.test(ref) && !added.includes(ref)) added.push(ref)
  }
  if (added.length === 0) return []

  // Serialise the read-merge-write per tile, so overlapping holds see each
  // other's record and the old ones are removed only after the new one lands.
  return withGalleryLock(segments.join('\u0000'), async () => {
    const existing = await listDecorations<{ images?: unknown }>({ kind: GALLERY_KIND, segments })
    const kept: string[] = []
    for (const { record } of existing) {
      const imgs = record.payload?.images
      if (!Array.isArray(imgs)) continue
      for (const value of imgs) {
        const ref = String(value)
        if (SIG.test(ref) && !kept.includes(ref)) kept.push(ref)
      }
    }
    const images = [...kept, ...added.filter(ref => !kept.includes(ref))]
    if (images.length === kept.length) return images        // already held — no new revision

    await writeDecoration({ kind: GALLERY_KIND, appliesTo: segments, segments, payload: { images }, mark: 'persistent' })
    for (const e of existing) removeDecoration({ sig: e.sig, segments })
    return images
  })
}

// One chain per tile; the entry is dropped once it is the tail, so the map
// stays bounded. A failed hold never wedges the tile.
const galleryChains = new Map<string, Promise<unknown>>()

const withGalleryLock = <T,>(key: string, task: () => Promise<T>): Promise<T> => {
  const prior = galleryChains.get(key) ?? Promise.resolve()
  const result = prior.then(task, task)
  const tail = result.catch(() => {})
  galleryChains.set(key, tail)
  void tail.then(() => { if (galleryChains.get(key) === tail) galleryChains.delete(key) })
  return result
}

// ── forgetting a latent picture ─────────────────────────────────────────

export type ForgetPreview = {
  /** Size of the bytes when held locally; null when unknown. */
  size: number | null
  /** Forgetting would also delete the bytes: nothing else names them. */
  bytesGo: boolean
  /** The tile wears it: forgetting is refused. */
  worn: boolean
  /** The tile's gallery holds it. */
  held: boolean
}

export type ForgetResult = {
  /** The reference left this tile's gallery. */
  removed: boolean
  bytesRemoved: boolean
  reason?: 'not-held' | 'worn' | 'unavailable'
  bytesKept?: 'shared' | 'unverified'
}

type ForgetStore = {
  getResourceLocal(sig: string): Promise<Blob | null>
  getResource?(sig: string): Promise<Blob | null>
}
type ForgetHistory = PlacementHistory & {
  referencesOutside?(locationSig: string, candidates: readonly string[]): Promise<{ found: Set<string>; authoritative: boolean }>
  removeContentSigs?(sigs: readonly string[]): Promise<number>
}

const wornBy = async (store: ForgetStore, segments: readonly string[], target: string): Promise<boolean> => {
  const props = await readTilePropertiesAt(segments.slice(0, -1), segments[segments.length - 1])
    .catch(() => ({} as Record<string, unknown>))
  for (const worn of tilePictureCandidates(props)) {
    if (worn === target || ((await terminalContentSig(store, worn)) ?? worn) === target) return true
  }
  return false
}

const galleryView = async (store: ForgetStore, segments: readonly string[], target: string) => {
  const existing = await listDecorations<{ images?: unknown }>({ kind: GALLERY_KIND, segments })
  const kept: string[] = []
  const dropped: string[] = []
  for (const { record } of existing) {
    const imgs = record.payload?.images
    if (!Array.isArray(imgs)) continue
    for (const value of imgs) {
      const ref = String(value)
      if (!SIG.test(ref)) continue
      if (ref === target || ((await terminalContentSig(store, ref)) ?? ref) === target) { if (!dropped.includes(ref)) dropped.push(ref) }
      else if (!kept.includes(ref)) kept.push(ref)
    }
  }
  return { existing, kept, dropped }
}

/** What the confirmation should promise for this picture: its size, and
 *  whether forgetting also deletes the bytes (nothing else names them). */
export async function forgetPreview(segments: readonly string[], imageSig: string): Promise<ForgetPreview> {
  const target = String(imageSig ?? '').toLowerCase()
  const store = get<ForgetStore>('@hypercomb.social/Store')
  const history = get<ForgetHistory>('@diamondcoreprocessor.com/HistoryService')
  if (!store || !history || segments.length === 0 || !SIG.test(target)) return { size: null, bytesGo: false, worn: false, held: false }
  const size = (await store.getResourceLocal(target).catch(() => null))?.size ?? null
  if (await wornBy(store, segments, target)) return { size, bytesGo: false, worn: true, held: true }
  const view = await galleryView(store, segments, target)
  if (view.dropped.length === 0) return { size, bytesGo: false, worn: false, held: false }
  const names = new Set<string>([target, ...view.dropped])
  const skip = new Set(view.existing.map(e => e.sig))
  return { size, bytesGo: size !== null && await unreferenced(history, store, names, target, skip), worn: false, held: true }
}

/**
 * Forget one latent picture of a tile - permanent.
 *
 * Removes the picture's reference from THIS tile's gallery (the one persistent
 * gallery decoration, rewritten as `holdPictures` writes it). The bytes go too
 * whenever nothing live still names them:
 * not this tile's worn picture (refused outright), no other tile's properties
 * or decorations (other galleries included), and no pool member. Any doubt (an
 * unreadable layer, an incomplete walk) keeps the bytes. Removal of bytes goes
 * through HistoryService.removeContentSigs, the sanctioned store delete.
 * Never touches another tile's gallery.
 */
export async function forgetPicture(
  segments: readonly string[],
  imageSig: string,
): Promise<ForgetResult> {
  const target = String(imageSig ?? '').toLowerCase()
  const store = get<ForgetStore>('@hypercomb.social/Store')
  const history = get<ForgetHistory>('@diamondcoreprocessor.com/HistoryService')
  if (!store || !history || segments.length === 0 || !SIG.test(target)) {
    return { removed: false, bytesRemoved: false, reason: 'unavailable' }
  }

  return withGalleryLock(segments.join('\u0000'), async () => {
    // 1. Never the worn picture.
    if (await wornBy(store, segments, target)) return { removed: false, bytesRemoved: false, reason: 'worn' }

    // 2. Rewrite the gallery without the reference(s) that resolve to these bytes.
    const { existing, kept, dropped } = await galleryView(store, segments, target)
    if (dropped.length === 0) return { removed: false, bytesRemoved: false, reason: 'not-held' }

    if (kept.length > 0) {
      await writeDecoration({ kind: GALLERY_KIND, appliesTo: segments, segments, payload: { images: kept }, mark: 'persistent' })
    }
    for (const e of existing) await removeDecorationAndWait({ sig: e.sig, segments })

    // 3. Bytes: only when nothing live still names them.
    const keep = (bytesKept: ForgetResult['bytesKept']): ForgetResult => ({ removed: true, bytesRemoved: false, bytesKept })
    const names = new Set<string>([target, ...dropped])
    if (!(await unreferenced(history, store, names, target, new Set()))) return keep('shared')
    if (!history.removeContentSigs) return keep('unverified')
    const gone = await history.removeContentSigs([...names])
    return gone > 0 ? { removed: true, bytesRemoved: true } : keep('unverified')
  })
}

/** True only when the walk was complete AND nothing live names these bytes. */
async function unreferenced(
  history: ForgetHistory,
  store: ForgetStore,
  names: ReadonlySet<string>,
  target: string,
  skipDecorations: ReadonlySet<string>,
): Promise<boolean> {
  // Pools (clipboard, comfy, substrate references): the history walk.
  if (!history.referencesOutside) return false
  const pools = await history.referencesOutside('', [...names]).catch(() => null)
  if (!pools || !pools.authoritative || pools.found.size > 0) return false

  // Live tiles: every layer reachable from the root, its properties and its
  // decorations. A cold layer makes the answer incomplete, so keep.
  const lineage = get<{ domain?: unknown }>('@hypercomb.social/Lineage')
  const root = await resolveLayerAt(history, lineage?.domain, []).catch(() => null)
  if (!root) return false
  const verdict = new Map<string, boolean>()
  const namesBytes = async (hex: string): Promise<boolean> => {
    if (names.has(hex)) return true
    let v = verdict.get(hex)
    if (v === undefined) { v = (await terminalContentSig(store as never, hex).catch(() => null)) === target; verdict.set(hex, v) }
    return v
  }
  const scan = async (text: string): Promise<boolean> => {
    for (const m of text.matchAll(/[0-9a-f]{64}/gi)) if (await namesBytes(m[0].toLowerCase())) return true
    return false
  }
  // Children are resolved by NAME to their live heads (a deep edit leaves a
  // parent's stored child sigs stale), never by the sigs the parent lists.
  const stack: { layer: PlacementLayer; at: string[] }[] = [{ layer: root, at: [] }]
  while (stack.length) {
    const { layer, at } = stack.pop()!
    const sigsIn = (slot: string): string[] =>
      Array.isArray(layer[slot]) ? (layer[slot] as unknown[]).map(String).filter(s => SIG.test(s)) : []
    for (const resourceSig of [...sigsIn('properties').slice(0, 1), ...sigsIn('decorations').filter(d => !skipDecorations.has(d))]) {
      const blob = await store.getResource?.(resourceSig).catch(() => null)
      if (!blob) return false
      if (await scan(await blob.text())) return false
    }
    const kids = await childNamesOfStrict(history, layer)
    if (kids.coldMiss) return false
    for (const name of kids.names) {
      const next = await resolveLayerAt(history, lineage?.domain, [...at, name]).catch(() => null)
      if (!next) return false
      stack.push({ layer: next, at: [...at, name] })
    }
  }
  return true
}
