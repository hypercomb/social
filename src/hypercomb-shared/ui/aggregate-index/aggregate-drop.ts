// hypercomb-shared/ui/aggregate-index/aggregate-drop.ts
//
// Drag an index row onto the hive and DROP MEANING. This is the standard
// operation every aggregate index gets — written once here rather than per
// aggregate.
//
// ── Where the drop target comes from ─────────────────────────────────────────
//
// We do NOT hit-test the canvas ourselves. `tile-overlay.drone` already emits
// `drop:target` continuously while a drag is over the hive — the same stream
// the image / file / structure drop drones consume — carrying
// `{q, r, occupied, label, index, hasImage}`. Listening to it is what keeps a
// row-drag behaving exactly like every other drop in the app, and it means hex
// geometry stays entirely the renderer's business.
//
// ── What a drop MEANS ────────────────────────────────────────────────────────
//
//   empty hex  (occupied: false) → mint a REFERENCE tile there, pointing at the
//                                  item's target. Identical to what `/reference`
//                                  writes, so a dropped reference is not a new
//                                  kind of thing — it is the same atom.
//   over a tile (occupied: true) → attach the item's keywords to that tile. The
//                                  pheromones ARE the parameters of the
//                                  collection, so attaching one is what makes a
//                                  tile a member.
//
// Shell-level: every write goes through an IoC-resolved essentials service (the
// sanctioned route the command line uses). Imports from essentials stay
// forbidden, so the decoration record is composed here to the same shape
// `reference.queen.ts` writes.

import { EffectBus, hypercomb } from '@hypercomb/core'
import type { AggregateItem } from './aggregate-source'

/** The `drop:target` payload emitted by tile-overlay.drone while dragging. */
export interface DropTarget {
  q: number
  r: number
  occupied: boolean
  label: string | null
  index: number
  hasImage: boolean
}

/** Mirrors REFERENCE_DECORATION_KIND in essentials
 *  (commands/decoration-kind-index.ts). A string constant, not an import —
 *  shared must not reach into essentials. */
const REFERENCE_KIND = 'reference'
const TAG_KIND = 'tag'

const BACKSLASH = String.fromCharCode(92)

/** Names become path segments — drop separators and control characters
 *  (mirrors the UNSAFE_CELL_NAME guard in essentials). */
export const safeCellName = (raw: string): string =>
  [...(raw ?? '')].filter(ch => ch !== '/' && ch !== BACKSLASH && ch.charCodeAt(0) > 31).join('').trim()

const ioc = (): { get(k: string): unknown } | undefined =>
  (globalThis as { ioc?: { get(k: string): unknown } }).ioc

