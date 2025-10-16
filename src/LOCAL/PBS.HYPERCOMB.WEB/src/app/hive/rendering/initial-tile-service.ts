import { Injectable, inject } from "@angular/core"
import { FederatedPointerEvent, Assets } from "pixi.js"
import { fromRender } from "src/app/actions/action-contexts"
import { CellFactory } from "src/app/inversion-of-control/factory/cell-factory"
import { CellOptions } from "src/app/core/models/enumerations"
import { BlobService } from "./blob-service"
import { cacheId } from "src/app/cells/models/cell-filters"
import { DataServiceBase } from "src/app/actions/service-base-classes"
import { CenterTileService } from "src/app/cells/behaviors/center-tile-service"
import { TILE_FACTORY } from "src/app/shared/tokens/i-hypercomb.token"

@Injectable({
  providedIn: 'root'
})
export class InitialTileService extends DataServiceBase {
  private readonly blob = inject(BlobService)
  private readonly center = inject(CenterTileService)
  private readonly factory = {
    tile: inject(TILE_FACTORY),
    cell: inject(CellFactory),
  }

  private readonly initialTileScale = .8

  public render = async (): Promise<void> => {
    // create a cell with image using new factory style
    const cell = await this.factory.cell.create({
      sourcePath: "assets/guide-tile.png",
      index: 0,
      name: "Empty Tile",
      hive: this.hs.activeHive()?.name ?? "",
      options: CellOptions.Locked | CellOptions.InitialTile,
    })

    // wrap into a tile
    const tile = await this.factory.tile.create(cell)
    tile.scale.set(this.initialTileScale)

    tile.on("pointerup", async (event: FederatedPointerEvent) => {
      if (event.button !== 0) return
      event.stopPropagation()
      event.preventDefault()

      this.container.removeChild(tile)

      // fetch blob + clear cache
      cell.blob = await this.blob.getBlob(cell)
      Assets.cache.remove(cacheId(cell))

      // get action with context
      const context = fromRender(cell)
      const action = editTileAction()
      
      // cancel if not enabled
      if(!action.enabled(context)) return

      // run edit action
      await action.run(context)
    })

    this.container.addChild(tile)
    await this.center.arrange()
  }

}


