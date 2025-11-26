import { Injectable, inject } from "@angular/core"
import { Cell } from "../cell"
import { SELECTIONS } from "src/app/shared/tokens/i-selection.token"
import { PixiServiceBase } from "src/app/pixi/pixi-service-base"

@Injectable({ providedIn: "root" })
export class TileSelectionManager extends PixiServiceBase {
  private readonly selections = inject(SELECTIONS)

  // drag-select state
  private dragActive = false
  private lastOp: "add" | "remove" | null = null // what are we doing this gesture?
  private touched = new Set<number>()            // one op per tile per gesture

  constructor() {
    super()
  }

  // container pointerup ends any selection gesture
  protected override onPixiReady(): void {
    this.pixi.container!.on("pointerup", () => {
      this.endDrag()
    })
  }

  // ---------- public api used by TilePointerManager ----------

  // simple click selection (no ctrl-drag)
  public handleTap = (cell: Cell, event: PointerEvent): void => {
    // ctrl/meta → toggle multi-select
    if (event.ctrlKey || event.metaKey) {
      this.selections.toggle(cell)
      return
    }

    // normal tap → single select
    this.selections.clear()
    this.selections.add(cell)
  }


  // start ctrl/meta drag selection
  public beginDrag = (cell: Cell, event: PointerEvent): void => {
    if (!event.ctrlKey && !event.metaKey) return

    this.dragActive = true
    this.touched.clear()

    const selectedNow = this.isCellSelected(cell)
    this.lastOp = selectedNow ? "remove" : "add"

    this.applyOpIfNeeded(cell)
  }

  // pointerenter while drag is active
  public hoverDrag = (cell: Cell): void => {
    if (!this.dragActive || !this.lastOp) return
    this.applyOpIfNeeded(cell)
  }

  public endDrag = (): void => {
    this.dragActive = false
    this.lastOp = null
    this.touched.clear()
  }

  // ---------- helpers ----------

  private isCellSelected(cell: Cell): boolean {
    const arr = this.selections.items()
    return arr.some(c => c.cellId === cell.cellId)
  }

  private applyOpIfNeeded(cell: Cell): void {
    if (!this.lastOp) return

    const cellId = cell.cellId
    if (this.touched.has(cellId)) return

    const selected = this.isCellSelected(cell)

    if (this.lastOp === "add") {
      if (!selected) this.selections.add(cell)
    } else {
      if (selected) this.selections.remove(cell)
    }

    this.touched.add(cellId)
  }
}
