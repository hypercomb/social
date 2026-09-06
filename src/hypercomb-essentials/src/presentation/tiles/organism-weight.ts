// presentation/tiles/organism-weight.ts
//
// WHAT "DENSE" MEANS — the weight the organism ranks on.
//
// organism-layout.ts is deliberately ignorant: it ranks whatever numbers it
// is handed. This module answers the one question it refuses to, and it
// answers it the way the hive actually is rather than by a setting:
//
//   HOLDERS WHEN A SWARM ANSWERS, DESCENDANTS OTHERWISE.
//
// Holder count — how many participants published their own version of a
// tile — is the truest reading of "densely populated" and the same signal
// the holder badge shows on one tile. But on a hive nobody else is in, every
// tile is held by exactly one person, so ranking on it would draw a plain
// spiral and claim it meant something. The absence of a swarm is not a set
// of ties; it is the metric having nothing to say.
//
// So when no tile on the page is held by more than one participant, the
// weight falls back to descendants: how much the tile actually contains.
// That always says something, on any hive, alone or not. The two are the
// same question at different scales — how much has gathered here — which is
// why one view can switch between them without changing meaning.
//
// The fallback is chosen from the PAGE, not from a swarm connection flag: a
// room you are in that nobody else has published into should read as a solo
// hive, because for the purpose of this view it is one.

import { stackDepth } from './tile-stack.js'
import { childLayerOf, childNamesOf, resolveLayerAt, type PlacementHistory, type PlacementLayer } from '../../history/layer-placement.js'

const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'

/** Which ontology answered. Carried out to the view so it can say so —
 *  a number whose meaning silently changed is worse than no number. */
export type OrganismOntology = 'holders' | 'descendants' | 'none'

export interface OrganismWeights {
  readonly ontology: OrganismOntology
  readonly weightByLabel: ReadonlyMap<string, number>
}

/** Participants holding each label, from the per-pass participant stack.
 *
 *  FLOORED AT ONE, and that is not a fudge. show-cell only ever puts a label
 *  in the stack map when a PEER published it (`if (e.kind !== 'peer')
 *  continue`), so a tile only you hold has no entry at all and `stackDepth`
 *  reports 0. Taken literally that says nobody holds a tile you are looking
 *  at, and it ranks a peer's un-adopted one-holder tile ABOVE every tile of
 *  your own. A tile on your page has at least one holder by definition. */
export const holderWeights = (
  labels: readonly string[],
): ReadonlyMap<string, number> => {
  const out = new Map<string, number>()
  for (const label of labels) out.set(label, Math.max(1, stackDepth(label)))
  return out
}

/** Does the swarm have anything to say about this page? True as soon as ONE
 *  tile here is held by someone else as well — that is the point at which
 *  holder counts start separating tiles instead of reporting a flat 1. */
export const swarmAnswers = (labels: readonly string[]): boolean => {
  for (const label of labels) if (stackDepth(label) > 1) return true
  return false
}

/** How deep the descendant count looks. Two levels is the cheapest read that
 *  can still separate "a tile with three empty children" from "a tile with
 *  three full ones" — depth 1 would score both the same. */
const DESCENDANT_DEPTH = 2
/** Ceiling on layer reads for one ranking. A page of full tiles would
 *  otherwise walk thousands of layers to decide a picture.
 *
 *  THE BUDGET IS SPENT BREADTH-FIRST, and it has to be. Spending it tile by
 *  tile in PAGE order means an exhausted budget scores every remaining tile
 *  0 — and page order has nothing to do with density, so the hive's densest
 *  branch can sit at arrangement position 35, score 0, and be flung to the
 *  rim while a middling tile takes the nucleus. That is not a rough ranking,
 *  it is an inverted one. So every tile gets its direct children counted
 *  first (one read each, bounded by the page), and only the budget left over
 *  buys the second level. Running out then costs precision, never order. */
const READ_BUDGET = 1200

