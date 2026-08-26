// group-launcher.types.ts — the launch-group machinery's module↔shell
// contract.
//
// A "group" is a MEANING (websites, games, …) surfaced as a single icon in
// the top chrome. The implementation — GroupRegistry, MixedGroupBag, the
// aggregation layer and the built-in groups — lives in essentials (groups/)
// and registers under the keys below. The registry announces GROUPS_CHANGED
// on EffectBus whenever membership or state changes (with replay), so chrome
// needs no instance to re-render; instances are resolved lazily to act.

export const GROUP_LAUNCHER_KEY = '@hypercomb.social/GroupLauncher'
export const AGGREGATION_LAYER_KEY = '@hypercomb.social/AggregationLayer'

/** EffectBus effect — emitted whenever the group registry dispatches
 *  'change' (registration, show, membership refresh). Payload is empty:
 *  subscribers re-read the lazily resolved registry. */
export const GROUPS_CHANGED = 'groups:changed'

export interface GroupMember {
  /** Stable id within the group — @for track + click→open routing. */
  key: string
  /** Display name; also the cell label rendered as the hexagon tile. */
  label: string
  /** Full lineage path to the member's root cell. */
  segments: string[]
  /** Optional per-member glyph (the group ICON is by meaning, not this). */
  icon?: string
  /** Layout role on a CLUSTERED launcher page (`orderedLayout` groups only). */
  role?: 'header' | 'action'
  /** Island id on a CLUSTERED launcher page. Absent = ungrouped. */
  group?: string
  /** GROUP SIGNATURE — `sign('group:<meaning>')`, the first-class identity of
   *  the set this member belongs to. Absent while the async derivation is in
   *  flight. */
  groupSig?: string
}

export interface LaunchGroup {
  id: string
  /** Material Symbols ligature for the group's MEANING. */
  icon: string
  label: string
  /** Launcher-tile silhouette for THIS group's members in the aggregator. */
  shape?: string
  /** Clustered-islands layout + members()-order reconcile (help opts in). */
  orderedLayout?: boolean
  /** CURATED group: its page layer's children ARE its membership (the
   *  aggregation-layer model) — no reconcile, no cursor forcing. */
  readonly curated?: boolean
  /** No browsable aggregator page: the rail icon opens the member directly. */
  openDirectly?: boolean
  members(): GroupMember[]
  /** Activate a single member — routing is owned by the group. */
  open(m: GroupMember): void
  /** Optional live "is this group's surface open" check for the rail. */
  isActive?(): boolean
}

export interface GroupLauncherProvider {
  register(group: LaunchGroup): void
  get(id: string): LaunchGroup | undefined
  all(): LaunchGroup[]
  /** The group whose layer the participant is standing in, or null. */
  currentId(): string | null
  /** The launcher icon click — the ONE state. */
  show(id: string): void
  /** Leave the aggregator page — explicit close affordances only. */
  exitBag(): void
  /** A provider calls this when its member set may have changed. */
  notifyChanged(): void
  /** Warm a group's aggregator on hover/intent. */
  prewarmGroup(id: string): void
}

/** One resolved member of a group's menu — decoded from a launcher child. */
export interface AggregationMember {
  /** The launcher child's marker sig — the entry's identity in [g]'s children. */
  childSig: string
  /** The launcher cell's label (its child-location leaf under [g]). */
  label: string
  /** Reference to the member's real root in the hive tree. */
  segments: string[]
  icon: string
}

/** The aggregation layer's shell-reachable surface (see
 *  documentation/aggregation-layer-model.md). Every function resolves its
 *  services through IoC at call time and answers the empty case gracefully. */
export interface AggregationLayerProvider {
  enableAggregation(
    groupId: string,
    segments: readonly string[],
    meta?: { label?: string; icon?: string },
  ): Promise<string | null>
  disableAggregation(groupId: string, segments: readonly string[]): Promise<boolean>
  listAggregation(groupId: string): Promise<AggregationMember[]>
  listAggregationAtCursor(groupId: string): Promise<AggregationMember[]>
}
