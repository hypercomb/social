// aggregate-index.view.ts — THE ONE AGGREGATE INDEX, as a framework-free
// custom element (everything-is-a-beehavior Phase 2: the Angular panels leave
// the shell and ship as signed modules).
//
// A straight port of shared/ui/aggregate-index: same surface name
// (hc-aggregate-index), same order band (61), the same panel ids
// (`aggregate-<source.id>` — so the participant's saved width, text size and
// group membership come across untouched), the same effects in and out.
//
// It lands in `groups/` — the domain that owns aggregation — and the FOUR
// FILES THAT ARE THE SUBSYSTEM came with it, unchanged but for their headers
// and relative imports:
//
//   aggregate-source.ts        the plugin seam: what an aggregate DECLARES
//   aggregate-drop.ts          what a dropped row MEANS (reference / context)
//   sources/collections.source.ts
//   sources/websites.source.ts
//
// THE SEAM IS THE POINT. An aggregate contributes a SOURCE — its rows, what
// opening one does, which management gestures it allows — and this panel draws
// every one of them. Collapsing the two sources into the view would put the
// Websites version chain and the Portals rename in the same file and hand the
// next aggregate nothing; the seam stays, and the sources go on registering
// themselves at module load (`registerAggregateSource`). They are imported
// here — and ONLY here — because a source with no importer never registers and
// two importers would inline two copies of it.
//
// ── The drag ────────────────────────────────────────────────────────────────
//
// POINTER events, not HTML5 drag — the same gesture the pheromone panel uses,
// so a row-drag behaves identically wherever it starts. Crossing the threshold
// promotes to a drag and emits `drop:dragging {active:true}`, which puts the
// tile overlay into its bare drop-target mode.
//
// **Resolve the drop from the RELEASE COORDINATES, never a remembered hover.**
// Crossing chrome makes the overlay broadcast `tile:hover {label:null}`, so the
// remembered label is routinely stale-null at exactly the moment it is needed.
// `TileOverlayDrone.labelAtClient(x, y)` resolves the release point against the
// live hex map instead.
//
// ── LIFECYCLE ───────────────────────────────────────────────────────────────
//
// The Angular version wrapped the whole `<aside>` in `@if (open() && source())`,
// so the panel's DOM existed only while it was up. A registry-fed element is
// mounted ONCE at boot and stays, so DOM presence and ENGAGEMENT split the way
// DockedPanelElement splits them: `activate()` builds + claims the lane + joins
// the session, `deactivate()` tears it all down and clears the children.
// `#show()`/`#hide()` are those two calls plus the `.open` class, and the host
// starts hidden — a panel that flashed on boot would claim an edge lane nobody
// asked for.
//
// Because the host IS the panel (DockedPanelElement sizes, positions, grips and
// measures `this`), the Angular `:host { inset: 0; pointer-events: none }`
// full-bleed wrapper is gone and the `.ai-panel` rules land on the tag. The one
// thing that wrapper carried besides the panel — the DRAG GHOST — moves to
// `document.body`: `backdrop-filter` on the tag makes it a containing block for
// fixed descendants, so a ghost left inside would be positioned against the
// panel rather than the screen.
//
// ── WHAT ESCAPE DOES ────────────────────────────────────────────────────────
//
// Nothing here binds a keydown listener, in either implementation. The window
// declares `dismiss` / `close` on its SESSION and the shell's Escape cascade
// calls them (holdWindow / holdToolWindow, from the base). So there is no
// `keydown.escape` modifier question to answer: the original had no key binding
// to port, and adding one would itself be the regression.
//
// Its strings ship WITH it (aggregate-index.i18n.ts, extracted from all 14
// shell catalogs) and register under the 'app' namespace, so every key resolves
// exactly as before. `collections-landing.title` is SHARED with the controls
// bar (the Portals launcher's label) and with a tutorial lesson that finds that
// button by its label — it must stay in the shell catalogs as well as here.

import {
  EffectBus, hypercomb,
  I18N_IOC_KEY, RECENT_PORTALS_KEY,
  focusSnapshot, restoreFocus,
  type I18nProvider, type RecentPortalsProvider,
} from '@hypercomb/core'
import { DockedPanelElement } from '../panels/docked-panel.element.js'
import { AGGREGATE_INDEX_TRANSLATIONS } from './aggregate-index.i18n.js'
import {
  aggregateSources, getAggregateSource, sourceForLocation,
  type AddedRows, type AggregateItem, type AggregateSource, type AggregateVersion, type StagedEntry,
} from './aggregate-source.js'
import { dropContextOnTile, dropReferenceTile, dropTagsOnTile, safeCellName } from './aggregate-drop.js'
// The two aggregates this build ships. Imported for their REGISTRATION side
// effect and nowhere else — see the header note on why exactly one file may.
import './sources/collections.source.js'
import './sources/websites.source.js'

const SURFACE_NAME = 'hc-aggregate-index'

/** Movement before a press counts as a drag rather than a click — small enough
 *  to feel immediate, large enough that a click that jitters still opens. */
const DRAG_THRESHOLD = 5

/** The Portals view. The only source whose rows may be pinned as home — every
 *  source's `segments` is "what this row points at", so the mechanism would
 *  work anywhere, but a home that is a tag row or a search hit is not a place
 *  you meant to keep. */
const PORTALS_SOURCE_ID = 'collections'

/** Joins segments into a comparable location key. NUL is the one character a
 *  tile name can never carry, so the join is unambiguous — a space would
 *  collide with any name containing one. Same separator and same reasoning as
 *  the decoration index's own location keys, and an ESCAPE SEQUENCE rather than
 *  a literal control byte (doctrine ratchet). */
const KEY_SEP = '\u0000'

type LineageLike = EventTarget & { explorerSegments?: () => readonly string[] }
type OverlayLike = { labelAtClient(x: number, y: number): string | null }
type NavigationLike = { goRaw?(segments: readonly string[]): void }
type SelectionServiceLike = EventTarget & { clear(): void }

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

/** A key the SOURCE supplied (`titleKey`, `ledeKey`, `addKey`, `createKey`).
 *  There is no English fallback to pair with it — the key is chosen by a data
 *  table at runtime — so a miss shows the key, which is exactly what Angular's
 *  `| t` pipe did (the service returns the key when nothing answers). */
const tk = (key: string, params?: Record<string, string | number>): string =>
  get<I18nProvider>(I18N_IOC_KEY)?.t(key, params) ?? key

/** Counting strings whose catalogs carry `.one` / `.other` alongside the bare
 *  key: the service picks between them off `params.count`, and the FALLBACK has
 *  to make the same choice itself or a host with no catalog reads "Add 1
 *  tiles". */
const tCount = (key: string, one: string, other: string, params: Record<string, string | number>): string =>
  t(key, Number(params['count']) === 1 ? one : other, params)

/** Selection, normalized. Two publishers share `selection:changed` —
 *  SelectionService (`{selected, active}`) and the pixi TileSelectionDrone (a
 *  superset with axial keys) — so this window must not grow a dependency on
 *  the richer accidental shape. Last-value replayed, so opening the panel after
 *  selecting still stages what is already picked. */
const onSelection = (cb: (selected: readonly string[]) => void): (() => void) =>
  EffectBus.on<{ selected?: unknown }>('selection:changed', (p) => {
    cb(Array.isArray(p?.selected) ? (p.selected as unknown[]).map(String) : [])
  })

/** Resolve SelectionService once it registers — the late-registration-safe
 *  idiom. Used only for `clear()`; the stream comes off the bus. */
const withSelectionService = (cb: (service: SelectionServiceLike) => void): void => {
  window.ioc?.whenReady?.('@diamondcoreprocessor.com/SelectionService', (s) => cb(s as SelectionServiceLike))
}

