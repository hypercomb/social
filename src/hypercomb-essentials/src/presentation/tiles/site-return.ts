// presentation/tiles/site-return.ts
//
// THE WAY OUT OF A WEBSITE IS THE WAY IN, REVERSED.
//
// A site is not a place in the hive you walked to — it is a surface that
// TOOK OVER, spawned from wherever the reader happened to be standing and
// whatever they happened to be looking at. So leaving it has exactly one
// correct destination: the page that spawned it, in the view that spawned
// it. Nothing is derived, nothing is walked, nothing is guessed.
//
// This replaced an "entrance tile" rule that walked UP from the site page
// through every ancestor that still carried a page, and always landed on the
// hexagons. Both halves were wrong for the same reason: they answered "where
// does this site begin?" when the question is "where was the reader before
// it opened?". Coming out of a site opened from a deck left you on the site's
// own root cell staring at raw hexagons — the reported bug.
//
// The spawn record has two fields and one rule each:
//   • `mode` — the surface that was up when the site opened (ViewMode's
//     `previous`). '' or 'hexagons' means the hexagons spawned it.
//   • `segments` — where the explorer stood then. For a site the reader
//     ARRIVED into (a `view:default` mark opened it as they walked in) that
//     is the page they came FROM, not the site's own cell; for a site they
//     toggled on while standing still, the two are the same place.

/** The surface + place a website session was spawned from. */
export interface SiteSpawn {
  /** The view that was up when the site opened. '' = the hexagons. */
  readonly mode: string
  /** Where the explorer stood when the site opened. */
  readonly segments: readonly string[]
}

/** The default surface — what "no view" means. */
export const HEXAGONS_SURFACE = 'hexagons'

/** Same path? Segment-wise, order-sensitive. */
export function sameSiteSegments(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((seg, i) => seg === b[i])
}

/**
 * The floor of a site session: how far up `..` and a right-click may walk.
 * Normally where the reader stood when the site opened (`here`). On a
 * published door the reader can ARRIVE anywhere inside the creation — a shared
 * link opens `/minutes/2026-10-14` cold — and the site they are in is still
 * the whole published creation, so its floor is the published ROOT whenever
 * the arrival page lies under it. A root that is not above `here` says nothing
 * about this site and leaves the floor where the reader stood.
 */
export function siteFloorFor(here: readonly string[], publishedRoot: readonly string[] | null): readonly string[] {
  if (!publishedRoot || publishedRoot.length === 0 || publishedRoot.length > here.length) return here
  return publishedRoot.every((seg, i) => seg === here[i]) ? publishedRoot : here
}

/**
 * Where leaving a website lands. `current` is where the reader stands now
 * (the last page they read inside the site) and is the answer for everything
 * the spawn record cannot say: an INDIRECT session (booted straight into
 * website mode) has no spawn at all, so it stays put on the hexagons rather
 * than teleporting someone who never chose to be anywhere else.
 */
export function siteReturnTarget(
  spawn: SiteSpawn | null,
  current: readonly string[],
): { mode: string; segments: readonly string[] } {
  if (!spawn) return { mode: HEXAGONS_SURFACE, segments: current }
  // An EMPTY spawn path is the hive root, a real place — never a missing one.
  return { mode: spawn.mode || HEXAGONS_SURFACE, segments: spawn.segments }
}

/**
 * Where a flip back to the hexagons lands, decided by WHO dropped the
 * surface — never by where the reader stands (a site's own link can take them
 * well outside it, and leaving from there is still leaving the site).
 *
 *   • An EXIT — the exit button, Escape, `h`, the back gesture — goes back
 *     the way in: siteReturnTarget.
 *   • A WALK-OUT — the reader already moved (`go /elsewhere`, another
 *     session's sentence) and the ARRIVAL there released the surface behind
 *     them (view.bee `releasingArrival`) — ends where they stand. Sending them
 *     back to the spawn was the bug: `go /colony` from a site opened at the
 *     root landed on the root, and the next word found "the hive root".
 */
export function siteFlipTarget(
  spawn: SiteSpawn | null,
  current: readonly string[],
  walkedOut: boolean,
): { mode: string; segments: readonly string[] } {
  if (walkedOut) return { mode: HEXAGONS_SURFACE, segments: current }
  return siteReturnTarget(spawn, current)
}
