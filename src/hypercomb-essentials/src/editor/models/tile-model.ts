// editor/models/tile-model.ts
//
// THE MODEL THE EDITOR DRAWS. The editor's centre is not a hexagon: it is a
// MODEL — a silhouette, the PARTS of it that can be edited, and the tile fields
// each part edits. The hexagon is the first model; any other shape of anything
// is one more descriptor file. The shell, the lighting, the callouts, group mode
// and the lists know only parts and field kinds, never a vertex, an apothem or
// an angle: all of that lives in the one model file that owns the shape.
//
// TYPES ONLY. Nothing in this file may name a shape.

/** The tile fields a part can edit. */
export type FieldKey =
  | 'border.color' | 'background.color' | 'picture' | 'title' | 'hideText' | 'link' | 'orientation'

/** What KIND of thing a field is — the shell's table maps key to kind, and the
 *  kind of a part's primary field decides what a click on the drawn part does. */
export type FieldKind = 'colour' | 'toggle' | 'text' | 'link' | 'image' | 'variant'

export interface Pt { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
export type FrameRect = Rect & { cx: number; cy: number }

/** A discrete way the same model can be turned (the hexagon: point-top and
 *  flat-top). None or one entry means the model has no Shape part. */
export interface ModelVariant { readonly id: string; readonly labelKey: string; readonly label: string }

/** Everything the shell reads about one model at one size. Pure data and pure
 *  functions, in stage pixels. A model may carry private extras (the hexagon
 *  carries its vertices); the shell never reads them. */
export interface ModelGeometry {
  /** Stage side in px; the stage is a square. */
  readonly size: number
  readonly variant: string
  /** Centre. */
  readonly c: Pt
  /** The model's own length: type size, hit slop and vignette scale from it. */
  readonly unit: number
  /** Farthest outline point from c (the vignette radius). */
  readonly reach: number
  /** SVG path: the silhouette, and the centreline of the rim. */
  readonly outline: string
  /** SVG path: what the PICTURE is clipped with (usually the outline). */
  readonly mask: string
  /** True: the picture goes on outside the mask, fading into the ground.
   *  False: it is hard-clipped. */
  readonly fade: boolean
  /** The picture frame and capture box: framing maths is relative to it. */
  readonly box: FrameRect
  /** Outline x-extent: where the callout gutters start. */
  readonly extent: { readonly min: number; readonly max: number }
  /** Stroke centred on the outline, clipped inside. */
  readonly rimWidth: number
  readonly glowInset: number
  readonly glowWidth: number
  /** Where a name sits, drawn clipped to the outline. */
  readonly band: Rect | null
  /** Where the ONE in-place name input sits. */
  readonly nameBox: { cx: number; cy: number; w: number; h: number } | null
  /** Name type size in px. */
  readonly nameFont: number
  /** '346 x 400': the size of the bytes a save writes; '' = unknown (not shown). */
  readonly capture: string
  inside(p: Pt): boolean
  insideMask(p: Pt): boolean
  /** Unsigned distance to the outline. */
  edgeDistance(p: Pt): number
  /** That path moved outward by `by` px (negative = inward). */
  offset(by: number, which?: 'outline' | 'mask'): string
  /** The other variant's outline, for the Shape part. */
  readonly ghostPath: string | null
  ghostInside(p: Pt): boolean
  ghostEdgeDistance(p: Pt): number
  /** Can the ground behind the picture be seen? */
  groundShows(picture: Rect | null, group: boolean): boolean
  /** Evenodd path of where the ground shows. */
  groundPath(picture: Rect | null): string
}

export interface PartContext {
  /** The framed picture rect in stage px; null: none, or a group. */
  readonly picture: Rect | null
  /** === geometry.groundShows(picture, group). */
  readonly fillLive: boolean
  readonly showName: boolean
  readonly group: boolean
}

/** What a lit part draws, as data: band = a wash stroke, edge = a line, halo =
 *  the surface under a line, fill = a wash, hatch = where the ground shows. */
export type LitKind = 'band' | 'edge' | 'halo' | 'fill' | 'hatch'
export interface LitItem {
  d: string
  kind: LitKind
  w?: number
  dash?: boolean
  faint?: boolean
  rule?: 'evenodd'
  clip?: 'in' | 'out' | 'mask' | 'mask+pic'
}

export interface ModelPart<G extends ModelGeometry = ModelGeometry> {
  /** The model's own word for it ('rim', 'fill', ...); the shell never compares one. */
  readonly id: string
  readonly labelKey: string
  /** English stand-in; a model may name its parts ("Name plate", "Chimney link"). */
  readonly label: string
  /** What it edits. The FIRST is the primary field: its KIND decides what a
   *  click on the drawn part does. */
  readonly fields: readonly FieldKey[]
  /** Preferred leader column. */
  readonly side: 'left' | 'right'
  /** Hit priority, highest first. */
  readonly z: number
  /** Draw the capture box and its size while this part is lit. */
  readonly showsCapture?: boolean
  /** Where the leader ends (stage px). */
  anchor(g: G, c: PartContext): Pt
  /** PURE, stage px: the only hit-testing there is. */
  hit(p: Pt, g: G, c: PartContext): boolean
  /** What lights, as data. */
  lit(g: G, c: PartContext): LitItem[]
}

export interface TileModel<G extends ModelGeometry = ModelGeometry> {
  readonly id: string
  readonly labelKey: string
  /** Shown in the quiet model tag. */
  readonly label: string
  readonly variants: readonly ModelVariant[]
  readonly defaultVariant: string
  geometry(size: number, variant: string): G
  /** Order = Tab order and DOM order of the callouts. */
  readonly parts: readonly ModelPart<G>[]
  /** Hive-lattice offsets for the "in the hive" chip; absent = the lone silhouette. */
  neighbours?(g: G): readonly Pt[]
}
