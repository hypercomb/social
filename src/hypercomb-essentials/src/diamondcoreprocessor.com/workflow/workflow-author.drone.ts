// diamondcoreprocessor.com/workflow/workflow-author.drone.ts
//
// The authoring half of the designer: everything the panel needs to READ,
// and every write it asks for.
//
// ── Why the panel does none of this itself ────────────────────────────
//
// The designer is shell UI, and shell UI must not import essentials. More
// than that: a panel that read layers directly would be a second reader of
// the workflow, drifting from the runner's. So the drone is the ONE reader —
// it broadcasts `workflow:state` (sticky) and the panel is a pure view over
// it. Open the panel mid-run, navigate, undo a step: the panel is correct
// because it never knew anything the drone did not tell it.
//
// ── Adding a step is adding a TILE ────────────────────────────────────
//
// `workflow:step-add` creates a real child tile through the same
// LayerCommitter.importTree cascade the command line uses to create any
// tile, then writes the step decoration onto it. There is no other kind of
// creation here, and that is the point: the step you just added can be
// renamed, noted, tagged, given a picture, dragged into a different order,
// undone, shared and adopted, because it is a tile and tiles can do all of
// that already.
//
// `workflow:step-drop` is the same write, aimed: the designer hands over the
// RELEASE COORDINATES of a drag and this drone resolves the tile underneath
// via `TileOverlayDrone.labelAtClient`. Land on one of the workflow's step
// tiles and that step becomes the dragged kind; land anywhere else and a new
// step is added at the end. Coordinates, never a remembered `tile:hover` —
// crossing the panel's own chrome nulls the hover on the way out.
//
// ── Step tiles RENDER as their kind ───────────────────────────────────
//
// A step is a cell, but while you are standing in the workflow it should not
// LOOK like a generic cell — it should look like what it does. So this drone
// contributes one overlay icon provider per registered step kind, each gated
// on "this tile is a step of that kind", and the tiles on the hive carry the
// palette's own glyph: a terminal for a command, a question mark for an ask,
// a tree for a sub-workflow. Same mechanism the pheromone icon uses; no new
// render path, and it costs nothing on a page that is not a workflow because
// the gate is a map lookup that is empty there.

import { Drone, EffectBus } from '@hypercomb/core'
import { canonicalizeLineageSegment } from '../history/lineage-key.js'
import { listWorkflows, nameWorkflow, readWorkflow } from './workflow-slot.js'
import { readSteps, writeStep, type WorkflowStep } from './workflow-step.js'
import { ensureEnrollment, ensureSiteArtifact, siteGroupFor } from '../pheromones/enrollment-acts.js'
import { WORKFLOW_FAMILY } from './workflow-family.js'
import type { WorkflowPaletteEntry, WorkflowStepRegistry } from './workflow-step-registry.js'

/** One step as the panel draws it — the record flattened onto the tile. */
export interface WorkflowStateStep {
  readonly cell: string
  readonly index: number
  readonly segments: readonly string[]
  readonly kind: string
  readonly command?: string
  readonly args?: string
  readonly text?: string
  readonly model?: string
  readonly hasChildren: boolean
}

/** Broadcast on `workflow:state` (sticky). */
export interface WorkflowState {
  /** The cell the participant is standing in. */
  readonly segments: readonly string[]
  readonly cell: string
  readonly isWorkflow: boolean
  readonly name: string
  readonly description: string
  readonly steps: readonly WorkflowStateStep[]
  /** Named workflows reachable from anywhere — the skill list. */
  readonly skills: readonly { name: string; segments: readonly string[] }[]
}

type LineageLike = { explorerSegments?: () => readonly string[] } & Partial<EventTarget>
type CommitterLike = {
  importTree?: (
    updates: { segments: readonly string[]; layer: { name?: string } & Record<string, unknown> }[],
  ) => Promise<void>
}
type OverlayLike = { labelAtClient(x: number, y: number): string | null }

/** Shell-side icon registry contract, declared locally — essentials must not
 *  import shared. (Same local declaration PheromoneTilesDrone makes.) */
type IconProviderRegistryLike = {
  add(p: {
    name: string
    owner?: string
    svgMarkup: string
    profiles?: readonly string[]
    defaultActive?: boolean
    hoverTint?: number
    visibleWhen?: (ctx: { label?: string }) => boolean
    labelKey?: string
    descriptionKey?: string
  }): void
  remove(name: string): void
}

/** Material Symbols are a FONT, and the overlay takes SVG markup — so a step
 *  kind's on-tile glyph is drawn here, in the same stroke style as the other
 *  overlay icons. Keyed by the registry kind; anything without an entry falls
 *  back to the generic step mark. */