/** Everything under each tile on this page, two levels deep, best effort.
 *
 *  Deliberately NOT the hive tree reader (`readTree`). That reader is an
 *  authoritative all-or-nothing read built for a model: one child location
 *  that was never committed into is COLD, and a cold miss makes it refuse the
 *  WHOLE tree with `incomplete-read`. Correct for a model that must not be
 *  told a partial tree is the tree — fatal for a picture, where a tile nobody
 *  has walked into yet is ordinary and the honest answer is "this much, that
 *  I can see".
 *
 *  So this walks LAYER CONTENT instead, the way the renderer does: a parent's
 *  `children` sigs resolved by name. A sig that will not resolve costs that
 *  tile a count and nothing else. */
export const descendantWeights = async (
  segments: readonly string[],
  labels: readonly string[],
  lookup: <T>(key: string) => T | undefined =
    (<T,>(key: string) => (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)),
): Promise<ReadonlyMap<string, number>> => {
  const history = lookup<PlacementHistory>(HISTORY_KEY)
  if (!history?.getLayerBySig) return new Map()

  const page = await resolveLayerAt(history, undefined, segments).catch(() => null)
  if (!page) return new Map()

  let reads = 0
  const out = new Map<string, number>()

  // PASS ONE — every tile's own children. One read per tile, so the whole
  // page is scored before any of the budget goes on depth.
  const level = new Map<string, { layer: PlacementLayer; names: readonly string[] }>()
  for (const label of labels) {
    const child = await childLayerOf(history, page, label).catch(() => null)
    if (!child) { out.set(label, 0); continue }
    reads++
    const names = await childNamesOf(history, child.layer).catch(() => [])
    out.set(label, names.length)
    if (names.length) level.set(label, { layer: child.layer, names })
  }

  // PASS TWO — what hangs beneath those children, for as far as the budget
  // reaches. Interleaved across tiles rather than finishing one before
  // starting the next, so exhausting it degrades every tile's precision
  // evenly instead of leaving the tail unmeasured.
  if (DESCENDANT_DEPTH > 1) {
    const cursors = [...level.entries()].map(([label, v]) => ({ label, ...v, at: 0 }))
    let progressed = true
    while (progressed && reads < READ_BUDGET) {
      progressed = false
      for (const cursor of cursors) {
        if (cursor.at >= cursor.names.length) continue
        if (reads >= READ_BUDGET) break
        progressed = true
        const name = cursor.names[cursor.at++]
        reads++
        const grandchild = await childLayerOf(history, cursor.layer, name).catch(() => null)
        if (!grandchild) continue
        reads++
        const below = await childNamesOf(history, grandchild.layer).catch(() => [])
        out.set(cursor.label, (out.get(cursor.label) ?? 0) + below.length)
      }
    }
  }

  return out
}

/** The weight for this page, and which ontology gave it.
 *
 *  `segments` is where the page is — only read when the descendant fallback
 *  is the one that answers, so a swarmed page costs no tree read at all. */
export const organismWeights = async (
  labels: readonly string[],
  segments: readonly string[],
  lookup?: <T>(key: string) => T | undefined,
): Promise<OrganismWeights> => {
  if (labels.length === 0) return { ontology: 'none', weightByLabel: new Map() }

  if (swarmAnswers(labels)) {
    return { ontology: 'holders', weightByLabel: holderWeights(labels) }
  }

  const descendants = await descendantWeights(segments, labels, lookup)
  // An ALL-ZERO answer is not a ranking, it is the metric declining to speak,
  // and saying 'descendants' over it would dress a canonical spiral up as a
  // measurement. The common cause is not an empty page: it is a FLATTENED
  // one — a tag lens gathers tiles from all over the hive, none of them are
  // children of where you are standing, and every lookup misses. Reporting
  // 'none' makes the view say so instead of drawing a confident lie.
  let any = false
  for (const weight of descendants.values()) if (weight > 0) { any = true; break }
  if (!any) return { ontology: 'none', weightByLabel: new Map() }
  return { ontology: 'descendants', weightByLabel: descendants }
}
