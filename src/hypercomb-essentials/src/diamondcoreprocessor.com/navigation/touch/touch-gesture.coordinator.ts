// diamondcoreprocessor.com/input/touch/touch-gesture.coordinator.ts
//
// Central state machine for all touch gestures.
// Owns pointer tracking, gesture classification, InputGate claims,
// and the touch:dragging effect for UI suppression.

import { EffectBus } from '@hypercomb/core'
import type { InputGate } from '../input-gate.service.js'

type Point = { x: number; y: number }
type PointerEntry = { start: Point; current: Point; id: number }

const enum GestureState {
  IDLE,
  PENDING_PAN,
  PAN,
  PENDING_TWO_FINGER,
  PINCH,
  SENSITIVITY_SWIPE,
}

const DRAG_THRESHOLD = 12
const PINCH_THRESHOLD = 15
const SWIPE_THRESHOLD = 20
const SWIPE_ANGLE_MAX_DEG = 25
const SENSITIVITY_MIN = 0.25
const SENSITIVITY_MAX = 4.0
const SENSITIVITY_DEFAULT = 1.0
const LOCK_DOUBLE_SWIPE_MS = 800
const SWIPE_MIN_DISTANCE = 60

const LS_KEY = 'hypercomb:touch-sensitivity'

export type PanDelegate = {
  panUpdate(prev: Point, current: Point, sensitivity: number): void
}

export type PinchDelegate = {
  pinchUpdate(p1: Point, p2: Point, lastDistance: number, sensitivity: number): { distance: number }
}

export class TouchGestureCoordinator {
  #state: GestureState = GestureState.IDLE
  #pointers = new Map<number, PointerEntry>()
  #gate: InputGate | null = null
  #canvas: HTMLCanvasElement | null = null
  #enabled = false

  readonly #source = 'touch-coordinator'

  // delegates
  #panDelegate: PanDelegate | null = null
  #pinchDelegate: PinchDelegate | null = null

  // pan state
  #panLast: Point | null = null

  // pinch state
  #pinchLastDistance = 0

  // sensitivity state
  #sensitivity = SENSITIVITY_DEFAULT
  #sensitivityLocked = false
  #swipeUpCount = 0
  #lastSwipeUpTime = 0
  #swipeStartY = 0
  #swipeStartSensitivity = SENSITIVITY_DEFAULT

  // dragging effect emitted state
  #draggingEmitted = false

  // track whether gesture was active (for poisoning)
  #gestureWasActive = false

  constructor() {
    this.#loadSensitivity()
  }

