// diamondcoreprocessor.com/history/rewind-window.view.ts — THE VISUAL UNDO
// PICKER, as a framework-free custom element (everything-is-a-beehavior
// Phase 2: Angular panels leave the shell and ship as signed modules).
//
// A straight port of shared/ui/rewind-window: same surface name
// (hc-rewind-window), same order band (3), the same three effects in
// (`rewind:open` / `rewind:close` / `rewind:toggle`), the same
// `history:cursor-changed` subscription, and the same single way out — a seek
// on HistoryCursorService. The participant sees the same deck, delivered as a
// module instead of compiled into the shell.
//
// It lands in `history/` and not beside its queen: `commands/rewind.queen.ts`
// is the DOOR (a slash command, and every queen lives with the other queens),
// while the window itself is a pure read over the lineage pool — the history
// domain, next to activity-log, history.service and history-cursor.service,
// the three things it actually talks to.
//
// WHAT IT IS FOR. Undo is TWO-STAGE. Stage 1 is BY TILES: a filmstrip of
// "moments" — every history entry where the tile membership of the current
// location actually changed — each drawn as a mosaic of hex thumbnails so the
// moment is recognised by PICTURE, not by timestamp. Clicking one seeks the
// cursor there. Stage 2 is BY BEHAVIOURS, and only inside the range stage 1
// picked: between the chosen moment and the next one lie the intermediate
// layers (content edits, tags, notes…), walked by a stepper clamped to that
// range — never a free global behaviour timeline. Tiles are the front door;
// behaviours are the second gear.
//
// Everything here is a READ plus cursor seeks — no new truth, no new records.
// Thumbnails come from the `thumbnails:hex` derived pool keyed by SOURCE IMAGE
// SIG (never a tile property); a miss falls back to the full image bytes, and a
// further miss renders an initial-letter hex. Nothing is load-bearing.
//
// NOW IN ESSENTIALS, SO IT SHARES THE REAL THUMBNAIL READER. The Angular
// original had to re-declare `THUMBNAIL_MEANING` ("shared cannot import
// essentials, and the meaning string IS the address") and hand-roll the pool
// read. Both copies are gone: this file imports `readThumbnail` from
// presentation/tiles/thumbnails.ts — one reader, one address, no drift.
//
// LIFECYCLE NOTE. The Angular version wrapped its whole markup in
// `@if (visible())`, so nothing existed in the DOM at rest, and it portalled
// its host to <body> for a stacking-context escape. A registry-fed element is
// mounted ONCE at boot and stays, so: the chrome is built DETACHED and #render
// attaches/detaches it (`@if` MEANS DETACH — a scrim that is merely
// display:none still answers querySelector and still covers the hive), and the
// nodes stay INSIDE the tag rather than portalling, because the tag's own CSS
// is written as `hc-rewind-window …` descendant selectors and no ancestor
// (hc-shell-surfaces is display:contents, app-root is unstyled) establishes a
// containing block that fixed positioning would have to escape.
//
// RENDER STRATEGY. Rebuild-on-change for the filmstrip and the dot track;
// MUTATE for the selection. `history:cursor-changed` is a STREAM while
// scrubbing — every drag tick of the history slider delivers a new position —
// and Angular's `@for … track` kept the cards and dots in place and only
// re-evaluated their classes. So #renderSelection() toggles `.active` /
// `.current`, flips the steppers' `disabled` and rewrites the readout on live
// nodes, and rebuilds the dot track ONLY when the active moment's RANGE
// changes. Mutating an existing node on a stream update is not a reconciler;
// rebuilding the strip per tick would be the regression.
//
// Its strings ship WITH it (rewind-window.i18n.ts, extracted from all 14 shell
// catalogs) and register under the 'app' namespace, so every key resolves
// exactly as before — the Phase 2 catalog split, another slice.

import {
  EffectBus, I18N_IOC_KEY, holdWindow,
  type I18nProvider, type WindowSession,
} from '@hypercomb/core'
import { readThumbnail, type ThumbnailStore } from '../presentation/tiles/thumbnails.js'
import { REWIND_WINDOW_TRANSLATIONS } from './rewind-window.i18n.js'

const SURFACE_NAME = 'hc-rewind-window'

/** The id this window holds in the tool-window session (installer park/unpark). */
const WINDOW_ID = 'rewind-window'

const CURSOR_KEY = '@diamondcoreprocessor.com/HistoryCursorService'
const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const STORE_KEY = '@hypercomb.social/Store'
const NAVIGATION_KEY = '@hypercomb.social/Navigation'

const SIG_RE = /^[0-9a-f]{64}$/

/** How many hexes a moment's mosaic draws before it collapses to "+n". */
const MOSAIC_MAX = 5

type CursorState = {
  locationSig: string
  position: number
  total: number
  rewound: boolean
  at: number
}

type Content = { name?: string;[slot: string]: unknown }

type HistoryService = {
  listMarkerFilenames?(locationSig: string): Promise<readonly string[]>
  readMarker?(locationSig: string, filename: string): Promise<{
    bytes: ArrayBuffer
    parsed: Content | null
    layerSig: string
    at: number
    rawText: string
  } | null>
  getLayerBySig?(layerSig: string): Promise<Content | null>
}
type CursorService = {
  state: CursorState
  seek(position: number): void
}
type Store = {
  getResource(sig: string): Promise<Blob | null>
  getPool?(meaning: string): Promise<FileSystemDirectoryHandle | null>
}
type NavigationService = { segmentsRaw(): string[] }

// Behaviour palette — same hues the history viewer uses for its category
// ticks, so the two surfaces read as one system.
type Behaviour = 'tiles' | 'content' | 'tags' | 'notes' | 'system'
const BEHAVIOUR_COLOR: Readonly<Record<Behaviour, string>> = {
  tiles: '#6dc077',
  content: '#5f8bd9',
  tags: '#d9c25f',
  notes: '#b37dd4',
  system: '#e08c4d',
}

