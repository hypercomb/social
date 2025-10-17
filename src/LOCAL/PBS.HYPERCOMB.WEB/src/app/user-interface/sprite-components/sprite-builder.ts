// src/app/sprites/sprite-builder.ts
import { Container } from 'pixi.js'
import { Hypercomb } from 'src/app/core/mixins/abstraction/hypercomb.base'

/**
 * abstract contract for sprite builders
 * keeps the API consistent across all implementations
 */
export abstract class SpriteBuilder<T> extends Hypercomb {
    /** optionally decide if we can build this type */
    public async canBuild(_params: T): Promise<boolean> {
        return true
    }

    /** build a sprite for the given params */
    public abstract build(_params: T, url?: string): Promise<Container>
}


