// diamondcoreprocessor.com/presentation/tiles/tree-icons.ts
//
// Tile images for the sideways tree, resolved lazily and shared aggressively.
//
// A tile's picture is two hops away from its layer: `properties[0]` is a
// resource sig holding the props blob, and `props.small.image` is a second
// resource sig holding the bytes. Two reads per node would be ruinous across
// a whole branch, so nothing is read until a node is actually on screen, and
// everything is cached by SIGNATURE — which means identical pictures across
// hundreds of tiles cost exactly one read and one object URL between them.
// That is the content-addressed store paying for itself.
//
// Every entry is tri-state on purpose: undefined = not looked at yet,
// null = looked at, genuinely has no image. Without that distinction a
// pictureless tile gets retried on every pass forever.

import { EffectBus } from '@hypercomb/core'
import { readThumbnail, type ThumbnailStore } from './thumbnails.js'

const SIG = /^[0-9a-f]{64}$/

export type IconStore = ThumbnailStore & {
  getResource(sig: string): Promise<Blob | null>
}

/** How many image resolutions may be in flight at once. Small: these are
 *  cold OPFS reads competing with the walk that is deepening the tree. */
const MAX_INFLIGHT = 8

export class TreeIconCache {
  /** props sig → image sig (null: props carry no image). */
  readonly #imageSigOf = new Map<string, string | null>()
  /** image sig → object URL (null: bytes unreadable). */
  readonly #urlOf = new Map<string, string | null>()
  readonly #inflight = new Set<string>()
  #disposed = false

  /** The icon for a props sig: a URL, null when there is none to be had,
   *  or undefined when nobody has looked yet. */
  iconFor(propsSig: string | undefined): string | null | undefined {
    if (!propsSig) return null
    const imageSig = this.#imageSigOf.get(propsSig)
    if (imageSig === undefined) return undefined
    if (imageSig === null) return null
    return this.#urlOf.get(imageSig)
  }

  /** True once this props sig has been settled either way — the loader uses
   *  it to skip nodes it has already answered. */
  settled(propsSig: string | undefined): boolean {
    if (!propsSig) return true
    const imageSig = this.#imageSigOf.get(propsSig)
    if (imageSig === undefined) return false
    if (imageSig === null) return true
    return this.#urlOf.get(imageSig) !== undefined
  }

