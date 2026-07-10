// diamondcoreprocessor.com/commands/decoration-kind-index.ts
//
// In-memory per-cell decoration-kind index used by overlay icon
// `visibleWhen` predicates. The icon for a visual bee should appear on
// a tile only when the cell's `decorations` slot contains at least one
// entry whose kind matches the bee's `decorationKind`.
//
// `visibleWhen` is synchronous — the overlay renderer can't await an
// OPFS read per tile per frame. So we maintain a hot in-memory map
// keyed by cell label, populated reactively from `decorations:changed`
// events. The `decorations:changed` payload carries `{ segments, op,
// sig }`; we look up the sig in the resource store (root sig file;
// legacy `__resources__/` is a read-fallback), parse its `kind`,
// and update the map. On remove we use a sig→kind reverse cache so we
// can subtract without re-fetching.
//
// Pattern parallels how SubstrateDrone exposes `hasSubstrate` via the
// overlay context — see substrate.drone.ts. The difference: we don't
// hook into the overlay context-builder (which would require
// per-feature edits to tile-overlay). Instead, visibleWhen looks the
// label up in our exported `hasDecorationKind` function, keeping the
// overlay renderer namespace-agnostic.
//
// ── Hydration from existing layers ────────────────────────────────────
//
// `decorations:changed` events cover live mutations. To pick up
// decorations committed in a prior session (or in any layer the user
// navigates to), we also listen to `render:cell-count` — fired by
// show-cell whenever the visible cell set changes — and walk each
// newly-seen label's layer, parsing its `decorations` slot. A
// `checkedLabels` set prevents redundant fetches across navigations.
// The walk is idempotent and additive: it only adds kinds, never
// subtracts (subtraction happens on explicit `removeSig` events).

import { EffectBus } from '@hypercomb/core'
import { hiddenKeysSync, hiddenKey } from '../sharing/feature-hidden.js'

/** Map<cellLabel, Set<decorationKind>>. Mutates in place — exported
 *  read function captures by reference. */
const kindsByLabel = new Map<string, Set<string>>()

/** Map<cellLabel, segments> — the full lineage path each label was indexed at.
 *  The hidden pool keys by (decorationKind, segments), so the index needs the
 *  location to ask "is this kind hidden HERE?". Captured wherever a label is
 *  indexed (the live `decorations:changed` event and the navigation walk both
 *  carry segments). This is what lets the ONE filter live here: the index is
 *  the read-model every draw-from-tiles consumer funnels through, so subtracting
 *  hidden once at its read functions filters overlay icons, the features-panel
 *  feed, and capability checks alike. */
const segmentsByLabel = new Map<string, readonly string[]>()

/** Is `kind` HIDDEN at this label's location? Reads the synchronous hidden-key
 *  snapshot (the participant-local pool the site-view gate also reads), so the
 *  filter is derived from one source however it's consumed. Unknown location →
 *  not hidden (fail-open: never suppress a feature we can't place). */
function isKindHidden(label: string, kind: string): boolean {
  const segs = segmentsByLabel.get(label)
  if (!segs) return false
  return hiddenKeysSync().has(hiddenKey(kind, segs))
}

/** Reverse cache: decoration sig → kind. Lets us subtract from the
 *  index on `removeSig` without re-fetching the decoration. */
const kindBySig = new Map<string, string>()

// ── Tag sub-index ─────────────────────────────────────────────────────
//
// Tags ride the SAME decoration primitive (kind `tag`, payload `{ name }`),
// so they hydrate through the exact same `decorations:changed` /
// `render:cell-count` paths as every other decoration — no second OPFS walk.
// The kind-index alone can't answer "which tag names does this cell carry"
// (it only tracks kind PRESENCE), so we keep a parallel name index plus a
// name→sig map the remove path uses to drop a single tag without a re-scan.

/** Decoration kind that marks a tag application. */
export const TAG_DECORATION_KIND = 'tag'

