// diamondcoreprocessor.com/quickmenu/quick-menu.input.ts
//
// The gesture. Summon, roll through focus, activate.
//
// ── The shape of it ───────────────────────────────────────────────────
//
//   summon   middle-mouse press, or a long-press on touch
//   aim      the pointer is HIDDEN; rolling over a neighbour focuses it
//   descend  a pathway eases into becoming the next ring's centre
//   activate a leaf either fires on arrival or waits for release/click,
//            as declared by the behaviour that owns it
//   cancel   come back to the centre and release; the centre relabels
//            itself the moment you leave, so the way out is visible
//
// ── Two speeds, one motion ────────────────────────────────────────────
//
// Direction tracking starts on POINTERDOWN, but the ring is not painted
// until BLOOM_MS has passed. Flick faster than that and the menu never
// draws — yet the same press-direction-release still fires the same slot.
// The novice reads the ring; the expert has the ring's geometry in their
// hand and never sees it. Neither learns a different gesture, which is the
// property that makes this worth building instead of another palette.
//
// ── Never awaits anything ─────────────────────────────────────────────
//
// Every menu is resolved from the in-memory registry and drawn from a
// prebuilt subtree. There is no OPFS read, no fetch, and no await between
// pointerdown and paint. A gesture tool that can stall is not a gesture
// tool.
//
// ── Why it takes the input stack AND the gate ─────────────────────────
//
// InputModeStack suspends whatever mode is on top (the migrated systems);
// InputGate locks the ones that haven't migrated yet. Holding both is the
// only way to guarantee that a flick across the canvas doesn't also pan it.

import { EffectBus, POINTER_GESTURE_END, isPointerConsumed } from '@hypercomb/core'
import type { InputMode } from '../navigation/input-mode-stack.service.js'
import { QuickMenuOverlay } from './quick-menu.overlay.js'
import type { QuickMenuRegistry } from './quick-menu-registry.service.js'
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

/** How long a press waits before the ring is drawn. Below this, the gesture
 *  still works — it is simply invisible. */
const BLOOM_MS = 130

/** Touch summon: the press must be held this long before the menu claims
 *  the finger, so a swipe is still a pan. */
const HOLD_MS = 380

/** Touch drift that cancels an un-armed long-press. */
const JITTER_PX = 12

const OWNER = 'quick-menu'

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

type SlashLike = { execute(name: string, args: string): unknown }
type OverlayLike = { labelAtClient(x: number, y: number): string | null }
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

export class QuickMenuInput {
  #overlay = new QuickMenuOverlay()
  #cursorStyle: HTMLStyleElement | null = null

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

  #bloomTimer: ReturnType<typeof setTimeout> | null = null
  #holdTimer: ReturnType<typeof setTimeout> | null = null
  #warmed = false

  /** Key currently holding the ring open, when summoned from the keyboard. */
  #heldKey: string | null = null
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

    // The keyboard trigger. KeymapService owns the keydown — it already knows
    // about focus suppression and user overrides — and hands us the raw event
    // so we can watch for the matching keyup and finish the gesture.
    EffectBus.on<{ active?: boolean }>('touch:dragging', payload => {
      this.#touchDragging = !!payload?.active
    })

