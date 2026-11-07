// presentation/tiles/lift-deck.ts
//
// THE LIFT DECK — the read model behind the lift view (lift-view.drone.ts).
//
// Superimposition (documentation/superimposition.md) says two trees at the
// same address ARE the same tree: a participant's version of a page is a
// LAYER over yours, and so is any earlier version of your own. The lift view
// stacks those layers behind the page like a slide deck. This module is
// everything about that stack that is not pixels: which tiles every layer
// agrees on, which ones differ, which ones a layer lacks, the variants of one
// tile across the deck, and the parts a participant has staged to apply.
//
// DIFF BY NAME, NEVER BY SIGNATURE. A tile's name is its identity; its layer
// signature changes with every edit anywhere beneath it (version ripple), so
// two layers that show the same picture under the same name agree, whatever
// their sigs say. What differs is the PICTURE: that is what the eye compares.
//
// Pure: no DOM, no three, no IoC. Every function here is exercised by
// lift-deck.spec.ts.

/** The view-mode token the lift view renders under. */
export const LIFT_VIEW = 'lift'

export type DeckSource = 'current' | 'participant' | 'history'

/** One tile in one layer: where it sits (axial), what it shows. */
export interface DeckCell {
  readonly name: string
  readonly q: number
  readonly r: number
  readonly imageSig?: string
  /** The tile's own layer signature in this layer, when known. */
  readonly layerSig?: string
  /** The slot index the layer seats the tile at, when known. */
  readonly index?: number
}

/** One layer of the deck: the page as drawn, a participant's version of it,
 *  or an earlier version from the page's history. */
export interface DeckLayer {
  /** Stable across rebuilds: `current`, `participant:<pubkey>`, `history:<layerSig>`. */
  readonly id: string
  readonly source: DeckSource
  readonly label: string
  readonly pubkey?: string
  /** When the layer was written (history layers). */
  readonly at?: number
  /** The PAGE's layer signature (history layers). */
  readonly layerSig?: string
  readonly cells: ReadonlyMap<string, DeckCell>
}

/** How a tile reads across the deck:
 *  - `common`: every layer holds it, with the same picture;
 *  - `changed`: every layer holds it, the picture differs somewhere;
 *  - `partial`: at least one layer lacks it. */
export type DeckMark = 'common' | 'changed' | 'partial'

export interface DeckMarks {
  readonly marks: ReadonlyMap<string, DeckMark>
  /** Per layer (same order as the deck): the FRONT layer's names this layer
   *  lacks — drawn as ghost outlines, so absence says where. */
  readonly ghosts: readonly (readonly string[])[]
}

export const currentLayerId = (): string => 'current'
export const participantLayerId = (pubkey: string): string => `participant:${pubkey}`
export const historyLayerId = (layerSig: string): string => `history:${layerSig}`

/** Mark every tile name across the deck, and list each layer's ghosts. */
export function markDeck(layers: readonly DeckLayer[]): DeckMarks {
  const marks = new Map<string, DeckMark>()
  const names: string[] = []
  const seen = new Set<string>()
  for (const layer of layers) {
    for (const name of layer.cells.keys()) {
      if (seen.has(name)) continue
      seen.add(name)
      names.push(name)
    }
  }
  for (const name of names) {
    let present = 0
    const pictures = new Set<string>()
    for (const layer of layers) {
      const cell = layer.cells.get(name)
      if (!cell) continue
      present++
      pictures.add(cell.imageSig ?? '')
    }
    marks.set(name, present < layers.length ? 'partial' : pictures.size > 1 ? 'changed' : 'common')
  }
  const front = layers[0]
  const ghosts = layers.map((layer, index) => index === 0 || !front
    ? []
    : [...front.cells.keys()].filter(name => !layer.cells.has(name)))
  return { marks, ghosts }
}

/** One version of one tile, as the deck holds it. */
export interface DeckVariant {
  readonly layerIndex: number
  readonly layerId: string
  readonly source: DeckSource
  readonly label: string
  readonly pubkey?: string
  readonly at?: number
  readonly cell: DeckCell
}

