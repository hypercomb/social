import { Injectable } from "@angular/core"
import { Sprite } from "pixi.js"
import { PixiServiceBase } from "./pixi-service-base"

@Injectable({ providedIn: 'root' })
export class ViewportService extends PixiServiceBase {
    
    async fitToScreen(sprites: Sprite[]) {
        if (sprites.length === 0) return

        // Calculate the bounding box of the selected sprites
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

        sprites.forEach(sprite => {
            const bounds = sprite.getBounds()
            minX = Math.min(minX, bounds.x)
            minY = Math.min(minY, bounds.y)
            maxX = Math.max(maxX, bounds.x + bounds.width)
            maxY = Math.max(maxY, bounds.y + bounds.height)
        })

        const boundingBoxWidth = maxX - minX
        const boundingBoxHeight = maxY - minY

        // Calculate the scale factor needed to fit the bounding box within the screen dimensions
        const scaleX = this.screen.width() / boundingBoxWidth
        const scaleY = this.screen.height() / boundingBoxHeight
        const scale = Math.min(scaleX, scaleY)

        // Apply the scale to the container
        const container = this.pixi.container!
        container.scale.set(scale)
        
        // Since we are omitting the centering part, no need to adjust container position
        // If needed, the centering logic can be handled elsewhere
    }
}


