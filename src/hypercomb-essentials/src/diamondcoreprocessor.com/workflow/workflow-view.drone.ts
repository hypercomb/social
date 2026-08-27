// diamondcoreprocessor.com/workflow/workflow-view.drone.ts
//
// The workflow SURFACE — a wide canvas that draws the steps as a flow
// instead of hexagons.
//
// ── Why a surface and not a tile skin ─────────────────────────────────
//
// Steps are tiles, and on the hex grid they look like tiles: a honeycomb
// says "these are siblings", which is true but says nothing about the one
// thing a workflow is — an ORDER. So the workflow gets its own render of
// the same layers, exactly as the website and tutor behaviours do
// (`/view` switches the surface; the tree is the same idea pointed at
// hierarchy). Nothing is copied, nothing is minted: this drone is a READER
// over `workflow:state`, the same broadcast the designer panel renders.
//
// ── The canvas is big on purpose ──────────────────────────────────────
//
// The flow runs left → right and the stage grows with it, scrolling rather
// than shrinking to fit. A workflow you cannot read is not a diagram, and a
// 20-step skill squeezed into 900px is exactly that. Fit-to-width is a
// button, never the default.
//
// It docks BESIDE the designer rather than under it — `viewport:inset` is
// the shell's existing "this panel reserves N px of that edge" contract, so
// the canvas starts where the palette ends and the two are usable together.
//
// ── What it draws ─────────────────────────────────────────────────────
//
// One node per step, in the parent layer's `children` order, joined by
// connectors. Each node carries its position, its tile name, its kind, and
// what it will actually do. A step with children of its own is a
// SUB-WORKFLOW and says so. While a run is going the nodes take its
// colours live, so you watch the run walk the flow.
//
// Every node carries `data-workflow-step="<cell>"`, which is what lets the
// designer's palette drag land on a node here the same way it lands on a
// hexagon: the panel reads the element under the release point.

import { Drone, EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
// The designer rides the drone that owns 'workflow:view-open' and the run
// state it draws. ONE importer: dup-inlining rule.
import './workflow-designer.view.js'
import type { WorkflowState, WorkflowStateStep } from './workflow-author.drone.js'
import type { WorkflowRunState } from './workflow-runner.drone.js'

export const WORKFLOW_VIEW = 'workflow'

/** House palette — the same ink-and-steel the other full-viewport views use. */
const INK = '#0b0f14'
const PANEL = 'rgba(126,182,214,0.06)'
const BORDER = 'rgba(126,182,214,0.20)'
const TEXT = '#d8e6ee'
const DIM = 'rgba(216,230,238,0.55)'
const STEEL = 'rgb(126,182,214)'

/** Run-status hues — the only colour on the canvas, so the run reads at a
 *  glance while it walks. Matches the designer panel's dots exactly. */
const STATUS: Record<string, string> = {
  done: '#6fbf94',
  asked: '#d99a4e',
  failed: '#cf6f5e',
  skipped: 'rgba(216,230,238,0.35)',
}

const NODE_W = 220
const NODE_H = 96
const GAP_X = 72
const PAD = 64
const TOOLBAR_H = 52
const Z_BASE = 59986   // below the tree view, above the pixi layer

type ViewModeShape = EventTarget & { mode: string; setMode(next: string): void }
type ModeRegistryShape = { enter(m: string, owner: string): void; exit(m: string, owner: string): void }

const ioc = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: <U>(k: string) => U | undefined } }).ioc?.get?.<T>(key)

const div = (css: string, text?: string): HTMLDivElement => {
  const el = document.createElement('div')
  el.style.cssText = css
  if (text !== undefined) el.textContent = text
  return el
}

const svgEl = <K extends keyof SVGElementTagNameMap>(
  tag: K, attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
  return el
}

type Mount = {
  host: HTMLDivElement
  stage: HTMLDivElement
  svg: SVGSVGElement
  toolbar: HTMLDivElement
  title: HTMLDivElement
  count: HTMLSpanElement
  zoomLabel: HTMLSpanElement
  empty: HTMLDivElement
}

