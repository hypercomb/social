import { PanningDrone } from './panning.drone';

// src/<domain>/pixi/inputs/mouse-pan.input.ts
type Point = { x: number; y: number }

export class MousePanInput {

  private enabled = false
  private dragging = false
  private last: Point | null = null
  private canvas: HTMLCanvasElement | null = null

  private readonly source = 'mouse-pan'

  private pan: {
    panBy: (delta: Point, source: string) => void
    end: (source: string) => void
  } | null = null

  public attach = (
    pan: {
      panBy: (delta: Point, source: string) => void
      end: (source: string) => void
    },
    canvas: HTMLCanvasElement
  ): void => {
    if (this.enabled) return

    this.pan = pan
    this.canvas = canvas

    document.addEventListener('mousedown', this.onDown)
    document.addEventListener('mousemove', this.onMove)
    document.addEventListener('mouseup', this.onUp)
    document.addEventListener('selectstart', this.onSelectStart)

    this.enabled = true
  }

  public detach = (): void => {
    if (!this.enabled) return

    document.removeEventListener('mousedown', this.onDown)
    document.removeEventListener('mousemove', this.onMove)
    document.removeEventListener('mouseup', this.onUp)
    document.removeEventListener('selectstart', this.onSelectStart)

    this.dragging = false
    this.last = null
    this.pan = null
    this.canvas = null
    this.enabled = false
  }

  private onDown = (e: MouseEvent): void => {
    if (e.button !== 0) return
    if (!this.canvas) return
    if (this.isInteractiveTarget(e.target)) return

    const rect = this.canvas.getBoundingClientRect()
    if (!this.isInsideRect(e.clientX, e.clientY, rect)) return

    this.dragging = true
    this.last = { x: e.clientX, y: e.clientY }

    e.preventDefault()
    e.stopPropagation()
    this.clearSelection()
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

    e.preventDefault()
    e.stopPropagation()
  }

  private onUp = (e: MouseEvent): void => {
    if (!this.dragging) return
    this.dragging = false
    this.last = null
    this.pan?.end(this.source)

    e.preventDefault()
    e.stopPropagation()
  }

  private onSelectStart = (e: Event): void => {
    if (!this.dragging) return
    e.preventDefault()
  }

  private isInsideRect = (x: number, y: number, rect: DOMRect): boolean => {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  }

  private isInteractiveTarget = (target: EventTarget | null): boolean => {
    const element = target as HTMLElement | null
    if (!element) return false

    return !!element.closest('input, textarea, button, select, option, a, [contenteditable="true"], [contenteditable=""], [role="textbox"]')
  }

  private clearSelection = (): void => {
    try {
      window.getSelection()?.removeAllRanges()
    } catch {
      // ignore
    }
  }
}
window.ioc.register('@diamondcoreprocessor.com/MousePanInput', new MousePanInput())
