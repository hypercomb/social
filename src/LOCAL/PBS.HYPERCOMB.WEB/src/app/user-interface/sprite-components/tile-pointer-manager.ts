import { Injectable, inject, effect, untracked } from "@angular/core"
import { CellPayload, PayloadBase } from "src/app/actions/action-contexts"
import { ViewPhotoAction } from "src/app/actions/cells/view-photo"
import { BackHiveAction } from "src/app/actions/navigation/back.action"
import { BranchAction } from "src/app/actions/navigation/branch.action"
import { RiftAction } from "src/app/actions/navigation/path"
import { SelectionMoveManager } from "src/app/cells/selection/selection-move-manager"
import { POLICY } from "src/app/core/models/enumerations"
import { CoordinateDetector } from "src/app/helper/detection/coordinate-detector"
import { PolicyService } from "src/app/navigation/menus/policy-service"
import { PixiServiceBase } from "src/app/pixi/pixi-service-base"
import { COMB_STORE } from "src/app/shared/tokens/i-comb-store.token"
import { ACTION_REGISTRY } from "src/app/shared/tokens/i-hypercomb.token"
import { SELECTIONS } from "src/app/shared/tokens/i-selection.token"
import { PointerState } from "src/app/state/input/pointer-state"

@Injectable({ providedIn: "root" })
export class TilePointerManager extends PixiServiceBase {
  private readonly detector = inject(CoordinateDetector)
  private readonly ps = inject(PointerState)
  private readonly store = inject(COMB_STORE)
  private readonly policy = inject(PolicyService)
  private readonly registry = inject(ACTION_REGISTRY)
  private readonly selections = inject(SELECTIONS)
  private readonly selectionMove = inject(SelectionMoveManager)

  // actions ordered by priority
  private readonly leftActions = [inject(BranchAction), inject(RiftAction), inject(ViewPhotoAction)] as const
  private readonly rightActions = [inject(BackHiveAction)] as const

  // gate: block clicks when moving tiles or control is pressed
  private readonly isBlocked = this.policy.any(POLICY.MovingTiles, POLICY.ControlDown)

  // ...unchanged imports / class fields...

  constructor() {
    super()

    // ctrl+down → begin selection (box or multi)
    effect(() => {
      if (this.ps.downSeq() > 0 && this.ks.ctrl()) {
        this.selections.beginSelection()
      }
    })

    // ctrl released while selecting → finish selection and set the one-shot suppress flag
    effect(() => {
      if (this.selections.isSelecting() && !this.ks.ctrl()) {
        // ensure finishSelection() flips the suppress flag internally;
        // if it doesn't, set it here in your service (e.g., selections.setSuppressNextUp())
        this.selections.finishSelection()
      }
    })

    // left click (on release) → dispatch only for true clicks, once per up
    // note: this effect must *only* track ps.upSeq(); everything else is read untracked
    let lastUpSeq = 0
    effect(() => {
      const seq = this.ps.upSeq()
      if (seq === 0 || seq === lastUpSeq) return
      lastUpSeq = seq
      if(this.isBlocked()) return

      untracked(() => {
        const up = this.ps.pointerUpEvent()
        if (!up || up.button !== 0) return

        // read gating state untracked so ctrl changes etc. don't retrigger this effect
        const shouldBlock =
          this.selections.isSelecting() ||
          this.selectionMove.isDragging() ||
          this.selections.suppressNextUp() // should consume the one-shot flag

        if (shouldBlock) return

        this.dispatch(this.leftActions, up)
      })
    })

    // right click (on release)
    effect(() => {
      if (this.ps.upSeq() === 0) return
      const up = this.ps.pointerUpEvent()
      if (!up || up.button !== 2) return
      if (this.isBlocked() || this.selectionMove.isDragging()) return

      untracked(() => this.dispatch(this.rightActions, up))
    })
  }

  private async dispatch(actions: readonly { id: string }[], event: PointerEvent) {
    const tile = this.detector.activeTile()
    const hiveName = this.stack.hiveName()!
    const cell = this.store.cells().find(c => c.cellId === tile?.cellId)

    const payload: CellPayload | PayloadBase = cell ? { kind: "cell", cell, event } : { kind: "cell", event }

    for (const action of actions) {
      if (await this.registry.invoke(action.id, payload)) return
    }
  }
}
