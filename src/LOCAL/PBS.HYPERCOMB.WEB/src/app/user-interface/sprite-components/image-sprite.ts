﻿import { Injectable } from '@angular/core'
import { Sprite, Texture } from 'pixi.js'
import { cacheId } from '../../cells/models/cell-filters'
import { BaseSpriteBuilder } from './image-sprite-base'
import { Cell } from 'src/app/cells/cell'

@Injectable({
    providedIn: 'root'
})
export class ImageSprite extends BaseSpriteBuilder<Cell> {
    private static count = 0
    public async build(cell: Cell): Promise<Sprite> {
        try {
            const bitmap = await createImageBitmap(cell.blob!)

            // Create and configure the sprite
            const sprite = new Sprite()
            this.configureSprite(sprite)
            sprite.zIndex = 1
            sprite.label = ImageSprite.name

            if (!cell.blob) return sprite

            this.debug.log('render', `ImageSprite: building sprite for tile: ${cell.name} (${cacheId(cell)}) ${++ImageSprite.count}`)

            // Load the texture from the Blob URL
            const texture = await Texture.from(bitmap)
            sprite.texture = texture
            return sprite
        } catch (error) {
            console.error('Failed to build ImageSprite:', error)
            throw error
        }
    }
    
}


