// atomizer-sidebar.view.ts — the atomizer property sidebar as a
// framework-free custom element (everything-is-a-beehavior Phase 2: Angular
// panels leave the shell and ship as signed modules).
//
// A straight port of shared/ui/atomizer-bar/atomizer-sidebar.component: same
// surface name (hc-atomizer-sidebar), same order band (400), the same single
// effect in (`atomizer:properties`) and the same NO effects out — everything
// this surface does, it does by calling the atomizer directly. The participant
// sees the same right-edge drawer, delivered as a module instead of compiled
// into the shell.
//
// WHAT IT IS FOR. Drag an atomizer from hc-atomizer-bar (order 390) onto a
// matching control; AtomizerDropWorker resolves both sides, calls
// `atomizer.discover(target)` and emits `atomizer:properties` with the
// atomizer, the target and the discovered knobs. This drawer renders those
// knobs grouped by `prop.group`, and EVERY EDIT LANDS IMMEDIATELY:
// `atomizer.apply(target, key, value)` on each `input`/`change`, exactly as
// the component did. There is no preview and no confirm step — the atomizer
// itself owns what a change costs, and `reset` (atomizer.reset + re-discover)
// is the undo the surface offers.
//
// THE TWO SURFACES NEVER TOUCH. The bar and this drawer are mounted
// independently by the shell-surface host and talk only through EffectBus —
// bar → `atomizer:drag-start` → the drop worker → `atomizer:properties` →
// here. Nothing in this file references hc-atomizer-bar; a direct reference
// between two registry-fed elements would couple surfaces the shell is free
// to mount, move and unmount separately.
//
// CLOSING THIS DRAWER ANSWERS NOTHING, AND THAT IS THE ORIGINAL. `close()`
// cleared the four signals and emitted no effect — the bar keeps its `.active`
// ring until the next drop, and no other surface is told. Adding an emit here
// would invent an effect nothing listens for.
//
// Its strings ship WITH it (atomizer-sidebar.i18n.ts, extracted from all 14
// shell catalogs) and register under the 'app' namespace, so every key
// resolves exactly as before — the Phase 2 catalog split, another slice.
// `atomizer.close` is rendered by the BAR too, so it lives in both catalogs:
// a surface must carry everything it renders, or it stops resolving the day
// it is loaded somewhere the other one is not.

import {
  EffectBus, I18N_IOC_KEY, focusSnapshot, restoreFocus,
  type Atomizer, type AtomizableTarget, type AtomizerProperty,
  type I18nProvider,
} from '@hypercomb/core'
import { ATOMIZER_SIDEBAR_TRANSLATIONS } from './atomizer-sidebar.i18n.js'

const SURFACE_NAME = 'hc-atomizer-sidebar'

// Same contract as the shell pipe: the live provider resolves the key, and the
// fallback is the English catalog text so a bare host with no i18n reads
// identically. None of this panel's three keys take params.
const t = (key: string, fallback: string): string => {
  const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
  const value = i18n?.t(key)
  return value && value !== key ? value : fallback
}

