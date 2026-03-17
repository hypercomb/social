// hypercomb-essentials/src/diamondcoreprocessor.com/input/zoom/pinch-zoom.input.ts

import type { InputGate } from '../input-gate.service.js'

type Point = { x: number; y: number }

export class PinchZoomInput {
  private enabled = false
  private canvas: HTMLCanvasElement | null = null

  private readonly source = 'pinch'

  private zoom: {
    zoomByFactor: (factor: number, pivot: Point) => void
  } | null = null

  private gate: InputGate | null = null

  private pointers = new Map<number, Point>()
  private pinching = false
  private lastDistance = 0

  public attach = (
    zoom: {
      zoomByFactor: (factor: number, pivot: Point) => void
    },
    canvas: HTMLCanvasElement
  ): void => {
    if (this.enabled) return

    this.zoom = zoom
    this.canvas = canvas
    this.gate = window.ioc.get<InputGate>('@diamondcoreprocessor.com/InputGate') ?? null

    // canvas has pointer-events:none so this must be global
    // gating uses the canvas rect so behavior matches "over the container"
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

    this.endPinch()

    this.zoom = null
    this.canvas = null
    this.gate = null
    this.enabled = false
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.zoom || !this.canvas) return
    if (event.pointerType !== 'touch') return

    const rect = this.canvas.getBoundingClientRect()
    if (!this.isInsideRect(event.clientX, event.clientY, rect)) return

    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })

    // prevent the browser from treating this as a scroll/gesture start
    event.preventDefault()
    event.stopPropagation()
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.zoom || !this.canvas) return
    if (!this.pointers.has(event.pointerId)) return

    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (this.pointers.size < 2) return

    const [p1, p2] = Array.from(this.pointers.values()).slice(0, 2)

    const dist = this.distance(p1, p2)
    if (dist <= 0) return

    if (!this.pinching) {
      if (!this.gate?.claim(this.source)) return
      this.pinching = true
      this.lastDistance = dist

      event.preventDefault()
      event.stopPropagation()
      return
    }

    // apply incremental factor so the gesture feels stable and never "creeps"
    let factor = dist / this.lastDistance
    if (!Number.isFinite(factor) || factor <= 0) return

    // clamp per-move factor to avoid spikes on noisy touch hardware
    factor = Math.max(0.5, Math.min(2.0, factor))

    const pivot = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }

    this.zoom.zoomByFactor(factor, pivot)

    this.lastDistance = dist

    event.preventDefault()
    event.stopPropagation()
  }

  private onPointerUp = (event: PointerEvent): void => {
    const wasTracked = this.pointers.delete(event.pointerId)

    if (this.pinching && this.pointers.size < 2) {
      this.endPinch()
    }

    if (wasTracked) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  private endPinch = (): void => {
    if (this.pinching) {
      this.gate?.release(this.source)
    }

    this.pointers.clear()
    this.pinching = false
    this.lastDistance = 0
  }

  private isInsideRect = (x: number, y: number, rect: DOMRect): boolean => {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  }

  private distance = (a: Point, b: Point): number => {
    return Math.hypot(b.x - a.x, b.y - a.y)
  }
}

window.ioc.register('@diamondcoreprocessor.com/PinchZoomInput', new PinchZoomInput())
