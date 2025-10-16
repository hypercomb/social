// src/app/sprites/tile-image-sprite-builder.ts
import { Injectable } from '@angular/core'
import { Assets, Sprite } from 'pixi.js'
import { SpriteBuilder } from './sprite-builder'
import { Cell } from 'src/app/cells/cell'

@Injectable({ providedIn: 'root' })
export class TileImageSpriteBuilder extends SpriteBuilder<Cell> {
    public override async build(cell: Cell): Promise<Sprite> {
        const sprite = new Sprite()

        if (!cell.blob) return sprite

        const blobUrl = URL.createObjectURL(cell.blob)
        const texture = await Assets.load({ src: blobUrl, format: 'image/webp' })
        sprite.texture = texture

        sprite.zIndex = 1
        sprite.label = 'TileImageSprite'

        return sprite
    }
}


