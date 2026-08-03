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
// actions as rows of thumb-sized icons — five to a row, growing downward with
// no cap, because a screen (unlike the hexagon the band has to fit inside) has
// room for however many a tile turns out to carry.
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
// at the centre of the screen (`elementFromPoint`); while that is not us we
// hand back the chrome and stop owning Escape/back, and the moment it is us
// again we take both back and re-mount. Nothing has to announce that it
// closed, so a bee that opens its own surface needs no cooperation from here —
// and an action that opens nothing at all (a toggle) never even flickers,
// because the chrome is only released once we are genuinely covered.
//
// Only three verbs still close: going inside (you have left), picking the tile
// (the picked set is a hive activity), and the way out.

import { Drone, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { sniffImageMime } from '../../link/photo.js'
import { readTilePropsIndex, lookupTilePropsSig, cellLocationSig } from '../../editor/tile-properties.js'
import { hasDecorationKind } from '../../commands/decoration-kind-index.js'
import { nextTile, VIEW_ENTER_PREFIX } from './viewer-walk.js'
import type { VisualBeeDescriptor, VisualBeeRegistry } from '../../commands/visual-bee-registry.js'

const SIG = /^[0-9a-f]{64}$/
/** Shared takeover z across the full-surface view drones (home/site/slides). */
const TAKEOVER_Z = 59988
const STEEL = 'rgba(126,182,214,0.92)'
const DIM = 'rgba(207,226,238,0.62)'
/** Thumb-target floor. The desktop band's 3rem circles are a cursor size. */
const TAP = '3.25rem'
/** The hive's hexagon, exactly: point-top, √3/2 wide for its height. Same
 *  numbers the aggregate-index and collections-landing hexes use — a tile in
 *  close-up must be the same shape as the tile you tapped. */
const HEX_CLIP = 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)'
const HEX_RATIO = '0.866'
/** Travel that makes a horizontal drag a step to the next tile. Roughly a
 *  thumb's width — under it, a finger resting and lifting is still a tap. */
const SWIPE_PX = 56
/** Icons per row. Five is what the desktop band chunks at, so a tile's set
 *  breaks in the same places on both surfaces. UNLIKE the band there is no row
 *  cap: a hexagon is only so tall, a screen is not, so the block simply keeps
 *  adding rows downward and scrolls if it ever outgrows the panel. */
const MENU_COLUMNS = 5
/** ONE COLUMN, ONE WIDTH. The hexagon, the name, the notes and every row of
 *  icons are laid on the same axis at the same width — a close-up of a tile
 *  reads as one object, not a stack of differently-sized blocks. (Before this
 *  the hexagon was `min(66vw,19rem)` and the icon rows `24rem`: on a phone the
 *  menu was visibly wider than the tile it belonged to.) */
const COLUMN = 'min(100%, 23rem)'
/** The hexagon inside that column — inset, so the column's edge is a margin
 *  around the tile rather than a line the tile touches. */
const HEX_PORTRAIT = 'min(68vw, 17rem)'
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
/** How often the suspended view asks whether it is back on top. Cheap (one
 *  hit-test), and it runs ONLY while suspended. */
