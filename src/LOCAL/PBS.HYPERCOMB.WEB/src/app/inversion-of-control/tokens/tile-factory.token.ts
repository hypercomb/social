// src/app/inversion-of-control/tokens/tile-factory.token.ts

import { InjectionToken } from '@angular/core'
import { Cell } from 'src/app/models/cell'

// intent-level creation (introduces new identity)
export interface IBuildCells {
    build(name: string): Promise<Cell>
}


export const CELL_BUILDER = new InjectionToken<IBuildCells>('CELL_BUILDER')
