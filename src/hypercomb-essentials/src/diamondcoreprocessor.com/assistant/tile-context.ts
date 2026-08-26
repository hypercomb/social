// diamondcoreprocessor.com/assistant/tile-context.ts
//
// THE TILE'S CONTEXT — the branches whose material belongs in AI requests made
// about this tile, and what they RESOLVE TO.
//
// A `context` decoration stores a canonical branch: `targetSegments` is the
// one-segment fixed-name root route and `targetSig` is that root's LINEAGE
// address — the bag, not a content hash. That is a pointer at the branch's
// current head, which is the whole point: the material an answer draws on has
// to be what is there NOW, not a snapshot taken on the day somebody dragged a
// portal onto a tile. Legacy arbitrary routes remain readable.
//
// But a lineage address is not something a language model can read. The gap
// between "this branch matters here" and "these are the bytes" is what this
// module closes: it walks each attached branch and returns the flat list of
// content signatures underneath it — the `context: [sig, …]` shape an ask
// already carries (see host-ai.service / workflow-ask).
//
// ── Resolution is DERIVED, and deliberately not stored ───────────────────────
//
// The signature list is recomputed on demand, never written back onto the tile.
// Caching it would be minting truth out of a derivation, and worse, it would
// re-freeze exactly what the lineage address exists to keep live — a branch
// that gained a note yesterday must inform today's answer with nobody
// refreshing anything. This is the optimize-phase litmus test answered the
// other way: a cold client CAN rebuild this from layers alone, so it is never
// load-bearing and never persisted here.
//
// ── Budgets, and why a truncated answer says so ──────────────────────────────
//
// A branch can be enormous. Walking one without a ceiling would hang the panel
// that displays it and blow the request it feeds. So every walk is bounded, and
// when a bound bites, `truncated` rides out with the result — a context window
// that silently showed 200 of 4000 tiles would be lying about what the model is
// going to see, which is the one thing this surface exists to prevent.

import { EffectBus } from '@hypercomb/core'
import { walkTree, type WalkHistory, type WalkStore } from '../presentation/tiles/tree-walk.js'
import { removeDecoration } from '../commands/decoration-manifest.js'

const SIG = /^[0-9a-f]{64}$/

/** How far into one attached branch a resolution reaches.
 *
 *  Chosen to be generous enough that attaching a page means attaching what is
 *  visibly under it, and small enough that a mis-drop onto the hive root costs
 *  a moment rather than the session. */
const MAX_DEPTH = 4
const MAX_NODES = 240

/** One attached branch, resolved. */
export type ContextBranch = {
  /** The route, as stored. */
  segments: readonly string[]
  /** The branch's lineage address (bag), as stored — '' on old records. */
  targetSig: string
  /** The decoration sig, so a surface can detach exactly this one. */
  decorationSig: string
  /** Display name — the branch's leaf, or 'hive' at the root. */
  label: string
  /** How many tiles the walk reached. */
  nodeCount: number
  /** Content signatures underneath it — what an ask would carry. */
  signatures: readonly string[]
  /** True when a budget cut the walk short: this branch holds MORE than the
   *  numbers here report, and any surface showing them must say so. */
  truncated: boolean
  /** Set when the branch could not be read at all (never adopted, deleted, or
   *  a cold bag). The attachment is still real — the material is not here. */
  error?: string
}

type ContextIndexLike = {
  targetsForSegments(segments: readonly string[]): readonly string[][]
  sigFor(label: string, target: readonly string[], segments?: readonly string[]): string | undefined
}

type ColdHistoryLike = {
  sign(lineage: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<unknown | null>
}
type ColdStoreLike = { getResource?: (sig: string) => Promise<Blob | null> }

const ioc = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: <U>(k: string) => U | undefined } }).ioc?.get?.<T>(key)

/** NUL-joined target key — the one join a segment can never fake. */
const targetKey = (target: readonly string[]): string => target.join('\u0000')

/** One attachment as the COLD path reads it: target route, the decoration's
 *  own sig, and the stored lineage address (read back at last — it rode every
 *  record since the drop gesture began minting it and nothing ever read it). */