// The panel's strings travel with it — registered as soon as the i18n service
// is up, under 'app' so the keys resolve exactly as they always did.
window.ioc?.whenReady?.(I18N_IOC_KEY, (i18n) => {
  const provider = i18n as I18nProvider
  for (const [locale, catalog] of Object.entries(AGGREGATE_INDEX_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

// ── the styles the Angular SCSS carried, expanded to plain CSS ──────────────
//
// No shadow DOM, so Angular's `:host` becomes the tag name and every other
// selector is prefixed with it. `$steel: rgb(126,182,214)` and `$ink: #0c1118`
// are inlined at every call site; the shape ladder stays on the `:root` custom
// properties (_shape.scss publishes them app-wide).
//
// THREE EXPANSIONS WORTH NAMING:
//
//  • `@include tw.panel($steel, left)` was the LAST line of `.ai-panel`, so its
//    declarations WON the cascade over the ones written above it. The effective
//    values are written here once — background rgba(13,15,21,.975) (not
//    rgba(14,14,22,.96)), border-right alpha .38 (not .5), the 14px/44px shadow
//    (not 10px/40px) and colour #eef2f5 (not #eaf0f4) — rather than emitting
//    both and leaving four dead declarations in a document-level sheet.
//
//  • `.ai-close`'s own rules sit LATER in the sheet than the `tw.header`
//    close-button rules, but `…ai-header>button[class*='close']` outranks
//    `…ai-close` on specificity, so width / height / display / padding /
//    font-size / colour come from the header band and only background / border /
//    cursor come from `.ai-close`. That ordering is reproduced verbatim below
//    so the close button lands exactly where it always did.
//
//  • THE GHOST IS NOT IN THE PANEL. It lived under the Angular `:host`
//    full-bleed wrapper, which is gone; the tag now carries `backdrop-filter`,
//    and that makes it a containing block for `position: fixed` descendants. So
//    the ghost is appended to `document.body` and its rules are written at
//    document scope under `.hc-ai-ghost` — the hex/monogram rules it shares
//    with the rows carry both roots in their selector list.
//
// Angular's build autoprefixed; `-webkit-backdrop-filter` and
// `-webkit-user-select` are written by hand.
const HEX_CLIP = 'polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%)'
const PORTALS = `${SURFACE_NAME}[data-source='collections']`

const CSS = `
${SURFACE_NAME}{position:fixed;
  top:var(--hc-controls-left-top, max(calc(2.3rem * var(--hc-header-zoom,1)),var(--hc-header-anchor)));
  left:var(--hc-controls-left,0);bottom:0;z-index:100002;display:none;flex-direction:column;
  width:280px;min-width:220px;max-width:calc(100vw - 1.5rem);
  --hc-window-accent:rgb(126,182,214);--hc-window-radius-control:var(--hc-radius-control);
  --hc-window-radius-card:var(--hc-radius-card);--hc-window-radius-floating:var(--hc-radius-floating);
  background:rgba(13,15,21,.975);backdrop-filter:blur(14px) saturate(1.04);
  -webkit-backdrop-filter:blur(14px) saturate(1.04);border-radius:0;
  border-left:0;border-right:1px solid rgba(126,182,214,.38);
  box-shadow:14px 0 44px rgba(0,0,0,.46),inset -1px 0 rgba(255,255,255,.025);
  font-family:var(--hc-mono,system-ui);font-size:calc(1rem * var(--hc-panel-scale,1));
  color:#eef2f5;outline:none}
${SURFACE_NAME}.open{display:flex}
${SURFACE_NAME} .ai-body{display:contents}
${SURFACE_NAME} .ai-header{flex:0 0 auto;box-sizing:border-box;display:flex;align-items:center;gap:.5rem;height:2.875rem;min-height:2.875rem;padding:0 .75rem;line-height:1;background:linear-gradient(180deg,rgba(255,255,255,.018),rgba(255,255,255,.006));justify-content:space-between;border-bottom:1px solid rgba(126,182,214,.25)}
${SURFACE_NAME} .ai-header>button,${SURFACE_NAME} .ai-header>[class*='actions']>button{box-sizing:border-box;display:inline-grid;place-items:center;min-width:1.75rem;height:1.75rem;padding:0 .25rem;border-radius:var(--hc-radius-control);line-height:1;transition:color 120ms ease,background-color 120ms ease,border-color 120ms ease}
${SURFACE_NAME} .ai-header>button:hover,${SURFACE_NAME} .ai-header>[class*='actions']>button:hover{background-color:rgba(255,255,255,.055)}
${SURFACE_NAME} .ai-header>button:focus-visible,${SURFACE_NAME} .ai-header>[class*='actions']>button:focus-visible{outline:1px solid color-mix(in srgb,var(--hc-window-accent) 72%,white);outline-offset:1px}
${SURFACE_NAME} .ai-header>button[class*='close'],${SURFACE_NAME} .ai-header>button.close,${SURFACE_NAME} .ai-header>[class*='actions']>button[class*='close']{width:1.75rem;min-width:1.75rem;padding:0;font-size:1.125rem;color:rgba(238,244,248,.62)}
${SURFACE_NAME} .ai-header>button[class*='close']:hover,${SURFACE_NAME} .ai-header>button.close:hover,${SURFACE_NAME} .ai-header>[class*='actions']>button[class*='close']:hover{color:#fff;background-color:rgba(255,255,255,.075)}
${SURFACE_NAME} .ai-heading{display:flex;align-items:center;gap:.45em;min-width:0}
${SURFACE_NAME} .ai-icon{font-size:1.05rem;color:rgb(126,182,214)}
${SURFACE_NAME} .ai-title{font-size:.95rem;font-weight:600;letter-spacing:.4px;color:#eaf3f9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
${SURFACE_NAME} .ai-total{font-size:.7rem;font-weight:600;color:rgb(126,182,214);background:rgba(126,182,214,.12);border:1px solid rgba(126,182,214,.3);border-radius:999px;padding:.05rem .45rem;line-height:1.5}
${SURFACE_NAME} .ai-close{display:inline-flex;align-items:center;justify-content:center;width:1.6rem;height:1.6rem;padding:0;border:0;border-radius:var(--hc-radius-control);background:none;color:rgba(207,226,238,.62);cursor:pointer;font-size:1.05rem}
${SURFACE_NAME} .ai-close:hover{background:rgba(126,182,214,.16);color:#f4fafd}
${SURFACE_NAME} .ai-close:focus-visible{outline:1px solid rgba(126,182,214,.7);outline-offset:1px}
${SURFACE_NAME} .ai-filter{flex:0 0 auto;padding:.55em .7em;border-bottom:1px solid rgba(126,182,214,.16)}
${SURFACE_NAME} .ai-filter-row{display:flex;align-items:stretch;gap:.35em}
${SURFACE_NAME} .ai-filter-field{flex:1;min-width:0;display:flex;align-items:center;gap:.35em;padding:.3em .5em;border:1px solid rgba(126,182,214,.28);border-radius:var(--hc-radius-control);background:rgba(12,17,24,.6);transition:border-color 150ms ease,background 150ms ease}
${SURFACE_NAME} .ai-filter-field:focus-within{border-color:rgba(126,182,214,.7)}
${SURFACE_NAME} .ai-filter-field.is-creating{border-color:rgba(126,182,214,.7);background:rgba(126,182,214,.07)}
${SURFACE_NAME} .ai-filter-add{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:1.85em;padding:0;border:1px solid rgba(126,182,214,.28);border-radius:var(--hc-radius-control);background:rgba(12,17,24,.6);color:rgba(207,226,238,.7);cursor:pointer;font-size:1em;transition:background 150ms ease,border-color 150ms ease,color 150ms ease}
${SURFACE_NAME} .ai-filter-add:hover{background:rgba(126,182,214,.16);border-color:rgba(126,182,214,.6);color:#f4fafd}
${SURFACE_NAME} .ai-filter-add:focus-visible{outline:1px solid rgba(126,182,214,.7);outline-offset:1px}
${SURFACE_NAME} .ai-filter-add.is-active{background:rgba(126,182,214,.22);border-color:rgba(126,182,214,.75);color:#f4fafd}
${SURFACE_NAME} .ai-filter-icon{font-size:1em;color:rgba(126,182,214,.7);flex:0 0 auto}
${SURFACE_NAME} .ai-filter-input{flex:1;min-width:0;border:0;background:none;color:#eaf3f9;font:inherit;font-size:.82em;outline:none}
${SURFACE_NAME} .ai-filter-input::placeholder{color:rgba(207,226,238,.38)}
${SURFACE_NAME} .ai-filter-clear{flex:0 0 auto;width:1.2em;height:1.2em;padding:0;border:0;border-radius:50%;background:none;color:rgba(207,226,238,.55);cursor:pointer;font-size:.95em;line-height:1}
${SURFACE_NAME} .ai-filter-clear:hover{color:#f4fafd}
${SURFACE_NAME} .ai-scroll{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-width:none;padding:.6em;box-sizing:border-box}
${SURFACE_NAME} .ai-scroll::-webkit-scrollbar{display:none}
${SURFACE_NAME} .ai-welcome{padding:.4em .2em;text-align:center}
${SURFACE_NAME} .ai-lede{margin:0 0 .7em;font-size:.78em;line-height:1.6;color:rgba(207,226,238,.62)}
${SURFACE_NAME} .ai-empty,${SURFACE_NAME} .ai-no-match{margin:0;padding:.6em .3em;text-align:center;font-size:.76em;line-height:1.5;color:rgba(207,226,238,.42)}
${SURFACE_NAME} .ai-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.15em}
${SURFACE_NAME} .ai-row{position:relative;display:flex;align-items:center;flex-wrap:wrap;border-radius:var(--hc-radius-card);transition:background 140ms ease}
${SURFACE_NAME} .ai-row:hover{background:rgba(126,182,214,.08)}
${SURFACE_NAME} .ai-row.is-selected{background:rgba(126,182,214,.1);box-shadow:inset 2px 0 0 var(--accent,rgb(126,182,214))}
${SURFACE_NAME} .ai-row.is-portal-drop{box-shadow:inset 0 0 0 1px rgba(126,182,214,.35)}
${SURFACE_NAME} .ai-row.is-portal-drop:hover{background:rgba(126,182,214,.14);box-shadow:inset 0 0 0 1px rgba(126,182,214,.8)}
${SURFACE_NAME} .ai-row-open{flex:1;min-width:0;display:flex;align-items:center;gap:.55em;padding:.35em .4em;border:0;background:none;color:#eaf3f9;cursor:grab;font:inherit;text-align:left;user-select:none;-webkit-user-select:none}
${SURFACE_NAME} .ai-row-open:active{cursor:grabbing}
${SURFACE_NAME} .ai-row-open:focus-visible{outline:none}
${SURFACE_NAME} .ai-row-open:focus-visible .ai-hex{outline:2px solid rgba(126,182,214,.75);outline-offset:2px}
${SURFACE_NAME} .ai-hex{flex:0 0 auto;position:relative;width:1.75em;aspect-ratio:.866;clip-path:${HEX_CLIP};background:color-mix(in srgb,var(--accent,rgb(126,182,214)) 26%,rgba(126,182,214,.18));padding:1px;box-sizing:border-box;display:grid;place-items:center;transition:background 160ms ease}
${SURFACE_NAME} .ai-row:hover .ai-hex{background:color-mix(in srgb,var(--accent,rgb(126,182,214)) 58%,rgba(126,182,214,.28))}
${SURFACE_NAME} .ai-hex-img,${SURFACE_NAME} .ai-hex-fallback,.hc-ai-ghost .ai-hex-img,.hc-ai-ghost .ai-hex-fallback{width:100%;height:100%;clip-path:${HEX_CLIP}}
${SURFACE_NAME} .ai-hex-img,.hc-ai-ghost .ai-hex-img{object-fit:cover;display:block;background:#0c1118}
${SURFACE_NAME} .ai-hex-fallback,.hc-ai-ghost .ai-hex-fallback{display:grid;place-items:center;background:radial-gradient(118% 86% at 50% 24%,color-mix(in srgb,var(--accent,rgb(126,182,214)) 30%,transparent),transparent 66%),#0c1118}
${SURFACE_NAME} .ai-monogram,.hc-ai-ghost .ai-monogram{font-size:.62em;font-weight:600;line-height:1;color:color-mix(in srgb,var(--accent,rgb(126,182,214)) 68%,#eaf3f9);text-transform:uppercase;user-select:none;-webkit-user-select:none}
${SURFACE_NAME} .ai-label{min-width:0;font-size:.82em;color:rgba(234,243,249,.86);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${SURFACE_NAME} .ai-row:hover .ai-label{color:#f4fafd}
${SURFACE_NAME} .ai-rename{flex:1;padding:.25em .4em}
${SURFACE_NAME} .ai-rename-input{width:100%;box-sizing:border-box;padding:.25em .4em;border:1px solid rgba(126,182,214,.6);border-radius:var(--hc-radius-control);background:rgba(12,17,24,.8);color:#eaf3f9;font:inherit;font-size:.78em;outline:none}
${SURFACE_NAME} .ai-rename-input:focus{border-color:rgba(126,182,214,.9)}
${SURFACE_NAME} .ai-return{flex:0 0 auto;display:flex;align-items:center;gap:.4em;width:100%;padding:.45em .75em;border:0;border-bottom:1px solid rgba(126,182,214,.16);background:rgba(126,182,214,.07);color:rgba(207,226,238,.8);cursor:pointer;font:inherit;font-size:.78em;text-align:left;transition:background 140ms ease,color 140ms ease}
${SURFACE_NAME} .ai-return .mat-sym{font-size:1.05em;color:rgb(126,182,214)}
${SURFACE_NAME} .ai-return:hover{background:rgba(126,182,214,.14);color:#f4fafd}
${SURFACE_NAME} .ai-return:focus-visible{outline:1px solid rgba(126,182,214,.7);outline-offset:-1px}
${SURFACE_NAME} .ai-return-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${SURFACE_NAME} .ai-add-here{flex:0 0 auto;display:flex;align-items:center;gap:.4em;width:100%;padding:.45em .75em;border:0;border-bottom:1px solid rgba(126,182,214,.16);background:rgba(126,182,214,.07);color:rgba(207,226,238,.8);cursor:pointer;font:inherit;font-size:.78em;text-align:left;transition:background 140ms ease,color 140ms ease}
${SURFACE_NAME} .ai-add-here .mat-sym{font-size:1.05em;color:rgb(126,182,214)}
${SURFACE_NAME} .ai-add-here:hover{background:rgba(126,182,214,.14);color:#f4fafd}
${SURFACE_NAME} .ai-add-here:focus-visible{outline:1px solid rgba(126,182,214,.7);outline-offset:-1px}
${SURFACE_NAME} .ai-add-here-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${SURFACE_NAME} .ai-staged{flex:0 0 auto;padding:.4em .55em .5em;border-bottom:1px solid rgba(126,182,214,.16);background:rgba(126,182,214,.05)}
${SURFACE_NAME} .ai-staged-list{margin:0 0 .4em;padding:0;list-style:none;max-height:7.5em;overflow-y:auto}
${SURFACE_NAME} .ai-staged-row{display:flex;align-items:center;gap:.4em;padding:.18em .2em;color:rgba(207,226,238,.72);font-size:.78em}
${SURFACE_NAME} .ai-staged-row .ai-staged-icon{font-size:1em;color:rgba(126,182,214,.75)}
${SURFACE_NAME} .ai-staged-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${SURFACE_NAME} .ai-staged-add{width:100%;padding:.4em .6em;border:1px dashed rgba(126,182,214,.5);border-radius:3px;background:transparent;color:rgba(207,226,238,.88);cursor:pointer;font:inherit;font-size:.78em;transition:background 140ms ease,border-color 140ms ease,color 140ms ease}
${SURFACE_NAME} .ai-staged-add:hover{background:rgba(126,182,214,.14);border-color:rgba(126,182,214,.8);color:#f4fafd}
${SURFACE_NAME} .ai-staged-add:focus-visible{outline:1px solid rgba(126,182,214,.7);outline-offset:1px}
${SURFACE_NAME} .ai-carry-count{display:inline-flex;align-items:center;gap:.15rem;font-size:.7rem;font-weight:600;color:#d9c39a;background:rgba(214,176,110,.14);border:1px solid rgba(214,176,110,.45);border-radius:999px;padding:.05rem .4rem;line-height:1.5}
${SURFACE_NAME} .ai-carry-count .mat-sym{font-size:.85em}
${SURFACE_NAME} .ai-carry{flex:0 0 auto;padding:.4em .55em .5em;border-bottom:1px solid rgba(126,182,214,.16);border-left:2px solid rgba(214,176,110,.6);background:rgba(214,176,110,.06)}
${SURFACE_NAME} .ai-carry-list{margin:0 0 .4em;padding:0;list-style:none;max-height:8.5em;overflow-y:auto}
${SURFACE_NAME} .ai-carry-row{display:flex;align-items:center;gap:.4em;padding:.18em .2em;color:rgba(226,214,190,.9);font-size:.78em}
${SURFACE_NAME} .ai-carry-row .ai-carry-icon{font-size:1em;color:rgba(214,176,110,.8)}
${SURFACE_NAME} .ai-carry-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${SURFACE_NAME} .ai-carry-drop{flex:0 0 auto;background:none;border:none;padding:0 .2em;color:rgba(226,214,190,.55);font:inherit;line-height:1;cursor:pointer}
${SURFACE_NAME} .ai-carry-drop:hover{color:#f4fafd}
${SURFACE_NAME} .ai-carry-marks{display:flex;align-items:center;gap:.35em;margin:0 0 .4em;font-size:.72em;color:#8fbfa4}
${SURFACE_NAME} .ai-carry-marks .mat-sym{font-size:1.1em}
${SURFACE_NAME} .ai-carry-actions{display:flex;align-items:center;gap:.35em}
${SURFACE_NAME} .ai-carry-apply{flex:1 1 auto;padding:.4em .6em;border:1px solid rgba(214,176,110,.6);border-radius:3px;background:transparent;color:#f0e3c9;cursor:pointer;font:inherit;font-size:.78em;transition:background 140ms ease,border-color 140ms ease,color 140ms ease}
${SURFACE_NAME} .ai-carry-apply:hover{background:rgba(214,176,110,.18);border-color:rgba(214,176,110,.9);color:#fff}
${SURFACE_NAME} .ai-carry-apply:focus-visible{outline:1px solid rgba(214,176,110,.8);outline-offset:1px}
${SURFACE_NAME} .ai-carry-clear{flex:0 0 auto;padding:.4em .55em;border:1px solid rgba(126,182,214,.3);border-radius:3px;background:transparent;color:rgba(207,226,238,.7);cursor:pointer;font:inherit;font-size:.78em}
${SURFACE_NAME} .ai-carry-clear:hover{background:rgba(126,182,214,.14);color:#f4fafd}
${SURFACE_NAME} .ai-carry-clear:focus-visible{outline:1px solid rgba(126,182,214,.7);outline-offset:1px}
${SURFACE_NAME} .ai-action-carry.is-carried{background:rgba(214,176,110,.22);border-color:rgba(214,176,110,.85);color:#f0e3c9}
${SURFACE_NAME} .ai-action-home.is-home{background:rgba(214,176,110,.22);border-color:rgba(214,176,110,.85);color:#f0e3c9}
${PORTALS} .ai-actions{opacity:1}
${PORTALS} .ai-action{opacity:0;transition:opacity 140ms ease}
${PORTALS} .ai-row:hover .ai-action,${PORTALS} .ai-row:focus-within .ai-action{opacity:1}
${PORTALS} .ai-action-home.is-home{opacity:1}
${PORTALS} .ai-row:not(:hover):not(:focus-within):has(.ai-action-home.is-home) .ai-actions{gap:0}
${PORTALS} .ai-row:not(:hover):not(:focus-within):has(.ai-action-home.is-home) .ai-action:not(.ai-action-home){width:0;padding:0;margin:0;border-width:0;overflow:hidden}
${SURFACE_NAME} .ai-staged-move{display:flex;align-items:center;justify-content:center;gap:.4em;width:100%;margin-top:.35em;padding:.4em .6em;border:1px solid rgba(126,182,214,.5);border-radius:3px;background:transparent;color:rgba(207,226,238,.88);cursor:pointer;font:inherit;font-size:.78em;transition:background 140ms ease,border-color 140ms ease,color 140ms ease}
${SURFACE_NAME} .ai-staged-move .mat-sym{font-size:1.15em;line-height:1}
${SURFACE_NAME} .ai-staged-move:hover{background:rgba(126,182,214,.14);border-color:rgba(126,182,214,.8);color:#f4fafd}
${SURFACE_NAME} .ai-staged-move:focus-visible{outline:1px solid rgba(126,182,214,.7);outline-offset:1px}
${SURFACE_NAME} .ai-staged-move-label{min-width:0}
${SURFACE_NAME} .ai-actions{flex:0 0 auto;display:flex;gap:.2em;padding-right:.3em;opacity:.5;transition:opacity 140ms ease}
${SURFACE_NAME} .ai-row:hover .ai-actions,${SURFACE_NAME} .ai-row:focus-within .ai-actions{opacity:1}
${SURFACE_NAME} .ai-action{display:inline-flex;align-items:center;justify-content:center;width:1.4em;height:1.4em;padding:0;border:1px solid rgba(126,182,214,.35);border-radius:50%;background:rgba(12,17,24,.86);color:#cfe2ee;cursor:pointer}
${SURFACE_NAME} .ai-action .mat-sym{font-size:.72em}
${SURFACE_NAME} .ai-action:hover{background:rgba(126,182,214,.2);border-color:rgba(126,182,214,.75);color:#f4fafd}
${SURFACE_NAME} .ai-action:focus-visible{outline:1px solid rgba(126,182,214,.8);outline-offset:1px}
${SURFACE_NAME} .ai-action.is-active{background:rgba(126,182,214,.24);border-color:rgba(126,182,214,.8);color:#f4fafd}
${SURFACE_NAME} .ai-versions{box-sizing:border-box;flex:0 0 100%;padding:.1em .4em .45em 1.6em}
${SURFACE_NAME} .ai-versions-note,${SURFACE_NAME} .ai-versions-head{margin:.35em 0 .2em;font-size:.62em;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:rgba(207,226,238,.55)}
${SURFACE_NAME} .ai-version-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.12em}
${SURFACE_NAME} .ai-version{width:100%;display:flex;flex-wrap:wrap;align-items:baseline;gap:.1em .5em;padding:.22em .45em;border:1px solid transparent;border-radius:var(--hc-radius-control);background:none;color:#cfe2ee;font:inherit;font-size:.74em;text-align:left;cursor:pointer}
${SURFACE_NAME} .ai-version:hover:not(:disabled){background:rgba(126,182,214,.14);border-color:rgba(126,182,214,.4)}
${SURFACE_NAME} .ai-version:focus-visible{outline:1px solid rgba(126,182,214,.8);outline-offset:1px}
${SURFACE_NAME} .ai-version.is-active{background:rgba(126,182,214,.16);border-color:rgba(126,182,214,.55);color:#f4fafd;cursor:default}
${SURFACE_NAME} .ai-version:disabled:not(.is-active){opacity:.5;cursor:default}
${SURFACE_NAME} .ai-version-label{flex:1 1 auto;min-width:3em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${SURFACE_NAME} .ai-version-time{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--hc-mono,system-ui);font-size:.85em;color:rgba(207,226,238,.5)}
${SURFACE_NAME} .ai-version-flag{flex:0 0 auto;font-size:.78em;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--accent,rgb(126,182,214))}
${SURFACE_NAME} .ai-action-danger:hover{background:rgba(214,126,126,.22);border-color:rgba(214,126,126,.7);color:#f6dede}
.hc-ai-ghost{position:fixed;z-index:100010;pointer-events:none;transform:translate(-50%,-50%);display:flex;align-items:center;gap:.4rem;padding:.25rem .5rem .25rem .3rem;border:1px solid rgba(126,182,214,.55);border-radius:999px;background:rgba(14,14,22,.92);font-family:var(--hc-mono,system-ui);font-size:.78rem;color:#eaf3f9}
.hc-ai-ghost .ai-ghost-hex{width:1.5rem;aspect-ratio:.866;clip-path:${HEX_CLIP};background:color-mix(in srgb,var(--accent,rgb(126,182,214)) 45%,rgba(126,182,214,.2));padding:1px;box-sizing:border-box;display:grid;place-items:center}
.hc-ai-ghost .ai-ghost-label{max-width:12rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${SURFACE_NAME} .mat-sym{font-family:'Material Symbols Outlined';line-height:1}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-aggregate-index', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

/** `mat-sym` glyph span. */
const sym = (ligature: string, className = 'mat-sym'): HTMLElement => {
  const el = document.createElement('span')
  el.className = className
  el.setAttribute('aria-hidden', 'true')
  el.textContent = ligature
  return el
}

export class AggregateIndexElement extends DockedPanelElement {

  #offs: Array<() => void> = []

  // ── state (the Angular signals, as plain fields) ──────────────────────
  //
  // NOTHING lives in the DOM: every render reads these, so rebuilding is
  // always safe. `#open` is THE visibility flag — the toggle, the session's
  // park/unpark and both open/close paths read and write this one field, which
  // is what keeps them from drifting apart after the first press.
  #open = false
  /** Whether `activate()` has run — DOM presence, not intent. */
  #shown = false
  #source: AggregateSource | null = null
  #items: readonly AggregateItem[] = []
  /** The ONE field. There is no create mode — see `#creatable`. */
  #query = ''
  #renaming: string | null = null
  /** What is typed in the rename field right now, kept across a rebuild so a
   *  re-render underneath the participant cannot swallow half a name. */
  #renameDraft: string | null = null
  /** The row whose version chain is showing, by key — at most one. */
  #versionsFor: string | null = null
  #versions: readonly AggregateVersion[] = []
  #versionsLoading = false
  /** The item currently being dragged. The ghost follows the pointer by having
   *  its own style mutated — never by a re-render, which would replace the row
   *  button under the gesture and lose the click that must be swallowed. */
  #dragging: AggregateItem | null = null

  /** Where the participant stood when this panel opened — the page they meant
   *  to drop references ONTO. Opening never navigates, so this is simply
   *  "here"; it only becomes meaningful once a row is clicked and the hive
   *  moves to that collection to manage it. */
  #origin: readonly string[] | null = null
  /** The hive's current location, mirrored so the render can react. */
  #here: readonly string[] = []

  /** Rows picked up to be applied elsewhere. Order is the order they were
   *  picked — the batch lands the way you built it. */
  #carried: readonly AggregateItem[] = []
  /** The marks the scenting brush is holding, mirrored from `tags:apply-pending`
   *  (sticky). A bouquet in hand at the moment you press Apply lands on the
   *  references as they are created — see `#applyCarried`. */
  #brushMarks: readonly string[] = []
  /** Labels selected on the canvas, with the location they were selected AT.
   *  Captured rather than derived on read: a selection outlives navigation, and
   *  resolving `here + label` later would name whatever tile happens to share
   *  the name on the page you have since walked to. */
  #selection: readonly StagedEntry[] = []
  #activeTags: ReadonlySet<string> = new Set()
  #filterScope: 'local' | 'children' | 'global' = 'global'
  /** A tile is being dragged by its handle (PortalCarryDrone) — while true the
   *  Portals rows present themselves as drop zones. */
  #portalCarryActive = false

  #lineage: LineageLike | null = null
  #lineageBound = false
  #atSource = false
  /** The in-flight row read, and whether anything asked for another while it
   *  ran — see `#reload`. */
  #reloading: Promise<void> | null = null
  #reloadAgain = false
  /** The source whose `changed` we are subscribed to, so switching aggregates
   *  doesn't leave us listening to the old one. */
  #boundSource: AggregateSource | null = null
  #pending: { item: AggregateItem; x: number; y: number } | null = null
  #swallowClick = false
  #focusTimer = 0

  // ── chrome, built once per activation ─────────────────────────────────
  //
  // The header must survive a re-render because DockedPanelElement plants the
  // settings gear inside it (and nudges the close button over to make room)
  // AFTER renderPanel() returns — rebuilding the header would throw the gear
  // away. The FILTER FIELD and the SCROLL SURFACE survive for their own
  // reasons: the field is where the participant is typing (a rebuilt input
  // loses the caret, and mid-composition loses the text), and the scroller is
  // where they are reading (a fresh node starts at scrollTop 0).
  #headingEl: HTMLElement | null = null
  #iconEl: HTMLElement | null = null
  #titleEl: HTMLElement | null = null
  #totalEl: HTMLElement | null = null
  #carryCountEl: HTMLElement | null = null
  #closeEl: HTMLElement | null = null
  #bodyEl: HTMLElement | null = null
  #filterEl: HTMLElement | null = null
  #filterFieldEl: HTMLElement | null = null
  #filterInputEl: HTMLInputElement | null = null
  #filterClearEl: HTMLButtonElement | null = null
  #filterAddEl: HTMLButtonElement | null = null
  #scrollEl: HTMLElement | null = null
  #ghostEl: HTMLElement | null = null

  constructor() {
    super()
    // dockSide / widths carried across from the template EXACTLY. `panelId` is
    // set in #show(), because the template's was `'aggregate-' + src.id` — the
    // participant's saved width, text size and group membership hang off it,
    // so Portals and Websites keep their own.
    this.dockSide = 'left'
    this.minWidth = 220
    this.maxWidth = 480
    this.defaultWidth = 280
    // Registry-fed: mounted once at boot, engaged only when something opens it.
    this.autoActivate = false
    // The Angular original built this with `signalSession(open, undefined,
    // { dismiss, close })`. Reproduced literally: park/unpark flip visibility
    // and NOTHING else — no `aggregate:view-state` announcement (there was no
    // `announce`), no reload, and none of the clearing `close()` does. Put away
    // while the hive is covered; back on the same source, same filter, same
    // origin — `close()` also drops a rename in progress, parking doesn't.
    this.session = {
      park: () => { this.#open = false; this.#sync() },
      unpark: () => { this.#open = true; this.#sync() },
      dismiss: () => this.dismiss(),
      close: () => this.close(),
    }
  }

  // ── derived readings (the Angular computeds) ──────────────────────────

  get #visibleItems(): readonly AggregateItem[] {
    const q = this.#query.trim().toLowerCase()
    const active = this.#activeTags
    let list = this.#items
    if (active.size > 0) list = list.filter(i => (i.tags ?? []).some(tag => active.has(tag)))
    if (q) list = list.filter(i => i.label.toLowerCase().includes(q))
    return list
  }

  /** True once opening a collection has moved the hive off the origin page —
   *  the only state in which the return control has anything to do. */
  get #awayFromOrigin(): boolean {
    const o = this.#origin
    return !!o && !sameSegments(o, this.#here)
  }

  /** Last segment of the origin, for the return label. Root reads as "home". */
  get #originLabel(): string {
    const o = this.#origin
    return o && o.length ? o[o.length - 1] : 'home'
  }

  get #hasFilter(): boolean { return this.#activeTags.size > 0 || this.#query.trim().length > 0 }
  get #canCreate(): boolean { return !!this.#source?.create }

  // ── typing IS naming ──────────────────────────────────────────────────
  //
  // There is no create MODE. The field you search in is the field you name in,
  // because looking for something and not finding it is the same gesture as
  // deciding to make it. So the + means one thing at all times: MAKE WHAT I
  // TYPED. It is live exactly when that is a real act — there is a name, and
  // nothing already answers to it. A query that matches "music-archive" can
  // still create "music", because a name that reads like part of another name
  // is not the same name.

  /** The name the + would make: what is typed, cleaned the way a cell name
   *  must be (a name becomes a path segment). */
  get #draft(): string { return safeCellName(this.#query) }

  /** Whether a row already answers to the drafted name. Compared
   *  case-insensitively against BOTH the address and the reading: a row titled
   *  "Jazz" over the address `jazz-1` is a duplicate either way. */
  get #draftExists(): boolean {
    const name = this.#draft.toLowerCase()
    if (!name) return false
    return this.#items.some(i => i.key.toLowerCase() === name || i.label.toLowerCase() === name)
  }

  get #creatable(): boolean { return this.#canCreate && !!this.#draft && !this.#draftExists }

  /** Are the rows portals? Only the Portals view accepts a carried tile —
   *  every other aggregate's rows mean something else. */
  get #portalDropView(): boolean { return this.#source?.id === PORTALS_SOURCE_ID }

  /** The collection we are STANDING IN, if the current location is one of our
   *  rows. This is what makes "drill into a collection and add tiles" work. */
  get #destination(): AggregateItem | null {
    const here = this.#here.join(KEY_SEP)
    if (!here) return null
    return this.#items.find(i => i.segments.join(KEY_SEP) === here) ?? null
  }

  /** The selection, minus what would be a no-op.
   *
   *  Adding to the INDEX skips anything already indexed. Adding INTO a
   *  collection skips the collection itself AND its own children: a tile
   *  selected while standing inside the collection is already in it. Empty
   *  unless the active source actually supports adding. */
  get #staged(): readonly StagedEntry[] {
    if (!this.#source?.add) return []
    const into = this.#destination
    if (into) {
      const self = into.segments.join(KEY_SEP)
      return this.#selection.filter(e =>
        e.segments.join(KEY_SEP) !== self
        && e.segments.slice(0, -1).join(KEY_SEP) !== self)
    }
    const known = new Set(this.#items.map(i => i.key))
    return this.#selection.filter(e => !known.has(e.label))
  }

  /** Only ever INTO a collection — moving needs somewhere for the tiles to
   *  land, and the index itself is a list of pointers, not a place content
   *  lives. */
  get #canMove(): boolean {
    return !!this.#source?.move && !!this.#destination && this.#staged.length > 0
  }

  /** Can the page we are standing on be saved into the index? The canvas route
   *  cannot reach it — you would have to stand on its PARENT and select it —
   *  so a page can only add itself from in here. */
  get #canAddHere(): boolean {
    const src = this.#source
    if (!src?.add || this.#here.length === 0) return false
    return !this.#destination
  }

  /** The current page's own name, for the "add this page" affordance. */
  get #hereLabel(): string {
    const segs = this.#here
    return segs.length ? segs[segs.length - 1] : ''
  }

  get #carryCount(): number { return this.#carried.length }

  /** Whether this view's rows can be pinned as home. */
  get #portals(): RecentPortalsProvider | undefined {
    return get<RecentPortalsProvider>(RECENT_PORTALS_KEY)
  }

  get #canPinHome(): boolean {
    return this.#source?.id === PORTALS_SOURCE_ID && !!this.#portals
  }

  get #canPickVersion(): boolean { return !!this.#source?.versions }

  // ── lifecycle ─────────────────────────────────────────────────────────

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
      // THE TRAY IS A CAPTURE, NOT A MIRROR — each entry keeps its own absolute
      // `segments`, so a staged tile names itself rather than "whatever is
      // called that on the page I am looking at now". It does NOT outlive a
      // hop (`#onLineage` drops it), so an empty update is always honoured.
      onSelection((selected) => {
        const here = this.#hereNow()
        this.#selection = selected.map(label => ({ label, segments: [...here, label] }))
        this.#sync()
      }),

      // Bouquet in hand (sticky). Read-only here — the pheromone panel owns the
      // brush; this window only asks what it is holding when Apply is pressed.
      // A REPLAY is a state assertion and the handler SETS, so a repeat of the
      // same payload is free.
      EffectBus.on<{ tags?: string[]; tag?: string | null; active?: boolean }>(
        'tags:apply-pending', (p) => {
          const armed = p?.active === true
          const marks = armed
            ? (Array.isArray(p?.tags) && p.tags.length ? p.tags : (p?.tag ? [p.tag] : []))
            : []
          this.#brushMarks = marks.map(String).filter(Boolean)
          this.#sync()
        }),

      EffectBus.on<{ id?: string }>('aggregate:view-open', (p) => this.openPanel(p?.id)),

      // A tile is riding the pointer (the drag handle PortalCarryDrone owns) —
      // light the portal rows as drop zones while it does, and land the drop.
      EffectBus.on('portal-carry:drag-start', () => {
        this.#portalCarryActive = true
        this.#sync()
      }),
      EffectBus.on('portal-carry:drag-end', () => {
        this.#portalCarryActive = false
        this.#sync()
      }),
      EffectBus.on<{ label?: string; segments?: string[]; targetKey?: string }>(
        'portal-carry:drop', (p) => { void this.#onPortalCarryDrop(p) }),

      EffectBus.on<{ id?: string }>('aggregate:view-toggle', (p) => this.togglePanel(p?.id)),
      EffectBus.on('aggregate:view-close', () => this.close()),

      // The home pin can move from outside this window (the rail's Home menu,
      // or forgetting the pinned portal), and the lit row has to follow it.
      EffectBus.on('portals:recent-changed', () => this.#sync()),

      EffectBus.on<{ active?: readonly string[]; scope?: string }>('tags:filter', (p) => {
        this.#activeTags = new Set((p?.active ?? []).map(String).filter(Boolean))
        const s = p?.scope
        if (s === 'local' || s === 'children' || s === 'global') this.#filterScope = s
        this.#sync()
      }),

      // THE PIPE WAS IMPURE. Angular's `t` pipe is declared `pure: false`, so
      // every change-detection tick re-resolved every string and `/language ja`
      // re-labelled an OPEN panel on the spot. An element renders when it
      // decides to, so the locale switch has to be a reason to render — else an
      // open window keeps its old-locale title, its search placeholder, its
      // empty state and every row's action labels until it is closed and
      // reopened. Rebuilding is safe: the rows live in `#items`, never in DOM.
      EffectBus.on('locale:changed', () => {
        if (!this.#shown) return
        this.#relabel()
        this.#render()
      }),
    )

    aggregateSources.addEventListener('change', this.#sourceChanged)
    window.addEventListener('synchronize', this.#sourceChanged)
    // Lineage's own `change` does not fire for every hop (verified: a row click
    // moved the hive but left `here` stale, so the return control never
    // appeared). `navigate` is the shell-wide signal, so track that too — the
    // panel's location mirror has to be right or the way back is invisible.
    window.addEventListener('navigate', this.#onLineage)
    this.#ensureLineage()
    this.#refresh()
  }

  override disconnectedCallback(): void {
    this.#offs.forEach(off => off())
    this.#offs = []
    aggregateSources.removeEventListener('change', this.#sourceChanged)
    this.#boundSource?.changed?.removeEventListener('change', this.#sourceChanged)
    this.#boundSource = null
    window.removeEventListener('synchronize', this.#sourceChanged)
    window.removeEventListener('navigate', this.#onLineage)
    this.#lineage?.removeEventListener?.('change', this.#onLineage)
    this.#lineage = null
    this.#lineageBound = false
    this.#detachDrag()
    this.#removeGhost()
    if (this.#focusTimer) { clearTimeout(this.#focusTimer); this.#focusTimer = 0 }
    super.disconnectedCallback()   // → deactivate(): lane, session, grip, gear, children
    this.#open = false
    this.#shown = false
    this.classList.remove('open')
    this.removeAttribute('aria-label')
    this.#forgetChrome()
  }

  // ── open / close ──────────────────────────────────────────────────────

  /** Show the window. NEVER navigates — the page you are standing on is the
   *  drop surface, so opening the index must leave it exactly as it was.
   *  Anchors the origin on a FRESH open only, so re-emitting
   *  `aggregate:view-open` while it is already up can't move the return target
   *  out from under you. */
  openPanel(id?: string): void {
    const next = id ? getAggregateSource(id) : this.#source
    // A chain belongs to the row it was opened from — switching aggregates
    // leaves it pointing at a key this index has never heard of.
    if (next && next !== this.#source) this.#closeVersions()
    if (next) this.#source = next
    if (!this.#source) return
    if (!this.#open) this.#origin = this.#hereNow()
    this.#open = true
    // Announce the SHOWN view. Surfaces outside this window key on it — the
    // portal-carry drag handle rides tiles only while the portals view is up.
    // EffectBus replays the last value, so a late subscriber still learns the
    // current state; emitted on every open so switching aggregates while the
    // window stays up also reaches them.
    EffectBus.emit('aggregate:view-state', { id: this.#source?.id ?? null, open: true })
    this.#sync()
    void this.#reload()
  }

  /** The control that opens this index is a TOGGLE — press it again to put the
   *  window away. If clicking a row walked the hive into a collection, closing
   *  ALSO steps back to the page the panel was opened from, so the same button
   *  is a quick way home rather than only a way to hide the list.
   *
   *  Pressing a DIFFERENT aggregate's control while this one is up switches to
   *  it instead of closing — that press asked for that index, not for nothing. */
  togglePanel(id?: string): void {
    const current = this.#source
    if (this.#open && id && current && current.id !== id) { this.openPanel(id); return }
    if (!this.#open) { this.openPanel(id); return }
    if (this.#awayFromOrigin) this.returnToOrigin()
    this.close()
  }

  /** Go back to the page the panel was opened from and drop the selection, so
   *  dragging references can resume where it started. The panel stays open —
   *  this clears a selection, it does not close a tool. */
  returnToOrigin(): void {
    const o = this.#origin
    if (!o) return
    // Explicitly, before the hop rather than relying on it: this control's
    // whole purpose is to drop what is staged and start again.
    this.#dropStaged()
    get<NavigationLike>('@hypercomb.social/Navigation')?.goRaw?.(o)
  }

  close(): void {
    if (!this.#open) return
    this.#open = false
    // The counterpart announcement to openPanel's. EVERY exit lands here —
    // the ×, the toggle, `aggregate:view-close`, the Escape cascade's close
    // and the lane's eviction fallback — and the early return above is what
    // makes it exactly one announcement per exit.
    EffectBus.emit('aggregate:view-state', { id: this.#source?.id ?? null, open: false })
    this.#renaming = null
    this.#renameDraft = null
    this.#closeVersions()
    this.#sync()
  }

  /** DockedPanelElement's close verb — the × and the lane's eviction fallback
   *  both land here. */
  protected override closePanel(): void { this.close() }

  /** One level back per press: the rename field, then the query. False = we
   *  had nothing open, and the shell cascade carries on past us.
   *
   *  Only the LOCAL query is cleared, never the keyword filter: that one is
   *  shared with the controls bar and the hive, so unwinding it from in here
   *  would silently unflatten the canvas too.
   *
   *  This used to be a window listener that ended with its own
   *  `panel.contains(target)` test — the focus gate, hand-rolled. It is the
   *  cascade's job now, so the listener and the test are both gone. */
  dismiss(): boolean {
    if (!this.#open) return false
    if (this.#renaming) { this.#renaming = null; this.#renameDraft = null; this.#sync(); return true }
    if (this.#query) { this.#query = ''; this.#sync(); return true }
    return false
  }

  /** Show / hide follows `open && source` — exactly the Angular
   *  `@if (open() && source())`, and the reason a panel with no registered
   *  source can never appear. */
  #sync(): void {
    const want = this.#open && !!this.#source
    if (want && !this.#shown) { this.#show(); return }
    if (!want && this.#shown) { this.#hide(); return }
    if (this.#shown) this.#render()
  }

  #show(): void {
    if (this.#shown) return
    const src = this.#source
    if (!src) return
    this.#shown = true
    // The panel id the Angular `[hcDockedPanel]="'aggregate-' + src.id"`
    // carried, so `hc:docked-width:aggregate-collections`, the text size and
    // the group membership all come across with the participant. Set BEFORE
    // activate(), which is what reads it.
    //
    // FAITHFUL QUIRK: the Angular directive read its id at init and never
    // again (only `pairWhen` is handled in ngOnChanges), so switching
    // aggregates while the window stayed up kept the FIRST one's id. That is
    // reproduced — the id is fixed for the life of an activation.
    this.panelId = `aggregate-${src.id}`
    this.dataset['source'] = src.id
    this.classList.add('open')
    this.setAttribute('aria-label', tk(src.titleKey))
    this.activate()   // renderPanel + lane + session + grip + gear + inset
  }

  #hide(): void {
    if (!this.#shown) return
    this.#shown = false
    this.classList.remove('open')
    this.removeAttribute('aria-label')
    if (this.#focusTimer) { clearTimeout(this.#focusTimer); this.#focusTimer = 0 }
    this.deactivate()   // clears the children — rebuild-on-open, like the `@if`
    this.#forgetChrome()
  }

  #forgetChrome(): void {
    this.#headingEl = null
    this.#iconEl = null
    this.#titleEl = null
    this.#totalEl = null
    this.#carryCountEl = null
    this.#closeEl = null
    this.#bodyEl = null
    this.#filterEl = null
    this.#filterFieldEl = null
    this.#filterInputEl = null
    this.#filterClearEl = null
    this.#filterAddEl = null
    this.#scrollEl = null
  }

  // ── chrome (built once per activation) ────────────────────────────────

  protected override renderPanel(): void {
    const src = this.#source

    const header = document.createElement('header')
    header.className = 'ai-header'

    const heading = document.createElement('div')
    heading.className = 'ai-heading'
    const icon = sym(src?.icon ?? '', 'mat-sym ai-icon')
    const title = document.createElement('span')
    title.className = 'ai-title'
    title.textContent = src ? tk(src.titleKey) : ''
    heading.append(icon, title)

    const total = document.createElement('span')
    total.className = 'ai-total'

    // What you are carrying rides in the HEADER, not only in the bar below:
    // this basket survives navigation, so it must be impossible to forget it
    // is armed.
    const carryCount = document.createElement('span')
    carryCount.className = 'ai-carry-count'
    carryCount.append(sym('luggage'), document.createTextNode(''))

    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'ai-close mat-sym'
    close.textContent = 'close'
    close.dataset['hcRow'] = 'close'
    close.addEventListener('click', () => this.close())
    header.append(heading, close)

    // `display: contents` — the return bar, the trays, the filter and the
    // scroller stay flex items of the PANEL (the scroller's `flex: 1` is what
    // makes it the scrolling half), while one node still holds everything the
    // body rearrangement touches. Without it, a rebuild that reached for the
    // panel's own children would take the base's resize grip and settings gear
    // with it.
    const body = document.createElement('div')
    body.className = 'ai-body'

    this.append(header, body)
    this.#headingEl = heading
    this.#iconEl = icon
    this.#titleEl = title
    this.#totalEl = total
    this.#carryCountEl = carryCount
    this.#closeEl = close
    this.#bodyEl = body

    this.#buildFilter()
    const scroll = document.createElement('div')
    scroll.className = 'ai-scroll'
    this.#scrollEl = scroll

    // The once-per-activation strings (the tag's aria-label, the title, the ×)
    // are written HERE and re-resolved by `#relabel` on a locale switch — a
    // body render never touches them.
    this.#relabel()
    this.#render()
  }

  /** ONE field. Typing narrows the list AND names a new member. Built once per
   *  activation and UPDATED in place: this is where the participant is typing,
   *  and a rebuilt input loses the caret — mid-composition, the text. */
  #buildFilter(): void {
    const filter = document.createElement('div')
    filter.className = 'ai-filter'

    const form = document.createElement('form')
    form.className = 'ai-filter-row'
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      void this.#submitCreate()
    })

    const field = document.createElement('div')
    field.className = 'ai-filter-field'
    field.appendChild(sym('search', 'mat-sym ai-filter-icon'))

    const input = document.createElement('input')
    input.className = 'ai-filter-input'
    input.type = 'text'
    input.autocomplete = 'off'
    input.dataset['hcRow'] = 'filter'
    input.addEventListener('input', () => { this.#query = input.value ?? ''; this.#sync() })
    // Enter is bound explicitly: the shell's key handling eats a form's
    // implicit submission, so relying on it alone loses the keystroke people
    // actually press.
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      void this.#submitCreate()
    })
    field.appendChild(input)

    const clear = document.createElement('button')
    clear.className = 'ai-filter-clear mat-sym'
    clear.type = 'button'
    clear.textContent = 'close'
    clear.dataset['hcRow'] = 'filter-clear'
    clear.addEventListener('click', () => this.#clearFilter())

    const add = document.createElement('button')
    add.className = 'ai-filter-add mat-sym'
    add.type = 'button'
    add.textContent = 'add'
    add.dataset['hcRow'] = 'filter-add'
    add.addEventListener('click', () => { void this.#submitCreate() })

    form.append(field, add)
    filter.appendChild(form)

    this.#filterEl = filter
    this.#filterFieldEl = field
    this.#filterInputEl = input
    this.#filterClearEl = clear
    this.#filterAddEl = add
  }

  /** Re-resolve the strings written ONCE per activation — the ones a body
   *  rearrangement never touches. Everything else comes back through
   *  `#render()`. */
  #relabel(): void {
    const src = this.#source
    if (src) this.setAttribute('aria-label', tk(src.titleKey))
    if (this.#titleEl) this.#titleEl.textContent = src ? tk(src.titleKey) : ''
    if (this.#iconEl) this.#iconEl.textContent = src?.icon ?? ''
    this.#closeEl?.setAttribute('aria-label', t('aggregate.close', 'Close'))
    if (this.#closeEl) this.#closeEl.title = t('aggregate.close', 'Close')
  }

  // ── rendering (rebuild on change — the house pattern, no reconciler) ───

  #render(): void {
    const body = this.#bodyEl
    if (!body || !this.#shown) return

    // WHERE THE PARTICIPANT WAS. The scroller and the filter field are kept
    // across a render for exactly this reason, but the rows inside the
    // scroller are rebuilt — so the read position and whatever was focused
    // have to be put back. `data-hc-row` is stamped on every focusable this
    // panel draws: restoring by a class would put the ring on the FIRST
    // matching control, which on a row strip is the wrong verb.
    const snap = focusSnapshot(this)
    const scrollTop = this.#scrollEl?.scrollTop ?? 0

    this.#renderHeading()
    this.#renderBody()
    this.#renderScroll()

    if (this.#scrollEl && scrollTop > 0) this.#scrollEl.scrollTop = scrollTop
    restoreFocus(this, snap)
  }

  #renderHeading(): void {
    const heading = this.#headingEl
    const icon = this.#iconEl
    const title = this.#titleEl
    if (!heading || !icon || !title) return
    const src = this.#source
    // THE SOURCE ATTRIBUTE IS LIVE, unlike the panel id. The template bound
    // `[attr.data-source]="src.id"`, which Angular re-evaluated whenever
    // `source()` changed — and the Portals-only CSS block keys off it. Writing
    // it once in #show() latched the whole stylesheet onto whichever aggregate
    // opened FIRST, so switching to Websites kept the collections styling.
    // (The panel id genuinely IS frozen for the life of an activation — that
    // is the dock quirk reproduced above. These are two different things.)
    if (src) this.dataset['source'] = src.id
    else delete this.dataset['source']
    // The accessible name is live for the same reason.
    if (src) this.setAttribute('aria-label', tk(src.titleKey))
    icon.textContent = src?.icon ?? ''
    title.textContent = src ? tk(src.titleKey) : ''

    const parts: HTMLElement[] = [icon, title]
    // POLARITY IS LOAD-BEARING: `items().length > 0`, exactly as the template
    // wrote it — never a negated `<= 0` guard, which is ALSO false for a NaN
    // and would fall through into painting one.
    if (this.#items.length > 0 && this.#totalEl) {
      this.#totalEl.textContent = String(this.#visibleItems.length)
      parts.push(this.#totalEl)
    }
    if (this.#carryCount > 0 && this.#carryCountEl) {
      const label = tCount('aggregate.carrying', 'Carrying 1', 'Carrying {count}', { count: this.#carryCount })
      this.#carryCountEl.title = label
      const text = this.#carryCountEl.lastChild
      if (text) text.textContent = String(this.#carryCount)
      parts.push(this.#carryCountEl)
    }
    heading.replaceChildren(...parts)
  }

  /** Place the body's blocks in template order, KEEPING the filter and the
   *  scroller exactly where they are.
   *
   *  `appendChild` is not "move" for a node that already has a parent — it is a
   *  remove followed by an insert, and removing a subtree that holds the focus
   *  drops it to <body>. So departed blocks are swept FIRST and the survivors
   *  are walked against an anchor, skipping anything already in place. */
  #renderBody(): void {
    const body = this.#bodyEl
    if (!body) return

    const parts: HTMLElement[] = []
    if (this.#awayFromOrigin) parts.push(this.#buildReturn())
    if (this.#canAddHere) parts.push(this.#buildAddHere())
    if (this.#carryCount > 0) parts.push(this.#buildCarry())
    const addKey = this.#source?.addKey
    if (this.#staged.length > 0 && addKey) parts.push(this.#buildStaged(addKey))
    // Shown whenever there is something to search or something to create — an
    // empty index still needs its first row.
    if ((this.#items.length > 0 || this.#canCreate) && this.#filterEl) {
      this.#updateFilter()
      parts.push(this.#filterEl)
    }
    if (this.#scrollEl) parts.push(this.#scrollEl)

    for (const child of [...body.children]) {
      if (!parts.includes(child as HTMLElement)) child.remove()
    }
    let anchor: ChildNode | null = body.firstChild
    for (const part of parts) {
      if (anchor === part) { anchor = part.nextSibling; continue }
      body.insertBefore(part, anchor)
    }
  }

  #updateFilter(): void {
    const field = this.#filterFieldEl
    const input = this.#filterInputEl
    const clear = this.#filterClearEl
    const add = this.#filterAddEl
    if (!field || !input || !clear || !add) return

    const creatable = this.#creatable
    field.classList.toggle('is-creating', creatable)

    const placeholder = t('aggregate.filter', 'search…')
    input.placeholder = placeholder
    input.setAttribute('aria-label', placeholder)
    // Never clobber what is being typed — only correct a value the panel
    // itself changed (a create clears the field, Escape clears the query).
    if (input.value !== this.#query) input.value = this.#query

    const clearLabel = t('aggregate.filter-clear', 'Clear search')
    clear.setAttribute('aria-label', clearLabel)
    clear.title = clearLabel
    if (this.#hasFilter) { if (clear.parentNode !== field) field.appendChild(clear) }
    else clear.remove()

    const addLabel = creatable
      ? t('aggregate.create-named', 'Create "{name}"', { name: this.#draft })
      : tk(this.#source?.createKey ?? 'aggregate.new')
    add.setAttribute('aria-label', addLabel)
    add.title = addLabel
    add.classList.toggle('is-active', creatable)
    add.disabled = !creatable
    const form = field.parentElement
    if (this.#canCreate) { if (form && add.parentNode !== form) form.appendChild(add) }
    else add.remove()
  }

  #renderScroll(): void {
    const scroll = this.#scrollEl
    if (!scroll) return
    const src = this.#source
    const visible = this.#visibleItems

    if (this.#items.length === 0) {
      const welcome = document.createElement('div')
      welcome.className = 'ai-welcome'
      if (src?.ledeKey) {
        const lede = document.createElement('p')
        lede.className = 'ai-lede'
        lede.textContent = tk(src.ledeKey)
        welcome.appendChild(lede)
      }
      const empty = document.createElement('p')
      empty.className = 'ai-empty'
      empty.textContent = t('aggregate.empty', 'Nothing here yet.')
      welcome.appendChild(empty)
      scroll.replaceChildren(welcome)
      return
    }

    if (visible.length === 0) {
      const none = document.createElement('p')
      none.className = 'ai-no-match'
      none.textContent = t('aggregate.no-match', 'Nothing matches this search.')
      scroll.replaceChildren(none)
      return
    }

    // One line per item. The whole row is the drag handle — press and move to
    // carry it onto the hive; a plain click opens it.
    const list = document.createElement('ul')
    list.className = 'ai-list'
    list.setAttribute('role', 'list')
    for (const item of visible) list.appendChild(this.#buildRow(item))
    scroll.replaceChildren(list)
  }

  // ── the blocks above the list ─────────────────────────────────────────

  /** Opening a row walks the hive into that collection to manage it. This is
   *  the way back to the page the panel was opened from, so references can go
   *  on being dragged onto it. Only shown once we have actually moved. */
  #buildReturn(): HTMLElement {
    const label = t('aggregate.return', 'back to {page}', { page: this.#originLabel })
    const button = document.createElement('button')
    button.className = 'ai-return'
    button.type = 'button'
    button.dataset['hcRow'] = 'return'
    button.setAttribute('aria-label', label)
    button.title = label
    const text = document.createElement('span')
    text.className = 'ai-return-label'
    text.textContent = label
    button.append(sym('arrow_back'), text)
    button.addEventListener('click', () => this.returnToOrigin())
    return button
  }

  /** Save the page we are standing on. The canvas route cannot select the page
   *  you are ON — only its parent can — so this is the only way in. */
  #buildAddHere(): HTMLElement {
    const label = t('collections-landing.add-here', 'Save "{name}" to Portals', { name: this.#hereLabel })
    const button = document.createElement('button')
    button.className = 'ai-add-here'
    button.type = 'button'
    button.dataset['hcRow'] = 'add-here'
    button.setAttribute('aria-label', label)
    button.title = label
    const text = document.createElement('span')
    text.className = 'ai-add-here-label'
    text.textContent = label
    button.append(sym('bookmark_add'), text)
    button.addEventListener('click', () => { void this.#addHere() })
    return button
  }

  /** Carrying: picked here, applied wherever you walk to. The bar names the
   *  page it would land on, so pressing it can never be a guess — and it says
   *  what the bouquet in hand will do, because a mark landing on twelve new
   *  references is not something to discover afterwards. */
  #buildCarry(): HTMLElement {
    const carry = document.createElement('div')
    carry.className = 'ai-carry'
    carry.setAttribute('role', 'group')
    carry.setAttribute('aria-label',
      tCount('aggregate.carrying', 'Carrying 1', 'Carrying {count}', { count: this.#carryCount }))

    const list = document.createElement('ul')
    list.className = 'ai-carry-list'
    for (const item of this.#carried) {
      const row = document.createElement('li')
      row.className = 'ai-carry-row'
      const name = document.createElement('span')
      name.className = 'ai-carry-name'
      name.textContent = item.label
      const label = t('aggregate.carry.remove', 'put {name} back down', { name: item.label })
      const drop = document.createElement('button')
      drop.className = 'ai-carry-drop'
      drop.type = 'button'
      drop.textContent = '×'
      drop.dataset['hcRow'] = `carry-drop:${item.key}`
      drop.setAttribute('aria-label', label)
      drop.title = label
      drop.addEventListener('click', (event) => this.#toggleCarry(item, event))
      row.append(sym('north_east', 'mat-sym ai-carry-icon'), name, drop)
      list.appendChild(row)
    }
    carry.appendChild(list)

    if (this.#brushMarks.length > 0) {
      const marks = document.createElement('p')
      marks.className = 'ai-carry-marks'
      marks.append(sym('local_florist'), document.createTextNode(
        t('aggregate.apply.with-marks', 'lands scented {marks}', { marks: this.#brushMarks.join(', ') })))
      carry.appendChild(marks)
    }

    const actions = document.createElement('div')
    actions.className = 'ai-carry-actions'

    const page = this.#hereLabel || t('aggregate.home', 'home')
    const applyLabel = tCount('aggregate.apply-here', 'Apply 1 to {page}', 'Apply {count} to {page}',
      { count: this.#carryCount, page })
    const apply = document.createElement('button')
    apply.className = 'ai-carry-apply'
    apply.type = 'button'
    apply.dataset['hcRow'] = 'carry-apply'
    apply.textContent = applyLabel
    apply.setAttribute('aria-label', applyLabel)
    apply.title = t('aggregate.apply.hint', 'one reference per item, on the page in front of you')
    apply.addEventListener('click', () => { void this.#applyCarried() })

    const clearLabel = t('aggregate.carry.clear', 'Put down')
    const clear = document.createElement('button')
    clear.className = 'ai-carry-clear'
    clear.type = 'button'
    clear.dataset['hcRow'] = 'carry-clear'
    clear.textContent = clearLabel
    clear.setAttribute('aria-label', clearLabel)
    clear.title = clearLabel
    clear.addEventListener('click', () => this.#dropCarried())

    actions.append(apply, clear)
    carry.appendChild(actions)
    return carry
  }

  /** Tiles selected out on the canvas, offered as candidates. Temporary and
   *  never persisted: these rows exist only while the selection does, and
   *  pressing Add is what turns them into real members. */
  #buildStaged(addKey: string): HTMLElement {
    const entries = this.#staged
    const count = entries.length
    const staged = document.createElement('div')
    staged.className = 'ai-staged'
    staged.setAttribute('role', 'group')
    staged.setAttribute('aria-label', tk(addKey, { count }))

    const list = document.createElement('ul')
    list.className = 'ai-staged-list'
    for (const entry of entries) {
      const row = document.createElement('li')
      row.className = 'ai-staged-row'
      const name = document.createElement('span')
      name.className = 'ai-staged-name'
      name.textContent = entry.label
      row.append(sym('add_circle', 'mat-sym ai-staged-icon'), name)
      list.appendChild(row)
    }
    staged.appendChild(list)

    // The label names the destination rather than leaving it implicit:
    // standing inside a collection sends the selection THERE, standing
    // anywhere else turns them into collections.
    //
    // TWO verbs, side by side, because "put this in there" means two different
    // things and the difference matters: ADD leaves the tile where it lives and
    // gives this collection a doorway onto it, while MOVE files it away — the
    // tile leaves the page it was on and lives in here.
    const into = this.#destination
    if (into) {
      const addLabel = tCount('collections-landing.add-to',
        'Add {count} tile to {name}', 'Add {count} tiles to {name}', { count, name: into.label })
      const add = document.createElement('button')
      add.className = 'ai-staged-add'
      add.type = 'button'
      add.dataset['hcRow'] = 'staged-add'
      add.textContent = addLabel
      add.setAttribute('aria-label', addLabel)
      add.title = t('collections-landing.add-hint',
        'Adds a doorway in {name} — the tiles stay where they live', { count, name: into.label })
      add.addEventListener('click', () => { void this.#addStaged() })
      staged.appendChild(add)

      if (this.#canMove) {
        const moveLabel = tCount('collections-landing.move-to',
          'Move {count} tile into {name}', 'Move {count} tiles into {name}', { count, name: into.label })
        const move = document.createElement('button')
        move.className = 'ai-staged-move'
        move.type = 'button'
        move.dataset['hcRow'] = 'staged-move'
        move.setAttribute('aria-label', moveLabel)
        move.title = t('collections-landing.move-hint',
          'Files them away in {name} — they leave the page they were on', { count, name: into.label })
        const text = document.createElement('span')
        text.className = 'ai-staged-move-label'
        text.textContent = moveLabel
        move.append(sym('move_down'), text)
        move.addEventListener('click', () => { void this.#moveStaged() })
        staged.appendChild(move)
      }
    } else {
      const label = tk(addKey, { count })
      const add = document.createElement('button')
      add.className = 'ai-staged-add'
      add.type = 'button'
      add.dataset['hcRow'] = 'staged-add'
      add.textContent = label
      add.setAttribute('aria-label', label)
      add.title = label
      add.addEventListener('click', () => { void this.#addStaged() })
      staged.appendChild(add)
    }
    return staged
  }

  // ── one row ───────────────────────────────────────────────────────────

  #buildRow(item: AggregateItem): HTMLElement {
    const renaming = this.#renaming === item.key
    const row = document.createElement('li')
    row.className = 'ai-row'
    if (renaming) row.classList.add('is-renaming')
    if (this.#isSelected(item)) row.classList.add('is-selected')
    // Portals rows double as DROP ZONES for a tile carried by its drag handle
    // (PortalCarryDrone) — the data attribute is the drop contract, the class
    // only lights the row while a carry is live.
    if (this.#portalDropView && this.#portalCarryActive) row.classList.add('is-portal-drop')
    if (this.#portalDropView) row.setAttribute('data-portal-drop', item.key)
    row.style.setProperty('--accent', this.#accent(item.label))

    const open = document.createElement('button')
    open.className = 'ai-row-open'
    open.type = 'button'
    open.dataset['hcRow'] = `open:${item.key}`
    open.setAttribute('aria-label', item.label)
    open.addEventListener('pointerdown', (event) => this.#onRowPointerDown(event, item))
    open.addEventListener('click', () => this.#openItem(item))

    const hex = document.createElement('span')
    hex.className = 'ai-hex'
    hex.appendChild(this.#buildFace(item))
    open.appendChild(hex)
    if (!renaming) {
      const label = document.createElement('span')
      label.className = 'ai-label'
      label.textContent = item.label
      open.appendChild(label)
    }
    row.appendChild(open)

    if (renaming) {
      const form = document.createElement('form')
      form.className = 'ai-rename'
      const input = document.createElement('input')
      input.className = 'ai-rename-input'
      input.type = 'text'
      input.autocomplete = 'off'
      input.dataset['hcRow'] = `rename:${item.key}`
      // The live text, kept in `#renameDraft`, so a re-render underneath the
      // participant (a source announcing a late picture, a `synchronize`)
      // cannot swallow a half-typed name.
      input.value = this.#renameDraft ?? item.label
      input.setAttribute('aria-label', t('aggregate.rename', 'Rename'))
      input.addEventListener('input', () => { this.#renameDraft = input.value })
      // `keydown.escape` in the template — Angular's KeyEventsPlugin composed
      // the binding name from the held modifiers, so it matched ONLY an
      // unmodified press. Guarded here to keep Ctrl/Alt/Shift/Meta-Escape
      // falling through exactly as they did.
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return
        if (event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return
        this.#cancelRename()
      })
      // CANCEL AFTER THE CLICK LANDS, NOT DURING IT. `blur` fires inside the
      // MOUSEDOWN dispatch of whatever you pressed next, and cancelling there
      // rebuilds the whole list — replacing the very button under the pointer,
      // so mouseup lands on a different node, no click is delivered, and the
      // press does nothing. The participant has to click twice. Angular kept
      // the other rows' DOM (only the renaming row's @if subtree swapped), so
      // the first press always landed.
      //
      // `focusout` carries relatedTarget — where focus is GOING. If that is
      // still inside this panel, defer the cancel to a microtask so the click
      // is delivered first; otherwise cancel immediately, exactly as before.
      input.addEventListener('focusout', (event) => {
        const next = (event as FocusEvent).relatedTarget
        if (next instanceof Node && this.contains(next)) {
          queueMicrotask(() => { if (this.#renaming) this.#cancelRename() })
          return
        }
        this.#cancelRename()
      })
      form.addEventListener('submit', (event) => {
        event.preventDefault()
        void this.#commitRename(item, input)
      })
      form.appendChild(input)
      row.appendChild(form)
    } else {
      row.appendChild(this.#buildActions(item))
    }

    // The chain behind this row. Two groups, never merged: what this hive has
    // been, and what the installer holds deployed.
    if (this.#versionsFor === item.key) row.appendChild(this.#buildVersions(item))
    return row
  }

  /** The hex face: the item's picture, or the accent + monogram fallback, so a
   *  row is never a blank slot. */
  #buildFace(item: AggregateItem): HTMLElement {
    if (item.image) {
      const img = document.createElement('img')
      img.className = 'ai-hex-img'
      img.src = item.image
      img.alt = ''
      img.decoding = 'async'
      return img
    }
    const fallback = document.createElement('span')
    fallback.className = 'ai-hex-fallback'
    const monogram = document.createElement('span')
    monogram.className = 'ai-monogram'
    monogram.setAttribute('aria-hidden', 'true')
    monogram.textContent = this.#monogram(item.label)
    fallback.appendChild(monogram)
    return fallback
  }

  #buildActions(item: AggregateItem): HTMLElement {
    const actions = document.createElement('div')
    actions.className = 'ai-actions'

    // Pick it up to apply elsewhere. Its own control, never the row body: the
    // body already means open, and press-and-move already means drag.
    const carried = this.#isCarried(item)
    const carryLabel = t(carried ? 'aggregate.carry.remove' : 'aggregate.carry.add',
      carried ? 'put {name} back down' : 'carry {name} — apply it wherever you walk to',
      { name: item.label })
    const carry = this.#actionButton(`carry:${item.key}`, carried ? 'luggage' : 'add', carryLabel)
    carry.classList.add('ai-action-carry')
    if (carried) carry.classList.add('is-carried')
    carry.setAttribute('aria-pressed', String(carried))
    carry.addEventListener('click', (event) => this.#toggleCarry(item, event))
    actions.appendChild(carry)

    // Pin this portal as home. One pin across the whole list — the store holds
    // a single slot, so lighting this row is what unlights whichever was lit.
    if (this.#canPinHome) {
      const home = this.#isHome(item)
      const homeLabel = t(home ? 'aggregate.home.unpin' : 'aggregate.home.pin',
        home
          ? 'release {name} as home — Home follows the last portal again'
          : 'make {name} your home — Home stops following where you walk',
        { name: item.label })
      const pin = this.#actionButton(`home:${item.key}`, home ? 'home_pin' : 'home', homeLabel)
      pin.classList.add('ai-action-home')
      if (home) pin.classList.add('is-home')
      pin.setAttribute('aria-pressed', String(home))
      pin.addEventListener('click', (event) => this.#toggleHome(item, event))
      actions.appendChild(pin)
    }

    if (this.#canPickVersion) {
      const label = t('aggregate.versions', 'Versions')
      const versions = this.#actionButton(`versions:${item.key}`, 'history', label)
      if (this.#versionsFor === item.key) versions.classList.add('is-active')
      versions.setAttribute('aria-expanded', String(this.#versionsFor === item.key))
      versions.addEventListener('click', (event) => { void this.#toggleVersions(item, event) })
      actions.appendChild(versions)
    }

    if (this.#canRename()) {
      const label = t('aggregate.rename', 'Rename')
      const rename = this.#actionButton(`rename-start:${item.key}`, 'edit', label)
      rename.addEventListener('click', (event) => this.#startRename(item, event))
      actions.appendChild(rename)
    }

    if (this.#canRemove(item)) {
      const label = t('aggregate.remove', 'Remove')
      const remove = this.#actionButton(`remove:${item.key}`, 'delete', label)
      remove.classList.add('ai-action-danger')
      remove.addEventListener('click', (event) => { void this.#remove(item, event) })
      actions.appendChild(remove)
    }
    return actions
  }

  #actionButton(focusKey: string, glyph: string, label: string): HTMLButtonElement {
    const button = document.createElement('button')
    button.className = 'ai-action'
    button.type = 'button'
    // A KEY THIS PANEL OWNS, never a class: four of these share `.ai-action`,
    // and restoring focus by class would put the ring on the FIRST of them —
    // press Rename, get Carry, and the next Enter picks the row up.
    button.dataset['hcRow'] = focusKey
    button.setAttribute('aria-label', label)
    button.title = label
    button.appendChild(sym(glyph))
    return button
  }

  #buildVersions(item: AggregateItem): HTMLElement {
    const box = document.createElement('div')
    box.className = 'ai-versions'
    box.setAttribute('role', 'group')
    box.setAttribute('aria-label', t('aggregate.versions', 'Versions'))

    if (this.#versionsLoading) {
      const note = document.createElement('p')
      note.className = 'ai-versions-note'
      note.textContent = t('aggregate.versions-loading', 'Reading history…')
      box.appendChild(note)
    } else if (this.#versions.length === 0) {
      const note = document.createElement('p')
      note.className = 'ai-versions-note'
      note.textContent = t('aggregate.versions-empty', 'No other versions.')
      box.appendChild(note)
    }

    for (const group of ['local', 'published'] as const) {
      const rows = this.#versionsOf(group)
      if (rows.length === 0) continue
      const head = document.createElement('p')
      head.className = 'ai-versions-head'
      head.textContent = group === 'local'
        ? t('aggregate.versions-local', 'This hive')
        : t('aggregate.versions-published', 'Published')
      box.appendChild(head)

      const list = document.createElement('ul')
      list.className = 'ai-version-list'
      list.setAttribute('role', 'list')
      for (const version of rows) {
        const li = document.createElement('li')
        const button = document.createElement('button')
        button.className = 'ai-version'
        button.type = 'button'
        button.dataset['hcRow'] = `version:${item.key}:${version.sig}`
        if (version.active) button.classList.add('is-active')
        button.disabled = !!version.active || this.#versionsLoading
        button.title = version.sig
        button.addEventListener('click', () => { void this.#chooseVersion(item, version) })

        const label = document.createElement('span')
        label.className = 'ai-version-label'
        label.textContent = version.label
        button.appendChild(label)

        const when = this.#versionTime(version.at)
        if (when) {
          const time = document.createElement('span')
          time.className = 'ai-version-time'
          time.textContent = when
          button.appendChild(time)
        }
        if (version.active) {
          const flag = document.createElement('span')
          flag.className = 'ai-version-flag'
          flag.textContent = t('aggregate.version-active', 'current')
          button.appendChild(flag)
        }
        li.appendChild(button)
        list.appendChild(li)
      }
      box.appendChild(list)
    }
    return box
  }

  // ── the drag ghost ────────────────────────────────────────────────────
  //
  // It follows the cursor across the whole screen, so it must never eat the
  // pointer (the release has to hit the canvas underneath to resolve a drop
  // target) and it must not live inside the panel — `backdrop-filter` on the
  // tag makes it a containing block for fixed descendants.

  #showGhost(item: AggregateItem): void {
    this.#removeGhost()
    const ghost = document.createElement('div')
    ghost.className = 'hc-ai-ghost'
    ghost.setAttribute('aria-hidden', 'true')
    ghost.style.setProperty('--accent', this.#accent(item.label))
    const hex = document.createElement('span')
    hex.className = 'ai-ghost-hex'
    hex.appendChild(this.#buildFace(item))
    const label = document.createElement('span')
    label.className = 'ai-ghost-label'
    label.textContent = item.label
    ghost.append(hex, label)
    document.body.appendChild(ghost)
    this.#ghostEl = ghost
  }

  /** Mutating the node that is already there — a position update, not a
   *  rebuild. Re-rendering the panel on every pointermove would replace the row
   *  button under the gesture and lose the click that has to be swallowed. */
  #moveGhost(x: number, y: number): void {
    const ghost = this.#ghostEl
    if (!ghost) return
    ghost.style.left = `${x}px`
    ghost.style.top = `${y}px`
  }

  #removeGhost(): void {
    this.#ghostEl?.remove()
    this.#ghostEl = null
  }

  // ── reading the rows ──────────────────────────────────────────────────

  #sourceChanged = (): void => { void this.#reload() }

  /** Re-read the rows — SINGLE-FLIGHT.
   *
   *  A full read is expensive (a layer plus a reference decoration per row) and
   *  it has many triggers: the awaited call after a write, the `synchronize`
   *  the same write's pulse dispatches, a navigation, the source announcing a
   *  late picture. Each used to start its OWN pass, so one Add ran the whole
   *  rebuild about three times over, all racing for the same OPFS files.
   *
   *  So a caller arriving mid-read JOINS it, and its request is honoured as ONE
   *  trailing pass afterwards — never dropped, because a trigger that landed
   *  during the read may be reporting a commit that read just missed. */
  async #reload(): Promise<void> {
    if (this.#reloading) {
      this.#reloadAgain = true
      return this.#reloading
    }
    const run = async (): Promise<void> => {
      do {
        this.#reloadAgain = false
        await this.#readRows()
      } while (this.#reloadAgain)
    }
    this.#reloading = run().finally(() => { this.#reloading = null })
    return this.#reloading
  }

  async #readRows(): Promise<void> {
    const src = this.#source
    if (!src || !this.#open) return
    this.#bindSourceChanges(src)
    try { this.#items = await src.items() } catch { /* keep the last good list */ }
    this.#sync()
  }

  /** Listen to the ACTIVE source's own change signal — how it reports pictures,
   *  keywords and titles that resolved after `items()` had already answered.
   *  One subscription at a time: a source we have switched away from has no
   *  business making this panel re-read. */
  #bindSourceChanges(src: AggregateSource): void {
    if (this.#boundSource === src) return
    this.#boundSource?.changed?.removeEventListener('change', this.#sourceChanged)
    this.#boundSource = src
    src.changed?.addEventListener('change', this.#sourceChanged)
  }

  // ── filtering ─────────────────────────────────────────────────────────
  //
  // No tag toggles here. This window still LISTENS to `tags:filter`, so a
  // keyword chosen on the one pheromone surface still narrows the list — it
  // just has no second set of chips of its own to choose it from.

  #clearFilter(): void {
    this.#query = ''
    if (this.#activeTags.size === 0) { this.#sync(); return }
    this.#activeTags = new Set()
    EffectBus.emit('tags:filter', { active: [], scope: this.#filterScope })
    this.#sync()
  }

  // ── rows ──────────────────────────────────────────────────────────────

  #openItem(item: AggregateItem): void {
    if (this.#swallowClick) { this.#swallowClick = false; return }
    if (this.#renaming === item.key) return
    this.#source?.open(item)
  }

  /** Whether this row is the collection currently being managed (the hive is
   *  standing in it), so the list shows WHICH one you stepped into. */
  #isSelected(item: AggregateItem): boolean {
    return sameSegments(item.segments, this.#here)
  }

  /** Deterministic per-item accent (hue from the label) — each row gets its own
   *  identity tint, the same idea as the hive's label-derived colours. */
  #accent(label: string): string {
    let h = 5381
    for (let i = 0; i < label.length; i++) h = ((h << 5) + h + label.charCodeAt(i)) | 0
    return `hsl(${(h >>> 0) % 360} 62% 64%)`
  }

  /** Initial(s) for an item with no picture, so an imageless row still says
   *  WHICH item it is rather than showing a generic icon. */
  #monogram(label: string): string {
    const w = (label ?? '').trim().split(/\s+/).filter(Boolean)
    if (!w.length) return '·'
    if (w.length === 1) return [...w[0]].slice(0, 2).join('').toUpperCase()
    return ([...w[0]][0] + [...w[1]][0]).toUpperCase()
  }

  #canRemove(item: AggregateItem): boolean {
    const src = this.#source
    if (!src?.remove) return false
    return src.canRemove ? src.canRemove(item) : true
  }

  #canRename(): boolean { return !!this.#source?.rename }

  // ── versions ──────────────────────────────────────────────────────────
  //
  // One row at a time. The list is a chain, and two of them open at once reads
  // as one long list of versions belonging to nothing in particular.

  /** Open (or put away) the chain behind a row. Loading is signalled rather
   *  than awaited silently — a site with a long lineage takes a moment, and an
   *  empty panel that later fills in reads as "no versions". */
  async #toggleVersions(item: AggregateItem, event?: Event): Promise<void> {
    event?.stopPropagation()
    if (this.#versionsFor === item.key) { this.#closeVersions(); this.#sync(); return }

    const src = this.#source
    if (!src?.versions) return
    this.#versionsFor = item.key
    this.#versions = []
    this.#versionsLoading = true
    this.#sync()

    let rows: readonly AggregateVersion[] = []
    try { rows = await src.versions(item) } catch { /* an unreadable chain is an empty one */ }
    // The row may have been closed (or another opened) while we read.
    if (this.#versionsFor !== item.key) return
    this.#versions = rows
    this.#versionsLoading = false
    this.#sync()
  }

  /** The rows of ONE chain, in the order the source gave them. Split rather
   *  than concatenated so the two never read as a single timeline. */
  #versionsOf(origin: AggregateVersion['origin']): readonly AggregateVersion[] {
    return this.#versions.filter(v => v.origin === origin)
  }

  /** "2026-07-26 14:03", or nothing when the chain doesn't know. */
  #versionTime(at?: number): string {
    if (!at) return ''
    const d = new Date(at)
    if (Number.isNaN(d.getTime())) return ''
    const pad = (n: number): string => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  /** Choose a version. The chain is re-read afterwards rather than patched in
   *  place: what "active" now means is the source's answer, not ours — a
   *  published pick can be refused by the installer and the list must say so. */
  async #chooseVersion(item: AggregateItem, version: AggregateVersion): Promise<void> {
    const src = this.#source
    if (!src?.useVersion || version.active) return
    this.#versionsLoading = true
    this.#sync()
    try { await src.useVersion(item, version) } catch { /* the re-read tells the truth */ }
    if (this.#versionsFor !== item.key) return
    try { this.#versions = await src.versions?.(item) ?? [] } catch { /* keep the last good list */ }
    this.#versionsLoading = false
    this.#sync()
    await this.#reload()
  }

  #closeVersions(): void {
    this.#versionsFor = null
    this.#versions = []
    this.#versionsLoading = false
  }

  // ── manage ────────────────────────────────────────────────────────────

  /** Make what is typed. The + and Enter are the same act — there is only one
   *  thing this field can commit — and both are inert unless `#creatable`, so
   *  Enter while merely narrowing the list does nothing rather than minting a
   *  second row for a name that is already there.
   *
   *  The field is CLEARED on success, which also drops the filter: you have
   *  just made the thing you were looking for, so the list should show it among
   *  its siblings rather than stay narrowed to the one word you typed. */
  async #submitCreate(): Promise<void> {
    if (!this.#creatable) return
    const src = this.#source
    const name = this.#draft
    if (!src?.create || !name) return
    let added: AddedRows
    // A failed create leaves the typing intact so it can be retried.
    try { added = await src.create(name) } catch { return }
    this.#query = ''
    this.#showAdded(added)
    this.#focusSoon('.ai-filter-input')
  }

  #startRename(item: AggregateItem, event?: Event): void {
    event?.stopPropagation()
    this.#renaming = item.key
    this.#renameDraft = null
    this.#sync()
    this.#focusSoon('.ai-rename-input')
  }

  #cancelRename(): void {
    if (!this.#renaming) return
    this.#renaming = null
    this.#renameDraft = null
    this.#sync()
  }

  async #commitRename(item: AggregateItem, input: HTMLInputElement): Promise<void> {
    const src = this.#source
    const next = safeCellName(input.value)
    if (!src?.rename || !next || next === item.label) {
      this.#renaming = null
      this.#renameDraft = null
      this.#sync()
      return
    }
    try { await src.rename(item, next) } catch { /* fall through — close the field */ }
    this.#renaming = null
    this.#renameDraft = null
    this.#sync()
    await this.#reload()
  }

  // ── carrying ──────────────────────────────────────────────────────────

  #isCarried(item: AggregateItem): boolean {
    return this.#carried.some(c => c.key === item.key)
  }

  /** Pick a row up, or put it back down. Its own control, never the row body. */
  #toggleCarry(item: AggregateItem, event?: Event): void {
    event?.stopPropagation()
    this.#carried = this.#isCarried(item)
      ? this.#carried.filter(c => c.key !== item.key)
      : [...this.#carried, item]
    this.#sync()
  }

  #dropCarried(): void {
    this.#carried = []
    this.#sync()
  }

  // ── pin as home ───────────────────────────────────────────────────────
  //
  // Home follows the last portal you walked, which is right while you are still
  // finding the thing and wrong once you have found it. Pinning stops the
  // drift: the pin outranks the walk. Portals only.

  #isHome(item: AggregateItem): boolean {
    return !!this.#portals?.isPinned(item.segments)
  }

  /** Pin this row as home, or release it if it already is. Mutually exclusive
   *  by construction — the store holds ONE pin, so pinning another is what
   *  releases this one. */
  #toggleHome(item: AggregateItem, event?: Event): void {
    event?.stopPropagation()
    this.#portals?.togglePin(item.label, item.segments)
    this.#sync()
  }

  /**
   * Apply everything carried, here — one reference per item, at the page in
   * front of you.
   *
   *   • A reference per item. Nothing is copied; the target is untouched.
   *   • The bouquet in hand, if any, onto the NEW REFERENCE CELLS. Applying a
   *     batch is exactly when a shared mark earns its keep, and the mark belongs
   *     on the incidence, never on the target.
   *   • NOT the marks the source references carry. A mark on `friends/susan`
   *     says something about THAT membership.
   *
   * One pulse for the whole batch: a pulse awaits every bee and repaints the
   * hive, so it is priced per gesture.
   */
  async #applyCarried(): Promise<void> {
    const items = this.#carried
    if (items.length === 0) return
    const here = this.#hereNow()

    // ── A NAME IS AN ADDRESS, so an occupied one must be REFUSED ─────────
    //
    // `sha256(lineageKey([...here, name]))` is the whole identity of the tile
    // this would create. If something already answers to that name here, the
    // commit does not make a second tile — it appends a marker to the EXISTING
    // one, quietly turning that tile into a reference. Caught in the browser:
    // applying `people` at the root wrote into the real `people` collection.
    //
    // So an occupied address is skipped and counted, never merged and never
    // auto-suffixed: `people-2` is a name nobody chose.
    const seen = new Set<string>()
    const created: string[] = []
    let skipped = 0
    for (const item of items) {
      const name = safeCellName(item.label)
      // Two rows can carry the same label from different collections; the
      // second would land on the first's address.
      if (!name || seen.has(name)) { skipped++; continue }
      seen.add(name)
      if (await this.#addressTaken([...here, name])) { skipped++; continue }
      const made = await dropReferenceTile(item, here)
      if (made) created.push(made)
    }
    if (created.length === 0) {
      this.#dropCarried()
      if (skipped > 0) {
        this.#toast(
          t('aggregate.apply.none.title', 'Nothing applied'),
          tCount('aggregate.apply.none.message',
            'That name is already taken here.', '{count} already answer to that name here.',
            { count: skipped }))
      }
      return
    }

    // Scent the batch BEFORE the pulse, so the references and their marks reach
    // the hive in the same repaint rather than as a tile that flickers unmarked.
    const marks = this.#brushMarks
    if (marks.length) for (const name of created) await dropTagsOnTile(marks, [...here, name])

    await new hypercomb().act()
    this.#dropCarried()
    // `tags:changed` carries `{updates:[{cell,tag}]}` — every other emitter in
    // the app sends that shape and its handlers iterate it, so a `{segments}`
    // payload throws inside the bus handler instead of failing visibly.
    if (marks.length) {
      EffectBus.emit('tags:changed', {
        updates: created.flatMap(cell => marks.map(tag => ({ cell, tag }))),
      })
    }

    const page = this.#hereLabel || 'home'
    const count = created.length
    const tail = skipped > 0
      ? ' ' + tCount('aggregate.applied.skipped',
        '1 skipped — already named here.', '{count} skipped — already named here.', { count: skipped })
      : ''
    const message = marks.length
      ? tCount('aggregate.applied.marked',
        '1 reference, scented {marks}.', '{count} references, scented {marks}.',
        { count, page, marks: marks.join(', ') })
      : tCount('aggregate.applied.message',
        '1 reference landed on {page}.', '{count} references landed on {page}.',
        { count, page, marks: marks.join(', ') })
    this.#toast(
      tCount('aggregate.applied.title', 'Applied 1', 'Applied {count}',
        { count, page, marks: marks.join(', ') }),
      message + tail)
    void this.#reload()
  }

  /** Is this location already spoken for? A bag that has ever been committed
   *  answers, which is deliberately conservative: committing onto a name whose
   *  tile was removed resurrects that lineage rather than starting a new one. */
  async #addressTaken(segments: readonly string[]): Promise<boolean> {
    const history = get<{
      sign(l: { explorerSegments?: () => readonly string[] }): Promise<string>
      currentLayerAt(sig: string): Promise<unknown | null>
    }>('@diamondcoreprocessor.com/HistoryService')
    if (!history?.sign) return false
    try {
      const sig = await history.sign({ explorerSegments: () => [...segments] })
      return !!(await history.currentLayerAt(sig))
    } catch { return false }   // unknowable → let the write decide
  }

  #toast(title: string, message: string): void {
    EffectBus.emit('toast:show', { type: 'info', title, message })
  }

  /** Commit the staged selection as members. The canvas selection is cleared
   *  afterwards: the staged rows have become real ones, and leaving them
   *  selected would offer to add what was just added. */
  async #addStaged(): Promise<void> {
    const src = this.#source
    const entries = this.#staged
    if (!src?.add || entries.length === 0) return
    // Destination is the page we are standing on when that page is one of our
    // collections; otherwise the index itself.
    let added: AddedRows = undefined
    try { added = await src.add(entries, this.#destination ?? undefined) }
    catch { /* fall through — the re-read shows the truth */ }
    this.#dropStaged()
    this.#showAdded(added)
  }

  /** A tile was dropped (via its drag handle) onto one of our portal rows —
   *  add it to THAT portal, wherever we happen to be standing. Same write as
   *  Add: a reference in the portal, pointing at where the tile lives.
   *
   *  Guards mirror the staged-tray rule from the other direction: the portal
   *  itself, and a tile that already lives inside it, are already "in there".
   *
   *  A REPLAYED `portal-carry:drop` (the bus hands the last value to a late
   *  subscriber) finds no matching row — `#items` is empty until the panel has
   *  opened and read — so it lands nothing. */
  async #onPortalCarryDrop(p: { label?: string; segments?: string[]; targetKey?: string } | null): Promise<void> {
    const src = this.#source
    if (!src?.add || !this.#portalDropView) return
    const item = this.#items.find(i => i.key === String(p?.targetKey ?? ''))
    const label = String(p?.label ?? '').trim()
    const segments = (p?.segments ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
    if (!item || !label || segments.length === 0) return
    if (sameSegments(segments, item.segments) || sameSegments(segments.slice(0, -1), item.segments)) {
      EffectBus.emit('activity:log', { message: `"${label}" is already in "${item.label}"`, icon: '○' })
      return
    }
    try { await src.add([{ label, segments }], item) }
    catch { return }
    EffectBus.emit('activity:log', { message: `added "${label}" to "${item.label}"`, icon: '◈' })
    void this.#reload()
  }

  /** File the staged tiles away INTO the collection we are standing in — they
   *  leave the page they were picked on and land here.
   *
   *  No optimistic row: a move does not change THIS list (the collection is
   *  already a row in it), it changes what that collection holds — and the
   *  tiles land on the page in front of you, which is feedback enough. */
  async #moveStaged(): Promise<void> {
    const src = this.#source
    const into = this.#destination
    const entries = this.#staged
    if (!src?.move || !into || entries.length === 0) return
    try { await src.move(entries, into) }
    catch { /* fall through — the re-read shows the truth */ }
    this.#dropStaged()
    this.#sync()
    void this.#reload()
  }

  /** Save the page we are standing on into the index. */
  async #addHere(): Promise<void> {
    const src = this.#source
    const segments = this.#here
    if (!src?.add || !this.#canAddHere) return
    let added: AddedRows = undefined
    try { added = await src.add([{ label: this.#hereLabel, segments }]) }
    catch { /* fall through — the re-read shows the truth */ }
    this.#showAdded(added)
  }

  /** Put what a gesture just wrote on screen NOW, then re-read in the
   *  background.
   *
   *  The write is a few milliseconds of local OPFS; re-deriving every row is
   *  not. Awaiting the re-read before showing anything is what made the
   *  Organizer feel slow — the row you asked for existed almost immediately but
   *  stayed invisible until every OTHER row had been re-resolved too.
   *
   *  Rows are shown only AFTER the write resolved, never before: an optimistic
   *  row for a commit that failed is a lie the panel would have no way to take
   *  back. The re-read is deliberately not awaited. */
  #showAdded(added: AddedRows): void {
    const rows = added ?? []
    if (rows.length) {
      const known = new Set(this.#items.map(i => i.key))
      const fresh = rows.filter(r => !known.has(r.key))
      if (fresh.length) this.#items = [...this.#items, ...fresh]
    }
    this.#sync()
    void this.#reload()
  }

  async #remove(item: AggregateItem, event?: Event): Promise<void> {
    event?.stopPropagation()
    const src = this.#source
    if (!src?.remove || !this.#canRemove(item)) return
    try { await src.remove(item) } catch { return }
    await this.#reload()
  }

  /** Empty the tray — after a completed gesture, on the way back to the origin,
   *  or on any navigation. Clears the canvas selection with it, so the tray and
   *  the highlighted tiles can never disagree. */
  #dropStaged(): void {
    withSelectionService(s => s.clear())
    this.#selection = []
  }

  // ── drag → drop meaning ───────────────────────────────────────────────

  #onRowPointerDown(event: PointerEvent, item: AggregateItem): void {
    if (event.button !== 0) return
    if (this.#renaming === item.key) return
    this.#pending = { item, x: event.clientX, y: event.clientY }
    document.addEventListener('pointermove', this.#onDragMove)
    document.addEventListener('pointerup', this.#onDragUp)
    // A native drag or touch pan steals the gesture and we get pointercancel
    // with no pointerup — without this the ghost hangs and the listeners leak.
    document.addEventListener('pointercancel', this.#onDragCancel)
  }

  #detachDrag(): void {
    document.removeEventListener('pointermove', this.#onDragMove)
    document.removeEventListener('pointerup', this.#onDragUp)
    document.removeEventListener('pointercancel', this.#onDragCancel)
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

  #onDragMove = (event: PointerEvent): void => {
    const p = this.#pending
    if (!p) return
    if (!this.#dragging) {
      if (Math.hypot(event.clientX - p.x, event.clientY - p.y) < DRAG_THRESHOLD) return
      this.#dragging = p.item
      this.#showGhost(p.item)
      EffectBus.emit('drop:dragging', { active: true })
    }
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
    // The row button is NOT rebuilt by any of this (the ghost is the only thing
    // the drag renders), so the click that follows this pointerup still lands on
    // the same node — which is what gives `#openItem` something to swallow.
    this.#swallowClick = true

    // RELEASE POINT, not a remembered hover — see the header note.
    const overlay = get<OverlayLike>('@diamondcoreprocessor.com/TileOverlayDrone')
    const label = overlay?.labelAtClient?.(event.clientX, event.clientY) ?? null

    // A release still over this panel is a cancelled drag, not a drop on the
    // hive — otherwise letting go on the list would silently write.
    const el = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null
    if (el?.closest?.(SURFACE_NAME)) return

    void this.#applyDrop(p.item, label)
  }

  async #applyDrop(item: AggregateItem, label: string | null): Promise<void> {
    const here = (this.#lineage?.explorerSegments?.() ?? []).map(String)
    if (label) {
      // ── Dropped ON a tile → the item becomes that tile's CONTEXT ───────
      //
      // There is no room on an occupied hex, so this drop cannot mean "put it
      // here"; it says something about the TILE — that answering questions
      // about it means knowing about the dropped place too. Written as a live
      // pointer, so the context follows the source rather than freezing a copy.
      const attached = await dropContextOnTile(item, [...here, label])
      await new hypercomb().act()
      this.#toast(
        attached
          ? t('aggregate.context.added.title', 'Context attached')
          : t('aggregate.context.failed.title', 'Could not attach'),
        attached
          ? t('aggregate.context.added.message', '“{name}” now informs questions about “{cell}”.',
            { name: item.label, cell: label })
          : t('aggregate.context.failed.message', '“{name}” could not be attached to “{cell}”.',
            { name: item.label, cell: label }))
      return
    }
    // ── Dropped on empty hive → THE NAME IS ASKED FOR ────────────────────
    //
    // A reference mints a new LOCATION, and a location's name IS its address
    // (`sha256(lineageKey(segments))`). So the name cannot be an afterthought.
    //
    // Rather than grow a dialog mid-gesture, the drop COMPOSES the command that
    // already does this correctly and hands it over with the name selected:
    // Enter takes the target's own name, typing replaces it. One writer
    // (`/reference <name> = <path>`), one place where the name is decided.
    //
    // THE FILTER IS PRE-WRITTEN: a portal can demand pheromones of what it
    // shows ("People, but only family"), and a tail nobody knows about is a
    // tail nobody types — so the BRUSH writes the first one.
    const path = item.segments.map(s => String(s ?? '')).filter(Boolean).join('/')
    const name = safeCellName(item.label) || (item.segments[item.segments.length - 1] ?? '')
    if (!path || !name) return
    const head = '/reference '
    const marks = this.#brushMarks
    const tail = marks.length ? ` + ${marks.join(', ')}` : ''
    EffectBus.emit('search:prefill', {
      value: `${head}${name} = ${path}${tail}`,
      focus: true,
      // The NAME is selected, never the tail: naming is the decision the drop
      // could not make for you, and the filter is one you have already made.
      select: [head.length, head.length + name.length],
      // The dragged row's own face, in the glyph slot — so the line says WHAT
      // it is about while you are busy deciding what to call it.
      subject: { previewUrl: item.image, label: item.label, icon: 'conversion_path' },
    })
  }

  // ── location ──────────────────────────────────────────────────────────

  #ensureLineage(): void {
    if (this.#lineageBound) return
    const l = get<LineageLike>('@hypercomb.social/Lineage')
    if (l?.addEventListener) {
      this.#lineage = l
      l.addEventListener('change', this.#onLineage)
      this.#lineageBound = true
    }
  }

  /** NAVIGATION DROPS THE CAPTURE (Jaime, 2026-07-28): "save tile to organizer
   *  or places … has to reset and lose that selection when navigation happens."
   *  A tray that follows you around the hive keeps offering to file tiles you
   *  picked on a page you have since left, and the offer reads as live because
   *  the buttons are still lit.
   *
   *  This REVERSES the survive-the-hop behaviour the tray used to have, and the
   *  cost is one flow: "select tiles → step INTO the collection → press Add" can
   *  no longer complete. Picking the destination from the panel's own row does
   *  the same job without moving the hive, and still works. */
  #onLineage = (): void => {
    this.#dropStaged()
    this.#refresh()
  }

  /** The hive's current location as clean segments. */
  #hereNow(): readonly string[] {
    this.#ensureLineage()
    return (this.#lineage?.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim()).filter(Boolean)
  }

  /** Arriving at a source's own location opens its index; leaving does NOT
   *  close the panel (a tool window you opened stays open while you walk
   *  around). Only a fresh ARRIVAL re-opens it after a close. */
  #refresh(): void {
    const segs = this.#hereNow()
    this.#here = segs
    const src = sourceForLocation(segs)
    const arrived = !!src && !this.#atSource
    this.#atSource = !!src

    if (src) this.#source = src
    // Walking ONTO the index page (e.g. /sets) still opens it. That arrival is
    // its own origin — there is nowhere else to go back to.
    if (arrived) {
      if (!this.#open) this.#origin = segs
      this.#open = true
    }
    if (this.#open) { this.#sync(); void this.#reload() }
    else { this.#renaming = null; this.#renameDraft = null; this.#sync() }
  }

  #focusSoon(selector: string): void {
    if (this.#focusTimer) clearTimeout(this.#focusTimer)
    this.#focusTimer = window.setTimeout(() => {
      this.#focusTimer = 0
      const el = this.querySelector(selector) as HTMLInputElement | null
      el?.focus()
      el?.select?.()
    }, 0)
  }
}

// ── shell surface registration — the externalization path ─────────────────
// Same name, same order band the Angular component held; the module-side
// `element:` shape (documentation/shell-surfaces.md).
// DEFINED AT MODULE SCOPE, registered when a registry appears. A host with no
// ShellSurfaceRegistry (diamond-core-processor mounts these tags directly in
// its own template) still needs the tag to be a real element rather than an
// inert unknown one — so the define cannot wait on the registry. Only the ADD
// does.
if (!customElements.get(SURFACE_NAME)) {
  customElements.define(SURFACE_NAME, AggregateIndexElement)
}

window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/AggregateIndexElement',
    element: SURFACE_NAME,
    order: 61,
  })
})
