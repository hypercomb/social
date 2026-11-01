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
// markers. The launcher child is committed deterministically, as in
// MixedGroupBag.#reconcile, so the launcher render is unchanged; [g] then
// gains or loses it by a children DELTA through the committer FIFO, never a
// re-listed set, so no other member depends on this read being warm.
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
  currentLayerAt(locationSig: string): Promise<{ children?: unknown; decorations?: unknown; name?: unknown } | null>
  getLayerBySig(sig: string): Promise<{ decorations?: unknown; name?: unknown } | null>
  latestMarkerSigFor(locationSig: string, name: string): Promise<string>
}
type StoreLike = {
  putResource(blob: Blob): Promise<string>
  getResource(sig: string): Promise<Blob | null>
}
type CommitterLike = {
  commitSlotAppend?(segments: readonly string[], slot: string, sig: string): Promise<void>
  commitChildrenDeltas(
    segments: readonly string[],
    changes: { removes?: readonly { sig?: string }[]; appends?: readonly string[] },
  ): Promise<string>
}

const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const COMMITTER_KEY = '@diamondcoreprocessor.com/LayerCommitter'
const STORE_KEY = '@hypercomb.social/Store'
const LINEAGE_KEY = '@hypercomb.social/Lineage'
const CURSOR_KEY = '@diamondcoreprocessor.com/HistoryCursorService'

type CursorLike = {
  state?: { locationSig?: string; rewound?: boolean }
  layerContentAtCursor(): Promise<{ children?: unknown } | null>
}

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
  return decodeFromLayer(store, layer, childSig)
}

/** Decode a launcher cell's `launch:target` from an already-read layer. */
async function decodeFromLayer(
  store: StoreLike,
  layer: { decorations?: unknown; name?: unknown },
  childSig: string,
): Promise<AggregationMember | null> {
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

/** The launcher cell at `[g, label]` decoded from ITS OWN layer — the tile the
 *  participant pressed carries its target in its `launch:target` decoration, so
 *  a CLICK never has to consult an in-memory projection. Truth-first: works on a
 *  cold reload straight into /<g>, before (or without) any group scan, and for
 *  derived groups (games, help) whose cells MixedGroupBag wrote the same way.
 *  Null when the cell is absent or carries no launch target. */
export async function memberAtLauncherCell(
  groupId: string,
  label: string,
): Promise<AggregationMember | null> {
  const name = String(label ?? '').trim()
  if (!groupId || !name) return null
  const history = get<HistoryLike>(HISTORY_KEY)
  const store = get<StoreLike>(STORE_KEY)
  if (!history || !store?.getResource) return null
  const locSig = await history
    .sign({ domain: domainOf(), explorerSegments: () => [groupId, name] })
    .catch(() => '')
  if (!locSig) return null
  const layer = await history.currentLayerAt(locSig).catch(() => null)
  if (!layer) return null
  return decodeFromLayer(store, layer, '')
}

/** Every member of a group's menu, decoded from `[g]`'s layer children. */
export async function listAggregation(groupId: string): Promise<AggregationMember[]> {
  const history = get<HistoryLike>(HISTORY_KEY)
  const store = get<StoreLike>(STORE_KEY)
  if (!history || !store?.getResource) return []
  const pageSig = await pageLocSig(history, groupId)
  if (!pageSig) return []
  return decodeAll(history, store, await childSigsOf(history, pageSig))
}

/** The members as an ADAPTER should render them: when the history cursor is
 *  bound to `[g]`'s bag AND rewound, decode the children AT THE CURSOR — so
 *  standing on /g and pressing undo visibly walks the menu back (redo walks
 *  it forward). Anywhere else this is identical to {@link listAggregation}
 *  (head). Truth readers (icon presence, click routing) stay on head;
 *  cursor-following is strictly a presentation concern. */
export async function listAggregationAtCursor(groupId: string): Promise<AggregationMember[]> {
  const history = get<HistoryLike>(HISTORY_KEY)
  const store = get<StoreLike>(STORE_KEY)
  if (!history || !store?.getResource) return []
  const pageSig = await pageLocSig(history, groupId)
  if (!pageSig) return []
  const cursor = get<CursorLike>(CURSOR_KEY)
  if (cursor?.state?.locationSig === pageSig && cursor.state.rewound) {
    const content = await cursor.layerContentAtCursor().catch(() => null)
    if (content) {
      // Position 0 (pre-history) carries no children — an empty menu, correctly.
      const sigs = (Array.isArray(content.children) ? content.children : [])
        .map(s => String(s ?? '').trim()).filter(s => SIG.test(s))
      return decodeAll(history, store, sigs)
    }
  }
  return decodeAll(history, store, await childSigsOf(history, pageSig))
}

async function decodeAll(
  history: HistoryLike,
  store: StoreLike,
  sigs: readonly string[],
): Promise<AggregationMember[]> {
  const out: AggregationMember[] = []
  for (const childSig of sigs) {
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
  if (!history || !store?.putResource || !committer?.commitChildrenDeltas) return null

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
  // A head already at [g,label] that is NOT a launcher cell is a participant's
  // tile: combine, never overwrite — append only the launch decoration through
  // the committer FIFO so every property it carries survives. A prior launcher
  // cell (or no head) is system-owned and is (re)committed as before.
  let childMarker = ''
  const prior = await history.currentLayerAt(childLocSig).catch(() => null)
  if (prior && !(await decodeFromLayer(store, prior, ''))) {
    if (!committer.commitSlotAppend) return null
    await committer.commitSlotAppend([groupId, label], 'decorations', decoSig)
    childMarker = await history.latestMarkerSigFor(childLocSig, label).catch(() => '')
  } else {
    childMarker = await history.commitLayer(childLocSig, { name: label, decorations: [decoSig] })
  }
  if (!childMarker || !SIG.test(childMarker)) return null

  // 2. ONE children delta at [g]: drop any prior cell for THIS path (dedupe/
  //    replace) and gain the new child. It applies to [g]'s head inside the
  //    committer FIFO, so every other member rides through untouched. This
  //    used to full-replace the list from the read below, and a read that
  //    came back empty (a cold bag, a caught failure) wiped every member.
  const key = pathKey(segs)
  const existing = await childSigsOf(history, pageSig)
  const removes: { sig: string }[] = []
  for (const sig of existing) {
    if (sig === childMarker) continue
    const m = await decodeMember(history, store, sig)
    if (m && pathKey(m.segments) === key) removes.push({ sig })   // replace the prior cell for this path
  }
  await committer.commitChildrenDeltas([groupId], { removes, appends: [childMarker] })

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
  if (!history || !store?.getResource || !committer?.commitChildrenDeltas) return false

  const pageSig = await pageLocSig(history, groupId)
  if (!pageSig) return false

  const existing = await childSigsOf(history, pageSig)
  const removes: { sig: string }[] = []
  for (const sig of existing) {
    const m = await decodeMember(history, store, sig)
    if (m && pathKey(m.segments) === key) removes.push({ sig })
  }
  if (removes.length === 0) return false
  // A removes delta naming only the launcher cell(s) — never a rebuilt list.
  await committer.commitChildrenDeltas([groupId], { removes })

  EffectBus.emit('aggregation:changed', { groupId, segments: norm(segments), op: 'disable' })
  return true
}