/** Map<cellLabel, Set<tagName>> — every tag name applied to a cell. */
const tagsByLabel = new Map<string, Set<string>>()

/** Map<cellLabel, Map<tagName, decorationSig>> — lets the remove path find
 *  the exact decoration sig to splice from a cell's slot by tag name. */
const sigByLabelTag = new Map<string, Map<string, string>>()

/** Reverse cache: decoration sig → tag name. A tag's sig is content-addressed,
 *  so the SAME sig is shared by every cell carrying that tag name — the name is
 *  constant for the sig, the cell is NOT. So we map sig → name only; on a
 *  `removeSig` we subtract `(payloadLabel, name)` using the cell from the event,
 *  never a stored label (which would strip the tag from the wrong cell). The
 *  entry is never deleted on remove — other cells still share the sig. */
const nameBySig = new Map<string, string>()

/** Public lookup. Returns true iff the cell at `label` has at least
 *  one decoration of `kind` in its `decorations` slot.
 *
 *  Designed for `visibleWhen` — must remain synchronous and O(1). */
export function hasDecorationKind(label: string, kind: string): boolean {
  return (kindsByLabel.get(label)?.has(kind) ?? false) && !isKindHidden(label, kind)
}

/** Iterate every decoration kind known for a cell. Useful for
 *  introspection / debug; not part of the visibleWhen hot path. */
export function kindsForLabel(label: string): readonly string[] {
  const set = kindsByLabel.get(label)
  if (!set) return []
  return [...set].filter(kind => !isKindHidden(label, kind))
}

/** Every tag name applied to a cell, from the in-memory index. Synchronous
 *  and O(1) — the badge renderer and show-cell's tag aggregation read this
 *  per visible cell. Returns [] for an unknown / untagged cell. */
export function tagsForLabel(label: string): readonly string[] {
  const set = tagsByLabel.get(label)
  return set ? [...set] : []
}

/** The decoration sig of a specific tag on a cell, or undefined if the index
 *  hasn't seen it. The remove path uses this to splice one tag from the cell's
 *  slot; callers fall back to `listDecorations` when the index is cold. */
export function tagSigFor(label: string, name: string): string | undefined {
  return sigByLabelTag.get(label)?.get(name)
}

// ── Launcher-shape sub-index ──────────────────────────────────────────
//
// Launch-group tiles (on the aggregator page) carry a `launch:target`
// decoration whose payload includes the owning group's `shape` (e.g.
// 'flower-pot', 'space-invader'). show-cell reads this PER CELL to pick each
// launcher tile's silhouette so groups never share a visual type. Hydrates
// through the same decorations:changed / render:cell-count paths as every other
// decoration — no extra OPFS walk.

/** Decoration kind that marks a launcher tile. */
export const LAUNCH_DECORATION_KIND = 'launch:target'

/** Decoration kind that marks a REFERENCE tile — a live pointer to another
 *  lineage. Its payload is `{ targetSegments: string[] }`. Clicking the tile
 *  portals to that location. See reference.drone.ts / reference.queen.ts. */
export const REFERENCE_DECORATION_KIND = 'reference'

/** Map<cellLabel, targetSegments> — the location a reference tile points at.
 *  A present entry (even `[]`, meaning the hive root) marks the label as a
 *  reference; absent means "not a reference". */
const referenceTargetByLabel = new Map<string, readonly string[]>()

/** The location a reference tile points at, or `null` if the label is not a
 *  reference. `[]` is a valid target (the hive root) and is DISTINCT from
 *  `null`. Synchronous + O(1) — tile-overlay reads it per click to decide
 *  whether a body press should portal instead of entering a child. */
export function referenceTargetForLabel(label: string): readonly string[] | null {
  return referenceTargetByLabel.get(label) ?? null
}

/** Map<cellLabel, shapeId> — the owning group's silhouette for a launcher tile. */
const launchShapeByLabel = new Map<string, string>()

/** Map<cellLabel, memberKey> — the member's STABLE id from the `launch:target`
 *  payload (help → the keymap cmd, games → gameId). Lets hover features
 *  resolve a launcher tile back to the thing it launches without matching on
 *  display labels. */
