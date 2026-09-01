// input/move/touch-move.input.ts
import { Point } from 'pixi.js'
import { EffectBus, POINTER_GESTURE_END } from '@hypercomb/core'
import type { Axial } from '../navigation/hex-detector.js'
import type { MoveDroneApi } from './move.drone.js'
import type { InputGate } from '../navigation/input-gate.service.js'

type MoveRefs = {
  canvas: HTMLCanvasElement
  container: any
  renderer: any
  getMeshOffset: () => { x: number; y: number }
}

export class TouchMoveInput {
  #enabled = false
  #canvas: HTMLCanvasElement | null = null
  #container: any = null
  #renderer: any = null
  #getMeshOffset: (() => { x: number; y: number }) | null = null

  #drone: MoveDroneApi | null = null
  #gate: InputGate | null = null

  readonly #source = 'touch-move'
  readonly #holdMs = 300
  readonly #jitterPx = 10

  #holdTimer: ReturnType<typeof setTimeout> | null = null
  #downPos: { x: number; y: number } | null = null
  #downAxial: Axial | null = null
  #activePointerId: number | null = null
  /**
   * The hold has matured, but the finger has not travelled yet — so this
   * gesture is not yet a move, and might never become one.
   *
   * TRAVEL DECIDES. A still finger at this point belongs to the tile's own
   * long-press (which opens its actions), and only movement makes it a drag.
   * Committing the move the instant the timer fired is what made the two
   * mutually exclusive: `beginMove` raises `touch:dragging`, and the tile's
   * hold refuses to fire while a drag is live — so on any own tile the
   * long-press could never open anything. One hold, and what the hand does
   * next picks which gesture it was.
   */
  #armed = false
  /** Fingers currently down, by id. A COUNT was the bug: tapping a branch tile
   *  navigates on the press and consumes the pointer, so its pointerup dies at
   *  window capture and the decrement never runs. The count stayed at 1, every
   *  later touch read as "second finger → pinch", and drag-to-move was dead
   *  for the rest of the session. Ids can be reconciled; a counter cannot. */
  #pointers = new Set<number>()
  #dragging = false

