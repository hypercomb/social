// diamondcoreprocessor.com/quickmenu/quick-menu.input.ts
//
// The gesture. Hold, flick, release.
//
// ── The shape of it ───────────────────────────────────────────────────
//
//   summon   middle-mouse press, or a long-press on touch
//   aim      the pointer is HIDDEN; travel direction picks one of six
//   descend  crossing the far edge on a slot that opens another ring
//            re-blooms that ring under your hand, mid-gesture
//   commit   release fires the lit slot
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

import { EffectBus } from '@hypercomb/core'
import type { InputMode } from '../navigation/input-mode-stack.service.js'
import { QuickMenuOverlay } from './quick-menu.overlay.js'
import type { QuickMenuRegistry } from './quick-menu-registry.service.js'
import {
  DEAD_ZONE,
  DESCEND_DISTANCE,
  OPPOSITE_DIRECTION,
  directionAt,
  slotOffset,
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

type SlashLike = { execute(name: string, args: string): unknown }
type GateLike = { lock(owner: string): void; unlock(owner: string): void }
type StackLike = { push(mode: InputMode): void; pop(name: string): void }

type Level = {
  readonly definition: QuickMenuDefinition
  /** Screen point this ring is centred on. Re-anchored on every descend and
   *  ascend so the ring always blooms under the hand. */
  origin: { x: number; y: number }
  /** Direction that returns to the parent ring; null on the root ring. */
  readonly back: QuickMenuDirection | null
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

  #bloomTimer: ReturnType<typeof setTimeout> | null = null
  #holdTimer: ReturnType<typeof setTimeout> | null = null
  #warmed = false

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
    window.addEventListener('keydown', this.#onKeyDown, { capture: true })
    // Chrome opens autoscroll on a middle mousedown; only preventDefault on
    // the mouse event itself reliably suppresses it.
    window.addEventListener('mousedown', this.#suppressMiddleMouse, { capture: true })
    window.addEventListener('auxclick', this.#suppressAux, { capture: true })
    window.addEventListener('contextmenu', this.#onContextMenu, { capture: true })

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
      if (this.#isChrome(e.target)) return
      this.#pointerId = e.pointerId
      const origin = { x: e.clientX, y: e.clientY }
      this.#holdTimer = setTimeout(() => {
        this.#holdTimer = null
        try { navigator.vibrate?.(30) } catch { /* no haptics, no matter */ }
        this.#begin(origin, e.pointerId)
        this.#paint()
      }, HOLD_MS)
      return
    }

    // Middle mouse — unambiguous, and free of any existing binding.
    if (e.button !== 1) return
    if (this.#isChrome(e.target)) return
    e.preventDefault()
    e.stopPropagation()
    this.#begin({ x: e.clientX, y: e.clientY }, e.pointerId)
    this.#bloomTimer = setTimeout(() => {
      this.#bloomTimer = null
      this.#paint()
    }, BLOOM_MS)
  }

  /** Claim the pointer and start tracking direction — with or without paint. */
  #begin(origin: { x: number; y: number }, pointerId: number): void {
    const registry = get<QuickMenuRegistry>('@diamondcoreprocessor.com/QuickMenuRegistry')
    if (!registry) return
    this.warmup()

    this.#levels = [{ definition: registry.forContext(), origin, back: null }]
    this.#pointerId = pointerId
    this.#armed = true
    this.#current = 'centre'
    this.#leftDeadZone = false

    get<GateLike>('@diamondcoreprocessor.com/InputGate')?.lock(OWNER)
    get<StackLike>('@diamondcoreprocessor.com/InputModeStack')?.push(this.#mode)
  }

  #paint(): void {
    const level = this.#levels[this.#levels.length - 1]
    if (!level) return
    const registry = get<QuickMenuRegistry>('@diamondcoreprocessor.com/QuickMenuRegistry')
    if (!registry) return

    const backLabel = registry.label({ label: 'back', labelKey: 'quickmenu.back' })
    this.#overlay.paint(level.definition, level.origin, level.back, registry.label, backLabel)
    this.#overlay.highlight(this.#current)
    this.#overlay.setCancelArmed(this.#leftDeadZone)
    document.documentElement.classList.add('hc-quick-menu-active')
    this.#painted = true
  }

  // ── aim ─────────────────────────────────────────────────────────────

  #onPointerMove = (e: PointerEvent): void => {
    if (this.#sticky) {
      this.#track(e.clientX, e.clientY)
      return
    }
    if (!this.#armed) {
      // Un-armed touch press: drift past the jitter box means the finger was
      // panning, not summoning.
      if (this.#holdTimer && e.pointerId === this.#pointerId) {
        const level = this.#levels[0]
        const origin = level?.origin
        if (origin && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > JITTER_PX) {
          this.#clearTimers()
          this.#pointerId = null
        }
      }
      return
    }
    if (e.pointerId !== this.#pointerId) return
    e.preventDefault()
    this.#track(e.clientX, e.clientY)
  }

  #track(x: number, y: number): void {
    const level = this.#levels[this.#levels.length - 1]
    if (!level) return

    const dx = x - level.origin.x
    const dy = y - level.origin.y
    const distance = Math.hypot(dx, dy)
    const direction = directionAt(dx, dy)

    if (direction !== 'centre' && !this.#leftDeadZone) {
      this.#leftDeadZone = true
      this.#overlay.setCancelArmed(true)
    }

    this.#current = direction
    if (this.#painted) {
      this.#overlay.highlight(direction)
      this.#overlay.setTrail(dx, dy)
    }

    if (distance < DESCEND_DISTANCE || direction === 'centre') return

    // Past the far edge. Either this slot opens a ring, or this is the way
    // back out of one. Both re-anchor to the hand so the next reading of
    // direction starts from zero — which is also what stops an ascend from
    // immediately re-descending down the way it came.
    if (level.back && direction === level.back) {
      this.#ascend({ x, y })
      return
    }
    const slot = this.#slotFor(direction)
    if (slot?.action.kind === 'menu') this.#descend(slot.action.menu, direction, { x, y })
  }

  #slotFor(direction: QuickMenuDirection): QuickMenuSlot | undefined {
    const level = this.#levels[this.#levels.length - 1]
    if (!level) return undefined
    if (direction === level.back) return undefined
    return slotsByDirection(level.definition).get(direction)
  }

  #descend(menu: string, via: QuickMenuDirection, origin: { x: number; y: number }): void {
    const definition = get<QuickMenuRegistry>('@diamondcoreprocessor.com/QuickMenuRegistry')?.byName(menu)
    if (!definition) return
    this.#levels.push({ definition, origin, back: OPPOSITE_DIRECTION[via] })
    this.#resetLevel()
  }

  #ascend(origin: { x: number; y: number }): void {
    if (this.#levels.length <= 1) return
    this.#levels.pop()
    const level = this.#levels[this.#levels.length - 1]
    level.origin = origin
    this.#resetLevel()
  }

  /** A fresh ring starts un-travelled: centre commits, nothing is lit. */
  #resetLevel(): void {
    this.#current = 'centre'
    this.#leftDeadZone = false
    if (this.#painted) this.#paint()
  }

  // ── commit ──────────────────────────────────────────────────────────

  #onPointerUp = (e: PointerEvent): void => {
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

  #onPointerCancel = (e: PointerEvent): void => {
    if (e.pointerId !== this.#pointerId) return
    this.#end()
  }

  #release(): void {
    const level = this.#levels[this.#levels.length - 1]
    const direction = this.#current

    // Left and came back — the escape hatch. Nothing fires.
    if (this.#leftDeadZone && direction === 'centre') { this.#end(); return }

    const slot = this.#slotFor(direction)
    if (!slot) { this.#end(); return }

    // A ring released on a ring: keep it up and free the pointer, so the
    // gesture can be finished with a look rather than a held button. The
    // child blooms on the hexagon that opened it, so the ring visibly grows
    // out of the slot you chose.
    if (slot.action.kind === 'menu' && level) {
      const offset = slotOffset(direction)
      this.#descend(slot.action.menu, direction, {
        x: level.origin.x + offset.x,
        y: level.origin.y + offset.y,
      })
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
    this.#levels = []
    this.#current = 'centre'
    this.#leftDeadZone = false
    this.#overlay.clear()
    document.documentElement.classList.remove('hc-quick-menu-active')
    if (!wasClaimed) return
    get<StackLike>('@diamondcoreprocessor.com/InputModeStack')?.pop(OWNER)
    get<GateLike>('@diamondcoreprocessor.com/InputGate')?.unlock(OWNER)
  }

  // ── external summon ─────────────────────────────────────────────────

  /**
   * Open a ring without the gesture — `/menu`, or any surface that wants to
   * offer it. Opens sticky: aim with a free pointer, click to fire, Escape
   * to dismiss.
   */
  open(name?: string, at?: { x: number; y: number }): boolean {
    const registry = get<QuickMenuRegistry>('@diamondcoreprocessor.com/QuickMenuRegistry')
    if (!registry) return false
    const definition = name ? registry.byName(name) : registry.forContext()
    if (!definition) return false

    this.#end()
    this.warmup()
    const origin = at ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    this.#levels = [{ definition, origin, back: null }]
    this.#sticky = true
    this.#current = 'centre'
    this.#leftDeadZone = false
    get<GateLike>('@diamondcoreprocessor.com/InputGate')?.lock(OWNER)
    get<StackLike>('@diamondcoreprocessor.com/InputModeStack')?.push(this.#mode)
    this.#paint()
    return true
  }

  /** Dismiss whatever is open. */
  close(): void {
    this.#end()
  }
}

const _quickMenuInput = new QuickMenuInput()
window.ioc.register('@diamondcoreprocessor.com/QuickMenuInput', _quickMenuInput)
