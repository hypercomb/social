// icon-picker.view.ts — THE ICON CHOOSER, the searchable honeycomb of
// Material symbols, as a framework-free custom element
// (everything-is-a-beehavior Phase 2: Angular panels leave the shell and ship
// as signed modules).
//
// A straight port of shared/ui/icon-picker: same surface name
// (hc-icon-picker), same order band (250), the same one effect in
// (`icon:pick-request`) and the same two out (`icon:pick-result`,
// `icon:picker-open`). The participant sees the same frosted hive of
// hexagons, delivered as a module instead of compiled into the shell.
//
// THIS CLOSES THE ICON PROTOCOL. The contract (core/icon-pick.types.ts), the
// promise helper (core/icon-pick-request.ts), the override store
// (icon-overrides.store.ts, next door) and now the chooser all live outside
// the shell — the whole universal-icon protocol is module-delivered. Anything
// that wants an icon calls `requestIconPick()` and awaits; this surface is the
// other end of that promise.
//
// EVERY EXIT ANSWERS EXACTLY ONCE — the heart of this panel. `requestIconPick`
// subscribes to `icon:pick-result` filtered on a per-call token and then sits
// on an unresolved `await`. Four paths end a request: choosing a hexagon, the
// close button, the backdrop, and Escape — plus a fifth the participant never
// sees, a SECOND request arriving while one is open, which supersedes the
// first. All five go through `#settle`, which drops the pending request before
// it emits so a double-click cannot answer twice, and which is called on
// disconnect so a teardown never strands a caller. Never, or twice, are both
// silent hangs / double-applies with no error anywhere.
//
// AND THE RESULT IS TRANSIENT. `EffectBus.emitTransient`, never `emit`: a
// stored last value would replay into the NEXT request's freshly-subscribed
// listener and settle it before its chooser ever opened. The `#settled` token
// set is the mirror-image guard on the way in — `icon:pick-request` IS stored,
// so a replay (registry churn, a disconnect/reconnect, a remount) must not
// reopen a chooser whose caller was already answered.
//
// LIFECYCLE NOTE. The Angular template was one big `@if (open())`, so nothing
// existed in the DOM at rest. A registry-fed element is mounted ONCE at boot
// and stays, so the chrome is built DETACHED and attached only while a request
// is live — a full-screen backdrop that is merely `display:none` still answers
// `querySelector`, and one pointer-events slip from eating every click on the
// hive.
//
// Its strings ship WITH it (icon-picker.i18n.ts, extracted from all 14 shell
// catalogs) and register under the 'app' namespace, so every key resolves
// exactly as before — the Phase 2 catalog split, another slice.

import {
  EffectBus,
  I18N_IOC_KEY,
  ICON_OVERRIDES_KEY,
  ICON_PICKER_OPEN,
  ICON_PICK_REQUEST,
  ICON_PICK_RESULT,
  type I18nProvider,
  type IconOverridesProvider,
  type IconPickRequest,
  type IconPickResult,
  type IconPickerOpen,
} from '@hypercomb/core'
import { ICON_PICKER_TRANSLATIONS } from './icon-picker.i18n.js'
import { MATERIAL_ICON_NAMES } from './material-icon-names.js'

const SURFACE_NAME = 'hc-icon-picker'

/** `total` in the Angular component — the whole catalog, for the footer. */
const TOTAL = MATERIAL_ICON_NAMES.length

// Same contract as the shell pipe: params drive both pluralization
// (`key.one` / `key.other`, chosen on params.count by the i18n service) and
// `{token}` interpolation. The fallback is the English catalog text, and it
// interpolates the same tokens so a bare host with no i18n reads identically.
// (`icon-picker.count` takes a count param but has NO plural variants in any
// of the 14 catalogs — the service checks `.one`/`.other` first and falls
// through to the bare key, which is exactly what the pipe did.)
const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
  const value = i18n?.t(key, params)
  if (value && value !== key) return value
  if (!params) return fallback
  return fallback.replace(/\{(\w+)\}/g, (whole, token: string) =>
    token in params ? String(params[token]) : whole)
}

