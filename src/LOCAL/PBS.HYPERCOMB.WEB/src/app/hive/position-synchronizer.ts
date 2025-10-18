import { Injectable, inject, effect } from "@angular/core"
import { ContextStack } from "../unsorted/controller/context-stack"
import { CombQueryService } from "../cells/storage/comb-query-service"
import { CombStore } from "../cells/storage/comb-store"
import { PixiManager } from "../pixi/pixi-manager"
import { Cell } from "../cells/cell"

@Injectable({ providedIn: 'root' })
export class PositionSynchronizer {
  // ─────────────────────────────────────────────
  // dependencies
  // ─────────────────────────────────────────────
  private readonly query = inject(CombQueryService)
  private readonly pixi = inject(PixiManager)
  private readonly stack = inject(ContextStack)
  private readonly store = inject(CombStore)

  constructor() {
    // ─────────────────────────────────────────────
    // reactive effect: synchronize container position
    // ─────────────────────────────────────────────
    effect(() => {
      if (!this.pixi.ready()) return

      const entry = this.stack.top()
      if (!entry) return

      this.hideContainer()

      const cell = this.store.lookupData(entry.cellId)
      if (cell) {
        this.applyTransform(cell)
      } else {
        this.loadAndSync(entry.cellId)
      }
    })
  }

  // ─────────────────────────────────────────────
  // helper methods
  // ─────────────────────────────────────────────
  private hideContainer(): void {
    this.pixi.container.visible = false
  }

  private showContainer(): void {
    setTimeout(() => (this.pixi.container.visible = true), 0)
  }

  private async loadAndSync(cellId: number): Promise<void> {
    const loaded = await this.query.fetch(cellId)
    if (!loaded) return

    const entry = this.stack.top()
    if (entry) entry.hydrate(loaded)

    this.applyTransform(loaded)
  }

  private applyTransform(cell: Cell): void {
    const container = this.pixi.container
    container.scale.set(cell.scale)
    container.x = cell.x
    container.y = cell.y
    this.showContainer()
  }
}
