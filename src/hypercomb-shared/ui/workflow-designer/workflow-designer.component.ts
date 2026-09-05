// hypercomb-shared/ui/workflow-designer/workflow-designer.component.ts
//
// Right-docked "Workflow" designer — opened by `/workflow`
// (`workflow:view-open`).
//
// ── What this window is, and what the canvas is ───────────────────────
//
// The canvas IS the workflow. A workflow is a cell, its steps are its child
// tiles, and their order is the order you see. So this window deliberately
// does NOT draw a node graph: it would be a second, worse view of tiles you
// are already looking at, and the moment you dragged a tile the two would
// disagree.
//
// What the canvas cannot do is the rest of it, and that is all this window
// holds:
//   • the PALETTE — what a step can be (every control kind, and every slash
//     command the hive currently answers to). You DRAG one onto the hive to
//     place it: drop on empty space to add a step at the end, drop on an
//     existing step tile to make it that kind.
//   • the INSPECTOR — the selected step's kind and its arguments.
//   • the RUN bar — go, one-step-at-a-time, stop, with per-step status.
//   • naming it, which is what turns a workflow into a SKILL.
//
// It docks LEFT. The steps are on the canvas to its right, in the order they
// run, so the palette you drag FROM sits before the sequence you drag INTO.
//
// ── The drag ──────────────────────────────────────────────────────────
//
// Pointer events, not HTML5 drag-and-drop: the drop target is a WebGL canvas
// with no DOM nodes to land on. The tile under the release is resolved from
// RELEASE COORDINATES via TileOverlayDrone.labelAtClient — never a remembered
// `tile:hover`, which nulls the moment the pointer crosses chrome, and every
// drag out of a docked panel does exactly that. Same rule the pheromone drag
// follows, for the same reason.
//
// ── It reads nothing itself ───────────────────────────────────────────
//
// Shell UI must not import essentials, and a second reader of the workflow
// would drift from the runner's. WorkflowAuthorDrone is the one reader; this
// window renders `workflow:state` / `workflow:palette` / `workflow:run-state`
// (all sticky, so opening mid-run hydrates correctly) and emits intents back.
// Every write is an effect, never a layer touch from here.

import { registerShellSurface } from '@hypercomb/runtime/shell-surface-registry'
import {
  ChangeDetectorRef, Component, computed, inject, signal, type OnDestroy,
} from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { onSelection } from '../../core/selection-context'
import { TranslatePipe } from '../../core/i18n.pipe'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'
import { signalSession } from '../window-session'

/** A step as the author drone reports it. */
interface StateStep {
  cell: string
  index: number
  segments: string[]
  kind: string
  command?: string
  args?: string
  text?: string
  model?: string
  hasChildren: boolean
}

interface WorkflowStateMsg {
  segments?: string[]
  cell?: string
  isWorkflow?: boolean
  name?: string
  description?: string
  steps?: StateStep[]
  skills?: { name: string; segments: string[] }[]
}

interface PaletteEntry {
  kind: string
  icon: string
  label: string
  description: string
  group: 'control' | 'behaviour' | 'command'
  command?: string
  fields: ('command' | 'args' | 'text' | 'model')[]
}

interface RunResult {
  cell: string
  kind: string
  status: 'done' | 'skipped' | 'failed' | 'asked'
  detail?: string
}

interface RunStateMsg {
  running?: boolean
  paused?: boolean
  workflowName?: string
  at?: number
  total?: number
  results?: RunResult[]
  finished?: 'done' | 'stopped' | 'failed' | 'asked'
}

/** How many palette rows are drawn before the list asks you to narrow it.
 *  The hive answers to a lot of commands; an unbounded list is a wall. */
const PALETTE_LIMIT = 40

/** Movement before a press on a palette row counts as a drag rather than a
 *  click — small enough to feel immediate, large enough that a click that
 *  jitters still picks. Matches the pheromone list's threshold. */
const DRAG_THRESHOLD = 5

@Component({
  selector: 'hc-workflow-designer',
  standalone: true,
  imports: [TranslatePipe, DockInsetDirective, HcDockedPanelDirective],
  templateUrl: './workflow-designer.component.html',
  styleUrls: ['./workflow-designer.component.scss'],
})
export class WorkflowDesignerComponent implements OnDestroy {

