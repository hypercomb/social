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
// sig }`; we look up the sig in `__resources__`, parse its `kind`,
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

/** Map<cellLabel, Set<decorationKind>>. Mutates in place — exported
 *  read function captures by reference. */
const kindsByLabel = new Map<string, Set<string>>()

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

/** Reverse cache: decoration sig → { label, name }. Subtract a tag on
 *  `removeSig` without re-fetching the (possibly shared) record. */
const tagBySig = new Map<string, { label: string; name: string }>()

/** Public lookup. Returns true iff the cell at `label` has at least
 *  one decoration of `kind` in its `decorations` slot.
 *
 *  Designed for `visibleWhen` — must remain synchronous and O(1). */
export function hasDecorationKind(label: string, kind: string): boolean {
  return kindsByLabel.get(label)?.has(kind) ?? false
}

/** Iterate every decoration kind known for a cell. Useful for
 *  introspection / debug; not part of the visibleWhen hot path. */
export function kindsForLabel(label: string): readonly string[] {
  const set = kindsByLabel.get(label)
  return set ? [...set] : []
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

function addTag(label: string, name: string, sig: string): void {
  let set = tagsByLabel.get(label)
  if (!set) { set = new Set<string>(); tagsByLabel.set(label, set) }
  set.add(name)
  let bySig = sigByLabelTag.get(label)
  if (!bySig) { bySig = new Map<string, string>(); sigByLabelTag.set(label, bySig) }
  bySig.set(name, sig)
  tagBySig.set(sig, { label, name })
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

  if (payload.op === 'append') {
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
  } else if (payload.op === 'removeSig') {
    const kind = kindBySig.get(sig)
    if (kind) {
      removeKind(label, kind)
      kindBySig.delete(sig)
    }
    // A tag's resource is content-addressed and shared across cells, so the
    // reverse cache pins which (label, name) THIS slot ref stood for.
    const tag = tagBySig.get(sig)
    if (tag) {
      removeTag(tag.label, tag.name)
      tagBySig.delete(sig)
    }
  }
})

// ── Startup / navigation hydration ────────────────────────────────────
//
// Labels we've already walked. Persistent across the session — once a
// cell's `decorations` slot has been scanned, subsequent mutations come
// through the `decorations:changed` trigger and update the index live.

const checkedLabels = new Set<string>()

/** Forget that we've walked `label` so the next `render:cell-count` re-walks
 *  its `decorations` slot. Called when a tile's whole layer is replaced
 *  out-of-band — e.g. a swarm `sync` folds the publisher's branch over the
 *  local copy, which can add decorations WITHOUT firing per-decoration
 *  `decorations:changed` events. Additive-safe: we only clear the
 *  checked-flag (not the kind set), so the re-walk adds any new kinds while
 *  the existing ones keep the `features` icon stable across the refresh. */
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
): Promise<boolean> {
  if (checkedLabels.has(label)) return false
  checkedLabels.add(label)

  try {
    const segments = [...parentSegments, label]
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
    return tagsByLabel.has(label)
  } catch {
    // Layer unavailable or fetch error — skip this label; another render
    // pass will retry (checkedLabels is set BEFORE the await, so a
    // failed walk doesn't replay forever; remove from checked to retry
    // on next event).
    checkedLabels.delete(label)
    return false
  }
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
