import { Injectable, Injector } from "@angular/core"
import { Container, Sprite } from "pixi.js"
import { HiveEvents } from "src/app/unsorted/constants"
import { AxialCoordinate } from "src/app/core/models/axial-coordinate"
import { LayoutState } from "src/app/state/layout-state"
import { PixiServiceBase } from "../services/pixi/pixi-service-base"

@Injectable({ providedIn: 'root' })
export class DragIndicatorService extends PixiServiceBase {
    private dragIndicator?: Sprite
    public get container(): Container { return this.container }

    constructor(
        injector: Injector,
        private layout: LayoutState) {
        super(injector)
        document.addEventListener(HiveEvents.EscapeCancelEvent, (e: any) => {
            this.removeDragIndicator()
        })

        document.addEventListener(HiveEvents.HexagonDropped, () => {
            this.removeDragIndicator()
        })
    }

    public addDragIndicator = async (axial: AxialCoordinate) => {
        this.removeDragIndicator()
        this.dragIndicator = await this.createDragIndicator(axial)
        this.container.addChild(this.dragIndicator!)
    }

    public removeDragIndicator = () => {
        if (this.dragIndicator) {
            this.container.removeChild(this.dragIndicator)
            this.dragIndicator.destroy()
            this.dragIndicator = undefined
        }
    }

    private createDragIndicator = (axial: AxialCoordinate): Sprite => {

        //const url = this.urlService.getFromSource()D
        const url = 'assets/svg/drag-target.svg'

        const x = (axial?.Location.x || 0) + this.screen.width / 2
        const y = (axial?.Location.y || 0) + this.screen.height / 2

        // Create the sprite using the image path
        const shadowSprite = Sprite.from(url)
        shadowSprite.eventMode = 'dynamic'

        // Set the initial position and anchor
        shadowSprite.position.set(x, y)
        shadowSprite.anchor.set(0.5) // Assuming you want the center of the hexagon
        shadowSprite.alpha = 1 // Set the desired transparency for the shadow

        const { width, height } = this.settings.hexagonDimensions

        shadowSprite.texture.on('update', () => {
            // Adjust the sprite's size and position after the texture is loaded

            shadowSprite.width = width
            shadowSprite.height = height
        })

        // this.addDropShadow(shadowSprite)
        // this.addGlow(shadowSprite)
        return shadowSprite
    }
}


