// diamondcoreprocessor.com/history/history-viewer.view.ts — THE HISTORY
// VIEWER, as a framework-free custom element (everything-is-a-beehavior
// Phase 2: Angular panels leave the shell and ship as signed modules).
//
// A straight port of shared/ui/history-viewer: same surface name
// (hc-history-viewer), same order band (2 — nearly the lowest in the registry,
// so it paints UNDER almost everything; deliberate, and kept exactly), the
// same panel id ('history-viewer', which is the key the participant's saved
// width `hc:docked-width:history-viewer`, their pinned text size, their code
// font and their tool-window group membership all hang off — changing it
// orphans all three), the same dock side and width ladder (left, 240 / 1200 /
// 420, scale 0.72–1), the same five effects in and one effect out.
//
// It lands in `history/` beside the two services it reads (HistoryService,
// HistoryCursorService), the activity log and the rewind window — the domain
// that owns what happened. `history/prune.queen.ts`, the word that opens it,
// is already here too.
//
// ── WHAT IT IS FOR ─────────────────────────────────────────────────────────
//
// Left-edge panel listing every layer entry for the current location. Each row
// shows the index, a diff summary of what changed against the previous entry,
// and a category colour for the dominant kind of change. Clicking a row seeks
// the HistoryCursor there. It is a REFLECTION CONTRACT: every filename in the
// lineage's sigbag becomes a row, including markers whose JSON will not parse
// (they surface as "(unparseable)"), so the header count and the visible-row
// count are equal by construction. No silent drops — this is the participant's
// own past, and it is never reformatted, truncated or re-ordered.
//
// ── LIFECYCLE NOTE ─────────────────────────────────────────────────────────
//
// The Angular version wrapped EVERYTHING — the docked aside and the slice
// inspector both — in `@if (visible())`, so none of it existed in the DOM at
// rest. A registry-fed element is mounted ONCE at boot and stays, so DOM
// presence and ENGAGEMENT are split the way DockedPanelElement splits them:
// `activate()` builds + claims the lane + joins the session, `deactivate()`
// tears all of that down and clears the children. `#show()` / `#hide()` are
// those two calls plus the `.open` class, and the host starts hidden — a panel
// that flashed on boot would be claiming an edge lane nobody asked for.
//
// Because the host IS the panel (DockedPanelElement sizes, positions, grips
// and measures `this`), the Angular `:host { position: fixed; inset: 0;
// pointer-events: none }` full-bleed wrapper is gone from the tag and the
// `.history-viewer` rules land on it instead — the sequence-viewer precedent.
// The inset reporting the old `hcDockInset="left"` directive did is folded
// into the same base.
//
// THE ONE THING THAT COULD NOT STAY WHERE IT WAS: the slice inspector. In the
// original it was a SIBLING of the aside inside that full-bleed host. Here the
// host is the panel, and the panel carries `backdrop-filter: blur(14px)` from
// `tw.panel` — which makes it a containing block for `position: fixed`
// descendants. A modal left inside would centre itself on the 420px panel
// instead of the screen. So the inspector is re-parented into a wrapper that
// reproduces the old `:host` exactly (fixed, inset 0, pointer-events none,
// z-index 100002), inserted immediately AFTER this tag in the surfaces host so
// it keeps the order-2 stacking position it always had. Its rules are scoped
// by `[data-hc-history-slice]` rather than the tag name for the same reason —
// every class name inside is unchanged.
//
// RENDER STRATEGY. Rebuild-on-change everywhere it is safe; a per-panel
// `Map<filename, row>` for the timeline rows, which is the sanctioned
// exception:
//   • `history:cursor-changed` is a STREAM while the slider is scrubbed —
//     every drag tick delivers a new position. Angular's `@for … track`
//     kept the `<li>`s and only re-evaluated `[class.active]`. So a tick
//     mutates classes on live nodes; rebuilding the list per tick would be
//     the regression.
//   • a row can hold the inline RENAME INPUT. Angular's `@if (isEditing…)`
//     only swapped that one cell, so a reload underneath a half-typed name
//     never took the caret. Re-creating the `<li>` would drop focus to
//     <body> — so rows are kept, moved with an anchor walk (which SKIPS a
//     node already in place, because `insertBefore` on a node that already
//     has a parent is a remove-then-insert), and mutated in place.
// Departed rows leave BEFORE the walk, never during it.
//
// Its strings ship WITH it (history-viewer.i18n.ts, extracted from all 14
// shell catalogs) and register under the 'app' namespace, so every key
// resolves exactly as before — the Phase 2 catalog split, another slice.
// `history.back` is SHARED with the shell's still-Angular `history-component`
// (the browser back/forward strip); it is carried in both catalogs on purpose
// — a surface must carry everything it renders.

import {
  EffectBus, I18N_IOC_KEY, IconRef,
  type IconRef as IconRefType, type I18nProvider,
} from '@hypercomb/core'
import { DockedPanelElement } from '../panels/docked-panel.element.js'
import { HISTORY_VIEWER_TRANSLATIONS } from './history-viewer.i18n.js'

const SURFACE_NAME = 'hc-history-viewer'

/** The scope for the re-parented slice inspector — see the header note. */
const SLICE_SCOPE = 'data-hc-history-slice'

const CURSOR_KEY = '@diamondcoreprocessor.com/HistoryCursorService'
const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const STORE_KEY = '@hypercomb.social/Store'
const NAVIGATION_KEY = '@hypercomb.social/Navigation'

const SVG_NS = 'http://www.w3.org/2000/svg'

type CursorState = {
  locationSig: string
  position: number
  total: number
  rewound: boolean
  at: number
  groupStepEnabled?: boolean
}

type LayerEntry = { layerSig: string; at: number; index: number; filename: string }

// Layer shape: `name` (intrinsic) plus an open bag of slots, each holding an
// array of sigs or inline payloads. The viewer is slot-agnostic — it renders
// every non-empty slot the layer carries (children, notes, tags, future
// participants).
type Content = {
  name?: string
  [slot: string]: unknown
}

/** What `HistoryService.readMarker` hands back for one marker file. */
type MarkerRead = {
  bytes: ArrayBuffer
  parsed: Content | null
  layerSig: string
  at: number
  rawText: string
}

type HistoryService = {
  /** Cheap list of marker filenames in the bag — names only, no parse.
   *  Reflection contract: this is the canonical "what marker files exist
   *  right now in the lineage's sigbag (`<sign(lineage)>/` at the OPFS
   *  root)" view — HistoryService unions the legacy sources underneath while
   *  they drain, highest marker wins. Called fresh on every reload. */
  listMarkerFilenames?(locationSig: string): Promise<readonly string[]>
  /** Resolve one marker by filename. Cached at the viewer by filename, so
   *  this fires at most once per (bag, filename) pair per session. */
  readMarker?(locationSig: string, filename: string): Promise<MarkerRead | null>
  /** Legacy path — kept for back-compat callers. */
  listLayers(locationSig: string): Promise<LayerEntry[]>
  getLayerContent?(locationSig: string, layerSig: string): Promise<Content | null>
  /** Cross-bag layer lookup by content sig. The drill-down click uses this so
   *  the user can walk into any layer the system has minted. */
  getLayerBySig?(layerSig: string): Promise<Content | null>
  promoteToHead?(locationSig: string, layerSig: string): Promise<string | null>
  removeEntries?(locationSig: string, filenames: string[]): Promise<number>
  mergeEntries?(locationSig: string, filenames: string[]): Promise<string | null>
  projectMerge?(locationSig: string, filenames: string[]): Promise<Content | null>
  readMarkerMeta?(locationSig: string, filename: string): Promise<{ label?: string; marked?: boolean } | null>
  setMarkerMeta?(locationSig: string, filename: string, meta: { label?: string; marked?: boolean; path?: readonly string[] }): Promise<void>
  /** Every marked point across the whole tree (the "marked places" list). */
  listMarkedPoints?(): Promise<Array<{ locationSig: string; filename: string; label: string | null; path: string[] | null; at: number }>>
  pruneExpiredDeletes?(locationSig: string): Promise<number>
}

type CursorService = {
  state: CursorState
  seek(position: number): void
  setGroupStepEnabled?(on: boolean): void
  // Bag-mutating ops in this viewer (promote / merge / remove) bypass
  // LayerCommitter, so the cursor never hears about the new/dropped marker on
  // its own. Without a refresh, cursor.state.total stays stale and a follow-up
  // seek(total) is a no-op (same position → early return → no synchronize →
  // canvas doesn't repaint).
  refreshForLocation?(locationSig: string): Promise<void>
  onNewLayer?(): Promise<void>
}
type Store = { getResource(sig: string): Promise<Blob | null> }
type NavigationService = {
  segmentsRaw(): string[]
  goRaw(segments: readonly string[]): void
}

type Category = 'cells' | 'content' | 'tags' | 'notes' | 'visibility' | 'system' | 'none'

type Slice = {
  label: string
  lines: ReadonlyArray<{ text: string; status: 'same' | 'add' | 'remove' }>
  /** Raw JSON of the layer at this slice — copy button source. */
  json: string
  /** Inflated tile properties (the 0000 resource at `properties[0]`) formatted
   *  as pretty JSON. Null when the layer carries no `properties` slot or when
   *  the resource fails to resolve / parse.
   *
   *  MUTATED IN PLACE by the async hydrate (the Angular original replaced the
   *  whole slice object because a signal demanded a new reference; here the
   *  object identity is what tells `#renderSlice` "same slice, only the 0000
   *  section arrived" — so the inspector's scroll position survives, exactly
   *  as it did when Angular appended the section without touching the `<pre>`). */
  properties: string | null
}

type Row = {
  index: number
  at: number
  label: string
  when: string
  active: boolean
  summary: string
  category: Category
  filename: string
  // A cascade row is a layer entry whose children sigs changed but whose tile
  // NAMES (the stable identity — there is no rename op) did not: the
  // structural fingerprint of lineage pull-up. Used to collapse contiguous
  // cascade runs in the viewer.
  isCascade: boolean
  // Marker annotation (participant timeline metadata, stored on the marker
  // record). `marked` lights the ★; `markLabel` (when set) is the user's name
  // for this point, shown in place of the auto summary and editable inline.
  marked: boolean
  markLabel: string | null
}

// Category taxonomy, decorated with an optional IconRef. Adding a new op-kind
// is just appending a row here.
type CategoryDef = {
  readonly id: Category
  readonly color: string
  readonly icon?: IconRefType
}

const HISTORY_CATEGORIES: readonly CategoryDef[] = [
  { id: 'cells',      color: '#6dc077', icon: IconRef.path('M12 2 L21 7 V17 L12 22 L3 17 V7 Z') },
  { id: 'content',    color: '#5f8bd9', icon: IconRef.path('M3 21 V17 L15 5 L19 9 L7 21 Z M16 4 L18 2 L22 6 L20 8 Z') },
  { id: 'tags',       color: '#d9c25f', icon: IconRef.path('M3 3 H12 L21 12 L12 21 L3 12 Z M7 7 a1.5 1.5 0 1 0 0.01 0') },
  { id: 'notes',      color: '#b37dd4', icon: IconRef.path('M4 3 H15 L20 8 V21 H4 Z M15 3 V8 H20') },
  { id: 'visibility', color: '#b1b7c2', icon: IconRef.path('M2 12 C5 6 8 4 12 4 C16 4 19 6 22 12 C19 18 16 20 12 20 C8 20 5 18 2 12 Z M12 8 a4 4 0 1 0 0.01 0') },
  { id: 'system',     color: '#e08c4d', icon: IconRef.path('M10 2 H14 L14.5 5 L17 6 L19 4 L22 7 L20 9.5 L21 12 L22 14.5 L19 17 L17 15 L14.5 16 L14 19 H10 L9.5 16 L7 15 L5 17 L2 14 L4 12 L3 9.5 L2 7 L5 4 L7 6 L9.5 5 Z M12 9 a3 3 0 1 0 0.01 0') },
  { id: 'none',       color: 'rgba(255, 255, 255, 0.18)' },
]

const CATEGORY_BY_ID: ReadonlyMap<Category, CategoryDef> = new Map(
  HISTORY_CATEGORIES.map(def => [def.id, def]),
)

const SIG_RE = /^[0-9a-f]{64}$/

const get = <T,>(key: string): T | undefined => window.ioc?.get?.<T>(key)

// Same contract as the shell pipe: the fallback is the English catalog text,
// so a bare host with no i18n reads identically.
const t = (key: string, fallback: string): string => {
  const i18n = get<I18nProvider>(I18N_IOC_KEY)
  const value = i18n?.t(key)
  return value && value !== key ? value : fallback
}

