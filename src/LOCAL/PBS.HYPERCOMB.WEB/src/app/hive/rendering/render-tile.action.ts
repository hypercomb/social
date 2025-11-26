// src/app/actions/render/render-tile.action.ts
import { Injectable, inject } from "@angular/core"
import { ActionBase } from "src/app/actions/action.base"
import { CellPayload, PayloadBase } from "src/app/actions/action-contexts"
import { ContextMenuService } from "src/app/navigation/menus/context-menu-service"
import { PixiManager } from "src/app/pixi/pixi-manager"
import { Container } from "pixi.js"
import { TILE_FACTORY } from "src/app/shared/tokens/i-hypercomb.token"
import { TilePointerManager } from "src/app/user-interface/sprite-components/tile-pointer-manager"

@Injectable({ providedIn: "root" })
export class RenderTileAction extends ActionBase<CellPayload> {
  public static ActionId = "tile.render"
  public id = RenderTileAction.ActionId
  
  public override label = "Render Tile"

  private readonly contextMenu = inject(ContextMenuService)
  private readonly factory = inject(TILE_FACTORY)
  private readonly pixi = inject(PixiManager)
  private readonly pointer = inject(TilePointerManager)
  private readonly layers = new Map<number, Container>()

  constructor() {
    super()

    this.ps.onHover(() => {
      const cell = this.detector.activeCell()
      if (cell) this.contextMenu.show(cell)
    })
  }

  public override enabled = async ({ cell }: CellPayload): Promise<boolean> => {
    if (!cell) return false
    if (cell.kind === "Hive") return false
    return !this.state.cancelled()
  }

  public run = async ({ cell }: CellPayload): Promise<void> => {
    if (!cell?.cellId) return

    const layerIndex = (cell as any).layerIndex ?? 0
    const layer = this.getLayer(layerIndex)

    // build tile
    const tile = await this.factory.create(cell)

    // 👉 attach pointer routing (left + right click)
    this.pointer.attach(tile, cell)

    // mount
    layer.addChild(tile)

    // register
    this.combstore.register(tile, cell)
  }

  private getLayer = (layerIndex: number): Container => {
    let layer = this.layers.get(layerIndex)
    if (!layer) {
      layer = new Container()
      layer.sortableChildren = true
      layer.zIndex = layerIndex
      this.pixi.container.addChild(layer)
      this.layers.set(layerIndex, layer)
    }
    return layer
  }
}
