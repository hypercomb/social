// shortcut-sheet.view.ts — THE REFERENCE SHEET, the /help overlay that lists
// every slash command, every command-line operation and every keyboard
// shortcut the runtime currently answers to, as a framework-free custom
// element (everything-is-a-beehavior Phase 2: Angular panels leave the shell
// and ship as signed modules).
//
// A straight port of shared/ui/shortcut-sheet: same surface name
// (hc-shortcut-sheet), same order band (300), the same one effect in
// (`shortcut-sheet:state`, plus `keymap:invoke` for the Escape exit) and the
// same one effect out (`shortcut-sheet:close`). The participant sees the same
// frosted card, delivered as a module instead of compiled into the shell.
//
// IT LANDS BESIDE ITS DRONE. `shortcut-sheet.drone.ts` (next door) owns all of
// the data and all of the state: it toggles on the `ui.shortcutSheet` chord,
// introspects SlashBehaviourDrone / CommandLineBehaviors / KeyMapService at
// OPEN time, suppresses the keymap, locks the InputGate, and publishes the
// whole `ShortcutSheetState` over the bus. This file has NO business logic —
// it filters what it was handed and paints it. That split is why the port is
// a rewrite of markup only.
//
// THE CHORDS ARE FORMATTED BY CORE, NOT HERE. `formatChord` (core/
// keymap-format.ts) is the single spelling of a key chord — platform-aware
// (⌘ vs Ctrl), with the same glyph table the command palette and the keymap
// editor read. Re-implementing key rendering in a view is how two spellings
// of the same shortcut end up on screen; there is exactly one, and it is
// imported.
//
// LIFECYCLE NOTE. The Angular template was one big `@if (open())`, so nothing
// existed in the DOM at rest. A registry-fed element is mounted ONCE at boot
// and stays, so the chrome is built DETACHED and attached only while the sheet
// is open — a full-screen backdrop that is merely `display:none` still answers
// `querySelector`, and one `pointer-events` slip from eating every click on
// the hive.
//
// Its strings ship WITH it (shortcut-sheet.i18n.ts, extracted from all 14
// shell catalogs) and register under the 'app' namespace, so every key
// resolves exactly as before — the Phase 2 catalog split, another slice. The
// per-binding descriptions are NOT its strings: `binding.descriptionKey`
// belongs to whoever declared the binding, and is resolved (never extracted)
// here.

import {
  attachWidgetZoom,
  EffectBus,
  formatChord,
  I18N_IOC_KEY,
  type CommandLineOperationEntry,
  type I18nProvider,
  type KeyBinding,
  type ShortcutGroup,
  type ShortcutSheetState,
  type SlashCommandEntry,
} from '@hypercomb/core'
import { SHORTCUT_SHEET_TRANSLATIONS } from './shortcut-sheet.i18n.js'

const SURFACE_NAME = 'hc-shortcut-sheet'

/** The widget-zoom id and anchor the Angular template stamped
 *  (`hcWidget="shortcut-sheet" anchor="center"`). BOTH are part of the
 *  participant's persisted scale — the id keys `hc:widget-scale`, so changing
 *  either would orphan a sheet somebody had already sized to their liking. */
const WIDGET_ID = 'shortcut-sheet'
const WIDGET_ANCHOR = 'center' as const

// Same contract as the shell pipe: params drive both pluralization
// (`key.one` / `key.other`, chosen on params.count by the i18n service) and
// `{token}` interpolation. The fallback is the English catalog text, and it
// interpolates the same tokens so a bare host with no i18n reads identically.
// None of this sheet's eight keys takes a param or has plural variants in any
// of the 14 catalogs — the params arm is here for parity with the house
// helper, not because anything uses it.
const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
  const value = i18n?.t(key, params)
  if (value && value !== key) return value
  if (!params) return fallback
  return fallback.replace(/\{(\w+)\}/g, (whole, token: string) =>
    token in params ? String(params[token]) : whole)
}

