// diamondcoreprocessor.com/presentation/tiles/tile-view.drone.ts
//
// THE DEFAULT FULLSCREEN TILE VIEW — the tile's own screen, on a phone.
//
// HOW IT OPENS: hold a tile and let go without moving.
//
// One hold, three outcomes, decided by what the hand does next — tap and you
// go INTO the tile; hold and PULL and you move it; hold and LET GO and this
// opens. On a phone the ring never enters the picture over a tile at all (see
// quick-menu.input's `#pendingView`), which is what leaves the pull free to be
// a move. On desktop the same view is the ring's zero-travel centre.
//
// AND IT IS THE ONLY PER-TILE SURFACE ON A PHONE. The desktop hover band is
// retired in mobile mode — it needs a pointer to rest on a tile before it
// appears and a 7px-accurate press to use, neither of which a finger does — so
// this screen carries the band's entire affordance set, asked for by label at
// mount time (`#overlayChips`). Nothing is hand-listed: a bee that registers
// an icon with the overlay appears here too.
//
// It is not one tile, either. The layer you were looking at is a row, and the
// view walks it — swipe left/right, or the next/previous chips — without
// closing and reopening.
//
// It opens full-screen with the tile's picture, its name, its notes, and its
// actions. HOW those actions are drawn depends on the device: a pointer gets
// the RAIL (bare glyph, caption under it, wrapping down the column), a phone
// gets the DECK — app-icon plates, four across, TWO ROWS, and the rest a page
// away. Same chips, same `run()`, one grammar; see `#appDeck`.
//
// LAST IN THE TAKEOVER ORDER. tile-overlay consults `#viewTakeoverFor(label)`
// first, so a tile carrying a deck (`slides`) or a gallery (`lightbox`)
// decoration still opens ITS view. This one needs no decoration at all — it is
// the fallback for the undecorated majority, which is exactly why it cannot be
// expressed as a ranked registry bee (the picker requires `hasDecorationKind`).
//
// IN PLACE, NEVER NAVIGATES. Like slides/lightbox it pins the segments it was
// opened for and mounts over the current layer, so closing drops you exactly
// where you tapped — no entrance collapse, no history entry.
//
// Chrome hiding is the owner-counted `ModeRegistry.enter('view:active', …)`
// (a doctrine ratchet forbids emitting `view:active` directly). It deliberately
// does NOT take a ViewMode mode string: (a) no hand-maintained TRANSIENT_MODES
// edit, so a stale persisted mode can never strand the hive on a blank screen,
// and (b) a non-silent `adopt:done` forces `viewMode.set('hexagons')` in both
// shells — a ViewMode-expressed takeover would be torn down mid-adopt by its
// own button.
//
// Because `view:active` hides hc-controls-bar (which carries the mobile back
// button), this view owns every way out: the exit button, a backdrop tap,
// Escape, right-click, and the hardware/browser BACK button — the one a phone
// user reaches for first, and the one no other takeover handles.
//
// YOU DO THINGS *INSIDE* THE TILE — the view does NOT close when you use it.
// Every verb here used to end in `close()`, so editing a note, opening the
// features panel or starting a creation dropped you back on the hive and the
// tile you were working on had to be found and held again. Now an action
// SUSPENDS the view instead: the card stays mounted underneath (every one of
// those surfaces sits at z ≥ 90000, well over TAKEOVER_Z), and when it goes
// the close-up is simply revealed again — with its notes and its action set
// rebuilt, so what you just did is visible in it.
//
// Suspension is measured, not guessed. `#watch` asks what is actually on top
// at the centre of the screen (`elementFromPoint`); while a real cover is
// there we hand back the chrome, HIDE the card (one surface at a time — a
// partial cover blending with the card underneath read as chaos, not layers),
// and stop owning Escape/back. The moment the cover goes we take everything
// back and re-mount. Nothing has to announce that it closed, so a bee that
// opens its own surface needs no cooperation from here — and an action that
// opens nothing at all (a toggle) never even flickers, because the chrome is
// only released once we are genuinely covered.
//
// THE CANVAS IS THE FLOOR, NEVER A COVER. Releasing the chrome un-hides
// #pixi-host, which sits at z 59989 — ABOVE this card — with a
// pointer-events:auto canvas. A naive "is the centre still ours" hit-test
// then returns the canvas forever: the release blinds the detector, the
// card never resumes, and the LIVE HIVE paints over the close-up (the
// "overlap and chaos" mobile bug). So cover-detection explicitly discounts
// #pixi-host (and bare body/html): a centre owned by the canvas means
// nothing app-level is over us, which is a reason to RESUME, not to stay
// suspended.
//
// Only four verbs still close: going inside (you have left), picking the tile
// (the picked set is a hive activity), the way out — and OPENING A VIEWER,
// which is a handover rather than a cover: the way back is recorded
// (`rememberCloseUpEntry`) and the viewer's own close brings this screen back,
// so "open as …" can be answered again without hunting the tile down and
// holding it a second time.

import { Drone, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { sniffImageMime } from '../../link/photo.js'
import { readTilePropsIndex, lookupTilePropsSig, cellLocationSig } from '../../editor/tile-properties.js'
import { hasDecorationKind } from '../../commands/decoration-kind-index.js'
import { nextTile, rememberCloseUpEntry, VIEW_ENTER_PREFIX } from './viewer-walk.js'
import type { VisualBeeDescriptor, VisualBeeRegistry } from '../../commands/visual-bee-registry.js'
import { isKindGloballyOff } from '../../sharing/behavior-enablement.js'
import { MOBILE_MODE_IOC_KEY } from '../../preferences/mobile-pheromones.js'

const SIG = /^[0-9a-f]{64}$/
/** ABOVE THE CANVAS FLOOR, deliberately — unlike the other takeovers' 59988.
 *  #pixi-host reparents to <body> at z 59989; the mode-based takeovers sit
 *  under it and rely on `view:active` hiding the canvas. This card cannot: it
 *  SUSPENDS (releasing `view:active` while covered), and any beat where the
 *  canvas is visible while the card is mounted painted the LIVE HIVE over the
 *  close-up — the mobile "overlap and chaos" bug. At 59990 the card beats the
 *  canvas even when the chrome is handed back. Still under the select pill
 *  (59992), edit-actions (59995), the bars (59999+) and every suspend cover
 *  (z ≥ 90000). */
const TAKEOVER_Z = 59990
const STEEL = 'rgba(126,182,214,0.92)'
const DIM = 'rgba(207,226,238,0.62)'
/** Thumb-target floor. The desktop band's 3rem circles are a cursor size —
 *  and 3.25 was still a compromise: this is the only menu a phone gets, so a
 *  cell is a comfortable target with room for a glyph you can actually see. */
const TAP = '4.6rem'
/** The hive's hexagon, exactly: point-top, √3/2 wide for its height. Same
 *  numbers the aggregate-index and collections-landing hexes use — a tile in
 *  close-up must be the same shape as the tile you tapped. */
const HEX_CLIP = 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)'
const HEX_RATIO = '0.866'
/** Travel that makes a horizontal drag a step to the next tile. Roughly a
 *  thumb's width — under it, a finger resting and lifting is still a tap. */
const SWIPE_PX = 56
/** Travel that commits a drag FROM the hexagon to one of its six faces.
 *  Shorter than the row-walk swipe: this gesture is AIMED at a labelled face,
 *  not thrown across the screen. */
const FACE_PX = 44
/** Room the hex zone reserves around the hexagon for the face captions. */
const FACE_PAD = '1.7rem'
/** How far past its edge a face's caption sits, along the edge normal. */
const FACE_OUT = '1.05rem'
/** The six faces of the point-top hexagon, in swipe-sector order: the sector
 *  index is `round(angle / 60°) mod 6` with 0° pointing east and angles
 *  counter-clockwise, so the array IS the lookup table. */
const FACE_DIRS = ['e', 'ne', 'nw', 'w', 'sw', 'se'] as const
type FaceDir = (typeof FACE_DIRS)[number]
/** Where each face's caption sits (percent of the hexagon's box), how the
 *  text is rotated to lie along its edge, and which way "outward" is after
 *  that rotation (translateY sign). Point-top hexagon: two vertical side
 *  edges, four sloped ones at ±30°. */
const FACE_GEOMETRY: Record<FaceDir, { x: number; y: number; rotate: number; out: 1 | -1 }> = {
  ne: { x: 75, y: 12.5, rotate: 30, out: -1 },
  e: { x: 100, y: 50, rotate: 90, out: -1 },
  se: { x: 75, y: 87.5, rotate: -30, out: 1 },
  sw: { x: 25, y: 87.5, rotate: 30, out: 1 },
  w: { x: 0, y: 50, rotate: -90, out: -1 },
  nw: { x: 25, y: 12.5, rotate: -30, out: -1 },
}

/** Chrome the inline styles cannot express — pressed feedback on the menu
 *  cells and the hot-face brightening — installed once, document-wide. The
 *  drone builds its DOM imperatively, so this is its stylesheet. */
const VIEW_CSS = `
#hc-tile-view-host [data-hc-tv-chip] { transition: background 0.12s ease, color 0.12s ease, opacity 0.12s ease; -webkit-tap-highlight-color: transparent; }
#hc-tile-view-host [data-hc-tv-chip]:active { background: rgba(126,182,214,0.16); }
#hc-tile-view-host [data-hc-tv-face] { transition: color 0.12s ease, opacity 0.12s ease; -webkit-tap-highlight-color: transparent; }
#hc-tile-view-host [data-hc-tv-face][data-hot] { color: rgba(126,182,214,1); opacity: 1; }
#hc-tile-view-host [data-hc-tv-app] { transition: transform 0.13s ease, opacity 0.13s ease; -webkit-tap-highlight-color: transparent; }
#hc-tile-view-host [data-hc-tv-app]:active { transform: scale(0.9); }
#hc-tile-view-host [data-hc-tv-app] [data-role="app-name"] { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
#hc-tile-view-host [data-hc-tv-deck] { scrollbar-width: none; }
#hc-tile-view-host [data-hc-tv-deck]::-webkit-scrollbar { width: 0; height: 0; display: none; }
#hc-tile-view-host [data-hc-tv-dot] { transition: background 0.16s ease; -webkit-tap-highlight-color: transparent; }
#hc-tile-view-host [data-hc-tv-page-arrow] { transition: opacity 0.16s ease; -webkit-tap-highlight-color: transparent; }
`
let viewCssInstalled = false
const installViewCss = (): void => {
  if (viewCssInstalled || typeof document === 'undefined') return
  viewCssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-tile-view-css', '')
  style.textContent = VIEW_CSS
  document.head.appendChild(style)
}
/** THE CELL'S OWN SIZE DECIDES THE COLUMNS, not a fixed count.
 *
 *  A hard five-across meant every cell shrank as the column narrowed — on a
 *  phone the glyphs ended up smaller than the words under them, which is a
 *  menu you cannot read and cannot hit. Now each cell has a MINIMUM it will
 *  not go below and grows to share whatever width there is: three across on a
 *  narrow column, four or five on a wide one, always at a legible size. */
const CELL_MIN = '5.4rem'
/** Ceiling, so a wide desktop column gives more COLUMNS rather than a row of
 *  enormous buttons. */