  attach = (drone: MoveDroneApi, refs: MoveRefs): void => {
    if (this.#enabled) return

    this.#drone = drone
    this.#gate = window.ioc.get<InputGate>('@diamondcoreprocessor.com/InputGate') ?? null
    this.#canvas = refs.canvas
    this.#container = refs.container
    this.#renderer = refs.renderer
    this.#getMeshOffset = refs.getMeshOffset

    window.addEventListener('pointerdown', this.#onPointerDown, { passive: false })
    window.addEventListener('pointermove', this.#onPointerMove, { passive: false })
    window.addEventListener('pointerup', this.#onPointerUp, { passive: false })
    window.addEventListener('pointercancel', this.#onPointerUp, { passive: false })
    window.addEventListener(POINTER_GESTURE_END, this.#onGestureEnd as EventListener)

    this.#enabled = true
  }

  detach = (): void => {
    if (!this.#enabled) return

    window.removeEventListener('pointerdown', this.#onPointerDown)
    window.removeEventListener('pointermove', this.#onPointerMove)
    window.removeEventListener('pointerup', this.#onPointerUp)
    window.removeEventListener('pointercancel', this.#onPointerUp)
    window.removeEventListener(POINTER_GESTURE_END, this.#onGestureEnd as EventListener)

    this.#pointers.clear()
    this.#cancel()

    this.#drone = null
    this.#gate = null
    this.#canvas = null
    this.#container = null
    this.#renderer = null
    this.#getMeshOffset = null
    this.#enabled = false
  }

  // ── pointer events ────────────────────────────────────────

  #onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return
    if (!this.#canvas) return

    // A primary touch starts a fresh sequence — anything still tracked lost
    // its release and must not be counted as a live finger.
    if (e.isPrimary) this.#pointers.clear()
    this.#pointers.add(e.pointerId)

    // second finger → cancel any pending move (pinch-zoom takes over)
    if (this.#pointers.size > 1) {
      this.#cancel()
      return
    }

    const rect = this.#canvas.getBoundingClientRect()
    if (!this.#isInsideRect(e.clientX, e.clientY, rect)) return

    const axial = this.#clientToAxial(e.clientX, e.clientY)
    if (!axial) return

    this.#activePointerId = e.pointerId
    this.#downPos = { x: e.clientX, y: e.clientY }
    this.#downAxial = axial

    // start long-press timer — this ARMS the move; the first travel commits it
    this.#holdTimer = setTimeout(() => {
      this.#holdTimer = null
      if (!this.#downAxial || !this.#drone) return

      // Reserve a matured tile hold before the pan coordinator can claim its
      // first post-hold movement. A still hold releases this on pointerup.
      if (this.#gate && !this.#gate.claim(this.#source)) {
        this.#resetDrag()
        return
      }

      this.#armed = true
    }, this.#holdMs)
  }

  /** The armed hold has travelled — THIS is the move. Everything the timer
   *  used to do (gate re-check, beginMove, haptic) happens here instead, at
   *  the moment the gesture actually declares itself. */
  #startDrag(e: PointerEvent): boolean {
    if (this.#gate && this.#gate.owner !== this.#source) { this.#resetDrag(); return false }
    if (!this.#downAxial || !this.#drone) { this.#resetDrag(); return false }
    if (!this.#drone.beginMove(this.#downAxial, this.#source)) { this.#resetDrag(); return false }

    this.#armed = false
    this.#dragging = true
    EffectBus.emit('touch:dragging', { active: true })

    // haptic feedback — on the pick-up, which is now the first travel
    try { navigator.vibrate?.(50) } catch { /* ignore */ }

    e.preventDefault()
    e.stopPropagation()
    return true
  }

  #onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return
    if (e.pointerId !== this.#activePointerId) return

    // if hold timer still pending, check jitter threshold
    if (this.#holdTimer && this.#downPos) {
      const dx = e.clientX - this.#downPos.x
      const dy = e.clientY - this.#downPos.y
      if (Math.abs(dx) > this.#jitterPx || Math.abs(dy) > this.#jitterPx) {
        // too much movement — it's a pan, cancel hold
        this.#clearTimer()
        this.#resetDrag()
        return
      }
    }

    // Held long enough and now travelling: the gesture has declared itself a
    // move. A finger that never gets here stayed still, and the tile's own
    // long-press takes it instead — that hold consumes the pointer, which
    // reaches us as POINTER_GESTURE_END and disarms this.
    if (this.#armed && !this.#dragging && this.#downPos) {
      const dx = e.clientX - this.#downPos.x
      const dy = e.clientY - this.#downPos.y
      if (Math.abs(dx) <= this.#jitterPx && Math.abs(dy) <= this.#jitterPx) return
      if (!this.#startDrag(e)) return
    }

    if (!this.#dragging || !this.#drone) return

    const axial = this.#clientToAxial(e.clientX, e.clientY)
    if (axial) this.#drone.updateMove(axial, this.#source)

    e.preventDefault()
    e.stopPropagation()
  }

  #onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return
    this.#pointers.delete(e.pointerId)

    if (e.pointerId !== this.#activePointerId) return

    this.#clearTimer()

    if (this.#dragging && this.#drone) {
      const axial = this.#clientToAxial(e.clientX, e.clientY)
      if (axial) {
        void this.#drone.commitMoveAt(axial, this.#source)
      } else {
        this.#drone.cancelMove(this.#source)
      }
    }

    this.#resetDrag()
  }

  /** A consumed gesture ended — its pointerup was swallowed before it reached
   *  us, so release the finger here or it stays "down" forever. */
  #onGestureEnd = (e: CustomEvent<{ pointerId?: number }>): void => {
    const pointerId = e.detail?.pointerId
    if (typeof pointerId !== 'number') return
    if (!this.#pointers.delete(pointerId)) return
    if (pointerId === this.#activePointerId) this.#cancel()
  }

  // ── helpers ───────────────────────────────────────────────

  #cancel(): void {
    this.#clearTimer()
    if (this.#dragging) this.#drone?.cancelMove(this.#source)
    this.#resetDrag()
  }

  #clearTimer(): void {
    if (this.#holdTimer) {
      clearTimeout(this.#holdTimer)
      this.#holdTimer = null
    }
  }

  #resetDrag(): void {
    if (this.#dragging) EffectBus.emit('touch:dragging', { active: false })
    this.#gate?.release(this.#source)
    this.#downPos = null
    this.#downAxial = null
    this.#activePointerId = null
    this.#dragging = false
    this.#armed = false
  }

  #clientToAxial(cx: number, cy: number): Axial | null {
    if (!this.#container || !this.#renderer || !this.#getMeshOffset) return null

    const detector = window.ioc.get<{ pixelToAxial(px: number, py: number): Axial }>(
      '@diamondcoreprocessor.com/HexDetector'
    )
    if (!detector) return null

    const pixiGlobal = this.#clientToPixiGlobal(cx, cy)
    const local = this.#container.toLocal(new Point(pixiGlobal.x, pixiGlobal.y))
    const offset = this.#getMeshOffset()
    return detector.pixelToAxial(local.x - offset.x, local.y - offset.y)
  }

  #clientToPixiGlobal(cx: number, cy: number) {
    const events = this.#renderer?.events
    if (events?.mapPositionToPoint) {
      const out = new Point()
      events.mapPositionToPoint(out, cx, cy)
      return { x: out.x, y: out.y }
    }
    const rect = this.#canvas!.getBoundingClientRect()
    const screen = this.#renderer!.screen
    return {
      x: (cx - rect.left) * (screen.width / rect.width),
      y: (cy - rect.top) * (screen.height / rect.height),
    }
  }

  #isInsideRect(x: number, y: number, rect: DOMRect): boolean {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  }
}

window.ioc.register('@diamondcoreprocessor.com/TouchMoveInput', new TouchMoveInput())
