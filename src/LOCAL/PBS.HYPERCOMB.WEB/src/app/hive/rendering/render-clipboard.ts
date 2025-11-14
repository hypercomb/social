// actions/render-clipboard.command.ts
import { Injectable, inject } from "@angular/core"
import { PixiManager } from "src/app/pixi/pixi-manager"
import { CellFactory } from "src/app/inversion-of-control/factory/cell-factory"
import { ContextMenuService } from "src/app/navigation/menus/context-menu-service"
import { CellPayload } from "src/app/actions/action-contexts"
import { Action } from "src/app/actions/action-models"
import { Hypercomb } from "src/app/core/mixins/abstraction/hypercomb.base"
import { TILE_FACTORY } from "src/app/shared/tokens/i-hypercomb.token"

@Injectable({ providedIn: "root" })
export class RenderClipboardCommand extends Hypercomb implements Action<CellPayload> {
  public id = "clipboard.render"
  public label = "Render Clipboard"
  public description = "Render a cell while in clipboard mode"

  private readonly contextMenu = inject(ContextMenuService)
  private readonly tileHack = inject(TileBlobHack)
  private readonly tdFactory = inject(CellFactory)
  private readonly tileFactory = inject(TILE_FACTORY)
  private readonly pixiStartup = inject(PixiManager)


  public override enabled = (ctx: CellPayload): boolean => {
    return (
      this.state.isViewingClipboard &&
      !this.state.isMobile &&
      !!ctx.cell
    )
  }

  public run = async (ctx: CellPayload) => {
    // this.tileHack.fix(ctx.cell)

    // const cell = await this.tdFactory.create(ctx.cell)
    // const tile = await this.tileFactory.create(cell)

    // // allow hover, but block click/tap in clipboard
    // tile.eventMode = "static"
    // tile.cursor = "default"
    // tile.interactiveChildren = false

    // const stop = (e: any) => {
    //   e.preventDefault?.()
    //   e.stopPropagation?.()
    //   e.stopImmediatePropagation?.()
    // }

    // // strip any existing clickish handlers
    // tile.off("pointerdown")
    // tile.off("pointerup")
    // tile.off("pointertap")
    // tile.off("click")
    // tile.off("rightdown")
    // tile.off("rightup")

    // // block click/tap
    // tile.on("pointerdown", stop)
    // tile.on("pointerup", stop)
    // tile.on("pointertap", stop)
    // tile.on("click", stop)
    // tile.on("rightdown", stop)
    // tile.on("rightup", stop)

    // // optional hover-driven UI
    // tile.on("mouseenter", () => {
    //   this.state.log(`cell hovered: ${JSON.stringify(cell, null, 2)}`)
    //   this.contextMenu.show(tile)
    // })

    // ctx.container.addChild(tile)
  }
}
