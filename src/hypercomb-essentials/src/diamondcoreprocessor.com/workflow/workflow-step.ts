// diamondcoreprocessor.com/workflow/workflow-step.ts
//
// A workflow STEP is a tile. Nothing else.
//
// This file holds the one record that turns an ordinary child tile into a
// step: a `visual:workflow:step` decoration whose payload is a SIGNATURE
// pointing at the step resource. Everything a step needs beyond its kind —
// its name, its prose, its keywords, its picture, its own children — it
// already has, because it is a tile and tiles have all of that.
//
// ── Why the order is not in the record ────────────────────────────────
//
// The step order IS the parent's `children` order. Writing it a second time
// into a workflow record would create two truths that drift the first time
// somebody drags a tile. So: no `index`, no `next`, no edge list. Reorder is
// the reorder you already have, undo is the undo you already have, and a
// step deleted on canvas is a step deleted from the workflow.
//
// ── Why the payload is a sig ──────────────────────────────────────────
//
// Expansion doctrine (CLAUDE.md, signature-system.md): a decoration payload
// that could be shared, cached or versioned holds a POINTER, never inline
// content. Two steps that say the same thing are the same signature — a
// workflow adopted by a peer deduplicates against steps they already hold.

import { replaceDecoration, listDecorations } from '../commands/decoration-manifest.js'
import { CHILD_SLOTS, type PlacementLayer } from '../history/layer-placement.js'

/** Decoration kind. Convention: `visual:<view>:<noun>` (visual-bee-registry). */
export const WORKFLOW_STEP_KIND = 'visual:workflow:step'

const SIG = /^[0-9a-f]{64}$/

/**
 * The step resource — what this step DOES. Held at the content root under
 * its own signature; the decoration carries only `{ stepSig }`.
 *
 * `kind` is a WorkflowStepRegistry key. The overwhelmingly common one is
 * `'command'`: every slash command the hive has is already a step, so the
 * step vocabulary grows whenever a module ships a queen and needs no
 * registration of its own.
 */
export interface WorkflowStep {
  readonly v: 1
  /** Registry kind — 'command', 'ask', 'sub', or anything a module adds. */
  readonly kind: string
  /** kind 'command': the slash behaviour name, WITHOUT the leading slash. */
  readonly command?: string
  /** Argument string. `{cell}`, `{scope}`, `{workflow}` interpolate at run. */
  readonly args?: string
  /** Free text the step carries — an ask's question, a note's body. */
  readonly text?: string
  /** Advisory model hint for AI-shaped steps ('haiku', 'sonnet', 'opus'). */
  readonly model?: string
}

/** A step as the designer and the runner see it: the tile plus its record. */
export interface WorkflowStepView {
  /** The step tile's name — its address under the workflow cell. */
  readonly cell: string
  /** Position in the parent's `children` order, 0-based. */
  readonly index: number
  /** The step's lineage segments (workflow segments + cell). */
  readonly segments: readonly string[]
  /** Null when the tile carries no step decoration yet — an UNCONFIGURED
   *  step. It is still a step (it is a child tile); it simply does nothing
   *  until you give it a kind. The designer shows these as needing a kind
   *  rather than hiding them, because hiding a tile the participant can see
   *  on canvas is how a designer starts lying about the workflow. */
  readonly step: WorkflowStep | null
  /** The step resource's signature, when configured. */
  readonly stepSig: string | null
  /** True when this step tile has children of its own — a SUB-WORKFLOW.
   *  Recursive composition falls out of tiles being tiles. */
  readonly hasChildren: boolean
}

type StoreLike = {
  putResource(blob: Blob): Promise<string>
  getResource(signature: string): Promise<Blob | null>
}

