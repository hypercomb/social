import { Injectable, inject } from '@angular/core'
import { Sprite, Texture } from 'pixi.js'
import { BaseSpriteBuilder } from './image-sprite-base'
import { Cell } from 'src/app/cells/cell'
import { OpfsImageService } from 'src/app/hive/storage/opfs-image.service'

@Injectable({ providedIn: 'root' })
export class ImageSprite extends BaseSpriteBuilder<Cell> {
  private readonly images = inject(OpfsImageService)

  public async build(cell: Cell): Promise<Sprite> {
    const sprite = new Sprite()
    this.configureSprite(sprite)
    sprite.zIndex = 1
    sprite.label = ImageSprite.name

    this.debug?.log?.(
      'sprite',
      `image sprite build start: name=${cell.name} id=${cell.cellId} hash=${cell.imageHash}`
    )

    // ─────────────────────────────────────────────
    // 1. ensure hash exists
    // ─────────────────────────────────────────────
    if (!cell.imageHash) {
      this.debug?.warn?.(
        'sprite',
        `no imageHash on cell: name=${cell.name} id=${cell.cellId}`
      )
      return sprite
    }

    // ─────────────────────────────────────────────
    // 2. fastest load: try small first, then large
    // ─────────────────────────────────────────────
    let blob: Blob | null = null

    blob = (await this.images.loadSmall(cell.imageHash))!


    // ─────────────────────────────────────────────
    // 3. decode with ImageBitmap (fastest decode)
    // ─────────────────────────────────────────────
    try {
      const bitmap = await createImageBitmap(blob)
      sprite.texture = Texture.from(bitmap)

      this.debug?.log?.(
        'sprite',
        `texture created for cell=${cell.name} id=${cell.cellId}`
      )
    } catch (err) {
      this.debug?.error?.('sprite', 'createImageBitmap failed', err)
    }

    return sprite
  }
}
