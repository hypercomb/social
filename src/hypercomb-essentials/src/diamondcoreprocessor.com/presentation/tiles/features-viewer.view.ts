// features-viewer.view.ts — THE BEEHAVIORS PANEL, as a framework-free custom
// element (everything-is-a-beehavior Phase 2: Angular panels leave the shell
// and ship as signed modules).
//
// A straight port of shared/ui/features-viewer: same surface name
// (hc-features-viewer), same order band (120), same panel id
// ('features-viewer' — so the participant's saved width, text size and group
// membership come across), the same effects in and out. It lands beside
// `show-features.drone.ts`, which owns `features:open` / `features:roster` —
// the two payloads this panel is the readout for — and is therefore the file
// that must import this one.
//
// Its three write-side siblings moved with it: `behavior-enablement.ts` (the
// pool's global lights), `feature-hidden.ts` (the legacy hidden-pool drain)
// and `feature-verified.ts` (the review gate's record). Unchanged files, new
// address.
//
// ── WHAT IT IS FOR — TWO SURFACES, ONE CONTROL ─────────────────────────────
// (see src/documentation/behaviors-view-simplification.md)
//
//   • THE POOL — no tile subject. Every behavior the app knows, one row each,
//     one light bulb each. Everything starts OFF; clicking lights it globally.
//     Off = dormant everywhere AND withheld from every swarm.
//
//   • THIS LAYER — the same rows, the same bulb, scoped here. Every
//     globally-lit behavior is listed; lit = its record is deposited on this
//     layer (directly, or flowing from an ancestor), dim = not here yet.
//     Clicking ON deposits the record and nothing else — it WAITS on the
//     objects beneath, and the behavior gives them meaning when they meet
//     (context-behaviors.md). Clicking OFF removes the record here (undoable).
//     Inherited rows carry one quiet "from {cell}" line and flip at their
//     origin. While open the panel FOLLOWS NAVIGATION.
//
// No verbs, no buttons on rows — the bulb is the whole story. Legacy
// hidden-pool records remain READABLE (a suppressed row renders dim with a
// one-tap restore) but are never minted again.
//
// THE ROSTER IS A SAFETY SURFACE. An unlisted kind is globally OFF, and a dark
// takeover reads as a plain hexagon with no hint — so every predicate below is
// the ORIGINAL's, copied rather than re-derived. `visible = count > 0` is not
// `if (count <= 0) hide`: both are false for a NaN, and the negated form falls
// straight through into painting a row that should not be there. A wrong
// roster is worse than no roster.
//
// Row data is NOT derived here. `show-features.drone` walks the layer and
// answers with `features:open` (the tile's rows) or `features:roster` (the
// pool's); this panel renders those payloads and asks for a fresh one whenever
// something could have made them stale.
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
// full-bleed wrapper is gone and the `.features-panel` rules land on the tag —
// the sequence-viewer / context-window / files-viewer precedent. The inset the
// old `hcDockInset="right"` directive reported is folded into the same base.
//
// PARK IS NOT CLOSE. The session's park/unpark flip visibility and announce
// WITHOUT the clearing `close()` does — the installer covering the hive must
// bring the same rows, selection and query back, and a panel that returned
// empty would read as "my beehaviors vanished". Safe only because every row
// lives in a field, never in the DOM: deactivate() throws the DOM away and the
// next activate() rebuilds it from state.
//
// ESCAPE. The Angular component bound NO keydown listener at all — its
// keyboard behaviour was declared through `signalSession(visible, announce,
// { dismiss, close })`, and the Escape cascade calls those through
// holdWindow/holdToolWindow. Reproduced exactly: this element registers no
// document keydown either, so the `keydown.escape` modifier guard the campaign
// owes panels ported FROM a HostListener does not apply here — adding it would
// be inventing a listener the original never had. The row-level
// `(keydown.enter)` / `(keydown.space)` bindings DID go through Angular's
// KeyEventsPlugin, which composes the binding name from held modifiers, so
// they matched only an UNMODIFIED press — those guards are carried.
//
// Its strings ship WITH it (features-viewer.i18n.ts, extracted from all 14
// shell catalogs) and register under the 'app' namespace, so every key
// resolves exactly as before — the Phase 2 catalog split, another slice. The
// five `health.*` keys are RUNTIME-BUILT (`health.${condition}`) and are named
// in the drift spec; `health.recovered` is NOT among them — that one is
// rendered by content-health.drone and stays there.

import {
  EffectBus,
  I18N_IOC_KEY,
  PHONE_QUERY,
  focusSnapshot,
  restoreFocus,
  AGGREGATION_LAYER_KEY,
  type AggregationLayerProvider,
  type I18nProvider,
} from '@hypercomb/core'
import { DockedPanelElement } from '../../panels/docked-panel.element.js'
import { FEATURES_VIEWER_TRANSLATIONS } from './features-viewer.i18n.js'
import { markVerified, markAllowedRoot, branchRootFor } from './feature-verified.js'
import { restoreFeature, loadHidden, hiddenKey, type HiddenFeature } from './feature-hidden.js'
import { setKindGlobalOn, ENABLEMENT_CHANGED } from './behavior-enablement.js'

const SURFACE_NAME = 'hc-features-viewer'

const get = <T,>(key: string): T | undefined => window.ioc?.get?.<T>(key)

// The aggregation layer lives in essentials (groups/) and is resolved lazily —
// these shims keep the call sites reading exactly as they did in the component
// and answer the empty case when the module has not loaded yet.
const aggregationLayer = (): AggregationLayerProvider | undefined =>
  get<AggregationLayerProvider>(AGGREGATION_LAYER_KEY)
const enableAggregation: AggregationLayerProvider['enableAggregation'] = (g, s, m) =>
  aggregationLayer()?.enableAggregation(g, s, m) ?? Promise.resolve(null)
const disableAggregation: AggregationLayerProvider['disableAggregation'] = (g, s) =>
  aggregationLayer()?.disableAggregation(g, s) ?? Promise.resolve(false)
const listAggregation: AggregationLayerProvider['listAggregation'] = (g) =>
  aggregationLayer()?.listAggregation(g) ?? Promise.resolve([])

/** How long a row treats another press as THE SAME PRESS. See #isRepeatPress:
 *  a switch nobody saw move gets pressed again, and without this the second
 *  press undoes the first. */
const PRESS_REPEAT_MS = 400

/** Download-leash trip point: this much SILENCE (no progress tick, no done)
 *  means the producer died mid-walk — matches the sync pill's stale guard. */
const DOWNLOAD_STALL_MS = 90_000

/** Backstop leash for a row action: the drone answers every add/remove with
 *  `features:outcome` — this fires only when the producer died. */
const ROW_LEASH_MS = 4000

/** Shell-safe slice of the essentials picker, resolved through IoC. */
type SelectModeLike = { arm(): void }
const SELECT_MODE_KEY = '@diamondcoreprocessor.com/SelectModeDrone'

/** Sticky pool filter: '0' = anchored (tile-bound) behaviors hidden. */
const ANCHORED_PREF_KEY = 'hc:behaviors-pool-anchored'

// ── the payload shapes, exactly as the drone puts them on the bus ──────────

/** A feature applied to the tile — a decoration (or slot) it carries. */
interface FeatureRow {
  view: string
  /** Material Symbols ligature declared by this behavior. */
  icon: string
  kind: string
  label: string
  description: string
  slashCommand?: string
  behavior?: string
  /** True when this is a VIEW BEHAVIOUR whose view can be entered (slides,
   *  website, home, tutor). The row gets an Open action. */
  openable?: boolean
  /** True when the view opens IN PLACE over the current layer (no navigation). */
  opensInPlace?: boolean
  /** True when this behaviour has a REACH to choose — its content can be read
   *  from the layer's own children or from the whole hierarchy beneath. That
   *  is the one thing a row has to MANAGE. */
  manageScopes?: boolean
  /** Which reach it is reading right now. */
  sourceScope?: 'layer' | 'hierarchy'
  /** The bee to ask for a reach change (`scope layer` / `scope hierarchy`). */
  queenKey?: string
  branchSig?: string
  /** True when this feature, declared on a container, flows to its subtree. */
  cascades?: boolean
  /** `direct` = on this tile; `cascade` = inherited from an ancestor
   *  (named by `originCell`, absent = the hive root). */
  origin?: 'direct' | 'cascade'
  originCell?: string
  originSegments?: string[]
  /** For a SCOPE feature (a website): the site ROOT's path. */
  scopeSegments?: string[]
  /** Legacy row-key scope marker (kept for stable row keys). */
  hideAt?: 'node' | 'origin'
  /** True when no module here declares this kind — named from its kind,
   *  inert until its module arrives. */
  foreign?: boolean
  module?: string
  /** Gate data still stamped by the producer — the download path uses the
   *  sig; the panel renders no chip for it (the review surface is the gate). */
  gated?: boolean
  gateSig?: string
  publisherDomain?: string
  /** True when the global light is off for this kind. The store is where it
   *  comes back — a dormant row is filtered from the tile view entirely. */
  dormant?: boolean
  /** Set when this behaviour BELONGS to this tile — bound to its location
   *  signature, so it shows here and is withdrawn everywhere else. */
  bound?: BehaviorBinding
}

/** Where a behaviour belongs — the bound tile's LOCATION signature (stable
 *  across every edit of that tile), its canonical path, and its name. */
interface BehaviorBinding {
  sig: string
  path: string
  name?: string
}

/** One row of THE STORE — every behavior the app knows. `on` is the light;
 *  `used` is the badge (decorations referencing it, counted, never stored). */
interface StoreRow {
  view: string
  icon: string
  kind: string
  label: string
  description: string
  category: string
  slashCommand?: string
  foreign?: boolean
  module?: string
  on: boolean
  used?: number
  /** Present when the behaviour is bound to one or more tiles — the store is
   *  the census, so it is the one surface that names every binding at once. */
  bound?: BehaviorBinding[]
}

/** A behavior the app knows but this tile doesn't carry yet. */
interface AvailableRow {
  view: string
  icon: string
  kind: string
  label: string
  description: string
  slashCommand?: string
  cascades?: boolean
  /** True when the panel can ADD this feature mechanically. */
  addable?: boolean
  /** True when this behaviour is a VIEW — a surface you can be standing in. */
  isView?: boolean
  /** True when this kind's light is off, or it belongs to another tile. */
  globalOff?: boolean
  /** Set when this behaviour belongs to this tile. */
  bound?: BehaviorBinding
}

/** One row of THIS LAYER's single list — an applied row and an available row
 *  flattened to the same shape, so the list renders one control: the bulb.
 *  `feat` keeps the source row for the selection/bulk helpers. */
interface LayerRow {
  kind: string
  view: string
  icon: string
  label: string
  description: string
  slashCommand?: string
  on: boolean
  applied: boolean
  /** Lit from an ancestor (or a website scope root) — flips at its origin. */
  inherited: boolean
  /** A lit view behaviour can be ENTERED — the hover-only Open affordance. */
  openable: boolean
  /** This behaviour is a VIEW. Views live in the same list as everything
   *  else — the only difference is the row's background. */
  isView: boolean
  /** This row has a reach to choose — it grows the manage affordance. */
  manageScopes: boolean
  sourceScope?: 'layer' | 'hierarchy'
  queenKey?: string
  originCell?: string
  foreign?: boolean
  module?: string
  bound?: BehaviorBinding
  feat: FeatureRow | AvailableRow
}

/** Minimal shape the selection / bulk helpers need. */
type RowLike = {
  kind: string
  view: string
  label: string
  branchSig?: string
  gateSig?: string
  originSegments?: string[]
  hideAt?: 'node' | 'origin'
}

interface FeatureGroup {
  cell: string
  segments: string[]
  applied: FeatureRow[]
  available: AvailableRow[]
  adopted: boolean
}

/** One row of the download pathway stepper: sent → receiving → done. */
interface DownloadPath {
  cell: string
  stage: 1 | 2 | 3
  active: boolean
  ok: boolean
  stalled?: boolean
  files: number
  failed: number
}

interface DownloadResult {
  cell: string
  ok: boolean
  files: number
  failed: number
  stalled?: boolean
}

interface FeaturesOpenPayload {
  cell: string
  segments: string[]
  applied: FeatureRow[]
  available: AvailableRow[]
  adopted?: boolean
  /** The view this layer OPENS AS — '' when it has none. */
  defaultView?: string
}

interface ReviewTarget {
  cell: string
  segments: string[]
  sig: string
  kind: string
  label: string
  code: string
}

type LineageLike = EventTarget & { explorerSegments?: () => readonly string[] }
type NavigationLike = { go?: (segments: readonly string[]) => void }
type QueenLike = { invoke?: (args: string) => Promise<void> | void }
type StoreLike = { getResource?: (sig: string) => Promise<Blob | null> }

// ── i18n ──────────────────────────────────────────────────────────────────
//
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

/** The inflected strings whose catalogs carry ONLY `.one` / `.other` — the
 *  i18n service picks between them off `params.count`, and the FALLBACK has to
 *  make the same choice itself or a host with no catalog would read
 *  "1 rows selected". */
const tCount = (key: string, one: string, other: string, count: number): string =>
  t(key, count === 1 ? one : other, { count })

/** `features.selection` is spelled the other way round: `.one` exists, the
 *  plural has no `.other` — the BARE key carries it, and the service falls
 *  through to the bare key exactly that way. */
const selectionLabel = (count: number): string =>
  t('features.selection',
    count === 1 ? 'beehaviors of the selected tile' : 'beehaviors of {count} selected tiles',
    { count })

/** English fallbacks for the RUNTIME-BUILT key `` `health.${condition}` `` —
 *  the quiet WHY line under a row's failure note. Five keys reached from one
 *  call site, invisible to a regex harvest, so they are spelled out here and
 *  named in the drift spec. `healthy` never reaches `t()` (guarded above it),
 *  and `health.recovered` belongs to content-health.drone, not to this panel. */
const HEALTH_WHY: Record<string, string | undefined> = {
  'offline': "you're offline — showing what's saved on this device",
  'host-down': "{host} isn't answering — some images can't load right now. they'll come back when it does.",
  'waiting': 'waiting for {n} files from the swarm',
  'missing': 'nobody we know has this content yet',
  'tampered': "a file from {host} didn't match its signature and was ignored",
}