// The chooser's seven strings travel with it — registered as soon as the i18n
// service is up, under 'app' so the keys resolve exactly as they always did.
window.ioc?.whenReady?.(I18N_IOC_KEY, (i18n) => {
  const provider = i18n as I18nProvider
  for (const [locale, catalog] of Object.entries(ICON_PICKER_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

// ── the styles the Angular SCSS carried, expanded to plain CSS ────────────
// No shadow DOM (the tutorial-overlay + landing-badge + confirm-dialog
// precedent), so Angular's `:host` becomes the tag name and every other
// selector is prefixed with it — nothing leaks out of the chooser. SCSS
// nesting is flattened (`.ip-search-field:focus-within &` becomes the full
// descendant selector), the one SCSS variable is expanded to its literal
// (`$steel: rgb(126, 182, 214)`, so `rgba($steel, .4)` →
// `rgba(126,182,214,.4)`), and the `var(--hc-…)` / `var(--md-…)` custom
// properties are left exactly as they were.
//
// Angular's build autoprefixed; a hand-written sheet does not, so both
// `backdrop-filter` rules carry their `-webkit-` twin — without it the frost
// silently disappears on Safari/iOS, where this modal is the ONLY way to pick
// an icon on a touch device.
//
// There are no keyframes and no media queries in the original, so there is
// nothing to rename into the tag's namespace and no breakpoint mixin to
// expand. The two z-indexes (100010 / 100011) sit above every piece of shell
// chrome (header 60000 is the highest) and above the confirm dialog
// (100000/100001) on purpose: the chooser can be raised FROM a dialog.
const CSS = `
${SURFACE_NAME}{display:contents}
${SURFACE_NAME} .icon-picker-backdrop{position:fixed;inset:0;z-index:100010;background:rgba(4,6,10,.55);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px)}
${SURFACE_NAME} .icon-picker{position:fixed;z-index:100011;left:50%;top:50%;transform:translate(-50%,-50%);width:min(560px,calc(100vw - 2rem));max-height:min(70vh,640px);display:flex;flex-direction:column;background:color-mix(in srgb,var(--md-surface-c-low,#0e1118) 96%,transparent);-webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px);border:1px solid rgba(126,182,214,.4);border-radius:var(--hc-radius-floating);box-shadow:0 24px 70px rgba(0,0,0,.6),0 0 0 1px rgba(126,182,214,.06) inset;color:#eef3f8;font-family:var(--hc-mono,system-ui);padding:.9rem 1rem .75rem}
${SURFACE_NAME} .icon-picker .mat-sym{font-family:'Material Symbols Outlined';font-weight:normal;line-height:1}
${SURFACE_NAME} .ip-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:.7rem}
${SURFACE_NAME} .ip-title{font-size:.68rem;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:rgba(206,224,240,.55)}
${SURFACE_NAME} .ip-close{background:none;border:none;padding:0;color:rgba(226,235,244,.55);cursor:pointer;display:inline-flex;transition:color 120ms ease}
${SURFACE_NAME} .ip-close .mat-sym{font-size:1.15rem}
${SURFACE_NAME} .ip-close:hover{color:#fff}
${SURFACE_NAME} .ip-search-field{display:flex;align-items:center;gap:.5rem;padding:0 .55rem;margin-bottom:.85rem;background:rgba(255,255,255,.035);border:1px solid rgba(126,182,214,.2);border-radius:var(--hc-radius-control);transition:border-color 130ms ease,background 130ms ease}
${SURFACE_NAME} .ip-search-field:focus-within{border-color:rgba(126,182,214,.55);background:rgba(126,182,214,.05)}
${SURFACE_NAME} .ip-search-glyph{font-size:1.05rem;color:rgba(126,182,214,.55);flex-shrink:0;transition:color 130ms ease}
${SURFACE_NAME} .ip-search-field:focus-within .ip-search-glyph{color:rgba(126,182,214,.85)}
${SURFACE_NAME} .ip-search{flex:1;min-width:0;font-family:inherit;font-size:.85rem;color:#eef3f8;background:transparent;border:none;outline:none;padding:.5rem 0;caret-color:rgb(126,182,214)}
${SURFACE_NAME} .ip-search::placeholder{color:rgba(226,235,244,.3)}
${SURFACE_NAME} .ip-search-clear{flex-shrink:0;display:inline-flex;align-items:center;padding:.1rem;background:none;border:none;border-radius:50%;cursor:pointer;color:rgba(226,235,244,.4);transition:color 120ms ease,background 120ms ease}
${SURFACE_NAME} .ip-search-clear .mat-sym{font-size:.95rem}
${SURFACE_NAME} .ip-search-clear:hover{color:#fff;background:rgba(255,255,255,.08)}
${SURFACE_NAME} .ip-hive{flex:1;min-height:0;display:flex;flex-wrap:wrap;gap:.28rem;align-content:flex-start;justify-content:center;overflow-y:auto;padding:.2rem;scrollbar-width:thin;scrollbar-color:rgba(126,182,214,.25) transparent}
${SURFACE_NAME} .ip-hex{flex:0 0 auto;width:2.6rem;height:2.85rem;padding:0;clip-path:polygon(25% 5%,75% 5%,100% 50%,75% 95%,25% 95%,0 50%);background:rgba(126,182,214,.1);border:none;display:flex;align-items:center;justify-content:center;color:rgba(226,235,244,.82);cursor:pointer;transition:background 120ms ease,color 120ms ease}
${SURFACE_NAME} .ip-hex .mat-sym{font-size:1.25rem}
${SURFACE_NAME} .ip-hex:hover{background:rgba(126,182,214,.3);color:#fff}
${SURFACE_NAME} .ip-hex:focus-visible{outline:1px solid rgba(126,182,214,.7);outline-offset:-2px}
${SURFACE_NAME} .ip-empty{width:100%;padding:1.6rem 1rem;display:flex;flex-direction:column;align-items:center;gap:.45rem;text-align:center;color:rgba(226,235,244,.45);font-size:.8rem}
${SURFACE_NAME} .ip-empty .mat-sym{font-size:1.6rem;opacity:.55}
${SURFACE_NAME} .ip-foot{display:flex;justify-content:flex-end;margin-top:.6rem;padding-top:.55rem;border-top:1px solid rgba(126,182,214,.12)}
${SURFACE_NAME} .ip-count{font-size:.6rem;letter-spacing:.1em;text-transform:uppercase;color:rgba(206,224,240,.4);font-variant-numeric:tabular-nums}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-icon-picker', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

/** `<span class="mat-sym">name</span>` — Material Symbols render by ligature,
 *  so the glyph IS the text. Every decorative one in the template carried
 *  `aria-hidden="true"`; the HEXAGONS' glyphs did not (the button already
 *  carries the icon name as its aria-label, and a double reading is what
 *  aria-hidden exists to prevent) — hence the flag, copied per call site
 *  rather than assumed. */
const matSym = (ligature: string, ariaHidden = true): HTMLSpanElement => {
  const span = document.createElement('span')
  span.className = 'mat-sym'
  span.textContent = ligature
  if (ariaHidden) span.setAttribute('aria-hidden', 'true')
  return span
}

/** The chooser's nodes, minted together in #build and kept for the element's
 *  whole life. The search input is the one that MUST persist (rebuilding it
 *  would drop the caret out from under someone mid-word), and the rest ride
 *  along so one null check covers the lot. Only the hexagons are rebuilt. */
type Chrome = {
  backdrop: HTMLDivElement
  panel: HTMLDivElement
  title: HTMLSpanElement
  close: HTMLButtonElement
  field: HTMLDivElement
  input: HTMLInputElement
  clear: HTMLButtonElement
  hive: HTMLDivElement
  empty: HTMLDivElement
  emptyLabel: HTMLSpanElement
  count: HTMLSpanElement
}

export class IconPickerElement extends HTMLElement {

  /** Everything connectedCallback wired, torn down in one sweep. */
  #offs: Array<() => void> = []

  /** Chrome, built once and kept — see the type above. */
  #chrome: Chrome | null = null

  /** `open()` in the Angular component. */
  #open = false

  /** `filter()` — the raw search text, seeded per request. Lives HERE, not in
   *  the input's value: the DOM is a projection, never the truth. */
  #filter = ''

  /** `title()` — the requester's own heading, or null for the default one. */
  #title: string | null = null

  /** The request currently on screen, or null when the chooser is closed.
   *  Held whole (not as loose fields) so settling it is one atomic step. */
  #pending: IconPickRequest | null = null

  /** Tokens already settled — `icon:pick-request` carries a last value, so a
   *  chooser that remounts (registry reorder MOVES the node, which is a real
   *  disconnect + reconnect) would otherwise see the last request again and
   *  reopen on a caller who has already been answered. Deliberately NOT
   *  cleared on disconnect — surviving the re-subscribe is the whole point.
   *  An UNSETTLED request does come back on replay, which is correct: its
   *  caller is still awaiting. */
  readonly #settled = new Set<string>()

  /** The normalized filter the hexagons currently reflect, or null when they
   *  reflect nothing. The hive holds up to ~280 buttons and none of them
   *  carries a translated string (a ligature name is a ligature name in every
   *  locale), so a locale re-render must NOT rebuild them: it would reset the
   *  scroll position and drop focus out of anyone tabbing the grid. One string
   *  compare, not a reconciler. */
  #hiveFilter: string | null = null

  connectedCallback(): void {
    installCss()
    this.#build()

    this.#offs.push(
      // Last-value replay means a late mount still receives a request that is
      // already outstanding — there is no catch-up to write here, only the
      // #settled guard against an ALREADY-ANSWERED one coming back.
      EffectBus.on<IconPickRequest>(ICON_PICK_REQUEST, (req) => {
        const id = req?.id
        if (!id) return
        if (req.token && this.#settled.has(req.token)) return   // replayed, already answered
        // A second request while one is open supersedes it — settle the first
        // as cancelled so its awaiter never hangs.
        this.#settle(null)
        this.#pending = req
        this.#filter = typeof req.filter === 'string' ? req.filter : ''
        this.#title = typeof req.title === 'string' && req.title.trim() ? req.title : null
        const wasOpen = this.#open
        this.#open = true
        EffectBus.emit<IconPickerOpen>(ICON_PICKER_OPEN, { open: true })
        // Capture-phase so our Escape closes the picker BEFORE the edit-mode
        // Escape handler (which would otherwise also exit edit mode). Adding
        // the same function reference twice is a no-op, so a superseding
        // request cannot stack listeners.
        document.addEventListener('keydown', this.#onKey, true)
        this.#render()
        // The template's `autofocus`. It only fires for a node ENTERING the
        // document, and this input is a live node moved back in, so the
        // attribute alone would focus it once per page rather than once per
        // opening — the search box is the entire point of the surface, so it
        // is focused explicitly, and only on the closed→open transition (a
        // superseding request left the DOM in place, so Angular's `@if`
        // re-ran no autofocus either).
        if (!wasOpen) this.#chrome?.input.focus()
      }),

      // THE PIPE WAS IMPURE. The Angular template resolved every string
      // through `| t`, declared `pure: false`, so every change-detection tick
      // re-read them and `/language ja` re-labelled an OPEN chooser on the
      // spot. An element renders when it decides to — and this one can sit
      // open indefinitely, since it is BLOCKING an await. Without this, a
      // locale switch would leave the heading, the placeholder, the empty
      // message, the count and all four aria-labels frozen in the previous
      // language.
      EffectBus.on('locale:changed', () => this.#render()),
    )

    this.#render()
  }

  disconnectedCallback(): void {
    // NEVER STRAND AN AWAITING CALLER — the ngOnDestroy line, first. #close
    // settles the pending request as cancelled, drops the key listener, and
    // publishes `{ open: false }` so nothing is left believing a chooser is
    // still up over the hive.
    this.#close()
    // Belt: a request captured but never opened (impossible today, since the
    // two happen in one tick) still gets its answer. A no-op once #close ran.
    this.#settle(null)
    this.#offs.forEach(off => off())
    this.#offs = []
    // Unconditional, exactly as ngOnDestroy had it — #close early-returns
    // when the chooser was already shut and would not have removed it. SAME
    // function reference that added it, or the removal silently fails.
    document.removeEventListener('keydown', this.#onKey, true)
    // Take the chrome out and drop it; #build remints it on reconnect.
    this.#chrome = null
    this.#hiveFilter = null
    this.replaceChildren()
  }

  // ── chrome (built once, DETACHED) ────────────────────────────────────
  // Angular's `@if (open())` meant none of this existed in the DOM at rest,
  // and this surface is mounted at boot and never unmounted — so it is built
  // detached and #render attaches/detaches it. `replaceChildren`/`append`
  // MOVE an existing node, so every listener wired here survives every
  // show/hide cycle.
  #build(): void {
    if (this.#chrome) return

    const backdrop = document.createElement('div')
    backdrop.className = 'icon-picker-backdrop'
    backdrop.addEventListener('click', () => this.#close())

    const panel = document.createElement('div')
    panel.className = 'icon-picker'
    panel.setAttribute('role', 'dialog')

    // ── header
    const head = document.createElement('div')
    head.className = 'ip-head'
    const title = document.createElement('span')
    title.className = 'ip-title'
    const close = document.createElement('button')
    close.className = 'ip-close'
    close.type = 'button'
    close.addEventListener('click', () => this.#close())
    close.append(matSym('close'))
    head.append(title, close)

    // ── search field
    const field = document.createElement('div')
    field.className = 'ip-search-field'
    const glyph = matSym('search')
    glyph.classList.add('ip-search-glyph')
    const input = document.createElement('input')
    input.className = 'ip-search'
    input.type = 'text'
    input.autocomplete = 'off'
    input.setAttribute('autocapitalize', 'off')
    input.setAttribute('autocorrect', 'off')
    input.setAttribute('spellcheck', 'false')
    input.setAttribute('autofocus', '')
    input.addEventListener('input', (e) => {
      this.#filter = (e.target as HTMLInputElement)?.value ?? ''
      this.#render()
    })
    // The template's `@if (filter().length > 0)` clear button — built here,
    // attached to the field by #render only while there is something to clear.
    const clear = document.createElement('button')
    clear.className = 'ip-search-clear'
    clear.type = 'button'
    clear.append(matSym('close'))
    clear.addEventListener('click', () => {
      // `clearFilter(searchEl)`: clear, then put the caret back in the box.
      // Render FIRST — it detaches this very button, and a focused node being
      // removed blurs to <body>, which would undo the focus if it came first.
      this.#filter = ''
      this.#render()
      this.#chrome?.input.focus()
    })
    field.append(glyph, input)

    // ── hive + its `@empty` block
    const hive = document.createElement('div')
    hive.className = 'ip-hive'
    const empty = document.createElement('div')
    empty.className = 'ip-empty'
    const emptyLabel = document.createElement('span')
    empty.append(matSym('search_off'), emptyLabel)

    // ── footer
    const foot = document.createElement('div')
    foot.className = 'ip-foot'
    const count = document.createElement('span')
    count.className = 'ip-count'
    foot.append(count)

    panel.append(head, field, hive, foot)

    this.#chrome = { backdrop, panel, title, close, field, input, clear, hive, empty, emptyLabel, count }
  }

  // ── rendering (rebuild-on-change — state lives here, never in the DOM) ─
  #render(): void {
    const chrome = this.#chrome
    if (!chrome) return

    // The template's own predicate — `@if (open())` — kept in its POSITIVE
    // direction. Do not re-derive it by negating something else: this guard is
    // the difference between a hidden chooser and a black sheet over the whole
    // hive that eats every click.
    if (!this.#open) {
      chrome.backdrop.remove()
      chrome.panel.remove()
      return
    }

    // The generic key, ALWAYS — the panel's aria-label was
    // `'icon-picker.title' | t` even when the requester supplied a heading.
    const defaultTitle = t('icon-picker.title', 'choose an icon')
    chrome.panel.setAttribute('aria-label', defaultTitle)
    // …and the visible heading is `title() ?? default`, so a window can say
    // what it is choosing an icon FOR ("Add a note mark").
    chrome.title.textContent = this.#title ?? defaultTitle
    chrome.close.setAttribute('aria-label', t('icon-picker.close', 'close'))

    chrome.input.setAttribute('placeholder', t('icon-picker.search-placeholder', 'search icons…'))
    chrome.input.setAttribute('aria-label', t('icon-picker.search-label', 'search icons'))
    // `[value]="filter()"` — the input is a projection of #filter. Written
    // only when it actually differs so typing never disturbs its own caret.
    if (chrome.input.value !== this.#filter) chrome.input.value = this.#filter
    chrome.clear.setAttribute('aria-label', t('icon-picker.clear-search', 'clear search'))

    // `icons()`, the computed: trim + lowercase, substring match.
    const needle = this.#filter.trim().toLowerCase()
    const icons = needle ? MATERIAL_ICON_NAMES.filter(n => n.includes(needle)) : MATERIAL_ICON_NAMES

    // `@if (filter().length > 0)` — positive direction, both times it is used.
    if (this.#filter.length > 0) {
      if (chrome.clear.parentNode !== chrome.field) chrome.field.append(chrome.clear)
      chrome.count.textContent = `${icons.length} / ${TOTAL}`
    } else {
      chrome.clear.remove()
      chrome.count.textContent = t('icon-picker.count', '{count} icons', { count: TOTAL })
    }

    // The `@empty` block's text, resolved every render whether or not it is
    // showing — that is what makes a locale switch relabel it without the
    // hexagons underneath being rebuilt.
    chrome.emptyLabel.textContent = t('icon-picker.empty', 'no icons match "{query}"', { query: this.#filter })

    this.#paintHive(chrome, needle, icons)

    // Back in, if it was out — moving live nodes, never re-creating them, so
    // the listeners wired in #build stay attached.
    if (chrome.backdrop.parentNode !== this || chrome.panel.parentNode !== this) {
      this.replaceChildren(chrome.backdrop, chrome.panel)
    }
  }

  /** The `@for (name of icons(); track name)` loop. Rebuilt whole whenever the
   *  search changes — the house pattern, no diffing — and skipped entirely
   *  when it would produce the same hexagons it already holds (see
   *  #hiveFilter). */
  #paintHive(chrome: Chrome, needle: string, icons: readonly string[]): void {
    if (this.#hiveFilter === needle) return
    this.#hiveFilter = needle

    if (icons.length === 0) {
      chrome.hive.replaceChildren(chrome.empty)
      return
    }

    const hexes = icons.map((name) => {
      const hex = document.createElement('button')
      hex.className = 'ip-hex'
      hex.type = 'button'
      hex.title = name
      hex.setAttribute('aria-label', name)
      hex.append(matSym(name, false))   // the template left this one readable
      hex.addEventListener('click', () => this.#choose(name))
      return hex
    })
    chrome.hive.replaceChildren(...hexes)
  }

  // ── the five exits, all of them through #settle ───────────────────────

  /** A hexagon: answer with the name, then shut. `#close` settles again and
   *  finds nothing pending — the double-answer guard doing its job. */
  #choose(name: string): void {
    this.#settle(name)
    this.#close()
  }

  /** The close button, the backdrop, Escape, and the tail of every pick. */
  #close(): void {
    if (!this.#open) return
    this.#settle(null)          // closing without a pick IS a cancellation
    this.#open = false
    this.#title = null
    EffectBus.emit<IconPickerOpen>(ICON_PICKER_OPEN, { open: false })
    document.removeEventListener('keydown', this.#onKey, true)
    this.#render()
  }

  /** Answer the outstanding request exactly once. `name` null = cancelled.
   *  In write-through mode (the default) the pick also lands in the icon
   *  override store, which is what makes every surface re-resolve live.
   *
   *  Dropping `#pending` BEFORE the emit is what makes "exactly once" true:
   *  a second click on a chooser that is already closing finds nothing to
   *  settle and returns.
   *
   *  Emitted TRANSIENTLY: a completion signal stored as EffectBus's last
   *  value would replay into the next request's listener and settle it
   *  before the chooser even opened. */
  #settle(name: string | null): void {
    const req = this.#pending
    if (!req) return
    this.#pending = null
    if (req.token) this.#settled.add(req.token)
    if (name && req.store !== false) {
      (window.ioc?.get?.(ICON_OVERRIDES_KEY) as IconOverridesProvider | undefined)?.set(req.id, name)
    }
    EffectBus.emitTransient<IconPickResult>(ICON_PICK_RESULT, { id: req.id, token: req.token, name })
  }

  /** Capture-phase Escape. Held as ONE arrow-function field so add and remove
   *  pass the identical reference — a fresh bound function on removal fails
   *  silently and leaves a document listener behind forever. */
  #onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopImmediatePropagation()
      e.preventDefault()
      this.#close()
    }
  }
}

// ── shell surface registration — the externalization path ────────────────
// Same name, same order band the Angular component held; the module-side
// `element:` shape (documentation/shell-surfaces.md).
// DEFINED AT MODULE SCOPE, registered when a registry appears. A host
// with no ShellSurfaceRegistry (diamond-core-processor mounts this tag
// directly in its own template) still needs the tag to be a real element
// rather than an inert unknown one — so the define cannot wait on the
// registry. Only the ADD does.
if (!customElements.get(SURFACE_NAME)) {
  customElements.define(SURFACE_NAME, IconPickerElement)
}

window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/IconPickerElement',
    element: SURFACE_NAME,
    order: 250,
  })
})