export class WorkflowViewDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'workflow'

  public override description =
    'Full-width workflow surface: draws a workflow\'s step tiles as a left-to-right flow with connectors, live run status, and drag-drop targets — instead of the hexagon grid.'

  protected override listens = [
    'workflow:state', 'workflow:run-state', 'viewport:inset', 'workflow:view-state',
  ]
  protected override emits = ['workflow:step-focus', 'workflow:view-open']

  #wired = false
  #mount: Mount | null = null
  #state: WorkflowState | null = null
  #run: WorkflowRunState | null = null
  #zoom = 1
  /** Left edge reserved by docked panels, from `viewport:inset`. The canvas
   *  starts where the designer's palette ends. */
  #leftInset = 0
  #viewActive = false

  protected override heartbeat = async (): Promise<void> => {
    if (this.#wired) return
    this.#wired = true

    this.onEffect<WorkflowState>('workflow:state', (p) => {
      this.#state = p ?? null
      // Walking off a workflow must not strand you on an empty flow canvas —
      // the surface belongs to the cell, and the cell changed.
      if (this.#active() && p && !p.isWorkflow) { this.#exit(); return }
      this.#render()
    })

    this.onEffect<WorkflowRunState>('workflow:run-state', (p) => {
      this.#run = p ?? null
      this.#render()
    })

    this.onEffect<{ owner?: string; side?: string; size?: number }>('viewport:inset', (p) => {
      if (p?.side !== 'left') return
      this.#leftInset = Math.max(0, Number(p.size) || 0)
      this.#applyInset()
    })

    // The designer announces its own open state, and that is the ONE signal
    // that is guaranteed to come after the panel exists. Measuring on mount or
    // on a repaint both lose the race — whichever of the canvas and the panel
    // arrives first was measured against a panel that was not in the DOM yet.
    // A frame later, layout has settled and the rect is real.
    this.onEffect<{ open?: boolean }>('workflow:view-state', () => {
      requestAnimationFrame(() => this.#applyInset())
    })

    const vm = this.#vm()
    vm?.addEventListener('change', () => this.#sync())
    window.addEventListener('keydown', this.#onKey)
    this.#sync()
  }

  #vm(): ViewModeShape | undefined { return ioc<ViewModeShape>('@hypercomb.social/ViewMode') }
  #active(): boolean { return this.#vm()?.mode === WORKFLOW_VIEW }

  #t(key: string, fallback: string): string {
    const i18n = ioc<I18nProvider>(I18N_IOC_KEY)
    const out = i18n?.t(key)
    return !out || out === key ? fallback : out
  }

  /** Mount when the mode turns on, tear down when it turns off. */
  #sync(): void {
    if (this.#active()) {
      if (!this.#mount) this.#mountShell()
      // The panel is how you EDIT what this canvas shows; opening one without
      // the other leaves you looking at a flow you cannot change.
      EffectBus.emit('workflow:view-open', {})
      this.#render()
      return
    }
    this.#unmount()
  }

  #exit(): void {
    this.#vm()?.setMode('hexagons')
  }

  #onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.#active()) return
    // The designer's own Escape ladder runs inside the panel first; this is
    // the surface's rung, and it hands you back the hive.
    if (document.activeElement?.closest?.('hc-workflow-designer')) return
    event.preventDefault()
    this.#exit()
  }

  // ── shell ───────────────────────────────────────────────────────────

  #mountShell(): void {
    const host = div(
      `position:fixed;top:0;right:var(--hc-inset-right,0px);bottom:0;left:${this.#leftInset}px;z-index:${Z_BASE};` +
      `overflow:auto;background:${INK};color:${TEXT};overscroll-behavior:contain;`,
    )
    host.id = 'hc-workflow-view-host'
    // Opt out of the always-on hex wheel-zoom handler so the canvas scrolls.
    host.setAttribute('data-consumes-wheel', '')

    const stage = div(`position:relative;padding-top:${TOOLBAR_H}px;`)
    const svg = svgEl('svg', { xmlns: 'http://www.w3.org/2000/svg' })
    svg.style.cssText = 'display:block;'
    stage.appendChild(svg)
    host.appendChild(stage)

    const toolbar = div(
      `position:fixed;top:0;left:${this.#leftInset}px;right:var(--hc-inset-right,0px);height:${TOOLBAR_H}px;z-index:2;box-sizing:border-box;` +
      `display:flex;align-items:center;gap:14px;padding:0 18px;background:rgba(11,15,20,0.92);` +
      `border-bottom:1px solid ${BORDER};backdrop-filter:blur(8px);`,
    )
    const brand = div(`font-size:13px;font-weight:700;letter-spacing:0.14em;color:${STEEL};flex:none;`, 'WORKFLOW')
    const title = div(`font-size:13px;color:${TEXT};flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`)
    const count = document.createElement('span')
    count.style.cssText = `font-size:12px;color:${DIM};flex:none;`

    const zoomLabel = document.createElement('span')
    zoomLabel.style.cssText = `font-size:12px;color:${DIM};min-width:44px;text-align:center;flex:none;`

    toolbar.append(
      brand, title, count,
      this.#button('−', () => this.#setZoom(this.#zoom - 0.15)),
      zoomLabel,
      this.#button('+', () => this.#setZoom(this.#zoom + 0.15)),
      this.#button(this.#t('workflow.view.fit', 'fit'), () => this.#fit()),
      this.#button(this.#t('workflow.view.exit', 'hexagons'), () => this.#exit()),
    )
    host.appendChild(toolbar)

    const empty = div(
      'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;' +
      `color:${DIM};font-size:14px;line-height:1.7;max-width:420px;padding:24px 28px;` +
      `background:${PANEL};border:1px solid ${BORDER};border-radius:var(--hc-radius-floating, 4px);display:none;`,
    )
    host.appendChild(empty)

    // Right-click anywhere on the canvas leaves, matching every other
    // full-viewport view.
    host.addEventListener('contextmenu', (e) => { e.preventDefault(); this.#exit() })

    document.body.appendChild(host)
    this.#mount = { host, stage, svg, toolbar, title, count, zoomLabel, empty }
    this.#applyInset()
    // …and again once layout has settled, for the case where the designer was
    // already up when this mounted.
    requestAnimationFrame(() => this.#applyInset())
    this.#setViewActive(true)
  }

  /**
   * Start the canvas where the docked designer ends, so the two are usable
   * side by side instead of one covering the other.
   *
   * `viewport:inset` is the shell's contract for this, but EffectBus keeps
   * only the LAST value per event NAME and every docked panel emits on that
   * one name — so a right-docked panel emitting after the designer leaves the
   * replay carrying the wrong side, and a listener that trusts the replay
   * mounts at zero. So the event is taken when it comes AND the panel is
   * measured on mount. The measurement is the floor, never the override: a
   * later real event still wins.
   */
  #applyInset(): void {
    const mount = this.#mount
    if (!mount) return
    const left = Math.max(this.#leftInset, this.#measureDockedLeft())
    mount.host.style.left = `${left}px`
    mount.toolbar.style.left = `${left}px`
  }

  /** Width actually occupied by a left-docked panel right now, or 0. The DOM
   *  is the only synchronous source for this — the inset contract is
   *  broadcast-only, with no getter to ask. */
  #measureDockedLeft(): number {
    try {
      const panel = document.querySelector('hc-workflow-designer .workflow-panel') as HTMLElement | null
      if (!panel) return 0
      const box = panel.getBoundingClientRect()
      // Left-docked means its LEFT edge is over on the left — it starts just
      // inboard of the control bar, not at zero, so this is a side test and
      // not an equality. A right-docked panel reserves nothing here.
      return box.left < window.innerWidth / 3 ? Math.round(box.right) : 0
    } catch { return 0 }
  }

  #button(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = label
    b.style.cssText =
      `all:unset;box-sizing:border-box;flex:none;padding:5px 11px;border-radius:var(--hc-radius-control, 2px);font-size:12px;` +
      `color:${TEXT};background:${PANEL};border:1px solid ${BORDER};cursor:pointer;`
    b.addEventListener('click', onClick)
    return b
  }

  #unmount(): void {
    this.#mount?.host.remove()
    this.#mount = null
    this.#setViewActive(false)
  }

  /** Claim / release the takeover through the OWNER-COUNTED registry, and
   *  only through it. `view:active` is the registry's to broadcast — a drone
   *  that also emits it raw overwrites the count with its own opinion, which
   *  is how two views fighting over one flag ends with neither released. A
   *  doctrine ratchet enforces this. */
  #setViewActive(active: boolean): void {
    if (active === this.#viewActive) return
    this.#viewActive = active
    const modes = ioc<ModeRegistryShape>('@diamondcoreprocessor.com/ModeRegistry')
    if (active) modes?.enter('view:active', 'workflow-view')
    else modes?.exit('view:active', 'workflow-view')
  }

  // ── zoom ────────────────────────────────────────────────────────────

  #setZoom(next: number): void {
    this.#zoom = Math.min(2, Math.max(0.4, Math.round(next * 100) / 100))
    this.#render()
  }

  /** Fit the whole flow across the canvas — a deliberate act, never the
   *  default: auto-fitting a long workflow shrinks it to an unreadable
   *  ribbon, which is the failure the wide canvas exists to avoid. */
  #fit(): void {
    const mount = this.#mount
    const steps = this.#state?.steps ?? []
    if (!mount || !steps.length) return
    const width = PAD * 2 + steps.length * NODE_W + (steps.length - 1) * GAP_X
    this.#setZoom(Math.min(1, (mount.host.clientWidth - 24) / width))
    mount.host.scrollLeft = 0
  }

  // ── render ──────────────────────────────────────────────────────────

  #render(): void {
    const mount = this.#mount
    if (!mount || !this.#active()) return

    // Re-measure every paint. The canvas and the designer open together, and
    // whichever wins the race, the loser was measured against a panel that
    // was not in the DOM yet — mounting once and trusting it left the flow
    // sitting underneath the palette. Re-applying here is self-correcting and
    // costs one rect read on a repaint that was already happening.
    this.#applyInset()

    const state = this.#state
    const steps = state?.steps ?? []

    mount.title.textContent = state?.name || state?.cell || ''
    mount.count.textContent = steps.length
      ? this.#t('workflow.view.steps', `${steps.length} steps`).replace('{count}', String(steps.length))
      : ''
    mount.zoomLabel.textContent = `${Math.round(this.#zoom * 100)}%`

    mount.empty.style.display = steps.length ? 'none' : 'block'
    if (!steps.length) {
      mount.empty.textContent = this.#t(
        'workflow.view.empty',
        'No steps yet. Drag a kind from the palette onto this canvas.',
      )
    }

    const statusByCell = new Map<string, string>()
    for (const r of this.#run?.results ?? []) statusByCell.set(r.cell, r.status)
    const runningCell = this.#run?.running
      ? this.#run.activeCell ?? steps[this.#run.at ?? 0]?.cell
      : undefined

    const width = PAD * 2 + Math.max(NODE_W, steps.length * NODE_W + Math.max(0, steps.length - 1) * GAP_X)
    const height = PAD * 2 + NODE_H + 120

    const svg = mount.svg
    svg.replaceChildren()
    svg.setAttribute('width', String(Math.round(width * this.#zoom)))
    svg.setAttribute('height', String(Math.round(height * this.#zoom)))
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`)

    const y = PAD
    steps.forEach((step, i) => {
      const x = PAD + i * (NODE_W + GAP_X)
      if (i > 0) svg.appendChild(this.#connector(x - GAP_X, x, y + NODE_H / 2))
      svg.appendChild(this.#node(step, x, y, statusByCell.get(step.cell), step.cell === runningCell))
    })
  }

  /** A connector: a straight run with an arrow head. Flow reads left to
   *  right, so the line IS the order — the thing a honeycomb cannot say. */
  #connector(fromX: number, toX: number, y: number): SVGGElement {
    const g = svgEl('g')
    g.appendChild(svgEl('line', {
      x1: fromX, y1: y, x2: toX - 10, y2: y,
      stroke: BORDER, 'stroke-width': 2,
    }))
    g.appendChild(svgEl('path', {
      d: `M${toX - 10} ${y - 5} L${toX} ${y} L${toX - 10} ${y + 5} Z`,
      fill: BORDER,
    }))
    return g
  }

  #node(
    step: WorkflowStateStep, x: number, y: number,
    status: string | undefined, running: boolean,
  ): SVGGElement {
    const g = svgEl('g')
    g.setAttribute('transform', `translate(${x} ${y})`)
    g.style.cursor = 'pointer'
    // The drop target contract: the designer's palette drag reads this
    // attribute off the element under the release point, so dragging a kind
    // onto a node here works exactly as it does onto a hexagon.
    g.setAttribute('data-workflow-step', step.cell)

    const accent = status ? STATUS[status] ?? DIM : (step.kind ? STEEL : 'rgba(217,154,78,0.85)')

    // A sub-workflow gets a stacked shadow — its children are steps too, and
    // the stack is the cheapest honest way to say "there is more inside".
    if (step.hasChildren) {
      g.appendChild(svgEl('rect', {
        x: 6, y: 8, width: NODE_W, height: NODE_H, rx: 10,
        fill: 'rgba(126,182,214,0.05)', stroke: BORDER, 'stroke-width': 1,
      }))
    }

    g.appendChild(svgEl('rect', {
      x: 0, y: 0, width: NODE_W, height: NODE_H, rx: 10,
      fill: running ? 'rgba(126,182,214,0.14)' : PANEL,
      stroke: accent,
      'stroke-width': running ? 2.5 : 1.5,
    }))

    // index
    const idx = svgEl('text', {
      x: 14, y: 26, fill: DIM, 'font-size': 12, 'font-family': 'inherit',
    })
    idx.textContent = String(step.index + 1)
    g.appendChild(idx)

    // tile name
    const name = svgEl('text', {
      x: 34, y: 26, fill: TEXT, 'font-size': 14, 'font-family': 'inherit',
    })
    name.textContent = clip(step.cell, 22)
    g.appendChild(name)

    // kind
    const kind = svgEl('text', {
      x: 14, y: 48, fill: accent, 'font-size': 11, 'font-family': 'inherit',
    })
    kind.textContent = step.kind || this.#t('workflow.step.unset', 'needs a kind')
    g.appendChild(kind)

    // what it will actually do
    const summary = svgEl('text', {
      x: 14, y: 70, fill: DIM, 'font-size': 11, 'font-family': 'inherit',
    })
    summary.textContent = clip(summaryOf(step), 30)
    g.appendChild(summary)

    if (step.hasChildren) {
      const nested = svgEl('text', {
        x: 14, y: 86, fill: DIM, 'font-size': 10, 'font-family': 'inherit',
      })
      nested.textContent = this.#t('workflow.step.nested', 'has its own steps')
      g.appendChild(nested)
    }

    g.addEventListener('click', () => {
      this.emitEffect('workflow:step-focus', { cell: step.cell, segments: step.segments })
    })

    return g
  }
}

// ── helpers ───────────────────────────────────────────────────────────

const clip = (text: string, max: number): string =>
  text.length <= max ? text : text.slice(0, max - 1) + '…'

/** The one line a node shows about what the step does. Mirrors the panel's
 *  own summary so the two surfaces never describe a step differently. */
function summaryOf(step: WorkflowStateStep): string {
  if (!step.kind) return ''
  if (step.kind === 'command') return `/${step.command ?? '?'} ${step.args ?? ''}`.trim()
  return step.text ?? ''
}

const _workflowView = new WorkflowViewDrone()
window.ioc.register('@diamondcoreprocessor.com/WorkflowViewDrone', _workflowView)