const WATCH_MS = 350

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
    if (this.#label === label) return
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
    this.#startWatch()
  }

  /** Is the middle of the screen still ours? The one question that decides
   *  suspension, asked of the DOM rather than of the surfaces — nothing has to
   *  tell us it opened, and nothing has to remember to tell us it closed. */
  #onTop(): boolean {
    const host = this.#host
    if (!host) return false
    const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
    return !!el && (el === host || host.contains(el))
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

  /** COVERED → give the chrome back, because whatever is on top may need it
   *  (the docked panels measure themselves against the controls bar). CLEAR
   *  AGAIN → take it back, take the keys back, and re-mount: the action just
   *  taken is very often a note, a picture or a decoration ON THIS TILE, and
   *  coming back to the close-up it changed still showing the old one is the
   *  same bug in a quieter form. */
  #tickWatch = (): void => {
    if (!this.#label) { this.#stopWatch(); return }
    if (!this.#onTop()) {
      if (this.#viewActive) this.#setViewActive(false)
      return
    }
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
    stage.style.cssText =
      `display:flex;align-items:center;justify-content:center;gap:${STACK_GAP};` +
      'width:100%;max-width:56rem;max-height:100%;min-height:0;'
    host.appendChild(stage)

    // THE TILE, AS A TILE. A hexagon — the same point-top shape it has on the
    // hive — not a rectangle with the picture letterboxed into it. Tapping a
    // hex and getting a hex back is what makes this read as "that tile, up
    // close" rather than a separate screen about it. The outer element is the
    // 2px steel edge: clip-path erases borders, so the frame has to be a
    // second clipped box behind the first.
    const hexFrame = document.createElement('div')
    hexFrame.dataset['role'] = 'hex-frame'
    hexFrame.style.cssText =
      // border-box, or the 2px edge is ADDED to the sized box and the ratio
      // — and with it the hexagon — comes out slightly squashed.
      `flex:0 0 auto;box-sizing:border-box;aspect-ratio:${HEX_RATIO};padding:2px;background:${STEEL};` +
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
    stage.appendChild(hexFrame)

    // ── the column beside/below it ──
    const panel = document.createElement('div')
    panel.dataset['role'] = 'panel'
    // THE COLUMN. Its `gap` is the entire vertical rhythm of the view — no
    // block below it carries a margin, so every join is the same height and
    // the column cannot go ragged when one of them happens to be absent.
    panel.style.cssText =
      'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      `gap:${STACK_GAP};min-width:0;min-height:0;width:${COLUMN};max-width:100%;`
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
      noteEl.style.cssText =
        `flex:0 1 auto;width:100%;font-size:0.95rem;line-height:1.5;color:${DIM};` +
        'overflow-y:auto;max-height:24vh;white-space:pre-wrap;' +
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
    const viewers = this.#viewerRow(label)
    if (viewers) panel.appendChild(viewers)
    const creations = this.#creationRow(label)
    if (creations) panel.appendChild(creations)
    panel.appendChild(this.#actionRow(label))

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
      'font-size:0.68rem;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;' +
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
    const registry = window.ioc?.get?.<VisualBeeRegistry>(
      '@diamondcoreprocessor.com/VisualBeeRegistry',
    )
    const bees = (registry?.forPlatform?.('mobile') ?? [])
      .filter(bee =>
        bee.adoptable !== false &&
        bee.behavior !== 'navigation' &&
        !hasDecorationKind(label, bee.decorationKind),
      )
    if (bees.length === 0) return null

    const section = document.createElement('section')
    section.style.cssText =
      `display:flex;flex-direction:column;align-items:inherit;gap:${TIGHT_GAP};width:100%;`

    const title = document.createElement('div')
    title.textContent = this.#t('tile-view.creations', 'available creations')
    title.style.cssText =
      'font-size:0.68rem;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;' +
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
    row.style.cssText =
      `display:flex;flex-wrap:wrap;gap:${TIGHT_GAP};justify-content:center;width:100%;`
    return row
  }

  #creationChip(bee: VisualBeeDescriptor, label: string): HTMLElement {
    return this.#chip({
      action: `view:${bee.view}`,
      glyph: bee.toggleIcon || 'add_box',
      labelKey: bee.labelKey || '',
      fallback: bee.view,
      backingKey: bee.queenKey,
    }, label)
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
    const frame = host.querySelector('[data-role="hex-frame"]') as HTMLElement | null
    const panel = host.querySelector('[data-role="panel"]') as HTMLElement | null
    const row = host.querySelector('[data-role="actions"]') as HTMLElement | null
    if (!stage || !frame || !panel) return

    if (landscape) {
      stage.style.display = 'grid'
      stage.style.gridTemplateColumns = '1fr auto 1fr'
      frame.style.gridColumn = '2'
      panel.style.gridColumn = '3'
      frame.style.height = 'min(72vh, 21rem)'
      frame.style.width = 'auto'
      panel.style.flex = ''
      panel.style.alignItems = 'flex-start'
      panel.style.textAlign = 'left'
      if (row) row.style.justifyContent = 'flex-start'
    } else {
      stage.style.display = 'flex'
      stage.style.gridTemplateColumns = ''
      frame.style.gridColumn = ''
      panel.style.gridColumn = ''
      stage.style.flexDirection = 'column'
      // Narrower than the column it sits in, so the tile is inset in its own
      // screen instead of touching the same edge the icon rows do.
      frame.style.width = HEX_PORTRAIT
      frame.style.height = 'auto'
      panel.style.flex = '0 1 auto'
      panel.style.alignItems = 'center'
      panel.style.textAlign = 'center'
      if (row) row.style.justifyContent = 'center'
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
    row.style.flex = '0 1 auto'
    // Past a few rows the block scrolls rather than pushing the hexagon off
    // the screen. `pan-y` so this scroll is possible at all while the host
    // holds every other touch action (see #mount).
    row.style.overflowY = 'auto'
    row.style.overscrollBehavior = 'contain'
    row.style.touchAction = 'pan-y'
    row.style.alignContent = 'flex-start'

    const chips: Chip[] = [
      // GO INSIDE leads: a branch's whole point is what is under it, and the
      // close-up is reached by holding one. Emitted as a request rather than
      // driven from here — every readiness gate, phantom-segment latch and
      // guard that entering a tile needs already lives in the overlay, and a
      // second implementation of it would be a second set of those bugs.
      {
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
      },
      // EVERYTHING THE BAND CARRIES — edit, note, share, features, adopt,
      // hide, block, files, invite, remove, the lot — resolved for THIS tile
      // by the surface that owns them. These used to be a hand-written subset
      // here, which meant a phone saw five of the twenty-odd affordances a
      // tile can have and no bee could add to them. Minus the viewers, which
      // `#viewerRow` has already put at the top of the column as their own
      // question.
      ...this.#overlayChips(label).filter(c => !c.action.startsWith(VIEW_ENTER_PREFIX)),
      // PICK IT. The close-up is one tile; the picked set is how you act on
      // several, and every set verb (marking, removing, the clipboard, the
      // options ring) reads that one selection. Arming the picker on the way
      // out means the tile you were just looking at is the first one in.
      {
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
      },
    ]

    for (const chip of chips) {
      if (chip.when && !chip.when()) continue
      row.appendChild(this.#chip(chip, label))
    }
    // THE ROW YOU CAME FROM, reachable without leaving. The swipe does the
    // same thing and does it faster, but a swipe is invisible — these are how
    // anyone finds out it is there. Hidden outright when there is nowhere to
    // step, so a single-tile layer never offers a dead control.
    for (const delta of [-1, 1] as const) {
      if (!this.#sibling(delta)) continue
      row.appendChild(this.#chip({
        action: delta < 0 ? 'previous-tile' : 'next-tile',
        glyph: delta < 0 ? 'chevron_left' : 'chevron_right',
        labelKey: delta < 0 ? 'tile-view.previous' : 'tile-view.next',
        fallback: delta < 0 ? 'previous' : 'next',
        run: () => this.#step(delta),
      }, label))
    }
    row.appendChild(this.#exitChip())
    return row
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
      // Through the overlay, not a bare emit: it owns the `tile:action`
      // payload shape (q/r/index) and the one action that is not an emit at
      // all (break-apart plays its shatter first).
      run: () => {
        const overlay = window.ioc?.get?.('@diamondcoreprocessor.com/TileOverlayDrone') as
          OverlayActionsShape | undefined
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
    // Five across, exactly: the basis subtracts the four gaps between them, so
    // every cell in the block is the same width whatever row it lands on.
    btn.style.cssText =
      `min-height:${TAP};padding:0.5rem 0.2rem;border-radius:${RADIUS};` +
      `flex:0 0 calc((100% - ${MENU_COLUMNS - 1} * ${TIGHT_GAP}) / ${MENU_COLUMNS});` +
      'box-sizing:border-box;' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'gap:0.3rem;cursor:pointer;' +
      `background:${chip.accent ? STEEL : 'rgba(20,26,34,0.9)'};` +
      `color:${chip.accent ? '#04121b' : 'rgba(245,245,245,0.9)'};` +
      `border:1px solid ${chip.accent ? 'transparent' : 'rgba(255,255,255,0.12)'};` +
      `opacity:${inert ? 0.4 : 1};pointer-events:${inert ? 'none' : 'auto'};`

    const icon = document.createElement('span')
    icon.style.cssText =
      'display:flex;align-items:center;justify-content:center;width:1.5rem;height:1.5rem;'
    if (chip.svg) {
      // Provider markup: 24×24, `fill="white"`. Sized down to the cell and
      // recoloured through `currentColor` so an accent cell inverts with the
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
      icon.style.cssText += "font-family:'Material Symbols Outlined';font-size:1.4rem;line-height:1;"
    }
    btn.appendChild(icon)

    const caption = document.createElement('span')
    caption.textContent = text
    // One line, clipped rather than wrapped: a two-line caption makes one cell
    // taller than its neighbours and the whole row goes ragged.
    caption.style.cssText =
      'font-size:0.62rem;font-weight:600;line-height:1.1;max-width:100%;letter-spacing:0.01em;' +
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:0.82;'
    btn.appendChild(caption)

    btn.addEventListener('click', () => {
      if (chip.run) { chip.run(); return }
      // The exact rendered name: swarm-adopt string-matches the peer entry's
      // `name` and does NOT normalize, so a normalized label would silently
      // match nothing.
      this.emitEffect('tile:action', { action: chip.action, label })
      // Whatever this opened comes up over the close-up, which waits under it
      // — see `#suspend`. Adopt is the exception in the other direction: its
      // own `adopt:done` listener closes the view outright, because both
      // shells snap back to hexagons on a non-silent adopt.
      if (chip.action !== 'adopt') this.#suspend()
    })
    return btn
  }

  /** The way out, as an ordinary cell — it belongs in the grid with everything
   *  else rather than floating beside it at a different shape. */
  #exitChip(): HTMLElement {
    return this.#chip({
      action: 'exit',
      glyph: 'grid_view',
      // Its OWN key, not slides' — "Back to the hive" is the right thing for a
      // deck's aria-label and far too long for a caption under an icon.
      labelKey: 'tile-view.exit',
      fallback: 'back',
      run: () => this.close(),
    }, '')
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

  #t(key: string, fallback: string): string {
    try {
      const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
      return i18n?.t(key) ?? fallback
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
