import { Injectable, inject } from "@angular/core"
import { Point } from "pixi.js"
import { LayoutState } from "../layout/layout-state"
import { PixiDataServiceBase } from "../database/pixi-data-service-base"

@Injectable({ providedIn: 'root' })
export class ZoomService extends PixiDataServiceBase {
    private readonly ls = inject(LayoutState)

    private minScale: number = this.ls.minScale
    private maxScale: number = this.ls.maxScale

    private canZoom(): boolean {
        return true
    }

    // zoom-service.ts
    private adjustZoom = async (
        newScale: number,
        position: { x: number; y: number } = new Point(0, 0)
    ): Promise<void> => {
        const container = this.pixi.container!
        const comb = this.stack.top()?.cell!
        const { x: px, y: py } = position

        // 1) capture the point in container-local space before scaling
        const preLocal = container.toLocal(new Point(px, py))

        // 2) apply the new uniform scale
        container.scale.set(newScale)

        // 3) where did that local point end up globally after scaling?
        const postGlobal = container.toGlobal(preLocal)

        // 4) shift container so the zoom pivots around (px, py)    
        container.position.set(
            container.x + (px - postGlobal.x),
            container.y + (py - postGlobal.y)
        )

        // keep your domain model in sync
        comb.scale = newScale
        comb.x = container.x
        comb.y = container.y

        await this.saveTransform()
    }


    public applyZoom(scaleAmount: number, position: { x: number, y: number } = new Point(0, 0)) {
        if (!this.canZoom()) return

        const container = this.pixi.container!
        let newScale = container.scale.x * scaleAmount
        newScale = Math.min(Math.max(newScale, this.minScale), this.maxScale)

        this.adjustZoom(newScale, position)
    }

    public setZoom(zoomValue: number, position: { x: number, y: number } = new Point(0, 0)) {
        if (!this.canZoom()) return

        const newScale = Math.min(Math.max(zoomValue, this.minScale), this.maxScale)
        this.adjustZoom(newScale, position)
    }

    public zoomIn(position: { x: number, y: number }) {
        const scaleAmount = 1.05 // Zoom in factor
        this.applyZoom(scaleAmount, position)
    }

    public zoomOut(position: { x: number, y: number }) {
        const scaleAmount = 1 / 1.05 // Zoom out factor
        this.applyZoom(scaleAmount, position)
    }

    public reset() {
        const location = this.screen.getWindowCenter()
        this.applyZoom(.5, location)
    }

    public get currentScale(): number {
        return this.pixi.container?.scale.x ?? 1;
    }
}


