// src/app/sprites/imported-image-sprite-builder.ts
import { Injectable } from '@angular/core'
import { Assets, Sprite } from 'pixi.js'
import { SpriteBuilder } from './sprite-builder'
import { IHiveImage } from 'src/app/core/models/i-hive-image'

@Injectable({ providedIn: 'root' })
export class ImportedImageSpriteBuilder extends SpriteBuilder<IHiveImage> {
    public override async build(image: IHiveImage): Promise<Sprite> {
        const url = URL.createObjectURL(image.blob)
        const texture = await Assets.load({ src: url, format: 'image/webp' })

        const sprite = new Sprite(texture)
        sprite.x = (image.x ?? 0)
        sprite.y = (image.y ?? 0)
        sprite.scale.set(image.scale ?? 1)
        sprite.zIndex = 1
        sprite.label = 'ImportedImageSprite'

        return sprite
    }
}


