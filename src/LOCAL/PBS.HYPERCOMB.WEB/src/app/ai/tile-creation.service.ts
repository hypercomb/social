import { Injectable, inject } from "@angular/core"
import { CELL_CREATOR, CELL_FACTORY } from "src/app/inversion-of-control/tokens/tile-factory.token"
import { MODIFY_COMB_SVC } from "src/app/shared/tokens/i-honeycomb-service.token"
import { PIXI_MANAGER } from "src/app/shared/tokens/i-pixi-manager.token"
import { Cell } from "src/app/models/cell-kind"
import { TILE_FACTORY } from "../shared/tokens/i-hypercomb.token"

@Injectable({ providedIn: "root" })
export class TileCreationService {

  private readonly creator = inject(CELL_CREATOR)
  private readonly modify = inject(MODIFY_COMB_SVC)
  private readonly pixi = inject(PIXI_MANAGER)
  private readonly tileFactory = inject(TILE_FACTORY)

  public async createTile(item: any, parent: Cell, index: number): Promise<string> {
    const ghost = await this.creator.createGhost({ index, hive: parent.hive })
    if (!ghost) return ""

    const ghostTile = await this.tileFactory.create(ghost as unknown as Cell)
    ghostTile.alpha = 0.6
    ghostTile.eventMode = "none"
    ghostTile.zIndex = 200

    const container = this.pixi.container
    if (container) {
      container.sortableChildren = true
      container.addChild(ghostTile)
    }

    const newCell = this.creator.newCell({
      name: item.name,
      index,
      hive: parent.hive,
      sourceId: parent.cellId,
      imageHash: ghost.imageHash
    })

    newCell.setKind("Cell")
    const saved = await this.modify.addCell(newCell)

    if (container && ghostTile.parent) {
      ghostTile.parent.removeChild(ghostTile)
      ghostTile.destroy({ children: true })
    }

    const finalTile = await this.tileFactory.create(saved)
    finalTile.alpha = 1
    finalTile.eventMode = "static"
    finalTile.zIndex = 200

    if (container) {
      container.addChild(finalTile)
      container.sortableChildren = true
    }

    return item.name
  }
}
