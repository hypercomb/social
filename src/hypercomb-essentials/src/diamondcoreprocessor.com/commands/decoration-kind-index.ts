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

/** The same lookup by FULL PATH. A bare label resolves against the page being
 *  rendered, which is wrong for the cell you are STANDING at: standing at
 *  `/a/b`, `keyForLabel('b')` names the phantom child `/a/b/b`, so the
 *  standing cell's own decorations always read as absent. */
export function hasDecorationKindAt(segments: readonly string[], kind: string): boolean {
  const key = locationKey(segments)
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

/** Every tag applied at an explicit hierarchy path. Document views use this
 * while walking descendants: a bare label would resolve against the visible
 * parent and smear or miss same-named tiles deeper in the tree. */
export function tagsForSegments(segments: readonly string[]): readonly string[] {
  const set = tagsByKey.get(locationKey(segments))
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
// 'space-invader'). show-cell reads this PER CELL to pick each
// launcher tile's silhouette so groups never share a visual type. Hydrates
// through the same decorations:changed / render:cell-count paths as every other
// decoration — no extra OPFS walk.

/** Decoration kind that marks a launcher tile. */
export const LAUNCH_DECORATION_KIND = 'launch:target'

/** Decoration kind that marks a REFERENCE tile — a live pointer to another
 *  lineage. Its payload is `{ targetSegments: string[] }`. Clicking the tile
 *  portals to that location. See reference.drone.ts / reference.queen.ts. */
export const REFERENCE_DECORATION_KIND = 'reference'

// ── Context sub-index (what a tile's questions should also see) ───────
//
// Decoration kind marking a place whose material belongs in any language-model
// request made ABOUT this tile. Written by dropping a portal ONTO a tile.
//
// ── Why this is not a tag, and not the context basket ────────────────────────
//
// A TAG says what a tile IS — membership, painted from the pheromone panel, and
// switchable off by anyone looking at the chips. Context is not a claim about
// the tile; it is a claim about how to ANSWER for it, and switching it off from
// a chip strip would silently thin every future answer with no sign that it had.
//
// The CONTEXT BASKET (assistant/context-basket.ts) is the other neighbour, and
// it is transient by design: gathered on one trip, spent on one ask. This is
// the opposite — it rides with the tile, travels in its layer to whoever adopts
// it, and is still true next month. Same idea at two lifetimes, so they are two
// records rather than one with a flag.
//
// The payload is a reference's payload (`targetSegments` + `targetSig`) because
// it IS the same act at heart: a live pointer at another place, resolved at read
// time, never a copy. What differs is what reading it means.

/** Decoration kind attaching a place as context for questions about this tile. */
export const CONTEXT_DECORATION_KIND = 'context'

/** Map<locationKey, targetSegments[]> — every place attached to a cell as
 *  context. A LIST, not a single value: gathering is additive, and a tile that
 *  needs three sources to be answered for is the normal case rather than a
 *  conflict to resolve. */
const contextTargetsByKey = new Map<string, readonly string[][]>()

/** Map<locationKey, Map<targetKey, decorationSig>> — lets a remove path find
 *  the exact sig to splice without re-reading the cell's whole slot. */
const contextSigByKeyTarget = new Map<string, Map<string, string>>()

/** The places attached to a cell as context, or `[]` when it carries none.
 *  Synchronous and O(1), like every reader here — an ask composer resolves this
 *  while assembling a request and must not touch OPFS to find out. */
export function contextTargetsForLabel(label: string): readonly string[][] {
  return contextTargetsByKey.get(keyForLabel(label)) ?? EMPTY_CONTEXT
}

/** The same lookup by FULL PATH — for callers walking a subtree, where a bare
 *  label would resolve against the page being rendered rather than the cell
 *  actually being asked about. */
export function contextTargetsForSegments(segments: readonly string[]): readonly string[][] {
  return contextTargetsByKey.get(locationKey(segments)) ?? EMPTY_CONTEXT
}

/** The decoration sig of one context attachment on a cell, keyed by the target
 *  path it points at. Undefined when the index has not seen it. */
export function contextSigFor(
  label: string,
  targetSegments: readonly string[],
  segments?: readonly string[],
): string | undefined {
  const key = segments ? locationKey(segments) : keyForLabel(label)
  return contextSigByKeyTarget.get(key)?.get(locationKey(targetSegments))
}

/** Shared empty result — the miss is the common case, and this is read per cell. */
const EMPTY_CONTEXT: readonly string[][] = Object.freeze([])

/** Map<locationKey, targetSegments> — the location a reference tile points at.
 *  A present entry (even `[]`, meaning the hive root) marks the cell as a
 *  reference; absent means "not a reference". */
const referenceTargetByKey = new Map<string, readonly string[]>()

/** Reference appearances normally own a frozen selection of the root's
 * original details. Only a Portal inventory/editor row carries this mark and
 * routes content edits to the root default for FUTURE activations. */
const referenceEditsRootDefaultByKey = new Map<string, boolean>()

export function referenceEditsRootDefaultForLabel(label: string): boolean {
  const key = keyForLabel(label)
  if (referenceEditsRootDefaultByKey.get(key) === true) return true
  // Compatibility for Portal rows minted before the marker existed. `sets/`
  // is exclusively the Portal inventory, so a real reference there has the
  // same authority. New writers always persist the explicit mark; no ordinary
  // lineage is inferred from its name or from reference kind alone.
  return !flatKeyByLabel.has(label)
    && currentParentKey() === 'sets'
    && referenceTargetByKey.has(key)
}

/** The location a reference tile points at, or `null` if the cell is not a
 *  reference. `[]` is a valid target (the hive root) and is DISTINCT from
 *  `null`. Synchronous + O(1) — tile-overlay reads it per click to decide
 *  whether a body press should portal instead of entering a child. */
export function referenceTargetForLabel(label: string): readonly string[] | null {
  return referenceTargetByKey.get(keyForLabel(label)) ?? null
}

/** Map<locationKey, targetSig> — the target's LINEAGE signature (bag address).
 *  Absent for every reference written before the field existed, which is the
 *  normal case rather than a fault. */
const referenceSigByKey = new Map<string, string>()

/** The target's lineage signature for a reference cell, or '' when the cell is
 *  not a reference or predates the field.
 *
 *  This is the reference's IDENTITY, as opposed to `referenceTargetForLabel`'s
 *  ROUTE: the route follows the target's head and is what a click walks, the
 *  signature is what survives the target being renamed or rehomed and is what
 *  lets a reference join a layer closure. Never a content hash — that would
 *  name a frozen value and make the reference a copy. */
export function referenceSigForLabel(label: string): string {
  return referenceSigByKey.get(keyForLabel(label)) ?? ''
}

/** Map<locationKey, requiredMarks> — the pheromones a reference FILTERS its
 *  target by. Only ever holds non-empty arrays: an empty requirement is stored
 *  as absence, so it dedups with a plain reference to the same place. */
const referenceMarksByKey = new Map<string, readonly string[]>()

/** The marks a reference requires of what it shows, or `[]` when the cell is
 *  not a reference / carries no requirement.
 *
 *  These are DELIBERATELY not tag decorations. Two reasons, both load-bearing:
 *  the pheromone painter writes tags, so a requirement stored there would be
 *  silently rewritten the next time anyone painted the tile; and the tag panel
 *  lists what a cell carries, so a requirement would appear as a chip the
 *  participant could switch OFF — which is not "relaxing a filter" but editing
 *  the reference itself. The decoration is `appliesTo: []`, so its payload IS
 *  its identity: `People(family)` and `People(work)` are different sigs, which
 *  is exactly what lets many references point at one target and each demand
 *  something different of it. Living in the payload keeps them off the panel by
 *  construction rather than by a rule someone has to remember. */
export function referenceMarksForLabel(label: string): readonly string[] {
  const key = keyForLabel(label)
  const inline = referenceMarksByKey.get(key)
  const bouquetSig = referenceBouquetByKey.get(key)
  const bouquet = bouquetSig ? bouquetMarksBySig.get(bouquetSig) : undefined
  if (!bouquet || bouquet.length === 0) return inline ?? EMPTY_MARKS
  if (!inline || inline.length === 0) return bouquet
  return [...new Set([...inline, ...bouquet])].sort()
}

/** Shared empty result — `referenceMarksForLabel` is called per visible cell,
 *  and the miss is the common case. */
const EMPTY_MARKS: readonly string[] = Object.freeze([])

/** Map<locationKey, bouquetSig> — a reference may demand a BOUQUET (a named,
 *  sig-addressed set of pheromones) instead of, or as well as, inline marks.
 *  The payload holds only the signature; the marks are expanded through
 *  `bouquetMarksBySig` below and unioned into `referenceMarksForLabel`, so
 *  every consumer downstream (the requirement drone, show-cell's AND) is
 *  unchanged. */
const referenceBouquetByKey = new Map<string, string>()

/** Map<bouquetSig, marks> — the expansion cache. A bouquet resource is
 *  content-addressed (`{ marks }` JSON, sorted set — see BouquetRegistry), so
 *  an entry is immutable and never invalidates: changed marks are a different
 *  sig. Shared across every reference demanding the same bouquet. */
const bouquetMarksBySig = new Map<string, readonly string[]>()

/** Sigs currently being fetched, so one bouquet demanded by many references
 *  costs one read. */
const bouquetHydrating = new Set<string>()

/** Expand a bouquet sig into its marks. Fire-and-forget from `indexRecord` —
 *  indexing happens at hydration/render time, long before a human can click
 *  the portal, so the sync read in `referenceMarksForLabel` finds the marks
 *  waiting. A transient miss leaves the sig un-cached so a later index pass
 *  retries; an unreadable resource reads as no expansion rather than a fault. */
async function hydrateBouquetMarks(sig: string): Promise<void> {
  if (bouquetMarksBySig.has(sig) || bouquetHydrating.has(sig)) return
  bouquetHydrating.add(sig)
  try {
    const store = window.ioc.get<StoreLike>('@hypercomb.social/Store')
    if (!store?.getResource) return
    const blob = await store.getResource(sig)
    if (!blob) return
    const parsed = JSON.parse(await blob.text()) as { marks?: unknown }
    const raw = Array.isArray(parsed?.marks) ? parsed.marks : []
    // Same defence as `requiredMarksOf`: entries must BE strings, never be
    // coerced into one.
    const marks = [...new Set(
      raw.filter((m): m is string => typeof m === 'string').map(m => m.trim()).filter(Boolean),
    )].sort()
    bouquetMarksBySig.set(sig, Object.freeze(marks))
  } catch { /* unreadable bouquet = no expansion */ }
  finally { bouquetHydrating.delete(sig) }
}

// ── Reference FACE (resolve-through) ──────────────────────────────────
//
// A reference cell's layer is `{name, decorations:[sig]}` — a pointer, with no
// `properties` and therefore no image of its own. Rendered from its own layer
// it is a blank named tile, so a collection of references paints as a page of
// empty hexagons even though the addressing underneath is correct.
//
// The marked Portal inventory row resolves its FACE through the pointer: it is
// the future-default authoring surface and therefore follows the TARGET's
// current head. Ordinary lineage activations pin their own selected details
// and must never use this dynamic fallback—the absence of a local image is a
// real, stable selection too.
//
// Keyed by the TARGET's location, so the Portal read remains one shared fetch.

/** Map<locationKey(TARGET), imageSig> — the picture a Portal authoring row
 *  should wear. Absent = not resolved yet (or genuinely no image). */
const referenceFaceByKey = new Map<string, string>()

/** Target locations whose face has been walked, successful or not — one read
 *  per target per session. Separate from `checkedLabels` because a target is a
 *  LOCATION we resolve through, not a cell on the page being rendered. */
const walkedFaceKeys = new Set<string>()

/** The image sig a Portal default-authoring row should render, or '' when the
 *  cell is ordinary / the target has no image / it hasn't resolved yet.
 *
 *  Synchronous and O(1) — show-cell calls this per visible cell while composing
 *  geometry, so it must never touch OPFS. A miss returns '' and the tile falls
 *  back to the ordinary imageless path, which is why an unresolved face degrades
 *  to today's appearance rather than to a hole. */
export function referenceFaceForLabel(label: string): string {
  if (!referenceEditsRootDefaultForLabel(label)) return ''
  const target = referenceTargetByKey.get(keyForLabel(label))
  if (!target) return ''
  return referenceFaceByKey.get(locationKey(target)) ?? ''
}

/** Read the target's layer and remember its picture. Runs once per target per
 *  session off the back of the walk that discovered the reference. */
async function hydrateReferenceFace(
  targetSegments: readonly string[],
  history: HistoryServiceLike,
): Promise<boolean> {
  const key = locationKey(targetSegments)
  if (walkedFaceKeys.has(key)) return false
  walkedFaceKeys.add(key)
  try {
    const locationSig = await history.sign({ explorerSegments: () => targetSegments })
    const layer = await history.currentLayerAt(locationSig) as { properties?: unknown } | null
    const props = Array.isArray(layer?.properties)
      ? (layer.properties as Record<string, unknown>[])[0]
      : undefined
    const small = props?.['small'] as Record<string, unknown> | undefined
    const image = small?.['image']
    if (typeof image !== 'string' || !/^[0-9a-f]{64}$/.test(image)) return false
    referenceFaceByKey.set(key, image)
    return true
  } catch {
    // Target unreadable (not adopted, deleted, or a cold bag) — leave the face
    // unset and let the tile render as it does today. Drop the memo so a later
    // pass retries once the target arrives.
    walkedFaceKeys.delete(key)
    return false
  }
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

/** Every localized display title carried by one tile. This is the swarm
 * projection seam: a remote participant may read the same fixed identity
 * under entirely different editable text, so publishing only the raw address
 * would collapse a meaningful part of their variant. Returns a fresh object
 * so no caller can mutate the synchronous decoration index. */
export function titlesForSegments(segments: readonly string[]): Readonly<Record<string, string>> {
  return { ...(titleByKey.get(locationKey(segments)) ?? {}) }
}

/** Decoration kind carrying THE LAYER'S DEFAULT VIEW: payload `{ view: 'postit' }`.
 *
 *  "When you come to this layer, this is the view that opens." One per layer —
 *  the writer is `replaceDecoration`, so mutual exclusivity is structural
 *  rather than reconciled. Owner: `view-default.ts`.
 *
 *  Indexed here because the readers are SYNCHRONOUS: the tile overlay tints a
 *  behaviour's glyph for the default view while baking icons, and view.bee
 *  decides the arrival surface inside a recompute that must not touch OPFS. */
export const DEFAULT_VIEW_DECORATION_KIND = 'view:default'

/** Map<locationKey, view token>. */
const defaultViewByKey = new Map<string, string>()

/** The view this location's OWN mark names, or '' when it carries none.
 *  Synchronous and O(1) — see the kind's note above. Ancestors are not
 *  consulted: this answers "what mark sits HERE", which is what the glyph
 *  tint and the panel need. The arrival face — own mark or the nearest
 *  ancestor's — is `defaultViewWithinSegments`. */
export function defaultViewForSegments(segments: readonly string[]): string {
  return defaultViewByKey.get(locationKey(segments)) ?? ''
}

/** The surface token that means "plain hexagons — no view". A `view:default`
 *  record may carry it EXPLICITLY: under a branch default (an ancestor's mark
 *  covering everything beneath it), it is how one page says "not here". The
 *  cascade resolvers treat it as a terminal answer, never a view to open. */
export const HEXAGONS_SURFACE = 'hexagons'

/** RETIRED view tokens → their current names. `view:default` payloads carry
 *  the token as data on layers in the wild, so a rename must keep old
 *  records resolving. Read-side only — writers always mint current tokens. */
const VIEW_TOKEN_ALIASES: Record<string, string> = {
  'revolucion-welcome': 'square-tile-view',
}

/** A `view:default` payload token under its CURRENT name. */
export function normalizeViewToken(view: string): string {
  return VIEW_TOKEN_ALIASES[view] ?? view
}

/** THE CASCADE, warm-index side: the view this location OPENS AS — its own
 *  mark first, else the NEAREST ancestor's. A default is a fact about a
 *  place, and a place includes everything under it until a descendant
 *  declares its own; the nearest mark always wins. An explicit `hexagons`
 *  mark is terminal and returned AS-IS — "no view, deliberately" (the
 *  opt-out under a branch default), distinct from '' = no mark anywhere.
 *  O(depth) map lookups. The index holds no negative entries, so a miss
 *  here is not proof of "no mark" — navigation passes fall back to the
 *  async walk (`defaultViewWithinAt` in view-default.ts). */
export function defaultViewWithinSegments(segments: readonly string[]): string {
  for (let d = segments.length; d >= 0; d--) {
    const view = defaultViewByKey.get(locationKey(segments.slice(0, d)))
    if (view) return view
  }
  return ''
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

// The context index, reachable from OUTSIDE essentials — the shell writes these
// attachments (the portals drop lives in shared, which may never import
// essentials) and an ask composer has to read them back. Same loose-IoC seam
// OverlapMetrics uses, and the only route there is.
window.ioc.register('@diamondcoreprocessor.com/ContextIndex', {
  targetsForLabel: contextTargetsForLabel,
  targetsForSegments: contextTargetsForSegments,
  sigFor: contextSigFor,
})

type StoreLike = {
  getResource(sig: string): Promise<Blob | null>
}

/** Decoration kinds whose owner view REPLACES the tile's hex render
 *  (visual-bee `replacesTileRender` — the post-it). Resolved through IoC per
 *  call, the same loose seam Store/History use, so module load order never
 *  matters; empty until the registry is up. */
const EMPTY_KINDS: ReadonlySet<string> = new Set()

/** Pending takeover-claim drops, keyed `<locationKey> + SEP + <kind>`. A claim
 *  survives the removeSig half of a replace; see the removeSig branch. */
const pendingTakeoverDrop = new Map<string, number>()

/** When a takeover kind was last APPENDED at a location, same key shape.
 *  The two halves of a replace are not ordered: the append can land FIRST,
 *  and then there is no pending drop for it to cancel — the removeSig that
 *  follows would arm one and quietly un-claim a cell that plainly still
 *  carries the note (the tile reappearing and the sticky vanishing). So the
 *  removeSig side also looks BACKWARD: a fresh append means this removal is
 *  the other half of a replace, already superseded. */
const lastTakeoverAppend = new Map<string, number>()

/** How long a takeover claim outlives its removeSig before it really drops.
 *  Long enough to span a replace's two halves (one commit), short enough
 *  that a real `/postit remove` reads as immediate. */
const TAKEOVER_DROP_GRACE_MS = 400

function takeoverKinds(): ReadonlySet<string> {
  const registry = window.ioc.get<{ kindsReplacingTileRender?: () => ReadonlySet<string> }>(
    '@diamondcoreprocessor.com/VisualBeeRegistry')
  return registry?.kindsReplacingTileRender?.() ?? EMPTY_KINDS
}

/** Is this location CLAIMED by a takeover view — a cell whose whole presence
 *  is the view, so show-cell drops its hexagon (`replacesTileRender`)?
 *
 *  A layer made only of such cells paints ZERO hexagons, which is why an
 *  emptiness question must be asked here rather than of the render: "no tiles
 *  on the glass" and "nothing here" stopped being the same sentence the day
 *  the first post-it took a cell over.
 *
 *  Dormancy is deliberately NOT consulted: a dormant claim hands the hexagon
 *  back, and then the cell is on screen and counts itself. Registry-driven —
 *  no view is named here. */
export function isClaimedByTakeoverAt(segments: readonly string[]): boolean {
  const kinds = takeoverKinds()
  if (kinds.size === 0) return false
  for (const kind of kinds) {
    if (hasDecorationKindAt(segments, kind)) return true
  }
  return false
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

/** Pull the target's LINEAGE signature out of a `reference` payload.
 *
 *  This is the bag address, never a content hash — a content hash would name a
 *  frozen value and turn the reference into a copy. Optional by design: every
 *  reference written before this field existed carries only the route, and must
 *  keep working, so a miss is normal rather than a defect. */
function targetSigOf(record: DecorationShape): string {
  const payload = record.payload
  const raw = payload && typeof payload === 'object'
    ? (payload as { targetSig?: unknown }).targetSig
    : undefined
  return typeof raw === 'string' && /^[0-9a-f]{64}$/.test(raw) ? raw : ''
}

/** Is this reference the Portal's explicit root-default authoring surface? */
function editsRootDefaultOf(record: DecorationShape): boolean {
  const payload = record.payload
  return !!payload && typeof payload === 'object'
    && (payload as { editsRootDefault?: unknown }).editsRootDefault === true
}

/** Pull the required marks out of a `reference` payload's `{ requiredMarks }`.
 *
 *  Returns null for absent, malformed, or empty — all three mean "this
 *  reference demands nothing", and collapsing them here is what keeps an
 *  emptied requirement indistinguishable from a reference that never had one.
 *  Order and duplicates are normalized by the WRITER (so that two identical
 *  requirements written in different orders dedup to one sig); reading defends
 *  anyway, because a payload can arrive from a peer that normalized
 *  differently or not at all. */
function requiredMarksOf(record: DecorationShape): readonly string[] | null {
  const payload = record.payload
  const raw = payload && typeof payload === 'object'
    ? (payload as { requiredMarks?: unknown }).requiredMarks
    : undefined
  if (!Array.isArray(raw)) return null
  // Entries must BE strings, never be coerced into one: `String(3)` is a
  // perfectly good-looking mark named "3" that matches nothing, so a peer
  // sending a number would silently narrow the page to empty rather than fail
  // loudly or be ignored.
  const marks = [...new Set(
    raw.filter((m): m is string => typeof m === 'string').map(m => m.trim()).filter(Boolean),
  )].sort()
  return marks.length > 0 ? marks : null
}

/** Pull the demanded bouquet's resource sig out of a `reference` payload's
 *  `{ requiredBouquet }`. A CONTENT hash this time (unlike `targetSig`): a
 *  bouquet is a sorted set of marks, so freezing it is the point — editing the
 *  named bouquet later must not silently re-scope every portal that demanded
 *  the old set. Returns '' for absent/malformed, meaning "no bouquet". */
function requiredBouquetOf(record: DecorationShape): string {
  const payload = record.payload
  const raw = payload && typeof payload === 'object'
    ? (payload as { requiredBouquet?: unknown }).requiredBouquet
    : undefined
  return typeof raw === 'string' && /^[0-9a-f]{64}$/.test(raw) ? raw : ''
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
  // This append may be one half of a REPLACE. Cancel any claim-drop the
  // other half armed, and remember the moment either way: the halves are
  // not ordered, so a removeSig arriving AFTER this one must be able to see
  // that the claim has already been renewed and leave it alone.
  const pendingKey = key + SEP + kind
  const armed = pendingTakeoverDrop.get(pendingKey)
  if (armed !== undefined) {
    clearTimeout(armed)
    pendingTakeoverDrop.delete(pendingKey)
  }
  lastTakeoverAppend.set(pendingKey, Date.now())
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
  if (kind === REFERENCE_DECORATION_KIND) {
    const target = targetSegmentsOf(record)
    if (target) referenceTargetByKey.set(key, target)
    else referenceTargetByKey.delete(key)
    const sig = targetSigOf(record)
    if (sig) referenceSigByKey.set(key, sig)
    else referenceSigByKey.delete(key)
    if (editsRootDefaultOf(record)) referenceEditsRootDefaultByKey.set(key, true)
    else referenceEditsRootDefaultByKey.delete(key)
    const marks = requiredMarksOf(record)
    if (marks) referenceMarksByKey.set(key, marks)
    else referenceMarksByKey.delete(key)
    const bouquet = requiredBouquetOf(record)
    if (bouquet) {
      referenceBouquetByKey.set(key, bouquet)
      void hydrateBouquetMarks(bouquet)
    } else referenceBouquetByKey.delete(key)
  }
  if (kind === CONTEXT_DECORATION_KIND) {
    const target = targetSegmentsOf(record)
    // Additive and DEDUPED by target: hydration re-walks a cell's whole slot,
    // and the same place attached twice must not answer twice — a doubled
    // source is a doubled prompt, which is a cost with no benefit.
    if (target) {
      const targetKey = locationKey(target)
      let bySig = contextSigByKeyTarget.get(key)
      if (!bySig) { bySig = new Map<string, string>(); contextSigByKeyTarget.set(key, bySig) }
      if (!bySig.has(targetKey)) {
        bySig.set(targetKey, sig)
        contextTargetsByKey.set(key, [...(contextTargetsByKey.get(key) ?? []), [...target]])
      }
    }
  }
  if (kind === TITLE_DECORATION_KIND) {
    const text = textOf(record)
    if (text) titleByKey.set(key, text)
    else titleByKey.delete(key)
  }
  if (kind === DEFAULT_VIEW_DECORATION_KIND) {
    const view = normalizeViewToken(
      String((record.payload as { view?: unknown } | undefined)?.view ?? '').trim(),
    )
    if (view) defaultViewByKey.set(key, view)
    else defaultViewByKey.delete(key)
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
    // Stringified: the map is rebuilt on every index, so a reference compare
    // would report a change on every pass and repaint the hive needlessly.
    const priorTitle = JSON.stringify(titleByKey.get(key) ?? null)
    const priorDefaultView = defaultViewByKey.get(key)
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
    // A retitle must repaint the tile it renamed. The atlas caches baked glyphs
    // under the RAW label, so the stale entry has to be flushed as well as the
    // geometry rebuilt — show-cell does both on this event.
    if (record.kind === TITLE_DECORATION_KIND
        && JSON.stringify(titleByKey.get(key) ?? null) !== priorTitle) {
      EffectBus.emit('title:indexed', { label })
    }
    // The layer's default view changed under us. The tile overlay tints the
    // chosen behaviour's glyph from this map, and view.bee decides the arrival
    // surface from it — both read synchronously, so neither would notice an
    // append that landed after their pass. Nudge once, only on a real change.
    if (record.kind === DEFAULT_VIEW_DECORATION_KIND
        && defaultViewByKey.get(key) !== priorDefaultView) {
      EffectBus.emit('default-view:indexed', { label })
    }
    // A takeover kind (visual-bee `replacesTileRender`) landing live: the
    // synchronize-driven repaint raced past the async record fetch above, so
    // the hex is already on screen and the union filter has already run.
    // Same shape as the `tags:indexed` nudge — re-signal so show-cell
    // rebuilds geometry with the cell now claimed by its view.
    if (record.kind && takeoverKinds().has(record.kind)) {
      EffectBus.emit('takeover:indexed', { label })
    }
    // A reference minted LIVE (`/reference`, a drop) must resolve its face here
    // or never: the navigation walk memoizes each label+path and will not
    // re-walk this cell, so waiting for the next render would leave the tile
    // blank until a reload.
    if (record.kind === REFERENCE_DECORATION_KIND) {
      const target = referenceTargetByKey.get(key)
      const history = window.ioc.get<HistoryServiceLike>('@diamondcoreprocessor.com/HistoryService')
      if (target && history && await hydrateReferenceFace(target, history)) {
        EffectBus.emit('reference:indexed', { label })
      }
    }
  } else if (payload.op === 'removeSig') {
    const kind = kindBySig.get(sig)
    if (kind && takeoverKinds().has(kind)) {
      // A TAKEOVER claim is not dropped on the spot. `replaceDecoration` is
      // removeSig THEN append (editing a post-it's text or dragging it to a
      // new pin is a replace), and between the halves this cell carries no
      // post-it at all — so any repaint in that gap legitimately draws the
      // hexagon, and the tile FLICKERS back for a frame under its own
      // sticky. Hold the claim briefly instead: an append cancels the
      // pending drop (a replace nets to no change at all), while a genuine
      // removal lands a moment later and brings the hexagon back.
      //
      // The halves are NOT ordered. When the append lands first there is no
      // pending drop to cancel, and arming one here would un-claim a cell
      // that plainly still carries its note — the tile coming back while
      // its sticky vanished. A recent append means exactly that case, so
      // this removal is already superseded: leave the claim alone.
      const pendingKey = key + SEP + kind
      const renewedAt = lastTakeoverAppend.get(pendingKey) ?? 0
      if (Date.now() - renewedAt >= TAKEOVER_DROP_GRACE_MS) {
        clearTimeout(pendingTakeoverDrop.get(pendingKey))
        pendingTakeoverDrop.set(pendingKey, window.setTimeout(() => {
          pendingTakeoverDrop.delete(pendingKey)
          // One last look: an append inside the grace window renews the
          // claim without ever cancelling this timer if it raced the
          // clearTimeout above.
          if (Date.now() - (lastTakeoverAppend.get(pendingKey) ?? 0) < TAKEOVER_DROP_GRACE_MS) return
          removeKind(key, kind)
          EffectBus.emit('takeover:indexed', { label })
        }, TAKEOVER_DROP_GRACE_MS))
      }
    } else if (kind) {
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
    if (kind === REFERENCE_DECORATION_KIND) {
      referenceTargetByKey.delete(key)
      referenceSigByKey.delete(key)
      referenceEditsRootDefaultByKey.delete(key)
      referenceMarksByKey.delete(key)
      referenceBouquetByKey.delete(key)
      // `bouquetMarksBySig` is kept — content-addressed and shared across
      // cells, same reasoning as `nameBySig`/`kindBySig` above.
    }
    if (kind === CONTEXT_DECORATION_KIND) {
      // Subtract the ONE attachment this sig names, not the cell's whole
      // context. A context record is content-addressed (`appliesTo: []`), so
      // the same sig is shared by every cell attached to that place — but the
      // event names the cell, so the pair is unambiguous.
      const bySig = contextSigByKeyTarget.get(key)
      const targetKey = bySig
        ? [...bySig.entries()].find(([, s]) => s === sig)?.[0]
        : undefined
      if (bySig && targetKey !== undefined) {
        bySig.delete(targetKey)
        const kept = (contextTargetsByKey.get(key) ?? []).filter(t => locationKey(t) !== targetKey)
        if (kept.length) contextTargetsByKey.set(key, kept)
        else contextTargetsByKey.delete(key)
        if (bySig.size === 0) contextSigByKeyTarget.delete(key)
        // `removeKind` above is blunt — it drops the KIND on the first removal,
        // which is wrong for anything a cell can carry several of: losing one
        // attachment does not stop the cell from having context. Put the kind
        // back while any remain, so a `visibleWhen` icon (and the overlap count)
        // keeps telling the truth. Deliberately fixed HERE rather than in
        // `removeKind`: tags have the same shape and the same flaw, and
        // changing the shared subtraction is a wider claim than this branch.
        if (kept.length) addKind(key, CONTEXT_DECORATION_KIND)
      }
    }
    if (kind === TITLE_DECORATION_KIND) {
      titleByKey.delete(key)
      EffectBus.emit('title:indexed', { label })
    }
    if (kind === DEFAULT_VIEW_DECORATION_KIND) {
      defaultViewByKey.delete(key)
      EffectBus.emit('default-view:indexed', { label })
    }
    // A tag's resource is content-addressed and shared across cells, so subtract
    // it from the cell named in THIS event, using the sig's constant tag name.
    // Never delete `nameBySig[sig]` — other cells still share it.
    const name = nameBySig.get(sig)
    if (name) removeTag(key, name)
    // NOTE: the takeover nudge for a removal is NOT emitted here — it rides
    // the grace timer above, so a replace's two halves never un-claim the
    // cell and the hexagon cannot flash back between them.
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
 *  local copy, which can add or remove decorations WITHOUT firing
 *  per-decoration `decorations:changed` events. Clear both the checked flag
 *  and the derived values so the re-walk reconciles to canonical layer state.
 *  Clears the label at EVERY location — callers don't know the path. */
export function forgetDecorationLabel(label: string): void {
  // A whole-layer replacement can remove decorations without emitting their
  // individual removeSig events. Reconciliation must therefore discard the
  // old derived state, not merely permit an additive re-scan; otherwise a
  // removed feature remains a first-class icon until the next page load.
  const keys = new Set(checkedLabels.get(label) ?? [])
  // Live decorations populate the location index directly and need not have
  // passed through hydrateLabel/checkedLabels yet.
  for (const [key, segments] of segmentsByKey) {
    if (segments[segments.length - 1] === label) keys.add(key)
  }
  for (const key of keys) {
    kindsByKey.delete(key)
    tagsByKey.delete(key)
    sigByKeyTag.delete(key)
    launchShapeByKey.delete(key)
    launchKeyByKey.delete(key)
    launchRoleByKey.delete(key)
    launchGroupByKey.delete(key)
    referenceTargetByKey.delete(key)
    referenceSigByKey.delete(key)
    referenceEditsRootDefaultByKey.delete(key)
    referenceMarksByKey.delete(key)
    contextTargetsByKey.delete(key)
    contextSigByKeyTarget.delete(key)
    titleByKey.delete(key)
    defaultViewByKey.delete(key)
    segmentsByKey.delete(key)
  }
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
    // group/role) — appears (the walk runs after first
    // paint). Without the launchGroup term a boot whose pre-paint warm came
    // up cold (big profile, layers not cached yet) painted /help as a plain
    // spiral of substrate tiles and nothing ever re-clustered it. The
    // pre-paint hydration path (ensureDecorationsIndexed) passes nudge=false —
    // nothing is painted yet, so a rebuild request would only queue a
    // redundant second render.
    if (nudge && (launchShapeByKey.has(pathKey) || launchGroupByKey.has(pathKey))) EffectBus.emit('launch:indexed', { label })
    // Same post-paint race for a title found on this walk: the tile has already
    // painted under its raw label, so flush and repaint it under the title.
    if (nudge && titleByKey.has(pathKey)) EffectBus.emit('title:indexed', { label })
    // Same for a default view found on this walk: the layer already painted as
    // hexagons, so view.bee has to be told there is a surface to open.
    if (nudge && defaultViewByKey.has(pathKey)) EffectBus.emit('default-view:indexed', { label })
    // A takeover kind discovered on this walk (visual-bee `replacesTileRender`):
    // the hex painted before the index knew the cell was claimed, and unlike
    // tags/launchers nothing else repaints — tile and sticky sat on screen
    // together until the next navigation. Nudge a geometry rebuild so the
    // union filter drops the hex.
    if (nudge) {
      const indexed = kindsByKey.get(pathKey)
      if (indexed && [...takeoverKinds()].some(k => indexed.has(k))) {
        EffectBus.emit('takeover:indexed', { label })
      }
    }
    // This cell turned out to be a REFERENCE: resolve the face it should wear
    // from its target. The walk above only reads the pointer; the picture lives
    // one hop away, at the target's own head. Same post-paint race as a title —
    // the tile has already painted blank, so nudge a repaint once it lands.
    const refTarget = referenceTargetByKey.get(pathKey)
    if (refTarget && await hydrateReferenceFace(refTarget, history) && nudge) {
      EffectBus.emit('reference:indexed', { label })
    }
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
