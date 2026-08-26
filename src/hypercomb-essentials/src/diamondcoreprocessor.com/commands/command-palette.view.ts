// command-palette.view.ts — THE COMMAND PALETTE, the centred fuzzy-search
// modal that lists every keyboard command with a description and runs the one
// you pick, as a framework-free custom element (everything-is-a-beehavior
// Phase 2: Angular panels leave the shell and ship as signed modules).
//
// A straight port of shared/ui/command-palette: same surface name
// (hc-command-palette), same order band (370), the same one effect in
// (`command-palette:state`) and the same five effects out
// (`command-palette:input` / `:nav` / `:execute` / `:execute-at` / `:close`).
// The participant sees the same card, delivered as a module instead of
// compiled into the shell.
//
// IT LANDS BESIDE ITS DRONE. `command-palette.drone.ts` (next door) owns all
// of the data and all of the state: it toggles on `keymap:invoke` /
// `ui.commandPalette`, reads KeyMapService, fuzzy-matches, groups, assigns the
// global indices, tracks recents in localStorage, suppresses the keymap while
// open, and publishes the whole `CommandPaletteState` over the bus. This file
// has NO business logic — not even the active index, which is drone state and
// is re-derived on every paint. That split is why the port is a rewrite of
// markup only.
//
// THE CHORDS ARE FORMATTED BY CORE, NOT HERE. `formatChord` (core/
// keymap-format.ts) is the single spelling of a key chord — platform-aware
// (Cmd vs Ctrl), the same glyph table the shortcut sheet and the keymap editor
// read. Re-implementing key rendering in a view is how two spellings of the
// same shortcut end up on screen; there is exactly one, and it is imported.
//
// LIFECYCLE NOTE. The Angular template was one big `@if (open())`, so nothing
// existed in the DOM at rest. A registry-fed element is mounted ONCE at boot
// and stays, so the chrome is built DETACHED and attached only while the
// palette is open — a full-screen backdrop that is merely `display:none` still
// answers `querySelector`, and is one `pointer-events` slip from eating every
// click on the hive. Detach/re-attach also restarts the two enter animations,
// which is what the Angular teardown was doing for free.
//
// Its strings ship WITH it (command-palette.i18n.ts, extracted from all 14
// shell catalogs) and register under the 'app' namespace, so every key
// resolves exactly as before — the Phase 2 catalog split, another slice. The
// per-command LABELS are not its strings: the drone builds them from
// `binding.description` (the raw string, NOT `descriptionKey` — see the note
// on #itemRow), and the group headings are the keymap's own raw categories.

import {
  attachWidgetZoom,
  EffectBus,
  formatChord,
  I18N_IOC_KEY,
  type I18nProvider,
  type KeyBinding,
} from '@hypercomb/core'
import { COMMAND_PALETTE_TRANSLATIONS } from './command-palette.i18n.js'
import type {
  CommandPaletteState,
  PaletteGroup,
  PaletteItem,
} from './command-palette.drone.js'

const SURFACE_NAME = 'hc-command-palette'

/** The widget-zoom id and anchor the Angular template stamped
 *  (`hcWidget="command-palette" anchor="center"`). BOTH are part of the
 *  participant's persisted scale — the id keys `hc:widget-scale`, so changing
 *  either would orphan a palette somebody had already sized to their liking. */
const WIDGET_ID = 'command-palette'
const WIDGET_ANCHOR = 'center' as const

// Owner token for the InputGate lock held while the palette is open. Owner-
// scoped so it composes with locks held by the editor / other overlays.
// Carried UNCHANGED from the Angular component: the token is the identity of
// the lock, and renaming it would strand a lock taken under the old spelling
// if both versions were ever loaded in one document during the transition.
const COMMAND_PALETTE_LOCK_OWNER = 'command-palette'

/** Structural type for the InputGate — the shared tile-input lock. Resolved
 *  at runtime via window.ioc; undefined until its bee registers. (The original
 *  resolved it this way because shared may never import from modules. This
 *  file IS a module and could import the class — but the lazy lookup is also
 *  what keeps the surface usable in a host where no InputGate exists at all,
 *  so the seam stays.) */
