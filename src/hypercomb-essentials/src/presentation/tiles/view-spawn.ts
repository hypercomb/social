// presentation/tiles/view-spawn.ts
//
// COMING BACK OUT LANDS WHERE YOU CAME IN — for every view a tile icon
// STEPS YOU INTO, not just the website.
//
// Clicking a view's icon on a tile does two things in one gesture: it walks
// the explorer to the view's ENTRANCE (for a branch-scoped behaviour that is
// the marked root, which can be several rings away from the tile that was
// clicked) and then flips the surface. The walk is invisible while the view
// is up — it exists so the renderer has the right floor under it — but it is
// still a move, and closing the view left the participant standing on it:
// click the tree icon on `behaviors` from a deck three levels away, press
// Escape, and you are on the behaviors root staring at raw hexagons. The
// place you actually came from is gone.
//
// A stepped-into view is not a place you walked to; it is a surface that
// TOOK OVER, spawned from wherever you were standing and whatever you were
// looking at. So leaving has exactly one destination, and nothing about it is
// derived: the PAGE you stood on and the VIEW that was up when the icon was
// clicked. This is the same rule `site-return.ts` states for websites; the
// difference is only how the record is made — a website captures its own
// spawn on the mode flip, while a stepped-into view has to be TOLD, because
// by the time the surface flips the walk has already happened and "where you
// stood" is no longer readable from the lineage.
//
// The record therefore travels as an effect (`view:spawn`), announced by the
// icon dispatcher immediately BEFORE it navigates. EffectBus is the one
// singleton every separately-bundled bee shares; module state is not (the
// same file inlined into two bee bundles is two copies), so the record must
// never live in a module variable here.

/** The effect the icon dispatcher announces a step-in on. Payload is
 *  `ViewSpawn`. Emitted before the walk, so `segments` is the page the
 *  participant was standing on — not the view's entrance. */
export const VIEW_SPAWN_EFFECT = 'view:spawn'

/** The surface + place a stepped-into view session was spawned from. */
export interface ViewSpawn {
  /** Which view was stepped into — a receiver only honours its own. */
  readonly view: string
  /** The surface that was up at the time. '' = the hexagons. */
  readonly mode: string
  /** Where the explorer stood at the time. */
  readonly segments: readonly string[]
}

/** The default surface — what "no view" means. */
export const HEXAGONS = 'hexagons'

/** Same path? Segment-wise, order-sensitive. */
export function sameSegments(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((seg, i) => seg === b[i])
}

/**
 * Where leaving a stepped-into view lands. `current` is where the
 * participant stands now and is the answer for everything the spawn record
 * cannot say: a view opened by typing its command, by the header toggle, or
 * as a layer's arrival face was never stepped INTO from anywhere, so it has
 * no spawn and closing it stays put rather than teleporting someone who
 * never chose to be somewhere else.
 */
export function viewReturnTarget(
  spawn: ViewSpawn | null,
  current: readonly string[],
): { mode: string; segments: readonly string[] } {
  if (!spawn) return { mode: HEXAGONS, segments: current }
  // An EMPTY spawn path is the hive root, a real place — never a missing one.
  return { mode: spawn.mode || HEXAGONS, segments: spawn.segments }
}

/** Is this payload a spawn record for `view`? The receiver's whole gate:
 *  one effect carries every view's step-ins. */
export function spawnForView(payload: unknown, view: string): ViewSpawn | null {
  const record = payload as Partial<ViewSpawn> | null | undefined
  if (!record || record.view !== view) return null
  return {
    view,
    mode: String(record.mode ?? '').trim(),
    segments: [...(record.segments ?? [])].map(s => String(s ?? '').trim()).filter(Boolean),
  }
}
