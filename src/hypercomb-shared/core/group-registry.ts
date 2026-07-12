// hypercomb-shared/core/group-registry.ts
//
// Launch groups — a "group" is a MEANING (websites, games, …) surfaced as a
// single icon in the top chrome, never a per-item glyph. Members are discovered
// dynamically; a group with zero members is not rendered.
//
// ONE-STATE (2026-07-03): each icon is a PORTAL, not a toggle. Clicking it
// brings up that group's layer (the shared aggregator page); clicking another
// icon closes the previous layer by the mere fact of navigating; clicking the
// same icon again is an idempotent no-op. There is no enabled set, nothing
// persisted, no close-watch choreography and no go-back reset — being on the
// page IS the state, and any icon highlight is DERIVED from where the
// participant is standing (currentId()), never stored.
//
// Shell-level plumbing: providers resolve HistoryService/Store/Navigation
// through window.ioc at call time and NEVER import essentials. Registered at
// module load, same pattern as ViewMode / Lineage.

import { MixedGroupBag } from './mixed-group-bag'

export interface GroupMember {
  /** Stable id within the group — @for track + click→open routing. */
  key: string
  /** Display name; also the cell label rendered as the hexagon tile. */
  label: string
  /** Full lineage path to the member's root cell. */
  segments: string[]
  /** Optional per-member glyph (the group ICON is by meaning, not this). */
  icon?: string
  /** Layout role on a CLUSTERED launcher page (`orderedLayout` groups only).
   *  'header' marks a category-title tile that opens nothing and starts a new
   *  island; anything else is a normal action tile. Default (absent) = action. */
  role?: 'header' | 'action'
  /** Island id on a CLUSTERED launcher page — every tile of one island (its
   *  header + its actions) shares the SAME group id, so the renderer can gather
   *  the island by identity regardless of the (slot-sorted) render order. Ids
   *  sort by their trailing number to order the islands. Absent = ungrouped. */
  group?: string
}

export interface LaunchGroup {
  id: string
  /** Material Symbols ligature for the group's MEANING. */
  icon: string
  label: string
  /** Launcher-tile silhouette for THIS group's members in the aggregator —
   *  a string the renderer maps to a shape (e.g. 'flower-pot', 'space-invader').
   *  Each group owns its own look; groups never share a visual type. Omit for
   *  the plain hexagon (dashboard, help). Written into each member's
   *  `launch:target` decoration so show-cell can pick the shape PER TILE. */
  shape?: string
  /** When true, the aggregator lays this group's members out as CLUSTERED
   *  ISLANDS — one compact hex blob per category, each titled by a
   *  `role:'header'` tile — instead of one continuous spiral, and its
   *  reconcile keeps the page in members() ORDER (so headers interleave into
   *  their categories) rather than preserving prior arrangement. Help opts in;
   *  other groups keep the spiral + arrangement-preserving reconcile. */
  orderedLayout?: boolean
  /** True for a CURATED group: its page layer's children ARE its membership
   *  (the aggregation-layer model — see documentation/aggregation-layer-
   *  model.md), so MixedGroupBag must NOT reconcile the page from members()
   *  (membership already lives there; the reconcile would be circular) and
   *  must NOT force the history cursor to head — undo/redo at /<id> IS the
   *  group's curation history. Derived groups (games, help) keep the
   *  reconcile. */
  readonly curated?: boolean

  /** When true, this group has NO browsable aggregator page: it is a single
   *  toggle surfaced only as a rail icon (the dashboard). Clicking the icon
   *  opens its member DIRECTLY via open() — the registry never navigates to
   *  /<id>, so MixedGroupBag never reconciles a self-referential launcher tile
   *  there, and /<id> is not treated as a launcher page (isLauncherLocation
   *  excludes it). This restores the documented "single member → open directly,
   *  never a hexagon page" behavior the one-state refactor dropped. */
  openDirectly?: boolean
  members(): GroupMember[]
  /** Activate a single member — its routing is owned by the group (websites →
   *  website mode, games → overlay toggle, dashboard → toggleBehavior). The
   *  MixedGroupBag calls this when a launcher tile is clicked. */
  open(m: GroupMember): void
  /** Optional live "is this group's surface open" check for the rail highlight.
   *  A page-backed group derives its highlight from the location (currentId);
   *  an openDirectly group (dashboard) has no page, so it reports its own active
   *  state here (its bag being open). Absent → highlight is location-only. */
  isActive?(): boolean
}

export class GroupRegistry extends EventTarget {
  #groups = new Map<string, LaunchGroup>()
  /** The shared page machinery behind every group's root location (/games,
   *  /websites, …). Built EAGERLY (in the constructor), not lazily on first
   *  click: its `group:open` click listener must be live even when the app
   *  reloads straight into a group page (or one is typed as an address),
   *  otherwise the launcher tiles render but every click is a dead no-op.
   *  Construction only wires listeners (no nav, no IoC reads), so it's safe
   *  at module load. */
  #mix: MixedGroupBag

  constructor() {
    super()
    this.#mix = new MixedGroupBag(this)
  }

  register(group: LaunchGroup): void {
    this.#groups.set(group.id, group)
    this.dispatchEvent(new CustomEvent('change'))
  }

  get(id: string): LaunchGroup | undefined { return this.#groups.get(id) }
  all(): LaunchGroup[] { return [...this.#groups.values()] }

  /** The group whose layer the participant is standing in, or null. DERIVED
   *  from the current location — never stored. Drives the icon highlight. */
  currentId(): string | null { return this.#mix.currentGroupId() }

  /** The launcher icon click — the ONE state. Show this group's layer;
   *  whatever was up before closes by plain navigation. Idempotent when the
   *  participant is already standing in this group's layer. */
  show(id: string): void {
    const group = this.#groups.get(id)
    if (!group) return
    // An `openDirectly` group (the dashboard) has NO browsable page: open its
    // single member immediately instead of navigating to /<id> and reconciling
    // a self-referential launcher tile there. The rail-icon click routes here.
    if (group.openDirectly) {
      const members = group.members()
      if (members.length > 0) group.open(members[0])
      this.dispatchEvent(new CustomEvent('change'))
      return
    }
    void this.#mix.show(id).then(() => this.dispatchEvent(new CustomEvent('change')))
  }

  /** Leave the aggregator page — ONLY for an explicit close affordance (the
   *  websites directory X). There are no global leave gestures: the page
   *  stays until the participant navigates, like any other page. */
  exitBag(): void { this.#mix.exit() }

  /** A provider calls this when its member set may have changed. Re-renders the
   *  launcher and, if the participant is inside the mix, updates it in place
   *  (never auto-enters — a background scan must not yank you into the bag). */
  notifyChanged(): void {
    this.dispatchEvent(new CustomEvent('change'))
    void this.#mix.refreshIfActive()
    // Discovery settled — warm the aggregator's layer caches in the background
    // (non-navigating, read-only) so the first click into a group is fast
    // instead of paying a cold reconcile. No-op when nothing is shown.
    void this.#mix.prewarm()
  }

  /** Warm a specific group's aggregator on hover/intent so its FIRST click is
   *  fast (read-only, non-navigating). The launcher icon calls this on hover. */
  prewarmGroup(id: string): void {
    void this.#mix.prewarmFor(id)
  }
}

export const groupRegistry = new GroupRegistry()
register('@hypercomb.social/GroupLauncher', groupRegistry)
