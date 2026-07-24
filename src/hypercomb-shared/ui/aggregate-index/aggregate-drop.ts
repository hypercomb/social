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

/** A reference's payload. `scope` carries the pheromone parameters that define
 *  the collection this reference stands for — see the locked-scope note in the
 *  panel. Absent `scope` is an ordinary unscoped reference, exactly what
 *  `/reference` has always written, so existing references are untouched. */
export interface ReferencePayload {
  targetSegments: string[]
  scope?: string[]
}

/**
 * Mint a reference tile at `parentSegments/<name>` pointing at `item.segments`.
 *
 * `appliesTo: []` is deliberate and matches `reference.queen.ts`: it makes the
 * decoration content-addressed by its payload alone, so two references to the
 * same target (with the same scope) dedup to ONE sig. Adding a different scope
 * is different content and therefore mints its own sig — which is exactly what
 * we want, since scope is part of what the reference IS.
 *
 * Returns the created tile name, or null if the write could not be made.
 */
export const dropReferenceTile = async (
  item: AggregateItem,
  parentSegments: readonly string[],
  scope?: readonly string[],
): Promise<string | null> => {
  const store = ioc()?.get('@hypercomb.social/Store') as StoreLike | undefined
  const history = ioc()?.get('@diamondcoreprocessor.com/HistoryService') as HistoryLike | undefined
  const committer = ioc()?.get('@diamondcoreprocessor.com/LayerCommitter') as CommitterLike | undefined
  if (!store?.putResource || !history?.sign || !committer?.commitChildrenDeltas) return null

  const name = safeCellName(item.label)
  if (!name) return null

  const payload: ReferencePayload = { targetSegments: [...item.segments] }
  if (scope && scope.length) payload.scope = [...scope]

  try {
    const record = { kind: REFERENCE_KIND, appliesTo: [] as string[], payload }
    const decorationSig = await store.putResource(
      new Blob([JSON.stringify(record)], { type: 'application/json' }))

    const childSegments = [...parentSegments, name]
    const childSig = await history.sign({ explorerSegments: () => childSegments })
    const childMarkerSig = await history.commitLayer(childSig, { name, decorations: [decorationSig] })
    EffectBus.emit('decorations:changed', { segments: childSegments, op: 'append', sig: decorationSig })

    await committer.commitChildrenDeltas(parentSegments, { appends: [childMarkerSig] })
    await new hypercomb().act()
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
