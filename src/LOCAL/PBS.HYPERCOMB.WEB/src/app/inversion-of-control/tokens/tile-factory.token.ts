// tile-factory.token.ts

import { CellEntity } from 'src/app/database/model/i-tile-entity'
import { createEntityFactoryToken } from './entity-factory.token'
import { InjectionToken } from '@angular/core'
import { Cell } from 'src/app/models/cell'

export interface ICreateCells {
    create(name: string, params: Partial<Cell>): Promise<Cell>
}

export const CELL_FACTORY = createEntityFactoryToken<CellEntity, Cell>('CELL_FACTORY')
export const CELL_CREATOR = new InjectionToken<ICreateCells>('CELL_CREATOR')