const launchKeyByLabel = new Map<string, string>()

/** The launcher silhouette id for a cell ('' if none / not a launcher tile).
 *  Synchronous and O(1) — show-cell reads it per visible cell at geometry build. */
export function launchShapeForLabel(label: string): string {
  return launchShapeByLabel.get(label) ?? ''
}

/** The launcher member key for a cell ('' if none). Synchronous and O(1) —
 *  the action-card drone resolves a hovered keycap to its keymap cmd here. */
export function launchKeyForLabel(label: string): string {
  return launchKeyByLabel.get(label) ?? ''
}

/** Map<cellLabel, role> — the launcher tile's layout role ('header' for a
 *  category-title tile). Absent = a normal action tile. */
const launchRoleByLabel = new Map<string, string>()

/** The launcher layout role for a cell ('' if none / a normal action tile).
 *  Synchronous and O(1) — show-cell reads it per visible cell to group the
 *  clustered-island layout on the help page. */
export function launchRoleForLabel(label: string): string {
  return launchRoleByLabel.get(label) ?? ''
}

/** Map<cellLabel, group> — the clustered-help island id a launcher tile belongs
 *  to. Every tile of one island shares it. Absent = ungrouped. */
const launchGroupByLabel = new Map<string, string>()

/** The clustered-help island id for a cell ('' if none). Synchronous and O(1) —
 *  show-cell gathers each island by this id, independent of render order. */
export function launchGroupForLabel(label: string): string {
  return launchGroupByLabel.get(label) ?? ''
}

// ── Dashboard-island sub-index ────────────────────────────────────────
//
// Dashboard question tiles carry a `dashboard-island` decoration whose payload
// holds the island `group` id and a `role` ('header' for a category-title
// tile). show-cell reads these PER CELL to lay the dashboard bag out as
// clustered islands — the SAME layout the /help page uses — but WITHOUT a
// `launch:target` decoration (which would hijack the click into `group:open`
// instead of opening the Q&A modal). Hydrates through the same
// decorations:changed / render:cell-count paths as every other decoration.

/** Decoration kind that groups a dashboard question tile into an island. */
export const DASHBOARD_ISLAND_KIND = 'dashboard-island'

/** Map<cellLabel, islandId> — the dashboard island a tile belongs to. Every
 *  tile of one island shares it. Absent = ungrouped. */
const islandGroupByLabel = new Map<string, string>()
/** Map<cellLabel, role> — 'header' for a category-title tile, else a question. */
const islandRoleByLabel = new Map<string, string>()

/** The dashboard island id for a cell ('' if none). Synchronous and O(1) —
 *  show-cell gathers each island by this id, independent of render order. */
export function dashboardIslandGroupForLabel(label: string): string {
  return islandGroupByLabel.get(label) ?? ''
}

/** The dashboard island role for a cell ('' / 'header'). Synchronous, O(1). */
export function dashboardIslandRoleForLabel(label: string): string {
  return islandRoleByLabel.get(label) ?? ''
}

// ── Overlap metric (the one popularity signal) ────────────────────────
//
// "Popularity" = how many cells SHARE an entity — the overlap count. The
// kind-index already holds exactly this: a decoration kind / tag name is
// applied to N cells. We count over the cells the index has seen (navigated
// this session), which is the live, available signal. Exposed via IoC so the
// shell command-line (which can't import essentials) can rank suggestions by
// it. Scope: counts cells that carry the kind/tag, honouring the hidden pool.

/** How many indexed cells carry a (non-hidden) decoration of `kind`. */
export function countLabelsWithKind(kind: string): number {
  if (!kind) return 0
  let n = 0
  for (const [label, set] of kindsByLabel) {
    if (set.has(kind) && !isKindHidden(label, kind)) n++
  }
  return n
}

