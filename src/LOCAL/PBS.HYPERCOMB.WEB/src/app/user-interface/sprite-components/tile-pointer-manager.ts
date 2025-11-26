// src/app/state/input/tile-pointer-manager.ts
import { Injectable, inject } from "@angular/core"
import { ACTION_REGISTRY } from "src/app/shared/tokens/i-hypercomb.token"
import { POLICY } from "src/app/core/models/enumerations"
import { PolicyService } from "src/app/navigation/menus/policy-service"
import { SelectionMoveManager } from "src/app/cells/selection/selection-move-manager"
import { NewTileAction } from "src/app/actions/cells/new-tile.action"
import { ViewPhotoAction } from "src/app/actions/cells/view-photo"
import { BranchAction } from "src/app/actions/navigation/branch.action"
import { RiftAction } from "src/app/actions/navigation/path"
import { PayloadBase } from "src/app/actions/action-contexts"

@Injectable({ providedIn: "root" })
export class TilePointerManager {
  private readonly policy = inject(PolicyService)
  private readonly registry = inject(ACTION_REGISTRY)
  private readonly selectionMove = inject(SelectionMoveManager)
  
  private readonly isBlocked = this.policy.any(
    POLICY.MovingTiles,
    POLICY.ControlDown,
  )

  // actions
  private readonly leftActions = [
    inject(BranchAction),
    inject(NewTileAction),
    inject(RiftAction),
    inject(ViewPhotoAction)
  ] as const

  // --------------------------------------------------------------------
  // attach events to the tile instance (called from RenderTileAction)
  // --------------------------------------------------------------------
  public attach(tile: any, cell: any): void {
    tile.on("pointertap", (event: PointerEvent) => {
      if (this.isBlocked()) return
      if (this.selectionMove.isDragging()) return
      this.dispatch(this.leftActions, cell, event)
    })
  }

  private async dispatch(actions: readonly { id: string }[], cell: any, event: PointerEvent) {
    const payload = <PayloadBase>{ kind: "cell", cell, event }

    for (const action of actions) {
      if (await this.registry.invoke(action.id, payload)) return
    }
  }
}
