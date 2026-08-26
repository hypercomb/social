// diamondcoreprocessor.com/groups/aggregate-source.ts
//
// The AGGREGATE INDEX contract — what an aggregate declares so it can be
// rendered by the one index panel (aggregate-index.view.ts, beside this file).
//
// ── Why this exists ──────────────────────────────────────────────────────────
//
// Every aggregate had been growing its own index surface. Collections had a
// full-screen landing; Websites had a SECOND, near-identical one
// (`website-landing/`, ~340 lines of the same location gate + card grid +
// image resolution). Two copies of one idea, drifting apart, and neither could
// gain a capability without the other being rewritten to match.
//
// So the panel is now ONE component and an aggregate contributes a SOURCE: what
// its items are, what opening one does, and which management gestures it allows.
// Everything an index panel DOES — the left dock, one-line rows with a hex
// thumbnail, the filter, and above all DRAG-TO-CREATE-MEANING — lives once, in
// the panel, and every aggregate gets it for free the moment it registers.
//
// This mirrors `LaunchGroupBase` deliberately (core/launch-group-base.ts): a
// subclass "declares only what is genuinely its own". Same rule here — a source
// supplies data and intent, never chrome.
//
// Sources resolve their services through `window.ioc` at CALL TIME, never by
// import: a source is data + intent, and the services it reaches are other
// bees whose load order it must not depend on.

/** One row in an aggregate index. */
export interface AggregateItem {
  /** Stable id within the source — @for track, and the drag payload's handle. */
  key: string
  /** Display name. Also the label a dropped reference tile takes. */
  label: string
  /** Full lineage path to what this item POINTS AT. This is what a dropped
   *  reference targets, so it must be the real location, not a display path. */
  segments: readonly string[]
  /** Keywords carried by the item — rendered as chips and filterable. */
  tags?: readonly string[]
  /** Resolved object URL for the item's hex thumbnail, if the source has one.
   *  Absent → the panel draws its accent + monogram fallback, so a row is never
   *  a blank slot. */
  image?: string
}

/** One selectable VERSION of a row.
 *
 *  A version is a SIGNATURE, never a version number — the sig IS the revision
 *  handle (each commit already mints one), so a row's history needs no parallel
 *  bookkeeping. `label` is only for reading; `sig` is what gets chosen.
 *
 *  Two chains can feed one row and they are NOT the same thing, so `origin`
 *  keeps them apart rather than merging them into one misleading timeline:
 *    • `local`     — a state this hive itself has been in. Choosing one is an
 *                    ordinary commit here, undoable like any other.
 *    • `published` — a deployed revision held by the INSTALLER on its own
 *                    origin. Choosing one is a message across the sentinel
 *                    port; this origin never writes the pick itself. */
export interface AggregateVersion {
  /** The signature this version IS — a page resource sig for `local`, a package
   *  root sig for `published`. Also the @for track key. */
  sig: string
  /** Display handle. Never load-bearing. */
  label: string
  /** When this version came to be, epoch ms, when the chain knows. */
  at?: number
  /** The version currently in effect. Exactly one row per chain, at most. */
  active?: boolean
  /** Which chain this belongs to — see above. */
  origin: 'local' | 'published'
  /** For `published` rows: the host whose package this revision belongs to.
   *  Carried on the row so choosing it needs no second lookup. */
  domain?: string
}

/** A tile the participant has SELECTED on the canvas, offered to the panel as a
 *  candidate member. `segments` is its absolute location, because a selection
 *  survives navigation and the label alone would name the wrong tile once the
 *  hive has moved on. */
export interface StagedEntry {
  label: string
  segments: readonly string[]
}

/** What a create/add gesture put INTO THE INDEX, so the panel can show it
 *  without waiting to re-read.
 *
 *  A write is a handful of local OPFS operations; re-deriving every row costs a
 *  layer read, a decoration read and a picture per row, sequentially. Returning
 *  the rows it just wrote lets the source answer the only question the panel
 *  actually has at that moment — "what did I just add?" — and the authoritative
 *  re-read then catches up in the background with pictures and keywords.
 *
 *  Rows the gesture wrote SOMEWHERE ELSE are not index rows: adding tiles INTO
 *  a collection changes that collection's contents, not this list, so that case
 *  reports nothing. `void` is allowed so a source that has nothing useful to say
 *  early simply stays as it was and relies on the re-read. */
export type AddedRows = readonly AggregateItem[] | void

/** An aggregate that can be rendered by the one index panel. */
export interface AggregateSource {
  /** Stable id — also the panel's persisted-width key and its i18n prefix. */
  readonly id: string
  /** Material Symbols ligature for the aggregate's MEANING. */
  readonly icon: string
  /** i18n key for the panel title. */
  readonly titleKey: string
  /** i18n key for the first-run welcome line, if this source has one. */
  readonly ledeKey?: string

  /** The location that makes this source the ACTIVE one — arriving there opens
   *  its index (e.g. `['sets']` for collections, `['websites']`). Omit for a
   *  source that is only ever opened explicitly. */
  readonly activeAt?: readonly string[]

