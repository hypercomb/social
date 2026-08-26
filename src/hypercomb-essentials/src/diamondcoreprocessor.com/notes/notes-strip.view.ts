// notes-strip.view.ts — THE NOTES STRIP (the annotations window), as a
// framework-free custom element (everything-is-a-beehavior Phase 2: Angular
// panels leave the shell and ship as signed modules).
//
// A straight port of shared/ui/notes-strip: same surface name
// (hc-notes-strip), same order band (10), the same panel id ('notes-strip')
// and the same dock geometry the template declared — so the participant's
// saved width, text size, code font and group membership all come across. It
// lands in `notes/` beside notes.drone.ts (the drone that owns every note
// write this panel emits), note-marks.store.ts (the palette it draws) and
// notes-viewer.view.ts (the reader the header's book button opens).
//
// ── WHAT IT IS ─────────────────────────────────────────────────────────────
//
// The one window in the hive you WRITE in. It is three surfaces stacked in a
// single docked rail (and spread across a three-column desk in fullscreen):
//
//   • the HEADER — which tile, which annotations tab (notes | lists), and the
//     mark rail: the participant's own icons, each carrying a meaning THEY
//     gave it, clicked to arm the next write or DRAGGED onto an existing row;
//   • the PANE — the selected note read and written at size, or, on the lists
//     tab, the open list whole: a column of one-liners with a line that is
//     always open at the foot (type, Enter, type, Enter) and Tab / Shift+Tab
//     moving that open line in and out;
//   • the TILE NAVIGATOR — every tile of the current layer, which is how you
//     pick what you are writing on. It is the hive's own tiles rail (the same
//     component the chat window mounts), reached structurally through IoC.
//
// ── WHAT THE CONVERSION HAD TO DECIDE ──────────────────────────────────────
//
// THE HOST IS NOT THE PANEL. Every other converted docked panel makes the tag
// itself the panel box. This one cannot: the strip's `:host` is a full-bleed,
// `pointer-events:none` container that (a) centres the panel in FLOAT mode and
// clamps its drag, (b) expresses the desk's yield to a right-docked toolwindow
// (`--hc-inset-right`), and (c) holds the tile PEEK CARD and the mark drag
// GHOST outside `.notes-strip`, whose `backdrop-filter` would otherwise make
// it the containing block for their fixed positioning and drift both down the
// screen. So the two-level structure is kept exactly: `<hc-notes-strip>` is
// the container, `.notes-strip` inside it is the panel.
//
// THE `ownsSize:false` PATH LIVES HERE. DockedPanelElement deliberately does
// not carry it (see its header) — the strip owns its own width, its own store
// (`hc:notes-strip-width`, NOT the base's `hc:docked-width:…`, which would
// orphan the participant's width), its own edge handles and a float mode the
// base knows nothing about. What the base contributes is the SETTINGS (gear,
// group, text size, faces), the LANE, the window SESSION and the one-window
// rule. So this class:
//   • overrides `attrs()` / `laneWidth()` / `adopt()` / `placeInLane()` so the
//     group and the lane read and write the width THIS window owns;
//   • undoes, right after `activate()`, the three things the base does to a
//     host that is not the panel: the inline width, the resize grip on the
//     host's edge, and the gear parked at the host's top-left (re-homed into
//     the dragbar exactly as the base's own header branch would have);
//   • re-states `--hc-panel-scale` from the REAL width. The base derives the
//     AUTO scale from a width it does not own (its own restore, 500), so Auto
//     would be frozen at 1.0; the Angular directive asked its `sizeOwner` for
//     the same number. Same formula, same single decision point, fed the right
//     width.
//   • reports `viewport:inset` for the PANEL rather than the host (the
//     hcDockInset job, whose full-bleed guard the base applies to the host and
//     would therefore always answer 0).
//
// ONE KNOWN DIFFERENCE, NAMED: the base writes `--hc-panel-scale`, `--hc-code`
// and `--hc-read` on the HOST where the directive wrote them on the panel, so
// the peek card and the drag ghost — siblings of the panel — now inherit the
// window's text size where before they were fixed at 1. They are part of this
// window, so following its text size is right; it is written down because it
// is a change, not because it is a bug.
//
// RENDERING. Rebuild-on-change, the house pattern — state lives in fields,
// never in the DOM. What must not be rebuilt is what the participant is
// standing in: the note composer's textarea, the always-open new-line input,
// the two scrolling lists, the tile filter box and the mounted tiles rail are
// PERSISTENT nodes, placed by an anchor walk (`#place`) that MOVES what it
// keeps and never `appendChild`s a node that is already parented. Everything
// else is rebuilt, wrapped in a focus snapshot keyed by `data-hc-row` — a key
// this panel owns, never a class, because two buttons in one strip share one.
//
// NO HTML EVER REACHES THE DOM. notes-security.spec.ts is a ratchet over this
// folder: no innerHTML / outerHTML / insertAdjacentHTML / execCommand /
// contenteditable, and a note's text arrives through `textContent` — which
// cannot parse markup — exactly as Angular's `{{ }}` did.
//
// Its strings ship WITH it (notes-strip.i18n.ts, extracted from all 14 shell
// catalogs) and register under the 'app' namespace, so every key resolves
// exactly as before — the Phase 2 catalog split, another slice.

import {
  EffectBus,
  I18N_IOC_KEY,
  NOTE_MARKS_CHANGED,
  NOTE_MARKS_IOC_KEY,
  ensureViewportInsetVars,
  isMarkIcon,
  kindOfRole,
  layoutLane,
  publishAttrs,
  readGroupAttrs,
  readTextScale,
  requestIconPick,
  stepIndex,
  windowsParked,
  type GroupAttrs,
  type I18nProvider,
  type MarkKind,
  type MarkRole,
  type NoteMark,
  type NoteMarksChange,
  type NoteMarksProvider,
  type SettingRow,
  type WindowSession,
} from '@hypercomb/core'
import { DockedPanelElement } from '../panels/docked-panel.element.js'
import { NOTES_STRIP_TRANSLATIONS } from './notes-strip.i18n.js'

const SURFACE_NAME = 'hc-notes-strip'
const S = SURFACE_NAME

// Correlation token for this window's requests to the shared icon chooser
// (core/icon-pick.ts). The chooser also serves the tile-icon override flow,
// whose ids are real element ids, so every requester names itself.
const MARK_PICK_ID = 'notes:mark-palette'

// Participant-local render index: locationSig (or bare label) → props-resource
// sig, written by the renderer for every tile it paints. Read-only here, and
// O(1) — the identity plate never triggers a cold tree walk to find a picture.
const TILE_PROPS_INDEX_KEY = 'hc:tile-props-index'
const SIG_RE = /^[0-9a-f]{64}$/i

// Panel width (px) at which the identity plate earns its large form.
const PLATE_WIDE_AT = 400

// Hover-list dwell (ms) — long enough that sweeping the pointer across the
// navigator doesn't strobe cards, short enough to feel like a peek.
const HOVER_OPEN_DELAY = 180
const HOVER_CLOSE_DELAY = 120

// Rows the navigator's hover list shows before it truncates to "+N more".
const HOVER_LIST_MAX = 10

// The strip's OWN width store — not the base's `hc:docked-width:notes-strip`.
const NOTES_STRIP_WIDTH_KEY = 'hc:notes-strip-width'
const NOTES_STRIP_BASE_WIDTH = 500
const MIN_PANEL_WIDTH = 256

// ── The reading FACE ──────────────────────────────────────
// Participant-local viewing preference (like the mode and the width), so it
// lives in localStorage and never enters a layer. It applies to the PROSE
// only — note text, the editor, list lines, the list's name. The chrome around
// it stays mono, because the chrome is the window and the window is not what
// changed.
const NOTES_STRIP_FACE_KEY = 'hc:notes-face'
const NOTES_FACES = ['mono', 'sans', 'serif'] as const
type NotesFace = typeof NOTES_FACES[number]

// Translate delta from the panel's natural (centered) position, persisted.
const NOTES_STRIP_OFFSET_KEY = 'hc:notes-strip-offset'
// Dock side — 'right' snaps to a full-height rail, 'float' is the free mode.
const NOTES_STRIP_DOCK_KEY = 'hc:notes-strip-dock'

// Right-edge snap thresholds (mirror the controls-bar hysteresis).
const SNAP_ZONE = 72
const SNAP_EXIT = 120

// Travel (px) a dragbar press must cover before it counts as a drag.
const DRAG_THRESHOLD = 6

/** Fixed shape set — six CSS-drawn glyphs. The shape is the only visual
 *  category a legacy note carries; marks superseded it. */
type ShapeId = 'circle' | 'square' | 'triangle' | 'diamond' | 'star' | 'hexagon'

const SHAPES: ReadonlySet<string> = new Set<string>([
  'circle', 'square', 'triangle', 'diamond', 'star', 'hexagon',
])

type Note = {
  id: string
  text: string
  shape: ShapeId | null
  /** Material icon name from the participant's mark palette. Supersedes
   *  `shape`; notes written before marks existed carry only a shape. */
  mark: string | null
  /** Pheromones on the note itself. Older services predate the slot, so reads
   *  go through `readingTags()` rather than touching it directly. */
  tags?: string[]
  children: Note[]
}

type NotesService = {
  notesFor(cellLabel: string): Note[]
  getNotes(cellLabel: string): Promise<Note[]>
}

type SelectionService = EventTarget & {
  active: string | null
  selected: ReadonlySet<string>
  count: number
}

/** Single open question — Claude's side of the comm channel, read out of the
 *  cell's `qa` layer slot and surfaced beside the user's notes so the
 *  conversation reads in one list. */
type QaItem = { qId: string; question: string }