/** Every distinct version of `name` across the deck, front first. Two layers
 *  holding the same picture under the same tile layer are one variant (the
 *  first, i.e. the frontmost, stands for both). */
export function variantsFor(name: string, layers: readonly DeckLayer[]): DeckVariant[] {
  const out: DeckVariant[] = []
  const seen = new Set<string>()
  layers.forEach((layer, layerIndex) => {
    const cell = layer.cells.get(name)
    if (!cell) return
    const key = `${cell.imageSig ?? ''}|${cell.layerSig ?? ''}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({
      layerIndex,
      layerId: layer.id,
      source: layer.source,
      label: layer.label,
      ...(layer.pubkey ? { pubkey: layer.pubkey } : {}),
      ...(layer.at !== undefined ? { at: layer.at } : {}),
      cell,
    })
  })
  return out
}

/** Step through one tile's variants. Wraps — toggling parts is a ring, so
 *  rolling past the last version comes back to yours. -1 when there is
 *  nothing to roll. */
export function rollVariant(current: number, delta: number, variants: readonly unknown[]): number {
  const count = variants.length
  if (count === 0) return -1
  const at = Number.isInteger(current) && current >= 0 && current < count ? current : 0
  const step = Math.trunc(delta)
  return ((at + step) % count + count) % count
}

/** Flip the whole deck. Clamped — the deck has a front and a back, and a
 *  wheel that wrapped would throw the oldest layer at you from the front. */
export function flipDeck(current: number, delta: number, count: number): number {
  if (count <= 0) return 0
  const next = Math.trunc(current) + Math.trunc(delta)
  return Math.min(count - 1, Math.max(0, next))
}

// ── composition ─────────────────────────────────────────────────────────

/** Which variant a tile is staged to take. Held by layer id (stable across a
 *  rebuild), plus what it pointed at, so a variant that changed under it can
 *  be detected rather than silently applied. */
export interface VariantRef {
  readonly layerId: string
  readonly source: DeckSource
  readonly pubkey?: string
  readonly at?: number
  readonly imageSig?: string
  readonly layerSig?: string
}

/** Per-tile staged variants, by tile name. Nothing here is truth: it is what
 *  Apply would write, and nothing is written until Apply. */
export type Composition = ReadonlyMap<string, VariantRef>

export const EMPTY_COMPOSITION: Composition = new Map()

export const refOf = (variant: DeckVariant): VariantRef => ({
  layerId: variant.layerId,
  source: variant.source,
  ...(variant.pubkey ? { pubkey: variant.pubkey } : {}),
  ...(variant.at !== undefined ? { at: variant.at } : {}),
  ...(variant.cell.imageSig ? { imageSig: variant.cell.imageSig } : {}),
  ...(variant.cell.layerSig ? { layerSig: variant.cell.layerSig } : {}),
})

/** Stage `variant` for `name`. Staging the CURRENT version is staging
 *  nothing — the entry is cleared, so rolling back round to yours undoes. */
export function stageVariant(composition: Composition, name: string, variant: DeckVariant): Composition {
  const next = new Map(composition)
  if (variant.source === 'current') next.delete(name)
  else next.set(name, refOf(variant))
  return next
}

/** Clear one tile's staging, or all of it. */
export function clearStaged(composition: Composition, name?: string): Composition {
  if (name === undefined) return EMPTY_COMPOSITION
  if (!composition.has(name)) return composition
  const next = new Map(composition)
  next.delete(name)
  return next
}

/** Keep only what the rebuilt deck still offers: a staged variant whose
 *  layer left, or whose version moved under it, is dropped rather than
 *  applied blind. */
export function reconcileComposition(composition: Composition, layers: readonly DeckLayer[]): Composition {
  if (composition.size === 0) return composition
  const byId = new Map(layers.map(layer => [layer.id, layer]))
  const next = new Map<string, VariantRef>()
  for (const [name, ref] of composition) {
    const cell = byId.get(ref.layerId)?.cells.get(name)
    if (!cell) continue
    if ((cell.imageSig ?? '') !== (ref.imageSig ?? '')) continue
    if ((cell.layerSig ?? '') !== (ref.layerSig ?? '')) continue
    next.set(name, ref)
  }
  return next.size === composition.size ? composition : next
}

/** The index of the staged variant among `variants` (0 = front when nothing
 *  is staged, or the staged one is no longer offered). */
export function stagedIndex(ref: VariantRef | undefined, variants: readonly DeckVariant[]): number {
  if (!ref) return 0
  const at = variants.findIndex(v => v.layerId === ref.layerId)
  return at < 0 ? 0 : at
}

/** One write Apply would make for a staged tile. Plans only — the drone
 *  carries them out through the hive's existing doors. */
export type CompositionWrite =
  | { readonly kind: 'adopt'; readonly name: string; readonly pubkey: string; readonly layerSig: string }
  | { readonly kind: 'promote'; readonly name: string; readonly layerSig: string }

/** The writes a composition asks for, in name order. A staged variant with
 *  no tile layer signature cannot be written (there is nothing to adopt or
 *  promote) and is left out. */
export function compositionWrites(composition: Composition): CompositionWrite[] {
  const out: CompositionWrite[] = []
  for (const name of [...composition.keys()].sort()) {
    const ref = composition.get(name)!
    if (!ref.layerSig) continue
    if (ref.source === 'participant' && ref.pubkey) {
      out.push({ kind: 'adopt', name, pubkey: ref.pubkey, layerSig: ref.layerSig })
    } else if (ref.source === 'history') {
      out.push({ kind: 'promote', name, layerSig: ref.layerSig })
    }
  }
  return out
}

/** What applying a whole-layer flip means: a participant's layer is a VIEW
 *  (the spotlight, as the 2D roll); a history layer is promoted to head; the
 *  current layer asks for nothing. */
export type LayerApply =
  | { readonly kind: 'none' }
  | { readonly kind: 'spotlight'; readonly pubkey: string }
  | { readonly kind: 'promote'; readonly layerSig: string }

export function layerApply(layer: DeckLayer | undefined): LayerApply {
  if (!layer || layer.source === 'current') return { kind: 'none' }
  if (layer.source === 'participant' && layer.pubkey) return { kind: 'spotlight', pubkey: layer.pubkey }
  if (layer.source === 'history' && layer.layerSig) return { kind: 'promote', layerSig: layer.layerSig }
  return { kind: 'none' }
}

// ── seats ───────────────────────────────────────────────────────────────

/** Seat every name of a layer: the page's own `order` claim first, then the
 *  tile's legacy `properties.index`, then the next free slot in list order.
 *  Two names never share a seat — a later claimant of a taken seat moves to
 *  the next free one, the way a page lays out a collision. */
export function seatNames(
  names: readonly string[],
  order: ReadonlyMap<string, number>,
  legacyIndex: ReadonlyMap<string, number> = new Map(),
): Map<string, number> {
  const seats = new Map<string, number>()
  const taken = new Set<number>()
  const isSeat = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0
  const pending: string[] = []
  for (const name of names) {
    const claim = order.get(name) ?? legacyIndex.get(name)
    if (isSeat(claim) && !taken.has(claim)) {
      seats.set(name, claim)
      taken.add(claim)
    } else {
      pending.push(name)
    }
  }
  let next = 0
  for (const name of pending) {
    while (taken.has(next)) next++
    seats.set(name, next)
    taken.add(next)
  }
  return seats
}

// ── geometry ────────────────────────────────────────────────────────────

/** Axial (q,r) → the hive's pixel centre. The SAME numbers show-cell uses
 *  (show-cell.drone.ts `axialToPixel`), so the lifted page lands exactly
 *  where the 2D page drew it. `spacing` = circumradius + gap. Pixel y grows
 *  downward, as on the canvas. */
export function axialToPixel(q: number, r: number, spacing: number, flat = false): { x: number; y: number } {
  return flat
    ? { x: 1.5 * spacing * q, y: Math.sqrt(3) * spacing * (r + q / 2) }
    : { x: Math.sqrt(3) * spacing * (q + r / 2), y: spacing * 1.5 * r }
}

/** The six corners of a hexagon of circumradius `radius`, y UP. Point-top has
 *  a corner straight up; flat-top has an edge on top. */
export function hexCorners(radius: number, flat = false): Array<{ x: number; y: number }> {
  const start = flat ? 0 : 90
  return Array.from({ length: 6 }, (_, k) => {
    const a = ((start + 60 * k) * Math.PI) / 180
    return { x: radius * Math.cos(a), y: radius * Math.sin(a) }
  })
}

/** The hexagon's bounding box — the box the hive's hex capture (`small.image`)
 *  is taken at, so mapping it to the unit square lands the capture exactly. */
export function hexBox(radius: number, flat = false): { width: number; height: number } {
  return flat
    ? { width: 2 * radius, height: Math.sqrt(3) * radius }
    : { width: Math.sqrt(3) * radius, height: 2 * radius }
}

/** A point inside the hexagon → its UV in the hex box (0..1, v up). */
export function hexUv(x: number, y: number, radius: number, flat = false): { u: number; v: number } {
  const box = hexBox(radius, flat)
  return { u: x / box.width + 0.5, v: y / box.height + 0.5 }
}

/** Cover-fit a picture of `imageAspect` (w/h) into the hex box: the share of
 *  the texture each axis spans, and where that span starts. A capture taken
 *  at the hex box's own aspect spans the whole texture. */
export function coverFit(imageAspect: number, radius: number, flat = false): {
  repeat: { u: number; v: number }; offset: { u: number; v: number }
} {
  const box = hexBox(radius, flat)
  const boxAspect = box.width / box.height
  const aspect = Number.isFinite(imageAspect) && imageAspect > 0 ? imageAspect : boxAspect
  const u = aspect > boxAspect ? boxAspect / aspect : 1
  const v = aspect > boxAspect ? 1 : aspect / boxAspect
  return { repeat: { u, v }, offset: { u: (1 - u) / 2, v: (1 - v) / 2 } }
}

// ── pictures ────────────────────────────────────────────────────────────

const SIG = /^[0-9a-f]{64}$/

/** Every picture a tile's props name, best first for the orientation: its
 *  hex capture (`small.image`, or `flat.small.image` flat-top), the other
 *  orientation's capture, the whole picture (`large.image`), the legacy
 *  `imageSig`. A tile can name a picture whose bytes it does not hold, so a
 *  reader walks this list until one decodes (editor/tile-properties.ts
 *  `recoverableTileImageSig` is its first entry). */
export function pictureCandidates(props: unknown, flat = false): string[] {
  const p = (props ?? {}) as {
    small?: { image?: unknown }; large?: { image?: unknown }
    flat?: { small?: { image?: unknown } }; imageSig?: unknown
  }
  const ordered = flat
    ? [p.flat?.small?.image, p.small?.image, p.large?.image, p.imageSig]
    : [p.small?.image, p.flat?.small?.image, p.large?.image, p.imageSig]
  const out: string[] = []
  for (const sig of ordered) {
    if (typeof sig === 'string' && SIG.test(sig) && !out.includes(sig)) out.push(sig)
  }
  return out
}

// ── words ───────────────────────────────────────────────────────────────

/** "2 h ago"-style age, coarse on purpose — a deck card, not a log line. */
export function agoLabel(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return `${days} d ago`
}

/** A participant's key, short enough for a label. */
export const shortKey = (pubkey: string): string =>
  pubkey.length > 12 ? `${pubkey.slice(0, 6)}…${pubkey.slice(-4)}` : pubkey
