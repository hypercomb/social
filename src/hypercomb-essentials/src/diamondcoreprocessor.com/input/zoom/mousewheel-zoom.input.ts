// diamondcoreprocessor.com/input/zoom/mousewheel-zoom.input.ts
import type { InputGate } from '../input-gate.service.js'

type Point = { x: number; y: number }

export class MousewheelZoomInput {
  private enabled = false
  private canvas: HTMLCanvasElement | null = null

  private readonly step = 1.05

  private zoom: {
    zoomByFactor: (factor: number, pivot: Point) => void
  } | null = null

  private gate: InputGate | null = null

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

    const factor = event.deltaY < 0 ? this.step : 1 / this.step

    this.zoom.zoomByFactor(
      factor,
      { x: event.clientX, y: event.clientY },
    )

    event.preventDefault()
    event.stopPropagation()
  }
}

window.ioc.register('@diamondcoreprocessor.com/MousewheelZoomInput', new MousewheelZoomInput())
