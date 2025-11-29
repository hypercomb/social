// src/app/actions/render/render-tile.action.ts
import { Injectable, inject } from "@angular/core"
import { ActionBase } from "src/app/actions/action.base"
import { CellPayload } from "src/app/actions/action-contexts"
import { Container } from "pixi.js"
import { TILE_FACTORY } from "src/app/shared/tokens/i-hypercomb.token"
import { TilePointerManager } from "src/app/user-interface/sprite-components/tile-pointer-manager"
import { PIXI_MANAGER } from "src/app/shared/tokens/i-pixi-manager.token"

@Injectable({ providedIn: "root" })
export class RenderTileAction extends ActionBase<CellPayload> {
  public static ActionId = "tile.render"
  public id = RenderTileAction.ActionId

  public override label = "Render Tile"

  private readonly factory = inject(TILE_FACTORY)
  private readonly pixi = inject(PIXI_MANAGER)
  private readonly pointer = inject(TilePointerManager)
  private readonly layers = new Map<number, Container>()

  public override enabled = async ({ cell }: CellPayload): Promise<boolean> => {
    if (!cell) return false
    if (cell.kind === "Hive") return false
    return !this.state.cancelled()
  }

  public run = async ({ cell }: CellPayload): Promise<void> => {
    if (!cell?.cellId) return

    // 🚫 never render the context tile (stack top)
    const ctx = this.stack.cell()
    if (ctx && ctx.cellId === cell.cellId) return

    const layerIndex = (cell as any).layerIndex ?? 0
    const layer = this.getLayer(layerIndex)

    const tile = await this.factory.create(cell)
    this.pointer.attach(tile, cell)
    layer.addChild(tile)
    this.combstore.register(tile, cell)
  }


  private getLayer = (layerIndex: number): Container => {
    let layer = this.layers.get(layerIndex)
    if (!layer) {
      layer = new Container()
      layer.sortableChildren = true
      layer.zIndex = layerIndex
      this.pixi.container!.addChild(layer)
      this.layers.set(layerIndex, layer)
    }
    return layer
  }
}