    EffectBus.on<{ cmd?: string; event?: KeyboardEvent }>('keymap:invoke', payload => {
      if (payload?.cmd !== 'ui.quickMenu') return
      this.#summonFromKey(payload.event)
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
        return
      }

      this.#clearTimers()
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
        // Take the still-armed drag's reservation, so a finger that moves from
        // here aims the ring instead of also picking the tile up.
        if (owner === TOUCH_MOVE_SOURCE) gate?.release?.(TOUCH_MOVE_SOURCE)
        try { navigator.vibrate?.(30) } catch { /* no haptics, no matter */ }
        // Resolve the tile from the press COORDINATES. A finger produces no
        // hover, so there is no remembered tile to read — only where it landed.
        const overlay = at
          ? get<OverlayLike>('@diamondcoreprocessor.com/TileOverlayDrone')?.labelAtClient(at.x, at.y) ?? null
          : null
        this.#begin(e.pointerId)
        this.#tileLabel = overlay
        this.#paint()
      }, HOLD_MS)
      return
    }

    // Middle mouse — unambiguous, and free of any existing binding.
    if (e.button !== 1) return
    if (this.#isChrome(e.target)) return
    e.preventDefault()
    e.stopPropagation()
    this.#begin(e.pointerId)
    this.#bloomTimer = setTimeout(() => {
      this.#bloomTimer = null
      this.#paint()
    }, BLOOM_MS)
  }

  /** The ring's anchor: always the middle of the screen. */
  #centre(): { x: number; y: number } {
    return { x: window.innerWidth / 2, y: window.innerHeight / 2 }
  }

  /** Claim the pointer and start tracking direction — with or without paint. */
  #begin(pointerId: number): void {
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

    get<GateLike>('@diamondcoreprocessor.com/InputGate')?.lock(OWNER)
    get<StackLike>('@diamondcoreprocessor.com/InputModeStack')?.push(this.#mode)
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
    this.#overlay.paint(level.definition, centre, level.back, registry.label, backLabel, fromFocus)
    // Only the ROOT ring carries the tile: descend and the centre is that
    // ring's own zero-travel verb again.
    this.#overlay.setCentreOverride(this.#levels.length === 1 ? this.#tileLabel : null)
    this.#overlay.highlight(this.#current)
    this.#overlay.setCancelArmed(this.#leftDeadZone)
    this.#overlay.setCursor(this.#virtual.x - centre.x, this.#virtual.y - centre.y)
    document.documentElement.classList.add('hc-quick-menu-active')
    this.#painted = true
  }

  // ── aim ─────────────────────────────────────────────────────────────

  #onPointerMove = (e: PointerEvent): void => {
    if (this.#sticky) {
      this.#advance(e)
      return
    }
    if (!this.#armed) {
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
    // A key-summoned ring has no pointer of its own (#pointerId stays null),
    // so it aims with whatever pointer is moving.
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
    if (e.pointerType === 'touch') {
      this.#touches.delete(e.pointerId)
      // Last finger up while armed on some OTHER pointer: the gesture has no
      // way left to end itself. Close it here rather than strand the lock.
      if (this.#touches.size === 0 && this.#armed && !this.#sticky && !this.#heldKey
        && e.pointerId !== this.#pointerId) {
        this.#end()
        return
      }
    }
    if (this.#sticky) return
    // A key is holding this open — lifting a mouse button is not the release.
    if (this.#heldKey) return
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
    if (pointerId === this.#pointerId) { this.#clearTimers(); this.#pointerId = null }
    if (this.#touches.size === 0 && this.#armed && !this.#sticky && !this.#heldKey) this.#end()
  }

  #onPointerCancel = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      this.#touches.delete(e.pointerId)
      if (this.#touches.size === 0 && this.#armed && !this.#sticky && !this.#heldKey) {
        this.#end()
        return
      }
    }
    if (e.pointerId !== this.#pointerId) return
    this.#end()
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

    // HELD A TILE AND LET GO. The subject was decided by where the finger
    // landed, so the zero-travel slot is that tile's own screen rather than the
    // ring's generic centre verb. Anything else — flick to a neighbour — is the
    // ordinary ring, so nothing is taken away by this.
    if (direction === 'centre' && this.#tileLabel && this.#levels.length === 1) {
      const label = this.#tileLabel
      this.#end()
      EffectBus.emit('tile:view-open', {
        label,
        segments: get<LineageLike>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [],
      })
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
    const action = slot.action
    if (action.kind === 'command') {
      const slash = get<SlashLike>('@diamondcoreprocessor.com/SlashBehaviourDrone')
      try {
        void Promise.resolve(slash?.execute(action.command, action.args ?? '')).catch(err =>
          console.warn('[quick-menu] behaviour failed', action.command, err),
        )
      } catch (err) {
        console.warn('[quick-menu] behaviour threw', action.command, err)
      }
      return
    }
    if (action.kind === 'effect') {
      EffectBus.emit(action.effect, action.payload ?? {})
      return
    }
    if (action.kind === 'key') {
      // Fired AFTER #end(), so the ring is down and the mode stack released
      // before the surface underneath sees the key.
      for (const type of ['keydown', 'keyup'] as const) {
        window.dispatchEvent(new KeyboardEvent(type, { key: action.key, bubbles: true, cancelable: true }))
      }
    }
  }

  // ── end ─────────────────────────────────────────────────────────────

  /**
   * Summon from the keyboard. Same as every other summon: the ring appears in
   * the middle of the screen and the gesture is the one the mouse makes — aim
   * by moving, release the key to choose.
   *
   * One deliberate difference from the mouse trigger. Middle-press and
   * release without moving fires the centre, because that is an unambiguous
   * click. A key TAP is not — the pointer never moved, and someone pressing a
   * key to see what it does should get a menu, not a command. So a tap leaves
   * the ring up sticky, and only a hold-then-flick commits.
   */
  #summonFromKey(event?: KeyboardEvent): void {
    if (this.#armed || this.#sticky) return
    const key = event?.key
    if (!key || event?.repeat) return

    this.#begin(-1)
    this.#pointerId = null
    this.#heldKey = key
    this.#bloomTimer = setTimeout(() => {
      this.#bloomTimer = null
      this.#paint()
    }, BLOOM_MS)
  }

  #onKeyUp = (e: KeyboardEvent): void => {
    if (!this.#heldKey || e.key !== this.#heldKey) return
    this.#heldKey = null
    if (!this.#armed) return

    // Never left the centre — this was a tap. Show the ring and let go of it.
    if (!this.#leftDeadZone) {
      this.#clearTimers()
      this.#sticky = true
      if (!this.#painted) this.#paint()
      return
    }
    this.#release()
  }

  #onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return
    if (!this.#armed && !this.#sticky) return
    e.preventDefault()
    e.stopPropagation()
    this.#end()
  }

  #onContextMenu = (e: MouseEvent): void => {
    if (!this.#armed && !this.#sticky) return
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

  #clearTimers(): void {
    if (this.#bloomTimer) { clearTimeout(this.#bloomTimer); this.#bloomTimer = null }
    if (this.#holdTimer) { clearTimeout(this.#holdTimer); this.#holdTimer = null }
  }

  #end(): void {
    this.#clearTimers()
    const wasClaimed = this.#armed || this.#sticky
    this.#armed = false
    this.#sticky = false
    this.#painted = false
    this.#pointerId = null
    this.#heldKey = null
    this.#touchDown = null
    this.#tileLabel = null
    this.#levels = []
    this.#current = 'centre'
    this.#leftDeadZone = false
    this.#justFocused = false
    this.#overlay.clear()
    document.documentElement.classList.remove('hc-quick-menu-active')
    // Give the cursor back. The browser restores it to exactly where it was
    // when the lock was taken — the participant's pointer picks up where it
    // left off, having never visibly moved.
    if (document.pointerLockElement) {
      try { document.exitPointerLock?.() } catch { /* already gone */ }
    }
    if (!wasClaimed) return
    get<StackLike>('@diamondcoreprocessor.com/InputModeStack')?.pop(OWNER)
    get<GateLike>('@diamondcoreprocessor.com/InputGate')?.unlock(OWNER)
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
    this.warmup()
    const focus = this.#centre()
    this.#levels = [{ definition, back: null, focus }]
    this.#sticky = true
    this.#current = 'centre'
    this.#leftDeadZone = false
    this.#justFocused = false
    this.#virtual = focus
    get<GateLike>('@diamondcoreprocessor.com/InputGate')?.lock(OWNER)
    get<StackLike>('@diamondcoreprocessor.com/InputModeStack')?.push(this.#mode)
    this.#paint()
    this.#requestLock()
    return true
  }

  /** Dismiss whatever is open. */
  close(): void {
    this.#end()
  }
}

const _quickMenuInput = new QuickMenuInput()
window.ioc.register('@diamondcoreprocessor.com/QuickMenuInput', _quickMenuInput)
