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

// ── Location keys ─────────────────────────────────────────────────────
//
// EVERY sub-index below is keyed by LOCATION (`segments.join('\0')`), never by
// bare cell label. A label is not an identity: the same name exists at many
// places in a hive, and a REFERENCE tile is named after its target, so a
// reference and its target ALWAYS share a name — as do two references to the
// same place. Label-keyed buckets UNIONED all of them: painting a pheromone on
// one reference showed it on every same-named tile, and a filter then acted on
// that union. (The `checkedLabels` memo below was already made location-aware
// for the same reason; the index itself had been left behind, which made the
// smear total — every location walks, every walk folds into one bucket.)
//
// Reads take a bare label because that is all a `visibleWhen` / geometry pass
// has. They resolve it against the location being rendered and DO NOT GUESS
// past a miss: answering with some other cell's decorations is the defect.

/** NUL — the one character a tile name can never carry, so a joined key is
 *  unambiguous. Same convention as `checkedLabels`' path key below. */
const SEP = '\u0000'

const locationKey = (segments: readonly string[]): string => segments.join(SEP)

/** Map<locationKey, Set<decorationKind>>. Mutates in place — exported
 *  read function captures by reference. */
const kindsByKey = new Map<string, Set<string>>()

/** Map<locationKey, segments> — the full lineage path behind each key.
 *  The hidden pool keys by (decorationKind, segments), so the index needs the
 *  location to ask "is this kind hidden HERE?". Captured wherever a cell is
 *  indexed (the live `decorations:changed` event and the navigation walk both
 *  carry segments). This is what lets the ONE filter live here: the index is
 *  the read-model every draw-from-tiles consumer funnels through, so subtracting
 *  hidden once at its read functions filters overlay icons, the features-panel
 *  feed, and capability checks alike. */
const segmentsByKey = new Map<string, readonly string[]>()

/** Absolute location key per label for the page currently FLATTENED by a tag
 *  filter. A flattened match lives anywhere, so `here + label` is a phantom
 *  path for it — show-cell hands us the real ones in `render:cell-count`'s
 *  `flatPaths` (the same map tile-overlay uses to route a click). Empty on
 *  every ordinary page: cleared on each emit, so a filter's paths can never
 *  leak into the next render. */
const flatKeyByLabel = new Map<string, string>()

/** Location key of the page being rendered, memoized on the segments array's
 *  IDENTITY — Lineage replaces `explorerPath` wholesale on navigation, so a
 *  changed reference is exactly "we moved" and the join runs once per nav
 *  rather than once per cell per frame. Reading live (rather than caching the
 *  page from `render:cell-count`) keeps resolution correct for consumers that
 *  read DURING geometry build, before the count is emitted. */
let memoSegments: readonly string[] | null = null
let memoParentKey = ''

function currentParentKey(): string {
  const lineage = window.ioc.get<LineageLike>('@hypercomb.social/Lineage')
  const segs = lineage?.explorerSegments?.()
  if (!segs) return ''
  if (segs !== memoSegments) {
    memoSegments = segs
    memoParentKey = locationKey(segs)
  }
  return memoParentKey
}

/** Resolve a bare label to the location key it denotes ON THE PAGE BEING READ.
 *  Flattened matches resolve to their absolute path; everything else is the
 *  current location plus the label. Deliberately total (never null) so a miss
 *  reads as "this cell carries nothing", which is the safe answer — the unsafe
 *  one is another cell's decorations. */
function keyForLabel(label: string): string {
  const flat = flatKeyByLabel.get(label)
  if (flat !== undefined) return flat
  const parent = currentParentKey()
  return parent ? parent + SEP + label : label
}

/** Is `kind` HIDDEN at this location? Reads the synchronous hidden-key
 *  snapshot (the participant-local pool the site-view gate also reads), so the
 *  filter is derived from one source however it's consumed. Unknown location →
 *  not hidden (fail-open: never suppress a feature we can't place). */
function isKindHidden(key: string, kind: string): boolean {
  const segs = segmentsByKey.get(key)
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

/** Map<locationKey, Set<tagName>> — every tag name applied to a cell. */
const tagsByKey = new Map<string, Set<string>>()

/** Map<locationKey, Map<tagName, decorationSig>> — lets the remove path find
 *  the exact decoration sig to splice from a cell's slot by tag name. */
const sigByKeyTag = new Map<string, Map<string, string>>()

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
  const key = keyForLabel(label)
  return (kindsByKey.get(key)?.has(kind) ?? false) && !isKindHidden(key, kind)
}

