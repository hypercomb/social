import { Injectable, inject, effect } from "@angular/core"
import { Cell } from "../cells/cell"
import { CombStore } from "../cells/storage/comb-store"
import { PixiManager } from "../pixi/pixi-manager"

import { ContextStack } from "../unsorted/controller/context-stack"
import { CombQueryService } from "../cells/storage/comb-query-service"

@Injectable({ providedIn: 'root' })
export class HiveViewService {
    private readonly query = inject(CombQueryService)
    private readonly pixi = inject(PixiManager)
    private readonly stack = inject(ContextStack)
    private readonly store = inject(CombStore)

    constructor() {
        // update the position of the newly loaded comb 
        effect(() => {
            if (!this.pixi.ready()) return

            const entry = this.stack.top()
            if (!entry) return

            this.pixi.container.visible = false
            // try in-memory first
            let cell = this.store.lookupData(entry.cellId)
            if (!cell) {
                // async fallback
                this.query.fetch(entry.cellId).then(loaded => {
                    if (loaded) {
                        entry.hydrate(loaded) // optional, keep entry in sync
                        this.applyTransform(loaded)
                    }
                })
                return
            }

            // cell is hydrated
            this.applyTransform(cell)
        })
    }

    private applyTransform(cell: Cell) {
        const container = this.pixi.container
        container.scale.set(cell.scale)
        container.x = cell.x
        container.y = cell.y
        setTimeout(() => this.pixi.container.visible = true, 0) // next tick
    }
}
