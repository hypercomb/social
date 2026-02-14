// src/<domain>/pixi/pinch-zoom.drone.ts
import { get } from '@hypercomb/core'
import { Drone } from '@hypercomb/core'

type Point = { x: number; y: number }

export class PinchZoomDrone extends Drone {

  public override description = 'two-finger pinch zoom (host-only, encapsulated)'

  private initialized = false
  private rafId: number | null = null

  private pointers = new Map<number, Point>()
  private isPinching = false

  private baselineDistance = 0
  private startScale = 1

  protected override sense = (): boolean => {
    if (this.initialized) return false
    this.initialized = true
    return true
  }

  protected override heartbeat = async (): Promise<void> => {
    this.start()
  }

  public start = (): void => {
    if (this.rafId !== null) return

    window.addEventListener('pointerdown', this.onPointerDown, { passive: false })
    window.addEventListener('pointermove', this.onPointerMove, { passive: false })
    window.addEventListener('pointerup', this.onPointerUp, { passive: false })
    window.addEventListener('pointercancel', this.onPointerUp, { passive: false })

    this.tick()
  }

  public stop = async (): Promise<void> => {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }

    window.removeEventListener('pointerdown', this.onPointerDown)
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
    window.removeEventListener('pointercancel', this.onPointerUp)

    this.resetPinch()
  }

  private tick = (): void => {
    this.rafId = requestAnimationFrame(this.tick)

    if (this.pointers.size < 2) {
      if (this.isPinching) this.resetPinch()
      return
    }

    const host = get<any>('PixiHost')
    if (!host?.container) return

    const [p1, p2] = Array.from(this.pointers.values()).slice(0, 2)

    const dist = this.distance(p1, p2)
    if (dist <= 0) return

    if (!this.isPinching) {
      this.isPinching = true
      this.baselineDistance = dist
      this.startScale = host.container.scale.x
      return
    }

    const factor = dist / this.baselineDistance
    const newScale = this.startScale * factor

    const pivot = {
      x: (p1.x + p2.x) / 2,
      y: (p1.y + p2.y) / 2
    }

    this.applyZoom(host.container, newScale, pivot)
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  }

  private onPointerUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId)
    if (this.pointers.size < 2) this.resetPinch()
  }

  private resetPinch = (): void => {
    this.isPinching = false
    this.baselineDistance = 0
  }

  private distance = (a: Point, b: Point): number => {
    return Math.hypot(b.x - a.x, b.y - a.y)
  }

  private applyZoom = (container: any, scale: number, pivot: Point): void => {
    const worldBefore = {
      x: (pivot.x - container.position.x) / container.scale.x,
      y: (pivot.y - container.position.y) / container.scale.y
    }

    container.scale.set(scale)

    const worldAfter = {
      x: worldBefore.x * scale,
      y: worldBefore.y * scale
    }

    container.position.x = pivot.x - worldAfter.x
    container.position.y = pivot.y - worldAfter.y
  }
}
