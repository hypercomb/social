import { Injectable, inject, effect, untracked } from "@angular/core"
import { CoordinateDetector } from "src/app/helper/detection/coordinate-detector"
import { COMB_STORE } from "src/app/shared/tokens/i-comb-store.token"
import { PointerState } from "src/app/state/input/pointer-state"
import { isSelected } from "../models/cell-filters"
import { KeyboardState } from "src/app/interactivity/keyboard/keyboard-state"
import { SELECTIONS } from "src/app/shared/tokens/i-selection.token"

@Injectable({ providedIn: 'root' })
export class TileSelectionManager {
  private readonly detector = inject(CoordinateDetector)
  private readonly ps = inject(PointerState)
  private readonly ks = inject(KeyboardState)
  private readonly selections = inject(SELECTIONS)
  private readonly store = inject(COMB_STORE)

  private lastOp: boolean | null = null        // true = add, false = remove
  private touched = new Set<number>()          // cellIds processed this press

  constructor() {
    // 1) Latch op ONCE on pointerDown
    effect(() => {
      const tick = this.ps.downSeq()
      if (tick === 0) return
      const down = this.ps.pointerDownEvent()
      if (!down) return
      if (this.lastOp !== null) return

      untracked(() => {
        if (!this.ks.ctrl()) {
          this.lastOp = null
          this.touched.clear()
          return
        }

        const tile = this.detector.activeTile()
        if (!tile) {
          this.lastOp = true
          this.touched.clear()
          return
        }

        const cell = this.store.lookupData(tile.cellId)
        if (!cell) return

        this.lastOp = !isSelected(cell)
        this.touched.clear()
        this.applyOpIfNeeded(tile.cellId, cell, this.lastOp!)
      })
    })

    // 2) While mouse is down, on every MOVE apply op
    effect(() => {
      const tick = this.ps.moveSeq()
      if (tick === 0) return
      if (this.lastOp == null) return

      const tile = this.detector.activeTile()
      if (!tile) return
      const cell = this.store.lookupData(tile.cellId)
      if (!cell) return

      this.applyOpIfNeeded(tile.cellId, cell, this.lastOp)
    })

    // 3) Reset on pointerUp
    effect(() => {
      const tick = this.ps.upSeq()
      if (tick === 0) return
      const up = this.ps.pointerUpEvent()
      if (!up) return

      if (this.lastOp == null) return
      untracked(() => {
        this.lastOp = null
        this.touched.clear()
      })
    })
  }


  private applyOpIfNeeded(tileId: number, cell: any, op: boolean) {
    // one op per tile per press
    if (this.touched.has(tileId)) return

    // idempotence: only change when needed
    const selected = isSelected(cell)
    if (op) {
      if (!selected) this.selections.add(cell)
    } else {
      if (selected) this.selections.remove(cell)
    }

    this.touched.add(tileId)
  }
}
