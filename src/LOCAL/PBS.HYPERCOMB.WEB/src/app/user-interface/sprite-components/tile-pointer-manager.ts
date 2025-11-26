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
import { SELECTIONS } from "src/app/shared/tokens/i-selection.token"
import { TileSelectionManager } from "src/app/cells/selection/tile-selection-manager"

@Injectable({ providedIn: "root" })
export class TilePointerManager {
  private readonly policy = inject(PolicyService)
  private readonly registry = inject(ACTION_REGISTRY)
  private readonly selections = inject(SELECTIONS)
  private readonly manager = inject(TileSelectionManager)

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
      // 1. if selection is blocked (moving, ctrl-down override, etc)
      if (this.isBlocked()) return  

      // 2. handle tile selection first
      this.handleSelection(cell, event)

      // 3. then dispatch navigation/actions
      this.dispatch(this.leftActions, cell, event)
    })

    tile.on("pointerdown", (event: PointerEvent) => {
      if (event.  pointerType !== "mouse") return;

      // drag-select only when ctrl/meta held
      if (!event.ctrlKey && !event.metaKey) return;

      // start drag selection gesture
      this.manager.beginGesture(cell, event);

      // critical: prevent tap from firing afterwards
      event.stopPropagation();
    });

    tile.on("pointerenter", (event: PointerEvent) => {
        this.manager.applyOpIfNeeded(cell);
    })
  }
  
  private handleSelection(cell: any, event: PointerEvent): void {
    // ctrl/meta → toggle multi-select
    if (event.ctrlKey || event.metaKey) {
      this.selections.toggle(cell)
      return
    }

    // normal tap → select single tile
    // clear previous unless ctrl held
    this.selections.clear()
    this.selections.add(cell)
  }


  private async dispatch(actions: readonly { id: string }[], cell: any, event: PointerEvent) {
    const payload = <PayloadBase>{ kind: "cell", cell, event }

    for (const action of actions) {
      if (await this.registry.invoke(action.id, payload)) return
    }
  }
}
