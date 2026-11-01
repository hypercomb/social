// quickmenu/quick-menu.input.ts
//
// The gesture. Summon, roll through focus, activate.
//
// ── The shape of it ───────────────────────────────────────────────────
//
//   summon   hold alt over a tile, or a long-press on touch
//   aim      the pointer is HIDDEN; rolling over a neighbour focuses it
//   descend  a pathway eases into becoming the next ring's centre
//   activate a leaf either fires on arrival or waits for release/click,
//            as declared by the behaviour that owns it
//   cancel   come back to the centre and release; the centre relabels
//            itself the moment you leave, so the way out is visible
//
// ── Never awaits anything ─────────────────────────────────────────────
//
// Every menu is resolved from the in-memory registry and drawn from a
// prebuilt subtree. There is no OPFS read, no fetch, and no await between
// pointerdown and paint. A gesture tool that can stall is not a gesture
// tool.
//
// ── On a tile, the ring is a layer ────────────────────────────────────
//
// When the menu belongs to a tile on the hive, it is drawn in that tile's
// render layer, around the tile, and the cursor stays where it is. Holding
// alt over a tile raises the selection menu the same way. The cursor-hiding
// DOM ring remains for every surface that is not the hive.
//
// ── One exception: a phone, on a tile ─────────────────────────────────
//
// A long-press over a tile in mobile mode does NOT summon the ring. There,
// the hold means the tile: let go without moving and its screen opens, pull
// and drag-to-move takes it. Both of those are the same press, so the summon
// stays out of the way entirely — it claims no gate, pushes no mode, takes no
// pointer lock. See `#pendingView`. Everywhere else, and anywhere off a tile,
// the ring is unchanged.
//
// ── A finger summons only over the hexagons ───────────────────────────
//
// The listeners are on the window, so a hold on ANY surface used to mature —
// a tile page, the phone's list, a website, a game. The press was then read
// against the canvas underneath, which those surfaces hide but never move:
// a hidden tile under the finger opened ITS screen over the one being read,
// and empty hive under it painted the ring. Either way the hexagons came up
// in the middle of another view. A touch summon now starts only when the
// finger landed on the hive canvas itself — the same test every other touch
// gesture on the hive makes.
//
// ── Why it takes the input stack AND the gate ─────────────────────────
//
// InputModeStack suspends whatever mode is on top (the migrated systems);
// InputGate locks the ones that haven't migrated yet. Holding both is the
// only way to guarantee that a flick across the canvas doesn't also pan it.

import { EffectBus, POINTER_GESTURE_END, isPointerConsumed } from '@hypercomb/core'
import type { InputMode } from '../navigation/input-mode-stack.service.js'
import { QuickMenuOverlay } from './quick-menu.overlay.js'
import { QuickMenuLayer } from './quick-menu.layer.js'
import { fireQuickMenuSlot } from './quick-menu.fire.js'
import { QuickMenuFlight } from './quick-menu.flight.js'
import { isLongPressMenu } from '../navigation/browser-menu.js'
import type { QuickMenuRegistry } from './quick-menu-registry.service.js'
import { selectionMenuWanted } from './quick-menu.tile-menu.js'
import {
  HEX_RADIUS,
  OPPOSITE_DIRECTION,
  RING_DISTANCE,
  directionAt,
  slotsByDirection,
  type QuickMenuDefinition,
  type QuickMenuDirection,
  type QuickMenuSlot,
} from './quick-menu.types.js'