/** Iterate every decoration kind known for a cell. Useful for
 *  introspection / debug; not part of the visibleWhen hot path. */
export function kindsForLabel(label: string): readonly string[] {
  const key = keyForLabel(label)
  const set = kindsByKey.get(key)
  if (!set) return []
  return [...set].filter(kind => !isKindHidden(key, kind))
}

/** Every tag name applied to a cell, from the in-memory index. Synchronous
 *  and O(1) — the badge renderer and show-cell's tag aggregation read this
 *  per visible cell. Returns [] for an unknown / untagged cell. */
export function tagsForLabel(label: string): readonly string[] {
  const set = tagsByKey.get(keyForLabel(label))
  return set ? [...set] : []
}

/** The decoration sig of a specific tag on a cell, or undefined if the index
 *  hasn't seen it. The remove path uses this to splice one tag from the cell's
 *  slot; callers fall back to `listDecorations` when the index is cold.
 *
 *  Pass `segments` whenever the caller has them: a tag's resource is
 *  content-addressed and therefore SHARED by every cell carrying that name, so
 *  the sig alone can't say which cell it came from — resolving the wrong
 *  location here would splice the tag off a same-named cell somewhere else. */
export function tagSigFor(
  label: string,
  name: string,
  segments?: readonly string[],
): string | undefined {
  const key = segments ? locationKey(segments) : keyForLabel(label)
  return sigByKeyTag.get(key)?.get(name)
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

/** Map<locationKey, targetSegments> — the location a reference tile points at.
 *  A present entry (even `[]`, meaning the hive root) marks the cell as a
 *  reference; absent means "not a reference". */
const referenceTargetByKey = new Map<string, readonly string[]>()

/** The location a reference tile points at, or `null` if the cell is not a
 *  reference. `[]` is a valid target (the hive root) and is DISTINCT from
 *  `null`. Synchronous + O(1) — tile-overlay reads it per click to decide
 *  whether a body press should portal instead of entering a child. */
export function referenceTargetForLabel(label: string): readonly string[] | null {
  return referenceTargetByKey.get(keyForLabel(label)) ?? null
}

// ── Title sub-index (the display name) ────────────────────────────────
//
// A tile's layer `name` is its ADDRESS, not its caption. The lineage bag is
// `sha256(lineageKey(segments))` and the committer matches children by name in
// half a dozen places, so changing a name re-addresses the tile and strands
// every path-keyed record behind it: the history bag, viewport, substrate,
// tile properties, usage weight, the swarm channel sig, the published host
// manifest entry, static followers, hidden-feature keys, and every inbound
// reference.
//
// So the name never moves. A `title` decoration carries the display text while
// the address stays put, which makes a rename one ordinary layer commit on the
// tile — undoable, shareable and per-location like any other decoration. The
// label atlas already had the slug→display seam (`setLabelResolver`, built for
// i18n); this feeds it.
//
// The trade is deliberate: the path and URL keep the name the tile was born
// with. Re-addressing a tile for real is a separate, heavier operation.

/** Decoration kind carrying a cell's display title, keyed BY LOCALE:
 *  payload `{ text: { en: 'Jazz Standards', ja: 'ジャズ' } }`.
 *
 *  A title is not a second name — it is the tile's name INTERPRETED in one
 *  language. The address stays language-neutral and every locale is an equal
 *  reading of it, which is why no locale is privileged as a fallback below. */
export const TITLE_DECORATION_KIND = 'title'

/** Map<locationKey, Record<locale, title>>. */
const titleByKey = new Map<string, Record<string, string>>()

/** The title for a cell in `locale`, or '' when it carries none for that
 *  locale — the caller then falls back to i18n and finally the raw name.
 *
 *  Deliberately does NOT fall back across locales: titling in English must not
 *  put English text in front of a Japanese reader. An untranslated tile shows
 *  its address, which is honest, and `/translate-sweep` can fill the gap.
 *
 *  Synchronous and O(1) — the atlas label resolver calls this per cell per
 *  bake, so it must never touch OPFS. */
export function titleForLabel(label: string, locale: string): string {
  return titleByKey.get(keyForLabel(label))?.[locale] ?? ''
}

/** The same lookup by FULL PATH rather than a bare label.
 *
 *  `titleForLabel` resolves a label against the page being read, which is right
 *  for tiles on screen but wrong for the breadcrumb: its entries are ancestors,
 *  not children of the current location. Keying by the whole path answers for
 *  any cell the index has walked. A miss returns '' and the caller shows the
 *  raw name — the breadcrumb degrades to addresses rather than going blank. */
export function titleForSegments(segments: readonly string[], locale: string): string {
  return titleByKey.get(locationKey(segments))?.[locale] ?? ''
}

/** Map<locationKey, shapeId> — the owning group's silhouette for a launcher tile. */
const launchShapeByKey = new Map<string, string>()

/** Map<locationKey, memberKey> — the member's STABLE id from the `launch:target`
 *  payload (help → the keymap cmd, games → gameId). Lets hover features
 *  resolve a launcher tile back to the thing it launches without matching on
 *  display labels. */
const launchKeyByKey = new Map<string, string>()

/** The launcher silhouette id for a cell ('' if none / not a launcher tile).
 *  Synchronous and O(1) — show-cell reads it per visible cell at geometry build. */
export function launchShapeForLabel(label: string): string {
  return launchShapeByKey.get(keyForLabel(label)) ?? ''
}

/** The launcher member key for a cell ('' if none). Synchronous and O(1) —
 *  the action-card drone resolves a hovered keycap to its keymap cmd here. */
export function launchKeyForLabel(label: string): string {
  return launchKeyByKey.get(keyForLabel(label)) ?? ''
}

/** Map<locationKey, role> — the launcher tile's layout role ('header' for a
 *  category-title tile). Absent = a normal action tile. */
const launchRoleByKey = new Map<string, string>()

/** The launcher layout role for a cell ('' if none / a normal action tile).
 *  Synchronous and O(1) — show-cell reads it per visible cell to group the
 *  clustered-island layout on the help page. */
export function launchRoleForLabel(label: string): string {
  return launchRoleByKey.get(keyForLabel(label)) ?? ''
}

/** Map<locationKey, group> — the clustered-help island id a launcher tile
 *  belongs to. Every tile of one island shares it. Absent = ungrouped. */
const launchGroupByKey = new Map<string, string>()

/** The clustered-help island id for a cell ('' if none). Synchronous and O(1) —
 *  show-cell gathers each island by this id, independent of render order. */
export function launchGroupForLabel(label: string): string {
  return launchGroupByKey.get(keyForLabel(label)) ?? ''
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

/** Map<locationKey, islandId> — the dashboard island a tile belongs to. Every
 *  tile of one island shares it. Absent = ungrouped. */
const islandGroupByKey = new Map<string, string>()
/** Map<locationKey, role> — 'header' for a category-title tile, else a question. */
const islandRoleByKey = new Map<string, string>()

/** The dashboard island id for a cell ('' if none). Synchronous and O(1) —
 *  show-cell gathers each island by this id, independent of render order. */
export function dashboardIslandGroupForLabel(label: string): string {
  return islandGroupByKey.get(keyForLabel(label)) ?? ''
}

/** The dashboard island role for a cell ('' / 'header'). Synchronous, O(1). */
export function dashboardIslandRoleForLabel(label: string): string {
  return islandRoleByKey.get(keyForLabel(label)) ?? ''
}

// ── Overlap metric (the one popularity signal) ────────────────────────
//
// "Popularity" = how many cells SHARE an entity — the overlap count. The
// kind-index already holds exactly this: a decoration kind / tag name is
// applied to N cells. We count over the cells the index has seen (navigated
// this session), which is the live, available signal. Exposed via IoC so the
// shell command-line (which can't import essentials) can rank suggestions by
// it. Scope: counts cells that carry the kind/tag, honouring the hidden pool.
// Counts CELLS, not names: two same-named tiles at different locations are two
// carriers, which is what "how many share it" means (and was undercounted for
// as long as the index collapsed them into one bucket).

/** How many indexed cells carry a (non-hidden) decoration of `kind`. */
export function countLabelsWithKind(kind: string): number {
  if (!kind) return 0
  let n = 0
  for (const [key, set] of kindsByKey) {
    if (set.has(kind) && !isKindHidden(key, kind)) n++
  }
  return n
}

/** How many indexed cells carry the tag `name`. */
export function countLabelsWithTag(name: string): number {
  if (!name) return 0
  let n = 0
  for (const set of tagsByKey.values()) if (set.has(name)) n++
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

/** Pull the per-locale titles out of a `title` payload's `{ text }` map.
 *  Blank or whitespace-only entries are dropped rather than stored, so a
 *  cleared title falls back to the raw label — a tile must never draw as an
 *  empty hexagon because someone emptied the field. Returns null when no
 *  locale survives, which un-indexes the cell entirely. */
function textOf(record: DecorationShape): Record<string, string> | null {
  const payload = record.payload
  const text = payload && typeof payload === 'object'
    ? (payload as { text?: unknown }).text
    : undefined
  if (!text || typeof text !== 'object') return null
  const byLocale: Record<string, string> = {}
  for (const [locale, value] of Object.entries(text as Record<string, unknown>)) {
    if (typeof value === 'string' && value.trim().length > 0) byLocale[locale] = value.trim()
  }
  return Object.keys(byLocale).length > 0 ? byLocale : null
}

function addTag(key: string, name: string, sig: string): void {
  let set = tagsByKey.get(key)
  if (!set) { set = new Set<string>(); tagsByKey.set(key, set) }
  set.add(name)
  let bySig = sigByKeyTag.get(key)
  if (!bySig) { bySig = new Map<string, string>(); sigByKeyTag.set(key, bySig) }
  bySig.set(name, sig)
  nameBySig.set(sig, name)
}

function removeTag(key: string, name: string): void {
  const set = tagsByKey.get(key)
  if (set) { set.delete(name); if (set.size === 0) tagsByKey.delete(key) }
  const bySig = sigByKeyTag.get(key)
  if (bySig) { bySig.delete(name); if (bySig.size === 0) sigByKeyTag.delete(key) }
}

/** Fold a freshly-fetched decoration record into the indices: always the
 *  kind index, plus the tag sub-index when it's a `tag`. Shared by the live
 *  `decorations:changed` path and the navigation hydration walk.
 *
 *  Takes SEGMENTS, not a label — the location is the identity here. Both
 *  callers already hold the full path; passing the leaf alone is what let one
 *  cell's decorations answer for a same-named cell somewhere else. */
function indexRecord(segments: readonly string[], sig: string, record: DecorationShape): void {
  const kind = typeof record.kind === 'string' ? record.kind : null
  if (!kind) return
  const key = locationKey(segments)
  segmentsByKey.set(key, segments)
  addKind(key, kind)
  kindBySig.set(sig, kind)
  if (kind === TAG_DECORATION_KIND) {
    const name = tagNameOf(record)
    if (name) addTag(key, name, sig)
  }
  if (kind === LAUNCH_DECORATION_KIND) {
    const shape = shapeOf(record)
    if (shape) launchShapeByKey.set(key, shape)
    const memberKey = keyOf(record)
    if (memberKey) launchKeyByKey.set(key, memberKey)
    const role = roleOf(record)
    if (role) launchRoleByKey.set(key, role)
    else launchRoleByKey.delete(key)
    const group = groupOf(record)
    if (group) launchGroupByKey.set(key, group)
    else launchGroupByKey.delete(key)
  }
  if (kind === DASHBOARD_ISLAND_KIND) {
    const group = groupOf(record)
    if (group) islandGroupByKey.set(key, group)
    else islandGroupByKey.delete(key)
    const role = roleOf(record)
    if (role) islandRoleByKey.set(key, role)
    else islandRoleByKey.delete(key)
  }
  if (kind === REFERENCE_DECORATION_KIND) {
    const target = targetSegmentsOf(record)
    if (target) referenceTargetByKey.set(key, target)
    else referenceTargetByKey.delete(key)
  }
  if (kind === TITLE_DECORATION_KIND) {
    const text = textOf(record)
    if (text) titleByKey.set(key, text)
    else titleByKey.delete(key)
  }
}

function addKind(key: string, kind: string): void {
  let set = kindsByKey.get(key)
  if (!set) {
    set = new Set<string>()
    kindsByKey.set(key, set)
  }
  set.add(kind)
}

function removeKind(key: string, kind: string): void {
  const set = kindsByKey.get(key)
  if (!set) return
  set.delete(kind)
  if (set.size === 0) kindsByKey.delete(key)
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
  // The event carries the FULL path, so the write lands at the exact cell that
  // changed — never at whatever else happens to share its name.
  const key = locationKey(segments)
  // Remember where this cell lives so the hidden filter can ask the pool
  // "is this kind hidden HERE?" (the pool keys by kind + location).
  segmentsByKey.set(key, segments)

  if (payload.op === 'append') {
    const priorShape = launchShapeByKey.get(key)
    const priorRole = launchRoleByKey.get(key)
    const priorGroup = launchGroupByKey.get(key)
    const priorIslandGroup = islandGroupByKey.get(key)
    const priorIslandRole = islandRoleByKey.get(key)
    // Stringified: the map is rebuilt on every index, so a reference compare
    // would report a change on every pass and repaint the hive needlessly.
    const priorTitle = JSON.stringify(titleByKey.get(key) ?? null)
    const record = await fetchDecorationRecord(sig)
    if (!record) return
    indexRecord(segments, sig, record)
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
        && (launchShapeByKey.get(key) !== priorShape
          || launchRoleByKey.get(key) !== priorRole
          || launchGroupByKey.get(key) !== priorGroup)) {
      EffectBus.emit('launch:indexed', { label })
    }
    // Same first-paint race for dashboard-island tiles: the island id lands
    // after the bag first rendered (as a plain spiral). Reuse the launch:indexed
    // nudge — show-cell rebuilds geometry on it regardless of kind — so the
    // clustered islands appear without waiting for an unrelated render.
    if (record.kind === DASHBOARD_ISLAND_KIND
        && (islandGroupByKey.get(key) !== priorIslandGroup
          || islandRoleByKey.get(key) !== priorIslandRole)) {
      EffectBus.emit('launch:indexed', { label })
    }
    // A retitle must repaint the tile it renamed. The atlas caches baked glyphs
    // under the RAW label, so the stale entry has to be flushed as well as the
    // geometry rebuilt — show-cell does both on this event.
    if (record.kind === TITLE_DECORATION_KIND
        && JSON.stringify(titleByKey.get(key) ?? null) !== priorTitle) {
      EffectBus.emit('title:indexed', { label })
    }
  } else if (payload.op === 'removeSig') {
    const kind = kindBySig.get(sig)
    if (kind) {
      removeKind(key, kind)
      // `kindBySig` is a sig→kind cache, and a decoration resource is
      // content-addressed: the SAME sig can sit in many cells' slots. Dropping
      // the cache entry here would blind the next cell's removal, which then
      // subtracts nothing. The mapping is constant for the sig — keep it.
    }
    if (kind === LAUNCH_DECORATION_KIND) {
      launchShapeByKey.delete(key)
      launchKeyByKey.delete(key)
      launchRoleByKey.delete(key)
      launchGroupByKey.delete(key)
    }
    if (kind === DASHBOARD_ISLAND_KIND) {
      islandGroupByKey.delete(key)
      islandRoleByKey.delete(key)
    }
    if (kind === REFERENCE_DECORATION_KIND) {
      referenceTargetByKey.delete(key)
    }
    if (kind === TITLE_DECORATION_KIND) {
      titleByKey.delete(key)
      EffectBus.emit('title:indexed', { label })
    }
    // A tag's resource is content-addressed and shared across cells, so subtract
    // it from the cell named in THIS event, using the sig's constant tag name.
    // Never delete `nameBySig[sig]` — other cells still share it.
    const name = nameBySig.get(sig)
    if (name) removeTag(key, name)
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
  absoluteSegments?: readonly string[],
): Promise<boolean> {
  // `absoluteSegments` is the flattened-match override: under a tag filter the
  // page shows cells from all over the hive, so `here + label` names a layer
  // that does not exist. Walking that phantom path fetched nothing, so a
  // match's own decorations never got indexed while the filter was on.
  const segments = absoluteSegments ?? [...parentSegments, label]
  const pathKey = locationKey(segments)
  let seenPaths = checkedLabels.get(label)
  if (seenPaths?.has(pathKey)) return false
  if (!seenPaths) { seenPaths = new Set<string>(); checkedLabels.set(label, seenPaths) }
  seenPaths.add(pathKey)

  try {
    segmentsByKey.set(pathKey, segments)
    const locationSig = await history.sign({ explorerSegments: () => segments })
    const layer = await history.currentLayerAt(locationSig) as { decorations?: unknown } | null
    if (!layer) return false
    const decorations = layer.decorations
    if (!Array.isArray(decorations)) return false
    for (const decorationSig of decorations) {
      if (typeof decorationSig !== 'string' || !/^[0-9a-f]{64}$/.test(decorationSig)) continue
      const record = await fetchDecorationRecord(decorationSig)
      if (!record) continue
      indexRecord(segments, decorationSig, record)
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
    if (nudge && (launchShapeByKey.has(pathKey) || launchGroupByKey.has(pathKey) || islandGroupByKey.has(pathKey))) EffectBus.emit('launch:indexed', { label })
    // Same post-paint race for a title found on this walk: the tile has already
    // painted under its raw label, so flush and repaint it under the title.
    if (nudge && titleByKey.has(pathKey)) EffectBus.emit('title:indexed', { label })
    return tagsByKey.has(pathKey)
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

/** Walk the ANCESTORS of the current location — every prefix of the path we
 *  are standing on, including the location itself.
 *
 *  Every other hydration path walks a page's CHILDREN, so a cell is only ever
 *  indexed while its parent is on screen. That leaves the breadcrumb reading
 *  raw addresses: standing at `/a/b/c`, the crumbs ARE `a`, `b` and `c`, and
 *  none of them is a cell here. Walking in warms them incidentally (each was a
 *  child one level up), but arriving by any jump does not — a deep link, a
 *  restored session, or a reference portal (`goRaw`, the whole point of a
 *  reference) lands with every ancestor cold, so every crumb falls back to its
 *  name and titles never appear.
 *
 *  Rides `hydrateLabel`'s per-path memo, so this is one layer read per ancestor
 *  per session and a synchronous no-op on every later visit. */
async function hydrateAncestors(
  segments: readonly string[],
  history: HistoryServiceLike,
): Promise<void> {
  await Promise.all(segments.map((label, i) =>
    hydrateLabel(label, segments.slice(0, i), history, true, segments.slice(0, i + 1))))
}

type RenderCellCountPayload = {
  readonly labels?: readonly string[]
  /** Absolute path per label — populated ONLY while a tag filter flattens the
   *  page, where a visible cell can live anywhere in the hive. */
  readonly flatPaths?: Record<string, readonly string[]>
}

EffectBus.on('render:cell-count', (payload: RenderCellCountPayload | undefined) => {
  // Adopt this render's flatten paths FIRST, and unconditionally — an ordinary
  // page emits `{}`, which is what clears the previous filter's paths. Doing it
  // before the empty-labels bail matters: an empty mesh is exactly how a filter
  // that matched nothing reports itself, and its stale paths must not survive.
  const flat = payload?.flatPaths
  flatKeyByLabel.clear()
  if (flat) {
    for (const [label, segs] of Object.entries(flat)) {
      if (Array.isArray(segs) && segs.length) flatKeyByLabel.set(label, locationKey(segs))
    }
  }

  const lineage = window.ioc.get<LineageLike>('@hypercomb.social/Lineage')
  const history = window.ioc.get<HistoryServiceLike>('@diamondcoreprocessor.com/HistoryService')
  if (!history) return
  const parentSegments = lineage?.explorerSegments?.() ?? []

  // The path we are STANDING on, before the early bail below — an empty page
  // still has a breadcrumb, and a jump into an empty location is exactly the
  // case that leaves every crumb cold.
  void hydrateAncestors(parentSegments, history)

  const labels = payload?.labels
  if (!Array.isArray(labels) || labels.length === 0) return
  // Walk each label in parallel — independent layer fetches. When a first-time
  // walk discovers tags on a cell, signal `tags:indexed` so the tag renderers
  // (controls-bar aggregation, on-tile badge) repaint without waiting for the
  // next user action — the index hydrates AFTER render:cell-count fires.
  // A flattened match is walked at its REAL location, not `here + label`.
  void Promise.all(labels.map(label => hydrateLabel(
    label, parentSegments, history, true,
    flat?.[label]?.length ? flat[label] : undefined,
  )))
    .then(results => {
      const tagged = labels.filter((_, i) => results[i])
      if (tagged.length) EffectBus.emit('tags:indexed', { labels: tagged })
    })
})