type InputGateLike = {
  lock(owner?: string): void
  unlock(owner?: string): void
}

// Same contract as the shell pipe: params drive both pluralization
// (`key.one` / `key.other`, chosen on params.count by the i18n service) and
// `{token}` interpolation. The fallback is the English catalog text, and it
// interpolates the same tokens so a bare host with no i18n reads identically.
// None of this palette's three keys takes a param or has plural variants in
// any of the 14 catalogs — the params arm is here for parity with the house
// helper, not because anything uses it.
const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
  const value = i18n?.t(key, params)
  if (value && value !== key) return value
  if (!params) return fallback
  return fallback.replace(/\{(\w+)\}/g, (whole, token: string) =>
    token in params ? String(params[token]) : whole)
}

// The palette's three strings travel with it — registered as soon as the i18n
// service is up, under 'app' so the keys resolve exactly as they always did.
window.ioc?.whenReady?.(I18N_IOC_KEY, (i18n) => {
  const provider = i18n as I18nProvider
  for (const [locale, catalog] of Object.entries(COMMAND_PALETTE_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

// ── the styles the Angular SCSS carried, expanded to plain CSS ────────────
// No shadow DOM (the tutorial-overlay + landing-badge + shortcut-sheet
// precedent), so Angular's `:host` becomes the tag name and every other
// selector is prefixed with it — nothing leaks out of the palette. SCSS
// nesting is flattened (`.palette-item { &.active }` becomes
// `.palette-item.active`), and the `var(--hc-…)` custom properties are left
// exactly as they were.
//
// The two breakpoint mixins are expanded to their literal queries from
// shared/ui/_breakpoints.scss — `tablet-only` is
// `(min-width: 600px) and (max-width: 1023px)` ($bp-tablet-land - 1) and
// `phone-only` is `(max-width: 599px)` ($bp-phone-max). Note it is
// `phone-only`, NOT the `phone` (short-axis) mixin: a landscape phone keeps
// the top-anchored card rather than becoming a bottom sheet, exactly as
// before.
//
// Angular's build autoprefixed; a hand-written sheet does not, so the panel's
// `backdrop-filter` carries its `-webkit-` twin — without it the frost
// silently disappears on Safari/iOS and the palette reads as a flat slab over
// an unblurred hive.
//
// All three @keyframes are renamed into the tag's namespace
// (`hc-command-palette-…`): a document-level sheet shares ONE global animation
// namespace, and `palette-panel-in` is exactly the kind of name a second panel
// would also pick.
//
// The z-indexes (100000 / 100001) are unchanged: above every piece of shell
// chrome (header 60000 is the highest), level with the shortcut sheet — the
// two are mutually exclusive modals — and below the icon picker
// (100010/100011), which can be raised from on top of a dialog.
const CSS = `
${SURFACE_NAME}{display:contents}
${SURFACE_NAME} .palette-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:100000;animation:hc-command-palette-backdrop-in 150ms ease forwards}
${SURFACE_NAME} .palette-panel{position:fixed;top:20%;left:50%;transform:translateX(-50%);z-index:100001;width:min(90vw,36rem);max-height:60vh;display:flex;flex-direction:column;background:rgba(10,16,24,.94);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.08);border-radius:var(--hc-radius-floating);box-shadow:0 16px 64px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.04);overflow:hidden;font-family:var(--hc-mono);animation:hc-command-palette-panel-in 200ms cubic-bezier(0.16,1,0.3,1) forwards}
${SURFACE_NAME} .palette-input-row{display:flex;align-items:center;padding:.65rem 1rem;border-bottom:1px solid rgba(255,255,255,.06);gap:.6rem}
${SURFACE_NAME} .palette-icon{color:#c8975a;font-size:.9rem;font-weight:700;flex-shrink:0}
${SURFACE_NAME} .palette-input{flex:1;background:transparent;border:none;outline:none;font-family:inherit;font-size:.85rem;color:whitesmoke;caret-color:#c8975a}
${SURFACE_NAME} .palette-input::placeholder{color:rgba(245,245,245,.25)}
${SURFACE_NAME} .palette-results{overflow-y:auto;max-height:calc(60vh - 3rem);padding:.3rem}
${SURFACE_NAME} .palette-results::-webkit-scrollbar{width:4px}
${SURFACE_NAME} .palette-results::-webkit-scrollbar-track{background:transparent}
${SURFACE_NAME} .palette-results::-webkit-scrollbar-thumb{background:rgba(255,255,255,.08);border-radius:2px}
${SURFACE_NAME} .palette-empty{padding:1.5rem;text-align:center;font-size:.75rem;color:rgba(245,245,245,.3);font-style:italic}
${SURFACE_NAME} .palette-group-title{font-size:.58rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:rgba(245,245,245,.25);padding:.55rem .75rem .25rem}
${SURFACE_NAME} .palette-item{display:flex;justify-content:space-between;align-items:center;padding:.45rem .75rem;border-radius:4px;cursor:pointer;transition:background 100ms ease;gap:1rem}
${SURFACE_NAME} .palette-item:hover{background:rgba(255,255,255,.04)}
${SURFACE_NAME} .palette-item.active{background:rgba(200,151,90,.1);box-shadow:inset 2px 0 0 #c8975a}
${SURFACE_NAME} .palette-item-label{font-size:.78rem;color:rgba(245,245,245,.7);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
${SURFACE_NAME} .match-highlight{color:#c8975a;font-weight:700}
${SURFACE_NAME} .palette-item-shortcut{display:flex;gap:.2rem;flex-shrink:0}
${SURFACE_NAME} .key-badge{display:inline-flex;align-items:center;justify-content:center;padding:.1rem .35rem;min-width:1.2rem;height:1.2rem;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:3px;font-size:.58rem;font-weight:600;font-family:inherit;color:rgba(245,245,245,.5)}
@keyframes hc-command-palette-backdrop-in{from{opacity:0}to{opacity:1}}
@keyframes hc-command-palette-panel-in{from{opacity:0;transform:translateX(-50%) translateY(-8px) scale(.98)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}
@keyframes hc-command-palette-panel-in-phone{from{opacity:0;transform:translateY(100%)}to{opacity:1;transform:translateY(0)}}
@media (min-width:600px) and (max-width:1023px){
${SURFACE_NAME} .palette-panel{width:min(85vw,32rem)}
${SURFACE_NAME} .palette-input{font-size:16px}
${SURFACE_NAME} .palette-item{padding:.55rem .75rem;min-height:2.75rem}
${SURFACE_NAME} .palette-item-label{font-size:.82rem}
}
@media (max-width:599px){
${SURFACE_NAME} .palette-panel{top:auto;bottom:0;left:0;right:0;transform:none;width:100%;max-height:85vh;border-radius:var(--hc-radius-floating) var(--hc-radius-floating) 0 0;padding-bottom:var(--hc-safe-bottom,0px);animation:hc-command-palette-panel-in-phone 250ms cubic-bezier(0.16,1,0.3,1) forwards}
${SURFACE_NAME} .palette-input{font-size:16px}
${SURFACE_NAME} .palette-input-row{padding:.75rem 1rem}
${SURFACE_NAME} .palette-results{max-height:calc(85vh - 4rem)}
${SURFACE_NAME} .palette-item{padding:.6rem .75rem;min-height:2.75rem}
${SURFACE_NAME} .palette-item-label{font-size:.85rem}
${SURFACE_NAME} .palette-group-title{font-size:.65rem}
${SURFACE_NAME} .palette-empty{font-size:.8rem}
${SURFACE_NAME} .key-badge{display:none}
}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-command-palette', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

/** `<tag class="…">text</tag>` — the results are almost entirely spans, and
 *  spelling out three lines per span would bury the structure. A BLANK
 *  className leaves the attribute off entirely, which is what the template's
 *  bare `<span>{{ part.text }}</span>` produced. */
const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K, className: string, text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** The default `fromRuntime()` read in the Angular component, verbatim — what
 *  it showed before the drone had ever emitted. */
const EMPTY_STATE: CommandPaletteState = {
  open: false,
  query: '',
  activeIndex: 0,
  groups: [],
  totalCount: 0,
}

/** `formatShortcut` from the component, unchanged including the guard's
 *  spelling: `!binding?.sequence?.length` covers a null binding, an absent
 *  sequence AND an empty sequence in one test, and a re-derivation that only
 *  checked for null would paint an empty badge row for a binding with no keys.
 *  Outer array = sequence steps, inner = that chord's rendered parts. Note
 *  there is no separator between steps — the palette prints the badges one
 *  after another, where the shortcut sheet interleaves `shortcuts.chord-sep`.
 *  That difference is the original's, and it is why this surface carries no
 *  chord-separator key. */
const formatShortcut = (binding: KeyBinding | null): string[][] => {
  if (!binding?.sequence?.length) return []
  return binding.sequence.map(chord => formatChord(chord))
}

/** `highlightLabel` from the component, copied character for character — it is
 *  a run-length collapse of `matchIndices` into alternating plain/highlighted
 *  spans, and every boundary condition in it (the `i === 0` seeding, the
 *  trailing `if (current)`) is load-bearing. An item with NO match indices
 *  short-circuits to one plain part, which is the no-query case: every command
 *  is listed and nothing is gold. */
const highlightLabel = (item: PaletteItem): { text: string; highlighted: boolean }[] => {
  if (!item.matchIndices.length) return [{ text: item.label, highlighted: false }]

  const indices = new Set(item.matchIndices)
  const parts: { text: string; highlighted: boolean }[] = []
  let current = ''
  let currentHighlighted = false

  for (let i = 0; i < item.label.length; i++) {
    const isHighlighted = indices.has(i)
    if (i === 0) {
      currentHighlighted = isHighlighted
      current = item.label[i]
    } else if (isHighlighted === currentHighlighted) {
      current += item.label[i]
    } else {
      parts.push({ text: current, highlighted: currentHighlighted })
      current = item.label[i]
      currentHighlighted = isHighlighted
    }
  }
  if (current) parts.push({ text: current, highlighted: currentHighlighted })
  return parts
}

/** The nodes minted once in #build and kept for the element's whole life. The
 *  INPUT is the one that genuinely must persist — it holds focus and a caret
 *  and the participant is typing into it — and the rest ride along so a single
 *  null check covers the lot. Only `results`' CHILDREN are rebuilt. */
type Chrome = {
  backdrop: HTMLDivElement
  panel: HTMLDivElement
  input: HTMLInputElement
  results: HTMLDivElement
}

export class CommandPaletteElement extends HTMLElement {

  /** Everything connectedCallback wired, torn down in one sweep. */
  #offs: Array<() => void> = []

  /** attachWidgetZoom's teardown — its own handle, because the panel it scales
   *  outlives any single open/close cycle. */
  #zoomOff: (() => void) | null = null

  /** Chrome, built once and kept — see the type above. */
  #chrome: Chrome | null = null

  /** `state$()` — everything the drone published, held whole. The query, the
   *  active index and the groups are ALL drone state; nothing about what is on
   *  screen is stored in the DOM, which is why a rebuild can never lose the
   *  selection. */
  #state: CommandPaletteState = EMPTY_STATE

  /** What the results list was last painted FROM. Not a reconciler and not an
   *  optimisation — it is the loop breaker. Every `mouseenter` on a row emits
   *  `command-palette:nav` (see #itemRow), the drone re-emits its state, and an
   *  unconditional rebuild would replace the very node under the cursor;
   *  browsers re-run hit testing after a DOM change and fire `mouseenter` on
   *  the replacement, which emits again — a render loop that spins for as long
   *  as the pointer rests on the list. The drone reuses the SAME `groups` array
   *  when nothing was re-filtered (a 'set' nav never calls its `#rebuild`), so
   *  reference identity plus the active index answers "did anything I paint
   *  actually change?" exactly, and answers "no" for the hover case.
   *  Angular's `@for` with `track item.id` did the same nothing. */
  #paintedGroups: readonly PaletteGroup[] | null = null
  #paintedActive = -1

  connectedCallback(): void {
    installCss()
    this.#build()

    // The panel is the zoomable widget, exactly as `hcWidget="command-palette"
    // anchor="center"` made it. Attached to the LIVE panel node once and torn
    // down on disconnect: the directive re-ran per opening only because
    // Angular's `@if` destroyed the node each time; here the node survives, so
    // one attachment covers every opening and the persisted scale is applied
    // before the palette is ever shown.
    const chrome = this.#chrome
    if (chrome) this.#zoomOff = attachWidgetZoom(chrome.panel, WIDGET_ID, WIDGET_ANCHOR)

    this.#offs.push(
      // The drone's whole state, and the only source of data here. The Angular
      // component read the drone's `state` getter through `fromRuntime` (its
      // 'change' event) AND subscribed to this effect for the focus flag; the
      // drone's `#emit()` fires both in the same breath with the identical
      // payload, so the bus alone carries everything — and it carries the LAST
      // value to a late subscriber, which the EventTarget does not. That
      // matters on web, where this element can mount before the drone is even
      // IoC-registered.
      //
      // A pure state ASSERTION, absorbed idempotently: the handler assigns, it
      // never appends or counts, so a repeat delivery (the replay on subscribe,
      // or the redundant emit a hover produces) paints the same thing and
      // changes nothing else. The replay is also SAFE to act on here: the last
      // value after any close is `{open:false}`, so a remount can never
      // re-open a palette the participant dismissed — and if it really is open,
      // repainting it is the correct catch-up.
      EffectBus.on<CommandPaletteState>('command-palette:state', (payload) => {
        this.#state = payload ?? EMPTY_STATE
        this.#render()
        // `ngAfterViewChecked` + `#needsFocus`, which the Angular component set
        // on EVERY state emission where `open()` was true — not just the
        // opening transition. Kept as-is: `focus()` on the already-focused
        // input is a no-op that does not move the caret, and doing it on every
        // emission is what recovers focus if anything else stole it while the
        // palette was up. #render has just attached the input, so it is in the
        // document and focusable now; Angular's queueMicrotask existed only to
        // wait for the view to materialise.
        if (this.#state.open) this.#chrome?.input.focus()
      }),

      // THE PIPE WAS IMPURE. The Angular template resolved its strings through
      // `| t`, declared `pure: false`, so every change-detection tick re-read
      // them and `/language ja` re-labelled an OPEN palette on the spot. An
      // element renders when it decides to, and this one is where somebody goes
      // LOOKING for the language command — without this the placeholder, the
      // dialog's aria-label and the "no matching commands" line would freeze in
      // the previous language until it was closed and reopened. Forced, because
      // the empty line lives inside the results list and the paint guard would
      // otherwise (correctly) see no data change.
      EffectBus.on('locale:changed', () => this.#render(true)),
    )

    this.#render()
  }

  disconnectedCallback(): void {
    this.#offs.forEach(off => off())
    this.#offs = []
    // The widget-zoom subscription outlives nothing — drop it with the panel it
    // was scaling, or it keeps a dead node alive on every scale change.
    this.#zoomOff?.()
    this.#zoomOff = null
    // `ngOnDestroy` released the lock explicitly, and for the same reason: the
    // visibility effect will not run a final unlock once we are gone, so a
    // palette torn down while open would leave the hexes frozen forever.
    this.#gate()?.unlock(COMMAND_PALETTE_LOCK_OWNER)
    // Every listener this surface wires lives on a node it owns (backdrop,
    // input, rows) — there is not one document or window listener to remove, so
    // dropping the chrome drops the wiring with it.
    this.#chrome = null
    this.#state = EMPTY_STATE
    this.#paintedGroups = null
    this.#paintedActive = -1
    this.replaceChildren()
  }

  // ── the one exit that is ours ─────────────────────────────────────────
  /** `close()` in the component. Backdrop click and Escape both land here and
   *  emit ONCE; the drone ignores it when already closed. Enter and a row
   *  mousedown do NOT come through here — they emit execute / execute-at and
   *  the drone closes itself, which is the original's shape and the reason
   *  running a command never emits a close of its own. */
  #close(): void {
    EffectBus.emit('command-palette:close', undefined)
  }

  // ── the InputGate ─────────────────────────────────────────────────────
  /** Resolved at runtime; undefined until its bee registers. */
  #gate(): InputGateLike | undefined {
    return window.ioc?.get?.('@diamondcoreprocessor.com/InputGate') as InputGateLike | undefined
  }

  /** The Angular `effect()`, spelled out: freeze tile navigation while the
   *  palette is open. It is a centred modal over the canvas, so per the
   *  "modals lock tiles while showing" rule no pan/pinch/wheel-zoom/drag-select
   *  may bleed through; `[data-consumes-wheel]` on the panel is what keeps the
   *  results list scrollable anyway. It ran on every change of `open()` and
   *  re-resolved the gate each time (the gate's bee may register later than
   *  this surface). Here it runs on EVERY render — `lock`/`unlock` are
   *  idempotent per owner, so running it more often is free and the lock can
   *  never drift out of step with what is on screen. */
  #applyGate(): void {
    const gate = this.#gate()
    if (!gate) return
    if (this.#state.open) gate.lock(COMMAND_PALETTE_LOCK_OWNER)
    else gate.unlock(COMMAND_PALETTE_LOCK_OWNER)
  }

  // ── chrome (built once, DETACHED) ─────────────────────────────────────
  // Angular's `@if (open())` meant none of this existed in the DOM at rest, and
  // this surface is mounted at boot and never unmounted — so it is built
  // detached and #render attaches/detaches it. `replaceChildren` MOVES an
  // existing node, so the backdrop's click listener and, above all, the caret
  // and focus in the input survive every show/hide cycle.
  #build(): void {
    if (this.#chrome) return

    const backdrop = el('div', 'palette-backdrop')
    backdrop.addEventListener('click', () => this.#close())

    const panel = el('div', 'palette-panel')
    panel.setAttribute('role', 'dialog')
    // The InputGate is locked while the palette is up (#applyGate), so canvas
    // gestures are frozen; this attribute is what lets the palette's own wheel
    // events through to scroll `.palette-results`.
    panel.setAttribute('data-consumes-wheel', '')

    // ── input row: the `>` prompt glyph and the filter box
    const inputRow = el('div', 'palette-input-row')
    inputRow.append(el('span', 'palette-icon', '>'))   // the template's &gt;

    const input = document.createElement('input')
    input.className = 'palette-input'
    input.type = 'text'
    input.autocomplete = 'off'
    input.setAttribute('spellcheck', 'false')

    // `(input)` — forward the raw value and let the drone own the query. The
    // element never re-renders off its own keystroke; the drone's answering
    // state emission is what repaints, exactly as the signal round-trip did.
    input.addEventListener('input', (event) => {
      const value = (event.target as HTMLInputElement).value
      EffectBus.emit('command-palette:input', { query: value })
    })

    // `(keydown)` — a PLAIN Angular DOM binding on the INPUT, not
    // `@HostListener('document:keydown.escape')` and not a raw document
    // listener. So it never had the KeyEventsPlugin's modifier semantics:
    // Ctrl-Escape reached this switch in the original and closed the palette,
    // and adding a `ctrlKey || altKey || shiftKey || metaKey` guard here would
    // ITSELF be the regression. Ported switch-for-switch, including which
    // branches call preventDefault (all four) and that NONE calls
    // stopPropagation — the events still bubble to document, and it is the
    // drone's `keymap:suppress` that keeps the rest of the app out of them.
    // It also stays on the INPUT rather than on document: the palette only
    // answers arrows/Enter/Escape while its own box has focus, which is the
    // scope the original had.
    input.addEventListener('keydown', (event) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault()
          EffectBus.emit('command-palette:nav', { direction: 'down' })
          break
        case 'ArrowUp':
          event.preventDefault()
          EffectBus.emit('command-palette:nav', { direction: 'up' })
          break
        case 'Enter':
          event.preventDefault()
          EffectBus.emit('command-palette:execute', undefined)
          break
        case 'Escape':
          event.preventDefault()
          this.#close()
          break
      }
    })
    inputRow.append(input)

    // ── results (the only thing that is rebuilt)
    const results = el('div', 'palette-results')

    panel.append(inputRow, results)

    this.#chrome = { backdrop, panel, input, results }
  }

  // ── rendering (rebuild-on-change — state lives here, never in the DOM) ─
  #render(force = false): void {
    const chrome = this.#chrome
    if (!chrome) return
    const state = this.#state

    // The template's own predicate — `@if (open())` — kept in its POSITIVE
    // direction. Do not re-derive it by negating something else: this guard is
    // the difference between a hidden palette and a dark sheet over the entire
    // hive that eats every click.
    if (!state.open) {
      chrome.backdrop.remove()
      chrome.panel.remove()
      // Drop the rows too — a closed palette holding a few hundred detached
      // nodes is just a leak with an animation. The input's VALUE is left
      // alone; the sync below rewrites it from the drone's (reset) query on the
      // way back in, which is what the Angular teardown achieved by destroying
      // the input outright.
      chrome.results.replaceChildren()
      this.#paintedGroups = null
      this.#paintedActive = -1
      this.#applyGate()
      return
    }

    chrome.panel.setAttribute('aria-label', t('palette.title', 'Command Palette'))
    chrome.input.setAttribute('placeholder', t('palette.placeholder', 'Type a command...'))

    // The Angular input was UNCONTROLLED — no `[value]` binding at all — and
    // got its empty box on each opening only because `@if` destroyed and
    // rebuilt it. This node survives, so the drone's query has to be written
    // back or a reopened palette would show the previous search over an
    // unfiltered list. Written ONLY when it differs, so typing never disturbs
    // its own caret (the drone echoes back exactly what was typed, so the
    // mid-typing case is always a no-op) — the sanctioned in-place update, and
    // the reason this node is never rebuilt.
    const query = state.query ?? ''
    if (chrome.input.value !== query) chrome.input.value = query

    const groups = state.groups ?? []
    const active = state.activeIndex
    if (force || groups !== this.#paintedGroups || active !== this.#paintedActive) {
      // Rebuilding resets the list's scroll to the top. Angular's `@for` with
      // `track` kept surviving rows in place, so a redraw left the reader where
      // they were. Save and restore around the rebuild; the browser clamps
      // whatever no longer exists, which is exactly what the tracked version
      // did. (Note what is deliberately NOT here: nothing scrolls the active
      // row into view. The original never did, and arrowing past the fold walks
      // the highlight off-screen — a real annoyance, but it is the behaviour
      // being ported, not one to invent a fix for mid-conversion.)
      const scroll = chrome.results.scrollTop
      this.#renderResults(chrome.results, groups, active, state.totalCount)
      chrome.results.scrollTop = scroll
      this.#paintedGroups = groups
      this.#paintedActive = active
    }

    // Back in, if it was out — moving live nodes, never re-creating them, so
    // the listeners wired in #build stay attached and the caret survives.
    // Re-attaching also restarts the backdrop's and the panel's enter
    // animations, which is what Angular's per-open teardown was doing.
    if (chrome.backdrop.parentNode !== this || chrome.panel.parentNode !== this) {
      this.replaceChildren(chrome.backdrop, chrome.panel)
    }

    this.#applyGate()
  }

  /** The `@if (totalCount() === 0)` empty line followed by the group/item
   *  loops. Rebuilt whole — the house pattern, no diffing — which is safe
   *  because nothing in here holds focus or runs an animation, and the
   *  SELECTION is not in here either: `activeIndex` is drone state, re-derived
   *  per row on every paint, so a rebuild that lands mid-arrow-walk repaints
   *  the highlight exactly where the drone says it is. */
  #renderResults(
    host: HTMLDivElement,
    groups: readonly PaletteGroup[],
    activeIndex: number,
    totalCount: number,
  ): void {
    const parts: HTMLElement[] = []

    // `totalCount() === 0`, spelled EXACTLY as the template spelled it. Not
    // `!(totalCount > 0)`, not `totalCount <= 0`: a non-numeric count from a
    // foreign emitter is `=== 0` false, so the line stays hidden and the empty
    // loop below paints nothing — where a re-derived negation would fall
    // through and print the empty state over a list that might not be empty.
    if (totalCount === 0) {
      parts.push(el('div', 'palette-empty', t('palette.empty', 'No matching commands')))
    }

    for (const group of groups) {
      const groupNode = el('div', 'palette-group')
      // The category is the keymap's own raw string ('Navigation', 'View', the
      // drone's 'Recent' bucket, its 'Other' fallback), printed as-is exactly
      // as the template did — it is not a catalog key, and translating it here
      // would invent a key set nothing else in the runtime carries.
      groupNode.append(el('div', 'palette-group-title', group.category))
      for (const item of group.items) {
        groupNode.append(this.#itemRow(item, activeIndex))
      }
      parts.push(groupNode)
    }

    host.replaceChildren(...parts)
  }

  /** One command row: the fuzzy-highlighted label on the left, its chord badges
   *  on the right.
   *
   *  The LABEL is `item.label`, which the drone built from
   *  `binding.description` — the raw string, NOT `binding.descriptionKey`. The
   *  shortcut sheet resolves the key; the palette never did, so its labels are
   *  the author's English even under `/language ja`. That asymmetry lives in
   *  the drone's `#rebuild` (which also fuzzy-matches against that same raw
   *  label), it is not this view's to change, and "fixing" it here would break
   *  the match indices the highlighting is drawn from. */
  #itemRow(item: PaletteItem, activeIndex: number): HTMLElement {
    const row = el('div', 'palette-item')
    // `[class.active]="item.globalIndex === activeIndex()"`.
    if (item.globalIndex === activeIndex) row.classList.add('active')

    // `(mousedown)` — NOT click. preventDefault is what keeps focus (and the
    // caret) in the filter box while the command runs, and it is why there is
    // no click handler beside it to double-fire: one gesture, one `execute-at`,
    // and the drone closes the palette itself.
    row.addEventListener('mousedown', (event) => {
      event.preventDefault()
      EffectBus.emit('command-palette:execute-at', { index: item.globalIndex })
    })

    // `(mouseenter)="setActive(item.globalIndex)"`, carried over verbatim
    // INCLUDING its payload shape. Worth knowing what it does today: the
    // drone's `command-palette:nav` handler answers 'up' and 'down' only, so a
    // 'set' falls past its branches and re-emits the state UNCHANGED — the
    // highlight does not follow the mouse. That is the shipped behaviour and
    // this port preserves it rather than quietly making hover select; the emit
    // is kept because the drone is where such a fix belongs, and the paint
    // guard in #render is what stops the redundant emission from rebuilding the
    // row under the cursor.
    row.addEventListener('mouseenter', () => {
      EffectBus.emit('command-palette:nav', { direction: 'set', index: item.globalIndex })
    })

    const label = el('span', 'palette-item-label')
    for (const part of highlightLabel(item)) {
      // `@if (part.highlighted)` — gold span, else a bare one. Positive
      // direction, and the bare branch really is class-less (see `el`).
      label.append(part.highlighted
        ? el('span', 'match-highlight', part.text)
        : el('span', '', part.text))
    }

    // Both spans are unconditional in the template — a command with no binding
    // still gets an empty `.palette-item-shortcut`, which is what holds the
    // flex layout's right edge steady down the list.
    const shortcut = el('span', 'palette-item-shortcut')
    for (const step of formatShortcut(item.binding)) {
      for (const part of step) shortcut.append(el('kbd', 'key-badge', part))
    }

    row.append(label, shortcut)
    return row
  }
}

// ── shell surface registration — the externalization path ────────────────
// Same name, same order band the Angular component held; the module-side
// `element:` shape (documentation/shell-surfaces.md).
// DEFINED AT MODULE SCOPE, registered when a registry appears. A host with no
// ShellSurfaceRegistry (diamond-core-processor mounts tags directly in its own
// template) still needs the tag to be a real element rather than an inert
// unknown one — so the define cannot wait on the registry. Only the ADD does.
if (!customElements.get(SURFACE_NAME)) {
  customElements.define(SURFACE_NAME, CommandPaletteElement)
}

window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/CommandPaletteElement',
    element: SURFACE_NAME,
    order: 370,
  })
})
