import { Injectable, effect } from "@angular/core"
import { Point } from "pixi.js"
import { PanningServiceBase } from "./panning-service.base"

@Injectable({ providedIn: "root" })
export class MousePanningService extends PanningServiceBase {
    private anchorVecX = 0
    private anchorVecY = 0
    private startPosX = 0
    private startPosY = 0

    constructor() {
        super()

        // 🔹 spacebar pressed → capture anchor immediately
        effect(() => {
            const space = this.keyboard.spaceDown()
            if (!space) {
                this.clearAnchor()
                this.setActive(false)
                return
            }

            const down = this.ps.pointerDownEvent() ?? this.ps.pointerMoveEvent()
            const container = this.pixi.container
            const app = this.pixi.app
            if (!down || !container || !app) return
            const parent = container.parent ?? container

            const currGlobal = this.domToGlobal(down)
            const centerGlobal = this.canvasCenterGlobal()
            const pointerLocal = parent.worldTransform.applyInverse(currGlobal, new Point())
            const centerLocal = parent.worldTransform.applyInverse(centerGlobal, new Point())

            this.anchorVecX = pointerLocal.x - centerLocal.x
            this.anchorVecY = pointerLocal.y - centerLocal.y
            this.startPosX = container.position.x
            this.startPosY = container.position.y
            this.crossed = false
            this._cancelled.set(false)
            this.navigation.cancelled = false
            this.anchored = true
            this.setActive(true)
        })

        // 🔹 pointer move while space held
        effect(() => {
            if (!this.enabled()) return

            if (this.ps.moveSeq() === 0) return
            const move = this.ps.pointerMoveEvent()
            if (!move || !this.keyboard.spaceDown() || this.manager.locked()) return
            const container = this.pixi.container
            const app = this.pixi.app
            if (!container || !app || !this.anchored) return
            const parent = container.parent ?? container

            const currGlobal = this.domToGlobal(move)
            const centerGlobal = this.canvasCenterGlobal()
            const pointerLocal = parent.worldTransform.applyInverse(currGlobal, new Point())
            const centerLocal = parent.worldTransform.applyInverse(centerGlobal, new Point())

            const currVecX = pointerLocal.x - centerLocal.x
            const currVecY = pointerLocal.y - centerLocal.y
            const dX = currVecX - this.anchorVecX
            const dY = currVecY - this.anchorVecY

            const scaleX = parent.worldTransform.a
            const scaleY = parent.worldTransform.d
            const nextX = this.startPosX + dX / scaleX
            const nextY = this.startPosY + dY / scaleY

            container.position.set(nextX, nextY)
        })

        // 🔹 pointer up → save + clear
        effect(() => {
            if (this.ps.upSeq() === 0) return
            this.saveTransform()
            this.clearAnchor()
            this.setActive(false)
        })
    }

    protected override onPixiReady(): void {
        this.safeInit()
    }
}