  get busy(): number { return this.#inflight.size }
  get capacity(): number { return Math.max(0, MAX_INFLIGHT - this.#inflight.size) }

  /**
   * Resolve one tile's picture. Resolves to true when something NEW became
   * available, so the caller knows whether a repaint is worth doing.
   */
  async load(propsSig: string, store: IconStore): Promise<boolean> {
    if (this.#disposed || this.#inflight.has(propsSig)) return false
    if (this.settled(propsSig)) return false
    this.#inflight.add(propsSig)
    try {
      let imageSig: string | null | undefined = this.#imageSigOf.get(propsSig)
      if (imageSig === undefined) {
        imageSig = await this.#readImageSig(propsSig, store)
        if (this.#disposed) return false
        this.#imageSigOf.set(propsSig, imageSig)
      }
      if (imageSig === null) return true  // settled as "no picture"
      if (this.#urlOf.has(imageSig)) return false  // another tile already fetched it
      const url = await this.#readImage(imageSig, store)
      if (this.#disposed) {
        if (url) URL.revokeObjectURL(url)
        return false
      }
      this.#urlOf.set(imageSig, url)
      return true
    } catch {
      this.#imageSigOf.set(propsSig, null)
      return true
    } finally {
      this.#inflight.delete(propsSig)
    }
  }

  async #readImageSig(propsSig: string, store: IconStore): Promise<string | null> {
    const blob = await store.getResource(propsSig)
    if (!blob) return null
    const props = JSON.parse(await blob.text()) as { small?: { image?: unknown } }
    const sig = props?.small?.image
    return (typeof sig === 'string' && SIG.test(sig)) ? sig : null
  }

  /** Thumbnail first — a 96px webp instead of whatever the tile actually
   *  carries. On a miss we render the full picture (correct, just heavy) and
   *  ASK for a thumbnail; the optimize phase mints it, so the next time this
   *  branch is opened the whole viewport is cheap. */
  async #readImage(imageSig: string, store: IconStore): Promise<string | null> {
    const thumbnail = await readThumbnail(store, imageSig)
    if (thumbnail) return URL.createObjectURL(thumbnail)

    const blob = await store.getResource(imageSig)
    if (!blob || blob.size === 0) return null
    try { EffectBus.emit('thumbnail:wanted', { sig: imageSig }) } catch { /* non-fatal */ }
    return URL.createObjectURL(blob)
  }

  /** Object URLs are process-wide until revoked — a view that mounts and
   *  unmounts all session would leak every picture it ever showed. */
  dispose(): void {
    this.#disposed = true
    for (const url of this.#urlOf.values()) {
      if (url) { try { URL.revokeObjectURL(url) } catch { /* already gone */ } }
    }
    this.#urlOf.clear()
    this.#imageSigOf.clear()
    this.#inflight.clear()
  }
}

/** Point-top hexagon in objectBoundingBox units — the hive's own tile shape,
 *  so a node in the tree reads as the same object it is on the canvas. */
export const HEX_CLIP_POINTS = '0.5,0 1,0.25 1,0.75 0.5,1 0,0.75 0,0.25'

/**
 * Leaf silhouette in objectBoundingBox units: rounded at the base where it
 * meets the twig, tapering to a point at the outer tip. A tile with no
 * children IS the tip of the branch, so it gets the leaf rather than the
 * hexagon — the hex says "there is structure inside me", which a leaf, by
 * definition, does not have.
 */
export const LEAF_CLIP_PATH =
  'M0,0.5 C0,0.13 0.34,0 0.62,0.06 C0.85,0.11 1,0.3 1,0.5 ' +
  'C1,0.7 0.85,0.89 0.62,0.94 C0.34,1 0,0.87 0,0.5 Z'

/** Leaf outline of `size` across, centred on (cx,cy), tip pointing outward
 *  (to the right — the direction the branch is travelling). */
export function leafOutline(cx: number, cy: number, size: number): string {
  const w = size / 2
  const h = (size * 0.78) / 2   // leaves read better a little slimmer than tall
  const f = (n: number): string => (Math.round(n * 100) / 100).toString()
  return (
    `M${f(cx - w)},${f(cy)}` +
    `C${f(cx - w)},${f(cy - h * 0.74)} ${f(cx + w * 0.24)},${f(cy - h)} ${f(cx + w)},${f(cy)}` +
    `C${f(cx + w * 0.24)},${f(cy + h)} ${f(cx - w)},${f(cy + h * 0.74)} ${f(cx - w)},${f(cy)}Z`
  )
}

/** The midrib — one stroke from base to tip. Without it the shape reads as a
 *  blob; with it, unmistakably a leaf. */
export function leafMidrib(cx: number, cy: number, size: number): string {
  const w = size / 2
  const f = (n: number): string => (Math.round(n * 100) / 100).toString()
  return `M${f(cx - w * 0.86)},${f(cy)}L${f(cx + w * 0.82)},${f(cy)}`
}

/** Height of a drawn node's silhouette — hexes are tall, leaves are slim. */
export function nodeHeight(size: number, leaf: boolean): number {
  return leaf ? size * 0.78 : size * 1.1547
}

/** Outline path for a point-top hexagon of `size` across, centred on (cx,cy). */
export function hexOutline(cx: number, cy: number, size: number): string {
  const w = size / 2
  const h = (size * 1.1547) / 2   // pointy-top: height = width * 2/√3
  return (
    `M${cx},${cy - h}` +
    `L${cx + w},${cy - h / 2}` +
    `L${cx + w},${cy + h / 2}` +
    `L${cx},${cy + h}` +
    `L${cx - w},${cy + h / 2}` +
    `L${cx - w},${cy - h / 2}Z`
  )
}

/** Icon size by depth — the trunk reads heaviest without the marker radius
 *  needing to encode subtree size any more. */
export function iconSize(depth: number, leaf = false): number {
  // Leaves run a touch longer than a hex is wide — a leaf that fits a hex's
  // footprint looks stunted next to its siblings.
  if (leaf) return 24
  if (depth === 0) return 32
  if (depth === 1) return 26
  return 22
}
