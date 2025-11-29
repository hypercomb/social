import { Injectable } from '@angular/core'
import { Graphics } from 'pixi.js'
import { SpriteBuilder } from './sprite-builder'
import { Cell } from 'src/app/cells/cell'
import { DebugService } from 'src/app/core/diagnostics/debug-service'

@Injectable({
    providedIn: 'root'
})
export class BackgroundGraphic extends SpriteBuilder<Cell> {

    public override build = async (data: Cell): Promise<Graphics> => {
        DebugService.expose('background-graphic', this)

        // Set up white background using Graphics
        const { width, height } = this.settings.hexagonDimensions
        const color = data.backgroundColor || 'transparent'

        const whiteBg = new Graphics()
        whiteBg.rect(0, 0, width, height)
        whiteBg.fill(color)

        whiteBg.alpha = 1
        whiteBg.x = 0
        whiteBg.y = 0
        whiteBg.zIndex = 0
        whiteBg.label = BackgroundGraphic.name
        return whiteBg
    }

    public override canBuild = async (cell: Cell): Promise<boolean> => {
        return !!cell.backgroundColor
    }
}