/** How many indexed cells carry the tag `name`. */
export function countLabelsWithTag(name: string): number {
  if (!name) return 0
  let n = 0
  for (const set of tagsByLabel.values()) if (set.has(name)) n++
  return n
}

// Register the overlap-metric reader so the shell can resolve it via IoC,
// mirroring how it reaches DecorationService / VisualBeeRegistry.
window.ioc.register('@diamondcoreprocessor.com/OverlapMetrics', {
  kindCount: countLabelsWithKind,
  tagCount: countLabelsWithTag,
})

type StoreLike = {
  getResource(sig: string): Promise<Blob | null>
}

type DecorationShape = { kind?: string; payload?: unknown }

async function fetchDecorationRecord(sig: string): Promise<DecorationShape | null> {
  const store = window.ioc.get<StoreLike>('@hypercomb.social/Store')
  if (!store?.getResource) return null
  try {
    const blob = await store.getResource(sig)
    if (!blob) return null
    const record = JSON.parse(await blob.text()) as DecorationShape
    return record && typeof record === 'object' ? record : null
  } catch {
    return null
  }
}

/** Pull a tag name out of a decoration record's `{ name }` payload. */
function tagNameOf(record: DecorationShape): string | null {
  const payload = record.payload
  const name = payload && typeof payload === 'object'
    ? (payload as { name?: unknown }).name
    : undefined
  return typeof name === 'string' && name.length > 0 ? name : null
}

/** Pull the launcher silhouette out of a `launch:target` payload's `{ shape }`. */
function shapeOf(record: DecorationShape): string | null {
  const payload = record.payload
  const shape = payload && typeof payload === 'object'
    ? (payload as { shape?: unknown }).shape
    : undefined
  return typeof shape === 'string' && shape.length > 0 ? shape : null
}

/** Pull the launcher member key out of a `launch:target` payload's `{ key }`. */
function keyOf(record: DecorationShape): string | null {
  const payload = record.payload
  const key = payload && typeof payload === 'object'
    ? (payload as { key?: unknown }).key
    : undefined
  return typeof key === 'string' && key.length > 0 ? key : null
}

/** Pull the launcher layout role out of a `launch:target` payload's `{ role }`
 *  ('header' for a category-title tile). Absent → a normal action tile. */
function roleOf(record: DecorationShape): string | null {
  const payload = record.payload
  const role = payload && typeof payload === 'object'
    ? (payload as { role?: unknown }).role
    : undefined
  return typeof role === 'string' && role.length > 0 ? role : null
}

/** Pull the launcher island id out of a `launch:target` payload's `{ group }`.
 *  Every tile of one clustered-help island shares it. Absent → ungrouped. */
function groupOf(record: DecorationShape): string | null {
  const payload = record.payload
  const group = payload && typeof payload === 'object'
    ? (payload as { group?: unknown }).group
    : undefined
  return typeof group === 'string' && group.length > 0 ? group : null
}

/** Pull the target path out of a `reference` payload's `{ targetSegments }`.
 *  Returns `null` when the field is absent/malformed so the caller can skip
 *  indexing (a reference with no target is meaningless). */
function targetSegmentsOf(record: DecorationShape): readonly string[] | null {
  const payload = record.payload
  const raw = payload && typeof payload === 'object'
    ? (payload as { targetSegments?: unknown }).targetSegments
    : undefined
  if (!Array.isArray(raw)) return null
  return raw.map(s => String(s)).filter(s => s.length > 0)
}

function addTag(label: string, name: string, sig: string): void {
  let set = tagsByLabel.get(label)
  if (!set) { set = new Set<string>(); tagsByLabel.set(label, set) }
  set.add(name)
  let bySig = sigByLabelTag.get(label)
  if (!bySig) { bySig = new Map<string, string>(); sigByLabelTag.set(label, bySig) }
  bySig.set(name, sig)
  nameBySig.set(sig, name)
}

function removeTag(label: string, name: string): void {
  const set = tagsByLabel.get(label)
  if (set) { set.delete(name); if (set.size === 0) tagsByLabel.delete(label) }
  const bySig = sigByLabelTag.get(label)
  if (bySig) { bySig.delete(name); if (bySig.size === 0) sigByLabelTag.delete(label) }
}

