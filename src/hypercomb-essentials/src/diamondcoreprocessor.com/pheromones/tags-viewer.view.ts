// tags-viewer.view.ts — THE PHEROMONES PANEL, as a framework-free custom
// element (everything-is-a-beehavior Phase 2: Angular panels leave the shell
// and ship as signed modules).
//
// A straight port of shared/ui/tags-viewer: same surface name
// (hc-tags-viewer), same order band (130), same panel id ('tags-viewer' — so
// the participant's saved width, text size and group membership come across),
// the same ten effects in and the same fourteen out. It lands in
// `pheromones/`, beside `pheromone-tiles.drone.ts` and its view: tags ARE
// pheromones, and the card beside the hex is the other half of this surface.
// The door that opens it is `commands/tags-view.queen.ts` (`/tags` →
// `tags:view-open`), which is therefore the file that must import this one.
//
// `tag-grouping.ts` came with it — moved, not copied; the view is its only
// caller and a module may not reach into shared.
//
// ── WHAT IT IS FOR ─────────────────────────────────────────────────────────
//
// The management view for the pheromone vocabulary. Every mark the participant
// knows (the global TagRegistry ∪ whatever is on the current page), each with
// a colour swatch that doubles as a recolour control, the count of currently
// visible tiles carrying it, a filter toggle (the same cross-page flatten the
// controls-bar pills drive, via `tags:filter`), a ＋ that gathers it into the
// bouquet in hand, and an × that ARMS a staged removal rather than acting at
// once.
//
// ── Staged removal ────────────────────────────────────────────────────────
// Removing a keyword used to be one-way and invisible: the × dropped the tag
// from the master registry while every tile kept its decoration, and there was
// no UI path to take a keyword back off the tiles. Now the × arms a removal:
// the hive filters to that keyword (so every tile carrying it is on screen),
// clicking a tile stages it — the tile paints struck-through and the panel's
// list grows — and only then does Remove commit. Cancel throws it away; the
// hive was never written to.
//
// This panel owns the review surface (the list + the two buttons); the staging
// itself lives in TagRemovalDrone, which resolves each staged tile's location
// and splices the decoration on commit. `tags:removal-pending` is the shared
// truth between the two, and the renderer marks the same set.
//
// ── The bouquet in hand, and the shaded hive ──────────────────────────────
// Putting pheromones ON tiles is one gesture: gather the pheromones you want
// (＋ on each row, or click a saved bouquet), and the hive itself becomes the
// review surface — every tile already wearing the WHOLE set stays lit, every
// tile missing any of it shades out, and clicking a shaded tile scents it at
// once (an immediate write, like a drop — the shade already showed exactly
// what the click would do). Lit tiles stay ordinary ground: clicking one walks
// in as always, so you can keep moving while marking.
//
// WHAT IS IN HAND IS ALWAYS A BOUQUET — a bee never emits one compound, and
// neither do you. One mark or six, the gathered set has an identity from the
// first mark (bouquet-registry derives it), before anyone decides to name it.
// Naming is a separate, later act — it commits the bytes and makes the bouquet
// easy to pick up again.
//
// ── WHAT THE PORT HAD TO DECIDE ───────────────────────────────────────────
//
// LIFECYCLE. The Angular version wrapped its whole `<aside>` in
// `@if (visible())`, so the panel's DOM existed only while it was open. A
// registry-fed element is mounted ONCE at boot and stays, so DOM presence and
// ENGAGEMENT are split the way DockedPanelElement splits them: `activate()`
// builds + claims the lane + joins the session, `deactivate()` tears all of
// that down and clears the children. `#show()`/`#hide()` are those two calls
// plus the `.open` class, and the host starts hidden — a panel that flashed on
// boot would be claiming an edge lane nobody asked for.
//
// THE HOST IS THE PANEL. The Angular `:host { inset: 0; pointer-events: none }`
// full-bleed wrapper is gone (DockedPanelElement sizes, positions, grips and
// measures `this`), so the `.tags-panel` rules land on the tag — the
// sequence-viewer precedent. The inset the old `hcDockInset="right"` directive
// reported is folded into the same base.
//
// THE DRAG GHOST MOVED TO <body>. It was a SIBLING of `.tags-panel` under that
// full-bleed host; now the host IS the panel, and the panel carries
// `backdrop-filter` (from `tw.panel`), which makes it a CONTAINING BLOCK for
// `position: fixed` descendants. A ghost parented to the host would follow the
// cursor in the panel's coordinate space — i.e. wrongly, and clipped to a
// 320px column. So it is portaled to `document.body` (the history-viewer
// precedent) under the global class `hc-tags-drag-ghost`, and removed on drag
// end, on cancel and on disconnect.
//
// RENDERING is rebuild-on-change: state lives in the fields below, never in
// the DOM, so a rebuild is always safe. Three things a rebuild owes the
// participant are paid explicitly rather than by a reconciler:
//   • the SEARCH FIELD is built once per activation and kept — rebuilding the
//     input on every keystroke would drop the caret it is receiving;
//   • FOCUS is snapshotted and restored by `data-hc-row` (core's
//     focusSnapshot/restoreFocus), a key this view owns, never by a class:
//     three buttons in a row share `.tag-*` spellings and restoring by class
//     would put the ring on the wrong verb;
//   • SCROLL is snapshotted and restored per `data-hc-scroll` key — the
//     vocabulary list, the bouquet shelf and the staged-removal list are three
//     independent scrollers and a rebuild starts every one of them at the top.
//
// Its strings ship WITH it (tags-viewer.i18n.ts, extracted from all 14 shell
// catalogs) and register under the 'app' namespace, so every key resolves
// exactly as before — the Phase 2 catalog split, another slice. The three
// `tags.scope-*` keys are SHARED with the controls bar, which stays in the
// shell: they are carried here AND left there. A surface must carry everything
// it renders, and so must the one that did not move.

import {
  EffectBus,
  I18N_IOC_KEY,
  PHONE_QUERY,
  focusSnapshot,
  isPhoneViewport,
  restoreFocus,
  type I18nProvider,
} from '@hypercomb/core'
import { DockedPanelElement } from '../panels/docked-panel.element.js'
import { TAGS_VIEWER_TRANSLATIONS } from './tags-viewer.i18n.js'
import {
  bouquetMatchesQuery,
  filterNamespaceGroups,
  filterRowsByQuery,
  looseMarks,
  namespaceGroupsOf,
} from './tag-grouping.js'

const SURFACE_NAME = 'hc-tags-viewer'

interface TagRow {
  name: string
  color: string
  count: number
}

/** How wide a pheromone filter reaches. Mirrors the controls-bar / show-cell
 *  vocabulary exactly — this is the same value that rides `tags:filter`. */
type Scope = 'local' | 'children' | 'global'

/** Movement before a press on a pheromone row counts as a drag rather than a
 *  click — small enough to feel immediate, large enough that a click that
 *  jitters still filters. */
const DRAG_THRESHOLD = 5

/** Chip colour of last resort — no registry entry, no stored colour. */
const DEFAULT_MARK = '#7eb6d6'

/** The colour cache the panel writes through the registry; read here as the
 *  fallback when the registry itself is not up yet. */
const TAG_COLORS_STORAGE = 'hc:tag-colors'

/** A named group of pheromones — the gathered set, saved. */
interface BouquetRow {
  name: string
  sig: string
  marks: string[]
  /** Its marks as full rows, so an opened bouquet offers exactly what the loose
   *  list offers — same swatch, count, gather and remove controls. A bouquet is
   *  a way of ORGANISING the vocabulary, not a second, weaker view of it. */
  rows: TagRow[]
}

/** A namespace group — every mark whose name is prefixed `<namespace>:`.
 *
 *  These are NOT bouquets and must never be confused with them. A bouquet is
 *  gathered on purpose and carries a name someone chose; a namespace is
 *  DERIVED from the mark's own spelling (`visual:website:page` → `visual`) and
 *  nobody curates it. Behaviours mint these to say what a tile IS, so they
 *  group themselves — which is precisely why they are collapsed by default and
 *  kept out of the loose list. */
interface NamespaceGroup {
  name: string
  rows: TagRow[]
}

type TagEntry = { color?: string; enabled?: boolean; accent?: string }
type TagRegistryLike = {
  ensureLoaded(): Promise<void>
  all: Record<string, TagEntry>
  color(name: string): string
  add(name: string, color?: string): Promise<void>
  remove(name: string): Promise<void>
}

type BouquetLike = { name: string; sig: string; marks: string[] }
type BouquetRegistryLike = {
  ensureLoaded(): Promise<void>
  all: BouquetLike[]
  signatureOf(marks: readonly string[]): Promise<string | null>
  save(name: string, marks: readonly string[]): Promise<string | null>
  remove(name: string): Promise<void>
}

const TAG_REGISTRY_KEY = '@hypercomb.social/TagRegistry'
const BOUQUET_REGISTRY_KEY = '@hypercomb.social/BouquetRegistry'

const get = <T,>(key: string): T | undefined => window.ioc?.get?.<T>(key)

// Same contract as the shell pipe: params drive both pluralization
// (`key.zero` / `key.one` / the bare key, chosen on params.count by the i18n
// service) and `{token}` interpolation. The fallback is the English catalog
// text, and it interpolates the same tokens so a bare host with no i18n reads
// identically.
const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  const i18n = get<I18nProvider>(I18N_IOC_KEY)
  const value = i18n?.t(key, params)
  if (value && value !== key) return value
  if (!params) return fallback
  return fallback.replace(/\{(\w+)\}/g, (whole, token: string) =>
    token in params ? String(params[token]) : whole)
}

/** English fallbacks for the RUNTIME-BUILT key `` `tags.scope-${reach}` `` —
 *  the reach toggle's tooltip and aria-label. A TEMPLATE literal whose stem
 *  ends in a HYPHEN: no regex harvest that looks for `'stem.' + x` can see any
 *  of the three, so they are spelled out here and named in the drift spec.
 *  SHARED with the controls bar, which stays in the shell and renders the same
 *  three — carried here, and left there. */
const REACH_HINT: Record<Scope, string> = {
  local: 'Filtering this page only — click to widen to children, then the whole hive',
  children: 'Filtering this page and its children — click to widen to the whole hive',
  global: 'Filtering the whole hive — click to narrow back to this page',
}

/** The three reaches in cycle order — the toggle's walk, and each stage's
 *  glyph. Same ids and glyphs as every other reach control. */
const SCOPE_OPTIONS: readonly { id: Scope; icon: string }[] = [
  { id: 'local', icon: 'blur_on' },
  { id: 'children', icon: 'account_tree' },
  { id: 'global', icon: 'public' },
]

/** The staged-removal commit button is the panel's one three-way inflection,
 *  and it is spelled unusually in the catalogs: `.zero` and `.one` exist, and
 *  the plural is carried by the BARE key. The i18n service falls through
 *  exactly that way; the fallback has to make the same choice itself, or a host
 *  with no catalog would read "Remove from 0 tiles". */
const removalCommitLabel = (count: number): string =>
  t('tags.removal.commit',
    count === 0 ? 'Remove' : count === 1 ? 'Remove from 1 tile' : 'Remove from {count} tiles',
    { count })

/** Same shape, two ways: `tags.inhand.selection.one` exists, the plural is the
 *  bare key. */
const selectionPlaceLabel = (count: number): string =>
  t('tags.inhand.selection',
    count === 1 ? 'Place on the selected tile' : 'Place on the {count} selected tiles',
    { count })

