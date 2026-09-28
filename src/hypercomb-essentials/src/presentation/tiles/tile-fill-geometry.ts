// tile-fill-geometry.ts — THE TILES AS THE GPU DRAWS THEM. A branch of the
// tile renderer (documentation/tile-renderer-tree.md): placed cells in, one
// quad per tile out, with every per-vertex attribute the hex shader reads —
// position, label and image UVs, identity and border colours, branch,
// divergence, unshared, readiness shade, launcher silhouette, portal. Pure:
// what a tile looks like right now comes from the renderer through the look
// (TileLook); nothing here holds or writes renderer state. fillKey says
// when a baked geometry no longer describes its cells.

import { Geometry } from 'pixi.js'

/** Axial (q, r) → pixel centre at spacing `s`, pointy-top or flat-top. */
export const axialToPixel = (q: number, r: number, s: number, flat = false): { x: number; y: number } => flat
  ? { x: 1.5 * s * q, y: Math.sqrt(3) * s * (r + q / 2) }
  : { x: Math.sqrt(3) * s * (q + r / 2), y: s * 1.5 * r }

/** Deterministic label → RGB via DJB2 hash → HSL → RGB. Returns [r, g, b] in 0–1 range. */
export function labelToRgb(label: string): [number, number, number] {
  let hash = 5381
  for (let i = 0; i < label.length; i++) hash = ((hash << 5) + hash + label.charCodeAt(i)) | 0
  hash = hash >>> 0

  const hue = (hash % 360) / 360
  const sat = 0.5
  const lit = 0.6

  const c = (1 - Math.abs(2 * lit - 1)) * sat
  const x = c * (1 - Math.abs(((hue * 6) % 2) - 1))
  const m = lit - c / 2
  let r = 0, g = 0, b = 0
  const sector = (hue * 6) | 0
  if (sector === 0)      { r = c; g = x; b = 0 }
  else if (sector === 1) { r = x; g = c; b = 0 }
  else if (sector === 2) { r = 0; g = c; b = x }
  else if (sector === 3) { r = 0; g = x; b = c }
  else if (sector === 4) { r = x; g = 0; b = c }
  else                   { r = c; g = 0; b = x }
  return [r + m, g + m, b + m]
}

/** Cold grey-blue for a tile that more than one participant holds, mixed into
 *  its own border while YOUR version is the one showing. It marks depth, not
 *  ownership — the moment you roll onto a participant the border takes that
 *  publisher's identity hue instead, so the two readings never overlap. */
const STACK_BORDER: [number, number, number] = [0.62, 0.68, 0.78]
/** How much of STACK_BORDER a stacked tile takes. Enough to read as "there is
 *  something under this one" across a page, well short of a state change — a
 *  tile you can roll is still an ordinary tile. */
const STACK_BORDER_MIX = 0.5

/** Map a launch group's shape id (from its `launch:target` decoration) to the
 *  shader's aShapeMode value: 0 = hexagon · 2 = Space Invader (games).
 *  Unknown / empty → hexagon, so a normal hive tile (no launch decoration) and
 *  any future group default to the plain shape.
 *  (Help tiles carry no shape — hexagons. RETIRED silhouettes fall through to
 *  hexagon here, no migration needed: 'keycap', and 'flower-pot' — the
 *  websites cloud, phased out; 2 stays put so games' decorations keep working.) */
function launchShapeToMode(shape: string): number {
  return shape === 'space-invader' ? 2 : 0
}

type UV = { u0: number; v0: number; u1: number; v1: number }

/** What the geometry reads of a placed cell. */
export type FillCell = {
  q: number
  r: number
  label: string
  external?: boolean
  plain?: boolean
  imageSig?: string
  hideText?: boolean
  heat?: number
  hasBranch?: boolean
  borderColor?: [number, number, number]
  divergence?: number
  unshared?: boolean
}

/** How each tile looks right now — the renderer answers. */
export interface TileLook {
  flat(): boolean
  pivot(): boolean
  /** This page is a launch-group aggregator: launcher silhouettes apply. */
  onLauncherPage(): boolean
  /** The hidden-name tile under the pointer, which shows its name. */
  revealLabel(): string | null
  hasImage(sig: string): boolean
  imageUV(sig: string): UV | null
  /** The label's UV; `ownPage` allows the pending-name stand-in for a tile still being added. */
  labelUV(label: string, ownPage: boolean): UV
  hidesName(hideText: boolean | undefined, hasImage: boolean): boolean
  /** Greyed: hidden and show-hidden is on, or a switched-off launcher member. */
  isHiddenItem(label: string): boolean
  isDormant(label: string): boolean
  peerPubkey(label: string): string | undefined
  spotlight(): string | null
  stackDepth(label: string): number
  shadeValue(cell: FillCell): number
  isShaded(cell: FillCell): boolean
  isPortal(label: string): boolean
  shapeOf(label: string): string
}

