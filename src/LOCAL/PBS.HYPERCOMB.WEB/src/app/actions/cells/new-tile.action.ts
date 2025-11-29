// src/app/actions/cells/new-tile.action.ts
import { inject, Injectable } from "@angular/core"
import { ActionBase } from "../action.base"
import { PayloadBase } from "src/app/actions/action-contexts"
import { CellFactory } from "src/app/inversion-of-control/factory/cell-factory"
import { PanningManager } from "src/app/pixi/panning-manager"
import { BranchAction } from "../navigation/branch.action"
import { ImagePreloader } from "src/app/hive/rendering/image-preloader.service"

@Injectable({ providedIn: "root" })
export class NewTileAction extends ActionBase<PayloadBase> {
  public static ActionId = "tile.new"
  public id = NewTileAction.ActionId
  public override label = "Create Tile"

  private readonly preloader = inject(ImagePreloader)
  private readonly factory = inject(CellFactory)
  private readonly panning = inject(PanningManager)


  public override enabled = async (payload: PayloadBase): Promise<boolean> => {
    // cannot create on top of an existing tile
    if (this.detector.activeTile()) return false

    const parent = this.stack.cell()
    if (!parent) return false

    // allow creation only on true empty coordinate
    return !!this.detector.emptyCoordinate()
  }


  public override run = async (payload: PayloadBase): Promise<void> => {
    const parent = this.stack.cell()
    if (!parent) return

    const ax = this.detector.emptyCoordinate()
    if (!ax) return

    const index = typeof ax.index === "number" ? ax.index : 0

    const newTile = this.factory.newCell({
      name: "",
        index,
        hive: parent.hive,
      sourceId: parent.cellId,
      hasChildrenFlag: "false",
      imageHash: this.preloader.getInitialTileHash() ?? "",
    })

    parent.x = 0
    parent.y = 0
    parent.scale = 1.2

    await this.modify.updateCell(parent)
    await this.modify.addCell(newTile)
    await this.modify.updateHasChildren(parent)

    this.panning.getSpacebar().cancelPanSession()
    this.panning.getTouch().cancelPanSession()

    await this.registry.invoke(BranchAction.ActionId, { ...payload, cell: parent })
  }

}