type StoreLike = { putResource(blob: Blob, options?: { emit?: boolean }): Promise<string> }
type HistoryLike = {
  sign(l: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(sig: string): Promise<Record<string, unknown> | null>
  commitLayer(locationSig: string, layer: Record<string, unknown>): Promise<string>
}
type CommitterLike = {
  commitChildrenDeltas?: (
    segments: readonly string[],
    deltas: { appends?: readonly string[] },
  ) => Promise<unknown>
}

/** A reference's payload.
 *
 *  The target is carried TWICE because the two answer different questions:
 *  `targetSegments` is the ROUTE (a sequence of steps, resolved live, so the
 *  reference always lands on the target's current head) and `targetSig` is the
 *  IDENTITY — the target's LINEAGE signature, i.e. its bag address, NEVER a
 *  content hash. A content hash would freeze the reference into a copy that
 *  stops tracking the moment the target changes, which is the one failure this
 *  whole model exists to prevent. A route can be re-walked but can never serve
 *  as a name: it breaks on a rename or rehome, and being path-only is what puts
 *  a reference outside the layer closure.
 *
 *  `requiredMarks` carries the pheromones this reference FILTERS its target by
 *  ("People, but only family"). Deliberately NOT stored as tag decorations: tags
 *  are what the pheromone painter writes, so a filter living there would be
 *  silently rewritten by painting the tile, and on-tile chips would mix filter
 *  marks with identity marks indistinguishably.
 *
 *  `requiredBouquet` (written by `/requires <cell> = @<bouquet>`, not by this
 *  drop) demands a BOUQUET: the resource sig of a named set of marks. The sig
 *  freezes the set — editing the bouquet later never re-scopes existing
 *  portals — and the decoration index expands it and unions it with
 *  `requiredMarks` at read time.
 *
 *  Every field but `targetSegments` is optional, and absent means exactly the
 *  shape `/reference` has always written — so existing references are untouched
 *  and every reader must tolerate their absence. */
export interface ReferencePayload {
  targetSegments: string[]
  targetSig?: string
  requiredMarks?: string[]
  requiredBouquet?: string
}

/**
 * Mint a reference tile at `parentSegments/<name>` pointing at `item.segments`.
 *
 * `appliesTo: []` is deliberate and matches `reference.queen.ts`: it makes the
 * decoration content-addressed by its payload alone, so two references to the
 * same target (with the same marks) dedup to ONE sig. Different marks are
 * different content and therefore mint their own sig — which is exactly what we
 * want, since the marks are part of what the reference IS. `People(family)` and
 * `People(work)` are genuinely distinct references to one place.
 *
 * ── The CALLER pulses ────────────────────────────────────────────────────────
 *
 * This writes and returns; it does NOT call `hypercomb.act()`. A pulse awaits
 * every registered bee in turn and then dispatches `synchronize`, which repaints
 * the whole hive — so it is priced per GESTURE, not per write. Pulsing in here
 * made adding N selected tiles cost N+1 pulses and N+1 full repaints before the
 * panel could even start refreshing, which is what made the Organizer's Add feel
 * slow for work that is only a few milliseconds of OPFS. Every call site pulses
 * once when its batch is done.
 *
 * Returns the created tile name, or null if the write could not be made.
 */
export const dropReferenceTile = async (
  item: AggregateItem,
  parentSegments: readonly string[],
  requiredMarks?: readonly string[],
): Promise<string | null> => {
  const store = ioc()?.get('@hypercomb.social/Store') as StoreLike | undefined
  const history = ioc()?.get('@diamondcoreprocessor.com/HistoryService') as HistoryLike | undefined
  const committer = ioc()?.get('@diamondcoreprocessor.com/LayerCommitter') as CommitterLike | undefined
  if (!store?.putResource || !history?.sign || !committer?.commitChildrenDeltas) return null

  const name = safeCellName(item.label)
  if (!name) return null

  const payload: ReferencePayload = { targetSegments: [...item.segments] }
  // Sorted, deduped, blanks dropped, and OMITTED when empty. This is a contract,
  // not formatting: the record is content-addressed, so two references demanding
  // the same things in a different order would otherwise mint different sigs and
  // stop deduplicating, and an emptied demand has to be byte-identical to a
  // reference that never carried one. `buildReferencePayload` in
  // requires.queen.ts is the same rule; it cannot be imported here because it
  // lives in essentials and shared may never import essentials — folding the two
  // together needs it promoted to core.
  const marks = [...new Set((requiredMarks ?? []).map(m => String(m ?? '').trim()).filter(Boolean))].sort()
  if (marks.length) payload.requiredMarks = marks

  try {
    // The target's LINEAGE signature — its bag address, resolved the same way
    // every location is. Never a content hash: that would be a copy.
    const targetSig = await history.sign({ explorerSegments: () => [...item.segments] })
    if (targetSig) payload.targetSig = targetSig

    const record = { kind: REFERENCE_KIND, appliesTo: [] as string[], payload }
    const decorationSig = await store.putResource(
      new Blob([JSON.stringify(record)], { type: 'application/json' }))

    const childSegments = [...parentSegments, name]
    const childSig = await history.sign({ explorerSegments: () => childSegments })
    const childMarkerSig = await history.commitLayer(childSig, { name, decorations: [decorationSig] })
    EffectBus.emit('decorations:changed', { segments: childSegments, op: 'append', sig: decorationSig })

    await committer.commitChildrenDeltas(parentSegments, { appends: [childMarkerSig] })
    return name
  } catch {
    return null
  }
}

/**
 * Attach the item's keywords to an EXISTING tile — the "drop onto a tile"
 * gesture. A pheromone on a tile is what makes that tile a member of every
 * collection parameterised by it, so this is the additive half of the same
 * idea: dropping a collection onto a tile says "this belongs here".
 *
 * Writes one tag decoration per keyword, through the same
 * `decorations:changed` contract the tag system already uses.
 */
export const dropTagsOnTile = async (
  tags: readonly string[],
  tileSegments: readonly string[],
): Promise<number> => {
  const store = ioc()?.get('@hypercomb.social/Store') as StoreLike | undefined
  if (!store?.putResource || !tags.length) return 0
  let applied = 0
  for (const raw of tags) {
    const name = String(raw ?? '').trim()
    if (!name) continue
    try {
      // appliesTo:[] so the same keyword dedups to one sig across every tile
      // that carries it — the tag system's existing shape.
      const record = { kind: TAG_KIND, appliesTo: [] as string[], payload: { name } }
      const sig = await store.putResource(new Blob([JSON.stringify(record)], { type: 'application/json' }))
      EffectBus.emit('decorations:changed', { segments: [...tileSegments], op: 'append', sig })
      applied++
    } catch { /* skip this keyword, keep the rest */ }
  }
  if (applied) await new hypercomb().act()
  return applied
}
