// src/app/inversion-of-control/factory/tile-factory.ts
import { Injectable, inject } from "@angular/core"
import { Point, Sprite } from "pixi.js"
import { PixiDataServiceBase } from "../../database/pixi-data-service-base"
import { Tile } from "../../cells/models/tile"
import { MaskComponent } from "../../user-interface/sprite-components/mask-component"
import { TextureService } from "../../user-interface/texture/texture-service"
import { Cell } from "src/app/cells/cell"
import { BlobService } from "src/app/hive/rendering/blob-service"
import { COMB_STORE } from "src/app/shared/tokens/i-comb-store.token"

@Injectable({ providedIn: 'root' })
export class TileFactory extends PixiDataServiceBase {

    private readonly mask = inject(MaskComponent)
    private readonly texture = inject(TextureService)
    private readonly store = inject(COMB_STORE)
    private readonly blob = inject(BlobService)

    public async create(cell: Cell): Promise<Tile> {
        if (cell.cellId == null) {
            throw new Error(`TileFactory.create requires a persisted Cell with a valid TileId`)
        }

        const tile = new Tile(cell)
        tile.eventMode = "static"

        // set initial position
        const { x, y } = this.pixi.getOffset(cell.index)
        tile.setPosition(new Point(x, y))

        // assign texture
        const texture = await this.texture.getTexture(cell)
        if (texture) tile.applyTexture(texture)

        // assign hex mask
        const mask = await this.mask.build()
        tile.mask = mask as Sprite
        tile.addChild(mask)

        // wire persistence updates
        tile.onPositionUpdate = ({ x, y, index }) => {
            this.store.updatePositionAndIndex(cell.cellId, new Point(x, y), index)
        }

        return tile
    }
}
