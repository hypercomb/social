import { Injectable } from '@angular/core'
import { Assets, Sprite } from 'pixi.js'
import { BaseSpriteBuilder } from './image-sprite-base'
import { Cell } from 'src/app/models/cell'

@Injectable({
    providedIn: 'root',
})
export class SelectedTileSprite extends BaseSpriteBuilder<Cell> {
    public async build(cell: Cell): Promise<Sprite> {
        try {
            // Load the texture from the Blob URL
            const url = 'assets/hexagon-selection.png'
            const texture = await Assets.load({
                src: url,
                format: 'image/webp',
                parser: 'loadTextures',
            })


            // Create and configure the sprite
            const sprite = new Sprite(texture)
            this.configureSprite(sprite, {
                alpha: .5
            })

            sprite.zIndex = 6
            sprite.label = SelectedTileSprite.name
            return sprite
        } catch (error) {
            console.error('Failed to build ImageSprite:', error)
            throw error
        }
    }
}


