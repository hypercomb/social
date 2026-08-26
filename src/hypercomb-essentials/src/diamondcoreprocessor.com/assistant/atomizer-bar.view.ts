// atomizer-bar.view.ts — the atomizer toolbar as a framework-free custom
// element (everything-is-a-beehavior Phase 2: Angular panels leave the shell
// and ship as signed modules).
//
// A straight port of shared/ui/atomizer-bar/atomizer-bar.component: same
// surface name (hc-atomizer-bar), same order band (390), the same three
// effects in (`atomizer-bar:toggle`, `atomizer:registered`,
// `atomizer:dropped`) and the same three effects out (`atomizer-bar:toggle`
// on close, `atomizer:drag-start`, `atomizer:drag-end`). The participant sees
// the same left-edge strip, delivered as a module instead of compiled into
// the shell.
//
// WHAT IT IS FOR. `/atomize-ui` (slash-behaviour.drone.ts, AtomizeUiProvider)
// emits `atomizer-bar:toggle {active:true}` and this strip appears down the
// left edge. Every atomizer module that has registered itself is one draggable
// icon. Drag one onto a matching control and AtomizerDropWorker lights up the
// valid targets, resolves the atomizer on drop, discovers the target's
// properties and hands them to the SIDEBAR (hc-atomizer-sidebar, order 400) —
// which is the surface that actually edits anything. This strip only starts
// the gesture; it holds no target and applies no change.
//
// THE TWO SURFACES NEVER TOUCH. The bar and the sidebar are mounted
// independently by the shell-surface host and talk only through EffectBus:
// bar → `atomizer:drag-start` → the drop worker → `atomizer:properties` →
// sidebar. The one thing that flows back the other way is `atomizer:dropped`,
// which the bar reads purely to mark the dropped atomizer `.active`. A direct
// reference between two registry-fed elements would couple surfaces the shell
// is free to mount, move and unmount separately — so there is none.
//
// Its strings ship WITH it (atomizer-bar.i18n.ts, extracted from all 14 shell
// catalogs) and register under the 'app' namespace, so every key resolves
// exactly as before — the Phase 2 catalog split, another slice. `atomizer.close`
// is rendered by the SIDEBAR too, so it lives in both catalogs: a surface must
// carry everything it renders, or it stops resolving the day it is loaded
// somewhere the other one is not.

import {
  EffectBus, I18N_IOC_KEY, ATOMIZER_IOC_PREFIX, attachWidgetZoom,
  type Atomizer, type I18nProvider,
} from '@hypercomb/core'
import { ATOMIZER_BAR_TRANSLATIONS } from './atomizer-bar.i18n.js'

const SURFACE_NAME = 'hc-atomizer-bar'

/** Same widget id and anchor the template passed to `hcWidget`. Changing
 *  either would orphan the participant's persisted scale. */
const WIDGET_ID = 'atomizer-bar'
const WIDGET_ANCHOR = 'left' as const

// Same contract as the shell pipe: the live provider resolves the key, and the
// fallback is the English catalog text so a bare host with no i18n reads
// identically. None of this panel's three keys take params.
const t = (key: string, fallback: string): string => {
  const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
  const value = i18n?.t(key)
  return value && value !== key ? value : fallback
}

