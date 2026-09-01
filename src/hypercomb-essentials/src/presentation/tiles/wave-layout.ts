// presentation/tiles/wave-layout.ts
//
// The dive's pure decisions, kept out of the drone so they can be tested
// without a renderer (the same split stage-centering.ts uses):
//
//   - how far down the wheel is allowed to take you
//   - what a click on a dived tile DOES — where it travels, and where the
//     surface it may open should come back out
//   - the rim colour a tile's properties ask for (the renderer's own parse)
//
// No pixi, no IoC, no I/O — every function here is a pure mapping. The
// picture a tile shows is NOT decided here: that is `recoverableTileImageSig`
// in editor/tile-properties.ts, the very function the page's renderer reads,
// so a dive can never disagree with the page about what a tile looks like.

import type { ViewSpawn } from './view-spawn.js'

export type Axial = { q: number; r: number }

/**
 * How deep the wheel is allowed to go, judged from one walk.
 *
 * The walk stops at the generation currently on screen, so the deepest level
 * it WALKED always equals the current depth — reading availability from that
 * alone clamped every wheel-down straight back and the dive could never leave
 * the first generation. What actually settles it is whether the walk finished
 * holding children it never spent: unspent children mean there is one more
 * level below this one, which is all the wheel needs to take another step.
 */
export const depthAvailableFrom = (deepestWalked: number, hasUnspentFrontier: boolean): number =>
  Math.max(deepestWalked + (hasUnspentFrontier ? 1 : 0), 1)

/**
 * The generation the wheel settles on.
 *
 * Bounded below by the first generation (there is no diving above a tile's
 * own children) and above by the ground the subject actually has — asking
 * for a fifth generation under a tile two deep settles on the second rather
 * than showing an empty dive. `hardMax` is the feature's own ceiling, so a
 * pathologically deep tree can't be wheeled into forever.
 */
export const clampDepth = (requested: number, available: number, hardMax: number): number => {
  const ceiling = Math.max(1, Math.min(available, hardMax))
  return Math.min(Math.max(1, requested), ceiling)
}

/** The surface token that means "no view — plain hexagons". */
const HEXAGONS = 'hexagons'

/** What a click on a dived tile does. */
export type DiveClickPlan = {
  /** `reference` — the tile is a portal and the click travels THROUGH it;
   *  `enter` — the tile is entered, exactly as a click on the page would. */
  kind: 'reference' | 'enter'
  /** Where the explorer goes. */
  travel: readonly string[]
  /** The spawn record to announce BEFORE travelling, when the destination
   *  opens as a view: closing that view then lands back on the page the dive
   *  was made from, in the surface that was up — never on the tile's own
   *  page, which the participant never chose to stand on. Null when the
   *  destination opens as plain hexagons (nothing to come back out of). */
  spawn: ViewSpawn | null
}

/**
 * EXECUTE A DIVED TILE AS IF IT STOOD IN FRONT OF YOU.
 *
 * A dive shows a deeper generation without moving, so a click on one of its
 * tiles must do what the real tile would do — route a portal to its target,
 * enter anything else — while keeping the page the dive was made from as the
 * place you come back to. That second half is what makes the dive a way to
 * "go and activate something and stay": the view the destination opens
 * (its arrival face — own mark or the nearest ancestor's) is told it was
 * spawned from `from`, in `mode`, so its exit returns there.
 *
 * A portal travels and spawns nothing: its target is a real place the
 * participant chose, and whatever face THAT page opens as is that page's own
 * business, as it is for any portal hop.
 */
export const diveClickPlan = (input: {
  /** Full path of the dived tile. */
  segments: readonly string[]
  /** The portal's target when the tile is a reference, else null. */
  referenceTarget: readonly string[] | null
  /** The view the destination opens as ('' or 'hexagons' = plain tiles). */
  arrivalView: string
  /** The page the dive was made from. */
  from: readonly string[]
  /** The surface that was up when the dive was made ('' = hexagons). */
  mode: string
}): DiveClickPlan => {
  if (input.referenceTarget !== null) {
    return { kind: 'reference', travel: [...input.referenceTarget], spawn: null }
  }
  const view = String(input.arrivalView ?? '').trim()
  const opensAsView = view !== '' && view !== HEXAGONS
  return {
    kind: 'enter',
    travel: [...input.segments],
    spawn: opensAsView
      ? { view, mode: String(input.mode ?? '').trim(), segments: [...input.from] }
      : null,
  }
}

/**
 * The rim colour a tile's properties ask for, as the renderer reads it:
 * `border.color`, a six-digit hex with or without its `#`, to 0..1 RGB.
 * Anything else means "the default rim" — never a guess.
 */
export const borderColorFromProps = (props: unknown): [number, number, number] | undefined => {
  const raw = (props as { border?: { color?: unknown } } | null)?.border?.color
  if (typeof raw !== 'string') return undefined
  const hex = raw.replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return undefined
  return [
    parseInt(hex.slice(0, 2), 16) / 255,
    parseInt(hex.slice(2, 4), 16) / 255,
    parseInt(hex.slice(4, 6), 16) / 255,
  ]
}