/** One entry of the lineage pool, enriched for display. */
type Step = {
  /** 0-based index into the entries array (cursor position - 1). */
  index: number
  at: number
  filename: string
  layerSig: string
  content: Content | null
  /** Dominant behaviour of the change vs the previous entry. */
  behaviour: Behaviour
  /** Short human delta, e.g. "+2 tiles" / "content" / "tags". */
  delta: string
  /** True when tile membership (child NAME set) changed at this step. */
  tileBoundary: boolean
}

/** A stage-1 card: a tile-boundary step plus the tiles alive there. */
type Moment = {
  step: Step
  /** Up to MOSAIC_MAX tiles to draw, resolved lazily to thumb URLs. */
  tiles: readonly { name: string; childSig: string }[]
  /** How many tiles beyond the mosaic cap exist at this step. */
  overflow: number
  /** Entry-index range this moment owns: [from .. to] inclusive. */
  from: number
  to: number
}

const iocGet = <T,>(key: string): T | undefined =>
  window.ioc?.get?.(key) as T | undefined

// Same contract as the shell pipe: params drive both pluralization
// (`key.one` / `key.other`, chosen on params.count by the i18n service) and
// `{token}` interpolation. The fallback is the English catalog text, and it
// interpolates the same tokens so a bare host with no i18n reads identically.
const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
  const value = i18n?.t(key, params)
  if (value && value !== key) return value
  if (!params) return fallback
  return fallback.replace(/\{(\w+)\}/g, (whole, token: string) =>
    token in params ? String(params[token]) : whole)
}

