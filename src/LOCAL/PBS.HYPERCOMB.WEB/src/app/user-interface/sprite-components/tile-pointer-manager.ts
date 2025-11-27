// src/app/user-interface/sprite-components/tile-pointer-manager.ts
import { Injectable, inject } from "@angular/core"
import { FederatedPointerEvent } from "pixi.js"
import { ACTION_REGISTRY } from "src/app/shared/tokens/i-hypercomb.token"
import { POLICY } from "src/app/core/models/enumerations"
import { PolicyService } from "src/app/navigation/menus/policy-service"
import { NewTileAction } from "src/app/actions/cells/new-tile.action"
import { ViewPhotoAction } from "src/app/actions/cells/view-photo"
import { BranchAction } from "src/app/actions/navigation/branch.action"
import { PayloadBase } from "src/app/actions/action-contexts"
import { TileSelectionManager } from "src/app/cells/selection/tile-selection-manager"
import { SelectionMoveManager } from "src/app/cells/selection/selection-move-manager"
import { Cell } from "src/app/cells/cell"
import { ContextMenuService } from "src/app/navigation/menus/context-menu-service"
import { OpenLinkAction } from "src/app/actions/navigation/open-link"

@Injectable({ providedIn: "root" })
export class TilePointerManager {
  private readonly policy = inject(PolicyService)
  private readonly registry = inject(ACTION_REGISTRY)
  private readonly selection = inject(TileSelectionManager)
  private readonly moveManager = inject(SelectionMoveManager)
  private readonly menu = inject(ContextMenuService)

  private readonly moveModeSignal = this.policy.all(POLICY.MovingTiles)
  private isMoveMode = (): boolean => this.moveModeSignal()

  private readonly leftActions = [
    inject(BranchAction),
    inject(NewTileAction),
    inject(OpenLinkAction),
    inject(ViewPhotoAction),
  ] as const

  public attach(tile: any, cell: Cell): void {
    tile.eventMode = "static"
    tile.removeAllListeners("pointertap")
    tile.removeAllListeners("pointerdown")
    tile.removeAllListeners("pointerenter")
    tile.removeAllListeners("pointerleave")

    tile.on("pointertap", async (event: FederatedPointerEvent) => {
      const btn = event.button
      if (btn !== undefined && btn !== 0) return
      if (this.isMoveMode()) return

      if (event.ctrlKey || event.metaKey) {
        this.selection.handleTap(cell, event as unknown as PointerEvent)
        return
      }

      await this.dispatch(this.leftActions, cell, event as unknown as PointerEvent)
    })

    tile.on("pointerdown", (event: FederatedPointerEvent) => {
      if (event.button !== 0 || event.pointerType !== "mouse") return
      const ctrl = event.ctrlKey || event.metaKey
      const move = this.isMoveMode()

      if (ctrl) {
        this.selection.beginDrag(cell, event as unknown as PointerEvent)
        event.stopPropagation()
        return
      }

      if (move) {
        this.moveManager.beginDrag(cell, event as unknown as PointerEvent)
        event.stopPropagation()
        return
      }
    })

    tile.on("pointerenter", (event: FederatedPointerEvent) => {
      const ctrl = event.ctrlKey || event.metaKey
      if (ctrl) {
        this.selection.hoverDrag(cell)
        return
      }
      if (!this.isMoveMode()) this.menu.tileEnter(cell)
    })

    tile.on("pointerleave", (_event: FederatedPointerEvent) => {
      this.menu.tileLeave()
    })
  }

  private async dispatch(actions: readonly { id: string }[], cell: Cell, event: PointerEvent) {
    const payload = <PayloadBase>{ kind: "cell", cell, event }
    for (const action of actions) {
      if (await this.registry.invoke(action.id, payload)) return
    }
  }
}
