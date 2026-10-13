// presentation/tiles/unindexed-seating.ts
//
// WHERE A TILE WITHOUT A SLOT OF ITS OWN SITS THIS PASS.
//
// A pinned page seats its tiles in three waves (show-cell #orderByIndexPinned):
// the hive's own tiles at their persisted indexes, then peers' tiles at the
// index their publisher gave them when that slot is free, then the PILE — every
// tile left without a slot (no index, or a slot someone else holds). The pile
// is seated here.
//
// A pile tile seated by an earlier pass keeps that seat: the session remembers
// it (a display decision, never persisted), so pans, peer churn and repaints
// never move it. EVERY REMEMBERED SEAT IS TAKEN BACK BEFORE ANY NEW SEAT IS
// PICKED. Seated in one alphabetical sweep, a tile that had lost its seat (an
// own tile claimed its index, or it is a peer's new tile) was given the best
// free slot — which is exactly the seat the tile after it remembered; that one
// was then given the next one's, and so on down the pile. At a meeting of a
// thousand peer tiles every peer's new tile reshuffled the page and paid one
// whole-grid score per displaced tile: about half a second of main thread per
// render pass, with the participant's own create waiting behind it (SCALE-1).

/**
 * Seat every tile of `pile` (in pile order) in `sparse`, which is mutated: a
 * tile whose `remembered` seat is in range and free takes it back; only the
 * rest ask `pick` for a free slot (-1 = the grid is full: the tile is not
 * seated this pass), and that seat is remembered. Returns `name→slot` for each
 * tile seated, for the layout diagnosis line.
 */
export function seatUnindexed(
  sparse: string[],
  pile: readonly string[],
  maxSlot: number,
  remembered: Map<string, number>,
  pick: (sparse: readonly string[]) => number,
): string[] {
  const seated: string[] = []
  const unseated: string[] = []
  for (const name of pile) {
    const slot = remembered.get(name)
    if (typeof slot === 'number' && slot >= 0 && slot <= maxSlot && sparse[slot] === '') {
      sparse[slot] = name
      seated.push(`${name}→${slot}`)
    } else {
      unseated.push(name)
    }
  }
  for (const name of unseated) {
    const slot = pick(sparse)
    if (slot < 0) continue
    sparse[slot] = name
    seated.push(`${name}→${slot}`)
    remembered.set(name, slot)
  }
  return seated
}
