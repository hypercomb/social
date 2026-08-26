// clipboard-panel.view.ts — THE CLIPBOARD, as a framework-free custom element
// (everything-is-a-beehavior Phase 2: Angular panels leave the shell and ship
// as signed modules).
//
// A straight port of shared/ui/clipboard-panel: same surface name
// (hc-clipboard-panel), same order band (150), same panel id
// ('clipboard-panel' — so the participant's saved width, text size and group
// membership come across), same four effects in and the same six out. It lands
// beside `clipboard.worker.ts`, which owns every verb it emits.
//
// ── WHAT IT IS FOR ─────────────────────────────────────────────────────────
//
// The NON-NAVIGATING replacement for the old clipboard MODE (which set
// show-cell's `#clipboardView` and replaced the page's tiles with clipboard
// labels — pulling you away from the target). This panel lists the captured
// tiles (with thumbnails of their actual images) while the current page stays
// fully rendered and interactive behind it; you place items onto THIS page
// without ever leaving.
//
// ── THE SWAP ───────────────────────────────────────────────────────────────
//
// One gesture, both directions. A row clicked HERE leaves the window and lands
// on the page behind it; a tile clicked THERE leaves the page and lands here
// (TileOverlayDrone reads the same `clipboard:open` this panel emits, and
// answers a plain click with `clipboard:take-items`). Ctrl is the walk on both
// sides: ctrl+click a row to step into its children, or a tile on the hive to
// go where you want to place. That is the whole interface — no per-row place
// button, no discard button that isn't the hover ×, no target-slot field. A
// placed tile lands in the next free slot, the way any paste does.
//
// ── WHAT THE CLIPBOARD HOLDS, AND WHAT THE PANEL DERIVES ───────────────────
//
// The clipboard holds SIGNATURES — `{ label, sourceSegments }` entries whose
// subtree was sealed at capture. Everything this window says about what a
// paste WOULD do is derived, and the derivation is reproduced here exactly as
// the Angular original wrote it, never re-derived a second way:
//
//   • the child COUNT badge is `worker.childCountAt([...sourceSegments,
//     label])` — the warm parent-children slot, not the cold own-bag — cached
//     per row identity for one open session, resolved in batches of four OFF
//     the render path. A miss stays absent: no badge, never a hang. The badge
//     doubles as the walk-in handle, which is why "0" must not render one.
//   • the THUMBNAIL is the same image the renderer paints (props index →
//     canonical properties → Store.getResource → object-URL), asked for the
//     'small' face because these rows are hex chrome. Read-only — never
//     writing, so the "image stable once present" rule is untouched.
//   • what a row's click DOES depends only on whether we are drilled: a
//     top-level row places + consumes by LABEL (`clipboard:place-items`); a
//     drilled child is not a clipboard entry, so it places by its full SOURCE
//     PATH and consumes nothing (`clipboard:place-entries`).
//
// ── 'captured' vs 'changed': WHICH ONE REVISES THE LIST ────────────────────
//
// `clipboard:changed` is the AUTHORITY and the sole writer of the list — it
// carries `{ items, count }` straight from ClipboardService's `#notify`, and
// it is last-value replayed so the panel is current the instant it mounts.
// `clipboard:captured` carries `{ labels, op }` and the panel READS NONE OF
// IT: it is a pure open-trigger that consults the list `clipboard:changed`
// has already set (`#items.length > 0`). The worker stages into the service
// FIRST (→ `clipboard:changed`) and emits `clipboard:captured` after, so that
// read is never one gesture behind. Treating 'captured' as a list update
// would both duplicate rows and lose the source paths it does not carry.
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
// full-bleed wrapper is gone and the `.clipboard-panel` rules land on the tag
// — the sequence-viewer precedent. The panel's own left grip and width signal
// (`ownsSize:false` + `sizeOwner`) retire into the base's grip, which persists
// under `hc:docked-width:clipboard-panel`; the participant's old width is
// seeded across from `hc:clipboard-panel-width` once, write-if-absent.
//
// Its strings ship WITH it (clipboard-panel.i18n.ts, extracted from all 14
// shell catalogs) and register under the 'app' namespace, so every key
// resolves exactly as before — the Phase 2 catalog split, another slice.

import { EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { DockedPanelElement } from '../panels/docked-panel.element.js'
import { CLIPBOARD_PANEL_TRANSLATIONS } from './clipboard-panel.i18n.js'

const SURFACE_NAME = 'hc-clipboard-panel'

/** One held tile: a label and the absolute path of the parent it came from. */
interface ClipboardItem {
  label: string
  sourceSegments: readonly string[]
}

/** What the list renders — resolved ONCE per change instead of by per-row
 *  lookups on every paint. `key` is the item's identity (label + source path):
 *  the clipboard can legitimately hold two same-named tiles from different
 *  parents, and it is what the thumbnail and count caches are keyed by. */
interface ClipboardRow {
  item: ClipboardItem
  key: string
  label: string
  thumb: string | undefined
  count: number
}

interface ClipboardChangedPayload {
  items?: ClipboardItem[]
  count?: number
}

/** Identity of a clipboard row — never the bare label. */
const rowKey = (item: ClipboardItem): string =>
  item.label + '\u0000' + item.sourceSegments.join('/')

// Participant-local set of absolute source paths a nested-discard has dropped.
// Shared verbatim with the clipboard worker, which prunes these branches on
// paste. localStorage, never the layer — clipboard state is participant-local.
const EXCLUSIONS_KEY = 'hc:clipboard-exclusions'
const CLIPBOARD_WORKER_KEY = '@diamondcoreprocessor.com/ClipboardWorker'
const LINEAGE_KEY = '@hypercomb.social/Lineage'
const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const STORE_KEY = '@hypercomb.social/Store'
// Resolve child counts in small batches so a many-item clipboard can't fire a
// burst of (possibly cold) layer reads at once — keeps it off the render path.
const COUNT_BATCH = 4

// The width the Angular panel persisted for itself while it carried
// `[ownsSize]="false"`. The base owns the width now and stores it under
// `hc:docked-width:clipboard-panel`; this key is read ONCE, write-if-absent,
// so a participant who had dragged the panel wide keeps it.
const LEGACY_WIDTH_KEY = 'hc:clipboard-panel-width'
const PANEL_ID = 'clipboard-panel'
const WIDTH_KEY = `hc:docked-width:${PANEL_ID}`

type WorkerLike = {
  childrenAt?: (segments: readonly string[]) => Promise<string[]>
  childCountAt?: (segments: readonly string[]) => Promise<number>
  propsSigAt?: (segments: readonly string[]) => Promise<string | null>
}
type LineageLike = { explorerSegments?: () => readonly string[] }
type HistoryLike = { sign?: (ctx: { explorerSegments: () => string[] }) => Promise<string> }
type StoreLike = { getResource?: (sig: string) => Promise<Blob | null> }

const get = <T,>(key: string): T | undefined => window.ioc?.get?.<T>(key)

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

/** The two counting strings inflect on `count`, and NEITHER has the shape the
 *  other does: `clipboard.children` exists ONLY as `.one` / `.other`, while
 *  `clipboard.selection` has `.one` and a BARE key doing the `.other` job. The
 *  i18n service picks between them off `params.count`; the FALLBACK has to
 *  make the same choice itself, or a host with no catalog would read
 *  "1 children". */
const tCount = (key: string, one: string, other: string, count: number): string =>
  t(key, count === 1 ? one : other, { count })

// The panel's strings travel with it — registered as soon as the i18n
// service is up, under 'app' so the keys resolve exactly as they always did.
window.ioc?.whenReady?.(I18N_IOC_KEY, (i18n) => {
  const provider = i18n as I18nProvider
  for (const [locale, catalog] of Object.entries(CLIPBOARD_PANEL_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

// ── exclusions (participant-local, shared with the worker) ────────────────

const restoreExclusions = (): Set<string> => {
  try {
    const raw = localStorage.getItem(EXCLUSIONS_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(arr) ? arr.filter((x: unknown): x is string => typeof x === 'string') : [])
  } catch { return new Set() }
}

const persistExclusions = (set: ReadonlySet<string>): void => {
  try {
    if (set.size === 0) localStorage.removeItem(EXCLUSIONS_KEY)
    else localStorage.setItem(EXCLUSIONS_KEY, JSON.stringify([...set]))
  } catch { /* ignore */ }
}

// ── thumbnails ────────────────────────────────────────────────────────────
//
// "What does this clipboard entry look like" — a verbatim transplant of
// shared/ui/clipboard-thumbs.ts, which cannot be imported from a module (the
// dependency direction: modules → core only) and cannot be moved yet, because
// the chat window's context squares still read it from shared. When that panel
// converts, ONE of the two copies must go down to core and both call it —
// carrying two resolvers is exactly how the two faces of the gathered set
// start showing different pictures for one entry.
//
// Resolution goes through the participant-local props-index (localStorage,
// O(1)) — the same cache the renderer reads — with the worker's warm canonical
// lookup as the only fallback. We deliberately do NOT touch
// `history.currentLayerAt`: for a tile with no index entry that read can
// trigger a cold `preloadAllBags` whole-tree scan, and a set of N such entries
// would fire N scans and hang the surface. A miss returns null and the row
// shows its ⬢ glyph.

const SIG_RE = /^[0-9a-f]{64}$/i
const TILE_PROPS_INDEX_KEY = 'hc:tile-props-index'

const lookupPropsSig = (locSig: string, label: string): string | undefined => {
  try {
    const idx = JSON.parse(localStorage.getItem(TILE_PROPS_INDEX_KEY) ?? '{}') as Record<string, string>
    const v = (locSig && idx[locSig]) ?? idx[label]
    return (typeof v === 'string' && SIG_RE.test(v)) ? v : undefined
  } catch { return undefined }
}

/** Canonical props sig from the tile's LAYER (via the worker's warm path),
 *  used only when the localStorage render-index has no entry. Best-effort. */
const canonicalPropsSig = async (segments: readonly string[]): Promise<string | undefined> => {
  const worker = get<WorkerLike>(CLIPBOARD_WORKER_KEY)
  if (!worker?.propsSigAt) return undefined
  try { return (await worker.propsSigAt(segments)) ?? undefined } catch { return undefined }
}

const sigAt = (props: Record<string, unknown>, slot: 'large' | 'small'): string | undefined => {
  const direct = (props as Record<string, { image?: unknown } | undefined>)[slot]
  if (direct && typeof direct === 'object' && typeof direct.image === 'string' && SIG_RE.test(direct.image)) return direct.image
  const flat = (props as { flat?: Record<string, { image?: unknown } | undefined> }).flat
  const fi = flat?.[slot]?.image
  return (typeof fi === 'string' && SIG_RE.test(fi)) ? fi : undefined
}

const imageSigOf = (props: Record<string, unknown>, prefer: 'large' | 'small'): string | undefined =>
  prefer === 'large'
    ? sigAt(props, 'large') ?? sigAt(props, 'small')
    : sigAt(props, 'small')

/** Entry → blob: URL, or null on any miss. The CALLER owns the URL — cache it,
 *  and revoke it when the entry leaves the screen. */
const resolveEntryImageUrl = async (
  label: string,
  sourceSegments: readonly string[],
  prefer: 'large' | 'small',
): Promise<string | null> => {
  const history = get<HistoryLike>(HISTORY_KEY)
  const store = get<StoreLike>(STORE_KEY)
  if (!store?.getResource) return null

  let locSig = ''
  if (history?.sign) {
    try { locSig = await history.sign({ explorerSegments: () => [...sourceSegments, label] }) } catch { /* cold */ }
  }
  let propsSig = lookupPropsSig(locSig, label)
  if (!propsSig) {
    // Render-index miss — the tile was never rendered with this image (a cut
    // tile, or a freshly generated image). The canonical read keeps a
    // generated picture from being lost.
    propsSig = await canonicalPropsSig([...sourceSegments, label])
  }
  if (!propsSig) return null

  const propsBlob = await store.getResource(propsSig)
  if (!propsBlob) return null
  let props: Record<string, unknown>
  try { props = JSON.parse(await propsBlob.text()) } catch { return null }

  const imageSig = imageSigOf(props, prefer)
  if (!imageSig) return null
  const imgBlob = await store.getResource(imageSig)
  if (!imgBlob) return null
  return URL.createObjectURL(imgBlob)
}

// ── the styles the Angular SCSS carried, expanded to plain CSS ────────────
//
// No shadow DOM (the tutorial-overlay + sequence-viewer precedent), so
// Angular's `:host` becomes the tag name and every other selector is prefixed
// with it. `$steel: rgb(126, 182, 214)` is inlined at every `rgba($steel, …)`
// call site; `tw.$radius-card` becomes `var(--hc-radius-card)` (the shape
// ladder is published app-wide on `:root` by _shape.scss) and the
// `var(--md-*)` / `var(--hc-*)` tokens are left alone.
//
// THREE EXPANSIONS WORTH NAMING:
//
//  • `@include tw.panel($steel, right)` was the LAST line of `.clipboard-panel`,
//    so its declarations won the cascade over the ones written above it. The
//    effective values are written here once — background rgba(13,15,21,.975)
//    (not rgba(14,16,22,.92)), backdrop blur(14px) saturate(1.04) (not
//    blur(10px) saturate(1.1)), border-left alpha .38 (not .45), the
//    -14px/44px shadow (not -10px/40px) and colour #eef2f5 (not #f1f3f5) —
//    rather than emitting both and leaving five dead declarations in a
//    document-level sheet.
//
//  • `.clipboard-close` and `.clipboard-back` sit LATER in the sheet than the
//    `tw.header` band rules, but `…clipboard-header>button[class*='close']`
//    (0,2,2) outranks `…clipboard-close` (0,1,1) and `…clipboard-header>button`
//    (0,1,2) outranks `…clipboard-back` (0,1,1) — so width / padding /
//    font-size / colour come from the header band and only background /
//    border / cursor / flex come from the panel's own rules. That ordering is
//    reproduced verbatim below (identical selectors, identical order, one type
//    selector added to each) so both buttons land where they always did.
//
//  • The `.resize-grip` rules are GONE, with the grip: DockedPanelElement
//    installs the participant's resize handle on the inner edge and styles it
//    inline. The one behaviour that does not come across is
//    `.clipboard-panel.resizing { user-select: none; cursor: ew-resize }` —
//    the base tints its own grip line and preventDefault()s the pointerdown
//    instead, and never sets a `.resizing` class.
//
// Angular's build autoprefixed; `-webkit-backdrop-filter` and
// `-webkit-user-select` are written by hand.
const CSS = `
${SURFACE_NAME}{position:fixed;top:max(calc(2.3rem * var(--hc-header-zoom,1)),var(--hc-header-anchor));right:var(--hc-controls-right,0);bottom:0;z-index:100002;display:none;flex-direction:column;width:320px;min-width:260px;max-width:calc(100vw - 1.5rem);
  --hc-window-accent:rgb(126,182,214);--hc-window-radius-control:var(--hc-radius-control);--hc-window-radius-card:var(--hc-radius-card);--hc-window-radius-floating:var(--hc-radius-floating);
  background:rgba(13,15,21,.975);backdrop-filter:blur(14px) saturate(1.04);-webkit-backdrop-filter:blur(14px) saturate(1.04);border-radius:0;
  border-right:0;border-left:1px solid rgba(126,182,214,.38);box-shadow:-14px 0 44px rgba(0,0,0,.46),inset 1px 0 rgba(255,255,255,.025);
  font-family:var(--hc-mono,system-ui);font-size:calc(1rem * var(--hc-panel-scale,1));color:#eef2f5;outline:none}
${SURFACE_NAME}.open{display:flex}
${SURFACE_NAME} .clipboard-body{display:contents}
${SURFACE_NAME} .clipboard-header{flex:0 0 auto;box-sizing:border-box;display:flex;align-items:center;gap:.5rem;height:2.875rem;min-height:2.875rem;padding:0 .75rem;line-height:1;background:linear-gradient(180deg,rgba(255,255,255,.018),rgba(255,255,255,.006));border-bottom:1px solid rgba(126,182,214,.22)}
${SURFACE_NAME} .clipboard-header>button{box-sizing:border-box;display:inline-grid;place-items:center;min-width:1.75rem;height:1.75rem;padding:0 .25rem;border-radius:var(--hc-radius-control);line-height:1;transition:color 120ms ease,background-color 120ms ease,border-color 120ms ease}
${SURFACE_NAME} .clipboard-header>button:hover{background-color:rgba(255,255,255,.055)}
${SURFACE_NAME} .clipboard-header>button:focus-visible{outline:1px solid color-mix(in srgb,var(--hc-window-accent) 72%,white);outline-offset:1px}
${SURFACE_NAME} .clipboard-header>button[class*='close']{width:1.75rem;min-width:1.75rem;padding:0;font-size:1.125rem;color:rgba(238,244,248,.62)}
${SURFACE_NAME} .clipboard-header>button[class*='close']:hover{color:#fff;background-color:rgba(255,255,255,.075)}
${SURFACE_NAME} .clipboard-title{flex:1;font-size:.88em;letter-spacing:.06em;color:rgba(126,182,214,.95)}
${SURFACE_NAME} .clipboard-close{background:transparent;border:none;color:rgba(255,255,255,.7);font-size:1.35em;line-height:1;cursor:pointer;padding:0 .25em}
${SURFACE_NAME} .clipboard-close:hover{color:rgb(126,182,214)}
${SURFACE_NAME} .clipboard-back{flex:0 0 auto;background:transparent;border:none;color:rgba(126,182,214,.9);font-size:1.4em;line-height:1;cursor:pointer;padding:0 .3em 0 0}
${SURFACE_NAME} .clipboard-back:hover{color:rgb(126,182,214)}
${SURFACE_NAME} .clipboard-crumb{flex:1;font-size:.82em;letter-spacing:.04em;color:rgba(126,182,214,.95);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${SURFACE_NAME} .clipboard-empty{margin:0;padding:1.5em 1em;font-size:.82em;color:rgba(255,255,255,.4)}
${SURFACE_NAME} .clipboard-selection{flex:0 0 auto;display:flex;align-items:center;gap:.4em;padding:.45em .75em;border-bottom:1px solid rgba(126,182,214,.16);background:rgba(126,182,214,.06)}
${SURFACE_NAME} .clipboard-selection-count{flex:1;min-width:0;font-size:.78em;color:rgba(207,226,238,.75);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${SURFACE_NAME} .clipboard-selection-btn{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:1.7em;height:1.7em;padding:0;border:1px solid rgba(126,182,214,.35);border-radius:var(--hc-radius-card);background:none;color:#cfe2ee;cursor:pointer;transition:background 140ms ease,border-color 140ms ease,color 140ms ease}
${SURFACE_NAME} .clipboard-selection-btn .mat-sym{font-size:.95em}
${SURFACE_NAME} .clipboard-selection-btn:hover{background:rgba(126,182,214,.16);border-color:rgba(126,182,214,.7);color:#f4fafd}
${SURFACE_NAME} .clipboard-selection-btn:focus-visible{outline:1px solid rgba(126,182,214,.8);outline-offset:1px}
${SURFACE_NAME} .clipboard-scroll{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:.4em 0}
${SURFACE_NAME} .clipboard-items{list-style:none;margin:0;padding:0}
${SURFACE_NAME} .clipboard-item{display:flex;align-items:center;gap:.6em;padding:.45em .85em;border-bottom:1px solid rgba(255,255,255,.04)}
${SURFACE_NAME} .clipboard-item:hover{background:rgba(126,182,214,.07)}
${SURFACE_NAME} .item-swap{flex:1;min-width:0;display:flex;align-items:center;gap:.6em;padding:0;background:transparent;border:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
${SURFACE_NAME} .item-swap:focus-visible{outline:1px solid rgba(126,182,214,.8);outline-offset:2px;border-radius:var(--hc-radius-card)}
${SURFACE_NAME} .item-glyph{color:rgba(126,182,214,.7);font-size:1.5em;line-height:1;flex:0 0 auto;width:2em;text-align:center}
${SURFACE_NAME} .item-thumb{flex:0 0 auto;width:2em;height:2.2em;display:inline-flex;align-items:center;justify-content:center}
${SURFACE_NAME} .item-thumb img{width:100%;height:100%;object-fit:cover;clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);background:rgba(126,182,214,.08);-webkit-user-select:none;user-select:none}
${SURFACE_NAME} .item-label{flex:1;min-width:0;font-size:.82em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${SURFACE_NAME} .item-count{flex:0 0 auto;min-width:1.4em;padding:.05em .4em;border-radius:999px;font-family:inherit;font-size:.62em;font-variant-numeric:tabular-nums;text-align:center;color:rgba(126,182,214,.9);background:rgba(126,182,214,.14);border:1px solid rgba(126,182,214,.3);cursor:pointer;transition:background .12s ease,border-color .12s ease}
${SURFACE_NAME} .item-count:hover{background:rgba(126,182,214,.26);border-color:rgba(126,182,214,.7)}
${SURFACE_NAME} .item-count:focus-visible{outline:1px solid rgba(126,182,214,.8);outline-offset:1px}
${SURFACE_NAME} .item-discard{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:1.4em;height:1.7em;background:transparent;border:none;color:rgba(255,255,255,.4);font-size:1.15em;line-height:1;cursor:pointer;opacity:0;transition:color .12s ease,opacity .12s ease}
${SURFACE_NAME} .item-discard:hover{color:rgba(255,140,140,.9)}
${SURFACE_NAME} .item-discard:focus-visible{opacity:1;outline:1px solid rgba(126,182,214,.8);outline-offset:1px}
${SURFACE_NAME} .clipboard-item:hover .item-discard,
${SURFACE_NAME} .clipboard-item:focus-within .item-discard{opacity:1}
${SURFACE_NAME} .clipboard-foot{display:flex;align-items:center;gap:.5em;padding:.7em .85em;border-top:1px solid rgba(126,182,214,.2)}
${SURFACE_NAME} .place-all{flex:1;padding:.55em .75em;background:rgba(126,182,214,.16);border:1px solid rgba(126,182,214,.5);border-radius:var(--hc-radius-card);color:#eaf4fb;font-family:inherit;font-size:.8em;letter-spacing:.02em;cursor:pointer;transition:background .12s ease}
${SURFACE_NAME} .place-all:hover{background:rgba(126,182,214,.28)}
${SURFACE_NAME} .clear-all{background:transparent;border:none;color:rgba(255,255,255,.45);font-family:inherit;font-size:.74em;cursor:pointer;padding:0 .4em}
${SURFACE_NAME} .clear-all:hover{color:rgba(255,140,140,.9)}
${SURFACE_NAME} .clipboard-hint{margin:0;padding:.55em .85em .75em;font-size:.62em;line-height:1.45;color:rgba(255,255,255,.38);border-top:1px solid rgba(255,255,255,.05)}
${SURFACE_NAME} .clipboard-empty{flex:1}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-clipboard-panel', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

/** Two published records are the same reading — used to skip a rebuild that
 *  would repaint the identical list (a count batch that resolved four zeros,
 *  a `clipboard:changed` delivered twice for one gesture). Not a diff of the
 *  DOM: the DOM is still thrown away and rebuilt whenever the reading moves. */
const sameRecord = <V,>(a: Record<string, V>, b: Record<string, V>): boolean => {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  for (const k of keys) if (a[k] !== b[k]) return false
  return true
}

export class ClipboardPanelElement extends DockedPanelElement {

  #offs: Array<() => void> = []

  /** THE visibility flag. `close`, the toggle, the capture auto-open and the
   *  session's park/unpark all read and write THIS field. */
  #visible = false

  // ── state (the panel's whole model — never read back out of the DOM) ──
  #items: readonly ClipboardItem[] = []
  /** Live canvas selection size — this window's selection response
   *  (documentation/selection-tool-windows.md): while tiles are selected, the
   *  panel offers capturing THEM, right where the captured result lands. */
  #selectionCount = 0
  /** rowKey -> thumbnail object-URL. Absent => the ⬢ glyph. */
  #thumbs: Record<string, string> = {}
  /** rowKey -> number of children at that source location. Best-effort,
   *  resolved off the render path; absent/0 => no badge. The badge is also the
   *  walk-in handle, so it says "there is somewhere to go here". */
  #counts: Record<string, number> = {}

  // ── drill-down ───────────────────────────────────────────────────────
  // The clipboard is just another hierarchy: clicking a tile's row with ctrl
  // held descends into its children (resolved from the live SOURCE tree it
  // points at), with a back button. Each stack entry is a level we've entered;
  // empty = top-level clipboard items.
  #drillStack: { label: string; segments: readonly string[] }[] = []
  #drillChildren: readonly ClipboardItem[] = []
  /** Absolute source paths the user has discarded while drilled — kept out of
   *  the drill view AND skipped on paste (the worker reads the same key). */
  #exclusions: Set<string> = restoreExclusions()

  // Live object-URLs by row identity, so they can be revoked on change/destroy.
  #urls = new Map<string, string>()
  // Monotonic token so a stale async thumbnail resolve can't overwrite a newer
  // clipboard state (rapid copy/clear races).
  #thumbToken = 0
  // Same guard for the (separate) child-count resolution.
  #countToken = 0
  /** rowKey -> child count, kept across displays. A child count is a fact
   *  about a source location, and taking a tile republishes the whole list —
   *  without this, every click would re-read every held tile's children, so
   *  the cost of filling the window grew with what was already in it. Numbers
   *  only; drilling in and back out costs nothing the second time. */
  #countCache = new Map<string, number>()
  // Guards the auto-open: EffectBus replays the LAST `clipboard:captured` to a
  // late subscriber, which would pop the panel open on every mount. We only
  // auto-open for captures that arrive AFTER the initial sync.
  #ready = false

  // Chrome built once per activation. The header must survive a re-render
  // because DockedPanelElement plants the settings gear inside it (and nudges
  // the close button over to make room) AFTER renderPanel() returns —
  // rebuilding the header would throw the gear away. The drill swap therefore
  // MOVES its three header nodes (the `@if`'s own semantics: attached or gone)
  // instead of rebuilding the band.
  #header: HTMLElement | null = null
  #body: HTMLElement | null = null
  #titleEl: HTMLElement | null = null
  #backEl: HTMLButtonElement | null = null
  #crumbEl: HTMLElement | null = null
  #closeEl: HTMLButtonElement | null = null

  constructor() {
    super()
    // Same panel id the Angular `hcDockedPanel="clipboard-panel"` carried, so
    // the saved width, text size, code font and group membership all come
    // across with the participant. The four size inputs are the template's,
    // verbatim: [minWidth]=260 [maxWidth]=760 [defaultWidth]=320 [maxScale]=1.5.
    this.panelId = PANEL_ID
    this.dockSide = 'right'
    this.minWidth = 260
    this.maxWidth = 760
    this.defaultWidth = 320
    this.maxScale = 1.5
    // Registry-fed: mounted once at boot, engaged only when something opens it.
    this.autoActivate = false
    this.#adoptLegacyWidth()

    // Put away while the hive is covered. Deliberately NOT `#setVisible` —
    // that resets the drill level on the way back in, and the level you had
    // drilled to is precisely what "remembered" means here. The
    // `clipboard:open` announcement still goes out both ways so the Escape
    // cascade and the control-bar light agree with the screen. Session-only as
    // ever: parking survives the installer, not a refresh.
    this.session = {
      park: () => { this.#hide(); EffectBus.emit('clipboard:open', { open: false }) },
      unpark: () => { this.#show(); EffectBus.emit('clipboard:open', { open: true }) },
      // Escape's owner is the cascade; this is how the panel takes part. It
      // also keeps its OWN cascade rung (the clipboard is reachable with the
      // focus out on the canvas, which is the whole point of a clipboard).
      close: () => { this.close() },
    }
  }

  /** The width the panel persisted for itself while it owned its own grip.
   *  Write-if-absent, so a width already saved through the base's key always
   *  wins and this can never walk one back. */
  #adoptLegacyWidth(): void {
    try {
      if (localStorage.getItem(WIDTH_KEY) !== null) return
      const raw = localStorage.getItem(LEGACY_WIDTH_KEY)
      const n = raw ? parseInt(raw, 10) : NaN
      if (Number.isFinite(n)) localStorage.setItem(WIDTH_KEY, String(n))
    } catch { /* ignore */ }
  }

  // ── derived readings ─────────────────────────────────────────────────

  /** True while drilled below the top-level clipboard list. */
  get #drilled(): boolean { return this.#drillStack.length > 0 }

  /** Breadcrumb of the current drill path (tile names, top → current). */
  get #drillCrumb(): string { return this.#drillStack.map(d => d.label).join(' / ') }

  /** What the list renders: the drilled level, or the clipboard at the top. */
  get #displayItems(): readonly ClipboardItem[] {
    return this.#drilled ? this.#drillChildren : this.#items
  }

  /** The list's whole model — one pass over the display set folding in the
   *  resolved thumbnail and count. */
  #rows(): ClipboardRow[] {
    const thumbs = this.#thumbs
    const counts = this.#counts
    return this.#displayItems.map(item => {
      const key = rowKey(item)
      return { item, key, label: item.label, thumb: thumbs[key], count: counts[key] ?? 0 }
    })
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

    // ── the four effects in, in the original's subscribe order ──────────
    // Held shut until the whole set is wired: every one of them is last-value
    // replayed, and a REPLAY is not a gesture (below).
    this.#ready = false

    // 1. Current clipboard contents — THE AUTHORITY, replayed immediately on
    //    subscribe so the panel reflects current state the instant it mounts.
    this.#offs.push(EffectBus.on<ClipboardChangedPayload>('clipboard:changed', (p) => {
      const items = Array.isArray(p?.items) ? p!.items! : []
      const next = items.map(i => ({ label: i.label, sourceSegments: [...(i.sourceSegments ?? [])] }))
      this.#items = next
      // An emptied clipboard USED to close the panel ("nothing left to show").
      // It stays open now: with the swap grammar an empty window is still
      // live — click a tile on the hive and it lands here. Closing is the ×,
      // Escape, or the controls-bar button, and nothing else.
      // Clipboard membership changed (capture / place / clear) — the worker
      // resets exclusions on a fresh capture, so re-read them, and drop back
      // to the top level.
      this.#exclusions = restoreExclusions()
      this.#drillStack = []
      this.#drillChildren = []
      this.#syncDisplay(next)
      this.#syncHeader()
      this.#render()
    }))

    // 2. A fresh copy/cut opens the panel. Ignored during the initial
    //    last-value replay (see `#ready`). Its payload is deliberately unread:
    //    the LIST is `clipboard:changed`'s to write, and the worker has
    //    already staged into the service by the time this arrives.
    this.#offs.push(EffectBus.on('clipboard:captured', () => {
      if (!this.#ready) return
      if (this.#items.length > 0) this.#setVisible(true)
    }))

    // 3. The controls-bar clipboard button toggles the panel. An explicit
    //    toggle does what it says — including opening on an EMPTY clipboard,
    //    which used to be refused ("nothing to show"). With the swap grammar
    //    an empty window is where the next tile you click on the hive lands,
    //    so it is worth opening on its own.
    this.#offs.push(EffectBus.on<{ visible?: boolean }>('clipboard:panel', (p) => {
      this.#setVisible(p?.visible ?? !this.#visible)
    }))

    // 4. escape-cascade owns Escape ORDERING (editor > viewers > selection >
    //    clipboard) and right-click; it emits `clipboard:close` when the panel
    //    is the active overlay. The panel announces its open state via
    //    `clipboard:open` (emitted by #setVisible) so the cascade knows.
    //    This panel binds NO keydown listener of its own, in either
    //    implementation — so there is no `keydown.escape` modifier guard to
    //    port, and adding one would invent semantics the original never had.
    this.#offs.push(EffectBus.on('clipboard:close', () => this.close()))

    // Selection notification — replayed, so a panel opened mid-selection is
    // current immediately. (The shell's `onSelection` helper normalizes two
    // publishers down to the pair; the same normalization is inlined here.)
    this.#offs.push(EffectBus.on<{ selected?: unknown }>('selection:changed', (p) => {
      const selected = Array.isArray(p?.selected) ? (p!.selected as unknown[]).length : 0
      this.#setSelectionCount(selected)
    }))

    // THE PIPE WAS IMPURE. Angular's `t` pipe is declared `pure: false`, so
    // every change-detection tick re-resolved every string and `/language ja`
    // re-labelled an OPEN panel on the spot. An element renders when it
    // decides to, so the locale switch has to be a reason to render — else an
    // open window keeps its old-locale title, empty line, row tooltips,
    // Place-all button and the hint that teaches the whole grammar until it is
    // closed and reopened. Rebuilding is safe: the rows live in `#items` /
    // `#drillChildren`, never in the DOM.
    this.#offs.push(EffectBus.on('locale:changed', () => {
      if (!this.#visible) return
      this.#relabel()
      this.#render()
    }))

    // Subscriptions wired; allow auto-open from here on.
    this.#ready = true
  }

  override disconnectedCallback(): void {
    this.#offs.forEach(off => off())
    this.#offs = []
    if (this.#visible) EffectBus.emit('clipboard:open', { open: false })
    // Bump the token so any in-flight #syncThumbs resolve sees a mismatch and
    // revokes its freshly-created object-URL instead of storing it into a map
    // we're about to drop — otherwise a thumbnail that resolves AFTER teardown
    // would leak.
    this.#thumbToken++
    this.#countToken++
    this.#revokeAll()
    super.disconnectedCallback()   // → deactivate(): lane, session, grip, gear, children
    this.#visible = false
    this.#ready = false
    this.classList.remove('open')
    this.removeAttribute('aria-label')
    this.#forgetChrome()
  }

  /** The base builds the grip AFTER renderPanel() returns, and it carries no
   *  label of its own — the Angular grip was named `clipboard.resize` in both
   *  its aria-label and its tooltip, so it is named here too. */
  protected override activate(): void {
    super.activate()
    this.#labelGrip()
  }

  // ── the open / close verbs ───────────────────────────────────────────

  /** Single visibility chokepoint — keeps escape-cascade in sync by
   *  announcing every open/close via `clipboard:open`, exactly once per
   *  transition (a redundant call returns before the emit). */
  #setVisible(v: boolean): void {
    if (this.#visible === v) return
    // Every fresh OPEN starts at the top-level clipboard list — never a stale
    // drill level left over from a previous open (which would show the wrong
    // children, or none, and read as "my items vanished").
    // The count cache is scoped to ONE open session: within a session the only
    // things that move are whole subtrees (takes and places), so a cached
    // count stays true; across sessions the hive may have been edited, so it
    // starts empty rather than badging a stale number forever.
    if (v) {
      this.#drillStack = []
      this.#drillChildren = []
      this.#countCache.clear()
      this.#show()
    } else {
      this.#hide()
    }
    EffectBus.emit('clipboard:open', { open: v })
  }

  close(): void {
    this.#drillStack = []
    this.#drillChildren = []
    this.#setVisible(false)
  }

  /** DockedPanelElement's close verb — the lane's eviction fallback and the
   *  directive's old `(hcDockedPanelClose)` both land here. */
  protected override closePanel(): void { this.close() }

  #show(): void {
    if (this.#visible) return
    this.#visible = true
    this.classList.add('open')
    this.setAttribute('aria-label', t('clipboard.title', 'Clipboard'))
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
    this.#header = null
    this.#body = null
    this.#titleEl = null
    this.#backEl = null
    this.#crumbEl = null
    this.#closeEl = null
  }

  // ── capture from inside the window ───────────────────────────────────
  // Same verbs the controls bar emits; clipboard.worker answers either way.
  #cutSelection(): void { EffectBus.emit('controls:action', { action: 'cut' }) }
  #copySelection(): void { EffectBus.emit('controls:action', { action: 'copy' }) }

  /** Drop everything from the clipboard. */
  #clearAll(): void {
    EffectBus.emit('controls:action', { action: 'clear-clipboard' })
    this.close()
  }

  /** A selection size is a STATE ASSERTION, and `selection:changed` is
   *  delivered more than once for one gesture (the pixi drone and the service
   *  both publish). Setting absorbs the repeat for free; the equality guard
   *  additionally keeps a repeat from rebuilding the list under a participant
   *  who is reading it. */
  #setSelectionCount(n: number): void {
    if (n === this.#selectionCount) return
    this.#selectionCount = n
    this.#render()
  }

  // ── drill navigation ─────────────────────────────────────────────────

  /** Descend into a tile's children. Resolves the SOURCE tree's children at
   *  that location; no-op if there are none. Thumbnails + counts run on the
   *  new level for free (same per-item resolution as the top list). */
  async #drillInto(item: ClipboardItem): Promise<void> {
    const segments = [...item.sourceSegments, item.label]
    const names = await this.#resolveChildren(segments)
    if (names.length === 0) return
    this.#drillStack = [...this.#drillStack, { label: item.label, segments }]
    this.#showChildren(names, segments)
  }

  /** Pop one drill level (the header back button). */
  #drillBack(): void {
    const stack = this.#drillStack
    if (stack.length === 0) return
    const next = stack.slice(0, -1)
    this.#drillStack = next
    if (next.length === 0) {
      this.#drillChildren = []
      this.#syncDisplay(this.#items)
      this.#syncHeader()
      this.#render()
    } else {
      const top = next[next.length - 1]
      this.#syncHeader()
      this.#render()
      void this.#resolveChildren(top.segments).then(names => this.#showChildren(names, top.segments))
    }
  }

  #showChildren(names: readonly string[], segments: readonly string[]): void {
    const children = names.map(name => ({ label: name, sourceSegments: segments }))
    this.#drillChildren = children
    this.#syncDisplay(children)
    this.#syncHeader()
    this.#render()
  }

  async #resolveChildren(segments: readonly string[]): Promise<string[]> {
    const worker = get<WorkerLike>(CLIPBOARD_WORKER_KEY)
    if (!worker?.childrenAt) return []
    let names: string[]
    try { names = await worker.childrenAt(segments) } catch { return [] }
    // Hide anything the user has discarded at this (or a deeper) level — the
    // exclusion is keyed by absolute source path, so re-drilling never
    // resurrects it.
    const excl = this.#exclusions
    return excl.size === 0 ? names : names.filter(name => !excl.has([...segments, name].join('/')))
  }

  /** Resolve thumbnails + counts for the on-screen set. */
  #syncDisplay(items: readonly ClipboardItem[]): void {
    void this.#syncThumbs(items).catch(() => { /* best-effort thumbnails */ })
    void this.#syncCounts(items).catch(() => { /* best-effort child counts */ })
  }

  // ── the swap ─────────────────────────────────────────────────────────
  // A row click puts the tile on the page behind this window; ctrl+click walks
  // into it instead, so its children can be placed one at a time. The hive
  // answers the same pair with the window open — see the header note.
  #rowClick(item: ClipboardItem, event: MouseEvent): void {
    if (event.ctrlKey || event.metaKey) { void this.#drillInto(item); return }
    this.#placeOne(item)
  }

  /** The location this panel is acting over — the page on screen behind it —
   *  read synchronously at click time so the paste is BOUND to where the user
   *  is, not re-derived by the worker after any navigation. The worker writes
   *  exactly here and refuses if it can't resolve it (never guesses). */
  #targetSegments(): string[] {
    return [...(get<LineageLike>(LINEAGE_KEY)?.explorerSegments?.() ?? [])]
  }

  /** Place every clipboard tile onto the CURRENT page, honouring any hover
   *  target indexes. Copy keeps the items (repeatable); cut consumes them. */
  #placeAll(): void {
    EffectBus.emit('clipboard:place-items', {
      labels: this.#items.map(i => i.label),
      targetSegments: this.#targetSegments(),
    })
  }

  /** Place a single tile onto the current page (with its target). A top-level
   *  item places + consumes via its label; a DRILLED child isn't a clipboard
   *  entry, so it places by its full source path and consumes nothing. */
  #placeOne(item: ClipboardItem): void {
    const targetSegments = this.#targetSegments()
    if (this.#drilled) {
      EffectBus.emit('clipboard:place-entries', {
        entries: [{ label: item.label, sourceSegments: [...item.sourceSegments] }],
        targetSegments,
      })
    } else {
      EffectBus.emit('clipboard:place-items', { labels: [item.label], targetSegments })
    }
  }

  /** Drop a single tile from the clipboard WITHOUT placing it. At the top
   *  level this removes the clipboard entry (worker re-persists, stays gone
   *  after a reload). While DRILLED, the row is a child of a clipboard tile,
   *  not an entry — so record its absolute source path as an exclusion: it
   *  leaves the view now, never returns on re-drill, and is pruned when its
   *  parent pastes. */
  #discardOne(item: ClipboardItem): void {
    if (this.#drilled) { this.#excludeNested(item); return }
    EffectBus.emit('clipboard:discard-items', { labels: [item.label] })
  }

  /** Add a drilled child's source path to the exclusion set, persist it
   *  (shared with the worker), and remove it from the current drill view
   *  immediately. Adding to a SET, so the same discard arriving twice leaves
   *  one entry and one removal — nothing here accumulates. */
  #excludeNested(item: ClipboardItem): void {
    const path = [...item.sourceSegments, item.label].join('/')
    const next = new Set(this.#exclusions)
    next.add(path)
    this.#exclusions = next
    persistExclusions(next)
    const remaining = this.#drillChildren
      .filter(c => [...c.sourceSegments, c.label].join('/') !== path)
    this.#drillChildren = remaining
    this.#syncDisplay(remaining)
    this.#render()
  }

  // ── child counts ─────────────────────────────────────────────────────
  // Best-effort, OFF the render path: ask the worker (which resolves via the
  // warm parent-children slot, not the cold own-bag) how many children each
  // item has, in small batches so a many-item clipboard can't burst layer
  // reads. A miss stays absent — no badge, never a hang.
  async #syncCounts(items: readonly ClipboardItem[]): Promise<void> {
    const token = ++this.#countToken
    // Everything already known is on screen at once — only the rows this
    // display has never resolved cost a read.
    const out: Record<string, number> = {}
    const pending: { item: ClipboardItem; key: string }[] = []
    for (const item of items) {
      const key = rowKey(item)
      const cached = this.#countCache.get(key)
      if (cached === undefined) pending.push({ item, key })
      else if (cached > 0) out[key] = cached
    }
    this.#publishCounts({ ...out })
    if (pending.length === 0) return

    const worker = get<WorkerLike>(CLIPBOARD_WORKER_KEY)
    if (!worker?.childCountAt) return

    for (let i = 0; i < pending.length; i += COUNT_BATCH) {
      if (token !== this.#countToken) return
      const batch = pending.slice(i, i + COUNT_BATCH)
      await Promise.all(batch.map(async ({ item, key }) => {
        try {
          const n = await worker.childCountAt!([...item.sourceSegments, item.label])
          this.#countCache.set(key, n)
          if (n > 0) out[key] = n
        } catch { /* best-effort — stays unresolved, retried next display */ }
      }))
      // Publish progressively so badges appear as they resolve.
      if (token === this.#countToken) this.#publishCounts({ ...out })
    }
  }

  #publishCounts(next: Record<string, number>): void {
    if (sameRecord(this.#counts, next)) return
    this.#counts = next
    this.#render()
  }

  // ── thumbnails ───────────────────────────────────────────────────────
  // Resolve each item's ACTUAL tile image the same way the renderer does:
  // props-index (or canonical properties) -> small.image sig ->
  // Store.getResource -> object-URL. Read-only; never writes. No image -> no
  // entry -> the row shows the ⬢ glyph.

  async #syncThumbs(items: readonly ClipboardItem[]): Promise<void> {
    const token = ++this.#thumbToken
    const wanted = new Set(items.map(rowKey))
    // Revoke + drop any row that's no longer on screen. Bitmaps, unlike the
    // counts, are not free to hold — this is where the memory stays bounded.
    for (const key of [...this.#urls.keys()]) {
      if (!wanted.has(key)) this.#revoke(key)
    }
    // Resolve rows we don't already have a URL for, in parallel.
    const pending = items.filter(i => !this.#urls.has(rowKey(i)))
    if (pending.length === 0) { this.#publishThumbs(); return }
    await Promise.all(pending.map(async (item) => {
      // 'small' — the panel's rows are hex chrome, so the hex capture is the
      // right face here (the chat header's squares ask for 'large').
      const url = await resolveEntryImageUrl(item.label, item.sourceSegments, 'small').catch(() => null)
      // A newer clipboard state superseded this resolve — discard.
      if (token !== this.#thumbToken) { if (url) URL.revokeObjectURL(url); return }
      if (url) this.#urls.set(rowKey(item), url)
    }))
    if (token === this.#thumbToken) this.#publishThumbs()
  }

  #publishThumbs(): void {
    const map: Record<string, string> = {}
    for (const [k, v] of this.#urls) map[k] = v
    if (sameRecord(this.#thumbs, map)) return
    this.#thumbs = map
    this.#render()
  }

  #revoke(key: string): void {
    const url = this.#urls.get(key)
    if (url) URL.revokeObjectURL(url)
    this.#urls.delete(key)
  }

  #revokeAll(): void {
    for (const url of this.#urls.values()) URL.revokeObjectURL(url)
    this.#urls.clear()
    this.#thumbs = {}
  }

  // ── chrome (built once per activation) ───────────────────────────────
  protected override renderPanel(): void {
    const header = document.createElement('header')
    header.className = 'clipboard-header'

    // All three of the header's swappable nodes are built once and ATTACHED
    // or REMOVED by #syncHeader — `@if` semantics (a detached node answers no
    // querySelector), without rebuilding the band the gear is planted in.
    const title = document.createElement('span')
    title.className = 'clipboard-title'
    title.textContent = t('clipboard.title', 'Clipboard')

    const back = document.createElement('button')
    back.type = 'button'
    back.className = 'clipboard-back'
    back.textContent = '‹'
    back.addEventListener('click', () => this.#drillBack())

    const crumb = document.createElement('span')
    crumb.className = 'clipboard-crumb'

    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'clipboard-close'
    close.textContent = '×'
    close.addEventListener('click', () => this.close())
    header.appendChild(close)

    // `display: contents` — the selection strip, the empty line, the scroller,
    // the footer and the hint stay flex items of the PANEL (the scroller's
    // `flex: 1` is what makes it the scrolling half), while one node still
    // holds everything the body rebuild replaces. Without it, a rebuild that
    // reached for the panel's own children would take the base's resize grip
    // and settings gear with it.
    const body = document.createElement('div')
    body.className = 'clipboard-body'

    this.append(header, body)
    this.#header = header
    this.#titleEl = title
    this.#backEl = back
    this.#crumbEl = crumb
    this.#closeEl = close
    this.#body = body

    this.#relabel()
    this.#syncHeader()
    this.#render()
  }

  /** Attach exactly what the header's `@if (drilled())` attached: the back
   *  chevron + breadcrumb, or the title. The close button stays last. */
  #syncHeader(): void {
    const header = this.#header
    const title = this.#titleEl
    const back = this.#backEl
    const crumb = this.#crumbEl
    const close = this.#closeEl
    if (!header || !title || !back || !crumb || !close) return
    if (this.#drilled) {
      const text = this.#drillCrumb
      crumb.textContent = text
      crumb.title = text
      title.remove()
      if (back.parentNode !== header) header.insertBefore(back, close)
      if (crumb.parentNode !== header) header.insertBefore(crumb, close)
    } else {
      back.remove()
      crumb.remove()
      if (title.parentNode !== header) header.insertBefore(title, close)
    }
  }

  /** Re-resolve the strings written ONCE per activation — the ones a body
   *  rebuild never touches. The body's own strings come back through
   *  `#renderBody`. */
  #relabel(): void {
    this.setAttribute('aria-label', t('clipboard.title', 'Clipboard'))
    if (this.#titleEl) this.#titleEl.textContent = t('clipboard.title', 'Clipboard')
    const back = t('clipboard.back', 'Back')
    if (this.#backEl) {
      this.#backEl.setAttribute('aria-label', back)
      this.#backEl.title = back
    }
    this.#closeEl?.setAttribute('aria-label', t('clipboard.close', 'Close clipboard'))
    this.#labelGrip()
  }

  #labelGrip(): void {
    const grip = this.querySelector<HTMLElement>('[data-hc-grip]')
    if (!grip) return
    const label = t('clipboard.resize', 'Drag to resize')
    grip.setAttribute('aria-label', label)
    grip.title = label
  }

  // ── rendering (rebuild on change — the house pattern, no reconciler) ──

  #render(): void {
    if (!this.#body) return
    this.#renderBody()
  }

  #renderBody(): void {
    const body = this.#body
    if (!body) return

    // WHERE THE PARTICIPANT WAS. Angular kept ONE `.clipboard-scroll` node for
    // the panel's whole life and `@for … track row.key` only touched the rows
    // that changed, so a thumbnail landing, a count batch resolving or another
    // client's `clipboard:changed` arriving underneath you was invisible. This
    // render mints a fresh scroller, and a new node starts at scrollTop 0 with
    // nothing focused — the list would jump to the top mid-read, and a
    // keyboard user partway down it would be dropped out to <body> entirely.
    //
    // Rebuild-on-change is still the doctrine; what it owes is to put the
    // participant back where they were. Measured before the teardown, applied
    // after the new nodes are in the document (scrollTop on a detached node
    // does not stick), and the control is re-found BY POSITION because the
    // nodes themselves are gone by then.
    const scrollTop = body.querySelector('.clipboard-scroll')?.scrollTop ?? 0
    const focused = this.#focusMark(body)

    body.replaceChildren()

    const rows = this.#rows()
    const drilled = this.#drilled
    const parts: HTMLElement[] = []

    // Selection response: while tiles are selected on the canvas, offer
    // capturing them here — the window the result lands in. Hidden while
    // drilled (the drill view is about ONE captured subtree).
    //
    // POLARITY IS LOAD-BEARING: `selectionCount > 0 && !drilled`, exactly as
    // the template wrote it — never a negated `<= 0` guard, which is ALSO
    // false for a NaN and would fall straight through into painting
    // "NaN tiles selected".
    if (this.#selectionCount > 0 && !drilled) parts.push(this.#renderSelection())

    if (rows.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'clipboard-empty'
      empty.textContent = drilled
        ? t('clipboard.noChildren', 'No children here')
        : t('clipboard.empty', 'Clipboard is empty')
      parts.push(empty)
    } else {
      parts.push(this.#renderList(rows))
    }

    if (!drilled) {
      parts.push(this.#renderFoot())
      // The grammar, said once, where it is needed: the hive behind this
      // window is in swap mode for as long as it is open.
      const hint = document.createElement('p')
      hint.className = 'clipboard-hint'
      hint.textContent = t(
        'clipboard.hint',
        'Click to place · Ctrl+click to walk in. On the hive: click takes a tile, Ctrl+click copies it, hold to walk in.')
      parts.push(hint)
    }

    body.append(...parts)

    const scroller = body.querySelector('.clipboard-scroll')
    if (scroller && scrollTop > 0) scroller.scrollTop = scrollTop
    this.#restoreFocus(body, focused)
  }

  /** Where the focus was, as a position rather than a node: the row's index
   *  and the control's class, because every node in the body is about to be
   *  thrown away. */
  #focusMark(body: HTMLElement): { row: number; cls: string; key?: string } | null {
    const active = document.activeElement as HTMLElement | null
    if (!active || !body.contains(active)) return null
    // Prefer the control's own key; fall back to the class for everything that
    // does not need one (within a single row each class IS unique).
    const key = active.dataset['focusKey']
    const cls = active.classList[0]
    if (!cls && !key) return null
    const item = active.closest('.clipboard-item')
    if (item) {
      const row = Array.from(body.querySelectorAll('.clipboard-item')).indexOf(item)
      return row >= 0 ? { row, cls, key } : null
    }
    return { row: -1, cls, key }
  }

  #restoreFocus(
    body: HTMLElement, mark: { row: number; cls: string; key?: string } | null,
  ): void {
    if (!mark) return
    // If the list got shorter, or the strip the button lived in is gone, there
    // is simply nothing to focus — leave it alone rather than moving focus
    // somewhere the participant did not put it.
    // `globalThis.CSS` on purpose: this module's stylesheet string is named
    // `CSS`, which SHADOWS the global object — a bare `CSS.escape(...)` here
    // resolves to the string and does not compile.
    const selector = mark.key
      ? `[data-focus-key="${globalThis.CSS.escape(mark.key)}"]`
      : `.${globalThis.CSS.escape(mark.cls)}`
    if (mark.row >= 0) {
      const item = body.querySelectorAll('.clipboard-item')[mark.row]
      item?.querySelector<HTMLElement>(selector)?.focus()
      return
    }
    body.querySelector<HTMLElement>(selector)?.focus()
  }

  #renderSelection(): HTMLElement {
    const count = this.#selectionCount
    const label = tCount('clipboard.selection', '1 tile selected', '{count} tiles selected', count)

    const strip = document.createElement('div')
    strip.className = 'clipboard-selection'
    strip.setAttribute('role', 'group')
    strip.setAttribute('aria-label', label)

    const text = document.createElement('span')
    text.className = 'clipboard-selection-count'
    text.textContent = label
    strip.appendChild(text)

    strip.appendChild(this.#selectionButton('cut', 'content_cut', t('selection.cut', 'cut'), () => this.#cutSelection()))
    strip.appendChild(this.#selectionButton('copy', 'content_copy', t('selection.copy', 'copy'), () => this.#copySelection()))
    return strip
  }

  #selectionButton(
    key: string, glyph: string, label: string, run: () => void,
  ): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'clipboard-selection-btn'
    // A STABLE IDENTITY, because the class is not one. Both strip buttons carry
    // `clipboard-selection-btn`, so restoring focus by class alone put it on
    // whichever came first — Cut. Pressing Copy therefore left the ring on a
    // DESTRUCTIVE control, and the next Enter cut the selection. The class is
    // untouched so every style rule still matches; this is only for the mark.
    button.dataset['focusKey'] = key
    button.setAttribute('aria-label', label)
    button.title = label
    button.addEventListener('click', run)
    const sym = document.createElement('span')
    sym.className = 'mat-sym'
    sym.setAttribute('aria-hidden', 'true')
    sym.textContent = glyph
    button.appendChild(sym)
    return button
  }

  #renderList(rows: readonly ClipboardRow[]): HTMLElement {
    const scroll = document.createElement('div')
    scroll.className = 'clipboard-scroll'
    const list = document.createElement('ul')
    list.className = 'clipboard-items'

    for (const row of rows) {
      const li = document.createElement('li')
      li.className = 'clipboard-item'

      // THE SWAP: the row IS the tile. Click and it leaves the window for the
      // page behind; ctrl+click walks into it instead, so its children can be
      // placed one by one.
      const swap = document.createElement('button')
      swap.type = 'button'
      swap.className = 'item-swap'
      swap.setAttribute('aria-label', t('clipboard.swap', 'Place on this page'))
      swap.title = row.count > 0
        ? t('clipboard.swapOrWalk', 'Place on this page · Ctrl+click to walk in')
        : t('clipboard.swap', 'Place on this page')
      swap.addEventListener('click', (event) => this.#rowClick(row.item, event))

      if (row.thumb) {
        const thumb = document.createElement('span')
        thumb.className = 'item-thumb'
        const img = document.createElement('img')
        img.src = row.thumb
        img.alt = row.label
        img.draggable = false
        thumb.appendChild(img)
        swap.appendChild(thumb)
      } else {
        const glyph = document.createElement('span')
        glyph.className = 'item-glyph'
        glyph.setAttribute('aria-hidden', 'true')
        glyph.textContent = '⬢'
        swap.appendChild(glyph)
      }

      const name = document.createElement('span')
      name.className = 'item-label'
      name.textContent = row.label
      swap.appendChild(name)
      li.appendChild(swap)

      // The count badge doubles as the walk-in handle — the whole affordance a
      // finger has, since ctrl is a keyboard word.
      if (row.count > 0) {
        const badge = document.createElement('button')
        badge.type = 'button'
        badge.className = 'item-count'
        badge.textContent = String(row.count)
        badge.setAttribute('aria-label',
          tCount('clipboard.children', '{count} child', '{count} children', row.count))
        badge.title = t('clipboard.walkIn', 'Walk into this tile')
        badge.addEventListener('click', () => { void this.#drillInto(row.item) })
        li.appendChild(badge)
      }

      const discardLabel = t('clipboard.discard', 'Discard')
      const discard = document.createElement('button')
      discard.type = 'button'
      discard.className = 'item-discard'
      discard.textContent = '×'
      discard.setAttribute('aria-label', discardLabel)
      discard.title = discardLabel
      discard.addEventListener('click', () => this.#discardOne(row.item))
      li.appendChild(discard)

      list.appendChild(li)
    }

    scroll.appendChild(list)
    return scroll
  }

  /** The footer band is drawn whenever we are NOT drilled — its hairline is
   *  part of the empty window's chrome — and carries its two buttons only
   *  while something is held (`items.length > 0`, the template's own test,
   *  never a negation of it). */
  #renderFoot(): HTMLElement {
    const foot = document.createElement('footer')
    foot.className = 'clipboard-foot'
    if (this.#items.length === 0) return foot

    const place = document.createElement('button')
    place.type = 'button'
    place.className = 'place-all'
    place.textContent = `${t('clipboard.placeAll', 'Place all here')} · ${this.#items.length}`
    place.addEventListener('click', () => this.#placeAll())

    const clear = document.createElement('button')
    clear.type = 'button'
    clear.className = 'clear-all'
    clear.textContent = t('clipboard.clear', 'Clear')
    clear.addEventListener('click', () => this.#clearAll())

    foot.append(place, clear)
    return foot
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
  customElements.define(SURFACE_NAME, ClipboardPanelElement)
}

window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/ClipboardPanelElement',
    element: SURFACE_NAME,
    order: 150,
  })
})
