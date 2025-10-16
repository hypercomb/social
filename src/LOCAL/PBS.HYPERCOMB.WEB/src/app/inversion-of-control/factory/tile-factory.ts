import { Injectable, inject } from "@angular/core"
import { Point, Sprite } from "pixi.js"
import { PixiDataServiceBase } from "../../database/pixi-data-service-base"
import { Tile } from "../../cells/models/tile"
import { MaskComponent } from "../../user-interface/sprite-components/mask-component"
import { TextureService } from "../../user-interface/texture/texture-service"
import { Cell } from "src/app/cells/cell"
import { BlobService } from "src/app/hive/rendering/blob-service"
import { COMB_STORE, STAGING_ST } from "src/app/shared/tokens/i-comb-store.token"
import { ITileFactory } from "src/app/shared/tokens/i-hypercomb.token"

@Injectable({ providedIn: 'root' })
export class TileFactory extends PixiDataServiceBase implements ITileFactory {

    private readonly mask = inject(MaskComponent)
    private readonly texture = inject(TextureService)
    private readonly store = inject(COMB_STORE)
    private readonly staging = inject(STAGING_ST)
    private readonly blob = inject(BlobService)

    // local cache of blobs by cellId
    private blobCache: Blob | undefined

    /**
     * Create a runtime Tile from persisted Cell.
     * Will throw if Cell.cellId is missing.
     */
    public async create(cell: Cell): Promise<Tile> {
        if (cell.cellId == null) {
            throw new Error(`TileFactory.create requires a persisted Cell with a valid TileId`)
        }
        const { cellId } = this.stack.top()!

        // clone the blob
        // ensure blob is set
        if (!cell.blob) {
            if (!this.blobCache) {
                this.blobCache = await this.blob.getInitialBlob()
            }
            cell.blob = this.blobCache
        }


        // build the Tile runtime object
        const tile = new Tile(cell)
        tile.eventMode = "static"

        // initial position from index
        const { x, y } = this.pixi.getOffset(cell.index)
        tile.setPosition(new Point(x, y))

        // assign SourceId if missing (link back to parent)
        if (!cell.sourceId) {
            cell.sourceId = cellId
        }

        const texture = await this.texture.getTexture(cell)

        if (texture) {
            tile.applyTexture(texture)
        }

        // ensure sprite mask
        const mask = await this.mask.build()
        tile.mask = mask as Sprite
        tile.addChild(mask)

        // auto-register runtime + persistence  
        this.staging.stageAdd(cell)
        this.store.register(tile, cell)

        // hook runtime store
        tile.onPositionUpdate = ({ x, y, index }) => {
            this.store.updatePositionAndIndex(cell.cellId, new Point(x, y), index)
        }

        return tile
    }
}
