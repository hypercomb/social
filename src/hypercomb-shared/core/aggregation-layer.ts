// hypercomb-shared/core/aggregation-layer.ts
//
// Membership of a curated launch group (the Websites menu, and any menu like
// it) as a LAYER — not a bespoke pool. Design: documentation/aggregation-
// layer-model.md.
//
// A group `g` owns the page location `[g]` (e.g. ['websites']) — already a
// leaf-only lineage bag committed by MixedGroupBag. This module makes that
// page layer's `children` the SOURCE OF TRUTH for membership:
//
//   • enable(g, segments, meta) — commit a launcher child into [g]'s children
//   • disable(g, segments)      — commit [g]'s children minus that one
//   • list(g)                   — read [g]'s layer children (decode each)
//
// Every mutation is an ordinary commit at [g] through LayerCommitter, so
// standing on /websites and pressing undo removes the last menu change and
// redo restores it — the location's normal linear history, no bespoke
// markers. The commit pattern mirrors MixedGroupBag.#reconcile exactly (the
// deterministic child commit + a full-replace of the children slot through
// the committer FIFO), so the launcher render is unchanged.
//
// LOCAL by construction: [g] is a disconnected single-segment root, never
// linked into the hive tree and never synced — so membership stays extrinsic
// and per-participant (the pool's original intent) WHILE being a real layer.
//
// Shell-level: every essentials service resolves through the ambient global
// `get` (ioc.web) at call time. Never imports essentials.

import { EffectBus } from '@hypercomb/core'

const LAUNCH_KIND = 'launch:target'
const SIG = /^[0-9a-f]{64}$/

type LineageLike = { domain?: () => string }
type HistoryLike = {
  sign(l: { domain?: () => string; explorerSegments: () => readonly string[] }): Promise<string>
  commitLayer(locationSig: string, layer: { name?: string; [slot: string]: unknown }): Promise<string>
  currentLayerAt(locationSig: string): Promise<{ children?: unknown } | null>
  getLayerBySig(sig: string): Promise<{ decorations?: unknown; name?: unknown } | null>
  latestMarkerSigFor(locationSig: string, name: string): Promise<string>
}
type StoreLike = {
  putResource(blob: Blob): Promise<string>
  getResource(sig: string): Promise<Blob | null>
}
type CommitterLike = {
  commitSlotSet(segments: readonly string[], slot: string, sigs: readonly string[]): Promise<void>
}

const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const COMMITTER_KEY = '@diamondcoreprocessor.com/LayerCommitter'
const STORE_KEY = '@hypercomb.social/Store'
const LINEAGE_KEY = '@hypercomb.social/Lineage'

const norm = (segments: readonly string[]): string[] =>
  segments.map(s => String(s ?? '').trim()).filter(Boolean)

const pathKey = (segments: readonly string[]): string => norm(segments).join('/')

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

const domainOf = (): (() => string) | undefined => get<LineageLike>(LINEAGE_KEY)?.domain

/** The `[g]` page-location signature (the leaf-only bag MixedGroupBag commits). */
async function pageLocSig(history: HistoryLike, groupId: string): Promise<string | null> {
  const sig = await history.sign({ domain: domainOf(), explorerSegments: () => [groupId] }).catch(() => '')
  return sig || null
}

/** The raw child marker sigs currently in `[g]`'s layer, in order. */
async function childSigsOf(history: HistoryLike, pageSig: string): Promise<string[]> {
  const layer = await history.currentLayerAt(pageSig).catch(() => null)
  const children = Array.isArray(layer?.children) ? (layer!.children as unknown[]) : []
  return children.map(s => String(s ?? '').trim()).filter(s => SIG.test(s))
}

/** Decode one launcher child's `launch:target` payload → its member, or null. */
async function decodeMember(
  history: HistoryLike,
  store: StoreLike,
  childSig: string,
): Promise<AggregationMember | null> {
  const layer = await history.getLayerBySig(childSig).catch(() => null)
  if (!layer) return null
  const decos = Array.isArray(layer.decorations) ? (layer.decorations as unknown[]) : []
  for (const entry of decos) {
    const sig = String(entry ?? '').trim()
    if (!SIG.test(sig)) continue
    try {
      const blob = await store.getResource(sig)
      if (!blob) continue
      const rec = JSON.parse(await blob.text()) as { kind?: string; payload?: { segments?: unknown; label?: unknown; icon?: unknown } }
      if (rec?.kind !== LAUNCH_KIND) continue
      const segments = Array.isArray(rec.payload?.segments) ? norm(rec.payload!.segments as string[]) : []
      if (segments.length === 0) continue
      return {
        childSig,
        label: String(rec.payload?.label ?? '').trim() || String(layer.name ?? '').trim() || segments[segments.length - 1],
        segments,
        icon: String(rec.payload?.icon ?? '').trim(),
      }
    } catch { /* malformed decoration — skip */ }
  }
  return null
}

