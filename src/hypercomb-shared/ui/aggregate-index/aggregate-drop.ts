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

import {
  CANONICAL_REFERENCE_SERVICE_KEY,
  EffectBus,
  canonicalReferenceName,
  hypercomb,
  type CanonicalReferenceService,
} from '@hypercomb/core'
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
const TAG_KIND = 'tag'
/** Mirrors CONTEXT_DECORATION_KIND — a place whose material belongs in any
 *  language-model request made about the tile carrying it. */
const CONTEXT_KIND = 'context'

/** Names become path segments — drop separators and control characters
 *  (mirrors the UNSAFE_CELL_NAME guard in essentials). */
export const safeCellName = canonicalReferenceName

const ioc = (): { get(k: string): unknown } | undefined =>
  (globalThis as { ioc?: { get(k: string): unknown } }).ioc

type StoreLike = { putResource(blob: Blob, options?: { emit?: boolean }): Promise<string> }

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
  const references = ioc()?.get(CANONICAL_REFERENCE_SERVICE_KEY) as CanonicalReferenceService | undefined
  if (!references?.place) return null

  // Display titles are not identity. Prefer the source route's leaf.
  const name = safeCellName(item.segments[item.segments.length - 1] ?? item.label)
  if (!name) return null

  try {
    return await references.place({
      name,
      sourceSegments: item.segments,
      parentSegments,
      requiredMarks,
    })
  } catch {
    return null
  }
}

/**
 * Attach a place to an EXISTING tile as CONTEXT — the "drop onto a tile"
 * gesture.
 *
 * Dropping onto empty hive says "put this here". Dropping onto something that
 * is already there cannot mean the same thing, because there is no room; what
 * it means is a statement about the TILE — that answering questions about it
 * requires knowing about the dropped place too. So the drop writes a `context`
 * decoration: a live pointer, resolved at read time, never a copy.
 *
 * When the drop lands, a summary of the branch is generated asynchronously
 * (Haiku explores the tree, caches the summary by branch sig) so the responder
 * receives not just raw content sigs but a human-readable guide to what they
 * mean. Summaries ride in the context array BEFORE the sigs, framing the
 * responder's understanding before it tries to parse layer bytes.
 *
 * ── This REPLACED attaching the item's keywords ─────────────────────────────
 *
 * That gesture used to mean "make this tile a member of this collection" by
 * copying the collection's pheromones onto it. It is gone, and one gesture now
 * has one meaning. Membership is still sayable, and still says itself better,
 * from the pheromone panel — where marks live and where painting one is a
 * deliberate act rather than a side effect of a drag that missed the gap.
 *
 * `targetSig` is the target's LINEAGE address, not a content hash, for exactly
 * the reason a reference carries one: a content hash would freeze this into a
 * snapshot that stops tracking the moment the source changes, and stale context
 * is worse than none — it answers confidently out of date.
 *
 * Returns true when the attachment landed.
 */
export const dropContextOnTile = async (
  item: AggregateItem,
  tileSegments: readonly string[],
): Promise<boolean> => {
  const store = ioc()?.get('@hypercomb.social/Store') as StoreLike | undefined
  if (!store?.putResource || !item.segments.length) return false

  const references = ioc()?.get(CANONICAL_REFERENCE_SERVICE_KEY) as CanonicalReferenceService | undefined
  const name = safeCellName(item.segments[item.segments.length - 1] ?? item.label)
  if (!references?.ensureRoot || !name) return false
  try {
    const root = await references.ensureRoot(name, item.segments)
    if (!root) return false
    const payload: ReferencePayload = {
      targetSegments: [...root.segments],
      targetSig: root.targetSig,
    }
    // appliesTo:[] so the same place attached to two tiles dedups to ONE sig —
    // the same economy every other decoration here gets.
    const record = { kind: CONTEXT_KIND, appliesTo: [] as string[], payload }
    const sig = await store.putResource(
      new Blob([JSON.stringify(record)], { type: 'application/json' }))
    EffectBus.emit('decorations:changed', { segments: [...tileSegments], op: 'append', sig })

    // Fire-and-forget: generate a branch summary so the responder has a guide
    // to the supporting data. The summary is cached by branch sig, so
    // subsequent drops of the same branch read the cache instantly. If the
    // branch is edited, its content sigs change and the cache misses.
    try {
      const tileContext = (window as { ioc?: { get?(k: string): unknown } }).ioc?.get?.(
        '@diamondcoreprocessor.com/TileContext',
      ) as {
        resolve: (segments: readonly string[]) => Promise<unknown>
        /** Absent on an older essentials build — then the drop lands and the
         *  responder simply reads raw sigs. */
        withSummaries?: (branches: readonly unknown[]) => Promise<string[]>
      } | undefined
      if (tileContext?.resolve) {
        const branches = await tileContext.resolve([...root.segments])
        // Through the IoC seam, never by path: this file is SHELL, and shell
        // may never import a module. It is also the only way the call can
        // survive the web shell, where essentials is loaded from OPFS at
        // runtime and no relative path to it exists at all.
        if (Array.isArray(branches) && branches.length > 0) {
          await tileContext.withSummaries?.(branches)
        }
      }
    } catch {
      // Summary generation is purely informational; a failure must not break
      // the drop gesture. The decoration lands, context rides with the next
      // request, and the responder sees raw sigs if the summary was not minted.
    }

    return true
  } catch {
    return false
  }
}

/**
 * Attach the item's keywords to an EXISTING tile. A pheromone on a tile is what
 * makes that tile a member of every collection parameterised by it.
 *
 * NO LONGER REACHED BY THE DROP GESTURE — see `dropContextOnTile`. Kept because
 * `applyCarried` still uses it to scent a batch of new references with the
 * bouquet in hand, which is a different act with the same mechanics.
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
