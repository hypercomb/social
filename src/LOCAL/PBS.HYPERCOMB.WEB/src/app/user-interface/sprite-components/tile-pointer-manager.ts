// src/app/user-interface/sprite-components/tile-pointer-manager.ts
import { Injectable, inject } from "@angular/core"
import { ACTION_REGISTRY } from "src/app/shared/tokens/i-hypercomb.token"
import { POLICY } from "src/app/core/models/enumerations"
import { PolicyService } from "src/app/navigation/menus/policy-service"
import { NewTileAction } from "src/app/actions/cells/new-tile.action"
import { ViewPhotoAction } from "src/app/actions/cells/view-photo"
import { BranchAction } from "src/app/actions/navigation/branch.action"
import { RiftAction } from "src/app/actions/navigation/path"
import { PayloadBase } from "src/app/actions/action-contexts"
import { TileSelectionManager } from "src/app/cells/selection/tile-selection-manager"
import { SelectionMoveManager } from "src/app/cells/selection/selection-move-manager"
import { Cell } from "src/app/cells/cell"
import { ContextMenuService } from "src/app/navigation/menus/context-menu-service"

@Injectable({ providedIn: "root" })
export class TilePointerManager {
  private readonly policy = inject(PolicyService)
  private readonly registry = inject(ACTION_REGISTRY)
  private readonly selection = inject(TileSelectionManager)
  private readonly moveManager = inject(SelectionMoveManager)
  private readonly menu = inject(ContextMenuService)

  // policy helper (still works whether .all returns a signal or fn)
  private readonly moveModeSignal = this.policy.all(POLICY.MovingTiles)
  private isMoveMode = (): boolean => this.moveModeSignal()

  // actions (navigation, edit, etc.)
  private readonly leftActions = [
    inject(BranchAction),
    inject(NewTileAction),
    inject(RiftAction),
    inject(ViewPhotoAction),
  ] as const

  // --------------------------------------------------------------------
  // attach events to the tile instance (called from RenderTileAction)
  // --------------------------------------------------------------------
  public attach(tile: any, cell: Cell): void {
    // make sure tile actually receives pointer events
    tile.eventMode = "static"

    // avoid stacking multiple handlers if attach is called repeatedly
    tile.removeAllListeners("pointertap")
    tile.removeAllListeners("pointerdown")
    tile.removeAllListeners("pointerenter")
    tile.removeAllListeners("pointerleave")
    // ------------------------------------------------------------------
    // pointertap = primary behavior
    // ------------------------------------------------------------------
    tile.on("pointertap", async (event: PointerEvent) => {
      // move mode: tiles are move handles only, no nav / actions
      if (this.isMoveMode()) {
        return
      }

      // ctrl/meta → selection only, no actions
      if (event.ctrlKey || event.metaKey) {
        // use your existing selection logic, but ONLY when ctrl/meta is down
        this.selection.handleTap(cell, event)
        return
      }

      // normal click: NO selection, ONLY actions (navigation / edit)
      await this.dispatch(this.leftActions, cell, event)
    })

    // ------------------------------------------------------------------
    // pointerdown: move mode or starting ctrl/meta drag-select
    // ------------------------------------------------------------------
    tile.on("pointerdown", (event: PointerEvent) => {
      if (event.button !== 0 || event.pointerType !== "mouse") return

      const ctrl = event.ctrlKey || event.metaKey
      const move = this.isMoveMode()

      // allow ctrl selection even in move mode
      if (ctrl) {
        this.selection.beginDrag(cell, event)
        event.stopPropagation()
        return
      }

      if (move) {
        this.moveManager.beginDrag(cell, event)
        event.stopPropagation()
        return
      }
    })


    // ------------------------------------------------------------------
    // pointerenter: only used for ctrl/meta drag-select (not in move mode)
    // ------------------------------------------------------------------
    tile.on("pointerenter", (event: PointerEvent) => {
      const ctrl = event.ctrlKey || event.metaKey
      if (ctrl) {
        this.selection.hoverDrag(cell)
        return
      }

      if (!this.isMoveMode()) this.menu.show(cell)
    })


    tile.on("pointerleave", async (event: PointerEvent) => {
      await this.menu.hide()
    })
  }

  private async dispatch(actions: readonly { id: string }[], cell: Cell, event: PointerEvent) {
    const payload = <PayloadBase>{ kind: "cell", cell, event }

    for (const action of actions) {
      if (await this.registry.invoke(action.id, payload)) return
    }
  }
}
