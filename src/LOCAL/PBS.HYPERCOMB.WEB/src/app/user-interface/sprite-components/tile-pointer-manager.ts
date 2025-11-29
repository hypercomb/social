// src/app/user-interface/sprite-components/tile-pointer-manager.ts
import { Injectable, inject } from "@angular/core"
import { FederatedPointerEvent } from "pixi.js"
import { ACTION_REGISTRY } from "src/app/shared/tokens/i-hypercomb.token"
import { POLICY } from "src/app/core/models/enumerations"
import { PolicyService } from "src/app/navigation/menus/policy-service"
import { OpenLinkAction } from "src/app/actions/navigation/open-link"
import { BranchAction } from "src/app/actions/navigation/branch.action"
import { ViewPhotoAction } from "src/app/actions/cells/view-photo"
import { PayloadBase } from "src/app/actions/action-contexts"
import { TileSelectionManager } from "src/app/cells/selection/tile-selection-manager"
import { SelectionMoveManager } from "src/app/cells/selection/selection-move-manager"
import { Cell } from "src/app/cells/cell"
import { ContextMenuService } from "src/app/navigation/menus/context-menu-service"
import { TouchDetectionService } from "src/app/core/mobile/touch-detection-service"

@Injectable({ providedIn: "root" })
export class TilePointerManager {
  private readonly policy = inject(PolicyService)
  private readonly registry = inject(ACTION_REGISTRY)
  private readonly selection = inject(TileSelectionManager)
  private readonly moveManager = inject(SelectionMoveManager)
  private readonly menu = inject(ContextMenuService)
  private readonly touch = inject(TouchDetectionService)

  private readonly moveModeSignal = this.policy.all(POLICY.MovingTiles)
  private isMoveMode = (): boolean => this.moveModeSignal()

  // desktop prioritizes branch first
  private readonly desktopActions = [
    inject(BranchAction),
    inject(OpenLinkAction),
    inject(ViewPhotoAction),
  ] as const

  // mobile prioritizes open link first
  private readonly mobileActions = [
    inject(OpenLinkAction),
    inject(BranchAction),
    inject(ViewPhotoAction),
  ] as const

  public attach(tile: any, cell: Cell): void {
    tile.eventMode = "dynamic"
/*  */
    tile.removeAllListeners("pointertap")
    tile.removeAllListeners("pointerdown")
    tile.removeAllListeners("pointerenter")
    tile.removeAllListeners("pointerleave")

    // ------------------------------------------------------------------
    // pointertap (works for both mouse and touch)
    // ------------------------------------------------------------------
    tile.on("pointertap", async (event: FederatedPointerEvent) => {
      const pointerType = event.pointerType || "mouse"

      const isTouchPointer = pointerType !== "mouse"
      const isMobileUi = this.touch.supportsTouch() && !this.touch.supportsEdit()
      const useMobileActions = isTouchPointer || isMobileUi

      // desktop only behaviors
      if (pointerType === "mouse") {
        if (event.button !== 0) return
        if (this.isMoveMode()) return

        if (event.ctrlKey || event.metaKey) {
          this.selection.handleTap(cell, event as unknown as PointerEvent)
          return
        }
      }

      const actions = useMobileActions ? this.mobileActions : this.desktopActions

      // Don't kill propagation on touch — this broke empty-area taps
      if (pointerType === "mouse") {
        event.stopPropagation()
      }

      await this.dispatch(actions, cell, event as unknown as PointerEvent)
    })

    // ------------------------------------------------------------------
    // pointerdown (desktop-only)
    // ------------------------------------------------------------------
    tile.on("pointerdown", (event: FederatedPointerEvent) => {
      if (event.pointerType !== "mouse") return
      if (event.button !== 0) return

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

    // ------------------------------------------------------------------
    // pointerenter / pointerleave (hover menu only on desktop)
    // ------------------------------------------------------------------
    tile.on("pointerenter", (event: FederatedPointerEvent) => {
      if (event.pointerType !== "mouse") return

      if (event.ctrlKey || event.metaKey) {
        this.selection.hoverDrag(cell)
        return
      }

      if (!this.isMoveMode()) {
        this.menu.tileEnter(cell)
      }
    })

    tile.on("pointerleave", (event: FederatedPointerEvent) => {
      if (event.pointerType !== "mouse") return
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
