// hypercomb-essentials/src/diamondcoreprocessor.com/input/pan/touch-pan.input.ts

import type { InputGate } from '../input-gate.service.js'

type Point = { x: number; y: number }

/**
 * Single-finger touch panning for mobile. Tracks one touch pointer and
 * translates the stage by the delta. Automatically yields when a second
 * pointer arrives (so pinch-zoom can take over).
 */
export class TouchPanInput {
  private enabled = false
  private canvas: HTMLCanvasElement | null = null

  private readonly source = 'touch-pan'

  private pan: {
    panBy: (delta: Point) => void
  } | null = null

  private gate: InputGate | null = null

  private activePointerId: number | null = null
  private last: Point | null = null
  private pointerCount = 0

  public attach = (
    pan: {
      panBy: (delta: Point) => void
    },
    canvas: HTMLCanvasElement
  ): void => {
    if (this.enabled) return

    this.pan = pan
    this.canvas = canvas
    this.gate = window.ioc.get<InputGate>('@diamondcoreprocessor.com/InputGate') ?? null

    window.addEventListener('pointerdown', this.onPointerDown, { passive: false })
    window.addEventListener('pointermove', this.onPointerMove, { passive: false })
    window.addEventListener('pointerup', this.onPointerUp, { passive: false })
    window.addEventListener('pointercancel', this.onPointerUp, { passive: false })

    this.enabled = true
  }

  public detach = (): void => {
    if (!this.enabled) return

    window.removeEventListener('pointerdown', this.onPointerDown)
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
    window.removeEventListener('pointercancel', this.onPointerUp)

    this.endPan()

    this.pan = null
    this.canvas = null
    this.gate = null
    this.enabled = false
  }

  // -------------------------------------------------
  // pointer events
  // -------------------------------------------------

  private onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return
    if (!this.canvas) return

    const rect = this.canvas.getBoundingClientRect()
    if (!this.isInsideRect(e.clientX, e.clientY, rect)) return

    this.pointerCount++

    // yield to pinch-zoom when a second finger arrives
    if (this.pointerCount > 1) {
      this.endPan()
      return
    }

    if (!this.gate?.claim(this.source)) return

    this.activePointerId = e.pointerId
    this.last = { x: e.clientX, y: e.clientY }

    e.preventDefault()
    e.stopPropagation()
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (this.activePointerId == null) return
    if (e.pointerId !== this.activePointerId) return
    if (!this.last || !this.pan) return

    const next = { x: e.clientX, y: e.clientY }
    const delta = { x: next.x - this.last.x, y: next.y - this.last.y }
    this.last = next

    this.pan.panBy(delta)

    e.preventDefault()
    e.stopPropagation()
  }

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return

    this.pointerCount = Math.max(0, this.pointerCount - 1)

    if (e.pointerId === this.activePointerId) {
      this.endPan()
    }
  }

  // -------------------------------------------------
  // cleanup
  // -------------------------------------------------

  private endPan = (): void => {
    if (this.activePointerId != null) {
      this.gate?.release(this.source)
    }
    this.activePointerId = null
    this.last = null
  }

  // -------------------------------------------------
  // helpers
  // -------------------------------------------------

  private isInsideRect = (x: number, y: number, rect: DOMRect): boolean => {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  }
}
