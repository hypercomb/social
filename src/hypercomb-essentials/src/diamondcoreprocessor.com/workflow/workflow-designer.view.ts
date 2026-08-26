// workflow-designer.view.ts — THE WORKFLOW DESIGNER, as a framework-free
// custom element (everything-is-a-beehavior Phase 2: Angular panels leave the
// shell and ship as signed modules).
//
// A straight port of shared/ui/workflow-designer: same surface name
// (hc-workflow-designer), same order band (135), same panel id
// ('workflow-designer' — so the participant's saved width, text size, code
// font and group membership come across), the original's seven
// effects in — plus `locale:changed`, which every converted panel owes — and
// its eleven out.
// It lands beside `workflow.queen.ts` (the `/workflow` door), the author drone
// that answers every write, and `workflow-view.drone.ts` (the flow canvas this
// panel is the editor for).
//
// ── What this window is, and what the canvas is ────────────────────────────
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
// ── The drag ──────────────────────────────────────────────────────────────
//
// Pointer events, not HTML5 drag-and-drop: the drop target is a WebGL canvas
// with no DOM nodes to land on. The tile under the release is resolved from
// RELEASE COORDINATES by the author drone (TileOverlayDrone.labelAtClient) —
// never a remembered `tile:hover`, which nulls the moment the pointer crosses
// chrome, and every drag out of a docked panel does exactly that. Same rule
// the pheromone drag follows, for the same reason.
//
// ── It reads nothing itself ───────────────────────────────────────────────
//
// A second reader of the workflow would drift from the runner's, so
// WorkflowAuthorDrone stays the ONE reader; this window renders
// `workflow:state` / `workflow:palette` / `workflow:run-state` (all sticky, so
// opening mid-run hydrates correctly) and emits intents back. Every write is
// an effect, never a layer touch from here. That was a shell/essentials
// boundary rule in the Angular original and it survives the move: the panel
// is a pure view over broadcasts, which is what lets it be rebuilt from
// fields at any moment.
//
// ── LIFECYCLE NOTE ────────────────────────────────────────────────────────
//
// The Angular version wrapped its whole `<aside>` in `@if (visible())`, so the
// panel's DOM existed only while it was open. A registry-fed element is
// mounted ONCE at boot and stays, so DOM presence and ENGAGEMENT are split the
// way DockedPanelElement splits them: `activate()` builds + claims the lane +
// joins the session, `deactivate()` tears all of that down and clears the
// children. `#show()`/`#hide()` are those two calls plus the `.open` class,
// and the host starts hidden — a panel that flashed on boot would be claiming
// an edge lane nobody asked for.
//
// Because the host IS the panel (DockedPanelElement sizes, positions, grips
// and measures `this`), the Angular `:host { inset: 0; pointer-events: none }`
// full-bleed wrapper is gone and the panel material lands on the tag — the
// sequence-viewer / context-window / files-viewer precedent. The inset
// reporting the old `hcDockInset` directive did is folded into the same base.
//
// TWO THINGS THE FULL-BLEED WRAPPER USED TO CARRY, and where they went:
//
//  • `.workflow-panel` survives as the body wrapper, and NOT as decoration.
//    `workflow-view.drone.ts` measures `hc-workflow-designer .workflow-panel`
//    to find where its canvas may start — the DOM is the only synchronous
//    source for the inset, and that measurement is the FLOOR that covers the
//    race where `viewport:inset`'s last replayed value belongs to some
//    right-docked panel. Folding the class onto the tag would have made that
//    descendant selector match nothing and silently slid the flow canvas back
//    under the palette. The wrapper stretches the panel's full width, so its
//    left/right — the only two numbers that measurement reads — are the
//    panel's. The HEADER stays a direct child of the tag, because
//    DockedPanelElement plants the settings gear in `:scope > header`.
//
//  • the DRAG GHOST moves to `document.body`. It is `position: fixed`, and the
//    panel's own `backdrop-filter` makes the panel a fixed CONTAINING BLOCK —
//    a ghost left inside would be positioned against the panel and clipped by
//    its `overflow-y: auto`, i.e. it would never leave the palette. Body it is.
//
// Its strings ship WITH it (workflow-designer.i18n.ts, extracted from all 14
// shell catalogs) and register under the 'app' namespace, so every key
// resolves exactly as before — the Phase 2 catalog split, another slice.

import {
  EffectBus, I18N_IOC_KEY, type I18nProvider,
  focusSnapshot, restoreFocus,
} from '@hypercomb/core'
import { DockedPanelElement } from '../panels/docked-panel.element.js'
import { WORKFLOW_DESIGNER_TRANSLATIONS } from './workflow-designer.i18n.js'

const SURFACE_NAME = 'hc-workflow-designer'

/** A step as the author drone reports it (`workflow:state`). */
interface StateStep {
  cell: string
  index: number
  segments: readonly string[]
  kind: string
  command?: string
  args?: string
  text?: string
  model?: string
  hasChildren: boolean
}

interface WorkflowStateMsg {
  segments?: readonly string[]
  cell?: string
  isWorkflow?: boolean
  name?: string
  description?: string
  steps?: readonly StateStep[]
  skills?: readonly { name: string; segments: readonly string[] }[]
}

interface PaletteEntry {
  kind: string
  icon: string
  label: string
  description: string
  group: 'control' | 'behaviour' | 'command'
  command?: string
  fields: readonly ('command' | 'args' | 'text' | 'model')[]
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
  results?: readonly RunResult[]
  finished?: 'done' | 'stopped' | 'failed' | 'asked'
}

/** How many palette rows are drawn before the list asks you to narrow it.
 *  The hive answers to a lot of commands; an unbounded list is a wall. */
const PALETTE_LIMIT = 40

/** Movement before a press on a palette row counts as a drag rather than a
 *  click — small enough to feel immediate, large enough that a click that
 *  jitters still picks. Matches the pheromone list's threshold. */
const DRAG_THRESHOLD = 5

const get = <T,>(key: string): T | undefined => window.ioc?.get?.<T>(key)

// Same contract as the shell pipe: params drive both pluralization
// (`key.one` / `key.other`, chosen on params.count by the i18n service) and
// `{token}` interpolation. The fallback is the English catalog text, and it
// interpolates the same tokens so a bare host with no i18n reads identically.
// (No `workflow.*` key is inflected — none has a `.one` / `.other` pair — so
// there is no `tCount` sibling here.)
const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  const i18n = get<I18nProvider>(I18N_IOC_KEY)
  const value = i18n?.t(key, params)
  if (value && value !== key) return value
  if (!params) return fallback
  return fallback.replace(/\{(\w+)\}/g, (whole, token: string) =>
    token in params ? String(params[token]) : whole)
}