type HistoryLike = {
  sign(lineage: { explorerSegments: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<PlacementLayer | null>
  getLayerBySig(sig: string): Promise<PlacementLayer | null>
}

const store = (): StoreLike | undefined =>
  window.ioc.get<StoreLike>('@hypercomb.social/Store')

const history = (): HistoryLike | undefined =>
  window.ioc.get<HistoryLike>('@diamondcoreprocessor.com/HistoryService')

/**
 * Give a step tile its kind. Mints the step resource, then writes the
 * decoration pointing at it — replacing any prior step record, so re-typing
 * a step leaves ONE live record rather than a pile.
 */
export async function writeStep(opts: {
  segments: readonly string[]
  step: WorkflowStep
}): Promise<string> {
  const s = store()
  if (!s?.putResource) throw new Error('[workflow-step] Store not available')

  const blob = new Blob([JSON.stringify(opts.step)], { type: 'application/json' })
  const stepSig = await s.putResource(blob)

  await replaceDecoration({
    kind: WORKFLOW_STEP_KIND,
    appliesTo: opts.segments,
    payload: { stepSig },
    segments: opts.segments,
  })
  return stepSig
}

/** Read one tile's step record, or null when it carries none. */
export async function readStep(
  segments: readonly string[],
): Promise<{ step: WorkflowStep; stepSig: string } | null> {
  const records = await listDecorations<{ stepSig?: string }>({
    kind: WORKFLOW_STEP_KIND,
    segments,
  })
  // Last wins: writeStep drops priors, but a workflow adopted from a peer can
  // arrive with more than one and the newest entry is the live one.
  for (let i = records.length - 1; i >= 0; i--) {
    const sig = String(records[i].record?.payload?.stepSig ?? '').toLowerCase()
    if (!SIG.test(sig)) continue
    const resolved = await readStepResource(sig)
    if (resolved) return { step: resolved, stepSig: sig }
  }
  return null
}

/** Resolve a step resource by signature. Malformed → null, never a throw. */
export async function readStepResource(sig: string): Promise<WorkflowStep | null> {
  const s = store()
  if (!s?.getResource || !SIG.test(sig)) return null
  try {
    const blob = await s.getResource(sig)
    if (!blob) return null
    const parsed = JSON.parse(await blob.text()) as Partial<WorkflowStep>
    if (typeof parsed?.kind !== 'string' || !parsed.kind) return null
    return { ...parsed, v: 1, kind: parsed.kind } as WorkflowStep
  } catch {
    return null
  }
}

/**
 * The workflow's steps, IN CANVAS ORDER — the parent layer's `children`
 * order, resolved to names, each paired with its step record.
 *
 * Reads only. A workflow you have never run reads exactly the same as one
 * you have, because there is no run state hiding in the structure.
 */
export async function readSteps(
  segments: readonly string[],
): Promise<WorkflowStepView[]> {
  const h = history()
  const s = store()
  if (!h?.sign || !h.currentLayerAt || !h.getLayerBySig || !s?.getResource) return []

  const locationSig = await h.sign({ explorerSegments: () => [...segments] })
  const layer = await h.currentLayerAt(locationSig)
  if (!layer) return []

  const childSigs = await resolveChildSigs(layer, s)
  const out: WorkflowStepView[] = []

  for (let i = 0; i < childSigs.length; i++) {
    const childLayer = await h.getLayerBySig(childSigs[i]).catch(() => null)
    const cell = String((childLayer as { name?: unknown } | null)?.name ?? '').trim()
    if (!cell) continue
    const childSegments = [...segments, cell]
    const resolved = await readStep(childSegments)
    const grandchildren = childLayer ? await resolveChildSigs(childLayer, s) : []
    out.push({
      cell,
      index: i,
      segments: childSegments,
      step: resolved?.step ?? null,
      stepSig: resolved?.stepSig ?? null,
      hasChildren: grandchildren.length > 0,
    })
  }
  return out
}

/**
 * A layer's declared child sigs across every canonical child slot, resolving
 * the slot-holds-a-pointer shape as well as the inline array. Same rules as
 * the tree walk's reader — kept here rather than imported so the workflow
 * module does not depend on `presentation/`.
 */
async function resolveChildSigs(layer: PlacementLayer, s: StoreLike): Promise<string[]> {
  for (const slot of CHILD_SLOTS) {
    const value = (layer as Record<string, unknown>)[slot]
    if (Array.isArray(value) && value.length > 0) {
      return value.map(x => String(x)).filter(x => SIG.test(x))
    }
    if (typeof value === 'string' && SIG.test(value)) {
      try {
        const blob = await s.getResource(value)
        if (!blob) return []
        const parsed = JSON.parse(await blob.text()) as unknown
        if (Array.isArray(parsed)) return parsed.map(x => String(x)).filter(x => SIG.test(x))
      } catch { /* malformed pointer — childless */ }
      return []
    }
  }
  return []
}
