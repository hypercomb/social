import { Injectable } from '@angular/core'
import { Assets, Sprite } from 'pixi.js'
import { SpriteBuilder } from './sprite-builder'
import { Cell } from 'src/app/cells/cell'

@Injectable({
    providedIn: 'root'
})
export class BranchOverlaySprite extends SpriteBuilder<Cell> {

    public override build = async (): Promise<Sprite> => {
        const { width, height } = this.settings.hexagonDimensions

        const location = 'assets/branch-overlay.svg'
        const texture = await Assets.load(location)

        let sprite = Sprite.from(texture)
        sprite.x = 0
        sprite.y = 0
        sprite.width = width
        sprite.height = height
        sprite.zIndex = 2
        sprite.label = BranchOverlaySprite.name
        return sprite

    }
}

