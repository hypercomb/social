// format-painter.view.ts — the /format painter drawer as a framework-free
// custom element (everything-is-a-beehavior Phase 2: Angular panels leave the
// shell and ship as signed modules).
//
// A straight port of shared/ui/format-painter: same surface name
// (hc-format-painter), same order band (380), the same single effect in
// (`format:state`, plus the `keymap:invoke` escape listener) and the same
// three effects out (`format:close`, `format:toggle-entry`, `format:apply`).
// The participant sees the same right-side drawer, delivered as a module.
//
// WHAT IT IS FOR. Copy formatting from one tile onto a selection. Clicking a
// tile with `/format` open loads that tile's visual properties
// (FormatPainterDrone#loadSource); each property the providers recognise
// becomes a row with a swatch and a checkbox. Untick what you don't want,
// press "Apply to selection", and the enabled properties are committed onto
// every OTHER selected tile as ordinary layer writes — undoable, and they
// travel. This surface is only the picker: it holds NO state of its own, it
// renders `format:state` and emits the three gestures back.
//
// IT RETIRED A LEAK. The Angular component imported `FormatPainterState`
// from `@hypercomb/essentials/...` — a shared→essentials compile-time import
// that only survived because it was type-only (a value import would have
// inverted the dependency direction outright). From essentials the same type
// is an ordinary relative sibling. Kept `import type` deliberately: the
// drone module REGISTERS an instance at module scope, so a value import here
// would risk a second FormatPainterDrone inlined into a second bundle — the
// dup-inlining trap. Type-only, and esbuild erases the edge entirely.
//
// WIDGET ZOOM. The template stamped `hcWidget="format-painter"
// anchor="top-right"` on the panel div. Those mechanics now live in core
// (`attachWidgetZoom`), so the directive and this element zoom through the
// SAME code and the same persisted scale. Attached once to the panel node
// (the node is built once and only detached/re-attached, so there is nothing
// to re-stamp on each open), torn down on disconnect.
//
// NO CHANGE DETECTION. The Angular version injected ChangeDetectorRef and
// called detectChanges() inside the `format:state` handler, because the
// effect fires outside Angular's zone. An element has no ticks to force: the
// state effect IS the render trigger. Nothing else depended on that tick —
// the only other reader of the same state was the `| t` pipe, and that is
// covered by the locale subscription below.
//
// Its strings ship WITH it (format-painter.i18n.ts, extracted from all 14
// shell catalogs) and register under the 'app' namespace, so every key
// resolves exactly as before — the Phase 2 catalog split, another slice.

import { EffectBus, I18N_IOC_KEY, attachWidgetZoom, type I18nProvider } from '@hypercomb/core'
import { FORMAT_PAINTER_TRANSLATIONS } from './format-painter.i18n.js'
import type { FormatPainterState } from '../format/format-painter.drone.js'

const SURFACE_NAME = 'hc-format-painter'

/** Same widget id and anchor the template passed to `hcWidget`. Changing
 *  either would orphan the participant's persisted scale. */
const WIDGET_ID = 'format-painter'
const WIDGET_ANCHOR = 'top-right' as const

/** The component's `EMPTY` sentinel, unchanged — what renders before the
 *  first `format:state` arrives (i.e. nothing). */
const EMPTY: FormatPainterState = { open: false, sourceCell: null, entries: [] }

