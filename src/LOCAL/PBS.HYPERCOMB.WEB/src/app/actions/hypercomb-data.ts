// command-base.ts

import { computed, inject } from "@angular/core"
import { Hypercomb } from "../core/mixins/abstraction/hypercomb.base"
import { PointerState } from "../state/input/pointer-state"
import { DatabaseService } from "../database/database-service"
import { CELL_FACTORY } from "../inversion-of-control/tokens/tile-factory.token"
import { TILE_FACTORY } from "../shared/tokens/i-hypercomb.token"
import { CELL_REPOSITORY } from "../shared/tokens/i-cell-repository.token"

export abstract class HypercombData extends Hypercomb {
    protected readonly repository = inject(CELL_REPOSITORY)
    protected readonly ds = inject(DatabaseService)
    protected readonly db = computed(() => this.ds.db())
}

export abstract class HypercombLayout extends Hypercomb {
    public readonly ps = inject(PointerState)
    protected readonly cell = {
        factory: inject(CELL_FACTORY),
    }
    protected readonly tile = {
        factory: inject(TILE_FACTORY)
    }
}