  /** Current rows. Called on activation and whenever `changed` fires. */
  items(): Promise<readonly AggregateItem[]>

  /** Open a row — navigation, view-mode flip, whatever this aggregate means by
   *  "open". The panel never navigates on a source's behalf. */
  open(item: AggregateItem): void

  /** Fires when the rows have changed BEHIND the panel's back, so it re-reads.
   *
   *  This is what a source uses to report work it finished after `items()`
   *  already answered — a picture, a keyword or a title that resolved late. The
   *  panel coalesces these, so a source may dispatch one per resolution without
   *  costing a rebuild each; it must dispatch ONLY on a real change, or the
   *  re-read it triggers will resolve again and never settle. */
  readonly changed?: EventTarget

  // ── optional management gestures ───────────────────────────────────────────
  // A source omits what it doesn't support and the panel simply won't offer it.

  /** i18n key + handler for creating a new member inline. */
  readonly createKey?: string
  create?(name: string): Promise<AddedRows>

  /** i18n key + handler for adding the participant's CURRENT SELECTION.
   *
   *  Selecting tiles on the canvas and pressing one button beats dragging them
   *  in one at a time, and it is the only gesture that handles several at once.
   *  A source that has no meaning for "add these existing tiles" simply omits
   *  it and the panel never offers the affordance. */
  readonly addKey?: string
  /** `into` picks the DESTINATION. Absent, the entries become members of the
   *  index itself — they BECOME collections. Given a row, they are added INTO
   *  that collection instead. Same act at two grains: promote, or gather. */
  add?(entries: readonly StagedEntry[], into?: AggregateItem): Promise<AddedRows>

  /** i18n key + handler for MOVING the current selection into a destination.
   *
   *  Add and move are the two things "put this in there" can mean, and they are
   *  not interchangeable:
   *    • `add`  — writes a REFERENCE. The tile gains a doorway here and stays
   *      exactly where it lives, which is what lets one thing belong to several
   *      collections at once.
   *    • `move` — CUSTODY. The tile leaves the layer it was on and lives inside
   *      the destination, so it disappears from where it used to be.
   *  Tidying up is the second one, and it is the reason this exists: every route
   *  the app had (Add, /reference) left the tile where it was.
   *
   *  Only ever called WITH a destination. Moving into the index itself would mean
   *  re-homing content under `sets/`, and `sets/` holds pointers, not content.
   *  A source with no meaning for custody omits this and the panel never offers
   *  the button. */
  readonly moveKey?: string
  move?(entries: readonly StagedEntry[], into: AggregateItem): Promise<void>

  /** The chain of versions behind a row, newest first. A source that has no
   *  meaning for "what has this been before" omits it and the panel never
   *  offers the affordance — same rule as every other gesture here. */
  versions?(item: AggregateItem): Promise<readonly AggregateVersion[]>
  /** Put a version in effect. What that MEANS belongs to the source (a commit
   *  here, a message to the installer); the panel only reports the choice. */
  useVersion?(item: AggregateItem, version: AggregateVersion): Promise<void>

  rename?(item: AggregateItem, next: string): Promise<void>
  /** Remove from the INDEX (never a content delete). */
  remove?(item: AggregateItem): Promise<void>
  /** Whether removal is offered for this row right now — e.g. collections only
   *  allow it while empty, so a manage gesture can never drop content. */
  canRemove?(item: AggregateItem): boolean
}

/** Registered sources by id. A module-scope singleton for the same reason
 *  `groupRegistry` is one: any module may contribute, and both the panel and
 *  the controls rail need to enumerate the same set. */
const sources = new Map<string, AggregateSource>()

/** Broadcasts registration changes so a mounted panel picks up a late source. */
export const aggregateSources = new EventTarget()

/** Declare an aggregate's index. Idempotent on `id`: re-registering the same id
 *  with a different object is a programming error (two owners for one index),
 *  so it is dropped with a warning rather than silently swapping the source out
 *  from under a panel that may be mid-read. */
export const registerAggregateSource = (source: AggregateSource): void => {
  const existing = sources.get(source.id)
  if (existing && existing !== source) {
    console.warn(`[aggregate-index] "${source.id}" is already registered — ignoring the second source.`)
    return
  }
  if (existing) return
  sources.set(source.id, source)
  aggregateSources.dispatchEvent(new CustomEvent('change'))
}

export const getAggregateSource = (id: string): AggregateSource | undefined => sources.get(id)

export const allAggregateSources = (): readonly AggregateSource[] => [...sources.values()]

/** The source whose `activeAt` matches this location exactly, if any. */
export const sourceForLocation = (segments: readonly string[]): AggregateSource | undefined => {
  for (const s of sources.values()) {
    const at = s.activeAt
    if (!at) continue
    if (at.length === segments.length && at.every((v, i) => v === segments[i])) return s
  }
  return undefined
}
