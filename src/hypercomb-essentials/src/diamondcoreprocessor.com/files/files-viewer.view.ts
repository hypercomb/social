// files-viewer.view.ts — THE FILES WINDOW, as a framework-free custom element
// (everything-is-a-beehavior Phase 2: Angular panels leave the shell and ship
// as signed modules).
//
// A straight port of shared/ui/files-viewer: same surface name
// (hc-files-viewer), same order band (110), same panel id ('files-viewer' —
// so the participant's saved width, text size, code font and group membership
// come across), same effects in and out. It lands beside `file-drop.drone.ts`,
// which owns `files:open` — the gather this window is the readout for — and
// beside `files.queen.ts`, the `/files` door.
//
// ── WHAT IT IS FOR ─────────────────────────────────────────────────────────
//
// Files attach to tiles by being DROPPED on them: a one-second gesture with a
// permanent consequence. So there has to be somewhere that lists what is
// attached, hands the bytes back, and takes an attachment off again. Three
// widths of question are the same window: this tile's files (the tile's file
// icon), a selection's files (`/files` or the selection response), and the
// whole page's (`/files all`) — with the header's reach toggle stepping the
// gather from this page → this page and everything under it → the whole hive.
//
// The list is NOT derived here. `file-drop.drone` walks the layer tree and
// answers with `files:open`; this window renders that payload and asks for a
// new one (`files:reach`) when the reach changes. A wider reach is a new
// GATHER, never a filter over the rows already on screen — the files it wants
// are not in that list. Only the TYPE taxonomy is local (file-icons.ts,
// derived from name/mime), because it needs no walk.
//
// ── WHAT THIS WINDOW DOES NOT DO ───────────────────────────────────────────
//
// It never closes a sibling panel when it opens. Sharing an edge is the LANE's
// business (core/panels/dock-lanes) and the lane PARKS what it displaces —
// closing a sibling by name would run that sibling's own `close()`, the
// participant's verb, which empties the Features panel's group, selection,
// brush and paint note. The shell displacing a window must cost nothing. The
// note is carried verbatim from the Angular original, and the features-viewer
// points at it; it is the reason this file has no "close the other one" line.
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
// full-bleed wrapper is gone and the `.files-panel` rules land on the tag —
// the sequence-viewer / context-window precedent. The inset reporting the old
// `hcDockInset` directive did is folded into the same base.
//
// PARK IS NOT CLOSE. The session's park/unpark flip visibility and announce
// WITHOUT the clearing `close()` does: the installer covering the hive must
// bring the same gather back, and a window that returned empty would read as
// "my files vanished". That is safe here only because the list lives in
// `#files`, never in the DOM — deactivate() throws the DOM away and the next
// activate() rebuilds it from the fields.
//
// Its strings ship WITH it (files-viewer.i18n.ts, extracted from all 14 shell
// catalogs) and register under the 'app' namespace, so every key resolves
// exactly as before — the Phase 2 catalog split, another slice.

import {
  EffectBus, I18N_IOC_KEY, type I18nProvider,
  focusSnapshot, restoreFocus,
} from '@hypercomb/core'
import { DockedPanelElement } from '../panels/docked-panel.element.js'
import { FILES_VIEWER_TRANSLATIONS } from './files-viewer.i18n.js'
// The teaser's dead shell contract retired, so this table is local again:
// one consumer means one owner beside the view that renders it.
import {
  categorize, typeMeta, TYPE_META, TYPE_ORDER,
  type FileTypeKey, type FileTypeMeta,
} from './file-icons.js'

const SURFACE_NAME = 'hc-files-viewer'

/** One attached file, as `file-drop.drone` puts it on the `files:open`
 *  payload. Two signatures, two different jobs: `sig` is the BYTES (download),
 *  `decorationSig` is the attachment RECORD (detach). */
type FileItem = {
  name: string
  mime: string
  size: number
  sig: string           // bytes resource — for download
  decorationSig: string // decoration record — for remove
  cell?: string         // source tile (aggregate mode only)
  path?: string[]       // absolute segments — set once the gather reaches past this page
}

type Scope = 'tile' | 'selection' | 'all'

/** How wide the gather reaches. Same three, same words, as the pheromone
 *  filter and the feedback panel. The drone owns the walk; this is the
 *  control surface for it. */
type Reach = 'local' | 'children' | 'global'

type StoreLike = { getResource(sig: string): Promise<Blob | null> }

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

/** The selection band's label is the panel's one INFLECTED string, and it is
 *  spelled unusually in the catalogs: `files.selection.one` exists, but the
 *  plural has no `.other` — the BARE `files.selection` carries it. The i18n
 *  service falls through to the bare key exactly that way; the fallback has to
 *  make the same choice itself, or a host with no catalog would read
 *  "documents of 1 selected tiles". */
