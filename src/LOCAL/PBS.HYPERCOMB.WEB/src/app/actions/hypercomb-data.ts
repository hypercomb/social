// command-base.ts

import { inject } from "@angular/core"
import { Hypercomb } from "../core/mixins/abstraction/hypercomb.base"
import { PointerState } from "../state/input/pointer-state"
import { CELL_FACTORY } from "../inversion-of-control/tokens/tile-factory.token"
import { TILE_FACTORY } from "../shared/tokens/i-hypercomb.token"
import { CoordinateDetector } from "../helper/detection/coordinate-detector"


export abstract class HypercombLayout extends Hypercomb {
    protected readonly detectory = inject(CoordinateDetector)
    
    public readonly ps = inject(PointerState)
    protected readonly cell = {
        factory: inject(CELL_FACTORY),
    }
    protected readonly tile = {
        factory: inject(TILE_FACTORY)
    }
}