  readonly visible = signal(false)

  /** Put away while the hive is covered — the design on the board, the
   *  inspector and any run in flight are all still there on return. */
  readonly session = signalSession(
    this.visible,
    open => EffectBus.emit('workflow:view-state', { open }),
    { dismiss: () => this.dismiss(), close: () => this.close() },
  )

  // ── what the drone tells us ───────────────────────────────────────
  readonly segments = signal<string[]>([])
  readonly cell = signal('')
  readonly isWorkflow = signal(false)
  readonly name = signal('')
  readonly description = signal('')
  readonly steps = signal<StateStep[]>([])
  readonly skills = signal<{ name: string; segments: string[] }[]>([])
  readonly #palette = signal<PaletteEntry[]>([])
  readonly run = signal<RunStateMsg | null>(null)

  // ── this window's own state ───────────────────────────────────────
  /** Which step the inspector is editing, by tile name. Follows the canvas
   *  selection (selection is a notification — selection-tool-windows.md) and
   *  can also be set by clicking a row here. */
  readonly selected = signal<string | null>(null)
  readonly paletteQuery = signal('')
  readonly paletteOpen = signal(false)
  /** The name typed into the empty state, before the workflow exists. */
  readonly draftName = signal('')

  // Inspector drafts — edits are staged and committed with Apply, so a
  // half-typed argument is never written to a layer.
  readonly draftCommand = signal('')
  readonly draftArgs = signal('')
  readonly draftText = signal('')
  readonly draftModel = signal('')

  readonly stepCount = computed(() => this.steps().length)

  readonly selectedStep = computed<StateStep | null>(() => {
    const want = this.selected()
    if (!want) return null
    return this.steps().find(s => s.cell === want) ?? null
  })

  /** The palette entry describing the selected step's kind — the inspector
   *  asks it which fields to draw rather than knowing any kind itself. */
  readonly selectedKind = computed<PaletteEntry | null>(() => {
    const step = this.selectedStep()
    if (!step) return null
    const rows = this.#palette()
    if (step.kind === 'command') {
      return rows.find(r => r.kind === 'command' && r.command === step.command)
        ?? rows.find(r => r.kind === 'command' && !r.command)
        ?? null
    }
    return rows.find(r => r.kind === step.kind) ?? null
  })

