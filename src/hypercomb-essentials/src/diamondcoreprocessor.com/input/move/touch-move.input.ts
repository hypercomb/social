// diamondcoreprocessor.com/input/move/touch-move.input.ts
import { Point } from 'pixi.js'
import type { Axial } from '../hex-detector.js'
import type { MoveDroneApi } from './move.drone.js'
import type { InputGate } from '../input-gate.service.js'

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
  #pointerCount = 0
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

    this.#enabled = true
  }

  detach = (): void => {
    if (!this.#enabled) return

    window.removeEventListener('pointerdown', this.#onPointerDown)
    window.removeEventListener('pointermove', this.#onPointerMove)
    window.removeEventListener('pointerup', this.#onPointerUp)
    window.removeEventListener('pointercancel', this.#onPointerUp)

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

    this.#pointerCount++

    // second finger → cancel any pending move (pinch-zoom takes over)
    if (this.#pointerCount > 1) {
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

    // start long-press timer
    this.#holdTimer = setTimeout(() => {
      this.#holdTimer = null
      if (!this.#downAxial || !this.#drone) return

      // if the touch gesture coordinator already claimed the gate (e.g., pan started),
      // don't start a move — the gate owner has priority
      if (this.#gate?.active) {
        this.#resetDrag()
        return
      }

      const ok = this.#drone.beginMove(this.#downAxial, this.#source)
      if (!ok) {
        this.#resetDrag()
        return
      }

      this.#dragging = true

      // haptic feedback
      try { navigator.vibrate?.(50) } catch { /* ignore */ }

      e.preventDefault()
      e.stopPropagation()
    }, this.#holdMs)
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

    if (!this.#dragging || !this.#drone) return

    const axial = this.#clientToAxial(e.clientX, e.clientY)
    if (axial) this.#drone.updateMove(axial, this.#source)

    e.preventDefault()
    e.stopPropagation()
  }

  #onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return
    this.#pointerCount = Math.max(0, this.#pointerCount - 1)

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
    this.#downPos = null
    this.#downAxial = null
    this.#activePointerId = null
    this.#dragging = false
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