// The toolbar's strings travel with it — registered as soon as the i18n
// service is up, under 'app' so the keys resolve exactly as they always did.
window.ioc?.whenReady?.(I18N_IOC_KEY, (i18n) => {
  const provider = i18n as I18nProvider
  for (const [locale, catalog] of Object.entries(ATOMIZER_BAR_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

// ── the styles the Angular SCSS carried, expanded to plain CSS ────────────
// No shadow DOM (the tutorial-overlay + sequence-viewer precedent), so
// Angular's `:host` becomes the tag name and every other selector is prefixed
// with it — nothing can leak out of the strip. `display:contents` is kept
// verbatim because both shells hide this surface BY TAG
// (`body.hc-view-website hc-atomizer-bar{display:none !important}` in
// web/dev styles.scss, and dev's `:host.intro-active` sweep) — the tag has to
// stay the thing those rules can reach.
//
// Kept verbatim from the SCSS, with its reasoning: Z-INDEX 59991. #pixi-host
// reparents to <body> at 59989 with a pointer-events:auto canvas inside
// (pixi-host.worker.ts). Below it the bar painted normally but every atomizer
// button's click was eaten by the canvas. Still under all shell chrome
// (edit-actions 59995, controls/hint bars 59999, header 60000).
//
// Angular's build autoprefixed, so `-webkit-backdrop-filter` is written out
// here by hand. There are no @keyframes in this sheet, so nothing to namespace.
//
// TWO SCSS RULES WERE DEAD AND ARE WRITTEN LIVE HERE — see the icon note on
// `#buildItem` below. `.atomizer-icon { :host ::ng-deep svg { … } }` nested
// under a class compiles to `.atomizer-icon :host ::ng-deep svg`, a selector
// `:host` can never satisfy, so the 18px icon sizing never applied. It does
// now, and it is needed: the atomizer icons carry width="24" height="24" and
// would otherwise overflow their 20px box.
const CSS = `
${SURFACE_NAME}{display:contents}
${SURFACE_NAME} .atomizer-bar{position:fixed;left:12px;top:50%;transform:translateY(-50%);z-index:59991;display:flex;flex-direction:column;gap:2px;padding:8px 6px;min-width:52px;background:rgba(10,10,18,.92);border:1px solid rgba(255,255,255,.06);border-radius:var(--hc-radius-floating);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
${SURFACE_NAME} .atomizer-bar-header{display:flex;align-items:center;justify-content:space-between;padding:2px 4px 6px;border-bottom:1px solid rgba(255,255,255,.06);margin-bottom:4px}
${SURFACE_NAME} .atomizer-bar-title{font-size:9px;font-family:var(--hc-mono);letter-spacing:.5px;color:rgba(255,255,255,.4);text-transform:uppercase}
${SURFACE_NAME} .atomizer-close-btn{background:none;border:none;color:rgba(255,255,255,.3);cursor:pointer;font-size:14px;line-height:1;padding:0 2px}
${SURFACE_NAME} .atomizer-close-btn:hover{color:rgba(255,255,255,.7)}
${SURFACE_NAME} .close-x{display:block}
${SURFACE_NAME} .atomizer-list{display:flex;flex-direction:column;gap:2px}
${SURFACE_NAME} .atomizer-item{display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 4px;border-radius:var(--hc-radius-control);cursor:grab;transition:background .15s ease,box-shadow .15s ease}
${SURFACE_NAME} .atomizer-item:hover{background:rgba(255,255,255,.06)}
${SURFACE_NAME} .atomizer-item:active{cursor:grabbing;background:rgba(255,255,255,.1);box-shadow:0 0 8px rgba(0,229,255,.2)}
${SURFACE_NAME} .atomizer-item.active{background:rgba(0,229,255,.08);box-shadow:inset 0 0 0 1px rgba(0,229,255,.2)}
${SURFACE_NAME} .atomizer-icon{width:20px;height:20px;display:flex;align-items:center;justify-content:center;opacity:.7}
${SURFACE_NAME} .atomizer-item:hover .atomizer-icon{opacity:1}
${SURFACE_NAME} .atomizer-icon svg{width:18px;height:18px}
${SURFACE_NAME} .atomizer-name{font-size:8px;font-family:var(--hc-mono);color:rgba(255,255,255,.45);text-align:center;line-height:1.1;max-width:48px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${SURFACE_NAME} .atomizer-item:hover .atomizer-name{color:rgba(255,255,255,.7)}
${SURFACE_NAME} .atomizer-empty{font-size:8px;font-family:var(--hc-mono);color:rgba(255,255,255,.25);text-align:center;padding:8px 4px}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-atomizer-bar', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

/** Angular interpolation stringifies null/undefined to the empty string and
 *  everything else through String(). */
const interpolate = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value)

export class AtomizerBarElement extends HTMLElement {

  #offs: Array<() => void> = []

  // ── state (mirrors the component's four live signals) ──────────────────
  // `dragging` and `overValidTarget` are NOT here: both were written by the
  // drag handlers and read by nothing — no template binding, no other reader.
  // Dead signals in the original; dead fields would be dead here too.
  #visible = false
  #atomizers: Atomizer[] = []
  #active: Atomizer | null = null

  // ── chrome, built once ─────────────────────────────────────────────────
  // The bar, its header and its close button survive every re-render; only
  // the LIST changes, and even there the rows are kept (see #render).
  #bar: HTMLDivElement | null = null
  #title: HTMLSpanElement | null = null
  #close: HTMLButtonElement | null = null
  #list: HTMLDivElement | null = null
  #empty: HTMLDivElement | null = null

  /** The sanctioned per-panel keyed map, and this panel earns it: a row IS a
   *  drag source. Rebuilding the list while a drag is in flight would destroy
   *  the node the pointer is holding — the browser would never deliver its
   *  `dragend`, so `atomizer:drag-end` would never fire and every highlighted
   *  drop target the worker lit up would stay lit forever. Angular's
   *  `track atomizer.atomizerId` kept those nodes for exactly this reason, so
   *  the port keeps them too, and MOVES them with insertBefore. */
  #rows = new Map<string, HTMLDivElement>()

  /** attachWidgetZoom's teardown — the effect subscription would otherwise
   *  outlive the node it scales. */
  #zoomOff: (() => void) | null = null

  connectedCallback(): void {
    installCss()
    this.#build()

    // SEED FROM IoC BEFORE SUBSCRIBING. `atomizer:registered` is a plain
    // emit, so EffectBus keeps only the LAST payload for replay — and the bar
    // used to be shell-side Angular, mounted at boot long before any atomizer
    // module loaded, so it always caught both live emits. As a module it is
    // loaded by AtomizerDropWorker and can easily evaluate AFTER
    // input.atomizer.ts and structure.atomizer.ts, at which point the replay
    // hands it one atomizer and the other is silently missing from the strip.
    // Both modules `ioc.register('@hypercomb.social/Atomizer:<id>', …)` right
    // beside that emit, and the drop worker already resolves them from
    // exactly this prefix — so the seed reads the same registry the rest of
    // the machinery reads. No new channel, and the dedupe below absorbs the
    // effect that arrives for an atomizer already seeded.
    this.#seedFromIoc()

    this.#offs.push(
      // Visibility. `/atomize-ui` emits {active:true}; close() emits
      // {active:false}. Last-value replay means a surface the host MOVES
      // (disconnect + connect) comes back in the state the participant left
      // it in — which is right here: closing WRITES the false, so a replay
      // can never re-open a bar somebody dismissed.
      EffectBus.on<{ active: boolean }>('atomizer-bar:toggle', (payload) => {
        // `@if (visible())` is a truthiness test and `visible.set(active)`
        // stored whatever arrived, so Boolean() is the exact equivalent.
        this.#visible = Boolean(payload?.active)
        this.#render()
      }),

      // Registrations. IDEMPOTENT BY CONSTRUCTION: the original deduped on
      // atomizerId and returned the same list, so a module that announces
      // itself twice (or a replay of a payload the seed already took) adds
      // nothing. This is the accumulating-subscriber shape the house rule
      // warns about, and the dedupe is what makes the repeat free.
      EffectBus.on<{ atomizer: Atomizer }>('atomizer:registered', (payload) => {
        const atomizer = payload?.atomizer
        if (!atomizer?.atomizerId) return
        if (this.#atomizers.some(a => a.atomizerId === atomizer.atomizerId)) return
        this.#atomizers = [...this.#atomizers, atomizer]
        this.#render()
      }),

      // Which atomizer is currently "landed" — the only thing this does is
      // put the cyan ring on its row. Set-state, so a repeat is absorbed.
      EffectBus.on<{ atomizer: Atomizer }>('atomizer:dropped', (payload) => {
        this.#active = payload?.atomizer ?? null
        this.#render()
      }),

      // THE PIPE WAS IMPURE. The Angular original resolved its three strings
      // through the `t` pipe, declared `pure: false`, so every change-detection
      // tick re-read them and `/language ja` re-labelled an OPEN bar on the
      // spot — the title, the close button's aria-label and the empty line.
      // An element renders when it decides to, so the locale switch has to be
      // a reason to render, or an open bar freezes in the old language until
      // the next atomizer happens to register. Nothing here holds a caret, so
      // a full re-render is the cheapest correct answer.
      EffectBus.on('locale:changed', () => this.#render()),
    )

    // Hidden until the toggle says otherwise (replay delivers the live value
    // immediately if there already is one) — a toolbar that flashes on boot
    // is a regression.
    this.#render()
  }

  disconnectedCallback(): void {
    this.#offs.forEach(off => off())
    this.#offs = []
    this.#zoomOff?.()
    this.#zoomOff = null
    this.#bar = null
    this.#title = null
    this.#close = null
    this.#list = null
    this.#empty = null
    this.#rows.clear()
    this.replaceChildren()
    // #visible / #atomizers / #active deliberately survive: a surface the
    // host MOVES gets disconnect+connect, the seed re-reads IoC and
    // `atomizer-bar:toggle` replays on re-subscribe.
  }

  // ── the atomizer inventory ─────────────────────────────────────────────

  #seedFromIoc(): void {
    const keys = window.ioc?.list?.()
    if (!keys) return
    for (const key of keys) {
      if (!key.startsWith(ATOMIZER_IOC_PREFIX)) continue
      const atomizer = window.ioc?.get?.(key) as Atomizer | undefined
      if (!atomizer?.atomizerId) continue
      if (this.#atomizers.some(a => a.atomizerId === atomizer.atomizerId)) continue
      this.#atomizers = [...this.#atomizers, atomizer]
    }
  }

  // ── the three gestures out — each answers exactly once ─────────────────

  /** The only exit. Same three statements the component's `close()` ran, in
   *  the same order: fold away, forget the landed atomizer, and TELL THE
   *  SYSTEM — the emit is what makes the closed state survive a re-mount
   *  (it becomes the replayed last value) and what any other listener on
   *  `atomizer-bar:toggle` is waiting for. Exactly one emit per press; the
   *  bar has no other dismiss path (no backdrop, no Escape — see the
   *  keydown note at the foot of this file). */
  #closeBar(): void {
    this.#visible = false
    this.#active = null
    this.#render()
    EffectBus.emit('atomizer-bar:toggle', { active: false })
  }

  #onDragStart(event: DragEvent, atomizer: Atomizer): void {
    if (!event.dataTransfer) return

    event.dataTransfer.setData('application/x-atomizer-id', atomizer.atomizerId)
    event.dataTransfer.effectAllowed = 'copy'

    // Notify the system so drop targets can highlight (AtomizerDropWorker
    // #onDragStart walks the IoC target prefix and lights the matches).
    EffectBus.emit('atomizer:drag-start', {
      atomizerId: atomizer.atomizerId,
      targetTypes: atomizer.targetTypes,
    })
  }

  #onDragEnd(): void {
    EffectBus.emit('atomizer:drag-end', {})
  }

  // ── chrome (built once, detached) ──────────────────────────────────────
  #build(): void {
    if (this.#bar) return

    const bar = document.createElement('div')
    bar.className = 'atomizer-bar'

    const header = document.createElement('div')
    header.className = 'atomizer-bar-header'

    const title = document.createElement('span')
    title.className = 'atomizer-bar-title'

    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'atomizer-close-btn'
    close.addEventListener('click', () => { this.#closeBar() })

    const closeX = document.createElement('span')
    closeX.className = 'close-x'
    // U+00D7 — the template's `&times;`.
    closeX.textContent = '×'
    close.appendChild(closeX)

    header.append(title, close)

    const list = document.createElement('div')
    list.className = 'atomizer-list'

    // The empty line is built once and attached/detached by #render, the way
    // `@if (atomizers().length === 0)` did — it is the LAST child of the
    // list in the template, after the rows.
    const empty = document.createElement('div')
    empty.className = 'atomizer-empty'

    bar.append(header, list)

    // The `hcWidget` stamp, same id and anchor. Attached to the BAR (where
    // the directive sat), once — the node is only ever detached and
    // re-attached, never rebuilt, so there is nothing to re-stamp.
    this.#zoomOff = attachWidgetZoom(bar, WIDGET_ID, WIDGET_ANCHOR)

    this.#bar = bar
    this.#title = title
    this.#close = close
    this.#list = list
    this.#empty = empty
    // Built DETACHED — #render attaches the bar only when the toggle says
    // visible, so there is no transient flash on the way through mount.
  }

  /** One atomizer's row. Built once per atomizerId and then only MOVED —
   *  `name`, `description`, `icon` and `atomizerId` are all readonly on the
   *  Atomizer contract, so a row never needs re-labelling, and none of the
   *  four is translated (they come from the atomizer module as literals,
   *  exactly as `{{ atomizer.name }}` printed them). */
  #buildItem(atomizer: Atomizer): HTMLDivElement {
    const row = document.createElement('div')
    row.className = 'atomizer-item'
    row.draggable = true
    row.setAttribute('title', interpolate(atomizer.description))
    row.setAttribute('aria-label', interpolate(atomizer.name))
    row.addEventListener('dragstart', (event) => { this.#onDragStart(event, atomizer) })
    row.addEventListener('dragend', () => { this.#onDragEnd() })

    const icon = document.createElement('span')
    icon.className = 'atomizer-icon'
    // The template's `[innerHTML]="atomizer.icon"`. A DIRECT assignment here,
    // where Angular routed it through DomSanitizer — and that is a deliberate
    // divergence, because Angular's HTML sanitizer allowlist (VALID_ELEMENTS
    // in core's html_sanitizer) contains no SVG tags at all: `<svg>`, `<rect>`,
    // `<polygon>` were all stripped, so the icons never actually drew and the
    // strip showed bare names plus a dev-mode "sanitizing HTML stripped some
    // content" warning. The markup comes from an Atomizer registered in IoC —
    // a behavior module already executing in this page — so sanitizing it
    // buys nothing a signed module could not do directly anyway.
    icon.innerHTML = interpolate(atomizer.icon)

    const name = document.createElement('span')
    name.className = 'atomizer-name'
    name.textContent = interpolate(atomizer.name)

    row.append(icon, name)
    return row
  }

  // ── rendering (rebuild on change — the house pattern, no reconciler) ────
  #render(): void {
    const bar = this.#bar
    const title = this.#title
    const close = this.#close
    const list = this.#list
    const empty = this.#empty
    if (!bar || !title || !close || !list || !empty) return

    // `@if (visible())` — a truthiness test, so `!this.#visible` is its exact
    // complement for every value (unlike a `> 0` predicate, where negation
    // lets NaN fall through). Hidden means GONE, not `display:none`: the
    // template removed the whole strip, and `querySelector('.atomizer-bar')`
    // is the DOM contract a driver would assert on. Detaching rather than
    // rebuilding keeps the close button, every row and their drag listeners
    // alive.
    if (!this.#visible) {
      bar.remove()
      return
    }

    // Strings re-resolved on every render — this is what the impure pipe was
    // doing on every tick, and it is why `locale:changed` renders.
    title.textContent = t('atomizer.title', 'atomizers')
    close.setAttribute('aria-label', t('atomizer.close', 'close atomizer bar'))
    empty.textContent = t('atomizer.empty', 'no atomizers loaded')

    const atomizers = this.#atomizers
    const live = new Set(atomizers.map(a => a.atomizerId))

    // SWEEP DEPARTED ROWS BEFORE THE WALK, never during it. (Nothing
    // un-registers an atomizer today, but a Map that only ever grows is how a
    // leak gets written.)
    for (const [id, row] of this.#rows) {
      if (live.has(id)) continue
      row.remove()
      this.#rows.delete(id)
    }

    // Place the rows in data order by walking an ANCHOR and SKIPPING anything
    // already in place. `appendChild` on a node that already has a parent is a
    // REMOVE followed by an insert — which, on the row the pointer is dragging,
    // would abort the drag. insertBefore only where the order actually differs.
    let anchor: ChildNode | null = list.firstChild
    for (const atomizer of atomizers) {
      let row = this.#rows.get(atomizer.atomizerId)
      if (!row) {
        row = this.#buildItem(atomizer)
        this.#rows.set(atomizer.atomizerId, row)
      }
      // `[class.active]="activeAtomizer()?.atomizerId === atomizer.atomizerId"`
      // — mutating an existing node on a state update, not a reconciler.
      row.classList.toggle('active', this.#active?.atomizerId === atomizer.atomizerId)
      if (anchor === row) { anchor = row.nextSibling; continue }
      list.insertBefore(row, anchor)
    }

    // `@if (atomizers().length === 0)` — the ORIGINAL polarity, copied not
    // re-derived, and the node genuinely leaves the DOM when there are rows.
    if (atomizers.length === 0) list.appendChild(empty)
    else empty.remove()

    // Back in, if it was out. Moving a live node, never re-creating it.
    if (bar.parentNode !== this) this.appendChild(bar)
  }
}

// ── shell surface registration — the externalization path ────────────────
// Same name, same order band the Angular component held; the module-side
// `element:` shape (documentation/shell-surfaces.md). The SIDEBAR registers
// separately at 400, one band above — two surfaces, two registrations, never
// merged.
//
// NO KEYBOARD EXIT TO PORT. Neither atomizer component bound a key handler of
// any kind — no `@HostListener('document:keydown.escape')`, no raw
// `document.addEventListener('keydown', …)`. The close button is the only way
// out, and inventing an Escape here would hand this surface a shortcut the
// Escape cascade never gave it.
//
// DEFINED AT MODULE SCOPE, registered when a registry appears. A host with no
// ShellSurfaceRegistry (diamond-core-processor mounts tags directly in its own
// template) still needs the tag to be a real element rather than an inert
// unknown one — so the define cannot wait on the registry. Only the ADD does.
if (!customElements.get(SURFACE_NAME)) {
  customElements.define(SURFACE_NAME, AtomizerBarElement)
}

window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/AtomizerBarElement',
    element: SURFACE_NAME,
    order: 390,
  })
})
