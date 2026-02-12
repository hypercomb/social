// src/<domain>/pixi/pinch-zoom.drone.ts
import { get } from '@hypercomb/core'
import { Drone } from '@hypercomb/core'

type Point = { x: number; y: number }

export class PinchZoomDrone extends Drone {

  private initialized = false
  public override description = 'two-finger pinch zoom (ignores mouse pointer)'

  private readonly jitterPx = 4
  private readonly source = 'pinch'

  private isPinching = false
  private baselineDistance = 0
  private startScale = 1
  private pinchId1: number | null = null
  private pinchId2: number | null = null

  private mousePointerId: number | null = null
  private rafId: number | null = null

  protected sense = (grammar: string): boolean | Promise<boolean> => {
    const intialized = this.initialized
    this.initialized = true
    return !intialized
  }

  protected override heartbeat = async (grammar: string): Promise<void> => {
    await this.run()
  }

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

    const host = <any>get('Pixi Host')!
    const container = host.container
    if (!container) {
      if (this.isPinching) this.stopPinch()
      return
    }

    // const positions = this.ps.pointerPositions()
    // const last = this.ps.pointerMoveEvent() ?? this.ps.pointerDownEvent()

    // if (last && last.pointerType === 'mouse') {
    //   this.mousePointerId = last.pointerId
    // }

    // const allEntries = Array.from(positions.entries()) as [number, Point][]
    // const touchEntries = allEntries.filter(([id]) => id !== this.mousePointerId)
    // const count = touchEntries.length

    // if (count === 0) {
    //   if (this.isPinching) this.stopPinch()
    //   return
    // }

    // // block zoom in transport mode
    // if (this.state.hasMode(this.transportMode)) {
    //   if (this.isPinching) this.stopPinch()
    //   return
    // }

    // // start pinch when we see 2 touches
    // if (!this.isPinching && count >= 2) {
    //   const [id1, p1] = touchEntries[0]
    //   const [id2, p2] = touchEntries[1]

    //   const dist = this.getDistance(p1, p2)
    //   if (dist <= 0) return

    //   // pinch should win over other zoom inputs
    //   if (!this.zoomArbiter.acquire(this.source, true)) return

    //   this.pinchId1 = id1
    //   this.pinchId2 = id2
    //   this.baselineDistance = dist
    //   this.startScale = this.zoom.currentScale

    //   this.touchPan.cancelPanSession()
    //   this.touchPan.disable()

    //   this.isPinching = true
    //   this.state.setCancelled(true)
    //   return
    // }

    // // update pinch while 2+ touches remain
    // if (this.isPinching && count >= 2) {
    //   if (this.pinchId1 === null || this.pinchId2 === null) {
    //     this.stopPinch()
    //     return
    //   }

    //   const p1 = positions.get(this.pinchId1)
    //   const p2 = positions.get(this.pinchId2)

    //   // if either finger changed, stop and let next frame re-start cleanly
    //   if (!p1 || !p2) {
    //     this.stopPinch()
    //     return
    //   }

    //   if (this.baselineDistance <= 0) return

    //   const dist = this.getDistance(p1, p2)
    //   const delta = dist - this.baselineDistance
    //   if (Math.abs(delta) < this.jitterPx) return

    //   const factor = dist / this.baselineDistance
    //   const newScale = this.startScale * factor

    //   // pivot follows the midpoint each frame
    //   const pivot = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
    //   this.zoom.zoomToScale(newScale, pivot)
    //   return
    // }

    // // handoff to pan when pinch drops to one touch
    // if (this.isPinching && count === 1) {
    //   const [pointerId, p] = touchEntries[0]
    //   this.stopPinch()

    //   this.touchPan.enable()
    //   this.touchPan.beginPanFromTouch(p.x, p.y, pointerId)
    //   return
    // }
  }

  private getDistance = (a: Point, b: Point): number => {
    const dx = b.x - a.x
    const dy = b.y - a.y
    return Math.hypot(dx, dy)
  }

  private stopPinch = (): void => {
    // if (!this.isPinching) return

    // this.isPinching = false
    // this.pinchId1 = null
    // this.pinchId2 = null
    // this.baselineDistance = 0
    // this.startScale = this.zoom.currentScale

    // this.zoomArbiter.release(this.source)
    // this.touchPan.enable()

    // // keep cancelled scoped to the gesture
    // this.state.setCancelled(false)
  }
}