/** Fold a freshly-fetched decoration record into the indices: always the
 *  kind index, plus the tag sub-index when it's a `tag`. Shared by the live
 *  `decorations:changed` path and the navigation hydration walk. */
function indexRecord(label: string, sig: string, record: DecorationShape): void {
  const kind = typeof record.kind === 'string' ? record.kind : null
  if (!kind) return
  addKind(label, kind)
  kindBySig.set(sig, kind)
  if (kind === TAG_DECORATION_KIND) {
    const name = tagNameOf(record)
    if (name) addTag(label, name, sig)
  }
  if (kind === LAUNCH_DECORATION_KIND) {
    const shape = shapeOf(record)
    if (shape) launchShapeByLabel.set(label, shape)
    const key = keyOf(record)
    if (key) launchKeyByLabel.set(label, key)
    const role = roleOf(record)
    if (role) launchRoleByLabel.set(label, role)
    else launchRoleByLabel.delete(label)
    const group = groupOf(record)
    if (group) launchGroupByLabel.set(label, group)
    else launchGroupByLabel.delete(label)
  }
  if (kind === DASHBOARD_ISLAND_KIND) {
    const group = groupOf(record)
    if (group) islandGroupByLabel.set(label, group)
    else islandGroupByLabel.delete(label)
    const role = roleOf(record)
    if (role) islandRoleByLabel.set(label, role)
    else islandRoleByLabel.delete(label)
  }
  if (kind === REFERENCE_DECORATION_KIND) {
    const target = targetSegmentsOf(record)
    if (target) referenceTargetByLabel.set(label, target)
    else referenceTargetByLabel.delete(label)
  }
}

function addKind(label: string, kind: string): void {
  let set = kindsByLabel.get(label)
  if (!set) {
    set = new Set<string>()
    kindsByLabel.set(label, set)
  }
  set.add(kind)
}

function removeKind(label: string, kind: string): void {
  const set = kindsByLabel.get(label)
  if (!set) return
  set.delete(kind)
  if (set.size === 0) kindsByLabel.delete(label)
}

/** Decoration-trigger payload contract. Mirrors the LayerSlotRegistry
 *  contract for triggers: `{ segments, op, sig }`. */
type DecorationsChangedPayload = {
  readonly segments?: readonly string[]
  readonly op?: 'append' | 'removeSig'
  readonly sig?: string
}

