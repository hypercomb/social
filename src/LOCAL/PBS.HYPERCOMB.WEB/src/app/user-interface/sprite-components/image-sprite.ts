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

    // debug: show basic info
    this.debug?.log?.(
      'sprite',
      `image sprite build start: name=${cell.name} id=${cell.cellId} hash=${cell.imageHash} hasBlob=${!!cell.blob}`
    )

    let blob = cell.blob

    // if we don't have a blob, try to hydrate from opfs via hash
    if (!blob && cell.imageHash) {
      try {
        const small = await this.images.loadSmall(cell.imageHash)
        const large = small === null ? await this.images.loadLarge(cell.imageHash) : null
        blob = small ?? large ?? undefined

        if (blob) {
          cell.blob = blob
          this.debug?.log?.('sprite', `loaded blob from opfs for hash=${cell.imageHash}`)
        } else {
          this.debug?.warn?.('sprite', `no image found in opfs for hash=${cell.imageHash}`)
        }
      } catch (err) {
        this.debug?.warn?.('sprite', 'failed to load blob for hash', cell.imageHash, err)
      }
    }

    if (!blob) {
      // nothing to render, we return an empty sprite but log clearly
      this.debug?.warn?.(
        'sprite',
        `no blob available for cell: name=${cell.name} id=${cell.cellId} hash=${cell.imageHash}`
      )
      return sprite
    }

    try {
      const bitmap = await createImageBitmap(blob)
      sprite.texture = Texture.from(bitmap)
      this.debug?.log?.('sprite', `texture created for cell=${cell.name} id=${cell.cellId}`)
    } catch (err) {
      this.debug?.error?.('sprite', 'createImageBitmap failed', err)
    }

    return sprite
  }
}
