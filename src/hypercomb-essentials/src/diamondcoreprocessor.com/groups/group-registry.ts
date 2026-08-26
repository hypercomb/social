// group-registry.ts
//
// Moved down from hypercomb-shared in the everything-is-a-beehavior Phase 1 —
// the whole group cluster rides the commands bundle (slash-behaviour.drone
// imports launch-groups, which pulls this chain). Contract in core
// (group-launcher.types.ts); the registry announces GROUPS_CHANGED on
// EffectBus beside its EventTarget 'change', so chrome re-renders
// instance-free.
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

import {
  EffectBus,
  GROUPS_CHANGED,
  GROUP_LAUNCHER_KEY,
  type GroupMember,
  type LaunchGroup,
  type GroupLauncherProvider,
} from '@hypercomb/core'
import { MixedGroupBag } from './mixed-group-bag.js'

// Canonical member/group shapes live in core (group-launcher.types.ts); the
// cluster keeps importing them from here.
export type { GroupMember, LaunchGroup } from '@hypercomb/core'

export class GroupRegistry extends EventTarget implements GroupLauncherProvider {
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

  /** EventTarget 'change' for module-side holders + the instance-free
   *  EffectBus announce for shell chrome (replayed). */
  #announce(): void {
    this.dispatchEvent(new CustomEvent('change'))
    EffectBus.emit(GROUPS_CHANGED, {})
  }

  register(group: LaunchGroup): void {
    this.#groups.set(group.id, group)
    this.#announce()
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
    // An `openDirectly` group has NO browsable page: open its
    // single member immediately instead of navigating to /<id> and reconciling
    // a self-referential launcher tile there. The rail-icon click routes here.
    if (group.openDirectly) {
      const members = group.members()
      if (members.length > 0) group.open(members[0])
      this.#announce()
      return
    }
    void this.#mix.show(id).then(() => this.#announce())
  }

  /** Leave the aggregator page — ONLY for an explicit close affordance (the
   *  websites directory X). There are no global leave gestures: the page
   *  stays until the participant navigates, like any other page. */
  exitBag(): void { this.#mix.exit() }

  /** A provider calls this when its member set may have changed. Re-renders the
   *  launcher and, if the participant is inside the mix, updates it in place
   *  (never auto-enters — a background scan must not yank you into the bag). */
  notifyChanged(): void {
    this.#announce()
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
/** Re-assert into the LIVE IoC map (the llm-provider-registry lesson). */
export const ensureGroupLauncherRegistered = (): void => {
  if (!window.ioc?.has?.(GROUP_LAUNCHER_KEY)) {
    window.ioc?.register?.(GROUP_LAUNCHER_KEY, groupRegistry)
  }
}
ensureGroupLauncherRegistered()
