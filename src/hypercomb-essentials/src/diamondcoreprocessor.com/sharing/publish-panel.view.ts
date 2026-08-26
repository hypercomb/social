// publish-panel.view.ts — THE PUBLISH DIFFERENTIAL, as a framework-free
// custom element (everything-is-a-beehavior Phase 2: Angular panels leave the
// shell and ship as signed modules).
//
// A straight port of shared/ui/publish-panel: same surface name
// (hc-publish-panel), same order band (145), same panel id ('publish-panel' —
// so the participant's saved width, text size and group membership come
// across), same one effect in and six effects out. It lands beside
// `publish.queen.ts` (the `/publish` door) and `publish-status.drone.ts` (the
// other half of this surface: the drone owns the read-model, the online proof
// and every verdict; this owns the reading of it).
//
// ── WHAT IT IS FOR ─────────────────────────────────────────────────────────
//
// The read-only face of the publish differential: what the world is serving,
// next to what has changed here since. Everything arrives on the
// `publish:render` payload and leaves as intents — publish:refresh,
// publish:expand, publish:run, publish:unpublish, publish:copy-link,
// publish:close.
//
// THE DISCIPLINE THIS SURFACE INHERITS — and the reason its copy is so
// carefully hedged: the drone never claims more than it can prove, and the
// panel must not undo that in the rendering.
//
//   • `unknown` (offline, CORS, 5xx, breaker) and `cannot-compare` (a cold
//     child, so the local head cannot be sealed) are QUIET — dim light, grey
//     text, an "as of" age. Never a red light, never the word error. Nothing
//     was asserted, so nothing is claimed.
//   • `gone` is the only 404-backed absence, and `forged` — a host serving an
//     index that is not ours — is the ONE loud banner in the panel.
//   • `comparing` rows paint straight away and fill in progressively. They sit
//     in a LEADING, unlabelled block rather than in one of the four sections:
//     a row whose verdict has not landed cannot honestly be filed under "Live"
//     or "Changed here", and putting it in either would invent a difference
//     (or a confirmation) out of a computation still running.
//
// One action per row, never a bulk selection bar: bulk selection is
// pointer-only and dies on a phone, where this panel becomes a bottom sheet.
// Unpublish lives in the row's expansion, under its honest limit stated in
// full — it stops the branch being advertised, it does not un-share it. That
// warning line and the counts are a CONSENT SURFACE: the wording, the paths,
// the gap count and the section counts are reproduced here verbatim, never
// rounded, summarised or re-ordered.
//
// ── WHY THIS PANEL KEEPS ITS NODES ─────────────────────────────────────────
//
// `publish:render` is a PROGRESS STREAM, not an occasional state drop. The
// drone emits it once per row while the sweep seals each branch, and again on
// every `onProgress` phase of a running publish (staging → uploading →
// indexing → confirming). Rebuilding the list on each of those would:
//
//   • blow focus out of the `.prow-head` the participant just pressed (and out
//     of the expansion's Copy link / Open branch / Unpublish buttons),
//   • restart `.prow-light`'s colour transition on every tick, so the one
//     animation in the panel — a verdict landing — would never actually play,
//   • reset the scroller under a reader mid-list.
//
// So this view takes the ONE sanctioned exception to rebuild-on-change: a
// per-panel `Map<row.key, nodes>` (plus kept section containers), placed in
// data order with `insertBefore`, which MOVES a live node rather than
// re-creating it. Everything else is a straight mutation of an existing node —
// which is not a reconciler: there is no diffing, no vdom, and the state lives
// in `#rows`, never in the DOM.
//
// The one place a node is genuinely rebuilt is a row CROSSING between the
// leading `comparing` block and a section: the two `<li>` shapes differ (a
// comparing row has no role="button", no tabindex, no action and no
// expansion), and Angular's two separate `@for` blocks destroyed and recreated
// it across that boundary too.
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
// last `publish:render` to a late subscriber, and the drone is the sole owner
// of `open`: every exit this panel offers emits `publish:close`, which makes
// the drone publish `{open:false}` as the new last value. So a replay can only
// re-open a panel the drone still considers open — the correct answer for a
// module that loads after `/publish` was already used. The original placed the
// same unguarded trust in the payload (`this.visible.set(!!p.open)`).
//
// Because the host IS the panel (DockedPanelElement sizes, positions, grips
// and measures `this`), the Angular `:host { inset: 0; pointer-events: none }`
// full-bleed wrapper is gone and the `.publish-panel` rules land on the tag —
// the sequence-viewer / context-window / observe-viewer precedent. The inset
// reporting the old `hcDockInset` directive did is folded into the same base.
//
// Its strings ship WITH it (publish-panel.i18n.ts, extracted from all 14 shell
// catalogs) and register under the 'app' namespace, so every key resolves
// exactly as before — the Phase 2 catalog split, another slice. NOTE for that
// split: `publish.title` and the whole `publish.done*` / `publish.link-*` /
// `publish.failure.*` family are ALSO resolved by publish-status.drone.ts for
// its toasts. This panel renders only `publish.title` of those; the drone's
// own keys must stay reachable.

import { EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { DockedPanelElement } from '../panels/docked-panel.element.js'
import { PUBLISH_PANEL_TRANSLATIONS } from './publish-panel.i18n.js'

const SURFACE_NAME = 'hc-publish-panel'

// ── mirrors of the read-model shapes (publish-status.drone.ts) ────────────
//
// Declared structurally rather than imported so this view stays a pure reader
// of the payload, exactly as the shared component could not reach into
// essentials. Kept field-for-field identical to PublishRenderPayload.

type PublishRowState =
  | 'live' | 'drift' | 'unpublished' | 'pending' | 'stale-edge'
  | 'gone' | 'unknown' | 'cannot-compare' | 'comparing'

type PublishIndexState =
  | 'ok' | 'none' | 'unreachable' | 'http' | 'malformed' | 'forged' | 'checking'

interface PublishRow {
  key: string
  path: string
  segments: string[]
  state: PublishRowState
  live: string | null
  here: string | null
  publishedAt: number | null
  seenAt: number | null
  gaps: string[]
  expanded: boolean
  link: string | null
  busyPhase: string | null
}

interface PublishCollision {
  key: string
  paths: string[]
}

interface PublishRenderPayload {
  open: boolean
  gateActive: boolean
  host: string
  pubkey: string
  index: PublishIndexState
  indexCreatedAt: number
  indexStale: boolean
  keyMismatch: boolean
  refreshing: boolean
  rows: PublishRow[]
  collisions: PublishCollision[]
}

type SectionKey = 'live' | 'changed' | 'unpublished' | 'attention'

/** One rendered section. Empty ones never reach the DOM. */
interface PublishSection {
  key: SectionKey
  titleKey: string
  fallback: string
  rows: PublishRow[]
}

/** Which section a settled verdict files under. `comparing` is deliberately
 *  absent — it has no section (see the header note). */
const SECTION_OF: Record<Exclude<PublishRowState, 'comparing'>, SectionKey> = {
  'live': 'live',
  'drift': 'changed',
  'pending': 'changed',
  'unpublished': 'unpublished',
  'gone': 'attention',
  'stale-edge': 'attention',
  'cannot-compare': 'attention',
  'unknown': 'attention',
}

const SECTION_TITLES: { key: SectionKey; titleKey: string; fallback: string }[] = [
  { key: 'live', titleKey: 'publish.section.live', fallback: 'Live' },
  { key: 'changed', titleKey: 'publish.section.changed', fallback: 'Changed here' },
  { key: 'unpublished', titleKey: 'publish.section.unpublished', fallback: 'Not published' },
  { key: 'attention', titleKey: 'publish.section.attention', fallback: 'Needs attention' },
]

/** Head sigs are shown at this length — enough to compare two by eye, short
 *  enough to sit on a phone row. */
const SIG_SHOWN = 12

/** Gaps are "at least this many holes"; five is enough to refuse a green
 *  light without turning the row into a list. */
const GAPS_SHOWN = 5

// ── the RUNTIME-BUILT keys, every expansion spelled out ───────────────────
//
// Four of this panel's key stems are chosen at runtime and are invisible to
// any regex harvest of the original template. Each one is enumerated here in
// full — the record IS the enumeration, and its values are the English
// fallbacks a bare host with no catalog reads.

/** `('publish.state.' + row.state) | t` — NINE expansions. */
const STATE_FALLBACK: Record<PublishRowState, string> = {
  'live': 'live',
  'drift': 'changed here',
  'unpublished': 'not published',
  'pending': 'publishing',
  'stale-edge': 'host is behind',
  'gone': 'missing on host',
  'unknown': 'can\'t tell',
  'cannot-compare': 'can\'t compare',
  'comparing': 'comparing…',
}

/** `actionKey(row) | t` — FOUR expansions, chosen off state / segments / link. */
const ACTION_FALLBACK: Record<string, string> = {
  'publish.action.publish': 'Publish',
  'publish.action.republish': 'Publish changes',
  'publish.action.recheck': 'Re-check',
  'publish.action.copy-link': 'Copy link',
}

/** `whyKey(row) | t` — EIGHT expansions (plus `''`, which draws no line). */
const WHY_FALLBACK: Record<string, string> = {
  'publish.why.confirming': 'published — confirming',
  'publish.why.other-device': 'published from another device',
  'publish.why.drift': 'the world still has the earlier version',
  'publish.why.edge-lag': 'waiting for the host to catch up',
  'publish.why.cold-child': 'a tile here has never been opened, so it can\'t be sealed',
  'publish.why.as-of': 'as of {age} ago',
  'publish.why.offline': 'no answer from the host',
  'publish.why.gaps': '{count} object(s) here are not served — visitors would get a 404',
}

/** `indexKey() | t` — SIX expansions off the index read. */
const INDEX_FALLBACK: Record<string, string> = {
  'publish.header.index-age': 'index signed {age} ago',
  'publish.header.index-none': 'nothing published yet',
  'publish.header.index-checking': 'checking…',
  'publish.header.index-malformed': 'index unreadable',
  'publish.header.index-forged': 'this host is serving an index that is not yours',
  'publish.header.index-unreachable': 'host did not answer',
}

/** The IoC slice used to walk to a row's branch. */
type NavigationLike = { go?: (segments: readonly string[]) => void }

const get = <T,>(key: string): T | undefined => window.ioc?.get?.<T>(key)

// Same contract as the shell pipe: params drive both pluralization
// (`key.one` / `key.other`, chosen on params.count by the i18n service) and
// `{token}` interpolation. The fallback is the English catalog text, and it
// interpolates the same tokens so a bare host with no i18n reads identically.
// (None of this panel's keys carry plural variants in any of the 14 catalogs —
// `publish.why.gaps` is a bare "{count} object(s)" string — so there is no
// `tCount` here. `params.count` still travels, exactly as `whyParams` sent it,
// and the service falls through to the bare key when no `.one`/`.other` exist.)
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
  for (const [locale, catalog] of Object.entries(PUBLISH_PANEL_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

// ── the styles the Angular SCSS carried, expanded to plain CSS ────────────
//
// No shadow DOM (the tutorial-overlay / sequence-viewer / context-window /
// observe-viewer precedent), so Angular's `:host` becomes the tag name and
// every other selector is prefixed with it. The five SCSS colours are inlined
// at every call site — $accent #7eb6d6 → rgba(126,182,214,…), $mint #6fbf94 →
// rgba(111,191,148,…), $amber #d99a4e → rgba(217,154,78,…), $alarm #e06b6b →
// rgba(224,107,107,…), $quiet #8ea2b0 — and the shape ladder stays on the
// `:root` custom properties (_shape.scss publishes them app-wide, so
// `tw.$radius-control` reads as var(--hc-radius-control) and `$radius-pill` as
// its literal 999px). Angular's build autoprefixed; `-webkit-backdrop-filter`
// is written by hand.
//
// COLD STEEL chrome like every other tool window; colour is spent ONLY where a
// claim was actually proved — mint for `live`, amber for a real difference or
// a real wait, red for the one 404-backed absence and the forged banner, grey
// for everything that asserted nothing.
//
// FOUR EXPANSIONS WORTH NAMING:
//
//  • `@include tw.panel($accent, right)` was the LAST line of `.publish-panel`,
//    so its declarations won the cascade over the ones written above it. The
//    effective values are written here once — background rgba(13,15,21,.975)
//    (not rgba(12,16,20,.96)), border-left alpha .38 (not .45), the 14px/44px
//    shadow with the inset white hairline (not 10px/40px with the accent
//    hairline) and colour #eef2f5 (not #eef3f6) — rather than emitting both and
//    leaving five dead declarations in a document-level sheet. `width`,
//    `min-width`, `max-width`, `font-size` and `flex-direction` are untouched
//    by the mixin and carry through.
//
//  • `.publish-chip` sits LATER in the sheet than the `tw.header` action rules,
//    but `…publish-header>button` (one class + one type) outranks
//    `…publish-chip` (one class), so BOX GEOMETRY comes from the header band:
//    the chip is a 1.75rem-tall inline-grid cell with
//    `border-radius: var(--hc-radius-control)` and `padding: 0 .25rem` — its
//    own 999px pill radius, its .2em/.6em padding and its two-property
//    transition never applied. Its `:hover:not(:disabled)` DOES win (three
//    class-level components against the band's two plus a type), so the accent
//    wash and `color:#fff` both land — unlike the observe panel's plain
//    `:hover`, which loses its background to the band.
//
//  • `.publish-close`'s rules are likewise outranked by
//    `…publish-header>button[class*='close']`, so width / padding / font-size /
//    colour come from the band and only flex / background / border / cursor
//    from `.publish-close`; its `:hover{color:#7eb6d6}` loses to the band's
//    `:hover{color:#fff}`. That ordering is reproduced verbatim below so every
//    header control lands where it always did.
//
//  • `@include touch` is `@media (pointer: coarse)`; the phone sheet's query is
//    written out in the original as `(max-width:599px),(max-height:449px)` —
//    the SHORT axis is deliberate, because a landscape phone is wide and short
//    and still has no room to dock a panel beside the hive. Both re-target the
//    tag rather than `.publish-panel`, and both keep their source position so
//    the later one still wins at equal specificity.
//
// `.publish-body` and `.publish-collisions` are `display:contents` carriers the
// element adds (the context-window precedent): they hold what a rebuild
// replaces without becoming flex items of their own, so the panel's column
// layout — and `.publish-scroll`'s `flex:1` — is exactly the original's.
const CSS = `
${SURFACE_NAME}{position:fixed;top:max(calc(2.3rem * var(--hc-header-zoom,1)),var(--hc-header-anchor));right:var(--hc-controls-right,0);bottom:0;z-index:100002;display:none;flex-direction:column;width:380px;min-width:300px;max-width:calc(100vw - 1.5rem);
  --hc-window-accent:#7eb6d6;--hc-window-radius-control:var(--hc-radius-control);--hc-window-radius-card:var(--hc-radius-card);--hc-window-radius-floating:var(--hc-radius-floating);
  background:rgba(13,15,21,.975);backdrop-filter:blur(14px) saturate(1.04);-webkit-backdrop-filter:blur(14px) saturate(1.04);border-radius:0;
  border-right:0;border-left:1px solid rgba(126,182,214,.38);box-shadow:-14px 0 44px rgba(0,0,0,.46),inset 1px 0 rgba(255,255,255,.025);
  font-family:var(--hc-mono,system-ui);font-size:calc(1rem * var(--hc-panel-scale,1));color:#eef2f5;outline:none}
${SURFACE_NAME}.open{display:flex}
${SURFACE_NAME} .publish-body{display:contents}
${SURFACE_NAME} .publish-collisions{display:contents}
${SURFACE_NAME} .publish-header{flex:0 0 auto;box-sizing:border-box;display:flex;align-items:center;gap:.5rem;height:2.875rem;min-height:2.875rem;padding:0 .75rem;line-height:1;background:linear-gradient(180deg,rgba(255,255,255,.018),rgba(255,255,255,.006));border-bottom:1px solid rgba(126,182,214,.22)}
${SURFACE_NAME} .publish-header>button{box-sizing:border-box;display:inline-grid;place-items:center;min-width:1.75rem;height:1.75rem;padding:0 .25rem;border-radius:var(--hc-radius-control);line-height:1;transition:color 120ms ease,background-color 120ms ease,border-color 120ms ease}
${SURFACE_NAME} .publish-header>button:hover{background-color:rgba(255,255,255,.055)}
${SURFACE_NAME} .publish-header>button:focus-visible{outline:1px solid color-mix(in srgb,var(--hc-window-accent) 72%,white);outline-offset:1px}
${SURFACE_NAME} .publish-header>button[class*='close']{width:1.75rem;min-width:1.75rem;padding:0;font-size:1.125rem;color:rgba(238,244,248,.62)}
${SURFACE_NAME} .publish-header>button[class*='close']:hover{color:#fff;background-color:rgba(255,255,255,.075)}
${SURFACE_NAME} .publish-title{flex:1;font-size:.9em;letter-spacing:.05em;color:rgba(126,182,214,.95)}
${SURFACE_NAME} .publish-chip{flex:0 0 auto;background:rgba(126,182,214,.1);border:1px solid rgba(126,182,214,.25);border-radius:999px;color:rgba(238,243,246,.85);font-family:inherit;font-size:.66em;letter-spacing:.03em;padding:.2em .6em;cursor:pointer;transition:background 120ms ease,color 120ms ease}
${SURFACE_NAME} .publish-chip:hover:not(:disabled){background:rgba(126,182,214,.2);color:#fff}
${SURFACE_NAME} .publish-chip:disabled{opacity:.45;cursor:default}
${SURFACE_NAME} .publish-close{flex:0 0 auto;background:transparent;border:none;color:rgba(255,255,255,.7);font-size:1.4em;line-height:1;cursor:pointer;padding:0 .2em}
${SURFACE_NAME} .publish-close:hover{color:#7eb6d6}
${SURFACE_NAME} .publish-status{flex:0 0 auto;display:flex;align-items:center;gap:.5em;flex-wrap:wrap;padding:.5em 1em;border-bottom:1px solid rgba(255,255,255,.05)}
${SURFACE_NAME} .publish-index{font-size:.72em;color:rgba(217,154,78,.9)}
${SURFACE_NAME} .publish-index.quiet{color:#8ea2b0}
${SURFACE_NAME} .publish-gate{flex:0 0 auto;font-size:.66em;letter-spacing:.03em;color:rgba(217,154,78,.95);background:rgba(217,154,78,.12);border:1px solid rgba(217,154,78,.35);border-radius:999px;padding:.1em .55em}
${SURFACE_NAME} .publish-alarm{flex:0 0 auto;margin:0;padding:.7em 1em;font-size:.76em;line-height:1.45;color:#ffdede;background:rgba(224,107,107,.16);border-top:1px solid rgba(224,107,107,.5);border-bottom:1px solid rgba(224,107,107,.5)}
${SURFACE_NAME} .publish-warn{flex:0 0 auto;margin:0;padding:.6em 1em;font-size:.74em;line-height:1.45;color:#e6d5bd;background:rgba(217,154,78,.07);border-bottom:1px solid rgba(217,154,78,.28)}
${SURFACE_NAME} .publish-empty{margin:0;padding:1.5em 1em;font-size:.85em;line-height:1.5;color:rgba(255,255,255,.45)}
${SURFACE_NAME} .publish-scroll{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:.25em 0 .5em}
${SURFACE_NAME} .publish-section{border-bottom:1px solid rgba(255,255,255,.05)}
${SURFACE_NAME} .psection-header{display:flex;align-items:center;gap:.5em;padding:.55em 1em .3em}
${SURFACE_NAME} .psection-label{flex:1;font-size:.7em;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:rgba(126,182,214,.8);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${SURFACE_NAME} .psection-count{flex:0 0 auto;min-width:1.1em;padding:.02em .4em;border-radius:999px;text-align:center;font-size:.6em;font-family:var(--hc-mono,monospace);color:rgba(126,182,214,.85);background:rgba(126,182,214,.12)}
${SURFACE_NAME} .publish-list{list-style:none;margin:0;padding:0 0 .35em}
${SURFACE_NAME} .publish-list.comparing{opacity:.75}
${SURFACE_NAME} .publish-row{border-bottom:1px solid rgba(255,255,255,.035)}
${SURFACE_NAME} .publish-row:last-child{border-bottom:none}
${SURFACE_NAME} .publish-row.expanded{background:rgba(126,182,214,.05)}
${SURFACE_NAME} .prow-head{display:flex;align-items:center;gap:.55em;padding:.5em 1em;cursor:pointer;transition:background 120ms ease}
${SURFACE_NAME} .prow-head:hover{background:rgba(126,182,214,.07)}
${SURFACE_NAME} .prow-head:focus-visible{outline:1px solid rgba(126,182,214,.7);outline-offset:-1px}
${SURFACE_NAME} .prow-light{flex:0 0 auto;align-self:center;width:.62em;height:.62em;border-radius:50%;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);transition:background 140ms ease,box-shadow 140ms ease,border-color 140ms ease}
${SURFACE_NAME} .publish-row[data-state='live'] .prow-light{border-color:rgba(111,191,148,.9);background:#6fbf94;box-shadow:0 0 6px rgba(111,191,148,.6)}
${SURFACE_NAME} .publish-row[data-state='drift'] .prow-light,
${SURFACE_NAME} .publish-row[data-state='pending'] .prow-light,
${SURFACE_NAME} .publish-row[data-state='stale-edge'] .prow-light{border-color:rgba(217,154,78,.9);background:#d99a4e;box-shadow:0 0 6px rgba(217,154,78,.45)}
${SURFACE_NAME} .publish-row[data-state='gone'] .prow-light{border-color:rgba(224,107,107,.9);background:#e06b6b;box-shadow:0 0 6px rgba(224,107,107,.45)}
${SURFACE_NAME} .publish-row[data-state='unpublished'] .prow-light{border-color:rgba(126,182,214,.5);background:transparent}
${SURFACE_NAME} .prow-meta{flex:1;min-width:0;display:flex;flex-direction:column;gap:.12em}
${SURFACE_NAME} .prow-path{font-size:.86em;color:#eef3f6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${SURFACE_NAME} .prow-state{font-size:.66em;letter-spacing:.03em;color:rgba(255,255,255,.55)}
${SURFACE_NAME} .prow-why{font-size:.68em;line-height:1.35;color:#8ea2b0}
${SURFACE_NAME} .publish-row.is-quiet .prow-path{color:rgba(238,243,246,.62)}
${SURFACE_NAME} .publish-row.is-quiet .prow-state{color:rgba(255,255,255,.38)}
${SURFACE_NAME} .publish-row.is-busy .prow-state{color:rgba(217,154,78,.85)}
${SURFACE_NAME} .prow-action{flex:0 0 auto;background:none;border:1px solid rgba(126,182,214,.35);border-radius:var(--hc-radius-control);color:#c6d5e0;font:inherit;font-size:.68em;padding:.22em .56em;cursor:pointer;white-space:nowrap;transition:background .12s ease,color .12s ease,border-color .12s ease}
${SURFACE_NAME} .prow-action:hover{background:rgba(126,182,214,.16);color:#fff}
${SURFACE_NAME} .prow-action:focus-visible{outline:1px solid rgba(126,182,214,.7);outline-offset:1px}
${SURFACE_NAME} .publish-row[data-state='drift'] .prow-action,
${SURFACE_NAME} .publish-row[data-state='unpublished'] .prow-action,
${SURFACE_NAME} .publish-row[data-state='gone'] .prow-action{border-color:rgba(217,154,78,.55);color:#f0d9b6}
${SURFACE_NAME} .publish-row[data-state='drift'] .prow-action:hover,
${SURFACE_NAME} .publish-row[data-state='unpublished'] .prow-action:hover,
${SURFACE_NAME} .publish-row[data-state='gone'] .prow-action:hover{background:rgba(217,154,78,.2);color:#fff}
${SURFACE_NAME} .prow-detail{padding:.2em 1em .75em 2.1em;display:flex;flex-direction:column;gap:.3em}
${SURFACE_NAME} .pdet-line{display:flex;align-items:center;gap:.5em;font-size:.7em;color:rgba(255,255,255,.6)}
${SURFACE_NAME} .pdet-label{flex:0 0 auto;min-width:3em;letter-spacing:.04em;color:rgba(126,182,214,.75)}
${SURFACE_NAME} .pdet-sig{font-family:var(--hc-mono,monospace);font-size:.95em;color:rgba(214,228,238,.85)}
${SURFACE_NAME} .pdet-age{color:#8ea2b0}
${SURFACE_NAME} .pdet-gaps{color:rgba(217,154,78,.9)}
${SURFACE_NAME} .pdet-gaplist{list-style:none;margin:0;padding:0 0 .15em;display:flex;flex-wrap:wrap;gap:.35em}
${SURFACE_NAME} .pdet-gaplist li{background:rgba(255,255,255,.04);border-radius:var(--hc-radius-control);padding:.05em .35em;font-size:.7em}
${SURFACE_NAME} .pdet-actions{display:flex;flex-wrap:wrap;gap:.4em;padding-top:.15em}
${SURFACE_NAME} .pdet-btn{background:none;border:1px solid rgba(126,182,214,.3);border-radius:var(--hc-radius-control);color:#c6d5e0;font:inherit;font-size:.68em;padding:.22em .56em;cursor:pointer;transition:background .12s ease,color .12s ease,border-color .12s ease}
${SURFACE_NAME} .pdet-btn:hover{background:rgba(126,182,214,.16);color:#fff}
${SURFACE_NAME} .pdet-btn:focus-visible{outline:1px solid rgba(126,182,214,.7);outline-offset:1px}
${SURFACE_NAME} .pdet-link{font-family:var(--hc-mono,monospace);font-size:.66em;color:rgba(126,182,214,.7);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${SURFACE_NAME} .pdet-warn{margin:.25em 0 0;font-size:.68em;line-height:1.4;color:#a89880}
${SURFACE_NAME} .pdet-unpublish{align-self:flex-start;border-color:rgba(217,154,78,.5);color:#f0d9b6}
${SURFACE_NAME} .pdet-unpublish:hover{background:rgba(217,154,78,.2);color:#fff}
@media (pointer:coarse){${SURFACE_NAME}{top:max(calc(3.65rem * var(--hc-header-zoom,1)),calc(var(--hc-header-anchor) + 1.02rem))}}
@media (max-width:599px),(max-height:449px){
${SURFACE_NAME}{top:auto;left:0;right:0;bottom:0;width:100% !important;min-width:0;max-width:none;max-height:min(62vh,30rem);border-left:none;border-top:1px solid rgba(126,182,214,.45);border-radius:var(--hc-radius-floating) var(--hc-radius-floating) 0 0;box-shadow:0 -10px 40px rgba(0,0,0,.55),0 0 0 1px rgba(126,182,214,.06) inset;padding-bottom:env(safe-area-inset-bottom,0px)}
${SURFACE_NAME} .prow-head{min-height:3em}
${SURFACE_NAME} .prow-action,
${SURFACE_NAME} .pdet-btn,
${SURFACE_NAME} .publish-chip{min-height:2.5em}
${SURFACE_NAME} .publish-close{min-height:2.5em;min-width:2.5em}
${SURFACE_NAME} .pdet-link{display:none}
}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-publish-panel', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

/** Put `node` at `index` inside `parent`, moving it ONLY when it is not
 *  already there. `insertBefore` on an attached node MOVES it (listeners and
 *  all), but a move is a remove-then-insert: it blurs whatever it contained
 *  and restarts its transitions. Doing nothing when nothing changed is what
 *  makes this safe on a progress stream. */
const place = (parent: Element, node: Element, index: number): void => {
  const at = parent.children.item(index)
  if (at === node) return
  parent.insertBefore(node, at)
}

/** Write text only when it differs — the alarm banner is a live region, and
 *  re-writing identical text into one is how a screen reader ends up
 *  announcing "this host is serving an index that is not yours" on every
 *  progress tick. */
const setText = (el: Element, text: string): void => {
  if (el.textContent !== text) el.textContent = text
}

/** An unmodified press. Angular's KeyEventsPlugin composes the binding name
 *  from the held modifiers, so `(keydown.enter)` / `(keydown.space)` matched
 *  ONLY a bare Enter / Space — Ctrl-Enter produced `control.enter` and fell
 *  straight through. The raw listener below would fire on those chords without
 *  this guard, quietly taking a shortcut away from whoever owns it. */
const plain = (event: KeyboardEvent): boolean =>
  !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey

/** A settled row's kept nodes. The head is mutated in place on every payload;
 *  the expansion is rebuilt only when the DATA it draws changed (never on a
 *  busyPhase tick, which the expansion does not render). */
interface RowNodes {
  mode: 'comparing' | 'settled'
  li: HTMLLIElement
  head: HTMLElement
  light: HTMLElement
  meta: HTMLElement
  path: HTMLElement
  state: HTMLElement
  why: HTMLElement | null
  action: HTMLButtonElement | null
  detail: HTMLElement | null
  detailSig: string | null
  /** The expansion's "published {age} ago" line, when it has one. Held apart
   *  from the rest of the expansion because it is the one string in there that
   *  goes stale on its own — Angular's impure pipe re-ran `age()` on every
   *  change-detection tick, so this text has to be re-resolved on every
   *  payload while the STRUCTURE around it stays put. */
  ageEl: HTMLElement | null
}

interface SectionNodes {
  section: HTMLElement
  label: HTMLElement
  count: HTMLElement
  list: HTMLUListElement
}

export class PublishPanelElement extends DockedPanelElement {

  #offs: Array<() => void> = []

  /** THE visibility flag. The render payload, `close()` and the session's
   *  park/unpark all read and write THIS field — a second notion of "open" is
   *  exactly how the two drift apart after the first press. */
  #visible = false

  // Everything the panel draws lives HERE, never in the DOM. `#rows` is the
  // payload's own array: the drone mutates its row objects in place and
  // re-emits the same reference, exactly as the Angular signal held it.
  //
  // The original also stored `host` and `indexStale` and rendered NEITHER —
  // no template binding reads them. They are not carried: an unread field is
  // not fidelity, and `pubkey` was never stored at all.
  #gateActive = false
  #index: PublishIndexState = 'checking'
  #indexCreatedAt = 0
  #keyMismatch = false
  #refreshing = false
  #rows: PublishRow[] = []
  #collisions: PublishCollision[] = []

  // Chrome built once per activation. The header must survive a re-render
  // because DockedPanelElement plants the settings gear inside it (and nudges
  // the close button over to make room) AFTER renderPanel() returns —
  // rebuilding the header would throw the gear away, and would also drop focus
  // from the Re-check chip on the very round trip that press caused.
  #body: HTMLElement | null = null
  #titleEl: HTMLElement | null = null
  #chipEl: HTMLButtonElement | null = null
  #closeEl: HTMLElement | null = null
  #statusEl: HTMLElement | null = null
  #indexEl: HTMLElement | null = null
  #gateEl: HTMLElement | null = null
  #alarmEl: HTMLElement | null = null
  #warnEl: HTMLElement | null = null
  #collisionsEl: HTMLElement | null = null
  #emptyEl: HTMLElement | null = null
  #scrollEl: HTMLElement | null = null
  #comparingListEl: HTMLUListElement | null = null

  /** Keyed live rows — the ONE sanctioned exception to rebuild-on-change, and
   *  here it is load-bearing three times over: `publish:render` is a progress
   *  stream, so a rebuild would blur the head the participant just pressed,
   *  restart the state light's colour transition on every tick, and reset the
   *  scroller under a reader. Nodes are MOVED into data order, never rebuilt.
   *  Angular's `@for … track row.key` gave all three for free. */
  #nodes = new Map<string, RowNodes>()
  #sectionNodes = new Map<SectionKey, SectionNodes>()

  /** Fingerprint of the collision banners currently drawn — those are the one
   *  part of the header facts whose SHAPE (a `<p>` per collision) changes. */
  #collisionSig: string | null = null

  constructor() {
    super()
    // Same panel id the Angular `hcDockedPanel="publish-panel"` carried, so the
    // saved width (`hc:docked-width:publish-panel`), text size, code font and
    // group membership all come across with the participant. Changing it would
    // orphan all three.
    this.panelId = 'publish-panel'
    this.dockSide = 'right'
    this.minWidth = 300
    this.maxWidth = 640
    this.defaultWidth = 380
    // `launcherControlId="publish"` — the rail launcher is the optional second
    // opener, and the settings popover's "Add to controls" row hangs off it.
    this.launcherControlId = 'publish'
    // Registry-fed: mounted once at boot, engaged only when the drone says so.
    this.autoActivate = false
    // The Angular original built this with
    // `signalSession(this.visible, undefined, { close: () => this.close() })`.
    // Reproduced literally, and the asymmetry is the WHOLE POINT:
    //
    //   park/unpark pass NO announce, so putting the panel away while the
    //   installer covers the hive emits NOTHING. Emitting `publish:close`
    //   there would stop the drone's sweep — we are hiding a window, not
    //   ending an observation.
    //
    //   close DOES route to `this.close()`, which emits `publish:close` —
    //   because that one IS the participant deciding they are done looking.
    //
    // `close` is what the Escape cascade calls (the base registers it through
    // holdToolWindow/holdWindow); this panel never bound a keydown listener of
    // its own at the document level, in either implementation — so there is no
    // `keydown.escape` modifier guard to carry at that level. (The two the
    // panel DID bind, `(keydown.enter)` and `(keydown.space)` on a row head,
    // are guarded where they are wired: see `plain()`.)
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
    // `role="dialog"` was written EXPLICITLY on the original `<aside>`, so it
    // is not the implicit-complementary case the other ports carried by hand —
    // it is the author's own choice and it moves across unchanged.
    this.setAttribute('role', 'dialog')
    this.setAttribute('data-consumes-wheel', '')
    this.tabIndex = -1

    this.#offs.push(
      // THE ONE EFFECT IN. It is a STATE ASSERTION, not an increment: the
      // handler SETS gate, index, rows and visibility from the payload, so the
      // same payload arriving twice (a sweep tick landing beside a
      // `history:head-changed` re-refresh, a progress phase re-emitted) lands
      // the identical panel. Nothing here appends, counts or accumulates.
      EffectBus.on<PublishRenderPayload>('publish:render', (p) => this.#onRender(p)),

      // THE PIPE WAS IMPURE. Angular's `t` pipe is declared `pure: false`, so
      // every change-detection tick re-resolved every string and `/language ja`
      // re-labelled an OPEN panel on the spot. An element renders when it
      // decides to, so the locale switch has to be a reason to render — else an
      // open window keeps its old-locale title, its Re-check chip, the index
      // line, every section heading, every state label, every why-line and the
      // unpublish warning until it is closed and reopened. Rebuilding is safe:
      // the rows live in `#rows`, never in the DOM.
      //
      // The two SIGNATURE caches are cleared first: the collision banners and
      // each row's expansion redraw only when their data changed, and a locale
      // switch changes neither — it changes what the data READS AS.
      EffectBus.on('locale:changed', () => {
        if (!this.#visible) return
        this.#collisionSig = null
        for (const rec of this.#nodes.values()) rec.detailSig = null
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

  /** Straight transcription of the original's `publish:render` subscriber —
   *  guard, facts, rows, collisions, visibility, in that order. */
  #onRender(p: PublishRenderPayload | undefined): void {
    if (!p) return
    this.#gateActive = p.gateActive === true
    this.#index = this.#normIndex(p.index)
    this.#indexCreatedAt = Number(p.indexCreatedAt ?? 0) || 0
    this.#keyMismatch = p.keyMismatch === true
    this.#refreshing = p.refreshing === true
    this.#rows = Array.isArray(p.rows) ? p.rows : []
    this.#collisions = Array.isArray(p.collisions) ? p.collisions : []
    // No sibling is closed here — the lane decides what fits on an edge and
    // parks whatever it displaces.
    if (p.open) this.#show()
    else this.#hide()
    this.#render()
  }

  #normIndex(value: unknown): PublishIndexState {
    const known: PublishIndexState[] =
      ['ok', 'none', 'unreachable', 'http', 'malformed', 'forged', 'checking']
    return known.includes(value as PublishIndexState) ? value as PublishIndexState : 'checking'
  }

  // ── the open / close verbs ───────────────────────────────────────────

  /** DockedPanelElement's close verb — the × and the lane's eviction fallback
   *  both land here, as does the Escape cascade through `session.close`. */
  protected override closePanel(): void { this.close() }

  /** The participant is done looking. EXACTLY ONE `publish:close` leaves per
   *  exit — × , Escape, the lane's fallback — because the guard reproduces the
   *  reachability the Angular `@if` gave: `close()` was only ever callable
   *  while the panel was on screen, since its button and its session both went
   *  away with the DOM. Publishing is irreversible from where the participant
   *  stands, so the drone must never see a second close it did not earn.
   *
   *  Nothing is cleared here — the original did not clear either. The drone
   *  answers with `publish:render {open:false}` and keeps its rows, so the
   *  panel comes back showing what it was showing. */
  close(): void {
    if (!this.#visible) return
    this.#hide()
    EffectBus.emit('publish:close', {})
  }

  #show(): void {
    if (this.#visible) return
    this.#visible = true
    this.classList.add('open')
    this.setAttribute('aria-label', t('publish.title', 'Publish'))
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

  /** `deactivate()` calls `replaceChildren()`, so every kept node above is gone
   *  — the maps and the references must go with it or the next activation
   *  would place detached nodes into a fresh panel. */
  #forgetChrome(): void {
    this.#body = null
    this.#titleEl = null
    this.#chipEl = null
    this.#closeEl = null
    this.#statusEl = null
    this.#indexEl = null
    this.#gateEl = null
    this.#alarmEl = null
    this.#warnEl = null
    this.#collisionsEl = null
    this.#emptyEl = null
    this.#scrollEl = null
    this.#comparingListEl = null
    this.#nodes.clear()
    this.#sectionNodes.clear()
    this.#collisionSig = null
  }

  // ── the six intents out ──────────────────────────────────────────────
  //
  // All of them are REQUESTS: the drone owns every piece of state this panel
  // shows (including which rows are expanded), so nothing is written locally
  // and the panel only changes when the answer comes back. That is the
  // original's behaviour and it is the honest one — a row that showed itself
  // expanded before the gap walk ran would be claiming an answer it has not
  // got.

  #refresh(): void {
    EffectBus.emit('publish:refresh', {})
  }

  /** Tapping a row opens its detail — which is also what runs the gap check,
   *  so it stays opt-in and per row. */
  #toggle(row: PublishRow): void {
    EffectBus.emit('publish:expand', { key: row.key })
  }

  #run(row: PublishRow): void {
    if (row.busyPhase) return
    EffectBus.emit('publish:run', { key: row.key })
  }

  #unpublish(row: PublishRow): void {
    if (row.busyPhase) return
    EffectBus.emit('publish:unpublish', { key: row.key })
  }

  #copyLink(row: PublishRow): void {
    EffectBus.emit('publish:copy-link', { key: row.key })
  }

  /** Walk to the branch this row describes. Rows published from another
   *  device carry no segments and get no such button. */
  #visit(row: PublishRow): void {
    if (row.segments.length === 0) return
    get<NavigationLike>('@hypercomb.social/Navigation')?.go?.([...row.segments])
  }

  /** The current row for a key. The handlers close over the KEY, never over a
   *  row object: Angular's `@for` re-supplied the row on every pass, and the
   *  drone hands us the same objects mutated in place — looking up is what
   *  keeps a click acting on what the participant can see. */
  #rowFor(key: string): PublishRow | undefined {
    return this.#rows.find(r => r.key === key)
  }

  // ── the header line ──────────────────────────────────────────────────

  /** What the index line says. Note the switch DOES return the forged key —
   *  the string is drawn twice, once quietly on the status line and once in
   *  the banner. Copied from the code, not from the comment above it. */
  #indexKey(): string {
    switch (this.#index) {
      case 'ok': return this.#indexCreatedAt > 0 ? 'publish.header.index-age' : 'publish.header.index-none'
      case 'none': return 'publish.header.index-none'
      case 'checking': return 'publish.header.index-checking'
      case 'malformed': return 'publish.header.index-malformed'
      case 'forged': return 'publish.header.index-forged'
      // A transport failure and an HTTP error are the same fact to a reader:
      // the host did not answer with an index we could use.
      default: return 'publish.header.index-unreachable'
    }
  }

  /** The index line is quiet unless it is telling us something is wrong. */
  #indexQuiet(): boolean {
    return this.#index === 'ok' || this.#index === 'none' || this.#index === 'checking'
  }

  #forged(): boolean { return this.#index === 'forged' }

  // ── the rows ─────────────────────────────────────────────────────────

  /** The row's ONE action. Null = nothing to offer (a row still comparing).
   *
   *  Rows with no segments were published from another device: there is no
   *  branch here to seal, so they are only ever re-checked. */
  #actionKey(row: PublishRow): string | null {
    if (row.state === 'comparing' || row.busyPhase) return null
    if (row.segments.length === 0) return 'publish.action.recheck'
    switch (row.state) {
      case 'unpublished': return 'publish.action.publish'
      // The head 404s: putting it back is a publish, not an update.
      case 'gone': return 'publish.action.publish'
      case 'drift': return 'publish.action.republish'
      // The bytes are hosted and the index is authentic — what is missing is
      // the host catching up, so the honest offer is to look again.
      case 'stale-edge': return 'publish.action.recheck'
      case 'pending': return 'publish.action.recheck'
      case 'live': return row.link ? 'publish.action.copy-link' : 'publish.action.recheck'
      // unknown / cannot-compare: nothing was asserted, so nothing is fixed
      // from here. Looking again is the only truthful verb.
      default: return 'publish.action.recheck'
    }
  }

  /** Run whatever `#actionKey` offered. */
  #act(row: PublishRow): void {
    const key = this.#actionKey(row)
    if (!key) return
    if (key === 'publish.action.recheck') { this.#refresh(); return }
    if (key === 'publish.action.copy-link') { this.#copyLink(row); return }
    this.#run(row)
  }

  /** The quiet why-line under a row, or '' for none. Never restates the state
   *  label — it says the one thing the label cannot. */
  #whyKey(row: PublishRow): string {
    if (row.busyPhase === 'confirming') return 'publish.why.confirming'
    if (row.busyPhase) return ''
    if (row.segments.length === 0) return 'publish.why.other-device'
    switch (row.state) {
      case 'drift': return 'publish.why.drift'
      case 'pending': return 'publish.why.confirming'
      case 'stale-edge': return 'publish.why.edge-lag'
      case 'cannot-compare': return 'publish.why.cold-child'
      // The whole point of `unknown`: say WHEN we last saw it, or say that the
      // host did not answer. Never say it is broken.
      case 'unknown': return row.seenAt ? 'publish.why.as-of' : 'publish.why.offline'
      case 'gone': return row.gaps.length > 0 ? 'publish.why.gaps' : ''
      default: return row.gaps.length > 0 ? 'publish.why.gaps' : ''
    }
  }

  /** BOTH params travel on every why-line, exactly as `whyParams` sent them —
   *  the key that needs `{age}` gets it, the key that needs `{count}` gets it,
   *  and the ones that need neither ignore both. */
  #whyParams(row: PublishRow): Record<string, string | number> {
    return {
      age: row.seenAt ? this.#age(row.seenAt) : '',
      count: row.gaps.length,
    }
  }

  /** Quiet states read as furniture, not as failure. */
  #isQuiet(row: PublishRow): boolean {
    return row.state === 'unknown' || row.state === 'cannot-compare' || row.state === 'comparing'
  }

  #gapsShown(row: PublishRow): string[] {
    return row.gaps.slice(0, GAPS_SHOWN)
  }

  #short(sig: string | null): string {
    return sig ? sig.slice(0, SIG_SHOWN) : ''
  }

  /** Compact age since an epoch-ms instant. Unit letters rather than words:
   *  there is no key for a duration, and inventing one per unit would be four
   *  strings the catalog never agreed to. */
  #age(at: number | null): string {
    if (!at || at <= 0) return ''
    const seconds = Math.max(0, Math.round((Date.now() - at) / 1000))
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.round(seconds / 60)
    if (minutes < 60) return `${minutes}m`
    const hours = Math.round(minutes / 60)
    if (hours < 48) return `${hours}h`
    return `${Math.round(hours / 24)}d`
  }

  // ── chrome (built once per activation) ───────────────────────────────
  protected override renderPanel(): void {
    const header = document.createElement('header')
    header.className = 'publish-header'

    const title = document.createElement('span')
    title.className = 'publish-title'

    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'publish-chip'
    chip.addEventListener('click', () => this.#refresh())

    // LAST child on purpose: DockedPanelElement measures `header.lastElementChild`
    // to reserve the gear's slot, so the close button has to stay the far-edge
    // landmark it is in every tool window.
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'publish-close'
    close.textContent = '×'
    close.addEventListener('click', () => this.close())

    header.append(title, chip, close)

    // `display: contents` — the status line, the banners and the scroller stay
    // flex items of the PANEL (the scroller's `flex: 1` is what makes it the
    // scrolling half), while one node still holds everything below the header.
    // Without it, anything that reached for the panel's own children would take
    // the base's resize grip and settings gear with it.
    const body = document.createElement('div')
    body.className = 'publish-body'

    // What the index read says, and whether public hosting is even on. With the
    // gate off, marking a branch public is inert — so the chip is stated once
    // here rather than as a per-row failure.
    const status = document.createElement('div')
    status.className = 'publish-status'
    const index = document.createElement('span')
    index.className = 'publish-index'
    status.appendChild(index)

    const gate = document.createElement('span')
    gate.className = 'publish-gate'

    // THE ONE LOUD BANNER: a host serving an index that does not verify against
    // our key is not an outage, it is somebody else's index.
    const alarm = document.createElement('p')
    alarm.className = 'publish-alarm'
    alarm.setAttribute('role', 'alert')

    const warn = document.createElement('p')
    warn.className = 'publish-warn'

    const collisions = document.createElement('div')
    collisions.className = 'publish-collisions'

    const empty = document.createElement('p')
    empty.className = 'publish-empty'

    const scroll = document.createElement('div')
    scroll.className = 'publish-scroll'

    body.appendChild(status)
    body.appendChild(collisions)

    this.append(header, body)

    this.#titleEl = title
    this.#chipEl = chip
    this.#closeEl = close
    this.#body = body
    this.#statusEl = status
    this.#indexEl = index
    this.#gateEl = gate
    this.#alarmEl = alarm
    this.#warnEl = warn
    this.#collisionsEl = collisions
    this.#emptyEl = empty
    this.#scrollEl = scroll

    this.#relabel()
    this.#render()
  }

  /** Re-resolve the strings written ONCE per activation — the ones no payload
   *  changes. Everything else re-resolves on every render. */
  #relabel(): void {
    const heading = t('publish.title', 'Publish')
    this.setAttribute('aria-label', heading)
    if (this.#titleEl) setText(this.#titleEl, heading)
    // The close button's aria-label really is the panel title in the original
    // (`[attr.aria-label]="'publish.title' | t"`), not a "close" string.
    this.#closeEl?.setAttribute('aria-label', heading)
    const chip = this.#chipEl
    if (chip) {
      const recheck = t('publish.action.recheck', 'Re-check')
      setText(chip, recheck)
      chip.setAttribute('title', recheck)
      chip.setAttribute('aria-label', recheck)
    }
  }

  // ── rendering ────────────────────────────────────────────────────────
  //
  // Rebuild-on-change everywhere it is free (the header facts hold nothing
  // focusable and no animation), keyed nodes where a rebuild would cost the
  // participant something (see the note at the top of the file).

  #render(): void {
    if (!this.#body) return
    if (this.#chipEl) this.#chipEl.disabled = this.#refreshing
    this.#renderStatus()
    this.#renderCollisions()
    this.#renderRows()
    this.#placeBody()
  }

  #renderStatus(): void {
    const index = this.#indexEl
    const status = this.#statusEl
    const gate = this.#gateEl
    if (!index || !status || !gate) return

    const key = this.#indexKey()
    setText(index, t(key, INDEX_FALLBACK[key] ?? key, { age: this.#age(this.#indexCreatedAt * 1000) }))
    index.classList.toggle('quiet', this.#indexQuiet())

    // `@if (!gateActive())` — the chip is present only while public hosting is
    // OFF, and `@if` DETACHES: a `display:none` chip would still answer
    // querySelector, which an acceptance driver may assert on.
    if (this.#gateActive) {
      gate.remove()
    } else {
      setText(gate, t('publish.header.gate-off', 'public hosting off'))
      if (gate.parentNode !== status) status.appendChild(gate)
    }

    if (this.#alarmEl) {
      setText(this.#alarmEl, t('publish.header.index-forged',
        'this host is serving an index that is not yours'))
    }
    if (this.#warnEl) {
      setText(this.#warnEl, t('publish.header.key-mismatch',
        'These branches were published with a different key. Publishing now creates a second hive.'))
    }
  }

  /** One `<p>` per colliding index key. The paths are joined with ', ' and
   *  handed to the string whole — a consent surface: never truncated, never
   *  re-ordered, never counted instead of named. */
  #renderCollisions(): void {
    const host = this.#collisionsEl
    if (!host) return
    // Separators spelled as escapes, never embedded: a literal control
    // byte in a source file makes git call it binary and is invisible in
    // every editor. They are chosen because no path or key can contain
    // them, which is what makes the signature unambiguous.
    const sig = this.#collisions.map(c => `${c.key}\u0000${c.paths.join(',')}`).join('\u0001')
    if (this.#collisionSig === sig) return
    this.#collisionSig = sig
    host.replaceChildren()
    for (const collision of this.#collisions) {
      const p = document.createElement('p')
      p.className = 'publish-warn'
      p.textContent = t('publish.header.collision',
        '{paths} share one index entry — only one of them can be served.',
        { paths: collision.paths.join(', ') })
      host.appendChild(p)
    }
  }

  /** The body's child ORDER, and the `@if` presences within it. */
  #placeBody(): void {
    const body = this.#body
    const status = this.#statusEl
    const collisions = this.#collisionsEl
    const alarm = this.#alarmEl
    const warn = this.#warnEl
    const empty = this.#emptyEl
    const scroll = this.#scrollEl
    if (!body || !status || !collisions || !alarm || !warn || !empty || !scroll) return

    // POLARITY IS LOAD-BEARING: the template asked `@if (!hasRows())`, where
    // `hasRows` is `rows().length > 0`. Written the same way round — the
    // re-derived positive test would fall through to the list branch for
    // anything the length comparison cannot answer.
    const hasRows = this.#rows.length > 0

    const order: Element[] = [status]
    if (this.#forged()) order.push(alarm)
    if (this.#keyMismatch) order.push(warn)
    order.push(collisions)
    order.push(hasRows ? scroll : empty)

    for (const node of [alarm, warn, scroll, empty]) {
      if (!order.includes(node)) node.remove()
    }
    order.forEach((node, i) => place(body, node, i))
  }

  #renderRows(): void {
    const scroll = this.#scrollEl
    const empty = this.#emptyEl
    if (!scroll || !empty) return

    setText(empty, t('publish.empty',
      'Nothing published yet. Open a branch and run /host to put it online.'))

    // Rows that left take their nodes with them — REMOVED from the DOM, not
    // hidden, the way `@for … track` removed them.
    const live = new Set(this.#rows.map(r => r.key))
    for (const [key, rec] of this.#nodes) {
      if (live.has(key)) continue
      rec.li.remove()
      this.#nodes.delete(key)
    }
    if (this.#rows.length === 0) {
      this.#comparingListEl?.remove()
      for (const rec of this.#sectionNodes.values()) rec.section.remove()
      return
    }

    // Rows whose verdict has not landed yet — the leading unlabelled block.
    const comparing = this.#rows.filter(r => r.state === 'comparing')

    // The four sections, in reading order, empty ones dropped.
    const byKey = new Map<SectionKey, PublishRow[]>()
    for (const row of this.#rows) {
      if (row.state === 'comparing') continue
      const key = SECTION_OF[row.state] ?? 'attention'
      const list = byKey.get(key) ?? []
      list.push(row)
      byKey.set(key, list)
    }
    const sections: PublishSection[] = SECTION_TITLES
      .map(s => ({ key: s.key, titleKey: s.titleKey, fallback: s.fallback, rows: byKey.get(s.key) ?? [] }))
      .filter(s => s.rows.length > 0)

    const containers: Element[] = []

    if (comparing.length > 0) {
      const list = this.#comparingList()
      containers.push(list)
    } else {
      this.#comparingListEl?.remove()
    }

    const shown = new Set<SectionKey>()
    for (const section of sections) {
      const rec = this.#sectionNode(section.key)
      shown.add(section.key)
      // No `title` on the label: the original bound none, and adding a tooltip
      // an elided heading never had is a change to what the panel says.
      setText(rec.label, t(section.titleKey, section.fallback))
      // The section COUNT is `section.rows.length` — the rows actually filed
      // here, not a number from the payload. Consent surface: never rounded.
      setText(rec.count, String(section.rows.length))
      containers.push(rec.section)
    }
    for (const [key, rec] of this.#sectionNodes) {
      if (!shown.has(key)) rec.section.remove()
    }

    containers.forEach((node, i) => place(scroll, node, i))

    if (comparing.length > 0) this.#placeRows(this.#comparingList(), comparing, 'comparing')
    for (const section of sections) {
      this.#placeRows(this.#sectionNode(section.key).list, section.rows, 'settled')
    }
  }

  #comparingList(): HTMLUListElement {
    let list = this.#comparingListEl
    if (!list) {
      list = document.createElement('ul')
      list.className = 'publish-list comparing'
      this.#comparingListEl = list
    }
    return list
  }

  #sectionNode(key: SectionKey): SectionNodes {
    let rec = this.#sectionNodes.get(key)
    if (rec) return rec

    const section = document.createElement('section')
    section.className = 'publish-section'

    const head = document.createElement('header')
    head.className = 'psection-header'
    const label = document.createElement('span')
    label.className = 'psection-label'
    const count = document.createElement('span')
    count.className = 'psection-count'
    head.append(label, count)

    const list = document.createElement('ul')
    list.className = 'publish-list'

    section.append(head, list)
    rec = { section, label, count, list }
    this.#sectionNodes.set(key, rec)
    return rec
  }

  /** Put these rows into this list, in this order, reusing every node that is
   *  already the right SHAPE. A row crossing between the comparing block and a
   *  section changes shape — the comparing `<li>` has no role, no tabindex, no
   *  action and no expansion — so it is rebuilt there, exactly as Angular's two
   *  separate `@for` blocks rebuilt it. */
  #placeRows(list: HTMLUListElement, rows: PublishRow[], mode: 'comparing' | 'settled'): void {
    rows.forEach((row, i) => {
      let rec = this.#nodes.get(row.key)
      if (rec && rec.mode !== mode) {
        rec.li.remove()
        this.#nodes.delete(row.key)
        rec = undefined
      }
      if (!rec) {
        rec = mode === 'comparing' ? this.#createComparingRow() : this.#createRow(row.key)
        this.#nodes.set(row.key, rec)
      }
      if (mode === 'comparing') this.#syncComparingRow(rec, row)
      else this.#syncRow(rec, row)
      place(list, rec.li, i)
    })
  }

  // ── the comparing row ────────────────────────────────────────────────
  //
  // Deliberately inert: no role="button", no tabindex, no click, no action and
  // no expansion. A row whose verdict has not landed has nothing to offer and
  // nothing to expand, and pretending otherwise would invite a press that
  // cannot be honoured.

  #createComparingRow(): RowNodes {
    const li = document.createElement('li')
    li.className = 'publish-row is-quiet'

    const head = document.createElement('div')
    head.className = 'prow-head'

    const light = document.createElement('span')
    light.className = 'prow-light'
    light.setAttribute('aria-hidden', 'true')

    const meta = document.createElement('div')
    meta.className = 'prow-meta'
    const path = document.createElement('span')
    path.className = 'prow-path'
    const state = document.createElement('span')
    state.className = 'prow-state'
    meta.append(path, state)

    head.append(light, meta)
    li.appendChild(head)

    return {
      mode: 'comparing', li, head, light, meta, path, state,
      why: null, action: null, detail: null, detailSig: null, ageEl: null,
    }
  }

  #syncComparingRow(rec: RowNodes, row: PublishRow): void {
    rec.li.setAttribute('data-state', row.state)
    rec.path.title = row.path
    setText(rec.path, row.path)
    setText(rec.state, t('publish.state.comparing', STATE_FALLBACK.comparing))
  }

  // ── the settled row ──────────────────────────────────────────────────

  #createRow(key: string): RowNodes {
    const li = document.createElement('li')
    li.className = 'publish-row'

    const head = document.createElement('div')
    head.className = 'prow-head'
    head.setAttribute('role', 'button')
    head.tabIndex = 0
    head.addEventListener('click', () => {
      const row = this.#rowFor(key)
      if (row) this.#toggle(row)
    })
    head.addEventListener('keydown', (event: KeyboardEvent) => {
      // `(keydown.enter)` and `(keydown.space)` — unmodified presses ONLY, see
      // `plain()`. The space binding ran `toggle(row)` and THEN
      // `$event.preventDefault()`, in that order.
      if (!plain(event)) return
      const row = this.#rowFor(key)
      if (!row) return
      if (event.key === 'Enter') { this.#toggle(row); return }
      if (event.key === ' ') { this.#toggle(row); event.preventDefault() }
    })

    const light = document.createElement('span')
    light.className = 'prow-light'
    light.setAttribute('aria-hidden', 'true')

    const meta = document.createElement('div')
    meta.className = 'prow-meta'
    const path = document.createElement('span')
    path.className = 'prow-path'
    const state = document.createElement('span')
    state.className = 'prow-state'
    meta.append(path, state)

    head.append(light, meta)
    li.appendChild(head)

    return {
      mode: 'settled', li, head, light, meta, path, state,
      why: null, action: null, detail: null, detailSig: null, ageEl: null,
    }
  }

  /** Everything the head shows, mutated in place. Nothing here re-creates a
   *  node, so a progress tick cannot blur the head, restart the light's
   *  transition or move the scroller. */
  #syncRow(rec: RowNodes, row: PublishRow): void {
    rec.li.setAttribute('data-state', row.state)
    rec.li.classList.toggle('is-quiet', this.#isQuiet(row))
    rec.li.classList.toggle('is-busy', !!row.busyPhase)
    rec.li.classList.toggle('expanded', row.expanded)
    rec.head.setAttribute('aria-expanded', String(row.expanded))

    const stateLabel = t(`publish.state.${row.state}`, STATE_FALLBACK[row.state])
    rec.light.setAttribute('title', stateLabel)
    rec.path.title = row.path
    setText(rec.path, row.path)
    setText(rec.state, stateLabel)

    // `@if (whyKey(row))` — a truthy key draws the line, '' draws nothing.
    const whyKey = this.#whyKey(row)
    if (whyKey) {
      let why = rec.why
      if (!why) {
        why = document.createElement('span')
        why.className = 'prow-why'
        rec.why = why
      }
      setText(why, t(whyKey, WHY_FALLBACK[whyKey] ?? whyKey, this.#whyParams(row)))
      if (why.parentNode !== rec.meta) rec.meta.appendChild(why)
    } else if (rec.why) {
      rec.why.remove()
    }

    // `@if (actionKey(row); as action)` — one action per row, or none.
    const actionKey = this.#actionKey(row)
    if (actionKey) {
      let action = rec.action
      if (!action) {
        action = document.createElement('button')
        action.type = 'button'
        action.className = 'prow-action'
        action.addEventListener('click', (event) => {
          const current = this.#rowFor(row.key)
          // `(click)="act(row); $event.stopPropagation()"` — act FIRST, then
          // stop the bubble, so the head's own click never also toggles.
          if (current) this.#act(current)
          event.stopPropagation()
        })
        rec.action = action
      }
      setText(action, t(actionKey, ACTION_FALLBACK[actionKey] ?? actionKey))
      if (action.parentNode !== rec.head) rec.head.appendChild(action)
    } else if (rec.action) {
      rec.action.remove()
    }

    this.#syncDetail(rec, row)
  }

  /** What the expansion draws, and NOTHING it draws is a progress field — so a
   *  busyPhase tick leaves it untouched and the buttons inside it keep focus
   *  through a whole publish. It is rebuilt only when one of the values below
   *  actually changed (or the locale did, which clears the signature). */
  #detailSig(row: PublishRow): string {
    return [
      row.live ?? '', row.here ?? '', row.publishedAt ?? '', row.link ?? '',
      row.gaps.join('~'), String(row.segments.length),
    ].join('|')
  }

  #syncDetail(rec: RowNodes, row: PublishRow): void {
    if (!row.expanded) {
      rec.detail?.remove()
      rec.detail = null
      rec.detailSig = null
      rec.ageEl = null
      return
    }
    const sig = this.#detailSig(row)
    let detail = rec.detail
    if (!detail) {
      detail = document.createElement('div')
      detail.className = 'prow-detail'
      rec.detail = detail
      rec.detailSig = null
    }
    if (rec.detailSig !== sig) {
      rec.detailSig = sig
      this.#fillDetail(rec, detail, row)
    }
    // The one string in the expansion that ages on its own, re-resolved on
    // every payload without touching the nodes around it.
    if (rec.ageEl && row.publishedAt) {
      setText(rec.ageEl, t('publish.row.published-at', 'published {age} ago',
        { age: this.#age(row.publishedAt) }))
    }
    if (detail.parentNode !== rec.li) rec.li.appendChild(detail)
  }

  #fillDetail(rec: RowNodes, detail: HTMLElement, row: PublishRow): void {
    detail.replaceChildren()
    rec.ageEl = null

    if (row.live) detail.appendChild(this.#sigLine('publish.row.live-head', 'live', row.live))
    if (row.here) detail.appendChild(this.#sigLine('publish.row.here-head', 'here', row.here))

    if (row.publishedAt) {
      const age = document.createElement('div')
      age.className = 'pdet-line pdet-age'
      age.textContent = t('publish.row.published-at', 'published {age} ago',
        { age: this.#age(row.publishedAt) })
      detail.appendChild(age)
      rec.ageEl = age
    }

    // Objects in the published closure that are not served: a visitor following
    // this branch would get a 404. The COUNT is the drone's own — never
    // recomputed from the capped list below it.
    if (row.gaps.length > 0) {
      const gaps = document.createElement('div')
      gaps.className = 'pdet-line pdet-gaps'
      gaps.textContent = t('publish.why.gaps', WHY_FALLBACK['publish.why.gaps'] ?? '',
        { count: row.gaps.length })
      detail.appendChild(gaps)

      const list = document.createElement('ul')
      list.className = 'pdet-gaplist'
      for (const gap of this.#gapsShown(row)) {
        const li = document.createElement('li')
        const code = document.createElement('code')
        code.className = 'pdet-sig'
        code.title = gap
        code.textContent = this.#short(gap)
        li.appendChild(code)
        list.appendChild(li)
      }
      detail.appendChild(list)
    }

    const actions = document.createElement('div')
    actions.className = 'pdet-actions'
    if (row.link) {
      actions.appendChild(this.#detailButton(
        t('publish.action.copy-link', 'Copy link'), () => {
          const current = this.#rowFor(row.key)
          if (current) this.#copyLink(current)
        }))
    }
    if (row.segments.length > 0) {
      actions.appendChild(this.#detailButton(
        t('publish.action.visit', 'Open branch'), () => {
          const current = this.#rowFor(row.key)
          if (current) this.#visit(current)
        }))
    }
    detail.appendChild(actions)

    if (row.link) {
      const link = document.createElement('code')
      link.className = 'pdet-link'
      link.setAttribute('title', row.link)
      link.textContent = row.link
      detail.appendChild(link)
    }

    // Unpublish states its honest limit ABOVE the button, every time: it stops
    // the branch being advertised, it does not un-share what has already been
    // shared. The warning and the button are one unit — neither appears without
    // the other, and the wording is the catalog's, verbatim.
    if (row.segments.length > 0 && row.live) {
      const warn = document.createElement('p')
      warn.className = 'pdet-warn'
      warn.textContent = t('publish.unpublish-warning',
        'Stops it being advertised. Anything already shared stays reachable.')
      detail.appendChild(warn)

      const button = this.#detailButton(
        t('publish.action.unpublish', 'Unpublish'), () => {
          const current = this.#rowFor(row.key)
          if (current) this.#unpublish(current)
        })
      button.classList.add('pdet-unpublish')
      detail.appendChild(button)
    }
  }

  #sigLine(key: string, fallback: string, sig: string): HTMLElement {
    const line = document.createElement('div')
    line.className = 'pdet-line'
    const label = document.createElement('span')
    label.className = 'pdet-label'
    label.textContent = t(key, fallback)
    const code = document.createElement('code')
    code.className = 'pdet-sig'
    code.setAttribute('title', sig)
    code.textContent = this.#short(sig)
    line.append(label, code)
    return line
  }

  #detailButton(label: string, run: () => void): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'pdet-btn'
    button.textContent = label
    button.addEventListener('click', run)
    return button
  }
}

// ── shell surface registration — the externalization path ────────────────
// Same name, same order band the Angular component held: 145 sits between
// Observe (140) and the clipboard panel (150), both read-only status windows.
// The module-side `element:` shape (documentation/shell-surfaces.md).
// DEFINED AT MODULE SCOPE, registered when a registry appears. A host with no
// ShellSurfaceRegistry (diamond-core-processor mounts these tags directly in
// its own template) still needs the tag to be a real element rather than an
// inert unknown one — so the define cannot wait on the registry. Only the ADD
// does.
if (!customElements.get(SURFACE_NAME)) {
  customElements.define(SURFACE_NAME, PublishPanelElement)
}

window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/PublishPanelElement',
    element: SURFACE_NAME,
    order: 145,
  })
})
