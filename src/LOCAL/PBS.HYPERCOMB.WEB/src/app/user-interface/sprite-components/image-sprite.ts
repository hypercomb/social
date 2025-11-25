// src/app/user-interface/sprite-components/image-sprite.ts
import { Injectable, inject } from '@angular/core'
import { Assets, Sprite, Texture } from 'pixi.js'
import { BaseSpriteBuilder } from './image-sprite-base'
import { Cell } from 'src/app/cells/cell'
import { OpfsImageService } from 'src/app/hive/storage/opfs-image.service'

@Injectable({ providedIn: 'root' })
export class ImageSprite extends BaseSpriteBuilder<Cell> {
  private readonly images = inject(OpfsImageService)

  // cache key helper for raw image textures
  private getImageCacheKey = (hash: string): string => `img:${hash}`

  public async build(cell: Cell): Promise<Sprite> {
    const sprite = new Sprite()
    this.configureSprite(sprite)
    sprite.zIndex = 1
    sprite.label = ImageSprite.name

    this.debug?.log?.(
      'sprite',
      `image sprite build start: name=${cell.name} id=${cell.cellId} hash=${cell.imageHash}`
    )

    // 1. ensure hash exists
    if (!cell.imageHash) {
      this.debug?.warn?.(
        'sprite',
        `no imageHash on cell: name=${cell.name} id=${cell.cellId}`
      )
      return sprite
    }

    const hash = cell.imageHash
    const key = this.getImageCacheKey(hash)

    // 2. fastest path: use preloaded texture if available
    const cached = Assets.cache.get(key) as Texture | undefined
    if (cached) {
      sprite.texture = cached
      this.debug?.log?.(
        'sprite',
        `texture from cache for cell=${cell.name} id=${cell.cellId}`
      )
      return sprite
    }

    // 3. fallback: load blob and decode, then cache for next time
    try {
      const blob = await this.images.loadSmall(hash)
      if (!blob) {
        this.debug?.warn?.(
          'sprite',
          `no blob resolved for hash=${hash} (cell=${cell.name} id=${cell.cellId})`
        )
        return sprite
      }

      const bitmap = await createImageBitmap(blob)
      const texture = Texture.from(bitmap)

      Assets.cache.set(key, texture)
      sprite.texture = texture

      this.debug?.log?.(
        'sprite',
        `texture created + cached for cell=${cell.name} id=${cell.cellId}`
      )
    } catch (err) {
      this.debug?.error?.('sprite', 'createImageBitmap or loadSmall failed', err)
    }

    return sprite
  }
}
