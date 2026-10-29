// editor/diagram/layout.ts
//
// THE DESK'S ARITHMETIC, with nothing to measure. The shell hands in numbers
// (the root width, the font sizes, the desk box) and gets back one answer:
// wide or narrow, which list, how big the stage is, where it sits. Pure, so the
// same numbers the live page uses can be pinned in a spec.
//
// The wide/narrow decision is taken from the ROOT width less the shell's left
// strip, in em of the desk — never from the desk's own width and never from the
// previous layout. Narrow hides that strip, which would change the desk's own
// width at exactly the threshold and make the layout flip-flop.

import type { TileModel } from '../models/tile-model.js'

// px at 100% text; each is multiplied by U = em / 16
export const CARD = 232
export const CARD_COMPACT = 208
export const TAB = 208
export const TAB_COMPACT = 150
export const GAP = 28
export const MARGIN = 8
export const HEAD = 32
export const TOOL = 44
export const GAP_TOOL = 22
/** The specimen stays a specimen. Larger desks get margin, not a bigger tile,
 *  so the labels, the toolbar and the floating tools row all stay on screen. */
export const MAX_STAGE = 440
export const MIN_STAGE = 320
/** The undocked tools row floats on the desk and is not part of
 *  `--hc-controls-bottom`. The drawing keeps this much clear of the viewport
 *  edge, above and below, so a label never sits under that row. */
const FLOOR_EM = 4.5

/** Desk widths (in em) where the list gives ground and where wide stops. */
export const RAIL_FULL_EM = 82.5
export const RAIL_MID_EM = 68.75
export const WIDE_EM = 56.25
const RAIL_EM = { full: 14.5, mid: 11.5, faces: 3.7 } as const
const HEADER_EM = 2.75
const STRIP_REM = 3.5

export interface LayoutInput {
  readonly rootWidth: number
  readonly rootRem: number
  readonly em: number
  readonly desk: { w: number; h: number }
  readonly model: TileModel
  readonly variant: string
  /** The list's real width when the shell has measured it (a list can refuse to
   *  shrink to its nominal width); absent = the nominal width for its mode. */
  readonly listWidth?: number
  /** Narrow only: the window height the sticky figure is sized from (default: the desk's). */
  readonly innerHeight?: number
}

export interface LayoutOut {
  readonly layout: 'wide' | 'narrow'
  readonly list: 'full' | 'mid' | 'faces'
  /** Stage side, px. */
  readonly size: number
  readonly compact: boolean
  /** Closed tab width and open card width, px (already scaled by the unit). */
  readonly tab: number
  readonly card: number
  /** Wide: where the stage square sits in the centre region. Narrow: 0, 0. */
  readonly figure: { left: number; top: number }
  // handed on so the placement pass needs nothing else
  readonly unit: number
  /** The centre region the stage, tabs and leaders live in. */
  readonly viewport: { readonly width: number; readonly height: number }
  /** x-extent of the widest the model can be at this size, over all its variants. */
  readonly extent: { readonly min: number; readonly max: number }
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

const variantIds = (model: TileModel, variant: string): string[] =>
  model.variants.length ? model.variants.map(v => v.id) : [variant]

/** The fraction of the stage the outline leaves bare on its left, smallest over
 *  every variant: the gutters can start that far inside the stage. */
const bareRatio = (model: TileModel, variant: string): number =>
  Math.min(...variantIds(model, variant).map(id => model.geometry(1000, id).extent.min / 1000))

/** Union of the outline extent over every variant, so tabs never move when the variant turns. */
export const unionExtent = (model: TileModel, size: number, variant: string): { min: number; max: number } => {
  const ex = variantIds(model, variant).map(id => model.geometry(size, id).extent)
  return { min: Math.min(...ex.map(e => e.min)), max: Math.max(...ex.map(e => e.max)) }
}

export function layoutFor(i: LayoutInput): LayoutOut {
  const em = i.em > 0 ? i.em : 16
  const U = em / 16
  const dw = i.rootWidth - STRIP_REM * i.rootRem           // WITH the strip, whatever was chosen last time
  const dwEm = dw / em
  const list: LayoutOut['list'] = dwEm >= RAIL_FULL_EM ? 'full' : dwEm >= RAIL_MID_EM ? 'mid' : 'faces'
  const wideDesk = dwEm >= WIDE_EM
  const listPx = i.listWidth ?? RAIL_EM[list] * em
  const vpw = dw - (wideDesk ? listPx : 0)
  const compact = vpw < 1000 * U
  const card = (compact ? CARD_COMPACT : CARD) * U
  const tab = (compact ? TAB_COMPACT : TAB) * U
  const vph = i.desk.h - HEADER_EM * em
  const r = bareRatio(i.model, i.variant)
  // Wide enough for a card on each side; an open card never changes it (cards float over the gutters).
  // Short enough that the same margin stands above the top label and below the toolbar.
  const byWidth = (vpw - 2 * (card + (GAP + MARGIN) * U)) / (1 - 2 * r)
  const chrome = (TOOL + GAP_TOOL) * U
  const keep = Math.max(40 * U, HEAD * U, FLOOR_EM * em)
  const byHeight = vph - chrome - 2 * keep
  const wide = Math.round(Math.min(byHeight, byWidth, MAX_STAGE * U))
  const isWide = wideDesk && wide >= MIN_STAGE * U

  if (!isWide) {
    const room = i.innerHeight ?? i.desk.h
    const size = Math.round(clamp(Math.min(i.rootWidth - 48 * U, room * 0.3), 200 * U, 280 * U))
    return {
      layout: 'narrow', list, size, compact: false, tab, card,
      figure: { left: 0, top: 0 }, unit: U,
      viewport: { width: i.desk.w, height: i.desk.h },
      extent: unionExtent(i.model, size, i.variant),
    }
  }
  const size = wide
  const left = Math.round((vpw - size) / 2)
  const top = Math.round(Math.max(40 * U, (vph - size - TOOL * U - GAP_TOOL * U) / 2))
  return {
    layout: 'wide', list, size, compact, tab, card,
    figure: { left, top }, unit: U,
    viewport: { width: vpw, height: vph },
    extent: unionExtent(i.model, size, i.variant),
  }
}
