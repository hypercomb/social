import { Injectable } from '@angular/core'
import { LayoutState } from 'src/app/state/layout-state'
import { Tile } from 'src/app/cells/models/tile'

@Injectable({
    providedIn: 'root'
})
export class CenterSpriteLocator {
    constructor(private layout: LayoutState) { }

    public findCenterSprite(): Tile | null {
        const container = this.container


        if (!container || !container.children || container.children.length === 0) {
            console.error('Container or container children are not defined or empty.')
            return null
        }

        // Initialize variables to store the extreme positions
        let leftMost = Number.MAX_VALUE
        let rightMost = Number.MIN_VALUE
        let topMost = Number.MAX_VALUE
        let bottomMost = Number.MIN_VALUE

        // Iterate over children to find the extreme edges
        container.children.forEach((sprite: any) => {
            if (sprite.data) {
                const { x, y, width, height } = sprite

                if (x < leftMost) leftMost = x
                if (x + width > rightMost) rightMost = x + width
                if (y < topMost) topMost = y
                if (y + height > bottomMost) bottomMost = y + height
            }
        })

        // Calculate the center point
        const centerX = (leftMost + rightMost) / 2
        const centerY = (topMost + bottomMost) / 2

        // Find the sprite closest to the center point
        let closestSprite = null
        let minDistance = Number.MAX_VALUE

        container.children.forEach((sprite: any) => {
            if (sprite.data) {
                const { x, y, width, height } = sprite
                const spriteCenterX = x + width / 2
                const spriteCenterY = y + height / 2

                const distance = Math.sqrt(Math.pow(spriteCenterX - centerX, 2) + Math.pow(spriteCenterY - centerY, 2))

                if (distance < minDistance) {
                    minDistance = distance
                    closestSprite = sprite
                }
            }
        })

        if (closestSprite) {
            this.debug.log('tiles', `found at :${CenterSpriteLocator.name}`)
        }
        return closestSprite
    }
}