EffectBus.on('decorations:changed', async (payload: DecorationsChangedPayload | undefined) => {
  if (!payload?.segments || !payload?.sig || !payload?.op) return
  const segments = payload.segments
  const sig = payload.sig
  const label = segments[segments.length - 1]
  if (!label) return
  // Remember where this label lives so the hidden filter can ask the pool
  // "is this kind hidden HERE?" (the pool keys by kind + location).
  segmentsByLabel.set(label, segments)

  if (payload.op === 'append') {
    const priorShape = launchShapeByLabel.get(label)
    const priorRole = launchRoleByLabel.get(label)
    const priorGroup = launchGroupByLabel.get(label)
    const priorIslandGroup = islandGroupByLabel.get(label)
    const priorIslandRole = islandRoleByLabel.get(label)
    const record = await fetchDecorationRecord(sig)
    if (!record) return
    indexRecord(label, sig, record)
    // This append landed ASYNCHRONOUSLY (the record fetch above), AFTER the
    // synchronous `tags:changed` → show-cell `render:tags` re-aggregation that
    // a tag write triggers. Without a nudge, the last cell of a multi-cell tag
    // op is indexed too late to be counted, so pills/badges undercount by one.
    // Re-signal so show-cell recomputes with this cell now in the index — the
    // same hook the navigation-hydration walk uses.
    if (record.kind === TAG_DECORATION_KIND) EffectBus.emit('tags:indexed', { labels: [label] })
    // Same first-paint race for launcher tiles: the `shape` lands after the
    // aggregator page first rendered (as plain hexagons). Nudge show-cell to
    // rebuild its geometry so each tile picks up its group's silhouette — but
    // ONLY when the shape actually changed: show-cell's pre-paint hydration
    // (ensureDecorationsIndexed) usually indexed it already, and re-nudging
    // would queue a redundant full geometry rebuild right after entry.
    if (record.kind === LAUNCH_DECORATION_KIND
        && (launchShapeByLabel.get(label) !== priorShape
          || launchRoleByLabel.get(label) !== priorRole
          || launchGroupByLabel.get(label) !== priorGroup)) {
      EffectBus.emit('launch:indexed', { label })
    }
    // Same first-paint race for dashboard-island tiles: the island id lands
    // after the bag first rendered (as a plain spiral). Reuse the launch:indexed
    // nudge — show-cell rebuilds geometry on it regardless of kind — so the
    // clustered islands appear without waiting for an unrelated render.
    if (record.kind === DASHBOARD_ISLAND_KIND
        && (islandGroupByLabel.get(label) !== priorIslandGroup
          || islandRoleByLabel.get(label) !== priorIslandRole)) {
      EffectBus.emit('launch:indexed', { label })
    }
  } else if (payload.op === 'removeSig') {
    const kind = kindBySig.get(sig)
    if (kind) {
      removeKind(label, kind)
      kindBySig.delete(sig)
    }
    if (kind === LAUNCH_DECORATION_KIND) {
      launchShapeByLabel.delete(label)
      launchKeyByLabel.delete(label)
      launchRoleByLabel.delete(label)
      launchGroupByLabel.delete(label)
    }
    if (kind === DASHBOARD_ISLAND_KIND) {
      islandGroupByLabel.delete(label)
      islandRoleByLabel.delete(label)
    }
    if (kind === REFERENCE_DECORATION_KIND) {
      referenceTargetByLabel.delete(label)
    }
    // A tag's resource is content-addressed and shared across cells, so subtract
    // it from the cell named in THIS event (`label`), using the sig's constant
    // tag name. Never delete `nameBySig[sig]` — other cells still share it.
    const name = nameBySig.get(sig)
    if (name) removeTag(label, name)
  }
})

// ── Startup / navigation hydration ────────────────────────────────────
//
// Labels we've already walked. Persistent across the session — once a
// cell's `decorations` slot has been scanned, subsequent mutations come
// through the `decorations:changed` trigger and update the index live.

/** Map<label, Set<full-path key>>. Keyed by LOCATION, not label alone: the
 *  same label exists at several locations with different decorations (the
 *  root tile "susan" vs the `agg-mix` launcher cell "susan"). A label-only
 *  memo let whichever location rendered first BLOCK the walk everywhere
 *  else — launcher cells never got their `launch:target` shape indexed when
 *  their label had been seen on the hive, so the aggregator page rendered a
 *  mix of silhouettes and plain hexagons. */
const checkedLabels = new Map<string, Set<string>>()

/** Forget that we've walked `label` so the next `render:cell-count` re-walks
 *  its `decorations` slot. Called when a tile's whole layer is replaced
 *  out-of-band — e.g. a swarm `sync` folds the publisher's branch over the
 *  local copy, which can add decorations WITHOUT firing per-decoration
 *  `decorations:changed` events. Additive-safe: we only clear the
 *  checked-flag (not the kind set), so the re-walk adds any new kinds while
 *  the existing ones keep the `features` icon stable across the refresh.
 *  Clears the label at EVERY location — callers don't know the path. */
export function forgetDecorationLabel(label: string): void {
  checkedLabels.delete(label)
}

type LineageLike = {
  explorerSegments?: () => readonly string[]
}

