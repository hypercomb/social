import { Injectable } from '@angular/core'
import { Assets, Container, Sprite } from 'pixi.js'
import { SpriteBuilder } from './sprite-builder'
import { LocalAssets } from 'src/app/helper/constants'

@Injectable({
    providedIn: 'root'
})
export class MaskComponent extends SpriteBuilder<void> {

    public override async build(): Promise<Container> {

        const texture = await Assets.load(LocalAssets.TileMask)
        const mask = new Sprite(texture)

        // Set positioning based on potentially configurable settings
        mask.anchor.set(0.5)
        mask.x = this.settings.hexagonOffsetX
        mask.y = this.settings.hexagonOffsetY
        mask.alpha = 1
        mask.zIndex = 100
        mask.label = MaskComponent.name
        return mask
    }
}


