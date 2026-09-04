// workflow/workflow-runner.drone.ts
//
// Runs a workflow: walks the workflow cell's child tiles in canvas order and
// executes each one's step record.
//
// ── What a run is, and what it is not ─────────────────────────────────
//
// It is a sequence of ordinary hive operations, performed as if you had
// typed them. Almost every step is a slash command, so a run leaves exactly
// the traces the same commands leave by hand: layers, notes, decorations,
// markers. There is no separate workflow substrate to reconcile.
//
// It is NOT an AI agent. An `ask` step deposits a request and the run STOPS
// on it (status `asked`) — generation begins only from the participant's own
// answer as a Q&A row on the tile. See workflow-ask.ts for why that is not
// negotiable.
//
// ── The run does not move you ─────────────────────────────────────────
//
// A running workflow never navigates. Yanking the canvas from under someone
// mid-run is how a "helpful" automation becomes something you stop trusting,
// and a step that failed halfway would leave them somewhere they did not
// choose to be. Steps run where the participant stands; `{scope}` gives a
// step the workflow's own path when it needs to name a target explicitly.
//
// ── Where the run log lives (and why not in the layer) ────────────────
//
// Live only: the state is broadcast on `workflow:run-state` (sticky, so a
// designer opened mid-run hydrates correctly) and is gone on reload. A run
// log is not a property of the hive — it is diagnostics about one
// participant's session, and putting it in a layer would change the
// workflow's signature every time anybody ran it, so your copy and mine
// would diverge for no reason. The DURABLE record of a run is what its
// steps actually did.
//
// If it is ever persisted it belongs in a pool of meaning —
// `sign('workflow:runs')`, with the colon that keeps a pool address out of
// the bare-word collision space (known-location-pools.md) — and never in a
// slot.

import { Drone, EffectBus } from '@hypercomb/core'
import { readWorkflow } from './workflow-slot.js'
import { readSteps, type WorkflowStep, type WorkflowStepView } from './workflow-step.js'
import type {
  WorkflowRunContext, WorkflowStepKind, WorkflowStepOutcome, WorkflowStepRegistry,
} from './workflow-step-registry.js'

/** How deep `sub` steps may nest before the runner refuses. A workflow that
 *  reaches its own ancestor would otherwise run forever; the cap is the
 *  cheap, obvious guard rather than a cycle detector nobody can debug. */
const MAX_DEPTH = 4

/** One step's result, as the designer shows it. */
export interface WorkflowRunResult {
  readonly cell: string
  readonly kind: string
  readonly status: WorkflowStepOutcome['status']
  readonly detail?: string
}

/** Broadcast on `workflow:run-state` — sticky, so a panel opened mid-run is
 *  immediately correct. */
export interface WorkflowRunState {
  readonly running: boolean
  /** True while a step-through run waits for `workflow:run-next`. */
  readonly paused: boolean
  readonly workflowName: string
  readonly segments: readonly string[]
  /** Index of the step about to run (or just finished when stopped). */
  readonly at: number
  readonly total: number
  readonly results: readonly WorkflowRunResult[]
  /** Set when the run has ended — 'done', 'stopped', 'failed', 'asked'. */
  readonly finished?: 'done' | 'stopped' | 'failed' | 'asked'
}

type LineageLike = { explorerSegments?: () => readonly string[] }
type SlashLike = { execute?: (name: string, args: string) => Promise<void> | void }

const ioc = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: <U>(k: string) => U | undefined } }).ioc?.get?.<T>(key)

