// src/<domain>/pixi/pinch-zoom.drone.ts

import { Drone } from '@hypercomb/core'

type Point = { x: number; y: number }

type PointerEventLite = { pointerId: number; pointerType: string } | null

type PointerStateLike = {
  pointerPositions: () => Map<number, Point>
  pointerMoveEvent: () => PointerEventLite
  pointerDownEvent: () => PointerEventLite
}

type ZoomStateLike = {
  currentScale: number
  zoomToScale: (scale: number, pivot: Point) => void
}

type ZoomArbiterLike = {
  acquire: (source: string, force?: boolean) => boolean
  release: (source: string) => void
}

type TouchPanningLike = {
  cancelPanSession: () => void
  disable: () => void
  enable: () => void
  beginPanFromTouch: (x: number, y: number, pointerId: number) => void
}

type HypercombStateLike = {
  hasMode: (mode: unknown) => boolean
  setCancelled: (cancelled: boolean) => void
}

type PixiHostLike = {
  container: unknown | null
}

export class PinchZoomDrone extends Drone {

  public override description = 'two-finger pinch zoom (ignores mouse pointer)'

  private readonly jitterPx = 4
  private readonly source = 'pinch'

  private isPinching = false
  private pivot: Point | null = null
  private baselineDistance = 0
  private startScale = 1
  private mousePointerId: number | null = null
  private rafId: number | null = null

  private getService = (key: string): any => {
    const ioc = (globalThis as any).ioc
    if (!ioc || typeof ioc.get !== 'function') {
      throw new Error(`[pinch-zoom-drone] missing global ioc.get for key: ${key}`)
    }
    return ioc.get(key)
  }

  private get ps(): PointerStateLike { return this.getService('pointerState') }
  private get zoom(): ZoomStateLike { return this.getService('zoomState') }
  private get zoomArbiter(): ZoomArbiterLike { return this.getService('zoomArbiter') }
  private get touchPan(): TouchPanningLike { return this.getService('touchPanning') }
  private get state(): HypercombStateLike { return this.getService('hypercombState') }
  private get pixi(): PixiHostLike { return this.getService('pixiHost') }
  private get transportMode(): unknown { return this.getService('HypercombMode.Transport') }

  public run = async (): Promise<void> => {
    if (this.rafId !== null) return
    this.tick()
  }

  public stop = async (): Promise<void> => {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.stopPinch()
  }

  private tick = (): void => {
    this.rafId = requestAnimationFrame(this.tick)

    const container = this.pixi.container
    if (!container) {
      if (this.isPinching) this.stopPinch()
      return
    }

    const positions = this.ps.pointerPositions()
    const lastMove = this.ps.pointerMoveEvent()
    const lastDown = this.ps.pointerDownEvent()

    const last = lastMove ?? lastDown
    if (last && last.pointerType === 'mouse') {
      this.mousePointerId = last.pointerId
    }

    const allEntries = Array.from(positions.entries()) as [number, Point][]
    const touchEntries = allEntries.filter(([id]) => id !== this.mousePointerId)
    const count = touchEntries.length

    if (count === 0) {
      if (this.isPinching) this.stopPinch()
      return
    }

    // block zoom in transport mode
    if (this.state.hasMode(this.transportMode)) {
      this.stopPinch()
      return
    }

    if (!this.isPinching && count >= 2) {
      const [, p1] = touchEntries[0]
      const [, p2] = touchEntries[1]

      const dist = this.getDistance(p1, p2)
      if (dist <= 0) return

      // pinch should win over other zoom inputs
      if (!this.zoomArbiter.acquire(this.source, true)) return

      this.pivot = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
      this.baselineDistance = dist
      this.startScale = this.zoom.currentScale

      this.touchPan.cancelPanSession()
      this.touchPan.disable()

      this.isPinching = true
      this.state.setCancelled(true)
      return
    }

    if (this.isPinching && count >= 2) {
      const [, p1] = touchEntries[0]
      const [, p2] = touchEntries[1]
      if (!this.pivot) return
      if (this.baselineDistance <= 0) return

      const dist = this.getDistance(p1, p2)
      const delta = dist - this.baselineDistance
      if (Math.abs(delta) < this.jitterPx) return

      const factor = dist / this.baselineDistance
      const newScale = this.startScale * factor

      this.zoom.zoomToScale(newScale, this.pivot)
      return
    }

    if (this.isPinching && count === 1) {
      const [pointerId, p] = touchEntries[0]
      this.stopPinch()

      this.touchPan.enable()
      this.touchPan.beginPanFromTouch(p.x, p.y, pointerId)
      return
    }
  }

  private getDistance = (a: Point, b: Point): number => {
    const dx = b.x - a.x
    const dy = b.y - a.y
    return Math.hypot(dx, dy)
  }

  private stopPinch = (): void => {
    if (!this.isPinching) return

    this.isPinching = false
    this.pivot = null
    this.baselineDistance = 0
    this.startScale = this.zoom.currentScale

    this.zoomArbiter.release(this.source)
    this.touchPan.enable()
  }
}
