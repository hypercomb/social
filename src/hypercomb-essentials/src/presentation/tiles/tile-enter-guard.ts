// hypercomb-essentials/src/presentation/tiles/tile-enter-guard.ts
//
// THE QUESTION BEFORE A TILE IS ENTERED: do the labels on screen belong to the
// level the address says we are on?
//
// Entering appends a segment. A label read off the level being LEFT (the render
// for the new level has not landed, or a repaint of the old one arrived late)
// appends a phantom segment — /people → /people/people → … — and every further
// press deepens it. The maps are painted FOR a location (render:cell-count
// stamps it), so the only honest test is to compare that stamp with the live
// address. Pure so the rule is one tested sentence, not a branch in a drone.

/** What the overlay knows about the maps it holds:
 *   undefined — no render has said (an older emitter): no opinion, enter.
 *   null      — a render said the location is not known yet: wait for the next.
 *   string    — the location the maps were painted for. */
export type MapsLocation = string | null | undefined

export type EntryVerdict = 'enter' | 'defer' | 'drop'

/** enter: the maps are current. defer: they cannot be judged yet — queue the
 *  press with the location it was made at. drop: they are for another level. */
export const judgeEntry = (maps: MapsLocation, live: string): EntryVerdict => {
  if (maps === undefined) return 'enter'
  if (maps === null) return 'defer'
  return maps === live ? 'enter' : 'drop'
}

/** A press queued while the maps could not be trusted. It carries WHERE it was
 *  made: a press aimed at one level must never be replayed on another that
 *  happens to have a tile of the same name. */
export interface PendingEnter { readonly label: string; readonly at: string }

export const pendingStillValid = (pending: PendingEnter, live: string): boolean =>
  pending.at === live
