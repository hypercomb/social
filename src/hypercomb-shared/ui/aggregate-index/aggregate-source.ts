// hypercomb-shared/ui/aggregate-index/aggregate-source.ts
//
// The AGGREGATE INDEX contract — what an aggregate declares so it can be
// rendered by the one shared index panel (aggregate-index.component).
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
// Shell-level plumbing: sources resolve their services through `window.ioc` at
// call time and NEVER import essentials.

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

/** An aggregate that can be rendered by the shared index panel. */
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

  /** Fires when membership changes, so the panel re-reads. */
  readonly changed?: EventTarget

  // ── optional management gestures ───────────────────────────────────────────
  // A source omits what it doesn't support and the panel simply won't offer it.

  /** i18n key + handler for creating a new member inline. */
  readonly createKey?: string
  create?(name: string): Promise<void>

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