export class WorkflowRunnerDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'workflow'

  public override description =
    'Runs a workflow cell: executes each child tile\'s step in canvas order, reporting per-step status.'

  protected override listens = ['workflow:run', 'workflow:run-next', 'workflow:run-stop']
  protected override emits = ['workflow:run-state', 'toast:show']

  #wired = false

  /** The live run, or null. One at a time: a second `workflow:run` while one
   *  is going is refused rather than interleaved, because two runs writing
   *  to the same tiles is a race the participant cannot see. */
  #run: {
    segments: readonly string[]
    workflowName: string
    steps: WorkflowStepView[]
    results: WorkflowRunResult[]
    at: number
    stepThrough: boolean
    continueOnError: boolean
    stopped: boolean
  } | null = null

  protected override heartbeat = async (): Promise<void> => {
    if (this.#wired) return
    this.#wired = true

    this.onEffect<{
      segments?: readonly string[]
      stepThrough?: boolean
      continueOnError?: boolean
    }>('workflow:run', (p) => { void this.#start(p ?? {}) })

    this.onEffect('workflow:run-next', () => { void this.#advance() })

    this.onEffect('workflow:run-stop', () => { this.#stop('stopped') })
  }

  // ── starting ────────────────────────────────────────────────────────

  async #start(opts: {
    segments?: readonly string[]
    stepThrough?: boolean
    continueOnError?: boolean
  }): Promise<void> {
    if (this.#run) {
      this.#toast('warning', 'A workflow is already running')
      return
    }

    const segments = [...(opts.segments ?? currentSegments())]
      .map(s => String(s ?? '').trim()).filter(Boolean)
    if (!segments.length) {
      this.#toast('warning', 'Stand in a workflow to run it')
      return
    }

    const record = await readWorkflow(segments)
    const steps = await readSteps(segments)
    if (!steps.length) {
      this.#toast('info', 'This workflow has no steps yet')
      return
    }

    this.#run = {
      segments,
      workflowName: record?.name ?? segments[segments.length - 1],
      steps,
      results: [],
      at: 0,
      stepThrough: opts.stepThrough === true,
      continueOnError: opts.continueOnError === true,
      stopped: false,
    }
    this.#broadcast()

    if (this.#run.stepThrough) return   // wait for the first `run-next`
    await this.#drain()
  }

  /** Step-through: run exactly one step, then wait again. */
  async #advance(): Promise<void> {
    const run = this.#run
    if (!run || !run.stepThrough) return
    const outcome = await this.#runOne(run.at)
    if (!this.#run) return              // stopped mid-step
    if (this.#shouldHalt(outcome)) return
    run.at++
    if (run.at >= run.steps.length) { this.#stop('done'); return }
    this.#broadcast()
  }

  /** Run-to-completion: step after step until something halts it. */
  async #drain(): Promise<void> {
    const run = this.#run
    if (!run) return
    while (this.#run && run.at < run.steps.length) {
      const outcome = await this.#runOne(run.at)
      if (!this.#run) return            // stopped mid-step
      if (this.#shouldHalt(outcome)) return
      run.at++
      this.#broadcast()
    }
    this.#stop('done')
  }

  /** A failure stops the run unless the participant asked to continue; an
   *  `ask` always stops, because the workflow is now waiting on a person. */
  #shouldHalt(outcome: WorkflowStepOutcome): boolean {
    const run = this.#run
    if (!run) return true
    if (outcome.status === 'asked') { this.#stop('asked'); return true }
    if (outcome.status === 'failed' && !run.continueOnError) { this.#stop('failed'); return true }
    return false
  }

  // ── executing one step ──────────────────────────────────────────────

  async #runOne(index: number): Promise<WorkflowStepOutcome> {
    const run = this.#run
    if (!run) return { status: 'skipped' }
    const view = run.steps[index]
    if (!view) return { status: 'skipped' }

    const outcome = await this.#execute(view.step, view, run.segments, run.workflowName, 0)
    run.results.push({
      cell: view.cell,
      kind: view.step?.kind ?? 'unset',
      status: outcome.status,
      detail: outcome.detail,
    })
    this.#broadcast()
    return outcome
  }

  /**
   * Execute one step record. Kinds with their own `run` own themselves;
   * `command` and `sub` are the runner's, because both need machinery the
   * registry has no business holding (the slash drone; the depth cap).
   */
  async #execute(
    step: WorkflowStep | null,
    view: WorkflowStepView,
    workflowSegments: readonly string[],
    workflowName: string,
    depth: number,
  ): Promise<WorkflowStepOutcome> {
    if (!step) return { status: 'skipped', detail: 'no kind yet' }

    const ctx: WorkflowRunContext = {
      step,
      cell: view.cell,
      segments: view.segments,
      workflowSegments,
      workflowName,
      interpolate: (template) => interpolate(template, {
        cell: view.cell,
        workflow: workflowName,
        scope: '/' + workflowSegments.join('/'),
        step: String(view.index + 1),
      }),
      runNested: (segments) => this.#runNested(segments, workflowName, depth + 1),
    }

    try {
      if (step.kind === 'command') return await this.#runCommand(ctx)
      if (step.kind === 'sub') return await ctx.runNested(view.segments)

      const kind = this.#registry()?.get(step.kind) as WorkflowStepKind | undefined
      if (!kind) return { status: 'failed', detail: `unknown step kind "${step.kind}"` }
      if (!kind.run) return { status: 'skipped', detail: `"${step.kind}" has no executor` }
      return await kind.run(ctx)
    } catch (error) {
      return { status: 'failed', detail: messageOf(error) }
    }
  }

  /** The workhorse: run a slash command exactly as the command line does. */
  async #runCommand(ctx: WorkflowRunContext): Promise<WorkflowStepOutcome> {
    const command = String(ctx.step.command ?? '').trim().replace(/^\/+/, '')
    if (!command) return { status: 'skipped', detail: 'no command' }

    const slash = ioc<SlashLike>('@diamondcoreprocessor.com/SlashBehaviourDrone')
    if (!slash?.execute) return { status: 'failed', detail: 'slash behaviours not available' }

    const args = ctx.interpolate(ctx.step.args ?? '')
    await slash.execute(command, args)
    return { status: 'done', detail: `/${command}${args ? ' ' + args : ''}`.slice(0, 120) }
  }

  /**
   * A step tile's own children, run as a workflow. Steps are tiles and tiles
   * have children, so nesting needed no new record — only a depth cap.
   */
  async #runNested(
    segments: readonly string[],
    workflowName: string,
    depth: number,
  ): Promise<WorkflowStepOutcome> {
    if (depth > MAX_DEPTH) {
      return { status: 'failed', detail: `sub-workflows nested deeper than ${MAX_DEPTH}` }
    }
    const steps = await readSteps(segments)
    if (!steps.length) return { status: 'skipped', detail: 'no child steps' }

    let ran = 0
    for (const child of steps) {
      if (!this.#run) return { status: 'skipped', detail: 'run stopped' }
      const outcome = await this.#execute(child.step, child, segments, workflowName, depth)
      const run = this.#run
      if (!run) return { status: 'skipped', detail: 'run stopped' }
      // A nested result is reported under its own tile name, so the run log
      // reads as one flat sequence rather than hiding what a `sub` did.
      run.results.push({
        cell: `${segments[segments.length - 1]} › ${child.cell}`,
        kind: child.step?.kind ?? 'unset',
        status: outcome.status,
        detail: outcome.detail,
      })
      this.#broadcast()
      if (outcome.status === 'asked') return outcome
      if (outcome.status === 'failed' && !run.continueOnError) return outcome
      if (outcome.status === 'done') ran++
    }
    return { status: 'done', detail: `${ran} nested step${ran === 1 ? '' : 's'}` }
  }

  // ── ending + reporting ──────────────────────────────────────────────

  #stop(finished: NonNullable<WorkflowRunState['finished']>): void {
    const run = this.#run
    if (!run) return
    run.stopped = true
    this.#broadcast(finished)
    this.#run = null

    const failed = run.results.filter(r => r.status === 'failed').length
    if (finished === 'failed') {
      this.#toast('warning', `${run.workflowName} stopped: ${run.results.at(-1)?.detail ?? 'a step failed'}`)
    } else if (finished === 'asked') {
      this.#toast('info', `${run.workflowName} is waiting on your answer`)
    } else if (finished === 'done') {
      this.#toast('success', failed
        ? `${run.workflowName} finished with ${failed} failed step${failed === 1 ? '' : 's'}`
        : `${run.workflowName} finished`)
    }
  }

  #broadcast(finished?: WorkflowRunState['finished']): void {
    const run = this.#run
    if (!run) {
      EffectBus.emit<WorkflowRunState>('workflow:run-state', {
        running: false, paused: false, workflowName: '', segments: [],
        at: 0, total: 0, results: [],
      })
      return
    }
    EffectBus.emit<WorkflowRunState>('workflow:run-state', {
      running: !finished,
      paused: run.stepThrough && !finished,
      workflowName: run.workflowName,
      segments: [...run.segments],
      at: run.at,
      total: run.steps.length,
      results: [...run.results],
      ...(finished ? { finished } : {}),
    })
  }

  #registry(): WorkflowStepRegistry | undefined {
    return ioc<WorkflowStepRegistry>('@diamondcoreprocessor.com/WorkflowStepRegistry')
  }

  #toast(type: 'info' | 'success' | 'warning', message: string): void {
    try { EffectBus.emit('toast:show', { type, title: 'Workflow', message }) } catch { /* noop */ }
  }
}

// ── helpers ───────────────────────────────────────────────────────────

/** `{cell}` / `{workflow}` / `{scope}` / `{step}`. Unknown tokens are left
 *  alone: a step whose argument legitimately contains braces must not have
 *  them silently eaten. */
function interpolate(template: string, vars: Record<string, string>): string {
  return String(template ?? '').replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match)
}

function currentSegments(): readonly string[] {
  const lineage = ioc<LineageLike>('@hypercomb.social/Lineage')
  return lineage?.explorerSegments?.() ?? []
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error ?? 'failed')
}

const _workflowRunner = new WorkflowRunnerDrone()
window.ioc.register('@diamondcoreprocessor.com/WorkflowRunnerDrone', _workflowRunner)