// Same contract as the shell pipe: the live provider resolves the key, and
// the fallback is the English catalog text so a bare host with no i18n reads
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
  for (const [locale, catalog] of Object.entries(FORMAT_PAINTER_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

// ── the styles the Angular SCSS carried, expanded to plain CSS ────────────
// No shadow DOM (the tutorial-overlay + sequence-viewer precedent), so
// Angular's `:host` becomes the tag name and every other selector is
// prefixed with it — nothing can leak out of the drawer. SCSS nesting is
// flattened by hand; `var(--hc-*)` is left alone.
//
// Two things kept verbatim from the SCSS, with their reasoning:
//   - TOP clears the header at any size (3rem × the active header zoom, or
//     the header anchor plus a hair, whichever is lower down).
//   - Z-INDEX 59990: #pixi-host reparents to <body> at 59989 with a
//     pointer-events:auto canvas inside (pixi-host.worker.ts). Below it the
//     drawer still PAINTS but the close ×, the per-entry checkboxes and
//     "Apply to selection" all hit the canvas instead. Stays under the
//     atomizer sidebar (59991) and under every modal (100000+).
// Angular's build autoprefixed, so `-webkit-backdrop-filter` is written out
// here by hand. The keyframes are renamed with the surface prefix because
// @keyframes names live in one global namespace once the sheet is in <head>.
const CSS = `
${SURFACE_NAME}{display:contents}
${SURFACE_NAME} .fp-panel{position:fixed;top:max(calc(3rem * var(--hc-header-zoom,1.0)),calc(var(--hc-header-anchor) + 0.67rem));right:.75rem;z-index:59990;width:14rem;display:flex;flex-direction:column;background:rgba(14,18,24,.92);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.08);border-radius:var(--hc-radius-floating);box-shadow:0 12px 48px rgba(0,0,0,.7);color:rgba(245,245,245,.85);font-family:var(--hc-mono);animation:hc-format-painter-enter 200ms cubic-bezier(0.16,1,0.3,1) forwards}
${SURFACE_NAME} .fp-header{display:flex;align-items:center;justify-content:space-between;padding:.6rem .75rem;border-bottom:1px solid rgba(255,255,255,.06)}
${SURFACE_NAME} .fp-header h3{font-size:.62rem;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:rgba(245,245,245,.5);margin:0}
${SURFACE_NAME} .fp-close{display:flex;align-items:center;justify-content:center;width:1.4rem;height:1.4rem;background:none;border:none;border-radius:3px;color:rgba(245,245,245,.3);font-size:.9rem;cursor:pointer;transition:color 150ms ease,background 150ms ease}
${SURFACE_NAME} .fp-close:hover{color:whitesmoke;background:rgba(255,255,255,.08)}
${SURFACE_NAME} .fp-body{padding:.5rem .75rem;display:flex;flex-direction:column;gap:.35rem}
${SURFACE_NAME} .fp-empty{font-size:.68rem;color:rgba(245,245,245,.3);text-align:center;padding:.5rem 0}
${SURFACE_NAME} .fp-entry{display:flex;align-items:center;gap:.4rem;padding:.3rem .35rem;border-radius:4px;cursor:pointer;transition:background 100ms ease}
${SURFACE_NAME} .fp-entry:hover{background:rgba(255,255,255,.04)}
${SURFACE_NAME} .fp-entry.disabled{opacity:.4}
${SURFACE_NAME} .fp-entry input[type="checkbox"]{accent-color:#c8975a;width:.85rem;height:.85rem;cursor:pointer;flex-shrink:0}
${SURFACE_NAME} .fp-swatch{display:inline-block;width:1rem;height:1rem;border-radius:3px;border:1px solid rgba(255,255,255,.15);flex-shrink:0}
${SURFACE_NAME} .fp-label{font-size:.68rem;color:rgba(245,245,245,.65);flex:1;min-width:0}
${SURFACE_NAME} .fp-value{font-size:.6rem;color:rgba(245,245,245,.3);font-family:inherit;flex-shrink:0}
${SURFACE_NAME} .fp-footer{padding:.5rem .75rem .6rem;border-top:1px solid rgba(255,255,255,.06)}
${SURFACE_NAME} .fp-apply{width:100%;padding:.4rem 0;background:rgba(200,151,90,.18);border:1px solid rgba(200,151,90,.3);border-radius:var(--hc-radius-floating);color:#c8975a;font-size:.65rem;font-weight:600;font-family:inherit;letter-spacing:.04em;cursor:pointer;transition:background 150ms ease,border-color 150ms ease}
${SURFACE_NAME} .fp-apply:hover:not(:disabled){background:rgba(200,151,90,.28);border-color:rgba(200,151,90,.5)}
${SURFACE_NAME} .fp-apply:disabled{opacity:.35;cursor:default}
@keyframes hc-format-painter-enter{from{opacity:0;transform:translateX(8px)}to{opacity:1;transform:translateX(0)}}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-format-painter', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

/** Angular interpolation stringifies `null`/`undefined` to the empty string
 *  and everything else through String(). `entry.value` is `unknown`, so the
 *  drawer would otherwise print "null" where the template printed nothing. */
const interpolate = (value: unknown): string => value === null || value === undefined ? '' : String(value)

export class FormatPainterElement extends HTMLElement {

  #offs: Array<() => void> = []
  #state: FormatPainterState = EMPTY

  // ── chrome, built once ─────────────────────────────────────────────────
  // The panel, its header and its footer button survive every re-render.
  // Only the BODY rows rebuild (the house pattern: state lives in the drone,
  // so throwing those away and rebuilding them is always safe).
  #panel: HTMLDivElement | null = null
  #title: HTMLHeadingElement | null = null
  #body: HTMLDivElement | null = null
  #footer: HTMLElement | null = null
  #apply: HTMLButtonElement | null = null

  /** attachWidgetZoom's teardown — the effect subscription would otherwise
   *  outlive the node it scales. */
  #zoomOff: (() => void) | null = null

  connectedCallback(): void {
    installCss()
    this.#build()
    // Subscribed in the component's original order: `format:state` first, so
    // its last-value replay has already filled #state by the time the escape
    // listener replays its own last value — exactly what ngOnInit did.
    this.#offs.push(
      EffectBus.on<FormatPainterState>('format:state', (state) => {
        this.#state = state ?? EMPTY
        this.#render()
      }),
      EffectBus.on<{ cmd: string }>('keymap:invoke', (payload) => {
        // Same guard as the component: escape only closes an OPEN painter,
        // so it falls through to whatever else owns the escape cascade.
        if (payload?.cmd === 'global.escape' && this.#state.open) this.#close()
      }),
      // THE PIPE WAS IMPURE. The Angular original resolved its three strings
      // through the `t` pipe, declared `pure: false`, so every change-detection
      // tick re-read them and `/language ja` re-labelled an OPEN drawer on the
      // spot — title, aria-label, the empty-state line and the Apply button.
      // An element renders when it decides to, so the locale switch has to be
      // a reason to render, or an open drawer freezes in the old language
      // until the next `format:state` happens to arrive.
      EffectBus.on('locale:changed', () => this.#render()),
    )
    // Hidden until the state says otherwise (replay delivers the live value
    // immediately if there already is one) — a drawer that flashes on boot
    // is a regression.
    this.#render()
  }

  disconnectedCallback(): void {
    this.#offs.forEach(off => off())
    this.#offs = []
    this.#zoomOff?.()
    this.#zoomOff = null
    this.#panel = null
    this.#title = null
    this.#body = null
    this.#footer = null
    this.#apply = null
    this.replaceChildren()
    // #state deliberately survives: a surface the host MOVES (order change)
    // gets disconnect+connect, and `format:state` replays on re-subscribe.
  }

  // ── the three gestures out — each answers exactly once ─────────────────

  #close(): void { EffectBus.emit('format:close', {}) }

  #toggleEntry(key: string): void { EffectBus.emit('format:toggle-entry', { key }) }

  #applyFormat(): void { EffectBus.emit('format:apply', {}) }

  // ── chrome (built once, detached) ──────────────────────────────────────
  #build(): void {
    if (this.#panel) return

    const panel = document.createElement('div')
    panel.className = 'fp-panel'
    panel.setAttribute('role', 'dialog')

    const header = document.createElement('header')
    header.className = 'fp-header'

    const title = document.createElement('h3')

    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'fp-close'
    // U+00D7 — the template's `&times;`. Unlabelled there and unlabelled
    // here: inventing an aria-label would mint a key no catalog carries.
    close.textContent = '×'
    close.addEventListener('click', () => { this.#close() })

    header.append(title, close)

    const body = document.createElement('div')
    body.className = 'fp-body'

    const footer = document.createElement('footer')
    footer.className = 'fp-footer'

    const apply = document.createElement('button')
    apply.type = 'button'
    apply.className = 'fp-apply'
    apply.addEventListener('click', () => { this.#applyFormat() })
    footer.appendChild(apply)

    panel.append(header, body)
    // The footer is appended by #render — the template gated it behind
    // `@if (hasEntries())`, so it must be genuinely absent, not just empty.

    // The `hcWidget` stamp, same id and anchor. Attached to the PANEL (where
    // the directive sat), once — the node is only ever detached and
    // re-attached, never rebuilt, so there is nothing to re-stamp.
    this.#zoomOff = attachWidgetZoom(panel, WIDGET_ID, WIDGET_ANCHOR)

    this.#panel = panel
    this.#title = title
    this.#body = body
    this.#footer = footer
    this.#apply = apply
    // Built DETACHED — `#render` attaches the panel only when the state says
    // open, so there is no transient flash on the way through mount.
  }

  // ── rendering (rebuild on change — the house pattern, no reconciler) ────
  #render(): void {
    const panel = this.#panel
    const title = this.#title
    const body = this.#body
    const footer = this.#footer
    const apply = this.#apply
    if (!panel || !title || !body || !footer || !apply) return

    const state = this.#state

    // `@if (open())` — a truthiness test, so `!state.open` is its exact
    // complement for every value (unlike a `> 0` predicate, where negation
    // lets NaN fall through). Closed means GONE, not `display:none`: the
    // template removed the whole panel, and `querySelector('.fp-panel')` is
    // the DOM contract a driver would assert on. Detaching rather than
    // rebuilding keeps the close button, the Apply button and their
    // listeners alive — and re-inserting the node replays the fp-enter
    // animation, exactly as re-creating it did under Angular.
    if (!state.open) {
      panel.remove()
      body.replaceChildren()
      return
    }

    // Entries arrive over EffectBus, so a foreign emitter could send a
    // non-array; the template would have thrown on `@for`. Normalising to []
    // lands on the same branch the empty state already covers.
    const entries = Array.isArray(state.entries) ? state.entries : []
    const hasEntries = entries.length > 0
    const enabledCount = entries.filter(e => e.enabled).length

    // Focus lives on nodes that survive (close / Apply); the only thing a
    // body rebuild can drop is a keyboard focus parked on an entry checkbox,
    // which Angular kept via `track entry.key`. Snapshot the key, restore it
    // after — the house `focusSnapshot`/`restoreFocus` pattern, not a
    // reconciler.
    const active = document.activeElement
    const refocusKey = active instanceof HTMLElement && body.contains(active)
      ? active.dataset['entryKey'] ?? ''
      : ''

    // Strings re-resolved on every render — this is what the impure pipe was
    // doing on every tick, and it is why `locale:changed` renders.
    const heading = t('format-painter.title', 'Format Painter')
    title.textContent = heading
    panel.setAttribute('aria-label', heading)

    body.replaceChildren()

    // `@if (!hasEntries())` — the empty line, kept on the original polarity.
    if (!hasEntries) {
      const empty = document.createElement('div')
      empty.className = 'fp-empty'
      empty.textContent = t('format-painter.empty', 'No visual properties on this tile')
      body.appendChild(empty)
    }

    let refocus: HTMLElement | null = null

    for (const entry of entries) {
      const row = document.createElement('div')
      row.className = 'fp-entry'
      // `[class.disabled]="!entry.enabled"`
      row.classList.toggle('disabled', !entry.enabled)
      row.addEventListener('click', () => { this.#toggleEntry(entry.key) })

      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.checked = entry.enabled
      // The template's inline `style="pointer-events: none"` — the whole ROW
      // is the target, so the box never eats the click meant for it.
      checkbox.style.pointerEvents = 'none'
      checkbox.dataset['entryKey'] = entry.key
      row.appendChild(checkbox)
      if (entry.key === refocusKey) refocus = checkbox

      // `@if (entry.preview)` — truthiness, same as the template.
      if (entry.preview) {
        const swatch = document.createElement('span')
        swatch.className = 'fp-swatch'
        swatch.style.background = entry.preview
        row.appendChild(swatch)
      }

      const label = document.createElement('span')
      label.className = 'fp-label'
      // NOT translated: the providers supply these labels (Border,
      // Background) as literals, exactly as `{{ entry.label }}` printed them.
      label.textContent = interpolate(entry.label)

      const value = document.createElement('span')
      value.className = 'fp-value'
      value.textContent = interpolate(entry.value)

      row.append(label, value)
      body.appendChild(row)
    }

    // `@if (hasEntries())` around the footer — attach or detach the whole
    // thing; moving the live node keeps the Apply listener (and its focus).
    if (hasEntries) {
      apply.textContent = t('format-painter.apply', 'Apply to selection')
      // `[disabled]="enabledCount() === 0"` — copied, not re-derived.
      apply.disabled = enabledCount === 0
      if (footer.parentNode !== panel) panel.appendChild(footer)
    } else {
      footer.remove()
    }

    // Back in, if it was out. Moving a live node, never re-creating it.
    if (panel.parentNode !== this) this.appendChild(panel)

    refocus?.focus()
  }
}

// ── shell surface registration — the externalization path ────────────────
// Same name, same order band the Angular component held; the module-side
// `element:` shape (documentation/shell-surfaces.md).
// DEFINED AT MODULE SCOPE, registered when a registry appears. A host with
// no ShellSurfaceRegistry (diamond-core-processor mounts tags directly in
// its own template) still needs the tag to be a real element rather than an
// inert unknown one — so the define cannot wait on the registry. Only the
// ADD does.
if (!customElements.get(SURFACE_NAME)) {
  customElements.define(SURFACE_NAME, FormatPainterElement)
}

window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/FormatPainterElement',
    element: SURFACE_NAME,
    order: 380,
  })
})
