import { PanningDrone } from './panning.drone';

// src/<domain>/pixi/inputs/mouse-pan.input.ts
type Point = { x: number; y: number }

export class MousePanInput {

  private enabled = false
  private dragging = false
  private last: Point | null = null

  private readonly source = 'mouse-pan'

  private pan: {
    panBy: (delta: Point, source: string) => void
    end: (source: string) => void
  } | null = null

  public attach = (
    pan: {
      panBy: (delta: Point, source: string) => void
      end: (source: string) => void
    }
  ): void => {
    if (this.enabled) return

    this.pan = pan

    document.addEventListener('mousedown', this.onDown)
    document.addEventListener('mousemove', this.onMove)
    document.addEventListener('mouseup', this.onUp)

    this.enabled = true
  }

  public detach = (): void => {
    if (!this.enabled) return

    document.removeEventListener('mousedown', this.onDown)
    document.removeEventListener('mousemove', this.onMove)
    document.removeEventListener('mouseup', this.onUp)

    this.dragging = false
    this.last = null
    this.pan = null
    this.enabled = false
  }

  private onDown = (e: MouseEvent): void => {
    if (e.button !== 0) return
    this.dragging = true
    this.last = { x: e.clientX, y: e.clientY }
  }

  private onMove = (e: MouseEvent): void => {
    if (!this.dragging || !this.last || !this.pan) return

    const next = { x: e.clientX, y: e.clientY }
    const delta = {
      x: next.x - this.last.x,
      y: next.y - this.last.y
    }

    this.last = next
    this.pan.panBy(delta, this.source)
  }

  private onUp = (): void => {
    if (!this.dragging) return
    this.dragging = false
    this.last = null
    this.pan?.end(this.source)
  }
}
window.ioc.register('MousePanInput',new MousePanInput())