type HistoryServiceLike = {
  sign(lineageLike: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<{ qa?: unknown; children?: unknown; properties?: unknown } | null>
}

type StoreLike = {
  resolve<T = unknown>(value: unknown): Promise<T>
  getResource?(sig: string): Promise<Blob | null | undefined>
}

/** What one read of a cell's head layer yields beyond its notes: the open
 *  questions, how many child tiles it holds, and the canonical props-resource
 *  sig (hop one of two to the tile's picture). Gathered in ONE `currentLayerAt`
 *  call — the same call the qa slot already needed — so the identity plate and
 *  the navigator's hover list cost no extra layer reads. */
type CellFacts = {
  qa: readonly QaItem[]
  childCount: number
  propsSig: string | null
}

type LineageLike = { explorerSegments?: () => readonly string[] }

/** Structural type for the InputModeStack lookup. Resolved at runtime through
 *  IoC, falls through cleanly when the service isn't registered. */
type InputModeLike = { name: string; mount(): void; unmount(): void }
type InputModeStackLike = {
  push(mode: InputModeLike): void
  pop(name: string): void
  remove(name: string): void
}

/** THE TILES RAIL — the hive's one tile list (assistant/agent-tiles-rail.ts),
 *  taken through the factory it registers in IoC. The PROFILE is how one list
 *  serves two surfaces; `showLevel` is also the feature test — a build
 *  predating it hands back a rail that WALKS, whose rows name cells at another
 *  location, and this panel resolves a tile's notes by NAME against the
 *  location it stands at. Rather than open the wrong tile's notes, the panel
 *  keeps its own chips. */
type RailPickLike = { readonly name: string; readonly path: readonly string[]; readonly sig?: string }
type RailRowLike = { readonly name: string; readonly segments: readonly string[] }
type TilesRailLike = {
  onSubjectChanged: (subject: RailPickLike | null) => void
  mount(host: HTMLElement): void
  showLevel?(segments: readonly string[]): void
  showCurrent?(name: string | null): void
  refresh?(): void
  paint?(): void
  dispose(): void
}
type TilesRailFactoryLike = {
  create?: (profile?: {
    walk?: boolean
    chats?: boolean
    choose?: boolean
    badge?: (row: RailRowLike) => number
    admits?: (row: RailRowLike) => boolean
    matches?: (row: RailRowLike, query: string) => boolean
    onHover?: (row: RailRowLike, event: PointerEvent | null) => void
    findLabel?: string
    clickLabel?: string
  }) => TilesRailLike
}

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

/** The four plate counts have NO bare key in the catalogs — only `.one` /
 *  `.other`. The i18n service picks between them off `params.count`; the
 *  FALLBACK has to make the same choice itself, or a host with no catalog
 *  would read "1 notes". */
const tCount = (key: string, one: string, other: string, count: number): string =>
  t(key, count === 1 ? one : other, { count })

// The panel's strings travel with it — registered as soon as the i18n service
// is up, under 'app' so the keys resolve exactly as they always did.
window.ioc?.whenReady?.(I18N_IOC_KEY, (i18n) => {
  const provider = i18n as I18nProvider
  for (const [locale, catalog] of Object.entries(NOTES_STRIP_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

// ══ the styles the ELEVEN Angular stylesheets carried, expanded to plain CSS ══
//
// The component pulled `notes-strip.component.scss` plus the frame / tabs /
// rail / form / tree / navigator / plate / reading / lists / desk surfaces, in
// that order — and Angular compiles `styleUrls` in order, so THE ORDER IS THE
// CASCADE. Several rules in the later sheets win only by source position (the
// desk's `display:flex` over the shell's `display:none` for the pane; the desk
// scale over the compact one), so the blocks below are concatenated in exactly
// the `styleUrls` order and must stay that way.
//
// No shadow DOM (the tutorial-overlay / sequence-viewer / context-window
// precedent): Angular's `:host` becomes the TAG NAME and every other selector
// is prefixed with it. That adds 0,0,1 to every selector uniformly, so the
// relative specificity the original relied on is preserved.
//
// SCSS EXPANDED BY HAND:
//   • `$steel: #7eb6d6` at every `rgba($steel, a)` / `color-mix(… #{$steel} …)`
//   • `scaled($x)` → `calc($x * var(--hc-panel-scale, 1))`
//   • `hex-mark($w,$h,$glyph)` → the six declarations it emits
//   • `$indent-step: 18px`, `$guide: color-mix(in srgb, var(--md-on-surface)
//     13%, transparent)`, `$bp-tablet-land: 1024px`
//   • `@use '../toolwindow' as tw` → `tw.header` expanded inline on
//     `.cv2-dragbar`. It is written FIRST in that rule, so the rule's own later
//     declarations WIN: the effective background is `rgba(255,255,255,.02)`,
//     not the header band's gradient, and only the winner is emitted. Its
//     CHILD rules (`> button`, `> button[class*='close']`) ARE emitted — they
//     out-specify `.cv2-mini-btn`, exactly as they always did, so the mini
//     buttons keep the shared header band's geometry.
//   • `@use '../../styles/notes-shapes'` → emitted FIRST inside sheet one,
//     which is where Sass puts a `@use`d module's CSS.
//   • the reading pane is one SCSS mixin at two scales; it is one FUNCTION
//     here for the same reason — behaviour, colour and structure are not
//     allowed to drift between the docked window and the desk.
// Angular's build autoprefixed; `-webkit-backdrop-filter` and
// `-webkit-user-select` are written by hand.

// ── sheet 1a: styles/_notes-shapes.scss (via @use, emitted first) ─────────
const CSS_SHAPES = `
${S} .hc-shape-glyph{display:inline-block;width:14px;height:14px;flex-shrink:0;vertical-align:middle;background:transparent}
${S} .hc-shape-circle.hc-shape-glyph{background:var(--md-primary);border-radius:50%}
${S} .hc-shape-square.hc-shape-glyph{background:var(--md-secondary);border-radius:2px}
${S} .hc-shape-triangle.hc-shape-glyph{background:var(--md-tertiary);clip-path:polygon(50% 8%,96% 92%,4% 92%)}
${S} .hc-shape-diamond.hc-shape-glyph{background:var(--md-primary);clip-path:polygon(50% 0%,100% 50%,50% 100%,0% 50%)}
${S} .hc-shape-star.hc-shape-glyph{background:var(--md-tertiary);clip-path:polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%)}
${S} .hc-shape-hexagon.hc-shape-glyph{background:var(--md-secondary);clip-path:polygon(25% 0%,75% 0%,100% 50%,75% 100%,25% 100%,0% 50%)}
${S} .cv2-note.hc-shape-circle .hc-shape-glyph,${S} .viewer-row.hc-shape-circle .hc-shape-glyph{background:var(--md-primary);border-radius:50%}
${S} .cv2-note.hc-shape-square .hc-shape-glyph,${S} .viewer-row.hc-shape-square .hc-shape-glyph{background:var(--md-secondary);border-radius:2px}
${S} .cv2-note.hc-shape-triangle .hc-shape-glyph,${S} .viewer-row.hc-shape-triangle .hc-shape-glyph{background:var(--md-tertiary);clip-path:polygon(50% 8%,96% 92%,4% 92%)}
${S} .cv2-note.hc-shape-diamond .hc-shape-glyph,${S} .viewer-row.hc-shape-diamond .hc-shape-glyph{background:var(--md-primary);clip-path:polygon(50% 0%,100% 50%,50% 100%,0% 50%)}
${S} .cv2-note.hc-shape-star .hc-shape-glyph,${S} .viewer-row.hc-shape-star .hc-shape-glyph{background:var(--md-tertiary);clip-path:polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%)}
${S} .cv2-note.hc-shape-hexagon .hc-shape-glyph,${S} .viewer-row.hc-shape-hexagon .hc-shape-glyph{background:var(--md-secondary);clip-path:polygon(25% 0%,75% 0%,100% 50%,75% 100%,25% 100%,0% 50%)}
${S} .hc-tool-indent.hc-shape-glyph{--bar:currentColor;background:linear-gradient(var(--bar),var(--bar)) 0% 25% / 100% 2px no-repeat,linear-gradient(var(--bar),var(--bar)) 100% 50% / 64% 2px no-repeat,linear-gradient(var(--bar),var(--bar)) 0% 75% / 100% 2px no-repeat}
${S} .hc-tool-outdent.hc-shape-glyph{--bar:currentColor;background:linear-gradient(var(--bar),var(--bar)) 0% 25% / 100% 2px no-repeat,linear-gradient(var(--bar),var(--bar)) 0% 50% / 64% 2px no-repeat,linear-gradient(var(--bar),var(--bar)) 0% 75% / 100% 2px no-repeat}
${S} .hc-tool-clear.hc-shape-glyph{--stroke:currentColor;background:linear-gradient(45deg,transparent 45%,var(--stroke) 45% 55%,transparent 55%),linear-gradient(-45deg,transparent 45%,var(--stroke) 45% 55%,transparent 55%)}
`

// ── sheet 1b: notes-strip.component.scss — the shell ──────────────────────
//
// `@if (visible())` wrapped the WHOLE panel, so nothing existed while the strip
// was off. A registry-fed element is mounted once and stays, so DOM presence
// and ENGAGEMENT are split the way DockedPanelElement splits them: `activate()`
// builds + claims the lane + joins the session, `deactivate()` tears it down
// and clears the children. The host therefore starts with NO children AND
// `display:none` — an empty container that still generated a box over the hive
// would be a change to what the canvas can be clicked through.
const CSS_SHELL = `
${S}{--hc-face-mono:var(--hc-mono,ui-monospace,monospace);--hc-face-sans:var(--md-font-ui);--hc-face-serif:var(--md-font-display);
position:fixed;top:max(calc(2.3rem * var(--hc-header-zoom,1.0)),var(--hc-header-anchor));bottom:5rem;left:0;right:0;z-index:60001;
display:none;justify-content:center;align-items:flex-start;pointer-events:none;padding:0 16px}
${S}.open{display:flex}
${S}.is-fullscreen{top:max(calc(2.3rem * var(--hc-header-zoom,1.0)),var(--hc-header-anchor));bottom:0;padding:0}
${S}.is-fullscreen{right:var(--hc-inset-right,0px)}
${S}.is-fullscreen .notes-strip,${S}.is-fullscreen .notes-strip.dock-right{position:absolute;inset:0;width:auto !important;max-width:none !important;height:auto !important;max-height:none !important;border-radius:0;transform:none !important}
${S}.is-fullscreen .cv2-list{max-height:none;flex:1 1 auto}
${S}.is-fullscreen .cv2-reading{display:none}
${S} .cv2-main{display:contents}
${S}:not(.is-fullscreen) .cv2-dragbar{order:1}
${S}:not(.is-fullscreen) .cv2-tabs{order:2}
${S}:not(.is-fullscreen) .cv2-rail{order:3;flex:0 0 auto}
${S}:not(.is-fullscreen) .cv2-reading{order:4;flex:1.7 1 55%;min-height:160px;border-bottom:1px solid color-mix(in srgb,var(--md-on-surface) 10%,transparent)}
${S}:not(.is-fullscreen) .cv2-tilelist{order:5;flex:1 1 32%;min-height:120px}
${S}:not(.is-fullscreen) .cv2-main{display:none}
${S} .notes-strip{pointer-events:auto;position:relative;
--md-secondary:#7eb6d6;--md-on-secondary:#0e0e16;--md-font-ui:var(--hc-mono,system-ui);--md-font-display:var(--hc-mono,system-ui);
--hc-notes-face:var(--hc-face-mono);
display:flex;flex-direction:column;background:rgba(14,14,22,.96);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);
font-family:var(--hc-mono,system-ui);color:#eaf0f4;border:none;border-left:1px solid rgba(126,182,214,.5);border-radius:0;
box-shadow:-10px 0 40px rgba(0,0,0,.5),0 0 0 1px rgba(126,182,214,.06) inset;
width:500px;height:auto;min-width:256px;max-width:calc(100% - 32px);max-height:100%;overflow:visible}
${S} .notes-strip[data-face='sans']{--hc-notes-face:var(--hc-face-sans)}
${S} .notes-strip[data-face='serif']{--hc-notes-face:var(--hc-face-serif)}
${S} .notes-strip.dock-right{position:fixed;right:0;top:max(calc(2.3rem * var(--hc-header-zoom,1.0)),var(--hc-header-anchor));bottom:0;margin:0;height:auto !important;max-height:none !important;border-radius:0}
${S} .notes-strip.dock-right .cv2-resize-handle,${S} .notes-strip.dock-right .cv2-resize-edge-bottom{display:none}
`

// ── sheet 2: notes-strip.frame.scss ───────────────────────────────────────
//
// Several of these rules (`.notes-strip-header`, `.notes-strip-filter`,
// `.row-kind`, `.notes-strip-title`, `.notes-strip-hide`, `.visually-hidden`)
// no longer match anything the template draws. They are carried anyway: a
// dropped rule is a silent change to what a theme can reach, and deciding
// which of a converted panel's rules are truly dead is a separate pass with
// its own evidence.
const CSS_FRAME = `
${S} .notes-strip-header{display:flex;align-items:center;gap:.5rem;padding:.35rem .5rem .35rem .75rem;border-bottom:1px solid color-mix(in srgb,var(--md-on-surface) 8%,transparent)}
${S} .notes-strip-filter{display:flex;align-items:center;gap:.3rem;padding:.3rem .55rem;border-bottom:1px solid color-mix(in srgb,var(--md-on-surface) 6%,transparent)}
${S} .notes-strip-filter .kind-tab{display:inline-flex;align-items:center;gap:.3rem;padding:.2rem .6rem;border:1px solid color-mix(in srgb,var(--md-on-surface) 12%,transparent);border-radius:999px;background:transparent;color:color-mix(in srgb,var(--md-on-surface) 70%,transparent);font-family:inherit;font-size:calc(.72rem * var(--hc-panel-scale,1));letter-spacing:.04em;text-transform:uppercase;cursor:pointer;transition:background var(--md-dur-short) var(--md-easing-standard),color var(--md-dur-short) var(--md-easing-standard),border-color var(--md-dur-short) var(--md-easing-standard)}
${S} .notes-strip-filter .kind-tab:hover{color:var(--md-on-surface);border-color:color-mix(in srgb,var(--md-on-surface) 22%,transparent)}
${S} .notes-strip-filter .kind-tab.is-active{background:color-mix(in srgb,var(--md-secondary) 18%,transparent);border-color:color-mix(in srgb,var(--md-secondary) 55%,transparent);color:var(--md-on-surface-strong,var(--md-on-surface))}
${S} .notes-strip-filter .kind-icon{display:inline-flex;width:.85em;height:.85em}
${S} .notes-strip-filter .kind-icon svg{width:100%;height:100%;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
${S} .row-kind{display:inline-flex;align-items:center;gap:.3rem;align-self:flex-start;padding:.05rem .5rem .05rem .35rem;border-radius:3px;background:color-mix(in srgb,var(--md-on-surface) 8%,transparent);color:color-mix(in srgb,var(--md-on-surface) 75%,transparent);font-size:calc(.62rem * var(--hc-panel-scale,1));letter-spacing:.08em;text-transform:uppercase;line-height:1.4}
${S} .row-kind .kind-icon{display:inline-flex;width:.95em;height:.95em}
${S} .row-kind .kind-icon svg{width:100%;height:100%;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
${S} .row-kind .kind-label{font-weight:500}
${S} .row-kind[data-kind="q"]{background:color-mix(in srgb,var(--md-secondary) 22%,transparent);color:var(--md-on-surface-strong,var(--md-on-surface))}
${S} .row-kind[data-kind="a"]{background:rgba(110,180,255,.16);color:var(--md-on-surface-strong,var(--md-on-surface))}
${S} .row-kind.chip-kind{padding:0;background:transparent;align-self:center;margin-right:.25rem}
${S} .row-kind.chip-kind .kind-label{display:none}
${S} .row-kind.chip-kind[data-kind="q"]{color:var(--md-secondary)}
${S} .row-kind.chip-kind[data-kind="a"]{color:rgb(110,180,255)}
${S} .notes-strip-title{flex:1;min-width:0;font-size:calc(.65rem * var(--hc-panel-scale,1));font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--md-on-surface-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${S} .notes-strip-hide{flex-shrink:0;background:transparent;border:1px solid transparent;color:var(--md-on-surface-faint);font-family:inherit;font-size:calc(.7rem * var(--hc-panel-scale,1));letter-spacing:.04em;line-height:1;padding:.25rem .55rem;border-radius:var(--md-shape-xs);cursor:pointer;transition:background var(--md-dur-short) var(--md-easing-standard),color var(--md-dur-short) var(--md-easing-standard),border-color var(--md-dur-short) var(--md-easing-standard)}
${S} .notes-strip-hide:hover{background:color-mix(in srgb,var(--md-on-surface) calc(var(--md-state-hover) * 100%),transparent);color:var(--md-on-surface-strong);border-color:var(--md-outline-variant)}
${S} .notes-strip-hide:focus-visible{outline:1px solid var(--md-secondary);outline-offset:2px}
${S} .notes-strip-body{display:flex;flex-direction:column;gap:.35rem;padding:.5rem .75rem .6rem;min-height:0;flex:1 1 auto;overflow-y:auto}
${S} .notes-strip.mode-rows{min-width:16rem;min-height:5rem}
${S} .cv2-resize-handle{position:absolute;right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;z-index:5;user-select:none;-webkit-user-select:none;touch-action:none}
${S} .cv2-resize-handle::before{content:"";position:absolute;inset:3px;background:linear-gradient(135deg,transparent 0%,transparent 40%,var(--md-on-surface-faint) 40%,var(--md-on-surface-faint) 50%,transparent 50%,transparent 70%,var(--md-on-surface-faint) 70%,var(--md-on-surface-faint) 80%,transparent 80%);opacity:.5;border-bottom-right-radius:11px;transition:opacity var(--md-dur-short) var(--md-easing-standard)}
${S} .cv2-resize-handle:hover::before{opacity:1}
${S}.is-fullscreen .cv2-resize-handle{display:none}
${S} .cv2-resize-edge{position:absolute;z-index:5;user-select:none;-webkit-user-select:none;touch-action:none}
${S} .cv2-resize-edge-left{top:0;bottom:0;left:-3px;width:8px;cursor:ew-resize}
${S} .cv2-resize-edge-bottom{left:0;right:0;bottom:-3px;height:8px;cursor:ns-resize}
${S}.is-fullscreen .cv2-resize-edge{display:none}
${S} .visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
${S} .hex-mark{display:inline-block;width:1em;height:1em;background:currentColor;clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%);color:var(--md-secondary)}
${S} .thin-scroll{scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--md-secondary) 40%,transparent) transparent}
${S} .thin-scroll::-webkit-scrollbar{width:6px;height:6px}
${S} .thin-scroll::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--md-secondary) 40%,transparent);border-radius:4px}
`

// ── sheet 3: notes-strip.tabs.scss ────────────────────────────────────────
const CSS_TABS = `
${S} .cv2-dragbar{flex:0 0 auto;box-sizing:border-box;display:flex;align-items:center;gap:.5rem;height:2.875rem;min-height:2.875rem;padding:0 .75rem;line-height:1;background:rgba(255,255,255,.02);border-bottom:1px solid rgba(126,182,214,.25);border-radius:0;user-select:none;-webkit-user-select:none;cursor:grab;touch-action:none}
${S} .cv2-dragbar:active{cursor:grabbing}
${S} .cv2-dragbar>button,${S} .cv2-dragbar>[class*='actions']>button{box-sizing:border-box;display:inline-grid;place-items:center;min-width:1.75rem;height:1.75rem;padding:0 .25rem;border-radius:2px;line-height:1;transition:color 120ms ease,background-color 120ms ease,border-color 120ms ease}
${S} .cv2-dragbar>button:hover,${S} .cv2-dragbar>[class*='actions']>button:hover{background-color:rgba(255,255,255,.055)}
${S} .cv2-dragbar>button:focus-visible,${S} .cv2-dragbar>[class*='actions']>button:focus-visible{outline:1px solid color-mix(in srgb,var(--hc-window-accent) 72%,white);outline-offset:1px}
${S} .cv2-dragbar>button[class*='close'],${S} .cv2-dragbar>button.close,${S} .cv2-dragbar>[class*='actions']>button[class*='close']{width:1.75rem;min-width:1.75rem;padding:0;font-size:1.125rem;color:rgba(238,244,248,.62)}
${S} .cv2-dragbar>button[class*='close']:hover,${S} .cv2-dragbar>button.close:hover,${S} .cv2-dragbar>[class*='actions']>button[class*='close']:hover{color:#fff;background-color:rgba(255,255,255,.075)}
${S} .cv2-dragbar-title{display:inline-flex;align-items:center;gap:.4rem;font-family:var(--hc-mono,monospace);font-size:calc(.85rem * var(--hc-panel-scale,1));font-weight:600;letter-spacing:.02em;color:rgba(206,224,240,.96)}
${S} .cv2-dragbar-sep{color:var(--md-on-surface-faint)}
${S} .cv2-dragbar-listname{display:inline-flex;align-items:center;gap:.25rem;min-width:0;max-width:14rem;padding:1px 5px;border:1px solid transparent;border-radius:var(--hc-radius-floating);background:transparent;color:color-mix(in srgb,var(--md-on-surface) 72%,transparent);font-family:var(--hc-notes-face);font-size:calc(.82rem * var(--hc-panel-scale,1));font-weight:500;cursor:text}
${S} .cv2-dragbar-listname:hover{border-color:color-mix(in srgb,var(--md-on-surface) 20%,transparent)}
${S} .cv2-dragbar-listtext{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${S} .cv2-dragbar-listmark{flex:0 0 auto;font-size:calc(15px * var(--hc-panel-scale,1));color:color-mix(in srgb,#7eb6d6 80%,white)}
${S} .cv2-dragbar-listname-input{min-width:0;max-width:14rem;padding:1px 5px;border:1px solid rgba(126,182,214,.55);border-radius:var(--hc-radius-floating);background:rgba(255,255,255,.04);color:var(--md-on-surface);font-family:var(--hc-notes-face);font-size:calc(.82rem * var(--hc-panel-scale,1));font-weight:500;outline:none}
${S} .cv2-dragbar-faint{color:var(--md-on-surface-faint)}
${S} .cv2-dragbar-spacer{flex:1}
${S} .cv2-tabs{flex:0 0 auto;display:flex;align-items:stretch;gap:.15rem;padding:0 .35rem;border-bottom:1px solid rgba(126,182,214,.25);background:rgba(255,255,255,.015)}
${S} .cv2-tab{appearance:none;border:0;background:none;padding:.32rem .7rem .28rem;margin:0;font-family:var(--hc-mono,monospace);font-size:calc(.78rem * var(--hc-panel-scale,1));font-weight:600;letter-spacing:.03em;color:rgba(206,224,240,.55);cursor:pointer;border-bottom:2px solid transparent}
${S} .cv2-tab:hover{color:rgba(206,224,240,.85)}
${S} .cv2-tab:focus-visible{outline:1px solid rgba(126,182,214,.7);outline-offset:-1px}
${S} .cv2-tab.is-active{color:rgba(206,224,240,.96);border-bottom-color:rgba(126,182,214,.8)}
${S} .cv2-mini-btn{width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;background:transparent;border:1px solid transparent;color:rgba(226,235,244,.6);border-radius:var(--hc-radius-floating);cursor:pointer;padding:0;font-family:inherit;transition:color 150ms ease,background 150ms ease,border-color 150ms ease}
${S} .cv2-mini-btn:hover{color:#fff;background:rgba(126,182,214,.16);border-color:rgba(126,182,214,.4)}
${S} .cv2-mini-btn.ghost{color:rgba(226,235,244,.4)}
${S} .cv2-exit-btn{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 8px;background:color-mix(in srgb,var(--md-secondary) 16%,transparent);border:1px solid color-mix(in srgb,var(--md-secondary) 40%,transparent);border-radius:999px;color:var(--md-secondary);font-family:var(--md-font-mono);font-size:calc(10.5px * var(--hc-panel-scale,1));letter-spacing:.04em;cursor:pointer;margin-right:4px}
${S} .cv2-exit-btn:hover{background:color-mix(in srgb,var(--md-secondary) 26%,transparent);color:var(--md-on-surface-strong)}
${S} .cv2-toolbar-spacer{flex:1}
`

// ── sheet 4: notes-strip.rail.scss — the mark rail ────────────────────────
const CSS_RAIL = `
${S} .cv2-rail{display:flex;align-items:center;gap:4px;padding:5px 8px;background:rgba(255,255,255,.012);border-bottom:1px solid rgba(126,182,214,.25)}
${S} .cv2-rail.is-editing{display:block;padding:6px 8px 8px}
${S} .cv2-rail-marks{display:flex;align-items:center;gap:3px;flex-wrap:wrap;min-width:0}
${S} .cv2-rail-spacer{flex:1}
${S} .cv2-rail-mark,${S} .cv2-rail-btn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;background:transparent;border:1px solid transparent;border-radius:4px;color:color-mix(in srgb,var(--md-on-surface) 58%,transparent);cursor:pointer;transition:background var(--md-dur-short) var(--md-easing-standard),color var(--md-dur-short) var(--md-easing-standard),border-color var(--md-dur-short) var(--md-easing-standard)}
${S} .cv2-rail-mark .mat-sym,${S} .cv2-rail-btn .mat-sym{font-size:17px}
${S} .cv2-rail-mark:hover,${S} .cv2-rail-btn:hover{background:color-mix(in srgb,var(--md-on-surface) 9%,transparent);color:var(--md-on-surface)}
${S} .cv2-rail-mark:focus-visible,${S} .cv2-rail-btn:focus-visible{outline:1px solid var(--md-secondary);outline-offset:1px}
${S} .cv2-rail-mark{touch-action:none;cursor:grab}
${S} .cv2-rail-mark:active{cursor:grabbing}
${S} .cv2-rail-mark .mat-sym{display:inline-grid;place-items:center;flex:0 0 auto;width:24px;height:26px;clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);background:linear-gradient(160deg,rgba(126,182,214,.30),rgba(126,182,214,.08) 60%),rgba(255,255,255,.03);color:color-mix(in srgb,#7eb6d6 70%,white);font-size:15px;line-height:1}
${S} .cv2-rail-mark:hover .mat-sym{color:white}
${S} .cv2-rail-mark.is-dragging{opacity:.35;cursor:grabbing}
${S} .cv2-mark-ghost{position:fixed;z-index:60;transform:translate(-50%,-50%);pointer-events:none;font-size:20px;color:var(--md-on-surface-strong,var(--md-on-surface));text-shadow:0 1px 6px rgba(0,0,0,.7)}
${S} .cv2-rail-mark.is-active{background:color-mix(in srgb,var(--md-secondary) 22%,transparent);border-color:color-mix(in srgb,var(--md-secondary) 55%,transparent);color:var(--md-on-surface-strong,var(--md-on-surface))}
${S} .cv2-rail-mark.is-heading .mat-sym{font-size:19px;font-variation-settings:'FILL' 1}
${S} .cv2-rail-kind{display:flex;align-items:center;gap:3px;min-width:0}
${S} .cv2-rail-kind.is-note{margin-left:3px;padding-left:6px;border-left:1px solid color-mix(in srgb,var(--md-on-surface) 14%,transparent)}
${S} .cv2-rail-kind-label{font-size:calc(.6rem * var(--hc-panel-scale,1));letter-spacing:.07em;text-transform:uppercase;color:var(--md-on-surface-faint);margin-right:2px;white-space:nowrap;user-select:none;-webkit-user-select:none}
${S} .cv2-rail-mark.is-prose .mat-sym{font-variation-settings:'FILL' 0,'wght' 300}
${S} .cv2-rail-editor-head{display:flex;align-items:center;gap:6px;padding-bottom:5px;font-size:calc(.72rem * var(--hc-panel-scale,1));letter-spacing:.06em;text-transform:uppercase;color:color-mix(in srgb,var(--md-on-surface) 55%,transparent)}
${S} .cv2-mark-row{display:flex;align-items:center;gap:6px;padding:3px 0}
${S} .cv2-mark-row-icon{font-size:18px;width:22px;text-align:center;color:color-mix(in srgb,var(--md-on-surface) 70%,transparent);flex-shrink:0}
${S} .cv2-mark-name{flex:1 1 auto;min-width:0;background:color-mix(in srgb,var(--md-on-surface) 5%,transparent);border:1px solid var(--md-outline-variant);border-radius:3px;padding:3px 6px;color:var(--md-on-surface);font-family:inherit;font-size:calc(.76rem * var(--hc-panel-scale,1));outline:none}
${S} .cv2-mark-name::placeholder{color:color-mix(in srgb,var(--md-on-surface) 40%,transparent)}
${S} .cv2-mark-name:focus{border-color:color-mix(in srgb,var(--md-secondary) 55%,transparent)}
${S} .cv2-mark-roles{display:inline-flex;flex-shrink:0;border:1px solid var(--md-outline-variant);border-radius:3px;overflow:hidden}
${S} .cv2-mark-roles button{background:transparent;border:none;padding:3px 6px;color:color-mix(in srgb,var(--md-on-surface) 55%,transparent);font-family:inherit;font-size:calc(.68rem * var(--hc-panel-scale,1));letter-spacing:.04em;cursor:pointer}
${S} .cv2-mark-roles button:hover{background:color-mix(in srgb,var(--md-on-surface) 8%,transparent)}
${S} .cv2-mark-roles button.is-on{background:color-mix(in srgb,var(--md-secondary) 24%,transparent);color:var(--md-on-surface-strong,var(--md-on-surface))}
${S} .cv2-mark-remove{display:inline-flex;align-items:center;background:none;border:none;padding:2px;color:color-mix(in srgb,var(--md-on-surface) 45%,transparent);cursor:pointer;flex-shrink:0}
${S} .cv2-mark-remove:hover{color:var(--md-error,#ff6b6b)}
${S} .cv2-mark-add{display:inline-flex;align-items:center;gap:5px;margin-top:6px;padding:4px 8px;background:color-mix(in srgb,var(--md-on-surface) 6%,transparent);border:1px dashed var(--md-outline-variant);border-radius:4px;color:color-mix(in srgb,var(--md-on-surface) 70%,transparent);font-family:inherit;font-size:calc(.74rem * var(--hc-panel-scale,1));cursor:pointer}
${S} .cv2-mark-add:hover{background:color-mix(in srgb,var(--md-on-surface) 10%,transparent);color:var(--md-on-surface)}
${S} .cv2-rail-empty{padding:4px 0 2px;color:color-mix(in srgb,var(--md-on-surface) 50%,transparent);font-size:calc(.75rem * var(--hc-panel-scale,1));font-style:italic}
`

// ── sheet 5: notes-strip.form.scss — the composer, and the kind chips ─────
const CSS_FORM = `
${S} .cv2-form{display:flex;flex-direction:column;gap:6px;padding:8px;background:color-mix(in srgb,var(--md-surface-c-low) 80%,transparent);border-bottom:1px solid var(--md-outline-variant);flex-shrink:0}
${S} .cv2-form-input-row{display:flex;align-items:flex-end;gap:6px}
${S} .cv2-form-input{flex:1;min-width:0;min-height:38px;max-height:40vh;resize:none;padding:9px 10px;background:var(--md-surface-c);border:1px solid var(--md-outline-variant);border-radius:var(--hc-radius-control);color:var(--md-on-surface);font-family:var(--hc-notes-face);font-size:calc(14px * var(--hc-panel-scale,1));line-height:1.4;outline:none;transition:border-color var(--md-dur-short) var(--md-easing-standard),box-shadow var(--md-dur-short) var(--md-easing-standard)}
${S} .cv2-form-input::placeholder{color:var(--md-on-surface-faint)}
${S} .cv2-form-input:focus{border-color:color-mix(in srgb,var(--md-secondary) 55%,transparent);box-shadow:0 0 0 3px color-mix(in srgb,var(--md-secondary) 12%,transparent)}
${S} .cv2-form-submit{flex-shrink:0;height:38px;padding:0 16px;background:var(--md-secondary);border:1px solid transparent;border-radius:var(--hc-radius-control);color:var(--md-on-secondary,#15151c);font-family:var(--md-font-ui,Inter,system-ui);font-size:calc(13px * var(--hc-panel-scale,1));font-weight:600;cursor:pointer;transition:opacity var(--md-dur-short) var(--md-easing-standard),filter var(--md-dur-short) var(--md-easing-standard)}
${S} .cv2-form-submit:hover:not(:disabled){filter:brightness(1.08)}
${S} .cv2-form-submit:disabled{opacity:.4;cursor:default}
${S} .cv2-form-tools{display:flex;align-items:center;gap:2px}
${S} .cv2-form-cancel{display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 8px;background:transparent;border:1px solid var(--md-outline-variant);border-radius:var(--hc-radius-floating);color:var(--md-on-surface-faint);font-family:var(--md-font-ui);font-size:calc(12px * var(--hc-panel-scale,1));cursor:pointer}
${S} .cv2-form-cancel:hover{color:var(--md-on-surface);border-color:var(--md-on-surface-faint)}
${S} .cv2-input-wrap{position:relative;flex:1;min-width:0;display:flex}
${S} .cv2-input-wrap .cv2-form-input{width:100%;min-height:56px;padding-bottom:32px}
${S} .cv2-kind-toggle{position:absolute;left:6px;bottom:6px;display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 9px 0 7px;background:color-mix(in srgb,var(--md-on-surface) 6%,transparent);border:1px solid var(--md-outline-variant);border-radius:999px;cursor:pointer;color:var(--md-on-surface-var);font-family:var(--md-font-mono);font-size:calc(10px * var(--hc-panel-scale,1));letter-spacing:.04em;text-transform:uppercase;line-height:1;transition:background var(--md-dur-short) var(--md-easing-standard),border-color var(--md-dur-short) var(--md-easing-standard),color var(--md-dur-short) var(--md-easing-standard)}
${S} .cv2-kind-toggle:hover{background:color-mix(in srgb,var(--md-on-surface) 12%,transparent);color:var(--md-on-surface)}
${S} .cv2-kind-toggle.is-question{background:color-mix(in srgb,var(--md-secondary) 20%,transparent);border-color:color-mix(in srgb,var(--md-secondary) 45%,transparent);color:var(--md-on-surface-strong,var(--md-on-surface))}
${S} .cv2-kind-toggle:focus-visible{outline:1px solid var(--md-secondary);outline-offset:2px}
${S} .cv2-kind-toggle-label{line-height:1}
${S} .cv2-form.is-question .cv2-form-input:focus{border-color:color-mix(in srgb,var(--md-secondary) 60%,transparent);box-shadow:0 0 0 3px color-mix(in srgb,var(--md-secondary) 14%,transparent)}
${S} .cv2-filter{display:flex;gap:6px;padding:7px 10px;border-bottom:1px solid var(--md-outline-variant);flex-shrink:0}
${S} .cv2-filter-chip{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;background:transparent;border:1px solid var(--md-outline-variant);border-radius:999px;color:var(--md-on-surface-var);font-family:var(--md-font-mono);font-size:calc(10.5px * var(--hc-panel-scale,1));letter-spacing:.04em;text-transform:uppercase;cursor:pointer}
${S} .cv2-filter-chip span{color:var(--md-on-surface-faint);font-variant-numeric:tabular-nums;margin-left:2px}
${S} .cv2-filter-chip.active{background:color-mix(in srgb,var(--md-on-surface) 8%,transparent);color:var(--md-on-surface-strong);border-color:color-mix(in srgb,var(--md-on-surface) 22%,transparent)}
${S} .dot{width:6px;height:6px;border-radius:50%;display:inline-block}
${S} .dot.all{background:var(--md-on-surface-var)}
${S} .dot.q{background:var(--md-secondary)}
${S} .dot.a{background:var(--md-primary)}
${S} .dot.n{background:var(--md-tertiary)}
`

// ── sheet 6: notes-strip.tree.scss — the note cards and their nesting ─────
const CSS_TREE = `
${S} .cv2-list{display:flex;flex-direction:column;justify-content:flex-start;align-content:flex-start;padding:8px;overflow-y:auto;flex:1 1 auto;min-height:0}
${S} .cv2-col-blank{display:flex;flex-direction:column;align-items:flex-start;gap:.7rem;padding:.7rem .6rem;font-size:calc(.76rem * var(--hc-panel-scale,1));font-style:italic;line-height:1.5;color:color-mix(in srgb,var(--md-on-surface) 45%,transparent)}
${S} .cv2-col-blank .cv2-reading-edit{font-style:normal}
${S} .cv2-reading-edit{display:inline-flex;align-items:center;gap:.35rem;padding:5px 12px;border:1px solid color-mix(in srgb,var(--md-on-surface) 16%,transparent);border-radius:var(--hc-radius-control);background:transparent;color:color-mix(in srgb,var(--md-on-surface) 80%,transparent);font-family:inherit;font-size:calc(.76rem * var(--hc-panel-scale,1));cursor:pointer}
${S} .cv2-reading-edit .mat-sym{font-size:calc(15px * var(--hc-panel-scale,1))}
${S} .cv2-reading-edit:hover{border-color:rgba(126,182,214,.55);color:color-mix(in srgb,#7eb6d6 85%,white);background:rgba(126,182,214,.08)}
${S} .cv2-notes-search{display:flex;align-items:center;gap:.4rem;padding:6px 10px;border-bottom:1px solid var(--md-outline-variant);flex-shrink:0}
${S} .cv2-notes-search .mat-sym{color:color-mix(in srgb,var(--md-on-surface) 55%,transparent)}
${S} .cv2-notes-search-input{flex:1 1 auto;min-width:0;background:transparent;border:none;outline:none;color:var(--md-on-surface);font-family:inherit;font-size:calc(.8rem * var(--hc-panel-scale,1))}
${S} .cv2-notes-search-input::placeholder{color:color-mix(in srgb,var(--md-on-surface) 45%,transparent)}
${S} .cv2-cloud-empty{padding:.6rem .7rem;color:color-mix(in srgb,var(--md-on-surface) 55%,transparent);font-size:calc(.8rem * var(--hc-panel-scale,1));font-style:italic}
${S} .cv2-note{display:grid;grid-template-columns:16px 16px 1fr 20px;gap:5px;align-items:start;padding:3px 6px 3px calc(8px + var(--depth,0) * 18px);position:relative;background-color:transparent;border:none;border-radius:0;transition:background-color var(--md-dur-short) var(--md-easing-standard);
background-image:repeating-linear-gradient(to right,color-mix(in srgb,var(--md-on-surface) 13%,transparent) 0 1px,transparent 1px 18px);
background-repeat:no-repeat;background-position:8px 0;background-size:calc(var(--depth,0) * 18px) 100%}
${S} .cv2-note:hover{background-color:color-mix(in srgb,var(--md-on-surface) 5%,transparent)}
${S} .cv2-note.is-selected{background-color:color-mix(in srgb,var(--md-secondary) 12%,transparent)}
${S} .cv2-note.is-editing{background-color:color-mix(in srgb,var(--md-secondary) 10%,transparent)}
${S} .cv2-note.cv2-note-q{background-color:color-mix(in srgb,var(--md-secondary) 7%,transparent)}
${S} .cv2-note.cv2-note-a{background-color:color-mix(in srgb,var(--md-primary) 7%,transparent)}
${S} .cv2-note.is-heading{margin-top:12px;padding-top:5px}
${S} .cv2-note.is-heading .cv2-note-text{font-size:calc(.84rem * var(--hc-panel-scale,1));font-weight:600;letter-spacing:.03em;color:var(--md-on-surface)}
${S} .cv2-note.is-heading .cv2-note-mark{font-size:17px;color:var(--md-secondary)}
${S} .cv2-note.is-heading:first-child{margin-top:0}
${S} .cv2-note.is-prose .cv2-note-mark{color:color-mix(in srgb,var(--md-on-surface) 38%,transparent)}
${S} .cv2-note.is-prose .cv2-note-text{color:color-mix(in srgb,var(--md-on-surface) 78%,transparent)}
${S} .cv2-note.is-reading{background-color:color-mix(in srgb,#7eb6d6 13%,transparent);box-shadow:inset 2px 0 0 #7eb6d6}
${S} .cv2-note-mark{grid-column:1;display:inline-grid;place-items:center;flex:0 0 auto;width:19px;height:21px;clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);background:linear-gradient(160deg,rgba(126,182,214,.30),rgba(126,182,214,.08) 60%),rgba(255,255,255,.03);color:color-mix(in srgb,#7eb6d6 70%,white);font-size:12px;line-height:1;margin-right:5px;vertical-align:-4px}
${S} .cv2-note-grip{display:flex;align-items:center;justify-content:center;min-height:21px;opacity:0;cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none;transition:opacity var(--md-dur-short) var(--md-easing-standard)}
${S} .cv2-note-grip::before{content:'';width:2px;height:15px;border-radius:1px;background:color-mix(in srgb,var(--md-on-surface) 30%,transparent);transition:background var(--md-dur-short) var(--md-easing-standard)}
${S} .cv2-note:hover .cv2-note-grip{opacity:1}
${S} .cv2-note-grip:hover::before{background:color-mix(in srgb,var(--md-on-surface) 60%,transparent)}
${S} .cv2-note-grip:active{cursor:grabbing}
${S} .cv2-note-grip:active::before{background:var(--md-secondary)}
${S} .cv2-note.is-dragging{opacity:.4}
${S} .cv2-note-body{min-width:0;cursor:pointer;display:grid;grid-template-columns:auto minmax(0,1fr);align-items:start}
${S} .cv2-note-kind{grid-column:1 / -1;display:inline-flex;align-items:center;gap:5px;font-family:var(--md-font-mono);font-size:calc(9.5px * var(--hc-panel-scale,1));letter-spacing:.12em;text-transform:uppercase;color:var(--md-secondary);margin-bottom:4px}
${S} .cv2-note-kind.cv2-kind-a{color:var(--md-primary)}
${S} .cv2-note-text{grid-column:2;margin:0;font-family:var(--hc-notes-face);font-size:calc(14px * var(--hc-panel-scale,1));line-height:1.5;color:var(--md-on-surface);text-wrap:pretty;white-space:pre-wrap;overflow-wrap:anywhere}
${S} .cv2-note-q .cv2-note-text{font-style:italic;color:var(--md-on-surface-strong)}
${S} .cv2-note.is-editing .cv2-note-text{color:var(--md-on-surface-strong)}
${S} .cv2-caret{display:inline-block;width:1.5px;height:1.05em;background:var(--md-secondary);margin-left:2px;vertical-align:-2px;animation:hc-notes-strip-cv2-blink 1.1s steps(2,end) infinite}
@keyframes hc-notes-strip-cv2-blink{50%{opacity:0}}
${S} .cv2-note-kebab{background:transparent;border:0;color:var(--md-on-surface-faint);width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;border-radius:4px;cursor:pointer;opacity:0;padding:0}
${S} .cv2-note:hover .cv2-note-kebab,${S} .cv2-note-kebab.is-open{opacity:1}
${S} .cv2-note-kebab:hover,${S} .cv2-note-kebab.is-open{background:color-mix(in srgb,var(--md-on-surface) 8%,transparent);color:var(--md-on-surface)}
${S} .cv2-note-chevron,${S} .cv2-note-chevron-spacer{display:inline-flex;align-items:center;justify-content:center;width:16px;height:22px;flex-shrink:0}
${S} .cv2-note-chevron{background:transparent;border:0;padding:0;cursor:pointer;color:var(--md-on-surface-faint)}
${S} .cv2-note-chevron:hover{color:var(--md-on-surface)}
${S} .cv2-note-chevron .cv2-chevron-mark{display:inline-block;width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid currentColor;transition:transform var(--md-dur-short,.12s) var(--md-easing-standard,ease)}
${S} .cv2-note-chevron.is-collapsed .cv2-chevron-mark{transform:rotate(-90deg)}
${S} .cv2-note.is-drop-into{background:color-mix(in srgb,var(--md-secondary) 12%,transparent);outline:2px solid color-mix(in srgb,var(--md-secondary) 65%,transparent);outline-offset:-2px;border-radius:var(--hc-radius-control)}
${S} .cv2-note.is-drop-before{box-shadow:inset 0 2px 0 0 color-mix(in srgb,var(--md-secondary) 75%,transparent)}
${S} .cv2-note.is-drop-after{box-shadow:inset 0 -2px 0 0 color-mix(in srgb,var(--md-secondary) 75%,transparent)}
${S} .cv2-note.is-mark-target{background:color-mix(in srgb,var(--md-secondary) 10%,transparent);box-shadow:inset 3px 0 0 0 color-mix(in srgb,var(--md-secondary) 80%,transparent);border-radius:4px}
${S} .cv2-list.has-root-drop{box-shadow:inset 0 -3px 0 0 color-mix(in srgb,var(--md-secondary) 60%,transparent)}
${S} .cv2-kebab-menu{position:absolute;top:26px;right:6px;z-index:12;display:flex;flex-direction:column;min-width:168px;padding:4px;background:var(--md-surface-c-high);border:1px solid color-mix(in srgb,var(--md-outline-variant) 80%,transparent);border-radius:var(--hc-radius-floating);box-shadow:var(--md-elev-3);font-family:var(--md-font-ui);font-size:calc(12px * var(--hc-panel-scale,1))}
${S} .cv2-kebab-item{display:inline-flex;align-items:center;gap:8px;padding:6px 8px;background:transparent;border:0;border-radius:4px;color:var(--md-on-surface);font-family:inherit;font-size:inherit;text-align:left;cursor:pointer}
${S} .cv2-kebab-item:hover{background:color-mix(in srgb,var(--md-on-surface) 6%,transparent)}
${S} .cv2-kebab-item.cv2-kebab-danger{color:color-mix(in srgb,var(--md-error,#d33) 85%,var(--md-on-surface))}
${S} .cv2-nest-picker{position:absolute;top:26px;right:6px;z-index:12;display:flex;flex-direction:column;min-width:220px;max-height:280px;padding:4px;background:var(--md-surface-c-high);border:1px solid color-mix(in srgb,var(--md-outline-variant) 80%,transparent);border-radius:var(--hc-radius-floating);box-shadow:var(--md-elev-3);font-family:var(--md-font-ui);font-size:calc(12px * var(--hc-panel-scale,1));overflow-y:auto}
${S} .cv2-nest-picker-head{padding:4px 8px 6px;font-family:var(--md-font-mono);font-size:calc(9.5px * var(--hc-panel-scale,1));letter-spacing:.12em;text-transform:uppercase;color:var(--md-on-surface-faint)}
${S} .cv2-nest-picker-empty{padding:8px;color:var(--md-on-surface-faint);font-style:italic}
${S} .cv2-nest-picker-item{display:inline-flex;align-items:center;gap:8px;padding:6px 8px;background:transparent;border:0;border-radius:4px;color:var(--md-on-surface);font-family:inherit;font-size:inherit;text-align:left;cursor:pointer;overflow:hidden}
${S} .cv2-nest-picker-item:hover{background:color-mix(in srgb,var(--md-on-surface) 6%,transparent)}
${S} .cv2-nest-picker-mark{font-size:calc(14px * var(--hc-panel-scale,1));flex-shrink:0;color:color-mix(in srgb,var(--md-on-surface) 60%,transparent)}
${S} .cv2-nest-picker-shape{width:12px;height:12px;flex-shrink:0}
${S} .cv2-nest-picker-item:not(:has(.hc-shape-circle,.hc-shape-square,.hc-shape-triangle,.hc-shape-diamond,.hc-shape-star,.hc-shape-hexagon)) .cv2-nest-picker-shape{display:none}
${S} .cv2-nest-picker-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
${S} .cv2-note-shape{grid-column:1;margin-right:6px;align-self:flex-start;margin-top:5px}
${S} .cv2-note:not(.hc-shape-circle):not(.hc-shape-square):not(.hc-shape-triangle):not(.hc-shape-diamond):not(.hc-shape-star):not(.hc-shape-hexagon) .cv2-note-shape{display:none}
${S} .cv2-add-row{display:inline-flex;align-items:center;gap:8px;margin-top:4px;padding:8px 12px;background:transparent;border:1px dashed var(--md-outline-variant);border-radius:var(--hc-radius-control);color:var(--md-on-surface-faint);font-family:var(--md-font-mono);font-size:calc(11px * var(--hc-panel-scale,1));letter-spacing:.04em;cursor:pointer}
${S} .cv2-add-row:hover{border-color:color-mix(in srgb,var(--md-secondary) 35%,transparent);color:var(--md-on-surface-var)}
${S} .cv2-add-kbd{margin-left:auto;padding:1px 5px;background:color-mix(in srgb,var(--md-on-surface) 6%,transparent);border:1px solid var(--md-outline-variant);border-radius:3px;color:var(--md-on-surface-faint)}
`

// ── sheet 7: notes-strip.navigator.scss — the footer and the tile list ────
const CSS_NAV = `
${S} .cv2-foot{display:flex;align-items:center;gap:8px;padding:8px 12px;border-top:1px solid rgba(126,182,214,.18);background:rgba(255,255,255,.02);font-family:var(--hc-mono,monospace);font-size:calc(10.5px * var(--hc-panel-scale,1));color:var(--md-on-surface-faint);border-radius:0;letter-spacing:.04em;flex-shrink:0}
${S} .cv2-foot strong{color:var(--md-secondary);font-weight:500}
${S} .cv2-foot code{color:var(--md-secondary);background:color-mix(in srgb,var(--md-secondary) 12%,transparent);padding:0 4px;border-radius:3px}
${S} .cv2-tilelist{display:flex;flex-direction:column;min-height:0;border-top:1px solid color-mix(in srgb,var(--md-on-surface) 10%,transparent)}
${S} .cv2-tilerail{display:none;flex:1 1 auto;min-height:0;overflow:hidden}
${S} .cv2-tilelist.has-rail .cv2-tilerail{display:flex;flex-direction:column}
${S} .cv2-tilelist-filter{display:flex;align-items:center;gap:.4rem;padding:.4rem .6rem}
${S} .cv2-tilelist-filter .mat-sym{color:color-mix(in srgb,var(--md-on-surface) 55%,transparent)}
${S} .cv2-tilelist-input{flex:1 1 auto;min-width:0;background:transparent;border:none;outline:none;color:var(--md-on-surface);font-family:inherit;font-size:calc(.8rem * var(--hc-panel-scale,1))}
${S} .cv2-tilelist-input::placeholder{color:color-mix(in srgb,var(--md-on-surface) 45%,transparent)}
${S} .cv2-tilelist-clear{display:inline-flex;align-items:center;background:none;border:none;cursor:pointer;color:color-mix(in srgb,var(--md-on-surface) 55%,transparent);padding:0}
${S} .cv2-tilelist-clear:hover{color:var(--md-on-surface)}
${S} .cv2-tilecloud{display:flex;flex-flow:column nowrap;align-items:stretch;align-content:flex-start;gap:1px;padding:.15rem .35rem .6rem;overflow-y:auto;flex:1 1 auto;min-height:0}
${S} .cv2-tilechip{display:flex;align-items:center;justify-content:space-between;gap:6px;width:100%;max-width:none;line-height:1.15;padding:6px 8px 6px 10px;background:transparent;border:1px solid transparent;border-radius:4px;color:color-mix(in srgb,var(--md-on-surface) 85%,transparent);font-family:inherit;font-size:calc(.8rem * var(--hc-panel-scale,1)) !important;text-align:left;cursor:pointer;transition:background var(--md-dur-short) var(--md-easing-standard),border-color var(--md-dur-short) var(--md-easing-standard),color var(--md-dur-short) var(--md-easing-standard)}
${S} .cv2-tilechip:hover{background:color-mix(in srgb,var(--md-on-surface) 8%,transparent);border-color:color-mix(in srgb,var(--md-on-surface) 18%,transparent);color:var(--md-on-surface)}
${S} .cv2-tilechip:focus-visible{outline:1px solid var(--md-secondary);outline-offset:2px}
${S} .cv2-tilechip.is-active{background:color-mix(in srgb,var(--md-secondary) 20%,transparent);border-color:color-mix(in srgb,var(--md-secondary) 50%,transparent);color:var(--md-on-surface-strong,var(--md-on-surface))}
${S} .cv2-tilechip.is-peeked{border-color:color-mix(in srgb,#7eb6d6 55%,transparent)}
${S} .cv2-tilechip-hex{display:inline-grid;place-items:center;flex:0 0 auto;width:18px;height:20px;margin-right:2px;clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);background:linear-gradient(160deg,rgba(126,182,214,.26),rgba(126,182,214,.07) 60%),rgba(255,255,255,.03);color:color-mix(in srgb,#7eb6d6 75%,white);font-size:calc(.6rem * var(--hc-panel-scale,1));font-weight:600;line-height:1}
${S} .cv2-tilechip.is-active .cv2-tilechip-hex{background:linear-gradient(160deg,color-mix(in srgb,var(--md-secondary) 45%,transparent),transparent 65%),rgba(255,255,255,.05);color:var(--md-on-surface-strong,white)}
${S} .cv2-tilechip-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${S} .cv2-tilechip-count{flex:0 0 auto;min-width:1.2em;text-align:center;font-size:calc(.66rem * var(--hc-panel-scale,1));font-variant-numeric:tabular-nums;color:color-mix(in srgb,var(--md-on-surface) 65%,transparent);background:color-mix(in srgb,var(--md-on-surface) 12%,transparent);border-radius:3px;padding:.05rem .35rem}
${S} .cv2-tilechip.is-active .cv2-tilechip-count{color:var(--md-on-surface-strong,var(--md-on-surface));background:color-mix(in srgb,var(--md-secondary) 28%,transparent)}
${S} .cv2-tilelist-empty{list-style:none;padding:.6rem .7rem;color:color-mix(in srgb,var(--md-on-surface) 50%,transparent);font-size:calc(.78rem * var(--hc-panel-scale,1));font-style:italic}
${S} .cv2-tilelist-scopehint{display:flex;align-items:center;gap:.3rem;padding:.3rem .7rem .45rem;color:color-mix(in srgb,var(--md-on-surface) 55%,transparent);font-size:calc(.72rem * var(--hc-panel-scale,1))}
`

// ── sheet 8: notes-strip.plate.scss — the identity plate and the peek card ─
const CSS_PLATE = `
${S} .cv2-plate{display:flex;align-items:center;gap:.6rem;padding:.5rem .7rem;border-bottom:1px solid color-mix(in srgb,var(--md-on-surface) 8%,transparent);background:linear-gradient(to bottom,color-mix(in srgb,var(--md-secondary) 7%,transparent),transparent)}
${S} .cv2-plate-hex{flex:0 0 auto;position:relative;width:34px;height:39px;display:grid;place-items:center;clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);background:color-mix(in srgb,var(--md-secondary) 16%,rgba(255,255,255,.04))}
${S} .cv2-plate-img{width:100%;height:100%;object-fit:cover;display:block}
${S} .cv2-plate-initial{font-family:var(--hc-mono,system-ui);font-size:calc(1rem * var(--hc-panel-scale,1));font-weight:600;color:color-mix(in srgb,var(--md-secondary) 85%,white);line-height:1}
${S} .cv2-plate-meta{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:.15rem}
${S} .cv2-plate-name{font-size:calc(.9rem * var(--hc-panel-scale,1));font-weight:600;color:var(--md-on-surface);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${S} .cv2-plate-path{display:flex;flex-wrap:wrap;align-items:center;gap:.15rem .3rem;font-size:calc(.66rem * var(--hc-panel-scale,1));color:color-mix(in srgb,var(--md-on-surface) 48%,transparent);overflow:hidden}
${S} .cv2-plate-seg{max-width:12rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${S} .cv2-plate-seg + .cv2-plate-seg::before{content:'/';margin-right:.3rem;color:color-mix(in srgb,var(--md-on-surface) 28%,transparent)}
${S} .cv2-plate-stats{display:flex;flex-wrap:wrap;align-items:center;gap:.3rem .5rem;font-size:calc(.68rem * var(--hc-panel-scale,1));color:color-mix(in srgb,var(--md-on-surface) 62%,transparent);font-variant-numeric:tabular-nums}
${S} .cv2-plate-stat{display:inline-flex;align-items:center;gap:.3rem;white-space:nowrap}
${S} .cv2-plate-stat.is-q{color:color-mix(in srgb,var(--md-secondary) 85%,var(--md-on-surface))}
${S} .cv2-plate-stat.is-a{color:rgb(110,180,255)}
${S} .cv2-plate-stat-hex{display:inline-block;width:7px;height:8px;background:currentColor;opacity:.75;clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%)}
${S} .cv2-plate.is-wide{gap:.85rem;padding:.75rem .85rem}
${S} .cv2-plate.is-wide .cv2-plate-hex{width:62px;height:71px}
${S} .cv2-plate.is-wide .cv2-plate-initial{font-size:calc(1.7rem * var(--hc-panel-scale,1))}
${S} .cv2-plate.is-wide .cv2-plate-name{font-size:calc(1.05rem * var(--hc-panel-scale,1))}
${S} .cv2-plate.is-wide .cv2-plate-stats{font-size:calc(.72rem * var(--hc-panel-scale,1))}
${S} .cv2-peek{position:fixed;z-index:60050;pointer-events:none;width:min(360px,46vw);max-height:60vh;overflow:hidden;display:flex;flex-direction:column;padding:.45rem .55rem .5rem;background:rgba(14,14,22,.97);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid color-mix(in srgb,#7eb6d6 45%,transparent);border-radius:4px;box-shadow:0 10px 30px rgba(0,0,0,.55);font-family:var(--hc-mono,system-ui);animation:hc-notes-strip-cv2-peek-in var(--md-dur-short,140ms) var(--md-easing-standard,ease-out)}
${S} .cv2-peek.is-pinned{pointer-events:auto;border-color:color-mix(in srgb,#7eb6d6 70%,transparent);box-shadow:0 10px 34px rgba(0,0,0,.6),0 0 0 1px rgba(126,182,214,.12) inset;animation:none}
${S} .cv2-peek.is-pinned .cv2-peek-list{overflow-y:auto;min-height:0}
${S} .cv2-peek.is-pinned .cv2-peek-row{cursor:pointer;border-radius:4px;padding:.2rem .35rem}
${S} .cv2-peek.is-pinned .cv2-peek-row:hover{background:color-mix(in srgb,var(--md-on-surface) 9%,transparent)}
${S} .cv2-peek.is-pinned .cv2-peek-row.is-active{background:color-mix(in srgb,#7eb6d6 20%,transparent);box-shadow:inset 2px 0 0 0 rgba(126,182,214,.9);color:var(--md-on-surface-strong,var(--md-on-surface))}
${S} .cv2-peek.is-pinned .cv2-peek-row.is-mark-target{background:color-mix(in srgb,#7eb6d6 26%,transparent);box-shadow:inset 0 0 0 1px rgba(126,182,214,.7)}
${S} .cv2-peek-spacer{flex:1 1 auto}
${S} .cv2-peek-add{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:1px solid color-mix(in srgb,var(--md-on-surface) 18%,transparent);border-radius:4px;background:transparent;color:color-mix(in srgb,var(--md-on-surface) 65%,transparent);cursor:pointer}
${S} .cv2-peek-add:hover{border-color:rgba(126,182,214,.6);color:color-mix(in srgb,#7eb6d6 85%,white)}
@keyframes hc-notes-strip-cv2-peek-in{from{opacity:0;transform:translateX(4px)}to{opacity:1;transform:none}}
${S} .cv2-peek-head{display:flex;align-items:center;gap:.4rem;padding-bottom:.35rem;margin-bottom:.3rem;border-bottom:1px solid color-mix(in srgb,var(--md-on-surface) 10%,transparent)}
${S} .cv2-peek-head .hex-mark{font-size:calc(.75rem * var(--hc-panel-scale,1))}
${S} .cv2-peek-name{font-size:calc(.78rem * var(--hc-panel-scale,1));font-weight:600;color:var(--md-on-surface);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${S} .cv2-peek-list{list-style:none;margin:0;padding:0;min-height:0;overflow:hidden}
${S} .cv2-peek-row{display:flex;align-items:baseline;gap:.4rem;padding:.13rem 0;font-size:calc(.72rem * var(--hc-panel-scale,1));line-height:1.35;color:color-mix(in srgb,var(--md-on-surface) 80%,transparent)}
${S} .cv2-peek-row.is-q{color:color-mix(in srgb,var(--md-secondary) 80%,var(--md-on-surface))}
${S} .cv2-peek-row.is-a{color:rgb(140,195,255)}
${S} .cv2-peek-row .dot{flex:0 0 auto;transform:translateY(-1px)}
${S} .cv2-peek-mark{flex:0 0 auto;font-size:calc(13px * var(--hc-panel-scale,1));line-height:1;transform:translateY(2px);color:color-mix(in srgb,var(--md-secondary) 75%,var(--md-on-surface))}
${S} .cv2-peek-text{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${S} .cv2-peek-more,${S} .cv2-peek-empty{padding-top:.3rem;font-size:calc(.68rem * var(--hc-panel-scale,1));font-style:italic;color:color-mix(in srgb,var(--md-on-surface) 45%,transparent)}
${S} .cv2-empty-hint{padding:.7rem .8rem;color:color-mix(in srgb,var(--md-on-surface) 60%,transparent);font-size:calc(.8rem * var(--hc-panel-scale,1))}
`

/** `_notes-strip-reading-pane.scss` — ONE note given the room, at whichever
 *  scale the layout has. It was a SCSS mixin taking its sizes as arguments so
 *  the docked window and the desk could not drift apart in behaviour, colour
 *  or structure; it is one function here for exactly the same reason. Only the
 *  numbers differ between the two call sites. */
const readingPane = (scope: string, v: {
  pad: string; hexW: string; hexH: string; hexIcon: string; shape: string
  text: string; cyclePad: string; btn: string; edPad: string; edFont: string
}): string => `
${scope}{display:flex;flex-direction:column;min-width:0;min-height:0;background:radial-gradient(120% 70% at 50% 0%,rgba(126,182,214,.06),transparent 60%),rgba(9,9,15,.5)}
${scope} .cv2-reading-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column;align-items:center;text-align:center;padding:${v.pad};gap:.9rem}
${scope} .cv2-reading-scroll.is-mark-target{box-shadow:inset 0 0 0 1px rgba(126,182,214,.65);background:color-mix(in srgb,#7eb6d6 8%,transparent)}
${scope} .cv2-reading-kind{display:inline-flex;align-items:center;gap:.4rem;font-size:calc(.68rem * var(--hc-panel-scale,1));font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:color-mix(in srgb,#7eb6d6 70%,var(--md-on-surface))}
${scope} .cv2-reading-kind .mat-sym{font-size:calc(14px * var(--hc-panel-scale,1))}
${scope} .cv2-reading-kind.is-q{color:var(--md-secondary)}
${scope} .cv2-reading-kind.is-a{color:var(--md-primary)}
${scope} .cv2-reading-kind.is-prose{color:color-mix(in srgb,var(--md-on-surface) 55%,transparent)}
${scope} .cv2-reading-hex{position:relative;width:${v.hexW};height:${v.hexH};display:grid;place-items:center;clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);background:linear-gradient(160deg,rgba(126,182,214,.22),rgba(126,182,214,.05) 55%),rgba(255,255,255,.03);box-shadow:inset 0 0 0 1px rgba(126,182,214,.35)}
${scope} .cv2-reading-hex .cv2-reading-hex-icon{font-size:${v.hexIcon};color:color-mix(in srgb,#7eb6d6 80%,white)}
${scope} .cv2-reading-hex .cv2-reading-hex-shape{transform:scale(${v.shape});opacity:.85}
${scope} .cv2-reading-hex.is-q{background:linear-gradient(160deg,color-mix(in srgb,var(--md-secondary) 26%,transparent),transparent 60%),rgba(255,255,255,.03)}
${scope} .cv2-reading-hex.is-q .cv2-reading-hex-icon{color:color-mix(in srgb,var(--md-secondary) 85%,white)}
${scope} .cv2-reading-hex.is-a{background:linear-gradient(160deg,color-mix(in srgb,var(--md-primary) 26%,transparent),transparent 60%),rgba(255,255,255,.03)}
${scope} .cv2-reading-hex.is-a .cv2-reading-hex-icon{color:color-mix(in srgb,var(--md-primary) 85%,white)}
${scope} .cv2-reading-path{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:.3rem;max-width:100%;font-size:calc(.72rem * var(--hc-panel-scale,1));color:color-mix(in srgb,var(--md-on-surface) 55%,transparent)}
${scope} .cv2-reading-seg{max-width:16rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${scope} .cv2-reading-seg + .cv2-reading-seg::before{content:'\\203A';margin-right:.3rem;color:color-mix(in srgb,#7eb6d6 60%,transparent)}
${scope} .cv2-reading-text{margin:0;max-width:34rem;font-family:var(--hc-notes-face);font-size:${v.text};line-height:1.65;color:var(--md-on-surface);white-space:pre-wrap;overflow-wrap:break-word}
${scope} .cv2-reading-tags{display:flex;flex-wrap:wrap;justify-content:center;gap:.35rem;margin-top:.2rem}
${scope} .cv2-reading-tag{display:inline-flex;align-items:center;gap:.3rem;padding:2px 6px 2px 9px;font-size:calc(.72rem * var(--hc-panel-scale,1));border-radius:999px;color:color-mix(in srgb,#7eb6d6 85%,white);background:rgba(126,182,214,.12);box-shadow:inset 0 0 0 1px rgba(126,182,214,.3)}
${scope} .cv2-reading-tag-off{border:none;background:none;padding:0 2px;cursor:pointer;color:inherit;opacity:.6}
${scope} .cv2-reading-tag-off:hover{opacity:1}
${scope} .cv2-reading-tags-hint{font-size:calc(.7rem * var(--hc-panel-scale,1));color:color-mix(in srgb,var(--md-on-surface) 35%,transparent)}
${scope} .cv2-reading-cycle{flex:0 0 auto;display:flex;align-items:center;gap:.4rem;padding:${v.cyclePad};border-top:1px solid color-mix(in srgb,var(--md-on-surface) 10%,transparent)}
${scope} .cv2-reading-cycle-btn{display:grid;place-items:center;width:${v.btn};height:${v.btn};border:1px solid color-mix(in srgb,var(--md-on-surface) 16%,transparent);border-radius:var(--hc-radius-control);background:transparent;color:color-mix(in srgb,var(--md-on-surface) 75%,transparent);cursor:pointer}
${scope} .cv2-reading-cycle-btn .mat-sym{font-size:18px}
${scope} .cv2-reading-cycle-btn:hover{border-color:rgba(126,182,214,.55);color:color-mix(in srgb,#7eb6d6 80%,white);background:rgba(126,182,214,.08)}
${scope} .cv2-reading-pos{min-width:4.5rem;text-align:center;font-size:calc(.72rem * var(--hc-panel-scale,1));letter-spacing:.06em;color:color-mix(in srgb,var(--md-on-surface) 55%,transparent);font-variant-numeric:tabular-nums}
${scope} .cv2-reading-cycle-spacer{flex:1 1 auto}
${scope} .cv2-reading-edit{display:inline-flex;align-items:center;gap:.35rem;padding:5px 12px;border:1px solid color-mix(in srgb,var(--md-on-surface) 16%,transparent);border-radius:var(--hc-radius-control);background:transparent;color:color-mix(in srgb,var(--md-on-surface) 80%,transparent);font-family:inherit;font-size:calc(.76rem * var(--hc-panel-scale,1));cursor:pointer}
${scope} .cv2-reading-edit .mat-sym{font-size:calc(15px * var(--hc-panel-scale,1))}
${scope} .cv2-reading-edit:hover{border-color:rgba(126,182,214,.55);color:color-mix(in srgb,#7eb6d6 85%,white);background:rgba(126,182,214,.08)}
${scope} .cv2-reading-empty{flex:1 1 auto;display:grid;place-items:center;align-content:center;gap:.9rem;padding:1.4rem;font-size:calc(.8rem * var(--hc-panel-scale,1));text-align:center;color:color-mix(in srgb,var(--md-on-surface) 40%,transparent)}
${scope} .cv2-reading-editor{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:.8rem;padding:${v.edPad}}
${scope} .cv2-reading-editor .cv2-reading-kind{align-self:center}
${scope} .cv2-reading-editor .cv2-form{flex:1 1 auto;min-height:0;padding:0;background:none;border-bottom:none}
${scope} .cv2-reading-editor .cv2-form-input-row{flex:1 1 auto;min-height:0;flex-direction:column;align-items:stretch;gap:.75rem}
${scope} .cv2-reading-editor .cv2-input-wrap{flex:1 1 auto;min-height:0}
${scope} .cv2-reading-editor .cv2-input-wrap .cv2-form-input{height:100%;min-height:0;max-height:none;font-size:${v.edFont};line-height:1.65;padding:1rem 1.15rem 2.6rem;border-radius:var(--hc-radius-control);background:rgba(255,255,255,.02)}
${scope} .cv2-reading-editor .cv2-kind-toggle{left:10px;bottom:10px}
${scope} .cv2-reading-editor .cv2-form-submit{align-self:flex-end;padding:0 24px}
${scope} .cv2-reading-editor .cv2-form-tools{justify-content:flex-end}
`

// ── sheet 9: notes-strip.reading.scss — the pane at the docked scale ──────
const CSS_READING = readingPane(`${S}:not(.is-fullscreen) .cv2-reading`, {
  pad: '1rem 1.1rem 0.8rem',
  hexW: '64px', hexH: '74px', hexIcon: '28px', shape: '1.5',
  text: 'calc(.92rem * var(--hc-panel-scale,1))',
  cyclePad: '0.45rem 0.6rem', btn: '26px',
  edPad: '0.85rem 0.95rem 0.7rem',
  edFont: 'calc(.95rem * var(--hc-panel-scale,1))',
})

// ── sheet 10: notes-strip.lists.scss — LISTS, its own interface ───────────
const CSS_LISTS = `
${S} .cv2-listpane{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}
${S} .cv2-list-lines{flex:1 1 auto;min-height:0;overflow-y:auto;padding:.4rem .5rem .9rem}
${S} .cv2-line{display:flex;align-items:center;gap:.35rem;padding:1px 2px;border-radius:var(--hc-radius-control);margin-left:calc(min(var(--depth,0),6) * 14px)}
${S} .cv2-line:hover{background:color-mix(in srgb,var(--md-on-surface) 6%,transparent)}
${S} .cv2-line.is-editing{background:color-mix(in srgb,#7eb6d6 12%,transparent)}
${S} .cv2-line:hover .cv2-line-btn,${S} .cv2-line:hover .cv2-line-grip{opacity:1}
${S} .cv2-line.is-dragging{opacity:.4}
${S} .cv2-line.is-drop-into{background:color-mix(in srgb,var(--md-secondary) 12%,transparent);outline:2px solid color-mix(in srgb,var(--md-secondary) 65%,transparent);outline-offset:-2px}
${S} .cv2-line.is-drop-before{box-shadow:inset 0 2px 0 0 color-mix(in srgb,var(--md-secondary) 75%,transparent)}
${S} .cv2-line.is-drop-after{box-shadow:inset 0 -2px 0 0 color-mix(in srgb,var(--md-secondary) 75%,transparent)}
${S} .cv2-line-grip,${S} .cv2-line-grip-slot{flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:8px;min-height:20px}
${S} .cv2-line-grip{opacity:0;cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none;transition:opacity var(--md-dur-short) var(--md-easing-standard)}
${S} .cv2-line-grip::before{content:'';width:2px;height:13px;border-radius:1px;background:color-mix(in srgb,var(--md-on-surface) 30%,transparent)}
${S} .cv2-line-grip:active{cursor:grabbing}
${S} .cv2-line-chevron,${S} .cv2-line-chevron-spacer{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:13px;height:20px}
${S} .cv2-line-chevron{padding:0;border:0;background:transparent;color:var(--md-on-surface-faint);cursor:pointer}
${S} .cv2-line-chevron:hover{color:var(--md-on-surface)}
${S} .cv2-line-chevron .cv2-chevron-mark{display:inline-block;width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid currentColor;transition:transform var(--md-dur-short,.12s) var(--md-easing-standard,ease)}
${S} .cv2-line-chevron.is-collapsed .cv2-chevron-mark{transform:rotate(-90deg)}
${S} .cv2-line-bullet{flex:0 0 auto;width:20px;height:22px;clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);background:color-mix(in srgb,var(--md-on-surface) 9%,transparent)}
${S} .cv2-line-bullet.is-new{background:color-mix(in srgb,var(--md-on-surface) 5%,transparent)}
${S} .cv2-line-mark{display:inline-grid;place-items:center;flex:0 0 auto;width:20px;height:22px;clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);background:linear-gradient(160deg,rgba(126,182,214,.30),rgba(126,182,214,.08) 60%),rgba(255,255,255,.03);color:color-mix(in srgb,#7eb6d6 70%,white);font-size:13px;line-height:1}
${S} .cv2-line-text{flex:1 1 auto;min-width:0;padding:4px 4px;border:none;background:transparent;color:var(--md-on-surface);font-family:var(--hc-notes-face);font-size:calc(.86rem * var(--hc-panel-scale,1));line-height:1.45;text-align:left;cursor:text;overflow-wrap:break-word}
${S} .cv2-line-input{flex:1 1 auto;min-width:0;padding:4px 6px;border:none;border-bottom:1px solid rgba(126,182,214,.45);background:transparent;color:var(--md-on-surface);font-family:var(--hc-notes-face);font-size:calc(.86rem * var(--hc-panel-scale,1));line-height:1.45;outline:none}
${S} .cv2-line-input::placeholder{color:color-mix(in srgb,var(--md-on-surface) 35%,transparent)}
${S} .cv2-line-input:focus{border-bottom-color:rgba(126,182,214,.9)}
${S} .cv2-line-btn{flex:0 0 auto;display:inline-flex;align-items:center;gap:2px;padding:2px 4px;border:none;border-radius:4px;background:transparent;color:color-mix(in srgb,var(--md-on-surface) 50%,transparent);font-family:inherit;font-size:calc(.7rem * var(--hc-panel-scale,1));cursor:pointer;opacity:0;transition:opacity 90ms linear}
${S} .cv2-line-btn:focus-visible{opacity:1}
${S} .cv2-line-btn:hover{color:color-mix(in srgb,#7eb6d6 85%,white)}
${S} .cv2-line-btn.cv2-line-del:hover{color:var(--md-error,#ff6b6b)}
${S} .cv2-line-sub{flex:0 0 auto;padding-right:2px;color:color-mix(in srgb,var(--md-on-surface) 40%,transparent);font-size:calc(.68rem * var(--hc-panel-scale,1));font-variant-numeric:tabular-nums}
${S} .cv2-line.is-mark-target{background:color-mix(in srgb,#7eb6d6 18%,transparent);box-shadow:inset 0 0 0 1px rgba(126,182,214,.65)}
${S} .cv2-list-lines.has-root-drop{box-shadow:inset 0 -3px 0 0 color-mix(in srgb,var(--md-secondary) 60%,transparent)}
${S} .cv2-listfoot{flex:0 0 auto;display:flex;align-items:center;gap:.4rem;padding:.3rem .5rem;border-top:1px solid color-mix(in srgb,var(--md-on-surface) 8%,transparent)}
${S} .cv2-listfoot-btn{display:inline-flex;align-items:center;gap:.3rem;padding:2px 7px;border:1px solid transparent;border-radius:var(--hc-radius-control);background:transparent;color:color-mix(in srgb,var(--md-on-surface) 52%,transparent);font-family:inherit;font-size:calc(.72rem * var(--hc-panel-scale,1));cursor:pointer;transition:color var(--md-dur-short) var(--md-easing-standard),border-color var(--md-dur-short) var(--md-easing-standard),background var(--md-dur-short) var(--md-easing-standard)}
${S} .cv2-listfoot-btn .mat-sym{font-size:calc(15px * var(--hc-panel-scale,1))}
${S} .cv2-listfoot-btn:hover{border-color:rgba(126,182,214,.45);color:color-mix(in srgb,#7eb6d6 85%,white)}
${S} .cv2-listfoot-btn.is-danger:hover{color:var(--md-error,#ff6b6b);border-color:color-mix(in srgb,var(--md-error,#ff6b6b) 45%,transparent)}
${S} .cv2-listfoot-btn.is-danger.is-armed{color:var(--md-error,#ff6b6b);border-color:color-mix(in srgb,var(--md-error,#ff6b6b) 70%,transparent);background:color-mix(in srgb,var(--md-error,#ff6b6b) 12%,transparent)}
${S} .cv2-list-blank{flex:1 1 auto;display:grid;place-items:center;align-content:center;gap:.9rem;padding:1.4rem;text-align:center;font-size:calc(.78rem * var(--hc-panel-scale,1));color:color-mix(in srgb,var(--md-on-surface) 45%,transparent)}
${S} .cv2-note.is-open-list{background:color-mix(in srgb,#7eb6d6 12%,transparent);box-shadow:inset 2px 0 0 0 rgba(126,182,214,.85)}
`

// ── sheet 11: notes-strip.desk.scss — the fullscreen three-column desk ────
// LAST on purpose: its rules override the docked/base ones by source order as
// well as specificity, which is exactly why the concatenation order matters.
const CSS_DESK = `
@media (min-width:1024px){
${S}.is-fullscreen .notes-strip{display:grid;grid-template-columns:clamp(200px,17%,300px) minmax(0,1fr) minmax(0,1.1fr);grid-template-rows:auto auto auto minmax(0,1fr)}
${S}.is-fullscreen .cv2-dragbar{grid-column:1 / -1;grid-row:1}
${S}.is-fullscreen .cv2-tabs{grid-column:1 / -1;grid-row:2}
${S}.is-fullscreen .cv2-rail{grid-column:1 / -1;grid-row:3}
${S}.is-fullscreen .cv2-main{display:flex;flex-direction:column;grid-column:2;grid-row:4;min-width:0;min-height:0;overflow:hidden}
${S}.is-fullscreen .cv2-tilelist{grid-column:1;grid-row:4;min-width:0;border-top:none;border-right:1px solid color-mix(in srgb,var(--md-on-surface) 10%,transparent)}
${S}.is-fullscreen .cv2-plate.is-wide{gap:1.1rem;padding:1rem 1.2rem}
${S}.is-fullscreen .cv2-plate.is-wide .cv2-plate-hex{width:96px;height:110px}
${S}.is-fullscreen .cv2-plate.is-wide .cv2-plate-initial{font-size:calc(2.6rem * var(--hc-panel-scale,1))}
${S}.is-fullscreen .cv2-plate.is-wide .cv2-plate-name{font-size:calc(1.35rem * var(--hc-panel-scale,1))}
${S}.is-fullscreen .cv2-plate.is-wide .cv2-plate-path{font-size:calc(.72rem * var(--hc-panel-scale,1))}
${S}.is-fullscreen .cv2-plate.is-wide .cv2-plate-stats{font-size:calc(.78rem * var(--hc-panel-scale,1));gap:.35rem .8rem}
${readingPane(`${S}.is-fullscreen .cv2-reading`, {
  pad: '2.2rem 2.4rem 1.4rem',
  hexW: '108px', hexH: '124px', hexIcon: '46px', shape: '2.4',
  text: 'calc(1.05rem * var(--hc-panel-scale,1))',
  cyclePad: '0.55rem 0.9rem', btn: '30px',
  edPad: '1.6rem 1.8rem 1.1rem',
  edFont: 'calc(1.02rem * var(--hc-panel-scale,1))',
})}
${S}.is-fullscreen .cv2-reading{grid-column:3;grid-row:4;border-left:1px solid color-mix(in srgb,var(--md-on-surface) 10%,transparent)}
${S}.is-fullscreen .cv2-list-lines{padding:.8rem 1.2rem 1.6rem}
${S}.is-fullscreen .cv2-listfoot{padding:.45rem 1.2rem}
${S}.is-fullscreen .cv2-line{margin-left:calc(min(var(--depth,0),6) * 20px)}
${S}.is-fullscreen .cv2-line-text,${S}.is-fullscreen .cv2-line-input{font-size:calc(.95rem * var(--hc-panel-scale,1))}
}
`

// ── the conversion's own two rules ────────────────────────────────────────
//
// The base parents its settings popover to `this` — which, for this one panel,
// is the full-bleed `pointer-events:none` host rather than the panel box. The
// popover would inherit that and be un-clickable. `pointer-events` is never
// written inline by the base, so a rule wins.
const CSS_CONVERSION = `
${S} > .hc-settings,${S} > [data-hc-panel-settings-pop]{pointer-events:auto}
`

const CSS = [
  CSS_SHAPES, CSS_SHELL, CSS_FRAME, CSS_TABS, CSS_RAIL, CSS_FORM, CSS_TREE,
  CSS_NAV, CSS_PLATE, CSS_READING, CSS_LISTS, CSS_DESK, CSS_CONVERSION,
].join('\n')

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-notes-strip', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

// ── small DOM helpers ─────────────────────────────────────────────────────
const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

/** A Material Symbols ligature. It reaches the DOM through `textContent`,
 *  which cannot parse markup — the property notes-security.spec.ts pins for
 *  every converted notes view. */
const sym = (name: string, cls = 'mat-sym', hidden = true): HTMLSpanElement => {
  const s = el('span', cls, name)
  if (hidden) s.setAttribute('aria-hidden', 'true')
  return s
}

const btn = (cls: string, key: string): HTMLButtonElement => {
  const b = el('button', cls)
  b.type = 'button'
  // RESTORE FOCUS BY A KEY THIS PANEL OWNS, never by a class: two buttons in
  // one strip share a class, and restoring by the class puts the ring on the
  // first match. `data-hc-row` is also what core's focusSnapshot reads.
  b.dataset['hcRow'] = key
  return b
}

const label = (node: HTMLElement, text: string): void => {
  node.setAttribute('aria-label', text)
  node.title = text
}

/** Focus + caret across a rebuild, keyed by `data-hc-row`. core's
 *  `focusSnapshot` only carries `input[type=text]`; the composer is a
 *  TEXTAREA, and losing its caret to a `notes:changed` landing mid-sentence is
 *  exactly the failure this exists to prevent. */
type Snap = { key: string; start: number | null; end: number | null }

const isField = (n: Element | null): n is HTMLInputElement | HTMLTextAreaElement =>
  n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement

const snapshotFocus = (root: HTMLElement): Snap | null => {
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || !root.contains(active)) return null
  const key = active.dataset['hcRow']
  if (!key) return null
  if (!isField(active)) return { key, start: null, end: null }
  return { key, start: active.selectionStart, end: active.selectionEnd }
}

const putFocusBack = (root: HTMLElement, snap: Snap | null): void => {
  if (!snap) return
  // `CSS` is the stylesheet string in this module — reach the global object
  // explicitly or `CSS.escape` resolves to the string and does not compile.
  const next = root.querySelector(`[data-hc-row="${globalThis.CSS.escape(snap.key)}"]`)
  if (!(next instanceof HTMLElement)) return
  if (document.activeElement !== next) next.focus()
  if (snap.start === null || !isField(next)) return
  try { next.setSelectionRange(snap.start, snap.end ?? snap.start) }
  catch { /* not a text field any more */ }
}

/** Place `nodes` as the exact children of `parent`, in order, MOVING what it
 *  keeps rather than re-creating it.
 *
 *  `appendChild` on a node that already has a parent is a REMOVE followed by
 *  an insert, and removing a subtree containing the focused element drops
 *  focus to <body> — which, in a panel whose whole point is typing, costs a
 *  half-written note. So: sweep the departed FIRST, then walk an anchor and
 *  skip anything already in place. */
const place = (parent: HTMLElement, nodes: readonly Node[]): void => {
  const keep = new Set<Node>(nodes)
  for (const child of Array.from(parent.childNodes)) {
    if (!keep.has(child)) child.remove()
  }
  let anchor: ChildNode | null = parent.firstChild
  for (const node of nodes) {
    if (anchor === node) { anchor = node.nextSibling; continue }
    parent.insertBefore(node, anchor)
  }
}

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i])

export class NotesStripElement extends DockedPanelElement {

  // ── subscriptions and listeners, drained on disconnect ───────────────
  #offs: Array<() => void> = []
  #selectionOff: (() => void) | null = null

  // ── the panel's own state (never the DOM's) ──────────────────────────
  #activeCell: string | null = null
  #capturingFor: string | null = null
  /** Cells whose decoded-set cache has been confirmed populated. Without it a
   *  cell whose set resource has not been parsed yet returns [] from
   *  `notesFor()` and would be classified as empty before its warmup lands. */
  #warmed = new Set<string>()
  /** Resolved notes per cell, stored straight from `getNotes()` so reads never
   *  depend on the sync peek cache — on web that cache is filled lazily and
   *  may not hold participant layers at all. */
  #notesByCell = new Map<string, readonly Note[]>()
  #qaByCell = new Map<string, readonly QaItem[]>()
  #factsByCell = new Map<string, { childCount: number; propsSig: string | null }>()
  #notesServiceReady = false
  #pendingSeq = 0

  /** Master open/closed. Session-only: the strip NEVER auto-opens on selection
   *  — the control-bar toggle (`notes:panel`) and authoring are the only ways
   *  in, and a reload never brings it back on its own. */
  #open = false
  /** Put away while the hive is covered (the installer, or the lane). A flag
   *  OVER the visibility rather than a write to `#open`: the strip also shows
   *  while authoring, so clearing the toggle alone would leave a half-typed
   *  note floating on top of the installer — and the draft is exactly what has
   *  to survive the round trip. */
  #parked = false
  /** What `@if (visible())` gated. `#syncVisible()` is the ONE writer. */
  #visible = false

  #mode: 'chips' | 'rows' =
    (localStorage.getItem('hc:notes-strip-mode') as 'chips' | 'rows' | null) ?? 'rows'
  #tab: 'notes' | 'lists' =
    (localStorage.getItem('hc:annotations-tab') as 'notes' | 'lists' | null) ?? 'notes'
  #face: NotesFace = (() => {
    try {
      const stored = localStorage.getItem(NOTES_STRIP_FACE_KEY) as NotesFace | null
      return stored && (NOTES_FACES as readonly string[]).includes(stored) ? stored : 'mono'
    } catch { return 'mono' }
  })()

  #kindFilter: 'all' | 'q' | 'note' =
    (localStorage.getItem('hc:notes-strip-kind-filter') as 'all' | 'q' | 'note' | null) ?? 'all'

  // reading pane
  #readingIndex = 0
  #paneEditorOpen = false
  #deskWide = window.matchMedia('(min-width: 1024px)').matches

  // lists
  #listPathIdx: readonly number[] = []
  #newItemText = ''
  #newItemDepth = 0
  #editingItemId: string | null = null
  #itemDraft = ''
  /** An indent asked for while the line's text was still in flight, held BY
   *  POSITION until the text has been written — a retext and a move both
   *  re-sign the note and every ancestor, and the two writes race on the same
   *  layer, so nothing typed may be lost to a keypress that means "move". */
  #pendingIndent: { path: readonly number[]; delta: number } | null = null
  #listDeleteArmed = false
  #listDeleteTimer: ReturnType<typeof setTimeout> | null = null

  // the note form
  #editingNoteId: string | null = null
  #draftText = ''
  #draftKind: 'note' | 'q' = 'note'
  #draftMark: string | null = null

  // the mark palette
  #marks: readonly NoteMark[] = []
  #paletteEditing = false
  #markDragIcon: string | null = null
  #markDropTargetId: string | null = null
  #markGhostX = 0
  #markGhostY = 0
  #markDragPointerId: number | null = null
  #markDragOrigin: { x: number; y: number; icon: string } | null = null
  #markDragMoved = false

  // the tree
  #collapsed = new Set<string>()
  #kebabOpenId: string | null = null
  #pickerOpenForId: string | null = null
  #noteQuery = ''

  // fullscreen / geometry
  #fullscreen = false
  #panelOffset: { x: number; y: number } = (() => {
    try {
      const raw = localStorage.getItem(NOTES_STRIP_OFFSET_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown }
        if (parsed && typeof parsed.x === 'number' && typeof parsed.y === 'number') {
          return { x: parsed.x, y: parsed.y }
        }
      }
    } catch { /* corrupt entry — fall through */ }
    return { x: 0, y: 0 }
  })()
  /** 'right' = snapped to the right-edge rail, null = floating. NOT the base's
   *  `dockSide` (which is the EDGE this window belongs to and never changes). */
  #dockMode: 'right' | null = (() => {
    try {
      const raw = localStorage.getItem(NOTES_STRIP_DOCK_KEY)
      if (raw === 'float') return null
      if (raw === 'right') return 'right'
    } catch { /* corrupt entry — fall through */ }
    return 'right'
  })()

  #dragPointerId: number | null = null
  #dragStart: { px: number; py: number; ox: number; oy: number } | null = null
  #dragMoved = false
  #dragModeActive = false

  #resizePointerId: number | null = null
  #resizeStart: { px: number; py: number; w: number; h: number } | null = null
  #resizeEdge: 'corner' | 'left' | 'bottom' = 'corner'

  // note-row drag
  #noteDragSourceId: string | null = null
  #noteDragSourceCell: string | null = null
  #noteDropTargetId: string | null = null
  #noteDropMode: 'before' | 'into' | 'after' | 'root' | null = null
  #noteDragPointerId: number | null = null
  #noteDragScope: HTMLElement | null = null

  // the tile navigator
  #layerCellLabels: readonly string[] = []
  #renderedCellLabels: readonly string[] = []
  #tagFilterActive = false
  #searchFilterActive = false
  #filterText = ''
  #rail: TilesRailLike | null = null
  #railMounted = false

  // the peek card
  #hoverCell: string | null = null
  #hoverLeft: number | null = null
  #hoverRight: number | null = null
  #hoverTop = 0
  #hoverOpenTimer: ReturnType<typeof setTimeout> | null = null
  #hoverCloseTimer: ReturnType<typeof setTimeout> | null = null

  // the identity plate
  #panelWidth = NOTES_STRIP_BASE_WIDTH
  #plateImage: string | null = null
  #plateImageUrl: string | null = null
  #plateImageCell: string | null = null
  #plateToken = 0

  /** The last width the strip was DOCKED at — seeded from the store so the
   *  first read is right before the observer has fired once. Fullscreen is the
   *  DESK: reporting its box would let a group's mates adopt a 1500px width,
   *  and would make the gear's AUTO text size read the desk, not the dock. */
  #dockWidth = (() => {
    try {
      const raw = localStorage.getItem(NOTES_STRIP_WIDTH_KEY)
      const n = raw ? parseInt(raw, 10) : NaN
      if (Number.isFinite(n) && n > 0) return n
    } catch { /* ignore */ }
    return NOTES_STRIP_BASE_WIDTH
  })()
  /** The width the GROUP last saw, so the observer's report of a width we were
   *  handed is not republished back at the mates (which would creep the group
   *  a couple of pixels wider on every hop). */
  #sharedWidth = 0

  #resizeObserver: ResizeObserver | null = null
  #observingEl: HTMLElement | null = null
  #applyingDimensions = false
  #insetOwner = 'notes-strip-inset'
  #insetRo: ResizeObserver | null = null
  #insetRaf = 0
  #laneOffset = 0
  #hoverActive = false

  // Input-mode stack participation. The mode mounts no listeners; its presence
  // on TOP of the stack is what suspends the hex grid's wheel-zoom below it, so
  // scrolling the notes never bleeds into zooming the hexagons.
  readonly #notesHoverMode: InputModeLike = {
    name: 'notes-hover',
    mount: (): void => { /* no listeners — suspension is structural */ },
    unmount: (): void => { /* nothing to tear down */ },
  }
  readonly #notesDragMode: InputModeLike = {
    name: 'notes-drag',
    mount: (): void => { /* no listeners — suspension is structural */ },
    unmount: (): void => { /* nothing to tear down */ },
  }

  // ── chrome, built once per activation ────────────────────────────────
  #panelEl: HTMLElement | null = null
  #dragbarEl: HTMLElement | null = null
  #dragTitleEl: HTMLElement | null = null
  #readerBtn: HTMLButtonElement | null = null
  #fullscreenBtn: HTMLButtonElement | null = null
  #hideBtn: HTMLButtonElement | null = null
  #tabsEl: HTMLElement | null = null
  #tabNotesBtn: HTMLButtonElement | null = null
  #tabListsBtn: HTMLButtonElement | null = null
  #railEl: HTMLElement | null = null
  #mainEl: HTMLElement | null = null
  #readingEl: HTMLElement | null = null
  #tileListEl: HTMLElement | null = null
  #railHostEl: HTMLElement | null = null
  #ghostEl: HTMLElement | null = null
  #peekEl: HTMLElement | null = null
  // PERSISTENT surfaces — rebuilding these would take a caret or a scroll
  // position the participant put there.
  #formEl: HTMLFormElement | null = null
  #formInput: HTMLTextAreaElement | null = null
  #formSubmit: HTMLButtonElement | null = null
  #formKindBtn: HTMLButtonElement | null = null
  #formKindDot: HTMLElement | null = null
  #formKindLabel: HTMLElement | null = null
  #formToolsEl: HTMLElement | null = null
  #listEl: HTMLElement | null = null
  #linesEl: HTMLElement | null = null
  #newLineRow: HTMLElement | null = null
  #newLineInput: HTMLInputElement | null = null
  #readScrollEl: HTMLElement | null = null
  #tileCloudEl: HTMLElement | null = null
  #tileFilterInput: HTMLInputElement | null = null
  /** The pane's two containers are persistent for the same reason the form and
   *  the new-line input are: they PARENT them. Rebuilding a container moves its
   *  children, and moving a subtree that holds the focused element drops focus
   *  to <body> — which, mid-sentence, costs the sentence. */
  #paneEditorBox: HTMLElement | null = null
  #listPaneEl: HTMLElement | null = null

  constructor() {
    super()
    // Same panel id the Angular `hcDockedPanel="notes-strip"` carried — the key
    // the participant's text size, code font and group membership hang off.
    // (The WIDTH is this window's own store, `hc:notes-strip-width`; see the
    // header on the `ownsSize:false` path.)
    this.panelId = 'notes-strip'
    this.dockSide = 'right'
    this.minWidth = 256
    this.maxWidth = 900
    this.defaultWidth = NOTES_STRIP_BASE_WIDTH
    this.defaultText = 1
    this.pairWindow = 'tags-viewer'
    this.pairOpenEffect = 'tags:view-open'
    this.pairCloseEffect = 'tags:view-close'
    this.ownSettings = () => this.settingsRows()
    // Registry-fed: mounted once at boot, engaged only when something opens it.
    this.autoActivate = false
    // The inset is reported for the PANEL, not for this full-bleed host — the
    // base would measure `this`, see a box spanning the viewport, and (rightly,
    // for a full-bleed sheet) report nothing at all.
    this.insetActive = false
    const session: WindowSession = {
      park: () => { this.#parked = true; this.#syncVisible(); this.#announceOpen() },
      unpark: () => { this.#parked = false; this.#syncVisible(); this.#announceOpen() },
      dismiss: () => this.dismiss(),
      close: () => this.hide(),
    }
    this.session = session
    // The fullscreen desk consumes `--hc-inset-right` (its right edge yields to
    // a docked toolwindow — the pheromones panel opens BESIDE the desk). The
    // singleton is normally started by shell bootstrap; calling it here costs
    // nothing and keeps the desk correct if that ordering ever changes.
    ensureViewportInsetVars()
  }

  // ── the size this window OWNS (the directive's `ownsSize:false`) ──────

  /** Current width in px — the DOCKED width, always. */
  panelWidth(): number { return this.#dockWidth }

  /** Take a width from the group. Clamped and persisted exactly as the edge
   *  drag does; the store stays this window's, which is the whole point of
   *  owning the size. Ignored while fullscreen, where the width is forced by
   *  the desk and would be written back as a preference nobody set. */
  setPanelWidth(width: number): void {
    if (this.#fullscreen) return
    const el2 = this.#panelEl
    const max = Math.max(MIN_PANEL_WIDTH, window.innerWidth - 32)
    const next = Math.round(Math.max(MIN_PANEL_WIDTH, Math.min(width, max)))
    if (next === this.#dockWidth && el2?.style.width) return
    this.#dockWidth = next
    if (el2) el2.style.width = `${next}px`
    this.#measurePanel()
    try { localStorage.setItem(NOTES_STRIP_WIDTH_KEY, String(next)) } catch { /* ignore */ }
  }

  /** What this window contributes to its group. The base publishes ITS width —
   *  the one it restored for a panel it sizes — so only that field is replaced;
   *  text, code font, reading face and ligatures stay the base's to report. */
  override attrs(): GroupAttrs {
    return { ...super.attrs(), width: this.panelWidth() }
  }

  /** What the window inboard of this one sits at. */
  override laneWidth(): number { return this.panelWidth() || this.offsetWidth }

  /** Take the group's settings. Width is split off and handed to THIS window's
   *  machinery — writing the base's key too would leave two stores disagreeing
   *  about one window — and the rest goes to the base unchanged. */
  override adopt(attrs: GroupAttrs): void {
    const { width, ...rest } = attrs
    super.adopt(rest)
    if (width === undefined) return
    this.setPanelWidth(width)
    // Record what the window ACTUALLY became, so the resize this just caused
    // arrives at the observer as a width it already knows and is not
    // republished. (A flag cleared on a timer would not do: in a backgrounded
    // tab the timer never runs and the window stops sharing.)
    this.#sharedWidth = this.panelWidth()
    this.#applyOwnScale()
    this.#relayoutLane()
  }

  /** Sit this far in from the edge. The base writes this onto `this`; here the
   *  PANEL is what has to move, and the host must keep its full-bleed box. */
  override placeInLane(offset: number): void {
    this.#laneOffset = Math.max(0, Math.round(offset))
    this.#positionPanel()
  }

  #positionPanel(): void {
    const p = this.#panelEl
    if (!p) return
    // A `calc` over the controls-bar reservation rather than a resolved number,
    // so a bar that docks, undocks or changes width keeps the lane beside it
    // with no re-layout.
    p.style.right = `calc(var(--hc-controls-right, 0px) + ${this.#laneOffset}px)`
    p.style.setProperty('--hc-lane-offset', `${this.#laneOffset}px`)
  }

  #clearPanelPlacement(): void {
    this.#laneOffset = 0
    this.#panelEl?.style.removeProperty('right')
    this.#panelEl?.style.removeProperty('--hc-lane-offset')
  }

  #relayoutLane(): void {
    if (this.#visible && this.#dockExclusiveWanted()) layoutLane(this.dockSide)
  }

  #dockExclusiveWanted(): boolean {
    return this.#dockMode === 'right' && !this.#fullscreen
  }

  #syncDockExclusive(): void {
    this.setDockExclusive(this.#dockExclusiveWanted())
    if (this.#dockExclusiveWanted()) this.#positionPanel()
    else this.#clearPanelPlacement()
  }

  /** `--hc-panel-scale`, restated from the width this window actually has.
   *
   *  The base derives the AUTO multiplier from the width it restored for a
   *  panel it sizes — 500 here, always — so Auto would be frozen at 1.0. The
   *  Angular directive asked its `sizeOwner` for the same number
   *  (`#measuredWidth`), and this is that call. Same formula, same single
   *  decision point, fed the right width. */
  #applyOwnScale(): void {
    const groupAttrs = this.group ? readGroupAttrs(this.group) : {}
    const own = readTextScale(this.panelId)
    const text = ('text' in groupAttrs)
      ? (groupAttrs.text ?? null)
      : (own === undefined ? this.defaultText : own)
    const auto = (this.panelWidth() || this.defaultWidth) / this.defaultWidth
    const scale = Math.min(this.maxScale, Math.max(this.minScale, text ?? auto))
    this.style.setProperty('--hc-panel-scale', String(scale))
  }

  // ── lifecycle ────────────────────────────────────────────────────────
  //
  // The Angular component was CONSTRUCTED once at boot and lived while hidden
  // (the `@if` was in its template, not around the class), so its warmup, its
  // selection tracking and every EffectBus subscription ran whether the strip
  // was on screen or not. `connectedCallback` is that constructor and
  // `disconnectedCallback` is `ngOnDestroy`; `activate()` / `deactivate()` are
  // the `@if`.
  override connectedCallback(): void {
    super.connectedCallback()   // autoActivate is false — this engages nothing
    installCss()
    this.setPairWhen(this.#fullscreen)   // pairWhen="isFullscreen()" — false at boot

    this.#wireLineage()
    this.#wireSynchronize()
    this.#wireProviders()
    this.#wireEffects()
    this.#wireViewport()

    this.#refreshLayerCellLabels()
    this.#warmup()

    // Stale legacy key — the pinned-tools palette is gone. One-time wipe.
    try { localStorage.removeItem('hc:notes-strip-pinned-tools') } catch { /* ignore */ }

    this.#announceOpen()
  }

  override disconnectedCallback(): void {
    for (const off of this.#offs) { try { off() } catch { /* noop */ } }
    this.#offs = []
    this.#selectionOff?.()
    this.#selectionOff = null
    this.#releaseGestures()
    this.#teardownInset()
    this.#clearHoverTimers()
    if (this.#listDeleteTimer) { clearTimeout(this.#listDeleteTimer); this.#listDeleteTimer = null }
    // Object-URLs are ours to release — a remount otherwise leaks a blob per
    // tile visited.
    this.#plateToken++
    this.#revokePlateImage()
    this.#resizeObserver?.disconnect()
    this.#resizeObserver = null
    this.#observingEl = null
    this.#rail?.dispose()
    this.#rail = null
    this.#railMounted = false
    this.#popNotesMode()
    super.disconnectedCallback()   // → deactivate(): lane, session, gear, children
    this.#visible = false
    this.classList.remove('open')
    this.#forgetChrome()
  }

  /** Visible whenever the strip is explicitly open (the control-bar toggle) or
   *  the participant is authoring — and never while parked. Copied as WRITTEN:
   *  `!parked && (open || !!capturing)`, not re-derived by negation. */
  #syncVisible(): void {
    const want = !this.#parked && (this.#open || !!this.#capturingFor)
    if (want === this.#visible) return
    if (want) this.#showPanel()
    else this.#hidePanel()
  }

  #showPanel(): void {
    if (this.#visible) return
    this.#visible = true
    this.classList.add('open')
    this.activate()          // renderPanel + lane + session + gear + dismisser
    this.#afterActivate()
  }

  #hidePanel(): void {
    if (!this.#visible) return
    this.#visible = false
    this.classList.remove('open')
    this.#releaseGestures()
    this.#popNotesMode()
    this.#teardownInset()
    this.deactivate()        // clears the children — rebuild-on-open, like @if
    // Forget FIRST: `#syncPanelResize` decides by reading the panel, and a
    // detached node still answers `classList.contains('mode-rows')` — it would
    // re-observe a box that is no longer in the document.
    this.#forgetChrome()
    this.#syncPanelResize()
  }

  /** Undo the three things DockedPanelElement does to a host that is not the
   *  panel, and put the gear where the base's own header branch would have.
   *
   *  The base cannot find this window's header — `:scope > .cv2-dragbar` needs
   *  a direct child, and here the dragbar is a grandchild — so it falls to its
   *  "no header" branch and parks the gear at the host's inner corner. */
  #afterActivate(): void {
    // 1. the inline width / lane offset the base wrote on the HOST.
    this.style.removeProperty('width')
    this.style.removeProperty(this.dockSide)
    this.style.removeProperty('--hc-lane-offset')

    // 2. the resize grip on the host's inner edge — this window has its own
    //    edge handles (`.cv2-resize-edge-left` is the live one when docked).
    this.querySelector(':scope > [data-hc-grip]')?.remove()

    // 3. the settings gear, re-homed into the dragbar exactly as the base's
    //    header branch does it: absolutely positioned just inboard of the
    //    close button, with the close button nudged over to make room.
    const gear = this.querySelector(':scope > [data-hc-panel-settings]')
    const header = this.#dragbarEl
    if (gear instanceof HTMLElement && header) {
      const style = getComputedStyle(header)
      if (style.position === 'static') header.style.position = 'relative'
      const pad = parseFloat(style.paddingRight) || 0
      const close = this.#hideBtn
      let inset = pad
      if (close) {
        inset = pad + (close.offsetWidth || 28) + 4
        close.style.marginLeft = '32px'
      }
      gear.style.removeProperty('left')
      gear.style.removeProperty('right')
      Object.assign(gear.style, {
        position: 'absolute', right: `${inset}px`, top: '50%', transform: 'translateY(-50%)',
      } as Partial<CSSStyleDeclaration>)
      header.appendChild(gear)
      // The base anchors the popover against `this` (the host) and reads
      // `2.6rem` from the host's top — right when the panel is flush to it
      // (docked, fullscreen), wrong for a FLOAT, which sits wherever it was
      // dropped. Its `right` is already correct in every mode: the host's right
      // edge is the viewport's, which is the frame the gear was measured in.
      // The listener runs AFTER the base's on the same node (the base calls
      // stopPropagation, not stopImmediatePropagation).
      // No teardown entry: `deactivate()` clears the host's children, so the
      // gear node — and this listener with it — goes when the panel closes.
      gear.addEventListener('click', this.#onGearClicked)
    }

    // The base wrote `--hc-panel-scale` from a width it does not own.
    this.#applyOwnScale()
    this.#sharedWidth = this.panelWidth()
    this.#syncDockExclusive()
    this.#installInset()
    this.#syncPanelResize()
    this.#render()
    this.#syncRail()
    queueMicrotask(() => { this.#anchorPinnedCard(); this.#measurePanel() })
  }

  #onGearClicked = (): void => {
    queueMicrotask(() => {
      const pop = this.querySelector(':scope > [data-hc-panel-settings-pop]')
      const panel = this.#panelEl
      if (!(pop instanceof HTMLElement) || !panel) return
      const hostTop = this.getBoundingClientRect().top
      const panelTop = panel.getBoundingClientRect().top
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      pop.style.top = `${Math.round(panelTop - hostTop + rem * 2.6)}px`
      // A settings pick re-runs the base's own scale write on the way past.
      this.#applyOwnScale()
    })
  }

  /** DockedPanelElement's close verb — `(hcDockedPanelClose)="hide()"`. */
  protected override closePanel(): void { this.hide() }

  #forgetChrome(): void {
    this.#panelEl = null; this.#dragbarEl = null; this.#dragTitleEl = null
    this.#readerBtn = null; this.#fullscreenBtn = null; this.#hideBtn = null
    this.#tabsEl = null; this.#tabNotesBtn = null; this.#tabListsBtn = null
    this.#railEl = null; this.#mainEl = null; this.#readingEl = null
    this.#tileListEl = null; this.#ghostEl = null; this.#peekEl = null
    this.#formEl = null; this.#formInput = null; this.#formSubmit = null
    this.#formKindBtn = null; this.#formKindDot = null; this.#formKindLabel = null
    this.#formToolsEl = null
    this.#listEl = null; this.#linesEl = null
    this.#newLineRow = null; this.#newLineInput = null
    this.#readScrollEl = null; this.#tileCloudEl = null; this.#tileFilterInput = null
    this.#paneEditorBox = null; this.#listPaneEl = null
    // The rail's host goes with the chrome, so the rail itself must go too —
    // a live rail pointed at a detached box would never paint again.
    if (this.#railHostEl) { this.#rail?.dispose(); this.#rail = null; this.#railMounted = false }
    this.#railHostEl = null
  }

  // ══ chrome — built once per activation ═══════════════════════════════
  //
  // The panel box, its five bands and the two host-level siblings. Everything
  // inside the bands is rebuilt by `#render()`; the nodes held as fields here
  // are the ones a rebuild must never take.
  protected override renderPanel(): void {
    const panel = el('div', 'notes-strip cv2-panel')
    panel.setAttribute('data-consumes-wheel', '')
    panel.setAttribute('role', 'list')
    panel.addEventListener('pointerenter', this.#onNotesEnter)
    panel.addEventListener('pointerleave', this.#onNotesLeave)

    // ── the dragbar: which tile, which list, and the window's own buttons ──
    const bar = el('div', 'cv2-dragbar')
    bar.addEventListener('pointerdown', this.#onDragStart)
    bar.addEventListener('dblclick', this.#onDragbarDoubleClick)

    const title = el('span', 'cv2-dragbar-title')
    const spacer = el('span', 'cv2-dragbar-spacer')

    const reader = btn('cv2-mini-btn', 'dragbar-reader')
    reader.appendChild(sym('menu_book', 'mat-sym', false))
    reader.addEventListener('click', () => this.openReader())

    const full = btn('cv2-mini-btn', 'dragbar-fullscreen')
    full.appendChild(sym('open_in_full', 'mat-sym', false))
    full.addEventListener('click', () => this.toggleFullscreen())

    const hide = btn('cv2-mini-btn', 'dragbar-hide')
    hide.appendChild(sym('close', 'mat-sym', false))
    hide.addEventListener('click', () => this.hide())

    bar.append(title, spacer, full, hide)

    // ── the annotations tabs ──
    const tabs = el('div', 'cv2-tabs')
    tabs.setAttribute('role', 'tablist')
    const tabNotes = btn('cv2-tab', 'tab-notes')
    tabNotes.setAttribute('role', 'tab')
    tabNotes.addEventListener('click', () => this.setTab('notes'))
    const tabLists = btn('cv2-tab', 'tab-lists')
    tabLists.setAttribute('role', 'tab')
    tabLists.addEventListener('click', () => this.setTab('lists'))
    tabs.append(tabNotes, tabLists)

    // ── the mark rail (attached only while a tile is active) ──
    const rail = el('div', 'cv2-rail')

    // ── the three content bands ──
    const main = el('div', 'cv2-main')
    const reading = el('aside', 'cv2-reading')
    const tileList = el('div', 'cv2-tilelist')

    // The rail's host must survive every rebuild: the tiles rail mounts its own
    // DOM into it, and `#mountRail` will not mount twice.
    const railHost = el('div', 'cv2-tilerail')

    // ── the invisible edge handles ──
    const edgeLeft = el('span', 'cv2-resize-edge cv2-resize-edge-left')
    edgeLeft.setAttribute('aria-hidden', 'true')
    edgeLeft.addEventListener('pointerdown', (e) => this.#onResizeStart(e, 'left'))
    const edgeBottom = el('span', 'cv2-resize-edge cv2-resize-edge-bottom')
    edgeBottom.setAttribute('aria-hidden', 'true')
    edgeBottom.addEventListener('pointerdown', (e) => this.#onResizeStart(e, 'bottom'))
    const handle = el('span', 'cv2-resize-handle')
    handle.setAttribute('aria-hidden', 'true')
    handle.addEventListener('pointerdown', (e) => this.#onResizeStart(e, 'corner'))

    panel.append(bar, tabs, main, reading, tileList, edgeLeft, edgeBottom, handle)

    // The GHOST and the PEEK card are deliberately SIBLINGS of the panel: the
    // panel carries `backdrop-filter`, which makes it the containing block for
    // fixed-position descendants, and both of these are positioned in raw
    // viewport coordinates. Inside the panel they would drift by its top-left.
    const ghost = el('span', 'cv2-mark-ghost mat-sym')
    ghost.setAttribute('aria-hidden', 'true')

    this.append(panel)

    this.#panelEl = panel
    this.#dragbarEl = bar
    this.#dragTitleEl = title
    this.#readerBtn = reader
    this.#fullscreenBtn = full
    this.#hideBtn = hide
    this.#tabsEl = tabs
    this.#tabNotesBtn = tabNotes
    this.#tabListsBtn = tabLists
    this.#railEl = rail
    this.#mainEl = main
    this.#readingEl = reading
    this.#tileListEl = tileList
    this.#railHostEl = railHost
    this.#ghostEl = ghost

    this.#buildForm()
    this.#buildNewLineRow()

    // Geometry the CSS cannot express: the participant's stored width, the
    // dock class and the float transform.
    panel.classList.toggle('mode-chips', this.#mode === 'chips')
    panel.classList.toggle('mode-rows', this.#mode === 'rows')
    panel.classList.toggle('dock-right', this.#dockMode === 'right')
    panel.dataset['face'] = this.#face
    this.#applyPanelTransform()
    this.#relabel()
  }

  /** The ONE authoring surface, built once and MOVED between its two mount
   *  points (the centre column, or the pane on the desk and in the docked
   *  stack). Angular defined it once as an `ng-template` for the same reason;
   *  here it must also be the same NODE, because re-creating it mid-sentence
   *  would take the caret and the undo stack with it. */
  #buildForm(): void {
    const form = el('form', 'cv2-form')
    form.addEventListener('submit', (e) => { e.preventDefault(); this.commitForm() })

    const row = el('div', 'cv2-form-input-row')
    const wrap = el('div', 'cv2-input-wrap')

    const area = el('textarea', 'cv2-form-input')
    area.rows = 1
    area.dataset['hcRow'] = 'form-input'
    area.addEventListener('input', () => this.#onFormInput())
    area.addEventListener('keydown', (e) => this.#onFormKeydown(e))

    const kind = btn('cv2-kind-toggle', 'form-kind')
    const dot = el('span', 'dot')
    const kindLabel = el('span', 'cv2-kind-toggle-label')
    kind.append(dot, kindLabel)
    kind.addEventListener('click', () => this.toggleDraftKind())

    wrap.append(area, kind)

    const submit = el('button', 'cv2-form-submit')
    submit.type = 'submit'
    submit.dataset['hcRow'] = 'form-submit'

    row.append(wrap, submit)

    const tools = el('div', 'cv2-form-tools')
    const toolSpacer = el('span', 'cv2-toolbar-spacer')
    const cancel = btn('cv2-form-cancel', 'form-cancel')
    cancel.append(sym('close'), el('span'))
    cancel.addEventListener('click', () => this.cancelEdit())
    tools.append(toolSpacer, cancel)

    form.append(row)

    this.#formEl = form
    this.#formInput = area
    this.#formSubmit = submit
    this.#formKindBtn = kind
    this.#formKindDot = dot
    this.#formKindLabel = kindLabel
    this.#formToolsEl = tools
  }

  /** The line that is always open. It never closes — a commit clears it and
   *  leaves the caret in it, so the next line is just more typing. That makes
   *  it the single most focus-sensitive node in the panel: it is built once and
   *  only ever MOVED into place at the end of the list. */
  #buildNewLineRow(): void {
    const row = el('div', 'cv2-line is-new')
    const gripSlot = el('span', 'cv2-line-grip-slot')
    gripSlot.setAttribute('aria-hidden', 'true')
    const chevSpacer = el('span', 'cv2-line-chevron-spacer')
    chevSpacer.setAttribute('aria-hidden', 'true')
    const bullet = el('span', 'cv2-line-bullet is-new')
    bullet.setAttribute('aria-hidden', 'true')
    const input = el('input', 'cv2-line-input')
    input.type = 'text'
    input.dataset['hcRow'] = 'new-line'
    input.addEventListener('input', () => { this.#newItemText = input.value })
    input.addEventListener('keydown', (e) => this.#onNewItemKeydown(e))
    row.append(gripSlot, chevSpacer, bullet, input)
    this.#newLineRow = row
    this.#newLineInput = input
  }

  /** Re-resolve the strings written ONCE per activation — the ones no region
   *  rebuild touches. THE PIPE WAS IMPURE: Angular's `t` re-resolved every
   *  string on every change-detection tick, so `/language ja` re-labelled an
   *  OPEN panel on the spot. An element renders when it decides to, so the
   *  locale switch has to be a reason to render — and the strings that are not
   *  in any rebuilt region need this. */
  #relabel(): void {
    this.#panelEl?.setAttribute('aria-label', t('notes.strip.aria', 'notes for the active tile'))
    this.#tabsEl?.setAttribute('aria-label', t('annotations.title', 'annotations'))
    this.#readingEl?.setAttribute('aria-label', t('notes.viewer.aria', 'notes reader'))
    if (this.#readerBtn) label(this.#readerBtn, t('notes.read', 'read these notes'))
    if (this.#hideBtn) label(this.#hideBtn, t('notes.hide', 'hide notes'))
    if (this.#tabNotesBtn) this.#tabNotesBtn.textContent = t('annotations.tab.notes', 'notes')
    if (this.#tabListsBtn) this.#tabListsBtn.textContent = t('annotations.tab.lists', 'lists')
    if (this.#newLineInput) {
      const hint = t('notes.lists.addLine', 'add a line — press Enter')
      this.#newLineInput.placeholder = hint
      this.#newLineInput.setAttribute('aria-label', hint)
    }
    // The pair label the gear shows for "Open Pheromones alongside".
    this.pairLabel = t('tags.viewer.title', 'Pheromones')
  }

  // ══ derived readings (the Angular computeds, as methods) ═════════════

  /** The tile whose notes the editor shows — the capture target wins (so
   *  authoring always targets the right tile), else the cell last activated by
   *  clicking it on the canvas or in the tile list. */
  cell(): string | null { return this.#capturingFor ?? this.#activeCell }

  /** Classify a note by its legacy text prefix. `[Q] …` is a question carried
   *  over from the pre-qa-slot era; `[A:<qId>] …` is its paired answer. */
  noteKind(note: Note): 'q' | 'a' | 'note' {
    const raw = (note?.text ?? '').trimStart()
    if (raw.startsWith('[Q]')) return 'q'
    if (raw.startsWith('[A:') || raw.startsWith('[A ')) return 'a'
    return 'note'
  }

  /** Strip the legacy `[Q]` / `[A:<qId>]` prefix from the DISPLAYED text — the
   *  kind styling already says what the row is. The raw text is kept. */
  noteDisplayText(note: Note): string {
    const raw = (note?.text ?? '')
    const trimmed = raw.trimStart()
    if (trimmed.startsWith('[Q]')) return trimmed.slice(3).trimStart()
    const aMatch = /^\[A:[^\]]*\]\s*/.exec(trimmed) || /^\[A\s[^\]]*\]\s*/.exec(trimmed)
    if (aMatch) return trimmed.slice(aMatch[0].length)
    return raw
  }

  /** Merge open qa-slot questions with the cell's notes into one display list.
   *  qa items come FIRST as synthetic notes (`id = 'qa:<qId>'`, text `[Q] …`
   *  so the existing kind/styling picks them up); any legacy `[Q] …` note whose
   *  text matches a qa entry is DROPPED — the slot is canonical and surfacing
   *  both repeats the question in the comm channel. */
  #mergeQaWithNotes(qa: readonly QaItem[], notes: readonly Note[]): readonly Note[] {
    const qaTexts = new Set(qa.map(q => q.question.trim()))
    const synthetic: Note[] = qa.map(q => ({
      id: 'qa:' + q.qId, text: '[Q] ' + q.question, shape: null, mark: null, children: [],
    }))
    const filtered = notes.filter(n => {
      const raw = (n.text ?? '').trimStart()
      if (!raw.startsWith('[Q]')) return true
      return !qaTexts.has(raw.slice(3).trim())
    })
    return [...synthetic, ...filtered]
  }

  /** The active tile's full entry list — UNFILTERED, unlike `notes()`. The
   *  plate's counts describe the tile, not the current filter. */
  #allForCell(cell: string | null): readonly Note[] {
    if (!cell) return []
    return this.#mergeQaWithNotes(this.#qaByCell.get(cell) ?? [], this.#notesByCell.get(cell) ?? [])
  }

  /** True when any visible cell carries an unanswered question. Only Claude
   *  authors questions, so a notes view with none drops the filter row — "All"
   *  and "Notes" would be identical tabs otherwise. */
  hasQuestions(): boolean {
    const c = this.cell()
    if (!c) return false
    if ((this.#qaByCell.get(c)?.length ?? 0) > 0) return true
    return (this.#notesByCell.get(c) ?? []).some(n => this.noteKind(n) === 'q')
  }

  /** A saved `'q'` preference falls through to `'all'` when there are no
   *  questions to filter — otherwise hiding the filter row would strand the
   *  participant with an empty list. The saved preference is untouched, so it
   *  snaps back the moment the next question arrives. */
  #effectiveFilter(): 'all' | 'q' | 'note' {
    return (this.#kindFilter === 'q' && !this.hasQuestions()) ? 'all' : this.#kindFilter
  }

  #passesFilter(kind: 'q' | 'a' | 'note'): boolean {
    const f = this.#effectiveFilter()
    if (f === 'all') return true
    if (f === 'q') return kind === 'q'
    // 'note' — every non-question entry (answers count as notes, per the
    // "resolved-Q notes are just notes" rule).
    return kind !== 'q'
  }

  notes(): readonly Note[] {
    const cell = this.cell()
    if (!cell) return []
    const merged = this.#mergeQaWithNotes(
      this.#qaByCell.get(cell) ?? [], this.#notesByCell.get(cell) ?? [])
    return merged.filter(n => this.#passesFilter(this.noteKind(n)))
  }

  /** Does this root belong on the LISTS tab? A list is STRUCTURE: a root
   *  carrying a heading/list mark, or a root with children (a tree IS a
   *  hierarchical list). Questions and answers are conversation, so they stay
   *  on the notes tab whatever their shape. `roleOf()` defaults UNMARKED rows
   *  to 'list' for row styling, so the mark is read directly here. */
  #isListRoot(note: Note): boolean {
    const kind = this.noteKind(note)
    if (kind === 'q' || kind === 'a') return false
    if (note.children.length > 0) return true
    if (!note.mark) return false
    const role = this.#markStore()?.roleOf(note.mark) ?? 'list'
    return role === 'heading' || role === 'list'
  }

  /** The active tile's tree — split by the annotations tab, then pruned to the
   *  search query. Only ROOTS are classified: a list's prose children belong to
   *  their list, not to the other tab. */
  visibleNotes(): readonly Note[] {
    const q = this.#noteQuery.trim().toLowerCase()
    const wantLists = this.#tab === 'lists'
    const all = this.notes().filter(n => this.#isListRoot(n) === wantLists)
    if (!q) return all
    const prune = (nodes: readonly Note[]): Note[] => {
      const out: Note[] = []
      for (const n of nodes) {
        const kids = prune(n.children)
        const selfMatch = this.noteDisplayText(n).toLowerCase().includes(q)
        if (selfMatch || kids.length > 0) out.push({ ...n, children: kids })
      }
      return out
    }
    return prune(all)
  }

  /** The active tab's tree, flattened depth-first. THIS is the reading order;
   *  collapse state is deliberately ignored — reading sees the whole document. */
  readingRows(): readonly { note: Note; depth: number }[] {
    const out: { note: Note; depth: number }[] = []
    const walk = (nodes: readonly Note[], depth: number): void => {
      for (const n of nodes) { out.push({ note: n, depth }); walk(n.children, depth + 1) }
    }
    walk(this.visibleNotes(), 0)
    return out
  }

  /** The note under the big glyph. Clamped on read, never trusted — an edit can
   *  shrink the tree under it, and re-reading BY POSITION is what keeps the
   *  pane steady across a write. */
  readingRow(): { note: Note; depth: number } | null {
    const rows = this.readingRows()
    if (rows.length === 0) return null
    return rows[Math.min(this.#readingIndex, rows.length - 1)] ?? null
  }

  readingPosition(): number {
    const rows = this.readingRows()
    return rows.length === 0 ? 0 : Math.min(this.#readingIndex, rows.length - 1) + 1
  }

  /** Ancestor texts of the reading note — the breadcrumb that says WHERE in the
   *  hierarchy the big note sits. Empty for roots. */
  readingPath(): readonly string[] {
    const target = this.readingRow()?.note.id
    if (!target) return []
    const walk = (nodes: readonly Note[], trail: readonly string[]): readonly string[] | null => {
      for (const n of nodes) {
        if (n.id === target) return trail
        const found = walk(n.children, [...trail, this.noteDisplayText(n)])
        if (found) return found
      }
      return null
    }
    return walk(this.visibleNotes(), []) ?? []
  }

  /** True when the pane exists — the form renders THERE, not the centre column.
   *  The docked window is the same shape as the desk, stacked; the only layout
   *  without a pane is NARROW fullscreen, where there isn't width for one. */
  formInPane(): boolean { return !this.#fullscreen || this.#deskWide }

  // ── the lists tab ──
  /** The path actually in force — the stored one, or the first list on the tab
   *  when nothing has been picked, so the pane is never blank while there is
   *  something to show. */
  listPath(): readonly number[] {
    if (this.#listPathIdx.length > 0) return this.#listPathIdx
    return this.visibleNotes().length > 0 ? [0] : []
  }

  /** The open list — the note whose children are the lines. */
  listRoot(): Note | null {
    const roots = this.visibleNotes()
    if (roots.length === 0) return null
    let nodes: readonly Note[] = roots
    let node: Note | null = null
    for (const i of this.listPath()) {
      const pick = nodes[Math.min(i, nodes.length - 1)]
      if (!pick) break
      node = pick
      nodes = pick.children
    }
    return node
  }

  /** The open list, FLATTENED — every line at every depth in reading order,
   *  each carrying its depth, the id of the line it hangs under and its
   *  position among its siblings. ONE pass renders the whole hierarchy and the
   *  indent gestures read their neighbours straight off it. */
  listRows(): readonly { note: Note; depth: number; parentId: string; index: number }[] {
    const root = this.listRoot()
    if (!root) return []
    const out: { note: Note; depth: number; parentId: string; index: number }[] = []
    const walk = (nodes: readonly Note[], depth: number, parentId: string): void => {
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]!
        out.push({ note: n, depth, parentId, index: i })
        if (n.children.length > 0 && !this.isCollapsed(n.id)) walk(n.children, depth + 1, n.id)
      }
    }
    walk(root.children, 0, root.id)
    return out
  }

  /** The depth actually in force — never deeper than one step past the last
   *  line, so the open line can't float free of the list. */
  newLineDepth(): number {
    const rows = this.listRows()
    const deepest = rows.length === 0 ? -1 : rows[rows.length - 1]!.depth
    return Math.max(0, Math.min(this.#newItemDepth, deepest + 1))
  }

  // ── the navigator ──
  /** Is the page showing a narrowed view right now? */
  pageFiltered(): boolean { return this.#tagFilterActive || this.#searchFilterActive }

  /** The tiles the navigator may list: the page's surviving tiles while a
   *  filter is on, else every tile in the layer — ALWAYS intersected with the
   *  layer's own, in the order the page painted them. A flattening filter draws
   *  in tiles that live on pages below, and this panel resolves a tile's notes
   *  from its NAME against the current location: listing a foreign tile would
   *  open some other tile's notes, or an empty set, under its name. */
  #navigatorCellLabels(): readonly string[] {
    const layer = this.#layerCellLabels
    if (!this.pageFiltered()) return layer
    const here = new Set(layer)
    return this.#renderedCellLabels.filter(labelText => here.has(labelText))
  }

  #matchesText(cell: string, query: string): boolean {
    const q = query.trim().toLowerCase()
    if (!q) return true
    if (cell.toLowerCase().includes(q)) return true
    const walk = (ns: readonly Note[]): boolean =>
      ns.some(n => this.noteDisplayText(n).toLowerCase().includes(q) || walk(n.children))
    if (walk(this.#notesByCell.get(cell) ?? [])) return true
    return (this.#qaByCell.get(cell) ?? []).some(item => item.question.toLowerCase().includes(q))
  }

  #cellCount(cell: string): number {
    return this.#mergeQaWithNotes(
      this.#qaByCell.get(cell) ?? [], this.#notesByCell.get(cell) ?? []).length
  }

  tileList(): readonly { cell: string; count: number }[] {
    return this.#navigatorCellLabels()
      .filter(cell => this.#matchesText(cell, this.#filterText))
      .map(cell => ({ cell, count: this.#cellCount(cell) }))
  }

  // ── the plate ──
  plateWide(): boolean { return this.#panelWidth >= PLATE_WIDE_AT }

  /** Where the active tile sits, as the explorer reads it. Empty at the root. */
  platePath(): readonly string[] {
    return get<LineageLike>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? []
  }

  plateInitial(): string { return (this.cell() ?? '').trim().charAt(0).toUpperCase() || '·' }

  plateCounts(): { notes: number; questions: number; answers: number; children: number } {
    const cell = this.cell()
    const all = this.#allForCell(cell)
    let notes = 0, questions = 0, answers = 0
    const countIn = (list: readonly Note[]): void => {
      for (const n of list) {
        const kind = this.noteKind(n)
        if (kind === 'q') questions++
        else if (kind === 'a') answers++
        else notes++
        countIn(n.children)
      }
    }
    countIn(all)
    return { notes, questions, answers, children: (cell && this.#factsByCell.get(cell)?.childCount) || 0 }
  }

  // ── the peek card ──
  /** WHICH tile the card shows. Hover wins while the pointer is over another
   *  tile's row (a peek at what you have not picked); otherwise it is the
   *  SELECTED tile's card, and that one is PINNED. A card you can only reach by
   *  holding the pointer still is a card you cannot click a row in — the moment
   *  you set off towards it you have left the row that opened it. */
  peekCell(): string | null {
    return this.#hoverCell ?? (this.#fullscreen ? null : this.cell())
  }

  /** NEVER on the desk: fullscreen already shows the whole tree in its own
   *  column, so a pinned card of the same notes over it is a second copy of the
   *  answer. (The HOVER peek stays — that is a look at a tile you have NOT
   *  selected, which the desk has no other way to give you.) */
  peekPinned(): boolean {
    return !this.#hoverCell && !!this.cell() && !this.#fullscreen
  }

  hoverNotes(): readonly { id: string; text: string; kind: 'q' | 'a' | 'note'; mark: string | null; depth: number }[] {
    const cell = this.peekCell()
    if (!cell) return []
    const out: { id: string; text: string; kind: 'q' | 'a' | 'note'; mark: string | null; depth: number }[] = []
    const walk = (list: readonly Note[], depth: number): void => {
      for (const n of list) {
        out.push({ id: n.id, text: this.noteDisplayText(n), kind: this.noteKind(n), mark: n.mark, depth })
        walk(n.children, depth + 1)
      }
    }
    walk(this.#allForCell(cell), 0)
    return out
  }

  /** The PINNED card shows every note — it is the selector, and a selector that
   *  hides rows behind "+3 more" cannot select them. A hover peek stays capped. */
  hoverVisible(): readonly { id: string; text: string; kind: 'q' | 'a' | 'note'; mark: string | null; depth: number }[] {
    return this.peekPinned() ? this.hoverNotes() : this.hoverNotes().slice(0, HOVER_LIST_MAX)
  }

  hoverOverflow(): number {
    return this.peekPinned() ? 0 : Math.max(0, this.hoverNotes().length - HOVER_LIST_MAX)
  }

  /** An unwarmed tile shows "reading…" rather than an empty card that lies
   *  about the tile being empty. */
  hoverWarmed(): boolean {
    const cell = this.#hoverCell
    return !!cell && this.#warmed.has(cell)
  }

  // ── marks ──
  #markStore(): NoteMarksProvider | undefined {
    // Lazy: the palette rides the notes module and may register after this
    // strip mounts. Values arrive on EffectBus; the instance is only needed to
    // WRITE.
    return get<NoteMarksProvider>(NOTE_MARKS_IOC_KEY)
  }

  /** The rail split into its two KINDS — points (the constrained roles) and
   *  notes (prose). Derived from each mark's ROLE, never from a list of icon
   *  names here: the participant can re-role any icon at any time and the rail
   *  has to follow. An empty group is dropped rather than rendered as a bare
   *  label. */
  markGroups(): readonly { kind: MarkKind; marks: NoteMark[] }[] {
    const groups: { kind: MarkKind; marks: NoteMark[] }[] = [
      { kind: 'point', marks: [] },
      { kind: 'note', marks: [] },
    ]
    for (const m of this.#marks) {
      const kind = kindOfRole(m.role)
      groups[kind === 'point' ? 0 : 1]!.marks.push(m)
    }
    return groups.filter(g => g.marks.length > 0)
  }

  /** The kind labels only earn their space when there is something to tell
   *  apart — with one kind in the palette the rail stays the flat strip it has
   *  always been. */
  showKindLabels(): boolean { return this.markGroups().length > 1 }

  markOf(note: Note): string | null { return note.mark ?? null }

  /** Role the row renders with. Lives on the PALETTE, not the note, so
   *  re-roling an icon restyles every note that carries it. */
  roleOf(note: Note): MarkRole {
    return note.mark ? (this.#markStore()?.roleOf(note.mark) ?? 'list') : 'list'
  }

  markLabel(icon: string): string {
    const mark = this.#markStore()?.byIcon(icon)
    return mark?.name?.trim() || icon.replace(/_/g, ' ')
  }

  isCollapsed(noteId: string): boolean { return this.#collapsed.has(noteId) }

  readingTags(note: Note | null | undefined): readonly string[] {
    return Array.isArray(note?.tags) ? note.tags : []
  }

  initialOf(cell: string): string {
    return (cell ?? '').trim().charAt(0).toUpperCase() || '·'
  }

  // ══ rendering ════════════════════════════════════════════════════════
  //
  // Rebuild on change. The panel's state lives in fields, never in the DOM, so
  // rebuilding is safe — except for what the participant is standing in, which
  // is why the composer, the new-line input, both scrolling lists, the tile
  // filter box and the mounted rail are held as fields and MOVED by `place()`
  // rather than re-created. One focus snapshot wraps the whole pass.
  #render(): void {
    if (!this.#panelEl) return
    const snap = snapshotFocus(this)

    this.#panelEl.classList.toggle('mode-chips', this.#mode === 'chips')
    this.#panelEl.classList.toggle('mode-rows', this.#mode === 'rows')
    this.#panelEl.classList.toggle('dock-right', this.#dockMode === 'right')
    this.#panelEl.dataset['face'] = this.#face
    this.classList.toggle('is-fullscreen', this.#fullscreen)

    this.#renderDragbar()
    this.#renderTabs()
    this.#renderRail()
    this.#renderMain()
    this.#renderReading()
    this.#renderTileList()
    this.#renderPeek()
    this.#syncFormState()
    this.#paintDragStates()
    this.#paintGhost()

    putFocusBack(this, snap)
  }

  // ── the dragbar ──
  #renderDragbar(): void {
    const title = this.#dragTitleEl
    const bar = this.#dragbarEl
    if (!title || !bar) return
    const cell = this.cell()

    const parts: HTMLElement[] = []
    const hex = el('span', 'hex-mark')
    hex.setAttribute('aria-hidden', 'true')
    parts.push(hex, el('span', undefined, cell || t('annotations.title', 'annotations')))

    // WHICH tile, and — on the lists tab — WHICH LIST, right of it. A list's
    // name belongs with the window's identity, not stacked on top of its own
    // lines. Click it to rename, the same in-place gesture the lines use.
    const root = this.#tab === 'lists' && cell ? this.listRoot() : null
    if (root) {
      const sep = el('span', 'cv2-dragbar-sep', '/')
      sep.setAttribute('aria-hidden', 'true')
      parts.push(sep)
      if (this.#editingItemId === root.id) {
        const input = el('input', 'cv2-dragbar-listname-input')
        input.type = 'text'
        input.dataset['hcRow'] = 'list-name-input'
        input.value = this.#itemDraft
        input.setAttribute('aria-label', t('notes.lists.rename', 'rename this list'))
        input.addEventListener('pointerdown', (e) => e.stopPropagation())
        input.addEventListener('input', () => { this.#itemDraft = input.value })
        input.addEventListener('keydown', (e) => this.#onItemKeydown(e))
        input.addEventListener('blur', () => this.commitItemEdit())
        parts.push(input)
      } else {
        const nameBtn = btn('cv2-dragbar-listname', 'list-name')
        nameBtn.title = t('notes.lists.rename', 'rename this list')
        nameBtn.addEventListener('click', (e) => this.startListRename(e))
        const icon = this.markOf(root)
        if (icon) nameBtn.appendChild(sym(icon, 'mat-sym cv2-dragbar-listmark'))
        nameBtn.appendChild(el('span', 'cv2-dragbar-listtext', this.noteDisplayText(root)))
        parts.push(nameBtn)
      }
    }
    place(title, parts)

    // The reader button only when a tile is active — there is nothing to read
    // otherwise. `@if` DETACHED it, and acceptance drivers assert on absence,
    // so it is removed rather than hidden.
    if (this.#readerBtn && this.#fullscreenBtn) {
      const wanted = !!cell
      const present = this.#readerBtn.parentNode === bar
      if (wanted && !present) bar.insertBefore(this.#readerBtn, this.#fullscreenBtn)
      else if (!wanted && present) this.#readerBtn.remove()
    }
    if (this.#fullscreenBtn) {
      const glyph = this.#fullscreenBtn.firstElementChild
      if (glyph) glyph.textContent = this.#fullscreen ? 'close_fullscreen' : 'open_in_full'
      this.#fullscreenBtn.title = this.#fullscreen
        ? t('notes.exitFullscreen', 'Exit full screen')
        : t('notes.fullscreen', 'Full screen')
    }
  }

  #renderTabs(): void {
    const notesTab = this.#tabNotesBtn
    const listsTab = this.#tabListsBtn
    if (!notesTab || !listsTab) return
    notesTab.classList.toggle('is-active', this.#tab === 'notes')
    notesTab.setAttribute('aria-selected', String(this.#tab === 'notes'))
    listsTab.classList.toggle('is-active', this.#tab === 'lists')
    listsTab.setAttribute('aria-selected', String(this.#tab === 'lists'))
  }

  // ── the mark rail: part of the HEADER, not of either pane ──
  //
  // The same icon has to be droppable on a LINE of a list, on a ROW of the tree
  // and on the NOTE open in the pane, so it cannot live in one of them; and the
  // marks belong to the WINDOW (they are the participant's vocabulary), not to
  // whatever is selected right now.
  #renderRail(): void {
    const rail = this.#railEl
    const panel = this.#panelEl
    if (!rail || !panel) return
    const cell = this.cell()
    if (!cell) { rail.remove(); return }
    if (rail.parentNode !== panel) panel.insertBefore(rail, this.#mainEl)

    rail.classList.toggle('is-editing', this.#paletteEditing)
    const parts: HTMLElement[] = []

    if (!this.#paletteEditing) {
      const marks = el('div', 'cv2-rail-marks')
      marks.setAttribute('role', 'group')
      marks.setAttribute('aria-label', t('notes.markRail', 'Note marks'))
      for (const group of this.markGroups()) {
        const box = el('div', 'cv2-rail-kind')
        if (group.kind === 'note') box.classList.add('is-note')
        if (this.showKindLabels()) {
          const kindLabel = el('span', 'cv2-rail-kind-label',
            group.kind === 'point'
              ? t('notes.kindPoints', 'Points')
              : t('notes.kindNotes', 'Notes'))
          kindLabel.setAttribute('aria-hidden', 'true')
          box.appendChild(kindLabel)
        }
        for (const m of group.marks) {
          const b = btn('cv2-rail-mark', `mark:${m.icon}`)
          b.classList.toggle('is-active', this.#draftMark === m.icon)
          b.classList.toggle('is-heading', m.role === 'heading')
          b.classList.toggle('is-prose', m.role === 'prose')
          b.classList.toggle('is-dragging', this.#markDragIcon === m.icon)
          b.setAttribute('aria-pressed', String(this.#draftMark === m.icon))
          b.title = `${this.markLabel(m.icon)} — ${t('notes.markDragHint', 'drag onto a note to mark it')}`
          b.appendChild(sym(m.icon, 'mat-sym', false))
          b.addEventListener('pointerdown', (e) => this.onMarkPointerDown(m.icon, e))
          b.addEventListener('click', () => this.pickMark(m.icon))
          box.appendChild(b)
        }
        marks.appendChild(box)
      }
      const add = btn('cv2-rail-btn', 'mark-add')
      label(add, t('notes.addMark', 'Add an icon'))
      add.appendChild(sym('add'))
      add.addEventListener('click', () => { void this.addMarkIcon() })
      marks.appendChild(add)

      const tune = btn('cv2-rail-btn', 'mark-tune')
      label(tune, t('notes.editMarks', 'Edit marks'))
      tune.appendChild(sym('tune'))
      tune.addEventListener('click', () => this.togglePaletteEdit())

      parts.push(marks, el('span', 'cv2-rail-spacer'), tune)
    } else {
      const editor = el('div', 'cv2-rail-editor')
      const head = el('div', 'cv2-rail-editor-head')
      head.append(el('span', undefined, t('notes.markPalette', 'Marks')), el('span', 'cv2-rail-spacer'))
      const done = btn('cv2-rail-btn', 'mark-done')
      done.title = t('notes.markDone', 'Done')
      done.appendChild(sym('check'))
      done.addEventListener('click', () => this.togglePaletteEdit())
      head.appendChild(done)
      editor.appendChild(head)

      if (this.#marks.length === 0) {
        editor.appendChild(el('div', 'cv2-rail-empty',
          t('notes.noMarks', 'No marks yet — add an icon and give it a meaning.')))
      }
      for (const m of this.#marks) {
        const row = el('div', 'cv2-mark-row')
        row.appendChild(sym(m.icon, 'mat-sym cv2-mark-row-icon'))
        const name = el('input', 'cv2-mark-name')
        name.type = 'text'
        name.dataset['hcRow'] = `mark-name:${m.icon}`
        name.value = m.name
        name.placeholder = t('notes.markMeaning', 'what it means…')
        name.setAttribute('aria-label', t('notes.markMeaning', 'what it means…'))
        name.addEventListener('input', () => this.renameMark(m.icon, name.value))
        row.appendChild(name)
        // The three roles, grouped as the participant reads them: the two
        // constrained roles make a POINT, prose makes a NOTE.
        const roles = el('div', 'cv2-mark-roles')
        roles.setAttribute('role', 'group')
        const roleDefs: readonly [MarkRole, string, string][] = [
          ['heading', 'notes.markHeading', 'Heading'],
          ['list', 'notes.markList', 'List'],
          ['prose', 'notes.markProse', 'Note'],
        ]
        for (const [role, key, fallback] of roleDefs) {
          const rb = btn('', `mark-role:${m.icon}:${role}`)
          rb.className = ''
          rb.textContent = t(key, fallback)
          rb.classList.toggle('is-on', m.role === role)
          rb.addEventListener('click', () => this.setMarkRole(m.icon, role))
          roles.appendChild(rb)
        }
        row.appendChild(roles)
        const remove = btn('cv2-mark-remove', `mark-remove:${m.icon}`)
        label(remove, t('notes.markRemove', 'Remove this mark'))
        const glyph = sym('close')
        glyph.style.fontSize = '14px'
        remove.appendChild(glyph)
        remove.addEventListener('click', () => this.removeMark(m.icon))
        row.appendChild(remove)
        editor.appendChild(row)
      }
      const addBtn = btn('cv2-mark-add', 'mark-add-editor')
      const addGlyph = sym('add')
      addGlyph.style.fontSize = '14px'
      addBtn.append(addGlyph, el('span', undefined, t('notes.addMark', 'Add an icon')))
      addBtn.addEventListener('click', () => { void this.addMarkIcon() })
      editor.appendChild(addBtn)

      parts.push(editor)
    }
    place(rail, parts)
  }

  // ── the editor column (the DESK's centre; hidden in the docked stack) ──
  #renderMain(): void {
    const main = this.#mainEl
    if (!main) return
    const cell = this.cell()
    if (!cell) {
      place(main, [el('div', 'cv2-empty-hint',
        t('notes.pickTile', 'Pick a tile from the list to see and edit its notes.'))])
      return
    }

    const parts: HTMLElement[] = []
    parts.push(this.#buildPlate(cell))

    // Docked / narrow fullscreen: the form lives here in the column. On the
    // desk it renders in the READING PANE instead — the same NODE either way.
    if (!this.formInPane() && this.#formEl) parts.push(this.#formEl)

    // The question/answer axis lives on the notes tab only; the lists tab never
    // carries conversation rows.
    if (this.#tab === 'notes' && this.hasQuestions()) parts.push(this.#buildKindFilter())

    if (!this.#listEl) {
      const list = el('div', 'cv2-list thin-scroll notes-strip-body')
      list.dataset['noteDragScope'] = 'tree'
      this.#listEl = list
    }
    const list = this.#listEl
    const roots = this.visibleNotes()
    const rows: HTMLElement[] = []
    if (roots.length > 0) {
      roots.forEach((root, i) => { rows.push(...this.#buildNoteRow(root, 0, [i])) })
    } else if (this.#noteQuery) {
      rows.push(el('div', 'cv2-cloud-empty', t('notes.noteNoMatch', 'No notes match.')))
    } else {
      // Nothing here YET is the normal state of a fresh tile, so the column says
      // so and offers the one thing there is to do.
      const blank = el('div', 'cv2-col-blank')
      blank.appendChild(el('span', undefined, this.#tab === 'lists'
        ? t('annotations.lists.empty', 'no lists yet — give a note a list or heading mark, or nest notes, and it lives here')
        : t('notes.empty.none', 'nothing written on this tile yet')))
      const action = btn('cv2-reading-edit', this.#tab === 'lists' ? 'col-new-list' : 'col-add')
      action.append(
        sym(this.#tab === 'lists' ? 'playlist_add' : 'add'),
        el('span', undefined, this.#tab === 'lists'
          ? t('notes.lists.new', 'new list')
          : t('notes.add', 'add a note')))
      action.addEventListener('click', () => {
        if (this.#tab === 'lists') this.newList()
        else this.paneAdd()
      })
      blank.appendChild(action)
      rows.push(blank)
    }
    place(list, rows)
    parts.push(list)

    const foot = el('footer', 'cv2-foot')
    const line = el('span')
    line.append(
      document.createTextNode(t('notes.footerCount', '{count} notes in', { count: this.notes().length })),
      document.createTextNode(' '),
    )
    const code = el('code', undefined, cell)
    line.appendChild(code)
    foot.appendChild(line)
    parts.push(foot)

    place(main, parts)
  }

  /** WHICH tile these notes are on, said visually — the tile's own hexagon (the
   *  picture the canvas paints, resolved through the props → small.image hop)
   *  beside its name, where it lives, and what it holds. */
  #buildPlate(cell: string): HTMLElement {
    const plate = el('section', 'cv2-plate')
    if (this.plateWide()) plate.classList.add('is-wide')

    const hex = el('div', 'cv2-plate-hex')
    hex.setAttribute('aria-hidden', 'true')
    if (this.#plateImage) {
      const img = el('img', 'cv2-plate-img')
      img.src = this.#plateImage
      img.alt = ''
      hex.appendChild(img)
    } else {
      hex.appendChild(el('span', 'cv2-plate-initial', this.plateInitial()))
    }

    const meta = el('div', 'cv2-plate-meta')
    const name = el('div', 'cv2-plate-name', cell)
    name.title = cell
    meta.appendChild(name)

    const path = this.platePath()
    if (this.plateWide() && path.length > 0) {
      const pathBox = el('div', 'cv2-plate-path')
      pathBox.title = path.join(' / ')
      for (const seg of path) pathBox.appendChild(el('span', 'cv2-plate-seg', seg))
      meta.appendChild(pathBox)
    }

    const counts = this.plateCounts()
    const stats = el('div', 'cv2-plate-stats')
    const stat = (cls: string, dotCls: string | null, text: string): HTMLElement => {
      const s = el('span', cls)
      if (dotCls) s.appendChild(el('span', dotCls))
      s.appendChild(document.createTextNode(text))
      return s
    }
    stats.appendChild(stat('cv2-plate-stat', 'dot n',
      tCount('notes.plateNotes', '{count} note', '{count} notes', counts.notes)))
    // Questions and answers are only surfaced when non-zero, so an ordinary
    // tile shows two numbers, not four.
    if (counts.questions > 0) {
      stats.appendChild(stat('cv2-plate-stat is-q', 'dot q',
        tCount('notes.plateQuestions', '{count} question', '{count} questions', counts.questions)))
    }
    if (counts.answers > 0) {
      stats.appendChild(stat('cv2-plate-stat is-a', 'dot a',
        tCount('notes.plateAnswers', '{count} answer', '{count} answers', counts.answers)))
    }
    if (counts.children > 0) {
      const s = el('span', 'cv2-plate-stat')
      const glyph = el('span', 'cv2-plate-stat-hex')
      glyph.setAttribute('aria-hidden', 'true')
      s.append(glyph, document.createTextNode(
        tCount('notes.plateChildren', '{count} tile', '{count} tiles', counts.children)))
      stats.appendChild(s)
    }
    meta.appendChild(stats)

    plate.append(hex, meta)
    return plate
  }

  #buildKindFilter(): HTMLElement {
    const box = el('div', 'cv2-filter')
    box.setAttribute('role', 'group')
    box.setAttribute('aria-label', t('notes.kindLabel', 'note kind'))
    const chip = (key: 'all' | 'q' | 'note', dotCls: string, text: string, count?: number): HTMLElement => {
      const b = btn('cv2-filter-chip', `filter:${key}`)
      b.classList.toggle('active', this.#kindFilter === key)
      b.appendChild(el('span', dotCls))
      b.appendChild(document.createTextNode(text))
      if (count !== undefined) b.appendChild(el('span', undefined, String(count)))
      b.addEventListener('click', () => this.setKindFilter(key))
      return b
    }
    box.append(
      chip('all', 'dot all', t('notes.filterAll', 'all'), this.notes().length),
      chip('q', 'dot q', t('notes.filterQuestions', 'questions')),
      chip('note', 'dot n', t('notes.filterNotes', 'notes')),
    )
    return box
  }

  /** One row of the tree, plus its children — the recursive `rowTpl`, flattened
   *  into the array the flat `.cv2-list` renders (depth is carried as a CSS
   *  custom property, exactly as `[style.--depth]` did). */
  #buildNoteRow(note: Note, depth: number, path: readonly number[]): HTMLElement[] {
    const cell = this.cell() ?? ''
    const out: HTMLElement[] = []
    const row = el('article', 'cv2-note')
    row.setAttribute('data-note-row', '')
    row.dataset['noteId'] = note.id
    row.style.setProperty('--depth', String(depth))
    if (this.#tab === 'lists' && this.listRoot()?.id === note.id) row.classList.add('is-open-list')
    const role = this.roleOf(note)
    if (role === 'heading') row.classList.add('is-heading')
    if (role === 'prose') row.classList.add('is-prose')
    if (this.#fullscreen && this.readingRow()?.note.id === note.id) row.classList.add('is-reading')
    const kind = this.noteKind(note)
    if (kind === 'q') row.classList.add('cv2-note-q')
    if (kind === 'a') row.classList.add('cv2-note-a')
    if (this.#editingNoteId === note.id) row.classList.add('is-editing')
    if (note.shape && SHAPES.has(note.shape)) row.classList.add(`hc-shape-${note.shape}`)

    // Expand/collapse chevron — only when the note has children. A spacer keeps
    // the column width stable for leaves so rows align across the tree.
    if (note.children.length > 0) {
      const chev = btn('cv2-note-chevron', `note-chevron:${note.id}`)
      chev.classList.toggle('is-collapsed', this.isCollapsed(note.id))
      chev.setAttribute('aria-label', this.isCollapsed(note.id)
        ? t('notes.expand', 'Expand') : t('notes.collapse', 'Collapse'))
      const mark = el('span', 'cv2-chevron-mark')
      mark.setAttribute('aria-hidden', 'true')
      chev.appendChild(mark)
      chev.addEventListener('click', (e) => this.toggleCollapse(note.id, e))
      row.appendChild(chev)
    } else {
      const spacer = el('span', 'cv2-note-chevron-spacer')
      spacer.setAttribute('aria-hidden', 'true')
      row.appendChild(spacer)
    }

    const grip = el('div', 'cv2-note-grip')
    grip.title = t('notes.dragToReorder', 'drag to reorder or nest')
    grip.addEventListener('pointerdown', (e) => this.onNoteGripPointerDown(cell, note.id, e))
    row.appendChild(grip)

    const body = el('div', 'cv2-note-body')
    body.dataset['hcRow'] = `note-body:${note.id}`
    body.addEventListener('click', (e) => this.onRowBodyClick(cell, note.id, e, path))
    if (kind === 'q' || kind === 'a') {
      const kindLine = el('div', kind === 'q' ? 'cv2-note-kind' : 'cv2-note-kind cv2-kind-a')
      const glyph = sym(kind === 'q' ? 'help' : 'chat', 'mat-sym filled')
      glyph.style.fontSize = '12px'
      kindLine.append(glyph, document.createTextNode(' '), document.createTextNode(
        kind === 'q'
          ? t('notes.noteKindQuestion', 'question')
          : t('notes.noteKindAnswer', 'answer')))
      body.appendChild(kindLine)
    }
    // The row's glyph: a MARK from the participant's palette when the note
    // carries one, else the legacy CSS-painted shape. The icon name is
    // validated against /^[a-z0-9_]+$/ before it can reach a note layer, and it
    // reaches the DOM as TEXT — a ligature can only select a glyph.
    const icon = this.markOf(note)
    if (icon) {
      const glyph = sym(icon, 'mat-sym cv2-note-mark', false)
      glyph.title = this.markLabel(icon)
      body.appendChild(glyph)
    } else {
      const shape = el('span', 'hc-shape-glyph cv2-note-shape')
      shape.setAttribute('aria-hidden', 'true')
      body.appendChild(shape)
    }
    // `textContent` + `white-space: pre-wrap`: the participant's words, whole,
    // with their line breaks and no HTML.
    body.appendChild(el('p', 'cv2-note-text', this.noteDisplayText(note)))
    row.appendChild(body)

    const kebab = btn('cv2-note-kebab', `note-kebab:${note.id}`)
    kebab.classList.toggle('is-open', this.#kebabOpenId === note.id)
    kebab.setAttribute('aria-label', t('notes.actions', 'Note actions'))
    kebab.title = t('notes.moreActions', 'More actions')
    const kebabGlyph = sym('more_vert')
    kebabGlyph.style.fontSize = '14px'
    kebab.appendChild(kebabGlyph)
    kebab.addEventListener('click', (e) => this.openKebab(note.id, e))
    row.appendChild(kebab)

    if (this.#kebabOpenId === note.id) row.appendChild(this.#buildKebabMenu(note))
    if (this.#pickerOpenForId === note.id) row.appendChild(this.#buildNestPicker(note))

    out.push(row)
    if (!this.isCollapsed(note.id) && note.children.length > 0) {
      note.children.forEach((child, i) => {
        out.push(...this.#buildNoteRow(child, depth + 1, [...path, i]))
      })
    }
    return out
  }

  #buildKebabMenu(note: Note): HTMLElement {
    const menu = el('div', 'cv2-kebab-menu')
    menu.addEventListener('click', (e) => e.stopPropagation())
    const item = (key: string, glyph: string, text: string, run: (e: MouseEvent) => void, danger = false): HTMLElement => {
      const b = btn(danger ? 'cv2-kebab-item cv2-kebab-danger' : 'cv2-kebab-item', key)
      const g = sym(glyph)
      g.style.fontSize = '14px'
      b.append(g, el('span', undefined, text))
      b.addEventListener('click', run)
      return b
    }
    menu.appendChild(item(`kebab-nest:${note.id}`, 'subdirectory_arrow_right',
      t('notes.nestUnder', 'Nest under…'), (e) => this.openPicker(note.id, e)))
    if (this.isNested(note.id)) {
      menu.appendChild(item(`kebab-promote:${note.id}`, 'north_west',
        t('notes.promoteToTopLevel', 'Promote to top level'),
        () => { this.promote(note.id); this.closeKebab() }))
    }
    menu.appendChild(item(`kebab-delete:${note.id}`, 'delete',
      t('notes.delete', 'delete note'),
      (e) => { this.remove(note.id, e); this.closeKebab() }, true))
    return menu
  }

  #buildNestPicker(note: Note): HTMLElement {
    const box = el('div', 'cv2-nest-picker')
    box.setAttribute('role', 'listbox')
    box.setAttribute('aria-label', t('notes.nestUnder', 'Nest under…'))
    box.addEventListener('click', (e) => e.stopPropagation())
    box.appendChild(el('div', 'cv2-nest-picker-head', t('notes.nestUnder', 'Nest under…')))
    const candidates = this.nestCandidates(note.id)
    if (candidates.length === 0) {
      box.appendChild(el('div', 'cv2-nest-picker-empty',
        t('notes.noValidParents', 'No valid parent notes.')))
      return box
    }
    for (const cand of candidates) {
      const b = btn('cv2-nest-picker-item', `nest:${note.id}:${cand.id}`)
      b.style.paddingLeft = `${8 + cand.depth * 12}px`
      if (cand.mark) b.appendChild(sym(cand.mark, 'mat-sym cv2-nest-picker-mark'))
      const shape = el('span', 'hc-shape-glyph cv2-nest-picker-shape')
      if (cand.shape && SHAPES.has(cand.shape)) shape.classList.add(`hc-shape-${cand.shape}`)
      shape.setAttribute('aria-hidden', 'true')
      b.appendChild(shape)
      b.appendChild(el('span', 'cv2-nest-picker-text', cand.text))
      b.addEventListener('click', () => this.nestUnder(note.id, cand.id))
      box.appendChild(b)
    }
    return box
  }

  // ── THE PANE ──
  //
  // ALWAYS RENDERED. The window is two panes; a window that drops to one
  // because nothing is picked yet is a window that changes shape under you.
  // With no tile it says which question to answer instead, and with no notes it
  // offers the one thing there is to do.
  #renderReading(): void {
    const pane = this.#readingEl
    if (!pane) return
    const cell = this.cell()
    if (!cell) {
      const empty = el('div', 'cv2-reading-empty')
      empty.appendChild(el('span', undefined,
        t('notes.pickTile', 'Pick a tile from the list to see and edit its notes.')))
      place(pane, [empty])
      return
    }
    if (this.#tab === 'lists') { place(pane, [this.#renderListPane()]); return }
    if (this.#paneEditorOpen && this.#formEl) {
      // Writing mode — the same embedded form, given the whole pane. The box is
      // held, and `place` skips the form because it is already in position, so
      // a render while typing never touches the textarea.
      if (!this.#paneEditorBox) this.#paneEditorBox = el('div', 'cv2-reading-editor')
      const box = this.#paneEditorBox
      const kindLine = el('div', 'cv2-reading-kind')
      if (this.#draftKind === 'q') kindLine.classList.add('is-q')
      kindLine.append(
        sym(this.#editingNoteId ? 'edit' : 'add'),
        el('span', undefined, this.#editingNoteId
          ? t('notes.edit', 'edit') : t('notes.add', 'add a note')))
      place(box, [kindLine, this.#formEl])
      place(pane, [box])
      return
    }
    const row = this.readingRow()
    if (!row) {
      // Nothing selected. On a tile with notes that means "pick one"; on a
      // fresh tile it means "write the first one" — either way the button is
      // right there.
      const empty = el('div', 'cv2-reading-empty')
      empty.appendChild(el('span', undefined, this.notes().length === 0
        ? t('notes.empty.none', 'nothing written on this tile yet')
        : t('notes.reading.empty', 'click a note in the tree to read it here')))
      const add = btn('cv2-reading-edit', 'read-empty-add')
      add.append(sym('add'), el('span', undefined, t('notes.add', 'add a note')))
      add.addEventListener('click', () => this.paneAdd())
      empty.appendChild(add)
      place(pane, [empty])
      return
    }

    if (!this.#readScrollEl) this.#readScrollEl = el('div', 'cv2-reading-scroll thin-scroll')
    const scroll = this.#readScrollEl
    // Rows advertise themselves with `data-pheromone-note` (+ `-cell`) so a
    // pheromone dragged from the panel lands on the NOTE, not the tile. That
    // attribute PAIR is the contract — do not rename either half.
    scroll.dataset['pheromoneNote'] = row.note.id
    scroll.dataset['pheromoneNoteCell'] = cell

    const kind = this.noteKind(row.note)
    const role = this.roleOf(row.note)
    const parts: HTMLElement[] = []

    const kindLine = el('div', 'cv2-reading-kind')
    if (kind === 'q') kindLine.classList.add('is-q')
    if (kind === 'a') kindLine.classList.add('is-a')
    if (role === 'heading') kindLine.classList.add('is-heading')
    if (role === 'prose') kindLine.classList.add('is-prose')
    const icon = this.markOf(row.note)
    if (kind === 'q') {
      kindLine.append(sym('help', 'mat-sym filled'),
        el('span', undefined, t('notes.noteKindQuestion', 'question')))
    } else if (kind === 'a') {
      kindLine.append(sym('chat', 'mat-sym filled'),
        el('span', undefined, t('notes.noteKindAnswer', 'answer')))
    } else if (icon) {
      kindLine.append(sym(icon), el('span', undefined, this.markLabel(icon)))
    } else {
      kindLine.appendChild(el('span', undefined, t('notes.kindNote', 'note')))
    }
    parts.push(kindLine)

    // The glyph plate, only when the note HAS a glyph to carry: a bare note
    // would render it empty, and a blank hexagon reads as broken.
    if (icon || kind !== 'note' || row.note.shape) {
      const hex = el('div', 'cv2-reading-hex')
      if (kind === 'q') hex.classList.add('is-q')
      if (kind === 'a') hex.classList.add('is-a')
      hex.setAttribute('aria-hidden', 'true')
      if (icon) hex.appendChild(sym(icon, 'mat-sym cv2-reading-hex-icon', false))
      else if (kind === 'q') hex.appendChild(sym('help', 'mat-sym filled cv2-reading-hex-icon', false))
      else if (kind === 'a') hex.appendChild(sym('chat', 'mat-sym filled cv2-reading-hex-icon', false))
      else {
        const shape = el('span', 'hc-shape-glyph cv2-reading-hex-shape')
        if (row.note.shape && SHAPES.has(row.note.shape)) shape.classList.add(`hc-shape-${row.note.shape}`)
        hex.appendChild(shape)
      }
      parts.push(hex)
    }

    const trail = this.readingPath()
    if (trail.length > 0) {
      const pathBox = el('div', 'cv2-reading-path')
      pathBox.title = trail.join(' / ')
      for (const seg of trail) pathBox.appendChild(el('span', 'cv2-reading-seg', seg))
      parts.push(pathBox)
    }

    parts.push(el('p', 'cv2-reading-text', this.noteDisplayText(row.note)))

    const tags = el('div', 'cv2-reading-tags')
    const list = this.readingTags(row.note)
    if (list.length > 0) {
      for (const tag of list) {
        const chip = el('span', 'cv2-reading-tag')
        chip.appendChild(el('span', undefined, tag))
        const off = btn('cv2-reading-tag-off', `read-untag:${tag}`)
        off.textContent = '×'
        off.setAttribute('aria-label', t('notes.viewer.untag', 'remove {tag}', { tag }))
        off.addEventListener('click', (e) => this.removeReadingTag(tag, e))
        chip.appendChild(off)
        tags.appendChild(chip)
      }
    } else {
      tags.appendChild(el('span', 'cv2-reading-tags-hint',
        t('notes.viewer.dropHint', 'drag a pheromone here to tag this note')))
    }
    parts.push(tags)
    place(scroll, parts)

    // The cycle: prev / position / next. Never disabled — it wraps.
    const cycle = el('div', 'cv2-reading-cycle')
    const prev = btn('cv2-reading-cycle-btn', 'read-prev')
    label(prev, t('notes.viewer.prev', 'previous note'))
    prev.appendChild(sym('chevron_left'))
    prev.addEventListener('click', () => this.stepReading(-1))
    const pos = el('span', 'cv2-reading-pos',
      t('notes.viewer.position', '{at} of {of}',
        { at: this.readingPosition(), of: this.readingRows().length }))
    pos.setAttribute('aria-live', 'polite')
    const next = btn('cv2-reading-cycle-btn', 'read-next')
    label(next, t('notes.viewer.next', 'next note'))
    next.appendChild(sym('chevron_right'))
    next.addEventListener('click', () => this.stepReading(1))
    const addBtn = btn('cv2-reading-edit', 'read-add')
    addBtn.append(sym('add'), el('span', undefined, t('notes.add', 'add a note')))
    addBtn.addEventListener('click', () => this.paneAdd())
    const editBtn = btn('cv2-reading-edit', 'read-edit')
    editBtn.append(sym('edit'), el('span', undefined, t('notes.edit', 'edit')))
    editBtn.addEventListener('click', () => this.editReading())
    cycle.append(prev, pos, next, el('span', 'cv2-reading-cycle-spacer'), addBtn, editBtn)

    place(pane, [scroll, cycle])
  }

  /** LISTS — its own interface. A column of one-liners with a line that is
   *  always open at the foot; Tab and Shift+Tab move that open line in and out,
   *  so a HIERARCHY is typed at the same speed as a flat list. */
  #renderListPane(): HTMLElement {
    if (!this.#listPaneEl) {
      const box = el('div', 'cv2-listpane')
      box.dataset['noteDragScope'] = 'list'
      this.#listPaneEl = box
    }
    const pane = this.#listPaneEl
    const parts: HTMLElement[] = []
    const root = this.listRoot()

    if (root) {
      if (!this.#linesEl) this.#linesEl = el('div', 'cv2-list-lines thin-scroll')
      const lines = this.#linesEl
      const rows: HTMLElement[] = []
      for (const rowData of this.listRows()) rows.push(this.#buildListLine(rowData))
      if (this.#newLineRow) {
        this.#newLineRow.style.setProperty('--depth', String(this.newLineDepth()))
        // Only ever ASSIGNED when it differs — writing the same string back is
        // what moves a caret to the end mid-word.
        if (this.#newLineInput && this.#newLineInput.value !== this.#newItemText) {
          this.#newLineInput.value = this.#newItemText
        }
        rows.push(this.#newLineRow)
      }
      place(lines, rows)
      parts.push(lines)
    } else {
      const blank = el('div', 'cv2-list-blank')
      blank.appendChild(el('span', undefined, t('annotations.lists.empty',
        'no lists yet — give a note a list or heading mark, or nest notes, and it lives here')))
      parts.push(blank)
    }

    // The two things you do TO a list rather than in it: quiet, at the very
    // bottom, out of the writing.
    const foot = el('div', 'cv2-listfoot')
    const newBtn = btn('cv2-listfoot-btn', 'listfoot-new')
    newBtn.title = t('notes.lists.new', 'new list')
    newBtn.append(sym('playlist_add'), el('span', undefined, t('notes.lists.new', 'new list')))
    newBtn.addEventListener('click', () => this.newList())
    foot.append(newBtn, el('span', 'cv2-toolbar-spacer'))
    if (root) {
      const del = btn('cv2-listfoot-btn is-danger', 'listfoot-delete')
      del.classList.toggle('is-armed', this.#listDeleteArmed)
      del.title = t('notes.lists.delete', 'delete this list')
      del.append(sym('delete'), el('span', undefined, this.#listDeleteArmed
        ? t('notes.lists.deleteConfirm', 'delete list?')
        : t('notes.lists.delete', 'delete this list')))
      del.addEventListener('click', (e) => this.deleteList(e))
      del.addEventListener('pointerleave', () => this.disarmListDelete())
      foot.appendChild(del)
    }
    parts.push(foot)
    place(pane, parts)
    return pane
  }

  #buildListLine(data: { note: Note; depth: number; parentId: string; index: number }): HTMLElement {
    const cell = this.cell() ?? ''
    const note = data.note
    const row = el('div', 'cv2-line')
    row.setAttribute('data-note-row', '')
    row.dataset['noteId'] = note.id
    row.dataset['pheromoneNote'] = note.id
    row.dataset['pheromoneNoteCell'] = cell
    row.style.setProperty('--depth', String(data.depth))
    if (this.#editingItemId === note.id) row.classList.add('is-editing')

    const grip = el('div', 'cv2-line-grip')
    grip.title = t('notes.dragToReorder', 'drag to reorder or nest')
    grip.addEventListener('pointerdown', (e) => this.onNoteGripPointerDown(cell, note.id, e))
    row.appendChild(grip)

    if (note.children.length > 0) {
      const chev = btn('cv2-line-chevron', `line-chevron:${note.id}`)
      chev.classList.toggle('is-collapsed', this.isCollapsed(note.id))
      chev.setAttribute('aria-label', this.isCollapsed(note.id)
        ? t('notes.expand', 'Expand') : t('notes.collapse', 'Collapse'))
      const mark = el('span', 'cv2-chevron-mark')
      mark.setAttribute('aria-hidden', 'true')
      chev.appendChild(mark)
      chev.addEventListener('click', (e) => this.toggleCollapse(note.id, e))
      row.appendChild(chev)
    } else {
      const spacer = el('span', 'cv2-line-chevron-spacer')
      spacer.setAttribute('aria-hidden', 'true')
      row.appendChild(spacer)
    }

    const icon = this.markOf(note)
    if (icon) row.appendChild(sym(icon, 'mat-sym cv2-line-mark'))
    else {
      const bullet = el('span', 'cv2-line-bullet')
      bullet.setAttribute('aria-hidden', 'true')
      row.appendChild(bullet)
    }

    if (this.#editingItemId === note.id) {
      const input = el('input', 'cv2-line-input')
      input.type = 'text'
      input.dataset['hcRow'] = `line-input:${note.id}`
      input.value = this.#itemDraft
      input.setAttribute('aria-label', t('notes.edit', 'edit'))
      input.addEventListener('input', () => { this.#itemDraft = input.value })
      input.addEventListener('keydown', (e) => this.#onItemKeydown(e))
      input.addEventListener('blur', () => this.commitItemEdit())
      row.appendChild(input)
    } else {
      const text = btn('cv2-line-text', `line-text:${note.id}`)
      text.textContent = this.noteDisplayText(note)
      text.addEventListener('click', (e) => this.startItemEdit(note, e))
      row.appendChild(text)
      if (this.isCollapsed(note.id)) {
        const sub = el('span', 'cv2-line-sub', String(note.children.length))
        sub.setAttribute('aria-hidden', 'true')
        row.appendChild(sub)
      }
      const del = btn('cv2-line-btn cv2-line-del', `line-del:${note.id}`)
      label(del, t('notes.delete', 'delete note'))
      const glyph = sym('close')
      glyph.style.fontSize = '14px'
      del.appendChild(glyph)
      del.addEventListener('click', (e) => this.remove(note.id, e))
      row.appendChild(del)
    }
    return row
  }

  // ── the tile navigator ──
  #renderTileList(): void {
    const box = this.#tileListEl
    const host = this.#railHostEl
    if (!box || !host) return
    box.classList.toggle('has-rail', this.#railMounted)
    const parts: HTMLElement[] = [host]

    // The rail brings its own find box; the chips below stand in only where the
    // factory is not there to ask (an essentials build predating the profile).
    if (!this.#railMounted) {
      const filter = el('div', 'cv2-tilelist-filter')
      const glyph = sym('search')
      glyph.style.fontSize = '15px'
      filter.appendChild(glyph)
      if (!this.#tileFilterInput) {
        const input = el('input', 'cv2-tilelist-input')
        input.type = 'text'
        input.dataset['hcRow'] = 'tile-filter'
        input.addEventListener('input', () => this.setFilter(input.value))
        this.#tileFilterInput = input
      }
      const input = this.#tileFilterInput
      if (input.value !== this.#filterText) input.value = this.#filterText
      input.placeholder = t('notes.filterPlaceholder', 'find a tile…')
      input.setAttribute('aria-label', t('notes.filterPlaceholder', 'find a tile…'))
      filter.appendChild(input)
      if (this.#filterText) {
        const clear = btn('cv2-tilelist-clear', 'tile-filter-clear')
        label(clear, t('notes.clearFilter', 'clear'))
        const cg = sym('close')
        cg.style.fontSize = '14px'
        clear.appendChild(cg)
        clear.addEventListener('click', () => this.clearFilter())
        filter.appendChild(clear)
      }
      parts.push(filter)

      if (!this.#tileCloudEl) {
        const cloud = el('div', 'cv2-tilecloud thin-scroll')
        cloud.setAttribute('role', 'listbox')
        this.#tileCloudEl = cloud
      }
      const cloud = this.#tileCloudEl
      cloud.setAttribute('aria-label', t('notes.filterPlaceholder', 'find a tile…'))
      const rows: HTMLElement[] = []
      const tiles = this.tileList()
      for (const tile of tiles) {
        const chip = btn('cv2-tilechip', `tile:${tile.cell}`)
        chip.setAttribute('role', 'option')
        chip.setAttribute('aria-selected', String(tile.cell === this.cell()))
        chip.classList.toggle('is-active', tile.cell === this.cell())
        chip.classList.toggle('is-peeked', tile.cell === this.#hoverCell)
        chip.title = tile.cell
        const hex = el('span', 'cv2-tilechip-hex', this.initialOf(tile.cell))
        hex.setAttribute('aria-hidden', 'true')
        chip.append(hex, el('span', 'cv2-tilechip-name', tile.cell))
        if (tile.count > 0) {
          const count = el('span', 'cv2-tilechip-count', String(tile.count))
          count.setAttribute('aria-hidden', 'true')
          chip.appendChild(count)
        }
        chip.addEventListener('pointerenter', (e) => this.onChipEnter(tile.cell, e))
        chip.addEventListener('pointerleave', () => this.onChipLeave())
        chip.addEventListener('click', () => this.activateCell(tile.cell))
        rows.push(chip)
      }
      if (tiles.length === 0) {
        rows.push(el('div', 'cv2-tilelist-empty', this.#filterText
          ? t('notes.filterNoMatch', 'No tiles match.')
          : t('notes.noTiles', 'No tiles in this layer.')))
      }
      place(cloud, rows)
      parts.push(cloud)
    }

    // The page's filter reaches in here: while one is on, this list is the
    // page's surviving tiles, not the whole layer. Say so, or the missing tiles
    // read as a bug.
    if (this.pageFiltered()) {
      const hint = el('div', 'cv2-tilelist-scopehint')
      const glyph = sym('filter_alt')
      glyph.style.fontSize = '13px'
      hint.append(glyph, el('span', undefined,
        t('notes.pageFiltered', "Showing only the tiles the page's filter kept.")))
      parts.push(hint)
    }

    place(box, parts)
    this.#mountRailIfPossible()
  }

  // ── the peek card (a SIBLING of the panel — see renderPanel) ──
  #renderPeek(): void {
    const peeked = this.peekCell()
    if (!peeked) { this.#peekEl?.remove(); this.#peekEl = null; return }
    const pinned = this.peekPinned()
    // Kept across renders so the pinned card's scroll survives; only its
    // contents are rebuilt.
    if (!this.#peekEl) this.#peekEl = el('div', 'cv2-peek')
    const card = this.#peekEl
    card.classList.toggle('is-pinned', pinned)
    card.setAttribute('role', pinned ? 'listbox' : 'tooltip')
    if (this.#hoverLeft === null) card.style.removeProperty('left')
    else card.style.left = `${this.#hoverLeft}px`
    if (this.#hoverRight === null) card.style.removeProperty('right')
    else card.style.right = `${this.#hoverRight}px`
    card.style.top = `${this.#hoverTop}px`
    if (!card.dataset['wired']) {
      card.dataset['wired'] = '1'
      card.addEventListener('pointerenter', () => this.onPeekEnter())
    }

    const parts: HTMLElement[] = []
    const head = el('div', 'cv2-peek-head')
    const hex = el('span', 'hex-mark')
    hex.setAttribute('aria-hidden', 'true')
    head.append(hex, el('span', 'cv2-peek-name', peeked))
    if (pinned) {
      head.appendChild(el('span', 'cv2-peek-spacer'))
      const add = btn('cv2-peek-add', 'peek-add')
      label(add, t('notes.add', 'add a note'))
      const g = sym('add')
      g.style.fontSize = '14px'
      add.appendChild(g)
      add.addEventListener('click', () => this.paneAdd())
      head.appendChild(add)
    }
    parts.push(head)

    const rows = this.hoverVisible()
    if (rows.length > 0) {
      const list = el('ul', 'cv2-peek-list')
      const activeId = this.readingRow()?.note.id
      for (const row of rows) {
        const li = el('li', 'cv2-peek-row')
        if (row.kind === 'q') li.classList.add('is-q')
        if (row.kind === 'a') li.classList.add('is-a')
        if (pinned && activeId === row.id) li.classList.add('is-active')
        if (pinned) {
          li.dataset['noteId'] = row.id
          li.dataset['hcRow'] = `peek-row:${row.id}`
          li.setAttribute('role', 'option')
          li.setAttribute('aria-selected', String(activeId === row.id))
        }
        li.style.paddingLeft = `${row.depth * 10}px`
        li.addEventListener('click', (e) => this.selectPeekNote(row.id, e))
        if (row.mark) li.appendChild(sym(row.mark, 'mat-sym cv2-peek-mark'))
        else {
          const dot = el('span', 'dot')
          dot.classList.add(row.kind === 'q' ? 'q' : row.kind === 'a' ? 'a' : 'n')
          li.appendChild(dot)
        }
        li.appendChild(el('span', 'cv2-peek-text', row.text))
        list.appendChild(li)
      }
      parts.push(list)
      if (this.hoverOverflow() > 0) {
        parts.push(el('div', 'cv2-peek-more',
          t('notes.peekMore', '+{count} more', { count: this.hoverOverflow() })))
      }
    } else {
      parts.push(el('div', 'cv2-peek-empty', this.hoverWarmed()
        ? t('notes.peekEmpty', 'No notes on this tile yet.')
        : t('notes.peekReading', 'reading…')))
    }
    place(card, parts)
    if (card.parentNode !== this) this.appendChild(card)
  }

  /** The form's live state, mutated on the SAME nodes — an update to a value or
   *  a label is not a rebuild, and rebuilding here would cost the caret. */
  #syncFormState(): void {
    const form = this.#formEl
    const area = this.#formInput
    if (!form || !area) return
    form.classList.toggle('is-question', this.#draftKind === 'q')
    if (area.value !== this.#draftText) area.value = this.#draftText
    const placeholder = this.#draftKind === 'q'
      ? t('notes.capturePlaceholderQ', 'ask a question and press Enter...')
      : t('notes.capturePlaceholder', 'type a note and press Enter...')
    area.placeholder = placeholder
    area.setAttribute('aria-label', this.#editingNoteId
      ? t('notes.edit', 'edit') : t('notes.add', 'add a note'))
    if (this.#formKindBtn && this.#formKindDot && this.#formKindLabel) {
      this.#formKindBtn.classList.toggle('is-question', this.#draftKind === 'q')
      this.#formKindBtn.setAttribute('aria-label', t('notes.kindLabel', 'note kind'))
      this.#formKindBtn.setAttribute('aria-pressed', String(this.#draftKind === 'q'))
      const kindText = this.#draftKind === 'q'
        ? t('notes.kindQuestion', 'question') : t('notes.kindNote', 'note')
      this.#formKindBtn.title = kindText
      this.#formKindDot.className = `dot ${this.#draftKind === 'q' ? 'q' : 'n'}`
      this.#formKindLabel.textContent = kindText
    }
    if (this.#formSubmit) {
      this.#formSubmit.disabled = !this.#draftText.trim()
      this.#formSubmit.textContent = this.#editingNoteId
        ? t('notes.save', 'save')
        : (this.#draftKind === 'q' ? t('notes.formAsk', 'ask') : t('notes.formAdd', 'add'))
    }
    // Cancel: always offered while editing; in the pane it is also the way back
    // to reading from an empty add form.
    const tools = this.#formToolsEl
    if (tools) {
      const wanted = !!this.#editingNoteId || this.formInPane()
      const present = tools.parentNode === form
      if (wanted && !present) form.appendChild(tools)
      else if (!wanted && present) tools.remove()
      const cancel = tools.lastElementChild
      if (cancel instanceof HTMLElement) {
        cancel.title = t('notes.close', 'close')
        const text = cancel.lastElementChild
        if (text) text.textContent = t('notes.cancel', 'cancel')
      }
    }
  }

  /** Drag highlights are painted on the EXISTING rows — a pointermove is not a
   *  reason to rebuild a tree, and rebuilding the row under the pointer is how
   *  a drag loses its target. */
  #paintDragStates(): void {
    const rows = Array.from(this.querySelectorAll<HTMLElement>('[data-note-row][data-note-id]'))
    for (const row of rows) {
      const id = row.dataset['noteId'] ?? ''
      row.classList.toggle('is-dragging', this.#noteDragSourceId === id)
      row.classList.toggle('is-drop-into', this.#noteDropTargetId === id && this.#noteDropMode === 'into')
      row.classList.toggle('is-drop-before', this.#noteDropTargetId === id && this.#noteDropMode === 'before')
      row.classList.toggle('is-drop-after', this.#noteDropTargetId === id && this.#noteDropMode === 'after')
      row.classList.toggle('is-mark-target', this.#markDropTargetId === id)
    }
    for (const peekRow of Array.from(this.querySelectorAll<HTMLElement>('.cv2-peek-row[data-note-id]'))) {
      peekRow.classList.toggle('is-mark-target', this.#markDropTargetId === peekRow.dataset['noteId'])
    }
    const rootDrop = this.#noteDropMode === 'root'
    this.#listEl?.classList.toggle('has-root-drop', rootDrop)
    this.#linesEl?.classList.toggle('has-root-drop', rootDrop)
    const scroll = this.#readScrollEl
    if (scroll) {
      scroll.classList.toggle('is-mark-target',
        !!this.#markDropTargetId && this.#markDropTargetId === scroll.dataset['pheromoneNote'])
    }
    for (const mark of Array.from(this.querySelectorAll<HTMLElement>('.cv2-rail-mark'))) {
      const key = mark.dataset['hcRow'] ?? ''
      mark.classList.toggle('is-dragging', key === `mark:${this.#markDragIcon}`)
    }
  }

  /** The icon riding the pointer. Position is MUTATED on the same node every
   *  frame — a rebuild per pointermove would strobe it. */
  #paintGhost(): void {
    const ghost = this.#ghostEl
    if (!ghost) return
    if (!this.#markDragIcon) { ghost.remove(); return }
    ghost.textContent = this.#markDragIcon
    ghost.style.left = `${this.#markGhostX}px`
    ghost.style.top = `${this.#markGhostY}px`
    if (ghost.parentNode !== this) this.appendChild(ghost)
  }

  // ══ the verbs ════════════════════════════════════════════════════════

  setTab(next: 'notes' | 'lists'): void {
    if (next === this.#tab) return
    this.#tab = next
    // A new tab is a new document — reading starts back at the top of it.
    this.#readingIndex = 0
    this.#listPathIdx = []
    this.#newItemDepth = 0
    this.disarmListDelete()
    this.cancelItemEdit()
    try { localStorage.setItem('hc:annotations-tab', next) } catch { /* ignore */ }
    this.#render()
  }

  /** Which face the note prose is set in. Participant-local — a viewing
   *  preference, never content. */
  setFace(next: NotesFace): void {
    if (next === this.#face) return
    this.#face = next
    try { localStorage.setItem(NOTES_STRIP_FACE_KEY, next) } catch { /* ignore */ }
    this.#render()
  }

  /** What the gear shows under "This window". A thunk, read at paint time, so
   *  the lit segment is always the face actually in use. */
  settingsRows(): SettingRow[] {
    return [{
      kind: 'choice',
      key: 'notes-face',
      label: t('notes.face.label', 'Note face'),
      value: this.#face,
      options: NOTES_FACES.map(face => ({
        value: face,
        // A key built at RUNTIME: `notes.face.${face}` expands to exactly three
        // — notes.face.mono / .sans / .serif — and all three are carried.
        label: t(`notes.face.${face}`,
          face === 'mono' ? 'Mono' : face === 'sans' ? 'Sans' : 'Serif'),
      })),
      hint: t('notes.face.hint',
        'The face notes are read and written in. This window keeps its own.'),
      pick: (value) => { this.setFace(value as NotesFace) },
    }]
  }

  setKindFilter(filter: 'all' | 'q' | 'note'): void {
    if (filter === this.#kindFilter) return
    this.#kindFilter = filter
    try { localStorage.setItem('hc:notes-strip-kind-filter', filter) } catch { /* ignore */ }
    this.#render()
  }

  /** Free-text filter over the active tile's notes. The search box was removed
   *  from the surface, so nothing reaches these today; the prune path they feed
   *  is still live and the API is kept rather than silently dropped. */
  setNoteQuery(value: string): void { this.#noteQuery = value; this.#render() }
  clearNoteQuery(): void { this.setNoteQuery('') }

  setFilter(value: string): void { this.#filterText = value; this.#render() }
  clearFilter(): void { this.setFilter('') }

  // ── reading ──
  selectForReading(noteId: string): void {
    const idx = this.readingRows().findIndex(r => r.note.id === noteId)
    if (idx >= 0) { this.#readingIndex = idx; this.#afterReadingMoved() }
  }

  /** CLICK A NOTE, SEE IT IN THE VIEW — the one selection entry point.
   *
   *  Two things used to swallow a click. The card lists EVERY note of the tile
   *  while the pane only cycles the rows of the ACTIVE TAB, so a note belonging
   *  to the other tab resolved to no index and nothing happened — the tab
   *  follows the click now. And on the lists tab the pane is the list
   *  interface, not the reader, so "showing" a note there means opening the
   *  list it belongs to (or itself, when it IS a list). */
  selectNote(noteId: string): void {
    if (!noteId) return
    if (!this.readingRows().some(r => r.note.id === noteId)) {
      this.setTab(this.#tab === 'notes' ? 'lists' : 'notes')
    }
    if (this.#tab === 'lists') {
      const path = this.#pathOf(noteId)
      if (path) this.openListPath(path)
    }
    this.selectForReading(noteId)
    // A PRISTINE add form yields — the click said "show me that one", and a
    // pane still sitting on an empty composer isn't showing it. Anything in
    // flight is kept: a half-written note never loses to a click.
    if (this.#paneEditorOpen && !this.#editingNoteId && !this.#draftText.trim()) {
      this.#paneEditorOpen = false
    }
    this.#render()
  }

  /** Index path of a note within the visible tree, or null. Positions, not ids
   *  — the same currency the list pane runs on. */
  #pathOf(noteId: string): readonly number[] | null {
    const walk = (nodes: readonly Note[], trail: readonly number[]): readonly number[] | null => {
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]!
        if (n.id === noteId) return [...trail, i]
        const found = walk(n.children, [...trail, i])
        if (found) return found
      }
      return null
    }
    return walk(this.visibleNotes(), [])
  }

  /** Step the pane. WRAPS in both directions — a cycle, not a list with ends,
   *  so neither button ever disables. */
  stepReading(delta: number): void {
    const n = this.readingRows().length
    if (n === 0) return
    this.#readingIndex = stepIndex(this.#readingIndex, delta, n)
    this.#afterReadingMoved()
    this.#render()
  }

  #afterReadingMoved(): void {
    const id = this.readingRow()?.note.id
    if (!id) return
    // The row has to exist first, hence the microtask.
    queueMicrotask(() => this.#revealRow(id))
  }

  /** Bring the row the pane is showing INTO VIEW in the notes column, and put
   *  it at the TOP when it is off-screen. Prev/next walk the whole tree, so
   *  without this the column silently falls out of step with the pane. A row
   *  already visible is left exactly where it is: scrolling under a pointer
   *  that didn't ask for it is worse than not scrolling. */
  #revealRow(noteId: string): void {
    const list = this.querySelector<HTMLElement>(
      '.cv2-peek.is-pinned .cv2-peek-list, .cv2-list')
    if (!list) return
    // `CSS` is the stylesheet string in this module — reach the global.
    const row = list.querySelector<HTMLElement>(
      `[data-note-id="${globalThis.CSS.escape(noteId)}"]`)
    if (!row) return
    const box = list.getBoundingClientRect()
    const r = row.getBoundingClientRect()
    if (r.top >= box.top && r.bottom <= box.bottom) return
    list.scrollTop += r.top - box.top
  }

  /** The pane's add button — a fresh note, written large. */
  paneAdd(): void {
    const cell = this.cell()
    if (cell) this.#openForm(cell)
  }

  /** Edit the reading note — questions route to the tile editor, as everywhere. */
  editReading(): void {
    const cell = this.cell()
    const noteId = this.readingRow()?.note.id
    if (!cell || !noteId) return
    this.editNote(noteId, cell)
  }

  /** Take one pheromone off the reading note (its chip's ×). */
  removeReadingTag(tag: string, event?: Event): void {
    event?.stopPropagation()
    const cellLabel = this.cell()
    const noteId = this.readingRow()?.note.id
    if (!cellLabel || !noteId) return
    EffectBus.emit('note:tag', { cellLabel, noteId, tag, add: false })
  }

  /** Click a row of the pinned card — that note goes in the view. */
  selectPeekNote(noteId: string, event?: Event): void {
    event?.stopPropagation()
    if (!this.peekPinned()) return
    this.selectNote(noteId)
  }

  // ── the lists interface ──

  /** Open the list a path lands in. Every path resolves to its ROOT list: the
   *  pane shows one list whole, so a nested line is not a place of its own to
   *  be — it is a line of the list it belongs to. */
  openListPath(path: readonly number[]): void {
    if (path.length === 0) return
    this.#listPathIdx = [path[0]!]
    this.#newItemDepth = 0
    this.cancelItemEdit()
    this.#render()
  }

  #clearNewLine(): void {
    this.#newItemText = ''
    const input = this.#newLineInput
    if (!input) return
    // Cleared BY HAND, and the caret stays: a commit that only reset the field
    // through a binding would leave the typed text sitting in the DOM and the
    // line would appear to have been added twice.
    input.value = ''
    input.focus()
  }

  #onNewItemKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      this.commitNewItem()
      return
    }
    // Tab moves the OPEN LINE in and out, before it is anything: the bullet
    // slides across, and that is where the next line lands. It costs no write —
    // the depth is a property of the gesture, not of the tree.
    if (event.key === 'Tab') {
      event.preventDefault(); event.stopPropagation()
      this.stepNewLineDepth(event.shiftKey ? -1 : 1)
      return
    }
    if (event.key === 'Escape' && this.#newItemText) {
      event.preventDefault(); event.stopPropagation()
      this.#clearNewLine()
      this.#render()
    }
  }

  stepNewLineDepth(delta: number): void {
    const rows = this.listRows()
    const deepest = rows.length === 0 ? -1 : rows[rows.length - 1]!.depth
    this.#newItemDepth = Math.max(0, Math.min(this.newLineDepth() + delta, deepest + 1))
    this.#render()
  }

  /** Which line the next one hangs under — the last line one step shallower
   *  than the open line, or the list itself at depth 0. */
  #newLineParentId(): string | null {
    const root = this.listRoot()
    if (!root) return null
    const depth = this.newLineDepth()
    if (depth <= 0) return root.id
    const rows = this.listRows()
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i]!.depth === depth - 1) return rows[i]!.note.id
    }
    return root.id
  }

  commitNewItem(): void {
    const cellLabel = this.cell()
    const parentId = this.#newLineParentId()
    const text = this.#newItemText.trim()
    if (!cellLabel || !parentId || !text) return
    EffectBus.emit('note:add-child', { cellLabel, parentId, text, mark: null })
    this.#paintChildOptimistic(cellLabel, parentId, text)
    this.#clearNewLine()
    this.#render()
  }

  startItemEdit(item: Note, event?: Event): void {
    event?.stopPropagation()
    this.#editingItemId = item.id
    this.#itemDraft = this.noteDisplayText(item)
    this.#render()
    // Put the caret in the line, once it has rendered: a click that opens a
    // field you then have to click again is not an edit gesture, it is two.
    queueMicrotask(() => {
      const field = this.querySelector<HTMLInputElement>(
        `[data-hc-row="line-input:${globalThis.CSS.escape(item.id)}"], [data-hc-row="list-name-input"]`)
      if (!field) return
      field.focus()
      const end = field.value.length
      field.setSelectionRange(end, end)
    })
  }

  #onItemKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      this.commitItemEdit()
      return
    }
    // Tab on a line that already exists MOVES it: under the line above (Tab) or
    // back out to its parent's level (Shift+Tab).
    //
    // Text in flight is written FIRST and the move waits for it. A retext and a
    // move both re-sign the note and every ancestor, and the two writes race on
    // the same layer — the later commit reads the same prior and wins, so one
    // of them is silently lost. Nothing typed may be lost to a keypress that
    // means "move", so the indent is held BY POSITION and applied when the note
    // comes back.
    if (event.key === 'Tab') {
      event.preventDefault(); event.stopPropagation()
      const delta = event.shiftKey ? -1 : 1
      const noteId = this.#editingItemId
      const note = noteId ? this.listRows().find(r => r.note.id === noteId)?.note ?? null : null
      const draft = this.#itemDraft.trim()
      const dirty = !!note && !!draft && draft !== this.noteDisplayText(note)
      const path = note ? this.#linePathOf(note.id) : null
      this.commitItemEdit()
      if (dirty && path) this.#pendingIndent = { path, delta }
      else if (note) this.stepItemDepth(note.id, delta)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation()
      this.cancelItemEdit()
    }
  }

  /** Index path of a line inside the OPEN LIST. Collapse plays no part: this is
   *  the tree, not what is on screen. */
  #linePathOf(noteId: string): readonly number[] | null {
    const root = this.listRoot()
    if (!root) return null
    const walk = (nodes: readonly Note[], trail: readonly number[]): readonly number[] | null => {
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]!
        if (n.id === noteId) return [...trail, i]
        const found = walk(n.children, [...trail, i])
        if (found) return found
      }
      return null
    }
    return walk(root.children, [])
  }

  #lineAtPath(path: readonly number[]): Note | null {
    const root = this.listRoot()
    if (!root) return null
    let nodes: readonly Note[] = root.children
    let node: Note | null = null
    for (const i of path) {
      const pick = nodes[i]
      if (!pick) return null
      node = pick
      nodes = pick.children
    }
    return node
  }

  /** The reconcile came back — the line the participant asked to indent is at
   *  the same POSITION under a fresh id, so the move can go now. Clearing the
   *  request FIRST is what makes a repeated `notes:changed` a no-op. */
  #applyPendingIndent(): void {
    const pending = this.#pendingIndent
    if (!pending) return
    this.#pendingIndent = null
    const note = this.#lineAtPath(pending.path)
    if (note) this.stepItemDepth(note.id, pending.delta)
  }

  /** Indent (+1) or outdent (-1) one line of the open list.
   *
   *  Indent hangs the line under the sibling ABOVE it — the outline rule, and
   *  the only unambiguous parent a line has. A first line has none, so it stays
   *  put. Outdent puts it back among its parent's siblings, just after the
   *  parent; a line of the list itself has nowhere further out to go (that
   *  would take it off the list and onto the tile). */
  stepItemDepth(noteId: string, delta: number): void {
    const cellLabel = this.cell()
    const root = this.listRoot()
    if (!cellLabel || !root) return
    const rows = this.listRows()
    const at = rows.findIndex(r => r.note.id === noteId)
    if (at === -1) return
    const row = rows[at]!
    if (delta > 0) {
      if (row.index === 0) return  // no sibling above to hang under
      const above = rows.slice(0, at).reverse().find(r => r.parentId === row.parentId)
      if (!above) return
      EffectBus.emit('note:move', {
        cellLabel, sourceId: noteId,
        parentId: above.note.id, index: above.note.children.length,
      })
      return
    }
    if (row.parentId === root.id) return  // already a line of the list
    const parent = rows.find(r => r.note.id === row.parentId)
    if (!parent) return
    EffectBus.emit('note:move', {
      cellLabel, sourceId: noteId,
      parentId: parent.parentId, index: parent.index + 1,
    })
  }

  /** Save the line. Routed through `note:retext`, NOT the note form's commit: a
   *  line is nested by definition, and the commit path can only rewrite a
   *  cell's top-level entry. */
  commitItemEdit(): void {
    const cellLabel = this.cell()
    const noteId = this.#editingItemId
    const text = this.#itemDraft.trim()
    if (!cellLabel || !noteId) return
    if (!text) { this.cancelItemEdit(); return }
    EffectBus.emit('note:retext', { cellLabel, noteId, text })
    this.#paintTextOptimistic(cellLabel, noteId, text)
    this.cancelItemEdit()
  }

  cancelItemEdit(): void {
    if (this.#editingItemId === null && this.#itemDraft === '') return
    this.#editingItemId = null
    this.#itemDraft = ''
    this.#render()
  }

  /** Rename the open list itself — same in-place gesture as a line. */
  startListRename(event?: Event): void {
    const root = this.listRoot()
    if (root) this.startItemEdit(root, event)
  }

  /** "+ new list" — a fresh empty list at the top level. It has to be born
   *  carrying a list-role mark: classification reads the mark (or children, and
   *  a new list has none), so an unmarked new list would be filed on the notes
   *  tab and vanish from the tab that made it. */
  newList(): void {
    const cellLabel = this.cell()
    if (!cellLabel) return
    const title = t('notes.lists.newTitle', 'new list')
    const mark = this.#listMark()
    EffectBus.emit('note:commit', { cellLabel, text: title, mark })
    this.#paintOptimistic(cellLabel, title, null, mark)
    // The optimistic root is appended last, so the new list is the last entry
    // of the tab — open it and put the caret on its first line.
    this.#listPathIdx = [Math.max(0, this.visibleNotes().length - 1)]
    this.#newItemDepth = 0
    this.disarmListDelete()
    this.cancelItemEdit()
    this.#render()
  }

  /** A mark whose ROLE is list (or heading), minting one into the palette if
   *  the participant has emptied it. Never a hardcoded per-feature icon:
   *  whatever they have said means "list" is what a new list carries. */
  #listMark(): string | null {
    const listy = this.#marks.find(m => m.role === 'list') ?? this.#marks.find(m => m.role === 'heading')
    if (listy) return listy.icon
    const store = this.#markStore()
    if (!store) return null
    store.add('checklist', 'list')
    return 'checklist'
  }

  /** Take the whole list away — the list note and every line under it.
   *
   *  TWO CLICKS, no dialogue. The first arms the button (it says so, in the
   *  same red it will act in), the second acts; anything else — four seconds,
   *  or opening another list — disarms it. */
  deleteList(event?: Event): void {
    event?.stopPropagation()
    const cellLabel = this.cell()
    const root = this.listRoot()
    if (!cellLabel || !root) return
    if (!this.#listDeleteArmed) {
      this.#listDeleteArmed = true
      if (this.#listDeleteTimer) clearTimeout(this.#listDeleteTimer)
      this.#listDeleteTimer = setTimeout(() => this.disarmListDelete(), 4000)
      this.#render()
      return
    }
    this.disarmListDelete()
    this.remove(root.id, event ?? new Event('click'))
    // The list under this one takes its place — the pane is never left pointing
    // at something that isn't there.
    this.#listPathIdx = []
    this.#newItemDepth = 0
    this.cancelItemEdit()
    this.#render()
  }

  disarmListDelete(): void {
    if (this.#listDeleteTimer) { clearTimeout(this.#listDeleteTimer); this.#listDeleteTimer = null }
    if (this.#listDeleteArmed) { this.#listDeleteArmed = false; this.#render() }
  }

  // ── optimistic paints ────────────────────────────────────────────────
  //
  // Every one of these SETS a cell's tree to a new value. The authoritative
  // `notes:changed` re-read replaces it a moment later with the persisted
  // shape, and because it too is a SET, a repeated delivery of the same payload
  // lands on the same result. Nothing here appends to a ledger or counts.

  #setCellNotes(cell: string, next: readonly Note[]): void {
    const map = new Map(this.#notesByCell)
    map.set(cell, next)
    this.#notesByCell = map
  }

  /** Reflect a just-committed note so the strip paints the instant Enter is
   *  pressed — instead of waiting for the resource write, the leaf→root layer
   *  cascade and the `notes:changed` re-read. On EDIT the text is replaced in
   *  place (id and children kept) so the row does not flicker. */
  #paintOptimistic(cell: string, text: string, editId: string | null, mark: string | null = null): void {
    const current = this.#notesByCell.get(cell) ?? []
    if (editId) {
      this.#setCellNotes(cell, current.map(n => (n.id === editId ? { ...n, text, mark } : n)))
    } else {
      const pending: Note = { id: `pending-${++this.#pendingSeq}`, text, shape: null, mark, children: [] }
      this.#setCellNotes(cell, [...current, pending])
    }
    // The cell now has content — mark it warmed so the empty-state classifier
    // doesn't briefly flag it.
    this.#warmed.add(cell)
    this.#render()
  }

  #paintChildOptimistic(cell: string, parentId: string, text: string): void {
    const pending: Note = { id: `pending-${++this.#pendingSeq}`, text, shape: null, mark: null, children: [] }
    const walk = (nodes: readonly Note[]): Note[] =>
      nodes.map(n => (n.id === parentId
        ? { ...n, children: [...n.children, pending] }
        : { ...n, children: walk(n.children) }))
    this.#setCellNotes(cell, walk(this.#notesByCell.get(cell) ?? []))
  }

  #paintTextOptimistic(cell: string, noteId: string, text: string): void {
    const walk = (nodes: readonly Note[]): Note[] =>
      nodes.map(n => (n.id === noteId ? { ...n, text } : { ...n, children: walk(n.children) }))
    this.#setCellNotes(cell, walk(this.#notesByCell.get(cell) ?? []))
  }

  /** Paint a dropped mark immediately, at any depth, so the row responds to the
   *  gesture instead of waiting for the write + cascade. */
  #paintMarkOptimistic(cell: string, noteId: string, mark: string | null): void {
    const walk = (nodes: readonly Note[]): Note[] =>
      nodes.map(n => (n.id === noteId ? { ...n, mark } : { ...n, children: walk(n.children) }))
    this.#setCellNotes(cell, walk(this.#notesByCell.get(cell) ?? []))
    this.#render()
  }

  // ── the mark palette ─────────────────────────────────────────────────

  togglePaletteEdit(): void { this.#paletteEditing = !this.#paletteEditing; this.#render() }

  /** Click a rail icon: pick it for the draft, or clear it by picking the one
   *  already active. Swallowed when the press was really the start of a drag
   *  onto a note row. */
  pickMark(icon: string): void {
    if (this.#markDragMoved) { this.#markDragMoved = false; return }
    const next = this.#draftMark === icon ? null : icon
    this.#draftMark = next
    EffectBus.emit('notes:active-mark', { mark: next })
    this.#render()
  }

  /** "+" on the rail — borrow the shared Material icon chooser. `store: false`
   *  means nothing is written as an icon override: the name comes back here and
   *  becomes palette content instead. Null = the participant cancelled. */
  async addMarkIcon(): Promise<void> {
    const name = await requestIconPick({
      id: MARK_PICK_ID,
      store: false,
      title: t('notes.addMark', 'Add an icon'),
    })
    if (!isMarkIcon(name)) return
    this.#markStore()?.add(name)
    this.#draftMark = name
    EffectBus.emit('notes:active-mark', { mark: name })
    this.#render()
  }

  renameMark(icon: string, name: string): void {
    this.#markStore()?.rename(icon, name)
  }

  setMarkRole(icon: string, role: MarkRole): void {
    this.#markStore()?.setRole(icon, role)
  }

  removeMark(icon: string): void {
    this.#markStore()?.remove(icon)
    if (this.#draftMark === icon) this.pickMark(icon)   // clears the draft pick
  }

  // ── mark drag: a rail icon onto a note row ───────────────────────────
  //
  // The rail belongs to the WINDOW, so a dragged icon has to land on whatever
  // the pointer is actually over. Pointer-based (not HTML5 DnD) for the same
  // reason the row-reorder drag is: full control over the ghost and the drop
  // highlight, and no fight with the dataTransfer mime the palette pin gesture
  // already owns.
  onMarkPointerDown(icon: string, event: PointerEvent): void {
    if (event.button !== 0) return
    if (this.#dragPointerId !== null || this.#noteDragPointerId !== null) return
    this.#markDragPointerId = event.pointerId
    this.#markDragOrigin = { x: event.clientX, y: event.clientY, icon }
    this.#markDragMoved = false
    window.addEventListener('pointermove', this.#onMarkDragMove)
    window.addEventListener('pointerup', this.#onMarkDragEnd)
    window.addEventListener('pointercancel', this.#onMarkDragEnd)
  }

  #onMarkDragMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.#markDragPointerId) return
    const origin = this.#markDragOrigin
    if (!origin) return
    if (!this.#markDragMoved) {
      // Below the threshold the press is still a click-to-pick.
      if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 4) return
      this.#markDragMoved = true
      this.#markDragIcon = origin.icon
    }
    event.preventDefault()
    this.#markGhostX = event.clientX
    this.#markGhostY = event.clientY
    this.#markDropTargetId = this.#noteRowIdAt(event.clientX, event.clientY)
    this.#paintGhost()
    this.#paintDragStates()
  }

  #onMarkDragEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.#markDragPointerId) return
    const icon = this.#markDragOrigin?.icon ?? null
    const targetId = this.#markDropTargetId
    const dragged = this.#markDragMoved
    const cellLabel = this.cell()
    this.#markDragPointerId = null
    this.#markDragOrigin = null
    this.#markDragIcon = null
    this.#markDropTargetId = null
    window.removeEventListener('pointermove', this.#onMarkDragMove)
    window.removeEventListener('pointerup', this.#onMarkDragEnd)
    window.removeEventListener('pointercancel', this.#onMarkDragEnd)
    this.#paintGhost()
    this.#paintDragStates()
    if (!dragged || !icon || !targetId || !cellLabel) return
    // Dropping the icon a note already carries CLEARS it — the same toggle the
    // rail pick uses, so one gesture both marks and unmarks.
    const current = this.#findNote(cellLabel, targetId)?.mark ?? null
    const next = current === icon ? null : icon
    EffectBus.emit('note:mark', { cellLabel, noteId: targetId, mark: next })
    this.#paintMarkOptimistic(cellLabel, targetId, next)
  }

  /** Note id under a viewport point. The candidates are checked small-to-large
   *  so a LINE inside the pane wins over the pane itself. */
  #noteRowIdAt(x: number, y: number): string | null {
    const hit = (selector: string, attr: string): string | null => {
      const rows = Array.from(this.querySelectorAll<HTMLElement>(selector))
      for (const row of rows) {
        const r = row.getBoundingClientRect()
        if (x < r.left || x >= r.right || y < r.top || y >= r.bottom) continue
        return row.getAttribute(attr)
      }
      return null
    }
    return hit('article.cv2-note[data-note-id]', 'data-note-id')
      ?? hit('.cv2-peek-row[data-note-id]', 'data-note-id')
      ?? hit('.cv2-line[data-pheromone-note]', 'data-pheromone-note')
      ?? hit('.cv2-reading-scroll[data-pheromone-note]', 'data-pheromone-note')
  }

  // ── the tree: collapse / kebab / picker / nest / promote ─────────────

  toggleCollapse(noteId: string, event?: Event): void {
    event?.stopPropagation()
    const next = new Set(this.#collapsed)
    if (next.has(noteId)) next.delete(noteId)
    else next.add(noteId)
    this.#collapsed = next
    this.#render()
  }

  openKebab(noteId: string, event?: Event): void {
    event?.stopPropagation()
    this.#pickerOpenForId = null
    this.#kebabOpenId = this.#kebabOpenId === noteId ? null : noteId
    this.#render()
  }

  closeKebab(): void {
    if (this.#kebabOpenId === null) return
    this.#kebabOpenId = null
    this.#render()
  }

  openPicker(noteId: string, event?: Event): void {
    event?.stopPropagation()
    this.#kebabOpenId = null
    this.#pickerOpenForId = noteId
    this.#render()
  }

  closePicker(): void {
    if (this.#pickerOpenForId === null) return
    this.#pickerOpenForId = null
    this.#render()
  }

  /** Whether a note is currently nested (has any ancestor) — what the kebab
   *  uses to decide whether to surface "Promote". */
  isNested(noteId: string): boolean {
    const cell = this.cell()
    if (!cell) return false
    const tree = this.#notesByCell.get(cell) ?? []
    return !tree.some(n => n.id === noteId)
  }

  nestUnder(sourceId: string, targetParentId: string): void {
    const cell = this.cell()
    if (!cell || !sourceId || !targetParentId || sourceId === targetParentId) {
      this.closePicker()
      return
    }
    EffectBus.emit('note:nest', { cellLabel: cell, sourceId, targetParentId })
    this.closePicker()
    this.closeKebab()
  }

  promote(sourceId: string): void {
    const cell = this.cell()
    if (!cell || !sourceId) return
    EffectBus.emit('note:unnest', { cellLabel: cell, sourceId })
    this.closeKebab()
  }

  /** Valid nest targets for `sourceId`: every note in the cell's tree, minus
   *  itself, minus every descendant (cycle prevention), rendered flat with a
   *  depth hint. */
  nestCandidates(sourceId: string): readonly { id: string; text: string; shape: ShapeId | null; mark: string | null; depth: number }[] {
    const cell = this.cell()
    if (!cell) return []
    const tree = this.#notesByCell.get(cell) ?? []
    const forbidden = new Set<string>([sourceId])
    const collectDescendants = (nodes: readonly Note[]): void => {
      for (const n of nodes) {
        if (n.id === sourceId) {
          const drainDesc = (sub: readonly Note[]): void => {
            for (const c of sub) { forbidden.add(c.id); drainDesc(c.children) }
          }
          drainDesc(n.children)
          return
        }
        collectDescendants(n.children)
      }
    }
    collectDescendants(tree)
    const out: { id: string; text: string; shape: ShapeId | null; mark: string | null; depth: number }[] = []
    const walk = (nodes: readonly Note[], depth: number): void => {
      for (const n of nodes) {
        if (!forbidden.has(n.id)) {
          out.push({ id: n.id, text: this.noteDisplayText(n), shape: n.shape, mark: n.mark, depth })
        }
        walk(n.children, depth + 1)
      }
    }
    walk(tree, 0)
    return out
  }

  /** Click a row's body. Wherever the pane exists — docked and on the desk
   *  alike — the click SELECTS: the note lands in the pane, and editing is the
   *  pane's own affordance. Narrow fullscreen has no pane, so there the click
   *  opens the embedded editor as it always has. */
  onRowBodyClick(cellLabel: string, noteId: string, _event: Event, path?: readonly number[]): void {
    // The lists tab has its own pane — a row click there picks WHICH LIST (or
    // which list an item belongs to), never the prose editor.
    if (this.#tab === 'lists' && path) { this.openListPath(path); return }
    if (this.formInPane()) { this.selectNote(noteId); return }
    this.open(noteId, cellLabel)
  }

  /** Open the READER on the active tile. Two surfaces, two jobs: this strip
   *  authors, the reader reads. Nothing else emits `notes:open`. */
  openReader(): void {
    const cellLabel = this.cell()
    if (!cellLabel) return
    EffectBus.emit('notes:open', { cellLabel })
  }

  toggleFullscreen(): void {
    this.#fullscreen = !this.#fullscreen
    // An edit in flight rides across the switch: the pane exists on both sides
    // now, so it stays open. Only narrow fullscreen has no pane.
    this.#paneEditorOpen = this.formInPane() && !!this.#editingNoteId
    this.setPairWhen(this.#fullscreen)
    this.#syncDockExclusive()
    this.setInsetActive(false)
    EffectBus.emit('notes:expand-to-index', { cellLabel: this.cell(), fullscreen: this.#fullscreen })
    this.#render()
    this.#scheduleInset()
    // Fullscreen changes the panel width by the largest jump there is —
    // re-measure once the class has landed so the plate follows immediately.
    queueMicrotask(() => { this.#measurePanel(); this.#syncPanelResize() })
  }

  // ── panel drag-to-reposition ─────────────────────────────────────────
  // Translate delta from the natural centred baseline. {0,0} = the CSS-default
  // position; any non-zero delta is a drag we persist.

  #applyPanelTransform(): void {
    const p = this.#panelEl
    if (!p) return
    // Suppressed while docked — the rail is laid out by CSS, not the offset.
    if (this.#dockMode) p.style.removeProperty('transform')
    else p.style.transform = `translate(${this.#panelOffset.x}px, ${this.#panelOffset.y}px)`
  }

  #persistDock(): void {
    try { localStorage.setItem(NOTES_STRIP_DOCK_KEY, this.#dockMode ?? 'float') } catch { /* ignore */ }
  }

  #onDragStart = (event: PointerEvent): void => {
    // Don't initiate a drag from the mini buttons — they share the dragbar. The
    // buttons stop propagation themselves, but a primary-button-down on a
    // button still fires the bar's own handler.
    const tgt = event.target as HTMLElement | null
    if (tgt && tgt.closest('button, [role="button"], input')) return
    if (event.button !== 0) return
    if (this.#fullscreen) return  // position is forced; no-op
    event.preventDefault()
    this.#dragPointerId = event.pointerId
    this.#dragMoved = false
    this.#dragStart = {
      px: event.clientX, py: event.clientY,
      ox: this.#panelOffset.x, oy: this.#panelOffset.y,
    }
    window.addEventListener('pointermove', this.#onDragMove)
    window.addEventListener('pointerup', this.#onDragEnd)
    window.addEventListener('pointercancel', this.#onDragEnd)
    const stack = this.#stack()
    if (stack && !this.#dragModeActive) {
      stack.push(this.#notesDragMode)
      this.#dragModeActive = true
    }
  }

  #onDragMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.#dragPointerId) return
    const start = this.#dragStart
    if (!start) return
    if (!this.#dragMoved) {
      if (Math.hypot(event.clientX - start.px, event.clientY - start.py) < DRAG_THRESHOLD) return
      this.#dragMoved = true
    }
    const vw = window.innerWidth
    const docked = this.#dockMode === 'right'

    // Right-edge snap with hysteresis (mirrors the controls bar).
    if (event.clientX >= vw - SNAP_ZONE) {
      if (!docked) { this.#dockMode = 'right'; this.#onDockModeChanged() }
      return                                   // docked layout is CSS-driven
    }
    if (docked && event.clientX > vw - SNAP_EXIT) return   // hysteresis band

    if (docked) {
      // Leaving the rail → float. Re-baseline so the panel keeps its current
      // right-flush position instead of jumping to a stale float offset.
      const rebaseX = this.#rightDockOffsetX()
      this.#dockMode = null
      this.#panelOffset = { x: rebaseX, y: 0 }
      this.#onDockModeChanged()
      start.px = event.clientX
      start.py = event.clientY
      start.ox = rebaseX
      start.oy = 0
      return
    }

    // Clamp live (not on release): that is what stops the panel flying
    // off-screen mid-drag.
    this.#panelOffset = this.#clampOffsetCandidate({
      x: start.ox + (event.clientX - start.px),
      y: start.oy + (event.clientY - start.py),
    })
    this.#applyPanelTransform()
  }

  #onDockModeChanged(): void {
    this.#panelEl?.classList.toggle('dock-right', this.#dockMode === 'right')
    this.#applyPanelTransform()
    this.#syncDockExclusive()
    this.#scheduleInset()
  }

  /** Float-offset X that reproduces the docked (right-flush) position — the
   *  hand-off from rail to float. The host centres the panel, so flush-right
   *  sits (hostContentWidth − panelWidth)/2 right of centre. */
  #rightDockOffsetX(): number {
    const p = this.#panelEl
    if (!p) return 0
    const cs = getComputedStyle(this)
    const padL = parseFloat(cs.paddingLeft) || 0
    const padR = parseFloat(cs.paddingRight) || 0
    const hostContentW = this.clientWidth - padL - padR
    const panelW = p.getBoundingClientRect().width
    return Math.max(0, (hostContentW - panelW) / 2)
  }

  #onDragEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.#dragPointerId) return
    const moved = this.#dragMoved
    this.#dragPointerId = null
    this.#dragStart = null
    this.#dragMoved = false
    window.removeEventListener('pointermove', this.#onDragMove)
    window.removeEventListener('pointerup', this.#onDragEnd)
    window.removeEventListener('pointercancel', this.#onDragEnd)
    if (this.#dragModeActive) {
      this.#stack()?.pop(this.#notesDragMode.name)
      this.#dragModeActive = false
    }
    // A press that never crossed the threshold changed nothing — don't rewrite
    // the stores, and don't let a header click count as a reposition.
    if (!moved) return
    try {
      localStorage.setItem(NOTES_STRIP_OFFSET_KEY, JSON.stringify(this.#panelOffset))
    } catch { /* ignore */ }
    this.#persistDock()
  }

  /** The closest offset that keeps the ENTIRE panel inside the HOST's box (not
   *  the raw viewport — the host already starts below the header and ends above
   *  the controls pill). maxX/Y are floored at minX/Y so an oversized panel
   *  pins to the top-left instead of inverting. */
  #clampOffsetCandidate(candidate: { x: number; y: number }): { x: number; y: number } {
    const p = this.#panelEl
    if (!p) return candidate
    const rect = p.getBoundingClientRect()
    const current = this.#panelOffset

    const panelWidth = rect.right - rect.left
    const panelHeight = rect.bottom - rect.top
    const naturalLeft = rect.left - current.x
    const naturalTop = rect.top - current.y
    const newLeft = naturalLeft + candidate.x
    const newTop = naturalTop + candidate.y

    const host = this.getBoundingClientRect()
    const margin = 8
    const minLeft = host.left + margin
    const maxLeft = Math.max(minLeft, host.right - margin - panelWidth)
    const allowedLeft = Math.max(minLeft, Math.min(maxLeft, newLeft))
    // No top/bottom margin: the host already clears the header and the controls
    // pill, so a float should reach flush against both.
    const minTop = host.top
    const maxTop = Math.max(minTop, host.bottom - panelHeight)
    const allowedTop = Math.max(minTop, Math.min(maxTop, newTop))

    return {
      x: candidate.x + (allowedLeft - newLeft),
      y: candidate.y + (allowedTop - newTop),
    }
  }

  /** Double-click the dragbar → reset a float back to the centred default.
   *  Ignores the bar's buttons and does nothing while docked. */
  #onDragbarDoubleClick = (event: Event): void => {
    const tgt = event.target as HTMLElement | null
    if (tgt?.closest('button, [role="button"]')) return
    if (this.#dockMode) return
    this.#panelOffset = { x: 0, y: 0 }
    this.#applyPanelTransform()
    try { localStorage.removeItem(NOTES_STRIP_OFFSET_KEY) } catch { /* ignore */ }
  }

  // ── the edge resize handles ──────────────────────────────────────────
  // The native `resize: both` is ignored when overflow is visible (which the
  // palette popover needs), so the handles are the panel's own.
  #onResizeStart(event: PointerEvent, edge: 'corner' | 'left' | 'bottom'): void {
    if (event.button !== 0) return
    if (this.#dragPointerId !== null || this.#noteDragPointerId !== null) return
    if (this.#fullscreen) return  // size is forced; no-op
    event.preventDefault()
    event.stopPropagation()
    const p = this.#panelEl
    if (!p) return
    const rect = p.getBoundingClientRect()
    this.#resizePointerId = event.pointerId
    this.#resizeEdge = edge
    this.#resizeStart = { px: event.clientX, py: event.clientY, w: rect.width, h: rect.height }
    window.addEventListener('pointermove', this.#onResizeMove)
    window.addEventListener('pointerup', this.#onResizeEnd)
    window.addEventListener('pointercancel', this.#onResizeEnd)
  }

  #onResizeMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.#resizePointerId) return
    const start = this.#resizeStart
    const p = this.#panelEl
    if (!start || !p) return
    const hostRect = this.getBoundingClientRect()
    const minW = MIN_PANEL_WIDTH
    const minH = 80
    const maxW = Math.max(minW, hostRect.width - 16)
    const maxH = Math.max(minH, hostRect.height - 4)
    const dx = event.clientX - start.px
    const dy = event.clientY - start.py
    const edge = this.#resizeEdge
    // 'left' grows the width as the cursor moves left — docked right, the right
    // edge is pinned and only the left one moves.
    let w = edge === 'left' ? start.w - dx : start.w + dx
    let h = start.h + dy
    w = Math.max(minW, Math.min(maxW, w))
    h = Math.max(minH, Math.min(maxH, h))
    if (edge !== 'bottom') p.style.width = `${Math.round(w)}px`
    if (edge !== 'left') p.style.height = `${Math.round(h)}px`
    // Publish the new width as the drag happens, so the identity plate grows
    // and shrinks under the participant's hand rather than a frame later.
    this.#measurePanel()
  }

  #onResizeEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.#resizePointerId) return
    this.#resizePointerId = null
    this.#resizeStart = null
    window.removeEventListener('pointermove', this.#onResizeMove)
    window.removeEventListener('pointerup', this.#onResizeEnd)
    window.removeEventListener('pointercancel', this.#onResizeEnd)
    // The ResizeObserver catches the final size and persists it.
  }

  // ── note-row drag-reorder ────────────────────────────────────────────

  onNoteGripPointerDown(cellLabel: string, noteId: string, event: PointerEvent): void {
    if (event.button !== 0) return
    if (this.#dragPointerId !== null) return
    event.preventDefault()
    event.stopPropagation()
    const from = event.currentTarget as HTMLElement | null
    // Rows are hit-tested WITHIN the surface the drag started on: the desk
    // shows the same notes in two columns at the same heights, and a hit-test
    // over the whole panel would answer with whichever copy came first.
    this.#noteDragScope = from?.closest<HTMLElement>('[data-note-drag-scope]') ?? null
    this.#noteDragPointerId = event.pointerId
    this.#noteDragSourceId = noteId
    this.#noteDragSourceCell = cellLabel
    this.#noteDropTargetId = null
    this.#noteDropMode = null
    window.addEventListener('pointermove', this.#onNoteDragMove)
    window.addEventListener('pointerup', this.#onNoteDragEnd)
    window.addEventListener('pointercancel', this.#onNoteDragEnd)
    this.#paintDragStates()
  }

  #onNoteDragMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.#noteDragPointerId) return
    if (!this.#noteDragSourceCell) return

    const root = this.#noteDragScope ?? this
    const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-note-row][data-note-id]'))
    if (rows.length === 0) {
      this.#noteDropTargetId = null
      this.#noteDropMode = null
      this.#paintDragStates()
      return
    }

    const sourceId = this.#noteDragSourceId
    const y = event.clientY
    let hovered: HTMLElement | null = null
    let mode: 'before' | 'into' | 'after' | null = null

    // Upper third = before, middle = into, lower = after.
    for (const row of rows) {
      const r = row.getBoundingClientRect()
      if (y < r.top || y >= r.bottom) continue
      hovered = row
      const within = (y - r.top) / r.height
      if (within < 0.33) mode = 'before'
      else if (within < 0.67) mode = 'into'
      else mode = 'after'
      break
    }

    if (!hovered || !mode) {
      // Past the last row → root drop (un-nest), but only if the source isn't
      // already at the top level — otherwise it is a no-op with an indicator.
      const lastRect = rows[rows.length - 1]!.getBoundingClientRect()
      this.#noteDropTargetId = null
      this.#noteDropMode = (y >= lastRect.bottom && this.isNested(sourceId ?? '')) ? 'root' : null
      this.#paintDragStates()
      return
    }

    const targetId = hovered.getAttribute('data-note-id')
    if (!targetId || targetId === sourceId) {
      this.#noteDropTargetId = null
      this.#noteDropMode = null
      this.#paintDragStates()
      return
    }
    this.#noteDropTargetId = targetId
    this.#noteDropMode = mode
    this.#paintDragStates()
  }

  #onNoteDragEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.#noteDragPointerId) return
    const sourceId = this.#noteDragSourceId
    const sourceCell = this.#noteDragSourceCell
    const targetId = this.#noteDropTargetId
    const mode = this.#noteDropMode
    this.#noteDragPointerId = null
    this.#noteDragSourceId = null
    this.#noteDragSourceCell = null
    this.#noteDropTargetId = null
    this.#noteDropMode = null
    window.removeEventListener('pointermove', this.#onNoteDragMove)
    window.removeEventListener('pointerup', this.#onNoteDragEnd)
    window.removeEventListener('pointercancel', this.#onNoteDragEnd)
    const scope = this.#noteDragScope
    this.#noteDragScope = null
    this.#paintDragStates()
    if (!sourceId || !sourceCell) return

    // WHERE a drop lands is one question — which parent, which position — and
    // `note:move` is the one op that answers it, at any depth.
    const inList = scope?.dataset['noteDragScope'] === 'list'
    const listRootId = inList ? (this.listRoot()?.id ?? null) : null

    if (mode === 'into' && targetId) {
      EffectBus.emit('note:move', { cellLabel: sourceCell, sourceId, parentId: targetId })
      return
    }
    if (mode === 'root') {
      // On a list that means the last line OF THE LIST; on the tree it means
      // out from under every parent.
      EffectBus.emit('note:move', { cellLabel: sourceCell, sourceId, parentId: listRootId })
      return
    }
    // 'before' / 'after' → the target's parent, at the target's position. The
    // index is read against the siblings with the source already taken out,
    // which is the order the drone performs the move in.
    if ((mode === 'before' || mode === 'after') && targetId) {
      const spot = this.#placeOf(sourceCell, targetId)
      if (!spot) return
      const siblings = spot.siblings.filter(n => n.id !== sourceId)
      const targetPos = siblings.findIndex(n => n.id === targetId)
      if (targetPos === -1) return
      EffectBus.emit('note:move', {
        cellLabel: sourceCell, sourceId, parentId: spot.parentId,
        index: mode === 'after' ? targetPos + 1 : targetPos,
      })
    }
  }

  /** Where a note sits in its cell's tree: the id of the note it hangs under
   *  (null at the top level) and the siblings it sits among. */
  #placeOf(cell: string, noteId: string): { parentId: string | null; siblings: readonly Note[] } | null {
    const walk = (nodes: readonly Note[], parentId: string | null): { parentId: string | null; siblings: readonly Note[] } | null => {
      for (const n of nodes) {
        if (n.id === noteId) return { parentId, siblings: nodes }
        const found = walk(n.children, n.id)
        if (found) return found
      }
      return null
    }
    return walk(this.#allForCell(cell), null)
  }

  /** Release every window-level listener a gesture may have installed. */
  #releaseGestures(): void {
    window.removeEventListener('pointermove', this.#onDragMove)
    window.removeEventListener('pointerup', this.#onDragEnd)
    window.removeEventListener('pointercancel', this.#onDragEnd)
    window.removeEventListener('pointermove', this.#onResizeMove)
    window.removeEventListener('pointerup', this.#onResizeEnd)
    window.removeEventListener('pointercancel', this.#onResizeEnd)
    window.removeEventListener('pointermove', this.#onNoteDragMove)
    window.removeEventListener('pointerup', this.#onNoteDragEnd)
    window.removeEventListener('pointercancel', this.#onNoteDragEnd)
    window.removeEventListener('pointermove', this.#onMarkDragMove)
    window.removeEventListener('pointerup', this.#onMarkDragEnd)
    window.removeEventListener('pointercancel', this.#onMarkDragEnd)
    this.#dragPointerId = null
    this.#dragStart = null
    this.#resizePointerId = null
    this.#resizeStart = null
    this.#noteDragPointerId = null
    this.#markDragPointerId = null
    this.#markDragOrigin = null
    this.#markDragIcon = null
    if (this.#dragModeActive) {
      this.#stack()?.pop(this.#notesDragMode.name)
      this.#dragModeActive = false
    }
  }

  // ── the navigator's hover card ───────────────────────────────────────
  // Hovering a tile peeks at what is written on it without leaving the tile
  // being worked on. The notes are already in hand (the warmup resolves every
  // tile in the layer), so the card is a pure read: no fetch, no spinner.

  /** Card width used for the fits-on-this-side test. Mirrors the SCSS
   *  `width: min(360px, 46vw)`. */
  #peekWidth(): number { return Math.min(360, window.innerWidth * 0.46) }

  onChipEnter(cell: string, event: PointerEvent): void {
    // Touch/pen taps ACTIVATE the tile — a hover card would just sit in the way
    // with no pointer to dismiss it.
    if (event.pointerType && event.pointerType !== 'mouse') return
    this.#clearHoverTimers()
    const rect = (event.currentTarget as HTMLElement | null)?.getBoundingClientRect()
    this.#hoverOpenTimer = setTimeout(() => {
      if (rect) {
        this.#anchorBeside(rect, Math.min(this.#flatCount(this.#allForCell(cell)), HOVER_LIST_MAX))
      }
      this.#hoverCell = cell
      this.#render()
    }, HOVER_OPEN_DELAY)
  }

  onChipLeave(): void {
    this.#clearHoverTimers()
    this.#hoverCloseTimer = setTimeout(() => { this.#hoverCell = null; this.#render() }, HOVER_CLOSE_DELAY)
  }

  /** The pointer reached the CARD. Drop any hover instantly, so the pinned card
   *  is what is under the pointer.
   *
   *  Without this the card is unreachable in practice: the trip from a tile row
   *  to the card crosses other tile rows, each of which opens its own peek — the
   *  contents change under you mid-reach. */
  onPeekEnter(): void {
    this.#clearHoverTimers()
    if (this.#hoverCell !== null) { this.#hoverCell = null; this.#render() }
  }

  /** Exactly ONE of left/right is set (the other is cleared): the card opens on
   *  whichever side of the anchor has room, so it never covers the row the
   *  pointer is on — docked right it swings left, and in fullscreen (where the
   *  navigator is the left column) it swings right. */
  #anchorBeside(rect: DOMRect, rows: number): void {
    const width = this.#peekWidth()
    if (rect.left - width - 10 >= 8) {
      this.#hoverRight = Math.round(window.innerWidth - rect.left + 10)
      this.#hoverLeft = null
    } else {
      this.#hoverLeft = Math.round(Math.min(rect.right + 10, window.innerWidth - width - 8))
      this.#hoverRight = null
    }
    // Lift the card so a long list stays on screen instead of running off the
    // bottom. Counts the FLATTENED tree — nested notes are rows in the card too.
    const estimated = 52 + rows * 22
    this.#hoverTop = Math.round(Math.max(8, Math.min(rect.top - 6, window.innerHeight - estimated - 12)))
  }

  /** Anchor the pinned card beside the active tile's row — or, when that row
   *  isn't on screen (the filter scrolled it away, or the tile was picked on
   *  the canvas), beside the panel itself. */
  #anchorPinnedCard(): void {
    const active = this.querySelector<HTMLElement>('.cv2-tilechip.is-active')
    const rect = active?.getBoundingClientRect() ?? this.#panelEl?.getBoundingClientRect()
    if (!rect) return
    this.#anchorBeside(rect, Math.min(this.#flatCount(this.#allForCell(this.cell())), 18))
    this.#renderPeek()
  }

  #flatCount(list: readonly Note[]): number {
    let n = 0
    for (const note of list) n += 1 + this.#flatCount(note.children)
    return n
  }

  #clearHoverTimers(): void {
    if (this.#hoverOpenTimer) { clearTimeout(this.#hoverOpenTimer); this.#hoverOpenTimer = null }
    if (this.#hoverCloseTimer) { clearTimeout(this.#hoverCloseTimer); this.#hoverCloseTimer = null }
  }

  // ── the identity plate's picture ─────────────────────────────────────

  #measurePanel(): void {
    const p = this.#panelEl
    if (!p) return
    const w = Math.round(p.getBoundingClientRect().width)
    if (w > 0 && w !== this.#panelWidth) {
      const wasWide = this.plateWide()
      this.#panelWidth = w
      if (wasWide !== this.plateWide()) this.#render()
    }
  }

  /** Resolve the active tile's picture the way the renderer does: props sig →
   *  props blob → `small.image` sig → bytes → object URL. The canonical sig
   *  from the head layer is preferred (it is correct even for a tile this
   *  client has never painted); the participant-local render index is the
   *  fallback. A miss is normal — the hexagon shows the initial. */
  async #syncPlateImage(cell: string | null): Promise<void> {
    if (cell === this.#plateImageCell) return
    const token = ++this.#plateToken
    this.#plateImageCell = cell
    this.#revokePlateImage()
    if (!cell) return
    const url = await this.#resolveTileImage(cell).catch(() => null)
    if (token !== this.#plateToken) { if (url) URL.revokeObjectURL(url); return }
    this.#plateImageUrl = url
    this.#plateImage = url
    this.#render()
  }

  async #resolveTileImage(cell: string): Promise<string | null> {
    const store = get<StoreLike>('@hypercomb.social/Store')
    if (!store?.getResource) return null
    let propsSig = this.#factsByCell.get(cell)?.propsSig ?? null
    if (!propsSig) propsSig = await this.#indexedPropsSig(cell)
    if (!propsSig) return null
    const propsBlob = await store.getResource(propsSig)
    if (!propsBlob) return null
    let props: { small?: { image?: unknown }; flat?: { small?: { image?: unknown } } }
    try { props = JSON.parse(await propsBlob.text()) as typeof props } catch { return null }
    const raw = props?.small?.image ?? props?.flat?.small?.image
    if (typeof raw !== 'string' || !SIG_RE.test(raw)) return null
    const bytes = await store.getResource(raw)
    return bytes ? URL.createObjectURL(bytes) : null
  }

  /** Props sig from the participant-local render index — O(1) localStorage,
   *  keyed by locationSig with a bare-label fallback. Never a tree walk. */
  async #indexedPropsSig(cell: string): Promise<string | null> {
    let locSig = ''
    const history = get<HistoryServiceLike>('@diamondcoreprocessor.com/HistoryService')
    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    if (history?.sign) {
      const segments = [...(lineage?.explorerSegments?.() ?? []), cell]
      try { locSig = await history.sign({ explorerSegments: () => segments }) } catch { /* cold */ }
    }
    try {
      const idx = JSON.parse(localStorage.getItem(TILE_PROPS_INDEX_KEY) ?? '{}') as Record<string, string>
      const v = (locSig && idx[locSig]) || idx[cell]
      return (typeof v === 'string' && SIG_RE.test(v)) ? v : null
    } catch { return null }
  }

  #revokePlateImage(): void {
    if (this.#plateImageUrl) URL.revokeObjectURL(this.#plateImageUrl)
    this.#plateImageUrl = null
    this.#plateImage = null
  }

  // ── the embedded note form ───────────────────────────────────────────

  /** Back-compat alias — reading happens inline in the panel now. */
  open(noteId: string, cellLabel?: string): void { this.editNote(noteId, cellLabel) }

  /** Open a note for editing. Plain notes load into the form (prefilled with
   *  their RAW text so a legacy `[A:]` marker round-trips); QUESTIONS route to
   *  the tile editor, where Claude's Q/A flow lives. */
  editNote(noteId: string, cellLabel?: string): void {
    const cell = cellLabel ?? this.cell()
    if (!cell) return
    const note = this.#findNote(cell, noteId)
    if (!note) return
    if (this.noteKind(note) === 'q') {
      EffectBus.emit('tile:action', { action: 'edit', label: cell, q: 0, r: 0, index: 0 })
      return
    }
    this.#openForm(cell, { editId: noteId, prefill: note.text, mark: note.mark })
  }

  #findNote(cell: string, noteId: string): Note | undefined {
    const walk = (nodes: readonly Note[]): Note | undefined => {
      for (const n of nodes) {
        if (n.id === noteId) return n
        const found = walk(n.children)
        if (found) return found
      }
      return undefined
    }
    return walk(this.#notesByCell.get(cell) ?? [])
  }

  /** Open / focus the form for `cell`. `editId` set ⇒ edit mode. */
  #openForm(cell: string, opts?: { editId?: string | null; prefill?: string; mark?: string | null }): void {
    if (!cell) return
    this.#capturingFor = cell
    this.#show()                               // authoring turns the strip on
    this.#editingNoteId = opts?.editId ?? null
    this.#draftText = opts?.prefill ?? ''
    this.#draftKind = 'note'
    // Add mode starts unmarked; edit mode inherits the note's own mark so
    // saving round-trips it instead of silently stripping it.
    const mark = opts?.mark ?? null
    this.#draftMark = mark
    EffectBus.emit('notes:active-mark', { mark })
    // On the desk (and in the docked stack) the form lives in the pane —
    // opening it flips the pane from reading to writing.
    if (this.formInPane()) this.#paneEditorOpen = true
    this.#syncVisible()
    this.#render()
    this.#focusForm()
  }

  #focusForm(): void {
    queueMicrotask(() => {
      const area = this.#formInput
      if (!area || !area.isConnected) return
      area.focus()
      const end = area.value.length
      area.setSelectionRange(end, end)
    })
  }

  #onFormInput(): void {
    this.#draftText = this.#formInput?.value ?? ''
    // A keystroke changes the submit's label state and nothing else — mutating
    // the existing nodes, never a rebuild that would cost the caret.
    this.#syncFormState()
  }

  toggleDraftKind(): void {
    this.#draftKind = this.#draftKind === 'q' ? 'note' : 'q'
    this.#render()
  }

  /** Enter (no shift) commits; Esc cancels an edit or clears the draft,
   *  otherwise falls through to the panel's escape cascade. */
  #onFormKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      this.commitForm()
      return
    }
    if (event.key === 'Escape') {
      if (this.#editingNoteId) {
        event.preventDefault(); event.stopPropagation()
        this.cancelEdit()
      } else if (this.#draftText.trim()) {
        event.preventDefault(); event.stopPropagation()
        this.#draftText = ''
        this.#syncFormState()
      } else if (this.#paneEditorOpen) {
        // Empty add form in the pane — Esc puts the reader back.
        event.preventDefault(); event.stopPropagation()
        this.#paneEditorOpen = false
        this.#render()
      }
    }
  }

  /** Commit the form — append (add mode) or replace (edit mode) through the
   *  drone's `note:commit`, carrying the staged mark. */
  commitForm(): void {
    const cell = this.cell()
    if (!cell) return
    const text = this.#draftText.trim()
    if (!text) { this.cancelEdit(); return }
    const editId = this.#editingNoteId
    // A question is just a note carrying the `[Q] ` marker the rest of the
    // strip already keys off (noteKind, the kind filter, question styling).
    const finalText = this.#draftKind === 'q' && !/^\[Q\]\s/i.test(text) ? `[Q] ${text}` : text
    const mark = this.#draftMark
    EffectBus.emit('note:commit', { cellLabel: cell, text: finalText, mark, editId: editId ?? undefined })
    this.#paintOptimistic(cell, finalText, editId ?? null, mark)
    this.#draftText = ''
    this.#editingNoteId = null           // editing is one-shot → back to add
    // In the pane, saving an EDIT returns to reading (you were reading; the
    // note you fixed is under the glass). Saving an ADD keeps the editor up,
    // focused — the "keep adding" flow the docked form has always had.
    if (this.formInPane() && editId) {
      this.#paneEditorOpen = false
      this.#render()
      return
    }
    this.#render()
    this.#focusForm()
  }

  /** Drop out of edit mode back to a blank add form — and, in the pane, back to
   *  reading. */
  cancelEdit(): void {
    this.#editingNoteId = null
    this.#draftText = ''
    this.#draftKind = 'note'
    this.#draftMark = null
    EffectBus.emit('notes:active-mark', { mark: null })
    if (this.formInPane()) {
      this.#paneEditorOpen = false
      this.#render()
      return
    }
    this.#render()
    this.#focusForm()
  }

  /** Delete a single note. Optimistic like `commitForm`: the row vanishes on
   *  click; the drone's tree rewrite + cascade + `notes:changed` re-read is the
   *  authoritative reconcile. */
  remove(noteId: string, event: Event): void {
    event.stopPropagation()
    const cell = this.cell()
    if (!cell || !noteId) return
    const prune = (list: readonly Note[]): Note[] =>
      list.filter(n => n.id !== noteId)
        .map(n => (n.children.length ? { ...n, children: prune(n.children) } : n))
    this.#setCellNotes(cell, prune(this.#notesByCell.get(cell) ?? []))
    this.#render()
    EffectBus.emit('note:delete', { cellLabel: cell, noteId })
  }

  /** Make `cell` the active tile. Clears any in-progress edit — a different
   *  tile is a different document, so it starts at its first list, its first
   *  note, and no half-typed line carried across. */
  activateCell(cell: string): void {
    if (!cell) return
    this.#capturingFor = null
    this.#editingNoteId = null
    this.#draftText = ''
    this.#activeCell = cell
    this.#listPathIdx = []
    this.#readingIndex = 0
    this.#newItemDepth = 0
    this.disarmListDelete()
    this.cancelItemEdit()
    this.#clearNewLine()
    this.#onCellChanged()
  }

  /** Everything the Angular `effect(() => { cell() … })` chain did when the
   *  active tile changed. */
  #onCellChanged(): void {
    const cell = this.cell()
    // The popovers are cell-scoped — letting them persist across a switch would
    // surface stale note ids.
    this.#kebabOpenId = null
    this.#pickerOpenForId = null
    this.#readingIndex = 0
    this.#syncVisible()
    this.#render()
    this.#rail?.showCurrent?.(cell)
    void this.#syncPlateImage(cell)
    this.#warmup()
    if (cell) queueMicrotask(() => this.#anchorPinnedCard())
  }

  // ══ the wiring ═══════════════════════════════════════════════════════

  /** Folder navigation invalidates NotesService's cell-locationSig cache (the
   *  same label resolves differently per folder), so `notesFor()` starts
   *  returning [] for previously-warmed cells until `getNotes` runs again.
   *  Clear the warmed set in lockstep so the empty classifier doesn't treat the
   *  now-cold cache as authoritative. */
  #wireLineage(): void {
    const lineage = get<EventTarget>('@hypercomb.social/Lineage')
    if (!lineage?.addEventListener) return
    const onLineage = (): void => {
      this.#warmed = new Set()
      this.#notesByCell = new Map()
      this.#qaByCell = new Map()
      this.#factsByCell = new Map()
      this.#hoverCell = null
      // The active cell / capture target belong to the layer we just LEFT — the
      // same label resolves to a different location (or nothing) here. Keeping
      // them would pin the editor to a stale context and make the strip look
      // frozen after navigation; dropping them hands the panel back to the new
      // layer's navigator. Selection's change event re-establishes an active
      // cell if one is selected in the new layer.
      this.#activeCell = null
      this.#capturingFor = null
      this.#editingNoteId = null
      this.#draftText = ''
      this.#refreshLayerCellLabels()
      this.#syncVisible()
      this.#render()
      void this.#syncPlateImage(null)
    }
    lineage.addEventListener('change', onLineage)
    this.#offs.push(() => lineage.removeEventListener('change', onLineage))
  }

  /** `synchronize` is the processor's coalesced post-update tick — cells added
   *  or removed WITHIN a layer keep the navigator current. Lineage 'change'
   *  covers navigation between layers. */
  #wireSynchronize(): void {
    const onSync = (): void => this.#refreshLayerCellLabels()
    window.addEventListener('synchronize', onSync)
    this.#offs.push(() => window.removeEventListener('synchronize', onSync))
  }

  #wireProviders(): void {
    // The polls race the provider: CellSuggestionProvider refreshes its names
    // ASYNCHRONOUSLY after the same lineage-change / synchronize events, so a
    // synchronous read at event time still returns the PREVIOUS layer's names.
    // Subscribing to its own 'change' delivers the fresh list the moment it
    // exists. `whenReady` covers it registering after this element mounts.
    window.ioc?.whenReady?.<EventTarget>('@hypercomb.social/CellSuggestionProvider', (provider) => {
      const onChange = (): void => this.#refreshLayerCellLabels()
      provider.addEventListener('change', onChange)
      this.#offs.push(() => provider.removeEventListener('change', onChange))
      this.#refreshLayerCellLabels()
    })

    // SelectionService lives in a bee bundle that loads AFTER this element on
    // web. A synchronous get() returns undefined then, so the listener would
    // never be wired and `#activeCell` would stay null forever — the actual
    // cause of "notes don't show on selection on web".
    const wireSelection = (selection: SelectionService): void => {
      // Selection no longer drives WHAT the strip shows — the list is the whole
      // layer now. A tile click just marks that tile active.
      const sync = (): void => { this.#activeCell = selection.active; this.#onCellChanged() }
      sync()
      selection.addEventListener('change', sync)
      this.#selectionOff = () => selection.removeEventListener('change', sync)
    }
    const already = get<SelectionService>('@diamondcoreprocessor.com/SelectionService')
    if (already) wireSelection(already)
    else {
      window.ioc?.whenReady?.<SelectionService>(
        '@diamondcoreprocessor.com/SelectionService', wireSelection)
    }

    // Track NotesService availability so the warmup re-runs the moment the bee
    // registers — without it, a warmup that ran once before the bee loaded
    // (service undefined → early return) would never fire again.
    if (get('@diamondcoreprocessor.com/NotesService')) this.#notesServiceReady = true
    else {
      window.ioc?.whenReady?.('@diamondcoreprocessor.com/NotesService', () => {
        this.#notesServiceReady = true
        this.#warmup()
      })
    }
  }

  #wireEffects(): void {
    this.#offs.push(
      // The palette announces itself on EffectBus at load and on every change;
      // the replay covers this strip mounting before the notes module.
      EffectBus.on<NoteMarksChange>(NOTE_MARKS_CHANGED, (p) => {
        this.#marks = p?.marks ?? []
        this.#render()
      }),

      // ── The page's filter is the navigator's filter ──
      // When the participant narrows the page, the tiles on screen ARE the
      // working set. The filter effects say WHETHER a filter is on;
      // `render:cell-count` says WHICH tiles survived it. Both are
      // last-value-replayed, so a panel opened after the filter was set still
      // lands on the filtered list.
      EffectBus.on<{ labels?: readonly string[] }>('render:cell-count', (p) => {
        this.#renderedCellLabels = Array.isArray(p?.labels) ? [...p.labels] : []
        this.#render()
      }),
      EffectBus.on<{ active?: readonly string[] }>('tags:filter', (p) => {
        this.#tagFilterActive = (p?.active?.length ?? 0) > 0
        this.#render()
      }),
      EffectBus.on<{ keyword?: string }>('search:filter', (p) => {
        this.#searchFilterActive = !!(p?.keyword ?? '').trim()
        this.#render()
      }),

      // `notes:changed` is a STATE ASSERTION and fires on every edit — often
      // more than once for one gesture. Every write below SETS a map entry or
      // adds to a set, so a repeat lands on the same result; `#applyPendingIndent`
      // clears its request before acting, so a repeat is a no-op there too.
      // Nothing here appends to a ledger or counts.
      EffectBus.on<{ segments?: readonly string[] }>('notes:changed', (p) => {
        void this.#onNotesChanged(p)
      }),

      // Command-line capture: the strip pops in for the target tile while
      // authoring, even when that tile has no notes yet.
      EffectBus.on<{ mode: string; target: string; editId?: string }>('command:enter-mode', (p) => {
        if (p?.mode !== 'note-capture' || !p.target) return
        this.#capturingFor = p.target
        this.#show()           // authoring turns the strip on (and lights the toggle)
        this.#onCellChanged()
      }),
      EffectBus.on<{ mode: string }>('command:exit-mode', (p) => {
        if (p?.mode !== 'note-capture') return
        this.#capturingFor = null
        this.#onCellChanged()
      }),

      // The tile note button (and other external add affordances). The strip
      // OWNS this: it opens the in-panel form rather than routing into the
      // command line.
      EffectBus.on<{ cellLabel: string; prefill?: string; editId?: string }>('note:capture', (p) => {
        if (!p?.cellLabel) return
        // External capture affordances mean "write a NOTE" — land on the notes
        // tab so the row just written is in front of the participant (a prose
        // commit made from the lists tab would vanish into the other tab).
        this.setTab('notes')
        if (p.editId) { this.editNote(p.editId, p.cellLabel); return }
        this.#openForm(p.cellLabel, { prefill: p.prefill })
      }),

      // The control-bar Notes toggle. The SOLE on/off control now that passive
      // auto-open is gone.
      EffectBus.on<{ visible?: boolean }>('notes:panel', (p) => {
        const next = !!p?.visible
        if (!next) {
          // Closing must also drop any in-progress capture, or the
          // capture-keeps-it-open rule in `visible` would override the close.
          this.#capturingFor = null
          this.#draftText = ''
          this.#editingNoteId = null
        }
        // The header toggle is the participant asking for the window BY NAME —
        // the one gesture that must always be able to bring it back.
        if (next) this.#show()
        else this.#open = false
        this.#syncVisible()
        this.#announceOpen()
        this.#render()
      }),

      // THE PIPE WAS IMPURE. Angular's `t` pipe is `pure: false`, so every
      // change-detection tick re-resolved every string and `/language ja`
      // re-labelled an OPEN panel on the spot. An element renders when it
      // decides to, so the locale switch has to be a reason to render — else an
      // open strip keeps its old-locale tabs, placeholders, counts, kind chips
      // and both list-foot verbs until it is closed and reopened. Rebuilding is
      // safe: every row lives in a field, never in the DOM.
      EffectBus.on('locale:changed', () => {
        if (!this.#visible) return
        this.#relabel()
        this.#render()
      }),
    )
  }

  #wireViewport(): void {
    // A viewport resize moves the panel's own box (max-width, and fullscreen
    // where it IS the viewport) — re-measure so the plate's form follows, and
    // drop any open hover card, whose viewport anchor is now stale.
    const onResize = (): void => {
      this.#measurePanel()
      if (this.#hoverCell) { this.#clearHoverTimers(); this.#hoverCell = null; this.#render() }
    }
    window.addEventListener('resize', onResize)
    this.#offs.push(() => window.removeEventListener('resize', onResize))

    // The desk's breakpoint, so the form renders where the layout actually is:
    // shrinking below it mid-session moves the form back to the centre column.
    const deskQuery = window.matchMedia('(min-width: 1024px)')
    const onDesk = (): void => {
      this.#deskWide = deskQuery.matches
      if (!deskQuery.matches) this.#paneEditorOpen = false
      this.#render()
    }
    deskQuery.addEventListener('change', onDesk)
    this.#offs.push(() => deskQuery.removeEventListener('change', onDesk))
  }

  async #onNotesChanged(p?: { segments?: readonly string[] }): Promise<void> {
    // HiveParticipant emits with `segments` only — the cell label is the last
    // one. Both the notes AND the qa caches refresh so a freshly-committed
    // `[A:<qId>] …` answer surfaces at the same time as any qa-slot mutation in
    // the same cascade: one trigger keeps both halves of the comm channel in
    // lock-step.
    const cellLabel = Array.isArray(p?.segments) && p.segments.length > 0
      ? String(p.segments[p.segments.length - 1] ?? '').trim()
      : ''
    const svc = get<NotesService>('@diamondcoreprocessor.com/NotesService')
    if (svc && cellLabel) {
      const [fresh, facts] = await Promise.all([
        svc.getNotes(cellLabel),
        this.#loadCellFacts(cellLabel),
      ])
      this.#setCellNotes(cellLabel, fresh.slice())
      const qa = new Map(this.#qaByCell)
      qa.set(cellLabel, facts.qa)
      this.#qaByCell = qa
      this.#rememberFacts(cellLabel, facts)
      this.#warmed.add(cellLabel)
    }
    this.#render()
    this.#rail?.paint?.()
    // A line indented mid-edit waits here for its text to land.
    this.#applyPendingIndent()
  }

  /** Re-poll the current layer's cell labels — on connect, on lineage change
   *  and on `synchronize`, so the navigator always reflects the tiles actually
   *  present in this layer (added / removed / renamed). */
  #refreshLayerCellLabels(): void {
    const provider = get<{ roster?(): readonly { name: string }[]; suggestions(): readonly string[] }>(
      '@hypercomb.social/CellSuggestionProvider')
    // The ROSTER is the rail's list — one row per NAME, so a superseded
    // revision beside its replacement is one tile, not two. `suggestions()` is
    // the same tiles sorted for autocomplete: the fallback for an older build.
    const next = provider
      ? (provider.roster?.()?.map(row => row.name) ?? [...provider.suggestions()])
      : []
    const changed = !sameList(next, this.#layerCellLabels)
    this.#layerCellLabels = next
    // The rail walks the same level for itself; this poll is what says WHEN —
    // the panel already hears every event that can move the layer.
    this.#syncRail()
    this.#rail?.refresh?.()
    this.#warmup()
    if (changed) this.#render()
  }

  /** Warm the decoded-set cache for the active cell AND every tile in the layer
   *  (the navigator lists them all) so `notes()`, the navigator counts and the
   *  name-or-text filter classify accurately on first paint.
   *
   *  Per-cell promises rather than one `Promise.all`, so each cell flips into
   *  `#warmed` independently — fast cells don't wait on slow ones. */
  #warmup(): void {
    if (!this.#notesServiceReady) return
    const svc = get<NotesService>('@diamondcoreprocessor.com/NotesService')
    if (!svc) return
    const targets = new Set<string>()
    const c = this.cell()
    if (c) targets.add(c)
    for (const cell of this.#layerCellLabels) targets.add(cell)
    if (targets.size === 0) return
    for (const target of targets) {
      if (this.#warmed.has(target)) continue
      // Both sources in parallel so the strip surfaces the full comm transcript
      // (Claude's questions + the participant's notes) in one render pass.
      void Promise.all([svc.getNotes(target), this.#loadCellFacts(target)])
        .then(([notes, facts]) => {
          this.#setCellNotes(target, notes.slice())
          const qa = new Map(this.#qaByCell)
          qa.set(target, facts.qa)
          this.#qaByCell = qa
          this.#rememberFacts(target, facts)
          this.#warmed.add(target)
          this.#render()
          this.#rail?.paint?.()
          // A tile whose canonical props sig lands AFTER the switch (the read is
          // async) gets its hexagon filled in when it arrives, rather than
          // staying on the initial forever.
          if (target === this.cell() && facts.propsSig && !this.#plateImage) {
            this.#plateImageCell = null
            void this.#syncPlateImage(target)
          }
        })
        .catch(err => { console.error('[notes-strip] warmup failed', target, err) })
    }
  }

  #rememberFacts(cell: string, facts: CellFacts): void {
    const next = new Map(this.#factsByCell)
    next.set(cell, { childCount: facts.childCount, propsSig: facts.propsSig })
    this.#factsByCell = next
  }

  /** One read of a cell's head layer: its open questions, how many child tiles
   *  it holds, and the canonical props sig. Failures return empty — the strip
   *  degrades to showing notes only rather than throwing on a missing service. */
  async #loadCellFacts(cell: string): Promise<CellFacts> {
    const empty: CellFacts = { qa: [], childCount: 0, propsSig: null }
    const history = get<HistoryServiceLike>('@diamondcoreprocessor.com/HistoryService')
    const store = get<StoreLike>('@hypercomb.social/Store')
    if (!history || !store) return empty
    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    const parent = lineage?.explorerSegments?.() ?? []
    const segments = [...parent, cell]
    try {
      const locSig = await history.sign({ explorerSegments: () => segments })
      const layer = await history.currentLayerAt(locSig)
      if (!layer) return empty
      const children = (layer as { children?: unknown }).children
      const childCount = Array.isArray(children) ? children.length : 0
      const properties = (layer as { properties?: unknown }).properties
      const head = Array.isArray(properties) ? properties[0] : undefined
      const propsSig = (typeof head === 'string' && SIG_RE.test(head)) ? head : null

      const raw = (layer as { qa?: unknown }).qa
      if (!Array.isArray(raw)) return { qa: [], childCount, propsSig }
      const items: QaItem[] = []
      for (const sig of raw) {
        if (typeof sig !== 'string') continue
        try {
          const resolved = await store.resolve<{ qId?: string; question?: string }>(sig)
          if (resolved && typeof resolved.question === 'string') {
            items.push({
              qId: String(resolved.qId || sig.slice(0, 16)),
              question: resolved.question.trim(),
            })
          }
        } catch { /* skip a bad resource */ }
      }
      return { qa: items, childCount, propsSig }
    } catch {
      return empty
    }
  }

  // ── the hive's tile list, hosted ─────────────────────────────────────
  //
  // Not a list of its own: the very same component the chat window's sidebar
  // mounts, reached structurally through IoC. What differs is a PROFILE, not a
  // second list — this panel writes on the tiles of ONE location, so the list
  // does not walk; it has no chats; its badge counts NOTES; and its find box
  // searches what is written on a tile as well as what it is called.
  #mountRailIfPossible(): void {
    const host = this.#railHostEl
    if (!host || this.#rail) return
    const factory = get<TilesRailFactoryLike>('@diamondcoreprocessor.com/AgentTilesRailFactory')
    const rail = factory?.create?.({
      // `walk` is the load-bearing one: an older essentials build ignores the
      // profile entirely and would give a rail that walks INTO tiles, whose
      // rows name cells at another location — and this panel resolves a tile's
      // notes by NAME against the location it stands at. Rather than open the
      // wrong tile's notes, keep the panel's own chips.
      walk: false,
      chats: false,
      choose: false,
      badge: row => this.#cellCount(row.name),
      // Only ever a NARROWING: while the page shows a filtered set, the list
      // says so too. Unfiltered, the rail's own walk is the truth — gating it
      // on the panel's separately-refreshed labels would blank the list for as
      // long as that read lagged.
      admits: row => !this.pageFiltered() || this.#navigatorCellLabels().includes(row.name),
      matches: (row, query) => this.#matchesText(row.name, query),
      findLabel: t('notes.filterPlaceholder', 'find a tile…'),
      clickLabel: t('notes.openTile', 'open this tile’s notes'),
      onHover: (row, event) => {
        if (event) this.onChipEnter(row.name, event)
        else this.onChipLeave()
      },
    })
    if (!rail || typeof rail.showLevel !== 'function') return
    this.#rail = rail
    rail.onSubjectChanged = subject => { if (subject?.name) this.activateCell(subject.name) }
    rail.mount(host)
    rail.showLevel?.(this.platePath())
    rail.showCurrent?.(this.cell())
    this.#railMounted = true
    this.#tileListEl?.classList.add('has-rail')
    this.#render()
  }

  /** Put the rail on the level the panel is standing at, and re-read it. */
  #syncRail(): void {
    const rail = this.#rail
    if (!rail) return
    rail.showLevel?.(this.platePath())
    rail.showCurrent?.(this.cell())
  }

  // ── the panel's own resize observer ──────────────────────────────────
  //
  // Single sync point: attach when a `mode-rows` panel is in the DOM, detach
  // (and clear the inline dimensions) when it is not. Keeping every transition
  // here avoids the half-state where a mode toggle leaves a stale observer
  // pointed at a detached element.
  #syncPanelResize(): void {
    const p = this.#panelEl
    const isResizable = !!p && p.classList.contains('mode-rows')
    if (!isResizable) {
      if (this.#observingEl) {
        this.#resizeObserver?.disconnect()
        this.#observingEl.style.width = ''
        this.#observingEl.style.height = ''
        this.#observingEl = null
      }
      return
    }
    if (this.#observingEl === p) return
    this.#resizeObserver?.disconnect()
    this.#observingEl = p!
    this.#applyStoredDimensions(p!)
    // Seed the width before the first observer callback so the plate's first
    // paint is measured, not guessed.
    this.#measurePanel()
    this.#observePanelResize(p!)
  }

  #applyStoredDimensions(target: HTMLElement): void {
    // Width only. Height is intentionally NOT restored: the float panel is
    // content-height (so it stays freely draggable in 2D) and the docked rail
    // is full height — a persisted height would force the float full and lock
    // it to a horizontal drag line.
    let width: string | null = null
    try { width = localStorage.getItem(NOTES_STRIP_WIDTH_KEY) } catch { /* private mode */ }
    this.#applyingDimensions = true
    if (width && /^\d+$/.test(width)) target.style.width = `${width}px`
    queueMicrotask(() => { this.#applyingDimensions = false })
  }

  #observePanelResize(target: HTMLElement): void {
    let savePending = false
    this.#resizeObserver = new ResizeObserver((entries) => {
      // Width tracking runs BEFORE every persistence guard below: the identity
      // plate has to follow the panel even while dimensions are being applied
      // and while fullscreen (where the panel is widest and the plate matters
      // most, but nothing may be written to the participant's stored size).
      const last = entries[entries.length - 1]
      if (last) {
        const w = Math.round(last.contentRect.width)
        if (w > 0 && w !== this.#panelWidth) {
          const wasWide = this.plateWide()
          this.#panelWidth = w
          if (wasWide !== this.plateWide()) this.#render()
        }
      }
      if (this.#applyingDimensions) return
      // Never persist while fullscreen — the size is forced by the desk's
      // !important rules, not the participant's docked preference.
      if (this.#fullscreen) return
      if (savePending) return
      savePending = true
      requestAnimationFrame(() => {
        savePending = false
        const entry = entries[entries.length - 1]
        if (!entry) return
        const w = Math.round(entry.contentRect.width)
        // Width only. This is also the DOCKED width the shared chrome shares
        // with the window's group and reads its auto text size off, which is
        // why it is recorded here — past the fullscreen guard — and not off the
        // raw box.
        this.#dockWidth = w
        try { localStorage.setItem(NOTES_STRIP_WIDTH_KEY, String(w)) } catch { /* ignore */ }
        this.#applyOwnScale()
        // Whatever the window did to its own edges, the lane has to follow, and
        // the group's mates track it exactly as the base's grip does for a panel
        // it sizes. A width we were HANDED is not republished.
        this.#relayoutLane()
        if (this.group && w !== this.#sharedWidth) {
          this.#sharedWidth = w
          publishAttrs(this)
        }
      })
    })
    this.#resizeObserver.observe(target)
  }

  // ── the viewport inset (the hcDockInset job, for the PANEL) ──────────
  //
  // `hcDockInset="right"` with `[hcDockInsetActive]="dockSide() === 'right' &&
  // !isFullscreen()"`. The desk YIELDS to a right-docked toolwindow rather than
  // reserving an edge itself — reserving one would feed its own yield variable
  // and collapse the desk against itself.
  #installInset(): void {
    const target = this.#panelEl
    if (!target) return
    if (typeof ResizeObserver !== 'undefined') {
      this.#insetRo = new ResizeObserver(() => this.#scheduleInset())
      this.#insetRo.observe(target)
    }
    window.addEventListener('resize', this.#scheduleInset)
    this.#scheduleInset()
  }

  #teardownInset(): void {
    this.#insetRo?.disconnect()
    this.#insetRo = null
    window.removeEventListener('resize', this.#scheduleInset)
    if (this.#insetRaf) { cancelAnimationFrame(this.#insetRaf); this.#insetRaf = 0 }
    this.#emitInsetClear()
  }

  #scheduleInset = (): void => {
    if (this.#insetRaf) return
    this.#insetRaf = requestAnimationFrame(() => {
      this.#insetRaf = 0
      this.#emitInset()
    })
  }

  #emitInset(): void {
    const target = this.#panelEl
    const active = this.#visible && this.#dockMode === 'right' && !this.#fullscreen
    if (!active || !target) { this.#emitInsetClear(); return }
    const r = target.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) { this.#emitInsetClear(); return }
    // A FULL-BLEED sheet reserves NOTHING — on a phone the panel flips to a
    // full-width sheet in its own SCSS, and reporting the whole viewport as a
    // right-edge reservation squeezes the canvas host to zero width.
    const spansX = r.left <= 1 && r.right >= window.innerWidth - 1
    if (spansX) { this.#emitInsetClear(); return }
    EffectBus.emit('viewport:inset', {
      owner: this.#insetOwner, side: 'right',
      size: Math.max(0, window.innerWidth - r.left),
    })
  }

  #emitInsetClear(): void {
    EffectBus.emit('viewport:inset', { owner: this.#insetOwner, side: 'right', size: 0 })
  }

  // ── open / close / escape ────────────────────────────────────────────

  /** Turn the strip on. EVERY open path goes through here, because `#open` is
   *  only half of the visibility — the park flag sits OVER it. Asking for the
   *  window is the participant taking the shell's decision back, so an explicit
   *  open OVERRULES a lane park. The INSTALLER park still stands: a strip that
   *  reappeared there would float over somebody else's page with nothing left
   *  to put it away again. */
  #show(): void {
    if (!windowsParked()) this.#parked = false
    this.#open = true
    this.#syncVisible()
    this.#announceOpen()
  }

  /** The header "hide" button — turns the strip off. It stays off until the
   *  participant re-opens it via the control-bar toggle (or starts authoring);
   *  selecting another tile no longer reopens it. */
  hide(): void {
    // Close any open form locally so capture mode doesn't keep the strip open
    // after it has been turned off.
    this.#capturingFor = null
    this.#draftText = ''
    this.#editingNoteId = null
    this.#open = false
    this.#syncVisible()
    this.#announceOpen()
  }

  /** ONE level back per press: the icon picker, then the kebab, then
   *  fullscreen. False = nothing of ours was open, and the shell cascade
   *  carries on past us.
   *
   *  This was a `document:keydown.escape` HostListener whose comment claimed it
   *  stopped the global cascade for a handled press. It could not: the keymap
   *  listens on the WINDOW in the capture phase. Escape has ONE owner now
   *  (tool-windows.ts, reached through the session this window holds), and this
   *  is how the strip takes part in it — so there is no keydown listener here
   *  to give `keydown.escape` semantics to, in either implementation. */
  dismiss(): boolean {
    if (!this.#visible) return false
    if (this.#pickerOpenForId !== null) { this.closePicker(); return true }
    if (this.#kebabOpenId !== null) { this.closeKebab(); return true }
    if (this.#fullscreen) { this.toggleFullscreen(); return true }
    return false
  }

  /** Broadcast the toggle's open state so the control-bar Notes button lights
   *  up and toggles correctly. Tracks the INTENT (`#open`) rather than the
   *  visibility, so the button stays lit while notes mode is on even with no
   *  tile selected — but PARKED reads as shut, so the button never sits lit for
   *  a strip that isn't on screen. */
  #announceOpen(): void {
    EffectBus.emit('notes:panel-state', { open: this.#open && !this.#parked })
  }

  // ── input-mode stack ─────────────────────────────────────────────────
  #onNotesEnter = (): void => {
    if (this.#hoverActive) return
    const stack = this.#stack()
    if (!stack) return
    stack.push(this.#notesHoverMode)
    this.#hoverActive = true
  }

  #onNotesLeave = (): void => { this.#popNotesMode() }

  #popNotesMode(): void {
    if (!this.#hoverActive) return
    this.#stack()?.pop(this.#notesHoverMode.name)
    this.#hoverActive = false
  }

  #stack(): InputModeStackLike | undefined {
    return get<InputModeStackLike>('@diamondcoreprocessor.com/InputModeStack')
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
  customElements.define(SURFACE_NAME, NotesStripElement)
}

window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/NotesStripElement',
    element: SURFACE_NAME,
    order: 10,
  })
})
