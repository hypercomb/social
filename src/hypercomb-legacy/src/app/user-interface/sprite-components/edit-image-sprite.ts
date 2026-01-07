import { Injectable } from '@angular/core'
import { Sprite, Texture } from 'pixi.js'
import { BaseSpriteBuilder } from './image-sprite-base'
import { IHiveImage } from 'src/app/core/models/i-hive-image'
import { SpriteViewer } from 'src/app/helper/sprite-visualizer'

@Injectable({
  providedIn: 'root'
})
export class EditImageSprite extends BaseSpriteBuilder<IHiveImage> {

  public async build(image: IHiveImage): Promise<Sprite> {
    try {
      // decode blob to ImageBitmap
      const bitmap = await createImageBitmap(image.blob)

      // create texture directly from bitmap (fast and avoids blob URL)
      const texture = Texture.from(bitmap)

      // create and configure sprite
      const sprite = new Sprite(texture)
      this.configureSprite(sprite, {})
      sprite.x = (image.x || 0) + this.settings.hexagonOffsetX
      sprite.y = (image.y || 0) + this.settings.hexagonOffsetY
      sprite.scale.set(image.scale || 1, image.scale || 1)
      sprite.zIndex = 1
      sprite.label = EditImageSprite.name

      return sprite
    } catch (error) {
      console.error('Failed to build EditImageSprite:', error)
      throw error
    }
  }
}