const selectionLabel = (count: number): string =>
  t('files.selection',
    count === 1 ? 'documents of the selected tile' : 'documents of {count} selected tiles',
    { count })

/** The three reaches in cycle order — the toggle's walk, and each stage's
 *  glyph. Same ids and glyphs as everywhere else. */
const SCOPE_OPTIONS: readonly { id: Reach; icon: string }[] = [
  { id: 'local', icon: 'blur_on' },
  { id: 'children', icon: 'account_tree' },
  { id: 'global', icon: 'public' },
]

/** English fallbacks for the RUNTIME-BUILT key `'tags.scope-' + reach` — the
 *  toggle's tooltip. Three keys, one call site: a regex harvest cannot see any
 *  of them, so they are spelled out here and named in the drift spec. */
const REACH_HINT: Record<Reach, string> = {
  local: 'Filtering this page only — click to widen to children, then the whole hive',
  children: 'Filtering this page and its children — click to widen to the whole hive',
  global: 'Filtering the whole hive — click to narrow back to this page',
}

/** English fallbacks for the OTHER runtime-built key — a type's `labelKey`,
 *  read out of TYPE_META, so eleven `files.type.*` keys reach `t()` from the
 *  call sites (the filter chip's tooltip, the row icon's aria-label) with no
 *  literal anywhere for a harvest to find. The wording is en.json's, not
 *  `meta.short`: "Documents", not "DOC". */
const TYPE_LABEL: Record<FileTypeKey, string> = {
  pdf: 'PDF',
  doc: 'Documents',
  sheet: 'Spreadsheets',
  slides: 'Slides',
  image: 'Images',
  vector: 'Vectors',
  audio: 'Audio',
  video: 'Video',
  code: 'Code & data',
  archive: 'Archives',
  other: 'Other',
}