type ColdAttachment = { target: string[]; decorationSig: string; targetSig: string }

/**
 * COLD-PATH attachments — read from the tile's own LAYER, not the hot index.
 *
 * The ContextIndex only learns a tile's decorations when something renders
 * them: the parent page's `render:cell-count` hydration walk, or a live
 * `decorations:changed`. So an ask composed in a session where the tile's
 * parent page never rendered — a deep link, a boot straight onto the page, a
 * bridge script — silently missed the attached context, and a root-level
 * attachment never indexed at all. The LAYER is the persistent carrier
 * (`layer.decorations: sig[]`, the same slot the hydration walk parses), and
 * it is readable regardless of what happened to be painted this session. The
 * ask path must never depend on paint history.
 */
const coldContextAttachments = async (
  segments: readonly string[],
  history: ColdHistoryLike,
  store: ColdStoreLike,
): Promise<Map<string, ColdAttachment>> => {
  const out = new Map<string, ColdAttachment>()
  if (!store.getResource) return out
  try {
    const locationSig = await history.sign({ explorerSegments: () => [...segments] })
    const layer = await history.currentLayerAt(locationSig) as { decorations?: unknown } | null
    const decorations = layer?.decorations
    if (!Array.isArray(decorations)) return out
    for (const sig of decorations) {
      if (typeof sig !== 'string' || !SIG.test(sig)) continue
      try {
        const blob = await store.getResource(sig)
        if (!blob) continue
        const record = JSON.parse(await blob.text()) as {
          kind?: string
          payload?: { targetSegments?: unknown; targetSig?: unknown }
        }
        if (record?.kind !== 'context') continue
        const target = (Array.isArray(record.payload?.targetSegments) ? record.payload.targetSegments : [])
          .map(s => String(s ?? '').trim()).filter(Boolean)
        if (!target.length) continue
        const storedSig = String(record.payload?.targetSig ?? '')
        out.set(targetKey(target), {
          target, decorationSig: sig,
          targetSig: SIG.test(storedSig) ? storedSig : '',
        })
      } catch { /* one unreadable decoration must not hide the rest */ }
    }
  } catch { /* no layer readable here — nothing cold to add */ }
  return out
}

/** The branches attached to a tile, unresolved — the cheap read, for a count
 *  or a badge. Synchronous: it is the decoration index verbatim. */
export const contextBranchesFor = (segments: readonly string[]): readonly string[][] =>
  ioc<ContextIndexLike>('@diamondcoreprocessor.com/ContextIndex')?.targetsForSegments(segments) ?? []

/**
 * Resolve every branch attached to `segments` into the material it carries.
 *
 * One walk per branch, in parallel — they are independent subtrees and a slow
 * one must not hold the others' rows blank. A branch that throws resolves to an
 * ERROR ROW rather than vanishing: an attachment you made and can no longer see
 * is indistinguishable from one that was never saved, and the honest report is
 * "this is attached and unreadable".
 */
