// diamondcoreprocessor.com/input/zoom/mousewheel-zoom.input.ts
import type { InputGate } from '../input-gate.service.js'

type Point = { x: number; y: number }

// Predefined snap levels for coarse zoom (no modifier key)
const SNAP_LEVELS = [
  0.2, 0.25, 0.33, 0.5,
  0.67, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0,
  6.0, 8.0, 12.0,
]

export class MousewheelZoomInput {
  private enabled = false
  private canvas: HTMLCanvasElement | null = null

  // fine-grained step used when Ctrl is held
  private readonly fineStep = 1.02

  private zoom: {
    zoomByFactor: (factor: number, pivot: Point) => void
    zoomToScale: (scale: number, pivot: Point) => void
    currentScale: () => number
  } | null = null

  private gate: InputGate | null = null

  public attach = (
    zoom: {
      zoomByFactor: (factor: number, pivot: Point) => void
      zoomToScale: (scale: number, pivot: Point) => void
      currentScale: () => number
    },
    canvas: HTMLCanvasElement
  ): void => {
    if (this.enabled) return

    this.zoom = zoom
    this.canvas = canvas
    this.gate = window.ioc.get<InputGate>('@diamondcoreprocessor.com/InputGate') ?? null

    // canvas has pointer-events:none so this must be global
    // gating uses the canvas rect so behavior matches "over the container"
    window.addEventListener('wheel', this.onWheel, { passive: false })
    this.enabled = true
  }

  public detach = (): void => {
    if (!this.enabled) return

    window.removeEventListener('wheel', this.onWheel)

    this.zoom = null
    this.canvas = null
    this.gate = null
    this.enabled = false
  }

  private onWheel = (event: WheelEvent): void => {
    if (!this.zoom || !this.canvas) return

    // bail if another interaction owns the gate
    if (this.gate?.active) return

    const rect = this.canvas.getBoundingClientRect()
    if (
      event.clientX < rect.left || event.clientX > rect.right ||
      event.clientY < rect.top || event.clientY > rect.bottom
    ) return

    const pivot = { x: event.clientX, y: event.clientY }
    const zoomIn = event.deltaY < 0

    if (event.ctrlKey || event.metaKey) {
      // fine-grained smooth zoom when Ctrl/Cmd is held
      const factor = zoomIn ? this.fineStep : 1 / this.fineStep
      this.zoom.zoomByFactor(factor, pivot)
    } else {
      // snap to next/previous level
      const current = this.zoom.currentScale()
      const next = this.#nextSnapLevel(current, zoomIn)
      if (next !== current) {
        this.zoom.zoomToScale(next, pivot)
      }
    }

    event.preventDefault()
    event.stopPropagation()
  }

  #nextSnapLevel = (current: number, zoomIn: boolean): number => {
    if (zoomIn) {
      // find next level above current
      for (const level of SNAP_LEVELS) {
        if (level > current + 0.001) return level
      }
      return SNAP_LEVELS[SNAP_LEVELS.length - 1]
    } else {
      // find next level below current
      for (let i = SNAP_LEVELS.length - 1; i >= 0; i--) {
        if (SNAP_LEVELS[i] < current - 0.001) return SNAP_LEVELS[i]
      }
      return SNAP_LEVELS[0]
    }
  }
}

window.ioc.register('@diamondcoreprocessor.com/MousewheelZoomInput', new MousewheelZoomInput())
