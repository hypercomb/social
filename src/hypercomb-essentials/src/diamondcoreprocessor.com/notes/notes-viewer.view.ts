// notes-viewer.view.ts — THE NOTES READER, one tile's notes read as hexagons,
// as a framework-free custom element (everything-is-a-beehavior Phase 2:
// Angular panels leave the shell and ship as signed modules).
//
// A straight port of shared/ui/notes-viewer: same surface name
// (hc-notes-viewer), same order band (100), same effects in
// (`notes:open`, `notes:viewer-close`, `tags:view-state`, `notes:changed`)
// and the same effects out (`notes:viewer`, `tags:view-open`/`tags:view-close`,
// `note:tag`, `note:capture`). It lands in `notes/` beside notes.drone.ts —
// the drone that owns `notes:open`, `note:tag` and `note:capture`, and the
// service (`@diamondcoreprocessor.com/NotesService`) this reader reads from.
//
// WHAT IT IS FOR. The strip is for AUTHORING (a dense tree you edit in
// place). This is for READING: one note at a time, big, with its place in the
// tree shown around it. Three moves, and only three:
//
//   • SIDE TABS pick the HIERARCHY. A hierarchy is one ROOT note plus
//     everything nested under it — a tile with four root notes has four
//     tabs, each its own little document.
//   • PREV / NEXT walk the notes INSIDE that hierarchy, depth-first, and
//     WRAP at both ends. There is no first and no last; the cycle closes.
//     Running off the end is how you get back to the top, not a dead stop.
//   • Clicking any row in the outline jumps the focus straight there.
//
// Pheromones land here by DRAG. Open the Pheromones panel from the header and
// drag a keyword onto any row: the row advertises itself with
// `data-pheromone-note` (+ `data-pheromone-note-cell`), the tags panel's
// existing drag-out gesture spots it on release, and the keyword goes onto
// the NOTE (not the tile). That attribute PAIR is the contract — do not
// rename either half.
//
// Editing still delegates to the command line in capture mode. This surface
// reads and marks; it never grows its own text input.
//
// NOTES ARE THE PARTICIPANT'S OWN WORDS. `.viewer-focus-text` and
// `.viewer-point-text` render `note.text` WHOLE — `white-space:pre-wrap`,
// `overflow-wrap:anywhere`, no clamp, no ellipsis, no slice. The only place
// text is shortened is the rail tab preview, which was already a 34-character
// one-liner in the original and stays exactly that.
//
// LIFECYCLE NOTE. The Angular version wrapped its markup in `@if (visible())`,
// so nothing existed while the reader was closed. A registry-fed element is
// mounted ONCE at boot and stays, so the backdrop is built DETACHED and only
// attached while a tile is being read — `display:none` would still answer
// querySelector, and this surface sits at z-index 100002 over the whole hive.
//
// Its strings ship WITH it (notes-viewer.i18n.ts, extracted from all 14 shell
// catalogs) and register under the 'app' namespace, so every key resolves
// exactly as before — the Phase 2 catalog split, another slice.

import {
  EffectBus,
  I18N_IOC_KEY,
  attachWidgetZoom,
  holdWindow,
  type I18nProvider,
  type WindowSession,
} from '@hypercomb/core'
import { NOTES_VIEWER_TRANSLATIONS } from './notes-viewer.i18n.js'
import { flattenHierarchy, stepIndex } from '@hypercomb/core'

const SURFACE_NAME = 'hc-notes-viewer'

type ShapeId = 'circle' | 'square' | 'triangle' | 'diamond' | 'star' | 'hexagon'

/** The six legacy shapes the template branched on, one `[class.hc-shape-…]`
 *  each. A note carrying anything else gets NO shape class and falls back to
 *  the hexagon — same as the Angular original, where six explicit equality
 *  tests all came out false. */
const SHAPES: ReadonlySet<string> = new Set<string>([
  'circle', 'square', 'triangle', 'diamond', 'star', 'hexagon',
])

type Note = {
  id: string
  text: string
  shape: ShapeId | null
  /** Material icon name from the mark palette; supersedes `shape`. */
  mark: string | null
  /** Pheromones on the note itself. Older services predate the slot, so
   *  every read goes through `tagsOf()` rather than touching it directly. */
  tags?: string[]
  children: Note[]
}

type NotesService = {
  notesFor(cellLabel: string): Note[]
  getNotes(cellLabel: string): Promise<Note[]>
}

/** One row of the flattened hierarchy — the unit prev/next steps through. */
type Row = {
  readonly note: Note
  readonly depth: number
}

/** Side-rail entry — one per hierarchy, previewed by its root's text. */
type Tab = {
  readonly mark: string | null
  readonly shape: ShapeId | null
  readonly preview: string
  readonly count: number
}

// Same contract as the shell pipe: params drive `{token}` interpolation (none
// of this surface's keys are plural-shaped — en.json carries no `.one`/`.other`
// variant for any of them). The fallback is the English catalog text, and it
// interpolates the same tokens so a bare host with no i18n reads identically.
const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
  const value = i18n?.t(key, params)
  if (value && value !== key) return value
  if (!params) return fallback
  return fallback.replace(/\{(\w+)\}/g, (whole, token: string) =>
    token in params ? String(params[token]) : whole)
}