export const resolveTileContext = async (
  segments: readonly string[],
): Promise<readonly ContextBranch[]> => {
  const history = ioc<WalkHistory>('@diamondcoreprocessor.com/HistoryService')
  const store = ioc<WalkStore>('@hypercomb.social/Store')
  const index = ioc<ContextIndexLike>('@diamondcoreprocessor.com/ContextIndex')
  if (!history || !store) return []

  // HOT ∪ COLD. The hot index answers instantly but only knows what has
  // rendered or changed this session; the layer read answers from the
  // persistent slot regardless of paint history. Union, keyed by target, so
  // a branch is resolved once whichever side knew it — and an attachment made
  // seconds ago (hot, its layer commit maybe still in the committer's FIFO)
  // is as visible as one from last month (cold, parent never rendered).
  const label = segments[segments.length - 1] ?? ''
  const merged = new Map<string, { target: string[]; decorationSig: string; storedTargetSig: string }>()
  for (const target of index?.targetsForSegments(segments) ?? []) {
    merged.set(targetKey(target), {
      target: [...target],
      decorationSig: index?.sigFor(label, target, segments) ?? '',
      storedTargetSig: '',
    })
  }
  const cold = await coldContextAttachments(
    segments,
    history as unknown as ColdHistoryLike,
    store as unknown as ColdStoreLike,
  )
  for (const [key, attachment] of cold) {
    const hot = merged.get(key)
    if (!hot) {
      merged.set(key, {
        target: attachment.target,
        decorationSig: attachment.decorationSig,
        storedTargetSig: attachment.targetSig,
      })
    } else {
      if (!hot.decorationSig) hot.decorationSig = attachment.decorationSig
      hot.storedTargetSig = attachment.targetSig
    }
  }

  return Promise.all([...merged.values()].map(async ({ target, decorationSig, storedTargetSig }): Promise<ContextBranch> => {
    const name = target.length ? target[target.length - 1] : 'hive'
    const base: ContextBranch = {
      segments: [...target],
      // The stored lineage address, read back at last — so an ERROR row still
      // names the bag it points at instead of ''.
      targetSig: storedTargetSig,
      decorationSig,
      label: name,
      nodeCount: 0,
      signatures: [],
      truncated: false,
    }
    try {
      const result = await walkTree(
        { segments: [...target], label: name },
        history, store,
        { maxDepth: MAX_DEPTH, maxNodes: MAX_NODES },
      )
      if (result.error) return { ...base, error: result.error }

      // Both the layer sig and the properties sig: the layer is the structure
      // (names, children) and the props resource is where a tile's own content
      // lives. Taking only one of them gives a model either a shape with
      // nothing in it or contents with no idea how they relate.
      const sigs = new Set<string>()
      for (const node of result.nodes) {
        if (node.sig && SIG.test(node.sig)) sigs.add(node.sig)
        if (node.propsSig && SIG.test(node.propsSig)) sigs.add(node.propsSig)
      }
      return {
        ...base,
        targetSig: result.nodes[0]?.sig ?? '',
        nodeCount: result.nodes.length,
        signatures: [...sigs],
        truncated: result.truncated,
      }
    } catch (err) {
      return { ...base, error: String((err as Error)?.message ?? err) }
    }
  }))
}

/**
 * Every signature a request about this tile should carry, across all its
 * attached branches — deduped, because two branches that overlap must not send
 * the same bytes twice.
 *
 * This is the one call an ask composer needs; the per-branch detail above is
 * for the surface that lets a participant see and manage what is attached.
 */
export const contextSignaturesFor = async (
  segments: readonly string[],
): Promise<readonly string[]> => {
  const branches = await resolveTileContext(segments)
  const out = new Set<string>()
  for (const b of branches) for (const s of b.signatures) out.add(s)
  return [...out]
}

/**
 * Detach one branch from a tile.
 *
 * Takes the DECORATION sig, not the target: a context record is
 * content-addressed (`appliesTo: []`), so the same sig sits in every tile
 * attached to that place — the pair (sig, segments) is what names one
 * attachment, and dropping by target alone would be ambiguous the moment two
 * records ever collided.
 */
export const detachTileContext = (
  segments: readonly string[],
  decorationSig: string,
): boolean => {
  if (!decorationSig || !SIG.test(decorationSig)) return false
  removeDecoration({ sig: decorationSig, segments: [...segments] })
  EffectBus.emit('context:tile-changed', { segments: [...segments] })
  return true
}

// Reachable from the shell, which owns the window that manages this and may
// never import essentials. Same loose-IoC seam ContextIndex uses.
window.ioc.register('@diamondcoreprocessor.com/TileContext', {
  branchesFor: contextBranchesFor,
  resolve: resolveTileContext,
  signaturesFor: contextSignaturesFor,
  detach: detachTileContext,
  // The branch summaries, behind the same seam. Loaded on demand from a
  // SIBLING module: summary generation imports this one, so importing it up
  // here would close the circle, and the shell may never name an essentials
  // path itself (it tried, and the build broke on a path that only exists
  // over here).
  withSummaries: async (branches: readonly ContextBranch[]): Promise<string[]> => {
    const { contextWithSummaries } = await import('./context-summary-gen.js')
    return contextWithSummaries(branches)
  },
})