const CELL_MAX = '7.5rem'
/** ONE COLUMN, ONE WIDTH. The hexagon, the name, the notes and every row of
 *  icons are laid on the same axis at the same width — a close-up of a tile
 *  reads as one object, not a stack of differently-sized blocks. (Before this
 *  the hexagon was `min(66vw,19rem)` and the icon rows `24rem`: on a phone the
 *  menu was visibly wider than the tile it belonged to.) */
const COLUMN = 'min(100%, 23rem)'
/** The hexagon inside that column — inset, so the column's edge is a margin
 *  around the tile rather than a line the tile touches. */
const HEX_PORTRAIT = 'min(68vw, 17rem)'
/** THE SAME HEXAGON, MADE ROOM FOR. With the deck under it the column is no
 *  longer a list that scrolls — it is a fixed block that has to LAND on the
 *  screen, and at 375×812 the full-size hexagon leaves it exactly nothing.
 *  Measured: hexagon, name, a readable note and two rows of icons plus their
 *  dots and dock fit at this size and overflow at the other. */
const HEX_PORTRAIT_DECK = 'min(58vw, 14.5rem)'
/** How much of the tile's note the deck layout shows before the note scrolls
 *  inside itself: about three lines. The whole note is one tap away in the
 *  note editor; what belongs on this screen is enough to recognise the tile
 *  by. Without a cap the note either eats the menu or — worse, and what it
 *  actually did — gets squeezed by it to a clipped sliver of one line. */
const NOTE_PEEK = '4.4rem'
/** THE VERTICAL RHYTHM, and the only source of it. Vertical space used to come
 *  from a flex `gap` AND per-block `margin-top`s, which compounded at some
 *  joins and not others and left the column visibly ragged. Blocks now carry
 *  no margins at all: the panel's gap is the spacing, everywhere. */
const STACK_GAP = '0.85rem'
/** Between icons, and between an icon block and its own caption. */
const TIGHT_GAP = '0.5rem'
/** Corner rounding. Cold and nearly square — the hive's shape is the hexagon,
 *  and a pill-shaped control beside one reads as borrowed from another app. */
const RADIUS = '0.35rem'
/** ── THE PHONE'S DECK ────────────────────────────────────────────────────
 *
 *  A phone draws this menu as APP ICONS, not as a rail of glyphs. The rail is
 *  right for a pointer — a cursor hits a 34px mark, and a whole column of them
 *  is read at a glance. On a phone the same rail is twenty small marks that
 *  all look alike at arm's length, and the one you wanted is somewhere in row
 *  four.
 *
 *  So on mobile: plates you can SEE, four across, TWO ROWS under the hexagon,
 *  and everything beyond that one page away — the layout every phone already
 *  taught its owner. What keeps it honest is that the pages are the tile's own
 *  groups (what it opens as · what can be made on it · what can be done to
 *  it), so paging sideways reads down a menu instead of shuffling a bag. */
const APP_COLS = 4
const APP_ROWS = 2
/** Plate edge — near enough the 60pt icon a home screen uses that the hand
 *  already knows the target. */
const APP_PLATE = '3.4rem'
/** The dock's plates, one step down, the way a dock's are. */
const APP_DOCK_PLATE = '2.9rem'
/** ~23% of the plate: the squircle proportion. Not a circle (that is a
 *  button) and not a box (that is a form field) — this is the one place the
 *  cold near-square RADIUS above does not apply, because a home-screen icon
 *  that is not squircular reads as a broken one. */
const APP_PLATE_RADIUS = '0.8rem'
/** Glyph inside the plate — just over half of it, as a phone icon's is. */
const APP_GLYPH = '1.75rem'
const APP_DOCK_GLYPH = '1.5rem'
/** One cell: plate, its gap, and two lines of name. FIXED, so every row of
 *  every page lands on the same baseline and the pager never changes height
 *  under a finger that is swiping it. */
const APP_CELL_H = '5.5rem'
/** Between the two rows. */
const APP_ROW_GAP = '0.35rem'
/** Between the columns. */
const APP_COL_GAP = '0.2rem'
/** The three plate tones, and the only thing that carries meaning here. Cold
 *  steel throughout — an ACCENT is the same steel turned up, never a second
 *  hue — with one exception: destructive verbs wear a desaturated rust,
 *  because `remove` must not look like `note`. */
const APP_TONES = {
  plain: {
    fill: 'linear-gradient(180deg, rgba(126,182,214,0.155), rgba(126,182,214,0.055))',
    edge: 'rgba(126,182,214,0.22)',
    glyph: 'rgba(233,240,246,0.92)',
  },
  accent: {
    fill: 'linear-gradient(180deg, rgba(126,182,214,0.46), rgba(126,182,214,0.20))',
    edge: 'rgba(126,182,214,0.58)',
    glyph: 'rgba(248,252,255,0.98)',
  },
  danger: {
    fill: 'linear-gradient(180deg, rgba(214,126,126,0.30), rgba(214,126,126,0.11))',
    edge: 'rgba(214,126,126,0.36)',
    glyph: 'rgba(247,228,228,0.94)',
  },
} as const
/** Idle dot in the page row. */
const DOT_IDLE = 'rgba(207,226,238,0.30)'
/** WHAT THE RUST TONE IS FOR. Not the band's `dangerRow`, which means "rides
 *  the hidden row behind the ⋮" — sharing a link carries that flag and is not
 *  destructive. These are the verbs that take something away. */
const DESTRUCTIVE = new Set(['remove', 'block'])
/** How often the suspended view asks whether it is back on top. Cheap (one
 *  hit-test), and it runs ONLY while suspended. */
const WATCH_MS = 350
/** How long a suspended view waits for the action's surface to actually
 *  appear before concluding nothing is coming and resuming. A panel that
 *  mounts async must not lose the race to the first watch tick; an action
 *  that opened nothing must not leave the view suspended forever. While this
 *  grace runs the chrome is still held and the card still shown, so waiting
 *  costs nothing visible. */
const COVER_GRACE_MS = 1600