const get = <T,>(key: string): T | undefined =>
  (globalThis as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

/** Touch summon: the press must be held this long before the menu claims
 *  the finger, so a swipe is still a pan. */
const HOLD_MS = 380

/** Touch drift that cancels an un-armed long-press. */
const JITTER_PX = 12

const OWNER = 'quick-menu'

/** Alt held this long over a tile flies it to the middle for the flower, so a
 *  tap of the key passes without moving the hive. Ctrl is selection's alone. */
const ALT_HOLD_MS = 220

/**
 * Drag-to-move's gate source. It CLAIMS the gate when its own hold matures at
 * 300ms — on a finger that has not travelled and may never travel — expressly
 * to reserve the gesture in case it becomes a drag. This summon lands 80ms
 * later and used to refuse outright on a claimed gate, so on any tile you can
 * move (which is all of your own) the ring was unreachable: the reservation
 * for a drag that had not happened outranked the gesture actually being made.
 *
 * TRAVEL is what tells them apart, and it already does — travel past the
 * jitter box cancels this summon, and stillness past this timer is not a drag.
 * So a still-armed drag is not a competitor to be deferred to; it is the same
 * press, and the ring takes the claim off it.
 */
const TOUCH_MOVE_SOURCE = 'touch-move'

/** How far the drawn pointer may travel from the ring centre. Clamping the
 *  magnitude never changes the angle, so the slot you are on is unaffected —
 *  it only stops the pointer wandering off into empty screen while locked. */
const REACH = RING_DISTANCE + HEX_RADIUS * 1.1

type CellAt = { q: number; r: number; label: string }
type OverlayLike = {
  labelAtClient(x: number, y: number): string | null
  cellAtClient?(x: number, y: number): CellAt | null
  axialForLabel?(label: string): { q: number; r: number } | null
}
type LineageLike = { explorerSegments?: () => readonly string[] }
type GateLike = {
  lock(owner: string): void
  unlock(owner: string): void
  release?(source: string): void
  active?: boolean
  locked?: boolean
  owner?: string | null
}
type StackLike = { push(mode: InputMode): void; pop(name: string): void }

type Level = {
  readonly definition: QuickMenuDefinition
  /** Direction that returns to the parent ring; null on the root ring. */
  readonly back: QuickMenuDirection | null
  /** Screen location this level treats as its centre of focus. */
  readonly focus: { readonly x: number; readonly y: number }
}

const SELECTION_MENU = 'selection'

export class QuickMenuInput {
  #overlay = new QuickMenuOverlay()
  #layer: QuickMenuLayer | null = null
  #flight: QuickMenuFlight | null = null
  #altTimer: ReturnType<typeof setTimeout> | null = null
  #cursorStyle: HTMLStyleElement | null = null
  /** Tile the on-screen menu is drawn around, when it is a layer. */
  #anchor: { q: number; r: number } | null = null
  /** The quick-menu gesture took the gate. A tile layer does not. */
  #gateHeld = false
  #altDown = false
  /** Escape dismissed the alt menu; it stays down until alt is released. */
  #altLatchedOff = false
  #altShown = false
  #pointerDown = false
  /** The pointer that set #pointerDown. A lost pointerup matches this id. */
  #buttonPointer: number | null = null
  #slotPress: QuickMenuDirection | null = null
  #slotPointer: number | null = null
  #hoverCell: CellAt | null = null
  #activeLabel: string | null = null
  #wand = false
  #clipboard = false
  #onCtrlIcon = false
  #onTile = false

  #levels: Level[] = []
  #pointerId: number | null = null
  #armed = false
  #painted = false
  /** Pointer released, ring still up: aim with a free pointer, click to fire. */
  #sticky = false
  #current: QuickMenuDirection = 'centre'
  #leftDeadZone = false
  /** Focus just moved through a pathway; releasing now parks on the new ring. */
  #justFocused = false

  #holdTimer: ReturnType<typeof setTimeout> | null = null
  #warmed = false

  /** Where a touch landed, while the long-press is still deciding. */
  #touchDown: { x: number; y: number } | null = null
  /**
   * The tile the touch long-press was summoned OVER, when it was over one.
   *
   * A hold on a tile is the only long-press a finger makes that already has a
   * subject, and the verb it wants is that tile's own screen — so the ring's
   * ZERO-TRAVEL slot becomes it. Hold and let go: the close-up. Hold and flick:
   * the ordinary ring, unchanged. One gesture, and the normal one still costs
   * nothing to reach.
   */
  #tileLabel: string | null = null
  /**
   * Every finger currently down. A touch device has no Escape key and no
   * pointer lock, so the two ways this gesture ends on desktop are both
   * absent — which makes a summon bound to a finger that never reports up an
   * unrecoverable state: the ring stays armed, the InputGate stays locked,
   * and nothing pans again. Knowing when the last finger left is what lets
   * the gesture close itself no matter which pointer it was waiting for.
   */
  #touches = new Set<number>()
  /** A tile drag is live — the finger already declared itself by travelling. */
  #touchDragging = false
  /**
   * ON A PHONE, A HOLD ON A TILE IS THAT TILE'S SCREEN — the ring never opens
   * over it. Held here from the moment the hold matures until the finger
   * either travels (drag-to-move takes it) or lets go (the screen opens).
   *
   * Nothing is claimed while this is pending: no InputGate lock, no input-mode
   * push, no pointer lock. That is the entire point. The ring's summon USED to
   * take the gate off drag-to-move at 380ms on the theory that a still finger
   * is not a drag — but on a phone the still finger has not finished deciding,
   * and taking the reservation meant a pull that started late aimed a ring
   * instead of moving the tile, with the gate left locked behind it. Leaving
   * the reservation where it is makes the two gestures one press again: pull
   * and it moves, let go and it opens.
   */
  #pendingView: { label: string; pointerId: number; x: number; y: number } | null = null
  /** The hive's canvas — the only surface a touch hold summons over. */
  #canvas: HTMLCanvasElement | null = null

  /**
   * Where the DRAWN pointer is, in screen coordinates. The real cursor is
   * locked away the whole time the ring is up, so this — not the OS pointer —
   * is what aims. It starts at the ring centre and moves by raw deltas.
   */
  #virtual = { x: 0, y: 0 }
  /** True once the browser has granted pointer lock. */
  #locked = false

  #mode: InputMode = {
    name: OWNER,
    // Nothing to mount: this drone's listeners are global and always live.
    // The push exists to SUSPEND the mode underneath for the duration.
    mount: () => {},
    unmount: () => {},
  }

  constructor() {
    window.addEventListener('pointerdown', this.#onPointerDown, { capture: true })
    window.addEventListener('pointermove', this.#onPointerMove, { passive: false })
    window.addEventListener('pointerup', this.#onPointerUp, { passive: false })
    window.addEventListener('pointercancel', this.#onPointerCancel)
    // A tile gesture that acted on the press SWALLOWS the trailing pointerup at
    // window capture, so the listener above never runs for that finger. Press a
    // branch tile, let the view change under your thumb, keep holding: the hold
    // timer fires on a pointer whose release can no longer be heard, the ring
    // arms, the gate locks, and touch drag is dead for the rest of the session.
    // The consumer re-announces the end for exactly this reason.
    window.addEventListener(POINTER_GESTURE_END, this.#onGestureEnd as EventListener)
    window.addEventListener('keydown', this.#onKeyDown, { capture: true })
    window.addEventListener('keyup', this.#onKeyUp, { capture: true })
    // The camera is set in stone while the flower is up, and alt+wheel would
    // otherwise cycle the spotlight behind it.
    window.addEventListener('wheel', this.#onWheel, { capture: true, passive: false })

    EffectBus.on<{ canvas?: HTMLCanvasElement }>('render:host-ready', payload => {
      this.#canvas = payload?.canvas ?? null
      this.#syncAltMenu()
    })

    EffectBus.on<{ q?: number; r?: number; label?: string | null }>('tile:hover', (payload) => {
      const label = typeof payload?.label === 'string' ? payload.label.trim() : ''
      this.#hoverCell = label && typeof payload?.q === 'number' && typeof payload?.r === 'number'
        ? { q: payload.q, r: payload.r, label }
        : null
      this.#syncAltMenu()
    })

    EffectBus.on<{ selected?: unknown; active?: unknown }>('selection:changed', (payload) => {
      if (!Array.isArray(payload?.selected)) return
      const active = payload.active
      const first = payload.selected.find((value): value is string => typeof value === 'string' && value.length > 0)
      this.#activeLabel = typeof active === 'string' && active ? active : first ?? null
    })

    EffectBus.on<{ active?: boolean }>('wand:armed', (payload) => {
      this.#wand = payload?.active === true
      this.#syncAltMenu()
    })

    EffectBus.on<{ open?: boolean }>('clipboard:open', (payload) => {
      this.#clipboard = payload?.open === true
      this.#syncAltMenu()
    })

    EffectBus.on<{ held?: boolean }>('overlay:ctrl-band', (payload) => {
      this.#onCtrlIcon = payload?.held === true
      this.#syncAltMenu()
    })

    window.addEventListener('blur', () => {
      this.#flight?.end(false)
      this.#altDown = false
      this.#altLatchedOff = false
      this.#pointerDown = false
      this.#buttonPointer = null
      this.#slotPress = null
      this.#slotPointer = null
      this.#syncAltMenu()
    })

    EffectBus.on<{ active?: boolean }>('touch:dragging', payload => {
      this.#touchDragging = !!payload?.active
      // The pull won. The screen this hold would have opened is not what the
      // hand is doing any more.
      if (this.#touchDragging) this.#pendingView = null
    })

    // Chrome opens autoscroll on a middle mousedown; only preventDefault on
    // the mouse event itself reliably suppresses it.
    window.addEventListener('mousedown', this.#suppressMiddleMouse, { capture: true })
    window.addEventListener('auxclick', this.#suppressAux, { capture: true })
    window.addEventListener('contextmenu', this.#onContextMenu, { capture: true })

    // Losing the lock IS the end of the gesture — the browser drops it on
    // Escape, on tab switch, and on anything that steals focus. Treating that
    // as a cancel is what stops a ring being stranded on screen with the real
    // cursor already back.
    document.addEventListener('pointerlockchange', this.#onLockChange)
    document.addEventListener('pointerlockerror', this.#onLockChange)

    // Resize restarts at a stable screen-centred root; an in-flight hierarchy
    // cannot preserve meaningful screen-space focus while the viewport moves.
    window.addEventListener('resize', () => {
      if (!this.#painted) return
      if (this.#anchor) { this.#paint(); return }
      const focus = this.#centre()
      this.#levels = this.#levels.length
        ? [{ ...this.#levels[0], focus }]
        : this.#levels
      this.#virtual = focus
      this.#current = 'centre'
      this.#leftDeadZone = false
      this.#justFocused = false
      this.#paint()
    })

    // Relabel on locale change — the built subtrees hold resolved strings.
    const i18n = get<EventTarget>('@hypercomb.social/I18n')
    i18n?.addEventListener?.('change', () => {
      this.#overlay.invalidate()
      this.#warmed = false
      this.#scheduleWarm()
    })

    this.#scheduleWarm()
  }

  // ── warm ────────────────────────────────────────────────────────────

  #scheduleWarm(): void {
    const run = () => { this.warmup() }
    const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void })
      .requestIdleCallback
    if (idle) idle(run, { timeout: 1500 })
    else setTimeout(run, 0)
  }

  /**
   * Build every registered ring and the cursor-hiding rule up front, so the
   * first summon of a cold session is a paint and nothing else. Idempotent —
   * safe to call from the platform's warmup hook as well as from boot idle.
   */
  warmup(): void {
    if (this.#warmed) return
    const registry = get<QuickMenuRegistry>('@diamondcoreprocessor.com/QuickMenuRegistry')
    if (!registry) return
    this.#overlay.warm(registry.all(), registry.label)
    this.#overlay.cancelLabel = registry.label({ label: 'cancel', labelKey: 'quickmenu.cancel' })
    this.#ensureCursorStyle()
    this.#warmed = true
  }

  #ensureCursorStyle(): HTMLStyleElement {
    if (this.#cursorStyle?.isConnected) return this.#cursorStyle
    const style = document.createElement('style')
    style.id = 'hc-quick-menu-cursor'
    // Every descendant sets its own cursor; only `!important` on `*` wins.
    style.textContent = 'html.hc-quick-menu-active, html.hc-quick-menu-active * { cursor: none !important; }'
    style.disabled = false
    document.head.appendChild(style)
    this.#cursorStyle = style
    return style
  }

  // ── trigger ─────────────────────────────────────────────────────────

  #isChrome(target: EventTarget | null): boolean {
    const element = target as HTMLElement | null
    if (!element?.closest) return false
    return !!element.closest(
      'a,button,input,textarea,select,[contenteditable="true"],[role="button"],[role="textbox"]',
    )
  }

  #onPointerDown = (e: PointerEvent): void => {
    // Flying to the middle: a press is the click that answers the flower.
    if (this.#flight?.active) {
      e.preventDefault()
      e.stopPropagation()
      if (e.button === 0) this.#flight.confirm()
      return
    }
    // A click on a selection-menu option. The tile body is not one, so a
    // click there is still a click on the tile. Stopping the event keeps the paint
    // and the tile click from also reading this press.
    if (this.#altShown && !this.#armed && !this.#sticky && e.button === 0) {
      const slot = this.#tiles().slotAtClient(e.clientX, e.clientY, 'pick')
      if (slot) {
        e.preventDefault()
        e.stopPropagation()
        this.#slotPress = slot
        this.#slotPointer = e.pointerId
        return
      }
    }
    if (e.button === 0 || e.button === 1) {
      this.#pointerDown = true
      this.#buttonPointer = e.pointerId
      if (this.#altShown) this.#syncAltMenu()
    }
    // Sticky ring up: any press commits what is lit (or cancels on centre).
    if (this.#sticky) {
      e.preventDefault()
      e.stopPropagation()
      this.#release()
      return
    }
    if (this.#armed) return

    if (e.pointerType === 'touch') {
      // A primary touch is by definition the first finger of a new touch
      // sequence, so any id still in the set is one whose pointerup never
      // arrived. Self-heal there instead of letting a lost event permanently
      // convince us that a finger is still down.
      if (e.isPrimary) this.#touches.clear()
      const first = this.#touches.size === 0
      this.#touches.add(e.pointerId)
      if (this.#isChrome(e.target)) return

      // A second finger is a pan or a pinch, never a summon. Drop the pending
      // press outright — and CLEAR ITS TIMER. Overwriting #holdTimer without
      // clearing left the first press's timer orphaned but still pending: it
      // fired 380ms later, long after both fingers were gone, and armed the
      // ring on a pointer that could never report up. That is the stuck touch
      // drag — an armed ring holds the gate locked and every pan/pinch claim
      // is refused from then on.
      if (!first) {
        this.#clearTimers()
        this.#pointerId = null
        this.#touchDown = null
        this.#pendingView = null
        return
      }
      // A fresh first finger: whatever the last one was waiting to open, it is
      // not what this press is about.
      this.#pendingView = null

      this.#clearTimers()
      this.#pointerId = null
      this.#touchDown = null
      // Another view is under the finger, not the hexagons — the hold is that
      // view's to read. See "A finger summons only over the hexagons" above.
      if (e.target !== this.#canvas) return

      this.#pointerId = e.pointerId
      this.#touchDown = { x: e.clientX, y: e.clientY }
      this.#holdTimer = setTimeout(() => {
        this.#holdTimer = null
        const at = this.#touchDown
        this.#touchDown = null
        // The finger is gone, or a pan/pinch already took the gesture. Either
        // way there is nothing left to summon from.
        if (!this.#touches.has(e.pointerId)) { this.#pointerId = null; return }
        if (isPointerConsumed(e.pointerId)) { this.#pointerId = null; return }
        // A drag that has actually STARTED owns the finger — travel decided it
        // before this timer ran.
        if (this.#touchDragging) { this.#pointerId = null; return }
        const gate = get<GateLike>('@diamondcoreprocessor.com/InputGate')
        // A modal lock is absolute: the ring must not open behind an editor.
        if (gate?.locked) { this.#pointerId = null; return }
        const owner = gate?.owner ?? null
        if (owner && owner !== TOUCH_MOVE_SOURCE) { this.#pointerId = null; return }
        // Resolve the tile from the press COORDINATES. A finger produces no
        // hover, so there is no remembered tile to read — only where it landed.
        const overlay = at
          ? get<OverlayLike>('@diamondcoreprocessor.com/TileOverlayDrone')?.labelAtClient(at.x, at.y) ?? null
          : null

        // PHONE, ON A TILE: no ring at all. The hold is the tile's screen if
        // the finger stays and a move if it pulls — and neither of those is
        // the ring, so claiming nothing is what keeps both of them possible.
        // The haptic still fires: the hand has to be told the hold landed,
        // because from here a pull means something different than a drift.
        if (overlay && at && this.#isMobile()) {
          this.#pendingView = { label: overlay, pointerId: e.pointerId, x: at.x, y: at.y }
          this.#pointerId = null
          try { navigator.vibrate?.(30) } catch { /* no haptics, no matter */ }
          return
        }

        // Take the still-armed drag's reservation, so a finger that moves from
        // here aims the ring instead of also picking the tile up.
        if (owner === TOUCH_MOVE_SOURCE) gate?.release?.(TOUCH_MOVE_SOURCE)
        try { navigator.vibrate?.(30) } catch { /* no haptics, no matter */ }
        const cell = at
          ? get<OverlayLike>('@diamondcoreprocessor.com/TileOverlayDrone')?.cellAtClient?.(at.x, at.y) ?? null
          : null
        this.#begin(e.pointerId, cell?.label ? { q: cell.q, r: cell.r } : null)
        this.#tileLabel = overlay
        this.#paint()
      }, HOLD_MS)
    }
  }

  /** The ring's anchor: always the middle of the screen. */
  #centre(): { x: number; y: number } {
    return { x: window.innerWidth / 2, y: window.innerHeight / 2 }
  }

  /** Claim the pointer and start tracking direction — with or without paint.
   *  `anchor` draws the menu in the tile's layer instead of the cursor ring. */
  #begin(pointerId: number, anchor: { q: number; r: number } | null = null): void {
    const registry = get<QuickMenuRegistry>('@diamondcoreprocessor.com/QuickMenuRegistry')
    if (!registry) return
    this.warmup()

    const focus = this.#centre()
    this.#levels = [{ definition: registry.forContext(), back: null, focus }]
    this.#tileLabel = null
    this.#pointerId = pointerId
    this.#armed = true
    this.#current = 'centre'
    this.#leftDeadZone = false
    this.#justFocused = false
    this.#virtual = focus
    this.#altShown = false
    this.#anchor = this.#usableAnchor(anchor)
    this.#layer?.hide()

    if (this.#anchor) return

    get<GateLike>('@diamondcoreprocessor.com/InputGate')?.lock(OWNER)
    get<StackLike>('@diamondcoreprocessor.com/InputModeStack')?.push(this.#mode)
    this.#gateHeld = true
    this.#requestLock()
  }

  /**
   * Take the real cursor out of play. Pointer lock is precisely the primitive
   * this gesture wants: it hides the OS cursor, reports raw movement deltas
   * instead of positions — so the aim can never be clipped by a screen edge —
   * and on release puts the cursor back exactly where it was picked up.
   *
   * Refusal is NORMAL and must be silent. A sandboxed iframe without
   * `allow="pointer-lock"` throws WrongDocumentError; a browser may want a
   * fresher user gesture; an engine may not support `unadjustedMovement`.
   * In every case the gesture still works — `#advance` falls back to absolute
   * positions and the CSS rule still hides the cursor — so a failed lock is a
   * graceful degradation, not an error to log. Only the recentring and the
   * screen-edge immunity are lost.
   */
  #requestLock(): void {
    if (this.#locked) return
    const target = document.body as HTMLElement & {
      requestPointerLock?: (options?: { unadjustedMovement?: boolean }) => Promise<void> | void
    }
    if (!target.requestPointerLock) return

    // Swallows BOTH failure shapes: the synchronous throw of older engines and
    // the rejected promise of newer ones. An unhandled rejection here would
    // surface as a console error on every summon in a sandboxed frame.
    const attempt = (options?: { unadjustedMovement?: boolean }): Promise<boolean> => {
      try {
        const result = target.requestPointerLock!(options)
        if (result && typeof (result as Promise<void>).then === 'function') {
          return (result as Promise<void>).then(() => true, () => false)
        }
        return Promise.resolve(true)
      } catch {
        return Promise.resolve(false)
      }
    }

    // `unadjustedMovement` asks for raw deltas with no OS pointer acceleration
    // — steadier aim. If that flavour is unsupported, retry plain before
    // giving up on the lock entirely.
    void attempt({ unadjustedMovement: true })
      .then(granted => (granted ? true : attempt()))
      .then(() => undefined, () => undefined)
  }

  #onLockChange = (): void => {
    const held = this.#locked
    this.#locked = document.pointerLockElement === document.body
    // Losing a lock we HELD (Escape, tab switch, focus theft) is the end of
    // the gesture — the cursor is already back, so the ring must go too.
    //
    // A REFUSED request is not. `pointerlockerror` routes here as well, and
    // treating it as a loss closed the ring in the same frame it was painted
    // — on any surface where the lock is unavailable. That is every TOUCH
    // device (mobile browsers do not grant pointer lock), which made the
    // whole marking menu impossible to open on a phone: `open()` returned
    // true, the overlay painted, and the error event tore it straight back
    // down. #requestLock's own contract already says refusal is normal and
    // must degrade silently — #advance falls back to absolute positions, and
    // the CSS rule still hides the cursor. Only a lock that existed can be
    // lost.
    if (!this.#locked && held && (this.#armed || this.#sticky)) this.#end()
  }

  #paint(fromFocus?: { x: number; y: number }): void {
    const level = this.#levels[this.#levels.length - 1]
    if (!level) return
    const registry = get<QuickMenuRegistry>('@diamondcoreprocessor.com/QuickMenuRegistry')
    if (!registry) return

    const centre = level.focus
    const backLabel = registry.label({ label: 'back', labelKey: 'quickmenu.back' })
    if (this.#anchor) {
      this.#overlay.clear()
      document.documentElement.classList.remove('hc-quick-menu-active')
      const layer = this.#tiles()
      layer.place(this.#anchor.q, this.#anchor.r)
      layer.show(level.definition, registry.label, level.back, backLabel)
      layer.highlight(this.#current)
      this.#painted = true
      this.#publishOnTile()
      return
    }
    this.#layer?.hide()
    this.#overlay.paint(level.definition, centre, level.back, registry.label, backLabel, fromFocus)
    // Only the ROOT ring carries the tile: descend and the centre is that
    // ring's own zero-travel verb again.
    this.#overlay.setCentreOverride(this.#levels.length === 1 ? this.#tileLabel : null)
    this.#overlay.highlight(this.#current)
    this.#overlay.setCancelArmed(this.#leftDeadZone)
    this.#overlay.setCursor(this.#virtual.x - centre.x, this.#virtual.y - centre.y)
    document.documentElement.classList.add('hc-quick-menu-active')
    this.#painted = true
    this.#publishOnTile()
  }

  // ── aim ─────────────────────────────────────────────────────────────

  #onPointerMove = (e: PointerEvent): void => {
    if (this.#flight?.active) {
      e.preventDefault()
      this.#flight.move(e)
      return
    }
    if (this.#altShown && !this.#armed && !this.#sticky) {
      this.#tiles().highlight(this.#tiles().slotAtClient(e.clientX, e.clientY, 'pick'))
    }
    if (this.#sticky) {
      this.#advance(e)
      return
    }
    if (!this.#armed) {
      // A matured hold on a tile that starts to TRAVEL is a move, not a
      // screen. Drag-to-move still holds its reservation, so letting go of
      // this is all it takes for the pull to become the pick-up.
      const pending = this.#pendingView
      if (pending && e.pointerId === pending.pointerId) {
        if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > JITTER_PX) this.#pendingView = null
      }
      // Un-armed touch press: drift past the jitter box means the finger was
      // panning, not summoning.
      if (this.#holdTimer && this.#touchDown && e.pointerId === this.#pointerId) {
        const start = this.#touchDown
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > JITTER_PX) {
          this.#clearTimers()
          this.#pointerId = null
          this.#touchDown = null
        }
      }
      return
    }
    if (this.#pointerId !== null && e.pointerId !== this.#pointerId) return
    e.preventDefault()
    this.#advance(e)
  }

  /**
   * Move the drawn pointer. While locked we integrate raw deltas, which is
   * what lets the ring sit at screen centre no matter where the real cursor
   * happened to be — and what stops the aim dying at a screen edge. Unlocked,
   * we fall back to the absolute position.
   */
  #advance(e: PointerEvent): void {
    if (this.#anchor) {
      this.#aim(this.#tiles().slotAtClient(e.clientX, e.clientY, 'gesture'))
      return
    }
    const level = this.#levels[this.#levels.length - 1]
    if (!level) return
    const centre = level.focus
    if (this.#locked) {
      this.#virtual.x += e.movementX ?? 0
      this.#virtual.y += e.movementY ?? 0
    } else {
      this.#virtual = { x: e.clientX, y: e.clientY }
    }

    // Clamp the reach. Magnitude only — the angle, and therefore the slot, is
    // untouched.
    let dx = this.#virtual.x - centre.x
    let dy = this.#virtual.y - centre.y
    const distance = Math.hypot(dx, dy)
    if (distance > REACH) {
      const scale = REACH / distance
      dx *= scale
      dy *= scale
      this.#virtual = { x: centre.x + dx, y: centre.y + dy }
    }
    this.#track(dx, dy)
  }

  /** Pointing at an option on the tile layer. Outside every hex, and not on
   *  the tile, is the same as coming back to the centre: release cancels. */
  #aim(slot: QuickMenuDirection | null): void {
    const level = this.#levels[this.#levels.length - 1]
    if (!level) return
    if (slot === null) {
      if (this.#current !== 'centre') {
        this.#leftDeadZone = true
        this.#current = 'centre'
        this.#justFocused = false
        if (this.#painted) this.#layer?.highlight(null)
      }
      return
    }
    if (slot !== 'centre' && !this.#leftDeadZone) this.#leftDeadZone = true
    const previous = this.#current
    this.#current = slot
    if (slot !== 'centre') this.#justFocused = false
    if (this.#painted) this.#layer?.highlight(slot)
    if (slot === previous || slot === 'centre') return
    if (level.back && slot === level.back) { this.#ascend(); return }
    const found = this.#slotFor(slot)
    if (found?.action.kind === 'menu') { this.#descend(found.action.menu, slot); return }
    if (found?.activation === 'arrive') {
      this.#end()
      this.#fire(found)
    }
  }

  #track(dx: number, dy: number): void {
    const level = this.#levels[this.#levels.length - 1]
    if (!level) return

    // Passing the held slot engages the hysteresis: the highlight only moves
    // once the pointer is properly inside the next hexagon, not the moment it
    // crosses the boundary.
    const previous = this.#current
    const direction = directionAt(dx, dy, previous)

    if (direction !== 'centre' && !this.#leftDeadZone) {
      this.#leftDeadZone = true
      this.#overlay.setCancelArmed(true)
    }

    this.#current = direction
    if (direction !== 'centre') this.#justFocused = false
    if (this.#painted) {
      this.#overlay.highlight(direction)
      this.#overlay.setCursor(dx, dy)
    }

    if (direction === previous || direction === 'centre') return

    // ROLLING ONTO A PATHWAY CHANGES THE MENU. No click, no reaching past the
    // ring's edge — arriving on the hexagon is the whole act, which is what
    // "each one is a pathway to the next honeycomb" has to mean if the six
    // are to be read as doorways rather than buttons.
    //
    // The new ring takes the same anchor (screen centre) and the drawn pointer
    // returns to the middle, so every ring is a fresh reach from the same
    // place. That is also what stops an ascend from instantly re-descending
    // back down the direction it just came from.
    if (level.back && direction === level.back) {
      this.#ascend()
      return
    }
    const slot = this.#slotFor(direction)
    if (slot?.action.kind === 'menu') {
      this.#descend(slot.action.menu, direction)
      return
    }
    if (slot?.activation === 'arrive') {
      this.#end()
      this.#fire(slot)
    }
  }

  #slotFor(direction: QuickMenuDirection): QuickMenuSlot | undefined {
    const level = this.#levels[this.#levels.length - 1]
    if (!level) return undefined
    if (direction === level.back) return undefined
    return slotsByDirection(level.definition).get(direction)
  }

  #descend(menu: string, via: QuickMenuDirection): void {
    const definition = get<QuickMenuRegistry>('@diamondcoreprocessor.com/QuickMenuRegistry')?.byName(menu)
    if (!definition) return
    const from = this.#levels[this.#levels.length - 1]?.focus
    const focus = { ...this.#virtual }
    this.#levels.push({ definition, back: OPPOSITE_DIRECTION[via], focus })
    this.#justFocused = true
    this.#resetLevel(from)
  }

  #ascend(): void {
    if (this.#levels.length <= 1) return
    const from = this.#levels[this.#levels.length - 1]?.focus
    this.#levels.pop()
    this.#justFocused = true
    this.#resetLevel(from)
  }

  /** A fresh ring starts un-travelled: the drawn pointer returns to the
   *  middle, centre commits, nothing is lit. */
  #resetLevel(from?: { x: number; y: number }): void {
    const level = this.#levels[this.#levels.length - 1]
    if (!level) return
    this.#current = 'centre'
    this.#leftDeadZone = false
    this.#virtual = { ...level.focus }
    if (this.#painted) this.#paint(from)
  }

  // ── commit ──────────────────────────────────────────────────────────

  #onPointerUp = (e: PointerEvent): void => {
    if (this.#flight?.active) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    if (this.#slotPress && (this.#slotPointer === null || e.pointerId === this.#slotPointer)) {
      const pressed = this.#slotPress
      this.#slotPress = null
      this.#slotPointer = null
      this.#noteButtons(e)
      const still = this.#layer?.slotAtClient(e.clientX, e.clientY, 'pick') ?? null
      if (still === pressed) {
        const slot = this.#layer?.slotFor(pressed)
        if (slot) fireQuickMenuSlot(slot, this.#hoverCell?.label)
      }
      this.#syncAltMenu()
      return
    }
    this.#noteButtons(e)
    this.#syncAltMenu()
    if (e.pointerType === 'touch') {
      this.#touches.delete(e.pointerId)
      // HELD A TILE, NEVER MOVED, LET GO — the tile's own screen. Nothing was
      // claimed on the way here, so nothing has to be given back.
      const pending = this.#pendingView
      if (pending && e.pointerId === pending.pointerId) {
        this.#pendingView = null
        if (!this.#touchDragging) {
          this.#openTileView(pending.label)
          return
        }
      }
      // Last finger up while armed on some OTHER pointer: the gesture has no
      // way left to end itself. Close it here rather than strand the lock.
      if (this.#touches.size === 0 && this.#armed && !this.#sticky
        && e.pointerId !== this.#pointerId) {
        this.#end()
        return
      }
    }
    if (this.#sticky) return
    if (!this.#armed) {
      if (e.pointerId === this.#pointerId) { this.#clearTimers(); this.#pointerId = null }
      return
    }
    if (e.pointerId !== this.#pointerId) return
    e.preventDefault()
    e.stopPropagation()
    this.#release()
  }

  /** A consumed gesture ended. Same bookkeeping as a real release — the finger
   *  is gone whether or not its pointerup survived the swallow. */
  #onGestureEnd = (e: CustomEvent<{ pointerId?: number }>): void => {
    const pointerId = e.detail?.pointerId
    if (typeof pointerId !== 'number') return
    this.#touches.delete(pointerId)
    // Some other gesture consumed this finger — its release is not ours to
    // read as "let go without moving".
    if (this.#pendingView?.pointerId === pointerId) this.#pendingView = null
    const dropped = this.#dropButton(pointerId, 0)
    if (pointerId === this.#pointerId) { this.#clearTimers(); this.#pointerId = null }
    if (this.#touches.size === 0 && this.#armed && !this.#sticky) {
      this.#end()
      return
    }
    if (dropped) this.#syncAltMenu()
  }

  #onPointerCancel = (e: PointerEvent): void => {
    const dropped = this.#dropButton(e.pointerId, e.buttons)
    if (this.#pendingView?.pointerId === e.pointerId) this.#pendingView = null
    if (e.pointerType === 'touch') {
      this.#touches.delete(e.pointerId)
      if (this.#touches.size === 0 && this.#armed && !this.#sticky) {
        this.#end()
        return
      }
    }
    if (e.pointerId !== this.#pointerId) {
      if (dropped) this.#syncAltMenu()
      return
    }
    this.#end()
  }

  /** A pointerup that never arrives must not leave the select menu hidden. */
  #dropButton(pointerId: number, buttons: number): boolean {
    let dropped = false
    if (this.#slotPointer === pointerId) {
      this.#slotPress = null
      this.#slotPointer = null
      dropped = true
    }
    if (this.#buttonPointer === pointerId) {
      this.#buttonPointer = null
      this.#pointerDown = buttons !== 0
      dropped = true
    }
    return dropped
  }

  #noteButtons(e: PointerEvent): void {
    this.#pointerDown = e.buttons !== 0
    if (!this.#pointerDown) this.#buttonPointer = null
  }

  #release(): void {
    const direction = this.#current

    // The pathway itself was the last act. Releasing during the ease means
    // "stay at this focus", not "activate the new ring's centre leaf".
    if (this.#justFocused) {
      this.#sticky = true
      if (!this.#painted) this.#paint()
      return
    }

    // Left and came back — the escape hatch. Nothing fires.
    if (this.#leftDeadZone && direction === 'centre') { this.#end(); return }

    // On a tile the six directions are the options. The centre is the tile,
    // so releasing there does not run the centre verb.
    if (direction === 'centre' && this.#anchor && !this.#tileLabel) { this.#end(); return }

    // HELD A TILE AND LET GO. The subject was decided by where the finger
    // landed, so the zero-travel slot is that tile's own screen rather than the
    // ring's generic centre verb. Anything else — flick to a neighbour — is the
    // ordinary ring, so nothing is taken away by this.
    if (direction === 'centre' && this.#tileLabel && this.#levels.length === 1) {
      const label = this.#tileLabel
      this.#end()
      this.#openTileView(label)
      return
    }

    const slot = this.#slotFor(direction)
    if (!slot) { this.#end(); return }

    // A pathway already swapped the ring the moment you rolled onto it, so
    // releasing on one can only mean "stay here" — keep the new ring up and
    // free the button.
    if (slot.action.kind === 'menu') {
      this.#sticky = true
      if (!this.#painted) this.#paint()
      return
    }

    this.#end()
    this.#fire(slot)
  }

  #fire(slot: QuickMenuSlot): void {
    // The ring is already down: #release calls #end before #fire, so the
    // surface underneath sees a command, effect, or key with the menu gone.
    fireQuickMenuSlot(slot)
  }

  // ── end ─────────────────────────────────────────────────────────────

  #onWheel = (e: WheelEvent): void => {
    if (!this.#flight?.active) return
    e.preventDefault()
    e.stopPropagation()
  }

  #onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === 'Alt') {
      // Firefox focuses its menu on the release of a bare Alt.
      if (this.#altDown && (this.#hoverCell || this.#flight?.active)) e.preventDefault()
      this.#altDown = false
      this.#altLatchedOff = false
      this.#syncAltMenu()
    }
  }

  #onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Alt') {
      // Over a tile the bare Alt is the menu's, never the browser's. Where the
      // pointer is says what Alt is for: the command line holds focus by
      // default, so a focus test would refuse it on a fresh page.
      if (this.#hoverCell || this.#flight?.active) e.preventDefault()
      if (!e.repeat) {
        this.#altDown = true
        this.#syncAltMenu()
      }
      return
    }
    if (this.#flight?.active) {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        this.#flight.confirm()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        this.#flight.end(false)
      }
      return
    }
    if (e.key !== 'Escape') return
    if (!this.#armed && !this.#sticky && !this.#altShown) return
    e.preventDefault()
    e.stopPropagation()
    this.#altLatchedOff = this.#altDown
    this.#end()
  }

  #onContextMenu = (e: MouseEvent): void => {
    if (!this.#armed && !this.#sticky) return
    // The phone's long-press fires while the finger that summoned the ring is
    // still down — that is the ring's own hold, not a cancel.
    if (isLongPressMenu(e)) return
    e.preventDefault()
    e.stopPropagation()
    this.#end()
  }

  #suppressMiddleMouse = (e: MouseEvent): void => {
    if (e.button === 1 && !this.#isChrome(e.target)) e.preventDefault()
  }

  #suppressAux = (e: MouseEvent): void => {
    if (e.button === 1 && !this.#isChrome(e.target)) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  /** Mobile mode per the single source of truth — the same one the overlay
   *  reads, so a touch laptop keeps the ring and a phone gets the screen. */
  #isMobile(): boolean {
    return get<{ active?: boolean }>('@diamondcoreprocessor.com/MobileMode')?.active === true
  }

  /** The tile's own screen, for the current location. One door, so the ring's
   *  zero-travel centre and the phone's plain hold open the same thing. */
  #openTileView(label: string): void {
    EffectBus.emit('tile:view-open', {
      label,
      segments: get<LineageLike>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [],
    })
  }

  #clearTimers(): void {
    if (this.#holdTimer) { clearTimeout(this.#holdTimer); this.#holdTimer = null }
  }

  #end(): void {
    this.#clearTimers()
    const gesture = this.#armed || this.#sticky
    this.#armed = false
    this.#sticky = false
    this.#painted = false
    this.#pointerId = null
    this.#touchDown = null
    this.#tileLabel = null
    this.#pendingView = null
    this.#levels = []
    this.#current = 'centre'
    this.#leftDeadZone = false
    this.#justFocused = false
    this.#anchor = null
    this.#overlay.clear()
    document.documentElement.classList.remove('hc-quick-menu-active')
    // Give the cursor back. The browser restores it to exactly where it was
    // when the lock was taken — the participant's pointer picks up where it
    // left off, having never visibly moved.
    if (document.pointerLockElement) {
      try { document.exitPointerLock?.() } catch { /* already gone */ }
    }
    if (gesture) this.#layer?.hide()
    if (this.#gateHeld) {
      this.#gateHeld = false
      get<StackLike>('@diamondcoreprocessor.com/InputModeStack')?.pop(OWNER)
      get<GateLike>('@diamondcoreprocessor.com/InputGate')?.unlock(OWNER)
    }
    this.#syncAltMenu()
  }

  // ── external summon ─────────────────────────────────────────────────

  /**
   * Open a ring without the gesture — `/menu`, or any surface that wants to
   * offer it. Opens sticky: roll to aim, click to fire, Escape to dismiss.
   * Like every summon it lands in the middle of the screen.
   */
  open(name?: string): boolean {
    const registry = get<QuickMenuRegistry>('@diamondcoreprocessor.com/QuickMenuRegistry')
    if (!registry) return false
    const definition = name ? registry.byName(name) : registry.forContext()
    if (!definition) return false

    this.#end()
    this.#altShown = false
    this.warmup()
    const focus = this.#centre()
    this.#levels = [{ definition, back: null, focus }]
    this.#sticky = true
    this.#current = 'centre'
    this.#leftDeadZone = false
    this.#justFocused = false
    this.#virtual = focus
    this.#anchor = this.#openAnchor(name)
    if (this.#anchor) {
      this.#paint()
      return true
    }
    get<GateLike>('@diamondcoreprocessor.com/InputGate')?.lock(OWNER)
    get<StackLike>('@diamondcoreprocessor.com/InputModeStack')?.push(this.#mode)
    this.#gateHeld = true
    this.#paint()
    this.#requestLock()
    return true
  }

  // ── tile layer ──────────────────────────────────────────────────────

  #tiles(): QuickMenuLayer {
    return this.#layer ??= new QuickMenuLayer()
  }

  /** A tile anchor is only for the hive, and only where a finger is not the
   *  pointer — a phone keeps the large ring. */
  #usableAnchor(anchor: { q: number; r: number } | null): { q: number; r: number } | null {
    if (!anchor || this.#isMobile()) return null
    const mode = get<{ mode?: string }>('@hypercomb.social/ViewMode')?.mode
    if (mode && mode !== 'hexagons') return null
    return anchor
  }

  /** Where `/menu` and the selection ring should sit. The selection menu
   *  prefers the tile the set is acting on; any other menu prefers the tile
   *  under the pointer. */
  #openAnchor(name: string | undefined): { q: number; r: number } | null {
    const overlay = get<OverlayLike>('@diamondcoreprocessor.com/TileOverlayDrone')
    if (name === SELECTION_MENU && this.#activeLabel) {
      const at = overlay?.axialForLabel?.(this.#activeLabel) ?? null
      const usable = this.#usableAnchor(at)
      if (usable) return usable
    }
    return this.#usableAnchor(this.#hoverCell ? { q: this.#hoverCell.q, r: this.#hoverCell.r } : null)
  }

  #syncAltMenu(): void {
    const want = selectionMenuWanted({
      alt: this.#altDown,
      overTile: !!this.#hoverCell,
      buttonDown: this.#pointerDown && !this.#slotPress,
      wand: this.#wand,
      clipboard: this.#clipboard,
      gesture: this.#armed || this.#sticky,
      onCtrlIcon: this.#onCtrlIcon,
      latchedOff: this.#altLatchedOff,
    })
    // Flying to the middle: the flower lives there until alt is let go. The
    // real pointer is put away, so hover is stale — only alt decides.
    if (this.#flight?.active) {
      if (!this.#altDown) this.#flight.end(true)
      this.#publishOnTile()
      return
    }
    if (want && this.#hoverCell && this.#flightWanted()) {
      if (!this.#altTimer) {
        this.#altTimer = setTimeout(() => { this.#altTimer = null; this.#startFlight() }, ALT_HOLD_MS)
      }
      return
    }
    if (this.#altTimer) { clearTimeout(this.#altTimer); this.#altTimer = null }
    if (!want || !this.#hoverCell) {
      if (this.#altShown) {
        this.#altShown = false
        if (!(this.#anchor && (this.#armed || this.#sticky))) this.#layer?.hide()
      }
      this.#publishOnTile()
      return
    }
    const registry = get<QuickMenuRegistry>('@diamondcoreprocessor.com/QuickMenuRegistry')
    const definition = registry?.byName(SELECTION_MENU)
    if (!registry || !definition) return
    this.#altShown = true
    const layer = this.#tiles()
    layer.place(this.#hoverCell.q, this.#hoverCell.r)
    layer.show(definition, registry.label, null, '')
    this.#publishOnTile()
  }

  /** A held alt flies the tile to the middle wherever the hive is a desktop
   *  hex view with a camera to move; anywhere else the menu stays in place. */
  #flightWanted(): boolean {
    if (this.#isMobile()) return false
    const mode = get<{ mode?: string }>('@hypercomb.social/ViewMode')?.mode
    if (mode && mode !== 'hexagons') return false
    return this.#flightFor().available
  }

  #flightFor(): QuickMenuFlight {
    if (!this.#flight) {
      this.#flight = new QuickMenuFlight(this.#tiles())
      this.#flight.onEnd = () => {
        // Alt is still down after an arrival fired or Escape: a second flight
        // must wait for a fresh press.
        if (this.#altDown) this.#altLatchedOff = true
        this.#syncAltMenu()
      }
    }
    return this.#flight
  }

  #startFlight(): void {
    const cell = this.#hoverCell
    const registry = get<QuickMenuRegistry>('@diamondcoreprocessor.com/QuickMenuRegistry')
    const definition = registry?.byName(SELECTION_MENU)
    if (!cell || !definition || !this.#altDown || this.#pointerDown) return
    if (this.#armed || this.#sticky) return
    this.#flightFor().begin({ q: cell.q, r: cell.r }, definition, cell.label)
    this.#publishOnTile()
  }

  #publishOnTile(): void {
    const active = this.#altShown || (!!this.#anchor && this.#painted) || !!this.#flight?.active
    if (active === this.#onTile) return
    this.#onTile = active
    EffectBus.emit('quick-menu:on-tile', { active })
  }

  /** Dismiss whatever is open. */
  close(): void {
    this.#end()
  }
}

// quickmenu/quickmenu.queen.ts registers this (atomic-modules-plan.md): a dependency registers nothing.