// The panel's strings travel with it — registered as soon as the i18n service
// is up, under 'app' so the keys resolve exactly as they always did.
window.ioc?.whenReady?.(I18N_IOC_KEY, (i18n) => {
  const provider = i18n as I18nProvider
  for (const [locale, catalog] of Object.entries(FEATURES_VIEWER_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

// ── the styles the Angular SCSS carried, expanded to plain CSS ────────────
//
// No shadow DOM (the tutorial-overlay / sequence-viewer precedent), so
// Angular's `:host` becomes the tag name and every other selector is prefixed
// with it. `$accent: #c8b8ff` (the violet of the tile overlay's puzzle-piece
// hover tint 0xc8b8ff) is inlined at every `rgba($accent, …)` call site as
// rgba(200,184,255, …); `$view-ground: #a8d8ff` (the cool blue a VIEW wears
// everywhere, tile-overlay hover tint 0xa8d8ff) as rgba(168,216,255, …); the
// pathway trio `$path-active #e0a93e` / `$path-ok #6ec96e` / `$path-fail
// #e08a8a` likewise. `tw.$radius-control` (2px) and `tw.$radius-card` (3px)
// are the literals the SCSS compiled to; `$gutter` is 1rem and `$gutter-phone`
// 0.7rem. `var(--hc-*)` is left alone.
//
// FOUR EXPANSIONS WORTH NAMING:
//
//  • `@include tw.panel($accent, right)` was the LAST line of the second
//    `.features-panel` rule, so its declarations won the cascade over the ones
//    written 850 lines above it. The effective values are carried once —
//    background rgba(13,15,21,.975) (not rgba(14,14,22,.96)), border-left
//    alpha .38 (not .5), the 14px/44px shadow (not the 10px/40px pair with the
//    inset accent ring) and colour #eef2f5 (not #f3f3f3) — rather than
//    emitting both and leaving four dead declarations in a document sheet.
//
//  • THE PANEL RULE IS SPLIT IN TWO, and the split is load-bearing. The phone
//    block sits BETWEEN the two `.features-panel` rules in the original sheet,
//    so its `border:none` / `box-shadow:none` / `min-width:0` are themselves
//    overridden by the later tw.panel line — on a phone the border and shadow
//    come back and the minimum stays 300px. Collapsing everything into one
//    early rule would silently hand those three declarations to the phone.
//    So: geometry and font-size first, the tw.panel material AFTER the phone
//    block, exactly where the original put it.
//
//  • `@include tw.header` is expanded to the shared band (height 2.875rem,
//    padding 0 .75rem, the `> button` hit area and the close-button
//    treatment), then the panel's own later rule overrides min-height to
//    3.35rem, the inline padding to 1rem/.7rem, the gap to .4rem and the
//    accent border-bottom to 0. The band's
//    `…features-header>button[class*='close']` outranks `…features-close` on
//    specificity, so width / padding / font-size / colour and the hover colour
//    come from the band and only background / border / cursor come from
//    `.features-close`. That ordering is reproduced verbatim so the close
//    button lands where it always did.
//
//  • `@keyframes dl-pulse` is renamed `hc-features-dl-pulse`: animation names
//    are a GLOBAL namespace and this sheet lives in document.head.
//
// Angular's build autoprefixed; `-webkit-backdrop-filter` is written by hand
// (`-webkit-box-orient` / `-webkit-line-clamp` were already hand-written).
const CSS = `
${SURFACE_NAME}{position:fixed;top:max(calc(2.3rem * var(--hc-header-zoom,1.0)),var(--hc-header-anchor));right:var(--hc-controls-right,0);bottom:0;z-index:100002;display:none;flex-direction:column;max-width:calc(100vw - 1.5rem);font-size:calc(1rem * var(--hc-panel-scale,1))}
${SURFACE_NAME}.open{display:flex}
${SURFACE_NAME} .features-body,${SURFACE_NAME} .features-slot{display:contents}

${SURFACE_NAME} .features-header{flex:0 0 auto;box-sizing:border-box;display:flex;align-items:center;gap:.4rem;height:2.875rem;min-height:3.35rem;padding:0 .7rem 0 1rem;line-height:1;background:linear-gradient(180deg,rgba(255,255,255,.018),rgba(255,255,255,.006));border-bottom:0}
${SURFACE_NAME} .features-header>button,${SURFACE_NAME} .features-header>[class*='actions']>button{box-sizing:border-box;display:inline-grid;place-items:center;min-width:1.75rem;height:1.75rem;padding:0 .25rem;border-radius:2px;line-height:1;transition:color 120ms ease,background-color 120ms ease,border-color 120ms ease}
${SURFACE_NAME} .features-header>button:hover,${SURFACE_NAME} .features-header>[class*='actions']>button:hover{background-color:rgba(255,255,255,.055)}
${SURFACE_NAME} .features-header>button:focus-visible,${SURFACE_NAME} .features-header>[class*='actions']>button:focus-visible{outline:1px solid color-mix(in srgb,var(--hc-window-accent) 72%,white);outline-offset:1px}
${SURFACE_NAME} .features-header>button[class*='close'],${SURFACE_NAME} .features-header>button.close,${SURFACE_NAME} .features-header>[class*='actions']>button[class*='close']{width:1.75rem;min-width:1.75rem;padding:0;font-size:1.125rem;color:rgba(238,244,248,.62)}
${SURFACE_NAME} .features-header>button[class*='close']:hover,${SURFACE_NAME} .features-header>button.close:hover,${SURFACE_NAME} .features-header>[class*='actions']>button[class*='close']:hover{color:#fff;background-color:rgba(255,255,255,.075)}

${SURFACE_NAME} .features-select-tile{display:none}

${SURFACE_NAME} .features-selection{display:flex;align-items:center;gap:.45em;width:100%;padding:.45em 1rem;border:0;border-bottom:1px solid rgba(200,184,255,.18);background:rgba(200,184,255,.07);color:rgba(230,224,255,.85);cursor:pointer;font:inherit;font-size:.8em;text-align:left;transition:background 140ms ease,color 140ms ease}
${SURFACE_NAME} .features-selection .mat-sym{font-size:1.1em;color:#c8b8ff}
${SURFACE_NAME} .features-selection:hover{background:rgba(200,184,255,.14);color:#f6f3ff}
${SURFACE_NAME} .features-selection:focus-visible{outline:1px solid rgba(200,184,255,.7);outline-offset:-1px}
${SURFACE_NAME} .features-selection-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${SURFACE_NAME} .features-clear{background:transparent;border:none;color:rgba(255,255,255,.5);font-family:inherit;font-size:.74em;cursor:pointer;padding:0 .25em}
${SURFACE_NAME} .features-clear:hover{color:#c8b8ff}

${SURFACE_NAME} .features-close{display:grid;place-items:center;background:transparent;border:1px solid transparent;color:rgba(255,255,255,.7);font-size:1rem;line-height:1;cursor:pointer;padding:0;width:2rem;height:2rem;border-radius:2px}
${SURFACE_NAME} .features-close .mat-sym{font-size:1.12rem}
${SURFACE_NAME} .features-close:hover{color:#c8b8ff;border-color:rgba(255,255,255,.1);background:rgba(255,255,255,.05)}

${SURFACE_NAME} .features-empty{margin:0;padding:1.5em 1em;font-size:.85em;color:rgba(255,255,255,.45)}
${SURFACE_NAME} .features-scroll{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain}
${SURFACE_NAME} .features-group{padding:0}
${SURFACE_NAME} .section-empty{margin:0;padding:1rem;border:1px dashed rgba(255,255,255,.08);border-radius:3px;background:rgba(255,255,255,.018);font-size:.7rem;text-align:center;color:rgba(255,255,255,.3);font-style:italic}
${SURFACE_NAME} .features-list{list-style:none;margin:0;display:flex;flex-direction:column;gap:.52rem;padding:0}

${SURFACE_NAME} .features-row{position:relative;display:flex;align-items:center;gap:.72rem;min-height:4.35rem;padding:.78rem;box-sizing:border-box;border:1px solid rgba(255,255,255,.075);border-radius:3px;background:rgba(255,255,255,.026);box-shadow:inset 0 1px rgba(255,255,255,.018);cursor:pointer;transition:transform 140ms ease,border-color 140ms ease,background 140ms ease,box-shadow 140ms ease}
${SURFACE_NAME} .features-row:hover{z-index:1;transform:translateY(-1px);border-color:rgba(200,184,255,.24);background:rgba(200,184,255,.055);box-shadow:0 8px 22px rgba(0,0,0,.16),inset 0 1px rgba(255,255,255,.035)}
${SURFACE_NAME} .features-row:focus-visible{outline:0;border-color:rgba(200,184,255,.62);box-shadow:0 0 0 3px rgba(200,184,255,.1)}
${SURFACE_NAME} .features-row.busy{opacity:.55;cursor:progress}

${SURFACE_NAME} .feature-meta{flex:1;min-width:0;display:flex;flex-direction:column;gap:.28rem}
${SURFACE_NAME} .feature-name{font-size:.84rem;font-weight:620;line-height:1.25;color:rgba(250,249,255,.94)}
${SURFACE_NAME} .feature-desc{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden;font-size:.67rem;line-height:1.45;color:rgba(255,255,255,.55)}
${SURFACE_NAME} .feature-origin{align-self:flex-start;display:inline-flex;align-items:center;gap:.3em;margin-top:.05em;padding:.1rem .38rem;border-radius:999px;font-size:.52rem;font-family:var(--hc-mono,monospace);letter-spacing:.02em;line-height:1.2;white-space:nowrap;color:rgba(255,255,255,.42);background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08)}
${SURFACE_NAME} .feature-origin.cascade{color:rgba(200,184,255,.88);background:rgba(200,184,255,.08);border-color:rgba(200,184,255,.24)}
${SURFACE_NAME} .feature-cmd{display:inline-flex;margin:.1rem 0 0;padding:.13rem .4rem;border-radius:2px;font-family:var(--hc-mono,monospace);font-size:.56rem;color:rgba(200,184,255,.85);background:rgba(200,184,255,.1);border:1px solid rgba(200,184,255,.22);white-space:nowrap}
${SURFACE_NAME} .avail-flow{margin-left:.3em;font-size:.72em;color:rgba(200,184,255,.6);cursor:help}

@media (pointer: coarse){
${SURFACE_NAME}{top:max(calc(3.65rem * var(--hc-header-zoom,1.0)),calc(var(--hc-header-anchor) + 1.02rem))}
}

@media (max-width:599px),(max-height:449px){
${SURFACE_NAME}{top:0;left:0;right:0;bottom:0;width:100%!important;min-width:0;max-width:none;max-height:none;border:none;border-radius:0;box-shadow:none;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
${SURFACE_NAME} .features-scroll{flex:1 1 auto;min-height:0}
${SURFACE_NAME}.reviewing .features-header,${SURFACE_NAME}.reviewing .features-scope,${SURFACE_NAME}.reviewing .features-selection,${SURFACE_NAME}.reviewing .bulk-bar,${SURFACE_NAME}.reviewing .download-status,${SURFACE_NAME}.reviewing .features-scroll,${SURFACE_NAME}.reviewing .features-foot{display:none}
${SURFACE_NAME}{font-size:1rem}
${SURFACE_NAME} button,${SURFACE_NAME} .features-row{min-height:2.5em}
${SURFACE_NAME} .bulk-bar{display:none}
${SURFACE_NAME} .features-select-tile{display:flex;align-items:center;justify-content:center;gap:.45rem;width:calc(100% - 1.5rem);min-height:2.9rem;margin:.55rem .75rem 0;border:1px solid rgba(200,184,255,.55);border-radius:2px;background:rgba(200,184,255,.12);color:#c8b8ff;font:600 .9rem/1 inherit;cursor:pointer}
${SURFACE_NAME} .features-select-tile:active{background:rgba(200,184,255,.22)}
${SURFACE_NAME} .features-select-tile .mat-sym{font-size:1.15rem}
}

${SURFACE_NAME} .features-row.selected{border-color:rgba(255,255,255,.28);box-shadow:0 0 0 2px rgba(255,255,255,.05)}
${SURFACE_NAME} .features-row.off .feature-origin,${SURFACE_NAME} .features-row.off .feature-desc{opacity:.55}

${SURFACE_NAME} .bulk-bar{display:flex;align-items:center;gap:.5em;padding:.5em 1rem;border-bottom:1px solid rgba(200,184,255,.25);background:rgba(200,184,255,.07)}
${SURFACE_NAME} .bulk-count{flex:1;font-size:.7em;letter-spacing:.04em;color:rgba(255,255,255,.65)}
${SURFACE_NAME} .bulk-download{flex:0 0 auto;border-radius:2px;font-family:inherit;font-size:.66em;letter-spacing:.05em;text-transform:uppercase;padding:.22em .56em;cursor:pointer;transition:background 120ms ease,transform 120ms ease;background:transparent;border:1px solid rgba(255,255,255,.25);color:rgba(255,255,255,.75)}
${SURFACE_NAME} .bulk-download:active{transform:scale(.94)}
${SURFACE_NAME} .bulk-download:focus-visible{outline:1px solid rgba(200,184,255,.6);outline-offset:-1px}
${SURFACE_NAME} .bulk-download:hover{border-color:rgba(200,184,255,.5);color:#c8b8ff}
${SURFACE_NAME} .bulk-download.busy{opacity:.55;cursor:progress}

${SURFACE_NAME} .download-status{padding:.55em 1rem .5em;border-bottom:1px solid rgba(200,184,255,.18);display:flex;flex-direction:column;gap:.65em}
${SURFACE_NAME} .dl-path{display:flex;flex-direction:column;gap:.28em;min-width:0}
${SURFACE_NAME} .dl-path-head{display:flex;align-items:baseline;gap:.6em;min-width:0;font-size:.7em;letter-spacing:.03em}
${SURFACE_NAME} .dl-cell{flex-shrink:1;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:rgba(200,184,255,.85)}
${SURFACE_NAME} .dl-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;color:rgba(255,255,255,.65)}
${SURFACE_NAME} .dl-path.ok .dl-text{color:rgba(110,201,110,.9)}
${SURFACE_NAME} .dl-path.fail .dl-text{color:rgba(224,138,138,.9)}
${SURFACE_NAME} .dl-track{display:flex;align-items:center}
${SURFACE_NAME} .dl-node{flex-shrink:0;width:10px;height:10px;border-radius:50%;border:1.5px solid rgba(255,255,255,.28);background:transparent;box-sizing:border-box}
${SURFACE_NAME} .dl-node.filled{border-color:#e0a93e;background:#e0a93e}
${SURFACE_NAME} .dl-node.pulse{animation:hc-features-dl-pulse 1.2s ease-in-out infinite}
${SURFACE_NAME} .dl-node.terminal{width:14px;height:14px;display:inline-flex;align-items:center;justify-content:center;font-size:9px;line-height:1;color:rgba(10,10,16,.9)}
${SURFACE_NAME} .dl-seg{flex:1;height:2px;background:rgba(255,255,255,.14)}
${SURFACE_NAME} .dl-seg.filled{background:#e0a93e}
${SURFACE_NAME} .dl-path.ok .dl-node.filled{border-color:#6ec96e;background:#6ec96e}
${SURFACE_NAME} .dl-path.ok .dl-seg.filled{background:#6ec96e}
${SURFACE_NAME} .dl-path.fail .dl-node.terminal.filled{border-color:#e08a8a;background:#e08a8a}
${SURFACE_NAME} .dl-labels{display:flex;justify-content:space-between;font-size:.58em;letter-spacing:.05em;text-transform:uppercase;color:rgba(255,255,255,.3)}
${SURFACE_NAME} .dl-labels span.lit{color:rgba(255,255,255,.6)}
${SURFACE_NAME} .dl-labels span:first-child{text-align:left}
${SURFACE_NAME} .dl-labels span:last-child{text-align:right}
${SURFACE_NAME} .dl-path.ok .dl-labels span:last-child{color:rgba(110,201,110,.85)}
${SURFACE_NAME} .dl-path.fail .dl-labels span:last-child{color:rgba(224,138,138,.85)}

@keyframes hc-features-dl-pulse{
0%,100%{opacity:1;transform:scale(1)}
50%{opacity:.55;transform:scale(.85)}
}

${SURFACE_NAME} .bulk-clear{flex:0 0 auto;background:transparent;border:none;color:rgba(255,255,255,.45);font-size:1.05em;line-height:1;cursor:pointer;padding:0 .2em}
${SURFACE_NAME} .bulk-clear:hover{color:#c8b8ff}

${SURFACE_NAME} .feature-note{display:block;align-self:flex-start;margin-top:.05em;font-size:.62em;line-height:1.35;color:rgba(255,160,150,.85)}
${SURFACE_NAME} .feature-note .note-why{display:block;color:rgba(255,200,150,.7)}

${SURFACE_NAME} .feature-review{display:flex;flex-direction:column;gap:.6em;padding:.85em 1rem;border-bottom:1px solid rgba(200,184,255,.25);background:rgba(20,18,30,.6)}
${SURFACE_NAME} .review-head{display:flex;align-items:baseline;gap:.5em}
${SURFACE_NAME} .review-title{flex:1;font-size:.86em;letter-spacing:.03em;color:rgba(200,184,255,.95)}
${SURFACE_NAME} .review-kind{font-size:.7em;color:rgba(255,255,255,.45)}
${SURFACE_NAME} .review-note{margin:0;font-size:.78em;line-height:1.5;color:rgba(255,255,255,.78)}
${SURFACE_NAME} .review-code{margin:0;max-height:40vh;overflow:auto;padding:.7em .8em;background:rgba(0,0,0,.5);border:1px solid rgba(200,184,255,.18);border-radius:3px;font-family:var(--hc-mono,ui-monospace,monospace);font-size:.7em;line-height:1.45;white-space:pre-wrap;word-break:break-word;color:rgba(220,230,240,.92)}
${SURFACE_NAME} .review-actions{display:flex;gap:.5em;flex-wrap:wrap}
${SURFACE_NAME} .review-actions button{font-family:inherit;font-size:.78em;padding:.36em .72em;border-radius:2px;cursor:pointer;border:1px solid transparent}
${SURFACE_NAME} .review-accept{background:rgba(200,184,255,.18);border-color:rgba(200,184,255,.6);color:#f3f3f3}
${SURFACE_NAME} .review-bypass{background:transparent;border-color:rgba(255,180,120,.45);color:rgba(255,200,150,.9)}
${SURFACE_NAME} .review-cancel{background:transparent;border-color:rgba(255,255,255,.2);color:rgba(255,255,255,.6)}

${SURFACE_NAME} .feature-review.phone{flex:1 1 auto;min-height:0;justify-content:center;gap:.9em;padding:1.2em 1.1em calc(1.2em + env(safe-area-inset-bottom,0px));border-bottom:none}
${SURFACE_NAME} .feature-review.phone .review-title{font-size:1.05em;line-height:1.35}
${SURFACE_NAME} .feature-review.phone .review-note{font-size:.92em}
${SURFACE_NAME} .feature-review.phone .review-warn{margin:0;padding:.75em .85em;background:rgba(255,180,120,.07);border:1px solid rgba(255,180,120,.32);border-radius:3px;font-size:.88em;line-height:1.55;color:rgba(255,214,170,.92)}
${SURFACE_NAME} .feature-review.phone .review-actions{flex-direction:column;gap:.55em;margin-top:.2em}
${SURFACE_NAME} .feature-review.phone .review-actions button{width:100%;min-height:3em;font-size:1em;font-weight:600}
${SURFACE_NAME} .feature-review.phone .review-accept{text-transform:capitalize}
${SURFACE_NAME} .feature-review.phone .review-readcode{background:transparent;border-color:rgba(255,255,255,.16);color:rgba(255,255,255,.62);font-weight:500}
${SURFACE_NAME} .feature-review.phone.reading{justify-content:flex-start}
${SURFACE_NAME} .feature-review.phone.reading .review-code{flex:1 1 auto;max-height:none;min-height:0;font-size:.8em}
${SURFACE_NAME} .feature-review.phone .review-back{padding:0 .5em 0 0;background:none;border:none;font-size:1.3em;line-height:1;color:rgba(200,184,255,.9);cursor:pointer}

${SURFACE_NAME} .features-scope{display:flex;align-items:center;gap:.5em;padding:.6rem 1rem .25rem}
${SURFACE_NAME} .scope-kinds{flex:0 0 auto;display:flex;align-items:center;gap:.3em}
${SURFACE_NAME} .scope-kind{display:grid;place-items:center;width:2rem;height:2rem;padding:0;border:0;background:transparent;color:rgba(255,255,255,.32);cursor:pointer;transition:color 140ms ease}
${SURFACE_NAME} .scope-kind .mat-sym{font-size:1.05em;line-height:1}
${SURFACE_NAME} .scope-kind:focus-visible{outline:1px solid rgba(200,184,255,.6);outline-offset:2px}
${SURFACE_NAME} .scope-kind:hover{color:rgba(255,255,255,.72)}
${SURFACE_NAME} .scope-kind.behaviors.on{color:#c8b8ff}
${SURFACE_NAME} .scope-kind.views.on{color:#a8d8ff}
${SURFACE_NAME} .scope-toggle{flex:0 0 auto;margin-left:auto;display:grid;place-items:center;width:2rem;height:2rem;padding:0;border:0;background:transparent;color:rgba(255,255,255,.42);cursor:pointer;transition:color 140ms ease}
${SURFACE_NAME} .scope-toggle .mat-sym{font-size:1.05em;line-height:1}
${SURFACE_NAME} .scope-toggle:hover{color:rgba(255,255,255,.82)}
${SURFACE_NAME} .scope-toggle:focus-visible{outline:1px solid rgba(200,184,255,.6);outline-offset:2px}
${SURFACE_NAME} .scope-toggle.pool{color:#c8b8ff}

${SURFACE_NAME} .feature-awaiting{align-self:flex-start;font-size:.62em;letter-spacing:.04em;padding:.1em .45em;border:1px solid rgba(255,255,255,.22);border-radius:3px;color:rgba(255,255,255,.6)}
${SURFACE_NAME} .feature-bound{align-self:flex-start;display:inline-flex;align-items:center;gap:.28em;font-size:.62em;letter-spacing:.04em;padding:.1em .45em;border:1px solid rgba(255,214,138,.34);border-radius:3px;color:rgba(255,214,138,.82)}
${SURFACE_NAME} .feature-bound .mat-sym{font-size:1.1em;line-height:1}
${SURFACE_NAME} .foot-bound{margin-left:.6em;opacity:.7}

${SURFACE_NAME} .features-brand{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:.7rem}
${SURFACE_NAME} .features-brand-mark{width:2rem;height:2rem;display:grid;place-items:center;border:1px solid rgba(200,184,255,.3);border-radius:3px;color:#eee9ff;background:linear-gradient(145deg,rgba(200,184,255,.24),rgba(200,184,255,.07));box-shadow:inset 0 1px rgba(255,255,255,.1)}
${SURFACE_NAME} .features-brand-mark .mat-sym{font-size:1.1rem}
${SURFACE_NAME} .features-title{min-width:0;display:flex;align-items:baseline;gap:.32rem;overflow:hidden;font-size:.98rem;font-weight:650;letter-spacing:.01em;color:rgba(250,249,255,.96)}
${SURFACE_NAME} .features-title-sep{flex:0 0 auto;font-weight:400;color:rgba(255,255,255,.3)}
${SURFACE_NAME} .features-title-app{flex:0 0 auto}
${SURFACE_NAME} .features-title-cell{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-weight:500;color:rgba(233,228,255,.72)}
${SURFACE_NAME} .features-title-scope{flex:0 0 auto;font-weight:500;text-transform:lowercase;color:rgba(233,228,255,.62)}

${SURFACE_NAME} .features-searchbar{flex:0 0 auto;display:flex;align-items:center;gap:.55rem;margin:.05rem 1rem .7rem;min-height:2.35rem;padding:0 .72rem;border:1px solid rgba(255,255,255,.09);border-radius:2px;background:rgba(255,255,255,.035);color:rgba(255,255,255,.34);transition:border-color 140ms ease,background 140ms ease,box-shadow 140ms ease}
${SURFACE_NAME} .features-searchbar:focus-within{border-color:rgba(200,184,255,.48);background:rgba(200,184,255,.045);box-shadow:0 0 0 3px rgba(200,184,255,.07);color:rgba(200,184,255,.8)}
${SURFACE_NAME} .features-searchbar>.mat-sym{flex:0 0 auto;font-size:1rem}
${SURFACE_NAME} .features-searchbar .features-anchored{flex:0 0 auto;width:1.7rem;height:1.7rem;display:grid;place-items:center;padding:0;border:1px solid transparent;border-radius:2px;background:transparent;color:rgba(255,255,255,.35);cursor:pointer;transition:color 120ms ease,border-color 120ms ease,background 120ms ease}
${SURFACE_NAME} .features-searchbar .features-anchored .mat-sym{font-size:1rem}
${SURFACE_NAME} .features-searchbar .features-anchored:hover{color:rgba(255,214,138,.9)}
${SURFACE_NAME} .features-searchbar .features-anchored.active{color:rgba(255,214,138,.92);border-color:rgba(255,214,138,.3);background:rgba(255,214,138,.08)}
${SURFACE_NAME} .features-searchbar .features-anchored:focus-visible{outline:1px solid rgba(200,184,255,.6);outline-offset:-1px}
${SURFACE_NAME} .features-search{flex:1 1 auto;min-width:0;padding:0;border:0;border-radius:0;background:transparent;color:#f3f3f3;font:inherit;font-family:inherit;font-size:.8rem;outline:none}
${SURFACE_NAME} .features-search::placeholder{color:rgba(255,255,255,.35);letter-spacing:0}
${SURFACE_NAME} .features-search:focus{border:0;background:transparent}
${SURFACE_NAME} .features-search::-webkit-search-cancel-button{display:none}

${SURFACE_NAME} .features-scroll{padding:0 1rem 1rem;scrollbar-width:thin;scrollbar-color:rgba(200,184,255,.2) transparent}

${SURFACE_NAME} .feature-icon{flex:0 0 auto;align-self:flex-start;width:2.35rem;height:2.35rem;display:grid;place-items:center;border:1px solid rgba(200,184,255,.19);border-radius:3px;color:rgba(235,229,255,.92);background:linear-gradient(145deg,rgba(200,184,255,.2),rgba(200,184,255,.065));box-shadow:inset 0 1px rgba(255,255,255,.07)}
${SURFACE_NAME} .feature-icon .mat-sym{font-size:1.12rem}
${SURFACE_NAME} .features-row.off .feature-icon{color:rgba(255,255,255,.46);border-color:rgba(255,255,255,.08);background:rgba(255,255,255,.035);box-shadow:none}

${SURFACE_NAME} .feature-whence{position:absolute;top:.3rem;right:3rem;display:inline-flex;align-items:center;gap:.25rem;padding:.08rem .45rem;border:1px solid rgba(255,255,255,.14);border-radius:999px;font-size:.55rem;line-height:1.4;white-space:nowrap;color:rgba(255,255,255,.6);background:rgba(16,14,24,.92);opacity:0;pointer-events:none;transition:opacity 140ms ease}
${SURFACE_NAME} .feature-whence .mat-sym{font-size:.72rem}
${SURFACE_NAME} .feature-whence.bound{color:rgba(255,214,138,.85);border-color:rgba(255,214,138,.28)}
${SURFACE_NAME} .features-row:hover .feature-whence,${SURFACE_NAME} .features-row:focus-within .feature-whence{opacity:1}

${SURFACE_NAME} .feat-open{flex:0 0 auto;align-self:center;display:inline-flex;align-items:center;gap:.28rem;padding:.27rem .38rem;border:1px solid rgba(200,184,255,.24);border-radius:2px;background:rgba(200,184,255,.08);color:rgba(235,229,255,.92);font-size:.56rem;font-weight:650;cursor:pointer;opacity:0;pointer-events:none;transition:opacity 140ms ease,background 120ms ease}
${SURFACE_NAME} .features-row:hover .feat-open,${SURFACE_NAME} .features-row:focus-within .feat-open{opacity:1;pointer-events:auto}
${SURFACE_NAME} .feat-open:hover{background:rgba(200,184,255,.22)}
${SURFACE_NAME} .feat-open:focus-visible{outline:1px solid rgba(200,184,255,.6);outline-offset:-1px}

${SURFACE_NAME} .feat-bulb{flex:0 0 auto;align-self:center;width:2rem;height:2rem;display:grid;place-items:center;margin-left:.1rem;border-radius:50%;color:rgba(255,255,255,.26);transition:color 260ms ease,background 260ms ease,box-shadow 260ms ease}
${SURFACE_NAME} .feat-bulb .mat-sym{font-size:1.2rem;font-variation-settings:'FILL' 0,'wght' 400,'GRAD' 0,'opsz' 24;transition:font-variation-settings 260ms ease,text-shadow 260ms ease,color 260ms ease}
${SURFACE_NAME} .feat-bulb.on{color:#ffd97a;background:radial-gradient(circle at 50% 42%,rgba(255,205,100,.16),transparent 70%);box-shadow:0 0 18px rgba(255,195,80,.12)}
${SURFACE_NAME} .feat-bulb.on .mat-sym{font-variation-settings:'FILL' 1,'wght' 400,'GRAD' 0,'opsz' 24;text-shadow:0 0 8px rgba(255,208,100,.9),0 0 22px rgba(255,185,60,.45)}

${SURFACE_NAME} .features-row.lit{border-color:rgba(255,205,100,.15);background:linear-gradient(120deg,rgba(255,205,100,.05),rgba(255,255,255,.022))}
${SURFACE_NAME} .features-row.off{opacity:.68;border-color:rgba(255,255,255,.06);background:rgba(255,255,255,.012)}
${SURFACE_NAME} .features-row.off:hover{opacity:.92}
${SURFACE_NAME} .features-row.off .feature-name{color:rgba(245,245,250,.58)}
${SURFACE_NAME} .features-row.inherited{cursor:default}
${SURFACE_NAME} .features-row.view{border-color:rgba(168,216,255,.22)}
${SURFACE_NAME} .features-row.view:hover{border-color:rgba(168,216,255,.32)}
${SURFACE_NAME} .features-row.view.lit{border-color:rgba(168,216,255,.3);background:linear-gradient(120deg,rgba(168,216,255,.155),rgba(255,205,100,.06))}

${SURFACE_NAME} .feature-icon.as-default{padding:0;appearance:none;cursor:pointer;transition:color 160ms ease,border-color 160ms ease,background 160ms ease,box-shadow 160ms ease}
${SURFACE_NAME} .feature-icon.as-default:hover{border-color:rgba(200,184,255,.45);background:linear-gradient(145deg,rgba(200,184,255,.3),rgba(200,184,255,.1))}
${SURFACE_NAME} .feature-icon.as-default:focus-visible{outline:1px solid rgba(200,184,255,.7);outline-offset:1px}
${SURFACE_NAME} .features-row .feature-icon.as-default.is-default{color:#efe9ff;border-color:rgba(200,184,255,.7);background:linear-gradient(145deg,rgba(200,184,255,.42),rgba(200,184,255,.16));box-shadow:0 0 16px rgba(200,184,255,.3),inset 0 1px rgba(255,255,255,.12)}
${SURFACE_NAME} .features-row .feature-icon.as-default.is-default .mat-sym{font-variation-settings:'FILL' 1,'wght' 500,'GRAD' 0,'opsz' 24}
${SURFACE_NAME} .feature-default-note{font-size:.55rem;line-height:1.4;letter-spacing:.04em;text-transform:uppercase;color:rgba(200,184,255,.85)}

${SURFACE_NAME} .feat-manage{flex:0 0 auto;align-self:center;display:inline-grid;place-items:center;width:1.7rem;height:1.7rem;border:1px solid rgba(255,255,255,.12);border-radius:2px;background:rgba(255,255,255,.04);color:rgba(255,255,255,.62);cursor:pointer;opacity:0;pointer-events:none;transition:opacity 140ms ease,background 120ms ease,color 120ms ease}
${SURFACE_NAME} .feat-manage .mat-sym{font-size:.95rem}
${SURFACE_NAME} .features-row:hover .feat-manage,${SURFACE_NAME} .features-row:focus-within .feat-manage,${SURFACE_NAME} .feat-manage.open{opacity:1;pointer-events:auto}
${SURFACE_NAME} .feat-manage.open{border-color:rgba(200,184,255,.45);background:rgba(200,184,255,.16);color:rgba(240,236,255,.95)}
${SURFACE_NAME} .feat-manage:hover{background:rgba(200,184,255,.18)}
${SURFACE_NAME} .feat-manage:focus-visible{outline:1px solid rgba(200,184,255,.6);outline-offset:-1px}

${SURFACE_NAME} .feature-manage{flex:1 0 100%;display:flex;gap:.4rem;margin-top:.55rem}
${SURFACE_NAME} .feature-manage button{flex:1 1 0;padding:.3rem .4rem;border:1px solid rgba(255,255,255,.12);border-radius:2px;background:rgba(255,255,255,.035);color:rgba(255,255,255,.66);font-size:.58rem;font-weight:620;cursor:pointer;transition:background 120ms ease,border-color 120ms ease,color 120ms ease}
${SURFACE_NAME} .feature-manage button:hover{background:rgba(200,184,255,.14)}
${SURFACE_NAME} .feature-manage button:focus-visible{outline:1px solid rgba(200,184,255,.6);outline-offset:-1px}
${SURFACE_NAME} .feature-manage button.on{border-color:rgba(200,184,255,.5);background:rgba(200,184,255,.2);color:rgba(242,238,255,.96)}
${SURFACE_NAME} .features-row.managing{z-index:2;flex-wrap:wrap}

${SURFACE_NAME} .features-foot{flex:0 0 auto;margin:0 1rem;padding:.65rem 0 .72rem;border-top:1px solid rgba(255,255,255,.055);font-size:.58rem;line-height:1.45;color:rgba(255,255,255,.31)}

${SURFACE_NAME}{--hc-window-accent:#c8b8ff;--hc-window-radius-control:2px;--hc-window-radius-card:3px;--hc-window-radius-floating:4px;background:rgba(13,15,21,.975);backdrop-filter:blur(14px) saturate(1.04);-webkit-backdrop-filter:blur(14px) saturate(1.04);border-radius:0;font-family:var(--hc-mono,system-ui);color:#eef2f5;outline:none;border-right:0;border-left:1px solid rgba(200,184,255,.38);box-shadow:-14px 0 44px rgba(0,0,0,.46),inset 1px 0 rgba(255,255,255,.025);width:404px;min-width:300px}

@media (max-width:599px),(max-height:449px){
${SURFACE_NAME} .features-header{padding-top:env(safe-area-inset-top,0px);padding-inline:.7rem .45rem}
${SURFACE_NAME} .features-searchbar{margin-top:.25rem}
${SURFACE_NAME} .features-scope,${SURFACE_NAME} .features-scroll,${SURFACE_NAME} .features-selection,${SURFACE_NAME} .bulk-bar,${SURFACE_NAME} .download-status,${SURFACE_NAME} .feature-review{padding-inline:.7rem}
${SURFACE_NAME} .features-searchbar,${SURFACE_NAME} .features-foot{margin-inline:.7rem}
${SURFACE_NAME}.reviewing .features-searchbar{display:none}
}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-features-viewer', '')
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

const sym = (ligature: string, hidden = false): HTMLElement => {
  const node = el('span', 'mat-sym', ligature)
  if (hidden) node.setAttribute('aria-hidden', 'true')
  return node
}

/** Angular's `(keydown.enter)` / `(keydown.space)` composed their binding name
 *  from the modifiers held, so a chorded press produced `control.enter` and
 *  never matched. Reproduced here: a modified press falls through untouched,
 *  which is what keeps Ctrl-click's sibling gestures out of the row's toggle. */
const plainActivation = (event: KeyboardEvent): 'enter' | 'space' | null => {
  if (event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return null
  if (event.key === 'Enter') return 'enter'
  if (event.key === ' ' || event.key === 'Spacebar') return 'space'
  return null
}

/** The child buttons' `(keydown.enter)="$event.stopPropagation()"` — a native
 *  button already fires click on Enter/Space, so the row behind it must not
 *  also toggle. */
const stopPlainActivation = (event: KeyboardEvent): void => {
  if (plainActivation(event)) event.stopPropagation()
}

export class FeaturesViewerElement extends DockedPanelElement {

  #offs: Array<() => void> = []

  /** THE visibility flag. `close()`, every open path and the session's
   *  park/unpark all read and write THIS field — a second notion of "open" is
   *  how the two drift apart after the first press. */
  #visible = false

  /** The ONE tile the panel is describing. Null = closed / store only. */
  #group: FeatureGroup | null = null

  /** A foreign feature the participant has been asked to REVIEW before
   *  enabling — set from `feature:review:open` (the website gate). */
  #reviewTarget: ReviewTarget | null = null

  /** Phone-shaped viewport (narrow OR short). */
  #isPhone = false
  #phoneQuery: MediaQueryList | null = null

  /** The review code is showing (phone: a place you GO, never beside the
   *  decision). */
  #codeOpen = false

  /** LEGACY hidden-pool records, read-only drain. */
  #hidden: HiddenFeature[] = []

  /** The header search — filters every section's rows live. */
  #query = ''

  /** TILE (default) — this layer's rows. STORE — the pool, one light each. */
  #mode: 'tile' | 'store' = 'tile'

  /** THE LENS — which KINDS the LOCAL list shows. Two positions, mutually
   *  exclusive, because A VIEW IS A BEEHAVIOUR: `behaviors` is the WHOLE list,
   *  `views` narrows it to the surfaces. There is no third `all`. */
  #lens: 'behaviors' | 'views' = 'behaviors'

  /** The view this LAYER opens as — '' when it opens as hexagons. */
  #defaultView = ''

  /** The row whose MANAGE strip is open (by kind), '' when none is. */
  #managing = ''

  /** The store rows, as last delivered by `features:roster`. */
  #storeRows: StoreRow[] = []

  /** STICKY POOL FILTER — anchored (tile-bound) behaviors in or out. */
  #showAnchored = true

  /** Multi-selected rows (Ctrl/Shift-click) — what the bulk bar acts on. */
  #selectedKeys: ReadonlySet<string> = new Set()

  /** Rows whose add/remove is in flight — guards double-clicks. */
  #pending: ReadonlyMap<string, boolean> = new Map()

  /** Row-level FAILURE notes by row key (`features:outcome`). */
  #rowNotes: ReadonlyMap<string, string> = new Map()

  /** Latest content-health condition — the quiet WHY under a failure note. */
  #health: { condition: string; host: string | null } | null = null

  /** Bulk downloads in flight (by cell). */
  #downloading: ReadonlySet<string> = new Set()

  /** Files fetched since this download batch started. */
  #downloadedCount = 0

  /** Per-cell download outcomes, in arrival order. */
  #downloadResults: DownloadResult[] = []

  /** Canvas-selection response (documentation/selection-tool-windows.md). */
  #canvasSelectionCount = 0
  #canvasSelectionHasFeatures = false

  /** Current websites-menu membership (path keys). */
  #websiteMembers: ReadonlySet<string> = new Set()

  /** Last navigation path seen (joined) — follow-navigation re-targets only
   *  when this actually changes, never on fs-only invalidations. */
  #lastNavKey = ''
  #lineage: LineageLike | null = null
  #lineageBound = false

  #lastPress = new Map<string, number>()
  #downloadLeash: ReturnType<typeof setTimeout> | null = null
  /** Every armed row leash, so disconnect drains them (the component leaked
   *  these — a timer outliving its panel is the one thing rule 7 forbids). */
  #rowLeashes = new Set<ReturnType<typeof setTimeout>>()

  // Chrome built once per activation. The header must survive a body rebuild
  // because DockedPanelElement plants the settings gear inside it (and nudges
  // the close button over to make room) AFTER renderPanel() returns —
  // rebuilding the header would throw the gear away. The close button is the
  // header's LAST child for the same reason: that is the node the base moves.
  #titleEl: HTMLElement | null = null
  #closeEl: HTMLElement | null = null
  #topSlot: HTMLElement | null = null
  #bottomSlot: HTMLElement | null = null
  #searchBar: HTMLElement | null = null
  #searchInput: HTMLInputElement | null = null
  #anchoredBtn: HTMLButtonElement | null = null

  constructor() {
    super()
    // Same panel id the Angular `hcDockedPanel="features-viewer"` carried, so
    // the saved width (`hc:docked-width:features-viewer`), text size and group
    // membership all come across with the participant. Changing it would
    // orphan all three.
    this.panelId = 'features-viewer'
    this.dockSide = 'right'
    this.minWidth = 300
    this.maxWidth = 680
    this.defaultWidth = 404
    // Registry-fed: mounted once at boot, engaged only when something opens it.
    this.autoActivate = false
    // The Angular original built this with `signalSession(visible, announce,
    // { dismiss, close })`. Reproduced literally: park/unpark flip visibility
    // and announce, WITHOUT the clearing `close()` does — a panel that came
    // back empty after the installer covered the hive would read as "my
    // beehaviors vanished". `dismiss` and `close` are what the Escape cascade
    // calls through the base's holdWindow / holdToolWindow; this panel binds no
    // keydown listener of its own, in either implementation.
    this.session = {
      park: () => { this.#hide(); EffectBus.emit('features:viewer-state', { open: false }) },
      unpark: () => { this.#show(); EffectBus.emit('features:viewer-state', { open: true }) },
      dismiss: () => this.#dismiss(),
      close: () => this.close(),
    }
    try { this.#showAnchored = localStorage.getItem(ANCHORED_PREF_KEY) !== '0' }
    catch { this.#showAnchored = true }
  }

  // ── derived readings (the component's computed()s) ───────────────────

  get #isStore(): boolean { return this.#mode === 'store' }

  /** The subject's name for the header title — `Beehaviors / <name>`. Empty at
   *  the HIVE ROOT (no segments, or a bare `/` label): there is no name below
   *  the app there, and a separator with nothing after it read as
   *  `Beehaviors //`. The pool has no subject at all and says `global`. */
  get #subjectName(): string {
    const g = this.#group
    if (!g || g.segments.length === 0) return ''
    const cell = String(g.cell ?? '').trim()
    return cell === '/' ? '' : cell
  }

  get #storeOnCount(): number { return this.#storeRows.filter(r => r.on).length }

  /** How many behaviours belong to one tile rather than to the whole hive. */
  get #storeBoundCount(): number {
    return this.#storeRows.filter(r => (r.bound?.length ?? 0) > 0).length
  }

  get #selectedCount(): number { return this.#selectedKeys.size }

  /** POLARITY IS LOAD-BEARING — the template's condition, copied, never
   *  re-derived by negation. */
  get #showCanvasSelectionAffordance(): boolean {
    return this.#canvasSelectionCount > 0 && this.#canvasSelectionHasFeatures
  }

  /** The pool, flat: one row per behavior, A→Z, through the header query.
   *  No categories, no badges — a list of lights. */
  #storeList(): StoreRow[] {
    const q = this.#query.trim().toLowerCase()
    return this.#storeRows
      .filter(r => this.#showAnchored || !(r.bound?.length))
      .filter(r => !q
        || r.label.toLowerCase().includes(q)
        || r.kind.toLowerCase().includes(q)
        || r.description.toLowerCase().includes(q)
        || (r.slashCommand ?? '').toLowerCase().includes(q))
      .slice()
      .sort((a, b) => a.label.localeCompare(b.label))
  }

  /** The visible download pathway: one stepper row per cell. */
  #pathway(): DownloadPath[] {
    const out: DownloadPath[] = []
    const receiving = this.#downloadedCount > 0
    for (const cell of this.#downloading) {
      out.push({ cell, stage: receiving ? 2 : 1, active: true, ok: false, files: 0, failed: 0 })
    }
    for (const r of this.#downloadResults) {
      out.push({ cell: r.cell, stage: 3, active: false, ok: r.ok, stalled: r.stalled, files: r.files, failed: r.failed })
    }
    return out
  }

  /** Selected rows with anything to fetch — what bulk-download acts on. */
  #downloadableCount(): number {
    let n = 0
    for (const { feat } of this.#selectedRows()) {
      if (feat.branchSig || feat.gateSig) n++
    }
    return n
  }

  /** The tiles a behaviour belongs to, as one plain phrase. Names, not paths:
   *  the signature is the identity, but nobody reads a hash. */
  #boundTo(bindings: readonly BehaviorBinding[] | undefined): string {
    return (bindings ?? []).map(b => b.name || b.path).join(', ')
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

    this.#phoneQuery = window.matchMedia(PHONE_QUERY)
    this.#isPhone = this.#phoneQuery.matches
    this.#phoneQuery.addEventListener('change', this.#onPhoneChange)
    // The template's `[dockExclusive]="!isPhone()"`: on a phone the panel is
    // the whole page and takes no place in the edge lane.
    this.setDockExclusive(!this.#isPhone)

    this.#ensureLineage()

    this.#offs.push(
      // `selection:changed` has TWO publishers with different payload shapes
      // (SelectionService's pair, the pixi drone's superset). The shell's
      // `onSelection` helper normalized both down to the pair; that
      // normalization is inlined here rather than imported — a module may not
      // reach into shared. SETTING a count absorbs a repeated delivery for
      // free (rule 13: nothing here accumulates).
      EffectBus.on<{ selected?: unknown }>('selection:changed', (p) => {
        const selected = Array.isArray(p?.selected) ? (p.selected as unknown[]) : []
        if (selected.length === this.#canvasSelectionCount) return
        this.#canvasSelectionCount = selected.length
        if (this.#visible) this.#render()
      }),

      EffectBus.on<{ value?: boolean }>('selection:has-features', (p) => {
        const has = p?.value === true
        if (has === this.#canvasSelectionHasFeatures) return
        this.#canvasSelectionHasFeatures = has
        if (this.#visible) this.#render()
      }),

      // Legacy hidden-pool records restored elsewhere drop from the drain list.
      EffectBus.on<{ featKind?: string; segments?: readonly string[] }>(
        'feature:restored',
        (payload) => {
          const featKind = String(payload?.featKind ?? '').trim()
          const segments = (payload?.segments ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
          if (!featKind) return
          const key = hiddenKey(featKind, segments)
          const next = this.#hidden.filter(record => hiddenKey(record.featKind, record.appliesTo) !== key)
          if (next.length === this.#hidden.length) return
          this.#hidden = next
          if (this.#visible) this.#render()
        },
      ),

      // A STATE ASSERTION, delivered more than once for one gesture (the
      // hide/restore's eager emit, then the settle). The handler re-READS the
      // pool and SETS the list, so a repeat is a second identical answer, not a
      // second entry (rule 13).
      EffectBus.on('feature:activation-settled', () => {
        if (this.#visible) void this.#refreshHidden()
      }),

      // An enablement flip (roster switch, wake-here, publisher-withheld
      // record at adopt) re-marks the open tile group — its rows filter on
      // dormant/global-off, and those flags only exist at group-open time.
      // Tile mode only: while IN the store the rows are the switches
      // themselves, and a features:open arriving would yank the panel out of
      // the store mid-flip (closeStore refreshes on the way back). Also a
      // state assertion: it asks for a fresh group, it never accumulates.
      EffectBus.on(ENABLEMENT_CHANGED, () => {
        if (this.#visible && this.#mode === 'tile') this.#refreshGroup()
      }),

      // ── THE TILE arriving (show-features answers every door with this) ──
      EffectBus.on<FeaturesOpenPayload>('features:open', (p) => {
        if (!p?.cell) return
        // No sibling is closed here. Sharing an edge is the LANE's business
        // (core/panels/dock-lanes) and the lane PARKS what it displaces —
        // closing a sibling by name would run that sibling's own close(), the
        // participant's verb. See the same note in files-viewer.
        const group: FeatureGroup = {
          cell: p.cell,
          segments: Array.isArray(p.segments) ? p.segments : [],
          applied: Array.isArray(p.applied) ? p.applied : [],
          available: Array.isArray(p.available) ? p.available : [],
          adopted: p.adopted === true,
        }
        // The layer says how it opens. Read from the payload rather than
        // derived from the rows: a layer can name a default whose row is
        // currently dim, and that is still the truth about the layer.
        this.#defaultView = String(p.defaultView ?? '').trim()
        // One tile at a time: re-clicking the SAME tile refreshes in place; a
        // DIFFERENT tile replaces the subject.
        const prev = this.#group
        if (prev?.cell !== group.cell) {
          this.#selectedKeys = new Set()
          this.#rowNotes = new Map()
          this.#query = ''
          // A new subject has nothing being managed. An in-place REFRESH does —
          // choosing a reach re-opens the group, and closing the strip under the
          // participant would hide the answer they just gave.
          this.#managing = ''
        }
        this.#group = group
        if (!this.#visible) {
          this.#show()
          EffectBus.emit('features:viewer-state', { open: true })
        }
        // A fresh group replaces its rows — any in-flight action is settled,
        // and the truth it carries is what the wish was standing in for.
        if (this.#pending.size) this.#pending = new Map()
        // A tile subject arriving takes the panel out of the store.
        if (this.#mode === 'store') this.#mode = 'tile'
        this.#render()
        void this.#refreshHidden()
        void this.#refreshMembers()
      }),

      // ── THE STORE arriving (features:roster-open → show-features) ──
      // Another state assertion: it SETS the rows, so a second delivery of the
      // same roster repaints the same list rather than doubling it.
      EffectBus.on<{ rows?: StoreRow[] }>('features:roster', (p) => {
        const raw = p?.rows
        this.#storeRows = Array.isArray(raw) ? raw : []
        this.#query = ''
        this.#selectedKeys = new Set()
        this.#mode = 'store'
        if (!this.#visible) {
          this.#show()
          EffectBus.emit('features:viewer-state', { open: true })
        }
        this.#render()
      }),

      // ── the top rail's Beehaviors switch ──────────────────────────────
      // No tile in hand, so the subject is the CONTEXT — the loaded layer.
      // Everything after that is the ordinary pipeline: the drone answers with
      // `features:open`, and that is what raises the panel.
      EffectBus.on('features:context-open', () => {
        this.#openAt(this.#currentSegments())
      }),

      // ── /views (and anything else that wants a particular lens) ───────
      EffectBus.on<{ lens?: string }>('features:lens', (p) => {
        const want = String(p?.lens ?? '').trim()
        if (want === 'global') { this.#openStore(); return }
        // `all` is the retired third position — it meant what `behaviors`
        // means now that views are counted among them, so an older caller
        // still lands on the whole list.
        if (want === 'all' || want === 'behaviors') this.#lens = 'behaviors'
        else if (want === 'views') this.#lens = 'views'
        else return
        if (this.#mode === 'store') this.#mode = 'tile'
        // The signal version repainted the lens on the spot and let the
        // drone's answer land behind it; an open panel must not wait a round
        // trip to show which kind it is narrowed to.
        if (this.#visible) this.#render()
        this.#openAt(this.#currentSegments())
      }),

      EffectBus.on('features:viewer-close', () => {
        if (this.#visible) this.close()
      }),

      // The website gate blocked a foreign, unverified page — review it here.
      EffectBus.on<{ cell?: string; segments?: string[]; sig?: string; kind?: string; label?: string }>(
        'feature:review:open',
        (p) => {
          if (!p?.sig) return
          const sig = p.sig
          void this.#fetchCode(sig).then(code => {
            this.#reviewTarget = {
              cell: p.cell ?? '',
              segments: Array.isArray(p.segments) ? p.segments : [],
              sig,
              kind: p.kind ?? '',
              label: p.label ?? 'Feature',
              code,
            }
            if (!this.#visible) {
              this.#show()
              EffectBus.emit('features:viewer-state', { open: true })
            }
            this.#render()
          })
        },
      ),

      // A bulk download finished for a tile.
      EffectBus.on<{ cell?: string; ok?: boolean; files?: number; failed?: number }>('features:download:done', (p) => {
        const cell = String(p?.cell ?? '')
        if (!cell) return
        const wasBusy = this.#downloading.has(cell)
        if (this.#downloading.has(cell)) {
          const next = new Set(this.#downloading)
          next.delete(cell)
          this.#downloading = next
        }
        if (!wasBusy) return   // last-value replay of an old done — not ours
        this.#recordResult({
          cell,
          ok: p?.ok === true,
          files: Number(p?.files ?? 0) || 0,
          failed: Number(p?.failed ?? 0) || 0,
        })
        if (this.#downloading.size > 0) this.#armDownloadLeash()
        else this.#clearDownloadLeash()
        if (this.#visible) this.#render()
      }),

      // One `adopt:progress` per sig the broker fills — the climbing count.
      EffectBus.on('adopt:progress', () => {
        if (this.#downloading.size === 0) return
        this.#downloadedCount += 1
        this.#armDownloadLeash()
        if (this.#visible) this.#render()
      }),

      // Row-level outcomes: the drone answers a row's action with the SAME
      // plain-words sentence the activity log gets.
      EffectBus.on<{ cell?: string; kind?: string; ok?: boolean; message?: string }>('features:outcome', (p) => {
        const group = this.#group
        if (!group || !p?.cell || p.cell !== group.cell) return
        const kind = String(p.kind ?? '')
        const feat = kind
          ? (group.applied.find(f => f.kind === kind) ?? group.available.find(f => f.kind === kind))
          : undefined
        if (!feat) {
          if (this.#pending.size) { this.#pending = new Map(); if (this.#visible) this.#render() }
          return
        }
        const key = this.#rowKey(group, feat)
        if (this.#pending.has(key)) {
          const next = new Map(this.#pending)
          next.delete(key)
          this.#pending = next
        }
        // Success is the state flipping — an ok outcome only CLEARS a note.
        if (!(p.ok === true && !this.#rowNotes.has(key))) {
          const next = new Map(this.#rowNotes)
          if (p.ok === true) next.delete(key)
          else next.set(key, String(p.message ?? '').trim())
          this.#rowNotes = next
        }
        if (this.#visible) this.#render()
      }),

      // The overall fetch-health condition.
      EffectBus.on<{ condition?: string; host?: string | null }>('content:health', (p) => {
        this.#health = p?.condition ? { condition: String(p.condition), host: p.host ?? null } : null
        if (this.#visible) this.#render()
      }),

      // THE PIPE WAS IMPURE. Angular's `t` pipe is declared `pure: false`, so
      // every change-detection tick re-resolved every string and `/language ja`
      // re-labelled an OPEN panel on the spot. An element renders when it
      // decides to, so the locale switch has to be a reason to render — else an
      // open roster keeps its old-locale title, lens tooltips, search
      // placeholder, row hints, footer and the whole review gate (whose two
      // buttons are its only exits) until it is closed and reopened.
      // Rebuilding is safe: every row lives in a field, never in the DOM.
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
    this.#phoneQuery?.removeEventListener('change', this.#onPhoneChange)
    this.#phoneQuery = null
    this.#lineage?.removeEventListener?.('change', this.#onNav)
    this.#lineage = null
    this.#lineageBound = false
    this.#clearDownloadLeash()
    for (const timer of this.#rowLeashes) clearTimeout(timer)
    this.#rowLeashes.clear()
    super.disconnectedCallback()   // → deactivate(): lane, session, grip, gear, children
    this.#visible = false
    this.classList.remove('open', 'reviewing')
    this.removeAttribute('aria-label')
    this.#forgetChrome()
  }

  #onPhoneChange = (event: MediaQueryListEvent): void => {
    this.#isPhone = event.matches
    this.setDockExclusive(!this.#isPhone)
    if (this.#visible) this.#render()
  }

  // ── the open / close verbs ───────────────────────────────────────────

  /** The participant's close — it EMPTIES the panel on purpose (unlike park,
   *  which puts the same rows away and brings them back). Carried verbatim,
   *  including the unconditional announce: every exit — the ×, the Escape
   *  cascade's `close`, `features:viewer-close`, the lane's eviction fallback
   *  — routes through here and answers exactly once. */
  close(): void {
    this.#hide()
    EffectBus.emit('features:viewer-state', { open: false })
    this.#group = null
    this.#selectedKeys = new Set()
    this.#pending = new Map()
    this.#rowNotes = new Map()
    this.#query = ''
    this.#mode = 'tile'
    this.#downloadResults = []
    // In-flight downloads keep running — only the panel-local status resets.
  }

  /** DockedPanelElement's close verb — the × and the lane's eviction fallback
   *  both land here. */
  protected override closePanel(): void { this.close() }

  #show(): void {
    if (this.#visible) return
    this.#visible = true
    this.classList.add('open')
    this.setAttribute('aria-label', t('features.viewer.title', 'Beehaviors'))
    this.activate()   // renderPanel + lane + session + grip + gear + inset
  }

  #hide(): void {
    if (!this.#visible) return
    this.#visible = false
    this.classList.remove('open', 'reviewing')
    this.removeAttribute('aria-label')
    this.deactivate()   // clears the children — rebuild-on-open, like the `@if`
    this.#forgetChrome()
  }

  #forgetChrome(): void {
    this.#titleEl = null
    this.#closeEl = null
    this.#topSlot = null
    this.#bottomSlot = null
    this.#searchBar = null
    this.#searchInput = null
    this.#anchoredBtn = null
  }

  /** One level back per press: a review, a manage strip, the search, then the
   *  pool, then the lens back to its resting position (the beehaviours, which
   *  are all of them). False = nothing of ours was open, and the shell cascade
   *  carries on. Reached from the session; there is no listener here. */
  #dismiss(): boolean {
    if (this.#reviewTarget) { this.#cancelReview(); return true }
    if (this.#managing) { this.#managing = ''; this.#render(); return true }
    if (this.#query) { this.#query = ''; this.#render(); return true }
    if (this.#mode === 'store') { this.#closeStore(); return true }
    if (this.#lens !== 'behaviors') { this.#lens = 'behaviors'; this.#render(); return true }
    return false
  }

  // ── asking the drone ─────────────────────────────────────────────────

  /** Ask the drone to describe a LOCATION — the one way this panel changes
   *  subject, whether the trigger is navigation, the rail switch, the crumb's
   *  self step or a roster flip. Empty segments are the hive ROOT and must say
   *  so: `root: true` is what tells the drone not to resolve the label as a
   *  tile at the current location. */
  #openAt(segments: readonly string[], rootLabel = 'hypercomb'): void {
    const segs = segments.map(s => String(s ?? '').trim()).filter(Boolean)
    if (segs.length === 0) {
      EffectBus.emit('tile:action', { action: 'features', label: rootLabel, segments: [], root: true })
      return
    }
    EffectBus.emit('tile:action', { action: 'features', label: segs[segs.length - 1], segments: segs })
  }

  /** Re-request the current group so the drone re-marks its rows (fresh
   *  dormant/global-off state). Same pipeline follow-navigation uses. */
  #refreshGroup(): void {
    const g = this.#group
    if (!g) return
    this.#openAt(g.segments, g.cell)
  }

  #ensureLineage(): void {
    if (this.#lineageBound) return
    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    if (!lineage?.addEventListener) return
    this.#lineage = lineage
    this.#lastNavKey = (lineage.explorerSegments?.() ?? []).join('\u0000')
    lineage.addEventListener('change', this.#onNav)
    this.#lineageBound = true
  }

  /** Where the participant is standing, read fresh from lineage. */
  #currentSegments(): string[] {
    this.#ensureLineage()
    return (this.#lineage?.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim()).filter(Boolean)
  }

  /** THE PANEL FOLLOWS NAVIGATION. Arriving on a layer makes it the subject —
   *  SELF — even when a tile's puzzle-piece had pinned a child before the walk.
   *  Root is a context too: leaving the panel on the previous tile's group
   *  after backing out to `/` showed a subject nobody is standing on. */
  #onNav = (): void => {
    const segs = this.#currentSegments()
    const key = segs.join('\u0000')
    if (key === this.#lastNavKey) return
    this.#lastNavKey = key
    if (!this.#visible) return
    this.#openAt(segs)
  }

  // ── download stall leash ─────────────────────────────────────────────
  #armDownloadLeash(): void {
    this.#clearDownloadLeash()
    this.#downloadLeash = setTimeout(() => {
      this.#downloadLeash = null
      const open = [...this.#downloading]
      if (!open.length) return
      this.#downloading = new Set()
      for (const cell of open) this.#recordResult({ cell, ok: false, files: 0, failed: 0, stalled: true })
      if (this.#visible) this.#render()
    }, DOWNLOAD_STALL_MS)
  }

  #clearDownloadLeash(): void {
    if (!this.#downloadLeash) return
    clearTimeout(this.#downloadLeash)
    this.#downloadLeash = null
  }

  /** Upsert one cell's download outcome. */
  #recordResult(r: DownloadResult): void {
    this.#downloadResults = [...this.#downloadResults.filter(x => x.cell !== r.cell), r]
  }

  /** Read a feature resource's bytes as text for review (capped). */
  async #fetchCode(sig: string): Promise<string> {
    try {
      const store = get<StoreLike>('@hypercomb.social/Store')
      const blob = await store?.getResource?.(sig)
      if (!blob) return '(could not load feature code)'
      const text = await blob.text()
      return text.length > 200_000 ? text.slice(0, 200_000) + '\n… (truncated for review)' : text
    } catch {
      return '(could not load feature code)'
    }
  }

  // ── the review gate's three exits ────────────────────────────────────

  /** Accept the reviewed feature (or BYPASS as an explicit override). */
  #acceptReview(bypassed: boolean): void {
    const target = this.#reviewTarget
    if (!target) return
    this.#codeOpen = false
    markVerified({ sig: target.sig, cell: target.cell, kind: target.kind, label: target.label, bypassed })
    if (target.kind === 'website' && target.segments.length) markAllowedRoot(branchRootFor(target.segments))
    EffectBus.emit('feature:verified', { sig: target.sig })
    this.#reviewTarget = null
    this.#render()
  }

  #cancelReview(): void {
    this.#codeOpen = false
    this.#reviewTarget = null
    this.#render()
  }

  /** Leave it gated and get on with things. */
  #waitForCommunity(): void {
    this.#codeOpen = false
    this.#reviewTarget = null
    this.#render()
  }

  // ── the pool's one gesture ───────────────────────────────────────────

  /** Flip one global light. Optimistic row update — the writer emits
   *  `behavior:enablement-changed`, so every other surface reacts at once.
   *  Turning a light ON is also the participant's OK: no separate gate chip
   *  ever asks again from a list row. */
  #storeToggle(row: StoreRow): void {
    if (this.#isRepeatPress('pool/' + row.kind)) return
    const next = !row.on
    setKindGlobalOn(row.kind, next)
    this.#storeRows = this.#storeRows.map(r => r.kind === row.kind ? { ...r, on: next } : r)
    this.#render()
  }

  /** Open the store (header button; WORLD stage and the join selector emit the
   *  same effect). show-features answers with the rows. */
  #openStore(): void {
    EffectBus.emit('features:roster-open', {})
  }

  /** Leave the store back to the per-tile surface. The group's rows carry the
   *  dormant/global-off marks computed when the group was OPENED — any switch
   *  flipped in the store made them stale, so re-request the group rather than
   *  showing rows that should have disappeared. */
  #closeStore(): void {
    if (this.#mode !== 'store') return
    this.#mode = 'tile'
    this.#render()
    this.#refreshGroup()
  }

  #toggleScope(): void {
    if (this.#mode === 'store') this.#closeStore()
    else this.#openStore()
  }

  #toggleAnchored(): void {
    const next = !this.#showAnchored
    this.#showAnchored = next
    try { localStorage.setItem(ANCHORED_PREF_KEY, next ? '1' : '0') } catch { /* private-browsing */ }
    this.#render()
  }

  #onQuery(value: string): void {
    this.#query = String(value ?? '')
    this.#render()
  }

  // ── legacy hidden-pool drain (read + restore only) ────────────────────

  async #refreshHidden(): Promise<void> {
    this.#hidden = await loadHidden()
    if (this.#visible) this.#render()
  }

  async #refreshMembers(): Promise<void> {
    const list = await listAggregation('websites').catch(() => [])
    this.#websiteMembers = new Set(list.map(m => m.segments.join('/')))
    if (this.#visible) this.#render()
  }

  /** WHERE this row's records scope to — kept identical to the old writer so
   *  legacy records and row keys still resolve. */
  #segmentsFor(group: FeatureGroup, feat: RowLike): string[] {
    if (feat.hideAt === 'node') return [...group.segments]
    return feat.originSegments?.length ? [...feat.originSegments] : [...group.segments]
  }

  /** Stable per-row key (feature kind @ scope). */
  #rowKey(group: FeatureGroup, feat: RowLike): string {
    return hiddenKey(feat.kind, this.#segmentsFor(group, feat))
  }

  /** The LEGACY hidden record currently suppressing this row (at this node, or
   *  an ancestor for scope features). Null = nothing suppressed. */
  #suppressingRecord(group: FeatureGroup, feat: RowLike): HiddenFeature | null {
    const byKey = (key: string): HiddenFeature | undefined =>
      this.#hidden.find(r => hiddenKey(r.featKind, r.appliesTo) === key)
    const own = byKey(this.#rowKey(group, feat))
    if (own) return own
    if (feat.hideAt !== 'node') return null
    for (let depth = group.segments.length - 1; depth >= 1; depth--) {
      const rec = byKey(hiddenKey(feat.kind, group.segments.slice(0, depth)))
      if (rec) return rec
    }
    return null
  }

  #isSuppressed(group: FeatureGroup, feat: RowLike): boolean {
    return this.#suppressingRecord(group, feat) != null
  }

  /** Restore a legacy-suppressed row: remove the record that silences it. */
  #restoreLegacy(group: FeatureGroup, feat: FeatureRow): void {
    const rec = this.#suppressingRecord(group, feat)
    if (!rec) return
    // Optimistic: the row lights up now; a failed write puts it back.
    this.#hidden = this.#hidden.filter(r => r.recordSig !== rec.recordSig)
    this.#render()
    void restoreFeature(rec.recordSig, {
      featKind: rec.featKind,
      view: rec.view || feat.view,
      segments: rec.appliesTo,
    }).then(ok => {
      if (ok) return
      this.#hidden = [...this.#hidden, rec]
      this.#setNote(this.#rowKey(group, feat), t('features.note.noanswer', 'no answer — try again'))
      this.#render()
    }).catch(() => undefined)
  }

  // ── selection / bulk ─────────────────────────────────────────────────

  #isSelected(group: FeatureGroup, feat: RowLike): boolean {
    return this.#selectedKeys.has(this.#rowKey(group, feat))
  }

  /** Toggle a row in the multi-selection the bulk bar acts on. */
  #selectRow(group: FeatureGroup, feat: RowLike): void {
    const key = this.#rowKey(group, feat)
    const next = new Set(this.#selectedKeys)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    this.#selectedKeys = next
    this.#render()
  }

  #clearSelection(): void {
    this.#selectedKeys = new Set()
    this.#render()
  }

  /** Every currently-selected row of the active tile. */
  #selectedRows(): { group: FeatureGroup; feat: RowLike }[] {
    const group = this.#group
    if (!group) return []
    const picked = this.#selectedKeys
    const out: { group: FeatureGroup; feat: RowLike }[] = []
    for (const feat of group.applied) {
      if (picked.has(this.#rowKey(group, feat))) out.push({ group, feat })
    }
    for (const feat of group.available) {
      if (picked.has(this.#rowKey(group, feat))) out.push({ group, feat })
    }
    return out
  }

  /** Bulk download — mirror every selected feature's bytes onto this machine. */
  #downloadSelected(): void {
    const cells = new Set<string>()
    for (const { group, feat } of this.#selectedRows()) {
      if (!feat.branchSig && !feat.gateSig) continue
      cells.add(group.cell)
      EffectBus.emit('features:download', {
        cell: group.cell,
        segments: [...group.segments],
        ...(feat.branchSig ? { branchSig: feat.branchSig } : {}),
        ...(feat.gateSig ? { gateSig: feat.gateSig } : {}),
      })
    }
    if (!cells.size) return
    if (this.#downloading.size === 0) this.#downloadedCount = 0
    this.#downloadResults = this.#downloadResults.filter(r => !cells.has(r.cell))
    this.#downloading = new Set([...this.#downloading, ...cells])
    this.#armDownloadLeash()
    this.#render()
  }

  #isDownloading(): boolean { return this.#downloading.size > 0 }

  // ── the rows ─────────────────────────────────────────────────────────

  /** Case-insensitive substring across the row's searchable text. */
  #matchesQuery(
    group: FeatureGroup,
    feat: { label?: string; kind?: string; description?: string; slashCommand?: string; originSegments?: string[] },
  ): boolean {
    const q = this.#query.trim().toLowerCase()
    if (!q) return true
    const segs = feat.originSegments?.length ? feat.originSegments : group.segments
    const lineage = segs.join('/')
    return [feat.label, feat.kind, feat.description, feat.slashCommand, lineage, group.cell]
      .some(v => typeof v === 'string' && v.toLowerCase().includes(q))
  }

  /** The tile's rows — its decorations (direct + inherited), through the search
   *  filter. A DORMANT kind (light off in the store) is filtered totally: off
   *  means gone, and the store is where it comes back. */
  #visibleApplied(group: FeatureGroup): FeatureRow[] {
    return group.applied.filter(f => !f.dormant && this.#matchesQuery(group, f))
  }

  /** The offerable rows: only behaviors whose global light is on. */
  #visibleAvailable(group: FeatureGroup): AvailableRow[] {
    return group.available.filter(f => !f.globalOff && this.#matchesQuery(group, f))
  }

  /** THIS LAYER, one list: every behavior that could live here — lit when its
   *  record is deposited (directly, or flowing from an ancestor), dim when not
   *  here yet. Same rows, same bulb as the pool. */
  #layerRows(group: FeatureGroup): LayerRow[] {
    const rows: LayerRow[] = []
    for (const f of this.#visibleApplied(group)) {
      rows.push({
        kind: f.kind, view: f.view, icon: f.icon, label: f.label,
        description: f.description, slashCommand: f.slashCommand,
        on: this.#painted(group, f, this.#isOn(group, f)), applied: true,
        inherited: f.origin === 'cascade',
        openable: f.openable === true && this.#isOn(group, f),
        // Deliberately NOT ANDed with on-ness the way `openable` is: a view
        // merely offered here is still a view, and the background says so.
        isView: f.openable === true,
        manageScopes: f.manageScopes === true,
        sourceScope: f.sourceScope, queenKey: f.queenKey,
        originCell: f.originCell, foreign: f.foreign, module: f.module,
        bound: f.bound, feat: f,
      })
    }
    for (const f of this.#visibleAvailable(group)) {
      rows.push({
        kind: f.kind, view: f.view, icon: f.icon, label: f.label,
        description: f.description, slashCommand: f.slashCommand,
        on: this.#painted(group, f, false), applied: false, inherited: false, openable: false,
        isView: f.isView === true, manageScopes: false,
        bound: f.bound, feat: f,
      })
    }
    // Beehaviours INCLUDE views, so that position filters NOTHING — only the
    // narrow one has anything to drop.
    return this.#lens === 'views' ? rows.filter(r => r.isView) : rows
  }

  /** THE PRESS ANSWERS ITSELF. A layer row's truth comes back from the drone,
   *  and until it does the row paints WHAT THE PRESS ASKED FOR. `pending`
   *  carries that wish for exactly the right window — set on the press, dropped
   *  when the fresh group lands. ONLY THE PAINT IS OPTIMISTIC: every handler
   *  still branches on the truth, which is why a second press is refused while
   *  the first is in flight. */
  #painted(group: FeatureGroup, feat: RowLike, truth: boolean): boolean {
    const wish = this.#pending.get(this.#rowKey(group, feat))
    return wish === undefined ? truth : wish
  }

  #isPending(group: FeatureGroup, feat: RowLike): boolean {
    return this.#pending.has(this.#rowKey(group, feat))
  }

  /** The row's plain-words outcome note ('' = none). Failures only. */
  #rowNote(group: FeatureGroup, feat: RowLike): string {
    return this.#rowNotes.get(this.#rowKey(group, feat)) ?? ''
  }

  /** The WHY line under a failure note while fetching is degraded. */
  #healthWhy(): string {
    const h = this.#health
    if (!h || h.condition === 'healthy') return ''
    // A condition the classifier does not mint draws NOTHING rather than the
    // raw key the Angular pipe would have painted — the one deliberate
    // departure, and it can only fire on a condition that does not exist.
    const fallback = HEALTH_WHY[h.condition]
    if (!fallback) return ''
    return t(`health.${h.condition}`, fallback, { host: h.host ?? '' })
  }

  #setNote(key: string, message: string): void {
    const next = new Map(this.#rowNotes)
    next.set(key, message)
    this.#rowNotes = next
  }

  /** Drop one row's note (a retry starts clean). */
  #clearNote(key: string): void {
    if (!this.#rowNotes.has(key)) return
    const next = new Map(this.#rowNotes)
    next.delete(key)
    this.#rowNotes = next
  }

  /** ONE PRESS PER SETTLED STATE. A switch that answers in 136ms on an empty
   *  hive answers slower on a full one, and a participant who does not see it
   *  move presses again — landing a SECOND flip that puts the row back where it
   *  started. A repeat press on the SAME row inside this window is that doubt,
   *  not a change of mind, so it is dropped. */
  #isRepeatPress(key: string): boolean {
    const now = Date.now()
    const last = this.#lastPress.get(key) ?? 0
    // Stamped even when the press is dropped: a held-down repeat stays one
    // gesture instead of leaking a flip every other press.
    this.#lastPress.set(key, now)
    return now - last < PRESS_REPEAT_MS
  }

  /** Backstop leash for a row action: the drone answers every add/remove with
   *  `features:outcome` — this fires only when the producer died. */
  #armRowLeash(key: string): void {
    const timer = setTimeout(() => {
      this.#rowLeashes.delete(timer)
      if (!this.#pending.has(key)) return
      const next = new Map(this.#pending)
      next.delete(key)
      this.#pending = next
      this.#setNote(key, t('features.note.noanswer', 'no answer — try again'))
      if (this.#visible) this.#render()
    }, ROW_LEASH_MS)
    this.#rowLeashes.add(timer)
  }

  // ── the layer row's verbs ────────────────────────────────────────────

  /** Is this row live here? Suppression is the legacy drain; a WEBSITE row is
   *  additionally on only when its SITE — keyed by the scope root, wherever in
   *  the branch you stand — is a MEMBER of the websites menu (membership IS
   *  what mints the /websites link). */
  #isOn(group: FeatureGroup, feat: FeatureRow): boolean {
    if (this.#isSuppressed(group, feat)) return false
    if (feat.view === 'website' && (this.#isScopeRoot(group, feat) || feat.origin === 'cascade')) {
      return this.#websiteMembers.has(this.#websiteRootSegments(group, feat).join('/'))
    }
    return true
  }

  /** The tile a website row's control acts on: its scope ROOT — the parent the
   *  site belongs to — falling back to the row's own tile when the row IS the
   *  root (or a fresh site is being declared here). */
  #websiteRootSegments(group: FeatureGroup, feat: FeatureRow): string[] {
    return [...(feat.scopeSegments?.length ? feat.scopeSegments : group.segments)]
  }

  /** Is this node the row's scope ROOT (the site's declaring tile)? */
  #isScopeRoot(group: FeatureGroup, feat: FeatureRow): boolean {
    if (!feat.scopeSegments?.length) return true
    return feat.scopeSegments.join('/') === group.segments.join('/')
  }

  /** True when the row is a website at ITS OWN root — the one row whose action
   *  is a membership toggle rather than remove. */
  #isWebsiteRoot(group: FeatureGroup, feat: FeatureRow): boolean {
    return feat.view === 'website' && this.#isScopeRoot(group, feat)
  }

  /** Can this row be REMOVED here — a decoration this tile itself carries? */
  #canRemove(group: FeatureGroup, feat: FeatureRow): boolean {
    return feat.origin !== 'cascade'
      && !this.#isWebsiteRoot(group, feat)
      && !this.#isSuppressed(group, feat)
  }

  /** The one gesture: click flips the row's light for this layer. Off → on is a
   *  DEPOSIT; on → off removes the record here. A website at its own root keeps
   *  its one meaning (membership of the /websites menu); a legacy-suppressed
   *  row restores; an inherited row flips at its origin, so here it only
   *  explains itself. Ctrl/Shift still selects for the bulk download bar. */
  #toggleRow(group: FeatureGroup, row: LayerRow, event?: MouseEvent): void {
    if (event && (event.ctrlKey || event.metaKey || event.shiftKey)) {
      this.#selectRow(group, row.feat)
      return
    }
    if (this.#isPending(group, row.feat)) return
    if (this.#isRepeatPress(this.#rowKey(group, row.feat))) return
    if (!row.applied) {
      this.#enableHere(group, row.feat as AvailableRow)
      return
    }
    const feat = row.feat as FeatureRow
    if (this.#isSuppressed(group, feat)) { this.#restoreLegacy(group, feat); return }
    // A WEBSITE BELONGS TO ITS ROOT TILE (Jaime, 2026-08-20): the row shows
    // anywhere within the site's branch, and its control acts at THAT parent —
    // the tile the website belongs to — from wherever you stand. Never "apply
    // it here": a site applied where you happen to be standing is a site
    // divorced from its tile. The one exception stays local: a child that
    // CARRIES its own page (a direct decoration) turns that page off in place
    // via removeHere below — the site itself is still managed at its root.
    if (feat.view === 'website' && (this.#isScopeRoot(group, feat) || feat.origin === 'cascade')) {
      void this.#toggleWebsite(group, feat)
      return
    }
    if (feat.origin === 'cascade') return
    this.#removeHere(group, feat)
  }

  /** Turn a behavior ON for this layer — the drone deposits its record at these
   *  explicit segments (never the current selection or location), and the
   *  record waits on what's beneath. */
  #enableHere(group: FeatureGroup, feat: AvailableRow): void {
    const key = this.#rowKey(group, feat)
    if (this.#pending.has(key)) return
    this.#pending = new Map(this.#pending).set(key, true)
    this.#clearNote(key)
    EffectBus.emit('features:enable', {
      cell: group.cell,
      segments: [...group.segments],
      kind: feat.kind,
      view: feat.view,
    })
    this.#armRowLeash(key)
    this.#render()
  }

  /** REMOVE this tile's decoration for the row — membership is positive, so
   *  removal is the whole off. The drone answers with `features:outcome` and
   *  re-opens the group. */
  #removeHere(group: FeatureGroup, feat: FeatureRow): void {
    if (!this.#canRemove(group, feat)) return
    const key = this.#rowKey(group, feat)
    if (this.#pending.has(key)) return
    this.#pending = new Map(this.#pending).set(key, false)
    this.#clearNote(key)
    EffectBus.emit('features:remove', {
      cell: group.cell,
      segments: [...group.segments],
      kind: feat.kind,
    })
    this.#armRowLeash(key)
    this.#render()
  }

  /** The website's ONE toggle: membership of the websites menu — positive
   *  membership, consistent with the model. Acts at the site's ROOT from
   *  anywhere within the branch. Optimistic both ways. */
  async #toggleWebsite(group: FeatureGroup, feat: FeatureRow): Promise<void> {
    const segments = this.#websiteRootSegments(group, feat)
    const memberKey = segments.join('/')
    const wasMember = this.#websiteMembers.has(memberKey)
    if (wasMember) {
      const next = new Set(this.#websiteMembers)
      next.delete(memberKey)
      this.#websiteMembers = next
      this.#render()
      void disableAggregation('websites', segments).catch(() => false)
      return
    }
    this.#websiteMembers = new Set(this.#websiteMembers).add(memberKey)
    this.#render()
    void enableAggregation('websites', segments, {
      label: segments[segments.length - 1] ?? group.cell,
    }).then(marker => {
      if (marker) return
      const next = new Set(this.#websiteMembers)
      next.delete(memberKey)
      this.#websiteMembers = next
      this.#setNote(this.#rowKey(group, feat), t('features.note.noanswer', 'no answer — try again'))
      this.#render()
    }).catch(() => undefined)
  }

  /** THE DEFAULT — clicking a VIEW row's own icon. "When you come to this
   *  layer, open as this." Mutually exclusive by construction: the record is
   *  REPLACED, never appended, so choosing a second view is the same gesture as
   *  choosing the first, and clicking the lit one clears it. */
  #setDefaultView(group: FeatureGroup, row: LayerRow, event?: Event): void {
    event?.stopPropagation()
    if (!this.#canDefault(row)) return
    const clear = this.#defaultView === row.view
    this.#defaultView = clear ? '' : row.view
    EffectBus.emit('features:default', {
      cell: group.cell,
      segments: [...group.segments],
      view: row.view,
      clear,
    })
    this.#render()
  }

  #isDefaultView(row: LayerRow): boolean {
    return row.isView && !!row.view && this.#defaultView === row.view
  }

  /** Can this row's icon be pressed to make it the layer's default? Only a view
   *  (a behaviour that is not a surface has nothing to open as), only a row
   *  that is ON here, and never an inherited one — that is managed where it
   *  flows from, defaults included. */
  #canDefault(row: LayerRow): boolean {
    return row.isView && !!row.view && row.on && !row.inherited
  }

  /** Open (or put away) the row's manage strip. */
  #toggleManage(row: LayerRow, event?: Event): void {
    event?.stopPropagation()
    if (!row.manageScopes) return
    this.#managing = this.#managing === row.kind ? '' : row.kind
    this.#render()
  }

  #isManaging(row: LayerRow): boolean {
    return row.manageScopes && this.#managing === row.kind
  }

  /** THE ONE THING A ROW MANAGES — where the behaviour reads from: this layer's
   *  own children, or the whole hierarchy beneath it. The bee owns the write;
   *  the panel only asks, the way it asks for everything it cannot write. */
  async #setSourceScope(group: FeatureGroup, row: LayerRow, scope: 'layer' | 'hierarchy'): Promise<void> {
    if (!row.manageScopes || !row.queenKey || row.sourceScope === scope) return
    const queen = get<QueenLike>(row.queenKey)
    if (!queen?.invoke) return
    // Onto the SOURCE row, not the LayerRow: #layerRows() rebuilds its objects
    // on every render, so a choice written on the row itself is gone by the
    // next paint. The re-open below confirms it for real.
    ;(row.feat as FeatureRow).sourceScope = scope
    row.sourceScope = scope
    this.#render()
    await queen.invoke('scope ' + scope)
    this.#openAt(group.segments, group.cell)
  }

  /** ENTER a lit view behaviour — the hover-only Open. Navigates to the row's
   *  scope root (a cascade row's surface lives there, not here) and flips the
   *  render surface to its view; in-place views mount over the current layer. */
  #openBehavior(group: FeatureGroup, row: LayerRow): void {
    if (!row.openable || !row.view) return
    const feat = row.feat as FeatureRow
    if (feat.opensInPlace) {
      EffectBus.emit('view:open-for-tile', { view: row.view, segments: [...group.segments] })
      this.close()
      return
    }
    get<NavigationLike>('@hypercomb.social/Navigation')
      ?.go?.([...(feat.scopeSegments?.length ? feat.scopeSegments : group.segments)])
    EffectBus.emit('view:toggle', { view: row.view, mode: 'on' })
    this.close()
  }

  /** Re-target this window at the canvas selection. */
  #openSelectionFeatures(): void {
    EffectBus.emit('controls:action', { action: 'features' })
  }

  /** Phone-only door back to the hive in picking mode. */
  #selectTile(): void {
    if (!this.#isPhone) return
    const picker = get<SelectModeLike>(SELECT_MODE_KEY)
    if (!picker?.arm) return
    this.close()
    picker.arm()
  }

  // ── chrome (built once per activation) ───────────────────────────────
  protected override renderPanel(): void {
    const header = el('header', 'features-header')

    const brand = el('div', 'features-brand')
    const mark = el('span', 'features-brand-mark')
    mark.setAttribute('aria-hidden', 'true')
    mark.appendChild(sym('extension'))
    const title = el('span', 'features-title')
    brand.append(mark, title)

    // WHAT, then WHO — see #renderTitle. The close button is the header's LAST
    // child because that is the node DockedPanelElement nudges over to make
    // room for the settings gear.
    const close = el('button', 'features-close')
    close.type = 'button'
    close.appendChild(sym('close', true))
    close.setAttribute('aria-label', t('features.close', 'close'))
    close.addEventListener('click', () => this.close())
    header.append(brand, close)

    // `display: contents` on the body and its two slots — the scope strip, the
    // search field, the bands and the scroller stay flex items of the PANEL
    // (the scroller's `flex: 1` is what makes it the scrolling half), while the
    // slots still hold everything a rebuild replaces. Without them a rebuild
    // reaching for the panel's own children would take the base's resize grip
    // and settings gear with it. TWO slots, not one, because the search field
    // lives BETWEEN them and is kept: rebuilding the input on every keystroke
    // would drop the caret it is receiving.
    const body = el('div', 'features-body')
    const top = el('div', 'features-slot')
    const search = this.#buildSearch()
    const bottom = el('div', 'features-slot')
    body.append(top, search, bottom)

    this.append(header, body)
    this.#titleEl = title
    this.#closeEl = close
    this.#topSlot = top
    this.#bottomSlot = bottom
    this.#render()
  }

  /** The header IS the search — the panel name rides in the placeholder. Built
   *  once per activation and kept; only its value and the anchored filter are
   *  synced. */
  #buildSearch(): HTMLElement {
    const bar = el('div', 'features-searchbar')
    bar.appendChild(sym('search', true))

    const input = document.createElement('input')
    input.className = 'features-search'
    input.type = 'search'
    input.spellcheck = false
    input.autocomplete = 'off'
    input.dataset['hcRow'] = 'search'
    const placeholder = t('features.search.placeholder', 'search beehaviors…')
    input.placeholder = placeholder
    input.setAttribute('aria-label', placeholder)
    input.addEventListener('input', () => this.#onQuery(input.value))
    bar.appendChild(input)

    // Sticky pool filter: anchored (tile-bound) behaviors in or out, so the
    // pool can be read as just the hive-wide ones. Store mode only — it is
    // appended and removed rather than hidden, the way the `@if` detached it.
    const anchored = el('button', 'features-anchored')
    anchored.type = 'button'
    anchored.dataset['hcRow'] = 'anchored'
    anchored.appendChild(sym('anchor', true))
    anchored.addEventListener('click', () => this.#toggleAnchored())

    this.#searchBar = bar
    this.#searchInput = input
    this.#anchoredBtn = anchored
    return bar
  }

  /** Keep the kept field in step with the state — the value only when it has
   *  genuinely diverged (writing it back on every keystroke would move the
   *  caret to the end), and the anchored filter in or out of the DOM. */
  #syncSearch(): void {
    const input = this.#searchInput
    if (input && input.value !== this.#query) input.value = this.#query
    const bar = this.#searchBar
    const anchored = this.#anchoredBtn
    if (!bar || !anchored) return
    if (this.#isStore) {
      if (anchored.parentNode !== bar) bar.appendChild(anchored)
      const active = !this.#showAnchored
      anchored.classList.toggle('active', active)
      anchored.setAttribute('aria-pressed', String(active))
      anchored.setAttribute('title', this.#showAnchored
        ? t('features.pool.anchored.hide', 'Hide beehaviors anchored to a tile — see only the hive-wide ones.')
        : t('features.pool.anchored.show', 'Show beehaviors anchored to a tile as well.'))
    } else {
      anchored.remove()
    }
  }

  /** Re-resolve the strings written ONCE per activation — the ones a body
   *  rebuild never touches. Every other string comes back through #render. */
  #relabel(): void {
    const title = t('features.viewer.title', 'Beehaviors')
    this.setAttribute('aria-label', title)
    this.#closeEl?.setAttribute('aria-label', t('features.close', 'close'))
    const placeholder = t('features.search.placeholder', 'search beehaviors…')
    this.#searchInput?.setAttribute('placeholder', placeholder)
    this.#searchInput?.setAttribute('aria-label', placeholder)
  }

  // ── rendering (rebuild on change — the house pattern, no reconciler) ──
  #render(): void {
    const top = this.#topSlot
    const bottom = this.#bottomSlot
    if (!top || !bottom) return

    // WHERE THE PARTICIPANT WAS. Angular kept every list node for the panel's
    // whole life, so a roster flip (or a `/language` switch) landing while you
    // scrolled was invisible. Rebuild-on-change owes that back: scroll measured
    // before the teardown and applied after the new nodes are in the document
    // (scrollTop on a detached node does not stick), and focus restored by
    // `data-hc-row` — a key this view stamps — never by a class. Four buttons
    // in one row share their spellings, and restoring by class would put the
    // ring on the wrong verb.
    const scrolls = this.#scrollSnapshot()
    const focus = focusSnapshot(this)

    this.classList.toggle('reviewing', this.#isPhone && !!this.#reviewTarget)
    this.#renderTitle()
    this.#syncSearch()

    top.replaceChildren(this.#renderScope())
    bottom.replaceChildren(...this.#renderBottom())

    this.#restoreScroll(scrolls)
    restoreFocus(this, focus)
  }

  /** Every scroller in the body, by the key it stamps on itself. */
  #scrollSnapshot(): Map<string, number> {
    const out = new Map<string, number>()
    for (const node of this.querySelectorAll<HTMLElement>('[data-hc-scroll]')) {
      const key = node.dataset['hcScroll']
      if (key && node.scrollTop > 0) out.set(key, node.scrollTop)
    }
    return out
  }

  #restoreScroll(snapshot: ReadonlyMap<string, number>): void {
    if (snapshot.size === 0) return
    for (const node of this.querySelectorAll<HTMLElement>('[data-hc-scroll]')) {
      const key = node.dataset['hcScroll']
      const top = key ? snapshot.get(key) : undefined
      if (top !== undefined) node.scrollTop = top
    }
  }

  /** WHAT, then WHO. Two segments, never three: the app word, then the SUBJECT
   *  — the layer's own name, in its own casing. The POOL has no subject: it is
   *  attached to no tile, so it says `global` there and the word is the whole
   *  answer. The HIVE ROOT has no name to give, so it gets no second segment at
   *  all rather than a separator with nothing after it. */
  #renderTitle(): void {
    const title = this.#titleEl
    if (!title) return
    title.replaceChildren(el('span', 'features-title-app', t('features.viewer.title', 'Beehaviors')))
    const sep = (): HTMLElement => {
      const node = el('span', 'features-title-sep', '/')
      node.setAttribute('aria-hidden', 'true')
      return node
    }
    if (this.#isStore) {
      title.append(sep(), el('span', 'features-title-scope', t('features.where.global', 'Global')))
      return
    }
    const name = this.#subjectName
    if (!name) return
    const cell = el('span', 'features-title-cell', name)
    cell.title = name
    title.append(sep(), cell)
  }

  /** KIND, then SCOPE. Two questions, two controls, never one icon cycling
   *  through both — and they sit on the two gutters. LEFT: the KIND, as a
   *  CHOICE between two and never a pair of switches, each in its own kind's
   *  hue; they belong to the layer scope alone, so the pool never draws them.
   *  RIGHT: one glyph naming WHERE YOU ARE, holding the right gutter whether or
   *  not the kind filters are there. */
  #renderScope(): HTMLElement {
    const strip = el('div', 'features-scope')

    if (!this.#isStore) {
      const kinds = el('div', 'scope-kinds')
      kinds.append(
        this.#kindButton('behaviors', 'extension',
          t('features.filter.behaviors', 'Beehaviors')),
        this.#kindButton('views', 'view_quilt',
          t('features.filter.views', 'Views')),
      )
      strip.appendChild(kinds)
    }

    const toggle = el('button', 'scope-toggle')
    toggle.type = 'button'
    toggle.dataset['hcRow'] = 'scope'
    if (this.#isStore) toggle.classList.add('pool')
    toggle.setAttribute('aria-pressed', String(this.#isStore))
    // `features.where.*`, NOT `features.scope.*` — `features.scope.layer` is
    // already the manage strip's "This layer", and a second key by that name
    // is a SILENT duplicate: JSON keeps the last one.
    toggle.setAttribute('title', this.#isStore
      ? t('features.where.layer.hint', 'This layer — what it carries, and what it could')
      : t('features.where.global.hint', 'The pool — every beehaviour, one global light each'))
    toggle.setAttribute('aria-label', this.#isStore
      ? t('features.where.global', 'Global')
      : t('features.where.layer', 'Layer'))
    toggle.appendChild(sym(this.#isStore ? 'storefront' : 'layers', true))
    toggle.addEventListener('click', () => this.#toggleScope())
    strip.appendChild(toggle)

    return strip
  }

  /** One kind glyph. Clicking the lit one is a no-op: there is nothing to
   *  un-pick, only the other one to pick. */
  #kindButton(kind: 'behaviors' | 'views', glyph: string, label: string): HTMLButtonElement {
    const btn = el('button', `scope-kind ${kind}`)
    btn.type = 'button'
    btn.dataset['hcRow'] = `lens:${kind}`
    const on = this.#lens === kind
    if (on) btn.classList.add('on')
    btn.setAttribute('aria-pressed', String(on))
    btn.setAttribute('title', label)
    btn.setAttribute('aria-label', label)
    btn.appendChild(sym(glyph, true))
    btn.addEventListener('click', () => {
      this.#lens = kind
      this.#render()
    })
    return btn
  }

  #renderBottom(): HTMLElement[] {
    const parts: HTMLElement[] = []
    const group = this.#group

    // The subject, on the phone: the way to hand the panel a tile.
    if (!this.#isStore && group
        && this.#isPhone && !this.#reviewTarget && group.segments.length) {
      const btn = el('button', 'features-select-tile')
      btn.type = 'button'
      btn.dataset['hcRow'] = 'select-tile'
      btn.append(sym('select_all', true),
        document.createTextNode(t('features.selectTile', 'Select tile')))
      btn.addEventListener('click', () => this.#selectTile())
      parts.push(btn)
    }

    // Canvas-selection response: selected tiles carry behaviors.
    if (this.#showCanvasSelectionAffordance && !this.#isStore) {
      const label = selectionLabel(this.#canvasSelectionCount)
      const btn = el('button', 'features-selection')
      btn.type = 'button'
      btn.dataset['hcRow'] = 'selection'
      btn.setAttribute('aria-label', label)
      btn.append(sym('extension', true), el('span', 'features-selection-label', label))
      btn.addEventListener('click', () => this.#openSelectionFeatures())
      parts.push(btn)
    }

    // Bulk bar: acts on the Ctrl/Shift-selected rows.
    if (this.#selectedCount > 0) parts.push(this.#renderBulkBar())

    // Download pathway: one stepper per tile, sent → receiving → done.
    const pathway = this.#pathway()
    if (pathway.length > 0) parts.push(this.#renderPathway(pathway))

    // Review gate: a foreign feature handed here by the website gate.
    if (this.#reviewTarget) parts.push(this.#renderReview(this.#reviewTarget))

    if (this.#isStore) {
      parts.push(this.#renderStore(), this.#renderStoreFoot())
    } else if (group) {
      parts.push(this.#renderLayer(group), this.#renderLayerFoot())
    } else {
      parts.push(el('p', 'features-empty',
        t('features.empty', "Click a tile's beehaviors icon to see the bees it uses.")))
    }
    return parts
  }

  #renderBulkBar(): HTMLElement {
    const bar = el('div', 'bulk-bar')
    const count = this.#selectedCount
    bar.appendChild(el('span', 'bulk-count',
      tCount('features.selected', '1 selected', '{count} selected', count)))

    const downloadable = this.#downloadableCount()
    if (downloadable > 0) {
      const busy = this.#isDownloading()
      const btn = el('button', 'bulk-download')
      btn.type = 'button'
      btn.dataset['hcRow'] = 'bulk-download'
      if (busy) btn.classList.add('busy')
      btn.disabled = busy
      btn.setAttribute('title', t('features.bulk.download.hint',
        "Fetch the selected beehaviors' content and resources onto this machine."))
      btn.textContent = `⤓ ${busy
        ? t('features.downloading', 'downloading…')
        : t('features.bulk.download', 'download')} · ${downloadable}`
      btn.addEventListener('click', () => this.#downloadSelected())
      bar.appendChild(btn)
    }

    const clear = el('button', 'bulk-clear', '×')
    clear.type = 'button'
    clear.dataset['hcRow'] = 'bulk-clear'
    clear.setAttribute('aria-label', t('features.selection.clear', 'clear selection'))
    clear.addEventListener('click', () => this.#clearSelection())
    bar.appendChild(clear)
    return bar
  }

  #renderPathway(pathway: readonly DownloadPath[]): HTMLElement {
    const status = el('div', 'download-status')
    status.setAttribute('role', 'status')
    status.setAttribute('aria-live', 'polite')

    for (const p of pathway) {
      const path = el('div', 'dl-path')
      if (p.stage === 3 && p.ok) path.classList.add('ok')
      if (p.stage === 3 && !p.ok) path.classList.add('fail')

      const head = el('div', 'dl-path-head')
      const cell = el('span', 'dl-cell', p.cell)
      cell.title = p.cell
      head.append(cell, el('span', 'dl-text', this.#pathText(p)))
      path.appendChild(head)

      const track = el('div', 'dl-track')
      const first = el('span', 'dl-node filled')
      if (p.active && p.stage === 1) first.classList.add('pulse')
      const seg1 = el('span', 'dl-seg')
      if (p.stage >= 2) seg1.classList.add('filled')
      const second = el('span', 'dl-node')
      if (p.stage >= 2) second.classList.add('filled')
      if (p.active && p.stage === 2) second.classList.add('pulse')
      const seg2 = el('span', 'dl-seg')
      if (p.stage >= 3) seg2.classList.add('filled')
      const terminal = el('span', 'dl-node terminal')
      if (p.stage >= 3) {
        terminal.classList.add('filled')
        terminal.textContent = p.ok ? '✓' : '✕'
      }
      track.append(first, seg1, second, seg2, terminal)
      path.appendChild(track)

      const labels = el('div', 'dl-labels')
      const sent = el('span', undefined, t('features.path.sent', 'sent'))
      if (p.stage >= 1) sent.classList.add('lit')
      const receiving = el('span', undefined, t('features.path.receiving', 'receiving'))
      if (p.stage >= 2) receiving.classList.add('lit')
      const done = el('span', undefined, p.stage === 3 && !p.ok
        ? t('features.path.failed', 'failed')
        : t('features.path.done', 'done'))
      if (p.stage >= 3) done.classList.add('lit')
      labels.append(sent, receiving, done)
      path.appendChild(labels)

      status.appendChild(path)
    }
    return status
  }

  /** The stepper's sentence. The template's exact ladder — `p.stage < 3` first,
   *  and `!p.ok && p.failed > 0` before the bare `!p.ok`, so a partial fetch
   *  never reads as a total failure. */
  #pathText(p: DownloadPath): string {
    if (p.stage < 3) {
      return this.#downloadedCount > 0
        ? tCount('features.download.active',
          'downloading… · 1 file fetched', 'downloading… · {count} files fetched', this.#downloadedCount)
        : t('features.downloading', 'downloading…')
    }
    if (p.stalled) {
      return t('features.download.stalled', 'no response — check your connection and try again')
    }
    if (!p.ok && p.failed > 0) {
      return tCount('features.download.partial',
        'download incomplete — 1 file missing', 'download incomplete — {count} files missing', p.failed)
    }
    if (!p.ok) return t('features.download.failed', 'download failed — try again')
    if (p.files === 0) return t('features.download.uptodate', 'already on this machine')
    return tCount('features.download.done', '1 file downloaded', '{count} files downloaded', p.files)
  }

  // ── the review gate ──────────────────────────────────────────────────
  #renderReview(rt: ReviewTarget): HTMLElement {
    return this.#isPhone ? this.#renderPhoneReview(rt) : this.#renderDeskReview(rt)
  }

  #renderDeskReview(rt: ReviewTarget): HTMLElement {
    const box = el('div', 'feature-review')
    box.append(
      this.#reviewHead(t('features.review.title', 'Review · {label}', { label: rt.label }), rt),
      el('p', 'review-note', t('features.review.note',
        'This page comes from another participant. Review its code, then enable it — nothing runs until you accept.')),
      this.#reviewCode(rt),
    )
    const actions = el('div', 'review-actions')
    actions.append(
      this.#reviewButton('review-accept', 'review:accept',
        t('features.review.accept', 'Accept & enable'), () => this.#acceptReview(false)),
      this.#reviewButton('review-bypass', 'review:bypass',
        t('features.review.bypass', 'Bypass'), () => this.#acceptReview(true),
        t('features.review.bypass.hint', 'Enable without reviewing the code — you accept the risk.')),
      this.#reviewButton('review-cancel', 'review:cancel',
        t('features.review.cancel', 'Cancel'), () => this.#cancelReview()),
    )
    box.appendChild(actions)
    return box
  }

  /** PHONE: a DECISION, and the code is somewhere you GO. */
  #renderPhoneReview(rt: ReviewTarget): HTMLElement {
    const box = el('div', 'feature-review phone')
    if (this.#codeOpen) box.classList.add('reading')

    if (this.#codeOpen) {
      const head = el('div', 'review-head')
      const back = el('button', 'review-back', '←')
      back.type = 'button'
      back.dataset['hcRow'] = 'review:back'
      back.setAttribute('aria-label', t('features.review.back', 'Back'))
      back.addEventListener('click', () => { this.#codeOpen = false; this.#render() })
      const kind = el('span', 'review-kind', rt.kind)
      kind.title = rt.sig
      head.append(back, el('span', 'review-title', rt.label), kind)
      box.append(head, this.#reviewCode(rt))

      const actions = el('div', 'review-actions')
      actions.append(
        this.#reviewButton('review-accept', 'review:accept',
          t('features.allow', 'allow'), () => this.#acceptReview(false)),
        this.#reviewButton('review-cancel', 'review:cancel',
          t('features.review.pending', 'Pending community verification'), () => this.#waitForCommunity()),
      )
      box.appendChild(actions)
      return box
    }

    box.append(
      this.#reviewHead(t('features.review.title', 'Review · {label}', { label: rt.label }), rt),
      el('p', 'review-note', t('features.review.note.phone',
        'This comes from another participant. Nothing runs until you decide.')),
      el('p', 'review-warn', t('features.review.warn',
        'Anything you allow runs with the same reach as the rest of your hive, so one bad one could reach all of it. Allow what you trust — the rest can wait for the community to vouch for it.')),
    )
    const actions = el('div', 'review-actions')
    actions.append(
      // BYPASS on the phone: the decision screen has no code beside it, so
      // allowing from here is the explicit override — exactly as the template
      // spelled it (`acceptReview(true)`).
      this.#reviewButton('review-accept', 'review:accept',
        t('features.allow', 'allow'), () => this.#acceptReview(true)),
      this.#reviewButton('review-cancel', 'review:cancel',
        t('features.review.pending', 'Pending community verification'), () => this.#waitForCommunity()),
      this.#reviewButton('review-readcode', 'review:readcode',
        t('features.review.readcode', 'Read the code'), () => { this.#codeOpen = true; this.#render() }),
    )
    box.appendChild(actions)
    return box
  }

  #reviewHead(title: string, rt: ReviewTarget): HTMLElement {
    const head = el('div', 'review-head')
    const kind = el('span', 'review-kind', rt.kind)
    kind.title = rt.sig
    head.append(el('span', 'review-title', title), kind)
    return head
  }

  #reviewCode(rt: ReviewTarget): HTMLElement {
    const pre = el('pre', 'review-code', rt.code)
    pre.dataset['hcScroll'] = 'review-code'
    return pre
  }

  #reviewButton(
    cls: string, focusKey: string, label: string, run: () => void, hint?: string,
  ): HTMLButtonElement {
    const btn = el('button', cls, label)
    btn.type = 'button'
    btn.dataset['hcRow'] = focusKey
    if (hint) btn.setAttribute('title', hint)
    btn.addEventListener('click', () => run())
    return btn
  }

  // ── THE POOL ─────────────────────────────────────────────────────────
  //
  // No tile subject, no verbs, no buttons. One row per behavior, one bulb
  // each — everything is off until it is lit here. Clicking flips the ONE
  // global light: off = dormant everywhere AND withheld from every swarm.
  // Decorations stay on their tiles.
  #renderStore(): HTMLElement {
    const scroll = el('div', 'features-scroll store')
    scroll.dataset['hcScroll'] = 'list'
    const section = el('section', 'features-group')
    const list = el('ul', 'features-list')

    for (const row of this.#storeList()) {
      const item = el('li', 'features-row')
      item.dataset['hcRow'] = `pool:${row.kind}`
      item.setAttribute('role', 'switch')
      item.tabIndex = 0
      item.setAttribute('aria-checked', String(row.on))
      item.classList.add(row.on ? 'lit' : 'off')
      item.setAttribute('title', row.on
        ? t('features.roster.off.hint',
          'Turn off everywhere — it goes dormant on every tile and is withheld from every swarm. Its tiles keep it; nothing is deleted.')
        : t('features.roster.on.hint', 'Turn on everywhere — wakes it wherever it lives.'))
      item.addEventListener('click', () => this.#storeToggle(row))
      item.addEventListener('keydown', (event) => {
        const key = plainActivation(event)
        if (!key) return
        this.#storeToggle(row)
        if (key === 'space') event.preventDefault()
      })

      const icon = el('span', 'feature-icon')
      icon.setAttribute('aria-hidden', 'true')
      icon.appendChild(sym(row.icon))

      const meta = el('div', 'feature-meta')
      const name = el('span', 'feature-name')
      name.append(document.createTextNode(row.label))
      if (row.slashCommand) name.appendChild(el('code', 'feature-cmd', row.slashCommand))
      meta.appendChild(name)
      if (row.foreign) {
        meta.appendChild(el('span', 'feature-awaiting',
          t('features.chip.awaiting', '{module} module not here yet', { module: row.module ?? '' })))
      }
      // BOUND: this behavior belongs to a tile, not to the hive. The pool is
      // the only place every binding is visible at once — everywhere else the
      // behavior has simply withdrawn.
      if (row.bound?.length) {
        const bound = el('span', 'feature-bound')
        bound.append(sym('link', true), document.createTextNode(
          t('features.bound.to', 'belongs to {cell}', { cell: this.#boundTo(row.bound) })))
        meta.appendChild(bound)
      }
      if (row.description) meta.appendChild(el('span', 'feature-desc', row.description))

      const bulb = el('span', 'feat-bulb')
      if (row.on) bulb.classList.add('on')
      bulb.setAttribute('aria-hidden', 'true')
      bulb.appendChild(sym('lightbulb'))

      item.append(icon, meta, bulb)
      list.appendChild(item)
    }

    section.appendChild(list)
    scroll.appendChild(section)
    return scroll
  }

  #renderStoreFoot(): HTMLElement {
    const foot = el('footer', 'features-foot')
    foot.appendChild(document.createTextNode(t('features.roster.hint',
      '{on} of {total} on · off = dormant everywhere and never shared · wake exceptions stay put',
      { on: this.#storeOnCount, total: this.#storeRows.length })))
    if (this.#storeBoundCount > 0) {
      foot.appendChild(el('span', 'foot-bound',
        t('features.roster.bound', '· {count} bound to a tile', { count: this.#storeBoundCount })))
    }
    return foot
  }

  // ── THIS LAYER ───────────────────────────────────────────────────────
  //
  // The same list as the pool, scoped here. One row per behavior, one bulb
  // each. Lit = its record is deposited on this layer (directly, or flowing
  // from an ancestor); dim = not here yet. Click flips it: on is a DEPOSIT
  // that waits on what's beneath, off removes the record here (undoable).
  // Inherited rows say where they flow from and flip at their origin. A row a
  // LEGACY hidden record still suppresses renders dim — clicking it restores.
  #renderLayer(group: FeatureGroup): HTMLElement {
    const scroll = el('div', 'features-scroll')
    scroll.dataset['hcScroll'] = 'list'
    const section = el('section', 'features-group')

    const rows = this.#layerRows(group)
    if (rows.length === 0) {
      section.appendChild(el('p', 'section-empty',
        t('features.applied.empty', 'No beehaviors on this layer yet.')))
      scroll.appendChild(section)
      return scroll
    }

    const list = el('ul', 'features-list')
    for (const row of rows) list.appendChild(this.#renderLayerRow(group, row))
    section.appendChild(list)
    scroll.appendChild(section)
    return scroll
  }

  #renderLayerRow(group: FeatureGroup, row: LayerRow): HTMLElement {
    const item = el('li', 'features-row')
    item.dataset['hcRow'] = `row:${this.#rowKey(group, row.feat)}`
    item.setAttribute('role', 'switch')
    item.tabIndex = 0
    item.setAttribute('aria-checked', String(row.on))
    item.classList.add(row.on ? 'lit' : 'off')
    if (row.inherited) item.classList.add('inherited')
    if (row.isView) item.classList.add('view')
    if (this.#isDefaultView(row)) item.classList.add('default-view')
    if (this.#isManaging(row)) item.classList.add('managing')
    if (this.#isSelected(group, row.feat)) item.classList.add('selected')
    if (this.#isPending(group, row.feat)) item.classList.add('busy')
    item.setAttribute('title', this.#rowTitle(row))
    item.addEventListener('click', (event) => this.#toggleRow(group, row, event))
    item.addEventListener('keydown', (event) => {
      const key = plainActivation(event)
      if (!key) return
      this.#toggleRow(group, row)
      if (key === 'space') event.preventDefault()
    })

    // THE ICON IS THE DEFAULT. On a lit view row it is the second control:
    // press it and this is what the layer opens as. Lit accent = it already is.
    // One per layer — pressing another moves it, pressing this one clears it.
    // Every other row's icon is just an icon.
    if (this.#canDefault(row)) {
      const isDefault = this.#isDefaultView(row)
      const label = isDefault
        ? t('features.default.clear', 'Open this layer as hexagons again')
        : t('features.default.set', 'Open this layer as this view')
      const btn = el('button', 'feature-icon as-default')
      btn.type = 'button'
      btn.dataset['hcRow'] = `default:${row.kind}`
      if (isDefault) btn.classList.add('is-default')
      btn.setAttribute('aria-pressed', String(isDefault))
      btn.setAttribute('title', label)
      btn.setAttribute('aria-label', label)
      btn.appendChild(sym(row.icon, true))
      btn.addEventListener('click', (event) => this.#setDefaultView(group, row, event))
      btn.addEventListener('keydown', stopPlainActivation)
      item.appendChild(btn)
    } else {
      const icon = el('span', 'feature-icon')
      icon.setAttribute('aria-hidden', 'true')
      icon.appendChild(sym(row.icon))
      item.appendChild(icon)
    }

    const meta = el('div', 'feature-meta')
    const name = el('span', 'feature-name')
    name.append(document.createTextNode(row.label))
    if (row.slashCommand) name.appendChild(el('code', 'feature-cmd', row.slashCommand))
    meta.appendChild(name)
    if (row.foreign) {
      meta.appendChild(el('span', 'feature-awaiting',
        t('features.chip.awaiting', '{module} module not here yet', { module: row.module ?? '' })))
    }
    if (row.description) meta.appendChild(el('span', 'feature-desc', row.description))
    const note = this.#rowNote(group, row.feat)
    if (note) {
      const noteEl = el('span', 'feature-note')
      noteEl.appendChild(document.createTextNode(note))
      const why = this.#healthWhy()
      if (why) noteEl.appendChild(el('span', 'note-why', why))
      meta.appendChild(noteEl)
    }
    if (this.#isDefaultView(row)) {
      meta.appendChild(el('span', 'feature-default-note',
        t('features.default.on', 'opens here by default')))
    }
    item.appendChild(meta)

    // Hover-only WHENCE — the row itself never specifies. Bound: this
    // beehavior is for this tile only. Inherited: where it flows from.
    if (row.bound || row.inherited) {
      const whence = el('span', 'feature-whence')
      whence.setAttribute('aria-hidden', 'true')
      if (row.bound) {
        whence.classList.add('bound')
        whence.append(sym('link'), document.createTextNode(
          t('features.bound.only', 'for “{cell}” only',
            { cell: row.bound.name ?? row.bound.path })))
      } else if (row.originCell) {
        whence.textContent = t('features.origin.cascade', '↳ from {cell}', { cell: row.originCell })
      } else {
        whence.textContent = t('features.origin.cascade.root', '↳ from the hive')
      }
      item.appendChild(whence)
    }

    // Hover-only MANAGE — shown only by a row that has something to decide.
    if (row.manageScopes) {
      const open = this.#isManaging(row)
      const btn = el('button', 'feat-manage')
      btn.type = 'button'
      btn.dataset['hcRow'] = `manage:${row.kind}`
      if (open) btn.classList.add('open')
      btn.setAttribute('title', t('features.manage.hint', 'Choose what this beehaviour reads'))
      btn.setAttribute('aria-label', t('features.manage', 'Manage'))
      btn.setAttribute('aria-expanded', String(open))
      btn.appendChild(sym('tune', true))
      btn.addEventListener('click', (event) => this.#toggleManage(row, event))
      btn.addEventListener('keydown', stopPlainActivation)
      item.appendChild(btn)
    }

    // Hover-only: a lit view behaviour can be entered.
    if (row.openable) {
      const label = t('features.open', 'open')
      const btn = el('button', 'feat-open', `▶ ${label}`)
      btn.type = 'button'
      btn.dataset['hcRow'] = `open:${row.kind}`
      btn.setAttribute('title', t('features.open.hint',
        'Open this beehavior now — enter its view (play the slides, show the page). The switch stays the on/off control.'))
      btn.setAttribute('aria-label', label)
      btn.addEventListener('click', (event) => {
        this.#openBehavior(group, row)
        event.stopPropagation()
      })
      btn.addEventListener('keydown', stopPlainActivation)
      item.appendChild(btn)
    }

    const bulb = el('span', 'feat-bulb')
    if (row.on) bulb.classList.add('on')
    bulb.setAttribute('aria-hidden', 'true')
    bulb.appendChild(sym('lightbulb'))
    item.appendChild(bulb)

    // MANAGE — only while asked, and only the one thing this row has to
    // decide: where it reads from. Its own line across the whole card.
    if (this.#isManaging(row)) {
      const strip = el('div', 'feature-manage')
      strip.addEventListener('click', (event) => event.stopPropagation())
      strip.append(
        this.#scopeChoice(group, row, 'layer', t('features.scope.layer', 'This layer'),
          row.sourceScope !== 'hierarchy'),
        this.#scopeChoice(group, row, 'hierarchy', t('features.scope.hierarchy', 'Everything beneath'),
          row.sourceScope === 'hierarchy'),
      )
      item.appendChild(strip)
    }

    return item
  }

  #scopeChoice(
    group: FeatureGroup, row: LayerRow, scope: 'layer' | 'hierarchy', label: string, on: boolean,
  ): HTMLButtonElement {
    const btn = el('button', undefined, label)
    btn.type = 'button'
    btn.dataset['hcRow'] = `scope-${scope}:${row.kind}`
    if (on) btn.classList.add('on')
    btn.addEventListener('click', () => { void this.#setSourceScope(group, row, scope) })
    return btn
  }

  /** The row's tooltip — four keys chosen at runtime by the template's nested
   *  ternary, all four carried in this surface's catalog. */
  #rowTitle(row: LayerRow): string {
    const cell = row.originCell ?? ''
    if (row.inherited) {
      return row.originCell
        ? t('features.origin.cascade', '↳ from {cell}', { cell })
        : t('features.origin.cascade.root', '↳ from the hive')
    }
    return row.on
      ? t('features.remove.hint',
        'Turn off for this layer — its record here is removed (undo brings it back).', { cell })
      : t('features.enable.hint',
        "Turn on for this layer — the beehavior waits on what's beneath and gives it meaning when they meet.",
        { cell })
  }

  #renderLayerFoot(): HTMLElement {
    const count = this.#selectedCount
    return el('footer', 'features-foot', count > 0
      ? tCount('features.bulk.hint',
        '1 row selected — open, allow, or download it from the bar above.',
        '{count} rows selected — open, allow, or download them from the bar above.', count)
      : t('features.foot.hint',
        "Click a beehavior to turn it on or off for this layer — on, it waits for what's beneath to give it meaning. A website turns on into the Websites menu. Ctrl-click selects rows."))
  }
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
  customElements.define(SURFACE_NAME, FeaturesViewerElement)
}

window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/FeaturesViewerElement',
    element: SURFACE_NAME,
    order: 120,
  })
})