/** Every member of a group's menu, decoded from `[g]`'s layer children. */
export async function listAggregation(groupId: string): Promise<AggregationMember[]> {
  const history = get<HistoryLike>(HISTORY_KEY)
  const store = get<StoreLike>(STORE_KEY)
  if (!history || !store?.getResource) return []
  const pageSig = await pageLocSig(history, groupId)
  if (!pageSig) return []
  const out: AggregationMember[] = []
  for (const childSig of await childSigsOf(history, pageSig)) {
    const m = await decodeMember(history, store, childSig)
    if (m) out.push(m)
  }
  return out
}

/** Enable a member: commit a launcher child into `[g]`'s children. Idempotent
 *  by path — re-enabling an existing member replaces its launcher cell (new
 *  label/icon) rather than duplicating it. Returns the child marker sig, or
 *  null when the required services aren't up. One commit → one undo step. */
export async function enableAggregation(
  groupId: string,
  segments: readonly string[],
  meta: { label?: string; icon?: string } = {},
): Promise<string | null> {
  const segs = norm(segments)
  if (!groupId || segs.length === 0) return null
  const history = get<HistoryLike>(HISTORY_KEY)
  const store = get<StoreLike>(STORE_KEY)
  const committer = get<CommitterLike>(COMMITTER_KEY)
  if (!history || !store?.putResource || !committer?.commitSlotSet) return null

  const pageSig = await pageLocSig(history, groupId)
  if (!pageSig) return null

  const label = String(meta.label ?? '').trim() || segs[segs.length - 1]
  const icon = String(meta.icon ?? '').trim()

  // 1. Commit the launcher child cell deterministically (its own private
  //    lineage under [g]) with a launch:target decoration referencing the
  //    member's real root — the SAME shape MixedGroupBag renders.
  const record = { kind: LAUNCH_KIND, appliesTo: [], payload: { segments: segs, icon, label, key: JSON.stringify(segs) } }
  const decoSig = await store.putResource(new Blob([JSON.stringify(record)], { type: 'application/json' }))
  const childLocSig = await history.sign({ domain: domainOf(), explorerSegments: () => [groupId, label] })
  const childMarker = await history.commitLayer(childLocSig, { name: label, decorations: [decoSig] })
  if (!childMarker || !SIG.test(childMarker)) return null

  // 2. Full-replace [g]'s children through the committer FIFO: existing members
  //    (minus any prior cell for THIS path — dedupe/replace) plus the new child.
  const key = pathKey(segs)
  const existing = await childSigsOf(history, pageSig)
  const kept: string[] = []
  for (const sig of existing) {
    if (sig === childMarker) continue
    const m = await decodeMember(history, store, sig)
    if (m && pathKey(m.segments) === key) continue   // replace the prior cell for this path
    kept.push(sig)
  }
  await committer.commitSlotSet([groupId], 'children', [...kept, childMarker])

  EffectBus.emit('aggregation:changed', { groupId, segments: segs, op: 'enable' })
  return childMarker
}

/** Disable a member: commit `[g]`'s children minus the launcher cell(s) that
 *  reference `segments`. True when at least one was removed. One commit → one
 *  undo step (redo restores it — nothing is deleted, the prior marker stands). */
export async function disableAggregation(
  groupId: string,
  segments: readonly string[],
): Promise<boolean> {
  const key = pathKey(segments)
  if (!groupId || !key) return false
  const history = get<HistoryLike>(HISTORY_KEY)
  const store = get<StoreLike>(STORE_KEY)
  const committer = get<CommitterLike>(COMMITTER_KEY)
  if (!history || !store?.getResource || !committer?.commitSlotSet) return false

  const pageSig = await pageLocSig(history, groupId)
  if (!pageSig) return false

  const existing = await childSigsOf(history, pageSig)
  const kept: string[] = []
  let removed = false
  for (const sig of existing) {
    const m = await decodeMember(history, store, sig)
    if (m && pathKey(m.segments) === key) { removed = true; continue }
    kept.push(sig)
  }
  if (!removed) return false
  await committer.commitSlotSet([groupId], 'children', kept)

  EffectBus.emit('aggregation:changed', { groupId, segments: norm(segments), op: 'disable' })
  return true
}
