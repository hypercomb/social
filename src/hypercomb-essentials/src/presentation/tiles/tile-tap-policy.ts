/**
 * A tile body tap uses the close-up whenever either the concrete press was a
 * finger or the shared platform service says the whole surface is mobile.
 *
 * Pointer type alone misses phone styluses and the `/mobile on` accessibility
 * override. Platform alone misses coarse touch surfaces that deliberately keep
 * the desktop layout. Keeping the decision pure also prevents pointerdown and
 * click from drifting back into different navigation contracts.
 */
export const usesTileCloseUp = (touch: boolean, mobile: boolean): boolean =>
  touch || mobile

export type TilePressCapture = {
  generation: number
  axial: { q: number; r: number }
  label: string
}

type OccupiedTile = { label: string; index: number }
export type ResolvedTilePress = { q: number; r: number; index: number }

/** A click without a captured tile (notably a press on empty canvas) must be
 *  hit-tested from its own coordinates even if hover state still names an old
 *  tile. A resolved press is already the stronger binding. */
export const clickNeedsCoordinateHitTest = (
  press: TilePressCapture | null,
  currentAxial: { q: number; r: number } | null,
  currentIndex: number | undefined,
): boolean => press === null || currentAxial === null || currentIndex === undefined

/** Resolve a click from the tile captured on pointerdown, never from stale
 *  hover state. Phones commonly dispatch no pointermove between taps. When a
 *  render rebuilt the coordinate map mid-gesture, follow the captured label
 *  to its new coordinate; otherwise require the exact captured coordinate to
 *  still contain the same tile. */
export const resolveTilePress = (
  press: TilePressCapture,
  currentGeneration: number,
  occupiedByAxial: ReadonlyMap<string, OccupiedTile>,
): ResolvedTilePress | null => {
  if (press.generation === currentGeneration) {
    const occupied = occupiedByAxial.get(`${press.axial.q},${press.axial.r}`)
    return occupied?.label === press.label
      ? { q: press.axial.q, r: press.axial.r, index: occupied.index }
      : null
  }

  for (const [key, occupied] of occupiedByAxial) {
    if (occupied.label !== press.label) continue
    const [q, r] = key.split(',').map(Number)
    if (!Number.isFinite(q) || !Number.isFinite(r)) return null
    return { q, r, index: occupied.index }
  }
  return null
}