// The window's strings travel with it — registered as soon as the i18n service
// is up, under 'app' so the keys resolve exactly as they always did.
window.ioc?.whenReady?.(I18N_IOC_KEY, (i18n) => {
  const provider = i18n as I18nProvider
  for (const [locale, catalog] of Object.entries(REWIND_WINDOW_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

// ── the styles the Angular SCSS carried, expanded to plain CSS ────────────
// No shadow DOM (the tutorial-overlay + sequence-viewer precedent), so
// Angular's `:host` becomes the tag name and every other selector is prefixed
// with it — nothing leaks out of the window and nothing reaches in.
//
// Cold chrome, dark glass. The window is a bottom-centered deck so the canvas
// above stays visible while scrubbing — the hive itself is the preview; the
// deck only picks the moment. The scrim is deliberately transparent and
// un-blurred: navigation is never blocked, it exists only to catch the outside
// click.
//
// `@include tw.header` is FLATTENED here to the values it actually emitted for
// this header. The mixin's own `> button` / `> button[class*='close']` rules
// out-specify the panel's `.close` rule, so the close button's effective font
// size is 1.125rem (not 0.85rem), its colour rgba(238,244,248,.62), its padding
// 0 and its box 1.75rem — carried below as ONE rule instead of four cascading
// ones. Its `:focus-visible` outline reads `--hc-window-accent`, which only
// `tw.panel`/`tw.floating-panel` ever define and this window uses neither: the
// declaration was already invalid-at-computed-value in the original, and it is
// carried verbatim rather than "fixed" into a ring the panel never had.
//
// Angular's build autoprefixed; `-webkit-backdrop-filter` is written by hand.
const CSS = `
${SURFACE_NAME}{display:contents}
${SURFACE_NAME} .rewind-scrim{position:fixed;inset:0;z-index:9400;background:transparent}
${SURFACE_NAME} .rewind-window{position:fixed;left:50%;bottom:4.25rem;transform:translateX(-50%);z-index:9401;width:min(60rem,94vw);display:flex;flex-direction:column;border:1px solid rgba(255,255,255,.12);border-radius:var(--hc-radius-floating);background:rgba(14,16,20,.82);-webkit-backdrop-filter:blur(14px) saturate(1.15);backdrop-filter:blur(14px) saturate(1.15);box-shadow:0 1.2rem 3rem rgba(0,0,0,.45);color:rgba(255,255,255,.88);overflow:hidden}
${SURFACE_NAME} .rewind-header{flex:0 0 auto;box-sizing:border-box;display:flex;align-items:center;gap:.5rem;height:2.875rem;min-height:2.875rem;padding:0 .75rem;line-height:1;background:linear-gradient(180deg,rgba(255,255,255,.018),rgba(255,255,255,.006));border-bottom:1px solid rgba(255,255,255,.08)}
${SURFACE_NAME} .rewind-header .title{font-size:.9rem;font-weight:600;letter-spacing:.04em}
${SURFACE_NAME} .rewind-header .path{flex:1;font-size:.75rem;color:rgba(255,255,255,.45);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
${SURFACE_NAME} .rewind-header .close{box-sizing:border-box;display:inline-grid;place-items:center;width:1.75rem;min-width:1.75rem;height:1.75rem;padding:0;background:none;border:none;border-radius:var(--hc-radius-floating);line-height:1;font-size:1.125rem;color:rgba(238,244,248,.62);cursor:pointer;transition:color 120ms ease,background-color 120ms ease,border-color 120ms ease}
${SURFACE_NAME} .rewind-header .close:hover{color:#fff;background-color:rgba(255,255,255,.075)}
${SURFACE_NAME} .rewind-header .close:focus-visible{outline:1px solid color-mix(in srgb,var(--hc-window-accent) 72%,white);outline-offset:1px}
${SURFACE_NAME} .filmstrip{display:flex;gap:.6rem;padding:.9rem 1rem .7rem;overflow-x:auto;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.18) transparent}
${SURFACE_NAME} .moment{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:.3rem;padding:.6rem .7rem .5rem;border:1px solid rgba(255,255,255,.09);border-radius:var(--hc-radius-card);background:rgba(255,255,255,.03);cursor:pointer;transition:transform 120ms ease,border-color 120ms ease,background 120ms ease}
${SURFACE_NAME} .moment:hover{transform:translateY(-2px);background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.2)}
${SURFACE_NAME} .moment.active{border-color:rgba(109,192,119,.75);background:rgba(109,192,119,.08);box-shadow:0 0 0 1px rgba(109,192,119,.35) inset}
${SURFACE_NAME} .moment .delta{font-size:.72rem;font-weight:600;letter-spacing:.02em}
${SURFACE_NAME} .moment .when{font-size:.66rem;color:rgba(255,255,255,.4);font-variant-numeric:tabular-nums}
${SURFACE_NAME} .mosaic{display:flex;align-items:center}
${SURFACE_NAME} .mosaic .hex{--hex-size:2.3rem;width:var(--hex-size);height:calc(var(--hex-size) * 1.1);clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);background:rgba(255,255,255,.07);display:flex;align-items:center;justify-content:center;overflow:hidden;flex:0 0 auto}
${SURFACE_NAME} .mosaic .hex:not(:first-child){margin-left:calc(var(--hex-size) * -0.18)}
${SURFACE_NAME} .mosaic .hex img{width:100%;height:100%;object-fit:cover;display:block}
${SURFACE_NAME} .mosaic .hex .letter{font-size:.8rem;font-weight:600;color:rgba(255,255,255,.5)}
${SURFACE_NAME} .mosaic .hex.more{font-size:.62rem;font-weight:600;color:rgba(255,255,255,.6);background:rgba(255,255,255,.1)}
${SURFACE_NAME} .mosaic .hex.empty{background:rgba(255,255,255,.04);border:1px dashed rgba(255,255,255,.12)}
${SURFACE_NAME} .behaviours{display:flex;align-items:center;gap:.55rem;padding:.45rem 1rem .55rem;border-top:1px solid rgba(255,255,255,.07)}
${SURFACE_NAME} .behaviours .step{background:none;border:1px solid rgba(255,255,255,.14);border-radius:var(--hc-radius-control);color:rgba(255,255,255,.75);width:1.6rem;height:1.6rem;line-height:1;font-size:1rem;cursor:pointer}
${SURFACE_NAME} .behaviours .step:hover:not(:disabled){background:rgba(255,255,255,.08);color:#fff}
${SURFACE_NAME} .behaviours .step:disabled{opacity:.25;cursor:default}
${SURFACE_NAME} .behaviours .track{display:flex;align-items:center;gap:.45rem;padding:0 .2rem;overflow-x:auto;position:relative}
${SURFACE_NAME} .behaviours .track::before{content:'';position:absolute;left:0;right:0;top:50%;height:1px;background:rgba(255,255,255,.12)}
${SURFACE_NAME} .behaviours .dot{position:relative;z-index:1;width:.55rem;height:.55rem;flex:0 0 auto;border-radius:50%;border:none;padding:0;background:var(--dot,rgba(255,255,255,.3));opacity:.55;cursor:pointer;transition:transform 100ms ease,opacity 100ms ease}
${SURFACE_NAME} .behaviours .dot:hover{opacity:.9;transform:scale(1.25)}
${SURFACE_NAME} .behaviours .dot.current{opacity:1;transform:scale(1.45);box-shadow:0 0 0 3px rgba(255,255,255,.12)}
${SURFACE_NAME} .behaviours .readout{display:flex;align-items:center;gap:.4rem;margin-left:auto;font-size:.72rem;color:rgba(255,255,255,.65);white-space:nowrap}
${SURFACE_NAME} .behaviours .readout .swatch{width:.55rem;height:.55rem;border-radius:50%;display:inline-block}
${SURFACE_NAME} .hint{padding:.35rem 1rem .5rem;font-size:.66rem;color:rgba(255,255,255,.32);text-align:center}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-rewind-window', '')
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

/** The nodes minted once in #build and kept for the element's whole life.
 *  Everything that carries a translated string lives here, which is what makes
 *  #relabel() enough for a locale switch; only the filmstrip's cards and the
 *  stepper's dots are rebuilt. */
type Chrome = {
  scrim: HTMLDivElement
  window: HTMLElement
  title: HTMLSpanElement
  path: HTMLSpanElement
  close: HTMLButtonElement
  filmstrip: HTMLDivElement
  behaviours: HTMLDivElement
  back: HTMLButtonElement
  track: HTMLSpanElement
  forward: HTMLButtonElement
  readout: HTMLSpanElement
  swatch: HTMLSpanElement
  readoutText: Text
  hint: HTMLElement
}

export class RewindWindowElement extends HTMLElement {

  /** Everything connectedCallback wired, torn down in one sweep. */
  #offs: Array<() => void> = []

  /** Chrome, built once and kept — see the type above. */
  #chrome: Chrome | null = null

  /** `visible()`. The window's whole open/closed state; the DOM is a
   *  projection of it, never the truth. */
  #visible = false

  /** `#entries()` — the lineage pool, enriched, oldest → newest. */
  #entries: readonly Step[] = []
  /** The `moments` computed, materialised whenever #entries changes: it is a
   *  pure function of the entries and nothing else. */
  #moments: readonly Moment[] = []
  /** `#position()` — the 1-based cursor position. */
  #position = 0
  /** `#locationSig()` — the address the filmstrip is showing. */
  #locationSig = ''
  /** Load generation; a reload whose seq is stale drops everything it read. */
  #loadSeq = 0

  /** Child layer sig → image sig ('' = resolved, no image). Immutable. */
  readonly #imageByChild = new Map<string, string>()
  /** Image sig → object URL for its thumbnail (or full bytes fallback). */
  readonly #urlByImage = new Map<string, string>()

  /** Live nodes the selection stream mutates — built with the strip/track they
   *  belong to, never keyed lookups into the DOM. */
  #momentNodes: Array<{ filename: string; node: HTMLButtonElement }> = []
  #hexNodes: Array<{ childSig: string; name: string; node: HTMLElement }> = []
  #dotNodes: Array<{ index: number; node: HTMLButtonElement }> = []
  /** Identity of the range the dot track currently draws; the track is rebuilt
   *  only when this changes, so scrubbing INSIDE a moment just moves a class. */
  #renderedRange: string | null = null

  /** Put away while the hive is covered (the installer), back on return —
   *  `signalSession(this.#visible)` with no announcement and no escape verbs,
   *  exactly as the component declared it. */
  readonly #session: WindowSession = {
    park: () => { this.#setVisible(false) },
    unpark: () => { this.#setVisible(true) },
  }
  #releaseSession: (() => void) | null = null

  // ── lifecycle ─────────────────────────────────────────────────────────

  connectedCallback(): void {
    installCss()
    this.#build()

    // A REGISTRY-FED ELEMENT IS MOUNTED ONCE AND STAYS, so it must start hidden
    // and open only on a real gesture. `EffectBus.on` calls the handler
    // synchronously with the last value when one exists, and that delivery is a
    // REPLAY, not a press: replaying a `rewind:toggle` from earlier in the
    // session would flip a window the participant already closed back open (and
    // `rewind:open` would re-open it outright). The Angular component could not
    // hit this — it was constructed at shell boot, before anything could emit —
    // so the guard is scoped as tightly as the hazard: swallow only the
    // delivery that happens DURING `on()`, and let every later emit through.
    const gesture = (effect: string, act: () => void): void => {
      let replay = true
      this.#offs.push(EffectBus.on(effect, () => { if (!replay) act() }))
      replay = false
    }
    gesture('rewind:open', () => this.#setVisible(true))
    gesture('rewind:close', () => this.#setVisible(false))
    gesture('rewind:toggle', () => this.#setVisible(!this.#visible))

    this.#offs.push(
      // The cursor's whole state. THIS ONE WANTS ITS REPLAY: it is a state
      // assertion, the handler only SETS fields, and re-delivering the same
      // payload twice (the seek's emit, then a post-commit reconcile) lands on
      // the same values — nothing here appends or counts. It also seeds
      // #position/#locationSig for a window that has never been opened.
      EffectBus.on<CursorState>('history:cursor-changed', (s) => {
        if (!s) return
        const locationChanged = s.locationSig !== this.#locationSig
        const grew = s.total !== this.#entries.length
        this.#position = s.position
        if (locationChanged) this.#locationSig = s.locationSig
        if ((locationChanged || grew) && this.#visible) void this.#reload()
        // Angular repainted on the `#position` signal write; the stream of
        // ticks that arrives while the slider is dragged must move classes on
        // the live cards, never rebuild them.
        this.#renderSelection()
      }),

      // THE PIPE WAS IMPURE. The Angular template resolved every string through
      // `| t`, declared `pure: false`, so every change-detection tick re-read
      // them and `/language ja` re-labelled an OPEN window on the spot. An
      // element renders when it decides to — and everything translated here is
      // written ONCE onto chrome (title, close, both stepper labels, the hint),
      // so without this they would freeze in the previous language until the
      // window was closed and reopened. The cards and dots carry no translated
      // text at all, which is why a relabel is enough and a rebuild would only
      // throw away the filmstrip's scroll position.
      EffectBus.on('locale:changed', () => this.#relabel()),
    )

    document.addEventListener('keydown', this.#onKeydown)
    this.#render()
  }

  disconnectedCallback(): void {
    this.#offs.forEach(off => off())
    this.#offs = []
    document.removeEventListener('keydown', this.#onKeydown)
    // Leave the window session, or the registry keeps holding a surface that is
    // no longer on screen and the next install parks a ghost. (The Angular
    // ngOnDestroy did not do this — its component was never destroyed, so the
    // leak never showed.)
    this.#releaseSession?.()
    this.#releaseSession = null
    // Orphan any reload still in flight: without this its continuation would
    // mint object URLs into a map nobody will ever revoke.
    this.#loadSeq++
    for (const url of this.#urlByImage.values()) URL.revokeObjectURL(url)
    this.#urlByImage.clear()
    this.#imageByChild.clear()
    this.#visible = false
    this.#entries = []
    this.#moments = []
    this.#momentNodes = []
    this.#hexNodes = []
    this.#dotNodes = []
    this.#renderedRange = null
    this.#chrome = null
    this.replaceChildren()
  }

  /** Escape / arrows. The original bound a RAW `document.addEventListener(
   *  'keydown', …)` — NOT Angular's `@HostListener('document:keydown.escape')`,
   *  whose KeyEventsPlugin binding name would have excluded every modifier
   *  chord. So there is no modifier guard here: adding one would invent
   *  semantics this window never had. It also does not preventDefault on
   *  Escape, so the press carries on down the escape cascade exactly as before. */
  readonly #onKeydown = (e: KeyboardEvent): void => {
    if (!this.#visible) return
    if (e.key === 'Escape') { this.#hide(); return }
    if (e.key === 'ArrowLeft' && this.#canStepBack()) { e.preventDefault(); this.#stepBack() }
    if (e.key === 'ArrowRight' && this.#canStepForward()) { e.preventDefault(); this.#stepForward() }
  }

  /** The two Angular `effect()`s that watched `visible()`, folded into the one
   *  place visibility can change. Both were TRANSITION effects — an effect only
   *  re-runs when the signal actually changes value — so a second
   *  `rewind:open` on an open window must reload nothing and re-hold nothing. */
  #setVisible(next: boolean): void {
    if (next === this.#visible) return
    this.#visible = next
    if (next) void this.#reload()
    // Showing = in the window session, whichever door opened it.
    if (next && !this.#releaseSession) this.#releaseSession = holdWindow(WINDOW_ID, this.#session)
    else if (!next && this.#releaseSession) { this.#releaseSession(); this.#releaseSession = null }
    this.#render()
  }

  #hide(): void { this.#setVisible(false) }

  // ── derived view state (the computeds, read on demand) ────────────────

  #activeIndex(): number { return this.#position - 1 }

  /** The moment whose range contains the cursor — stage 1's selection. */
  #activeMoment(): Moment | null {
    const pos = this.#position - 1
    if (pos < 0) return null
    return this.#moments.find(m => pos >= m.from && pos <= m.to) ?? null
  }

  /** Stage 2 — the behaviour steps INSIDE the active moment's range. */
  #behaviourSteps(): readonly Step[] {
    const moment = this.#activeMoment()
    if (!moment) return []
    return this.#entries.slice(moment.from, moment.to + 1)
  }

  #activeStep(): Step | null {
    const i = this.#activeIndex()
    return i >= 0 && i < this.#entries.length ? this.#entries[i] : null
  }

  #canStepBack(): boolean {
    const moment = this.#activeMoment()
    return !!moment && this.#activeIndex() > moment.from
  }

  #canStepForward(): boolean {
    const moment = this.#activeMoment()
    return !!moment && this.#activeIndex() < moment.to
  }

  /** The raw segments are read fresh; the sig was only ever the invalidation
   *  trigger, and this is resolved at paint time instead. */
  #pathLabel(): string {
    const nav = iocGet<NavigationService>(NAVIGATION_KEY)
    const segments = nav?.segmentsRaw() ?? []
    return segments.length > 0 ? '/' + segments.join('/') : '/'
  }

  /** Thumbnail object URL for a tile, or null while unresolved. */
  #thumbUrl(childSig: string): string | null {
    const imageSig = this.#imageByChild.get(childSig)
    if (!imageSig) return null
    return this.#urlByImage.get(imageSig) ?? null
  }

  /** `#entries.set(...)` plus the `moments` computed it drove. Each moment owns
   *  the entries up to (not including) the next one. */
  #setEntries(entries: readonly Step[]): void {
    this.#entries = entries
    const moments: Moment[] = []
    for (let i = 0; i < entries.length; i++) {
      const step = entries[i]
      if (!step.tileBoundary && moments.length > 0) continue
      const names = childTiles(step.content)
      moments.push({
        step,
        tiles: names.slice(0, MOSAIC_MAX),
        overflow: Math.max(0, names.length - MOSAIC_MAX),
        from: step.index,
        to: entries.length - 1, // patched below
      })
    }
    for (let m = 0; m < moments.length - 1; m++) {
      moments[m] = { ...moments[m], to: moments[m + 1].from - 1 }
    }
    this.#moments = moments
    this.#render()
  }

  // ── chrome (built once, DETACHED) ─────────────────────────────────────
  // Angular's `@if (visible())` meant none of this existed in the DOM at rest,
  // and this surface is mounted at boot and never unmounted — so it is built
  // detached and #render attaches/detaches it. `replaceChildren` MOVES an
  // existing node, so every click listener wired here survives every
  // show/hide cycle.
  #build(): void {
    if (this.#chrome) return

    const scrim = el('div', 'rewind-scrim')
    scrim.addEventListener('click', () => this.#hide())

    const win = document.createElement('section')
    win.className = 'rewind-window'
    win.setAttribute('role', 'dialog')

    const header = el('header', 'rewind-header')
    const title = el('span', 'title')
    const path = el('span', 'path')
    const close = el('button', 'close', '✕')
    close.type = 'button'
    close.addEventListener('click', () => this.#hide())
    header.append(title, path, close)

    const filmstrip = el('div', 'filmstrip')
    filmstrip.setAttribute('role', 'listbox')

    const behaviours = el('div', 'behaviours')
    const back = el('button', 'step', '‹')
    back.type = 'button'
    back.addEventListener('click', () => this.#stepBack())
    const track = el('span', 'track')
    const forward = el('button', 'step', '›')
    forward.type = 'button'
    forward.addEventListener('click', () => this.#stepForward())
    // The readout is its own `@if (activeStep(); as step)` — attached by
    // #renderSelection, and detached when there is no step to read out.
    const readout = el('span', 'readout')
    const swatch = el('span', 'swatch')
    const readoutText = document.createTextNode('')
    readout.append(swatch, readoutText)
    behaviours.append(back, track, forward)

    const hint = el('footer', 'hint')

    // `.behaviours` is itself an `@if (showBehaviours())`; it starts attached so
    // #renderSelection has a stable insertion point (before the hint) to put it
    // back at.
    win.append(header, filmstrip, behaviours, hint)

    this.#chrome = {
      scrim, window: win, title, path, close,
      filmstrip, behaviours, back, track, forward, readout, swatch, readoutText, hint,
    }
  }

  // ── rendering (rebuild-on-change — state lives here, never in the DOM) ─

  #render(): void {
    const chrome = this.#chrome
    if (!chrome) return

    // The template's own predicate — `@if (visible())` — kept in its POSITIVE
    // direction. Do not re-derive it by negating something else: this guard is
    // the difference between a hidden deck and a full-viewport scrim that eats
    // every click on the hive.
    if (!this.#visible) {
      chrome.scrim.remove()
      chrome.window.remove()
      // A closed window holding a few hundred detached cards is a leak with a
      // clip-path.
      chrome.filmstrip.replaceChildren()
      chrome.track.replaceChildren()
      this.#momentNodes = []
      this.#hexNodes = []
      this.#dotNodes = []
      this.#renderedRange = null
      return
    }

    this.#relabel()
    chrome.path.textContent = this.#pathLabel()

    // Rebuilding the strip resets its horizontal scroll. Angular's `@for` with
    // `track moment.step.filename` kept surviving cards in place, so a reload
    // that only appends a moment left the reader where they were. Save and
    // restore around the rebuild; the browser clamps whatever no longer fits.
    const scroll = chrome.filmstrip.scrollLeft
    this.#renderFilmstrip(chrome.filmstrip)
    chrome.filmstrip.scrollLeft = scroll

    // Entries changed under it, so the dots' captured steps are stale: force
    // the track to rebuild rather than let the range key match by accident.
    this.#renderedRange = null
    this.#renderSelection()

    // Back in, if it was out — moving live nodes, never re-creating them.
    if (chrome.scrim.parentNode !== this || chrome.window.parentNode !== this) {
      this.replaceChildren(chrome.scrim, chrome.window)
    }
  }

  /** Everything the `| t` pipe used to re-resolve on every tick. Safe to call
   *  against detached chrome — a locale switch while the window is closed just
   *  writes the new strings onto nodes the next open will attach. */
  #relabel(): void {
    const chrome = this.#chrome
    if (!chrome) return
    const title = t('rewind.title', 'Rewind')
    chrome.window.setAttribute('aria-label', title)
    chrome.title.textContent = title
    chrome.close.setAttribute('aria-label', t('rewind.close', 'Close'))
    chrome.back.setAttribute('aria-label', t('rewind.stepBack', 'Previous behaviour'))
    chrome.forward.setAttribute('aria-label', t('rewind.stepForward', 'Next behaviour'))
    chrome.hint.textContent =
      t('rewind.hint', 'pick a moment by its tiles · then step the behaviours inside it')
  }

  /** Stage 1 — the filmstrip. Rebuilt whole whenever the entries change, which
   *  is the only thing it depends on; the SELECTION is painted separately so a
   *  scrub never touches these nodes. */
  #renderFilmstrip(strip: HTMLDivElement): void {
    this.#momentNodes = []
    this.#hexNodes = []

    const cards = this.#moments.map(moment => {
      const card = el('button', 'moment')
      card.type = 'button'
      card.addEventListener('click', () => this.#pickMoment(moment))

      const mosaic = el('span', 'mosaic')
      for (const tile of moment.tiles) {
        const hex = el('span', 'hex')
        hex.title = tile.name
        this.#hexNodes.push({ childSig: tile.childSig, name: tile.name, node: hex })
        this.#paintHex(hex, tile.name, this.#thumbUrl(tile.childSig))
        mosaic.append(hex)
      }
      if (moment.overflow > 0) mosaic.append(el('span', 'hex more', `+${moment.overflow}`))
      if (moment.tiles.length === 0) mosaic.append(el('span', 'hex empty'))

      const delta = el('span', 'delta', moment.step.delta)
      delta.style.color = behaviourColor(moment.step.behaviour)

      card.append(mosaic, delta, el('span', 'when', when(moment.step.at)))
      this.#momentNodes.push({ filename: moment.step.filename, node: card })
      return card
    })

    strip.replaceChildren(...cards)
  }

  /** One hex: the thumbnail if it has resolved, the initial letter otherwise —
   *  the template's `@if (thumbUrl(tile.childSig); as url)`, whose `as` binding
   *  only took the truthy branch (a tile resolved to '' means "no image"). */
  #paintHex(hex: HTMLElement, name: string, url: string | null): void {
    if (url) {
      const img = document.createElement('img')
      img.src = url
      img.alt = name
      img.draggable = false
      hex.replaceChildren(img)
      return
    }
    hex.replaceChildren(el('span', 'letter', initial(name)))
  }

  /** A thumbnail landed. The Angular version bumped a tick signal and let the
   *  template re-read every hex; here the one child that resolved swaps its own
   *  letter for its picture, and nothing else in the strip is touched. */
  #paintThumbs(childSig: string): void {
    const url = this.#thumbUrl(childSig)
    if (!url) return
    for (const hex of this.#hexNodes) {
      if (hex.childSig !== childSig) continue
      if (hex.node.firstElementChild instanceof HTMLImageElement) continue
      this.#paintHex(hex.node, hex.name, url)
    }
  }

  /** Everything that follows the CURSOR: stage 1's highlight, stage 2's dots,
   *  the steppers and the readout. Called on every `history:cursor-changed`,
   *  which is a stream while the slider is dragged — so it MUTATES live nodes
   *  and rebuilds the dot track only when the active moment's range changes. */
  #renderSelection(): void {
    const chrome = this.#chrome
    if (!chrome || !this.#visible) return

    // `[class.active]="momentIsActive(moment)"` — compared by FILENAME, exactly
    // as the original did, so a rebuilt moments array still matches.
    const activeName = this.#activeMoment()?.step.filename
    for (const entry of this.#momentNodes) {
      entry.node.classList.toggle('active', entry.filename === activeName)
    }

    const steps = this.#behaviourSteps()
    // `showBehaviours()` in its original direction: `length > 1`. A moment with
    // no intermediate behaviours keeps stage 2 out of the DOM entirely.
    if (!(steps.length > 1)) {
      chrome.behaviours.remove()
      chrome.track.replaceChildren()
      chrome.readout.remove()
      this.#dotNodes = []
      this.#renderedRange = null
      return
    }
    if (chrome.behaviours.parentNode !== chrome.window) {
      chrome.window.insertBefore(chrome.behaviours, chrome.hint)
    }

    // The range's identity: its first entry and its length. Scrubbing INSIDE a
    // moment leaves this alone, so the dots keep their nodes (and their hover
    // transitions) and only `.current` moves.
    const range = `${steps[0].filename}:${steps.length}`
    if (range !== this.#renderedRange) {
      this.#renderedRange = range
      this.#dotNodes = steps.map(step => {
        const dot = el('button', 'dot')
        dot.type = 'button'
        dot.style.setProperty('--dot', behaviourColor(step.behaviour))
        dot.title = `${step.delta} · ${when(step.at)}`
        dot.addEventListener('click', () => this.#pickBehaviour(step))
        return { index: step.index, node: dot }
      })
      chrome.track.replaceChildren(...this.#dotNodes.map(d => d.node))
    }

    const index = this.#activeIndex()
    for (const dot of this.#dotNodes) dot.node.classList.toggle('current', dot.index === index)

    chrome.back.disabled = !this.#canStepBack()
    chrome.forward.disabled = !this.#canStepForward()

    const step = this.#activeStep()
    if (!step) { chrome.readout.remove(); return }
    chrome.swatch.style.background = behaviourColor(step.behaviour)
    chrome.readoutText.data = `${step.delta} · ${when(step.at)}`
    if (chrome.readout.parentNode !== chrome.behaviours) chrome.behaviours.append(chrome.readout)
  }

  // ── actions ───────────────────────────────────────────────────────────

  /** Stage 1 click: land on the moment's tile-boundary entry. */
  #pickMoment(moment: Moment): void {
    this.#seek(moment.step.index)
  }

  /** Stage 2: walk one behaviour within the range. */
  #stepBack(): void {
    if (this.#canStepBack()) this.#seek(this.#activeIndex() - 1)
  }

  #stepForward(): void {
    if (this.#canStepForward()) this.#seek(this.#activeIndex() + 1)
  }

  #pickBehaviour(step: Step): void {
    const moment = this.#activeMoment()
    if (!moment) return
    // Constrained by the range — a stale click outside it is dropped.
    if (step.index < moment.from || step.index > moment.to) return
    this.#seek(step.index)
  }

  #seek(index: number): void {
    const cursor = iocGet<CursorService>(CURSOR_KEY)
    if (!cursor) return
    cursor.seek(index + 1) // cursor positions are 1-based
  }

  // ── data ──────────────────────────────────────────────────────────────

  async #reload(): Promise<void> {
    const seq = ++this.#loadSeq
    const cursor = iocGet<CursorService>(CURSOR_KEY)
    const history = iocGet<HistoryService>(HISTORY_KEY)
    if (!cursor || !history?.listMarkerFilenames || !history.readMarker) return

    const locationSig = cursor.state.locationSig
    this.#locationSig = locationSig
    this.#position = cursor.state.position

    const filenames = await history.listMarkerFilenames(locationSig)
    if (seq !== this.#loadSeq) return

    const markers = await Promise.all(filenames.map(async (name) => {
      try { return await history.readMarker!(locationSig, name) } catch { return null }
    }))
    if (seq !== this.#loadSeq) return

    // Resolve child sigs → names first: tile identity is the NAME, so the
    // boundary detection must compare name sets, never raw sigs (a downstream
    // edit swaps sigs while the tiles stay put).
    const pending = new Set<string>()
    for (const m of markers) {
      for (const sig of childSigs(m?.parsed ?? null)) {
        if (!nameCache.has(sig)) pending.add(sig)
      }
    }
    if (pending.size > 0 && history.getLayerBySig) {
      await Promise.all([...pending].map(async (sig) => {
        try {
          const layer = await history.getLayerBySig!(sig)
          if (layer && typeof layer.name === 'string' && layer.name) {
            nameCache.set(sig, layer.name)
          }
        } catch { /* unresolvable — sig stands in for the name */ }
      }))
      if (seq !== this.#loadSeq) return
    }

    const steps: Step[] = []
    let prev: Content | null = null
    filenames.forEach((filename, i) => {
      const m = markers[i]
      const content = m?.parsed ?? null
      const { behaviour, delta, tileBoundary } = classify(prev, content)
      steps.push({
        index: i,
        at: m?.at ?? 0,
        filename,
        layerSig: m?.layerSig ?? '',
        content,
        behaviour,
        // The genesis entry is "the empty page" — a real undo target, but it
        // isn't an edit; a neutral dot reads better than a false delta.
        delta: i === 0 ? '·' : delta,
        tileBoundary: i === 0 ? true : tileBoundary,
      })
      if (content) prev = content
    })

    this.#setEntries(steps)
    // Kick off thumbnail resolution for every tile the filmstrip shows.
    void this.#hydrateThumbnails(seq)
  }

  /**
   * Resolve thumbnails for every tile in every moment's mosaic:
   * child layer → `properties[0]` → props → `small.image` → `thumbnails:hex`
   * pool record → object URL. Falls back to the full image bytes when no
   * thumbnail record exists yet; a tile with no image resolves to '' and
   * renders as an initial-letter hex.
   */
  async #hydrateThumbnails(seq: number): Promise<void> {
    const history = iocGet<HistoryService>(HISTORY_KEY)
    const store = iocGet<Store>(STORE_KEY)
    if (!history?.getLayerBySig || !store) return

    const wanted = new Set<string>()
    for (const moment of this.#moments) {
      for (const tile of moment.tiles) {
        if (!this.#imageByChild.has(tile.childSig)) wanted.add(tile.childSig)
      }
    }
    if (wanted.size === 0) return

    await Promise.all([...wanted].map(async (childSig) => {
      const imageSig = await this.#resolveImageSig(history, store, childSig)
      if (seq !== this.#loadSeq) return
      this.#imageByChild.set(childSig, imageSig ?? '')
      if (imageSig && !this.#urlByImage.has(imageSig)) {
        const blob = await this.#readThumbBlob(store, imageSig)
        if (seq !== this.#loadSeq || !blob) return
        if (!this.#urlByImage.has(imageSig)) {
          this.#urlByImage.set(imageSig, URL.createObjectURL(blob))
        }
      }
      this.#paintThumbs(childSig)
    }))
  }

  async #resolveImageSig(history: HistoryService, store: Store, childSig: string): Promise<string | null> {
    try {
      const layer = await history.getLayerBySig!(childSig)
      const propsSlot = (layer as Record<string, unknown> | null)?.['properties']
      if (!Array.isArray(propsSlot) || propsSlot.length === 0) return null
      let props: Record<string, unknown> | null = null
      const head = propsSlot[0]
      if (typeof head === 'string' && SIG_RE.test(head)) {
        const blob = await store.getResource(head)
        if (!blob) return null
        try { props = JSON.parse(await blob.text()) } catch { return null }
      } else if (head && typeof head === 'object') {
        props = head as Record<string, unknown>
      }
      const img = readImageSig(props)
      return img && SIG_RE.test(img) ? img : null
    } catch {
      return null
    }
  }

  /** Thumbnail record first (the derived pool, keyed by image sig — read
   *  through the pool's OWN reader now that this surface lives in essentials);
   *  full image bytes as the always-correct fallback. */
  async #readThumbBlob(store: Store, imageSig: string): Promise<Blob | null> {
    if (typeof store.getPool === 'function') {
      const hit = await readThumbnail(store as ThumbnailStore, imageSig)
      if (hit) return hit
    }
    try { return await store.getResource(imageSig) } catch { return null }
  }
}

// ── pure helpers ──────────────────────────────────────────────────────────

const behaviourColor = (b: Behaviour): string => BEHAVIOUR_COLOR[b]

const when = (at: number): string =>
  at > 0 ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''

const initial = (name: string): string => (name.trim()[0] ?? '·').toUpperCase()

function childSigs(content: Content | null): string[] {
  const kids = (content as Record<string, unknown> | null)?.['children']
  if (!Array.isArray(kids)) return []
  return kids.filter((s): s is string => typeof s === 'string' && SIG_RE.test(s))
}

function childTiles(content: Content | null): { name: string; childSig: string }[] {
  // Names resolve through the module-level cache the reload fills; an
  // unresolved sig stands in for itself so identity never collapses.
  const sigs = childSigs(content)
  return sigs.map(sig => ({ name: nameCache.get(sig) ?? sig, childSig: sig }))
}

// Shared between the element and the pure helpers: content-addressed layers
// mean a sig's name never changes, so one module-level cache is safe and never
// needs invalidation.
const nameCache = new Map<string, string>()

/**
 * Classify one step vs its predecessor. Tile-boundary when the child NAME set
 * changed; otherwise the dominant behaviour of whichever slot moved. Pure
 * display heuristic — never persisted.
 */
function classify(prev: Content | null, next: Content | null): {
  behaviour: Behaviour; delta: string; tileBoundary: boolean
} {
  if (!next) return { behaviour: 'system', delta: '·', tileBoundary: false }
  const prevNames = new Set(childTiles(prev).map(t => t.name))
  const nextNames = childTiles(next).map(t => t.name)
  const added = nextNames.filter(n => !prevNames.has(n)).length
  const removed = [...prevNames].filter(n => !nextNames.includes(n)).length
  if (added > 0 || removed > 0) {
    const parts: string[] = []
    if (added > 0) parts.push(`+${added}`)
    if (removed > 0) parts.push(`−${removed}`)
    return { behaviour: 'tiles', delta: parts.join(' '), tileBoundary: true }
  }
  // No membership change — find the first non-children slot delta.
  for (const key of new Set([...Object.keys(prev ?? {}), ...Object.keys(next)])) {
    if (key === 'name' || key === 'children') continue
    const a = slotArray(prev, key)
    const b = slotArray(next, key)
    if (!sameSet(a, b)) {
      if (key === 'tags') return { behaviour: 'tags', delta: 'tags', tileBoundary: false }
      if (key === 'notes') return { behaviour: 'notes', delta: 'notes', tileBoundary: false }
      return { behaviour: 'system', delta: key, tileBoundary: false }
    }
  }
  // Children sigs rippled (or props changed inside a tile) — content.
  return { behaviour: 'content', delta: 'edit', tileBoundary: false }
}

function slotArray(content: Content | null, key: string): unknown[] {
  const v = (content as Record<string, unknown> | null)?.[key]
  return Array.isArray(v) ? v : []
}

function sameSet(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false
  const bs = new Set(b.map(x => typeof x === 'string' ? x : JSON.stringify(x)))
  return a.every(x => bs.has(typeof x === 'string' ? x : JSON.stringify(x)))
}

function readImageSig(props: Record<string, unknown> | null): string | null {
  if (!props) return null
  const small = (props['small'] as Record<string, unknown> | undefined)?.['image']
  if (typeof small === 'string') return small
  const flat = props['flat'] as Record<string, unknown> | undefined
  const flatSmall = (flat?.['small'] as Record<string, unknown> | undefined)?.['image']
  return typeof flatSmall === 'string' ? flatSmall : null
}

// ── shell surface registration — the externalization path ────────────────
// Same name, same order band the Angular component held; the module-side
// `element:` shape (documentation/shell-surfaces.md). ORDER 3 is the lowest in
// the whole registry — this deck paints under almost everything, deliberately:
// the hive above it IS the preview, and nothing here may cover the chrome.
// DEFINED AT MODULE SCOPE, registered when a registry appears. A host with no
// ShellSurfaceRegistry (diamond-core-processor mounts tags directly in its own
// template) still needs the tag to be a real element rather than an inert
// unknown one — so the define cannot wait on the registry. Only the ADD does.
if (!customElements.get(SURFACE_NAME)) {
  customElements.define(SURFACE_NAME, RewindWindowElement)
}

window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/RewindWindowElement',
    element: SURFACE_NAME,
    order: 3,
  })
})
