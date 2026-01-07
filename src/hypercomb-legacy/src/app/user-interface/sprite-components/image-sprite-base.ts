import { Sprite } from 'pixi.js'
import { SpriteBuilder } from './sprite-builder'

export abstract class BaseSpriteBuilder<T> extends SpriteBuilder<T> {

    // Common method for configuring shared properties
    protected configureSprite(sprite: Sprite, config?: Partial<Sprite>) {
        sprite.anchor.set(0.5, 0.5) // Default anchor
        sprite.zIndex = config?.zIndex ?? 1 // Default zIndex
        sprite.alpha = config?.alpha ?? 1 // Default alpha
        sprite.x = this.settings.hexagonOffsetX
        sprite.y = this.settings.hexagonOffsetY
        sprite.width = this.settings.width
        sprite.height = this.settings.height
    }
}


