// observe-viewer.view.ts — THE OBSERVE PANEL, as a framework-free custom
// element (everything-is-a-beehavior Phase 2: Angular panels leave the shell
// and ship as signed modules).
//
// A straight port of shared/ui/observe-viewer: same surface name
// (hc-observe-viewer), same order band (140), same panel id ('observe-viewer'
// — so the participant's saved width, text size and group membership come
// across), same one effect in and two effects out. It lands beside
// `observe.drone.ts`, the other half of this surface: the drone owns the
// read-model and the filter, this owns the reading of it.
//
// ── WHAT IT IS FOR ─────────────────────────────────────────────────────────
//
// The read-only view onto the swarm-as-observation substrate. `/observe`
// toggles it (ObserveDrone answers with `observe:render`). It lists the
// attributed data points at the current location — who is here and what they
// are sharing — ranked by live interest, and breathing: points appear and
// vanish as participants come and go.
//
// It renders STRAIGHT from the `observe:render` payload and sends intents back
// as effects: `observe:set-filter` (what I choose to see) and `observe:close`.
// OBSERVATION ONLY. There is deliberately no adopt/sync/act button here —
// acting on what you observe is the SAME features icon you use solo, so a
// swarm-specific control would be a new affordance, not a port.
//
// Neutrality is a VIEW choice: the drone omits a participant's human name when
// names are off; the panel falls back to a truncated pubkey — a neutral id
// that still distinguishes peers without revealing who. `#identify()` keeps
// the original's exact slice (8 chars + …, above a length of 10) because that
// fallback is the neutrality guarantee, not cosmetics.
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
// THE REPLAY IS THE TRUTH HERE, so it is not guarded. `EffectBus.on` hands the
// last `observe:render` to a late subscriber, and the drone is the sole owner
// of `open`: every exit this panel offers emits `observe:close`, which makes
// the drone publish `{open:false}` as the new last value. So a replay can only
// re-open a panel the drone still considers open — which is the correct answer
// for a module that loads after the verb was already used. The original placed
// the same unguarded trust in the payload; keeping it means the panel and the
// drone can never disagree about whether an observation is running.
//
// Because the host IS the panel (DockedPanelElement sizes, positions, grips
// and measures `this`), the Angular `:host { inset: 0; pointer-events: none }`
// full-bleed wrapper is gone and the `.observe-panel` rules land on the tag —
// the sequence-viewer / context-window precedent. The inset reporting the old
// `hcDockInset` directive did is folded into the same base.
//
// Its strings ship WITH it (observe-viewer.i18n.ts, extracted from all 14
// shell catalogs) and register under the 'app' namespace, so every key
// resolves exactly as before — the Phase 2 catalog split, another slice.

import { EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { DockedPanelElement } from '../panels/docked-panel.element.js'
import { OBSERVE_VIEWER_TRANSLATIONS } from './observe-viewer.i18n.js'

const SURFACE_NAME = 'hc-observe-viewer'

// ── mirrors of the read-model shapes (swarm-observation.ts) ───────────────
//
// Declared structurally rather than imported so this view stays a pure reader
// of the payload: nothing here may reach into the drone's module, exactly as
// the shared component could not.

interface ObservedParticipant {
  pubkey: string
  label?: string
  domain?: string
}

interface ObservedPoint {
  name: string
  layerSig?: string
  participant: ObservedParticipant
  interestCount: number
  changed: boolean
}

interface ObservationGroup {
  key: string
  label: string
  points: ObservedPoint[]
}

type ObservationGrouping = 'flat' | 'participant' | 'domain'

interface ObservationFilter {
  showNames: boolean
  groupBy: ObservationGrouping
}

interface ObserveRenderPayload {
  open: boolean
  groups: ObservationGroup[]
  filter: ObservationFilter
}

/** Rotation order for the single grouping chip — flat → participant → domain
 *  → flat, as the original's `cycleGroupBy` declared it. */
const GROUPINGS: readonly ObservationGrouping[] = ['flat', 'participant', 'domain']

/** English fallbacks for the RUNTIME-BUILT key `observe.group.<groupBy>`. A
 *  regex harvest cannot see those three keys, so they are spelled out here as
 *  well as in the i18n sibling. */
const GROUP_FALLBACK: Record<ObservationGrouping, string> = {
  flat: 'all',
  participant: 'by participant',
  domain: 'by domain',
}

const get = <T,>(key: string): T | undefined => window.ioc?.get?.<T>(key)

// Same contract as the shell pipe: params drive both pluralization
// (`key.one` / `key.other`, chosen on params.count by the i18n service) and
// `{token}` interpolation. The fallback is the English catalog text, and it
// interpolates the same tokens so a bare host with no i18n reads identically.
// (None of this panel's keys carry plural variants in any of the 14 catalogs —
// `observe.interest` is a bare `{count}` string — so there is no `tCount` here.)
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
  for (const [locale, catalog] of Object.entries(OBSERVE_VIEWER_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

// ── the styles the Angular SCSS carried, expanded to plain CSS ────────────
//
// No shadow DOM (the tutorial-overlay / sequence-viewer / context-window
// precedent), so Angular's `:host` becomes the tag name and every other
// selector is prefixed with it. `$accent: #7eb6d6` is inlined as
// `rgba(126,182,214,…)` at every call site; the shape ladder stays on the
// `:root` custom properties (_shape.scss publishes them app-wide) and the
// `var(--hc-*)` tokens are left alone. Angular's build autoprefixed;
// `-webkit-backdrop-filter` is written by hand.
//
// COLD STEEL on purpose: rgba(126,182,214) is the chrome / mesh-chrome accent
// — observation is quiet infrastructure, not a flashy surface, and the panel
// is not a dimming modal (the hive stays visible behind it).
//
// THREE EXPANSIONS WORTH NAMING:
//
//  • `@include tw.panel($accent, right)` was the LAST line of `.observe-panel`,
//    so its declarations won the cascade over the ones written above it. The
//    effective values are written here once — background rgba(13,15,21,.975)
//    (not rgba(12,16,20,.96)), border-left alpha .38 (not .45), the 14px/44px
//    shadow with the inset white hairline (not 10px/40px with the accent
//    hairline) and colour #eef2f5 (not #eef3f6) — rather than emitting both
//    and leaving five dead declarations in a document-level sheet. `width`,
//    `min-width`, `max-width`, `font-size` and `outline` are untouched by the
//    mixin and carry through.
//
//  • `.observe-chip` and `.observe-close` sit LATER in the sheet than the
//    `tw.header` action rules, but `…observe-header>button` (0,1,1) outranks
//    `…observe-chip` (0,1,0), so BOX GEOMETRY comes from the header band and
//    only paint comes from the chip: the chips are 1.75rem-tall inline-grid
//    cells with `border-radius: var(--hc-radius-control)` — the pill radius
//    and the .2em/.6em padding they ask for never applied, and `:hover`'s
//    accent wash loses its background to the band's rgba(255,255,255,.055)
//    while keeping its `color:#fff`. Same story on `.observe-close`, whose
//    `:hover{color:#7eb6d6}` (0,2,1) is outranked by the band's
//    `[class*='close']:hover{color:#fff}` (0,3,1). That ordering is reproduced
//    verbatim below so every header control lands where it always did.
//    `[aria-pressed='true']` (0,2,0) DOES win its three properties over the
//    band's (0,1,1) base rule, so the names chip still lights when it is on.
//
//  • `@include touch` is `@media (pointer: coarse)` and `@include phone-only`
//    is `@media (max-width: 599px)` — both re-target the tag rather than
//    `.observe-panel`, and both keep their source position so the later one
//    still wins at equal specificity.
const CSS = `
${SURFACE_NAME}{position:fixed;top:max(calc(2.3rem * var(--hc-header-zoom,1)),var(--hc-header-anchor));right:var(--hc-controls-right,0);bottom:0;z-index:100002;display:none;flex-direction:column;width:340px;min-width:280px;max-width:calc(100vw - 1.5rem);
  --hc-window-accent:#7eb6d6;--hc-window-radius-control:var(--hc-radius-control);--hc-window-radius-card:var(--hc-radius-card);--hc-window-radius-floating:var(--hc-radius-floating);
  background:rgba(13,15,21,.975);backdrop-filter:blur(14px) saturate(1.04);-webkit-backdrop-filter:blur(14px) saturate(1.04);border-radius:0;
  border-right:0;border-left:1px solid rgba(126,182,214,.38);box-shadow:-14px 0 44px rgba(0,0,0,.46),inset 1px 0 rgba(255,255,255,.025);
  font-family:var(--hc-mono,system-ui);font-size:calc(1rem * var(--hc-panel-scale,1));color:#eef2f5;outline:none}
${SURFACE_NAME}.open{display:flex}
${SURFACE_NAME} .observe-body{display:contents}
${SURFACE_NAME} .observe-header{flex:0 0 auto;box-sizing:border-box;display:flex;align-items:center;gap:.5rem;height:2.875rem;min-height:2.875rem;padding:0 .75rem;line-height:1;background:linear-gradient(180deg,rgba(255,255,255,.018),rgba(255,255,255,.006));border-bottom:1px solid rgba(126,182,214,.22)}
${SURFACE_NAME} .observe-header>button{box-sizing:border-box;display:inline-grid;place-items:center;min-width:1.75rem;height:1.75rem;padding:0 .25rem;border-radius:var(--hc-radius-control);line-height:1;transition:color 120ms ease,background-color 120ms ease,border-color 120ms ease}
${SURFACE_NAME} .observe-header>button:hover{background-color:rgba(255,255,255,.055)}
${SURFACE_NAME} .observe-header>button:focus-visible{outline:1px solid color-mix(in srgb,var(--hc-window-accent) 72%,white);outline-offset:1px}
${SURFACE_NAME} .observe-header>button[class*='close']{width:1.75rem;min-width:1.75rem;padding:0;font-size:1.125rem;color:rgba(238,244,248,.62)}
${SURFACE_NAME} .observe-header>button[class*='close']:hover{color:#fff;background-color:rgba(255,255,255,.075)}
${SURFACE_NAME} .observe-title{flex:1;font-size:.9em;letter-spacing:.05em;color:rgba(126,182,214,.95)}
${SURFACE_NAME} .observe-chip{flex:0 0 auto;background:rgba(126,182,214,.1);border:1px solid rgba(126,182,214,.25);border-radius:999px;color:rgba(238,243,246,.85);font-family:inherit;font-size:.66em;letter-spacing:.03em;padding:.2em .6em;cursor:pointer;transition:background 120ms ease,color 120ms ease}
${SURFACE_NAME} .observe-chip:hover{background:rgba(126,182,214,.2);color:#fff}
${SURFACE_NAME} .observe-chip[aria-pressed='true']{background:rgba(126,182,214,.28);border-color:rgba(126,182,214,.5);color:#fff}
${SURFACE_NAME} .observe-close{flex:0 0 auto;background:transparent;border:none;color:rgba(255,255,255,.7);font-size:1.4em;line-height:1;cursor:pointer;padding:0 .2em}
${SURFACE_NAME} .observe-close:hover{color:#7eb6d6}
${SURFACE_NAME} .observe-empty{margin:0;padding:1.5em 1em;font-size:.85em;color:rgba(255,255,255,.45)}
${SURFACE_NAME} .observe-scroll{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:.25em 0 .5em}
${SURFACE_NAME} .observe-group{border-bottom:1px solid rgba(255,255,255,.05)}
${SURFACE_NAME} .ogroup-header{display:flex;align-items:center;gap:.5em;padding:.55em 1em .3em}
${SURFACE_NAME} .ogroup-label{flex:1;font-size:.7em;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:rgba(126,182,214,.8);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${SURFACE_NAME} .ogroup-count{flex:0 0 auto;min-width:1.1em;padding:.02em .4em;border-radius:999px;text-align:center;font-size:.6em;font-family:var(--hc-mono,monospace);color:rgba(126,182,214,.85);background:rgba(126,182,214,.12)}
${SURFACE_NAME} .observe-list{list-style:none;margin:0;padding:0 0 .35em}
${SURFACE_NAME} .observe-row{display:flex;align-items:center;gap:.5em;padding:.45em 1em;transition:background 120ms ease}
${SURFACE_NAME} .observe-row:hover{background:rgba(126,182,214,.07)}
${SURFACE_NAME} .change-dot{flex:0 0 auto;width:.5em;height:.5em;border-radius:50%;background:#d8a657;box-shadow:0 0 0 2px rgba(216,166,87,.16)}
${SURFACE_NAME} .point-meta{flex:1;min-width:0;display:flex;flex-direction:column;gap:.15em}
${SURFACE_NAME} .point-name{font-size:.86em;color:#eef3f6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${SURFACE_NAME} .point-by{font-size:.68em;color:rgba(255,255,255,.5);display:inline-flex;align-items:center;gap:.4em}
${SURFACE_NAME} .point-domain{font-family:var(--hc-mono,monospace);font-size:.92em;color:rgba(126,182,214,.7)}
${SURFACE_NAME} .interest-pill{flex:0 0 auto;min-width:1.4em;padding:.06em .45em;border-radius:999px;text-align:center;font-size:.66em;font-family:var(--hc-mono,monospace);color:rgba(126,182,214,.95);background:rgba(126,182,214,.14);border:1px solid rgba(126,182,214,.3)}
@media (pointer:coarse){${SURFACE_NAME}{top:max(calc(3.65rem * var(--hc-header-zoom,1)),calc(var(--hc-header-anchor) + 1.02rem))}}
@media (max-width:599px){${SURFACE_NAME}{top:0}}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-observe-viewer', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

export class ObserveViewerElement extends DockedPanelElement {

  #offs: Array<() => void> = []

  /** THE visibility flag. The render payload, `close()` and the session's
   *  park/unpark all read and write THIS field — a second notion of "open"
   *  is exactly how the two drift apart after the first press. */
  #visible = false

  // Everything the panel draws lives HERE, never in the DOM, which is what
  // makes rebuild-on-change safe (no reconciler — the house pattern).
  #groups: ObservationGroup[] = []
  #showNames = true
  #groupBy: ObservationGrouping = 'flat'

  // Chrome built once per activation. The header must survive a re-render
  // because DockedPanelElement plants the settings gear inside it (and nudges
  // the close button over to make room) AFTER renderPanel() returns —
  // rebuilding the header would throw the gear away, and would also drop
  // focus from whichever chip the participant just pressed, on the very
  // round trip that press caused.
  #body: HTMLElement | null = null
  #titleEl: HTMLElement | null = null
  #namesChip: HTMLButtonElement | null = null
  #groupChip: HTMLButtonElement | null = null
  #closeEl: HTMLElement | null = null

  constructor() {
    super()
    // Same panel id the Angular `hcDockedPanel="observe-viewer"` carried, so
    // the saved width (`hc:docked-width:observe-viewer`), text size, code font
    // and group membership all come across with the participant.
    this.panelId = 'observe-viewer'
    this.dockSide = 'right'
    this.minWidth = 280
    this.maxWidth = 620
    this.defaultWidth = 340
    // Registry-fed: mounted once at boot, engaged only when the drone says so.
    this.autoActivate = false
    // The Angular original built this with
    // `signalSession(this.visible, undefined, { close: () => this.close() })`.
    // Reproduced literally, and the asymmetry is the WHOLE POINT:
    //
    //   park/unpark pass NO announce, so putting the panel away while the
    //   installer covers the hive emits NOTHING. Emitting `observe:close`
    //   there would stop the drone observing — we are hiding a window, not
    //   ending an observation, and the walk must keep feeding the panel so it
    //   is current when it comes back.
    //
    //   close DOES route to `this.close()`, which emits `observe:close` —
    //   because that one IS the participant deciding they are done looking.
    //
    // `close` is what the Escape cascade calls (the base registers it through
    // holdToolWindow/holdWindow); this panel never bound a keydown listener of
    // its own, in either implementation — so there is no `keydown.escape`
    // modifier guard to carry, and adding one would be inventing semantics.
    this.session = {
      park: () => { this.#hide() },
      unpark: () => { this.#show() },
      close: () => this.close(),
    }
  }

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
      // THE ONE EFFECT IN. It is a STATE ASSERTION, not an increment: the
      // handler SETS groups, filter and visibility from the payload, so the
      // same payload arriving twice (the swarm breathing twice on one gesture,
      // a set-filter round trip landing beside a presence change) lands the
      // identical panel. Nothing here appends or counts.
      EffectBus.on<ObserveRenderPayload>('observe:render', (p) => this.#onRender(p)),

      // THE PIPE WAS IMPURE. Angular's `t` pipe is declared `pure: false`, so
      // every change-detection tick re-resolved every string and `/language ja`
      // re-labelled an OPEN panel on the spot. An element renders when it
      // decides to, so the locale switch has to be a reason to render — else an
      // open window keeps its old-locale title, both chips, their tooltips, the
      // empty line and every row's "by {who}" until it is closed and reopened.
      // Rebuilding is safe: the rows live in `#groups`, never in the DOM.
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

  // ── the payload ──────────────────────────────────────────────────────

  /** Straight transcription of the original's `observe:render` subscriber —
   *  guard, groups, filter, visibility, in that order. */
  #onRender(p: ObserveRenderPayload | undefined): void {
    if (!p) return
    this.#groups = Array.isArray(p.groups) ? p.groups : []
    if (p.filter) {
      // `!== false` and not `=== true`: an absent flag means SHOW, which is the
      // filter's own default. Copied, never re-derived.
      this.#showNames = p.filter.showNames !== false
      this.#groupBy = this.#normGrouping(p.filter.groupBy)
    }
    // No sibling is closed here — see the note in files-viewer. Sharing an
    // edge is the lane's business, and it parks what it displaces.
    if (p.open) this.#show()
    else this.#hide()
    this.#render()
  }

  #normGrouping(g: unknown): ObservationGrouping {
    return g === 'participant' || g === 'domain' ? g : 'flat'
  }

  // ── the open / close verbs ───────────────────────────────────────────

  /** DockedPanelElement's close verb — the × and the lane's eviction fallback
   *  both land here, as does the Escape cascade through `session.close`. */
  protected override closePanel(): void { this.close() }

  /** The participant is done looking. EXACTLY ONE `observe:close` leaves per
   *  exit: the guard reproduces the reachability the Angular `@if` gave —
   *  `close()` was only ever callable while the panel was on screen, because
   *  its button and its session both went away with the DOM. */
  close(): void {
    if (!this.#visible) return
    this.#hide()
    // The drone answers with `observe:render {open:false, groups:[]}`, which is
    // what clears `#groups` — the original did not clear them here either.
    EffectBus.emit('observe:close', {})
  }

  #show(): void {
    if (this.#visible) return
    this.#visible = true
    this.classList.add('open')
    this.setAttribute('aria-label', t('observe.title', 'Observe'))
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
    this.#namesChip = null
    this.#groupChip = null
    this.#closeEl = null
  }

  // ── the two intents out ──────────────────────────────────────────────
  //
  // Both are REQUESTS, not local writes: the drone owns the filter (it
  // persists it), so the chips only light after the round trip. That is the
  // original's behaviour and it is the honest one — the chip reports the
  // filter that is actually in force.

  #toggleNames(): void {
    EffectBus.emit('observe:set-filter', { showNames: !this.#showNames })
  }

  /** Rotate flat → participant → domain → flat for a single chip control. */
  #cycleGroupBy(): void {
    const next = GROUPINGS[(GROUPINGS.indexOf(this.#groupBy) + 1) % GROUPINGS.length]
    EffectBus.emit('observe:set-filter', { groupBy: next })
  }

  // ── derived readings ─────────────────────────────────────────────────

  /** Neutral identity for a row — the human name when shown, else a truncated
   *  pubkey that distinguishes peers without revealing who. The slice, the
   *  ellipsis and the `—` floor are the original's, character for character:
   *  this is the neutrality guarantee, not a label. */
  #identify(participant: ObservedParticipant): string {
    if (participant?.label) return participant.label
    const pk = String(participant?.pubkey ?? '')
    return pk.length > 10 ? `${pk.slice(0, 8)}…` : (pk || '—')
  }

  /** POLARITY IS LOAD-BEARING: the template asked `@if (!hasPoints())`, so the
   *  empty line is what a groupless / pointless payload draws. Written as the
   *  original wrote it — never re-derived as a positive test, which would fall
   *  through to the list branch for anything `some()` cannot answer. */
  #hasPoints(): boolean {
    return this.#groups.some(g => g.points.length > 0)
  }

  // ── chrome (built once per activation) ───────────────────────────────
  protected override renderPanel(): void {
    const header = document.createElement('header')
    header.className = 'observe-header'

    const title = document.createElement('span')
    title.className = 'observe-title'

    const names = document.createElement('button')
    names.type = 'button'
    names.className = 'observe-chip'
    names.addEventListener('click', () => this.#toggleNames())

    const group = document.createElement('button')
    group.type = 'button'
    group.className = 'observe-chip'
    group.addEventListener('click', () => this.#cycleGroupBy())

    // LAST child on purpose: DockedPanelElement measures `header.lastElementChild`
    // to reserve the gear's slot, so the close button has to stay the far-edge
    // landmark it is in every tool window.
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'observe-close'
    close.textContent = '×'
    close.addEventListener('click', () => this.close())

    header.append(title, names, group, close)

    // `display: contents` — the empty line and the scroller stay flex items of
    // the PANEL (the scroller's `flex: 1` is what makes it the scrolling half),
    // while one node still holds everything a body rebuild replaces. Without
    // it, a rebuild that reached for the panel's own children would take the
    // base's resize grip and settings gear with it.
    const body = document.createElement('div')
    body.className = 'observe-body'

    this.append(header, body)
    this.#titleEl = title
    this.#namesChip = names
    this.#groupChip = group
    this.#closeEl = close
    this.#body = body

    this.#relabel()
    this.#render()
  }

  /** Re-resolve the strings written ONCE per activation — the ones a body
   *  rebuild never touches. The chips' own text and tooltips come back through
   *  `#syncChips` on every render, and the rows through `#renderBody`. */
  #relabel(): void {
    const heading = t('observe.title', 'Observe')
    this.setAttribute('aria-label', heading)
    if (this.#titleEl) this.#titleEl.textContent = heading
    this.#closeEl?.setAttribute('aria-label', t('observe.close', 'close'))
    this.#groupChip?.setAttribute(
      'title', t('observe.group.hint', 'Group: all · by participant · by domain'))
  }

  // ── rendering (rebuild on change — the house pattern, no reconciler) ──

  #render(): void {
    if (!this.#body) return
    this.#syncChips()
    this.#renderBody()
  }

  /** The header's two live controls. MUTATED, never rebuilt — the press that
   *  changes a chip is the press that causes this render, so re-creating the
   *  button would drop focus out of the panel on every toggle. Mutating an
   *  existing node on a state update is not a reconciler. */
  #syncChips(): void {
    const names = this.#namesChip
    if (names) {
      // Two runtime-chosen key PAIRS live here — no regex over the template
      // could see either, so both are named in the drift spec:
      //   text:    observe.names.on   | observe.names.off
      //   tooltip: observe.names.hide | observe.names.show
      names.textContent = this.#showNames
        ? t('observe.names.on', 'names')
        : t('observe.names.off', 'anon')
      names.setAttribute('title', this.#showNames
        ? t('observe.names.hide', 'Hide names')
        : t('observe.names.show', 'Show names'))
      // `[attr.aria-pressed]="showNames()"` — a real attribute, and the only
      // thing `[aria-pressed='true']` in the sheet can hang the lit state on.
      names.setAttribute('aria-pressed', String(this.#showNames))
    }
    const group = this.#groupChip
    if (group) {
      // THE RUNTIME-BUILT KEY: `('observe.group.' + groupBy()) | t` expands to
      // observe.group.flat / observe.group.participant / observe.group.domain.
      group.textContent = t(`observe.group.${this.#groupBy}`, GROUP_FALLBACK[this.#groupBy])
    }
  }

  #renderBody(): void {
    const body = this.#body
    if (!body) return

    // WHERE THE PARTICIPANT WAS. Angular kept ONE `.observe-scroll` node for the
    // panel's whole life, and `@for … track` only removed the rows that left —
    // so the swarm breathing underneath a reader who had scrolled down was
    // invisible. This render mints a fresh scroller, and a new node starts at
    // scrollTop 0, which on a LIVE list (presence changes arrive unprompted)
    // would yank the reader back to the top every few seconds. Measured before
    // the teardown, applied after the new scroller is in the document —
    // scrollTop on a detached node does not stick. Nothing in the list is
    // focusable, so there is no focus to snapshot.
    const scrollTop = body.querySelector('.observe-scroll')?.scrollTop ?? 0

    body.replaceChildren()

    if (!this.#hasPoints()) {
      const empty = document.createElement('p')
      empty.className = 'observe-empty'
      empty.textContent = t('observe.empty', 'No one else is here yet.')
      body.appendChild(empty)
      return
    }

    const scroll = document.createElement('div')
    scroll.className = 'observe-scroll'
    for (const group of this.#groups) scroll.appendChild(this.#renderGroup(group))
    body.appendChild(scroll)

    if (scrollTop > 0) scroll.scrollTop = scrollTop
  }

  #renderGroup(group: ObservationGroup): HTMLElement {
    const section = document.createElement('section')
    section.className = 'observe-group'

    // `@if (group.label)` — flat grouping yields ONE group with an empty key
    // and an empty label, and gets no header at all. Truthiness on the string,
    // exactly as the template asked it.
    if (group.label) {
      const head = document.createElement('header')
      head.className = 'ogroup-header'

      const label = document.createElement('span')
      label.className = 'ogroup-label'
      label.title = group.label
      label.textContent = group.label

      const count = document.createElement('span')
      count.className = 'ogroup-count'
      count.textContent = String(group.points.length)

      head.append(label, count)
      section.appendChild(head)
    }

    const list = document.createElement('ul')
    list.className = 'observe-list'
    for (const point of group.points) list.appendChild(this.#renderPoint(point))
    section.appendChild(list)

    return section
  }

  #renderPoint(point: ObservedPoint): HTMLElement {
    const row = document.createElement('li')
    row.className = 'observe-row'
    // The template's `[class.is-changed]` binding. No rule matches it in the
    // stylesheet today — it is carried anyway, because dropping a hook the
    // original exposed is a silent change to what a theme can reach.
    if (point.changed) row.classList.add('is-changed')

    if (point.changed) {
      // Passive "there are changes you haven't taken" cue. NOT an action: no
      // sync, no adopt. You act via the features icon.
      const dot = document.createElement('span')
      dot.className = 'change-dot'
      dot.setAttribute('title', t('observe.changed', 'has changes you haven\'t taken'))
      dot.setAttribute('aria-hidden', 'true')
      row.appendChild(dot)
    }

    const meta = document.createElement('div')
    meta.className = 'point-meta'

    const name = document.createElement('span')
    name.className = 'point-name'
    name.title = point.name
    name.textContent = point.name

    const by = document.createElement('span')
    by.className = 'point-by'
    by.appendChild(document.createTextNode(
      t('observe.by', 'by {who}', { who: this.#identify(point.participant) })))
    if (point.participant.domain) {
      const domain = document.createElement('span')
      domain.className = 'point-domain'
      domain.textContent = point.participant.domain
      by.appendChild(domain)
    }

    meta.append(name, by)
    row.appendChild(meta)

    // POLARITY, again: `> 0`, exactly as the template wrote it. The negated
    // form is ALSO false for a NaN interest count and would fall through into
    // painting a "NaN" pill.
    if (point.interestCount > 0) {
      const pill = document.createElement('span')
      pill.className = 'interest-pill'
      pill.setAttribute('title', t('observe.interest', '{count} here now', { count: point.interestCount }))
      pill.textContent = String(point.interestCount)
      row.appendChild(pill)
    }

    return row
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
  customElements.define(SURFACE_NAME, ObserveViewerElement)
}

window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/ObserveViewerElement',
    element: SURFACE_NAME,
    order: 140,
  })
})
