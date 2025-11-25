// src/app/actions/navigation/new-tile.action.ts
import { inject, Injectable } from "@angular/core"
import { ActionBase } from "../action.base"
import { CellPayload, PayloadBase } from "src/app/actions/action-contexts"
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

  public override enabled = async (_: PayloadBase): Promise<boolean> => {
    const parent = this.detector.activeCell()!
    if (!parent) return false

    // only when hive has zero children
    return parent.hasChildrenFlag !== 'true'
  }

  public override run = async (payload: PayloadBase) => {
    const parent = this.detector.activeCell()!
    if (!parent) return

    const imageHash = this.preloader.getInitialTileHash() ?? ""

    // build a simple centered tile
    const newTile = this.factory.newCell({
      name: "",
      index: 0,
      hive: parent.hive,
      sourceId: parent.cellId,
      hasChildrenFlag: "false",
      imageHash,
    })

    parent.x = 0
    parent.y = 0
    parent.scale = 1.2

    // center and make larger
    await this.modify.updateCell(parent)

    // persist + stage
    await this.modify.addCell(newTile)
    await this.modify.updateHasChildren(parent)

    // reset panning + center again
    this.panning.getSpacebar().cancelPanSession()
    this.panning.getTouch().cancelPanSession()

    const options = <CellPayload>{ ...payload, cell: parent }

    setTimeout(async () => {
      await this.registry.invoke(BranchAction.ActionId, options)
    }, 50)
  }
}