// hypercomb-essentials/src/move/press-liveness.ts
//
// A DRAG NEEDS A LIVE PRESS ON THE LEVEL IT WAS MADE ON.
//
// A press on a branch tile is spoken for the moment it lands: the overlay
// navigates on pointerdown and swallows the trailing pointerup at window
// capture, so the move input never hears the release. Left as it was, the
// next pointermove read the stale press as a button still held, crossed the
// drag threshold, and began a drag of the tile that had been pressed — on a
// page that was no longer there. No selection, a tile in hand nobody picked
// up, every press refused by arrange mode, and the old level's tiles painted
// under the new address: "glitchville until you escape".
//
// Two rules, both pure so they are one tested sentence each.

/** Is the primary button still held, as the event itself reports? An event
 *  with no `buttons` (a synthetic one) proves nothing and is taken as held. */
export const primaryStillDown = (buttons: number | undefined): boolean =>
  buttons === undefined ? true : (buttons & 1) === 1

/** Has the page moved out from under a drag? `dragAt` is the location the
 *  tiles in hand were painted for, `target` the location a render is now for.
 *  Unknown on either side is no evidence. */
export const dragOutlivesLocation = (dragAt: string | null, target: string | undefined): boolean =>
  dragAt !== null && typeof target === 'string' && target !== dragAt
