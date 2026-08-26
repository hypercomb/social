// context-window.view.ts — THE CONTEXT WINDOW, as a framework-free custom
// element (everything-is-a-beehavior Phase 2: Angular panels leave the shell
// and ship as signed modules).
//
// A straight port of shared/ui/context-window: same surface name
// (hc-context-window), same order band (112), same panel id
// ('context-window' — so the participant's saved width, text size and group
// membership come across), same four effects in and two effects out. It lands
// beside `context.queen.ts`, the `/context` door that opens it.
//
// ── WHAT IT IS FOR ─────────────────────────────────────────────────────────
//
// A tile carries `context` decorations: signatures pointing at BRANCHES that
// have meaning for questions about it. They are written by dragging a portal
// onto the tile, which is a one-second gesture with a permanent consequence —
// so there has to be somewhere that shows what is attached and takes it back
// off. An attachment you cannot see is indistinguishable from one that never
// saved, and an attachment you cannot remove is a decision you made once and
// can never revisit.
//
// This window shows the RESOLUTION, not just the list. Listing the branch
// names would answer "what did I attach" and leave the question that actually
// matters unanswered: how much does the model see? A branch is a live pointer
// at a subtree's current head, so what it brings grows and shrinks on its own.
// Every row therefore reports the walk — how many tiles it reached, and
// whether a budget cut it short. A window that showed a tidy name while
// quietly feeding 240 tiles into every request would be the exact failure it
// exists to prevent.
//
// Resolution is DERIVED and recomputed on open (assistant/tile-context.ts).
// Nothing here is cached onto the tile: caching would re-freeze precisely what
// the lineage address exists to keep live.
//
// ── LIFECYCLE NOTE ─────────────────────────────────────────────────────────
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
// full-bleed wrapper is gone and the `.ctx-panel` rules land on the tag —
// the sequence-viewer precedent. The inset reporting the old `hcDockInset`
// directive did is folded into the same base.
//
// Its strings ship WITH it (context-window.i18n.ts, extracted from all 14
// shell catalogs) and register under the 'app' namespace, so every key
// resolves exactly as before — the Phase 2 catalog split, another slice.

import { EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { DockedPanelElement } from '../panels/docked-panel.element.js'
import { CONTEXT_WINDOW_TRANSLATIONS } from './context-window.i18n.js'

const SURFACE_NAME = 'hc-context-window'

/** One attached branch, as `TileContext.resolve` returns it. */
type ContextBranch = {
  segments: readonly string[]
  targetSig: string
  decorationSig: string
  label: string
  nodeCount: number
  signatures: readonly string[]
  truncated: boolean
  error?: string
}

type TileContextLike = {
  resolve(segments: readonly string[]): Promise<readonly ContextBranch[]>
  detach(segments: readonly string[], decorationSig: string): boolean
}
type LineageLike = { explorerSegments?: () => readonly string[] }
type NavigationLike = { goRaw?(segments: readonly string[]): void }

const get = <T,>(key: string): T | undefined => window.ioc?.get?.<T>(key)

const sameSegments = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i])

// Same contract as the shell pipe: params drive both pluralization
// (`key.one` / `key.other`, chosen on params.count by the i18n service) and
// `{token}` interpolation. The fallback is the English catalog text, and it
// interpolates the same tokens so a bare host with no i18n reads identically.
const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  const i18n = get<I18nProvider>(I18N_IOC_KEY)
  const value = i18n?.t(key, params)
  if (value && value !== key) return value
  if (!params) return fallback
  return fallback.replace(/\{(\w+)\}/g, (whole, token: string) =>
    token in params ? String(params[token]) : whole)
}

/** The three counting strings have NO bare key in the catalogs — only
 *  `.one` / `.other`. The i18n service picks between them off `params.count`;
 *  the FALLBACK has to make the same choice itself, or a host with no catalog
 *  would read "1 branches attached". */
const tCount = (key: string, one: string, other: string, count: number): string =>
  t(key, count === 1 ? one : other, { count })

