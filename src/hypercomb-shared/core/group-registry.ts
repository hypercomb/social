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
  members(): GroupMember[]
  /** Activate a single member — its routing is owned by the group (websites →
   *  website mode, games → overlay toggle, dashboard → toggleBehavior). The
   *  MixedGroupBag calls this when a launcher tile is clicked. */
  open(m: GroupMember): void
}

export class GroupRegistry extends EventTarget {
  #groups = new Map<string, LaunchGroup>()
  /** The single shared aggregator. Built EAGERLY (in the constructor), not
   *  lazily on first click: its `group:open` click listener + exit gestures
   *  must be live even when the app reloads straight into `agg-mix` (a refresh
   *  while inside it), otherwise the launcher tiles render but every click is
   *  a dead no-op. Construction only wires listeners (no nav, no IoC reads),
   *  so it's safe at module load. */
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
    if (!this.#groups.has(id)) return
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