// The panel's strings travel with it — registered as soon as the i18n
// service is up, under 'app' so the keys resolve exactly as they always did.
window.ioc?.whenReady?.(I18N_IOC_KEY, (i18n) => {
  const provider = i18n as I18nProvider
  for (const [locale, catalog] of Object.entries(WORKFLOW_DESIGNER_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

// ── the styles the Angular SCSS carried, expanded to plain CSS ────────────
//
// No shadow DOM (the tutorial-overlay + sequence-viewer precedent), so
// Angular's `:host` becomes the tag name and every other selector is prefixed
// with it. The SCSS colour variables are inlined at every call site:
//   $steel #7eb6d6 = rgb(126,182,214)   $dim  #7f95a3 = rgb(127,149,163)
//   $mint  #6fbf94 (done)   $amber #d99a4e (asked)   $rust #cf6f5e (failed)
// The shape ladder stays on the `:root` custom properties (_shape.scss
// publishes them app-wide) and the `var(--hc-*)` tokens are left alone.
//
// FOUR EXPANSIONS WORTH NAMING:
//
//  • `@include tw.panel($steel, left)` was the LAST line of `.workflow-panel`,
//    so its declarations won the cascade over the ones written above it. The
//    effective values are written here once — background rgba(13,15,21,.975)
//    (not rgba(14,14,22,.96)), border-RIGHT alpha .38 (not .5), the 14px/44px
//    shadow with an inset LEFT hairline (not 10px/40px with an inset ring),
//    and colour #eef2f5 (not #c8d6de) — rather than emitting both and leaving
//    five dead declarations in a document-level sheet.
//
//  • `@include tw.header` was the FIRST line of `.workflow-header`, so the
//    rule's own `background: rgba(14,14,22,.98)` beat the mixin's gradient.
//    The gradient is dead and is not emitted; the header BAND geometry (the
//    2.875rem height every tool window shares) and the header's button rules
//    are emitted in full, because nothing overrides those.
//
//  • `.workflow-close`'s own rules sit LATER in the sheet than the `tw.header`
//    close-button rules, but `…workflow-header>button[class*='close']`
//    outranks `…workflow-close` on specificity, so width / height / padding /
//    font-size / colour come from the header band and only flex / background /
//    border / cursor come from `.workflow-close`. That ordering is reproduced
//    verbatim below so the close button lands where it always did.
//
//  • the drag ghost is a GLOBAL rule, not a prefixed one: the node lives on
//    `document.body` (see the header note), so it can carry no ancestor. Its
//    class is renamed `hc-workflow-drag-ghost` to say so and to keep it clear
//    of the Angular original's own `.workflow-drag-ghost`.
//
// Angular's build autoprefixed; `-webkit-backdrop-filter` is written by hand.
const CSS = `
${SURFACE_NAME}{position:fixed;top:max(calc(2.3rem * var(--hc-header-zoom,1)),var(--hc-header-anchor));left:var(--hc-controls-left,0);bottom:0;z-index:100002;display:none;flex-direction:column;width:380px;min-width:300px;max-width:calc(100vw - 1.5rem);overflow-y:auto;overflow-x:hidden;
  --hc-window-accent:#7eb6d6;--hc-window-radius-control:var(--hc-radius-control);--hc-window-radius-card:var(--hc-radius-card);--hc-window-radius-floating:var(--hc-radius-floating);
  background:rgba(13,15,21,.975);backdrop-filter:blur(14px) saturate(1.04);-webkit-backdrop-filter:blur(14px) saturate(1.04);border-radius:0;
  border-left:0;border-right:1px solid rgba(126,182,214,.38);box-shadow:14px 0 44px rgba(0,0,0,.46),inset -1px 0 rgba(255,255,255,.025);
  font-family:var(--hc-mono,system-ui);font-size:calc(.78rem * var(--hc-panel-scale,1));color:#eef2f5;outline:none}
${SURFACE_NAME}.open{display:flex}
${SURFACE_NAME} .workflow-panel{flex:0 0 auto;display:block;min-width:0}

.hc-workflow-drag-ghost{position:fixed;z-index:100003;transform:translate(12px,12px);pointer-events:none;display:inline-flex;align-items:center;gap:.3rem;padding:.2rem .5rem;font-family:var(--hc-mono,system-ui);font-size:.78rem;color:#0d1218;background:rgba(126,182,214,.92);border-radius:3px;box-shadow:0 4px 14px rgba(0,0,0,.45)}
.hc-workflow-drag-ghost .mat-sym{font-size:1.05em}

${SURFACE_NAME} .workflow-header{flex:0 0 auto;box-sizing:border-box;display:flex;align-items:center;gap:.5rem;height:2.875rem;min-height:2.875rem;padding:0 .75rem;line-height:1;position:sticky;top:0;z-index:2;background:rgba(14,14,22,.98);border-bottom:1px solid rgba(126,182,214,.35)}
${SURFACE_NAME} .workflow-header>button,${SURFACE_NAME} .workflow-header>[class*='actions']>button{box-sizing:border-box;display:inline-grid;place-items:center;min-width:1.75rem;height:1.75rem;padding:0 .25rem;border-radius:var(--hc-radius-control);line-height:1;transition:color 120ms ease,background-color 120ms ease,border-color 120ms ease}
${SURFACE_NAME} .workflow-header>button:hover,${SURFACE_NAME} .workflow-header>[class*='actions']>button:hover{background-color:rgba(255,255,255,.055)}
${SURFACE_NAME} .workflow-header>button:focus-visible,${SURFACE_NAME} .workflow-header>[class*='actions']>button:focus-visible{outline:1px solid color-mix(in srgb,var(--hc-window-accent) 72%,white);outline-offset:1px}
${SURFACE_NAME} .workflow-header>button[class*='close'],${SURFACE_NAME} .workflow-header>button.close,${SURFACE_NAME} .workflow-header>[class*='actions']>button[class*='close']{width:1.75rem;min-width:1.75rem;padding:0;font-size:1.125rem;color:rgba(238,244,248,.62)}
${SURFACE_NAME} .workflow-header>button[class*='close']:hover,${SURFACE_NAME} .workflow-header>button.close:hover,${SURFACE_NAME} .workflow-header>[class*='actions']>button[class*='close']:hover{color:#fff;background-color:rgba(255,255,255,.075)}
${SURFACE_NAME} .workflow-heading{flex:1;display:flex;align-items:baseline;gap:.45rem;min-width:0}
${SURFACE_NAME} .workflow-title{color:#7eb6d6;letter-spacing:.06em;text-transform:uppercase;font-size:.82em}
${SURFACE_NAME} .workflow-count{color:#7f95a3;font-size:.78em}
${SURFACE_NAME} .workflow-close{flex:0 0 auto;width:22px;height:22px;padding:0;background:transparent;border:none;color:#7f95a3;font-size:1.15em;line-height:1;cursor:pointer}
${SURFACE_NAME} .workflow-close:hover{color:#cfe3ef}

${SURFACE_NAME} .workflow-section-title{margin:.9rem .9rem .4rem;font-size:.72em;font-weight:400;letter-spacing:.09em;text-transform:uppercase;color:#7f95a3}
${SURFACE_NAME} .workflow-intro,${SURFACE_NAME} .workflow-hint{margin:.4rem .9rem .6rem;font-size:.92em;line-height:1.5;color:#7f95a3}
${SURFACE_NAME} .workflow-field{display:block;margin:.5rem .9rem}
${SURFACE_NAME} .workflow-label{display:block;margin-bottom:.3rem;font-size:.76em;letter-spacing:.07em;text-transform:uppercase;color:#7f95a3}
${SURFACE_NAME} .workflow-input{width:100%;box-sizing:border-box;padding:.32rem .45rem;font:inherit;color:#c8d6de;background:rgba(255,255,255,.04);border:1px solid rgba(126,182,214,.25);border-radius:3px}
${SURFACE_NAME} .workflow-input:focus{outline:none;border-color:rgba(126,182,214,.6)}
${SURFACE_NAME} .workflow-textarea{resize:vertical;line-height:1.45}
${SURFACE_NAME} .workflow-primary{display:block;margin:.5rem .9rem .9rem;padding:.35rem .8rem;font:inherit;color:#0d1218;background:rgba(126,182,214,.85);border:none;border-radius:3px;cursor:pointer}
${SURFACE_NAME} .workflow-primary:hover:not(:disabled){background:#7eb6d6}
${SURFACE_NAME} .workflow-primary:disabled{opacity:.4;cursor:default}

${SURFACE_NAME} .workflow-identity{display:flex;flex-direction:column;gap:.15rem;padding:.7rem .9rem .2rem}
${SURFACE_NAME} .workflow-name{color:#cfe3ef;font-size:1.02em}
${SURFACE_NAME} .workflow-description{color:#7f95a3;line-height:1.45}

${SURFACE_NAME} .workflow-run{display:flex;align-items:center;gap:.4rem;flex-wrap:wrap;padding:.6rem .9rem;border-bottom:1px solid rgba(126,182,214,.15)}
${SURFACE_NAME} .workflow-run-btn{display:inline-flex;align-items:center;gap:.25rem;padding:.25rem .6rem;font:inherit;color:#c8d6de;background:transparent;border:1px solid rgba(126,182,214,.3);border-radius:3px;cursor:pointer}
${SURFACE_NAME} .workflow-run-btn .mat-sym{font-size:1.05em}
${SURFACE_NAME} .workflow-run-btn:hover:not(:disabled){border-color:rgba(126,182,214,.7);color:#cfe3ef}
${SURFACE_NAME} .workflow-run-btn:disabled{opacity:.4;cursor:default}
${SURFACE_NAME} .workflow-run-btn.primary{color:#0d1218;background:rgba(126,182,214,.85);border-color:transparent}
${SURFACE_NAME} .workflow-run-btn.primary:hover:not(:disabled){background:#7eb6d6}
${SURFACE_NAME} .workflow-progress{color:#7f95a3;font-size:.88em}

${SURFACE_NAME} .workflow-steps{list-style:none;margin:0;padding:0 .55rem}
${SURFACE_NAME} .workflow-step{margin-bottom:.2rem}
${SURFACE_NAME} .workflow-step-btn{display:flex;align-items:flex-start;gap:.5rem;width:100%;padding:.4rem .35rem;font:inherit;text-align:left;color:inherit;background:transparent;border:1px solid transparent;border-radius:3px;cursor:pointer}
${SURFACE_NAME} .workflow-step-btn:hover{background:rgba(255,255,255,.04)}
${SURFACE_NAME} .workflow-step.selected .workflow-step-btn{border-color:rgba(126,182,214,.55);background:rgba(126,182,214,.09)}
${SURFACE_NAME} .workflow-step-index{flex:0 0 1.35em;color:#7f95a3;font-size:.88em;line-height:1.5;text-align:right}
${SURFACE_NAME} .workflow-step-body{flex:1;display:flex;flex-wrap:wrap;align-items:baseline;gap:.35rem;min-width:0}
${SURFACE_NAME} .workflow-step-name{color:#cfe3ef}
${SURFACE_NAME} .workflow-step-kind{padding:0 .3rem;font-size:.76em;color:#7eb6d6;border:1px solid rgba(126,182,214,.3);border-radius:2px}
${SURFACE_NAME} .workflow-step-kind.needs{color:#d99a4e;border-color:rgba(217,154,78,.45)}
${SURFACE_NAME} .workflow-step-summary{flex:1 0 100%;color:#7f95a3;font-size:.88em;overflow-wrap:anywhere}
${SURFACE_NAME} .workflow-step-nested{flex:0 0 auto;color:#7f95a3;font-size:1em}
${SURFACE_NAME} .workflow-step-status,${SURFACE_NAME} .workflow-log-status{flex:0 0 auto;width:7px;height:7px;margin-top:.45em;border-radius:50%;background:#7f95a3}
${SURFACE_NAME} .workflow-step-status[data-status='done'],${SURFACE_NAME} .workflow-log-status[data-status='done']{background:#6fbf94}
${SURFACE_NAME} .workflow-step-status[data-status='asked'],${SURFACE_NAME} .workflow-log-status[data-status='asked']{background:#d99a4e}
${SURFACE_NAME} .workflow-step-status[data-status='failed'],${SURFACE_NAME} .workflow-log-status[data-status='failed']{background:#cf6f5e}
${SURFACE_NAME} .workflow-step-status[data-status='skipped'],${SURFACE_NAME} .workflow-log-status[data-status='skipped']{background:rgba(127,149,163,.5)}

${SURFACE_NAME} .workflow-inspector{border-top:1px solid rgba(126,182,214,.15);margin-top:.6rem}
${SURFACE_NAME} .workflow-kind-line{display:flex;align-items:center;gap:.35rem;margin:0 .9rem .3rem;color:#cfe3ef}
${SURFACE_NAME} .workflow-kind-line .mat-sym{font-size:1.05em;color:#7eb6d6}

${SURFACE_NAME} .workflow-palette{border-top:1px solid rgba(126,182,214,.15);margin-top:.6rem;padding-bottom:.4rem}
${SURFACE_NAME} .workflow-palette-toggle{display:flex;align-items:center;gap:.3rem;width:100%;padding:.55rem .9rem;font:inherit;text-align:left;color:#7eb6d6;background:transparent;border:none;cursor:pointer}
${SURFACE_NAME} .workflow-palette-toggle .mat-sym{font-size:1.05em}
${SURFACE_NAME} .workflow-palette-toggle:hover{color:#cfe3ef}
${SURFACE_NAME} .workflow-palette-search{width:calc(100% - 1.8rem);margin:0 .9rem .4rem}
${SURFACE_NAME} .workflow-palette-list{list-style:none;margin:0;padding:0 .55rem;max-height:15rem;overflow-y:auto}
${SURFACE_NAME} .workflow-palette-btn{display:flex;align-items:flex-start;gap:.45rem;width:100%;padding:.32rem .35rem;font:inherit;text-align:left;color:inherit;background:transparent;border:none;border-radius:3px;cursor:grab;touch-action:none}
${SURFACE_NAME} .workflow-palette-btn:active{cursor:grabbing}
${SURFACE_NAME} .workflow-palette-btn:hover{background:rgba(255,255,255,.05)}
${SURFACE_NAME} .workflow-palette-icon{flex:0 0 auto;color:#7eb6d6;font-size:1.02em;line-height:1.4}
${SURFACE_NAME} .workflow-palette-row[data-group='command'] .workflow-palette-icon{color:rgba(126,182,214,.55)}
${SURFACE_NAME} .workflow-palette-body{flex:1;display:flex;flex-direction:column;min-width:0}
${SURFACE_NAME} .workflow-palette-label{color:#cfe3ef}
${SURFACE_NAME} .workflow-palette-description{color:#7f95a3;font-size:.86em;line-height:1.35;overflow-wrap:anywhere}

${SURFACE_NAME} .workflow-skills{list-style:none;margin:0;padding:0 .9rem}
${SURFACE_NAME} .workflow-skill{display:flex;align-items:baseline;gap:.4rem;padding:.18rem 0;min-width:0}
${SURFACE_NAME} .workflow-skill-icon{color:#7eb6d6;font-size:.95em}
${SURFACE_NAME} .workflow-skill-name{color:#cfe3ef}
${SURFACE_NAME} .workflow-skill-path{color:#7f95a3;font-size:.86em;overflow-wrap:anywhere}

${SURFACE_NAME} .workflow-log{border-top:1px solid rgba(126,182,214,.15);margin-top:.6rem;padding-bottom:.9rem}
${SURFACE_NAME} .workflow-log-list{list-style:none;margin:0;padding:0 .9rem}
${SURFACE_NAME} .workflow-log-row{display:flex;align-items:flex-start;gap:.4rem;padding:.16rem 0;min-width:0}
${SURFACE_NAME} .workflow-log-cell{color:#cfe3ef}
${SURFACE_NAME} .workflow-log-detail{flex:1;color:#7f95a3;font-size:.88em;overflow-wrap:anywhere}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-workflow-designer', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

// ── small DOM helpers ─────────────────────────────────────────────────────

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** A Material Symbols glyph. The ligature is the text; `aria-hidden` because
 *  every one of them sits beside a label that already says it. */
const sym = (ligature: string, className = 'mat-sym'): HTMLSpanElement => {
  const span = el('span', className, ligature)
  span.setAttribute('aria-hidden', 'true')
  return span
}

/** The step record a palette row stands for. */
const seedOf = (entry: PaletteEntry): { kind: string; command?: string } => ({
  kind: entry.kind,
  ...(entry.command ? { command: entry.command } : {}),
})

const valueOf = (event: Event): string =>
  (event.target as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? ''

export class WorkflowDesignerElement extends DockedPanelElement {

  #offs: Array<() => void> = []

  /** THE visibility flag. `close`, the session's park/unpark and every
   *  `workflow:view-open` read and write THIS field — a second notion of
   *  "open" is how a panel and its control-bar light drift apart. */
  #visible = false

  // ── what the drone tells us ─────────────────────────────────────────
  #segments: readonly string[] = []
  #cell = ''
  #isWorkflow = false
  #name = ''
  #description = ''
  #steps: readonly StateStep[] = []
  #skills: readonly { name: string; segments: readonly string[] }[] = []
  #palette: readonly PaletteEntry[] = []
  #run: RunStateMsg | null = null

  // ── this window's own state ─────────────────────────────────────────
  /** Which step the inspector is editing, by tile name. Follows the canvas
   *  selection (selection is a notification — selection-tool-windows.md) and
   *  can also be set by clicking a row here. */
  #selected: string | null = null
  #paletteQuery = ''
  #paletteOpen = false
  /** The name typed into the empty state, before the workflow exists. */
  #draftName = ''

  // Inspector drafts — edits are staged and committed with Apply, so a
  // half-typed argument is never written to a layer. They live in FIELDS, not
  // in the inputs, which is what lets a rebuild (or a park and unpark) put the
  // half-typed argument back.
  #draftCommand = ''
  #draftArgs = ''
  #draftText = ''
  #draftModel = ''

  /** The participant has taken the palette's state into their own hands —
   *  stop auto-opening it from here on. Per MOUNT, not per open: the Angular
   *  component instance survived its own `@if`, and this element survives its
   *  own activate/deactivate the same way. */
  #paletteTouched = false

  // ── chrome built once per activation ────────────────────────────────
  // The header must survive a body rebuild because DockedPanelElement plants
  // the settings gear inside it (and nudges the close button over to make
  // room) AFTER renderPanel() returns — rebuilding the header would throw the
  // gear away.
  #body: HTMLElement | null = null
  #titleEl: HTMLElement | null = null
  #headingEl: HTMLElement | null = null
  #countEl: HTMLElement | null = null
  #closeEl: HTMLElement | null = null

  // ── live regions, rebuilt or mutated without touching the rest ──────
  #runBar: HTMLElement | null = null
  #inspectorEl: HTMLElement | null = null
  #paletteEl: HTMLElement | null = null
  #paletteLabelEl: HTMLElement | null = null
  #logEl: HTMLElement | null = null
  /** One record per step ROW. The ONLY keyed map in this file, and it exists
   *  for exactly the sanctioned reason: `workflow:run-state` and
   *  `workflow:step-focus` are STREAMS while a run walks, and rebuilding the
   *  list under them would make the selection highlight and the status dots
   *  flicker (and drop focus from the row a keyboard user is on). The rows are
   *  MUTATED in place — no reconcile, no diff; the map is rebuilt wholesale
   *  whenever the step LIST itself is rebuilt. */
  #stepRows = new Map<string, { li: HTMLElement; btn: HTMLElement; dot: HTMLElement | null }>()

  constructor() {
    super()
    // Same panel id the Angular `hcDockedPanel="workflow-designer"` carried,
    // so the saved width (`hc:docked-width:workflow-designer`), text size,
    // code font and group membership all come across with the participant.
    this.panelId = 'workflow-designer'
    this.dockSide = 'left'
    this.minWidth = 300
    this.maxWidth = 620
    this.defaultWidth = 380
    // Registry-fed: mounted once at boot, engaged only when something opens it.
    this.autoActivate = false
    // The Angular original built this with `signalSession(visible, announce,
    // { dismiss, close })`. Reproduced literally: park/unpark flip visibility
    // and announce, WITHOUT the clearing a close does — "put away while the
    // hive is covered; the design on the board, the inspector and any run in
    // flight are all still there on return". Safe only because every one of
    // those lives in a FIELD: deactivate() throws the DOM away and the next
    // activate() rebuilds it from state.
    this.session = {
      park: () => { this.#hide(); EffectBus.emit('workflow:view-state', { open: false }) },
      unpark: () => { this.#show(); EffectBus.emit('workflow:view-state', { open: true }) },
      dismiss: () => this.dismiss(),
      close: () => this.close(),
    }
  }

  // ── derived readings (the Angular computeds, as getters) ────────────

  get #stepCount(): number { return this.#steps.length }

  get #selectedStep(): StateStep | null {
    const want = this.#selected
    if (!want) return null
    return this.#steps.find(s => s.cell === want) ?? null
  }

  /** The palette entry describing the selected step's kind — the inspector
   *  asks it which fields to draw rather than knowing any kind itself. */
  get #selectedKind(): PaletteEntry | null {
    const step = this.#selectedStep
    if (!step) return null
    const rows = this.#palette
    if (step.kind === 'command') {
      return rows.find(r => r.kind === 'command' && r.command === step.command)
        ?? rows.find(r => r.kind === 'command' && !r.command)
        ?? null
    }
    return rows.find(r => r.kind === step.kind) ?? null
  }

  get #paletteRows(): readonly PaletteEntry[] {
    const q = this.#paletteQuery.trim().toLowerCase()
    const rows = this.#palette
    const matched = q
      ? rows.filter(r =>
          r.label.toLowerCase().includes(q) ||
          r.kind.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q))
      : rows
    return matched.slice(0, PALETTE_LIMIT)
  }

  /** Carried EXACTLY as the template's computed wrote it. Re-deriving it
   *  would be the polarity trap: `paletteRows` is already capped at
   *  PALETTE_LIMIT, so the first half can only ever be true when there is no
   *  query — which is precisely the behaviour the original had, and the
   *  "obvious" simplification would change when the hint appears. */
  get #paletteTruncated(): boolean {
    const q = this.#paletteQuery.trim().toLowerCase()
    const total = q ? this.#paletteRows.length : this.#palette.length
    return total > PALETTE_LIMIT || (!q && this.#palette.length > PALETTE_LIMIT)
  }

  get #running(): boolean { return this.#run?.running === true }
  get #paused(): boolean { return this.#run?.paused === true }
  get #runResults(): readonly RunResult[] { return this.#run?.results ?? [] }

  /** Per-step run status, so the step list itself shows the run walking
   *  through it — the same information the log holds, where you are looking. */
  #statusOf(cell: string): string {
    for (const r of this.#runResults) if (r.cell === cell) return r.status
    return ''
  }

  /** The step's one-line summary — what it will actually do.
   *  `'no child tiles yet'` is an untranslated literal in the ORIGINAL and is
   *  carried verbatim: translating it here would be a behaviour change
   *  smuggled in under a port. */
  #summaryOf(step: StateStep): string {
    if (!step.kind) return ''
    if (step.kind === 'command') return `/${step.command ?? '?'} ${step.args ?? ''}`.trim()
    if (step.text) return step.text
    if (step.kind === 'sub') return step.hasChildren ? '' : 'no child tiles yet'
    return ''
  }

  #hasField(field: PaletteEntry['fields'][number]): boolean {
    return this.#selectedKind?.fields?.includes(field) === true
  }

  // ── lifecycle ───────────────────────────────────────────────────────
  override connectedCallback(): void {
    super.connectedCallback()   // autoActivate is false — this engages nothing
    installCss()
    // `<aside>`'s implicit role, kept by hand: an aria-label on a role-less
    // custom element is ignored by most assistive tech, so dropping it would
    // silently un-name the panel the original took care to name.
    this.setAttribute('role', 'complementary')
    this.setAttribute('data-consumes-wheel', '')
    this.tabIndex = -1

    this.#offs.push(
      // `/workflow` and every other door. Emits UNCONDITIONALLY, exactly as
      // the original did — including when the panel is already open, because
      // `workflow:view-state` is what workflow-view.drone re-measures its
      // canvas inset from, and swallowing the repeat would leave the flow
      // sitting under the palette.
      EffectBus.on('workflow:view-open', () => {
        this.#show()
        EffectBus.emit('workflow:refresh', {})
        EffectBus.emit('workflow:view-state', { open: true })
      }),

      EffectBus.on('workflow:view-close', () => this.close()),

      EffectBus.on<WorkflowStateMsg>('workflow:state', (p) => {
        this.#segments = [...(p?.segments ?? [])]
        this.#cell = p?.cell ?? ''
        this.#isWorkflow = p?.isWorkflow === true
        this.#name = p?.name ?? ''
        this.#description = p?.description ?? ''
        this.#steps = [...(p?.steps ?? [])]
        this.#skills = [...(p?.skills ?? [])]
        // A selected step that no longer exists (removed, or you walked to a
        // different workflow) must not linger in the inspector.
        if (this.#selected && !this.#steps.some(s => s.cell === this.#selected)) {
          this.#selected = null
        }
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
        if (!this.#paletteTouched && this.#isWorkflow && this.#steps.length === 0) {
          this.#paletteOpen = true
        }
        this.#render()
      }),

      EffectBus.on<{ entries?: readonly PaletteEntry[] }>('workflow:palette', (p) => {
        this.#palette = [...(p?.entries ?? [])]
        // The palette feeds the palette LIST and the inspector's kind line
        // (icon, label, description, which fields to offer) — and nothing
        // else. Repainting those two leaves the step list, its highlight and
        // any drag in flight alone.
        this.#renderPaletteSection()
        this.#renderInspector()
      }),

      // A STREAM while a run walks. It is answered by MUTATION — the run bar's
      // contents, each row's status dot, the log — never by a rebuild, so the
      // selection highlight cannot jump and the palette cannot scroll back to
      // the top under a run.
      //
      // IDEMPOTENT BY CONSTRUCTION: this panel accumulates NOTHING. `#run` is
      // a whole-state assignment and the log is drawn from `run.results`, so
      // the same payload arriving twice (the runner's own re-broadcast, or the
      // subscribe-time replay) paints exactly the same rows. There is no
      // append anywhere in this file.
      EffectBus.on<RunStateMsg>('workflow:run-state', (p) => {
        this.#run = p ?? null
        this.#applyRunState()
      }),

      // Selection response: the canvas tells us which tile is active, and the
      // inspector follows it. Clicking the step you mean on the hive is the
      // fastest way to edit it, and it costs this window one subscription.
      //
      // Inlined from shared/core/selection-context's `onSelection` — two
      // publishers share `selection:changed` (SelectionService and the pixi
      // TileSelectionDrone, whose payload is a superset), so the payload is
      // normalized down to the one field this window reads.
      EffectBus.on<{ active?: unknown }>('selection:changed', (p) => {
        const active = typeof p?.active === 'string' ? (p.active as string) : null
        if (!active) return
        this.#focus(active)
      }),

      // The workflow SURFACE reports its own clicks: its nodes are SVG, so they
      // never travel through tile selection. Same response either way — the
      // inspector follows whichever surface you clicked on. Also a STREAM, and
      // also answered by mutation: `#focus` moves a CLASS between two rows and
      // repaints the inspector, so a highlight cannot vanish mid-run.
      EffectBus.on<{ cell?: string }>('workflow:step-focus', (p) => {
        if (p?.cell) this.#focus(p.cell)
      }),

      // THE PIPE WAS IMPURE. Angular's `t` pipe is declared `pure: false`, so
      // every change-detection tick re-resolved every string and `/language ja`
      // re-labelled an OPEN panel on the spot. An element renders when it
      // decides to, so the locale switch has to be a reason to render — else an
      // open designer keeps its old-locale title, run bar, field labels,
      // placeholders, palette toggle and hints until it is closed and reopened.
      // Rebuilding is safe: every string it draws comes from a field.
      EffectBus.on('locale:changed', () => {
        if (!this.#visible) return
        this.#relabel()
        this.#render()
      }),
    )
  }

  override disconnectedCallback(): void {
    this.#offs.forEach(off => off())
    this.#offs = []
    this.#detachDrag()
    this.#removeGhost()
    super.disconnectedCallback()   // → deactivate(): lane, session, grip, gear, children
    this.#visible = false
    this.classList.remove('open')
    this.removeAttribute('aria-label')
    this.#forgetChrome()
  }

  // ── the open / close verbs ──────────────────────────────────────────

  /** The participant's close. Announces once, unconditionally — the shape the
   *  original had, and what the control-bar light and the Escape cascade read.
   *  `#hide()` is the idempotent half, so a second call re-announces without
   *  double-deactivating. */
  close(): void {
    this.#hide()
    EffectBus.emit('workflow:view-state', { open: false })
  }

  /** DockedPanelElement's close verb — the × and the lane's eviction fallback
   *  both land here. This panel has a session, so the lane PARKS it instead of
   *  evicting; the route is kept because the base's contract requires it. */
  protected override closePanel(): void { this.close() }

  #show(): void {
    if (this.#visible) return
    this.#visible = true
    this.classList.add('open')
    this.setAttribute('aria-label', t('workflow.title', 'Workflow'))
    this.activate()   // renderPanel + lane + session + grip + gear + inset
  }

  #hide(): void {
    if (!this.#visible) return
    this.#visible = false
    this.classList.remove('open')
    this.removeAttribute('aria-label')
    // The ghost lives on <body>, so nothing else would take it down. Angular's
    // `@if (visible())` wrapped the ghost too: parking mid-drag hid the chip
    // while the drag itself (listeners on `document`) stayed live.
    this.#removeGhost()
    this.deactivate()   // clears the children — rebuild-on-open, like the `@if`
    this.#forgetChrome()
  }

  /** One level back per press: shut the palette, then drop the inspector's
   *  focus. False = nothing of ours was open, and the shell cascade carries on.
   *  Reached from the session; there is no keydown listener here — in EITHER
   *  implementation. (So the `keydown.escape` modifier question does not arise:
   *  the original bound no document key handler at all, and adding one, guarded
   *  or not, would itself be the regression.) */
  dismiss(): boolean {
    if (this.#paletteOpen) { this.#setPaletteOpen(false); return true }
    if (this.#selected) { this.#selected = null; this.#loadDrafts(); this.#applySelection(); return true }
    return false
  }

  #forgetChrome(): void {
    this.#body = null
    this.#titleEl = null
    this.#headingEl = null
    this.#countEl = null
    this.#closeEl = null
    this.#runBar = null
    this.#inspectorEl = null
    this.#paletteEl = null
    this.#paletteLabelEl = null
    this.#logEl = null
    this.#stepRows.clear()
  }

  // ── chrome (built once per activation) ──────────────────────────────
  protected override renderPanel(): void {
    const header = el('header', 'workflow-header')

    const heading = el('div', 'workflow-heading')
    const title = el('span', 'workflow-title', t('workflow.title', 'Workflow'))
    // The count is NOT appended here — `@if (isWorkflow())` guarded it, and
    // `#applyCount()` (called from `#render`, below) is what puts it in and
    // takes it back out.
    const count = el('span', 'workflow-count')
    heading.append(title)

    const close = el('button', 'workflow-close', '×')
    close.type = 'button'
    close.setAttribute('aria-label', t('workflow.close', 'close'))
    close.addEventListener('click', () => this.close())
    header.append(heading, close)

    // The body wrapper. It keeps the class `workflow-panel` because
    // workflow-view.drone.ts measures `hc-workflow-designer .workflow-panel`
    // to place its canvas — see the file header. It carries NONE of the panel
    // material (that is on the tag); it is a plain full-width block, so the
    // left/right the drone reads are the panel's own.
    const body = el('div', 'workflow-panel')

    this.append(header, body)
    this.#titleEl = title
    this.#headingEl = heading
    this.#countEl = count
    this.#closeEl = close
    this.#body = body
    this.#render()
  }

  /** Re-resolve the strings written ONCE per activation — the ones a body
   *  rebuild never touches. The body's own strings come back through
   *  `#renderBody`. */
  #relabel(): void {
    this.setAttribute('aria-label', t('workflow.title', 'Workflow'))
    if (this.#titleEl) this.#titleEl.textContent = t('workflow.title', 'Workflow')
    this.#closeEl?.setAttribute('aria-label', t('workflow.close', 'close'))
  }

  // ── rendering (rebuild on change — the house pattern, no reconciler) ─

  #render(): void {
    if (!this.#body) return
    this.#applyCount()
    this.#renderBody()
  }

  /** `@if (isWorkflow())` MEANT DETACH: an empty `<span class="workflow-count">`
   *  still answers `querySelector`, and acceptance drivers assert on absence.
   *  So the node is held and moved in and out, never blanked. */
  #applyCount(): void {
    const count = this.#countEl
    const heading = this.#headingEl
    if (!count || !heading) return
    if (!this.#isWorkflow) { count.remove(); return }
    count.textContent = String(this.#stepCount)
    if (!count.parentNode) heading.appendChild(count)
  }

  #renderBody(): void {
    const body = this.#body
    if (!body) return

    // WHERE THE PARTICIPANT WAS. Angular kept the input nodes and the two
    // lists alive for the panel's whole life, so a `workflow:state` landing
    // under a scrolled palette (or under the caret, on every commit and every
    // `synchronize`) was invisible. A rebuild mints fresh nodes: the panel
    // would jump to the top mid-read and a keyboard user in the args field
    // would be dropped out to <body>.
    //
    // Rebuild-on-change is still the doctrine; what it owes is to put the
    // participant back. Measured before the teardown, applied after the new
    // nodes are in the document (scrollTop on a detached node does not stick),
    // and focus is restored BY `data-hc-row` key — stable across a re-read,
    // which is why every field carries one.
    const snap = focusSnapshot(body)
    const panelScroll = this.scrollTop
    const paletteScroll = body.querySelector('.workflow-palette-list')?.scrollTop ?? 0

    body.replaceChildren()
    this.#stepRows.clear()
    this.#runBar = null
    this.#inspectorEl = null
    this.#paletteEl = null
    this.#paletteLabelEl = null
    this.#logEl = null

    body.append(...(this.#isWorkflow ? this.#buildWorkflow() : [this.#buildEmptyState()]))

    if (panelScroll > 0) this.scrollTop = panelScroll
    const list = body.querySelector('.workflow-palette-list')
    if (list && paletteScroll > 0) list.scrollTop = paletteScroll
    restoreFocus(body, snap)
  }

  // ── not a workflow yet ──────────────────────────────────────────────
  //
  // The tile you are standing in becomes one by being named — whatever child
  // tiles it already has are its steps.
  #buildEmptyState(): HTMLElement {
    const section = el('section', 'workflow-empty')
    section.appendChild(el('p', 'workflow-intro',
      t('workflow.intro',
        'A workflow is a tile whose child tiles are its steps. Name this tile to make it one.')))

    // The one control the field drives. Built FIRST so the input's handler can
    // reach it: typing only ever changes whether this button is available, and
    // mutating `disabled` beats a rebuild that would take the caret with it.
    const primary = el('button', 'workflow-primary', this.#cell
      ? t('workflow.declare', 'Make this a workflow')
      : t('workflow.create', 'Create the workflow'))
    primary.type = 'button'
    primary.disabled = !this.#draftName.trim()
    primary.dataset['hcRow'] = 'declare'
    primary.addEventListener('click', () => this.#declare())

    // Standing in a tile: name THAT tile. At the hive root there is no tile to
    // name, so the same field makes one and walks into it — never a dead end.
    const label = el('label', 'workflow-field')
    label.appendChild(el('span', 'workflow-label', this.#cell
      ? t('workflow.name.label', 'Name "{cell}" as a workflow', { cell: this.#cell })
      : t('workflow.create.label', 'Name a new workflow tile', { cell: this.#cell })))

    const input = el('input', 'workflow-input')
    input.type = 'text'
    input.value = this.#draftName
    input.placeholder = t('workflow.name.placeholder', 'e.g. onboard a peer')
    input.dataset['hcRow'] = 'draft-name'
    input.addEventListener('input', (event) => {
      this.#draftName = valueOf(event)
      primary.disabled = !this.#draftName.trim()
    })
    input.addEventListener('keydown', (event) => {
      event.stopPropagation()
      if (event.key === 'Enter') { event.preventDefault(); this.#declare() }
    })
    label.appendChild(input)
    section.appendChild(label)
    section.appendChild(primary)

    if (!this.#cell) {
      section.appendChild(el('p', 'workflow-hint', t('workflow.root.hint',
        'You are at the hive root, which has no tile of its own — this makes one and walks you into it.')))
    }

    if (this.#skills.length) {
      section.appendChild(el('h3', 'workflow-section-title', t('workflow.skills.title', 'Skills')))
      const list = el('ul', 'workflow-skills')
      for (const skill of this.#skills) {
        const row = el('li', 'workflow-skill')
        row.append(
          sym('account_tree', 'mat-sym workflow-skill-icon'),
          el('span', 'workflow-skill-name', skill.name),
          el('span', 'workflow-skill-path', `/${skill.segments.join('/')}`),
        )
        list.appendChild(row)
      }
      section.appendChild(list)
      section.appendChild(el('p', 'workflow-hint', t('workflow.skills.hint',
        'A named workflow runs from anywhere with /workflow run <name>.')))
    }
    return section
  }

  // ── the workflow ────────────────────────────────────────────────────
  #buildWorkflow(): HTMLElement[] {
    const parts: HTMLElement[] = []

    const identity = el('section', 'workflow-identity')
    identity.appendChild(el('span', 'workflow-name', this.#name))
    if (this.#description) {
      identity.appendChild(el('span', 'workflow-description', this.#description))
    }
    parts.push(identity)

    const run = el('section', 'workflow-run')
    run.setAttribute('role', 'group')
    run.setAttribute('aria-label', t('workflow.run.title', 'Run'))
    this.#runBar = run
    this.#fillRunBar()
    parts.push(run)

    parts.push(el('h3', 'workflow-section-title', t('workflow.steps.title', 'Steps')))
    parts.push(this.#stepCount ? this.#buildSteps() : el('p', 'workflow-hint',
      t('workflow.steps.empty',
        'No steps yet. Add one below, or make tiles on the hive — every child tile is a step.')))

    const inspector = this.#buildInspector()
    if (inspector) { this.#inspectorEl = inspector; parts.push(inspector) }

    this.#paletteEl = this.#buildPalette()
    parts.push(this.#paletteEl)

    this.#logEl = this.#buildLog()
    if (this.#logEl) parts.push(this.#logEl)

    return parts
  }

  // ── run bar ─────────────────────────────────────────────────────────
  //
  // Filled rather than rebuilt: the SECTION node persists for the panel's
  // whole activation, so `workflow:run-state` swaps only the buttons inside
  // it. That is the same node lifetime Angular's `@if (!running())` gave —
  // the buttons themselves are recreated when the run starts or pauses, in
  // both implementations.
  #fillRunBar(): void {
    const bar = this.#runBar
    if (!bar) return
    bar.replaceChildren()

    if (!this.#running) {
      const start = this.#runButton('play_arrow', t('workflow.run', 'Run'), () => this.#start())
      start.classList.add('primary')
      start.disabled = !this.#stepCount
      start.dataset['hcRow'] = 'run'
      const stepwise = this.#runButton('skip_next', t('workflow.run.stepwise', 'One step'),
        () => this.#startStepwise())
      stepwise.disabled = !this.#stepCount
      stepwise.dataset['hcRow'] = 'run-stepwise'
      bar.append(start, stepwise)
      return
    }

    if (this.#paused) {
      const next = this.#runButton('skip_next', t('workflow.run.next', 'Next step'), () => this.#next())
      next.classList.add('primary')
      next.dataset['hcRow'] = 'run-next'
      bar.appendChild(next)
    }
    const stop = this.#runButton('stop', t('workflow.run.stop', 'Stop'), () => this.#stop())
    stop.dataset['hcRow'] = 'run-stop'
    bar.appendChild(stop)
    bar.appendChild(el('span', 'workflow-progress', t('workflow.run.progress', 'step {at} of {total}', {
      at: (this.#run?.at ?? 0) + 1,
      total: this.#run?.total ?? 0,
    })))
  }

  #runButton(glyph: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = el('button', 'workflow-run-btn')
    button.type = 'button'
    button.append(sym(glyph), document.createTextNode(label))
    button.addEventListener('click', onClick)
    return button
  }

  // ── the steps (the tiles, in canvas order) ──────────────────────────
  #buildSteps(): HTMLElement {
    const list = el('ol', 'workflow-steps')
    for (const step of this.#steps) {
      const status = this.#statusOf(step.cell)

      const li = el('li', 'workflow-step')
      if (this.#selected === step.cell) li.classList.add('selected')
      if (!step.kind) li.classList.add('unset')
      li.setAttribute('data-status', status)

      const btn = el('button', 'workflow-step-btn')
      btn.type = 'button'
      btn.dataset['hcRow'] = `step:${step.cell}`
      btn.addEventListener('click', () => this.#select(step.cell))

      btn.appendChild(el('span', 'workflow-step-index', String(step.index + 1)))

      const bodyEl = el('span', 'workflow-step-body')
      bodyEl.appendChild(el('span', 'workflow-step-name', step.cell))
      bodyEl.appendChild(step.kind
        ? el('span', 'workflow-step-kind', step.kind)
        : el('span', 'workflow-step-kind needs', t('workflow.step.unset', 'needs a kind')))
      const summary = this.#summaryOf(step)
      if (summary) bodyEl.appendChild(el('span', 'workflow-step-summary', summary))
      btn.appendChild(bodyEl)

      if (step.hasChildren) {
        const nested = sym('account_tree', 'mat-sym workflow-step-nested')
        nested.title = t('workflow.step.nested', 'has its own steps')
        btn.appendChild(nested)
      }

      let dot: HTMLElement | null = null
      if (status) {
        dot = el('span', 'workflow-step-status')
        dot.setAttribute('data-status', status)
        btn.appendChild(dot)
      }

      li.appendChild(btn)
      list.appendChild(li)
      this.#stepRows.set(step.cell, { li, btn, dot })
    }
    return list
  }

  // ── inspector ───────────────────────────────────────────────────────
  #buildInspector(): HTMLElement | null {
    const step = this.#selectedStep
    if (!step) return null
    const kind = this.#selectedKind

    const section = el('section', 'workflow-inspector')
    section.appendChild(el('h3', 'workflow-section-title',
      t('workflow.inspector.title', 'Step: {cell}', { cell: step.cell })))

    const kindLine = el('p', 'workflow-kind-line')
    kindLine.append(sym(kind?.icon ?? 'help'), el('span', undefined, kind?.label ?? step.kind))
    section.appendChild(kindLine)

    if (kind?.description) section.appendChild(el('p', 'workflow-hint', kind.description))

    if (this.#hasField('command')) {
      section.appendChild(this.#field(
        'command', t('workflow.field.command', 'Command'),
        t('workflow.field.command.placeholder', 'note, tag, website…'),
        this.#draftCommand, (v) => { this.#draftCommand = v }))
    }
    if (this.#hasField('args')) {
      section.appendChild(this.#field(
        'args', t('workflow.field.args', 'Arguments'),
        t('workflow.field.args.placeholder', 'what to pass the command'),
        this.#draftArgs, (v) => { this.#draftArgs = v }))
    }
    if (this.#hasField('text')) {
      section.appendChild(this.#field(
        'text', t('workflow.field.text', 'Text'),
        t('workflow.field.text.placeholder', 'what this step says'),
        this.#draftText, (v) => { this.#draftText = v }, true))
    }
    if (this.#hasField('model')) {
      section.appendChild(this.#field(
        'model', t('workflow.field.model', 'Model'),
        t('workflow.field.model.placeholder', 'haiku, sonnet, opus'),
        this.#draftModel, (v) => { this.#draftModel = v }))
    }

    section.appendChild(el('p', 'workflow-hint',
      t('workflow.tokens.hint', 'Tokens: {cell}, {workflow}, {scope}, {step}.')))

    const apply = el('button', 'workflow-primary', t('workflow.apply', 'Apply'))
    apply.type = 'button'
    apply.dataset['hcRow'] = 'apply'
    apply.addEventListener('click', () => this.#apply())
    section.appendChild(apply)
    return section
  }

  /** One labelled draft field. `keydown` is SWALLOWED (stopPropagation) on
   *  every key, exactly as the original's `swallow()` did — typing an argument
   *  must never reach the command line's global handlers. */
  #field(
    key: string, label: string, placeholder: string,
    value: string, write: (value: string) => void, multiline = false,
  ): HTMLElement {
    const wrap = el('label', 'workflow-field')
    wrap.appendChild(el('span', 'workflow-label', label))
    const input = multiline
      ? el('textarea', 'workflow-input workflow-textarea')
      : el('input', 'workflow-input')
    if (input instanceof HTMLInputElement) input.type = 'text'
    if (input instanceof HTMLTextAreaElement) input.rows = 3
    input.value = value
    input.placeholder = placeholder
    input.dataset['hcRow'] = key
    input.addEventListener('input', (event) => write(valueOf(event)))
    input.addEventListener('keydown', (event) => event.stopPropagation())
    wrap.appendChild(input)
    return wrap
  }

  /** Repaint the inspector alone. `@if (selectedStep(); as step)` MEANT
   *  DETACH, so this genuinely removes the node when nothing is selected
   *  rather than hiding it — the palette section is the anchor it is inserted
   *  before when it comes back. */
  #renderInspector(): void {
    if (!this.#body || !this.#isWorkflow) return
    // The inspector holds live form controls, so replacing it wholesale throws
    // away whatever the participant was typing in. `#renderBody` guards this;
    // this path did not, and it runs on every `workflow:palette`. Snapshot
    // against the PANEL: the old section is detached by the time restore runs.
    const snap = focusSnapshot(this)
    const next = this.#buildInspector()
    const current = this.#inspectorEl
    if (current && next) current.replaceWith(next)
    else if (current && !next) current.remove()
    // The inspector sits between the steps and the palette; the palette is the
    // anchor, and the log is the fallback anchor so a defensive path can never
    // land it after the log.
    else if (next) this.#body.insertBefore(next, this.#paletteEl ?? this.#logEl)
    this.#inspectorEl = next
    restoreFocus(this, snap)
  }

  // ── palette ─────────────────────────────────────────────────────────
  #buildPalette(): HTMLElement {
    const section = el('section', 'workflow-palette')

    const toggle = el('button', 'workflow-palette-toggle')
    toggle.type = 'button'
    toggle.dataset['hcRow'] = 'palette-toggle'
    toggle.setAttribute('aria-expanded', String(this.#paletteOpen))
    const label = el('span', undefined, this.#selectedStep
      ? t('workflow.palette.retype', 'Change this step to…')
      : t('workflow.palette.add', 'Add a step'))
    toggle.append(sym(this.#paletteOpen ? 'expand_more' : 'chevron_right'), label)
    toggle.addEventListener('click', () => this.#togglePalette())
    this.#paletteLabelEl = label
    section.appendChild(toggle)

    if (!this.#paletteOpen) return section

    const search = el('input', 'workflow-input workflow-palette-search')
    search.type = 'text'
    search.value = this.#paletteQuery
    search.placeholder = t('workflow.palette.search', 'Search steps and commands…')
    search.dataset['hcRow'] = 'palette-search'
    search.addEventListener('input', (event) => {
      this.#paletteQuery = valueOf(event)
      // Only the ROWS change — replacing the whole section would take the
      // search field (and the caret in it) with it.
      this.#replacePaletteRows()
    })
    search.addEventListener('keydown', (event) => event.stopPropagation())
    section.appendChild(search)

    section.appendChild(el('p', 'workflow-hint', t('workflow.palette.drag',
      'Drag a kind onto the hive: drop on empty space to add a step, drop on a step tile to make it that kind.')))
    section.appendChild(this.#buildPaletteRows())
    if (this.#paletteTruncated) {
      section.appendChild(el('p', 'workflow-hint',
        t('workflow.palette.more', 'Narrow the search to see more.')))
    }
    return section
  }

  #buildPaletteRows(): HTMLElement {
    const list = el('ul', 'workflow-palette-list')
    for (const entry of this.#paletteRows) {
      const row = el('li', 'workflow-palette-row')
      row.setAttribute('data-group', entry.group)

      const button = el('button', 'workflow-palette-btn')
      button.type = 'button'
      // THE IDENTITY focusSnapshot NEEDS. It only records a control carrying
      // `data-hc-row`; every other focusable here has one and these did not, so
      // a re-filter dropped keyboard focus out of the list. The key is the same
      // identity the Angular template tracked by, so restore lands on the same
      // row rather than the same position.
      button.dataset['hcRow'] = `palette:${entry.kind}:${entry.command ?? ''}`
      button.addEventListener('pointerdown', (event) => this.#onRowPointerDown(event, entry))
      button.addEventListener('click', () => this.#pick(entry))

      button.appendChild(sym(entry.icon, 'mat-sym workflow-palette-icon'))
      const bodyEl = el('span', 'workflow-palette-body')
      bodyEl.appendChild(el('span', 'workflow-palette-label', entry.label))
      if (entry.description) {
        bodyEl.appendChild(el('span', 'workflow-palette-description', entry.description))
      }
      button.appendChild(bodyEl)

      row.appendChild(button)
      list.appendChild(row)
    }
    return list
  }

  /** Swap the rows under a live search field, keeping the field, its caret,
   *  and the "narrow the search" hint's position. */
  #replacePaletteRows(): void {
    const section = this.#paletteEl
    if (!section) return
    const current = section.querySelector('.workflow-palette-list')
    if (!current) return
    current.replaceWith(this.#buildPaletteRows())
    const hint = section.querySelector('.workflow-palette-list ~ .workflow-hint')
    const wanted = this.#paletteTruncated
    if (wanted && !hint) {
      section.appendChild(el('p', 'workflow-hint',
        t('workflow.palette.more', 'Narrow the search to see more.')))
    } else if (!wanted && hint) {
      hint.remove()
    }
  }

  #renderPaletteSection(): void {
    if (!this.#body || !this.#isWorkflow) return
    // Same guard as `#renderBody`: this replaces the search box and the whole
    // row list, and it runs on every `workflow:palette`. Without the snapshot a
    // participant filtering the palette loses the caret on their own keystroke,
    // and focus falling to <body> also makes `focusedWindow()` null — which
    // quietly hands Escape to the canvas cascade instead of this panel.
    const snap = focusSnapshot(this)
    const listScroll = this.#paletteEl?.querySelector('.workflow-palette-list')?.scrollTop ?? 0
    const current = this.#paletteEl
    const next = this.#buildPalette()
    if (current) current.replaceWith(next)
    else this.#body.insertBefore(next, this.#logEl)
    this.#paletteEl = next
    // scrollTop only sticks once the node is in the document.
    const list = next.querySelector('.workflow-palette-list')
    if (list && listScroll > 0) list.scrollTop = listScroll
    restoreFocus(this, snap)
  }

  #togglePalette(): void {
    // The participant has taken the palette's state into their own hands.
    this.#paletteTouched = true
    this.#setPaletteOpen(!this.#paletteOpen)
  }

  #setPaletteOpen(open: boolean): void {
    this.#paletteOpen = open
    this.#renderPaletteSection()
  }

  // ── run log ─────────────────────────────────────────────────────────
  #buildLog(): HTMLElement | null {
    const results = this.#runResults
    if (!results.length) return null

    const section = el('section', 'workflow-log')
    section.appendChild(el('h3', 'workflow-section-title', t('workflow.log.title', 'Run log')))
    const list = el('ul', 'workflow-log-list')
    for (const result of results) {
      const row = el('li', 'workflow-log-row')
      row.setAttribute('data-status', result.status)
      const dot = el('span', 'workflow-log-status')
      dot.setAttribute('data-status', result.status)
      row.append(dot, el('span', 'workflow-log-cell', result.cell))
      if (result.detail) row.appendChild(el('span', 'workflow-log-detail', result.detail))
      list.appendChild(row)
    }
    section.appendChild(list)
    if (this.#run?.finished === 'asked') {
      section.appendChild(el('p', 'workflow-hint', t('workflow.log.asked',
        'Waiting on your answer — the question is on the dashboard.')))
    }
    return section
  }

  // ── the two stream responses ────────────────────────────────────────

  /** `workflow:run-state`. Mutates three things and rebuilds a fourth in
   *  place; the step LIST, the inspector and the palette are untouched, so a
   *  run walking through a workflow never moves the highlight, never scrolls
   *  the palette back to the top and never takes the caret out of an argument
   *  being typed. */
  #applyRunState(): void {
    if (!this.#body || !this.#isWorkflow) return

    this.#fillRunBar()

    for (const [cell, row] of this.#stepRows) {
      const status = this.#statusOf(cell)
      row.li.setAttribute('data-status', status)
      if (status && !row.dot) {
        // Appended LAST, after the nested-workflow mark — the order the
        // template drew it in.
        const dot = el('span', 'workflow-step-status')
        dot.setAttribute('data-status', status)
        row.btn.appendChild(dot)
        row.dot = dot
      } else if (!status && row.dot) {
        row.dot.remove()
        row.dot = null
      } else if (row.dot) {
        row.dot.setAttribute('data-status', status)
      }
    }

    const next = this.#buildLog()
    const current = this.#logEl
    if (current && next) current.replaceWith(next)
    else if (current && !next) current.remove()
    else if (!current && next) this.#body.appendChild(next)
    this.#logEl = next
  }

  /** The selection moved. A CLASS moves between two rows, the inspector is
   *  repainted, and the palette toggle re-reads its label ("Add a step" vs
   *  "Change this step to…"). Nothing else is touched. */
  #applySelection(): void {
    for (const [cell, row] of this.#stepRows) {
      row.li.classList.toggle('selected', this.#selected === cell)
    }
    this.#renderInspector()
    if (this.#paletteLabelEl) {
      this.#paletteLabelEl.textContent = this.#selectedStep
        ? t('workflow.palette.retype', 'Change this step to…')
        : t('workflow.palette.add', 'Add a step')
    }
  }

  // ── the workflow ────────────────────────────────────────────────────

  /**
   * Turn the cell you are standing in into a workflow. Its child tiles —
   * whatever it already has — become its steps.
   *
   * At the hive root there is no tile to name, so this MINTS one and walks
   * into it instead. Standing at the root and being told you cannot have a
   * workflow was a dead end; the root simply has no tile of its own, which is
   * a reason to make one, not a reason to refuse.
   */
  #declare(): void {
    const name = this.#draftName.trim()
    if (!name) return
    EffectBus.emit(this.#cell ? 'workflow:declare' : 'workflow:create', { name })
    this.#draftName = ''
    this.#render()
  }

  // ── steps ───────────────────────────────────────────────────────────

  #select(cell: string): void {
    this.#selected = this.#selected === cell ? null : cell
    this.#loadDrafts()
    this.#applySelection()
  }

  /** Focus a step because some SURFACE said so (tile selection, or a click on
   *  a node in the workflow view). Unlike `#select` this never toggles off — an
   *  external click means "this one", never "put it away". */
  #focus(cell: string): void {
    if (!this.#steps.some(s => s.cell === cell)) return
    this.#selected = cell
    this.#loadDrafts()
    this.#applySelection()
  }

  // ── the inspector ───────────────────────────────────────────────────

  /** Load the selected step's record into the drafts.
   *
   *  Called from `workflow:state` as well as from a selection change, which
   *  means a commit landing mid-typing DISCARDS what is in the field. That is
   *  the original's behaviour, carried verbatim: the drafts mirror the tile,
   *  and the tile is the truth. (`restoreFocus` still puts the caret back in
   *  the field — into the reloaded value.) */
  #loadDrafts(): void {
    const step = this.#selectedStep
    this.#draftCommand = step?.command ?? ''
    this.#draftArgs = step?.args ?? ''
    this.#draftText = step?.text ?? ''
    this.#draftModel = step?.model ?? ''
  }

  /** Commit the inspector's drafts onto the selected step's tile. */
  #apply(): void {
    const step = this.#selectedStep
    if (!step) return
    EffectBus.emit('workflow:step-set', {
      segments: step.segments,
      step: {
        kind: step.kind,
        // A step dragged in as `/note` already knows its command and offers no
        // field for it; a bare `command` step is named here. Fall back to what
        // the step already holds so the un-offered field is never blanked.
        command: this.#hasField('command') ? this.#draftCommand : step.command,
        args: this.#draftArgs,
        text: this.#draftText,
        model: this.#draftModel,
      },
    })
  }

  /**
   * Picking a palette row ADDS a step — a real child tile, created the same
   * way any tile is created, then given this kind. With a step selected it
   * re-types that step instead, so the palette is both "add" and "change to".
   *
   * This is the keyboard/touch path; DRAGGING the row onto the hive is the
   * gesture, and it can also aim at a particular tile.
   */
  #pick(entry: PaletteEntry): void {
    // The click that ends a drag must not also act on the row.
    if (this.#swallowClick) { this.#swallowClick = false; return }
    const step = this.#selectedStep
    if (step) {
      EffectBus.emit('workflow:step-set', { segments: step.segments, step: seedOf(entry) })
      return
    }
    EffectBus.emit('workflow:step-add', {
      segments: this.#segments,
      step: seedOf(entry),
      name: entry.command || entry.kind,
    })
  }

  // ── drag a step onto the hive ───────────────────────────────────────
  //
  // The direct gesture: pick the kind up out of the palette and drop it where
  // you want the step. Drop on empty hive → a new step tile at the end. Drop
  // ON a step tile → that step becomes this kind.
  //
  // Pointer events, and the drop resolves from RELEASE COORDINATES — see the
  // file header for why a remembered `tile:hover` is wrong here.
  //
  // NONE of the drag lives in the DOM except the ghost: the candidate press,
  // the promoted entry and the cursor position are all fields, and the three
  // listeners are on `document`. So a body rebuild landing mid-drag — a
  // commit, a `synchronize`, a `/language` switch — cannot disturb it, even
  // though the palette row it started from is replaced underneath.

  /** Candidate press, promoted to a real drag once the pointer moves far
   *  enough. */
  #pending: { entry: PaletteEntry; x: number; y: number } | null = null
  /** A drag just ended — swallow the click it would otherwise fire. */
  #swallowClick = false
  /** The entry being dragged, or null. Drives the ghost chip that follows the
   *  cursor: the drag IS the gesture, so it has to be visible the whole way
   *  from the palette to the tile. */
  #dragging: PaletteEntry | null = null
  #ghost: HTMLElement | null = null

  #onRowPointerDown(event: PointerEvent, entry: PaletteEntry): void {
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

  /** Removed with the SAME function references they were added with — the
   *  three arrow properties below, never fresh closures. */
  #detachDrag(): void {
    document.removeEventListener('pointermove', this.#onDragMove)
    document.removeEventListener('pointerup', this.#onDragUp)
    document.removeEventListener('pointercancel', this.#onDragCancel)
  }

  #onDragMove = (event: PointerEvent): void => {
    const p = this.#pending
    if (!p) return
    if (!this.#dragging) {
      if (Math.hypot(event.clientX - p.x, event.clientY - p.y) < DRAG_THRESHOLD) return
      // Promote to a drag. `drop:dragging` puts the tile overlay into its bare
      // drop-target mode (icons hidden) — the same mode file drops use — so the
      // hive reads as a surface to land on rather than a menu.
      this.#dragging = p.entry
      EffectBus.emit('drop:dragging', { active: true })
    }
    this.#moveGhost(event.clientX, event.clientY)
  }

  #onDragCancel = (): void => {
    this.#pending = null
    this.#detachDrag()
    if (this.#dragging) {
      this.#dragging = null
      this.#removeGhost()
      EffectBus.emit('drop:dragging', { active: false })
    }
  }

  #onDragUp = (event: PointerEvent): void => {
    const p = this.#pending
    const wasDragging = this.#dragging !== null
    this.#pending = null
    this.#detachDrag()
    if (!wasDragging || !p) return

    this.#dragging = null
    this.#removeGhost()
    EffectBus.emit('drop:dragging', { active: false })
    this.#swallowClick = true

    // A drop back onto this panel is a cancel, not a step at (x, y) — the hive
    // is the drop surface, and releasing over the palette you dragged from
    // plainly means "never mind". The test is the TAG, which is the whole
    // panel now (header, grip and settings popover included) where the
    // original could only name `.workflow-panel`.
    const over = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null
    if (over?.closest?.(SURFACE_NAME)) return

    // On the WORKFLOW surface the steps are SVG nodes, not hexagons, so there
    // is a real element under the pointer and it names itself. Read it here
    // and hand the drone an explicit label; the hex canvas has no such node,
    // and there the drone resolves the release point through the tile overlay
    // instead. One drag, either surface.
    const node = over?.closest?.('[data-workflow-step]') as HTMLElement | null
    const label = node?.getAttribute('data-workflow-step') ?? undefined

    EffectBus.emit('workflow:step-drop', {
      segments: this.#segments,
      step: seedOf(p.entry),
      name: p.entry.command || p.entry.kind,
      ...(label ? { label } : {}),
      x: event.clientX,
      y: event.clientY,
    })
  }

  // ── the ghost ───────────────────────────────────────────────────────
  //
  // On `document.body`, never inside the panel: the panel's backdrop-filter
  // makes it a containing block for `position: fixed`, so a ghost parented
  // here would be laid out against the panel and clipped by its scroller —
  // it could never reach the tile it is being dragged onto.

  #moveGhost(x: number, y: number): void {
    const entry = this.#dragging
    if (!entry || !this.#visible) return
    let ghost = this.#ghost
    if (!ghost) {
      ghost = el('div', 'hc-workflow-drag-ghost')
      ghost.setAttribute('aria-hidden', 'true')
      ghost.append(sym(entry.icon), el('span', undefined, entry.label))
      document.body.appendChild(ghost)
      this.#ghost = ghost
    }
    ghost.style.left = `${x}px`
    ghost.style.top = `${y}px`
  }

  #removeGhost(): void {
    this.#ghost?.remove()
    this.#ghost = null
  }

  // ── running ─────────────────────────────────────────────────────────

  #start(): void {
    EffectBus.emit('workflow:run', { segments: this.#segments, stepThrough: false })
  }

  #startStepwise(): void {
    EffectBus.emit('workflow:run', { segments: this.#segments, stepThrough: true })
  }

  #next(): void { EffectBus.emit('workflow:run-next', {}) }
  #stop(): void { EffectBus.emit('workflow:run-stop', {}) }
}

// ── shell surface registration — the externalization path ────────────────
// Same name, same order band the Angular component held; the module-side
// `element:` shape (documentation/shell-surfaces.md).
// DEFINED AT MODULE SCOPE, registered when a registry appears. A host with no
// ShellSurfaceRegistry (diamond-core-processor mounts these tags directly in
// its own template) still needs the tag to be a real element rather than an
// inert unknown one — so the define cannot wait on the registry. Only the ADD
// does.
if (!customElements.get(SURFACE_NAME)) {
  customElements.define(SURFACE_NAME, WorkflowDesignerElement)
}

window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/WorkflowDesignerElement',
    element: SURFACE_NAME,
    order: 135,
  })
})