type StoreShape = {
  getResource(sig: string): Promise<Blob | null>
  getResourceLocal(sig: string): Promise<Blob | null>
}
type HistoryShape = {
  sign(l: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(sig: string): Promise<Record<string, unknown> | null>
  getLayerBySig(sig: string): Promise<Record<string, unknown> | null>
}
type NotesShape = { notesFor(cellLabel: string): Array<{ text?: unknown }> }

type OpenPayload = { label?: unknown; segments?: unknown }

/** One icon in the menu. `when` decides whether it renders at all;
 *  `backingKey` shades it inert while its bee is still registering (the same
 *  readiness rule the desktop band applies — a tap that silently no-ops during
 *  boot is worse than a visibly unavailable control).
 *
 *  `glyph` is a Material Symbols name; `svg` is raw markup, which is what the
 *  overlay's registered affordances carry. Exactly one of the two. */
type Chip = {
  action: string
  glyph?: string
  svg?: string
  labelKey: string
  fallback: string
  backingKey?: string
  when?: () => boolean
  accent?: boolean
  /** Destructive — remove, block. The band already ranks these into its own
   *  row; the phone's deck tints their plate, so the one cell you must not
   *  hit by accident does not look like the fifteen you may. */
  danger?: boolean
  /** Icons that aren't a plain `tile:action` — going inside, picking the tile
   *  — carry what they do here instead. Default: emit `tile:action` and close. */
  run?: () => void
}

/** What the overlay lends us: the SAME affordance set the desktop hover band
 *  draws, resolved for one tile. Structurally typed so this drone never has to
 *  import the overlay (which would be a cycle — the overlay opens this view). */
type OverlayActionsShape = {
  actionsForTile(label: string): Array<{
    name: string
    svgMarkup: string
    labelKey?: string
    backingKey?: string
    dangerRow?: boolean
    featureRow?: boolean
  }>
  invokeActionForTile(name: string, label: string): void
}

export class TileViewDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'

  protected override deps = {
    lineage: '@hypercomb.social/Lineage',
    store: '@hypercomb.social/Store',
  }
  protected override listens = ['tile:view-open', 'render:cell-count']
  protected override emits = ['tile:action', 'tile:enter-request', 'view:active']

  #registered = false
  #bound = false
  /** The tile this view is open for — null when closed. */
  #label: string | null = null
  #segments: readonly string[] = []
  #host: HTMLDivElement | null = null
  #viewActive = false
  /** Object URLs minted for the picture; revoked on close. */
  #urls: string[] = []
  /** Labels the current render says are external (peer-published, adoptable). */
  #external = new Set<string>()
  /** Labels the current render says are BRANCHES — the ones "go inside" means
   *  something for. A long-hold opens this view over a branch too, and without
   *  the verb the close-up would be a dead end for exactly the tiles that have
   *  somewhere to go. */
  #branches = new Set<string>()
  /** An in-flight horizontal swipe over the view. */
  #swipe: { pointerId: number; x: number; y: number } | null = null
  /** Set by a swipe that committed, so the trailing click never also fires the
   *  chip the finger happened to start on. */
  #swiped = false
  /** True while we hold the synthetic history entry that catches BACK. */
  #historyTrap = false
  /** SUSPENDED: an action was taken from this view and something else may now
   *  be over it. We stay mounted; we just stop claiming Escape, right-click,
   *  BACK and the backdrop tap, and hand the chrome back once we are actually
   *  covered. Cleared by `#watch` the moment the screen's centre is ours again. */
  #suspended = false
  /** The suspended-state poll handle. Null whenever we are not suspended. */
  #watchTimer: number | null = null
  /** Whether this suspension has actually seen its cover yet. Until it has,
   *  the chrome stays held and the card stays visible — see COVER_GRACE_MS. */
  #sawCover = false
  /** When the current suspension began (performance.now()). */
  #suspendedAt = 0
  /** Live orientation watch, bound only while the view is up. */
  #resizeObserver: ResizeObserver | null = null

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#registered) {
      window.ioc.register('@diamondcoreprocessor.com/TileViewDrone', this)
      this.#registered = true
    }
    if (this.#bound) return
    this.#bound = true

    this.onEffect<OpenPayload>('tile:view-open', payload => {
      const label = typeof payload?.label === 'string' ? payload.label : ''
      if (!label) return
      const segs = Array.isArray(payload?.segments) ? payload.segments.map(s => String(s)) : []
      void this.open(label, segs)
    })

    // Adoptability rides the render pass: `external` means "on screen but not a
    // child of my layer" — the same signal that flips the desktop band to its
    // peer profile. tile:hover carries no such flag, so this is the only source.
    this.onEffect<{ externalLabels?: unknown; branchLabels?: unknown; labels?: unknown }>('render:cell-count', payload => {
      const list = Array.isArray(payload?.externalLabels) ? payload.externalLabels : []
      this.#external = new Set(list.map(s => String(s)))
      const branches = Array.isArray(payload?.branchLabels) ? payload.branchLabels : []
      this.#branches = new Set(branches.map(s => String(s)))
      // The ROW itself is tracked by viewer-walk.ts, from this same effect —
      // one definition, shared with every viewer that walks it.
    })

    // The tile stopped existing under us (deleted, or navigated away from).
    this.onEffect<{ cell?: unknown }>('cell:removed', ({ cell }) => {
      if (this.#label && String(cell ?? '') === this.#label) this.close()
    })
    this.onEffect('navigation:guard-start', () => this.close())

    // Adopt opens the Beehaviors panel and both shells snap back to hexagons on
    // a non-silent adopt:done. Get out of the way rather than be torn down.
    this.onEffect('adopt:done', () => this.close())

    // Escape and right-click, capture phase, inert while closed. Escape is
    // stopped immediately so the global cascade never also clears the selection.
    window.addEventListener('keydown', this.#onKeyDown, true)
    window.addEventListener('contextmenu', this.#onContextMenu, true)
    // The BACK button is what a phone user presses to leave a full screen. No
    // other takeover handles it; without this the view stays mounted while the
    // lineage moves underneath it.
    window.addEventListener('popstate', this.#onPopState)
  }

  /** Is this view currently up? Read by the overlay to avoid double-opens. */
  public get open_(): boolean { return this.#label !== null }

  public async open(label: string, segments: readonly string[]): Promise<void> {
    // Already open for this tile. If we are waiting under something, being
    // asked for again IS the request to come back — don't sit there suspended.
    if (this.#label === label) {
      if (this.#suspended) this.#resume()
      return
    }
    this.close()
    this.#label = label
    this.#segments = [...segments]
    this.#mount()
    // Push one synthetic entry so the hardware/browser BACK button closes the
    // view instead of navigating the hive out from under it. Popped in #close.
    try {
      window.history.pushState({ hcTileView: label }, '')
      this.#historyTrap = true
    } catch { /* history unavailable — the other close paths still work */ }
    await this.#paintPicture(label)
  }

  public close(): void {
    if (!this.#label) return
    this.#label = null
    this.#segments = []
    this.#stopWatch()
    this.#suspended = false
    this.#teardownDom()
    if (this.#viewActive) this.#setViewActive(false)
    // Drop our synthetic entry so the history stack is exactly as we found it.
    // Guard first: when BACK is what closed us, the entry is already gone and a
    // second back() would leave the page.
    if (this.#historyTrap) {
      this.#historyTrap = false
      try { window.history.back() } catch { /* noop */ }
    }
  }

  // ── walking the row ────────────────────────────────────────

  /** The tile `delta` places along the render order, wrapping at both ends.
   *  Null when there is nowhere to go (one tile on the layer, or this tile is
   *  no longer in it — a delete under the view, say). */
  #sibling(delta: number): string | null {
    // The SAME row every viewer walks (viewer-walk.ts). The close-up's
    // sideways step and a deck's sideways step have to agree about what "the
    // next tile" is, or the grammar is two grammars.
    return this.#label ? nextTile(this.#label, delta) : null
  }

  /** Move the close-up to another tile on the same layer WITHOUT closing: the
   *  history trap and the chrome takeover both survive, so a walk along the row
   *  is one view being re-pointed rather than a stack of opens the BACK button
   *  then has to unwind. */
  #step(delta: number): void {
    const next = this.#sibling(delta)
    if (!next) return
    this.#label = next
    this.#teardownDom()
    this.#mount()
    void this.#paintPicture(next)
  }

  /** Drop the mounted card and everything it owns, leaving the takeover, the
   *  history trap and `#label` alone. Shared by `#step` and `close`. */
  #teardownDom(): void {
    this.#resizeObserver?.disconnect()
    this.#resizeObserver = null
    this.#swipe = null
    if (this.#host) {
      this.#host.remove()
      this.#host = null
    }
    for (const url of this.#urls) {
      try { URL.revokeObjectURL(url) } catch { /* noop */ }
    }
    this.#urls = []
  }

  // ── staying in the tile ────────────────────────────────────

  /**
   * AN ACTION WAS TAKEN, AND THE VIEW STAYS.
   *
   * Whatever the verb opened — the editor, a panel, a viewer, a creation —
   * comes up over this card rather than in place of it, so the way back is to
   * do nothing at all. All that has to change is who OWNS the screen while
   * that lasts: we stop answering Escape / right-click / BACK / a backdrop tap
   * (the surface on top is what those now mean), and `#watch` hands the chrome
   * over as soon as it can see that we really are covered.
   *
   * Deliberately NOT keyed to the action. A bee that registers an affordance
   * with the overlay gets its icon here for free (see `#overlayChips`); it
   * would not get a hand-listed "and this one opens a surface" entry, and the
   * first bee to be forgotten would be the one that closes the hive out from
   * under the user again.
   */
  #suspend(): void {
    if (!this.#label || this.#suspended) return
    this.#suspended = true
    this.#sawCover = false
    this.#suspendedAt = performance.now()
    this.#startWatch()
  }

  /** Is something REAL over the middle of the screen? Asked of the DOM rather
   *  than of the surfaces — nothing has to tell us it opened, and nothing has
   *  to remember to tell us it closed. The canvas floor (#pixi-host, z 59989,
   *  above this card) and bare body/html are explicitly NOT covers: they are
   *  what the centre reads as when nothing app-level is up, and treating the
   *  canvas as a cover is the self-blinding deadlock described in the header. */
  #covered(): boolean {
    const host = this.#host
    if (!host) return false
    const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
    if (!el || el === document.body || el === document.documentElement) return false
    if (el === host || host.contains(el)) return false
    const pixi = document.getElementById('pixi-host')
    if (pixi && (el === pixi || pixi.contains(el))) return false
    return true
  }

  #startWatch(): void {
    if (this.#watchTimer !== null) return
    this.#watchTimer = window.setInterval(this.#tickWatch, WATCH_MS)
  }

  #stopWatch(): void {
    if (this.#watchTimer === null) return
    window.clearInterval(this.#watchTimer)
    this.#watchTimer = null
  }

  /** COVERED → give the chrome back (whatever is on top may need it — the
   *  docked panels measure themselves against the controls bar) and HIDE the
   *  card, so a partial cover never blends with it: one surface at a time.
   *  CLEAR AGAIN → take the screen back, take the keys back, and re-mount:
   *  the action just taken is very often a note, a picture or a decoration ON
   *  THIS TILE, and coming back to the close-up it changed still showing the
   *  old one is the same bug in a quieter form.
   *
   *  NOT YET COVERED → wait, with the chrome still held and the card still
   *  visible. The action's surface may simply be mounting (a panel losing the
   *  race to the first tick used to strand it over an unsuspended card); if
   *  nothing appears within COVER_GRACE_MS the action opened nothing (a
   *  toggle, a failed open) and the view resumes as if untouched. */
  #tickWatch = (): void => {
    if (!this.#label) { this.#stopWatch(); return }
    if (this.#covered()) {
      this.#sawCover = true
      if (this.#viewActive) this.#setViewActive(false)
      if (this.#host) this.#host.style.visibility = 'hidden'
      return
    }
    if (!this.#sawCover && performance.now() - this.#suspendedAt < COVER_GRACE_MS) return
    this.#resume()
  }

  /** Take the screen back. `#mount` re-enters `view:active`, so this is also
   *  where the chrome goes away again. */
  #resume(): void {
    const label = this.#label
    if (!label) return
    this.#suspended = false
    this.#stopWatch()
    this.#teardownDom()
    this.#mount()
    void this.#paintPicture(label)
  }

  /**
   * SWIPE SIDEWAYS TO CHANGE TILE. Bound on the host, so it works from
   * anywhere on the screen — including across the picture, which is the
   * biggest target and the one a thumb finds without looking.
   *
   * Committed on the RELEASE, on a travel threshold with a horizontal bias:
   * a mostly-vertical drag is a scroll of the notes and must not become a
   * step, and a drag that starts on a chip must not fire the chip. Nothing is
   * consumed until the swipe has actually committed, so a plain tap on a chip
   * is untouched.
   */
  #bindSwipe(host: HTMLElement): void {
    host.addEventListener('pointerdown', e => {
      this.#swipe = { pointerId: e.pointerId, x: e.clientX, y: e.clientY }
      this.#swiped = false
    })
    const finish = (e: PointerEvent): void => {
      const swipe = this.#swipe
      if (!swipe || swipe.pointerId !== e.pointerId) return
      // Suspended: something is (or is about to be) over us. A tap that lands
      // beside a small panel must not close the view underneath it.
      if (this.#suspended) { this.#swipe = null; return }
      this.#swipe = null
      const dx = e.clientX - swipe.x
      const dy = e.clientY - swipe.y
      if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.4) {
        // Not a swipe. A still press that began AND ended on the backdrop is
        // the way out.
        if (e.target === host && Math.abs(dx) < SWIPE_PX && Math.abs(dy) < SWIPE_PX) this.close()
        return
      }
      this.#swiped = true
      // Drag LEFT to bring the next tile in from the right — the direction the
      // content moves, which is the one every deck and gallery has taught.
      this.#step(dx < 0 ? 1 : -1)
    }
    host.addEventListener('pointerup', finish)
    host.addEventListener('pointercancel', () => { this.#swipe = null })
    // The chip a swipe started on would otherwise fire on the way out. Capture
    // phase: the swallow has to beat the button's own listener.
    host.addEventListener('click', e => {
      if (!this.#swiped) return
      this.#swiped = false
      e.preventDefault()
      e.stopPropagation()
    }, true)
  }

  #onPopState = (): void => {
    if (!this.#label) return
    // Our entry is already popped — closing (or re-trapping) must not pop it.
    this.#historyTrap = false
    // BACK OUT OF WHAT YOU OPENED, NOT OUT OF THE TILE. While suspended, back
    // is the way out of the surface on top; landing on the close-up is exactly
    // where a phone user expects to land, so we take the screen back and re-arm
    // the trap. A second press — now unsuspended — leaves the view for real.
    if (this.#suspended) {
      this.#resume()
      try {
        window.history.pushState({ hcTileView: this.#label }, '')
        this.#historyTrap = true
      } catch { /* history unavailable — the other close paths still work */ }
      return
    }
    this.close()
  }

  #onKeyDown = (e: KeyboardEvent): void => {
    if (!this.#label || this.#suspended) return
    // The arrows are the swipe, for a keyboard — same row, same order.
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      if (!this.#sibling(e.key === 'ArrowRight' ? 1 : -1)) return
      e.preventDefault()
      e.stopImmediatePropagation()
      this.#step(e.key === 'ArrowRight' ? 1 : -1)
      return
    }
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopImmediatePropagation()
    this.close()
  }

  #onContextMenu = (e: MouseEvent): void => {
    if (!this.#label || this.#suspended) return
    e.preventDefault()
    this.close()
  }

  // ── DOM ────────────────────────────────────────────────────

  #mount(): void {
    const label = this.#label
    if (!label) return
    installViewCss()

    const host = document.createElement('div')
    host.id = 'hc-tile-view-host'
    host.style.cssText =
      `position:fixed;inset:0;z-index:${TAKEOVER_Z};overflow:hidden;background:#05040f;` +
      'display:flex;align-items:center;justify-content:center;font-family:inherit;' +
      // THE SIDEWAYS SWIPE IS OURS. Without this the browser claims a
      // horizontal drag that starts near a screen edge as its own back
      // gesture: the hive navigates out from under the view and the step to
      // the next tile never happens. `touch-action:none` refuses that claim
      // for the whole surface — the one place a scroll IS wanted (the menu,
      // and the notes) re-grants itself `pan-y`. `overscroll-behavior` stops
      // the same drag becoming a pull-to-refresh on the page behind.
      'touch-action:none;overscroll-behavior:contain;' +
      'padding:max(1.1rem,env(safe-area-inset-top,0px)) max(1.1rem,env(safe-area-inset-right,0px)) ' +
      'max(1.1rem,env(safe-area-inset-bottom,0px)) max(1.1rem,env(safe-area-inset-left,0px));'
    host.setAttribute('data-consumes-wheel', '')
    // A tap on the backdrop closes; taps inside the card do not (the card stops
    // the event). On the RELEASE, not the press — the backdrop is the widest
    // part of the screen and therefore where a sideways swipe most often
    // starts, and a press-to-close would kill every one of those before the
    // finger had travelled. #bindSwipe owns the release for exactly that
    // reason, and calls this when the gesture turned out to be a tap.
    this.#bindSwipe(host)
    document.body.appendChild(host)
    this.#host = host
    this.#setViewActive(true)

    // ── the stage: hexagon, and everything said about it ──
    // PORTRAIT stacks them — the hexagon full-width with its name, notes and
    // options underneath. LANDSCAPE is short, so the hexagon sits in the
    // middle of the screen with the same column beside it. One structure,
    // two directions; `#applyLayout` is the only thing that differs.
    const stage = document.createElement('div')
    stage.dataset['role'] = 'stage'
    // A DEFINITE HEIGHT, or the column cannot be clamped. `max-height:100%`
    // alone leaves the stage's own height `auto`, and a percentage max-height
    // resolves to `none` against an auto-height parent — so the panel's
    // `max-height:100%` did nothing and a column taller than the screen
    // overflowed it at BOTH ends (the tile's name clipped off the top, the
    // dock off the bottom) instead of scrolling inside it.
    stage.style.cssText =
      `display:flex;align-items:center;justify-content:center;gap:${STACK_GAP};` +
      'width:100%;max-width:56rem;height:100%;max-height:100%;min-height:0;'
    host.appendChild(stage)

    // THE TILE, AS A TILE. A hexagon — the same point-top shape it has on the
    // hive — not a rectangle with the picture letterboxed into it. Tapping a
    // hex and getting a hex back is what makes this read as "that tile, up
    // close" rather than a separate screen about it. The outer element is the
    // 2px steel edge: clip-path erases borders, so the frame has to be a
    // second clipped box behind the first.
    //
    // THE ZONE around it is the hexagon's OWN control surface: the six face
    // captions ride just outside the six edges, and a drag that starts here
    // is a face activation, never a row-walk (the zone stops the pointer
    // before the host's swipe sees it). The captions cannot be children of
    // the frame — its clip-path would erase anything outside the hexagon —
    // so they live on an overlay whose inset equals the zone's padding,
    // which makes the overlay's percent-space exactly the hexagon's box.
    const zone = document.createElement('div')
    zone.dataset['role'] = 'hex-zone'
    zone.style.cssText =
      `flex:0 0 auto;position:relative;box-sizing:content-box;padding:${FACE_PAD};`
    const hexFrame = document.createElement('div')
    hexFrame.dataset['role'] = 'hex-frame'
    hexFrame.style.cssText =
      // border-box, or the 2px edge is ADDED to the sized box and the ratio
      // — and with it the hexagon — comes out slightly squashed.
      `box-sizing:border-box;aspect-ratio:${HEX_RATIO};padding:2px;background:${STEEL};` +
      `clip-path:${HEX_CLIP};`
    const hex = document.createElement('div')
    hex.dataset['role'] = 'picture'
    hex.style.cssText =
      'width:100%;height:100%;display:flex;align-items:center;justify-content:center;' +
      `clip-path:${HEX_CLIP};background:#0b1018 center/cover no-repeat;`
    // Until (or unless) a picture lands, the hexagon carries the tile's first
    // letter rather than sitting there as a black shape.
    const initial = document.createElement('span')
    initial.dataset['role'] = 'initial'
    initial.textContent = [...label][0]?.toUpperCase() ?? ''
    initial.style.cssText = `font-size:4rem;font-weight:700;color:${DIM};opacity:0.5;`
    hex.appendChild(initial)
    hexFrame.appendChild(hex)
    zone.appendChild(hexFrame)
    const faces = this.#hexFaces(label)
    const faceSpans = this.#buildFaceLayer(zone, faces)
    this.#bindHexGesture(zone, faces, faceSpans)
    stage.appendChild(zone)

    // ── the column beside/below it ──
    const panel = document.createElement('div')
    panel.dataset['role'] = 'panel'
    // THE COLUMN. Its `gap` is the entire vertical rhythm of the view — no
    // block below it carries a margin, so every join is the same height and
    // the column cannot go ragged when one of them happens to be absent.
    // ONE SCROLLER, NOT THREE. The notes had their own scroll and the action
    // block another, so a long menu was clipped by the panel while two inner
    // boxes scrolled independently — the last row of verbs simply could not
    // be reached. The COLUMN scrolls now, as one document: name, notes,
    // viewers, creations, actions, in that order, all of it reachable.
    panel.style.cssText =
      'display:flex;flex-direction:column;align-items:center;justify-content:flex-start;' +
      `gap:${STACK_GAP};min-width:0;min-height:0;width:${COLUMN};max-width:100%;` +
      'overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y;' +
      // Room under the last row so it clears the screen edge when scrolled.
      'padding-bottom:0.5rem;'
    stage.appendChild(panel)

    const name = document.createElement('div')
    name.textContent = label
    // Alignment is the panel's (centred under the hexagon in portrait, ranged
    // left beside it in landscape) — `#applyLayout` owns it, so neither of
    // these may pin its own.
    name.style.cssText =
      'flex:0 0 auto;width:100%;font-size:1.3rem;font-weight:600;line-height:1.25;' +
      'letter-spacing:0.01em;color:rgba(245,245,245,0.94);word-break:break-word;'
    panel.appendChild(name)

    const notes = this.#notesText(label)
    if (notes) {
      const noteEl = document.createElement('div')
      noteEl.textContent = notes
      // A hairline over the notes rather than a box around them: it marks
      // where the tile's own words start without adding a second rounded
      // rectangle to a screen that is already a hexagon and a grid of cells.
      // UNDER THE DECK IT MUST NOT SHRINK. The deck is a fixed-height block,
      // so in a full column the note is the only thing flex can take from —
      // and it took all of it, leaving a clipped half-line under the name.
      // Fixed basis, capped, scrolling inside itself.
      const deck = this.#mobile()
      noteEl.style.cssText =
        `flex:${deck ? '0 0 auto' : '0 1 auto'};width:100%;font-size:0.95rem;line-height:1.5;` +
        `color:${DIM};overflow-y:auto;max-height:${deck ? NOTE_PEEK : '24vh'};white-space:pre-wrap;` +
        'border-top:1px solid rgba(255,255,255,0.08);padding-top:0.75rem;' +
        'touch-action:pan-y;overscroll-behavior:contain;'
      panel.appendChild(noteEl)
    }

    // THE OPTIONS FIRST. What this tile can be OPENED as is the reason most
    // people are on this screen — a sideways step that arrives at a tile
    // without the viewer you were in lands here, and the next thing that
    // should happen is choosing another one. Buried among edit/note/share it
    // was a needle; at the top of the column it is the answer to the question
    // the arrival asked.
    // ON A PHONE, ONE DECK. The three sections become the three page-groups
    // of a paged app grid — same chips, same order, same `run()` — because a
    // column of twenty small glyphs is not a menu a thumb can read. A pointer
    // device keeps the rail below exactly as it was.
    if (this.#mobile()) {
      panel.appendChild(this.#appDeck(label))
    } else {
      const viewers = this.#viewerRow(label)
      if (viewers) panel.appendChild(viewers)
      const creations = this.#creationRow(label)
      if (creations) panel.appendChild(creations)
      panel.appendChild(this.#actionRow(label))
    }

    this.#applyLayout()
    // A phone in a full-screen view is a phone that will be rotated. Re-lay it
    // out rather than leave a landscape hexagon running off a portrait screen.
    // A ResizeObserver on the host, NOT a `resize`/media-query listener. The
    // host is `inset: 0`, so its box IS the viewport — and an observer reports
    // the box changing rather than waiting for an event to be dispatched.
    // Verified: in a non-compositing embedded view the viewport can change
    // with neither `resize` nor the orientation query firing at all, which
    // leaves a landscape hexagon stranded on a portrait screen. Measuring
    // cannot miss what listening can. (`#applyLayout` only touches the host's
    // CHILDREN, so this can never observe its own writes.)
    this.#resizeObserver = new ResizeObserver(this.#onOrientation)
    this.#resizeObserver.observe(host)
  }

  /**
   * WHAT THIS TILE CAN BE OPENED AS — its viewers, as a block of their own.
   *
   * Not a second list: exactly the overlay affordances whose action is a
   * `view-enter:`, lifted out of the action grid so the two questions stop
   * sharing one row. "Open it as a deck" and "delete it" are not the same kind
   * of choice and should never be adjacent cells.
   *
   * Accented, because on arrival from a sideways step this is the live
   * question. Absent entirely when the tile carries no viewer — an empty
   * heading is worse than no heading.
   */
  #viewerRow(label: string): HTMLElement | null {
    const chips = this.#overlayChips(label).filter(c => c.action.startsWith(VIEW_ENTER_PREFIX))
    if (chips.length === 0) return null

    const section = document.createElement('section')
    section.style.cssText =
      `display:flex;flex-direction:column;align-items:inherit;gap:${TIGHT_GAP};width:100%;`

    const title = document.createElement('div')
    title.textContent = this.#t('tile-view.open-as', 'open as')
    title.style.cssText =
      'font-size:0.74rem;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;' +
      `color:${DIM};opacity:0.75;width:100%;`
    section.appendChild(title)

    const row = this.#iconGrid()
    for (const chip of chips) row.appendChild(this.#chip({ ...chip, accent: true }, label))
    section.appendChild(row)
    return section
  }

  /** Creation behaviours belong to the tile they will decorate. On mobile the
   *  command rail used to offer them as if they described the current page;
   *  putting them here gives the choice an explicit target and keeps global
   *  chrome for page-wide tools. */
  #creationRow(label: string): HTMLElement | null {
    const bees = this.#creationBees(label)
    if (bees.length === 0) return null

    const section = document.createElement('section')
    section.style.cssText =
      `display:flex;flex-direction:column;align-items:inherit;gap:${TIGHT_GAP};width:100%;`

    const title = document.createElement('div')
    title.textContent = this.#t('tile-view.creations', 'available creations')
    title.style.cssText =
      'font-size:0.74rem;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;' +
      `color:${DIM};opacity:0.75;width:100%;`
    section.appendChild(title)

    const row = this.#iconGrid()
    for (const bee of bees) row.appendChild(this.#creationChip(bee, label))
    section.appendChild(row)
    return section
  }

  /**
   * A BLOCK OF ICON CELLS, and the reason it is not a CSS grid.
   *
   * A five-column grid leaves a short last row ranged against the left edge,
   * which on a centred column is the one thing that makes the whole screen
   * look crooked. Wrapping flex items at a FIXED five-across basis gives cells
   * of exactly the grid's size — same width on every row, aligned down the
   * column — and centres whatever is left over on the last one.
   */
  #iconGrid(): HTMLDivElement {
    const row = document.createElement('div')
    // A hair more air than the old TIGHT_GAP: cells this size need to read as
    // separate controls, not a solid block of glyphs.
    row.style.cssText =
      'display:flex;flex-wrap:wrap;gap:0.7rem 0.5rem;justify-content:center;width:100%;'
    return row
  }

  /** The creation behaviours this tile could take on. Asked for by both the
   *  rail and the deck, so the two can never offer different sets. */
  #creationBees(label: string): VisualBeeDescriptor[] {
    const registry = window.ioc?.get?.<VisualBeeRegistry>(
      '@diamondcoreprocessor.com/VisualBeeRegistry',
    )
    return (registry?.forPlatform?.('mobile') ?? [])
      .filter(bee =>
        bee.adoptable !== false &&
        bee.behavior !== 'navigation' &&
        !hasDecorationKind(label, bee.decorationKind) &&
        // Globally-off behaviors (the roster lens) aren't offered as
        // creations — dormant means gone, not "available to add".
        !isKindGloballyOff(bee.decorationKind),
      )
  }

  #creationChipSpec(bee: VisualBeeDescriptor): Chip {
    return {
      action: `view:${bee.view}`,
      glyph: bee.toggleIcon || 'add_box',
      labelKey: bee.labelKey || '',
      fallback: bee.view,
      backingKey: bee.queenKey,
    }
  }

  #creationChip(bee: VisualBeeDescriptor, label: string): HTMLElement {
    return this.#chip(this.#creationChipSpec(bee), label)
  }

  #onOrientation = (): void => { this.#applyLayout() }

  /** The ONE difference between the two orientations: which way the stage
   *  runs, and what bounds the hexagon.
   *
   *  PORTRAIT — a flex column, width-bound: the hexagon is as wide as the
   *  screen sensibly allows and everything said about it sits underneath.
   *
   *  LANDSCAPE — the screen is short, so the hexagon is sized off the HEIGHT
   *  and the column moves beside it. It is a 1fr | auto | 1fr GRID, not a
   *  row: with a plain row the panel takes all the leftover width and shoves
   *  the hexagon against the left edge. The empty first track is the panel's
   *  mirror image, which puts the hexagon dead centre of the screen — where a
   *  tile you are looking at closely belongs. */
  #applyLayout(): void {
    const host = this.#host
    if (!host) return
    const landscape = window.matchMedia('(orientation: landscape)').matches
    const stage = host.querySelector('[data-role="stage"]') as HTMLElement | null
    const zone = host.querySelector('[data-role="hex-zone"]') as HTMLElement | null
    const frame = host.querySelector('[data-role="hex-frame"]') as HTMLElement | null
    const panel = host.querySelector('[data-role="panel"]') as HTMLElement | null
    const row = host.querySelector('[data-role="actions"]') as HTMLElement | null
    if (!stage || !zone || !frame || !panel) return

    if (landscape) {
      // THE PAIR IS THE OBJECT, AND IT SITS IN THE MIDDLE. This used to be a
      // `1fr auto 1fr` grid whose empty first track mirrored the panel — it
      // centred the HEXAGON, at the price of a dead third of the screen on
      // the left and a column crushed against the right edge. Centring the
      // pair instead uses the whole width: hexagon and column side by side,
      // together in the middle, with the panel bounded so it can never eat
      // the leftover space and shove the hexagon off (the reason the grid
      // existed at all).
      stage.style.display = 'flex'
      stage.style.gridTemplateColumns = ''
      stage.style.flexDirection = 'row'
      stage.style.gap = '2.5rem'
      zone.style.gridColumn = ''
      zone.style.marginTop = '0'
      panel.style.gridColumn = ''
      frame.style.height = 'min(72vh, 24rem)'
      frame.style.width = 'auto'
      panel.style.flex = '0 1 26rem'
      panel.style.alignItems = 'flex-start'
      panel.style.textAlign = 'left'
      panel.style.justifyContent = 'flex-start'
      panel.style.maxHeight = '100%'
      if (row) row.style.justifyContent = 'flex-start'
    } else {
      stage.style.display = 'flex'
      stage.style.gridTemplateColumns = ''
      stage.style.gap = STACK_GAP
      zone.style.gridColumn = ''
      // A LITTLE LOWER than dead centre, on request: the close-up is worked
      // with a thumb, and a hexagon that hangs slightly toward the hand is
      // the difference between reading it and reaching for it. Also air for
      // the two upper face captions, which sit above the shape.
      zone.style.marginTop = '4vh'
      panel.style.gridColumn = ''
      stage.style.flexDirection = 'column'
      // Narrower than the column it sits in, so the tile is inset in its own
      // screen instead of touching the same edge the icon rows do — and
      // narrower still when the deck is under it, which is a block that has to
      // fit rather than a list that can scroll.
      frame.style.width = this.#mobile() ? HEX_PORTRAIT_DECK : HEX_PORTRAIT
      frame.style.height = 'auto'
      panel.style.flex = '0 1 auto'
      panel.style.alignItems = 'center'
      panel.style.textAlign = 'center'
      panel.style.justifyContent = 'flex-start'
      panel.style.maxHeight = ''
      if (row) row.style.justifyContent = 'center'
    }

    // THE PAGE IS A SCROLL OFFSET IN A BOX WHOSE WIDTH JUST CHANGED. Put it
    // back where it was, or a rotation silently strands the deck halfway
    // between two pages — with a heading that belongs to neither.
    const pager = host.querySelector('[data-role="deck-pager"]') as HTMLElement | null
    if (pager) {
      const page = Number(pager.dataset['page'] ?? '0')
      requestAnimationFrame(() => { pager.scrollLeft = page * pager.clientWidth })
    }
  }

  /**
   * THE MENU — the touch equivalent of the hover band, and now its
   * REPLACEMENT: in mobile mode the band is retired outright (it needs a hover
   * to appear and a 7px-accurate press to use), so this is where everything a
   * tile can do has to be.
   *
   * Most of it is not written here. The overlay owns the affordance registry —
   * every provider bee registers into it and nowhere else — so the menu ASKS
   * it what this tile carries and renders the answer. A bee that adds an icon
   * to the desktop band gets one here too, with no edit to this file. What is
   * written here is only what the band cannot express: going inside, picking
   * the tile, walking the row, and the way out.
   *
   * Rows of MENU_COLUMNS, growing DOWNWARD without a cap.
   */
  #actionRow(label: string): HTMLElement {
    const row = this.#iconGrid()
    row.dataset['role'] = 'actions'
    // No scroll of its own — the PANEL is the scroller now (see `#mount`), so
    // the block simply lays out however many rows it needs and the column
    // carries them. A box that scrolled inside a box meant the last verbs
    // were unreachable from either.
    row.style.flex = '0 0 auto'
    row.style.alignContent = 'flex-start'

    for (const chip of this.#actionChips(label)) row.appendChild(this.#chip(chip, label))
    // THE ROW YOU CAME FROM, reachable without leaving. The swipe does the
    // same thing and does it faster, but a swipe is invisible — these are how
    // anyone finds out it is there. Hidden outright when there is nowhere to
    // step, so a single-tile layer never offers a dead control.
    for (const chip of this.#walkChips()) row.appendChild(this.#chip(chip, label))
    row.appendChild(this.#exitChip())
    return row
  }

  /**
   * WHAT CAN BE DONE TO THIS TILE, as chips — already filtered by `when`, so
   * the rail and the deck can only ever render the same set.
   *
   * GO INSIDE leads: a branch's whole point is what is under it, and the
   * close-up is reached by holding one. Then EVERYTHING THE BAND CARRIES —
   * edit, note, share, features, adopt, hide, block, files, invite, remove,
   * the lot — resolved for THIS tile by the surface that owns them (these
   * used to be a hand-written subset, which meant a phone saw five of the
   * twenty-odd affordances a tile can have and no bee could add to them),
   * minus the viewers, which are their own question. Last, PICK IT: the
   * close-up is one tile, the picked set is how you act on several, and
   * arming the picker on the way out means the tile you were just looking at
   * is the first one in.
   */
  #actionChips(label: string): Chip[] {
    return [
      this.#enterChip(label),
      ...this.#overlayChips(label).filter(c => !c.action.startsWith(VIEW_ENTER_PREFIX)),
      this.#selectChip(label),
    ].filter(chip => !chip.when || chip.when())
  }

  /** The two steps along the row, when there is a row to step along. */
  #walkChips(): Chip[] {
    const chips: Chip[] = []
    for (const delta of [-1, 1] as const) {
      if (!this.#sibling(delta)) continue
      chips.push({
        action: delta < 0 ? 'previous-tile' : 'next-tile',
        glyph: delta < 0 ? 'chevron_left' : 'chevron_right',
        labelKey: delta < 0 ? 'tile-view.previous' : 'tile-view.next',
        fallback: delta < 0 ? 'previous' : 'next',
        run: () => this.#step(delta),
      })
    }
    return chips
  }

  /** GO INSIDE, as a chip. Emitted as a request rather than driven from here —
   *  every readiness gate, phantom-segment latch and guard that entering a
   *  tile needs already lives in the overlay, and a second implementation of
   *  it would be a second set of those bugs. Shared by the menu grid and the
   *  hexagon's bottom-right face, so the two can never disagree about what
   *  entering means. */
  #enterChip(label: string): Chip {
    return {
      action: 'enter',
      glyph: 'login',
      labelKey: 'tile-view.enter',
      fallback: 'go inside',
      when: () => this.#branches.has(label),
      accent: true,
      run: () => {
        this.emitEffect('tile:enter-request', { label })
        this.close()
      },
    }
  }

  /** PICK IT, as a chip — arms the picker with this tile already in. Shared by
   *  the menu grid and the hexagon's bottom-left face. */
  #selectChip(label: string): Chip {
    return {
      action: 'select',
      glyph: 'select_all',
      labelKey: 'tile-view.select',
      fallback: 'select',
      run: () => {
        const select = window.ioc?.get?.('@diamondcoreprocessor.com/SelectModeDrone') as
          { arm(): void } | undefined
        const selection = window.ioc?.get?.('@diamondcoreprocessor.com/SelectionService') as
          { add(label: string): void } | undefined
        select?.arm()
        selection?.add(label)
        this.close()
      },
    }
  }

  // ── the six faces ──────────────────────────────────────────
  //
  // THE HEXAGON'S SIX EDGES ARE SIX OPTIONS. Each face carries a caption
  // lying along its edge, and a drag from the hexagon toward a face — any of
  // the six directions — activates it, exactly as tapping its caption does.
  // The occupants are not invented for the gesture: every face resolves to a
  // chip the view already renders, running through the same `run()` (so the
  // suspend/handover rules hold whichever way an option is reached).
  //
  //   upper-right · upper-left — what the tile can be OPENED AS (its viewers:
  //     photos, slides, a website …), the live question on arrival;
  //   right — EDIT · left — SETTINGS (the features panel);
  //   lower-right — GO INSIDE (branches; the thumb's easiest flick)
  //   lower-left — SELECT.
  //
  // A face with no occupant (no second viewer, not a branch) renders nothing
  // and swallows nothing: the swipe simply does not commit.

  /** Which chip each face carries, for this tile. */
  #hexFaces(label: string): Partial<Record<FaceDir, Chip>> {
    const chips = this.#overlayChips(label)
    const viewers = chips.filter(c => c.action.startsWith(VIEW_ENTER_PREFIX))
    const named = (name: string): Chip | undefined => chips.find(c => c.action === name)
    const faces: Partial<Record<FaceDir, Chip>> = {}
    if (viewers[0]) faces.ne = { ...viewers[0], accent: true }
    if (viewers[1]) faces.nw = { ...viewers[1], accent: true }
    // A LINK TILE'S CONTENT IS ITS VIEW. A tile pointing at the internet (a
    // video, an image, an article) usually carries no viewer decoration —
    // but the thing a swipe up-and-right should do is obvious: open what it
    // points at. Same 'link' chip the grid renders; the caption says the aim.
    if (!faces.ne) {
      const open = chips.find(c => c.action === 'link')
      if (open) faces.ne = { ...open, labelKey: 'tile-view.open', fallback: 'open', accent: true }
    }
    const edit = named('edit')
    if (edit) faces.e = edit
    // The features panel, wearing the name the face means: a face caption is
    // an aim ("settings"), not the panel's own long title.
    const settings = named('features')
    if (settings) faces.w = { ...settings, labelKey: 'tile-view.settings', fallback: 'settings' }
    if (this.#branches.has(label)) faces.se = this.#enterChip(label)
    faces.sw = this.#selectChip(label)
    return faces
  }

  /** The captions around the hexagon. Children of an overlay whose inset is
   *  the zone's padding, so its percent-space is exactly the hexagon's box —
   *  they cannot live in the frame, whose clip-path would erase them. */
  #buildFaceLayer(
    zone: HTMLElement,
    faces: Partial<Record<FaceDir, Chip>>,
  ): Partial<Record<FaceDir, HTMLElement>> {
    const layer = document.createElement('div')
    layer.dataset['role'] = 'face-layer'
    layer.style.cssText = `position:absolute;inset:${FACE_PAD};pointer-events:none;`
    const spans: Partial<Record<FaceDir, HTMLElement>> = {}
    for (const dir of FACE_DIRS) {
      const chip = faces[dir]
      if (!chip) continue
      const inert = !!chip.backingKey && !window.ioc?.has?.(chip.backingKey)
      if (inert) continue
      const geometry = FACE_GEOMETRY[dir]
      const span = document.createElement('span')
      span.setAttribute('data-hc-tv-face', dir)
      span.textContent = this.#t(chip.labelKey, chip.fallback)
      span.style.cssText =
        `position:absolute;left:${geometry.x}%;top:${geometry.y}%;` +
        `transform:translate(-50%,-50%) rotate(${geometry.rotate}deg) translateY(${geometry.out > 0 ? '' : '-'}${FACE_OUT});` +
        'font-size:0.62rem;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;' +
        'white-space:nowrap;cursor:pointer;pointer-events:auto;user-select:none;' +
        `color:${chip.accent ? STEEL : DIM};opacity:0.85;`
      span.addEventListener('click', e => {
        e.stopPropagation()
        chip.run ? chip.run() : this.emitEffect('tile:action', { action: chip.action, label: this.#label ?? '' })
      })
      layer.appendChild(span)
      spans[dir] = span
    }
    zone.appendChild(layer)
    return spans
  }

  /** The six-direction drag. Owned by the ZONE: a pointer that goes down on
   *  the hexagon is aiming at a face, so it is stopped before the host's
   *  row-walk swipe can claim it — the row is still walked from anywhere
   *  else on the screen. Committed on release past FACE_PX; while the drag
   *  is live the face it currently points at brightens, which is what makes
   *  an invisible gesture learnable. */
  #bindHexGesture(
    zone: HTMLElement,
    faces: Partial<Record<FaceDir, Chip>>,
    spans: Partial<Record<FaceDir, HTMLElement>>,
  ): void {
    let start: { id: number; x: number; y: number } | null = null
    let committed = false
    const aim = (dx: number, dy: number): FaceDir | null => {
      if (Math.hypot(dx, dy) < 12) return null
      // Screen y grows downward; negate it so 0° is east and angles run
      // counter-clockwise — the space FACE_DIRS indexes by 60° sectors.
      const angle = (Math.atan2(-dy, dx) * 180 / Math.PI + 360) % 360
      return FACE_DIRS[Math.round(angle / 60) % 6] ?? null
    }
    const paint = (hot: FaceDir | null): void => {
      for (const dir of FACE_DIRS) {
        const span = spans[dir]
        if (!span) continue
        if (dir === hot) span.setAttribute('data-hot', '')
        else span.removeAttribute('data-hot')
      }
    }
    zone.addEventListener('pointerdown', e => {
      start = { id: e.pointerId, x: e.clientX, y: e.clientY }
      committed = false
      e.stopPropagation()
      try { zone.setPointerCapture(e.pointerId) } catch { /* best effort */ }
    })
    zone.addEventListener('pointermove', e => {
      if (!start || start.id !== e.pointerId) return
      const dir = aim(e.clientX - start.x, e.clientY - start.y)
      paint(dir && faces[dir] && spans[dir] ? dir : null)
    })
    zone.addEventListener('pointerup', e => {
      if (!start || start.id !== e.pointerId) return
      const dx = e.clientX - start.x
      const dy = e.clientY - start.y
      start = null
      paint(null)
      if (this.#suspended) return
      if (Math.hypot(dx, dy) < FACE_PX) return
      const dir = aim(dx, dy)
      const chip = dir ? faces[dir] : undefined
      if (!chip || (chip.when && !chip.when())) return
      committed = true
      chip.run ? chip.run() : this.emitEffect('tile:action', { action: chip.action, label: this.#label ?? '' })
    })
    zone.addEventListener('pointercancel', () => { start = null; paint(null) })
    // The click a committed drag leaves behind would land on whatever caption
    // the finger came up over. Capture phase, same reason the host swallows
    // its row-walk's trailing click.
    zone.addEventListener('click', e => {
      if (!committed) return
      committed = false
      e.preventDefault()
      e.stopPropagation()
    }, true)
  }

  /**
   * The overlay's affordances for this tile, as menu icons.
   *
   * Order is the band's own — main, then features, then danger — so `remove`
   * lands in the last cell, furthest from the thumb's resting reach. The icon
   * is the provider's raw SVG, which is already white-filled 24×24 markup, so
   * it drops straight into the DOM.
   *
   * Silent when the overlay is absent or the tile is not on the current layer:
   * an empty menu is the right answer there, not a broken one.
   */
  #overlayChips(label: string): Chip[] {
    let actions: ReturnType<OverlayActionsShape['actionsForTile']> = []
    try {
      const overlay = window.ioc?.get?.('@diamondcoreprocessor.com/TileOverlayDrone') as
        OverlayActionsShape | undefined
      actions = overlay?.actionsForTile?.(label) ?? []
    } catch { return [] }

    return actions.map(action => ({
      action: action.name,
      svg: action.svgMarkup,
      labelKey: action.labelKey ?? '',
      fallback: action.name.replace(/-/g, ' '),
      backingKey: action.backingKey,
      danger: DESTRUCTIVE.has(action.name),
      // Through the overlay, not a bare emit: it owns the `tile:action`
      // payload shape (q/r/index) and the one action that is not an emit at
      // all (break-apart plays its shatter first).
      run: () => {
        const overlay = window.ioc?.get?.('@diamondcoreprocessor.com/TileOverlayDrone') as
          OverlayActionsShape | undefined
        // OPENING A VIEWER IS A HANDOVER, NOT A COVER. Waiting underneath is
        // right for an editor or a panel; it cannot work for a viewer, half of
        // which navigate INTO the tile to open and tear this card down on the
        // way (`navigation:guard-start`). So the way back is recorded instead,
        // and the viewer's close brings this screen back — see
        // `rememberCloseUpEntry`. Closing first also keeps a viewer that mounts
        // below TAKEOVER_Z from being covered by our own suspended card.
        if (action.name.startsWith(VIEW_ENTER_PREFIX)) {
          rememberCloseUpEntry(action.name.slice(VIEW_ENTER_PREFIX.length), label, this.#segments)
          this.close()
          overlay?.invokeActionForTile?.(action.name, label)
          return
        }
        // OPENING THE TILE'S LINK IS A HANDOVER TOO. The content viewers it
        // reaches (the photo view, the YouTube embed) mount at z 10000 — far
        // below this card — so waiting suspended underneath would bury them
        // behind the card the moment the watch resumed it. Close first;
        // closing the content lands on the hive, exactly where the canvas
        // tap that opens leaf links lands.
        if (action.name === 'link') {
          this.close()
          overlay?.invokeActionForTile?.(action.name, label)
          return
        }
        overlay?.invokeActionForTile?.(action.name, label)
        // Editing, sharing and the panels open their own surface OVER this one
        // and the close-up waits underneath for them (`#suspend`). `remove`
        // takes the tile out from under it — that one is closed by the
        // `cell:removed` listener, which is the only correct judge of it.
        this.#suspend()
      },
    }))
  }

  /**
   * ONE MENU CELL: the icon, and its name under it in small type.
   *
   * Icon-first because a row of five words is unreadable at this width and a
   * row of five icons is not — but the word stays, because an icon nobody
   * recognises is a control nobody presses. The whole cell is the target, so
   * the tap area is the full grid square rather than the glyph inside it.
   */
  #chip(chip: Chip, label: string): HTMLElement {
    const btn = document.createElement('button')
    const inert = !!chip.backingKey && !window.ioc?.has?.(chip.backingKey)
    const text = this.#t(chip.labelKey, chip.fallback)
    btn.type = 'button'
    btn.setAttribute('aria-label', text)
    btn.setAttribute('data-hc-tv-chip', '')
    // NO PLATE, NO BORDER. A grid of outlined boxes reads as a settings form
    // from another era; the cell is a bare glyph with its name under it — the
    // same icon-rail language the header speaks — and the pressed state (a
    // brief steel wash, from VIEW_CSS) is the only box that ever appears.
    // What distinguishes an ACCENTED cell is now its colour: steel glyph
    // instead of an inverse-filled slab.
    // Five across, exactly: the basis subtracts the four gaps between them, so
    // every cell in the block is the same width whatever row it lands on.
    btn.style.cssText =
      `min-height:${TAP};padding:0.5rem 0.25rem;border-radius:${RADIUS};` +
      // Grow to share the row, never below the readable floor, never past the
      // ceiling — the row count falls out of the width instead of being fixed.
      `flex:1 1 ${CELL_MIN};min-width:${CELL_MIN};max-width:${CELL_MAX};` +
      'box-sizing:border-box;' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'gap:0.45rem;cursor:pointer;' +
      'background:transparent;border:none;' +
      `color:${chip.accent ? STEEL : 'rgba(233,240,246,0.88)'};` +
      `opacity:${inert ? 0.35 : 1};pointer-events:${inert ? 'none' : 'auto'};`

    const icon = document.createElement('span')
    icon.style.cssText =
      'display:flex;align-items:center;justify-content:center;width:2.15rem;height:2.15rem;'
    if (chip.svg) {
      // Provider markup: 24×24, `fill="white"`. Sized down to the cell and
      // recoloured through `currentColor` so an accent cell tints with the
      // rest of the button.
      icon.innerHTML = chip.svg
      const svg = icon.firstElementChild as SVGElement | null
      if (svg) {
        svg.setAttribute('width', '100%')
        svg.setAttribute('height', '100%')
        svg.setAttribute('fill', 'currentColor')
      }
    } else {
      icon.textContent = chip.glyph ?? ''
      icon.style.cssText += "font-family:'Material Symbols Outlined';font-size:2rem;line-height:1;"
    }
    btn.appendChild(icon)

    const caption = document.createElement('span')
    caption.textContent = text
    // One line, clipped rather than wrapped: a two-line caption makes one cell
    // taller than its neighbours and the whole row goes ragged. Quieter than
    // the glyph — the glyph is the control, the word names it — but no longer
    // a whisper: at 0.6rem it was smaller than any other text on the screen.
    caption.style.cssText =
      'font-size:0.74rem;font-weight:600;line-height:1.15;max-width:100%;letter-spacing:0.02em;' +
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:0.78;text-transform:lowercase;'
    btn.appendChild(caption)

    btn.addEventListener('click', () => { this.#activate(chip, label) })
    return btn
  }

  /** RUN A CHIP. One definition, shared by the rail and the deck, so the two
   *  presentations of one menu can never turn out to do different things. */
  #activate(chip: Chip, label: string): void {
    if (chip.run) { chip.run(); return }
    // Fallback for a chip built without run() — every chip the close-up
    // composes today carries one, so this is belt-and-braces only. The
    // exact rendered name matters: tile:action consumers string-match and
    // do NOT normalize, so a normalized label would silently match nothing.
    this.emitEffect('tile:action', { action: chip.action, label })
    this.#suspend()
  }

  /** The way out, as an ordinary cell — it belongs in the grid with everything
   *  else rather than floating beside it at a different shape. */
  #exitChip(): HTMLElement {
    return this.#chip(this.#exitChipSpec(), '')
  }

  #exitChipSpec(): Chip {
    return {
      action: 'exit',
      glyph: 'grid_view',
      // Its OWN key, not slides' — "Back to the hive" is the right thing for a
      // deck's aria-label and far too long for a caption under an icon.
      labelKey: 'tile-view.exit',
      fallback: 'back',
      run: () => this.close(),
    }
  }

  // ── the phone's deck ────────────────────────────────

  /** Mobile mode per the single source of truth — the same service the quick
   *  menu and the overlay read, so a touch laptop keeps the rail and a phone
   *  gets the deck, and no surface has its own idea of what a phone is. */
  #mobile(): boolean {
    try {
      return window.ioc?.get?.<{ active?: boolean }>(MOBILE_MODE_IOC_KEY)?.active === true
    } catch { return false }
  }

  /**
   * TWO ROWS OF APP ICONS UNDER THE HEXAGON, AND A PAGE FOR THE REST.
   *
   * The same chips the rail draws — resolved from the same overlay registry,
   * run through the same `#activate` — presented the way a phone presents a
   * menu: plates big enough to recognise without reading them, four across,
   * two rows deep, everything past that one swipe away.
   *
   * THE PAGES ARE THE TILE'S OWN GROUPS. A group starts a page and flows onto
   * as many as it needs, so the heading over the grid is true of every icon
   * under it. Sideways is therefore "the next question about this tile", not
   * "eight more of whatever was left over".
   *
   * HOW YOU FIND OUT THERE IS MORE — the one thing a phone cannot infer, and
   * the reason a paged menu is usually a menu with half its verbs missing:
   * a live count beside the heading, a row of page dots that are also the way
   * to jump, and an arrow at each end that fades out when there is nothing
   * that way. Three signals for one fact, deliberately.
   *
   * THE DOCK never pages. Stepping back along the row, out to the hive, and
   * on along the row are about the ROW, not about this tile — they cannot be
   * allowed to land on page three.
   */
  #appDeck(label: string): HTMLElement {
    const section = document.createElement('section')
    section.dataset['role'] = 'app-deck'
    section.style.cssText =
      `display:flex;flex-direction:column;align-items:stretch;gap:${TIGHT_GAP};width:100%;`
    // A drag that starts in here is a page turn or a scroll — never the host's
    // step to the next tile. Same claim the hex zone makes for its faces.
    section.addEventListener('pointerdown', e => { e.stopPropagation() })

    const groups: Array<{ title: string; chips: Chip[] }> = []
    const viewers = this.#overlayChips(label)
      .filter(c => c.action.startsWith(VIEW_ENTER_PREFIX))
      .map(c => ({ ...c, accent: true }))
    if (viewers.length) {
      groups.push({ title: this.#t('tile-view.open-as', 'open as'), chips: viewers })
    }
    const creations = this.#creationBees(label).map(bee => this.#creationChipSpec(bee))
    if (creations.length) {
      groups.push({ title: this.#t('tile-view.creations', 'available creations'), chips: creations })
    }
    const actions = this.#actionChips(label)
    if (actions.length) {
      groups.push({ title: this.#t('tile-view.actions', 'actions'), chips: actions })
    }

    // BALANCED, NOT GREEDY. Filling each page to eight leaves a group of nine
    // as a full page and then a single lonely icon, which reads as a mistake.
    // Spreading the group over the same number of pages costs nothing and
    // gives 5 + 4.
    const per = APP_COLS * APP_ROWS
    const pages: Array<{ title: string; chips: Chip[] }> = []
    for (const group of groups) {
      const sheets = Math.max(1, Math.ceil(group.chips.length / per))
      const size = Math.ceil(group.chips.length / sheets)
      for (let i = 0; i < group.chips.length; i += size) {
        pages.push({ title: group.title, chips: group.chips.slice(i, i + size) })
      }
    }

    if (pages.length > 0) {
      const head = document.createElement('div')
      head.style.cssText =
        'display:flex;align-items:baseline;justify-content:space-between;gap:0.6rem;width:100%;'
      const title = document.createElement('div')
      title.dataset['role'] = 'deck-title'
      title.style.cssText =
        'font-size:0.74rem;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;' +
        `color:${DIM};opacity:0.75;min-width:0;overflow:hidden;text-overflow:ellipsis;` +
        'white-space:nowrap;text-align:left;'
      head.appendChild(title)
      // The count is the plainest of the three "there is more" signals, and
      // the only one that says HOW MUCH more. Hidden (not removed) on a
      // single-page deck, so the heading never shifts sideways between tiles.
      const count = document.createElement('div')
      count.dataset['role'] = 'deck-count'
      count.style.cssText =
        `font-size:0.7rem;font-weight:600;letter-spacing:0.08em;color:${DIM};opacity:0.6;` +
        `flex:0 0 auto;visibility:${pages.length > 1 ? 'visible' : 'hidden'};`
      head.appendChild(count)
      section.appendChild(head)

      const pager = document.createElement('div')
      pager.dataset['role'] = 'deck-pager'
      pager.setAttribute('data-hc-tv-deck', '')
      pager.dataset['page'] = '0'
      pager.style.cssText =
        'display:flex;width:100%;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;' +
        // BOTH AXES. The pager is a scroll container, which is where the
        // host's blanket `touch-action:none` gets re-granted (the same trick
        // the panel plays): sideways for the pages, downward so a drag that
        // lands on an icon still scrolls the column instead of dying.
        'touch-action:pan-x pan-y;overscroll-behavior-x:contain;' +
        // FIXED HEIGHT, always two rows' worth. A page holding three icons
        // must be exactly as tall as one holding eight, or the dots and the
        // dock jump under the finger that is swiping between them.
        `height:calc(${APP_ROWS} * ${APP_CELL_H} + ${APP_ROW_GAP});`
      for (const page of pages) {
        pager.appendChild(this.#appPage(page.chips, label))
      }
      section.appendChild(pager)

      const to = (index: number): void => {
        const at = Math.max(0, Math.min(pages.length - 1, index))
        pager.scrollTo({ left: at * pager.clientWidth, behavior: 'smooth' })
      }
      const nav = document.createElement('div')
      nav.style.cssText =
        'display:flex;align-items:center;justify-content:center;gap:0.4rem;width:100%;' +
        `height:1.1rem;visibility:${pages.length > 1 ? 'visible' : 'hidden'};`
      const arrow = (delta: -1 | 1): HTMLElement => {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.setAttribute('data-hc-tv-page-arrow', delta < 0 ? 'prev' : 'next')
        btn.setAttribute('aria-label', this.#t(
          delta < 0 ? 'tile-view.page-previous' : 'tile-view.page-next',
          delta < 0 ? 'previous page' : 'more',
        ))
        btn.textContent = delta < 0 ? 'chevron_left' : 'chevron_right'
        btn.style.cssText =
          `font-family:'Material Symbols Outlined';font-size:1.05rem;line-height:1;color:${STEEL};` +
          'background:none;border:none;padding:0 0.1rem;cursor:pointer;opacity:0.55;'
        btn.addEventListener('click', () => { to(Number(pager.dataset['page'] ?? '0') + delta) })
        return btn
      }
      const prev = arrow(-1)
      nav.appendChild(prev)
      const dots: HTMLElement[] = []
      pages.forEach((page, index) => {
        const dot = document.createElement('button')
        dot.type = 'button'
        dot.setAttribute('data-hc-tv-dot', '')
        dot.setAttribute('aria-label', page.title)
        dot.style.cssText =
          'width:0.42rem;height:0.42rem;flex:0 0 auto;border-radius:50%;border:none;padding:0;' +
          `cursor:pointer;background:${DOT_IDLE};`
        dot.addEventListener('click', () => { to(index) })
        nav.appendChild(dot)
        dots.push(dot)
      })
      const next = arrow(1)
      nav.appendChild(next)
      section.appendChild(nav)

      /** Everything that says WHERE YOU ARE, from one number. */
      const sync = (): void => {
        const width = pager.clientWidth || 1
        const index = Math.max(0, Math.min(pages.length - 1, Math.round(pager.scrollLeft / width)))
        pager.dataset['page'] = String(index)
        title.textContent = pages[index]?.title ?? ''
        count.textContent = `${index + 1}/${pages.length}`
        dots.forEach((dot, i) => { dot.style.background = i === index ? STEEL : DOT_IDLE })
        prev.style.opacity = index === 0 ? '0' : '0.55'
        prev.style.pointerEvents = index === 0 ? 'none' : 'auto'
        next.style.opacity = index === pages.length - 1 ? '0' : '0.55'
        next.style.pointerEvents = index === pages.length - 1 ? 'none' : 'auto'
      }
      sync()
      let queued = false
      pager.addEventListener('scroll', () => {
        if (queued) return
        queued = true
        requestAnimationFrame(() => { queued = false; sync() })
      }, { passive: true })
      // A page turn is a scroll, and the click it leaves behind would fire
      // whichever icon the finger happened to come up over. Capture phase,
      // same reason the host swallows its row-walk's trailing click.
      let from = 0
      pager.addEventListener('pointerdown', () => { from = pager.scrollLeft })
      pager.addEventListener('click', e => {
        if (Math.abs(pager.scrollLeft - from) < 4) return
        e.preventDefault()
        e.stopPropagation()
      }, true)
    }

    // THE DOCK — the three that are about the row rather than the tile, so
    // they stay put whatever page you are on. Unnamed: a dock is icons you
    // already know, and captions under three plates would double its height
    // for nothing.
    const dock = document.createElement('div')
    dock.dataset['role'] = 'deck-dock'
    dock.style.cssText =
      'display:flex;align-items:center;justify-content:center;gap:1.15rem;width:100%;' +
      'border-top:1px solid rgba(255,255,255,0.07);padding-top:0.7rem;'
    const walk = this.#walkChips()
    const docked: Chip[] = [
      ...walk.filter(c => c.action === 'previous-tile'),
      this.#exitChipSpec(),
      ...walk.filter(c => c.action === 'next-tile'),
    ]
    for (const chip of docked) {
      dock.appendChild(this.#appCell(chip, label, {
        size: APP_DOCK_PLATE,
        glyph: APP_DOCK_GLYPH,
        named: false,
      }))
    }
    section.appendChild(dock)
    return section
  }

  /**
   * ONE PAGE OF THE DECK — two CENTRED rows, not a grid.
   *
   * A four-column grid fills left to right and leaves five icons as four and
   * then a lone one hanging off the left edge. That is what a home screen
   * does with twenty-four icons and it is wrong with five: on a centred column
   * the orphan reads as a mistake rather than as the end of a list. So a page
   * splits its icons EVENLY over its two rows (5 → 3+2, 7 → 4+3) and centres
   * each row, while every cell keeps the four-column width — so icons still
   * line up down the deck from page to page.
   */
  #appPage(chips: Chip[], label: string): HTMLElement {
    const page = document.createElement('div')
    page.dataset['role'] = 'deck-page'
    page.style.cssText =
      'flex:0 0 100%;scroll-snap-align:start;display:flex;flex-direction:column;' +
      `justify-content:flex-start;gap:${APP_ROW_GAP};`
    const split = chips.length <= APP_COLS
      ? [chips]
      : [chips.slice(0, Math.ceil(chips.length / 2)), chips.slice(Math.ceil(chips.length / 2))]
    for (const rowChips of split) {
      const row = document.createElement('div')
      row.style.cssText =
        `display:flex;justify-content:center;gap:${APP_COL_GAP};height:${APP_CELL_H};width:100%;`
      for (const chip of rowChips) {
        const cell = this.#appCell(chip, label)
        // The four-column width, whatever this row happens to hold.
        cell.style.flex = `0 0 calc((100% - ${APP_COLS - 1} * ${APP_COL_GAP}) / ${APP_COLS})`
        row.appendChild(cell)
      }
      page.appendChild(row)
    }
    return page
  }

  /**
   * ONE APP ICON: a plate you can see, and its name under it.
   *
   * The PLATE is the whole change from the rail. A bare glyph is a mark on
   * black — at arm's length twenty of them are one texture, and picking one
   * out means reading every caption. A filled plate has an outline, a size
   * and a tone, which is what turns "the bright one, top left" into something
   * a hand learns once and then never re-reads.
   *
   * Tone carries meaning and nothing else does: steel-FILLED = what this tile
   * can be OPENED AS, plain = what it can do, rust = the verbs that destroy
   * something. An icon whose bee has not registered yet is shaded and inert,
   * the same readiness rule the rail applies.
   */
  #appCell(
    chip: Chip,
    label: string,
    opts: { size?: string; glyph?: string; named?: boolean } = {},
  ): HTMLElement {
    const inert = !!chip.backingKey && !window.ioc?.has?.(chip.backingKey)
    const text = this.#t(chip.labelKey, chip.fallback)
    const size = opts.size ?? APP_PLATE
    const glyphSize = opts.glyph ?? APP_GLYPH
    const tone = chip.danger ? APP_TONES.danger : chip.accent ? APP_TONES.accent : APP_TONES.plain

    const btn = document.createElement('button')
    btn.type = 'button'
    btn.setAttribute('aria-label', text)
    btn.setAttribute('data-hc-tv-app', '')
    btn.style.cssText =
      'display:flex;flex-direction:column;align-items:center;justify-content:flex-start;' +
      'gap:0.34rem;min-width:0;padding:0;background:none;border:none;cursor:pointer;' +
      `color:${tone.glyph};opacity:${inert ? 0.32 : 1};` +
      `pointer-events:${inert ? 'none' : 'auto'};`

    const plate = document.createElement('span')
    plate.style.cssText =
      `flex:0 0 auto;width:${size};height:${size};border-radius:${APP_PLATE_RADIUS};` +
      'box-sizing:border-box;display:flex;align-items:center;justify-content:center;' +
      `background:${tone.fill};border:1px solid ${tone.edge};` +
      // One hairline of light along the top edge is the entire relief. More
      // than that and it stops being a plate and starts being a button from
      // somebody else's application.
      'box-shadow:inset 0 1px 0 rgba(255,255,255,0.06);'

    const icon = document.createElement('span')
    icon.style.cssText =
      `display:flex;align-items:center;justify-content:center;width:${glyphSize};height:${glyphSize};`
    if (chip.svg) {
      // Provider markup: 24×24, `fill="white"`. Sized to the plate's glyph box
      // and recoloured through `currentColor`, so the tone tints it.
      icon.innerHTML = chip.svg
      const svg = icon.firstElementChild as SVGElement | null
      if (svg) {
        svg.setAttribute('width', '100%')
        svg.setAttribute('height', '100%')
        svg.setAttribute('fill', 'currentColor')
      }
    } else {
      icon.textContent = chip.glyph ?? ''
      icon.style.cssText += `font-family:'Material Symbols Outlined';font-size:${glyphSize};line-height:1;`
    }
    plate.appendChild(icon)
    btn.appendChild(plate)

    if (opts.named !== false) {
      const name = document.createElement('span')
      name.dataset['role'] = 'app-name'
      name.textContent = text
      // TWO lines, clipped after (the clamp lives in VIEW_CSS). "break apart"
      // and "make it public" are two words each and both have to survive; the
      // fixed cell height means a second line costs the row below nothing.
      name.style.cssText =
        'font-size:0.7rem;font-weight:600;line-height:1.18;letter-spacing:0.01em;' +
        'width:100%;text-align:center;word-break:break-word;text-transform:lowercase;' +
        'color:rgba(233,240,246,0.74);'
      btn.appendChild(name)
    }

    btn.addEventListener('click', () => { this.#activate(chip, label) })
    return btn
  }

  // ── content ────────────────────────────────────────────────

  #notesText(label: string): string {
    try {
      const notes = window.ioc?.get?.('@diamondcoreprocessor.com/NotesService') as NotesShape | undefined
      const list = notes?.notesFor?.(label) ?? []
      return list.map(n => String(n?.text ?? '')).filter(Boolean).join('\n\n')
    } catch { return '' }
  }

  /** Resolve the tile's display picture and paint it. Async and best-effort —
   *  the view is already up and useful without it (a tile with no picture is a
   *  name, its notes and its actions, not an error). */
  async #paintPicture(label: string): Promise<void> {
    const sig = await this.#pictureSig(label)
    // Bailed out or closed while resolving.
    if (!sig || this.#label !== label || !this.#host) return
    const url = await this.#objectUrl(sig)
    if (!url || this.#label !== label || !this.#host) return
    const picture = this.#host.querySelector('[data-role="picture"]') as HTMLElement | null
    if (!picture) return
    picture.style.backgroundImage = `url("${url}")`
    // The letter was a stand-in for the picture, not a caption for it.
    const initial = picture.querySelector('[data-role="initial"]') as HTMLElement | null
    if (initial) initial.style.display = 'none'
  }

  /** The tile's DISPLAY picture signature, read canonical-first then through
   *  the participant-local props index — the same two stores, in the same
   *  order, the slides viewer reads (index-only tiles are common).
   *
   *  `small.image` FIRST, not `large.image`: that is the point-top hex
   *  thumbnail the hive itself renders, already framed for this shape. The
   *  full-size image is the fallback, cropped to `cover` — right picture,
   *  slightly different framing from the hex you tapped. */
  async #pictureSig(label: string): Promise<string> {
    const store = this.resolve<StoreShape>('store')
    const history = window.ioc?.get?.('@diamondcoreprocessor.com/HistoryService') as HistoryShape | undefined
    if (!store?.getResourceLocal) return ''

    const fromPropsSig = async (sig: string): Promise<string> => {
      if (!SIG.test(sig)) return ''
      try {
        const blob = await store.getResourceLocal(sig)
        if (!blob) return ''
        const props = JSON.parse(await blob.text()) as {
          small?: { image?: unknown }
          flat?: { small?: { image?: unknown } }
          large?: { image?: unknown }
        }
        const image = props?.small?.image ?? props?.flat?.small?.image ?? props?.large?.image
        return typeof image === 'string' && SIG.test(image) ? image : ''
      } catch { return '' }
    }

    try {
      if (history?.sign && history?.currentLayerAt) {
        const sig = await history.sign({ explorerSegments: () => [...this.#segments, label] })
        const layer = await history.currentLayerAt(sig)
        const slot = layer?.['properties']
        const canonical = await fromPropsSig(Array.isArray(slot) && typeof slot[0] === 'string' ? slot[0] : '')
        if (canonical) return canonical
      }
    } catch { /* fall through to the index */ }

    try {
      const key = await cellLocationSig(this.#segments, label)
      const indexed = lookupTilePropsSig(readTilePropsIndex(), key, label)
      if (indexed) return await fromPropsSig(indexed)
    } catch { /* index unavailable */ }
    return ''
  }

  /** Object URL for a content signature. Sig-addressed bytes carry NO MIME and
   *  an empty-type blob does not decode in a CSS background — sniff the real
   *  type from the bytes and re-wrap. */
  async #objectUrl(sig: string): Promise<string> {
    const store = this.resolve<StoreShape>('store')
    if (!store?.getResource) return ''
    try {
      const blob = await store.getResource(sig)
      if (!blob) return ''
      let typed = blob
      if (!blob.type) {
        const bytes = new Uint8Array(await blob.arrayBuffer())
        const mime = sniffImageMime(bytes) || ''
        if (mime) typed = new Blob([bytes], { type: mime })
      }
      const url = URL.createObjectURL(typed)
      this.#urls.push(url)
      return url
    } catch { return '' }
  }

  /** A caption, or the plain-English stand-in. `t()` ECHOES THE KEY BACK when
   *  it cannot resolve one, and a provider that registered no `labelKey` at
   *  all asks it for the empty string — both of which used to reach the screen
   *  verbatim, which on the deck is an icon with no name under it. */
  #t(key: string, fallback: string): string {
    if (!key) return fallback
    try {
      const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
      const text = i18n?.t(key)
      return text && text !== key ? text : fallback
    } catch { return fallback }
  }

  #setViewActive(active: boolean): void {
    if (this.#viewActive === active) return
    this.#viewActive = active
    const modes = window.ioc.get('@diamondcoreprocessor.com/ModeRegistry') as
      { enter(mode: string, owner: string): void; exit(mode: string, owner: string): void } | undefined
    if (active) modes?.enter('view:active', 'tile-view')
    else modes?.exit('view:active', 'tile-view')
  }
}

const _tileView = new TileViewDrone()
window.ioc.register('@diamondcoreprocessor.com/TileViewDrone', _tileView)
