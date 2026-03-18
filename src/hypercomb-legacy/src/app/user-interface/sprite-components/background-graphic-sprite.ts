import { Injectable } from '@angular/core'
import { Graphics } from 'pixi.js'
import { SpriteBuilder } from './sprite-builder'
import { DebugService } from 'src/app/core/diagnostics/debug-service'
import { Cell } from 'src/app/models/cell'

@Injectable({
    providedIn: 'root'
})
export class BackgroundGraphic extends SpriteBuilder<Cell> {

    public override build = async (data: Cell): Promise<Graphics> => {
        DebugService.expose('background-graphic', this)

        const { width, height } = this.settings.hexagonDimensions
        const color = data.backgroundColor || 'transparent'

        // Draw a point-top hexagon so the fill aligns with the hex clip shape
        const cx = width / 2
        const cy = height / 2
        const r = height / 2
        const verts: number[] = []
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i - Math.PI / 6
            verts.push(cx + r * Math.cos(angle))
            verts.push(cy + r * Math.sin(angle))
        }

        const bg = new Graphics()
        bg.poly(verts, true)
        bg.fill(color)

        bg.alpha = 1
        bg.x = 0
        bg.y = 0
        bg.zIndex = 0
        bg.label = BackgroundGraphic.name
        return bg
    }

    public override canBuild = async (cell: Cell): Promise<boolean> => {
        return !!cell.backgroundColor
    }
}
