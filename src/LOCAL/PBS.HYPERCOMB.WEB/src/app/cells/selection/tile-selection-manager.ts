import { Injectable, inject, effect, untracked } from "@angular/core"
import { isSelected } from "../models/cell-filters"
import { SELECTIONS } from "src/app/shared/tokens/i-selection.token"
import { Cell } from "../cell"
import { PixiServiceBase } from "src/app/pixi/pixi-service-base"

@Injectable({ providedIn: 'root' })
export class TileSelectionManager extends PixiServiceBase {
  private readonly selections = inject(SELECTIONS)

  private lastOp: boolean | null = null        // true = add, false = remove
  private touched = new Set<number>()          // cellIds processed this press

  constructor() {
    super()

    this.pixi.container!.on("pointerup", (ev: PointerEvent) => {  
      this.lastOp = null
    })
  }

  public applyOpIfNeeded(cell: any) {
    if(this.lastOp === null) return

    // one op per tile per press
    const cellId = cell.cellId
    if (this.touched.has(cellId)) return

    // idempotence: only change when needed
    const selected = isSelected(cell)
    if (this.lastOp) {
      if (!selected) this.selections.add(cell)
    } else {
      if (selected) this.selections.remove(cell)
    }

    this.touched.add(cellId)
  }

  public beginGesture(cell: Cell, event: PointerEvent) {
    // determine op
    const selected = isSelected(cell);
    this.lastOp = !selected; // same logic as before
    this.touched.clear();

    // apply to first tile
    this.applyOpIfNeeded(cell);
  }

}
