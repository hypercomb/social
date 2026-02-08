// src/pixi/pinch-zoom.drone.ts

import { Drone } from '@hypercomb/core'

type Point = { x: number; y: number }
type PointerEventLike = { pointerId: number; pointerType?: string }

type PointerStateLike = {
  pointerPositions: () => Map<number, Point>
  pointerMoveEvent: () => PointerEventLike | null
  pointerDownEvent: () => PointerEventLike | null
}

type ZoomLike = {
  currentScale: number
  zoomToScale: (scale: number, pivot: Point) => void
}

type TouchPanningLike = {
  cancelPanSession: () => void
  disable: () => void
  enable: () => void
  beginPanFromTouch: (x: number, y: number, pointerId: number) => void
}

type ModeStateLike = {
  // optional: keep generic so this drone doesn't depend on angular enums
  // expected contract:
  // - hasMode(mode: any): boolean
  // - setCancelled(flag: boolean): void
  hasMode?: (mode: any) => boolean
  setCancelled?: (flag: boolean) => void
}

type IocLike = { get: (key: string) => any }

export class PinchZoomDrone extends Drone {
  // -------------------------------------------------
  // internal state (cold constructor rule compliant)
  // -------------------------------------------------

  private isPinching = false
  private pivot: Point | null = null
  private baselineDistance = 0
  private startScale = 1
  private mousePointerId: number | null = null
  private lastTouchCount = 0

  // optional policy hooks (can be registered in ioc by the host app)
  private transportModeToken: any | null = null

  protected override sense = (): boolean => true

  protected override heartbeat = async (): Promise<void> => {
    const ioc = this.getIoc()
    if (!ioc) return

    const ps = ioc.get('Pointer State') as PointerStateLike | undefined
    const zoom = ioc.get('Zoom') as ZoomLike | undefined
    const touchPan = ioc.get('Touch Pan') as TouchPanningLike | undefined
    const state = ioc.get('State') as ModeStateLike | undefined

    // if any required capability is missing, keep idle (installer should guarantee these)
    if (!ps || !zoom || !touchPan) return

    // optional: a shared token can represent "transport" mode without importing enums
    // host can register this token once (or omit it)
    if (this.transportModeToken === null) {
      this.transportModeToken = this.tryGetTransportToken(ioc)
    }

    const positions = ps.pointerPositions()
    const lastMove = ps.pointerMoveEvent()
    const lastDown = ps.pointerDownEvent()

    // update mouse pointer id from latest mouse event (so it doesn't count as touch)
    const last = lastMove ?? lastDown
    if (last && last.pointerType === 'mouse') {
      this.mousePointerId = last.pointerId
    }

    const allEntries = Array.from(positions.entries()) as [number, Point][]
    const touchEntries = allEntries.filter(([id]) => id !== this.mousePointerId)
    const count = touchEntries.length

    // no touch pointers → end any active pinch
    if (count === 0) {
      if (this.isPinching) this.stopPinch(touchPan, zoom)
      this.lastTouchCount = 0
      return
    }

    // block zoom in transport mode (if host provides this concept)
    if (this.isTransportMode(state)) {
      if (this.isPinching) this.stopPinch(touchPan, zoom)
      this.lastTouchCount = count
      return
    }

    // start pinch when 2+ touch pointers exist
    if (!this.isPinching && count >= 2) {
      const [, p1] = touchEntries[0]
      const [, p2] = touchEntries[1]

      const dist = this.getDistance(p1, p2)
      if (dist <= 0) return

      this.pivot = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
      this.baselineDistance = dist
      this.startScale = zoom.currentScale

      // kill any active touch pan and disable it during pinch
      touchPan.cancelPanSession()
      touchPan.disable()

      // mark pinch so clicks are cancelled (if host supports it)
      this.isPinching = true
      state?.setCancelled?.(true)

      this.lastTouchCount = count
      return
    }

    // update pinch while 2+ touches remain
    if (this.isPinching && count >= 2) {
      const [, p1] = touchEntries[0]
      const [, p2] = touchEntries[1]

      if (!this.pivot) return
      if (this.baselineDistance <= 0) return

      const dist = this.getDistance(p1, p2)
      const delta = dist - this.baselineDistance

      // small jitter → ignore
      if (Math.abs(delta) < 4) return

      // scale factor based on distance ratio
      const factor = dist / this.baselineDistance
      const newScale = this.startScale * factor

      zoom.zoomToScale(newScale, this.pivot)

      this.lastTouchCount = count
      return
    }

    // pinch was active and now only 1 touch remains → hand off to pan
    if (this.isPinching && count === 1) {
      const [pointerId, p] = touchEntries[0]

      this.stopPinch(touchPan, zoom)

      // re-enable touch pan and continue from current finger position
      touchPan.enable()
      touchPan.beginPanFromTouch(p.x, p.y, pointerId)

      this.lastTouchCount = count
      return
    }

    // if not pinching and only 1 touch exists, do nothing:
    // touch panning handles normal one-finger pan

    this.lastTouchCount = count
  }

  // -------------------------------------------------
  // helpers
  // -------------------------------------------------

  private getIoc = (): IocLike | null => {
    const w = window as any
    const ioc = w?.ioc as IocLike | undefined
    if (!ioc?.get) return null
    return ioc
  }

  private tryGetTransportToken = (ioc: IocLike): any | null => {
    // optional: host can register a token describing transport mode
    // examples: ioc.provide('Mode.Transport', HypercombMode.Transport)
    try {
      return ioc.get('Mode.Transport')
    } catch {
      return null
    }
  }

  private isTransportMode = (state: ModeStateLike | undefined): boolean => {
    if (!state?.hasMode) return false
    if (this.transportModeToken == null) return false
    try {
      return !!state.hasMode(this.transportModeToken)
    } catch {
      return false
    }
  }

  private getDistance = (a: Point, b: Point): number => {
    const dx = b.x - a.x
    const dy = b.y - a.y
    return Math.hypot(dx, dy)
  }

  private stopPinch = (touchPan: TouchPanningLike, zoom: ZoomLike): void => {
    if (!this.isPinching) return

    this.isPinching = false
    this.pivot = null
    this.baselineDistance = 0
    this.startScale = zoom.currentScale

    // allow normal touch panning after gesture ends
    touchPan.enable()
  }
}
