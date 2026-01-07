import { Injectable, computed, inject } from "@angular/core"
import { CellOptions } from "src/app/cells/models/cell-options"
import { ParentContext } from "./context-stack"

@Injectable({ providedIn: 'root' })
export class LayoutManager {
  private readonly stack = inject(ParentContext)

  public readonly locked = computed(() => {
    const cell = this.stack.cell()
    if (!cell) return false
    return (cell.isLocked) 
  })

  // future layout-wide policies can be added here
  public readonly canPan = computed(() =>
    !this.locked() && !this.stack.navigating()
  )
}
