// setup/visitor-cover.ts
//
// WHICH RENDER PASS LIFTS A HEXAGON DOOR'S LOADING COVER (setup/arrival-cover.ts).
//
// A door that opens as hexagons keeps its cover until its own tiles land, or
// until its own location is genuinely settled-empty. The cover subscribes to
// `render:cell-count` once the arrival verdict is in, and EffectBus hands a
// new subscriber the LAST pass at once. That pass need not be the door's: the
// visit starts on the empty hive root, and when show-cell holds the door's
// paint for the verdict — or the verdict simply lands before the door's first
// pass — the last pass is the root's, and taking it lifted the cover over a
// grid that had not painted yet.
//
// show-cell stamps each pass with the place it painted (`locationKey`, the
// Lineage's explorerLabel: '/' + the segments joined by '/'), and view.bee's
// verdict names its place (`segments`). A pass counts only where the two
// agree. An engine that stamps neither is taken as before.

export interface CellCountPass {
  count?: number
  settled?: boolean
  locationKey?: string
}

/** The key show-cell stamps on a pass painted at `segments`. */
export const locationKeyOf = (segments: readonly string[]): string =>
  '/' + segments.map(segment => String(segment ?? '').trim()).filter(Boolean).join('/')

/** Does this pass show the place the arrival verdict named: tiles on screen,
 *  or that place settled empty? `arrival` is the verdict's segments, or null
 *  when the verdict did not say where. */
export const passShowsArrival = (
  arrival: readonly string[] | null,
  pass: CellCountPass | null | undefined,
): boolean => {
  if (!pass) return false
  if (arrival && typeof pass.locationKey === 'string'
    && locationKeyOf(pass.locationKey.split('/')) !== locationKeyOf(arrival)) return false
  return (pass.count ?? 0) > 0 || pass.settled === true
}
