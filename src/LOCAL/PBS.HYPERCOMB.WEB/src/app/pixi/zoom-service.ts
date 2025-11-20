import { Injectable, inject } from '@angular/core'
import { Point } from 'pixi.js'
import { LayoutState } from '../layout/layout-state'
import { PixiDataServiceBase } from '../database/pixi-data-service-base'

@Injectable({ providedIn: 'root' })
export class ZoomService extends PixiDataServiceBase {
  private readonly ls = inject(LayoutState)
  private minScale: number = this.ls.minScale
  private maxScale: number = this.ls.maxScale

  private targetScale: number | null = null
  private rafId: number | null = null
  private readonly ease = 0.15
  private _wheelSpeed = this.state.isMobile? 1.5 : 1.25

  public get wheelSpeed(): number {
    return this._wheelSpeed
  }

  public set wheelSpeed(value: number) {
    this._wheelSpeed = Math.max(1.001, value)
  }

  private canZoom(): boolean {
    return true
  }

  private adjustZoom(
    newScale: number,
    position: { x: number; y: number } = new Point(0, 0)
  ): void {
    const container = this.pixi.container!
    const cell = this.stack.top()?.cell!
    const before = {
      scale: container.scale.x,
      pos: { x: container.x, y: container.y },
    }
    const preLocal = container.toLocal(new Point(position.x, position.y))
    container.scale.set(newScale)
    const postGlobal = container.toGlobal(preLocal)
    container.position.set(
      container.x + (position.x - postGlobal.x),
      container.y + (position.y - postGlobal.y)
    )
    cell.scale = newScale
    cell.x = container.x
    cell.y = container.y
    const after = {
      scale: container.scale.x,
      pos: { x: container.x, y: container.y },
    }
    this.debug.log('zoom', 'adjustZoom', { before, after, pivot: position })
    this.saveTransform()
  }

  private animateTowardsTarget(pivot: Point): void {
    if (this.rafId) cancelAnimationFrame(this.rafId)
    const tick = () => {
      if (this.targetScale == null) return
      const container = this.pixi.container!
      const current = container.scale.x
      const delta = this.targetScale - current
      if (Math.abs(delta) < 0.0005) {
        this.adjustZoom(this.targetScale, pivot)
        this.targetScale = null
        this.rafId = null
        return
      }
      const next = current + delta * this.ease
      this.adjustZoom(next, pivot)
      this.rafId = requestAnimationFrame(tick)
    }
    this.rafId = requestAnimationFrame(tick)
  }

  private enqueueZoom(target: number, pivot: { x: number; y: number }): void {
    const clamped = Math.min(Math.max(target, this.minScale), this.maxScale)
    this.targetScale = clamped
    this.animateTowardsTarget(new Point(pivot.x, pivot.y))
  }

  public applyZoom(scaleAmount: number, pivot: { x: number; y: number }): void {
    const current = this.pixi.container!.scale.x
    this.enqueueZoom(current * scaleAmount, pivot)
  }

  public setZoom(zoomValue: number, pivot: { x: number; y: number }): void {
    this.enqueueZoom(zoomValue, pivot)
  }

  public zoomIn(position: { x: number; y: number }) {
    const f = this._wheelSpeed
    this.debug.log('zoom', `zoomIn factor=${f} pivot=`, position)
    this.applyZoom(f, position)
  }

  public zoomOut(position: { x: number; y: number }) {
    const f = 1 / this._wheelSpeed
    this.debug.log('zoom', `zoomOut factor=${f} pivot=`, position)
    this.applyZoom(f, position)
  }

  public reset() {
    const loc = this.screen.getWindowCenter()
    this.applyZoom(0.5, loc)
  }

  public get currentScale(): number {
    return this.pixi.container?.scale.x ?? 1
  }
}