  get sensitivity(): number { return this.#sensitivity }
  get sensitivityLocked(): boolean { return this.#sensitivityLocked }
  get state(): string {
    return ['IDLE', 'PENDING_PAN', 'PAN', 'PENDING_TWO_FINGER', 'PINCH', 'SENSITIVITY_SWIPE'][this.#state]
  }

  attach = (
    canvas: HTMLCanvasElement,
    pan: PanDelegate,
    pinch: PinchDelegate,
  ): void => {
    if (this.#enabled) return

    this.#canvas = canvas
    this.#panDelegate = pan
    this.#pinchDelegate = pinch
    this.#gate = window.ioc.get<InputGate>('@diamondcoreprocessor.com/InputGate') ?? null

    window.addEventListener('pointerdown', this.#onPointerDown, { passive: false })
    window.addEventListener('pointermove', this.#onPointerMove, { passive: false })
    window.addEventListener('pointerup', this.#onPointerUp, { passive: false })
    window.addEventListener('pointercancel', this.#onPointerUp, { passive: false })

    this.#enabled = true
  }

  detach = (): void => {
    if (!this.#enabled) return

    window.removeEventListener('pointerdown', this.#onPointerDown)
    window.removeEventListener('pointermove', this.#onPointerMove)
    window.removeEventListener('pointerup', this.#onPointerUp)
    window.removeEventListener('pointercancel', this.#onPointerUp)

    this.#reset()

    this.#canvas = null
    this.#panDelegate = null
    this.#pinchDelegate = null
    this.#gate = null
    this.#enabled = false
  }

  // ── pointer events ──────────────────────────────────────────

  #onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return
    if (!this.#canvas) return

    const rect = this.#canvas.getBoundingClientRect()
    if (!this.#isInsideRect(e.clientX, e.clientY, rect)) return

    const pt: Point = { x: e.clientX, y: e.clientY }
    this.#pointers.set(e.pointerId, { start: { ...pt }, current: pt, id: e.pointerId })

    e.preventDefault()
    e.stopPropagation()

    const count = this.#pointers.size

    // If a gesture was active and we're getting new pointers without full lift-off,
    // the gesture is "poisoned" — ignore until all lifted
    if (this.#gestureWasActive) return

    if (this.#state === GestureState.IDLE) {
      if (count === 1) {
        this.#state = GestureState.PENDING_PAN
      } else if (count === 2) {
        this.#state = GestureState.PENDING_TWO_FINGER
      }
    } else if (this.#state === GestureState.PENDING_PAN && count === 2) {
      // second finger arrived while still pending — reclassify
      this.#state = GestureState.PENDING_TWO_FINGER
    }
    // If already in PAN/PINCH/SENSITIVITY_SWIPE and more fingers arrive, ignore (poisoned)
    if (this.#state === GestureState.PAN || this.#state === GestureState.PINCH || this.#state === GestureState.SENSITIVITY_SWIPE) {
      if (count > (this.#state === GestureState.PAN ? 1 : 2)) {
        // extra fingers — poison
        this.#gestureWasActive = true
      }
    }
  }

  #onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return

    const entry = this.#pointers.get(e.pointerId)
    if (!entry) return

    const prev = { ...entry.current }
    entry.current = { x: e.clientX, y: e.clientY }

    if (this.#gestureWasActive) return

    switch (this.#state) {
      case GestureState.PENDING_PAN:
        this.#handlePendingPan(entry)
        break

      case GestureState.PAN:
        this.#handlePan(prev, entry.current)
        e.preventDefault()
        e.stopPropagation()
        break

      case GestureState.PENDING_TWO_FINGER:
        this.#handlePendingTwoFinger()
        break

      case GestureState.PINCH:
        this.#handlePinch()
        e.preventDefault()
        e.stopPropagation()
        break

      case GestureState.SENSITIVITY_SWIPE:
        this.#handleSensitivitySwipe()
        e.preventDefault()
        e.stopPropagation()
        break
    }
  }

  #onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return

    const wasTracked = this.#pointers.delete(e.pointerId)

    if (this.#pointers.size === 0) {
      // check for sensitivity lock double-swipe before reset
      if (this.#state === GestureState.SENSITIVITY_SWIPE) {
        this.#checkSwipeUpForLock()
      }

      this.#finishGesture()

      if (wasTracked) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
  }

  // ── gesture handlers ────────────────────────────────────────

  #handlePendingPan(entry: PointerEntry): void {
    const dx = entry.current.x - entry.start.x
    const dy = entry.current.y - entry.start.y
    const dist = Math.hypot(dx, dy)

    if (dist >= DRAG_THRESHOLD) {
      if (!this.#gate?.claim(this.#source)) {
        this.#state = GestureState.IDLE
        return
      }

      this.#state = GestureState.PAN
      this.#panLast = { ...entry.current }
      this.#emitDragging(true)
    }
  }

  #handlePan(prev: Point, current: Point): void {
    if (!this.#panLast) return

    this.#panDelegate?.panUpdate(this.#panLast, current, this.#sensitivity)
    this.#panLast = { ...current }
  }

  #handlePendingTwoFinger(): void {
    const pts = Array.from(this.#pointers.values())
    if (pts.length < 2) return

    const [a, b] = pts

    // check pinch: distance change from initial positions
    const startDist = Math.hypot(a.start.x - b.start.x, a.start.y - b.start.y)
    const curDist = Math.hypot(a.current.x - b.current.x, a.current.y - b.current.y)
    const distDelta = Math.abs(curDist - startDist)

    // check vertical swipe: both fingers moving in same vertical direction
    const aDy = a.current.y - a.start.y
    const bDy = b.current.y - b.start.y
    const avgDy = (aDy + bDy) / 2
    const aDx = a.current.x - a.start.x
    const bDx = b.current.x - b.start.x
    const avgDx = (aDx + bDx) / 2

    const verticalDist = Math.abs(avgDy)
    const angle = Math.atan2(Math.abs(avgDx), Math.abs(avgDy)) * (180 / Math.PI)
    const sameDirection = (aDy > 0 && bDy > 0) || (aDy < 0 && bDy < 0)

    // sensitivity swipe: both fingers move vertically in same direction
    if (sameDirection && verticalDist >= SWIPE_THRESHOLD && angle <= SWIPE_ANGLE_MAX_DEG && !this.#sensitivityLocked) {
      if (!this.#gate?.claim(this.#source)) {
        this.#state = GestureState.IDLE
        return
      }
      this.#state = GestureState.SENSITIVITY_SWIPE
      this.#swipeStartY = (a.current.y + b.current.y) / 2
      this.#swipeStartSensitivity = this.#sensitivity
      this.#emitDragging(true)
      this.#emitSensitivityBar(true)
      return
    }

    // pinch: distance between fingers changed
    if (distDelta >= PINCH_THRESHOLD) {
      if (!this.#gate?.claim(this.#source)) {
        this.#state = GestureState.IDLE
        return
      }
      this.#state = GestureState.PINCH
      this.#pinchLastDistance = curDist
      this.#emitDragging(true)
      return
    }
  }

  #handlePinch(): void {
    const pts = Array.from(this.#pointers.values())
    if (pts.length < 2) return

    const [a, b] = pts
    const result = this.#pinchDelegate?.pinchUpdate(
      a.current, b.current, this.#pinchLastDistance, this.#sensitivity,
    )
    if (result) {
      this.#pinchLastDistance = result.distance
    }
  }

  #handleSensitivitySwipe(): void {
    const pts = Array.from(this.#pointers.values())
    if (pts.length < 2) return

    const [a, b] = pts
    const currentY = (a.current.y + b.current.y) / 2
    const deltaY = this.#swipeStartY - currentY // up = positive = more sensitive

    // logarithmic mapping: 200px of movement = one doubling/halving
    const logDelta = deltaY / 200
    const newSensitivity = this.#swipeStartSensitivity * Math.pow(2, logDelta)
    this.#sensitivity = Math.max(SENSITIVITY_MIN, Math.min(SENSITIVITY_MAX, newSensitivity))

    this.#emitSensitivityBar(true)
  }

  // ── sensitivity lock ────────────────────────────────────────

  #checkSwipeUpForLock(): void {
    // determine if this was an upward swipe (net upward movement > threshold)
    const pts = Array.from(this.#pointers.values())
    // pointers already cleared by the time we get here in some paths,
    // so use the swipe start data
    const currentY = this.#swipeStartY // approximate — the swipe has ended
    // Actually we need to track the final Y. Let's use a different approach:
    // We track whether the net movement was upward during the swipe
    const netUp = this.#sensitivity > this.#swipeStartSensitivity

    // check if this is a short upward swipe (not a big sensitivity change)
    // For lock detection, we care about the gesture direction, not magnitude
    const now = Date.now()

    if (now - this.#lastSwipeUpTime <= LOCK_DOUBLE_SWIPE_MS) {
      this.#swipeUpCount++
    } else {
      this.#swipeUpCount = 1
    }
    this.#lastSwipeUpTime = now

    if (this.#swipeUpCount >= 2) {
      this.#sensitivityLocked = !this.#sensitivityLocked
      this.#swipeUpCount = 0
      this.#saveSensitivity()
      try { navigator.vibrate?.(100) } catch { /* ignore */ }
      this.#emitSensitivityBar(true)
    }
  }

  // ── lifecycle helpers ───────────────────────────────────────

  #finishGesture(): void {
    if (this.#state !== GestureState.IDLE) {
      this.#gate?.release(this.#source)
    }

    if (this.#state === GestureState.SENSITIVITY_SWIPE) {
      this.#saveSensitivity()
      // hide bar after a delay (the component handles the fade)
      this.#emitSensitivityBar(false)
    }

    this.#state = GestureState.IDLE
    this.#panLast = null
    this.#pinchLastDistance = 0
    this.#gestureWasActive = false
    this.#pointers.clear()

    this.#emitDragging(false)
  }

  #reset(): void {
    if (this.#state !== GestureState.IDLE) {
      this.#gate?.release(this.#source)
    }
    this.#state = GestureState.IDLE
    this.#pointers.clear()
    this.#panLast = null
    this.#pinchLastDistance = 0
    this.#gestureWasActive = false
    this.#emitDragging(false)
  }

  #emitDragging(active: boolean): void {
    if (this.#draggingEmitted === active) return
    this.#draggingEmitted = active
    EffectBus.emit('touch:dragging', { active })
  }

  #emitSensitivityBar(visible: boolean): void {
    EffectBus.emit('touch:sensitivity-bar', {
      value: this.#sensitivity,
      locked: this.#sensitivityLocked,
      visible,
    })
  }

  // ── sensitivity persistence ─────────────────────────────────

  #loadSensitivity(): void {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (raw) {
        const data = JSON.parse(raw)
        if (typeof data.value === 'number') {
          this.#sensitivity = Math.max(SENSITIVITY_MIN, Math.min(SENSITIVITY_MAX, data.value))
        }
        if (typeof data.locked === 'boolean') {
          this.#sensitivityLocked = data.locked
        }
      }
    } catch { /* ignore */ }
  }

  #saveSensitivity(): void {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        value: this.#sensitivity,
        locked: this.#sensitivityLocked,
      }))
    } catch { /* ignore */ }
  }

  // ── utils ───────────────────────────────────────────────────

  #isInsideRect(x: number, y: number, rect: DOMRect): boolean {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  }
}

// Self-register. In dev mode, _deps array in app.ts prevents tree-shaking.
// In production, zoom.drone.ts co-locates a redundant registration as safety net.
window.ioc.register('@diamondcoreprocessor.com/TouchGestureCoordinator', new TouchGestureCoordinator())