  readonly paletteRows = computed(() => {
    const q = this.paletteQuery().trim().toLowerCase()
    const rows = this.#palette()
    const matched = q
      ? rows.filter(r =>
          r.label.toLowerCase().includes(q) ||
          r.kind.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q))
      : rows
    return matched.slice(0, PALETTE_LIMIT)
  })

  readonly paletteTruncated = computed(() => {
    const q = this.paletteQuery().trim().toLowerCase()
    const total = q ? this.paletteRows().length : this.#palette().length
    return total > PALETTE_LIMIT || (!q && this.#palette().length > PALETTE_LIMIT)
  })

  readonly running = computed(() => this.run()?.running === true)
  readonly paused = computed(() => this.run()?.paused === true)
  readonly runResults = computed(() => this.run()?.results ?? [])

  /** Per-step run status, so the step list itself shows the run walking
   *  through it — the same information the log holds, where you are looking. */
  readonly statusByCell = computed<Record<string, RunResult['status']>>(() => {
    const out: Record<string, RunResult['status']> = {}
    for (const r of this.runResults()) out[r.cell] = r.status
    return out
  })

  #cleanups: (() => void)[] = []

  // The shell is ZONELESS: signals written from EffectBus callbacks do not
  // schedule a render on their own (see tags-viewer for the same remedy).
  readonly #cdr = inject(ChangeDetectorRef)
  #flush(): void { try { this.#cdr.detectChanges() } catch { /* view gone */ } }

  constructor() {
    this.#cleanups.push(EffectBus.on('workflow:view-open', () => {
      this.visible.set(true)
      EffectBus.emit('workflow:refresh', {})
      EffectBus.emit('workflow:view-state', { open: true })
      this.#flush()
    }))
    this.#cleanups.push(EffectBus.on('workflow:view-close', () => this.close()))

    this.#cleanups.push(EffectBus.on<WorkflowStateMsg>('workflow:state', (p) => {
      this.segments.set([...(p?.segments ?? [])])
      this.cell.set(p?.cell ?? '')
      this.isWorkflow.set(p?.isWorkflow === true)
      this.name.set(p?.name ?? '')
      this.description.set(p?.description ?? '')
      this.steps.set([...(p?.steps ?? [])])
      this.skills.set([...(p?.skills ?? [])])
      // A selected step that no longer exists (removed, or you walked to a
      // different workflow) must not linger in the inspector.
      const want = this.selected()
      if (want && !this.steps().some(s => s.cell === want)) this.selected.set(null)
      this.#loadDrafts()
      // A workflow with no steps yet is a panel whose one useful control is
      // hidden behind a disclosure — "No steps yet. Add one below" with the
      // below folded shut. So an empty workflow opens the palette itself.
      //
      // It only ever OPENS. Closing it again the moment the first step landed
      // would fold the palette away mid-build, and adding a second step would
      // cost a click that adding the first one did not. And it stops entirely
      // once the participant works the toggle themselves: an auto-opener that
      // keeps overriding you is worse than one that never helped.
      if (!this.#paletteTouched && this.isWorkflow() && this.steps().length === 0) {
        this.paletteOpen.set(true)
      }
      this.#flush()
    }))

    this.#cleanups.push(EffectBus.on<{ entries?: PaletteEntry[] }>('workflow:palette', (p) => {
      this.#palette.set([...(p?.entries ?? [])])
      this.#flush()
    }))

    this.#cleanups.push(EffectBus.on<RunStateMsg>('workflow:run-state', (p) => {
      this.run.set(p ?? null)
      this.#flush()
    }))

    // Selection response: the canvas tells us which tile is active, and the
    // inspector follows it. Clicking the step you mean on the hive is the
    // fastest way to edit it, and it costs this window one subscription.
    this.#cleanups.push(onSelection(({ active }) => {
      if (!active) return
      this.#focus(active)
    }))

    // The workflow SURFACE reports its own clicks: its nodes are SVG, so they
    // never travel through tile selection. Same response either way — the
    // inspector follows whichever surface you clicked on.
    this.#cleanups.push(EffectBus.on<{ cell?: string }>('workflow:step-focus', (p) => {
      if (p?.cell) this.#focus(p.cell)
    }))
  }

  ngOnDestroy(): void {
    this.#detachDrag()
    for (const c of this.#cleanups) c()
  }

  // ── the workflow ──────────────────────────────────────────────────

  /**
   * Turn the cell you are standing in into a workflow. Its child tiles —
   * whatever it already has — become its steps.
   *
   * At the hive root there is no tile to name, so this MINTS one and walks
   * into it instead. Standing at the root and being told you cannot have a
   * workflow was a dead end; the root simply has no tile of its own, which is
   * a reason to make one, not a reason to refuse.
   */
  declare(): void {
    const name = this.draftName().trim()
    if (!name) return
    EffectBus.emit(this.cell() ? 'workflow:declare' : 'workflow:create', { name })
    this.draftName.set('')
  }

  onDraftName(event: Event): void {
    this.draftName.set((event.target as HTMLInputElement | null)?.value ?? '')
  }

  onDraftNameKey(event: KeyboardEvent): void {
    event.stopPropagation()
    if (event.key === 'Enter') { event.preventDefault(); this.declare() }
  }

  // ── steps ─────────────────────────────────────────────────────────

  select(cell: string): void {
    this.selected.set(this.selected() === cell ? null : cell)
    this.#loadDrafts()
  }

  /** Focus a step because some SURFACE said so (tile selection, or a click on
   *  a node in the workflow view). Unlike `select` this never toggles off — an
   *  external click means "this one", never "put it away". */
  #focus(cell: string): void {
    if (!this.steps().some(s => s.cell === cell)) return
    this.selected.set(cell)
    this.#loadDrafts()
    this.#flush()
  }

  isSelected(cell: string): boolean { return this.selected() === cell }

  statusOf(cell: string): string { return this.statusByCell()[cell] ?? '' }

  /** The step's one-line summary — what it will actually do. */
  summaryOf(step: StateStep): string {
    if (!step.kind) return ''
    if (step.kind === 'command') return `/${step.command ?? '?'} ${step.args ?? ''}`.trim()
    if (step.text) return step.text
    if (step.kind === 'sub') return step.hasChildren ? '' : 'no child tiles yet'
    return ''
  }

  // ── the inspector ─────────────────────────────────────────────────

  #loadDrafts(): void {
    const step = this.selectedStep()
    this.draftCommand.set(step?.command ?? '')
    this.draftArgs.set(step?.args ?? '')
    this.draftText.set(step?.text ?? '')
    this.draftModel.set(step?.model ?? '')
  }

  onCommand(event: Event): void { this.draftCommand.set(value(event)) }
  onArgs(event: Event): void { this.draftArgs.set(value(event)) }
  onText(event: Event): void { this.draftText.set(value(event)) }
  onModel(event: Event): void { this.draftModel.set(value(event)) }
  swallow(event: KeyboardEvent): void { event.stopPropagation() }

  hasField(field: PaletteEntry['fields'][number]): boolean {
    return this.selectedKind()?.fields?.includes(field) === true
  }

  /** Commit the inspector's drafts onto the selected step's tile. */
  apply(): void {
    const step = this.selectedStep()
    if (!step) return
    EffectBus.emit('workflow:step-set', {
      segments: step.segments,
      step: {
        kind: step.kind,
        // A step dragged in as `/note` already knows its command and offers no
        // field for it; a bare `command` step is named here. Fall back to what
        // the step already holds so the un-offered field is never blanked.
        command: this.hasField('command') ? this.draftCommand() : step.command,
        args: this.draftArgs(),
        text: this.draftText(),
        model: this.draftModel(),
      },
    })
  }

  // ── the palette ───────────────────────────────────────────────────

  /** The participant has taken the palette's state into their own hands —
   *  stop auto-opening it from here on (per mount). */
  #paletteTouched = false

  togglePalette(): void {
    this.#paletteTouched = true
    this.paletteOpen.update(v => !v)
  }

  onPaletteQuery(event: Event): void { this.paletteQuery.set(value(event)) }

  /**
   * Picking a palette row ADDS a step — a real child tile, created the same
   * way any tile is created, then given this kind. With a step selected it
   * re-types that step instead, so the palette is both "add" and "change to".
   *
   * This is the keyboard/touch path; DRAGGING the row onto the hive is the
   * gesture, and it can also aim at a particular tile.
   */
  pick(entry: PaletteEntry): void {
    // The click that ends a drag must not also act on the row.
    if (this.#swallowClick) { this.#swallowClick = false; return }
    const step = this.selectedStep()
    if (step) {
      EffectBus.emit('workflow:step-set', { segments: step.segments, step: seedOf(entry) })
      return
    }
    EffectBus.emit('workflow:step-add', {
      segments: this.segments(),
      step: seedOf(entry),
      name: entry.command || entry.kind,
    })
  }

  // ── drag a step onto the hive ─────────────────────────────────────
  //
  // The direct gesture: pick the kind up out of the palette and drop it where
  // you want the step. Drop on empty hive → a new step tile at the end. Drop
  // ON a step tile → that step becomes this kind.
  //
  // Pointer events, and the drop resolves from RELEASE COORDINATES — see the
  // file header for why a remembered `tile:hover` is wrong here.

  /** Candidate press, promoted to a real drag once the pointer moves far
   *  enough. */
  #pending: { entry: PaletteEntry; x: number; y: number } | null = null
  /** A drag just ended — swallow the click it would otherwise fire. */
  #swallowClick = false

  /** The entry being dragged, or null. Drives the ghost chip that follows the
   *  cursor: the drag IS the gesture, so it has to be visible the whole way
   *  from the palette to the tile. */
  readonly dragging = signal<PaletteEntry | null>(null)
  readonly dragPos = signal<{ x: number; y: number }>({ x: 0, y: 0 })

  onRowPointerDown(event: PointerEvent, entry: PaletteEntry): void {
    if (event.button !== 0) return
    // Drag-to-place is a POINTER affordance, off on phones: there, dragging a
    // row IS the scroll gesture, so scrolling this list past the threshold
    // would drop a step onto whatever tile sat underneath.
    if (this.#isPhone()) return
    this.#pending = { entry, x: event.clientX, y: event.clientY }
    document.addEventListener('pointermove', this.#onDragMove)
    document.addEventListener('pointerup', this.#onDragUp)
    // If the browser takes the gesture we get a pointercancel and NEVER a
    // pointerup — without this the ghost hangs on screen and the listeners
    // leak until the next drag.
    document.addEventListener('pointercancel', this.#onDragCancel)
  }

  #isPhone(): boolean {
    try { return window.matchMedia('(max-width: 599px), (max-height: 449px)').matches }
    catch { return false }
  }

  #detachDrag(): void {
    document.removeEventListener('pointermove', this.#onDragMove)
    document.removeEventListener('pointerup', this.#onDragUp)
    document.removeEventListener('pointercancel', this.#onDragCancel)
  }

  #onDragMove = (event: PointerEvent): void => {
    const p = this.#pending
    if (!p) return
    if (!this.dragging()) {
      if (Math.hypot(event.clientX - p.x, event.clientY - p.y) < DRAG_THRESHOLD) return
      // Promote to a drag. `drop:dragging` puts the tile overlay into its bare
      // drop-target mode (icons hidden) — the same mode file drops use — so the
      // hive reads as a surface to land on rather than a menu.
      this.dragging.set(p.entry)
      EffectBus.emit('drop:dragging', { active: true })
    }
    this.dragPos.set({ x: event.clientX, y: event.clientY })
    this.#flush()
  }

  #onDragCancel = (): void => {
    this.#pending = null
    this.#detachDrag()
    if (this.dragging()) {
      this.dragging.set(null)
      EffectBus.emit('drop:dragging', { active: false })
      this.#flush()
    }
  }

  #onDragUp = (event: PointerEvent): void => {
    const p = this.#pending
    const wasDragging = this.dragging() !== null
    this.#pending = null
    this.#detachDrag()
    if (!wasDragging || !p) return

    this.dragging.set(null)
    this.#flush()
    EffectBus.emit('drop:dragging', { active: false })
    this.#swallowClick = true

    // A drop back onto this panel is a cancel, not a step at (x, y) — the hive
    // is the drop surface, and releasing over the palette you dragged from
    // plainly means "never mind".
    const over = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null
    if (over?.closest?.('.workflow-panel')) return

    // On the WORKFLOW surface the steps are SVG nodes, not hexagons, so there
    // is a real element under the pointer and it names itself. Read it here
    // and hand the drone an explicit label; the hex canvas has no such node,
    // and there the drone resolves the release point through the tile overlay
    // instead. One drag, either surface.
    const node = over?.closest?.('[data-workflow-step]') as HTMLElement | null
    const label = node?.getAttribute('data-workflow-step') ?? undefined

    EffectBus.emit('workflow:step-drop', {
      segments: this.segments(),
      step: seedOf(p.entry),
      name: p.entry.command || p.entry.kind,
      ...(label ? { label } : {}),
      x: event.clientX,
      y: event.clientY,
    })
  }

  // ── running ───────────────────────────────────────────────────────

  start(): void { EffectBus.emit('workflow:run', { segments: this.segments(), stepThrough: false }) }
  startStepwise(): void { EffectBus.emit('workflow:run', { segments: this.segments(), stepThrough: true }) }
  next(): void { EffectBus.emit('workflow:run-next', {}) }
  stop(): void { EffectBus.emit('workflow:run-stop', {}) }

  // ── chrome ────────────────────────────────────────────────────────

  close(): void {
    this.visible.set(false)
    EffectBus.emit('workflow:view-state', { open: false })
  }

  /** One level back per press: shut the palette, then drop the inspector's
   *  focus. False = nothing of ours was open, and the shell cascade carries on.
   *  Reached from the session; there is no listener here. */
  dismiss(): boolean {
    if (this.paletteOpen()) { this.paletteOpen.set(false); return true }
    if (this.selected()) { this.selected.set(null); return true }
    return false
  }
}

const value = (event: Event): string =>
  (event.target as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? ''

/** The step record a palette row stands for. */
const seedOf = (entry: PaletteEntry): { kind: string; command?: string } => ({
  kind: entry.kind,
  ...(entry.command ? { command: entry.command } : {}),
})

// Registry-fed shell surface — mounted by <hc-shell-surfaces>, never by an
// app.html tag (see shell-surface-registry.ts).
registerShellSurface({
  name: 'hc-workflow-designer',
  owner: '@hypercomb.shared/WorkflowDesignerComponent',
  component: WorkflowDesignerComponent,
  order: 135,
})
