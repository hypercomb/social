// recent-portals.types.ts — HOME and the portals you have walked through:
// the module↔shell contract.
//
// The implementation lives in essentials (presentation/tiles/
// recent-portals.store.ts, beside the portal click's emitter) and registers
// under RECENT_PORTALS_KEY. It announces on EffectBus as
// RECENT_PORTALS_CHANGED (at construction + every change — replay covers
// chrome that mounts before the module loads); consumers re-read the lazily
// resolved instance on that trigger. Absence means Home is the hive root —
// exactly what Home always meant.

export const RECENT_PORTALS_KEY = '@hypercomb.social/RecentPortalsStore'

/** EffectBus effect — emitted at construction and on every change. */
export const RECENT_PORTALS_CHANGED = 'portals:recent-changed'

export type RecentPortalsChange = { count: number }

export interface RecentPortal {
  /** The portal tile's name — what was clicked, and what the menu shows. */
  readonly label: string
  /** Where it led. `[]` is the hive root. */
  readonly segments: readonly string[]
  /** Epoch ms of the last walk through it. */
  readonly at: number
}

export interface RecentPortalsProvider {
  readonly value: readonly RecentPortal[]
  /** The most recently walked portal. Feeds the Ctrl+click list only. */
  readonly latest: RecentPortal | undefined
  /** The portal PINNED as home from the Portals toolwindow, if any. */
  readonly pinned: RecentPortal | undefined
  /** WHERE HOME GOES — the MARKED portal, and nothing else. */
  readonly home: RecentPortal | undefined
  isPinned(segments: readonly string[]): boolean
  record(label: string, segments: readonly string[]): void
  pin(label: string, segments: readonly string[]): void
  unpin(): void
  togglePin(label: string, segments: readonly string[]): void
  remove(segments: readonly string[]): void
  clear(): void
}
