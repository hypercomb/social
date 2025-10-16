import { Injectable, inject } from "@angular/core"
import { Tile } from "../models/tile"
import { HIVE_STORE } from "src/app/shared/tokens/i-hive-store.token"
import { COMB_STORE } from "src/app/shared/tokens/i-comb-store.token"
import { PixiDataServiceBase } from "src/app/database/pixi-data-service-base"

@Injectable({ providedIn: 'root' })
export class CenterTileService extends PixiDataServiceBase {
    private readonly store = { hive: inject(HIVE_STORE), comb: inject(COMB_STORE) }

    // Button click handler
    public arrange = async (tile?: Tile) => {
        if (tile) {
            await this.centerSprite([tile])
        }
        else {
            const tiles = this.store.comb.tiles()
            await this.centerSprite(tiles)
        }
    }

    private centerSprite = async (sprites: Tile[]) => {
        if (!sprites || sprites.length === 0) {
            return
        }

        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity

        sprites.forEach((sprite: Tile) => {
            const bounds = sprite.getBounds()
            minX = Math.min(minX, bounds.x)
            minY = Math.min(minY, bounds.y)
            maxX = Math.max(maxX, bounds.x + bounds.width)
            maxY = Math.max(maxY, bounds.y + bounds.height)
            this.debug.log('layout', `min: ${minX} max: ${maxX}`)
        })

        // Ensure the rectangle is drawn correctly
        await this.adjustPosition(minX, minY, maxX, maxY)
    }

    public adjustPosition = async (
        xMin: number,
        yMin: number,
        xMax: number,
        yMax: number
    ) => {
        const screenWidth = this.screen.windowWidth()
        const screenHeight = this.screen.windowHeight()

        // how much empty space is on each side of the bounding box
        const leftSpace = xMin
        const rightSpace = screenWidth - xMax
        const topSpace = yMin
        const bottomSpace = screenHeight - yMax

        // compute offsets to balance the empty space
        const offsetX = (rightSpace - leftSpace) / 2
        const offsetY = (bottomSpace - topSpace) / 2

        const comb = this.stack.top()?.cell!
        const container = this.pixi.container!

        container.x += offsetX
        container.y += offsetY

        // keep your cell model in sync with container’s transform
        comb.x = container.x
        comb.y = container.y
        this.modify.updateSilent(comb)
    }

}


