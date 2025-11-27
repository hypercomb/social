import { Injectable, inject, effect } from "@angular/core"
import { ContextStack } from "../core/controller/context-stack"
import { CombQueryService } from "../cells/storage/comb-query-service"
import { HoneycombStore } from "../cells/storage/honeycomb-store"
import { Cell } from "../cells/cell"
import { PIXI_MANAGER } from "../shared/tokens/i-pixi-manager.token"

@Injectable({ providedIn: 'root' })
export class PositionSynchronizer {
  // ─────────────────────────────────────────────
  // dependencies
  // ─────────────────────────────────────────────
  private readonly query = inject(CombQueryService)
  private readonly pixi = inject(PIXI_MANAGER)
  private readonly stack = inject(ContextStack)
  private readonly store = inject(HoneycombStore)

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
    this.pixi.container!.visible = false
  }

  private showContainer(): void {
    setTimeout(() => (this.pixi.container!.visible = true), 0)
  }

  private async loadAndSync(cellId: number): Promise<void> {
    const loaded = await this.query.fetch(cellId)
    if (!loaded) return

    const entry = this.stack.top()
    if (entry) entry.hydrate(loaded)

    this.applyTransform(loaded)
  }

  private applyTransform(cell: Cell): void {
    const container = this.pixi.container!
    container.scale.set(cell.scale)
    container.x = cell.x
    container.y = cell.y
    this.showContainer()
  }
}