export type FillBuffers = {
  pos: Float32Array; labelUV: Float32Array; imageUV: Float32Array; hasImage: Float32Array; heat: Float32Array
  identityColor: Float32Array; branch: Float32Array; borderColor: Float32Array; divergence: Float32Array; shaded: Float32Array
}

/** A built geometry, the buffers behind it (for in-place updates), the tiles
 *  baked shaded, and each tile's launcher silhouette. */
export type FillGeometry = {
  geometry: Geometry
  buffers: FillBuffers
  shadedLabels: string[]
  shapeModes: [string, number][]
}

export function fillKey(cells: readonly FillCell[], look: TileLook): string {
// NO ATLAS EVICTION GENERATIONS IN HERE. Baked UVs do go stale when an
// atlas slot is wiped or reused, and that still forces a rebuild — but the
// signal lives in #bakedImageAtlasGen / #bakedLabelAtlasGen, checked
// separately by applyGeometry. This key describes the CELLS, and it is
// recomputed by paths that only touched one attribute
// (#repaintReadinessInPlace, #tryInPlaceCellUpdate); a generation folded in
// here is a rebake those paths can mark as done without doing it, which is
// how tiles ended up with a label band and no name inside it. Keep them apart.
let s = `p${look.pivot() ? 1 : 0}f${look.flat() ? 1 : 0}|`
// Fold in whether each cell's image is CURRENTLY resolvable in the
// atlas. The sig alone is not enough: an image that arrives late (host
// fill, back-nav refill, eviction reload) lands in a FRESH slot, which
// bumps no eviction generation — without this bit the key stays
// identical and applyGeometry skips the rebuild, leaving hasImage=0
// baked in the buffer forever (tile renders label-only although the
// atlas holds its image).
for (const c of cells) {
  const ia = c.imageSig && look.hasImage(c.imageSig) ? 1 : 0
  const pf = look.isPortal(c.label) ? 1 : 0
  // Readiness-shade bit: shade can flip with an UNCHANGED imageSig/ia
  // (fill concluded empty → #fillMissedSigs, decode failure) — folding
  // it in lets the next natural repaint rebake the released shade.
  const sh = look.isShaded(c) ? 1 : 0
  // Dormant-launcher bit: a roster flip changes a tile's face with every
  // other field unchanged, so without it the dim would never be baked.
  const dm = look.isDormant(c.label) ? 1 : 0
  s += `${c.q},${c.r}:${c.label}:${c.external ? 1 : 0}:${c.imageSig ?? ''}:${ia}:${c.hasBranch ? 1 : 0}:${c.divergence ?? 0}:${c.hideText ? 1 : 0}:${c.unshared ? 1 : 0}:${pf}:${sh}:${dm}|`
}
return s
}


/** `foreign` — the cells belong to ANOTHER layer (a dive): read nothing
 *  location-scoped for them (selection, shade, peers, hidden dimming,
 *  launcher shapes, the page's hover) and overwrite none of the page's
 *  buffer bookkeeping; portals and the hover-reveal come from the caller. */
