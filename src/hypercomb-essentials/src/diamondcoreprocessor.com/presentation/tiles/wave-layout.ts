// diamondcoreprocessor.com/presentation/tiles/wave-layout.ts
//
// The dive's pure decisions, kept out of the drone so they can be tested
// without a renderer (the same split stage-centering.ts uses):
//
//   - which image signature a tile's props blob actually points at
//   - how far down the wheel is allowed to take you
//
// No pixi, no IoC, no I/O — every function here is a pure mapping.

export type Axial = { q: number; r: number }

const SIG = /^[a-f0-9]{64}$/i

/**
 * The image signature a tile's properties blob points at.
 *
 * The renderer writes the tile image at `small.image` (`flat.small.image`
 * for flat-top orientation) — NOT at a top-level `imageSig`, which is only
 * accepted as a defensive last resort. Reading the wrong key is why dived
 * tiles first came up as labelled hexes while the very same tiles clearly
 * showed their picture on the mesh.
 */
export const waveImageSigFromProps = (props: unknown): string | undefined => {
  const p = props as {
    small?: { image?: unknown }
    flat?: { small?: { image?: unknown } }
    imageSig?: unknown
  } | null
  const candidate = p?.small?.image ?? p?.flat?.small?.image ?? p?.imageSig
  return typeof candidate === 'string' && SIG.test(candidate) ? candidate : undefined
}

/**
 * Whether this tile asks for its name to be SUPPRESSED over its image.
 *
 * The mesh superimposes the label on every tile and drops it only for tiles
 * explicitly marked `hideText` that actually have an image to speak for
 * themselves. A dive has to follow the same rule: dropping the name whenever
 * an image existed left a grid of pictures with nothing saying what any of
 * them were.
 */
export const waveHideTextFromProps = (props: unknown): boolean =>
  (props as { hideText?: unknown } | null)?.hideText === true

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