// The panel's strings travel with it — registered as soon as the i18n service
// is up, under 'app' so the keys resolve exactly as they always did.
window.ioc?.whenReady?.(I18N_IOC_KEY, (i18n) => {
  const provider = i18n as I18nProvider
  for (const [locale, catalog] of Object.entries(TAGS_VIEWER_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

// ── the styles the Angular SCSS carried, expanded to plain CSS ────────────
//
// No shadow DOM (the tutorial-overlay + sequence-viewer precedent), so
// Angular's `:host` becomes the tag name and every other selector is prefixed
// with it. `$steel: #7eb6d6` (rgb 126,182,214), `$amber: #d99a4e` (217,154,78)
// and `$mint: #6fbf94` (111,191,148) are inlined at every `rgba($x, …)` call
// site; `tw.$radius-control` (2px), `tw.$radius-card` (3px) and
// `tw.$radius-floating` (4px) are inlined as the literals the SCSS compiled to,
// and `var(--mark-color, …)` / `var(--hc-*)` are left alone. Rule ORDER is the
// SCSS file's order, verbatim, because several pairs here are decided by source
// order rather than specificity.
//
// FOUR EXPANSIONS WORTH NAMING:
//
//  • `@include tw.panel($steel, right)` was the LAST line of `.tags-panel`, so
//    its declarations won the cascade over the ones written above it. The
//    effective values are written here once — background rgba(13,15,21,.975)
//    (not rgba(14,14,22,.96)), border-left alpha .38 (not .5), the 14px/44px
//    shadow with the white inset (not the 10px/40px pair with the steel inset
//    ring) and colour #eef2f5 (not #eaf0f4) — rather than emitting both and
//    leaving five dead declarations in a document-level sheet.
//
//  • `.tags-close`'s own rules sit LATER in the sheet than the `tw.header`
//    close-button rules, but `…tags-header>button[class*='close']` outranks
//    `…tags-close` on specificity, so width / min-width / padding / font-size /
//    colour — and the hover colour (#fff, not #eaf0f4) — come from the header
//    band, and only background / border / cursor come from `.tags-close`. That
//    ordering is reproduced verbatim so the close button lands where it always
//    did. Note the band's `> button` rules reach the close button and the
//    base's settings gear, but NOT `.tags-scope-btn`, which is a grandchild
//    through `.tags-scope`.
//
//  • `.tags-list.bouquet-contents` and `.tags-list.namespace-contents` are
//    QUALIFIED in the original — the bare `.tags-list` rule is written further
//    down the file and would otherwise win on source order and flatten the
//    indent to zero (it did; caught in the browser, not in review). Both
//    spellings are carried exactly.
//
//  • the drag ghost is no longer inside the panel (see the header comment), so
//    `.tag-drag-ghost` becomes the GLOBAL class `.hc-tags-drag-ghost` and its
//    two children are scoped under it rather than left free-floating.
//
// Two rules in the phone block name `.tag-scope-opt` and `.tag-row-btn`, which
// no longer exist in the template. They are carried anyway: dropping a hook the
// original exposed is a silent change to what a theme can reach.
//
// Angular's build autoprefixed; `-webkit-backdrop-filter` and
// `-webkit-user-select` are written by hand.
const CSS = `
${SURFACE_NAME}{position:fixed;top:max(calc(2.3rem * var(--hc-header-zoom,1)),var(--hc-header-anchor));right:var(--hc-controls-right,0);bottom:0;z-index:100002;display:none;flex-direction:column;width:320px;min-width:260px;max-width:calc(100vw - 1.5rem);
  --hc-window-accent:#7eb6d6;--hc-window-radius-control:2px;--hc-window-radius-card:3px;--hc-window-radius-floating:4px;
  background:rgba(13,15,21,.975);backdrop-filter:blur(14px) saturate(1.04);-webkit-backdrop-filter:blur(14px) saturate(1.04);border-radius:0;
  border-right:0;border-left:1px solid rgba(126,182,214,.38);box-shadow:-14px 0 44px rgba(0,0,0,.46),inset 1px 0 rgba(255,255,255,.025);
  font-family:var(--hc-mono,system-ui);font-size:calc(1rem * var(--hc-panel-scale,1));color:#eef2f5;outline:none}
${SURFACE_NAME}.open{display:flex}
${SURFACE_NAME} .tags-body,${SURFACE_NAME} .tags-slot{display:contents}

@media (max-width:599px),(max-height:449px){
${SURFACE_NAME}{top:auto;left:0;right:0;bottom:0;width:100%!important;min-width:0;max-width:none;max-height:min(62vh,30rem);border-left:none;border-top:1px solid rgba(126,182,214,.5);border-radius:4px 4px 0 0;box-shadow:0 -10px 40px rgba(0,0,0,.55),0 0 0 1px rgba(126,182,214,.06) inset;padding-bottom:env(safe-area-inset-bottom,0px)}
${SURFACE_NAME} .tag-scope-opt,${SURFACE_NAME} .tag-row-btn,${SURFACE_NAME} button{min-height:2.5em}
.hc-tags-drag-ghost{display:none!important}
}

${SURFACE_NAME} .tags-header{flex:0 0 auto;box-sizing:border-box;display:flex;align-items:center;gap:.5rem;height:2.875rem;min-height:2.875rem;padding:0 .75rem;line-height:1;background:linear-gradient(180deg,rgba(255,255,255,.018),rgba(255,255,255,.006));justify-content:space-between;border-bottom:1px solid rgba(126,182,214,.25)}
${SURFACE_NAME} .tags-header>button,${SURFACE_NAME} .tags-header>[class*='actions']>button{box-sizing:border-box;display:inline-grid;place-items:center;min-width:1.75rem;height:1.75rem;padding:0 .25rem;border-radius:2px;line-height:1;transition:color 120ms ease,background-color 120ms ease,border-color 120ms ease}
${SURFACE_NAME} .tags-header>button:hover,${SURFACE_NAME} .tags-header>[class*='actions']>button:hover{background-color:rgba(255,255,255,.055)}
${SURFACE_NAME} .tags-header>button:focus-visible,${SURFACE_NAME} .tags-header>[class*='actions']>button:focus-visible{outline:1px solid color-mix(in srgb,var(--hc-window-accent) 72%,white);outline-offset:1px}
${SURFACE_NAME} .tags-header>button[class*='close'],${SURFACE_NAME} .tags-header>button.close,${SURFACE_NAME} .tags-header>[class*='actions']>button[class*='close']{width:1.75rem;min-width:1.75rem;padding:0;font-size:1.125rem;color:rgba(238,244,248,.62)}
${SURFACE_NAME} .tags-header>button[class*='close']:hover,${SURFACE_NAME} .tags-header>button.close:hover,${SURFACE_NAME} .tags-header>[class*='actions']>button[class*='close']:hover{color:#fff;background-color:rgba(255,255,255,.075)}
${SURFACE_NAME} .tags-heading{display:flex;align-items:center;gap:.5em;min-width:0}
${SURFACE_NAME} .tags-title{font-size:.95em;font-weight:600;letter-spacing:.02em}
${SURFACE_NAME} .tags-total{font-size:.75em;color:rgba(126,182,214,.85);background:rgba(126,182,214,.12);border-radius:999px;padding:.05em .55em}
${SURFACE_NAME} .tags-scope{flex-shrink:0;display:flex;gap:.2rem;margin-left:auto;padding:.15rem;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:2px}
${SURFACE_NAME} .tags-scope-btn{display:inline-flex;align-items:center;justify-content:center;padding:.24rem .4rem;background:transparent;border:1px solid transparent;border-radius:2px;color:rgba(226,235,244,.55);cursor:pointer;transition:color 150ms ease,background 150ms ease,border-color 150ms ease}
${SURFACE_NAME} .tags-scope-btn .mat-sym{font-size:1rem;line-height:1}
${SURFACE_NAME} .tags-scope-btn:hover{color:rgba(238,243,248,.9)}
${SURFACE_NAME} .tags-scope-btn.active{color:#fff;background:rgba(126,182,214,.16);border-color:rgba(126,182,214,.45)}
${SURFACE_NAME} .tags-close{background:none;border:none;color:#9fb3c2;font-size:1.2em;line-height:1;cursor:pointer;padding:0 .2em}
${SURFACE_NAME} .tags-close:hover{color:#eaf0f4}
${SURFACE_NAME} .tags-empty{padding:1.4em 1.2em;color:#8ea2b0;font-size:.85em;line-height:1.5}
${SURFACE_NAME} .tags-section-title,${SURFACE_NAME} .tags-removal-section,${SURFACE_NAME} .tags-inhand-section,${SURFACE_NAME} .tags-search-block,${SURFACE_NAME} .tags-active-section{flex:0 0 auto}
${SURFACE_NAME} .tags-section-title{margin:0;padding:.6em 1em .35em;color:rgba(126,182,214,.8);font-size:.68em;font-weight:600;letter-spacing:.09em;text-transform:uppercase}
${SURFACE_NAME} .tags-active-section{display:flex;align-items:center;gap:.5em;flex-wrap:wrap;padding:.6em 1em;border-top:1px solid rgba(126,182,214,.12);border-bottom:1px solid rgba(126,182,214,.12)}
${SURFACE_NAME} .active-line{display:flex;align-items:center;gap:.4em;flex-wrap:wrap;flex:1 1 auto;min-width:0}
${SURFACE_NAME} .active-label{font-size:.72em;color:#8ea2b0}
${SURFACE_NAME} .active-chip{font-size:.74em;color:#eaf5fb;background:rgba(126,182,214,.18);border-radius:999px;padding:.1em .6em}
${SURFACE_NAME} .active-none{margin:0;font-size:.74em;color:#8ea2b0}
${SURFACE_NAME} .tags-clear{flex:0 0 auto;background:none;border:1px solid rgba(126,182,214,.35);border-radius:3px;color:#c6d5e0;font:inherit;font-size:.72em;padding:.15em .6em;cursor:pointer;transition:background .12s ease,color .12s ease}
${SURFACE_NAME} .tags-clear:hover{background:rgba(126,182,214,.16);color:#fff}
${SURFACE_NAME} .tags-removal-section{border-top:1px solid rgba(217,154,78,.35);border-bottom:1px solid rgba(217,154,78,.35);background:rgba(217,154,78,.07);padding-bottom:.7em}
${SURFACE_NAME} .removal-title{color:rgba(217,154,78,.95)}
${SURFACE_NAME} .removal-hint,${SURFACE_NAME} .removal-empty{margin:0;padding:0 1em .5em;font-size:.72em;line-height:1.45;color:#a89880}
${SURFACE_NAME} .removal-empty{color:rgba(217,154,78,.8)}
${SURFACE_NAME} .removal-list{list-style:none;margin:0 0 .6em;padding:0 1em;max-height:9em;overflow-y:auto}
${SURFACE_NAME} .removal-cell{display:flex;align-items:center;gap:.4em;padding:.12em 0;font-size:.76em;color:#e6d5bd}
${SURFACE_NAME} .removal-cell-icon{flex:0 0 auto;font-size:.9em;color:rgba(217,154,78,.9)}
${SURFACE_NAME} .removal-cell-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-decoration:line-through;text-decoration-color:rgba(217,154,78,.7)}
${SURFACE_NAME} .removal-actions{display:flex;align-items:center;gap:.4em;flex-wrap:wrap;padding:0 1em}
${SURFACE_NAME} .removal-commit,${SURFACE_NAME} .removal-all,${SURFACE_NAME} .removal-cancel{background:none;border:1px solid rgba(126,182,214,.35);border-radius:3px;color:#c6d5e0;font:inherit;font-size:.72em;padding:.2em .65em;cursor:pointer;transition:background .12s ease,color .12s ease,border-color .12s ease}
${SURFACE_NAME} .removal-commit:hover,${SURFACE_NAME} .removal-all:hover,${SURFACE_NAME} .removal-cancel:hover{background:rgba(126,182,214,.16);color:#fff}
${SURFACE_NAME} .removal-commit{border-color:rgba(217,154,78,.6);color:#f0d9b6}
${SURFACE_NAME} .removal-commit:hover:not(:disabled){background:rgba(217,154,78,.22);color:#fff}
${SURFACE_NAME} .removal-commit:disabled{opacity:.4;cursor:default;border-color:rgba(126,182,214,.2);color:#8ea2b0}
${SURFACE_NAME} .removal-forget{display:block;margin:.6em 1em 0;background:none;border:none;padding:0;color:#8ea2b0;font:inherit;font-size:.68em;text-decoration:underline;text-underline-offset:.2em;cursor:pointer}
${SURFACE_NAME} .removal-forget:hover{color:#e06b6b}
${SURFACE_NAME} .tags-inhand-section{border-top:1px solid rgba(111,191,148,.35);border-bottom:1px solid rgba(111,191,148,.35);background:rgba(111,191,148,.07);padding:.55em 0 .7em}
${SURFACE_NAME} .painter-picked{list-style:none;display:flex;flex-wrap:wrap;gap:.35em;margin:0 0 .6em;padding:0 1em}
${SURFACE_NAME} .painter-chip{display:inline-flex;align-items:center;gap:.4em;padding:.18em .22em .18em .32em;border-radius:4px;background:rgba(111,191,148,.1);border:1px solid rgba(111,191,148,.38);font-size:.74em;color:#dff2e8}
${SURFACE_NAME} .painter-chip-swatch{flex:0 0 auto;width:.95em;height:.95em;border-radius:3px;box-shadow:0 0 0 1px rgba(0,0,0,.45) inset}
${SURFACE_NAME} .painter-chip-drop{background:none;border:none;padding:0 .2em;color:rgba(111,191,148,.8);font:inherit;line-height:1;cursor:pointer}
${SURFACE_NAME} .painter-chip-drop:hover{color:#fff}
${SURFACE_NAME} .painter-stage-selection{display:flex;align-items:center;gap:.45em;width:100%;margin-top:.5em;padding:.4em .6em;border:1px dashed rgba(111,191,148,.45);border-radius:3px;background:rgba(111,191,148,.06);color:rgba(214,238,226,.85);cursor:pointer;font:inherit;font-size:.8em;text-align:left;transition:background 140ms ease,border-color 140ms ease,color 140ms ease}
${SURFACE_NAME} .painter-stage-selection .mat-sym{font-size:1.1em;color:#6fbf94}
${SURFACE_NAME} .painter-stage-selection:hover{background:rgba(111,191,148,.13);border-color:rgba(111,191,148,.7);color:#eefaf4}
${SURFACE_NAME} .painter-stage-selection:focus-visible{outline:1px solid rgba(111,191,148,.7);outline-offset:1px}
${SURFACE_NAME} .painter-actions{display:flex;align-items:center;gap:.4em;flex-wrap:wrap;padding:0 1em}
${SURFACE_NAME} .painter-close{background:none;border:1px solid rgba(126,182,214,.35);border-radius:3px;color:#c6d5e0;font:inherit;font-size:.72em;padding:.2em .65em;cursor:pointer;transition:background .12s ease,color .12s ease,border-color .12s ease}
${SURFACE_NAME} .painter-close:hover{background:rgba(126,182,214,.16);color:#fff}
${SURFACE_NAME} .bouquet-in-hand{display:flex;align-items:center;gap:.4em;margin:0 0 .45em;padding:0 1em;font-size:.72em;color:rgba(111,191,148,.85)}
${SURFACE_NAME} .bouquet-in-hand .mat-sym{font-size:1em}
${SURFACE_NAME} .bouquet-in-hand-label{font-weight:600;color:#dff2e8}
${SURFACE_NAME} .bouquet-in-hand-sig{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em;color:rgba(214,228,238,.5)}
${SURFACE_NAME} .bouquet-save-open{display:flex;align-items:center;gap:.45em;width:calc(100% - 2em);margin:0 1em .6em;padding:.35em .6em;background:none;border:1px dashed rgba(111,191,148,.4);border-radius:3px;color:rgba(214,238,226,.85);font:inherit;font-size:.74em;text-align:left;cursor:pointer;transition:background .12s ease,border-color .12s ease,color .12s ease}
${SURFACE_NAME} .bouquet-save-open .mat-sym{font-size:1.05em;color:#6fbf94}
${SURFACE_NAME} .bouquet-save-open:hover{background:rgba(111,191,148,.13);border-color:rgba(111,191,148,.7);color:#eefaf4}
${SURFACE_NAME} .bouquet-name-form{display:flex;align-items:center;gap:.35em;margin:0 1em .6em}
${SURFACE_NAME} .bouquet-name-input{flex:1 1 auto;min-width:0;padding:.3em .5em;background:rgba(0,0,0,.25);border:1px solid rgba(111,191,148,.45);border-radius:3px;color:#eaf4ee;font:inherit;font-size:.76em}
${SURFACE_NAME} .bouquet-name-input::placeholder{color:rgba(226,235,244,.4)}
${SURFACE_NAME} .bouquet-name-input:focus{outline:none;border-color:rgba(111,191,148,.8)}
${SURFACE_NAME} .bouquet-name-commit,${SURFACE_NAME} .bouquet-name-cancel{flex:0 0 auto;background:none;border:1px solid rgba(126,182,214,.35);border-radius:3px;color:#c6d5e0;font:inherit;font-size:.72em;padding:.25em .6em;cursor:pointer}
${SURFACE_NAME} .bouquet-name-commit:hover,${SURFACE_NAME} .bouquet-name-cancel:hover{background:rgba(126,182,214,.16);color:#fff}
${SURFACE_NAME} .bouquet-name-commit{border-color:rgba(111,191,148,.6);color:#cdead9}
${SURFACE_NAME} .bouquet-name-commit:hover{background:rgba(111,191,148,.22);color:#fff}
${SURFACE_NAME} .tags-bouquets-section{flex:0 0 auto;border-top:1px solid rgba(126,182,214,.18)}
${SURFACE_NAME} .bouquet-title{color:rgba(111,191,148,.95)}
${SURFACE_NAME} .bouquet-list{list-style:none;margin:0 0 .6em;padding:0 1em;max-height:12em;overflow-y:auto}
${SURFACE_NAME} .bouquet-list:has(.bouquet-row.open){max-height:26em}
${SURFACE_NAME} .bouquet-row{display:flex;flex-direction:column;padding:.15em 0}
${SURFACE_NAME} .bouquet-row.loaded .bouquet-load{border-color:rgba(111,191,148,.6);background:rgba(111,191,148,.12)}
${SURFACE_NAME} .bouquet-head{display:flex;align-items:flex-start;gap:.3em}
${SURFACE_NAME} .bouquet-open{flex:0 0 auto;align-self:center;display:inline-flex;align-items:center;background:none;border:none;padding:0 .1em;color:rgba(158,179,194,.7);cursor:pointer}
${SURFACE_NAME} .bouquet-open .mat-sym{font-size:1.05em}
${SURFACE_NAME} .bouquet-open:hover{color:#eaf0f4}
${SURFACE_NAME} .tags-list.bouquet-contents{margin:.2em 0 .35em .9em;padding:0;border-left:1px solid rgba(126,182,214,.22);overflow:visible}
${SURFACE_NAME} .tags-list.bouquet-contents .tags-row{padding-left:.7em}
${SURFACE_NAME} .tags-list.bouquet-contents .tags-row:last-child{border-bottom:none}
${SURFACE_NAME} .bouquet-load{flex:1 1 auto;min-width:0;display:flex;flex-wrap:wrap;align-items:center;column-gap:.35em;row-gap:.25em;padding:.35em .5em;background:none;border:1px solid rgba(126,182,214,.25);border-radius:3px;color:#d6e4ee;font:inherit;text-align:left;cursor:grab;user-select:none;-webkit-user-select:none;-webkit-user-drag:none;transition:background .12s ease,border-color .12s ease}
${SURFACE_NAME} .bouquet-load:active{cursor:grabbing}
${SURFACE_NAME} .bouquet-load:hover{background:rgba(111,191,148,.08);border-color:rgba(111,191,148,.45)}
${SURFACE_NAME} .bouquet-name{font-size:.8em;font-weight:600;letter-spacing:.01em}
${SURFACE_NAME} .bouquet-name::after{content:':'}
${SURFACE_NAME} .bouquet-mark{display:inline-flex;align-items:center;gap:.3em;padding:.1em .3em .1em .22em;border-radius:3px;background:rgba(255,255,255,.04);font-size:.68em;color:rgba(214,228,238,.85)}
${SURFACE_NAME} .bouquet-mark-swatch{flex:0 0 auto;width:.8em;height:.8em;border-radius:2px;box-shadow:0 0 0 1px rgba(0,0,0,.45) inset}
${SURFACE_NAME} .bouquet-forget{flex:0 0 auto;align-self:center;background:none;border:none;padding:0 .25em;color:rgba(158,179,194,.6);font:inherit;line-height:1;cursor:pointer}
${SURFACE_NAME} .bouquet-forget:hover{color:#eaf0f4}
${SURFACE_NAME} .tags-search-block{padding:.5em 1em .45em;border-top:1px solid rgba(126,182,214,.12)}
${SURFACE_NAME} .tags-search-field{display:flex;align-items:center;gap:.4em;padding:.25em .5em;background:rgba(0,0,0,.25);border:1px solid rgba(126,182,214,.3);border-radius:2px}
${SURFACE_NAME} .tags-search-field:focus-within{border-color:rgba(126,182,214,.6)}
${SURFACE_NAME} .tags-search-icon{flex:0 0 auto;font-size:1em;color:rgba(158,179,194,.7)}
${SURFACE_NAME} .tags-search-input{flex:1 1 auto;min-width:0;background:none;border:none;color:#eaf0f4;font:inherit;font-size:.78em;padding:.1em 0}
${SURFACE_NAME} .tags-search-input::placeholder{color:rgba(226,235,244,.4)}
${SURFACE_NAME} .tags-search-input:focus{outline:none}
${SURFACE_NAME} .tags-search-clear{flex:0 0 auto;background:none;border:none;padding:0 .1em;font-size:1em;color:rgba(158,179,194,.7);cursor:pointer}
${SURFACE_NAME} .tags-search-clear:hover{color:#eaf0f4}
${SURFACE_NAME} .tags-list{list-style:none;margin:0;padding:.4em 0;overflow-y:auto;flex:1 1 auto;min-height:0;overscroll-behavior:contain}
${SURFACE_NAME} .tags-namespaces-section{flex:0 0 auto;border-top:1px solid rgba(126,182,214,.18);padding-bottom:.4em}
${SURFACE_NAME} .namespace-hint{margin:0;padding:0 1em .5em;font-size:.72em;line-height:1.45;color:#8ea2b0}
${SURFACE_NAME} .namespace-group + .namespace-group{border-top:1px solid rgba(126,182,214,.07)}
${SURFACE_NAME} .namespace-head{width:100%;display:flex;align-items:center;gap:.4em;padding:.35em 1em;background:none;border:none;color:#b9cbd8;font:inherit;font-size:.8em;text-align:left;cursor:pointer}
${SURFACE_NAME} .namespace-head .mat-sym{font-size:1.05em;color:rgba(158,179,194,.7)}
${SURFACE_NAME} .namespace-head:hover{background:rgba(126,182,214,.06);color:#eaf0f4}
${SURFACE_NAME} .namespace-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;letter-spacing:.01em}
${SURFACE_NAME} .namespace-count{flex:0 0 auto;font-size:.85em;color:rgba(158,179,194,.7);font-variant-numeric:tabular-nums}
${SURFACE_NAME} .tags-list.namespace-contents{margin:0 0 .3em 1.6em;padding:0;border-left:1px solid rgba(126,182,214,.22);overflow:visible}
${SURFACE_NAME} .tags-list.namespace-contents .tags-row{padding-left:.7em}
${SURFACE_NAME} .tags-list.namespace-contents .tags-row:last-child{border-bottom:none}
${SURFACE_NAME} .tags-row{display:flex;align-items:center;gap:.6em;padding:.4em 1em;border-bottom:1px solid rgba(126,182,214,.07)}
${SURFACE_NAME} .tags-row:hover{background:rgba(126,182,214,.06)}
${SURFACE_NAME} .tags-row.filtered{background:rgba(126,182,214,.14)}
${SURFACE_NAME} .tags-row.staging{background:rgba(217,154,78,.16)}
${SURFACE_NAME} .tags-row.picked{background:rgba(111,191,148,.08)}
${SURFACE_NAME} .tags-row.painting{background:rgba(111,191,148,.16)}
${SURFACE_NAME} .tags-row.previewing,${SURFACE_NAME} .bouquet-head.previewing,${SURFACE_NAME} .painter-chip.previewing{background:linear-gradient(90deg,color-mix(in srgb,var(--mark-color,#7eb6d6) 30%,transparent),color-mix(in srgb,var(--mark-color,#7eb6d6) 8%,transparent) 55%,transparent);box-shadow:inset 3px 0 0 var(--mark-color,#7eb6d6)}
${SURFACE_NAME} .previewing .tag-swatch,${SURFACE_NAME} .previewing .bouquet-mark-swatch,${SURFACE_NAME} .previewing .painter-chip-swatch{box-shadow:0 0 0 1px rgba(0,0,0,.4) inset,0 0 0 2px color-mix(in srgb,var(--mark-color,#7eb6d6) 70%,transparent),0 0 10px color-mix(in srgb,var(--mark-color,#7eb6d6) 55%,transparent)}
${SURFACE_NAME} .previewing .tag-name,${SURFACE_NAME} .previewing .bouquet-name,${SURFACE_NAME} .previewing .painter-chip-name{color:#fff}
${SURFACE_NAME} .tag-swatch{flex:0 0 auto;width:1.1em;height:1.1em;border-radius:3px;box-shadow:0 0 0 1px rgba(0,0,0,.4) inset;cursor:pointer;position:relative;overflow:hidden}
${SURFACE_NAME} .tag-swatch input[type="color"]{position:absolute;inset:0;opacity:0;cursor:pointer;border:none;padding:0}
.hc-tags-drag-ghost{position:fixed;z-index:100010;pointer-events:none;transform:translate(-0.5em,-50%);display:inline-flex;align-items:center;gap:.45em;padding:.3em .6em .3em .35em;border-radius:2px;background:rgba(14,17,24,.96);border:1px solid rgba(126,182,214,.5);box-shadow:0 8px 22px rgba(0,0,0,.55);font-family:var(--hc-mono,system-ui);font-size:.78rem;line-height:1.2;color:#e8eef5;white-space:nowrap}
.hc-tags-drag-ghost .tag-drag-swatch{flex:0 0 auto;width:1.05em;height:1.05em;border-radius:3px;box-shadow:0 0 0 1px rgba(0,0,0,.45) inset}
.hc-tags-drag-ghost .tag-drag-count{flex:0 0 auto;font-size:.85em;color:rgba(158,179,194,.85);font-variant-numeric:tabular-nums}
${SURFACE_NAME} .tag-name{flex:1 1 auto;text-align:left;background:none;border:none;color:inherit;font:inherit;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-user-drag:none;padding:.1em 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
${SURFACE_NAME} .tag-name:active{cursor:grabbing}
${SURFACE_NAME} .tag-name:hover{color:#fff}
${SURFACE_NAME} .tag-name[aria-pressed="true"]{color:#7eb6d6;font-weight:600}
${SURFACE_NAME} .tag-count{flex:0 0 auto;font-size:.78em;color:#8ea2b0;min-width:1.4em;text-align:right}
${SURFACE_NAME} .tag-remove{flex:0 0 auto;background:none;border:none;color:#6e8290;font-size:1em;line-height:1;cursor:pointer;padding:0 .2em;opacity:0;transition:opacity .12s ease,color .12s ease}
${SURFACE_NAME} .tags-row:hover .tag-remove{opacity:1}
${SURFACE_NAME} .tag-remove:hover{color:#e06b6b}
${SURFACE_NAME} .tag-remove.armed{opacity:1;color:#d99a4e}
${SURFACE_NAME} .tag-remove.armed:hover{color:#f0d9b6}
${SURFACE_NAME} .tag-apply{flex:0 0 auto;background:none;border:none;color:#6e8290;font-size:1em;line-height:1;cursor:pointer;padding:0 .2em;opacity:.55;transition:opacity .12s ease,color .12s ease}
${SURFACE_NAME} .tags-row:hover .tag-apply{opacity:1}
${SURFACE_NAME} .tag-apply:hover{color:#6fbf94}
${SURFACE_NAME} .tag-apply.picked{opacity:1;color:rgba(111,191,148,.8)}
${SURFACE_NAME} .tag-apply.picked:hover{color:#cdead9}
${SURFACE_NAME} .tag-apply.armed{opacity:1;color:#6fbf94}
${SURFACE_NAME} .tag-apply.armed:hover{color:#cdead9}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-tags-viewer', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

export class TagsViewerElement extends DockedPanelElement {

  #offs: Array<() => void> = []

  /** THE visibility flag. `close()`, the open handler and the session's
   *  park/unpark all read and write THIS field — a second notion of "open" is
   *  how the two drift apart after the first press. */
  #visible = false

  // ── state (never the DOM) ────────────────────────────────────────────

  /** Per-page tag counts, last value from `render:tags`. */
  #counts: Map<string, number> = new Map()
  /** Active tag filters (mirrors `tags:filter` so the panel and the
   *  controls-bar pills agree on what's filtered). */
  #active: Set<string> = new Set()
  /** How wide a filter reaches. This panel is the control surface for it — the
   *  controls-bar glyph used to cycle it blind. Mirrors `tags:filter`, so bar
   *  and panel can never disagree. Non-sticky, same as the bar. */
  #scope: Scope = 'local'

  /** The keyword whose removal is armed, or null. Mirrors
   *  `tags:removal-pending` so the panel can never disagree with the renderer
   *  about what is staged. */
  #removalTag: string | null = null
  /** Tiles staged to lose that keyword — the list that grows as you click. */
  #removalCells: string[] = []
  /** The pheromones gathered into the bouquet in hand. Gathering IS arming —
   *  the moment anything is picked, the hive shades what is missing it. */
  #selected: Set<string> = new Set()
  /** The keywords currently armed. Mirrors `tags:apply-pending`
   *  (PheromoneTilesDrone). Scenting and removal are the two takeovers of the
   *  tile click, mutually exclusive so they never fight over the same tap. */
  #applyTags: string[] = []

  /** The search over the vocabulary — ONE field, filtering bouquets, loose
   *  keywords and namespace groups alike. View state, never truth. */
  #query = ''

  /** Saved bouquets, mirrored from `bouquets:registry`. */
  #bouquets: BouquetLike[] = []
  /** The naming field is open (the bouquet in hand is being given a name). */
  #naming = false
  /** The half-typed bouquet name. The FORM is rebuilt by every `#render()`,
   *  and a value living only in the DOM dies with it — so the draft is mirrored
   *  here on every keystroke and the rebuilt input is seeded from it. Cleared
   *  wherever the naming gesture ends. Same shape as `#query` backing the
   *  search box, which was given this treatment for the same reason. */
  #nameDraft = ''
  /** The signature of the bouquet in hand. Derived the moment anything is
   *  picked — the gathered set IS a bouquet, named or not — so the identity is
   *  never something a later Save has to invent. */
  #bouquetSig: string | null = null

  /** Which bouquets are opened to show their marks, and which namespace groups
   *  are unfolded. Both view state, both closed by default. */
  #openBouquets: Set<string> = new Set()
  #openNamespaces: Set<string> = new Set()

  /** The marks the hive is lighting under the cursor right now. */
  #previewing: readonly string[] = []

  /** Canvas-selection response (documentation/selection-tool-windows.md) —
   *  distinct from `#selected`, which is this panel's own picked keywords. */
  #canvasSelection: readonly string[] = []

  /** What is being dragged onto the hive, or null. */
  #dragging: { name: string; color: string; count: number } | null = null
  /** Candidate press, promoted to a real drag once the pointer moves far
   *  enough. */
  #pending: { marks: string[]; name: string; color: string; x: number; y: number } | null = null
  /** A drag just ended — swallow the click it would otherwise fire. */
  #swallowClick = false
  /** Tile currently under the cursor, mirrored from `tile:hover`. */
  #hoverLabel: string | null = null
  /** The ghost node, parented to <body> (see the header comment). */
  #ghost: HTMLElement | null = null

  /** Phone-shaped viewport — small in EITHER dimension (a phone on its side is
   *  wide but short). The panel is a full-bleed sheet there, and a sheet has no
   *  business holding a place in the lane. */
  #phone = isPhoneViewport()
  readonly #phoneQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(PHONE_QUERY)
    : null

  /** The naming field's focus ladder (see `#beginNaming`), cleared on teardown
   *  so a panel that closed in the same frame cannot reach for a dead node. */
  #focusTimer: ReturnType<typeof setTimeout> | null = null

  // ── chrome built once per activation ─────────────────────────────────
  //
  // The header must survive a re-render because DockedPanelElement plants the
  // settings gear inside it (and nudges the close button over to make room)
  // AFTER renderPanel() returns — rebuilding the header would throw the gear
  // away. The SEARCH FIELD survives for a different reason: it is the one node
  // the participant types into on every keystroke, and rebuilding it under the
  // caret is exactly the defect rebuild-on-change is allowed to cause.
  #topSlot: HTMLElement | null = null
  #bottomSlot: HTMLElement | null = null
  #titleEl: HTMLElement | null = null
  #headingEl: HTMLElement | null = null
  #totalEl: HTMLElement | null = null
  #scopeBtn: HTMLButtonElement | null = null
  #scopeGlyph: HTMLElement | null = null
  #closeEl: HTMLElement | null = null
  #searchField: HTMLElement | null = null
  #searchInput: HTMLInputElement | null = null
  #searchClear: HTMLButtonElement | null = null

  constructor() {
    super()
    // Same panel id the Angular `hcDockedPanel="tags-viewer"` carried, so the
    // saved width (`hc:docked-width:tags-viewer`), text size, code font and
    // group membership all come across with the participant.
    this.panelId = 'tags-viewer'
    this.dockSide = 'right'
    this.minWidth = 260
    this.maxWidth = 560
    this.defaultWidth = 320
    // Registry-fed: mounted once at boot, engaged only when something opens it.
    this.autoActivate = false
    // `[dockExclusive]="!isPhone()"` — on a phone the panel is a full-bleed
    // sheet, and a sheet must not hold a place in the edge lane.
    this.setDockExclusive(!this.#phone)

    // The session, built by hand rather than with `signalSession` for ONE
    // reason — the park has to be distinguishable from a close ON THE WIRE.
    // Both announce `open:false`, and the drone that owns the tile-side brush
    // cannot read our intent from that alone, so it disarmed on either and the
    // promise "a parked panel keeps what it was holding" was quietly broken for
    // every park the shell made (lane eviction, a rail flyout, the installer).
    // `parked:true` is the whole fix; the drone leaves an armed brush alone
    // when it sees it.
    this.session = {
      park: () => {
        // Parked rows never get their pointerleave (see endPreview in close()).
        this.#endPreview()
        this.#hide()
        EffectBus.emit('tags:view-state', { open: false, parked: true })
      },
      unpark: () => {
        this.#show()
        EffectBus.emit('tags:view-state', { open: true })
      },
      dismiss: () => this.dismiss(),
      close: () => this.close(),
      // The palette is not a window — it is the PAINT. Every other tool window
      // is put away when one opens; this one may stay beside it, because a mark
      // is applied by dragging FROM here ONTO what is open (a note in the notes
      // window, a tile on the canvas). See window-rule.ts.
      companion: true,
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

    this.#phoneQuery?.addEventListener('change', this.#onPhoneChange)

    this.#offs.push(
      // `selection:changed` has TWO publishers with different payload shapes
      // (SelectionService's pair, the pixi TileSelectionDrone's superset). The
      // shell's `onSelection` helper normalized both down to the pair; that
      // normalization is inlined here rather than imported — a module may not
      // reach into shared. Storing a list absorbs a repeated delivery for free
      // (nothing here accumulates).
      EffectBus.on<{ selected?: unknown }>('selection:changed', (p) => {
        const selected = Array.isArray(p?.selected) ? (p.selected as unknown[]).map(String) : []
        const changed = selected.length !== this.#canvasSelection.length
        this.#canvasSelection = selected
        // Only the COUNT is rendered (the place button's label), so a swap that
        // keeps the count paints nothing — but the labels are still stored,
        // because `applyBouquetToSelection` writes to exactly those tiles.
        if (changed && this.#visible) this.#render()
      }),

      EffectBus.on('tags:view-open', () => {
        // Both registries are lazy; asking them to load is what makes a
        // freshly-opened panel show the whole vocabulary rather than only what
        // this page happens to carry.
        void this.#registry()?.ensureLoaded().then(() => { if (this.#visible) this.#render() })
        void this.#bouquetRegistry()?.ensureLoaded()
        if (this.#visible) this.#render()
        else this.#show()
        // Broadcast open-state (last-value replayed) so the header toggle
        // lights. Emitted unconditionally, exactly as the original did.
        EffectBus.emit('tags:view-state', { open: true })
      }),

      EffectBus.on('tags:view-close', () => this.close()),

      // Sticky: last per-page counts replay on subscribe.
      EffectBus.on<{ tags?: { name: string; count: number }[] }>('render:tags', (p) => {
        const map = new Map<string, number>()
        for (const tag of p?.tags ?? []) if (tag?.name) map.set(tag.name, tag.count ?? 0)
        this.#counts = map
        if (this.#visible) this.#render()
      }),

      // Saved bouquets (sticky) — the BouquetRegistry owns them, this panel
      // renders them and hands one back to the brush on click.
      EffectBus.on<{ bouquets?: BouquetLike[] }>('bouquets:registry', (p) => {
        this.#bouquets = Array.isArray(p?.bouquets) ? [...p.bouquets] : []
        if (this.#visible) this.#render()
      }),

      // Registry changed (add / recolor / remove) → re-read.
      EffectBus.on('tags:registry', () => {
        if (this.#visible) this.#render()
      }),

      // Mirror the active filter set AND the reach (sticky) so the toggles
      // reflect whatever the controls-bar pills set, and vice-versa.
      EffectBus.on<{ active?: string[]; scope?: Scope }>('tags:filter', (p) => {
        this.#active = new Set(Array.isArray(p?.active) ? p.active : [])
        if (p?.scope) this.#scope = p.scope
        if (this.#visible) this.#render()
      }),

      // Staging state (sticky): the drone is the owner, this panel renders it.
      EffectBus.on<{ tag?: string | null; cells?: string[]; active?: boolean }>(
        'tags:removal-pending', (p) => {
          this.#removalTag = p?.active ? (p.tag ?? null) : null
          this.#removalCells = Array.isArray(p?.cells) ? [...p.cells] : []
          if (this.#visible) this.#render()
        }),

      // Which tile the cursor is over — the drop target for a dragged pheromone
      // when the pointer is on the hive rather than on a tile's own card.
      // Never rendered, so never a reason to repaint.
      EffectBus.on<{ label?: string | null }>('tile:hover', (p) => {
        this.#hoverLabel = p?.label ?? null
      }),

      // Armed state (sticky): PheromoneTilesDrone owns it, this panel reflects
      // which keywords are in hand. When the drone puts the bouquet down (a
      // selection commit finished, an Escape out on the hive, a close), the
      // gathered set here follows the truth — a picked-but-disarmed panel would
      // show marks the hive is no longer shading for.
      EffectBus.on<{ tag?: string | null; tags?: string[]; cells?: string[]; active?: boolean }>(
        'tags:apply-pending', (p) => {
          const armed = p?.active === true
          const tags = armed
            ? (Array.isArray(p?.tags) && p.tags.length ? p.tags : (p?.tag ? [p.tag] : []))
            : []
          this.#applyTags = [...tags]
          if (!armed && this.#selected.size > 0) {
            this.#selected = new Set()
            this.#bouquetSig = null
            this.#naming = false
          }
          if (this.#visible) this.#render()
        }),

      // THE PIPE WAS IMPURE. Angular's `t` pipe is declared `pure: false`, so
      // every change-detection tick re-resolved every string and `/language ja`
      // re-labelled an OPEN panel on the spot. An element renders when it
      // decides to, so the locale switch has to be a reason to render — else an
      // open panel keeps its old-locale title, reach tooltip, search
      // placeholder, section headings, empty states and every row's four
      // tooltips until it is closed and reopened. Rebuilding is safe: the rows
      // live in the fields above, never in the DOM.
      EffectBus.on('locale:changed', () => {
        if (!this.#visible) return
        this.#relabel()
        this.#render()
      }),
    )
  }

  override disconnectedCallback(): void {
    // A row that is torn down never gets its pointerleave, so the hive would
    // hold the preview forever.
    this.#endPreview()
    this.#offs.forEach(off => off())
    this.#offs = []
    this.#phoneQuery?.removeEventListener('change', this.#onPhoneChange)
    this.#detachDrag()
    this.#removeGhost()
    if (this.#focusTimer !== null) { clearTimeout(this.#focusTimer); this.#focusTimer = null }
    super.disconnectedCallback()   // → deactivate(): lane, session, grip, gear, children
    this.#visible = false
    this.classList.remove('open')
    this.removeAttribute('aria-label')
    this.#forgetChrome()
  }

  #onPhoneChange = (event: MediaQueryListEvent): void => {
    this.#phone = event.matches
    // Rotating a phone crosses the threshold in both directions, and a lane
    // place held by a full-bleed sheet is a place nothing can use.
    this.setDockExclusive(!this.#phone)
  }

  // ── services ─────────────────────────────────────────────────────────

  #registry(): TagRegistryLike | undefined {
    return get<TagRegistryLike>(TAG_REGISTRY_KEY)
  }

  #bouquetRegistry(): BouquetRegistryLike | undefined {
    return get<BouquetRegistryLike>(BOUQUET_REGISTRY_KEY)
  }

  #colorOf(name: string, registry: TagRegistryLike | undefined): string {
    const c = registry?.color(name)
    if (c) return c
    try {
      const stored: Record<string, string> = JSON.parse(localStorage.getItem(TAG_COLORS_STORAGE) ?? '{}')
      if (stored[name]) return stored[name]
    } catch { /* fall through */ }
    return DEFAULT_MARK
  }

  // ── derived readings (recomputed per render — no signals here) ────────

  /** Sorted tag rows: every registry tag plus any page tag not yet registered,
   *  each with its colour and current visible count. */
  #rows(): TagRow[] {
    const registry = this.#registry()
    const names = new Set<string>()
    if (registry) for (const n of Object.keys(registry.all)) names.add(n)
    for (const n of this.#counts.keys()) names.add(n)
    return [...names]
      .sort((a, b) => a.localeCompare(b))
      .map(name => ({ name, color: this.#colorOf(name, registry), count: this.#counts.get(name) ?? 0 }))
  }

  /** Every mark held by at least one saved bouquet. */
  #gathered(): Set<string> {
    const held = new Set<string>()
    for (const b of this.#bouquets) for (const m of b.marks) held.add(m)
    return held
  }

  /** The bouquets as rows, each mark carrying its own colour and count. */
  #bouquetRows(rows: readonly TagRow[]): BouquetRow[] {
    const byName = new Map(rows.map(r => [r.name, r]))
    const registry = this.#registry()
    return this.#bouquets.map(b => ({
      ...b,
      // A mark can sit in a bouquet without being on any tile yet (or without
      // being in the registry at all), so a missing row is synthesised at zero
      // rather than dropped — a bouquet must show everything it holds.
      rows: b.marks.map(name => byName.get(name)
        ?? { name, color: this.#colorOf(name, registry), count: 0 }),
    }))
  }

  #selectedNames(): string[] {
    return [...this.#selected].sort((a, b) => a.localeCompare(b))
  }

  #painting(): boolean { return this.#applyTags.length > 0 }

  /** Is the picked set exactly this bouquet? Marks the row that is loaded, and
   *  is why saving the same set twice under one name is a no-op rather than a
   *  duplicate — the bouquet's identity is its (sorted) contents.
   *
   *  NUL is the join, and it is load-bearing: a mark may contain a space (or a
   *  comma, or a slash), and any printable separator would make `['a b']` and
   *  `['a', 'b']` compare equal. The one character a mark cannot hold is the
   *  one that separates them. Same join in `#armBouquet`, for the same reason. */
  #loadedBouquet(): string | null {
    const picked = this.#selectedNames().join('\u0000')
    if (!picked) return null
    return this.#bouquets.find(b =>
      [...b.marks].sort((a, c) => a.localeCompare(c)).join('\u0000') === picked)?.name ?? null
  }

  #searching(): boolean { return this.#query.trim().length > 0 }

  /** A search reaches INSIDE the folded groups, so while one is running every
   *  surviving group stands open — its matches are the whole reason it is
   *  still listed. Clearing the search folds them back as they were. */
  #isNamespaceOpen(name: string): boolean {
    return this.#searching() || this.#openNamespaces.has(name)
  }

  #isBouquetOpen(name: string): boolean { return this.#openBouquets.has(name) }

  /** A bouquet's colour for the preview: its first mark's. The hive lights ONE
   *  colour at a time, and the bouquet's own row shows every swatch beside the
   *  name, so the set stays readable there. */
  #bouquetColor(bouquet: BouquetRow): string {
    return bouquet.rows[0]?.color ?? DEFAULT_MARK
  }

  #scopeIcon(): string {
    return (SCOPE_OPTIONS.find(o => o.id === this.#scope) ?? SCOPE_OPTIONS[0]).icon
  }

  /** The reach toggle's label. RUNTIME-BUILT KEY — a template literal whose
   *  stem ends in a hyphen; the three expansions are `tags.scope-local`,
   *  `tags.scope-children` and `tags.scope-global`. */
  #scopeLabel(): string {
    return t(`tags.scope-${this.#scope}`, REACH_HINT[this.#scope])
  }

  // ── the open / close verbs ───────────────────────────────────────────

  /** Closing the panel disarms any takeover — a staged removal or the bouquet
   *  in hand — since the panel is the review surface and leaving tile clicks
   *  hijacked would strand the participant.
   *
   *  Unconditional, exactly as the original: a `tags:view-close` that arrives
   *  while the panel is already shut still disarms and still announces, which
   *  is what the escape cascade and the controls-bar light read. */
  close(): void {
    if (this.#removalTag) this.cancelRemoval()
    if (this.#selected.size > 0 || this.#painting()) this.putDown()
    this.#endPreview()
    this.#hide()
    EffectBus.emit('tags:view-state', { open: false })
  }

  /** One level back per press: shut the naming field, then put the bouquet
   *  down, then drop an armed removal. False means nothing of ours was open,
   *  and the shell cascade carries on past us — clearing a selection before it
   *  ever closes this window. Reached from the session; there is no keydown
   *  listener here, and there was none in the Angular original either, so
   *  there is no `keydown.escape` modifier guard to reproduce. */
  dismiss(): boolean {
    if (this.#naming) { this.cancelNaming(); return true }
    if (this.#selected.size > 0 || this.#painting()) { this.putDown(); return true }
    if (this.#removalTag) { this.cancelRemoval(); return true }
    return false
  }

  /** DockedPanelElement's close verb — the × and the lane's eviction fallback
   *  both land here. This panel has a session, so the lane parks it instead;
   *  the route is kept because the base's contract requires it. */
  protected override closePanel(): void { this.close() }

  #show(): void {
    if (this.#visible) return
    this.#visible = true
    this.classList.add('open')
    this.setAttribute('aria-label', t('tags.viewer.title', 'Pheromones'))
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
    this.#topSlot = null
    this.#bottomSlot = null
    this.#titleEl = null
    this.#headingEl = null
    this.#totalEl = null
    this.#scopeBtn = null
    this.#scopeGlyph = null
    this.#closeEl = null
    this.#searchField = null
    this.#searchInput = null
    this.#searchClear = null
  }

  // ── chrome (built once per activation) ───────────────────────────────

  protected override renderPanel(): void {
    // Reach rides in the header as a THREE-STAGE TOGGLE, the same cycle the
    // feedback and files panels and the bottom strip use — one glyph that reads
    // out the current reach and steps to the next on click: page → children →
    // global, wrapping. What the panel IS lives on hover, not in a paragraph —
    // the heading's title carries the old intro line. Totally clean at rest.
    const header = document.createElement('header')
    header.className = 'tags-header'

    const heading = document.createElement('div')
    heading.className = 'tags-heading'
    const title = document.createElement('span')
    title.className = 'tags-title'
    const total = document.createElement('span')
    total.className = 'tags-total'
    heading.append(title, total)

    const scope = document.createElement('div')
    scope.className = 'tags-scope'
    const scopeBtn = document.createElement('button')
    scopeBtn.type = 'button'
    scopeBtn.className = 'tags-scope-btn active'
    scopeBtn.dataset['hcRow'] = 'scope'
    scopeBtn.addEventListener('click', () => this.cycleScope())
    const scopeGlyph = document.createElement('span')
    scopeGlyph.className = 'mat-sym'
    scopeBtn.appendChild(scopeGlyph)
    scope.appendChild(scopeBtn)

    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'tags-close'
    close.textContent = '×'
    close.dataset['hcRow'] = 'close'
    close.addEventListener('click', () => this.close())

    header.append(heading, scope, close)

    // `display: contents` — every section stays a flex item of the PANEL (the
    // list's `flex: 1 1 auto` is what makes it the scrolling half), while one
    // node still holds everything a rebuild replaces. Without it, a rebuild
    // that reached for the panel's own children would take the base's resize
    // grip and settings gear with it.
    const body = document.createElement('div')
    body.className = 'tags-body'
    const topSlot = document.createElement('div')
    topSlot.className = 'tags-slot'
    const bottomSlot = document.createElement('div')
    bottomSlot.className = 'tags-slot'
    body.append(topSlot, this.#buildSearchBlock(), bottomSlot)

    this.append(header, body)

    this.#titleEl = title
    this.#headingEl = heading
    this.#totalEl = total
    this.#scopeBtn = scopeBtn
    this.#scopeGlyph = scopeGlyph
    this.#closeEl = close
    this.#topSlot = topSlot
    this.#bottomSlot = bottomSlot

    this.#relabel()
    this.#render()
  }

  /** ONE field over the whole vocabulary — bouquets, loose keywords and
   *  namespace groups alike. Just the search; no type chips, no tag cloud.
   *  View state only: nothing here touches the hive.
   *
   *  Built ONCE and kept: `#query` changes on every keystroke, and an input
   *  rebuilt under the caret loses the caret. The clear button is built with it
   *  and removed / re-appended rather than recreated (Angular's `@if` detached
   *  the node; `display:none` would still answer `querySelector`). */
  #buildSearchBlock(): HTMLElement {
    const block = document.createElement('div')
    block.className = 'tags-search-block'

    const field = document.createElement('div')
    field.className = 'tags-search-field'

    const icon = document.createElement('span')
    icon.className = 'mat-sym tags-search-icon'
    icon.setAttribute('aria-hidden', 'true')
    icon.textContent = 'search'

    const input = document.createElement('input')
    input.className = 'tags-search-input'
    input.type = 'text'
    input.autocomplete = 'off'
    input.dataset['hcRow'] = 'search'
    input.addEventListener('input', () => {
      this.#query = input.value
      this.#syncSearch()
      this.#render()
    })

    const clear = document.createElement('button')
    clear.className = 'tags-search-clear mat-sym'
    clear.type = 'button'
    clear.textContent = 'close'
    clear.dataset['hcRow'] = 'search-clear'
    clear.addEventListener('click', () => {
      this.#query = ''
      this.#syncSearch()
      this.#render()
    })

    field.append(icon, input)
    block.appendChild(field)

    this.#searchField = field
    this.#searchInput = input
    this.#searchClear = clear
    return block
  }

  /** Keep the kept field in step with `#query` — the value only when it has
   *  genuinely diverged (writing it back on every keystroke would move the
   *  caret to the end), and the clear button in or out of the DOM. */
  #syncSearch(): void {
    const input = this.#searchInput
    if (input && input.value !== this.#query) input.value = this.#query
    const clear = this.#searchClear
    const field = this.#searchField
    if (!clear || !field) return
    if (this.#searching()) { if (clear.parentNode !== field) field.appendChild(clear) }
    else clear.remove()
  }

  /** Re-resolve the strings written ONCE per activation — the ones a body
   *  rebuild never touches. The body's own strings come back through
   *  `#render`. */
  #relabel(): void {
    const title = t('tags.viewer.title', 'Pheromones')
    this.setAttribute('aria-label', title)
    if (this.#titleEl) this.#titleEl.textContent = title
    this.#headingEl?.setAttribute('title', t('tags.intro',
      'Pheromones mark tiles. Filter by one to see every tile carrying it, anywhere in reach.'))
    this.#closeEl?.setAttribute('aria-label', t('tags.close', 'close'))
    const search = t('tags.search.placeholder', 'search pheromones')
    this.#searchInput?.setAttribute('placeholder', search)
    this.#searchInput?.setAttribute('aria-label', search)
    const clear = t('tags.search.clear', 'clear the search')
    this.#searchClear?.setAttribute('aria-label', clear)
    this.#searchClear?.setAttribute('title', clear)
    this.#syncScopeButton()
  }

  #syncScopeButton(): void {
    if (this.#scopeGlyph) this.#scopeGlyph.textContent = this.#scopeIcon()
    const label = this.#scopeLabel()
    this.#scopeBtn?.setAttribute('title', label)
    this.#scopeBtn?.setAttribute('aria-label', label)
  }

  // ── rendering (rebuild on change — the house pattern, no reconciler) ──

  #render(): void {
    const top = this.#topSlot
    const bottom = this.#bottomSlot
    if (!top || !bottom) return

    // WHERE THE PARTICIPANT WAS. Angular kept every list node for the panel's
    // whole life, so a `render:tags` (or a `/language` switch) landing while
    // you scrolled was invisible. Rebuild-on-change still owes that: measured
    // before the teardown, applied after the new nodes are in the document
    // (scrollTop on a detached node does not stick), and focus restored by a
    // key this view stamps rather than by a class — three buttons in one row
    // share their spellings, and restoring by class would put the ring on the
    // wrong verb.
    const scrolls = this.#scrollSnapshot()
    const focus = focusSnapshot(this)

    const rows = this.#rows()
    const bouquets = this.#bouquetRows(rows)

    this.#renderHeaderState(rows)
    this.#syncSearch()

    top.replaceChildren(...this.#renderTop())
    bottom.replaceChildren(...this.#renderBottom(rows, bouquets))

    this.#restoreScroll(scrolls)
    restoreFocus(this, focus)
  }

  #renderHeaderState(rows: readonly TagRow[]): void {
    if (this.#totalEl) this.#totalEl.textContent = String(rows.length)
    this.#syncScopeButton()
  }

  /** Every scroller in the body, by the key it stamps on itself. */
  #scrollSnapshot(): Map<string, number> {
    const out = new Map<string, number>()
    for (const el of this.querySelectorAll<HTMLElement>('[data-hc-scroll]')) {
      const key = el.dataset['hcScroll']
      if (key && el.scrollTop > 0) out.set(key, el.scrollTop)
    }
    return out
  }

  #restoreScroll(snapshot: ReadonlyMap<string, number>): void {
    if (snapshot.size === 0) return
    for (const el of this.querySelectorAll<HTMLElement>('[data-hc-scroll]')) {
      const key = el.dataset['hcScroll']
      const top = key ? snapshot.get(key) : undefined
      if (top !== undefined) el.scrollTop = top
    }
  }

  /** Above the search field: the armed removal, then the bouquet in hand. */
  #renderTop(): HTMLElement[] {
    const parts: HTMLElement[] = []
    const tag = this.#removalTag
    if (tag) parts.push(this.#renderRemoval(tag))
    if (this.#selected.size > 0) parts.push(this.#renderInHand())
    return parts
  }

  /** Below it: what is filtered, the bouquets, and the vocabulary. */
  #renderBottom(rows: readonly TagRow[], bouquets: readonly BouquetRow[]): HTMLElement[] {
    const parts: HTMLElement[] = []
    parts.push(this.#renderActive())

    const visibleBouquets = bouquets.filter(b => bouquetMatchesQuery(b.name, b.marks, this.#query))
    if (visibleBouquets.length > 0) parts.push(this.#renderBouquets(visibleBouquets))

    // POLARITY IS LOAD-BEARING: `rows.length === 0`, exactly as the template
    // wrote it — never a negated guard, which is also false for a NaN and would
    // fall straight through into painting the lists over no vocabulary at all.
    if (rows.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'tags-empty'
      empty.textContent = t('tags.empty', 'No tags yet — add one with a cell:tag command or /keyword.')
      parts.push(empty)
      return parts
    }

    const looseRows = filterRowsByQuery(looseMarks(rows, this.#gathered()), this.#query)
    const namespaceGroups: NamespaceGroup[] =
      filterNamespaceGroups(namespaceGroupsOf(rows), this.#query)

    if (looseRows.length > 0) {
      // Plain keywords in no bouquet. Where a newly-typed keyword lands, and
      // what is left to gather. RUNTIME-BUILT KEY, the ternary form: either
      // `tags.list.loose.title` or `tags.list.title`.
      const heading = document.createElement('h3')
      heading.className = 'tags-section-title'
      heading.textContent = this.#bouquets.length > 0
        ? t('tags.list.loose.title', 'Not in a bouquet')
        : t('tags.list.title', 'Your pheromones')
      const list = document.createElement('ul')
      list.className = 'tags-list'
      list.dataset['hcScroll'] = 'loose'
      for (const row of looseRows) list.appendChild(this.#renderTagRow(row, 'loose'))
      parts.push(heading, list)
    }

    if (namespaceGroups.length > 0) parts.push(this.#renderNamespaces(namespaceGroups))

    // The search left nothing — say so, or the panel reads as having lost the
    // vocabulary. The original's `nothingVisible()` in full: there IS a
    // vocabulary, and all three parts came back empty.
    if (rows.length > 0
      && visibleBouquets.length === 0
      && looseRows.length === 0
      && namespaceGroups.length === 0) {
      const none = document.createElement('p')
      none.className = 'tags-empty'
      none.textContent = t('tags.search.none', 'Nothing matches — clear the search.')
      parts.push(none)
    }

    return parts
  }

  // ── armed removal: the review surface ────────────────────────────────
  //
  // The hive is filtered to this keyword; every tile you click joins the list
  // below and paints struck-through. Nothing is written until Remove.

  #renderRemoval(tag: string): HTMLElement {
    const section = document.createElement('section')
    section.className = 'tags-removal-section'

    const title = document.createElement('h3')
    title.className = 'tags-section-title removal-title'
    title.textContent = t('tags.removal.title', 'Removing {tag}', { tag })

    const hint = document.createElement('p')
    hint.className = 'removal-hint'
    hint.textContent = t('tags.removal.hint',
      'Every tile carrying it is on screen. Click the ones to take it off — they mark as you go. Nothing changes until you press Remove.')

    section.append(title, hint)

    const count = this.#removalCells.length
    if (count === 0) {
      const empty = document.createElement('p')
      empty.className = 'removal-empty'
      empty.textContent = t('tags.removal.empty', 'No tiles picked yet.')
      section.appendChild(empty)
    } else {
      const list = document.createElement('ul')
      list.className = 'removal-list'
      list.dataset['hcScroll'] = 'removal'
      for (const cell of this.#removalCells) {
        const li = document.createElement('li')
        li.className = 'removal-cell'
        const icon = document.createElement('span')
        icon.className = 'mat-sym removal-cell-icon'
        icon.textContent = 'close'
        const name = document.createElement('span')
        name.className = 'removal-cell-name'
        name.textContent = cell
        li.append(icon, name)
        list.appendChild(li)
      }
      section.appendChild(list)
    }

    const actions = document.createElement('div')
    actions.className = 'removal-actions'

    const commit = document.createElement('button')
    commit.className = 'removal-commit'
    commit.type = 'button'
    commit.disabled = count === 0
    commit.dataset['hcRow'] = 'removal-commit'
    commit.textContent = removalCommitLabel(count)
    commit.addEventListener('click', () => this.commitRemoval())

    const all = document.createElement('button')
    all.className = 'removal-all'
    all.type = 'button'
    all.dataset['hcRow'] = 'removal-all'
    all.textContent = t('tags.removal.all', 'All shown')
    all.addEventListener('click', () => this.stageAllShown())

    const cancel = document.createElement('button')
    cancel.className = 'removal-cancel'
    cancel.type = 'button'
    cancel.dataset['hcRow'] = 'removal-cancel'
    cancel.textContent = t('tags.removal.cancel', 'Cancel')
    cancel.addEventListener('click', () => this.cancelRemoval())

    actions.append(commit, all, cancel)

    const forget = document.createElement('button')
    forget.className = 'removal-forget'
    forget.type = 'button'
    forget.dataset['hcRow'] = 'removal-forget'
    forget.textContent = t('tags.removal.forget', 'Forget this pheromone entirely')
    forget.addEventListener('click', () => this.forgetTag(tag))

    section.append(actions, forget)
    return section
  }

  // ── the bouquet in hand ──────────────────────────────────────────────
  //
  // Gathering (＋ on any row, or a bouquet click) IS arming: the hive shades
  // every tile missing part of the set, and clicking a shaded tile scents it at
  // once — a real write, no staging, no Done. This strip is the readout: what
  // is held, its identity, the way to name it, and the way to put it down.

  #renderInHand(): HTMLElement {
    const section = document.createElement('section')
    section.className = 'tags-inhand-section'

    // No messaging: what the shade means lives on hover, not in a paragraph.
    // The hive itself is the explanation.
    const line = document.createElement('p')
    line.className = 'bouquet-in-hand'
    line.setAttribute('title', t('tags.inhand.hint',
      'Shaded tiles are missing part of this bouquet — click one to scent it. Lit tiles already carry it all.'))
    const flower = document.createElement('span')
    flower.className = 'mat-sym'
    flower.setAttribute('aria-hidden', 'true')
    flower.textContent = 'local_florist'
    const label = document.createElement('span')
    label.className = 'bouquet-in-hand-label'
    const loaded = this.#loadedBouquet()
    label.textContent = loaded ?? t('tags.bouquet.unnamed', 'bouquet in hand')
    line.append(flower, label)
    // The identity of the bouquet in hand, shortened. Shown because it is the
    // proof that a bouquet exists before it has a name — and because two people
    // who gather the same marks will see the same one.
    const shortSig = this.#bouquetSig?.slice(0, 8) ?? ''
    if (shortSig) {
      const sig = document.createElement('span')
      sig.className = 'bouquet-in-hand-sig'
      sig.textContent = shortSig
      line.appendChild(sig)
    }
    section.appendChild(line)

    // The picked set as swatch+name pairs — a pheromone reads the same here as
    // in the list row, the drag ghost and the on-tile card: square, then label.
    const picked = document.createElement('ul')
    picked.className = 'painter-picked'
    const registry = this.#registry()
    for (const name of this.#selectedNames()) {
      const color = this.#colorOf(name, registry)
      const chip = document.createElement('li')
      chip.className = 'painter-chip'
      chip.style.setProperty('--mark-color', color)
      chip.dataset['hcPreview'] = name
      if (this.#isPreviewing(name)) chip.classList.add('previewing')
      chip.addEventListener('pointerenter', (e) => this.#preview(e as PointerEvent, [name], color))
      chip.addEventListener('pointerleave', () => this.#endPreview())

      const swatch = document.createElement('span')
      swatch.className = 'painter-chip-swatch'
      swatch.setAttribute('aria-hidden', 'true')
      swatch.style.background = color

      const chipName = document.createElement('span')
      chipName.className = 'painter-chip-name'
      chipName.textContent = name

      const drop = document.createElement('button')
      drop.className = 'painter-chip-drop'
      drop.type = 'button'
      drop.textContent = '×'
      drop.dataset['hcRow'] = `chip-drop/${name}`
      drop.setAttribute('aria-label', t('tags.painter.deselect', 'take {tag} out of the bouquet', { tag: name }))
      drop.addEventListener('click', () => this.togglePheromone(name))

      chip.append(swatch, chipName, drop)
      picked.appendChild(chip)
    }
    section.appendChild(picked)

    // Name the gathered set and it survives the session: a BOUQUET.
    if (!this.#naming) {
      const open = document.createElement('button')
      open.className = 'bouquet-save-open'
      open.type = 'button'
      open.dataset['hcRow'] = 'bouquet-save-open'
      open.setAttribute('title', t('tags.bouquet.save.hint',
        'a name makes it easy to pick up again — it is a bouquet either way'))
      const glyph = document.createElement('span')
      glyph.className = 'mat-sym'
      glyph.setAttribute('aria-hidden', 'true')
      glyph.textContent = 'bookmark_add'
      open.append(glyph, document.createTextNode(t('tags.bouquet.save', 'Name this bouquet')))
      open.addEventListener('click', () => this.beginNaming())
      section.appendChild(open)
    } else {
      const form = document.createElement('form')
      form.className = 'bouquet-name-form'

      const input = document.createElement('input')
      input.className = 'bouquet-name-input'
      input.type = 'text'
      input.autocomplete = 'off'
      // Seed from the DRAFT, not from the loaded name: a rebuild landing
      // mid-word must not overwrite what the participant is typing. The draft
      // starts as the loaded name when the gesture opens.
      input.value = this.#nameDraft
      input.addEventListener('input', () => { this.#nameDraft = input.value })
      input.dataset['hcRow'] = 'bouquet-name'
      const placeholder = t('tags.bouquet.name.placeholder', 'name this bouquet')
      input.setAttribute('placeholder', placeholder)
      input.setAttribute('aria-label', placeholder)

      const commit = document.createElement('button')
      commit.className = 'bouquet-name-commit'
      commit.type = 'submit'
      commit.dataset['hcRow'] = 'bouquet-name-commit'
      commit.textContent = t('tags.bouquet.name.commit', 'Save')

      const cancel = document.createElement('button')
      cancel.className = 'bouquet-name-cancel'
      cancel.type = 'button'
      cancel.dataset['hcRow'] = 'bouquet-name-cancel'
      cancel.textContent = t('tags.bouquet.name.cancel', 'Cancel')
      cancel.addEventListener('click', () => this.cancelNaming())

      form.addEventListener('submit', (event) => {
        event.preventDefault()
        void this.saveBouquet(this.#nameDraft)
        input.value = ''
      })

      form.append(input, commit, cancel)
      section.appendChild(form)
    }

    // THE PLACE BUTTON: with tiles selected on the canvas, one press places the
    // bouquet on the whole selection in one transaction. Without a selection
    // there is no button: you drag onto the screen, or click the shaded tiles.
    if (this.#painting() && this.#canvasSelection.length > 0) {
      const place = document.createElement('button')
      place.className = 'painter-stage-selection'
      place.type = 'button'
      place.dataset['hcRow'] = 'place-selection'
      const glyph = document.createElement('span')
      glyph.className = 'mat-sym'
      glyph.setAttribute('aria-hidden', 'true')
      glyph.textContent = 'select_all'
      const text = document.createElement('span')
      text.textContent = selectionPlaceLabel(this.#canvasSelection.length)
      place.append(glyph, text)
      place.addEventListener('click', () => this.applyBouquetToSelection())
      section.appendChild(place)
    }

    const actions = document.createElement('div')
    actions.className = 'painter-actions'
    const putDown = document.createElement('button')
    putDown.className = 'painter-close'
    putDown.type = 'button'
    putDown.dataset['hcRow'] = 'put-down'
    putDown.setAttribute('title', t('tags.inhand.putdown.hint',
      'put the bouquet down — clicks walk the hive again'))
    putDown.textContent = t('tags.inhand.putdown', 'Put down')
    putDown.addEventListener('click', () => this.putDown())
    actions.appendChild(putDown)
    section.appendChild(actions)

    return section
  }

  // ── what is filtered right now, and the way out of it ────────────────

  #renderActive(): HTMLElement {
    const section = document.createElement('section')
    section.className = 'tags-active-section'

    if (this.#active.size > 0) {
      const line = document.createElement('div')
      line.className = 'active-line'
      const label = document.createElement('span')
      label.className = 'active-label'
      label.textContent = t('tags.active.label', 'Filtering by')
      line.appendChild(label)
      for (const name of [...this.#active].sort((a, b) => a.localeCompare(b))) {
        const chip = document.createElement('span')
        chip.className = 'active-chip'
        chip.textContent = name
        line.appendChild(chip)
      }
      const clear = document.createElement('button')
      clear.className = 'tags-clear'
      clear.type = 'button'
      clear.dataset['hcRow'] = 'clear-filter'
      clear.textContent = t('tags.clear', 'Clear')
      clear.addEventListener('click', () => this.clearFilter())
      section.append(line, clear)
    } else {
      const none = document.createElement('p')
      none.className = 'active-none'
      none.textContent = t('tags.active.none', 'No filter — every tile is showing.')
      section.appendChild(none)
    }
    return section
  }

  // ── saved bouquets ───────────────────────────────────────────────────
  //
  // A bouquet is just another pheromone to the gestures: clicking one takes it
  // in hand (the hive shades for the whole set) and dragging it drops the whole
  // set on a tile. The row reads inline — name: mark mark mark — wrapping when
  // it must. The chevron opens it instead, and what is inside are ordinary
  // rows: a bouquet organises the vocabulary, it does not hold a lesser copy
  // of it.

  #renderBouquets(bouquets: readonly BouquetRow[]): HTMLElement {
    const section = document.createElement('section')
    section.className = 'tags-bouquets-section'

    // What a bouquet is lives on hover — the heading's and each row's title —
    // never in a paragraph.
    const heading = document.createElement('h3')
    heading.className = 'tags-section-title bouquet-title'
    heading.setAttribute('title', t('tags.bouquet.hint',
      'a named group of pheromones — click one to take it in hand, click it again to put it down, or drag it onto a tile to scent it'))
    heading.textContent = t('tags.bouquet.title', 'Bouquets')

    const list = document.createElement('ul')
    list.className = 'bouquet-list'
    list.dataset['hcScroll'] = 'bouquets'

    const loaded = this.#loadedBouquet()

    for (const bouquet of bouquets) {
      const open = this.#isBouquetOpen(bouquet.name)
      const color = this.#bouquetColor(bouquet)

      const row = document.createElement('li')
      row.className = 'bouquet-row'
      if (loaded === bouquet.name) row.classList.add('loaded')
      if (open) row.classList.add('open')

      const head = document.createElement('div')
      head.className = 'bouquet-head'
      head.style.setProperty('--mark-color', color)
      // The head lights for its FIRST mark — the one whose colour the hive is
      // wearing — exactly as the template's `isPreviewing(bouquet.marks[0])`.
      if (bouquet.marks[0]) head.dataset['hcPreview'] = bouquet.marks[0]
      if (this.#isPreviewing(bouquet.marks[0])) head.classList.add('previewing')
      head.addEventListener('pointerenter', (e) => this.#preview(e as PointerEvent, bouquet.marks, color))
      head.addEventListener('pointerleave', () => this.#endPreview())

      // Opening a bouquet is NOT loading it — the chevron is its own target so
      // that reading what is inside never arms the brush by accident. RUNTIME-
      // BUILT KEY, the ternary form: `tags.bouquet.collapse` when open,
      // `tags.bouquet.expand` when shut.
      const disclosure = document.createElement('button')
      disclosure.className = 'bouquet-open'
      disclosure.type = 'button'
      disclosure.dataset['hcRow'] = `bouquet-open/${bouquet.name}`
      disclosure.setAttribute('aria-expanded', String(open))
      const disclosureLabel = open
        ? t('tags.bouquet.collapse', 'fold {name} back up', { name: bouquet.name })
        : t('tags.bouquet.expand', 'show the pheromones in {name}', { name: bouquet.name })
      disclosure.setAttribute('aria-label', disclosureLabel)
      disclosure.setAttribute('title', disclosureLabel)
      const chevron = document.createElement('span')
      chevron.className = 'mat-sym'
      chevron.setAttribute('aria-hidden', 'true')
      chevron.textContent = open ? 'expand_more' : 'chevron_right'
      disclosure.appendChild(chevron)
      disclosure.addEventListener('click', (event) => this.toggleBouquetOpen(bouquet.name, event))

      const load = document.createElement('button')
      load.className = 'bouquet-load'
      load.type = 'button'
      load.draggable = false
      load.dataset['hcRow'] = `bouquet-load/${bouquet.name}`
      load.setAttribute('aria-pressed', String(loaded === bouquet.name))
      load.setAttribute('title', t('tags.bouquet.load',
        'take the {name} bouquet in hand · drag it onto a tile to scent the whole set',
        { name: bouquet.name }))
      load.addEventListener('dragstart', (event) => event.preventDefault())
      load.addEventListener('pointerdown', (event) => this.#onBouquetPointerDown(event, bouquet))
      load.addEventListener('click', () => this.loadBouquet(bouquet))

      const name = document.createElement('span')
      name.className = 'bouquet-name'
      name.textContent = bouquet.name
      load.appendChild(name)
      for (const chip of bouquet.rows) {
        const mark = document.createElement('span')
        mark.className = 'bouquet-mark'
        mark.setAttribute('title', chip.name)
        const swatch = document.createElement('span')
        swatch.className = 'bouquet-mark-swatch'
        swatch.setAttribute('aria-hidden', 'true')
        swatch.style.background = chip.color
        const markName = document.createElement('span')
        markName.className = 'bouquet-mark-name'
        markName.textContent = chip.name
        mark.append(swatch, markName)
        load.appendChild(mark)
      }

      const forget = document.createElement('button')
      forget.className = 'bouquet-forget'
      forget.type = 'button'
      forget.textContent = '×'
      forget.dataset['hcRow'] = `bouquet-forget/${bouquet.name}`
      const forgetLabel = t('tags.bouquet.forget', 'forget the {name} bouquet', { name: bouquet.name })
      forget.setAttribute('aria-label', forgetLabel)
      forget.setAttribute('title', forgetLabel)
      forget.addEventListener('click', (event) => { void this.forgetBouquet(bouquet.name, event) })

      head.append(disclosure, load, forget)
      row.appendChild(head)

      if (open) {
        const contents = document.createElement('ul')
        contents.className = 'tags-list bouquet-contents'
        for (const inner of bouquet.rows) {
          contents.appendChild(this.#renderTagRow(inner, `bq/${bouquet.name}`))
        }
        row.appendChild(contents)
      }

      list.appendChild(row)
    }

    section.append(heading, list)
    return section
  }

  // ── namespaces — marks that say what a tile IS ───────────────────────
  //
  // Declared by behaviours, grouped by their own prefix, folded shut — nobody
  // curates these, and mixing them into the keywords you chose is what made the
  // list unreadable. A running search holds the surviving groups open: their
  // matches are the whole reason they are still listed.

  #renderNamespaces(groups: readonly NamespaceGroup[]): HTMLElement {
    const section = document.createElement('section')
    section.className = 'tags-namespaces-section'

    const heading = document.createElement('h3')
    heading.className = 'tags-section-title'
    heading.textContent = t('tags.list.namespaces.title', 'What tiles are')

    const hint = document.createElement('p')
    hint.className = 'namespace-hint'
    hint.textContent = t('tags.list.namespaces.hint',
      'Marks behaviours put on a tile to say what it is. They group by their own name — you do not gather these.')

    section.append(heading, hint)

    for (const group of groups) {
      const open = this.#isNamespaceOpen(group.name)
      const wrap = document.createElement('div')
      wrap.className = 'namespace-group'
      if (open) wrap.classList.add('open')

      const head = document.createElement('button')
      head.className = 'namespace-head'
      head.type = 'button'
      head.dataset['hcRow'] = `ns-head/${group.name}`
      head.setAttribute('aria-expanded', String(open))
      head.setAttribute('title', t('tags.namespace.toggle', 'show the {name} marks', { name: group.name }))
      head.addEventListener('click', () => this.toggleNamespaceOpen(group.name))

      const chevron = document.createElement('span')
      chevron.className = 'mat-sym'
      chevron.setAttribute('aria-hidden', 'true')
      chevron.textContent = open ? 'expand_more' : 'chevron_right'
      const name = document.createElement('span')
      name.className = 'namespace-name'
      name.textContent = group.name
      const count = document.createElement('span')
      count.className = 'namespace-count'
      count.textContent = String(group.rows.length)
      head.append(chevron, name, count)
      wrap.appendChild(head)

      if (open) {
        const contents = document.createElement('ul')
        contents.className = 'tags-list namespace-contents'
        for (const row of group.rows) {
          contents.appendChild(this.#renderTagRow(row, `ns/${group.name}`))
        }
        wrap.appendChild(contents)
      }

      section.appendChild(wrap)
    }

    return section
  }

  // ── ONE row definition for all three sections ────────────────────────
  //
  // A mark offers the same controls wherever it is listed — the grouping
  // decides where you find it, never what you can do with it.
  //
  // Pointing at a row asks the hive which tiles carry this mark, and the hive
  // answers on itself. The row lights in the SAME colour, so the panel and the
  // hive read as one gesture rather than two surfaces that happen to agree.
  // Enter/leave on the whole row (swatch, name, count and both verbs) — every
  // part of a mark asks the same question.
  //
  // `scope` is the row's SECTION, and it is what makes the focus key unique:
  // the same mark is listed loose, inside a bouquet and inside a namespace, and
  // three buttons named `<name>/apply` would put the focus ring back on
  // whichever happened to render first.

  #renderTagRow(row: TagRow, scope: string): HTMLLIElement {
    const li = document.createElement('li')
    li.className = 'tags-row'
    li.style.setProperty('--mark-color', row.color)
    if (this.#active.has(row.name)) li.classList.add('filtered')
    if (this.#removalTag === row.name) li.classList.add('staging')
    if (this.#selected.has(row.name)) li.classList.add('picked')
    if (this.#applyTags.includes(row.name)) li.classList.add('painting')
    li.dataset['hcPreview'] = row.name
    if (this.#isPreviewing(row.name)) li.classList.add('previewing')
    li.addEventListener('pointerenter', (e) => this.#preview(e as PointerEvent, [row.name], row.color))
    li.addEventListener('pointerleave', () => this.#endPreview())

    const swatch = document.createElement('label')
    swatch.className = 'tag-swatch'
    swatch.style.background = row.color
    swatch.setAttribute('title', t('tags.recolor', 'recolor tag'))
    const picker = document.createElement('input')
    picker.type = 'color'
    picker.value = row.color
    picker.dataset['hcRow'] = `${scope}/${row.name}/swatch`
    picker.addEventListener('change', (event) => this.recolor(row.name, event))
    swatch.appendChild(picker)

    const name = document.createElement('button')
    name.className = 'tag-name'
    name.type = 'button'
    name.draggable = false
    name.textContent = row.name
    name.dataset['hcRow'] = `${scope}/${row.name}/name`
    name.setAttribute('aria-pressed', String(this.#active.has(row.name)))
    name.setAttribute('title', t('tags.drag.hint', 'drag onto a tile to leave it there · click to filter'))
    name.addEventListener('dragstart', (event) => event.preventDefault())
    name.addEventListener('pointerdown', (event) => this.#onRowPointerDown(event, row))
    name.addEventListener('click', () => this.onRowClick(row.name))

    const count = document.createElement('span')
    count.className = 'tag-count'
    count.setAttribute('title', t('tags.count.hint', 'tiles with this tag on this page'))
    count.textContent = String(row.count)

    // Gathers this keyword into the bouquet in hand. A tick means it is held;
    // clicking again releases it. RUNTIME-BUILT KEY, the ternary form:
    // `tags.painter.deselect.hint` when picked, `tags.apply.hint.short` when not.
    const picked = this.#selected.has(row.name)
    const applying = this.#applyTags.includes(row.name)
    const apply = document.createElement('button')
    apply.className = 'tag-apply'
    apply.type = 'button'
    if (applying) apply.classList.add('armed')
    if (picked) apply.classList.add('picked')
    apply.textContent = picked ? '✓' : '＋'
    apply.dataset['hcRow'] = `${scope}/${row.name}/apply`
    apply.setAttribute('aria-pressed', String(picked))
    apply.setAttribute('aria-label', t('tags.apply', 'scent tiles with {tag}', { tag: row.name }))
    apply.setAttribute('title', picked
      ? t('tags.painter.deselect.hint', 'take this pheromone out of the bouquet')
      : t('tags.apply.hint.short', 'gather this pheromone into the bouquet'))
    apply.addEventListener('click', () => this.togglePheromone(row.name))

    // Arms the staged removal; clicking it again commits whatever is staged,
    // which is why it turns into a tick. RUNTIME-BUILT KEY, the ternary form:
    // `tags.removal.commit.hint` when armed, `tags.remove.hint` when not.
    const staging = this.#removalTag === row.name
    const remove = document.createElement('button')
    remove.className = 'tag-remove'
    remove.type = 'button'
    if (staging) remove.classList.add('armed')
    remove.textContent = staging ? '✓' : '×'
    remove.dataset['hcRow'] = `${scope}/${row.name}/remove`
    remove.setAttribute('aria-label', t('tags.remove', 'remove tag {tag}', { tag: row.name }))
    remove.setAttribute('title', staging
      ? t('tags.removal.commit.hint', 'apply the staged removals')
      : t('tags.remove.hint', 'take this pheromone off tiles'))
    remove.addEventListener('click', () => this.beginRemoval(row.name))

    li.append(swatch, name, count, apply, remove)
    return li
  }

  // ── Point at a mark, see its tiles ───────────────────────────────────
  //
  // Every pheromone listed here is the same question — WHICH TILES CARRY THIS?
  // — and this panel cannot answer it: the answer is the hive. So pointing at
  // one asks the hive, and the hive answers on itself (show-cell `tags:preview`
  // → the carriers light in the mark's own colour, the rest of the page recedes
  // behind them). Nothing is written, armed or staged; moving off puts the page
  // back exactly as it was.

  #isPreviewing(name: string | undefined): boolean {
    return name !== undefined && this.#previewing.includes(name)
  }

  /** Ask for one mark (a row) or a whole set (a bouquet — every mark it holds
   *  at once). The hive treats both the same, which is what makes a bouquet
   *  legible: point at it and see everything any of its marks reaches. */
  #preview(event: PointerEvent, marks: readonly string[], color: string): void {
    // A MOUSE hovers; a finger does not. Touch fires pointerenter on tap and
    // never a matching pointerleave, so on a phone the tap that filters (or
    // paints) would light the hive and leave it lit with no way back.
    if (event.pointerType !== 'mouse') return
    const next = marks.filter(Boolean)
    const now = this.#previewing
    if (next.length === now.length && next.every((m, i) => m === now[i])) return
    this.#previewing = next
    EffectBus.emit('tags:preview', { marks: next, color })
    this.#applyPreviewClasses()
  }

  #endPreview(): void {
    if (this.#previewing.length === 0) return
    this.#previewing = []
    EffectBus.emit('tags:preview', { marks: [] })
    this.#applyPreviewClasses()
  }

  /** The panel's half of the answer, applied WITHOUT a rebuild.
   *
   *  This is the one update in the panel that must not go through `#render()`,
   *  and the reason is the gesture itself: the trigger is `pointerenter` on the
   *  very node a rebuild would destroy, and destroying a hovered node makes the
   *  browser fire the matching `pointerleave` — which would call `#endPreview`,
   *  rebuild again, and leave the cursor sitting over a row that flickers on
   *  and off. Nothing here is state the DOM owns: `#previewing` is the truth,
   *  the class is a reading of it, and toggling a class on a live node is not a
   *  reconciler. A full render paints the same classes from the same field
   *  (`#isPreviewing`), so the two paths cannot disagree. */
  #applyPreviewClasses(): void {
    for (const el of this.querySelectorAll<HTMLElement>('[data-hc-preview]')) {
      const key = el.dataset['hcPreview']
      el.classList.toggle('previewing', !!key && this.#previewing.includes(key))
    }
  }

  // ── drag a pheromone (or a bouquet) onto a tile ──────────────────────
  //
  // The direct-manipulation path: pick the pheromone up out of the list and
  // drop it on the tile you mean. A bouquet is just another pheromone to this
  // gesture — dragging its row carries every mark it holds, and the drop lands
  // the whole set. Pointer events (not HTML5 drag-and-drop), because the drop
  // target is a WebGL canvas with no DOM nodes to land on — the tile under the
  // cursor is whatever `tile:hover` last reported, and a drop onto a tile's own
  // pheromone card resolves via `data-pheromone-tile`.
  //
  // A press only becomes a drag past DRAG_THRESHOLD px, so clicking the name
  // still filters (or loads the bouquet); the trailing click is swallowed when
  // a drag did happen.

  #onRowPointerDown(event: PointerEvent, row: TagRow): void {
    this.#beginDragCandidate(event, [row.name], row.name, row.color)
  }

  /** A bouquet drags exactly like a single pheromone — the whole set rides the
   *  ghost and the drop lands all of it. */
  #onBouquetPointerDown(event: PointerEvent, bouquet: BouquetRow): void {
    this.#beginDragCandidate(event, bouquet.marks, bouquet.name, this.#bouquetColor(bouquet))
  }

  #beginDragCandidate(event: PointerEvent, marks: readonly string[], name: string, color: string): void {
    if (event.button !== 0) return
    // Drag-to-scent is a POINTER affordance and is switched off on phones.
    // Leaving it armed here would be actively harmful: on touch, dragging a row
    // IS the scroll gesture, so scrolling this list past the drag threshold
    // would drop a pheromone onto whatever tile sits underneath.
    if (this.#phone) return
    const clean = marks.filter(Boolean)
    if (clean.length === 0) return
    this.#pending = { marks: [...clean], name, color, x: event.clientX, y: event.clientY }
    document.addEventListener('pointermove', this.#onDragMove)
    document.addEventListener('pointerup', this.#onDragUp)
    // If the browser takes the gesture (a native drag, a touch pan), we get a
    // pointercancel and NEVER a pointerup — without this the ghost would hang
    // on screen and the listeners would leak until the next drag.
    document.addEventListener('pointercancel', this.#onDragCancel)
  }

  #onDragCancel = (): void => {
    this.#pending = null
    this.#detachDrag()
    if (this.#dragging) {
      this.#dragging = null
      this.#removeGhost()
      EffectBus.emit('drop:dragging', { active: false })
    }
  }

  #detachDrag(): void {
    document.removeEventListener('pointermove', this.#onDragMove)
    document.removeEventListener('pointerup', this.#onDragUp)
    document.removeEventListener('pointercancel', this.#onDragCancel)
  }

  #onDragMove = (event: PointerEvent): void => {
    const p = this.#pending
    if (!p) return
    if (!this.#dragging) {
      if (Math.hypot(event.clientX - p.x, event.clientY - p.y) < DRAG_THRESHOLD) return
      // Promote to a drag. `drop:dragging` puts the tile overlay into its bare
      // drop-target mode (icons hidden) — the same mode file drops use — so the
      // hive reads as a surface to land on rather than a menu. The MARKS ride
      // along: show-cell shades every tile that doesn't already wear the whole
      // dragged set for as long as the drag lasts, so where the drop would DO
      // something is visible before anything is released.
      this.#dragging = { name: p.name, color: p.color, count: p.marks.length }
      this.#buildGhost(this.#dragging)
      EffectBus.emit('drop:dragging', { active: true, marks: [...p.marks], color: p.color })
    }
    // A position stream mutates the live node — no rebuild per pointermove.
    this.#moveGhost(event.clientX, event.clientY)
  }

  #onDragUp = (event: PointerEvent): void => {
    const p = this.#pending
    const wasDragging = this.#dragging !== null
    this.#pending = null
    this.#detachDrag()
    if (!wasDragging || !p) return

    this.#dragging = null
    this.#removeGhost()
    EffectBus.emit('drop:dragging', { active: false })
    this.#swallowClick = true

    // Where did it land? A tile's own pheromone card wins — it names its tile
    // explicitly. Otherwise the hive, and we send the RELEASE POINT rather than
    // the last hovered tile: the drag begins on this panel, and crossing chrome
    // makes the overlay broadcast `tile:hover {label:null}`, so the remembered
    // label is routinely stale-null at exactly the moment we need it. The drone
    // resolves the point against the hex map (TileOverlayDrone.labelAtClient).
    const el = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null

    // A NOTE landed under the pointer — the notes reader advertises each of its
    // rows with `data-pheromone-note`. Checked FIRST because the reader floats
    // over the hive: falling through to the hex map would put the keyword on
    // whatever tile happens to sit behind the card. Notes carry their own `tags`
    // slot, so this is a different write, not a tile one. A bouquet lands mark
    // by mark — the note write is per-keyword.
    const noteRow = el?.closest?.('[data-pheromone-note]') as HTMLElement | null
    if (noteRow) {
      const noteId = noteRow.getAttribute('data-pheromone-note') ?? ''
      const cellLabel = noteRow.getAttribute('data-pheromone-note-cell') ?? ''
      if (noteId && cellLabel) {
        for (const tag of p.marks) EffectBus.emit('note:tag', { cellLabel, noteId, tag, add: true })
        return
      }
    }

    const card = el?.closest?.('[data-pheromone-tile]') as HTMLElement | null
    const label = card?.getAttribute('data-pheromone-tile') || this.#hoverLabel || undefined
    // `tag` stays in the payload for readers that only ever knew one keyword;
    // `tags` is the truth and carries the whole bouquet.
    EffectBus.emit('pheromone:drop', { label, tag: p.marks[0], tags: [...p.marks], x: event.clientX, y: event.clientY })
  }

  /** The dragged pheromone — or bouquet — following the cursor from the list to
   *  the tile. `pointer-events: none` so the drop can hit-test what is
   *  underneath, and parented to <body> because this element carries
   *  `backdrop-filter` and would otherwise be its containing block. */
  #buildGhost(drag: { name: string; color: string; count: number }): void {
    this.#removeGhost()
    const ghost = document.createElement('div')
    ghost.className = 'hc-tags-drag-ghost'
    ghost.setAttribute('aria-hidden', 'true')

    const swatch = document.createElement('span')
    swatch.className = 'tag-drag-swatch'
    swatch.style.background = drag.color

    const name = document.createElement('span')
    name.className = 'tag-drag-name'
    name.textContent = drag.name

    ghost.append(swatch, name)

    // A dragged BOUQUET says how many marks it is carrying.
    if (drag.count > 1) {
      const count = document.createElement('span')
      count.className = 'tag-drag-count'
      count.textContent = `×${drag.count}`
      ghost.appendChild(count)
    }

    document.body.appendChild(ghost)
    this.#ghost = ghost
  }

  #moveGhost(x: number, y: number): void {
    if (!this.#ghost) return
    this.#ghost.style.left = `${x}px`
    this.#ghost.style.top = `${y}px`
  }

  #removeGhost(): void {
    this.#ghost?.remove()
    this.#ghost = null
  }

  // ── filtering ────────────────────────────────────────────────────────

  /** A pheromone row was CLICKED (not dragged). The click is the FILTER verb,
   *  always — gathering is the ＋, dragging is the drop, and a selection is
   *  served by the strip's place button, never by overloading this tap. One
   *  gesture, one meaning. */
  onRowClick(name: string): void {
    // The click that ends a drag must not also act on the row.
    if (this.#swallowClick) { this.#swallowClick = false; return }
    this.#toggleFilter(name)
  }

  /** Toggle a tag in the active filter set and broadcast it — same effect the
   *  controls-bar pills emit, so the cross-page flatten reacts identically.
   *  Always carries `scope`: emitting without it made show-cell fall back to
   *  'local', so filtering from this panel silently reset the reach to
   *  page-only however wide the participant had just set it. */
  #toggleFilter(name: string): void {
    const next = new Set(this.#active)
    if (next.has(name)) next.delete(name); else next.add(name)
    this.#active = next
    this.#emitFilter(next)
  }

  /** Step to the next reach and wrap — local → children → global → local. One
   *  button carries the three stages — the same walk the lane ladder does. */
  cycleScope(): void {
    const at = SCOPE_OPTIONS.findIndex(o => o.id === this.#scope)
    this.setScope(SCOPE_OPTIONS[(at + 1) % SCOPE_OPTIONS.length].id)
  }

  /** Pick a reach. Re-broadcasts immediately so a live filter re-scans at the
   *  new width; with nothing filtered it still emits, which is what keeps the
   *  controls-bar glyph in step. */
  setScope(id: Scope): void {
    if (this.#scope === id) return
    this.#scope = id
    this.#emitFilter(this.#active)
  }

  /** Drop every active filter and return to the unfiltered view. */
  clearFilter(): void {
    if (this.#active.size === 0) return
    this.#active = new Set()
    this.#emitFilter(new Set())
  }

  #emitFilter(active: ReadonlySet<string>): void {
    EffectBus.emit('tags:filter', { active: [...active], scope: this.#scope })
  }

  /** Recolour a tag from the native colour input. Writing through the registry
   *  re-broadcasts `tags:registry`, which repaints the pills + on-tile badges. */
  recolor(name: string, event: Event): void {
    const color = (event.target as HTMLInputElement | null)?.value
    if (!color) return
    void this.#registry()?.add(name, color)
  }

  // ── the bouquet in hand ──────────────────────────────────────────────
  //
  // Pick pheromones (which IS arming — no separate step) and the hive answers
  // at once: tiles missing any of the set shade out, tiles wearing it all stay
  // lit. Clicking a shaded tile scents it immediately — a real write, no
  // staging, no Done — and the bouquet stays in hand for the next tile. Put it
  // down by emptying the set, pressing Put down, or Escape.
  //
  // WHAT IS IN HAND IS ALWAYS A BOUQUET — one mark or six, named or not. So
  // arming goes through one place, which works out the bouquet's signature and
  // sends it along with the marks. The signature is DERIVED while gathering and
  // only committed as a resource when the bouquet is named: content addressing
  // means identity is a property of the bytes, not of having stored them, so a
  // half-gathered set costs nothing.

  /** Hold on to the signature of what is in hand. DERIVED, not stored — while
   *  you are still gathering, every intermediate set would otherwise leave a
   *  resource behind. Saving is what commits bytes. */
  #identify(marks: readonly string[]): Promise<string | null> {
    const reg = this.#bouquetRegistry()
    if (!reg) return Promise.resolve(null)
    return reg.signatureOf(marks).then(sig => {
      this.#bouquetSig = sig
      if (this.#visible) this.#render()
      return sig
    })
  }

  /** Take a bouquet in hand: arm at once, then work out its signature.
   *
   *  Arming first is deliberate — the hive must shade for the set on the same
   *  tick as the click, and hashing is async. The identity is re-announced when
   *  it arrives, but ONLY if the same bouquet is still in hand: a one-shot
   *  arm→paint→commit (the selection path) has already put it down by then, and
   *  re-announcing would silently re-arm the hive.
   *
   *  `color` rides along so the shade can light the matching tiles in the
   *  bouquet's own colour — the first mark's, the same face the bouquet row and
   *  the hover preview wear. */
  #armBouquet(marks: readonly string[]): void {
    const tags = [...marks]
    if (tags.length === 0) { this.#standDown(); return }
    const color = this.#colorOf(tags[0], this.#registry())
    EffectBus.emit('tags:apply-begin', { tags, color })
    const held = tags.join('\u0000')
    void this.#identify(tags).then(sig => {
      if (!sig || !this.#painting()) return
      if (this.#applyTags.join('\u0000') !== held) return
      EffectBus.emit('tags:apply-begin', { tags, bouquet: sig, color })
    })
  }

  /** Put whatever is in hand down. */
  #standDown(): void {
    this.#bouquetSig = null
    EffectBus.emit('tags:apply-cancel', {})
  }

  /** Put the bouquet down: empty the gathered set and disarm the hive. The ONE
   *  way out of the armed state — nothing was staged, so there is nothing to
   *  discard or commit; every scent already landed as it was clicked. */
  putDown(): void {
    this.#selected = new Set()
    this.#naming = false
    this.#standDown()
    if (this.#visible) this.#render()
  }

  /** THE PLACE BUTTON: put the bouquet in hand on every canvas-selected tile,
   *  in one transaction — instead of clicking each shaded tile, the selection
   *  IS the target set. The commit disarms drone-side; the pending-inactive
   *  echo clears the gathered set here, so the whole gesture reads as one act.
   *  This is the ONLY selection path — no row tap is overloaded for it. */
  applyBouquetToSelection(): void {
    if (!this.#painting() || this.#canvasSelection.length === 0) return
    for (const label of this.#canvasSelection) {
      EffectBus.emit('tags:apply-paint', { label, add: true })
    }
    EffectBus.emit('tags:apply-commit', {})
  }

  /** Gather / release a pheromone. Gathering IS arming — from the first mark
   *  the hive shades every tile missing the set and a click scents it; emptying
   *  the set puts the bouquet down. */
  togglePheromone(name: string): void {
    if (this.#removalTag) this.cancelRemoval()
    const next = new Set(this.#selected)
    if (next.has(name)) next.delete(name); else next.add(name)
    this.#selected = next
    this.#armBouquet([...next])
    if (this.#visible) this.#render()
  }

  // ── bouquets ─────────────────────────────────────────────────────────
  //
  // The brush already carried a SET; a bouquet is that set with a name, so it
  // survives the session and can be put on the next tile without re-picking.
  // Every verb here goes through the picked set — load fills it, save reads it
  // — which keeps ONE notion of "the pheromones in hand".

  toggleBouquetOpen(name: string, event?: Event): void {
    event?.stopPropagation()
    const next = new Set(this.#openBouquets)
    if (!next.delete(name)) next.add(name)
    this.#openBouquets = next
    if (this.#visible) this.#render()
  }

  toggleNamespaceOpen(name: string): void {
    const next = new Set(this.#openNamespaces)
    if (!next.delete(name)) next.add(name)
    this.#openNamespaces = next
    if (this.#visible) this.#render()
  }

  /** Open the naming field for the picked set — and put the caret in it, since
   *  pressing the button IS the intent to type a name. */
  beginNaming(): void {
    if (this.#selected.size === 0) return
    this.#naming = true
    // The draft OPENS as the loaded name — that is what the field showed
    // before, and re-naming an existing bouquet should start from its name.
    this.#nameDraft = this.#loadedBouquet() ?? ''
    if (this.#visible) this.#render()
    // The command line reclaims focus during the same frame, so one focus()
    // right after the render is not enough. Same ladder the command line itself
    // uses for the same reason (`#focusShellSoon`): try repeatedly across the
    // frame rather than guess which beat wins.
    const focus = (): void => {
      const input = this.querySelector('.bouquet-name-input') as HTMLInputElement | null
      input?.focus()
      input?.select()
    }
    queueMicrotask(focus)
    requestAnimationFrame(focus)
    if (this.#focusTimer !== null) clearTimeout(this.#focusTimer)
    this.#focusTimer = setTimeout(() => { this.#focusTimer = null; focus() }, 60)
  }

  cancelNaming(): void {
    this.#naming = false
    this.#nameDraft = ''
    if (this.#visible) this.#render()
  }

  /** Name the picked set. Re-using an existing name replaces it — the name IS
   *  the address, so this is an update, never a second bouquet. */
  async saveBouquet(name: string): Promise<void> {
    const marks = this.#selectedNames()
    if (!name.trim() || marks.length === 0) return
    this.#naming = false
    this.#nameDraft = ''
    if (this.#visible) this.#render()
    await this.#bouquetRegistry()?.save(name, marks)
    if (this.#visible) this.#render()
  }

  /** Put a bouquet in hand: the picked set BECOMES its marks, which arms it
   *  exactly as picking them one at a time would. Clicking the loaded bouquet
   *  again puts it down. With tiles selected, taking it in hand is still all
   *  this does — the strip's place button is the verb that lands it. */
  loadBouquet(row: BouquetRow): void {
    // The click that ends a bouquet drag must not also load the bouquet.
    if (this.#swallowClick) { this.#swallowClick = false; return }
    if (this.#removalTag) this.cancelRemoval()
    const marks = row.marks.filter(Boolean)
    if (this.#loadedBouquet() === row.name) {
      this.putDown()
      return
    }
    if (marks.length === 0) return
    this.#selected = new Set(marks)
    // Already minted — its sig IS the row's identity, so arm with it directly.
    this.#bouquetSig = row.sig
    EffectBus.emit('tags:apply-begin', { tags: marks, bouquet: row.sig, color: this.#bouquetColor(row) })
    if (this.#visible) this.#render()
  }

  /** Forget the name. The marks themselves are untouched — they are keywords in
   *  their own right, and the bouquet was only ever a way to hold several. */
  async forgetBouquet(name: string, event: Event): Promise<void> {
    event.stopPropagation()
    await this.#bouquetRegistry()?.remove(name)
    if (this.#visible) this.#render()
  }

  // ── staged removal ───────────────────────────────────────────────────

  /** Arm a removal: filter the hive to this keyword — so every tile carrying it
   *  is on screen at the current reach — and hand the staging to the drone.
   *  Nothing is written; clicking tiles builds the list, Remove commits it. */
  beginRemoval(name: string): void {
    if (this.#removalTag === name) { this.commitRemoval(); return }
    if (this.#selected.size > 0 || this.#painting()) this.putDown()
    const only = new Set([name])
    this.#active = only
    this.#emitFilter(only)
    EffectBus.emit('tags:removal-begin', { tag: name })
  }

  /** Stage every tile currently on screen — the "all of them" shortcut for a
   *  keyword that was applied by mistake. */
  stageAllShown(): void {
    EffectBus.emit('tags:removal-select-all', {})
  }

  /** Apply the staged removals. The drone splices each tile's decoration and
   *  re-runs the filter, so the committed tiles drop out of view. */
  commitRemoval(): void {
    if (this.#removalCells.length === 0) { this.cancelRemoval(); return }
    EffectBus.emit('tags:removal-commit', {})
  }

  cancelRemoval(): void {
    EffectBus.emit('tags:removal-cancel', {})
  }

  /** Forget the keyword itself — drop it from the master registry so it stops
   *  appearing in this list and the controls-bar pills. Tiles keep whatever
   *  decorations they carry; use the staged removal above to take it off them.
   *  Only offered while a removal is armed, so it can't be hit by accident. */
  forgetTag(name: string): void {
    this.cancelRemoval()
    void this.#registry()?.remove(name)
    if (this.#active.has(name)) {
      const next = new Set(this.#active)
      next.delete(name)
      this.#active = next
      this.#emitFilter(next)
    }
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
  customElements.define(SURFACE_NAME, TagsViewerElement)
}

window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/TagsViewerElement',
    element: SURFACE_NAME,
    order: 130,
  })
})