type HistoryServiceLike = {
  sign(lineage: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<unknown | null>
}

async function hydrateLabel(
  label: string,
  parentSegments: readonly string[],
  history: HistoryServiceLike,
  nudge = true,
): Promise<boolean> {
  const segments = [...parentSegments, label]
  const pathKey = segments.join('\u0000')
  let seenPaths = checkedLabels.get(label)
  if (seenPaths?.has(pathKey)) return false
  if (!seenPaths) { seenPaths = new Set<string>(); checkedLabels.set(label, seenPaths) }
  seenPaths.add(pathKey)

  try {
    segmentsByLabel.set(label, segments)
    const locationSig = await history.sign({ explorerSegments: () => segments })
    const layer = await history.currentLayerAt(locationSig) as { decorations?: unknown } | null
    if (!layer) return false
    const decorations = layer.decorations
    if (!Array.isArray(decorations)) return false
    for (const decorationSig of decorations) {
      if (typeof decorationSig !== 'string' || !/^[0-9a-f]{64}$/.test(decorationSig)) continue
      const record = await fetchDecorationRecord(decorationSig)
      if (!record) continue
      indexRecord(label, decorationSig, record)
    }
    // A launcher tile discovered on this walk: nudge show-cell to rebuild its
    // geometry so the tile's silhouette — or its clustered ISLAND (help
    // group/role, dashboard islands) — appears (the walk runs after first
    // paint). Without the launchGroup term a boot whose pre-paint warm came
    // up cold (big profile, layers not cached yet) painted /help as a plain
    // spiral of substrate tiles and nothing ever re-clustered it. The
    // pre-paint hydration path (ensureDecorationsIndexed) passes nudge=false —
    // nothing is painted yet, so a rebuild request would only queue a
    // redundant second render.
    if (nudge && (launchShapeByLabel.has(label) || launchGroupByLabel.has(label) || islandGroupByLabel.has(label))) EffectBus.emit('launch:indexed', { label })
    return tagsByLabel.has(label)
  } catch {
    // Layer unavailable or fetch error — skip this location; another render
    // pass will retry (the path key is set BEFORE the await, so a failed
    // walk doesn't replay forever; remove it to retry on the next event).
    seenPaths.delete(pathKey)
    return false
  }
}

/** Awaitable PRE-PAINT hydration for launch-group aggregator pages. The
 *  launcher silhouette is baked into mesh geometry (aShapeMode), so show-cell
 *  awaits this before building an `agg-` page's geometry — painting first and
 *  indexing later shows every launcher as a full-size picture hexagon that
 *  visibly shrinks into its group silhouette when the async walk lands.
 *  Rides hydrateLabel's checkedLabels memo, so repeat calls per label are
 *  synchronous no-ops. */
export async function ensureDecorationsIndexed(
  labels: readonly string[],
  parentSegments: readonly string[],
): Promise<void> {
  const history = window.ioc.get<HistoryServiceLike>('@diamondcoreprocessor.com/HistoryService')
  if (!history) return
  await Promise.all(labels.map(label => hydrateLabel(label, parentSegments, history, false)))
}

type RenderCellCountPayload = {
  readonly labels?: readonly string[]
}

EffectBus.on('render:cell-count', (payload: RenderCellCountPayload | undefined) => {
  const labels = payload?.labels
  if (!Array.isArray(labels) || labels.length === 0) return
  const lineage = window.ioc.get<LineageLike>('@hypercomb.social/Lineage')
  const history = window.ioc.get<HistoryServiceLike>('@diamondcoreprocessor.com/HistoryService')
  if (!history) return
  const parentSegments = lineage?.explorerSegments?.() ?? []
  // Walk each label in parallel — independent layer fetches. When a first-time
  // walk discovers tags on a cell, signal `tags:indexed` so the tag renderers
  // (controls-bar aggregation, on-tile badge) repaint without waiting for the
  // next user action — the index hydrates AFTER render:cell-count fires.
  void Promise.all(labels.map(label => hydrateLabel(label, parentSegments, history)))
    .then(results => {
      const tagged = labels.filter((_, i) => results[i])
      if (tagged.length) EffectBus.emit('tags:indexed', { labels: tagged })
    })
})