// The panel's strings travel with it — registered as soon as the i18n service
// is up, under 'app' so the keys resolve exactly as they always did.
window.ioc?.whenReady?.(I18N_IOC_KEY, (i18n) => {
  const provider = i18n as I18nProvider
  for (const [locale, catalog] of Object.entries(HISTORY_VIEWER_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

// ── the styles the Angular SCSS carried, expanded to plain CSS ────────────
//
// No shadow DOM (the tutorial-overlay + sequence-viewer precedent), so
// Angular's `:host` becomes the tag name and every other selector is prefixed
// with it. Every rule gains the same one element, so RELATIVE specificity is
// untouched and the original cascade resolves identically — which matters
// here, because `…-header>button[class*='close']` (from `tw.header`) outranks
// `… .close` and therefore keeps owning the close button's width, padding,
// font-size and colour while `.close` keeps its background, border, cursor and
// z-index. That ordering is reproduced verbatim rather than pre-resolved.
//
// TWO EXPANSIONS WORTH NAMING:
//
//  • `@include tw.panel(#7eb6d6, left)` sat in the MIDDLE of `.history-viewer`
//    — the three declarations written after it (font-family, font-size,
//    color) override the mixin's, so the effective values are the ui-monospace
//    stack, `calc(12px * var(--hc-panel-scale,1))` and rgba(235,240,250,.85),
//    NOT `var(--hc-mono)` / `#eef2f5`. Only the winners are emitted.
//    `rgba($accent, …)` is inlined: #7eb6d6 is rgb(126,182,214).
//  • `@include tw.header` was written FIRST in `.history-viewer-header`, so
//    the `padding: 0 0.833rem` after it wins over the band's `0 0.75rem`.
//    The shape ladder rungs the mixin interpolates are literals (2px / 3px /
//    4px), and `tw.$radius-card` in `.slice-modal` is 3px.
//
// Angular's build autoprefixed; `-webkit-backdrop-filter` and
// `-webkit-user-select` are written by hand.
//
// `hc-icon` was an Angular component (`<hc-icon [ref]>`); in a framework-free
// host that tag is an unstyled unknown element, so its own two rules
// (`:host` inline-flex + the `svg` stroke geometry) are carried here, scoped
// under the tag, immediately before the parent rules that override them.
const CSS = `
[${SLICE_SCOPE}]{position:fixed;inset:0;z-index:100002;pointer-events:none}

${SURFACE_NAME}{pointer-events:auto;position:fixed;z-index:100002;
top:var(--hc-controls-left-top, max(calc(2.3rem * var(--hc-header-zoom, 1.0)), var(--hc-header-anchor)));
left:var(--hc-controls-left, 0px);bottom:0;min-width:240px;max-width:calc(100vw - 1.5rem);
display:none;flex-direction:column;
--hc-window-accent:#7eb6d6;--hc-window-radius-control:2px;--hc-window-radius-card:3px;--hc-window-radius-floating:4px;
background:rgba(13,15,21,.975);backdrop-filter:blur(14px) saturate(1.04);-webkit-backdrop-filter:blur(14px) saturate(1.04);
border-radius:0;border-left:0;border-right:1px solid rgba(126,182,214,.38);
box-shadow:14px 0 44px rgba(0,0,0,.46),inset -1px 0 rgba(255,255,255,.025);outline:none;
font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;
font-size:calc(12px * var(--hc-panel-scale, 1));color:rgba(235,240,250,.85)}
${SURFACE_NAME}.open{display:flex}

${SURFACE_NAME} .history-viewer-header{flex:0 0 auto;box-sizing:border-box;display:flex;align-items:center;gap:.5rem;height:2.875rem;min-height:2.875rem;padding:0 .833rem;line-height:1;background:linear-gradient(180deg,rgba(255,255,255,.018),rgba(255,255,255,.006));border-bottom:1px solid rgba(255,255,255,.06)}
${SURFACE_NAME} .history-viewer-header>button{box-sizing:border-box;display:inline-grid;place-items:center;min-width:1.75rem;height:1.75rem;padding:0 .25rem;border-radius:2px;line-height:1;transition:color 120ms ease,background-color 120ms ease,border-color 120ms ease}
${SURFACE_NAME} .history-viewer-header>button:hover{background-color:rgba(255,255,255,.055)}
${SURFACE_NAME} .history-viewer-header>button:focus-visible{outline:1px solid color-mix(in srgb,var(--hc-window-accent) 72%,white);outline-offset:1px}
${SURFACE_NAME} .history-viewer-header>button[class*='close']{width:1.75rem;min-width:1.75rem;padding:0;font-size:1.125rem;color:rgba(238,244,248,.62)}
${SURFACE_NAME} .history-viewer-header>button[class*='close']:hover{color:#fff;background-color:rgba(255,255,255,.075)}

${SURFACE_NAME} .history-viewer-header .title{font-size:.9rem;font-weight:500;letter-spacing:.3px}
${SURFACE_NAME} .history-viewer-header .count{font-variant-numeric:tabular-nums;color:rgba(180,190,210,.7);margin-right:auto}

${SURFACE_NAME} .history-viewer-header .close{background:transparent;border:none;color:rgba(200,210,230,.65);font-size:1.5em;line-height:1;cursor:pointer;padding:0 .333em;border-radius:3px;transition:color 80ms linear,background 80ms linear;position:relative;z-index:2}
${SURFACE_NAME} .history-viewer-header .close:hover{color:rgba(255,255,255,1);background:rgba(255,255,255,.06)}

${SURFACE_NAME} .history-viewer-header .group-step-toggle{background:transparent;border:1px solid transparent;color:rgba(200,210,230,.45);font-size:1.167em;line-height:1;cursor:pointer;padding:.167em .5em;border-radius:3px;transition:color 80ms linear,background 80ms linear,border-color 80ms linear,opacity 80ms linear;position:relative;z-index:2;opacity:.6}
${SURFACE_NAME} .history-viewer-header .group-step-toggle:hover{color:rgba(255,255,255,1);background:rgba(255,255,255,.05);opacity:1}
${SURFACE_NAME} .history-viewer-header .group-step-toggle.active{color:rgba(110,180,255,1);background:rgba(110,180,255,.12);border-color:rgba(110,180,255,.35);opacity:1}

${SURFACE_NAME} .rows{list-style:none;padding:.333em 0;margin:0;overflow-y:scroll;flex:1;min-height:0;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:rgba(180,190,210,.45) rgba(255,255,255,.04);scrollbar-gutter:stable;pointer-events:auto}
${SURFACE_NAME} .rows::-webkit-scrollbar{width:10px}
${SURFACE_NAME} .rows::-webkit-scrollbar-track{background:rgba(255,255,255,.04)}
${SURFACE_NAME} .rows::-webkit-scrollbar-thumb{background:rgba(180,190,210,.45);border-radius:4px}
${SURFACE_NAME} .rows::-webkit-scrollbar-thumb:hover{background:rgba(200,210,230,.65)}

${SURFACE_NAME} .row{display:grid;grid-template-columns:1.167em auto 1fr auto auto auto auto;align-items:center;padding:.333em .833em .333em .5em;cursor:pointer;gap:.5em;border-left:2px solid transparent;transition:background 80ms linear;-webkit-user-select:none;user-select:none}

${SURFACE_NAME} .row .row-action{background:transparent;border:none;color:rgba(200,210,230,.55);font-size:1.167em;line-height:1;cursor:pointer;padding:0 .333em;border-radius:3px;opacity:.35;transition:opacity 80ms linear,color 80ms linear,background 80ms linear}
${SURFACE_NAME} .row:hover .row-action{opacity:.85}
${SURFACE_NAME} .row .row-action:hover{opacity:1;color:rgba(255,255,255,1);background:rgba(255,255,255,.08)}
${SURFACE_NAME} .row.anchor .row-action{display:none}

[${SLICE_SCOPE}] .slice-backdrop{pointer-events:auto;position:fixed;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);z-index:60000}
[${SLICE_SCOPE}] .slice-modal{pointer-events:auto;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);min-width:480px;max-width:80vw;max-height:80vh;background:rgba(16,18,26,.98);border:1px solid rgba(255,255,255,.12);border-radius:3px;color:rgba(240,245,255,.9);font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;z-index:60001;box-shadow:0 20px 60px rgba(0,0,0,.6);display:flex;flex-direction:column}
[${SLICE_SCOPE}] .slice-modal header{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.08);font-size:12px;gap:12px}
[${SLICE_SCOPE}] .slice-modal .slice-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:rgba(220,230,245,.85)}
[${SLICE_SCOPE}] .slice-modal .slice-copy{background:rgba(60,80,110,.45);border:1px solid rgba(120,140,170,.4);color:rgba(220,230,245,.9);border-radius:4px;font:inherit;font-size:11px;text-transform:uppercase;letter-spacing:.06em;padding:4px 10px;cursor:pointer;margin-left:auto;margin-right:4px;transition:background-color 120ms ease,border-color 120ms ease,color 120ms ease}
[${SLICE_SCOPE}] .slice-modal .slice-copy:hover{background:rgba(80,105,140,.6);color:rgba(255,255,255,1)}
[${SLICE_SCOPE}] .slice-modal .slice-copy.copied{background:rgba(60,140,90,.55);border-color:rgba(120,200,150,.6);color:rgba(230,255,235,1)}
[${SLICE_SCOPE}] .slice-modal .slice-close{background:transparent;border:none;color:rgba(200,210,230,.8);font-size:20px;cursor:pointer;padding:0 6px;line-height:1}
[${SLICE_SCOPE}] .slice-modal .slice-close:hover{color:rgba(255,255,255,1)}
[${SLICE_SCOPE}] .slice-modal .slice-back{background:transparent;border:1px solid rgba(120,140,170,.35);color:rgba(220,230,245,.85);border-radius:4px;font:inherit;font-size:13px;line-height:1;padding:3px 8px;cursor:pointer;transition:background-color 120ms ease,border-color 120ms ease,color 120ms ease}
[${SLICE_SCOPE}] .slice-modal .slice-back:hover{background:rgba(80,105,140,.5);border-color:rgba(140,170,200,.6);color:rgba(255,255,255,1)}
[${SLICE_SCOPE}] .slice-modal .slice-json{margin:0;padding:14px 16px;font-size:12px;line-height:1.45;overflow:auto;white-space:pre;color:rgba(230,235,245,.92)}
[${SLICE_SCOPE}] .slice-modal .slice-section{border-top:1px solid rgba(255,255,255,.08);display:flex;flex-direction:column;min-height:0}
[${SLICE_SCOPE}] .slice-modal .slice-section-header{padding:8px 16px 4px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:rgba(180,188,200,.7);background:rgba(0,0,0,.25)}
[${SLICE_SCOPE}] .slice-modal .slice-props{color:rgba(220,226,238,.88);background:rgba(0,0,0,.1)}
[${SLICE_SCOPE}] .slice-line{display:block;border-left:2px solid transparent;padding-left:6px;margin-left:-8px}
[${SLICE_SCOPE}] .slice-line[data-status="add"]{background:rgba(109,192,119,.12);border-left-color:rgba(109,192,119,.75);color:rgba(210,240,218,.98)}
[${SLICE_SCOPE}] .slice-line[data-status="remove"]{background:rgba(217,98,98,.12);border-left-color:rgba(217,98,98,.75);color:rgba(240,210,210,.85);text-decoration:line-through;text-decoration-color:rgba(217,98,98,.6)}
[${SLICE_SCOPE}] .slice-line.slice-sig{cursor:pointer;border-bottom:1px dashed transparent;transition:background 80ms linear,border-color 80ms linear,color 80ms linear}
[${SLICE_SCOPE}] .slice-line.slice-sig:hover{background:rgba(110,180,255,.16);border-bottom-color:rgba(110,180,255,.55);color:rgba(245,250,255,1)}
[${SLICE_SCOPE}] .slice-line.slice-sig:focus-visible{outline:1px solid rgba(110,180,255,.7);outline-offset:-1px}

${SURFACE_NAME} .row:hover{background:rgba(255,255,255,.05)}
${SURFACE_NAME} .row.active{background:rgba(100,170,255,.12);border-left-color:rgba(110,180,255,.9);color:rgba(255,255,255,.98)}
${SURFACE_NAME} .row.selected{background:rgba(180,150,255,.18);border-left-color:rgba(180,150,255,.9);color:rgba(255,255,255,.98)}
${SURFACE_NAME} .row.active.selected{background:linear-gradient(90deg,rgba(180,150,255,.18),rgba(100,170,255,.18))}

${SURFACE_NAME} .row .indicator{width:.667em;height:.667em;border-radius:50%;background:rgba(255,255,255,.18);display:inline-block}
${SURFACE_NAME} hc-icon{display:inline-flex;align-items:center;justify-content:center;line-height:0}
${SURFACE_NAME} hc-icon svg{width:100%;height:100%;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linejoin:round;stroke-linecap:round}
${SURFACE_NAME} .row .row-icon{width:1.167em;height:1.167em;color:rgba(255,255,255,.55)}

${SURFACE_NAME} .row[data-category="cells"] .indicator{background:#6dc077}
${SURFACE_NAME} .row[data-category="cells"] .row-icon{color:#6dc077}
${SURFACE_NAME} .row[data-category="content"] .indicator{background:#5f8bd9}
${SURFACE_NAME} .row[data-category="content"] .row-icon{color:#5f8bd9}
${SURFACE_NAME} .row[data-category="tags"] .indicator{background:#d9c25f}
${SURFACE_NAME} .row[data-category="tags"] .row-icon{color:#d9c25f}
${SURFACE_NAME} .row[data-category="notes"] .indicator{background:#b37dd4}
${SURFACE_NAME} .row[data-category="notes"] .row-icon{color:#b37dd4}
${SURFACE_NAME} .row[data-category="visibility"] .indicator{background:#b1b7c2}
${SURFACE_NAME} .row[data-category="visibility"] .row-icon{color:#b1b7c2}
${SURFACE_NAME} .row[data-category="system"] .indicator{background:#e08c4d}
${SURFACE_NAME} .row[data-category="system"] .row-icon{color:#e08c4d}
${SURFACE_NAME} .row[data-category="none"] .indicator{background:rgba(255,255,255,.10)}

${SURFACE_NAME} .filter-bar{display:flex;align-items:center;flex-wrap:wrap;gap:.167em;padding:.333em .5em;border-bottom:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.02)}
${SURFACE_NAME} .filter-toggle{background:transparent;border:1px solid transparent;border-radius:4px;padding:.25em;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;width:2em;height:2em;opacity:.35;transition:opacity 80ms linear,background 80ms linear,border-color 80ms linear}
${SURFACE_NAME} .filter-toggle hc-icon{width:1.167em;height:1.167em}
${SURFACE_NAME} .filter-toggle:hover{opacity:.75;background:rgba(255,255,255,.04)}
${SURFACE_NAME} .filter-toggle.active{opacity:1;background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.12)}
${SURFACE_NAME} .filter-toggle[data-category="cells"]{color:#6dc077}
${SURFACE_NAME} .filter-toggle[data-category="content"]{color:#5f8bd9}
${SURFACE_NAME} .filter-toggle[data-category="tags"]{color:#d9c25f}
${SURFACE_NAME} .filter-toggle[data-category="notes"]{color:#b37dd4}
${SURFACE_NAME} .filter-toggle[data-category="visibility"]{color:#b1b7c2}
${SURFACE_NAME} .filter-toggle[data-category="system"]{color:#e08c4d}

${SURFACE_NAME} .selection-gap{width:1px;align-self:stretch;background:rgba(255,255,255,.08);margin:0 4px}
${SURFACE_NAME} .selection-count{align-self:center;font-size:.833em;color:rgba(200,210,230,.65);padding:0 .167em;font-variant-numeric:tabular-nums}
${SURFACE_NAME} .selection-action{background:transparent;border:1px solid rgba(255,255,255,.12);border-radius:4px;padding:.25em .667em;cursor:pointer;color:rgba(210,220,240,.85);font-family:inherit;font-size:.917em;font-weight:500;letter-spacing:.04em;line-height:1;text-transform:lowercase;white-space:nowrap;transition:opacity 80ms linear,background 80ms linear,border-color 80ms linear,color 80ms linear;display:inline-flex;align-items:center;justify-content:center;height:1.833em}
${SURFACE_NAME} .selection-action.save-as-head{border-color:rgba(255,170,60,.45);color:rgba(255,200,120,.95)}
${SURFACE_NAME} .selection-action:hover{background:rgba(255,255,255,.08);color:rgba(255,255,255,1)}

${SURFACE_NAME} .row .idx{font-variant-numeric:tabular-nums;color:rgba(200,210,230,.85);min-width:2.333em}
${SURFACE_NAME} .row .summary{color:rgba(230,235,245,.92);white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis}
${SURFACE_NAME} .row .when{color:rgba(160,170,190,.7);font-size:.833em;font-variant-numeric:tabular-nums}

${SURFACE_NAME} .row.anchor{grid-template-columns:1.167em auto 1fr;cursor:default;pointer-events:none;opacity:.35;color:rgba(180,190,210,.6);border-left-color:transparent !important;background:transparent !important}
${SURFACE_NAME} .row.anchor.anchor-start{cursor:pointer;pointer-events:auto;opacity:.55}
${SURFACE_NAME} .row.anchor.anchor-start:hover{opacity:.9;background:rgba(255,255,255,.04) !important}
${SURFACE_NAME} .row.anchor.anchor-start.active{opacity:1;background:rgba(100,170,255,.12) !important;border-left-color:rgba(110,180,255,.9) !important;color:rgba(235,240,250,.9)}
${SURFACE_NAME} .row.anchor .idx{color:rgba(160,170,190,.45)}
${SURFACE_NAME} .row.anchor .summary{text-transform:uppercase;font-size:.833em;letter-spacing:.4px;color:rgba(170,180,200,.55)}

${SURFACE_NAME} .history-viewer-header .marked-toggle{background:transparent;border:1px solid transparent;color:rgba(200,210,230,.45);font-size:1.05em;line-height:1;cursor:pointer;padding:.167em .5em;border-radius:3px;transition:color 80ms linear,background 80ms linear,border-color 80ms linear,opacity 80ms linear;position:relative;z-index:2;opacity:.6}
${SURFACE_NAME} .history-viewer-header .marked-toggle:hover{color:rgba(255,210,130,1);background:rgba(255,190,90,.08);opacity:1}
${SURFACE_NAME} .history-viewer-header .marked-toggle.active{color:rgba(255,200,110,1);background:rgba(255,190,90,.14);border-color:rgba(255,190,90,.4);opacity:1}
${SURFACE_NAME} .row.marked{border-left-color:rgba(255,190,90,.7)}
${SURFACE_NAME} .row .row-mark.on{opacity:1;color:rgba(255,200,110,1)}
${SURFACE_NAME} .row:hover .row-mark.on{opacity:1}
${SURFACE_NAME} .row .summary.mark-name{color:rgba(255,224,170,.95);font-style:normal}
${SURFACE_NAME} .row .row-rename{min-width:0;background:rgba(0,0,0,.3);border:1px solid rgba(255,190,90,.45);border-radius:3px;color:rgba(255,235,200,.98);font:inherit;font-size:.92em;padding:.1em .4em;outline:none}
${SURFACE_NAME} .row .row-rename::placeholder{color:rgba(200,190,170,.45)}

${SURFACE_NAME} .marked-list{list-style:none;padding:.333em 0;margin:0}
${SURFACE_NAME} .marked-empty{padding:1em .833em;font-size:.917em;color:rgba(180,190,210,.6)}
${SURFACE_NAME} .marked-row{display:grid;grid-template-columns:1.2em 1fr auto;grid-template-areas:"star name when" "star path path";align-items:center;gap:.15em .5em;padding:.5em .833em;cursor:pointer;border-left:2px solid rgba(255,190,90,.5);transition:background 80ms linear}
${SURFACE_NAME} .marked-row:hover{background:rgba(255,190,90,.08)}
${SURFACE_NAME} .marked-row .marked-star{grid-area:star;color:rgba(255,200,110,1)}
${SURFACE_NAME} .marked-row .marked-name{grid-area:name;color:rgba(255,224,170,.95);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
${SURFACE_NAME} .marked-row .marked-path{grid-area:path;font-size:.8em;color:rgba(160,170,190,.7);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
${SURFACE_NAME} .marked-row .when{grid-area:when}

${SURFACE_NAME} .history-viewer-header .prune-toggle{background:transparent;border:1px solid transparent;color:rgba(200,210,230,.45);font-size:1.05em;line-height:1;cursor:pointer;padding:.167em .5em;border-radius:3px;transition:color 80ms linear,background 80ms linear,border-color 80ms linear,opacity 80ms linear;position:relative;z-index:2;opacity:.6;display:inline-flex;align-items:center;gap:.25em}
${SURFACE_NAME} .history-viewer-header .prune-toggle:hover{color:rgba(255,255,255,1);background:rgba(255,255,255,.05);opacity:1}
${SURFACE_NAME} .history-viewer-header .prune-toggle.active{color:rgba(255,130,130,1);background:rgba(255,90,90,.12);border-color:rgba(255,90,90,.4);opacity:1}
${SURFACE_NAME} .history-viewer-header .prune-toggle .prune-count{font-size:.72em;font-variant-numeric:tabular-nums;opacity:.85}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-history-viewer', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

/** `<hc-icon>` for an inline path ref. Every category icon in the taxonomy
 *  above is `IconRef.path(...)`, so the signature branch of the Angular
 *  IconComponent (a Store fetch) has nothing to resolve here and is not
 *  carried — a signature ref would simply render nothing, which is what the
 *  component did until its fetch landed. */
const iconEl = (ref: IconRefType | undefined, className: string): HTMLElement => {
  const host = document.createElement('hc-icon')
  if (className) host.className = className
  if (ref && IconRef.isPath(ref)) {
    const svg = document.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('aria-hidden', 'true')
    const path = document.createElementNS(SVG_NS, 'path')
    path.setAttribute('d', ref.path)
    svg.appendChild(path)
    host.appendChild(svg)
  }
  return host
}

/** One timeline row, kept across renders. `row` is the LIVE data the row's
 *  handlers read — the node outlives any single Row object, so a handler that
 *  closed over the row it was built with would act on a stale index. */
type RowNode = {
  el: HTMLLIElement
  row: Row
  glyph: HTMLElement
  glyphKind: 'icon' | 'indicator'
  glyphCategory: Category
  idx: HTMLElement
  summary: HTMLElement
  summaryKind: 'plain' | 'mark' | 'edit'
  mark: HTMLButtonElement
  makeHead: HTMLButtonElement
  when: HTMLElement
  del: HTMLButtonElement
}

export class HistoryViewerElement extends DockedPanelElement {

  #offs: Array<() => void> = []

  /** THE visibility flag. The three bus verbs, the ×, the session's park /
   *  unpark and the Escape cascade's close all read and write THIS field. */
  #visible = false

  // ── the data the rows are derived from ───────────────────────────────
  #entries: readonly LayerEntry[] = []
  #contents: ReadonlyMap<string, Content> = new Map()
  // Child layer sig → display name. Children arrays hold child layer SIGS
  // (versions), but a tile's identity is its NAME — there is no rename op, so
  // the name is stable across every version of the same tile. The diff
  // summariser maps sigs through this cache before comparing, so a downstream
  // edit that swaps N child sigs reads as a version ripple, not "-N tiles +N
  // tiles". Layer bytes are content-addressed, so a resolved name never
  // changes — the cache grows monotonically and never needs invalidation.
  #childNames: Map<string, string> = new Map()
  // Filename-keyed cache: `${locationSig}:${filename}` → resolved marker.
  // Markers are immutable once written, so entries never need invalidation —
  // except the one marker we just annotated (see #invalidateMarker).
  #contentByFilename: Map<string, MarkerRead | null> = new Map()
  // Per-filename marker annotation (marked / label), parsed from each marker's
  // rawText during reload. Kept separate from the layer content because it
  // lives on the marker record, not the layer.
  #meta: ReadonlyMap<string, { marked: boolean; label: string | null }> = new Map()
  #position = 0
  #total = 0
  #locationSig = ''
  #groupStepEnabled = false
  #loadSeq = 0

  // Disabled-filter set. NO PERSISTENCE — reset to empty every time the panel
  // becomes visible. A persisted disabled set could silently hide rows that
  // ARE in the bag, which violates the "perfect reflection" contract: the user
  // reopens the panel, the header says "history 5", and 4 rows are gone
  // because of a stale filter from last session. Always start from "show every
  // marker."
  #disabledFilters: ReadonlySet<Category> = new Set()

  // Multi-select — filenames the user has checked via Cmd/Ctrl-click (toggle)
  // or Shift-click (range). Bare click still seeks the cursor; only modifier
  // clicks participate, so the default navigation flow is untouched.
  #selected: ReadonlySet<string> = new Set()
  #lastSelectionAnchor: string | null = null

  // Layer-slice inspector. The stack lets the user drill into sig references
  // found inside a layer's JSON without losing the history-row context they
  // came from. The TOP of the stack is what renders; a back button (visible
  // when length > 1) pops one level. Closing clears the stack entirely.
  #sliceStack: Slice[] = []
  #sliceCopied = false
  #sliceCopyTimer = 0

  // Filename currently being renamed (its row shows a text input).
  #editing: string | null = null
  // Pending marked-places jump — set just before navigating to another
  // location, consumed by #reload once that bag has loaded.
  #pendingJump: { locationSig: string; filename: string } | null = null

  // Prune mode — the hive is showing the tiles DELETED at this location
  // instead of the tiles it has. Mirrored from `prune:mode-changed`; this
  // panel never sets it directly, so a mode opened by the `prune` word and one
  // opened by this button are the same mode.
  #pruneMode = false
  #prunedCount = 0

  #markedMode = false
  #markedPoints: readonly {
    locationSig: string; filename: string; path: string[] | null
    display: string; pathLabel: string; when: string
  }[] = []

  // ── chrome, built once per activation ────────────────────────────────
  #headerEl: HTMLElement | null = null
  #titleEl: HTMLElement | null = null
  #countEl: HTMLElement | null = null
  #selGapEl: HTMLElement | null = null
  #selCountEl: HTMLElement | null = null
  #selMakeHeadEl: HTMLButtonElement | null = null
  #pruneBtn: HTMLButtonElement | null = null
  #pruneCountEl: HTMLElement | null = null
  #markedBtn: HTMLButtonElement | null = null
  #groupBtn: HTMLButtonElement | null = null
  #closeBtn: HTMLButtonElement | null = null
  #filterBar: HTMLElement | null = null
  #filterButtons: Map<Category, HTMLButtonElement> = new Map()
  #list: HTMLUListElement | null = null
  #anchorHead: HTMLLIElement | null = null
  #anchorStart: HTMLLIElement | null = null
  #rowNodes: Map<string, RowNode> = new Map()
  #markedList: HTMLUListElement | null = null
  #markedEmptyEl: HTMLLIElement | null = null
  // The re-parented slice inspector (see the header note).
  #sliceHost: HTMLElement | null = null
  #sliceModal: HTMLElement | null = null
  #sliceCopyBtn: HTMLButtonElement | null = null
  #sliceBackBtn: HTMLButtonElement | null = null
  #sliceCloseBtn: HTMLButtonElement | null = null
  #sliceSection: HTMLElement | null = null
  #renderedSlice: Slice | null = null

  constructor() {
    super()
    // The SAME panel id `hcDockedPanel="history-viewer"` carried, so the saved
    // width (`hc:docked-width:history-viewer`), text size, code font and group
    // membership all come across with the participant. Changing it orphans all
    // three.
    this.panelId = 'history-viewer'
    this.dockSide = 'left'
    this.minWidth = 240
    this.maxWidth = 1200
    this.defaultWidth = 420
    this.minScale = 0.72
    this.maxScale = 1
    // Registry-fed: mounted once at boot, engaged only when something opens it.
    this.autoActivate = false
    // The Angular original built this with `signalSession(#visible, undefined,
    // { close: () => this.hide() })`. Reproduced literally: park / unpark flip
    // visibility with NO announcement (nothing on the bus ever described this
    // window's state), and `close` is what the Escape cascade calls — the base
    // registers it through holdWindow / holdToolWindow. Neither implementation
    // ever bound a document keydown listener of its own.
    this.session = {
      park: () => this.#setVisible(false),
      unpark: () => this.#setVisible(true),
      close: () => this.hide(),
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

    // THE THREE VERBS ARE GESTURES, NOT STATE. `EffectBus.on()` replays the
    // last value at subscribe time, and the surfaces host MOVES nodes to keep
    // registry order — a move is a disconnect + connect, so a re-mount would
    // re-subscribe and replay all three at once (open, then close, then
    // toggle), landing on whatever the last toggle happened to say rather than
    // on what is on screen. The Angular component could not hit this: it was
    // constructed once, at shell boot, before anything could emit. So the
    // guard is scoped as tightly as the hazard — swallow only the delivery
    // that happens DURING `on()`, and let every later emit through.
    const gesture = (effect: string, act: () => void): void => {
      let replay = true
      this.#offs.push(EffectBus.on(effect, () => { if (!replay) act() }))
      replay = false
    }
    gesture('history:view-open', () => this.#setVisible(true))
    gesture('history:view-close', () => this.#setVisible(false))
    gesture('history:view-toggle', () => this.#setVisible(!this.#visible))

    this.#offs.push(
      // The layer of deleted tiles (PruneService). The panel owns the TOGGLE,
      // never the mode: it asks over the bus and reflects whatever answer
      // comes back, so the same state is shown whether the participant clicked
      // here or spoke the word. THIS ONE WANTS ITS REPLAY — it is a state
      // assertion whose handler only SETS two fields, so a second delivery of
      // the same payload lands on the same values. Nothing here appends or
      // counts.
      EffectBus.on<{ active?: boolean; count?: number }>('prune:mode-changed', (state) => {
        this.#pruneMode = !!state?.active
        this.#prunedCount = Number(state?.count ?? 0)
        this.#renderPruneState()
      }),

      // The cursor's whole state — also a state assertion, also idempotent
      // (every branch is a field write or a reload), and it seeds
      // #position / #locationSig for a panel that has never been opened.
      EffectBus.on<CursorState>('history:cursor-changed', (s) => {
        if (!s) return
        const locationChanged = s.locationSig !== this.#locationSig
        // A new layer was appended at head while the viewer is open — the
        // cursor reports a larger total than we have rows for. Reload so the
        // new entry appears instead of only the count bumping.
        const entriesGrew = s.total !== this.#entries.length
        this.#setPosition(s.position)
        this.#total = s.total
        this.#groupStepEnabled = !!s.groupStepEnabled
        if (locationChanged) this.#locationSig = s.locationSig
        if ((locationChanged || entriesGrew) && this.#visible) void this.#reload()
        // Angular repainted off the `#position` signal write, and `@for …
        // track row.index` kept every `<li>` and re-evaluated only
        // `[class.active]`. The stream of ticks that arrives while the history
        // slider is dragged must move classes on the LIVE rows; rebuilding the
        // list per tick would be the regression.
        this.#renderCount()
        this.#renderToggleStates()
        this.#renderRowFlags()
      }),

      // THE PIPE WAS IMPURE. Angular's `t` pipe is declared `pure: false`, so
      // every change-detection tick re-resolved every string and `/language
      // ja` re-labelled an OPEN panel on the spot. An element renders when it
      // decides to, so the locale switch has to be a reason to render — else
      // an open viewer keeps its old-locale title, its four header toggles,
      // both anchors, every row action and the whole slice inspector until it
      // is closed and reopened. Rebuilding is safe: the rows live in the
      // fields above, never in the DOM.
      EffectBus.on('locale:changed', () => {
        if (!this.#visible) return
        this.#relabel()
        this.#render()
      }),
    )

    // Prime the flag from the cursor's current state — the EffectBus
    // subscription above replays the last-emitted value, but only if the
    // cursor has emitted at least once. On first open, read directly. (The
    // Angular original did this in ngOnInit, for the same reason.)
    const cursor = this.#cursor()
    if (cursor) this.#groupStepEnabled = !!cursor.state.groupStepEnabled

    // A re-mount must come back the way it went away — see the gesture note.
    if (this.#visible) this.#mount()
  }

  override disconnectedCallback(): void {
    this.#offs.forEach(off => off())
    this.#offs = []
    if (this.#sliceCopyTimer) { clearTimeout(this.#sliceCopyTimer); this.#sliceCopyTimer = 0 }
    // Orphan any reload still in flight so its continuation cannot paint into
    // a torn-down panel.
    this.#loadSeq++
    this.#unmountSlice()
    super.disconnectedCallback()   // → deactivate(): lane, session, grip, gear, children
    this.#forgetChrome()
  }

  // ── the open / close verbs ───────────────────────────────────────────

  /** The × and the session's `close`. */
  hide(): void { this.#setVisible(false) }

  /** DockedPanelElement's close verb — the lane's eviction fallback lands
   *  here, and the Angular `(hcDockedPanelClose)="hide()"` output said exactly
   *  this. */
  protected override closePanel(): void { this.hide() }

  #setVisible(next: boolean): void {
    if (next) this.#show()
    else this.#hide()
  }

  #show(): void {
    if (this.#visible) return
    this.#visible = true
    // The Angular `effect(() => { if (visible()) { … } })`, verbatim and in
    // order — it ran on every false→true transition, which is why parking and
    // unparking lands on the timeline with every marker showing.
    //
    //  · reset the filters (see #disabledFilters for why nothing persists)
    //  · land on the timeline, not the marked-places list
    //  · drop any half-finished rename
    //  · clear the stale localStorage key older builds wrote. One-time
    //    cleanup; the current code never writes it. Wrapped because
    //    localStorage may be unavailable in some contexts.
    this.#disabledFilters = new Set()
    this.#markedMode = false
    this.#editing = null
    try { localStorage.removeItem('hc:history-filters') } catch { /* ignore */ }
    this.#mount()
    void this.#reload()
  }

  /** Build the DOM and engage the panel WITHOUT the open-time resets — the
   *  path a re-mount takes. */
  #mount(): void {
    this.classList.add('open')
    this.setAttribute('aria-label', t('history.viewer-title', 'history'))
    this.activate()   // renderPanel + lane + session + grip + gear + inset
    this.#renderSlice()
  }

  #hide(): void {
    if (!this.#visible) return
    this.#visible = false
    this.classList.remove('open')
    this.removeAttribute('aria-label')
    // `@if (visible())` wrapped the inspector too — it went with the panel and
    // came BACK when the panel did, because the slice stack is state, not DOM.
    this.#unmountSlice()
    this.deactivate()   // clears the children — rebuild-on-open, like the `@if`
    this.#forgetChrome()
  }

  #forgetChrome(): void {
    this.#headerEl = null
    this.#titleEl = null
    this.#countEl = null
    this.#selGapEl = null
    this.#selCountEl = null
    this.#selMakeHeadEl = null
    this.#pruneBtn = null
    this.#pruneCountEl = null
    this.#markedBtn = null
    this.#groupBtn = null
    this.#closeBtn = null
    this.#filterBar = null
    this.#filterButtons.clear()
    this.#list = null
    this.#anchorHead = null
    this.#anchorStart = null
    this.#rowNodes.clear()
    this.#markedList = null
    this.#markedEmptyEl = null
  }

  // ── derived rows ─────────────────────────────────────────────────────

  /** All rows in the current layer, categorised. This is the authoritative
   *  list; the visible rows (post-filter) and the filter bar entries are both
   *  derived from it. */
  #allRows(): readonly Row[] {
    const contents = this.#contents
    const childNames = this.#childNames
    const nameOf = (sig: string): string | undefined => childNames.get(sig)
    const meta = this.#meta
    const rows: Row[] = []
    let previousContent: Content | undefined = undefined
    this.#entries.forEach((entry, i) => {
      const content = contents.get(entry.layerSig)
      if (!content) return
      const { summary, category, isCascade } = summarise(previousContent, content, nameOf)
      previousContent = content
      const m = meta.get(entry.filename)
      rows.push({
        index: i,
        at: entry.at,
        label: `#${i + 1}`,
        when: new Date(entry.at).toLocaleTimeString(),
        active: this.#position - 1 === i,
        summary,
        category,
        filename: entry.filename,
        isCascade,
        marked: m?.marked ?? false,
        markLabel: m?.label ?? null,
      })
    })
    return rows
  }

  #rows(): readonly Row[] {
    const all = this.#allRows()
    const disabled = this.#disabledFilters
    // Cascade rows are hidden by default — they're 1-for-1 sig swaps produced
    // by lineage pull-up (a child layer's bytes changed, the ancestor
    // re-commits with the new sig in its `children` slot). They aren't
    // user-initiated actions and don't carry meaning the user wants in the
    // timeline; they just show "the merkle tree rippled." The bag itself still
    // holds every marker — hiding cascades is a display-layer concern, not a
    // write-side one.
    const withoutCascades = all.filter(row => !row.isCascade)
    const filtered = disabled.size === 0
      ? withoutCascades
      : withoutCascades.filter(row => !disabled.has(row.category))
    return filtered.reverse() // newest first
  }

  /** Filter bar is data-driven: one toggle per distinct category that actually
   *  appears in this layer's rows. New op-kinds surface as new icons; pruning
   *  the layer prunes the menu. Order follows HISTORY_CATEGORIES so the bar
   *  stays stable across mutations. */
  #filterCategories(): readonly CategoryDef[] {
    const present = new Set<Category>()
    for (const row of this.#allRows()) present.add(row.category)
    return HISTORY_CATEGORIES.filter(def => def.icon && present.has(def.id))
  }

  #categoryDef(category: Category): CategoryDef {
    return CATEGORY_BY_ID.get(category) ?? HISTORY_CATEGORIES[HISTORY_CATEGORIES.length - 1]
  }

  #isCategoryEnabled(category: Category): boolean {
    return !this.#disabledFilters.has(category)
  }

  #toggleCategory(category: Category): void {
    const next = new Set(this.#disabledFilters)
    if (next.has(category)) next.delete(category)
    else next.add(category)
    this.#disabledFilters = next
    this.#render()
  }

  // ── chrome (built once per activation) ───────────────────────────────
  protected override renderPanel(): void {
    const header = document.createElement('header')
    header.className = 'history-viewer-header'

    const title = document.createElement('span')
    title.className = 'title'

    const count = document.createElement('span')
    count.className = 'count'

    // The selection cluster. `@if (selectedCount() > 0)` MEANS DETACH — these
    // three nodes are built once and removed / re-inserted, never hidden, so
    // `querySelector('.selection-action')` answers exactly when the template
    // said it would. The inner `@if (selectedCount() === 1)` is a second,
    // narrower gate on the button alone.
    const selGap = document.createElement('span')
    selGap.className = 'selection-gap'
    const selCount = document.createElement('span')
    selCount.className = 'selection-count'
    const selMakeHead = document.createElement('button')
    selMakeHead.type = 'button'
    selMakeHead.className = 'selection-action save-as-head'
    selMakeHead.addEventListener('click', () => { void this.#makeHeadSelection() })

    const prune = document.createElement('button')
    prune.type = 'button'
    prune.className = 'prune-toggle'
    prune.append(document.createTextNode('⬡'))
    prune.addEventListener('click', () => this.#togglePruneMode())
    const pruneCount = document.createElement('span')
    pruneCount.className = 'prune-count'

    const marked = document.createElement('button')
    marked.type = 'button'
    marked.className = 'marked-toggle'
    marked.textContent = '★'
    marked.addEventListener('click', () => { void this.#toggleMarkedMode() })

    const groupStep = document.createElement('button')
    groupStep.type = 'button'
    groupStep.className = 'group-step-toggle'
    groupStep.textContent = '⁘'
    groupStep.addEventListener('click', () => this.#toggleGroupStep())

    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'close'
    close.textContent = '×'
    close.addEventListener('click', () => this.hide())

    // The base plants its settings gear inside this header AFTER renderPanel()
    // returns (and nudges `header.lastElementChild` — the close button — over
    // to make room), so the header is built ONCE and mutated from here on.
    // Rebuilding it would throw the gear away.
    header.append(title, count, prune, marked, groupStep, close)

    const filterBar = document.createElement('div')
    filterBar.className = 'filter-bar'
    filterBar.setAttribute('role', 'toolbar')
    filterBar.addEventListener('wheel', stopWheel)

    const list = document.createElement('ul')
    list.className = 'rows'
    list.addEventListener('wheel', stopWheel)

    // Non-interactive bookends. They sit outside the seekable range so the
    // list's first and last real entries are never pinned to the panel edge.
    // HEAD stays fully decorative; START is clickable — it seeks to position 0
    // (pre-history / default empty state), which is reachable via undo as well.
    const anchorHead = document.createElement('li')
    anchorHead.className = 'row anchor anchor-head'
    anchorHead.setAttribute('aria-hidden', 'true')
    anchorHead.append(spanEl('indicator'), spanEl('idx', '—'), spanEl('summary'))

    const anchorStart = document.createElement('li')
    anchorStart.className = 'row anchor anchor-start'
    anchorStart.append(spanEl('indicator'), spanEl('idx', '—'), spanEl('summary'))
    anchorStart.addEventListener('click', () => this.#seek(-1))

    list.append(anchorHead, anchorStart)

    this.appendChild(header)
    this.#headerEl = header
    this.#titleEl = title
    this.#countEl = count
    this.#selGapEl = selGap
    this.#selCountEl = selCount
    this.#selMakeHeadEl = selMakeHead
    this.#pruneBtn = prune
    this.#pruneCountEl = pruneCount
    this.#markedBtn = marked
    this.#groupBtn = groupStep
    this.#closeBtn = close
    this.#filterBar = filterBar
    this.#list = list
    this.#anchorHead = anchorHead
    this.#anchorStart = anchorStart

    this.#relabel()
    this.#render()
  }

  /** Re-resolve the strings written ONCE per activation — the ones a body
   *  render never touches. Row action labels come back through `#updateRow`,
   *  which runs on every render. */
  #relabel(): void {
    this.setAttribute('aria-label', t('history.viewer-title', 'history'))
    if (this.#titleEl) this.#titleEl.textContent = t('history.viewer-title', 'history')

    const makeHead = t('history.selection-make-head', 'save selected layer as head')
    if (this.#selMakeHeadEl) {
      this.#selMakeHeadEl.setAttribute('aria-label', makeHead)
      this.#selMakeHeadEl.title = makeHead
      this.#selMakeHeadEl.textContent = t('history.save-as', 'save as head')
    }

    const pruneLabel = t('history.prune-toggle', 'deleted tiles — the layer you can destroy from')
    this.#pruneBtn?.setAttribute('aria-label', pruneLabel)
    if (this.#pruneBtn) this.#pruneBtn.title = pruneLabel

    const markedLabel = t('history.marked-places', 'marked places')
    this.#markedBtn?.setAttribute('aria-label', markedLabel)
    if (this.#markedBtn) this.#markedBtn.title = markedLabel

    const groupLabel = t('history.group-step',
      'group step — undo/redo skips edits and jumps to the earliest tile add/remove')
    this.#groupBtn?.setAttribute('aria-label', groupLabel)
    if (this.#groupBtn) this.#groupBtn.title = groupLabel

    const hideLabel = t('history.hide', 'hide history')
    this.#closeBtn?.setAttribute('aria-label', hideLabel)
    if (this.#closeBtn) this.#closeBtn.title = hideLabel

    const headSummary = this.#anchorHead?.querySelector('.summary')
    if (headSummary) headSummary.textContent = t('history.anchor-head', 'head')
    const startSummary = this.#anchorStart?.querySelector('.summary')
    if (startSummary) startSummary.textContent = t('history.anchor-start', 'start')

    if (this.#markedEmptyEl) {
      this.#markedEmptyEl.textContent = t('history.marked-empty', 'no marked points yet')
    }

    // The inspector's three chrome labels are written once per slice, so they
    // freeze in the old locale unless the relabel reaches them too.
    this.#relabelSlice()
  }

  // ── rendering ────────────────────────────────────────────────────────
  //
  // Rebuild-on-change everywhere it is safe; the timeline rows are the one
  // per-panel Map (a running rename must not lose its caret, and the cursor
  // stream must not rebuild the list per tick).
  #render(): void {
    if (!this.#headerEl) return
    this.#renderCount()
    this.#renderSelectionCluster()
    this.#renderPruneState()
    this.#renderToggleStates()
    this.#syncFilterBar()
    if (this.#markedMode) this.#renderMarked()
    else this.#renderRows()
    this.#syncBody()
    this.#renderRowFlags()
    this.#renderSlice()
  }

  #renderCount(): void {
    if (this.#countEl) this.#countEl.textContent = String(this.#total)
  }

  #renderSelectionCluster(): void {
    const header = this.#headerEl
    const gap = this.#selGapEl
    const count = this.#selCountEl
    const button = this.#selMakeHeadEl
    if (!header || !gap || !count || !button) return
    const selected = this.#selected.size
    // POLARITY IS LOAD-BEARING: `selectedCount() > 0`, exactly as the template
    // wrote it — never the negated `<= 0` guard, which is ALSO false for a
    // NaN and would fall straight through into painting the cluster with
    // "NaN" in it.
    if (selected > 0) {
      count.textContent = String(selected)
      // Reinsert before the prune toggle, which is where the template put the
      // cluster: title, count, [gap, count, button], prune, marked, group, ×.
      const anchor = this.#pruneBtn
      if (gap.parentNode !== header) header.insertBefore(gap, anchor)
      if (count.parentNode !== header) header.insertBefore(count, anchor)
      if (selected === 1) {
        if (button.parentNode !== header) header.insertBefore(button, anchor)
      } else {
        button.remove()
      }
    } else {
      gap.remove()
      count.remove()
      button.remove()
    }
  }

  #renderPruneState(): void {
    const button = this.#pruneBtn
    const badge = this.#pruneCountEl
    if (!button || !badge) return
    button.classList.toggle('active', this.#pruneMode)
    button.setAttribute('aria-pressed', String(this.#pruneMode))
    // `@if (prunedCount() > 0)` — how much junk is standing behind the toggle,
    // readable without entering the destructive mode. Same polarity as the
    // template; the badge DETACHES rather than hiding.
    if (this.#prunedCount > 0) {
      badge.textContent = String(this.#prunedCount)
      if (badge.parentNode !== button) button.appendChild(badge)
    } else {
      badge.remove()
    }
  }

  #renderToggleStates(): void {
    if (this.#markedBtn) {
      this.#markedBtn.classList.toggle('active', this.#markedMode)
      this.#markedBtn.setAttribute('aria-pressed', String(this.#markedMode))
    }
    if (this.#groupBtn) {
      this.#groupBtn.classList.toggle('active', this.#groupStepEnabled)
      this.#groupBtn.setAttribute('aria-pressed', String(this.#groupStepEnabled))
    }
  }

  /** The filter toggles are KEPT, not rebuilt: clicking one changes only its
   *  `.active` class, and a rebuild would take the focus ring off the button
   *  the participant just pressed. */
  #syncFilterBar(): void {
    const bar = this.#filterBar
    if (!bar) return
    const defs = this.#filterCategories()
    const present = new Set(defs.map(d => d.id))
    for (const [id, button] of this.#filterButtons) {
      if (present.has(id)) continue
      button.remove()
      this.#filterButtons.delete(id)
    }
    let anchor: ChildNode | null = bar.firstChild
    for (const def of defs) {
      let button = this.#filterButtons.get(def.id)
      if (!button) {
        button = document.createElement('button')
        button.type = 'button'
        button.className = 'filter-toggle'
        button.dataset['category'] = def.id
        // Raw category id, NOT a translated key — the template bound
        // `[attr.aria-label]="def.id"` and `[title]="def.id"`.
        button.setAttribute('aria-label', def.id)
        button.title = def.id
        button.appendChild(iconEl(def.icon, ''))
        button.addEventListener('click', () => this.#toggleCategory(def.id))
        this.#filterButtons.set(def.id, button)
      }
      const enabled = this.#isCategoryEnabled(def.id)
      button.classList.toggle('active', enabled)
      button.setAttribute('aria-pressed', String(enabled))
      if (anchor === button) { anchor = button.nextSibling; continue }
      bar.insertBefore(button, anchor)
    }
  }

  /** Place the header's siblings in template order: header, [filter bar],
   *  [timeline | marked list]. The base's grip lives at the end of the panel
   *  and is absolutely positioned, so it never takes part in this order. */
  #syncBody(): void {
    const header = this.#headerEl
    if (!header) return
    const wanted: HTMLElement[] = []
    // `@if (filterCategories().length > 0)` — the bar DETACHES when empty.
    if (this.#filterBar && this.#filterButtons.size > 0) wanted.push(this.#filterBar)
    const list = this.#markedMode ? this.#markedList : this.#list
    if (list) wanted.push(list)
    for (const node of [this.#filterBar, this.#list, this.#markedList]) {
      if (node && node.parentNode === this && !wanted.includes(node)) node.remove()
    }
    let anchor: ChildNode | null = header.nextSibling
    for (const node of wanted) {
      if (anchor === node) { anchor = node.nextSibling; continue }
      this.insertBefore(node, anchor)
    }
  }

  #renderRows(): void {
    const list = this.#list
    const head = this.#anchorHead
    const start = this.#anchorStart
    if (!list || !head || !start) return
    const rows = this.#rows()

    // Departed rows leave FIRST, so the placement walk below never has to step
    // over a corpse — and therefore never moves a survivor.
    const alive = new Set(rows.map(row => row.filename))
    for (const [filename, node] of this.#rowNodes) {
      if (alive.has(filename)) continue
      node.el.remove()
      this.#rowNodes.delete(filename)
    }

    // The anchor walk SKIPS a node already sitting where it belongs, because
    // `insertBefore` on a node that already has a parent is a REMOVE followed
    // by an insert — and removing the subtree that holds the focused rename
    // input drops the caret to <body> mid-word.
    let anchor: ChildNode | null = list.firstChild
    const place = (el: HTMLElement): void => {
      if (anchor === el) { anchor = el.nextSibling; return }
      list.insertBefore(el, anchor)
    }
    place(head)
    for (const row of rows) {
      let node = this.#rowNodes.get(row.filename)
      if (!node) {
        node = this.#buildRow(row)
        this.#rowNodes.set(row.filename, node)
      }
      this.#updateRow(node, row)
      place(node.el)
    }
    place(start)
  }

  /** One timeline row, built once. `#updateRow` fills it in. */
  #buildRow(row: Row): RowNode {
    const el = document.createElement('li')
    el.className = 'row'
    el.addEventListener('click', (event) => this.#onRowClick(node.row, event))
    el.addEventListener('dblclick', (event) => this.#openSlice(node.row.index, event))

    const glyph = spanEl('indicator')
    const idx = spanEl('idx')
    const summary = spanEl('summary')

    const mark = document.createElement('button')
    mark.type = 'button'
    mark.className = 'row-action row-mark'
    mark.addEventListener('click', (event) => { void this.#toggleMark(node.row, event) })

    const makeHead = document.createElement('button')
    makeHead.type = 'button'
    makeHead.className = 'row-action row-make-head'
    makeHead.textContent = '^'
    makeHead.addEventListener('click', (event) => { void this.#promoteRow(node.row.index, event) })

    const when = spanEl('when')

    const del = document.createElement('button')
    del.type = 'button'
    del.className = 'row-action row-delete'
    del.textContent = '×'
    del.addEventListener('click', (event) => { void this.#deleteRow(node.row.index, event) })

    el.append(glyph, idx, summary, mark, makeHead, when, del)

    const node: RowNode = {
      el, row,
      glyph, glyphKind: 'indicator', glyphCategory: 'none',
      idx, summary, summaryKind: 'plain',
      mark, makeHead, when, del,
    }
    return node
  }

  #updateRow(node: RowNode, row: Row): void {
    node.row = row
    node.el.dataset['category'] = row.category
    node.el.classList.toggle('marked', row.marked)

    // `@if (categoryDef(row.category).icon; as icon)` — an icon when the
    // category has one, a plain dot when it does not.
    const icon = this.#categoryDef(row.category).icon
    const wantKind: 'icon' | 'indicator' = icon ? 'icon' : 'indicator'
    if (node.glyphKind !== wantKind || node.glyphCategory !== row.category) {
      const next = icon ? iconEl(icon, 'row-icon') : spanEl('indicator')
      node.el.replaceChild(next, node.glyph)
      node.glyph = next
      node.glyphKind = wantKind
      node.glyphCategory = row.category
    }

    node.idx.textContent = row.label
    node.when.textContent = row.when

    // Row action labels re-resolve on every render, which is what carries them
    // through a `/language` switch.
    const markLabel = t('history.mark-toggle', 'mark this point')
    node.mark.setAttribute('aria-label', markLabel)
    node.mark.title = markLabel
    node.mark.textContent = row.marked ? '★' : '☆'
    node.mark.classList.toggle('on', row.marked)

    const makeHeadLabel = t('history.make-head', 'make this layer head')
    node.makeHead.setAttribute('aria-label', makeHeadLabel)
    node.makeHead.title = makeHeadLabel

    const deleteLabel = t('history.delete-entry', 'delete this history entry')
    node.del.setAttribute('aria-label', deleteLabel)
    node.del.title = deleteLabel

    // The summary cell is a three-way `@if`: the rename input, the saved name,
    // or the auto summary.
    const wantSummary: RowNode['summaryKind'] =
      this.#editing === row.filename ? 'edit' : (row.markLabel ? 'mark' : 'plain')

    if (wantSummary === 'edit') {
      if (node.summaryKind === 'edit') {
        // Already editing — leave the node ALONE. Re-creating it, or even
        // re-assigning `.value`, would eat what is being typed.
        const live = node.summary as HTMLInputElement
        live.placeholder = t('history.mark-rename', 'name this point…')
        return
      }
      const input = document.createElement('input')
      input.className = 'row-rename'
      input.type = 'text'
      input.setAttribute('autofocus', '')
      input.value = row.markLabel ?? ''
      input.placeholder = t('history.mark-rename', 'name this point…')
      input.addEventListener('click', (event) => { event.stopPropagation() })
      // `(keydown.enter)` / `(keydown.escape)` — Angular's KeyEventsPlugin
      // composes the binding name from the HELD MODIFIERS, so those two
      // bindings matched ONLY an unmodified press (Ctrl-Enter produced
      // `control.enter` and fell through). The guard reproduces that; without
      // it, a chord the original ignored would now commit or cancel a name.
      // Neither branch stops propagation, exactly as before — an Escape here
      // also carries on down the escape cascade.
      input.addEventListener('keydown', (event) => {
        if (event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return
        if (event.key === 'Enter') {
          void this.#commitRename(node.row.filename, (event.target as HTMLInputElement).value)
          return
        }
        if (event.key === 'Escape') this.#cancelRename()
      })
      input.addEventListener('blur', (event) => {
        void this.#commitRename(node.row.filename, (event.target as HTMLInputElement).value)
      })
      node.el.replaceChild(input, node.summary)
      node.summary = input
      node.summaryKind = 'edit'
      // The template carried a bare `autofocus`, which browsers honour only
      // patchily on a node inserted after load. Asking directly is what makes
      // "★ then name it" actually land the caret.
      input.focus()
      // FOCUS, NEVER SELECT. The template carried a bare `autofocus` and
      // nothing else — no focus() call and no select() anywhere. The field is
      // PRE-POPULATED with the existing mark label, so selecting it would mean
      // the first keystroke replaces a name the participant already saved
      // rather than extending it. Restoring the caret that the dead
      // `autofocus` attribute meant to place is the port stance (icon-picker
      // reasons the same way); inventing a selection is not.
      input.setSelectionRange(input.value.length, input.value.length)
      return
    }

    if (wantSummary === 'mark') {
      if (node.summaryKind !== 'mark') {
        const span = spanEl('summary mark-name')
        span.addEventListener('dblclick', (event) => this.#startRename(node.row, event))
        node.el.replaceChild(span, node.summary)
        node.summary = span
        node.summaryKind = 'mark'
      }
      node.summary.textContent = row.markLabel ?? ''
      return
    }

    if (node.summaryKind !== 'plain') {
      const span = spanEl('summary')
      node.el.replaceChild(span, node.summary)
      node.summary = span
      node.summaryKind = 'plain'
    }
    node.summary.textContent = row.summary
  }

  /** The two class bindings the cursor stream and the selection set move.
   *  Mutating live nodes — never a rebuild. */
  #renderRowFlags(): void {
    for (const node of this.#rowNodes.values()) {
      node.el.classList.toggle('active', this.#position - 1 === node.row.index)
      node.el.classList.toggle('selected', this.#selected.has(node.row.filename))
    }
    this.#anchorStart?.classList.toggle('active', this.#position === 0)
  }

  #renderMarked(): void {
    let list = this.#markedList
    if (!list) {
      list = document.createElement('ul')
      list.className = 'rows marked-list'
      list.addEventListener('wheel', stopWheel)
      this.#markedList = list
    }
    list.replaceChildren()
    this.#markedEmptyEl = null
    // `@if (markedPoints().length === 0)` — the empty line is a row of the
    // same list, not a replacement for it.
    if (this.#markedPoints.length === 0) {
      const empty = document.createElement('li')
      empty.className = 'marked-empty'
      empty.textContent = t('history.marked-empty', 'no marked points yet')
      list.appendChild(empty)
      this.#markedEmptyEl = empty
    }
    for (const point of this.#markedPoints) {
      const li = document.createElement('li')
      li.className = 'marked-row'
      li.addEventListener('click', () => this.#jumpToMarked(point))
      li.append(
        spanEl('marked-star', '★'),
        spanEl('marked-name', point.display),
        spanEl('marked-path', point.pathLabel),
        spanEl('when', point.when),
      )
      list.appendChild(li)
    }
  }

  // ── row interaction ──────────────────────────────────────────────────

  /**
   * Row click: with no modifier the cursor seeks, as before. Cmd/Ctrl toggles
   * the row's presence in the selection set. Shift selects the range between
   * the last-anchored row and this one. Plain seek clears the selection so
   * navigation after an accidental multi-select feels natural.
   */
  #onRowClick(row: Row, event: MouseEvent): void {
    if (event.shiftKey && this.#lastSelectionAnchor !== null) {
      this.#selectRange(this.#lastSelectionAnchor, row.filename)
      return
    }
    if (event.metaKey || event.ctrlKey) {
      this.#toggleSelection(row.filename)
      this.#lastSelectionAnchor = row.filename
      return
    }
    // bare click: navigate + reset selection
    if (this.#selected.size > 0) {
      this.#selected = new Set()
      this.#renderSelectionCluster()
      this.#renderRowFlags()
    }
    this.#lastSelectionAnchor = row.filename
    this.#seek(row.index)
  }

  #seek(index: number): void {
    const cursor = this.#cursor()
    if (!cursor) return
    cursor.seek(index + 1) // cursor positions are 1-based
  }

  #toggleSelection(filename: string): void {
    const next = new Set(this.#selected)
    if (next.has(filename)) next.delete(filename)
    else next.add(filename)
    this.#selected = next
    this.#renderSelectionCluster()
    this.#renderRowFlags()
  }

  #selectRange(fromFilename: string, toFilename: string): void {
    // Use the current #allRows ordering (oldest → newest) so shift-click spans
    // match the semantic order regardless of the display reverse.
    const all = this.#allRows()
    const a = all.findIndex(r => r.filename === fromFilename)
    const b = all.findIndex(r => r.filename === toFilename)
    if (a < 0 || b < 0) return
    const [lo, hi] = a <= b ? [a, b] : [b, a]
    const next = new Set(this.#selected)
    for (let i = lo; i <= hi; i++) next.add(all[i].filename)
    this.#selected = next
    this.#renderSelectionCluster()
    this.#renderRowFlags()
  }

  /**
   * Fold selected layers' content into a new head entry (the latest selected
   * layer's content becomes the new head), leaving sources intact. No
   * deletion. Clears selection on success.
   */
  async #makeHeadSelection(): Promise<void> {
    const history = this.#history()
    const cursor = this.#cursor()
    if (!history?.promoteToHead || !cursor) return
    const sel = this.#selected
    if (sel.size === 0) return
    // pick the chronologically newest selected row's layerSig
    const all = this.#allRows()
    let newestFilename: string | null = null
    let newestAt = -Infinity
    for (const row of all) {
      if (!sel.has(row.filename)) continue
      if (row.at > newestAt) { newestAt = row.at; newestFilename = row.filename }
    }
    if (!newestFilename) return
    const entry = this.#entries.find(e => e.filename === newestFilename)
    if (!entry) return
    await history.promoteToHead(cursor.state.locationSig, entry.layerSig)
    await this.#refreshCursor(cursor)
    this.#selected = new Set()
    this.#lastSelectionAnchor = null
    await this.#reload()
    cursor.seek(this.#total)
  }

  /**
   * Per-row "make head" — append a new entry at the top that points at this
   * row's layer, without touching the rest of the list. The cursor follows to
   * the new head so the canvas reflects the promoted state.
   */
  async #promoteRow(index: number, event: Event): Promise<void> {
    event.stopPropagation()
    const history = this.#history()
    const cursor = this.#cursor()
    if (!history?.promoteToHead || !cursor) return
    const entry = this.#entries[index]
    if (!entry) return
    await history.promoteToHead(cursor.state.locationSig, entry.layerSig)
    await this.#refreshCursor(cursor)
    await this.#reload()
    cursor.seek(this.#total)
  }

  /**
   * Per-row delete — soft-delete a single entry via HistoryService's
   * removeEntries (it parks the marker in the history soft-delete area,
   * restorable for 30 days). If the cursor was pointing at the removed entry,
   * we nudge it to the nearest neighbour so the canvas doesn't freeze on a
   * dead position.
   */
  async #deleteRow(index: number, event: Event): Promise<void> {
    event.stopPropagation()
    const history = this.#history()
    const cursor = this.#cursor()
    if (!history?.removeEntries || !cursor) return
    const entry = this.#entries[index]
    if (!entry) return
    await history.removeEntries(cursor.state.locationSig, [entry.filename])
    await this.#refreshCursor(cursor)
    await this.#reload()
    const nextTotal = this.#total
    if (cursor.state.position > nextTotal) cursor.seek(nextTotal)
  }

  // ── marker marks + names ─────────────────────────────────────────────
  //
  // A ★ on a row flags the point and reveals an inline name field; the name +
  // mark live on the marker record (via setMarkerMeta), and the current path
  // is stamped alongside so the marked-places list can jump back to this exact
  // location from anywhere in the tree.

  /** Drop one marker's filename-keyed content cache so the next reload
   *  re-reads its (now-rewritten) bytes — the immutable-marker assumption only
   *  breaks for the marker we just annotated. */
  #invalidateMarker(locationSig: string, filename: string): void {
    this.#contentByFilename.delete(`${locationSig}:${filename}`)
  }

  /** Toggle the ★ on a row. Marking stamps the current path so the
   *  marked-places list can navigate back; marking also drops the row straight
   *  into rename so the user can name the point. */
  async #toggleMark(row: Row, event: Event): Promise<void> {
    event.stopPropagation()
    const history = this.#history()
    const cursor = this.#cursor()
    const nav = this.#nav()
    if (!history?.setMarkerMeta || !cursor) return
    const locationSig = cursor.state.locationSig
    const next = !row.marked
    await history.setMarkerMeta(locationSig, row.filename, next
      ? { marked: true, path: nav ? nav.segmentsRaw() : undefined }
      : { marked: false })
    this.#invalidateMarker(locationSig, row.filename)
    await this.#reload()
    if (next) { this.#editing = row.filename; this.#render() }
  }

  #startRename(row: Row, event: Event): void {
    event.stopPropagation()
    this.#editing = row.filename
    this.#render()
  }

  #cancelRename(): void {
    this.#editing = null
    this.#render()
  }

  /** Commit an inline name edit. Naming a point implies marking it (and stamps
   *  the path), so a named row is always returnable. */
  async #commitRename(filename: string, value: string): Promise<void> {
    this.#editing = null
    const history = this.#history()
    const cursor = this.#cursor()
    const nav = this.#nav()
    if (!history?.setMarkerMeta || !cursor) { this.#render(); return }
    const locationSig = cursor.state.locationSig
    await history.setMarkerMeta(locationSig, filename, {
      label: value,
      marked: true,
      path: nav ? nav.segmentsRaw() : undefined,
    })
    this.#invalidateMarker(locationSig, filename)
    await this.#reload()
  }

  // ── marked places (cross-tree) ───────────────────────────────────────

  #togglePruneMode(): void {
    EffectBus.emit('prune:mode-toggle', undefined)
  }

  async #toggleMarkedMode(): Promise<void> {
    const next = !this.#markedMode
    this.#markedMode = next
    if (next) await this.#loadMarkedPoints()
    this.#render()
  }

  async #loadMarkedPoints(): Promise<void> {
    const history = this.#history()
    if (!history?.listMarkedPoints) { this.#markedPoints = []; return }
    const pts = await history.listMarkedPoints()
    this.#markedPoints = pts.map(p => ({
      locationSig: p.locationSig,
      filename: p.filename,
      path: p.path,
      display: p.label ?? `#${parseInt(p.filename, 10) || 0}`,
      pathLabel: (p.path && p.path.length > 0) ? p.path.join(' / ') : '/',
      when: new Date(p.at).toLocaleString(),
    }))
  }

  /** Jump to a marked point. Same location → seek directly; otherwise navigate
   *  to its stored path and let #reload land the seek. */
  #jumpToMarked(point: { locationSig: string; filename: string; path: string[] | null }): void {
    const nav = this.#nav()
    const cursor = this.#cursor()
    this.#markedMode = false
    this.#render()
    if (cursor && cursor.state.locationSig === point.locationSig) {
      const idx = this.#entries.findIndex(e => e.filename === point.filename)
      if (idx >= 0) cursor.seek(idx + 1)
      return
    }
    if (!nav || !point.path) return
    this.#pendingJump = { locationSig: point.locationSig, filename: point.filename }
    nav.goRaw(point.path)
  }

  #toggleGroupStep(): void {
    const cursor = this.#cursor()
    if (!cursor?.setGroupStepEnabled) return
    cursor.setGroupStepEnabled(!this.#groupStepEnabled)
    // Cursor emits via EffectBus; the subscriber above picks it up.
  }

  // ── the slice inspector ──────────────────────────────────────────────

  #openSlice(index: number, event: Event): void {
    event.stopPropagation()
    const entries = this.#entries
    const entry = entries[index]
    if (!entry) return
    const contents = this.#contents
    const content = contents.get(entry.layerSig)
    if (!content) return

    // Diff vs the previous entry (chronologically just before this one) so the
    // inspector shows what actually changed at this step. The first entry has
    // no predecessor — all lines highlight as `add`.
    //
    // Critical: the diff is SET-BASED for children, not position-based. When a
    // sibling moves from last to middle in the array its JSON line text
    // changes (`"sig"` → `"sig",`) under naive line-diff, making a
    // verbatim-preserved sibling look like a remove+add. We serialise to a
    // normalised format where each sig is its own sortable line with no
    // trailing-comma artefacts, so unchanged siblings always align as `same`.
    const prevEntry = index > 0 ? entries[index - 1] : null
    const prevContent = prevEntry ? contents.get(prevEntry.layerSig) : null
    const nextJson = JSON.stringify(content, Object.keys(content).sort(), 2)
    const prevLines = prevContent ? layerToDiffableLines(prevContent) : []
    const nextLines = layerToDiffableLines(content)
    const lines = diffLines(prevLines, nextLines)

    const when = new Date(entry.at).toLocaleString()
    this.#sliceStack = [{
      label: `#${index + 1} · ${when} · ${entry.layerSig.slice(0, 12)}…`,
      lines,
      json: nextJson,
      properties: null,
    }]
    this.#sliceCopied = false
    this.#renderSlice()
    // Inflate the layer's `properties[0]` (the canonical 0000 resource) in the
    // background and stitch it into the open slice when it resolves. Decoupled
    // from the synchronous render so the modal pops instantly; the 0000
    // section fades in when ready.
    void this.#hydrateSliceProperties(content)
  }

  /** Fetch and parse the layer's `properties[0]` resource — the canonical 0000
   *  visual-properties JSON — and graft the formatted result onto the topmost
   *  slice so the inspector shows the visual primitives alongside the layer's
   *  slot bag. Silent on every miss path: a layer with no properties slot, a
   *  missing resource, or unparseable bytes all leave `properties` null and
   *  the section hidden. The user always has the manual-drill path as
   *  fallback. */
  async #hydrateSliceProperties(content: Content): Promise<void> {
    const propsSlot = (content as Record<string, unknown>)['properties']
    if (!Array.isArray(propsSlot) || propsSlot.length === 0) return
    const propSig = propsSlot[0]
    if (typeof propSig !== 'string' || !SIG_RE.test(propSig)) return
    const store = this.#store()
    if (!store) return
    try {
      const blob = await store.getResource(propSig)
      if (!blob) return
      const text = await blob.text()
      let pretty = text
      try {
        const parsed = JSON.parse(text)
        // Sort keys for stable display — same canonicalization the writer
        // applies. Cosmetic; the underlying resource bytes are already
        // canonical because writeTilePropertiesAt sorts keys before storing.
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const sortedKeys = Object.keys(parsed).sort()
          const canonical: Record<string, unknown> = {}
          for (const k of sortedKeys) canonical[k] = (parsed as Record<string, unknown>)[k]
          pretty = JSON.stringify(canonical, null, 2)
        }
      } catch { /* keep raw text */ }
      // Patches whatever is TOPMOST when the bytes land — which, if the
      // participant drilled into a sig in the meantime, is the drilled slice
      // and not the one this walk started from. That is the original's
      // behaviour, quirk included; changing it here would be a silent
      // behavioural edit smuggled in under a port.
      const top = this.#sliceStack[this.#sliceStack.length - 1]
      if (!top) return
      top.properties = pretty
      this.#renderSliceProperties()
    } catch { /* silent fallback to drill-in path */ }
  }

  #closeSlice(): void {
    this.#sliceStack = []
    this.#sliceCopied = false
    this.#renderSlice()
  }

  /**
   * Pop the top slice off the stack so the previous one re-appears. No-op when
   * the stack has 0 or 1 entries (back is hidden in that state anyway, but we
   * guard here too in case the call comes via keyboard or programmatic source).
   */
  #sliceBack(): void {
    const stack = this.#sliceStack
    if (stack.length <= 1) return
    this.#sliceStack = stack.slice(0, -1)
    this.#sliceCopied = false
    this.#renderSlice()
  }

  /**
   * Detect whether a diff line is a clickable sig reference. A sig is a
   * 64-char lowercase hex string; the line may have leading spaces (the
   * layerToDiffableLines indents children sigs with 4 spaces) and an optional
   * trailing comma. Returns the bare sig if the line matches the shape, null
   * otherwise.
   */
  #lineSig(text: string): string | null {
    const trimmed = text.trim().replace(/,$/, '')
    return SIG_RE.test(trimmed) ? trimmed : null
  }

  /**
   * Resolve a sig and push a new slice for it onto the stack. The drilled
   * slice has no diff context (there's no adjacent-entry comparison to make),
   * so every line renders as `add` — visually "this is what's in here".
   *
   * Resolution chain:
   *  1. history.getLayerBySig(sig) — cross-bag layer lookup; covers same-bag
   *     siblings AND child cells whose layers live in their own lineage bags.
   *  2. history.getLayerContent(currentLocationSig, sig) — older builds
   *     without getLayerBySig still get the simple case working.
   *  3. store.getResource(sig) — content-addressed resources like notes, tags,
   *     or any blob referenced by sig that isn't a bag layer.
   *  4. Fall through silently — sig is unresolvable in this client's OPFS
   *     state. (May exist remotely, may have been pruned, etc.)
   *
   * The label uses the resolved layer's `name` when present so the breadcrumb
   * reads "↳ instructions" instead of an opaque hash.
   */
  async #drillIntoSig(sig: string): Promise<void> {
    const history = this.#history()
    const store = this.#store()

    let parsed: Content | null = null
    let json: string | null = null

    if (history?.getLayerBySig) {
      try {
        const fromAny = await history.getLayerBySig(sig)
        if (fromAny) {
          parsed = fromAny
          json = JSON.stringify(fromAny, Object.keys(fromAny).sort(), 2)
        }
      } catch { /* fall through */ }
    }

    if (!parsed && history?.getLayerContent) {
      try {
        const fromBag = await history.getLayerContent(this.#locationSig, sig)
        if (fromBag) {
          parsed = fromBag
          json = JSON.stringify(fromBag, Object.keys(fromBag).sort(), 2)
        }
      } catch { /* fall through */ }
    }

    if (!parsed && store) {
      try {
        const blob = await store.getResource(sig)
        if (blob) {
          const text = await blob.text()
          try { parsed = JSON.parse(text) as Content } catch { /* not JSON */ }
          json = text
        }
      } catch { /* fall through */ }
    }

    // nothing resolved — bail. Future: surface a transient toast.
    if (!parsed && json === null) return

    let lines: ReadonlyArray<{ text: string; status: 'add' }>
    if (parsed && typeof parsed === 'object') {
      const layerLines = layerToDiffableLines(parsed)
      lines = layerLines.map(text => ({ text, status: 'add' as const }))
    } else if (json !== null) {
      lines = json.split('\n').map(text => ({ text, status: 'add' as const }))
    } else {
      return
    }

    const niceName = (parsed && typeof parsed.name === 'string' && parsed.name) ? parsed.name : sig.slice(0, 12) + '…'
    this.#sliceStack = [...this.#sliceStack, {
      label: `↳ ${niceName}`,
      lines,
      json: json ?? '',
      properties: null,
    }]
    this.#sliceCopied = false
    this.#renderSlice()
    // Inflate 0000 for this drilled layer too — when the user walks INTO a
    // child layer they typically want to see what that child's visual
    // primitives are. Same async hydrate path as openSlice.
    if (parsed && typeof parsed === 'object') {
      void this.#hydrateSliceProperties(parsed as Content)
    }
  }

  /**
   * Copy the open slice's raw JSON to the clipboard. Flashes a brief "copied"
   * state on the button so the user knows it worked. Falls back silently if
   * the Clipboard API isn't available.
   */
  async #copySliceJson(): Promise<void> {
    const slice = this.#sliceStack[this.#sliceStack.length - 1]
    if (!slice) return
    try {
      await navigator.clipboard.writeText(slice.json)
      this.#sliceCopied = true
      this.#renderCopyState()
      if (this.#sliceCopyTimer) clearTimeout(this.#sliceCopyTimer)
      this.#sliceCopyTimer = window.setTimeout(() => {
        this.#sliceCopyTimer = 0
        this.#sliceCopied = false
        this.#renderCopyState()
      }, 1200)
    } catch {
      /* Clipboard unavailable (no user gesture, no permission, etc.) */
    }
  }

  /** Build (or tear down) the inspector. Rebuilds ONLY when the top slice
   *  actually changes — a reload landing underneath an open inspector must not
   *  reset its scroll, which is what Angular's untouched `<pre>` gave for
   *  free. */
  #renderSlice(): void {
    const slice = this.#visible ? (this.#sliceStack[this.#sliceStack.length - 1] ?? null) : null
    if (!slice) { this.#unmountSlice(); return }
    if (slice === this.#renderedSlice && this.#sliceModal) { this.#renderCopyState(); return }
    this.#renderedSlice = slice

    let host = this.#sliceHost
    if (!host) {
      host = document.createElement('div')
      host.setAttribute(SLICE_SCOPE, '')
      this.#sliceHost = host
    }
    host.replaceChildren()

    const backdrop = document.createElement('div')
    backdrop.className = 'slice-backdrop'
    backdrop.addEventListener('click', () => this.#closeSlice())

    const modal = document.createElement('div')
    modal.className = 'slice-modal'
    modal.setAttribute('role', 'dialog')
    modal.setAttribute('aria-modal', 'true')

    const header = document.createElement('header')
    // `@if (canSliceBack())` — the back button exists only once there is
    // somewhere to go back to.
    let back: HTMLButtonElement | null = null
    if (this.#sliceStack.length > 1) {
      back = document.createElement('button')
      back.type = 'button'
      back.className = 'slice-back'
      back.textContent = '←'
      back.addEventListener('click', () => this.#sliceBack())
      header.appendChild(back)
    }

    const label = document.createElement('span')
    label.className = 'slice-label'
    label.textContent = slice.label
    header.appendChild(label)

    const copy = document.createElement('button')
    copy.type = 'button'
    copy.className = 'slice-copy'
    copy.addEventListener('click', () => { void this.#copySliceJson() })
    header.appendChild(copy)

    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'slice-close'
    close.textContent = '×'
    close.addEventListener('click', () => this.#closeSlice())
    header.appendChild(close)

    const pre = document.createElement('pre')
    pre.className = 'slice-json'
    for (const line of slice.lines) {
      const sig = this.#lineSig(line.text)
      const span = document.createElement('span')
      span.className = sig ? 'slice-line slice-sig' : 'slice-line'
      span.dataset['status'] = line.status
      if (sig) {
        span.dataset['sig'] = sig
        span.setAttribute('role', 'button')
        span.tabIndex = 0
        span.addEventListener('click', () => { void this.#drillIntoSig(sig) })
      }
      span.textContent = line.text
      // The template put a literal newline after each `</span>`, inside the
      // `<pre>` — so every line, the last one included, ends with one.
      pre.append(span, document.createTextNode('\n'))
    }

    modal.append(header, pre)
    host.append(backdrop, modal)

    this.#sliceModal = modal
    this.#sliceBackBtn = back
    this.#sliceCopyBtn = copy
    this.#sliceCloseBtn = close
    this.#sliceSection = null

    this.#relabelSlice()
    this.#renderCopyState()
    this.#renderSliceProperties()

    // Placed immediately after this tag, so the inspector keeps the order-2
    // position in the surfaces host that the whole component used to have.
    if (host.parentNode !== (this.parentNode ?? document.body)) {
      if (this.parentNode) this.parentNode.insertBefore(host, this.nextSibling)
      else document.body.appendChild(host)
    }
  }

  #relabelSlice(): void {
    const backLabel = t('history.back', 'back')
    this.#sliceBackBtn?.setAttribute('aria-label', backLabel)
    if (this.#sliceBackBtn) this.#sliceBackBtn.title = backLabel
    this.#sliceCopyBtn?.setAttribute('aria-label', t('history.copy-slice', 'copy layer as JSON'))
    this.#sliceCloseBtn?.setAttribute('aria-label', t('history.close-slice', 'close layer inspector'))
  }

  #renderCopyState(): void {
    const copy = this.#sliceCopyBtn
    if (!copy) return
    copy.classList.toggle('copied', this.#sliceCopied)
    copy.textContent = this.#sliceCopied ? '✓' : 'copy'
  }

  /** `@if (slice.properties; as props)` — the 0000 section appears when the
   *  hydrate lands, WITHOUT disturbing the diff above it. */
  #renderSliceProperties(): void {
    const modal = this.#sliceModal
    const slice = this.#renderedSlice
    if (!modal || !slice) return
    const props = slice.properties
    if (!props) {
      this.#sliceSection?.remove()
      this.#sliceSection = null
      return
    }
    if (!this.#sliceSection) {
      const section = document.createElement('div')
      section.className = 'slice-section'
      const head = document.createElement('div')
      head.className = 'slice-section-header'
      // Untranslated in the original — a literal label naming the resource.
      head.textContent = '0000 (tile properties)'
      const body = document.createElement('pre')
      body.className = 'slice-json slice-props'
      section.append(head, body)
      modal.appendChild(section)
      this.#sliceSection = section
    }
    const body = this.#sliceSection.querySelector('.slice-props')
    if (body) body.textContent = props
  }

  #unmountSlice(): void {
    this.#sliceHost?.remove()
    this.#sliceHost = null
    this.#sliceModal = null
    this.#sliceCopyBtn = null
    this.#sliceBackBtn = null
    this.#sliceCloseBtn = null
    this.#sliceSection = null
    this.#renderedSlice = null
  }

  // ── services ─────────────────────────────────────────────────────────
  #cursor(): CursorService | null { return get<CursorService>(CURSOR_KEY) ?? null }
  #history(): HistoryService | null { return get<HistoryService>(HISTORY_KEY) ?? null }
  #store(): Store | null { return get<Store>(STORE_KEY) ?? null }
  #nav(): NavigationService | null { return get<NavigationService>(NAVIGATION_KEY) ?? null }

  // After a bag-mutating op (promote / merge / remove) the cursor's internal
  // #layers is stale. Pull it back in sync with disk before reading
  // state.total or seeking, otherwise seek() short-circuits on equal position
  // and the canvas never repaints.
  async #refreshCursor(cursor: CursorService): Promise<void> {
    if (cursor.refreshForLocation) await cursor.refreshForLocation(cursor.state.locationSig)
    else if (cursor.onNewLayer) await cursor.onNewLayer()
  }

  /** Whenever the cursor position changes (undo / redo / seek), scroll the
   *  newly-active row into view so the user always sees where they are in the
   *  list. The Angular `effect()` re-ran only on an actual VALUE change; a
   *  signal set to the value it already holds notifies nobody, so the guard is
   *  part of the behaviour, not an optimisation. */
  #setPosition(next: number): void {
    if (next === this.#position) return
    this.#position = next
    queueMicrotask(() => {
      const active = this.querySelector('.row.active') as HTMLElement | null
      active?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
  }

  // ── the reload ───────────────────────────────────────────────────────

  /**
   * Reflection contract: every reload re-lists the bag's marker filenames
   * fresh from disk (cheap — names only, no bytes read). For each filename,
   * resolve content via a filename-keyed cache; read from disk only on cache
   * miss. Marker contents are immutable, so the cache never needs invalidation
   * — adding a marker means a new filename appears in the listing, never a
   * content change to an existing filename.
   *
   * Every filename in the bag becomes a row, including markers whose JSON
   * fails to parse — they surface as "(unparseable)" rows so the user can see
   * what's there. No silent drops. Header count and visible-row count are by
   * construction equal: both derived from the same filenames list.
   */
  async #reload(): Promise<void> {
    const seq = ++this.#loadSeq
    const cursor = this.#cursor()
    const history = this.#history()
    const store = this.#store()
    if (!cursor || !history || !store) return

    const locationSig = cursor.state.locationSig
    this.#locationSig = locationSig

    // Phase 1: cheap list of filenames. Fresh every reload.
    let filenames: readonly string[]
    if (history.listMarkerFilenames) {
      filenames = await history.listMarkerFilenames(locationSig)
    } else {
      // Legacy back-compat: derive filenames from listLayers.
      const legacy = await history.listLayers(locationSig)
      filenames = legacy.map(e => e.filename)
    }
    if (seq !== this.#loadSeq) return

    // Phase 2: resolve missing filenames through the filename-keyed cache.
    // Each cache key is `${locSig}:${filename}` so the same bag never collides
    // with another. Cached entries are reused without any disk read.
    const existingByFilename = this.#contentByFilename
    const toFetch = filenames.filter(name => !existingByFilename.has(`${locationSig}:${name}`))

    const nextByFilename = new Map(existingByFilename)
    if (toFetch.length > 0) {
      const fetched = await Promise.all(toFetch.map(async (name) => {
        const key = `${locationSig}:${name}`
        try {
          if (history.readMarker) {
            const m = await history.readMarker(locationSig, name)
            return [key, m] as const
          }
          // Legacy fallback: synth from listLayers + getLayerContent.
          return [key, null] as const
        } catch {
          return [key, null] as const
        }
      }))
      if (seq !== this.#loadSeq) return
      for (const [key, m] of fetched) nextByFilename.set(key, m)
    }

    // Build entries + sig-keyed contents (back-compat with other viewer code
    // paths that still look things up by layerSig).
    const entries: LayerEntry[] = []
    const sigContents = new Map<string, Content>()
    filenames.forEach((name, i) => {
      const key = `${locationSig}:${name}`
      const m = nextByFilename.get(key)
      if (m) {
        entries.push({ layerSig: m.layerSig, at: m.at, index: i, filename: name })
        if (m.parsed) sigContents.set(m.layerSig, m.parsed)
        else sigContents.set(m.layerSig, { name: '(unparseable)' } as Content)
      } else {
        // Cached miss — file disappeared between phases or unreadable. Synth a
        // placeholder entry so the row still appears.
        entries.push({ layerSig: `missing:${name}`, at: 0, index: i, filename: name })
        sigContents.set(`missing:${name}`, { name: '(missing)' } as Content)
      }
    })

    // Parse marker annotation (marked / label) from each marker's rawText. It
    // lives on the marker record (`{layer, marked?, label?}`), not the layer,
    // so we read it straight off the cached bytes — no extra disk.
    const meta = new Map<string, { marked: boolean; label: string | null }>()
    filenames.forEach((name) => {
      const m = nextByFilename.get(`${locationSig}:${name}`)
      if (!m) return
      try {
        const parsed = JSON.parse(m.rawText)
        const marked = parsed?.marked === true
        const label = typeof parsed?.label === 'string' && parsed.label ? parsed.label : null
        if (marked || label) meta.set(name, { marked, label })
      } catch { /* not a JSON marker record — no annotation */ }
    })

    this.#contentByFilename = nextByFilename
    this.#contents = sigContents
    this.#entries = entries
    this.#meta = meta
    this.#setPosition(cursor.state.position)
    this.#total = filenames.length
    this.#render()

    // Pending jump from the marked-places list: once the bag we navigated to
    // has loaded, seek to the marked marker so the canvas lands on it.
    const pj = this.#pendingJump
    if (pj && pj.locationSig === locationSig) {
      const idx = entries.findIndex(e => e.filename === pj.filename)
      this.#pendingJump = null
      if (idx >= 0) cursor.seek(idx + 1)
    }

    // Phase 3: resolve child layer sigs → names so the diff summary can
    // compare tile IDENTITY across entries instead of raw sig versions. Runs
    // after the rows are painted — they show sig identity and refine when
    // names land. Content-addressed bytes mean a sig's name never changes, so
    // stale completions from an abandoned reload are still valid cache entries.
    if (history.getLayerBySig) {
      const known = this.#childNames
      const pending = new Set<string>()
      for (const content of sigContents.values()) {
        const kids = (content as Record<string, unknown>)['children']
        if (!Array.isArray(kids)) continue
        for (const sig of kids) {
          if (typeof sig === 'string' && SIG_RE.test(sig) && !known.has(sig)) pending.add(sig)
        }
      }
      if (pending.size > 0) {
        const resolved = await Promise.all([...pending].map(async (sig) => {
          try {
            const layer = await history.getLayerBySig!(sig)
            const name = layer && typeof layer.name === 'string' && layer.name ? layer.name : null
            return [sig, name] as const
          } catch {
            return [sig, null] as const
          }
        }))
        const nextNames = new Map(this.#childNames)
        for (const [sig, name] of resolved) if (name) nextNames.set(sig, name)
        if (nextNames.size !== this.#childNames.size) {
          this.#childNames = nextNames
          this.#render()
        }
      }
    }
  }
}

// ── small DOM helpers ────────────────────────────────────────────────────

const spanEl = (className: string, text?: string): HTMLElement => {
  const span = document.createElement('span')
  span.className = className
  if (text !== undefined) span.textContent = text
  return span
}

/** `(wheel)="$event.stopPropagation()"` — the scrolling regions keep the wheel
 *  to themselves so it never reaches the canvas zoom. */
const stopWheel = (event: Event): void => { event.stopPropagation() }

// ─────────────────────────────────────────────────────────────────────
// Line-level diff for the slice inspector.
//
// Classic LCS over the two line arrays — O(m*n) time and space. Layer JSON is
// typically a few dozen lines so this is effectively free and produces the
// readable visual expected for add/remove highlighting (interleaved in
// original order, not added-then-removed).
// ─────────────────────────────────────────────────────────────────────

/**
 * Serialise a layer to a stable, set-aware line representation for diffing.
 * The viewer is SLOT-AGNOSTIC: every non-empty slot the layer carries
 * (children, notes, tags, ...) renders alphabetically. Empty slots are omitted
 * entirely — sparse-layer invariant — so an empty `children: []` never appears
 * as garbage in the display.
 *
 * Each sig in a slot's array appears on its own line with no trailing-comma
 * artefacts so a sibling sig that just changed position still matches its
 * previous-layer counterpart as `same` in the diff. Inline (non-sig) values
 * are JSON-stringified per line.
 *
 * Format (NOT valid JSON — diff/display only):
 *   {
 *     "name": "<name>",
 *     "children": [
 *       <sig1>
 *       <sig2>
 *     ],
 *     "notes": [
 *       <noteSig1>
 *     ]
 *   }
 */
function layerToDiffableLines(content: Content): string[] {
  const lines: string[] = ['{']
  lines.push(`  "name": ${JSON.stringify(content.name ?? '')}`)
  const slotKeys = Object.keys(content)
    .filter(k => k !== 'name')
    .sort((a, b) => a.localeCompare(b))
  for (const key of slotKeys) {
    const v = (content as Record<string, unknown>)[key]
    if (!Array.isArray(v) || v.length === 0) continue
    // Sort sigs/values to make set-membership the only thing that matters in
    // the diff. Original order is irrelevant for "what changed" rendering.
    const entries = v.map(x => typeof x === 'string' ? x : JSON.stringify(x))
    entries.sort((a, b) => a.localeCompare(b))
    // Append a trailing comma to the previous line for valid-ish JSON shape
    // (last line of previous slot or `name`).
    lines[lines.length - 1] = lines[lines.length - 1] + ','
    lines.push(`  ${JSON.stringify(key)}: [`)
    for (const e of entries) lines.push(`    ${e}`)
    lines.push(`  ]`)
  }
  lines.push('}')
  return lines
}

function diffLines(
  a: readonly string[],
  b: readonly string[],
): Array<{ text: string; status: 'same' | 'add' | 'remove' }> {
  const m = a.length, n = b.length
  // dp[i][j] = LCS length of a[0..i] and b[0..j]
  const dp: number[][] = new Array(m + 1)
  for (let i = 0; i <= m; i++) dp[i] = new Array(n + 1).fill(0)
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  const out: Array<{ text: string; status: 'same' | 'add' | 'remove' }> = []
  let i = m, j = n
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      out.unshift({ text: a[i - 1], status: 'same' }); i--; j--
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      out.unshift({ text: a[i - 1], status: 'remove' }); i--
    } else {
      out.unshift({ text: b[j - 1], status: 'add' }); j--
    }
  }
  while (i > 0) { out.unshift({ text: a[i - 1], status: 'remove' }); i-- }
  while (j > 0) { out.unshift({ text: b[j - 1], status: 'add' }); j-- }
  return out
}

// ─────────────────────────────────────────────────────────────────────
// Diff summariser. Categorises the dominant kind of change between two layers
// so the viewer can colour-code the row. It stays local to this surface — it
// was local to the component for the same reason (nothing else consumes it),
// and its output strings are DELIBERATELY untranslated: they are a compact
// notation ("+2 tiles · -1 note"), not prose, and the original never passed
// them through the pipe.
// ─────────────────────────────────────────────────────────────────────

function summarise(
  prev: Content | undefined,
  next: Content | undefined,
  nameOf: (sig: string) => string | undefined,
): { summary: string; category: Category; isCascade: boolean } {
  if (!next) return { summary: '(loading)', category: 'none', isCascade: false }

  // Slot-agnostic diff: union of every slot present in either layer. Deltas
  // are reported per-slot. Categories use the first slot whose values changed
  // to colour the row (children → 'cells', notes → 'notes', etc.; unknown
  // slots fall through to 'system').
  //
  // The `children` slot is diffed by NAME, not by sig. Child sigs are
  // versions — any downstream edit swaps the sig while the tile (its name)
  // stays put. Diffing raw sigs turned one added tile plus a merkle ripple
  // into "-7 tiles +8 tiles". Identity is the name.
  const slotKeys = new Set<string>([
    ...Object.keys(prev ?? {}).filter(k => k !== 'name'),
    ...Object.keys(next).filter(k => k !== 'name'),
  ])

  const parts: string[] = []
  let category: Category = 'none'
  let slotsChanged = 0
  let totalAdded = 0
  let totalRemoved = 0
  let reorderCount = 0
  // children sigs changed but no name-level delta — pure version ripple
  let childrenRippled = false
  // some child sig had no resolved name; identity degraded to raw sigs
  let childrenUnresolved = false

  for (const key of [...slotKeys].sort()) {
    const pArr = (prev && Array.isArray((prev as Record<string, unknown>)[key]))
      ? ((prev as Record<string, unknown>)[key] as unknown[])
      : []
    const nArr = Array.isArray((next as Record<string, unknown>)[key])
      ? ((next as Record<string, unknown>)[key] as unknown[])
      : []

    let pIds = pArr
    let nIds = nArr
    if (key === 'children') {
      const toIdentity = (v: unknown): unknown => {
        if (typeof v !== 'string') return v
        const name = nameOf(v)
        if (name === undefined) { childrenUnresolved = true; return v }
        return name
      }
      pIds = pArr.map(toIdentity)
      nIds = nArr.map(toIdentity)
    }

    const added = difference(nIds, pIds)
    const removed = difference(pIds, nIds)
    const reordered = added.length === 0 && removed.length === 0 && !sequenceEqual(nIds, pIds)
    if (added.length === 0 && removed.length === 0 && !reordered) {
      if (key === 'children' && !sequenceEqual(pArr, nArr)) childrenRippled = true
      continue
    }

    slotsChanged++
    totalAdded += added.length
    totalRemoved += removed.length
    if (reordered) reorderCount++

    if (added.length) parts.push(`+${added.length} ${slotNoun(key, added.length)}`)
    if (removed.length) parts.push(`-${removed.length} ${slotNoun(key, removed.length)}`)
    if (reordered) parts.push(`reorder ${slotNoun(key, nArr.length)} (${nArr.length})`)
    if (category === 'none') category = slotCategory(key)
  }

  if (parts.length === 0) {
    // No name-level change anywhere, but the children sigs swapped — lineage
    // pull-up from a downstream edit. Hidden as a cascade row.
    if (childrenRippled) return { summary: '(sync)', category: 'none', isCascade: true }
    return { summary: '(no change)', category: 'none', isCascade: false }
  }

  // Legacy cascade fingerprint, only meaningful when child names could not be
  // resolved (identity degraded to raw sigs): exactly one slot changed by a
  // 1-for-1 sig swap, no reorders, no other slot deltas. With resolved names a
  // cascade never reaches here — it lands in the childrenRippled branch above.
  const isCascade = childrenUnresolved
    && slotsChanged === 1
    && totalAdded === 1
    && totalRemoved === 1
    && reorderCount === 0

  return { summary: parts.join(' · '), category, isCascade }
}

/** Map a slot name to a human-readable noun. Falls back to the raw slot name
 *  so unknown / future slots still render coherently. */
function slotNoun(slot: string, count: number): string {
  if (slot === 'children') return count === 1 ? 'tile' : 'tiles'
  if (slot === 'notes')    return count === 1 ? 'note' : 'notes'
  if (slot === 'tags')     return count === 1 ? 'tag'  : 'tags'
  return slot
}

function slotCategory(slot: string): Category {
  if (slot === 'children') return 'cells'
  if (slot === 'notes')    return 'notes'
  if (slot === 'tags')     return 'tags'
  return 'system'
}

function difference<T>(a: readonly T[], b: readonly T[]): T[] {
  const bs = new Set(b)
  return a.filter(x => !bs.has(x))
}

function sequenceEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

// ── shell surface registration — the externalization path ────────────────
// Same name, same order band the Angular component held: ORDER 2, nearly the
// lowest in the registry, so the viewer paints UNDER almost everything.
// Deliberate, and kept exactly.
//
// DEFINED AT MODULE SCOPE, registered when a registry appears. A host with no
// ShellSurfaceRegistry (diamond-core-processor mounts these tags directly in
// its own template) still needs the tag to be a real element rather than an
// inert unknown one — so the define cannot wait on the registry. Only the ADD
// does.
if (!customElements.get(SURFACE_NAME)) {
  customElements.define(SURFACE_NAME, HistoryViewerElement)
}

window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/HistoryViewerElement',
    element: SURFACE_NAME,
    order: 2,
  })
})