// The reader's strings travel with it — registered as soon as the i18n service
// is up, under 'app' so the keys resolve exactly as they always did. Three of
// them (`notes.edit`, `notes.close`, `notes.add.another`) and five more
// (`notes.viewer.prev` / `.next` / `.position` / `.untag` / `.dropHint`) are
// ALSO rendered by the notes strip, which is still shell-side: a surface must
// carry everything it renders, and `registerTranslations` merges rather than
// replaces, so the duplicate entry is correct and safe.
window.ioc?.whenReady?.(I18N_IOC_KEY, (i18n) => {
  const provider = i18n as I18nProvider
  for (const [locale, catalog] of Object.entries(NOTES_VIEWER_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

// ── the styles the Angular SCSS carried, expanded to plain CSS ────────────
// No shadow DOM (the tutorial-overlay + landing-badge precedent), so Angular's
// `:host` becomes the tag name and every other selector is prefixed with it —
// nothing can leak out of the reader. `display:contents` is kept from the
// original: the host must generate no box, so nothing blankets the hex canvas
// while the reader is closed (see _canvas-suppress.scss for the why).
//
// THE HEXAGON IS THE POINT ITEM everywhere — rail tab, big focus, outline
// bullet — at three sizes off one shape. `.hexdot-face` is the clipped shape;
// the mark icon rides ON TOP of it un-clipped (clipping a glyph shaves its
// corners off). Legacy shapes still paint: a note written before marks existed
// carries a `shape`, and the reader must not silently redraw it.
//
// THE BACKDROP IS POINTER-TRANSPARENT, and it must stay that way. Two reasons:
// the participant can still reach the strip behind the reader, AND the
// Pheromones panel docks to the right edge — dragging a keyword out of it onto
// a row is the tagging gesture, which a click-blocking backdrop would make
// impossible. Only the card catches pointer events.
//
// EXPANDED BY HAND from two mixins:
//   `@include tw.floating-panel(#ffe14a)` on `.viewer-card` — the four
//   `--hc-window-*` custom properties, the 0.98 slate material, the accent
//   border at 38%, radius 4px (`$radius-floating`), the lift shadow, the mono
//   face and #eef2f5 ink.
//   `@include tw.header` on `.viewer-header` — the 2.875rem band plus the
//   `> [class*='actions'] > button` action geometry (28px square, 2px radius).
//   The mixin's `[class*='close']` rules are NOT carried: the close button
//   here is a `.viewer-icon-btn`, so those selectors never matched.
// The tw ladder is literal — control 2px, card 3px, floating 4px, pill 999px.
// No @keyframes here, so nothing needs namespacing.
const CSS = `
${SURFACE_NAME}{display:contents}
${SURFACE_NAME} .hexdot{position:relative;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;width:16px;height:16px}
${SURFACE_NAME} .hexdot-face{position:absolute;inset:0;clip-path:polygon(25% 0%,75% 0%,100% 50%,75% 100%,25% 100%,0% 50%);background:color-mix(in srgb,var(--md-secondary) 55%,transparent)}
${SURFACE_NAME} .hexdot-icon{position:relative;font-size:10px;line-height:1;color:#0e0e16}
${SURFACE_NAME} .hexdot.hc-shape-circle .hexdot-face{clip-path:none;border-radius:50%}
${SURFACE_NAME} .hexdot.hc-shape-square .hexdot-face{clip-path:none;border-radius:2px}
${SURFACE_NAME} .hexdot.hc-shape-triangle .hexdot-face{clip-path:polygon(50% 8%,96% 92%,4% 92%)}
${SURFACE_NAME} .hexdot.hc-shape-diamond .hexdot-face{clip-path:polygon(50% 0%,100% 50%,50% 100%,0% 50%)}
${SURFACE_NAME} .hexdot.hc-shape-star .hexdot-face{clip-path:polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%)}
${SURFACE_NAME} .hexdot-big{width:72px;height:72px}
${SURFACE_NAME} .hexdot-big .hexdot-face{background:linear-gradient(160deg,color-mix(in srgb,var(--md-secondary) 92%,white 8%),color-mix(in srgb,var(--md-secondary) 62%,transparent))}
${SURFACE_NAME} .hexdot-big .hexdot-icon{font-size:34px}
${SURFACE_NAME} .viewer-backdrop{pointer-events:none;position:fixed;inset:0;z-index:100002;display:flex;align-items:center;justify-content:center;outline:none}
${SURFACE_NAME} .viewer-card{--hc-window-accent:#ffe14a;--hc-window-radius-control:2px;--hc-window-radius-card:3px;--hc-window-radius-floating:4px;background:rgba(13,15,21,.98);border:1px solid rgba(255,225,74,.38);border-radius:4px;box-shadow:0 18px 54px rgba(0,0,0,.55),inset 0 1px rgba(255,255,255,.03);font-family:var(--hc-mono,system-ui);color:#eef2f5;outline:none;pointer-events:auto;display:flex;flex-direction:column;width:min(760px,calc(100vw - 2rem));max-height:min(78vh,720px);overflow:hidden;transition:transform 140ms ease}
${SURFACE_NAME} .viewer-card.is-shifted{transform:translateX(-168px)}
@media (max-width:900px){${SURFACE_NAME} .viewer-card.is-shifted{transform:none}}
${SURFACE_NAME} .viewer-header{flex:0 0 auto;box-sizing:border-box;display:flex;align-items:center;gap:.5rem;height:2.875rem;min-height:2.875rem;padding:0 .75rem;line-height:1;background:linear-gradient(180deg,rgba(255,255,255,.018),rgba(255,255,255,.006));justify-content:space-between;border-bottom:1px solid rgba(255,225,74,.22)}
${SURFACE_NAME} .viewer-header > button,${SURFACE_NAME} .viewer-header > [class*='actions'] > button{box-sizing:border-box;display:inline-grid;place-items:center;min-width:1.75rem;height:1.75rem;padding:0 .25rem;border-radius:2px;line-height:1;transition:color 120ms ease,background-color 120ms ease,border-color 120ms ease}
${SURFACE_NAME} .viewer-header > button:hover,${SURFACE_NAME} .viewer-header > [class*='actions'] > button:hover{background-color:rgba(255,255,255,.055)}
${SURFACE_NAME} .viewer-header > button:focus-visible,${SURFACE_NAME} .viewer-header > [class*='actions'] > button:focus-visible{outline:1px solid color-mix(in srgb,var(--hc-window-accent) 72%,white);outline-offset:1px}
${SURFACE_NAME} .viewer-cell{font-size:.82rem;letter-spacing:.04em;color:color-mix(in srgb,var(--md-on-surface) 78%,transparent);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${SURFACE_NAME} .viewer-header-actions{display:flex;align-items:center;gap:2px}
${SURFACE_NAME} .viewer-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;background:transparent;border:1px solid transparent;border-radius:2px;color:color-mix(in srgb,var(--md-on-surface) 70%,transparent);cursor:pointer}
${SURFACE_NAME} .viewer-icon-btn .mat-sym{font-size:16px}
${SURFACE_NAME} .viewer-icon-btn:hover{background:rgba(255,255,255,.06);color:var(--md-on-surface)}
${SURFACE_NAME} .viewer-icon-btn.is-on{border-color:color-mix(in srgb,var(--md-secondary) 55%,transparent);background:color-mix(in srgb,var(--md-secondary) 18%,transparent);color:var(--md-on-surface)}
${SURFACE_NAME} .viewer-split{display:flex;min-height:0;flex:1 1 auto}
${SURFACE_NAME} .viewer-rail{flex:0 0 auto;width:172px;display:flex;flex-direction:column;gap:2px;padding:8px 6px;overflow-y:auto;border-right:1px solid rgba(255,255,255,.07)}
${SURFACE_NAME} .viewer-rail-tab{display:flex;align-items:center;gap:7px;width:100%;padding:6px 7px;background:transparent;border:1px solid transparent;border-radius:3px;color:color-mix(in srgb,var(--md-on-surface) 72%,transparent);font:inherit;font-size:.74rem;text-align:left;cursor:pointer}
${SURFACE_NAME} .viewer-rail-tab:hover{background:rgba(255,255,255,.05)}
${SURFACE_NAME} .viewer-rail-tab.is-active{background:color-mix(in srgb,var(--md-secondary) 14%,transparent);border-color:color-mix(in srgb,var(--md-secondary) 45%,transparent);color:var(--md-on-surface)}
${SURFACE_NAME} .viewer-rail-text{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${SURFACE_NAME} .viewer-rail-count{flex:0 0 auto;font-size:.66rem;color:color-mix(in srgb,var(--md-on-surface) 45%,transparent)}
${SURFACE_NAME} .viewer-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column}
${SURFACE_NAME} .viewer-focus{display:flex;align-items:flex-start;gap:18px;padding:18px 18px 12px}
${SURFACE_NAME} .viewer-focus-detail{flex:1 1 auto;min-width:0}
${SURFACE_NAME} .viewer-focus-depth{font-size:.66rem;letter-spacing:.06em;text-transform:uppercase;color:color-mix(in srgb,var(--md-on-surface) 42%,transparent);margin-bottom:4px}
${SURFACE_NAME} .viewer-focus-text{margin:0;font-size:1.06rem;line-height:1.55;color:#eef2f5;white-space:pre-wrap;overflow-wrap:anywhere}
${SURFACE_NAME} .viewer-tags{display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin-top:10px;min-height:20px}
${SURFACE_NAME} .viewer-tag{display:inline-flex;align-items:center;gap:4px;padding:1px 3px 1px 7px;border:1px solid color-mix(in srgb,var(--md-secondary) 45%,transparent);border-radius:999px;background:color-mix(in srgb,var(--md-secondary) 13%,transparent);font-size:.68rem;color:var(--md-on-surface)}
${SURFACE_NAME} .viewer-tag-off{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;padding:0;background:transparent;border:0;border-radius:50%;color:color-mix(in srgb,var(--md-on-surface) 55%,transparent);font:inherit;line-height:1;cursor:pointer}
${SURFACE_NAME} .viewer-tag-off:hover{background:rgba(255,255,255,.12);color:var(--md-on-surface)}
${SURFACE_NAME} .viewer-tags-hint{font-size:.66rem;color:color-mix(in srgb,var(--md-on-surface) 34%,transparent)}
${SURFACE_NAME} .viewer-cycle{display:flex;align-items:center;justify-content:center;gap:10px;padding:6px 18px 8px;border-bottom:1px solid rgba(255,255,255,.06)}
${SURFACE_NAME} .viewer-cycle-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:24px;padding:0;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:2px;color:color-mix(in srgb,var(--md-on-surface) 78%,transparent);cursor:pointer}
${SURFACE_NAME} .viewer-cycle-btn .mat-sym{font-size:17px}
${SURFACE_NAME} .viewer-cycle-btn:hover{background:color-mix(in srgb,var(--md-secondary) 16%,transparent);border-color:color-mix(in srgb,var(--md-secondary) 45%,transparent);color:var(--md-on-surface)}
${SURFACE_NAME} .viewer-cycle-pos{min-width:72px;text-align:center;font-size:.7rem;letter-spacing:.05em;color:color-mix(in srgb,var(--md-on-surface) 52%,transparent)}
${SURFACE_NAME} .viewer-outline{flex:1 1 auto;min-height:0;margin:0;padding:6px 12px 12px 0;list-style:none;overflow-y:auto}
${SURFACE_NAME} .viewer-point{display:flex;align-items:baseline;gap:8px;padding-top:4px;padding-bottom:4px;padding-right:8px;border-radius:3px;font-size:.83rem;line-height:1.45;color:color-mix(in srgb,var(--md-on-surface) 80%,transparent);cursor:pointer}
${SURFACE_NAME} .viewer-point:hover{background:rgba(255,255,255,.045)}
${SURFACE_NAME} .viewer-point.is-focused{background:color-mix(in srgb,var(--md-secondary) 12%,transparent);color:var(--md-on-surface)}
${SURFACE_NAME} .viewer-point .hexdot{align-self:flex-start;margin-top:3px}
${SURFACE_NAME} .viewer-point-text{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}
${SURFACE_NAME} .viewer-point-tags{display:inline-flex;flex-wrap:wrap;gap:3px;flex:0 0 auto}
${SURFACE_NAME} .viewer-point-tag{padding:0 5px;border-radius:999px;background:color-mix(in srgb,var(--md-secondary) 15%,transparent);font-size:.62rem;color:color-mix(in srgb,var(--md-on-surface) 72%,transparent)}
${SURFACE_NAME} .viewer-footer{flex:0 0 auto;display:flex;gap:6px;padding:8px 12px;border-top:1px solid rgba(255,255,255,.07)}
${SURFACE_NAME} .action{padding:.22em .56em;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:2px;color:color-mix(in srgb,var(--md-on-surface) 82%,transparent);font:inherit;font-size:.74rem;cursor:pointer}
${SURFACE_NAME} .action:hover{background:color-mix(in srgb,var(--md-secondary) 16%,transparent);border-color:color-mix(in srgb,var(--md-secondary) 45%,transparent);color:var(--md-on-surface)}
@media (max-width:599px){
${SURFACE_NAME} .viewer-card{width:calc(100vw - 1rem);max-height:86vh}
${SURFACE_NAME} .viewer-split{flex-direction:column}
${SURFACE_NAME} .viewer-rail{width:auto;flex-direction:row;gap:4px;overflow-x:auto;overflow-y:hidden;border-right:0;border-bottom:1px solid rgba(255,255,255,.07)}
${SURFACE_NAME} .viewer-rail-tab{width:auto;flex:0 0 auto;max-width:168px}
${SURFACE_NAME} .hexdot-big{width:52px;height:52px}
${SURFACE_NAME} .hexdot-big .hexdot-icon{font-size:24px}
${SURFACE_NAME} .viewer-focus{gap:12px;padding:12px}
${SURFACE_NAME} .viewer-focus-text{font-size:.98rem}
}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-notes-viewer', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

/** `<span class="mat-sym">name</span>` — Material Symbols render by ligature,
 *  so the glyph IS the text. The header/cycle glyphs each carried
 *  `aria-hidden="true"`; the MARK glyphs did not, because the hexagon wrapping
 *  them already does — hence the flag, copied per call site. */
const matSym = (ligature: string, ariaHidden = true): HTMLSpanElement => {
  const span = document.createElement('span')
  span.className = 'mat-sym'
  span.textContent = ligature
  if (ariaHidden) span.setAttribute('aria-hidden', 'true')
  return span
}

/** One-line preview of a note's text for the side rail. The ONE place this
 *  surface shortens a participant's words, and it shortened them in the
 *  original too — 34 characters, then an ellipsis. */
function preview(text: string): string {
  const raw = (text ?? '').replace(/\s+/g, ' ').trim()
  if (!raw) return '(empty)'
  return raw.length > 34 ? raw.slice(0, 31) + '…' : raw
}

/** How many notes a hierarchy holds, root included — the rail's badge. */
function countNotes(note: Note): number {
  let n = 1
  for (const child of note.children) n += countNotes(child)
  return n
}

/** Notes written before the `tags` slot existed simply have none. */
function tagsOf(note: Note | null | undefined): readonly string[] {
  return Array.isArray(note?.tags) ? note!.tags! : []
}

/** The hexagon's shape modifier, or none. Six explicit tests in the template;
 *  one membership test here, with the same outcome for every input. */
function shapeClass(shape: ShapeId | null | undefined): string {
  const value = String(shape ?? '')
  return SHAPES.has(value) ? ` hc-shape-${value}` : ''
}

/** The reader's nodes, minted together in #build and kept for the element's
 *  whole life. Everything here carries a listener or a scroll position, which
 *  is exactly why none of it is ever re-created — only its CONTENT is. */
type Chrome = {
  backdrop: HTMLDivElement
  card: HTMLDivElement
  cellLabel: HTMLSpanElement
  pheromoneButton: HTMLButtonElement
  closeButton: HTMLButtonElement
  split: HTMLDivElement
  rail: HTMLElement
  main: HTMLDivElement
  focusSection: HTMLElement
  cycle: HTMLDivElement
  prevButton: HTMLButtonElement
  position: HTMLSpanElement
  nextButton: HTMLButtonElement
  outline: HTMLOListElement
  editButton: HTMLButtonElement
  addButton: HTMLButtonElement
}

export class NotesViewerElement extends HTMLElement {

  /** Everything connectedCallback wired, torn down in one sweep. */
  #offs: Array<() => void> = []

  #chrome: Chrome | null = null

  /** The tile being read. Null = the reader is closed. This IS `visible`. */
  #cell: string | null = null
  /** Which root note (= which hierarchy) the side rail has selected. */
  #hierarchyIndex = 0
  /** Which row inside that hierarchy the big hexagon is showing. */
  #focusIndex = 0
  /** True while the Pheromones panel is open, so the card can step aside and
   *  leave the right-hand dock reachable for a drag. */
  #pheromonesOpen = false

  /** The tile being read, held while the hive is covered by the installer.
   *  The reader's whole visibility is `cell !== null`, so parking is "put the
   *  tile down, remember which one" — and the rail's hierarchy + the row in
   *  the big hexagon come back with it. */
  #parkedCell: string | null = null

  /** In the session's "showing" set exactly while the reader is up. */
  #releaseSession: (() => void) | null = null

  /** The live rail tabs / outline rows, and the fingerprint of the data they
   *  were built from. A REBUILD is the house pattern, but a rebuild on every
   *  prev/next would reset the outline's scrollTop (replaceChildren empties
   *  the box, and the browser clamps the scroll) and drop focus off a rail tab
   *  the instant it was activated. So the fingerprint answers "did the DATA
   *  change"; when it did not, the only thing touched is the one class that
   *  moved. Mutating an existing node on a position update is not a
   *  reconciler — there is no keying, no diffing and no reordering here. */
  #railSignature: string | null = null
  #railButtons: HTMLButtonElement[] = []
  #outlineSignature: string | null = null
  #outlineItems: HTMLLIElement[] = []
  #focusSignature: string | null = null

  // ── the window session ──────────────────────────────────────────────
  // Joining and leaving the session IS opening and closing, and the reader
  // opens from several places (`notes:open`, a landing, a cascade) — so it is
  // tracked off the visibility itself (#syncSession, called from #render)
  // rather than at each door.
  readonly #session: WindowSession = {
    park: () => {
      this.#parkedCell = this.#cell
      this.#cell = null
      EffectBus.emit('notes:viewer', { active: false })
      this.#render(true)
    },
    unpark: () => {
      const cell = this.#parkedCell
      this.#parkedCell = null
      if (!cell) return
      this.#cell = cell
      EffectBus.emit('notes:viewer', { active: true })
      this.#render(true)
    },
  }

  connectedCallback(): void {
    installCss()
    this.#build()

    const chrome = this.#chrome
    if (chrome) {
      // `hcWidget="notes-viewer" anchor="center"` — the directive was never
      // Angular-shaped; it is one function now, and it returns its own
      // teardown, so it drains with everything else.
      this.#offs.push(attachWidgetZoom(chrome.card, 'notes-viewer', 'center'))
    }

    this.#offs.push(
      // `noteId` is optional. With one, the reader opens ON that note —
      // selecting the hierarchy that contains it and focusing its row.
      // Without one, it opens on the first note of the first hierarchy.
      //
      // REPLAY, NOT A GESTURE: EffectBus hands a late subscriber the last
      // `notes:open` ever emitted. The Angular component subscribed from its
      // constructor and had exactly the same exposure, so this is faithful —
      // but it means a remount (or a module that loads after somebody has
      // already read a tile) re-opens the reader on that tile. The original
      // carried no guard and neither does this; flagged rather than changed.
      EffectBus.on<{ cellLabel: string; noteId?: string }>('notes:open', p => this.#onOpen(p)),

      // The cascade calls this when Escape lands while the reader is the
      // top-most dismissable surface. Guarded on being open, so the replay a
      // fresh subscription receives is a no-op.
      EffectBus.on('notes:viewer-close', () => { if (this.#visible) this.#close() }),

      EffectBus.on<{ open?: boolean }>('tags:view-state', (p) => {
        this.#pheromonesOpen = p?.open === true
        this.#render()
      }),

      // A STATE ASSERTION, delivered more than once per edit (the gesture's
      // eager emit, then the commit's post-commit reconcile). This handler
      // RE-READS and RE-RENDERS — it appends nothing and counts nothing — so a
      // repeat costs one extra read and lands on the identical DOM.
      EffectBus.on<{ segments?: readonly string[] }>('notes:changed', (p) => {
        void this.#onNotesChanged(p)
      }),

      // THE PIPE WAS IMPURE. The Angular original resolved every label through
      // the `t` pipe, declared `pure: false`, so every change-detection tick
      // re-read them and `/language ja` re-labelled an OPEN reader on the
      // spot. An element renders when it decides to, so the locale switch has
      // to be a reason to render — otherwise an open reader keeps its
      // old-locale header, cycle readout, depth line and both footer verbs
      // until the next note edit happens to arrive.
      EffectBus.on('locale:changed', () => this.#render(true)),
    )

    this.#render(true)
  }

  disconnectedCallback(): void {
    this.#offs.forEach(off => off())
    this.#offs = []
    // A surface that leaves must not leave the Escape cascade believing the
    // reader is still up — it holds `notesViewerActive` off this very effect,
    // and a stale true swallows the next Escape into a dead subscriber. The
    // Angular original never had to answer this (a registry-fed component is
    // never destroyed); an element can be.
    if (this.#visible) {
      this.#cell = null
      this.#hierarchyIndex = 0
      this.#focusIndex = 0
      EffectBus.emit('notes:viewer', { active: false })
    }
    this.#parkedCell = null
    this.#releaseSession?.()
    this.#releaseSession = null
    this.#chrome = null
    this.#railButtons = []
    this.#outlineItems = []
    this.#railSignature = null
    this.#outlineSignature = null
    this.#focusSignature = null
    this.replaceChildren()
  }

  // ── chrome (built once, detached) ────────────────────────────────────
  #build(): void {
    if (this.#chrome) return

    // `aria-modal=false` and a pointer-transparent backdrop are deliberate:
    // the Pheromones panel docks to the right edge and must stay reachable
    // while this is open, because dragging a keyword OUT of it and onto a row
    // is the whole tagging gesture.
    const backdrop = document.createElement('div')
    backdrop.className = 'viewer-backdrop'
    backdrop.tabIndex = -1
    backdrop.setAttribute('role', 'dialog')
    backdrop.setAttribute('aria-modal', 'false')
    backdrop.addEventListener('click', event => this.#onBackdrop(event))
    // The original bound `(keydown)` on THIS element, not a document
    // HostListener — so it is an ordinary element listener with ordinary
    // semantics, and `event.key === 'Escape'` is exactly what it meant. The
    // KeyEventsPlugin's modifier composition never applied here, so adding an
    // unmodified-only guard would itself be the regression.
    backdrop.addEventListener('keydown', event => this.#onKey(event))

    const card = document.createElement('div')
    card.className = 'viewer-card'
    // Read by the zoom arbiter: a wheel over the reader scrolls the reader
    // rather than zooming the hive.
    card.setAttribute('data-consumes-wheel', '')

    // ── header ────────────────────────────────────────────────────────
    const header = document.createElement('header')
    header.className = 'viewer-header'

    const cellLabel = document.createElement('span')
    cellLabel.className = 'viewer-cell'

    const actions = document.createElement('div')
    actions.className = 'viewer-header-actions'

    const pheromoneButton = document.createElement('button')
    pheromoneButton.type = 'button'
    pheromoneButton.className = 'viewer-icon-btn'
    pheromoneButton.addEventListener('click', () => this.#togglePheromones())
    pheromoneButton.append(matSym('blur_on'))

    const closeButton = document.createElement('button')
    closeButton.type = 'button'
    closeButton.className = 'viewer-icon-btn'
    closeButton.addEventListener('click', () => this.#close())
    closeButton.append(matSym('close'))

    actions.append(pheromoneButton, closeButton)
    header.append(cellLabel, actions)

    // ── split: rail | main ────────────────────────────────────────────
    const split = document.createElement('div')
    split.className = 'viewer-split'

    // One tab per HIERARCHY. Built once, attached only while there is more
    // than one — a single hierarchy needs no chooser, and an always-on rail of
    // one would just eat width.
    const rail = document.createElement('nav')
    rail.className = 'viewer-rail'
    rail.setAttribute('role', 'tablist')

    const main = document.createElement('div')
    main.className = 'viewer-main'

    // The focused note, large. Attached only while there IS one (the
    // template's `@if (focused(); as row)`).
    const focusSection = document.createElement('section')
    focusSection.className = 'viewer-focus'

    // The cycle: prev / position / next. Neither button is ever disabled —
    // the cycle wraps, so there is no end to run into, and styling one of them
    // dead would be a lie about the behaviour.
    const cycle = document.createElement('div')
    cycle.className = 'viewer-cycle'

    const prevButton = document.createElement('button')
    prevButton.type = 'button'
    prevButton.className = 'viewer-cycle-btn'
    prevButton.addEventListener('click', () => this.#prev())
    prevButton.append(matSym('chevron_left'))

    const position = document.createElement('span')
    position.className = 'viewer-cycle-pos'
    position.setAttribute('aria-live', 'polite')

    const nextButton = document.createElement('button')
    nextButton.type = 'button'
    nextButton.className = 'viewer-cycle-btn'
    nextButton.addEventListener('click', () => this.#next())
    nextButton.append(matSym('chevron_right'))

    cycle.append(prevButton, position, nextButton)

    // The hierarchy, as hexagon point items. `thin-scroll` is carried across
    // verbatim: it is inert (the rule only ever existed inside notes-strip's
    // own component sheet) and it was inert in the original too, so dropping
    // it would be the change, not keeping it.
    const outline = document.createElement('ol')
    outline.className = 'viewer-outline thin-scroll'

    main.append(cycle, outline)
    split.append(main)

    // ── footer ────────────────────────────────────────────────────────
    const footer = document.createElement('footer')
    footer.className = 'viewer-footer'

    const editButton = document.createElement('button')
    editButton.type = 'button'
    editButton.className = 'action edit'
    editButton.addEventListener('click', () => this.#edit())

    const addButton = document.createElement('button')
    addButton.type = 'button'
    addButton.className = 'action add'
    addButton.addEventListener('click', () => this.#addAnother())

    footer.append(editButton, addButton)

    card.append(header, split, footer)
    backdrop.append(card)

    this.#chrome = {
      backdrop, card, cellLabel, pheromoneButton, closeButton,
      split, rail, main, focusSection,
      cycle, prevButton, position, nextButton, outline,
      editButton, addButton,
    }
  }

  // ── state ────────────────────────────────────────────────────────────
  get #visible(): boolean { return this.#cell !== null }

  get #notes(): NotesService | undefined {
    return window.ioc?.get?.('@diamondcoreprocessor.com/NotesService') as NotesService | undefined
  }

  /** The tile's ROOT notes. Each one is a hierarchy: itself plus its
   *  descendants. Re-read on every render, which is what the Angular
   *  `#version` bump amounted to. */
  #hierarchies(): readonly Note[] {
    const cell = this.#cell
    if (!cell) return []
    return this.#notes?.notesFor(cell) ?? []
  }

  // ── the effects in ───────────────────────────────────────────────────
  #onOpen(payload: { cellLabel: string; noteId?: string } | undefined): void {
    const cellLabel = String(payload?.cellLabel ?? '').trim()
    if (!cellLabel) return
    this.#cell = cellLabel
    // Announce visibility so the global escape cascade can close us ahead of
    // clearing selection. Without this, Escape falls through to Priority 2 in
    // escape-cascade.ts and the reader stays open.
    EffectBus.emit('notes:viewer', { active: true })
    this.#render(true)

    const service = this.#notes
    // Warm the cache so the whole subtree is hydrated before we locate the
    // requested note — notesFor() reads sync and would otherwise see only the
    // nodes some other surface happened to have walked.
    const land = (): void => {
      this.#landOn(payload?.noteId)
      this.#render(true)
    }
    if (service) void service.getNotes(cellLabel).then(land, land)
    else land()
  }

  async #onNotesChanged(payload: { segments?: readonly string[] } | undefined): Promise<void> {
    const cell = this.#cell
    if (!cell) return
    const segments = payload?.segments
    const changed = Array.isArray(segments) && segments.length > 0
      ? String(segments[segments.length - 1] ?? '').trim()
      : ''
    // A write ANYWHERE re-reads: a tag drop rewrites the note's sig, so
    // holding the old id would strand the focus on a note that no longer
    // exists. Re-reading by POSITION is what keeps the reader steady across an
    // edit — the note at row 3 is still the note at row 3.
    if (changed && changed !== cell) return
    const service = this.#notes
    if (service) await service.getNotes(cell)
    // The reader may have been closed (or parked, or moved to another tile)
    // while that read was in flight. Answering for a tile nobody is looking at
    // any more would emit a second `notes:viewer` on the way out.
    if (this.#cell !== cell) return
    // The tile may have lost every note under us.
    if (this.#hierarchies().length === 0) { this.#close(); return }
    this.#render(true)
  }

  /** Point the rail + focus at `noteId`, or at the very first note when it
   *  isn't given (or has already been rewritten out of existence). */
  #landOn(noteId?: string): void {
    const roots = this.#hierarchies()
    if (roots.length === 0) return
    if (noteId) {
      for (let h = 0; h < roots.length; h++) {
        const flat: Note[] = []
        const walk = (note: Note): void => { flat.push(note); note.children.forEach(walk) }
        walk(roots[h]!)
        const index = flat.findIndex(note => note.id === noteId)
        if (index >= 0) {
          this.#hierarchyIndex = h
          this.#focusIndex = index
          return
        }
      }
    }
    this.#hierarchyIndex = 0
    this.#focusIndex = 0
  }

  // ── navigation ───────────────────────────────────────────────────────
  /** Pick a hierarchy. The focus resets to its root — a new document starts at
   *  the top, not wherever the last one happened to be. */
  #selectHierarchy(index: number): void {
    if (index < 0 || index >= this.#hierarchies().length) return
    this.#hierarchyIndex = index
    this.#focusIndex = 0
    this.#render()
  }

  /** Step the focus. WRAPS in both directions — this is a cycle, not a list
   *  with ends, so `next` on the last note lands on the first and `prev` on
   *  the first lands on the last. Both buttons stay live at every position;
   *  there is nothing to disable. (`stepIndex` is where the wrap arithmetic
   *  and its tests live — note-cycle.ts.) */
  #step(delta: number): void {
    const rows = this.#rowsNow()
    if (rows.length === 0) return
    this.#focusIndex = stepIndex(this.#focusIndex, delta, rows.length)
    this.#render()
  }

  #next(): void { this.#step(1) }
  #prev(): void { this.#step(-1) }

  /** Click a row in the outline → focus it. */
  #focusRow(index: number): void {
    if (index < 0 || index >= this.#rowsNow().length) return
    this.#focusIndex = index
    this.#render()
  }

  /** The rows of the ACTIVE hierarchy, computed fresh. Used by the two guards
   *  above, which the original expressed against the `rows()` computed. */
  #rowsNow(): readonly Row[] {
    const roots = this.#hierarchies()
    if (roots.length === 0) return []
    const root = roots[Math.min(this.#hierarchyIndex, roots.length - 1)] ?? null
    return flattenHierarchy(root)
  }

  // ── pheromones ───────────────────────────────────────────────────────
  /** Open (or close) the Pheromones panel next to the reader. Dragging a
   *  keyword out of it onto a row is what puts it on a note; the panel's own
   *  drag-out gesture does the work, and the rows advertise themselves with
   *  `data-pheromone-note`. */
  #togglePheromones(): void {
    EffectBus.emit(this.#pheromonesOpen ? 'tags:view-close' : 'tags:view-open', {})
  }

  /** Take one pheromone off the focused note (the chip's ×). */
  #removeTag(tag: string, event?: Event): void {
    event?.stopPropagation()
    const cellLabel = this.#cell
    const noteId = this.#focusedNow()?.note.id
    if (!cellLabel || !noteId) return
    EffectBus.emit('note:tag', { cellLabel, noteId, tag, add: false })
  }

  /** The note in the big hexagon. Index is clamped rather than trusted: a
   *  cascade can shrink the hierarchy under a held focus. */
  #focusedNow(): Row | null {
    const rows = this.#rowsNow()
    if (rows.length === 0) return null
    return rows[Math.min(this.#focusIndex, rows.length - 1)] ?? null
  }

  // ── editing (delegated) ──────────────────────────────────────────────
  /** Edit the focused note — routes to the command line in capture mode with a
   *  prefill, and closes the reader (capture mode owns the UI). */
  #edit(): void {
    const cellLabel = this.#cell
    const note = this.#focusedNow()?.note
    if (!cellLabel || !note) return
    EffectBus.emit('note:capture', {
      cellLabel,
      prefill: note.text,
      editId: note.id,
      shape: note.shape,
    })
    this.#close()
  }

  /** Add another note to this tile. */
  #addAnother(): void {
    const cellLabel = this.#cell
    if (!cellLabel) return
    EffectBus.emit('note:capture', { cellLabel })
    this.#close()
  }

  /** The single exit. Every path — ×, edit, add, backdrop, Escape, the
   *  cascade's `notes:viewer-close` — comes through here exactly once and
   *  announces the reader shut exactly once. */
  #close(): void {
    this.#cell = null
    this.#hierarchyIndex = 0
    this.#focusIndex = 0
    EffectBus.emit('notes:viewer', { active: false })
    this.#render()
  }

  /** Backdrop click → close. */
  #onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.#close()
  }

  /** Arrow keys walk the cycle; Escape closes. Arrows are the reading gesture
   *  here — nothing in this surface takes text. */
  #onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      this.#close()
      return
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      this.#next()
      return
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      this.#prev()
    }
  }

  // ── the window session ───────────────────────────────────────────────
  #syncSession(): void {
    const showing = this.#visible
    if (showing && !this.#releaseSession) {
      this.#releaseSession = holdWindow('notes-viewer', this.#session)
    } else if (!showing && this.#releaseSession) {
      this.#releaseSession()
      this.#releaseSession = null
    }
  }

  // ── rendering (rebuild on change — the house pattern, no reconciler) ──
  #render(force = false): void {
    this.#syncSession()
    const chrome = this.#chrome
    if (!chrome) return

    if (force) {
      this.#railSignature = null
      this.#outlineSignature = null
      this.#focusSignature = null
    }

    // `@if (visible())` DETACHED the whole subtree. Angular's `@if` removed the
    // node, and an overlay at z-index 100002 that merely claims to be hidden
    // still answers querySelector — so the backdrop genuinely leaves the DOM.
    // The node itself is kept, listeners and all; `replaceChildren` MOVES it
    // back in.
    if (!this.#visible) {
      chrome.backdrop.remove()
      return
    }
    if (chrome.backdrop.parentNode !== this) this.replaceChildren(chrome.backdrop)

    const cell = this.#cell ?? ''
    chrome.cellLabel.textContent = cell
    chrome.card.classList.toggle('is-shifted', this.#pheromonesOpen)
    chrome.pheromoneButton.classList.toggle('is-on', this.#pheromonesOpen)
    chrome.pheromoneButton.setAttribute('aria-pressed', String(this.#pheromonesOpen))
    this.#relabel()

    // ONE read of the service per render — the rail, the focus and the outline
    // must all describe the same tree, and notesFor() mints fresh objects on
    // every call.
    const roots = this.#hierarchies()
    const root = roots.length === 0
      ? null
      : roots[Math.min(this.#hierarchyIndex, roots.length - 1)] ?? null
    const rows: readonly Row[] = flattenHierarchy(root)
    const focusPosition = rows.length === 0
      ? 0
      : Math.min(this.#focusIndex, rows.length - 1) + 1
    const focused = rows.length === 0
      ? null
      : rows[Math.min(this.#focusIndex, rows.length - 1)] ?? null

    this.#renderRail(chrome, cell, roots)
    this.#renderFocus(chrome, cell, focused)
    chrome.position.textContent =
      t('notes.viewer.position', '{at} of {of}', { at: focusPosition, of: rows.length })
    this.#renderOutline(chrome, cell, rows, focusPosition)
  }

  /** Every string written once, re-resolved. Called on every render, which is
   *  what makes `locale:changed` enough — the impure-pipe rule. Title and
   *  aria-label carry the same key the template bound them to. */
  #relabel(): void {
    const chrome = this.#chrome
    if (!chrome) return

    chrome.backdrop.setAttribute('aria-label', t('notes.viewer.aria', 'notes reader'))

    const pheromones = t('notes.viewer.pheromones', 'pheromones — drag one onto a note to tag it')
    chrome.pheromoneButton.setAttribute('title', pheromones)
    chrome.pheromoneButton.setAttribute('aria-label', pheromones)

    const close = t('notes.close', 'close')
    chrome.closeButton.setAttribute('title', close)
    chrome.closeButton.setAttribute('aria-label', close)

    chrome.rail.setAttribute('aria-label', t('notes.viewer.hierarchies', 'note hierarchies'))

    const prev = t('notes.viewer.prev', 'previous note')
    chrome.prevButton.setAttribute('title', prev)
    chrome.prevButton.setAttribute('aria-label', prev)

    const next = t('notes.viewer.next', 'next note')
    chrome.nextButton.setAttribute('title', next)
    chrome.nextButton.setAttribute('aria-label', next)

    chrome.editButton.textContent = t('notes.edit', 'edit')
    chrome.addButton.textContent = t('notes.add.another', 'add another')
  }

  #renderRail(chrome: Chrome, cell: string, roots: readonly Note[]): void {
    const tabs: Tab[] = roots.map(root => ({
      mark: root.mark,
      shape: root.shape,
      preview: preview(root.text),
      count: countNotes(root),
    }))

    // `@if (tabs().length > 1)` — the original predicate, not its negation.
    if (tabs.length > 1) {
      const signature = JSON.stringify([cell, tabs])
      if (signature !== this.#railSignature) {
        this.#railSignature = signature
        this.#railButtons = tabs.map((tab, index) => {
          const button = document.createElement('button')
          button.type = 'button'
          button.className = 'viewer-rail-tab'
          button.setAttribute('role', 'tab')
          button.setAttribute('title', tab.preview)
          button.addEventListener('click', () => this.#selectHierarchy(index))

          const hexdot = document.createElement('span')
          hexdot.className = 'hexdot' + shapeClass(tab.shape)
          hexdot.setAttribute('aria-hidden', 'true')
          const face = document.createElement('span')
          face.className = 'hexdot-face'
          hexdot.append(face)
          if (tab.mark) {
            const icon = matSym(tab.mark, false)
            icon.classList.add('hexdot-icon')
            hexdot.append(icon)
          }

          const text = document.createElement('span')
          text.className = 'viewer-rail-text'
          text.textContent = tab.preview

          const count = document.createElement('span')
          count.className = 'viewer-rail-count'
          count.setAttribute('aria-hidden', 'true')
          count.textContent = String(tab.count)

          button.append(hexdot, text, count)
          return button
        })
        chrome.rail.replaceChildren(...this.#railButtons)
      }
      // The selected tab moves without a rebuild, so the button that was just
      // clicked keeps the focus it had — which is the whole point of the
      // signature above.
      this.#railButtons.forEach((button, index) => {
        const active = index === this.#hierarchyIndex
        button.classList.toggle('is-active', active)
        button.setAttribute('aria-selected', String(active))
      })
      if (chrome.rail.parentNode !== chrome.split) {
        chrome.split.insertBefore(chrome.rail, chrome.main)
      }
    } else {
      this.#railSignature = null
      this.#railButtons = []
      chrome.rail.replaceChildren()
      chrome.rail.remove()
    }
  }

  #renderFocus(chrome: Chrome, cell: string, focused: Row | null): void {
    // `@if (focused(); as row)` — the section is absent, not empty, when the
    // hierarchy holds nothing.
    if (!focused) {
      this.#focusSignature = null
      chrome.focusSection.replaceChildren()
      chrome.focusSection.remove()
      return
    }

    const note = focused.note
    const tags = tagsOf(note)
    const signature = JSON.stringify([
      cell, note.id, note.text, note.mark, note.shape, focused.depth, tags,
    ])
    if (signature !== this.#focusSignature) {
      this.#focusSignature = signature
      chrome.focusSection.setAttribute('data-pheromone-note', note.id)
      chrome.focusSection.setAttribute('data-pheromone-note-cell', cell)

      const hexdot = document.createElement('div')
      hexdot.className = 'hexdot hexdot-big' + shapeClass(note.shape)
      hexdot.setAttribute('aria-hidden', 'true')
      const face = document.createElement('span')
      face.className = 'hexdot-face'
      hexdot.append(face)
      if (note.mark) {
        const icon = matSym(note.mark, false)
        icon.classList.add('hexdot-icon')
        hexdot.append(icon)
      }

      const detail = document.createElement('div')
      detail.className = 'viewer-focus-detail'

      if (focused.depth > 0) {
        const depth = document.createElement('div')
        depth.className = 'viewer-focus-depth'
        depth.textContent =
          t('notes.viewer.depth', 'nested {depth} deep', { depth: focused.depth })
        detail.append(depth)
      }

      // The participant's own words, WHOLE. pre-wrap in the sheet; no clamp,
      // no ellipsis, no slice.
      const text = document.createElement('p')
      text.className = 'viewer-focus-text'
      text.textContent = note.text
      detail.append(text)

      // Pheromones ON THIS NOTE. Dropped here from the panel; each chip's ×
      // takes it back off.
      const tagRow = document.createElement('div')
      tagRow.className = 'viewer-tags'
      if (tags.length > 0) {
        for (const tag of tags) {
          const chip = document.createElement('span')
          chip.className = 'viewer-tag'
          const name = document.createElement('span')
          name.className = 'viewer-tag-name'
          name.textContent = tag
          const off = document.createElement('button')
          off.type = 'button'
          off.className = 'viewer-tag-off'
          off.textContent = '×'
          off.setAttribute('aria-label', t('notes.viewer.untag', 'remove {tag}', { tag }))
          off.addEventListener('click', event => this.#removeTag(tag, event))
          chip.append(name, off)
          tagRow.append(chip)
        }
      } else {
        // The `@empty` block.
        const hint = document.createElement('span')
        hint.className = 'viewer-tags-hint'
        hint.textContent =
          t('notes.viewer.dropHint', 'drag a pheromone here to tag this note')
        tagRow.append(hint)
      }
      detail.append(tagRow)

      chrome.focusSection.replaceChildren(hexdot, detail)
    }

    if (chrome.focusSection.parentNode !== chrome.main) {
      chrome.main.insertBefore(chrome.focusSection, chrome.cycle)
    }
  }

  #renderOutline(
    chrome: Chrome,
    cell: string,
    rows: readonly Row[],
    focusPosition: number,
  ): void {
    const signature = JSON.stringify([
      cell,
      rows.map(row => [
        row.note.id, row.depth, row.note.text, row.note.mark, row.note.shape, tagsOf(row.note),
      ]),
    ])
    if (signature !== this.#outlineSignature) {
      this.#outlineSignature = signature
      this.#outlineItems = rows.map((row, index) => {
        const item = document.createElement('li')
        item.className = 'viewer-point'
        item.style.paddingLeft = `${8 + row.depth * 18}px`
        // Each row IS a drop target for a pheromone drag — the tags panel
        // resolves this attribute PAIR on release.
        item.setAttribute('data-pheromone-note', row.note.id)
        item.setAttribute('data-pheromone-note-cell', cell)
        item.addEventListener('click', () => this.#focusRow(index))

        const hexdot = document.createElement('span')
        hexdot.className = 'hexdot' + shapeClass(row.note.shape)
        hexdot.setAttribute('aria-hidden', 'true')
        const face = document.createElement('span')
        face.className = 'hexdot-face'
        hexdot.append(face)
        if (row.note.mark) {
          const icon = matSym(row.note.mark, false)
          icon.classList.add('hexdot-icon')
          hexdot.append(icon)
        }

        const text = document.createElement('span')
        text.className = 'viewer-point-text'
        text.textContent = row.note.text

        item.append(hexdot, text)

        const tags = tagsOf(row.note)
        if (tags.length) {
          const chips = document.createElement('span')
          chips.className = 'viewer-point-tags'
          chips.setAttribute('aria-hidden', 'true')
          for (const tag of tags) {
            const chip = document.createElement('span')
            chip.className = 'viewer-point-tag'
            chip.textContent = tag
            chips.append(chip)
          }
          item.append(chips)
        }
        return item
      })
      chrome.outline.replaceChildren(...this.#outlineItems)
    }

    // `[class.is-focused]="$index === focusPosition() - 1"`. Moved rather than
    // rebuilt, so the outline keeps its scroll position across a prev/next —
    // emptying the box would clamp scrollTop to 0 on every step.
    const focusedIndex = focusPosition - 1
    this.#outlineItems.forEach((item, index) => {
      item.classList.toggle('is-focused', index === focusedIndex)
    })
  }
}

// ── shell surface registration — the externalization path ────────────────
// Same name, same order band the Angular component held; the module-side
// `element:` shape (documentation/shell-surfaces.md).
// DEFINED AT MODULE SCOPE, registered when a registry appears. A host with no
// ShellSurfaceRegistry (diamond-core-processor mounts tags directly in its own
// template) still needs the tag to be a real element rather than an inert
// unknown one — so the define cannot wait on the registry. Only the ADD does.
if (!customElements.get(SURFACE_NAME)) {
  customElements.define(SURFACE_NAME, NotesViewerElement)
}

window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/NotesViewerElement',
    element: SURFACE_NAME,
    order: 100,
  })
})
