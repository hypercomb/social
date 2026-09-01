// workflow/workflow-ask.ts
//
// The `ask` step's deposit — how a workflow hands work to an AI without
// doing any of it.
//
// ── The rule this file exists to obey ─────────────────────────────────
//
// "Ask before creating. Always." (meaning-loop.md, Safeguards.) A workflow
// is a script the participant wrote, and it is still not authorization for
// a language model to go and build something. So the `ask` step does the
// one thing the meaning loop specifies: it deposits an `ai:request` record
// on the step's tile with `status: 'pending'`, and STOPS. The pheromone
// sweep finds it, mints a feedback-window question, and generation only ever
// starts from the participant's own answer.
//
// This is why a run that reaches an `ask` step reports `asked` rather than
// `done` — the workflow has not finished, it is waiting on a person, and
// saying otherwise would be a lie the run log then repeats forever.
//
// The record shape is meaning-loop.md §2 verbatim, so the routine that
// already drains these needs no change to drain a workflow's.

import { replaceDecoration } from '../commands/decoration-manifest.js'

/** Decoration kind — shared with the meaning-loop routine. */
export const AI_REQUEST_KIND = 'ai:request'

/** The request resource. Payload of the decoration is `{ requestSig }`. */
export interface AiRequestRecord {
  readonly v: 1
  /** The cell this is a request ABOUT, as inflate-normalized segments. */
  readonly target: readonly string[]
  /** One paragraph stating the work. */
  readonly request: string
  /** Any signature handed in as context — expanded lazily by the reader. */
  readonly contextSigs: readonly string[]
  /** Advisory: whichever engine makes the most sense. */
  readonly model?: string
  /** pending → asked → approved → done | declined. */
  readonly status: 'pending'
  /** Set by the sweep when the ask-gate question is minted. */
  readonly askedQId: null
  /** Filled by the hand-off session. */
  readonly resultSigs: readonly string[]
  /** Which workflow deposited it — provenance, so a question on the
   *  feedback window can say where it came from instead of appearing from
   *  nowhere. */
  readonly viaWorkflow?: string
}

type StoreLike = { putResource(blob: Blob): Promise<string> }

/**
 * Deposit a pending AI request on a cell. Replaces any prior request on the
 * same cell (status transitions are re-mints, per the meaning loop) and
 * returns the request resource's signature.
 */
export async function depositRequest(opts: {
  segments: readonly string[]
  request: string
  model?: string
  contextSigs?: readonly string[]
  workflowName?: string
}): Promise<string> {
  const store = window.ioc.get<StoreLike>('@hypercomb.social/Store')
  if (!store?.putResource) throw new Error('[workflow-ask] Store not available')

  const record: AiRequestRecord = {
    v: 1,
    target: [...opts.segments],
    request: opts.request,
    contextSigs: [...(opts.contextSigs ?? [])],
    ...(opts.model ? { model: opts.model } : {}),
    status: 'pending',
    askedQId: null,
    resultSigs: [],
    ...(opts.workflowName ? { viaWorkflow: opts.workflowName } : {}),
  }

  const requestSig = await store.putResource(
    new Blob([JSON.stringify(record)], { type: 'application/json' }),
  )

  await replaceDecoration({
    kind: AI_REQUEST_KIND,
    appliesTo: opts.segments,
    payload: { requestSig },
    segments: opts.segments,
  })

  return requestSig
}