const STEP_GLYPHS: Record<string, string> = {
  // terminal — a command step
  command: '<path d="M4 17l6-5-6-5"/><line x1="12" y1="19" x2="20" y2="19"/>',
  // branching tree — a sub-workflow
  sub: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M6 8.5v9a1 1 0 0 0 1 1h8.5"/><path d="M8.5 6h7"/>',
  // page with a line — a note
  note: '<path d="M6 3h9l3 3v15H6z"/><line x1="9" y1="10" x2="15" y2="10"/><line x1="9" y1="14" x2="13" y2="14"/>',
  // question — an ask, waiting on a person
  ask: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.2 2.4c-.5.2-.7.6-.7 1.1v.5"/><line x1="12" y1="16.5" x2="12" y2="16.6"/>',
}

/** The mark a step tile carries when its kind has no glyph of its own. */
const STEP_FALLBACK_GLYPH = '<circle cx="12" cy="12" r="8"/><path d="M9 12h6"/>'

const stepIconSvg = (kind: string): string =>
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"'
  + ' fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
  + (STEP_GLYPHS[kind] ?? STEP_FALLBACK_GLYPH)
  + '</svg>'

/** Overlay icon provider name for a kind — one provider per kind, so each
 *  tile can carry a DIFFERENT glyph (a provider has exactly one markup). */
const iconNameFor = (kind: string): string => `workflow-step:${kind}`

const ioc = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: <U>(k: string) => U | undefined } }).ioc?.get?.<T>(key)

