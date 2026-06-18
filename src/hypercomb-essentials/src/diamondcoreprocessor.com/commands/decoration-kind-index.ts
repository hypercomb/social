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

/** True iff ANY known cell carries a decoration of `kind`. A global
 *  presence signal (not scoped to a label), used by ViewBee to decide
 *  whether to surface a render-view toggle on the command line: the
 *  website toggle should appear as soon as a `visual:website:page` exists
 *  anywhere. Reflects what the index has learned so far — live mutations
 *  (`decorations:changed`, e.g. the build pass writing pages) update it
 *  immediately; cells from a prior session light up as they hydrate via
 *  `render:cell-count`. O(known-labels); called only off the recompute
 *  microtask, never per frame. */
export function hasAnyDecorationKind(kind: string): boolean {
  for (const set of kindsByLabel.values()) {
    if (set.has(kind)) return true
  }
  return false
}

type StoreLike = {
  getResource(sig: string): Promise<Blob | null>
}

async function fetchDecorationKind(sig: string): Promise<string | null> {
  const store = window.ioc.get<StoreLike>('@hypercomb.social/Store')
  if (!store?.getResource) return null
  try {
    const blob = await store.getResource(sig)
    if (!blob) return null
    const record = JSON.parse(await blob.text()) as { kind?: string }
    return typeof record?.kind === 'string' ? record.kind : null
  } catch {
    return null
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
    const kind = await fetchDecorationKind(sig)
    if (!kind) return
    addKind(label, kind)
    kindBySig.set(sig, kind)
  } else if (payload.op === 'removeSig') {
    const kind = kindBySig.get(sig)
    if (!kind) return
    removeKind(label, kind)
    kindBySig.delete(sig)
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
): Promise<void> {
  if (checkedLabels.has(label)) return
  checkedLabels.add(label)

  try {
    const segments = [...parentSegments, label]
    const locationSig = await history.sign({ explorerSegments: () => segments })
    const layer = await history.currentLayerAt(locationSig) as { decorations?: unknown } | null
    if (!layer) return
    const decorations = layer.decorations
    if (!Array.isArray(decorations)) return
    for (const decorationSig of decorations) {
      if (typeof decorationSig !== 'string' || !/^[0-9a-f]{64}$/.test(decorationSig)) continue
      const kind = await fetchDecorationKind(decorationSig)
      if (!kind) continue
      addKind(label, kind)
      kindBySig.set(decorationSig, kind)
    }
  } catch {
    // Layer unavailable or fetch error — skip this label; another render
    // pass will retry (checkedLabels is set BEFORE the await, so a
    // failed walk doesn't replay forever; remove from checked to retry
    // on next event).
    checkedLabels.delete(label)
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
  // Walk each label in parallel — independent layer fetches.
  void Promise.all(labels.map(label => hydrateLabel(label, parentSegments, history)))
})