// The sheet's eight strings travel with it — registered as soon as the i18n
// service is up, under 'app' so the keys resolve exactly as they always did.
window.ioc?.whenReady?.(I18N_IOC_KEY, (i18n) => {
  const provider = i18n as I18nProvider
  for (const [locale, catalog] of Object.entries(SHORTCUT_SHEET_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

// ── the styles the Angular SCSS carried, expanded to plain CSS ────────────
// No shadow DOM (the tutorial-overlay + landing-badge + icon-picker
// precedent), so Angular's `:host` becomes the tag name and every other
// selector is prefixed with it — nothing leaks out of the sheet. SCSS nesting
// is flattened (`.sheet-filter input { &:focus }` becomes the full descendant
// selector), and the `var(--hc-…)` custom properties are left exactly as they
// were.
//
// The two breakpoint mixins are expanded to their literal queries from
// shared/ui/_breakpoints.scss — `tablet-only` is
// `(min-width: 600px) and (max-width: 1023px)` ($bp-tablet-land - 1) and
// `phone-only` is `(max-width: 599px)` ($bp-phone-max). Note it is
// `phone-only`, NOT the `phone` (short-axis) mixin: a landscape phone keeps
// the centred card, exactly as before.
//
// Angular's build autoprefixed; a hand-written sheet does not, so both
// `backdrop-filter` rules carry their `-webkit-` twin — without it the frost
// silently disappears on Safari/iOS and the reference sheet reads as a flat
// slab over an unblurred hive.
//
// All three @keyframes are renamed into the tag's namespace
// (`hc-shortcut-sheet-…`): a document-level sheet shares ONE global animation
// namespace, and `sheet-panel-enter` is exactly the kind of name a second
// panel would also pick.
//
// The z-indexes (100000 / 100001) are unchanged: above every piece of shell
// chrome (header 60000 is the highest) and below the icon picker
// (100010/100011), which can be raised from on top of a dialog.
const CSS = `
${SURFACE_NAME}{display:contents}
${SURFACE_NAME} .sheet-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.72);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);z-index:100000;animation:hc-shortcut-sheet-backdrop-enter 200ms ease forwards}
${SURFACE_NAME} .sheet-panel{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:100001;width:min(92vw,36rem);max-height:82vh;display:flex;flex-direction:column;background:rgba(14,18,24,.92);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.08);border-radius:var(--hc-radius-floating);box-shadow:0 12px 48px rgba(0,0,0,.7);color:rgba(245,245,245,.85);font-family:var(--hc-mono);animation:hc-shortcut-sheet-panel-enter 300ms cubic-bezier(0.16,1,0.3,1) forwards}
${SURFACE_NAME} .sheet-header{display:flex;align-items:center;justify-content:space-between;padding:.7rem 1rem;border-bottom:1px solid rgba(255,255,255,.06)}
${SURFACE_NAME} .sheet-header h3{font-size:.68rem;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:rgba(245,245,245,.5);margin:0}
${SURFACE_NAME} .sheet-close{display:flex;align-items:center;justify-content:center;width:1.5rem;height:1.5rem;background:none;border:none;border-radius:3px;color:rgba(245,245,245,.3);font-size:1rem;cursor:pointer;transition:color 150ms ease,background 150ms ease}
${SURFACE_NAME} .sheet-close:hover{color:whitesmoke;background:rgba(255,255,255,.08)}
${SURFACE_NAME} .sheet-filter{padding:.55rem 1rem .5rem;border-bottom:1px solid rgba(255,255,255,.05)}
${SURFACE_NAME} .sheet-filter input{width:100%;padding:.42rem .6rem;font-family:inherit;font-size:.72rem;color:rgba(245,245,245,.88);background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:4px;outline:none;transition:border-color 150ms ease,background 150ms ease}
${SURFACE_NAME} .sheet-filter input::placeholder{color:rgba(245,245,245,.3)}
${SURFACE_NAME} .sheet-filter input:focus{border-color:rgba(200,151,90,.35);background:rgba(255,255,255,.06)}
${SURFACE_NAME} .sheet-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:.65rem 1rem .85rem;display:flex;flex-direction:column;gap:.9rem}
${SURFACE_NAME} .sheet-body::-webkit-scrollbar{width:4px}
${SURFACE_NAME} .sheet-body::-webkit-scrollbar-track{background:transparent}
${SURFACE_NAME} .sheet-body::-webkit-scrollbar-thumb{background:rgba(255,255,255,.08);border-radius:2px}
${SURFACE_NAME} .sheet-section{min-width:0}
${SURFACE_NAME} .section-title{font-size:.58rem;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#c8975a;margin:0 0 .35rem;padding-bottom:.22rem;border-bottom:1px solid rgba(200,151,90,.14)}
${SURFACE_NAME} .shortcut-subgroup{margin-top:.5rem}
${SURFACE_NAME} .shortcut-subgroup:first-of-type{margin-top:.15rem}
${SURFACE_NAME} .subgroup-title{font-size:.54rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:rgba(245,245,245,.38);margin:0 0 .22rem}
${SURFACE_NAME} .section-list{display:flex;flex-direction:column;gap:0}
${SURFACE_NAME} .sheet-row{display:flex;justify-content:space-between;align-items:center;padding:.3rem .45rem;gap:1rem;border-radius:3px;transition:background 100ms ease}
${SURFACE_NAME} .sheet-row:hover{background:rgba(255,255,255,.03)}
${SURFACE_NAME} .row-primary{display:flex;align-items:center;gap:.35rem;flex-shrink:0;min-width:0}
${SURFACE_NAME} .row-desc{font-size:.72rem;color:rgba(245,245,245,.55);min-width:0;text-align:right}
${SURFACE_NAME} .slash-name{font-size:.74rem;font-weight:600;color:rgba(245,245,245,.88)}
${SURFACE_NAME} .slash-alias{font-size:.68rem;color:rgba(245,245,245,.35);padding:.05rem .3rem;border:1px solid rgba(255,255,255,.08);border-radius:3px}
${SURFACE_NAME} .cli-example{font-family:inherit;font-size:.7rem;color:rgba(200,151,90,.82);padding:.1rem .38rem;background:rgba(200,151,90,.08);border:1px solid rgba(200,151,90,.18);border-radius:3px;white-space:nowrap}
${SURFACE_NAME} .trigger-badge{display:inline-flex;align-items:center;padding:.1rem .42rem;font-size:.62rem;font-weight:500;font-family:inherit;color:rgba(245,245,245,.55);background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:3px;letter-spacing:.03em}
${SURFACE_NAME} .shortcut-keys{display:flex;align-items:center;gap:.2rem;flex-shrink:0}
${SURFACE_NAME} .key-badge{display:inline-flex;align-items:center;justify-content:center;padding:.12rem .38rem;min-width:1.3rem;height:1.3rem;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:3px;font-size:.62rem;font-weight:600;font-family:inherit;color:rgba(245,245,245,.65)}
${SURFACE_NAME} .chord-sep{font-size:.55rem;color:rgba(245,245,245,.25);margin:0 .15rem;font-style:italic}
${SURFACE_NAME} .sheet-empty{padding:1.5rem .5rem;text-align:center;font-size:.72rem;color:rgba(245,245,245,.3);letter-spacing:.02em}
@keyframes hc-shortcut-sheet-backdrop-enter{from{opacity:0}to{opacity:1}}
@keyframes hc-shortcut-sheet-panel-enter{from{opacity:0;transform:translate(-50%,-50%) scale(.96)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
@keyframes hc-shortcut-sheet-panel-enter-phone{from{opacity:0;transform:translateY(100%)}to{opacity:1;transform:translateY(0)}}
@media (min-width:600px) and (max-width:1023px){
${SURFACE_NAME} .sheet-panel{width:min(88vw,34rem)}
${SURFACE_NAME} .sheet-close{width:2.2rem;height:2.2rem}
${SURFACE_NAME} .sheet-row{padding:.4rem .45rem;min-height:2.5rem}
${SURFACE_NAME} .row-desc{font-size:.76rem}
}
@media (max-width:599px){
${SURFACE_NAME} .sheet-panel{top:auto;bottom:0;left:0;right:0;transform:none;width:100%;max-height:88vh;border-radius:var(--hc-radius-floating) var(--hc-radius-floating) 0 0;padding-bottom:var(--hc-safe-bottom,0px);animation:hc-shortcut-sheet-panel-enter-phone 250ms cubic-bezier(0.16,1,0.3,1) forwards}
${SURFACE_NAME} .sheet-header{padding:.8rem 1rem}
${SURFACE_NAME} .sheet-header h3{font-size:.72rem}
${SURFACE_NAME} .sheet-close{width:2.5rem;height:2.5rem;font-size:1.1rem}
${SURFACE_NAME} .sheet-filter input{font-size:.85rem;padding:.5rem .65rem}
${SURFACE_NAME} .sheet-row{padding:.5rem .45rem;min-height:2.8rem;flex-wrap:wrap}
${SURFACE_NAME} .row-desc{font-size:.8rem;text-align:left;flex-basis:100%}
${SURFACE_NAME} .row-primary{flex-wrap:wrap}
${SURFACE_NAME} .key-badge{font-size:.65rem;min-width:1.4rem;height:1.4rem}
${SURFACE_NAME} .section-title{font-size:.62rem}
}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-shortcut-sheet', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

/** `<tag class="…">text</tag>` — the template is almost entirely spans, and
 *  spelling out three lines per span would bury the structure. */
const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K, className: string, text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** The empty state the drone hands back when nothing is registered yet — the
 *  same shape `fromRuntime`'s initial read produced in the Angular component. */
const EMPTY_STATE: ShortcutSheetState = {
  open: false,
  slashCommands: [],
  commandLineOps: [],
  shortcutGroups: [],
}

/** The nodes minted once in #build and kept for the element's whole life. The
 *  filter INPUT is the one that genuinely must persist — it holds the caret
 *  and the participant is typing into it — and the rest ride along so a single
 *  null check covers the lot. Only `body`'s CHILDREN are rebuilt. */
type Chrome = {
  backdrop: HTMLDivElement
  panel: HTMLDivElement
  title: HTMLHeadingElement
  close: HTMLButtonElement
  input: HTMLInputElement
  body: HTMLDivElement
}

export class ShortcutSheetElement extends HTMLElement {

  /** Everything connectedCallback wired, torn down in one sweep. */
  #offs: Array<() => void> = []

  /** attachWidgetZoom's teardown — its own handle, because the panel it scales
   *  outlives any single open/close cycle. */
  #zoomOff: (() => void) | null = null

  /** Chrome, built once and kept — see the type above. */
  #chrome: Chrome | null = null

  /** `state$()` — everything the drone published, held whole. */
  #state: ShortcutSheetState = EMPTY_STATE

  /** `open()`, mirrored so the closed→open TRANSITION is detectable (Angular's
   *  `effect()` only re-ran when the computed actually changed value). */
  #open = false

  /** `query()` — the raw filter text. Lives HERE, not in the input's value:
   *  the DOM is a projection, never the truth. */
  #query = ''

  connectedCallback(): void {
    installCss()
    this.#build()

    // The panel is the zoomable widget, exactly as `hcWidget="shortcut-sheet"
    // anchor="center"` made it. Attached to the LIVE panel node once and torn
    // down on disconnect: the directive re-ran per opening only because
    // Angular's `@if` destroyed the node each time; here the node survives, so
    // one attachment covers every opening and the persisted scale is applied
    // before the sheet is ever shown.
    const chrome = this.#chrome
    if (chrome) this.#zoomOff = attachWidgetZoom(chrome.panel, WIDGET_ID, WIDGET_ANCHOR)

    this.#offs.push(
      // The drone's whole state, and the only source of data here. Last-value
      // replay means a late mount lands on an already-open sheet correctly —
      // there is no catch-up to write. (The Angular component read the drone's
      // `state` getter through `fromRuntime`; the bus carries the identical
      // payload and does not need the drone to be IoC-registered yet, which
      // on web it may not be at mount time.)
      EffectBus.on<ShortcutSheetState>('shortcut-sheet:state', (payload) => {
        this.#state = payload ?? EMPTY_STATE
        const next = !!this.#state.open
        const opening = next && !this.#open
        this.#open = next
        // Angular's `effect(() => { if (this.open()) { query.set(''); focus } })`
        // — it fired on the TRANSITION to open, not on every state arrival, so
        // a redraw while the sheet is up must not wipe what is being typed.
        if (opening) this.#query = ''
        this.#render()
        // The `queueMicrotask(() => filterInput()?.focus())`. #render has just
        // attached the input, so it is in the document and focusable now; the
        // microtask existed only to wait for Angular's view to materialise.
        // The filter box IS the sheet's affordance — 60+ rows, one input.
        if (opening) this.#chrome?.input.focus()
      }),

      // ESCAPE — and note WHICH spelling. The Angular component did NOT use
      // `@HostListener('document:keydown.escape')` and did NOT add a raw
      // keydown listener: it subscribed to the keymap's own `keymap:invoke`
      // effect and matched `cmd === 'global.escape'`. So the escape cascade
      // (KeyMapService → EscapeDrone → this) decides what counts as Escape,
      // modifiers included, and adding a modifier guard here would be
      // inventing semantics the original never had. Ported as-is.
      EffectBus.on<{ cmd: string }>('keymap:invoke', (payload) => {
        if (payload?.cmd === 'global.escape' && this.#open) this.#close()
      }),

      // THE PIPE WAS IMPURE. The Angular template resolved every string
      // through `| t`, declared `pure: false`, so every change-detection tick
      // re-read them and `/language ja` re-labelled an OPEN sheet on the spot.
      // An element renders when it decides to — and this one is a reference
      // sheet, the surface somebody is MOST likely to have open while they go
      // hunting for `/language`. Without this the heading, the close label,
      // the placeholder, all three section titles, the chord separator, the
      // empty message and every localized binding description would freeze in
      // the previous language until the sheet was closed and reopened.
      EffectBus.on('locale:changed', () => this.#render()),
    )

    this.#render()
  }

  disconnectedCallback(): void {
    this.#offs.forEach(off => off())
    this.#offs = []
    // The widget-zoom subscription outlives nothing — drop it with the panel
    // it was scaling, or it keeps a dead node alive on every scale change.
    this.#zoomOff?.()
    this.#zoomOff = null
    // Take the chrome out and drop it; #build remints it on reconnect. The
    // sheet's OPEN state is the drone's, not ours — a remount replays it.
    this.#chrome = null
    this.#open = false
    this.#state = EMPTY_STATE
    this.#query = ''
    this.replaceChildren()
  }

  // ── chrome (built once, DETACHED) ────────────────────────────────────
  // Angular's `@if (open())` meant none of this existed in the DOM at rest,
  // and this surface is mounted at boot and never unmounted — so it is built
  // detached and #render attaches/detaches it. `replaceChildren` MOVES an
  // existing node, so the click listeners and the caret in the filter box
  // survive every show/hide cycle.
  #build(): void {
    if (this.#chrome) return

    const backdrop = el('div', 'sheet-backdrop')
    backdrop.addEventListener('click', () => this.#close())

    const panel = el('div', 'sheet-panel')
    panel.setAttribute('role', 'dialog')
    // The InputGate is locked while the sheet is up (the drone does that), so
    // canvas gestures are frozen; this attribute is what lets the sheet's own
    // wheel events through to scroll `.sheet-body`.
    panel.setAttribute('data-consumes-wheel', '')

    // ── header
    const header = el('header', 'sheet-header')
    const title = document.createElement('h3')       // the template's bare <h3>
    const close = el('button', 'sheet-close', '×')   // &times;
    close.type = 'button'
    close.addEventListener('click', () => this.#close())
    header.append(title, close)

    // ── filter
    const filter = el('div', 'sheet-filter')
    const input = document.createElement('input')
    input.type = 'text'
    input.autocomplete = 'off'
    input.setAttribute('spellcheck', 'false')
    input.addEventListener('input', (e) => {
      this.#query = (e.target as HTMLInputElement)?.value ?? ''
      this.#render()
    })
    filter.append(input)

    // ── body (the only thing that is rebuilt)
    const body = el('div', 'sheet-body')

    panel.append(header, filter, body)

    this.#chrome = { backdrop, panel, title, close, input, body }
  }

  // ── rendering (rebuild-on-change — state lives here, never in the DOM) ─
  #render(): void {
    const chrome = this.#chrome
    if (!chrome) return

    // The template's own predicate — `@if (open())` — kept in its POSITIVE
    // direction. Do not re-derive it by negating something else: this guard is
    // the difference between a hidden sheet and a black sheet over the entire
    // hive that eats every click.
    if (!this.#open) {
      chrome.backdrop.remove()
      chrome.panel.remove()
      // Drop the rows too — a closed sheet holding a few hundred detached
      // nodes is just a leak with an animation.
      chrome.body.replaceChildren()
      return
    }

    chrome.panel.setAttribute('aria-label', t('shortcuts.title', 'Reference'))
    chrome.title.textContent = t('shortcuts.title', 'Reference')
    chrome.close.setAttribute('aria-label', t('shortcuts.close', 'Close'))
    chrome.input.setAttribute('placeholder',
      t('shortcuts.filter-placeholder', 'Filter commands, operations, shortcuts…'))
    // `[value]="query()"` — written only when it actually differs, so typing
    // never disturbs its own caret.
    if (chrome.input.value !== this.#query) chrome.input.value = this.#query

    // Rebuilding the body resets its scroll to the top. Angular's `@for` with
    // `track` kept surviving rows in place, so a locale switch (or a keystroke
    // that only trims the tail of a long list) left the reader where they
    // were. Save and restore around the rebuild; the browser clamps whatever
    // no longer exists, which is exactly what the tracked version did.
    const scroll = chrome.body.scrollTop
    this.#renderBody(chrome.body)
    chrome.body.scrollTop = scroll

    // Back in, if it was out — moving live nodes, never re-creating them, so
    // the listeners wired in #build stay attached.
    if (chrome.backdrop.parentNode !== this || chrome.panel.parentNode !== this) {
      this.replaceChildren(chrome.backdrop, chrome.panel)
    }
  }

  /** The three `@if (…().length)` sections plus the `@if (!hasResults())`
   *  empty state. Rebuilt whole on every render — the house pattern, no
   *  diffing — which is safe because nothing in here holds focus or runs an
   *  animation: every row is inert text. */
  #renderBody(body: HTMLDivElement): void {
    // `query().toLowerCase().trim()`, computed once and shared by all three
    // filters exactly as the three computeds each derived it.
    const q = this.#query.toLowerCase().trim()
    const slash = this.#slashCommands(q)
    const cli = this.#commandLineOps(q)
    const groups = this.#shortcutGroups(q)

    const parts: HTMLElement[] = []
    if (slash.length) parts.push(this.#slashSection(slash))
    if (cli.length) parts.push(this.#cliSection(cli))
    if (groups.length) parts.push(this.#keyboardSection(groups))

    // `hasResults` in its ORIGINAL direction — three `> 0` tests OR'd — and
    // then negated only at the point the template negated it. Re-deriving it
    // as "no section rendered" would be the same thing today and a different
    // thing the moment a section gains a reason to be hidden while non-empty.
    const hasResults = slash.length > 0 || cli.length > 0 || groups.length > 0
    if (!hasResults) parts.push(el('div', 'sheet-empty', t('shortcuts.empty', 'No matches')))

    body.replaceChildren(...parts)
  }

  // ── the three computeds, copied predicate for predicate ───────────────
  // Note what is NOT lowercased: `name` and the aliases are matched raw
  // against the lowercased needle (slash names are already lowercase, so the
  // effect is nil — but it is the original's spelling and re-deriving it is
  // how a behaviour named `Help` would quietly stop matching).

  #slashCommands(q: string): SlashCommandEntry[] {
    const all = this.#state.slashCommands ?? []
    if (!q) return all
    return all.filter(e =>
      e.name.includes(q) ||
      e.aliases.some(a => a.includes(q)) ||
      e.description.toLowerCase().includes(q)
    )
  }

  #commandLineOps(q: string): CommandLineOperationEntry[] {
    const all = this.#state.commandLineOps ?? []
    if (!q) return all
    return all.filter(e =>
      e.behavior.toLowerCase().includes(q) ||
      e.trigger.toLowerCase().includes(q) ||
      e.description.toLowerCase().includes(q) ||
      (e.example?.input.toLowerCase().includes(q) ?? false)
    )
  }

  #shortcutGroups(q: string): ShortcutGroup[] {
    const all = this.#state.shortcutGroups ?? []
    if (!q) return all
    const filtered: ShortcutGroup[] = []
    for (const group of all) {
      const binds = group.bindings.filter(b =>
        (b.description ?? '').toLowerCase().includes(q) ||
        (b.cmd ?? '').toLowerCase().includes(q) ||
        group.category.toLowerCase().includes(q)
      )
      if (binds.length) filtered.push({ category: group.category, bindings: binds })
    }
    return filtered
  }

  // ── the three sections ────────────────────────────────────────────────

  /** `/name` plus its aliases on the left, the behaviour's own description on
   *  the right. The description comes from the drone (SlashBehaviourDrone
   *  already resolved it through i18n at match time) — it is not this
   *  surface's string and is printed as handed over. */
  #slashSection(entries: readonly SlashCommandEntry[]): HTMLElement {
    const section = el('section', 'sheet-section')
    section.append(el('h4', 'section-title', t('shortcuts.section.slash', 'Slash Commands')))

    const list = el('div', 'section-list')
    for (const entry of entries) {
      const row = el('div', 'sheet-row slash-row')
      const primary = el('span', 'row-primary')
      primary.append(el('span', 'slash-name', `/${entry.name}`))
      for (const alias of entry.aliases) {
        primary.append(el('span', 'slash-alias', `/${alias}`))
      }
      row.append(primary, el('span', 'row-desc', entry.description))
      list.append(row)
    }
    section.append(list)
    return section
  }

  /** The example input (when the operation has one) and its trigger badge on
   *  the left, the description on the right. */
  #cliSection(entries: readonly CommandLineOperationEntry[]): HTMLElement {
    const section = el('section', 'sheet-section')
    section.append(el('h4', 'section-title', t('shortcuts.section.command-line', 'Command Line')))

    const list = el('div', 'section-list')
    for (const entry of entries) {
      const row = el('div', 'sheet-row cli-row')
      const primary = el('span', 'row-primary')
      // `@if (entry.example)` — positive direction; an operation with no
      // worked example shows its trigger alone.
      if (entry.example) primary.append(el('code', 'cli-example', entry.example.input))
      primary.append(el('kbd', 'trigger-badge', entry.trigger))
      row.append(primary, el('span', 'row-desc', entry.description))
      list.append(row)
    }
    section.append(list)
    return section
  }

  /** One subgroup per keymap category, each a description + its chord badges.
   *  The `:first-of-type` margin rule in the CSS keys off these divs being the
   *  only element of their type under the section — keep the shape (h4, then
   *  N `div.shortcut-subgroup`) if this is ever restructured. */
  #keyboardSection(groups: readonly ShortcutGroup[]): HTMLElement {
    const section = el('section', 'sheet-section')
    section.append(el('h4', 'section-title', t('shortcuts.section.keyboard', 'Keyboard Shortcuts')))

    for (const group of groups) {
      const subgroup = el('div', 'shortcut-subgroup')
      // The category is the keymap's own raw string ('Navigation', 'View', …),
      // printed as-is exactly as the template did — it is not a catalog key.
      subgroup.append(el('h5', 'subgroup-title', group.category))

      const list = el('div', 'section-list')
      for (const binding of group.bindings) {
        const row = el('div', 'sheet-row kbd-row')
        // `binding.descriptionKey ? (binding.descriptionKey | t) : binding.description`.
        // The pipe rendered the KEY itself when the catalog had no entry, and
        // `t(key, key)` reproduces that byte for byte. These keys belong to
        // whoever declared the binding, so they are resolved here and never
        // extracted into this surface's catalog.
        const desc = binding.descriptionKey
          ? t(binding.descriptionKey, binding.descriptionKey)
          : (binding.description ?? '')
        row.append(el('span', 'row-desc', desc))
        row.append(this.#keys(binding))
        list.append(row)
      }
      subgroup.append(list)
      section.append(subgroup)
    }
    return section
  }

  /** The chord badges for one binding. `formatSequence` in the component:
   *  each STEP of the sequence formatted by core's `formatChord`, steps joined
   *  by the localized separator ("then"). One spelling of a chord in the whole
   *  runtime — imported, never re-derived. */
  #keys(binding: KeyBinding): HTMLElement {
    const keys = el('span', 'shortcut-keys')
    const steps = (binding.sequence ?? []).map(chord => formatChord(chord))
    steps.forEach((step, index) => {
      if (index > 0) keys.append(el('span', 'chord-sep', t('shortcuts.chord-sep', 'then')))
      for (const part of step) keys.append(el('kbd', 'key-badge', part))
    })
    return keys
  }

  // ── the one exit, and every path takes it ─────────────────────────────
  /** The close button, the backdrop and Escape all answer the same way the
   *  Angular `close` did: one `shortcut-sheet:close` with an undefined
   *  payload. The DRONE owns what closing means — it flips its own state,
   *  unsuppresses the keymap and unlocks the InputGate — and it guards on
   *  `if (this.#open)`, so a second click that beat the re-render is a no-op
   *  rather than a double unlock. Exactly once, every path, same shape. */
  #close(): void {
    EffectBus.emit('shortcut-sheet:close', undefined)
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
  customElements.define(SURFACE_NAME, ShortcutSheetElement)
}

window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/ShortcutSheetElement',
    element: SURFACE_NAME,
    order: 300,
  })
})