export function buildFillQuad(
cells: readonly FillCell[], r: number, gap: number, hw: number, hh: number,
look: TileLook,
foreign?: { portals: ReadonlySet<string>; reveal: string | null },
): FillGeometry {
  const spacing = r + gap

  // Launcher silhouettes exist ONLY on launch-group aggregator pages. The
  // shape index is keyed by label alone, and a hive tile can share a label
  // with a launcher cell (the root tile "susan" vs the websites launcher
  // "susan") — resolving shapes off `agg-` pages leaked the group theme
  // onto normal hive tiles. Gate here, the one place aShapeMode is baked.
  const onLauncherPage = !foreign && look.onLauncherPage()
  const revealLabel = foreign ? foreign.reveal : look.revealLabel()

  const pos = new Float32Array(cells.length * 8)
  const uv = new Float32Array(cells.length * 8)
  const labelUV = new Float32Array(cells.length * 16)
  const imageUV = new Float32Array(cells.length * 16)
  const hasImage = new Float32Array(cells.length * 4)
  const heat = new Float32Array(cells.length * 4)
  const identityColor = new Float32Array(cells.length * 12)
  const branch = new Float32Array(cells.length * 4)
  const borderColor = new Float32Array(cells.length * 12)
  const cellIndex = new Float32Array(cells.length * 4)
  const divergence = new Float32Array(cells.length * 4)
  const unshared = new Float32Array(cells.length * 4)
  // Readiness shade — 1 while the cell's bytes are still arriving (see
  // #cellIsShaded). Brightening is an attribute flip on the heal repaint,
  // never a geometry change, so nothing moves when a tile becomes ready.
  const shaded = new Float32Array(cells.length * 4)
  // Per-tile launcher silhouette (0 hex · 2 invader; 1 retired) — lets a
  // mixed launch-group page render each group's own shape without sharing.
  const shapeAttr = new Float32Array(cells.length * 4)
  // Per-tile portal flag — a reference tile (doorway to another lineage) gets
  // the magical hover shimmer instead of the plain pathway/leaf ring.
  const portal = new Float32Array(cells.length * 4)
  const idx = new Uint32Array(cells.length * 6)

  let pv = 0, uvp = 0, luvp = 0, iuvp = 0, hip = 0, hp = 0, icp = 0, bp = 0, bcp = 0, cip = 0, dp = 0, ii = 0, base = 0, sap = 0, pp = 0
  let ci = 0

  const shadedLabels: string[] = []
  const shapeModes: [string, number][] = []

  for (const c of cells) {
    const { x, y } = axialToPixel(c.q, c.r, spacing, look.flat())

    const x0 = x - hw, x1 = x + hw
    const y0 = y - hh, y1 = y + hh

    pos.set([x0, y0, x1, y0, x1, y1, x0, y1], pv)
    pv += 8

    uv.set([0, 0, 1, 0, 1, 1, 0, 1], uvp)
    uvp += 8

    const imgUV = c.plain ? null : (c.imageSig ? look.imageUV(c.imageSig) : null)

    // label UV: collapse to [0,0,0,0] when hideText + image present so the
    // shader samples a transparent corner and the label is effectively
    // hidden. The hovered tile is exempt — it reveals its name — so a
    // rebuild mid-hover does not blink the text back off, and TEXT-ONLY mode
    // exempts every tile (#hidesName): with no image drawn there is nothing
    // to hide behind, so a hidden name comes back for as long as the mode is on.
    const ruv = (look.hidesName(c.hideText, !!imgUV) && c.label !== revealLabel)
      ? { u0: 0, v0: 0, u1: 0, v1: 0 }
      : look.labelUV(c.label, !foreign)
    for (let i = 0; i < 4; i++) {
      labelUV.set([ruv.u0, ruv.v0, ruv.u1, ruv.v1], luvp)
      luvp += 4
    }

    const hi = imgUV ? 1 : 0
    for (let i = 0; i < 4; i++) {
      imageUV.set(imgUV ? [imgUV.u0, imgUV.v0, imgUV.u1, imgUV.v1] : [0, 0, 0, 0], iuvp)
      iuvp += 4
    }
    hasImage.set([hi, hi, hi, hi], hip)
    hip += 4

    const h = c.heat ?? 0
    heat.set([h, h, h, h], hp)
    hp += 4

    let [cr, cg, cb] = labelToRgb(c.label)
    // gray out hidden items when show-hidden is active — and a switched-off
    // launcher member always (it is never filtered, so this is its face)
    const isHiddenItem = !foreign && look.isHiddenItem(c.label)
    if (isHiddenItem) {
      const gray = cr * 0.3 + cg * 0.3 + cb * 0.3
      cr = gray * 0.5; cg = gray * 0.5; cb = gray * 0.5
    }
    identityColor.set([cr, cg, cb, cr, cg, cb, cr, cg, cb, cr, cg, cb], icp)
    icp += 12

    const b = c.hasBranch ? 1 : 0
    branch.set([b, b, b, b], bp)
    bp += 4

    let [bcr, bcg, bcb] = c.borderColor ?? [0.784, 0.592, 0.353]
    if (isHiddenItem) {
      const bgray = bcr * 0.3 + bcg * 0.3 + bcb * 0.3
      bcr = bgray * 0.5; bcg = bgray * 0.5; bcb = bgray * 0.5
    }
    // Group accent for peer tiles — every peer-contributed tile gets
    // the publisher's deterministic pubkey-derived color as its
    // border, ALWAYS (not just in spotlight mode). Each contributor
    // is visually identifiable at a glance: Alice's tiles glow one
    // hue, Bob's another. Same labelToRgb hash used for label-based
    // identity colors, just keyed on pubkey — uniform "identity
    // color" architecture across own tiles and peer groups.
    //
    // Spotlight emphasis: when a peer's layer is surfaced via the
    // layer-cycle strip / alt+scroll, their tiles render at full
    // brightness; other peer groups dim slightly so the active layer
    // pops without losing the rest. Own tiles keep their normal
    // borderColor (label or substrate-derived).
    const cellPubkey = foreign ? undefined : look.peerPubkey(c.label)
    if (cellPubkey) {
      const spotlight = look.spotlight()
      const [pr, pg, pb] = labelToRgb(cellPubkey)
      const brightness = spotlight === null
        ? 0.85                                          // no spotlight — all groups at uniform group brightness
        : (spotlight === cellPubkey ? 1.0   // this peer is active — full intensity
          : 0.45)                                       // other peer — recede so the active group pops
      bcr = pr * brightness
      bcg = pg * brightness
      bcb = pb * brightness
    } else if (!foreign && look.stackDepth(c.label) > 1) {
      // Yours is the version showing, but other participants hold
      // this tile too. Mark the depth on the border so a stacked tile
      // is findable without hovering every hex — this is the whole
      // affordance for the wheel roll, and an unmarked stack is a
      // feature nobody discovers.
      const m = STACK_BORDER_MIX
      bcr = bcr * (1 - m) + STACK_BORDER[0] * m
      bcg = bcg * (1 - m) + STACK_BORDER[1] * m
      bcb = bcb * (1 - m) + STACK_BORDER[2] * m
    }
    borderColor.set([bcr, bcg, bcb, bcr, bcg, bcb, bcr, bcg, bcb, bcr, bcg, bcb], bcp)
    bcp += 12

    cellIndex.set([ci, ci, ci, ci], cip)
    cip += 4
    ci++

    const dv = c.divergence ?? 0
    divergence.set([dv, dv, dv, dv], dp)
    // A switched-off launcher member wears the same dim as an unshared tile:
    // present, plainly not lit, still pressable (its unhide is the way back).
    const us = c.unshared || (!foreign && look.isDormant(c.label)) ? 1 : 0
    unshared.set([us, us, us, us], dp)
    // Continuous 0..1 — a tile mid-fade keeps its current fade value across a
    // geometry rebuild, so a repaint that happens to land during the fade
    // never snaps it to full.
    const sh = foreign ? 0 : look.shadeValue(c)
    shaded.set([sh, sh, sh, sh], dp)
    if (!foreign && look.isShaded(c)) shadedLabels.push(c.label)
    dp += 4

    // Per-tile launcher silhouette. Only launcher tiles carry a launch:target
    // `shape`; everything else resolves to 0 (hexagon).
    const sm = !onLauncherPage ? 0 : launchShapeToMode(look.shapeOf(c.label))
    shapeModes.push([c.label, sm])
    shapeAttr.set([sm, sm, sm, sm], sap)
    sap += 4

    // Reference/portal tiles hover with the magical shimmer (see hex-sdf
    // fragment). referenceTargetForLabel returns the target segments (or null
    // for a non-reference) from the same decoration index the click path uses.
    const pv2 = (foreign ? foreign.portals.has(c.label) : look.isPortal(c.label)) ? 1 : 0
    portal.set([pv2, pv2, pv2, pv2], pp)
    pp += 4

    idx.set([base, base + 1, base + 2, base, base + 2, base + 3], ii)
    ii += 6
    base += 4
  }

  const g = new Geometry()
    ; (g as any).addAttribute('aPosition', pos, 2)
    ; (g as any).addAttribute('aUV', uv, 2)
    ; (g as any).addAttribute('aLabelUV', labelUV, 4)
    ; (g as any).addAttribute('aImageUV', imageUV, 4)
    ; (g as any).addAttribute('aHasImage', hasImage, 1)
    ; (g as any).addAttribute('aHeat', heat, 1)
    ; (g as any).addAttribute('aIdentityColor', identityColor, 3)
    ; (g as any).addAttribute('aHasBranch', branch, 1)
    ; (g as any).addAttribute('aBorderColor', borderColor, 3)
    ; (g as any).addAttribute('aCellIndex', cellIndex, 1)
    ; (g as any).addAttribute('aDivergence', divergence, 1)
    ; (g as any).addAttribute('aUnshared', unshared, 1)
    ; (g as any).addAttribute('aShaded', shaded, 1)
    ; (g as any).addAttribute('aShapeMode', shapeAttr, 1)
    ; (g as any).addAttribute('aIsPortal', portal, 1)
    ; (g as any).addIndex(idx)

  // The buffer references + label→index map let tile:saved push in-place
  // attribute updates to the GPU without rebuilding geometry; the renderer
  // keeps them for its own page, never for a dive (see FillGeometry).
  return {
    geometry: g,
    buffers: { pos, labelUV, imageUV, hasImage, heat, identityColor, branch, borderColor, divergence, shaded },
    shadedLabels,
    shapeModes,
  }
}