// The drawer's strings travel with it — registered as soon as the i18n
// service is up, under 'app' so the keys resolve exactly as they always did.
window.ioc?.whenReady?.(I18N_IOC_KEY, (i18n) => {
  const provider = i18n as I18nProvider
  for (const [locale, catalog] of Object.entries(ATOMIZER_SIDEBAR_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

// ── the styles the Angular SCSS carried, expanded to plain CSS ────────────
// No shadow DOM (the tutorial-overlay + sequence-viewer precedent), so
// Angular's `:host` becomes the tag name and every other selector is prefixed
// with it. `display:contents` is kept verbatim because both shells hide this
// surface BY TAG (`body.hc-view-website hc-atomizer-sidebar{display:none
// !important}` in web/dev styles.scss, and dev's `:host.intro-active` sweep) —
// the tag has to stay the thing those rules can reach.
//
// Two things kept verbatim from the SCSS, with their reasoning:
//   - Z-INDEX 59991: #pixi-host reparents to <body> at 59989 with a
//     pointer-events:auto canvas inside (pixi-host.worker.ts), which was eating
//     every click in the sidebar. Keeps its old position above the
//     format-painter drawer (59990) and below all shell chrome (edit-actions
//     59995, controls/hint bars 59999, header 60000).
//   - The `--s` LADDER, not CSS `zoom`. `zoom` combined with `backdrop-filter`
//     promotes the drawer to a compositing layer that rasterizes at CSS-pixel
//     density, so text goes blurry on high-DPI displays. Every dimension is a
//     `calc(px * var(--s))` instead, and the font-smoothing trio below is the
//     other half of that fix.
//
// Angular's build autoprefixed, so `-webkit-backdrop-filter` is written out
// here by hand. The keyframes are renamed with the surface prefix because
// @keyframes names live in one global namespace once the sheet is in <head>.
const CSS = `
${SURFACE_NAME}{display:contents}
${SURFACE_NAME} .atomizer-sidebar{--hc-sidebar-scale:1;--s:var(--hc-sidebar-scale);position:fixed;right:0;top:0;bottom:0;width:calc(260px * var(--s));z-index:59991;background:rgba(10,10,18,.95);border-left:1px solid rgba(255,255,255,.06);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);display:flex;flex-direction:column;overflow:hidden;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility;animation:hc-atomizer-sidebar-slide-in .25s cubic-bezier(0.22,1,0.36,1)}
@keyframes hc-atomizer-sidebar-slide-in{from{transform:translateX(260px)}to{transform:translateX(0)}}
${SURFACE_NAME} .sidebar-header{display:flex;align-items:center;justify-content:space-between;padding:calc(10px * var(--s)) calc(12px * var(--s));border-bottom:1px solid rgba(255,255,255,.06)}
${SURFACE_NAME} .sidebar-title{font-size:calc(11px * var(--s));font-family:var(--hc-mono);color:rgba(255,255,255,.7);font-weight:600}
${SURFACE_NAME} .sidebar-actions{display:flex;gap:calc(4px * var(--s))}
${SURFACE_NAME} .sidebar-btn{background:none;border:none;color:rgba(255,255,255,.35);cursor:pointer;font-size:calc(13px * var(--s));padding:calc(2px * var(--s)) calc(4px * var(--s));border-radius:3px}
${SURFACE_NAME} .sidebar-btn:hover{color:rgba(255,255,255,.7);background:rgba(255,255,255,.05)}
${SURFACE_NAME} .close-x{display:block;font-size:calc(16px * var(--s));line-height:1}
${SURFACE_NAME} .sidebar-target{display:flex;align-items:center;gap:calc(6px * var(--s));padding:calc(6px * var(--s)) calc(12px * var(--s));border-bottom:1px solid rgba(255,255,255,.04)}
${SURFACE_NAME} .target-label{font-size:calc(10px * var(--s));font-family:var(--hc-mono);color:rgba(0,229,255,.6)}
${SURFACE_NAME} .target-type{font-size:calc(9px * var(--s));font-family:var(--hc-mono);color:rgba(255,255,255,.25);margin-left:auto}
${SURFACE_NAME} .sidebar-properties{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:calc(8px * var(--s)) 0}
${SURFACE_NAME} .property-group{padding:0 calc(12px * var(--s));margin-bottom:calc(12px * var(--s))}
${SURFACE_NAME} .group-label{display:block;font-size:calc(8px * var(--s));font-family:var(--hc-mono);text-transform:uppercase;letter-spacing:.8px;color:rgba(255,255,255,.25);margin-bottom:calc(6px * var(--s));padding-bottom:calc(3px * var(--s));border-bottom:1px solid rgba(255,255,255,.04)}
${SURFACE_NAME} .property-row{display:flex;align-items:center;justify-content:space-between;gap:calc(8px * var(--s));padding:calc(3px * var(--s)) 0;min-height:calc(24px * var(--s))}
${SURFACE_NAME} .property-label{font-size:calc(10px * var(--s));font-family:var(--hc-mono);color:rgba(255,255,255,.5);flex-shrink:0;max-width:calc(100px * var(--s));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${SURFACE_NAME} .property-color{width:calc(28px * var(--s));height:calc(20px * var(--s));border:1px solid rgba(255,255,255,.1);border-radius:3px;background:none;cursor:pointer;padding:0}
${SURFACE_NAME} .property-color::-webkit-color-swatch-wrapper{padding:1px}
${SURFACE_NAME} .property-color::-webkit-color-swatch{border:none;border-radius:2px}
${SURFACE_NAME} .property-number,${SURFACE_NAME} .property-text{width:calc(80px * var(--s));height:calc(22px * var(--s));padding:0 calc(6px * var(--s));font-size:calc(10px * var(--s));font-family:var(--hc-mono);color:rgba(255,255,255,.75);background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:3px;outline:none}
${SURFACE_NAME} .property-number:focus,${SURFACE_NAME} .property-text:focus{border-color:rgba(0,229,255,.3);background:rgba(0,229,255,.04)}
${SURFACE_NAME} .property-number{width:calc(56px * var(--s));text-align:right}
${SURFACE_NAME} .property-range-wrap{display:flex;align-items:center;gap:calc(6px * var(--s))}
${SURFACE_NAME} .property-range{width:calc(70px * var(--s));height:calc(4px * var(--s));accent-color:rgba(0,229,255,.7)}
${SURFACE_NAME} .range-value{font-size:calc(9px * var(--s));font-family:var(--hc-mono);color:rgba(255,255,255,.4);min-width:calc(24px * var(--s));text-align:right}
${SURFACE_NAME} .property-select{width:calc(90px * var(--s));height:calc(22px * var(--s));padding:0 calc(4px * var(--s));font-size:calc(10px * var(--s));font-family:var(--hc-mono);color:rgba(255,255,255,.75);background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:3px;outline:none}
${SURFACE_NAME} .property-select option{background:#0a0a12}
${SURFACE_NAME} .property-toggle{position:relative;display:inline-block;width:calc(28px * var(--s));height:calc(14px * var(--s));cursor:pointer}
${SURFACE_NAME} .property-toggle input{opacity:0;width:0;height:0;position:absolute}
${SURFACE_NAME} .property-toggle .toggle-track{position:absolute;inset:0;border-radius:var(--hc-radius-pill);background:rgba(255,255,255,.1);transition:background .2s ease}
${SURFACE_NAME} .property-toggle .toggle-track::after{content:'';position:absolute;left:2px;top:2px;width:10px;height:10px;border-radius:50%;background:rgba(255,255,255,.5);transition:transform .2s ease}
${SURFACE_NAME} .property-toggle input:checked + .toggle-track{background:rgba(0,229,255,.3)}
${SURFACE_NAME} .property-toggle input:checked + .toggle-track::after{transform:translateX(14px);background:rgba(0,229,255,.9)}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-atomizer-sidebar', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

/** Angular interpolation stringifies null/undefined to the empty string and
 *  everything else through String() — `{{ target()?.targetId }}` printed
 *  nothing, never "undefined". */
const interpolate = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value)

export class AtomizerSidebarElement extends HTMLElement {

  #offs: Array<() => void> = []

  // ── state (the component's four signals) ───────────────────────────────
  #visible = false
  #atomizer: Atomizer | null = null
  #target: AtomizableTarget | null = null
  #properties: AtomizerProperty[] = []

  // ── chrome, built once ─────────────────────────────────────────────────
  // The drawer, its header, its two buttons and the target line survive every
  // re-render; only the PROPERTY BODY rebuilds.
  #sidebar: HTMLDivElement | null = null
  #title: HTMLSpanElement | null = null
  #reset: HTMLButtonElement | null = null
  #close: HTMLButtonElement | null = null
  #targetLabel: HTMLSpanElement | null = null
  #targetType: HTMLSpanElement | null = null
  #props: HTMLDivElement | null = null

  /** Baseline 1.0 at 1920px wide; scales up linearly on larger monitors,
   *  clamped at 1.2. Applied as the `--hc-sidebar-scale` multiplier the CSS
   *  ladder reads, exactly as `[style.--hc-sidebar-scale]` did — NOT as CSS
   *  `zoom`, which would rasterize the backdrop-filtered layer at CSS-pixel
   *  density and blur every glyph. */
  #scale = 1

  #computeScale(): number {
    const ratio = window.innerWidth / 1920
    return Math.max(1.0, Math.min(ratio, 1.2))
  }

  /** A STABLE FUNCTION REFERENCE — the same one add and remove are given, or
   *  the listener outlives the drawer. */
  #onResize = (): void => {
    this.#scale = this.#computeScale()
    this.#applyScale()
  }

  connectedCallback(): void {
    installCss()
    this.#build()
    this.#scale = this.#computeScale()
    this.#applyScale()

    this.#offs.push(
      EffectBus.on<{
        atomizer: Atomizer
        target: AtomizableTarget
        properties: AtomizerProperty[]
      }>('atomizer:properties', (payload) => {
        // Set-state, so a redelivered payload is absorbed for free: the same
        // drop announced twice re-renders the same four fields and paints the
        // same rows. Nothing here appends or counts.
        this.#atomizer = payload?.atomizer ?? null
        this.#target = payload?.target ?? null
        // Properties arrive over EffectBus, so a foreign emitter could send a
        // non-array; the template would have thrown on `@for`. Normalising to
        // [] lands on the same branch an atomizer with no knobs already takes
        // (StructureAtomizer.discover returns exactly that — it navigates
        // instead of editing, so its drawer is header and target line only).
        const properties = payload?.properties
        this.#properties = Array.isArray(properties) ? properties : []
        this.#visible = true
        this.#render()
      }),

      // THE PIPE WAS IMPURE. The Angular original resolved its three strings
      // through the `t` pipe, declared `pure: false`, so every change-detection
      // tick re-read them and `/language ja` re-labelled an OPEN drawer on the
      // spot — the reset and close aria-labels and the spacing placeholder.
      // A #relabel(), NOT a #render(): the property body holds live form
      // controls, and rebuilding it would drop the caret of whoever is
      // mid-edit in a text or spacing field. Only the strings move.
      EffectBus.on('locale:changed', () => this.#relabel()),
    )

    window.addEventListener('resize', this.#onResize)

    // Hidden until a drop says otherwise (replay delivers the live value
    // immediately if there already is one) — a drawer that flashes on boot is
    // a regression.
    this.#render()
  }

  disconnectedCallback(): void {
    this.#offs.forEach(off => off())
    this.#offs = []
    window.removeEventListener('resize', this.#onResize)
    this.#sidebar = null
    this.#title = null
    this.#reset = null
    this.#close = null
    this.#targetLabel = null
    this.#targetType = null
    this.#props = null
    this.replaceChildren()
    // The four state fields deliberately survive: a surface the host MOVES
    // gets disconnect+connect, and `atomizer:properties` replays on
    // re-subscribe. NOTE that replay is also how a drawer the participant
    // CLOSED comes back on a re-mount — `close()` emits nothing, so the bus's
    // last value is still the drop. That is the component's behaviour
    // unchanged (it kept one instance for the shell's whole life and would do
    // the same if ever re-created); flagged rather than silently "fixed",
    // because the fix would be a new effect the drop worker does not send.
  }

  // ── the two actions — neither emits; both call the atomizer directly ───

  /** `close()` — the drawer's only exit, and it answers nothing. Four
   *  clearings in the component's own order, then one paint. The bar has no
   *  backdrop and no Escape binding (neither atomizer component bound a key
   *  handler of any kind), so this is the single path. */
  #closeSidebar(): void {
    this.#visible = false
    this.#atomizer = null
    this.#target = null
    this.#properties = []
    this.#render()
  }

  /** `reset()` — hand the target back to the atomizer, then RE-DISCOVER so the
   *  editors show the values that actually landed rather than the ones we
   *  guessed. Guard copied, not re-derived: both must be present. */
  #resetProperties(): void {
    const atomizer = this.#atomizer
    const target = this.#target
    if (!atomizer || !target) return
    atomizer.reset(target)
    // Re-discover to refresh values
    this.#properties = atomizer.discover(target)
    this.#render()
  }

  /** `onPropertyChange` — mutate the descriptor, then apply to the target in
   *  real time. THE EDIT IS THE COMMIT: there is no preview, no confirm and
   *  no batching; the component applied on every keystroke and slider tick,
   *  and so does this. The guard returns BEFORE the mutation, so a stray
   *  input with no atomizer/target leaves `prop.value` untouched — which is
   *  what keeps the range read-out honest (see #buildRange). */
  #onPropertyChange(prop: AtomizerProperty, value: string | number | boolean): void {
    const atomizer = this.#atomizer
    const target = this.#target
    if (!atomizer || !target) return

    // Update local state
    prop.value = value

    // Apply to the target in real time
    atomizer.apply(target, prop.key, value)
  }

  /** `onInputChange` — the component's coercion, verbatim. `parseFloat(...) ||
   *  0` (so an empty or unparseable field reads 0, and so does a typed "0"),
   *  `el.checked` for a toggle, the raw string for everything else. */
  #onInputChange(prop: AtomizerProperty, event: Event): void {
    const el = event.target as HTMLInputElement
    let value: string | number | boolean = el.value

    if (prop.type === 'number' || prop.type === 'range') {
      value = parseFloat(el.value) || 0
    } else if (prop.type === 'boolean') {
      value = el.checked
    }

    this.#onPropertyChange(prop, value)
  }

  // ── chrome (built once, detached) ──────────────────────────────────────
  #build(): void {
    if (this.#sidebar) return

    const sidebar = document.createElement('div')
    sidebar.className = 'atomizer-sidebar'

    const header = document.createElement('div')
    header.className = 'sidebar-header'

    const title = document.createElement('span')
    title.className = 'sidebar-title'

    const actions = document.createElement('div')
    actions.className = 'sidebar-actions'

    const reset = document.createElement('button')
    reset.type = 'button'
    reset.className = 'sidebar-btn'
    reset.addEventListener('click', () => { this.#resetProperties() })
    const resetGlyph = document.createElement('span')
    // `.mat-sym` is a GLOBAL class (shared/styles/_material-tokens.scss), not
    // a component rule — the ligature keeps working from a document sheet.
    resetGlyph.className = 'mat-sym'
    resetGlyph.textContent = 'restart_alt'
    reset.appendChild(resetGlyph)

    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'sidebar-btn'
    close.addEventListener('click', () => { this.#closeSidebar() })
    const closeX = document.createElement('span')
    closeX.className = 'close-x'
    // U+00D7 — the template's `&times;`.
    closeX.textContent = '×'
    close.appendChild(closeX)

    actions.append(reset, close)
    header.append(title, actions)

    const targetRow = document.createElement('div')
    targetRow.className = 'sidebar-target'

    const targetLabel = document.createElement('span')
    targetLabel.className = 'target-label'

    const targetType = document.createElement('span')
    targetType.className = 'target-type'

    targetRow.append(targetLabel, targetType)

    const props = document.createElement('div')
    props.className = 'sidebar-properties'

    sidebar.append(header, targetRow, props)

    this.#sidebar = sidebar
    this.#title = title
    this.#reset = reset
    this.#close = close
    this.#targetLabel = targetLabel
    this.#targetType = targetType
    this.#props = props
    // Built DETACHED — #render attaches the drawer only when a drop has
    // landed, so there is no transient flash on the way through mount.
  }

  /** The `[style.--hc-sidebar-scale]` binding. Written straight onto the
   *  panel node, which is the same node the CSS ladder reads `--s` from. */
  #applyScale(): void {
    this.#sidebar?.style.setProperty('--hc-sidebar-scale', String(this.#scale))
  }

  // ── the translated strings, re-resolved without touching the editors ───
  #relabel(): void {
    this.#reset?.setAttribute('aria-label', t('atomizer.reset', 'reset properties'))
    this.#close?.setAttribute('aria-label', t('atomizer.close', 'close atomizer bar'))
    // The spacing editor's placeholder is the third translated string, and it
    // sits ON a live input — so it is updated in place rather than rebuilt.
    const placeholder = t('atomizer.spacing-placeholder', 'e.g. 8px 12px')
    const spacing = this.#props?.querySelectorAll('input[data-hc-spacing]')
    spacing?.forEach((el) => {
      if (el instanceof HTMLInputElement) el.placeholder = placeholder
    })
  }

  // ── rendering (rebuild on change — the house pattern, no reconciler) ────
  #render(): void {
    const sidebar = this.#sidebar
    const title = this.#title
    const targetLabel = this.#targetLabel
    const targetType = this.#targetType
    const props = this.#props
    if (!sidebar || !title || !targetLabel || !targetType || !props) return

    // `@if (visible())` — a truthiness test, so `!this.#visible` is its exact
    // complement for every value (unlike a `> 0` predicate, where negation
    // lets NaN fall through). Closed means GONE, not `display:none`: the
    // template removed the whole drawer, and
    // `querySelector('.atomizer-sidebar')` is the DOM contract a driver would
    // assert on. Detaching rather than rebuilding keeps the reset and close
    // buttons and their listeners alive — and re-inserting the node replays
    // the slide-in animation, exactly as re-creating it did under Angular.
    if (!this.#visible) {
      sidebar.remove()
      props.replaceChildren()
      return
    }

    // `{{ atomizer()?.name }}`, `{{ target()?.targetId }}`,
    // `{{ target()?.targetType }}` — NOT translated: they come from the
    // atomizer module and the registered target as literals.
    title.textContent = interpolate(this.#atomizer?.name)
    targetLabel.textContent = interpolate(this.#target?.targetId)
    targetType.textContent = interpolate(this.#target?.targetType)

    // A rebuild of the body mints fresh controls, so whatever had focus would
    // be dropped to <body> — including a caret mid-word in a text or spacing
    // field, which `reset()` can hit while the participant is typing. Snapshot
    // by `data-hc-row` (a key THIS panel stamps, never a class two controls
    // could share) and restore after the new nodes are in place, caret and
    // all. The house focusSnapshot/restoreFocus pair, not a reconciler.
    const snap = focusSnapshot(props)
    // …AND THE SCROLL, which is the other half of "where the participant was".
    // `.sidebar-properties` IS the scroller, and emptying a scrolled container
    // clamps scrollTop to 0 — refilling does not put it back. That is a real
    // gesture, not a corner: reset() is a button at the TOP of the drawer while
    // discovery yields fifteen properties across six groups, so pressing it
    // from the 'content' group snapped the participant back to 'typography'.
    // Angular re-used every row across a properties() update and never moved.
    const scrollTop = props.scrollTop

    props.replaceChildren()
    for (const [group, list] of this.#groupProperties()) {
      props.appendChild(this.#buildGroup(group, list))
    }

    this.#relabel()

    // Back in, if it was out. Moving a live node, never re-creating it.
    if (sidebar.parentNode !== this) this.appendChild(sidebar)

    // Restore AFTER the nodes are in the document — focus parked on a
    // detached node does not stick, so this has to follow the attach.
    // (restoreFocus does the `CSS.escape` internally, in CORE's scope: never
    // call `CSS.escape` from a module whose stylesheet const is named CSS,
    // because the const shadows the global object and the call does not even
    // compile.)
    // scrollTop only sticks once the node is back in the document.
    if (scrollTop > 0) props.scrollTop = scrollTop
    restoreFocus(props, snap)
  }

  /** The `groupedProperties` computed, verbatim: a Map keyed by
   *  `prop.group ?? 'general'`, rendered in FIRST-SEEN order (Map insertion
   *  order is what `[...groups.entries()]` yielded). */
  #groupProperties(): Array<[string, AtomizerProperty[]]> {
    const groups = new Map<string, AtomizerProperty[]>()
    for (const prop of this.#properties) {
      const group = prop.group ?? 'general'
      const list = groups.get(group) ?? []
      list.push(prop)
      groups.set(group, list)
    }
    return [...groups.entries()]
  }

  #buildGroup(group: string, list: AtomizerProperty[]): HTMLDivElement {
    const section = document.createElement('div')
    section.className = 'property-group'

    const label = document.createElement('span')
    label.className = 'group-label'
    // `{{ group[0] }}` — the raw group name off the property descriptor.
    // NOT translated in the original, and not translated here: inventing a
    // `atomizer.group.*` key stem would mint keys no catalog carries and
    // leave every community atomizer's own group names unresolved.
    label.textContent = interpolate(group)
    section.appendChild(label)

    for (const prop of list) section.appendChild(this.#buildRow(prop))
    return section
  }

  #buildRow(prop: AtomizerProperty): HTMLDivElement {
    const row = document.createElement('div')
    row.className = 'property-row'

    const label = document.createElement('label')
    label.className = 'property-label'
    // `{{ prop.label }}` — supplied by the atomizer as a literal ("font size",
    // "text color"), printed as-is exactly as the template did.
    label.textContent = interpolate(prop.label)
    row.appendChild(label)

    // `@switch (prop.type)` with NO `@default` branch: an unrecognised type
    // renders the label and nothing else. Copied, including the silence.
    const editor = this.#buildEditor(prop)
    if (editor) row.appendChild(editor)

    return row
  }

  #buildEditor(prop: AtomizerProperty): HTMLElement | null {
    switch (prop.type) {
      case 'color': return this.#buildColor(prop)
      case 'number': return this.#buildNumber(prop)
      case 'range': return this.#buildRange(prop)
      case 'text': return this.#buildText(prop, false)
      case 'boolean': return this.#buildToggle(prop)
      case 'select': return this.#buildSelect(prop)
      case 'spacing': return this.#buildText(prop, true)
      default: return null
    }
  }

  #buildColor(prop: AtomizerProperty): HTMLInputElement {
    const input = document.createElement('input')
    input.type = 'color'
    input.className = 'property-color'
    input.value = interpolate(prop.value)
    input.dataset['hcRow'] = prop.key
    input.addEventListener('input', (event) => { this.#onInputChange(prop, event) })
    return input
  }

  #buildNumber(prop: AtomizerProperty): HTMLInputElement {
    const input = document.createElement('input')
    input.type = 'number'
    input.className = 'property-number'
    input.value = interpolate(prop.value)
    // `[min]="prop.min ?? ''"` / `[max]="prop.max ?? ''"` — an empty string is
    // how the template CLEARED the bound attribute, so an unbounded number
    // stays unbounded. `[step]="prop.step ?? 1"`.
    input.min = String(prop.min ?? '')
    input.max = String(prop.max ?? '')
    input.step = String(prop.step ?? 1)
    input.dataset['hcRow'] = prop.key
    input.addEventListener('input', (event) => { this.#onInputChange(prop, event) })
    return input
  }

  #buildRange(prop: AtomizerProperty): HTMLDivElement {
    const wrap = document.createElement('div')
    wrap.className = 'property-range-wrap'

    const input = document.createElement('input')
    input.type = 'range'
    input.className = 'property-range'
    // `[min]="prop.min ?? 0"` `[max]="prop.max ?? 100"` `[step]="prop.step ?? 1"`
    input.min = String(prop.min ?? 0)
    input.max = String(prop.max ?? 100)
    input.step = String(prop.step ?? 1)
    input.value = interpolate(prop.value)
    input.dataset['hcRow'] = prop.key

    const readout = document.createElement('span')
    readout.className = 'range-value'
    readout.textContent = interpolate(prop.value)

    input.addEventListener('input', (event) => {
      this.#onInputChange(prop, event)
      // `{{ prop.value }}` beside the slider — Angular repainted it on the
      // tick that followed the same handler. Mutating ONE existing text node
      // on a stream update is not a reconciler, and reading it back off
      // `prop.value` (rather than off the input) keeps the read-out honest
      // when #onPropertyChange's guard refuses the write.
      readout.textContent = interpolate(prop.value)
    })

    wrap.append(input, readout)
    return wrap
  }

  #buildText(prop: AtomizerProperty, spacing: boolean): HTMLInputElement {
    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'property-text'
    input.value = interpolate(prop.value)
    input.dataset['hcRow'] = prop.key
    if (spacing) {
      // The 'spacing' branch is a text input with one extra binding — the
      // only translated string in the whole property body, which is why the
      // node is tagged for #relabel to find on a locale switch.
      input.dataset['hcSpacing'] = ''
      input.placeholder = t('atomizer.spacing-placeholder', 'e.g. 8px 12px')
    }
    input.addEventListener('input', (event) => { this.#onInputChange(prop, event) })
    return input
  }

  #buildToggle(prop: AtomizerProperty): HTMLLabelElement {
    const wrap = document.createElement('label')
    wrap.className = 'property-toggle'

    const input = document.createElement('input')
    input.type = 'checkbox'
    // `[checked]="prop.value"` — a property assignment, so the same JS
    // truthiness coercion the template had.
    input.checked = Boolean(prop.value)
    input.dataset['hcRow'] = prop.key
    // `(change)`, not `(input)` — the original's binding.
    input.addEventListener('change', (event) => { this.#onInputChange(prop, event) })

    const track = document.createElement('span')
    track.className = 'toggle-track'

    // Order matters: the CSS is `input:checked + .toggle-track`.
    wrap.append(input, track)
    return wrap
  }

  #buildSelect(prop: AtomizerProperty): HTMLSelectElement {
    const select = document.createElement('select')
    select.className = 'property-select'
    select.dataset['hcRow'] = prop.key

    // `@for (opt of prop.options ?? []; track opt.value)`
    for (const opt of prop.options ?? []) {
      const option = document.createElement('option')
      option.value = opt.value
      option.textContent = interpolate(opt.label)
      // `[selected]="opt.value === prop.value"` — STRICT equality, copied.
      // A numeric `prop.value` therefore matches no string option, exactly as
      // it failed to under Angular.
      option.selected = opt.value === prop.value
      select.appendChild(option)
    }

    // `onSelectChange` took the raw `el.value` straight to onPropertyChange —
    // no coercion, unlike onInputChange. Kept separate for that reason.
    select.addEventListener('change', () => {
      this.#onPropertyChange(prop, select.value)
    })
    return select
  }
}

// ── shell surface registration — the externalization path ────────────────
// Same name, same order band the Angular component held; the module-side
// `element:` shape (documentation/shell-surfaces.md). The BAR registers
// separately at 390, one band below — two surfaces, two registrations, never
// merged.
//
// DEFINED AT MODULE SCOPE, registered when a registry appears. A host with no
// ShellSurfaceRegistry (diamond-core-processor mounts tags directly in its own
// template) still needs the tag to be a real element rather than an inert
// unknown one — so the define cannot wait on the registry. Only the ADD does.
if (!customElements.get(SURFACE_NAME)) {
  customElements.define(SURFACE_NAME, AtomizerSidebarElement)
}

window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/AtomizerSidebarElement',
    element: SURFACE_NAME,
    order: 400,
  })
})