// The panel's strings travel with it — registered as soon as the i18n service
// is up, under 'app' so the keys resolve exactly as they always did.
window.ioc?.whenReady?.(I18N_IOC_KEY, (i18n) => {
  const provider = i18n as I18nProvider
  for (const [locale, catalog] of Object.entries(FILES_VIEWER_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

// ── the styles the Angular SCSS carried, expanded to plain CSS ────────────
//
// No shadow DOM (the tutorial-overlay + sequence-viewer precedent), so
// Angular's `:host` becomes the tag name and every other selector is prefixed
// with it. `$accent: #a8c8ff` — the blue of the file overlay icon
// (hoverTint 0xa8c8ff), so the icon you press and the window it opens read as
// one thing — is inlined at every `rgba($accent, …)` call site as
// rgba(168,200,255, …); `tw.$radius-control` (2px) and `tw.$radius-card` (3px)
// are inlined as the literals the SCSS compiled to, and the `var(--c)` chip
// tint is left alone.
//
// TWO EXPANSIONS WORTH NAMING:
//
//  • `@include tw.panel($accent, right)` was the LAST line of `.files-panel`,
//    so its declarations won the cascade over the ones written above it. The
//    effective values are written here once — background rgba(13,15,21,.975)
//    (not .96), border-left alpha .38 (not .5), the 14px/44px shadow (not the
//    10px/40px pair with the inset accent ring) and colour #eef2f5 (not
//    #f3f3f3) — rather than emitting both and leaving five dead declarations
//    in a document-level sheet.
//
//  • `.files-close`'s own rules sit LATER in the sheet than the `tw.header`
//    close-button rules, but `…files-header>button[class*='close']` outranks
//    `…files-close` on specificity, so width / padding / font-size / colour
//    (and the hover colour — #fff, NOT the accent) come from the header band,
//    and only background / border / cursor / line-height come from
//    `.files-close`. That ordering is reproduced verbatim below so the close
//    button lands in the same place it always did. Note the header band's
//    `> button` rules reach the close button and the base's settings gear —
//    NOT `.files-scope-btn`, which is a grandchild through `.files-scope`.
//
// Angular's build autoprefixed; `-webkit-backdrop-filter` is written by hand.
const CSS = `
${SURFACE_NAME}{position:fixed;top:max(calc(2.3rem * var(--hc-header-zoom,1)),var(--hc-header-anchor));right:var(--hc-controls-right,0);bottom:0;z-index:100002;display:none;flex-direction:column;width:340px;min-width:280px;max-width:calc(100vw - 1.5rem);
  --hc-window-accent:#a8c8ff;--hc-window-radius-control:2px;--hc-window-radius-card:3px;--hc-window-radius-floating:4px;
  background:rgba(13,15,21,.975);backdrop-filter:blur(14px) saturate(1.04);-webkit-backdrop-filter:blur(14px) saturate(1.04);border-radius:0;
  border-right:0;border-left:1px solid rgba(168,200,255,.38);box-shadow:-14px 0 44px rgba(0,0,0,.46),inset 1px 0 rgba(255,255,255,.025);
  font-family:var(--hc-mono,system-ui);font-size:calc(1rem * var(--hc-panel-scale,1));color:#eef2f5;outline:none}
${SURFACE_NAME}.open{display:flex}
${SURFACE_NAME} .files-body{display:contents}
${SURFACE_NAME} .files-header{flex:0 0 auto;box-sizing:border-box;display:flex;align-items:center;gap:.5rem;height:2.875rem;min-height:2.875rem;padding:0 .75rem;line-height:1;background:linear-gradient(180deg,rgba(255,255,255,.018),rgba(255,255,255,.006));justify-content:space-between;border-bottom:1px solid rgba(168,200,255,.25)}
${SURFACE_NAME} .files-header>button{box-sizing:border-box;display:inline-grid;place-items:center;min-width:1.75rem;height:1.75rem;padding:0 .25rem;border-radius:2px;line-height:1;transition:color 120ms ease,background-color 120ms ease,border-color 120ms ease}
${SURFACE_NAME} .files-header>button:hover{background-color:rgba(255,255,255,.055)}
${SURFACE_NAME} .files-header>button:focus-visible{outline:1px solid color-mix(in srgb,var(--hc-window-accent) 72%,white);outline-offset:1px}
${SURFACE_NAME} .files-header>button[class*='close']{width:1.75rem;min-width:1.75rem;padding:0;font-size:1.125rem;color:rgba(238,244,248,.62)}
${SURFACE_NAME} .files-header>button[class*='close']:hover{color:#fff;background-color:rgba(255,255,255,.075)}
${SURFACE_NAME} .files-heading{display:flex;align-items:center;gap:.5em;min-width:0}
${SURFACE_NAME} .files-title{font-size:.9em;letter-spacing:.05em;color:rgba(168,200,255,.95);flex-shrink:0}
${SURFACE_NAME} .files-cell{font-size:.8em;color:rgba(255,255,255,.55);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${SURFACE_NAME} .files-scope{flex-shrink:0;display:flex;gap:.2rem;margin-left:auto;padding:.15rem;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:2px}
${SURFACE_NAME} .files-scope-btn{display:inline-flex;align-items:center;justify-content:center;padding:.24rem .4rem;background:transparent;border:1px solid transparent;border-radius:2px;color:rgba(226,235,244,.55);cursor:pointer;transition:color 150ms ease,background 150ms ease,border-color 150ms ease}
${SURFACE_NAME} .files-scope-btn .mat-sym{font-size:1rem;line-height:1}
${SURFACE_NAME} .files-scope-btn:hover{color:rgba(238,243,248,.9)}
${SURFACE_NAME} .files-scope-btn.active{color:#fff;background:rgba(168,200,255,.16);border-color:rgba(168,200,255,.45)}
${SURFACE_NAME} .files-close{background:transparent;border:none;color:rgba(255,255,255,.7);font-size:1.4em;line-height:1;cursor:pointer;padding:0 .25em}
${SURFACE_NAME} .files-close:hover{color:#a8c8ff}
${SURFACE_NAME} .files-empty{margin:0;padding:1.5em 1em;font-size:.85em;color:rgba(255,255,255,.45)}
${SURFACE_NAME} .files-selection{display:flex;align-items:center;gap:.45em;width:100%;padding:.45em .85em;border:0;border-bottom:1px solid rgba(168,200,255,.18);background:rgba(168,200,255,.07);color:rgba(222,234,255,.85);cursor:pointer;font:inherit;font-size:.8em;text-align:left;transition:background 140ms ease,color 140ms ease}
${SURFACE_NAME} .files-selection .mat-sym{font-size:1.1em;color:#a8c8ff}
${SURFACE_NAME} .files-selection:hover{background:rgba(168,200,255,.14);color:#f2f7ff}
${SURFACE_NAME} .files-selection:focus-visible{outline:1px solid rgba(168,200,255,.7);outline-offset:-1px}
${SURFACE_NAME} .files-selection-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${SURFACE_NAME} .files-filters{display:flex;flex-wrap:wrap;gap:.3em;padding:.55em .85em;border-bottom:1px solid rgba(255,255,255,.06)}
${SURFACE_NAME} .ftype-chip{position:relative;display:inline-flex;align-items:center;justify-content:center;padding:.25em .4em;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:3px;color:rgba(255,255,255,.8);font-family:inherit;font-size:.72em;cursor:pointer;transition:background 150ms ease,border-color 150ms ease,color 150ms ease}
${SURFACE_NAME} .ftype-chip:hover{background:rgba(255,255,255,.08)}
${SURFACE_NAME} .ftype-chip.active{border-color:color-mix(in srgb,var(--c,#a8c8ff) 70%,transparent);background:color-mix(in srgb,var(--c,#a8c8ff) 16%,transparent);color:#fff}
${SURFACE_NAME} .ftype-count{position:absolute;top:-5px;right:-5px;min-width:14px;height:14px;padding:0 3px;display:inline-flex;align-items:center;justify-content:center;border-radius:3px;background:#a8c8ff;color:#0e0e16;font-size:.58em;font-weight:700;line-height:1;font-variant-numeric:tabular-nums;opacity:0;transform:scale(.7);transition:opacity 120ms ease,transform 120ms ease;pointer-events:none}
${SURFACE_NAME} .ftype-chip:hover .ftype-count,${SURFACE_NAME} .ftype-chip:focus-visible .ftype-count{opacity:1;transform:scale(1)}
${SURFACE_NAME} .ftype-icon{display:inline-flex;align-items:center;justify-content:center;font-size:1.15em;line-height:1}
${SURFACE_NAME} .ftype-icon.row{flex:0 0 auto;width:1.7em;font-size:1.4em}
${SURFACE_NAME} .files-sub{display:flex;align-items:center;gap:.3em;font-size:.7em;color:rgba(255,255,255,.4)}
${SURFACE_NAME} .files-source{color:rgba(168,200,255,.7);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:9em}
${SURFACE_NAME} .files-dot{opacity:.5}
${SURFACE_NAME} .files-list{list-style:none;margin:0;padding:.5em 0;overflow-y:auto;flex:1;min-height:0;overscroll-behavior:contain}
${SURFACE_NAME} .files-row{display:flex;align-items:center;gap:.5em;padding:.55em 1em;border-bottom:1px solid rgba(255,255,255,.05)}
${SURFACE_NAME} .files-row:hover{background:rgba(168,200,255,.06)}
${SURFACE_NAME} .files-meta{flex:1;min-width:0;display:flex;flex-direction:column;gap:.15em}
${SURFACE_NAME} .files-name{font-size:.85em;color:#f3f3f3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${SURFACE_NAME} .files-size{font-size:.7em;color:rgba(255,255,255,.4)}
${SURFACE_NAME} .files-actions{display:flex;align-items:center;gap:.35em}
${SURFACE_NAME} .files-action{font-family:inherit;cursor:pointer;transition:background 150ms ease,color 150ms ease,border-color 150ms ease}
${SURFACE_NAME} .files-action.download{padding:.3em .7em;background:rgba(168,200,255,.12);border:1px solid rgba(168,200,255,.5);border-radius:4px;color:#a8c8ff;font-size:.78em}
${SURFACE_NAME} .files-action.download:hover{background:rgba(168,200,255,.25);color:#fff;border-color:#a8c8ff}
${SURFACE_NAME} .files-action.remove{background:transparent;border:none;color:rgba(255,255,255,.4);font-size:1.1em;line-height:1;padding:0 .2em}
${SURFACE_NAME} .files-action.remove:hover{color:#ffc8c8}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-files-viewer', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

const sizeLabel = (bytes: number): string => {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** The Angular `@for … track` expression, kept as the row's stable key: a
 *  file is identified by its attachment RECORD, and in aggregate mode the same
 *  record can be reached through two source tiles. */
const rowKey = (file: FileItem): string => `${file.cell ?? ''}/${file.decorationSig}`

export class FilesViewerElement extends DockedPanelElement {

  #offs: Array<() => void> = []

  /** THE visibility flag. `close()`, the `files:open` handler and the
   *  session's park/unpark all read and write THIS field — a second notion of
   *  "open" is how the two drift apart after the first press. */
  #visible = false

  // ── what the gather answered with (state lives here, never in the DOM) ──
  #title = ''
  #scope: Scope = 'tile'
  #reach: Reach = 'local'
  #files: FileItem[] = []
  #segments: string[] = []

  /** Active type filters — empty means "all". */
  #activeTypes: ReadonlySet<FileTypeKey> = new Set()

  /** Selection response (documentation/selection-tool-windows.md): while the
   *  selected tiles carry documents, offer re-scoping this window to THEM.
   *  `selection:has-documents` is the behavior-side selectivity — computed and
   *  replayed by file-drop.drone, so the window never re-derives it. */
  #selectionCount = 0
  #selectionHasDocuments = false

  // Chrome built once per activation. The header must survive a body rebuild
  // because DockedPanelElement plants the settings gear inside it (and nudges
  // the close button over to make room) AFTER renderPanel() returns —
  // rebuilding the header would throw the gear away. The close button is the
  // header's LAST child for the same reason: that is the node the base moves.
  #body: HTMLElement | null = null
  #titleEl: HTMLElement | null = null
  #cellEl: HTMLElement | null = null
  #scopeBtn: HTMLButtonElement | null = null
  #scopeGlyph: HTMLElement | null = null
  #closeEl: HTMLElement | null = null

  constructor() {
    super()
    // Same panel id the Angular `hcDockedPanel="files-viewer"` carried, so the
    // saved width (`hc:docked-width:files-viewer`), text size, code font and
    // group membership all come across with the participant.
    this.panelId = 'files-viewer'
    this.dockSide = 'right'
    this.minWidth = 280
    this.maxWidth = 640
    this.defaultWidth = 340
    // Registry-fed: mounted once at boot, engaged only when a gather opens it.
    this.autoActivate = false
    // The Angular original built this with `signalSession(visible, announce,
    // { close })`. Reproduced literally: park/unpark flip visibility and
    // announce, WITHOUT the clearing that `close()` does. `close` is what the
    // Escape cascade calls through the base's holdToolWindow/holdWindow — this
    // panel never bound a keydown listener of its own, in either
    // implementation (Escape reaches it as `files:viewer-close`, priority 2b
    // of the cascade, off the `files:viewer` state it announces here).
    this.session = {
      park: () => { this.#hide(); EffectBus.emit('files:viewer', { active: false }) },
      unpark: () => { this.#show(); EffectBus.emit('files:viewer', { active: true }) },
      close: () => this.close(),
    }
  }

  // ── derived readings (the component's computed()s) ───────────────────

  /** The glyph for the reach currently in force — the toggle's readout. */
  get #scopeIcon(): string {
    return (SCOPE_OPTIONS.find(o => o.id === this.#reach) ?? SCOPE_OPTIONS[0]).icon
  }

  /** Types present in the current list (ordered), with counts. */
  #types(): { key: FileTypeKey; count: number }[] {
    const counts = new Map<FileTypeKey, number>()
    for (const f of this.#files) {
      const k = categorize(f.name, f.mime)
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    return TYPE_ORDER
      .filter(k => counts.has(k))
      .map(k => ({ key: k, count: counts.get(k)! }))
  }

  /** Files after applying the active type filters. */
  #filtered(): FileItem[] {
    const active = this.#activeTypes
    if (active.size === 0) return this.#files
    return this.#files.filter(f => active.has(categorize(f.name, f.mime)))
  }

  /** Show the source-tile column when more than one tile is in view. */
  get #showSource(): boolean { return this.#scope !== 'tile' }

  /** POLARITY IS LOAD-BEARING — the template's condition, copied, never
   *  re-derived by negation. */
  get #showSelectionAffordance(): boolean {
    return this.#selectionCount > 0 && this.#selectionHasDocuments && this.#scope !== 'selection'
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
      // `selection:changed` has TWO publishers with different payload shapes
      // (SelectionService's pair, the pixi drone's superset). The shell's
      // `onSelection` helper normalized both down to the pair; that
      // normalization is inlined here rather than imported — a module may not
      // reach into shared. Setting a count absorbs a repeated delivery for
      // free (rule 8: nothing here accumulates).
      EffectBus.on<{ selected?: unknown }>('selection:changed', (p) => {
        const selected = Array.isArray(p?.selected) ? (p.selected as unknown[]) : []
        if (selected.length === this.#selectionCount) return
        this.#selectionCount = selected.length
        if (this.#visible) this.#render()
      }),

      EffectBus.on<{ value?: boolean }>('selection:has-documents', (p) => {
        const has = p?.value === true
        if (has === this.#selectionHasDocuments) return
        this.#selectionHasDocuments = has
        if (this.#visible) this.#render()
      }),

      // THE GATHER LANDED. `file-drop.drone` answers every way in — the tile's
      // file icon, `/files`, the selection response, and the reach toggle —
      // with this one effect, so this is the only place the list is set.
      EffectBus.on<{
        cellLabel?: string; segments?: string[]; files?: FileItem[]
        scope?: Scope; reach?: Reach
      }>('files:open', (p) => {
        if (!p) return
        // No sibling is closed here. Sharing an edge is the LANE's business
        // (core/panels/dock-lanes), and the lane PARKS what it displaces.
        // Closing a sibling by name ran its `close()` — the participant's own
        // verb — which empties the Features panel's group, selection, brush and
        // paint note. The shell displacing a window must cost nothing.
        this.#title = p.cellLabel ?? ''
        this.#scope = p.scope ?? 'tile'
        // Mirror the reach the gather actually ran at, so opening from a tile
        // icon (always this page) resets the trio instead of leaving it lit.
        this.#reach = p.reach ?? 'local'
        this.#segments = p.segments ?? []
        this.#files = Array.isArray(p.files) ? p.files : []
        // Drop filters that no longer apply to the new list.
        const present = new Set(this.#files.map(f => categorize(f.name, f.mime)))
        this.#activeTypes = new Set([...this.#activeTypes].filter(k => present.has(k)))
        if (!this.#visible) {
          this.#show()
          EffectBus.emit('files:viewer', { active: true })
        }
        this.#render()
      }),

      EffectBus.on('files:viewer-close', () => {
        if (this.#visible) this.close()
      }),

      // THE PIPE WAS IMPURE. Angular's `t` pipe is declared `pure: false`, so
      // every change-detection tick re-resolved every string and `/language ja`
      // re-labelled an OPEN panel on the spot. An element renders when it
      // decides to, so the locale switch has to be a reason to render — else an
      // open window keeps its old-locale title, reach tooltip, filter chips,
      // empty state and BOTH row actions until it is closed and reopened.
      // Rebuilding is safe: the rows live in `#files`, never in the DOM.
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

  /** The participant's close. Clears the gather — unlike `park()`, which puts
   *  the SAME list away and brings it back. Exactly one
   *  `files:viewer {active:false}` leaves per call, which is what
   *  `escape-cascade` and `file-drop.drone` both read to stop tracking. */
  close(): void {
    this.#hide()
    this.#files = []
    this.#title = ''
    this.#scope = 'tile'
    this.#reach = 'local'
    this.#activeTypes = new Set()
    this.#segments = []
    EffectBus.emit('files:viewer', { active: false })
  }

  /** DockedPanelElement's close verb — the lane's eviction fallback lands here
   *  when a panel has no session. This one has a session, so the lane parks it
   *  instead; the route is kept because the base's contract requires it. */
  protected override closePanel(): void { this.close() }

  #show(): void {
    if (this.#visible) return
    this.#visible = true
    this.classList.add('open')
    this.setAttribute('aria-label', t('files.viewer.title', 'Files'))
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
    this.#scopeBtn = null
    this.#scopeGlyph = null
    this.#closeEl = null
  }

  // ── chrome (built once per activation) ───────────────────────────────
  protected override renderPanel(): void {
    const header = document.createElement('header')
    header.className = 'files-header'

    const heading = document.createElement('div')
    heading.className = 'files-heading'
    const title = document.createElement('span')
    title.className = 'files-title'
    title.textContent = t('files.viewer.title', 'Files')
    const cell = document.createElement('span')
    cell.className = 'files-cell'
    heading.append(title, cell)

    // Reach in the header, the same three-stage toggle as the pheromone and
    // feedback panels: one glyph, stepping this page → this page and
    // everything under it → the whole hive, wrapping.
    const scope = document.createElement('div')
    scope.className = 'files-scope'
    const scopeBtn = document.createElement('button')
    scopeBtn.type = 'button'
    scopeBtn.className = 'files-scope-btn active'
    scopeBtn.addEventListener('click', () => this.#cycleReach())
    const scopeGlyph = document.createElement('span')
    scopeGlyph.className = 'mat-sym'
    scopeBtn.appendChild(scopeGlyph)
    scope.appendChild(scopeBtn)

    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'files-close'
    close.textContent = '×'
    close.setAttribute('aria-label', t('files.close', 'close'))
    close.addEventListener('click', () => this.close())

    header.append(heading, scope, close)

    // `display: contents` — the selection band, the filter bar and the list
    // stay flex items of the PANEL (the list's `flex: 1` is what makes it the
    // scrolling half), while one node still holds everything a rebuild
    // replaces. Without it, a rebuild that reached for the panel's own
    // children would take the base's resize grip and settings gear with it.
    const body = document.createElement('div')
    body.className = 'files-body'

    this.append(header, body)
    this.#titleEl = title
    this.#cellEl = cell
    this.#scopeBtn = scopeBtn
    this.#scopeGlyph = scopeGlyph
    this.#closeEl = close
    this.#body = body
    this.#render()
  }

  /** Re-resolve the strings written ONCE per activation — the ones a body
   *  rebuild never touches. The reach tooltip and every body string come back
   *  through `#render`. */
  #relabel(): void {
    this.setAttribute('aria-label', t('files.viewer.title', 'Files'))
    if (this.#titleEl) this.#titleEl.textContent = t('files.viewer.title', 'Files')
    this.#closeEl?.setAttribute('aria-label', t('files.close', 'close'))
  }

  // ── the participant's verbs ──────────────────────────────────────────

  /** Step to the next reach and wrap — local → children → global → local. */
  #cycleReach(): void {
    const at = SCOPE_OPTIONS.findIndex(o => o.id === this.#reach)
    this.#setReach(SCOPE_OPTIONS[(at + 1) % SCOPE_OPTIONS.length].id)
  }

  /** Pick a reach. The drone re-walks the layer tree and answers with a fresh
   *  `files:open` — a wider reach is a new gather, not a filter over the list
   *  already on screen, because the files it wants aren't in that list. The
   *  answer sets `#reach` to the same value again, so a doubled delivery is a
   *  no-op rather than a second step round the cycle. */
  #setReach(id: Reach): void {
    if (this.#reach === id) return
    this.#reach = id
    this.#render()
    EffectBus.emit('files:reach', { reach: id })
  }

  /** Re-scope this window to the canvas selection — the same verb the retired
   *  vertical menu emitted; file-drop.drone answers with `files:open`. */
  #openSelectionDocuments(): void {
    EffectBus.emit('controls:action', { action: 'view-documents' })
  }

  #toggleType(key: FileTypeKey): void {
    const next = new Set(this.#activeTypes)
    if (next.has(key)) next.delete(key); else next.add(key)
    this.#activeTypes = next
    this.#render()
  }

  #clearTypes(): void {
    if (this.#activeTypes.size === 0) return
    this.#activeTypes = new Set()
    this.#render()
  }

  #badge(file: FileItem): FileTypeMeta {
    return typeMeta(file.name, file.mime)
  }

  // ── actions ──────────────────────────────────────────────────────────

  /** Fetch the bytes and trigger a browser download. */
  async #download(file: FileItem): Promise<void> {
    const store = get<StoreLike>('@hypercomb.social/Store')
    if (!store) return
    try {
      const blob = await store.getResource(file.sig)
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = file.name || 'file'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err) {
      console.warn('[files-viewer] download failed', err)
    }
  }

  /** Detach a file. A row gathered from beyond this page carries its own
   *  absolute `path` — appending its label to the common parent would name
   *  a tile that isn't there. Otherwise: tile mode is `#segments` itself,
   *  page-wide aggregate is the common parent plus the row's `cell`.
   *
   *  Nothing is removed from `#files` here: the drone writes the detach,
   *  `decorations:changed` reaches it, and it re-gathers and answers with a
   *  fresh `files:open`. The list on screen is always the walk's answer. */
  #remove(file: FileItem): void {
    const segments = file.path?.length
      ? file.path
      : (file.cell ? [...this.#segments, file.cell] : this.#segments)
    EffectBus.emit('files:remove', { decorationSig: file.decorationSig, segments })
  }

  // ── rendering (rebuild on change — the house pattern, no reconciler) ──

  #render(): void {
    if (!this.#body) return
    if (this.#cellEl) this.#cellEl.textContent = this.#title
    if (this.#scopeGlyph) this.#scopeGlyph.textContent = this.#scopeIcon
    if (this.#scopeBtn) {
      // RUNTIME-BUILT KEY: `'tags.scope-' + reach()`, three expansions
      // (tags.scope-local / -children / -global), invisible to a regex harvest
      // and therefore spelled out in REACH_HINT and named in the drift spec.
      const hint = t(`tags.scope-${this.#reach}`, REACH_HINT[this.#reach])
      this.#scopeBtn.title = hint
      this.#scopeBtn.setAttribute('aria-label', hint)
    }
    this.#renderBody()
  }

  #renderBody(): void {
    const body = this.#body
    if (!body) return

    // WHERE THE PARTICIPANT WAS. Angular kept ONE `<ul class="files-list">` for
    // the panel's whole life and `@for … track` only replaced the rows that
    // changed, so a live refresh (a detach landing, a `decorations:changed`
    // re-gather, a `/language` switch) under a scrolled list was invisible, and
    // the filter chip you just pressed kept focus. A rebuild mints fresh nodes:
    // the list would jump to the top mid-read and a keyboard user would be
    // dropped out to <body>. Rebuild-on-change is still the doctrine; what it
    // owes is to put the participant back — measured before the teardown,
    // applied after the new nodes are in the document (scrollTop on a detached
    // node does not stick). `data-hc-row` keys are what focus is restored BY,
    // which is why they are stable across a re-gather.
    const snap = focusSnapshot(body)
    const oldList = body.querySelector('.files-list')
    const scrollTop = oldList?.scrollTop ?? 0

    body.replaceChildren()

    const parts: HTMLElement[] = []
    if (this.#showSelectionAffordance) parts.push(this.#renderSelectionBand())

    const types = this.#types()
    if (types.length > 1) parts.push(this.#renderFilters(types))

    const filtered = this.#filtered()
    if (filtered.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'files-empty'
      empty.textContent = t('files.empty', 'No files attached.')
      parts.push(empty)
    } else {
      parts.push(this.#renderList(filtered))
    }

    body.append(...parts)

    const newList = body.querySelector('.files-list')
    if (newList && scrollTop > 0) newList.scrollTop = scrollTop
    restoreFocus(body, snap)
  }

  /** Selection response: the selected tiles carry documents — one press
   *  re-gathers this window around THEM (file-drop.drone answers). */
  #renderSelectionBand(): HTMLElement {
    const label = selectionLabel(this.#selectionCount)
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'files-selection'
    button.dataset['hcRow'] = 'selection'
    button.setAttribute('aria-label', label)
    button.addEventListener('click', () => this.#openSelectionDocuments())

    const glyph = document.createElement('span')
    glyph.className = 'mat-sym'
    glyph.setAttribute('aria-hidden', 'true')
    glyph.textContent = 'description'

    const text = document.createElement('span')
    text.className = 'files-selection-label'
    text.textContent = label

    button.append(glyph, text)
    return button
  }

  #renderFilters(types: { key: FileTypeKey; count: number }[]): HTMLElement {
    const bar = document.createElement('div')
    bar.className = 'files-filters'
    bar.setAttribute('role', 'toolbar')

    const all = document.createElement('button')
    all.type = 'button'
    all.className = 'ftype-chip'
    all.dataset['hcRow'] = 'type:all'
    if (this.#activeTypes.size === 0) all.classList.add('active')
    all.textContent = t('files.all', 'all')
    all.addEventListener('click', () => this.#clearTypes())
    bar.appendChild(all)

    for (const entry of types) {
      const meta = TYPE_META[entry.key]
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.className = 'ftype-chip'
      chip.dataset['hcRow'] = `type:${entry.key}`
      if (this.#activeTypes.has(entry.key)) chip.classList.add('active')
      chip.style.setProperty('--c', meta.color)
      // RUNTIME-BUILT KEY: the chip's tooltip is the type's own `labelKey`,
      // chosen from TYPE_META — eleven expansions, files.type.pdf … .other.
      chip.title = t(meta.labelKey, TYPE_LABEL[entry.key])
      chip.addEventListener('click', () => this.#toggleType(entry.key))

      const icon = document.createElement('span')
      icon.className = 'ftype-icon mat-sym'
      icon.style.color = meta.color
      icon.setAttribute('aria-hidden', 'true')
      icon.textContent = meta.icon

      const count = document.createElement('span')
      count.className = 'ftype-count'
      count.textContent = String(entry.count)

      chip.append(icon, count)
      bar.appendChild(chip)
    }
    return bar
  }

  #renderList(files: readonly FileItem[]): HTMLElement {
    const list = document.createElement('ul')
    list.className = 'files-list'
    const showSource = this.#showSource

    for (const file of files) {
      const key = rowKey(file)
      const meta = this.#badge(file)
      // The same eleven runtime keys the chips use, reached the same way.
      const type = categorize(file.name, file.mime)

      const row = document.createElement('li')
      row.className = 'files-row'

      const icon = document.createElement('span')
      icon.className = 'ftype-icon row mat-sym'
      icon.style.color = meta.color
      icon.setAttribute('aria-label', t(meta.labelKey, TYPE_LABEL[type]))
      icon.textContent = meta.icon

      const info = document.createElement('div')
      info.className = 'files-meta'
      const name = document.createElement('span')
      name.className = 'files-name'
      name.title = file.name
      name.textContent = file.name
      const sub = document.createElement('span')
      sub.className = 'files-sub'
      if (showSource && file.cell) {
        const source = document.createElement('span')
        source.className = 'files-source'
        source.textContent = file.cell
        const dot = document.createElement('span')
        dot.className = 'files-dot'
        dot.textContent = '·'
        sub.append(source, dot)
      }
      const size = document.createElement('span')
      size.className = 'files-size'
      size.textContent = sizeLabel(file.size)
      sub.appendChild(size)
      info.append(name, sub)

      const actions = document.createElement('div')
      actions.className = 'files-actions'

      const download = document.createElement('button')
      download.type = 'button'
      download.className = 'files-action download'
      download.dataset['hcRow'] = `download:${key}`
      download.textContent = t('files.download', 'download')
      download.addEventListener('click', () => { void this.#download(file) })

      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'files-action remove'
      remove.dataset['hcRow'] = `remove:${key}`
      remove.textContent = '×'
      remove.setAttribute('aria-label', t('files.remove', 'remove file'))
      remove.addEventListener('click', () => this.#remove(file))

      actions.append(download, remove)
      row.append(icon, info, actions)
      list.appendChild(row)
    }
    return list
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
  customElements.define(SURFACE_NAME, FilesViewerElement)
}

window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/FilesViewerElement',
    element: SURFACE_NAME,
    order: 110,
  })
})