// The panel's strings travel with it — registered as soon as the i18n
// service is up, under 'app' so the keys resolve exactly as they always did.
window.ioc?.whenReady?.(I18N_IOC_KEY, (i18n) => {
  const provider = i18n as I18nProvider
  for (const [locale, catalog] of Object.entries(CONTEXT_WINDOW_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

// ── the styles the Angular SCSS carried, expanded to plain CSS ────────────
//
// No shadow DOM (the tutorial-overlay + sequence-viewer precedent), so
// Angular's `:host` becomes the tag name and every other selector is prefixed
// with it. `$accent: #ffa866` is inlined at every `rgba($accent, …)` call
// site; the shape ladder stays on the `:root` custom properties (_shape.scss
// publishes them app-wide) and the `var(--md-*)` tokens are left alone.
//
// AMBER on purpose: it matches the ring the drop draws when it lands ON a tile
// (drop-landing.drone ATTACH_STROKE 0xffa866), so the gesture that creates
// these rows and the window that manages them read as one thing.
//
// TWO EXPANSIONS WORTH NAMING:
//
//  • `@include tw.panel($accent, right)` was the LAST line of `.ctx-panel`, so
//    its declarations won the cascade over the ones written above it. The
//    effective values are written here once — background rgba(13,15,21,.975)
//    (not .96), border-left alpha .38 (not .5), the 14px/44px shadow (not
//    10px/40px) and colour #eef2f5 (not #f3f3f3) — rather than emitting both
//    and leaving four dead declarations in a document-level sheet.
//
//  • `.ctx-close`'s own rules sit LATER in the sheet than the `tw.header`
//    close-button rules, but `…ctx-header>button[class*='close']` outranks
//    `…ctx-close` on specificity, so width / padding / font-size / colour come
//    from the header band and only background / border / cursor / line-height
//    come from `.ctx-close`. That ordering is reproduced verbatim below so the
//    close button lands in the same place it always did.
//
// Angular's build autoprefixed; `-webkit-backdrop-filter` is written by hand.
const CSS = `
${SURFACE_NAME}{position:fixed;top:max(calc(2.3rem * var(--hc-header-zoom,1)),var(--hc-header-anchor));right:var(--hc-controls-right,0);bottom:0;z-index:100002;display:none;flex-direction:column;width:360px;min-width:280px;max-width:calc(100vw - 1.5rem);
  --hc-window-accent:#ffa866;--hc-window-radius-control:var(--hc-radius-control);--hc-window-radius-card:var(--hc-radius-card);--hc-window-radius-floating:var(--hc-radius-floating);
  background:rgba(13,15,21,.975);backdrop-filter:blur(14px) saturate(1.04);-webkit-backdrop-filter:blur(14px) saturate(1.04);border-radius:0;
  border-right:0;border-left:1px solid rgba(255,168,102,.38);box-shadow:-14px 0 44px rgba(0,0,0,.46),inset 1px 0 rgba(255,255,255,.025);
  font-family:var(--hc-mono,system-ui);font-size:calc(1rem * var(--hc-panel-scale,1));color:#eef2f5;outline:none}
${SURFACE_NAME}.open{display:flex}
${SURFACE_NAME} .ctx-body{display:contents}
${SURFACE_NAME} .ctx-header{flex:0 0 auto;box-sizing:border-box;display:flex;align-items:center;gap:.5rem;height:2.875rem;min-height:2.875rem;padding:0 .75rem;line-height:1;background:linear-gradient(180deg,rgba(255,255,255,.018),rgba(255,255,255,.006));justify-content:space-between;border-bottom:1px solid rgba(255,168,102,.25)}
${SURFACE_NAME} .ctx-header>button{box-sizing:border-box;display:inline-grid;place-items:center;min-width:1.75rem;height:1.75rem;padding:0 .25rem;border-radius:var(--hc-radius-control);line-height:1;transition:color 120ms ease,background-color 120ms ease,border-color 120ms ease}
${SURFACE_NAME} .ctx-header>button:hover{background-color:rgba(255,255,255,.055)}
${SURFACE_NAME} .ctx-header>button:focus-visible{outline:1px solid color-mix(in srgb,var(--hc-window-accent) 72%,white);outline-offset:1px}
${SURFACE_NAME} .ctx-header>button[class*='close']{width:1.75rem;min-width:1.75rem;padding:0;font-size:1.125rem;color:rgba(238,244,248,.62)}
${SURFACE_NAME} .ctx-header>button[class*='close']:hover{color:#fff;background-color:rgba(255,255,255,.075)}
${SURFACE_NAME} .ctx-heading{display:flex;align-items:baseline;gap:.5em;min-width:0}
${SURFACE_NAME} .ctx-title{font-size:.9em;letter-spacing:.05em;color:rgba(255,168,102,.95);flex-shrink:0}
${SURFACE_NAME} .ctx-cell{font-size:.8em;color:rgba(255,255,255,.62);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${SURFACE_NAME} .ctx-close{background:none;border:none;color:rgba(255,255,255,.55);font-size:1.2em;line-height:1;padding:0 .25em;cursor:pointer}
${SURFACE_NAME} .ctx-close:hover{color:#fff}
${SURFACE_NAME} .ctx-summary{margin:0;padding:.55em .9em;font-size:.72em;line-height:1.5;color:rgba(255,255,255,.62);border-bottom:1px solid rgba(255,255,255,.06)}
${SURFACE_NAME} .ctx-warn{margin-left:.4em;color:rgba(255,168,102,.9)}
${SURFACE_NAME} .ctx-empty{margin:0;padding:1.1em .9em;font-size:.75em;line-height:1.6;color:rgba(255,255,255,.5)}
${SURFACE_NAME} .ctx-list{list-style:none;margin:0;padding:.3em 0;overflow-y:auto;flex:1 1 auto}
${SURFACE_NAME} .ctx-row{display:flex;align-items:stretch;gap:.2em;padding:0 .4em}
${SURFACE_NAME} .ctx-row:hover{background:rgba(255,168,102,.07)}
${SURFACE_NAME} .ctx-row.broken .ctx-row-name{color:rgba(255,255,255,.45)}
${SURFACE_NAME} .ctx-row-body{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:.12em;padding:.5em .5em;background:none;border:none;text-align:left;color:inherit;font:inherit;cursor:pointer}
${SURFACE_NAME} .ctx-row-name{font-size:.82em;color:#f3f3f3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${SURFACE_NAME} .ctx-row-path{font-size:.68em;color:rgba(255,255,255,.4);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${SURFACE_NAME} .ctx-row-meta{font-size:.66em;color:rgba(255,255,255,.5)}
${SURFACE_NAME} .ctx-row-error{color:rgba(255,140,140,.8)}
${SURFACE_NAME} .ctx-detach{flex:0 0 auto;align-self:center;background:none;border:none;color:rgba(255,255,255,.4);padding:.35em;cursor:pointer;border-radius:var(--md-shape-xs,4px)}
${SURFACE_NAME} .ctx-detach .mat-sym{font-size:1.05em}
${SURFACE_NAME} .ctx-detach:hover{color:rgba(255,168,102,.95);background:rgba(255,168,102,.12)}
${SURFACE_NAME} .ctx-foot{flex:0 0 auto;padding:.6em .7em .8em;border-top:1px solid rgba(255,255,255,.07)}
${SURFACE_NAME} .ctx-ask{width:100%;display:inline-flex;align-items:center;justify-content:center;gap:.4em;padding:.55em .7em;font:inherit;font-size:.78em;color:rgba(255,168,102,.95);background:rgba(255,168,102,.1);border:1px solid rgba(255,168,102,.35);border-radius:var(--md-shape-xs,4px);cursor:pointer}
${SURFACE_NAME} .ctx-ask .mat-sym{font-size:1.05em}
${SURFACE_NAME} .ctx-ask:hover{background:rgba(255,168,102,.18)}
${SURFACE_NAME} .ctx-foot-note{margin:.5em 0 0;font-size:.66em;line-height:1.5;color:rgba(255,140,140,.7)}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-context-window', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

export class ContextWindowElement extends DockedPanelElement {

  #offs: Array<() => void> = []

  /** THE visibility flag. `open`, `close`, the toggle and the session's
   *  park/unpark all read and write THIS field — the toggle flipping some
   *  other notion of "open" than the one the open/close paths set is exactly
   *  how the two drift apart after the first press. */
  #visible = false

  /** The tile being managed, absolute. Captured on open, NOT derived from
   *  wherever the hive has since wandered: this window's whole subject is one
   *  tile's attachments, and re-resolving `here + label` after a hop would
   *  quietly start managing a different tile that shares the name. */
  #segments: readonly string[] = []

  #branches: readonly ContextBranch[] = []
  #loading = false

  // Chrome built once per activation. The header must survive a re-render
  // because DockedPanelElement plants the settings gear inside it (and nudges
  // the close button over to make room) AFTER renderPanel() returns —
  // rebuilding the header would throw the gear away.
  #body: HTMLElement | null = null
  #titleEl: HTMLElement | null = null
  #cellEl: HTMLElement | null = null
  #closeEl: HTMLElement | null = null

  constructor() {
    super()
    // Same panel id the Angular `hcDockedPanel="context-window"` carried, so
    // the saved width (`hc:docked-width:context-window`), text size, code font
    // and group membership all come across with the participant.
    this.panelId = 'context-window'
    this.dockSide = 'right'
    this.minWidth = 280
    this.maxWidth = 620
    this.defaultWidth = 360
    // Registry-fed: mounted once at boot, engaged only when something opens it.
    this.autoActivate = false
    // The Angular original built this with `signalSession(visible, announce,
    // { close })`. Reproduced literally: park/unpark flip visibility and
    // announce, WITHOUT the clearing that `close()` does — a window that came
    // back empty after the installer covered the hive would read as "my
    // context vanished". `close` is what the Escape cascade calls (the base
    // registers it through holdToolWindow/holdWindow); this panel never bound
    // a keydown listener of its own, in either implementation.
    this.session = {
      park: () => { this.#hide(); EffectBus.emit('context:window-state', { open: false }) },
      unpark: () => { this.#show(); EffectBus.emit('context:window-state', { open: true }) },
      close: () => this.close(),
    }
  }

  // ── derived readings ─────────────────────────────────────────────────
  get #label(): string {
    const s = this.#segments
    return s.length ? s[s.length - 1] : 'hive'
  }

  get #count(): number { return this.#branches.length }

  /** Total signatures across every branch, deduped — what a request would
   *  carry. The honest headline number, and the reason this window exists. */
  get #signatureCount(): number {
    const seen = new Set<string>()
    for (const b of this.#branches) for (const s of b.signatures) seen.add(s)
    return seen.size
  }

  get #tileCount(): number {
    return this.#branches.reduce((n, b) => n + b.nodeCount, 0)
  }

  /** True when ANY branch hit a walk budget — the totals above are floors,
   *  not counts, and the footer has to say so. */
  get #anyTruncated(): boolean { return this.#branches.some(b => b.truncated) }

  get #anyBroken(): boolean { return this.#branches.some(b => !!b.error) }

  // ── lifecycle ────────────────────────────────────────────────────────
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
      EffectBus.on<{ segments?: readonly string[]; cell?: string }>(
        'context:window-open', (p) => this.open(this.#resolveTarget(p))),

      // THE TOGGLE. It reads `#visible` and `#segments` — the SAME two fields
      // `open()` and `close()` write — so the third press after a `/context`
      // and a × still does what the first one did. Pointed at a DIFFERENT tile
      // it re-opens rather than closing: the press means "show me this one".
      EffectBus.on<{ segments?: readonly string[]; cell?: string }>(
        'context:window-toggle', (p) => {
          const target = this.#resolveTarget(p)
          if (this.#visible && sameSegments(target, this.#segments)) { this.close(); return }
          this.open(target)
        }),

      EffectBus.on('context:window-close', () => {
        if (this.#visible) this.close()
      }),

      // Something else changed this tile's attachments (a drop landed while the
      // window was open). Re-resolve rather than patch: the walk is the truth and
      // it is cheap enough to redo.
      EffectBus.on<{ segments?: readonly string[] }>('context:tile-changed', (p) => {
        if (!this.#visible) return
        if (p?.segments && !sameSegments(p.segments, this.#segments)) return
        void this.#refresh()
      }),

      // THE PIPE WAS IMPURE. Angular's `t` pipe is declared `pure: false`, so
      // every change-detection tick re-resolved every string and `/language ja`
      // re-labelled an OPEN panel on the spot. An element renders when it
      // decides to, so the locale switch has to be a reason to render — else an
      // open window keeps its old-locale title, counts, empty state, row meta
      // and the Ask button (its whole point) until it is closed and reopened.
      // Rebuilding is safe: the rows live in `#branches`, never in the DOM.
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
    super.disconnectedCallback()   // → deactivate(): lane, session, grip, gear, children
    this.#visible = false
    this.classList.remove('open')
    this.removeAttribute('aria-label')
    this.#forgetChrome()
  }

  // ── the open / close verbs ───────────────────────────────────────────

  /** Where the caller meant. An explicit path wins; a bare cell name is read
   *  against the page being stood on (how a tile action reports itself); with
   *  neither, the window manages the page itself. */
  #resolveTarget(p?: { segments?: readonly string[]; cell?: string }): readonly string[] {
    if (p?.segments?.length) return [...p.segments]
    const here = get<LineageLike>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? []
    const clean = here.map(s => String(s ?? '').trim()).filter(Boolean)
    return p?.cell ? [...clean, p.cell] : clean
  }

  open(segments: readonly string[]): void {
    this.#segments = [...segments]
    if (!this.#visible) {
      this.#show()
      EffectBus.emit('context:window-state', { open: true })
    }
    // Always re-walks, and the walk's first act is to paint (loading + the new
    // cell name), so re-opening onto a DIFFERENT tile renames the header now
    // rather than when the resolution lands.
    void this.#refresh()
  }

  close(): void {
    if (!this.#visible) return
    this.#hide()
    this.#branches = []
    this.#segments = []
    this.#loading = false
    EffectBus.emit('context:window-state', { open: false })
  }

  /** DockedPanelElement's close verb — the × and the lane's eviction fallback
   *  both land here. Exactly one `context:window-state {open:false}` leaves per
   *  exit: `close()` returns early when it is already shut. */
  protected override closePanel(): void { this.close() }

  #show(): void {
    if (this.#visible) return
    this.#visible = true
    this.classList.add('open')
    this.setAttribute('aria-label', t('context.window.title', 'Context'))
    this.activate()   // renderPanel + lane + session + grip + gear + inset
  }

  #hide(): void {
    if (!this.#visible) return
    this.#visible = false
    this.classList.remove('open')
    this.removeAttribute('aria-label')
    this.deactivate()   // clears the children — rebuild-on-open, like the `@if`
    this.#forgetChrome()
  }

  #forgetChrome(): void {
    this.#body = null
    this.#titleEl = null
    this.#cellEl = null
    this.#closeEl = null
  }

  // ── chrome (built once per activation) ───────────────────────────────
  protected override renderPanel(): void {
    const header = document.createElement('header')
    header.className = 'ctx-header'

    const heading = document.createElement('div')
    heading.className = 'ctx-heading'
    const title = document.createElement('span')
    title.className = 'ctx-title'
    title.textContent = t('context.window.title', 'Context')
    const cell = document.createElement('span')
    cell.className = 'ctx-cell'
    heading.append(title, cell)

    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'ctx-close'
    close.textContent = '×'
    close.setAttribute('aria-label', t('context.close', 'close'))
    close.addEventListener('click', () => this.close())
    header.append(heading, close)

    // `display: contents` — the summary, the empty line, the list and the
    // footer stay flex items of the PANEL (the list's `flex: 1 1 auto` is what
    // makes it the scrolling half), while one node still holds everything the
    // body rebuild replaces. Without it, a rebuild that reached for the panel's
    // own children would take the base's resize grip and settings gear with it.
    const body = document.createElement('div')
    body.className = 'ctx-body'

    this.append(header, body)
    this.#titleEl = title
    this.#cellEl = cell
    this.#closeEl = close
    this.#body = body
    this.#render()
  }

  /** Re-resolve the strings written ONCE per activation — the ones a body
   *  rebuild never touches. The body's own strings come back through
   *  `#renderBody`. */
  #relabel(): void {
    this.setAttribute('aria-label', t('context.window.title', 'Context'))
    if (this.#titleEl) this.#titleEl.textContent = t('context.window.title', 'Context')
    this.#closeEl?.setAttribute('aria-label', t('context.close', 'close'))
  }

  // ── data ─────────────────────────────────────────────────────────────

  /** Re-walk every attached branch.
   *
   *  The result is DISCARDED if the window has since been pointed at a
   *  different tile — a slow walk landing late must never paint one tile's
   *  context under another tile's name. (The original's one blind spot rides
   *  along unchanged: `close()` empties `#segments`, so a walk asked at the
   *  hive ROOT can still land after the window shut. It only ever writes to a
   *  field, never to a hidden panel's DOM, and the next `open()` re-walks
   *  before anything of it can be read.) */
  async #refresh(): Promise<void> {
    const svc = get<TileContextLike>('@diamondcoreprocessor.com/TileContext')
    const asked = this.#segments
    if (!svc?.resolve) { this.#branches = []; this.#render(); return }
    this.#loading = true
    this.#render()
    let rows: readonly ContextBranch[] = []
    try { rows = await svc.resolve(asked) }
    catch { rows = [] }
    if (!sameSegments(asked, this.#segments)) return
    this.#branches = rows
    this.#loading = false
    this.#render()
  }

  // ── row actions ──────────────────────────────────────────────────────

  /** Walk to the branch. It is a real place — the fastest way to judge whether
   *  it belongs here is to go and look at it. */
  #visit(branch: ContextBranch): void {
    get<NavigationLike>('@hypercomb.social/Navigation')?.goRaw?.([...branch.segments])
  }

  /** Take a branch back off. Detaching is the point of this window, so it is
   *  one press with no confirm: nothing is deleted (the branch is untouched —
   *  only the pointer goes), and re-attaching is a drag away. */
  #detach(branch: ContextBranch): void {
    const svc = get<TileContextLike>('@diamondcoreprocessor.com/TileContext')
    if (!svc?.detach || !branch.decorationSig) return
    // Optimistic: the row goes now. The write is a local decoration delta and
    // `context:tile-changed` re-resolves behind it, so a failure corrects
    // itself rather than leaving a row that ignores its own button.
    this.#branches = this.#branches.filter(b => b !== branch)
    this.#render()
    svc.detach(this.#segments, branch.decorationSig)
  }

  /** Ask about this tile. The window's reason to exist in one press: everything
   *  listed here is what that question gets to draw on — TRUE since the wiring
   *  pass, because the ask composers (llm.queen submitChat/submitAsk and the
   *  chat window's host tier) re-derive `contextSignaturesFor(segments)` at
   *  send. Nothing needs to travel from here: derivation is cheap, always
   *  current, and re-deriving beats carrying a list that could go stale between
   *  this press and the send. */
  #ask(): void {
    EffectBus.emit('ask:open', { prefill: '' })
  }

  /** Path for the row's second line — a branch is a place, and its address is
   *  how you tell two same-named branches apart. */
  #pathOf(branch: ContextBranch): string {
    return branch.segments.length ? '/' + branch.segments.join('/') : '/'
  }

  // ── rendering (rebuild on change — the house pattern, no reconciler) ──
  #render(): void {
    if (!this.#body) return
    if (this.#cellEl) this.#cellEl.textContent = this.#label
    this.#renderBody()
  }

  #renderBody(): void {
    const body = this.#body
    if (!body) return

    // WHERE THE PARTICIPANT WAS. Angular kept ONE `<ul class="ctx-list">` node
    // for the panel's whole life and `@for … track` only removed the rows that
    // left, so scrolling down the list and having a `context:tile-changed` (or
    // a `/language` switch) land underneath you was invisible. This render
    // mints a fresh `<ul>`, and a new node starts at scrollTop 0 with nothing
    // focused — the list would jump to the top mid-read, and a keyboard user
    // partway down it would be dropped out to <body> entirely.
    //
    // Rebuild-on-change is still the doctrine; what it owes is to put the
    // participant back where they were. Measured before the teardown, applied
    // after the new list is in the document (scrollTop on a detached node does
    // not stick), and the row is re-found BY INDEX because the row nodes
    // themselves are gone by then.
    const oldList = body.querySelector('.ctx-list')
    const scrollTop = oldList?.scrollTop ?? 0
    const focusedRow = oldList
      ? Array.from(oldList.children).findIndex(li => li.contains(document.activeElement))
      : -1

    body.replaceChildren()

    const count = this.#count
    const parts: HTMLElement[] = []

    // What the model actually gets. Stated before the list, because it is the
    // question the list is only evidence for.
    //
    // POLARITY IS LOAD-BEARING: `count > 0`, exactly as the template wrote it —
    // never the negated `count <= 0` guard, which is ALSO false for a NaN and
    // would fall straight through into painting "NaN branches attached".
    if (count > 0) {
      const summary = document.createElement('p')
      summary.className = 'ctx-summary'
      // The template's `[class.truncated]` binding. No rule matches it in the
      // stylesheet today — it is carried anyway, because dropping a hook the
      // original exposed is a silent change to what a theme can reach.
      if (this.#anyTruncated) summary.classList.add('truncated')
      // Three one-count fragments rather than one three-count string: the
      // catalog inflects on `count`, so a combined string could never say
      // "1 tile" correctly in any language.
      summary.append(
        document.createTextNode(
          tCount('context.count.branches', '1 branch attached', '{count} branches attached', count)),
        document.createTextNode(' · '),
        document.createTextNode(
          tCount('context.count.tiles', '1 tile', '{count} tiles', this.#tileCount)),
        document.createTextNode(' · '),
        document.createTextNode(
          tCount('context.count.signatures', '1 signature', '{count} signatures', this.#signatureCount)),
      )
      if (this.#anyTruncated) {
        summary.appendChild(document.createTextNode(' '))
        const warn = document.createElement('span')
        warn.className = 'ctx-warn'
        warn.textContent = t('context.window.truncated', '— capped, there is more')
        summary.appendChild(warn)
      }
      parts.push(summary)
    }

    if (this.#loading && count === 0) {
      const p = document.createElement('p')
      p.className = 'ctx-empty'
      p.textContent = t('context.window.loading', 'Reading the attached branches…')
      parts.push(p)
    } else if (count === 0) {
      // The empty state TEACHES the gesture — this window has no add button
      // of its own, so it has to name the one way in.
      const p = document.createElement('p')
      p.className = 'ctx-empty'
      p.textContent = t(
        'context.window.empty',
        'Nothing attached to “{cell}” yet. Drag a portal onto the tile to give its questions something to read.',
        { cell: this.#label })
      parts.push(p)
    } else {
      parts.push(this.#renderList(), this.#renderFoot())
    }

    body.append(...parts)

    // Now that the new list is in the document, put the participant back.
    // Only when there IS a new list: a render that landed on the empty or
    // loading state has nowhere to restore to, and must not resurrect focus
    // onto something that is no longer on screen.
    const newList = body.querySelector('.ctx-list')
    if (!newList) return
    if (scrollTop > 0) newList.scrollTop = scrollTop
    if (focusedRow >= 0) {
      const row = newList.children[focusedRow]
      // The row body is the focusable thing inside the <li>; if the list got
      // shorter, there is simply nothing to focus and we leave it alone rather
      // than moving focus somewhere the participant did not put it.
      row?.querySelector<HTMLElement>('.ctx-row-body')?.focus()
    }
  }

  #renderList(): HTMLElement {
    const list = document.createElement('ul')
    list.className = 'ctx-list'

    for (const branch of this.#branches) {
      const row = document.createElement('li')
      row.className = 'ctx-row'
      if (branch.error) row.classList.add('broken')

      const rowBody = document.createElement('button')
      rowBody.type = 'button'
      rowBody.className = 'ctx-row-body'
      rowBody.title = this.#pathOf(branch)
      rowBody.addEventListener('click', () => this.#visit(branch))

      const name = document.createElement('span')
      name.className = 'ctx-row-name'
      name.textContent = branch.label

      const path = document.createElement('span')
      path.className = 'ctx-row-path'
      path.textContent = this.#pathOf(branch)

      const meta = document.createElement('span')
      if (branch.error) {
        // Attached but unreadable — the pointer is real, the material is not
        // here. Named rather than hidden: a row you cannot see is a row you
        // cannot detach.
        meta.className = 'ctx-row-meta ctx-row-error'
        meta.textContent = t('context.row.unreadable', 'unreadable here')
      } else {
        meta.className = 'ctx-row-meta'
        meta.append(
          document.createTextNode(
            tCount('context.count.tiles', '1 tile', '{count} tiles', branch.nodeCount)),
          document.createTextNode(' · '),
          document.createTextNode(
            tCount('context.count.signatures', '1 signature', '{count} signatures',
              branch.signatures.length)),
        )
        if (branch.truncated) {
          meta.appendChild(document.createTextNode(' '))
          const warn = document.createElement('span')
          warn.className = 'ctx-warn'
          warn.textContent = t('context.row.truncated', '(capped)')
          meta.appendChild(warn)
        }
      }

      rowBody.append(name, path, meta)

      const detachLabel = t('context.detach', 'detach “{name}”', { name: branch.label })
      const detach = document.createElement('button')
      detach.type = 'button'
      detach.className = 'ctx-detach'
      detach.setAttribute('aria-label', detachLabel)
      detach.title = detachLabel
      detach.addEventListener('click', () => this.#detach(branch))
      const glyph = document.createElement('span')
      glyph.className = 'mat-sym'
      glyph.setAttribute('aria-hidden', 'true')
      glyph.textContent = 'link_off'
      detach.appendChild(glyph)

      row.append(rowBody, detach)
      list.appendChild(row)
    }
    return list
  }

  #renderFoot(): HTMLElement {
    const foot = document.createElement('footer')
    foot.className = 'ctx-foot'

    const ask = document.createElement('button')
    ask.type = 'button'
    ask.className = 'ctx-ask'
    const glyph = document.createElement('span')
    glyph.className = 'mat-sym'
    glyph.setAttribute('aria-hidden', 'true')
    glyph.textContent = 'forum'
    ask.append(glyph, document.createTextNode(
      t('context.ask', 'Ask about “{cell}”', { cell: this.#label })))
    ask.addEventListener('click', () => this.#ask())
    foot.appendChild(ask)

    if (this.#anyBroken) {
      const note = document.createElement('p')
      note.className = 'ctx-foot-note'
      note.textContent = t('context.window.broken',
        'A branch could not be read here — it may never have been adopted.')
      foot.appendChild(note)
    }
    return foot
  }
}

// ── shell surface registration — the externalization path ────────────────
// Same name, same order band the Angular component held; the module-side
// `element:` shape (documentation/shell-surfaces.md).
// DEFINED AT MODULE SCOPE, registered when a registry appears. A host
// with no ShellSurfaceRegistry (diamond-core-processor mounts these tags
// directly in its own template) still needs the tag to be a real element
// rather than an inert unknown one — so the define cannot wait on the
// registry. Only the ADD does.
if (!customElements.get(SURFACE_NAME)) {
  customElements.define(SURFACE_NAME, ContextWindowElement)
}

window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/ContextWindowElement',
    element: SURFACE_NAME,
    order: 112,
  })
})
