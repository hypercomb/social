import { Injectable, inject } from '@angular/core'
import { Point } from 'pixi.js'
import { LayoutState } from '../layout/layout-state'
import { PixiDataServiceBase } from '../database/pixi-data-service-base'
import { Subject } from 'rxjs'
import { debounceTime } from 'rxjs/operators'

@Injectable({ providedIn: 'root' })
export class ZoomService extends PixiDataServiceBase {
  private readonly ls = inject(LayoutState)
  private minScale: number = this.ls.minScale
  private maxScale: number = this.ls.maxScale


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

  public applyZoom(scaleAmount: number, position: { x: number; y: number } = new Point(0, 0)) {
    if (!this.canZoom()) return
    const container = this.pixi.container!
    const oldScale = container.scale.x
    let newScale = oldScale * scaleAmount
    newScale = Math.min(Math.max(newScale, this.minScale), this.maxScale)
    this.debug.log('zoom', 'applyZoom', { oldScale, scaleAmount, newScale, position })
    this.adjustZoom(newScale, position)
  }

  public setZoom(zoomValue: number, position: { x: number; y: number } = new Point(0, 0)) {
    if (!this.canZoom()) return
    const newScale = Math.min(Math.max(zoomValue, this.minScale), this.maxScale)
    this.adjustZoom(newScale, position)
  }

  public zoomIn(position: { x: number; y: number }) {
    const f = 1.05
    this.debug.log('zoom', `zoomIn factor=${f} pivot=`, position)
    this.applyZoom(f, position)
  }

  public zoomOut(position: { x: number; y: number }) {
    const f = 1 / 1.05
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