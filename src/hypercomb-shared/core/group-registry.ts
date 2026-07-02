// hypercomb-shared/core/group-registry.ts
//
// Launch groups — a "group" is a MEANING (websites, games, …) surfaced as a
// single icon in the top chrome, never a per-item glyph. Members are discovered
// dynamically; a group with zero members is not rendered.
//
// Each icon is an INDEPENDENT ON/OFF TOGGLE. Toggling groups on MIXES their
// members into ONE shared aggregator hexagon page (MixedGroupBag) — the union
// of every enabled group. Toggling the last one off leaves it. The enabled set
// is the launcher's only selection state and lives here (this registry is the
// single EventTarget the launcher component already subscribes to); it persists
// to localStorage and lights the icons at first paint, but the bag is NOT
// auto-entered on boot (never-nav-at-init / stillness).
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

/** localStorage key for the enabled (toggled-on) group ids. */
const ENABLED_KEY = 'hc:launch-groups:enabled'

export class GroupRegistry extends EventTarget {
  #groups = new Map<string, LaunchGroup>()
  /** Toggle state — raw enabled ids (a group may be enabled before it (re)gains
   *  members, so we store the id, not a resolved group). */
  #enabled = new Set<string>()
  /** The single shared mixed aggregator. Built EAGERLY (in the constructor),
   *  not lazily on first toggle: its `group:open` click listener + exit gestures
   *  must be live even when the app reloads straight into `agg-mix` (a refresh
   *  while inside the mix), otherwise the launcher tiles render but every click
   *  is a dead no-op. Construction only wires listeners (no nav, no IoC reads),
   *  so it's safe at module load. */
  #mix: MixedGroupBag

  constructor() {
    super()
    try {
      const raw = localStorage.getItem(ENABLED_KEY)
      const ids = raw ? JSON.parse(raw) : null
      // Exclusive launcher: at most ONE group is ever lit. Persisted sets from
      // the independent-toggles era can hold several ids — honoring them boots
      // into a mixed-union page with every group's tiles and themes blended.
      // Keep the first id only (and rewrite storage so this never re-fires).
      if (Array.isArray(ids)) {
        const first = ids.find((x): x is string => typeof x === 'string')
        if (first) this.#enabled.add(first)
        if (ids.length > 1) this.#persist()
      }
    } catch { /* corrupt — start with nothing enabled */ }
    this.#mix = new MixedGroupBag(this)
  }

  register(group: LaunchGroup): void {
    this.#groups.set(group.id, group)
    this.dispatchEvent(new CustomEvent('change'))
  }

  get(id: string): LaunchGroup | undefined { return this.#groups.get(id) }
  all(): LaunchGroup[] { return [...this.#groups.values()] }

  /** Raw toggle membership — drives the icon's on-glow. */
  isEnabled(id: string): boolean { return this.#enabled.has(id) }

  /** Enabled groups that currently resolve to a registered, NON-EMPTY group —
   *  what actually feeds the mix. Pruned on every read so a stale or not-yet-
   *  loaded id never pins the page open, blocks the all-off exit, or lights a
   *  glow with nothing behind it. */
  enabledIds(): string[] {
    return this.all()
      .filter(g => this.#enabled.has(g.id) && g.members().length > 0)
      .map(g => g.id)
  }

  /** Flip one group's toggle (the launcher icon click). */
  toggle(id: string): void { this.setEnabled(id, !this.#enabled.has(id)) }

  setEnabled(id: string, on: boolean): void {
    if (on === this.#enabled.has(id)) return
    if (on) this.#enabled.add(id)
    else this.#enabled.delete(id)
    this.#persist()
    this.dispatchEvent(new CustomEvent('change'))
    void this.#mix.sync()
  }

  /** MUTUALLY-EXCLUSIVE selection (the launcher icon click): make `id` the ONLY
   *  enabled group, clearing the rest; if it's already the sole one AND its bag
   *  is on screen, turn it off. A lit icon whose bag is NOT showing (the toggle
   *  survived a reload out of website mode, or any path that left the icon lit
   *  while the participant is elsewhere) re-ENTERS the bag instead of going
   *  dark — the tap means "show me this group", and turning off first would
   *  cost a second click to reactivate. Updates the set and syncs the bag
   *  ONCE — so switching groups is a single operation (snappier than an
   *  off-then-on toggle pair). No-op if nothing actually changed. */
  selectExclusive(id: string): void {
    const only = this.#enabled.size === 1 && this.#enabled.has(id)
    if (only && !this.#mix.isActive()) { void this.#mix.sync(); return }
    const next = only ? [] : [id]
    if (next.length === this.#enabled.size && next.every(x => this.#enabled.has(x))) return
    this.#enabled.clear()
    for (const x of next) this.#enabled.add(x)
    this.#persist()
    this.dispatchEvent(new CustomEvent('change'))
    void this.#mix.sync()
  }

  /** The STANDARD launcher exit — see LaunchGroupBase, which arms this for
   *  every group. A member surface opened through the launcher just closed
   *  back to the hexagon canvas: reset the header icons to their default
   *  (nothing lit). clear() also syncs the bag, which exits it when the
   *  participant is still standing in it (games/help overlays, the
   *  dashboard's return) — landing on the hive, never a stale mixed list.
   *  Members that moved the lineage into their OWN tree (websites) then land
   *  on their root cell, so hexagons resume at the site rather than buried in
   *  a sub-page. Skipped while the bag itself dismisses a surface for a group
   *  SWITCH — the fresh pick must survive, and the switch's own enter() owns
   *  the navigation. */
  surfaceClosed(member: GroupMember): void {
    if (this.#mix.isSwitching()) return
    this.clear()
    if (member.segments.length > 0) {
      get<{ goRaw?: (segments: readonly string[]) => void }>('@hypercomb.social/Navigation')
        ?.goRaw?.(member.segments)
    }
  }

  /** Clear ALL toggles — the launcher icons return to their default (nothing
   *  lit). Used when a full exit from a launched surface (closing a website via
   *  its "Return from the web page" affordance / escape) should reset the header
   *  icons rather than leave the group that opened the site stuck on. No-op when
   *  nothing is enabled. */
  clear(): void {
    if (this.#enabled.size === 0) return
    this.#enabled.clear()
    this.#persist()
    this.dispatchEvent(new CustomEvent('change'))
    void this.#mix.sync()
  }

  /** A provider calls this when its member set may have changed. Re-renders the
   *  launcher and, if the participant is inside the mix, updates it in place
   *  (never auto-enters — a background scan must not yank you into the bag). */
  notifyChanged(): void {
    this.dispatchEvent(new CustomEvent('change'))
    void this.#mix.refreshIfActive()
    // Discovery settled — warm the aggregator's layer caches in the background
    // (non-navigating, read-only) so the first click into a group is fast
    // instead of paying a cold reconcile. No-op when nothing is toggled on.
    void this.#mix.prewarm()
  }

  /** Warm a specific group's aggregator on hover/intent so its FIRST click is
   *  fast (read-only, non-navigating). The launcher icon calls this on hover. */
  prewarmGroup(id: string): void {
    void this.#mix.prewarmFor(id)
  }

  #persist(): void {
    try { localStorage.setItem(ENABLED_KEY, JSON.stringify([...this.#enabled])) } catch { /* ignore */ }
  }
}

export const groupRegistry = new GroupRegistry()
register('@hypercomb.social/GroupLauncher', groupRegistry)
