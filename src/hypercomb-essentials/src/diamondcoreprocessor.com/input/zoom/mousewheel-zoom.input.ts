// hypercomb-essentials/src/diamondcoreprocessor.com/input/zoom/mousewheel-zoom.input.ts

type Point = { x: number; y: number }

export class MousewheelZoomInput {
  private enabled = false
  private canvas: HTMLCanvasElement | null = null

  private readonly step = 1.05
  private readonly source = 'mousewheel'

  private zoom: {
    zoomByFactor: (factor: number, pivot: Point, source: string) => void
    end: (source: string) => void
  } | null = null

  public attach = (
    zoom: {
      zoomByFactor: (factor: number, pivot: Point, source: string) => void
      end: (source: string) => void
    },
    canvas: HTMLCanvasElement
  ): void => {
    if (this.enabled) return

    this.zoom = zoom
    this.canvas = canvas

    // canvas has pointer-events:none so this must be global
    // gating uses the canvas rect so behavior matches "over the container"
    window.addEventListener('wheel', this.onWheel, { passive: false })
    this.enabled = true
  }

  public detach = (): void => {
    if (!this.enabled) return

    window.removeEventListener('wheel', this.onWheel)
    this.zoom?.end(this.source)

    this.zoom = null
    this.canvas = null
    this.enabled = false
  }

  private onWheel = (event: WheelEvent): void => {
    if (!this.zoom || !this.canvas) return

    const rect = this.canvas.getBoundingClientRect()
    if (
      event.clientX < rect.left || event.clientX > rect.right ||
      event.clientY < rect.top || event.clientY > rect.bottom
    ) return

    const factor = event.deltaY < 0 ? this.step : 1 / this.step

    this.zoom.zoomByFactor(
      factor,
      { x: event.clientX, y: event.clientY },
      this.source
    )

    event.preventDefault()
    event.stopPropagation()
  }
}

window.ioc.register('@diamondcoreprocessor.com/MousewheelZoomInput', new MousewheelZoomInput(), 'MousewheelZoomInput')