export class WorkflowAuthorDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'workflow'

  public override description =
    'Reads the workflow you are standing in and applies the designer\'s edits — declaring it, adding step tiles, setting a step\'s kind.'

  protected override listens = [
    'workflow:view-open', 'workflow:refresh', 'workflow:changed',
    'workflow:declare', 'workflow:create',
    'workflow:step-add', 'workflow:step-set', 'workflow:step-drop',
  ]
  protected override emits = [
    'workflow:state', 'workflow:palette', 'cell:added', 'toast:show',
    'overlay:request-register',
  ]

  #wired = false
  /** Coalesces the re-reads that navigation and commits both trigger. */
  #refreshTimer: ReturnType<typeof setTimeout> | null = null
  /** Step kind per tile name on the page you are standing on — the gate the
   *  on-tile icons read. Empty on any page that is not a workflow, which is
   *  what makes the icons cost nothing everywhere else. */
  #kindByCell = new Map<string, string>()
  /** EVERY child tile of the workflow you are in — including ones with no
   *  kind yet. Drop targeting uses this, not `#kindByCell`: the tile you most
   *  want to drop a kind onto is precisely the one that has none. */
  #stepCells = new Set<string>()
  /** Kinds that currently have an icon provider registered. */
  #iconKinds = new Set<string>()

  protected override heartbeat = async (): Promise<void> => {
    if (this.#wired) return
    this.#wired = true

    this.onEffect('workflow:view-open', () => {
      this.#schedule(); this.#emitPalette(); void this.#maybeShowSurface()
    })
    this.onEffect('workflow:refresh', () => this.#schedule())
    this.onEffect('workflow:changed', () => this.#schedule())

    this.onEffect<{ name?: string; description?: string; segments?: readonly string[] }>(
      'workflow:declare', (p) => { void this.#declare(p ?? {}) })

    this.onEffect<{ name?: string; description?: string; segments?: readonly string[] }>(
      'workflow:create', (p) => { void this.#create(p ?? {}) })

    this.onEffect<{
      segments?: readonly string[]
      step?: Partial<WorkflowStep>
      name?: string
    }>('workflow:step-add', (p) => { void this.#addStep(p ?? {}) })

    this.onEffect<{ segments?: readonly string[]; step?: Partial<WorkflowStep> }>(
      'workflow:step-set', (p) => { void this.#setStep(p ?? {}) })

    this.onEffect<{
      segments?: readonly string[]
      step?: Partial<WorkflowStep>
      name?: string
      x?: number
      y?: number
    }>('workflow:step-drop', (p) => { void this.#dropStep(p ?? {}) })

    // The workflow you are looking at changes when you walk, and its steps
    // change when anything commits. Both just re-read; the read is small
    // (one layer plus its children) and coalesced.
    const lineage = ioc<LineageLike>('@hypercomb.social/Lineage')
    lineage?.addEventListener?.('change', () => this.#schedule())
    window.addEventListener('synchronize', () => this.#schedule())

    this.#schedule()
  }

  // ── reading ─────────────────────────────────────────────────────────

  #schedule(): void {
    if (this.#refreshTimer) clearTimeout(this.#refreshTimer)
    this.#refreshTimer = setTimeout(() => { this.#refreshTimer = null; void this.#broadcast() }, 60)
  }

  async #broadcast(): Promise<void> {
    const segments = this.#segments()
    const record = segments.length ? await readWorkflow(segments) : null
    const steps = record ? await readSteps(segments) : []
    const skills = (await listWorkflows()).map(w => ({ name: w.name, segments: w.segments }))

    EffectBus.emit<WorkflowState>('workflow:state', {
      segments,
      cell: segments[segments.length - 1] ?? '',
      isWorkflow: record !== null,
      name: record?.name ?? '',
      description: record?.description ?? '',
      steps: steps.map(s => ({
        cell: s.cell,
        index: s.index,
        segments: s.segments,
        kind: s.step?.kind ?? '',
        command: s.step?.command,
        args: s.step?.args,
        text: s.step?.text,
        model: s.step?.model,
        hasChildren: s.hasChildren,
      })),
      skills,
    })

    this.#syncStepIcons(steps.map(s => ({ cell: s.cell, kind: s.step?.kind ?? '' })))
  }

  /**
   * Show the workflow SURFACE for this cell — the flow, not the honeycomb.
   *
   * A workflow is an ORDER, and a hex grid cannot say order; it says
   * "siblings", which is true and useless here. So opening the designer on a
   * workflow switches the render surface, exactly as opening a website does.
   *
   * Only ever switches ONTO a workflow cell, and only from the hexagon
   * surface: someone who has deliberately put the hive in another view (a
   * website, the tree) has said what they want to look at, and yanking that
   * away because they opened a panel would be the panel overruling them.
   */
  /** Opening the designer on a cell that IS a workflow shows its surface. On
   *  anything else it does nothing — there is no flow to draw. */
  async #maybeShowSurface(): Promise<void> {
    const segments = this.#segments()
    if (!segments.length) return
    if (await readWorkflow(segments)) this.#showSurface(segments)
  }

  #showSurface(segments: readonly string[]): void {
    const vm = ioc<{ mode?: string; setMode?: (m: string) => void }>('@hypercomb.social/ViewMode')
    if (!vm?.setMode || !segments.length) return
    if (vm.mode && vm.mode !== 'hexagons') return
    vm.setMode('workflow')
  }

  /**
   * Keep the on-tile step marks in step with what the page actually holds:
   * refresh the tile→kind gate, then make sure every kind on screen has its
   * icon provider (and none linger for kinds that left).
   */
  #syncStepIcons(steps: readonly { cell: string; kind: string }[]): void {
    const next = new Map<string, string>()
    for (const s of steps) if (s.kind) next.set(s.cell, s.kind)
    this.#stepCells = new Set(steps.map(s => s.cell))

    const registry = ioc<IconProviderRegistryLike>('@hypercomb.social/IconProviderRegistry')
    if (!registry) { this.#kindByCell = next; return }

    const wanted = new Set(next.values())
    const same = wanted.size === this.#iconKinds.size
      && [...wanted].every(k => this.#iconKinds.has(k))
    // The GATE has to be swapped before any repaint, even when the kind set is
    // unchanged — walking between two workflows keeps the same kinds but every
    // tile name is different.
    this.#kindByCell = next
    if (same) return

    for (const kind of this.#iconKinds) {
      if (!wanted.has(kind)) registry.remove(iconNameFor(kind))
    }
    for (const kind of wanted) {
      if (this.#iconKinds.has(kind)) continue
      registry.add({
        name: iconNameFor(kind),
        owner: this.iocKey,
        svgMarkup: stepIconSvg(kind),
        profiles: ['private', 'public-own'],
        defaultActive: true,
        visibleWhen: (ctx) => !!ctx?.label && this.#kindByCell.get(ctx.label) === kind,
        labelKey: `workflow.kind.${kind}`,
      })
    }
    this.#iconKinds = new Set(wanted)
    // Purge/rebuild the overlay icons so a step's mark appears (or leaves)
    // without needing a re-hover.
    this.emitEffect('overlay:request-register', {})
  }

  /** The palette is derived from what is registered RIGHT NOW, so it is
   *  re-emitted whenever the registry changes as well as on open. */
  #emitPalette(): void {
    const registry = ioc<WorkflowStepRegistry>('@diamondcoreprocessor.com/WorkflowStepRegistry')
    if (!registry) return
    EffectBus.emit<{ entries: WorkflowPaletteEntry[] }>('workflow:palette', {
      entries: registry.palette(),
    })
    if (!this.#paletteWatched) {
      this.#paletteWatched = true
      registry.addEventListener('change', () => this.#emitPalette())
    }
  }
  #paletteWatched = false

  #segments(): string[] {
    const lineage = ioc<LineageLike>('@hypercomb.social/Lineage')
    return [...(lineage?.explorerSegments?.() ?? [])]
  }

  // ── writing ─────────────────────────────────────────────────────────

  async #declare(opts: {
    name?: string
    description?: string
    segments?: readonly string[]
  }): Promise<void> {
    const segments = [...(opts.segments ?? this.#segments())]
    const name = String(opts.name ?? '').trim()
    if (!segments.length) { this.#toast('warning', 'The hive root cannot be a workflow'); return }
    if (!name) { this.#toast('warning', 'Give the workflow a name'); return }

    try {
      await nameWorkflow({
        segments,
        name,
        description: opts.description,
        at: Date.now(),
      })
      // The relation, so steps can enrol in it. Idempotent — declaring an
      // existing workflow again never unnames it.
      await ensureSiteArtifact(segments, name, WORKFLOW_FAMILY)
      this.#toast('success', `"${name}" is a workflow`)
      this.#showSurface(segments)
    } catch (error) {
      this.#toast('warning', messageOf(error))
    }
    this.#schedule()
  }

  /**
   * Make a NEW tile here and declare it a workflow, then walk into it.
   *
   * This is the answer to standing somewhere that cannot itself become one —
   * the hive root, most obviously, which has no tile of its own. Refusing and
   * stopping there was a dead end: the participant asked for a workflow and
   * got a sentence explaining why they could not have one. Now they get one.
   *
   * It is the ordinary create + the ordinary declare, in that order; nothing
   * about the records is special because the tile was minted here.
   */
  async #create(opts: {
    name?: string
    description?: string
    segments?: readonly string[]
  }): Promise<void> {
    const parent = [...(opts.segments ?? this.#segments())]
    const name = String(opts.name ?? '').trim()
    if (!name) { this.#toast('warning', 'Give the workflow a name'); return }

    const cell = canonicalizeLineageSegment(name)
    if (!cell) { this.#toast('warning', `"${name}" is not a usable tile name`); return }

    const committer = ioc<CommitterLike>('@diamondcoreprocessor.com/LayerCommitter')
    if (!committer?.importTree) { this.#toast('warning', 'Layer committer not available'); return }

    EffectBus.emit('cell:added', { cell, segments: parent, viaUpdate: true })
    await committer.importTree([{ segments: [...parent, cell], layer: { name: cell } }])

    await this.#declare({ segments: [...parent, cell], name, description: opts.description })

    // Walk into it: the steps live inside, so leaving the participant outside
    // looking at the tile they just made would just be a second click.
    ioc<{ goRaw?: (s: readonly string[]) => void }>('@hypercomb.social/Navigation')
      ?.goRaw?.([...parent, cell])
    this.#schedule()
  }

  /**
   * Add a step: make a tile, give it its kind, and ENROL it in the workflow.
   *
   * The tile is filed under the workflow because a tile has to live somewhere
   * and that is the least surprising place — but filing is not membership. What
   * makes it a step is the enrolment mark, which is also where its position
   * lives, so the same tile can later be moved, or enrolled in a second
   * workflow, without either workflow noticing.
   *
   * The name comes from the step (a command's own name, or the kind's) and is
   * de-duplicated against the steps already there — a name is an address, so two
   * tiles under one parent cannot share one.
   */
  async #addStep(opts: {
    segments?: readonly string[]
    step?: Partial<WorkflowStep>
    name?: string
  }): Promise<void> {
    const workflowSegments = [...(opts.segments ?? this.#segments())]
    if (!workflowSegments.length) return

    const step: WorkflowStep = {
      v: 1,
      kind: String(opts.step?.kind ?? '').trim() || 'command',
      ...(opts.step?.command ? { command: String(opts.step.command) } : {}),
      ...(opts.step?.args ? { args: String(opts.step.args) } : {}),
      ...(opts.step?.text ? { text: String(opts.step.text) } : {}),
      ...(opts.step?.model ? { model: String(opts.step.model) } : {}),
    }

    const existing = (await readSteps(workflowSegments)).map(s => s.cell)
    const cell = uniqueName(
      canonicalizeLineageSegment(opts.name?.trim() || step.command || step.kind) || 'step',
      existing,
    )

    const committer = ioc<CommitterLike>('@diamondcoreprocessor.com/LayerCommitter')
    if (!committer?.importTree) { this.#toast('warning', 'Layer committer not available'); return }

    // Same two beats the command line uses: announce the tile so it mounts
    // immediately (`viaUpdate` tells the commit listener the importTree below
    // IS the commit), then commit the cascade.
    EffectBus.emit('cell:added', { cell, segments: workflowSegments, viaUpdate: true })
    await committer.importTree([
      { segments: [...workflowSegments, cell], layer: { name: cell } },
    ])

    const stepSegments = [...workflowSegments, cell]
    try {
      await writeStep({ segments: stepSegments, step })
    } catch (error) {
      // The tile exists and is a step with no kind yet — recoverable, and the
      // designer shows it as needing one rather than pretending it landed.
      this.#toast('warning', `Step tile added, but its kind did not stick: ${messageOf(error)}`)
    }

    // MEMBERSHIP, which is a separate act from making the tile. A workflow
    // declared before the remodel names no relation; there is nothing to enrol
    // in, and its steps keep being read from its children.
    try {
      const record = await readWorkflow(workflowSegments)
      const group = record ? await siteGroupFor(record.name, WORKFLOW_FAMILY) : null
      if (group) await ensureEnrollment(stepSegments, group.sig, group.meaning)
    } catch (error) {
      this.#toast('warning', `Step tile added, but it did not join the workflow: ${messageOf(error)}`)
    }
    this.#schedule()
  }

  /**
   * A kind dragged out of the palette and released over the hive.
   *
   * The tile under the RELEASE POINT decides what happens: one of this
   * workflow's step tiles becomes the dragged kind; anything else (empty
   * space, a tile that is not a step here) adds a step at the end. Aiming is
   * optional — dropping on open canvas is the ordinary "add one" gesture.
   */
  async #dropStep(opts: {
    segments?: readonly string[]
    step?: Partial<WorkflowStep>
    name?: string
    label?: string
    x?: number
    y?: number
  }): Promise<void> {
    const workflowSegments = [...(opts.segments ?? this.#segments())]
    if (!workflowSegments.length || !opts.step?.kind) return

    // An explicit label comes from the WORKFLOW surface, whose step nodes are
    // real DOM elements that name themselves. The hex canvas has no such node,
    // so there the release point is resolved through the tile overlay.
    let label = String(opts.label ?? '').trim()
    if (!label && typeof opts.x === 'number' && typeof opts.y === 'number') {
      label = ioc<OverlayLike>('@diamondcoreprocessor.com/TileOverlayDrone')
        ?.labelAtClient(opts.x, opts.y) ?? ''
    }

    // Only a tile that is a STEP OF THIS WORKFLOW is a re-type target. A drop
    // on some other tile is not an invitation to decorate it — the workflow
    // owns its steps and nothing else.
    if (label && this.#stepCells.has(label)) {
      await this.#setStep({ segments: [...workflowSegments, label], step: opts.step })
      return
    }
    await this.#addStep({ segments: workflowSegments, step: opts.step, name: opts.name })
  }

  /** Re-type an existing step tile. */
  async #setStep(opts: { segments?: readonly string[]; step?: Partial<WorkflowStep> }): Promise<void> {
    const segments = [...(opts.segments ?? [])]
    const kind = String(opts.step?.kind ?? '').trim()
    if (!segments.length || !kind) return

    const step: WorkflowStep = {
      v: 1,
      kind,
      ...(opts.step?.command ? { command: String(opts.step.command) } : {}),
      ...(opts.step?.args ? { args: String(opts.step.args) } : {}),
      ...(opts.step?.text ? { text: String(opts.step.text) } : {}),
      ...(opts.step?.model ? { model: String(opts.step.model) } : {}),
    }
    try {
      await writeStep({ segments, step })
    } catch (error) {
      this.#toast('warning', messageOf(error))
    }
    this.#schedule()
  }

  #toast(type: 'info' | 'success' | 'warning', message: string): void {
    try { EffectBus.emit('toast:show', { type, title: 'Workflow', message }) } catch { /* noop */ }
  }
}

/** `note`, `note-2`, `note-3` … — a name is an address, so it must be free. */
function uniqueName(base: string, taken: readonly string[]): string {
  const used = new Set(taken.map(t => t.toLowerCase()))
  if (!used.has(base.toLowerCase())) return base
  for (let n = 2; n < 500; n++) {
    const candidate = `${base}-${n}`
    if (!used.has(candidate.toLowerCase())) return candidate
  }
  return `${base}-${Date.now()}`
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'failed')
}

const _workflowAuthor = new WorkflowAuthorDrone()
window.ioc.register('@diamondcoreprocessor.com/WorkflowAuthorDrone', _workflowAuthor)
