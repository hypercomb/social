import { Injectable, effect } from "@angular/core"
import { ColorSource, Graphics } from "pixi.js"
import { HypercombMode } from "src/app/core/models/enumerations"
import { PixiServiceBase } from "./pixi-service-base"

@Injectable({
    providedIn: 'root'
})
export class ContainerBackgroundService extends PixiServiceBase {

    private color: ColorSource = 0x000000
    private background?: Graphics = undefined

    constructor() {
        super()
        effect(() => {
            const mode = this.state.mode() // reacts whenever mode changes
            void this.setCursorColor(mode)
        })
    }

    private setCursorColor = async (mode: HypercombMode) => {
        let color: ColorSource = 0x000000 // Default color

        // Use bitwise checks to set the color based on mode
        if (mode & HypercombMode.Copy) {
            color = 0x047324 // Copy mode
        }
        if (mode & HypercombMode.Cut) {
            color = 0x1d3557 // Cut mode
        }
        if (mode & HypercombMode.EditMode) {
            color = 0x106ebe // Edit mode
        }
        if (mode & HypercombMode.Move) {
            color = 0xb11e30 // Move mode
        }
        if (mode & HypercombMode.ViewingClipboard) {
            color = 0x284b63 // Viewing Clipboard mode
        }
        if (mode & HypercombMode.Select) {
            color = 0x674a8c // Select mode
        }

        this.setColor(color)
        this.fill()
    }


    public setColor = (color: ColorSource) => {
        this.color = color
    }

    public fill = () => {
        let background = this.background
        if (background) {
            this.pixi.container!.removeChild(background)
        }

        // Create a new Graphics object and add it to the container
        background = new Graphics()

        // Set the fill color (e.g., 0xRRGGBB format) and draw a rectangle
        background.rect(-100000, -100000, 200000, 200000) // x, y, width, height
        background.fill(this.color) // Red color


        // Add the background at the first position
        this.pixi.container!.addChildAt(background, 0)
        this.background = background
    }

}


